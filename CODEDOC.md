# Meguru — Code Documentation

This document describes the internal architecture, module responsibilities,
data flow, and key design decisions for the Meguru codebase.

See `README.md` for user-facing features and setup instructions.
See `CPP_STYLE.md` for naming conventions used throughout both the C++ and JS layers.

---

## Repository Layout

```
meguru/
├── README.md                  User-facing documentation
├── CODEDOC.md                 This file
├── CPP_STYLE.md               Naming-convention guide (applies to C++ and JS)
├── engine/                    CLion project — C++23 engine
│   ├── CMakeLists.txt         Dual build: native EXE + Emscripten WASM ES module
│   └── src/
│       ├── types.h            All domain types (aliases, structs, enums)
│       ├── engine.h           IBasket abstract interface
│       ├── basket.h / .cpp    CBasket concrete implementation
│       ├── plan.h / .cpp      Per-stock plan computation
│       ├── stockdata.h        In-memory CSV store (WASM path)
│       ├── utils.h / .cpp     CSV parsing, date helpers
│       ├── tradecalendar.h/cpp  Trade-calendar CSV export
│       ├── verifycsv.h / .cpp   Backtest verification CSV export
│       ├── bindings.cpp       Emscripten embind entry point
│       └── main.cpp           Native test harness (non-WASM build only)
└── web/                       WebStorm project — Vite + Preact frontend
    ├── package.json           Vite 6, Preact, Chart.js
    ├── vite.config.js         Preact preset, dev port 3000
    ├── index.html             Root HTML — mounts #app
    ├── .env.example           VITE_WORKER_URL config
    ├── public/
    │   ├── wasm/              meguru.js + meguru.wasm (Emscripten output, checked in)
    │   ├── baskets/           Example basket JSON presets
    │   └── nse_stocks.json    2,586 NSE symbols bundled for the stock-search dropdown
    ├── src/
    │   ├── data/
    │   │   ├── yahoo.js       Yahoo Finance fetch — one year at a time via CORS proxy
    │   │   ├── storage.js     OPFS read/write — per-year CSV files + .nodata sentinels
    │   │   └── fetch.js       High-level ensureStockData() — scans cache, fills gaps
    │   ├── wasm/
    │   │   └── engine.js      WASM wrapper singleton — loads module, feeds CSV, calls engine
    │   ├── util/
    │   │   └── metrics.js     calcQuality() — JS port of the C++ quality score
    │   └── ui/
    │       ├── App.jsx         Root component — all state, engine calls, basket lifecycle
    │       ├── BasketList.jsx  Left sidebar — stock tiles, accordion sliders, add/remove
    │       ├── BasketGraph.jsx Graph panel — Chart.js, allocation bar, view/year controls
    │       ├── StatsPanel.jsx  Bottom panel — per-stock window table / basket summary table
    │       ├── FetchModal.jsx  Progress modal during Yahoo data download
    │       ├── NewStockModal.jsx  Stock-search + initial-params modal
    │       ├── SearchableDropdown.jsx  Reusable autocomplete widget
    │       ├── HelpModal.jsx   Tabbed help / documentation modal
    │       ├── utils.js        getBasketColors() — golden-angle hue rotation
    │       └── styles.css      Complete dark theme (~1 100 lines)
    └── worker/
        ├── index.js           Cloudflare Worker — CORS proxy for Yahoo Finance
        └── wrangler.jsonc     Wrangler v4 deploy config
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                  Browser (single page)                  │
│                                                         │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────┐ │
│  │ Preact   │  │  engine.js   │  │  data/            │ │
│  │ UI layer │◄─┤  WASM wrapper│  │  storage.js (OPFS)│ │
│  │ (App.jsx)│  │  singleton   │  │  fetch.js         │ │
│  └──────────┘  └──────┬───────┘  │  yahoo.js         │ │
│                        │         └────────┬──────────┘ │
│                        │                  │             │
│               ┌────────▼──────────┐       │             │
│               │  meguru.wasm      │       │             │
│               │  (C++23 engine)   │       │             │
│               │  · CBasket        │       │             │
│               │  · plan.cpp       │       │             │
│               │  · basket.cpp     │       │             │
│               └───────────────────┘       │             │
│                                           │             │
│           OPFS /stocks/*.csv ◄────────────┘             │
└──────────────────────────────────────────┬──────────────┘
                                           │ fetch
                              ┌────────────▼──────────────┐
                              │  Cloudflare Worker         │
                              │  CORS proxy → Yahoo Finance│
                              └───────────────────────────┘
```

