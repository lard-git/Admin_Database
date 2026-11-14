// holtwinters.js — additive Holt-Winters (triple exponential smoothing) check-in forecaster.
//
// Drop-in replacement for EnhancedForecaster: same methods (fit, predict, predictDaily, getPrediction, level, levelDaily),
// same result shape. It extends EnhancedForecaster so the "Quiet / Busy" levels, the opening-hours detection and the
// daily counts keep working, and it FALLS BACK to the old seasonal-average method until there is enough history.
//
// Model (additive, optional damped trend), one step at a time:
//   forecast     ŷ[t] = l[t-1] + φ·b[t-1] + s[t-m]
//   error        e[t] = y[t] − ŷ[t]
//   level        l[t] = l[t-1] + φ·b[t-1] + α·e[t]
//   trend        b[t] = φ·b[t-1] + α·β·e[t]            (same as b = β(l[t]−l[t-1]) + (1−β)φ·b[t-1])
//   season       s[t] = s[t-m]   + γ·e[t]
// Hourly: m = 168 (hour of the week).  Daily: m = 7 (day of the week).
// Multiplicative seasonality (ŷ = (l + φb)·s, with s ≈ 1 for an average slot) is also available: it suits a gym whose
// whole schedule grows or shrinks together. opts.seasonal = 'add' | 'mul' | 'auto' (default: fit both, keep the lower error).
// α, β, γ are fitted per gym by minimising one-step-ahead squared error (Nelder-Mead, 3 starting points).
//
// Needs 3 full seasons of history (3 weeks) — 1 to initialise, 2 to learn from. Before that the old method is used.

import { EnhancedForecaster } from './forecast.js';

const HOUR = 3600000, DAY = 24 * HOUR, WEEK = 7 * DAY;
const floorHour = t => { const d = new Date(t); d.setMinutes(0, 0, 0); return d.getTime(); };
const floorDay = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const addDays = (t, n) => { const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;

const BOUNDS = { alpha: [0.001, 0.99], beta: [0.0001, 0.5], gamma: [0.001, 0.99] };
const clampParams = p => ({
    alpha: clamp(p.alpha, ...BOUNDS.alpha), beta: clamp(p.beta, ...BOUNDS.beta), gamma: clamp(p.gamma, ...BOUNDS.gamma), phi: p.phi ?? 1, mode: p.mode || 'add'
});

// ── core filter ─────────────────────────────────────────────────────────────
// y: array of observations (oldest first), m: season length, p: {alpha, beta, gamma, phi}.
// Returns the final state plus the one-step-ahead forecasts/errors for every point after the first season.
export function hwFilter(y, m, p, keep = true) {
    const n = y.length, { alpha, beta, gamma, phi } = p, mul = p.mode === 'mul';
    if (n < 2 * m) throw new Error('need at least 2 seasons');

    // initial state, taken from the first two seasons
    const m1 = mean(y.slice(0, m)), m2 = mean(y.slice(m, 2 * m));
    let b = (m2 - m1) / m;                                  // average change per step between season 1 and 2
    let l = m1 + b * (m - 1) / 2;                           // level at the END of season 1 (the mean sits at its middle)
    const buf = new Array(m);                               // buf[t % m] = latest seasonal value for that slot
    for (let i = 0; i < m; i++) {
        const base = m1 + b * (i - (m - 1) / 2);
        buf[i] = mul ? (base > 1e-9 ? y[i] / base : 1) : y[i] - base;
    }

    let sse = 0;
    const fitted = keep ? new Array(n).fill(null) : null, err = keep ? new Array(n).fill(null) : null, levels = keep ? new Array(n).fill(null) : null;
    for (let t = m; t < n; t++) {
        const slot = t % m, s0 = buf[slot], lb = l + phi * b;
        const yhat = mul ? lb * s0 : lb + s0, e = y[t] - yhat;
        if (mul) {
            const lNew = s0 > 1e-6 ? alpha * (y[t] / s0) + (1 - alpha) * lb : lb;      // a slot that is always 0 says nothing about the level
            b = beta * (lNew - l) + (1 - beta) * phi * b;
            if (lb > 1e-9) buf[slot] = gamma * (y[t] / lb) + (1 - gamma) * s0;
            l = lNew;
        } else {
            l = lb + alpha * e;
            b = phi * b + alpha * beta * e;
            buf[slot] = s0 + gamma * e;
        }
        sse += e * e;
        if (keep) { fitted[t] = yhat; err[t] = e; levels[t] = l; }
    }
    return { l, b, buf, n, m, sse, fitted, err, levels, mul };
}

// h-step-ahead forecast from a filtered state (h = 1 is the very next point after the series)
export function hwForecast(st, h, phi = 1) {
    let phiSum = 0, pw = 1;
    for (let i = 1; i <= h; i++) { pw *= phi; phiSum += pw; }
    const base = st.l + phiSum * st.b, seas = st.buf[(st.n + h - 1) % st.m];
    return st.mul ? base * seas : base + seas;
}

// standard deviation of the h-step forecast error (exact for the additive model; a close approximation for the multiplicative one)
export function hwSigmaH(sigma, p, h, m) {
    let v = 1, phiSum = 0, pw = 1;
    for (let j = 1; j < h; j++) {
        pw *= p.phi; phiSum += pw;
        const c = p.alpha + p.alpha * p.beta * phiSum + (j % m === 0 ? p.gamma : 0);
        v += c * c;
    }
    return sigma * Math.sqrt(v);
}

// ── fitting ─────────────────────────────────────────────────────────────────
function nelderMead(f, x0, step, iters = 160) {
    const n = x0.length, pts = [x0.slice()];
    for (let i = 0; i < n; i++) { const x = x0.slice(); x[i] += step[i]; pts.push(x); }
    let vals = pts.map(f);
    for (let it = 0; it < iters; it++) {
        const idx = vals.map((v, i) => i).sort((a, b) => vals[a] - vals[b]);
        const P = idx.map(i => pts[i]), V = idx.map(i => vals[i]);
        for (let i = 0; i <= n; i++) { pts[i] = P[i]; vals[i] = V[i]; }
        if (Math.abs(vals[n] - vals[0]) < 1e-9 * (1 + Math.abs(vals[0]))) break;
        const c = Array(n).fill(0);
        for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) c[k] += pts[i][k] / n;
        const at = k => c.map((ck, j) => ck + k * (pts[n][j] - ck));
        const xr = at(-1), fr = f(xr);
        if (fr < vals[0]) {
            const xe = at(-2), fe = f(xe);
            if (fe < fr) { pts[n] = xe; vals[n] = fe; } else { pts[n] = xr; vals[n] = fr; }
        } else if (fr < vals[n - 1]) { pts[n] = xr; vals[n] = fr; }
        else {
            const xc = fr < vals[n] ? at(-0.5) : at(0.5), fc = f(xc);
            if (fc < Math.min(fr, vals[n])) { pts[n] = xc; vals[n] = fc; }
            else for (let i = 1; i <= n; i++) { pts[i] = pts[i].map((x, j) => pts[0][j] + 0.5 * (x - pts[0][j])); vals[i] = f(pts[i]); }
        }
    }
    const best = vals.indexOf(Math.min(...vals));
    return { x: pts[best], value: vals[best] };
}

