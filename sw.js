// AZHARS service worker: lets the store install as an app and load its shell when the network is slow or offline.
// It never stores prices, carts, accounts or orders (anything under /api/ always goes to the live server).
const VERSION = 'azhars-v1';
const SHELL = ['/', '/css/style.css', '/js/app.js', '/js/admin.js', '/js/boot.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/healthz') return; // live data only

  // Product pictures: show the saved copy instantly, refresh it quietly in the background.
  if (url.pathname.startsWith('/uploads/') || url.pathname.startsWith('/img/')) {
    e.respondWith(caches.open(VERSION).then(async cache => {
      const hit = await cache.match(req);
      const fresh = fetch(req).then(r => { if (r.ok) cache.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || fresh;
    }));
    return;
  }
  // Pages, styles and scripts: newest first, saved copy if the network fails.
  e.respondWith(fetch(req).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
    return r;
  }).catch(() => caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('/') : Response.error()))));
});