Key constraints:
- No backend server — everything runs client-side.
- The WASM module is a **single-threaded, synchronous** ES module. Heavy
  operations (optimize stock, optimize allocation) block the main thread;
  App.jsx paints an overlay before calling them via `setTimeout(..., 30)` so
  the overlay renders first.
- OPFS is accessed from the main thread via the async File System Access API
  (no Worker required, no WasmFS/pthreads).

---

## C++ Engine

### Build targets (`engine/CMakeLists.txt`)

| Target | Command | Output |
|---|---|---|
| WASM ES module | `emcmake cmake .. && make` | `meguru.js` + `meguru.wasm` |
| Native debug EXE | `cmake .. && make` | `meguru` |

Both share the same source files; `bindings.cpp` is WASM-only;
`main.cpp` is native-only.

Emscripten flags of note:
- `--bind` — embind C++→JS bridge
- `-sEXPORT_ES6=1 -sMODULARIZE=1` — output is an ES module with a default
  factory `createEngine()`
- `-sALLOW_MEMORY_GROWTH=1` — heap can grow as more stocks are loaded
- `-sASSERTIONS=2` — detailed abort messages during development
- `-DMEGURU_DEBUG=ON` (optional) — enables `DEBUG_LOG()` macros that
  `printf` to `console.log` in the browser

### `types.h` — Domain types

All fundamental aliases and data structures live here.

| Type | Description |
|---|---|
| `TPrices` | `valarray<f64>` of 366 elements — one value per day-of-year |
| `TDayIndices` | `vector<i32>` (366) mapping each slot to a real trading day |
| `TYearData` | One year: `TPrices arrPrices` + `TDayIndices arrDayIdx` (both backfilled for weekend/holiday gaps) |
| `TYearDataMap` | `map<i32, TYearData>` — all cached years for a stock |
| `TPlanParams` | Per-stock search parameters: `nYears`, `nWinMin`, `nWinMax`, `pctThreshold` |
| `TWindow` | A candidate trade window: `iBeg`, `iEnd`, `fGain` |
| `TWindowStat` | Stats for one surviving window: win%, expected return, profit ratio, per-year gains |
| `EAllocMode` | `Equal=0 | Return=1 | Custom=2` |
| `TGraphData` | Full result from `getGraphData()` — see below |

`DAYS = 366` — all years are treated as leap years so day-of-year indices are
stable across years. Day index 59 (Feb 29) is always present; non-leap years
have it backfilled with the next real trading day's price.

### `engine.h` — `IBasket` interface

Abstract base class defining the public contract:

```cpp
addStock(sSymbol, params)       // load data, compute plan
removeStock(sSymbol)            // purge cached data
setParams(sSymbol, params)      // recompute plan with new params
getWindows(sSymbol)             // raw discovered windows
getWindowStats(sSymbol)         // filtered stats (threshold-passing windows)
getYears(sSymbol)               // year list used, most-recent-first
```

### `plan.h / plan.cpp` — Plan computation

The core algorithmic layer. All functions are pure (no side effects on shared
state) except `updatePlan()`.

**Pipeline** (called by `updatePlan`):

1. `getMostRecentYears()` — selects the `nYears` most recent years that have
   valid data.
2. `computeAvgCurve()` — builds a 366-element normalized price curve averaged
   across those years. Normalization: `price[d] / price[0]`.
3. `findWindows()` / `findBestRanges()` / `findBestRange()` — recursive scan
   over `[nWinMin, 180]` windows, keeping the highest avg-daily-gain,
   non-overlapping set.
4. `computeWindowStats()` — for each discovered window, computes win%,
   expected return, and profit ratio across all sample years. Windows that
   fail the `fPctWin` threshold are dropped.
5. `calcPlanGains()` — given the surviving window stats and one year's actual
   prices, produces a 366-element plan-equity curve (starting at 0%). Applies
   a fee rate per window and STCG tax on net profit.

**`computeAvgPlanCurve()`** — averages `calcPlanGains()` across years.
Used by the optimizer and `getGraphData(key=0)`.

**`calcQuality()`** — C++ port of `metrics.js calcQuality()`:
```
efficiency = mean(plan) / (mean(bh) × daysFrac)
downside   = sqrt(mean(min(plan_y, 0)²))
penalty    = 1 / (1 + 3 × downside)
quality    = efficiency × penalty
```
Higher is better; can exceed 1.0 (plan beats expected).

### `basket.h / basket.cpp` — `CBasket`

Concrete `IBasket` with:

