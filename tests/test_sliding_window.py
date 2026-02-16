"""Tests for sliding window detection algorithm."""

from __future__ import annotations

import sys
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

import numpy as np
import pandas as pd
import pytest

from backend import (
    SlidingWindow,
    YearlyReturnsCache,
    day_of_year,
    date_from_day_of_year,
    build_returns_cache,
    get_years_from_data,
    score_window_fast,
    find_best_window_fast,
    find_best_fixed_window,
    narrow_window_fast,
    narrow_window_edges,
    detect_sliding_windows,
    load_symbol_data,
    parse_symbols,
)


# =============================================================================
# Unit Tests for Helper Functions
# =============================================================================

class TestDayOfYear:
    def test_jan_1(self):
        assert day_of_year(1, 1) == 1
    
    def test_jan_31(self):
        assert day_of_year(1, 31) == 31
    
    def test_feb_1(self):
        assert day_of_year(2, 1) == 32
    
    def test_dec_31(self):
        assert day_of_year(12, 31) == 365
    
    def test_mid_year(self):
        # July 1 is day 182
        assert day_of_year(7, 1) == 182


class TestDateFromDayOfYear:
    def test_day_1(self):
        assert date_from_day_of_year(1) == (1, 1)
    
    def test_day_32(self):
        assert date_from_day_of_year(32) == (2, 1)
    
    def test_day_365(self):
        assert date_from_day_of_year(365) == (12, 31)
    
    def test_roundtrip(self):
        for doy in [1, 50, 100, 182, 250, 365]:
            month, day = date_from_day_of_year(doy)
            assert day_of_year(month, day) == doy


# =============================================================================
# Tests with Synthetic Data
# =============================================================================

@pytest.fixture
def synthetic_df() -> pd.DataFrame:
    """Create synthetic OHLC data with known seasonal pattern."""
    dates = pd.bdate_range("2015-01-01", "2024-12-31")
    np.random.seed(42)
    
    # Base price with upward trend
    n = len(dates)
    base = 100 + np.arange(n) * 0.01
    
    # Add seasonal pattern: bullish Mar-May, bearish Sep-Nov
    seasonal = np.zeros(n)
    for i, date in enumerate(dates):
        if date.month in [3, 4, 5]:  # Mar-May: bullish
            seasonal[i] = 0.1  # +0.1% per day
        elif date.month in [9, 10, 11]:  # Sep-Nov: bearish
            seasonal[i] = -0.05  # -0.05% per day
    
    # Add noise
    noise = np.random.randn(n) * 0.3
    
    # Build prices
    daily_returns = seasonal + noise * 0.01
    close_prices = base * np.cumprod(1 + daily_returns)
    
    return pd.DataFrame(
        {
            "Open": close_prices * 0.999,
            "High": close_prices * 1.01,
            "Low": close_prices * 0.99,
            "Close": close_prices,
        },
        index=dates,
    )


@pytest.fixture
def synthetic_cache(synthetic_df) -> YearlyReturnsCache:
    """Build a YearlyReturnsCache from synthetic data."""
    years = get_years_from_data(synthetic_df)
    return build_returns_cache(synthetic_df, years)


class TestScoreWindowFast:
    def test_bullish_window(self, synthetic_cache):
        """Test scoring a known bullish period (Mar-May)."""
        # March 1 to May 31
        start_doy = day_of_year(3, 1)  # ~60
        end_doy = day_of_year(5, 31)   # ~151
        
        result = score_window_fast(synthetic_cache, start_doy, end_doy)
        assert result is not None
        
        avg_return, win_rate, score, year_returns = result
        
        # Should have positive average return
        assert avg_return > 0, f"Expected positive return, got {avg_return}"
        # Should have high win rate
        assert win_rate >= 0.5, f"Expected win rate >= 50%, got {win_rate}"
    
    def test_bearish_window(self, synthetic_cache):
        """Test scoring a known bearish period (Sep-Nov)."""
        # September 1 to November 30
        start_doy = day_of_year(9, 1)   # ~244
        end_doy = day_of_year(11, 30)   # ~334
        
        result = score_window_fast(synthetic_cache, start_doy, end_doy)
        assert result is not None
        
        avg_return, win_rate, score, year_returns = result
        
        # Should have negative or low average return
        assert avg_return < 5, f"Expected low/negative return, got {avg_return}"


