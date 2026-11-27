# Embercrown: The Hold - revision 4: the world (overhaul design and build plan)

Status: **design of record for the overhaul, edition 1.** This document amends `EMBERCROWN-FORTRESS.md` (revision 3, cited as "R3 x.y") and, through it, `EMBERCROWN-COLONY.md` (revision 2, "R2 x.y"). Everything this document does not name still holds. Where the two disagree, this document wins for the parts it names.

**Inputs.** The owner's request (below). Four research notes in the session scratchpad `overhaul/`: `world.md` (world map, history, embark), `peoples.md` (peoples and content), `atmosphere.md` (atmosphere and assets), `ui.md` (UI audit at `aebe07c` with phone screenshots, and the polish backlog). R3 sections 0, 5, 6, 7 and 8. Repo: `/home/user/Clawd-Code`, HEAD `aebe07c` (UI pass 2, sw v0.4.2-ui), `STATE_VERSION = 4`, codec `EC3`, gate stages up to `z3`.

**Edition 2 (critic pass, 2026-11-27).** Paths spot-checked against the code (new ones marked); `hash32` defined (G2); the air step made integer, conservative and stable, at the real 10 ticks a game minute (6.3); skills mapped to today's ids (4.3); DF's own embark labels and two borrowed names replaced (G8, 2.1, row 16); the cross-hold Lamplost unlock dropped (Q3); six large steps split (W1.3, W2.7, W3.1, W3.3, W6.2, W6.4); W6.0, the amendment runner, the world index, polish items 26-28 and R14-R15 added.

**Research method.** The research tracks used WebSearch. WebFetch could not reach the Dwarf Fortress wiki or the DF walkthrough, so the DF facts come from search-result summaries. Where a note relied on its authors' own knowledge of a game, it says so. Sources are listed at the end of each note and in Appendix A. The new people names were checked by web search on 2026-11-27 (Thornwake, Murrow, Tarnfolk, Kilnfolk, Wendrel, Greyborn): no game or setting uses them as a race name. The nearest hit was "Kiln", a race in a small forum quest. "Greyborn" is also an ordinary English compound. These checks are quick ones, not legal clearance (13, R7).

**The owner's request, verbatim:** "Do a large overhaul off the entire game add more content , add atmospheric simulations , rethink and restyle and improve the menus and ui , improve in game assets, add more races , add world map and starting area choice like in dwarf fortress , add world history, finish left over polish from before. Before starting do research . Start now"

**Hard constraints (unchanged):**
- **Original IP only.** No names, art or text from Dwarf Fortress, RimWorld, Caves of Qud or any other game. "Sylvari" is renamed for this reason (G14).
- **iPhone first.** Safari viewports are 390 x 664 portrait and 844 x 335 landscape, touch only. Text is >= 14 px and targets are >= 44 pt.
- **Battery and frame rate.** 60 fps while moving, battery friendly.
- **No build step.** Plain ES modules, no npm, no framework.
- **Deterministic seeded sim.**
- **Saves.** Small, in IndexedDB, with export and import.
- **No emoji. No roguelite. No win state.**
- **Budgets.** The R3 6 budgets hold. The owner's phone measured well inside them (R3 6.0).
- **Minimum device.** iPhone 11 (A13) on iOS 17 Safari (R3 header).

---

## 0. Decisions

Decisions are numbered G1-G32. "New" means the decision did not exist before.

