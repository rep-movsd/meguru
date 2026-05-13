# Meguru — Code Map (How Parts Work)

This paper say where things are and what each piece do.

See `README.md` for how to use.
See `CPP_STYLE.md` for name rules (both C++ and JS parts follow same style).

---

## Where Files Live

```
meguru/
├── README.md                  How to use
├── CODEDOC.md                 This paper
├── CPP_STYLE.md               Name rules
├── engine/                    C++ brain (CLion project)
│   ├── CMakeLists.txt         Build recipe — make WASM blob OR normal computer program
│   └── src/
│       ├── types.h            All data shapes (numbers, structs, enums)
│       ├── engine.h           IBasket — what basket must be able to do
│       ├── basket.h / .cpp    CBasket — actual basket that does the things
│       ├── plan.h / .cpp      Per-stock window finding + math
│       ├── stockdata.h        Price CSV held in memory (WASM path)
│       ├── utils.h / .cpp     CSV reading, date helpers
│       ├── tradecalendar.h/cpp  Make trade calendar CSV
│       ├── verifycsv.h / .cpp   Make backtest check CSV
│       ├── bindings.cpp       Door between C++ and JavaScript (embind)
│       └── main.cpp           Test runner for native build only
└── web/                       JS frontend (WebStorm project)
    ├── package.json           Vite 6, Preact, Chart.js
    ├── vite.config.js         Build settings, port 3000
    ├── index.html             HTML shell, holds #app div
    ├── .env.example           Where to find Yahoo helper
    ├── public/
    │   ├── wasm/              meguru.js + meguru.wasm (built C++ brain, checked in)
    │   ├── baskets/           Example basket JSON files
    │   └── nse_stocks.json    2,586 NSE stock names for search box
    ├── src/
    │   ├── data/
    │   │   ├── yahoo.js       Ask Yahoo for one year of prices via helper
    │   │   ├── storage.js     Read/write price files in browser cave (OPFS)
    │   │   └── fetch.js       Big helper: check cave, grab missing years, store
    │   ├── wasm/
    │   │   └── engine.js      Load WASM blob, feed it CSV, call brain functions
    │   ├── util/
    │   │   └── metrics.js     Quality score math (copy of C++ version)
    │   └── ui/
    │       ├── App.jsx         Main component — holds all state, talks to brain
    │       ├── BasketList.jsx  Left bar — stock tiles, sliders, add/remove
    │       ├── BasketGraph.jsx Chart area — line/bar graph, alloc bar, controls
    │       ├── StatsPanel.jsx  Bottom — window table or basket summary
    │       ├── FetchModal.jsx  Download progress popup
    │       ├── NewStockModal.jsx  Search and pick stock popup
    │       ├── SearchableDropdown.jsx  Type-to-filter dropdown widget
    │       ├── HelpModal.jsx   Help popup with tabs
    │       ├── utils.js        Pick colors for stocks (golden angle spin)
    │       └── styles.css      Dark look (~1,100 lines)
    └── worker/
        ├── index.js           Cloudflare helper — pass Yahoo requests, add CORS
        └── wrangler.jsonc     Deploy settings for helper
```

---

## Big Picture

```
┌─────────────────────────────────────────────────────────┐
│                     Browser                             │
│                                                         │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────┐ │
│  │ Preact   │  │  engine.js   │  │  data/            │ │
│  │ buttons  │◄─┤  brain wrap  │  │  storage (OPFS)   │ │
│  │ (App.jsx)│  │  singleton   │  │  fetch.js         │ │
│  └──────────┘  └──────┬───────┘  │  yahoo.js         │ │
│                        │         └────────┬──────────┘ │
│                        │                  │             │
│               ┌────────▼──────────┐       │             │
│               │  meguru.wasm      │       │             │
│               │  C++ brain        │       │             │
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
                              │  Yahoo Finance proxy       │
                              └───────────────────────────┘
```

Important things to know:
- No server. All run in browser.
- WASM brain is **single thread, blocking**. Heavy work (optimize) freeze page.
  App draw spinner overlay first, then call brain via `setTimeout(..., 30)` so spinner actually show.
- Browser cave (OPFS) read from main thread via async API. No extra thread needed.

---

## C++ Brain

### Two ways to build (`engine/CMakeLists.txt`)

| What | How | Get |
|---|---|---|
| WASM blob for browser | `emcmake cmake .. && make` | `meguru.js` + `meguru.wasm` |
| Normal computer program for testing | `cmake .. && make` | `meguru` |

Same source files both ways. `bindings.cpp` only for WASM. `main.cpp` only for normal build.

