// queue-logic.js — what each saved check-in / check-out does to a record.
// Plain functions, no Firebase: used both when uploading and when previewing "waiting" changes on screen.

const arr = h => (Array.isArray(h) ? h : Object.values(h || {})).filter(Boolean).map(v => ({ ...v }));
const mins = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000));
const done = () => ({ value: undefined, verdict: 'already' });

// cur = the record as it is now (null if it doesn't exist). Returns { value, verdict }:
//   verdict 'ok'               = applied
//   verdict 'already'          = nothing to do, the record is already in that state (value undefined = leave it alone)
//   verdict { conflict: text } = could not be applied
// When cur is null a value other than undefined is always returned, so the database re-checks against the real
// data instead of ending the transaction early on a not-yet-loaded copy.
export function applyEntry(cur, e) {
    if (e.type === 'walkin_in') return cur == null ? { value: e.record, verdict: 'ok' } : done();
    if (cur == null) return { value: null, verdict: { conflict: 'that record no longer exists' } };

    const g = cur.gym_data || {}, hist = arr(cur.attendance_history);

    if (e.type === 'member_in') {
        if (hist.some(v => v.checkin === e.at)) return done();                       // this exact scan was already uploaded
        if (g.is_checked_in === true && hist.some(v => !v.checkout)) return done();   // another station already checked them in
        hist.unshift({ checkin: e.at, checkout: null, time_spent: null, date: e.at.split('T')[0] });
        return { value: { ...cur, gym_data: { ...g, is_checked_in: true, last_checkin: e.at }, attendance_history: hist.slice(0, 100) }, verdict: 'ok' };
    }

    if (e.type === 'member_out' || e.type === 'walkin_out') {
        if (hist.some(v => v.checkout === e.at) || g.is_checked_in !== true) return done();   // already uploaded, or already out
        const open = hist.find(v => !v.checkout);
        const t = mins(open?.checkin || g.last_checkin || e.at, e.at);
        if (open) { open.checkout = e.at; open.time_spent = t; }
        const total = (g.total_time_spent || 0) + t;
        const gym = e.type === 'member_out'
            ? { ...g, is_checked_in: false, last_checkout: e.at, total_time_spent: total, total_visits: (g.total_visits || 0) + 1 }
            : { ...g, is_checked_in: false, last_checkout: e.at, time_spent: t, total_time_spent: total };
        return {
            value: { ...cur, gym_data: gym, attendance_history: hist, ...(e.type === 'walkin_out' ? { membership: { ...cur.membership, status: 'completed' } } : {}) },
            verdict: 'ok'
        };
    }
    return { value: undefined, verdict: { conflict: 'unknown action' } };
}
