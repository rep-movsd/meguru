#pragma once

#include "utils.h"

// ---------------------------------------------------------------------------
// TPlan — per-stock cached state after computation.
// ---------------------------------------------------------------------------

struct TPlan {
    TPlanParams    m_params;
    TYearDataMap   m_mapYearData;       // all available years, cached
    vint           m_arrYears;          // year numbers used, most-recent-first
    TPrices        m_arrAvgCurve = TPrices(0.0, DAYS);
    TWindows       m_arrWindows;
    TWindowStats   m_arrWindowStats;    // stats per surviving window
};

// ---------------------------------------------------------------------------
// Plan computation functions
// ---------------------------------------------------------------------------

// Compute averaged normalized price curve from the most recent nYears.
TPrices computeAvgCurve(CREF(TYearDataMap) mapYearData, i32 nYears);

// Given a range and an avg curve, find the window with maximum daily gain.
TWindow findBestRange(CREF(TPrices) arrAvgCurve, i32 iBeg, i32 iEnd, CREF(TPlanParams) params);

// Recursively find best non-overlapping trade windows.
void findBestRanges(CREF(TPrices) arrAvgCurve, i32 iBeg, i32 iEnd, CREF(TPlanParams) params, TWindows& arrWindows);

// Discover all non-overlapping trade windows from the avg curve.
TWindows findWindows(CREF(TPrices) arrAvgCurve, CREF(TPlanParams) params);

// Get most recent nYears year numbers (descending) that have valid data.
vint getMostRecentYears(CREF(TYearDataMap) dctYearData, i32 nYears);

// Compute per-window statistics across years, filtered by threshold.
TWindowStats computeWindowStats(CREF(TWindows) arrWindows, CREF(TYearDataMap) mapYearData,
                                CREF(vint) arrYears, CREF(TPlanParams) params);

// Calculate plan holdings curve for a single year's prices using window stats.
// Applies fees per window and tax on final profit.
TPrices calcPlanGains(CREF(TWindowStats) arrWindowStats, CREF(TPrices) arrStockPrices);

// Full recompute of a plan: years → avg curve → windows → stats.
void updatePlan(TPlan& plan);

// Average plan-gains curve across the given years. Years missing data
// (or with zero first-day price) are skipped. Returns DAYS-length valarray
// of the per-year mean cumulative gain. Used by getGraphData (key 0) and
// the auto-optimizer.
TPrices computeAvgPlanCurve(CREF(TPlan) plan, CREF(vint) arrYears);

// Quality score: capital efficiency × downside-risk penalty.
// Port of metrics.js calcQuality. Pass an empty arrBhReturns + fDaysFrac<=0
// to skip the efficiency term and return a downside-penalized scaled mean.
f64 calcQuality(CREF(vf64) arrPlanReturns,
                CREF(vf64) arrBhReturns,
                f64 fDaysFrac);
