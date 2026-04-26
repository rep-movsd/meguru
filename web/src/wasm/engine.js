// WASM engine wrapper — loads the C++ engine and exposes the same interface
// that the UI expects. Methods not yet implemented in WASM are stubbed.
//
// Data flow (no WasmFS / no pthreads):
//   JS reads CSV strings from OPFS via File System Access API,
//   passes each to _module.loadCsv(symbol, year, csv),
//   then calls _module.compute(symbol, params) to trigger analysis.

import { getStockYears, readStockYear } from '../data/storage.js';

let _module = null;
let _bReady = false;

// Initialize the WASM module. Call once at app startup.
// meguru.js + meguru.wasm live in public/wasm/ (served as-is, no Vite transform).
// Vite 6 blocks import() of JS from public/, so we fetch the script as text,
// create a blob URL, and import() that. locateFile tells Emscripten where .wasm is.
export async function initEngine() {
    if (_bReady) return;

    const sWasmDir = '/wasm/';
    const resp = await fetch(sWasmDir + 'meguru.js');
    const sSource = await resp.text();
    const blob = new Blob([sSource], { type: 'application/javascript' });
    const sBlobUrl = URL.createObjectURL(blob);
    const { default: createEngine } = await import(/* @vite-ignore */ sBlobUrl);
    URL.revokeObjectURL(sBlobUrl);

    _module = await createEngine({
        locateFile: (sPath) => sWasmDir + sPath
    });

    _bReady = true;
}

// Read all year CSVs for a stock from OPFS and store them into the C++ engine.
// Returns the number of years stored.
async function _feedStockData(symbol) {
    if (!_module) return 0;

    const arrYears = await getStockYears(symbol);
    let nLoaded = 0;

    for (const nYear of arrYears) {
        const sCsv = await readStockYear(symbol, nYear);
        if (sCsv) {
            // Key format matches native filenames: SYMBOL.NS_YYYY.csv
            const sPath = `${symbol}.NS_${nYear}.csv`;
            _module.storeCsv(sPath, sCsv);
            nLoaded++;
        }
    }

    return nLoaded;
}

// ---------------------------------------------------------------------------
// Engine wrapper — same interface as the old MockEngine
// ---------------------------------------------------------------------------

const engine = {

    // addStock is async: reads OPFS data from JS, stores CSV strings into
    // TStockData via storeCsv(), then calls addStock() which loads + computes.
    async addStock(symbol, params) {
        if (!_module) return;
        const nLoaded = await _feedStockData(symbol);
        if (nLoaded === 0) return;
        _module.addStock(
            symbol,
            params.nYears || 10,
            params.nWinMin || 10,
            180,
            params.fPctWin || 60
        );
    },

    removeStock(symbol) {
        if (!_module) return;
        _module.removeStock(symbol);
    },

    updateStockParams(symbol, params) {
        if (!_module) return;
        _module.setParams(
            symbol,
            params.nYears || 10,
            params.nWinMin || 10,
            180,
            params.fPctWin || 60
        );
    },

    // Returns a native JS object (val from embind), not a JSON string
    getStockDetail(symbol) {
        if (!_module) return null;
        const result = _module.getStockDetail(symbol);
        return result;
    },

    // --- Stubs for methods not yet in WASM ---

    // Graph data: normalized B&H curves for nYear most-recent years.
    // Returns { stocks, years, perStock, basketAvg } — native JS object from embind.
    getGraphData(nYear) {
        if (!_module) return null;
        return _module.getGraphData(nYear || 10);
    },

    setStockVisible(symbol, visible) {
        if (!_module) return;
        _module.setStockVisible(symbol, !!visible);
    },

    setAllocMode(mode, customWeights = []) {
        if (!_module) return;
        // Accept either a numeric enum (0=Equal, 1=Return, 2=Custom)
        // or a string from the UI: 'equal' | 'avgret' | 'mcap' | 'custom'.
        // 'mcap' isn't implemented in the engine — falls back to Equal.
        let iMode = 0;
        if (typeof mode === 'number') {
            iMode = mode;
        } else {
            const sMap = { equal: 0, avgret: 1, mcap: 0, custom: 2 };
            iMode = sMap[mode] ?? 0;
        }
        _module.setAlloc(iMode, customWeights);
    },

    // Export Google-Sheets-ready verification CSV for the given year.
    // Pass 0 (or omit) to use the most recent complete year.
    exportVerifyCsv(year = 0) {
        if (!_module) return '';
        return _module.exportVerifyCsv(year);
    },

    // Export trade calendar CSV: Date,Stock1,Stock2,... rows with BUY/SELL.
    // Year-agnostic (MM-DD).
    exportTradeCalendarCsv() {
        if (!_module) return '';
        return _module.exportTradeCalendarCsv();
    },

    // Brute-force grid search over (nWinMin, pctThreshold) to maximize plan
    // return. Mutates engine state in-place. Returns the chosen params.
    optimizeStockParams(symbol) {
        if (!_module) return null;
        return _module.optimizeStockParams(symbol);
    },

    // Brute-force search over weight compositions (5% step ≤5 stocks else 10%)
    // to maximize basket plan return. Switches engine to Custom mode with the
    // chosen weights. Returns the array of weights (parallel to stock list).
    optimizeAllocation() {
        if (!_module) return [];
        const v = _module.optimizeAllocation();
        // emscripten::val::array() returns a JS array directly
        return Array.isArray(v) ? v : Array.from({ length: v.length }, (_, i) => v[i]);
    },

    setMarketCap(_symbol, _mcap) {
        // TODO: implement in C++ engine
    },

    setCustomWeight(_symbol, _weight) {
        // TODO: implement in C++ engine
    },

    getBasketResult() {
        // TODO: implement in C++ engine
        return '';
    },

    getBasketStocks() {
        // TODO: implement in C++ engine
        return '[]';
    },

    getStockParams(_symbol) {
        // TODO: implement in C++ engine
        return '';
    }
};

export default engine;