Interesting build flags:
- `--bind` — embind makes C++ callable from JS
- `-sEXPORT_ES6=1 -sMODULARIZE=1` — output is ES module with factory `createEngine()`
- `-sALLOW_MEMORY_GROWTH=1` — heap grow when more stocks loaded
- `-sASSERTIONS=2` — good crash messages while building
- `-DMEGURU_DEBUG=ON` — turn on `DEBUG_LOG()` prints → go to browser console

### `types.h` — Data shapes

Everything important defined here.

| Type | What is |
|---|---|
| `TPrices` | 366 numbers (one per day of year) — `valarray<f64>` |
| `TDayIndices` | 366 ints — map each slot to real trading day (weekends filled forward) |
| `TYearData` | One year: prices + day indices, both 366 long |
| `TYearDataMap` | All years for one stock, keyed by year number |
| `TPlanParams` | Settings per stock: `nYears`, `nWinMin`, `nWinMax`, `pctThreshold` |
| `TWindow` | One candidate window: start day, end day, average daily gain |
| `TWindowStat` | One surviving window: win%, expected return, profit ratio, gains per year |
| `EAllocMode` | `Equal=0`, `Return=1`, `Custom=2` |
| `TGraphData` | Everything `getGraphData()` returns — see below |

`DAYS = 366` — every year treated as leap year so day numbers stay same across years.
Day 59 (Feb 29) always exists. Non-leap years: fill it with next real day price.

### `engine.h` — `IBasket` (what basket must do)

```cpp
addStock(sSymbol, params)       // load price data, find windows
removeStock(sSymbol)            // throw away stock and its data
setParams(sSymbol, params)      // change settings, redo window finding
getWindows(sSymbol)             // raw windows found
getWindowStats(sSymbol)         // windows that passed threshold filter
getYears(sSymbol)               // which years used, newest first
```

### `plan.h / plan.cpp` — Window finding math

Main thinking happens here. All functions are pure (no hidden state change) except `updatePlan()`.

**Steps** (run by `updatePlan`):

1. `getMostRecentYears()` — pick `nYears` most recent years with real data.
2. `computeAvgCurve()` — average price curve across those years, 366 points. Normalize: `price[d] / price[0]`.
3. `findWindows()` → `findBestRanges()` → `findBestRange()` — recursive scan, try all window sizes from `nWinMin` to 180. Keep best non-overlapping set by avg daily gain.
4. `computeWindowStats()` — for each found window: count win%, calc average return, calc profit ratio across all years. Drop windows that don't pass `fPctWin` threshold.
5. `calcPlanGains()` — given surviving windows + one year of real prices, produce 366-point equity curve. Apply fee per window, tax on net profit.

**`computeAvgPlanCurve()`** — average equity curve across years. Used by optimizer and graph average.

**`calcQuality()`** — quality score math:
```
efficiency = mean(plan) / (mean(bh) × daysFrac)
downside   = sqrt(mean(min(plan_y, 0)²))
penalty    = 1 / (1 + 3 × downside)
quality    = efficiency × penalty
```
Higher = better. Can go above 1.0 if plan beats fair expectation.

### `basket.h / basket.cpp` — `CBasket` (the real basket)

Holds:
- `m_dctPlanForStock` — map: stock name → all its computed stuff (`TPlan`).
- `m_arrStocks` — stock names in order added (must match JS `state.stocks` order).
- `m_setHidden` — stocks that are hidden (still computed, just not in basket total).
- `m_eAllocMode` / `m_arrCustomWeights` — how to split money.

**`getGraphData(nYear)`** — called on every screen refresh. Returns `TGraphData`:
- `arrYears` — `nYear` most recent calendar years.
- `dctReturnsPerStockPlan` / `dctReturnsPerStockHold` — per stock, per year, 366 values. Key `0` = average of all years.
- `dctReturnsForBasket` — weighted total across visible stocks.
- `dctWeightsPerStock` — actual weights used each year (renormalized when some stocks missing old data).
- `dctDaysInMarket` — what fraction of year each stock held.

**Optimizers:**

- `optimizeStockParams(symbol)` — try all `(nWinMin, fPctWin)` combos, pick one with best average plan return at last day. ~8,000 tries. Keeps `nYears` and `nWinMax` unchanged.
- `optimizeAllocation()` — try all weight splits (5% step if ≤5 stocks, 10% if more). Pick best basket return weighted by quality. Switch engine to Custom mode with winner.

### `bindings.cpp` — C++↔JS door

