// Mock engine that mimics the WASM IEngine interface for UI development.
// Returns synthetic data so the UI can be built and tested without the real C++ engine.

const DAYS = 366;

function generateSineWave(amplitude, frequency, offset, noise) {
    const data = new Array(DAYS);
    for (let i = 0; i < DAYS; i++) {
        data[i] = offset + amplitude * Math.sin(2 * Math.PI * frequency * i / DAYS)
            + (Math.random() - 0.5) * noise;
    }
    return data;
}

function generateRandomReturns(avgReturn, volatility) {
    const returns = new Array(DAYS).fill(0);
    let cumulative = 0;
    for (let i = 0; i < DAYS; i++) {
        cumulative += (avgReturn / DAYS) + (Math.random() - 0.5) * volatility;
        returns[i] = cumulative;
    }
    return returns;
}

// Seeded random from stock name for deterministic mock data
function hashSeed(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
    }
    return (hash >>> 0) / 0xFFFFFFFF;
}

class MockEngine {
    constructor() {
        this._stocks = {};      // { symbol: { params, visible, mcap, customWeight } }
        this._allocMode = 'equal';
        this._insertOrder = [];
    }

    addStock(symbol, params) {
        if (!this._stocks[symbol]) {
            this._insertOrder.push(symbol);
        }
        this._stocks[symbol] = {
            params: { ...params },
            visible: true,
            mcap: 0,
            customWeight: 0
        };
    }

    removeStock(symbol) {
        delete this._stocks[symbol];
        this._insertOrder = this._insertOrder.filter(s => s !== symbol);
    }

    updateStockParams(symbol, params) {
        if (this._stocks[symbol]) {
            this._stocks[symbol].params = { ...params };
        }
    }

    setStockVisible(symbol, visible) {
        if (this._stocks[symbol]) {
            this._stocks[symbol].visible = visible;
        }
    }

    setAllocMode(mode) {
        this._allocMode = mode;
    }

    setMarketCap(symbol, mcap) {
        if (this._stocks[symbol]) {
            this._stocks[symbol].mcap = mcap;
        }
    }

    setCustomWeight(symbol, weight) {
        if (this._stocks[symbol]) {
            this._stocks[symbol].customWeight = weight;
        }
    }

    getBasketResult() {
        const visibleStocks = this._insertOrder.filter(s => this._stocks[s]?.visible);
        if (visibleStocks.length === 0) return '';

        const currentYear = new Date().getFullYear() - 1;
        const numYears = 5;
        const years = [];
        const perStock = [];

        for (const stock of visibleStocks) {
            const seed = hashSeed(stock);
            const avgRet = 5 + seed * 20;
            const stockYears = [];

            for (let y = 0; y < numYears; y++) {
                const year = currentYear - y;
                const plan = avgRet + (Math.random() - 0.3) * 15;
                const bh = avgRet * 0.7 + (Math.random() - 0.3) * 12;
                stockYears.push({ year, plan: +plan.toFixed(2), bh: +bh.toFixed(2) });
            }

            const params = this._stocks[stock].params;
            const daysInMarket = (params.nWinMax + params.nWinMin) / 2 * 3;

            perStock.push({
                stock,
                daysInMarket: Math.round(daysInMarket),
                years: stockYears
            });
        }

        for (let y = 0; y < numYears; y++) {
            const year = currentYear - y;
            const returns = generateRandomReturns(12, 0.15);
            const buyHold = generateRandomReturns(10, 0.2);
            years.push({ year, returns, buyHold });
        }

        const average = {
            returns: generateRandomReturns(12, 0.1),
            buyHold: generateRandomReturns(10, 0.12)
        };

        // Compute weights
        const n = visibleStocks.length;
        const weights = years.map(() => {
            const w = new Array(n).fill(1 / n);
            return w;
        });

        const planReturns = years.map(y => y.returns[DAYS - 1]);
        const bhReturns = years.map(y => y.buyHold[DAYS - 1]);
        const avgPlan = planReturns.reduce((a, b) => a + b, 0) / planReturns.length;
        const avgBh = bhReturns.reduce((a, b) => a + b, 0) / bhReturns.length;
        const beatsBh = planReturns.filter((p, i) => p > bhReturns[i]).length;

        const result = {
            stocks: visibleStocks,
            years,
            average,
            perStock,
            stats: {
                avgPlan: +avgPlan.toFixed(2),
                avgBh: +avgBh.toFixed(2),
                beatsBh,
                totalYears: numYears,
                sharpe: +(avgPlan / 8).toFixed(2)
            },
            weights,
            alloc: this._allocMode
        };

        return JSON.stringify(result);
    }

