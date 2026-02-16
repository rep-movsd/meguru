"""Unit tests for seasonal stock pattern detector."""

from __future__ import annotations

import datetime as dt
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
import pandas as pd
import pytest

# Import from backend module
import sys
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from backend import (
    SeasonalRow,
    sanitize_symbol,
    parse_symbols,
    _normalize_df,
    next_trading_day,
    prev_trading_day,
    get_first_monday,
    compute_window_return,
    generate_seasonal_data,
    detect_runs,
    build_run_map,
    RunInfo,
    get_period_date_label,
)


# ============================================================================
# Fixtures
# ============================================================================


@pytest.fixture
def sample_ohlc_df() -> pd.DataFrame:
    """Create a sample OHLC DataFrame for testing (3 years of data)."""
    dates = pd.bdate_range("2022-01-01", "2024-12-31")
    np.random.seed(42)
    n = len(dates)
    open_prices = 100 + np.cumsum(np.random.randn(n) * 0.5)
    high_prices = open_prices + np.abs(np.random.randn(n)) * 0.5
    low_prices = open_prices - np.abs(np.random.randn(n)) * 0.5
    close_prices = open_prices + np.random.randn(n) * 0.3
    return pd.DataFrame(
        {
            "Open": open_prices,
            "High": high_prices,
            "Low": low_prices,
            "Close": close_prices,
        },
        index=dates,
    )


@pytest.fixture
def sample_seasonal_row() -> SeasonalRow:
    """Create a sample SeasonalRow for testing."""
    row = SeasonalRow(label="Week 1")
    row.year_returns = {2022: 1.5, 2023: -0.5, 2024: 2.0}
    return row


# ============================================================================
# Tests: sanitize_symbol
# ============================================================================


class TestSanitizeSymbol:
    def test_simple_symbol(self):
        assert sanitize_symbol("RELIANCE") == "RELIANCE"

    def test_symbol_with_dot(self):
        assert sanitize_symbol("RELIANCE.NS") == "RELIANCE.NS"

    def test_symbol_with_slash(self):
        assert sanitize_symbol("BRK/A") == "BRK-A"

    def test_symbol_with_space(self):
        assert sanitize_symbol("BRK A") == "BRKA"

    def test_symbol_with_colon(self):
        assert sanitize_symbol("NSE:RELIANCE") == "NSE-RELIANCE"

    def test_combined_special_chars(self):
        assert sanitize_symbol("NSE:BRK/A B") == "NSE-BRK-AB"


# ============================================================================
# Tests: parse_symbols
# ============================================================================


class TestParseSymbols:
    def test_single_symbol(self):
        assert parse_symbols("RELIANCE.NS") == ["RELIANCE.NS"]

    def test_multiple_symbols(self):
        assert parse_symbols("RELIANCE.NS, TCS.NS, INFY.NS") == [
            "RELIANCE.NS",
            "TCS.NS",
            "INFY.NS",
        ]

    def test_lowercase_converted_to_upper(self):
        assert parse_symbols("reliance.ns") == ["RELIANCE.NS"]

    def test_empty_string(self):
        assert parse_symbols("") == []

    def test_whitespace_only(self):
        assert parse_symbols("   ") == []

    def test_extra_commas(self):
        assert parse_symbols("RELIANCE.NS,,TCS.NS,") == ["RELIANCE.NS", "TCS.NS"]

    def test_spaces_around_symbols(self):
        assert parse_symbols("  RELIANCE.NS  ,  TCS.NS  ") == ["RELIANCE.NS", "TCS.NS"]


# ============================================================================
# Tests: _normalize_df
# ============================================================================


class TestNormalizeDf:
    def test_empty_dataframe(self):
        df = pd.DataFrame()
        result = _normalize_df(df)
        assert result.empty

    def test_standard_dataframe(self, sample_ohlc_df):
        result = _normalize_df(sample_ohlc_df)
        assert list(result.columns) == ["Open", "High", "Low", "Close"]
        assert len(result) > 0

    def test_lowercase_columns(self):
        df = pd.DataFrame(
            {"open": [100], "high": [105], "low": [95], "close": [102]},
            index=pd.to_datetime(["2024-01-01"]),
        )
        result = _normalize_df(df)
        assert list(result.columns) == ["Open", "High", "Low", "Close"]

    def test_timezone_aware_index(self):
        dates = pd.date_range("2024-01-01", periods=5, freq="D", tz="UTC")
        df = pd.DataFrame(
            {
                "Open": [100] * 5,
                "High": [105] * 5,
                "Low": [95] * 5,
                "Close": [102] * 5,
            },
            index=dates,
        )
        result = _normalize_df(df)
        assert result.index.tz is None

    def test_multi_index_columns(self):
        """Test handling of yfinance multi-level columns."""
        arrays = [
            ["Open", "High", "Low", "Close"],
            ["RELIANCE.NS", "RELIANCE.NS", "RELIANCE.NS", "RELIANCE.NS"],
        ]
        tuples = list(zip(*arrays))
        columns = pd.MultiIndex.from_tuples(tuples, names=["Price", "Ticker"])
        df = pd.DataFrame(
            [[100, 105, 95, 102]],
            index=pd.to_datetime(["2024-01-01"]),
            columns=columns,
        )
        result = _normalize_df(df)
        assert list(result.columns) == ["Open", "High", "Low", "Close"]

    def test_missing_columns(self):
        df = pd.DataFrame(
            {"Open": [100], "High": [105]},  # Missing Low, Close
            index=pd.to_datetime(["2024-01-01"]),
        )
        result = _normalize_df(df)
        assert result.empty

    def test_drops_na_rows(self):
        df = pd.DataFrame(
            {
                "Open": [100, None, 102],
                "High": [105, 106, 107],
                "Low": [95, 96, 97],
                "Close": [102, 103, 104],
            },
            index=pd.to_datetime(["2024-01-01", "2024-01-02", "2024-01-03"]),
        )
        result = _normalize_df(df)
        assert len(result) == 2