Holds one `static CBasket g_basket`. This is the whole brain state.
Makes these functions available to JavaScript:

| JS name | Does what |
|---|---|
| `storeCsv(path, csv)` | Feed one year CSV to memory before addStock |
| `addStock(sym, nYears, nWinMin, nWinMax, pct)` | Load + compute |
| `removeStock(sym)` | Delete stock |
| `setParams(sym, ...)` | Change settings, recompute |
| `getStockDetail(sym)` | Get years + window stats as JS object |
| `getGraphData(nYear)` | Get full graph data as JS object (no JSON string) |
| `setAlloc(mode, weights[])` | Set money split mode |
| `exportVerifyCsv(year)` | Get backtest CSV string |
| `exportTradeCalendarCsv()` | Get calendar CSV string |
| `optimizeStockParams(sym)` | Run optimizer, get best params |
| `optimizeAllocation()` | Run allocation optimizer, get weight array |
| `setStockVisible(sym, bool)` | Show/hide stock in basket total |

### `stockdata.h` — CSV memory store

`TStockData` = map of filename → CSV string. JS fills this via `storeCsv()` before calling `addStock()`. In WASM, engine reads from this map instead of from real files.

### `verifycsv.cpp`, `tradecalendar.cpp`

Two helper modules. Take `const CBasket&`, spit out CSV string.

- `exportVerifyCsv(basket, year)` — day by day, plan vs hold, for spreadsheet checking.
- `exportTradeCalendarCsv(basket)` — `MM-DD, STOCK, BUY/SELL` rows, works any year.

---

## JavaScript Parts

### `web/src/wasm/engine.js` — WASM loader

Load `meguru.wasm` once when `initEngine()` called first time.

**Tricky part:** Vite 6 won't let `import()` reach into `public/` folder.
Workaround: `fetch()` the JS file as text → make Blob URL → `import()` that.
Tell Emscripten where `.wasm` file is via `locateFile`.

**`_feedStockData(symbol)`** — read all year CSVs from browser cave → call `module.storeCsv()` for each → then call `module.addStock()`. Bridge between JS storage and C++ memory.

### `web/src/data/storage.js` — Browser cave (OPFS)

All price files live at `navigator.storage.getDirectory()` → `stocks/` folder.

| Function | Does |
|---|---|
| `writeStockYear(sym, year, csv)` | Save `SYMBOL.NS_YEAR.csv` |
| `writeNoData(sym, year)` | Save empty `SYMBOL.NS_YEAR.nodata` (marks year with no data) |
| `hasStockYear(sym, year)` | Check if CSV exists |
| `hasNoData(sym, year)` | Check if nodata marker exists |
| `getStockYears(sym)` | List years that have CSV, newest first |
| `readStockYear(sym, year)` | Get CSV text or null |

File names same as C++ native build. Both sides use same path format.

### `web/src/data/fetch.js` — `ensureStockData()`

Called when adding stock or loading saved basket:

1. Check browser cave for last 25 years. Count what's there, list what's missing.
2. If nothing missing: done, return count.
3. Call `fetchYears()` for missing years. Stream progress updates.
4. Write each year's CSV or nodata marker to cave.
5. Return total years available.

Progress words: `'scanning' | 'cached' | 'fetching' | 'done'`

### `web/src/data/yahoo.js` — Yahoo price grabber

