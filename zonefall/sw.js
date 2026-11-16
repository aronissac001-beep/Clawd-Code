// Zonefall service worker: network-first (updates arrive whenever you're online),
// with everything cached so the game also runs offline from the Home Screen.
const VERSION = 'zonefall-v3.0.0';
const FILES = ['./', './index.html', './manifest.webmanifest', './lib/three.module.min.js', './lib/BufferGeometryUtils.js', './js/art_core.js', './js/art_icons.js', './src/main.js', './src/state.js', './src/data.js', './src/util.js', './src/input.js', './src/audio.js', './src/save.js', './src/inventory.js', './src/physics.js', './src/doors.js', './src/build.js', './src/actors.js', './src/ai.js', './src/combat.js', './src/player.js', './src/bots.js', './src/events.js', './src/game.js', './src/ui.js', './src/tutorial.js', './src/world/gen.js', './src/world/kit.js', './src/world/live.js', './src/world/monuments.js', './src/gfx/materials.js', './src/gfx/renderer.js', './src/gfx/terrain.js', './src/gfx/veg.js', './src/gfx/fx.js', './src/gfx/models_chars.js', './src/gfx/models_world.js', './icons/apple-touch-icon.png', './icons/icon-192.png', './icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => Promise.all(FILES.map(f => c.add(f).catch(() => null)))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('zonefall-') && k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok) { const cp = res.clone(); caches.open(VERSION).then(c => c.put(e.request, cp)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./index.html'))));
});
