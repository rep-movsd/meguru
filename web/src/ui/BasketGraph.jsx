import { Component, createRef } from 'preact';
import Chart from 'chart.js/auto';
import { getBasketColors } from './utils';
import { calcQuality, formatQuality } from '../util/metrics';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const DAYS = 366;

// Two-mode graph:
//   1. Basket mode (no stock selected): line or bar chart of aggregate returns
//   2. Stock mode (stock selected): single-stock return chart with shaded trade windows
//
// Props:
//   selectedStock: string|null
//   basketResult: object|null - parsed getBasketResult()
//   stockDetail: object|null - parsed getStockDetail()
//   stockData: { [sym]: { color, allocPct, visible } } - for colors and allocation
//   stocks: string[] - ordered list of symbols
//   allocMode: string
//   allocModes: { value, label }[]
//   viewMode: string - 'line' or 'bar'
//   selectedYear: string - year number or 'Average'
//   onViewModeChange: (mode) => void
//   onYearChange: (year) => void
//   onAllocModeChange: (mode) => void
//   onUpdateAllocPct: (symbol, delta) => void

class BasketGraph extends Component {
    constructor(props) {
        super(props);
        this.chartRef = createRef();
        this.chart = null;
        this._createRaf = 0;
    }

    componentDidMount() {
        this.createChart();
    }

    componentDidUpdate(prevProps) {
        const modeChanged = prevProps.selectedStock !== this.props.selectedStock ||
                           prevProps.viewMode !== this.props.viewMode;
        const dataChanged = prevProps.basketResult !== this.props.basketResult ||
                           prevProps.stockDetail !== this.props.stockDetail ||
                           prevProps.selectedYear !== this.props.selectedYear;

        if (modeChanged) {
            // Recreate chart when switching between stock/basket or line/bar.
            // Defer to next frame so the browser has completed layout and the
            // canvas has its final dimensions before Chart.js reads them.
            if (this.chart) {
                this.chart.destroy();
                this.chart = null;
            }
            cancelAnimationFrame(this._createRaf);
            this._createRaf = requestAnimationFrame(() => {
                this._createRaf = 0;
                this.createChart();
            });
        } else if (dataChanged) {
            // If a deferred createChart is pending, skip — createChart will
            // call updateChart itself once the chart is ready.
            if (!this._createRaf) {
                this.updateChart();
            }
        }
    }

    componentWillUnmount() {
        cancelAnimationFrame(this._createRaf);
        if (this.chart) {
            this.chart.destroy();
        }
    }

    // -----------------------------------------------------------------------
    // Chart creation
    // -----------------------------------------------------------------------

    createChart = () => {
        if (!this.chartRef.current) return;
        const ctx = this.chartRef.current.getContext('2d');

        // Always basket-level chart. Stock selection only drives the stats panel.
        if (this.props.viewMode === 'bar') {
            this.createBarChart(ctx);
        } else {
            this.createLineChart(ctx);
        }

        this.updateChart();
    }

    // Vertical hover line plugin (shared)
    verticalLinePlugin = {
        id: 'verticalLine',
        afterDraw: (chart) => {
            if (chart.tooltip?._active?.length) {
                const ctx = chart.ctx;
                const x = chart.tooltip._active[0].element.x;
                const topY = chart.scales.y.top;
                const bottomY = chart.scales.y.bottom;

                ctx.save();
                ctx.beginPath();
                ctx.moveTo(x, topY);
                ctx.lineTo(x, bottomY);
                ctx.lineWidth = 1;
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
                ctx.setLineDash([5, 5]);
                ctx.stroke();
                ctx.restore();
            }
        }
    };

    // Trade window overlay plugin (for stock mode)
    // Plugin for basket line chart: shaded rectangles for the selected stock's
    // trading windows. Source: chart.data.tradeWindows = [{iBeg,iEnd,pctExpected}].
    // Dark green when avg expected > 0 (gain), dark red when < 0 (loss).
    basketTradeWindowPlugin = {
        id: 'basketTradeWindows',
        afterDatasetsDraw: (chart) => {
            const wins = chart.data.tradeWindows;
            if (!wins || !wins.length) return;

            const ctx = chart.ctx;
            const xScale = chart.scales.x;
            const yScale = chart.scales.y;

            ctx.save();
            for (const w of wins) {
                const x1 = xScale.getPixelForValue(w.iBeg);
                const x2 = xScale.getPixelForValue(w.iEnd);
                const isGain = (w.pctExpected ?? 0) >= 0;
                ctx.fillStyle = isGain
                    ? 'rgba(0, 100, 0, 0.28)'
                    : 'rgba(140, 0, 0, 0.28)';
                ctx.fillRect(x1, yScale.top, x2 - x1, yScale.bottom - yScale.top);
            }

            // Labels above rectangles: avg expected %
            ctx.font = '11px "Courier New", Courier, monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
            ctx.shadowBlur = 3;

            for (const w of wins) {
                const x1 = xScale.getPixelForValue(w.iBeg);
                const x2 = xScale.getPixelForValue(w.iEnd);
                const xc = (x1 + x2) / 2;
                const pct = w.pctExpected ?? 0;
                const sign = pct >= 0 ? '+' : '';
                ctx.fillStyle = pct >= 0 ? '#4CAF50' : '#f44336';
                ctx.fillText(sign + pct.toFixed(1) + '%', xc, yScale.top + 6);
            }
            ctx.restore();
        }
    };

