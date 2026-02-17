        // State
        let state = {
            symbol: '',
            windowSize: 30,
            threshold: 50,
            overlapData: null,
            basketVisible: {},  // symbol -> boolean, for show/hide checkboxes
            lastBasketData: null,  // cached basket backtest data for checkbox toggling
            hiddenStrategies: new Set(),  // indices of hidden strategies in basket
            windowBarMode: false,  // toggle for bar chart view in main window
            basketBarMode: false,    // toggle for bar chart view in basket
            windowBarData: null,   // cached bar chart data
            basketBarData: null,     // cached basket bar chart data
            basketWeights: null,     // cached {symbol: weight} for return-weighted mode
        };
        
        // Elements
        const symbolInput = document.getElementById('symbol-input');
        const autocomplete = document.getElementById('autocomplete');
        const windowSizeSelect = document.getElementById('window-size-select');
        const thresholdValue = document.getElementById('threshold-value');
        const loadBtn = document.getElementById('load-btn');
        const statsTable = document.getElementById('stats-table');
        const tradesTable = document.getElementById('trades-table');
        const summary = document.getElementById('summary');
        const status = document.getElementById('status');
        const tradesPanel = document.getElementById('trades-panel');
        const tradesPanelTitle = document.getElementById('trades-panel-title');
        const chartControls = document.getElementById('chart-controls');
        const chartYearSelect = document.getElementById('chart-year-select');
        const chartSLInput = document.getElementById('chart-sl-input');
        const chartREInput = document.getElementById('chart-re-input');
        const chartFeesInput = document.getElementById('chart-fees-input');
        const chartTaxInput = document.getElementById('chart-tax-input');
        const windowChart = document.getElementById('window-chart');
        const windowChartMetrics = document.getElementById('window-chart-metrics');
        const spinner = document.getElementById('spinner');
        
        // Double-buffer references for flicker-free window chart rendering
        const windowBuffer0 = document.getElementById('window-buffer-0');
        const windowBuffer1 = document.getElementById('window-buffer-1');
        let windowActiveBuffer = 0;
        
        function getWindowBackBuffer() {
            return windowActiveBuffer === 0 ? windowBuffer1 : windowBuffer0;
        }
        
        function getWindowFrontBuffer() {
            return windowActiveBuffer === 0 ? windowBuffer0 : windowBuffer1;
        }
        
        function swapWindowBuffers() {
            const front = getWindowFrontBuffer();
            const back = getWindowBackBuffer();
            front.classList.add('back');
            back.classList.remove('back');
            windowActiveBuffer = 1 - windowActiveBuffer;
        }
        
        // Autocomplete
        let autocompleteIndex = -1;
        let autocompleteItems = [];
        
        // Helper to format symbol for display (strip .NS suffix)
        function displaySymbol(symbol) {
            return symbol.replace(/\.NS$/i, '');
        }
        
        symbolInput.addEventListener('input', async (e) => {
            const query = e.target.value.trim();
            
            // Check for expanded mode on input change
            if (query.includes(',')) {
                document.querySelector('.controls').classList.add('input-expanded');
                hideAutocomplete();  // Disable autocomplete for multiple symbols
                return;
            } else {
                document.querySelector('.controls').classList.remove('input-expanded');
            }
            
            if (query.length < 1) {
                hideAutocomplete();
                return;
            }
            
            try {
                const res = await fetch(`/api/symbols?q=${encodeURIComponent(query)}`);
                const data = await res.json();
                showAutocomplete(data);
            } catch (err) {
                hideAutocomplete();
            }
        });
        
        symbolInput.addEventListener('keydown', (e) => {
            if (!autocomplete.classList.contains('show')) {
                if (e.key === 'Enter') {
                    loadData();
                }
                return;
            }
            
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                autocompleteIndex = Math.min(autocompleteIndex + 1, autocompleteItems.length - 1);
                updateAutocompleteSelection();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                autocompleteIndex = Math.max(autocompleteIndex - 1, 0);
                updateAutocompleteSelection();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (autocompleteIndex >= 0 && autocompleteItems[autocompleteIndex]) {
                    selectAutocompleteItem(autocompleteItems[autocompleteIndex].symbol);
                } else {
                    hideAutocomplete();
                    loadData();
                }
            } else if (e.key === 'Escape') {
                hideAutocomplete();
            }
        });
        
        symbolInput.addEventListener('blur', () => {
            setTimeout(hideAutocomplete, 200);
            // Remove expanded mode on blur
            document.querySelector('.controls').classList.remove('input-expanded');
        });
        
        // Expanded input mode for editing multiple symbols
        symbolInput.addEventListener('focus', () => {
            // If input contains comma (multiple symbols), expand to full width
            if (symbolInput.value.includes(',')) {
                document.querySelector('.controls').classList.add('input-expanded');
            }
        });
        
        function showAutocomplete(items) {
            autocompleteItems = items;
            autocompleteIndex = -1;
            
            if (items.length === 0) {
                hideAutocomplete();
                return;
            }
            
            autocomplete.innerHTML = items.map((item, idx) => `
                <div class="autocomplete-item" data-symbol="${item.symbol}">
                    <span class="symbol">${displaySymbol(item.symbol)}</span>
                    <span class="name">${item.name}</span>
                </div>
            `).join('');
            
            autocomplete.querySelectorAll('.autocomplete-item').forEach(el => {
                el.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    selectAutocompleteItem(el.dataset.symbol);
                });
            });
            
            autocomplete.classList.add('show');
        }
        
        function hideAutocomplete() {
            autocomplete.classList.remove('show');
            autocompleteItems = [];
            autocompleteIndex = -1;
        }
        
        function updateAutocompleteSelection() {
            autocomplete.querySelectorAll('.autocomplete-item').forEach((el, idx) => {
                el.classList.toggle('selected', idx === autocompleteIndex);
            });
        }
        
        function selectAutocompleteItem(symbol) {
            symbolInput.value = displaySymbol(symbol);
            state.symbol = symbol;
            hideAutocomplete();
            loadData();
        }
        
        // Window size
        windowSizeSelect.addEventListener('change', (e) => {
            state.windowSize = parseInt(e.target.value);
            loadData();
        });
        
        // Threshold stepper
        document.getElementById('threshold-minus').addEventListener('click', () => {
            if (state.threshold > 50) {
                state.threshold -= 5;
                thresholdValue.textContent = state.threshold + '%';
                loadData();
            }
        });
        
        document.getElementById('threshold-plus').addEventListener('click', () => {
            if (state.threshold < 100) {
                state.threshold += 5;
                thresholdValue.textContent = state.threshold + '%';
                loadData();
            }
        });
        
        // Load button
        loadBtn.addEventListener('click', loadData);
        
        // Export buttons
        document.getElementById('export-stats-btn').addEventListener('click', () => {
            exportCSV('stats');
        });
        
        document.getElementById('export-trades-btn').addEventListener('click', () => {
            exportCSV('trades');
        });
        
        document.getElementById('export-strategy-btn').addEventListener('click', () => {
            exportCSV('strategy');
        });
        
        document.getElementById('show-backtest-btn').addEventListener('click', () => {
            showBacktest();
        });
        
        document.getElementById('add-to-basket-btn').addEventListener('click', () => {
            addToBasket();
        });
        
        document.getElementById('chart-add-basket-btn').addEventListener('click', () => {
            addToBasket();
        });
        
        // Find optimal trades buttons - disabled for window mode
        document.getElementById('find-max-profit-btn').addEventListener('click', () => {
            setStatus('Optimize not available in window mode', true);
        });
        
        document.getElementById('find-max-yield-btn').addEventListener('click', () => {
            setStatus('Optimize not available in window mode', true);
        });
        
        async function loadData() {
            state.symbol = symbolInput.value.trim().toUpperCase();
            if (!state.symbol) {
                setStatus('Enter a symbol', true);
                return;
            }
            
            // Clear cached bar data on new data load (will be re-fetched if needed)
            state.windowBarData = null;
            
            showSpinner();
            setStatus('Loading...');
            
            try {
                const params = new URLSearchParams({
                    symbol: state.symbol,
                    window_size: state.windowSize,
                    threshold: state.threshold,
                });
                
                // Fetch windows, and overlap with basket in parallel
                const basket = loadBasket();
                const fetches = [fetch(`/api/windows?${params}`)];
                if (basket.length > 0) {
                    const overlapParams = new URLSearchParams({
                        symbol: state.symbol,
                        window_size: state.windowSize,
                        threshold: state.threshold,
                        strategies: JSON.stringify(basket),
                    });
                    fetches.push(fetch(`/api/basket/overlap?${overlapParams}`));
                }
                
                const responses = await Promise.all(fetches);
                const data = await responses[0].json();
                
                if (data.error) {
                    setStatus(data.error, true);
                    hideSpinner();
                    return;
                }
                
                // Parse overlap if available
                state.overlapData = null;
                if (responses.length > 1) {
                    try {
                        const od = await responses[1].json();
                        if (!od.error) state.overlapData = od;
                    } catch (e) {}
                }
                
                renderWindowsTable(data);
                
                const windowLabel = windowSizeSelect.options[windowSizeSelect.selectedIndex].text;
                setStatus(`Found ${data.windows.length} windows for ${displaySymbol(state.symbol)} (${windowLabel}, ${state.threshold}% threshold)`);
            } catch (err) {
                setStatus('Error: ' + err.message, true);
            }
            
            hideSpinner();
        }
        
        function renderWindowsTable(data) {
            const { windows, total_days, total_return } = data;
            
            // Build header
            const headerRow = statsTable.querySelector('thead tr');
            headerRow.innerHTML = '<th class="col-period">Period</th><th class="col-days">Days</th><th class="col-return">Return%</th><th class="col-win">Win%</th><th class="col-yield">bps/day</th>';
            
            // Add year columns from first window if available
            if (windows.length > 0) {
                const years = Object.keys(windows[0].year_returns).sort().reverse();
                years.forEach(year => {
                    headerRow.innerHTML += `<th class="col-year">${year}</th>`;
                });
            }
            
            // Build body
            const tbody = statsTable.querySelector('tbody');
            tbody.innerHTML = '';
            
            windows.forEach((w) => {
                const tr = document.createElement('tr');
                
                // Period column
                tr.innerHTML = `<td class="col-period">${w.start_date} - ${w.end_date}</td>`;
                
                // Days
                const daysCell = document.createElement('td');
                daysCell.className = 'col-days';
                daysCell.textContent = w.length;
                tr.appendChild(daysCell);
                
                // Return%
                const returnCell = document.createElement('td');
                returnCell.className = 'col-return ' + (w.avg_return >= 0 ? 'positive' : 'negative');
                returnCell.textContent = w.avg_return.toFixed(1) + '%';
                tr.appendChild(returnCell);
                
                // Win%
                const winCell = document.createElement('td');
                winCell.className = 'col-win';
                winCell.textContent = w.win_rate + '%';
                tr.appendChild(winCell);
                
                // bps/day
                const yieldCell = document.createElement('td');
                yieldCell.className = 'col-yield ' + (w.yield_per_day >= 0 ? 'positive' : 'negative');
                yieldCell.textContent = w.yield_per_day.toFixed(1);
                tr.appendChild(yieldCell);
                
                // Year returns
                const years = Object.keys(w.year_returns).sort().reverse();
                years.forEach(year => {
                    const ret = w.year_returns[year];
                    const td = document.createElement('td');
                    td.className = 'col-year';
                    if (ret !== null) {
                        td.textContent = ret.toFixed(1) + '%';
                        td.className += ret >= 0 ? ' positive' : ' negative';
                    } else {
                        td.textContent = '-';
                        td.className += ' na';
                    }
                    tr.appendChild(td);
                });
                
                tbody.appendChild(tr);
            });
            
            // Add totals row
            if (windows.length > 0) {
                const totalTr = document.createElement('tr');
                totalTr.className = 'totals-row';
                totalTr.innerHTML = `
                    <td class="col-period"><strong>TOTAL</strong></td>
                    <td class="col-days"><strong>${total_days}</strong></td>
                    <td class="col-return ${total_return >= 0 ? 'positive' : 'negative'}"><strong>${total_return.toFixed(1)}%</strong></td>
                    <td class="col-win"></td>
                    <td class="col-yield"></td>
                `;
                // Add empty cells for year columns
                if (windows.length > 0) {
                    const years = Object.keys(windows[0].year_returns).sort().reverse();
                    years.forEach(() => {
                        totalTr.innerHTML += '<td class="col-year"></td>';
                    });
                }
                tbody.appendChild(totalTr);
                
                // Plan overlap row
                if (state.overlapData) {
                    const od = state.overlapData;
                    const overlapTr = document.createElement('tr');
                    overlapTr.style.cssText = 'border-top:1px solid #444;';
                    const colSpan = 5 + Object.keys(windows[0].year_returns).length;
                    const overlapPct = od.stock_days > 0 ? Math.round(od.overlap_days / od.stock_days * 100) : 0;
                    overlapTr.innerHTML = `
                        <td colspan="${colSpan}" style="color:#aa88dd;font-size:11px;padding:6px 8px;">
                            Plan overlap: ${od.overlap_days}/${od.stock_days} days (${overlapPct}%)
                            &nbsp;&bull;&nbsp;
                            <span style="color:#00cc66;">+${od.new_days} new days</span>
                            to basket's ${od.basket_days}d coverage
                        </td>
                    `;
                    tbody.appendChild(overlapTr);
                }
            }
            
            // Switch bottom panel to chart mode
            tradesTable.querySelector('tbody').innerHTML = '';
            summary.innerHTML = '';
            document.getElementById('strategy-actions').style.display = 'none';
            document.querySelector('.trades-table-container').style.display = 'none';
            
            // Enable chart mode
            tradesPanel.classList.add('chart-mode');
            tradesPanelTitle.textContent = 'Backtest';
            chartControls.style.display = '';
            windowChart.style.display = '';
            windowChartMetrics.style.display = '';
            
            // Populate year selector from window year_returns
            if (windows.length > 0) {
                const years = Object.keys(windows[0].year_returns).sort().reverse();
                chartYearSelect.innerHTML = '';
                // Add Average option first
                const avgOpt = document.createElement('option');
                avgOpt.value = 'avg';
                avgOpt.textContent = 'Average';
                chartYearSelect.appendChild(avgOpt);
                years.forEach(year => {
                    const opt = document.createElement('option');
                    opt.value = year;
                    opt.textContent = year;
                    chartYearSelect.appendChild(opt);
                });
                // Load chart in current mode
                if (state.windowBarMode) {
                    loadWindowBarChart();
                } else {
                    loadWindowBacktest();
                }
            }
        }
        
        // Year selector change handler for inline chart
        chartYearSelect.addEventListener('change', () => {
            loadWindowBacktest();
        });
        
        async function loadWindowBacktest() {
            const year = chartYearSelect.value;
            if (!year || !state.symbol) return;
            
            // No "Loading..." text - previous chart stays visible (double-buffer)
            
            try {
                const params = new URLSearchParams({
                    symbol: state.symbol,
                    window_size: state.windowSize,
                    threshold: state.threshold,
                    year: year,
                });
                const sl = parseFloat(chartSLInput.value) || 0;
                const re = parseFloat(chartREInput.value) || 0;
                if (sl > 0) params.set('stop_loss', String(sl));
                if (re > 0) params.set('reentry', String(re));
                const fees = parseFloat(chartFeesInput.value) || 0;
                const tax = parseFloat(chartTaxInput.value) || 0;
                if (fees > 0) params.set('fees_pct', String(fees));
                if (tax > 0) params.set('tax_pct', String(tax));
                
                const res = await fetch(`/api/windows/backtest?${params}`);
                const data = await res.json();
                
                if (data.error) {
                    getWindowFrontBuffer().innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#ff4466;">${data.error}</div>`;
                    return;
                }
                
                renderWindowChart(data, state.overlapData);
            } catch (err) {
                getWindowFrontBuffer().innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#ff4466;">Error: ${err.message}</div>`;
            }
        }
        
        function renderWindowChart(data, overlapData) {
            const { seasonal_curve, bh_curve, trades, dates } = data;
            const capital = 100000;  // Fixed ₹1L for window mode
            
            // Chart dimensions from container
            const container = windowChart.getBoundingClientRect();
            const width = container.width;
            const height = container.height;
            if (width < 50 || height < 50) return;
            
            const padding = { top: 20, right: 55, bottom: 30, left: 60 };
            const chartWidth = width - padding.left - padding.right;
            const chartHeight = height - padding.top - padding.bottom;
            
            // Scale to P&L
            const seasonalPnL = seasonal_curve.map(p => (p / 100) * capital);
            const bhPnL = bh_curve.map(p => (p / 100) * capital);
            
            const allValues = [...seasonalPnL, ...bhPnL];
            const dataMin = Math.min(...allValues, 0);
            const dataMax = Math.max(...allValues, 0);
            const range = dataMax - dataMin || 1;
            const yMin = dataMin - range * 0.1;
            const yMax = dataMax + range * 0.1;
            
            const xScale = (i) => padding.left + (i / (dates.length - 1)) * chartWidth;
            const yScale = (v) => padding.top + chartHeight - ((v - yMin) / (yMax - yMin)) * chartHeight;
            
            function buildPath(values) {
                return values.map((v, i) =>
                    `${i === 0 ? 'M' : 'L'} ${xScale(i).toFixed(1)} ${yScale(v).toFixed(1)}`
                ).join(' ');
            }
            
            // Y ticks
            const yTicks = [];
            const yRange = yMax - yMin;
            let yStep;
            if (yRange >= 500000) yStep = 100000;
            else if (yRange >= 200000) yStep = 50000;
            else if (yRange >= 100000) yStep = 25000;
            else if (yRange >= 50000) yStep = 10000;
            else if (yRange >= 20000) yStep = 5000;
            else if (yRange >= 10000) yStep = 2000;
            else if (yRange >= 5000) yStep = 1000;
            else yStep = Math.ceil(yRange / 8 / 100) * 100 || 500;
            
            for (let v = Math.ceil(yMin / yStep) * yStep; v <= yMax; v += yStep) {
                yTicks.push(v);
            }
            
            // X ticks (monthly)
            const xTicks = [];
            const monthFirstIdx = {};
            dates.forEach((d, i) => {
                const [m] = d.split('-');
                if (!(m in monthFirstIdx)) {
                    monthFirstIdx[m] = i;
                    xTicks.push({ i, label: m });
                }
            });
            
            // Trade bands and markers
            function findNearestDateIdx(targetDate) {
                let idx = dates.findIndex(d => d === targetDate);
                if (idx >= 0) return idx;
                
                const [targetMonth, targetDay] = targetDate.split('-');
                const monthOrder = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                const targetMonthIdx = monthOrder.indexOf(targetMonth);
                const targetDayNum = parseInt(targetDay);
                
                for (let i = 0; i < dates.length; i++) {
                    const [m, d] = dates[i].split('-');
                    const mIdx = monthOrder.indexOf(m);
                    const dNum = parseInt(d);
                    if (mIdx > targetMonthIdx || (mIdx === targetMonthIdx && dNum >= targetDayNum)) {
                        return i;
                    }
                }
                return dates.length - 1;
            }
            
            let tradeMarkers = '';
            let investmentBands = '';
            
            // Basket overlap bands (purple, behind stock's green bands)
            let basketBands = '';
            if (overlapData && overlapData.basket_windows) {
                const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                function doyToDateStr(doy) {
                    const d = new Date(2023, 0, doy);
                    return monthNames[d.getMonth()] + '-' + d.getDate();
                }
                overlapData.basket_windows.forEach(([startDay, endDay]) => {
                    const startIdx = findNearestDateIdx(doyToDateStr(startDay));
                    const endIdx = findNearestDateIdx(doyToDateStr(endDay));
                    if (startIdx >= 0 && endIdx >= 0 && endIdx > startIdx) {
                        const x1 = xScale(startIdx);
                        const x2 = xScale(endIdx);
                        basketBands += `<rect x="${x1}" y="${padding.top}" width="${x2 - x1}" height="${chartHeight}" fill="#aa66ff" opacity="0.10"/>`;
                    }
                });
            }
            
            trades.forEach(trade => {
                const entryIdx = findNearestDateIdx(trade.entry_date);
                const exitIdx = findNearestDateIdx(trade.exit_date);
                
                if (entryIdx >= 0 && exitIdx >= 0 && exitIdx > entryIdx) {
                    const x1 = xScale(entryIdx);
                    const x2 = xScale(exitIdx);
                    const bandWidth = x2 - x1;
                    
                    const entryValue = seasonalPnL[entryIdx];
                    const exitValue = seasonalPnL[exitIdx];
                    const tradeReturn = exitValue - entryValue;
                    const tradeReturnPct = (tradeReturn / capital) * 100;
                    const isProfit = tradeReturn >= 0;
                    
                    const bandColor = isProfit ? '#00ff88' : '#ff4466';
                    const textColor = isProfit ? '#00cc66' : '#cc3355';
                    
                    const labelY = isProfit ? (padding.top + chartHeight - 6) : (padding.top + 14);
                    const pctY = isProfit ? (padding.top + chartHeight - 18) : (padding.top + 26);
                    
                    investmentBands += `<rect x="${x1}" y="${padding.top}" width="${bandWidth}" height="${chartHeight}" fill="${bandColor}" opacity="0.12"/>`;
                    tradeMarkers += `<text x="${x1 + 3}" y="${labelY}" fill="${textColor}" font-size="8" font-weight="bold" text-anchor="start">BUY</text>`;
                    tradeMarkers += `<text x="${x2 - 3}" y="${labelY}" fill="${textColor}" font-size="8" font-weight="bold" text-anchor="end">SELL</text>`;
                    
                    const pctText = (tradeReturnPct >= 0 ? '+' : '') + tradeReturnPct.toFixed(1) + '%';
                    const midX = (x1 + x2) / 2;
                    tradeMarkers += `<text x="${midX}" y="${pctY}" fill="${textColor}" font-size="9" font-weight="bold" text-anchor="middle">${pctText}</text>`;
                }
            });
            
            const formatCurrency = (v) => {
                const abs = Math.abs(v);
                const sign = v < 0 ? '-' : (v > 0 ? '+' : '');
                if (abs >= 100000) return sign + '₹' + (abs / 100000).toFixed(1) + 'L';
                if (abs >= 1000) return sign + '₹' + (abs / 1000).toFixed(0) + 'K';
                return sign + '₹' + abs.toFixed(0);
            };
            
            const svg = `
                <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
                    <!-- Basket bands (purple, behind everything) -->
                    ${basketBands}
                    <!-- Investment bands (behind lines) -->
                    ${investmentBands}
                    ${xTicks.map(t => `
                        <line x1="${xScale(t.i)}" y1="${padding.top}" x2="${xScale(t.i)}" y2="${padding.top + chartHeight}"
                              stroke="#444" stroke-width="0.5" opacity="0.5"/>
                    `).join('')}
                    ${yTicks.map(v => `
                        <line x1="${padding.left}" y1="${yScale(v)}" x2="${width - padding.right}" y2="${yScale(v)}"
                              stroke="${v === 0 ? '#666' : '#333'}" stroke-width="${v === 0 ? 2 : 1}"/>
                    `).join('')}
                    ${yTicks.map(v => `
                        <text x="${padding.left - 8}" y="${yScale(v) + 4}" fill="#888" font-size="10" text-anchor="end">
                            ${formatCurrency(v)}
                        </text>
                    `).join('')}
                    ${xTicks.map(t => `
                        <text x="${xScale(t.i)}" y="${height - padding.bottom + 16}" fill="#888" font-size="10" text-anchor="middle">
                            ${t.label}
                        </text>
                    `).join('')}
                    <path d="${buildPath(bhPnL)}" fill="none" stroke="#6699ff" stroke-width="1.25" opacity="0.8"/>
                    <path d="${buildPath(seasonalPnL)}" fill="none" stroke="#00ff88" stroke-width="1.25"/>
                    ${tradeMarkers}
                    <text x="${width - padding.right + 4}" y="${yScale(seasonalPnL[seasonalPnL.length - 1]) + 4}"
                          fill="#00ff88" font-size="10" font-weight="bold">
                        ${formatCurrency(seasonalPnL[seasonalPnL.length - 1])}
                    </text>
                    <text x="${width - padding.right + 4}" y="${yScale(bhPnL[bhPnL.length - 1]) + 4}"
                          fill="#6699ff" font-size="10">
                        ${formatCurrency(bhPnL[bhPnL.length - 1])}
                    </text>
                </svg>
            `;
            
            // Render to back buffer, then swap for flicker-free update
            const backBuffer = getWindowBackBuffer();
            backBuffer.innerHTML = svg;
            swapWindowBuffers();
            
            // Metrics
            const finalSeasonal = seasonalPnL[seasonalPnL.length - 1];
            const finalBH = bhPnL[bhPnL.length - 1];
            const maxDrawdown = Math.min(...seasonalPnL);
            const daysInMarket = trades.reduce((sum, t) => sum + t.days, 0);
            const warning = data.warning || null;
            const isAvg = data.avg_years != null;
            const pnlLabel = isAvg ? `Avg P&L (${data.avg_years}y):` : 'P&L:';
            const bhLabel = isAvg ? 'Avg B&H:' : 'B&H:';
            
            windowChartMetrics.innerHTML = `
                ${warning ? `<div style="width:100%;text-align:center;color:#ff9944;font-size:11px;padding:2px 0;">${warning}</div>` : ''}
                <div class="metric">
                    <span class="label">${pnlLabel}</span>
                    <span class="${finalSeasonal >= 0 ? 'positive' : 'negative'}">${formatCurrency(finalSeasonal)}</span>
                </div>
                <div class="metric">
                    <span class="label">${bhLabel}</span>
                    <span class="${finalBH >= 0 ? 'positive' : 'negative'}">${formatCurrency(finalBH)}</span>
                </div>
                <div class="metric">
                    <span class="label">Drawdown:</span>
                    <span class="${maxDrawdown >= 0 ? 'positive' : 'negative'}">${formatCurrency(maxDrawdown)}</span>
                </div>
                <div class="metric">
                    <span class="label">Days:</span>
                    <span>${daysInMarket} / 365</span>
                </div>
                <div class="metric">
                    <span class="label">Trades:</span>
                    <span>${trades.length}</span>
                </div>
                ${overlapData ? `
                <div class="metric" style="border-top:1px solid #333;padding-top:4px;margin-top:2px;">
                    <span class="label" style="color:#aa88dd;">Plan overlap:</span>
                    <span style="color:#aa88dd;">${overlapData.overlap_days}d / ${overlapData.stock_days}d</span>
                </div>
                <div class="metric">
                    <span class="label" style="color:#aa88dd;">New coverage:</span>
                    <span class="positive">+${overlapData.new_days}d</span>
                </div>
                ` : ''}
            `;
        }
        
        // Bar/Line toggle for window chart
        const chartLineBtn = document.getElementById('chart-line-btn');
        const chartBarBtn = document.getElementById('chart-bar-btn');
        
        function setWindowViewMode(barMode) {
            state.windowBarMode = barMode;
            chartLineBtn.classList.toggle('active', !barMode);
            chartBarBtn.classList.toggle('active', barMode);
            chartYearSelect.style.display = barMode ? 'none' : '';
        }
        
        chartBarBtn.addEventListener('click', async () => {
            if (state.windowBarMode) return;
            setWindowViewMode(true);
            await loadWindowBarChart();
        });
        
        chartLineBtn.addEventListener('click', () => {
            if (!state.windowBarMode) return;
            setWindowViewMode(false);
            loadWindowBacktest();
        });
        
        function onChartSLREChange() {
            if (state.windowBarMode) {
                loadWindowBarChart();
            } else {
                loadWindowBacktest();
            }
        }
        chartSLInput.addEventListener('change', onChartSLREChange);
        chartREInput.addEventListener('change', onChartSLREChange);
        chartFeesInput.addEventListener('change', onChartSLREChange);
        chartTaxInput.addEventListener('change', onChartSLREChange);
        
        async function loadWindowBarChart() {
            if (!state.symbol) return;
            // No "Loading..." text - previous chart stays visible (double-buffer)
            try {
                const params = new URLSearchParams({
                    symbol: state.symbol,
                    window_size: state.windowSize,
                    threshold: state.threshold,
                });
                const sl = parseFloat(chartSLInput.value) || 0;
                const re = parseFloat(chartREInput.value) || 0;
                if (sl > 0) params.set('stop_loss', String(sl));
                if (re > 0) params.set('reentry', String(re));
                const fees = parseFloat(chartFeesInput.value) || 0;
                const tax = parseFloat(chartTaxInput.value) || 0;
                if (fees > 0) params.set('fees_pct', String(fees));
                if (tax > 0) params.set('tax_pct', String(tax));
                const res = await fetch('/api/windows/bar?' + params);
                const data = await res.json();
                if (data.error) {
                    getWindowFrontBuffer().innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#ff4466;">' + data.error + '</div>';
                    return;
                }
                state.windowBarData = data;
                renderWindowBarChart(data);
            } catch (err) {
                getWindowFrontBuffer().innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#ff4466;">Error: ' + err.message + '</div>';
            }
        }
        
        function sharpeColor(s) {
            if (s == null || s < 0.5) return '#ff4466';
            if (s < 1.0) return '#ffaa44';
            if (s < 2.0) return '#44ff88';
            return '#44ddff';
        }

        function renderWindowBarChart(data) {
            const years = data.years;
            if (!years || years.length === 0) {
                getWindowFrontBuffer().innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#888;">No data</div>';
                return;
            }

            const container = windowChart.getBoundingClientRect();
            const containerWidth = container.width;
            const rawHeight = container.height - 8;

            // 3-zone SVG: topZone (value labels above bars) | chartZone (bars) | bottomZone (year/days labels)
            const topZone = 18;      // px for value labels above tallest bar
            const bottomZone = 44;   // px for year + days labels below chart
            const leftPad = 60;
            const rightPad = 20;
            const n = years.length;
            const minPerGroup = 80;
            const minWidth = leftPad + rightPad + n * minPerGroup;
            const width = Math.max(containerWidth, minWidth);
            // If horizontal scrollbar will appear, reserve space for it
            const svgHeight = width > containerWidth ? rawHeight - 20 : rawHeight;
            if (containerWidth < 50 || svgHeight < 80) return;
            const chartHeight = svgHeight - topZone - bottomZone;
            const chartWidth = width - leftPad - rightPad;

            // Fixed Y range so bars never shift when toggling params
            const yMin = -20;
            const yMax = 200;

            const groupWidth = chartWidth / n;
            const barWidth = Math.min(groupWidth * 0.38, 50);
            const gap = barWidth * 0.2;

            // yScale maps data values to the chart zone (topZone to topZone+chartHeight)
            const yScale = (v) => topZone + chartHeight - ((v - yMin) / (yMax - yMin)) * chartHeight;
            const zeroY = yScale(0);

            // Y ticks
            const yTicks = [];
            const yStep = 20;
            for (let v = yMin; v <= yMax; v += yStep) {
                yTicks.push(v);
            }

            let bars = '';
            let labels = '';
            years.forEach((d, i) => {
                const cx = leftPad + (i + 0.5) * groupWidth;
                const bhX = cx - barWidth - gap / 2;
                const stratX = cx + gap / 2;

                // B&H bar
                const bhTop = yScale(Math.max(d.bh_return, 0));
                const bhBot = yScale(Math.min(d.bh_return, 0));
                bars += '<rect x="' + bhX.toFixed(1) + '" y="' + bhTop.toFixed(1) + '" width="' + barWidth.toFixed(1) + '" height="' + Math.max(bhBot - bhTop, 1).toFixed(1) + '" fill="#6699ff" opacity="0.7" rx="1"/>';

                // Strategy bar
                const sTop = yScale(Math.max(d.strategy_return, 0));
                const sBot = yScale(Math.min(d.strategy_return, 0));
                bars += '<rect x="' + stratX.toFixed(1) + '" y="' + sTop.toFixed(1) + '" width="' + barWidth.toFixed(1) + '" height="' + Math.max(sBot - sTop, 1).toFixed(1) + '" fill="#00ff88" opacity="0.8" rx="1"/>';

                // Value labels on bars
                const bhLabelY = d.bh_return >= 0 ? bhTop - 4 : bhBot + 14;
                const sLabelY = d.strategy_return >= 0 ? sTop - 4 : sBot + 14;
                bars += '<text x="' + (bhX + barWidth / 2).toFixed(1) + '" y="' + bhLabelY.toFixed(1) + '" fill="#6699ff" font-size="12" font-weight="600" text-anchor="middle">' + d.bh_return.toFixed(0) + '%</text>';
                bars += '<text x="' + (stratX + barWidth / 2).toFixed(1) + '" y="' + sLabelY.toFixed(1) + '" fill="#00ff88" font-size="12" font-weight="600" text-anchor="middle">' + d.strategy_return.toFixed(0) + '%</text>';

                // Year label — placed in the bottom zone
                labels += '<text x="' + cx.toFixed(1) + '" y="' + (topZone + chartHeight + 16) + '" fill="#888" font-size="12" text-anchor="middle">&#39;' + String(d.year).slice(-2) + '</text>';
                // Days in market label
                if (d.days_in_market != null) {
                    labels += '<text x="' + cx.toFixed(1) + '" y="' + (topZone + chartHeight + 30) + '" fill="#666" font-size="10" text-anchor="middle">' + d.days_in_market + '/' + d.total_trading_days + 'd</text>';
                }
            });

            const svg = '<svg width="' + width + '" height="' + svgHeight + '">' +
                yTicks.map(v =>
                    '<line x1="' + leftPad + '" y1="' + yScale(v).toFixed(1) + '" x2="' + (width - rightPad) + '" y2="' + yScale(v).toFixed(1) + '" stroke="' + (v === 0 ? '#666' : '#333') + '" stroke-width="' + (v === 0 ? 2 : 1) + '"/>'
                ).join('') +
                yTicks.map(v =>
                    '<text x="' + (leftPad - 8) + '" y="' + (yScale(v) + 4).toFixed(1) + '" fill="#888" font-size="11" text-anchor="end">' + v.toFixed(0) + '%</text>'
                ).join('') +
                '<line x1="' + leftPad + '" y1="' + zeroY.toFixed(1) + '" x2="' + (width - rightPad) + '" y2="' + zeroY.toFixed(1) + '" stroke="#666" stroke-width="1.5"/>' +
                bars + labels +
                '</svg>';

            // Render to back buffer, then swap for flicker-free update
            const backBuffer = getWindowBackBuffer();
            backBuffer.innerHTML = svg;
            swapWindowBuffers();

            // Metrics: averages
            const avgStrategy = years.reduce((s, d) => s + d.strategy_return, 0) / n;
            const avgBH = years.reduce((s, d) => s + d.bh_return, 0) / n;
            const winYears = years.filter(d => d.strategy_return > d.bh_return).length;

            windowChartMetrics.innerHTML =
                '<div class="metric"><span class="label">Avg Strategy:</span><span class="' + (avgStrategy >= 0 ? 'positive' : 'negative') + '">' + avgStrategy.toFixed(1) + '%</span></div>' +
                '<div class="metric"><span class="label">Avg B&H:</span><span class="' + (avgBH >= 0 ? 'positive' : 'negative') + '">' + avgBH.toFixed(1) + '%</span></div>' +
                '<div class="metric"><span class="label">Beats B&H:</span><span>' + winYears + '/' + n + ' yrs</span></div>' +
                '<div class="metric"><span class="label">Sharpe:</span><span style="color:' + sharpeColor(data.sharpe_ratio) + '">' + (data.sharpe_ratio != null ? data.sharpe_ratio.toFixed(2) : 'N/A') + ' (' + (data.sharpe_label || 'N/A') + ')</span></div>' +
                '<div class="metric" id="basket-impact"><span class="label">Basket Impact:</span><span style="color:#888">...</span></div>';
            
            // Async fetch basket impact
            updateBasketImpact();
        }
        
        function renderTradesTable(data) {
            const { trades, summary: sum, years } = data;
            
            // Build header with fixed column widths
            const headerRow = tradesTable.querySelector('thead tr');
            headerRow.innerHTML = '<th class="col-entry">Entry</th><th class="col-exit">Exit</th><th class="col-profit">Profit</th><th class="col-days">Days</th><th class="col-bps">Yield/day</th>';
            years.slice().reverse().forEach(year => {
                headerRow.innerHTML += `<th class="col-year">${year}</th>`;
            });
            
            // Build body
            const tbody = tradesTable.querySelector('tbody');
            tbody.innerHTML = '';
            
            if (trades.length === 0) {
                const tr = document.createElement('tr');
                tr.innerHTML = `<td colspan="${5 + years.length}">No green runs detected</td>`;
                tbody.appendChild(tr);
                summary.innerHTML = '';
                return;
            }
            
            trades.forEach(trade => {
                const tr = document.createElement('tr');
                
                tr.innerHTML = `<td class="col-entry">${trade.entry_date}</td>`;
                tr.innerHTML += `<td class="col-exit">${trade.exit_date}</td>`;
                tr.innerHTML += `<td class="col-profit ${trade.avg_profit >= 0 ? 'positive' : 'negative'}">${Math.abs(trade.avg_profit).toFixed(1)}%</td>`;
                tr.innerHTML += `<td class="col-days">${trade.days}</td>`;
                const bpsPerDay = (trade.avg_profit / trade.days) * 100;
                tr.innerHTML += `<td class="col-bps ${bpsPerDay >= 0 ? 'positive' : 'negative'}">${Math.abs(bpsPerDay).toFixed(1)}</td>`;
                
                years.slice().reverse().forEach(year => {
                    const val = trade.years[year];
                    if (val !== null) {
                        const cls = val >= 0 ? 'positive' : 'negative';
                        tr.innerHTML += `<td class="col-year ${cls}">${Math.abs(val).toFixed(1)}%</td>`;
                    } else {
                        tr.innerHTML += `<td class="col-year dim">-</td>`;
                    }
                });
                
                tbody.appendChild(tr);
            });
            
            // Render summary as table
            const profitClass = sum.avg_profit >= 0 ? 'positive' : 'negative';
            const bhClass = sum.bh_profit >= 0 ? 'positive' : 'negative';
            const profitSign = sum.avg_profit >= 0 ? '' : '-';
            const bhSign = sum.bh_profit >= 0 ? '' : '-';
            
            // Calculate bps/day
            const seasonalBps = (sum.avg_profit / sum.avg_days) * 100;
            const bhBps = (sum.bh_profit / 365) * 100;
            const edgeBps = seasonalBps - bhBps;
            
            const seasonalBpsClass = seasonalBps >= 0 ? 'positive' : 'negative';
            const bhBpsClass = bhBps >= 0 ? 'positive' : 'negative';
            const edgeBpsClass = edgeBps >= 0 ? 'positive' : 'negative';
            const edgeBpsSign = edgeBps >= 0 ? '+' : '-';
            
            // Store years for backtest
            window.backtestYears = years;
            
            // Show the strategy action buttons
            document.getElementById('strategy-actions').style.display = 'flex';
            
            summary.innerHTML = `
                <table>
                    <tr>
                        <td class="label">Seasonal</td>
                        <td>${sum.avg_days} days</td>
                        <td class="${profitClass}">${profitSign}${Math.abs(sum.avg_profit).toFixed(1)}%</td>
                        <td class="${seasonalBpsClass}">${Math.abs(seasonalBps).toFixed(1)} bps/day</td>
                    </tr>
                    <tr>
                        <td class="label">B&H</td>
                        <td>365 days</td>
                        <td class="${bhClass}">${bhSign}${Math.abs(sum.bh_profit).toFixed(1)}%</td>
                        <td class="${bhBpsClass}">${Math.abs(bhBps).toFixed(1)} bps/day</td>
                    </tr>
                    <tr>
                        <td class="label">Edge</td>
                        <td></td>
                        <td></td>
                        <td class="${edgeBpsClass}">${edgeBpsSign}${Math.abs(edgeBps).toFixed(1)} bps/day</td>
                    </tr>
                </table>
            `;
        }
        
        function exportCSV(type) {
            // Export not available in window mode
            setStatus('Export not available in window mode', true);
        }
        
        function showSpinner() {
            spinner.classList.add('show');
            loadBtn.disabled = true;
        }
        
        function hideSpinner() {
            spinner.classList.remove('show');
            loadBtn.disabled = false;
        }
        
        function setStatus(msg, isError = false) {
            status.textContent = msg;
            status.classList.toggle('error', isError);
        }
        
        // Multi-select functionality
        const multiOverlay = document.getElementById('multi-overlay');
        const multiSearchInput = document.getElementById('multi-search-input');
        const multiList = document.getElementById('multi-list');
        const multiChips = document.getElementById('multi-chips');
        const multiSelected = document.getElementById('multi-selected');
        const multiCount = document.getElementById('multi-count');
        
        let selectedSymbols = [];  // Array of {symbol, name}
        let multiSearchResults = [];
        
        // Open multi-select overlay
        document.getElementById('multi-btn').addEventListener('click', () => {
            // Parse current symbols from input
            const currentSymbols = symbolInput.value.split(',').map(s => s.trim().toUpperCase()).filter(s => s);
            selectedSymbols = currentSymbols.map(s => ({ symbol: s, name: '' }));
            openMultiOverlay();
        });
        
        // Close buttons
        document.getElementById('multi-close-btn').addEventListener('click', closeMultiOverlay);
        document.getElementById('multi-cancel-btn').addEventListener('click', closeMultiOverlay);
        
        // Clear all
        document.getElementById('multi-clear-btn').addEventListener('click', () => {
            selectedSymbols = [];
            updateMultiUI();
            renderMultiList(multiSearchResults);
        });
        
        // Apply selection
        document.getElementById('multi-apply-btn').addEventListener('click', () => {
            if (selectedSymbols.length > 0) {
                symbolInput.value = selectedSymbols.map(s => displaySymbol(s.symbol)).join(',');
                state.symbol = selectedSymbols.map(s => s.symbol).join(',');
            }
            closeMultiOverlay();
            loadData();
        });
        
        // Search input
        multiSearchInput.addEventListener('input', async (e) => {
            const query = e.target.value.trim();
            if (query.length < 1) {
                multiSearchResults = [];
                renderMultiList([]);
                return;
            }
            
            try {
                const res = await fetch(`/api/symbols?q=${encodeURIComponent(query)}`);
                const data = await res.json();
                multiSearchResults = data;
                renderMultiList(data);
            } catch (err) {
                multiSearchResults = [];
                renderMultiList([]);
            }
        });
        
        // Click outside to close
        multiOverlay.addEventListener('click', (e) => {
            if (e.target === multiOverlay) {
                closeMultiOverlay();
            }
        });
        
        function openMultiOverlay() {
            multiSearchInput.value = '';
            multiSearchResults = [];
            updateMultiUI();
            renderMultiList([]);
            multiOverlay.classList.add('show');
            multiSearchInput.focus();
        }
        
        function closeMultiOverlay() {
            multiOverlay.classList.remove('show');
        }
        
        function updateMultiUI() {
            // Update count
            multiCount.textContent = `${selectedSymbols.length}/5 selected`;
            
            // Update chips
            if (selectedSymbols.length > 0) {
                multiSelected.classList.add('show');
                multiChips.innerHTML = selectedSymbols.map(s => `
                    <div class="multi-chip">
                        <span>${displaySymbol(s.symbol)}</span>
                        <span class="remove" data-symbol="${s.symbol}">&times;</span>
                    </div>
                `).join('');
                
                // Add remove handlers
                multiChips.querySelectorAll('.remove').forEach(el => {
                    el.addEventListener('click', (e) => {
                        const sym = e.target.dataset.symbol;
                        selectedSymbols = selectedSymbols.filter(s => s.symbol !== sym);
                        updateMultiUI();
                        renderMultiList(multiSearchResults);
                    });
                });
            } else {
                multiSelected.classList.remove('show');
                multiChips.innerHTML = '';
            }
        }
        
        function renderMultiList(items) {
            // Filter out already selected from search results
            const selectedSymbolSet = new Set(selectedSymbols.map(s => s.symbol));
            const unselectedItems = items.filter(item => !selectedSymbolSet.has(item.symbol));
            
            // Build list: only show unselected items (selected shown as chips above)
            let html = '';
            
            // Show search results (excluding selected)
            unselectedItems.forEach(item => {
                const disabled = selectedSymbols.length >= 5 ? 'disabled' : '';
                html += `
                    <div class="multi-item ${disabled}" data-symbol="${item.symbol}" data-name="${item.name}">
                        <input type="checkbox" ${disabled}>
                        <span class="symbol">${displaySymbol(item.symbol)}</span>
                        <span class="name">${item.name}</span>
                    </div>
                `;
            });
            
            if (html === '' && items.length === 0) {
                const msg = selectedSymbols.length > 0 
                    ? 'Type to search and add more stocks...'
                    : 'Type to search for stocks, indices, or ETFs...';
                multiList.innerHTML = `<div style="padding: 16px; color: #666;">${msg}</div>`;
            } else if (html === '' && items.length > 0) {
                multiList.innerHTML = '<div style="padding: 16px; color: #666;">All results already selected</div>';
            } else {
                multiList.innerHTML = html;
            }
            
            // Add click handlers
            multiList.querySelectorAll('.multi-item').forEach(el => {
                el.addEventListener('click', (e) => {
                    if (el.classList.contains('disabled')) return;
                    
                    const symbol = el.dataset.symbol;
                    const name = el.dataset.name;
                    
                    // Select (if under limit)
                    if (selectedSymbols.length < 5) {
                        selectedSymbols.push({ symbol, name });
                        updateMultiUI();
                        renderMultiList(multiSearchResults);
                    }
                });
            });
        }
        
        // =====================
        // Backtest functionality
        // =====================
        const backtestOverlay = document.getElementById('backtest-overlay');
        const backtestYearSelect = document.getElementById('backtest-year-select');
        const backtestCapitalSelect = document.getElementById('backtest-capital-select');
        const backtestChart = document.getElementById('backtest-chart');
        const backtestMetrics = document.getElementById('backtest-metrics');
        const backtestTitle = document.getElementById('backtest-title');
        
        document.getElementById('backtest-close-btn').addEventListener('click', closeBacktest);
        backtestOverlay.addEventListener('click', (e) => {
            if (e.target === backtestOverlay) closeBacktest();
        });
        
        backtestYearSelect.addEventListener('change', loadBacktestData);
        backtestCapitalSelect.addEventListener('change', loadBacktestData);
        
        function showBacktest() {
            // Backtest not available in window mode
            setStatus('Backtest not available in window mode', true);
        }
        
        function closeBacktest() {
            backtestOverlay.classList.remove('show');
        }
        
        async function loadBacktestData() {
            // Disabled in window mode
        }
        
        function renderBacktestChart(data, capital) {
            const { seasonal_curve, bh_curve, trades, dates } = data;
            
            // Chart dimensions
            const container = backtestChart.getBoundingClientRect();
            const width = container.width - 40;
            const height = container.height - 40;
            const padding = { top: 30, right: 60, bottom: 40, left: 70 };
            const chartWidth = width - padding.left - padding.right;
            const chartHeight = height - padding.top - padding.bottom;
            
            // Scale profit percentages to actual P&L
            const seasonalPnL = seasonal_curve.map(p => (p / 100) * capital);
            const bhPnL = bh_curve.map(p => (p / 100) * capital);
            
            // Find min/max for Y axis - scale to fit actual data with 10% padding
            const allValues = [...seasonalPnL, ...bhPnL];
            const dataMin = Math.min(...allValues, 0);  // Always include 0
            const dataMax = Math.max(...allValues, 0);
            const range = dataMax - dataMin || 1;
            const yMin = dataMin - range * 0.1;
            const yMax = dataMax + range * 0.1;
            
            // X scale
            const xScale = (i) => padding.left + (i / (dates.length - 1)) * chartWidth;
            
            // Y scale
            const yScale = (v) => padding.top + chartHeight - ((v - yMin) / (yMax - yMin)) * chartHeight;
            
            // Build SVG path
            function buildPath(values) {
                return values.map((v, i) => 
                    `${i === 0 ? 'M' : 'L'} ${xScale(i).toFixed(1)} ${yScale(v).toFixed(1)}`
                ).join(' ');
            }
            
            // Generate Y axis ticks - smart step sizing
            const yTicks = [];
            const yRange = yMax - yMin;
            // Choose step based on range magnitude
            let yStep;
            if (yRange >= 500000) yStep = 100000;
            else if (yRange >= 200000) yStep = 50000;
            else if (yRange >= 100000) yStep = 25000;
            else if (yRange >= 50000) yStep = 10000;
            else if (yRange >= 20000) yStep = 5000;
            else if (yRange >= 10000) yStep = 2000;
            else if (yRange >= 5000) yStep = 1000;
            else yStep = Math.ceil(yRange / 8 / 100) * 100 || 500;
            
            for (let v = Math.ceil(yMin / yStep) * yStep; v <= yMax; v += yStep) {
                yTicks.push(v);
            }
            
            // Generate X axis ticks (monthly) - show all months
            const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const xTicks = [];
            const monthFirstIdx = {};  // Track first occurrence of each month
            dates.forEach((d, i) => {
                const [m, day] = d.split('-');
                if (!(m in monthFirstIdx)) {
                    monthFirstIdx[m] = i;
                    xTicks.push({ i, label: m });
                }
            });
            
            // Check if there are any wraparound trades - if so, add Jan+ at the end
            let hasWraparound = false;
            trades.forEach(trade => {
                const entryMonth = trade.entry_date.split('-')[0];
                const exitMonth = trade.exit_date.split('-')[0];
                if (monthLabels.indexOf(exitMonth) < monthLabels.indexOf(entryMonth)) {
                    hasWraparound = true;
                }
            });
            if (hasWraparound) {
                xTicks.push({ i: dates.length - 1, label: 'Jan+', isWraparound: true });
            }
            
            // Build trade markers and investment bands
            // Helper to find nearest trading day index for a date like "Mar-6"
            function findNearestDateIdx(targetDate) {
                // First try exact match
                let idx = dates.findIndex(d => d === targetDate);
                if (idx >= 0) return idx;
                
                // Parse target date
                const [targetMonth, targetDay] = targetDate.split('-');
                const monthOrder = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                const targetMonthIdx = monthOrder.indexOf(targetMonth);
                const targetDayNum = parseInt(targetDay);
                
                // Find closest date on or after target
                for (let i = 0; i < dates.length; i++) {
                    const [m, d] = dates[i].split('-');
                    const mIdx = monthOrder.indexOf(m);
                    const dNum = parseInt(d);
                    if (mIdx > targetMonthIdx || (mIdx === targetMonthIdx && dNum >= targetDayNum)) {
                        return i;
                    }
                }
                return dates.length - 1;  // fallback to last date
            }
            
            let tradeMarkers = '';
            let investmentBands = '';
            trades.forEach(trade => {
                const entryIdx = findNearestDateIdx(trade.entry_date);
                let exitIdx = findNearestDateIdx(trade.exit_date);
                
                // Check for wraparound trade (exit month before entry month = next year)
                const monthOrder = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                const entryMonth = trade.entry_date.split('-')[0];
                const exitMonth = trade.exit_date.split('-')[0];
                const isWraparound = monthOrder.indexOf(exitMonth) < monthOrder.indexOf(entryMonth);
                
                // For wraparound trades, extend to end of year
                if (isWraparound) {
                    exitIdx = dates.length - 1;
                }
                
                if (entryIdx >= 0 && exitIdx >= 0 && exitIdx > entryIdx) {
                    const x1 = xScale(entryIdx);
                    const x2 = xScale(exitIdx);
                    const bandWidth = x2 - x1;
                    
                    // Calculate return for this trade period
                    const entryValue = seasonalPnL[entryIdx];
                    const exitValue = seasonalPnL[exitIdx];
                    const tradeReturn = exitValue - entryValue;
                    const tradeReturnPct = (tradeReturn / capital) * 100;
                    const isProfit = tradeReturn >= 0;
                    
                    // Band color based on profit/loss
                    const bandColor = isProfit ? '#00ff88' : '#ff4466';
                    const textColor = isProfit ? '#00cc66' : '#cc3355';
                    
                    // Labels at bottom for profit, top for loss
                    const labelY = isProfit ? (padding.top + chartHeight - 8) : (padding.top + 16);
                    const pctY = isProfit ? (padding.top + chartHeight - 22) : (padding.top + 30);
                    
                    // Draw investment band
                    investmentBands += `<rect x="${x1}" y="${padding.top}" width="${bandWidth}" height="${chartHeight}" fill="${bandColor}" opacity="0.12"/>`;
                    
                    // BUY label on left side of band
                    tradeMarkers += `<text x="${x1 + 3}" y="${labelY}" fill="${textColor}" font-size="9" font-weight="bold" text-anchor="start">BUY</text>`;
                    
                    // SELL label on right side of band (show exit date for wraparound)
                    const sellLabel = isWraparound ? `SELL ${trade.exit_date}` : 'SELL';
                    tradeMarkers += `<text x="${x2 - 3}" y="${labelY}" fill="${textColor}" font-size="9" font-weight="bold" text-anchor="end">${sellLabel}</text>`;
                    
                    // Percentage in the middle
                    const pctText = (tradeReturnPct >= 0 ? '+' : '') + tradeReturnPct.toFixed(1) + '%';
                    const midX = (x1 + x2) / 2;
                    tradeMarkers += `<text x="${midX}" y="${pctY}" fill="${textColor}" font-size="10" font-weight="bold" text-anchor="middle">${pctText}</text>`;
                }
            });
            
            // Format currency
            const formatCurrency = (v) => {
                const abs = Math.abs(v);
                const sign = v < 0 ? '-' : (v > 0 ? '+' : '');
                if (abs >= 100000) return sign + '₹' + (abs / 100000).toFixed(1) + 'L';
                if (abs >= 1000) return sign + '₹' + (abs / 1000).toFixed(0) + 'K';
                return sign + '₹' + abs.toFixed(0);
            };
            
            const svg = `
                <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
                    <!-- Investment bands (behind everything) -->
                    ${investmentBands}
                    
                    <!-- Vertical grid lines (monthly) -->
                    ${xTicks.map(t => `
                        <line x1="${xScale(t.i)}" y1="${padding.top}" x2="${xScale(t.i)}" y2="${padding.top + chartHeight}" 
                              stroke="#444" stroke-width="0.5" opacity="0.5"/>
                    `).join('')}
                    
                    <!-- Horizontal grid lines -->
                    ${yTicks.map(v => `
                        <line x1="${padding.left}" y1="${yScale(v)}" x2="${width - padding.right}" y2="${yScale(v)}" 
                              stroke="${v === 0 ? '#666' : '#333'}" stroke-width="${v === 0 ? 2 : 1}"/>
                    `).join('')}
                    
                    <!-- Y axis labels -->
                    ${yTicks.map(v => `
                        <text x="${padding.left - 10}" y="${yScale(v) + 4}" fill="#888" font-size="11" text-anchor="end">
                            ${formatCurrency(v)}
                        </text>
                    `).join('')}
                    
                    <!-- X axis labels -->
                    ${xTicks.map(t => `
                        <text x="${xScale(t.i)}" y="${height - padding.bottom + 20}" fill="#888" font-size="11" text-anchor="middle">
                            ${t.label}
                        </text>
                    `).join('')}
                    
                    <!-- Buy & Hold line -->
                    <path d="${buildPath(bhPnL)}" fill="none" stroke="#6699ff" stroke-width="1.25" opacity="0.8"/>
                    
                    <!-- Seasonal strategy line -->
                    <path d="${buildPath(seasonalPnL)}" fill="none" stroke="#00ff88" stroke-width="1.25"/>
                    
                    <!-- Trade markers -->
                    ${tradeMarkers}
                    
                    <!-- Final values -->
                    <text x="${width - padding.right + 5}" y="${yScale(seasonalPnL[seasonalPnL.length - 1]) + 4}" 
                          fill="#00ff88" font-size="12" font-weight="bold">
                        ${formatCurrency(seasonalPnL[seasonalPnL.length - 1])}
                    </text>
                    <text x="${width - padding.right + 5}" y="${yScale(bhPnL[bhPnL.length - 1]) + 4}" 
                          fill="#6699ff" font-size="12">
                        ${formatCurrency(bhPnL[bhPnL.length - 1])}
                    </text>
                </svg>
            `;
            
            backtestChart.innerHTML = svg;
            
            // Update metrics
            const finalSeasonal = seasonalPnL[seasonalPnL.length - 1];
            const finalBH = bhPnL[bhPnL.length - 1];
            const maxDrawdown = Math.min(...seasonalPnL);
            const daysInMarket = trades.reduce((sum, t) => sum + t.days, 0);
            const warning = data.warning || null;
            
            backtestMetrics.innerHTML = `
                ${warning ? `<div class="backtest-warning">${warning}</div>` : ''}
                <div class="backtest-metric">
                    <span class="label">Seasonal P&L:</span>
                    <span class="${finalSeasonal >= 0 ? 'positive' : 'negative'}">${formatCurrency(finalSeasonal)}</span>
                </div>
                <div class="backtest-metric">
                    <span class="label">B&H P&L:</span>
                    <span class="${finalBH >= 0 ? 'positive' : 'negative'}">${formatCurrency(finalBH)}</span>
                </div>
                <div class="backtest-metric">
                    <span class="label">Max Drawdown:</span>
                    <span class="${maxDrawdown >= 0 ? 'positive' : 'negative'}">${formatCurrency(maxDrawdown)}</span>
                </div>
                <div class="backtest-metric">
                    <span class="label">Days in Market:</span>
                    <span>${daysInMarket} / 365</span>
                </div>
                <div class="backtest-metric">
                    <span class="label">Trades:</span>
                    <span>${trades.length}</span>
                </div>
            `;
        }
        
        // =====================
        // Basket Builder functionality
        // =====================
        const basketOverlay = document.getElementById('basket-overlay');
        const basketStrategiesList = document.getElementById('basket-strategies-list');
        const basketStrategyCount = document.getElementById('basket-strategy-count');
        const basketYearSelect = document.getElementById('basket-year-select');
        const basketCapitalSelect = document.getElementById('basket-capital-select');
        const basketAllocSelect = document.getElementById('basket-alloc-select');
        const basketYearsShow = document.getElementById('basket-years-show');
        const basketFeesInput = document.getElementById('basket-fees-input');
        const basketTaxInput = document.getElementById('basket-tax-input');
        const basketChart = document.getElementById('basket-chart');
        const basketMetrics = document.getElementById('basket-metrics');
        const basketBadge = document.getElementById('basket-badge');
        const showBasketBtn = document.getElementById('show-basket-btn');
        
        // Double-buffer references for flicker-free basket chart rendering
        const basketBuffer0 = document.getElementById('basket-buffer-0');
        const basketBuffer1 = document.getElementById('basket-buffer-1');
        let basketActiveBuffer = 0;  // 0 = buffer-0 is front (visible), 1 = buffer-1 is front
        
        // Get the currently hidden (back) buffer for rendering
        function getBasketBackBuffer() {
            return basketActiveBuffer === 0 ? basketBuffer1 : basketBuffer0;
        }
        
        // Get the currently visible (front) buffer
        function getBasketFrontBuffer() {
            return basketActiveBuffer === 0 ? basketBuffer0 : basketBuffer1;
        }
        
        // Swap buffers: make back buffer visible, hide current front buffer
        function swapBasketBuffers() {
            const front = getBasketFrontBuffer();
            const back = getBasketBackBuffer();
            front.classList.add('back');
            back.classList.remove('back');
            basketActiveBuffer = 1 - basketActiveBuffer;
        }
        
        // 16-color golden angle palette: maximally distinct hues at HSL(h, 75%, 60%)
        const BASKET_COLORS = [
            '#e5994c', '#4ce5c5', '#e54cd8', '#ace54c',
            '#4c7fe5', '#e54c52', '#4ce572', '#9f4ce5',
            '#e5cc4c', '#4cd2e5', '#e54ca5', '#78e54c',
            '#4c4ce5', '#e5794c', '#4ce5a6', '#d24ce5'
        ];
        
        // Get the next available color from the palette not already used in the basket
        function getNextBasketColor(basket) {
            const usedColors = new Set(basket.map(s => s.color).filter(Boolean));
            for (let i = 0; i < BASKET_COLORS.length; i++) {
                if (!usedColors.has(BASKET_COLORS[i])) return BASKET_COLORS[i];
            }
            // All 16 used — wrap around
            return BASKET_COLORS[basket.length % BASKET_COLORS.length];
        }
        
        // Ensure every strategy in the basket has a color assigned
        function ensureBasketColors(basket) {
            let changed = false;
            basket.forEach(s => {
                if (!s.color) {
                    s.color = getNextBasketColor(basket);
                    changed = true;
                }
            });
            return changed;
        }
        
        // Build a symbol-to-color map from the current basket
        function buildBasketColorMap() {
            const basket = loadBasket();
            const map = {};
            basket.forEach(s => {
                if (s.color && !map[s.symbol]) map[s.symbol] = s.color;
            });
            return map;
        }
        
        function shuffleColors() {
            const basket = loadBasket();
            if (basket.length === 0) return;
            const offset = Math.floor(Math.random() * BASKET_COLORS.length);
            basket.forEach((s, i) => {
                s.color = BASKET_COLORS[(offset + i) % BASKET_COLORS.length];
            });
            saveBasket(basket);
            renderBasketStrategies();
            if (state.basketBarMode && state.basketBarData) {
                renderBasketBarChart(state.basketBarData);
            } else if (state.lastBasketData) {
                const capital = parseInt(basketCapitalSelect.value) || 100000;
                renderBasketChart(state.lastBasketData, capital);
            }
        }
        
        // Load basket from localStorage
        function loadBasket() {
            const saved = localStorage.getItem('meguru_basket');
            const basket = saved ? JSON.parse(saved) : [];
            // Ensure all strategies have colors (backward compat)
            if (ensureBasketColors(basket)) {
                localStorage.setItem('meguru_basket', JSON.stringify(basket));
            }
            return basket;
        }
        
        // Save basket to localStorage
        function saveBasket(basket) {
            localStorage.setItem('meguru_basket', JSON.stringify(basket));
            updateBasketBadge();
        }
        
        // Update the badge count in header
        function updateBasketBadge() {
            const basket = loadBasket();
            if (basket.length > 0) {
                basketBadge.textContent = basket.length;
                basketBadge.style.display = 'inline';
                showBasketBtn.classList.add('has-items');
            } else {
                basketBadge.style.display = 'none';
                showBasketBtn.classList.remove('has-items');
            }
        }
        
        // Add current strategy to basket
        function addToBasket() {
            if (!state.symbol) {
                setStatus('No symbol loaded', true);
                return;
            }
            
            const basket = loadBasket();
            
            // Check for duplicate
            const isDuplicate = basket.some(s => 
                s.symbol === state.symbol && 
                s.window_size === state.windowSize && 
                s.threshold === state.threshold
            );
            
            if (isDuplicate) {
                setStatus('Strategy already in basket', true);
                return;
            }
            
            basket.push({
                symbol: state.symbol,
                window_size: state.windowSize,
                threshold: state.threshold,
                color: getNextBasketColor(basket),
            });
            
            saveBasket(basket);
            state.basketWeights = null; // invalidate cached weights
            setStatus(`Added ${displaySymbol(state.symbol)} to basket (${basket.length} strateg${basket.length === 1 ? 'y' : 'ies'})`);
        }
        
        // Show basket impact in single-stock bar chart view
        async function updateBasketImpact() {
            const impactDiv = document.getElementById('basket-impact');
            if (!impactDiv) return;
            
            const basket = loadBasket();
            if (basket.length === 0) {
                impactDiv.innerHTML = '<span class="label">Basket Impact:</span><span style="color:#666">No basket yet</span>';
                return;
            }
            
            // Check if current stock (with same params) is already in basket
            const isInBasket = basket.some(s => 
                s.symbol === state.symbol && 
                s.window_size === state.windowSize && 
                s.threshold === state.threshold
            );
            
            if (isInBasket) {
                impactDiv.innerHTML = '<span class="label">Basket Impact:</span><span style="color:#888">Already in basket</span>';
                return;
            }
            
            impactDiv.innerHTML = '<span class="label">Basket Impact:</span><span style="color:#888">Computing...</span>';
            
            try {
                // Fetch baseline basket metrics
                const baseParams = new URLSearchParams({
                    strategies: JSON.stringify(basket),
                });
                const baseRes = await fetch('/api/basket/bar?' + baseParams);
                const baseData = await baseRes.json();
                if (baseData.error) {
                    impactDiv.innerHTML = '<span class="label">Basket Impact:</span><span style="color:#666">-</span>';
                    return;
                }
                
                // Create hypothetical basket with current stock added
                const hypotheticalBasket = [...basket, {
                    symbol: state.symbol,
                    window_size: state.windowSize,
                    threshold: state.threshold,
                }];
                const hypParams = new URLSearchParams({
                    strategies: JSON.stringify(hypotheticalBasket),
                });
                const hypRes = await fetch('/api/basket/bar?' + hypParams);
                const hypData = await hypRes.json();
                if (hypData.error) {
                    impactDiv.innerHTML = '<span class="label">Basket Impact:</span><span style="color:#666">-</span>';
                    return;
                }
                
                // Compute deltas
                const baseYears = baseData.years || [];
                const hypYears = hypData.years || [];
                const baseAvgReturn = baseYears.length > 0 ? baseYears.reduce((s, d) => s + d.combined_return, 0) / baseYears.length : 0;
                const hypAvgReturn = hypYears.length > 0 ? hypYears.reduce((s, d) => s + d.combined_return, 0) / hypYears.length : 0;
                const baseSharpe = baseData.sharpe_ratio;
                const hypSharpe = hypData.sharpe_ratio;
                
                const returnDelta = hypAvgReturn - baseAvgReturn;
                const sharpeDelta = (hypSharpe != null && baseSharpe != null) ? hypSharpe - baseSharpe : null;
                
                // Format output
                const returnSign = returnDelta >= 0 ? '+' : '';
                const returnColor = returnDelta >= 0 ? '#44ff88' : '#ff4466';
                const sharpeSign = sharpeDelta != null && sharpeDelta >= 0 ? '+' : '';
                const sharpeColor = sharpeDelta != null ? (sharpeDelta >= 0 ? '#44ff88' : '#ff4466') : '#888';
                
                let html = '<span class="label">Basket Impact:</span>';
                html += '<span style="color:' + returnColor + '">' + returnSign + returnDelta.toFixed(1) + '% return</span>';
                if (sharpeDelta != null) {
                    html += '<span style="margin-left:8px;color:' + sharpeColor + '">' + sharpeSign + sharpeDelta.toFixed(2) + ' Sharpe</span>';
                }
                impactDiv.innerHTML = html;
            } catch (err) {
                impactDiv.innerHTML = '<span class="label">Basket Impact:</span><span style="color:#666">-</span>';
            }
        }
        
        // Remove strategy from basket
        function removeFromBasket(index) {
            const basket = loadBasket();
            basket.splice(index, 1);
            saveBasket(basket);
            state.basketWeights = null; // invalidate cached weights
            renderBasketStrategies();
            const visible = getVisibleBasket();
            if (visible.length > 0) {
                if (state.basketBarMode) {
                    loadBasketBarChart();
                } else {
                    loadBasketBacktest();
                }
            } else if (basket.length > 0) {
                getBasketFrontBuffer().innerHTML = '<div style="padding: 20px; color: #666; text-align: center;">All strategies hidden</div>';
                basketMetrics.innerHTML = '';
            } else {
                getBasketFrontBuffer().innerHTML = '<div style="padding: 20px; color: #666; text-align: center;">Add strategies to see combined backtest</div>';
                basketMetrics.innerHTML = '';
            }
        }
        
        // Open basket overlay
        function openBasketOverlay() {
            renderBasketStrategies();
            populateBasketYears();
            basketOverlay.classList.add('show');
            if (getVisibleBasket().length > 0) {
                if (state.basketBarMode) {
                    loadBasketBarChart();
                } else {
                    loadBasketBacktest();
                }
            }
        }
        
        // Close basket overlay
        function closeBasketOverlay() {
            basketOverlay.classList.remove('show');
        }
        
        // Resize observer: redraw basket chart on container resize (e.g. zoom)
        let basketResizeTimer = null;
        const basketResizeObserver = new ResizeObserver(() => {
            if (!basketOverlay.classList.contains('show')) return;
            clearTimeout(basketResizeTimer);
            basketResizeTimer = setTimeout(() => {
                if (getVisibleBasket().length > 0) {
                    if (state.basketBarMode) {
                        if (state.basketBarData) renderBasketBarChart(state.basketBarData);
                    } else {
                        if (state.lastBasketData) renderBasketChart(state.lastBasketData, parseInt(basketCapitalSelect.value));
                    }
                }
            }, 150);
        });
        basketResizeObserver.observe(basketChart);
        
        // Get basket filtered to only visible (non-hidden) strategies
        function getVisibleBasket() {
            const basket = loadBasket();
            return basket.filter((_, idx) => !state.hiddenStrategies.has(idx));
        }
        
        // Render strategy list
        function renderBasketStrategies() {
            const basket = loadBasket();
            const visibleCount = basket.length - state.hiddenStrategies.size;
            basketStrategyCount.textContent = `${visibleCount}/${basket.length} strateg${basket.length === 1 ? 'y' : 'ies'}`;
            
            if (basket.length === 0) {
                basketStrategiesList.innerHTML = '<div class="basket-empty">No strategies added yet. Analyze a stock and click "Add to Basket".</div>';
                return;
            }
            
            // Clean up hidden indices that are out of range
            state.hiddenStrategies.forEach(idx => {
                if (idx >= basket.length) state.hiddenStrategies.delete(idx);
            });
            
            basketStrategiesList.innerHTML = basket.map((s, idx) => {
                const isHidden = state.hiddenStrategies.has(idx);
                const color = s.color || '#888';
                // Compute avg return from bar data if available
                let avgReturnHTML = '';
                if (state.basketBarData && state.basketBarData.years) {
                    const sym = s.symbol;
                    const yrs = state.basketBarData.years;
                    const returns = yrs.map(d => d.stock_returns && d.stock_returns[sym] != null ? d.stock_returns[sym] : null).filter(v => v != null);
                    if (returns.length > 0) {
                        const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
                        const valColor = avg >= 0 ? '#44ff88' : '#ff4466';
                        avgReturnHTML = '<span style="color:' + valColor + ';font-weight:600;font-size:11px;margin-left:6px">' + avg.toFixed(1) + '%</span>';
                    }
                }
                return '<div class="basket-strategy-item' + (isHidden ? ' strategy-hidden' : '') + '" data-index="' + idx + '">' +
                    '<div class="basket-strategy-info" title="' + s.window_size + 'd window | ' + s.threshold + '% threshold">' +
                        '<div class="basket-strategy-symbol"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + color + ';margin-right:5px;vertical-align:middle"></span>' + displaySymbol(s.symbol) + avgReturnHTML + '</div>' +
                    '</div>' +
                    '<div class="basket-strategy-actions">' +
                        '<div class="basket-strategy-hide' + (isHidden ? ' is-hidden' : '') + '" data-index="' + idx + '" title="' + (isHidden ? 'Show in chart' : 'Hide from chart') + '">' + (isHidden ? 'show' : 'hide') + '</div>' +
                        '<div class="basket-strategy-remove" data-index="' + idx + '">\u2715</div>' +
                    '</div>' +
                '</div>';
            }).join('');
            
            // Add remove handlers
            basketStrategiesList.querySelectorAll('.basket-strategy-remove').forEach(el => {
                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const idx = parseInt(el.dataset.index);
                    // Adjust hidden indices after removal
                    const newHidden = new Set();
                    state.hiddenStrategies.forEach(h => {
                        if (h < idx) newHidden.add(h);
                        else if (h > idx) newHidden.add(h - 1);
                        // h === idx: removed, skip
                    });
                    state.hiddenStrategies = newHidden;
                    removeFromBasket(idx);
                });
            });
            
            // Add hide/show handlers
            basketStrategiesList.querySelectorAll('.basket-strategy-hide').forEach(el => {
                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const idx = parseInt(el.dataset.index);
                    if (state.hiddenStrategies.has(idx)) {
                        state.hiddenStrategies.delete(idx);
                    } else {
                        state.hiddenStrategies.add(idx);
                    }
                    state.basketWeights = null; // invalidate cached weights
                    renderBasketStrategies();
                    const visibleBasket = getVisibleBasket();
                    if (visibleBasket.length > 0) {
                        if (state.basketBarMode) {
                            loadBasketBarChart();
                        } else {
                            loadBasketBacktest();
                        }
                    } else {
                        getBasketFrontBuffer().innerHTML = '<div style="padding: 20px; color: #666; text-align: center;">All strategies hidden</div>';
                        basketMetrics.innerHTML = '';
                    }
                });
            });
        }
        
        // Populate year dropdown with available years
        function populateBasketYears() {
            // Use years from last loaded data, or generate recent years
            const years = window.backtestYears || [];
            if (years.length === 0) {
                const currentYear = new Date().getFullYear();
                for (let y = currentYear - 1; y >= currentYear - 20; y--) {
                    years.push(y);
                }
            }
            
            basketYearSelect.innerHTML = '<option value="avg">Average</option>' + years.slice().reverse().map(y => 
                `<option value="${y}">${y}</option>`
            ).join('');
        }
        
        // Compute return-weighted allocation weights from bar chart data.
        // Fetches equal-weight bar data, computes per-symbol avg return,
        // clamps negatives to a minimum floor, normalizes to sum=1.
        async function computeReturnWeights() {
            const basket = getVisibleBasket();
            if (basket.length === 0) return null;
            try {
                const params = new URLSearchParams({
                    strategies: JSON.stringify(basket),
                });
                const res = await fetch('/api/basket/bar?' + params);
                const data = await res.json();
                if (data.error || !data.years || data.years.length === 0) return null;
                
                const symbols = data.symbols || [];
                const n = data.years.length;
                const MIN_WEIGHT = 0.05; // 5% floor for negative-return strategies
                
                // Compute per-symbol average return
                const avgReturns = {};
                symbols.forEach(sym => {
                    const total = data.years.reduce((s, d) => s + (d.stock_returns[sym] || 0), 0);
                    avgReturns[sym] = total / n;
                });
                
                // Clamp negatives to floor, use raw positive values
                const rawWeights = {};
                symbols.forEach(sym => {
                    rawWeights[sym] = avgReturns[sym] > 0 ? avgReturns[sym] : MIN_WEIGHT;
                });
                
                // Normalize to sum = 1
                const totalWeight = Object.values(rawWeights).reduce((s, v) => s + v, 0);
                const weights = {};
                symbols.forEach(sym => {
                    weights[sym] = totalWeight > 0 ? rawWeights[sym] / totalWeight : 1 / symbols.length;
                });
                
                return weights;
            } catch (err) {
                return null;
            }
        }
        
        // Compute market-cap-weighted allocation.
        // Fetches market caps for all symbols in the basket, normalizes to sum=1.
        async function computeMarketCapWeights() {
            const basket = getVisibleBasket();
            if (basket.length === 0) return null;
            try {
                // Collect unique symbols (with .NS suffix for backend)
                const symSet = new Set();
                basket.forEach(s => symSet.add(s.symbol));
                const symbols = Array.from(symSet);

                const res = await fetch('/api/marketcap?symbols=' + encodeURIComponent(symbols.join(',')));
                const caps = await res.json();
                if (caps.error) return null;

                // Display symbols (strip .NS)
                const displaySyms = symbols.map(s => s.replace(/\.NS$/i, ''));

                // Use sqrt(mcap) to dampen extreme size differences
                const rawWeights = {};
                displaySyms.forEach(sym => {
                    const cap = caps[sym] || 0;
                    rawWeights[sym] = cap > 0 ? Math.sqrt(cap) : 0;
                });

                // If all are zero (indices or failures), fall back to equal
                const totalWeight = Object.values(rawWeights).reduce((s, v) => s + v, 0);
                if (totalWeight === 0) return null;

                const weights = {};
                displaySyms.forEach(sym => {
                    weights[sym] = rawWeights[sym] / totalWeight;
                });
                return weights;
            } catch (err) {
                return null;
            }
        }

        // Get current weights (null for equal, {sym: weight} for return-weighted or mkt-cap)
        async function getBasketWeights() {
            if (basketAllocSelect.value === 'equal') {
                state.basketWeights = null;
                return null;
            }
            // Compute if not cached
            if (!state.basketWeights) {
                if (basketAllocSelect.value === 'marketcap') {
                    state.basketWeights = await computeMarketCapWeights();
                } else {
                    state.basketWeights = await computeReturnWeights();
                }
            }
            return state.basketWeights;
        }
        
        // Load combined backtest for all strategies
        async function loadBasketBacktest() {
            const basket = getVisibleBasket();
            if (basket.length === 0) return;
            
            const yearVal = basketYearSelect.value;
            const capital = parseInt(basketCapitalSelect.value);
            
            if (!yearVal) return;
            
            // No "Loading..." text - previous chart stays visible (double-buffer)
            
            try {
                const weights = await getBasketWeights();
                const params = new URLSearchParams({
                    strategies: JSON.stringify(basket),
                    year: yearVal
                });
                if (weights) params.set('weights', JSON.stringify(weights));
                const fees = parseFloat(basketFeesInput.value) || 0;
                const tax = parseFloat(basketTaxInput.value) || 0;
                if (fees > 0) params.set('fees_pct', String(fees));
                if (tax > 0) params.set('tax_pct', String(tax));
                
                const res = await fetch(`/api/basket/backtest?${params}`);
                const data = await res.json();
                
                if (data.error) {
                    getBasketFrontBuffer().innerHTML = `<div style="color: #ff4466; padding: 20px;">${data.error}</div>`;
                    return;
                }
                
                state.lastBasketData = data;
                renderBasketChart(data, capital);
            } catch (err) {
                getBasketFrontBuffer().innerHTML = `<div style="color: #ff4466; padding: 20px;">Error: ${err.message}</div>`;
            }
        }
        
        // Render combined backtest chart
        function renderBasketChart(data, capital) {
            const { combined_curve, bh_curve, strategy_curves, trades_count, total_days, dates, trades } = data;
            const symbols = data.symbols || Object.keys(strategy_curves);
            
            // Build symbol-to-color map from basket colors
            const symbolColorMap = buildBasketColorMap();
            
            // Build per-strategy PnL arrays (needed for legend values)
            const combinedPnL = combined_curve.map(p => (p / 100) * capital);
            const bhPnL = bh_curve.map(p => (p / 100) * capital);
            const strategyPnLs = {};
            for (const sym of symbols) {
                if (strategy_curves[sym]) {
                    strategyPnLs[sym] = strategy_curves[sym].map(p => (p / 100) * capital);
                }
            }
            
            // Format currency helper
            const formatCurrency = (v) => {
                const abs = Math.abs(v);
                const sign = v < 0 ? '-' : (v > 0 ? '+' : '');
                if (abs >= 100000) return sign + '₹' + (abs / 100000).toFixed(1) + 'L';
                if (abs >= 1000) return sign + '₹' + (abs / 1000).toFixed(0) + 'K';
                return sign + '₹' + abs.toFixed(0);
            };
            
            // Chart dimensions
            const container = basketChart.getBoundingClientRect();
            const width = container.width - 32;
            const height = container.height - 20;
            const padding = { top: 30, right: 20, bottom: 40, left: 70 };
            const chartWidth = width - padding.left - padding.right;
            const chartHeight = height - padding.top - padding.bottom;
            
            // Find min/max for Y axis (include all visible curves)
            const allValues = [...bhPnL];
            // Always include combined
            allValues.push(...combinedPnL);
            for (const sym of symbols) {
                if (state.basketVisible[sym] !== false && strategyPnLs[sym]) {
                    allValues.push(...strategyPnLs[sym]);
                }
            }
            const dataMin = Math.min(...allValues, 0);
            const dataMax = Math.max(...allValues, 0);
            const range = dataMax - dataMin || 1;
            const yMin = dataMin - range * 0.1;
            const yMax = dataMax + range * 0.1;
            
            // X scale
            const xScale = (i) => padding.left + (i / (dates.length - 1)) * chartWidth;
            
            // Y scale
            const yScale = (v) => padding.top + chartHeight - ((v - yMin) / (yMax - yMin)) * chartHeight;
            
            // Build SVG path
            function buildPath(values) {
                return values.map((v, i) => 
                    `${i === 0 ? 'M' : 'L'} ${xScale(i).toFixed(1)} ${yScale(v).toFixed(1)}`
                ).join(' ');
            }
            
            // Helper to find nearest trading day index for a date like "Mar-6"
            function findNearestDateIdx(targetDate) {
                let idx = dates.findIndex(d => d === targetDate);
                if (idx >= 0) return idx;
                
                const [targetMonth, targetDay] = targetDate.split('-');
                const monthOrder = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                const targetMonthIdx = monthOrder.indexOf(targetMonth);
                const targetDayNum = parseInt(targetDay);
                
                for (let i = 0; i < dates.length; i++) {
                    const [m, d] = dates[i].split('-');
                    const mIdx = monthOrder.indexOf(m);
                    const dNum = parseInt(d);
                    if (mIdx > targetMonthIdx || (mIdx === targetMonthIdx && dNum >= targetDayNum)) {
                        return i;
                    }
                }
                return dates.length - 1;
            }
            
            // Build capital invested line (shows when money is in the market)
            const monthOrder = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            
            // Track which days have active trades (considering visibility)
            const investedDays = new Array(dates.length).fill(false);
            if (trades && trades.length > 0) {
                trades.forEach(trade => {
                    const sym = trade.symbol || '';
                    // Skip hidden strategies
                    if (state.basketVisible[sym] === false) return;
                    
                    const entryIdx = findNearestDateIdx(trade.entry_date);
                    let exitIdx = findNearestDateIdx(trade.exit_date);
                    
                    const entryMonth = trade.entry_date.split('-')[0];
                    const exitMonth = trade.exit_date.split('-')[0];
                    const isWraparound = monthOrder.indexOf(exitMonth) < monthOrder.indexOf(entryMonth);
                    
                    if (isWraparound) {
                        exitIdx = dates.length - 1;
                    }
                    
                    if (entryIdx >= 0 && exitIdx >= 0 && exitIdx > entryIdx) {
                        for (let i = entryIdx; i <= exitIdx; i++) {
                            investedDays[i] = true;
                        }
                    }
                });
            }
            
            // Build capital invested curve (0 when not invested, capital when invested)
            const capitalInvested = investedDays.map(invested => invested ? capital : 0);
            
            // Build step-line path for capital invested (stepped, not smooth)
            function buildStepPath(values) {
                if (values.length === 0) return '';
                let path = `M ${xScale(0).toFixed(1)} ${yScale(values[0]).toFixed(1)}`;
                for (let i = 1; i < values.length; i++) {
                    // Horizontal line to next x, then vertical to new y (step pattern)
                    path += ` H ${xScale(i).toFixed(1)} V ${yScale(values[i]).toFixed(1)}`;
                }
                return path;
            }
            
            // Generate Y axis ticks
            const yTicks = [];
            const yRange = yMax - yMin;
            let yStep;
            if (yRange >= 500000) yStep = 100000;
            else if (yRange >= 200000) yStep = 50000;
            else if (yRange >= 100000) yStep = 25000;
            else if (yRange >= 50000) yStep = 10000;
            else if (yRange >= 20000) yStep = 5000;
            else if (yRange >= 10000) yStep = 2000;
            else if (yRange >= 5000) yStep = 1000;
            else yStep = Math.ceil(yRange / 8 / 100) * 100 || 500;
            
            for (let v = Math.ceil(yMin / yStep) * yStep; v <= yMax; v += yStep) {
                yTicks.push(v);
            }
            
            // Generate X axis ticks (monthly)
            const xTicks = [];
            const monthFirstIdx = {};
            dates.forEach((d, i) => {
                const [m, day] = d.split('-');
                if (!(m in monthFirstIdx)) {
                    monthFirstIdx[m] = i;
                    xTicks.push({ i, label: m });
                }
            });
            
            // Check for wraparound trades
            let hasWraparound = false;
            if (trades) {
                trades.forEach(trade => {
                    const entryMonth = trade.entry_date.split('-')[0];
                    const exitMonth = trade.exit_date.split('-')[0];
                    if (monthOrder.indexOf(exitMonth) < monthOrder.indexOf(entryMonth)) {
                        hasWraparound = true;
                    }
                });
            }
            if (hasWraparound) {
                xTicks.push({ i: dates.length - 1, label: 'Jan+', isWraparound: true });
            }
            
            // Build per-strategy SVG lines
            let strategyLines = '';
            for (const sym of symbols) {
                if (state.basketVisible[sym] === false) continue;
                if (!strategyPnLs[sym]) continue;
                
                const color = symbolColorMap[sym] || '#888';
                const curve = strategyPnLs[sym];
                strategyLines += `<path d="${buildPath(curve)}" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.8"/>`;
            }
            
            const svg = `
                <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
                    <!-- Vertical grid lines (monthly) -->
                    ${xTicks.map(t => `
                        <line x1="${xScale(t.i)}" y1="${padding.top}" x2="${xScale(t.i)}" y2="${padding.top + chartHeight}" 
                              stroke="#444" stroke-width="0.5" opacity="0.5"/>
                    `).join('')}
                    
                    <!-- Horizontal grid lines -->
                    ${yTicks.map(v => `
                        <line x1="${padding.left}" y1="${yScale(v)}" x2="${width - padding.right}" y2="${yScale(v)}" 
                              stroke="${v === 0 ? '#666' : '#333'}" stroke-width="${v === 0 ? 2 : 1}"/>
                    `).join('')}
                    
                    <!-- Y axis labels -->
                    ${yTicks.map(v => `
                        <text x="${padding.left - 10}" y="${yScale(v) + 4}" fill="#888" font-size="11" text-anchor="end">
                            ${formatCurrency(v)}
                        </text>
                    `).join('')}
                    
                    <!-- X axis labels -->
                    ${xTicks.map(t => `
                        <text x="${xScale(t.i)}" y="${height - padding.bottom + 20}" fill="#888" font-size="11" text-anchor="middle">
                            ${t.label}
                        </text>
                    `).join('')}
                    
                    <!-- Capital invested line (gray, stepped) -->
                    <path d="${buildStepPath(capitalInvested)}" fill="none" stroke="#666" stroke-width="1" opacity="0.6"/>
                    
                    <!-- Buy & Hold line (blue, dashed) -->
                    <path d="${buildPath(bhPnL)}" fill="none" stroke="#6699ff" stroke-width="1.25" opacity="0.6" stroke-dasharray="4,3"/>
                    
                    <!-- Per-strategy lines -->
                    ${strategyLines}
                    
                    <!-- Combined strategy line (white) -->
                    <path d="${buildPath(combinedPnL)}" fill="none" stroke="#ffffff" stroke-width="2.5"/>
                    
                </svg>
            `;
            // Render to back buffer, then swap for flicker-free update
            const backBuffer = getBasketBackBuffer();
            backBuffer.innerHTML = svg;
            swapBasketBuffers();
            
            // Update metrics
            const finalCombined = combinedPnL[combinedPnL.length - 1];
            const finalBH = bhPnL[bhPnL.length - 1];
            const maxDrawdown = Math.min(...combinedPnL);
            const isAvg = data.avg_years != null;
            const pnlLabel = isAvg ? `Avg Combined P&L (${data.avg_years}y):` : 'Combined P&L:';
            const bhLabel = isAvg ? 'Avg EW B&H:' : 'EW B&H:';
            
            basketMetrics.innerHTML = `
                <div class="backtest-metric">
                    <span class="label">${pnlLabel}</span>
                    <span class="${finalCombined >= 0 ? 'positive' : 'negative'}">${formatCurrency(finalCombined)}</span>
                </div>
                <div class="backtest-metric">
                    <span class="label">${bhLabel}</span>
                    <span class="${finalBH >= 0 ? 'positive' : 'negative'}">${formatCurrency(finalBH)}</span>
                </div>
                <div class="backtest-metric">
                    <span class="label">Max Drawdown:</span>
                    <span class="${maxDrawdown >= 0 ? 'positive' : 'negative'}">${formatCurrency(maxDrawdown)}</span>
                </div>
                <div class="backtest-metric">
                    <span class="label">Total Days:</span>
                    <span>${total_days} / 365</span>
                </div>
                <div class="backtest-metric">
                    <span class="label">Trade Entries:</span>
                    <span>${trades_count}</span>
                </div>
            `;
        }
        
        // Basket bar/line toggle
        const basketLineBtn = document.getElementById('basket-line-btn');
        const basketBarBtn = document.getElementById('basket-bar-btn');
        
        function setBasketViewMode(barMode) {
            state.basketBarMode = barMode;
            basketLineBtn.classList.toggle('active', !barMode);
            basketBarBtn.classList.toggle('active', barMode);
            basketYearSelect.style.display = barMode ? 'none' : '';
            basketCapitalSelect.style.display = barMode ? 'none' : '';
            // Also hide the labels
            basketCapitalSelect.previousElementSibling.style.display = barMode ? 'none' : '';
            basketYearSelect.previousElementSibling.style.display = barMode ? 'none' : '';
        }
        
        basketBarBtn.addEventListener('click', async () => {
            if (state.basketBarMode) return;
            setBasketViewMode(true);
            await loadBasketBarChart();
        });
        
        basketLineBtn.addEventListener('click', () => {
            if (!state.basketBarMode) return;
            setBasketViewMode(false);
            loadBasketBacktest();
        });
        
        async function loadBasketBarChart() {
            const basket = getVisibleBasket();
            if (basket.length === 0) return;
            // No "Loading..." text - previous chart and metrics stay visible (double-buffer)
            try {
                const weights = await getBasketWeights();
                const params = new URLSearchParams({
                    strategies: JSON.stringify(basket),
                });
                if (weights) params.set('weights', JSON.stringify(weights));
                const fees = parseFloat(basketFeesInput.value) || 0;
                const tax = parseFloat(basketTaxInput.value) || 0;
                if (fees > 0) params.set('fees_pct', String(fees));
                if (tax > 0) params.set('tax_pct', String(tax));
                const res = await fetch('/api/basket/bar?' + params);
                const data = await res.json();
                if (data.error) {
                    getBasketFrontBuffer().innerHTML = '<div style="color:#ff4466;padding:20px;">' + data.error + '</div>';
                    return;
                }
                state.basketBarData = data;
                renderBasketBarChart(data);
            } catch (err) {
                getBasketFrontBuffer().innerHTML = '<div style="color:#ff4466;padding:20px;">Error: ' + err.message + '</div>';
            }
        }
        
        function renderBasketBarChart(data) {
            let years = data.years;
            const symbols = data.symbols || [];
            if (!years || years.length === 0) {
                getBasketFrontBuffer().innerHTML = '<div style="padding:20px;color:#888;text-align:center;">No data</div>';
                return;
            }
            // Slice years based on "Show N years" dropdown
            const showN = parseInt(basketYearsShow.value) || 0;
            if (showN > 0 && years.length > showN) {
                years = years.slice(-showN);
            }

            // Build symbol-to-color map from basket colors
            const symbolColorMap = buildBasketColorMap();

            const container = basketChart.getBoundingClientRect();
            const containerWidth = container.width - 32;
            // Always reserve space for horizontal scrollbar to prevent layout oscillation
            const rawHeight = container.height - 20;

            // 3-zone SVG: topZone (year labels at top + value labels) | chartZone (bars) | bottomZone (small buffer)
            const topZone = 34;      // px for year labels at top + value labels above tallest bar
            const bottomZone = 4;    // minimal bottom buffer
            const leftPad = 70;
            const rightPad = 20;
            const n = years.length;
            const minPerGroup = 80;
            const minWidth = leftPad + rightPad + n * minPerGroup;
            const width = Math.max(containerWidth, minWidth);
            const svgHeight = rawHeight;
            if (containerWidth < 50 || svgHeight < 80) return;
            const chartHeight = svgHeight - topZone - bottomZone;
            const chartWidth = width - leftPad - rightPad;

            // Fixed Y range so bars never shift when toggling params
            const yMin = -20;
            const yMax = 200;

            const groupWidth = chartWidth / n;
            const barWidth = Math.min(groupWidth * 0.38, 50);
            const gap = barWidth * 0.2;

            // yScale maps data values to the chart zone (topZone to topZone+chartHeight)
            const yScale = (v) => topZone + chartHeight - ((v - yMin) / (yMax - yMin)) * chartHeight;
            const zeroY = yScale(0);

            // Y ticks
            const yTicks = [];
            const yStep = 20;
            for (let v = yMin; v <= yMax; v += yStep) {
                yTicks.push(v);
            }

            let bars = '';
            let labels = '';
            years.forEach((d, i) => {
                const cx = leftPad + (i + 0.5) * groupWidth;
                const bhX = cx - barWidth - gap / 2;
                const stratX = cx + gap / 2;

                // B&H bar (solid blue)
                const bhTop = yScale(Math.max(d.bh_return, 0));
                const bhBot = yScale(Math.min(d.bh_return, 0));
                bars += '<rect x="' + bhX.toFixed(1) + '" y="' + bhTop.toFixed(1) + '" width="' + barWidth.toFixed(1) + '" height="' + Math.max(bhBot - bhTop, 1).toFixed(1) + '" fill="#6699ff" opacity="0.7" rx="1"/>';

                // Strategy stacked bar: proportionally split combined_return by stock
                if (d.stock_returns && symbols.length > 0) {
                    const totalReturn = d.combined_return;
                    // Get each stock's raw individual return
                    const rawReturns = symbols.map(sym => ({ sym, val: d.stock_returns[sym] || 0 }));
                    // Compute proportional contributions that sum exactly to combined_return
                    const posTotal = rawReturns.reduce((s, r) => s + Math.max(r.val, 0), 0);
                    const negTotal = rawReturns.reduce((s, r) => s + Math.min(r.val, 0), 0);

                    const contribs = rawReturns.map(r => {
                        if (totalReturn >= 0) {
                            // Positive combined: distribute proportionally by positive returns
                            return { sym: r.sym, contrib: posTotal > 0 ? (Math.max(r.val, 0) / posTotal) * totalReturn : totalReturn / symbols.length };
                        } else {
                            // Negative combined: distribute proportionally by negative returns
                            return { sym: r.sym, contrib: negTotal < 0 ? (Math.min(r.val, 0) / negTotal) * totalReturn : totalReturn / symbols.length };
                        }
                    });

                    const posContribs = contribs.filter(c => c.contrib >= 0);
                    const negContribs = contribs.filter(c => c.contrib < 0);

                    // Draw positive stack (bottom to top from zero line)
                    let posAcc = 0;
                    posContribs.forEach(({ sym, contrib }) => {
                        const segBot = posAcc;
                        const segTop = posAcc + contrib;
                        const y1 = yScale(segTop);
                        const y2 = yScale(segBot);
                        const segH = Math.max(y2 - y1, 0.5);
                        const color = symbolColorMap[sym] || '#888';
                        bars += '<rect x="' + stratX.toFixed(1) + '" y="' + y1.toFixed(1) + '" width="' + barWidth.toFixed(1) + '" height="' + segH.toFixed(1) + '" fill="' + color + '" opacity="0.85" rx="0"/>';
                        posAcc = segTop;
                    });

                    // Draw negative stack (top to bottom from zero line)
                    let negAcc = 0;
                    negContribs.forEach(({ sym, contrib }) => {
                        const segTop = negAcc;
                        const segBot = negAcc + contrib;
                        const y1 = yScale(segTop);
                        const y2 = yScale(segBot);
                        const segH = Math.max(y2 - y1, 0.5);
                        const color = symbolColorMap[sym] || '#888';
                        bars += '<rect x="' + stratX.toFixed(1) + '" y="' + y1.toFixed(1) + '" width="' + barWidth.toFixed(1) + '" height="' + segH.toFixed(1) + '" fill="' + color + '" opacity="0.85" rx="0"/>';
                        negAcc = segBot;
                    });

                    // Combined return label above/below the stacked bar
                    const labelY = totalReturn >= 0 ? yScale(posAcc) - 4 : yScale(negAcc) + 14;
                    bars += '<text x="' + (stratX + barWidth / 2).toFixed(1) + '" y="' + labelY.toFixed(1) + '" fill="#ccc" font-size="12" font-weight="600" text-anchor="middle">' + totalReturn.toFixed(0) + '%</text>';
                } else {
                    // Fallback: single bar for combined return
                    const sTop = yScale(Math.max(d.combined_return, 0));
                    const sBot = yScale(Math.min(d.combined_return, 0));
                    bars += '<rect x="' + stratX.toFixed(1) + '" y="' + sTop.toFixed(1) + '" width="' + barWidth.toFixed(1) + '" height="' + Math.max(sBot - sTop, 1).toFixed(1) + '" fill="#ffffff" opacity="0.8" rx="1"/>';
                }

                // B&H value label
                const bhLabelY = d.bh_return >= 0 ? bhTop - 4 : bhBot + 14;
                bars += '<text x="' + (bhX + barWidth / 2).toFixed(1) + '" y="' + bhLabelY.toFixed(1) + '" fill="#6699ff" font-size="12" font-weight="600" text-anchor="middle">' + d.bh_return.toFixed(0) + '%</text>';

                // Year label — placed at the top of the SVG
                labels += '<text x="' + cx.toFixed(1) + '" y="14" fill="#ccc" font-size="13" text-anchor="middle">&#39;' + String(d.year).slice(-2) + '</text>';
                // Dotted vertical line from below year label down through chart area
                labels += '<line x1="' + cx.toFixed(1) + '" y1="20" x2="' + cx.toFixed(1) + '" y2="' + (topZone + chartHeight).toFixed(1) + '" stroke="#333" stroke-width="1" stroke-dasharray="3,4"/>';
            });

            const svg = '<svg width="' + width + '" height="' + svgHeight + '">' +
                yTicks.map(v =>
                    '<line x1="' + leftPad + '" y1="' + yScale(v).toFixed(1) + '" x2="' + (width - rightPad) + '" y2="' + yScale(v).toFixed(1) + '" stroke="' + (v === 0 ? '#666' : '#333') + '" stroke-width="' + (v === 0 ? 2 : 1) + '"/>'
                ).join('') +
                yTicks.map(v =>
                    '<text x="' + (leftPad - 10) + '" y="' + (yScale(v) + 4).toFixed(1) + '" fill="#bbb" font-size="13" text-anchor="end">' + v.toFixed(0) + '%</text>'
                ).join('') +
                bars + labels +
                '</svg>';

            // Render to back buffer, then swap for flicker-free update
            const backBuffer = getBasketBackBuffer();
            backBuffer.innerHTML = svg;
            swapBasketBuffers();

            // Metrics
            const avgCombined = years.reduce((s, d) => s + d.combined_return, 0) / n;
            const avgBH = years.reduce((s, d) => s + d.bh_return, 0) / n;
            const winYears = years.filter(d => d.combined_return > d.bh_return).length;
            // Compute average time in market %
            const dimYears = years.filter(d => d.days_in_market != null && d.total_trading_days > 0);
            const avgTimeInMarket = dimYears.length > 0 ? dimYears.reduce((s, d) => s + (d.days_in_market / d.total_trading_days) * 100, 0) / dimYears.length : null;
            basketMetrics.innerHTML =
                '<div class="backtest-metric"><span class="label">Avg Basket:</span><span class="' + (avgCombined >= 0 ? 'positive' : 'negative') + '">' + avgCombined.toFixed(1) + '%</span></div>' +
                '<div class="backtest-metric"><span class="label">Avg B&H:</span><span class="' + (avgBH >= 0 ? 'positive' : 'negative') + '">' + avgBH.toFixed(1) + '%</span></div>' +
                '<div class="backtest-metric"><span class="label">Beats B&H:</span><span>' + winYears + '/' + n + ' yrs</span></div>' +
                '<div class="backtest-metric"><span class="label">Sharpe:</span><span style="color:' + sharpeColor(data.sharpe_ratio) + '">' + (data.sharpe_ratio != null ? data.sharpe_ratio.toFixed(2) : 'N/A') + ' (' + (data.sharpe_label || 'N/A') + ')</span></div>' +
                (avgTimeInMarket != null ? '<div class="backtest-metric"><span class="label">Avg Time in Market:</span><span>' + avgTimeInMarket.toFixed(0) + '%</span></div>' : '');
        }
        
        // Export unified trading calendar
        async function exportTradingCalendar() {
            const basket = loadBasket();
            if (basket.length === 0) {
                return;
            }
            
            const align = document.getElementById('basket-align-check').checked;
            const params = new URLSearchParams({
                strategies: JSON.stringify(basket),
                align: align ? '1' : '0'
            });
            
            window.location.href = `/api/basket/export?${params}`;
        }
        
        // Export simulation CSV with Google Sheets formulas
        async function exportTradingSimulation() {
            const basket = loadBasket();
            if (basket.length === 0) {
                return;
            }
            
            const align = document.getElementById('basket-align-check').checked;
            const params = new URLSearchParams({
                strategies: JSON.stringify(basket),
                align: align ? '1' : '0'
            });
            
            window.location.href = `/api/basket/export-simulation?${params}`;
        }
        
        // =====================
        // Basket Save / Load (File-based)
        // =====================
        const basketFileInput = document.getElementById('basket-file-input');
        const basketTitleName = document.getElementById('basket-title-name');
        let currentBasketName = '';  // Track loaded basket name
        
        function updateBasketTitle(name) {
            currentBasketName = name || '';
            if (name) {
                basketTitleName.textContent = ': ' + name;
            } else {
                basketTitleName.textContent = '';
            }
        }
        
        function saveBasketToFile() {
            const basket = loadBasket();
            if (basket.length === 0) {
                setStatus('No strategies to save', true);
                return;
            }
            
            const data = {
                name: currentBasketName || 'Untitled Basket',
                strategies: basket,
                allocation: basketAllocSelect.value,
                saved_at: new Date().toISOString()
            };
            
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            // Use current basket name or default
            const filename = (currentBasketName || 'trading-basket').replace(/[^a-z0-9]/gi, '-').toLowerCase() + '.json';
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            setStatus(`Basket saved as ${filename}`);
        }
        
        function loadBasketFromFile() {
            basketFileInput.click();
        }
        
        basketFileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = (evt) => {
                try {
                    const data = JSON.parse(evt.target.result);
                    if (!data.strategies || !Array.isArray(data.strategies)) {
                        setStatus('Invalid basket file format', true);
                        return;
                    }
                    
                    // Ensure colors are assigned
                    ensureBasketColors(data.strategies);
                    saveBasket(data.strategies);
                    
                    // Update basket name from file
                    const basketName = data.name || file.name.replace(/\.json$/i, '');
                    updateBasketTitle(basketName);
                    
                    // Restore allocation if saved
                    if (data.allocation && basketAllocSelect) {
                        basketAllocSelect.value = data.allocation;
                    }
                    
                    state.basketWeights = null;
                    renderBasketStrategies();
                    setStatus(`Loaded basket "${basketName}"`);
                    
                    if (data.strategies.length > 0) {
                        if (state.basketBarMode) {
                            loadBasketBarChart();
                        } else {
                            loadBasketBacktest();
                        }
                    } else {
                        getBasketFrontBuffer().innerHTML = '<div style="padding: 20px; color: #666; text-align: center;">Add strategies to see combined backtest</div>';
                        basketMetrics.innerHTML = '';
                    }
                } catch (err) {
                    setStatus('Failed to parse basket file: ' + err.message, true);
                }
            };
            reader.readAsText(file);
            
            // Reset input so same file can be loaded again
            basketFileInput.value = '';
        });
        
        // Event listeners for basket
        document.getElementById('basket-save-btn').addEventListener('click', saveBasketToFile);
        document.getElementById('basket-load-btn').addEventListener('click', loadBasketFromFile);
        showBasketBtn.addEventListener('click', openBasketOverlay);
        document.getElementById('basket-close-btn').addEventListener('click', closeBasketOverlay);
        document.getElementById('basket-clear-btn').addEventListener('click', () => {
            saveBasket([]);
            updateBasketTitle('');
            renderBasketStrategies();
            getBasketFrontBuffer().innerHTML = '<div style="padding: 20px; color: #666; text-align: center;">Add strategies to see combined backtest</div>';
            basketMetrics.innerHTML = '';
        });
        document.getElementById('basket-export-btn').addEventListener('click', exportTradingCalendar);
        document.getElementById('basket-export-sim-btn').addEventListener('click', exportTradingSimulation);
        basketYearSelect.addEventListener('change', loadBasketBacktest);
        basketCapitalSelect.addEventListener('change', loadBasketBacktest);
        basketAllocSelect.addEventListener('change', () => {
            // Allocation mode changed — invalidate cached weights and reload
            state.basketWeights = null;
            if (state.basketBarMode) {
                loadBasketBarChart();
            } else {
                loadBasketBacktest();
            }
        });
        function onFeesChange() {
            if (state.basketBarMode) {
                loadBasketBarChart();
            } else {
                loadBasketBacktest();
            }
        }
        basketFeesInput.addEventListener('change', onFeesChange);
        basketTaxInput.addEventListener('change', onFeesChange);
        basketYearsShow.addEventListener('change', () => {
            if (state.basketBarMode && state.basketBarData) {
                renderBasketBarChart(state.basketBarData);
            }
        });
        document.getElementById('basket-shuffle-colors').addEventListener('click', shuffleColors);
        basketOverlay.addEventListener('click', (e) => {
            if (e.target === basketOverlay) closeBasketOverlay();
        });
        
        // Initialize basket badge on load
        updateBasketBadge();
        
        // Initial load - only if symbol is set
        if (state.symbol) {
            loadData();
        } else {
            setStatus('Enter a symbol or use + Multi to select stocks');
        }