- `m_dctPlanForStock` — `map<str, TPlan>` holding all per-stock computed state.
- `m_arrStocks` — insertion-ordered stock list (matches JS `state.stocks` order).
- `m_setHidden` — stocks excluded from basket aggregation (weight = 0).
- `m_eAllocMode` / `m_arrCustomWeights` — current allocation.

**`getGraphData(nYear)`** — the main query called on every UI refresh:

Returns `TGraphData` containing:
- `arrYears` — the `nYear` most-recent calendar years.
- `dctReturnsPerStockPlan` / `dctReturnsPerStockHold` — `symbol → year → 366 values`.
  Key `0` = multi-year average.
- `dctReturnsForBasket` — weighted aggregate across visible stocks.
- `dctWeightsPerStock` — effective weights after renormalizing for missing-data
  years (some stocks have no data for early years).
- `dctDaysInMarket` — fraction of trading year covered by plan windows per stock.

**Optimizers:**

- `optimizeStockParams(symbol)` — grid search over `(nWinMin, fPctWin)` pairs,
  maximising the last-day value of `computeAvgPlanCurve()`. ~8 000 iterations;
  synchronous; `nYears` and `nWinMax` are preserved.
- `optimizeAllocation()` — grid search over weight vectors summing to 100,
  step = 5% for ≤5 stocks, 10% for >5. Maximises basket plan return weighted
  by per-stock quality. Switches engine to `Custom` mode with the winner.

### `bindings.cpp` — Emscripten embind

Owns a single `static CBasket g_basket` instance (the entire engine state).
Exposes JS-callable free functions via `EMSCRIPTEN_BINDINGS(meguru)`:

| JS name | C++ function | Notes |
|---|---|---|
| `storeCsv(path, csv)` | `jsStoreCsv` | Feed one year of CSV to the in-memory store before `addStock` |
| `addStock(sym, nYears, nWinMin, nWinMax, pct)` | `jsAddStock` | Load data + compute |
| `removeStock(sym)` | `jsRemoveStock` | |
| `setParams(sym, ...)` | `jsSetParams` | Recompute with new params |
| `getStockDetail(sym)` | `jsGetStockDetail` | Returns native `val` object with years + window stats |
| `getGraphData(nYear)` | `jsGetGraphData` | Returns native `val` object (no JSON string) |
| `setAlloc(mode, weights[])` | `jsSetAlloc` | |
| `exportVerifyCsv(year)` | `jsExportVerifyCsv` | Returns CSV string |
| `exportTradeCalendarCsv()` | `jsExportTradeCalendarCsv` | Returns CSV string |
| `optimizeStockParams(sym)` | `jsOptimizeStockParams` | Returns `{nYears, nWinMin, nWinMax, pctThreshold}` |
| `optimizeAllocation()` | `jsOptimizeAllocation` | Returns weight array |
| `setStockVisible(sym, bool)` | `jsSetStockVisible` | |

### `stockdata.h` — In-memory CSV store

`TStockData` is a simple `map<str, str>` keyed by
`"SYMBOL.NS_YYYY.csv"`. JS populates it via `storeCsv()` before calling
`addStock()`. The `load()` method on `TStockData` reads from this map in WASM
builds (instead of the filesystem as in native builds).

### `verifycsv.cpp`, `tradecalendar.cpp`

Two standalone export modules that take `const CBasket&` and produce CSV
strings. Both called from `bindings.cpp`.

- `exportVerifyCsv(basket, year)` — day-by-day plan vs B&H for verification
  in a spreadsheet.
- `exportTradeCalendarCsv(basket)` — `MM-DD, STOCK, BUY|SELL` rows for all
  plan window edges (year-agnostic).

---

## JavaScript / Frontend

### `web/src/wasm/engine.js` — WASM wrapper singleton

Loads `meguru.wasm` lazily on first call to `initEngine()`.

**WASM loading quirk:** Vite 6 blocks `import()` of JS files from `public/`.
The workaround: `fetch()` `meguru.js` as text, create a `Blob` URL, and
`import()` that. `locateFile` overrides point Emscripten at the correct `.wasm`
path.

**`_feedStockData(symbol)`** — reads all years for a symbol from OPFS via
`storage.js`, calls `module.storeCsv(path, csv)` for each, then returns the
count of years loaded. Called inside `addStock()` before `module.addStock()`.

The wrapper object exports the same logical interface as the old mock engine so
`App.jsx` is decoupled from the module format.

### `web/src/data/storage.js` — OPFS layer

