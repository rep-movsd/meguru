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

// Read all year CSVs for a stock from OPFS and load them into the C++ engine.
// Returns the number of years loaded.
async function _feedStockData(symbol) {
    if (!_module) return 0;

    const arrYears = await getStockYears(symbol);
    let nLoaded = 0;

    for (const nYear of arrYears) {
        const sCsv = await readStockYear(symbol, nYear);
        if (sCsv) {
            _module.loadCsv(symbol, nYear, sCsv);
            nLoaded++;
        }
    }

    return nLoaded;
}

// ---------------------------------------------------------------------------
// Engine wrapper — same interface as the old MockEngine
// ---------------------------------------------------------------------------

const engine = {

    // addStock is async: reads OPFS data from JS, feeds CSV strings to C++,
    // then triggers C++ computation. All C++ calls are synchronous.
    async addStock(symbol, params) {
        if (!_module) return;
        const nLoaded = await _feedStockData(symbol);
        if (nLoaded === 0) return;
        _module.compute(
            symbol,
            params.nYears || 10,
            params.nWinMin || 10,
            params.nWinMax || 31,
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
            params.nWinMax || 31,
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

    setStockVisible(_symbol, _visible) {
        // TODO: implement in C++ engine
    },

    setAllocMode(_mode) {
        // TODO: implement in C++ engine
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
