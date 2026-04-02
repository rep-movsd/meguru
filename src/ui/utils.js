// HSV to RGB conversion
function hsvToRgb(h, s, v) {
    let r, g, b;
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    
    switch (i % 6) {
        case 0: r = v; g = t; b = p; break;
        case 1: r = q; g = v; b = p; break;
        case 2: r = p; g = v; b = t; break;
        case 3: r = p; g = q; b = v; break;
        case 4: r = t; g = p; b = v; break;
        case 5: r = v; g = p; b = q; break;
    }
    
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

// Hash a stock name to a starting hue (0-359)
function hashToHue(stock) {
    let hash = 5381;
    for (let i = 0; i < stock.length; i++) {
        hash = ((hash << 5) + hash + stock.charCodeAt(i)) | 0;
    }
    hash ^= hash >>> 16;
    hash = Math.imul(hash, 0x85ebca6b);
    hash ^= hash >>> 13;
    hash = Math.imul(hash, 0xc2b2ae35);
    hash ^= hash >>> 16;
    return (hash >>> 0) % 360;
}

const HUE_STEP = 137;

export function getBasketColors(stocks) {
    if (!stocks || stocks.length === 0) return {};
    
    const startHue = hashToHue(stocks[0]);
    const colors = {};
    
    for (let i = 0; i < stocks.length; i++) {
        const hue = ((startHue + i * HUE_STEP) % 360) / 360;
        const [r, g, b] = hsvToRgb(hue, 0.62, 0.82);
        colors[stocks[i]] = `rgb(${r}, ${g}, ${b})`;
    }
    
    return colors;
}
