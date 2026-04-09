# Meguru — Seasonal Stock Trading Terminal

## What This Is

A fully self-contained browser app for seasonal stock trading analysis. C++ engine compiled to WASM (stateful computation), no backend server, data stored in OPFS/IndexedDB, stock prices fetched via Cloudflare Worker CORS proxy, deployed as a static site.

The old project (`~/projects/meguru_old`) is reference only — it used Flask + esbuild. This is a ground-up rebuild.

## Architecture

```
Browser App (Vite + Preact)                       [web/]
├── UI Layer (Preact class components, Chart.js)
├── Mock Engine (web/src/wasm/engine.js) — synthetic data, will be replaced by real WASM
├── Data Layer
│   ├── Yahoo Fetch (web/src/data/yahoo.js) — fetches via Cloudflare Worker
│   └── OPFS Storage (web/src/data/storage.js) — per-year CSV files
└── Cloudflare Worker (web/worker/) — CORS proxy

C++ Engine                                         [engine/]
├── types.h — All C++ data types
├── engine.h — IEngine abstract class (reads OPFS directly)
└── main.cpp — Standalone test harness
```

## Key Design Decisions

- **UI framework**: Preact with **class-based components** (no hooks)
- **C++ engine**: Abstract class interface only in this repo — user implements the engine separately
- **UI-first approach**: Built with mock data, real engine connected later
- **OPFS for price data**: CSV files stored at `stocks/{SYMBOL}.NS_{YEAR}.csv` (and `.nodata` sentinels for years without data)
- **Engine reads OPFS directly**: JS fetches from Yahoo and writes to OPFS; C++ WASM engine reads from OPFS via Emscripten WasmFS mount
- **Missing year handling**: Engine backfills missing years with initial known price (flat line)
- **Single basket view** (no tabs): basket list left, graph right, stats panel bottom

## Naming Conventions

Both C++ and TypeScript/JSX follow the same style guide (`CPP_STYLE.md`):
- **Hungarian notation**: n=count, i=index, f=float, pct=percent, s=string, b=bool, p=pointer, arr=array, map=map, m_=member
- **Prefixes**: T=data types, C=concrete classes, I=interfaces
- **Macros** (C++ only): `FOR`, `FORLE`, `CREF(T)`, `CAUTOREF`, `CAUTO`
- **C++23 features**, `using namespace std`, `#pragma once`
- Reference code for C++ style: `/home/rep/projects/seasonal/`

## Project Structure

```
meguru/
├── PROJECT.md                    — This file
├── CPP_STYLE.md                  — C++ and TypeScript style guide
├── engine/                       ← CLion project (C++ engine)
│   ├── CMakeLists.txt            — C++26, builds standalone test EXE
│   └── src/
│       ├── types.h               — All C++ data types (TPrice, TTradeStat, TStockParams, etc.)
│       ├── engine.h              — IEngine abstract class
│       └── main.cpp              — Standalone test harness
├── web/                          ← WebStorm project (JS/Vite/Preact)
│   ├── package.json              — Vite + Preact + Chart.js
│   ├── vite.config.js            — Preact preset, port 3000
│   ├── index.html                — Entry HTML, mounts #app
│   ├── .env.example              — VITE_WORKER_URL config
│   ├── public/
│   │   └── nse_stocks.json       — 2,586 NSE stocks/ETFs/indices (bundled)
│   ├── src/
│   │   ├── data/
│   │   │   ├── yahoo.js          — fetchYearData() + fetchYears() via Cloudflare Worker
│   │   │   └── storage.js        — OPFS read/write (writeStockYear, hasStockYear, etc.)
│   │   ├── wasm/
│   │   │   └── engine.js         — Mock engine singleton (synthetic data, matches IEngine JSON contract)
│   │   └── ui/
│   │       ├── App.jsx           — Root component, state management, two-phase add-stock flow
│   │       ├── BasketGraph.jsx   — Dual-mode Chart.js graph, allocation bar, controls
│   │       ├── BasketList.jsx    — Stock list sidebar, accordion sliders, "New" button
│   │       ├── StatsPanel.jsx    — Bottom panel: trade table (stock) / summary table (basket)
│   │       ├── FetchModal.jsx    — Progress modal during Yahoo data download
│   │       ├── NewStockModal.jsx — Stock search + params modal (loads nse_stocks.json)
│   │       ├── SearchableDropdown.jsx — Reusable autocomplete dropdown
│   │       ├── utils.js          — Color generation (golden angle hue rotation)
│   │       └── styles.css        — Complete dark theme (~1080 lines)
│   └── worker/
│       ├── index.js              — Cloudflare Worker CORS proxy for Yahoo Finance
│       └── wrangler.jsonc        — Wrangler v4 config
└── .gitignore
```

## UI Layout