// mode: 'add' | 'mul' | 'auto' (fit both, keep the one with the smaller one-step-ahead error)
export function fitHW(y, m, phi = 1, mode = 'auto') {
    const one = md => {
        const obj = x => hwFilter(y, m, clampParams({ alpha: x[0], beta: x[1], gamma: x[2], phi, mode: md }), false).sse;
        const starts = [[0.1, 0.01, 0.1], [0.3, 0.05, 0.3], [0.05, 0.002, 0.05]];
        let best = null;
        for (const s of starts) {
            const r = nelderMead(obj, s, [0.1, 0.02, 0.1]);
            if (!best || r.value < best.value) best = r;
        }
        return { ...clampParams({ alpha: best.x[0], beta: best.x[1], gamma: best.x[2], phi, mode: md }), sse: best.value };
    };
    if (mode === 'add' || mode === 'mul') return one(mode);
    const a = one('add'), mu = one('mul');
    return mu.sse < a.sse ? mu : a;
}

// ── forecaster ──────────────────────────────────────────────────────────────
export class HoltWintersForecaster extends EnhancedForecaster {
    // opts.phi: trend damping (1 = none). opts.seasonal: 'add' | 'mul' | 'auto'. opts.minSeasons: seasons of history required (default 3).
    constructor(opts = {}) {
        super();
        this.opts = { phi: 1, minSeasons: 3, hourlyWeeks: 10, seasonal: 'auto', ...opts };
        this.fit([]);
    }

    fit(visitTimes) {
        super.fit(visitTimes);
        this.hw = { hourly: null, daily: null };
        if (!this.times.length || !this.opts) return;            // (super's constructor calls fit before opts exist)
        const now = Date.now();
        const hs = this._hourlySeries(now), ds = this._dailySeries(now);
        if (hs) this.hw.hourly = fitHW(hs.y, 168, this.opts.phi, this.opts.seasonal);
        if (ds) this.hw.daily = fitHW(ds.y, 7, this.opts.phi, this.opts.seasonal);
    }

    // check-ins per hour, from the (up to) last N weeks, ending with the last COMPLETE hour before `now`
    _hourlySeries(now) {
        const last = floorHour(now) - HOUR, first = Math.max(this.firstT, last - this.opts.hourlyWeeks * WEEK + HOUR);
        const n = Math.floor((last - first) / HOUR) + 1;
        if (n < this.opts.minSeasons * 168) return null;
        const y = new Array(n);
        for (let i = 0; i < n; i++) y[i] = this._get(first + i * HOUR);
        return { y, last };
    }

