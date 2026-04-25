import { Component, render } from 'preact';
import engine, { initEngine } from '../wasm/engine.js';
import { getBasketColors } from './utils';
import BasketList from './BasketList';
import BasketGraph from './BasketGraph';
import StatsPanel from './StatsPanel';
import NewStockModal from './NewStockModal';
import FetchModal from './FetchModal';
import './styles.css';

// Root application component.
// Manages all state, calls mock engine on changes, passes props to children.
// No top bar — "New" button lives in basket header, allocation controls in graph controls.

const ALLOC_MODES = [
    { value: 'equal', label: 'Equal' },
    { value: 'mcap', label: 'Market Cap' },
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
            // Engine results (parsed JSON)
            basketResult: null,
            stockDetail: null
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
                           'allocMode', 'viewMode', 'selectedYear'];
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
                allocMode, viewMode, selectedYear } = this.state;

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
                selectedYear
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
            selectedYear: saved.selectedYear || 'Average'
        }, () => {
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
        const basketResult = engine.getGraphData(10);
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
        // symbol is null to deselect, or a stock name to select
        // Set selectedStock and stockDetail together to avoid a render
        // where selectedStock changed but stockDetail is still stale/null,
        // which causes BasketGraph to recreate the chart with no data.
        const stockDetail = symbol
            ? (engine.getStockDetail(symbol) || null)
            : null;
        this.setState({
            selectedStock: symbol,
            selectedYear: 'Average',
            stockDetail
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

    // ------------------------------------------------------------------
    // Allocation
    // ------------------------------------------------------------------

    handleAllocModeChange = (mode) => {
        engine.setAllocMode(mode);
        this.setState({ allocMode: mode }, () => {
            this.refreshBasket();
        });
    }

    // Update custom allocation for a stock by delta (e.g. +5 or -5).
    // Distributes the opposite proportionally among other visible stocks while
    // preserving a 5% minimum for every other visible stock.
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
        });
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

    handleOpenModal = () => {
        this.setState({ modalOpen: true });
    }

    handleCloseModal = () => {
        this.setState({ modalOpen: false });
    }

    // Export a Google-Sheets-ready verification CSV for the current year.
    // selectedYear may be "Average" — pass 0 to let the engine pick (curYear-1).
    handleExportCsv = () => {
        const { selectedYear } = this.state;
        const year = (typeof selectedYear === 'number') ? selectedYear : 0;
        const sCsv = engine.exportVerifyCsv(year);
        if (!sCsv) return;

        const sLabel = (year > 0) ? String(year) : 'latest';
        const blob = new Blob([sCsv], { type: 'text/csv;charset=utf-8;' });
        const sUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = sUrl;
        a.download = `meguru_verify_${sLabel}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(sUrl);
    }

    // ------------------------------------------------------------------
    // Save / load basket to/from JSON file
    // ------------------------------------------------------------------

    // Save current basket (stocks + params + alloc) to a JSON file.
    // User provides a name via prompt; name also becomes the filename.
    handleSaveBasket = () => {
        const { stocks, stockData, allocMode } = this.state;

        if (stocks.length === 0) {
            alert('Basket is empty — nothing to save.');
            return;
        }

        const sDefault = 'basket';
        const sName = prompt('Name this basket:', sDefault);
        if (sName === null) return;  // user cancelled
        const sSafe = (sName.trim() || sDefault).replace(/[^\w\-.]/g, '_');

        const payload = {
            version: 1,
            name: sName.trim() || sDefault,
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
                    // Only meaningful in custom alloc, but always snapshotted.
                    allocPct: sd.allocPct ?? (100 / stocks.length),
                    visible:  sd.visible !== false
                };
            })
        };

        const sJson = JSON.stringify(payload, null, 2);
        const blob = new Blob([sJson], { type: 'application/json;charset=utf-8;' });
        const sUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = sUrl;
        a.download = `${sSafe}.json`;
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
        engine.setAllocMode(allocMode);

        const newStocks = [];
        const newStockData = {};

        for (const entry of payload.stocks) {
            const symbol = entry.symbol;
            if (!symbol) continue;

            const params = {
                nYears:  entry.nYears  ?? 10,
                nWinMin: entry.nWinMin ?? 10,
                nWinMax: entry.nWinMax ?? 31,
                fPctWin: entry.fPctWin ?? 60
            };

            // engine.addStock reads OPFS data; if unavailable, skip silently.
            try {
                await engine.addStock(symbol, params);
            } catch (err) {
                console.warn(`Failed to load ${symbol}:`, err.message);
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
        }

        // Recompute colors in insertion order
        const finalStockData = this.recomputeColors(newStocks, newStockData);

        this.setState({
            stocks: newStocks,
            stockData: finalStockData,
            allocMode
        }, () => {
            this.refreshAll(null);
        });
    }

    // ------------------------------------------------------------------
    // Render
    // ------------------------------------------------------------------

    render() {
        const {
            stocks, stockData, selectedStock, expandedStock, modalOpen,
            fetchModalData, allocMode, viewMode, selectedYear, basketResult, stockDetail
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
                        onExportCsv={this.handleExportCsv}
                    />
                </div>

                {/* Bottom stats panel */}
                <StatsPanel
                    selectedStock={selectedStock}
                    stockDetail={stockDetail}
                    basketResult={basketResult}
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
            </div>
        );
    }
}

// Mount the app
render(<App />, document.getElementById('app'));

export default App;
