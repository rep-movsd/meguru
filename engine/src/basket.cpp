#include "basket.h"

// ---------------------------------------------------------------------------
// CBasket
// ---------------------------------------------------------------------------

void CBasket::addStock(cstr& sSymbol, CREF(TPlanParams) params) {
    DEBUG_LOG("CBasket::addStock: %s", sSymbol.c_str());

    if(m_dctPlanForStock.contains(sSymbol)) {
        setParams(sSymbol, params);
        return;
    }

    TPlan plan;
    plan.m_params      = params;
    plan.m_mapYearData = m_stockData.load(sSymbol);
    updatePlan(plan);

    DEBUG_LOG("CBasket::addStock: %s — %d years, %d windows, %d stats",
              sSymbol.c_str(), (i32)plan.m_arrYears.size(),
              (i32)plan.m_arrWindows.size(), (i32)plan.m_arrWindowStats.size());

    m_dctPlanForStock[sSymbol] = std::move(plan);
    m_arrStocks.push_back(sSymbol);
}

void CBasket::removeStock(cstr& sSymbol) {
    m_dctPlanForStock.erase(sSymbol);
    std::erase(m_arrStocks, sSymbol);
}

void CBasket::setParams(cstr& sSymbol, CREF(TPlanParams) params) {
    CAUTO it = m_dctPlanForStock.find(sSymbol);
    if(it == m_dctPlanForStock.end()) return;

    auto& plan = it->second;
    plan.m_params = params;
    updatePlan(plan);
}

CREF(TWindows) CBasket::getWindows(cstr& sSymbol) const {
    static const TWindows empty;
    CAUTO it = m_dctPlanForStock.find(sSymbol);
    if(it == m_dctPlanForStock.end()) return empty;
    return it->second.m_arrWindows;
}

CREF(TWindowStats) CBasket::getWindowStats(cstr& sSymbol) const {
    static TWindowStats empty;
    CAUTO it = m_dctPlanForStock.find(sSymbol);
    if(it == m_dctPlanForStock.end()) return empty;
    return it->second.m_arrWindowStats;
}

CREF(vint) CBasket::getYears(cstr& sSymbol) const {
    static vint empty;
    CAUTO it = m_dctPlanForStock.find(sSymbol);
    if(it == m_dctPlanForStock.end()) return empty;
    return it->second.m_arrYears;
}

// ---------------------------------------------------------------------------
// Allocation
// ---------------------------------------------------------------------------

void CBasket::setAlloc(EAllocMode eMode, CREF(vf64) arrCustomWeights) {
    m_eAllocMode = eMode;
    if(eMode == EAllocMode::Custom && !arrCustomWeights.empty()) {
        m_arrCustomWeights = arrCustomWeights;
    }
}

// ---------------------------------------------------------------------------
// getGraphData — normalized B&H curves for charting
// ---------------------------------------------------------------------------

TGraphData CBasket::getGraphData(i32 nYears) const {
    TGraphData result;

    // 1. Gather years: iterate from (current-1) downward, take nYears
    const i32 iLastYear = getCurYear() - 1;
    for(i32 iYear = iLastYear; iYear > iLastYear - nYears; --iYear) {
        result.arrYears.push_back(iYear);
    }

    // 2. Outer loop: stocks. Inner loop: years.
    for(CAUTOREF [sSymbol, plan] : m_dctPlanForStock) {
        result.arrStocks.push_back(sSymbol);

        // placeholder for this stock's plan curves for each year
        result.arrReturnsPerStockPlan.push_back({});
        result.arrReturnsPerStockHold.push_back({});

        // Average returns
        TPrices arrPricesAvgPlan(0.0, DAYS);
        TPrices arrPricesAvgHold(0.0, DAYS);
        i32 nYearsWithData = 0;

        for(CAUTO iYear : result.arrYears) {
            CAUTO itYearData = plan.m_mapYearData.find(iYear);
            if(itYearData != plan.m_mapYearData.end() && itYearData->second.arrPrices[0]) {
                CAUTOREF arrPrices = itYearData->second.arrPrices;
                auto &returnHold = result.arrReturnsPerStockHold.back()[iYear];
                auto &returnPlan = result.arrReturnsPerStockPlan.back()[iYear];

                // For B&H, normalize prices so start is 0 and +1 means 100%
                returnHold = (arrPrices / arrPrices[0]) - 1.0;
                returnPlan = calcPlanGains(plan.m_arrWindowStats, arrPrices);

                // Accumulate into average before moving
                arrPricesAvgHold += returnHold;
                arrPricesAvgPlan += returnPlan;
                ++nYearsWithData;
            }
        }

        if(nYearsWithData > 0) {
            arrPricesAvgHold /= nYearsWithData;
            arrPricesAvgPlan /= nYearsWithData;
        }
        result.arrReturnsPerStockHold.back()[0] = std::move(arrPricesAvgHold);
        result.arrReturnsPerStockPlan.back()[0] = std::move(arrPricesAvgPlan);
    }

    // TODO: compute basketAvg per year + "average"

    // For each year
    for(CAUTO iYear : result.arrYears) {
        // For each stock
        i32 nStocks = m_arrStocks.size();
        FOR(n, 0, nStocks) {
            cstr sYearKey = to_string(iYear);
            CAUTOREF retHold = result.arrReturnsPerStockHold[n];
            CAUTOREF retPlan = result.arrReturnsPerStockPlan[n];



        }
    }

    return result;
}
