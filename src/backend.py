"""
Backend module for Meguru - Seasonal Stock Pattern Detector.
Contains pure data processing functions separated from UI.
"""
from __future__ import annotations

import calendar
import datetime as dt
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd
import yfinance as yf

# Use absolute path based on this file's location
PROJECT_ROOT = Path(__file__).parent.parent
DATA_DIR = PROJECT_ROOT / "data"
STOCKS_FILE = DATA_DIR / "stocks" / "nse_stocks.csv"
PERIOD_COUNTS = {"weekly": 52, "monthly": 12}
OFFSET_LIMITS = {"weekly": 6, "monthly": 30}
NUM_YEARS = 15

MONTH_NAMES = [calendar.month_abbr[i] for i in range(1, 13)]


# =============================================================================
# Data Classes
# =============================================================================

@dataclass
class SeasonalRow:
    """Aggregated seasonal data for a single period position (week # or month name)."""
    label: str  # "Week 1", "Week 2", ... or "Jan", "Feb", ...
    year_returns: dict[int, float | None] = field(default_factory=dict)  # year -> net return %
    
    @property
    def average(self) -> float | None:
        values = [v for v in self.year_returns.values() if v is not None]
        if not values:
            return None
        return sum(values) / len(values)

    @property
    def trend_pct(self) -> tuple[float, bool] | None:
        """
        Returns (percentage, is_bullish) where percentage is the higher of green% or red%.
        is_bullish is True if green% >= red%, False otherwise.
        """
        values = [v for v in self.year_returns.values() if v is not None]
        if not values:
            return None
        green_count = sum(1 for v in values if v >= 0)
        red_count = len(values) - green_count
        green_pct = (green_count / len(values)) * 100
        red_pct = (red_count / len(values)) * 100
        if green_pct >= red_pct:
            return (green_pct, True)
        else:
            return (red_pct, False)

    @property
    def expected_value(self) -> float | None:
        """Expected value: avg * trend% / 100 (signed by direction)."""
        avg = self.average
        trend = self.trend_pct
        if avg is None or trend is None:
            return None
        pct, is_bullish = trend
        # EV is positive for bullish, negative for bearish
        direction = 1 if is_bullish else -1
        return abs(avg) * (pct / 100) * direction


@dataclass
class RunInfo:
    """Information about a run of consecutive bullish/bearish periods."""
    start_idx: int
    end_idx: int  # inclusive
    is_bullish: bool
    ev_sum: float


@dataclass
class Trade:
    """A simulated trade for a green run."""
    run_idx: int  # which run this is (0-indexed)
    entry_period: str  # e.g., "Jan" or "Week 1"
    exit_period: str  # e.g., "Mar" or "Week 3"
    periods_held: int  # number of periods in the run
    days_held: int  # calendar days in the run
    profit_pct: float  # compounded profit percentage for this trade


@dataclass
class YearlyTradeResult:
    """Trading simulation results for a single year."""
    year: int
    trades: list[Trade]
    total_profit_pct: float  # compounded total profit
    total_days_held: int
    buy_hold_profit_pct: float  # buy and hold for whole year


# =============================================================================
# Stock List Functions
# =============================================================================

def load_stock_list() -> list[tuple[str, str]]:
    """Load stock list from cached CSV. Returns list of (symbol, name) tuples."""
    if not STOCKS_FILE.exists():
        return []
    stocks = []
    with open(STOCKS_FILE, "r", encoding="utf-8") as f:
        next(f)  # Skip header
        for line in f:
            parts = line.strip().split(",", 1)
            if len(parts) == 2:
                stocks.append((parts[0], parts[1]))
    return stocks


def search_symbols(query: str, max_results: int = 10) -> list[dict[str, str]]:
    """
    Search for symbols matching query (case-insensitive contains match).
    Returns list of {symbol, name} dicts.
    """
    stocks = load_stock_list()
    query_lower = query.lower().strip()
    if not query_lower:
        return []
    
    matches = []
    for symbol, name in stocks:
        if query_lower in symbol.lower() or query_lower in name.lower():
            matches.append({"symbol": symbol, "name": name})
            if len(matches) >= max_results:
                break
    return matches


# =============================================================================
# Data Loading Functions
# =============================================================================

def sanitize_symbol(symbol: str) -> str:
    return symbol.replace("/", "-").replace(" ", "").replace(":", "-")


def parse_symbols(symbols_text: str, max_symbols: int = 5) -> list[str]:
    """Parse comma-separated symbols. Raises ValueError if more than max_symbols.
    
    Normalizes symbols by adding .NS suffix for Indian stocks if missing.
    Indices (starting with ^) are left unchanged.
    """
    symbols = [item.strip().upper() for item in symbols_text.split(",") if item.strip()]
    if len(symbols) > max_symbols:
        raise ValueError(f"Maximum {max_symbols} symbols allowed, got {len(symbols)}")
    
    # Normalize symbols - add .NS suffix if missing (except for indices)
    normalized = []
    for sym in symbols:
        if sym.startswith("^"):
            # Index - leave as is
            normalized.append(sym)
        elif not sym.endswith(".NS"):
            # Add .NS suffix for Indian stocks
            normalized.append(f"{sym}.NS")
        else:
            normalized.append(sym)
    
    return normalized


def ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def _normalize_df(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df
    df = df.copy()
    # Handle multi-level columns from yfinance (Price, Ticker)
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    # Normalize index to timezone-naive datetime
    idx = pd.to_datetime(df.index, errors="coerce")
    if idx.tz is not None:
        idx = idx.tz_localize(None)
    df.index = idx
    df = df.rename(columns=str.title)
    # Ensure required columns exist
    required = ["Open", "High", "Low", "Close"]
    missing = [col for col in required if col not in df.columns]
    if missing:
        return pd.DataFrame()
    return df[required].dropna()


def _download_symbol(symbol: str, start: dt.date | None = None) -> pd.DataFrame:
    kwargs: dict[str, object] = {"progress": False, "auto_adjust": False}
    if start:
        kwargs["start"] = start
    else:
        kwargs["period"] = "max"
    df = yf.download(symbol, **kwargs)
    return _normalize_df(df)


def load_symbol_data(symbol: str) -> pd.DataFrame:
    ensure_dirs()
    symbol_key = sanitize_symbol(symbol)
    cache_path = DATA_DIR / f"{symbol_key}.csv"
    if cache_path.exists():
        cached = pd.read_csv(cache_path, index_col=0, parse_dates=True)
        cached = _normalize_df(cached)
    else:
        cached = pd.DataFrame()

    yesterday = pd.Timestamp.now().normalize() - pd.Timedelta(days=1)
    if cached.empty:
        updated = _download_symbol(symbol)
    else:
        last_date = cached.index.max().normalize()
        if last_date < yesterday:
            start_date = (last_date + pd.Timedelta(days=1)).date()
            incremental = _download_symbol(symbol, start=start_date)
            updated = pd.concat([cached, incremental]).drop_duplicates()
        else:
            updated = cached

    updated = updated.sort_index()
    updated.to_csv(cache_path)
    return updated


def synthesize_basket(symbols: Iterable[str]) -> pd.DataFrame:
    data_frames = [load_symbol_data(symbol) for symbol in symbols]
    if not data_frames:
        return pd.DataFrame()

    common_index = data_frames[0].index
    for df in data_frames[1:]:
        common_index = common_index.intersection(df.index)

    if common_index.empty:
        return pd.DataFrame()

    aligned = [df.loc[common_index] for df in data_frames]
    ratio_frames = []
    for df in aligned:
        prev_close = df["Close"].shift(1)
        ratio_frames.append(
            pd.DataFrame(
                {
                    "Open": df["Open"] / prev_close,
                    "High": df["High"] / prev_close,
                    "Low": df["Low"] / prev_close,
                    "Close": df["Close"] / prev_close,
                }
            )
        )

    avg_ratios = pd.concat(ratio_frames).groupby(level=0).mean()
    avg_ratios = avg_ratios.dropna()
    if avg_ratios.empty:
        return pd.DataFrame()

    open_series = pd.Series(index=avg_ratios.index, dtype=float)
    high_series = pd.Series(index=avg_ratios.index, dtype=float)
    low_series = pd.Series(index=avg_ratios.index, dtype=float)
    close_series = pd.Series(index=avg_ratios.index, dtype=float)

    prev_close = 100.0
    for idx, row in avg_ratios.iterrows():
        open_series[idx] = prev_close * row["Open"]
        high_series[idx] = prev_close * row["High"]
        low_series[idx] = prev_close * row["Low"]
        close_series[idx] = prev_close * row["Close"]
        prev_close = close_series[idx]

    return pd.DataFrame(
        {
            "Open": open_series,
            "High": high_series,
            "Low": low_series,
            "Close": close_series,
        }
    )


# =============================================================================
# Seasonal Analysis Functions
# =============================================================================

def next_trading_day(index: pd.DatetimeIndex, date: pd.Timestamp) -> pd.Timestamp | None:
    pos = index.searchsorted(date)
    if pos >= len(index):
        return None
    return index[pos]


def prev_trading_day(index: pd.DatetimeIndex, date: pd.Timestamp) -> pd.Timestamp | None:
    pos = index.searchsorted(date, side="right") - 1
    if pos < 0:
        return None
    return index[pos]


def get_first_monday(year: int) -> pd.Timestamp:
    """Get the first Monday of a given year."""
    jan1 = pd.Timestamp(year=year, month=1, day=1)
    days_until_monday = (7 - jan1.weekday()) % 7
    if jan1.weekday() == 0:  # Already Monday
        return jan1
    return jan1 + pd.Timedelta(days=days_until_monday)


def compute_window_return(
    df: pd.DataFrame, start: pd.Timestamp, end: pd.Timestamp
) -> float | None:
    """Compute net return % for a window using closing prices."""
    window = df.loc[start:end]
    if window.empty or len(window) < 1:
        return None
    start_close = float(window.iloc[0]["Close"])
    end_close = float(window.iloc[-1]["Close"])
    if start_close == 0:
        return None
    return (end_close / start_close - 1) * 100


def generate_seasonal_data(
    df: pd.DataFrame, period: str, offset_days: int, num_years: int
) -> list[SeasonalRow]:
    """Generate seasonal rows with per-year returns, including wraparound period."""
    if df.empty:
        return []

    index = df.index
    last_date = index.max().normalize()
    current_year = last_date.year
    years = list(range(current_year - num_years + 1, current_year + 1))

    if period == "weekly":
        # 52 weeks + 1 wraparound week, aligned to first Monday of each year
        rows: list[SeasonalRow] = []
        for week_num in range(1, 54):  # 53 weeks (52 + 1 wraparound)
            # Wraparound: week 53 uses week 1 of next year's pattern
            is_wraparound = week_num == 53
            label = f"Week {week_num}" if not is_wraparound else "Week 1+"
            row = SeasonalRow(label=label)
            
            for year in years:
                if is_wraparound:
                    # Use week 1 data but from the following year
                    data_year = year + 1
                    actual_week = 1
                else:
                    data_year = year
                    actual_week = week_num
                
                first_monday = get_first_monday(data_year)
                week_start = first_monday + pd.Timedelta(days=7 * (actual_week - 1))
                week_end = week_start + pd.Timedelta(days=6)
                # Apply offset
                adj_start = week_start + pd.Timedelta(days=offset_days)
                adj_end = week_end + pd.Timedelta(days=offset_days)
                # Find actual trading days
                start = next_trading_day(index, adj_start)
                end = prev_trading_day(index, adj_end)
                if start is None or end is None or start > end:
                    row.year_returns[year] = None
                else:
                    row.year_returns[year] = compute_window_return(df, start, end)
            rows.append(row)
        return rows
    else:
        # 24 months (12 months + 12 months rollover into next year)
        rows = []
        for month_num in range(1, 25):  # 24 months
            is_rollover = month_num > 12
            actual_month = month_num if month_num <= 12 else month_num - 12
            
            if is_rollover:
                label = f"{MONTH_NAMES[actual_month - 1]}+"
            else:
                label = MONTH_NAMES[actual_month - 1]
            row = SeasonalRow(label=label)
            
            for year in years:
                # For rollover months, use next year's data
                data_year = year + 1 if is_rollover else year
                
                month_start = pd.Timestamp(year=data_year, month=actual_month, day=1)
                month_end = (month_start + pd.offsets.MonthEnd(0)).normalize()
                # Apply offset
                adj_start = month_start + pd.Timedelta(days=offset_days)
                adj_end = month_end + pd.Timedelta(days=offset_days)
                # Find actual trading days
                start = next_trading_day(index, adj_start)
                end = prev_trading_day(index, adj_end)
                if start is None or end is None or start > end:
                    row.year_returns[year] = None
                else:
                    row.year_returns[year] = compute_window_return(df, start, end)
            rows.append(row)
        return rows


# =============================================================================
# Run Detection Functions
# =============================================================================

def detect_runs(rows: list[SeasonalRow], min_length: int = 2, threshold_pct: float = 50) -> list[RunInfo]:
    """
    Detect runs of consecutive green (positive EV) or red (negative EV) periods.
    A run must have at least min_length consecutive periods of the same direction.
    Periods with trend% below threshold_pct are treated as neutral and break runs.
    Returns list of RunInfo for runs that meet the minimum length.
    """
    if not rows:
        return []
    
    runs: list[RunInfo] = []
    current_start = 0
    current_bullish: bool | None = None
    current_sum = 0.0
    
    for i, row in enumerate(rows):
        ev = row.expected_value
        trend = row.trend_pct
        
        # Check if this row is neutral (None EV or trend% below threshold)
        is_neutral = ev is None or trend is None or trend[0] < threshold_pct
        
        if is_neutral:
            # End current run if any
            if current_bullish is not None and (i - current_start) >= min_length:
                runs.append(RunInfo(
                    start_idx=current_start,
                    end_idx=i - 1,
                    is_bullish=current_bullish,
                    ev_sum=current_sum,
                ))
            current_bullish = None
            current_sum = 0.0
            current_start = i + 1
            continue
        
        # At this point, ev is guaranteed to be not None
        assert ev is not None
        is_bullish = ev >= 0
        
        if current_bullish is None:
            # Start new run
            current_bullish = is_bullish
            current_start = i
            current_sum = ev
        elif is_bullish == current_bullish:
            # Continue run
            current_sum += ev
        else:
            # Direction changed - end current run if long enough
            if (i - current_start) >= min_length:
                runs.append(RunInfo(
                    start_idx=current_start,
                    end_idx=i - 1,
                    is_bullish=current_bullish,
                    ev_sum=current_sum,
                ))
            # Start new run
            current_bullish = is_bullish
            current_start = i
            current_sum = ev
    
    # Handle final run
    if current_bullish is not None and (len(rows) - current_start) >= min_length:
        runs.append(RunInfo(
            start_idx=current_start,
            end_idx=len(rows) - 1,
            is_bullish=current_bullish,
            ev_sum=current_sum,
        ))
    
    return runs


def build_run_map(runs: list[RunInfo]) -> tuple[dict[int, float], dict[int, bool]]:
    """
    Build mappings from row index to run info.
    Returns:
        - run_ev_at_end: dict mapping end_idx -> ev_sum (only at end of run)
        - run_membership: dict mapping row_idx -> is_bullish (for all rows in runs)
    """
    run_ev_at_end: dict[int, float] = {}
    run_membership: dict[int, bool] = {}
    
    for run in runs:
        run_ev_at_end[run.end_idx] = run.ev_sum
        for i in range(run.start_idx, run.end_idx + 1):
            run_membership[i] = run.is_bullish
    
    return run_ev_at_end, run_membership


# =============================================================================
# Trade Simulation Functions
# =============================================================================

def get_period_days(period: str, period_type: str) -> int:
    """Get approximate calendar days for a period."""
    if period_type == "weekly":
        return 7
    else:
        # Monthly - use average days per month
        # Handle wraparound labels like "Jan+"
        month_key = period.rstrip("+")
        month_days = {
            "Jan": 31, "Feb": 28, "Mar": 31, "Apr": 30,
            "May": 31, "Jun": 30, "Jul": 31, "Aug": 31,
            "Sep": 30, "Oct": 31, "Nov": 30, "Dec": 31,
        }
        return month_days.get(month_key, 30)


def get_period_date_label(period: str, period_type: str, offset_days: int, is_entry: bool) -> str:
    """
    Convert a period label to a date string like 'Jan-15'.
    For entry: start of period + offset
    For exit: end of period + offset
    """
    month_abbrs = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", 
                   "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    
    if period_type == "monthly":
        # Handle wraparound labels like "Jan+"
        month_key = period.rstrip("+")
        month_num = {
            "Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4,
            "May": 5, "Jun": 6, "Jul": 7, "Aug": 8,
            "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12,
        }.get(month_key, 1)
        
        month_days = {
            1: 31, 2: 28, 3: 31, 4: 30,
            5: 31, 6: 30, 7: 31, 8: 31,
            9: 30, 10: 31, 11: 30, 12: 31,
        }
        
        if is_entry:
            # Entry: 1st of month + offset
            day = 1 + offset_days
            current_month = month_num
        else:
            # Exit: last day of month + offset
            day = month_days[month_num] + offset_days
            current_month = month_num
        
        # Handle day overflow into next month
        while day > month_days[current_month]:
            day -= month_days[current_month]
            current_month = (current_month % 12) + 1
        
        return f"{month_abbrs[current_month - 1]}-{day}"
    else:
        # Weekly - calculate actual calendar date
        # Parse week number from "Week X" or "Week X+"
        week_str = period.replace("Week ", "").rstrip("+")
        week_num = int(week_str)
        
        # Use a reference year (non-leap year) to calculate the date
        # First Monday of a typical year (e.g., 2024 starts on Monday Jan 1)
        # But we use a generic calculation based on first Monday of year
        reference_year = 2024  # Using 2024 as reference (Jan 1 is Monday)
        first_monday = get_first_monday(reference_year)
        
        # Calculate the Monday of the target week
        week_start = first_monday + pd.Timedelta(days=7 * (week_num - 1))
        
        if is_entry:
            # Entry: Monday of the week + offset
            target_date = week_start + pd.Timedelta(days=offset_days)
        else:
            # Exit: Sunday of the week (Monday + 6) + offset
            target_date = week_start + pd.Timedelta(days=6 + offset_days)
        
        # Format as "Mon-DD" (e.g., "Jan-29", "Feb-5")
        return f"{month_abbrs[target_date.month - 1]}-{target_date.day}"


def calculate_run_days(rows: list[SeasonalRow], start_idx: int, end_idx: int, period_type: str) -> int:
    """Calculate total calendar days for a run."""
    total_days = 0
    for i in range(start_idx, end_idx + 1):
        total_days += get_period_days(rows[i].label, period_type)
    return total_days


def simulate_trades_for_year(
    rows: list[SeasonalRow],
    runs: list[RunInfo],
    year: int,
    period_type: str,
) -> YearlyTradeResult:
    """
    Simulate trades for a specific year based on green runs.
    Buy at start of green run, sell at end. Compound profits across runs.
    """
    trades: list[Trade] = []
    compounded_value = 1.0  # Start with 1 unit
    total_days = 0
    
    for run_idx, run in enumerate(runs):
        if not run.is_bullish:
            continue  # Only trade green runs
        
        # Calculate compounded return for this run in this specific year
        run_return = 1.0
        periods_with_data = 0
        for i in range(run.start_idx, run.end_idx + 1):
            row = rows[i]
            year_ret = row.year_returns.get(year)
            if year_ret is not None:
                run_return *= (1 + year_ret / 100)
                periods_with_data += 1
        
        if periods_with_data == 0:
            continue
        
        profit_pct = (run_return - 1) * 100
        periods_held = run.end_idx - run.start_idx + 1
        days_held = calculate_run_days(rows, run.start_idx, run.end_idx, period_type)
        
        trade = Trade(
            run_idx=run_idx,
            entry_period=rows[run.start_idx].label,
            exit_period=rows[run.end_idx].label,
            periods_held=periods_held,
            days_held=days_held,
            profit_pct=profit_pct,
        )
        trades.append(trade)
        
        compounded_value *= run_return
        total_days += days_held
    
    total_profit_pct = (compounded_value - 1) * 100
    
    # Calculate buy and hold for whole year (first to last period)
    buy_hold_return = 1.0
    for row in rows:
        year_ret = row.year_returns.get(year)
        if year_ret is not None:
            buy_hold_return *= (1 + year_ret / 100)
    buy_hold_profit_pct = (buy_hold_return - 1) * 100
    
    return YearlyTradeResult(
        year=year,
        trades=trades,
        total_profit_pct=total_profit_pct,
        total_days_held=total_days,
        buy_hold_profit_pct=buy_hold_profit_pct,
    )


def simulate_all_years(
    rows: list[SeasonalRow],
    runs: list[RunInfo],
    years: list[int],
    period_type: str,
) -> dict[int, YearlyTradeResult]:
    """Simulate trades for all years."""
    results: dict[int, YearlyTradeResult] = {}
    for year in years:
        results[year] = simulate_trades_for_year(rows, runs, year, period_type)
    return results


# =============================================================================
# High-Level API Functions for Web Server
# =============================================================================

def get_years_from_data(df: pd.DataFrame) -> list[int]:
    """Get the list of analysis years from data, excluding current year."""
    if df.empty:
        return []
    last_date = df.index.max().normalize()
    current_year = last_date.year
    all_years = list(range(current_year - NUM_YEARS + 1, current_year + 1))
    # Skip current year (incomplete)
    return [y for y in all_years if y != current_year]


def get_stats(
    symbols: list[str],
    period: str,
    offset: int,
    threshold: int,
) -> dict:
    """
    Get stats table data for given parameters.
    Returns dict with 'rows', 'years', 'runs' for rendering.
    """
    # Load data
    if len(symbols) == 1:
        data = load_symbol_data(symbols[0])
    else:
        data = synthesize_basket(symbols)
    
    if data.empty:
        return {"error": "No data available", "rows": [], "years": [], "runs": []}
    
    years = get_years_from_data(data)
    seasonal_rows = generate_seasonal_data(data, period, offset, NUM_YEARS)
    runs = detect_runs(seasonal_rows, min_length=2, threshold_pct=threshold)
    run_ev_at_end, run_membership = build_run_map(runs)
    
    # Convert to JSON-serializable format
    rows_data = []
    for idx, row in enumerate(seasonal_rows):
        trend = row.trend_pct
        is_neutral = trend is not None and trend[0] < threshold
        in_run = idx in run_membership
        is_bullish_run = run_membership.get(idx) if in_run else None
        run_ev = run_ev_at_end.get(idx)
        
        row_dict = {
            "label": row.label,
            "trend_pct": trend[0] if trend else None,
            "is_bullish": trend[1] if trend else None,
            "is_neutral": is_neutral,
            "ev": row.expected_value,
            "run_ev": run_ev,
            "in_run": in_run,
            "is_bullish_run": is_bullish_run,
            "avg": row.average,
            "years": {str(y): row.year_returns.get(y) for y in years},
        }
        rows_data.append(row_dict)
    
    runs_data = [
        {
            "start_idx": r.start_idx,
            "end_idx": r.end_idx,
            "is_bullish": r.is_bullish,
            "ev_sum": r.ev_sum,
        }
        for r in runs
    ]
    
    return {
        "rows": rows_data,
        "years": years,
        "runs": runs_data,
    }


def get_trades(
    symbols: list[str],
    period: str,
    offset: int,
    threshold: int,
) -> dict:
    """
    Get trades table data for given parameters.
    Returns dict with 'trades', 'summary' for rendering.
    """
    # Load data
    if len(symbols) == 1:
        data = load_symbol_data(symbols[0])
    else:
        data = synthesize_basket(symbols)
    
    if data.empty:
        return {"error": "No data available", "trades": [], "summary": {}}
    
    years = get_years_from_data(data)
    seasonal_rows = generate_seasonal_data(data, period, offset, NUM_YEARS)
    runs = detect_runs(seasonal_rows, min_length=2, threshold_pct=threshold)
    
    # Get green runs only - for monthly, only include runs that START in first 12 months
    # to avoid duplicates from the rollover section
    green_runs = [r for r in runs if r.is_bullish]
    if period == "monthly":
        green_runs = [r for r in green_runs if r.start_idx < 12]
    
    # Simulate only the filtered green runs
    yearly_results = simulate_all_years(seasonal_rows, green_runs, years, period)
    
    trades_data = []
    for run in green_runs:
        entry = seasonal_rows[run.start_idx].label
        exit_label = seasonal_rows[run.end_idx].label
        days = calculate_run_days(seasonal_rows, run.start_idx, run.end_idx, period)
        entry_date = get_period_date_label(entry, period, offset, is_entry=True)
        exit_date = get_period_date_label(exit_label, period, offset, is_entry=False)
        
        # Get profit for each year
        year_profits = {}
        total_profit = 0.0
        profit_count = 0
        for year in years:
            result = yearly_results.get(year)
            if result:
                trade = next((t for t in result.trades if t.entry_period == entry and t.exit_period == exit_label), None)
                if trade:
                    year_profits[str(year)] = trade.profit_pct
                    total_profit += trade.profit_pct
                    profit_count += 1
                else:
                    year_profits[str(year)] = None
            else:
                year_profits[str(year)] = None
        
        avg_profit = total_profit / profit_count if profit_count > 0 else 0
        annualized = (avg_profit * 365 / days) if days > 0 else 0
        
        trades_data.append({
            "entry_date": entry_date,
            "exit_date": exit_date,
            "avg_profit": avg_profit,
            "days": days,
            "annualized": annualized,
            "years": year_profits,
        })
    
    # Calculate summary
    total_profits = []
    total_days_list = []
    bh_profits = []
    
    for year in years:
        result = yearly_results.get(year)
        if result:
            total_profits.append(result.total_profit_pct)
            total_days_list.append(result.total_days_held)
            bh_profits.append(result.buy_hold_profit_pct)
    
    avg_total = sum(total_profits) / len(total_profits) if total_profits else 0
    avg_days = sum(total_days_list) // len(total_days_list) if total_days_list else 0
    total_annualized = (avg_total * 365 / avg_days) if avg_days > 0 else 0
    avg_bh = sum(bh_profits) / len(bh_profits) if bh_profits else 0
    
    # Per-year totals
    year_totals = {}
    year_bh = {}
    for year in years:
        result = yearly_results.get(year)
        if result:
            year_totals[str(year)] = result.total_profit_pct
            year_bh[str(year)] = result.buy_hold_profit_pct
        else:
            year_totals[str(year)] = None
            year_bh[str(year)] = None
    
    summary = {
        "avg_profit": avg_total,
        "avg_days": avg_days,
        "annualized": total_annualized,
        "bh_profit": avg_bh,
        "edge": total_annualized - avg_bh,
        "year_totals": year_totals,
        "year_bh": year_bh,
    }
    
    return {
        "trades": trades_data,
        "summary": summary,
        "years": years,
    }


def find_optimal_trades(
    symbols: list[str],
    period: str,
    optimize_for: str,  # "profit" or "yield"
) -> dict:
    """
    Find the optimal offset and threshold combination for either max profit or max yield.
    
    Args:
        symbols: List of stock symbols
        period: "weekly" or "monthly"
        optimize_for: "profit" (total profit) or "yield" (profit per day in bps)
    
    Returns:
        dict with optimal offset, threshold, and the resulting trades data
    """
    # Load data once
    if len(symbols) == 1:
        data = load_symbol_data(symbols[0])
    else:
        data = synthesize_basket(symbols)
    
    if data.empty:
        return {"error": "No data available", "offset": 0, "threshold": 50}
    
    years = get_years_from_data(data)
    
    # Define search ranges
    offset_limit = OFFSET_LIMITS.get(period, 30)
    offsets = range(0, offset_limit + 1)
    thresholds = range(50, 101, 5)  # 50, 55, 60, ..., 100
    
    best_result = None
    best_offset = 0
    best_threshold = 50
    best_primary = float('-inf')
    best_secondary = float('-inf')
    
    for offset in offsets:
        seasonal_rows = generate_seasonal_data(data, period, offset, NUM_YEARS)
        
        for threshold in thresholds:
            runs = detect_runs(seasonal_rows, min_length=2, threshold_pct=threshold)
            yearly_results = simulate_all_years(seasonal_rows, runs, years, period)
            
            # Calculate summary metrics
            total_profits = []
            total_days_list = []
            
            for year in years:
                result = yearly_results.get(year)
                if result:
                    total_profits.append(result.total_profit_pct)
                    total_days_list.append(result.total_days_held)
            
            if not total_profits:
                continue
            
            avg_profit = sum(total_profits) / len(total_profits)
            avg_days = sum(total_days_list) / len(total_days_list) if total_days_list else 0
            
            # Calculate yield (bps per day)
            yield_bps = (avg_profit / avg_days) * 100 if avg_days > 0 else 0
            
            # Determine primary and secondary metrics based on optimization target
            if optimize_for == "profit":
                primary = avg_profit
                secondary = yield_bps
            else:  # yield
                primary = yield_bps
                secondary = avg_profit
            
            # Compare: primary first, then secondary as tiebreaker
            is_better = False
            if primary > best_primary:
                is_better = True
            elif primary == best_primary and secondary > best_secondary:
                is_better = True
            
            if is_better:
                best_primary = primary
                best_secondary = secondary
                best_offset = offset
                best_threshold = threshold
    
    return {
        "offset": best_offset,
        "threshold": best_threshold,
        "period": period,
    }


def export_stats_csv(
    symbols: list[str],
    period: str,
    offset: int,
    threshold: int,
) -> str:
    """Generate CSV content for stats export."""
    # Load data
    if len(symbols) == 1:
        data = load_symbol_data(symbols[0])
    else:
        data = synthesize_basket(symbols)
    
    if data.empty:
        return ""
    
    years = get_years_from_data(data)
    seasonal_rows = generate_seasonal_data(data, period, offset, NUM_YEARS)
    
    # Build CSV
    import io
    output = io.StringIO()
    
    # Header
    headers = ["Period", "Trend %", "Direction", "EV", "Avg"]
    headers.extend([str(y) for y in reversed(years)])
    output.write(",".join(headers) + "\n")
    
    # Rows
    for row in seasonal_rows:
        trend = row.trend_pct
        values = [row.label]
        values.append(f"{trend[0]:.0f}" if trend else "")
        values.append("Bull" if trend and trend[1] else "Bear" if trend else "")
        values.append(f"{row.expected_value:.2f}" if row.expected_value is not None else "")
        values.append(f"{row.average:.2f}" if row.average is not None else "")
        for year in reversed(years):
            val = row.year_returns.get(year)
            values.append(f"{val:.2f}" if val is not None else "")
        output.write(",".join(values) + "\n")
    
    return output.getvalue()


def export_trades_csv(
    symbols: list[str],
    period: str,
    offset: int,
    threshold: int,
) -> str:
    """Generate CSV content for trades export."""
    trades_data = get_trades(symbols, period, offset, threshold)
    
    if not trades_data.get("trades"):
        return ""
    
    import io
    output = io.StringIO()
    
    years = trades_data["years"]
    
    # Header
    headers = ["Entry", "Exit", "Avg Profit %", "Days", "Annualized %"]
    headers.extend([str(y) for y in reversed(years)])
    output.write(",".join(headers) + "\n")
    
    # Trade rows
    for trade in trades_data["trades"]:
        values = [
            trade["entry_date"],
            trade["exit_date"],
            f"{trade['avg_profit']:.2f}",
            str(trade["days"]),
            f"{trade['annualized']:.2f}",
        ]
        for year in reversed(years):
            val = trade["years"].get(str(year))
            values.append(f"{val:.2f}" if val is not None else "")
        output.write(",".join(values) + "\n")
    
    # Summary rows
    summary = trades_data["summary"]
    
    # TOTAL row
    values = ["TOTAL", "", f"{summary['avg_profit']:.2f}", str(summary['avg_days']), f"{summary['annualized']:.2f}"]
    for year in reversed(years):
        val = summary["year_totals"].get(str(year))
        values.append(f"{val:.2f}" if val is not None else "")
    output.write(",".join(values) + "\n")
    
    # B&H row
    values = ["B&H", "", f"{summary['bh_profit']:.2f}", "365", f"{summary['bh_profit']:.2f}"]
    for year in reversed(years):
        val = summary["year_bh"].get(str(year))
        values.append(f"{val:.2f}" if val is not None else "")
    output.write(",".join(values) + "\n")
    
    # EDGE row
    values = ["EDGE", "vs B&H", "", "", f"{summary['edge']:.2f}"]
    values.extend(["" for _ in years])
    output.write(",".join(values) + "\n")
    
    return output.getvalue()


def export_strategy_csv(
    symbols: list[str],
    period: str,
    offset: int,
    threshold: int,
) -> str:
    """
    Generate CSV content for strategy export.
    
    Format: date,stockname,action (no headers)
    - date: MM-DD format (e.g., Jan-15)
    - stockname: symbol without .NS suffix
    - action: BUY or SELL
    
    This format allows concatenating strategies from multiple stocks
    and sorting by date to get a full year trading plan.
    """
    trades_data = get_trades(symbols, period, offset, threshold)
    
    if not trades_data.get("trades"):
        return ""
    
    import io
    output = io.StringIO()
    
    # Create display name for the stock(s)
    # Strip .NS suffix for cleaner output
    if len(symbols) == 1:
        stock_name = symbols[0].replace(".NS", "")
    else:
        # For basket, join symbols without .NS
        stock_name = "+".join(s.replace(".NS", "") for s in symbols)
    
    # Generate buy/sell entries for each trade
    for trade in trades_data["trades"]:
        entry_date = trade["entry_date"]  # e.g., "Jan-15"
        exit_date = trade["exit_date"]    # e.g., "Feb-28"
        
        # Write BUY entry
        output.write(f"{entry_date},{stock_name},BUY\n")
        
        # Write SELL entry
        output.write(f"{exit_date},{stock_name},SELL\n")
    
    return output.getvalue()


def get_backtest_data(
    symbols: list[str],
    period: str,
    offset: int,
    threshold: int,
    year: int,
) -> dict:
    """
    Generate backtest data for visualization.
    
    Returns daily equity curves showing:
    - Seasonal strategy: P&L when following the green runs
    - Buy & Hold: P&L when holding all year
    
    Args:
        symbols: List of stock symbols
        period: "weekly" or "monthly"
        offset: Day offset for period boundaries
        threshold: Trend percentage threshold
        year: Year to backtest
    
    Returns:
        dict with:
        - seasonal_curve: list of daily P&L percentages for seasonal strategy
        - bh_curve: list of daily P&L percentages for buy & hold
        - trades: list of trade info (entry_date, exit_date, days)
        - dates: list of date strings (MMM-DD format)
    """
    # Load data
    if len(symbols) == 1:
        data = load_symbol_data(symbols[0])
    else:
        data = synthesize_basket(symbols)
    
    if data.empty:
        return {"error": "No data available", "seasonal_curve": [], "bh_curve": [], "trades": [], "dates": []}
    
    # Filter data for the specified year
    year_start = pd.Timestamp(year=year, month=1, day=1)
    year_end = pd.Timestamp(year=year, month=12, day=31)
    year_data = data.loc[year_start:year_end].copy()
    
    if year_data.empty:
        return {"error": f"No data for year {year}", "seasonal_curve": [], "bh_curve": [], "trades": [], "dates": []}
    
    # Check for sparse data (less than 200 trading days suggests incomplete data)
    data_warning = None
    if len(year_data) < 200:
        data_warning = f"Incomplete data: only {len(year_data)} trading days (expected ~245)"
    
    # Get seasonal analysis to find green runs
    seasonal_rows = generate_seasonal_data(data, period, offset, NUM_YEARS)
    runs = detect_runs(seasonal_rows, min_length=2, threshold_pct=threshold)
    green_runs = [r for r in runs if r.is_bullish]
    
    # For monthly, only include runs that START in first 12 months
    if period == "monthly":
        green_runs = [r for r in green_runs if r.start_idx < 12]
    
    # Build list of trading periods (entry_date, exit_date) for this year
    trades_info = []
    for run in green_runs:
        entry_label = seasonal_rows[run.start_idx].label
        exit_label = seasonal_rows[run.end_idx].label
        entry_date_str = get_period_date_label(entry_label, period, offset, is_entry=True)
        exit_date_str = get_period_date_label(exit_label, period, offset, is_entry=False)
        days = calculate_run_days(seasonal_rows, run.start_idx, run.end_idx, period)
        trades_info.append({
            "entry_date": entry_date_str,
            "exit_date": exit_date_str,
            "days": days,
        })
    
    # Convert MMM-DD to actual dates for the year
    def parse_mmm_dd(mmm_dd: str, ref_year: int) -> pd.Timestamp | None:
        """Parse 'Jan-15' format to timestamp."""
        try:
            month_map = {"Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6,
                        "Jul": 7, "Aug": 8, "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12}
            parts = mmm_dd.split("-")
            month = month_map.get(parts[0], 1)
            day = int(parts[1])
            # Clamp day to valid range for month
            max_day = calendar.monthrange(ref_year, month)[1]
            day = min(day, max_day)
            return pd.Timestamp(year=ref_year, month=month, day=day)
        except (ValueError, IndexError, KeyError):
            return None
    
    # Build trading periods as date ranges
    trading_periods = []
    for trade in trades_info:
        entry = parse_mmm_dd(trade["entry_date"], year)
        exit_dt = parse_mmm_dd(trade["exit_date"], year)
        # Handle wraparound (e.g., entry in Dec, exit in Jan+)
        if entry and exit_dt:
            if exit_dt < entry:
                # Wraparound to next year
                exit_dt = parse_mmm_dd(trade["exit_date"], year + 1)
            if entry and exit_dt:
                trading_periods.append((entry, exit_dt))
    
    # Calculate daily returns
    year_data["Daily_Return"] = year_data["Close"].pct_change()
    
    # Build equity curves
    dates = []
    seasonal_curve = []
    bh_curve = []
    
    bh_cumulative = 0.0  # Cumulative P&L percentage for B&H
    seasonal_cumulative = 0.0  # Cumulative P&L percentage for seasonal
    
    for idx, row in year_data.iterrows():
        ts = pd.Timestamp(idx)
        date_str = f"{calendar.month_abbr[ts.month]}-{ts.day}"
        dates.append(date_str)
        
        daily_ret = row["Daily_Return"]
        if pd.isna(daily_ret):
            daily_ret = 0.0
        
        # Buy & Hold: always in the market
        bh_cumulative = (1 + bh_cumulative / 100) * (1 + daily_ret) - 1
        bh_cumulative *= 100
        bh_curve.append(bh_cumulative)
        
        # Seasonal: only in market during green runs
        # Check if we should be in position today
        should_be_in = False
        for entry, exit_dt in trading_periods:
            if entry <= ts <= exit_dt:
                should_be_in = True
                break
        
        if should_be_in:
            seasonal_cumulative = (1 + seasonal_cumulative / 100) * (1 + daily_ret) - 1
            seasonal_cumulative *= 100
        
        seasonal_curve.append(seasonal_cumulative)
    
    result = {
        "seasonal_curve": seasonal_curve,
        "bh_curve": bh_curve,
        "trades": trades_info,
        "dates": dates,
    }
    if data_warning:
        result["warning"] = data_warning
    return result


def get_plan_backtest_data(
    strategies: list[dict],
    year: int,
) -> dict:
    """
    Generate combined backtest data for multiple strategies.
    
    Args:
        strategies: List of strategy dicts with symbol, period, offset, threshold
        year: Year to backtest
    
    Returns:
        dict with:
        - combined_curve: list of daily P&L percentages for combined strategy
        - bh_curve: list of daily P&L percentages for buy & hold (first symbol)
        - strategy_curves: dict mapping strategy index to individual curves
        - trades_count: total number of trade entries
        - total_days: total days in market across all strategies
        - dates: list of date strings
    """
    if not strategies:
        return {"error": "No strategies provided"}
    
    # Collect all trading periods from all strategies
    all_trading_periods = []  # List of (entry, exit, symbol) tuples
    
    for strat in strategies:
        symbols = parse_symbols(strat.get("symbol", ""))
        period = strat.get("period", "monthly")
        offset = int(strat.get("offset", 0))
        threshold = int(strat.get("threshold", 50))
        
        if not symbols:
            continue
        
        # Load data
        if len(symbols) == 1:
            data = load_symbol_data(symbols[0])
        else:
            data = synthesize_basket(symbols)
        
        if data.empty:
            continue
        
        # Get seasonal analysis to find green runs
        seasonal_rows = generate_seasonal_data(data, period, offset, NUM_YEARS)
        runs = detect_runs(seasonal_rows, min_length=2, threshold_pct=threshold)
        green_runs = [r for r in runs if r.is_bullish]
        
        # For monthly, only include runs that START in first 12 months
        if period == "monthly":
            green_runs = [r for r in green_runs if r.start_idx < 12]
        
        # Build trading periods for this strategy
        for run in green_runs:
            entry_label = seasonal_rows[run.start_idx].label
            exit_label = seasonal_rows[run.end_idx].label
            entry_date_str = get_period_date_label(entry_label, period, offset, is_entry=True)
            exit_date_str = get_period_date_label(exit_label, period, offset, is_entry=False)
            
            all_trading_periods.append({
                "entry_date": entry_date_str,
                "exit_date": exit_date_str,
                "symbol": strat.get("symbol", ""),
            })
    
    if not all_trading_periods:
        return {"error": "No trades found in any strategy"}
    
    # Use first strategy's symbol for B&H reference
    first_symbols = parse_symbols(strategies[0].get("symbol", ""))
    if len(first_symbols) == 1:
        ref_data = load_symbol_data(first_symbols[0])
    else:
        ref_data = synthesize_basket(first_symbols)
    
    if ref_data.empty:
        return {"error": "No data for first strategy"}
    
    # Filter data for the specified year
    year_start = pd.Timestamp(year=year, month=1, day=1)
    year_end = pd.Timestamp(year=year, month=12, day=31)
    year_data = ref_data.loc[year_start:year_end].copy()
    
    if year_data.empty:
        return {"error": f"No data for year {year}"}
    
    # Convert trading period strings to date ranges
    def parse_mmm_dd(mmm_dd: str, ref_year: int) -> pd.Timestamp | None:
        """Parse 'Jan-15' format to timestamp."""
        try:
            month_map = {"Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6,
                        "Jul": 7, "Aug": 8, "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12}
            parts = mmm_dd.split("-")
            month = month_map.get(parts[0], 1)
            day = int(parts[1])
            max_day = calendar.monthrange(ref_year, month)[1]
            day = min(day, max_day)
            return pd.Timestamp(year=ref_year, month=month, day=day)
        except (ValueError, IndexError, KeyError):
            return None
    
    trading_ranges = []
    for tp in all_trading_periods:
        entry = parse_mmm_dd(tp["entry_date"], year)
        exit_dt = parse_mmm_dd(tp["exit_date"], year)
        if entry and exit_dt:
            if exit_dt < entry:
                exit_dt = parse_mmm_dd(tp["exit_date"], year + 1)
            if entry and exit_dt:
                trading_ranges.append((entry, exit_dt))
    
    # Calculate daily returns
    year_data["Daily_Return"] = year_data["Close"].pct_change()
    
    # Build equity curves
    dates = []
    combined_curve = []
    bh_curve = []
    
    bh_cumulative = 0.0
    combined_cumulative = 0.0
    total_days_in_market = 0
    
    for idx, row in year_data.iterrows():
        ts = pd.Timestamp(idx)
        date_str = f"{calendar.month_abbr[ts.month]}-{ts.day}"
        dates.append(date_str)
        
        daily_ret = row["Daily_Return"]
        if pd.isna(daily_ret):
            daily_ret = 0.0
        
        # Buy & Hold
        bh_cumulative = (1 + bh_cumulative / 100) * (1 + daily_ret) - 1
        bh_cumulative *= 100
        bh_curve.append(bh_cumulative)
        
        # Combined: in market if ANY strategy says to be in
        should_be_in = False
        for entry, exit_dt in trading_ranges:
            if entry <= ts <= exit_dt:
                should_be_in = True
                break
        
        if should_be_in:
            combined_cumulative = (1 + combined_cumulative / 100) * (1 + daily_ret) - 1
            combined_cumulative *= 100
            total_days_in_market += 1
        
        combined_curve.append(combined_cumulative)
    
    return {
        "combined_curve": combined_curve,
        "bh_curve": bh_curve,
        "strategy_curves": {},  # Could add individual curves if needed
        "trades_count": len(all_trading_periods),
        "total_days": total_days_in_market,
        "dates": dates,
        "trades": all_trading_periods,  # Include trade details for chart shading
    }


def export_plan_calendar_csv(strategies: list[dict]) -> str:
    """
    Generate unified trading calendar CSV from multiple strategies.
    
    Format: date,stockname,action (no headers)
    Sorted by date for easy execution.
    
    Args:
        strategies: List of strategy dicts with symbol, period, offset, threshold
    
    Returns:
        CSV content string
    """
    all_entries = []  # List of (month_idx, day, symbol, action) for sorting
    
    month_order = {"Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6,
                   "Jul": 7, "Aug": 8, "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12}
    
    for strat in strategies:
        symbols = parse_symbols(strat.get("symbol", ""))
        period = strat.get("period", "monthly")
        offset = int(strat.get("offset", 0))
        threshold = int(strat.get("threshold", 50))
        
        if not symbols:
            continue
        
        # Get trades for this strategy
        trades_data = get_trades(symbols, period, offset, threshold)
        
        if not trades_data.get("trades"):
            continue
        
        # Create display name
        if len(symbols) == 1:
            stock_name = symbols[0].replace(".NS", "")
        else:
            stock_name = "+".join(s.replace(".NS", "") for s in symbols)
        
        # Add entries
        for trade in trades_data["trades"]:
            entry_date = trade["entry_date"]  # e.g., "Jan-15"
            exit_date = trade["exit_date"]
            
            # Parse for sorting
            entry_parts = entry_date.split("-")
            exit_parts = exit_date.split("-")
            
            entry_month_idx = month_order.get(entry_parts[0], 0)
            entry_day = int(entry_parts[1])
            exit_month_idx = month_order.get(exit_parts[0], 0)
            exit_day = int(exit_parts[1])
            
            # Handle wraparound (exit month < entry month means next year)
            if exit_month_idx < entry_month_idx:
                exit_month_idx += 12  # Treat as month 13-24 for sorting
            
            all_entries.append((entry_month_idx, entry_day, entry_date, stock_name, "BUY"))
            all_entries.append((exit_month_idx, exit_day, exit_date, stock_name, "SELL"))
    
    # Sort by month, then day
    all_entries.sort(key=lambda x: (x[0], x[1]))
    
    # Generate CSV
    import io
    output = io.StringIO()
    
    for _, _, date_str, stock_name, action in all_entries:
        output.write(f"{date_str},{stock_name},{action}\n")
    
    return output.getvalue()
