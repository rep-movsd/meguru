"""
Web server for Meguru - Seasonal Stock Pattern Detector.
Simple HTTP server using http.server with JSON API endpoints.
"""
from __future__ import annotations

import json
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler

from backend import (
    search_symbols,
    parse_symbols,
    get_stats,
    get_trades,
    export_stats_csv,
    export_trades_csv,
    export_strategy_csv,
    get_backtest_data,
    find_optimal_trades,
    get_plan_backtest_data,
    export_plan_calendar_csv,
    detect_sliding_windows,
    load_symbol_data,
    get_window_backtest_data,
    OFFSET_LIMITS,
)

HOST = "localhost"
PORT = 8000


HTML_PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Meguru - Seasonal Stock Pattern Detector</title>
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        
        html, body {
            height: 100%;
            overflow: hidden;
        }
        
        body {
            font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
            background: #1a1a2e;
            color: #eee;
            display: flex;
            flex-direction: column;
            padding: 8px;
            gap: 8px;
        }
        
        /* Controls */
        .controls {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 12px;
            background: #16213e;
            border-radius: 6px;
            flex-shrink: 0;
            gap: 12px;
        }
        
        .controls-section {
            flex: 1;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .controls-section.center {
            justify-content: center;
            gap: 16px;
        }
        
        .controls-section.right {
            justify-content: flex-end;
        }
        
        .control-group {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        
        .control-group label {
            font-size: 0.85em;
            color: #aaa;
        }
        
        .symbol-container {
            position: relative;
        }
        
        #symbol-input {
            width: 180px;
            padding: 5px 10px;
            border: 1px solid #444;
            border-radius: 4px;
            background: #0f0f23;
            color: #eee;
            font-size: 13px;
            transition: width 0.2s ease;
        }
        
        #symbol-input:focus {
            outline: none;
            border-color: #00d4ff;
        }
        
        /* Expanded input mode for editing multiple symbols */
        .controls.input-expanded .controls-section.center,
        .controls.input-expanded .controls-section.right {
            display: none;
        }
        
        .controls.input-expanded .controls-section:first-child {
            flex: 1;
        }
        
        .controls.input-expanded .symbol-container {
            flex: 1;
        }
        
        .controls.input-expanded #symbol-input {
            width: 100%;
        }
        
        .autocomplete-dropdown {
            position: absolute;
            top: 100%;
            left: 0;
            right: 0;
            background: #16213e;
            border: 1px solid #444;
            border-radius: 4px;
            max-height: 200px;
            overflow-y: auto;
            z-index: 1000;
            display: none;
        }
        
        .autocomplete-dropdown.show {
            display: block;
        }
        
        .autocomplete-item {
            padding: 6px 10px;
            cursor: pointer;
            border-bottom: 1px solid #333;
            font-size: 12px;
        }
        
        .autocomplete-item:hover,
        .autocomplete-item.selected {
            background: #1f4068;
        }
        
        .autocomplete-item .symbol {
            font-weight: bold;
            color: #00d4ff;
        }
        
        .autocomplete-item .name {
            color: #888;
            margin-left: 6px;
        }
        
        select, button {
            padding: 5px 10px;
            border: 1px solid #444;
            border-radius: 4px;
            background: #0f0f23;
            color: #eee;
            font-size: 13px;
            cursor: pointer;
        }
        
        button {
            background: #1f4068;
        }
        
        button:hover {
            background: #2a5298;
        }
        
        button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .btn-primary {
            background: #00d4ff;
            color: #000;
            font-weight: bold;
        }
        
        .btn-primary:hover {
            background: #00b8e6;
        }
        
        .btn-secondary {
            background: #2d4a6f;
            border-color: #3d5a7f;
        }
        
        .btn-secondary:hover {
            background: #3d5a8f;
        }
        
        .btn-small {
            padding: 3px 8px;
            font-size: 11px;
        }
        
        .stepper {
            display: flex;
            align-items: center;
            gap: 3px;
        }
        
        .stepper button {
            width: 24px;
            padding: 5px 0;
        }
        
        .stepper-value {
            min-width: 32px;
            text-align: center;
            font-weight: bold;
            font-size: 13px;
        }
        
        /* Main content area */
        .main-content {
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 8px;
            min-height: 0;
        }
        
        /* Top panel - stats table (scrollable, takes remaining space) */
        .stats-panel {
            flex: 1;
            display: flex;
            flex-direction: column;
            min-height: 0;
            background: #16213e;
            border-radius: 6px;
            overflow: hidden;
        }
        
        .panel-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 4px 10px;
            background: #1f4068;
            flex-shrink: 0;
        }
        
        .panel-header h3 {
            font-size: 0.85em;
            font-weight: 600;
            color: #00d4ff;
        }
        
        .panel-header-actions {
            display: flex;
            gap: 6px;
            align-items: center;
        }
        
        .table-container {
            flex: 1;
            overflow: auto;
        }
        
        /* Bottom panel - trades (fixed ~36% height) */
        .trades-panel {
            height: 36vh;
            min-height: 180px;
            display: flex;
            flex-direction: column;
            background: #16213e;
            border-radius: 6px;
            overflow: hidden;
            flex-shrink: 0;
        }
        
        .trades-panel.chart-mode {
            height: 60vh;
            min-height: 300px;
        }
        
        .trades-panel.chart-mode .trades-content {
            position: relative;
        }
        
        .window-chart-container {
            flex: 1;
            min-height: 0;
            position: relative;
        }
        
        .window-chart-container svg {
            width: 100%;
            height: 100%;
        }
        
        .window-chart-metrics {
            display: flex;
            gap: 20px;
            padding: 4px 16px;
            border-top: 1px solid #333;
            justify-content: center;
            font-size: 12px;
            flex-wrap: wrap;
            flex-shrink: 0;
        }
        
        .window-chart-metrics .metric {
            display: flex;
            gap: 5px;
        }
        
        .window-chart-metrics .metric .label {
            color: #888;
        }
        
        .chart-year-select {
            background: #1a1a2e;
            color: #e0e0e0;
            border: 1px solid #444;
            border-radius: 4px;
            padding: 1px 4px;
            font-size: 0.8em;
            cursor: pointer;
        }
        
        .chart-legend {
            display: flex;
            gap: 14px;
            align-items: center;
            font-size: 0.75em;
            color: #888;
        }
        
        .chart-legend-item {
            display: flex;
            align-items: center;
            gap: 4px;
        }
        
        .chart-legend-color {
            width: 14px;
            height: 3px;
        }
        
        .trades-content {
            flex: 1;
            display: flex;
            flex-direction: column;
            min-height: 0;
        }
        
        .trades-table-container {
            flex: 1;
            overflow: auto;
            min-height: 0;
        }
        
        /* Tables */
        table {
            border-collapse: collapse;
            font-size: 12px;
            table-layout: fixed;
        }
        
        th, td {
            padding: 3px 4px;
            text-align: right;
            white-space: nowrap;
            line-height: 1.3;
            overflow: hidden;
        }
        
        /* Fixed column widths */
        .col-period { width: 52px; text-align: left; }
        .col-trend { width: 44px; }
        .col-ev { width: 48px; }
        .col-runev { width: 48px; }
        .col-avg { width: 48px; }
        .col-year { width: 52px; }
        
        /* Trades table columns */
        .col-entry { width: 56px; text-align: left; }
        .col-exit { width: 56px; }
        .col-profit { width: 52px; }
        .col-days { width: 40px; }
        .col-bps { width: 60px; }
        
        th {
            background: #1f4068;
            color: #00d4ff;
            font-weight: 600;
            position: sticky;
            top: 0;
            z-index: 3;
        }
        
        th:first-child {
            text-align: left;
            position: sticky;
            left: 0;
            top: 0;
            z-index: 4;
            background: #1f4068;
        }
        
        td:first-child {
            text-align: left;
            position: sticky;
            left: 0;
            z-index: 1;
        }
        
        tr:nth-child(even) td:first-child {
            background: #1a1a2e;
        }
        
        tr:nth-child(odd) td:first-child {
            background: #16213e;
        }
        
        .run-bull td:first-child {
            background: #0a300a;
        }
        
        .run-bear td:first-child {
            background: #300a0a;
        }
        
        tr:nth-child(even) {
            background: #1a1a2e;
        }
        
        tr:nth-child(odd) {
            background: #16213e;
        }
        
        .positive { color: #00ff88; }
        .negative { color: #ff4466; }
        .neutral { color: #6699ff; }
        .dim { color: #666; }
        
        .run-bull {
            background: #0a300a !important;
        }
        
        .run-bear {
            background: #300a0a !important;
        }
        
        /* Rollover separator */
        .rollover-separator {
            background: transparent !important;
        }
        .rollover-line {
            text-align: center;
            color: #555;
            font-size: 11px;
            padding: 8px 0 !important;
            letter-spacing: 1px;
            border-top: 1px solid #333;
            border-bottom: 1px solid #333;
        }
        
        /* Summary table */
        .summary {
            background: #0f0f23;
            border-top: 1px solid #333;
            flex-shrink: 0;
            padding: 6px 10px;
        }
        
        .summary table {
            font-size: 14px;
            width: auto;
        }
        
        .summary td {
            padding: 3px 6px;
            white-space: nowrap;
        }
        
        .summary .label {
            color: #888;
            text-align: left;
        }
        
        /* Status bar */
        .status {
            padding: 4px 10px;
            text-align: center;
            color: #666;
            font-size: 0.8em;
            flex-shrink: 0;
        }
        
        .status.error {
            color: #ff4466;
        }
        
        /* Loading indicator */
        .spinner-overlay {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            display: none;
            z-index: 9999;
            pointer-events: none;
        }
        
        .spinner-overlay.show {
            display: block;
        }
        
        .spinner {
            width: 40px;
            height: 40px;
            border: 3px solid rgba(0, 212, 255, 0.2);
            border-top-color: #00d4ff;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
        }
        
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        
        /* Multi-select overlay */
        .multi-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.7);
            display: none;
            justify-content: center;
            align-items: center;
            z-index: 10000;
        }
        
        .multi-overlay.show {
            display: flex;
        }
        
        .multi-panel {
            background: #16213e;
            border-radius: 8px;
            width: 66vw;
            height: 66vh;
            display: flex;
            flex-direction: column;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        }
        
        .multi-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 16px;
            border-bottom: 1px solid #333;
        }
        
        .multi-header h3 {
            margin: 0;
            color: #00d4ff;
            font-size: 1em;
        }
        
        .multi-header-actions {
            display: flex;
            gap: 8px;
        }
        
        .multi-search {
            padding: 12px 16px;
            border-bottom: 1px solid #333;
        }
        
        .multi-search input {
            width: 100%;
            padding: 8px 12px;
            border: 1px solid #444;
            border-radius: 4px;
            background: #0f0f23;
            color: #eee;
            font-size: 13px;
        }
        
        .multi-search input:focus {
            outline: none;
            border-color: #00d4ff;
        }
        
        .multi-selected {
            padding: 8px 16px;
            border-bottom: 1px solid #333;
            display: none;
        }
        
        .multi-selected.show {
            display: block;
        }
        
        .multi-selected-label {
            font-size: 11px;
            color: #888;
            margin-bottom: 6px;
        }
        
        .multi-selected-chips {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
        }
        
        .multi-chip {
            background: #1f4068;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        
        .multi-chip .remove {
            cursor: pointer;
            color: #ff4466;
            font-weight: bold;
        }
        
        .multi-list {
            flex: 1;
            overflow-y: auto;
            min-height: 0;
        }
        
        .multi-item {
            display: flex;
            align-items: center;
            padding: 8px 16px;
            cursor: pointer;
            border-bottom: 1px solid #222;
            gap: 10px;
        }
        
        .multi-item:hover {
            background: #1f4068;
        }
        
        .multi-item.disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .multi-item input[type="checkbox"] {
            width: 16px;
            height: 16px;
            cursor: pointer;
        }
        
        .multi-item .symbol {
            font-weight: bold;
            color: #00d4ff;
            min-width: 100px;
        }
        
        .multi-item .name {
            color: #888;
            font-size: 12px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        
        .multi-footer {
            padding: 12px 16px;
            border-top: 1px solid #333;
            display: flex;
            justify-content: flex-end;
            gap: 8px;
        }
        
        .multi-count {
            font-size: 12px;
            color: #888;
            margin-right: auto;
        }
        
        /* Backtest overlay */
        .backtest-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.85);
            display: none;
            justify-content: center;
            align-items: center;
            z-index: 10001;
        }
        
        .backtest-overlay.show {
            display: flex;
        }
        
        .backtest-panel {
            background: #16213e;
            border-radius: 8px;
            width: 90vw;
            height: 80vh;
            display: flex;
            flex-direction: column;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        }
        
        .backtest-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 16px;
            border-bottom: 1px solid #333;
        }
        
        .backtest-header h3 {
            margin: 0;
            color: #00d4ff;
            font-size: 1.1em;
        }
        
        .backtest-controls {
            display: flex;
            gap: 12px;
            align-items: center;
        }
        
        .backtest-controls label {
            color: #888;
            font-size: 0.9em;
        }
        
        .backtest-controls select {
            padding: 4px 8px;
        }
        
        .backtest-chart {
            flex: 1;
            padding: 16px;
            min-height: 0;
        }
        
        .backtest-chart svg {
            width: 100%;
            height: 100%;
        }
        
        .backtest-legend {
            display: flex;
            gap: 20px;
            padding: 12px 16px;
            border-top: 1px solid #333;
            justify-content: center;
        }
        
        .backtest-legend-item {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 13px;
        }
        
        .backtest-legend-color {
            width: 20px;
            height: 3px;
        }
        
        .backtest-metrics {
            display: flex;
            gap: 30px;
            padding: 8px 16px;
            border-top: 1px solid #333;
            justify-content: center;
            font-size: 13px;
            flex-wrap: wrap;
        }
        
        .backtest-warning {
            width: 100%;
            text-align: center;
            color: #ff9944;
            font-size: 12px;
            padding: 4px 0;
            margin-bottom: 4px;
        }
        
        .backtest-metric {
            display: flex;
            gap: 6px;
        }
        
        .backtest-metric .label {
            color: #888;
        }
        
        /* Plan button in header */
        .btn-plan {
            background: #9b59b6;
            border-color: #8e44ad;
        }
        
        .btn-plan:hover {
            background: #8e44ad;
        }
        
        .btn-plan.has-items {
            animation: pulse-plan 2s infinite;
        }
        
        @keyframes pulse-plan {
            0%, 100% { box-shadow: 0 0 0 0 rgba(155, 89, 182, 0.4); }
            50% { box-shadow: 0 0 0 4px rgba(155, 89, 182, 0); }
        }
        
        .plan-badge {
            background: #e74c3c;
            color: white;
            font-size: 10px;
            padding: 1px 5px;
            border-radius: 10px;
            margin-left: 4px;
        }
        
        /* Plan overlay */
        .plan-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.85);
            display: none;
            justify-content: center;
            align-items: center;
            z-index: 10002;
        }
        
        .plan-overlay.show {
            display: flex;
        }
        
        .plan-panel {
            background: #16213e;
            border-radius: 8px;
            width: 80vw;
            height: 80vh;
            display: flex;
            flex-direction: column;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        }
        
        .plan-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 16px;
            border-bottom: 1px solid #333;
        }
        
        .plan-header h3 {
            margin: 0;
            color: #9b59b6;
            font-size: 1.1em;
        }
        
        .plan-header-actions {
            display: flex;
            gap: 8px;
            align-items: center;
        }
        
        .plan-content {
            flex: 1;
            display: flex;
            min-height: 0;
        }
        
        .plan-strategies {
            width: 25%;
            min-width: 200px;
            border-right: 1px solid #333;
            display: flex;
            flex-direction: column;
        }
        
        .plan-strategies-header {
            padding: 10px 16px;
            border-bottom: 1px solid #333;
            font-size: 0.9em;
            color: #888;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .plan-strategies-list {
            flex: 1;
            overflow-y: auto;
        }
        
        .plan-strategy-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 16px;
            border-bottom: 1px solid #222;
        }
        
        .plan-strategy-item:hover {
            background: #1f4068;
        }
        
        .plan-strategy-info {
            flex: 1;
        }
        
        .plan-strategy-symbol {
            font-weight: bold;
            color: #00d4ff;
        }
        
        .plan-strategy-params {
            font-size: 11px;
            color: #888;
            margin-top: 2px;
        }
        
        .plan-strategy-remove {
            color: #ff4466;
            cursor: pointer;
            padding: 4px 8px;
            font-size: 14px;
        }
        
        .plan-strategy-remove:hover {
            background: rgba(255, 68, 102, 0.2);
            border-radius: 4px;
        }
        
        .plan-empty {
            padding: 20px;
            text-align: center;
            color: #666;
        }
        
        .plan-chart-area {
            flex: 1;
            display: flex;
            flex-direction: column;
        }
        
        .plan-chart-controls {
            padding: 10px 16px;
            border-bottom: 1px solid #333;
            display: flex;
            gap: 12px;
            align-items: center;
        }
        
        .plan-chart-controls label {
            color: #888;
            font-size: 0.9em;
        }
        
        .plan-chart {
            flex: 1;
            padding: 16px;
            min-height: 0;
        }
        
        .plan-chart svg {
            width: 100%;
            height: 100%;
        }
        
        .plan-metrics {
            padding: 8px 16px;
            border-top: 1px solid #333;
            display: flex;
            gap: 30px;
            justify-content: center;
            font-size: 13px;
            flex-wrap: wrap;
        }
        
        .plan-footer {
            padding: 12px 16px;
            border-top: 1px solid #333;
            display: flex;
            justify-content: flex-end;
            gap: 8px;
        }
        
        /* Add to plan button */
        .btn-add-plan {
            background: #9b59b6;
            border-color: #8e44ad;
        }
        
        .btn-add-plan:hover {
            background: #8e44ad;
        }
    </style>
