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
NUM_YEARS = 20

MONTH_NAMES = [calendar.month_abbr[i] for i in range(1, 13)]

# In-memory cache for loaded symbol DataFrames to avoid repeated CSV reads.
# Key: symbol string, Value: (DataFrame, timestamp of last load)
_symbol_cache: dict[str, pd.DataFrame] = {}


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
    # Drop rows with NaT in the index (from unparseable dates)
    df = df[df.index.notna()]
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
    
    # Return from in-memory cache if available and data is recent
    # (use 4-day window to account for weekends and holidays)
    if symbol_key in _symbol_cache:
        cached_df = _symbol_cache[symbol_key]
        cutoff = pd.Timestamp.now().normalize() - pd.Timedelta(days=4)
        if not cached_df.empty and cached_df.index.max().normalize() >= cutoff:
            return cached_df
    
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
    _symbol_cache[symbol_key] = updated
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
# Sliding Window Detection
# =============================================================================

@dataclass
class SlidingWindow:
    """A detected investment window from sliding window analysis."""
    start_day: int  # Day of year (1-366)
    end_day: int    # Day of year (1-366), inclusive
    length: int     # Number of days
    avg_return: float  # Average return % across years
    win_rate: float    # Fraction of years with positive return (0-1)
    score: float       # avg_return * win_rate
    yield_per_day: float  # avg_return / length (basis points per day)
    year_returns: dict[int, float | None]  # Per-year returns
    
    @property
    def start_date_str(self) -> str:
        """Convert start_day to 'Mon-DD' format."""
        # Use a non-leap year as reference
        ref_date = dt.date(2023, 1, 1) + dt.timedelta(days=self.start_day - 1)
        return f"{calendar.month_abbr[ref_date.month]}-{ref_date.day}"
    
    @property
    def end_date_str(self) -> str:
        """Convert end_day to 'Mon-DD' format."""
        ref_date = dt.date(2023, 1, 1) + dt.timedelta(days=self.end_day - 1)
        return f"{calendar.month_abbr[ref_date.month]}-{ref_date.day}"


def day_of_year(month: int, day: int) -> int:
    """Convert month/day to day of year (1-366)."""
    ref_date = dt.date(2023, 1, 1)
    target = dt.date(2023, month, day)
    return (target - ref_date).days + 1


def date_from_day_of_year(doy: int) -> tuple[int, int]:
    """Convert day of year to (month, day)."""
    ref_date = dt.date(2023, 1, 1) + dt.timedelta(days=doy - 1)
    return ref_date.month, ref_date.day


@dataclass
class YearlyReturnsCache:
    """
    Precomputed cumulative returns for efficient window calculations.
    
    For each year, stores cumulative product of (1 + daily_return) indexed by day of year.
    This allows O(1) calculation of any window's return via: cum[end] / cum[start-1] - 1
    """
    years: list[int]
    # cum_returns[year][doy] = cumulative product from day 1 to day doy
    # return for window [start, end] = cum[end] / cum[start-1] - 1
    cum_returns: dict[int, dict[int, float]]
    # Valid range for each year (first and last day with data)
    valid_ranges: dict[int, tuple[int, int]]
    
    def get_return(self, year: int, start_doy: int, end_doy: int) -> float | None:
        """
        Get return for a window in O(1) time, using nearest trading days.
        
        Windows must be within a single year (end_doy <= 365).
        """
        if year not in self.cum_returns:
            return None
        
        year_data = self.cum_returns[year]
        valid_start, valid_end = self.valid_ranges.get(year, (366, 0))
        
        # Check if window is roughly within valid range
        if start_doy < valid_start - 5 or end_doy > valid_end + 5:
            return None
        
        # Find nearest trading day for end_doy (search nearby)
        actual_end = self._find_nearest_day(year_data, end_doy, valid_start, valid_end)
        if actual_end is None:
            return None
        
        # Find nearest trading day for start_doy - 1
        if start_doy == 1:
            start_cum = 1.0
        else:
            actual_start_prev = self._find_nearest_day(year_data, start_doy - 1, valid_start, valid_end)
            if actual_start_prev is None:
                return None
            start_cum = year_data[actual_start_prev]
        
        end_cum = year_data[actual_end]
        
        if start_cum == 0:
            return None
        
        return (end_cum / start_cum - 1) * 100
    
    def _find_nearest_day(self, year_data: dict[int, float], target_doy: int, valid_start: int, valid_end: int) -> int | None:
        """Find nearest trading day to target within a few days."""
        # Check exact match first
        if target_doy in year_data:
            return target_doy
        
        # Search nearby (up to 5 days in each direction)
        for offset in range(1, 6):
            # Check before
            if target_doy - offset >= valid_start and (target_doy - offset) in year_data:
                return target_doy - offset
            # Check after
            if target_doy + offset <= valid_end and (target_doy + offset) in year_data:
                return target_doy + offset
        
        return None


def build_returns_cache(df: pd.DataFrame, years: list[int]) -> YearlyReturnsCache:
    """
    Build precomputed returns cache for efficient window scoring.
    
    Uses numpy vectorization instead of iterrows for ~20x speedup.
    """
    cum_returns: dict[int, dict[int, float]] = {}
    valid_ranges: dict[int, tuple[int, int]] = {}
    
    for year in years:
        year_start = pd.Timestamp(year=year, month=1, day=1)
        year_end = pd.Timestamp(year=year, month=12, day=31)
        
        year_data = df.loc[year_start:year_end]
        if year_data.empty:
            continue
        
        closes = year_data["Close"].values
        if len(closes) < 2:
            continue
        
        # Vectorized: day-of-year extraction and cumulative product
        doys = year_data.index.dayofyear.values
        daily_rets = np.empty(len(closes))
        daily_rets[0] = 1.0
        daily_rets[1:] = closes[1:] / closes[:-1]
        cum_arr = np.cumprod(daily_rets)
        
        # Build dict from numpy arrays (fast zip, no per-row overhead)
        cum = dict(zip(doys.tolist(), cum_arr.tolist()))
        first_doy = int(doys[0])
        last_doy = int(doys[-1])
        
        cum_returns[year] = cum
        valid_ranges[year] = (first_doy, last_doy)
    
    return YearlyReturnsCache(years=years, cum_returns=cum_returns, valid_ranges=valid_ranges)


