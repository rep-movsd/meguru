import { Component } from 'preact';

// Basket list with per-stock accordion expanders containing param sliders.
//
// Props:
//   stocks: string[] - ordered list of symbols
//   stockData: { [symbol]: { params, visible, color } }
//   selectedStock: string|null
//   expandedStock: string|null
//   onSelect: (symbol) => void
//   onToggleVisible: (symbol) => void
//   onRemove: (symbol) => void
//   onToggleExpand: (symbol) => void
//   onParamChange: (symbol, params) => void
//   onOpenModal: () => void
//   onSaveBasket: () => void
//   onLoadBasket: (File) => void
//   onOptimize: (symbol) => void

class BasketList extends Component {

    constructor(props) {
        super(props);
        this.state = {
            examplesOpen: false,
            examples: null,        // null = not yet fetched, [] = empty, [{label, description, file}]
            examplesError: null,
            menuPos: null          // { left, bottom, minWidth } in viewport px
        };
    }

    componentDidMount() {
        this._onDocClick = (e) => {
            if (!this.state.examplesOpen) return;
            if (this._examplesRoot && this._examplesRoot.contains(e.target)) return;
            if (this._menuEl && this._menuEl.contains(e.target)) return;
            this.setState({ examplesOpen: false });
        };
        this._onResize = () => {
            if (this.state.examplesOpen) this.setState({ examplesOpen: false });
        };
        document.addEventListener('mousedown', this._onDocClick);
        window.addEventListener('resize', this._onResize);
        window.addEventListener('scroll', this._onResize, true);
    }

    componentWillUnmount() {
        document.removeEventListener('mousedown', this._onDocClick);
        window.removeEventListener('resize', this._onResize);
        window.removeEventListener('scroll', this._onResize, true);
    }

    fetchExamples = async () => {
        if (this.state.examples) return;
        try {
            const r = await fetch('baskets/index.json', { cache: 'no-store' });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const j = await r.json();
            this.setState({ examples: j.examples || [], examplesError: null });
        } catch (err) {
            this.setState({ examples: [], examplesError: err.message });
        }
    }

    handleExamplesClick = () => {
        const open = !this.state.examplesOpen;
        if (!open) {
            this.setState({ examplesOpen: false });
            return;
        }
        // Compute menu position from button's viewport rect so the menu can
        // escape the basket-list's overflow:hidden clipping using fixed pos.
        let menuPos = null;
        if (this._examplesRoot) {
            const r = this._examplesRoot.getBoundingClientRect();
            menuPos = {
                left: r.left,
                bottom: window.innerHeight - r.top + 4,    // 4px gap above button
                minWidth: r.width
            };
        }
        this.setState({ examplesOpen: true, menuPos });
        this.fetchExamples();
    }

    handleExamplePick = async (file) => {
        this.setState({ examplesOpen: false });
        const { onLoadBasket } = this.props;
        if (!onLoadBasket) return;
        try {
            const r = await fetch('baskets/' + file, { cache: 'no-store' });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const payload = await r.json();
            onLoadBasket(payload);
        } catch (err) {
            alert('Failed to load example basket: ' + err.message);
        }
    }

    handleSliderChange = (stock, field, value) => {
        const { stockData, onParamChange } = this.props;
        if (!stockData[stock] || !onParamChange) return;
        const newParams = { ...stockData[stock].params, [field]: value };

        // When nYears changes, snap fPctWin to the nearest valid step
        if (field === 'nYears') {
            const fStep = 100 / value;
            const fMin = Math.ceil(50 / fStep) * fStep;
            newParams.fPctWin = Math.round(newParams.fPctWin / fStep) * fStep;
            // Clamp to [fMin, 100] — Win% floor 50%
            newParams.fPctWin = Math.max(fMin, Math.min(100, newParams.fPctWin));
            newParams.fPctWin = +newParams.fPctWin.toFixed(2);
        }

        onParamChange(stock, newParams);
    }

    handleLoadClick = () => {
        if (this._fileInput) this._fileInput.click();
    }

    handleFileChange = (e) => {
        const { onLoadBasket } = this.props;
        const file = e.target.files && e.target.files[0];
        if (file && onLoadBasket) onLoadBasket(file);
        // Clear value so picking the same file twice still fires onChange
        e.target.value = '';
    }

