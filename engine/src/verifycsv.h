#pragma once

#include "basket.h"

// ---------------------------------------------------------------------------
// verifycsv — emits a Google-Sheets-ready CSV that reproduces the engine's
// calcPlanGains math in formulas, so results can be hand-verified.
//
// Layout:
//   Summary (5 rows):
//     YEAR, <year>
//     STOCKS, S1, S2, ..., TOTAL, TOTAL_AFTER_TAX
//     WEIGHTS, w1, w2, ...
//     ENGINE_RETURN_PCT, r1%, r2%, ..., =SUMPRODUCT(weights, returns)
//     ENGINE_RETURN_AFTER_TAX_PCT, , , ..., =IF(TOTAL>0, TOTAL*0.8, TOTAL)
//   <blank row>
//   Header: Stock, Date, Action, Price, Held, Traded, Cost, Fees, Cash, Profit
//   Per-stock sections: START row + BUY/SELL pairs + Profit on last row
// ---------------------------------------------------------------------------

// Data grid column layout (shared between header row + data rows).
enum ECSVCol {
    Stock, Date, Action, Price, Held, Traded, Cost, Fees, Cash, Profit,
    CSVLastCol
};

constexpr array<const char*, CSVLastCol> g_arrColNames = {
    "Stock", "Date", "Action", "Price", "Held", "Traded", "Cost",
    "Fees", "Cash", "Profit"
};

using TCSVRow = array<str, CSVLastCol>;

// Per-stock snapshot used while writing.
struct TVerifyStockData {
    str      sSymbol;
    TPrices  arrPrices;    // year's prices (366 slots, backfilled)
    TWindows arrWindows;   // windows to trade (derived from stats)
    i32      nRows = 0;    // 1 (START) + 2 * windows
    i32      iStartRow = 0; // absolute 0-based sheet row of START
    i32      iLastRow  = 0; // absolute 0-based sheet row of final SELL
};

// Writer class — loads basket data, then emits CSV on demand.
class CVerifyCsvWriter {
    using TGrid = vector<TCSVRow>;

    // Basket-level state (set by load)
    i32                      m_iYear          = 0;
    f64                      m_fStartCapital  = 0.0;
    vector<TVerifyStockData> m_arrStockData;
    vf64                     m_arrWeights;            // effective weights per stock
    f64                      m_fEngineBasketReturn = 0.0; // basket return fraction (post per-stock tax)
    i32                      m_iTotalDataRows = 0;

    // Per-stock section state (set by writeStockSection)
    i32 m_iRowOffset = 0;
    str m_sCellYear;
    str m_sCellStock;

    // Per-row state
    i32          m_iRow      = 0;
    const TPrices* m_pPrices = nullptr;
    TGrid        m_grid;

    void writeSummary(ostream& ofs) const;
    void writeHeader(ostream& ofs) const;
    void writeStockSection(CREF(TVerifyStockData) sd, ostream& ofs);
    void setTradeRow(CREF(TWindow) window, bool bIsBuy);
    str  CALC(i32 iColA, char op, i32 iColB, i32 iOffsetA = 0) const;

public:
    CVerifyCsvWriter() = default;

    // Load from basket for a given year. If iYear == 0, uses (current year - 1).
    void load(CREF(CBasket) basket, i32 iYear);

    // Emit CSV to stream.
    void write(ostream& ofs);
};

// Convenience: one-shot export as string (for embind / UI).
str exportVerifyCsv(CREF(CBasket) basket, i32 iYear);