# ============================================================================
# Tests: next_trading_day / prev_trading_day
# ============================================================================


class TestTradingDayHelpers:
    @pytest.fixture
    def trading_index(self) -> pd.DatetimeIndex:
        # Mon, Tue, Wed, Thu, Fri of first week of Jan 2024
        return pd.DatetimeIndex(
            ["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"]
        )

    def test_next_trading_day_exact_match(self, trading_index):
        result = next_trading_day(trading_index, pd.Timestamp("2024-01-02"))
        assert result == pd.Timestamp("2024-01-02")

    def test_next_trading_day_between_dates(self, trading_index):
        result = next_trading_day(trading_index, pd.Timestamp("2024-01-01 12:00:00"))
        assert result == pd.Timestamp("2024-01-02")

    def test_next_trading_day_before_first(self, trading_index):
        result = next_trading_day(trading_index, pd.Timestamp("2023-12-31"))
        assert result == pd.Timestamp("2024-01-01")

    def test_next_trading_day_after_last(self, trading_index):
        result = next_trading_day(trading_index, pd.Timestamp("2024-01-06"))
        assert result is None

    def test_prev_trading_day_exact_match(self, trading_index):
        result = prev_trading_day(trading_index, pd.Timestamp("2024-01-03"))
        assert result == pd.Timestamp("2024-01-03")

    def test_prev_trading_day_between_dates(self, trading_index):
        result = prev_trading_day(trading_index, pd.Timestamp("2024-01-03 12:00:00"))
        assert result == pd.Timestamp("2024-01-03")

    def test_prev_trading_day_after_last(self, trading_index):
        result = prev_trading_day(trading_index, pd.Timestamp("2024-01-10"))
        assert result == pd.Timestamp("2024-01-05")

    def test_prev_trading_day_before_first(self, trading_index):
        result = prev_trading_day(trading_index, pd.Timestamp("2023-12-31"))
        assert result is None


# ============================================================================
# Tests: get_first_monday
# ============================================================================


class TestGetFirstMonday:
    def test_year_starting_on_monday(self):
        # 2024 starts on Monday
        result = get_first_monday(2024)
        assert result == pd.Timestamp("2024-01-01")

    def test_year_starting_on_tuesday(self):
        # 2019 starts on Tuesday
        result = get_first_monday(2019)
        assert result == pd.Timestamp("2019-01-07")

    def test_year_starting_on_sunday(self):
        # 2023 starts on Sunday
        result = get_first_monday(2023)
        assert result == pd.Timestamp("2023-01-02")

    def test_year_starting_on_saturday(self):
        # 2022 starts on Saturday
        result = get_first_monday(2022)
        assert result == pd.Timestamp("2022-01-03")


# ============================================================================
# Tests: compute_window_return
# ============================================================================


class TestComputeWindowReturn:
    def test_positive_return(self):
        df = pd.DataFrame(
            {
                "Open": [100.0, 102.0],
                "High": [105.0, 107.0],
                "Low": [98.0, 100.0],
                "Close": [102.0, 110.0],
            },
            index=pd.to_datetime(["2024-01-01", "2024-01-02"]),
        )
        result = compute_window_return(df, df.index[0], df.index[-1])
        # Close-to-close: (110 / 102 - 1) * 100 = 7.843%
        assert result is not None
        assert abs(result - 7.843) < 0.01

    def test_negative_return(self):
        df = pd.DataFrame(
            {
                "Open": [100.0, 95.0],
                "High": [105.0, 97.0],
                "Low": [98.0, 90.0],
                "Close": [95.0, 90.0],
            },
            index=pd.to_datetime(["2024-01-01", "2024-01-02"]),
        )
        result = compute_window_return(df, df.index[0], df.index[-1])
        # Close-to-close: (90 / 95 - 1) * 100 = -5.263%
        assert result is not None
        assert abs(result - (-5.263)) < 0.01

    def test_empty_window(self):
        df = pd.DataFrame(
            {
                "Open": [100.0],
                "High": [105.0],
                "Low": [98.0],
                "Close": [102.0],
            },
            index=pd.to_datetime(["2024-01-01"]),
        )
        result = compute_window_return(
            df, pd.Timestamp("2024-02-01"), pd.Timestamp("2024-02-10")
        )
        assert result is None


# ============================================================================
# Tests: SeasonalRow
# ============================================================================


class TestSeasonalRow:
    def test_average_with_values(self, sample_seasonal_row):
        # (1.5 + (-0.5) + 2.0) / 3 = 1.0
        assert sample_seasonal_row.average is not None
        assert abs(sample_seasonal_row.average - 1.0) < 0.001

    def test_average_with_none_values(self):
        row = SeasonalRow(label="Week 1")
        row.year_returns = {2022: 1.5, 2023: None, 2024: 2.5}
        # (1.5 + 2.5) / 2 = 2.0
        assert row.average is not None
        assert abs(row.average - 2.0) < 0.001

    def test_average_all_none(self):
        row = SeasonalRow(label="Week 1")
        row.year_returns = {2022: None, 2023: None}
        assert row.average is None

    def test_average_empty(self):
        row = SeasonalRow(label="Week 1")
        assert row.average is None

    def test_trend_pct_bullish(self):
        # 2 green (1.5, 2.0), 1 red (-0.5) -> 67% green, bullish
        row = SeasonalRow(label="Week 1")
        row.year_returns = {2022: 1.5, 2023: -0.5, 2024: 2.0}
        trend = row.trend_pct
        assert trend is not None
        pct, is_bullish = trend
        assert abs(pct - 66.67) < 1  # ~67%
        assert is_bullish is True

    def test_trend_pct_bearish(self):
        # 1 green (1.5), 2 red (-0.5, -2.0) -> 67% red, bearish
        row = SeasonalRow(label="Week 1")
        row.year_returns = {2022: 1.5, 2023: -0.5, 2024: -2.0}
        trend = row.trend_pct
        assert trend is not None
        pct, is_bullish = trend
        assert abs(pct - 66.67) < 1  # ~67%
        assert is_bullish is False

    def test_trend_pct_equal_is_bullish(self):
        # 1 green, 1 red -> 50/50, defaults to bullish
        row = SeasonalRow(label="Week 1")
        row.year_returns = {2022: 1.5, 2023: -0.5}
        trend = row.trend_pct
        assert trend is not None
        pct, is_bullish = trend
        assert pct == 50.0
        assert is_bullish is True

    def test_trend_pct_none(self):
        row = SeasonalRow(label="Week 1")
        assert row.trend_pct is None


