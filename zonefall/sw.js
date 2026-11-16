// Zonefall service worker: cache-first so the game runs offline from the Home Screen.
const VERSION = 'zonefall-v2.0.0';
const FILES = ['./', './index.html', './manifest.webmanifest', './js/data.js', './js/core.js', './js/art_core.js', './js/art_chars.js', './js/art_world.js', './js/art_icons.js', './js/maps.js', './js/entities.js', './js/render.js', './js/game.js', './js/tutorial.js', './js/ui.js', './js/main.js', './icons/apple-touch-icon.png', './icons/icon-192.png', './icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('zonefall-') && k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
// Network-first (so updates arrive as soon as you're online), cache fallback for offline play.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok) { const cp = res.clone(); caches.open(VERSION).then(c => c.put(e.request, cp)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./index.html'))));
});
