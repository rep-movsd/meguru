#include "utils.h"

// ---------------------------------------------------------------------------
// Trading constants
// ---------------------------------------------------------------------------

const f64 RATE_FEE = 0.02;
const f64 RATE_TAX = 0.20;

// ---------------------------------------------------------------------------
// Date / calendar utilities
// ---------------------------------------------------------------------------

i32 getCurYear() {
    const auto now = chrono::system_clock::now();
    const chrono::year_month_day ymd{floor<chrono::days>(now)};
    const i32 currentYear = static_cast<i32>(ymd.year());
    return currentYear;
}

i32 getDayIndexForYMD(sv sDate) {
    using namespace chrono;

    if(sDate.size() < 10) {
        DEBUG_LOG("getDayIndexForYMD: BAD date length=%d str='%.*s'",
                  (i32)sDate.size(), (i32)sDate.size(), sDate.data());
        return -1;
    }

    i32 iY; unsigned iM, iD;
    from_chars(sDate.data(),     sDate.data() + 4,  iY);
    from_chars(sDate.data() + 5, sDate.data() + 7,  iM);
    from_chars(sDate.data() + 8, sDate.data() + 10, iD);

    if(iM < 1 || iM > 12 || iD < 1 || iD > 31) {
        DEBUG_LOG("getDayIndexForYMD: BAD parsed values Y=%d M=%u D=%u from '%.*s'",
                  iY, iM, iD, (i32)sDate.size(), sDate.data());
        return -1;
    }

    const year yyyy{iY};
    const month mm{iM};
    const day dd{iD};

    // Get the Jan 1 and subtract from this date to get the index
    const sys_days sdJan1{yyyy / 1 / 1};
    const year_month_day ctYMD{yyyy, mm, dd};
    const sys_days sd{ctYMD};

    i32 idxDay = static_cast<i32>((sd - sdJan1).count());

    // Always act as if Feb 29 exists and year has 366 days.
    // Non-leap: days after Feb 28 (index 59) shift up by 1.
    if(!yyyy.is_leap() && idxDay >= 59) ++idxDay;

    if(idxDay < 0 || idxDay >= DAYS) {
        DEBUG_LOG("getDayIndexForYMD: OOB idxDay=%d from '%.*s'",
                  idxDay, (i32)sDate.size(), sDate.data());
        return -1;
    }

    return idxDay;
}

// Reverse of getDayIndexForYMD. Mirrors the leap-shift logic:
// leap year:      date = Jan-1 + iDay
// non-leap year:  iDay == 59 is the synthetic Feb-29 slot ("YYYY-02-29")
//                 iDay  > 59 → real date = Jan-1 + (iDay - 1)
//                 iDay  < 59 → real date = Jan-1 + iDay
str dayIdxToDate(i32 iYear, i32 iDay) {
    using namespace chrono;

    if(iDay < 0 || iDay >= DAYS) return "";

    const year yyyy{iYear};

    // Non-leap Feb-29 slot: emit synthetic date
    if(!yyyy.is_leap() && iDay == 59) {
        return format("{:04d}-02-29", iYear);
    }

    const i32 iOffset = (!yyyy.is_leap() && iDay > 59) ? iDay - 1 : iDay;
    const sys_days sdJan1{yyyy / 1 / 1};
    const sys_days sd = sdJan1 + days{iOffset};
    const year_month_day ymd{sd};

    return format("{:04d}-{:02d}-{:02d}",
                  static_cast<i32>(ymd.year()),
                  static_cast<unsigned>(ymd.month()),
                  static_cast<unsigned>(ymd.day()));
}

// ---------------------------------------------------------------------------
// Price data utilities
// ---------------------------------------------------------------------------

void fillGaps(TYearData& data) {
    i32 iLast = DAYS - 1;
    while(iLast > -1 && data.arrDayIdx[iLast] == -1) --iLast;

    // Everything after iLast is empty here
    if(iLast > -1) {

        // Fill that empty area forwards with the last traded price and date
        f64 fPriceLast = data.arrPrices[iLast];
        i32 iDayLast   = data.arrDayIdx[iLast];
        FOR(i, iLast + 1, DAYS) {
            data.arrPrices[i] = fPriceLast;
            data.arrDayIdx[i] = iDayLast;
        }

        // Iterate rest (backwards) and fill missing days with the price from the next trade day
        for(i32 i = iLast - 1; i >= 0; --i) {
            if(data.arrDayIdx[i] == -1) {
                data.arrPrices[i] = fPriceLast;
                data.arrDayIdx[i] = iDayLast;
            }
            fPriceLast = data.arrPrices[i];
            iDayLast   = data.arrDayIdx[i];
        }
    }
}

TYearData parseOneCsv(cstr& sCsv) {
    TYearData data;
    if(sCsv.empty()) return data;

    istringstream ss(sCsv);
    str sLine;
    getline(ss, sLine);  // skip header
    DEBUG_LOG("parseOneCsv: header='%s' totalLen=%d", sLine.c_str(), (i32)sCsv.size());

    i32 nLines = 0;
    i32 nSkipped = 0;
    while(getline(ss, sLine)) {
        // Trim trailing \r if present (CSV may have \r\n line endings)
        if(!sLine.empty() && sLine.back() == '\r') sLine.pop_back();
        if(sLine.empty()) continue;

        CAUTO iComma = sLine.find(',');
        if(iComma == string::npos) {
            DEBUG_LOG("parseOneCsv: no comma in line %d: '%s'", nLines, sLine.c_str());
            ++nSkipped;
            continue;
        }

        const sv svDate(sLine.data(), iComma);
        const sv svPrice(sLine.data() + iComma + 1, sLine.size() - iComma - 1);

        const i32 idxDay = getDayIndexForYMD(svDate);
        if(idxDay < 0) {
            ++nSkipped;
            continue;
        }

        f64 fPrice = 0.0;
        from_chars(svPrice.data(), svPrice.data() + svPrice.size(), fPrice);

        data.arrPrices[idxDay] = fPrice;
        data.arrDayIdx[idxDay] = idxDay;
        ++nLines;
    }

    DEBUG_LOG("parseOneCsv: %d data lines, %d skipped", nLines, nSkipped);

    fillGaps(data);
    return data;
}

f64 getGain(CREF(TPrices) arrPrices, CREF(TWindow) window) {
    return (arrPrices[window.iEnd] / arrPrices[window.iBeg]) - 1.0;
}
