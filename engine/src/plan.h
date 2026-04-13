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
