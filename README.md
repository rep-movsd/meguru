# Meguru 巡る

**Seasonal Stock Pattern Detector**

*"Meguru" means "to cycle" or "to revolve" in Japanese, capturing the essence of recurring market patterns.*

A lightweight web application that downloads Yahoo Finance OHLC data, caches it locally, and analyzes seasonal windows (weekly/monthly) with dynamic offsets. It supports single symbols or equal-weighted baskets, simulates trading strategies, backtests performance, and exports CSV reports.

## Features

- Browser-based UI with dark theme
- Weekly (52) and monthly (24) windows with configurable offsets
- Trend likelihood and expected value calculations
- Run detection for consecutive bullish/bearish periods
- Trade simulation with annualized returns
- Visual backtesting with equity curves
- Parameter optimizer (max profit / max yield)
- Plan builder to combine multiple strategies
- Threshold filtering for signal strength
- Local CSV caching with auto-refresh
- Multiple export formats (stats, trades, strategy, plan)

## Requirements

- Python 3.10+

## Installation

### Linux / macOS

```bash
# Clone or download the repository
cd meguru

# Create virtual environment (recommended)
python3 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### Windows

```powershell
# Clone or download the repository
cd meguru

# Create virtual environment (recommended)
python -m venv .venv
.venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

### Windows (using py launcher)

```powershell
# If you have multiple Python versions
py -3.10 -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## Running the Server

### Linux / macOS

```bash
# With virtual environment
source .venv/bin/activate
python src/server.py

# Or directly
.venv/bin/python src/server.py
```

### Windows

```powershell
# With virtual environment
.venv\Scripts\activate
python src\server.py

