#include "verifycsv.h"

// ---------------------------------------------------------------------------
// Row layout for the top summary/header section.
// ---------------------------------------------------------------------------
enum ERow {
    YearRow,       // 0: YEAR, <year>
    StocksRow,     // 1: STOCKS, S1, S2, ..., TOTAL, ENGINE_TOTAL
    WeightsRow,    // 2: WEIGHTS, w1, w2, ...
    ReturnPctRow,  // 3: RETURN_PCT, P_i formulas..., TOTAL formula, ENGINE_TOTAL literal
    BlankRow1,     // 4: blank
    HeaderRow,     // 5: column names
    Start,         // 6: first data row
    RowEnd
};

// ---------------------------------------------------------------------------
// Cell-reference helpers (A1 style).
// REF(col, row) → "A1";  REF$(col, row) → "$A$1"    (0-indexed in, 1-indexed out)
// ---------------------------------------------------------------------------
static str REF (i32 x, i32 y) { return format("{}{}",   static_cast<char>('A' + x), y + 1); }
static str REF$(i32 x, i32 y) { return format("${}${}", static_cast<char>('A' + x), y + 1); }

str CVerifyCsvWriter::CALC(i32 iColA, char op, i32 iColB, i32 iOffsetA) const {
    return format("({} {} {})", REF(iColA, m_iRow + iOffsetA), op, REF(iColB, m_iRow));
}

// ---------------------------------------------------------------------------
// CSV escaping + row write
// ---------------------------------------------------------------------------
static str csvEscape(CREF(str) s) {
    // Quote if contains comma, quote, or newline. Double internal quotes.
    if(s.find_first_of(",\"\n") == str::npos) return s;
    str out = "\"";
    for(CAUTO c : s) {
        if(c == '"') out += "\"\"";
        else         out += c;
    }
    out += "\"";
    return out;
}

static void writeRow(CREF(TCSVRow) row, ostream& ofs) {
    bool bFirst = true;
    for(CAUTOREF cell : row) {
        if(!bFirst) ofs << ',';
        ofs << csvEscape(cell);
        bFirst = false;
    }
    ofs << '\n';
}

static void writeVec(CREF(vstr) row, ostream& ofs) {
    bool bFirst = true;
    for(CAUTOREF cell : row) {
        if(!bFirst) ofs << ',';
        ofs << csvEscape(cell);
        bFirst = false;
    }
    ofs << '\n';
}

// ---------------------------------------------------------------------------
// load — snapshot basket state for the chosen year
// ---------------------------------------------------------------------------
void CVerifyCsvWriter::load(CREF(CBasket) basket, i32 iYear) {
    m_fStartCapital = INIT_CAPITAL;
    m_iYear         = (iYear > 0) ? iYear : (getCurYear() - 1);
    m_arrStockData.clear();
    m_arrWeights.clear();
    m_fEngineBasketReturn = 0.0;
    m_iTotalDataRows = 0;

    CAUTO data = basket.getGraphData(1);

    CAUTOREF arrStocks = basket.getStocks();
    i32 iRowCursor = Start;
    for(CAUTOREF sSymbol : arrStocks) {
        CAUTOREF plan = basket.getPlan(sSymbol);
        CAUTO itYear = plan.m_mapYearData.find(m_iYear);
        if(itYear == plan.m_mapYearData.end()) continue;
        if(itYear->second.arrPrices[0] == 0.0) continue;

        TVerifyStockData sd;
        sd.sSymbol   = sSymbol;
        sd.arrPrices = itYear->second.arrPrices;

        sd.arrWindows.reserve(plan.m_arrWindowStats.size());
        for(CAUTOREF ws : plan.m_arrWindowStats) {
            sd.arrWindows.push_back({ws.iBeg, ws.iEnd, 0.0});
        }

        sd.nRows     = 1 + 2 * static_cast<i32>(sd.arrWindows.size());
        sd.iStartRow = iRowCursor;
        sd.iLastRow  = iRowCursor + sd.nRows - 1;
        iRowCursor  += sd.nRows;
        m_iTotalDataRows += sd.nRows;

        f64 fW = 0.0;
        CAUTO itStockW = data.dctWeightsPerStock.find(sSymbol);
        if(itStockW != data.dctWeightsPerStock.end()) {
            CAUTO itYW = itStockW->second.find(m_iYear);
            if(itYW != itStockW->second.end()) fW = itYW->second;
        }
        m_arrWeights.push_back(fW);

        m_arrStockData.push_back(std::move(sd));
    }

    // Basket return curve: already weighted-avg of per-stock post-tax curves.
    CAUTO itBasket = data.dctReturnsForBasket.find(m_iYear);
    if(itBasket != data.dctReturnsForBasket.end()) {
        m_fEngineBasketReturn = itBasket->second[DAYS - 1];
    }
}

