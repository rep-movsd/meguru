#!/usr/bin/env python3
"""Download NSE stock list, indices, and ETFs and save locally for autocomplete."""

import csv
import json
from pathlib import Path
import urllib.request

NSE_EQUITY_URL = "https://archives.nseindia.com/content/equities/EQUITY_L.csv"
NSE_INDICES_URL = "https://www.nseindia.com/api/allIndices"
NSE_ETF_URL = "https://www.nseindia.com/api/etf"

DATA_DIR = Path(__file__).parent.parent / "data" / "stocks"
OUTPUT_FILE = DATA_DIR / "nse_stocks.csv"

# Headers required for NSE API access
NSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
}

# Mapping from NSE index names to Yahoo Finance symbols
# Yahoo uses non-standard symbols for Indian indices (^NSEI, ^CNXIT, etc.)
# This maps NSE API "index" field to the corresponding Yahoo symbol
NSE_TO_YAHOO_INDEX = {
    "NIFTY 50": "^NSEI",
    "NIFTY BANK": "^NSEBANK",
    "S&P BSE SENSEX": "^BSESN",
    "INDIA VIX": "^INDIAVIX",
    "NIFTY IT": "^CNXIT",
    "NIFTY AUTO": "^CNXAUTO",
    "NIFTY PHARMA": "^CNXPHARMA",
    "NIFTY FMCG": "^CNXFMCG",
    "NIFTY METAL": "^CNXMETAL",
    "NIFTY REALTY": "^CNXREALTY",
    "NIFTY PSU BANK": "^CNXPSUBANK",
    "NIFTY FINANCIAL SERVICES 25/50": "^CNXFIN",
    "NIFTY INFRA": "^CNXINFRA",
    "NIFTY ENERGY": "^CNXENERGY",
    "NIFTY MEDIA": "^CNXMEDIA",
    "NIFTY SERV SECTOR": "^CNXSERVICE",
    "NIFTY MIDCAP 50": "^NSEMDCP50",
    "NIFTY NEXT 50": "^NSMIDCP",
    "NIFTY PSE": "^CNXPSE",
    "NIFTY 100": "^CNX100",
    "NIFTY 200": "^CNX200",
    "NIFTY SMALLCAP 100": "^CNXSC",
    "NIFTY 500": "^CRSLDX",
}


def fetch_json(url: str) -> dict | None:
    """Fetch JSON from NSE API."""
    req = urllib.request.Request(url, headers=NSE_HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception as e:
        print(f"Warning: Could not fetch {url}: {e}")
        return None


def download_indices() -> list[tuple[str, str]]:
    """Download all indices from NSE API and map to Yahoo Finance symbols."""
    print(f"Downloading indices from {NSE_INDICES_URL}...")
    data = fetch_json(NSE_INDICES_URL)
    if not data or "data" not in data:
        print("Warning: Could not download indices")
        return []
    
    indices = []
    unmapped_count = 0
    for item in data["data"]:
        nse_name = item.get("index", "").strip()
        if not nse_name:
            continue
        
        # Try to find Yahoo symbol from mapping
        yahoo_symbol = NSE_TO_YAHOO_INDEX.get(nse_name)
        if yahoo_symbol:
            indices.append((yahoo_symbol, nse_name))
        else:
            unmapped_count += 1
    
    print(f"Downloaded {len(indices)} indices with Yahoo mappings ({unmapped_count} unmapped)")
    return indices


def download_etfs() -> list[tuple[str, str]]:
    """Download all ETFs from NSE API."""
    print(f"Downloading ETFs from {NSE_ETF_URL}...")
    data = fetch_json(NSE_ETF_URL)
    if not data or "data" not in data:
        print("Warning: Could not download ETFs")
        return []
    
    etfs = []
    for item in data["data"]:
        symbol = item.get("symbol", "").strip()
        # Get company name from meta, fallback to assets description
        meta = item.get("meta", {})
        name = meta.get("companyName", "").strip() if meta else ""
        if not name:
            name = item.get("assets", "").strip()
        
        if symbol and name:
            # Add .NS suffix for Yahoo Finance compatibility
            etfs.append((f"{symbol}.NS", name))
    
    print(f"Downloaded {len(etfs)} ETFs from NSE")
    return etfs


def download_nse_stocks() -> None:
    """Download NSE equity list, indices, and ETFs and save as simplified CSV."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    
    stocks = []
    
    # Download equities
    print(f"Downloading stocks from {NSE_EQUITY_URL}...")
    req = urllib.request.Request(
        NSE_EQUITY_URL,
        headers={"User-Agent": "Mozilla/5.0"}
    )
    
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            content = response.read().decode("utf-8")
        
        # Parse and simplify
        lines = content.strip().split("\n")
        reader = csv.reader(lines)
        header = next(reader)
        
        # Find column indices
        symbol_idx = 0  # SYMBOL
        name_idx = 1    # NAME OF COMPANY
        
        for row in reader:
            if len(row) >= 2:
                symbol = row[symbol_idx].strip()
                name = row[name_idx].strip()
                if symbol and name:
                    # Add .NS suffix for Yahoo Finance
                    stocks.append((f"{symbol}.NS", name))
        
        print(f"Downloaded {len(stocks)} stocks from NSE")
    except Exception as e:
        print(f"Warning: Could not download NSE stocks: {e}")
    
    # Download and add indices
    indices = download_indices()
    for symbol, name in indices:
        stocks.append((symbol, f"[INDEX] {name}"))
    
    # Download and add ETFs
    etfs = download_etfs()
    for symbol, name in etfs:
        stocks.append((symbol, f"[ETF] {name}"))
    
    # Sort by symbol
    stocks.sort(key=lambda x: x[0])
    
    # Write simplified CSV
    with open(OUTPUT_FILE, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["symbol", "name"])
        writer.writerows(stocks)
    
    print(f"Saved {len(stocks)} total entries to {OUTPUT_FILE}")


if __name__ == "__main__":
    download_nse_stocks()
