import { Component, render } from 'preact';
import engine, { initEngine } from '../wasm/engine.js';
import { getBasketColors } from './utils';
import BasketList from './BasketList';
import BasketGraph from './BasketGraph';
import StatsPanel from './StatsPanel';
import NewStockModal from './NewStockModal';
import FetchModal from './FetchModal';
import HelpModal from './HelpModal';
import { ensureStockData } from '../data/fetch.js';
import './styles.css';

// Root application component.
// Manages all state, calls mock engine on changes, passes props to children.
// No top bar — "New" button lives in basket header, allocation controls in graph controls.

const ALLOC_MODES = [
    { value: 'equal', label: 'Equal' },
    { value: 'avgret', label: 'Avg Return' },
    { value: 'custom', label: 'Custom' }
];

const LS_KEY = 'meguru_state';

class App extends Component {
    constructor(props) {
        super(props);
        this._paramChangeRaf = 0;
        this._pendingParamChanges = {};
        this._saveTimer = 0;
        this.state = {
            // Stock list (insertion order)
            stocks: [],
            // Per-stock data: { [symbol]: { params, visible, color, allocPct, nDataYears } }
            stockData: {},
            // UI state
            selectedStock: null,
            expandedStock: null,
            modalOpen: false,
            fetchModalData: null, // { sSymbol, params } when fetching data
            // Graph controls
            allocMode: 'equal',
            viewMode: 'line',
            selectedYear: 'Average',
            displayYears: 10,
            // Basket identity (set on load, used for export filenames)
            basketName: 'basket',
            // Engine results (parsed JSON)
            basketResult: null,
            stockDetail: null,
            // Auto-optimize overlay state
            optimizing: null,  // null | symbol string
            // Basket-load overlay state: null | { sSymbol, nDone, nTotal }
            loadingBasket: null,
            // Help modal
            helpOpen: false
        };
    }

    componentDidMount() {
        // Race engine init against a timeout so the app never hangs.
        // If the WASM module can't load (e.g. Worker spawn fails, OPFS not
        // available), the UI still becomes interactive after the timeout.
        const INIT_TIMEOUT_MS = 10000;
        const timeout = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Engine init timed out')), INIT_TIMEOUT_MS)
        );