    // check-ins per calendar day, ending with yesterday (today is still running)
    _dailySeries(now) {
        const last = addDays(floorDay(now), -1), first = floorDay(this.firstT);
        const y = [];
        for (let d = first; d <= last; d = addDays(d, 1)) y.push(this._dget(d));
        return y.length >= this.opts.minSeasons * 7 ? { y, last } : null;
    }

    _hwResult(series, params, m, h, now, nRecent, minN, weeksOfData, rail, railMin) {
        const st = hwFilter(series.y, m, params);
        let raw = Math.max(0, hwForecast(st, h, params.phi)), guarded = false;
        // safety rail: a quiet stretch or a gap in the scans (offline, forgotten check-ins) can drag Holt-Winters' level far
        // below normal. Keep the forecast within 0.5x–2x of the plain seasonal average for this slot.
        if (rail > railMin) { const g = clamp(raw, rail * 0.5, rail * 2); guarded = g !== raw; raw = g; }

        // recent one-step-ahead errors: the model's own track record
        const rec = [];
        for (let t = st.n - 1; t >= st.m && rec.length < nRecent; t--) {
            const a = series.y[t], f = Math.max(0, st.fitted[t]);
            if (f > 0.05 || a > 0) rec.push({ e: a - f, a });
        }
        const k = rec.length;
        const mae = k ? rec.reduce((s, x) => s + Math.abs(x.e), 0) / k : 0;
        const rmse = k ? Math.sqrt(rec.reduce((s, x) => s + x.e * x.e, 0) / k) : 1;
        const meanActual = k ? Math.max(1, rec.reduce((s, x) => s + x.a, 0) / k) : 1;

        let confidence = k >= minN ? 0.92 - 0.55 * (mae / meanActual) : 0.4;
        if (weeksOfData < 2) confidence = Math.min(confidence, 0.55);
        confidence = clamp(confidence, 0.2, 0.92);

        const sigma = hwSigmaH(Math.max(m === 168 ? 0.5 : 1, k >= minN ? rmse : 1), params, h, m);
        const range = [Math.max(0, Math.round(raw - 1.28 * sigma)), Math.round(raw + 1.28 * sigma)];

        // "busier / quieter than usual": the level now vs the level one season ago
        const lagLevel = st.levels[st.n - 1 - m];
        const ratio = lagLevel != null ? (st.l + 0.5) / (lagLevel + 0.5) : 1;
        const factors = [`Holt-Winters ${params.mode === 'mul' ? 'multiplicative' : 'additive'} (${m === 168 ? 'hour-of-week' : 'day-of-week'} pattern)`];
        factors.push(ratio > 1.15 ? 'busier than usual lately' : ratio < 0.85 ? 'quieter than usual lately' : 'on typical pace');
        if (guarded) factors.push('held near the usual pattern');
        return {
            ready: true, raw, prediction: Math.round(raw), confidence, range, factors,
            trend: ratio > 1.15 ? 'rising' : ratio < 0.85 ? 'falling' : 'stable', model: 'holt-winters', params
        };
    }

    predict(now = Date.now()) {
        if (!this.times.length) return { ready: false, factors: ['no check-in history yet'] };
        const series = this.hw && this.hw.hourly && this._hourlySeries(now);
        if (!series) return { ...super.predict(now), model: 'seasonal-average (not enough history for Holt-Winters)' };

        const T = floorHour(now) + HOUR, weeks = (now - this.firstT) / WEEK;
        if (!this.openHours.has(new Date(T).getHours()))
            return { ready: true, closed: true, raw: 0, prediction: 0, confidence: 0.9, range: [0, 0], factors: ['gym is usually closed at this hour'], trend: 'stable', model: 'holt-winters' };
        // series ends at the last complete hour; the target is 2 hours after it (the current hour is still in progress)
        return this._hwResult(series, this.hw.hourly, 168, 2, now, 96, 12, weeks, this._baseline(T).exp, 0.5);
    }

    predictDaily(now = Date.now()) {
        if (!this.times.length) return { ready: false, factors: ['no check-in history yet'] };
        const series = this.hw && this.hw.daily && this._dailySeries(now);
        if (!series) return { ...super.predictDaily(now), model: 'seasonal-average (not enough history for Holt-Winters)' };

        const today = floorDay(now), T = addDays(today, 1), weeks = (now - this.firstT) / WEEK;
        const since = now - 56 * DAY, openDays = new Set(this.times.filter(t => t >= since).map(t => new Date(t).getDay()));
        if (!openDays.has(new Date(T).getDay()))
            return { ready: true, closed: true, target: T, raw: 0, prediction: 0, confidence: 0.9, range: [0, 0], factors: ['gym is usually closed on this day'], trend: 'stable', model: 'holt-winters' };
        // series ends yesterday; the target is tomorrow = 2 days ahead
        return { ...this._hwResult(series, this.hw.daily, 7, 2, now, 14, 7, weeks, this._dbaseline(T).exp, 3), target: T };
    }
}