- Ask `GET /chart/SYMBOL.NS?period1=…&period2=…&interval=1d` from Cloudflare helper.
- Parse timestamp array + close price array → `Date,Close` CSV lines.
- Wait 100ms between years (polite). Handle 429 (too fast, wait more). Handle 400 (no data year → nodata marker).
- 3 no-data years in a row → stop early (stock too old, didn't exist).

### `web/src/util/metrics.js` — Quality score

`calcQuality(planReturns, benchmarkReturns, daysFrac)` — same math as C++ version. Used in stats panel.

```
efficiency = mean(plan) / max(|mean(bh) × daysFrac|, 0.01) × sign(mean(bh))
downside   = sqrt(mean(min(plan_y, 0)²))
penalty    = 1 / (1 + 3 × downside)
quality    = efficiency × penalty
```
No benchmark given → `mean(plan) × penalty × 10`.

---

## Screen Parts (`web/src/ui/`)

All class-based. No hooks. See `CPP_STYLE.md`.

### `App.jsx` — Brain of UI

Has all state. Important fields:

| State | Type | What |
|---|---|---|
| `stocks` | `string[]` | Stock names in order added |
| `stockData` | `{[sym]: {params, visible, color, allocPct, nDataYears}}` | Per-stock settings and display stuff |
| `selectedStock` | `string\|null` | Solo'd stock (others hidden) |
| `expandedStock` | `string\|null` | Which stock has sliders open |
| `allocMode` | `'equal'\|'avgret'\|'custom'` | Money split mode |
| `viewMode` | `'line'\|'bar'` | Graph type |
| `selectedYear` | `number\|'Average'` | Year shown in line view |
| `displayYears` | `number` | How many years in bar chart |
| `basketResult` | `object\|null` | Last `getGraphData()` result |
| `stockDetail` | `object\|null` | Last `getStockDetail()` result |

**Save/restore:** `localStorage` key `meguru_state`. Save after 300ms quiet. On load: read state, re-feed WASM brain from cave.

**Add stock (two steps):**
1. `handleAddStock()` — close stock picker, open download progress popup.
2. `handleFetchComplete()` — clamp `nYears` to available data, tell brain to add stock, then immediately run optimizer on it.

**Slider trick:** `handleParamChange()` update UI state right away (slider feel instant). Coalesce actual brain call to next animation frame. Many fast slides → one brain call.

**Custom allocation push:** `pushCustomWeightsToEngine()` — take `allocPct` from each visible stock, normalize to sum=1, send to brain. Hidden stocks get weight 0.

### `BasketGraph.jsx`

Wraps Chart.js canvas. Two modes:

- **Line** — daily money curve for one year (or average). Plan vs hold-all-year. Colored rectangles show when stock held.
- **Bar** — stacked bars per year. Each stock color stacked. Buy-hold bar alongside.

Also draws allocation bar on left with +/- handles in custom mode.

### `BasketList.jsx`

Left sidebar. Each stock tile:
- Colored dot → hide/show
- Stock name → solo
- 💡 → run optimizer
- ✕ → remove
- ▶ → open sliders

### `StatsPanel.jsx`

Bottom strip. Two views:
- **Stock solo'd:** window table with day range, win%, return, profit ratio, per-year gains.
- **No stock solo'd:** basket table with plan return, hold return, days held, quality per stock.

### `FetchModal.jsx`

Download popup. Show progress from `ensureStockData()`. Can cancel with AbortController.

### `NewStockModal.jsx`

Search popup. 2,586 NSE names from bundled JSON. Autocomplete. After add → auto-optimize.

### `HelpModal.jsx`

Tabbed help popup. The content in here is source of truth for README.

---

## Cloudflare Helper (`web/worker/index.js`)

Tiny pass-through:

```
GET /chart/{TICKER}?...
  → GET https://query2.finance.yahoo.com/v8/finance/chart/{TICKER}?...
```

Add `Access-Control-Allow-Origin: *` to response. Browser would refuse to talk to Yahoo directly without this.

Config in `web/worker/wrangler.jsonc`.

---

## How Adding Stock Works, Step by Step

```
User click Add Stock
        │
        ▼
NewStockModal → pick symbol
        │
        ▼  handleAddStock()
FetchModal open (progress popup)
        │
        ▼  ensureStockData(symbol)
        │   ├── check cave for 25 years
        │   ├── fetch missing years from Yahoo via Cloudflare helper
        │   │     └── parse JSON → CSV text
        │   │         └── write to OPFS cave
        │   └── return total years found
        │
        ▼  handleFetchComplete()
        │   ├── clamp nYears to what we actually have
        │   ├── engine.addStock()
        │   │     └── read all CSVs from cave → storeCsv() to C++ memory
        │   │         └── C++ addStock() → updatePlan() → find windows
        │   └── handleOptimize() → grid search for best params
        │
        ▼
refreshAll() → getGraphData() + getStockDetail() → draw screen
```

---

## Magic Numbers

| Number | Value | Where | Why |
|---|---|---|---|
| `DAYS` | 366 | `types.h` | Slots per year (always leap-year sized) |
| `nWinMax` | 180 | JS + C++ optimizer | Longest window allowed (days) |
| `MAX_YEARS` | 25 | `fetch.js` | How many years of history to try grabbing |
| `K_DOWNSIDE` | 3 | `metrics.js` / `plan.cpp` | How hard bad years punish quality score |
| `5%` | 5 | `App.jsx` | Allocation click step and minimum per stock |
| `LS_KEY` | `'meguru_state'` | `App.jsx` | Browser save key |
| `INIT_TIMEOUT_MS` | 10,000 | `App.jsx` | Give up waiting for WASM after 10s (app still work) |
| Optimizer step | 5% or 10% | `basket.cpp` | 5% if ≤5 stocks, 10% if more |
