# Meguru 巡る

**Seasonal Stock Pattern Detector**

*"Meguru" means "to cycle" or "to revolve" in Japanese, capturing the essence of recurring market patterns.*

A lightweight web application that downloads Yahoo Finance OHLC data, caches it locally, and identifies recurring seasonal investment windows in stock prices. Focused on Indian NSE stocks, it supports single symbols or equal-weighted baskets, simulates trading strategies, backtests performance, and exports CSV reports.

## Architecture

```
meguru/
├── src/
│   ├── backend.py          # Core engine: data loading, seasonal analysis,
│   │                       #   sliding window detection, trade simulation
│   ├── server.py           # HTTP server + embedded SPA (HTML/CSS/JS)
│   └── download_stocks.py  # NSE stock list downloader for autocomplete
├── data/
│   ├── stocks/
│   │   └── nse_stocks.csv  # 2,500+ NSE equities, indices, ETFs
│   ├── plans/              # Saved plans as JSON files
│   └── *.csv               # Cached Yahoo Finance OHLC data per symbol
├── exports/                # Exported analysis CSVs
├── tests/
│   ├── test_app.py         # Unit tests for core backend, plan CRUD, bar chart data
│   ├── test_sliding_window.py  # Sliding window algorithm tests
│   └── test_sliding_quick.py   # Manual CLI script for inspecting results
├── requirements.txt        # pandas, numpy, yfinance, pytest
```

**Key design decisions:**
- No web framework -- uses Python stdlib `http.server`
- Entire SPA frontend embedded as a string in `server.py`
- SVG charts rendered inline (no charting library)
- Local CSV caching with incremental Yahoo Finance updates
- Precomputed cumulative returns (`YearlyReturnsCache`) for O(1) window scoring

## Branch Status

| Branch | Description |
|--------|-------------|
| `main` | Stable release with period-based seasonal analysis (monthly/weekly) |
| `feature/sliding-window-detection` | **Active.** Adds fixed-size sliding window detection algorithm |

The `feature/sliding-window-detection` branch rewrites the analysis approach: instead of fixed calendar periods (months/weeks), it finds the optimal N-day investment windows using a recursive range-splitting algorithm with merging of nearby windows (within 7-day gaps) and edge narrowing to maximize score. The parameter optimizer and per-stock CSV exports are currently disabled in window mode; backtest charts, plan builder, and plan exports are fully functional.

## Features

### Seasonal Analysis (main branch)
- Weekly (52) and monthly (24) period analysis with configurable day offsets
- Trend likelihood and expected value (EV) calculations
- Run detection for consecutive bullish/bearish periods
- Trade simulation with annualized returns
- Visual backtesting with equity curves
- Parameter optimizer (max profit / max yield)
- Plan builder to combine multiple strategies
- Threshold filtering for signal strength
- Multiple export formats (stats, trades, strategy, plan)

### Sliding Window Detection (feature branch)
- Fixed-size window scanning (1wk / 2wk / 1mo / 2mo / 3mo)
- Recursive range-splitting best-window selection
- Contiguous window merging (within 7-day gaps)
- Edge narrowing: trims weak boundary days to maximize score
- Per-year return breakdown with win rate scoring
- O(1) window return lookups via precomputed cumulative returns cache
- Inline backtest chart (year-by-year or average) with equity curves
- Bar chart view: per-year strategy vs B&H returns side-by-side
- Plan builder with combined backtest and per-stock contribution bars

### Common
- Browser-based UI with dark theme
- NSE symbol autocomplete (2,500+ stocks, indices, ETFs)
- Multi-stock selector (max 5) and equal-weighted basket synthesis
- Local CSV caching with auto-refresh from Yahoo Finance

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

## Seasonal Analysis Mode (main branch)

### Controls

| Control | Function |
|---------|----------|
| Period dropdown | Monthly (12+12 rollover) or Weekly (52 weeks) |
| Offset `[-]` `[+]` | Shift period boundaries by N days (0-30 monthly, 0-6 weekly) |
| Threshold `[-]` `[+]` | Filter weak signals (50-100%). Higher = only strong trends |

### Stats Panel
- Shows each period with Trend%, EV, Avg return, and per-year returns
- **Green background** = bullish run, **Red** = bearish run, **Blue text** = neutral

