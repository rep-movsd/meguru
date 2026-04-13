#pragma once

#include "types.h"

// ---------------------------------------------------------------------------
// Trading constants
// ---------------------------------------------------------------------------

extern const f64 RATE_FEE;   // applied on value on both buy and sell
extern const f64 RATE_TAX;   // STCG tax on profit

// ---------------------------------------------------------------------------
// Date / calendar utilities
// ---------------------------------------------------------------------------

// Current calendar year.
i32 getCurYear();

// Day-of-year index (0..365) for a YYYY-MM-DD string_view.
// Always treats the year as 366 days: non-leap years shift days after Feb 28 up by 1.
i32 getDayIndexForYMD(sv sDate);

// ---------------------------------------------------------------------------
// Price data utilities
// ---------------------------------------------------------------------------

// Backward-fill gaps (weekends/holidays) in a year's price and day-index arrays.
void fillGaps(TYearData& data);

// Parse a single year CSV string (Date,Close format) into backfilled year data.
TYearData parseOneCsv(cstr& sCsv);

// Gain fraction for a window: (price[end] / price[beg]) - 1.0
f64 getGain(CREF(TPrices) arrPrices, CREF(TWindow) window);
