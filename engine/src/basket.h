#pragma once

#include "engine.h"
#include "plan.h"
#include "stockdata.h"

// ---------------------------------------------------------------------------
// CBasket — concrete implementation of IBasket.
// ---------------------------------------------------------------------------

class CBasket : public IBasket {

    // In-memory CSV store (WASM: filled by JS via store(), native: unused)
    TStockData m_stockData;

    // Map of stock name to plan
    map<str, TPlan> m_dctPlanForStock;

    // List of stock names in insertion order
    vstr m_arrStocks;

    // Allocation
    EAllocMode m_eAllocMode = EAllocMode::Equal;
    vf64       m_arrCustomWeights;   // user-supplied weights for Custom mode, parallel to m_arrStocks

    // Visibility: hidden stocks remain in m_dctPlanForStock / m_arrStocks
    // (so per-stock stats and selection still work), but are excluded from
    // basket aggregation (getGraphData), allocation optimization, and
    // exports. Toggled via setVisible().
    std::set<str> m_setHidden;

public:
    void addStock(cstr& sSymbol, CREF(TPlanParams) params) override;
    void removeStock(cstr& sSymbol) override;
    void setParams(cstr& sSymbol, CREF(TPlanParams) params) override;

    // Toggle a stock's contribution to basket aggregation.
    // Hidden stocks are still computed individually but excluded from the
    // basket plan curve, allocation weights, and optimization. No-op if
    // the symbol isn't in the basket.
    void setVisible(cstr& sSymbol, bool bVisible);
    [[nodiscard]] bool isVisible(cstr& sSymbol) const {
        return !m_setHidden.contains(sSymbol);
    }

    // Store a raw CSV string into the in-memory store.
    // Called from JS/embind before addStock().
    // sPath key format: "SYMBOL.NS_YYYY.csv"
    void storeCsv(cstr& sPath, cstr& sCsv) { m_stockData.store(sPath, sCsv); }

    // Set allocation mode and optional custom weights (stored, computed lazily in getGraphData).
    void setAlloc(EAllocMode eMode, CREF(vf64) arrCustomWeights = {});

    [[nodiscard]] CREF(TWindows) getWindows(cstr& sSymbol) const override;
    [[nodiscard]] CREF(TWindowStats) getWindowStats(cstr& sSymbol) const override;
    [[nodiscard]] CREF(vint) getYears(cstr& sSymbol) const override;

    // Auto-optimize: brute-force grid search over (nWinMin, pctThreshold)
    // to maximize average plan return on the last day of the averaged plan
    // curve. Updates the stock's params in-place and returns the chosen params.
    // nYears is preserved from the stock's current params.
    // nWinMax is preserved (currently fixed at 180 by JS layer).
    TPlanParams optimizeStockParams(cstr& sSymbol);

    // Auto-optimize basket allocation: brute-force grid search over weight
    // vectors summing to 100. Step is 5% for ≤5 stocks, 10% for >5.
    // Maximizes basket plan return at last day. Switches engine to Custom
    // mode with the chosen weights and returns them.
    vf64 optimizeAllocation();

    // Accessors used by verifycsv
    [[nodiscard]] CREF(vstr) getStocks() const { return m_arrStocks; }
    [[nodiscard]] CREF(TPlan) getPlan(cstr& sSymbol) const {
        static const TPlan empty;
        CAUTO it = m_dctPlanForStock.find(sSymbol);
        return it == m_dctPlanForStock.end() ? empty : it->second;
    }

    // Graph data: normalized B&H curves for nYear most-recent years.
    // nYear = how many past years to show (independent of per-stock stats nYears).
    // Stocks missing data for a year are skipped in basket avg for that year.
    [[nodiscard]] TGraphData getGraphData(i32 nYears) const;
};