def score_window_fast(
    cache: YearlyReturnsCache,
    start_doy: int,
    end_doy: int,
    min_years: int = 5,
) -> tuple[float, float, float, dict[int, float | None]] | None:
    """
    Score a window using precomputed cache - O(years) time.
    
    Returns:
        (avg_return, win_rate, score, year_returns) or None if insufficient data
    """
    year_returns: dict[int, float | None] = {}
    valid_returns: list[float] = []
    
    for year in cache.years:
        ret = cache.get_return(year, start_doy, end_doy)
        year_returns[year] = ret
        if ret is not None:
            valid_returns.append(ret)
    
    if len(valid_returns) < min_years:
        return None
    
    avg_return = sum(valid_returns) / len(valid_returns)
    win_count = sum(1 for r in valid_returns if r >= 0)
    win_rate = win_count / len(valid_returns)
    score = avg_return * win_rate
    
    return avg_return, win_rate, score, year_returns


# NOTE: find_best_window_fast and narrow_window_fast are currently unused.
# They support variable-length window search and yield optimization.
# Kept for potential future use.

def find_best_window_fast(
    cache: YearlyReturnsCache,
    max_days: int,
    excluded_days: set[int] | None = None,
    min_window: int = 5,
    threshold: float = 0.5,
) -> SlidingWindow | None:
    """
    Find the best investment window up to max_days length.
    Uses precomputed cache for O(365 × max_days × years) total.
    
    Args:
        cache: Precomputed returns cache
        max_days: Maximum window length in days
        excluded_days: Set of day-of-year values that are already used
        min_window: Minimum window length in days
        threshold: Minimum win rate to consider (0-1)
    
    Returns:
        Best SlidingWindow or None if no valid window found
    """
    if excluded_days is None:
        excluded_days = set()
    
    best_window: SlidingWindow | None = None
    best_score = float('-inf')
    
    # Scan all possible start days
    for start_doy in range(1, 366):
        # Skip if start day is excluded
        if start_doy in excluded_days:
            continue
        
        # Try all window lengths from min to max
        for length in range(min_window, max_days + 1):
            end_doy = start_doy + length - 1
            
            # Keep windows within single year
            if end_doy > 365:
                break
            
            # Check if any day in window is excluded
            if excluded_days:
                has_excluded = False
                for d in range(start_doy, end_doy + 1):
                    if d in excluded_days:
                        has_excluded = True
                        break
                if has_excluded:
                    break  # This and longer windows from this start are invalid
            
            # Score the window using cache
            result = score_window_fast(cache, start_doy, end_doy)
            if result is None:
                continue
            
            avg_return, win_rate, score, year_returns = result
            
            # Must meet threshold
            if win_rate < threshold:
                continue
            
            # Only consider bullish windows (positive avg return)
            if avg_return <= 0:
                continue
            
            if score > best_score:
                best_score = score
                best_window = SlidingWindow(
                    start_day=start_doy,
                    end_day=end_doy,
                    length=length,
                    avg_return=avg_return,
                    win_rate=win_rate,
                    score=score,
                    yield_per_day=avg_return / length,
                    year_returns=year_returns,
                )
    
    return best_window


def narrow_window_fast(
    cache: YearlyReturnsCache,
    window: SlidingWindow,
    min_window: int = 5,
    threshold: float = 0.5,
) -> SlidingWindow:
    """
    Narrow a window to maximize yield (return per day).
    Uses precomputed cache for efficiency.
    
    Args:
        cache: Precomputed returns cache
        window: The window to narrow
        min_window: Minimum window length in days
        threshold: Minimum win rate to consider (0-1)
    
    Returns:
        Narrowed window (may be same as input if no improvement found)
    """
    best_window = window
    best_yield = window.yield_per_day
    
    # Try all sub-windows
    for trim_start in range(window.length - min_window + 1):
        for trim_end in range(window.length - trim_start - min_window + 1):
            new_start = window.start_day + trim_start
            new_end = window.end_day - trim_end
            new_length = new_end - new_start + 1
            
            if new_length < min_window:
                continue
            
            result = score_window_fast(cache, new_start, new_end)
            if result is None:
                continue
            
            avg_return, win_rate, score, year_returns = result
            
            # Must meet threshold and be bullish
            if win_rate < threshold or avg_return <= 0:
                continue
            
            yield_per_day = avg_return / new_length
            
            if yield_per_day > best_yield:
                best_yield = yield_per_day
                best_window = SlidingWindow(
                    start_day=new_start,
                    end_day=new_end,
                    length=new_length,
                    avg_return=avg_return,
                    win_rate=win_rate,
                    score=score,
                    yield_per_day=yield_per_day,
                    year_returns=year_returns,
                )
    
    return best_window


def find_best_fixed_window(
    cache: YearlyReturnsCache,
    window_size: int,
    range_start: int = 1,
    range_end: int = 365,
    threshold: float = 0.5,
) -> SlidingWindow | None:
    """
    Find the best window of EXACTLY window_size days within [range_start, range_end].
    
    Only considers windows that fit entirely within the given range.
    
    Args:
        cache: Precomputed returns cache
        window_size: Exact window length in days
        range_start: First allowed day-of-year (inclusive, 1-365)
        range_end: Last allowed day-of-year (inclusive, 1-365)
        threshold: Minimum win rate to consider (0-1)
    
    Returns:
        Best SlidingWindow or None if no valid window found
    """
    best_window: SlidingWindow | None = None
    best_score = float('-inf')
    
    # Window must fit within [range_start, range_end]
    last_start = range_end - window_size + 1
    if last_start < range_start:
        return None
    
    for start_doy in range(range_start, last_start + 1):
        end_doy = start_doy + window_size - 1
        
        result = score_window_fast(cache, start_doy, end_doy)
        if result is None:
            continue
        
        avg_return, win_rate, score, year_returns = result
        
        if win_rate < threshold:
            continue
        if avg_return <= 0:
            continue
        
        if score > best_score:
            best_score = score
            best_window = SlidingWindow(
                start_day=start_doy,
                end_day=end_doy,
                length=window_size,
                avg_return=avg_return,
                win_rate=win_rate,
                score=score,
                yield_per_day=avg_return / window_size,
                year_returns=year_returns,
            )
    
    return best_window


