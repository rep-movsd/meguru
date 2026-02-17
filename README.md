  # Meguru 巡る

**Seasonal Stock Pattern Detector**

*"Meguru" means "to cycle" or "to revolve" in Japanese, capturing the essence of recurring market patterns.*

> **Disclaimer**: This project was mostly developed by an LLM (Claude) with minimal code review by the repository owner. Use at your own risk.

A lightweight web application that identifies recurring seasonal investment windows in stock prices using a sliding window detection algorithm. Focused on Indian NSE stocks, it finds optimal N-day windows across 20 years of history, backtests strategies with equity curves and per-year breakdowns, and combines multiple stocks into unified trading baskets. Data is fetched from Yahoo Finance and cached locally as CSV.

## Architecture

```
meguru/
├── src/
│   ├── backend.py          # Core engine: data loading, sliding window detection,
│   │                       #   backtesting, basket builder, exports
│   ├── server.py           # HTTP server serving static files
│   ├── download_stocks.py  # NSE stock list downloader for autocomplete
│   └── static/
│       ├── index.html      # Main HTML page
│       ├── app.js          # Frontend JavaScript application
│       └── style.css       # CSS styles
├── data/
│   ├── stocks/
│   │   └── nse_stocks.csv  # 2,500+ NSE equities, indices, ETFs
│   ├── plans/              # Saved baskets as JSON files
│   └── *.csv               # Cached Yahoo Finance OHLC data per symbol
├── exports/                # Exported analysis CSVs
├── tests/
│   ├── test_app.py             # Unit tests for core backend, basket CRUD, bar chart data (98 tests)
│   ├── test_sliding_window.py  # Sliding window algorithm tests (32 tests)
│   └── test_sliding_quick.py   # Manual CLI script for inspecting results
├── requirements.txt        # pandas, numpy, yfinance, pytest
```

**Key design decisions:**
- No web framework -- uses Python stdlib `http.server`
- SVG charts rendered inline (no charting library)
- Local CSV caching with incremental Yahoo Finance updates
- Precomputed cumulative returns (`YearlyReturnsCache`) for O(1) window scoring

## Features

### Sliding Window Detection
- Fixed-size window scanning (1wk / 2wk / 1mo / 2mo / 3mo)
- Recursive range-splitting best-window selection
- Contiguous window merging (within 7-day gaps)
- Edge narrowing: trims weak boundary days to maximize score
- Per-year return breakdown with win rate scoring
- O(1) window return lookups via precomputed cumulative returns cache

### Backtesting
- **Line chart**: year-by-year or averaged equity curve with strategy vs Buy & Hold
- **Bar chart**: per-year strategy return vs B&H, side-by-side bars
- Days-in-market tracking (e.g. "120/252d")
- Shaded bands showing investment windows with BUY/SELL markers

### Basket Builder
- Combine strategies from multiple stocks into a unified trading basket
- Per-stock contribution bars in stacked bar chart view
- 16-color palette for strategy colors
- **Allocation modes**: Equal weight or Return-weighted
- **Capital options**: ₹1L / ₹5L / ₹10L
- **Hide/show** individual strategies without removing them
- **Basket overlap**: when adding a stock, shows how many days overlap with existing basket coverage and how many new days would be added
- **Save/Load/Delete** named baskets to server (`data/plans/*.json`)
- Baskets also stored in browser `localStorage` for persistence

### Exports
- **Trading Calendar CSV**: unified multi-stock trading calendar with optional window alignment (±2 days)
- Export triggered from Basket panel "Export Trading Calendar" button

### Data & Caching
- NSE symbol autocomplete (2,500+ stocks, indices, ETFs)
- Multi-stock selector (max 5) for equal-weighted basket synthesis
- Local CSV caching with auto-refresh from Yahoo Finance (20 years of history)
- Sparse data warning shown if year has <200 trading days
- `.NS` suffix added automatically for NSE stocks
- Supports indices (`^NSEI`, `^NSEBANK`) and ETFs

## Requirements

- Python 3.10+

## Quick Start

### Linux / macOS

```bash
cd meguru
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python src/server.py
```

### Windows

```powershell
cd meguru
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python src\server.py
```

### Windows (using py launcher)

```powershell
cd meguru
py -3.10 -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
py src\server.py
```

Open http://localhost:8000 in your browser.

### Running in Background

**Linux / macOS:**
```bash
nohup .venv/bin/python src/server.py > server.log 2>&1 &
```

**Windows (PowerShell):**
```powershell
Start-Process -NoNewWindow -FilePath ".venv\Scripts\python.exe" -ArgumentList "src\server.py"
```

### Stopping the Server

Press `Ctrl+C` in the terminal, or kill the process:

**Linux / macOS:**
```bash
pkill -f "python.*server.py"
```

**Windows:**
```powershell
taskkill /F /IM python.exe
```

### Updating the Stock List

```bash
python src/download_stocks.py
```

