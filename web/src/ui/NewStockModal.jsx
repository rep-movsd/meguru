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

// Default stock parameters matching TStockParams defaults
const DEFAULT_PARAMS = {
    nYears: 10,
    nWinMin: 10,
    nWinMax: 31,
    fPctWin: 60
};

const PARAM_LIMITS = {
    nYears: { min: 1, max: 25 },
    nWinMin: { min: 3, max: 120 },
    nWinMax: { min: 5, max: 180 }
};

const PCT_WIN_OPTIONS = Array.from({ length: 11 }, (_, i) => 50 + i * 5);

const FOCUSABLE_SELECTOR = 'input, select, button, [tabindex]:not([tabindex="-1"])';

function validateForm(state) {
    const { stock, nYears, nWinMin, nWinMax, fPctWin, stockList, bLoadingList } = state;
    const bHasStock = stock.length > 0;
    const bIsValidStock = bHasStock && stockList.some(item => item.symbol === stock);
    const arrParamErrors = [];

    if (!Number.isInteger(nYears) || nYears < PARAM_LIMITS.nYears.min || nYears > PARAM_LIMITS.nYears.max) {
        arrParamErrors.push(`Years must be between ${PARAM_LIMITS.nYears.min} and ${PARAM_LIMITS.nYears.max}`);
    }
    if (!Number.isInteger(nWinMin) || nWinMin < PARAM_LIMITS.nWinMin.min || nWinMin > PARAM_LIMITS.nWinMin.max) {
        arrParamErrors.push(`Min Window must be between ${PARAM_LIMITS.nWinMin.min} and ${PARAM_LIMITS.nWinMin.max} days`);
    }
    if (!Number.isInteger(nWinMax) || nWinMax < PARAM_LIMITS.nWinMax.min || nWinMax > PARAM_LIMITS.nWinMax.max) {
        arrParamErrors.push(`Max Window must be between ${PARAM_LIMITS.nWinMax.min} and ${PARAM_LIMITS.nWinMax.max} days`);
    }
    if (Number.isInteger(nWinMin) && Number.isInteger(nWinMax) && nWinMin > nWinMax) {
        arrParamErrors.push('Min Window must be less than or equal to Max Window');
    }
    if (!PCT_WIN_OPTIONS.includes(fPctWin)) {
        arrParamErrors.push('Win % Threshold must be between 50% and 100%');
    }

    return {
        bIsValidStock,
        arrParamErrors,
        canAdd: !bLoadingList && bIsValidStock && arrParamErrors.length === 0
    };
}

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
        this._modalRef = createRef();
        this._prevFocus = null;
    }

    handleStockChange = (value) => {
        this.setState({ stock: value.toUpperCase() });
    }

    handleAdd = () => {
        const { stock, nYears, nWinMin, nWinMax, fPctWin } = this.state;
        const validation = validateForm(this.state);
        if (!validation.canAdd) return;
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
        const { stock, nYears, nWinMin, nWinMax, fPctWin, stockList, bLoadingList } = this.state;

        const isExisting = existingStocks && existingStocks.includes(stock);
        const { bIsValidStock, arrParamErrors, canAdd } = validateForm(this.state);

        return (
            <div className="modal-overlay" onClick={this.handleOverlayClick}>
                <div
                    className="modal"
                    ref={this._modalRef}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="new-stock-modal-title"
                >
                    <h2 id="new-stock-modal-title">Add Stock</h2>

                    <div className="modal-field">
                        <label>Stock Symbol</label>
                        <SearchableDropdown
                            value={stock}
                            options={stockList}
                            onChange={this.handleStockChange}
                            onSubmit={this.handleAdd}
                            placeholder="Search stock..."
                        />
                        {!bLoadingList && stock && !bIsValidStock && (
                            <div className="error-message">Select a valid stock symbol from the list</div>
                        )}
                    </div>

                    <div className="modal-row">
                        <div className="modal-field">
                            <label>Years</label>
                            <input
                                type="number"
                                value={nYears}
                                onInput={(e) => this.setState({ nYears: parseInt(e.target.value, 10) || 0 })}
                                min={PARAM_LIMITS.nYears.min}
                                max={PARAM_LIMITS.nYears.max}
                            />
                        </div>
                        <div className="modal-field">
                            <label>Win % Threshold</label>
                            <select
                                value={fPctWin}
                                onChange={(e) => this.setState({ fPctWin: parseFloat(e.target.value) })}
                            >
                                {PCT_WIN_OPTIONS.map(v => (
                                    <option key={v} value={v}>{v}%</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="modal-row">
                        <div className="modal-field">
                            <label>Min Window (days)</label>
                            <input
                                type="number"
                                value={nWinMin}
                                onInput={(e) => this.setState({ nWinMin: parseInt(e.target.value, 10) || 0 })}
                                min={PARAM_LIMITS.nWinMin.min}
                                max={PARAM_LIMITS.nWinMin.max}
                            />
                        </div>
                        <div className="modal-field">
                            <label>Max Window (days)</label>
                            <input
                                type="number"
                                value={nWinMax}
                                onInput={(e) => this.setState({ nWinMax: parseInt(e.target.value, 10) || 0 })}
                                min={PARAM_LIMITS.nWinMax.min}
                                max={PARAM_LIMITS.nWinMax.max}
                            />
                        </div>
                    </div>

                    {arrParamErrors.length > 0 && (
                        <div className="error-message modal-validation-errors">
                            {arrParamErrors.map((sMessage, i) => (
                                <div key={i}>{sMessage}</div>
                            ))}
                        </div>
                    )}

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
