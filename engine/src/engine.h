#pragma once

#include "types.h"

// ---------------------------------------------------------------------------
// IBasket — manages a set of trade plans keyed by stock name.
//
// Adding a stock reads and caches its price data from OPFS, then computes
// trade windows. Editing params recomputes windows. Deleting purges the cache.
// ---------------------------------------------------------------------------

class IBasket {
public:
    virtual ~IBasket() = default;

    // Add a stock with the given params.
    // Reads all available price data from OPFS and caches it.
    // Computes trade windows immediately.
    // If already present, equivalent to setParams().
    virtual void addStock(cstr& sSymbol, CREF(TPlanParams) params) = 0;

    // Remove a stock and purge its cached price data.
    virtual void removeStock(cstr& sSymbol) = 0;

    // Update params for an existing stock. Recomputes trade windows.
    virtual void setParams(cstr& sSymbol, CREF(TPlanParams) params) = 0;

    // --- Queries ---

    // Get the computed trade windows for a stock.
    [[nodiscard]] virtual CREF(TWindows) getWindows(cstr& sSymbol) const = 0;

    // Get per-window statistics (filtered by threshold).
    [[nodiscard]] virtual CREF(TWindowStats) getWindowStats(cstr& sSymbol) const = 0;

    // Get the year numbers used for computation, most-recent-first.
    [[nodiscard]] virtual CREF(vint) getYears(cstr& sSymbol) const = 0;
};
