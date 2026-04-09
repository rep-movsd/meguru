import { Component, render } from 'preact';
import engine from '../wasm/engine';
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

class App extends Component {
    constructor(props) {
        super(props);
        this.state = {
            // Stock list (insertion order)
            stocks: [],
            // Per-stock data: { [symbol]: { params, visible, color, allocPct } }
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

    // ------------------------------------------------------------------
    // Engine refresh helpers
    // ------------------------------------------------------------------

    refreshBasket = () => {
        const raw = engine.getBasketResult();
        if (!raw) {
            this.setState({ basketResult: null });
            return;
        }
        try {
            const basketResult = JSON.parse(raw);
            this.setState({ basketResult });
        } catch {
            this.setState({ basketResult: null });
        }
    }

    refreshStockDetail = (symbol) => {
        if (!symbol) {
            this.setState({ stockDetail: null });
            return;
        }
        const raw = engine.getStockDetail(symbol);
        if (!raw) {
            this.setState({ stockDetail: null });
            return;
        }
        try {
            const stockDetail = JSON.parse(raw);
            this.setState({ stockDetail });
        } catch {
            this.setState({ stockDetail: null });
        }
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
    handleFetchComplete = (symbol, params, nDataYears) => {
        const { stocks, stockData } = this.state;

        // Clamp nYears to available data
        const nMaxYears = Math.max(1, nDataYears || 1);
        const clampedParams = { ...params, nYears: Math.min(params.nYears, nMaxYears) };

        // Add to engine
        engine.addStock(symbol, clampedParams);

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
        let stockDetail = null;
        if (symbol) {
            const raw = engine.getStockDetail(symbol);
            if (raw) {
                try { stockDetail = JSON.parse(raw); } catch {}
            }
        }
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

        // Coalesce engine recomputation to next animation frame
        cancelAnimationFrame(this._paramChangeRaf);
        this._paramChangeRaf = requestAnimationFrame(() => {
            engine.updateStockParams(symbol, params);
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
    // Distributes the opposite proportionally among other visible stocks,
    // clamping each at a minimum of 5%.
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
            const actualDelta = newPct - oldPct;
            if (Math.abs(actualDelta) < 0.01) return null;

            const updated = { ...stockData };
            for (const s of visibleStocks) {
                updated[s] = { ...updated[s] };
            }
            updated[symbol].allocPct = newPct;

            // Distribute -actualDelta proportionally among other visible stocks
            const others = visibleStocks.filter(s => s !== symbol);
            const othersTotal = others.reduce((sum, s) => sum + (updated[s].allocPct || 0), 0);

            if (othersTotal > 0) {
                for (const s of others) {
                    const oldOther = updated[s].allocPct || 0;
                    const share = (oldOther / othersTotal) * (-actualDelta);
                    updated[s].allocPct = Math.max(5, oldOther + share);
                }
            }

            // Renormalize to exactly 100%
            const finalData = this.renormalizeAllocPct(updated, stocks);
            return { stockData: finalData };
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
