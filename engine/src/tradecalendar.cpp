#include "tradecalendar.h"
#include <sstream>
#include <chrono>

// Convert engine day-index (0..365, leap-year basis) to "MM-DD" string.
// Uses 2024 (leap year) so day 59 maps to Feb-29 cleanly.
static str dayIdxToMonthDay(i32 iDay) {
    using namespace chrono;
    if(iDay < 0 || iDay >= DAYS) return "";
    const sys_days sdJan1{year{2024} / 1 / 1};
    const sys_days sd = sdJan1 + days{iDay};
    const year_month_day ymd{sd};
    return format("{:02d}-{:02d}",
                  static_cast<unsigned>(ymd.month()),
                  static_cast<unsigned>(ymd.day()));
}

// Spreadsheet column letter for 0-based index (A, B, C, ..., Z, AA, AB, ...)
static str colLetter(i32 iCol) {
    str s;
    ++iCol;  // 1-based for math
    while(iCol > 0) {
        i32 r = (iCol - 1) % 26;
        s.insert(s.begin(), char('A' + r));
        iCol = (iCol - 1) / 26;
    }
    return s;
}

str exportTradeCalendarCsv(CREF(CBasket) basket) {
    CAUTOREF arrStocks = basket.getStocks();
    const i32 nStocks = static_cast<i32>(arrStocks.size());

    // Pull effective weights for key 0 (overall average) from graph data.
    CAUTO graphData = basket.getGraphData(1);
    vf64 arrWeights(nStocks, 0.0);
    FOR(i, 0, nStocks) {
        CAUTO itStock = graphData.dctWeightsPerStock.find(arrStocks[i]);
        if(itStock != graphData.dctWeightsPerStock.end()) {
            CAUTO itKey = itStock->second.find(0);
            if(itKey != itStock->second.end()) arrWeights[i] = itKey->second;
        }
    }

    // Collect events: dayIdx -> (stockIdx -> "BUY"|"SELL")
    map<i32, map<i32, str>> dctEvents;
    FOR(i, 0, nStocks) {
        CAUTOREF arrStats = basket.getWindowStats(arrStocks[i]);
        for(CAUTOREF ws : arrStats) {
            dctEvents[ws.iBeg][i] = "BUY";
            dctEvents[ws.iEnd][i] = format("SELL {:+.1f}%", ws.pctExpected);
        }
    }

    ostringstream ofs;

    // Row 1: Total investment (B1 holds the editable value)
    ofs << "Total investment,1000000\n";
    // Row 2: blank
    ofs << "\n";

    // Row 3: stock symbols header (col A blank, stocks start at col B)
    ofs << "";
    FOR(i, 0, nStocks) ofs << "," << arrStocks[i];
    ofs << "\n";

    // Row 4: Weight % (literal, ROUND(w*100, 2))
    ofs << "Weight %";
    FOR(i, 0, nStocks) {
        ofs << format(",{:.2f}", arrWeights[i] * 100.0);
    }
    ofs << "\n";

    // Row 5: Allocation = ROUND($B$1 * weight%, 0). References B1 (total)
    // and the weight cell directly above so users can edit either.
    // Weight cells are on row 4: B4, C4, D4, ...
    ofs << "Allocation";
    FOR(i, 0, nStocks) {
        // stocks[0] is column B (idx 1). Weight cell = <colLetter(i+1)>4
        CAUTO sCol = colLetter(i + 1);
        ofs << format(",\"=ROUND($B$1*{}4/100,0)\"", sCol);
    }
    ofs << "\n";

    // Row 6: blank separator
    ofs << "\n";

    // Row 7: Date header
    ofs << "Date";
    FOR(i, 0, nStocks) ofs << "," << arrStocks[i];
    ofs << "\n";

    // Row 8+: events
    for(CAUTOREF [iDay, dctActs] : dctEvents) {
        ofs << dayIdxToMonthDay(iDay);
        FOR(i, 0, nStocks) {
            ofs << ",";
            CAUTO it = dctActs.find(i);
            if(it != dctActs.end()) ofs << it->second;
        }
        ofs << "\n";
    }

    return ofs.str();
}
