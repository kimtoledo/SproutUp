/*
 * SproutUp service worker.
 *
 * Spec + unit tests live in `apps/web/lib/pwa.ts` (`swStrategy`, `PRECACHE_URLS`).
 * Keep this file in sync with that module.
 *
 * Safety: only same-origin GET requests are ever read from or written to the
 * cache. The SproutUp API is a separate origin, so no authenticated response
 * can be intercepted here. HTML navigations are network-first; build assets are
 * cache-first; everything else passes straight through.
 */
const CACHE = 'sproutup-v1';
const OFFLINE_URL = '/offline';
const PRECACHE = ['/', '/login', '/register', OFFLINE_URL, '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function strategyFor(request) {
  if (request.method !== 'GET') return 'passthrough';
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return 'passthrough';
  if (request.destination === 'document' || url.pathname === '/' || !url.pathname.includes('.')) {
    return 'network-first';
  }
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/pwa/')) {
    return 'cache-first';
  }
  if (['style', 'script', 'font', 'image'].includes(request.destination)) return 'cache-first';
  return 'passthrough';
}

self.addEventListener('fetch', (event) => {
  const strategy = strategyFor(event.request);
  if (strategy === 'passthrough') return;

  if (strategy === 'network-first') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy)).catch(() => {});
          return response;
        })
        .catch(() =>
          caches
            .match(event.request)
            .then((cached) => cached || caches.match(OFFLINE_URL)),
        ),
    );
    return;
  }

  // cache-first
  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request).then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy)).catch(() => {});
          return response;
        }),
    ),
  );
});