# Or directly
.venv\Scripts\python.exe src\server.py
```

### Windows (using py launcher)

```powershell
py src\server.py
```

Then open http://localhost:8000 in your browser.

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

## Updating the Stock List

The symbol autocomplete uses a local stock list stored in `data/stocks/nse_stocks.csv`. This includes NSE equities, indices, and ETFs. To refresh or download the latest list:

### Linux / macOS

```bash
source .venv/bin/activate
python src/download_stocks.py
```

### Windows

```powershell
.venv\Scripts\activate
python src\download_stocks.py
```

This script downloads:
- All NSE equities from the official NSE archives
- Major indices (NIFTY 50, NIFTY BANK, etc.) with Yahoo Finance symbol mappings
- All NSE-listed ETFs

The stock list is included in the repository, so you only need to run this if you want the latest additions.

---

# Usage Guide

## Basic Usage

| Action | Method |
|--------|--------|
| **Load symbol** | Enter symbol (e.g., `RELIANCE`, `TCS`, `ICICIBANK`) and press Enter or click **Load** |
| **Load basket** | Enter comma-separated symbols (e.g., `TCS,INFY,WIPRO`) |
| **Symbol autocomplete** | Start typing and suggestions appear below the input box |
| **Multi-stock selector** | Click **+ Multi** button to open a searchable stock picker (max 5 stocks) |

The `.NS` suffix is added automatically for NSE stocks - no need to type it.

## Analysis Controls

| Control | Function |
|---------|----------|
| **Period dropdown** | Switch between **Monthly** (12+12 periods with rollover) or **Weekly** (52 weeks) |
| **Offset `[-]` `[+]`** | Shift period boundaries by days (0-30 for monthly, 0-6 for weekly) |
| **Threshold `[-]` `[+]`** | Filter weak signals (50-100%). Higher = only strong trends shown |

## Understanding the Display

### Stats Panel (left)
- Shows each period with Trend%, EV (Expected Value), Avg return, and per-year returns
- **Green background** = bullish run (consecutive positive periods)
- **Red background** = bearish run (consecutive negative periods)
- **Blue text** = neutral (below threshold)
- After December, a separator shows "Rollover into next year" with Jan+ through Dec+ for wraparound patterns

### Strategy Panel (right)
- Shows detected trades (entry/exit dates, profit, days held, yield per day)
- Summary row compares **Seasonal** strategy vs **Buy & Hold**
- **Edge** = how many bps/day better the seasonal strategy is vs holding all year

## Strategy Panel Buttons

| Button | Function |
|--------|----------|
| **Export Data** | Downloads CSV with full trade simulation data including per-year profits |
| **Export Strategy** | Downloads simple CSV with just dates and BUY/SELL actions for execution |
| **Backtest** | Opens visual backtest chart for a specific year |
| **+ Add to Plan** | Adds current strategy to your trading plan (stored in browser) |

## Backtest View

1. Click **Backtest** button in the Strategy panel
2. Select year from dropdown
3. Select capital amount (₹1L, ₹5L, ₹10L)
4. Chart shows:
   - **Green line**: Seasonal strategy equity curve
   - **Blue line**: Buy & Hold equity curve
   - **Shaded bands**: Investment periods (green=profit, red=loss)
   - Labels show BUY/SELL dates and % gain/loss per trade
5. Metrics displayed: P&L, Max Drawdown, Days in Market, Number of Trades

## Optimizer (Find Best Parameters)

| Button | Function |
|--------|----------|
| **Find max profit trades** | Searches all offset/threshold combinations to maximize total profit |
| **Find max yield trades** | Searches to maximize profit per day (bps/day) - better capital efficiency |

After optimization, the parameters are automatically applied and results displayed.

## Plan Builder (Combine Multiple Strategies)

The Plan Builder lets you combine strategies from different stocks into a unified trading plan.

### Adding Strategies
1. Analyze a stock with your preferred parameters
2. Click **+ Add to Plan** button
3. Repeat for other stocks/parameters

### Viewing the Plan
1. Click **Plan** button in header (badge shows count)
2. **Left panel**: List of all added strategies with remove (✕) buttons
3. **Right panel**: Combined backtest chart

### Combined Backtest
- **Purple line**: Combined seasonal strategy (in market if ANY strategy says to be in)
- **Blue line**: Buy & Hold reference
- **Shaded bands**: Investment periods with symbol labels and % returns
- Select year and capital to see different scenarios

### Exporting
- Click **Export Trading Calendar** to download unified CSV
- Format: `date,symbol,action` sorted by date
- Ready for execution - shows all BUY/SELL signals across all strategies

### Managing the Plan
- Click ✕ on any strategy to remove it
- Click **Clear All** to remove all strategies
- Plan is stored in browser localStorage (persists across sessions)

## Export Formats

| File | Format | Use Case |
|------|--------|----------|
| `*.stats.csv` | Period-by-period analysis | Detailed seasonal stats |
| `*.trades.csv` | Trade simulation with yearly breakdown | Performance review |
| `*.strategy.csv` | `date,symbol,action` format | Single-stock execution calendar |
| `trading-plan.csv` | Combined signals from all plan strategies | Multi-stock execution calendar |

## Data & Caching

- Data cached in `data/*.csv` files by symbol name
- Auto-fetches from Yahoo Finance if missing or stale
- Supports NSE stocks, indices (e.g., `^NSEI`, `^NSEBANK`), and ETFs
- Sparse data warning shown if year has <200 trading days

---

# Methodology

## Overview

This tool analyzes historical stock price data to identify recurring seasonal patterns. By examining how a stock performs during specific periods (weeks or months) across multiple years, we can identify statistically significant trends that may inform trading decisions.

## Data Source

- Historical OHLC (Open, High, Low, Close) data from Yahoo Finance
- Default analysis window: 15 years of data
- Data is cached locally in CSV format for faster subsequent loads

## Period Types

### Monthly (24 periods)
- 12 calendar months (Jan through Dec)
- Plus 12 rollover periods (Jan+ through Dec+) for next-year patterns
- Allows detection of patterns spanning year boundaries (e.g., Oct-Feb trade)

### Weekly (52 periods)
- 52 calendar weeks aligned to the first Monday of each year
- More granular analysis but noisier signals

## Offset Parameter

The offset shifts all period boundaries by N days forward.

**Example (Monthly, Offset = 15):**
- Standard January: Jan 1 - Jan 31
- With offset 15: Jan 16 - Feb 15

This allows discovery of patterns that don't align with calendar boundaries. Some market patterns may be driven by events like options expiration (3rd Friday) or month-end rebalancing.

**Range:** 0-30 days (monthly), 0-6 days (weekly)

## Calculating Returns

For each period in each year:

1. Find the first trading day on or after the period start date
2. Find the last trading day on or before the period end date
3. Calculate return: `((Close_last / Open_first) - 1) × 100%`

This gives us a matrix of returns:
- **Rows:** Periods (Jan, Feb, ... or Week 1, Week 2, ...)
- **Columns:** Years (2010, 2011, ..., 2024)

## Trend Likelihood %

For each period, we calculate what percentage of years showed the dominant direction.

**Formula:**
```
green_count = years with return >= 0
red_count = years with return < 0
trend_pct = max(green_count, red_count) / total_years × 100
```

**Example:** If January was positive in 10 out of 14 years → Trend Likelihood = 71% (Bullish)

**Interpretation:**
| Trend % | Strength |
|---------|----------|
| 50% | No trend (random) |
| 60% | Weak trend |
| 70% | Moderate trend |
| 80%+ | Strong trend |

## Threshold Parameter

The threshold filters out weak signals. Periods with Trend Likelihood below the threshold are considered "neutral" and displayed in blue.

**Effects:**
- Neutral periods do not form or extend runs
- Neutral periods break existing runs
- Trades are not generated for neutral periods

**Range:** 50-100% (default: 50% = no filtering)

**Rationale:** A 55% trend likelihood means the pattern held in just over half the years - barely better than a coin flip. Higher thresholds focus on stronger, more reliable patterns.

## Expected Value (EV)

EV combines the average magnitude of moves with their likelihood.

**Formula:**
```
EV = |average_return| × (trend_pct / 100) × direction
```

Where:
- `average_return` = mean of all yearly returns for this period
- `trend_pct` = trend likelihood percentage
- `direction` = +1 if bullish, -1 if bearish

**Example:** January averages +2.5% with 71% bullish trend → EV = 2.5 × 0.71 × 1 = **+1.78**

**Interpretation:** EV represents the expected gain/loss if you traded this period every year. Higher absolute EV = stronger, more consistent pattern.

## Run Detection

A "run" is a sequence of 2+ consecutive periods with the same direction (all bullish or all bearish) where all periods meet the threshold requirement.

**Algorithm:**
1. Iterate through periods in order
2. Track current run: start index, direction, cumulative EV
3. When direction changes or a neutral period is encountered:
   - If current run length >= 2, save it
   - Start new run
4. Calculate RunEV = sum of individual EVs in the run

**UI Display:**
- Green background: Bullish runs (consecutive positive EV periods)
- Red background: Bearish runs (consecutive negative EV periods)
- RunEV displayed at the end of each run

## Trade Simulation

We simulate a trading strategy that:
- Enters at the START of each bullish run
- Exits at the END of each bullish run
- Stays in cash during bearish runs and neutral periods

### For each trade in each historical year:

**1. Entry Date**
- First day of entry period + offset
- Example: "Jan" with offset 15 → "Jan-16"

**2. Exit Date**
- Last day of exit period + offset
- Example: "Mar" with offset 15 → "Apr-15"

**3. Profit Calculation**
- Compound the returns of all periods in the run:
```
profit = (∏(1 + period_return/100) - 1) × 100
```
- Example: Jan +2%, Feb +1%, Mar +3% → profit = ((1.02 × 1.01 × 1.03) - 1) × 100 = **6.12%**

**4. Days Held**
- Sum of calendar days for all periods in the run
- Monthly: actual month lengths (31, 28, 31, ...)
- Weekly: 7 days each

**5. Annualized Return**
```
annualized = profit × (365 / days_held)
```
- Example: 6.12% over 90 days → 6.12 × (365/90) = **24.8%**

## Summary Rows

### TOTAL Row
- **Average Profit:** Mean of total yearly profits across all years
- **Days Held:** Average total days in market per year
- **Annualized:** Average profit × (365 / average days)
- **Per-year columns:** Compounded profit from all trades that year

### B&H (Buy & Hold) Row
Benchmark comparison - what if you held all year?
- B&H profit = compound of ALL period returns (Jan through Dec)
- Represents passive investing with no timing

### EDGE Row
Shows the advantage (or disadvantage) of the seasonal strategy vs B&H.
```
Edge = Seasonal bps/day - B&H bps/day
```

**Interpretation:**
- Positive Edge: Seasonal strategy outperforms on risk-adjusted basis
- Negative Edge: B&H would have been better

**Note:** Even a negative Edge might be acceptable if:
- You want reduced time in market (lower risk exposure)
- The strategy has lower drawdowns
- You need capital for other opportunities

## Basket Analysis

When multiple symbols are entered (comma-separated), returns are synthesized:

1. Align all symbols to common trading dates
2. For each day, calculate the ratio vs previous close for each symbol
3. Average the ratios across symbols (equal weighting)
4. Reconstruct a synthetic price series from the averaged ratios

This creates a "basket" that represents the average behavior of all symbols, useful for analyzing sector-wide or market-wide seasonal patterns.

---

# Limitations & Considerations

1. **PAST PERFORMANCE:** Historical patterns do not guarantee future results. Market regimes change, and seasonal patterns can disappear or reverse.

2. **SAMPLE SIZE:** With ~14 years of data, even a 71% trend means only 10 confirming years. Statistical significance is limited.

3. **SURVIVORSHIP BIAS:** Stocks that exist today may have done so because they performed well. Failed companies are not in the analysis.

4. **TRANSACTION COSTS:** The simulation does not account for commissions, slippage, or bid-ask spreads. Frequent trading erodes returns.

5. **TAXES:** Short-term capital gains are taxed at higher rates. The strategy's frequent trading may have tax disadvantages vs B&H.

6. **LIQUIDITY:** Entry/exit at exact period boundaries assumes perfect liquidity. Large positions may move the market.

7. **LOOKAHEAD BIAS:** The patterns we see today include knowledge of what worked. Out-of-sample testing is recommended before live trading.

---

# Recommended Usage

1. Start with **Monthly** analysis (less noise than weekly)
2. Set threshold to **60-70%** to filter weak signals
3. Experiment with **offsets** to find stronger patterns
4. Use the **optimizer** to find best parameters automatically
5. Compare multiple related symbols to validate sector patterns
6. Use **Plan Builder** to combine uncorrelated strategies
7. Run **Backtest** on multiple years to verify consistency
8. Check **Edge** (bps/day) - positive means seasonal beats buy & hold
9. Paper trade before committing real capital
10. Re-analyze periodically as new data becomes available
