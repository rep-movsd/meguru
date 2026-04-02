#pragma once

#include <cstdint>
#include <vector>
#include <array>
#include <valarray>
#include <string>

using std::array, std::string, std::vector, std::valarray;

using i32  = int32_t;
using i64  = int64_t;

// All years are treated as 366-day leap years for index consistency.
// Non-leap years shift days after Feb 28 up by one so index 59 is always Feb 29.
constexpr i32 DAYS = 366;

// ---------------------------------------------------------------------------
// Price data
// ---------------------------------------------------------------------------

// Raw price in integer cents (1/100 of currency unit)
using TPrice = int32_t;

// Daily prices for one year, indexed 0..365
using TArrPrices = valarray<i64>;

// One year of daily price data with date strings
struct TYearPriceEntries {
    array<string, DAYS> sDates;
    TArrPrices arrPrices = TArrPrices(static_cast<i64>(0), DAYS);
};

// Multiple years of price data (index 0 = most recent year)
using TArrPriceEntriesPerYear = vector<TYearPriceEntries>;

// ---------------------------------------------------------------------------
// Trade windows and statistics
// ---------------------------------------------------------------------------

// A buy/sell day pair within a year (day-of-year indices, 0-365)
using TDayRange  = std::pair<i32, i32>;
using TDayRanges = std::vector<TDayRange>;

// Combined stats for one trade window across all analyzed years
struct TTradeStat {
    i32    iBeg        = 0;       // Window start day-of-year
    i32    iEnd        = 0;       // Window end day-of-year
    double pctWin      = 0.0;    // % of years that were winners (>1% gain)
    double fSkew       = 0.0;    // Median / Mean
    double fSharpe     = 0.0;    // Sharpe ratio
    double pctExpected = 0.0;    // Expectancy (weighted avg of win/loss)
    vector<double> arrPctDelta;  // Per-year gain/loss % for this window
};

using TTradeStats = vector<TTradeStat>;

// Simplified trade window for visualization
struct TTradeWindow {
    i32    iBeg      = 0;
    i32    iEnd      = 0;
    double priceBeg  = 0.0;    // Buy price
    double priceEnd  = 0.0;    // Sell price (after 2x fee deduction)
};

// ---------------------------------------------------------------------------
// Stock parameters (per-stock strategy config)
// ---------------------------------------------------------------------------

struct TStockParams {
    i32    nYears  = 10;     // Number of historical years to analyze
    i32    nWinMin = 10;     // Minimum trade window size (days)
    i32    nWinMax = 31;     // Maximum trade window size (days)
    double fPctWin = 60.0;   // Win-rate threshold (%)
};

// ---------------------------------------------------------------------------
// Allocation
// ---------------------------------------------------------------------------

enum class EAllocMode {
    Equal,     // Equal weight across all visible stocks
    MCap,      // Weight by market capitalization
    AvgRet,    // Weight by average historical return
    Custom     // User-specified weights
};

// ---------------------------------------------------------------------------
// Results — Stock-level (single stock detail / plan view)
// ---------------------------------------------------------------------------

// Multiplier info at end of each trade window (for chart labels)
struct TWindowMultiplier {
    i32    iBeg                 = 0;
    i32    iEnd                 = 0;
    double windowMultiplier     = 1.0;   // This window's price ratio
    double cumulativeMultiplier = 1.0;   // Running product across windows
};

// Per-year result for a single stock (returned by getStockDetail)
struct TStockYearResult {
    i32                year = 0;
    array<double, DAYS> prices   = {};    // Daily price (double, from cents/100)
    array<double, DAYS> returns  = {};    // Daily plan return %
    vector<TTradeWindow>      windows;
    vector<TWindowMultiplier> windowMultipliers;
};

// Complete detail for one stock (selected in basket)
struct TStockDetail {
    string                   sStock;
    TTradeStats              stats;        // Trade window stats
    vector<TStockYearResult> years;        // Per-year detail
    TStockYearResult         average;      // Average across years
};

// ---------------------------------------------------------------------------
// Results — Basket-level (aggregate across all visible stocks)
// ---------------------------------------------------------------------------

// Per-stock summary within basket results
struct TBasketStockSummary {
    string sStock;
    i32    daysInMarket = 0;    // Sum of (iEnd - iBeg) across trade windows
    struct YearReturn {
        i32    year = 0;
        double plan = 0.0;     // Final plan return %
        double bh   = 0.0;     // Final buy & hold return %
    };
    vector<YearReturn> years;
};

// Per-year basket result (weighted aggregate)
struct TBasketYearResult {
    i32                 year = 0;
    array<double, DAYS> returns = {};     // Weighted daily plan return %
    array<double, DAYS> buyHold = {};     // Weighted daily buy & hold %
};

// Basket aggregate statistics
struct TBasketStats {
    double avgPlan    = 0.0;
    double avgBh      = 0.0;
    i32    beatsBh    = 0;
    i32    totalYears = 0;
    double sharpe     = 0.0;
};

// Complete basket result
struct TBasketResult {
    vector<string>             stocks;     // Participating stock symbols
    vector<TBasketYearResult>  years;
    TBasketYearResult          average;
    vector<TBasketStockSummary> perStock;
    TBasketStats               stats;
    vector<vector<double>>     weights;    // weights[yearIdx][stockIdx]
    EAllocMode                 alloc = EAllocMode::Equal;
};