def detect_sliding_windows(
    df: pd.DataFrame,
    window_size: int = 30,
    threshold: float = 0.5,
) -> list[SlidingWindow]:
    """
    Detect best investment windows using range-splitting algorithm.
    
    Algorithm:
    1. Precompute cumulative returns for all years (done once)
    2. Start with search range [1, 365]
    3. Find the best window of exactly window_size days in the range
    4. That window splits the range into two sub-ranges (left and right)
    5. Recurse into each sub-range that can still fit a window
    6. Collect all found windows, sorted by start day
    
    Args:
        df: DataFrame with OHLC data
        window_size: Fixed window length in days (e.g., 30)
        threshold: Minimum win rate (0-1), default 0.5 (50%)
    
    Returns:
        List of detected SlidingWindow objects, sorted by start day
    """
    if df.empty:
        return []
    
    years = get_years_from_data(df)
    if len(years) < 5:
        return []
    
    # Build cache once for all window calculations
    cache = build_returns_cache(df, years)
    
    def _find_in_range(range_start: int, range_end: int) -> list[SlidingWindow]:
        """Recursively find windows by splitting ranges."""
        # Can't fit a window in this range
        if range_end - range_start + 1 < window_size:
            return []
        
        window = find_best_fixed_window(
            cache, window_size, range_start, range_end, threshold
        )
        
        if window is None:
            return []
        
        results = [window]
        
        # Left sub-range: [range_start, window.start_day - 1]
        results.extend(_find_in_range(range_start, window.start_day - 1))
        
        # Right sub-range: [window.end_day + 1, range_end]
        results.extend(_find_in_range(window.end_day + 1, range_end))
        
        return results
    
    windows = _find_in_range(1, 365)
    windows.sort(key=lambda w: w.start_day)
    
    return windows


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
    
    # Vectorized daily returns
    closes = year_data["Close"].values
    daily_ret = np.empty(len(closes))
    daily_ret[0] = 0.0
    daily_ret[1:] = closes[1:] / closes[:-1] - 1.0
    
    # Vectorized buy-and-hold curve
    bh_curve = (np.cumprod(1.0 + daily_ret) - 1.0) * 100.0
    
    # Build boolean mask for trading periods
    idx_values = year_data.index.values
    in_market = np.zeros(len(idx_values), dtype=bool)
    for entry_ts, exit_ts in trading_periods:
        entry_np = np.datetime64(entry_ts)
        exit_np = np.datetime64(exit_ts)
        in_market |= (idx_values >= entry_np) & (idx_values <= exit_np)
    
    # Vectorized seasonal curve
    masked_ret = np.where(in_market, daily_ret, 0.0)
    seasonal_curve = (np.cumprod(1.0 + masked_ret) - 1.0) * 100.0
    
    # Vectorized date formatting
    months = year_data.index.month.values
    days_arr = year_data.index.day.values
    month_abbrs = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                   'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    dates = [f"{month_abbrs[m]}-{d}" for m, d in zip(months.tolist(), days_arr.tolist())]
    
    result = {
        "seasonal_curve": seasonal_curve.tolist(),
        "bh_curve": bh_curve.tolist(),
        "trades": trades_info,
        "dates": dates,
    }
    if data_warning:
        result["warning"] = data_warning
    return result


def get_window_backtest_data(
    symbol: str,
    window_size: int,
    threshold: int,
    year: int,
) -> dict:
    """
    Generate backtest data for sliding window mode.
    
    Uses detected windows as trading periods and builds daily equity curves
    comparing the window strategy vs buy & hold.
    
    Args:
        symbol: Stock symbol
        window_size: Fixed window length in days
        threshold: Win rate threshold percentage (50-100)
        year: Year to backtest
    
    Returns:
        dict with seasonal_curve, bh_curve, trades, dates, and optional warning
    """
    df = load_symbol_data(symbol)
    if df.empty:
        return {"error": "No data available", "seasonal_curve": [], "bh_curve": [], "trades": [], "dates": []}
    
    # Detect windows using the same params
    windows = detect_sliding_windows(df, window_size=window_size, threshold=threshold / 100)
    
    if not windows:
        return {"error": "No windows detected", "seasonal_curve": [], "bh_curve": [], "trades": [], "dates": []}
    
    # Filter data for the specified year
    year_start = pd.Timestamp(year=year, month=1, day=1)
    year_end = pd.Timestamp(year=year, month=12, day=31)
    year_data = df.loc[year_start:year_end].copy()
    
    if year_data.empty:
        return {"error": f"No data for year {year}", "seasonal_curve": [], "bh_curve": [], "trades": [], "dates": []}
    
    # Check for sparse data
    data_warning = None
    if len(year_data) < 200:
        data_warning = f"Incomplete data: only {len(year_data)} trading days (expected ~245)"
    
    # Convert windows (day-of-year based) to actual date ranges for this year
    trades_info = []
    ts_ranges = []
    for w in windows:
        start_date = dt.date(year, 1, 1) + dt.timedelta(days=w.start_day - 1)
        end_date = dt.date(year, 1, 1) + dt.timedelta(days=w.end_day - 1)
        entry_str = f"{calendar.month_abbr[start_date.month]}-{start_date.day}"
        exit_str = f"{calendar.month_abbr[end_date.month]}-{end_date.day}"
        trades_info.append({
            "entry_date": entry_str,
            "exit_date": exit_str,
            "days": w.length,
        })
        ts_ranges.append((
            pd.Timestamp(start_date),
            pd.Timestamp(end_date),
        ))
    
    # Vectorized daily returns
    closes = year_data["Close"].values
    daily_ret = np.empty(len(closes))
    daily_ret[0] = 0.0
    daily_ret[1:] = closes[1:] / closes[:-1] - 1.0
    
    # Vectorized buy-and-hold curve
    bh_curve = (np.cumprod(1.0 + daily_ret) - 1.0) * 100.0
    
    # Build boolean mask for window periods
    idx_values = year_data.index.values
    in_market = np.zeros(len(idx_values), dtype=bool)
    for entry_ts, exit_ts in ts_ranges:
        entry_np = np.datetime64(entry_ts)
        exit_np = np.datetime64(exit_ts)
        in_market |= (idx_values >= entry_np) & (idx_values <= exit_np)
    
    # Vectorized seasonal curve
    masked_ret = np.where(in_market, daily_ret, 0.0)
    seasonal_curve = (np.cumprod(1.0 + masked_ret) - 1.0) * 100.0
    
    # Vectorized date formatting
    months = year_data.index.month.values
    days_arr = year_data.index.day.values
    month_abbrs = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                   'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    dates = [f"{month_abbrs[m]}-{d}" for m, d in zip(months.tolist(), days_arr.tolist())]
    
    result = {
        "seasonal_curve": seasonal_curve.tolist(),
        "bh_curve": bh_curve.tolist(),
        "trades": trades_info,
        "dates": dates,
    }
    if data_warning:
        result["warning"] = data_warning
    return result


