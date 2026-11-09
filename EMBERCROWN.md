# Embercrown

**A roguelite realm-builder with real-time defense, made first for iPhone Safari.**
Plain HTML, CSS and ES-module JavaScript. No frameworks, no npm, no build step, no server, no external assets: every sprite is drawn with Canvas 2D and every sound is synthesized with the Web Audio API. It installs to the Home Screen and plays offline.

> Current build: **Phase 1 (vertical slice)**. One faction, one biome, one region with the full day/night loop, touch controls, HUD, sound, saves and PWA. See [Roadmap](#roadmap).

---

## Play

Open the GitHub Pages URL (for example `https://<username>.github.io/<repo-name>/`) on your phone and tap **Tap to begin**.

**For full-screen play on iPhone:** tap **Share**, then **Add to Home Screen**. Saves are also safer there (Safari can erase site data for sites you have not visited in 7 days, and the Home Screen app keeps its own storage).

### Goal
Kindle a Hearth in Greenvale and survive the number of nights shown in the top bar (5 on Story, 7 on Standard, 8 on Brutal). At the next dawn a **Light the Beacon** button appears: light it to win safely, or stay longer for more Embers while the nights get harsher. You lose if the **Hearth** is destroyed or the **Ember-Sovereign** dies.

### The cycle
| Phase | Length (1x) | What happens |
|---|---|---|
| Day | about 90 s | Build. Villagers construct, farm, chop, quarry and repair on their own. Newcomers arrive while there is food and housing. |
| Dusk | 10 s | A war horn sounds. Red markers at the screen edge show **where** tonight's Hollow will come from, **how many**, and **which kinds**. Villagers head indoors. |
| Night | up to 60 s | The Hollow attack. Towers and the Hearth shoot on their own; squads fight near their rally flags. Ordinary Hollow burn away at dawn. |
| Dawn | 4 s | Gold reward, and a choice of 1 of 3 **Dawn Offerings**. The game autosaves. |

Every 6th night is a **Blood Moon** (the moon icon in the top bar counts down): a double-size wave led by an elite Hollow Warden, and it does not flee the sunrise.

### Counters
- **Archers** and **Watchtowers** shred **Husks** (swarm infantry) but glance off plate.
- **Spearmen** impale **Gloom Hounds** (fast beasts that hunt villagers).
- **Militia** mauls crack **Hollow Knights** (slow, armored, smash buildings).
- **Shades** slip through walls that stand in darkness. **Braziers** light the ground: the Hollow takes 25% more damage in light and Shades cannot phase through lit walls. Fire (the Hearth, Heartflame Nova) burns Shades and Knights.

### Controls
| Gesture | Action |
|---|---|
| One-finger drag on the map | Pan, with inertia |
| Pinch | Zoom (clamped; far zoom hides small details) |
| Drag a building from the build bar onto the map | Place a ghost (green = valid, red = blocked) with its range shown; tap **✓** to build or **✕** to cancel |
| Tap a build button | Drop the ghost at the nearest valid spot mid-screen |
| Drag the ghost / drag a wall's round handle | Move it / draw a wall line |
| Tap a building | Open its card: workers, upgrades, training, demolish |
| Tap the Sovereign or a squad (or its portrait) | Select it. **Time slows to 25%** while you choose |
| Then tap the ground / a foe | Move there / attack it |
| Double-tap a portrait | Center the camera on that squad |
| Long-press anything | Explain it (units, foes, buildings, trees, terrain, HUD items) |
| Two-finger tap | Cancel / deselect |
| Bottom-left buttons | Pause, speed (1x/2x/3x), Call the Night (skip the rest of the day) |
| Right edge | Heartflame Nova and Royal Banner (the Sovereign's abilities) |

Desktop bonus: WASD/arrows pan, mouse wheel zooms, right-click cancels, Space pauses, 1-3 set speed, C selects the Sovereign, N/B cast Nova/Banner, M toggles the minimap, H centers the Hearth, Enter confirms a placement, Esc cancels.

### Settings
Music and effects volume, mute, screen shake, damage numbers, text size, colorblind palette (blue/orange instead of green/red), left-handed layout (mirrors the thumb zone), reduce motion, **Export Save** (a compressed text code or a `.json` download) and **Import Save**.

---

## Deploy to GitHub Pages
1. Push this repository to GitHub (the game files live at the repository root: `index.html`, `manifest.webmanifest`, `sw.js`, `.nojekyll`, `css/`, `js/`, `icons/`).
2. On GitHub: **Settings > Pages > Build and deployment > Deploy from a branch**, choose **main** and **/ (root)**, then **Save**.
3. Wait a minute, then open `https://<username>.github.io/<repo-name>/`.

All paths are relative (`./js/main.js`) and the manifest's `start_url` and `scope` are `./`, so the game works under a project sub-path. The empty `.nojekyll` file makes Pages serve every file as-is.

**Releasing an update:** bump `VERSION` in `sw.js` so returning players get the new files (the service worker is cache-first). `node tools/check-sw.mjs` verifies that `sw.js` lists every shipped file.

To run locally: `python3 -m http.server 8765` in the repository root, then open `http://localhost:8765/` (append `?debug=1` for the debug overlay). Opening `index.html` from disk will not work, because browsers block ES modules on `file://`.

---

## Design in 10 bullets
1. **Three-layer roguelite**: a branching Realm Map run (Phase 2), real-time Regions (this build), and the Ember Citadel meta hub (Phase 4). Embers are already earned and banked every run.
2. **The Region loop**: Day (build, no rush) > Dusk (telegraphed attack) > Night (defend) > Dawn (pick a reward). About 2.5 minutes per cycle at 1x.
3. **Push your luck**: once the objective is met you may Light the Beacon and leave safely, or stay for escalating Ember rewards as waves keep growing.
4. **Every decision is 2 or 3 options**: Dawn Offerings, light-or-stay, a three-unit counter triangle, three upgrade levels.
5. **Telegraphed randomness**: one seeded RNG drives the whole simulation. Wave direction, size and composition are shown at dusk; the moon counts down to each Blood Moon; omens warn on the day before.
6. **Indirect economy, direct army**: villagers run themselves; the player places buildings and sets worker counts. Squads and the Sovereign take direct orders in slow motion.
7. **Light vs. the Hollow**: Hearth and Braziers create lit ground that strengthens defenders and pins Shades; the whole scene is color-graded by time of day.
8. **Readable on a 6-inch screen**: big silhouettes, color-coded threats, enemies always drawn above fog, health bars only when damaged, 44 pt minimum touch targets, 14 pt minimum text.
9. **Thumb-first UI**: bottom build bar and portraits, right-edge abilities, long-press instead of hover, landscape primary with a stacked portrait layout and a left-handed mirror.
10. **Phone-grade engineering**: fixed 20 Hz simulation with interpolation, a shared enemy flow field, A* with a per-tick budget, a spatial hash, pooled projectiles and particles, chunked terrain and cached sprites.

## How it is built
```
index.html             entry point, PWA metas
manifest.webmanifest   PWA manifest (start_url/scope ./)
sw.js                  versioned cache-first service worker
.nojekyll              serve files as-is on GitHub Pages
css/style.css          HUD, menus, safe areas, portrait/landscape layouts
icons/                 192, 512, maskable 512 and 180 apple-touch icons
js/main.js             boot, title/menu/setup screens, settings, lifecycle
js/engine/
  loop.js              fixed timestep + interpolated render loop
  input.js             pointer gestures: tap, long-press, drag, pinch, two-finger tap
  camera.js            pan/zoom/inertia/shake
  render.js            terrain chunks, y-sorted sprites, fog, lighting, overlays
  sprites.js           all procedural art + per-scale sprite cache
  particles.js         pooled cosmetic particles
  audio.js             synthesized effects (voice pool) + generative music layers
  rng.js               mulberry32 PRNG, value noise, seed text
  save.js              versioned saves, export/import codes, storage.persist
js/game/
  state.js             run/region state, runtime caches, (de)serialisation, migrations
  sim.js               fixed tick + the command interface (UI never edits state)
  controller.js        in-region scene: selection, placement, gestures, events -> sound/FX
  mapgen.js            seeded terrain, river, forests, rock, spawns, caches
  grid.js, spatial.js  tile helpers, spatial hash
  systems/             pathing (A*, flow fields), movement, villagers, units,
                       enemies, combat, buildings, waves, cycle, economy, fog
js/data/               balance (all numbers), buildings, units, enemies, boons,
                       factions, biomes, heraldry
js/ui/                 hud, build bar, info card, modal, toasts, coach marks, debug
tools/                 headless balance sim, determinism test, browser smoke tests, icon generator
```

### Developer tools (Node 18+; browser tests need Playwright)
- `node tools/headless.mjs 24 standard` — auto-plays 24 seeds with a scripted builder and reports nights reached (balance pass).
- `node tools/determinism.mjs` — proves the same seed + commands give identical results, and that a mid-night save/restore continues identically.
- `node tools/smoke.mjs <outdir>` and `node tools/interact.mjs <outdir>` — boot the game at iPhone sizes, drive every control, and fail on console errors (needs a local server on port 8765).
- `node tools/make-icons.mjs` — redraws the app icons; `node tools/check-sw.mjs` — verifies the service-worker file list.
- `?debug=1` — FPS, entity count, tick/draw time, sprite memory, plus buttons: +500 resources, skip phase, spawn boss, reveal map, stress test (220 units), force a Blood Moon, complete the objective.

### Choices made (where the brief left room)
- **Square grid**, 40 x 40 tiles of 32 world units, drawn in a top-down three-quarter style.
- **Trees and rocks block movement**, so forests shape the Hollow's routes and felling them opens new ones.
- **Buildings are attackable obstacles** in the enemy flow field: the Hollow walks around walls when it can and smashes through when it must. A Gate lets your own people through.
- **Dawn Offerings** (pick 1 of 3) ship now as the dawn reward; blueprint drafts (every 2nd dawn) and decrees (every 3rd) arrive with Phases 2 and 3.
- **The Sovereign falls back** to the Hearth on its own below 25% health unless you have just ordered it, so a misclick is never an instant loss.
- **Villagers leave rather than die** when food runs out.
- **Enemies are always drawn above the fog** so nothing arrives unseen.
- Saves use `localStorage` (small JSON, about 100 KB) with schema versioning and migrations; broken saves are set aside with a clear message instead of crashing.

---

## Roadmap
| Phase | Status | Contents |
|---|---|---|
| 1. Vertical slice | **Done** | Title, Dawnhold, Greenvale, one region with day/dusk/night/dawn, 9 buildings + Hearth (3 levels each), 3 unit types + the Sovereign with 2 abilities, 4 enemy types + elite affixes, dusk wave preview, Blood Moons, Hearth and Sovereign lose conditions, Light the Beacon win, Dawn Offerings, fog of war, caches, touch controls, HUD, minimap, synthesized sound and music, autosave/export/import, PWA, offline, debug overlay, coach marks |
| 2. The run | Next | Realm Map with all node types and the Hollowing front, region objectives, blueprint drafts, Beacon bonuses, 15 relics, 15 events, the merchant, the Act 1 boss (Gloomwyrm) |
| 3. Depth | Planned | All 4 starting factions, heroes and bounty flags, territory zones, seasons and winter, decrees with Morale and Dread, storytellers, adjacency combos, region modifiers, weather, Acts 2 and 3 |
| 4. Meta and breadth | Planned | Ember Citadel, unlockable factions, Codex, achievements, Omens of Ruin, Endless and Daily Realm, full content targets |
| 5. Polish | Planned | Full tutorial run, more juice, layered boss music, accessibility pass, profiling and a 100-seed balance pass |

All names, characters, art and text in Embercrown are original.