// ---------------------------------------------------------------------------
// writeSummary — 4-row summary block + blank
//   YEAR, <year>
//   STOCKS, S1, S2, ..., TOTAL, ENGINE_TOTAL
//   WEIGHTS, w1, w2, ...
//   RETURN_PCT, P_i_formula..., =SUMPRODUCT(...), <engine_total>%
// Each P_i = LET(pre, Profit/StartCash*100, IF(pre>0, pre*0.8, pre)) — after-tax.
// TOTAL = SUMPRODUCT(weights, per-stock after-tax returns) — also after-tax.
// ENGINE_TOTAL = engine basket curve's final day (already after per-stock tax).
// ---------------------------------------------------------------------------
void CVerifyCsvWriter::writeSummary(ostream& ofs) const {
    const i32 nStocks = static_cast<i32>(m_arrStockData.size());

    // Row 0
    vstr row0 = {"YEAR", to_string(m_iYear)};
    writeVec(row0, ofs);

    // Row 1
    vstr row1 = {"STOCKS"};
    for(CAUTOREF sd : m_arrStockData) row1.push_back(sd.sSymbol);
    row1.push_back("TOTAL");
    row1.push_back("ENGINE_TOTAL");
    writeVec(row1, ofs);

    // Row 2
    vstr row2 = {"WEIGHTS"};
    for(CAUTO w : m_arrWeights) row2.push_back(format("{:.2f}", w));
    writeVec(row2, ofs);

    // Row 3: RETURN_PCT
    vstr row3 = {"RETURN_PCT"};
    for(CAUTOREF sd : m_arrStockData) {
        // Profit column = J (ECSVCol::Profit = 9 → 'A'+9 = 'J'); Cash = I.
        CAUTO sProfitCell = REF(Profit, sd.iLastRow);
        CAUTO sCashStart  = REF(Cash,   sd.iStartRow);
        row3.push_back(format("=ROUND(LET(pre, {}/{}*100, IF(pre>0, pre*0.8, pre)), 2)",
            sProfitCell, sCashStart));
    }
    if(nStocks > 0) {
        const char cFirst = 'A' + 1;
        const char cLast  = 'A' + nStocks;
        row3.push_back(format("=ROUND(SUMPRODUCT({}{}:{}{}, {}{}:{}{}), 2)",
            cFirst, WeightsRow   + 1, cLast, WeightsRow   + 1,
            cFirst, ReturnPctRow + 1, cLast, ReturnPctRow + 1));
        row3.push_back(format("{:.2f}%", m_fEngineBasketReturn * 100.0));
    } else {
        row3.push_back("");
        row3.push_back("");
    }
    writeVec(row3, ofs);

    // Blank
    ofs << '\n';
}

// ---------------------------------------------------------------------------
// writeHeader — column-name row for the data grid
// ---------------------------------------------------------------------------
void CVerifyCsvWriter::writeHeader(ostream& ofs) const {
    TCSVRow row;
    for(i32 i = 0; i < CSVLastCol; ++i) row[i] = g_arrColNames[i];
    writeRow(row, ofs);
}

