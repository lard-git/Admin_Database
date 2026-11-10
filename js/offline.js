// offline.js — keeps a saved copy of what the pages read from the database and serves it when the database can't be reached.
// Pages import ref / get / onValue / set / update / remove from here instead of from Firebase directly.
//
// STEP 2 (bottom of this file): check-ins and check-outs are saved on this computer first and uploaded when the database confirms them.
// STEP 1 (this file): read side. Pages open and show the last-known data with an "Offline" banner.
// Writes while offline are refused with a clear message (queued saving comes in step 2). Deleting members will always need a connection.

import { db } from './database_init.js';
import { ref as fbRef, get as fbGet, onValue as fbOnValue, set as fbSet, update as fbUpdate, remove as fbRemove, runTransaction as fbRunTransaction }
    from "https://www.gstatic.com/firebasejs/10.11.0/firebase-database.js";
import { applyEntry } from './queue-logic.js';

// ── connection state (other scripts listen for the 'gym-net' event) ──
export const netState = { connected: null, usingSaved: false, lastSync: null, pending: 0 };   // pending = check-ins/outs saved here, not yet uploaded
const emit = () => window.dispatchEvent(new CustomEvent('gym-net', { detail: { ...netState } }));

fbOnValue(fbRef(db, '.info/connected'), s => {
    netState.connected = s.val() === true;
    if (netState.connected) netState.usingSaved = false;
    emit();
    if (netState.connected) syncQueue();          // connection is back: upload whatever is waiting
});

