# C++ Style Guide — Meguru Engine

Target standard: **C++23**. Compile with `-std=c++23`.

---

## 1. Aliases and Typedefs

Define short aliases in a shared header (`common.h`). Prefer `using` over `typedef`.

```cpp
using i32  = int32_t;
using i64  = int64_t;
using u64  = uint64_t;
using f64  = double;

using str  = string;
using cstr = const string;
using vstr = vector<string>;
using vint = vector<i32>;
using vf64 = vector<f64>;
```

Use `using namespace std;` in implementation files and the shared header.
Avoid it in public interface headers — use explicit `std::` or selective `using std::vector, std::string, ...`.

---

## 2. Macros

Use macros for brevity in repetitive patterns. Keep them short, uppercase, and obvious.

```cpp
#define CREF(T)   const T&
#define CAUTOREF  const auto&
#define CAUTO     const auto

#define FOR(X, MIN, MAX)   for(i32 X = MIN; X < MAX; X++)
#define FORLE(X, MIN, MAX) for(i32 X = MIN; X <= MAX; X++)
```

Usage:
```cpp
FOR(i, 0, DAYS) prices[i] = 0.0;
FORLE(nWin, params.nWinMin, params.nWinMax) { ... }

void calc(CREF(TDayRange) range);
for(CAUTOREF [key, val] : mapData) { ... }
CAUTO fGain = getGain(arr, range);
```

Do **not** macro-ify logic or control flow beyond simple loops.

---

## 3. Hungarian Notation (Naive)

Prefix local variables and struct members by type. This is the naive/lightweight variant — not full Systems Hungarian.

### Prefix table

| Prefix | Type | Example |
|--------|------|---------|
| `n` | integer count/quantity | `nYears`, `nWinMin`, `nSlides` |
| `i` | integer index/position | `iBeg`, `iEnd`, `iYear`, `idxDay` |
| `f` | floating point (double) | `fGain`, `fDailyGainMax`, `fPriceLast` |
| `pct` | percentage value | `pctWin`, `pctThreshold`, `pctExpected` |
| `s` | string | `sStock`, `sDir`, `sPath`, `sDate` |
| `b` | bool | `bVisible`, `bLoaded` |
| `p` | pointer | `pStockData`, `pEngine` |
| `arr` | array/vector/valarray | `arrPrices`, `arrRanges`, `arrStats` |
| `map` | map/unordered_map | `mapYearGains`, `mapStockData` |
| `it` | iterator / loop index | `itLastTraded` |
| `ct` | chrono type | `ctYMD` |

### Member prefix

Class/struct **data members** use `m_` followed by the hungarian prefix:

```cpp
class CTradePlan {
    TTradePlanParams m_params;
    TStockPrice      m_priceAvg;
    TDayRanges       m_arrRanges;
    TStockHistory    m_arrStockData;
    str              m_sDir;
    bool             m_bDirty = false;
};
```

### Parameters

Function parameters use the same prefixes, no `m_`:

```cpp
void load(IStockData *pStockData, TTradePlanParams params);
TYearData get(cstr &sStock, i32 nYear);
double getGain(CREF(TStockPrice) arrPrices, CREF(TDayRange) range);
```

### Local variables

```cpp
i32 nSize = iEnd - iBeg;
f64 fDailyGain = getGain(m_priceAvg, range) / nWin;
str sPath = m_sDir + "/" + sStock + ".csv";
```

---

## 4. Naming Conventions

### Types

- **Structs/classes**: `T` prefix for data types, `C` prefix for concrete classes, `I` prefix for interfaces.
  ```
  TDayRange, TYearData, TTradeStat, TStockParams
  CTradePlan, CStock, CEngine
  IStockData, IEngine, ITradePlan
  ```
- **Enums**: `T` prefix for the enum, lowercase prefix for values derived from the type name.
  ```cpp
  enum TAllocationType { atMCap, atReturn, atEqual, atCustom };
  ```
  Or `enum class` with PascalCase values:
  ```cpp
  enum class EAllocMode { Equal, MCap, AvgRet, Custom };
  ```
- **Type aliases**: `T` prefix.
  ```cpp
  using TStockPrice = valarray<f64>;
  using TDayRanges  = vector<TDayRange>;
  using TWindowStats = vector<TWindowStat>;
  ```