def _build_average_year_series(
    df: pd.DataFrame,
    years: list[int],
) -> tuple[np.ndarray, np.ndarray, list[str]] | None:
    """
    Build a synthetic average-year price series from daily returns.
    
    For each day-of-year, averages the daily return across all years that
    have a trading day at that DOY. Reconstructs a synthetic price series
    starting from 1.0. This represents "the average price behavior" of the
    stock throughout the year.
    
    Args:
        df: Full DataFrame with Close prices.
        years: List of years to include.
    
    Returns:
        Tuple of (avg_daily_returns, avg_doys, date_labels) or None.
        avg_daily_returns: 1D array of average daily returns per trading DOY.
        avg_doys: 1D int array of day-of-year values (sorted).
        date_labels: List of "Mon-D" strings for each DOY.
    """
    from collections import defaultdict
    
    # Collect daily returns keyed by day-of-year
    doy_returns: dict[int, list[float]] = defaultdict(list)
    
    for year in years:
        year_start = pd.Timestamp(year=year, month=1, day=1)
        year_end = pd.Timestamp(year=year, month=12, day=31)
        year_data = df.loc[year_start:year_end]
        
        if year_data.empty or len(year_data) < 100:
            continue
        
        closes = year_data["Close"].values
        doys = year_data.index.dayofyear.values
        
        # Daily returns (first day = 0.0)
        rets = np.empty(len(closes))
        rets[0] = 0.0
        rets[1:] = closes[1:] / closes[:-1] - 1.0
        
        for doy, ret in zip(doys.tolist(), rets.tolist()):
            doy_returns[doy].append(ret)
    
    if not doy_returns:
        return None
    
    # Sort by DOY and compute average return per DOY
    sorted_doys = sorted(doy_returns.keys())
    avg_rets = np.array([np.mean(doy_returns[d]) for d in sorted_doys])
    avg_doys = np.array(sorted_doys)
    
    # First trading day should have 0 return (no prior day to compare)
    avg_rets[0] = 0.0
    
    # Build date labels from DOY using a reference non-leap year
    month_abbrs = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                   'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    date_labels = []
    for doy in sorted_doys:
        ref_date = dt.date(2023, 1, 1) + dt.timedelta(days=doy - 1)
        date_labels.append(f"{month_abbrs[ref_date.month]}-{ref_date.day}")
    
    return avg_rets, avg_doys, date_labels


def get_window_backtest_average(
    symbol: str,
    window_size: int,
    threshold: int,
) -> dict:
    """
    Generate average backtest data across all available years.
    
    Builds a synthetic average-year price series by averaging daily returns
    per day-of-year across all years, then simulates buying/selling on that
    single synthetic series.
    
    Args:
        symbol: Stock symbol
        window_size: Fixed window length in days
        threshold: Win rate threshold percentage (50-100)
    
    Returns:
        dict with seasonal_curve, bh_curve, trades, dates (same format as single year)
    """
    df = load_symbol_data(symbol)
    if df.empty:
        return {"error": "No data available", "seasonal_curve": [], "bh_curve": [], "trades": [], "dates": []}
    
    # Detect windows once
    windows = detect_sliding_windows(df, window_size=window_size, threshold=threshold / 100)
    if not windows:
        return {"error": "No windows detected", "seasonal_curve": [], "bh_curve": [], "trades": [], "dates": []}
    
    years = get_years_from_data(df)
    if not years:
        return {"error": "No complete years available", "seasonal_curve": [], "bh_curve": [], "trades": [], "dates": []}
    
    # Build synthetic average-year series
    avg_result = _build_average_year_series(df, years)
    if avg_result is None:
        return {"error": "No valid years for averaging", "seasonal_curve": [], "bh_curve": [], "trades": [], "dates": []}
    
    avg_rets, avg_doys, date_labels = avg_result
    
    # Build trades info (based on detected windows)
    trades_info = []
    for w in windows:
        ref_date_start = dt.date(2023, 1, 1) + dt.timedelta(days=w.start_day - 1)
        ref_date_end = dt.date(2023, 1, 1) + dt.timedelta(days=w.end_day - 1)
        trades_info.append({
            "entry_date": f"{calendar.month_abbr[ref_date_start.month]}-{ref_date_start.day}",
            "exit_date": f"{calendar.month_abbr[ref_date_end.month]}-{ref_date_end.day}",
            "days": w.length,
        })
    
    # Buy-and-hold curve on the synthetic series
    bh_curve = (np.cumprod(1.0 + avg_rets) - 1.0) * 100.0
    
    # Build boolean mask: in market if DOY falls within any window
    in_market = np.zeros(len(avg_doys), dtype=bool)
    for w in windows:
        in_market |= (avg_doys >= w.start_day) & (avg_doys <= w.end_day)
    
    # Seasonal curve: only capture returns when in market
    masked_ret = np.where(in_market, avg_rets, 0.0)
    seasonal_curve = (np.cumprod(1.0 + masked_ret) - 1.0) * 100.0
    
    return {
        "seasonal_curve": seasonal_curve.tolist(),
        "bh_curve": bh_curve.tolist(),
        "trades": trades_info,
        "dates": date_labels,
        "avg_years": len(years),
    }


