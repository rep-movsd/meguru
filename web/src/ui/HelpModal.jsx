import { Component } from 'preact';

// Help / documentation modal with tabbed sections.
//
// Props:
//   onClose: () => void

const TABS = [
    { id: 'quickstart',   label: 'Quick Start' },
    { id: 'parameters',   label: 'Parameters' },
    { id: 'allocation',   label: 'Allocation' },
    { id: 'optimizers',   label: 'Optimizers' },
    { id: 'graph',        label: 'Graph' },
    { id: 'exports',      label: 'Exports' },
    { id: 'glossary',     label: 'Glossary' },
    { id: 'methodology',  label: 'Methodology' }
];

class HelpModal extends Component {
    state = { activeTab: 'quickstart' };

    handleBackdrop = (e) => {
        if (e.target === e.currentTarget) this.props.onClose && this.props.onClose();
    }

    handleKey = (e) => {
        if (e.key === 'Escape') this.props.onClose && this.props.onClose();
    }

    componentDidMount() {
        window.addEventListener('keydown', this.handleKey);
    }
    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKey);
    }

    renderQuickstart() {
        return (
            <div className="help-section">
                <h3>What is meguru?</h3>
                <p>
                    Meguru is a seasonal trading research tool.
                    The basic principle is to scan historical daily prices for a and find
                    date ranges within each year where there is a high likelihood of positive returns.
                    This provides a trading plan for when to be in or out of the market for that stock.

                    A basket is a collection of stocks, each with its own trade windows.
                    Each stock in a basket has its own parameters based on which the windows are chosen.
                    Each stock also has an allocation percentage, which determines how much of the total capital to allocate when trading.
                    By building a good basket, you can maximise returns while minimising time in the market.

                    The engine simulates the trades for the basket and displays a graph comparing returns against buy-and-hold.
                    Since the trade windows are affected by the parameters in the stock, you can tune them to find a good balance of risk and reward.

                    Meguru allows you to automatically find the best parameters for each stock, as well as for the allocation percentages.

                    For simplicity, each stock and its capital is considered independently;
                    E.g. Buy stock X for 100000, Sell stock X for 105000, next buy again for 105000 etc.
                    Capital is never mixed between stocks.
                </p>

                <h3>5-minute walkthrough</h3>
                <ol>
                    <li>
                        <strong>Add a stock.</strong> Click <code>+ New</code>,
                        type a symbol (NSE only for now), and pick parameters
                        (defaults are sensible). The first time you add a stock, the app
                        downloads up to 25 years of daily price data from Yahoo Finance.
                        The data is stored in the browser.
                        Each stock in a basket get assigned a unique color.
                    </li>
                    <li>
                        Once you have one or more stocks in the basket, you can click the Line or Bar graph buttons
                        at the top-right to show the backtest results.
                        The line graph shows how the trading strategy works for a single year (or averaged across years),
                        while the bar graph shows the returns for each year.
                        In the bar graph, the contributions of each individual stock is colored based on the stock's assigned color.
                        The bars are shown in such a way that

                        <strong>Inspect the basket.</strong> The graph on the
                        right shows the basket&rsquo;s plan return vs
                        buy-and-hold. The stats panel below shows per-stock
                        summary numbers.
                    </li>
                    <li>
                        <strong>Click a stock tile</strong> to <em>solo</em> it
                        &mdash; this hides every other stock from the basket
                        and shows that stock&rsquo;s trade-window table.
                    </li>
                    <li>
                        <strong>Tune parameters</strong> by clicking the
                        chevron <span className="help-icon">&#9654;</span> on a
                        tile. Three sliders control how the engine searches
                        for windows.
                    </li>
                    <li>
                        <strong>Save the basket</strong> as JSON. Loading it
                        later auto-downloads any missing data.
                    </li>
                </ol>
            </div>
        );
    }

    renderParameters() {
        return (
            <div className="help-section">
                <h3>Per-stock parameters</h3>
                <dl>
                    <dt>Sample years (<code>nYears</code>)</dt>
                    <dd>
                        How many years of historical data to look at when
                        searching for trade windows. More years &rarr; more
                        statistical confidence but slower adaptation to recent
                        regime changes.
                    </dd>

                    <dt>Min Window (<code>nWinMin</code>)</dt>
                    <dd>
                        Shortest acceptable window length, in days. Very short
                        windows can fit noise; very long windows dilute signal.
                    </dd>

                    <dt>Win % Threshold (<code>fPctWin</code>)</dt>
                    <dd>
                        Minimum historical hit-rate a candidate window must
                        clear. <strong>Floor is 50%</strong> &mdash; below
                        chance, it&rsquo;s not a signal. The slider snaps to
                        valid steps based on Sample years.
                    </dd>
                </dl>
                <p className="help-note">
                    The <code>nWinMax</code> upper bound is fixed internally
                    (180 days) and not exposed in the UI.
                </p>
            </div>
        );
    }

    renderAllocation() {
        return (
            <div className="help-section">
                <h3>How basket weights are decided</h3>
                <dl>
                    <dt>Equal</dt>
                    <dd>Every visible stock gets the same weight.</dd>

                    <dt>Avg Return</dt>
                    <dd>
                        Weights proportional to each stock&rsquo;s average
                        plan return. Bigger historical winners get more capital.
                    </dd>

                    <dt>Custom</dt>
                    <dd>
                        You set the weights manually using the
                        <code>+</code>/<code>&minus;</code> handles on the
                        allocation bar (5% steps). Use <em>Copy to custom</em>
                        to start from the current mode&rsquo;s weights.
                    </dd>
                </dl>

                <h3>Hidden stocks</h3>
                <p>
                    Hiding a stock (the <span className="help-icon">&#9679;</span>
                    /<span className="help-icon">&#9675;</span> toggle, or
                    soloing another) keeps it in the basket but assigns it
                    weight 0. The remaining visible stocks are re-normalised.
                </p>
            </div>
        );
    }

    renderOptimizers() {
        return (
            <div className="help-section">
                <h3>Per-stock optimiser <span className="help-icon">&#128161;</span></h3>
                <p>
                    Click the lightbulb on a stock tile. The engine runs a
                    grid search over (<code>nWinMin</code>, <code>fPctWin</code>)
                    and picks the combination that maximises <em>plan return</em>
                    for that stock alone, subject to the 50% win-rate floor.
                </p>

                <h3>Allocation optimiser <span className="help-icon">&#128161;</span></h3>
                <p>
                    The lightbulb next to the allocation bar searches custom
                    weight compositions to maximise basket plan return,
                    weighted by per-stock <em>quality</em> (a risk-adjusted
                    score). It only operates over currently visible stocks.
                </p>

                <p className="help-note">
                    Both optimisers are blocking &mdash; the UI shows an
                    overlay while they run.
                </p>
            </div>
        );
    }

    renderGraph() {
        return (
            <div className="help-section">
                <h3>View modes</h3>
                <dl>
                    <dt>Line</dt>
                    <dd>
                        Daily plan-equity vs buy-and-hold curve, normalised to
                        100% on day 1. The selected year (or the per-day
                        average across years) is shown. Trade-window
                        rectangles overlay the chart for the selected stock.
                    </dd>

                    <dt>Bar</dt>
                    <dd>
                        Stacked yearly returns, one bar per year, contributions
                        coloured per stock. The <em>Backtest years</em>
                        dropdown controls how many years are shown.
                    </dd>
                </dl>

                <h3>Y-axis range</h3>
                <p>
                    The <strong>Y min</strong> and <strong>Y max</strong>
                    dropdowns at the top-right of the graph let you fix the
                    vertical range. Choices persist across reloads.
                </p>

                <h3>Allocation bar</h3>
                <p>
                    The vertical bar to the left of the chart shows the basket
                    composition. In Custom mode, hover-handles appear for
                    incrementing/decrementing each stock&rsquo;s weight.
                </p>
            </div>
        );
    }

    renderExports() {
        return (
            <div className="help-section">
                <h3>Export backtest</h3>
                <p>
                    Downloads a CSV that reproduces the engine&rsquo;s plan
                    math day-by-day for the selected year. Useful for
                    hand-verifying numbers in Google Sheets / Excel.
                </p>

                <h3>Export calendar</h3>
                <p>
                    Downloads a date-keyed CSV listing every BUY/SELL action
                    across the basket. Drop it into a calendar app or use it
                    as a checklist.
                </p>

                <h3>Save / Load basket</h3>
                <p>
                    A JSON file with stocks, parameters, allocation mode, and
                    custom weights. <strong>Loading replaces the current
                    basket entirely.</strong> Any per-stock data not in the
                    local cache is downloaded automatically.
                </p>
            </div>
        );
    }

    renderGlossary() {
        return (
            <div className="help-section">
                <h3>Trade-window stats</h3>
                <dl>
                    <dt>Day Range</dt>
                    <dd>Day-of-year range (1&ndash;366) when this window is active.</dd>

                    <dt>Win %</dt>
                    <dd>Fraction of years this window ended positive.</dd>

                    <dt>Expected %</dt>
                    <dd>Average return across all sample years for this window.</dd>

                    <dt>%/day</dt>
                    <dd>Expected % divided by window length in days.</dd>

                    <dt>Profit Ratio</dt>
                    <dd>Average gain on winning years / average loss on losing years.</dd>
                </dl>

                <h3>Summary stats</h3>
                <dl>
                    <dt>Plan Return</dt>
                    <dd>Average yearly return when following the trade-window plan.</dd>

                    <dt>B&amp;H Return</dt>
                    <dd>Average yearly return for buy-and-hold (full-year exposure).</dd>

                    <dt>Days In Market</dt>
                    <dd>Fraction of the year capital is actively held under the plan.</dd>

                    <dt>Plan Quality</dt>
                    <dd>
                        Risk-adjusted score: plan return relative to B&amp;H,
                        penalised by downside volatility. Higher is better.
                    </dd>
                </dl>
            </div>
        );
    }

    renderMethodology() {
        return (
            <div className="help-section">
                <h3>Pipeline</h3>
                <ol>
                    <li>Daily OHLC data downloaded from Yahoo Finance via a Cloudflare Worker proxy and cached per (symbol, year) in OPFS.</li>
                    <li>For each stock, the engine builds returns for every day-of-year window in <code>[nWinMin, 180]</code>.</li>
                    <li>Windows are kept only if they pass <code>fPctWin</code> over the last <code>nYears</code>.</li>
                    <li>Surviving windows merge into a single trade plan: BUY at the start of an active window, SELL at the end, flat otherwise.</li>
                    <li>The basket simulator runs each stock&rsquo;s plan, weighted by allocation, and aggregates daily equity.</li>
                </ol>

                <h3>Notes & caveats</h3>
                <ul>
                    <li>This is curve-fitted historical analysis; past performance does not guarantee future results.</li>
                    <li>The engine ignores transaction costs and tax.</li>
                    <li>Yahoo data is end-of-day, adjusted for splits but not always for dividends.</li>
                    <li>Win% floor is 50% &mdash; the optimiser never picks losing windows.</li>
                </ul>

                <h3>Tech stack</h3>
                <p>
                    C++23 engine compiled to WebAssembly via Emscripten;
                    Preact UI; Chart.js; OPFS for client-side data cache;
                    Cloudflare Workers + Pages for the proxy and static
                    hosting.
                </p>
            </div>
        );
    }

    renderTabContent() {
        switch (this.state.activeTab) {
            case 'quickstart':   return this.renderQuickstart();
            case 'parameters':   return this.renderParameters();
            case 'allocation':   return this.renderAllocation();
            case 'optimizers':   return this.renderOptimizers();
            case 'graph':        return this.renderGraph();
            case 'exports':      return this.renderExports();
            case 'glossary':     return this.renderGlossary();
            case 'methodology':  return this.renderMethodology();
            default:             return null;
        }
    }

    render() {
        return (
            <div
                className="modal-overlay"
                onClick={this.handleBackdrop}
                role="dialog"
                aria-modal="true"
                aria-labelledby="help-modal-title"
            >
                <div className="modal help-modal">
                    <div className="help-header">
                        <h2 id="help-modal-title">Help</h2>
                        <button
                            className="icon-button delete"
                            onClick={this.props.onClose}
                            title="Close"
                        >{'\u2715'}</button>
                    </div>

                    <div className="help-tabs" role="tablist">
                        {TABS.map(t => (
                            <button
                                key={t.id}
                                role="tab"
                                aria-selected={this.state.activeTab === t.id}
                                className={`help-tab${this.state.activeTab === t.id ? ' active' : ''}`}
                                onClick={() => this.setState({ activeTab: t.id })}
                            >
                                {t.label}
                            </button>
                        ))}
                    </div>

                    <div className="help-body">
                        {this.renderTabContent()}
                    </div>
                </div>
            </div>
        );
    }
}

export default HelpModal;