// ── tiny IndexedDB key-value store ──
let dbPromise;
const idb = () => dbPromise ||= new Promise((res, rej) => {
    const r = indexedDB.open('gym-offline', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('cache');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
});
async function idbGet(key) {
    try {
        const d = await idb();
        return await new Promise((res, rej) => { const q = d.transaction('cache').objectStore('cache').get(key); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    } catch { return undefined; }
}
async function idbSet(key, value) {
    try {
        const d = await idb();
        await new Promise((res, rej) => { const t = d.transaction('cache', 'readwrite'); t.objectStore('cache').put(value, key); t.oncomplete = res; t.onerror = () => rej(t.error); });
    } catch { /* storage full or blocked: the live data still works */ }
}

// ── saved copies: only top-level paths (Customers, WeeklyGrowthRate…) are stored; sub-paths are read out of them. Admin/* is never stored. ──
const parts = path => path.split('/').filter(Boolean);
const timers = {};
function saveCopy(path, value) {
    if (parts(path).length !== 1 || parts(path)[0] === 'Admin' || path.startsWith('.')) return;
    clearTimeout(timers[path]);                                   // a busy gym fires many updates: save at most every 2 s
    timers[path] = setTimeout(() => idbSet('tree:' + path, { value, savedAt: Date.now() }), 2000);
}
const dig = (obj, ps) => ps.reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj) ?? null;
async function loadCopy(path) {
    const ps = parts(path);
    if (!ps.length || ps[0] === 'Admin') return undefined;
    const top = await idbGet('tree:' + ps[0]);
    return top ? { value: dig(top.value, ps.slice(1)), savedAt: top.savedAt } : undefined;
}

// ── a stand-in for Firebase's DataSnapshot, built from a saved copy ──
class LocalSnapshot {
    constructor(key, value) { this.key = key; this._v = value ?? null; }
    val() { return this._v; }
    exists() { return this._v !== null && this._v !== undefined; }
    hasChildren() { return !!this._v && typeof this._v === 'object' && Object.keys(this._v).length > 0; }
    numChildren() { return this._v && typeof this._v === 'object' ? Object.keys(this._v).length : 0; }
    child(path) { const ps = parts(path); return new LocalSnapshot(ps[ps.length - 1] ?? null, dig(this._v, ps)); }
    forEach(cb) {
        if (!this._v || typeof this._v !== 'object') return false;
        for (const [k, v] of Object.entries(this._v)) if (cb(new LocalSnapshot(k, v)) === true) return true;
        return false;
    }
}
const serveSaved = (r, saved) => { netState.usingSaved = true; netState.lastSync = saved.savedAt; emit(); return new LocalSnapshot(r.key, saved.value); };

// ── drop-in replacements for the Firebase functions the pages use ──
export const ref = (d, path = '') => { const r = fbRef(d, path); r.__path = path; return r; };

export function onValue(r, callback, errorCallback) {
    const path = r.__path ?? '';
    let gotServer = false, stopped = false;
    // no answer from the database within 2.5 s and not connected: show the saved copy instead of an empty page
    const timer = setTimeout(async () => {
        if (gotServer || stopped || netState.connected === true) return;
        const saved = await loadCopy(path);
        if (saved && !gotServer && !stopped) callback(serveSaved(r, saved));
    }, 2500);
    const unsubscribe = fbOnValue(r, snap => {
        gotServer = true;
        netState.lastSync = Date.now();
        if (netState.usingSaved) { netState.usingSaved = false; emit(); }
        saveCopy(path, snap.val());
        callback(snap);
    }, errorCallback);
    return () => { stopped = true; clearTimeout(timer); unsubscribe(); };
}

const connectionKnown = ms => new Promise(resolve => {
    if (netState.connected !== null) return resolve(netState.connected);
    const t = setTimeout(() => { window.removeEventListener('gym-net', on); resolve(netState.connected); }, ms);
    const on = () => { if (netState.connected !== null) { clearTimeout(t); window.removeEventListener('gym-net', on); resolve(netState.connected); } };
    window.addEventListener('gym-net', on);
});

export async function get(r) {
    const path = r.__path ?? '';
    if (await connectionKnown(2000) !== true) {
        const saved = await loadCopy(path);
        if (saved) return serveSaved(r, saved);
    }
    const snap = await fbGet(r);
    netState.lastSync = Date.now();
    saveCopy(path, snap.val());
    return snap;
}

// ── writes: refused while offline for now (step 2 replaces this with a saved-and-sent-later queue) ──
const offlineError = what => new Error(`You're offline, so ${what} can't be saved yet. Reconnect and try again.`);
const blocked = () => netState.connected === false;
export const set = (r, v) => { if (blocked()) throw offlineError('this change'); return fbSet(r, v); };
export const update = (r, v) => { if (blocked()) throw offlineError('this change'); return fbUpdate(r, v); };
export const remove = r => { if (blocked()) throw new Error("You're offline. Members can only be deleted while you're online."); return fbRemove(r); };


// ═══ Saved check-ins / check-outs ═══
// Every scan is written to this browser first (IndexedDB), then uploaded. Nothing is removed from the list until the database has confirmed it,
// so a dropped connection, a closed tab or a crash can't lose a scan. Each scan keeps its real time (`at`), so stay times and analytics stay right.
// What each scan does to a record is in queue-logic.js. Uploading uses a transaction per record and is safe to repeat.
let Q = [], R = [];                                // Q = waiting to upload, R = could not be applied (needs a look)
const ready = (async () => { Q = (await idbGet('queue')) || []; R = (await idbGet('review')) || []; changed(); })();
const saveQ = () => Promise.all([idbSet('queue', Q), idbSet('review', R)]);
function changed() { netState.pending = Q.length; window.dispatchEvent(new CustomEvent('gym-queue')); emit(); }

const WHAT = { member_in: 'check-in', member_out: 'check-out', walkin_in: 'walk-in', walkin_out: 'walk-out' };
const describe = e => `${e.label || e.key} ${WHAT[e.type] || e.type} (${new Date(e.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })})`;

// entry: { type: 'member_in' | 'member_out' | 'walkin_in' | 'walkin_out', key, label, record? (walkin_in only), at? }
export async function submit(entry) {
    await ready;
    const e = { id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()), at: new Date().toISOString(), tries: 0, ...entry };
    Q.push(e);
    await saveQ(); changed();
    syncQueue();
    return e;
}

let syncing = false;
export async function syncQueue() {
    await ready;
    if (syncing || netState.connected !== true) return;
    syncing = true;
    try {
        while (Q.length && netState.connected === true) {
            const e = Q[0];
            let verdict;
            try {
                await Promise.race([
                    fbRunTransaction(fbRef(db, `Customers/${e.key}`), cur => { const o = applyEntry(cur, e); verdict = o.verdict; return o.value; }),
                    new Promise((_, rej) => setTimeout(() => rej(new Error('no answer from the database')), 15000))
                ]);
            } catch (err) {
                console.error('Upload failed:', err);
                e.tries = (e.tries || 0) + 1;
                if (e.tries >= 5) { Q.shift(); R.push({ id: e.id, text: `${describe(e)} could not be uploaded: ${err.message}.` }); }
                await saveQ(); changed();
                break;                              // try again later (when the connection returns, or every 20 s)
            }
            Q.shift();
            if (verdict && verdict.conflict) R.push({ id: e.id, text: `${describe(e)} was not applied: ${verdict.conflict}.` });
            await saveQ(); changed();
        }
    } finally { syncing = false; }
}
setInterval(() => { if (Q.length) syncQueue(); }, 20000);
ready.then(() => syncQueue());

// ── used by the Occupancy page ──
export const hasPending = key => Q.some(e => e.key === key);
export const pendingWalkinKeys = () => Q.filter(e => e.type === 'walkin_in').map(e => e.key);
// a record with the waiting scans applied on top (so the screen shows them straight away)
export function overlayPending(key, data) {
    let cur = data ?? null;
    for (const e of Q) if (e.key === key) { const o = applyEntry(cur, e); if (o.verdict === 'ok' && o.value) cur = o.value; }
    return cur;
}
export const review = { list: () => [...R], dismiss: id => { R = R.filter(r => r.id !== id); saveQ(); changed(); } };
