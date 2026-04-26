#pragma once

#include "basket.h"

// ---------------------------------------------------------------------------
// tradecalendar — emits a CSV trade calendar:
//   Date,Stock1,Stock2,...
//   MM-DD,BUY,,
//   MM-DD,,SELL,BUY
//   ...
// Dates use MM-DD (year-agnostic, leap-year basis 2024). Same windows
// apply every year. Cells empty when no action for that stock on that day.
// Only days with at least one action become rows.
// ---------------------------------------------------------------------------

str exportTradeCalendarCsv(CREF(CBasket) basket);
