# Meguru — Seasonal Stock Trading Research Tool

Meguru is a browser-based seasonal trading research tool for NSE-listed stocks.
It identifies date ranges within each year where positive returns have occurred
with high consistency, turning those recurring windows into a concrete trading
plan — specific periods each year when it makes sense to buy and hold a stock.

> **All computation runs in your browser.** There is no backend server.
> Price data is fetched from Yahoo Finance via a lightweight CORS proxy and
> stored locally in your browser's private file system (OPFS).

---

## What It Does

### Baskets

A **basket** is a collection of stocks, each with its own set of trade windows
and its own capital-allocation percentage. By combining stocks with different
seasonal windows you can create a portfolio that captures recurring patterns
while smoothing out volatility and reducing total time in market.

The engine simulates the full trade history for the basket and plots the result
against a simple buy-and-hold benchmark. Each stock's contribution is shown
separately in the bar chart so you can see exactly where returns are coming from.

Capital is tracked independently per stock — gains in one position are never
mixed with another, keeping accounting clean and per-stock comparisons honest.

---

## Quick Start

### 1 — Build your basket

Click **Add Stock** at the top of the basket panel and type the NSE symbol or company name to search for the stcok.
Meguru downloads up to 25 years of daily price data from Yahoo Finance and stores it in your
browser cache for future use. This may take a few seconds; subsequent loads
are instant.

Once added, the engine automatically optimises the search parameters to find
the best trade windows for that stock.

You can also click **Examples** in the footer to load curated baskets instantly.

### 2 — Tune parameters

Click the **▶** chevron on any stock tile to reveal three sliders:

| Slider | Parameter | Effect |
|---|---|---|
| Sample years | `nYears` | How many historical years to analyse. More years = more statistical confidence but slower adaptation to recent market regime changes. |
| Min Window | `nWinMin` | Shortest acceptable window length in days. Very short windows can fit noise; very long windows dilute signal. |
| Win % | `fPctWin` | Minimum historical hit-rate a candidate window must clear. Floor is 50% — below chance is not a signal. |

The `nWinMax` upper bound is fixed at 180 days and not exposed in the UI.

### 3 — Review basket returns

**Bar view** — each column shows one year. The left bar is the average
buy-and-hold return; the right bar is the plan return, broken down by stock.
White labels show the net result. The top of the bar is aligned with the net
return; the section below zero shows losses (right half) and gains nullified
by losses (left half).

**Line view** — shows a single year's daily equity curve — plan vs
buy-and-hold — with trade-window shading overlaid for the selected stock.
You can select a specific year or the per-day average across all years.

To focus on one stock, click its tile to **solo** it. The graph and stats
panel update to show that stock only. Click again to return to the full
basket view. To temporarily hide a stock without removing it, click the green
dot next to its name.

### 4 — Adjust allocation

The vertical bar to the left of the chart shows how capital is split across
stocks. Choose from the dropdown:

- **Equal** — every visible stock gets the same weight.
- **Avg Return** — weights are proportional to each stock's average plan return.
- **Custom** — hover-handles on the bar let you nudge each stock's weight in
  5% steps. Use *Copy to custom* to start from the current mode's weights.

The 💡 bulb next to the allocation bar runs an automatic brute-force search
over weight compositions to maximise basket return, weighted by a
risk-adjusted quality score.

### 5 — Export and save

| Action | Description |
|---|---|
| **Save** | Exports the basket as a JSON file — stocks, parameters, allocation mode, and custom weights all included. |
| **Load** | Restores a saved basket and auto-downloads any missing price data. |
| **Backtest CSV** | Day-by-day trade detail for a chosen year — useful for verifying numbers in a spreadsheet. |
| **Trade Calendar** | Date-keyed CSV with every BUY/SELL action across the basket. Drop it into a calendar app or use it as a checklist. |

---

## Stats Glossary

### Trade-window stats

| Term | Meaning |
|---|---|
| Day Range | Day-of-year range (1–366) when this window is active. |
| Win % | Fraction of years this window ended positive. |
| Expected % | Average return across all sample years for this window. |
| %/day | Expected % divided by window length in days. |
| Profit Ratio | Average gain on winning years / average loss on losing years. |

### Summary stats

| Term | Meaning |
|---|---|
| Plan Return | Average yearly return when following the trade-window plan. |
| B&H Return | Average yearly return for a simple buy-and-hold. |
| Days In Market | Fraction of the year capital is actively held under the plan. |
| Plan Quality | Risk-adjusted score: plan return relative to B&H, penalised by downside volatility. Higher is better. |

---

## Methodology

1. Daily OHLC data is downloaded from Yahoo Finance via a Cloudflare Worker
   CORS proxy and cached per `(symbol, year)` in OPFS.
2. For each stock the engine builds returns for every day-of-year window in
   `[nWinMin, 180]`.
3. Windows are kept only if they pass `fPctWin` over the last `nYears`.
4. Surviving windows are merged into a single trade plan: BUY at the start of
   an active window, SELL at the end, flat otherwise.
5. The basket simulator runs each stock's plan, weighted by allocation, and
   aggregates daily equity.

### Caveats

- This is curve-fitted historical analysis. Past performance does not
  guarantee future results.
- The engine ignores transaction costs and tax.
- Yahoo data is end-of-day, adjusted for splits but not always for dividends.
- The win-rate floor is 50% — the optimiser never selects windows with a
  losing track record.

---

## Running Locally

```bash
# Terminal 1 — Cloudflare Worker CORS proxy (Yahoo Finance relay)
cd web/worker
npx wrangler dev
# Listening on http://localhost:8787

# Terminal 2 — Vite dev server
cd web
npm install
npm run dev
# Running on http://localhost:3000
```

The app reads `VITE_WORKER_URL` from `web/.env` (see `web/.env.example`).
By default it points to `http://localhost:8787`.

### Deploying the worker

```bash
npx wrangler login                    # sign in to a free Cloudflare account
cd web/worker
npx wrangler deploy                   # → https://meguru-proxy.xxx.workers.dev
```

Set `VITE_WORKER_URL` to the deployed URL in `web/.env` and rebuild with
`npm run build`.

### Building the WASM engine

Requires [Emscripten](https://emscripten.org/) (`emcc` on `$PATH`).

```bash
cd engine
mkdir build-wasm && cd build-wasm
emcmake cmake .. -DCMAKE_BUILD_TYPE=Release
make -j$(nproc)
# Outputs: meguru.js  meguru.wasm
cp meguru.js meguru.wasm ../../web/public/wasm/
```

For a native debug build:

```bash
cd engine
mkdir build && cd build
cmake .. -DMEGURU_DEBUG=ON
make -j$(nproc)
./meguru                              # standalone test harness
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| UI framework | Preact (class components) |
| Charting | Chart.js |
| Engine | C++23 compiled to WebAssembly via Emscripten |
| JS–WASM bridge | Emscripten embind |
| Client-side cache | OPFS (Origin Private File System) |
| Data source | Yahoo Finance v8 chart API |
| CORS proxy | Cloudflare Workers |
| Static hosting | Cloudflare Pages |
| Build tool | Vite 6 |