- **Aggregate/collection aliases**: use the **plural** of the element type. If `TPrice` is a struct, then `vector<TPrice>` is `TPrices`. If `TDayRange` is a struct, then `vector<TDayRange>` is `TDayRanges`. This applies to any container — vector, array, map values, etc.
  ```cpp
  struct TWindow { i32 iBeg; i32 iEnd; };
  using TWindows = vector<TWindow>;

  struct TTradeStat { ... };
  using TTradeStats = vector<TTradeStat>;

  struct TYearResult { ... };
  using TYearResults = vector<TYearResult>;
  ```
  The plural form makes it immediately clear that the type is a collection without needing to inspect the definition.

### Functions

- **Free functions**: camelCase starting with a verb.
  ```cpp
  f64 getGain(CREF(TStockPrice) arr, CREF(TDayRange) range);
  i32 getDayIndexForYMD(cstr &sDate);
  void fillPriceGaps(TYearData &data);
  ```
- **Member functions**: same camelCase.
  ```cpp
  void load(IStockData *pStockData, TTradePlanParams params);
  TWindowStats getStats();
  TDayRange findBestRange(i32 iBeg, i32 iEnd) const;
  ```

### Constants

- `constexpr` with UPPER_SNAKE_CASE:
  ```cpp
  constexpr i32 DAYS = 366;
  constexpr f64 FEE_RATE = 0.002;
  constexpr f64 PRICE_NORMAL = 1 << 24;
  ```

---

## 5. Formatting

### Braces and spacing

- Opening brace on the same line.
- Omit braces for trivial single-statement bodies.
- Compact conditionals when the body is short.

```cpp
if(r.iBeg != -1) {
    m_arrRanges.push_back(r);
    findBestRanges(iBeg, r.iBeg);
}

while(itLast > -1 && arr[itLast] == 0.0) --itLast;

if(fGain > fMax) fMax = fGain;
```

### No space before parens in control flow

```cpp
if(cond) { ... }
for(CAUTOREF x : arr) { ... }
while(n > 0) --n;
```

### Indentation

4 spaces. No tabs.

### One-liners for trivial functions

```cpp
void CStock::setDir(cstr &sDir) { m_sDir = sDir; }
i32 period() const { return m_nSel - m_nBuy; }
```

### Structured bindings

```cpp
for(CAUTOREF [fst, snd] : m_arrStockData) {
    mapYearGains[fst] = getGain(snd.arrPrices, range);
}
```

---

## 6. Includes

Order in implementation files:
1. Own header (`#include "plan.h"`)
2. Project headers (`#include "common.h"`)
3. Standard library (pulled in via `common.h`)

`common.h` is the single precompiled/shared header that pulls in all standard includes and defines aliases/macros. Individual headers include `common.h` first.

---

## 7. Modern C++ Features (C++23)

Use freely:
- `auto`, `const auto`, structured bindings
- `std::ranges` and views: `views::values`, `views::filter`, `views::transform`
- `std::format` for string formatting
- `std::chrono` date types (`year`, `month`, `day`, `year_month_day`, `sys_days`)
- `constexpr` and `consteval` where applicable
- `[[nodiscard]]` on functions that return values that must not be ignored
- `std::expected` / `std::optional` for error handling
- Designated initializers: `TDayRange{.iBeg = 0, .iEnd = 10}`
- `if` with initializer: `if(const i32 nSize = iEnd - iBeg; nSize >= nMin)`
- Lambda expressions for local algorithms
- `std::span` for non-owning views into contiguous data

Avoid:
- Exceptions for control flow (use return codes or `std::expected`)
- RTTI / `dynamic_cast`
- `new` / `delete` — use value semantics or `unique_ptr`

---

## 8. Struct Initialization

Use default member initializers. Keep structs simple with public fields.

```cpp
struct TStockParams {
    i32 nYears  = 10;
    i32 nWinMin = 10;
    i32 nWinMax = 31;
    f64 fPctWin = 60.0;
};

struct TDayRange {
    i32 iBeg  = 0;
    i32 iEnd  = 0;
    f64 fGain = 0.0;
};
```

---

## 9. Comments

- Brief single-line comments above functions explaining **what**, not **how**.
- No doc-comment systems (no Doxygen, no `///`).
- Inline comments for non-obvious logic only.

