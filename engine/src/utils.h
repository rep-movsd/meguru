#pragma once

#include "types.h"

// ---------------------------------------------------------------------------
// Trading constants
// ---------------------------------------------------------------------------

extern const f64 RATE_FEE;   // applied on value on both buy and sell
extern const f64 RATE_TAX;   // STCG tax on profit

// Starting capital per stock for verification CSV (hardcoded; large enough that
// integer-share rounding error is <0.01% per window on typical stocks).
constexpr f64 INIT_CAPITAL = 100000000.0;

// ---------------------------------------------------------------------------
// Date / calendar utilities
// ---------------------------------------------------------------------------

// Current calendar year.
i32 getCurYear();

// Day-of-year index (0..365) for a YYYY-MM-DD string_view.
// Always treats the year as 366 days: non-leap years shift days after Feb 28 up by 1.
i32 getDayIndexForYMD(sv sDate);

// Reverse of getDayIndexForYMD: convert (year, day-of-year index) to "YYYY-MM-DD".
// For non-leap years the Feb-29 slot (index 59) returns "YYYY-02-29" as a synthetic
// placeholder (same as what the gap-fill would produce); indices >59 shift down by 1.
str dayIdxToDate(i32 iYear, i32 iDay);

// ---------------------------------------------------------------------------
// Price data utilities
// ---------------------------------------------------------------------------

// Backward-fill gaps (weekends/holidays) in a year's price and day-index arrays.
void fillGaps(TYearData& data);

// Parse a single year CSV string (Date,Close format) into backfilled year data.
TYearData parseOneCsv(cstr& sCsv);

// Gain fraction for a window: (price[end] / price[beg]) - 1.0
f64 getGain(CREF(TPrices) arrPrices, CREF(TWindow) window);