def _load_strategy_windows(
    strategies: list[dict],
) -> tuple[list[dict], list[tuple[int, int]], pd.DataFrame, list[pd.DataFrame], list[str]] | None:
    """
    Load data and detect windows for each strategy (once).
    
    Returns:
        Tuple of (trading_period_templates, window_day_ranges, ref_data, window_dfs, unique_symbols)
        or None if no valid windows found.
        
        trading_period_templates: list of {start_day, end_day, symbol} dicts.
        window_day_ranges: list of (start_day, end_day) 1-365 pairs.
        ref_data: DataFrame for B&H reference (first strategy's data).
        window_dfs: list of DataFrames, one per window (each window's own stock data).
        unique_symbols: ordered list of unique display symbols (for coloring).
    """
    all_templates: list[dict] = []
    all_day_ranges: list[tuple[int, int]] = []
    all_window_dfs: list[pd.DataFrame] = []
    all_strategy_dfs: list[pd.DataFrame] = []  # one per unique strategy
    unique_symbols: list[str] = []
    ref_data = pd.DataFrame()
    
    for i, strat in enumerate(strategies):
        symbol = strat.get("symbol", "")
        window_size = int(strat.get("window_size", 30))
        threshold = int(strat.get("threshold", 50))
        
        if not symbol:
            continue
        
        symbols = parse_symbols(symbol)
        if len(symbols) == 1:
            df = load_symbol_data(symbols[0])
        else:
            df = synthesize_basket(symbols)
        
        if df.empty:
            continue
        
        # Keep first strategy's data as B&H reference
        if i == 0:
            ref_data = df
        
        display_symbol = symbol.replace(".NS", "")
        
        windows = detect_sliding_windows(df, window_size=window_size, threshold=threshold / 100)
        
        if not windows:
            continue
        
        if display_symbol not in unique_symbols:
            unique_symbols.append(display_symbol)
            all_strategy_dfs.append(df)
        
        for w in windows:
            all_templates.append({
                "start_day": w.start_day,
                "end_day": w.end_day,
                "symbol": display_symbol,
            })
            all_day_ranges.append((w.start_day, w.end_day))
            all_window_dfs.append(df)
    
    if not all_templates or ref_data.empty:
        return None
    
    return all_templates, all_day_ranges, ref_data, all_window_dfs, unique_symbols


def get_plan_overlap(
    symbol: str,
    window_size: int,
    threshold: int,
    strategies: list[dict],
) -> dict:
    """
    Compute DOY overlap between a stock's windows and the existing plan's windows.

    Args:
        symbol: Current stock symbol (e.g. "RELIANCE.NS")
        window_size: Window size for current stock
        threshold: Win rate threshold (0-100) for current stock
        strategies: Existing plan strategies (list of dicts with symbol, window_size, threshold)

    Returns:
        dict with plan_windows, stock_days, plan_days, overlap_days, new_days
    """
    # Detect windows for current stock
    symbols = parse_symbols(symbol)
    if len(symbols) == 1:
        df = load_symbol_data(symbols[0])
    else:
        df = synthesize_basket(symbols)

    if df.empty:
        return {"error": f"No data for {symbol}"}

    stock_windows = detect_sliding_windows(df, window_size=window_size, threshold=threshold / 100)

    # Build DOY set for current stock
    stock_days: set[int] = set()
    for w in stock_windows:
        stock_days.update(range(w.start_day, w.end_day + 1))

    # Load plan windows
    loaded = _load_strategy_windows(strategies)
    if loaded is None:
        return {
            "plan_windows": [],
            "stock_days": len(stock_days),
            "plan_days": 0,
            "overlap_days": 0,
            "new_days": len(stock_days),
        }

    _templates, plan_day_ranges, _ref_data, _window_dfs, _syms = loaded

    # Build DOY set for plan
    plan_days: set[int] = set()
    for start_day, end_day in plan_day_ranges:
        plan_days.update(range(start_day, end_day + 1))

    overlap = stock_days & plan_days
    new_days = stock_days - plan_days

    return {
        "plan_windows": list(plan_day_ranges),
        "stock_days": len(stock_days),
        "plan_days": len(plan_days),
        "overlap_days": len(overlap),
        "new_days": len(new_days),
    }


