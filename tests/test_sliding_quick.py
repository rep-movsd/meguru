"""Quick test for sliding window detection with real stocks."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from backend import (
    detect_sliding_windows,
    load_symbol_data,
)


def _run_stock(symbol: str, window_sizes: list[tuple[int, str]]):
    """Run sliding window detection for a stock (not a pytest test)."""
    print(f"\n{'='*60}")
    print(f"Testing {symbol}")
    print('='*60)
    
    try:
        data = load_symbol_data(symbol)
        if data.empty:
            print(f"  No data available")
            return
        
        print(f"  Data range: {data.index.min().date()} to {data.index.max().date()}")
        print(f"  {len(data)} trading days")
        
        for window_size, label in window_sizes:
            print(f"\n  Window size: {label} ({window_size} days)")
            
            windows = detect_sliding_windows(
                data,
                window_size=window_size,
                threshold=0.5,
            )
            
            print(f"  Found {len(windows)} windows (after merging adjacent):")
            
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
        import traceback
        print(f"  Error: {e}")
        traceback.print_exc()


if __name__ == "__main__":
    symbols = ["ICICIBANK.NS", "MAHABANK.NS", "^NSEBANK"]
    window_sizes = [
        (7, "1 week"),
        (14, "2 weeks"),
        (30, "1 month"),
        (60, "2 months"), 
        (90, "3 months")
    ]
    
    print("Loading data and testing sliding window detection...")
    print("Algorithm: Find best N-day window, mark used, repeat, merge adjacent")
    
    for symbol in symbols:
        _run_stock(symbol, window_sizes)
