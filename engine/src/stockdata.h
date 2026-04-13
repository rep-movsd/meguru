#pragma once

#include "types.h"

// ---------------------------------------------------------------------------
// TStockData — in-memory store for CSV data.
//
// WASM path:  JS reads CSVs from OPFS → calls store(path, csv) → then
//             load(symbol) parses from m_dctData.
// Native path: load(symbol) reads CSV files directly from disk.
//
// Key format for m_dctData: "SYMBOL.NS_YYYY.csv" (same as filenames on disk).
// ---------------------------------------------------------------------------

// Forward-declare — defined in basket.cpp
TYearData parseOneCsv(cstr& sCsv);

class TStockData {
    map<str, str> m_dctData;   // path → raw CSV string

public:
    // Store a raw CSV string under the given key.
    // Called from JS/embind in the WASM path.
    void store(cstr& sPath, cstr& sCsv) {
        m_dctData[sPath] = sCsv;
        DEBUG_LOG("TStockData::store: %s (%d bytes)", sPath.c_str(), (i32)sCsv.size());
    }

    // Load all available year data for a stock symbol → TYearDataMap.
    // Delegates to platform-specific implementation.
    [[nodiscard]] TYearDataMap load(cstr& sSymbol) const;
};

#ifdef __EMSCRIPTEN__

// ---------------------------------------------------------------------------
// WASM: scan m_dctData for keys matching "SYMBOL.NS_YYYY.csv", parse each.
// ---------------------------------------------------------------------------

inline TYearDataMap TStockData::load(cstr& sSymbol) const {
    TYearDataMap mapData;
    cstr sPrefix = sSymbol + ".NS_";

    DEBUG_LOG("TStockData::load[WASM]: scanning m_dctData for prefix %s", sPrefix.c_str());

    for(CAUTOREF [sPath, sCsv] : m_dctData) {
        if(!sPath.starts_with(sPrefix) || !sPath.ends_with(".csv")) continue;

        // Extract year from "SYMBOL.NS_YYYY.csv"
        cstr sYear = sPath.substr(sPrefix.size(), sPath.size() - sPrefix.size() - 4);
        const i32 nYear = stoi(sYear);

        TYearData yearData = parseOneCsv(sCsv);
        if(yearData.arrDayIdx[0] != -1) {
            mapData[nYear] = std::move(yearData);
            DEBUG_LOG("TStockData::load[WASM]: %s year=%d OK", sSymbol.c_str(), nYear);
        }
    }

    DEBUG_LOG("TStockData::load[WASM]: %d years for %s", (i32)mapData.size(), sSymbol.c_str());
    return mapData;
}

#else

// ---------------------------------------------------------------------------
// Native: scan filesystem for SYMBOL.NS_YYYY.csv files, read and parse each.
// ---------------------------------------------------------------------------

namespace fs = std::filesystem;

constexpr const char* STOCKS_DIR = "stocks";

inline TYearDataMap TStockData::load(cstr& sSymbol) const {
    TYearDataMap mapData;
    cstr sPrefix = sSymbol + ".NS_";

    DEBUG_LOG("TStockData::load[native]: scanning %s for prefix %s", STOCKS_DIR, sPrefix.c_str());

    if(!fs::exists(STOCKS_DIR)) {
        DEBUG_LOG("TStockData::load[native]: directory %s does not exist", STOCKS_DIR);
        return mapData;
    }

    for(CAUTOREF entry : fs::directory_iterator(STOCKS_DIR)) {
        if(!entry.is_regular_file()) continue;

        cstr sName = entry.path().filename().string();
        if(sName.ends_with(".nodata")) continue;
        if(!sName.starts_with(sPrefix) || !sName.ends_with(".csv")) continue;

        cstr sYear = sName.substr(sPrefix.size(), sName.size() - sPrefix.size() - 4);
        const i32 nYear = stoi(sYear);

        // Read file into string, parse as CSV
        const str sPath = str(STOCKS_DIR) + "/" + sName;
        ifstream fIn(sPath);
        if(!fIn.is_open()) {
            DEBUG_LOG("TStockData::load[native]: FAILED to open %s", sPath.c_str());
            continue;
        }

        str sCsv((istreambuf_iterator<char>(fIn)), istreambuf_iterator<char>());
        TYearData yearData = parseOneCsv(sCsv);

        if(yearData.arrDayIdx[0] != -1) {
            mapData[nYear] = std::move(yearData);
            DEBUG_LOG("TStockData::load[native]: %s year=%d OK", sSymbol.c_str(), nYear);
        }
    }

    DEBUG_LOG("TStockData::load[native]: %d years for %s", (i32)mapData.size(), sSymbol.c_str());
    return mapData;
}

#endif
