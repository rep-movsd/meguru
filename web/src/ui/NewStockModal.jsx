import { Component, createRef } from 'preact';
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

// Default stock parameters — will be auto-optimized after add.
const DEFAULT_PARAMS = {
    nYears: 10,
    nWinMin: 10,
    nWinMax: 180,
    fPctWin: 60
};

const FOCUSABLE_SELECTOR = 'input, select, button, [tabindex]:not([tabindex="-1"])';

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
            stockList: _cachedStockList || [],
            bLoadingList: !_cachedStockList,
            bAttempted: false
        };
        this._modalRef = createRef();
        this._prevFocus = null;
    }

    handleStockChange = (value) => {
        this.setState({ stock: value.toUpperCase(), bAttempted: false });
    }

    handleAdd = () => {
        const { stock, stockList, bLoadingList } = this.state;
        this.setState({ bAttempted: true });
        if (bLoadingList || !stockList.some(item => item.symbol === stock)) return;
        if (this.props.onAdd) {
            this.props.onAdd(stock, { ...DEFAULT_PARAMS });
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
            return;
        }
        if (e.key === 'Tab' && this._modalRef.current) {
            const arrFocusable = [...this._modalRef.current.querySelectorAll(FOCUSABLE_SELECTOR)];
            if (arrFocusable.length === 0) return;
            const elFirst = arrFocusable[0];
            const elLast = arrFocusable[arrFocusable.length - 1];
            if (e.shiftKey && document.activeElement === elFirst) {
                e.preventDefault();
                elLast.focus();
            } else if (!e.shiftKey && document.activeElement === elLast) {
                e.preventDefault();
                elFirst.focus();
            }
        }
    }

    componentDidMount() {
        this._prevFocus = document.activeElement;
        document.addEventListener('keydown', this.handleKeyDown);
        if (this.state.bLoadingList) {
            loadStockList().then(list => {
                this.setState({ stockList: list, bLoadingList: false });
            });
        }
        // Auto-focus the first input inside the modal
        if (this._modalRef.current) {
            const elFirst = this._modalRef.current.querySelector(FOCUSABLE_SELECTOR);
            if (elFirst) elFirst.focus();
        }
    }

    componentWillUnmount() {
        document.removeEventListener('keydown', this.handleKeyDown);
        if (this._prevFocus && typeof this._prevFocus.focus === 'function') {
            this._prevFocus.focus();
        }
    }

    render() {
        const { onClose, existingStocks } = this.props;
        const { stock, stockList, bLoadingList, bAttempted } = this.state;

        const bIsValidStock = stockList.some(item => item.symbol === stock);
        const bShowStockError = bAttempted && !bLoadingList && stock && !bIsValidStock;
        const canAdd = !bLoadingList && bIsValidStock;
        const isExisting = existingStocks && existingStocks.includes(stock);

        return (
            <div className="modal-overlay" onClick={this.handleOverlayClick}>
                <div
                    className="modal"
                    ref={this._modalRef}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="new-stock-modal-title"
                >
                    <h2 id="new-stock-modal-title">Add</h2>

                    <div className="modal-field">
                        <label>Stock Symbol</label>
                        <SearchableDropdown
                            value={stock}
                            options={stockList}
                            onChange={this.handleStockChange}
                            onSubmit={this.handleAdd}
                            placeholder="Search..."
                        />
                        <div className="error-message" style={{ visibility: bShowStockError ? 'visible' : 'hidden' }}>
                            Select a valid stock symbol from the list
                        </div>
                    </div>

                    <div className="modal-actions">
                        <button
                            className="modal-btn secondary"
                            onClick={onClose}
                            title="Close without adding"
                        >
                            Cancel
                        </button>
                        <button
                            className="modal-btn primary"
                            onClick={this.handleAdd}
                            disabled={!canAdd}
                            title={isExisting
                                ? 'Re-add this stock (parameters will be re-optimized)'
                                : 'Fetch data and add this stock to the basket'}
                        >
                            {isExisting ? 'Re-add' : 'Add'}
                        </button>
                    </div>
                </div>
            </div>
        );
    }
}

export default NewStockModal;
