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
    m_setHidden.erase(sSymbol);
}

void CBasket::setVisible(cstr& sSymbol, bool bVisible) {
    if(!m_dctPlanForStock.contains(sSymbol)) return;
    if(bVisible) m_setHidden.erase(sSymbol);
    else         m_setHidden.insert(sSymbol);
    DEBUG_LOG("CBasket::setVisible: %s = %d", sSymbol.c_str(), (int)bVisible);
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

        // Days in market: sum of (iEnd - iBeg) across non-overlapping windows.
        // Normalized to fraction of trading year (DAYS-1 = 365).
        i32 nDaysIn = 0;
        for(CAUTOREF stat : plan.m_arrWindowStats) {
            nDaysIn += (stat.iEnd - stat.iBeg);
        }
        result.dctDaysInMarket[sSymbol] = static_cast<f64>(nDaysIn) / static_cast<f64>(DAYS - 1);

        TPrices arrAvgHold(0.0, DAYS);
        i32 nYearsWithData = 0;

        for(CAUTO iYear : result.arrYears) {
            CAUTO itYearData = plan.m_mapYearData.find(iYear);
            if(itYearData != plan.m_mapYearData.end() && itYearData->second.arrPrices[0]) {
                CAUTOREF arrPrices = itYearData->second.arrPrices;

                dctHold[iYear] = (arrPrices / arrPrices[0]) - 1.0;
                dctPlan[iYear] = calcPlanGains(plan.m_arrWindowStats, arrPrices);

                arrAvgHold += dctHold[iYear];
                ++nYearsWithData;
            }
        }

        if(nYearsWithData > 0) {
            arrAvgHold /= nYearsWithData;
        }
        dctHold[0] = std::move(arrAvgHold);
        dctPlan[0] = computeAvgPlanCurve(plan, result.arrYears);
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

        // Zero out hidden stocks — they contribute nothing to basket aggregation.
        // Per-key participation logic below renormalizes remaining weights.
        FOR(i, 0, nStocks) {
            if(m_setHidden.contains(m_arrStocks[i])) arrBaseWeights[i] = 0.0;
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

// ---------------------------------------------------------------------------
// optimizeStockParams — grid search over (nWinMin, pctThreshold)
// ---------------------------------------------------------------------------

TPlanParams CBasket::optimizeStockParams(cstr& sSymbol) {
    CAUTO it = m_dctPlanForStock.find(sSymbol);
    if(it == m_dctPlanForStock.end()) return {};

    auto& plan = it->second;
    const TPlanParams basePrm = plan.m_params;

    // Grid: nWinMin in [3, 90] step 1; pctThreshold in [50, 100] step 1.
    // ≈ 88 × 51 = 4488 combos. updatePlan is cheap (no I/O).
    // Score = calcQuality (same as allocation optimizer) — accounts for both
    // average return AND consistency (downside penalty + capital efficiency).
    f64 fBestScore = -1e30;
    TPlanParams bestPrm = basePrm;

    FOR(iWin, 3, 91) {
        if(iWin > basePrm.nWinMax) break;
        FOR(iPct, 50, 101) {
            TPlanParams trialPrm = basePrm;
            trialPrm.nWinMin      = iWin;
            trialPrm.pctThreshold = static_cast<f64>(iPct);

            plan.m_params = trialPrm;
            updatePlan(plan);

            // Days-in-market fraction for this trial's windows
            i32 nDaysIn = 0;
            for(CAUTOREF stat : plan.m_arrWindowStats) nDaysIn += (stat.iEnd - stat.iBeg);
            CAUTO fDaysFrac = static_cast<f64>(nDaysIn) / static_cast<f64>(DAYS - 1);

            // Per-year plan + B&H last-day returns
            vf64 arrPlan, arrBh;
            for(CAUTO iYear : plan.m_arrYears) {
                CAUTO itY = plan.m_mapYearData.find(iYear);
                if(itY == plan.m_mapYearData.end()) continue;
                CAUTOREF arrPrices = itY->second.arrPrices;
                if(arrPrices[0] == 0.0) continue;
                CAUTO arrPlanCurve = calcPlanGains(plan.m_arrWindowStats, arrPrices);
                arrPlan.push_back(arrPlanCurve[DAYS - 1]);
                arrBh  .push_back((arrPrices[DAYS - 1] / arrPrices[0]) - 1.0);
            }

            CAUTO fScore = calcQuality(arrPlan, arrBh, fDaysFrac);
            if(fScore > fBestScore) {
                fBestScore = fScore;
                bestPrm    = trialPrm;
            }
        }
    }

    // Apply best
    plan.m_params = bestPrm;
    updatePlan(plan);
    DEBUG_LOG("optimizeStockParams: %s best nWinMin=%d pct=%.1f quality=%.4f",
              sSymbol.c_str(), bestPrm.nWinMin, bestPrm.pctThreshold, fBestScore);
    return bestPrm;
}

// ---------------------------------------------------------------------------
// optimizeAllocation — weights ∝ per-stock Quality
// ---------------------------------------------------------------------------
//
// For each stock, compute its Quality from the per-year plan returns,
// per-year B&H returns, and days-in-market fraction (same calcQuality
// used by the UI). Weight each stock by max(0, quality), normalize.
// All-zero / all-negative → equal weights.
// Year set = each stock's own m_arrYears (matches displayed Quality).

vf64 CBasket::optimizeAllocation() {
    const i32 nStocks = static_cast<i32>(m_arrStocks.size());
    if(nStocks == 0) return {};
    if(nStocks == 1) {
        m_eAllocMode      = EAllocMode::Custom;
        m_arrCustomWeights = {1.0};
        return m_arrCustomWeights;
    }

    vf64 arrQuality(nStocks, 0.0);
    FOR(i, 0, nStocks) {
        // Hidden stocks get 0 weight — excluded from optimization.
        if(m_setHidden.contains(m_arrStocks[i])) continue;

        CAUTO it = m_dctPlanForStock.find(m_arrStocks[i]);
        if(it == m_dctPlanForStock.end()) continue;
        CAUTOREF plan = it->second;

        // Days-in-market fraction
        i32 nDaysIn = 0;
        for(CAUTOREF stat : plan.m_arrWindowStats) nDaysIn += (stat.iEnd - stat.iBeg);
        CAUTO fDaysFrac = static_cast<f64>(nDaysIn) / static_cast<f64>(DAYS - 1);

        // Per-year plan & B&H last-day returns across stock's own years
        vf64 arrPlan, arrBh;
        for(CAUTO iYear : plan.m_arrYears) {
            CAUTO itY = plan.m_mapYearData.find(iYear);
            if(itY == plan.m_mapYearData.end()) continue;
            CAUTOREF arrPrices = itY->second.arrPrices;
            if(arrPrices[0] == 0.0) continue;
            CAUTO arrPlanCurve = calcPlanGains(plan.m_arrWindowStats, arrPrices);
            arrPlan.push_back(arrPlanCurve[DAYS - 1]);
            arrBh  .push_back((arrPrices[DAYS - 1] / arrPrices[0]) - 1.0);
        }

        arrQuality[i] = calcQuality(arrPlan, arrBh, fDaysFrac);
        DEBUG_LOG("optimizeAllocation: %s quality=%.4f daysFrac=%.3f nYrs=%d",
                  m_arrStocks[i].c_str(), arrQuality[i], fDaysFrac,
                  static_cast<i32>(arrPlan.size()));
    }

    // Weights ∝ max(0, quality)
    vf64 arrW(nStocks, 0.0);
    f64 fSum = 0.0;
    FOR(i, 0, nStocks) {
        arrW[i] = std::max(0.0, arrQuality[i]);
        fSum   += arrW[i];
    }

    if(fSum > 0.0) {
        FOR(i, 0, nStocks) arrW[i] /= fSum;
    } else {
        // All non-positive → equal weights across visible stocks
        i32 nVisible = 0;
        FOR(i, 0, nStocks) if(!m_setHidden.contains(m_arrStocks[i])) ++nVisible;
        if(nVisible == 0) nVisible = nStocks;  // shouldn't happen, safety
        FOR(i, 0, nStocks) {
            arrW[i] = m_setHidden.contains(m_arrStocks[i]) ? 0.0 : (1.0 / nVisible);
        }
    }

    m_eAllocMode       = EAllocMode::Custom;
    m_arrCustomWeights = arrW;

    DEBUG_LOG("optimizeAllocation: nStocks=%d sumQuality=%.4f", nStocks, fSum);
    return arrW;
}