# ============================================================================
# Tests: generate_seasonal_data
# ============================================================================


class TestGenerateSeasonalData:
    def test_weekly_generates_52_rows(self, sample_ohlc_df):
        result = generate_seasonal_data(sample_ohlc_df, "weekly", 0, 3)
        assert len(result) == 53  # 52 weeks + 1 wraparound
        assert result[0].label == "Week 1"
        assert result[51].label == "Week 52"
        assert result[52].label == "Week 1+"  # Wraparound week

    def test_monthly_generates_24_rows(self, sample_ohlc_df):
        result = generate_seasonal_data(sample_ohlc_df, "monthly", 0, 3)
        assert len(result) == 24  # 12 months + 12 rollover months
        assert result[0].label == "Jan"
        assert result[11].label == "Dec"
        assert result[12].label == "Jan+"  # Rollover month
        assert result[23].label == "Dec+"  # Last rollover month

    def test_empty_dataframe(self):
        df = pd.DataFrame()
        result = generate_seasonal_data(df, "weekly", 0, 3)
        assert result == []

    def test_years_populated(self, sample_ohlc_df):
        result = generate_seasonal_data(sample_ohlc_df, "weekly", 0, 3)
        # Should have data for years in the sample
        row = result[0]
        assert len(row.year_returns) == 3


# ============================================================================
# Tests: detect_runs and build_run_map
# ============================================================================


class TestDetectRuns:
    def test_empty_list(self):
        result = detect_runs([])
        assert result == []

    def test_single_row_no_run(self):
        row = SeasonalRow(label="Week 1")
        row.year_returns = {2022: 1.0, 2023: 1.0}
        result = detect_runs([row], min_length=2)
        assert result == []

    def test_two_bullish_rows_is_run(self):
        rows = []
        for i in range(2):
            row = SeasonalRow(label=f"Week {i+1}")
            row.year_returns = {2022: 1.0, 2023: 1.0}  # positive avg -> positive EV
            rows.append(row)
        result = detect_runs(rows, min_length=2)
        assert len(result) == 1
        assert result[0].start_idx == 0
        assert result[0].end_idx == 1
        assert result[0].is_bullish is True

    def test_two_bearish_rows_is_run(self):
        rows = []
        for i in range(2):
            row = SeasonalRow(label=f"Week {i+1}")
            row.year_returns = {2022: -1.0, 2023: -1.0}  # negative avg -> negative EV
            rows.append(row)
        result = detect_runs(rows, min_length=2)
        assert len(result) == 1
        assert result[0].is_bullish is False

    def test_mixed_no_run(self):
        rows = []
        for i, val in enumerate([1.0, -1.0, 1.0, -1.0]):
            row = SeasonalRow(label=f"Week {i+1}")
            row.year_returns = {2022: val, 2023: val}
            rows.append(row)
        result = detect_runs(rows, min_length=2)
        assert result == []

    def test_run_in_middle(self):
        # Pattern: red, green, green, green, red
        patterns = [-1.0, 1.0, 1.0, 1.0, -1.0]
        rows = []
        for i, val in enumerate(patterns):
            row = SeasonalRow(label=f"Week {i+1}")
            row.year_returns = {2022: val, 2023: val}
            rows.append(row)
        result = detect_runs(rows, min_length=2)
        assert len(result) == 1
        assert result[0].start_idx == 1
        assert result[0].end_idx == 3
        assert result[0].is_bullish is True

    def test_multiple_runs(self):
        # Pattern: green, green, red, red, red
        patterns = [1.0, 1.0, -1.0, -1.0, -1.0]
        rows = []
        for i, val in enumerate(patterns):
            row = SeasonalRow(label=f"Week {i+1}")
            row.year_returns = {2022: val, 2023: val}
            rows.append(row)
        result = detect_runs(rows, min_length=2)
        assert len(result) == 2
        assert result[0].start_idx == 0
        assert result[0].end_idx == 1
        assert result[0].is_bullish is True
        assert result[1].start_idx == 2
        assert result[1].end_idx == 4
        assert result[1].is_bullish is False

    def test_ev_sum_computed(self):
        rows = []
        for i, val in enumerate([2.0, 3.0, 4.0]):
            row = SeasonalRow(label=f"Week {i+1}")
            row.year_returns = {2022: val, 2023: val}  # EV will be close to val
            rows.append(row)
        result = detect_runs(rows, min_length=2)
        assert len(result) == 1
        # EV sum should be sum of individual EVs
        total_ev = sum(r.expected_value for r in rows)
        assert abs(result[0].ev_sum - total_ev) < 0.01

    def test_none_ev_breaks_run(self):
        rows = []
        for i, val in enumerate([1.0, 1.0]):
            row = SeasonalRow(label=f"Week {i+1}")
            row.year_returns = {2022: val, 2023: val}
            rows.append(row)
        # Add row with None EV
        row = SeasonalRow(label="Week 3")
        row.year_returns = {}  # No data -> None EV
        rows.append(row)
        # Add more greens
        for i, val in enumerate([1.0, 1.0]):
            row = SeasonalRow(label=f"Week {i+4}")
            row.year_returns = {2022: val, 2023: val}
            rows.append(row)
        result = detect_runs(rows, min_length=2)
        assert len(result) == 2