def _build_equity_curve(
    ref_data: pd.DataFrame,
    templates: list[dict],
    day_ranges: list[tuple[int, int]],
    year: int,
    window_dfs: list[pd.DataFrame] | None = None,
    unique_symbols: list[str] | None = None,
) -> dict | None:
    """
    Build equity curves for a single year using pre-computed window ranges.
    
    Uses dynamic equal-weight allocation: on each day, capital is split equally
    among all strategies whose windows are active. Each strategy uses its own
    stock's daily returns.
    
    Also builds per-strategy individual curves (each strategy traded alone)
    and an equal-weight B&H curve across all unique stocks.
    
    Args:
        ref_data: DataFrame for B&H reference and date index.
        templates: list of {start_day, end_day, symbol} dicts.
        day_ranges: list of (start_day, end_day) 1-365 DOY pairs.
        year: Year to backtest.
        window_dfs: list of DataFrames, one per window. If None, falls back to
                    ref_data for all windows (single-stock behavior).
        unique_symbols: ordered list of unique display symbols.
    
    Returns:
        Result dict or None if no data for that year.
    """
    year_start = pd.Timestamp(year=year, month=1, day=1)
    year_end = pd.Timestamp(year=year, month=12, day=31)
    year_data = ref_data.loc[year_start:year_end]
    
    if year_data.empty:
        return None
    
    if unique_symbols is None:
        unique_symbols = []
    
    # Convert day-of-year ranges to actual date ranges for this year
    all_trading_periods = []
    ts_ranges = []
    for tmpl, (start_day, end_day) in zip(templates, day_ranges):
        start_date = dt.date(year, 1, 1) + dt.timedelta(days=start_day - 1)
        end_date = dt.date(year, 1, 1) + dt.timedelta(days=end_day - 1)
        entry_str = f"{calendar.month_abbr[start_date.month]}-{start_date.day}"
        exit_str = f"{calendar.month_abbr[end_date.month]}-{end_date.day}"
        
        all_trading_periods.append({
            "entry_date": entry_str,
            "exit_date": exit_str,
            "symbol": tmpl["symbol"],
        })
        ts_ranges.append((
            pd.Timestamp(start_date),
            pd.Timestamp(end_date),
        ))
    
    # Build per-window daily return arrays and boolean masks
    idx_values = year_data.index.values
    n_days = len(idx_values)
    n_windows = len(ts_ranges)
    
    # Per-window masks: which days each window is active
    window_masks = np.zeros((n_windows, n_days), dtype=bool)
    # Per-window daily returns aligned to ref_data's date index
    window_rets = np.zeros((n_windows, n_days))
    
    # Track per-stock daily returns for B&H (keyed by df id to avoid duplicates)
    df_id_to_rets: dict[int, np.ndarray] = {}
    
    for w_idx, (entry_ts, exit_ts) in enumerate(ts_ranges):
        entry_np = np.datetime64(entry_ts)
        exit_np = np.datetime64(exit_ts)
        window_masks[w_idx] = (idx_values >= entry_np) & (idx_values <= exit_np)
        
        # Get this window's stock data
        if window_dfs is not None:
            w_df = window_dfs[w_idx]
            df_id = id(w_df)
            
            if df_id not in df_id_to_rets:
                w_year = w_df.loc[year_start:year_end]
                if not w_year.empty:
                    w_closes = w_year["Close"].reindex(year_data.index)
                    w_vals = w_closes.values
                    w_ret = np.empty(n_days)
                    w_ret[0] = 0.0
                    for j in range(1, n_days):
                        if np.isnan(w_vals[j]) or np.isnan(w_vals[j - 1]) or w_vals[j - 1] == 0:
                            w_ret[j] = 0.0
                        else:
                            w_ret[j] = w_vals[j] / w_vals[j - 1] - 1.0
                    df_id_to_rets[df_id] = w_ret
                else:
                    df_id_to_rets[df_id] = np.zeros(n_days)
            
            window_rets[w_idx] = df_id_to_rets[df_id]
            if np.all(df_id_to_rets[df_id] == 0):
                window_masks[w_idx] = False
        else:
            # Fallback: all windows use ref_data returns
            closes = year_data["Close"].values
            daily_ret = np.empty(len(closes))
            daily_ret[0] = 0.0
            daily_ret[1:] = closes[1:] / closes[:-1] - 1.0
            window_rets[w_idx] = daily_ret
    
    # Dynamic equal-weight blended return per day
    active_count = window_masks.sum(axis=0)  # shape (n_days,)
    active_ret_sum = (window_masks * window_rets).sum(axis=0)  # shape (n_days,)
    safe_count = np.where(active_count > 0, active_count, 1)
    blended_ret = np.where(active_count > 0, active_ret_sum / safe_count, 0.0)
    
    combined_curve = (np.cumprod(1.0 + blended_ret) - 1.0) * 100.0
    total_days_in_market = int(np.sum(active_count > 0))
    
    # Build per-strategy curves: each strategy's windows traded in isolation
    strategy_curves: dict[str, list[float]] = {}
    for sym in unique_symbols:
        # Find all windows belonging to this symbol
        sym_mask = np.zeros(n_days, dtype=bool)
        sym_ret_sum = np.zeros(n_days)
        sym_count = np.zeros(n_days, dtype=int)
        for w_idx, tmpl in enumerate(templates):
            if tmpl["symbol"] == sym:
                sym_mask |= window_masks[w_idx]
                sym_ret_sum += window_masks[w_idx] * window_rets[w_idx]
                sym_count += window_masks[w_idx].astype(int)
        
        sym_safe = np.where(sym_count > 0, sym_count, 1)
        sym_blended = np.where(sym_mask, sym_ret_sum / sym_safe, 0.0)
        sym_curve = (np.cumprod(1.0 + sym_blended) - 1.0) * 100.0
        strategy_curves[sym] = sym_curve.tolist()
    
    # Equal-weight B&H: average daily returns across all unique stocks
    if window_dfs is not None and df_id_to_rets:
        unique_rets = list(df_id_to_rets.values())
        bh_blended = np.mean(unique_rets, axis=0)
    else:
        closes = year_data["Close"].values
        bh_blended = np.empty(len(closes))
        bh_blended[0] = 0.0
        bh_blended[1:] = closes[1:] / closes[:-1] - 1.0
    bh_curve = (np.cumprod(1.0 + bh_blended) - 1.0) * 100.0
    
    # Vectorized date formatting
    months = year_data.index.month.values
    days = year_data.index.day.values
    month_abbrs = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                   'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    dates = [f"{month_abbrs[m]}-{d}" for m, d in zip(months.tolist(), days.tolist())]
    
    return {
        "combined_curve": combined_curve.tolist(),
        "bh_curve": bh_curve.tolist(),
        "strategy_curves": strategy_curves,
        "trades_count": len(all_trading_periods),
        "total_days": total_days_in_market,
        "dates": dates,
        "trades": all_trading_periods,
        "symbols": unique_symbols,
    }


