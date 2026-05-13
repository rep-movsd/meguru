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
    { id: 'methodology',  label: 'Methodology' },
    { id: 'makerway',     label: 'Maker Way' }
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
                    Meguru look at NSE stock price history. Find time of year when stock go up many times before.
                    Those good times become plan — buy here, sell there, repeat each year.
                </p>
                <p>
                    <strong>Basket</strong> = group of stocks. Each stock have own windows and own money slice.
                    Mix stocks with different seasons → smoother ride, less time holding risky thing.
                </p>
                <p>
                    Brain run fake trades on all past years. Draw chart. Compare to just holding all year.
                    Each stock shown separate so you see who help, who hurt.
                    Money never mix between stocks — easy to compare.
                </p>

                <h3>Why not just hold all year?</h3>
                <p>
                    Staying in market all time = full crash risk. 40% profit in 6 months better than 100%
                    profit in 12 months — because crash can eat 50% in weeks and you lose everything gained.
                    Less time in market = less time for bad thing to happen.
                </p>
                <p>
                    When stock sold, money free again. Can sit as cash ready to buy next dip.
                    Or same capital move to next stock in basket that just starting its season.
                    Good plan = same money do work again and again, compound across many stocks one by one.
                    Bad plan = money stuck sideways in one stock for many months earning nothing.
                </p>
                <p>
                    Think like traveller at station. Each stock is train going somewhere fast, but only for short time.
                    Catch right train at right station, ride fast part, get off. Catch next fast train.
                    Stay on same train whole day = sit still many hours waiting.
                    Hop fastest train each station = travel furthest same time.
                    Waiting at station with cash = OK. Very fast train coming soon.
                    Better wait in station than ride slow train, or worse, train going backward.
                </p>

                <h3>Why India have seasons?</h3>
                <p>Many event repeat same time each year and move prices:</p>
                <ul>
                    <li><strong>Festival buying</strong> — Diwali, Navratri, Dussehra push consumer and jewellery stocks up</li>
                    <li><strong>Tax year end/start</strong> — March–April see selling for loss-booking, then fresh buying</li>
                    <li><strong>Monsoon</strong> — good rain = rural income = FMCG, tractor, fertiliser stocks rise</li>
                    <li><strong>Marriage season</strong> — Nov–Feb big demand for gold, jewellery, consumer goods</li>
                    <li><strong>Dividends</strong> — many companies pay same date each year, stock dip after ex-date, recover after</li>
                    <li><strong>Astrology &amp; muhurat trading</strong> — Diwali muhurat session, auspicious dates cause real volume spikes</li>
                </ul>
                <p>These pattern repeat enough that Meguru brain can find and trade them.</p>
            </div>
        );
    }

    renderQuickstart() {
        return (
            <div className="help-section">
                <h3>Quick Start</h3>

                <h4>1 — Add stocks</h4>
                <p>
                    Click <strong>Add Stock</strong>. Type NSE symbol (<code>RELIANCE</code>, <code>TCS</code>…).
                    First time: downloads 25 years from Yahoo, stores in browser. Takes few seconds. Next time instant.
                    Auto-tunes settings after add. Or click <strong>Curated baskets</strong> to load ready basket.
                </p>

                <h4>2 — Poke sliders</h4>
                <p>
                    Click <span className="help-icon">&#9654;</span> on stock tile → three sliders appear.
                    Meguru brain already optimise these when stock added — no need to touch unless experimenting.
                    See <strong>Parameters</strong> tab for what each slider do.
                </p>

                <h4>3 — Read chart</h4>
                <p>
                    <strong>Bar</strong>: one column per year. Left = hold-all-year. Right = plan, colored by stock.
                    Bar below zero: right half = losses, left half = gains eaten by those losses.
                </p>
                <p>
                    <strong>Line</strong>: daily money curve for one year (or average). Shaded bands show when holding — green band = window was profitable, red band = window lost money.
                    Click stock tile to solo it. Click green dot to hide without removing.
                </p>

                <h4>4 — Split money</h4>
                <p>Vertical bar left of chart = money split. Pick from dropdown:</p>
                <ul>
                    <li><strong>Equal</strong> — same amount of money to every stock.</li>
                    <li><strong>Avg Return</strong> — more money to stocks with higher average profit. Winners get bigger slice.</li>
                    <li><strong>Custom</strong> — +/− adjuster on bar, 5% steps. First copy from current mode with <em>Copy to custom</em>.</li>
                </ul>
                <p><span className="help-icon">&#128161;</span> bulb = Meguru brain auto-find best split.</p>

                <h4>5 — Save / export</h4>
                <ul>
                    <li><strong>Save</strong> — JSON file with everything.</li>
                    <li><strong>Load</strong> — put basket back, missing data auto-downloaded.</li>
                    <li><strong>Backtest CSV</strong> — trade math for spreadsheet. Check Meguru brain not making error.</li>
                    <li><strong>Trade Calendar</strong> — BUY/SELL dates checklist.</li>
                </ul>
            </div>
        );
    }

    renderParameters() {
        return (
            <div className="help-section">
                <h3>Sliders</h3>
                <dl>
                    <dt>Sample years</dt>
                    <dd>
                        How many past years Meguru brain study. Default 10.
                        More = more sure, slower to notice market changed.
                    </dd>

                    <dt>Min Window</dt>
                    <dd>Shortest buy-hold time allowed (days). Too short = catch noise. Too long = blur signal.</dd>

                    <dt>Win %</dt>
                    <dd>
                        Window must win at least this many years. <strong>Floor 50%</strong> — losing window not signal.
                        But 50% can still work — most stocks gain more than they lose each year when look at many years,
                        so even a 50% window may have positive average return if good years bigger than bad years.
                    </dd>
                </dl>
                <p className="help-note">Max window fixed at 180 days. Cannot change.</p>
                <p className="help-note">
                    Tip: click green dot next to stock name to hide it from calculation — useful to see effect of removing one stock.
                    Works by setting that stock alloc to 0 so Meguru brain ignore it. Click again to bring back.
                </p>
                <p className="help-note">
                    ⚠️ <strong>2020</strong> (COVID crash) and <strong>2008</strong> (global crash) weird years — big wild moves not normal.
                    Indian market changed a lot from 2020 onward. Including too many pre-2020 years may teach Meguru brain wrong lesson.
                    10 years good start. Try fewer if plan look strange.
                </p>
            </div>
        );
    }

    renderAllocation() {
        return (
            <div className="help-section">
                <h3>How to split money</h3>
                <dl>
                    <dt>Equal</dt>
                    <dd>Same slice for all visible stocks.</dd>

                    <dt>Avg Return</dt>
                    <dd>Stocks that earned more in past get bigger slice.</dd>

                    <dt>Custom</dt>
                    <dd>+/− adjuster on alloc bar (5% steps). To edit, first click <em>Copy to custom</em> — this snapshot current split into Custom mode so you can adjust from there. Cannot edit bars in Equal or Avg Return mode.</dd>
                </dl>
            </div>
        );
    }

    renderOptimizers() {
        return (
            <div className="help-section">
                <h3>&#128161; Stock bulb</h3>
                <p>
                    On stock tile. Try all combos of Min Window + Win% sliders.
                    Pick combo with best <em>quality score</em> (not just biggest return).
                </p>

                <h3>&#128161; Allocation bulb</h3>
                <p>
                    Next to alloc bar. Try all money splits. Pick best basket quality score.
                    Only visible stocks count.
                </p>

                <h3>Quality score</h3>
                <p>Both bulbs use same Meguru brain scoring:</p>
                <dl>
                    <dt>Efficiency</dt>
                    <dd>
                        Plan return &divide; (hold-all-year return &times; fraction of year held).
                        Score &gt; 1 = plan earn more than expected for time in market.
                    </dd>
                    <dt>Downside penalty</dt>
                    <dd>
                        Bad years hurt score. Good years do not. Formula:
                        {' '}<code>1 / (1 + 3 &times; rms-of-losses)</code>.
                        Consistent plan = small penalty. Wild lossy plan = big penalty.
                    </dd>
                    <dt>Quality</dt>
                    <dd><code>efficiency &times; downside penalty</code>. Higher = better.</dd>
                </dl>

                <p className="help-note">Both bulbs freeze screen while thinking. Overlay shows during.</p>
            </div>
        );
    }

    renderGraph() {
        return (
            <div className="help-section">
                <h3>Views</h3>
                <dl>
                    <dt>Line</dt>
                    <dd>Daily money curve for one year (or average of all years). Shaded bands show when holding — green = profitable window, red = losing window.</dd>

                    <dt>Bar</dt>
                    <dd>One column per year. Stacked by stock color.</dd>
                </dl>
                <p><strong>Backtest years</strong> dropdown applies to <em>both</em> Line and Bar — controls how many years Meguru brain show.</p>

                <h3>Y range</h3>
                <p><strong>Y min</strong> / <strong>Y max</strong> dropdowns top-right. Saved across reloads.</p>

                <h3>Alloc bar</h3>
                <p>Vertical bar left of chart = money split. Hover for +/− adjusters in Custom mode.</p>

                <h3>Sharp dip at end</h3>
                <p>Line drop hard at year end = 20% tax eaten from profit. Normal. Trade fees already swallowed inside each window.</p>
            </div>
        );
    }

    renderExports() {
        return (
            <div className="help-section">
                <h3>Backtest CSV</h3>
                <p>
                    Day-by-day trade log for one year. Shows exactly what happen when buy and sell on Meguru plan.
                    Open in Google Sheets / Excel to verify Meguru brain not making error — see each window, each price, each gain.
                </p>
                <p className="help-note">
                    ⚠️ All numbers depend on Yahoo Finance price data. Yahoo price <strong>not adjusted for dividends</strong>.
                    If stock pay big dividend, price show fake drop on ex-date. Real return may be higher than shown.
                </p>

                <h3>Trade Calendar</h3>
                <p>BUY/SELL dates for whole basket. Use as checklist or drop in calendar app.</p>

                <h3>Save / Load</h3>
                <p>
                    JSON file with stocks, params, alloc mode, weights.
                    <strong> Load replaces whole basket.</strong> Missing price data auto-downloaded.
                </p>
            </div>
        );
    }

    renderGlossary() {
        return (
            <div className="help-section">
                <h3>Window numbers</h3>
                <dl>
                    <dt>Day Range</dt>
                    <dd>Which days of year window open (1–366).</dd>
                    <dt>Win %</dt>
                    <dd>How many years this window made money.</dd>
                    <dt>Expected %</dt>
                    <dd>Average return across all years.</dd>
                    <dt>%/day</dt>
                    <dd>Expected % ÷ days open.</dd>
                    <dt>Profit Ratio</dt>
                    <dd>Average win size ÷ average loss size.</dd>
                </dl>

                <h3>Summary numbers</h3>
                <dl>
                    <dt>Plan Return</dt>
                    <dd>Average yearly return following plan.</dd>
                    <dt>B&amp;H Return</dt>
                    <dd>Average yearly return holding all year.</dd>
                    <dt>Days In Market</dt>
                    <dd>Fraction of year money actually working.</dd>
                    <dt>Plan Quality</dt>
                    <dd>Smart score — plan return vs time held, minus pain from bad years. Higher = better.</dd>
                </dl>
            </div>
        );
    }

    renderMethodology() {
        return (
            <div className="help-section">
                <h3>How Meguru brain work</h3>
                <ol>
                    <li>Grab daily prices from Yahoo, save per year in browser cave (OPFS).</li>
                    <li>Try every window size from <code>nWinMin</code> to 180 days.</li>
                    <li>Keep windows that won at least <code>fPctWin</code>% of last <code>nYears</code>.</li>
                    <li>Surviving windows → plan: BUY at start, SELL at end, sit flat otherwise.</li>
                    <li>Run all stocks' plans, weight by allocation, add up daily money.</li>
                </ol>

                <h3>Warnings</h3>
                <ul>
                    <li>History fitting. Past good time not promise future good time.
                        Meguru brain learn from past, cannot see future.</li>
                    <li>Fee = 0.04% of trade value, charged on each BUY and each SELL.</li>
                    <li>Tax = 20% STCG applied on net profit at end of each year.</li>
                    <li>Yahoo price = end of day, split-fixed, maybe not dividend-fixed.</li>
                </ul>

                <h3>Built with</h3>
                <p>C++23 → WebAssembly (Emscripten) · Preact · Chart.js · OPFS · Cloudflare Workers &amp; Pages</p>
            </div>
        );
    }

    renderMakerWay() {
        return (
            <div className="help-section">
                <h3>How maker use Meguru</h3>
                <p>
                    Maker build plan careful, not rush. Here how:
                </p>

                <h4>1 — Find solid stock first</h4>
                <p>
                    Go to stock screener site. Look for stocks with strong consistent performance —
                    good revenue growth, not too much debt, not baby company.
                    Meguru brain cannot fix bad stock. Garbage in, garbage out.
                </p>

                <h4>2 — Add to basket, check bar chart</h4>
                <p>
                    Add stock. Switch to <strong>Bar</strong> view. Look across many years.
                    Good stock show mostly positive bars. If many red years, stock too wild or not seasonal.
                    Check Plan Return vs B&amp;H — plan should beat or match hold.
                </p>

                <h4>3 — Check quality score</h4>
                <p>
                    Quality score in stats panel tell truth:
                </p>
                <ul>
                    <li><strong>&gt; 1.5</strong> — decent. Worth using.</li>
                    <li><strong>&gt; 3.0</strong> — exceptional. Rare. Keep this stock.</li>
                    <li><strong>Below 1.0</strong> — plan not good enough. Try different params or drop stock.</li>
                </ul>

                <h4>4 — Young stock = less trust</h4>
                <p>
                    Stock born only few years ago = not enough history for Meguru brain to study.
                    Pattern may be noise, not real season. Need at least 8–10 years for brain to be confident.
                    Short history stock can still be in basket but give less weight.
                </p>

                <h4>5 — Test basket addition carefully</h4>
                <p>
                    When adding stock to basket, watch two things:
                </p>
                <ul>
                    <li>Either plan return or quality should go up.</li>
                    <li>The other should not go down too much.</li>
                </ul>
                <p>
                    If both go down after adding — that stock making basket worse. Better to remove.
                    Good basket stock add value. Dead weight drag whole basket.
                </p>

                <h4>6 — Building good plan need effort</h4>
                <p>
                    Not easy to build very good plan. Need patient study, try many stocks, compare, remove weak ones.
                    But effort reward well — even decent plan beat random holding over many years.
                </p>

                <h4>B&amp;H data also useful</h4>
                <p>
                    Even if Grug not want to follow Meguru plan, B&amp;H return data in chart useful.
                    Shows which stock historically grow well over long time.
                    Good for HODL style investor who just want to buy solid stock and forget.
                </p>

                <h3>Disclaimer</h3>
                <p>
                    Meguru maker put own money where mouth is. Trust Meguru system with own shiny rocks.
                    If other Grug follow and lose many shiny rock — blame market, blame karma, blame the stars.
                    Not blame Meguru. Not blame maker. Meguru is research tool, not financial advisor.
                    Past seasons not guarantee future seasons. Grug must think for self.
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
            case 'makerway':     return this.renderMakerWay();
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
                        <h2 id="help-modal-title">How Grug learn Meguru</h2>
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