class TestBuildRunMap:
    def test_empty_runs(self):
        run_ev_at_end, run_membership = build_run_map([])
        assert run_ev_at_end == {}
        assert run_membership == {}

    def test_single_run(self):
        run = RunInfo(start_idx=1, end_idx=3, is_bullish=True, ev_sum=5.0)
        run_ev_at_end, run_membership = build_run_map([run])
        assert run_ev_at_end == {3: 5.0}
        assert run_membership == {1: True, 2: True, 3: True}

    def test_multiple_runs(self):
        runs = [
            RunInfo(start_idx=0, end_idx=1, is_bullish=True, ev_sum=2.0),
            RunInfo(start_idx=3, end_idx=5, is_bullish=False, ev_sum=-3.0),
        ]
        run_ev_at_end, run_membership = build_run_map(runs)
        assert run_ev_at_end == {1: 2.0, 5: -3.0}
        assert 0 in run_membership
        assert 1 in run_membership
        assert 2 not in run_membership
        assert run_membership[3] is False
        assert run_membership[5] is False


class TestDetectRunsThreshold:
    """Tests for threshold functionality in detect_runs."""

    def test_threshold_filters_low_trend_rows(self):
        """Rows with trend% below threshold should be treated as neutral and break runs."""
        rows = []
        # Row 1: 100% bullish (above threshold)
        row1 = SeasonalRow(label="Week 1")
        row1.year_returns = {2022: 1.0, 2023: 2.0}  # 100% green
        rows.append(row1)
        # Row 2: 50% bullish (at threshold of 50 - should be included at default)
        row2 = SeasonalRow(label="Week 2")
        row2.year_returns = {2022: 1.0, 2023: -1.0}  # 50% green
        rows.append(row2)
        # Row 3: 100% bullish
        row3 = SeasonalRow(label="Week 3")
        row3.year_returns = {2022: 1.0, 2023: 2.0}
        rows.append(row3)

        # With default threshold of 50, row 2 is still included (50 >= 50)
        # Actually 50 < 50 is False, so 50% is NOT neutral - should be part of run
        result = detect_runs(rows, min_length=2, threshold_pct=50)
        # Row 2 has 50% trend, which is NOT < 50, so it continues the run
        assert len(result) == 1
        assert result[0].start_idx == 0
        assert result[0].end_idx == 2

    def test_threshold_breaks_run_when_below(self):
        """Rows with trend% strictly below threshold break runs."""
        rows = []
        # Row 1: 100% bullish
        row1 = SeasonalRow(label="Week 1")
        row1.year_returns = {2022: 1.0, 2023: 2.0}
        rows.append(row1)
        # Row 2: 50% - at higher threshold this is neutral
        row2 = SeasonalRow(label="Week 2")
        row2.year_returns = {2022: 1.0, 2023: -1.0}  # 50% green
        rows.append(row2)
        # Row 3: 100% bullish
        row3 = SeasonalRow(label="Week 3")
        row3.year_returns = {2022: 1.0, 2023: 2.0}
        rows.append(row3)

        # With threshold of 60, row 2 (50%) is neutral and breaks the run
        result = detect_runs(rows, min_length=2, threshold_pct=60)
        # Should have no runs of length >= 2 since middle row breaks continuity
        assert len(result) == 0

    def test_high_threshold_filters_more(self):
        """Higher threshold means more rows are considered neutral."""
        rows = []
        # Create 3 rows with 67% trend (2/3 green)
        for i in range(3):
            row = SeasonalRow(label=f"Week {i+1}")
            row.year_returns = {2022: 1.0, 2023: 2.0, 2024: -0.5}  # 67% green
            rows.append(row)

        # At threshold 50, all rows are in the run
        result_50 = detect_runs(rows, min_length=2, threshold_pct=50)
        assert len(result_50) == 1

        # At threshold 70, all rows are neutral (67% < 70%)
        result_70 = detect_runs(rows, min_length=2, threshold_pct=70)
        assert len(result_70) == 0


class TestGetPeriodDateLabel:
    """Tests for get_period_date_label function."""

    def test_monthly_entry_no_offset(self):
        """Entry date for monthly with no offset is 1st of month."""
        result = get_period_date_label("Jan", "monthly", 0, is_entry=True)
        assert result == "Jan-1"

    def test_monthly_entry_with_offset(self):
        """Entry date for monthly with offset adds days."""
        result = get_period_date_label("Jan", "monthly", 15, is_entry=True)
        assert result == "Jan-16"

    def test_monthly_exit_no_offset(self):
        """Exit date for monthly with no offset is last day of month."""
        result = get_period_date_label("Jan", "monthly", 0, is_entry=False)
        assert result == "Jan-31"

    def test_monthly_exit_with_offset(self):
        """Exit date for monthly with offset adds days."""
        result = get_period_date_label("Feb", "monthly", 5, is_entry=False)
        # Feb has 28 days + 5 = 33, wraps to Mar-5 (33 - 28 = 5)
        assert result == "Mar-5"

    def test_monthly_wraparound_label(self):
        """Handles wraparound labels like 'Jan+'."""
        result = get_period_date_label("Jan+", "monthly", 0, is_entry=True)
        assert result == "Jan-1"

    def test_weekly_entry_no_offset(self):
        """Entry date for weekly with no offset is Monday of that week (as date)."""
        result = get_period_date_label("Week 1", "weekly", 0, is_entry=True)
        # Week 1 of 2024 starts on Jan 1 (2024 starts on Monday)
        assert result == "Jan-1"

    def test_weekly_entry_with_offset(self):
        """Entry date for weekly with offset shifts day."""
        result = get_period_date_label("Week 5", "weekly", 2, is_entry=True)
        # Week 5 starts Jan 29, +2 days = Jan 31
        assert result == "Jan-31"

    def test_weekly_exit_no_offset(self):
        """Exit date for weekly with no offset is Sunday of that week (as date)."""
        result = get_period_date_label("Week 10", "weekly", 0, is_entry=False)
        # Week 10 starts Mar 4, +6 days = Mar 10
        assert result == "Mar-10"

    def test_weekly_exit_with_offset(self):
        """Exit date for weekly with offset shifts day."""
        result = get_period_date_label("Week 3", "weekly", 3, is_entry=False)
        # Week 3 starts Jan 15, +6+3 = +9 days = Jan 24
        assert result == "Jan-24"


