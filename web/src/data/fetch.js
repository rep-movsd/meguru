// Headless data-fetcher: downloads & caches Yahoo data for a stock into OPFS.
// Same logic as FetchModal.startFetching but without UI. Returns number of
// data-years available after the fetch (cached + freshly downloaded).
//
// onProgress: optional ({ nYear, sStatus, sMessage }) => void

import { fetchYears } from './yahoo.js';
import {
    writeStockYear,
    writeNoData,
    hasStockYear,
    hasNoData
} from './storage.js';

const MAX_YEARS = 25;

export async function ensureStockData(sSymbol, onProgress, signal) {
    const log = (entry) => { if (onProgress) onProgress(entry); };

    const nCurrentYear = new Date().getFullYear();
    const arrMissingYears = [];
    let nCachedDataYears = 0;

    for (let i = 0; i < MAX_YEARS; i++) {
        const nYear = nCurrentYear - i;
        const bHasCsv    = await hasStockYear(sSymbol, nYear);
        const bHasNoData = await hasNoData(sSymbol, nYear);
        if (bHasCsv)              nCachedDataYears++;
        else if (!bHasNoData)     arrMissingYears.push(nYear);
    }

    if (arrMissingYears.length === 0) {
        log({ nYear: null, sStatus: 'ok', sMessage: `${sSymbol}: cached` });
        return nCachedDataYears;
    }

    log({
        nYear: null, sStatus: 'info',
        sMessage: `${sSymbol}: fetching ${arrMissingYears.length} year(s)`
    });

    const { mapYearCsv, arrNoDataYears, arrSkippedNoDataYears } =
        await fetchYears(sSymbol, arrMissingYears, onProgress, signal);

    for (const [nYear, sCsv] of mapYearCsv)        await writeStockYear(sSymbol, nYear, sCsv);
    for (const nYear of arrNoDataYears)            await writeNoData(sSymbol, nYear);
    for (const nYear of arrSkippedNoDataYears)     await writeNoData(sSymbol, nYear);

    return mapYearCsv.size + nCachedDataYears;
}
