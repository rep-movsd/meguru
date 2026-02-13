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

    def test_respects_excluded_days(self, synthetic_cache):
        """Excluded days should not be part of found window."""
        # Exclude April
        excluded = set(range(day_of_year(4, 1), day_of_year(5, 1)))
        
        window = find_best_fixed_window(
            synthetic_cache,
            window_size=30,
            excluded_days=excluded,
            threshold=0.5,
        )
        
        if window is not None:
            window_days = set(range(window.start_day, window.end_day + 1))
            assert not (window_days & excluded), "Window should not overlap excluded days"


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
