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

class BasketList extends Component {

    handleSliderChange = (stock, field, value) => {
        const { stockData, onParamChange } = this.props;
        if (!stockData[stock] || !onParamChange) return;
        const newParams = { ...stockData[stock].params, [field]: value };
        onParamChange(stock, newParams);
    }

    render() {
        const { stocks, stockData, selectedStock, expandedStock,
                onSelect, onToggleVisible, onRemove, onToggleExpand, onOpenModal } = this.props;

        return (
            <div className="basket-list">
                <div className="basket-header">
                    <h2>Basket</h2>
                    <button className="new-stock-btn" onClick={onOpenModal}>
                        + New
                    </button>
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
                                        onClick={(e) => {
                                            // Don't select if clicking action buttons
                                            if (e.target.closest('.item-actions') || e.target.closest('.icon-button')) return;
                                            onSelect(isSelected ? null : stock);
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
                                                    type="range" min="1" max="25" step="1"
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
                                                <input
                                                    type="range" min="50" max="100" step="5"
                                                    value={p.fPctWin}
                                                    onInput={(e) => this.handleSliderChange(stock, 'fPctWin', parseInt(e.target.value))}
                                                />
                                                <span className="slider-value">{p.fPctWin}%</span>
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
