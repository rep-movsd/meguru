#include "basket.h"

namespace fs = filesystem;

#ifdef __EMSCRIPTEN__
constexpr const char* STOCKS_DIR = "/opfs/stocks";
#else
constexpr const char* STOCKS_DIR = "stocks";
#endif

// Trading fees (applied on value on both buy and sell)
const double RATE_FEE = 0.02;

// STCG tax (on profit)
const double RATE_TAX = 0.20;

// ---------------------------------------------------------------------------
// Standalone utilities
// ---------------------------------------------------------------------------

i32 getCurYear() {
    const auto now = chrono::system_clock::now();
    const chrono::year_month_day ymd{floor<chrono::days>(now)};
    const i32 currentYear = static_cast<i32>(ymd.year());
    return currentYear;
}


// Gets the day-of-year index (0..365) for a YYYY-MM-DD date string_view.
// Always treats the year as 366 days: non-leap years shift days after Feb 28 up by 1.
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

// Backward-fills gaps in a year's price and day-index arrays.
// For any day with no data (weekend/holiday), fills with the next trading day's
// price and day index.
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

// Read a single year CSV (Date,Close format) and return backfilled year data.
TYearData loadOneYear(cstr& sSymbol, i32 nYear) {
    TYearData data;

    const str sPath = str(STOCKS_DIR) + "/" + sSymbol + ".NS_" + to_string(nYear) + ".csv";
    DEBUG_LOG("loadOneYear: opening %s", sPath.c_str());
    ifstream fIn(sPath);
    if(!fIn.is_open()) {
        DEBUG_LOG("loadOneYear: FAILED to open %s", sPath.c_str());
        return data;
    }

    str sLine;
    getline(fIn, sLine);  // skip header

    i32 nLines = 0;
    while(getline(fIn, sLine)) {
        CAUTO iComma = sLine.find(',');
        if(iComma == string::npos) continue;

        const sv svDate(sLine.data(), iComma);
        const sv svPrice(sLine.data() + iComma + 1, sLine.size() - iComma - 1);

        const i32 idxDay = getDayIndexForYMD(svDate);
        if(idxDay < 0) continue;

        f64 fPrice = 0.0;
        from_chars(svPrice.data(), svPrice.data() + svPrice.size(), fPrice);

        data.arrPrices[idxDay] = fPrice;
        data.arrDayIdx[idxDay] = idxDay;
        ++nLines;
    }

    DEBUG_LOG("loadOneYear: %s — %d data lines", sPath.c_str(), nLines);

    fillGaps(data);
    return data;
}

// Scan OPFS for all available year CSVs for a stock, load each one.
// Skips .nodata sentinel files.
TYearDataMap loadYearData(cstr& sSymbol) {
    TYearDataMap mapData;

    cstr sPrefix = sSymbol + ".NS_";
    cstr sDir = STOCKS_DIR;

    DEBUG_LOG("loadYearData: scanning %s for prefix %s", sDir.c_str(), sPrefix.c_str());

    if(!fs::exists(sDir)) {
        DEBUG_LOG("loadYearData: directory %s does not exist", sDir.c_str());
        return mapData;
    }

    for(CAUTOREF entry : fs::directory_iterator(sDir)) {
        if(!entry.is_regular_file()) continue;

        cstr sName = entry.path().filename().string();

        if(sName.ends_with(".nodata")) continue;
        if(!sName.starts_with(sPrefix) || !sName.ends_with(".csv")) continue;

        cstr sYear = sName.substr(sPrefix.size(), sName.size() - sPrefix.size() - 4);
        const i32 nYear = stoi(sYear);

        TYearData yearData = loadOneYear(sSymbol, nYear);

        if(yearData.arrDayIdx[0] != -1)
            mapData[nYear] = std::move(yearData);
    }

    DEBUG_LOG("loadYearData: loaded %d years for %s", (i32)mapData.size(), sSymbol.c_str());
    return mapData;
}

// Parse a single year CSV from a string (Date,Close format).
// Same logic as loadOneYear but reads from memory instead of a file.
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

// ---------------------------------------------------------------------------
// Computation utilities
// ---------------------------------------------------------------------------