// ---------------------------------------------------------------------------
// setTradeRow — emit one BUY or SELL row
// ---------------------------------------------------------------------------
void CVerifyCsvWriter::setTradeRow(CREF(TWindow) window, bool bIsBuy) {
    const i32 iGridRow = m_iRow - Start - m_iRowOffset;
    TCSVRow& row = m_grid[iGridRow];

    const i32 iDay = bIsBuy ? window.iBeg : window.iEnd;
    CAUTO sDate = dayIdxToDate(m_iYear, iDay);
    // sDate = "YYYY-MM-DD"
    const str sMonth = sDate.substr(5, 2);
    const str sDay   = sDate.substr(8, 2);

    const char* sFeeSign = bIsBuy ? "" : "-";

    row[Stock]  = "";  // stock only on START row
    row[Action] = bIsBuy ? "BUY" : "SELL";
    row[Date]   = format("=DATE({}, {}, {})", m_sCellYear, sMonth, sDay);
    // Literal price from the year's data
    row[Price]  = format("{:.2f}", (*m_pPrices)[iDay]);

    // Held = prev Held + Traded
    row[Held] = "=ROUND(" + CALC(Held, '+', Traded, -1) + ", 2)";

    // Traded:
    //   BUY  : =FLOOR(Cash_prev / (1 + FeeRate) / Price)
    //   SELL : =-Held_prev
    if(bIsBuy) {
        row[Traded] = format("=ROUND(FLOOR({} / {}), 2)",
            CALC(Cash, '/', Price, -1),
            format("(1 + {})", RATE_FEE));
    } else {
        row[Traded] = "=ROUND(-" + REF(Held, m_iRow - 1) + ", 2)";
    }

    row[Cost] = "=ROUND(" + CALC(Price, '*', Traded) + ", 2)";
    row[Fees] = format("=ROUND({}{} * {}, 2)", sFeeSign, REF(Cost, m_iRow), RATE_FEE);
    row[Cash] = format("=ROUND({} - {}, 2)", REF(Cash, m_iRow - 1), CALC(Cost, '+', Fees));

    ++m_iRow;
}

// ---------------------------------------------------------------------------
// writeStockSection — one stock's rows: START + BUY/SELL pairs
// ---------------------------------------------------------------------------
void CVerifyCsvWriter::writeStockSection(CREF(TVerifyStockData) sd, ostream& ofs) {
    m_grid.clear();
    m_grid.resize(sd.nRows);
    for(auto& r : m_grid) r.fill("");

    m_sCellYear  = REF$(1, YearRow);   // $B$1
    m_sCellStock = REF$(Stock, Start + m_iRowOffset);

    m_pPrices = &sd.arrPrices;
    m_iRow    = Start + m_iRowOffset;

    // START row: each stock starts with fresh INIT_CAPITAL (same for all stocks).
    m_grid[0][Stock]  = sd.sSymbol;
    m_grid[0][Action] = "START";
    m_grid[0][Cash]   = format("{:.2f}", m_fStartCapital);
    ++m_iRow;

    // BUY/SELL pairs
    for(CAUTOREF w : sd.arrWindows) {
        setTradeRow(w, true);
        setTradeRow(w, false);
    }

    // Profit on last row = Cash_last - Cash_start
    CAUTO sCashStart = REF(Cash, Start + m_iRowOffset);
    CAUTO sCashLast  = REF(Cash, m_iRow - 1);
    m_grid.back()[Profit] = format("=ROUND({} - {}, 2)", sCashLast, sCashStart);

    for(CAUTOREF r : m_grid) writeRow(r, ofs);

    m_iRowOffset += sd.nRows;
}

// ---------------------------------------------------------------------------
// write — full CSV
// ---------------------------------------------------------------------------
void CVerifyCsvWriter::write(ostream& ofs) {
    m_iRowOffset = 0;
    writeSummary(ofs);
    writeHeader(ofs);
    for(CAUTOREF sd : m_arrStockData) writeStockSection(sd, ofs);
}

// ---------------------------------------------------------------------------
// One-shot convenience
// ---------------------------------------------------------------------------
str exportVerifyCsv(CREF(CBasket) basket, i32 iYear) {
    CVerifyCsvWriter writer;
    writer.load(basket, iYear);
    ostringstream oss;
    writer.write(oss);
    return oss.str();
}