```cpp
// Fills any price gaps in a year's price array.
// For any day with no data (weekend/holiday), fills with the next trading day's price.
void fillPriceGaps(TYearData &data) {
    ...
}

// Always act as if Feb 29 exists and year has 366 days
if(!yyyy.is_leap() && idxDay > 59) ++idxDay;
```

---

## 10. File Organization

```
common.h    — aliases, macros, shared includes, fundamental types
intf.h      — abstract interfaces (IEngine, IStockData)
types.h     — all data structs and type aliases
engine.h    — engine class declaration
engine.cpp  — engine implementation
stocks.h/cpp — stock data loading
plan.h/cpp  — trade plan computation
basket.h/cpp — basket aggregation
```

Headers use `#pragma once` (not `#ifndef` / `#define` / `#endif` guards).

---

## 11. Ternary for Accumulation

Use ternary dispatch for partitioned accumulation:

```cpp
(fGain > 0 ? fWinSum : fLossSum) += fGain;
```

---

## 12. valarray for Numeric Arrays

Use `std::valarray<f64>` for fixed-size numeric arrays where element-wise arithmetic is needed (prices, returns). This enables natural syntax:

```cpp
TStockPrice priceSum{0.0, DAYS};
for(CAUTO &val : data | views::values) {
    priceSum += (val.arrPrices / val.arrPrices[0]);  // normalize and accumulate
}
m_priceAvg = priceSum / data.size();
```

---
---

# TypeScript / JSX Style Guide — Meguru Frontend

The frontend follows the same naming philosophy as the C++ engine to keep the codebase consistent across the WASM boundary.

Target: **ES2022+**, Preact with **class-based components** (no hooks).

---

## 13. Hungarian Notation (same prefix table)

Use the same prefixes as C++:

| Prefix | Type | Example |
|--------|------|---------|
| `n` | integer count/quantity | `nYears`, `nWinMin`, `nSlides` |
| `i` | integer index/position | `iBeg`, `iEnd`, `iYear`, `idxDay` |
| `f` | floating point | `fGain`, `fDailyGainMax`, `fPriceLast` |
| `pct` | percentage value | `pctWin`, `pctThreshold` |
| `s` | string | `sStock`, `sDir`, `sPath` |
| `b` | bool | `bVisible`, `bLoaded` |
| `arr` | array | `arrPrices`, `arrRanges`, `arrStats` |
| `map` | object used as a map | `mapYearGains`, `mapStockData` |

### Class members

Use `m_` prefix for private/internal class fields (same as C++):

```jsx
class CEngine {
    m_arrStocks = {};
    m_sAllocMode = 'equal';
    m_arrInsertOrder = [];
}
```

### State and props

State keys and prop names use hungarian prefixes directly (no `m_`):

```jsx
this.state = {
    arrStocks: [],
    mapStockData: {},
    sSelectedStock: null,
    sExpandedStock: null,
    bModalOpen: false,
    sAllocMode: 'equal',
    sViewMode: 'line',
    sSelectedYear: 'Average',
};
```

---

## 14. Type and Class Naming

Same convention as C++:

| Prefix | Usage | Example |
|--------|-------|---------|
| `T` | Data shape / typedef / interface | `TStockParams`, `TBasketResult`, `TYearData` |
| `C` | Concrete class | `CEngine`, `CStockData` |
| `I` | Interface (abstract) | `IEngine` |
| `E` | Enum-like constant object | `EAllocMode` |

For JSDoc or TS-style type definitions:

```js
/** @typedef {{ nYears: number, nWinMin: number, nWinMax: number, fPctWin: number }} TStockParams */
/** @typedef {{ iBeg: number, iEnd: number, pctWin: number, fSkew: number }} TTradeStat */
/** @typedef {TTradeStat[]} TTradeStats */
```

Aggregate types use plurals, same as C++:

```js
/** @typedef {TWindow[]} TWindows */
/** @typedef {TYearResult[]} TYearResults */
```

---

## 15. Component Naming

Preact components are PascalCase without a prefix (they are not data types):

```
App, BasketList, BasketGraph, StatsPanel, NewStockModal, SearchableDropdown
```

File names match the component: `BasketList.jsx`, `StatsPanel.jsx`.

---

## 16. Function Naming

Same as C++ — camelCase starting with a verb:

```js
getBasketColors(arrStocks)
handleAddStock(sSymbol, params)
refreshBasket()
recomputeColors(arrStocks, mapStockData)
calculateOverlayStats()
```