```
┌──────────────────────────────────────────────────────────┐
│ ┌─────────────┐ ┌──────────────────────────────────────┐ │
│ │ Basket List  │ │ Graph Area                           │ │
│ │ (280px)      │ │  Controls bar: [Alloc ▼] [Year ▼]   │ │
│ │              │ │  [Line|Bar]                          │ │
│ │ [New] button │ │                                      │ │
│ │ Stock items  │ │  Alloc │        Chart.js canvas      │ │
│ │  with accord │ │  bar   │                              │ │
│ │  ion sliders │ │        │                              │ │
│ │              │ │        │                              │ │  ~80%
│ └─────────────┘ └──────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ Stats Panel                                          │ │  ~20%
│ │ (trade window table when stock selected,             │ │
│ │  basket summary table when no selection)             │ │
│ └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

- No top bar — "New" button in basket header, allocation dropdown in graph controls
- Allocation bar with +/- buttons (custom mode) shown left of graph in all modes
- Clicking stock in basket → single-stock view (price chart + shaded trade windows, trade table in stats panel)
- Clicking away → basket aggregate view (weighted return chart, basket summary table)
- Accordion expander per stock → sliders for Years, Min Window, Max Window, Win %
- Fully reactive: slider changes instantly recompute via engine (no debounce)

## Data Flow: Adding a Stock

1. User clicks "New" → `NewStockModal` opens (2,586 NSE stocks searchable from bundled JSON)
2. User picks stock + params → clicks "Add"
3. `FetchModal` opens — fetches up to 25 years from Yahoo via Cloudflare Worker CORS proxy
4. Each year: `fetchYearData()` → parse Yahoo JSON → build CSV → `writeStockYear()` to OPFS
5. No-data years get `.nodata` sentinels; already-cached years are skipped
6. On completion: `engine.addStock(symbol, params)` called, stock appears in basket
7. Cancel aborts fetch via AbortController, nothing added

## Yahoo Finance API

- **Endpoint**: `https://query2.finance.yahoo.com/v8/finance/chart/{SYMBOL}.NS`
- **Params**: `period1` (unix ts, Jan 1 of year), `period2` (Jan 1 of next year), `interval=1d`
- **Response**: JSON with `chart.result[0].timestamp[]` and `chart.result[0].indicators.quote[0].close[]`
- **CSV format stored**: `Date,Close` (one line per trading day, `YYYY-MM-DD,float`)
- **File naming**: `stocks/{SYMBOL}.NS_{YEAR}.csv` and `.nodata` sentinels
- **Rate limiting**: 1s delay between year requests; HTTP 429 = wait and retry
- **HTTP 400**: stock didn't exist that year → `.nodata` sentinel
- **Early stop**: 3 consecutive no-data years = stock didn't exist before that

## Allocation Modes

- **Equal**: equal weight across all visible stocks
- **Market Cap**: weight by market capitalization
- **Avg Return**: weight by average historical return
- **Custom**: user-specified weights with +/- buttons (5% step, 5% minimum per stock, proportional redistribution)

## Engine Interface (IEngine)

The engine is stateful. Key methods (all return JSON strings):
- `addStock(symbol, params)` — reads OPFS, computes trade stats
- `removeStock(symbol)` — removes stock and frees cached data
- `updateStockParams(symbol, params)` — hot path for slider changes
- `setStockVisible(symbol, visible)` — hide from basket aggregate
- `setAllocMode(mode)` / `setMarketCap(symbol, mcap)` / `setCustomWeight(symbol, weight)`
- `getBasketResult()` — returns weighted aggregate with per-year returns, per-stock summaries, stats
- `getStockDetail(symbol)` — returns trade window stats, per-year prices/returns/windows

## Engine Constants

- `DAYS = 366` (all years treated as leap years, index 59 = Feb 29 always)
- `FEE_RATE = 0.002`, `STCG_TAX_RATE = 0.20`, `WIN_THRESHOLD_PCT = 1.0`
- `MIN_MEAN_PCT = 1.0`, `MIN_ANNUAL_PCT = 1.0`, `MIN_SKEW = 0.65` (viability filters)
- Prices stored as integer cents (`TPrice = int32_t`), normalized via `PRICE_NORMAL = 1 << 24`
- Two simulation models: `calculateReturns()` (linear interpolation for visualization) and `simulateYear()` (cash-based for backtest)

## WASM Build (Future)

The C++ engine will use Emscripten WasmFS with OPFS backend:
- Build flags: `-sWASMFS -pthread -sPROXY_TO_PTHREAD`
- Mount OPFS at startup, read CSVs via standard `fopen`/`fread`
- File path from C++: `/opfs/stocks/{SYMBOL}.NS_{YEAR}.csv`

## Running Locally

```bash
# Terminal 1: Start Cloudflare Worker CORS proxy
cd web/worker
npx wrangler dev
# Listening on http://localhost:8787

# Terminal 2: Start Vite dev server
cd web
npm run dev
# Running on http://localhost:3000
```

The app defaults to `VITE_WORKER_URL=http://localhost:8787`.

## Deploying the Worker

```bash
npm install -g wrangler
npx wrangler login                         # sign into free Cloudflare account
cd web/worker && npx wrangler deploy       # gives you https://meguru-proxy.xxx.workers.dev
```

Then set `VITE_WORKER_URL` to the deployed URL in `web/.env` and rebuild.

## Current Status

### Completed:
- Full UI with all components (basket list, graph, stats panel, modals, dropdowns)
- Mock engine generating synthetic data matching IEngine JSON contract
- Yahoo Finance fetch pipeline (via Cloudflare Worker CORS proxy)
- OPFS storage layer for per-year CSV files
- FetchModal with real-time progress log, caching, abort support
- 2,586 NSE stocks bundled as searchable JSON
- C++ engine interface headers (types.h + engine.h)
- C++ & TypeScript style guide (CPP_STYLE.md)
- Clean Vite build, git repo initialized

### Not Started:
- `web/src/data/metadata.js` — IndexedDB for basket config persistence (basket state lost on reload)
- Cloudflare Worker deployment (only local dev so far)
- Real C++ WASM engine implementation
- Connecting real engine to UI (replacing mock)
- Market cap fetching (Yahoo v7 quote API with crumb auth)
- Static site deployment (GitHub Pages / Netlify / Cloudflare Pages)