    tradeWindowPlugin = {
        id: 'tradeWindows',
        afterDatasetsDraw: (chart) => {
            const yearData = chart.data.yearData;
            if (!yearData || !yearData.windows) return;

            const ctx = chart.ctx;
            const xScale = chart.scales.x;
            const yScale = chart.scales.y;

            ctx.save();

            // Shaded rectangles
            for (const win of yearData.windows) {
                const x1 = xScale.getPixelForValue(win.iBeg);
                const x2 = xScale.getPixelForValue(win.iEnd);
                const isUp = win.priceEnd > win.priceBeg;
                ctx.fillStyle = isUp ? 'rgba(76, 175, 80, 0.15)' : 'rgba(244, 67, 54, 0.15)';
                ctx.fillRect(x1, yScale.top, x2 - x1, yScale.bottom - yScale.top);
            }

            // Labels
            ctx.font = '11px "Courier New", Courier, monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';

            const windowMultipliers = chart.data.windowMultipliers || [];

            for (const win of yearData.windows) {
                const x1 = xScale.getPixelForValue(win.iBeg);
                const x2 = xScale.getPixelForValue(win.iEnd);
                const xCenter = (x1 + x2) / 2;
                const yTop = yScale.top + 6;

                const multiplierInfo = windowMultipliers.find(
                    m => m.iBeg === win.iBeg && m.iEnd === win.iEnd
                );
                const windowMultiplier = multiplierInfo ? multiplierInfo.windowMultiplier : 1.0;

                const windowGain = ((win.priceEnd - win.priceBeg) / win.priceBeg) * 100;
                const sign = windowGain >= 0 ? '+' : '';
                const priceLabel = sign + windowGain.toFixed(1) + '%';
                const isLoss = windowGain < 0;
                const gainsLabel = 'x' + windowMultiplier.toFixed(2);

                ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
                ctx.shadowBlur = 3;
                ctx.shadowOffsetX = 0;
                ctx.shadowOffsetY = 0;

                ctx.fillStyle = isLoss ? '#f44336' : '#4CAF50';
                ctx.fillText(priceLabel, xCenter, yTop);

                ctx.fillStyle = windowMultiplier >= 1.0 ? '#4CAF50' : '#f44336';
                ctx.fillText(gainsLabel, xCenter, yTop + 14);
            }

            ctx.restore();
        }
    };

