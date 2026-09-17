'use strict';

/* PWA service worker for رسمة / Rasmah. Scope is the whole site (this file
   must be served from the root, not /static/, or the browser would default
   its scope to /static/ only — see server.js's dedicated /sw.js route).

   This does NOT make design editing work offline — designs are stored
   server-side (SQLite via /api/designs) and there's no local queue/sync, so
   that would need a much bigger change. What this DOES give offline:
     - the app installs (manifest + this file = installable PWA)
     - static assets (css/js/fonts/vendor/AI models) are cached as they're
       used, so a page you already opened loads instantly next time and the
       heavier editor bits (tf.js/coco-ssd/mediapipe) don't re-download
     - a real page (not the browser's default dinosaur) when a navigation
       can't reach the network and isn't already cached */

const CACHE = 'rasmah-shell-v1';
const OFFLINE_URL = '/offline';
const PRECACHE = [
  OFFLINE_URL,
  '/static/css/style.css',
  '/static/js/main.js',
  '/static/img/favicon.svg',
  '/static/img/logo.svg',
  '/static/img/icon-192.png',
  '/static/img/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // never intercept form posts / API writes

  const url = new URL(req.url);

  if (url.origin === self.location.origin && url.pathname.startsWith('/static/')) {
    // cache-first: static assets are content-hashed-ish enough in practice
    // (css/js change with deploys, but a stale asset for one visit is a
    // fine trade for instant loads + offline resilience) — refresh the
    // cache in the background either way.
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req).then((res) => {
          if (res && res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
          return res;
        }).catch(() => null);
        return cached || network || fetch(req);
      })
    );
    return;
  }

  if (req.mode === 'navigate') {
    // network-first for pages: always prefer live (signed-in) content,
    // fall back to the offline page only when the network is unreachable.
    event.respondWith(
      fetch(req).catch(() => caches.match(OFFLINE_URL))
    );
  }
});
