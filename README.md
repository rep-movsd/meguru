# Meguru — Stock Season Finder

Meguru look at stock price history. Find time of year when stock go up many times before.
Make plan: buy here, sell there, do again next year.

> **All thinking happen in browser. No server. No cloud brain.**
> Price numbers come from Yahoo Finance through small helper, saved in browser cave (OPFS).

---

## What Meguru Do

### Basket

**Basket** = group of stocks. Each stock have own buy/sell times. Each stock get own pile of money.

Put many stocks together → catch different seasons → less bumpy ride → less time holding risky thing.

Meguru run fake trade on all past years. Draw picture. Show how plan do vs just hold forever.
Each stock shown with own color bar so you see who help, who hurt.

Money stay separate per stock. No mixing. Easy to see who earn what.

---

## How To Use

### Step 1 — Fill basket

Click **Add Stock**. Type NSE name (`RELIANCE`, `TCS`, etc).
Meguru go grab up to 25 years of price from Yahoo. Store in browser. Wait few seconds.
Next time: instant — already in cave.

After add, Meguru auto-tune settings to find best windows. No manual work needed.

Click **Examples** at bottom to load ready baskets.

### Step 2 — Poke sliders

Click **▶** arrow on stock tile. Three sliders appear:

| Slider | Code name | What do |
|---|---|---|
| Sample years | `nYears` | How many past years to study. More years = more sure, but slow to notice market changed. |
| Min Window | `nWinMin` | Shortest buy-hold time allowed (days). Too short = catch noise. Too long = blur signal. |
| Win % | `fPctWin` | How many years window must win to count. Never below 50% — losing window not signal. |

Max window always 180 days. Hidden. Cannot touch.

### Step 3 — Look at chart

**Bar view** — one column per year. Left bar = hold all year return. Right bar = plan return, colored by stock.
White number = final result. Bar below zero: right half = loss, left half = gains eaten by loss.

**Line view** — squiggly line of money over days. Plan vs hold-all-year. Pick one year or see average of all years.
Colored boxes show when stock held.

Click stock tile → **solo mode**: see only that stock. Click again → back to full basket.
Click green dot → hide stock (stay in basket but weight = zero).

### Step 4 — Split money

Vertical bar left of chart show how money split. Pick from dropdown:

- **Equal** — everyone same slice.
- **Avg Return** — winners get bigger slice.
- **Custom** — drag handles on bar, change in 5% steps. Click *Copy to custom* to start from current split.

💡 bulb button = let Meguru try all splits, pick best one. Use quality score (not just raw return).

### Step 5 — Save stuff

| Button | What happen |
|---|---|
| **Save** | Download basket as JSON file. Has everything. |
| **Load** | Put basket back. Downloads missing price data auto. |
| **Backtest CSV** | One year of trade math. Check in spreadsheet. |
| **Trade Calendar** | BUY/SELL dates for whole basket. Put in calendar app. |

---

## Numbers Explained

### Window numbers

| Word | Meaning |
|---|---|
| Day Range | Which days of year window is open (1–366). |
| Win % | How many years this window made money. |
| Expected % | Average return across all years for this window. |
| %/day | Expected % divided by days open. |
| Profit Ratio | Average win size ÷ average loss size. |

### Summary numbers

| Word | Meaning |
|---|---|
| Plan Return | Average yearly return following plan. |
| B&H Return | Average yearly return holding all year. |
| Days In Market | Fraction of year when money actually working. |
| Plan Quality | Smart score. Plan return vs how long held, minus pain from bad years. Higher = better. |

---

## How Brain Work Inside

1. Grab daily price from Yahoo, save per year in browser cave.
2. For each stock, try every window size from `nWinMin` to 180 days.
3. Keep windows that won at least `fPctWin`% of years.
4. Surviving windows become plan: BUY when window open, SELL when close, sit flat otherwise.
5. Run plan on each stock, weight by allocation, add up daily money curve.

### Danger warnings

- This history fitting. Past good time not promise future good time.
- Engine not count fees or tax.
- Yahoo price = end of day, split-fixed, maybe not dividend-fixed.
- Engine never pick window that lose more than win.

---

## Run On Own Computer

```bash
# Cave 1 — small helper that talk to Yahoo (browser cannot talk direct)
cd web/worker
npx wrangler dev
# Sit on http://localhost:8787

# Cave 2 — actual app
cd web
npm install
npm run dev
# Sit on http://localhost:3000
```

App read `VITE_WORKER_URL` from `web/.env`. Default = `http://localhost:8787`.

### Put helper on internet

```bash
npx wrangler login                    # make free Cloudflare account
cd web/worker
npx wrangler deploy                   # → https://meguru-proxy.xxx.workers.dev
```

Put that URL in `web/.env` as `VITE_WORKER_URL`. Build again with `npm run build`.

### Build C++ brain into WASM blob

Need [Emscripten](https://emscripten.org/) (`emcc` must be findable).

```bash
cd engine
mkdir build-wasm && cd build-wasm
emcmake cmake .. -DCMAKE_BUILD_TYPE=Release
make -j$(nproc)
# Makes: meguru.js  meguru.wasm
cp meguru.js meguru.wasm ../../web/public/wasm/
```

For native debug (no WASM, just run on computer):

```bash
cd engine
mkdir build && cd build
cmake .. -DMEGURU_DEBUG=ON
make -j$(nproc)
./meguru
```

---

## Ingredients

| Part | Tool |
|---|---|
| Buttons and screen | Preact (class style, no hooks) |
| Chart drawing | Chart.js |
| Thinking brain | C++23 → WebAssembly via Emscripten |
| Brain↔Browser talk | Emscripten embind |
| Price file cave | OPFS (browser private file system) |
| Price source | Yahoo Finance v8 API |
| Yahoo helper proxy | Cloudflare Workers |
| Put app on web | Cloudflare Pages |
| Build tool | Vite 6 |
