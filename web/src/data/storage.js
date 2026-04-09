// OPFS (Origin Private File System) storage layer.
// Stores per-stock per-year CSV files in the same naming convention as the
// old project: stocks/{SYMBOL}.NS_{YEAR}.csv (and .nodata sentinels).
// The C++ WASM engine will later read these same files via its OPFS mount.

// Get or create the stocks/ subdirectory under OPFS root.
async function _getStocksDir() {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle('stocks', { create: true });
}

function _csvFileName(sSymbol, nYear) {
    return `${sSymbol}.NS_${nYear}.csv`;
}

function _nodataFileName(sSymbol, nYear) {
    return `${sSymbol}.NS_${nYear}.nodata`;
}

// Write a year's CSV data to OPFS.
export async function writeStockYear(sSymbol, nYear, sCsv) {
    const dir = await _getStocksDir();
    const fileHandle = await dir.getFileHandle(_csvFileName(sSymbol, nYear), { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(sCsv);
    await writable.close();
}

// Write a .nodata sentinel (empty file marking a year with no data).
export async function writeNoData(sSymbol, nYear) {
    const dir = await _getStocksDir();
    const fileHandle = await dir.getFileHandle(_nodataFileName(sSymbol, nYear), { create: true });
    const writable = await fileHandle.createWritable();
    await writable.close();
}

// Check if a CSV file exists for this stock/year.
export async function hasStockYear(sSymbol, nYear) {
    try {
        const dir = await _getStocksDir();
        await dir.getFileHandle(_csvFileName(sSymbol, nYear));
        return true;
    } catch (err) {
        if (err.name === 'NotFoundError') return false;
        throw err;
    }
}

// Check if a .nodata sentinel exists for this stock/year.
export async function hasNoData(sSymbol, nYear) {
    try {
        const dir = await _getStocksDir();
        await dir.getFileHandle(_nodataFileName(sSymbol, nYear));
        return true;
    } catch (err) {
        if (err.name === 'NotFoundError') return false;
        throw err;
    }
}

// List all year numbers that have CSV data for a stock.
// Scans the stocks/ directory for matching filenames.
export async function getStockYears(sSymbol) {
    const dir = await _getStocksDir();
    const prefix = `${sSymbol}.NS_`;
    const arrYears = [];
    for await (const [sName] of dir) {
        if (sName.startsWith(prefix) && sName.endsWith('.csv')) {
            const sYear = sName.slice(prefix.length, -4);
            const nYear = parseInt(sYear, 10);
            if (!isNaN(nYear)) arrYears.push(nYear);
        }
    }
    return arrYears.sort((a, b) => b - a);
}

// Read the CSV content for a stock/year. Returns the string or null if not found.
export async function readStockYear(sSymbol, nYear) {
    try {
        const dir = await _getStocksDir();
        const fileHandle = await dir.getFileHandle(_csvFileName(sSymbol, nYear));
        const file = await fileHandle.getFile();
        return await file.text();
    } catch (err) {
        if (err.name === 'NotFoundError') return null;
        throw err;
    }
}
