from __future__ import annotations

import calendar
import datetime as dt
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd
import yfinance as yf
from rich.text import Text
from textual.app import App, ComposeResult
from textual.containers import Container, Horizontal, ScrollableContainer, Vertical
from textual.widgets import Button, DataTable, Footer, Header, Input, Select, Static

DATA_DIR = Path("data")
EXPORT_DIR = Path("exports")
PERIOD_COUNTS = {"weekly": 52, "monthly": 12}
OFFSET_LIMITS = {"weekly": 6, "monthly": 30}
NUM_YEARS = 15

MONTH_NAMES = [calendar.month_abbr[i] for i in range(1, 13)]


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

    @property
    def trend_sort_key(self) -> float:
        """Sort key for ordering rows by trend strength (highest first)."""
        result = self.trend_pct
        if result is None:
            return 0.0
        return result[0]


def sanitize_symbol(symbol: str) -> str:
    return symbol.replace("/", "-").replace(" ", "").replace(":", "-")


def parse_symbols(symbols_text: str) -> list[str]:
    symbols = [item.strip().upper() for item in symbols_text.split(",") if item.strip()]
    return symbols


def ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)


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
    """Compute net return % for a window."""
    window = df.loc[start:end]
    if window.empty or len(window) < 1:
        return None
    open_price = float(window.iloc[0]["Open"])
    close_price = float(window.iloc[-1]["Close"])
    if open_price == 0:
        return None
    return (close_price / open_price - 1) * 100


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
        # 12 months + 1 wraparound month
        rows = []
        for month_num in range(1, 14):  # 13 months (12 + 1 wraparound)
            is_wraparound = month_num == 13
            if is_wraparound:
                label = "Jan+"
            else:
                label = MONTH_NAMES[month_num - 1]
            row = SeasonalRow(label=label)
            
            for year in years:
                if is_wraparound:
                    # Use January data but from the following year
                    data_year = year + 1
                    actual_month = 1
                else:
                    data_year = year
                    actual_month = month_num
                
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


def seasonal_to_frame(rows: list[SeasonalRow], years: list[int]) -> pd.DataFrame:
    """Convert seasonal rows to a DataFrame for export."""
    data = []
    for row in rows:
        record: dict[str, object] = {"Period": row.label}
        trend = row.trend_pct
        if trend is not None:
            record["Trend Likelihood %"] = round(trend[0], 0)
            record["Trend Direction"] = "Bull" if trend[1] else "Bear"
        else:
            record["Trend Likelihood %"] = None
            record["Trend Direction"] = None
        ev = row.expected_value
        record["Expected Value %"] = round(ev, 2) if ev is not None else None
        avg = row.average
        record["Average Return %"] = round(abs(avg), 2) if avg is not None else None
        for year in years:
            val = row.year_returns.get(year)
            record[f"Return {year} %"] = round(val, 2) if val is not None else None
        data.append(record)
    return pd.DataFrame(data)


def color_value(value: float | None, width: int = 8) -> Text:
    """Color a return value green (positive) or red (negative), right-aligned. No minus sign."""
    if value is None:
        return Text("-".rjust(width), style="dim")
    style = "green" if value >= 0 else "red"
    formatted = f"{abs(value):.1f}%"
    return Text(formatted.rjust(width), style=style)


def color_trend(trend: tuple[float, bool] | None, is_neutral: bool = False) -> Text:
    """Color a trend percentage - green if bullish, red if bearish, blue if neutral."""
    if trend is None:
        return Text("-".rjust(7), style="dim")
    pct, is_bullish = trend
    if is_neutral:
        style = "blue"
    else:
        style = "green" if is_bullish else "red"
    formatted = f"{pct:.0f}%"
    return Text(formatted.rjust(7), style=style)


def color_ev(value: float | None, is_neutral: bool = False) -> Text:
    """Color expected value - green if positive, red if negative, blue if neutral. No minus sign."""
    if value is None:
        return Text("-".rjust(8), style="dim")
    if is_neutral:
        style = "blue"
    else:
        style = "green" if value >= 0 else "red"
    formatted = f"{abs(value):.2f}"
    return Text(formatted.rjust(8), style=style)