# ============================================================================
# Tests: Plan Save / Load
# ============================================================================


class TestPlanCRUD:
    """Tests for save_plan, load_plan, list_plans, delete_plan."""

    @pytest.fixture(autouse=True)
    def _tmp_plans_dir(self, tmp_path, monkeypatch):
        """Redirect PLANS_DIR to a temp directory for each test."""
        import backend
        monkeypatch.setattr(backend, "PLANS_DIR", tmp_path / "plans")

    def test_save_and_load(self):
        from backend import save_plan, load_plan
        strategies = [{"symbol": "VBL.NS", "window_size": 60, "threshold": 60}]
        result = save_plan("my plan", strategies)
        assert result["ok"] is True
        data = load_plan("my plan")
        assert data["name"] == "my plan"
        assert data["strategies"] == strategies
        assert "saved_at" in data

    def test_list_plans(self):
        from backend import save_plan, list_plans
        save_plan("alpha", [{"symbol": "A.NS", "window_size": 30, "threshold": 50}])
        save_plan("beta", [
            {"symbol": "B.NS", "window_size": 7, "threshold": 75},
            {"symbol": "C.NS", "window_size": 60, "threshold": 60},
        ])
        plans = list_plans()
        assert len(plans) == 2
        names = {p["name"] for p in plans}
        assert names == {"alpha", "beta"}
        beta = next(p for p in plans if p["name"] == "beta")
        assert beta["strategies"] == 2

    def test_delete_plan(self):
        from backend import save_plan, delete_plan, list_plans
        save_plan("to-delete", [{"symbol": "X.NS", "window_size": 30, "threshold": 50}])
        assert len(list_plans()) == 1
        result = delete_plan("to-delete")
        assert result["ok"] is True
        assert len(list_plans()) == 0

    def test_load_nonexistent_raises(self):
        from backend import load_plan
        with pytest.raises(FileNotFoundError):
            load_plan("no-such-plan")

    def test_delete_nonexistent_raises(self):
        from backend import delete_plan
        with pytest.raises(FileNotFoundError):
            delete_plan("no-such-plan")

    def test_invalid_name_raises(self):
        from backend import save_plan
        with pytest.raises(ValueError):
            save_plan("bad/name", [])
        with pytest.raises(ValueError):
            save_plan("", [])

    def test_overwrite_existing(self):
        from backend import save_plan, load_plan
        save_plan("ow", [{"symbol": "A.NS", "window_size": 30, "threshold": 50}])
        save_plan("ow", [{"symbol": "B.NS", "window_size": 60, "threshold": 70}])
        data = load_plan("ow")
        assert data["strategies"][0]["symbol"] == "B.NS"

    def test_empty_dir_returns_empty_list(self):
        from backend import list_plans
        assert list_plans() == []


# ============================================================================
# Tests: get_window_bar_data
# ============================================================================