### Strategy Panel
- Detected trades with entry/exit dates, profit, days held, yield per day
- Summary comparing **Seasonal** vs **Buy & Hold**
- **Edge** = bps/day advantage of seasonal over B&H

### Backtest
- Select year and capital (1L/5L/10L)
- Green line: seasonal equity curve, Blue line: B&H
- Shaded bands show investment periods (green=profit, red=loss)

### Optimizer
- **Find max profit**: searches all offset/threshold combos for maximum total profit
- **Find max yield**: maximizes profit per day (bps/day) for better capital efficiency

### Plan Builder
Combine strategies from multiple stocks into a unified trading plan:
1. Analyze a stock, click **+ Add to Plan**
2. Repeat for other stocks/parameters
3. Click **Plan** in header to view combined backtest and export a unified trading calendar

Active plan is stored in browser localStorage. Named plans can be saved to / loaded from the server (`data/plans/*.json`).

## Sliding Window Mode (feature branch)

### Controls
- **Window size dropdown**: 1wk / 2wk / 1mo / 2mo / 3mo
- **Threshold**: minimum win rate filter

### How It Works
1. Precomputes cumulative returns for all years (O(1) lookups)
2. Starts with the full search range [1, 365]
3. Finds the best-scoring window of exactly N days in the range (avg_return x win_rate)
4. That window splits the range into left and right sub-ranges
5. Recurses into each sub-range that can still fit a window
6. Merges nearby windows within 7-day gaps and recomputes merged stats
7. Narrows edges: iteratively trims boundary days that drag the score down

### Backtest Views
- **Line chart** (default): equity curve for a selected year or averaged across all years
- **Bar chart** (toggle with **Bar** button): per-year strategy return vs B&H, side-by-side bars
- In Plan view, the bar chart shows stacked bars with each stock's contribution drawn in its color

### Currently Disabled in Window Mode
- Parameter optimizer
- Per-stock CSV exports (stats, trades, strategy)

## Export Formats

| File | Format | Use Case |
|------|--------|----------|
| `*.stats.csv` | Period-by-period analysis | Detailed seasonal stats |
| `*.trades.csv` | Trade simulation with yearly breakdown | Performance review |
| `*.strategy.csv` | `date,symbol,action` | Single-stock execution calendar |
| `trading-plan.csv` | Combined signals from all strategies | Multi-stock execution calendar |

## Data & Caching

- Data cached in `data/*.csv` by symbol
- Auto-fetches from Yahoo Finance if missing or stale (20 years of history)
- Supports NSE stocks, indices (`^NSEI`, `^NSEBANK`), and ETFs
- Sparse data warning shown if year has <200 trading days

---

# Methodology

## Seasonal Analysis

For each period (month or week) across 20 years of history:
1. Find first/last trading days of the period (adjusted by offset)
2. Calculate return: `((Close_last / Open_first) - 1) x 100%`
3. **Trend Likelihood** = `max(green_years, red_years) / total_years x 100`
4. **Expected Value (EV)** = `|avg_return| x (trend_pct / 100) x direction`
5. **Runs** = 2+ consecutive periods with same direction above threshold
6. **Trades** = enter at start of bullish run, exit at end; compounded returns

## Sliding Window Detection

Uses `YearlyReturnsCache` with precomputed cumulative products for O(1) window return calculation:
- `cum_returns[year][doy]` = cumulative product from day 1 to day-of-year
- Window return = `cum[end] / cum[start-1] - 1`
- Score = `avg_return x win_rate` across all years
- Recursive range-splitting: find best window in [1, 365], split into left/right sub-ranges, recurse; merge within 7-day gaps; narrow edges to maximize score

---

# Limitations

1. **Past performance** does not guarantee future results
2. **Sample size**: ~19 years means even 71% trend = only ~13 confirming years
3. **Survivorship bias**: only currently-listed stocks are analyzed
4. **No transaction costs**: commissions, slippage, bid-ask spreads not modeled
5. **Tax implications**: frequent short-term trades may be tax-disadvantaged vs B&H
6. **Liquidity assumptions**: entry/exit at exact boundaries assumes perfect fills
7. **Lookahead bias**: visible patterns include knowledge of what worked; out-of-sample testing recommended
