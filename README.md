# Seasonal Stock Pattern Detector

A Textual-based TUI that downloads Yahoo Finance OHLC data, caches it locally, and analyzes seasonal windows (weekly/monthly) with dynamic offsets. It supports single symbols or equal-weighted baskets and exports CSV reports on demand.

## Features
- Full-screen TUI for interactive exploration
- Weekly (52) and monthly (12) windows with configurable offsets
- Net return and intra-window direction indicators
- Local CSV caching with auto-refresh up to yesterday
- On-demand CSV export

## Requirements
- Python 3.10+

## Install
```bash
pip install -r requirements.txt
```

## Run
```bash
python src/app.py
```

## Usage
- Enter one symbol (e.g., `RELIANCE.NS`) or a comma-separated list for a basket.
- Toggle Weekly/Monthly using the selector or `w`/`m` keys.
- Adjust offset with the `-`/`+` buttons or left/right arrows.
- Export the current table with the **Export** button.

## Data Cache
- Cached CSVs are stored in `data/` by sanitized symbol name.
- On load, the app fetches any missing data up to yesterday.

## Export
- CSVs are written to `exports/` with a timestamped filename.

## Notes
- Basket mode uses equal-weighted average returns to avoid price-level bias.