All reads and writes go through `navigator.storage.getDirectory()` → `stocks/`
subdirectory.

| Function | Description |
|---|---|
| `writeStockYear(sym, year, csv)` | Write `SYMBOL.NS_YEAR.csv` |
| `writeNoData(sym, year)` | Write empty `SYMBOL.NS_YEAR.nodata` sentinel |
| `hasStockYear(sym, year)` | Check for CSV existence |
| `hasNoData(sym, year)` | Check for `.nodata` sentinel |
| `getStockYears(sym)` | List all years with CSV data (descending) |
| `readStockYear(sym, year)` | Read and return CSV string or null |

File naming mirrors the native C++ convention so paths are identical on both
sides of the WASM boundary.

### `web/src/data/fetch.js` — `ensureStockData()`

High-level orchestrator called when adding or loading a stock:

1. Scans OPFS for the last 25 years — counts cached, collects missing.
2. If nothing is missing, returns immediately (instant subsequent loads).
3. Calls `fetchYears()` (from `yahoo.js`) for all missing years, streaming
   progress via an `onProgress` callback.
4. Writes each year's CSV or `.nodata` sentinel to OPFS.
5. Returns the total count of data years available.

Progress phases: `'scanning' | 'cached' | 'fetching' | 'done'`

### `web/src/data/yahoo.js` — Yahoo Finance fetch

- Endpoint: `GET /chart/SYMBOL.NS?period1=…&period2=…&interval=1d` on the
  Cloudflare Worker proxy.
- Parses `chart.result[0].timestamp[]` and `.indicators.quote[0].close[]`
  into a `Date,Close` CSV string.
- Rate-limits at 1 s between years; handles HTTP 429 (retry) and 400
  (no data for that year → `.nodata`).
- Three consecutive no-data years trigger an early stop (stock didn't exist
  before that point).

### `web/src/util/metrics.js` — Quality score (JS port)

`calcQuality(planReturns, benchmarkReturns, daysFrac)` computes the same
quality score as the C++ `calcQuality()` function. Used by `StatsPanel.jsx`
to display the quality figure for each stock and for the basket.

Formula:
```
efficiency = mean(plan) / max(|mean(bh) × daysFrac|, 0.01) × sign(mean(bh))
downside   = sqrt(mean(min(plan_y, 0)²))
penalty    = 1 / (1 + 3 × downside)
quality    = efficiency × penalty
```
When no benchmark is provided (single-stock view), returns
`mean(plan) × penalty × 10`.

---

## Preact UI (`web/src/ui/`)

All components are **class-based** (no hooks). See `CPP_STYLE.md` for
naming conventions.

### `App.jsx` — Root component

Owns all application state. Key state fields:

| Field | Type | Description |
|---|---|---|
| `stocks` | `string[]` | Insertion-ordered list of symbols |
| `stockData` | `{[sym]: {params, visible, color, allocPct, nDataYears}}` | Per-stock UI state |
| `selectedStock` | `string\|null` | Solo'd stock (others hidden) |
| `expandedStock` | `string\|null` | Accordion-open stock |
| `allocMode` | `'equal'\|'avgret'\|'custom'` | Current allocation mode |
| `viewMode` | `'line'\|'bar'` | Graph view |
| `selectedYear` | `number\|'Average'` | Year shown in line view |
| `displayYears` | `number` | How many years the bar chart covers |
| `basketResult` | `object\|null` | Raw `getGraphData()` result |
| `stockDetail` | `object\|null` | Raw `getStockDetail()` result |

**Persistence:** `localStorage` key `meguru_state` stores everything except
engine results and colors. Written with a 300 ms debounce on any change to the
persisted fields. Restored on mount via `_restoreState()`, which re-feeds the
WASM engine from OPFS.

**Add-stock flow (two phases):**

1. `handleAddStock(symbol, params)` — closes `NewStockModal`, opens
   `FetchModal` with `{sSymbol, params}`.
2. `handleFetchComplete(symbol, params, nDataYears)` — clamps `nYears` to
   available data, calls `engine.addStock()`, updates state, then immediately
   calls `handleOptimize(symbol)` to auto-tune the new stock's parameters.

**Param change debouncing:** `handleParamChange()` updates React state
immediately (sliders stay responsive), then coalesces engine recomputation to
the next animation frame via `requestAnimationFrame`. Multiple fast slider
movements within a single frame produce one engine call.

