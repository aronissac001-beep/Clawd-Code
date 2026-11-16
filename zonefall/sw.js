// Zonefall service worker: cache-first so the game runs offline from the Home Screen.
const VERSION = 'zonefall-v1.0.0';
const FILES = ['./', './index.html', './manifest.webmanifest', './js/data.js', './js/core.js', './js/maps.js', './js/entities.js', './js/game.js', './js/ui.js', './js/main.js', './icons/apple-touch-icon.png', './icons/icon-192.png', './icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('zonefall-') && k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request).then(res => { if (res.ok && new URL(e.request.url).origin === location.origin) { const cp = res.clone(); caches.open(VERSION).then(c => c.put(e.request, cp)); } return res; }).catch(() => caches.match('./index.html'))));
});
