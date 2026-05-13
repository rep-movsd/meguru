// Yahoo Finance fetch helper.
// Fetches stock price data via the Cloudflare Worker CORS proxy.
// Ported from the old Python data_downloader.py.

const WORKER_URL = import.meta.env.VITE_WORKER_URL ||
    (import.meta.env.DEV ? 'http://localhost:8787' : null);
const MAX_CONSECUTIVE_NODATA = 3;

if (!WORKER_URL) {
    throw new Error('VITE_WORKER_URL environment variable is required in production');
}

// Promise-based delay that rejects immediately if the signal fires.
function abortableDelay(nMs, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
        }
        const timer = setTimeout(() => {
            if (signal) signal.removeEventListener('abort', onAbort);
            resolve();
        }, nMs);
        function onAbort() {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
        }
        if (signal) signal.addEventListener('abort', onAbort, { once: true });
    });
}

// Fetch one year of daily price data for a stock.
// Returns { sCsv, nTradingDays } on success, null if no data exists for this year.
// Throws on network/parse errors.
export async function fetchYearData(sSymbol, nYear, signal) {
    const nPeriod1 = Math.floor(new Date(nYear, 0, 1).getTime() / 1000);
    const nPeriod2 = Math.floor(new Date(nYear + 1, 0, 1).getTime() / 1000);
    const sUrl = `${WORKER_URL}/chart/${sSymbol}.NS?period1=${nPeriod1}&period2=${nPeriod2}&interval=1d`;

    const resp = await fetch(sUrl, { signal });

    // HTTP 400 = stock didn't exist this year
    if (resp.status === 400) return null;

    if (resp.status === 429) {
        throw new Error('Yahoo Finance rate limit (HTTP 429). Wait a few minutes.');
    }

    if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
    }

    const data = await resp.json();
    const result = data?.chart?.result;
    if (!result || result.length === 0) return null;

    const entry = result[0];
    const arrTimestamps = entry.timestamp;
    const arrCloses = entry.indicators?.quote?.[0]?.close;

    if (!arrTimestamps || !arrCloses || arrTimestamps.length === 0) return null;

    // Build CSV: Date,Close
    const arrLines = ['Date,Close'];
    let nCount = 0;
    for (let i = 0; i < arrTimestamps.length; i++) {
        const fClose = arrCloses[i];
        if (fClose == null) continue;
        const sDate = new Date(arrTimestamps[i] * 1000).toISOString().slice(0, 10);
        arrLines.push(`${sDate},${fClose}`);
        nCount++;
    }

    if (nCount === 0) return null;

    return { sCsv: arrLines.join('\n') + '\n', nTradingDays: nCount };
}

// Fetch specific years of data for a stock.
// arrYears: array of year numbers to fetch (most recent first).
// Calls onProgress({ nYear, sStatus, sMessage }) for each year.
// sStatus is 'ok', 'nodata', or 'error'.
// Returns {
//   mapYearCsv: Map<number, string>,
//   arrNoDataYears: number[],
//   arrSkippedNoDataYears: number[]
// }.
export async function fetchYears(sSymbol, arrYears, onProgress, signal) {
    const mapYearCsv = new Map();
    const arrNoDataYears = [];
    const arrSkippedNoDataYears = [];
    let nConsecutiveNoData = 0;

    for (let i = 0; i < arrYears.length; i++) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

        const nYear = arrYears[i];

        try {
            const result = await fetchYearData(sSymbol, nYear, signal);

            if (result === null) {
                arrNoDataYears.push(nYear);
                nConsecutiveNoData++;
                if (onProgress) onProgress({ nYear, sStatus: 'nodata', sMessage: 'No data' });

                if (nConsecutiveNoData >= MAX_CONSECUTIVE_NODATA) {
                    arrSkippedNoDataYears.push(...arrYears.slice(i + 1));
                    if (onProgress) onProgress({
                        nYear: null,
                        sStatus: 'nodata',
                        sMessage: `Stopping \u2014 ${MAX_CONSECUTIVE_NODATA} consecutive years with no data`
                    });
                    break;
                }
            } else {
                mapYearCsv.set(nYear, result.sCsv);
                nConsecutiveNoData = 0;
                if (onProgress) onProgress({
                    nYear,
                    sStatus: 'ok',
                    sMessage: `OK (${result.nTradingDays} trading days)`
                });
            }
        } catch (err) {
            if (err.name === 'AbortError') throw err;
            if (onProgress) onProgress({ nYear, sStatus: 'error', sMessage: err.message });
            // Don't break on error — try remaining years
        }

        // 100ms delay between requests to avoid rate limiting (abort-aware)
        if (i < arrYears.length - 1) {
            await abortableDelay(100, signal);
        }
    }

    return { mapYearCsv, arrNoDataYears, arrSkippedNoDataYears };
}
