#include "basket.h"
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

// Load a single year's CSV data from JS string into the engine cache.
// Call once per year, then call compute() to trigger analysis.
void jsLoadCsv(const str& sSymbol, i32 nYear, const str& sCsv) {
    DEBUG_LOG("jsLoadCsv: symbol=%s year=%d csvLen=%d", sSymbol.c_str(), nYear, (i32)sCsv.size());
    g_basket.loadCsv(sSymbol, nYear, sCsv);
}

// Run computation on a stock whose year data was loaded via loadCsv().
void jsCompute(const str& sSymbol, i32 nYears, i32 nWinMin, i32 nWinMax, f64 pctThreshold) {
    DEBUG_LOG("jsCompute: symbol=%s nYears=%d nWinMin=%d nWinMax=%d pctThreshold=%.1f",
              sSymbol.c_str(), nYears, nWinMin, nWinMax, pctThreshold);
    TPlanParams params{nYears, nWinMin, nWinMax, pctThreshold};
    g_basket.compute(sSymbol, params);
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

val jsGetGraphData(i32 nYear) {
    CAUTO data = g_basket.getGraphData(nYear);

    val result = val::object();

    // stocks: string[]
    val jsStocks = val::array();
    for(CAUTOREF s : data.arrStocks) jsStocks.call<void>("push", s);
    result.set("stocks", jsStocks);

    // years: int[]
    val jsYears = val::array();
    for(CAUTO y : data.arrYears) jsYears.call<void>("push", y);
    result.set("years", jsYears);

    // perStock: array of { "2024": f64[366], "average": f64[366] }
    val jsPerStock = val::array();
    for(CAUTOREF curves : data.arrPerStock) {
        val obj = val::object();
        for(CAUTOREF [sKey, arrValues] : curves) {
            obj.set(sKey, vecToJsArray(arrValues));
        }
        jsPerStock.call<void>("push", obj);
    }
    result.set("perStock", jsPerStock);

    // basketAvg: { "2024": f64[366], "average": f64[366] }
    val jsBasketAvg = val::object();
    for(CAUTOREF [sKey, arrValues] : data.dctBasketAvg) {
        jsBasketAvg.set(sKey, vecToJsArray(arrValues));
    }
    result.set("basketAvg", jsBasketAvg);

    return result;
}

// ---------------------------------------------------------------------------
// Embind module registration
// ---------------------------------------------------------------------------

EMSCRIPTEN_BINDINGS(meguru) {
    emscripten::function("loadCsv",         &jsLoadCsv);
    emscripten::function("compute",         &jsCompute);
    emscripten::function("removeStock",     &jsRemoveStock);
    emscripten::function("setParams",       &jsSetParams);
    emscripten::function("getStockDetail",  &jsGetStockDetail);
    emscripten::function("getGraphData",    &jsGetGraphData);
}
