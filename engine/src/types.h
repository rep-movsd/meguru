#pragma once

// ---------------------------------------------------------------------------
// common.h — shared aliases, macros, includes, and fundamental types.
// ---------------------------------------------------------------------------

#define CREF(T)   const T&
#define CAUTOREF  const auto&
#define CAUTO     const auto

#define FOR(X, MIN, MAX)   for(i32 X = MIN; X < MAX; X++)
#define FORLE(X, MIN, MAX) for(i32 X = MIN; X <= MAX; X++)

// ---------------------------------------------------------------------------
// Debug logging — enabled via cmake -DMEGURU_DEBUG=ON
// Emscripten routes printf to console.log.
// ---------------------------------------------------------------------------

#ifdef MEGURU_DEBUG
    #include <cstdio>
    #define DEBUG_LOG(fmt, ...) printf("[meguru] " fmt "\n", ##__VA_ARGS__)
#else
    #define DEBUG_LOG(fmt, ...) ((void)0)
#endif

#include <cstdint>
#include <cassert>

#include <string>
#include <string_view>
#include <vector>
#include <map>
#include <valarray>
#include <algorithm>
#include <ranges>

#include <charconv>
#include <format>
#include <fstream>
#include <sstream>
#include <chrono>
#include <filesystem>

using namespace std;

// ---------------------------------------------------------------------------
// Scalar aliases
// ---------------------------------------------------------------------------

using i32 = int32_t;
using i64 = int64_t;
using u64 = uint64_t;
using f64 = double;

// ---------------------------------------------------------------------------
// String aliases
// ---------------------------------------------------------------------------

using str  = string;
using cstr = const string;
using sv   = string_view;

// ---------------------------------------------------------------------------
// Container aliases
// ---------------------------------------------------------------------------

using vstr = vector<string>;
using vint = vector<i32>;
using vf64 = vector<f64>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

constexpr i32 DAYS = 366;

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

// 366-element price array (one per day-of-year)
using TPrices = valarray<f64>;

// 366-element day index array — maps each slot to the real trading day index
// Real trading day: arrDayIdx[i] == i
// Backfilled gap:   arrDayIdx[i] > i (points to the future day used to fill)
using TDayIndices = vint;

// One year of daily data: prices + parallel day indices (both 366 elements, backfilled)
struct TYearData {
    TPrices     arrPrices = TPrices(0.0, DAYS);
    TDayIndices arrDayIdx = TDayIndices(DAYS, -1);
};

// All cached year data for a stock, keyed by year number
using TYearDataMap = map<i32, TYearData>;

// A discovered trade window
struct TWindow {
    i32 iBeg  = 0;
    i32 iEnd  = 0;
    f64 fGain = 0.0;   // avg daily gain used during discovery
};
using TWindows = vector<TWindow>;

// Per-stock strategy parameters
struct TPlanParams {
    i32 nYears       = 10;    // how many years to backtest
    i32 nWinMin      = 10;    // min window size (days)
    i32 nWinMax      = 31;    // max window size (days)
    f64 pctThreshold = 1.0;   // min gain % to count as a win
};

// Stats for one discovered trade window
struct TWindowStat {
    i32  iBeg          = 0;
    i32  iEnd          = 0;
    f64  pctWin        = 0.0;   // % of years with gain > 0
    f64  pctExpected   = 0.0;   // mean gain % across years
    f64  fProfitRatio  = 0.0;   // sum(wins) / -sum(losses), loss seeded at 0.01
    vf64 arrYearGains;          // gain % per year, ordered most-recent-first
};
using TWindowStats = vector<TWindowStat>;

// ---------------------------------------------------------------------------
// Graph data — normalized B&H curves for charting
// ---------------------------------------------------------------------------

// Per-stock: map of year-string ("2024", "average") → 366 normalized values
// Normalization: (price[d] / price[0]) - 1.0  → 0 at start, +1 = doubled
using TYearCurve = map<str, TPrices>;

// Full graph result returned by getGraphData()
struct TGraphData {
    vstr                  arrStocks;       // stock symbols, same order as arrPerStock
    vint                  arrYears;        // nYear most-recent years (desc)
    vector<TYearCurve>    arrPerStock;     // parallel to arrStocks
    TYearCurve            dctBasketAvg;    // equal-weight avg across stocks
};
