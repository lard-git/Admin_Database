// sw.js — lets the admin pages open with no internet. Files are saved the first time they are loaded online.
const CACHE = 'gym-admin-v1';                       // bump this number to force everyone to re-download the files

const FILES = [
  'members.html', 'occupancy.html', 'analytics.html', 'firebase_crud.html',
  'resources/theme.css', 'resources/members.css', 'resources/occupancy.css', 'resources/analytics.css', 'resources/firebase-crud.css',
  'js/ui.js', 'js/members.js', 'js/occupancy.js', 'js/analytics.js', 'js/app.js', 'js/auth.js',
  'js/database_init.js', 'js/forecast.js', 'js/membership.js', 'js/offline.js',
  'resources/lollang.png', 'FOT-Skip%20Std%20B.otf',
];
const LIBRARIES = [
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.11.0/firebase-database.js',
];
// the only outside hosts we keep copies of (code libraries). Database traffic and the QR image service are never touched.
const LIBRARY_HOSTS = ['www.gstatic.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // one missing file must not stop the rest from being saved
    await Promise.all(FILES.map(f => cache.add(f).catch(() => {})));
    await Promise.all(LIBRARIES.map(u => fetch(u).then(r => (r.ok || r.type === 'opaque') && cache.put(u, r)).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) event.respondWith(networkFirst(req));
  else if (LIBRARY_HOSTS.includes(url.hostname)) event.respondWith(staleWhileRevalidate(req));
  // anything else (database, QR service) goes straight to the network
});

const keep = (req, res) => { if (res && (res.ok || res.type === 'opaque')) caches.open(CACHE).then(c => c.put(req, res.clone())); return res; };

// your own pages and scripts: always try the network first so edits show up, fall back to the saved copy offline
async function networkFirst(req) {
  try { return keep(req, await fetch(req)); }
  catch {
    return (await caches.match(req, { ignoreSearch: true }))
        || (req.mode === 'navigate' ? await caches.match('members.html') : undefined)
        || Response.error();
  }
}

// libraries: serve the saved copy instantly, refresh it in the background
async function staleWhileRevalidate(req) {
  const cached = await caches.match(req);
  const refresh = fetch(req).then(res => keep(req, res)).catch(() => cached);
  return cached || refresh;
}
