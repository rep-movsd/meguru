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

        return (
            <div className="trade-table-container">
                <table className="trade-table">
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
                                    <td>{stat.iBeg} - {stat.iEnd}</td>
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

        return (
            <div className="stats-panel-content">
                {/* Aggregate stats bar */}
                {stats && (
                    <div className="basket-stats-bar">
                        <span className="stat-item">
                            <span className="stat-label">Avg Plan:</span>
                            <span className={`stat-value ${stats.avgPlan >= 0 ? 'positive' : 'negative'}`}>
                                {stats.avgPlan.toFixed(1)}%
                            </span>
                        </span>
                        <span className="stat-item">
                            <span className="stat-label">Avg B&H:</span>
                            <span className="stat-value">{stats.avgBh.toFixed(1)}%</span>
                        </span>
                        <span className="stat-item">
                            <span className="stat-label">Beats B&H:</span>
                            <span className="stat-value">{stats.beatsBh}/{stats.totalYears} yrs</span>
                        </span>
                        <span className="stat-item">
                            <span className="stat-label">Sharpe:</span>
                            <span className={`stat-value ${stats.sharpe >= 1.0 ? 'positive' : ''}`}>
                                {stats.sharpe.toFixed(2)}
                            </span>
                        </span>
                    </div>
                )}

                {/* Per-stock summary cards */}
                <div className="per-stock-summary">
                    {perStock.map(sr => {
                        const avgPlan = sr.years.length > 0
                            ? sr.years.reduce((s, y) => s + y.plan, 0) / sr.years.length
                            : 0;
                        const avgBh = sr.years.length > 0
                            ? sr.years.reduce((s, y) => s + y.bh, 0) / sr.years.length
                            : 0;

                        return (
                            <div className="per-stock-card" key={sr.stock}>
                                <span className="card-stock">{sr.stock}</span>
                                <div className="card-stat">
                                    <span className="label">Plan:</span>
                                    <span className={`value ${avgPlan >= 0 ? 'positive' : 'negative'}`}>
                                        {avgPlan.toFixed(1)}%
                                    </span>
                                </div>
                                <div className="card-stat">
                                    <span className="label">B&H:</span>
                                    <span className="value">{avgBh.toFixed(1)}%</span>
                                </div>
                                <div className="card-stat">
                                    <span className="label">Days:</span>
                                    <span className="value">{sr.daysInMarket}/365</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
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