</head>
<body>
    <div class="controls">
        <div class="controls-section">
            <div class="symbol-container">
                <input type="text" id="symbol-input" placeholder="Type symbol..." value="" autocomplete="off">
                <div class="autocomplete-dropdown" id="autocomplete"></div>
            </div>
            <button id="multi-btn" class="btn-secondary">+ Multi</button>
            <button id="load-btn" class="btn-primary">Load</button>
        </div>
        
        <div class="controls-section center">
            <div class="control-group">
                <label>Window:</label>
                <select id="window-size-select">
                    <option value="7">1 week</option>
                    <option value="14">2 weeks</option>
                    <option value="30" selected>1 month</option>
                    <option value="60">2 months</option>
                    <option value="90">3 months</option>
                </select>
            </div>
            
            <div class="control-group">
                <label>Threshold:</label>
                <div class="stepper">
                    <button id="threshold-minus">-</button>
                    <span class="stepper-value" id="threshold-value">50%</span>
                    <button id="threshold-plus">+</button>
                </div>
            </div>
        </div>
        
        <div class="controls-section right">
            <button id="find-max-profit-btn" class="btn-secondary">Find max profit trades</button>
            <button id="find-max-yield-btn" class="btn-secondary">Find max yield trades</button>
            <button id="show-plan-btn" class="btn-plan">Plan<span id="plan-badge" class="plan-badge" style="display:none;">0</span></button>
        </div>
    </div>
    
    <div class="main-content">
        <div class="stats-panel">
            <div class="panel-header">
                <h3>Stats</h3>
                <button id="export-stats-btn" class="btn-small">Export</button>
            </div>
            <div class="table-container">
                <table id="stats-table">
                    <thead><tr><th>Period</th><th>Days</th><th>Return%</th><th>Win%</th><th>bps/day</th></tr></thead>
                    <tbody></tbody>
                </table>
            </div>
        </div>
        
        <div class="trades-panel" id="trades-panel">
            <div class="panel-header">
                <h3 id="trades-panel-title">Strategy</h3>
                <div class="panel-header-actions" id="strategy-actions" style="display: none;">
                    <button id="export-trades-btn" class="btn-small btn-secondary">Export Data</button>
                    <button id="export-strategy-btn" class="btn-small btn-secondary">Export Strategy</button>
                    <button id="show-backtest-btn" class="btn-small btn-primary">Backtest</button>
                    <button id="add-to-plan-btn" class="btn-small btn-add-plan">+ Add to Plan</button>
                </div>
                <div id="chart-controls" style="display: none;">
                    <div class="chart-legend">
                        <div class="chart-legend-item"><div class="chart-legend-color" style="background: #00ff88;"></div>Strategy</div>
                        <div class="chart-legend-item"><div class="chart-legend-color" style="background: #6699ff;"></div>Buy & Hold</div>
                        <select id="chart-year-select" class="chart-year-select"></select>
                    </div>
                </div>
            </div>
            <div class="trades-content">
                <div class="trades-table-container">
                    <table id="trades-table">
                        <thead><tr><th>Entry</th><th>Exit</th><th>Profit</th><th>Days</th><th>Yield/day</th></tr></thead>
                        <tbody></tbody>
                    </table>
                </div>
                <div class="summary" id="summary"></div>
                <div class="window-chart-container" id="window-chart" style="display: none;"></div>
                <div class="window-chart-metrics" id="window-chart-metrics" style="display: none;"></div>
            </div>
        </div>
    </div>
    
    <div class="status" id="status">Ready</div>
    
    <div class="spinner-overlay" id="spinner">
        <div class="spinner"></div>
    </div>
    
    <div class="multi-overlay" id="multi-overlay">
        <div class="multi-panel">
            <div class="multi-header">
                <h3>Select Stocks (max 5)</h3>
                <div class="multi-header-actions">
                    <button id="multi-clear-btn" class="btn-small btn-secondary">Clear All</button>
                    <button id="multi-close-btn" class="btn-small">X</button>
                </div>
            </div>
            <div class="multi-search">
                <input type="text" id="multi-search-input" placeholder="Search stocks...">
            </div>
            <div class="multi-selected" id="multi-selected">
                <div class="multi-selected-label">Selected:</div>
                <div class="multi-selected-chips" id="multi-chips"></div>
            </div>
            <div class="multi-list" id="multi-list"></div>
            <div class="multi-footer">
                <span class="multi-count" id="multi-count">0/5 selected</span>
                <button id="multi-cancel-btn" class="btn-secondary">Cancel</button>
                <button id="multi-apply-btn" class="btn-primary">Apply</button>
            </div>
        </div>
    </div>
    
    <div class="backtest-overlay" id="backtest-overlay">
        <div class="backtest-panel">
            <div class="backtest-header">
                <h3>Backtest: <span id="backtest-title">-</span></h3>
                <div class="backtest-controls">
                    <label>Year:</label>
                    <select id="backtest-year-select"></select>
                    <label>Capital:</label>
                    <select id="backtest-capital-select">
                        <option value="100000" selected>₹1,00,000</option>
                        <option value="500000">₹5,00,000</option>
                        <option value="1000000">₹10,00,000</option>
                    </select>
                    <button id="backtest-close-btn" class="btn-small">✕</button>
                </div>
            </div>
            <div class="backtest-chart" id="backtest-chart"></div>
            <div class="backtest-legend">
                <div class="backtest-legend-item">
                    <div class="backtest-legend-color" style="background: #00ff88;"></div>
                    <span>Seasonal Strategy</span>
                </div>
                <div class="backtest-legend-item">
                    <div class="backtest-legend-color" style="background: #6699ff;"></div>
                    <span>Buy & Hold</span>
                </div>
                <div class="backtest-legend-item">
                    <div class="backtest-legend-color" style="background: #333; height: 1px;"></div>
                    <span>Zero Line</span>
                </div>
            </div>
            <div class="backtest-metrics" id="backtest-metrics"></div>
        </div>
    </div>
    
    <div class="plan-overlay" id="plan-overlay">
        <div class="plan-panel">
            <div class="plan-header">
                <h3>Trading Plan</h3>
                <div class="plan-header-actions">
                    <button id="plan-clear-btn" class="btn-small btn-secondary">Clear All</button>
                    <button id="plan-close-btn" class="btn-small">✕</button>
                </div>
            </div>
            <div class="plan-content">
                <div class="plan-strategies">
                    <div class="plan-strategies-header">
                        <span>Strategies</span>
                        <span id="plan-strategy-count">0 strategies</span>
                    </div>
                    <div class="plan-strategies-list" id="plan-strategies-list">
                        <div class="plan-empty">No strategies added yet. Analyze a stock and click "Add to Plan".</div>
                    </div>
                </div>
                <div class="plan-chart-area">
                    <div class="plan-chart-controls">
                        <label>Year:</label>
                        <select id="plan-year-select"></select>
                        <label>Capital:</label>
                        <select id="plan-capital-select">
                            <option value="100000" selected>₹1,00,000</option>
                            <option value="500000">₹5,00,000</option>
                            <option value="1000000">₹10,00,000</option>
                        </select>
                    </div>
                    <div class="plan-chart" id="plan-chart">
                        <div style="padding: 20px; color: #666; text-align: center;">Add strategies to see combined backtest</div>
                    </div>
                    <div class="plan-metrics" id="plan-metrics"></div>
                </div>
            </div>
            <div class="plan-footer">
                <button id="plan-export-btn" class="btn-secondary">Export Trading Calendar</button>
            </div>
        </div>
    </div>
    
    <script>
        // State
        let state = {
            symbol: '',
            windowSize: 30,
            threshold: 50,
        };
        
        // Elements
        const symbolInput = document.getElementById('symbol-input');
        const autocomplete = document.getElementById('autocomplete');
        const windowSizeSelect = document.getElementById('window-size-select');
        const thresholdValue = document.getElementById('threshold-value');
        const loadBtn = document.getElementById('load-btn');
        const statsTable = document.getElementById('stats-table');
        const tradesTable = document.getElementById('trades-table');
        const summary = document.getElementById('summary');
        const status = document.getElementById('status');
        const tradesPanel = document.getElementById('trades-panel');
        const tradesPanelTitle = document.getElementById('trades-panel-title');
        const chartControls = document.getElementById('chart-controls');
        const chartYearSelect = document.getElementById('chart-year-select');
        const windowChart = document.getElementById('window-chart');
        const windowChartMetrics = document.getElementById('window-chart-metrics');
        const spinner = document.getElementById('spinner');
        
        // Autocomplete
        let autocompleteIndex = -1;
        let autocompleteItems = [];
        
        // Helper to format symbol for display (strip .NS suffix)
        function displaySymbol(symbol) {
            return symbol.replace(/\\.NS$/i, '');
        }
        
        symbolInput.addEventListener('input', async (e) => {
            const query = e.target.value.trim();
            
            // Check for expanded mode on input change
            if (query.includes(',')) {
                document.querySelector('.controls').classList.add('input-expanded');
                hideAutocomplete();  // Disable autocomplete for multiple symbols
                return;
            } else {
                document.querySelector('.controls').classList.remove('input-expanded');
            }
            
            if (query.length < 1) {
                hideAutocomplete();
                return;
            }
            
            try {
                const res = await fetch(`/api/symbols?q=${encodeURIComponent(query)}`);
                const data = await res.json();
                showAutocomplete(data);
            } catch (err) {
                hideAutocomplete();
            }
        });
        
        symbolInput.addEventListener('keydown', (e) => {
            if (!autocomplete.classList.contains('show')) {
                if (e.key === 'Enter') {
                    loadData();
                }
                return;
            }
            
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                autocompleteIndex = Math.min(autocompleteIndex + 1, autocompleteItems.length - 1);
                updateAutocompleteSelection();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                autocompleteIndex = Math.max(autocompleteIndex - 1, 0);
                updateAutocompleteSelection();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (autocompleteIndex >= 0 && autocompleteItems[autocompleteIndex]) {
                    selectAutocompleteItem(autocompleteItems[autocompleteIndex].symbol);
                } else {
                    hideAutocomplete();
                    loadData();
                }
            } else if (e.key === 'Escape') {
                hideAutocomplete();
            }
        });
        
        symbolInput.addEventListener('blur', () => {
            setTimeout(hideAutocomplete, 200);
            // Remove expanded mode on blur
            document.querySelector('.controls').classList.remove('input-expanded');
        });
        
        // Expanded input mode for editing multiple symbols
        symbolInput.addEventListener('focus', () => {
            // If input contains comma (multiple symbols), expand to full width
            if (symbolInput.value.includes(',')) {
                document.querySelector('.controls').classList.add('input-expanded');
            }
        });
        
        function showAutocomplete(items) {
            autocompleteItems = items;
            autocompleteIndex = -1;
            
            if (items.length === 0) {
                hideAutocomplete();
                return;
            }
            
            autocomplete.innerHTML = items.map((item, idx) => `
                <div class="autocomplete-item" data-symbol="${item.symbol}">
                    <span class="symbol">${displaySymbol(item.symbol)}</span>
                    <span class="name">${item.name}</span>
                </div>
            `).join('');
            
            autocomplete.querySelectorAll('.autocomplete-item').forEach(el => {
                el.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    selectAutocompleteItem(el.dataset.symbol);
                });
            });
            
            autocomplete.classList.add('show');
        }
        
        function hideAutocomplete() {
            autocomplete.classList.remove('show');
            autocompleteItems = [];
            autocompleteIndex = -1;
        }
        
        function updateAutocompleteSelection() {
            autocomplete.querySelectorAll('.autocomplete-item').forEach((el, idx) => {
                el.classList.toggle('selected', idx === autocompleteIndex);
            });
        }
        
        function selectAutocompleteItem(symbol) {
            symbolInput.value = displaySymbol(symbol);
            state.symbol = symbol;
            hideAutocomplete();
            loadData();
        }
        
        // Window size
        windowSizeSelect.addEventListener('change', (e) => {
            state.windowSize = parseInt(e.target.value);
            loadData();
        });
        
        // Threshold stepper
        document.getElementById('threshold-minus').addEventListener('click', () => {
            if (state.threshold > 50) {
                state.threshold -= 5;
                thresholdValue.textContent = state.threshold + '%';
                loadData();
            }
        });
        
        document.getElementById('threshold-plus').addEventListener('click', () => {
            if (state.threshold < 100) {
                state.threshold += 5;
                thresholdValue.textContent = state.threshold + '%';
                loadData();
            }
        });
        
        // Load button
        loadBtn.addEventListener('click', loadData);
        
        // Export buttons
        document.getElementById('export-stats-btn').addEventListener('click', () => {
            exportCSV('stats');
        });
        
        document.getElementById('export-trades-btn').addEventListener('click', () => {
            exportCSV('trades');
        });
        
        document.getElementById('export-strategy-btn').addEventListener('click', () => {
            exportCSV('strategy');
        });
        
        document.getElementById('show-backtest-btn').addEventListener('click', () => {
            showBacktest();
        });
        
        document.getElementById('add-to-plan-btn').addEventListener('click', () => {
            addToPlan();
        });
        
        // Find optimal trades buttons - disabled for window mode
        document.getElementById('find-max-profit-btn').addEventListener('click', () => {
            setStatus('Optimize not available in window mode', true);
        });
        
        document.getElementById('find-max-yield-btn').addEventListener('click', () => {
            setStatus('Optimize not available in window mode', true);
        });
        
        async function loadData() {
            state.symbol = symbolInput.value.trim().toUpperCase();
            if (!state.symbol) {
                setStatus('Enter a symbol', true);
                return;
            }
            
            showSpinner();
            setStatus('Loading...');
            
            try {
                const params = new URLSearchParams({
                    symbol: state.symbol,
                    window_size: state.windowSize,
                    threshold: state.threshold,
                });
                
                const res = await fetch(`/api/windows?${params}`);
                const data = await res.json();
                
                if (data.error) {
                    setStatus(data.error, true);
                    hideSpinner();
                    return;
                }
                
                renderWindowsTable(data);
                
                const windowLabel = windowSizeSelect.options[windowSizeSelect.selectedIndex].text;
                setStatus(`Found ${data.windows.length} windows for ${displaySymbol(state.symbol)} (${windowLabel}, ${state.threshold}% threshold)`);
            } catch (err) {
                setStatus('Error: ' + err.message, true);
            }
            
            hideSpinner();
        }
        
        function renderWindowsTable(data) {
            const { windows, total_days, total_return } = data;
            
            // Build header
            const headerRow = statsTable.querySelector('thead tr');
            headerRow.innerHTML = '<th class="col-period">Period</th><th class="col-days">Days</th><th class="col-return">Return%</th><th class="col-win">Win%</th><th class="col-yield">bps/day</th>';
            
            // Add year columns from first window if available
            if (windows.length > 0) {
                const years = Object.keys(windows[0].year_returns).sort().reverse();
                years.forEach(year => {
                    headerRow.innerHTML += `<th class="col-year">${year}</th>`;
                });
            }
            
            // Build body
            const tbody = statsTable.querySelector('tbody');
            tbody.innerHTML = '';
            
            windows.forEach((w) => {
                const tr = document.createElement('tr');
                
                // Period column
                tr.innerHTML = `<td class="col-period">${w.start_date} - ${w.end_date}</td>`;
                
                // Days
                const daysCell = document.createElement('td');
                daysCell.className = 'col-days';
                daysCell.textContent = w.length;
                tr.appendChild(daysCell);
                
                // Return%
                const returnCell = document.createElement('td');
                returnCell.className = 'col-return ' + (w.avg_return >= 0 ? 'positive' : 'negative');
                returnCell.textContent = w.avg_return.toFixed(1) + '%';
                tr.appendChild(returnCell);
                
                // Win%
                const winCell = document.createElement('td');
                winCell.className = 'col-win';
                winCell.textContent = w.win_rate + '%';
                tr.appendChild(winCell);
                
                // bps/day
                const yieldCell = document.createElement('td');
                yieldCell.className = 'col-yield ' + (w.yield_per_day >= 0 ? 'positive' : 'negative');
                yieldCell.textContent = w.yield_per_day.toFixed(1);
                tr.appendChild(yieldCell);
                
                // Year returns
                const years = Object.keys(w.year_returns).sort().reverse();
                years.forEach(year => {
                    const ret = w.year_returns[year];
                    const td = document.createElement('td');
                    td.className = 'col-year';
                    if (ret !== null) {
                        td.textContent = ret.toFixed(1) + '%';
                        td.className += ret >= 0 ? ' positive' : ' negative';
                    } else {
                        td.textContent = '-';
                        td.className += ' na';
                    }
                    tr.appendChild(td);
                });
                
                tbody.appendChild(tr);
            });
            
            // Add totals row
            if (windows.length > 0) {
                const totalTr = document.createElement('tr');
                totalTr.className = 'totals-row';
                totalTr.innerHTML = `
                    <td class="col-period"><strong>TOTAL</strong></td>
                    <td class="col-days"><strong>${total_days}</strong></td>
                    <td class="col-return ${total_return >= 0 ? 'positive' : 'negative'}"><strong>${total_return.toFixed(1)}%</strong></td>
                    <td class="col-win"></td>
                    <td class="col-yield"></td>
                `;
                // Add empty cells for year columns
                if (windows.length > 0) {
                    const years = Object.keys(windows[0].year_returns).sort().reverse();
                    years.forEach(() => {
                        totalTr.innerHTML += '<td class="col-year"></td>';
                    });
                }
                tbody.appendChild(totalTr);
            }
            
            // Switch bottom panel to chart mode
            tradesTable.querySelector('tbody').innerHTML = '';
            summary.innerHTML = '';
            document.getElementById('strategy-actions').style.display = 'none';
            document.querySelector('.trades-table-container').style.display = 'none';
            
            // Enable chart mode
            tradesPanel.classList.add('chart-mode');
            tradesPanelTitle.textContent = 'Backtest';
            chartControls.style.display = '';
            windowChart.style.display = '';
            windowChartMetrics.style.display = '';
            
            // Populate year selector from window year_returns
            if (windows.length > 0) {
                const years = Object.keys(windows[0].year_returns).sort().reverse();
                chartYearSelect.innerHTML = '';
                years.forEach(year => {
                    const opt = document.createElement('option');
                    opt.value = year;
                    opt.textContent = year;
                    chartYearSelect.appendChild(opt);
                });
                // Load backtest for the most recent year
                loadWindowBacktest();
            }
        }
        
        // Year selector change handler for inline chart
        chartYearSelect.addEventListener('change', () => {
            loadWindowBacktest();
        });
        
        async function loadWindowBacktest() {
            const year = chartYearSelect.value;
            if (!year || !state.symbol) return;
            
            windowChart.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#888;">Loading...</div>';
            windowChartMetrics.innerHTML = '';
            
            try {
                const params = new URLSearchParams({
                    symbol: state.symbol,
                    window_size: state.windowSize,
                    threshold: state.threshold,
                    year: year,
                });
                
                const res = await fetch(`/api/windows/backtest?${params}`);
                const data = await res.json();
                
                if (data.error) {
                    windowChart.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#ff4466;">${data.error}</div>`;
                    return;
                }
                
                renderWindowChart(data);
            } catch (err) {
                windowChart.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#ff4466;">Error: ${err.message}</div>`;
            }
        }
        
        function renderWindowChart(data) {
            const { seasonal_curve, bh_curve, trades, dates } = data;
            const capital = 100000;  // Fixed ₹1L for window mode
            
            // Chart dimensions from container
            const container = windowChart.getBoundingClientRect();
            const width = container.width;
            const height = container.height;
            if (width < 50 || height < 50) return;
            
            const padding = { top: 20, right: 55, bottom: 30, left: 60 };
            const chartWidth = width - padding.left - padding.right;
            const chartHeight = height - padding.top - padding.bottom;
            
            // Scale to P&L
            const seasonalPnL = seasonal_curve.map(p => (p / 100) * capital);
            const bhPnL = bh_curve.map(p => (p / 100) * capital);
            
            const allValues = [...seasonalPnL, ...bhPnL];
            const dataMin = Math.min(...allValues, 0);
            const dataMax = Math.max(...allValues, 0);
            const range = dataMax - dataMin || 1;
            const yMin = dataMin - range * 0.1;
            const yMax = dataMax + range * 0.1;
            
            const xScale = (i) => padding.left + (i / (dates.length - 1)) * chartWidth;
            const yScale = (v) => padding.top + chartHeight - ((v - yMin) / (yMax - yMin)) * chartHeight;
            
            function buildPath(values) {
                return values.map((v, i) =>
                    `${i === 0 ? 'M' : 'L'} ${xScale(i).toFixed(1)} ${yScale(v).toFixed(1)}`
                ).join(' ');
            }
            
            // Y ticks
            const yTicks = [];
            const yRange = yMax - yMin;
            let yStep;
            if (yRange >= 500000) yStep = 100000;
            else if (yRange >= 200000) yStep = 50000;
            else if (yRange >= 100000) yStep = 25000;
            else if (yRange >= 50000) yStep = 10000;
            else if (yRange >= 20000) yStep = 5000;
            else if (yRange >= 10000) yStep = 2000;
            else if (yRange >= 5000) yStep = 1000;
            else yStep = Math.ceil(yRange / 8 / 100) * 100 || 500;
            
            for (let v = Math.ceil(yMin / yStep) * yStep; v <= yMax; v += yStep) {
                yTicks.push(v);
            }
            
            // X ticks (monthly)
            const xTicks = [];
            const monthFirstIdx = {};
            dates.forEach((d, i) => {
                const [m] = d.split('-');
                if (!(m in monthFirstIdx)) {
                    monthFirstIdx[m] = i;
                    xTicks.push({ i, label: m });
                }
            });
            
            // Trade bands and markers
            function findNearestDateIdx(targetDate) {
                let idx = dates.findIndex(d => d === targetDate);
                if (idx >= 0) return idx;
                
                const [targetMonth, targetDay] = targetDate.split('-');
                const monthOrder = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                const targetMonthIdx = monthOrder.indexOf(targetMonth);
                const targetDayNum = parseInt(targetDay);
                
                for (let i = 0; i < dates.length; i++) {
                    const [m, d] = dates[i].split('-');
                    const mIdx = monthOrder.indexOf(m);
                    const dNum = parseInt(d);
                    if (mIdx > targetMonthIdx || (mIdx === targetMonthIdx && dNum >= targetDayNum)) {
                        return i;
                    }
                }
                return dates.length - 1;
            }
            
            let tradeMarkers = '';
            let investmentBands = '';
            trades.forEach(trade => {
                const entryIdx = findNearestDateIdx(trade.entry_date);
                const exitIdx = findNearestDateIdx(trade.exit_date);
                
                if (entryIdx >= 0 && exitIdx >= 0 && exitIdx > entryIdx) {
                    const x1 = xScale(entryIdx);
                    const x2 = xScale(exitIdx);
                    const bandWidth = x2 - x1;
                    
                    const entryValue = seasonalPnL[entryIdx];
                    const exitValue = seasonalPnL[exitIdx];
                    const tradeReturn = exitValue - entryValue;
                    const tradeReturnPct = (tradeReturn / capital) * 100;
                    const isProfit = tradeReturn >= 0;
                    
                    const bandColor = isProfit ? '#00ff88' : '#ff4466';
                    const textColor = isProfit ? '#00cc66' : '#cc3355';
                    
                    const labelY = isProfit ? (padding.top + chartHeight - 6) : (padding.top + 14);
                    const pctY = isProfit ? (padding.top + chartHeight - 18) : (padding.top + 26);
                    
                    investmentBands += `<rect x="${x1}" y="${padding.top}" width="${bandWidth}" height="${chartHeight}" fill="${bandColor}" opacity="0.12"/>`;
                    tradeMarkers += `<text x="${x1 + 3}" y="${labelY}" fill="${textColor}" font-size="8" font-weight="bold" text-anchor="start">BUY</text>`;
                    tradeMarkers += `<text x="${x2 - 3}" y="${labelY}" fill="${textColor}" font-size="8" font-weight="bold" text-anchor="end">SELL</text>`;
                    
                    const pctText = (tradeReturnPct >= 0 ? '+' : '') + tradeReturnPct.toFixed(1) + '%';
                    const midX = (x1 + x2) / 2;
                    tradeMarkers += `<text x="${midX}" y="${pctY}" fill="${textColor}" font-size="9" font-weight="bold" text-anchor="middle">${pctText}</text>`;
                }
            });
            
            const formatCurrency = (v) => {
                const abs = Math.abs(v);
                const sign = v < 0 ? '-' : (v > 0 ? '+' : '');
                if (abs >= 100000) return sign + '\u20B9' + (abs / 100000).toFixed(1) + 'L';
                if (abs >= 1000) return sign + '\u20B9' + (abs / 1000).toFixed(0) + 'K';
                return sign + '\u20B9' + abs.toFixed(0);
            };
            
            const svg = `
                <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
                    ${investmentBands}
                    ${xTicks.map(t => `
                        <line x1="${xScale(t.i)}" y1="${padding.top}" x2="${xScale(t.i)}" y2="${padding.top + chartHeight}"
                              stroke="#444" stroke-width="0.5" opacity="0.5"/>
                    `).join('')}
                    ${yTicks.map(v => `
                        <line x1="${padding.left}" y1="${yScale(v)}" x2="${width - padding.right}" y2="${yScale(v)}"
                              stroke="${v === 0 ? '#666' : '#333'}" stroke-width="${v === 0 ? 2 : 1}"/>
                    `).join('')}
                    ${yTicks.map(v => `
                        <text x="${padding.left - 8}" y="${yScale(v) + 4}" fill="#888" font-size="10" text-anchor="end">
                            ${formatCurrency(v)}
                        </text>
                    `).join('')}
                    ${xTicks.map(t => `
                        <text x="${xScale(t.i)}" y="${height - padding.bottom + 16}" fill="#888" font-size="10" text-anchor="middle">
                            ${t.label}
                        </text>
                    `).join('')}
                    <path d="${buildPath(bhPnL)}" fill="none" stroke="#6699ff" stroke-width="1.25" opacity="0.8"/>
                    <path d="${buildPath(seasonalPnL)}" fill="none" stroke="#00ff88" stroke-width="1.25"/>
                    ${tradeMarkers}
                    <text x="${width - padding.right + 4}" y="${yScale(seasonalPnL[seasonalPnL.length - 1]) + 4}"
                          fill="#00ff88" font-size="10" font-weight="bold">
                        ${formatCurrency(seasonalPnL[seasonalPnL.length - 1])}
                    </text>
                    <text x="${width - padding.right + 4}" y="${yScale(bhPnL[bhPnL.length - 1]) + 4}"
                          fill="#6699ff" font-size="10">
                        ${formatCurrency(bhPnL[bhPnL.length - 1])}
                    </text>
                </svg>
            `;
            
            windowChart.innerHTML = svg;
            
            // Metrics
            const finalSeasonal = seasonalPnL[seasonalPnL.length - 1];
            const finalBH = bhPnL[bhPnL.length - 1];
            const maxDrawdown = Math.min(...seasonalPnL);
            const daysInMarket = trades.reduce((sum, t) => sum + t.days, 0);
            const warning = data.warning || null;
            
            windowChartMetrics.innerHTML = `
                ${warning ? `<div style="width:100%;text-align:center;color:#ff9944;font-size:11px;padding:2px 0;">${warning}</div>` : ''}
                <div class="metric">
                    <span class="label">P&L:</span>
                    <span class="${finalSeasonal >= 0 ? 'positive' : 'negative'}">${formatCurrency(finalSeasonal)}</span>
                </div>
                <div class="metric">
                    <span class="label">B&H:</span>
                    <span class="${finalBH >= 0 ? 'positive' : 'negative'}">${formatCurrency(finalBH)}</span>
                </div>
                <div class="metric">
                    <span class="label">Drawdown:</span>
                    <span class="${maxDrawdown >= 0 ? 'positive' : 'negative'}">${formatCurrency(maxDrawdown)}</span>
                </div>
                <div class="metric">
                    <span class="label">Days:</span>
                    <span>${daysInMarket} / 365</span>
                </div>
                <div class="metric">
                    <span class="label">Trades:</span>
                    <span>${trades.length}</span>
                </div>
            `;
        }
        
        function renderTradesTable(data) {
            const { trades, summary: sum, years } = data;
            
            // Build header with fixed column widths
            const headerRow = tradesTable.querySelector('thead tr');
            headerRow.innerHTML = '<th class="col-entry">Entry</th><th class="col-exit">Exit</th><th class="col-profit">Profit</th><th class="col-days">Days</th><th class="col-bps">Yield/day</th>';
            years.slice().reverse().forEach(year => {
                headerRow.innerHTML += `<th class="col-year">${year}</th>`;
            });
            
            // Build body
            const tbody = tradesTable.querySelector('tbody');
            tbody.innerHTML = '';
            
            if (trades.length === 0) {
                const tr = document.createElement('tr');
                tr.innerHTML = `<td colspan="${5 + years.length}">No green runs detected</td>`;
                tbody.appendChild(tr);
                summary.innerHTML = '';
                return;
            }
            
            trades.forEach(trade => {
                const tr = document.createElement('tr');
                
                tr.innerHTML = `<td class="col-entry">${trade.entry_date}</td>`;
                tr.innerHTML += `<td class="col-exit">${trade.exit_date}</td>`;
                tr.innerHTML += `<td class="col-profit ${trade.avg_profit >= 0 ? 'positive' : 'negative'}">${Math.abs(trade.avg_profit).toFixed(1)}%</td>`;
                tr.innerHTML += `<td class="col-days">${trade.days}</td>`;
                const bpsPerDay = (trade.avg_profit / trade.days) * 100;
                tr.innerHTML += `<td class="col-bps ${bpsPerDay >= 0 ? 'positive' : 'negative'}">${Math.abs(bpsPerDay).toFixed(1)}</td>`;
                
                years.slice().reverse().forEach(year => {
                    const val = trade.years[year];
                    if (val !== null) {
                        const cls = val >= 0 ? 'positive' : 'negative';
                        tr.innerHTML += `<td class="col-year ${cls}">${Math.abs(val).toFixed(1)}%</td>`;
                    } else {
                        tr.innerHTML += `<td class="col-year dim">-</td>`;
                    }
                });
                
                tbody.appendChild(tr);
            });
            
            // Render summary as table
            const profitClass = sum.avg_profit >= 0 ? 'positive' : 'negative';
            const bhClass = sum.bh_profit >= 0 ? 'positive' : 'negative';
            const profitSign = sum.avg_profit >= 0 ? '' : '-';
            const bhSign = sum.bh_profit >= 0 ? '' : '-';
            
            // Calculate bps/day
            const seasonalBps = (sum.avg_profit / sum.avg_days) * 100;
            const bhBps = (sum.bh_profit / 365) * 100;
            const edgeBps = seasonalBps - bhBps;
            
            const seasonalBpsClass = seasonalBps >= 0 ? 'positive' : 'negative';
            const bhBpsClass = bhBps >= 0 ? 'positive' : 'negative';
            const edgeBpsClass = edgeBps >= 0 ? 'positive' : 'negative';
            const edgeBpsSign = edgeBps >= 0 ? '+' : '-';
            
            // Store years for backtest
            window.backtestYears = years;
            
            // Show the strategy action buttons
            document.getElementById('strategy-actions').style.display = 'flex';
            
            summary.innerHTML = `
                <table>
                    <tr>
                        <td class="label">Seasonal</td>
                        <td>${sum.avg_days} days</td>
                        <td class="${profitClass}">${profitSign}${Math.abs(sum.avg_profit).toFixed(1)}%</td>
                        <td class="${seasonalBpsClass}">${Math.abs(seasonalBps).toFixed(1)} bps/day</td>
                    </tr>
                    <tr>
                        <td class="label">B&H</td>
                        <td>365 days</td>
                        <td class="${bhClass}">${bhSign}${Math.abs(sum.bh_profit).toFixed(1)}%</td>
                        <td class="${bhBpsClass}">${Math.abs(bhBps).toFixed(1)} bps/day</td>
                    </tr>
                    <tr>
                        <td class="label">Edge</td>
                        <td></td>
                        <td></td>
                        <td class="${edgeBpsClass}">${edgeBpsSign}${Math.abs(edgeBps).toFixed(1)} bps/day</td>
                    </tr>
                </table>
            `;
        }
        
        function exportCSV(type) {
            // Export not available in window mode
            setStatus('Export not available in window mode', true);
        }
        
        function showSpinner() {
            spinner.classList.add('show');
            loadBtn.disabled = true;
        }
        
        function hideSpinner() {
            spinner.classList.remove('show');
            loadBtn.disabled = false;
        }
        
        function setStatus(msg, isError = false) {
            status.textContent = msg;
            status.classList.toggle('error', isError);
        }
        
        // Multi-select functionality
        const multiOverlay = document.getElementById('multi-overlay');
        const multiSearchInput = document.getElementById('multi-search-input');
        const multiList = document.getElementById('multi-list');
        const multiChips = document.getElementById('multi-chips');
        const multiSelected = document.getElementById('multi-selected');
        const multiCount = document.getElementById('multi-count');
        
        let selectedSymbols = [];  // Array of {symbol, name}
        let multiSearchResults = [];
        
        // Open multi-select overlay
        document.getElementById('multi-btn').addEventListener('click', () => {
            // Parse current symbols from input
            const currentSymbols = symbolInput.value.split(',').map(s => s.trim().toUpperCase()).filter(s => s);
            selectedSymbols = currentSymbols.map(s => ({ symbol: s, name: '' }));
            openMultiOverlay();
        });
        
        // Close buttons
        document.getElementById('multi-close-btn').addEventListener('click', closeMultiOverlay);
        document.getElementById('multi-cancel-btn').addEventListener('click', closeMultiOverlay);
        
        // Clear all
        document.getElementById('multi-clear-btn').addEventListener('click', () => {
            selectedSymbols = [];
            updateMultiUI();
            renderMultiList(multiSearchResults);
        });
        
        // Apply selection
        document.getElementById('multi-apply-btn').addEventListener('click', () => {
            if (selectedSymbols.length > 0) {
                symbolInput.value = selectedSymbols.map(s => displaySymbol(s.symbol)).join(',');
                state.symbol = selectedSymbols.map(s => s.symbol).join(',');
            }
            closeMultiOverlay();
            loadData();
        });
        
        // Search input
        multiSearchInput.addEventListener('input', async (e) => {
            const query = e.target.value.trim();
            if (query.length < 1) {
                multiSearchResults = [];
                renderMultiList([]);
                return;
            }
            
            try {
                const res = await fetch(`/api/symbols?q=${encodeURIComponent(query)}`);
                const data = await res.json();
                multiSearchResults = data;
                renderMultiList(data);
            } catch (err) {
                multiSearchResults = [];
                renderMultiList([]);
            }
        });
        
        // Click outside to close
        multiOverlay.addEventListener('click', (e) => {
            if (e.target === multiOverlay) {
                closeMultiOverlay();
            }
        });
        
        function openMultiOverlay() {
            multiSearchInput.value = '';
            multiSearchResults = [];
            updateMultiUI();
            renderMultiList([]);
            multiOverlay.classList.add('show');
            multiSearchInput.focus();
        }
        
        function closeMultiOverlay() {
            multiOverlay.classList.remove('show');
        }
        
        function updateMultiUI() {
            // Update count
            multiCount.textContent = `${selectedSymbols.length}/5 selected`;
            
            // Update chips
            if (selectedSymbols.length > 0) {
                multiSelected.classList.add('show');
                multiChips.innerHTML = selectedSymbols.map(s => `
                    <div class="multi-chip">
                        <span>${displaySymbol(s.symbol)}</span>
                        <span class="remove" data-symbol="${s.symbol}">&times;</span>
                    </div>
                `).join('');
                
                // Add remove handlers
                multiChips.querySelectorAll('.remove').forEach(el => {
                    el.addEventListener('click', (e) => {
                        const sym = e.target.dataset.symbol;
                        selectedSymbols = selectedSymbols.filter(s => s.symbol !== sym);
                        updateMultiUI();
                        renderMultiList(multiSearchResults);
                    });
                });
            } else {
                multiSelected.classList.remove('show');
                multiChips.innerHTML = '';
            }
        }
        
        function renderMultiList(items) {
            // Filter out already selected from search results
            const selectedSymbolSet = new Set(selectedSymbols.map(s => s.symbol));
            const unselectedItems = items.filter(item => !selectedSymbolSet.has(item.symbol));
            
            // Build list: only show unselected items (selected shown as chips above)
            let html = '';
            
            // Show search results (excluding selected)
            unselectedItems.forEach(item => {
                const disabled = selectedSymbols.length >= 5 ? 'disabled' : '';
                html += `
                    <div class="multi-item ${disabled}" data-symbol="${item.symbol}" data-name="${item.name}">
                        <input type="checkbox" ${disabled}>
                        <span class="symbol">${displaySymbol(item.symbol)}</span>
                        <span class="name">${item.name}</span>
                    </div>
                `;
            });
            
            if (html === '' && items.length === 0) {
                const msg = selectedSymbols.length > 0 
                    ? 'Type to search and add more stocks...'
                    : 'Type to search for stocks, indices, or ETFs...';
                multiList.innerHTML = `<div style="padding: 16px; color: #666;">${msg}</div>`;
            } else if (html === '' && items.length > 0) {
                multiList.innerHTML = '<div style="padding: 16px; color: #666;">All results already selected</div>';
            } else {
                multiList.innerHTML = html;
            }
            
            // Add click handlers
            multiList.querySelectorAll('.multi-item').forEach(el => {
                el.addEventListener('click', (e) => {
                    if (el.classList.contains('disabled')) return;
                    
                    const symbol = el.dataset.symbol;
                    const name = el.dataset.name;
                    
                    // Select (if under limit)
                    if (selectedSymbols.length < 5) {
                        selectedSymbols.push({ symbol, name });
                        updateMultiUI();
                        renderMultiList(multiSearchResults);
                    }
                });
            });
        }
        
        // =====================
        // Backtest functionality
        // =====================
        const backtestOverlay = document.getElementById('backtest-overlay');
        const backtestYearSelect = document.getElementById('backtest-year-select');
        const backtestCapitalSelect = document.getElementById('backtest-capital-select');
        const backtestChart = document.getElementById('backtest-chart');
        const backtestMetrics = document.getElementById('backtest-metrics');
        const backtestTitle = document.getElementById('backtest-title');
        
        document.getElementById('backtest-close-btn').addEventListener('click', closeBacktest);
        backtestOverlay.addEventListener('click', (e) => {
            if (e.target === backtestOverlay) closeBacktest();
        });
        
        backtestYearSelect.addEventListener('change', loadBacktestData);
        backtestCapitalSelect.addEventListener('change', loadBacktestData);
        
        function showBacktest() {
            // Backtest not available in window mode
            setStatus('Backtest not available in window mode', true);
        }
        
        function closeBacktest() {
            backtestOverlay.classList.remove('show');
        }
        
        async function loadBacktestData() {
            // Disabled in window mode
        }
        
        function renderBacktestChart(data, capital) {
            const { seasonal_curve, bh_curve, trades, dates } = data;
            
            // Chart dimensions
            const container = backtestChart.getBoundingClientRect();
            const width = container.width - 40;
            const height = container.height - 40;
            const padding = { top: 30, right: 60, bottom: 40, left: 70 };
            const chartWidth = width - padding.left - padding.right;
            const chartHeight = height - padding.top - padding.bottom;
            
            // Scale profit percentages to actual P&L
            const seasonalPnL = seasonal_curve.map(p => (p / 100) * capital);
            const bhPnL = bh_curve.map(p => (p / 100) * capital);
            
            // Find min/max for Y axis - scale to fit actual data with 10% padding
            const allValues = [...seasonalPnL, ...bhPnL];
            const dataMin = Math.min(...allValues, 0);  // Always include 0
            const dataMax = Math.max(...allValues, 0);
            const range = dataMax - dataMin || 1;
            const yMin = dataMin - range * 0.1;
            const yMax = dataMax + range * 0.1;
            
            // X scale
            const xScale = (i) => padding.left + (i / (dates.length - 1)) * chartWidth;
            
            // Y scale
            const yScale = (v) => padding.top + chartHeight - ((v - yMin) / (yMax - yMin)) * chartHeight;
            
            // Build SVG path
            function buildPath(values) {
                return values.map((v, i) => 
                    `${i === 0 ? 'M' : 'L'} ${xScale(i).toFixed(1)} ${yScale(v).toFixed(1)}`
                ).join(' ');
            }
            
            // Generate Y axis ticks - smart step sizing
            const yTicks = [];
            const yRange = yMax - yMin;
            // Choose step based on range magnitude
            let yStep;
            if (yRange >= 500000) yStep = 100000;
            else if (yRange >= 200000) yStep = 50000;
            else if (yRange >= 100000) yStep = 25000;
            else if (yRange >= 50000) yStep = 10000;
            else if (yRange >= 20000) yStep = 5000;
            else if (yRange >= 10000) yStep = 2000;
            else if (yRange >= 5000) yStep = 1000;
            else yStep = Math.ceil(yRange / 8 / 100) * 100 || 500;
            
            for (let v = Math.ceil(yMin / yStep) * yStep; v <= yMax; v += yStep) {
                yTicks.push(v);
            }
            
            // Generate X axis ticks (monthly) - show all months
            const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const xTicks = [];
            const monthFirstIdx = {};  // Track first occurrence of each month
            dates.forEach((d, i) => {
                const [m, day] = d.split('-');
                if (!(m in monthFirstIdx)) {
                    monthFirstIdx[m] = i;
                    xTicks.push({ i, label: m });
                }
            });
            
            // Check if there are any wraparound trades - if so, add Jan+ at the end
            let hasWraparound = false;
            trades.forEach(trade => {
                const entryMonth = trade.entry_date.split('-')[0];
                const exitMonth = trade.exit_date.split('-')[0];
                if (monthLabels.indexOf(exitMonth) < monthLabels.indexOf(entryMonth)) {
                    hasWraparound = true;
                }
            });
            if (hasWraparound) {
                xTicks.push({ i: dates.length - 1, label: 'Jan+', isWraparound: true });
            }
            
            // Build trade markers and investment bands
            // Helper to find nearest trading day index for a date like "Mar-6"
            function findNearestDateIdx(targetDate) {
                // First try exact match
                let idx = dates.findIndex(d => d === targetDate);
                if (idx >= 0) return idx;
                
                // Parse target date
                const [targetMonth, targetDay] = targetDate.split('-');
                const monthOrder = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                const targetMonthIdx = monthOrder.indexOf(targetMonth);
                const targetDayNum = parseInt(targetDay);
                
                // Find closest date on or after target
                for (let i = 0; i < dates.length; i++) {
                    const [m, d] = dates[i].split('-');
                    const mIdx = monthOrder.indexOf(m);
                    const dNum = parseInt(d);
                    if (mIdx > targetMonthIdx || (mIdx === targetMonthIdx && dNum >= targetDayNum)) {
                        return i;
                    }
                }
                return dates.length - 1;  // fallback to last date
            }
            
            let tradeMarkers = '';
            let investmentBands = '';
            trades.forEach(trade => {
                const entryIdx = findNearestDateIdx(trade.entry_date);
                let exitIdx = findNearestDateIdx(trade.exit_date);
                
                // Check for wraparound trade (exit month before entry month = next year)
                const monthOrder = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                const entryMonth = trade.entry_date.split('-')[0];
                const exitMonth = trade.exit_date.split('-')[0];
                const isWraparound = monthOrder.indexOf(exitMonth) < monthOrder.indexOf(entryMonth);
                
                // For wraparound trades, extend to end of year
                if (isWraparound) {
                    exitIdx = dates.length - 1;
                }
                
                if (entryIdx >= 0 && exitIdx >= 0 && exitIdx > entryIdx) {
                    const x1 = xScale(entryIdx);
                    const x2 = xScale(exitIdx);
                    const bandWidth = x2 - x1;
                    
                    // Calculate return for this trade period
                    const entryValue = seasonalPnL[entryIdx];
                    const exitValue = seasonalPnL[exitIdx];
                    const tradeReturn = exitValue - entryValue;
                    const tradeReturnPct = (tradeReturn / capital) * 100;
                    const isProfit = tradeReturn >= 0;
                    
                    // Band color based on profit/loss
                    const bandColor = isProfit ? '#00ff88' : '#ff4466';
                    const textColor = isProfit ? '#00cc66' : '#cc3355';
                    
                    // Labels at bottom for profit, top for loss
                    const labelY = isProfit ? (padding.top + chartHeight - 8) : (padding.top + 16);
                    const pctY = isProfit ? (padding.top + chartHeight - 22) : (padding.top + 30);
                    
                    // Draw investment band
                    investmentBands += `<rect x="${x1}" y="${padding.top}" width="${bandWidth}" height="${chartHeight}" fill="${bandColor}" opacity="0.12"/>`;
                    
                    // BUY label on left side of band
                    tradeMarkers += `<text x="${x1 + 3}" y="${labelY}" fill="${textColor}" font-size="9" font-weight="bold" text-anchor="start">BUY</text>`;
                    
                    // SELL label on right side of band (show exit date for wraparound)
                    const sellLabel = isWraparound ? `SELL ${trade.exit_date}` : 'SELL';
                    tradeMarkers += `<text x="${x2 - 3}" y="${labelY}" fill="${textColor}" font-size="9" font-weight="bold" text-anchor="end">${sellLabel}</text>`;
                    
                    // Percentage in the middle
                    const pctText = (tradeReturnPct >= 0 ? '+' : '') + tradeReturnPct.toFixed(1) + '%';
                    const midX = (x1 + x2) / 2;
                    tradeMarkers += `<text x="${midX}" y="${pctY}" fill="${textColor}" font-size="10" font-weight="bold" text-anchor="middle">${pctText}</text>`;
                }
            });
            
            // Format currency
            const formatCurrency = (v) => {
                const abs = Math.abs(v);
                const sign = v < 0 ? '-' : (v > 0 ? '+' : '');
                if (abs >= 100000) return sign + '₹' + (abs / 100000).toFixed(1) + 'L';
                if (abs >= 1000) return sign + '₹' + (abs / 1000).toFixed(0) + 'K';
                return sign + '₹' + abs.toFixed(0);
            };
            
            const svg = `
                <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
                    <!-- Investment bands (behind everything) -->
                    ${investmentBands}
                    
                    <!-- Vertical grid lines (monthly) -->
                    ${xTicks.map(t => `
                        <line x1="${xScale(t.i)}" y1="${padding.top}" x2="${xScale(t.i)}" y2="${padding.top + chartHeight}" 
                              stroke="#444" stroke-width="0.5" opacity="0.5"/>
                    `).join('')}
                    
                    <!-- Horizontal grid lines -->
                    ${yTicks.map(v => `
                        <line x1="${padding.left}" y1="${yScale(v)}" x2="${width - padding.right}" y2="${yScale(v)}" 
                              stroke="${v === 0 ? '#666' : '#333'}" stroke-width="${v === 0 ? 2 : 1}"/>
                    `).join('')}
                    
                    <!-- Y axis labels -->
                    ${yTicks.map(v => `
                        <text x="${padding.left - 10}" y="${yScale(v) + 4}" fill="#888" font-size="11" text-anchor="end">
                            ${formatCurrency(v)}
                        </text>
                    `).join('')}
                    
                    <!-- X axis labels -->
                    ${xTicks.map(t => `
                        <text x="${xScale(t.i)}" y="${height - padding.bottom + 20}" fill="#888" font-size="11" text-anchor="middle">
                            ${t.label}
                        </text>
                    `).join('')}
                    
                    <!-- Buy & Hold line -->
                    <path d="${buildPath(bhPnL)}" fill="none" stroke="#6699ff" stroke-width="1.25" opacity="0.8"/>
                    
                    <!-- Seasonal strategy line -->
                    <path d="${buildPath(seasonalPnL)}" fill="none" stroke="#00ff88" stroke-width="1.25"/>
                    
                    <!-- Trade markers -->
                    ${tradeMarkers}
                    
                    <!-- Final values -->
                    <text x="${width - padding.right + 5}" y="${yScale(seasonalPnL[seasonalPnL.length - 1]) + 4}" 
                          fill="#00ff88" font-size="12" font-weight="bold">
                        ${formatCurrency(seasonalPnL[seasonalPnL.length - 1])}
                    </text>
                    <text x="${width - padding.right + 5}" y="${yScale(bhPnL[bhPnL.length - 1]) + 4}" 
                          fill="#6699ff" font-size="12">
                        ${formatCurrency(bhPnL[bhPnL.length - 1])}
                    </text>
                </svg>
            `;
            
            backtestChart.innerHTML = svg;
            
            // Update metrics
            const finalSeasonal = seasonalPnL[seasonalPnL.length - 1];
            const finalBH = bhPnL[bhPnL.length - 1];
            const maxDrawdown = Math.min(...seasonalPnL);
            const daysInMarket = trades.reduce((sum, t) => sum + t.days, 0);
            const warning = data.warning || null;
            
            backtestMetrics.innerHTML = `
                ${warning ? `<div class="backtest-warning">${warning}</div>` : ''}
                <div class="backtest-metric">
                    <span class="label">Seasonal P&L:</span>
                    <span class="${finalSeasonal >= 0 ? 'positive' : 'negative'}">${formatCurrency(finalSeasonal)}</span>
                </div>
                <div class="backtest-metric">
                    <span class="label">B&H P&L:</span>
                    <span class="${finalBH >= 0 ? 'positive' : 'negative'}">${formatCurrency(finalBH)}</span>
                </div>
                <div class="backtest-metric">
                    <span class="label">Max Drawdown:</span>
                    <span class="${maxDrawdown >= 0 ? 'positive' : 'negative'}">${formatCurrency(maxDrawdown)}</span>
                </div>
                <div class="backtest-metric">
                    <span class="label">Days in Market:</span>
                    <span>${daysInMarket} / 365</span>
                </div>
                <div class="backtest-metric">
                    <span class="label">Trades:</span>
                    <span>${trades.length}</span>
                </div>
            `;
        }
        
        // =====================
        // Plan Builder functionality
        // =====================
        const planOverlay = document.getElementById('plan-overlay');
        const planStrategiesList = document.getElementById('plan-strategies-list');
        const planStrategyCount = document.getElementById('plan-strategy-count');
        const planYearSelect = document.getElementById('plan-year-select');
        const planCapitalSelect = document.getElementById('plan-capital-select');
        const planChart = document.getElementById('plan-chart');
        const planMetrics = document.getElementById('plan-metrics');
        const planBadge = document.getElementById('plan-badge');
        const showPlanBtn = document.getElementById('show-plan-btn');
        
        // Load plan from localStorage
        function loadPlan() {
            const saved = localStorage.getItem('meguru_plan');
            return saved ? JSON.parse(saved) : [];
        }
        
        // Save plan to localStorage
        function savePlan(plan) {
            localStorage.setItem('meguru_plan', JSON.stringify(plan));
            updatePlanBadge();
        }
        
        // Update the badge count in header
        function updatePlanBadge() {
            const plan = loadPlan();
            if (plan.length > 0) {
                planBadge.textContent = plan.length;
                planBadge.style.display = 'inline';
                showPlanBtn.classList.add('has-items');
            } else {
                planBadge.style.display = 'none';
                showPlanBtn.classList.remove('has-items');
            }
        }
        
        // Add current strategy to plan
        function addToPlan() {
            // Disabled in window mode
            setStatus('Add to plan not available in window mode', true);
        }
        
        // Remove strategy from plan
        function removeFromPlan(index) {
            const plan = loadPlan();
            plan.splice(index, 1);
            savePlan(plan);
            renderPlanStrategies();
            if (plan.length > 0) {
                loadPlanBacktest();
            } else {
                planChart.innerHTML = '<div style="padding: 20px; color: #666; text-align: center;">Add strategies to see combined backtest</div>';
                planMetrics.innerHTML = '';
            }
        }
        
        // Open plan overlay
        function openPlanOverlay() {
            renderPlanStrategies();
            populatePlanYears();
            planOverlay.classList.add('show');
            if (loadPlan().length > 0) {
                loadPlanBacktest();
            }
        }
        
        // Close plan overlay
        function closePlanOverlay() {
            planOverlay.classList.remove('show');
        }
        
        // Render strategy list
        function renderPlanStrategies() {
            const plan = loadPlan();
            planStrategyCount.textContent = `${plan.length} strateg${plan.length === 1 ? 'y' : 'ies'}`;
            
            if (plan.length === 0) {
                planStrategiesList.innerHTML = '<div class="plan-empty">No strategies added yet. Analyze a stock and click "Add to Plan".</div>';
                return;
            }
            
            planStrategiesList.innerHTML = plan.map((s, idx) => {
                const periodLabel = s.period === 'monthly' ? 'M' : 'W';
                return `
                    <div class="plan-strategy-item" data-index="${idx}">
                        <div class="plan-strategy-info">
                            <div class="plan-strategy-symbol">${displaySymbol(s.symbol)}</div>
                            <div class="plan-strategy-params">${periodLabel} | offset: ${s.offset} | threshold: ${s.threshold}%</div>
                        </div>
                        <div class="plan-strategy-remove" data-index="${idx}">✕</div>
                    </div>
                `;
            }).join('');
            
            // Add remove handlers
            planStrategiesList.querySelectorAll('.plan-strategy-remove').forEach(el => {
                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    removeFromPlan(parseInt(el.dataset.index));
                });
            });
        }
        
        // Populate year dropdown with available years
        function populatePlanYears() {
            // Use years from last loaded data, or generate recent years
            const years = window.backtestYears || [];
            if (years.length === 0) {
                const currentYear = new Date().getFullYear();
                for (let y = currentYear - 1; y >= currentYear - 10; y--) {
                    years.push(y);
                }
            }
            
            planYearSelect.innerHTML = years.slice().reverse().map(y => 
                `<option value="${y}">${y}</option>`
            ).join('');
        }
        
        // Load combined backtest for all strategies
        async function loadPlanBacktest() {
            const plan = loadPlan();
            if (plan.length === 0) return;
            
            const year = parseInt(planYearSelect.value);
            const capital = parseInt(planCapitalSelect.value);
            
            if (!year) return;
            
            planChart.innerHTML = '<div style="padding: 20px; color: #888; text-align: center;">Loading...</div>';
            
            try {
                const params = new URLSearchParams({
                    strategies: JSON.stringify(plan),
                    year: year
                });
                
                const res = await fetch(`/api/plan/backtest?${params}`);
                const data = await res.json();
                
                if (data.error) {
                    planChart.innerHTML = `<div style="color: #ff4466; padding: 20px;">${data.error}</div>`;
                    return;
                }
                
                renderPlanChart(data, capital);
            } catch (err) {
                planChart.innerHTML = `<div style="color: #ff4466; padding: 20px;">Error: ${err.message}</div>`;
            }
        }
        
        // Render combined backtest chart
        function renderPlanChart(data, capital) {
            const { combined_curve, bh_curve, strategy_curves, trades_count, total_days, dates, trades } = data;
            
            // Chart dimensions
            const container = planChart.getBoundingClientRect();
            const width = container.width - 40;
            const height = container.height - 40;
            const padding = { top: 30, right: 60, bottom: 40, left: 70 };
            const chartWidth = width - padding.left - padding.right;
            const chartHeight = height - padding.top - padding.bottom;
            
            // Scale profit percentages to actual P&L
            const combinedPnL = combined_curve.map(p => (p / 100) * capital);
            const bhPnL = bh_curve.map(p => (p / 100) * capital);
            
            // Find min/max for Y axis
            const allValues = [...combinedPnL, ...bhPnL];
            const dataMin = Math.min(...allValues, 0);
            const dataMax = Math.max(...allValues, 0);
            const range = dataMax - dataMin || 1;
            const yMin = dataMin - range * 0.1;
            const yMax = dataMax + range * 0.1;
            
            // X scale
            const xScale = (i) => padding.left + (i / (dates.length - 1)) * chartWidth;
            
            // Y scale
            const yScale = (v) => padding.top + chartHeight - ((v - yMin) / (yMax - yMin)) * chartHeight;
            
            // Build SVG path
            function buildPath(values) {
                return values.map((v, i) => 
                    `${i === 0 ? 'M' : 'L'} ${xScale(i).toFixed(1)} ${yScale(v).toFixed(1)}`
                ).join(' ');
            }
            
            // Helper to find nearest trading day index for a date like "Mar-6"
            function findNearestDateIdx(targetDate) {
                // First try exact match
                let idx = dates.findIndex(d => d === targetDate);
                if (idx >= 0) return idx;
                
                // Parse target date
                const [targetMonth, targetDay] = targetDate.split('-');
                const monthOrder = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                const targetMonthIdx = monthOrder.indexOf(targetMonth);
                const targetDayNum = parseInt(targetDay);
                
                // Find closest date on or after target
                for (let i = 0; i < dates.length; i++) {
                    const [m, d] = dates[i].split('-');
                    const mIdx = monthOrder.indexOf(m);
                    const dNum = parseInt(d);
                    if (mIdx > targetMonthIdx || (mIdx === targetMonthIdx && dNum >= targetDayNum)) {
                        return i;
                    }
                }
                return dates.length - 1;
            }
            
            // Build investment bands from trades
            let investmentBands = '';
            let tradeMarkers = '';
            const monthOrder = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            
            if (trades && trades.length > 0) {
                trades.forEach(trade => {
                    const entryIdx = findNearestDateIdx(trade.entry_date);
                    let exitIdx = findNearestDateIdx(trade.exit_date);
                    
                    // Check for wraparound trade
                    const entryMonth = trade.entry_date.split('-')[0];
                    const exitMonth = trade.exit_date.split('-')[0];
                    const isWraparound = monthOrder.indexOf(exitMonth) < monthOrder.indexOf(entryMonth);
                    
                    if (isWraparound) {
                        exitIdx = dates.length - 1;
                    }
                    
                    if (entryIdx >= 0 && exitIdx >= 0 && exitIdx > entryIdx) {
                        const x1 = xScale(entryIdx);
                        const x2 = xScale(exitIdx);
                        const bandWidth = x2 - x1;
                        
                        // Calculate return for this trade period
                        const entryValue = combinedPnL[entryIdx];
                        const exitValue = combinedPnL[exitIdx];
                        const tradeReturn = exitValue - entryValue;
                        const tradeReturnPct = (tradeReturn / capital) * 100;
                        const isProfit = tradeReturn >= 0;
                        
                        // Band color based on profit/loss
                        const bandColor = isProfit ? '#9b59b6' : '#ff4466';
                        const textColor = isProfit ? '#9b59b6' : '#cc3355';
                        
                        // Labels at bottom for profit, top for loss
                        const labelY = isProfit ? (padding.top + chartHeight - 8) : (padding.top + 16);
                        const pctY = isProfit ? (padding.top + chartHeight - 22) : (padding.top + 30);
                        
                        // Draw investment band
                        investmentBands += `<rect x="${x1}" y="${padding.top}" width="${bandWidth}" height="${chartHeight}" fill="${bandColor}" opacity="0.12"/>`;
                        
                        // Symbol label on left side
                        const symbolLabel = trade.symbol ? trade.symbol.replace('.NS', '') : 'BUY';
                        tradeMarkers += `<text x="${x1 + 3}" y="${labelY}" fill="${textColor}" font-size="8" font-weight="bold" text-anchor="start">${symbolLabel}</text>`;
                        
                        // SELL label on right side (show exit date for wraparound)
                        const sellLabel = isWraparound ? `SELL ${trade.exit_date}` : 'SELL';
                        tradeMarkers += `<text x="${x2 - 3}" y="${labelY}" fill="${textColor}" font-size="8" font-weight="bold" text-anchor="end">${sellLabel}</text>`;
                        
                        // Percentage in the middle
                        const pctText = (tradeReturnPct >= 0 ? '+' : '') + tradeReturnPct.toFixed(1) + '%';
                        const midX = (x1 + x2) / 2;
                        tradeMarkers += `<text x="${midX}" y="${pctY}" fill="${textColor}" font-size="9" font-weight="bold" text-anchor="middle">${pctText}</text>`;
                    }
                });
            }
            
            // Generate Y axis ticks
            const yTicks = [];
            const yRange = yMax - yMin;
            let yStep;
            if (yRange >= 500000) yStep = 100000;
            else if (yRange >= 200000) yStep = 50000;
            else if (yRange >= 100000) yStep = 25000;
            else if (yRange >= 50000) yStep = 10000;
            else if (yRange >= 20000) yStep = 5000;
            else if (yRange >= 10000) yStep = 2000;
            else if (yRange >= 5000) yStep = 1000;
            else yStep = Math.ceil(yRange / 8 / 100) * 100 || 500;
            
            for (let v = Math.ceil(yMin / yStep) * yStep; v <= yMax; v += yStep) {
                yTicks.push(v);
            }
            
            // Generate X axis ticks (monthly)
            const xTicks = [];
            const monthFirstIdx = {};
            dates.forEach((d, i) => {
                const [m, day] = d.split('-');
                if (!(m in monthFirstIdx)) {
                    monthFirstIdx[m] = i;
                    xTicks.push({ i, label: m });
                }
            });
            
            // Check for wraparound trades and add Jan+ label
            let hasWraparound = false;
            if (trades) {
                trades.forEach(trade => {
                    const entryMonth = trade.entry_date.split('-')[0];
                    const exitMonth = trade.exit_date.split('-')[0];
                    if (monthOrder.indexOf(exitMonth) < monthOrder.indexOf(entryMonth)) {
                        hasWraparound = true;
                    }
                });
            }
            if (hasWraparound) {
                xTicks.push({ i: dates.length - 1, label: 'Jan+', isWraparound: true });
            }
            
            // Format currency
            const formatCurrency = (v) => {
                const abs = Math.abs(v);
                const sign = v < 0 ? '-' : (v > 0 ? '+' : '');
                if (abs >= 100000) return sign + '₹' + (abs / 100000).toFixed(1) + 'L';
                if (abs >= 1000) return sign + '₹' + (abs / 1000).toFixed(0) + 'K';
                return sign + '₹' + abs.toFixed(0);
            };
            
            const svg = `
                <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
                    <!-- Investment bands (behind everything) -->
                    ${investmentBands}
                    
                    <!-- Vertical grid lines (monthly) -->
                    ${xTicks.map(t => `
                        <line x1="${xScale(t.i)}" y1="${padding.top}" x2="${xScale(t.i)}" y2="${padding.top + chartHeight}" 
                              stroke="#444" stroke-width="0.5" opacity="0.5"/>
                    `).join('')}
                    
                    <!-- Horizontal grid lines -->
                    ${yTicks.map(v => `
                        <line x1="${padding.left}" y1="${yScale(v)}" x2="${width - padding.right}" y2="${yScale(v)}" 
                              stroke="${v === 0 ? '#666' : '#333'}" stroke-width="${v === 0 ? 2 : 1}"/>
                    `).join('')}
                    
                    <!-- Y axis labels -->
                    ${yTicks.map(v => `
                        <text x="${padding.left - 10}" y="${yScale(v) + 4}" fill="#888" font-size="11" text-anchor="end">
                            ${formatCurrency(v)}
                        </text>
                    `).join('')}
                    
                    <!-- X axis labels -->
                    ${xTicks.map(t => `
                        <text x="${xScale(t.i)}" y="${height - padding.bottom + 20}" fill="#888" font-size="11" text-anchor="middle">
                            ${t.label}
                        </text>
                    `).join('')}
                    
                    <!-- Buy & Hold line -->
                    <path d="${buildPath(bhPnL)}" fill="none" stroke="#6699ff" stroke-width="1.25" opacity="0.8"/>
                    
                    <!-- Combined strategy line -->
                    <path d="${buildPath(combinedPnL)}" fill="none" stroke="#9b59b6" stroke-width="2"/>
                    
                    <!-- Trade markers -->
                    ${tradeMarkers}
                    
                    <!-- Final values -->
                    <text x="${width - padding.right + 5}" y="${yScale(combinedPnL[combinedPnL.length - 1]) + 4}" 
                          fill="#9b59b6" font-size="12" font-weight="bold">
                        ${formatCurrency(combinedPnL[combinedPnL.length - 1])}
                    </text>
                    <text x="${width - padding.right + 5}" y="${yScale(bhPnL[bhPnL.length - 1]) + 4}" 
                          fill="#6699ff" font-size="12">
                        ${formatCurrency(bhPnL[bhPnL.length - 1])}
                    </text>
                </svg>
            `;
            
            planChart.innerHTML = svg;
            
            // Update metrics
            const finalCombined = combinedPnL[combinedPnL.length - 1];
            const finalBH = bhPnL[bhPnL.length - 1];
            const maxDrawdown = Math.min(...combinedPnL);
            
            planMetrics.innerHTML = `
                <div class="backtest-metric">
                    <span class="label">Combined P&L:</span>
                    <span class="${finalCombined >= 0 ? 'positive' : 'negative'}">${formatCurrency(finalCombined)}</span>
                </div>
                <div class="backtest-metric">
                    <span class="label">B&H P&L:</span>
                    <span class="${finalBH >= 0 ? 'positive' : 'negative'}">${formatCurrency(finalBH)}</span>
                </div>
                <div class="backtest-metric">
                    <span class="label">Max Drawdown:</span>
                    <span class="${maxDrawdown >= 0 ? 'positive' : 'negative'}">${formatCurrency(maxDrawdown)}</span>
                </div>
                <div class="backtest-metric">
                    <span class="label">Total Days:</span>
                    <span>${total_days} / 365</span>
                </div>
                <div class="backtest-metric">
                    <span class="label">Trade Entries:</span>
                    <span>${trades_count}</span>
                </div>
            `;
        }
        
        // Export unified trading calendar
        async function exportPlanCalendar() {
            const plan = loadPlan();
            if (plan.length === 0) {
                return;
            }
            
            const params = new URLSearchParams({
                strategies: JSON.stringify(plan)
            });
            
            window.location.href = `/api/plan/export?${params}`;
        }
        
        // Event listeners for plan
        showPlanBtn.addEventListener('click', openPlanOverlay);
        document.getElementById('plan-close-btn').addEventListener('click', closePlanOverlay);
        document.getElementById('plan-clear-btn').addEventListener('click', () => {
            savePlan([]);
            renderPlanStrategies();
            planChart.innerHTML = '<div style="padding: 20px; color: #666; text-align: center;">Add strategies to see combined backtest</div>';
            planMetrics.innerHTML = '';
        });
        document.getElementById('plan-export-btn').addEventListener('click', exportPlanCalendar);
        planYearSelect.addEventListener('change', loadPlanBacktest);
        planCapitalSelect.addEventListener('change', loadPlanBacktest);
        planOverlay.addEventListener('click', (e) => {
            if (e.target === planOverlay) closePlanOverlay();
        });
        
        // Initialize plan badge on load
        updatePlanBadge();
        
        // Initial load - only if symbol is set
        if (state.symbol) {
            loadData();
        } else {
            setStatus('Enter a symbol or use + Multi to select stocks');
        }
    </script>