    createLineChart = (ctx) => {
        this.chart = new Chart(ctx, {
            type: 'line',
            data: { labels: [], datasets: [] },
            plugins: [this.verticalLinePlugin, this.basketTradeWindowPlugin],
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: { color: '#888', usePointStyle: true, pointStyle: 'line' }
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        backgroundColor: 'rgba(0,0,0,0.9)',
                        titleFont: { size: 11 },
                        bodyFont: { size: 11 },
                        borderColor: '#444',
                        borderWidth: 1,
                        callbacks: {
                            title: () => '',
                            label: (context) => {
                                const dayIndex = context.parsed.x;
                                const label = context.dataset.label;
                                if (label !== 'B&H') return '';
                                const bh = context.chart.data.datasets[0]?.data[dayIndex] ?? 0;
                                const plan = context.chart.data.datasets[1]?.data[dayIndex] ?? 0;
                                const pct = (v) => (v >= 0 ? '+' : '');
                                return [
                                    'Day: ' + (dayIndex + 1),
                                    'B&H: ' + pct(bh) + bh.toFixed(2) + '%',
                                    'Plan: ' + pct(plan) + plan.toFixed(2) + '%'
                                ];
                            }
                        }
                    }
                },
                scales: this.getLineScales(),
                interaction: { mode: 'index', intersect: false }
            }
        });
    }

    createStockChart = (ctx) => {
        this.chart = new Chart(ctx, {
            type: 'line',
            data: { labels: [], datasets: [] },
            plugins: [this.verticalLinePlugin, this.tradeWindowPlugin],
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        backgroundColor: 'rgba(0,0,0,0.9)',
                        titleFont: { size: 11 },
                        bodyFont: { size: 11 },
                        borderColor: '#444',
                        borderWidth: 1,
                        callbacks: {
                            title: () => '',
                            label: (context) => {
                                const dayIndex = context.parsed.x;
                                const label = context.dataset.label;
                                if (label !== 'B&H') return '';
                                const price = context.chart.data.datasets[0]?.originalPrices?.[dayIndex] ?? 0;
                                const bh = context.chart.data.datasets[0]?.data[dayIndex] ?? 0;
                                const plan = context.chart.data.datasets[1]?.data[dayIndex] ?? 0;
                                const pct = (v) => (v >= 0 ? '+' : '');
                                return [
                                    'Day: ' + (dayIndex + 1),
                                    'Price: ' + price.toFixed(2),
                                    'B&H: ' + pct(bh) + bh.toFixed(2) + '%',
                                    'Plan: ' + pct(plan) + plan.toFixed(2) + '%'
                                ];
                            }
                        }
                    }
                },
                scales: this.getLineScales(),
                interaction: { mode: 'index', intersect: false }
            }
        });
    }

    createBarChart = (ctx) => {
        // Alternating background bands
        const altBgPlugin = {
            id: 'altBg',
            beforeDraw: (chart) => {
                const { ctx, chartArea, scales } = chart;
                if (!chartArea || !scales.x) return;
                const labels = chart.data.labels;
                if (!labels.length) return;
                ctx.save();
                const bandWidth = (chartArea.right - chartArea.left) / labels.length;
                for (let i = 0; i < labels.length; i++) {
                    if (i % 2 === 1) {
                        ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
                        ctx.fillRect(chartArea.left + i * bandWidth, chartArea.top,
                                     bandWidth, chartArea.bottom - chartArea.top);
                    }
                }
                ctx.restore();
            }
        };

        // Total labels on top of stacked bars
        const totalLabelPlugin = {
            id: 'totalLabel',
            afterDatasetsDraw: (chart) => {
                const ctx = chart.ctx;
                const datasets = chart.data.datasets;
                if (!datasets.length) return;
                ctx.save();
                ctx.font = '11px "Courier New", Courier, monospace';
                ctx.textAlign = 'center';
                ctx.fillStyle = '#fff';
                const numLabels = chart.data.labels.length;
                const stacks = {};
                datasets.forEach((ds, idx) => {
                    const stack = ds.stack || 'default';
                    if (!stacks[stack]) stacks[stack] = [];
                    stacks[stack].push(idx);
                });
                for (let li = 0; li < numLabels; li++) {
                    Object.entries(stacks).forEach(([, dsIndices]) => {
                        let total = 0, topY = Infinity, x = null;
                        dsIndices.forEach(idx => {
                            total += datasets[idx].data[li] || 0;
                            const meta = chart.getDatasetMeta(idx);
                            if (meta.data[li]) {
                                const bar = meta.data[li];
                                if (bar.y < topY) topY = bar.y;
                                x = bar.x;
                            }
                        });
                        if (x !== null && Math.abs(total) > 0.5) {
                            const sign = total >= 0 ? '+' : '';
                            ctx.textBaseline = total >= 0 ? 'bottom' : 'top';
                            const labelY = total >= 0 ? topY - 3 : topY + 3;
                            ctx.fillText(sign + Math.round(total) + '%', x, labelY);
                        }
                    });
                }
                ctx.restore();
            }
        };

        this.chart = new Chart(ctx, {
            type: 'bar',
            data: { labels: [], datasets: [] },
            plugins: [altBgPlugin, totalLabelPlugin],
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        mode: 'nearest',
                        intersect: true,
                        backgroundColor: 'rgba(0,0,0,0.9)',
                        titleFont: { size: 11 },
                        bodyFont: { size: 11 },
                        borderColor: '#444',
                        borderWidth: 1,
                        callbacks: {
                            title: (items) => items.length ? items[0].label : '',
                            label: (context) => {
                                const value = context.parsed.y;
                                const sign = value >= 0 ? '+' : '';
                                if (context.dataset.stack === 'bh') {
                                    return ` B&H (avg): ${sign}${value.toFixed(1)}%`;
                                }
                                return ` ${context.dataset.label}: ${sign}${value.toFixed(1)}%`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        stacked: true,
                        grid: { color: '#333' },
                        ticks: { color: '#888' }
                    },
                    y: {
                        stacked: true,
                        position: 'left',
                        min: -50, max: 200,
                        afterFit: (axis) => { axis.width = 50; },
                        grid: { color: '#333' },
                        ticks: {
                            callback: (v) => v + '%',
                            color: '#888'
                        }
                    },
                    yRight: {
                        position: 'right',
                        min: -50, max: 200,
                        afterFit: (axis) => { axis.width = 50; },
                        grid: { drawOnChartArea: false },
                        ticks: {
                            callback: (v) => v + '%',
                            color: '#888'
                        }
                    }
                }
            }
        });
    }

    getLineScales = () => ({
        x: {
            title: { display: true, text: 'Month', color: '#888' },
            grid: { color: '#333' },
            ticks: {
                callback: function(value, index) {
                    const dayOfYear = index + 1;
                    let daySum = 0;
                    for (let m = 0; m < MONTHS.length; m++) {
                        if (dayOfYear === daySum + 1) return MONTHS[m];
                        daySum += MONTH_DAYS[m];
                    }
                    return null;
                },
                maxRotation: 0,
                autoSkip: true,
                maxTicksLimit: 12,
                color: '#888'
            }
        },
        y: {
            position: 'left',
            min: -50, max: 200,
            beginAtZero: false,
            afterFit: (axis) => { axis.width = 50; },
            grid: { color: '#333' },
            ticks: {
                callback: (v) => v + '%',
                stepSize: 10,
                color: '#888'
            }
        },
        yRight: {
            position: 'right',
            min: -50, max: 200,
            beginAtZero: false,
            afterFit: (axis) => { axis.width = 50; },
            grid: { drawOnChartArea: false },
            ticks: {
                callback: (v) => v + '%',
                stepSize: 10,
                color: '#888'
            }
        }
    })

    // -----------------------------------------------------------------------
    // Chart data updates
    // -----------------------------------------------------------------------

    // Resolve year data from a result object given the selected year.
    // Works for both basketResult (has .average, .years) and stockDetail.
    _resolveYearData = (result) => {
        if (!result) return null;
        const { selectedYear } = this.props;
        if (selectedYear === 'Average') return result.average || null;
        return result.years?.find(y => y.year === parseInt(selectedYear)) || null;
    }

    updateChart = () => {
        if (!this.chart) return;

        // Graph is always basket-level. Selecting a stock only drives the
        // bottom trade-windows panel — never switches the chart.
        if (this.props.viewMode === 'bar') {
            this.updateBarChart();
        } else {
            this.updateLineChart();
        }
    }

    updateLineChart = () => {
        const { basketResult, selectedYear, stockData } = this.props;
        if (!basketResult) {
            this.chart.data.labels = [];
            this.chart.data.datasets = [];
            this.chart.update();
            return;
        }

        const { perStockPlan, perStockHold, basketAvg, weightsPerStock } = basketResult;
        if (!basketAvg) {
            this.chart.data.labels = [];
            this.chart.data.datasets = [];
            this.chart.update();
            return;
        }

        // Year key: 0 = average across years, else specific year (numeric).
        const yearKey = (selectedYear === 'Average' || !selectedYear)
            ? 0
            : parseInt(selectedYear);

        // Plan curve direct from engine (already weighted across stocks).
        const planCurve = basketAvg[yearKey];
        if (!planCurve) {
            this.chart.data.labels = [];
            this.chart.data.datasets = [];
            this.chart.update();
            return;
        }

        // Build basket B&H curve in JS: Σ stocks weight[s][yearKey] * hold[s][yearKey].
        // Only visible stocks (engine already excluded hidden from weightsPerStock).
        const bhCurve = new Array(DAYS).fill(0);
        let bhWeightSum = 0;
        const symbols = Object.keys(weightsPerStock || {});
        for (const sym of symbols) {
            if (stockData && stockData[sym]?.visible === false) continue;
            const w = (weightsPerStock[sym] || {})[yearKey];
            if (!w) continue;
            const hold = (perStockHold?.[sym] || {})[yearKey];
            if (!hold || hold.length !== DAYS) continue;
            for (let i = 0; i < DAYS; i++) bhCurve[i] += w * hold[i];
            bhWeightSum += w;
        }
        const hasBh = bhWeightSum > 0;

        const labels = Array.from({ length: DAYS }, (_, i) => i + 1);
        const datasets = [];

        if (hasBh) {
            // Convert fractional returns to percentage for display consistency
            datasets.push({
                label: 'B&H',
                data: bhCurve.map(v => v * 100),
                borderColor: 'rgb(75, 192, 192)',
                tension: 0.1,
                borderWidth: 1.5,
                pointRadius: 0,
                pointHoverRadius: 4
            });
        }

        // planCurve is fractional returns ([0..1]) — multiply by 100 for percent
        datasets.push({
            label: 'Plan',
            data: Array.from(planCurve, v => v * 100),
            borderColor: 'rgb(76, 175, 80)',
            tension: 0,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4
        });

        this.chart.data.labels = labels;
        this.chart.data.datasets = datasets;

        // Trade-window overlay: only when a single stock is selected.
        // For 'Average' selection use stat.pctExpected (avg across years).
        // For a specific year use stat.yearlyReturns[idx] where idx maps via stockDetail.years.
        const stockDetail = this.props.stockDetail;
        if (this.props.selectedStock && stockDetail?.stats?.length) {
            const sel = this.props.selectedYear;
            const useAvg = (sel === 'Average' || !sel);
            let yearIdx = -1;
            if (!useAvg && Array.isArray(stockDetail.years)) {
                yearIdx = stockDetail.years.indexOf(parseInt(sel));
            }
            this.chart.data.tradeWindows = stockDetail.stats.map(s => {
                let pct = s.pctExpected;
                if (!useAvg && yearIdx >= 0 && Array.isArray(s.yearlyReturns)) {
                    const v = s.yearlyReturns[yearIdx];
                    if (typeof v === 'number') pct = v;
                }
                return { iBeg: s.iBeg, iEnd: s.iEnd, pctExpected: pct };
            });
        } else {
            this.chart.data.tradeWindows = null;
        }

        this.chart.update();
    }

    updateBarChart = () => {
        const { basketResult, stockData } = this.props;
        if (!basketResult || !basketResult.perStockPlan) {
            this.chart.data.labels = [];
            this.chart.data.datasets = [];
            this.chart.update();
            return;
        }

        const { years, perStockHold, perStockPlan, weightsPerStock } = basketResult;
        if (!years || years.length === 0) {
            this.chart.data.labels = [];
            this.chart.data.datasets = [];
            this.chart.update();
            return;
        }

        const stocks = Object.keys(perStockPlan);
        const labels = years.map(y => y.toString());
        const datasets = [];
        const BH_COLOR = 'rgba(140, 140, 140, 0.7)';
        const fallbackColors = getBasketColors(stocks);

        // B&H bar per year: equal-weight avg of per-stock B&H final returns (no fees, hodl).
        // Uses last day of each year's B&H curve (fractional → %).
        const bhData = years.map(year => {
            const yKey = String(year);
            let sum = 0, n = 0;
            for (const sym of stocks) {
                const curve = perStockHold[sym]?.[yKey];
                if (curve && curve.length > 365) {
                    sum += curve[365];
                    n++;
                }
            }
            return n > 0 ? (sum / n) * 100 : 0;
        });

        datasets.push({
            label: 'B&H',
            data: bhData,
            backgroundColor: BH_COLOR,
            borderWidth: 0,
            stack: 'bh',
            barPercentage: 0.8,
            categoryPercentage: 0.9
        });

        // Per-stock plan bars: weighted contribution per year.
        //   contribution[year] = perStockPlan[sym][year][365] * weightsPerStock[sym][year]
        // Sum across stocks per year = basketAvg[year][365]. Stack sums → basket total.
        stocks.forEach(sym => {
            const color = stockData?.[sym]?.color || fallbackColors[sym] || 'rgb(128,128,128)';
            const planCurves = perStockPlan[sym] || {};
            const weights    = weightsPerStock?.[sym] || {};

            const data = years.map(year => {
                const yKey = String(year);
                const curve = planCurves[yKey];
                const w     = weights[yKey] || 0;
                if (!curve || curve.length <= 365) return 0;
                return curve[365] * w * 100;
            });

            datasets.push({
                label: sym + ' (Plan)',
                data,
                backgroundColor: color,
                borderColor: 'rgba(255,255,255,0.3)',
                borderWidth: 1,
                stack: 'plan',
                barPercentage: 0.8,
                categoryPercentage: 0.9
            });
        });

        this.chart.data.labels = labels;
        this.chart.data.datasets = datasets;
        this.chart.update();
    }

    // -----------------------------------------------------------------------
    // Summary stats computation
    // -----------------------------------------------------------------------

    calculateOverlayStats = () => {
        const { basketResult, viewMode, selectedYear } = this.props;
        if (!basketResult) return null;

        if (viewMode === 'line') {
            // Basket-level overlay: end-of-year plan curve. B&H synthesized
            // from perStockHold weighted by visible weights (same as updateLineChart).
            const yearKey = (selectedYear === 'Average' || !selectedYear)
                ? 0 : parseInt(selectedYear);
            const planCurve = basketResult.basketAvg?.[yearKey];
            if (!planCurve) return null;
            const planReturn = (planCurve[365] ?? 0) * 100;

            // B&H: weighted sum of perStockHold[sym][yearKey][365]
            const weightMap = basketResult.weightsPerStock || {};
            const holdMap   = basketResult.perStockHold   || {};
            let bhReturn = 0;
            for (const sym of Object.keys(weightMap)) {
                const w = weightMap[sym]?.[yearKey] || 0;
                const h = holdMap[sym]?.[yearKey];
                if (!h) continue;
                bhReturn += w * h[365];
            }
            bhReturn *= 100;

            return {
                bhReturn:    bhReturn.toFixed(2),
                planReturn:  planReturn.toFixed(2),
                difference:  (planReturn - bhReturn).toFixed(2),
                isPositive:  planReturn >= bhReturn
            };
        }

        // Bar view: basket-level quality score across years.
        //   per-year plan return r_y = sum_s ( perStockPlan[s][y][365] * w[s][y] )
        //   per-year B&H  return b_y = sum_s ( perStockHold[s][y][365] * w[s][y] )
        //   daysFrac = weighted avg days-in-market across stocks
        //   quality = (mean(r) / (mean(b) * daysFrac)) / (1 + 3*downside(r))
        const { years, perStockPlan, perStockHold, weightsPerStock, daysInMarket } = basketResult;
        if (!years || !perStockPlan) return null;

        const stocks = Object.keys(perStockPlan);
        const planReturns = [];
        const bhReturns = [];
        for (const y of years) {
            const k = String(y);
            let rPlan = 0, rBh = 0;
            for (const sym of stocks) {
                const w = (weightsPerStock?.[sym] || {})[k] || 0;
                const planCurve = perStockPlan[sym]?.[k];
                const bhCurve   = perStockHold?.[sym]?.[k];
                if (planCurve && planCurve.length > 365) rPlan += planCurve[365] * w;
                if (bhCurve   && bhCurve.length   > 365) rBh   += bhCurve[365]   * w;
            }
            planReturns.push(rPlan);
            bhReturns.push(rBh);
        }
        if (planReturns.length === 0) return null;

        // Weighted basket days-in-market via key-0 weights
        let daysFrac = 0, wSum = 0;
        for (const sym of stocks) {
            const w = (weightsPerStock?.[sym] || {})['0'];
            const d = daysInMarket?.[sym];
            if (w === undefined || d === undefined) continue;
            daysFrac += w * d;
            wSum += w;
        }
        if (wSum > 0) daysFrac /= wSum;

        const quality = calcQuality(planReturns, bhReturns, daysFrac);
        return { quality, nYrs: planReturns.length };
    }

    // -----------------------------------------------------------------------
    // Allocation bar data
    // -----------------------------------------------------------------------

    getAllocBarData = () => {
        const { basketResult, stockData, stocks: appStocks, allocMode,
                selectedYear, viewMode } = this.props;
        if (!basketResult) return null;

        // Source the symbol list from the parent app (engine state) — the
        // graph result no longer carries a separate `stocks` array; it lives
        // in the keys of weightsPerStock / perStockPlan.
        const wMap = basketResult.weightsPerStock || {};
        const symbols = (appStocks || []).filter(s => wMap[s] !== undefined);
        if (symbols.length === 0) return null;

        // Custom: use stockData[s].allocPct, normalized to 100 across visible.
        if (allocMode === 'custom') {
            const visible = symbols.filter(s => stockData?.[s]?.visible !== false);
            const total = visible.reduce(
                (sum, s) => sum + (stockData?.[s]?.allocPct || 0), 0
            );
            return visible.map(s => ({
                stock: s,
                pct: total > 0
                    ? (stockData?.[s]?.allocPct || 0) / total * 100
                    : 100 / visible.length,
                color: stockData?.[s]?.color || '#888'
            }));
        }

        // Engine-driven: pull weights from weightsPerStock map.
        // Bar view OR 'Average' selection -> use the "0" entry (avg across years).
        // Otherwise -> selected year's weight.
        const useAverage = viewMode === 'bar' || selectedYear === 'Average';
        const yearKey = useAverage ? '0' : String(parseInt(selectedYear));

        const raw = symbols.map(s => {
            const wByYear = wMap[s] || {};
            const w = wByYear[yearKey];
            // Fallback: if a specific year is missing, fall back to avg ('0').
            return { stock: s, w: (w !== undefined ? w : (wByYear['0'] || 0)) };
        });

        // Renormalize across visible stocks (engine renormalizes too, but be
        // defensive in case weightsPerStock holds raw weights).
        const total = raw.reduce((sum, x) => sum + (x.w || 0), 0);
        if (total <= 0) return null;

        return raw
            .filter(x => (x.w || 0) > 0)
            .map(x => ({
                stock: x.stock,
                pct: (x.w / total) * 100,
                color: stockData?.[x.stock]?.color || '#888'
            }));
    }

    // -----------------------------------------------------------------------
    // Render
    // -----------------------------------------------------------------------

    render() {
        const { selectedStock, basketResult, stockDetail, stockData, stocks,
                allocMode, allocModes, viewMode, selectedYear, displayYears,
                onViewModeChange, onYearChange, onAllocModeChange, onUpdateAllocPct,
                onCopyToCustom, onExportCsv, onExportCalendar, onOptimizeAllocation, onDisplayYearsChange } = this.props;

        const hasData = !!basketResult;
        // basketResult.years is a flat int array [2024, 2023, ...] — normalize to objects.
        const rawYears = basketResult?.years || [];
        const yearsList = rawYears.map(y => typeof y === 'number' ? { year: y } : y);
        const sortedYearsList = [...yearsList].sort((a, b) => b.year - a.year);

        const overlayStats = this.calculateOverlayStats();
        // Show allocation bar in basket mode (both line and bar views)
        // Allocation bar is always basket-level — keep visible regardless of selection.
        const allocBarData = this.getAllocBarData();
        const isCustom = allocMode === 'custom';

        const showLineControls = selectedStock || viewMode === 'line';
        // Year combo is shown only in stock-detail view. In basket view we use
        // a global "show last N years" dropdown instead.
        const showYearCombo = !!selectedStock || viewMode === 'line';

        // Highest data-years across stocks — caps the global dropdown options.
        let nMaxDataYears = 0;
        if (stocks && stockData) {
            for (const s of stocks) {
                const n = stockData[s]?.nDataYears || 0;
                if (n > nMaxDataYears) nMaxDataYears = n;
            }
        }
        // Generate dropdown options: 5, 10, 15, 20, 25.
        // Always show full set; data-cap only used to decide if "Max" expands beyond 25.
        const arrYearOptions = [5, 10, 15, 20, 25];
        const nDisplayYears = Number.isFinite(displayYears) ? displayYears : 10;

        return (
            <div className="graph-area">
                <div className="graph-controls">
                    <div className="graph-controls-left">
                        {/* Allocation dropdown */}
                        {!selectedStock && (
                            <label className="alloc-label">
                                Alloc:
                                <select
                                    className="alloc-select"
                                    value={allocMode}
                                    onChange={(e) => onAllocModeChange(e.target.value)}
                                    disabled={stocks.length < 2}
                                >
                                    {allocModes.map(m => (
                                        <option key={m.value} value={m.value}>{m.label}</option>
                                    ))}
                                </select>
                            </label>
                        )}

                        {/* Copy current weights to custom — basket mode only, hidden when already custom */}
                        {!selectedStock && !isCustom && (
                            <button
                                className="toggle-btn"
                                onClick={() => onCopyToCustom && onCopyToCustom()}
                                disabled={!hasData || stocks.length < 2}
                                title="Snapshot the current weights into custom allocation and switch to custom mode"
                            >
                                Copy to custom
                            </button>
                        )}

                        {/* Sample years dropdown — basket mode only. Sets the
                            chart display window via getGraphData(N). Independent
                            of each stock's params.nYears (stats lookback). */}
                        {!selectedStock && viewMode === 'bar' && onDisplayYearsChange && stocks.length > 0 && (
                            <label className="alloc-label">
                                Backtest years:
                                <select
                                    className="alloc-select"
                                    value={String(nDisplayYears)}
                                    onChange={(e) => onDisplayYearsChange(e.target.value)}
                                    disabled={!hasData}
                                    title="How many recent years to chart (out-of-sample backtest beyond per-stock stats lookback)"
                                >
                                    {!arrYearOptions.includes(nDisplayYears) && nDisplayYears > 0 && (
                                        <option value={String(nDisplayYears)}>{nDisplayYears}y</option>
                                    )}
                                    {arrYearOptions.map(n => (
                                        <option key={n} value={String(n)}>{n}y</option>
                                    ))}
                                    <option value="max">Max</option>
                                </select>
                            </label>
                        )}

                        {/* Year selector — always visible (line chart + export CSV use it; bar chart ignores) */}
                        {showYearCombo && (
                            <select
                                value={selectedYear}
                                onChange={(e) => onYearChange(e.target.value)}
                                disabled={!hasData}
                            >
                                <option value="Average">Average</option>
                                {sortedYearsList.map(y => (
                                    <option key={y.year} value={y.year}>{y.year}</option>
                                ))}
                            </select>
                        )}

                        {selectedStock && (
                            <span className="stock-count" style={{ color: '#2196F3' }}>
                                {selectedStock}
                            </span>
                        )}
                    </div>

                    <div className="graph-controls-right">
                        {/* Export verification CSV — basket mode only */}
                        {!selectedStock && (
                            <button
                                className="toggle-btn"
                                onClick={() => onExportCsv && onExportCsv()}
                                disabled={!hasData || stocks.length === 0}
                                title="Download a Google-Sheets-ready CSV to hand-verify engine math"
                            >
                                Export backtest
                            </button>
                        )}

                        {/* Export trade calendar — basket mode only */}
                        {!selectedStock && (
                            <button
                                className="toggle-btn"
                                onClick={() => onExportCalendar && onExportCalendar()}
                                disabled={!hasData || stocks.length === 0}
                                title="Download a CSV calendar with BUY/SELL actions per stock"
                            >
                                Export calendar
                            </button>
                        )}

                        {/* View toggle — only in basket mode */}
                        {!selectedStock && (
                            <div className="view-toggle">
                                <button
                                    className={`toggle-btn ${viewMode === 'line' ? 'active' : ''}`}
                                    onClick={() => onViewModeChange('line')}
                                >
                                    Line
                                </button>
                                <button
                                    className={`toggle-btn ${viewMode === 'bar' ? 'active' : ''}`}
                                    onClick={() => onViewModeChange('bar')}
                                >
                                    Bar
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                <div className="chart-area">
                    {/* Allocation bar with +/- buttons in custom mode */}
                    {allocBarData && allocBarData.length > 0 && (
                        <div className="alloc-bar-wrap">
                            {onOptimizeAllocation && (
                                <button
                                    type="button"
                                    className="alloc-optimize-btn"
                                    onClick={() => onOptimizeAllocation()}
                                    title="Auto-optimize allocation weights"
                                    aria-label="Auto-optimize allocation"
                                >{'\u{1F4A1}'}</button>
                            )}
                            <div className="alloc-bar">
                            {allocBarData.map(d => (
                                <div
                                    key={d.stock}
                                    className={`alloc-segment${isCustom ? ' editable' : ''}`}
                                    style={{
                                        height: `${d.pct}%`,
                                        backgroundColor: d.color,
                                        minHeight: '18px'
                                    }}
                                    title={`${d.stock}: ${d.pct.toFixed(1)}%`}
                                >
                                    {isCustom && onUpdateAllocPct && (
                                        <div
                                            className="alloc-adjust alloc-plus"
                                            tabIndex="0"
                                            role="button"
                                            aria-label={`Increase ${d.stock} by 5%`}
                                            onClick={() => onUpdateAllocPct(d.stock, 5)}
                                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onUpdateAllocPct(d.stock, 5); } }}
                                            title={`Increase ${d.stock} by 5%`}
                                        >+</div>
                                    )}
                                    <span className="alloc-bar-label">{d.pct.toFixed(0)}%</span>
                                    {isCustom && onUpdateAllocPct && (
                                        <div
                                            className="alloc-adjust alloc-minus"
                                            tabIndex="0"
                                            role="button"
                                            aria-label={`Decrease ${d.stock} by 5%`}
                                            onClick={() => onUpdateAllocPct(d.stock, -5)}
                                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onUpdateAllocPct(d.stock, -5); } }}
                                            title={`Decrease ${d.stock} by 5%`}
                                        >{'\u2212'}</div>
                                    )}
                                </div>
                            ))}
                            </div>
                        </div>
                    )}

                    <div className="chart-wrapper">
                        {!hasData && (
                            <div className="empty-state">
                                {selectedStock
                                    ? 'Loading stock data...'
                                    : 'Add stocks to see the graph'}
                            </div>
                        )}
                        <canvas ref={this.chartRef} />

                        {/* Overlay stats */}
                        {overlayStats && hasData && overlayStats.quality != null && (
                            <div className="chart-overlay-stats">
                                <span className="summary-label">Quality:</span>
                                <span className={`summary-value ${overlayStats.quality > 0 ? 'positive' : 'negative'}`}>
                                    {formatQuality(overlayStats.quality)}
                                </span>
                                <span className="summary-label">over</span>
                                <span className="summary-value">{overlayStats.nYrs}y</span>
                            </div>
                        )}
                        {overlayStats && hasData && overlayStats.quality == null && (
                            <div className="chart-overlay-stats">
                                <span className="summary-label">B&H:</span>
                                <span className="summary-value">{overlayStats.bhReturn}%</span>
                                <span className="summary-label">Plan:</span>
                                <span className="summary-value">{overlayStats.planReturn}%</span>
                                <span className="summary-label">Diff:</span>
                                <span className={`summary-value ${overlayStats.isPositive ? 'positive' : 'negative'}`}>
                                    {overlayStats.isPositive ? '+' : ''}{overlayStats.difference}%
                                </span>
                                {overlayStats.daysInMarket != null && (
                                    <>
                                        <span className="summary-label">Time:</span>
                                        <span className="summary-value">
                                            {overlayStats.daysInMarket}/365
                                        </span>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }
}

export default BasketGraph;