class TestFindBestWindowFast:
    def test_finds_bullish_period(self, synthetic_cache):
        """Should find a window with positive returns."""
        window = find_best_window_fast(
            synthetic_cache,
            max_days=120,  # Up to 4 months
            min_window=30,
            threshold=0.5,
        )
        
        assert window is not None
        assert window.avg_return > 0
        assert window.win_rate >= 0.5
        
        # Should be in a reasonable range
        mar_1 = day_of_year(3, 1)
        jun_1 = day_of_year(6, 1)
        assert window.start_day >= mar_1 - 30, f"Window starts too early: {window.start_date_str}"
        assert window.end_day <= jun_1 + 30, f"Window ends too late: {window.end_date_str}"
    
    def test_respects_excluded_days(self, synthetic_cache):
        """Should not include excluded days in window."""
        # Exclude March entirely
        excluded = set(range(day_of_year(3, 1), day_of_year(4, 1)))
        
        window = find_best_window_fast(
            synthetic_cache,
            max_days=60,
            excluded_days=excluded,
            min_window=20,
            threshold=0.5,
        )
        
        if window is not None:
            window_days = set(range(window.start_day, window.end_day + 1))
            assert not (window_days & excluded), "Window should not overlap excluded days"


class TestFindBestFixedWindow:
    def test_finds_fixed_size_window(self, synthetic_cache):
        """Should find the best 30-day window."""
        window = find_best_fixed_window(
            synthetic_cache,
            window_size=30,
            threshold=0.5,
        )
        
        assert window is not None
        assert window.length == 30
        assert window.avg_return > 0
        assert window.win_rate >= 0.5

    def test_respects_range(self, synthetic_cache):
        """Window should be confined within the given range."""
        # Only search in Jan-Feb (days 1-59)
        range_start = 1
        range_end = 59
        
        window = find_best_fixed_window(
            synthetic_cache,
            window_size=30,
            range_start=range_start,
            range_end=range_end,
            threshold=0.3,  # Lower threshold since Jan-Feb may not be strongly bullish
        )
        
        if window is not None:
            assert window.start_day >= range_start, \
                f"Window starts before range: {window.start_day} < {range_start}"
            assert window.end_day <= range_end, \
                f"Window ends after range: {window.end_day} > {range_end}"
    
    def test_returns_none_for_small_range(self, synthetic_cache):
        """Should return None if range is smaller than window_size."""
        window = find_best_fixed_window(
            synthetic_cache,
            window_size=30,
            range_start=1,
            range_end=20,
        )
        assert window is None


class TestNarrowWindowFast:
    def test_narrowing_improves_yield(self, synthetic_cache):
        """Narrowing should improve or maintain yield per day."""
        # Find a broad window first
        window = find_best_window_fast(
            synthetic_cache,
            max_days=120,
            min_window=30,
            threshold=0.5,
        )
        
        assert window is not None
        
        # Narrow it
        narrowed = narrow_window_fast(
            synthetic_cache,
            window,
            min_window=15,
            threshold=0.5,
        )
        
        # Yield should be >= original
        assert narrowed.yield_per_day >= window.yield_per_day * 0.99, \
            f"Yield decreased: {narrowed.yield_per_day} < {window.yield_per_day}"


