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

    // 2. Per-stock curves: outer loop stocks, inner loop years.
    for(CAUTOREF [sSymbol, plan] : m_dctPlanForStock) {
        auto& dctPlan = result.dctReturnsPerStockPlan[sSymbol];
        auto& dctHold = result.dctReturnsPerStockHold[sSymbol];

        TPrices arrAvgPlan(0.0, DAYS);
        TPrices arrAvgHold(0.0, DAYS);
        i32 nYearsWithData = 0;

        for(CAUTO iYear : result.arrYears) {
            CAUTO itYearData = plan.m_mapYearData.find(iYear);
            if(itYearData != plan.m_mapYearData.end() && itYearData->second.arrPrices[0]) {
                CAUTOREF arrPrices = itYearData->second.arrPrices;

                dctHold[iYear] = (arrPrices / arrPrices[0]) - 1.0;
                dctPlan[iYear] = calcPlanGains(plan.m_arrWindowStats, arrPrices);

                arrAvgHold += dctHold[iYear];
                arrAvgPlan += dctPlan[iYear];
                ++nYearsWithData;
            }
        }

        if(nYearsWithData > 0) {
            arrAvgHold /= nYearsWithData;
            arrAvgPlan /= nYearsWithData;
        }
        dctHold[0] = std::move(arrAvgHold);
        dctPlan[0] = std::move(arrAvgPlan);
    }


    // 3. Basket weighted-average across stocks.
    //    Uses plan curves only (B&H basket not meaningful for allocation).
    //    Key 0 = average across all years (same as per-stock key 0).
    CAUTO& dctPlan = result.dctReturnsPerStockPlan;
    const i32 nStocks = static_cast<i32>(m_arrStocks.size());

    if(nStocks > 0) {

        // --- compute base weights per alloc mode ---
        vf64 arrBaseWeights(nStocks, 1.0 / nStocks);  // default: equal

        switch(m_eAllocMode) {
        case EAllocMode::Equal:
            // already initialized to equal
            break;

        case EAllocMode::Return: {
            // Weight by each stock's avg plan return at end of year (key 0, last day).
            // Clamp negatives to 0 — losing stocks get no weight.
            f64 fTotalWeight = 0.0;
            FOR(i, 0, nStocks) {
                CAUTO it = dctPlan.find(m_arrStocks[i]);
                f64 fReturn = (it != dctPlan.end())
                    ? max(0.0, it->second.at(0)[DAYS - 1])
                    : 0.0;
                arrBaseWeights[i] = fReturn;
                fTotalWeight += fReturn;
            }
            // Normalize, fall back to equal if all returns <= 0
            if(fTotalWeight > 0.0)
                for(auto& w : arrBaseWeights) w /= fTotalWeight;
            else
                for(auto& w : arrBaseWeights) w = 1.0 / nStocks;
            break;
        }

        case EAllocMode::Custom:
            // Custom weights must match stock count — setAlloc() caller's contract.
            assert(static_cast<i32>(m_arrCustomWeights.size()) == nStocks
                   && "custom weights size must match stock count");
            arrBaseWeights = m_arrCustomWeights;
            break;
        }

        // --- per-year basket curve (plus key 0 for overall average) ---
        vint arrKeys = result.arrYears;
        arrKeys.push_back(0);  // key 0 = average curve

        for(CAUTO iKey : arrKeys) {
            // Collect participating stocks (have data for this year key)
            // and renormalize their weights to sum to 1.
            f64 fWeightSum = 0.0;
            FOR(i, 0, nStocks) {
                CAUTO it = dctPlan.find(m_arrStocks[i]);
                if(it != dctPlan.end() && it->second.contains(iKey))
                    fWeightSum += arrBaseWeights[i];
            }

            if(fWeightSum == 0.0) continue;  // no stock has data for this key

            TPrices arrBasket(0.0, DAYS);
            FOR(i, 0, nStocks) {
                CAUTO it = dctPlan.find(m_arrStocks[i]);
                if(it == dctPlan.end()) continue;
                CAUTO itCurve = it->second.find(iKey);
                if(itCurve == it->second.end()) continue;

                // Renormalized weight: this stock's share of participating weight
                CAUTO fW = arrBaseWeights[i] / fWeightSum;
                arrBasket += itCurve->second * fW;

                // Record effective weight for UI (bar chart stacks, alloc bar)
                result.dctWeightsPerStock[m_arrStocks[i]][iKey] = fW;
            }

            result.dctReturnsForBasket[iKey] = std::move(arrBasket);
        }
    }

    return result;
}
