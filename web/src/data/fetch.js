// Headless data-fetcher: downloads & caches Yahoo data for a stock into OPFS.
// Same logic as FetchModal.startFetching but without UI. Returns number of
// data-years available after the fetch (cached + freshly downloaded).
//
// onProgress: optional ({ sPhase, ... }) => void
//   sPhase: 'scanning' | 'cached' | 'fetching' | 'done'
//   When 'fetching':  { nYear, nYearDone, nYearTotal, sStatus, sMessage }
//   When 'cached':    { nCachedYears }
//   When 'done':      { nTotalYears }

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

    log({ sPhase: 'scanning' });

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
        log({ sPhase: 'cached', nCachedYears: nCachedDataYears });
        return nCachedDataYears;
    }

    const nYearTotal = arrMissingYears.length;
    let nYearDone = 0;

    // Wrap yahoo's per-year callback to add running counters.
    const wrapped = (entry) => {
        // entry: { nYear, sStatus, sMessage } where nYear may be null on terminal events
        if (entry.nYear !== null) nYearDone++;
        log({
            sPhase:     'fetching',
            nYear:      entry.nYear,
            nYearDone,
            nYearTotal,
            sStatus:    entry.sStatus,
            sMessage:   entry.sMessage
        });
    };

    const { mapYearCsv, arrNoDataYears, arrSkippedNoDataYears } =
        await fetchYears(sSymbol, arrMissingYears, wrapped, signal);

    for (const [nYear, sCsv] of mapYearCsv)        await writeStockYear(sSymbol, nYear, sCsv);
    for (const nYear of arrNoDataYears)            await writeNoData(sSymbol, nYear);
    for (const nYear of arrSkippedNoDataYears)     await writeNoData(sSymbol, nYear);

    const nTotalYears = mapYearCsv.size + nCachedDataYears;
    log({ sPhase: 'done', nTotalYears });
    return nTotalYears;
}