class TestGetWindowBarData:
    """Tests for get_window_bar_data function."""

    @pytest.fixture
    def mock_ohlc_df(self) -> pd.DataFrame:
        """Create a 3-year OHLC DataFrame (2021-2023) with predictable returns."""
        dates = pd.bdate_range("2021-01-01", "2023-12-31")
        np.random.seed(123)
        n = len(dates)
        # Start at 100, gentle uptrend
        close_prices = 100 + np.arange(n) * 0.05 + np.random.randn(n) * 0.2
        open_prices = close_prices - 0.1
        high_prices = close_prices + 0.5
        low_prices = close_prices - 0.5
        return pd.DataFrame(
            {
                "Open": open_prices,
                "High": high_prices,
                "Low": low_prices,
                "Close": close_prices,
            },
            index=dates,
        )

    @patch("backend.load_symbol_data")
    def test_empty_df_returns_error(self, mock_load):
        from backend import get_window_bar_data
        mock_load.return_value = pd.DataFrame()
        result = get_window_bar_data("TEST.NS", 30, 50)
        assert "error" in result
        assert result["years"] == []

    @patch("backend.get_years_from_data")
    @patch("backend.detect_sliding_windows")
    @patch("backend.load_symbol_data")
    def test_no_windows_returns_error(self, mock_load, mock_detect, mock_years, mock_ohlc_df):
        from backend import get_window_bar_data
        mock_load.return_value = mock_ohlc_df
        mock_detect.return_value = []
        result = get_window_bar_data("TEST.NS", 30, 50)
        assert "error" in result
        assert result["years"] == []

    @patch("backend.get_years_from_data")
    @patch("backend.detect_sliding_windows")
    @patch("backend.load_symbol_data")
    def test_no_years_returns_error(self, mock_load, mock_detect, mock_years, mock_ohlc_df):
        from backend import get_window_bar_data, SlidingWindow
        mock_load.return_value = mock_ohlc_df
        mock_detect.return_value = [
            SlidingWindow(start_day=30, end_day=60, length=30, avg_return=5.0,
                          win_rate=0.7, score=3.5, yield_per_day=0.17, year_returns={}),
        ]
        mock_years.return_value = []
        result = get_window_bar_data("TEST.NS", 30, 50)
        assert "error" in result
        assert result["years"] == []

    @patch("backend.get_years_from_data")
    @patch("backend.detect_sliding_windows")
    @patch("backend.load_symbol_data")
    def test_valid_result_structure(self, mock_load, mock_detect, mock_years, mock_ohlc_df):
        from backend import get_window_bar_data, SlidingWindow
        mock_load.return_value = mock_ohlc_df
        mock_detect.return_value = [
            SlidingWindow(start_day=30, end_day=60, length=30, avg_return=5.0,
                          win_rate=0.7, score=3.5, yield_per_day=0.17, year_returns={}),
        ]
        mock_years.return_value = [2021, 2022, 2023]
        result = get_window_bar_data("TEST.NS", 30, 50)
        assert "years" in result
        assert "error" not in result
        assert len(result["years"]) > 0
        for entry in result["years"]:
            assert "year" in entry
            assert "strategy_return" in entry
            assert "bh_return" in entry
            assert isinstance(entry["strategy_return"], float)
            assert isinstance(entry["bh_return"], float)

    @patch("backend.get_years_from_data")
    @patch("backend.detect_sliding_windows")
    @patch("backend.load_symbol_data")
    def test_strategy_return_differs_from_bh(self, mock_load, mock_detect, mock_years, mock_ohlc_df):
        """Strategy (only in-market during window) should differ from full-year B&H."""
        from backend import get_window_bar_data, SlidingWindow
        mock_load.return_value = mock_ohlc_df
        # Window covers only Feb (days 32-59)
        mock_detect.return_value = [
            SlidingWindow(start_day=32, end_day=59, length=28, avg_return=3.0,
                          win_rate=0.6, score=1.8, yield_per_day=0.11, year_returns={}),
        ]
        mock_years.return_value = [2022]
        result = get_window_bar_data("TEST.NS", 28, 50)
        assert len(result["years"]) == 1
        entry = result["years"][0]
        assert entry["year"] == 2022
        # Strategy is only in-market for ~28 days, so return should differ from B&H
        assert entry["strategy_return"] != entry["bh_return"]

    @patch("backend.get_years_from_data")
    @patch("backend.detect_sliding_windows")
    @patch("backend.load_symbol_data")
    def test_skips_years_with_few_trading_days(self, mock_load, mock_detect, mock_years):
        """Years with < 100 trading days should be skipped."""
        from backend import get_window_bar_data, SlidingWindow
        # Create a tiny dataframe with only 50 trading days in 2022
        dates = pd.bdate_range("2022-01-01", periods=50)
        df = pd.DataFrame(
            {
                "Open": np.full(50, 100.0),
                "High": np.full(50, 105.0),
                "Low": np.full(50, 95.0),
                "Close": np.full(50, 102.0),
            },
            index=dates,
        )
        mock_load.return_value = df
        mock_detect.return_value = [
            SlidingWindow(start_day=10, end_day=40, length=30, avg_return=3.0,
                          win_rate=0.6, score=1.8, yield_per_day=0.1, year_returns={}),
        ]
        mock_years.return_value = [2022]
        result = get_window_bar_data("TEST.NS", 30, 50)
        assert result["years"] == []

    @patch("backend.get_years_from_data")
    @patch("backend.detect_sliding_windows")
    @patch("backend.load_symbol_data")
    def test_threshold_passed_as_fraction(self, mock_load, mock_detect, mock_years, mock_ohlc_df):
        """Threshold int (e.g., 60) should be passed to detect_sliding_windows as 0.6."""
        from backend import get_window_bar_data, SlidingWindow
        mock_load.return_value = mock_ohlc_df
        mock_detect.return_value = [
            SlidingWindow(start_day=30, end_day=60, length=30, avg_return=5.0,
                          win_rate=0.7, score=3.5, yield_per_day=0.17, year_returns={}),
        ]
        mock_years.return_value = [2022]
        get_window_bar_data("TEST.NS", 30, 60)
        # Verify detect_sliding_windows was called with threshold=0.6
        call_kwargs = mock_detect.call_args
        assert call_kwargs[1]["threshold"] == 0.6

    @patch("backend.get_years_from_data")
    @patch("backend.detect_sliding_windows")
    @patch("backend.load_symbol_data")
    def test_returns_are_rounded(self, mock_load, mock_detect, mock_years, mock_ohlc_df):
        """All return values should be rounded to 2 decimal places."""
        from backend import get_window_bar_data, SlidingWindow
        mock_load.return_value = mock_ohlc_df
        mock_detect.return_value = [
            SlidingWindow(start_day=30, end_day=90, length=60, avg_return=5.0,
                          win_rate=0.7, score=3.5, yield_per_day=0.08, year_returns={}),
        ]
        mock_years.return_value = [2021, 2022, 2023]
        result = get_window_bar_data("TEST.NS", 60, 50)
        for entry in result["years"]:
            # Check rounding: str representation should have at most 2 decimal digits
            strat_str = str(entry["strategy_return"])
            bh_str = str(entry["bh_return"])
            if "." in strat_str:
                assert len(strat_str.split(".")[1]) <= 2
            if "." in bh_str:
                assert len(bh_str.split(".")[1]) <= 2

    @patch("backend.get_years_from_data")
    @patch("backend.detect_sliding_windows")
    @patch("backend.load_symbol_data")
    def test_multiple_windows(self, mock_load, mock_detect, mock_years, mock_ohlc_df):
        """Multiple windows should all contribute to strategy returns."""
        from backend import get_window_bar_data, SlidingWindow
        mock_load.return_value = mock_ohlc_df
        mock_detect.return_value = [
            SlidingWindow(start_day=30, end_day=60, length=30, avg_return=5.0,
                          win_rate=0.7, score=3.5, yield_per_day=0.17, year_returns={}),
            SlidingWindow(start_day=200, end_day=230, length=30, avg_return=3.0,
                          win_rate=0.6, score=1.8, yield_per_day=0.1, year_returns={}),
        ]
        mock_years.return_value = [2022]
        result = get_window_bar_data("TEST.NS", 30, 50)
        assert len(result["years"]) == 1
        # Strategy return exists (covers two separate windows)
        assert isinstance(result["years"][0]["strategy_return"], float)


