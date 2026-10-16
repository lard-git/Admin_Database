// forecast.js — next-hour check-in forecast from the gym's own hourly history.
//
// Series : check-ins per hour (members + walk-ins).
// Method : seasonal baseline + level correction, validated by a rolling back-test.
//   1. Seasonal baseline for the target hour = recency-weighted average of the same hour-of-week in
//      previous weeks (up to 8), blended with the same hour on recent weekdays/weekends when there are
//      only a few weeks of history.
//   2. Level correction: what actually happened over the last ~3 hours vs what the baseline expected
//      for them (damped ratio) scales the baseline, catching "busier/quieter than usual today".
//   3. Confidence and the 80% range come from re-running steps 1-2 on the last 4 days (one-step-ahead,
//      using only data available at the time) and measuring the error.

const HOUR = 3600000, DAY = 24 * HOUR, WEEK = 7 * DAY;
const floorHour = t => { const d = new Date(t); d.setMinutes(0, 0, 0); return d.getTime(); };
const isWeekend = t => { const g = new Date(t).getDay(); return g === 0 || g === 6; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const wavg = (arr, decay) => {            // arr[0] is the most recent sample
    let s = 0, w = 0;
    arr.forEach((v, i) => { const k = Math.pow(decay, i); s += v * k; w += k; });
    return w ? s / w : 0;
};

export class EnhancedForecaster {
    constructor() { this.fit([]); }

    // visitTimes: array of check-in timestamps in ms
    fit(visitTimes) {
        this.times = visitTimes.filter(Number.isFinite).sort((a, b) => a - b);
        this.counts = new Map();
        this.times.forEach(t => { const h = floorHour(t); this.counts.set(h, (this.counts.get(h) || 0) + 1); });
        this.firstT = this.times.length ? floorHour(this.times[0]) : 0;

        // Busy/quiet thresholds relative to this gym: hourly counts over the last 4 weeks
        const recent = [...this.counts].filter(([h]) => h > Date.now() - 28 * DAY).map(([, c]) => c).sort((a, b) => a - b);
        const q = p => recent.length ? recent[Math.min(recent.length - 1, Math.floor(p * recent.length))] : 0;
        this.q = { q50: q(0.5), q75: q(0.75), q90: q(0.9) };

        // hours of the day with at least one check-in in the last 8 weeks = the gym's opening hours
        const since = Date.now() - 56 * DAY;
        this.openHours = new Set(this.times.filter(t => t >= since).map(t => new Date(t).getHours()));
    }

    _get(h) { return this.counts.get(h) || 0; }

    _countBetween(a, b) {                  // check-ins in [a, b)
        const lb = x => { let lo = 0, hi = this.times.length; while (lo < hi) { const m = (lo + hi) >> 1; if (this.times[m] < x) lo = m + 1; else hi = m; } return lo; };
        return lb(b) - lb(a);
    }

    _baseline(T) {                         // expected check-ins in the hour starting at T, from history only
        const weekly = [], daily = [];
        for (let k = 1; k <= 8; k++) { const h = T - k * WEEK; if (h < this.firstT) break; weekly.push(this._get(h)); }
        for (let k = 1; k <= 28 && daily.length < 10; k++) {
            const h = T - k * DAY;
            if (h < this.firstT) break;
            if (k % 7 !== 0 && isWeekend(h) === isWeekend(T)) daily.push(this._get(h));
        }
        const nW = weekly.length;
        const wWeekly = nW >= 4 ? 0.8 : nW >= 2 ? 0.6 : nW === 1 ? 0.4 : 0;
        const wk = wavg(weekly, 0.8), dy = wavg(daily, 0.9);
        const exp = nW && daily.length ? wWeekly * wk + (1 - wWeekly) * dy : (nW ? wk : dy);
        return { exp, nW };
    }

    _forecast(T, asOf) {                   // forecast for hour starting T, knowing data up to asOf
        const cur = T - HOUR;              // hour in progress at asOf
        const base = this._baseline(T);
        let actual = 0, expected = 0;
        for (let i = 0; i < 3; i++) {
            const h = cur - i * HOUR;
            if (h < this.firstT) break;
            const frac = i === 0 ? clamp((asOf - cur) / HOUR, 0, 1) : 1;
            if (frac < 0.2) continue;      // too little of the current hour has elapsed to say anything
            actual += i === 0 ? this._countBetween(cur, asOf) : this._get(h);
            expected += this._baseline(h).exp * frac;
        }
        const ratio = expected >= 2 ? clamp((actual + 2) / (expected + 2), 0.6, 1.6) : 1;
        return { value: Math.max(0, base.exp * (1 + 0.3 * (ratio - 1))), ratio, nW: base.nW };
    }

    _backtest(now) {                       // one-step-ahead errors over the last 4 days, forecast made mid-previous-hour
        const errs = [], lastDone = floorHour(now) - HOUR;
        for (let j = 0; j < 96; j++) {
            const T = lastDone - j * HOUR;
            if (T - WEEK < this.firstT) break;
            const f = this._forecast(T, T - HOUR + HOUR / 2).value, a = this._get(T);
            if (f > 0.05 || a > 0) errs.push({ e: a - f, a });
        }
        return errs;
    }

    predict(now = Date.now()) {
        if (!this.times.length) return { ready: false, factors: ['no check-in history yet'] };

        const T = floorHour(now) + HOUR;
        if ((now - this.firstT) / WEEK >= 1 && !this.openHours.has(new Date(T).getHours()))
            return { ready: true, closed: true, raw: 0, prediction: 0, confidence: 0.9, range: [0, 0], factors: ['gym is usually closed at this hour'], trend: 'stable' };
        const f = this._forecast(T, now);
        const errs = this._backtest(now), n = errs.length;
        const mae = n ? errs.reduce((s, x) => s + Math.abs(x.e), 0) / n : 0;
        const rmse = n ? Math.sqrt(errs.reduce((s, x) => s + x.e * x.e, 0) / n) : 1;
        const meanActual = n ? Math.max(1, errs.reduce((s, x) => s + x.a, 0) / n) : 1;

        const weeks = (now - this.firstT) / WEEK;
        let confidence = n >= 12 ? 0.92 - 0.55 * (mae / meanActual) : 0.4;
        if (weeks < 1) confidence = Math.min(confidence, 0.35);
        else if (weeks < 2) confidence = Math.min(confidence, 0.55);
        confidence = clamp(confidence, 0.2, 0.92);

        const sigma = Math.max(0.5, n >= 8 ? rmse : 1);
        const range = [Math.max(0, Math.round(f.value - 1.28 * sigma)), Math.round(f.value + 1.28 * sigma)];

        const factors = [f.nW >= 2 ? `weekly pattern (${f.nW} wks)` : weeks < 1 ? 'less than a week of data' : 'daily pattern'];
        factors.push(f.ratio > 1.15 ? 'busier than usual today' : f.ratio < 0.85 ? 'quieter than usual today' : 'on typical pace');

        return {
            ready: true, raw: f.value, prediction: Math.round(f.value), confidence, range, factors,
            trend: f.ratio > 1.15 ? 'rising' : f.ratio < 0.85 ? 'falling' : 'stable'
        };
    }

    getPrediction() { return this.predict(); }

    level(v) {                             // Quiet / Moderate / Busy / Very Busy, relative to this gym's own history
        const q = this.q;
        return q.q90 > 0 && v >= q.q90 ? 'Very Busy' : q.q75 > 0 && v >= q.q75 ? 'Busy' : q.q50 > 0 && v >= q.q50 ? 'Moderate' : 'Quiet';
    }
}