@dataclass
class RunInfo:
    """Information about a run of consecutive bullish/bearish periods."""
    start_idx: int
    end_idx: int  # inclusive
    is_bullish: bool
    ev_sum: float


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


def color_run_ev(value: float | None, is_bullish: bool | None = None) -> Text:
    """Color run EV value - green if bullish run, red if bearish run."""
    if value is None:
        return Text("-".rjust(8), style="dim")
    style = "green" if is_bullish else "red"
    formatted = f"{abs(value):.2f}"
    return Text(formatted.rjust(8), style=style)


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
    Convert a period label to a date string like 'Jan-15' or 'W1-Mon'.
    For entry: start of period + offset
    For exit: end of period + offset
    """
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
        month_abbrs = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", 
                       "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
        
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
        # Weekly - show week number and day offset
        week_num = period.replace("Week ", "").rstrip("+")
        if is_entry:
            day = 1 + offset_days  # Monday = 1
        else:
            day = 7 + offset_days  # Sunday = 7
        
        day_names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        # Wrap day to 1-7 range
        day_idx = ((day - 1) % 7)
        return f"W{week_num}-{day_names[day_idx]}"


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


def trades_to_frame(
    rows: list[SeasonalRow],
    runs: list[RunInfo],
    yearly_results: dict[int, YearlyTradeResult],
    years: list[int],
    period_type: str,
    offset_days: int,
) -> pd.DataFrame:
    """Convert trade simulation results to a DataFrame for export."""
    data = []
    green_runs = [r for r in runs if r.is_bullish]
    
    for run in green_runs:
        entry = rows[run.start_idx].label
        exit_label = rows[run.end_idx].label
        entry_date = get_period_date_label(entry, period_type, offset_days, is_entry=True)
        exit_date = get_period_date_label(exit_label, period_type, offset_days, is_entry=False)
        days = calculate_run_days(rows, run.start_idx, run.end_idx, period_type)
        
        # Calculate average profit across years
        profits = []
        for year in years:
            result = yearly_results.get(year)
            if result:
                trade = next((t for t in result.trades if t.entry_period == entry and t.exit_period == exit_label), None)
                if trade:
                    profits.append(trade.profit_pct)
        
        avg_profit = sum(profits) / len(profits) if profits else 0
        annualized = (avg_profit * 365 / days) if days > 0 else 0
        
        record: dict[str, object] = {
            "Entry Date": entry_date,
            "Exit Date": exit_date,
            "Average Profit %": round(avg_profit, 2),
            "Days Held": days,
            "Annualized Return %": round(annualized, 2),
        }
        
        # Add per-year profits
        for year in years:
            result = yearly_results.get(year)
            if result:
                trade = next((t for t in result.trades if t.entry_period == entry and t.exit_period == exit_label), None)
                record[f"Profit {year} %"] = round(trade.profit_pct, 2) if trade else None
            else:
                record[f"Profit {year} %"] = None
        
        data.append(record)
    
    # Add TOTAL row
    if yearly_results:
        total_profits = []
        total_days_list = []
        for year in years:
            result = yearly_results.get(year)
            if result:
                total_profits.append(result.total_profit_pct)
                total_days_list.append(result.total_days_held)
        
        avg_total = sum(total_profits) / len(total_profits) if total_profits else 0
        avg_days = sum(total_days_list) // len(total_days_list) if total_days_list else 0
        total_annualized = (avg_total * 365 / avg_days) if avg_days > 0 else 0
        
        total_record: dict[str, object] = {
            "Entry Date": "TOTAL",
            "Exit Date": "",
            "Average Profit %": round(avg_total, 2),
            "Days Held": avg_days,
            "Annualized Return %": round(total_annualized, 2),
        }
        for year in years:
            result = yearly_results.get(year)
            total_record[f"Profit {year} %"] = round(result.total_profit_pct, 2) if result else None
        data.append(total_record)
        
        # Add B&H row
        bh_profits = []
        for year in years:
            result = yearly_results.get(year)
            if result:
                bh_profits.append(result.buy_hold_profit_pct)
        
        avg_bh = sum(bh_profits) / len(bh_profits) if bh_profits else 0
        
        bh_record: dict[str, object] = {
            "Entry Date": "B&H",
            "Exit Date": "",
            "Average Profit %": round(avg_bh, 2),
            "Days Held": 365,
            "Annualized Return %": round(avg_bh, 2),
        }
        for year in years:
            result = yearly_results.get(year)
            bh_record[f"Profit {year} %"] = round(result.buy_hold_profit_pct, 2) if result else None
        data.append(bh_record)
        
        # Add EDGE row
        edge_annualized = total_annualized - avg_bh
        edge_record: dict[str, object] = {
            "Entry Date": "EDGE",
            "Exit Date": "vs B&H",
            "Average Profit %": None,
            "Days Held": None,
            "Annualized Return %": round(edge_annualized, 2),
        }
        for year in years:
            edge_record[f"Profit {year} %"] = None
        data.append(edge_record)
    
    return pd.DataFrame(data)


def color_profit(value: float | None, width: int = 7) -> Text:
    """Color profit value - green if positive, red if negative."""
    if value is None:
        return Text("-".rjust(width), style="dim")
    style = "green" if value >= 0 else "red"
    formatted = f"{abs(value):.1f}%"
    return Text(formatted.rjust(width), style=style)


class SeasonalApp(App):
    CSS = """
    Screen {
        layout: vertical;
    }

    #controls {
        height: auto;
        margin: 1 2;
        padding: 1;
    }

    #controls Horizontal {
        height: auto;
        width: 100%;
    }

    #main_content {
        height: 1fr;
        margin: 0 2 1 2;
    }

    #table_container {
        height: 2fr;
        width: 100%;
    }

    #trades_container {
        height: 1fr;
        width: 100%;
        margin-top: 1;
        border: solid green;
        padding: 1;
    }

    #trades_title {
        text-style: bold;
        margin-bottom: 1;
    }

    #trades_table {
        height: 1fr;
    }

    #table {
        height: 1fr;
    }

    #status {
        height: 3;
        margin: 0 2 1 2;
    }

    Input {
        width: 30;
    }

    #offset_label {
        width: auto;
        text-align: center;
        padding: 0 1;
        margin-top: 1;
    }

    #threshold_label {
        width: auto;
        text-align: center;
        padding: 0 1;
        margin-top: 1;
    }

    Select {
        width: 20;
    }

    Button {
        min-width: 6;
        margin-left: 1;
    }

    #load_button {
        margin-left: 1;
    }

    #export_button {
        margin-left: 2;
    }
    """

    BINDINGS = [
        ("left", "offset_decrease", "Offset -"),
        ("right", "offset_increase", "Offset +"),
        ("w", "set_weekly", "Weekly"),
        ("m", "set_monthly", "Monthly"),
        ("r", "reload", "Reload"),
    ]

    def __init__(self) -> None:
        super().__init__()
        self.symbols: list[str] = ["RELIANCE.NS"]
        self.period = "monthly"
        self.offset_days = 0
        self.threshold_pct = 50  # Minimum trend% to be considered bull/bear
        self.seasonal_rows: list[SeasonalRow] = []
        self.years: list[int] = []
        self.stats_frame = pd.DataFrame()
        self.runs: list[RunInfo] = []
        self.yearly_results: dict[int, YearlyTradeResult] = {}

    def compose(self) -> ComposeResult:
        yield Header()
        with Container(id="controls"):
            with Horizontal():
                yield Input(
                    value=",".join(self.symbols),
                    placeholder="RELIANCE.NS or RELIANCE.NS,TCS.NS",
                    id="symbols_input",
                )
                yield Button("Load", id="load_button")
                yield Select(
                    options=[("Monthly", "monthly"), ("Weekly", "weekly")],
                    value=self.period,
                    id="period_select",
                )
                yield Button("-", id="offset_minus")
                yield Static("Offset: 0", id="offset_label")
                yield Button("+", id="offset_plus")
                yield Button("-", id="threshold_minus")
                yield Static("Thresh: 50%", id="threshold_label")
                yield Button("+", id="threshold_plus")
                yield Button("Export", id="export_button")
        with Vertical(id="main_content"):
            with ScrollableContainer(id="table_container"):
                yield DataTable(id="table")
            with ScrollableContainer(id="trades_container"):
                yield Static("Trade Simulation", id="trades_title")
                yield DataTable(id="trades_table")
        yield Static("Ready", id="status")
        yield Footer()

    def on_mount(self) -> None:
        self.refresh_data()

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "load_button":
            self.handle_load()
        elif event.button.id == "offset_minus":
            self.update_offset(-1)
        elif event.button.id == "offset_plus":
            self.update_offset(1)
        elif event.button.id == "threshold_minus":
            self.update_threshold(-5)
        elif event.button.id == "threshold_plus":
            self.update_threshold(5)
        elif event.button.id == "export_button":
            self.export_report()

    def on_select_changed(self, event: Select.Changed) -> None:
        if event.select.id == "period_select":
            self.period = str(event.value)
            self.ensure_offset_limit()
            self.refresh_data()

    def handle_load(self) -> None:
        symbols_text = self.query_one("#symbols_input", Input).value
        parsed = parse_symbols(symbols_text)
        if not parsed:
            self.set_status("Enter at least one symbol.")
            return
        self.symbols = parsed
        self.refresh_data()

    def update_offset(self, delta: int) -> None:
        limit = OFFSET_LIMITS[self.period]
        new_value = int(np.clip(self.offset_days + delta, 0, limit))
        if new_value != self.offset_days:
            self.offset_days = new_value
            self.update_offset_label()
            self.refresh_data()

    def ensure_offset_limit(self) -> None:
        limit = OFFSET_LIMITS[self.period]
        self.offset_days = int(np.clip(self.offset_days, 0, limit))
        self.update_offset_label()

    def update_offset_label(self) -> None:
        label = self.query_one("#offset_label", Static)
        label.update(f"Offset: {self.offset_days}")

    def update_threshold(self, delta: int) -> None:
        new_value = int(np.clip(self.threshold_pct + delta, 50, 100))
        if new_value != self.threshold_pct:
            self.threshold_pct = new_value
            self.update_threshold_label()
            self.refresh_data()

    def update_threshold_label(self) -> None:
        label = self.query_one("#threshold_label", Static)
        label.update(f"Thresh: {self.threshold_pct}%")

    def set_status(self, message: str) -> None:
        self.query_one("#status", Static).update(message)

    def action_offset_decrease(self) -> None:
        self.update_offset(-1)

    def action_offset_increase(self) -> None:
        self.update_offset(1)

    def action_set_weekly(self) -> None:
        self.period = "weekly"
        self.query_one("#period_select", Select).value = "weekly"
        self.ensure_offset_limit()
        self.refresh_data()

    def action_set_monthly(self) -> None:
        self.period = "monthly"
        self.query_one("#period_select", Select).value = "monthly"
        self.ensure_offset_limit()
        self.refresh_data()

    def action_reload(self) -> None:
        self.refresh_data()

    def refresh_data(self) -> None:
        try:
            self.set_status("Loading data...")
            if len(self.symbols) == 1:
                data = load_symbol_data(self.symbols[0])
            else:
                data = synthesize_basket(self.symbols)
            if data.empty:
                self.set_status("No data available for selection.")
                return

            last_date = data.index.max().normalize()
            current_year = last_date.year
            all_years = list(range(current_year - NUM_YEARS + 1, current_year + 1))
            # Skip 2020 and 2021 (COVID anomaly years)
            self.years = [y for y in all_years if y not in (2020, 2021)]

            self.seasonal_rows = generate_seasonal_data(
                data, self.period, self.offset_days, NUM_YEARS
            )
            self.stats_frame = seasonal_to_frame(self.seasonal_rows, self.years)
            
            # Detect runs and simulate trades
            self.runs = detect_runs(self.seasonal_rows, min_length=2, threshold_pct=self.threshold_pct)
            self.yearly_results = simulate_all_years(self.seasonal_rows, self.runs, self.years, self.period)
            
            self.render_table()
            self.render_trades_table()
            self.set_status(
                f"Loaded {len(self.seasonal_rows)} periods for {', '.join(self.symbols)} "
                f"({self.period}, {NUM_YEARS} years)."
            )
        except Exception as exc:  # pragma: no cover - UI feedback
            self.set_status(f"Error: {exc}")

    def render_table(self) -> None:
        table = self.query_one("#table", DataTable)
        table.clear(columns=True)
        
        # Column widths
        PERIOD_WIDTH = 8
        TREND_WIDTH = 7
        EV_WIDTH = 8
        RUN_EV_WIDTH = 8
        AVG_WIDTH = 8
        YEAR_WIDTH = 6
        PROFIT_WIDTH = 7
        
        # Use stored runs and build mappings
        run_ev_at_end, run_membership = build_run_map(self.runs)
        
        # Add columns: Period, Trend%, EV, RunEV, Avg, then years (newest first), then profit per year
        table.add_column("Period".ljust(PERIOD_WIDTH), key="period", width=PERIOD_WIDTH)
        table.add_column("Trend%".rjust(TREND_WIDTH), key="trend_pct", width=TREND_WIDTH)
        table.add_column("EV".rjust(EV_WIDTH), key="ev", width=EV_WIDTH)
        table.add_column("RunEV".rjust(RUN_EV_WIDTH), key="run_ev", width=RUN_EV_WIDTH)
        table.add_column("Avg".rjust(AVG_WIDTH), key="avg", width=AVG_WIDTH)
        for year in reversed(self.years):
            table.add_column(str(year).rjust(YEAR_WIDTH), key=str(year), width=YEAR_WIDTH)

        # Add rows with run highlighting
        for idx, row in enumerate(self.seasonal_rows):
            # Check if this row is neutral (trend% below threshold)
            trend = row.trend_pct
            is_neutral = trend is not None and trend[0] < self.threshold_pct
            
            # Check if this row is part of a run
            in_run = idx in run_membership
            bg_color = None
            if in_run:
                is_bullish = run_membership[idx]
                bg_color = "#0a200a" if is_bullish else "#200a0a"
            
            def style_cell(text: Text) -> Text:
                """Apply background color to cell if in a run."""
                if bg_color is None:
                    return text
                return Text(text.plain, style=f"{text.style} on {bg_color}")
            
            trend_text = style_cell(color_trend(row.trend_pct, is_neutral=is_neutral))
            ev_text = style_cell(color_ev(row.expected_value, is_neutral=is_neutral))
            
            # RunEV: only show at end of run
            run_ev_value = run_ev_at_end.get(idx)
            is_bullish_run = run_membership.get(idx)
            run_ev_text = style_cell(color_run_ev(run_ev_value, is_bullish_run))
            
            avg_text = style_cell(color_value(row.average, width=AVG_WIDTH))
            year_values = [style_cell(color_value(row.year_returns.get(y), width=YEAR_WIDTH)) for y in reversed(self.years)]
            
            # Style the period label
            period_text = Text(row.label)
            if bg_color:
                period_text = Text(row.label, style=f"on {bg_color}")
            
            table.add_row(period_text, trend_text, ev_text, run_ev_text, avg_text, *year_values)
        
        # Add a summary row with yearly profits at the bottom
        if self.yearly_results:
            profit_cells = [Text("-".rjust(YEAR_WIDTH), style="dim") for _ in self.years]
            # We'll show yearly totals in the trades table instead
            # This keeps the main table clean

    def render_trades_table(self) -> None:
        """Render the trades simulation table."""
        table = self.query_one("#trades_table", DataTable)
        table.clear(columns=True)
        
        # Column widths
        ENTRY_WIDTH = 8
        EXIT_WIDTH = 8
        PROFIT_WIDTH = 8
        DAYS_WIDTH = 5
        ANN_WIDTH = 7
        
        # Add columns
        table.add_column("Entry".ljust(ENTRY_WIDTH), key="entry", width=ENTRY_WIDTH)
        table.add_column("Exit".ljust(EXIT_WIDTH), key="exit", width=EXIT_WIDTH)
        table.add_column("Profit".rjust(PROFIT_WIDTH), key="profit", width=PROFIT_WIDTH)
        table.add_column("Days".rjust(DAYS_WIDTH), key="days", width=DAYS_WIDTH)
        table.add_column("Ann%".rjust(ANN_WIDTH), key="annualized", width=ANN_WIDTH)
        
        # Add profit columns for each year (newest first)
        YEAR_PROFIT_WIDTH = 7
        for year in reversed(self.years):
            table.add_column(f"P{str(year)[2:]}".rjust(YEAR_PROFIT_WIDTH), key=f"profit_{year}", width=YEAR_PROFIT_WIDTH)
        
        # Get green runs only
        green_runs = [r for r in self.runs if r.is_bullish]
        
        if not green_runs:
            table.add_row("No green runs", "", "", "", "", *["" for _ in self.years])
            return
        
        # Add a row for each green run
        for run_idx, run in enumerate(green_runs):
            entry = self.seasonal_rows[run.start_idx].label
            exit_label = self.seasonal_rows[run.end_idx].label
            days = calculate_run_days(self.seasonal_rows, run.start_idx, run.end_idx, self.period)
            
            # Get exact date labels for entry and exit
            entry_date = get_period_date_label(entry, self.period, self.offset_days, is_entry=True)
            exit_date = get_period_date_label(exit_label, self.period, self.offset_days, is_entry=False)
            
            # Get profit for each year for this run
            year_profits = []
            avg_profit = 0.0
            profit_count = 0
            for year in reversed(self.years):
                result = self.yearly_results.get(year)
                if result:
                    # Find the trade for this run
                    trade = next((t for t in result.trades if t.entry_period == entry and t.exit_period == exit_label), None)
                    if trade:
                        year_profits.append(color_profit(trade.profit_pct, width=YEAR_PROFIT_WIDTH))
                        avg_profit += trade.profit_pct
                        profit_count += 1
                    else:
                        year_profits.append(Text("-".rjust(YEAR_PROFIT_WIDTH), style="dim"))
                else:
                    year_profits.append(Text("-".rjust(YEAR_PROFIT_WIDTH), style="dim"))
            
            # Calculate average profit across years
            avg = avg_profit / profit_count if profit_count > 0 else 0
            # Calculate annualized return: profit * 365 / days
            annualized = (avg * 365 / days) if days > 0 else 0
            
            table.add_row(
                entry_date,
                exit_date,
                color_profit(avg, width=PROFIT_WIDTH),
                Text(str(days).rjust(DAYS_WIDTH)),
                color_profit(annualized, width=ANN_WIDTH),
                *year_profits,
            )
        
        # Add totals row
        total_profits = []
        avg_total = 0.0
        total_count = 0
        total_days = 0
        for year in reversed(self.years):
            result = self.yearly_results.get(year)
            if result:
                total_profits.append(color_profit(result.total_profit_pct, width=YEAR_PROFIT_WIDTH))
                avg_total += result.total_profit_pct
                total_count += 1
                total_days += result.total_days_held
            else:
                total_profits.append(Text("-".rjust(YEAR_PROFIT_WIDTH), style="dim"))
        
        avg_total_profit = avg_total / total_count if total_count > 0 else 0
        avg_total_days = total_days // total_count if total_count > 0 else 0
        # Annualized for totals
        total_annualized = (avg_total_profit * 365 / avg_total_days) if avg_total_days > 0 else 0
        
        # Add separator row
        sep = Text("─" * 8, style="dim")
        table.add_row(sep, sep, sep, Text("─" * DAYS_WIDTH, style="dim"), sep, *[Text("─" * YEAR_PROFIT_WIDTH, style="dim") for _ in self.years])
        
        # Add totals row
        table.add_row(
            Text("TOTAL", style="bold"),
            Text("", style="bold"),
            Text(f"{abs(avg_total_profit):.1f}%".rjust(PROFIT_WIDTH), style="bold green" if avg_total_profit >= 0 else "bold red"),
            Text(str(avg_total_days).rjust(DAYS_WIDTH), style="bold"),
            Text(f"{abs(total_annualized):.1f}%".rjust(ANN_WIDTH), style="bold green" if total_annualized >= 0 else "bold red"),
            *total_profits,
        )
        
        # Add buy-and-hold row (first to last period for whole year)
        bh_profits = []
        avg_bh = 0.0
        bh_count = 0
        for year in reversed(self.years):
            result = self.yearly_results.get(year)
            if result:
                bh_profits.append(color_profit(result.buy_hold_profit_pct, width=YEAR_PROFIT_WIDTH))
                avg_bh += result.buy_hold_profit_pct
                bh_count += 1
            else:
                bh_profits.append(Text("-".rjust(YEAR_PROFIT_WIDTH), style="dim"))
        
        avg_bh_profit = avg_bh / bh_count if bh_count > 0 else 0
        # Full year is 365 days
        bh_annualized = avg_bh_profit  # Already annualized since it's a full year
        
        table.add_row(
            Text("B&H", style="bold italic"),
            Text("", style="italic"),
            Text(f"{abs(avg_bh_profit):.1f}%".rjust(PROFIT_WIDTH), style="bold green italic" if avg_bh_profit >= 0 else "bold red italic"),
            Text("365".rjust(DAYS_WIDTH), style="bold italic"),
            Text(f"{abs(bh_annualized):.1f}%".rjust(ANN_WIDTH), style="bold green italic" if bh_annualized >= 0 else "bold red italic"),
            *bh_profits,
        )
        
        # Add EDGE row showing difference in annualized return (TOTAL - B&H)
        edge_annualized = total_annualized - bh_annualized
        
        table.add_row(
            Text("EDGE", style="bold"),
            Text("vs B&H", style="dim"),
            Text("".rjust(PROFIT_WIDTH)),
            Text("".rjust(DAYS_WIDTH)),
            Text(f"{'+' if edge_annualized >= 0 else ''}{edge_annualized:.1f}%".rjust(ANN_WIDTH), style="bold green" if edge_annualized >= 0 else "bold red"),
            *[Text("".rjust(YEAR_PROFIT_WIDTH)) for _ in self.years],
        )

    def export_report(self) -> None:
        if self.stats_frame.empty:
            self.set_status("Nothing to export.")
            return

        ensure_dirs()
        
        # Build filename pattern: STOCK-PERIOD+OFFSET@THRESHOLD
        symbol_label = "_".join([sanitize_symbol(sym) for sym in self.symbols])
        period_abbr = "M" if self.period == "monthly" else "W"
        base_name = f"{symbol_label}-{period_abbr}+{self.offset_days}@{self.threshold_pct}"
        
        # Export stats file
        stats_path = EXPORT_DIR / f"{base_name}.stats.csv"
        self.stats_frame.to_csv(stats_path, index=False)
        
        # Export trades file
        trades_frame = trades_to_frame(
            self.seasonal_rows,
            self.runs,
            self.yearly_results,
            self.years,
            self.period,
            self.offset_days,
        )
        trades_path = EXPORT_DIR / f"{base_name}.trades.csv"
        trades_frame.to_csv(trades_path, index=False)
        
        self.set_status(f"Exported {stats_path.name} and {trades_path.name}")


if __name__ == "__main__":
    SeasonalApp().run()
