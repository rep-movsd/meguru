// Cloudflare Worker — CORS proxy for Yahoo Finance chart API.
// Relays requests to query2.finance.yahoo.com and adds CORS headers
// so the browser app can fetch stock data directly.
//
// Usage:  GET /chart/RELIANCE.NS?period1=...&period2=...&interval=1d

const YAHOO_BASE = 'https://query2.finance.yahoo.com/v8/finance/chart';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
    async fetch(request) {
        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: CORS_HEADERS });
        }

        const url = new URL(request.url);
        const path = url.pathname;

        // Only allow /chart/{ticker} paths
        if (!path.startsWith('/chart/')) {
            return new Response(
                JSON.stringify({ error: 'Invalid path. Use /chart/{TICKER}?period1=...&period2=...&interval=1d' }),
                { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
            );
        }

        // Extract ticker from path and forward query params
        const ticker = path.slice('/chart/'.length);
        const yahooUrl = `${YAHOO_BASE}/${ticker}?${url.searchParams.toString()}`;

        try {
            const resp = await fetch(yahooUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
            });

            // Clone response with CORS headers
            const body = await resp.arrayBuffer();
            return new Response(body, {
                status: resp.status,
                headers: {
                    ...CORS_HEADERS,
                    'Content-Type': resp.headers.get('Content-Type') || 'application/json',
                },
            });
        } catch (err) {
            return new Response(
                JSON.stringify({ error: `Proxy error: ${err.message}` }),
                { status: 502, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
            );
        }
    },
};