// Fetch gain fraction for a given range and price array
f64 getGain(CREF(TPrices) arrPrices, CREF(TWindow) window) {
    return (arrPrices[window.iEnd] / arrPrices[window.iBeg]) - 1.0;
}

// Compute averaged normalized price curve from the most recent nYears.
TPrices computeAvgCurve(CREF(TYearDataMap) mapYearData, const i32 nYears) {
    TPrices priceSum(0.0, DAYS);

    i32 nCount = 0;
    for(auto it = mapYearData.rbegin(); it != mapYearData.rend() && nCount < nYears; ++it) {
        CAUTOREF arrPrices = it->second.arrPrices;
        if(arrPrices[0] == 0.0) continue;
        priceSum += (arrPrices / arrPrices[0]);
        ++nCount;
    }

    if(nCount == 0) return TPrices(0.0, DAYS);
    return priceSum / nCount;
}

// Given a range and an array of prices, and max and min window size,
// finds the window where there is maximum daily gain
TWindow findBestRange(CREF(TPrices) arrAvgCurve, const i32 iBeg, const i32 iEnd, CREF(TPlanParams) params) {
    TWindow ret{-1, -1, 0.0};
    if(const i32 nSize = iEnd - iBeg; nSize >= params.nWinMin) {
        f64 fDailyGainMax = 0.0;

        FORLE(nWin, params.nWinMin, params.nWinMax) {
            const i32 nSlides = nSize - nWin;
            FORLE(i, 0, nSlides) {
                TWindow window{iBeg + i, iBeg + i + nWin};
                CAUTO fDailyGain = getGain(arrAvgCurve, window) / nWin;

                if(fDailyGain > fDailyGainMax) {
                    fDailyGainMax = fDailyGain;
                    ret = window;
                    ret.fGain = fDailyGainMax;
                }
            }
        }
    }
    return ret;
}

// Gets best trading windows recursively
void findBestRanges(CREF(TPrices) arrAvgCurve, const i32 iBeg, const i32 iEnd, CREF(TPlanParams) params, TWindows& arrWindows) {
    const TWindow r = findBestRange(arrAvgCurve, iBeg, iEnd, params);
    if(r.iBeg != -1) {
        arrWindows.push_back(r);
        findBestRanges(arrAvgCurve, iBeg, r.iBeg, params, arrWindows);
        findBestRanges(arrAvgCurve, r.iEnd, iEnd, params, arrWindows);
    }
}

// Discover non-overlapping trade windows from the avg curve
TWindows findWindows(CREF(TPrices) arrAvgCurve, CREF(TPlanParams) params) {
    TWindows arrWindows;
    if(arrAvgCurve[0] == 0.0) return arrWindows;
    findBestRanges(arrAvgCurve, 0, DAYS - 1, params, arrWindows);
    return arrWindows;
}

// ---------------------------------------------------------------------------
// Per-window statistics
// ---------------------------------------------------------------------------

vint getMostRecentYears(CREF(TYearDataMap) dctYearData, const i32 nYears) {
    vint arrYears;
    i32 nCount = 0;
    for(auto it = dctYearData.rbegin(); it != dctYearData.rend() && nCount < nYears; ++it) {
        if(it->second.arrPrices[0] == 0.0) continue;
        arrYears.push_back(it->first);
        ++nCount;
    }
    return arrYears;
}


// Compute the stats for each window across each year and also the average
TWindowStats computeWindowStats(CREF(TWindows) arrWindows, CREF(TYearDataMap) mapYearData,
                                 CREF(vint) arrYears, CREF(TPlanParams) params) {
    TWindowStats arrStats;

    // Iterate each window for this stock
    for(CAUTOREF window : arrWindows) {
        TWindowStat stat;
        stat.iBeg = window.iBeg;
        stat.iEnd = window.iEnd;

        f64 fSum = 0.0;
        i32 nWins = 0;
        f64 fWinSum = 0.0, fLossSum = 0.01;

        // For every year specified
        for(CAUTO nYear : arrYears) {
            CAUTO it = mapYearData.find(nYear);
            if(it == mapYearData.end()) continue;

            CAUTO fGain = getGain(it->second.arrPrices, window) * 100.0;
            stat.arrYearGains.push_back(fGain);
            fSum += fGain;

            if(fGain > 0.0) {
                ++nWins;
                fWinSum += fGain;
            } else {
                fLossSum += fGain;
            }
        }

        if(CAUTO nCount = static_cast<i32>(stat.arrYearGains.size())) {
            stat.pctWin       = static_cast<f64>(nWins) / nCount * 100.0;
            stat.pctExpected  = fSum / nCount;
            stat.fProfitRatio = fWinSum / -fLossSum;
            if(stat.pctWin >= params.pctThreshold) {
                arrStats.push_back(std::move(stat));
            }
        }

    }

    ranges::sort(arrStats, [](CREF(TWindowStat) a, CREF(TWindowStat) b) { return a.iBeg < b.iBeg; });
    return arrStats;
}