</body>
</html>
"""


class MeguruHandler(BaseHTTPRequestHandler):
    """HTTP request handler for Meguru API."""
    
    def log_message(self, format, *args):
        """Override to customize logging."""
        print(f"[{self.log_date_time_string()}] {args[0]}")
    
    def send_json(self, data: dict, status: int = 200) -> None:
        """Send JSON response."""
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)
    
    def send_html(self, html: str) -> None:
        """Send HTML response."""
        body = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)
    
    def send_csv(self, content: str, filename: str) -> None:
        """Send CSV file download."""
        body = content.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/csv")
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)
    
    def parse_params(self) -> dict:
        """Parse query parameters from URL."""
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        return {k: v[0] if v else "" for k, v in params.items()}
    
    def do_GET(self) -> None:
        """Handle GET requests."""
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        
        if path == "/":
            self.send_html(HTML_PAGE)
        
        elif path == "/api/symbols":
            params = self.parse_params()
            query = params.get("q", "")
            results = search_symbols(query)
            self.send_json(results)
        
        elif path == "/api/stats":
            params = self.parse_params()
            try:
                symbols = parse_symbols(params.get("symbol", ""))
                period = params.get("period", "monthly")
                offset = int(params.get("offset", 0))
                threshold = int(params.get("threshold", 50))
                
                if not symbols:
                    self.send_json({"error": "No symbol provided"}, 400)
                    return
                
                result = get_stats(symbols, period, offset, threshold)
                self.send_json(result)
            except Exception as e:
                self.send_json({"error": str(e)}, 500)
        
        elif path == "/api/trades":
            params = self.parse_params()
            try:
                symbols = parse_symbols(params.get("symbol", ""))
                period = params.get("period", "monthly")
                offset = int(params.get("offset", 0))
                threshold = int(params.get("threshold", 50))
                
                if not symbols:
                    self.send_json({"error": "No symbol provided"}, 400)
                    return
                
                result = get_trades(symbols, period, offset, threshold)
                self.send_json(result)
            except Exception as e:
                self.send_json({"error": str(e)}, 500)
        
        elif path == "/api/export/stats":
            params = self.parse_params()
            try:
                symbols = parse_symbols(params.get("symbol", ""))
                period = params.get("period", "monthly")
                offset = int(params.get("offset", 0))
                threshold = int(params.get("threshold", 50))
                
                if not symbols:
                    self.send_json({"error": "No symbol provided"}, 400)
                    return
                
                symbol_label = "+".join(s.replace(".NS", "") for s in symbols)
                period_abbr = "M" if period == "monthly" else "W"
                filename = f"{symbol_label}-{period_abbr}+{offset}@{threshold}.stats.csv"
                
                content = export_stats_csv(symbols, period, offset, threshold)
                self.send_csv(content, filename)
            except Exception as e:
                self.send_json({"error": str(e)}, 500)
        
        elif path == "/api/export/trades":
            params = self.parse_params()
            try:
                symbols = parse_symbols(params.get("symbol", ""))
                period = params.get("period", "monthly")
                offset = int(params.get("offset", 0))
                threshold = int(params.get("threshold", 50))
                
                if not symbols:
                    self.send_json({"error": "No symbol provided"}, 400)
                    return
                
                symbol_label = "+".join(s.replace(".NS", "") for s in symbols)
                period_abbr = "M" if period == "monthly" else "W"
                filename = f"{symbol_label}-{period_abbr}+{offset}@{threshold}.trades.csv"
                
                content = export_trades_csv(symbols, period, offset, threshold)
                self.send_csv(content, filename)
            except Exception as e:
                self.send_json({"error": str(e)}, 500)
        
        elif path == "/api/export/strategy":
            params = self.parse_params()
            try:
                symbols = parse_symbols(params.get("symbol", ""))
                period = params.get("period", "monthly")
                offset = int(params.get("offset", 0))
                threshold = int(params.get("threshold", 50))
                
                if not symbols:
                    self.send_json({"error": "No symbol provided"}, 400)
                    return
                
                symbol_label = "+".join(s.replace(".NS", "") for s in symbols)
                period_abbr = "M" if period == "monthly" else "W"
                filename = f"{symbol_label}-{period_abbr}+{offset}@{threshold}.strategy.csv"
                
                content = export_strategy_csv(symbols, period, offset, threshold)
                self.send_csv(content, filename)
            except Exception as e:
                self.send_json({"error": str(e)}, 500)
        
        elif path == "/api/backtest":
            params = self.parse_params()
            try:
                symbols = parse_symbols(params.get("symbol", ""))
                period = params.get("period", "monthly")
                offset = int(params.get("offset", 0))
                threshold = int(params.get("threshold", 50))
                year = int(params.get("year", 2023))
                
                if not symbols:
                    self.send_json({"error": "No symbol provided"}, 400)
                    return
                
                result = get_backtest_data(symbols, period, offset, threshold, year)
                self.send_json(result)
            except Exception as e:
                self.send_json({"error": str(e)}, 500)
        
        elif path == "/api/optimize":
            params = self.parse_params()
            try:
                symbols = parse_symbols(params.get("symbol", ""))
                period = params.get("period", "monthly")
                optimize_for = params.get("optimize_for", "profit")  # "profit" or "yield"
                
                if not symbols:
                    self.send_json({"error": "No symbol provided"}, 400)
                    return
                
                result = find_optimal_trades(symbols, period, optimize_for)
                self.send_json(result)
            except Exception as e:
                self.send_json({"error": str(e)}, 500)
        
        elif path == "/api/plan/backtest":
            params = self.parse_params()
            try:
                strategies_json = params.get("strategies", "[]")
                strategies = json.loads(strategies_json)
                year = int(params.get("year", 2023))
                
                if not strategies:
                    self.send_json({"error": "No strategies provided"}, 400)
                    return
                
                result = get_plan_backtest_data(strategies, year)
                self.send_json(result)
            except json.JSONDecodeError:
                self.send_json({"error": "Invalid strategies JSON"}, 400)
            except Exception as e:
                self.send_json({"error": str(e)}, 500)
        
        elif path == "/api/plan/export":
            params = self.parse_params()
            try:
                strategies_json = params.get("strategies", "[]")
                strategies = json.loads(strategies_json)
                
                if not strategies:
                    self.send_json({"error": "No strategies provided"}, 400)
                    return
                
                content = export_plan_calendar_csv(strategies)
                filename = "trading-plan.csv"
                self.send_csv(content, filename)
            except json.JSONDecodeError:
                self.send_json({"error": "Invalid strategies JSON"}, 400)
            except Exception as e:
                self.send_json({"error": str(e)}, 500)
        
        elif path == "/api/windows":
            params = self.parse_params()
            try:
                symbols = parse_symbols(params.get("symbol", ""))
                window_size = int(params.get("window_size", 30))
                threshold = int(params.get("threshold", 50))
                
                if not symbols:
                    self.send_json({"error": "No symbol provided"}, 400)
                    return
                
                # For now, just use the first symbol
                symbol = symbols[0]
                df = load_symbol_data(symbol)
                
                if df.empty:
                    self.send_json({"error": f"No data found for {symbol}"}, 404)
                    return
                
                windows = detect_sliding_windows(
                    df,
                    window_size=window_size,
                    threshold=threshold / 100,  # Convert to 0-1
                )
                
                # Convert to JSON-serializable format
                result = {
                    "symbol": symbol,
                    "window_size": window_size,
                    "threshold": threshold,
                    "windows": [
                        {
                            "start_day": w.start_day,
                            "end_day": w.end_day,
                            "start_date": w.start_date_str,
                            "end_date": w.end_date_str,
                            "length": w.length,
                            "avg_return": round(w.avg_return, 2),
                            "win_rate": round(w.win_rate * 100, 0),
                            "score": round(w.score, 2),
                            "yield_per_day": round(w.yield_per_day * 100, 2),  # bps/day
                            "year_returns": {
                                str(k): round(v, 2) if v is not None else None
                                for k, v in w.year_returns.items()
                            }
                        }
                        for w in windows
                    ],
                    "total_days": sum(w.length for w in windows),
                    "total_return": round(sum(w.avg_return for w in windows), 2),
                }
                self.send_json(result)
            except Exception as e:
                self.send_json({"error": str(e)}, 500)
        
        elif path == "/api/windows/backtest":
            params = self.parse_params()
            try:
                symbols = parse_symbols(params.get("symbol", ""))
                window_size = int(params.get("window_size", 30))
                threshold = int(params.get("threshold", 50))
                year = int(params.get("year", 2024))
                
                if not symbols:
                    self.send_json({"error": "No symbol provided"}, 400)
                    return
                
                result = get_window_backtest_data(
                    symbols[0], window_size, threshold, year,
                )
                self.send_json(result)
            except Exception as e:
                self.send_json({"error": str(e)}, 500)
        
        else:
            self.send_response(404)
            self.end_headers()


def run_server() -> None:
    """Start the HTTP server."""
    server = HTTPServer((HOST, PORT), MeguruHandler)
    print(f"Meguru server running at http://{HOST}:{PORT}")
    print("Press Ctrl+C to stop")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.shutdown()


if __name__ == "__main__":
    run_server()
