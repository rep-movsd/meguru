#pragma once

#include "engine.h"

// Per-stock cached state
struct TPlan {
    TPlanParams    m_params;
    TYearDataMap   m_mapYearData;       // all available years, cached
    vint           m_arrYears;          // year numbers used, most-recent-first
    TPrices        m_arrAvgCurve = TPrices(0.0, DAYS);
    TWindows       m_arrWindows;
    TWindowStats   m_arrWindowStats;    // stats per surviving window
};

// ---------------------------------------------------------------------------
// CBasket — concrete implementation of IBasket.
// ---------------------------------------------------------------------------

class CBasket : public IBasket {

    // Map of stock name to plan
    map<str, TPlan> m_dctPlanForStock;

    // List of stock names in insertion order
    vstr m_arrStocks;

public:
    void addStock(cstr& sSymbol, CREF(TPlanParams) params) override;
    void removeStock(cstr& sSymbol) override;
    void setParams(cstr& sSymbol, CREF(TPlanParams) params) override;

    // Load a single year's CSV data (Date,Close) from a string.
    void loadCsv(cstr& sSymbol, i32 nYear, cstr& sCsv);

    // Trigger computation after all CSVs have been loaded for a stock.
    void compute(cstr& sSymbol, CREF(TPlanParams) params);

    [[nodiscard]] CREF(TWindows) getWindows(cstr& sSymbol) const override;
    [[nodiscard]] CREF(TWindowStats) getWindowStats(cstr& sSymbol) const override;
    [[nodiscard]] CREF(vint) getYears(cstr& sSymbol) const override;

    // Graph data: normalized B&H curves for nYear most-recent years.
    // nYear = how many past years to show (independent of per-stock stats nYears).
    // Stocks missing data for a year are skipped in basket avg for that year.
    [[nodiscard]] TGraphData getGraphData(i32 nYears) const;
};