**Allocation custom mode:** `pushCustomWeightsToEngine()` builds a normalized
weight vector from `stockData[s].allocPct` and passes it to
`engine.setAllocMode('custom', normalized)`. Hidden stocks contribute weight 0;
visible weights are renormalized to sum to 1.

### `BasketGraph.jsx`

Wraps a `<canvas>` managed by Chart.js. Renders in two modes:

- **Line** — single year (or average) daily equity curve: plan vs B&H.
  Trade-window rectangles overlaid for the selected stock.
- **Bar** — one stacked bar per year showing per-stock plan return
  contributions, with a separate B&H bar.

Also renders the allocation bar (vertical bar left of the chart) with
drag-handle buttons in custom mode.

### `BasketList.jsx`

Left sidebar. Each stock tile shows:
- Colored dot (visibility toggle)
- Symbol name (click to solo)
- 💡 optimize button
- ✕ remove button
- ▶ expand button → accordion with three sliders

### `StatsPanel.jsx`

Bottom panel (~20% height). Shows:
- **Stock selected:** table of trade windows with Day Range, Win%, Expected%,
  %/day, Profit Ratio, and per-year gains.
- **No selection:** basket summary — per-stock Plan Return, B&H Return,
  Days In Market, Plan Quality.

### `FetchModal.jsx`

Progress modal shown while downloading Yahoo data. Streams updates from
`ensureStockData()`. Supports cancellation via `AbortController`.

### `NewStockModal.jsx`

Stock-search modal backed by `public/nse_stocks.json` (2 586 entries).
Uses `SearchableDropdown.jsx` for autocomplete. Sets initial params which
are then auto-optimized after fetch completes.

### `HelpModal.jsx`

Tabbed documentation modal. Content is the canonical source for `README.md`.
Tabs: Intro, Quick Start, Parameters, Allocation, Optimizers, Graph, Exports,
Glossary, Methodology.

---

## Cloudflare Worker (`web/worker/index.js`)

A minimal CORS proxy:

```
GET /chart/{TICKER}?period1=…&period2=…&interval=1d
  → GET https://query2.finance.yahoo.com/v8/finance/chart/{TICKER}?…
```

Adds `Access-Control-Allow-Origin: *` to all responses. Required because
Yahoo Finance does not serve CORS headers to browser requests.

Config: `web/worker/wrangler.jsonc` (Wrangler v4).

---

## Data Flow: Adding a Stock End-to-End

```
User clicks Add Stock
        │
        ▼
NewStockModal → symbol + initial params
        │
        ▼  handleAddStock()
FetchModal opens
        │
        ▼  ensureStockData(symbol, onProgress)
        │   ├── hasStockYear() × 25  [OPFS scan]
        │   ├── fetchYears() for missing years
        │   │     └── GET /chart/SYMBOL.NS?...  [Cloudflare Worker]
        │   │           └── parse JSON → CSV string
        │   │               └── writeStockYear() / writeNoData()  [OPFS]
        │   └── returns nTotalYears
        │
        ▼  handleFetchComplete(symbol, params, nDataYears)
        │   ├── clamp params.nYears to nDataYears
        │   ├── engine.addStock(symbol, params)
        │   │     └── _feedStockData(symbol)
        │   │           └── getStockYears() → readStockYear() × N  [OPFS]
        │   │               └── module.storeCsv(path, csv)  [→ TStockData in C++]
        │   │           └── module.addStock(sym, ...)  [→ CBasket.addStock()]
        │   │               └── updatePlan()  [avg curve → windows → stats]
        │   └── handleOptimize(symbol)  [grid search over params]
        │
        ▼
refreshAll() → getGraphData() + getStockDetail() → setState → re-render
```

---

## Key Constants and Magic Numbers

| Constant | Value | Location | Meaning |
|---|---|---|---|
| `DAYS` | 366 | `types.h` | Day-of-year slots per year |
| `nWinMax` | 180 | JS layer / C++ optimizer | Maximum trade window length in days |
| `MAX_YEARS` | 25 | `fetch.js` | Years of price history downloaded |
| `K_DOWNSIDE` | 3 | `metrics.js` / `plan.cpp` | Quality downside penalty coefficient |
| `5%` | 5 | `App.jsx` | Allocation step size and minimum per-stock weight |
| `LS_KEY` | `'meguru_state'` | `App.jsx` | localStorage key for session persistence |
| `INIT_TIMEOUT_MS` | 10 000 | `App.jsx` | WASM load timeout (app stays usable on failure) |
| Optimizer step | 5% / 10% | `basket.cpp` | Allocation grid step: 5% for ≤5 stocks, 10% for >5 |