        Promise.race([initEngine(), timeout])
            .then(() => this._restoreState())
            .catch(err => {
                console.error('Engine init failed:', err);
                // Still restore UI state (engine calls will be no-ops)
                this._restoreState();
            });
    }

    componentDidUpdate(_, prevState) {
        // Debounce localStorage writes — only save when persisted fields change
        const dominated = ['stocks', 'stockData', 'selectedStock', 'expandedStock',
                           'allocMode', 'viewMode', 'selectedYear', 'displayYears'];
        const changed = dominated.some(k => prevState[k] !== this.state[k]);
        if (changed) {
            clearTimeout(this._saveTimer);
            this._saveTimer = setTimeout(() => this._saveState(), 300);
        }
    }

    componentWillUnmount() {
        cancelAnimationFrame(this._paramChangeRaf);
        this._paramChangeRaf = 0;
        this._pendingParamChanges = {};
        clearTimeout(this._saveTimer);
        // Flush any pending save immediately
        this._saveState();
    }

    // ------------------------------------------------------------------
    // Persistence (localStorage)
    // ------------------------------------------------------------------

    _saveState = () => {
        const { stocks, stockData, selectedStock, expandedStock,
                allocMode, viewMode, selectedYear, displayYears } = this.state;

        // Strip color from stockData (recomputed on restore) and engine results
        const savedStockData = {};
        for (const s of stocks) {
            if (!stockData[s]) continue;
            const { params, visible, allocPct, nDataYears } = stockData[s];
            savedStockData[s] = { params, visible, allocPct, nDataYears };
        }

        try {
            localStorage.setItem(LS_KEY, JSON.stringify({
                stocks,
                stockData: savedStockData,
                selectedStock,
                expandedStock,
                allocMode,
                viewMode,
                selectedYear,
                displayYears
            }));
        } catch (err) {
            console.warn('Failed to save state to localStorage:', err.message);
        }
    }

    _restoreState = async () => {
        let saved;
        try {
            const sRaw = localStorage.getItem(LS_KEY);
            if (!sRaw) return;
            saved = JSON.parse(sRaw);
        } catch (err) {
            console.warn('Failed to restore state from localStorage:', err.message);
            return;
        }

        const stocks = Array.isArray(saved.stocks) ? saved.stocks : [];
        if (stocks.length === 0) return;

        const stockData = saved.stockData || {};

        // Re-seed the engine with saved stocks (async — JS reads OPFS, feeds CSV to C++)
        const allocMode = saved.allocMode || 'equal';
        engine.setAllocMode(allocMode);

        for (const symbol of stocks) {
            const sd = stockData[symbol];
            if (!sd || !sd.params) continue;
            await engine.addStock(symbol, sd.params);
            if (sd.visible === false) {
                engine.setStockVisible(symbol, false);
            }
        }

        // Recompute colors from insertion order
        let restoredStockData = {};
        for (const s of stocks) {
            const sd = stockData[s];
            if (!sd) continue;
            restoredStockData[s] = {
                params: sd.params,
                visible: sd.visible !== false,
                allocPct: sd.allocPct || (100 / stocks.length),
                nDataYears: sd.nDataYears || 25,
                color: '#888'
            };
        }
        restoredStockData = this.recomputeColors(stocks, restoredStockData);

        // Validate selectedStock still exists
        const selectedStock = stocks.includes(saved.selectedStock) ? saved.selectedStock : null;
        const expandedStock = stocks.includes(saved.expandedStock) ? saved.expandedStock : null;

        this.setState({
            stocks,
            stockData: restoredStockData,
            selectedStock,
            expandedStock,
            allocMode,
            viewMode: saved.viewMode || 'line',
            selectedYear: saved.selectedYear || 'Average',
            displayYears: Number.isFinite(saved.displayYears) ? saved.displayYears : 10
        }, () => {
            if (allocMode === 'custom') this.pushCustomWeightsToEngine();
            this.refreshAll(selectedStock);
        });
    }

    // ------------------------------------------------------------------
    // Engine refresh helpers
    // ------------------------------------------------------------------

    // Parse a JSON string from the engine, returning the parsed object or null.
    // Logs a warning on parse failure so errors aren't fully silent.
    _parseEngineResult = (sRaw) => {
        if (!sRaw) return null;
        try {
            return JSON.parse(sRaw);
        } catch (err) {
            console.warn('Engine JSON parse error:', err.message);
            return null;
        }
    }

    refreshBasket = () => {
        // getGraphData returns native JS obj directly (no JSON parse needed):
        //   { years:int[], perStockHold:{sym:{year:[366],"0":[366]}},
        //     perStockPlan:{sym:{...}}, basketAvg:{year:[366],"0":[366]},
        //     weightsPerStock:{sym:{year:f64,"0":f64}} }
        // displayYears governs how many year-bars are emitted (chart window),
        // distinct from each stock's params.nYears (stats lookback).
        const basketResult = engine.getGraphData(this.state.displayYears || 10);
        this.setState({ basketResult });
    }

    refreshStockDetail = (symbol) => {
        if (!symbol) {
            this.setState({ stockDetail: null });
            return;
        }
        const stockDetail = engine.getStockDetail(symbol);
        this.setState({ stockDetail: stockDetail || null });
    }

    refreshAll = (selectedStock) => {
        this.refreshBasket();
        if (selectedStock) {
            this.refreshStockDetail(selectedStock);
        } else {
            this.setState({ stockDetail: null });
        }
    }

    // Recompute colors for all stocks based on current order
    recomputeColors = (stocks, stockData) => {
        const colors = getBasketColors(stocks);
        const updated = { ...stockData };
        for (const s of stocks) {
            if (updated[s]) {
                updated[s] = { ...updated[s], color: colors[s] };
            }
        }
        return updated;
    }

    // Renormalize allocPct values so they sum to exactly 100
    renormalizeAllocPct = (stockData, stocks) => {
        const visibleStocks = stocks.filter(s => stockData[s]?.visible);
        if (visibleStocks.length === 0) return stockData;
        const total = visibleStocks.reduce((sum, s) => sum + (stockData[s].allocPct || 0), 0);
        if (total > 0 && Math.abs(total - 100) > 0.01) {
            const updated = { ...stockData };
            for (const s of visibleStocks) {
                updated[s] = { ...updated[s], allocPct: (updated[s].allocPct || 0) / total * 100 };
            }
            return updated;
        }
        return stockData;
    }

    // ------------------------------------------------------------------
    // Stock operations
    // ------------------------------------------------------------------

    // Phase 1: User clicked "Add" in NewStockModal — start fetching data
    handleAddStock = (symbol, params) => {
        this.setState({
            modalOpen: false,
            fetchModalData: { sSymbol: symbol, params }
        });
    }

    // Phase 2: FetchModal completed — add stock to engine and basket
    handleFetchComplete = async (symbol, params, nDataYears) => {
        const { stocks, stockData } = this.state;

        // Clamp nYears to available data
        const nMaxYears = Math.max(1, nDataYears || 1);
        const clampedParams = { ...params, nYears: Math.min(params.nYears, nMaxYears) };

        // Add to engine (async — JS reads OPFS, feeds CSV to C++)
        await engine.addStock(symbol, clampedParams);

        // Update state
        const newStocks = stocks.includes(symbol) ? [...stocks] : [...stocks, symbol];
        const equalPct = 100 / newStocks.length;
        let newStockData = {
            ...stockData,
            [symbol]: {
                params: { ...clampedParams },
                visible: true,
                color: '#888',
                allocPct: equalPct,
                nDataYears: nMaxYears
            }
        };

        // Reset all allocPct to equal on add
        for (const s of newStocks) {
            if (newStockData[s]) {
                newStockData[s] = { ...newStockData[s], allocPct: equalPct };
            }
        }

        // Recompute colors
        newStockData = this.recomputeColors(newStocks, newStockData);

        this.setState({
            stocks: newStocks,
            stockData: newStockData,
            fetchModalData: null
        }, () => {
            this.refreshAll(this.state.selectedStock);
        });
    }

    handleFetchCancel = () => {
        this.setState({ fetchModalData: null });
    }

    handleRemoveStock = (symbol) => {
        const { stocks, stockData, selectedStock, expandedStock } = this.state;

        engine.removeStock(symbol);

        const newStocks = stocks.filter(s => s !== symbol);
        let newStockData = { ...stockData };
        delete newStockData[symbol];

        // Recompute colors after removal
        newStockData = this.recomputeColors(newStocks, newStockData);
        // Renormalize alloc percentages
        newStockData = this.renormalizeAllocPct(newStockData, newStocks);

        const newSelected = selectedStock === symbol ? null : selectedStock;
        const newExpanded = expandedStock === symbol ? null : expandedStock;

        this.setState({
            stocks: newStocks,
            stockData: newStockData,
            selectedStock: newSelected,
            expandedStock: newExpanded
        }, () => {
            this.refreshAll(newSelected);
        });
    }

    handleSelectStock = (symbol) => {
        // symbol = stock name -> "solo": only this stock visible (others hidden),
        //                        same as if user clicked green dots manually.
        // symbol = null       -> restore all stocks to visible.
        // Also fetches stockDetail so StatsPanel shows trade-windows table.
        const { stockData, stocks } = this.state;
        const newStockData = { ...stockData };
        for (const sym of stocks) {
            if (!newStockData[sym]) continue;
            const visible = symbol ? (sym === symbol) : true;
            if (newStockData[sym].visible !== visible) {
                engine.setStockVisible(sym, visible);
                newStockData[sym] = { ...newStockData[sym], visible };
            }
        }

        const stockDetail = symbol
            ? (engine.getStockDetail(symbol) || null)
            : null;
        this.setState({
            selectedStock: symbol,
            selectedYear: 'Average',
            stockData: newStockData,
            stockDetail
        }, () => {
            this.refreshBasket();
        });
    }

    handleToggleVisible = (symbol) => {
        const { stockData } = this.state;
        if (!stockData[symbol]) return;

        const newVisible = !stockData[symbol].visible;
        engine.setStockVisible(symbol, newVisible);

        this.setState({
            stockData: {
                ...stockData,
                [symbol]: { ...stockData[symbol], visible: newVisible }
            }
        }, () => {
            this.refreshBasket();
        });
    }

    handleToggleExpand = (symbol) => {
        this.setState(prev => ({
            expandedStock: prev.expandedStock === symbol ? null : symbol
        }));
    }

    handleParamChange = (symbol, params) => {
        const { stockData } = this.state;
        if (!stockData[symbol]) return;

        // Update slider value in state immediately so UI stays responsive
        this.setState({
            stockData: {
                ...stockData,
                [symbol]: { ...stockData[symbol], params: { ...params } }
            }
        });

        // Coalesce engine recomputation to next animation frame, while keeping
        // the latest pending params for every stock touched during this frame.
        this._pendingParamChanges[symbol] = params;
        if (this._paramChangeRaf) return;

        this._paramChangeRaf = requestAnimationFrame(() => {
            this._paramChangeRaf = 0;
            const pending = this._pendingParamChanges;
            this._pendingParamChanges = {};

            for (const [pendingSymbol, pendingParams] of Object.entries(pending)) {
                engine.updateStockParams(pendingSymbol, pendingParams);
            }
            this.refreshAll(this.state.selectedStock);
        });
    }

    // Auto-optimize: brute-force grid search in C++ engine over (nWinMin, fPctWin).
    // Shows blocking overlay while running. Engine call is synchronous (~8000
    // updatePlan iterations); wrap in setTimeout so the overlay paints first.
    handleOptimize = (symbol) => {
        const { stockData } = this.state;
        if (!stockData[symbol]) return;
        this.setState({ optimizing: symbol }, () => {
            setTimeout(() => {
                try {
                    const best = engine.optimizeStockParams(symbol);
                    if (best && this.state.stockData[symbol]) {
                        const newParams = {
                            ...this.state.stockData[symbol].params,
                            nWinMin: best.nWinMin,
                            fPctWin: best.pctThreshold
                        };
                        this.setState({
                            stockData: {
                                ...this.state.stockData,
                                [symbol]: { ...this.state.stockData[symbol], params: newParams }
                            }
                        }, () => this.refreshAll(this.state.selectedStock));
                    }
                } catch (e) {
                    console.error('optimize failed', e);
                } finally {
                    this.setState({ optimizing: null });
                }
            }, 30);
        });
    }

    // Brute-force search basket weight composition (5% step ≤5 stocks else
    // 10%) to maximize basket plan return at last day. Switches to Custom
    // alloc mode and writes the chosen weights into stockData[s].allocPct
    // (×100) so UI sliders / persistence stay in sync.
    handleOptimizeAllocation = () => {
        const { stocks } = this.state;
        if (stocks.length === 0) return;
        // Run synchronously without the blocking overlay — allocation
        // optimization is fast and the modal would only flicker.
        try {
            const arrW = engine.optimizeAllocation();   // engine-order, sums to 1
            if (!arrW || arrW.length !== stocks.length) {
                console.error('optimizeAllocation: length mismatch', arrW);
                return;
            }
            const sd = { ...this.state.stockData };
            for (let i = 0; i < stocks.length; i++) {
                const sym = stocks[i];
                if (!sd[sym]) continue;
                sd[sym] = { ...sd[sym], allocPct: arrW[i] * 100 };
            }
            this.setState({ stockData: sd, allocMode: 'custom' }, () => {
                this.pushCustomWeightsToEngine();
                this.refreshAll(this.state.selectedStock);
            });
        } catch (e) {
            console.error('optimizeAllocation failed', e);
        }
    }

    // Global "Sample years" (display window). Drives getGraphData(N) only.
    // Independent of each stock's params.nYears (stats lookback). When N
    // exceeds a stock's nYears the engine still applies the same trade plan
    // to older years (out-of-sample backtest).
    //
    // value = positive int OR 'max' (max nDataYears across loaded stocks).
    handleDisplayYearsChange = (value) => {
        const { stocks, stockData, selectedYear, basketResult } = this.state;

        let n;
        if (value === 'max') {
            let nMax = 0;
            for (const s of stocks) {
                const v = stockData[s]?.nDataYears || 0;
                if (v > nMax) nMax = v;
            }
            n = Math.max(1, nMax || 25);
        } else {
            n = parseInt(value, 10);
            if (!Number.isFinite(n) || n < 1) n = 10;
        }

        // If currently selected year would fall outside the new window, snap
        // back to "Average" so the line chart stays valid.
        const arrYears = Array.isArray(basketResult?.years) ? basketResult.years : [];
        const iLastYear = arrYears.length > 0 ? Math.max(...arrYears) : (new Date().getFullYear() - 1);
        const iEarliest = iLastYear - n + 1;
        const nextSelectedYear = (typeof selectedYear === 'number' && selectedYear < iEarliest)
            ? 'Average'
            : selectedYear;

        this.setState({ displayYears: n, selectedYear: nextSelectedYear }, () => {
            this.refreshAll(this.state.selectedStock);
        });
    }

    // ------------------------------------------------------------------
    // Allocation
    // ------------------------------------------------------------------

    handleAllocModeChange = (mode) => {
        this.setState({ allocMode: mode }, () => {
            if (mode === 'custom') {
                // Push current per-stock allocPct values down to the engine.
                this.pushCustomWeightsToEngine();
            } else {
                engine.setAllocMode(mode);
            }
            this.refreshBasket();
        });
    }

    // Update custom allocation for a stock by delta (e.g. +5 or -5).
    // Distributes the opposite proportionally among other visible stocks while
    // preserving a 5% minimum for every other visible stock. After the state
    // mutation we push the updated weight vector down to the engine and
    // refresh the basket so the chart reflects the new allocation.
    handleUpdateAllocPct = (symbol, delta) => {
        this.setState(prev => {
            const { stocks, stockData } = prev;
            const visibleStocks = stocks.filter(s => stockData[s]?.visible);
            if (visibleStocks.length < 2 || !stockData[symbol]) return null;

            const oldPct = stockData[symbol].allocPct || 0;
            let newPct = oldPct + delta;

            // Clamp: min 5%, max so every other stock can keep at least 5%
            const maxPct = 100 - 5 * (visibleStocks.length - 1);
            newPct = Math.max(5, Math.min(maxPct, newPct));

            const updated = { ...stockData };
            for (const s of visibleStocks) {
                updated[s] = { ...updated[s] };
            }
            updated[symbol].allocPct = newPct;

            const others = visibleStocks.filter(s => s !== symbol);
            const oldOthersTotal = others.reduce((sum, s) => sum + (stockData[s].allocPct || 0), 0);
            if (oldOthersTotal <= 0) return null;

            if (newPct >= oldPct) {
                const oldFlexibleTotal = others.reduce(
                    (sum, s) => sum + Math.max(0, (stockData[s].allocPct || 0) - 5),
                    0
                );
                const newFlexibleTotal = 100 - newPct - 5 * others.length;
                if (oldFlexibleTotal <= 0 && newFlexibleTotal <= 0) return null;

                for (const s of others) {
                    const oldOther = stockData[s].allocPct || 0;
                    const oldFlexible = Math.max(0, oldOther - 5);
                    const share = oldFlexibleTotal > 0 ? oldFlexible / oldFlexibleTotal : 1 / others.length;
                    updated[s].allocPct = 5 + share * Math.max(0, newFlexibleTotal);
                }
            } else {
                const newOthersTotal = 100 - newPct;
                for (const s of others) {
                    const oldOther = stockData[s].allocPct || 0;
                    updated[s].allocPct = (oldOther / oldOthersTotal) * newOthersTotal;
                }
            }

            return { stockData: updated };
        }, () => {
            // Push fresh custom weights to the engine and recompute the basket.
            this.pushCustomWeightsToEngine();
            this.refreshBasket();
        });
    }

    // Build weight vector from current stockData and push to engine in 'custom'
    // allocation mode. Order must match engine's m_arrStocks (= state.stocks
    // append order, since both grow via the same addStock flow). Hidden stocks
    // contribute 0; visible weights are normalized so the total sums to 1.
    pushCustomWeightsToEngine = () => {
        const { stocks, stockData } = this.state;
        if (stocks.length === 0) return;

        const arr = stocks.map(s => {
            const sd = stockData[s];
            if (!sd || sd.visible === false) return 0;
            return Math.max(0, sd.allocPct || 0);
        });
        const total = arr.reduce((sum, w) => sum + w, 0);
        const normalized = total > 0 ? arr.map(w => w / total) : arr;

        engine.setAllocMode('custom', normalized);
    }

    // ------------------------------------------------------------------
    // Graph controls
    // ------------------------------------------------------------------

    handleViewModeChange = (mode) => {
        this.setState({ viewMode: mode });
    }

    handleYearChange = (year) => {
        this.setState({ selectedYear: year });
    }

    // Snapshot the currently-displayed alloc weights into stockData[s].allocPct
    // and switch allocMode to 'custom'. Source matches the alloc bar:
    //   line view + numeric year -> that year's weights
    //   bar view OR 'Average'    -> average weights across all years ("0" key)
    // Only visible stocks contribute. Pcts are normalized to 100.
    handleCopyToCustom = () => {
        const { basketResult, stocks, stockData, viewMode, selectedYear } = this.state;
        if (!basketResult || stocks.length === 0) return;

        const wMap = basketResult.weightsPerStock || {};
        const useAverage = viewMode === 'bar' || selectedYear === 'Average';
        const yearKey = useAverage ? '0' : String(parseInt(selectedYear));

        // Only visible stocks contribute.
        const visible = stocks
            .filter(s => stockData[s]?.visible !== false)
            .map(s => {
                const wByYear = wMap[s] || {};
                const w = wByYear[yearKey];
                return { s, w: (w !== undefined ? w : (wByYear['0'] || 0)) };
            });

        const total = visible.reduce((sum, { w }) => sum + w, 0);
        if (total <= 0) return;

        const updated = { ...stockData };
        for (const { s, w } of visible) {
            updated[s] = { ...updated[s], allocPct: (w / total) * 100 };
        }

        engine.setAllocMode('custom');
        this.setState({ stockData: updated, allocMode: 'custom' }, () => {
            this.pushCustomWeightsToEngine();
            this.refreshBasket();
        });
    }

    handleOpenModal = () => {
        this.setState({ modalOpen: true });
    }

    handleCloseModal = () => {
        this.setState({ modalOpen: false });
    }

    // Export a Google-Sheets-ready backtest CSV. Prompts for which year to
    // export (the engine produces one year's worth of trade rows per call).
    handleExportCsv = async () => {
        const { basketResult, basketName } = this.state;
        const arrYears = Array.isArray(basketResult?.years) ? basketResult.years : [];
        if (arrYears.length === 0) {
            alert('No basket data — add stocks first.');
            return;
        }

        const sortedDesc = [...arrYears].sort((a, b) => b - a);
        const sDefault = String(sortedDesc[0]);
        const sPrompt =
            `Export backtest for which year?\n\n` +
            `Available: ${sortedDesc.join(', ')}\n` +
            `Enter a year, or leave blank to use ${sDefault}.`;
        const sInput = window.prompt(sPrompt, sDefault);
        if (sInput === null) return;  // cancelled

        const sTrimmed = sInput.trim();
        const nYear = sTrimmed === '' ? sortedDesc[0] : parseInt(sTrimmed, 10);
        if (!Number.isFinite(nYear) || !arrYears.includes(nYear)) {
            alert(`Year ${sTrimmed} not in basket data.`);
            return;
        }

        const sCsv = engine.exportVerifyCsv(nYear);
        if (!sCsv) return;

        const blob = new Blob([sCsv], { type: 'text/csv;charset=utf-8;' });
        const sFileName = `backtest_${basketName || 'basket'}_${nYear}.csv`;

        if (typeof window.showSaveFilePicker === 'function') {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: sFileName,
                    types: [{
                        description: 'Backtest CSV',
                        accept: { 'text/csv': ['.csv'] }
                    }]
                });
                const w = await handle.createWritable();
                await w.write(blob);
                await w.close();
                return;
            } catch (e) {
                if (e?.name === 'AbortError') return;
                console.warn('showSaveFilePicker failed, falling back:', e);
            }
        }

        const sUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = sUrl;
        a.download = sFileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(sUrl);
    }

    // Export a trade calendar CSV: Date | Stock1 | Stock2 | ... with BUY/SELL
    // tokens on action days only. Year-agnostic (uses MM-DD); the same windows
    // apply every calendar year.
    handleExportCalendar = async () => {
        const { stocks, basketName } = this.state;
        if (!stocks || stocks.length === 0) {
            alert('Basket is empty.');
            return;
        }

        const sCsv = engine.exportTradeCalendarCsv();
        console.log('[calendar] csv length:', sCsv?.length, 'preview:', sCsv?.slice(0, 200));
        if (!sCsv) {
            alert('Engine returned empty CSV.');
            return;
        }
        const arrLines = sCsv.split('\n').filter(l => l.length > 0);
        if (arrLines.length <= 1) {
            alert('No trade windows found.');
            return;
        }

        const blob = new Blob([sCsv], { type: 'text/csv;charset=utf-8;' });
        const sFileName = `calendar_${basketName || 'basket'}.csv`;

        if (typeof window.showSaveFilePicker === 'function') {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: sFileName,
                    types: [{ description: 'Trade Calendar CSV', accept: { 'text/csv': ['.csv'] } }]
                });
                const w = await handle.createWritable();
                await w.write(blob);
                await w.close();
                return;
            } catch (e) {
                if (e?.name === 'AbortError') return;
                console.warn('showSaveFilePicker failed, falling back:', e);
            }
        }

        const sUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = sUrl;
        a.download = sFileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(sUrl);
    }

    // Save current basket (stocks + params + alloc) to a JSON file.
    // Uses showSaveFilePicker (Chromium) when available so the user gets a
    // real "Save As" dialog; falls back to <a download> elsewhere.
    handleSaveBasket = async () => {
        const { stocks, stockData, allocMode, basketName } = this.state;

        if (stocks.length === 0) {
            alert('Basket is empty — nothing to save.');
            return;
        }

        const payload = {
            version: 1,
            name: basketName || 'basket',
            allocMode,
            stocks: stocks.map(s => {
                const sd = stockData[s] || {};
                const p = sd.params || {};
                return {
                    symbol: s,
                    nYears:   p.nYears   ?? 10,
                    nWinMin:  p.nWinMin  ?? 10,
                    nWinMax:  p.nWinMax  ?? 31,
                    fPctWin:  p.fPctWin  ?? 60,
                    allocPct: sd.allocPct ?? (100 / stocks.length),
                    visible:  sd.visible !== false
                };
            })
        };

        const sJson = JSON.stringify(payload, null, 2);
        const blob = new Blob([sJson], { type: 'application/json;charset=utf-8;' });
        const sFileName = `${basketName || 'basket'}.json`;

        if (typeof window.showSaveFilePicker === 'function') {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: sFileName,
                    types: [{
                        description: 'Meguru basket',
                        accept: { 'application/json': ['.json'] }
                    }]
                });
                const w = await handle.createWritable();
                await w.write(blob);
                await w.close();
                return;
            } catch (e) {
                if (e?.name === 'AbortError') return;  // user cancelled
                console.warn('showSaveFilePicker failed, falling back:', e);
            }
        }

        // Fallback: anchor download
        const sUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = sUrl;
        a.download = sFileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(sUrl);
    }

    // Load a basket from a JSON file. Replaces current basket entirely.
    // Triggered by BasketList; receives a File object from the hidden input.
    handleLoadBasket = async (file) => {
        if (!file) return;

        let payload;
        try {
            const sText = await file.text();
            payload = JSON.parse(sText);
        } catch (err) {
            alert('Failed to read basket file: ' + err.message);
            return;
        }

        if (!payload || payload.version !== 1 || !Array.isArray(payload.stocks)) {
            alert('Not a valid basket file.');
            return;
        }

        // --- Tear down current basket (engine + state) ---
        const { stocks: oldStocks } = this.state;
        for (const s of oldStocks) {
            engine.removeStock(s);
        }

        this.setState({
            stocks: [],
            stockData: {},
            selectedStock: null,
            expandedStock: null,
            basketResult: null,
            stockDetail: null
        });

        // --- Add each stock from payload ---
        const allocMode = payload.allocMode || 'equal';
        // Set non-custom modes immediately; custom needs weights *and* the
        // stock list populated, so we set it after addStock() completes.
        if (allocMode !== 'custom') engine.setAllocMode(allocMode);

        const newStocks = [];
        const newStockData = {};

        const nTotal = payload.stocks.length;
        let nDone = 0;
        this.setState({
            loadingBasket: {
                sSymbol: '', nDone: 0, nTotal,
                sPhase: 'scanning',
                nYear: null, nYearDone: 0, nYearTotal: 0,
                sStatus: '', sMessage: ''
            }
        });

        for (const entry of payload.stocks) {
            const symbol = entry.symbol;
            if (!symbol) continue;

            const params = {
                nYears:  entry.nYears  ?? 10,
                nWinMin: entry.nWinMin ?? 10,
                nWinMax: entry.nWinMax ?? 31,
                fPctWin: entry.fPctWin ?? 60
            };

            // Show which stock we're working on
            this.setState({
                loadingBasket: {
                    sSymbol: symbol, nDone, nTotal,
                    sPhase: 'scanning',
                    nYear: null, nYearDone: 0, nYearTotal: 0,
                    sStatus: '', sMessage: ''
                }
            });

            // Ensure data is in OPFS — download missing years from Yahoo if needed.
            const onProg = (entry) => {
                this.setState((prev) => {
                    if (!prev.loadingBasket) return null;
                    return {
                        loadingBasket: {
                            ...prev.loadingBasket,
                            sPhase:     entry.sPhase     ?? prev.loadingBasket.sPhase,
                            nYear:      entry.nYear      ?? prev.loadingBasket.nYear,
                            nYearDone:  entry.nYearDone  ?? prev.loadingBasket.nYearDone,
                            nYearTotal: entry.nYearTotal ?? prev.loadingBasket.nYearTotal,
                            sStatus:    entry.sStatus    ?? prev.loadingBasket.sStatus,
                            sMessage:   entry.sMessage   ?? prev.loadingBasket.sMessage
                        }
                    };
                });
            };
            try {
                await ensureStockData(symbol, onProg);
            } catch (err) {
                console.warn(`Failed to fetch data for ${symbol}:`, err.message);
            }

            // engine.addStock reads OPFS data; if still unavailable, skip silently.
            try {
                await engine.addStock(symbol, params);
            } catch (err) {
                console.warn(`Failed to load ${symbol}:`, err.message);
                nDone++;
                continue;
            }

            newStocks.push(symbol);
            newStockData[symbol] = {
                params,
                visible: entry.visible !== false,
                allocPct: entry.allocPct ?? (100 / payload.stocks.length),
                nDataYears: params.nYears,
                color: '#888'
            };

            if (entry.visible === false) {
                engine.setStockVisible(symbol, false);
            }
            nDone++;
        }

        this.setState({ loadingBasket: null });

        // Recompute colors in insertion order
        const finalStockData = this.recomputeColors(newStocks, newStockData);

        this.setState({
            stocks: newStocks,
            stockData: finalStockData,
            allocMode,
            basketName: (typeof payload.name === 'string' && payload.name) ? payload.name : 'basket'
        }, () => {
            if (allocMode === 'custom') this.pushCustomWeightsToEngine();
            this.refreshAll(null);
        });
    }

    // ------------------------------------------------------------------
    // Render
    // ------------------------------------------------------------------

    render() {
        const {
            stocks, stockData, selectedStock, expandedStock, modalOpen,
            fetchModalData, allocMode, viewMode, selectedYear, displayYears,
            basketResult, stockDetail
        } = this.state;

        return (
            <div className="app">
                {/* Main area: basket list + graph */}
                <div className="main-area">
                    <BasketList
                        stocks={stocks}
                        stockData={stockData}
                        selectedStock={selectedStock}
                        expandedStock={expandedStock}
                        onSelect={this.handleSelectStock}
                        onToggleVisible={this.handleToggleVisible}
                        onRemove={this.handleRemoveStock}
                        onToggleExpand={this.handleToggleExpand}
                        onParamChange={this.handleParamChange}
                        onOpenModal={this.handleOpenModal}
                        onSaveBasket={this.handleSaveBasket}
                        onLoadBasket={this.handleLoadBasket}
                        onOptimize={this.handleOptimize}
                    />

                    <BasketGraph
                        selectedStock={selectedStock}
                        basketResult={basketResult}
                        stockDetail={stockDetail}
                        stockData={stockData}
                        stocks={stocks}
                        allocMode={allocMode}
                        allocModes={ALLOC_MODES}
                        viewMode={viewMode}
                        selectedYear={selectedYear}
                        onViewModeChange={this.handleViewModeChange}
                        onYearChange={this.handleYearChange}
                        onAllocModeChange={this.handleAllocModeChange}
                        onUpdateAllocPct={this.handleUpdateAllocPct}
                        onCopyToCustom={this.handleCopyToCustom}
                        onExportCsv={this.handleExportCsv}
                        onExportCalendar={this.handleExportCalendar}
                        onOptimizeAllocation={this.handleOptimizeAllocation}
                        onDisplayYearsChange={this.handleDisplayYearsChange}
                        displayYears={displayYears}
                        onOpenHelp={() => this.setState({ helpOpen: true })}
                    />
                </div>

                {/* Bottom stats panel */}
                <StatsPanel
                    selectedStock={selectedStock}
                    stockDetail={stockDetail}
                    basketResult={basketResult}
                    stockData={stockData}
                />

                {/* New stock modal */}
                {modalOpen && (
                    <NewStockModal
                        existingStocks={stocks}
                        onAdd={this.handleAddStock}
                        onClose={this.handleCloseModal}
                    />
                )}

                {/* Fetch progress modal */}
                {fetchModalData && (
                    <FetchModal
                        sSymbol={fetchModalData.sSymbol}
                        params={fetchModalData.params}
                        onComplete={this.handleFetchComplete}
                        onCancel={this.handleFetchCancel}
                    />
                )}

                {/* Auto-optimize blocking overlay */}
                {this.state.optimizing && (
                    <div className="optimize-overlay">
                        <div className="optimize-modal">
                            <div className="optimize-spinner">{'\u{1F4A1}'}</div>
                            <div className="optimize-title">
                                {this.state.optimizing === '__alloc__'
                                    ? 'Optimizing allocation…'
                                    : `Optimizing ${this.state.optimizing}…`}
                            </div>
                            <div className="optimize-sub">
                                {this.state.optimizing === '__alloc__'
                                    ? 'Searching weight compositions'
                                    : 'Finding ideal parameters'}
                            </div>
                        </div>
                    </div>
                )}

                {/* Basket loading overlay */}
                {this.state.loadingBasket && (() => {
                    const lb = this.state.loadingBasket;
                    const stockPct = lb.nTotal > 0
                        ? Math.round((lb.nDone / lb.nTotal) * 100) : 0;
                    const yearPct = lb.nYearTotal > 0
                        ? Math.round((lb.nYearDone / lb.nYearTotal) * 100) : 0;
                    let sub;
                    if (!lb.sSymbol) {
                        sub = `Preparing (${lb.nTotal} stocks)`;
                    } else if (lb.sPhase === 'scanning') {
                        sub = `${lb.sSymbol} \u2014 scanning cache\u2026`;
                    } else if (lb.sPhase === 'cached') {
                        sub = `${lb.sSymbol} \u2014 cached`;
                    } else if (lb.sPhase === 'fetching') {
                        const yr = lb.nYear ? ` ${lb.nYear}` : '';
                        sub = `${lb.sSymbol} \u2014 fetching${yr} (${lb.nYearDone}/${lb.nYearTotal} years)`;
                    } else {
                        sub = lb.sSymbol;
                    }
                    return (
                        <div className="optimize-overlay">
                            <div className="optimize-modal" style={{ minWidth: 360 }}>
                                <div className="optimize-spinner">{'\u{1F4BE}'}</div>
                                <div className="optimize-title">
                                    {`Loading basket\u2026 (${lb.nDone}/${lb.nTotal})`}
                                </div>
                                <div className="optimize-sub">{sub}</div>
                                {/* Overall basket progress */}
                                <div style={{
                                    marginTop: 12, height: 6, width: '100%',
                                    background: '#222', borderRadius: 3, overflow: 'hidden'
                                }}>
                                    <div style={{
                                        height: '100%', width: `${stockPct}%`,
                                        background: '#4a90e2', transition: 'width 0.2s'
                                    }} />
                                </div>
                                {/* Per-stock year progress */}
                                {lb.sPhase === 'fetching' && lb.nYearTotal > 0 && (
                                    <div style={{
                                        marginTop: 6, height: 4, width: '100%',
                                        background: '#222', borderRadius: 2, overflow: 'hidden'
                                    }}>
                                        <div style={{
                                            height: '100%', width: `${yearPct}%`,
                                            background: '#7ab8ff', transition: 'width 0.2s'
                                        }} />
                                    </div>
                                )}
                                {lb.sMessage && (
                                    <div style={{
                                        marginTop: 8, fontSize: 11, color: '#888',
                                        textAlign: 'center'
                                    }}>{lb.sMessage}</div>
                                )}
                            </div>
                        </div>
                    );
                })()}

                {/* Help modal */}
                {this.state.helpOpen && (
                    <HelpModal onClose={() => this.setState({ helpOpen: false })} />
                )}
            </div>
        );
    }
}

// Mount the app
render(<App />, document.getElementById('app'));

export default App;
