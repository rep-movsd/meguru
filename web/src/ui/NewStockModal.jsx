import { Component } from 'preact';
import SearchableDropdown from './SearchableDropdown';

// Stock list loaded from bundled JSON (public/nse_stocks.json).
// Cached at module level so it's fetched only once.
let _cachedStockList = null;
let _stockListPromise = null;

function loadStockList() {
    if (_cachedStockList) return Promise.resolve(_cachedStockList);
    if (_stockListPromise) return _stockListPromise;
    _stockListPromise = fetch('/nse_stocks.json')
        .then(r => r.json())
        .then(arr => {
            // Convert from {s, n} to {symbol, name} format
            _cachedStockList = arr.map(e => ({ symbol: e.s, name: e.n }));
            return _cachedStockList;
        })
        .catch(() => {
            _stockListPromise = null;
            return [];
        });
    return _stockListPromise;
}

// Default stock parameters matching TStockParams defaults
const DEFAULT_PARAMS = {
    nYears: 10,
    nWinMin: 10,
    nWinMax: 31,
    fPctWin: 60
};

// Modal for searching and adding a new stock to the basket.
// Props:
//   onAdd: (symbol, params) => void
//   onClose: () => void
//   existingStocks: string[] - already in basket (to show warning)

class NewStockModal extends Component {
    constructor(props) {
        super(props);
        this.state = {
            stock: '',
            nYears: DEFAULT_PARAMS.nYears,
            nWinMin: DEFAULT_PARAMS.nWinMin,
            nWinMax: DEFAULT_PARAMS.nWinMax,
            fPctWin: DEFAULT_PARAMS.fPctWin,
            stockList: _cachedStockList || [],
            bLoadingList: !_cachedStockList
        };
    }

    handleStockChange = (value) => {
        this.setState({ stock: value.toUpperCase() });
    }

    handleAdd = () => {
        const { stock, nYears, nWinMin, nWinMax, fPctWin } = this.state;
        if (!stock) return;
        if (this.props.onAdd) {
            this.props.onAdd(stock, { nYears, nWinMin, nWinMax, fPctWin });
        }
    }

    handleOverlayClick = (e) => {
        if (e.target === e.currentTarget) {
            this.props.onClose();
        }
    }

    handleKeyDown = (e) => {
        if (e.key === 'Escape') {
            this.props.onClose();
        }
    }

    componentDidMount() {
        document.addEventListener('keydown', this.handleKeyDown);
        if (this.state.bLoadingList) {
            loadStockList().then(list => {
                this.setState({ stockList: list, bLoadingList: false });
            });
        }
    }

    componentWillUnmount() {
        document.removeEventListener('keydown', this.handleKeyDown);
    }

    render() {
        const { onClose, existingStocks } = this.props;
        const { stock, nYears, nWinMin, nWinMax, fPctWin, stockList } = this.state;

        const isExisting = existingStocks && existingStocks.includes(stock);
        const canAdd = stock.length > 0;

        return (
            <div className="modal-overlay" onClick={this.handleOverlayClick}>
                <div className="modal">
                    <h2>Add Stock</h2>

                    <div className="modal-field">
                        <label>Stock Symbol</label>
                        <SearchableDropdown
                            value={stock}
                            options={stockList}
                            onChange={this.handleStockChange}
                            onSubmit={this.handleAdd}
                            placeholder="Search stock..."
                        />
                    </div>

                    <div className="modal-row">
                        <div className="modal-field">
                            <label>Years</label>
                            <input
                                type="number"
                                value={nYears}
                                onInput={(e) => {
                                    const nNewYears = parseInt(e.target.value) || 1;
                                    const fStep = 100 / nNewYears;
                                    let fSnapped = Math.round(this.state.fPctWin / fStep) * fStep;
                                    fSnapped = Math.max(fStep, Math.min(100, fSnapped));
                                    this.setState({ nYears: nNewYears, fPctWin: +fSnapped.toFixed(2) });
                                }}
                                min="1"
                                max="25"
                            />
                        </div>
                        <div className="modal-field">
                            <label>Win % Threshold</label>
                            {(() => {
                                const fStep = +(100 / nYears).toFixed(2);
                                const arrOptions = [];
                                for (let v = fStep; v <= 100; v += fStep) {
                                    arrOptions.push(+v.toFixed(2));
                                }
                                return (
                                    <select
                                        value={fPctWin}
                                        onChange={(e) => this.setState({ fPctWin: parseFloat(e.target.value) })}
                                    >
                                        {arrOptions.map(v => (
                                            <option key={v} value={v}>{v.toFixed(1)}%</option>
                                        ))}
                                    </select>
                                );
                            })()}
                        </div>
                    </div>

                    <div className="modal-row">
                        <div className="modal-field">
                            <label>Min Window (days)</label>
                            <input
                                type="number"
                                value={nWinMin}
                                onInput={(e) => this.setState({ nWinMin: parseInt(e.target.value) || 1 })}
                                min="1"
                                max="180"
                            />
                        </div>
                        <div className="modal-field">
                            <label>Max Window (days)</label>
                            <input
                                type="number"
                                value={nWinMax}
                                onInput={(e) => this.setState({ nWinMax: parseInt(e.target.value) || 1 })}
                                min="1"
                                max="365"
                            />
                        </div>
                    </div>

                    <div className="modal-actions">
                        <button className="modal-btn secondary" onClick={onClose}>
                            Cancel
                        </button>
                        <button
                            className="modal-btn primary"
                            onClick={this.handleAdd}
                            disabled={!canAdd}
                        >
                            {isExisting ? 'Replace' : 'Add'}
                        </button>
                    </div>
                </div>
            </div>
        );
    }
}

export default NewStockModal;
