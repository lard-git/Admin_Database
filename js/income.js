// income.js — works out income per day from the Customers records, for ANY month, and builds the CSV download.
//
// Memberships: each payment counts on the day it was paid. New and extended memberships write a payment entry
// (Customers/<id>/payments); for older members without one, their total counts on their start date (what the old code did).
// Walk-ins: each counts on the day they checked in (₱40 unless a payment is recorded).
// All dates are local (the Philippines) — toISOString() is UTC and puts early-morning payments on the previous day.

import { localDateKey, parseDate } from './membership.js';

const dayOf = s => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s)) ? s.slice(0, 10) : null;

// customers: the whole Customers object  ->  { 'YYYY-MM-DD': { membership, walkin } }
export function buildIncomeByDay(customers) {
    const days = {};
    const add = (date, kind, amount) => {
        if (!date || !(amount > 0)) return;
        (days[date] ||= { membership: 0, walkin: 0 })[kind] += amount;
    };

    for (const [key, data] of Object.entries(customers || {})) {
        if (!data || typeof data !== 'object' || key.startsWith('_')) continue;

        if (key.startsWith('WALKIN_')) {
            let t = Date.parse(data.gym_data?.last_checkin || data.timestamp || '');
            if (isNaN(t)) { const m = key.match(/_(\d{13})(?:_|$)/); t = m ? +m[1] : NaN; }
            if (isNaN(t)) continue;
            add(localDateKey(new Date(t)), 'walkin', Number(data.payment || data.payment_amount || 40));
            continue;
        }

        const ledger = data.payments && typeof data.payments === 'object' ? Object.values(data.payments) : [];
        if (ledger.length) ledger.forEach(p => add(dayOf(p?.date), 'membership', Number(p?.amount) || 0));
        else add(dayOf(data.membership?.start_date) || dayOf(data.membership?.last_updated), 'membership', Number(data.membership?.payment_amount) || 0);
    }
    return days;
}

// 'YYYY-MM' of the first day with any income, or null
export const earliestMonth = days => { const k = Object.keys(days).sort()[0]; return k ? k.slice(0, 7) : null; };

// every month from the first one with income up to this month, oldest first
export function listMonths(days, today = new Date()) {
    const cur = localDateKey(today).slice(0, 7), first = earliestMonth(days) || cur, out = [];
    let [y, m] = first.split('-').map(Number);
    for (;;) {
        const key = `${y}-${String(m).padStart(2, '0')}`;
        out.push(key);
        if (key >= cur) break;
        if (++m > 12) { m = 1; y++; }
    }
    return out;
}

// CSV text. month = 'YYYY-MM' for one month, or null for all history. Opens straight in Excel.
export function incomeCSV(days, month, today = new Date()) {
    const todayKey = localDateKey(today);
    let from, to;
    if (month) {
        const [y, m] = month.split('-').map(Number);
        from = `${month}-01`;
        to = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
        if (to > todayKey) to = todayKey;                       // no future days
    } else {
        from = Object.keys(days).sort()[0] || todayKey;
        to = todayKey;
    }
    const rows = [['Date', 'Memberships (PHP)', 'Walk-ins (PHP)', 'Total (PHP)']];
    let tm = 0, tw = 0;
    for (let d = parseDate(from); localDateKey(d) <= to; d.setDate(d.getDate() + 1)) {
        const k = localDateKey(d), v = days[k] || { membership: 0, walkin: 0 };
        tm += v.membership; tw += v.walkin;
        rows.push([k, v.membership, v.walkin, v.membership + v.walkin]);
    }
    rows.push(['TOTAL', tm, tw, tm + tw]);
    return '\uFEFF' + rows.map(r => r.join(',')).join('\r\n') + '\r\n';
}