// ---------------------------------------------------------------------------
// CBasket
// ---------------------------------------------------------------------------

void recompute(TPlan& plan) {
    plan.m_arrYears      = getMostRecentYears(plan.m_mapYearData, plan.m_params.nYears);
    plan.m_arrAvgCurve   = computeAvgCurve(plan.m_mapYearData, plan.m_params.nYears);
    plan.m_arrWindows    = findWindows(plan.m_arrAvgCurve, plan.m_params);
    plan.m_arrWindowStats = computeWindowStats(plan.m_arrWindows, plan.m_mapYearData,
                                                plan.m_arrYears, plan.m_params);
}

void CBasket::addStock(cstr& sSymbol, CREF(TPlanParams) params) {
    DEBUG_LOG("CBasket::addStock: %s", sSymbol.c_str());

    if(m_dctPlanForStock.contains(sSymbol)) {
        setParams(sSymbol, params);
        return;
    }

    TPlan plan;
    plan.m_params      = params;
    plan.m_mapYearData = loadYearData(sSymbol);
    recompute(plan);

    DEBUG_LOG("CBasket::addStock: %s — %d years, %d windows, %d stats",
              sSymbol.c_str(), (i32)plan.m_arrYears.size(),
              (i32)plan.m_arrWindows.size(), (i32)plan.m_arrWindowStats.size());

    m_dctPlanForStock[sSymbol] = std::move(plan);
    m_arrStocks.push_back(sSymbol);
}

void CBasket::loadCsv(cstr& sSymbol, i32 nYear, cstr& sCsv) {
    auto& plan = m_dctPlanForStock[sSymbol];

    TYearData yearData = parseOneCsv(sCsv);
    if(yearData.arrDayIdx[0] != -1) {
        plan.m_mapYearData[nYear] = std::move(yearData);
        DEBUG_LOG("CBasket::loadCsv: %s year=%d — loaded OK", sSymbol.c_str(), nYear);
    } else {
        DEBUG_LOG("CBasket::loadCsv: %s year=%d — no valid data", sSymbol.c_str(), nYear);
    }
}

void CBasket::compute(cstr& sSymbol, CREF(TPlanParams) params) {
    CAUTO it = m_dctPlanForStock.find(sSymbol);
    if(it == m_dctPlanForStock.end()) return;

    auto& plan = it->second;
    plan.m_params = params;
    recompute(plan);

    DEBUG_LOG("CBasket::compute: %s — %d years, %d windows, %d stats",
              sSymbol.c_str(), (i32)plan.m_arrYears.size(),
              (i32)plan.m_arrWindows.size(), (i32)plan.m_arrWindowStats.size());
}

void CBasket::removeStock(cstr& sSymbol) {
    m_dctPlanForStock.erase(sSymbol);
    std::erase(m_arrStocks, sSymbol);
}

void CBasket::setParams(cstr& sSymbol, CREF(TPlanParams) params) {
    CAUTO it = m_dctPlanForStock.find(sSymbol);
    if(it == m_dctPlanForStock.end()) return;

    auto& plan = it->second;
    plan.m_params = params;
    recompute(plan);
}

CREF(TWindows) CBasket::getWindows(cstr& sSymbol) const {
    static const TWindows empty;
    CAUTO it = m_dctPlanForStock.find(sSymbol);
    if(it == m_dctPlanForStock.end()) return empty;
    return it->second.m_arrWindows;
}

