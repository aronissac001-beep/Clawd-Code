// Service worker: versioned cache-first storage of every game file, so the
// game plays offline after the first visit. Bump VERSION on every release.
const VERSION = 'embercrown-v1.0.0';
const FILES = [
    './',
    './index.html',
    './manifest.webmanifest',
    './css/style.css',
    './icons/apple-touch-icon.png',
    './icons/icon-192.png',
    './icons/icon-512-maskable.png',
    './icons/icon-512.png',
    './js/data/balance.js',
    './js/data/biomes.js',
    './js/data/boons.js',
    './js/data/buildings.js',
    './js/data/enemies.js',
    './js/data/factions.js',
    './js/data/heraldry.js',
    './js/data/units.js',
    './js/engine/audio.js',
    './js/engine/camera.js',
    './js/engine/input.js',
    './js/engine/loop.js',
    './js/engine/particles.js',
    './js/engine/render.js',
    './js/engine/rng.js',
    './js/engine/save.js',
    './js/engine/sprites.js',
    './js/game/controller.js',
    './js/game/grid.js',
    './js/game/mapgen.js',
    './js/game/sim.js',
    './js/game/spatial.js',
    './js/game/state.js',
    './js/game/systems/buildings.js',
    './js/game/systems/combat.js',
    './js/game/systems/common.js',
    './js/game/systems/cycle.js',
    './js/game/systems/economy.js',
    './js/game/systems/enemies.js',
    './js/game/systems/fog.js',
    './js/game/systems/movement.js',
    './js/game/systems/pathing.js',
    './js/game/systems/units.js',
    './js/game/systems/villagers.js',
    './js/game/systems/waves.js',
    './js/main.js',
    './js/ui/buildbar.js',
    './js/ui/coach.js',
    './js/ui/debug.js',
    './js/ui/dom.js',
    './js/ui/hud.js',
    './js/ui/icons.js',
    './js/ui/infocard.js',
    './js/ui/modal.js',
    './js/ui/toast.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('embercrown-') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res && res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match('./index.html'))),
  );
});