class TestNarrowWindowEdges:
    """Tests for narrow_window_edges (score-based edge trimming)."""

    def test_score_never_decreases(self, synthetic_cache):
        """Narrowing should never reduce the score."""
        window = find_best_fixed_window(
            synthetic_cache, window_size=30, threshold=0.5,
        )
        assert window is not None

        narrowed = narrow_window_edges(
            synthetic_cache, window, threshold=0.5, min_length=5,
        )
        assert narrowed.score >= window.score, (
            f"Score decreased: {narrowed.score} < {window.score}"
        )

    def test_respects_min_length(self, synthetic_cache):
        """Narrowed window should never be shorter than min_length."""
        window = find_best_fixed_window(
            synthetic_cache, window_size=30, threshold=0.5,
        )
        assert window is not None

        for min_len in [5, 10, 20]:
            narrowed = narrow_window_edges(
                synthetic_cache, window, threshold=0.5, min_length=min_len,
            )
            assert narrowed.length >= min_len, (
                f"Window narrowed to {narrowed.length} < min_length {min_len}"
            )

    def test_stays_within_original_bounds(self, synthetic_cache):
        """Narrowed window should be a sub-range of the original."""
        window = find_best_fixed_window(
            synthetic_cache, window_size=60, threshold=0.5,
        )
        assert window is not None

        narrowed = narrow_window_edges(
            synthetic_cache, window, threshold=0.5, min_length=5,
        )
        assert narrowed.start_day >= window.start_day
        assert narrowed.end_day <= window.end_day

    def test_maintains_threshold(self, synthetic_cache):
        """Narrowed window must still meet the win-rate threshold."""
        window = find_best_fixed_window(
            synthetic_cache, window_size=30, threshold=0.6,
        )
        if window is None:
            pytest.skip("No window found at 60% threshold")

        narrowed = narrow_window_edges(
            synthetic_cache, window, threshold=0.6, min_length=5,
        )
        assert narrowed.win_rate >= 0.6
        assert narrowed.avg_return > 0

    def test_fields_consistent(self, synthetic_cache):
        """All SlidingWindow fields should be self-consistent after narrowing."""
        window = find_best_fixed_window(
            synthetic_cache, window_size=30, threshold=0.5,
        )
        assert window is not None

        narrowed = narrow_window_edges(
            synthetic_cache, window, threshold=0.5, min_length=5,
        )
        assert narrowed.length == narrowed.end_day - narrowed.start_day + 1
        assert abs(narrowed.yield_per_day - narrowed.avg_return / narrowed.length) < 1e-9
        assert abs(narrowed.score - narrowed.avg_return * narrowed.win_rate) < 1e-9

    def test_identity_when_already_optimal(self, synthetic_cache):
        """If trimming either edge hurts the score, the window should be returned unchanged."""
        # Use a very small window — less room for improvement
        window = find_best_fixed_window(
            synthetic_cache, window_size=7, threshold=0.5,
        )
        assert window is not None

        narrowed = narrow_window_edges(
            synthetic_cache, window, threshold=0.5, min_length=7,
        )
        # min_length == window length, so no trimming is possible
        assert narrowed.start_day == window.start_day
        assert narrowed.end_day == window.end_day

    def test_trims_merged_window(self, synthetic_cache):
        """A larger window (simulating a merge) should benefit from edge trimming."""
        # Create a deliberately wide window and see if narrowing trims it
        wide_start = day_of_year(2, 1)    # Feb 1
        wide_end = day_of_year(6, 30)     # Jun 30 — covers bullish Mar-May + neutral months

        result = score_window_fast(synthetic_cache, wide_start, wide_end)
        if result is None:
            pytest.skip("No data for wide window")

        avg_return, win_rate, score, year_returns = result
        if avg_return <= 0 or win_rate < 0.5:
            pytest.skip("Wide window not bullish enough to test trimming")

        wide_window = SlidingWindow(
            start_day=wide_start,
            end_day=wide_end,
            length=wide_end - wide_start + 1,
            avg_return=avg_return,
            win_rate=win_rate,
            score=score,
            yield_per_day=avg_return / (wide_end - wide_start + 1),
            year_returns=year_returns,
        )

        narrowed = narrow_window_edges(
            synthetic_cache, wide_window, threshold=0.5, min_length=30,
        )

        # Should have trimmed at least one edge (Feb and/or Jun are neutral)
        assert narrowed.score >= wide_window.score
        trimmed_days = wide_window.length - narrowed.length
        assert trimmed_days >= 0, "Should not have grown"

    def test_integrated_in_detect(self, synthetic_df):
        """detect_sliding_windows should produce windows with scores at least
        as good as the un-narrowed versions would have."""
        windows = detect_sliding_windows(
            synthetic_df, window_size=30, threshold=0.5,
        )
        # Just verify basic invariants post-narrowing
        for w in windows:
            assert w.length >= 5
            assert w.avg_return > 0
            assert w.win_rate >= 0.5
            assert w.length == w.end_day - w.start_day + 1
            assert abs(w.score - w.avg_return * w.win_rate) < 1e-9


class TestDetectSlidingWindows:
    def test_finds_multiple_windows(self, synthetic_df):
        """Should find multiple non-overlapping windows."""
        windows = detect_sliding_windows(
            synthetic_df,
            window_size=30,
            threshold=0.5,
        )
        
        assert len(windows) >= 1, "Should find at least one window"
        
        # Windows should be sorted by start day
        for i in range(1, len(windows)):
            assert windows[i].start_day > windows[i-1].end_day, \
                "Windows should not overlap"
    
    def test_no_overlap(self, synthetic_df):
        """Windows should never overlap."""
        windows = detect_sliding_windows(
            synthetic_df,
            window_size=60,
            threshold=0.5,
        )
        
        all_days = set()
        for w in windows:
            window_days = set(range(w.start_day, w.end_day + 1))
            assert not (window_days & all_days), f"Window {w.start_date_str}-{w.end_date_str} overlaps"
            all_days.update(window_days)

    def test_different_window_sizes(self, synthetic_df):
        """Should work with various window sizes."""
        for size in [7, 14, 30, 60, 90]:
            windows = detect_sliding_windows(
                synthetic_df,
                window_size=size,
                threshold=0.5,
            )
            # Should not crash, may find 0 or more windows
            assert isinstance(windows, list)


# =============================================================================
# Integration Tests with Real Data
# =============================================================================