Event handlers use `handle` prefix:

```js
handleSliderChange(sStock, sField, nValue)
handleAllocModeChange(sMode)
handleSelectStock(sSymbol)
handleToggleVisible(sSymbol)
```

Callbacks passed as props use `on` prefix:

```jsx
<BasketList
    onSelect={this.handleSelectStock}
    onRemove={this.handleRemoveStock}
    onToggleVisible={this.handleToggleVisible}
    onParamChange={this.handleParamChange}
/>
```

---

## 17. Constants

UPPER_SNAKE_CASE, same as C++:

```js
const DAYS = 366;
const FEE_RATE = 0.002;
const HUE_STEP = 137;
const MONTHS = ['Jan', 'Feb', ...];
const MONTH_DAYS = [31, 29, 31, ...];
```

Enum-like objects:

```js
const EAllocMode = {
    Equal:  'equal',
    MCap:   'mcap',
    AvgRet: 'avgret',
    Custom: 'custom',
};
```

---

## 18. Formatting

### Same rules as C++

- 4-space indentation, no tabs.
- Opening brace on the same line.
- No space before parens in `if(`, `for(`, `while(`.
- Compact one-liners for trivial functions:
  ```js
  getPrice(iDay) { return this.m_arrPrices[iDay]; }
  ```

### Arrow functions

Use arrow functions for callbacks and class methods to preserve `this`:

```jsx
handleSliderChange = (sStock, sField, nValue) => {
    const params = { ...this.state.mapStockData[sStock].params, [sField]: nValue };
    this.props.onParamChange(sStock, params);
}
```

### Destructuring

Use destructuring in render and handlers:

```jsx
render() {
    const { arrStocks, mapStockData, sSelectedStock } = this.state;
    const { onSelect, onRemove } = this.props;
    ...
}
```

---

## 19. Class-Based Components (No Hooks)

All Preact components use `class extends Component`. No `useState`, `useEffect`, `useRef`, etc.

```jsx
class BasketList extends Component {
    handleClick = (sSymbol) => { ... }

    render() {
        const { arrStocks, mapStockData } = this.props;
        return ( ... );
    }
}
```

Use `createRef()` for DOM references:

```jsx
constructor(props) {
    super(props);
    this.chartRef = createRef();
}
```

State changes via `this.setState()` with optional callback:

```jsx
this.setState({ sSelectedStock: sSymbol }, () => {
    this.refreshStockDetail(sSymbol);
});
```

---

## 20. File Organization (Frontend)

```
src/
  ui/
    App.jsx          — root component, all state, engine calls
    BasketList.jsx   — stock list sidebar
    BasketGraph.jsx  — Chart.js graph (line/bar/stock modes)
    StatsPanel.jsx   — bottom stats panel
    NewStockModal.jsx — add-stock modal
    SearchableDropdown.jsx — reusable search input
    utils.js         — pure utility functions (colors, math)
    styles.css       — all CSS (single file, dark theme)
  wasm/
    engine.js        — mock engine (dev) / WASM loader (prod)
  data/
    storage.js       — OPFS + IndexedDB helpers
    fetcher.js       — Yahoo Finance data fetcher
```

---

## 21. CSS

Single `styles.css` file. Class names use kebab-case. Sections separated by comment blocks:

```css
/* ====================================================================
   Basket List
   ==================================================================== */

.basket-list { ... }
.basket-item { ... }
.basket-item.selected { ... }
.basket-item-accordion { ... }
```

No CSS modules, no CSS-in-JS, no Tailwind. Plain CSS with BEM-light naming (block-element, no `__` separators, use `-` instead):

```
.basket-list
.basket-item
.basket-item-row
.basket-item-accordion
.graph-controls
.graph-controls-left
.chart-overlay-stats
.alloc-bar
.alloc-segment
.alloc-bar-label
```

---

## 22. Comments (Frontend)

Props documented in a block comment above the class:

```jsx
// Basket list with per-stock accordion expanders.
//
// Props:
//   arrStocks: string[]
//   mapStockData: { [symbol]: { params, bVisible, sColor } }
//   sSelectedStock: string|null
//   onSelect: (symbol) => void
//   onRemove: (symbol) => void

class BasketList extends Component { ... }
```

No JSDoc `@param` / `@returns` — keep it brief and readable.