    render() {
        const { stocks, stockData, selectedStock, expandedStock,
                onSelect, onToggleVisible, onRemove, onToggleExpand, onOpenModal,
                onSaveBasket, basketName, onBasketNameChange, onOpenHelp } = this.props;

        return (
            <div className="basket-list">
                <div className="basket-header">
                    <h2>
                        <span className="basket-kanji" aria-hidden="true">{'\u5DE1'}</span>
                        Meguru
                    </h2>
                    <button
                        className="help-circle-btn"
                        onClick={onOpenHelp}
                        title="Help"
                        aria-label="Help"
                    >?</button>
                </div>

                <div className="basket-name-row">
                    <label className="basket-name-label" htmlFor="basket-name-input">Basket name:</label>
                    <input
                        id="basket-name-input"
                        type="text"
                        className="basket-name-input"
                        value={basketName || ''}
                        placeholder="basket name"
                        onChange={(e) => onBasketNameChange && onBasketNameChange(e.target.value)}
                        title="Basket name (saved with basket JSON)"
                    />
                </div>

                <div className="basket-items">
                    {/* Add / Clear row — always at top */}
                    <div className="basket-item add-stock-tile">
                        <button
                            className="add-stock-btn"
                            onClick={onOpenModal}
                            title="Add a new stock to the basket"
                        >
                            <span className="add-stock-plus">+</span>
                            <span className="add-stock-label">Add</span>
                        </button>
                        <button
                            className="add-stock-btn clear-btn"
                            onClick={this.props.onClear}
                            disabled={stocks.length === 0}
                            title="Remove all stocks from the basket"
                        >
                            Clear
                        </button>
                    </div>

                    {stocks.map(stock => {
                        const data = stockData[stock];
                        if (!data) return null;
                        const isSelected = stock === selectedStock;
                        const isExpanded = stock === expandedStock;
                        const isHidden = !data.visible;
                        const p = data.params;

                        return (
                            <div
                                className={`basket-item${isSelected ? ' selected' : ''}${isHidden ? ' hidden' : ''}`}
                                key={stock}
                            >
                                {/* Main row: click to select */}
                                <div
                                    className="basket-item-row"
                                    tabIndex="0"
                                    role="button"
                                    aria-pressed={isSelected}
                                    title={isSelected
                                        ? 'Click to deselect (show all stocks)'
                                        : 'Click to solo this stock and view its trade windows'}
                                    onClick={(e) => {
                                        // Don't select if clicking action buttons
                                        if (e.target.closest('.item-actions') || e.target.closest('.icon-button')) return;
                                        onSelect(isSelected ? null : stock);
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.target.closest('.item-actions') || e.target.closest('.icon-button')) return;
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            onSelect(isSelected ? null : stock);
                                        }
                                    }}
                                >
                                    <button
                                        className={`icon-button expand${isExpanded ? ' open' : ''}`}
                                        onClick={(e) => { e.stopPropagation(); onToggleExpand(stock); }}
                                        title="Show/hide parameter sliders"
                                    >
                                        &#9654;
                                    </button>
                                    <span
                                        className="stock-color"
                                        style={{ backgroundColor: data.color }}
                                    />
                                    <span className="stock-name">{stock}</span>
                                    <div className="item-actions">
                                        <button
                                            className="icon-button optimize"
                                            onClick={(e) => { e.stopPropagation(); this.props.onOptimize && this.props.onOptimize(stock); }}
                                            title="Auto-optimize this stock's window and win% parameters"
                                        >
                                            {'\u{1F4A1}'}
                                        </button>
                                        <button
                                            className="icon-button toggle-vis"
                                            onClick={(e) => { e.stopPropagation(); onToggleVisible(stock); }}
                                            title={isHidden
                                                ? 'Show — include this stock in the basket'
                                                : 'Hide — exclude this stock from the basket'}
                                        >
                                            {isHidden ? '\u25CB' : '\u25CF'}
                                        </button>
                                        <button
                                            className="icon-button delete"
                                            onClick={(e) => { e.stopPropagation(); onRemove(stock); }}
                                            title="Remove from basket"
                                        >
                                            {'\u2715'}
                                        </button>
                                    </div>
                                </div>

                                {/* Accordion: param sliders */}
                                {isExpanded && (
                                    <div className="basket-item-accordion">
                                        <div className="slider-group" title="Years of historical data used to compute trade-window statistics">
                                            <label>Sample years</label>
                                            <input
                                                type="range" min="1" max={data.nDataYears || 25} step="1"
                                                value={p.nYears}
                                                onInput={(e) => this.handleSliderChange(stock, 'nYears', parseInt(e.target.value))}
                                            />
                                            <span className="slider-value">{p.nYears}</span>
                                        </div>
                                        <div className="slider-group" title="Minimum trade-window length, in days">
                                            <label>Min Window</label>
                                            <input
                                                type="range" min="3" max="120" step="1"
                                                value={p.nWinMin}
                                                onInput={(e) => this.handleSliderChange(stock, 'nWinMin', parseInt(e.target.value))}
                                            />
                                            <span className="slider-value">{p.nWinMin}</span>
                                        </div>
                                        <div className="slider-group" title="Minimum historical win-rate required to keep a trade window (floor 50%)">
                                            <label>Win %</label>
                                            {(() => {
                                                const fStep = +(100 / p.nYears).toFixed(2);
                                                // Floor min at 50% — snap up to nearest step >= 50.
                                                const fMin = Math.ceil(50 / fStep) * fStep;
                                                return (
                                                    <>
                                                        <input
                                                            type="range" min={fMin} max="100" step={fStep}
                                                            value={p.fPctWin}
                                                            onInput={(e) => this.handleSliderChange(stock, 'fPctWin', parseFloat(e.target.value))}
                                                        />
                                                        <span className="slider-value">{p.fPctWin.toFixed(1)}%</span>
                                                    </>
                                                );
                                            })()}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Action footer */}
                <div className="basket-footer">
                    <button
                        className="new-stock-btn footer-narrow"
                        onClick={onSaveBasket}
                        disabled={stocks.length === 0}
                        title="Save basket to JSON file"
                    >
                        Save
                    </button>
                    <button
                        className="new-stock-btn footer-narrow"
                        onClick={this.handleLoadClick}
                        title="Load basket from JSON file"
                    >
                        Load
                    </button>
                    <div
                        className="examples-wrapper"
                        ref={(el) => { this._examplesRoot = el; }}
                    >
                        <button
                            className="new-stock-btn"
                            onClick={this.handleExamplesClick}
                            title="Load a curated example basket"
                            aria-haspopup="menu"
                            aria-expanded={this.state.examplesOpen}
                        >
                            Examples {'\u25BE'}
                        </button>
                        {this.state.examplesOpen && this.state.menuPos && (
                            <div
                                className="examples-menu"
                                role="menu"
                                ref={(el) => { this._menuEl = el; }}
                                style={{
                                    left:     this.state.menuPos.left + 'px',
                                    bottom:   this.state.menuPos.bottom + 'px',
                                    minWidth: this.state.menuPos.minWidth + 'px'
                                }}
                            >
                                {this.state.examples === null && (
                                    <div className="examples-status">Loading…</div>
                                )}
                                {this.state.examples && this.state.examples.length === 0 && (
                                    <div className="examples-status">
                                        {this.state.examplesError
                                            ? 'Failed: ' + this.state.examplesError
                                            : 'No examples available'}
                                    </div>
                                )}
                                {this.state.examples && this.state.examples.map((ex) => (
                                    <button
                                        key={ex.file}
                                        className="examples-item"
                                        role="menuitem"
                                        onClick={() => this.handleExamplePick(ex.file)}
                                        title={ex.description || ''}
                                    >
                                        <span className="examples-label">{ex.label}</span>
                                        {ex.description && (
                                            <span className="examples-desc">{ex.description}</span>
                                        )}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    <input
                        type="file"
                        accept="application/json,.json"
                        ref={(el) => { this._fileInput = el; }}
                        style={{ display: 'none' }}
                        onChange={this.handleFileChange}
                    />
                </div>
            </div>
        );
    }
}

export default BasketList;