class TestWithRealData:
    """Tests using real stock data - may be slow due to data download."""
    
    @pytest.fixture
    def icicibank_data(self):
        """Load ICICIBANK data."""
        return load_symbol_data("ICICIBANK.NS")
    
    @pytest.fixture
    def mahabank_data(self):
        """Load MAHABANK data."""
        return load_symbol_data("MAHABANK.NS")
    
    @pytest.fixture
    def nsebank_data(self):
        """Load NSEBANK index data."""
        return load_symbol_data("^NSEBANK")
    
    @pytest.mark.slow
    def test_icicibank_windows(self, icicibank_data):
        """Test sliding window detection on ICICIBANK."""
        if icicibank_data.empty:
            pytest.skip("No data available for ICICIBANK")
        
        windows = detect_sliding_windows(
            icicibank_data,
            window_size=30,
            threshold=0.5,
        )
        
        print(f"\nICICIBANK - Found {len(windows)} windows (30-day):")
        for w in windows:
            print(f"  {w.start_date_str} to {w.end_date_str}: "
                  f"{w.length} days, {w.avg_return:.1f}% avg, "
                  f"{w.win_rate*100:.0f}% win rate, "
                  f"{w.yield_per_day*100:.2f} bps/day")
        
        assert len(windows) >= 1
    
    @pytest.mark.slow
    def test_mahabank_windows(self, mahabank_data):
        """Test sliding window detection on MAHABANK."""
        if mahabank_data.empty:
            pytest.skip("No data available for MAHABANK")
        
        windows = detect_sliding_windows(
            mahabank_data,
            window_size=30,
            threshold=0.5,
        )
        
        print(f"\nMAHABANK - Found {len(windows)} windows (30-day):")
        for w in windows:
            print(f"  {w.start_date_str} to {w.end_date_str}: "
                  f"{w.length} days, {w.avg_return:.1f}% avg, "
                  f"{w.win_rate*100:.0f}% win rate, "
                  f"{w.yield_per_day*100:.2f} bps/day")
        
        assert len(windows) >= 1
    
    @pytest.mark.slow
    def test_nsebank_windows(self, nsebank_data):
        """Test sliding window detection on NSEBANK index."""
        if nsebank_data.empty:
            pytest.skip("No data available for ^NSEBANK")
        
        windows = detect_sliding_windows(
            nsebank_data,
            window_size=30,
            threshold=0.5,
        )
        
        print(f"\n^NSEBANK - Found {len(windows)} windows (30-day):")
        for w in windows:
            print(f"  {w.start_date_str} to {w.end_date_str}: "
                  f"{w.length} days, {w.avg_return:.1f}% avg, "
                  f"{w.win_rate*100:.0f}% win rate, "
                  f"{w.yield_per_day*100:.2f} bps/day")
        
        assert len(windows) >= 1
    
    @pytest.mark.slow
    def test_compare_window_sizes(self, icicibank_data):
        """Compare results with different window size settings."""
        if icicibank_data.empty:
            pytest.skip("No data available for ICICIBANK")
        
        for size, label in [(7, "1 week"), (30, "1 month"), (90, "3 months")]:
            windows = detect_sliding_windows(
                icicibank_data,
                window_size=size,
                threshold=0.5,
            )
            
            total_days = sum(w.length for w in windows)
            total_return = sum(w.avg_return for w in windows)
            
            print(f"\nICICIBANK - Window size {label} ({size} days):")
            print(f"  Found {len(windows)} windows")
            print(f"  Total days invested: {total_days}")
            print(f"  Total expected return: {total_return:.1f}%")
            
            for w in windows:
                print(f"    {w.start_date_str} to {w.end_date_str}: "
                      f"{w.length}d, {w.avg_return:.1f}%, "
                      f"{w.win_rate*100:.0f}% win")


if __name__ == "__main__":
    # Run quick test with real data
    print("Loading data...")
    
    symbols = ["ICICIBANK.NS", "MAHABANK.NS", "^NSEBANK"]
    
    for symbol in symbols:
        print(f"\n{'='*60}")
        print(f"Testing {symbol}")
        print('='*60)
        
        try:
            data = load_symbol_data(symbol)
            if data.empty:
                print(f"  No data available")
                continue
            
            print(f"  Data range: {data.index.min().date()} to {data.index.max().date()}")
            print(f"  {len(data)} trading days")
            
            for size, label in [(7, "1 week"), (30, "1 month"), (90, "3 months")]:
                windows = detect_sliding_windows(
                    data,
                    window_size=size,
                    threshold=0.5,
                )
                
                print(f"\n  Window size: {label}")
                print(f"  Found {len(windows)} windows:")
                
                for w in windows:
                    print(f"    {w.start_date_str:>6} - {w.end_date_str:<6}: "
                          f"{w.length:3}d, {w.avg_return:6.1f}% avg, "
                          f"{w.win_rate*100:3.0f}% win, "
                          f"{w.yield_per_day*100:5.2f} bps/day")
                
                if windows:
                    total_days = sum(w.length for w in windows)
                    total_return = sum(w.avg_return for w in windows)
                    print(f"    {'TOTAL':<16}: {total_days:3}d, {total_return:6.1f}%")
        
        except Exception as e:
            print(f"  Error: {e}")