| # | Replaces | Decision |
|---|---|---|
| G1 | new | **The Realm.** Every new hold sits in a generated world map. The code calls it the **realm**: `s.realm`, `js/game/realm/`, `js/data/realm/`. The word `world` already names the local terrain (`js/game/world/`) and the record `s.colony.world` (weather, fire). Players always see the word **World**. |
| G2 | new | **One region is one hold.** The world is a grid of regions: 64 x 64 by default, with Small (48 x 48) and Large (96 x 96) options. Every embarkable region *is* one possible 128 x 128 x 20 hold. There is no DF-style local rectangle, because our hold size is fixed. Hold seed = `hash32(worldSeed, rx, ry, 'hold')`, so a region's hold is fixed by the world and can be previewed. **`hash32(...parts)` is NEW** (`js/game/core/rand.js`, owner A, landed in W2.1): `hashString(parts.join(':'))` with integers written in base 10; every `hash32` in this document means exactly that. |
| G3 | extends F28 | **The realm record is stored, not regenerated.** Fields, tables and the history event log are deflated into one record, about 40-60 KB, in a new IndexedDB store `realm` keyed by world id. Every hold founded in that world shares the record, and every dawn backup and export embeds a copy. Regenerating from the seed is only a fallback, and it is accepted only if the record CRCs match (9.2). So world and history generators may change between releases. |
| G4 | new | **History is a cheap macro sim plus event-first deeds.** Years run in a loop modelled on Dwarf Fortress: civilizations grow, found sites, make war, raze, make pacts, and beasts roam. Figures' deeds are made Caves-of-Qud-style: the deed is picked first and its cause is then filled from state. The default is 250 years, run at world creation in about 150-350 ms on an A15. Event text is never stored; it is rendered from grammar rows. |
| G5 | new | **The world lives on after embark.** One **season tick** runs at each season start: wars start and end, sites change hands, figures die, news spreads, the hold's renown reaches its neighbours. It is deterministic, drawn from `hash32(worldSeed, year, season)` and never from `s.rng`. It writes compact deltas into `s.realm`, capped at 16 KB, and costs under 5 ms on an A15 in one tick. |
| G6 | keeps F26 | **Threats still need causes, and the realm becomes the main source.** Raids come from civs at war with your liege or who hate you, from the side where they live, led by named figures. Caravans come from towns within reach, at a cadence set by travel days. Visitors are living historical figures. Each letter names its civ and its cause. |
| G7 | amends R2 factions | **Factions become roles bound to civs.** The saved faction ids (`league`, `hearthwatch`, `gutterkin`, `ashfang`, `pilgrims`) stay as **role keys**. `s.realm.bind` maps each role to a generated civ, so old code paths and saved goodwill keep working. A civ that fills no role becomes a faction with the key `c<n>`. |
| G8 | replaces "Choose the start" | **Embark works like DF on a phone.** The world map has three zoom levels, a region card in a bottom sheet, a site finder made of filter chips, and **Ready the band** or **Found now**. The flow is DF-like in shape only: every label and screen is our own wording (DF's own embark labels are not used). Section 3 has the full flow. |
| G9 | amends R3 2.2 | **Region inputs drive `mapgen3`.** They arrive as `opts.region`: biome knobs, massif side and thickness, river in and out, aquifer, soil, climate, stone province and ore weights, ember depth, taint, wildness, relics and lairs from history, and raid edges. This is `GEN3.version` 2. Version-1 holds keep their stored pristine world (F28) and are never regenerated. Every region keeps the caverns, the ember layer and the sealed Hollow; only their richness varies. |
| G10 | replaces `biomes-ext.js` | **12 region biomes.** The 4 existing palettes are reused (greenvale, elderwood, ruins, ashlands), and 8 are new: fen, moor, taiga, tundra, saltflat, redscar, shore and highcrag (1.3). |
| G11 | amends D9 | **10 peoples.** The 4 existing peoples are deepened and 6 are new. **Seven can be chosen at embark:** Human, Thornwake, Deepforge, Emberkin, Murrow, Tarnfolk and Wendrel. **Three are semi-playable:** Lamplost, Kilnfolk and Greyborn join as migrants, refugees, recruits or children, and are never in a founding band (4.3). |
| G12 | new | **Every people has one hard drawback the player plans around**, such as hunger, sky, damp, heat or glare, and not only a +25 % bonus. All new ancestry fields default to neutral (human-like) values, so data that leaves them out behaves exactly as today. |
| G13 | new | **Every civ has an 8-axis ethic vector:** trees, deep digging, fire, water, beasts, the dead, coin and law, each -2..+2. It drives worldgen relations, what traders refuse, what envoys demand, and each civ's named oath. Breaking any oath costs goodwill with every civ (4.4). |
| G14 | IP fix | **"Sylvari" is now displayed as "Thornwake".** The saved id `sylvari` stays, and the art key stays `colonist.sylvari`. |
| G15 | new | **Atmosphere has two layers.** (1) A small **sim climate**: weather fronts, wind, cloud, fog, wetness and snow depth. (2) A cosmetic **atmosphere director** in the renderer. The renderer never writes state. Only climate parts that change play live in the sim (6.2). |
| G16 | new | **An air sim on fixed cells.** Smoke, foul air and firedamp are stored per 16 x 16 x 1 cluster: 1,280 cells at 128 x 128 x 20, 3 bytes each. They diffuse along the region graph's links, vent to the sky, and feed thoughts, illness and gas blasts. They are not simulated per tile (6.3). |
| G17 | new | **Forecast.** A front is known 12-24 game hours ahead. A sky chip on the HUD and, for storms and blizzards, a letter give players time to bring in the harvest, close the floodgates and stock the fires. |
| G18 | new | **Motion and battery rules.** Every cosmetic effect has a defined behaviour under Reduce motion, under Battery saver and at strategic zoom (6.7). Lightning is capped by the WCAG 2.3.1 photosensitivity rule. |
| G19 | new | **Assets are baked pixel frames only.** Nothing draws an `arc`, gradient, `shadowBlur` or `ctx.filter` per frame. The particle engine is rewritten on a sprite sheet. Portraits become 32 x 32 busts. The palette may grow from 33 to at most 38 colours (7). |
| G20 | amends R3 4 | **The bottom bar is organised by activity:** **Build \| Mark \| People \| Hold \| World**, plus a speed button that shows its state. The top-left **Menu** holds storage and app actions only (8.1). |
| G21 | new | **Sheets have two detents (medium and large) and are never stacked.** A sub-screen replaces the sheet's content and shows a breadcrumb. A sheet's explanatory paragraph shows on the first visit only, then lives behind "?". |
| G22 | new | **Landscape sheets take 45-50 % of the width at full height.** The camera shifts so the selection stays visible. In landscape the peek card is a compact card, not a full-height column. |
| G23 | amends R3 4.6 | **Onboarding teaches by need.** The coach has 6 steps, each with a "Show me" button. One-line hints appear the first time something happens: the first night, cavern, flood, visitor, front or foul air. Migrated holds get a 3-card "What is new" deck instead. |
| G24 | new | **Overlays are a first-class mode:** Heat, Air, Light, Water, Rooms, Beauty and Danger. One overlay is on at a time, with a legend strip. |
| G25 | new | **A strings layer, `t(key)`.** Every new UI string goes through it (English only for now). Old modules are converted when they are touched (W1.1, W7.7). |
| G26 | amends R3 5 | **State v5. Codec `EC3` and the pristine store are unchanged.** The entities JSON gains `realm`, the weather record grows to v2, and runtime gains `air`. IndexedDB goes to version 3 (the `realm` store is added). |
| G27 | new | **Old holds keep working: a migrated hold gets a generated world around it.** The hold is pinned to a matching region, and its local map is unchanged byte for byte. Factions are bound to civs, goodwill is kept, and the climate equals today's. It is not tick-identical across the upgrade; it is deterministic from the migrated state on (9.4). |
| G28 | new | **Holds in the same world never see each other.** This follows owner decision 4 of R3: no fallen or earlier hold appears in a new hold's history or world. Each hold carries its own realm deltas on the shared, immutable record. |
| G29 | keeps R3 6 | **The performance budgets stand.** New rows are in section 10. World generation is chunked and animated, with no Worker needed. A module Worker remains an option. |
| G30 | new | **New workstream L (the realm).** It owns `js/game/realm/*`, `js/data/realm/*` and the realm tools. R2 14.2 workstreams A-K are otherwise unchanged. |
| G31 | extends R3 8.1 | **Build stages W0-W7.** Each stage ships something playable and has its own gate stage (`w0` ... `w7`). New systems merge dark behind module flags (`SHELL2`, `REALM`, `HISTORY`, `PEOPLES2`, `CLIMATE2`, `AIR`) and are switched on in each stage's last step. A flag only gates entry points (new founding, UI, migrations); once a hold carries the data (`s.realm`, weather v2, `air`), the sim reads the saved data, never the flag. |
| G32 | keeps F13, F14 | **The world has no victory.** It has no world conquest and no adventure mode. The hold never travels; only its people, envoys and news do. |

---

## 1. World map and generation

### 1.1 Size and representation

- **Grid.** 64 x 64 regions (4,096) by default. Small is 48 x 48 and Large is 96 x 96.
  - The map is flat, not a globe: north is cold and south is warm.
  - Sea lies on 1-3 sides, chosen by the seed.
  - The prevailing wind comes from the west.
  - At 390 pt portrait width the whole map fits at 6 pt per region. The 8x zoom gives 48 pt cells, over the 44 pt target.
- **One region is one possible hold** (G2).
- **Not embarkable:** sea, peaks, regions holding a site, and islands of under 6 regions.
- **Layers** are typed arrays, one byte per region each unless marked. They are built per call, never at import (D1).

| Layer | Type | Meaning |
|---|---|---|
| `elev` | u8 | 0-255; sea level by percentile (land 55-70 %), stored as `seaLevel` in params |
| `temp` | i8 | yearly mean, degrees C |
| `amp` | u8 | half the summer-winter swing, degrees C (wider inland) |
| `rain` | u8 | yearly rainfall, 0-255 |
| `drain` | u8 | drainage, 0-255 (low means waterlogged) |
| `volc` | u8 | ember activity |
| `taint` | u8 | the Hollowing (our "savagery and evil" analogue) |
| `wild` | u8 | wildness (beasts) at the end of history |
| `geo` | u8 | rock province: 0 sedimentary basin, 1 granite shield, 2 basalt flood, 3 metamorphic belt, 4 ash field |
| `biome` | u8 | index into `js/data/realm/biomes.js` (append-only) |
| `flow` | u8 | D8 down direction (3 bits), river class 0-3 (2 bits), lake, coast, embarkable |
| `site` | u16 | site id + 1, or 0 |
| `owner` | u8 | civ id + 1 at the end of history |
| `road` | u8 | 4-direction bitmask |

That is 15 bytes a region: 61 KB at 64², 34 KB at 48² and 138 KB at 96². All of it is held in memory and stored deflated in the record.

### 1.2 Generation pipeline

Every step draws from its own stream, `hashString('realm:<step>:' + worldSeed + ':' + REALM_GEN.version)`, as a private mulberry32. It never touches `s.rng`.

The rules of `tools/check-mapgen.mjs` apply, and that tool now also lints `js/game/realm/`:
- integer hash value noise with smoothstep;
- only `+ - * /`; no `Math.sin`, `pow` or `exp`;
- iteration in sorted order; every heap, A* open list and sort breaks ties by region index (a total order), so Safari and Chromium agree.

Each phase is a generator function that yields, so the creation screen can animate between `requestAnimationFrame` calls.

| # | Step | Method | Cost at 64² (A15 est.) |
|---|---|---|---|
| 1 | Plates | 8-14 Voronoi seeds, each with a drift vector and an oceanic or continental flag. Converging boundaries become ridges, diverging boundaries rifts. | 60 k ops, < 2 ms |
| 2 | Elevation | plate base + boundary uplift + 4-octave value noise + falloff toward the sea sides. Sea level by percentile. Islands under 6 regions are flagged. | 3 ms |
| 3 | Temperature | latitude ramp + elevation lapse (-1 C per 8 elevation above sea) + low noise. `amp` grows with distance from the coast. | 1 ms |
| 4 | Rainfall | row sweeps west to east carrying moisture: picked up over sea, partly dropped where the land rises, little carried past ridges (rain shadow). Then a 3 x 3 blur. | 1 ms |
| 5 | Drainage | noise biased up on slopes and down in basins | 1 ms |
| 6 | Rivers and lakes | priority-flood fill of depressions (binary heap): any depth filled above 0 becomes a lake. D8 flow to the lowest neighbour. Flow is accumulated by rain in descending elevation order; above T1 a cell is a stream, above T2 a river, above T3 a great river. One erosion step lowers river cells by 1. | 5-8 ms |
| 7 | Volcanism, geology, taint | `volc` falls off from 2-5 hotspots and converging boundaries. `geo` comes from plate type and age. `taint` falls off from 2-4 **fall sites of the Old Crown**, plus noise. | 2 ms |
| 8 | Biomes | table lookup (1.3) | < 1 ms |
| 9 | History | section 2; also sets `owner`, `site` and `wild` | 100-250 ms |
| 10 | Roads | A* over regions between friendly sites. Cost: plains 1, hills 2, mountains 3, river barge 0.5. | 10 ms |
| 11 | Guarantees | 1.4 | - |

Total: about 0.2-0.35 s at 64² and about 0.6 s at 96² on an A15. Desktop gate: < 150 ms at 64² (fields < 60 ms, history < 90 ms; section 10).

### 1.3 Biomes and their mapgen knobs

Classification order:
1. `taint > 160` gives **ruins**.
2. `volc > 180` with `rain < 90` gives **ashlands**.
3. Coast-flag regions give **shore**.
4. Otherwise the biome comes from the elevation band (sea, coast, lowland, upland, highland, peak) x the temperature band (frigid < -5, cold < 4, temperate < 14, warm < 22, hot) x the rain band (arid < 40, dry < 90, moist < 160, wet) x drainage (low < 80).

Peaks are never embarkable, but they set a neighbour's massif side and thickness.

| id | Name | From | Ground palette | `mapgen3` knobs (relative to today's `GEN`/`GEN3`) | Threat lean |
|---|---|---|---|---|---|
| `greenvale` | Greenvale | temperate, moist | as today | today's defaults (the reference row) | as today |
| `elderwood` | Elderwood | temperate/warm, wet, high drainage | as today | forest 45 %, meadow 6 %, fog fronts x2 | beasts +, Rootwardens if felled |
| `ruins` | Hollowed Reach | taint high | as today | blight start 12-20 %, ruins x2, forest 12 % | Hollow +50 % |
| `ashlands` | Ashlands | volc high, dry | as today | ember pools 6-8 and one level higher, lava fords, no aquifer, ashfall fronts | fire |
| `fen` | Fenmere | lowland, wet, low drainage | reed greens, peat browns | aquifer 80 %, 2 lakes, clay top 40 %, forest 10 %, reeds; fog x2 | illness +, foul air |
| `moor` | Windmoor | cold/temperate, dry upland | heather purple-brown | forest 4 %, meadow 30 %, hills 3, rock clusters up; wind +40 | raids see far |
| `taiga` | Frostpine | cold, moist | blue-green conifers | pines only, winter -10 C, snow fronts x3 | wolves |
| `tundra` | Rimefell | frigid | white, slate, lichen | forest 0-2 %, frozen topsoil in Deepcold (mining +50 % time), growing season 15 days | cold |
| `saltflat` | Saltflat | warm/hot, arid | ochre, salt white | sand soil 60 %, no river unless flow, drought fronts x3, salt deposits near the surface | drought |
| `redscar` | Redscar | warm, dry, eroded upland | rust, banded stone | massif thick, many hills, ravines (one-level channels), sparse scrub | rockfall |
| `shore` | Shorehold | coast flag | sand, sea glass | sea on one edge (replaces one massif side), salt marsh, fishing | sea raiders |
| `highcrag` | Highcrag | highland next to peaks | grey stone, alpine meadow | massif 45-55 %, heights up to 5 everywhere, cold, a shorter season | beasts from peaks |

Palette notes: the 8 new biomes reuse existing ramps where they can (7.2). A new palette entry needs the art owner's approval (G19).

### 1.4 Guarantees and rejection

- **Embarkable regions.** At least 120 (Small: 70).
- **Every start fits somewhere.** For each start preset (3.8) there is at least one fitting region within 10 regions of a civ of the start's people.
- **Civs alive.** At least 4 civs are alive at the end of history (Small: 3), and at least one human civ.
- **Biome variety.** At least 6 distinct embarkable biomes (Small: 5).
- **Rivers.** Every river reaches the sea or a lake. Elevation never rises along a river.
- **On failure, only the failing step re-rolls**, using its stream with re-roll index n, at most 4 times. This matches `GEN3.guarantee`. After 4 failures the world is accepted with a warning row in the record; the gate counts these, and its target is 0 over 200 seeds.

### 1.5 World parameters

These are the fields of the Create world sheet (8.4). They are stored in the record header and in `s.realm.params`.

| Field | Values | Default |
|---|---|---|
| name | text, 1-24 chars; a generated name is offered | generated |
| seed | text or number (`seedOf`) | random |
| size | Small 48 / Standard 64 / Large 96 | Standard |
| history | 150 / 250 / 400 years | 250 |
| peoples | Few (6 civs) / Normal (9) / Many (13) | Normal |
| wildness | Low / Normal / High | Normal |
| Hollowing | Low / Normal / High | Normal |
| sea | One side / Two / Three / Random | Random |

### 1.6 Modules

| File | Owner | Role |
|---|---|---|
| `js/game/realm/gen.js` | L | `createRealm(params)`: a generator yielding per phase; returns the realm object (fields, tables, events) |
| `js/game/realm/fields.js`, `rivers.js`, `biomes.js`, `roads.js` | L | steps 1-8 and 10 |
| `js/game/realm/history.js`, `civs.js`, `figures.js`, `beasts.js` | L | step 9 (section 2) |
| `js/game/realm/region.js` | L | `regionOpts(realm, rx, ry)`: the `opts.region` for `mapgen3` (3.6); `regionFacts()` for the region card |
| `js/game/realm/finder.js` | L | site finder scoring (3.4) |
| `js/game/realm/tick.js` | L | the season tick (2.8) |
| `js/game/realm/record.js` | L (format), A (storage) | encode and decode of the record (9.2) |
| `js/game/realm/query.js` | L | read API for the sim and UI: `civOf`, `siteOf`, `figure`, `travelDays`, `neighbours`, `standing` |
| `js/data/realm/biomes.js`, `civkinds.js`, `ethics.js`, `params.js`, `events.js` | G | tables (append-only ids) |
| `js/data/text/realm.js` | G | grammar rows for events and deeds (original wording) |
| `js/engine/render/atlas.js` | C | baking of the world map atlas |
| `js/engine/art/atlas.js` | D | biome glyphs and site icons |
| `js/ui/worldmap.js` | I | the shared map component (embark and the World tab) |
| `tools/check-realm.mjs` | J | realm hash for fixture seeds in Node, Chromium and WebKit |

---

## 2. World history and legends

### 2.1 Frame (canon)

- **Age 0 is the Old Crown.** History begins at its fall, **the Hollowing**. The fall sites set the `taint` field.
- **History then runs N years up to the embark year.** The calendar is "Year N after the Fall", shown as "Year 231".
- **The existing vale pre-history (`legends.js prehistory`) stays as the local chapter.** It covers the embark region's vaults, crypts and beasts. Its events are re-dated inside the world timeline: vale year k maps to world year `embarkYear - (valeSpan - k)`.
- **The Hollow beneath every hold is the same Hollow.** The fall sites are where it broke through. That is why taint is high near them.

### 2.2 Entities and caps (Standard world)

| Entity | Count | Main fields (stored in the record's tables) |
|---|---|---|
| peoples | all `ancestry` rows with `civ` data (10 after W4) | (data, not stored) |
| civs | 6-13 (from params) | id, people, kind (one of the 12 `civkind` rows of 4.5: `realm`, `league`, `band`, `clans`, `pilgrims`, `warren`, `court`, `synod`, `drovers`, `wardens`, `choir`, `lamps`), name, heraldry seed, ethic[8], capital, founded, fell, ruler list |
| sites | 60-160 | id, kind (camp, hamlet, village, town, city, hold, grove, stilt-town, nomad camp, tower, shrine, lair, ruin, battlefield, vault), rx, ry, owner, size 0-5, founded, razed |
| figures | 300-600 | id, people, sex, born, died, civ, role (ruler, hero, smith, scholar, bard, outlaw, priest, envoy), name parts, deeds (event indices), kin (parent and spouse ids) |
| beasts | 4-12 | id, `beasts/gen.js` identity seed, lair site, born, slain by, kills |
| artifacts | 20-60 | id, kind, material, maker, made, holders [figure, year], lost at (site or region), name |
| wars | 5-25 | id, a, b, began, ended, cause (event), outcome |
| events | 2,000-6,000 (cap 6,000) | packed rows (2.4) |

### 2.3 The yearly loop

Civs run in id order every year. Each step uses the `realm:history` stream.

1. **Growth.** Each site grows by its biome fit for its people (the people's `homeBiomes` table) and its size cap. A site over its cap may found a daughter site in the best free region within 6, chosen by biome fit and distance. Murrow avoid open plains; Tarnfolk need a river, lake or coast; Wendrel found nomad camps that move every 10-30 years.
2. **Contact and grievance.** Civs with bordering regions within 3 gain contact. Each pair holds a relation: `rel = 40 - 8 * ethicDistance + pact bonuses - grievances`. Grievances come from razings, slain kin, oaths broken and border overlap.
3. **War and peace.**
   - **Starting a war.** If `rel < 0`, a war starts with chance `(-rel) / 400` per year, higher if either ruler is an aggressive figure.
   - **Each war year.** 0-2 battles are resolved. Strength is the sum of `site.size` within 8 regions, plus each hero's weight, plus a random term. A battle site gets a **battlefield** site. The loser loses a site: it is taken (owner changes), razed (it becomes a **ruin**; any artifacts held there become lost there), or it pays tribute.
   - **Peace.** A war ends by treaty after `3 + rnd(12)` years, or when one side has no sites left (the civ falls).
4. **Rulers.** Rulers age and die (lifespan comes from the people's `lifespan` row). Succession goes to a kin heir. Without an heir there is a crisis: with chance 30 % the civ splits, and a new civ takes the outer sites.
5. **Figures.**
   - **Birth.** Each living civ gets 0-3 new figures a year, weighted by role need.
   - **Deeds.** Each living figure has a 6 % yearly chance of a deed (2.5).
   - **Death.** Figures die of age, in battle or to beasts.
6. **Beasts.** A beast roams out of its lair (a region with high `wild`) every 5-20 years and razes a hamlet or village within 4 regions. A hero who hunts it has a chance to slay it; the hero's chance grows with deeds. A slain beast leaves its lair as a site holding a trophy artifact.
7. **The Hollowing.** Taint advances one ring around a fall site in years where `rnd < 0.04` and recedes in years where `rnd < 0.03`. A site under taint above 200 falls to the Hollow and becomes a ruin with an event.
8. **Plagues and famines.** These are rare: 1 % a year per civ. A plague kills 1-3 figures and shrinks sites by 1.
9. **Pacts and roads.** A pair with `rel > 60` may sign a trade pact. A pact makes a road (step 10 at the end) and raises `rel` by 10.
10. **Artifacts.** A smith's deed makes one. One is lost when its holder dies far from home, or when a site is razed.

Cost: about 250 years x 13 civs x 10 site checks, plus about 600 figure updates a year. That is 2-4 M simple operations: 100-250 ms on an A15 (est.). Desktop gate: < 90 ms at 64² and 250 years.

### 2.4 The event log

- **Row format.** Events are packed rows of 12 bytes: `Int16 year | u8 type | u8 flags | u16 a | u16 b | u16 site | i16 arg`. They are stored in a `DataView` over one `ArrayBuffer`, at most 6,000 rows (72 KB raw, about 25 KB deflated).
- **Types** are append-only ids in `js/data/realm/events.js`. Each type names the kind of each slot (`a` figure, `b` civ, and so on), and an importance 0-3.
- **At the cap**, importance-0 types (born, came of age, grew) stop being logged first, then importance 1; a deed, war, razing or fall is always logged. The history sim never reads the log, so the cap cannot change outcomes.

| Type group | Types |
|---|---|
| civ | founded, split, fell, crowned, succession crisis, pact, tribute, oath sworn, oath broken |
| site | founded, grew, taken, razed, fell to the Hollow, rebuilt, abandoned, moved (nomad) |
| war | declared, battle, siege, treaty |
| figure | born, came of age, slew (figure or beast), forged, lost, found, wed, exiled, died (cause in `arg`), wrote, sang, healed a plague |
| beast | woke, razed, wounded, slain |
| world | Hollowing advanced, receded, plague, famine, aurora year, comet, great flood |

### 2.5 Figures and deeds (event first, cause after)

1. **Pick a deed type** weighted by the figure's role and the year's state. For example, war years favour a slaying, and pact years favour envoys and smiths.
2. **Bind the slots from the state.** A victim comes from an enemy civ at war. An artifact comes from the figure's civ smiths. A place is the nearest fitting site.
3. **Rationalise.** Pick a **cause** from facts that are true in the state, in this order: a kin died at the hands of `b` (avenge); `b`'s civ razed the figure's birthplace (vengeance for a place); a war (duty); an oath; a beast (protect); ambition (fallback). The cause is stored in the `arg` and `flags` bits of the deed row, so the text can say "to avenge her brother Aldo, killed at Thornmark in year 112".
4. **Write the deed's consequences** back into the state: kin grievance, artifact holder, the figure's renown.

This is the cheap Caves of Qud technique (Grinblat and Bucklew 2017). It reads as well as a real simulation of cause and costs nothing extra.

### 2.6 Text

- **Text is never stored.** `js/data/text/realm.js` holds the grammar rows. Each row is a template with slot fillers and 2-6 variants picked by `hash(eventIndex)`. All wording is original.
- **Names come from `names.js` phonology tables, one per people** (W4 adds 6). Name parts are stored as small ids, so a figure name is 3 bytes.
- **Rendering is lazy.** The Annals screen renders only the rows it shows, with a cache of 200 strings.

### 2.7 How history feeds the live game

| Live system | What the realm gives it | Owner, file |
|---|---|---|
| **Annals** | a new **World** section: Eras, Civilizations (heraldry, rulers, sites, wars), Peoples, Sites ("Show on map"), Figures, Artifacts, Beasts. World keys `w<kind><n>` (`wf12` figure, `ws3` site, `wa7` artifact, `wc2` civ, `wb1` beast) sit beside today's `p<n>` and `q<n>`, and every name is a link. | I `annals.js`; L `query.js` |
| **Vale pre-history** | its places and beasts are re-dated in world years; a vale vault's builder may be a world figure of the parent civ | K `legends.js` |
| **Factions and goodwill** | the 5 roles are bound to civs (G7). New civ factions `c<n>` hold goodwill, which starts from `rel` to your parent civ. | K `factions.js` |
| **Caravans** | from friendly towns and cities within 12 travel days. Goods come from the site's biome and people (4.5). The cadence is `travel days x 2` plus 5 days, at the most once a season per site. A great river within 1 region makes barge caravans, which bring 1.5x goods. | K `caravans.js`, `trade.js` |
| **Raids** | from civs at war with your parent civ, or with `rel < -40` to the hold. They come from the side where the civ lives (spawn edges in `opts.region.edges`), with a size set by the civ's site count and raider rows per people (4.5), and are led by a named living figure. The figure's past deeds seed the nemesis record. | H `causes.js`, `raidplan.js`, `nemesis.js` |
| **Visitors** | living figures within 12 days: heroes, scholars, bards and priests. A bard tells a world tale (a thought, "heard the song of the Siege of Varn"). A monster hunter comes for a beast with a history entry. A cartographer marks a lost artifact's last known region on your World map (the world map has no fog: you chose your site from it). An envoy comes from the parent civ (offices, nobles, tribute) or from a neighbour (demands, 4.4). | K `visitors.js` |
| **Beasts** | world beasts whose lairs lie within 3 regions can come to the hold as surface great beasts, with their history (kills, wounds) on their peek card. The deep beasts stay generated by `mapgen3` (R3 3.12) but now get world-year births. | H `beasts/gen.js` |
| **Artifacts** | lost artifacts whose last known place is the embark region are placed in its ruins or vaults (`opts.region.relics`). Finding one makes an Annals event and can draw its old owner's civ (an envoy who wants it back, or a raid). | B `mapgen3.js`, K `legends.js` |
| **Offices and nobles** | the Lord or Lady of the Hold is a younger kin of the parent civ's ruler, with a world key | K `offices.js` |
| **Renown** | each season tick raises the hold's standing with civs within 12 days, by the hold's renown and its deeds | L `tick.js` |
| **Letters** | world news ("War between the Ashfang Clans and Varnholt", "Queen Ilsa of Varnholt has died") arrives with caravans and visitors, never out of nowhere | H `js/game/threat/letters.js`, K `news.js` (text G) |

### 2.8 The living world after embark (season tick)

The tick runs on the first tick of each season (40 days a year at R2 D3, so 4 world ticks a game year). It is a pure function of the record, `s.realm` (its deltas), the year and the season, and it draws from `hash32(worldSeed, year, season, k)` streams. It does:

- **War and peace** for pairs involving any civ within 16 regions of the hold. Other pairs advance one coarse step a year.
- **Site changes** in war: one battle per war per season at most. Results go into `s.realm.sites` deltas (`[site, owner, size, year]`).
- **Deaths of figures** by age. A bitset `s.realm.dead` covers figures that died after embark.
- **News.** Each change within 12 days becomes a **rumour** that a caravan or visitor delivers. A rumour is a compact event row in `s.realm.ev` (capped at 400; the oldest rows fold into a "years pass" summary).
- **The hold's own deeds** (a beast slain, an artifact made, a siege repelled) are posted into `s.realm.ev` as world events. They raise standing with civs whose ethics like the deed and lower it with civs whose ethics do not.

Cost target: < 2 ms desktop and < 5 ms on an A15, in one tick. If the device bench (W7.9) shows a dropped frame at 3x, the tick is split over the first 8 ticks of the season by civ id mod 8; the result is the same, so this is a pure scheduling change.

### 2.9 What stays out

- **No adventure mode, no army map and no travel** (G32).
- **The world tick never spawns a threat directly.** It only creates causes, and the storyteller still paces the threats (F26).

---

## 3. Embark: site choice, site finder, preparation

### 3.1 Flow

The flow is Title > **New hold** > **World** > **Map** > **Region card** > **Ready the band** (or **Found now**) > **Founding**.

- **World.** Pick a saved world or **Create world**.
  - Create world: the 1.5 sheet, then the generation screen. The screen animates the map phase by phase (land, rivers, biomes, then civ borders spreading year by year), shows phase names and a progress bar, and has a Cancel button.
  - Worlds are listed with their name, size, year and the number of holds founded in them.
  - **Quick start:** a visible **Quick start** card at the top of the World step (no hidden long-press). It generates a Standard world from a random seed and takes the finder's best Greenvale match near a human civ, so a first-time player is founding within 2 taps (New hold, Quick start).
- **Map** (8.4). Pinch and pan the world. Tap a region to select it and open the region card.
- **Region card.** It shows the region's facts, its neighbours and the 3 x 3 local view, with **Settle here** (disabled with a reason on sea, a peak or a site).
- **Ready the band.** Choose the parent civ, the start preset, the party and the supplies (3.5). **Found now** skips it with the preset's defaults.
- **Founding.** "Carving the hold" runs `mapgen3` with `opts.region`: 41 ms on the owner's phone (R3 6.0).

### 3.2 Which regions can be chosen

- **Allowed:** land regions with the `embarkable` flag that hold no site and are not peaks or sea.
- **A site within 1 region** gives a "Close neighbour" note (good for trade, bad if they hate you).
- **The parent civ must be within reach:** a civ whose territory or a friendly site is within 12 travel days. If none is in reach, Embark is disabled with "No people within 12 days would back a hold here".
  - Exception: the **Lone Ember** and **Refugee band** starts allow it ("No one will come to help").
- **Holds already founded in this world** mark their regions as used for this world's later holds. The region stays available as a world region but shows no ruin and no history entry (G28). The used list lives in the mutable **world index** (9.2), never in the immutable record.

### 3.3 Region card content

Every fact is in words, with the number in a smaller line.

- **Header:** biome name, coordinates, and a one-line description ("Low wet ground under alder and reed; the river spreads into pools").
- **Climate:** summer and winter means ("Summers mild, 16 C; winters hard, -6 C"), rainfall, growing season length in days, and the front kinds to expect ("Fog in Thaw, storms in Highsun").
- **Ground:** aquifer ("Heavy: wet sand under the lowland"), soil (loam, clay, sand, peat), the massif side and thickness, river and lake.
- **Stone and ore:** the rock province ("Granite shield: granite and slate near the surface"), and ore signs as confidence words ("signs of iron", "rumoured gold", "no coal seen"). These come from the `geo` ore weights, not from the generated hold.
- **Depth:** ember depth ("The ember layer lies shallow"), and the richness of the caverns as a word.
- **Danger:** Hollowing, wildness, nearby lairs ("A great beast, Morrag the Ash-Hide, is said to lair 3 regions north"), and enemies in reach.
- **Neighbours:** up to 6 nearest sites, each with owner, people, attitude to the chosen parent civ, and travel days.
- **History:** the 3 most notable events in or next to the region ("Year 188: the battle of Greyford was fought here"), each a link to the Annals.
- **3 x 3 local area:** the region and its 8 neighbours as 72 pt thumbnails.
  - The centre thumbnail is the actual surface of that hold, from `mapgen3`'s surface pass only: about 10-15 ms, LRU of 4, cosmetic.
  - The neighbours show biome glyphs, with arrows for river in and out and a shade on the massif side.
  - Tap a neighbour to move the selection there.

### 3.4 Site finder

The site finder is a sheet of filter rows: segmented controls at 44 pt, 8 rows visible, scrolling.

| Filter | Options |
|---|---|
| Biome | multi-pick chips (12) |
| Climate | Cold / Temperate / Warm / Any |
| River | Need / None / Any; Lake: Need / Any |
| Aquifer | None / Light / Heavy / Any |
| Mountain | Thin / Thick / Any |
| Ores near the surface | Iron, Copper, Coal, Gold, Gems (multi) |
| Ember | Shallow / Deep / Any |
| Hollowing | Low / Any / High |
| Wildness | Calm / Any / Wild |
| Neighbours | Near traders / Isolated / Near enemies / Any |
| Start fit | the chosen start's preset (Tarnfolk need water, Murrow need soil depth, and so on) |

- **Scoring.** Hard filters exclude a region. Soft preferences add to its score. Scoring all 4,096 regions takes < 1 ms.
- **Results.** The finder shows a count, pins every match on the map, and **Next match** pans to the matches in score order.
- **Memory.** The filters are remembered per world in localStorage, as a convenience only.

### 3.5 Preparation ("Ready the band")

The band sheet has 4 segments, each one screen at most.

1. **Liege.** Civs in reach, each with heraldry, people, ethic summary ("Honour the dead; distrust coin"), and relations with your other neighbours. The choice sets:
   - the ancestries the band can roll (the civ's people at 70 %, the rest from friendly civs within 12 days);
   - the liege for offices and nobles;
   - the starting goodwill with every civ (`rel` to the parent);
   - the creed pool (W6).
2. **Start.** The 3 presets of `starts.js` plus the 5 new ones (3.8). A preset sets the band size, the item list and the animals. The list is filtered by fit and shows a fit word ("Good fit: river and soil").
3. **Party.** 3-7 colonist cards (by preset), each with a portrait, ancestry, 2 top skills, one trait and one backstory line. Per card:
   - **Reroll** (deterministic: reroll k of card n uses its own mulberry32 seeded by `hash32(holdSeed, 'party', n, k)`, never `s.rng`);
   - **Ancestry** picker, limited to the allowed set;
   - **Name** edit.
   There is no point-buy on skills. Growth is by doing (F10).
4. **Supplies.** A budget of **1,000 crowns** (Hard: 800) spent on rows grouped as Food, Materials, Tools, Animals and Seeds. Each row has a price from `items.js` value and a 44 pt -/+ stepper. The preset's default list is pre-filled and **Reset** restores it. Leftover crowns become coin.

The sheet ends with **Found the hold**. Its record goes into `s.realm.prep`: preset, rerolls, ancestry choices and supply counts, about 120 bytes. So "Play again on this site" can rebuild the same band.

### 3.6 Region inputs to `mapgen3` (`opts.region`, GEN3 v2)

`regionOpts(realm, rx, ry)` returns a plain object. `generate3(s, opts)` reads `opts.region` when it is present; when it is absent, the v1 path runs unchanged. The object is also kept in `s.realm.embark`, so a debug regeneration can reproduce the hold.

| Field | From | Drives in `mapgen3` |
|---|---|---|
| `biome` | `biome` | palette id, knob row of 1.3, plant and animal sets (W6) |
| `side` | direction of the highest neighbour (`n`, `e`, `w`, and now `s`) | massif side (`G.sides` gains `s`) |
| `massifPct` | relief: own `elev` and the higher neighbours | massif thickness, 34 % floor (the guarantee) to 55 % |
| `heights` | elev band | `GEN3.heights.max` 2-5 |
| `river` | `{ in, out, cls }` from `flow` and neighbours | river entry and exit edges, width 2/3/5 by class, or none |
| `lake` | lake flag | lake count +1 |
| `aquiferPct` | `drain`, `rain` | `GEN3.soil.aquiferNearPct` |
| `soil` | `rain`, biome | loam, clay, sand or peat top mix |
| `climate` | `temp`, `amp`, `rain`, biome | `{ mean, amp, rain, fronts }`: read by `weather.js` and `temperature.js` (6.2) |
| `ember` | `volc` | ember pool count; ember layer at rel -12 (normal) or -11 (shallow) |
| `springs` | `rain`, `geo` | seep and spring counts |
| `stones` | `geo` | stone per band: basalt flood swaps the outer sandstone and limestone for basalt and slate; granite shield makes the outer granite |
| `ores` | `geo` | ore vein weights: basin coal x2 and copper; shield gold and silver; belt iron and gems; ash field lumenite |
| `blight` | `taint` | blight start percentage and Hollow seep richness |
| `wild` | `wild` | dormant den and beast counts |
| `ruins` | history sites in the region (battlefield, razed site) | ruin count and kind |
| `relics` | lost artifacts at the region | vault and ruin loot rows with world keys |
| `lairs` | world beasts with a lair here or adjacent | a surface lair row |
| `edges` | neighbours | spawn edge weights toward roads (caravans) and toward hostile civs (raids) |
| `caverns` | `geo`, `wild` | cavern richness 0-2 (fauna and flora counts only; the layers stay) |

**Rule.** Every embarkable region must pass the `mapgen3` guarantees. W2.3 runs 12 biomes x 20 seeds in the gate.

### 3.7 Preview

- **Region card thumbnail.** `previewSurface(seed, opts)` is a new export of `mapgen3`. It runs `surfacePass` only and writes into a 128 x 128 colour-index array, which is drawn at 1 px per tile into a 72 pt canvas and at 2 px in the large detent.
- **Band sheet.** A larger version shows the Hearth site and the massif face.
- The preview is cosmetic and is never saved.

### 3.8 Starts (8 rows; +5)

| id | Name | Band | Notes | Fits |
|---|---|---|---|---|
| `hearthwatch` | Hearthwatch Remnant | 3 of the liege's people | today's default | any |
| `deepforge` | Deepforge Delve | 3 Deepforge | today's | thick mountain |
| `lone_ember` | Lone Ember | 1 | today's, hard | any, even out of reach |
| `murrow_warren` | Murrow Warren | 4 Murrow | many seeds, few tools | deep soil, lowland |
| `tarn_shore` | Tarnfolk Shore | 3 Tarnfolk | fish traps, reed mats; cavern access matters | river, lake or shore |
| `wendrel_drovers` | Wendrel Drovers | 3 Wendrel | 6 animals, little food | moor, saltflat, highcrag |
| `refugees` | Refugee Band | 5 mixed, worn | little of anything, 2 injured; allowed out of reach | any |
| `crown_charter` | Crown Charter | 4 of the liege's people | 2x supplies, but a tithe each year (an envoy collects 10 % of the stock value, or goodwill falls) | near a `realm` civ |

---

## 4. Peoples

### 4.1 New ancestry fields (`js/data/ancestries.js`, validated in `js/data/schema.js`)

All new fields are optional. A field left out takes the neutral default, so the four existing rows play exactly as today until W4 gives them values. W4.1's oracle is that the legacy hashes do not change.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `playable` | `'start'` \| `'semi'` | `'start'` | `semi`: never in a founding band |
| `hunger` | pct | 100 | food need rate |
| `diet` | `'omni'` \| `'herb'` \| `'mineral'` | `'omni'` | `mineral`: eats coal or charcoal, never meals |
| `needs` | need ids | [] | extra needs: `sky`, `damp`, `heat` |
| `comfortC` | [lo, hi] | [10, 25] | comfort band for temperature thoughts |
| `band` | level band id | none | preferred depth band; +2 thought while living in it |
| `swim` | bool | false | water voxels are walkable at cost 1x (4.2) |
| `carry` | pct | 100 | hauling capacity |
| `sleepH` | hours | 8 | daily sleep; `dormantH` replaces sleep for Kilnfolk |
| `lifespan` | [adult, old, max] years | [18, 60, 90] | ageing (R3 3.13) and world figures |
| `values` | {value: -2..+2} | {} | biases the personality values (R3 3.2) |
| `ethic` | 8 numbers | all 0 | the civ ethic of this people's civs (4.4) |
| `build` | {mats, roomTag, thought} | none | build style: a small thought when a room matches |
| `relations` | {anc: -2..+2} | {} | opinion offsets between colonists, and worldgen relations |
| `homeBiomes` | {biome: weight} | {greenvale: 1} | worldgen site placement and biome fit |
| `settle` | settlement style | `'town'` | `town`, `hold`, `grove`, `nomad`, `stilt`, `warren`, `kiln` |
| `heal` | `'medicine'` \| `'mason'` | `'medicine'` | who treats their wounds |
| `births` | `'normal'` \| `'none'` \| `'rite'` | `'normal'` | Kilnfolk: `rite` |
| `rig` | object | human rig | art: height, width, head shape, parts (7.4) |

New modifier keys (R2 13.3): `need.hunger`, `move.water`, `carry.pct`, `work.dig.soil`, `glare.sun`, `mood.scale` and `work.dark`, which already exists.

### 4.2 Mechanics

| Mechanic | Rule | Owner, file |
|---|---|---|
| **Metabolism** | Hunger scales the food need by `hunger`. A `mineral` diet makes the eat job look for `coal` or `charcoal` (1 coal equals 1 meal) and never takes meals. The meal count on the stock chip excludes mineral eaters, and a "Coal for the Kilnfolk: 6 days" chip line covers them. | F `needs.js`, `needjobs.js` |
| **Extra needs** | `sky` is refilled by standing on a sky-open voxel or under a skylight or light shaft. It falls 2 per hour; at 0 it gives -4. `damp` is refilled by standing in a pool, a bath room or rain; it falls 2x faster above ground in Highsun. `heat` is refilled within 3 tiles of a lit forge, furnace, kiln or Hearth, or on the ember layer. | F `needs.js`; data `needs.js` |
| **Comfort band** | Temperature thoughts use `comfortC` instead of the fixed [10, 25] band. | F `mood.js` |
| **Swimming** | A swimmer's A* treats water voxels (`fluid` 1-7 and terrain water) as walkable at cost 1x; a walker pays 3x (wading) or cannot cross deep water. Regions and the link graph stay the walker's (pure, unchanged). When the walker graph says a goal is unreachable but the mover can swim, plain 3D A* runs with the usual cap of 8,192; its result (found or not) is cached per (start region, goal region, `linkStamp`), and a swimmer retries a failed search at most once per 10 game seconds. Drowning (R3 Z4): a non-swimmer in deep water for 30 s game time takes suffocation damage. | B `pathing.js` (A* and `followPath`) |
| **Dormancy** | Kilnfolk do not sleep. They go dormant for `dormantH` = 4 hours next to heat (the sleep job targets a "hearth-niche" or any lit forge tile). | F `needjobs.js` |
| **Stone mending** | A `mason` heal ancestry is treated by a colonist with Masonry, not Medicine. It needs stone blocks, not herbs. | F `health.js` |
| **Sun glare** | Lamplost take -20 % work speed and a -4 thought under open sky by day. | F `mood.js` |
| **Mood scale** | Greyborn scale every thought value by 50 %. | F `mood.js` |
| **Build style** | When a colonist's bedroom or most-used room matches their `build.roomTag` or is mostly their `build.mats`, they get `build.thought` (+2 or +3). | B `rooms.js` (tags), F `mood.js` |
| **Preferred band** | +2 while bedded in the `band`, -2 in the opposite band (sky people deep under rock). | F `mood.js` |
| **Mixed holds** | `relations` offsets add to opinions. Each pair whose peoples' ethics differ by 3 or more on an axis gets a 5 % chance per day of a "clash of custom" social fight when an act offends (4.4). | F `social.js` |

### 4.3 The ten peoples

Looks follow `docs/ART-STYLE.md`: 12-16 px tall in a 20-24 px canvas, 1 px ink outline, light from the top left. Skills use only today's 15 ids in `js/data/skills.js` (no skill is added, so no table or save changes).

| id (display) | Play | Look | Quirk (the drawback) | Skills (`learn` %) | Values | Build style | Home |
|---|---|---|---|---|---|---|---|
| `human` (Human) | start | as today | none; one extra passion (as today) | - | coin +1, law +1 | any; +2 in a Decent dining room | greenvale, shore, moor |
| `sylvari` (**Thornwake**) | start | as today, leaf-tone hair | **needs sky** (`sky`) | growing 125, animals 125 | trees +2, digging -1 | living wood (capwood, elderwood) | elderwood, greenvale |
| `deepforge` (Deepforge) | start | as today | slow on foot (-8 %); dislikes working on the surface in rain (-2) | mining 125, smithing 125 | craft +2, kin +1 | engraved stone; `work.dark` +20 | highcrag, redscar |
| `emberkin` (Emberkin) | start | as today | **heat-lover**: `comfortC` [18, 35]; cold half again as hurtful | melee 125 | valour +2, law -1 | brick and basalt near forges | ashlands, redscar |
| `murrow` (Murrow) | start | 11 px, round, furred umber and ochre, pale snout, 2 px digging hands, fur ridge | **close ceilings**: +3 in a room of 9 tiles or fewer, -3 in a Grand hall; carry -25 %; slow (-5 %) | growing 125, mining 110 (soil 2x speed), cooking 115 | kin +2, thrift +2, valour -1 | packed loam walls, round burrow rooms; a nook bed counts as a bedroom | greenvale, fen, moor (warrens) |
| `tarnfolk` (Tarnfolk) | start | 14 px, grey-green skin, darker dorsal stripe, gill frills, webbed hands, frill colour instead of hair | **must stay damp** (`damp`); swims; heat hurts; draining water is sacrilege (-3 to -6) | cooking 140 (fishing and brewing are Cooking work), medicine 110 | kin +1, law +1 | shell inlay, reed mats, a bathing pool room | fen, shore, lake (stilt-towns) |
| `wendrel` (Wendrel) | start | 16 px (the tallest), long face, two curled horns, shaggy mantle, hoof boots, mane | **big appetite** (130 %) and **needs sky** strongly (-4 after 2 days); carry +50 %; speed +10 % | animals 140, melee 115; trade prices 5 % better | hospitality +2, valour +1, law -1 | felt and timber long halls; a hearth circle counts as a dining room | moor, saltflat, highcrag (nomads) |
| `lamplost` (Lamplost) | semi (13.2 Q3) | 14 px, thin, chalk skin, large pale-blue eyes, lantern on a pole (light radius 2) | **dark-born**: no light need and no dark penalty, but sun glare; takes unstored things ("finders" crimes) | cooking 130 (fishing), animals 125 (cave beasts one step easier), mining 115 | coin +1, order -1, kin +1 | lichen-lit galleries; +2 near glowcap or lumenite lamps | caverns (no surface sites; trade at cavern mouths) |
| `kilnfolk` (Kilnfolk) | semi | 13 px, broad, basalt-grey cracked skin with orange crack pixels on a 2-frame pulse, ember core at the chest, shard crown | **mineral metabolism**: eats coal, needs heat, dormant 4 h, never ill, healed by masons, no births except a yearly kindling rite | smithing 140 (smelting is Smithing work), masonry 125; slow heavy blows | craft +2, order +1 | brick, emberrock, basalt; a hearth-niche bed | ashlands (kiln towns) |
| `greyborn` (Greyborn) | semi | 14 px, desaturated greys, faint violet eyes, ragged wrap | **muted** (thoughts x0.5); others -2 "uneasy around the grey" unless Reverence <= -1; senses the Hollow (omen 1 day earlier) | medicine 120, lore 120, melee 90 | reverence +2 (Grey Path), kin -1 | none | ruins (pilgrim shrines) |

Relations (`relations`):

| People | Warm to | Cool to |
|---|---|---|
| Murrow | Deepforge, Thornwake | Emberkin |
| Tarnfolk | Lamplost, Murrow | Kilnfolk |
| Kilnfolk | Emberkin, Deepforge | Tarnfolk, Thornwake |
| Wendrel | Human, Thornwake | Lamplost |
| Greyborn | Pilgrims | Hearthwatch (they distrust them) |

The rest are 0.

### 4.4 Civilizations, ethics, refusals, envoys and oaths

**Ethic axes** (`js/data/realm/ethics.js`), each -2..+2:

| Axis | Meaning |
|---|---|
| trees | old growth is sacred (+) or timber (-) |
| deep | digging deep is holy work (+) or a disturbance (-) |
| fire | flame is honoured (+) or dangerous (-) |
| water | still water is sacred (+) or a resource (-) |
| beasts | beasts are kin (+) or quarry (-) |
| dead | the dead must be buried and honoured (+) or are nothing (-) |
| coin | trade is virtue (+) or vice (-) |
| law | order and oaths (+) or freedom (-) |

- **A civ's ethic vector** is its people's `ethic`, plus a seeded jitter of up to ±1 on 2 axes. So two Human civs differ.
- **Relations at worldgen.** `ethicDistance` is the L1 distance between two vectors (0-32) and feeds `rel` (2.3). Shared home biomes add +5; competing for the same regions gives -10.
- **Refusals.** A civ refuses goods tagged against its strong ethics (|axis| = 2). If you try to sell them anyway, it escalates: the caravan leaves early, then an ambush, then a siege cause. Examples:

| Ethic | Refused goods |
|---|---|
| trees +2 | old-growth timber |
| water +2 | Mere-salt goods |
| fire +2 | water-quenched steel |
| beasts +2 | leather and bone goods |
| dead +2 | grave goods |

- **Envoy demands.** These are data rows, each with a condition, a deadline and an effect on goodwill:

| Civ kind | Demand |
|---|---|
| Murrow | "Dig no deeper than level -6 under our warren side" (the edge facing their sites) |
| Tarnfolk | "Do not drain the Mere" |
| Kilnfolk | "Keep a forge lit for our people" or "Send 40 coal" |
| Rootwardens | "Fell no more than 30 old trees a year" |
| Crown | "Pay the tithe" |
| any liege | "Send a levy": one colonist leaves for a season and returns with Melee skill, or dies |

- **Oaths.** Every civ has a named oath gesture, generated from a grammar, such as "the Salt-and-Ash pact" or "the Open Hand". Signing a pact means swearing it. Breaking it costs -30 goodwill with that civ and -10 with every civ ("oathbreaker"), and writes an Annals event.

### 4.5 Civs that send people (roles and kinds)

| Civ kind | People | Role binding | Sends | Hook |
|---|---|---|---|---|
| `realm` (kingdom) | Human | `hearthwatch` (liege) or `crown` | nobles, envoys, levies, tax clerks; a siege cause if the tithe is refused | the liege relationship (no win state) |
| `league` | Human, Murrow | `league` (traders) | big caravans, guild envoys | trade pacts make roads |
| `band` | any | `gutterkin` (thieves) | thieves, fences | justice |
| `clans` | Human, Emberkin, Wendrel outriders | `ashfang` (raiders) | raids | raid edge from their side |
| `pilgrims` | Greyborn, Human | `pilgrims` | pilgrims, preachers | the Grey Path creed (W6) |
| `warren` | Murrow | `c<n>` | small visits, grain for tools, petitions | the ceiling pact |
| `court` | Tarnfolk | `c<n>` | caravans that arrive through the Mere: pearls, shell, reed paper | they need a flooded passage or a shore depot; otherwise they arrive on the surface at half size |
| `synod` | Kilnfolk | `c<n>` | buy coal and ore; sell embersteel and heartstone | a quenched forge is an insult |
| `drovers` | Wendrel | `c<n>` | spring and autumn animal caravans (wool, felt, hides); refugees in hard winters | a seasonal route drawn on the World map |
| `wardens` | Thornwake hardliners | `c<n>` | envoys, then archer raids past the felling quota | bound to old growth only |
| `choir` | Greyborn zealots | `c<n>` | converts, rare fanatic raids | Hollow causes |
| `lamps` | Lamplost | `c<n>` | trade or theft at cavern mouths (50/50) | goodwill 50 unlocks recruits |

**New raider rows (8):**

| Raider | People | Notes |
|---|---|---|
| `wendrel_outrider` | Wendrel | fast spear |
| `rootwarden_archer`, `rootwarden_warden` | Thornwake | |
| `slagguard` | Kilnfolk | heavy |
| `netcaster` | Tarnfolk | stuns; comes from the water |
| `crown_levy`, `crown_knight` | Human | |
| `ash_zealot` | Greyborn | |

**New traders:** 6, one per new civ kind, each with regional goods. They are listed in 5.

### 4.6 Names

There is one phonology table per people in `names.js`: syllable sets, joins, and title grammars for figures ("Ilsa Varn-Daughter", "Old Brask of the Long Halls"). Here is the shape each new people's names take:

| People | Name shape | Examples |
|---|---|---|
| Murrow | short round syllables plus a burrow name | Pob Tumble-of-Fennock |
| Tarnfolk | liquid consonants, doubled vowels | Liira Oomlass |
| Wendrel | two-part herd names | Kesh of the Seven Horns |
| Kilnfolk | mineral words | Ash-Under-Slate |
| Lamplost | soft sibilants plus a lantern name | Siv Low-Lamp |
| Greyborn | a pilgrim number plus a virtue | Third Patience |

---

## 5. New content (prioritized tables)

**Rules for every row.** Ids are append-only. Every row is checked by `tools/validate-data.mjs`. New fields default to neutral values. Each row lists its art keys; a key with no art yet draws from a placeholder kit, and the contact sheet shows these as "undrawn" (allowed only until W7).

**P1: needed by the world, embark and peoples (W2-W4)**

| # | Table (file) | Adds | Mechanics it brings | Stage |
|---|---|---|---|---|
| 1 | `region biome` (`js/data/realm/biomes.js`) | 12 rows (1.3) with climate, plants, animals, stones, weather weights and threat lean | embark variety | W2 |
| 2 | `ancestry` | +6 rows, plus fields on the 4 existing rows (4.1, 4.3) | metabolism, needs, swimming, dormancy | W4 |
| 3 | `need` | +3: `sky`, `damp`, `heat` | gated per ancestry | W4 |
| 4 | `ethic`, `civkind` | 8 axes, 12 kinds (4.4, 4.5) | relations, refusals, envoys, oaths | W3-W4 |
| 5 | `faction` / `town` | the 5 roles kept; `town` rows retired (towns are world sites); legacy rows stay for realm-less holds | | W3 |
| 6 | `start` | +5 (3.8) | | W4 |
| 7 | names, backstories, thoughts | +6 phonologies; +18 backstories (3 per new people); +40 thoughts (needs, ethic offences, build style, world news, festivals) | | W4 |
| 8 | `events` (realm) and grammar | about 45 event types, 2-6 variants each | history text | W3 |
| 9 | raiders, traders, visitors | +8 raiders, +6 traders, +8 visitors: preacher, herd-guard, pearl diver, kiln pilgrim, tax clerk, cartographer, monster hunter, bard of the world | | W3-W4 |

**P2: breadth that makes long holds varied (W6)**

| # | Table | Adds | Notes |
|---|---|---|---|
| 10 | `plant` | +20: 2-3 per biome (birch, yew, willow, cedar, thornbush, saltgrass, sedge, heather, cave moss, emberbloom near heat, giant cavern fungus), crops (barley, turnip, woad, madder, hops) | plants spawn by `opts.region.biome` |
| 11 | `animal` | +18: longhorn, mule, dog, cat (vermin control), bee hive, heron, ash beetle, tundra elk, steppe pony, mere eel, moor grouse, fen toad, cave cricket swarm, salt lizard, rock goat, wolf pack, marsh boar, hawk | dogs guard; cats cut rot losses in stores |
| 12 | `material` | +12: chalk, gneiss, obsidian (ember layer), jade, salt; birch, yew; pearl, felt, wax, paper, dye (as a quality tag) | `STONES` and `DEPOSITS` grow (append-only) |
| 13 | workshops and chains | +8 workshops: dyer (plant to dye to coloured cloth, which feeds colour preferences), apiary (honey, wax), chandler (candles, a portable light), soapworks (tallow and ash to soap, which cuts illness), papermill (reed to paper, which feeds the scriptorium), saltworks (brine pump to salt, which preserves food), cooper (barrels, which raise drink storage), instrument maker (instruments, which raise festival quality). About +60 items and +60 recipes. | uses the existing bills and add-ons (F12) |
| 14 | furniture | +15: bathing pool, hammock, nook bed, hearth-niche, lantern shrine, loom tapestry, music stand, candle rack, prayer mat, totem, felt rug, reed screen, shell basin, standing stone, an altar per creed | room roles: `bath`, `music hall` |
| 15 | air structures | +5: chimney (on a workshop wall: its smoke goes to the sky), vent shaft (a channel to the sky that vents its cluster), bellows fan (lever-driven; moves air through a door), damp lamp (a safety lamp that shows firedamp and never lights it), lightning rod | 6.3 |
| 16 | `creed` | 6-8 rows: the Kindled Hearth (keep flames lit), the Delving Vow (digging is prayer), the Green Covenant (trees), the Tide Ledger (water), the Ancestor Stones (burial), the Grey Path (the Hollow), the Open Road (hospitality). Each row has tenets mapped to thought reactions, a shrine kind, a rite and a calendar day. A colonist takes their people's or liege's creed at 70 %. Mixed creeds bring friction and conversion talks. | F `creed.js` (new) |
| 17 | `festival` | 10 rows: first thaw, harvest home, longest night, founding day (from the Annals), and one per creed. Quality comes from food, drink, music and the room, and gives mood plus a renown deed. | K `festivals.js` (new) |
| 18 | mine-cart tracks | track, ramp track, cart, stop; carts carry 10 stacks along a laid route | left-over Z4 item (11) |

**P3: atmosphere and events (W5-W6)**

| # | Table | Adds |
|---|---|---|
| 19 | front kinds | 11: clear, drizzle, rain, storm, snow, blizzard, fog, heat wave, cold snap, drought, ashfall (6.2) |
| 20 | incidents | +15 unique: ash fall, valley fog, cavern mist, foul air pocket (gas from digging), mere surge, aurora, heat wave, hailstorm, migration herd, comet omen, tremor swarm, locust year, wandering minstrel troupe, Crown tax visit, envoy dispute |
| 21 | traits | +10: sky-sick, water-shy, iron lungs (ignores smoke), herd-hand, lantern-eyed, ember-blooded, storm-fearful, fog-born, sleeps light, gas-nose (senses firedamp) |
| 22 | thoughts | +30 atmospheric ones: soaked, storm fear, first snow, aurora awe, smoky air, foul air, fresh air after smoke, warm by the fire in a blizzard, golden hour |

Total: about 400 new rows across W2-W6.

---

## 6. Atmospheric simulation

### 6.1 Principles

1. **Two layers** (G15). The sim climate is small, deterministic and saved. The atmosphere director is cosmetic and is derived from saved state plus render time.
2. **Global scalars, per-tile hashes.** Snow cover, puddles, frost and leaf litter need no per-tile state: a tile shows the effect when `hash(tile) & 255 < level`. The result is identical after a reload.
3. **Bake, then draw.** Every effect is a native-size baked frame in palette colours. The frame loop only picks frames and calls `drawImage`. Pools are typed arrays, and nothing is allocated per frame.
4. **Tied to the region.** The embark biome's climate sets temperature, fronts, wind exposure, fog, aurora chance, critter set and foliage set.
5. **Readable first.** Designations, foes, selections, pips and overlays stay above all weather.

### 6.2 Climate in the sim (gameplay)

**Region climate** is read from `s.realm.embark.climate`. A realm-less hold uses the greenvale row, which equals today's numbers exactly. Today's fixed season temperatures become `mean + amp * seasonCurve[season]`, where `seasonCurve` is [0, +1, 0, -1] eased by day. The greenvale row reproduces today's table, and that is W2.4's oracle.

**The weather record v2** (`s.colony.world.weather`, `v: 2`):

```
{ v: 2, kind, since, until, day,                 // as today: kind is the front kind now in force
  front: { k, from, arrive, peak, leave, pow } | null,   // the next or current front; from 0-7 compass
  wind: [dir 0-7, speed 0-255], cloud, fog, wet, snow,   // u8 scalars
  hourAt }                                        // last hourly step
```

- **Fronts** are generated when the previous one leaves. The kind comes from the season's front weights in the climate row, drawn from `hash3(seed, day, k)`, so no RNG stream advances (as today). `arrive` is 12-36 hours ahead.
- **Forecast.** The front is shown once `tick >= arrive - 24 h` (`forecast(s)`). Storms and blizzards raise a letter at that moment.
- **Hourly step.** Each scalar moves toward the front's target by a fixed step, using a few integer operations per hour (< 0.01 ms per tick on average).
- **Migration.** A v1 record becomes v2 with its current kind kept, the scalars set to defaults (calm, wet 0, snow 0), and no front. The first front is generated the next morning.

**Effects** (each owned by the system that already reads weather):

| Effect | Rule | Owner, file |
|---|---|---|
| temperature | front offset (cold snap -15, as today; blizzard -10; heat wave +8); wind chill -3 outdoors above wind 160 | B `temperature.js` |
| growth | rain 125 %, drought 40 % (as today); a frost after Thaw sets back tender crops | B `plants.js` |
| daylight | `skyCap` from `cloud` (overcast 2, storm 1) | B `light.js` |
| fire | outdoor spread weighted downwind (fire.js neighbour weights by `wind.dir`); `wet` > 128 puts out outdoor flames | B `fire.js` |
| snow | `snow` > 96: outdoor move speed -10 %; > 192: -25 %. This is a speed factor in `followPath` (`pathing.js`), **never a path cost**, so the pathing caches stay pure (F25). Thaw melts snow into `wet` (mud: -10 % until dry). | B `pathing.js` (`followPath` speed) |
| fog | `fog` > 128: outdoor sight 6 tiles, ranged accuracy -25 %, raid route preview hidden beyond 12 tiles | H `fight.js`, C overlay |
| storm | ranged -15 %. Lightning hits the tallest sky-exposed plant or structure within a 16-tile cell. A lightning rod within 8 tiles takes the strike (it is grounded). Non-urgent outdoor jobs below priority 3 wait ("sheltering from the storm"). | B `weather.js`, E `think.js` |
| river surge | a storm or Thaw melt at a region with a river adds water at the river inflow edge for 6-24 hours (fluids sim, capped as R3 6.2). This is the gameplay hook for floodgates. | B `fluids.js` |
| blizzard | outdoor work speed -25 %; colonists caught out get "frostbitten" risk below -15 C | F `health.js` |
| mood | soaked (outdoor work in rain without a cloak, -2), storm fear (trait), first snow (+3, once per year), aurora awe (+4), golden hour (+1, outdoors at dusk) | F `mood.js`, data G |
| needs | rain refills `damp` (Tarnfolk); any open sky refills `sky` | F `needs.js` |

### 6.3 Air sim (gameplay)

**Cells.** The air is held per 16 x 16 x 1 cluster: `CW * CH * D` = 8 x 8 x 20 = 1,280 cells. Each cell has three u8 values: `smoke`, `foul` and `gas` (firedamp). They are saved in `RUNTIME` as `air` (3,840 bytes, deflated to well under 1 KB in practice).

**Links.** Two cells exchange air if the region graph has a walkable link between them: same level and adjacent, or vertical through a stair, ramp or shaft. The exchange weight is `w = min(4, links)`. The link list is a pure cache keyed by `linkStamp` (F25). Doors are read live at each step from the door list (a closed door removes its links' share; an open one counts as 1), because opening a door does not change `linkStamp`.

**Step.** Every 20 ticks (2 game minutes: a day is 14,400 ticks) the whole grid steps once. Integer maths only, from the old buffer into a scratch buffer, then swapped:

```
new = old + sources - decay                      (per cell)
for each link (c, n) with c < n, in index order: f = ((old[c] - old[n]) * w) >> 6;  new[c] -= f;  new[n] += f
for each cell with sky-open walkable voxels:     new[c] -= ventRate(open count, wind.speed)
clamp every cell to 0..255
```

Each link moves the same integer amount out of one cell and into the other, so the exchange conserves the total exactly. With at most 6 links of weight 4, a cell gives away at most 24/64 of its difference per step, so the step is stable and never oscillates.

**Sources and sinks:**

| Value | Sources | Sinks |
|---|---|---|
| smoke | a lit forge, kiln, smelter or bloomery, or a cooking fire, in a cell with no chimney on it (+3 per step each); fires (+20 per burning tile); the Hearth (+1) | vent to the sky; a vent shaft (-12); a bellows fan pushing through an open door |
| foul | corpses and rotting food (+2), refuse piles, a Hollow seep (+4, "grey air"), a crowded dormitory (+1 per sleeper above 6) | vents, a soapworks in the hold (-10 % decay bonus), cleaning |
| gas | **gas pockets**: dormant content rows that `mapgen3` places in coal seams and near the ember layer (2-6 per hold, 0 in v1 worlds, added by a world amendment for old holds, R3 5.6). Mining into one releases 120-200 into the cell; it then seeps +1 a step for a day. | vents only |

**Effects** (read by the systems that own them; F reads `airAt(s, voxel)`):
- **smoke** > 96: a "smoky air" thought (-2); > 160: -4, work speed -10 %, sight -2. The "iron lungs" trait ignores it.
- **foul** > 96: -2 and a 1 % chance per hour of a cough illness (the existing grey_cough row for grey air); > 160: -5.
- **gas** > 128 and any flame in the cell (a lit structure, a torch carrier, fire): a **firedamp blast**. Fire starts at the source voxel, there is blast damage within radius 3, a cave-in check on the cell's supports, the cell's gas drops to 0, and an Annals event is written. A damp lamp in the cell turns the readout red at gas > 64. "Gas-nose" colonists and Lamplost warn at > 64 (an alert naming the level).

**UI.** The **Air** overlay tints cells by the worst value, with a legend (8.8). Alerts read "Foul air on -4 (the old crypt)".

**Budget.** 1,280 cells and about 3,000 links, every 20 ticks: < 0.05 ms per step on an A15, about 0.003 ms per tick on average. The Small hold (96 x 96 x 16) has 576 cells.

### 6.4 The atmosphere director (render, cosmetic): `js/engine/render/atmos.js`

Once per frame the director reads `(tick, weather record, season, view band, region climate, settings)`. It writes one preallocated object with these fields:
- `grade` (sky colour index and alpha);
- `wind` (eased toward the sim wind, plus a cosmetic gust `0.6 + 0.4 * sin(t * 0.7 + sin(t * 0.23))`; this is render code, so `Math.sin` is allowed);
- `rain`, `snowFall`, `cloud`, `fog`, `wet`, `snowCover`, `night`, `dawnDusk`.

Values ease with a fixed time constant, so a front rolls in over real minutes, not in one frame. Cost < 0.02 ms, with no allocation.

### 6.5 Effects (cosmetic)

| Effect | Technique | Where |
|---|---|---|
| **Colour grade** | the open-sky colour and band alphas of the darkness texture come from a keyframe table: pre-dawn violet, dawn rose, morning, noon, golden hour, dusk plum, night blue. Season shifts the keys; overcast uses slate. The grade index joins the light texture's rebuild key, so the cost is the existing 1 ms rebuild a few times per dawn and dusk. | surface levels |
| **Cloud shadows** | two baked tileable 64 x 64 and 48 x 48 value-noise canvases, posterised with Bayer 4, at ink alpha 0.10-0.16 by `cloud`. They drift with the wind at different speeds, are snapped to art pixels, are masked to open sky in a 256 x 256 offscreen (2 px per tile) recomposed at 10 Hz, and are drawn **before** the darkness. | surface |
| **Fog sheets** | the same machinery with a bone-mist dither at 3 densities, drawn **after** the darkness (it reads at night as a cold glow); morning fog burns off by 10:00. In caverns near water and on the ember layer (heat haze): a static mist dither at low alpha. | all |
| **Rain and snow** | today's block sheets plus 3 slant variants by wind and 2 intensities; up to 24 pooled 2-frame splash sprites; ripple rings on water | surface |
| **Puddles** | decals (3 shapes x 2 sizes; a 1 px highlight takes the grade colour) where `hash < wet`. The list is rebuilt when `wet` crosses a 1/16 step or the view moves a chunk; no chunk rebake. | surface |
| **Snow cover** | 3 stages (dusting, cover, drifts on the windward side of walls). A stage change rebakes visible chunks through the 1-bake-per-frame queue. Footprints come from a 64-entry ring of recent colonist positions. Snow roofs and snowy trees are baked variants. | surface |
| **Lightning** | a full-screen fill at low alpha (never white) for 2 frames; thunder 0.5-3 s later. At most 1 flash per 4 s and never 3 per second (WCAG 2.3.1). Reduce motion: a 1-frame dim pulse. | surface |
| **Wind sway** | grass, crops and trees get 2 baked frames (canopy top shifted 1 px), and banners 3; the frame is `((time * gust + phase) \| 0) & 1`, with no state | near band |
| **Debris** | a screen-space pool of 32 sprites (leaves in Ashfall, petals in Thaw, flakes in a blizzard, dust in drought, ash in ashfall) that wraps at the edges and moves with the wind | surface |
| **Critters** | a struct-of-arrays pool of 48 (Float32 x, y, vx, vy, t; u8 kind, state), with a render-only xorshift per spawn tile, spawned off-screen by biome, season, hour, band and weather. Day: bird flocks with shadows, perching birds that flee colonists, butterflies, a heron. Night: fireflies (emissive), moths at sconces, bats at dusk from cavern mouths. Water: fish rises. Underground: dust motes in shafts, falling grit by fresh faces, teal spores (emissive), cave crickets, ember sparks. | all |
| **Chimney smoke** | data `smokeAt` anchors (like `flameAt`); 2-3 baked puffs per lit chimney rising and bending downwind, cycle-driven; at most 16 in view. Smoke from a cell with high `smoke` air also curls out of its doorways. | all |
| **Steam and breath** | steam where water meets ember or magma (the fluid layer knows those tiles), with a hiss; breath puffs below 0 C outdoors every 2.5 s per visible colonist (hashed phase) | all |
| **Light shafts** | a sky-open column over a deeper level gets a baked dithered diagonal beam (alpha 0.15-0.25 by daylight, slanted by sun hour in 3 steps) with motes, drawn after the darkness by day | below surface |
| **Lit windows** | occupied shells show gold window pixels in the emissive pass at night | surface |
| **Aurora** | on cold, clear Deepcold nights (chance from latitude): a slow teal and violet shimmer added to the night grade over snow (one dithered pattern, `lighter`, low alpha), and a band on the title and the world map; noted in the Annals | surface |
| **Ember glow** | slow pulse of the warm band; rising sparks; a baked 3-ring dithered bloom halo around magma and the Hearth | ember layer |

### 6.6 Sound and music (`js/engine/audio.js`, `js/engine/audio/ambience.js`)

- **Beds by layer.** All beds are the existing noise and filter graphs with new parameters; no samples.

| Bed | Driven by |
|---|---|
| wind | gain and filter from `wind.speed` and gusts |
| rain | two beds: drizzle and storm |
| thunder | synth crack plus a low rumble |
| dawn chorus | bird event rate peaks 05:00-08:00 |
| night | crickets in Highsun nights; owls |
| frogs | near fen after rain |
| underground | cavern drips, ember rumble, steam hiss |
| air | a muffled cough when foul air is high in view |

- **Spatial.** Local beds (water, fire, forge) are weighted by what is on screen and by zoom. Each bed has one StereoPanner, panned by the screen x of the nearest source and updated at 4 Hz.
- **Music by vertical layers.** The synth score has these layers, keyed to state:

| Layer | When |
|---|---|
| base | the season mode |
| pulse | work and bustle |
| tension | a threat imminent or a front forecast |
| night | at night |
| depth | deeper levels drop the high voices |

  - **Stingers:** season turn, first snow, storm warning, birth, death, great beast.
  - **Crossfade** over 2 bars.
- **Battery saver.** Music stays off (as today) and ambience runs at half rate.

### 6.7 Settings matrix

| Effect | Default | Reduce motion | Battery saver | Strategic zoom (< 0.5) |
|---|---|---|---|---|
| Colour grade | on | on | on | on |
| Cloud shadows | drifting | static | off | faint |
| Fog sheets | drifting | static | static | on |
| Rain and snow sheets | on | half density, no slant change | half density | off |
| Splashes, ripples | on | off | off | off |
| Puddles, snow cover | on | on | on | on |
| Sway, debris | on | off | off | off |
| Critters | 48 | perched and still only | 12, no emissive | off |
| Smoke, steam, breath | on | static puffs | smoke only | off |
| Light shafts | with motes | no motes | no motes | off |
| Lightning | capped | dim pulse | capped | capped |
| Frame rate | 60 moving, 30 still | same | 30 moving, 20 still in calm weather | same |

**Sim effects never depend on settings.** Fog accuracy, snow speed and air all run identically whatever the display settings are (C13).

### 6.8 Budgets

| Item | Budget (A15 est.) |
|---|---|
| Sim climate | < 0.01 ms per tick (hourly step) |
| Air sim | < 0.05 ms per 20-tick step |
| Director | < 0.02 ms per frame |
| Grade | 0 (folded into the light rebuild) |
| Clouds or fog | 0.15 ms per frame + 0.3 ms at 10 Hz |
| Rain or snow | 0.2-0.4 ms (as today) |
| Splashes, puddles, ripples | 0.15 ms |
| Sway | 0.05 ms |
| Debris and critters | 0.2 ms |
| Smoke, steam, breath, shafts, windows | 0.2 ms |
| **Atmosphere total** | **<= 1.5 ms p95 in the worst weather**, inside the 8 ms render p95 |

Gates:
- `render-check` gains an `atmos` scene set: storm at dusk on a busy surface, a blizzard, a cavern with spores, fog at dawn.
- Zero allocations per frame, checked by a heap-snapshot diff in the bench.
- `bench --scene=air` measures the air step with 40 lit forges and 3 gas pockets.

---

## 7. Assets

### 7.1 Techniques (used throughout)

- **Hue-shifted ramps.** Shadows lean violet or blue and highlights lean gold. Existing ramps are adjusted rather than adding hex values in art code.
- **Bayer dither** at shade borders only.
- **Sub-pixel animation.** Shift a highlight or edge pixel's colour instead of moving the shape. This is used for breath, sway and flags.
- **Palette cycling**, baked as 3-4 frames, for water, lava, glowcaps, crystals and fire.
- **Part-based painters.** A seeded composition of parts, as in the colonist rig. Painters are also used for trees, portraits and props.
- **The contact sheet is the review gate:** `?debug=1&scene=art` must show 0 errors and, from W7 on, 0 undrawn keys.
- **Palette.** It may grow to at most 38 colours. The candidates are rose, dusk, frost, aurora and leaf. `docs/ART-STYLE.md` section 2 is updated in the same step.

### 7.2 What to redo, in order

| # | Asset | Technique and scope | Stage |
|---|---|---|---|
| 1 | **Pixel FX sheet** | puffs (3 sizes x 3 alphas), spark, drop, splash, ripple, chip, leaf, petal, flake, mote, puddle decals, footprints; replaces `arc` puffs and `fillText` particles in `engine/particles.js` (floating numbers come from a cached glyph canvas) | W1 |
| 2 | **UI art** | 9-slice pixel panel frames baked from a canvas into CSS `border-image` (carved stone for menus, iron-banded wood for letters); section headers with a rune rule; new one-bit 16 x 16 icons (weather kinds, wind arrow, forecast, biome, ancestry crests, overlays, world) | W1 |
| 3 | **World map art** | 1-2 px per region: elevation hillshade lit from the top left, biome ramps, dithered coasts, 1-3 px river lines, 8 x 8 biome glyphs (tree clumps, peaks, dunes, reeds, waves) baked into one 512 x 512 atlas canvas (1 MB), civ borders as dotted heraldry tinctures, site icons by size class (16 x 16 one-bit), drifting cloud shadows (reused from 6.5) | W2 |
| 4 | **Biome ground sets** | new ground palettes and tiles for fen (peat, reed), moor (heather), taiga, tundra (lichen, frozen soil), saltflat (salt crust, sand), redscar (banded rust), shore (sand, sea glass, the sea edge), highcrag (alpine turf) | W2 |
| 5 | **New ancestries** | the rig becomes data-driven (`ANC_IDS` from data): part slots for head shape, ears, horns, tusks, frills, tail, body width and height offset; per-ancestry skin ramps; a cold-weather layer (hood and cloak) shown outdoors in Deepcold; 2-frame idle breathing (sub-pixel), sit, sleep and eat poses | W4 |
| 6 | **Portraits** | a 32 x 32 bust painter shown at 2-3x: face shape, eyes, brows, nose, mouth, hair, beard, ancestry parts, scars and missing eyes from injuries, an age step, 4 mood expressions, and a background tinted by role or office. It replaces the scaled 16 px figure in `ui/thumbs.js` (medallions, party, letters, Annals). Cached per colonist at 32 x 32 (4 KB each); world figures in the Annals use an LRU of 32. | W4 |
| 7 | **Atmosphere frames** | rain slants, splashes, ripples, snow stages, snow roof and snowy tree variants, smoke puffs, steam, breath, light shaft beams, lit-window masks, aurora pattern, bloom halos | W5 |
| 8 | **Critters sheet** | birds (flap, glide, perch), butterflies, fireflies, moths, bats, fish, heron, frogs, cave crickets, spores; existing animals get an idle frame (graze, sniff) | W5 |
| 9 | **Trees and plants** | a part-based tree painter (trunk with root flare and branch stubs, a canopy from seeded blobs shaded by a top-left normal, a 1 px highlight rim, a dithered core shadow); species by biome (birch, willow, cedar, pine, oak, yew, succulent, giant cave fungus); 4 season variants each (blossom, full, ember-gold, bare with snow); 2 sway frames; stump and fallen log; grass tufts and flowers by biome | W6-W7 |
| 10 | **Ground transitions** | dithered blend edges between grass, soil, sand, marsh and snow (corner autotile); a wet-ground variant (one ramp step darker); mud in Thaw | W7 |
| 11 | **Structures** | weathering (moss on old stone walls, hashed stains), banners with 3-frame sway, chimney anchors, new workshop and furniture art (5, P2) | W6-W7 |
| 12 | **Underground dressing** | stalactite and stalagmite props, crystal clusters (emissive, cycling), glowmoss, drip sources, ember crust with a 3-frame cycle, magma bloom; placed cosmetically by hash on natural cavern tiles (no sim state) | W7 |
| 13 | **Live title** | layered parallax ridges showing the last save's season, weather and time of day (cloud drift, snow, aurora); static under Reduce motion | W7 |

### 7.3 Rules

- **Budget.** Any new baked sheet must fit the sprite cache of 40 MB (R3 6.4). The atlas and portrait caches count toward the held-canvas ceiling.
- **Contact sheet entries.** Every art key gets one, with its frames and season variants.
- **Ownership.** Art lives in `js/engine/art/*` and belongs to D. Render code that draws it belongs to C.

---

## 8. Menus and UI redesign

The current restyle (stone and brass frame, pixel-art cards, medallions) holds up. Its weak points are layout and information architecture, and they are worst in landscape (`ui.md` 2). This section keeps the visual language and rebuilds the structure.

### 8.1 Information architecture (by activity, not by system)

| Bar slot | Was | Becomes | Contents |
|---|---|---|---|
| 1 | Build | **Build** | rooms, structure, furniture, workshops, defence, mechanisms, air (chimney, vent, fan). One category strip with fade edges; compact cards (one-line name with ellipsis plus a cost line; the description is on long-press or "?") |
| 2 | Orders + Zones | **Mark** (the sheet is titled "Mark: Orders, Zones"; "Designate" is too wide for a 62 pt slot at 14 px) | Orders and Zones as two segments of one sheet (both are drag tools). The tool stays armed until it is cancelled. Long-press re-arms the last tool. |
| 3 | Colony: People, Work, Schedule, Military | **People** | one roster (People and Work merged), filtered by All, Soldiers, Children, Visitors and Animals. Views: List, Grid (work priorities) and Schedule. Military is a section with the alert switch pinned. |
| 4 | Colony: Research, Stock, Hold, Chronicle | **Hold** | Overview (wealth, rank, Hearth, food and coal days, air warnings, threats), Stock, Research, Offices and Justice, Halls and visitors, Creeds and festivals (W6) |
| 5 | Menu: Letters, Help; Hold: Annals, The dead | **World** | the world map (your pin, neighbours, routes, wars), Annals (Years, Figures, Places, Artifacts, Wars, World), Letters, Peoples and factions (standing, ethics, oaths, demands), The dead |
| top-left | Menu (mixed) | **Menu** | storage and app only, grouped with icons: Save now, Back up, Holds and ruins, Settings, Help, Quit to title |
| speed | bare ">" | **Speed button** | shows its state: "II", "1x", "2x", "3x" or "5x". Tap toggles pause; long-press opens the speed fan (exists). |

**Sheet rules (G21):**
- One sheet at a time.
- A sub-screen pushes inside the sheet with a back arrow and a breadcrumb ("Hold / Offices").
- Detents: **medium** (about 50 % of the height, map visible) and **large** (full height minus the top bar). Tapping the grabber cycles the detents; swiping down closes.
- A sheet's paragraph shows on the first visit only, then sits behind "?".
- Disabled cards collapse into a "More later (3)" row that lists the reasons.

### 8.2 Gestures

| Gesture | Effect |
|---|---|
| Tap | select (opens the peek card); tap empty ground to close it |
| One-finger drag | pan; with a tool armed, paint |
| Pinch | zoom |
| **Two-finger vertical swipe** | level up or down, one level per 60 pt; the level ruler shows while it runs |
| **Long-press on the map** | **context ring** at the finger with the 4-6 most likely actions for that voxel (Mine, Chop, Build here, Stockpile here, Move drafted here, Cancel marks); the game pauses while it is open; the ring is clamped inside the safe area (it shifts away from the edges, so in landscape it fits the 335 pt height) |
| Long-press Mark / speed | re-arm the last tool / speed fan (exist) |

A left-edge swipe in landscape is never used, because it collides with Safari's back gesture.

### 8.3 Front end

```
TITLE (portrait 390 x 664)               WORLDS                                 CREATE WORLD (sheet, large)
+--------------------------------+       +--------------------------------+      +--------------------------------+
| [live title art: ridges, the   |       | [<] Worlds                 [?] |      | [x] Create a world             |
|  last save's season, weather]  |       |                                |      | Name   [ Ashenreach        ][~]|
|          EMBERCROWN            |       | +----------------------------+ |      | Seed   [ 48213             ][~]|
|           The Hold             |       | | Ashenreach  Standard  y.231| |      | Size   [Small][Standard][Large]|
|                                |       | | 2 holds: Ironbrook (y.3)...| |      | History[ 150 ][ 250 ][ 400 ]   |
| [ Continue: Ironbrook, Year 3 ]|       | +----------------------------+ |      | Peoples[ Few ][Normal][ Many ] |
| [ New hold                    ]|       | +----------------------------+ |      | Wild   [ Low ][Normal][ High ] |
| [ Worlds                      ]|       | | Velmarch    Small     y.150| |      | Hollow [ Low ][Normal][ High ] |
| [ Holds and ruins             ]|       | +----------------------------+ |      | Sea    [Random][1][2][3]       |
| [ Settings ]   [ Help ]        |       |                                |      |                                |
|                    v0.5 . W2   |       | [ + Create a world           ] |      | [      Generate the world    ] |
+--------------------------------+       +--------------------------------+      +--------------------------------+
```
- On the first run **Continue** is hidden. **Quick start** is the first card of the World step (3.1). **Import a file** stays on the title (it exists today, R3 header) and in Holds and ruins.

```
GENERATING (full screen, animated)        WORLD MAP (portrait)                     WORLD MAP (landscape 844 x 335)
+--------------------------------+       +--------------------------------+      +--------------------------------------------------------+
|  Ashenreach                    |       | [<] Ashenreach  y.231  [?][Find]|     |[<] Ashenreach y.231 [Atlas][Elev][Temp][Rain]...[Find] |
|                                |       | [Atlas][Elev][Temp][Rain][Ember]>|     |                                     |  REGION CARD     |
|  [map drawn phase by phase:    |       |                                |      |   world map, pinch/pan,             |  (45 % width,    |
|   land, rivers, biomes, then   |       |  pixel world map, pinch/pan;   |      |   region frame pulses               |   full height)   |
|   civ borders spreading year   |       |  civ borders, roads, site      |      |                                     |  Ironbrook ...   |
|   by year]                     |       |  icons; matches glow; selected |      |                                     |  [Settle here >] |
|  Raising the mountains         |       |  region pulses                 |      |                                     |                  |
|  [==============-------] 64 %  |       |                                |      | [-][fit][+]                          |                  |
|                     [ Cancel ] |       | [-] [fit] [+]       3 matches >|      +--------------------------------------------------------+
+--------------------------------+       +--------------------------------+
```
- The layer chips (44 pt each) scroll horizontally: Atlas, Elevation, Temperature, Rain, Drainage, Ember, Hollowing, Wildness, Peoples, Rock. Each shows a 14 px legend strip.
- At fit zoom, a tap shows a loupe; at 4x and above, a tap selects directly.

```
REGION CARD (medium detent)              REGION CARD (large detent, scrolled)     SITE FINDER (sheet)
+--------------------------------+       +--------------------------------+      +--------------------------------+
| ==== grabber ====          [x] |       | Neighbours                     |      | [x] Find a site      41 match  |
| Fenmere . (31, 18)             |       |  Varnholt (Human town)         |      | Biome  [Fen][Vale][Moor][+]    |
| Low wet ground under alder and |       |   friendly to your liege, 4 d  |      | Climate[Cold][Temp][Warm][Any] |
| reed; the river spreads.       |       |  Oomlass Pools (Tarnfolk)      |      | River  [Need][None][Any]       |
| Summer 17 C . Winter -4 C      |       |   wary, 2 d                    |      | Aquifer[None][Light][Heavy][*] |
| River (from the north) . Lake  |       | History                        |      | Ores   [Iron][Copper][Coal][+] |
| Aquifer heavy . Soil peat, clay|       |  y.188 Battle of Greyford >    |      | Hollow [Low][Any][High]        |
| Stone: basalt; signs of copper |       |  y.204 Varnholt took the ford >|      | Neighb.[Traders][Alone][Any]   |
| Danger: low . Hollow faint     |       | Local area                     |      |                                |
| [ View the area ] [Settle here>]|      |  [nw][ n][ne]  72 pt each      |      | [ Show 41 on the map ]         |
+--------------------------------+       |  [ w][@@][ e]  @@ = the real   |      +--------------------------------+
                                         |  [sw][ s][se]     surface      |
                                         +--------------------------------+
```

```
BAND: LIEGE / START                      BAND: PARTY                              BAND: SUPPLIES   
+--------------------------------+       +--------------------------------+      +--------------------------------+
| [<] Band     [Liege][Start]... |       | [<] Band     ...[Party][Suppl.]|      | [<] Band         Crowns 1,000  |
| Liege                          |       | +----------------------------+ |      | Food                           |
| (o) Varnholt  [crest]  Human   |       | |[bust] Ilsa Varn  Human     | |      |  Meal       12   [-] [+]   48  |
|     Honour the dead; love coin |       | | Mining 4  Building 3       | |      |  Hearthroot 40   [-] [+]   40  |
| ( ) Oomlass Pools  Tarnfolk    |       | | Steady hands . "a miner's  | |      | Materials                      |
|     Still water is sacred      |       | |  daughter from the ford"   | |      |  Wood       50   [-] [+]   50  |
| Start                          |       | | [Reroll] [Ancestry v] [Aa] | |      | Animals                        |
| (o) Hearthwatch Remnant  good  |       | +----------------------------+ |      |  Longhorn    2   [-] [+]  160  |
| ( ) Tarnfolk Shore       best  |       | +----------------------------+ |      |                     [ Reset ]  |
|                                |       | | [bust] Pob Tumble  Murrow  | |      | Left over: 112 crowns (coin)   |
| [Found now ]  [ Next: Party > ]|       | ...                            |      | [   Found the hold   ]         |
+--------------------------------+       +--------------------------------+      +--------------------------------+
```

### 8.4 Play HUD

```
PORTRAIT 390 x 664
+--------------------------------------+
| [=] Day 3 . Thaw . 14:05  [!17h][5d] |  menu; clock (always the season word, never a glyph); threat chip; food chip
| (E)(O)(T)(+2)    [sky: rain by dusk] |  colonist rail (collapses to +N, never hidden); sky chip (forecast)
|                           [overlay v]|  overlay picker
|                                 [^]  |
|              MAP                [-3 Shale]  level pill: number and band name in one pill (no floating label)
|                                 [v]  |
|                                 [mm] |  minimap with the capsule
| [alert]                              |
| [alert]  (max 3, left edge)          |
|--------------------------------------|
| Ilsa Varn . Miner         [Open >]   |  peek card: the name plate opens the full sheet (chevron)
| Mining a vein of copper on -3        |
| [Draft] [Prioritise] [Follow]        |
|--------------------------------------|
| [1x] Build Mark People Hold World     |  speed shows its state; 6 slots of about 62 pt
+--------------------------------------+

LANDSCAPE 844 x 335 (sheet open)
+------------------------------------------------------------------------------------+
|[=] Day 3 Thaw 14:05 [!17h][5d] (E)(O)(T)+2  [sky: rain by dusk] [ov]   | Hold / Stock  [?][x] |
|  [^]                                                                   | [Overview][Stock]... |
|  [-3 Shale]        MAP (the camera shifts left so the selection        |                      |
|  [v]               stays visible beside the sheet)                     |  SHEET 45-50 % wide, |
|  [mm]                                                                  |  full height; title  |
|  [alerts]                                                              |  and tabs on 1 row   |
|  [1x]                                                                  |                      |
+------------------------------------------------------------------------------------+
  (the bar becomes a right rail of 5 slots when no sheet is open; the sheet covers it while open)
```

- **Bar labels** are 14 px at every text size (the text-size setting scales sheets, not the bar), so "People" fits a 62 pt slot; each slot also has a 16 x 16 icon.
- **Landscape layout.** The level capsule and speed button move to the left edge, inside the safe area. The peek card is a compact card at the bottom right (280 x 120 pt).
- **Notch and Dynamic Island.** `env(safe-area-inset-*)` applies on all four sides. The ui-phone flows test landscape-left and landscape-right (R3 E7).

### 8.5 The main sheets

```
PEOPLE (medium)                          HOLD / OVERVIEW (large)                  WORLD (large)
+--------------------------------+       +--------------------------------+      +--------------------------------+
| People   [All][Soldiers][Kids] |       | Hold  [Overview][Stock][Resea] |      | World [Map][Annals][Peoples].. |
| [List][Grid][Schedule]    [?]  |       | Ironbrook . Village . Year 3   |      | [ world map, your pin, routes, |
| (bust) Ilsa Varn  Miner    92 >|       | Wealth 4,210 . Renown: delving |      |   wars, neighbours; tap a site |
|   Mining copper on -3  [Miner] |       | Food 11 days . Coal 6 days     |      |   for its card ]               |
| (bust) Pob Tumble Grower   71 >|       | Air: smoky on -2 (smithy)    > |      | Neighbours                     |
|   Sowing barley        [Grow]  |       | Threats: Ashfang raid in 17h > |      |  Varnholt  liege  +62  4 d   > |
| (bust) Liira Oom  Fisher   55 >|       | Hearth: fed, 2 days of fuel    |      |  Oomlass   wary   -10  2 d   > |
|   Damp need low (go bathe)     |       | Offices: 4 of 6 filled       > |      | News                           |
| Military: [Alert off] squads > |       | Visitors: a bard from Oomlass> |      |  War: Ashfang vs Varnholt    > |
+--------------------------------+       +--------------------------------+      +--------------------------------+
```

- **Annals** (World / Annals) gets one list with filter chips: Years, Figures, Places, Artifacts, Wars, World. Each entry has its world year and links. "Show on map" jumps to the World map tab with the site selected. It is never a second sheet.
- **Peoples and factions** has one card per civ: crest, people, standing bar (-100..+100), ethic summary, oath, open demands with their deadlines, last caravan and the next one expected.

### 8.6 Peek card, context ring, overlays

```
CONTEXT RING (long-press)                 OVERLAY PICKER (row over the map)        LEGEND STRIP (above the bar)
          [Mine]                          +--------------------------------+      +--------------------------------+
   [Chop]        [Build here]             |[Heat][Air][Light][Water][Rooms]|      | Air: [clean][smoky][foul][gas] |
          ( @ )                           |[Beauty][Danger]          [Off] |      |  worst on -2: smoke 172 (forge)|
   [Store]       [Move here]              +--------------------------------+      +--------------------------------+
          [Cancel]
  6 buttons of 56 pt on a 110 pt radius; game paused
```

- **Peek card wording.** It reads "Idle: no Builder work" (the role is named), not "Idle: no role work".
- **Peek card lines.** Pumps, wells and floodgates gain the lines from the backlog (11).
- **New peek card content.** Air cells show their values, and a world beast shows its history.

### 8.7 Menu and Settings

```
MENU (sheet, medium)                     SETTINGS (large, grouped, real switches)
+--------------------------------+       +--------------------------------+
| [disk] Save now        12:04   |       | Settings [Display][Play][Sound]|
| [box]  Back up to a file       |       | Display                        |
| [list] Holds and ruins         |       |  Text size      [100][115][130]|
| [gear] Settings                |       |  Reduce motion             (o )|
| [?]    Help                    |       |  Battery saver             ( o)|
| [door] Quit to title           |       |  Colour-blind marks        (o )|
+--------------------------------+       | Play                           |
                                         |  Births              ( o)      |
                                         |  Justice             ( o)      |
                                         |  Storm letters       ( o)      |
                                         | Storage . Accessibility  ...   |
                                         +--------------------------------+
```

- **Switches** are drawn as pixel-art switches with 44 x 28 pt hit areas inside 44 pt rows.
- **Groups:** Display, Play, Sound, Storage, Accessibility. A jump strip at the top scrolls to each group.
- **Nothing is dropped.** "Move to the app" (Home Screen install, R2 11.5) and storage info move to Settings / Storage; Letters move to World; Help stays in the Menu and behind every "?".

### 8.8 Onboarding

- **Coach.** 6 steps: chop, stockpile, bed, food, dig down, defend. Each step has a "Show me" that arms the tool. The card sits at the top in portrait, below the bar, at no more than 20 % of the height. It can be folded to a "2/6" chip.
- **Hints by need.** One-line toasts with a "Show me" button, each shown once per hold and listed under Help / Hints:

| Trigger | Hint |
|---|---|
| first night | "Keep the Hearth fed: the Hollow comes at night" |
| first cavern | "Wall off or watch the cavern: things live down there" |
| first flood | "Close a door or a floodgate to stop the water" |
| first visitor | "Visitors carry news of the world: see World / Letters" |
| first forecast front | "A front is coming: bring the harvest in, stock the fires" |
| first foul or smoky air | "Build a chimney or a vent shaft" |
| first mixed-people clash | "Peoples keep different customs: see People / their values" |
| first envoy demand | "A demand has a deadline: see World / Peoples" |

- **Embark onboarding.** The first world map shows a 3-step overlay: pinch to look around, tap a region, then Find for a site. Quick start skips it.
- **Migrated holds** get a 3-card "What is new" deck: the world around your hold, the new menus, and weather fronts and air.

### 8.9 Visual style

- **Tokens.** The existing CSS tokens stay (`ae86569`). New tokens:
  - `--sheet-w-land: 48vw`;
  - `--detent-mid: 50vh`;
  - four overlay legend ramps, safe for colour-blind players (blue-orange, purple-green).
- **Panels.** 9-slice baked pixel frames (7.2 item 2) replace the CSS-drawn borders on sheets, letters and the title buttons. Two kinds: stone (menus) and banded wood (letters, the Annals).
- **Icons.** One-bit, 16 x 16, drawn at 2x or 3x with integer scaling only.
- **Type.** The existing faces are kept, at a minimum of 14 px. Faint italic grey text is removed (the contrast audit, 11).

### 8.10 Accessibility and strings

- `aria-live="polite"` on toasts, alerts and letters.
- `role="dialog"`, `aria-modal`, a focus trap and Escape-to-close on sheets.
- **Canvas selection.** Selecting on the canvas announces the peek card text through a hidden live region.
- **Contrast.** Every text token reaches 4.5:1 on its panel.
- **Section view.** Its controls are 44 pt.
- **`t(key)`** (`js/ui/strings.js`, table `js/ui/strings-en.js`): keys are dotted ids (`hud.clock.day`). Plural rules use `Intl.PluralRules`. No layout depends on English length.

---

## 9. Saves and migration

### 9.1 State v5 (what is new in the save)

| Where | Field | Size | Notes |
|---|---|---|---|
| ENTITIES JSON | `realm` | 0.3-16 KB | `null` for a hold with no world (legacy until W3.6 migrates it) |
| `realm.v`, `wid`, `seed`, `gv`, `params` | world identity | about 100 B | `wid` = `hash32(seed, gv, size)` |
| `realm.rx`, `ry`, `civ`, `embarkYear`, `year`, `embark` | the hold's place, liege, years, and `opts.region` | about 600 B | `embark` lets a debug build regenerate the hold |
| `realm.prep` | preparation choices | about 120 B | 3.5 |
| `realm.bind` | role to civ id | about 60 B | G7 |
| `realm.stand` | `[[civ, goodwill, flags]]` | about 200 B | goodwill of the bound roles still lives in the faction records; `stand` holds the `c<n>` civs |
| `realm.sites`, `wars`, `dead`, `ev` | post-embark deltas | 1-14 KB, total cap 16 KB | 2.8 |
| `colony.world.weather` | v2 record | +40 B | 6.2 |
| RUNTIME | `air` | 3,840 B raw | 6.3 |

**Versions.** `STATE_VERSION` becomes 5. `EC3` stays at `formatVersion` 3. `fields.js` annotates the new fields. `realm.embark.relics` holds voxel indices, so it is annotated with the `tile` type (`fields-tile.test.mjs`).

### 9.2 The realm record (IndexedDB store `realm`, key `wid`)

```
'ECR\0' | u16 recVersion (1) | u32 wid | u16 size | u16 genVersion | u16 years | u8 compression (1 deflate-raw, 2 RLE)
        | u32[3] crc (fields, tables, events) | u32 byteLength | payload
payload = compress( FIELDS (15 layers x size^2 bytes, fixed order of 1.1) | u32 len + TABLES (UTF-8 JSON: civs, sites,
          figures, beasts, artifacts, wars; positional rows) | u32 len + EVENTS (12-byte rows) )
```

- **Size (Standard, 250 years):** fields 61 KB raw (about 15 KB deflated); tables about 70 KB raw (about 18 KB); events up to 72 KB raw (about 25 KB). In total **about 40-60 KB deflated** (Small about 25 KB, Large about 90 KB). W2.2 and W3.1 measure these and write the numbers here.
- **When it is written.** At world creation the record is read back and CRC-checked before the world is listed.
- **Where copies live.** The store; **embedded in every dawn backup and every export** after the pristine block (EC3 `flags` bit 1: REALM embedded). The rotating slots `a` and `b` reference it by `wid` and its CRCs, like the pristine world.
- **Fallback order:** the store, then the dawn blob's embedded copy, then regeneration with the current generator, accepted only if all 3 CRCs match. If none works, the hold **still loads**. The World tab then says "This hold's world record is missing. Import a backup file to restore it." The sim continues with `realm` deltas only:
  - caravans and raids fall back to the legacy faction rows;
  - letters say "word from the wider world is lost".
  So a missing realm record never refuses a hold. This differs from the pristine world, which is required.
- **Deletion.** A world is deleted from the Worlds screen only when no hold or ruin references it, or with a confirmation that lists the holds that will lose their world record.
- **World index.** A small mutable row per world in the existing `meta` store, key `world:<wid>`: name, size, year and the holds founded in it (`[slot, rx, ry]`). It drives the Worlds list (3.1) and the used regions (3.2), and is rebuilt from the slots' `realm` fields if it is lost. The record itself is never rewritten except by W3.7.
- **Database.** IndexedDB goes from version 2 to 3 (`DB_VERSION` in `idb.js`), with an `onupgradeneeded` that only adds the store.

### 9.3 Load (amends R3 5.2)

1. Read the header and pristine as today (R3 5.2 steps 1-4).
2. Parse the entities. If `realm` is set, get the realm record by the fallback order above.
3. Run the migrations to v5 (9.4).
4. Apply world amendments (R3 5.6), including amendment 1, which adds gas pockets to never-seen chunks of older holds.
5. `initRuntime(s)` rebuilds the caches. `rt.realm` holds the decoded record. It is class **"input"** in C13: immutable, read by the sim, never written, and identical on every load by CRC.

### 9.4 Migration v4 to v5 (`js/game/core/migrate5.js`, owner A with L; review B and K)

There are two parts. W2 ships part 1 alone. Part 2 ships in W3.6.

**Part 1 (W2): shape only.**
1. `realm = null`.
2. The weather record goes v1 to v2 (6.2), with its current kind kept and calm scalars.
3. `air` is all zeros.

**Part 2 (W3.6): a world around the old hold.** It runs on first load after W3 for any hold with `realm === null`, behind a chunked "Charting the wider world" progress screen (no frame > 50 ms), and it is a pure function of the save:
1. **Parameters.** `worldSeed = hash32(s.seed, 'realm')`, Standard size, 250 years, Normal sliders. World name from the names grammar.
2. **The pin.** The hold's profile is read from the pristine meta and layers:
   - massif side (from `baseMask` or the stored generation info);
   - river present, lake present, aquifer share;
   - biome `greenvale`, or the hold's `start.map.biome` if it is set.
   `createRealm(params, { pin: profile })` adds one rule after step 8. It picks the best-scoring embarkable temperate, moist lowland or upland region within 12 regions of the centre whose neighbours put the highest ground on the hold's massif side. The region is then **forced** to the profile: biome, river in and out, lake. History treats the pinned region as **settled and empty**, so it never places a site there, and it guarantees at least one human civ within 8 regions.
3. **Store.** The record is written to the `realm` store and embedded in the next dawn backup.
4. **Bind the roles.**
   - `hearthwatch` goes to the nearest human `realm` civ (the liege);
   - `league` to the nearest civ of kind `league`;
   - `gutterkin` to a `band`;
   - `ashfang` to the nearest civ of kind `clans` with `rel < 0`;
   - `pilgrims` to `pilgrims`.
   Existing goodwill values are kept as they are. A bound civ's `rel` to the hold is set from that goodwill.
5. **Years.** `embarkYear` = history years. `year` = `embarkYear` + the hold's game years.
6. **The vale pre-history** is re-dated into world years (2.1). Its figures keep their `p<n>` keys.
7. **Climate.** `embark.climate` = the greenvale row, which is identical to today's table. `embark` gets the rest of `regionOpts` for display only. The hold's local map, the pristine world, entities and stocks are **not touched**.
8. **Annals and coach.** An Annals line "Year N: the hold learned of the wider world". The "What is new" deck is queued.

**Peoples on old holds (W4.8).** When `PEOPLES2` turns on, existing colonists get the new needs of their people (Thornwake `sky`) **full**, and the new comfort bands and thoughts start from the next dawn, with a "What is new" card naming the change per people. W4.8's oracle checks that no colonist on the W0 fixtures breaks within 10 game days from a new-people thought alone.

**Checks** (`tools/tests/migrate5.test.mjs`) on the W0 fixtures (`v4-z3-day120`, `v4-z3-flood`, `v4-z3-beast`) and on the R3 fixtures already migrated to v4:
- **Local state untouched.** Every L layer, the pristine CRCs and every entity are byte-identical before and after.
- **The pinned region fits.** It is embarkable and greenvale, its river flag equals the hold's, and its massif side equals the hold's.
- **Roles bound.** The 5 roles are bound and goodwill is unchanged.
- **Determinism.** Load, migrate, continue 2 game days, save, reload and continue gives an identical hash.
- **Mood.** No colonist's mood moves by more than 5 within one game hour from the migration alone, compared against the same hour on the W0 build (sidecar).
- **Bot.** `colonybot --fixture=v4-z3-day120 --days=60` stays within 10 % of the W0 report on survival and idle share.

**What it does not promise.** It does not continue tick-identically across the upgrade: realm-driven caravans and raids change the timeline. It is deterministic from the migrated state on, which is the same promise as R3 5.4.

### 9.5 Export and import

- **Export.** It writes the pristine block plus the realm block. A file is self-sufficient: importing it on a fresh device restores the world record into the store if it is missing.
- **Import.** It accepts v4 and v5 `EC3`, plus `EC2` through the existing chain. A v4 import migrates as in 9.4.
- **Old builds.** A v5 file opened on an older build is refused by `stateVersion` with "Made by a newer version of the game".

---

## 10. Performance budgets (new rows; R3 6 stands)

| Item | Budget (A15) | Desktop gate | Notes |
|---|---|---|---|
| World creation, Standard | <= 0.5 s total, chunked (no frame > 50 ms) | < 150 ms | Large <= 1.2 s; A13 x1.3 allowed |
| World map frame (pan and zoom) | <= 4 ms p95 at 60 fps | < 1.5 ms | the atlas is baked once (about 20 ms); layer switch rebake < 30 ms |
| World map memory | <= 6 MB (atlas 1 MB, one layer canvas 1 MB, fields 0.1 MB, history tables about 2 MB) | | released when the screen closes |
| Region surface preview | <= 15 ms each, LRU 4 | < 6 ms | |
| Site finder scoring | < 1 ms per change | < 0.3 ms | |
| Founding (`mapgen3` with region) | <= 250 ms | < 100 ms | R3 6.5 |
| Realm record load (inflate and decode) | <= 15 ms | < 5 ms | |
| Season tick | <= 5 ms, one tick | < 2 ms | runs at season start only |
| Air step | <= 0.05 ms per 20 ticks | < 0.02 ms | |
| Climate step | <= 0.01 ms per tick on average | | |
| Atmosphere render | <= 1.5 ms p95 worst weather | 0.6 ms | inside the 8 ms render p95 |
| Portrait cache | 32 x 32 per colonist, <= 1 MB at 40 colonists | | |
| Save, mid-game | +1-16 KB realm deltas + about 1 KB air | | slot blob still under 100 KB mid-game, under 150 KB at day 300 |
| Dawn backup and export | +40-60 KB (the realm record) | | 170-210 KB, inside R2's 270 KB |
| Sim per frame at 3x | <= 4 ms (unchanged) | tick p95 < 1.2 ms | with peoples, climate and air on |
| UI sheet open | <= 1 frame to the first paint of the medium detent | | lists of more than 60 rows are virtualised |

**Battery.**
- The world map draws only on input or during the drift of cloud shadows. It stops at 10 fps when still and stops entirely under Battery saver.
- The generation animation runs at 30 fps.
- The R2 12.4 throttle is unchanged in play.

---

## 11. Left-over polish

Sources: `ui.md` 3 and 5, and R3 8.6. Each item has a stage.

| # | Item | Stage |
|---|---|---|
| 1 | **Full gate run on HEAD.** Several "WIP ... untested snapshot" commits exist (20fc8fb, fafaaa9, 80e7211). | W0 |
| 2 | **Raising bridge cannot be built.** The `liftbridge` flag and all mechanism code exist (`fluids.js`, `mechanisms.js`, `schema.js`), but no structure row carries it. Add the row (Mechanisms research), its art and a peek-card line. | W0 |
| 3 | **Stock chip shows 0 for stocked materials.** `stockRows()` in `js/ui/shell.js` reads stale ids (`wood`, `stone`, `block`, `ingot`). It should read totals by material category, matching Hold / Stock. | W0 |
| 4 | **Wording.** "D1" becomes "Day 1"; letters use the same level names as the HUD ("Surface", "-3 Shale", never "Level +5"); "Idle: no Builder work"; "Clear 10 C" becomes "Clear, 10 C". | W0 |
| 5 | **Speed button shows its state.** | W0 |
| 6 | **Section view.** Hide it until two levels are explored; replace "N-S" and "Row 61, west to east" with "Turn" and a compass word; 44 pt close button. | W0 |
| 7 | **Sylvari renamed Thornwake** (display only). | W0 |
| 8 | **Bot v4.** Rows for artifacts, the winch, petitions and halls; v3 haul latency; tick p95 spikes. | W0 |
| 9 | **Build cards.** Long names wrap and descriptions crowd the grid (one-line names). | W1 |
| 10 | **Landscape.** Sheets clip; the peek card is a full-height column (8.4). | W1 |
| 11 | **Colony sheet.** 8 tabs clip; People and Work duplicate each other; Hold opens stacked sheets (8.1). | W1 |
| 12 | **Settings** has no switch affordance; **Menu** mixes play and storage (8.7). | W1 |
| 13 | **Coach.** 15 steps cover a third of the map; migrated holds see the wrong coach (8.8). | W1 |
| 14 | **Accessibility, part 1.** aria-live, dialogs, focus trap, contrast. | W1 |
| 15 | **Fluids polish.** Pump facing arrow while placing; pump and well peek-card lines; flood and ember alerts name the level and the source. | W1 |
| 16 | **Elderwood start biome.** It becomes a world biome (1.3). | W2 |
| 17 | **Swimming and drowning** (R3 Z4). | W4 |
| 18 | **Mine-cart tracks with ramps** (R3 Z4). | W6 |
| 19 | **The Small hold**, 96 x 96 x 16, offered on the region card as "Small hold" (R3 Z4; `D` is already a header field). | W7 |
| 20 | **Bridges wider than the span rule** (R3 Z4). | W7 |
| 21 | **Second cavern art pass** (R3 Z4; 7.2 item 12). | W7 |
| 22 | **Audio themes by season** (R3 Z4; 6.6). | W5 |
| 23 | **Translations groundwork.** Convert the remaining UI to `t()`. | W7 |
| 24 | **Accessibility, part 2.** VoiceOver labels on canvas selection; the 44 pt audit of every control. | W7 |
| 25 | **Device tuning pass.** iPhone 13 and iPhone 11, Safari and the Home Screen. | W7 |
| 26 | **Level menu.** The narrow drop-down with faint italic text and its buttons far from the list becomes a sheet list with the band names and 44 pt rows (`ui.md` 2). | W1 |
| 27 | **Omen and storm letters** open at the medium detent with the camera turned toward the edge the threat comes from; the colonist rail is never hidden by the threat chip (it collapses to "+N"); the season stays a word on omen days. | W1 |
| 28 | **Research and Stock** show their cards above the fold (the paragraph goes behind "?"). | W1 |

---

## 12. Build plan

### 12.1 Ground rules (amend R3 8.1)

- **Steps are agent tasks**, as in R3 8.1. Each step lists:
  - **Owns:** the only files it writes;
  - **Depends:** the steps that must be merged first;
  - **Builds:** the deliverable;
  - **Test:** the command that must pass, plus the gate;
  - **Oracle:** what defines "correct";
  - **Size:** S, M or L.

  The workstreams are A-K (R2 14.2) plus **L, the realm** (G30).
- **Gate stages.** `tools/gate.mjs` `STAGES` gains `w0` ... `w7` after `z3`. A stage ships to players when `node tools/gate.mjs --stage=wN` is green. Every step merges to `main` only with the gate of its stage green.
- **Dark merges.** Module flags in `js/game/core/flags.js` (owner A) are module constants, never sim state: `SHELL2`, `REALM`, `HISTORY`, `PEOPLES2`, `CLIMATE2` and `AIR`. Each stays `false` until its stage's last step. Debug URLs (`?realm=1`, `?peoples=1`, `?climate=1`) turn a flag on for tests and the bench only.
- **New files and flags.** Every path in this plan was checked against `aebe07c`; a path marked (new) does not exist yet. A test file, a gate stage or a tool flag (`--flows=`, `--scene=`, `--realm=`) named in a Test column that does not exist yet is written by that step and is part of its Owns.
- **The legacy-hash rule.** Until a step declares a **re-baseline**, the bot seeds 1-5 on realm-less holds (and the 3 W0 fixtures continued 2 days) give hashes **identical** to the W0 baseline at every checkpoint. The W0 baseline is the one the W0 gate writes **after** W0.5 (`tools/out/baseline-w0.json`), because W0.5 changes hauling. Only these steps re-baseline: W4.8 (the peoples flag), W5.1 (fronts) and W5.9 (air). Each re-baseline records the new hashes in `tools/out/baseline-wN.json`.
- **Single writers are unchanged:** `commands.js` and `schema.js` (A), `balance.js` (G), `css/style.css` (I). New ones: `js/data/realm/*` (G) and `js/game/realm/*` (L). A step that needs a change in a file it does not own lists it as a request; the writer lands it as an S step the same day.
- **`sw.js`** is still only written by `node tools/check-sw.mjs --write` (R3 8.1).
- **Parallel work.** Each stage below lists steps that can run at the same time on disjoint files.

### 12.2 Stage W0: baseline and the cheap polish

**Playable result:** today's game with its known bugs fixed. The stock chip is right, the clock says "Day 3", the speed button shows its state, the raising bridge can be built, the Thornwake name is in, the section view is calmer, and the bot covers the newest systems.

| Step | Owns | Depends | Builds | Test | Oracle | Size |
|---|---|---|---|---|---|---|
| **W0.1 Gate on HEAD and fixtures** (J) | `tools/gate.mjs` (stage `w0`); `tools/fixtures/v4-z3-day120.ecsave`, `v4-z3-flood.ecsave`, `v4-z3-beast.ecsave` and `.json` sidecars; `tools/tests/fixtures-v4.test.mjs` | - | a full `--stage=z3` run on HEAD, each failure landed by its owner before W0 closes; three fixtures via `capture-fixture.mjs` (bot seed 3 at day 120, a flood in progress, a great beast loose); the W0 bot report `tools/out/w0.json` (survival, rank days, idle share, haul latency, tick p95) | `node tools/gate.mjs --stage=z3 && node --test tools/tests/fixtures-v4.test.mjs` | the sidecar hashes, produced by HEAD itself | M |
| **W0.2 HUD wording, stock chip, speed state, section view** (I; G text) | `js/ui/shell.js`, `speed.js`, `section.js`, `levels.js`, `threatui.js`, `alerts.js`, `peek.js` (wording only); G `js/data/text/letters.js` | W0.1 | section 11 items 3-6 | `node --test tools/tests/stock-chip.test.mjs tools/tests/level-words.test.mjs && node tools/ui-phone.mjs` | on all 3 fixtures `stockRows()` totals equal Hold / Stock; every letter, alert and peek line on the fixtures names levels as the HUD does ("Surface", "-3 Shale"; the "Level +5" strings come from `threatui.js` `levelText`); 44 pt and 14 px (R2 10) | S |
| **W0.3 The raising bridge** (G; D art; I peek line) | `js/data/structures/utility.js`; D `js/engine/art/kit2.js`; I `js/ui/peek.js` (after W0.2) | W0.1 (parallel with W0.2 except `peek.js`) | a structure row with the `liftbridge` flag (Mechanisms research), its art in both states, a peek line | `node tools/validate-data.mjs && node --test tools/tests/mechanisms.test.mjs` | R3 2.8: a lever raises it, the channel is sealed, fluid stops at it in a unit scene | S |
| **W0.4 Thornwake** (G) | `js/data/ancestries.js` (`name`, `text` only) and the `js/data/text/*` rows that say "Sylvari" | - | G14 | `node tools/validate-data.mjs` | `grep -rni sylvari js/data/text js/ui` finds only ids; legacy hashes identical | S |
| **W0.5 Bot v4 rows and the tick spikes** (J; E haul) | `tools/colonybot.mjs` and its policy modules; E `js/game/work/haul.js` | W0.1 | bot rows for artifacts, the winch, petitions and halls; the haul latency fix; the tick p95 spike cause found and fixed | `node tools/colonybot.mjs --stage=z3 --bot=v4 --seeds=1-5 --days=120` | median haul latency >= 15 % lower than `w0.json`; tick p95 < 1.2 ms desktop on the Z3 stress scene; survival within 5 %; E's change re-baselines the D=20 hashes once (recorded). Time box: if the spike's cause is not found in the step, W0 ships with a bench report and the fix becomes a W1 step | M |

**Stage W0 gate:** `--stage=w0` = z3 plus the W0 tests. It deploys as v0.4.3.

### 12.3 Stage W1: the new shell

**Playable result:** the same game in the new UI: the 5-slot bar with a speed state; People, Hold and World sheets with detents and no stacking; landscape sheets at half the width; the new Menu and Settings with real switches; compact build cards; the 6-step coach with hints; pixel-art particles and 9-slice panels.

**Parallel:** W1.3a with W1.4 with W1.5 with W1.8.

| Step | Owns | Depends | Builds | Test | Oracle | Size |
|---|---|---|---|---|---|---|
| **W1.1 Strings layer** (I) | `js/ui/strings.js`, `js/ui/strings-en.js`, `tools/check-strings.mjs` (new) | W0 | `t(key, vars)`, plural rules, a lint that every `t('...')` key exists and every key is used | `node tools/check-strings.mjs && node --test tools/tests/strings.test.mjs` | 0 missing keys; `Intl.PluralRules` agrees on the English rows | S |
| **W1.2 Sheet engine** (I; C request W1.2a: `camera.js` `setInset(side, px)`) | `js/ui/sheet.js`, `layout.js`, `css/style.css` | W1.1 | detents, breadcrumb push and pop, one sheet at a time, landscape 48vw full height, "?" paragraphs, safe areas on all sides | `node tools/ui-phone.mjs --flows=sheets` | flows "medium detent shows the selected colonist", "Hold / Offices / back without a second sheet", "landscape sheet keeps the selection visible"; 44 pt, 14 px, 130 % text at the six R2 viewports plus landscape-left and -right | M |
| **W1.3a The bar, Mark and People** (I) | `js/ui/toolbar.js`, `shell.js`, `colonyui.js` (People, Work, Schedule and Military tabs move out), `peopleui.js` (new), `rolesui.js`, `military.js`, `zonesui.js` | W1.2 | the 5-slot bar; Mark = Orders + Zones; the People roster with List, Grid and Schedule views (8.1); the colonist rail collapses to "+N" (11 item 27) | `node tools/ui-phone.mjs --flows=ia-people` | the work grid, a colonist's skills and the Military alert each <= 2 taps from the map; the old long-press shortcuts still work | M |
| **W1.3b Hold and World sheets** (I) | `js/ui/colonyui.js` (removed at the end), `holdui.js`, `worldui.js` (new), `annals.js`, `officesui.js`, `justiceui.js` | W1.3a | Hold (Overview, Stock, Research, Offices and Justice, Halls); World with Annals, Letters, factions and the dead (no map until W2); Research and Stock cards above the fold (11 item 28) | `node tools/ui-phone.mjs --flows=ia` | Annals, Offices, Stock and Letters each <= 2 taps from the map; a list of the 31 screens of today checked reachable; no stacked sheet | M |
| **W1.4 Cards, peek, capsule, Menu, Settings** (I; A request W1.4a: move Settings and Storage UI out of `js/main.js`) | `js/ui/architect.js`, `cards.js`, `peek.js`, `levels.js`, `js/ui/menu.js` and `js/ui/settingsui.js` (both new; the Menu and Settings code lives in `js/main.js` today) | W1.2 | one-line build cards with a cost line; the peek chevron and wording; the compact landscape peek; the level pill; the grouped Menu and switches (8.7); the level menu redone (11 item 26) | `node tools/ui-phone.mjs --flows=cards,settings` | 8 build cards visible in the portrait medium detent (today 6); no wrapped card name at 130 %; every switch toggles in one tap | M |
| **W1.5 Visual kit** (D; I icons) | D `js/engine/art/ui.js` (new: 9-slice bake to a data URL for `border-image`, the icon sheet); I `js/ui/icons.js`, `frame.js` | W0 | 7.2 item 2 | `node tools/render-check.mjs --scene=art` | contact sheet 0 errors; frames scale by integers only | M |
| **W1.6 Front end** (I; D title) | `js/ui/colonies.js` renamed `front.js`; D `js/engine/art/title.js` | W1.2, W1.5 | the 8.3 title (Continue hidden on first run; Worlds hidden while `REALM` is off), Holds and ruins | `node tools/ui-phone.mjs --flows=front` | cold start to the map in 2 taps | M |
| **W1.7 Onboarding** (I) | `js/ui/guide.js`, `intros.js`, `js/data/text/help.js` (granted by G) | W1.3b | 8.8: 6 steps with "Show me", the hints by need, the "What is new" deck for older holds | `node tools/ui-phone.mjs --flows=coach` | completable with "Show me" only; coach card <= 20 % of portrait height | M |
| **W1.8 Pixel FX and particles** (C; D frames) | `js/engine/particles.js`; D `js/engine/art/fx.js` (new) | W0 | 7.2 item 1 | `node tools/render-check.mjs && node tools/bench.mjs --scene=particles` | `grep -n "arc(\|fillText" js/engine/particles.js` empty; draw time <= W0 at 900 particles; 0 allocations per frame | M |
| **W1.9 Accessibility, part 1** (I) | `js/ui/alerts.js`, `letters.js`, `js/ui/a11y.js` (new) | W1.3b, W1.4 | 8.10 without the VoiceOver canvas labels; omen and storm letters at the medium detent facing the threat's edge (11 item 27) | `node tools/ui-phone.mjs --a11y` | every sheet `role=dialog` with a focus trap; toasts live; every text token >= 4.5:1 (computed) | S |
| **W1.10 Gate w1** (J; A flips `SHELL2`) | `tools/ui-phone.mjs`, `ui-flows.mjs`, `gate.mjs`; A `flags.js` | W1.1-W1.9 | the flows in the gate; the switch | `node tools/gate.mjs --stage=w1` | legacy hashes identical (the shell changes no sim); R2 10 budgets; flows green at 8 viewports | M |

### 12.4 Stage W2: the world map and embark

**Playable result:** create a world (12 biomes, rivers, lakes, rock provinces, taint); browse it with layers, pinch and pan; find a site; read a region card with the real surface preview and 3 x 3 neighbours; choose a start and **Found now** to found a hold in that region, with its climate, river, stones and ores.

The world has no history yet ("an unsettled world"), so factions are the legacy rows. Old holds are untouched (`realm = null`).

**Parallel:** W2.3 with W2.5; W3.1a can start once W2.1 is merged.

**W2.1 Realm fields** (L; G data; J lint) - Size L
- **Owns:** `js/game/realm/gen.js`, `fields.js`, `rivers.js`, `biomes.js`, `query.js`; G: `js/data/realm/biomes.js`, `params.js`; J: `tools/check-mapgen.mjs` (realm paths), `tools/check-realm.mjs` (new); `tools/tests/realm-gen.test.mjs`.
- **Depends:** W0.
- **Builds:** 1.1-1.5, steps 1-8 and 11 (history and roads are W3).
- **Test:** `node --test tools/tests/realm-gen.test.mjs && node tools/check-mapgen.mjs && node tools/check-realm.mjs --browser=chromium`.
- **Oracle:**
  - priority-flood equals a brute-force depression fill on 200 random 16 x 16 grids;
  - elevation never rises along any river; every river ends in sea or lake;
  - 200 seeds pass the guarantees with 0 accepted warnings;
  - realm hash equal in Node and Chromium (and WebKit where installed) for 3 fixture seeds;
  - fields < 60 ms desktop at 64².

**W2.2 Realm record and store** (A; L format) - Size M
- **Owns:** `js/game/save/realmstore.js` (new), `idb.js` (version 3), `codec.js` (EC3 flags bit 1), `slots.js`, `backups.js`; L: `js/game/realm/record.js`.
- **Depends:** W2.1.
- **Builds:** 9.2.
- **Test:** `node --test tools/tests/realm-store.test.mjs && node tools/persist.mjs`.
- **Oracle:**
  - the record round-trips byte-identical;
  - a deleted store record is recovered from the dawn blob;
  - a corrupted CRC goes down the fallback order;
  - a missing record still loads the hold (9.2);
  - the measured size is written into 9.2.

**W2.3 Region inputs to `mapgen3`** (B; L request W2.3a lands `region.js`) - Size L
- **Owns:** `js/game/world/mapgen3.js`, `js/data/worldgen.js` (`GEN3.version` 2, knob rows; B owns this file); L: `js/game/realm/region.js`.
- **Depends:** W2.1.
- **Builds:** 3.6 and `previewSurface()` (3.7); `G.sides` gains `s`.
- **Test:** `node --test tools/tests/mapgen3-region.test.mjs && node tools/check-mapgen.mjs`.
- **Oracle:**
  - with no `opts.region`, seeds 1-5 give world hashes identical to W0 (v1 path);
  - 12 biomes x 20 seeds pass `checkGuarantees`;
  - each biome's knob values of 1.3 measured within ±20 %;
  - a river region's water enters on `river.in` and leaves on `river.out`;
  - `previewSurface` equals the surface of `generate3` at plane zS, tile by tile.

**W2.4 Regional climate** (B) - Size M
- **Owns:** `js/game/world/weather.js`, `temperature.js`, `plants.js`; `js/data/worldgen.js` `WORLD.weather` (B).
- **Depends:** W2.3.
- **Builds:** the climate part of 6.2 (mean, amplitude, season curve, growing season). The front record waits for W5.
- **Test:** `node --test tools/tests/climate.test.mjs`.
- **Oracle:**
  - the greenvale row gives today's outdoor temperature for every hour of a year, exactly, so legacy hashes are identical;
  - a tundra region's growing season is 15 days ±1.

**W2.5 Atlas render and biome art** (C; D) - Size M
- **Owns:** `js/engine/render/atlas.js` (new); D: `js/engine/art/atlas.js` (new), `ground.js` (biome ground sets), `palette.js` (at most +3 colours, with the `ART-STYLE.md` update).
- **Depends:** W2.1.
- **Builds:** 7.2 items 3 and 4.
- **Test:** `node tools/render-check.mjs --scene=atlas,biomes`.
- **Oracle:** the 10 budget rows for the world map; the contact sheet shows 0 errors and every biome ground set.

**W2.6 World map component** (I) - Size M
- **Owns:** `js/ui/worldmap.js` (new).
- **Depends:** W2.5.
- **Builds:** pan, pinch with snapping, layer chips with legends, the loupe and the selection frame; read-only mode for the World tab.
- **Test:** `node tools/ui-phone.mjs --flows=worldmap`.
- **Oracle:** an 8x region cell is >= 44 pt; a tap at fit zoom shows the loupe; a 4x tap selects directly; the frame time is within budget.

**W2.7a Worlds, Create world, generation, Quick start** (I) - Size M. "W2.7" below means both halves.
- **Owns:** `js/ui/embark.js` (new), `front.js`.
- **Depends:** W2.2, W2.6, W1.6.
- **Builds:** 3.1 up to the map: the Worlds list (from the world index, 9.2), the Create world sheet, the animated generation with Cancel, the Start segment of the band sheet, Found now and the Quick start card.
- **Test:** `node tools/ui-phone.mjs --flows=worlds`.
- **Oracle:** Quick start reaches the map of a new hold in 2 taps; Cancel leaves no stored record; no generation frame is longer than 50 ms (frame log).

**W2.7b Region card and site finder** (I; L finder) - Size M
- **Owns:** `js/ui/regioncard.js`, `finderui.js` (new); L: `js/game/realm/finder.js` (new).
- **Depends:** W2.7a, W2.3 (`previewSurface`).
- **Builds:** 3.2-3.4 and 3.7: the region card with the preview and 3 x 3, the reach rule, the finder.
- **Test:** `node tools/ui-phone.mjs --flows=embark && node --test tools/tests/finder.test.mjs`.
- **Oracle:** the full flow in at most 9 taps; finder scoring matches a brute-force filter on 3 worlds; the card's facts match `regionFacts()` on 20 regions.

**W2.8 Founding with a region; state v5 part 1** (A; B request) - Size M
- **Owns:** `js/game/core/setup.js`, `schema.js` (`realm` field, `STATE_VERSION` 5), `state.js` (`migrations[3]`), `migrate5.js` (new, part 1), `js/ui/app.js`, `js/main.js`.
- **Depends:** W2.2, W2.3, W2.4.
- **Builds:**
  - `foundColony({ realm, rx, ry, start })`: the hold seed (G2), `opts.region` and `s.realm`;
  - 9.1 and 9.4 part 1.
- **Test:** `node --test tools/tests/found-realm.test.mjs tools/tests/migrate5.test.mjs && node tools/determinism.mjs --seeds=1-5`.
- **Oracle:**
  - founding the same region twice gives identical hashes;
  - the 3 W0 fixtures load through part 1 and continue identically;
  - save and reload of a realm hold continue identically.

**W2.9 Bot and gate w2** (J; A flips `REALM`) - Size M
- **Owns:** `tools/colonybot.mjs` (`--realm=<seed>:<rx>,<ry>`, `--biomes=all`), `tools/gate.mjs`; A: `flags.js`.
- **Depends:** W2.1-W2.8.
- **Builds:** gate rows: 12 biomes x 5 seeds x 60 days; the realm determinism scene.
- **Test:** `node tools/gate.mjs --stage=w2`.
- **Oracle:**
  - greenvale, elderwood, shore, fen and moor: survival within 10 % of W0;
  - harsh biomes (tundra, saltflat, ashlands, ruins, highcrag, redscar, taiga): survival >= 70 % of W0 at day 60;
  - a harsh biome below that gets a balance request to G, not a gate waiver.

### 12.5 Stage W3: world history and the living world

**Playable result:** every world has 250 years of history: civs, sites, wars, figures, beasts and artifacts, readable in the Annals and on the map; a hold has neighbours and a liege; caravans, raids, visitors and envoys come from real civs with real causes; relics and lairs come from history; the world changes each season, and its news arrives with travellers; **every old hold gets a world around it**.

**Parallel:** W3.3a with W3.4 with W3.5; W3.2 with W3.8.

**W3.1a Civs, sites, wars and roads** (L; G data) - Size M. "W3.1" below means both halves.
- **Owns:** `js/game/realm/history.js`, `civs.js`, `roads.js` (new); G: `js/data/realm/civkinds.js`, `ethics.js`, `events.js` (new); `tools/tests/realm-history.test.mjs`.
- **Depends:** W2.1. It can run during W2.3-W2.9.
- **Builds:** 2.1-2.4 and 2.3 steps 1-4, 7-9 (growth, contact, war, rulers, the Hollowing, plagues, pacts) and 1.2 step 10 (roads). Rulers are bare figure rows. The peoples are the 4 existing rows plus non-playable `civkind` rows; W4 adds peoples to worlds created after it.
- **Test:** `node --test tools/tests/realm-history.test.mjs && node tools/check-realm.mjs`.
- **Oracle:** on 100 seeds: no site is owned by a fallen civ; every razed site is a ruin; every war has `began <= ended`; caps hold; every road joins two friendly sites; < 60 ms desktop at 64² and 250 years; cross-browser hash equality.

**W3.1b Figures, deeds, beasts and artifacts** (L) - Size M
- **Owns:** `js/game/realm/figures.js`, `beasts.js` (new); `history.js` (the hooks for steps 5, 6 and 10).
- **Depends:** W3.1a.
- **Builds:** 2.3 steps 5, 6 and 10, and 2.5 (event first, cause after).
- **Test:** `node --test tools/tests/realm-history.test.mjs`.
- **Oracle:** on 100 seeds: every figure dies after birth and every deed falls inside its life; every deed's cause is true at its year (re-checked by replay); every artifact has one holder or one lost place; the whole history < 90 ms desktop at 64² and 250 years.

**W3.2 History text and the Annals' World section** (G text; I) - Size M
- **Owns:** G: `js/data/text/realm.js`; I: `js/ui/annals.js`, `js/ui/worldui.js`.
- **Depends:** W3.1b, W1.3b.
- **Builds:** 2.6 and the Annals World section (2.7, first row).
- **Test:** `node --test tools/tests/realm-text.test.mjs && node tools/ui-phone.mjs --flows=annals`.
- **Oracle:** every event of 3 seeds renders with no unfilled slot and no string over 160 characters; links open the right record; "Show on map" selects the site.

**W3.3a Roles bound to civs, caravans and trade** (K) - Size M. "W3.3" below means both halves.
- **Owns:** `js/game/colony/factions.js`, `caravans.js`, `trade.js`.
- **Depends:** W3.1, W2.8.
- **Builds:** G7, and the 2.7 rows for factions and caravans.
- **Test:** `node --test tools/tests/realm-colony.test.mjs && node tools/colonybot.mjs --realm=3:auto --seeds=1-5 --days=120`.
- **Oracle:** realm-less holds give hashes identical to W2; caravan arrivals match travel days ±1; goodwill of the bound roles behaves as the legacy rows did (same deltas for the same acts).

**W3.3b Visitors, envoys, nobles and the vale pre-history** (K) - Size M
- **Owns:** `js/game/colony/visitors.js`, `offices.js`, `legends.js`.
- **Depends:** W3.3a.
- **Builds:** the 2.7 rows for visitors, offices and the vale pre-history.
- **Test:** `node --test tools/tests/realm-colony.test.mjs tools/tests/legends.test.mjs`.
- **Oracle:** realm-less holds give hashes identical to W2; every visitor figure is alive in the realm on arrival; every re-dated vale event falls before `embarkYear`.

**W3.4 Raids from civs** (H) - Size M
- **Owns:** `js/game/threat/causes.js`, `raidplan.js`, `nemesis.js`, `raiders.js`.
- **Depends:** W3.1.
- **Builds:** the 2.7 raid row.
- **Test:** `node --test tools/tests/realm-raids.test.mjs`.
- **Oracle:**
  - every raid letter names a civ that is at war with the liege or has `rel < -40`;
  - >= 80 % of raids enter on the civ's side;
  - the storyteller's pacing report stays within 10 % of W2 (raids per 100 days).

**W3.5 Relics and lairs from history** (B; H) - Size M
- **Owns:** `js/game/world/mapgen3.js` (`relics`, `lairs`, `ruins` from sites); H: `js/game/threat/beasts/gen.js` (identity from the realm beast).
- **Depends:** W3.1, W2.3.
- **Builds:** the 2.7 rows for beasts and artifacts.
- **Test:** `node --test tools/tests/mapgen3-region.test.mjs tools/tests/realm-relics.test.mjs`.
- **Oracle:** a region whose history holds a lost artifact places it in a vault or ruin with its world key; a beast's peek card shows its history; with no region, the hashes are identical.

**W3.6 Old holds get a world (migration part 2)** (A; L `pin`) - Size M
- **Owns:** `js/game/core/migrate5.js`, `state.js`; L: `gen.js` (`pin`).
- **Depends:** W3.1, W3.3.
- **Builds:** 9.4 part 2.
- **Test:** `node --test tools/tests/migrate5.test.mjs`.
- **Oracle:** every check of 9.4.

**W3.7 History for W2-era worlds** (L; A) - Size S
- **Owns:** `js/game/realm/record.js` (`recVersion` path); A: `realmstore.js`.
- **Depends:** W3.1, W3.6.
- **Builds:** a stored record without history gets it: history runs over the stored fields with the regions of its embarked holds marked settled and empty. The record is re-written and the roles are bound as in 9.4 step 4.
- **Test:** `node --test tools/tests/realm-upgrade.test.mjs`.
- **Oracle:** a W2 fixture world gains history; its holds' regions hold no site; the holds' local states are byte-identical.

**W3.8 The season tick** (L; K for letters) - Size M
- **Owns:** `js/game/realm/tick.js`; K: `js/game/colony/news.js` (new; rumours delivered by caravans and visitors).
- **Depends:** W3.3.
- **Builds:** 2.8.
- **Test:** `node --test tools/tests/realm-tick.test.mjs && node tools/bench.mjs --scene=realmtick`.
- **Oracle:** < 2 ms desktop; deltas <= 16 KB after a 300-day soak; save at any tick then reload continues identically; no tick creates a threat directly (G6).

**W3.9 The World tab** (I) - Size M
- **Owns:** `js/ui/worldui.js`, `js/ui/worldmap.js` (pins, routes, wars), `js/ui/peoplesui.js` (new: civ cards).
- **Depends:** W3.2, W3.3.
- **Builds:** 8.5 World and the Peoples and factions cards.
- **Test:** `node tools/ui-phone.mjs --flows=world`.
- **Oracle:** the hold's pin, its liege and 6 neighbours are reachable in 2 taps.

**W3.10 Gate w3** (J; A flips `HISTORY`) - Size M
- **Owns:** `tools/gate.mjs`, `tools/colonybot.mjs`.
- **Depends:** W3.1-W3.9.
- **Builds:** a realm soak: 5 seeds x 120 days with history on; the migrated fixtures.
- **Test:** `node tools/gate.mjs --stage=w3`.
- **Oracle:** survival within 10 % of W2; save sizes within 10; tick p95 < 1.2 ms desktop.

### 12.6 Stage W4: peoples

**Playable result:** 10 peoples, 7 of them choosable at embark, each with a hard drawback: Murrow under low ceilings, Tarnfolk in pools and swimming, Wendrel herds under open sky, Kilnfolk eating coal beside the forge, Lamplost in the dark; portraits; the full band sheet (3.5); civ ethics with refusals, demands and oaths; new raiders, traders and visitors.

**Parallel:** W4.2 with W4.3 with W4.4.

**W4.1 Ancestry data** (G) - Size M
- **Owns:** `js/data/ancestries.js`, `needs.js`, `names.js`, `backstories.js`, `thoughts.js`, `traits.js`, `starts.js`, `js/data/schema.js`.
- **Depends:** W0.
- **Builds:** 4.1 and 4.3 data; P1 rows 2, 3, 6 and 7 of section 5. The new values on the 4 existing rows are read only when `PEOPLES2` is on.
- **Test:** `node tools/validate-data.mjs`.
- **Oracle:** with `PEOPLES2` off, legacy hashes are identical.

**W4.2 People mechanics** (F) - Size L
- **Owns:** `js/game/people/needs.js`, `needjobs.js`, `mood.js`, `health.js`, `colonists.js`, `personality.js`, `social.js`.
- **Depends:** W4.1.
- **Builds:** 4.2, except swimming.
- **Test:** `node --test tools/tests/peoples.test.mjs`.
- **Oracle:** one unit case per row of 4.2. Examples:
  - a Kilnfolk with coal and no meals does not starve for 10 days;
  - a Thornwake with no sky for 2 days has the -4 thought;
  - a Murrow in a 3 x 3 room has +3;
  - Greyborn thoughts are halved.

**W4.3 Swimming and drowning** (B) - Size M
- **Owns:** `js/game/systems/pathing.js` (A* cost classes and `followPath` step speed).
- **Depends:** W4.1.
- **Builds:** the swim rows of 4.2.
- **Test:** `node --test tools/tests/pathing3d.test.mjs tools/tests/swim.test.mjs`.
- **Oracle:** a brute-force Dijkstra with swim costs equals A* cost on 200 seeded pairs; walker paths are unchanged (hash); a non-swimmer in deep water takes damage after 30 game seconds.

**W4.4 Rig and portraits** (D; I thumbs) - Size L
- **Owns:** `js/engine/art/people.js`, `keys.js`, `portrait.js` (new); I: `js/ui/thumbs.js`.
- **Depends:** W4.1.
- **Builds:** 7.2 items 5 and 6.
- **Test:** `node tools/render-check.mjs --scene=art,people`.
- **Oracle:** 10 peoples x 4 looks on the contact sheet with 0 errors; portrait cache <= 1 MB at 40 colonists.

**W4.5 Ethics, refusals, demands and oaths** (K; G data) - Size M
- **Owns:** `js/game/colony/diplomacy.js` (new), `trade.js`; G: `js/data/realm/ethics.js` (demand rows).
- **Depends:** W3.3, W4.1.
- **Builds:** 4.4.
- **Test:** `node --test tools/tests/diplomacy.test.mjs`.
- **Oracle:**
  - an offending sale escalates through the three steps in order;
  - breaking an oath costs -30 and -10 everywhere;
  - a demand's deadline passes into a goodwill change exactly once.

**W4.6 The band sheet** (I; A setup) - Size M
- **Owns:** `js/ui/embark.js` (Liege, Party, Supplies), `js/ui/partyui.js` (new); A: `js/game/core/setup.js` (`prep`).
- **Depends:** W4.2, W4.4, W2.7.
- **Builds:** 3.5.
- **Test:** `node tools/ui-phone.mjs --flows=prepare && node --test tools/tests/prep.test.mjs`.
- **Oracle:** the same `prep` gives the same band (hash); the budget never goes negative; Reset restores the preset; in a world made before W4 (no civ of the new peoples), the new-people starts are listed as unavailable with the reason "No Murrow live in this world: create a new world to found as Murrow", and the new peoples still arrive there as migrants (G11).

**W4.7 Senders of the new civs** (G; H; D art) - Size M
- **Owns:** G: `js/data/raiders.js`, `traders.js`, `visitors.js`; H: `js/game/threat/raiders.js` (behaviours: netcaster stun from water); D: `js/engine/art/beings.js`.
- **Depends:** W4.1, W3.4.
- **Builds:** 4.5's raiders, traders and visitors.
- **Test:** `node tools/validate-data.mjs && node --test tools/tests/raiders.test.mjs`.
- **Oracle:** every new row has art and a cause (F26).

**W4.8 Bot and gate w4** (J; A flips `PEOPLES2`; re-baseline) - Size M
- **Owns:** `tools/colonybot.mjs` (coal diet, damp, sky, dormancy policies), `tools/gate.mjs`.
- **Depends:** W4.1-W4.7.
- **Builds:** gate rows: 8 starts x 5 seeds x 60 days, each in its best-fit biome.
- **Test:** `node tools/gate.mjs --stage=w4`.
- **Oracle:** each start survives 60 days in >= 4 of 5 seeds; mixed-band social fights <= 1 per 10 colonist-days; the 3 W0 fixtures continued 10 days under `PEOPLES2`: no break caused by a new-people thought alone (9.4, "Peoples on old holds").

### 12.7 Stage W5: atmosphere

**Playable result:** weather fronts you can see coming (fog, storms, blizzards, heat waves); wind that drives fire and smoke; snow that slows people and melts to mud; river surges after storms; an air sim with smoke, foul air and firedamp, with chimneys, vents and blasts; day colours, cloud shadows, puddles, snow cover, sway, critters, light shafts and lit windows; a soundscape and adaptive music; the Air, Heat and Light overlays.

**Parallel:** W5.1 with W5.3-W5.7 (the render work runs on a stub weather record until W5.1 lands); W5.2 after W5.1.

**W5.1 Fronts and climate effects** (B; re-baseline) - Size L
- **Owns:** `js/game/world/weather.js` (v2), `temperature.js`, `light.js`, `fire.js`, `plants.js`, `fluids.js` (surge), `js/game/systems/pathing.js` (snow speed in `followPath`).
- **Depends:** W2.4, W4.3 (both write `pathing.js`).
- **Builds:** 6.2.
- **Test:** `node --test tools/tests/climate.test.mjs tools/tests/fronts.test.mjs`.
- **Oracle:**
  - every front over 200 seeded years is forecast >= 12 hours ahead;
  - a v1 record migrates;
  - each effect row of 6.2 has a unit case;
  - pathing caches are untouched by snow (cache-drop test).

**W5.2 Air sim** (B; F effects request; G rows request; A RUNTIME request) - Size L
- **Owns:** `js/game/world/air.js` (new), `js/game/world/amend/index.js` (new: the R3 5.6 amendment runner, which does not exist yet; this is its first use), `js/game/world/amend/1.js` (new: gas pockets for old holds), `mapgen3.js` (gas rows); A request: call the runner in the load path before `initRuntime` (9.3 step 4) and write the pristine meta `amendments` list.
- **Depends:** W5.1, W0.
- **Builds:** 6.3.
- **Test:** `node --test tools/tests/air.test.mjs tools/tests/amend-idempotent.test.mjs tools/tests/cache-drop.test.mjs && node tools/bench.mjs --scene=air`.
- **Oracle:**
  - in a closed system the sum is constant within rounding;
  - a vented cell decays to 0 in the computed number of steps;
  - the blast rule's unit case passes;
  - the amendment is idempotent;
  - the step time is within 10.

**W5.3 Director and grade** (C; D palette) - Size M
- **Owns:** `js/engine/render/atmos.js` (new), `js/engine/render/light.js`; D: `palette.js`.
- **Depends:** W1.8.
- **Builds:** 6.4 and the 6.5 grade.
- **Test:** `node tools/render-check.mjs --scene=atmos-dawn,atmos-dusk`.
- **Oracle:** the grade changes only on light-texture rebuilds (count <= 8 per game day); 0 allocations.

**W5.4 Sky effects** (C; D frames) - Size L
- **Owns:** `js/engine/render/weather.js`; D: `js/engine/art/fx.js`.
- **Depends:** W5.3.
- **Builds:** the 6.5 rows for clouds, fog, rain, puddles, snow cover and lightning.
- **Test:** `node tools/render-check.mjs --scene=atmos`.
- **Oracle:** budget 6.8; the lightning cap is checked by the frame log; the 6.7 matrix rows are checked by toggling settings in the scene.

**W5.5 Life: sway, debris and critters** (C; D) - Size M
- **Owns:** `js/engine/render/critters.js` (new), `entities.js`; D: `js/engine/art/critters.js` (new).
- **Depends:** W5.3.
- **Builds:** 6.5 rows and 7.2 item 8.
- **Test:** `node tools/render-check.mjs --scene=atmos-life`.
- **Oracle:** <= 48 critters (12 under Battery saver); none drawn when still under Reduce motion.

**W5.6 Smoke, steam, breath, shafts, windows, aurora and glow** (C; D) - Size M
- **Owns:** `js/engine/render/fluids.js`, `levelview.js`, `js/engine/render/glow.js` (new); D: `js/engine/art/index.js` (`smokeAt` anchors beside today's `flameAt`).
- **Depends:** W5.3.
- **Builds:** the remaining 6.5 rows.
- **Test:** `node tools/render-check.mjs --scene=atmos-deep`.
- **Oracle:** budget 6.8.

**W5.7 Sound and music** (C) - Size M
- **Owns:** `js/engine/audio.js`, `js/engine/audio/ambience.js`.
- **Depends:** W5.3.
- **Builds:** 6.6 and the season themes (11 item 22).
- **Test:** `node --test tools/tests/audio-graph.test.mjs`.
- **Oracle:** no node leak after 100 bed changes; the Battery saver rule holds.

**W5.8 Forecast chip, overlays and legends** (I; C overlay render) - Size M
- **Owns:** `js/ui/overlays.js` (new), `js/ui/shell.js` (sky chip); C: `js/engine/render/overlays.js`.
- **Depends:** W5.1, W5.2.
- **Builds:** 8.6 overlays, the sky chip, and the air and storm letters (text G).
- **Test:** `node tools/ui-phone.mjs --flows=overlays,forecast`.
- **Oracle:** every overlay has a legend with >= 14 px text; one overlay at a time.

**W5.9 Gate w5** (J; A flips `CLIMATE2`, `AIR`; re-baseline) - Size M
- **Owns:** `tools/gate.mjs`, `tools/render-check.mjs` (atmos scenes), `tools/bench.mjs`.
- **Depends:** W5.1-W5.8.
- **Builds:** the gate rows of 6.8.
- **Test:** `node tools/gate.mjs --stage=w5`.
- **Oracle:** survival within 10 % of W4; render p95 within budget; 0 allocations per frame.

### 12.8 Stage W6: content breadth

**Playable result:** each biome has its own plants and animals; 8 new workshop chains (dye, honey and wax, candles, soap, paper, salt, barrels, instruments); new furniture and bathing rooms; creeds with shrines and rites; festivals; new incidents and traits; mine-cart tracks.

**Parallel:** every step works on its own rows and files; G is the single writer of `balance.js`. W6.0 lands first so no two steps touch `js/data/index.js` or `js/data/schema.js`.

| Step | Owns | Depends | Builds | Test | Oracle | Size |
|---|---|---|---|---|---|---|
| **W6.0 Table registration** (G) | `js/data/index.js`, `js/data/schema.js` | W5.9 | every new W6 table (`creed`, `festival`) and file registered with empty rows and validators | `node tools/validate-data.mjs` | legacy hashes identical | S |
| **W6.1 Biome plants and animals** (G, D, B) | G `plants.js`, `animals.js`; D `js/engine/art/beings.js`, `ground.js`; B `js/game/world/plants.js`, `js/game/animals/spawn.js` | W2.3 | P2 rows 10-11 | `node tools/validate-data.mjs && node --test tools/tests/biome-spawn.test.mjs` | every biome has >= 3 plants and >= 3 animals of its own; v1 worlds spawn as before (hash) | L |
| **W6.2a Materials and four chains** (G, E, D) | G `items.js`, `recipes.js`, `materials.js`, `structures/workshops.js`; E `js/game/work/bills.js`; D `kit2.js` | W6.0 | P2 row 12; row 13's dyer, apiary, chandler and soapworks (about 30 items and 30 recipes) | `node --test tools/tests/chains.test.mjs` | every chain is reachable from a biome's raw goods; the bot makes one item of each chain by day 120 | M |
| **W6.2b Four more chains** (G, D) | the same G files; D `kit2.js` | W6.2a | row 13's papermill, saltworks, cooper and instrument maker | `node --test tools/tests/chains.test.mjs` | as W6.2a | M |
| **W6.3 Furniture, rooms, air structures** (G, B, D) | G `structures/housing.js`, `civic.js`, `utility.js`; B `rooms.js` (roles `bath`, `music`); D `js/engine/art/kit.js` | W5.2, W6.0 | P2 rows 14-15 | `node --test tools/tests/rooms.test.mjs tools/tests/air.test.mjs` | a chimney removes its forge's smoke source; a bathing pool refills `damp` | M |
| **W6.4a Creeds** (G, F, I) | G `js/data/creeds.js` (new; the tenet thoughts live here, not in `thoughts.js`); F `js/game/people/creed.js` (new); I `js/ui/holdui.js` (Creeds tab) | W4.2, W6.0 | P2 row 16 | `node --test tools/tests/creed.test.mjs` | a colonist takes the people's or liege's creed at 70 % (seeded); conversion talks stay <= 1 per 20 colonist-days | M |
| **W6.4b Festivals** (G, K) | G `js/data/festivals.js` (new); K `js/game/colony/festivals.js` (new) | W6.4a | P2 row 17 | `node --test tools/tests/festivals.test.mjs` | a festival's quality follows its inputs monotonically; each festival day fires once per year | M |
| **W6.5 Incidents, traits, thoughts, visitors** (G, H) | G `incidents.js`, `traits.js`, `thoughts.js`, `visitors.js`; H `js/game/threat/incidents.js` | W5.1 | P3 rows 20-22 | `node tools/validate-data.mjs && node --test tools/tests/incidents.test.mjs` | every incident has a live cause (F26) | M |
| **W6.6 Mine-cart tracks** (E, B, D, G) | E `js/game/work/carts.js` (new); B `vertical.js` (track ramps); D `js/engine/art/vertical.js`; G `js/data/structures/storage.js` (track, ramp track, cart, stop rows) | W6.0 | P2 row 18 | `node --test tools/tests/carts.test.mjs` | a cart on a 40-tile route moves 10 stacks faster than 2 haulers | M |
| **W6.7 Gate w6** (J) | `tools/gate.mjs` | W6.0-W6.6 | a 300-day soak, 5 seeds | `node tools/gate.mjs --stage=w6` | survival within 10 % of W5; save < 150 KB at day 300; tick p95 < 1.2 ms | M |

### 12.9 Stage W7: assets and finish

**Playable result:** trees with seasons and sway; soft ground transitions; weathered structures and banners; dressed caverns; a live title; a polished world map; the Small hold; full strings and accessibility; tuned for the device.

| Step | Owns | Depends | Builds | Test | Oracle | Size |
|---|---|---|---|---|---|---|
| **W7.1 Tree painter and seasons** (D) | `js/engine/art/trees.js` (new), `keys.js` | W6.1 | 7.2 item 9 | `node tools/render-check.mjs --scene=art,trees` | 8 species x 4 seasons x 2 sway frames, 0 errors; sprite cache within 40 MB | L |
| **W7.2 Ground transitions** (D, C) | D `ground.js`; C `js/engine/render/terrain.js` | W2.5 | 7.2 item 10 | `node tools/render-check.mjs --fortress` | chunk bake time <= 1.2x W6; no hard edge between unlike grounds | M |
| **W7.3 Structures** (D) | `kit.js`, `kit2.js` | W6.3 | 7.2 item 11 | render-check art | 0 undrawn keys | M |
| **W7.4 Underground dressing** (D, C) | D `caverns.js`; C `levelview.js` | W5.6 | 7.2 item 12 | render-check `--scene=caverns` | props placed by hash only (no sim state: `stateHash` unchanged) | M |
| **W7.5 Live title and world map polish** (D, C) | D `title.js`, `atlas.js`; C `atlas.js` | W5.3 | 7.2 item 13 | render-check `--scene=title` | static under Reduce motion; <= 2 ms per frame | S |
| **W7.6 Small hold** (A, B, I) | A `setup.js`; B `mapgen3.js` (96 x 96 x 16 shape); I `regioncard.js` | W2.8 | 11 item 19 | `node --test tools/tests/small-hold.test.mjs` | the guarantees pass at 96 x 96 x 16 for 12 biomes x 10 seeds | M |
| **W7.7 Strings and accessibility, part 2** (I) | every `js/ui/*` not yet converted | W1.9 | 8.10, 11 items 23-24 | `node tools/check-strings.mjs --all && node tools/ui-phone.mjs --a11y` | 0 raw UI literals in `js/ui`; VoiceOver labels on canvas selection | M |
| **W7.8 Wide bridges** (B, E) | B `support.js`; E `construct.js` | W0 | 11 item 20 | `node --test tools/tests/world3d.test.mjs` | the R3 2.5 span rule extended with a pier rule | S |
| **W7.9 Device tuning and release** (J, owner) | `spike/z.html` (adds realm, atmos and air rows) | W7.1-W7.8 | 11 item 25 | the owner runs the page on the iPhone (and an iPhone 11 if available), in Safari and from the Home Screen | every 10 row within budget, or a tuning request; then `--stage=w7` deploys v0.5.0 | M |

### 12.10 Dependency order

```
W0 ──> W1 (shell) ──────────────┐
  │                             │
  ├──> W2.1 fields ──> W2.2 store ──> W2.7 embark ──> W2.8 found ──> W2.9 ship
  │        │      └──> W2.3 mapgen region ──> W2.4 climate ──┘
  │        │      └──> W2.5 atlas ──> W2.6 map component ──┘
  │        └──> W3.1 history ──> W3.3 / W3.4 / W3.5 ──> W3.6 migrate ──> W3.7 ──> W3.10 ship
  │                          └──> W3.2 text ──> W3.9 World tab     W3.8 season tick ──┘
  ├──> W4.1 data ──> W4.2 / W4.3 / W4.4 ──> W4.5 / W4.6 / W4.7 ──> W4.8 ship   (needs W3.3, W2.7)
  ├──> W5.3 render ──> W5.4 / W5.5 / W5.6 / W5.7       W2.4 ──> W5.1 ──> W5.2 ──> W5.8 ──> W5.9 ship
  └──> W6.0 tables ──> W6.x (rows; after their named depends) ──> W6.7 ship ──> W7.x ──> W7.9 release
```

**Critical path:** W0.1 > W2.1 > W3.1 > W3.3 > W3.6 > W3.10. L and K are the critical workstreams. W1 (I) and W4.1 (G) and W5.3 (C) start on day one of their stages, beside it.

**Ship order:** W0 (v0.4.3), W1 (v0.4.4, the new UI), W2 (v0.4.5, world map and embark), W3 (v0.4.6, history; old holds get worlds), W4 (v0.4.7, peoples), W5 (v0.4.8, atmosphere), W6 (v0.4.9, content), W7 (v0.5.0).

---

## 13. Risks and open questions

### 13.1 Risks

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| R1 | History is too slow on the A13 at Large and 400 years | medium | chunked generation with yields (no frame > 50 ms); the cap of 6,000 events; Large plus 400 years shows "this takes a few seconds"; a module Worker is the fallback (the code is already pure) |
| R2 | The realm record pushes exports past 270 KB at Large | low | Large is opt-in; the event cap; measured in W2.2 and W3.1; at worst events are trimmed to the 3,000 most linked rows for Large |
| R3 | Swimming makes pathing non-uniform (two cost classes) | medium | regions stay walker-only; swimmers fall back to capped plain A*; brute-force oracle (W4.3); the bench row `swimmers6` |
| R4 | The Kilnfolk mineral diet breaks the economy or the bot | medium | semi-playable only; coal days on the HUD; the bot policy in W4.8; balance rows in G |
| R5 | The UI rewrite regresses flows that players know | high | W1 is its own release; the 31-screen reachability flow; the "What is new" deck; old long-press shortcuts kept |
| R6 | Scope: about 400 content rows | high | stages ship independently; W6 rows are cut lowest-priority first; placeholder art is allowed until W7 |
| R7 | Name clashes (IP) | low | quick web checks done (header); a final check before W4 ships; ids are never shown, so a rename stays cheap |
| R8 | Air and climate balance (fog accuracy, snow, firedamp) makes play frustrating | medium | Hearthkeeper halves the air sources and blast chance; gas warnings 1 day ahead with a damp lamp or gas-nose; soak reports per biome |
| R9 | Photosensitivity (lightning, aurora) | low | the WCAG 2.3.1 caps, never white, a dim pulse under Reduce motion, a review in W5.4 |
| R10 | Cloud compositing at DPR 3 costs more in Safari than estimated | medium | benched in W5.4; fallback: 1 px per tile masks, or cloud shadows off below a measured frame time |
| R11 | IndexedDB eviction loses the realm record | low | it is embedded in dawn and export; regeneration with CRC; and a missing record never refuses a hold (9.2) |
| R12 | Migration part 2 changes old holds' timelines noticeably | medium | goodwill and the legacy roles are kept; the pacing report within 10 %; the "What is new" deck explains the world |
| R13 | `js/game/world` vs `js/game/realm` naming confuses agents | low | G1 states it; a header comment in each realm module |
| R14 | Flipping `PEOPLES2` makes old holds' Thornwake and Emberkin unhappy overnight (sky need, comfort band) | medium | new needs start full, the comfort band starts at the next dawn, a "What is new" card, and the W4.8 no-break oracle on the W0 fixtures (9.4) |
| R15 | The embark flow reads as a copy of DF's | low | the shape is borrowed (a common genre pattern), the wording is not: "Ready the band", "Found now", "Settle here", "Mark"; no DF screen text, names or art |

### 13.2 Open questions (with the default taken if the owner does not answer)

| # | Question | Default |
|---|---|---|
| Q1 | Should later holds in the same world see earlier ones (DF-style)? | **No** (G28; R3 owner decision 4) |
| Q2 | Default world size and history length? | **Standard 64 x 64, 250 years** |
| Q3 | Should Lamplost, Kilnfolk and Greyborn ever be choosable at embark? | **Not in this overhaul.** A later "Lamplost Gallery" start would be a plain start in any world with a Lamplost civ in reach, never an unlock earned by an earlier hold (no cross-hold progression: R2.9 removed it, and G28 keeps holds apart); **Kilnfolk and Greyborn: never** |
| Q4 | Any travel or expeditions out of the hold (envoys you send, raids you send)? | **No** for this overhaul (G32); revisit after W7 |
| Q5 | Is the Crown Charter tithe too close to a scripted antagonist? | **Keep it**, as an ongoing relationship with no win or loss state; refusing raises a cause, not a scripted siege |
| Q6 | Languages beyond English? | **English only**; W1.1 and W7.7 make translation possible |
| Q7 | Should "Thornwake" replace "Sylvari" in old saves' Annals text? | **Yes**: names are rendered from ids, so old text updates for free |
| Q8 | Should the air sim be per tile later? | **No**; cells are enough for play, and per-tile smoke is cosmetic (6.5) |
| Q9 | Can a hold embark on a site's region or next to a hostile site? | On a site: **no**. Next to a hostile site: **yes**, with a warning on the card |
| Q10 | World map as a full-screen game mode with seasons (DF-like world view in play)? | **The World tab only**, read-only; the map shows the current season's snow line as a cosmetic layer |

---

## Appendix A: sources

From the research notes (each note lists its full citations):
- **Dwarf Fortress.** DF2014 Advanced world generation, World rejection, Biome, Embark, Site finder, Ethic, Belief, Preference, Trade, Caravan (dwarffortresswiki.org, through search summaries); Tarn Adams (Wikipedia); PC Gamer on DF's history simulation; PC Gamer and PCGamesN on the Steam UI rework.
- **Caves of Qud.** Grinblat and Bucklew 2017, "Subverting Historical Cause and Effect" (pcgworkshop.com); GDC 2018, "Procedurally Generating History in Caves of Qud"; Kremins on Epitaph; the Qud wiki pages on Sultan history, Map, Zones, Faction and Water ritual.
- **RimWorld.** The RimWorld wiki pages on World generation, Biomes, Metabolic efficiency, Genes, Memes, Precepts and Ideoligions; the Ludeon forum.
- **Other games.** Kenshi races (kenshi.wiki); Songs of Syx (fan guides, unverified); Ultima Ratio Regum (Wikipedia).
- **Atmosphere and rendering.** Graveyard Keeper effects (gamedeveloper.com); pixel-art light and weather (blakecrosley.com); Godot cloud shadow shaders; SLYNYRD "water in motion"; Verdant Skies reflections; Stardew Valley weather data (modding wiki); Terraria lighting modes; SFML tile lighting; Noita at GDC 2019 and on 80.lv; Rain World (GDC 2016 report, Unity blog); adaptive music (Splice, Game Developer, "Writing Interactive Music"); WCAG 2.3.1.
- **UI.** Frostpunk console and Frostpunk 2 radial design (Game Developer, Xbox Wire 2019 and 2025); Pocket City reviews (Kotaku, Destructoid, iMore); Stardew Valley mobile controls (wiki, MacRumors); Apple HIG Sheets; NN/g on bottom sheets.
- **Name checks (2026-11-27).** Web searches for each new people name found no game race with these names; the nearest hit was "Kiln" (questden.org wiki).
- **Own knowledge.** Where a note says "own knowledge" (RimWorld UI, Banished, Polytopia, Mini Metro, Townscaper, Bad North, Kingdom Rush, Kingdom, Safari Canvas 2D costs), this document relies on it as a design input only. It was not verified on the web.
