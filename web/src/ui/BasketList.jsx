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

class BasketList extends Component {

    handleSliderChange = (stock, field, value) => {
        const { stockData, onParamChange } = this.props;
        if (!stockData[stock] || !onParamChange) return;
        const newParams = { ...stockData[stock].params, [field]: value };

        // When nYears changes, snap fPctWin to the nearest valid step
        if (field === 'nYears') {
            const fStep = 100 / value;
            newParams.fPctWin = Math.round(newParams.fPctWin / fStep) * fStep;
            // Clamp to [fStep, 100]
            newParams.fPctWin = Math.max(fStep, Math.min(100, newParams.fPctWin));
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
                onSaveBasket } = this.props;

        return (
            <div className="basket-list">
                <div className="basket-header">
                    <h2>Basket</h2>
                    <div className="basket-header-actions">
                        <button
                            className="new-stock-btn"
                            onClick={onSaveBasket}
                            disabled={stocks.length === 0}
                            title="Save basket to JSON file"
                        >
                            Save
                        </button>
                        <button
                            className="new-stock-btn"
                            onClick={this.handleLoadClick}
                            title="Load basket from JSON file"
                        >
                            Load
                        </button>
                        <button className="new-stock-btn" onClick={onOpenModal}>
                            + New
                        </button>
                        <input
                            type="file"
                            accept="application/json,.json"
                            ref={(el) => { this._fileInput = el; }}
                            style={{ display: 'none' }}
                            onChange={this.handleFileChange}
                        />
                    </div>
                </div>

                {stocks.length === 0 ? (
                    <div className="empty-basket">
                        <p>No stocks in basket</p>
                        <p className="hint">Click "New" to add a stock</p>
                    </div>
                ) : (
                    <div className="basket-items">
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
                                            title="Toggle parameters"
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
                                                className="icon-button toggle-vis"
                                                onClick={(e) => { e.stopPropagation(); onToggleVisible(stock); }}
                                                title={isHidden ? 'Show' : 'Hide'}
                                            >
                                                {isHidden ? '\u25CB' : '\u25CF'}
                                            </button>
                                            <button
                                                className="icon-button delete"
                                                onClick={(e) => { e.stopPropagation(); onRemove(stock); }}
                                                title="Remove"
                                            >
                                                {'\u2715'}
                                            </button>
                                        </div>
                                    </div>

                                    {/* Accordion: param sliders */}
                                    {isExpanded && (
                                        <div className="basket-item-accordion">
                                            <div className="slider-group">
                                                <label>Years</label>
                                                <input
                                                    type="range" min="1" max={data.nDataYears || 25} step="1"
                                                    value={p.nYears}
                                                    onInput={(e) => this.handleSliderChange(stock, 'nYears', parseInt(e.target.value))}
                                                />
                                                <span className="slider-value">{p.nYears}</span>
                                            </div>
                                            <div className="slider-group">
                                                <label>Min Window</label>
                                                <input
                                                    type="range" min="3" max="120" step="1"
                                                    value={p.nWinMin}
                                                    onInput={(e) => this.handleSliderChange(stock, 'nWinMin', parseInt(e.target.value))}
                                                />
                                                <span className="slider-value">{p.nWinMin}</span>
                                            </div>
                                            <div className="slider-group">
                                                <label>Max Window</label>
                                                <input
                                                    type="range" min="5" max="180" step="1"
                                                    value={p.nWinMax}
                                                    onInput={(e) => this.handleSliderChange(stock, 'nWinMax', parseInt(e.target.value))}
                                                />
                                                <span className="slider-value">{p.nWinMax}</span>
                                            </div>
                                            <div className="slider-group">
                                                <label>Win %</label>
                                                {(() => {
                                                    const fStep = +(100 / p.nYears).toFixed(2);
                                                    return (
                                                        <>
                                                            <input
                                                                type="range" min={fStep} max="100" step={fStep}
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
                )}
            </div>
        );
    }
}

export default BasketList;
