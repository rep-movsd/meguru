// Yahoo Finance fetch helper.
// Fetches stock price data via the Cloudflare Worker CORS proxy.
// Ported from the old Python data_downloader.py.

const WORKER_URL = import.meta.env.VITE_WORKER_URL || 'http://localhost:8787';
const MAX_CONSECUTIVE_NODATA = 3;

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

// Fetch all available years for a stock (up to nMaxYears back from current year).
// Calls onProgress({ nYear, sStatus, sMessage }) for each year.
// sStatus is 'ok', 'nodata', or 'error'.
// Returns { mapYearCsv: Map<number, string>, arrNoDataYears: number[] }.
export async function fetchAllYears(sSymbol, nMaxYears = 25, onProgress, signal) {
    const nCurrentYear = new Date().getFullYear();
    const mapYearCsv = new Map();
    const arrNoDataYears = [];
    let nConsecutiveNoData = 0;

    for (let i = 0; i < nMaxYears; i++) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

        const nYear = nCurrentYear - i;

        try {
            const result = await fetchYearData(sSymbol, nYear, signal);

            if (result === null) {
                arrNoDataYears.push(nYear);
                nConsecutiveNoData++;
                if (onProgress) onProgress({ nYear, sStatus: 'nodata', sMessage: 'No data' });

                if (nConsecutiveNoData >= MAX_CONSECUTIVE_NODATA) {
                    if (onProgress) onProgress({
                        nYear: nYear - 1,
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

        // 1s delay between requests to avoid rate limiting
        if (i < nMaxYears - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    return { mapYearCsv, arrNoDataYears };
}
