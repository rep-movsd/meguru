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

        // Y-axis range — persisted in localStorage
        let yMin = -50, yMax = 200;
        try {
            const saved = JSON.parse(localStorage.getItem('meguru.graphRange') || 'null');
            if (saved && Number.isFinite(saved.yMin) && Number.isFinite(saved.yMax)) {
                yMin = saved.yMin; yMax = saved.yMax;
            }
        } catch (e) { /* ignore */ }
        this.state = { yMin, yMax };
    }

    setRange = (key, value) => {
        const v = parseInt(value, 10);
        if (!Number.isFinite(v)) return;
        this.setState({ [key]: v }, () => {
            try {
                localStorage.setItem('meguru.graphRange', JSON.stringify({
                    yMin: this.state.yMin, yMax: this.state.yMax
                }));
            } catch (e) { /* ignore */ }
            // Destroy existing chart, then recreate with new scales.
            this._detachBarListeners();
            if (this.chart) {
                this.chart.destroy();
                this.chart = null;
            }
            this.createChart();
        });
    }

    componentDidMount() {
        this._createTooltipEl();
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
            this._detachBarListeners();
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
        this._detachBarListeners();
        this._removeTooltipEl();
        if (this.chart) {
            this.chart.destroy();
        }
    }

    // -----------------------------------------------------------------------
    // DOM tooltip for bar chart
    // -----------------------------------------------------------------------

    _createTooltipEl = () => {
        if (this.tooltipEl) return;
        const el = document.createElement('div');
        el.style.position       = 'absolute';
        el.style.display        = 'none';
        el.style.pointerEvents  = 'none';
        el.style.background     = 'rgba(0,0,0,0.9)';
        el.style.border         = '1px solid #444';
        el.style.color          = '#fff';
        el.style.font           = '11px "Courier New", Courier, monospace';
        el.style.padding        = '4px 8px';
        el.style.whiteSpace     = 'nowrap';
        el.style.zIndex         = '10';
        el.style.borderRadius   = '3px';
        this.tooltipEl = el;
        // Append once the canvas is in the DOM. chartRef may not yet be set
        // on first call from componentDidMount; defer attach to the listener
        // attachment phase (createBarChart) which guarantees canvas presence.
    }

    _ensureTooltipAttached = () => {
        if (!this.tooltipEl) this._createTooltipEl();
        const canvas = this.chartRef.current;
        if (!canvas) return;
        const parent = canvas.parentElement;
        if (!parent) return;
        if (this.tooltipEl.parentElement !== parent) {
            parent.appendChild(this.tooltipEl);
        }
    }

    _removeTooltipEl = () => {
        if (this.tooltipEl && this.tooltipEl.parentElement) {
            this.tooltipEl.parentElement.removeChild(this.tooltipEl);
        }
        this.tooltipEl = null;
    }

    _formatTooltip = (rect) => {
        const yr = rect.year;
        if (rect.type === 'bh') {
            const sign = rect.value >= 0 ? '+' : '';
            return `B&H (avg) — ${yr}: ${sign}${rect.value.toFixed(1)}%`;
        }
        // profit / profit-eaten / loss
        const sign = rect.value >= 0 ? '+' : '';
        return `${rect.sym} — ${yr}: ${sign}${rect.value.toFixed(1)}%`;
    }

    _attachBarListeners = () => {
        const canvas = this.chartRef.current;
        if (!canvas) return;
        this._ensureTooltipAttached();
        this._hoveredBarIdx = -1;

        this._barMouseMove = (e) => {
            const rectCanvas = canvas.getBoundingClientRect();
            const px = e.clientX - rectCanvas.left;
            const py = e.clientY - rectCanvas.top;
            const rects = this.barRects || [];
            let hitIdx = -1;
            for (let i = 0; i < rects.length; i++) {
                const r = rects[i];
                if (px >= r.x && px <= r.x + r.w &&
                    py >= r.y && py <= r.y + r.h) {
                    hitIdx = i;
                    break;
                }
            }
            if (hitIdx === this._hoveredBarIdx) return;
            this._hoveredBarIdx = hitIdx;

            if (hitIdx < 0) {
                if (this.tooltipEl) this.tooltipEl.style.display = 'none';
                return;
            }

            const r = rects[hitIdx];
            const tip = this.tooltipEl;
            if (!tip) return;
            tip.textContent = this._formatTooltip(r);
            tip.style.display = 'block';

            // Position relative to the tooltip's parent (chart-wrapper).
            const parent = tip.parentElement;
            if (!parent) return;
            const wrapRect = parent.getBoundingClientRect();
            const tipW = tip.offsetWidth;
            const tipH = tip.offsetHeight;
            const cx = r.x + r.w / 2 + (rectCanvas.left - wrapRect.left);
            let ty   = r.y + (rectCanvas.top - wrapRect.top) - tipH - 6;
            if (ty < 0) ty = r.y + r.h + (rectCanvas.top - wrapRect.top) + 6;
            let tx = cx - tipW / 2;
            const maxX = wrapRect.width - tipW - 2;
            if (tx < 2) tx = 2;
            if (tx > maxX) tx = maxX;
            tip.style.left = tx + 'px';
            tip.style.top  = ty + 'px';
        };

        this._barMouseLeave = () => {
            this._hoveredBarIdx = -1;
            if (this.tooltipEl) this.tooltipEl.style.display = 'none';
        };

        canvas.addEventListener('mousemove', this._barMouseMove);
        canvas.addEventListener('mouseleave', this._barMouseLeave);
    }

    _detachBarListeners = () => {
        const canvas = this.chartRef.current;
        if (canvas && this._barMouseMove) {
            canvas.removeEventListener('mousemove', this._barMouseMove);
            canvas.removeEventListener('mouseleave', this._barMouseLeave);
        }
        this._barMouseMove  = null;
        this._barMouseLeave = null;
        this._hoveredBarIdx = -1;
        if (this.tooltipEl) this.tooltipEl.style.display = 'none';
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
                ctx.fillStyle = pct >= 0 ? '#3a8f3e' : '#f44336';
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
                ctx.fillStyle = isUp ? 'rgba(58, 143, 62, 0.15)' : 'rgba(244, 67, 54, 0.15)';
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

                ctx.fillStyle = isLoss ? '#f44336' : '#3a8f3e';
                ctx.fillText(priceLabel, xCenter, yTop);

                ctx.fillStyle = windowMultiplier >= 1.0 ? '#3a8f3e' : '#f44336';
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

        // Custom bar painter. Reads per-year per-stock data cached on `this`
        // by updateBarChart and paints two slots per year column:
        //   - left slot:  B&H bar (full slot width)
        //   - right slot: combined plan column. Above zero = full slot width.
        //                 Below zero = profit-eaten (left half) + losses (right half).
        // Also populates `this.barRects` for hit-testing by the DOM tooltip.
        const customBarPlugin = {
            id: 'customBar',
            afterDraw: (chart) => {
                this.barRects = [];

                const years   = this.years;
                const stocks  = this.stocksOrdered;
                const contrib = this.contribPerStock;
                const colors  = this.colorsPerStock;
                const bhArr   = this.bhPerYear;
                const lossArr = this.totalLossPerYear;
                const netArr  = this.netPerYear;
                if (!years || !years.length || !stocks || !contrib) return;

                const ctx = chart.ctx;
                const xScale = chart.scales.x;
                const yScale = chart.scales.y;
                const chartArea = chart.chartArea;
                if (!xScale || !yScale || !chartArea) return;

                const y0 = yScale.getPixelForValue(0);
                const yClamp = (v) => {
                    const px = yScale.getPixelForValue(v);
                    return Math.max(chartArea.top, Math.min(chartArea.bottom, px));
                };

                let categoryWidth;
                if (years.length >= 2) {
                    categoryWidth = xScale.getPixelForValue(1) - xScale.getPixelForValue(0);
                } else {
                    categoryWidth = chartArea.right - chartArea.left;
                }
                const groupWidth = categoryWidth * 0.9;
                const slotWidth  = groupWidth / 2;
                // Gap between B&H bar and combined plan column. Bars are
                // shrunk on their inner edge to leave `gap` px between them.
                const gap        = Math.max(4, slotWidth * 0.15);
                const barWidth   = Math.max(2, slotWidth - gap);

                ctx.save();

                for (let yi = 0; yi < years.length; yi++) {
                    const colCenter      = xScale.getPixelForValue(yi);
                    const bhCenter       = colCenter - slotWidth / 2;
                    const combinedCenter = colCenter + slotWidth / 2;

                    const bh        = bhArr[yi]   || 0;
                    const totalLoss = lossArr[yi] || 0;
                    const net       = netArr[yi]  || 0;
                    const year      = years[yi];

                    // ---------- B&H bar ----------
                    if (Math.abs(bh) > 0.01) {
                        const yBh  = yClamp(bh);
                        const yT   = Math.min(y0, yBh);
                        const yB   = Math.max(y0, yBh);
                        const x    = bhCenter - barWidth / 2;
                        const w    = barWidth;
                        const fill = 'rgba(140,140,140,0.7)';
                        ctx.fillStyle = fill;
                        ctx.fillRect(x, yT, w, yB - yT);
                        this.barRects.push({
                            type: 'bh', year, value: bh,
                            x, y: yT, w, h: yB - yT, color: fill
                        });
                    }

                    // ---------- Combined column: profit pass ----------
                    // Cursor starts at totalLoss (negative) and grows upward.
                    let cursor = totalLoss;
                    for (let si = 0; si < stocks.length; si++) {
                        const c = contrib[si][yi];
                        if (!(c > 0)) continue;
                        const sym   = stocks[si];
                        const color = colors[sym] || 'rgb(128,128,128)';
                        const base  = cursor;
                        const top   = cursor + c;

                        // Above-zero portion: full bar width.
                        if (top > 0) {
                            const aboveBase = Math.max(0, base);
                            const yT = yClamp(top);
                            const yB = yClamp(aboveBase);
                            if (yB - yT > 0.5) {
                                const x = combinedCenter - barWidth / 2;
                                const w = barWidth;
                                ctx.fillStyle = color;
                                ctx.fillRect(x, yT, w, yB - yT);
                                this.barRects.push({
                                    type: 'profit', sym, year, value: c,
                                    x, y: yT, w, h: yB - yT, color
                                });
                            }
                        }
                        // Below-zero portion: left half (eaten by losses).
                        if (base < 0) {
                            const belowTop = Math.min(0, top);
                            const yT = yClamp(belowTop);
                            const yB = yClamp(base);
                            if (yB - yT > 0.5) {
                                const x = combinedCenter - barWidth / 2;
                                const w = barWidth / 2;
                                ctx.fillStyle = color;
                                ctx.fillRect(x, yT, w, yB - yT);
                                this.barRects.push({
                                    type: 'profit-eaten', sym, year, value: c,
                                    x, y: yT, w, h: yB - yT, color
                                });
                            }
                        }
                        cursor += c;
                    }

                    // ---------- Combined column: loss pass (right half) ----------
                    let lossCursor = 0;
                    for (let si = 0; si < stocks.length; si++) {
                        const c = contrib[si][yi];
                        if (!(c < 0)) continue;
                        const sym   = stocks[si];
                        const color = colors[sym] || 'rgb(128,128,128)';
                        const base  = lossCursor;
                        const top   = lossCursor + c;       // more negative
                        const yT    = yClamp(base);
                        const yB    = yClamp(top);
                        if (yB - yT > 0.5) {
                            const x = combinedCenter;
                            const w = barWidth / 2;
                            ctx.fillStyle = color;
                            ctx.fillRect(x, yT, w, yB - yT);
                            this.barRects.push({
                                type: 'loss', sym, year, value: c,
                                x, y: yT, w, h: yB - yT, color
                            });
                        }
                        lossCursor += c;
                    }

                    // ---------- Labels ----------
                    ctx.font      = 'bold 11px "Courier New", Courier, monospace';
                    ctx.textAlign = 'center';
                    ctx.fillStyle = '#fff';
                    ctx.shadowColor = 'rgba(0,0,0,0.8)';
                    ctx.shadowBlur  = 3;

                    // B&H label
                    if (Math.abs(bh) >= 0.5) {
                        const txt    = (bh >= 0 ? '+' : '') + bh.toFixed(1) + '%';
                        const yBhPx  = yScale.getPixelForValue(bh);
                        if (bh >= 0) {
                            ctx.textBaseline = 'bottom';
                            const ly = yBhPx - 3;
                            if (ly > chartArea.top + 10) ctx.fillText(txt, bhCenter, ly);
                        } else {
                            ctx.textBaseline = 'top';
                            const ly = yBhPx + 3;
                            if (ly < chartArea.bottom - 10) ctx.fillText(txt, bhCenter, ly);
                        }
                    }

                    // Combined-column net label.
                    // Positive net: top edge of column = y(net); place above.
                    // Negative net: bottom edge of column = y(totalLoss); place
                    //   below that edge (net text still shown).
                    if (Math.abs(net) >= 0.5) {
                        const txt = (net >= 0 ? '+' : '') + net.toFixed(1) + '%';
                        if (net >= 0) {
                            ctx.textBaseline = 'bottom';
                            const ly = yScale.getPixelForValue(net) - 3;
                            if (ly > chartArea.top + 10) ctx.fillText(txt, combinedCenter, ly);
                        } else {
                            ctx.textBaseline = 'top';
                            const ly = yScale.getPixelForValue(totalLoss) + 3;
                            if (ly < chartArea.bottom - 10) ctx.fillText(txt, combinedCenter, ly);
                        }
                    }

                    ctx.shadowBlur = 0;
                }

                ctx.restore();
            }
        };

        // Legend drawn in the top-right corner inside the chart area:
        // gray "B&H" swatch followed by a multi-color "Plan" swatch
        // (segmented with basket colors). Anchored top-right with a
        // small inset so the chart itself can use the full top padding.
        const legendPlugin = {
            id: 'barLegend',
            afterDraw: (chart) => {
                const stocks = this.stocksOrdered || [];
                const colors = this.colorsPerStock || {};
                const ctx = chart.ctx;
                const chartArea = chart.chartArea;
                if (!chartArea) return;

                const swatchW = 24;
                const swatchH = 12;
                const gap     = 6;     // swatch ↔ label
                const itemGap = 18;    // between B&H and Plan items
                const inset   = 8;     // distance from chart edges

                ctx.save();
                ctx.font = '11px "Courier New", Courier, monospace';
                ctx.textBaseline = 'middle';
                ctx.textAlign = 'left';

                const bhLabel   = 'B&H';
                const planLabel = 'Plan';
                const bhTextW   = ctx.measureText(bhLabel).width;
                const planTextW = ctx.measureText(planLabel).width;
                const totalW = swatchW + gap + bhTextW + itemGap +
                               swatchW + gap + planTextW;
                // Anchor top-right inside chart area
                let x = chartArea.right - inset - totalW;
                const cy = chartArea.top + inset + swatchH / 2;
                const swatchY = cy - swatchH / 2;

                // Faint background plate for readability over chart content
                ctx.fillStyle = 'rgba(30,30,30,0.7)';
                ctx.fillRect(x - 6, swatchY - 4, totalW + 12, swatchH + 8);

                // B&H swatch
                ctx.fillStyle = 'rgba(140,140,140,0.7)';
                ctx.fillRect(x, swatchY, swatchW, swatchH);
                x += swatchW + gap;
                ctx.fillStyle = '#ddd';
                ctx.fillText(bhLabel, x, cy);
                x += bhTextW + itemGap;

                // Plan swatch — segmented across basket colors. Falls back
                // to a single neutral color when no stocks are loaded.
                if (stocks.length > 0) {
                    const segW = swatchW / stocks.length;
                    for (let i = 0; i < stocks.length; i++) {
                        ctx.fillStyle = colors[stocks[i]] || 'rgb(128,128,128)';
                        ctx.fillRect(x + i * segW, swatchY, segW + 0.5, swatchH);
                    }
                } else {
                    ctx.fillStyle = 'rgb(128,128,128)';
                    ctx.fillRect(x, swatchY, swatchW, swatchH);
                }
                x += swatchW + gap;
                ctx.fillStyle = '#ddd';
                ctx.fillText(planLabel, x, cy);

                ctx.restore();
            }
        };

        this.chart = new Chart(ctx, {
            type: 'bar',
            data: { labels: [], datasets: [] },
            plugins: [altBgPlugin, customBarPlugin, legendPlugin],
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                layout: { padding: { top: 8, bottom: 10 } },
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false }
                },
                scales: {
                    x: {
                        type: 'category',
                        grid: { color: '#333' },
                        ticks: { color: '#888' }
                    },
                    y: {
                        position: 'left',
                        min: this.state.yMin, max: this.state.yMax,
                        afterFit: (axis) => { axis.width = 50; },
                        grid: { color: '#333' },
                        ticks: {
                            callback: (v) => v + '%',
                            color: '#888'
                        }
                    },
                    yRight: {
                        position: 'right',
                        min: this.state.yMin, max: this.state.yMax,
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

        this._attachBarListeners();
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
            min: this.state.yMin, max: this.state.yMax,
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
            min: this.state.yMin, max: this.state.yMax,
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
            borderColor: 'rgb(58, 143, 62)',
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

        const reset = () => {
            this.years              = [];
            this.stocksOrdered      = [];
            this.contribPerStock    = [];
            this.colorsPerStock     = {};
            this.totalLossPerYear   = [];
            this.totalProfitPerYear = [];
            this.netPerYear         = [];
            this.bhPerYear          = [];
            this.barRects           = [];
            this.chart.data.labels   = [];
            this.chart.data.datasets = [];
        };

        if (!basketResult || !basketResult.perStockPlan) {
            reset();
            this.chart.update();
            return;
        }

        const { years, perStockHold, perStockPlan, weightsPerStock } = basketResult;
        if (!years || years.length === 0) {
            reset();
            this.chart.update();
            return;
        }

        const stocks = Object.keys(perStockPlan);
        const fallbackColors = getBasketColors(stocks);
        const colorsPerStock = {};
        for (const sym of stocks) {
            colorsPerStock[sym] = stockData?.[sym]?.color || fallbackColors[sym] || 'rgb(128,128,128)';
        }

        // Per-year active mask & weight-renorm scale: stocks that didn't yet
        // exist for a given calendar year get backfilled with flat data by
        // the engine — exclude them so their slot doesn't dilute the basket.
        const maxYear = Math.max(...years);
        const activeMask = stocks.map(sym => {
            const nData = stockData?.[sym]?.nDataYears || 0;
            return years.map(year => nData === 0 || year >= maxYear - nData + 1);
        });
        const activeScale = years.map((year, yi) => {
            let wActive = 0;
            for (let si = 0; si < stocks.length; si++) {
                if (!activeMask[si][yi]) continue;
                const yKey = String(year);
                wActive += (weightsPerStock?.[stocks[si]] || {})[yKey] || 0;
            }
            return wActive > 0 ? 1 / wActive : 0;
        });

        // contrib[symIdx][yearIdx] = weighted final return in % (signed).
        const contrib = stocks.map((sym, si) => {
            const planCurves = perStockPlan[sym] || {};
            const weights    = weightsPerStock?.[sym] || {};
            return years.map((year, yi) => {
                if (!activeMask[si][yi]) return 0;
                const yKey = String(year);
                const curve = planCurves[yKey];
                const w     = weights[yKey] || 0;
                if (!curve || curve.length <= 365) return 0;
                return curve[365] * w * activeScale[yi] * 100;
            });
        });

        const totalLossPerYear = years.map((_, yi) => {
            let s = 0;
            for (let si = 0; si < stocks.length; si++) {
                if (contrib[si][yi] < 0) s += contrib[si][yi];
            }
            return s;
        });
        const totalProfitPerYear = years.map((_, yi) => {
            let s = 0;
            for (let si = 0; si < stocks.length; si++) {
                if (contrib[si][yi] > 0) s += contrib[si][yi];
            }
            return s;
        });
        const netPerYear = years.map((_, yi) =>
            totalProfitPerYear[yi] + totalLossPerYear[yi]);

        // B&H per-year: equal-weighted average of held returns across
        // stocks active that year (skip backfilled flat data).
        const bhPerYear = years.map((year, yi) => {
            const yKey = String(year);
            let sum = 0, n = 0;
            for (let si = 0; si < stocks.length; si++) {
                if (!activeMask[si][yi]) continue;
                const curve = perStockHold[stocks[si]]?.[yKey];
                if (curve && curve.length > 365) {
                    sum += curve[365];
                    n++;
                }
            }
            return n > 0 ? (sum / n) * 100 : 0;
        });

        // Drop years in which no stock existed (all backfilled). Keeps
        // the chart from showing empty/zero columns for pre-basket history.
        const keepIdx = years
            .map((_, yi) => activeMask.some(mask => mask[yi]) ? yi : -1)
            .filter(i => i >= 0);
        const fYears              = keepIdx.map(i => years[i]);
        const fContrib            = contrib.map(arr => keepIdx.map(i => arr[i]));
        const fTotalLossPerYear   = keepIdx.map(i => totalLossPerYear[i]);
        const fTotalProfitPerYear = keepIdx.map(i => totalProfitPerYear[i]);
        const fNetPerYear         = keepIdx.map(i => netPerYear[i]);
        const fBhPerYear          = keepIdx.map(i => bhPerYear[i]);

        // Cache for plugin.
        this.years              = fYears;
        this.stocksOrdered      = stocks;
        this.contribPerStock    = fContrib;
        this.colorsPerStock     = colorsPerStock;
        this.totalLossPerYear   = fTotalLossPerYear;
        this.totalProfitPerYear = fTotalProfitPerYear;
        this.netPerYear         = fNetPerYear;
        this.bhPerYear          = fBhPerYear;
        this.barRects           = [];

        // Provide labels for axis ticks. Datasets stay empty — custom plugin
        // paints all bars. A transparent dummy dataset forces Chart.js to
        // build the category scale ticks reliably.
        this.chart.data.labels = fYears.map(y => y.toString());
        this.chart.data.datasets = [{
            type: 'bar',
            data: fYears.map(() => 0),
            backgroundColor: 'transparent',
            borderWidth: 0,
            barPercentage: 0.0001,
            categoryPercentage: 0.0001
        }];
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

        const { stockData } = this.props;
        const stocks = Object.keys(perStockPlan);
        // Most-recent year defines the "active" cutoff for each stock —
        // any year older than (maxYear - nDataYears + 1) is engine-backfilled
        // flat data and should not contribute to the basket return.
        const maxYear = Math.max(...years);

        const planReturns = [];
        const bhReturns = [];
        for (const y of years) {
            const k = String(y);
            let rPlan = 0, rBh = 0, wTotal = 0;
            for (const sym of stocks) {
                const nData = stockData?.[sym]?.nDataYears || 0;
                // Skip stocks not yet existing this year (backfilled flat line)
                if (nData > 0 && y < maxYear - nData + 1) continue;
                const w = (weightsPerStock?.[sym] || {})[k] || 0;
                const planCurve = perStockPlan[sym]?.[k];
                const bhCurve   = perStockHold?.[sym]?.[k];
                if (planCurve && planCurve.length > 365) rPlan += planCurve[365] * w;
                if (bhCurve   && bhCurve.length   > 365) rBh   += bhCurve[365]   * w;
                wTotal += w;
            }
            // Renormalize across stocks active this year so a year with
            // fewer active stocks isn't artificially diluted.
            if (wTotal > 0) { rPlan /= wTotal; rBh /= wTotal; }
            else continue;  // no active stocks this year — skip entirely
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
        const planMean = planReturns.reduce((a, b) => a + b, 0) / planReturns.length;
        return { quality, nYrs: planReturns.length, planReturn: (planMean * 100).toFixed(2) };
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
                onCopyToCustom, onExportCsv, onExportCalendar, onOptimizeAllocation, onDisplayYearsChange,
                onOpenHelp } = this.props;

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

        // Year combo shown in line mode only — bar chart doesn't use it.
        const showYearCombo = viewMode === 'line';

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
                        <label className="alloc-label" title="How each stock is weighted in the basket">
                            Alloc:
                            <select
                                className="alloc-select"
                                value={allocMode}
                                onChange={(e) => onAllocModeChange(e.target.value)}
                                disabled={stocks.length < 2}
                                title="How each stock is weighted in the basket"
                            >
                                {allocModes.map(m => (
                                    <option key={m.value} value={m.value}>{m.label}</option>
                                ))}
                            </select>
                        </label>

                        {/* Copy current weights to custom — hidden when already custom */}
                        {!isCustom && (
                            <button
                                className="toggle-btn"
                                onClick={() => onCopyToCustom && onCopyToCustom()}
                                disabled={!hasData || stocks.length < 2}
                                title="Snapshot the current weights into custom allocation and switch to custom mode"
                            >
                                Copy to custom
                            </button>
                        )}

                        {/* Sample years dropdown — bar mode only. Sets the
                            chart display window via getGraphData(N). Independent
                            of each stock's params.nYears (stats lookback). */}
                        <label
                            className="alloc-label"
                            style={{ visibility: viewMode === 'bar' && onDisplayYearsChange && stocks.length > 0 ? 'visible' : 'hidden' }}
                        >
                            Backtest:
                            <select
                                className="alloc-select"
                                value={String(nDisplayYears)}
                                onChange={(e) => onDisplayYearsChange && onDisplayYearsChange(e.target.value)}
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

                        {/* Year selector — line mode only */}
                        <select
                            style={{ visibility: showYearCombo ? 'visible' : 'hidden' }}
                            value={selectedYear}
                            onChange={(e) => onYearChange(e.target.value)}
                            disabled={!hasData}
                            title="Select a year to display, or average across all years"
                        >
                            <option value="Average">Average</option>
                            {sortedYearsList.map(y => (
                                <option key={y.year} value={y.year}>{y.year}</option>
                            ))}
                        </select>

                        {selectedStock && (
                            <span className="stock-count" style={{ color: '#2196F3' }}>
                                {selectedStock}
                            </span>
                        )}
                    </div>

                    <div className="graph-controls-right">
                        {/* Y-axis range selectors */}
                        <label className="alloc-label" title="Minimum value on the Y-axis">
                            Y min:
                            <select
                                className="alloc-select y-range-select"
                                value={String(this.state.yMin)}
                                onChange={(e) => this.setRange('yMin', e.target.value)}
                            >
                                {[-500, -300, -200, -150, -100, -50, 0].map(v => (
                                    <option key={v} value={String(v)}>{v}%</option>
                                ))}
                            </select>
                        </label>
                        <label className="alloc-label" title="Maximum value on the Y-axis">
                            Y max:
                            <select
                                className="alloc-select y-range-select"
                                value={String(this.state.yMax)}
                                onChange={(e) => this.setRange('yMax', e.target.value)}
                            >
                                {[100, 200, 300, 500, 750, 1000, 2000].map(v => (
                                    <option key={v} value={String(v)}>{v}%</option>
                                ))}
                            </select>
                        </label>

                        <button
                                className="toggle-btn"
                                onClick={() => onExportCsv && onExportCsv()}
                                disabled={!hasData || stocks.length === 0}
                                title="Download a Google-Sheets-ready CSV to hand-verify engine math"
                            >
                                Export backtest
                            </button>

                        <button
                                className="toggle-btn"
                                onClick={() => onExportCalendar && onExportCalendar()}
                                disabled={!hasData || stocks.length === 0}
                                title="Download a CSV calendar with BUY/SELL actions per stock"
                            >
                                Export calendar
                            </button>

                        <div className="view-toggle">
                            <button
                                className={`toggle-btn ${viewMode === 'line' ? 'active' : ''}`}
                                onClick={() => onViewModeChange('line')}
                                title="Show daily plan vs buy-and-hold line chart"
                            >
                                Line
                            </button>
                            <button
                                className={`toggle-btn ${viewMode === 'bar' ? 'active' : ''}`}
                                onClick={() => onViewModeChange('bar')}
                                title="Show stacked yearly returns by stock"
                            >
                                Bar
                            </button>
                        </div>

                        {/* Help button */}
                        <button
                            className="toggle-btn help-btn"
                            onClick={() => onOpenHelp && onOpenHelp()}
                            title="Open help & documentation"
                            aria-label="Help"
                        >
                            ?
                        </button>
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
                                    title="Auto-optimize basket allocation weights to maximize plan return"
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
                                <span className="summary-label">Plan:</span>
                                <span className={`summary-value ${parseFloat(overlayStats.planReturn) >= 0 ? 'positive' : 'negative'}`}>
                                    {parseFloat(overlayStats.planReturn) >= 0 ? '+' : ''}{overlayStats.planReturn}%
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
