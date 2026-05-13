import { Component } from 'preact';

// Help / documentation modal with tabbed sections.
//
// Props:
//   onClose: () => void

const TABS = [
    { id: 'intro',        label: 'Intro' },
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
    state = { activeTab: 'intro' };

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

    renderIntro() {
        return (
            <div className="help-section">
                <h3>What is Meguru?</h3>
                <p>
                    Meguru is a seasonal trading research tool for NSE-listed stocks.
                    The core idea is to identify date ranges within each year, where positive returns have
                    occurred with high consistency in a give stock. Those recurring windows form a
                    trading plan - specific periods each year when it makes sense to buy and sell that stock.
                </p>
                <p>
                    A <strong>basket</strong> is a collection of stocks, each with its
                    own set of trade windows and its own capital allocation percentage.
                    By combining stocks with different trade windows, you can create a portfolio
                    that captures seasonal patterns while smoothing out volatility and reducing time in the market.
                </p>
                <p>
                    The engine simulates the full trade history for the basket and plots
                    the result against a simple buy-and-hold benchmark. Each stock's
                    contribution is shown separately in the bar chart so you can see
                    exactly where returns are coming from.
                </p>
                <p>
                    Parameters control how the engine searches for trade windows.
                    A tighter win-rate threshold keeps only the most reliable signals;
                    a wider window length allows longer seasonal swings to be captured.
                    Meguru will optimise the parameters for a stock when added, for maximum average return,
                    but you can adjust them manually if needed.
                </p>
                <p>
                    Capital is tracked independently per stock - gains in one position
                    are never mixed with another. This keeps the accounting clean and
                    makes it straightforward to compare each stock's contribution to
                    total basket performance.
                </p>
            </div>
        );
    }

    renderQuickstart() {
        return (
            <div className="help-section">
                <h3>Quick Start</h3>

                <h4>1 - Build your basket</h4>
                <p>
                    Click <strong>Add Stock</strong> at the top of the basket panel and type
                    an NSE symbol (e.g. <code>RELIANCE</code>, <code>TCS</code>).
                    The first time a stock is added, Meguru downloads up to 25 years of
                    daily price data from Yahoo Finance and stores it in your browser cache for future use.
                    This may take a few seconds, but subsequent loads are instant.
                    Once added, the engine optimizes the window search params to find the best trade windows
                </p>
                <p>
                    Add as many stocks as you need. Each is assigned a unique colour for the bar graph.
                    You can also click <strong>Examples</strong> in the footer to load curated baskets instantly.
                </p>

                <h4>2 - Tune parameters</h4>
                <p>
                    Click the <span className="help-icon">&#9654;</span> chevron on any
                    stock tile to reveal three sliders: <em>Sample years</em>,{' '}
                    <em>Min Window</em>, and <em>Win %</em>. These control how the engine
                    searches for seasonal trade windows — see the <strong>Parameters</strong>{' '}
                    tab for details.
                </p>

                <h4>3 - Review basket returns</h4>
                <p>
                    Switch to <strong>Bar</strong> view using the buttons at the top of
                    the graph. Each column shows one year: the left bar is the
                    average buy-and-hold return; the right bar is the plan return,
                    broken down by stock. White labels show the net result for each.
                    Since we need to show both profits and losses, the top of the bar is aligned with the net return.
                    The part of the bar below zero has two vertical halves - the right half shows the losses that
                    brought the bar down, and the left half shows the gains that were nullified by the losses.

                </p>
                <p>
                    Use <strong>Line</strong> view to see a single year's daily equity
                    curve — plan vs buy-and-hold — with trade-window shading overlaid
                    for the selected stock. In line mode, you can select a specific year or the average of all years.
                </p>
                <p>
                    To focus on one stock, click its tile to <em>solo</em> it. The graph
                    and stats panel update to reflect that stock only. Click again to
                    return to the full basket view. To temporarily hide a stock without removing it from the basket,
                  click the green dot.
                </p>

                <h4>4 — Adjust allocation</h4>
                <p>
                    The vertical bar to the left of the chart shows how capital is split
                    across stocks. Choose <strong>Equal</strong>, <strong>Avg Return</strong>,
                    or <strong>Custom</strong> from the dropdown. In Custom mode,
                    hover-handles let you nudge each stock's weight in 5% steps.
                    You can also copy the current mode's weights as a starting point for Custom using the <em>Copy to custom</em> button.
                    The <span className="help-icon">&#128161;</span> bulb next to the bar
                    auto-optimises the weights to maximise basket return.
                   This optimiser does not consider only profits, but a quality factor that represents consistency of returns.
                </p>

                <h4>5 — Export and save</h4>
                <p>
                    Use <strong>Save</strong> in the footer to export the basket as a
                    JSON file — stocks, parameters, allocation mode, and custom weights
                    are all included. <strong>Load</strong> restores it later and
                    auto-downloads any missing price data.
                </p>
                <p>
                    The <strong>Backtest CSV</strong> and <strong>Trade Calendar</strong>{' '}
                    buttons in the graph toolbar export trade-level detail for
                    verification in a spreadsheet or for use as a trading plan.
                </p>
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
            case 'intro':        return this.renderIntro();
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