# ============================================================================
# Tests: get_plan_bar_data
# ============================================================================


class TestGetPlanBarData:
    """Tests for get_plan_bar_data function."""

    def test_empty_strategies_returns_error(self):
        from backend import get_plan_bar_data
        result = get_plan_bar_data([])
        assert "error" in result
        assert result["years"] == []
        assert result["symbols"] == []

    @patch("backend._load_strategy_windows")
    def test_no_windows_returns_error(self, mock_load):
        from backend import get_plan_bar_data
        mock_load.return_value = None
        result = get_plan_bar_data([{"symbol": "TEST.NS", "window_size": 30, "threshold": 50}])
        assert "error" in result
        assert result["years"] == []

    @patch("backend._build_equity_curve")
    @patch("backend.get_years_from_data")
    @patch("backend._load_strategy_windows")
    def test_no_complete_years_returns_error(self, mock_load_strat, mock_years, mock_build):
        from backend import get_plan_bar_data
        ref_data = pd.DataFrame({"Close": [100]}, index=pd.to_datetime(["2024-01-01"]))
        mock_load_strat.return_value = ([], [], ref_data, [], ["TEST"])
        mock_years.return_value = []
        result = get_plan_bar_data([{"symbol": "TEST.NS", "window_size": 30, "threshold": 50}])
        assert "error" in result

    @patch("backend._build_equity_curve")
    @patch("backend.get_years_from_data")
    @patch("backend._load_strategy_windows")
    def test_valid_result_structure(self, mock_load_strat, mock_years, mock_build):
        from backend import get_plan_bar_data
        ref_data = pd.DataFrame(
            {"Close": np.linspace(100, 110, 250)},
            index=pd.bdate_range("2022-01-01", periods=250),
        )
        mock_load_strat.return_value = (
            [{"start_day": 30, "end_day": 60, "symbol": "VBL"}],
            [(30, 60)],
            ref_data,
            [ref_data],
            ["VBL"],
        )
        mock_years.return_value = [2022]
        mock_build.return_value = {
            "combined_curve": [0.0, 1.0, 2.5, 3.0],
            "bh_curve": [0.0, 0.5, 1.5, 2.0],
            "strategy_curves": {"VBL": [0.0, 1.0, 2.5, 3.0]},
            "trades_count": 1,
            "total_days": 30,
            "dates": ["Jan-1", "Jan-2"],
            "trades": [],
            "symbols": ["VBL"],
        }
        result = get_plan_bar_data([{"symbol": "VBL.NS", "window_size": 30, "threshold": 50}])
        assert "years" in result
        assert "symbols" in result
        assert result["symbols"] == ["VBL"]
        assert len(result["years"]) == 1
        entry = result["years"][0]
        assert entry["year"] == 2022
        assert "combined_return" in entry
        assert "bh_return" in entry
        assert "stock_returns" in entry
        assert "VBL" in entry["stock_returns"]

    @patch("backend._build_equity_curve")
    @patch("backend.get_years_from_data")
    @patch("backend._load_strategy_windows")
    def test_combined_return_from_curve_last_value(self, mock_load_strat, mock_years, mock_build):
        """combined_return should be last element of combined_curve."""
        from backend import get_plan_bar_data
        ref_data = pd.DataFrame(
            {"Close": np.linspace(100, 110, 250)},
            index=pd.bdate_range("2022-01-01", periods=250),
        )
        mock_load_strat.return_value = ([], [], ref_data, [], ["SYM"])
        mock_years.return_value = [2022]
        mock_build.return_value = {
            "combined_curve": [0.0, 1.0, 5.5678],
            "bh_curve": [0.0, 0.5, 3.1234],
            "strategy_curves": {"SYM": [0.0, 1.0, 5.5678]},
            "trades_count": 1,
            "total_days": 30,
            "dates": [],
            "trades": [],
            "symbols": ["SYM"],
        }
        result = get_plan_bar_data([{"symbol": "SYM.NS", "window_size": 30, "threshold": 50}])
        entry = result["years"][0]
        assert entry["combined_return"] == 5.57  # rounded to 2dp
        assert entry["bh_return"] == 3.12  # rounded to 2dp

    @patch("backend._build_equity_curve")
    @patch("backend.get_years_from_data")
    @patch("backend._load_strategy_windows")
    def test_skips_year_when_curve_is_none(self, mock_load_strat, mock_years, mock_build):
        """Years where _build_equity_curve returns None should be skipped."""
        from backend import get_plan_bar_data
        ref_data = pd.DataFrame(
            {"Close": np.linspace(100, 110, 250)},
            index=pd.bdate_range("2022-01-01", periods=250),
        )
        mock_load_strat.return_value = ([], [], ref_data, [], ["SYM"])
        mock_years.return_value = [2021, 2022]
        # Return None for 2021, valid curve for 2022
        mock_build.side_effect = [None, {
            "combined_curve": [0.0, 5.0],
            "bh_curve": [0.0, 3.0],
            "strategy_curves": {"SYM": [0.0, 5.0]},
            "trades_count": 1,
            "total_days": 30,
            "dates": [],
            "trades": [],
            "symbols": ["SYM"],
        }]
        result = get_plan_bar_data([{"symbol": "SYM.NS", "window_size": 30, "threshold": 50}])
        assert len(result["years"]) == 1
        assert result["years"][0]["year"] == 2022

    @patch("backend._build_equity_curve")
    @patch("backend.get_years_from_data")
    @patch("backend._load_strategy_windows")
    def test_multiple_symbols(self, mock_load_strat, mock_years, mock_build):
        """Plan with multiple stocks should include per-stock returns."""
        from backend import get_plan_bar_data
        ref_data = pd.DataFrame(
            {"Close": np.linspace(100, 110, 250)},
            index=pd.bdate_range("2022-01-01", periods=250),
        )
        mock_load_strat.return_value = (
            [
                {"start_day": 30, "end_day": 60, "symbol": "VBL"},
                {"start_day": 100, "end_day": 130, "symbol": "TCS"},
            ],
            [(30, 60), (100, 130)],
            ref_data,
            [ref_data, ref_data],
            ["VBL", "TCS"],
        )
        mock_years.return_value = [2022]
        mock_build.return_value = {
            "combined_curve": [0.0, 4.0],
            "bh_curve": [0.0, 2.0],
            "strategy_curves": {"VBL": [0.0, 3.0], "TCS": [0.0, 1.5]},
            "trades_count": 2,
            "total_days": 60,
            "dates": [],
            "trades": [],
            "symbols": ["VBL", "TCS"],
        }
        result = get_plan_bar_data([
            {"symbol": "VBL.NS", "window_size": 30, "threshold": 50},
            {"symbol": "TCS.NS", "window_size": 30, "threshold": 50},
        ])
        assert result["symbols"] == ["VBL", "TCS"]
        entry = result["years"][0]
        assert "VBL" in entry["stock_returns"]
        assert "TCS" in entry["stock_returns"]
        assert entry["stock_returns"]["VBL"] == 3.0
        assert entry["stock_returns"]["TCS"] == 1.5

    @patch("backend._build_equity_curve")
    @patch("backend.get_years_from_data")
    @patch("backend._load_strategy_windows")
    def test_missing_symbol_in_strategy_curves_defaults_zero(self, mock_load_strat, mock_years, mock_build):
        """If a symbol has no entry in strategy_curves, its return should be 0."""
        from backend import get_plan_bar_data
        ref_data = pd.DataFrame(
            {"Close": np.linspace(100, 110, 250)},
            index=pd.bdate_range("2022-01-01", periods=250),
        )
        mock_load_strat.return_value = ([], [], ref_data, [], ["VBL", "TCS"])
        mock_years.return_value = [2022]
        mock_build.return_value = {
            "combined_curve": [0.0, 4.0],
            "bh_curve": [0.0, 2.0],
            "strategy_curves": {"VBL": [0.0, 3.0]},  # TCS missing
            "trades_count": 1,
            "total_days": 30,
            "dates": [],
            "trades": [],
            "symbols": ["VBL"],
        }
        result = get_plan_bar_data([
            {"symbol": "VBL.NS", "window_size": 30, "threshold": 50},
            {"symbol": "TCS.NS", "window_size": 30, "threshold": 50},
        ])
        entry = result["years"][0]
        assert entry["stock_returns"]["VBL"] == 3.0
        assert entry["stock_returns"]["TCS"] == 0.0

    @patch("backend._build_equity_curve")
    @patch("backend.get_years_from_data")
    @patch("backend._load_strategy_windows")
    def test_empty_curves_default_zero(self, mock_load_strat, mock_years, mock_build):
        """Empty combined_curve and bh_curve should default to 0.0."""
        from backend import get_plan_bar_data
        ref_data = pd.DataFrame(
            {"Close": np.linspace(100, 110, 250)},
            index=pd.bdate_range("2022-01-01", periods=250),
        )
        mock_load_strat.return_value = ([], [], ref_data, [], ["SYM"])
        mock_years.return_value = [2022]
        mock_build.return_value = {
            "combined_curve": [],
            "bh_curve": [],
            "strategy_curves": {"SYM": []},
            "trades_count": 0,
            "total_days": 0,
            "dates": [],
            "trades": [],
            "symbols": ["SYM"],
        }
        result = get_plan_bar_data([{"symbol": "SYM.NS", "window_size": 30, "threshold": 50}])
        entry = result["years"][0]
        assert entry["combined_return"] == 0.0
        assert entry["bh_return"] == 0.0

    @patch("backend._build_equity_curve")
    @patch("backend.get_years_from_data")
    @patch("backend._load_strategy_windows")
    def test_multiple_years(self, mock_load_strat, mock_years, mock_build):
        """Should produce one entry per year with data."""
        from backend import get_plan_bar_data
        ref_data = pd.DataFrame(
            {"Close": np.linspace(100, 110, 500)},
            index=pd.bdate_range("2021-01-01", periods=500),
        )
        mock_load_strat.return_value = ([], [], ref_data, [], ["SYM"])
        mock_years.return_value = [2021, 2022, 2023]
        mock_build.side_effect = [
            {
                "combined_curve": [0.0, 10.0],
                "bh_curve": [0.0, 8.0],
                "strategy_curves": {"SYM": [0.0, 10.0]},
                "trades_count": 1, "total_days": 30, "dates": [], "trades": [], "symbols": ["SYM"],
            },
            {
                "combined_curve": [0.0, 5.0],
                "bh_curve": [0.0, 3.0],
                "strategy_curves": {"SYM": [0.0, 5.0]},
                "trades_count": 1, "total_days": 30, "dates": [], "trades": [], "symbols": ["SYM"],
            },
            {
                "combined_curve": [0.0, -2.0],
                "bh_curve": [0.0, -1.0],
                "strategy_curves": {"SYM": [0.0, -2.0]},
                "trades_count": 1, "total_days": 30, "dates": [], "trades": [], "symbols": ["SYM"],
            },
        ]
        result = get_plan_bar_data([{"symbol": "SYM.NS", "window_size": 30, "threshold": 50}])
        assert len(result["years"]) == 3
        years = [e["year"] for e in result["years"]]
        assert years == [2021, 2022, 2023]
        assert result["years"][0]["combined_return"] == 10.0
        assert result["years"][1]["combined_return"] == 5.0
        assert result["years"][2]["combined_return"] == -2.0
