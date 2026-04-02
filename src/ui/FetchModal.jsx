import { Component, createRef } from 'preact';
import { fetchAllYears } from '../data/yahoo';
import { writeStockYear, writeNoData, hasStockYear, hasNoData } from '../data/storage';

// Modal that shows real-time progress while fetching stock data from Yahoo Finance.
// Props:
//   sSymbol: string — stock symbol to fetch
//   params: { nYears, nWinMin, nWinMax, fPctWin } — stock params (passed through to onComplete)
//   onComplete: (sSymbol, params) => void — called when fetch finishes
//   onCancel: () => void — called when user cancels

const MAX_YEARS = 25;

class FetchModal extends Component {
    constructor(props) {
        super(props);
        this.state = {
            arrLog: [],
            bDone: false,
            bError: false,
            nFetched: 0,
            nSkipped: 0,
            nTotal: MAX_YEARS,
        };
        this.abortController = new AbortController();
        this.logRef = createRef();
    }

    componentDidMount() {
        this.startFetching();
    }

    componentWillUnmount() {
        this.abortController.abort();
    }

    componentDidUpdate() {
        // Auto-scroll log to bottom
        if (this.logRef.current) {
            this.logRef.current.scrollTop = this.logRef.current.scrollHeight;
        }
    }

    addLog(entry) {
        this.setState(prev => ({
            arrLog: [...prev.arrLog, entry]
        }));
    }

    startFetching = async () => {
        const { sSymbol } = this.props;
        const signal = this.abortController.signal;

        // First, check which years we already have in OPFS
        this.addLog({ nYear: null, sStatus: 'info', sMessage: `Checking existing data for ${sSymbol}...` });

        const nCurrentYear = new Date().getFullYear();
        const arrMissingYears = [];

        for (let i = 0; i < MAX_YEARS; i++) {
            const nYear = nCurrentYear - i;
            const bHasCsv = await hasStockYear(sSymbol, nYear);
            const bHasNoData = await hasNoData(sSymbol, nYear);
            if (!bHasCsv && !bHasNoData) {
                arrMissingYears.push(nYear);
            }
        }

        if (arrMissingYears.length === 0) {
            this.addLog({ nYear: null, sStatus: 'ok', sMessage: 'All years already cached in OPFS' });
            this.setState({ bDone: true, nTotal: 0, nFetched: 0 });
            setTimeout(() => this.props.onComplete(sSymbol, this.props.params), 500);
            return;
        }

        const nSkipped = MAX_YEARS - arrMissingYears.length;
        if (nSkipped > 0) {
            this.addLog({ nYear: null, sStatus: 'info', sMessage: `${nSkipped} years already cached, fetching ${arrMissingYears.length} missing` });
        }

        this.setState({ nTotal: arrMissingYears.length, nSkipped });

        let nFetched = 0;

        try {
            const { mapYearCsv, arrNoDataYears } = await fetchAllYears(
                sSymbol,
                MAX_YEARS,
                async (progress) => {
                    // Skip progress for years we already have
                    if (!arrMissingYears.includes(progress.nYear) && progress.nYear !== null) return;

                    this.addLog(progress);
                    nFetched++;
                    this.setState({ nFetched });
                },
                signal
            );

            // Write fetched data to OPFS
            this.addLog({ nYear: null, sStatus: 'info', sMessage: 'Saving to OPFS...' });

            for (const [nYear, sCsv] of mapYearCsv) {
                await writeStockYear(sSymbol, nYear, sCsv);
            }
            for (const nYear of arrNoDataYears) {
                await writeNoData(sSymbol, nYear);
            }

            const nDataYears = mapYearCsv.size;
            this.addLog({
                nYear: null,
                sStatus: 'ok',
                sMessage: `Done \u2014 ${nDataYears} years of data saved`
            });
            this.setState({ bDone: true });

            // Auto-proceed after a short delay
            setTimeout(() => this.props.onComplete(sSymbol, this.props.params), 500);

        } catch (err) {
            if (err.name === 'AbortError') return;
            this.addLog({ nYear: null, sStatus: 'error', sMessage: `Fatal: ${err.message}` });
            this.setState({ bDone: true, bError: true });
        }
    }

    handleCancel = () => {
        this.abortController.abort();
        this.props.onCancel();
    }

    handleOverlayClick = (e) => {
        // Don't close on overlay click during fetch — only via button
    }

    render() {
        const { sSymbol } = this.props;
        const { arrLog, bDone, bError, nFetched, nTotal, nSkipped } = this.state;

        return (
            <div className="modal-overlay" onClick={this.handleOverlayClick}>
                <div className="modal fetch-modal">
                    <h2>
                        {bDone
                            ? (bError ? `Error fetching ${sSymbol}` : `${sSymbol} ready`)
                            : `Fetching ${sSymbol} data...`}
                    </h2>

                    <div className="fetch-progress">
                        {nSkipped > 0 && <span className="fetch-cached">{nSkipped} cached</span>}
                        <span>{nFetched} / {nTotal} years</span>
                    </div>

                    <div className="fetch-log" ref={this.logRef}>
                        {arrLog.map((entry, i) => (
                            <div key={i} className={`fetch-log-entry fetch-${entry.sStatus}`}>
                                <span className="fetch-icon">
                                    {entry.sStatus === 'ok' ? '\u2713' :
                                     entry.sStatus === 'nodata' ? '\u2013' :
                                     entry.sStatus === 'error' ? '\u2717' : '\u2022'}
                                </span>
                                <span className="fetch-year">
                                    {entry.nYear != null ? `${entry.nYear}` : ''}
                                </span>
                                <span className="fetch-msg">{entry.sMessage}</span>
                            </div>
                        ))}
                    </div>

                    <div className="modal-actions">
                        {bError && (
                            <button
                                className="modal-btn primary"
                                onClick={() => this.props.onComplete(sSymbol, this.props.params)}
                            >
                                Add Anyway
                            </button>
                        )}
                        <button
                            className="modal-btn secondary"
                            onClick={this.handleCancel}
                        >
                            {bDone ? 'Close' : 'Cancel'}
                        </button>
                    </div>
                </div>
            </div>
        );
    }
}

export default FetchModal;
