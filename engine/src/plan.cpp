#include "plan.h"

// ---------------------------------------------------------------------------
// Plan computation
// ---------------------------------------------------------------------------

TPrices computeAvgCurve(CREF(TYearDataMap) mapYearData, const i32 nYears) {
    TPrices priceSum(0.0, DAYS);

    i32 nCount = 0;
    for(auto it = mapYearData.rbegin(); it != mapYearData.rend() && nCount < nYears; ++it) {
        CAUTOREF arrPrices = it->second.arrPrices;
        if(arrPrices[0] == 0.0) continue;
        priceSum += (arrPrices / arrPrices[0]);
        ++nCount;
    }

    if(nCount == 0) return TPrices(0.0, DAYS);
    return priceSum / nCount;
}

TWindow findBestRange(CREF(TPrices) arrAvgCurve, const i32 iBeg, const i32 iEnd, CREF(TPlanParams) params) {
    TWindow ret{-1, -1, 0.0};
    if(const i32 nSize = iEnd - iBeg; nSize >= params.nWinMin) {
        f64 fDailyGainMax = 0.0;

        FORLE(nWin, params.nWinMin, params.nWinMax) {
            const i32 nSlides = nSize - nWin;
            FORLE(i, 0, nSlides) {
                TWindow window{iBeg + i, iBeg + i + nWin};
                CAUTO fDailyGain = getGain(arrAvgCurve, window) / nWin;

                if(fDailyGain > fDailyGainMax) {
                    fDailyGainMax = fDailyGain;
                    ret = window;
                    ret.fGain = fDailyGainMax;
                }
            }
        }
    }
    return ret;
}

void findBestRanges(CREF(TPrices) arrAvgCurve, const i32 iBeg, const i32 iEnd, CREF(TPlanParams) params, TWindows& arrWindows) {
    const TWindow r = findBestRange(arrAvgCurve, iBeg, iEnd, params);
    if(r.iBeg != -1) {
        arrWindows.push_back(r);
        findBestRanges(arrAvgCurve, iBeg, r.iBeg, params, arrWindows);
        findBestRanges(arrAvgCurve, r.iEnd, iEnd, params, arrWindows);
    }
}

TWindows findWindows(CREF(TPrices) arrAvgCurve, CREF(TPlanParams) params) {
    TWindows arrWindows;
    if(arrAvgCurve[0] == 0.0) return arrWindows;
    findBestRanges(arrAvgCurve, 0, DAYS - 1, params, arrWindows);
    return arrWindows;
}

// ---------------------------------------------------------------------------
// Per-window statistics
// ---------------------------------------------------------------------------

vint getMostRecentYears(CREF(TYearDataMap) dctYearData, const i32 nYears) {
    vint arrYears;
    i32 nCount = 0;
    for(auto it = dctYearData.rbegin(); it != dctYearData.rend() && nCount < nYears; ++it) {
        if(it->second.arrPrices[0] == 0.0) continue;
        arrYears.push_back(it->first);
        ++nCount;
    }
    return arrYears;
}

TWindowStats computeWindowStats(CREF(TWindows) arrWindows, CREF(TYearDataMap) mapYearData,
                                 CREF(vint) arrYears, CREF(TPlanParams) params) {
    TWindowStats arrStats;

    for(CAUTOREF window : arrWindows) {
        TWindowStat stat;
        stat.iBeg = window.iBeg;
        stat.iEnd = window.iEnd;

        f64 fSum = 0.0;
        i32 nWins = 0;
        f64 fWinSum = 0.0, fLossSum = 0.01;

        for(CAUTO nYear : arrYears) {
            CAUTO it = mapYearData.find(nYear);
            if(it == mapYearData.end()) continue;

            CAUTO fGain = getGain(it->second.arrPrices, window) * 100.0;
            stat.arrYearGains.push_back(fGain);
            fSum += fGain;

            if(fGain > 0.0) {
                ++nWins;
                fWinSum += fGain;
            } else {
                fLossSum += fGain;
            }
        }

        if(CAUTO nCount = static_cast<i32>(stat.arrYearGains.size())) {
            stat.pctWin       = static_cast<f64>(nWins) / nCount * 100.0;
            stat.pctExpected  = fSum / nCount;
            stat.fProfitRatio = fWinSum / -fLossSum;
            if(stat.pctWin >= params.pctThreshold) {
                arrStats.push_back(std::move(stat));
            }
        }
    }

    ranges::sort(arrStats, [](CREF(TWindowStat) a, CREF(TWindowStat) b) { return a.iBeg < b.iBeg; });
    return arrStats;
}


// ---------------------------------------------------------------------------
// Calc gains for a given stocks plan for a single year, applying fees and tax.
// ---------------------------------------------------------------------------
TPrices calcPlanGains(CREF(TWindowStats) arrWindowStats, CREF(TPrices) arrStockPrices) {

    TPrices arrPlanHoldings(0.0, DAYS);
    i32 iLastEnd = 0;
    double fGain = 1.0;
    for(CAUTOREF stat : arrWindowStats) {
        // Outside window: flat at current gain
        for(i32 i = iLastEnd; i < stat.iBeg; ++i) arrPlanHoldings[i] = fGain - 1.0;

        // Window return using raw prices (not normalized) for correct ratio
        const auto fRatio = arrStockPrices[stat.iEnd] / arrStockPrices[stat.iBeg];
        const auto fRatioAfterFees = fRatio * (1 - RATE_FEE) / (1 + RATE_FEE);
        const auto fGainExit = fGain * fRatioAfterFees;

        // Ramp linearly inside window
        const i32 nDays = stat.iEnd - stat.iBeg;
        for(i32 i = stat.iBeg; i <= stat.iEnd; ++i) {
            const double t = static_cast<double>(i - stat.iBeg) / nDays;
            arrPlanHoldings[i] = fGain + t * (fGainExit - fGain) - 1.0;
        }

        fGain = fGainExit;
        iLastEnd = stat.iEnd + 1;
    }

    // Flat after last window
    for(i32 i = iLastEnd; i < DAYS; ++i) arrPlanHoldings[i] = fGain - 1.0;

    // Tax only on profit (fGain > 1.0)
    if(fGain > 1.0) arrPlanHoldings[DAYS - 1] = (fGain - 1.0) * (1 - RATE_TAX);

    return arrPlanHoldings;
}

// ---------------------------------------------------------------------------
// Recomputes plan for a stock given plan params
// ---------------------------------------------------------------------------
void updatePlan(TPlan& plan) {
    plan.m_arrYears       = getMostRecentYears(plan.m_mapYearData, plan.m_params.nYears);
    plan.m_arrAvgCurve    = computeAvgCurve(plan.m_mapYearData, plan.m_params.nYears);
    plan.m_arrWindows     = findWindows(plan.m_arrAvgCurve, plan.m_params);
    plan.m_arrWindowStats = computeWindowStats(plan.m_arrWindows, plan.m_mapYearData,
                                                plan.m_arrYears, plan.m_params);
}