CREF(TWindowStats) CBasket::getWindowStats(cstr& sSymbol) const {
    static TWindowStats empty;
    CAUTO it = m_dctPlanForStock.find(sSymbol);
    if(it == m_dctPlanForStock.end()) return empty;
    return it->second.m_arrWindowStats;
}

CREF(vint) CBasket::getYears(cstr& sSymbol) const {
    static vint empty;
    CAUTO it = m_dctPlanForStock.find(sSymbol);
    if(it == m_dctPlanForStock.end()) return empty;
    return it->second.m_arrYears;
}

// ---------------------------------------------------------------------------
// getGraphData — normalized B&H curves for charting
// ---------------------------------------------------------------------------
// nYear = how many most-recent years to include (graph display count,
//         independent of per-stock TPlanParams.nYears used for stats).
// For each stock × year: normalize = (price[d] / price[0]) - 1.0
// "average" key = mean of that stock's per-year curves.
// basketAvg = equal-weight mean across stocks with data for each year.
// Stocks missing data for a year are skipped (remaining get equal share).

TGraphData CBasket::getGraphData(i32 nYears) const {
    TGraphData result;

    // 1. Gather years: iterate from (current-1) downward, take nYears
    const i32 iLastYear = getCurYear() - 1;
    for(i32 iYear = iLastYear; iYear > iLastYear - nYears; --iYear) {
        result.arrYears.push_back(iYear);
    }

    // 2. Outer loop: stocks. Inner loop: years.
    for(CAUTOREF [sSymbol, plan] : m_dctPlanForStock) {
        result.arrStocks.push_back(sSymbol);
        TYearCurve curves;

        for(CAUTO iYear : result.arrYears) {
            CAUTO itYearData = plan.m_mapYearData.find(iYear);
            if(itYearData == plan.m_mapYearData.end()) continue;

            CAUTOREF arrPrices = itYearData->second.arrPrices;
            if(arrPrices[0] == 0.0) continue;

            // Normalize prices so start is 0 and +1 means 100%
            TPrices arrPricesNormalized = (arrPrices / arrPrices[0]) - 1.0;

            // Represents the current value during the plan
            // fGain = capital multiplier (1.0 = break even, 1.05 = +5%)
            // arrHoldings stores fGain - 1.0 so graph starts at 0
            TPrices arrHoldings = TPrices(0.0, DAYS);

            double fGain = 1.0;
            i32 iLastEnd = 0;
            for(CAUTOREF stat: plan.m_arrWindowStats) {
                // Outside window: flat at current gain
                for(i32 i = iLastEnd; i < stat.iBeg; ++i) arrHoldings[i] = fGain - 1.0;

                // Window return using raw prices (not normalized) for correct ratio
                const auto fRatio = arrPrices[stat.iEnd] / arrPrices[stat.iBeg];
                const auto fRatioAfterFees = fRatio * (1 - RATE_FEE) / (1 + RATE_FEE);
                const auto fGainExit = fGain * fRatioAfterFees;

                // Ramp linearly inside window
                const i32 nDays = stat.iEnd - stat.iBeg;
                for(i32 i = stat.iBeg; i <= stat.iEnd; ++i) {
                    const double t = static_cast<double>(i - stat.iBeg) / nDays;
                    arrHoldings[i] = fGain + t * (fGainExit - fGain) - 1.0;
                }

                fGain = fGainExit;
                iLastEnd = stat.iEnd + 1;
            }

            // Flat after last window
            for(i32 i = iLastEnd; i < DAYS; ++i) arrHoldings[i] = fGain - 1.0;

            // Tax only on profit (fGain > 1.0)
            if(fGain > 1.0) {
                const auto fAfterTax = 1.0 + (fGain - 1.0) * (1 - RATE_TAX);
                arrHoldings[DAYS - 1] = fAfterTax - 1.0;
            }

            cstr sYearKey = to_string(iYear);
            curves[sYearKey] = std::move(arrPricesNormalized);
            // TODO: store arrHoldings as plan curve (phase 2)
        }

        // TODO: compute "average" curve across available years

        result.arrPerStock.push_back(std::move(curves));
    }

    // TODO: compute basketAvg per year + "average"

    return result;
}
