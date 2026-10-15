
const DAY = 86400000;

// 'YYYY-MM-DD' -> local date (new Date('YYYY-MM-DD') is UTC midnight and can land on the wrong day)
export function parseDate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(s);
}

// Local calendar day as 'YYYY-MM-DD' (toISOString() is UTC and gives the previous day before 8 AM in the Philippines)
export function localDateKey(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// The end date counts as the last valid day: end_date 11-11 shows 1 all day on Nov 11 and 0 from Nov 12.
export function liveRemainingDays(m, now = new Date()) {
    if (!m || m.status === 'expired') return 0;
    let end = null;
    if (m.end_date) end = parseDate(m.end_date);
    else if (m.start_date && m.months_paid) { end = parseDate(m.start_date); end.setMonth(end.getMonth() + (m.months_paid || 1)); }
    if (!end || isNaN(end)) return m.remaining_days || 0;
    end.setHours(23, 59, 59, 999);
    return Math.max(0, Math.ceil((end - now) / DAY));
}

export function liveStatus(m, now = new Date()) {
    return !m || m.status === 'expired' || liveRemainingDays(m, now) <= 0 ? 'expired' : (m.status || 'active');
}

// Copy of a membership object with remaining_days / status replaced by live values
export function withLiveMembership(m) {
    const base = m || { status: 'active', remaining_days: 30, start_date: '', end_date: '' };
    return { ...base, remaining_days: liveRemainingDays(base), status: liveStatus(base) };
}
