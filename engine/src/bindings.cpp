#include "basket.h"
#include "verifycsv.h"
#include "tradecalendar.h"
#include <emscripten/bind.h>
#include <emscripten/val.h>

using namespace emscripten;

// ---------------------------------------------------------------------------
// Global basket instance
// ---------------------------------------------------------------------------

static CBasket g_basket;

// ---------------------------------------------------------------------------
// Embind wrappers
// ---------------------------------------------------------------------------

// Store a raw CSV string into the in-memory store.
// JS calls this once per year before calling addStock().
// sPath key format: "SYMBOL.NS_YYYY.csv"
void jsStoreCsv(const str& sPath, const str& sCsv) {
    DEBUG_LOG("jsStoreCsv: path=%s csvLen=%d", sPath.c_str(), (i32)sCsv.size());
    g_basket.storeCsv(sPath, sCsv);
}

// Add a stock (or update params if already present).
// TStockData::load() reads from m_dctData (filled by storeCsv) in WASM,
// or from the filesystem in native builds.
void jsAddStock(const str& sSymbol, i32 nYears, i32 nWinMin, i32 nWinMax, f64 pctThreshold) {
    DEBUG_LOG("jsAddStock: symbol=%s nYears=%d nWinMin=%d nWinMax=%d pctThreshold=%.1f",
              sSymbol.c_str(), nYears, nWinMin, nWinMax, pctThreshold);
    TPlanParams params{nYears, nWinMin, nWinMax, pctThreshold};
    g_basket.addStock(sSymbol, params);
}

void jsRemoveStock(const str& sSymbol) {
    g_basket.removeStock(sSymbol);
}

void jsSetParams(const str& sSymbol, i32 nYears, i32 nWinMin, i32 nWinMax, f64 pctThreshold) {
    TPlanParams params{nYears, nWinMin, nWinMax, pctThreshold};
    g_basket.setParams(sSymbol, params);
}

val jsGetStockDetail(const str& sSymbol) {
    CAUTOREF arrYears = g_basket.getYears(sSymbol);
    CAUTOREF arrStats = g_basket.getWindowStats(sSymbol);

    val result = val::object();
    result.set("stock", sSymbol);

    // years: flat array of ints, most-recent-first
    val jsYears = val::array();
    for(CAUTO y : arrYears) jsYears.call<void>("push", y);
    result.set("years", jsYears);

    // stats: array of window stat objects
    val jsStats = val::array();
    for(CAUTOREF ws : arrStats) {
        val stat = val::object();
        stat.set("iBeg", ws.iBeg);
        stat.set("iEnd", ws.iEnd);
        stat.set("pctWin", ws.pctWin);
        stat.set("pctExpected", ws.pctExpected);
        stat.set("fProfitRatio", ws.fProfitRatio);

        val jsGains = val::array();
        for(CAUTO g : ws.arrYearGains) jsGains.call<void>("push", g);
        stat.set("yearlyReturns", jsGains);

        jsStats.call<void>("push", stat);
    }
    result.set("stats", jsStats);

    return result;
}

// Build a val::array of f64 from a vf64
static val vecToJsArray(CREF(vf64) v) {
    val arr = val::array();
    for(CAUTO x : v) arr.call<void>("push", x);
    return arr;
}

// Build a val::array of f64 from a TPrices (valarray<f64>)
static val vecToJsArray(CREF(TPrices) v) {
    val arr = val::array();
    FOR(i, 0, (i32)v.size()) arr.call<void>("push", v[i]);
    return arr;
}

// Set allocation mode and optional custom weights.
// eMode: 0=Equal, 1=Return, 2=Custom.
// jsWeights: JS array of f64 (only used for Custom mode).
void jsSetAlloc(i32 eMode, val jsWeights) {
    vf64 arrWeights;
    if(jsWeights.isArray()) {
        CAUTO nLen = jsWeights["length"].as<i32>();
        arrWeights.reserve(nLen);
        FOR(i, 0, nLen) arrWeights.push_back(jsWeights[i].as<f64>());
    }
    g_basket.setAlloc(static_cast<EAllocMode>(eMode), arrWeights);
}

// Helper: convert TReturnsForYear (map<i32, TPrices>) to JS object.
// Keys become strings: year number or "0" for average.
static val returnsToJs(CREF(TReturnsForYear) curves) {
    val obj = val::object();
    for(CAUTOREF [iKey, arrValues] : curves) {
        obj.set(to_string(iKey), vecToJsArray(arrValues));
    }
    return obj;
}

// Helper: convert map<str, TReturnsForYear> to JS object { "SYMBOL": { "2024": [...], "0": [...] } }
static val stockReturnsToJs(CREF(TReturnsPerStock) dct) {
    val obj = val::object();
    for(CAUTOREF [sSymbol, curves] : dct) {
        obj.set(sSymbol, returnsToJs(curves));
    }
    return obj;
}