def get_plan_backtest_data(
    strategies: list[dict],
    year: int,
) -> dict:
    """
    Generate combined backtest data for multiple window-mode strategies.
    
    Each strategy has: symbol, window_size, threshold.
    For a given year, detects windows for each strategy, combines all trading
    periods, and builds a unified equity curve vs buy & hold.
    
    Args:
        strategies: List of strategy dicts with symbol, window_size, threshold
        year: Year to backtest
    
    Returns:
        dict with combined_curve, bh_curve, trades_count, total_days, dates, trades
    """
    if not strategies:
        return {"error": "No strategies provided"}
    
    loaded = _load_strategy_windows(strategies)
    if loaded is None:
        return {"error": "No windows detected in any strategy"}
    
    templates, day_ranges, ref_data, window_dfs, unique_symbols = loaded
    result = _build_equity_curve(ref_data, templates, day_ranges, year, window_dfs, unique_symbols)
    
    if result is None:
        return {"error": f"No data for year {year}"}
    
    return result


def get_plan_backtest_average(
    strategies: list[dict],
) -> dict:
    """
    Generate average plan backtest across all available years.
    
    Builds a synthetic average-year return series for each strategy's stock,
    then simulates dynamic equal-weight allocation: on each day, capital is
    split equally among all strategies whose windows are active.
    
    Args:
        strategies: List of strategy dicts with symbol, window_size, threshold
    
    Returns:
        dict with combined_curve, bh_curve, dates, trades (same format + avg_years)
    """
    if not strategies:
        return {"error": "No strategies provided"}
    
    loaded = _load_strategy_windows(strategies)
    if loaded is None:
        return {"error": "No windows detected in any strategy"}
    
    templates, day_ranges, ref_data, window_dfs, unique_symbols = loaded
    
    years = get_years_from_data(ref_data)
    if not years:
        return {"error": "No complete years available"}
    
    # Build synthetic average-year series from reference data (for DOY grid)
    avg_result = _build_average_year_series(ref_data, years)
    if avg_result is None:
        return {"error": "No valid years for averaging"}
    
    avg_rets, avg_doys, date_labels = avg_result
    n_days = len(avg_doys)
    
    # Build trades info from templates
    month_abbrs = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                   'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    trades_info = []
    for tmpl, (start_day, end_day) in zip(templates, day_ranges):
        ref_start = dt.date(2023, 1, 1) + dt.timedelta(days=start_day - 1)
        ref_end = dt.date(2023, 1, 1) + dt.timedelta(days=end_day - 1)
        trades_info.append({
            "entry_date": f"{month_abbrs[ref_start.month]}-{ref_start.day}",
            "exit_date": f"{month_abbrs[ref_end.month]}-{ref_end.day}",
            "symbol": tmpl["symbol"],
        })
    
    # Build per-window average return series and masks
    n_windows = len(day_ranges)
    window_masks = np.zeros((n_windows, n_days), dtype=bool)
    window_avg_rets = np.zeros((n_windows, n_days))
    
    # Cache: avoid rebuilding average series for the same DataFrame
    df_id_to_avg: dict[int, np.ndarray] = {}
    
    for w_idx, ((start_day, end_day), w_df) in enumerate(zip(day_ranges, window_dfs)):
        window_masks[w_idx] = (avg_doys >= start_day) & (avg_doys <= end_day)
        
        df_id = id(w_df)
        if df_id not in df_id_to_avg:
            w_years = get_years_from_data(w_df)
            w_avg = _build_average_year_series(w_df, w_years) if w_years else None
            if w_avg is not None:
                w_rets, w_doys, _ = w_avg
                # Map w_rets by DOY for lookup
                doy_to_ret = dict(zip(w_doys.tolist(), w_rets.tolist()))
                aligned = np.array([doy_to_ret.get(d, 0.0) for d in avg_doys.tolist()])
                df_id_to_avg[df_id] = aligned
            else:
                df_id_to_avg[df_id] = avg_rets  # fallback to ref
        
        window_avg_rets[w_idx] = df_id_to_avg[df_id]
    
    # Dynamic equal-weight blended return per day
    active_count = window_masks.sum(axis=0)
    active_ret_sum = (window_masks * window_avg_rets).sum(axis=0)
    safe_count = np.where(active_count > 0, active_count, 1)
    blended_ret = np.where(active_count > 0, active_ret_sum / safe_count, 0.0)
    
    combined_curve = (np.cumprod(1.0 + blended_ret) - 1.0) * 100.0
    total_days_in_market = int(np.sum(active_count > 0))
    
    # Per-strategy curves
    strategy_curves: dict[str, list[float]] = {}
    for sym in unique_symbols:
        sym_mask = np.zeros(n_days, dtype=bool)
        sym_ret_sum = np.zeros(n_days)
        sym_count = np.zeros(n_days, dtype=int)
        for w_idx, tmpl in enumerate(templates):
            if tmpl["symbol"] == sym:
                sym_mask |= window_masks[w_idx]
                sym_ret_sum += window_masks[w_idx] * window_avg_rets[w_idx]
                sym_count += window_masks[w_idx].astype(int)
        
        sym_safe = np.where(sym_count > 0, sym_count, 1)
        sym_blended = np.where(sym_mask, sym_ret_sum / sym_safe, 0.0)
        sym_curve = (np.cumprod(1.0 + sym_blended) - 1.0) * 100.0
        strategy_curves[sym] = sym_curve.tolist()
    
    # Equal-weight B&H: average daily returns across all unique stocks
    unique_avg_rets = list(df_id_to_avg.values())
    if len(unique_avg_rets) > 1:
        bh_blended = np.mean(unique_avg_rets, axis=0)
    else:
        bh_blended = avg_rets
    bh_curve = (np.cumprod(1.0 + bh_blended) - 1.0) * 100.0
    
    return {
        "combined_curve": combined_curve.tolist(),
        "bh_curve": bh_curve.tolist(),
        "strategy_curves": strategy_curves,
        "trades_count": len(trades_info),
        "total_days": total_days_in_market,
        "dates": date_labels,
        "trades": trades_info,
        "avg_years": len(years),
        "symbols": unique_symbols,
    }


