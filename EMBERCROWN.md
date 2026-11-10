# Embercrown

**A roguelite realm-builder with real-time defense, made first for iPhone Safari.**
Plain HTML, CSS and ES-module JavaScript. No frameworks, no npm, no build step, no server, no external assets: every sprite is drawn with Canvas 2D and every sound is synthesized with the Web Audio API. It installs to the Home Screen and plays offline.

> Current build: **Phase 3 (depth)**. Four factions, heroes with bounty flags, territory and lairs, seasons and weather, Morale, Dread and decrees, three storytellers, adjacency combos, region modifiers, and all three Acts with their bosses. Earlier: **Phase 2 (the run)**. A full Act I journey across a branching Realm Map: regions with four kinds of objective, Mystery events, Merchant Caravans, Shrines, Ruins, Cursed regions and the Gloomwyrm boss, with relics, blueprint drafts and Beacon bonuses carried between regions. See [Roadmap](#roadmap).

---

## Play

Open the GitHub Pages URL (for example `https://<username>.github.io/<repo-name>/`) on your phone and tap **Tap to begin**.

**For full-screen play on iPhone:** tap **Share**, then **Add to Home Screen**. Saves are also safer there (Safari can erase site data for sites you have not visited in 7 days, and the Home Screen app keeps its own storage).

### Goal
Cross Act I of the **Realm Map** and slay the **Gloomwyrm**. Each step you choose one node on a branching path; the grey Hollowing front follows one step behind, so there is no turning back.

| Node | What happens |
|---|---|
| Region | Kindle a Hearth and meet the objective, then **Light the Beacon** to move on (or stay for more Embers as nights get harsher). |
| Cursed Region | Stronger Hollow, richer loot: a rare or legendary relic. |
| Ruin | Hold out for 2 nights; claim a relic. |
| Mystery | A text event with 2-3 choices, some with a shown % chance. Some start stories that continue regions later. |
| Merchant Caravan | Spend carried gold on relics, blueprints, healing, supplies or lifting a curse. |
| Shrine | Heal the Sovereign, take a blessing, or spin the Wheel of Fortune (odds shown). |
| Boss | The Gloomwyrm arrives on night 3. It strafes rows of buildings with grey fire after a 2-second warning line, lands to feed (when melee can hit it), and grows fiercer in three phases. |

**Region objectives:** *Survive* N nights; *Destroy the Hollow Rift* (it spawns extra Hollow every night until you march soldiers at it); *Grow prosperous* (population and buildings); or fulfil the *Crown's Edict* (three build/grow/produce goals). Tap the objective in the top bar for details.

**Carried between regions:** the Sovereign's health, gold, relics, learned blueprints and Beacon bonuses. Each region opens with a **blueprint draft** (pick 1 of 4; Dawnhold architects add an option) and offers another every 2nd dawn. Lighting a Beacon grants a run-long **Beacon bonus** (pick 1 of 3). Spare gold buys wood, stone and food at the Hearth (tap it).

You lose the run if a **Hearth** is destroyed or the **Ember-Sovereign** dies. Embers earned are banked either way.

### The cycle
| Phase | Length (1x) | What happens |
|---|---|---|
| Day | about 90 s | Build. Villagers construct, farm, chop, quarry and repair on their own. Newcomers arrive while there is food and housing. |
| Dusk | 10 s | A war horn sounds. Red markers at the screen edge show **where** tonight's Hollow will come from, **how many**, and **which kinds**. Villagers head indoors. |
| Night | up to 60 s | The Hollow attack. Towers and the Hearth shoot on their own; squads fight near their rally flags. Ordinary Hollow burn away at dawn. |
| Dawn | 4 s | Gold reward, and a choice of 1 of 3 **Dawn Offerings**. The game autosaves. |

Every 6th night is a **Blood Moon** (the moon icon in the top bar counts down): a double-size wave led by an elite Hollow Warden, and it does not flee the sunrise.

### Phase 3 systems
- **Factions** (chosen on the New Realm screen). Each has a passive, a drawback, a unique building and a unique unit:
  | Faction | Passive | Drawback | Unique building | Unique unit |
  |---|---|---|---|---|
  | Dawnhold (humans) | +1 option in every blueprint draft | none | Cathedral of Dawn (Morale aura) | Lancer (charge) |
  | Sylvari (elves) | woodcutters also bring food; felled trees regrow | stone costs +25% | Heart Tree (heals units) | Thornwarden (long-range archer) |
  | Deepforge (dwarves) | quarries yield double; winter upkeep -30% | build 20% slower; forested land must be cleared before claiming | Runeforge (empowers nearby towers) | Ironshield (heavy blocker) |
  | Emberkin (orcs) | kills pay gold; lairs give double loot | Morale falls faster; one fewer starting villager | War Drum (+20% attack at night) | Berserker |
- **Storytellers**: the Steady Hand, the Gentle Muse or the Mad Jester pace random region events (2-3 choice cards) and tonight's wave modifiers (always shown before dusk; tap the omen button).
- **Heroes** run their own AI. Steer them with **bounty flags** (right edge): Attack (a foe or lair), Explore (fog), Defend (a building) or Avoid (a danger zone), for 15/30/60 gold; bigger, closer bounties draw more heroes. Tap a hero for its card and **Rally** (one direct order). Heroes level 1-10, pick a perk at levels 3, 6 and 9, carry between regions, and die for good. Recruit more at a **Tavern** (max 4).
- **Territory**: each region is split into zones. You build only inside your land; tap ground outside it to **claim** a neighbouring zone (each claim costs more). Some zones hold a beast **lair** that must be destroyed first; units fight better inside your land.
- **Seasons** turn every 2 days (wheel in the top bar). **Winter**: farms freeze, food upkeep +50%, Houses burn wood, the Hollow hit harder, and units outside your land lose 25% attack. **Weather** is forecast a day ahead: rain, fog, storms (lightning, always marked 2 s before it strikes), heat and snow.
- **Morale and Dread** (top bar meters, 0-100). High Morale speeds work and brings festivals; low Morale brings desertion and riots. Dread rises from deaths, Rifts and Wailers; at 100 your people abandon you and the run ends.
- **Decrees**: every 3rd dawn open the Book of Decrees and sign one law for the rest of the run. The Path of the Flame and the Path of the Iron Crown lock each other at tier 3.
- **Combos**: hidden building arrangements transform into something better (or worse), e.g. 3 Farms around a Granary, a Watchtower on a crag, 6 Houses in a cluster. Discoveries are remembered.
- **Region modifiers** (shown on the map before you travel): Twin Moons, Endless Winter, Fog of Ages, Gold Rush, Haunted Woods and more.
- **Acts II and III**: the Elderwood with the **Bone Colossus** (strike its glowing weak spot after each telegraphed slam) and the Ashlands with the **Hollow King** (summons, snuffs Braziers, teleports; in his last phase only lit ground near your fires or the Sovereign is safe). Defeating him wins the run.

### Modes (New Realm screen)
| Mode | What it is |
|---|---|
| Campaign | The full road: three acts, three bosses. Earns Embers for the Ember Citadel. |
| Endless | One region with no Beacon. Hold as many nights as you can; every 6 nights the Hollow grow as if a new act began. Your best is kept. |
| Daily | Everyone gets the same realm today (seed `DAILY-YYYYMMDD`, faction and storyteller fixed by the date). No perks or Omens. A local table keeps your best score per day. |
| Sandbox | Every faction and blueprint unlocked, extra supplies. No Embers or achievements. |

### Phase 4: meta progression and breadth
- **Ember Citadel** (main menu): spend banked Embers on 30 upgrades in 4 tiers (tier II opens after 2 upgrades, III after 6, IV after 12). The fortress on its hill grows with every purchase. Upgrades unlock the Mirefolk and the Pale Court, new blueprints (Mine, Alchemist, Library; Temple, Ley Obelisk; Archery Range, Stable; Siege Workshop; the Wonders), two Reliquaries of relics and two Guild halls of hero classes; others are lasting bonuses (starting supplies, Sovereign health, perk slots, Ember Tithe) or cosmetic banners. Locked content never appears in drafts, shops, relic rolls or taverns.
- **Starting perks**: equip 1 of 15 perks on the New Realm screen; Citadel upgrades raise the slots to 3.
- **Omens of Ruin** (after your first win): 16 stackable difficulty modifiers worth 1-3 Ruin each; every Ruin point adds +15% Embers.
- **Codex** (main menu): Bestiary, Relics, Combos, Events, Buildings and Heroes, with ??? for anything not yet found. **Feats**: 43 achievements with Ember rewards and progress bars (none in Sandbox).
- **New factions**: **Mirefolk** build on river shallows, and their attacks poison (weak in winter; Bog Shrine slows the Hollow; Hexcasters curse). **Pale Court** never eats; villagers live on Souls taken from slain Hollow (no Morale, Dread rises faster; the Ossuary stores Souls and raises Bone Legion).
- **Buildings (34)**: Windmill, Fisher's Hut, Mine, Temple, Library, Alchemist, Ley Obelisk, Archery Range, Stable, Siege Workshop, plus one **Wonder** per run (Sunspire: the dark lifts sooner and every dawn brings 50% more gold; World Forge: all units tougher; Moonwell: Blood Moons become blessings). A finished Wonder blesses every later region of the run.
- **Units (16)**: Archer and Crossbowman at the Archery Range; Knight and Scout at the Stable; Ballista Cart and Battlemage at the Siege Workshop; Shieldwall and Field Healer at the Barracks.
- **Heroes (12 classes)**: new Skald (war song), Druid (healing, roots), Duelist (dodge, duels) and Frostwarden (chill and freeze).
- **Relics (45)** and **foes (20)**: Goblin Raiders steal from your stores and flee (kill them for the loot back), Riftspawners summon Husks, Ash Wyverns fly over walls, Bog Witches curse, Frost Wraiths chill (winter), Ash Imps burst into flame (Ashlands).

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
  run.js               the run: Realm Map travel, relics, events, merchant, shrine, carry-over
  runflow.js           run director: map screen, node screens, region hand-off, saves
  realmmap.js          seeded Act map generation (node graph, no crossing edges)
  content.js, hooks.js registers Phase 2 systems/art with the core through plug-in hooks
  state.js             region state (createRegion), runtime caches, (de)serialisation, migrations
  sim.js               fixed tick + the command interface (UI never edits state)
  controller.js        in-region scene: selection, placement, gestures, events -> sound/FX
  mapgen.js            seeded terrain, river, forests, rock, spawns, caches
  grid.js, spatial.js  tile helpers, spatial hash
  systems/             pathing (A*, flow fields), movement, villagers, units,
                       enemies, combat, buildings, waves, cycle, economy, fog,
                       boss (Gloomwyrm), objectives (+ Hollow Rift), structures (new buildings)
js/data/               balance (all numbers, DEFAULT_MODS, RUN), buildings (+ buildings-ext),
                       units, enemies, boons, relics, beacons, events, factions, biomes, heraldry
js/ui/                 hud, build bar, info card, modal, toasts, coach marks, debug,
                       realmmap-ui (map screen), runscreens (event/merchant/shrine/wheel/draft/relics)
js/engine/bossart.js, riftart.js, sprites-ext.js   art for the boss, the Rift and new buildings
tools/                 headless balance sim, determinism test, browser smoke tests, icon generator
```

### Developer tools (Node 18+; browser tests need Playwright)
- `node tools/runsim.mjs 12 standard [--verbose]` — auto-plays whole runs across the Realm Map (every node type, the boss) with a scripted player; reports how far each run gets.
- `node tools/modes.mjs <outdir>` — browser test of Endless, Daily Realm (best table) and Sandbox (no Embers).
- `node tools/runflow.mjs <outdir>` — browser test of the run flow: map, regions, Beacon choice, merchant, shrine wheel, boss, reload-resume.
- `node tools/headless.mjs 24 standard` — auto-plays 24 seeds with a scripted builder and reports nights reached (balance pass).
- `node tools/determinism.mjs` — proves the same seed + commands give identical results, and that a mid-night save/restore continues identically.
- `node tools/smoke.mjs <outdir>` and `node tools/interact.mjs <outdir>` — boot the game at iPhone sizes, drive every control, and fail on console errors (needs a local server on port 8765).
- `node tools/make-icons.mjs` — redraws the app icons; `node tools/check-sw.mjs` — verifies the service-worker file list.
- `?debug=1` — FPS, entity count, tick/draw time, sprite memory, plus buttons: +500 resources, skip phase, spawn boss, reveal map, stress test (220 units), force a Blood Moon, complete the objective.

### Choices made (where the brief left room)
- **Square grid**, 40 x 40 tiles of 32 world units, drawn in a top-down three-quarter style.
- **Trees and rocks block movement**, so forests shape the Hollow's routes and felling them opens new ones.
- **Buildings are attackable obstacles** in the enemy flow field: the Hollow walks around walls when it can and smashes through when it must. A Gate lets your own people through.
- **Dawn rewards** alternate: a blueprint draft every 2nd dawn while blueprints remain, otherwise a Dawn Offering (pick 1 of 3). Decrees (every 3rd dawn) arrive in Phase 3.
- **Acts**: each act is a fresh Realm Map in its own land (Greenvale, Elderwood, Ashlands); waves and Hollow health grow by act as well as by map depth.
- **Plug-in bus (Phase 3)**: every Phase 3 system lives in its own module and attaches through `BUS` in `js/game/hooks.js` (ticks, phases, kills, placement vetoes, damage/work/upkeep multipliers, commands, pending choices, HUD widgets, render layers, run events). The core never imports them; `js/game/content.js` registers them.
- **Choices queue**: a decree, a blueprint draft, a perk choice and a region event can all fall due on one dawn; they are shown one after another.
- **Regions are fresh settlements**: buildings and villagers stay behind as a Beacon; difficulty grows with map depth through larger waves, not bigger objectives.
- **Gold is the run currency**: it carries between regions and buys relics at merchants, or raw materials at the Hearth's supply trade (prices rise with each purchase).
- **New code reaches the core through hooks** (`js/game/hooks.js`, filled by `js/game/content.js`), so content modules never need edits to core files.
- **The Sovereign falls back** to the Hearth on its own below 25% health unless you have just ordered it, so a misclick is never an instant loss.
- **Villagers leave rather than die** when food runs out.
- **Enemies are always drawn above the fog** so nothing arrives unseen.
- Saves use `localStorage` (small JSON, about 100 KB) with schema versioning and migrations; broken saves are set aside with a clear message instead of crashing.

---

## Roadmap
| Phase | Status | Contents |
|---|---|---|
| 1. Vertical slice | Done | Title, Dawnhold, Greenvale, one region with day/dusk/night/dawn, 9 buildings + Hearth (3 levels each), 3 unit types + the Sovereign with 2 abilities, 4 enemy types + elite affixes, dusk wave preview, Blood Moons, Hearth and Sovereign lose conditions, Light the Beacon win, Dawn Offerings, fog of war, caches, touch controls, HUD, minimap, synthesized sound and music, autosave/export/import, PWA, offline, debug overlay, coach marks |
| 2. The run | **Done** | Realm Map (Act I, 6 steps + boss) with all 7 node types and the Hollowing front; 4 objective types incl. the Hollow Rift; blueprint drafts; 16 Beacon bonuses; 19 relics (4 rarities, a 3-piece set); 24 events incl. a 3-step dragon-egg chain; Merchant Caravan; Shrine with Wheel of Fortune; Ruins; Cursed regions; the Gloomwyrm (3 phases, telegraphed strafes); 5 new draftable buildings (Market, Granary, Spike Trap, Ballista, Mage Spire); Hollowed Ruins biome; Hearth supply trade; save migration from Phase 1 |
| 3. Depth | **Done** | All 4 starting factions, heroes and bounty flags, territory zones, seasons and winter, decrees with Morale and Dread, storytellers, adjacency combos, region modifiers, weather, Acts 2 and 3 |
| 4. Meta and breadth | **Done** | Ember Citadel (30 upgrades), 15 starting perks, 16 Omens of Ruin, Codex, 43 Feats, Mirefolk and Pale Court, Endless / Daily Realm / Sandbox; 34 buildings incl. 3 Wonders, 16 units, 20 enemies, 12 hero classes, 45 relics, 45 events, 14 region modifiers, 15 combos, 19 decrees |
| 5. Polish | Planned | Full tutorial run, more juice, layered boss music, accessibility pass, profiling and a 100-seed balance pass |

All names, characters, art and text in Embercrown are original.
