import { Component } from 'preact';
import { calcQuality, formatQuality } from '../util/metrics';

// Bottom stats panel (20% of viewport height).
//
// When a stock is selected: shows trade window stats table (like old PlanTable).
// When no stock selected: shows per-stock summary cards from basket result.
//
// Props:
//   selectedStock: string|null
//   stockDetail: object|null - parsed getStockDetail() result
//   basketResult: object|null - parsed getBasketResult() result

class StatsPanel extends Component {

    state = { capital: 100000 };

    renderTradeTable() {
        const { stockDetail } = this.props;
        if (!stockDetail || !stockDetail.stats || stockDetail.stats.length === 0) {
            return <div className="empty-state">No trade windows found</div>;
        }

        const { stats, years } = stockDetail;
        const yearList = Array.isArray(years) ? years : [];

        const nFixedCols = 5;
        const nYearCols = yearList.length;
        const nFixedWidth = 76;
        const nYearWidth = 68;
        const nTableWidth = nFixedCols * nFixedWidth + nYearCols * nYearWidth;

        return (
            <div className="trade-table-container">
                <table className="trade-table" style={{ width: nTableWidth + 'px' }}>
                    <colgroup>
                        {Array.from({ length: nFixedCols }, (_, i) => (
                            <col key={`f${i}`} style={{ width: nFixedWidth + 'px' }} />
                        ))}
                        {yearList.map(year => (
                            <col key={year} style={{ width: nYearWidth + 'px' }} />
                        ))}
                    </colgroup>
                    <thead>
                        <tr>
                            <th>Day Range</th>
                            <th>Win %</th>
                            <th>Expected %</th>
                            <th>%/day</th>
                            <th>Profit Ratio</th>
                            {yearList.map(year => <th key={year}>{year}</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {stats.map((stat, idx) => {
                            const windowSize = stat.iEnd - stat.iBeg;
                            const pctPerDay = windowSize > 0 ? stat.pctExpected / windowSize : 0;

                            return (
                                <tr key={idx}>
                                    <td>{String(stat.iBeg).padStart(3, '\u2007')}-{String(stat.iEnd).padStart(3, '\u2007')}</td>
                                    <td>{stat.pctWin.toFixed(1)}%</td>
                                    <td>{stat.pctExpected.toFixed(2)}%</td>
                                    <td>{pctPerDay.toFixed(3)}%</td>
                                    <td>{stat.fProfitRatio.toFixed(2)}x</td>
                                    {stat.yearlyReturns && stat.yearlyReturns.map((ret, i) => (
                                        <td key={i} className={ret >= 0 ? 'positive' : 'negative'}>
                                            {ret.toFixed(2)}%
                                        </td>
                                    ))}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        );
    }

    renderPerStockSummary() {
        const { basketResult, stockData } = this.props;
        if (!basketResult) {
            return <div className="empty-state">Add stocks to see summary</div>;
        }

        const years = Array.isArray(basketResult.years) ? basketResult.years : [];
        const planMap   = basketResult.perStockPlan   || {};
        const holdMap   = basketResult.perStockHold   || {};
        const basketAvg = basketResult.basketAvg      || {};
        const weightMap = basketResult.weightsPerStock || {};
        const daysMap   = basketResult.daysInMarket    || {};

        const symbols = Object.keys(planMap).filter(
            sym => !stockData || stockData[sym]?.visible !== false
        );
        if (symbols.length === 0) {
            return <div className="empty-state">Add stocks to see summary</div>;
        }

        // End-of-year fractional return for a curve. last value of [366] array.
        const endVal = (curve) => {
            if (!curve || curve.length === 0) return 0;
            return curve[curve.length - 1];
        };

        // Per-stock metrics: average plan/hold % across years and quality
        // scores (winRate * edge) for both plan and B&H per-year returns.
        const arrStockStats = symbols.map(sym => {
            const planByYear = planMap[sym] || {};
            const holdByYear = holdMap[sym] || {};

            let sumPlan = 0, sumHold = 0, nYrs = 0;
            const planReturns = [];
            const holdReturns = [];
            for (const y of years) {
                const k = String(y);
                const p = endVal(planByYear[k]);
                const h = endVal(holdByYear[k]);
                if (planByYear[k] === undefined && holdByYear[k] === undefined) continue;
                sumPlan += p;
                sumHold += h;
                planReturns.push(p);
                holdReturns.push(h);
                nYrs++;
            }
            const avgPlan = nYrs > 0 ? sumPlan / nYrs : 0;
            const avgHold = nYrs > 0 ? sumHold / nYrs : 0;

            return {
                stock: sym,
                avgPlan: avgPlan * 100,
                avgBh:   avgHold * 100,
                nYrs,
                daysFrac: (daysMap[sym] || 0) * 100,
                planQuality: calcQuality(planReturns, holdReturns, daysMap[sym] || 0)
            };
        });

        // Basket totals: plan curve from basketAvg, B&H curve = weighted sum of
        // per-stock hold curves using year-specific weights.
        // Days-in-market: weighted average across stocks using key-0 weights.
        let totalPlan = 0, totalHold = 0, totalYrs = 0;
        const basketPlanReturns = [];
        const basketBhReturns = [];
        for (const y of years) {
            const k = String(y);
            const planEnd = endVal(basketAvg[k]);
            // weighted B&H end-of-year
            let bhEnd = 0, wSum = 0;
            for (const sym of symbols) {
                const w = (weightMap[sym] || {})[k];
                if (w === undefined) continue;
                const h = endVal((holdMap[sym] || {})[k]);
                bhEnd += w * h;
                wSum += w;
            }
            if (wSum > 0) bhEnd = bhEnd / wSum;

            if (basketAvg[k] === undefined) continue;
            totalPlan += planEnd;
            totalHold += bhEnd;
            basketPlanReturns.push(planEnd);
            basketBhReturns.push(bhEnd);
            totalYrs++;
        }
        // Weighted-average days-in-market across stocks (using key-0 weights)
        let basketDaysFrac = 0, basketWSum = 0;
        for (const sym of symbols) {
            const w = (weightMap[sym] || {})['0'];
            const d = daysMap[sym];
            if (w === undefined || d === undefined) continue;
            basketDaysFrac += w * d;
            basketWSum += w;
        }
        if (basketWSum > 0) basketDaysFrac /= basketWSum;

        const totalsAvgPlan = totalYrs > 0 ? totalPlan / totalYrs : 0;
        const totalsAvgBh   = totalYrs > 0 ? totalHold / totalYrs : 0;
        const totals = totalYrs > 0 ? {
            avgPlan:     totalsAvgPlan * 100,
            avgBh:       totalsAvgBh   * 100,
            nYrs:        totalYrs,
            daysFrac:    basketDaysFrac * 100,
            planQuality: calcQuality(basketPlanReturns, basketBhReturns, basketDaysFrac)
        } : null;

        const nLabelWidth = 100;
        const nColWidth = 88;
        const nStockCols = arrStockStats.length + (totals ? 1 : 0);
        const nTableWidth = nLabelWidth + nStockCols * nColWidth;

        const fmtPct = (v) => (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
        const clsPct = (v) => v >= 0 ? 'positive' : 'negative';

        // Allocation row: % of basket capital per stock (key-0 weight).
        const fmtAllocPct = (w) => (w == null || !Number.isFinite(w)) ? '-' : (w * 100).toFixed(1) + '%';
        const weightFor = (sym) => (weightMap[sym] || {})['0'];

        return (
            <div className="trade-table-container">
                <table className="trade-table" style={{ width: nTableWidth + 'px' }}>
                    <colgroup>
                        <col style={{ width: nLabelWidth + 'px' }} />
                        {totals && <col style={{ width: nColWidth + 'px' }} />}
                        {arrStockStats.map(s => (
                            <col key={s.stock} style={{ width: nColWidth + 'px' }} />
                        ))}
                    </colgroup>
                    <thead>
                        <tr>
                            <th style={{ textAlign: 'left' }}></th>
                            {totals && <th>Basket</th>}
                            {arrStockStats.map(s => <th key={s.stock}>{s.stock}</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td style={{ textAlign: 'left' }}>Allocation</td>
                            {totals && <td>100.0%</td>}
                            {arrStockStats.map(s => (
                                <td key={s.stock}>{fmtAllocPct(weightFor(s.stock))}</td>
                            ))}
                        </tr>
                        <tr>
                            <td style={{ textAlign: 'left' }}>Plan Return</td>
                            {totals && <td className={clsPct(totals.avgPlan)}>{fmtPct(totals.avgPlan)}</td>}
                            {arrStockStats.map(s => (
                                <td key={s.stock} className={clsPct(s.avgPlan)}>{fmtPct(s.avgPlan)}</td>
                            ))}
                        </tr>
                        <tr>
                            <td style={{ textAlign: 'left' }}>B&H Return</td>
                            {totals && <td className={clsPct(totals.avgBh)}>{fmtPct(totals.avgBh)}</td>}
                            {arrStockStats.map(s => (
                                <td key={s.stock} className={clsPct(s.avgBh)}>{fmtPct(s.avgBh)}</td>
                            ))}
                        </tr>
                        <tr>
                            <td style={{ textAlign: 'left' }}>Days In Market</td>
                            {totals && <td>{totals.daysFrac.toFixed(1)}%</td>}
                            {arrStockStats.map(s => (
                                <td key={s.stock}>{s.daysFrac.toFixed(1)}%</td>
                            ))}
                        </tr>
                        <tr>
                            <td style={{ textAlign: 'left' }}>Plan Quality</td>
                            {totals && <td className={totals.planQuality > 0 ? 'positive' : 'negative'}>{formatQuality(totals.planQuality)}</td>}
                            {arrStockStats.map(s => (
                                <td key={s.stock} className={s.planQuality > 0 ? 'positive' : 'negative'}>{formatQuality(s.planQuality)}</td>
                            ))}
                        </tr>
                    </tbody>
                </table>
            </div>
        );
    }

    render() {
        const { selectedStock, stockDetail } = this.props;

        const headerText = selectedStock
            ? `Trade Windows - ${selectedStock}`
            : 'Basket Summary';

        return (
            <div className="stats-panel">
                <div className="stats-panel-header">
                    <h3>{headerText}</h3>
                </div>
                {selectedStock && stockDetail
                    ? this.renderTradeTable()
                    : this.renderPerStockSummary()
                }
            </div>
        );
    }
}

export default StatsPanel;