def export_plan_calendar_csv(strategies: list[dict], align_windows: bool = False) -> str:
    """
    Generate a target-allocation trading calendar CSV.
    
    Format: Date column + one column per stock.
    Each row is an event date (window open/close). Cell values show
    the target portfolio allocation % for that stock after rebalancing.
    Empty cell = no change. On the far right, an Action column describes
    what triggered the rebalance.
    
    Equal-weight: all active positions get 1/N of portfolio.
    
    Args:
        strategies: List of strategy dicts with symbol, window_size, threshold
        align_windows: If True, merge entry/exit dates within 2 days of each other
    
    Returns:
        CSV content string
    """
    import io
    import calendar as cal
    
    month_order = {cal.month_abbr[i]: i for i in range(1, 13)}
    
    # Collect all windows across strategies
    # Each window: (start_doy, end_doy, stock_name)
    all_windows: list[tuple[int, int, str]] = []
    stock_names: list[str] = []  # ordered unique names
    
    for strat in strategies:
        symbol = strat.get("symbol", "")
        window_size = int(strat.get("window_size", 30))
        threshold = int(strat.get("threshold", 50))
        
        symbols = parse_symbols(symbol)
        if not symbols:
            continue
        
        if len(symbols) == 1:
            df = load_symbol_data(symbols[0])
        else:
            df = synthesize_basket(symbols)
        
        if df.empty:
            continue
        
        windows = detect_sliding_windows(df, window_size=window_size, threshold=threshold / 100)
        if not windows:
            continue
        
        if len(symbols) == 1:
            stock_name = symbols[0].replace(".NS", "")
        else:
            stock_name = "+".join(s.replace(".NS", "") for s in symbols)
        
        if stock_name not in stock_names:
            stock_names.append(stock_name)
        
        for w in windows:
            all_windows.append((w.start_day, w.end_day, stock_name))
    
    if not all_windows or not stock_names:
        return ""
    
    # Apply alignment: merge entries/exits within 2 days of each other
    if align_windows:
        all_windows = _align_window_dates(all_windows)
    
    # Build chronological event list
    # Each event: (doy, stock_name, event_type)  where event_type = "enter" | "exit"
    events: list[tuple[int, str, str]] = []
    for start_doy, end_doy, name in all_windows:
        events.append((start_doy, name, "enter"))
        events.append((end_doy, name, "exit"))
    
    # Sort by doy, then exits before entries on same day (exit frees capital first)
    events.sort(key=lambda e: (e[0], 0 if e[2] == "exit" else 1))
    
    # Group events on the same day
    grouped: list[tuple[int, list[tuple[str, str]]]] = []
    i = 0
    while i < len(events):
        doy = events[i][0]
        day_events: list[tuple[str, str]] = []
        while i < len(events) and events[i][0] == doy:
            day_events.append((events[i][1], events[i][2]))
            i += 1
        grouped.append((doy, day_events))
    
    # Walk through events, tracking active positions and computing target allocations
    active: set[str] = set()  # currently active stock names
    rows: list[tuple[str, dict[str, str], str]] = []  # (date_str, {stock: alloc}, action_desc)
    
    for doy, day_events in grouped:
        # Determine action description
        entering = [name for name, typ in day_events if typ == "enter"]
        exiting = [name for name, typ in day_events if typ == "exit"]
        
        # Apply exits first
        for name in exiting:
            active.discard(name)
        # Apply entries
        for name in entering:
            active.add(name)
        
        # Build action description
        actions = []
        if entering:
            actions.append("Enter " + ", ".join(entering))
        if exiting:
            actions.append("Exit " + ", ".join(exiting))
        action_desc = "; ".join(actions)
        
        # Compute target allocations (equal weight)
        allocs: dict[str, str] = {}
        if active:
            pct = 100 // len(active)
            # Distribute remainder to first positions
            remainder = 100 - pct * len(active)
            sorted_active = sorted(active, key=lambda s: stock_names.index(s))
            for j, name in enumerate(sorted_active):
                p = pct + (1 if j < remainder else 0)
                allocs[name] = f"{p}%"
        
        # Convert doy to date string
        month, day = date_from_day_of_year(doy)
        date_str = f"{cal.month_abbr[month]}-{day}"
        
        rows.append((date_str, allocs, action_desc))
    
    # Generate CSV
    output = io.StringIO()
    
    # Header
    header = ["Date"] + stock_names + ["Action"]
    output.write(",".join(header) + "\n")
    
    for date_str, allocs, action_desc in rows:
        cells = [date_str]
        for name in stock_names:
            cells.append(allocs.get(name, ""))
        cells.append(action_desc)
        output.write(",".join(cells) + "\n")
    
    return output.getvalue()


def _align_window_dates(windows: list[tuple[int, int, str]]) -> list[tuple[int, int, str]]:
    """
    Merge entry/exit dates that are within 2 days of each other.
    
    For entries within 2 days: snap the later one to the earlier.
    For exits within 2 days: snap the earlier one to the later.
    This reduces the number of distinct trading days.
    """
    # Build mutable list of [start_doy, end_doy, name]
    mutable = [[s, e, n] for s, e, n in windows]
    
    # Align entries: sort by start_doy, merge nearby
    by_start = sorted(range(len(mutable)), key=lambda i: mutable[i][0])
    for k in range(len(by_start) - 1):
        i1 = by_start[k]
        i2 = by_start[k + 1]
        if 0 < mutable[i2][0] - mutable[i1][0] <= 2:
            mutable[i2][0] = mutable[i1][0]  # snap later entry to earlier
    
    # Align exits: sort by end_doy, merge nearby
    by_end = sorted(range(len(mutable)), key=lambda i: mutable[i][1])
    for k in range(len(by_end) - 1):
        i1 = by_end[k]
        i2 = by_end[k + 1]
        if 0 < mutable[i2][1] - mutable[i1][1] <= 2:
            mutable[i1][1] = mutable[i2][1]  # snap earlier exit to later
    
    return [(s, e, n) for s, e, n in mutable]