    getStockDetail(symbol) {
        if (!this._stocks[symbol]) return '';

        const currentYear = new Date().getFullYear() - 1;
        const params = this._stocks[symbol].params;
        const nYears = params.nYears || 5;
        const seed = hashSeed(symbol);

        // Generate mock trade stats
        const stats = [];
        const numWindows = 2 + Math.floor(seed * 3);
        let dayOffset = 20 + Math.floor(seed * 30);

        for (let w = 0; w < numWindows; w++) {
            const winSize = params.nWinMin + Math.floor(Math.random() * (params.nWinMax - params.nWinMin));
            const iBeg = dayOffset;
            const iEnd = dayOffset + winSize;
            dayOffset = iEnd + 15 + Math.floor(Math.random() * 30);

            if (iEnd >= DAYS - 10) break;

            const yearlyReturns = [];
            for (let y = 0; y < nYears; y++) {
                yearlyReturns.push(+((seed * 10 - 2) + (Math.random() - 0.3) * 8).toFixed(2));
            }

            const pctWin = yearlyReturns.filter(r => r > 1).length / yearlyReturns.length * 100;
            const mean = yearlyReturns.reduce((a, b) => a + b, 0) / yearlyReturns.length;
            const sorted = [...yearlyReturns].sort((a, b) => a - b);
            const median = sorted[Math.floor(sorted.length / 2)];

            stats.push({
                iBeg, iEnd,
                pctWin: +pctWin.toFixed(1),
                fSkew: mean !== 0 ? +(median / mean).toFixed(2) : 0,
                fSharpe: +((mean - 7) / (5 + Math.random() * 3)).toFixed(2),
                pctExpected: +mean.toFixed(2),
                yearlyReturns
            });
        }

        // Generate per-year data
        const years = [];
        for (let y = 0; y < nYears; y++) {
            const year = currentYear - y;
            const basePrice = 500 + seed * 2000;
            const prices = new Array(DAYS);
            for (let d = 0; d < DAYS; d++) {
                prices[d] = basePrice + basePrice * 0.3 * Math.sin(2 * Math.PI * d / DAYS) + (Math.random() - 0.5) * basePrice * 0.05;
            }

            const windows = stats.map(s => ({
                iBeg: s.iBeg,
                iEnd: s.iEnd,
                priceBeg: +prices[s.iBeg].toFixed(2),
                priceEnd: +(prices[s.iEnd] * (1 - 0.004)).toFixed(2)
            }));

            const returns = generateRandomReturns(8 + seed * 10, 0.12);

            const windowMultipliers = [];
            let cumMult = 1;
            for (const w of windows) {
                const wm = w.priceEnd / w.priceBeg;
                cumMult *= wm;
                windowMultipliers.push({
                    iBeg: w.iBeg, iEnd: w.iEnd,
                    windowMultiplier: +wm.toFixed(4),
                    cumulativeMultiplier: +cumMult.toFixed(4)
                });
            }

            years.push({ year, prices, returns, windows, windowMultipliers });
        }

        // Average
        const avgPrices = new Array(DAYS).fill(0);
        for (const yr of years) {
            for (let d = 0; d < DAYS; d++) avgPrices[d] += yr.prices[d];
        }
        for (let d = 0; d < DAYS; d++) avgPrices[d] /= years.length;

        const average = {
            prices: avgPrices,
            returns: generateRandomReturns(10, 0.08),
            windows: stats.map(s => ({
                iBeg: s.iBeg, iEnd: s.iEnd,
                priceBeg: +avgPrices[s.iBeg].toFixed(2),
                priceEnd: +(avgPrices[s.iEnd] * 0.996).toFixed(2)
            })),
            windowMultipliers: []
        };

        return JSON.stringify({ stock: symbol, stats, years, average });
    }

    getBasketStocks() {
        return JSON.stringify(this._insertOrder.filter(s => this._stocks[s]));
    }

    getStockParams(symbol) {
        if (!this._stocks[symbol]) return '';
        return JSON.stringify(this._stocks[symbol].params);
    }
}

// Singleton mock engine instance
const engine = new MockEngine();
export default engine;
