#pragma once

// ---------------------------------------------------------------------------
// IEngine — Abstract interface for the Meguru trading engine.
//
// The engine is STATEFUL: it holds the current basket configuration
// (stocks + params + allocation), cached computation results, and reads
// price data directly from OPFS.
//
// Data flow:
//   1. JS fetches stock CSV from Yahoo (via CORS proxy) and stores in OPFS
//      at stocks/{SYMBOL}.NS_{YEAR}.csv
//   2. JS calls addStock() — engine reads price data from OPFS internally
//   3. JS calls updateStockParams() to tweak parameters (hot path)
//   4. JS calls getBasketResult() or getStockDetail() to get computed results
//
// The engine reads OPFS files at:  stocks/{SYMBOL}.NS_{YEAR}.csv
// Missing years are backfilled with the initial known price (flat line).
// .nodata sentinel files are recognized and skipped.
//
// The engine caches intermediate results (trade stats, simulation runs) and
// invalidates only what's necessary when a parameter changes.  For example,
// changing one stock's minWin recomputes that stock's trade stats and the
// basket aggregate, but does not reload price data or recompute other stocks.
//
// All result methods return JSON strings.  This keeps the WASM↔JS boundary
// simple (string in, string out) and avoids complex embind type mappings.
// ---------------------------------------------------------------------------

#include "types.h"

class IEngine {
public:
    virtual ~IEngine() = default;

    // -----------------------------------------------------------------------
    // Basket management
    // -----------------------------------------------------------------------

    // Add a stock to the basket with the given strategy parameters.
    // The engine reads price data from OPFS internally:
    //   stocks/{symbol}.NS_{year}.csv  — daily prices (Date,Close format)
    //   stocks/{symbol}.NS_{year}.nodata — sentinel for years without data
    // Missing years (no file, no sentinel) are backfilled with the initial
    // known price.  Trade stats are computed immediately.
    //
    // If the stock is already in the basket, this is equivalent to
    // updateStockParams().
    virtual void addStock(const string& symbol, const TStockParams& params) = 0;

    // Remove a stock from the basket and free its cached data.
    virtual void removeStock(const string& symbol) = 0;

    // Update strategy parameters for a stock already in the basket.
    // Only recomputes trade stats for this stock (not others).
    // This is the hot path for slider interactions — must be fast.
    virtual void updateStockParams(const string& symbol, const TStockParams& params) = 0;

    // Set the visibility of a stock in the basket.
    // Hidden stocks are excluded from basket aggregate computation
    // but remain in the basket (their data and params are preserved).
    virtual void setStockVisible(const string& symbol, bool visible) = 0;

    // -----------------------------------------------------------------------
    // Allocation
    // -----------------------------------------------------------------------

    // Set the allocation mode for the basket.
    // For Custom mode, weights must be set per-stock via setCustomWeight().
    virtual void setAllocMode(EAllocMode mode) = 0;

    // Set market cap for a stock (used by MCap allocation mode).
    virtual void setMarketCap(const string& symbol, double mcap) = 0;

    // Set custom weight for a stock (used by Custom allocation mode).
    // Weights are relative — the engine normalizes them to sum to 1.0.
    virtual void setCustomWeight(const string& symbol, double weight) = 0;

    // -----------------------------------------------------------------------
    // Computation — results as JSON strings
    // -----------------------------------------------------------------------

    // Get the full basket result (aggregate across all visible stocks).
    //
    // Returns a JSON string with the shape:
    // {
    //   "stocks": ["SYM1", "SYM2", ...],
    //   "years": [
    //     { "year": 2025, "returns": [366 doubles], "buyHold": [366 doubles] },
    //     ...
    //   ],
    //   "average": { "returns": [366], "buyHold": [366] },
    //   "perStock": [
    //     { "stock": "SYM1", "daysInMarket": N,
    //       "years": [{ "year": 2025, "plan": F, "bh": F }, ...] },
    //     ...
    //   ],
    //   "stats": { "avgPlan": F, "avgBh": F, "beatsBh": N, "totalYears": N, "sharpe": F },
    //   "weights": [[w1, w2, ...], ...],    // per-year weights
    //   "alloc": "equal"|"mcap"|"avgret"|"custom"
    // }
    //
    // Returns empty string if no visible stocks in basket.
    virtual string getBasketResult() = 0;

    // Get detailed results for a single stock (for the selected/drill-down view).
    //
    // Returns a JSON string with the shape:
    // {
    //   "stock": "SYM",
    //   "stats": [
    //     { "iBeg": N, "iEnd": N, "pctWin": F, "fSkew": F, "fSharpe": F,
    //       "pctExpected": F, "yearlyReturns": [F, ...] },
    //     ...
    //   ],
    //   "years": [
    //     { "year": 2025, "prices": [366], "returns": [366],
    //       "windows": [{ "iBeg": N, "iEnd": N, "priceBeg": F, "priceEnd": F }, ...],
    //       "windowMultipliers": [{ "iBeg": N, "iEnd": N, 
    //                               "windowMultiplier": F, "cumulativeMultiplier": F }, ...]
    //     },
    //     ...
    //   ],
    //   "average": { <same shape as years entry, no year field> }
    // }
    //
    // Returns empty string if stock is not in basket or has no data.
    virtual string getStockDetail(const string& symbol) = 0;

    // -----------------------------------------------------------------------
    // Query
    // -----------------------------------------------------------------------

    // Get the list of stock symbols currently in the basket (ordered by
    // insertion order), as a JSON array: ["SYM1", "SYM2", ...]
    virtual string getBasketStocks() const = 0;

    // Get current params for a stock in the basket, as JSON:
    // { "nYears": N, "nWinMin": N, "nWinMax": N, "fPctWin": F }
    // Returns empty string if stock is not in basket.
    virtual string getStockParams(const string& symbol) const = 0;
};