// Helper: convert map<str, TWeightsForYear> to JS object { "SYMBOL": { "2024": f64, "0": f64 } }
static val stockWeightsToJs(CREF(TWeightsPerStock) dct) {
    val obj = val::object();
    for(CAUTOREF [sSymbol, weights] : dct) {
        val inner = val::object();
        for(CAUTOREF [iYear, fW] : weights) inner.set(to_string(iYear), fW);
        obj.set(sSymbol, inner);
    }
    return obj;
}

val jsGetGraphData(i32 nYear) {
    CAUTO data = g_basket.getGraphData(nYear);

    val result = val::object();

    // years: int[]
    val jsYears = val::array();
    for(CAUTO y : data.arrYears) jsYears.call<void>("push", y);
    result.set("years", jsYears);

    // perStockHold: { "RELIANCE": { "2024": f64[366], "0": f64[366] }, ... }
    result.set("perStockHold", stockReturnsToJs(data.dctReturnsPerStockHold));

    // perStockPlan: { "RELIANCE": { "2024": f64[366], "0": f64[366] }, ... }
    result.set("perStockPlan", stockReturnsToJs(data.dctReturnsPerStockPlan));

    // basketAvg: { "2024": f64[366], "0": f64[366] }
    result.set("basketAvg", returnsToJs(data.dctReturnsForBasket));

    // weightsPerStock: { "RELIANCE": { "2024": f64, "0": f64 }, ... }  (effective, renormalized)
    result.set("weightsPerStock", stockWeightsToJs(data.dctWeightsPerStock));

    // daysInMarket: { "RELIANCE": f64, ... }  (fraction 0..1 of trading year in plan windows)
    val jsDays = val::object();
    for(CAUTOREF [sSymbol, fFrac] : data.dctDaysInMarket) jsDays.set(sSymbol, fFrac);
    result.set("daysInMarket", jsDays);

    return result;
}

// Export a Google-Sheets-ready verification CSV for a given year.
// iYear <= 0 → use (current year - 1).
str jsExportVerifyCsv(i32 iYear) {
    DEBUG_LOG("jsExportVerifyCsv: year=%d", iYear);
    return exportVerifyCsv(g_basket, iYear);
}

str jsExportTradeCalendarCsv() {
    DEBUG_LOG("jsExportTradeCalendarCsv");
    return exportTradeCalendarCsv(g_basket);
}

// Auto-optimize stock params; returns chosen { nYears, nWinMin, nWinMax, pctThreshold }.
emscripten::val jsOptimizeStockParams(const str& sSymbol) {
    DEBUG_LOG("jsOptimizeStockParams: %s", sSymbol.c_str());
    CAUTO prm = g_basket.optimizeStockParams(sSymbol);
    emscripten::val result = emscripten::val::object();
    result.set("nYears",       prm.nYears);
    result.set("nWinMin",      prm.nWinMin);
    result.set("nWinMax",      prm.nWinMax);
    result.set("pctThreshold", prm.pctThreshold);
    return result;
}

// Auto-optimize basket allocation; returns array of weights (parallel to stock list).
emscripten::val jsOptimizeAllocation() {
    DEBUG_LOG("jsOptimizeAllocation");
    CAUTO arrW = g_basket.optimizeAllocation();
    emscripten::val arr = emscripten::val::array();
    FOR(i, 0, (i32)arrW.size()) arr.set(i, arrW[i]);
    return arr;
}

// Toggle a stock's contribution to basket aggregation.
void jsSetStockVisible(const str& sSymbol, bool bVisible) {
    DEBUG_LOG("jsSetStockVisible: %s = %d", sSymbol.c_str(), (int)bVisible);
    g_basket.setVisible(sSymbol, bVisible);
}

// ---------------------------------------------------------------------------
// Embind module registration
// ---------------------------------------------------------------------------

EMSCRIPTEN_BINDINGS(meguru) {
    emscripten::function("storeCsv",        &jsStoreCsv);
    emscripten::function("addStock",        &jsAddStock);
    emscripten::function("removeStock",     &jsRemoveStock);
    emscripten::function("setParams",       &jsSetParams);
    emscripten::function("getStockDetail",  &jsGetStockDetail);
    emscripten::function("getGraphData",    &jsGetGraphData);
    emscripten::function("setAlloc",        &jsSetAlloc);
    emscripten::function("exportVerifyCsv", &jsExportVerifyCsv);
    emscripten::function("exportTradeCalendarCsv", &jsExportTradeCalendarCsv);
    emscripten::function("optimizeStockParams",    &jsOptimizeStockParams);
    emscripten::function("optimizeAllocation",     &jsOptimizeAllocation);
    emscripten::function("setStockVisible",        &jsSetStockVisible);
}
