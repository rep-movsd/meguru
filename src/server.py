"""
Web server for Meguru - Seasonal Stock Pattern Detector.
Simple HTTP server using http.server with JSON API endpoints.
"""
from __future__ import annotations

import json
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

from backend import (
    search_symbols,
    parse_symbols,
    get_stats,
    get_trades,
    export_stats_csv,
    export_trades_csv,
    export_strategy_csv,
    get_backtest_data,
    find_optimal_trades,
    get_basket_backtest_data,
    get_basket_backtest_average,
    export_trading_calendar_csv,
    detect_sliding_windows,
    load_symbol_data,
    get_window_backtest_data,
    get_window_backtest_average,
    get_basket_overlap,
    get_window_bar_data,
    get_basket_bar_data,
    save_basket,
    load_basket,
    list_baskets,
    delete_basket,
    OFFSET_LIMITS,
    get_market_caps,
)

HOST = "localhost"
PORT = 8000

# Load HTML from static file
_STATIC_DIR = Path(__file__).parent / "static"
HTML_PAGE = (_STATIC_DIR / "index.html").read_text(encoding="utf-8")


class MeguruHandler(BaseHTTPRequestHandler):
    """HTTP request handler for Meguru API."""
    
    def log_message(self, format, *args):
        """Override to customize logging."""
        print(f"[{self.log_date_time_string()}] {args[0]}")
    
    def send_json(self, data: dict, status: int = 200) -> None:
        """Send JSON response."""
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)
    
    def send_html(self, html: str) -> None:
        """Send HTML response."""
        body = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)
    
    def send_csv(self, content: str, filename: str) -> None:
        """Send CSV file download."""
        body = content.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/csv")
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)
    
    def send_static(self, filepath: Path, content_type: str) -> None:
        """Send a static file."""
        try:
            body = filepath.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", len(body))
            self.end_headers()
            self.wfile.write(body)
        except FileNotFoundError:
            self.send_response(404)
            self.end_headers()
    
    def parse_params(self) -> dict:
        """Parse query parameters from URL."""
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        return {k: v[0] if v else "" for k, v in params.items()}
    
    def do_GET(self) -> None:
        """Handle GET requests."""
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        
        if path == "/":
            self.send_html(HTML_PAGE)
        
        elif path == "/static/style.css":
            self.send_static(_STATIC_DIR / "style.css", "text/css; charset=utf-8")
        
        elif path == "/static/app.js":
            self.send_static(_STATIC_DIR / "app.js", "application/javascript; charset=utf-8")
        
        elif path == "/api/symbols":
            params = self.parse_params()
            query = params.get("q", "")
            results = search_symbols(query)
            self.send_json(results)
        
        elif path == "/api/stats":
            params = self.parse_params()
            try:
                symbols = parse_symbols(params.get("symbol", ""))
                period = params.get("period", "monthly")
                offset = int(params.get("offset", 0))
                threshold = int(params.get("threshold", 50))
                
                if not symbols:
                    self.send_json({"error": "No symbol provided"}, 400)
                    return
                
                result = get_stats(symbols, period, offset, threshold)
                self.send_json(result)
            except Exception as e:
                self.send_json({"error": str(e)}, 500)
        
        elif path == "/api/trades":
            params = self.parse_params()
            try:
                symbols = parse_symbols(params.get("symbol", ""))
                period = params.get("period", "monthly")
                offset = int(params.get("offset", 0))
                threshold = int(params.get("threshold", 50))
                
                if not symbols:
                    self.send_json({"error": "No symbol provided"}, 400)
                    return
                
                result = get_trades(symbols, period, offset, threshold)
                self.send_json(result)
            except Exception as e:
                self.send_json({"error": str(e)}, 500)
        
        elif path == "/api/export/stats":
            params = self.parse_params()
            try:
                symbols = parse_symbols(params.get("symbol", ""))
                period = params.get("period", "monthly")
                offset = int(params.get("offset", 0))
                threshold = int(params.get("threshold", 50))
                
                if not symbols:
                    self.send_json({"error": "No symbol provided"}, 400)
                    return
                
                symbol_label = "+".join(s.replace(".NS", "") for s in symbols)
                period_abbr = "M" if period == "monthly" else "W"
                filename = f"{symbol_label}-{period_abbr}+{offset}@{threshold}.stats.csv"
                
                content = export_stats_csv(symbols, period, offset, threshold)
                self.send_csv(content, filename)
            except Exception as e:
                self.send_json({"error": str(e)}, 500)
        
        elif path == "/api/export/trades":
            params = self.parse_params()
            try:
                symbols = parse_symbols(params.get("symbol", ""))
                period = params.get("period", "monthly")
                offset = int(params.get("offset", 0))
                threshold = int(params.get("threshold", 50))
                
                if not symbols:
                    self.send_json({"error": "No symbol provided"}, 400)
                    return
                
                symbol_label = "+".join(s.replace(".NS", "") for s in symbols)
                period_abbr = "M" if period == "monthly" else "W"
                filename = f"{symbol_label}-{period_abbr}+{offset}@{threshold}.trades.csv"
                
                content = export_trades_csv(symbols, period, offset, threshold)
                self.send_csv(content, filename)
            except Exception as e:
                self.send_json({"error": str(e)}, 500)
        
        elif path == "/api/export/strategy":
            params = self.parse_params()
            try:
                symbols = parse_symbols(params.get("symbol", ""))
                period = params.get("period", "monthly")
                offset = int(params.get("offset", 0))
                threshold = int(params.get("threshold", 50))
                
                if not symbols:
                    self.send_json({"error": "No symbol provided"}, 400)
                    return
                
                symbol_label = "+".join(s.replace(".NS", "") for s in symbols)
                period_abbr = "M" if period == "monthly" else "W"
                filename = f"{symbol_label}-{period_abbr}+{offset}@{threshold}.strategy.csv"
                
                content = export_strategy_csv(symbols, period, offset, threshold)
                self.send_csv(content, filename)
            except Exception as e:
                self.send_json({"error": str(e)}, 500)
        
        elif path == "/api/backtest":
            params = self.parse_params()
            try:
                symbols = parse_symbols(params.get("symbol", ""))
                period = params.get("period", "monthly")
                offset = int(params.get("offset", 0))
                threshold = int(params.get("threshold", 50))
                year = int(params.get("year", 2023))
                
                if not symbols:
                    self.send_json({"error": "No symbol provided"}, 400)
                    return
                
                result = get_backtest_data(symbols, period, offset, threshold, year)
                self.send_json(result)
            except Exception as e:
                self.send_json({"error": str(e)}, 500)
        
        elif path == "/api/optimize":
            params = self.parse_params()
            try:
                symbols = parse_symbols(params.get("symbol", ""))
                period = params.get("period", "monthly")
                optimize_for = params.get("optimize_for", "profit")  # "profit" or "yield"
                
                if not symbols:
                    self.send_json({"error": "No symbol provided"}, 400)
                    return
                
                result = find_optimal_trades(symbols, period, optimize_for)
                self.send_json(result)
            except Exception as e:
                self.send_json({"error": str(e)}, 500)
        
        elif path == "/api/basket/backtest":
            params = self.parse_params()
            try:
                strategies_json = params.get("strategies", "[]")
                strategies = json.loads(strategies_json)
                year_str = params.get("year", "2023")
                weights_json = params.get("weights", "")
                symbol_weights = json.loads(weights_json) if weights_json else None
                stop_loss = float(params.get("stop_loss", "0"))
                reentry = float(params.get("reentry", "0"))
                fees_pct = float(params.get("fees_pct", "0"))
                tax_pct = float(params.get("tax_pct", "0"))
                
                if not strategies:
                    self.send_json({"error": "No strategies provided"}, 400)
                    return
                
                if year_str == "avg":
                    result = get_basket_backtest_average(strategies, symbol_weights, stop_loss, reentry)
                else:
                    result = get_basket_backtest_data(strategies, int(year_str), symbol_weights, stop_loss, reentry)
                self.send_json(result)
            except json.JSONDecodeError:
                self.send_json({"error": "Invalid strategies JSON"}, 400)
            except Exception as e:
                self.send_json({"error": str(e)}, 500)
        
        elif path == "/api/basket/export":
            params = self.parse_params()
            try:
                strategies_json = params.get("strategies", "[]")
                strategies = json.loads(strategies_json)
                
                if not strategies:
                    self.send_json({"error": "No strategies provided"}, 400)
                    return
                
                align = params.get("align", "0") == "1"
                content = export_trading_calendar_csv(strategies, align_windows=align)
                filename = "trading-calendar.csv"
                self.send_csv(content, filename)
            except json.JSONDecodeError:
                self.send_json({"error": "Invalid strategies JSON"}, 400)
            except Exception as e:
                self.send_json({"error": str(e)}, 500)
        
        elif path == "/api/basket/overlap":
            params = self.parse_params()
            try:
                symbol = params.get("symbol", "")
                window_size = int(params.get("window_size", 30))
                threshold = int(params.get("threshold", 50))
                strategies_json = params.get("strategies", "[]")
                strategies = json.loads(strategies_json)
                
                if not symbol:
                    self.send_json({"error": "No symbol provided"}, 400)
                    return
                
                if not strategies:
                    self.send_json({"error": "No strategies in basket"}, 400)
                    return
                
                result = get_basket_overlap(symbol, window_size, threshold, strategies)
                self.send_json(result)
            except json.JSONDecodeError:
                self.send_json({"error": "Invalid strategies JSON"}, 400)
            except Exception as e:
                self.send_json({"error": str(e)}, 500)
        
        elif path == "/api/windows":
            params = self.parse_params()
            try:
                symbols = parse_symbols(params.get("symbol", ""))
                window_size = int(params.get("window_size", 30))
                threshold = int(params.get("threshold", 50))
                
                if not symbols:
                    self.send_json({"error": "No symbol provided"}, 400)
                    return
                
                # For now, just use the first symbol
                symbol = symbols[0]
                df = load_symbol_data(symbol)
                
                if df.empty:
                    self.send_json({"error": f"No data found for {symbol}"}, 404)
                    return
                
                windows = detect_sliding_windows(
                    df,
                    window_size=window_size,
                    threshold=threshold / 100,  # Convert to 0-1
                )
                
                # Convert to JSON-serializable format
                result = {
                    "symbol": symbol,
                    "window_size": window_size,
                    "threshold": threshold,
                    "windows": [
                        {
                            "start_day": w.start_day,
                            "end_day": w.end_day,
                            "start_date": w.start_date_str,
                            "end_date": w.end_date_str,
                            "length": w.length,
                            "avg_return": round(w.avg_return, 2),
                            "win_rate": round(w.win_rate * 100, 0),
                            "score": round(w.score, 2),
                            "yield_per_day": round(w.yield_per_day * 100, 2),  # bps/day
                            "year_returns": {
                                str(k): round(v, 2) if v is not None else None
                                for k, v in w.year_returns.items()
                            }
                        }
                        for w in windows
                    ],
                    "total_days": sum(w.length for w in windows),
                    "total_return": round(sum(w.avg_return for w in windows), 2),
                }
                self.send_json(result)
            except Exception as e:
                self.send_json({"error": str(e)}, 500)
        
        elif path == "/api/windows/backtest":
            params = self.parse_params()
            try:
                symbols = parse_symbols(params.get("symbol", ""))
                window_size = int(params.get("window_size", 30))
                threshold = int(params.get("threshold", 50))
                year_str = params.get("year", "2024")
                stop_loss = float(params.get("stop_loss", "0"))
                reentry = float(params.get("reentry", "0"))
                fees_pct = float(params.get("fees_pct", "0"))
                tax_pct = float(params.get("tax_pct", "0"))
                
                if not symbols:
                    self.send_json({"error": "No symbol provided"}, 400)
                    return
                
                if year_str == "avg":
                    result = get_window_backtest_average(
                        symbols[0], window_size, threshold,
                    )
                else:
                    result = get_window_backtest_data(
                        symbols[0], window_size, threshold, int(year_str),
                        stop_loss_pct=stop_loss, reentry_pct=reentry,
                    )
                self.send_json(result)
            except Exception as e:
                self.send_json({"error": str(e)}, 500)
        
        elif path == "/api/windows/bar":
            params = self.parse_params()
            try:
                symbols = parse_symbols(params.get("symbol", ""))
                window_size = int(params.get("window_size", 30))
                threshold = int(params.get("threshold", 50))
                stop_loss = float(params.get("stop_loss", "0"))
                reentry = float(params.get("reentry", "0"))
                fees_pct = float(params.get("fees_pct", "0"))
                tax_pct = float(params.get("tax_pct", "0"))
                
                if not symbols:
                    self.send_json({"error": "No symbol provided"}, 400)
                    return
                
                result = get_window_bar_data(symbols[0], window_size, threshold,
                                             stop_loss_pct=stop_loss, reentry_pct=reentry,
                                             fees_pct=fees_pct, tax_pct=tax_pct)
                self.send_json(result)
            except Exception as e:
                self.send_json({"error": str(e)}, 500)
        
        elif path == "/api/basket/bar":
            params = self.parse_params()
            try:
                strategies_json = params.get("strategies", "[]")
                strategies = json.loads(strategies_json)
                weights_json = params.get("weights", "")
                symbol_weights = json.loads(weights_json) if weights_json else None
                stop_loss = float(params.get("stop_loss", "0"))
                reentry = float(params.get("reentry", "0"))
                fees_pct = float(params.get("fees_pct", "0"))
                tax_pct = float(params.get("tax_pct", "0"))
                
                if not strategies:
                    self.send_json({"error": "No strategies provided"}, 400)
                    return
                
                result = get_basket_bar_data(strategies, symbol_weights, stop_loss, reentry,
                                           fees_pct=fees_pct, tax_pct=tax_pct)
                self.send_json(result)
            except json.JSONDecodeError:
                self.send_json({"error": "Invalid strategies JSON"}, 400)
            except Exception as e:
                self.send_json({"error": str(e)}, 500)
        
        elif path == "/api/marketcap":
            params = self.parse_params()
            try:
                symbols_str = params.get("symbols", "")
                if not symbols_str:
                    self.send_json({"error": "No symbols provided"}, 400)
                    return
                symbols = [s.strip() for s in symbols_str.split(",") if s.strip()]
                caps = get_market_caps(symbols)
                self.send_json(caps)
            except Exception as e:
                self.send_json({"error": str(e)}, 500)

        elif path == "/api/baskets":
            try:
                self.send_json(list_baskets())
            except Exception as e:
                self.send_json({"error": str(e)}, 500)
        
        elif path == "/api/baskets/load":
            params = self.parse_params()
            try:
                name = params.get("name", "")
                if not name:
                    self.send_json({"error": "No basket name provided"}, 400)
                    return
                data = load_basket(name)
                self.send_json(data)
            except FileNotFoundError as e:
                self.send_json({"error": str(e)}, 404)
            except Exception as e:
                self.send_json({"error": str(e)}, 500)
        
        else:
            self.send_response(404)
            self.end_headers()
    
    def do_POST(self) -> None:
        """Handle POST requests."""
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        
        # Read JSON body
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length else b""
        
        if path == "/api/baskets/save":
            try:
                data = json.loads(body) if body else {}
                name = data.get("name", "")
                strategies = data.get("strategies", [])
                if not name:
                    self.send_json({"error": "No basket name provided"}, 400)
                    return
                if not strategies:
                    self.send_json({"error": "No strategies to save"}, 400)
                    return
                result = save_basket(name, strategies, data.get("allocation", "equal"))
                self.send_json(result)
            except ValueError as e:
                self.send_json({"error": str(e)}, 400)
            except Exception as e:
                self.send_json({"error": str(e)}, 500)
        
        elif path == "/api/baskets/delete":
            try:
                data = json.loads(body) if body else {}
                name = data.get("name", "")
                if not name:
                    self.send_json({"error": "No basket name provided"}, 400)
                    return
                result = delete_basket(name)
                self.send_json(result)
            except FileNotFoundError as e:
                self.send_json({"error": str(e)}, 404)
            except Exception as e:
                self.send_json({"error": str(e)}, 500)
        
        else:
            self.send_response(404)
            self.end_headers()


def run_server() -> None:
    """Start the HTTP server."""
    server = HTTPServer((HOST, PORT), MeguruHandler)
    print(f"Meguru server running at http://{HOST}:{PORT}")
    print("Press Ctrl+C to stop")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.shutdown()


if __name__ == "__main__":
    run_server()
