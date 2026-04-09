import { Component } from 'preact';

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

    renderTradeTable() {
        const { stockDetail } = this.props;
        if (!stockDetail || !stockDetail.stats || stockDetail.stats.length === 0) {
            return <div className="empty-state">No trade windows found</div>;
        }

        const { stats, years } = stockDetail;
        const yearList = years ? years.map(y => y.year).sort((a, b) => b - a) : [];

        const nFixedCols = 6;
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
                            <th>Skew</th>
                            <th>Sharpe</th>
                            <th>Expected %</th>
                            <th>%/day</th>
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
                                    <td>{stat.fSkew.toFixed(2)}</td>
                                    <td>{stat.fSharpe.toFixed(2)}</td>
                                    <td>{stat.pctExpected.toFixed(2)}%</td>
                                    <td>{pctPerDay.toFixed(3)}%</td>
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
        const { basketResult } = this.props;
        if (!basketResult || !basketResult.perStock || basketResult.perStock.length === 0) {
            return <div className="empty-state">Add stocks to see summary</div>;
        }

        const { perStock, stats } = basketResult;

        // Precompute per-stock stats
        const arrStockStats = perStock.map(sr => {
            const nYrs = sr.years.length;
            const avgPlan = nYrs > 0 ? sr.years.reduce((s, y) => s + y.plan, 0) / nYrs : 0;
            const avgBh = nYrs > 0 ? sr.years.reduce((s, y) => s + y.bh, 0) / nYrs : 0;
            const diff = avgPlan - avgBh;
            const nBeatsBh = sr.years.filter(y => y.plan > y.bh).length;
            const profitRatio = avgBh !== 0 ? avgPlan / avgBh : 0;
            return { stock: sr.stock, avgPlan, avgBh, diff, nBeatsBh, nYrs, profitRatio, daysInMarket: sr.daysInMarket };
        });

        // Also compute basket totals from stats
        const totals = stats ? {
            avgPlan: stats.avgPlan,
            avgBh: stats.avgBh,
            diff: stats.avgPlan - stats.avgBh,
            nBeatsBh: stats.beatsBh,
            nYrs: stats.totalYears,
            profitRatio: stats.avgBh !== 0 ? stats.avgPlan / stats.avgBh : 0,
        } : null;

        const nLabelWidth = 100;
        const nColWidth = 88;
        const nStockCols = arrStockStats.length + (totals ? 1 : 0);
        const nTableWidth = nLabelWidth + nStockCols * nColWidth;

        const fmtPct = (v) => (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
        const clsPct = (v) => v >= 0 ? 'positive' : 'negative';

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
                            <td style={{ textAlign: 'left' }}>Plan Return</td>
                            {totals && <td className={clsPct(totals.avgPlan)}>{fmtPct(totals.avgPlan)}</td>}
                            {arrStockStats.map(s => (
                                <td key={s.stock} className={clsPct(s.avgPlan)}>{fmtPct(s.avgPlan)}</td>
                            ))}
                        </tr>
                        <tr>
                            <td style={{ textAlign: 'left' }}>B&H Return</td>
                            {totals && <td>{fmtPct(totals.avgBh)}</td>}
                            {arrStockStats.map(s => (
                                <td key={s.stock}>{fmtPct(s.avgBh)}</td>
                            ))}
                        </tr>
                        <tr>
                            <td style={{ textAlign: 'left' }}>Difference</td>
                            {totals && <td className={clsPct(totals.diff)}>{fmtPct(totals.diff)}</td>}
                            {arrStockStats.map(s => (
                                <td key={s.stock} className={clsPct(s.diff)}>{fmtPct(s.diff)}</td>
                            ))}
                        </tr>
                        <tr>
                            <td style={{ textAlign: 'left' }}>Beats B&H</td>
                            {totals && <td>{totals.nBeatsBh}/{totals.nYrs}</td>}
                            {arrStockStats.map(s => (
                                <td key={s.stock}>{s.nBeatsBh}/{s.nYrs}</td>
                            ))}
                        </tr>
                        <tr>
                            <td style={{ textAlign: 'left' }}>Profit Ratio</td>
                            {totals && <td className={clsPct(totals.profitRatio - 1)}>{totals.profitRatio.toFixed(2)}x</td>}
                            {arrStockStats.map(s => (
                                <td key={s.stock} className={clsPct(s.profitRatio - 1)}>{s.profitRatio.toFixed(2)}x</td>
                            ))}
                        </tr>
                        <tr>
                            <td style={{ textAlign: 'left' }}>In Market</td>
                            {totals && <td></td>}
                            {arrStockStats.map(s => (
                                <td key={s.stock}>{s.daysInMarket}/365</td>
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
