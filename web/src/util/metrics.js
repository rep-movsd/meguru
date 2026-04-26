// Quality score: capital efficiency * downside-risk penalty.
//
//   efficiency = mean(plan) / (mean(benchmark) * daysFrac)
//                  ^ ideal = 1.0:  invested daysFrac of the year, got daysFrac of B&H
//                  > 1.0:           plan beats expected
//
//   downside = sqrt(mean(min(plan_y, 0)^2))   (only loss years penalized)
//   penalty  = 1 / (1 + k * downside)         (k = 3 -> 20% loss ~ 0.625 factor)
//
//   quality = efficiency * penalty
//
// - Primary factor: capital efficiency relative to days-in-market
// - Secondary: penalize plan loss years (variance below zero)
// - Above-mean variance (good years) NOT penalized
// - Unbounded, signed, can exceed 1.0
//
// When benchmarkReturns omitted, treats benchmark = 0 and skips efficiency
// (returns just downside-penalized mean).
export function calcQuality(planReturns, benchmarkReturns, daysFrac) {
    if (!planReturns || planReturns.length === 0) return 0
    const n = planReturns.length

    // Mean plan return
    let sumPlan = 0
    let sumDownSq = 0
    for (let i = 0; i < n; i++) {
        const p = planReturns[i]
        sumPlan += p
        if (p < 0) sumDownSq += p * p
    }
    const meanPlan = sumPlan / n
    const downside = Math.sqrt(sumDownSq / n)
    const K_DOWNSIDE = 3
    const penalty = 1 / (1 + K_DOWNSIDE * downside)

    // Capital efficiency (only when benchmark + daysFrac provided)
    if (!benchmarkReturns || daysFrac == null || daysFrac <= 0) {
        return meanPlan * penalty * 10   // scale to similar order
    }

    let sumBh = 0
    for (let i = 0; i < n; i++) sumBh += benchmarkReturns[i] || 0
    const meanBh = sumBh / n

    // Expected return = what you'd get holding B&H for daysFrac of the year
    const expected = meanBh * daysFrac
    const eps = 0.01
    const efficiency = meanPlan / Math.max(Math.abs(expected), eps) * Math.sign(expected || 1)

    return efficiency * penalty
}

export function formatQuality(q) {
    const sign = q >= 0 ? '+' : ''
    return `${sign}${q.toFixed(2)}`
}

export function qualityColor(q, positiveColor = '#22c55e', negativeColor = '#ef4444') {
    return q > 0 ? positiveColor : negativeColor
}