Downloads the latest NSE equities, indices (with Yahoo Finance symbol mappings), and ETFs into `data/stocks/nse_stocks.csv`. The stock list is included in the repository, so this is only needed for the latest additions.

---

# Usage Guide

## Loading Data

| Action | Method |
|--------|--------|
| Load symbol | Enter symbol (e.g., `RELIANCE`, `TCS`, `ICICIBANK`) and press Enter |
| Load basket | Enter comma-separated symbols (e.g., `TCS,INFY,WIPRO`) |
| Multi-stock selector | Click **+ Multi** to open a searchable stock picker (max 5) |

The `.NS` suffix is added automatically for NSE stocks.

## Main Screen Controls

| Control | Function |
|---------|----------|
| Window size dropdown | 1wk / 2wk / 1mo / 2mo / 3mo fixed window width |
| Threshold `[-]` `[+]` | Minimum win rate filter (50-100%). Higher = only strong windows |
| Year dropdown | Select specific year or "Average" for backtest |
| Line / Bar toggle | Switch between equity curve and per-year bar chart |
| + Add to Basket | Add current stock's detected windows to the basket |

## Window Detection Results

The stats table shows each detected window with:
- **Days**: day-of-year range (e.g., "Jan 15 - Feb 28")
- **Avg Return**: mean return across all years
- **Win Rate**: percentage of years with positive return
- **Score**: `avg_return × win_rate`

If a basket exists, a purple **Basket overlap** row shows coverage overlap and new days added.

## Backtest Views

### Line Chart
- Green line: strategy equity curve (investing only during detected windows)
- Blue line: Buy & Hold equity curve
- Green/red shaded bands: individual window periods with return %
- Purple bands: existing basket coverage (when overlap data available)
- Metrics: total return, CAGR, max drawdown, days in market

### Bar Chart
- Side-by-side bars per year: strategy return (green) vs B&H return (blue)
- Days-in-market label below each year
- Hover for exact values

## Basket Builder

### Adding Strategies
1. Load a stock, review its detected windows
2. Click **+ Add to Basket** to add it
3. Repeat for other stocks/parameters
4. Click **Basket** in header to open the basket overlay

### Basket Controls

| Control | Function |
|---------|----------|
| Line / Bar toggle | Equity curve or per-year stacked bars |
| Year dropdown | Year selection or "Average" |
| Capital dropdown | ₹1,00,000 / ₹5,00,000 / ₹10,00,000 |
| Alloc dropdown | Equal weight or Return-weighted allocation |

### Basket Bar Chart
Shows stacked bars where each stock's contribution is drawn in its assigned color. Legend shows allocation percentages when return-weighted mode is active.

### Dynamic Capital Allocation
On each trading day, capital is split among all active windows.

### Managing Strategies
- **Hide/Show**: Click "hide"/"show" on any strategy to exclude/include it from the backtest without deleting it
- **Remove**: Click the delete button to permanently remove a strategy from the basket
- **Save**: Save the basket with a name to the server for later retrieval
- **Load**: Load a previously saved basket (replaces current basket in localStorage)
- **Delete**: Remove a saved basket from the server

### Exporting
Click **Export Trading Calendar** to download a CSV trading calendar. The **Align windows** checkbox merges entry/exit dates within ±2 days of each other for cleaner execution.

---

# Methodology

## Sliding Window Detection

Uses `YearlyReturnsCache` with precomputed cumulative products for O(1) window return calculation:
- `cum_returns[year][doy]` = cumulative product from day 1 to day-of-year
- Window return = `cum[end] / cum[start-1] - 1`
- Score = `avg_return × win_rate` across all years

### Algorithm
1. Precomputes cumulative returns for all years
2. Starts with the full search range [1, 365]
3. Finds the best-scoring window of exactly N days in the range
4. That window splits the range into left and right sub-ranges
5. Recurses into each sub-range that can still fit a window
6. Merges nearby windows within 7-day gaps and recomputes merged stats
7. Narrows edges: iteratively trims boundary days that drag the score down

## Return-Weighted Allocation

When "Return-wtd" allocation mode is selected in basket:
1. Compute bar chart returns for each stock
2. Average each stock's per-year strategy returns
3. Apply a 5% floor so weak performers still get minimal allocation
4. Normalize to sum to 1.0
5. Apply weights as capital allocation proportions

---

# Limitations

1. **Past performance** does not guarantee future results
2. **Sample size**: ~19 years means even 71% trend = only ~13 confirming years
3. **Survivorship bias**: only currently-listed stocks are analyzed
4. **No transaction costs**: commissions, slippage, bid-ask spreads not modeled
5. **Tax implications**: frequent short-term trades may be tax-disadvantaged vs B&H
6. **Liquidity assumptions**: entry/exit at exact boundaries assumes perfect fills
7. **Lookahead bias**: visible patterns include knowledge of what worked; out-of-sample testing recommended
