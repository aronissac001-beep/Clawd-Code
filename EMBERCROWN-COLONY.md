# Embercrown: The Hold (persistent colony builder) - design and build plan

Status: design of record for the rebuild, **revision 2** (after the design review; section 0 lists every change and where it lives). It replaces the roguelite run (Realm Map, regions, Citadel, Dawn Cards, relics).
Companion: `INVENTORY.md` (engine measurements and module verdicts) in the same folder. Where this file names an old module, the inventory's verdict applies unless this file says otherwise.

**Decisions taken in this document (engineers can rely on them):**

| # | Decision | Value |
|---|---|---|
| D1 | Map | One persistent map per colony, **128 x 128** tiles (32 world units each). A 96 x 96 "Small Vale" is added in Stage 3. No module may allocate N-sized buffers at import time; all of them live in `s.rt`. |
| D2 | Underground | **One layer.** Mountains are solid rock tiles you tunnel into, under a rock roof with a darkness overlay. No z-levels. Depth = distance into the massif. |
| D3 | Time | Sim at 20 ticks/s. **1 game hour = 600 ticks = 30 s at 1x. Day = 12 min at 1x, 4 min at 3x.** Season = 10 days, year = 4 seasons. Speeds: pause, 1x, 2x, 3x, and 5x (hidden only while an **active raid member or an aggroed creature** is on the map, or a colonist is drafted; an idle cave spider does not block it). **Every sim cadence is defined in ticks** (a rate written "per second" means per 20 ticks), never in real time. |
| D4 | Offline | **No offline simulation.** The game pauses and saves when hidden. **It always resumes paused**, with the Dawn Ledger card on screen (10.10); one tap plays at the previous speed. A "Rest until..." button fast-forwards at max speed until the next alert or morning. |
| D5 | Threats | One storyteller schedules incidents. Major threats every 4-8 days with a **warning 6-24 game hours ahead** (countdown chip). Most days are for building. |
| D6 | People | Named colonists with 15 skills (0-20, passions, a superlinear XP curve with a daily soft cap: a passionate specialist reaches Master around year 1 and Grandmaster around years 3-4), 3 attributes, 24 traits, **5 needs** (Food, Rest, Joy, Warmth, Light), mood with breaks, wound-based health, light relationships, an ancestry and a backstory. |
| D7 | Work | **13 work types.** Each colonist has a **Role** (Miner, Smith, Grower, Doctor, Soldier...) and an optional second Role; a role is a data preset of priorities. The full per-colonist priority grid (1-4 or off) is an Advanced toggle. Jobs come from work givers over indexed candidates. Items lie on tiles and are hauled to filtered stockpiles. Workbenches run smart default bills. |
| D8 | Furniture | **Crafted at workshops as items** (material and quality), then installed. Placing a furniture ghost with none in stock auto-queues a bill. Walls, floors, doors and buildings are constructed on site. |
| D9 | Factions | The four old factions become **ancestries** of colonists (Human, Sylvari, Deepforge, Emberkin). World factions are new: traders, reavers, Grey Pilgrims, Gutterkin. |
| D10 | Failure | The colony falls when no free, able colonist remains. **Legacy: Reclaim.** A new band arrives on the same map, finds the ruined hold (with its graves, stock and a Hollow nest at the cold Hearth) and keeps part of the old colony's lore. |
| D11 | Saves | Binary `EC2` blob (typed-array tile layers + positional JSON entities + a small saved-runtime section, deflate-raw), about 20-60 KB per colony, **stored as raw bytes in IndexedDB**. localStorage holds only the colony index, settings and one emergency quick-save. Autosave every 60 s real time and on lifecycle events, into 2 rotating slots plus a daily dawn backup. Up to 8 colonies. File and text export, a seasonal backup prompt, and a "Move colony to the app" flow (section 11). |
| D12 | Repo | The rebuild happens on branch `colony`. Stage 0 deletes the run-layer code there (git history keeps it for salvage). `main` keeps the old game until the Stage 1 gate passes, then `colony` merges and the new game is on the start screen. A **frozen copy of the old roguelite stays playable at `/classic/`**, so the merge is not all-or-nothing. |
| D13 | Determinism | **Any `s.rt` data that affects a sim decision is either saved, or brought up to date at the end of every tick in which its inputs changed** (contract C13, 13.3). Determinism is **same-engine** (saves are snapshots), so the reused trigonometry in `movement.js` and `engage.js` stays; the gate runs the determinism suite in Node (V8) and in Playwright WebKit (JavaScriptCore). |
| D14 | Phone | Layout budgets are for the **Safari browser viewport** (about 664 pt tall on an iPhone 13 in portrait, about 335 pt in landscape) and for the Home Screen app (about 763 pt). Pause and speed live in the bottom bar. A selection opens a 120 pt peek card first. New colonies prompt Add to Home Screen. |
| D15 | Delivery | Stage 0 includes a **device spike**. Stage 1 is split into **1a Dig and build** (a sandbox on a device by week 3, with a fun review) and **1b First night** (needs, the first horde, drafting). Only C1, C2-core, C3, C5, C6 and C13 freeze at the end of Stage 0; the rest freeze after the 1a fun review. |

Sections: 0 response to the review, 1 pitch, 2 loops and time, 3 world, 4 colonists, 5 work and logistics, 6 items and production, 7 structures, 8 specialisation and progression, 9 threats and events, 10 phone UX, 11 saves, 12 performance, 13 architecture, 14 build plan. The appendix maps each requested topic to its section.

---

## 0. Revision 2: response to the review

Every point of the review is accepted unless the last column says otherwise. "Where" names the section that now holds the change.

| # | Review point | Change | Where |
|---|---|---|---|
| P0-1 | Save/load determinism has no cache contract | New contract **C13**: every `rt` field is classed as saved, end-of-tick, incremental-ordered, derived-exact or render-only, and a test fails on an unlisted field. Regions, rooms, temperature, light and zone fields rebuild at the end of the tick in which their inputs changed. Think queue, path queue, paths and unreachable memory are saved. Reservations are an exact function of jobs (single `endJob` exit, no sweep, asserted every tick in the gate). Flow fields are built whole inside one tick **and** saved while a raid is live. All cadences in ticks. Same-engine determinism; gate in Node and WebKit. | D13, 5.3, 5.4, 5.6, 9.3, 12.3, 13.3, 14.1, 14.4 |
| P0-2 | iPhone Safari can lose a colony | Blobs as raw bytes in IndexedDB; localStorage keeps only the index, settings and a quick-save. Add to Home Screen prompt in onboarding, "Move colony to the app", seasonal "Back up your hold" share-sheet prompt, eviction and fallback tests. | 10.9, 11 |
| P0-3 | Portrait chrome does not fit Safari | Designed for 664 pt (Safari) and 763 pt (app): one 44 pt top bar (Menu icon, clock, threat chip, stock chip), a 52 pt rail that hides under any sheet, a 56 pt bottom bar with the **speed button** at the thumb, a 120 pt peek card before any full sheet, a 320 pt landscape overlay. Gate at real Safari viewport sizes. | D14, 10.1, 10.7, 14.4 |
| P0-4 | Stage 1 too big, fun tested late | Stage 0 device spike (6 questions); Stage 1a "Dig and build" sandbox on a device in week 3 with a fun review and a go/no-go; Stage 1b "First night"; only six contracts freeze at Stage 0; `/classic/` at merge. | D12, D15, 14.3, 14.5-14.7 |
| P0-5 | XP curve contradicts itself | `XP(n) = 1100 x 1.28^n` per level plus a daily soft cap (2,400 full-rate work ticks per skill per day, then 20%). Tabled targets; checked by the bot balance report. One work unit everywhere: game minutes at speed 1.0. | 4.2, 3.2, 6.4, 14.4 |
| P1-6 | Specialisations are percentages | Perks cut from 120 to **33**, every one a new action or rule. Each of the 36 workshop specialisations **adds** an action or a recipe set (61 new recipes). Each charter adds one mechanic (caravans, vigils, commissions, herd drives, garrisons and sallies) and nudges the storyteller strongly (x3 / x0.3 weights, a fixed first major). | 8.1, 8.2, 8.3 |
| P1-7 | Chunk LRU thrashes at minimum zoom | Three bands (8x8 at TSCALE 2, 16x16 at 1, 16x16 at 0.5), each LRU at 1.5x its maximum visible count, only two bands hold canvases, `width = height = 0` on eviction, tile-colour placeholder while baking, 3x3 patch redraws for mined tiles, 1 full bake per frame, strategic level of detail with pips and raid blobs below zoom 0.5. | 12.4, 12.5 |
| P1-8 | Storyteller has budgets but no actors | Cast selectors, named nemeses with scars and grudges, aftermath (siege ruins, captives, stolen heirlooms and their recovery), and **Ember-touched** moods that demand deep materials and produce named artifacts. The best hooks are put forward in the pitch and onboarding. | 1, 4.5, 9.10 |
| P1-9 | Building rooms costs too many taps | Room stamps with furniture sets, Carve hall with automatic natural pillars, built pillars or props, copy and paste of rooms. | 10.11 |
| P1-10 | The work grid is tedious | Roles by default (13 presets, a primary and a second role); 13 work types (Brew into Cook, Clean into Haul, Warden into Care, Hunt into Animals, Firewatch an automatic emergency); smart default bills with advanced fields behind "More"; preset-first stockpile filters; scrolling icon-and-label tabs. | 5.1, 5.7, 10.3, 10.4 |
| P1-11 | Mined stone floods the item cap | Rough stone stacks 10 per tile as a stone pile, is left in place unless needed, and counts as stored near a headframe or quarry. Haul uses a zone distance field plus per-zone free lists, so filling a cell does not stale the field. | 3.4, 5.5, 5.6 |
| P1-12 | Render light ignores occlusion | The sim light map (flood fill blocked by walls and rock) is the only source; the renderer draws a 2 px-per-tile light texture whose wall pixels take light only from their own side. | 3.3, 12.4 |
| P1-13 | File ownership | Pathing, regions, movement and spatial go to B (World and movement); H keeps flow fields, raid AI and combat. New workstream **K** (colony systems and animals) splits G; G is content data only. Temperature has a model (3.6) owned by B. Art uses kits. | 3.6, 13.1, 14.2 |
| P1-14 | Sessions without a goal | Dawn Ledger, Next steps (3 suggestions from data rules), resume paused, coach to 3x on day 1, the default start's first omen on day 2 (about 10 minutes of play). | D4, 9.1, 10.9, 10.10 |
| P2-15 | 8 needs is a lot | 5 needs; Comfort and Beauty become room and furniture thoughts; Social becomes relationship thoughts and a Joy kind. | 4.4 |
| P2-16 | 5x blocked by idle hostiles | Blocked only by active raid members, aggroed creatures or drafted colonists. | D3, 2.2 |
| P2-17 | A* budget too high | 8,000 expansions per tick; searches never span ticks; cluster-split regions with two label sets (colonist: doors open, hostile: doors closed); HPA-lite paths over the region graph if the 1b maze bench needs it. | 12.3 |
| P2-18 | Battery | 30 fps by default when the camera is still and no combat is on screen; 60 on pan, zoom, sheet motion or combat. | 12.4 |
| P2-19 | Straight-line job distance | Candidates ranked by region-graph distance. | 5.3 |
| P2-20 | Mood smoothing too slow | A quarter of the gap every 60 ticks. | 4.5 |
| P2-21 | Massif may be too thin | Max depth >= 30 and >= 300 Underdeep tiles guaranteed, map edge counts as rock for depth, checked on seeds 1-100. | 3.2, 14.6 |
| P2-22 | DF mechanisms too late | Levers, pressure plates, locked gates and linked deadfalls move to Stage 2 (Mechanisms tech moves to the Hold era); floodgates stay in Stage 3. | 7.8, 7.12, 14.8 |
| P2-23 | Tap targets and accidental pause | Colonists win taps within 22 pt; pips have 44 pt hit areas; two-finger-tap pause is a setting, off by default. | 10.2 |

**Where I disagree, briefly:**
- **Flow fields (P0-1):** the review offers "build whole in one tick" *or* "save while hostiles are present". Both are needed: a field built at tick T from the state at T cannot be rebuilt at a later load tick, so a whole-tick build alone still breaks save-mid-raid. Fields are built whole (no half-built state to save) and saved while a raid is live.
- **Clearing the old keys (P0-2):** not automatic. `/classic/` (P0-4) still reads `embercrown.*`; the keys are small and the colony no longer lives in localStorage. Settings offers "Export and clear classic saves".
- **One bench in 1a (P0-4):** 1a has two benches, carpenter and mason. Stone walls need blocks and beds need wood; a single generic bench would be a throwaway building, and the wood-versus-stone choice is part of what the fun review must judge.
- **Perk count (P1-6):** 33, not about 30: 6 key skills x 2 levels x 2 choices, plus one signature perk for each of the other 9 skills, so no skill is a dead end.
- **HPA paths (P2-17):** the region graph ships in 1a (it is needed for job ranking anyway), but hierarchical path refinement is built only if the 1b tunnel-maze bench misses the A* budget. It is a measured decision, not a default.
- **XP (P0-5):** both suggestions are used, not one: the curve sets the shape and the cap stops long work shifts from compressing it. The cap counts work ticks before multipliers, so passions keep their full effect.

---

## 1. Pitch and pillars

**Pitch.** *The Hollow took the old kingdom's light. You lead a handful of named survivors into a vale under a mountain, kindle a Hearth, and over years of seasons dig a hold into the rock, raise halls, forge steel from deep veins and train smiths, healers and wardens, until the Hearth burns bright enough to be crowned again. The colony never resets. Every tunnel, grave and masterwork stays.*

Tone is unchanged: hopeful dark fantasy. Warm firelight against cold grey. The Hearth is home and the Hollow is the cold that wants it. Light is a mechanic, not just mood: lit ground weakens the Hollow, darkness breeds dread, and the deepest rock is where the grey lives.

### Pillars

1. **One hold, many years.** Nothing resets between sessions. Progress is the physical colony: rooms, stock, skills and stories.
2. **People, not units.** Every colonist has a name, a past, skills that grow, quirks and needs. Losing one hurts. A master smith is something you raised.
3. **Dig deeper, find more.** The mountain is the discovery engine. Richer stone, ore, gems, caverns and old vaults lie deeper in, along with the Hollow.
4. **Firelight against grey.** Light shapes building (torches in tunnels), mood (dread in the dark) and defence (Hollow weaker in light, Shades pinned by it).
5. **Threats are events, with warning.** A storyteller sends raids, sieges, beasts and disasters every few days with honest warnings. The rest of the time is for building, and a threat is a story beat.
6. **One thumb on a phone.** Every action works with taps and short drags on a 375 pt portrait screen, in short sessions, at 60 fps, on battery.

### Why it is not repetitive

| Cause of the old repetition | What replaces it |
|---|---|
| Every run restarts the colony | **Persistence.** One colony per save, continuous autosave, no run end. When a colony falls, the next band **reclaims the same map** (D10), so even failure carries forward. |
| The same opening each time | The opening happens once per colony. After the first two days, the decisions are new ones (where to tunnel, which path to charter, who to train). |
| A wave every night | The **storyteller** schedules from colony wealth, population and recent history. Raid types change what you must defend (core, stores, people, tunnels). Threat points escalate as the colony grows, and the mix changes with prosperity tier. |
| Fixed unit roster | **Specialisation that changes verbs** at three levels: perks that add actions, workshop specialisations that add recipes and jobs, and a charter that adds a mechanic (caravans, vigils, commissions, herd drives, garrisons) and bends the storyteller. Two colonies with different charters play differently within 2-3 raids. |
| Known map | **Discovery while digging.** Rock interiors are unknown until exposed. Ore veins, gem pockets, caverns, an underground lake, Old Crown vaults with lore tablets, and Hollow seeps at depth. Prospecting and surveying are skills. |
| No memory | **Emergent stories with actors.** Incidents pick participants (the unhappiest colonist, a rival pair, the one who felled the last captain), escaped enemies return as named **nemeses**, raids leave ruins, captives and stolen heirlooms, and **Ember-touched** colonists demand deep materials to make named artifacts. All of it feeds a **Chronicle** (a dated log of deeds) and named items ("Bryn's masterwork steel halberd, forged the day the Colossus fell"). |
| No horizon | **Long-term goals**: prosperity tiers that unlock content, three Hollow Lords to defeat, a charter Wonder, and rekindling the **Great Hearth** into the Crown of Embers. |

### The hooks (lead with these on the title screen, in onboarding and in any store text)

1. **The greed lever.** The richest ore and gems lie near the Hollow seep. Tunnel within 15 tiles of it and the deep wakes: breaches come up through your own tunnels (9.3).
2. **Taint.** A Hollow wound can turn a colonist into a Husk over three days unless treated (4.6).
3. **The dead rise.** Corpses left unburied in the dark rise as Husks (4.8).
4. **Ember-touched.** A colonist seized by a vision claims a workshop and demands something from the deep. Meet it and a named artifact enters the Chronicle; fail and they break (4.5).
5. **Nemeses.** The captain who escaped comes back, scarred, for the colonist who wounded him (9.10).
6. **Reclaim.** When a hold falls, the next band returns to the same ruin, its graves and its enemies (9.9).

---

## 2. Core loops and time

### 2.1 Loops

**Minute to minute (one in-game hour = 30 s at 1x):**
- Designate (drag rectangles: mine, chop, harvest, haul, smooth, deconstruct), place blueprints (walls, rooms, workshops, furniture), paint zones (stockpile, grow, pen, burial).
- Manage people: check the alert stack, open a colonist, change a role, queue bills, draft for a fight.
- Watch the hold work. Colonists carry, dig and craft on their own, and the player reacts to friction (a starving colonist, a full stockpile, an idle smith).

**Day (12 min at 1x, 4 min at 3x):**
- Morning: colonists wake, eat and work. The player reviews overnight alerts and sets the day's projects.
- Afternoon: production and expansion.
- Dusk 19:00-21:00: light matters, colonists drift to joy and meals. The Hollow is stronger at night.
- Night 21:00-05:00: colonists sleep by schedule. Night watch (soldier duty) and lights hold the dark.
- About one day in five has a threat warning. About one in two has a minor event (trader, wanderer, a discovery, a small disaster).

**Season (10 days) and year (40 days):**
- **Thaw** (spring): planting, river floods, migrants more likely.
- **Highsun** (summer): best growth, drought and fire risk, caravans.
- **Ashfall** (autumn): harvest, blight risk, the Grey Pilgrims march, raids grow.
- **Deepcold** (winter): no outdoor growth, cold snaps, warmth and stored food matter, the Hollow is strongest (longer nights: 20:00-06:00).
- Each year end: the Chronicle writes a year summary, the storyteller's escalation floor rises, and a "Year's Turning" festival offers a joy event if a great hall exists.

**Long-term goals (the horizon):**

| Goal | What it takes | What it gives |
|---|---|---|
| Prosperity tiers (6): Camp, Hamlet, Village, Hold, Stronghold, Crownhold | Wealth + colonists + Hearth level (table in 8.4) | Tech eras, charter choice, more migrants and traders, larger raids, new raid types, Wonder and Lord access |
| Charter a path (at Hamlet; a second at Stronghold) | Choice of 5 (section 8.3) | Passive bonuses, unique structures, a Wonder |
| Raise the charter Wonder | A multi-stage build of 3 stages, each needing rare goods | A permanent colony-wide effect plus a large mood and wealth boost |
| Defeat the three Hollow Lords (Gloomwyrm, Bone Colossus, Hollow King) | Each can be challenged after a tier, and each comes on its own after a grace period if not challenged | A **Lord's Ember** (needed for the Great Hearth), a Chronicle deed, a trophy structure |
| Rekindle the Great Hearth (Hearth level 5, "the Crown of Embers") | 3 Lord's Embers, the Ember Crown (jeweller masterwork), Heartstones from the deep | Victory screen, then the colony continues: the blight recedes from the map and raids soften to "endgame trickle" |
| Deeds | About 60 data-driven deeds (first steel, a Legendary item, 10 years, 30 colonists...) | Chronicle entries, unlock cosmetic banners |

### 2.2 Time model

- Fixed 20 Hz sim tick (unchanged `loop.js`). `s.tick` is an integer. Calendar: `hour = floor(tick / 600) % 24`, `day = floor(tick / 14400)`, `season = floor(day / 10) % 4`, `year = floor(day / 40)`. `js/game/core/time.js` exposes pure helpers.
- Speeds: **Pause, 1x (20 ticks/s, one tick every third frame at 60 fps), 2x (40/s), 3x (60/s, one tick per frame), 5x (100/s)**; a frame never runs more than 4 ticks (the loop drops render to 30 fps at 5x rather than skip sim). 5x is hidden while an **active raid member** (a foe whose raid has arrived) or an **aggroed creature** (a beast or Hollow that has a hostile target) is on the map, or a colonist is drafted; a cave spider asleep in its cavern does not count. The game drops to 1x automatically when a raid arrives, a major letter appears, or a colonist goes down (each a setting, default on).
- Auto-pause on major letters (setting, default on for the first year).
- "Rest until morning / next alert": runs at 5x (or 3x if hostiles) until 06:00 or any alert of priority >= Warning.
- Day/night: dawn 05:00-07:00, day, dusk 19:00-21:00, night 21:00-05:00 (Deepcold: 20:00-06:00). The colour grade, light pass and Hollow strength keep the old `cycle.js` curves.
- **Offline and background:** no simulation while hidden. On `visibilitychange` hidden or `pagehide`: pause, save at once. On return: **always paused**, with the Dawn Ledger card (10.10); one tap on the speed button resumes at the previous speed. This is intentional: deterministic, no surprise deaths, no battery use, and the player reorients before time runs.

---

## 3. World

### 3.1 Map

- 128 x 128 tiles (16,384), tile = 32 world units, so the world is 4,096 units square.
- The map edge is the **Grey Edge**: the Hollowed lands. Hostiles and visitors enter from it. The edge vignette art is reused.
- "Expanding the map" means three things, all persistent:
  1. **Exploring** the fog (surface) and **exposing** the rock (underground).
  2. **Claiming** land: you can construct only on **claimed** tiles. The Hearth claims radius 14; each **Waystone** claims radius 9 and must be placed on claimed land or touching its border. Waystones cost stone + a gem (rough or cut) and are limited by tier (Camp 1, Hamlet 3, Village 6, Hold 10, Stronghold 16, Crownhold unlimited). Designations (mine, chop, hunt, haul) work anywhere explored, so tunnels can run ahead of claims. Mined tiles inside the mountain are claimed automatically when connected by a tunnel to claimed land (the hold grows as you dig).
  3. **Cleansing** the blight: grey Hollow-blight patches cover about 6% of the map at start, away from the start site. Blighted tiles are infertile, darken mood nearby and can spawn Husks at night if a blighted patch of 30+ tiles is unlit. Tiles lit (light level 2+) for a full day, or inside a Waystone radius, lose 20 blight per day. Blight spreads 1 tile/day from Hollow seeps and from the edge during Ashfall.

### 3.2 Generation (`js/game/world/mapgen.js`, seeded, deterministic, about 40 ms target)

Steps (each uses `rng.fork('gen:<step>')`):
1. **Elevation** from 3-octave value noise plus a massif mask: one large **mountain massif** covering 25-35% of the map on one side (N, E or W from the seed), and 1-2 small hills (5-8% each). Rock = elevation above a threshold. **Massif guarantee:** the massif is at least 50 tiles thick from open ground to open ground, or 30 tiles from open ground to the map edge, so that the maximum depth is >= 30 and the Underdeep (depth 23+) holds >= 300 tiles. A seed that fails re-rolls only the massif mask (`gen:massif:<n>`, at most 4 times); the seeds 1-100 check (14.6) allows zero failures after re-rolls.
2. **Depth field**: a distance transform from the nearest non-rock tile, per rock tile (`depth`, u8, not saved: recomputed from terrain at load). The map edge counts as rock, so a massif along an edge keeps getting deeper toward it.
3. **Rock layers by depth** (the stone material of each rock tile):

| Depth (tiles into rock) | Layer | Stones (weighted by noise) | Mining work (game minutes at speed 1.0) | Notes |
|---|---|---|---|---|
| 1-4 | Outer | Sandstone, Limestone | 12 | thin roof (can collapse, not an overhead mountain) |
| 5-12 | Middle | Granite, Slate | 20 | overhead mountain roof begins |
| 13-22 | Deep | Basalt, Marble (pockets) | 30 | caverns likely |
| 23+ | Underdeep | **Duskstone** (dark, faintly cold) | 45 | Hollow seeps, Heartstone, Lumenite |

(A Journeyman miner, speed factor 1.3, cuts a granite tile in about 15 game minutes, 7.5 s at 1x.)

4. **Ore veins** as random walks (6-20 tiles; gems 1-3 tiles), placed by depth tables in `js/data/worldgen.js`:

| Deposit | Depth | Veins per 128 map | Yield per tile | Visible from |
|---|---|---|---|---|
| Coal | 2-14 | 10-14 | 6 coal | exposed or surveyed |
| Copper | 2-12 | 6-8 | 4 ore | exposed or surveyed |
| Tin | 3-12 | 4-6 | 4 ore | exposed or surveyed |
| Iron | 6-20 | 7-10 | 4 ore | exposed or surveyed |
| Silver | 12-24 | 3-4 | 3 ore | exposed or surveyed |
| Gold | 16+ | 2-3 | 2 ore | exposed or surveyed |
| Lumenite (glowing ore, gives light while in the wall) | 20+ | 2 | 2 ore | visible as a glow 3 tiles through rock |
| Clay (soft deposit, also on river banks) | 1-6 | 4 | 5 clay | surface |
| Gems: Amber 1-8, Garnet 4-14, Sapphire 10-20, Emerald 14-24, Ruby 18+, Heartstone 23+ | | 2-6 pockets each, Heartstone 3 | 1 rough gem | exposed or surveyed |

5. **Caverns**: 3-5 cellular-automata pockets (40-250 tiles) at depth 8+, all under overhead roof: open floor, cave moss, glowcap mushrooms (food), an underground pool (water), cave spiders (hostile beasts) or glowbeetles (tameable light). One **Deep Cavern** at depth 20+ holds a **Hollow seep** (a dormant rift: the source of breach raids, section 9.3).
6. **Underground spring**: 1-2 water pockets in the middle layer (a well can be built on or next to it; it is the only clean water inside the mountain).
7. **Surface**: one river crossing the map edge to edge with 2-3 fords, one lake, marsh near water, forests (20%, elderwood clumps with "old trees" that yield Elderwood), meadows with berry bushes and wild herbs, sand at banks, rich soil patches (5%).
8. **Ruins** (3-6): surface watchtower ruins and a crypt (loot, a few dormant Husks, stone), and **1-2 Old Crown vaults** inside the massif at depth 10-20 (worked-stone walls, a lore tablet that unlocks one tech, a sealed chest, sometimes sleeping Hollow Knights). Vault walls are visible as soon as an adjacent tile is exposed.
9. **Start site**: a 20 x 20 flat, buildable area within 6 tiles of the mountain face, a river within 25 tiles, at least 3 trees and 1 berry patch within 12, and the Hearth placed at its centre. BFS check that the site reaches 3 of 4 map edges by land (raid entries).
10. **Spawn edges**: each edge has 3-5 entry segments (land tiles on the border reachable from the Hearth). The storyteller picks among them.

Biome: the start biome (palette) is Greenvale. Hollowed Ruins palette is used for blighted tiles, Ashlands colours for Duskstone. Elderwood becomes a second start biome in Stage 3 (more forest, less ore).

### 3.3 Tile layers (the shared contract, `js/game/core/grid.js`)

| Layer | Type | Values |
|---|---|---|
| `terrain` | Uint8 | 0 void, 1 grass, 2 meadow, 3 dirt, 4 sand, 5 rich soil, 6 marsh, 7 shallow water, 8 deep water, 9 **rock** (natural wall), 10 **rough floor** (mined), 11 rubble (collapsed rock, mineable, yields 0), 12 cave moss floor, 13 tilled soil, 14 ice (Deepcold shallow water), 15 lava (unused in v1, reserved) |
| `mat` | Uint8 | stone material id for rock and rough floor (0 none), see `materials.js` |
| `ore` | Uint8 | deposit id (0 none) for rock tiles |
| `floor` | Uint8 | constructed floor id (0 none): smoothed stone, planks, flagstone, brick, carpet, mosaic, road |
| `roof` | Uint8 | 0 open, 1 built roof, 2 thin rock roof, 3 overhead mountain (cannot be removed) |
| `plant` | Uint8 | plant kind (tree, bush, crop, grass tuft, mushroom) |
| `growth` | Uint8 | 0-255 growth, or felled stump timer |
| `fog` | bitset (Uint8 per 8 tiles) | explored |
| `known` | bitset | rock tile material/ore known (exposed or surveyed) |
| `blight` | Uint8 | 0-255 |
| `zone` | Uint8 | zone id (0 none, 1-254), zones defined in `s.zones` |
| `desig` | Uint8 | bitflags: 1 mine, 2 chop, 4 harvest, 8 smooth, 16 engrave, 32 prospect, 64 risky-ok, 128 forbidden-area |

Derived (in `s.rt`, rebuilt by `initRuntime`): `occ` (Int32 building id per tile), `itemAt` (Int32 item index per tile), `region` and `regionH` (Uint16 reachability labels for colonists and for hostiles, 12.3), `room` (Uint16 room id), `light` (Uint8 0-3: a flood fill from every light source blocked by walls, closed doors and rock; **the single source of light for both sim and render**, 12.4), `heat` (Int8, 3.6), `depth` (Uint8), `support` (Uint8 distance to nearest support, capped at 7), `walkCost` (Uint8), chunk dirty flags. Which `rt` data is saved and which is rebuilt at the end of a tick is fixed by contract **C13** (13.3).

### 3.4 Digging rules

- **Mine designation** (drag rectangle; only rock tiles that are known or on the exposed face get marked; unknown interior tiles get a faint "mine if reached" mark and are mined in order as they become adjacent to open floor).
- Mining work (game minutes at speed 1.0) = stone work (3.2 table) x ore multiplier (ore 1.25, gems 1.5), divided by the miner's speed factor (4.2). Output: **rough stone** of the material on 70% of plain tiles (setting: "keep 100%"), the deposit yield on ore tiles, 1 rough gem on gem tiles.
- **Stone piles.** Rough stone (mass 12) stacks **10 per tile** as a stone pile. The miner drops it on the nearest pile of the same stone within 2 tiles that has room, else on the tile it stands on. By default stone is **left in place unless needed** (5.6), so 1,500 mined tiles make about 105 piles, not 1,050 items.
- Mined tile becomes `rough floor` (mat kept). Its roof is 2 (thin) at depth 1-4 and 3 (overhead) deeper. Adjacent rock tiles become `known` (the DF-style reveal), and the fog flood-reveals the open space connected to it up to colonists' sight.
- **Support and cave-ins.** A roofed tile is supported if a support (natural rock, a built wall, a **support pillar**, a **wooden prop**) lies within Chebyshev distance **4**. So an unsupported carved room can be up to 9 x 9.
  - When planning, the designation preview marks any tile whose mining would leave a roofed tile unsupported with orange stripes. Work givers skip those tiles unless the area is flagged **risky-ok** (a toggle on the Mine tool).
  - When support is lost (mined in risky mode, a prop burnt, a pillar smashed by sappers), affected tiles show a crack overlay and rumble for 40 ticks (2 s), then collapse: they become rubble, colonists on them take 20-45 blunt damage (one wound) and are pushed to the nearest open tile, and items there are destroyed (50%) or buried (50%, recovered by mining the rubble).
  - Cost: at most 81 x 81 support checks per mining event (a 9 x 9 neighbourhood); support distance is cached in `rt.support` and updated locally.
  - The **Carve hall** tool (10.11) plans natural pillars, built pillars or props automatically, so a hall of any size meets the rule and support becomes a choice of look (rough rock columns, carved pillars, timber) rather than a chore. A natural pillar is an unmined rock tile; it costs nothing.
- **Smoothing**: a Masonry job on a rough floor or wall face (+beauty, +room value). **Engraving** on smoothed walls (Art skill, quality-based beauty, the engraving gets a generated subject from the Chronicle: "an engraving of the Ashfall raid of year 2").
- **Rooms in rock**: carved space enclosed by rock and doors is a room like any other (section 7.11). Underground rooms are cool (good for food storage), dark (need lights) and, for Deepforge colonists, liked.
- **Tunnels and raids**: overhead-roofed tiles cannot be entered by flyers (wyverns) and are immune to fire spread from outside. Sapper raiders (section 9.3) dig through rock and walls at 4x slower than a miner.
- **Water**: mining into an underground pool or the river edge does not flood in v1 (water is static). Floodgates (7.8) are a Stage 3 mechanism over static water tiles (open = passable bridge, closed = deep water moat).

### 3.5 Fog and discovery

- **Surface:** explored-only fog (old `fog.js`): each colonist reveals radius 9 around it on the surface, radius 4 under a roof. Once explored, a tile stays explored. Hostiles are only visible in sight of a colonist, a tower or a lit tile.
- **Underground:** rock interiors show as "unknown rock" (a dark textured face with no material) until `known`. Surveying:
  - **Prospect** designation (Mining 6+): the miner taps the rock for 2 game hours and reveals `known` for rock tiles within radius 5.
  - The **Survey Table** (workshop, Lore + Mining) reveals the material and deposits in a radius of 12 around its position, once per Survey bill.
  - Lumenite glows through 3 tiles of rock. Vault walls show when adjacent.
- **Discoveries** fire when first met: first coal, iron, silver, gold, gem kind, cavern, spring, vault, Hollow seep, Duskstone. Each one writes a Chronicle line, shows a toast, and may unlock or discount a tech (section 7.12).

### 3.6 Temperature (`js/game/world/temperature.js`, data `balance.js` TEMP; owner B)

A deliberately simple model. It exists for the Warmth need, food rot, crop growth, the ice house and the "cool underground" cellar.

- **Outdoor base** by season: Thaw 10 C, Highsun 22 C, Ashfall 8 C, Deepcold -6 C; night -4 C; weather offsets (cold snap -15 C, 9.7). Computed from `s.tick`.
- **Underground base**: tiles under overhead mountain roof (roof 3) at depth >= 5 are a constant 12 C; at depth 1-4 the base blends linearly from outdoor to 12 C.
- **Room temperature** = room base (the base of the room's majority tile) + sum of the heat of its heat sources / max(room tiles, 6), clamped to -30..45 C. Heat (in C x tiles): Hearth 600, fireplace 120, forge or bloomery 80, brazier 60, stove 40. So a fireplace warms a 10-tile bedroom by 12 C. An ice house sets its room to -5 C while stocked with ice, or -2 C underground at depth >= 8 without ice.
- **Outdoor tiles** near fires: `rt.heat` (Int8) adds a source's heat / 20 to tiles within radius 3 (the Hearth: radius 6), updated when a heat source changes.
- **Updates**: room temperatures and `rt.heat` are recomputed at the end of any tick in which rooms or heat sources changed (C13), and every 600 ticks for the base.
- **Consumers**: Warmth need (F, 4.4), rot (E, 5.5), plant growth stops below 0 C (B), the ice house and cellars (K, G data).

---

## 4. Colonists

All numbers below live in `js/data/` files (named per subsection), never in logic code.

### 4.1 Identity (`js/data/ancestries.js`, `names.js`, `backstories.js`)

Each colonist: id, name (first + family; syllable tables per ancestry), ancestry, age (18-70 at arrival), body look (skin, hair style 1-8, hair colour, beard 0-4, clothes palette index), a childhood and an adult backstory, 3 attributes, 15 skills, 1-3 traits, needs, mood, health, gear, schedule, priorities, relations, a personal log (last 20 notable events).

**Ancestries** (the old factions; art from `factionart.js` and palettes):

| Ancestry | Look | Package (small on purpose) |
|---|---|---|
| Human | baseline villager figure | +1 extra passion at generation. Adapts: the "Underground" and "Open sky" thoughts are halved. |
| Sylvari | tall, pointed ears, green-brown palettes | Growing and Animals learn x1.25. +4 mood with 5+ plants or trees in view. -3 mood in rooms with Overhead mountain roof ("Stone-pressed"). |
| Deepforge | short, broad, beards common | Mining and Smithing learn x1.25. No underground mood penalty; "Rock and hearth" +3 in carved rooms. Moves at 0.92x speed. |
| Emberkin | grey-green to ash skin, tusks | Melee learns x1.25. Fire damage x0.5. Cold x1.5 (warmth need falls faster). Temper: minor break threshold +4. |

**Backstories:** 16 childhood + 16 adult (for example *Mine-Born*, *Hearthwatch Orphan*, *River Ferryman*, *Grey Survivor*, *Crown Archivist*, *Hedge Healer*, *Reaver Deserter*, *Guild Smith*). Each gives +/- skill offsets (sum about +8), may disable 0-2 work types (for example *Crown Archivist*: no Mine, no Haul), and may grant a trait.

### 4.2 Attributes and skills (`js/data/skills.js`)

Attributes, 1-5 each, rolled to a sum of 8-10: **Might** (carry weight +15%/pt, melee damage, mining speed +3%/pt), **Wits** (learning rate +8%/pt, research, medicine), **Grace** (movement +3%/pt, ranged accuracy, crafting quality).

**Skills (15), level 0-20.**

| Skill | Used by | Speed / effect |
|---|---|---|
| Mining | Mine, prospect | work speed |
| Construction | Build, repair, deconstruct, roofs | speed, build success (failed builds lose 25% material below level 4) |
| Woodcraft | Carpenter, fletcher, charcoal | speed, quality |
| Masonry | Mason, smoothing, stone furniture | speed, quality |
| Smithing | Bloomery, blast furnace, forge, mint | speed, quality |
| Tailoring | Loom, tannery, tailor | speed, quality |
| Cooking | Kitchens, butcher, brewery, smokehouse | speed, quality, food-poison chance |
| Growing | Sow, harvest, tend plants, beekeeping | speed, yield |
| Animals | Tame, train, milk, shear, slaughter | success chance, yield |
| Medicine | Tend, surgery, apothecary | tend quality, speed |
| Melee | Melee combat | hit chance, damage |
| Archery | Bows, crossbows, ballista | accuracy |
| Social | Trade prices, recruiting prisoners, calming breaks | price factor, chance |
| Lore | Research, survey, runes | research speed |
| Art | Sculpture, engraving, jewellery, tapestry | quality |

- **Speed factor** = `0.6 + 0.07 x level` (0.6 at 0, 1.3 at 10, 2.0 at 20), x attribute and trait modifiers, x tool bonus (a carried pick, axe, hammer, sickle: +15% Steel, +10% Iron, +5% Bronze), x light (dark tiles: 0.8).
- **XP.** Each work tick gives 1 XP x passion x learning x ancestry x traits. Learning = 1 + 0.08 x (Wits - 2). Reaching level n from n - 1 costs **`XP(n) = round(1100 x 1.28^n)`**. A **daily soft cap** applies per skill: the first 3,000 work ticks (5 work hours) on that skill each game day count in full, later ones at 20%. The cap counts work ticks before the multipliers, so passions keep their full effect. A colonist on one skill for a 10-hour shift therefore earns 3,600 effective ticks a day: 3,600 XP when keen, about 5,830 when burning with Wits 3. (Stage 2 balance: the full window was 2,400 ticks; at it the bot's first Master came after day 60 on most seeds.) The per-skill daily counter is saved with the skill and resets at midnight (`tick % 14400 == 0`).

| Level | Rank | XP for this level | Cumulative | Days full-time, keen | Days full-time, burning (Wits 3) |
|---|---|---|---|---|---|
| 5 | - | 3,780 | 12,250 | 3.4 | 2.1 |
| 6 | Apprentice | 4,838 | 17,088 | 4.7 | 2.9 |
| 10 | Journeyman | 12,987 | 54,339 | 15 | 9.3 |
| 15 | Master | 44,621 | 198,955 | 55 (year 2) | 34 (end of year 1) |
| 20 | Grandmaster | 153,318 | 695,853 | 193 (year 5) | 119 (year 3) |

  Colonists arrive with their best skill around 6-10, so the first Master usually appears late in year 1 and the first Grandmaster in years 3-4. Targets checked by the bot balance report (14.4): first Master between day 25 and 60, first Grandmaster between day 110 and 200, no level 20 before day 100.
- **One work unit everywhere:** every `work` value in data (mining, construction, recipes, research) is in game minutes at speed factor 1.0. One game minute is 10 ticks.
- **Passions:** none (x0.5 XP), **keen** (x1.0 XP, +1 joy/hour while doing it), **burning** (x1.5 XP, +3 joy/hour, -4 mood if not done for 3 days). Generation gives 2-4 passions.
- **No skill decay.** It feels bad on a phone; the cap is time.
- **Skill perks** (33, data `perks.js`): in the six key skills the player picks 1 of 2 perks at levels 10 and 20; each of the other nine skills grants one signature perk at 15. Every perk adds an action or changes a rule, for example *Cave Sense* (Mining 10: sees cracks 2 h before a cave-in) or *Field Surgeon* (Medicine 10: tends the downed where they lie). All other levels give only the plain speed and quality curve, with no letter. This is the colonist-level specialisation (section 8.1).

### 4.3 Traits (24, `js/data/traits.js`; 1-3 per colonist, with exclusive pairs)

| Trait | Effect |
|---|---|
| Hardworking / Lazy | work speed +15% / -15% |
| Quick Learner / Slow | XP x1.4 / x0.7 |
| Steady / Volatile | break thresholds -5 / +6 |
| Cheerful / Gloomy | base mood +6 / -6 |
| Brave / Craven | never flees, +10% melee / flees when hurt 30%, will not be drafted at mood < 40 |
| Night Owl | works at night with no penalty, -6 mood working in daylight hours |
| Firekeeper | +8 mood near a lit Hearth or brazier, never starts fires on a break |
| Dark-sighted | no work penalty in darkness, no dread from darkness |
| Fearful of the Dark | dread x2 in darkness |
| Glutton | food need falls x1.4, binge break more likely |
| Ascetic | ignores comfort and beauty thoughts, -4 if bedroom is Fine or better |
| Greedy | wants a Fine+ bedroom or -8 mood |
| Kind | social opinions gain x1.5, others get +3 from chats |
| Abrasive | insults: others' opinion -5 per chat |
| Green Thumb | Growing yield +20% |
| Iron Stomach | no food poisoning, can eat raw food without the thought |
| Tough | damage taken x0.75 |
| Delicate | damage taken x1.25, heals x1.2 |
| Hollow-Touched | lives through a Grey Taint once; Hollow do 20% less damage; -4 mood near the Hearth (it feels too warm) |
| Craftmaster | quality roll +1 step 20% of the time |
| Pyromaniac | +joy near fire; on breaks starts fires |
| Beauty-Lover | beauty thoughts x2 |
| Loner | never gets "Lonely", chats give no joy, -3 mood in dining halls of 8+, +3 alone in an owned bedroom |
| Devout | +joy at shrines and temples x2, prays as joy |

### 4.4 Needs (`js/data/needs.js`)

Five needs, each 0-100, updated for each colonist every 20 ticks (`tick % 20 == id % 20`) with fixed-point integers to keep determinism.

| Need | Falls by | Restored by | Mood thoughts |
|---|---|---|---|
| Food | about 33/day | meals; raw food (with thought) | Hungry -6, Ravenous -12, Starving -20 plus health loss |
| Rest | about 66/16 h awake | sleep (bed quality x), in bed 100% speed, on ground 60% | Tired -4, Exhausted -10, collapses at 0 |
| Joy | about 30/day | joy activities by kind (chat, ale, games, prayer, music, sparring, bath, looking at art, a feast); variety bonus; a chat with a friend counts double | Bored -6, Joyless -12 |
| Warmth | below 10 C (3.6), faster the colder it is; apparel insulation slows it | warm rooms, fires, the Hearth radius, clothing | Chilly -4, Freezing -12 plus hypothermia wound. The bar hides while the colonist's tile is above 10 C. |
| Light ("Dread") | darkness, Hollow nearby, corpses in the dark | lit tiles, the Hearth, prayer | Uneasy -3, Dread -10, Terror -18 (also break chance) |

**Folded into thoughts (no bars):**
- **Comfort and Beauty** become room and furniture thoughts: the room tier thoughts (7.11), "Slept on the ground" -3, "Sat at a fine table" +2, "Ugly surroundings" -2 to -6 (filth, blood, rubble, corpses or blight in view, checked once per game hour), "Beautiful hall" +2 to +6. Ascetic and Beauty-Lover modify these thoughts.
- **Social** becomes relationship thoughts (4.7) and a Joy kind: "Lonely" -5 after 3 days without a chat.

The colonist Needs tab shows at most 5 bars (4 when warmth is irrelevant), with the same depth as before.

### 4.5 Mood and breaks (`js/data/thoughts.js`, `js/game/people/mood.js`)

- Mood (0-100) = 50 + base (traits) + sum of active thoughts, smoothed toward the target every 60 ticks by a quarter of the gap (rounded away from zero, at least 1). A -20 shock lands three-quarters of the way within about 30 game minutes (15 s at 1x) and fades the same way.
- Thoughts are data: `{ id, label, value, durationH, stack: {max, decay}, tags }`, about 120 of them, in groups: needs, rooms (bedroom tier, dining tier, shared bedroom, slept in barracks), food (fine meal, feast, raw food, ate without a table), events (friend died -12 x 10 days, colonist died -4, saw a corpse -3, buried someone +2, raid repelled +6 x 2 days, captured a Lord's Ember +15 x 10 days), work (passion work +), environment (underground for Sylvari, lit Hearth +3, Hearth cold -15), social (opinions), wealth ("Hold of Renown" by tier +2 to +8), festival +8.
- **Thresholds:** <= 35 minor break risk, <= 20 major, <= 8 extreme (thresholds shifted by traits). Check every 600 ticks: chance per hour = 2% (minor), 4% (major), 8% (extreme), scaled by how far below.
- **Breaks** (data `breaks.js`, each 4-16 game hours):
  - Minor: Sulk (wanders the hold, no work), Comfort binge (eats 2 meals or drinks 3 ales), Hide in room.
  - Major: Tantrum (smashes 1-3 items or furniture), Dark wander (walks into unlit areas, dread grows), Insult spree (opinions drop).
  - Extreme: Hollow-whispered (walks toward the nearest Hollow seep or the map edge and must be arrested or talked down), Catatonic (bed rest 2 days), Firestarter (Pyromaniac only).
  - A colonist with Social 8+ can **talk down** a break in progress (a job at the breaker; chance by Social and opinion). A drafted colonist can arrest a dangerous one (they are confined to their bed for 1 day).
- **Inspirations** at mood >= 85 for 12 h: chance 3%/day: *Fervour* (work speed x1.5 for 2 days), *Inspired trade* (the next trade 20% better), *Inspired teaching* (nearby colonists learn x2 for 1 day). *Inspired craft* is replaced by Ember-touched.
- **Ember-touched** (`js/game/people/embertouch.js`, data `js/data/embertouch.js`, owner F). An original take on a seized craftsman, and the strongest single story generator in the game.
  - *Trigger*: a colonist with Smithing, Woodcraft, Masonry, Tailoring, Art or Cooking at 6+, while no other colonist is Ember-touched. Checked once per game day: 1.5%, doubled in the 3 days after a major event (a raid repelled, a friend's death, a Lord defeated), never below mood 30, at most once per 20 game days per colony.
  - *Claim*: the colonist drops other work, claims the nearest workshop for that skill (with none, they sit by the Hearth and the letter asks for one within 2 days) and **demands 2-4 materials**, rolled from a table by skill and tier. One is always **from the deep**: silver, a cut gem, Duskstone blocks, lumenite dust, wyrm scale or a Heartstone shard, chosen among those the map holds deeper than anything mined so far, so the demand pushes digging. The **demand card** shows each material as a 44 pt icon with a found or missing mark; haulers deliver what exists at Critical priority.
  - *Met within 5 game days*: 1-2 days of work produce a **named artifact**: quality Masterwork or Legendary, value x3, a name from `text/artifacts.js` and a subject from the Chronicle ("Ironmourn, a Duskstone throne carved the season Hal died"). The skill gains a level, the colonist gets +12 mood for 10 days, a Chronicle line is written, and the room holding the artifact gives "Treasure of the hold" +3.
  - *Not met*: "Unmade work" -5, growing by 5 per day; on day 5 a major break (a Tantrum at the workshop, or Hollow-whispered if dread is high), and a 10% chance the colonist gains the Hollow-Touched trait.
  - It reuses bills (a locked bill on the claimed bench), items, hauling priority and the break system; the letter and the demand card are the only new UI.

### 4.6 Health (`js/game/people/health.js`)

Body parts: head (25 HP), torso (40), left/right arm (20), left/right leg (25). A **wound** = `{part, kind (cut, stab, blunt, burn, bite, frost, taint), dmg, bleed, tended (0-1 quality), infected (0-1), age}`.
- Part HP 0: arm or leg destroyed (permanent, capability lost: arm -50% manipulation, leg -50% move), head or torso destroyed = death.
- **Blood** 100: bleed sum per hour lowers it; < 40 downed, 0 dead. Tending stops bleeding.
- **Pain** = sum of untended damage; > 80 downed. Downed colonists are rescued to a bed by the nearest Doctor or any colonist (job "Rescue").
- **Tending** (Medicine job): quality = skill factor x medicine (none 0.5, bandage 0.75, herbal poultice 1.0, healing salve 1.3) x bed (infirmary bed +0.15) x room cleanliness. Untended or poorly tended wounds roll infection after 12 h; infection grows unless tended daily, kills at 1.0 in about 4 days.
- **Grey Taint** (from Hollow wounds, 15% per wound): rises over 3 days. Cured by **Ember Tonic** or a day of rest near a level-2+ Hearth plus prayer at a Temple. At 100, the colonist **turns** into a Husk (telegraphed: alerts at 50 and 80, the portrait greys). This is the main emergent Hollow horror.
- Illness (incidents): Grey Cough (plague: contagious in shared rooms, immunity race), Rot Fever (from spoiled food), Food poisoning (cooking skill).
- Surgery (Stage 3): remove taint early (Medicine 10, sleeping draught), fit a **Deepforge iron limb** (smithed prosthetic, restores 80%).
- Healing: 1 HP per part per 4 game hours in bed (x2 in an infirmary with tended wounds). Scars: 10% of large wounds leave a scar (-2% part capacity, a "scar" note in the log).
- **Ageing** (setting, default on): +1 year per game year (40 days). From 65, 2%/year frailty (permanent -10% speed). Death of old age possible from 80. Children and births are an optional Stage 4 feature (section 4.9).

### 4.7 Relationships (light, `js/game/people/social.js`)

- Sparse opinions: `s.rel` maps pair key `a*1024+b` (a < b) to `{op: -100..100, kind}`. Kinds: kin (generated with arrivals), friend (op >= 40), rival (op <= -40), lover, spouse.
- Chats happen when two colonists are within 3 tiles doing joy or eating (chance per game hour). Each chat: opinion +-1..5 by traits (Kind, Abrasive), shared ancestry +1, shared passion +1.
- Lovers form at op >= 60 (both adults, chance per day 2%); a **wedding** event needs a Great hall or Temple and gives +10 to everyone attending. Spouses want a double bed (thought).
- Death of a friend, lover or kin: -12/-18/-15 for 10 days. Rivals in the same room: -3.
- UI: the colonist Social tab lists the 5 strongest relations.

### 4.8 Death and graves

- The dead leave a corpse item. Unburied corpses rot (beauty -10, dread in the dark) and **can rise as Husks at night** if left unburied in darkness for 2 days (a Hollow rule that makes burial matter). Graves (burial zone + grave/sarcophagus/crypt) give "laid to rest" +2 to friends; a memorial statue lists names.
- Every death writes a Chronicle entry with cause and killer.

### 4.9 Arrivals (`js/data/incidents.js`, positive group)

| Source | When | Notes |
|---|---|---|
| Starting band | new colony | 3 colonists (choose ancestry mix; reroll each up to 5 times) |
| Wanderer joins | every 8-14 days if beds free and average mood >= 45 | 1 colonist, accept or refuse in a letter |
| Migrant group | on tier-up and in Thaw | 2-4, scaled by tier |
| Refugees | event: "Refugees fleeing reavers": accept and a raid follows in 1-2 days | 2-5, often wounded |
| Prisoner recruitment | downed raiders captured (rescue to a prison bed) | Social job "Persuade" each day; Grey Pilgrims cannot be recruited |
| Wandering hero | rare, tier Village+ | one of the 12 hero classes as a colonist with 2 skills at 12+ and a heroic trait; art from `heroart.js` |
| Births | Stage 4, optional setting (default off) | spouses in a Fine+ bedroom; children are non-working for 1 game year, then teens with half work speed |

Caps: soft cap 30 colonists (wanderers and migrants stop being offered), hard cap 40.

---

## 5. Work: jobs, hauling, stockpiles, production

### 5.1 Work types and Roles (`js/data/worktypes.js`, `js/data/roles.js`)

13 work types in fixed order (the order is the tie-break inside one priority number, as in RimWorld):

| # | Work type | Jobs | Skill |
|---|---|---|---|
| 1 | Care | tend, rescue, surgery, feed patients, prisoners, talk down breaks | Medicine, Social |
| 2 | Animals | hunt, tame, train, milk, shear, slaughter, feed animals | Animals (Archery for hunting) |
| 3 | Cook | kitchens, butcher, smokehouse, brewery, casks, mill | Cooking |
| 4 | Build | construct, repair, deconstruct, roof, install furniture | Construction |
| 5 | Grow | sow, harvest crops, tend beehives | Growing |
| 6 | Mine | mine, prospect | Mining |
| 7 | Chop | chop trees, gather wild plants | Growing (yield) |
| 8 | Smith | bloomery, furnace, forge, mint | Smithing |
| 9 | Craft | carpenter, mason, potter, glass, fletcher, smoothing | Woodcraft, Masonry |
| 10 | Tailor | tannery, loom, tailor | Tailoring |
| 11 | Art | sculpt, engrave, jeweller | Art |
| 12 | Lore | research, survey table, runes | Lore |
| 13 | Haul | haul to stockpile, refuel lights and the Hearth, load workshops, clean filth | - |

(Merged from the first draft's 18: Brew into Cook, Clean into Haul, Warden into Care, Hunt into Animals; Firewatch is no longer a work type.)

**Fire is an automatic emergency.** A fire inside the home area interrupts every able, non-drafted colonist within 25 tiles who is not in a break or doing Care (after urgent needs, before work); haulers anywhere on the map join. It ends when the fire is out.

**Roles (the default UI).** A role is a data preset of priorities: `{ id, name, icon, prio: { mine: 1, haul: 3, build: 3 }, soldier: false }`. Each colonist has a primary role and an optional second role. The priority array is computed, never typed: the primary's values, then the second role's 1s become 2s and its 2s become 3s (keeping the better value), every other enabled work type 4, and work types the backstory disables stay off. Care is set to 2 for anyone with Medicine 6+ unless the player opts that colonist out.

| Role | Key work (priority 1) | Also |
|---|---|---|
| Miner | Mine | Haul 3, Build 3 |
| Builder | Build | Haul 2, Chop 3 |
| Smith | Smith | Mine 3, Haul 3 |
| Crafter | Craft, Tailor | Haul 3 |
| Grower | Grow, Chop | Cook 3 |
| Cook | Cook | Grow 3, Haul 3 |
| Herder | Animals | Grow 3 |
| Doctor | Care | Lore 3, Cook 3 |
| Scholar | Lore | Art 3 |
| Artisan | Art | Craft 2 |
| Hauler | Haul | Build 3, Chop 3 |
| Soldier | soldier duty on (8.1) | Haul 3, Build 3; trains at the yard as joy |
| Generalist | every work type at 3 | - |

New colonists get a suggested role from their best passion skill (the arrival letter shows it with a Change button). Changing a role is one tap on the peek card (10.1). The **Advanced** toggle (setting, or a switch on the Work tab) shows the full priority grid (10.4); editing a cell marks that colonist "Custom". Priorities per work type stay 0 (off) or 1 (highest) to 4, and the sim only ever reads the computed array.

### 5.2 Schedule

Per colonist, 24 hourly cells: Sleep, Work, Joy, Any. Presets: Day (sleep 22-06, joy 18-21), Early (sleep 20-04), Night watch (sleep 10-18). Night Owl colonists default to Night watch.

### 5.3 Job selection (`js/game/work/think.js`)

A colonist "thinks" when idle, when a job ends or fails, and every 60 ticks during interruptible jobs. At most **6 thinks per tick** colony-wide (a FIFO queue of colonist ids, **saved**: C13), so 40 colonists re-evaluate within 7 ticks.

Think order:
1. **Forced**: drafted orders; break behaviour; downed.
2. **Urgent needs**: Food < 25 (eat), Rest < 15 (sleep), Warmth < 20 (seek warmth), Dread < 15 (seek light), bleeding (go to bed if a doctor exists).
3. **Schedule**: Sleep hours (Rest < 90: sleep), Joy hours (Joy < 80: joy activity).
4. **Work**: for p = 1..4, for each work type in fixed order with priority p, ask its work givers for a job. The first job found is taken.
5. Fallback: satisfy any need below 60, else wander near the Hearth (idle: counted for the idle alert).

**Work giver contract** (`js/game/work/givers/*.js`, registered through `BUS.workGivers`):
```js
{ id: 'mine', work: 'mine',
  // cheap candidate enumeration from an index, nearest-first, at most k
  candidates(s, c, k) -> Array<target>,
  // validity check at the moment of taking it (reserved? reachable? forbidden? skill min?)
  valid(s, c, target) -> boolean,
  // build the job: a list of toils
  make(s, c, target) -> Job }
```
- **Indexes** (maintained by the systems that change them, in `s.rt`): designation sets per type bucketed by 16 x 16 cluster; items per kind (and per category) bucketed by cluster; blueprints and frames; workbenches with active bills; plants needing sow/harvest per grow zone; fires; patients.
- **Nearest-first** search walks clusters outward from the colonist (ring order), gives up after 12 valid-looking candidates, and rejects any target outside the colonist's reachable set (O(1) via the region labels, 12.3).
- Candidates are ranked by **region-graph distance**: regions are split at 16 x 16 cluster borders, and a BFS over region links from the colonist's region (cached for the duration of one think) gives a path-length estimate, plus the straight distance inside the last region. A target behind a winding tunnel is therefore not taken as near. The best skill-allowed candidate is reserved, then the path is requested (`requestPath`, 12.3). If the path fails, the target goes into the colonist's **unreachable memory** for 600 ticks (`[targetKey, untilTick]` pairs, saved) and the think continues next tick.

**Jobs** are a toil list: `{type, target, toils:[...], i, work, haul:{itemId,count}}`. Toils: `goto`, `reserve`, `pickup`, `carry`, `drop`, `work(n)`, `useBench`, `wait`. Jobs are saved with the colonist (short keys), together with the current path (a tile-index list) and the path cursor, so save and restore mid-job continues identically (the determinism gate checks this).

### 5.4 Reservations (`js/game/work/reserve.js`)

- One table `s.rt.res`: Map from an integer target key (tile index, `1e6 + itemId`, `2e6 + buildingId`) to colonist id plus count for stack partials. It is **exactly a function of the saved jobs** and is rebuilt from them at load.
- The only writers are `claim(job)` at job start and `releaseAll(job)`, and every exit path (end, fail, interrupt, death, draft, downed, break, despawn, the target deconstructed or destroyed) goes through one `endJob(s, col, reason)`. There is **no periodic sweep**: a leak is a bug. In debug builds and in the determinism tool, the end of every tick asserts that `rebuildFromJobs(s)` equals the live table; a mismatch fails the gate and names the leaking job.
- Workbenches: 1 user. Beds: owner by assignment. Item stacks: reservable by count, so two haulers can split one stack.

### 5.5 Items and stacks (`js/game/work/items.js`, `js/data/items.js`)

- **One stack per tile** on the ground, or up to 3 on a Shelf. An item stack = `{id, k (kind), m (material), q (quality), n (count), hp, x, y, f (forbidden), age}`. Unique items (weapons, apparel, furniture, art) have `n = 1` and may carry a name and a maker id.
- `s.items` is an array with free-slot reuse: a new stack always takes the **lowest free index** (a min-heap rebuilt from the null slots at load), so ids after a load match the live game. `rt.itemAt[tile]` indexes it. Stack limits per kind (wood 75, stone blocks 75, rough stone 10 as a stone pile, ore 50, ingots 75, meals 10, gems 25, coins 500).
- **Rot**: food has a shelf life (days) at 20 C, halved above 25 C, x0.25 below 14 C (cool underground rooms), frozen (no rot) below 0 C (Deepcold outdoors or an ice house). Temperatures come from 3.6.
- **Colony stock** (the HUD numbers) is a derived cache: totals of non-forbidden items in stockpiles and on shelves, per kind, updated incrementally on haul/consume.

### 5.6 Stockpiles and hauling (`js/game/work/stockpiles.js`)

- A stockpile zone has: tiles, **priority** (Low, Normal, Preferred, Critical), a **filter** (category tree from `items.js`: Raw > Wood/Stone/Ore/Clay/Sand; Materials > Blocks/Ingots/Cloth/Leather/Glass; Food > Raw/Meals/Drink/Preserved; Medicine; Apparel; Weapons; Armour; Furniture; Art; Gems; Coins; Corpses; Chunks), a quality range and a material filter. **Preset-first**: a new stockpile is created from a preset ("All", "Food store", "Raw", "Workshop goods", "Armoury", "Dump"); the category tree opens only from "Customise".
- **Haul job** arises when a stack is (a) outside any stockpile that accepts it, or (b) in a stockpile with lower priority than an accepting one with free space. Hauling chooses the **nearest best-priority accepting zone** with a per-filter-group **zone distance field**: a multi-source BFS seeded from every tile of every zone that accepts the group and still has a free cell. Inside the chosen zone the cell comes from the zone's **free list** (tile indexes sorted by distance to the zone's door side). The field changes only when a zone is created, edited, becomes full or stops being full, so filling one cell never makes it stale; it is rebuilt at the end of the tick in which that happened (C13). At most 8 filter groups exist (the presets, plus custom filters hashed into the closest group).
- **Rough stone** is hauled only when needed (per-colony setting: Never / When needed (default) / Always). "When needed" means a bill or a construction frame that needs stone fetches it from the nearest pile. Stone piles within 20 tiles of a Mine headframe or a Surface quarry count as stored, both for the HUD stock and for "until n" bills.
- Carry: a colonist carries one stack up to their capacity (35 mass x Might factor). A haul toil may top up with more of the same kind and material within 3 tiles.
- Workshops pull ingredients themselves (the crafter fetches them as part of the bill job), but each workbench has an optional **input shelf** link: "Haul ingredients here" (a small stockpile next to it with the bill's filter), which halves crafting walks.
- Forbid/Allow (tool and per item): forbidden items are never hauled or used.

### 5.7 Bills (`js/game/work/bills.js`)

A workbench holds up to 10 bills: `{recipe, mode: 'count' n | 'until' n | 'forever', paused, ingredients (filter subset), minSkill, maxSkill, radius (tiles to fetch from, default 999: anywhere; Stage 2 balance, it was 30), store: 'best' | stockpileId, quality: min}`. "Until n" counts colony stock (5.5). Bills run top to bottom; the first bill that has ingredients in reach is worked.

**Smart default bills** (`autoBills` on the bench def). Building a bench adds its defaults at once: Campfire and Hearthstove "Simple meal, until 2 per colonist"; Mason "Blocks, until 100"; Bloomery "Smelt iron while ore is stocked, until 60 ingots"; Butcher "Butcher, forever, while carcasses exist"; Apothecary "Herbal poultice, until 2 per colonist"; Tailor "Bandages, until 10". The bill sheet shows recipe, mode and count; **More** reveals radius, skill range, store target, quality floor and the ingredient filter.

**Auto-bills for furniture** (D8): placing a furniture ghost with no matching item in stock adds a `count 1` bill at the nearest capable workbench, marked as "for blueprint", and the finished item is hauled to the ghost and installed.

### 5.8 Quality (`js/data/quality.js`)

Six levels: **Crude, Plain, Fine, Superior, Masterwork, Legendary**. Roll = skill level + `N(0, 2.5)` (deterministic RNG) + workshop tier bonus (+1 per tier above I) + traits/perks/inspiration. Bands: < 3 Crude, < 8 Plain, < 13 Fine, < 17 Superior, < 20 Masterwork, >= 20 Masterwork (and 1 in 10 Legendary if level >= 16). Effects: value x0.5/1/1.5/2.5/5/10, beauty x0.5/1/1.5/2/3/5, comfort and armour x0.8/1/1.1/1.2/1.35/1.5, weapon damage x0.85/1/1.1/1.2/1.3/1.45. A Masterwork or Legendary item gets a name and a Chronicle line.


---

## 6. Items and production

### 6.1 Materials (`js/data/materials.js`)

Materials are a property of items, walls, floors and furniture. Columns are multipliers on the base def.

| Group | Material | HP | Work | Beauty | Value | Notes |
|---|---|---|---|---|---|---|
| Wood | Wood | 1.0 | 1.0 | 1 | 1 | flammable |
| Wood | Elderwood (old trees) | 1.5 | 1.2 | 3 | 3 | flammable, slow |
| Wood | Capwood (giant glowcap, caverns) | 0.7 | 0.8 | 1 | 1 | not flammable, faint light |
| Stone | Sandstone / Limestone | 1.2 / 1.3 | 1.0 | 1 | 1 | |
| Stone | Granite / Slate | 1.7 / 1.5 | 1.4 | 1 / 2 | 1.2 | |
| Stone | Basalt | 1.9 | 1.6 | 1 | 1.3 | |
| Stone | Marble | 1.2 | 1.3 | 4 | 2 | |
| Stone | Duskstone | 2.2 | 1.9 | 2 | 2.5 | Shades cannot phase through Duskstone walls |
| Metal | Copper / Bronze | 0.9 / 1.2 | 1.0 | 1 | 2 / 3 | |
| Metal | Iron / Steel | 1.4 / 2.0 | 1.2 / 1.4 | 1 | 3 / 6 | |
| Metal | Silver / Gold | 0.8 / 0.7 | 1.0 | 4 / 6 | 10 / 20 | silver weapons x1.3 vs Hollow |
| Metal | Lumensteel (steel + lumenite) | 2.4 | 1.8 | 5 | 30 | x1.5 vs Hollow, lit 1-tile glow |
| Cloth | Linen / Wool / Spidersilk | 1 / 1.1 / 1.8 | 1 | 1 / 1 / 3 | 1 / 1.3 / 5 | wool warm x1.5, silk armour x1.3 |
| Hide | Leather / Fur | 1.2 / 1.0 | 1 | 1 | 1.5 / 2 | fur warm x2 |
| Gem | Amber, Garnet, Sapphire, Emerald, Ruby, Heartstone | - | - | 6-20 | 15-120 | Heartstone burns as Hearth fuel for 10 days |

### 6.2 Item kinds (`js/data/items.js`, about 95)

| Category | Kinds |
|---|---|
| Raw | wood (by material), rough stone (by material), ore (copper, tin, iron, silver, gold, lumenite), coal, clay, sand, rough gem (6), hide, pelt, wool, flax fibre, cave silk, herbs, ash-salt, beeswax, tallow, bone |
| Materials | stone block (by stone), ingot (copper, tin, bronze, iron, steel, silver, gold, lumensteel), charcoal, brick, glass, linen, wool cloth, spidersilk cloth, leather, fur, cut gem (6), lumenite dust, iron bands |
| Food raw | grain, hearthroot (tuber), greens, berries, apples, glowcap, meat, fish, eggs, milk, honey, flour |
| Food made | simple meal, fine meal, feast (lavish), bread, stew (pot of 4), trail ration, smoked meat, smoked fish, pickles, cheese |
| Drink | ale wort, ale, mead, berry wine |
| Medicine | bandage, herbal poultice, healing salve, ember tonic, sleeping draught |
| Apparel | tunic, robe, cloak, fur mantle, hood, leather jerkin, gambeson, boots |
| Armour | leather cap, iron helm, steel helm, mail shirt, plate cuirass, wooden shield, iron shield, tower shield |
| Weapons | club, dagger, spear, axe, sword, maul, halberd, shortbow, longbow, crossbow |
| Tools | pick, felling axe, hammer, sickle, tongs, needle set, surgeon's kit |
| Furniture (installable) | about 40 kinds, section 7 |
| Art | small statue, grand statue, figurine, tapestry, ring, amulet, circlet, Ember Crown |
| Trade | coins, copied book, fine pottery, glass vials, rune tablets |
| Special | corpse (colonist, raider, animal, Hollow residue "greyash"), Lord's Ember (3), lore tablet, chunk of rubble |

### 6.3 Production chains

```
Trees ---- chop ---> Wood -----------+---> Carpenter: furniture, shields, clubs, bows (Fletcher)
                         \-> Charcoal Kiln -> Charcoal --+
Rock ----- mine ---> Rough stone -> Mason -> Stone blocks -> walls, floors, stone furniture, Sculptor art
Ore veins - mine --> Ore + (Coal|Charcoal) -> Bloomery -> Ingots (Cu, Sn, Fe, Ag, Au); Cu+Sn -> Bronze
                                         Iron + 2 Charcoal -> Blast Furnace -> Steel; Steel + Lumenite -> Lumensteel
Ingots ----------------------------------> Forge -> tools, weapons, armour, iron bands, prosthetics
Clay ----> Potter's Wheel -> pots, jars ; Kiln: clay + fuel -> bricks, fine pottery
Sand + Charcoal -> Glassworks -> glass -> windows, lanterns, vials, lenses
Gems ----> Jeweller -> cut gems -> rings, amulets, circlets, the Ember Crown, mosaic floors, Waystones
Animals -> hunt/slaughter -> Butcher -> meat, hide, pelt, bone, tallow
Hides ---> Tannery -> leather, fur -> Tailor -> jerkins, cloaks, mantles, boots, caps
Flax/wool/silk -> Loom -> cloth -> Tailor -> tunics, robes, gambesons, tapestries, carpets, banners, bandages
Grain ---> Mill -> flour -> Hearthstove -> bread ; Grain -> Brewery -> wort -> Fermenting Cask (4 days) -> ale
Honey/berries -> Brewery -> mead/wine wort -> Cask
Raw food -> Campfire / Hearthstove -> meals (simple, fine, feast, stew, rations)
Meat/fish -> Smokehouse -> smoked (shelf life x6) ; greens + jar -> Potter's pickles
Herbs (+ beeswax, honey, lumenite dust) -> Apothecary -> poultice, salve, ember tonic, draught, candles
Lumenite ore -> Runeforge -> lumenite dust, runes, Lumen lamps
Silver/Gold ingots -> Mint -> coins (trade)
```

### 6.4 Recipes (`js/data/recipes.js`; work in game minutes at speed 1.0)

Recipe schema: `{ id, bench: [ids], in: [{k|cat, n, mat?}], out: [{k, n, matFrom?}], skill, work, minSkill, quality: bool, tech, spec?, xp }`. `work` is game minutes at speed factor 1.0, the one work unit used everywhere (4.2). `spec` names the workshop specialisation that unlocks it (8.2). `matFrom` copies the material of an ingredient (a granite table from granite blocks).

| Bench | Recipe | In -> Out | Skill | Work |
|---|---|---|---|---|
| Campfire | Simple meal | 5 raw food -> 1 meal | Cooking | 30 |
| Campfire | Roast | 4 meat -> 1 meal (poor) | Cooking | 20 |
| Hearthstove | Simple meal | 5 raw -> 1 | Cooking | 25 |
| Hearthstove | Fine meal | 4 meat/fish + 4 plant -> 1 | Cooking 6 | 40 |
| Hearthstove | Feast | 6 meat + 6 plant + 2 honey/cheese -> 1 (joy +) | Cooking 10 | 60 |
| Hearthstove | Stew pot | 12 raw -> 4 simple meals | Cooking 4 | 60 |
| Hearthstove | Bread | 6 flour -> 4 bread (shelf life 8 days) | Cooking | 30 |
| Hearthstove | Trail rations | 4 meat + 4 grain -> 4 rations (shelf life 60 days) | Cooking 5 | 50 |
| Hearthstove | Cheese | 10 milk -> 4 cheese | Cooking 4 | 40 |
| Butcher's table | Butcher animal | carcass -> meat, hide/pelt, bone, tallow (by species) | Cooking | 40 |
| Smokehouse | Smoke meat / fish | 10 meat or fish + 2 wood -> 10 smoked | Cooking | 120 (unattended after loading) |
| Mill (windmill/watermill) | Grind | 10 grain -> 8 flour | Cooking | 20 |
| Brewery | Ale wort | 12 grain -> 1 wort (6 servings) | Cooking | 40 |
| Brewery | Mead wort | 8 honey -> 1 wort | Cooking 4 | 40 |
| Brewery | Berry wine wort | 12 berries/apples -> 1 wort | Cooking 4 | 40 |
| Fermenting cask | Ferment | wort -> 6 drinks after 4 days | - | load/unload |
| Potter's wheel | Jar | 4 clay -> 1 jar | Craft | 30 |
| Potter's wheel | Fine pottery | 6 clay -> 1 (trade, quality) | Craft 6 | 60 |
| Potter's wheel | Pickles | 1 jar + 8 greens -> 8 pickles (shelf life 40) | Cooking | 20 |
| Kiln | Bricks | 10 clay + 1 fuel -> 20 bricks | Craft | 40 |
| Charcoal kiln | Charcoal | 10 wood -> 6 charcoal | Craft | 60 (unattended) |
| Carpenter | Bed / Double bed / Bunk | 35 / 60 / 50 wood | Woodcraft | 120 / 180 / 160 |
| Carpenter | Table (2x1) / Long table (3x2) | 30 / 60 wood | Woodcraft | 90 / 150 |
| Carpenter | Chair / Stool / Bench | 15 / 8 / 20 wood | Woodcraft | 45 / 25 / 50 |
| Carpenter | Wardrobe / Shelf / Chest | 40 / 25 / 30 wood | Woodcraft | 100 / 60 / 70 |
| Carpenter | Wooden prop (support) | 20 wood | Woodcraft | 40 |
| Carpenter | Club / Wooden shield | 10 / 20 wood | Woodcraft | 30 / 40 |
| Carpenter | Cradle | 25 wood | Woodcraft | 70 |
| Fletcher | Shortbow / Longbow | 20 / 35 wood | Woodcraft 3 / 8 | 60 / 120 |
| Fletcher | Crossbow | 30 wood + 10 iron | Woodcraft 8 | 150 |
| Mason | Cut blocks | 1 rough stone -> 10 blocks | Masonry | 30 |
| Mason | Stone table / chair / bench | 40 / 20 / 30 blocks | Masonry | 120 / 60 / 80 |
| Mason | Pillar (support) | 30 blocks | Masonry | 90 |
| Mason | Sarcophagus | 60 blocks | Masonry 4 | 160 |
| Mason | Millstone | 40 blocks | Masonry | 80 |
| Mason | Waystone | 60 blocks + 1 rough or cut gem | Masonry 6 | 240 |
| Sculptor | Small statue | 40 blocks or 10 ingots or 30 wood | Art | 240 |
| Sculptor | Grand statue (2x2) | 150 blocks or 40 ingots | Art 8 | 720 |
| Sculptor | Figurine (trade) | 10 bone or 5 blocks | Art | 60 |
| Bloomery | Smelt copper / tin / iron | 10 ore + 4 coal or charcoal -> 8 ingots | Smithing | 60 |
| Bloomery | Smelt silver / gold | 10 ore + 4 fuel -> 6 ingots | Smithing 6 | 80 |
| Bloomery | Bronze | 6 copper + 2 tin -> 8 bronze | Smithing 3 | 40 |
| Blast furnace | Steel | 8 iron + 8 charcoal -> 6 steel | Smithing 8 | 100 |
| Blast furnace | Lumensteel | 6 steel + 4 lumenite dust -> 4 | Smithing 14 | 160 |
| Forge | Tools: pick, felling axe, hammer, sickle, tongs | 10-15 metal | Smithing | 80-100 |
| Forge | Dagger / Spear / Axe / Sword / Maul / Halberd | 8 / 12 / 14 / 18 / 25 / 30 metal (+ wood for hafts) | Smithing 2-10 | 60-200 |
| Forge | Iron helm / Steel helm | 15 metal | Smithing 4 / 9 | 120 |
| Forge | Mail shirt / Plate cuirass | 40 / 70 metal | Smithing 6 / 12 | 240 / 400 |
| Forge | Iron shield / Tower shield | 20 / 35 metal + 10 wood | Smithing 4 / 8 | 120 / 200 |
| Forge | Iron bands | 10 iron -> 4 bands | Smithing | 40 |
| Forge | Iron limb (prosthetic) | 25 iron + 5 leather | Smithing 10 | 300 |
| Forge | Surgeon's kit / Needle set | 6 steel / 4 iron | Smithing 6 / 2 | 60 / 40 |
| Tannery | Tan leather / Cure fur | 2 hide -> 1 leather; 1 pelt -> 1 fur | Tailoring | 60 (unattended 1 day) |
| Loom | Linen / Wool cloth / Spidersilk | 10 flax / 10 wool / 10 cave silk -> 8 cloth | Tailoring | 60 / 60 / 120 |
| Tailor | Tunic / Robe / Hood / Boots | 25 / 40 / 10 / 15 cloth or leather | Tailoring | 90 / 140 / 40 / 60 |
| Tailor | Cloak / Fur mantle | 40 cloth / 30 fur | Tailoring 4 | 140 |
| Tailor | Leather jerkin / Leather cap / Gambeson | 35 leather / 10 leather / 50 cloth | Tailoring 4-6 | 160 / 50 / 200 |
| Tailor | Bandages | 4 cloth -> 6 bandages | Tailoring | 20 |
| Tailor | Carpet tile kit / Tapestry / Banner | 10 cloth / 40 cloth / 20 cloth | Tailoring / Art | 30 / 200 / 80 |
| Apothecary | Herbal poultice | 4 herbs -> 2 | Medicine | 30 |
| Apothecary | Healing salve | 4 herbs + 1 honey or beeswax -> 2 | Medicine 6 | 60 |
| Apothecary | Ember tonic | 2 salve + 1 lumenite dust or 1 Heartstone shard -> 2 | Medicine 10 | 120 |
| Apothecary | Sleeping draught | 6 herbs + 1 ale -> 2 | Medicine 6 | 60 |
| Apothecary | Candles | 4 tallow or 4 beeswax -> 6 candles | Cooking | 20 |
| Jeweller | Cut gem | 1 rough -> 1 cut | Art | 60 |
| Jeweller | Ring / Amulet / Circlet | 2 silver or gold + 1 cut gem / 4 + 2 / 6 + 3 | Art 4 / 8 / 12 | 120 / 200 / 300 |
| Jeweller | Mosaic floor kit | 10 blocks + 2 cut gems | Art 6 | 120 |
| Jeweller | The Ember Crown | 30 gold + 3 cut Heartstones + 3 rubies + 1 Lord's Ember | Art 16 | 2400 (multi-session) |
| Glassworks | Glass | 10 sand + 2 charcoal -> 6 glass | Craft | 40 |
| Glassworks | Window / Lantern / Vials / Lens | 6 glass / 4 glass + 4 iron + 1 candle / 4 glass / 6 glass | Craft 2-8 | 40-120 |
| Runeforge | Grind lumenite | 2 lumenite ore -> 4 dust | Lore | 40 |
| Runeforge | Rune of Warding (applied to a weapon) | weapon + 2 dust -> weapon +25% vs Hollow | Lore 8 | 160 |
| Runeforge | Lumen lamp | 4 dust + 4 glass + 6 bronze -> lamp (light radius 6, no fuel) | Lore 6 | 200 |
| Survey table | Survey | 1 paper (linen) -> reveals 12-tile radius | Lore 4 + Mining | 120 |
| Scriptorium | Copy book | 10 linen + 2 ink (charcoal) -> 1 book (joy, trade) | Lore 4 | 300 |
| Mint | Strike coins | 1 silver ingot -> 50 coins; 1 gold -> 150 | Smithing 6 | 60 |
| Siege workshop | Ballista kit / Emberthrower kit | 60 wood + 20 iron / 40 bronze + 20 iron + 4 lumenite dust | Construction 6 / 10 | 400 / 600 |

That is 75 base recipe entries across 21 benches. The 36 workshop specialisations add **61 recipes** (8.2), for **136 recipes** in all. Recipes are gated by tech (section 7.12), by workshop tier and, for the 61, by specialisation.

### 6.5 Food chain

- **Farming**: growing zones on soil (fertility: dirt 0.8, grass 1.0, rich soil 1.4, tilled with compost 1.6, cave moss for mushrooms 1.0 underground). Crops in `plants.js`: hearthroot (fast, 6 days, hardy), grain (10 days, mill/brew), greens (5 days), flax (8 days, fibre), herbs (8 days, also wild), berries (bushes, perennial), apples (orchard trees, 1 crop per Highsun), glowcap mushrooms (underground only, in darkness, 7 days, all seasons). Outdoor growth stops below 0 C (Deepcold) except in a Greenhouse.
- **Herding**: hens (eggs), goats (milk, hide), sheep (wool, meat), oxen (carry 2x, plough a field +fertility). Pens with fences, a barn for winter, troughs with hay (grain stalks). Animals breed when fed and housed. Tamed by Animals skill.
- **Hunting**: deer, boar, hares on the surface; cave beetles underground. Hunt designation, archers. Boars and wolves fight back.
- **Fishing**: Fisher's Hut on a shoreline (old art): a Cook-skill job, 1 fish per 30 game minutes, yield falls if two huts share 8 tiles.
- **Cooking**: meals beat raw food (raw -4 mood). Feasts +8 joy. Food poisoning chance `max(0, 5% - 0.5% x Cooking)`, doubled in a dirty kitchen.
- **Preserving**: smoking (x6 shelf life), pickling (jars), trail rations, bread, cheese, cool underground cellars (x4), Deepcold freezing outdoors.
- **Daily food** per colonist: about 1.6 simple meals, about 8 raw units. The HUD food chip shows **days of food** (meals + raw / daily need), not raw counts.

### 6.6 Medicine, apparel, armour and weapons

- **Medicine**: bandage < poultice < salve < ember tonic (see 4.6).
- **Apparel slots**: Body (tunic, robe, jerkin, gambeson), Outer (cloak, fur mantle, mail shirt, plate), Head (hood, cap, helm), Feet (boots), Hands (shield), plus one trinket (ring, amulet, circlet: +beauty for self, +Social). Insulation and armour values per item x material x quality.
- **Outfits** (policies): *Worker*, *Soldier*, *Any*, *Custom* (allowed items per slot). Colonists swap automatically at the armoury rack.
- **Weapon roles** (carry the old counter design): spears vs hounds (reach, first strike), mauls vs Hollow Knights (armour break), bows vs husks (range), light vs shades, silver and lumensteel vs everything Hollow.

| Weapon | Dmg | Speed | Range | Special |
|---|---|---|---|---|
| Club | 7 | 1.0 | melee | crude, wood |
| Dagger | 6 | 1.4 | melee | fast |
| Spear | 9 | 0.9 | 1.5 tiles | first strike, x1.5 vs beasts |
| Axe | 11 | 0.9 | melee | x1.3 vs shields |
| Sword | 12 | 1.0 | melee | parry 10% |
| Maul | 15 | 0.7 | melee | armour break, knockback |
| Halberd | 14 | 0.75 | 1.5 tiles | reach + armour break |
| Shortbow / Longbow / Crossbow | 7 / 10 / 14 | 1.0 / 0.8 / 0.5 | 8 / 12 / 10 tiles | crossbow pierces armour |

### 6.7 Furniture, art and trade goods

- Furniture defs carry `comfort`, `beauty`, `roomRole` hints and capacity (beds, seats). Material and quality scale beauty and value.
- Art (statues, engravings, tapestries) carries a **subject** drawn from the Chronicle (event and colonist names), shown in the info card ("A Superior granite statue of Bryn holding the gate against the Hollow, Ashfall year 2").
- Trade goods: coins, fine pottery, books, figurines, jewellery, glass vials, smoked food and ale sell above their ingredient value at traders (section 9.6 and 9.7).
- **Wealth** (`js/game/colony/wealth.js`): sum of item values (x quality x material) + 0.5 x structure value + 50 per colonist level-sum/10. Updated incrementally, and recomputed fully once per game day as a check.

---

## 7. Structures

### 7.1 Rules

- **Kinds** (field `kind` in the def): `construct` (built on site from materials: walls, floors, doors, buildings, workshops, defences), `furniture` (crafted item, then installed; D8), `zone` (painted area), `designation` (smoothing, engraving).
- **Placement**: claimed land only (3.1), on explored tiles, not on items or colonists, footprint rules per def (`needs: ['shore']`, `['underground']`, `['roofed']`, `['rockFace']`, `['spring']`, `['open sky']`).
- **Construction**: a placed blueprint becomes a **frame** when the first material arrives. Haulers deliver materials, builders add work. Work = def work x material work multiplier. Frames can be cancelled (materials drop) and prioritised (long-press "Do this first").
- **Upgrades**: many structures have tiers I-III (the old art has 2-3 levels). Upgrading keeps the building, costs the tier delta, and needs a tech. Workshop tier II also unlocks a **specialisation choice** (section 8.2).
- **Def schema** (`js/data/structures/*.js`):
```js
{ id, name, cat, kind, size:[w,h], cost:{wood:30} | costByMat:{cat:'stone', n:5}, work, hp,
  tech, tier: 'camp', claim: true, needs: [], beauty, comfort, light: {r, lvl, fuel},
  heat, roomRole, workbench: {recipes:[...], workType, specs:[...]}, levels: [...],
  art: 'spriteKey', path: 'forgehold' /* charter-unique */, ancestry: 'deepforge' /* monument */ }
```
- Art column below: **A** = existing art (the inventory names the module), **N** = new art needed.

The catalogue below has **146 rows in 9 groups** (about 121 distinct buildables after merging material variants and zones), plus 15 charter-unique structures in section 8.3, so about **136 distinct buildables**. Art comes from **kits** (13.1, 14.2 D): one bench base plus tool props plus a material tint, and one furniture frame per material family, so the new art is about 45 parts, not about 100 unique sprites. Tiers: C Camp, H Hamlet, V Village, Ho Hold, S Stronghold, Cr Crownhold.

### 7.2 Housing and bedroom furniture (12)

| id | Name | Size | Cost | Tier | Effect | Art |
|---|---|---|---|---|---|---|
| bedroll | Bedroll | 1x1 | 6 cloth or leather (or 10 wood "straw") | C | rest x0.8, comfort 0.4 | N |
| cot | Cot | 1x2 | 20 wood | C | rest x0.9, comfort 0.6 | N |
| bed | Bed | 1x2 | 35 wood/blocks | C | rest x1.0, comfort 0.8, bedroom role | N |
| doublebed | Double bed | 2x2 | 60 | H | 2 sleepers, spouses' thought | N |
| bunk | Bunk | 1x2 | 50 | H | 2 sleepers, barracks role | N |
| wardrobe | Wardrobe | 1x1 | 40 | H | +comfort and beauty in bedroom | N |
| endtable | End table | 1x1 | 20 | H | +rest 5% for adjacent bed | N |
| hearthfire | Fireplace | 2x1 (wall-adjacent) | 40 blocks | C | heat +12 C in room, light 2, burns 4 wood/day | A (flames) |
| hut | Cottage | 3x3 shell | 60 wood | C | a pre-walled roofed room with door (quick start housing) | A (House L1) |
| longhouse | Longhouse | 5x3 shell | 120 wood + 20 blocks | H | shell room for 4 | A (House L2) |
| stonehouse | Stone house | 4x4 shell | 160 blocks | V | shell room, warmth +4 | A (House L3) |
| cradle | Cradle | 1x1 | 25 wood | V | births option (Stage 4) | N |

### 7.3 Walls, doors, floors and roofs (18)

| id | Name | Cost per tile | Tier | Effect | Art |
|---|---|---|---|---|---|
| palisade | Palisade | 6 wood | C | hp 120, flammable | A (Wall L1) |
| wall | Wall | 5 blocks or 5 bricks or 8 wood | C | hp by material (stone 300-500) | A (Wall L2) |
| rwall | Reinforced wall | 5 blocks + 2 iron bands | V | hp x2, resists sappers 4x | A (Wall L3) |
| embrasure | Arrow-slit wall | 6 blocks | H | archers behind it shoot out, take 50% less ranged | N |
| pillar | Support pillar | (furniture, from Mason) | C | roof support r4, beauty 1 | N |
| prop | Wooden prop | (furniture, Carpenter) | C | roof support r4, flammable | N |
| door | Door | 20 wood | C | 1 tile, colonists pass, hostiles must break | N (Gate art scaled) |
| stonedoor | Stone door | 30 blocks | H | hp 400, slower to open | N |
| gate | Iron-bound gate | 2x1, 40 blocks + 4 iron bands | V | hp 900, can be locked (hostile-proof until broken) | A (Gate) |
| window | Window | 6 glass on a wall tile | V | light into room, beauty +2 | N |
| f_planks | Plank floor | 3 wood | C | beauty 1, walk 1.0, cleanable | N |
| f_flag | Flagstone | 4 blocks | C | beauty 1, not flammable | N |
| f_brick | Tiled floor | 4 bricks | H | beauty 2, cleanliness +20% | N |
| f_carpet | Carpet | 1 carpet kit | V | beauty 3, comfort +, flammable | N |
| f_mosaic | Mosaic | 1 mosaic kit | Ho | beauty 6 | N |
| road | Road | 2 blocks | C | walk speed x1.25, beauty 0 | N |
| bridge | Bridge | 10 wood or 8 blocks on shallow/deep water | C | walkable over water | N |
| roofzone | Build roof (zone) | 2 wood per tile | C | roofs open tiles within 6 of a support; rooms auto-roof | overlay |

(Roof is a zone action, so the row count is 18; walls in several materials count once.)

### 7.4 Storage (8)

| id | Name | Size | Tier | Effect | Art |
|---|---|---|---|---|---|
| stockpile | Stockpile (zone) | any | C | filtered storage (5.6) | overlay |
| dump | Dumping zone | any | C | accepts chunks, rubble, corpses; beauty -2 | overlay |
| shelf | Shelf | 1x1 furniture | C | 3 stacks per tile | N |
| barrelrack | Barrel rack | 2x1 | H | food x1.5 shelf life, 4 stacks | N |
| granary | Granary | 3x3 | H | 12 food stacks, rot x0.5, vermin-proof | A |
| weaponrack | Armoury rack | 2x1 | H | holds 6 weapons/armour; outfit swaps here | N |
| strongbox | Strongbox | 1x1 | V | 4 valuable stacks; thieves need 3x longer | A (chest) |
| icehouse | Ice house | 3x3 (underground or packed with ice) | V | frozen storage all year | N |

### 7.5 Farming and animals (15)

| id | Name | Size | Tier | Effect | Art |
|---|---|---|---|---|---|
| growzone | Growing zone (zone) | any | C | pick crop | overlay + crop stages N |
| farm | Tilled field | 4x4 | C | growing zone with fertility +0.2 and a scarecrow post | A (Farm) |
| planter | Planter box | 1x1 | H | flowers (beauty 4) or herbs indoors | N |
| greenhouse | Greenhouse | 5x5 | Ho | glass-roofed: grows in Deepcold, +20% yield | N |
| mushbed | Mushroom bed | 2x2 | H | glowcap in darkness underground, yield +30% | N |
| compost | Compost heap | 1x1 | H | food waste -> compost (+0.2 fertility to a 5x5) | N |
| scarecrow | Scarecrow | 1x1 | C | blight and bird loss -50% in radius 6 | N |
| pen | Animal pen (zone) + fence, fencegate | any | H | keeps animals, fences 2 wood/tile | N |
| coop | Hen coop | 2x2 | H | 6 hens, eggs | N |
| barn | Barn | 4x3 | V | winter housing for 8 animals, hay storage | A (Stable) |
| trough | Feed trough | 2x1 | H | hay feeding | N |
| beehive | Beehive | 1x1 | V | honey and beeswax, flowers within 8 | N |
| fisher | Fisher's hut | 2x2 on shore | C | fishing job | A |
| huntstand | Hunter's lodge | 2x2 | H | hunters rest here, hunt range +, pelts stored | N |
| silkframe | Silk frame | 2x2, underground | Ho (Silkhouse spec) | tamed cave spiders spin cave silk on it: 4 silk per spider per day | N (kit) |

### 7.6 Workshops by specialisation (33)

Each workshop is a `construct` with a `workbench` block. Tier upgrades raise speed (+15%/tier) and quality (+1 roll/tier) and unlock recipes. Specialisations at tier II and III: section 8.2.

| Group | id | Workshop | Size | Tier | Work type | Art |
|---|---|---|---|---|---|---|
| Fire and food | campfire | Campfire | 1x1 | C | Cook | A (flames) |
| Fire and food | stove | Hearthstove kitchen | 2x1 | H | Cook | N |
| Fire and food | butcher | Butcher's table | 2x1 | C | Cook | N |
| Fire and food | smokehouse | Smokehouse | 2x2 | H | Cook | N |
| Fire and food | windmill | Windmill | 2x2, open sky | H | Cook | A |
| Fire and food | watermill | Watermill | 2x2, on river edge | V | Cook (also powers adjacent benches, 7.8) | N |
| Fire and food | brewery | Brewery | 2x2 | H | Cook | N |
| Fire and food | cask | Fermenting cask | 1x1 | H | Cook | N |
| Wood | woodyard | Woodcutter's yard | 3x3 | C | Chop (chop speed +20% within 12, log storage) | A (Lumber Camp) |
| Wood | carpenter | Carpenter's bench | 2x1 | C | Craft | N |
| Wood | fletcher | Fletcher's bench | 2x1 | H | Craft | N |
| Wood | charkiln | Charcoal kiln | 2x2 | C | Craft | N |
| Stone | mason | Mason's bench | 2x1 | C | Craft | N |
| Stone | quarry | Surface quarry | 3x3 on crag/rock edge | C | Mine (slow, endless rough stone) | A (Quarry) |
| Stone | sculptor | Sculptor's studio | 2x2 | V | Art | N |
| Metal | bloomery | Bloomery | 2x2 | H | Smith | N |
| Metal | blastfurnace | Blast furnace | 2x3 | Ho | Smith | N |
| Metal | forge | Forge and anvil | 2x2 | H | Smith | N |
| Metal | mint | Mint | 2x2 | Ho (Tradehold H) | Smith | N |
| Cloth | tannery | Tannery | 2x2 | H | Tailor | N |
| Cloth | loom | Loom | 2x1 | H | Tailor | N |
| Cloth | tailor | Tailor's bench | 2x1 | H | Tailor | N |
| Earth | potter | Potter's wheel | 1x1 | H | Craft | N |
| Earth | kiln | Brick kiln | 2x2 | H | Craft | N |
| Earth | glassworks | Glassworks | 2x2 | V | Craft | N |
| Care | apothecary | Apothecary | 2x2 | H | Care | A (Alchemist) |
| Fine | jeweller | Jeweller's bench | 2x1 | V | Art | N |
| Lore | study | Study desk | 2x1 | C | Lore | N |
| Lore | scriptorium | Scriptorium | 3x2 | V | Lore | A (Library) |
| Lore | surveytable | Survey table | 2x1 | H | Lore | N |
| Lore | runeforge | Runeforge | 3x3 | Ho (Lanternhold, Deepforge) | Lore | A |
| War | siegeworks | Siege workshop | 3x3 | Ho | Build | A |
| War | trainingyard | Training yard | 4x4 | V | (joy/XP: melee and archery train at 50% XP) | A (Archery Range) |

(33 rows; quarry, woodyard and training yard are workplaces rather than bill benches.)

### 7.7 Defence and light (19)

| id | Name | Size | Tier | Effect | Art |
|---|---|---|---|---|---|
| tower | Watchtower | 2x2 | C | manned by 1 archer: +3 range, sight 12, warning +2 h for raids from its edge | A (L1-L3) |
| platform | Archer platform | 2x2 | H | 2 archers, wooden, flammable | N |
| stonetower | Stone tower | 3x3 | V | 3 archers, hp 1500 | A (Watchtower L3) |
| ballista | Ballista | 2x2 | V | operator Archery: heavy bolt, pierces | A |
| emberthrower | Emberthrower | 2x2 | Ho | cone of fire, burns Shades and Husks, sets wood alight | N |
| magespire | Mage spire | 2x2 | Ho (Lanternhold) | lumenite-fed arcane bolt, no operator | A |
| spiketrap | Spike trap | 1x1 | C | 35 dmg once, rearm by a hauler | A |
| emberpit | Ember pit | 1x1 | V | burns for 10 s, re-fuelled with tallow/oil | N |
| deadfall | Deadfall (tunnels) | 1x1, roofed | H | rock drop 60 dmg, single use, rebuild | N |
| barricade | Log barricade | 1x1 | C | low cover: ranged hits -40%, walkable slowly | N |
| brazier | Brazier | 1x1 | C | light 3 r5, 6 wood/day, Hollow +25% dmg taken in light | A |
| sconce | Torch sconce | on wall | C | light 2 r4, 2 wood/day | N |
| lantern | Lantern post | 1x1 | V | light 2 r5, 1 candle/2 days | N |
| lumenlamp | Lumen lamp | 1x1 | Ho | light 3 r6, no fuel | N |
| mirror | Light mirror | 1x1, wall-adjacent | V (Lampmaker spec) | turns a light 90 degrees: tiles in an 8-tile line from it get the source's level - 1 | N (kit) |
| wardstone | Ward stone | 1x1 | V | Shades cannot phase within r6; blight -40/day r9 | A (Ley Obelisk) |
| barracks | Barracks | 4x3 | H | 6 bunks, soldier mood +, drafted response faster | A |
| alarmbell | Alarm bell | 1x1 | H | tap: everyone non-drafted goes to their "safe room", soldiers draft | N |
| beacon | Signal beacon | 2x2, hill or tower top | V | raid warnings +6 h (all edges) | N |

### 7.8 Utility and mechanisms (12)

| id | Name | Size | Tier | Effect | Art |
|---|---|---|---|---|---|
| hearth | **The Hearth** | 3x3 | C (start) | colony core, claims r14, light 3 r8, heat r6, shoots at night (lvl), levels 1-5 (8.4) | A |
| waystone | Waystone | 1x1 | C | claims r9, blight cleanse | N |
| well | Well | 1x1 on spring or within 4 of water | C | firefighting x2 speed within 15, needed by brewery and bathhouse | N |
| waterwheel | Water wheel | 2x1 on river edge | V | **power-free mechanism**: benches within 6 work +25% (bellows, mill, loom) | N |
| bellows | Bellows | 1x1 next to a forge/bloomery | H | +20% smithing speed (or +40% if a waterwheel is in range) | N |
| lever | Lever | 1x1 | V | opens, closes and locks linked doors and gates remotely (up to 4); a locked gate is a wall to hostiles until broken | N |
| floodgate | Floodgate | 1x1 on water | Ho | open: bridge; closed: deep water (moat) | N |
| plate | Pressure plate | 1x1 | V | triggers linked deadfalls, ember pits and gates when a hostile steps on it | N |
| headframe | Mine headframe | 3x3 at a tunnel mouth | H | ore hauled to it and stone piles within 20 tiles count as stored (5.6); miners +10% speed within 20 | A (Mine) |
| cart | Ore cart track | 1 tile | V | haul speed x1.6 along track | N |
| grave | Grave / Sarcophagus / Crypt | 1x2 / 1x2 / 3x3 | C / H / V | burial; crypt holds 8 | N / A (rubble/stone) |
| burial | Burial zone (zone) | any | C | graves allowed here; Husk-rising prevented | overlay |

### 7.9 Civic and joy (18)

| id | Name | Size | Tier | Effect | Art |
|---|---|---|---|---|---|
| table | Table / Long table | 2x1 / 3x2 | C / H | eating at a table avoids "ate without table" -3 | N |
| chair | Chair / Stool / Bench | 1x1 / 1x1 / 2x1 | C | comfort | N |
| throne | Throne | 1x1 | Ho | throne hall role; Warden title colonist +mood | N |
| shrine | Shrine | 1x1 | C | joy (prayer), dread relief r4 | N |
| temple | Temple | 3x3 | V | joy, taint cure with rest, weddings, funerals +2 | A |
| tavern | Tavern | 4x3 | H | serves ale, joy x1.3, chats x2, wanderers more likely | A |
| dicetable | Dice board | 1x1 | H | joy (games) | N |
| stage | Skald's stage | 2x2 | V | joy for 8 when an Art 6+ colonist performs | N |
| bathhouse | Bathhouse | 4x4 needs well | Ho | joy, comfort, disease -50% | N |
| arena | Sparring pit | 4x4 | V | joy + melee XP; tournaments event | N |
| garden | Flower garden (zone with planters) | any | H | beauty, joy (walk) | N |
| fountain | Fountain | 2x2 | Ho | beauty 15, joy | N |
| statue | Statue (installable art) | 1x1 / 2x2 | V | beauty by quality | N |
| tradepost | Trade post | 3x3 | H | caravans trade here; sells from stock in r12 | A (Market) |
| infirmary | Infirmary bed / Surgery table | 1x2 / 2x1 | H / V | +tend, +healing, hospital role | N |
| memorial | Memorial obelisk | 1x1 | V | lists the dead; +2 mood for mourners | N |
| hallofrecords | Hall of records | 3x3 | Ho | Chronicle joy (reading), research +10% | A (Library L2) |
| observatory | Observatory | 3x3, open sky | V (Lens-grinder spec) | raid warnings +6 h on all edges, research +10% at night | N (kit) |

### 7.10 Monuments and wonders (11)

| id | Name | Requirement | Effect | Art |
|---|---|---|---|---|
| cathedral | Cathedral of Dawn | Human majority or Ho tier | work +10% within r12, heals soldiers | A |
| hearttree | Heart Tree | Sylvari present, V tier | heals, plants +25% in r12 | A |
| rf_monument | Runehall (Runeforge L3) | Deepforge present | towers +20% dmg in r10 | A |
| wardrum | War Drum | Emberkin present | drafted +20% attack at night | A |
| worldforge | World Forge (Wonder) | Forgehold | 3 stages; all metal goods +1 quality | A |
| sunspire | Sunspire (Wonder) | Lanternhold | the map is lit 1 level brighter; nights 2 h shorter | A |
| moonwell | Moonwell (Wonder) | Greenhold | crops grow in all seasons; blight cannot spread | A |
| exchange | Gilded Exchange (Wonder) | Tradehold | a caravan every 3 days, sell prices +30% | N (Market L3 x1.5 + gold) |
| bastion | Ember Bastion (Wonder) | Bulwark | all walls and gates +50% hp, siege raids lose 30% morale | A (citadelart) |
| greathearth | Great Hearth (Hearth L5) | 3 Lord's Embers + Ember Crown | victory, blight recedes | A (Hearth L2 + crown FX) N |
| trophy | Lord's trophy (x3) | defeating a Lord | beauty 30, +5 mood for the hold for a season | N (bone, wing, crown) |

**Count:** housing 12, walls/floors 18, storage 8, farming 15, workshops 33, defence 19, utility 12, civic 18, monuments 11 = **146 rows** (about 121 distinct buildables after merging material variants and zones).

### 7.11 Rooms and room value (`js/game/world/rooms.js`, `js/data/rooms.js`)

- A **room** is a flood-filled set of non-wall tiles bounded by walls, doors, natural rock and map edges, with at most 400 tiles (bigger = "outdoors"). Recomputed for dirty areas at the end of any tick in which walls, doors or rock changed (C13); never on a timer.
- **Role** by contents (first match): Throne hall (throne), Infirmary (infirmary bed), Barracks (2+ bunks or 3+ beds), Bedroom (1 bed or double bed), Dining hall (table + 2 chairs, no beds), Kitchen (stove/campfire), Workshop (workbench), Temple/Shrine room, Tavern, Storeroom (shelves/stockpile 50%+), Cellar (casks or barrel racks, underground, with the Cooper specialisation: ageing, 8.2), Tomb (graves), Prison (prison bed), Bath, Hall (none).
- **Stats**: Wealth (sum of value), Beauty (avg), Space (tiles, minus furniture), Cleanliness (filth), Light (avg light level).
- **Impressiveness** = weighted geometric mean of the four main stats, banded into six tiers: **Squalid, Plain, Decent, Fine, Grand, Majestic**. Tier thoughts per role: bedroom -4/0/+2/+4/+6/+8, dining -3/0/+2/+4/+6/+9, throne hall (for the Warden) ... and "Shared bedroom" -3, "Slept in barracks" -2 (0 for soldiers).
- Infirmary tier adds tend quality; workshop tier adds quality rolls (+1 at Fine, +2 at Grand); kitchen cleanliness lowers food poisoning.
- **Owned rooms**: beds have owners (assigned in the bed card, or auto-assigned to the colonist without a bed). A bedroom with one owned bed is that colonist's room: its tier gives the thought, Greedy colonists need Fine or better, Ascetic colonists dislike Fine or better, and spouses need a shared double bed.

### 7.12 Research and discovery (`js/data/research.js`)

Lean tree: **41 techs in 4 eras** gated by prosperity tier. **Lore points** come from Lore work at a study desk/scriptorium (1 point per 10 work ticks x speed). Costs 60-900 points. **Discovery by doing** halves or zeroes costs.

| Era (tier) | Techs (cost) and discovery triggers |
|---|---|
| **Kindling** (Camp) | Masonry (free), Carpentry (free), Cooking (free), Fletching (80), Tanning (80; *free on first butchering*), Pottery (80; *half on mining clay*), Charcoal (60), Hunting (60), Herbalism (100; *half on harvesting herbs*), Roofing (60) |
| **Hearth** (Hamlet) | Smelting (200; *free on first iron or copper ore mined*), Smithing (250), Brewing (150), Milling (150), Weaving (150), Tailoring (150), Animal husbandry (200; *half on taming*), Smokehouse (120), Support pillars (120; *free after the first cave-in warning*), Watchtowers (150) |
| **Hold** (Village) | Steel (500; *half on finding coal + iron within 20*), Glassblowing (300), Jewellery (350; *half on first gem*), Sculpture (300), Medicine II: salves (300), Prospecting (250; *free on first vault*), Waterworks (350: watermill, waterwheel, wells+), Masonry II (300: reinforced walls, stone doors), Siegecraft (450), Lantern-making (250), **Mechanisms (400: levers, pressure plates, locked gates, linked deadfalls)** |
| **Crown** (Hold+) | Lumenite lore (700; *half on first lumenite*), Runes (800), Ember tonic (600; *half on first Grey Taint cured by rest*), Blast furnace II (600), Greenhouses (500), Floodworks (500: floodgates), Mint and coinage (500), Grand architecture (900: fountains, bathhouse, mosaics), Wonder-craft (900), Crown-smithing (900: the Ember Crown) |

Lore tablets from Old Crown vaults give a random unresearched tech of the current or next era. The research UI is a 4-column list (one per era), not a graph.

---

## 8. Specialisation and progression

Specialisation works at four levels. Each one is a choice the player makes once and lives with, so two colonies with the same seed still diverge. **Rule for all content in this section: a specialisation adds a verb** (an action, a recipe set, a structure or a mechanic). Numbers are allowed only as a short second line; a player cannot see "+20% speed" on a phone, and it makes no stories.

| Level | Who chooses | When | Can it be changed? |
|---|---|---|---|
| Colonist profession and perks | the player (via roles and perk picks) | skill levels 10 and 20 (choices), 15 (signature) | profession: yes (it follows work); perks: no |
| Workshop specialisation | the player, per building | workshop tier II and III | yes, by re-tooling (cost and 1 day) |
| Colony charter | the player | Hamlet (first), Stronghold (second) | no |
| Start (ancestry band) | the player | new colony | no |

### 8.1 Colonist professions and perks (`js/data/professions.js`, `perks.js`, `js/game/people/skills.js`)

- A colonist's **profession** is derived, never assigned: the highest skill at level 6+ among the work types that colonist has at priority 1. Ties go to the higher XP. With nothing at 6+, the title is the backstory title ("Ferryman"). The profession is a title; the **role** (5.1) is what the player sets.
- **Rank by level:** Apprentice (6), Journeyman (10), Master (15), Grandmaster (20). The rank shows in the colonist card, the portrait rail border (none, bronze, silver, gold, ember) and the Chronicle ("Master Smith Bryn"). A Master of a skill in the colony is required for tier III of that skill's workshops (8.2).
- **Look:** at Master rank the colonist wears a profession look built from existing art (cape, circlet and tool from `heroart.js`). Only cosmetic.

| Profession (skill) | Master look from |
|---|---|
| Miner (Mining) | Deepforge miner (new tool art) |
| Builder (Construction) | Ironshield palette with a mallet |
| Mason (Masonry) | Ironshield palette |
| Smith (Smithing) | Runesmith |
| Carpenter (Woodcraft) | Ranger palette |
| Tailor (Tailoring) | Skald palette |
| Cook (Cooking) | villager with ladle |
| Grower (Growing) | Druid |
| Herder (Animals) | Beastmaster |
| Hunter (Archery, with Animals work) | Ranger |
| Doctor (Medicine) | Cleric |
| Scholar (Lore) | Frostwarden robe |
| Artisan (Art) | Duelist palette with circlet |
| Envoy (Social) | Paladin without armour |
| Soldier (Melee or Archery, with soldier duty on) | Paladin (melee) / crossbowman (archery) / Warlord (squad leader) |

**Soldier duty** is a toggle on the colonist card (the Soldier role turns it on). Soldiers sleep in barracks without a penalty, man towers during their Night watch schedule, answer the alarm bell first and gain melee/archery XP at the training yard as joy. A colony with soldiers has fewer hands for work: that is the trade-off.

**Perks (33).** The six **key skills** (Mining, Construction, Smithing, Medicine, Melee, Archery) offer a choice of 2 at level 10 and at level 20: 24 perks. Each of the other nine skills grants one **signature perk** at level 15 with no choice: 9 perks. Only the choices raise a perk letter (it can be postponed); a signature perk is a toast. No perk is a bare percentage.

| Key skill | Level 10 (pick 1) | Level 20 (pick 1) |
|---|---|---|
| Mining | **Cave Sense**: sees crack overlays 2 h before a cave-in; unknown cavern tiles within 4 show a "hollow" mark / **Seam Follower**: mining one vein tile makes the whole connected vein known | **Stonefriend**: may leave a natural pillar while mining (free support) and leaves mined faces smoothed / **Heartdelver**: gem and Heartstone pockets show through 4 tiles of rock |
| Construction | **Quick Shoring**: sets a wooden prop on the spot from 10 carried wood, no bench / **Salvager**: deconstruction returns all materials and digs buried items out of rubble at once | **Master Builder**: walls they build count as reinforced (sappers 4x slower) / **Siege Engineer**: repairs under attack at 2x and raises a barricade from a stone pile in 1 game hour |
| Smithing | **Reforger**: melts captured weapons and armour into 60% of their metal at any forge / **Temperer**: re-rolls a weapon's quality once for 30% of its metal | **Crownsmith**: forges Legendary on purpose (2x cost, 3 days) / **Ashquencher**: quenches a blade in greyash: it gains Hollowbane (x1.4 vs Hollow) |
| Medicine | **Field Surgeon**: tends downed colonists where they lie at full quality / **Fever Watch**: sees infections 12 h before they show and stops them with a re-tend | **Taintbreaker**: cuts out Grey Taint below 60 by surgery, no Temple needed / **Ember Hands**: once per day, stops a dying colonist's blood loss with a touch |
| Melee | **Shieldwall**: while they hold a 1-tile choke, enemies cannot push past / **Duelist**: challenges an elite or a captain; the two lock in a duel others cannot join for 10 s | **Unbroken**: survives the first lethal hit of each raid at 1 HP / **Warcry**: once per fight, Husks and beasts within 6 flee for 5 s |
| Archery | **Fire Arrows**: lights arrows at a brazier in range; hits set targets and wood alight and pin Shades / **Overwatch**: on Hold, shoots the first enemy to enter a marked arc before it acts | **Deadeye**: an aimed shot at a weak spot (Colossus back, Knight visor) deals x3 / **Volley Captain**: the squad's archers loose together at their target; a volley staggers it for 2 s |

| Skill | Signature perk at level 15 |
|---|---|
| Woodcraft | **Trapwright**: builds and rearms traps without a hauler; builds deadfalls from wood |
| Masonry | **Stone Carver**: carves beds, tables, thrones and statues in place from the rock of a carved room (no block hauling) |
| Tailoring | **Banner-maker**: sews a squad banner; a squad near its banner never breaks or flees |
| Cooking | **Hearth Cook**: may call a feast (needs a dining hall and the food): everyone gathers for 2 h, +8 mood, chats x3 |
| Growing | **Graft-hand**: turns a wild berry bush, herb patch or old tree into a sapling item to replant anywhere |
| Animals | **Beast-friend**: calms a manhunter or a cave beast: it stops attacking and can be tamed |
| Lore | **Deep Reader**: reads a lore tablet for a second tech; studying a Lord's trophy shows that Lord's telegraphs 1 s earlier |
| Art | **Chronicler**: engraves a deed on a wall; everyone who sees it gets "Our history" +3 |
| Social | **Silver Tongue**: at the Sighted stage, parleys with a reaver warband: pay tribute to turn it back, or win over 1-2 deserters |

All 33 live in data with one schema `{ id, skill, lvl, name, text, grants: { toil? | recipe? | rule? }, mods: [...] }`. `grants` names a toil, recipe or rule hook in code, so a perk is data plus at most one small hook. Mods use the same modifier keys as traits (one modifier engine, section 13.3).

### 8.2 Workshop tiers and specialisations (`js/data/specs.js`)

- **Tier I** is the base building. **Tier II** costs the tier delta and a tech, gives +15% speed and +1 quality roll, unlocks the tier recipes and asks for **one specialisation** (pick 1 of 2 or 3). **Tier III** needs prosperity Hold and a Master of the workshop's skill in the colony, gives another +15%/+1 and a **second specialisation from the remaining options**.
- **Re-tooling** changes a specialisation: 50% of the tier delta in materials and 1 game day of Build work, during which the bench is unusable.
- Every specialisation **adds** something: a new action (a job or an order), a recipe set, or a structure. The "Also" column is the only number, kept to one line. The spec picker shows the Adds text first.
- Data: `{ id, bench, adds: { recipes: [...], toils: [...], structures: [...], rules: [...] }, mods: [...] }`.

| Workshop | Specialisation | Adds (the reason to pick it) | Recipes added | Also |
|---|---|---|---|---|
| Forge | **Weaponsmith** | **Temper**: re-roll a weapon's quality once; new war pick and glaive | 2 | weapons +1 quality 25% of the time |
| Forge | **Armourer** | **Refit**: repairs and resizes captured reaver armour, so raids feed the armoury; brigandine | 1 | - |
| Forge | **Toolsmith** | **Ability tools**: prospector's hammer (its carrier can Prospect at any Mining level), surveyor's chain (survey r6 without a table), shoring jack (its carrier can Quick Shore), surgeon's kit (Medicine 6 can do surgery) | 4 | tools +2 quality |
| Bloomery / Blast furnace | **Smeltery** | **Melt down** scrap weapons, armour and reaver gear into ingots; slag becomes road blocks | 2 | +2 ingots per smelt |
| Bloomery / Blast furnace | **Alloyer** | **New alloys**: electrum (silver + gold; an electrum-inlaid threshold stops Shades) and lumensteel at tier II | 2 | - |
| Carpenter | **Joiner** | **Matched sets**: one bill makes a bedroom, dining or hall set; a room with a full set gets "Well-appointed" +3 | 3 | - |
| Carpenter | **Cooper** | **Cask cellar**: casks and barrel racks, and the Cellar room role where ale ages into aged ale (+joy) and meat into salted meat (shelf life 60 days) | 4 | - |
| Carpenter | **Wheelwright** | **Carts**: a hand cart (a hauler with a cart carries 3 stacks) and mine carts for the ore track | 2 | ballista kits -30% wood |
| Fletcher | **Bowyer** | **Composite bow** (wood, bone, leather; range +2) | 1 | bows +1 quality |
| Fletcher | **Bolt-maker** | **Special ammunition**: fire bolts, silver-tipped bolts, ballista bolts; soldiers draw them from the armoury rack | 3 | - |
| Mason | **Stonecutter** | **Cut in place**: stone piles within 6 tiles of the bench are cut where they lie (no hauling); ashlar walls and floors from two stones | 2 | 12 blocks per rough stone |
| Mason | **Monument mason** | **Monuments**: obelisk, memorial wall, engraved pillar; statues at the mason bench | 3 | - |
| Hearthstove kitchen | **Feast hall kitchen** | **Feast day**: schedule a feast in a dining hall (everyone attends, chats x3, +8 mood) | 0 (an order) | feasts at Cooking 6 |
| Hearthstove kitchen | **Field kitchen** | **Provision crate**: soldiers and miners carry a ration and eat on site instead of walking home | 1 | rations x2 speed |
| Brewery | **Alehouse** | **Tavern service**: a barkeep job serves drinks in the tavern; tavern joy x2, wanderers +50% | 0 (a job) | ale +2 per wort |
| Brewery | **Meadery** | **Heartmead** (honey + glowcap): a drink that clears Dread for a night | 1 | mead and wine trade x1.3 |
| Tannery | **Leatherworks** | **Hardened leather**: lamellar armour and waterskins | 2 | - |
| Tannery | **Furrier** | **Winter kit**: fur bedding and a snow cloak; a colonist in the kit ignores a cold snap outdoors for 6 h | 2 | - |
| Loom | **Weaver** | **Dyes and heraldry**: dyed cloth and heraldic banners in the colony's colours (room beauty, squad colours) | 2 | cloth +2 per batch |
| Loom | **Silkhouse** | **Silk frame** structure: tamed cave spiders spin silk on it, a new production loop underground; spidersilk at half work | 1 | - |
| Tailor | **Outfitter** | **Role kits**: one bill dresses a colonist in a matched set for their role | 1 | - |
| Tailor | **Arming tailor** | **Padded armour**: padded hood and arming coat | 2 | gambesons +1 quality |
| Apothecary | **Herbalist** | **Calming tea**: a colonist can hand it to a sulking or binging colonist to end a minor break | 1 | poultices x1.5 |
| Apothecary | **Ember-alchemist** | **Fire oil** (tallow + coal): fuels ember pits and fire arrows | 1 | ember tonic at Medicine 7 |
| Jeweller | **Gemcutter** | **Gem inlay**: sets a cut gem in a weapon or furniture piece (ruby burns, sapphire chills, emerald heals the wielder 1 HP per hit, amber glows 1 tile) | 1 | - |
| Jeweller | **Goldsmith** | **Regalia**: chains of office give titles (Steward: hauls first to Critical stockpiles; Marshal: squads answer drafts at once; Keeper: prisoners never escape) | 3 | trade +25% |
| Glassworks | **Lampmaker** | **Light mirror** structure: turns a light 90 degrees down a tunnel | 1 | lanterns -30% |
| Glassworks | **Lens-grinder** | **Survey lens** (its carrier's Prospect radius becomes 8) and **Observatory** parts, which unlock the Observatory (+6 h warnings) | 2 | - |
| Potter / Kiln | **Fine ware** | **Glazed urns**: storage urns (food in them rots x0.5) and burial urns (a crypt slot without a sarcophagus) | 2 | pottery trade +40% |
| Potter / Kiln | **Brickworks** | **Brick vault**: a built vaulted roof that supports r6 in brick rooms | 1 | bricks x2 |
| Scriptorium | **Archive** | **Chronicle copy**: a book of the hold's deeds; reading it gives "Proud history" +4 | 1 | research +20% |
| Scriptorium | **Copy-house** | **Skill primers** (5, one per skill family): a reader learns that skill up to level 4 | 5 | books trade +30% |
| Training yard | **Shield drill** | **Drill hour** (a schedule cell): a squad drilled 3 times this season fights in formation and never flees | 0 (a schedule) | melee XP x1.5 |
| Training yard | **Archery butts** | **Shooting match** (a joy event): the winner gets a named bow and +6 mood | 0 (an event) | archery XP x1.5 |
| Smokehouse | **Curing house** | **Salt-cure** with ash-salt: travel stores with shelf life 120 days (needed for Tradehold caravans) | 1 | shelf life x8 |
| Smokehouse | **Smoke kitchen** | **Smoked delicacies**: count as fine meals and sell as trade goods | 1 | - |

**36 specialisations on 17 workshops, adding 61 recipes, 3 structures (silk frame, light mirror, observatory) and about a dozen new actions, jobs and orders (temper, refit, melt down, cut in place, feast day, tavern service, calming tea, drill hour, shooting match, and the ability tools).**

### 8.3 Colony charters (`js/data/charters.js`)

At **Hamlet** the player charters the hold along one of five paths (a letter with the five cards, each listing exactly what it does). At **Stronghold** they add a second, different charter. A charter grants **one signature mechanic**, a small passive bonus, three unique structures and access to its Wonder, and it **bends the storyteller** hard enough that two colonies with different charters feel different within 2-3 majors.

| Charter | Signature mechanic (new verbs) | Passive | Unique structures | Wonder |
|---|---|---|---|---|
| **Forgehold** (smithing and depth) | **Commissions and artifacts**: each season an envoy brings a commission (a named item of a kind and quality by a deadline) that pays in rare goods, a tech tablet or a colonist; Ember-touched moods are twice as likely; artifacts count double in wealth | ore yield +1 per tile | **Great Anvil** (Masterwork +10% for forge users in r6), **Ore Stamp** (by a water wheel: +2 ingots per smelt), **Cage Lift** (at a tunnel mouth: hauls from tunnels x1.5 speed) | World Forge |
| **Greenhold** (farmstead and herds) | **Herds and seasonal migration**: herds graze outside the walls from Thaw to Ashfall; in Deepcold a **herd drive** (2 herders, letter-resolved) takes them off-map to winter pasture and brings them back in Thaw 50% larger, sometimes with wild-born stock | crop yield +15% | **Orchard Grove** (zone: apples and berries without replanting), **Great Barn** (16 animals, hay never rots), **Seed Vault** (blight cannot destroy crops in r15) | Moonwell |
| **Lanternhold** (arcane and light) | **Light network and Vigils**: Lumen Conduits link lamps into a network that shares fuel; a Lore 8+ colonist leads a **Vigil** at a Warding Circle (costs lumenite dust): for one night every networked light is +1 level and colonists in light ignore dread | light radius +1 everywhere | **Lumen Conduit**, **Starglass Observatory** (research +25%, every raid warning +12 h), **Warding Circle** (3x3: Hollow in r10 move x0.8; the Vigil site) | Sunspire |
| **Tradehold** (trade and coin) | **Outbound caravans**: send 2-4 colonists with pack animals and goods to a named town for 3-6 days; a caravan letter resolves the trip (sell at x1.2, buy rare goods, recruit, or an ambush with a choice); the goods and people are away meanwhile | caravans every 5 days instead of 8; mint at Hamlet | **Caravanserai** (caravans stay 2 days, 2 at once), **Counting House** (+1% wealth per day as coins, cap 2,000), **Guild Hall** (hire a mercenary for 3 days for 300 coins) | Gilded Exchange |
| **Bulwark** (fortress) | **Garrisons and counter-sallies**: assign soldiers as a permanent garrison to a Keep or Gatehouse (they do not work, they defend and train); during a siege a **Sally** order sends a squad out of the Gatehouse to strike the siege camp's engine | walls and gates +25% hp | **Keep** (5x5 stone shell: a Fine barracks and a last stand +20% hp), **Gatehouse** (3x2 gate with murder holes: 6 dmg/s to hostiles under it; the sally port), **War Room** (draft response time halved, squads 6 instead of 4) | Ember Bastion |

**Storyteller nudges (strong on purpose).** The charter's preferred incidents get weight x3, the off-path ones x0.3, and the first major after chartering is fixed:

| Charter | Preferred (x3) | Rare (x0.3) | First major after chartering |
|---|---|---|---|
| Forgehold | breaches, sappers | beasts | a sapper raid aimed at the deepest ore stockpile |
| Greenhold | beasts, blight, vermin | sieges | a beast pack at the herds |
| Lanternhold | Hollow hordes, Rifts, Shades | reavers | a Shade-heavy horde at night |
| Tradehold | thieves, reavers | Hollow hordes | a reaver warband after the first caravan returns |
| Bulwark | sieges, Hollow Knights | beasts | the first siege at Village tier, with a 48 h warning |

- Charter structures are rows in `js/data/structures/charter.js` with `path: '<charter id>'`. The two charter choices are stored in `s.colony.charters`. Charter mechanics live in `js/game/colony/charters/<id>.js` (owner K).
- Wonders (section 7.10) have three stages. Each stage is a separate construction project with its own rare inputs (stage 3 always needs one Lord's Ember or 3 Heartstones), so a Wonder is a goal of a full game year or more.
- Ancestry monuments (Cathedral of Dawn, Heart Tree, Runehall, War Drum) are not charters. They need 2+ colonists of that ancestry and give ancestry-flavoured bonuses, so a mixed band can build several.

### 8.4 Prosperity tiers and the Hearth (`js/data/tiers.js`, `js/game/colony/tiers.js`)

A tier is reached when all three conditions hold for one full game day. Tiers never drop, so a raid that burns the stores does not take away content. (Stage 2 balance: Hamlet and Village wealth lowered from 8,000 and 25,000 to 6,000 and 20,000 after the bot v2 runs; see `js/data/tiers.js`.)

| Tier | Wealth | Colonists | Hearth level | Unlocks |
|---|---|---|---|---|
| Camp | - | - | 1 | Kindling era, 1 Waystone, Hollow hordes (small), beasts, thieves |
| Hamlet | 6,000 | 5 | 2 | Hearth era, **first charter**, 3 Waystones, caravans, reavers, wanderers more often |
| Village | 20,000 | 9 | 2 | Hold era, 6 Waystones, sappers, migrant groups of 3-4, Rift incidents, ancestry monuments |
| Hold | 70,000 | 14 | 3 | Crown era, 10 Waystones, sieges, breaches from the deep, **Gloomwyrm** can be challenged, Wonder stage 1 |
| Stronghold | 160,000 | 20 | 4 | **second charter**, 16 Waystones, **Bone Colossus**, Wonder stages 2-3, Ember Crown recipe |
| Crownhold | 350,000 | 26 | 4 + one Lord defeated | unlimited Waystones, **Hollow King**, Great Hearth (level 5) |

**Hearth levels** (an upgrade on the Hearth building; Build work, Masonry for the stonework):

| Level | Name | Cost | Light | Claim | Night shot | Other |
|---|---|---|---|---|---|---|
| 1 | Kindled | start | 3, r8 | r14 | 6 dmg every 30 ticks | heat r6 |
| 2 | Banked | 80 blocks, 20 iron, 1 rough gem | 3, r10 | r16 | 9 dmg | dread -1 level in r20 |
| 3 | Roaring | 120 blocks, 30 steel, 20 silver, 2 cut gems | 3, r12 | r18 | 14 dmg, 2 targets | taint cure by rest doubles in r12 |
| 4 | Brightflame | 200 marble or Duskstone blocks, 40 steel, 30 gold, 1 Heartstone | 3, r14 | r20 | 20 dmg, 3 targets | blight cleansing x2 map-wide |
| 5 | Crown of Embers | 3 Lord's Embers + the Ember Crown | 3, r18 | r24 | 30 dmg, 5 targets | **victory**: blight recedes, raids drop to "endgame trickle" (or the player picks "Endless Night" to keep escalation) |

**Hearth fuel.** The Hearth burns 10 wood or 5 charcoal per game day (Heartstone: 10 days). Haulers refuel it under the Haul work type when fuel drops below 2 days. A cold Hearth means no light, no night shot, no claim growth, the thought "The Hearth is cold" (-15) and Hollow +25% damage. This keeps the Hearth the heart of every colony without making it a chore (an Ember Grate upgrade at Village holds 10 days of fuel).

### 8.5 Starts (`js/data/starts.js`)

A new colony picks a start. Each start fixes the band, the starting items and a map preference, and every one can be fully customised (rerolls per colonist up to 5, ancestry per slot).

| Start | Band | Items | Map preference | Flavour |
|---|---|---|---|---|
| **Hearthwatch Remnant** (default, tutorial) | 3 Humans, one with Construction 6+ | 300 wood, 60 meals, 20 steel, 1 spear, 1 bow, 40 herbs, hearthroot seeds | Greenvale, mountain 6 tiles away | balanced |
| **Deepforge Delve** | 2 Deepforge + 1 Human | 150 wood, 40 meals, 2 picks, 30 iron, 60 rough granite | start against the mountain face, a cavern within 25 tiles | miner/smith opening, fewer trees |
| **Grove-Wardens** | 2 Sylvari + 1 Human | 200 wood, 80 raw food, grain/flax/herb seeds, 2 goats | Elderwood (Stage 3; Greenvale before) | farm opening, fewer ores near |
| **Ashfang Exiles** | 2 Emberkin + 1 any | 100 wood, 40 meals, 3 axes, 1 maul, 20 leather | Greenvale near the Grey Edge | first reaver raid on day 3, but every colonist has Melee 6+ |
| **Lone Ember** (hard) | 1 colonist of choice | 50 wood, 10 meals | any | the storyteller sends a wanderer within 3 days |

---

## 9. Threats and events

### 9.1 Storyteller (`js/game/threat/storyteller.js`, `js/data/storytellers.js`, `js/data/incidents.js`)

The storyteller runs every 600 ticks (once per game hour) on its own RNG stream (`rng.fork('story')`). It keeps a **queue of scheduled incidents** (`s.st.queue`), each with an arrival tick and a warning tick. Nothing hostile appears on the map without a queue entry, so every threat has a warning except the ones marked "no warning" below (cave-ins and fires, which have their own tells).

Incident categories: **Major threat**, **Minor threat**, **Disaster**, **Visitor** (traders, wanderers, envoys), **Boon**, **Discovery** (only from digging; never scheduled).

Three storytellers (picked at new colony, changeable in settings once per year):

| Storyteller | Majors every | Warning lead | Minors / boons per 10 days | Escalation | For |
|---|---|---|---|---|---|
| **The Steady Flame** | 5-7 days | 12-24 h | 3 / 3 | standard | default |
| **The Wandering Ember** | 2-11 days (random, never two majors within 2 days) | 6-24 h | 2-6 / 2-6 | standard, wider spread | stories, surprises |
| **The Long Night** | 4-6 days | 6-12 h | 4 / 2 | x1.3 points, floor rises twice as fast | veterans |

Difficulty (separate from storyteller): **Hearthkeeper** (threat x0.35, no Lords unless challenged, colonists cannot die from raids; downed instead), **Warden** (x0.7), **Steadfast** (x1.0, default), **Ironhold** (x1.4, and no backup reloads, section 11.5).

**Grace period and first raid:** in the default start (Hearthwatch Remnant) the first omen comes on **day 2 at 18:00** and a small Hollow horde (60 points, 3-4 Husks) arrives at **21:00 on day 3** (27 h warning, with a coach card: 10.9), so the first session reaches the first warning in about 10 minutes of play. Other starts: no majors before day 4, the first major is the same small horde with a 24 h warning (Ashfang Exiles: a reaver raid on day 3, as in 8.5).

**Scheduling.** Each storyteller has a `tension` value 0-100: majors add 30-60, a colonist death adds 20, it falls 8 per quiet day. A major is scheduled when the "days since last major" window opens, and pushed back 1 day while tension > 60 (so a beaten-up colony gets breathing room). Minors and boons are rolled per day against weights filtered by tier, season and requirements, with per-incident cooldowns.

**Incident schema:**
```js
{ id: 'reaver_raid', cat: 'major', minTier: 'hamlet', seasons: 'TBAD', weight: 10, cooldownD: 8,
  pts: { min: 150, mult: 1.0 },          // share of the threat budget it uses
  warnH: [12, 24], arrive: 'day' | 'dusk' | 'night' | 'any',
  requires: s => boolean,                 // e.g. 'tunnel within 15 of the seep'
  plan(s, rng, pts) -> RaidPlan,          // composition, edge, goal, route preview
  cast: { target: 'captainSlayer' },      // actors picked by selectors (9.10), saved in the queue entry
  after: ['wreckage', 'captive'],         // aftermath it may leave (9.10)
  letter: { title, text, choices? } }     // text templates in js/data/text/incidents.js
```

### 9.2 Threat points (`js/data/balance.js` section THREAT)

```
wealthPts = wealth <= 50,000 ? wealth * 0.008 : 400 + (wealth - 50,000) * 0.003
popPts    = 14 * max(0, ableColonists - 3)
floorPts  = 2 * day                 (year end adds +40 once per year)
defenceAdj = 0.85 if the colony lost a colonist in either of the last 2 majors,
             1.15 if the last 3 majors were repelled with no one downed (max 1.3, decays back)
points    = clamp((40 + wealthPts + popPts + floorPts) * difficulty * storyteller * defenceAdj, 40, 4,000)
```

Wealth counts at 50% for walls, floors and defences (so building defences does not invite bigger raids at full rate). Typical budgets: day 5 Camp about 70, day 30 Hamlet about 250, day 80 Village about 600, year 3 Hold about 1,200, Stronghold about 2,000.

**Raider costs** (`js/data/raiders.js`, from `enemies.js` and `enemies-p4.js`):

| Raider | Points | Notes |
|---|---|---|
| Husk / Swift Husk | 20 / 28 | swarm |
| Gloom Hound | 30 | fast, hunts colonists |
| Shade | 45 | phases through walls in darkness; pinned by light 2+ |
| Hollow Knight | 90 | armoured, breaks walls |
| Warden affix | x1.6 | elite glow |
| Riftspawner | 160 | summons 1 Husk per 6 s; siege engine of the Hollow |
| Frost Wraith | 110 | chill aura, comes in cold snaps |
| Bog Witch | 120 | ranged curse (mood -10 for hit colonists) |
| Ash Imp | 35 | bursts into fire |
| Ash Wyvern | 220 | flies over walls, cannot enter overhead-roofed tiles |
| Reaver (club / spear / bow / crossbow / captain) | 40 / 55 / 55 / 80 / 120 | human raiders with real gear (it drops as loot) |
| Gutterkin thief / delver (sapper) | 25 / 50 | goblin art; delvers carry picks |
| Wolf / boar / cave spider / great spider | 25 / 30 / 35 / 140 | beasts |

Composition rules: at most **60 raiders per raid and 80 hostiles on the map**. When the budget would exceed the cap, the composer swaps in elites and heavier types first.

### 9.3 Threat types

| Threat | Tier | When | Goal (flow-field target) | How it behaves | Ends when |
|---|---|---|---|---|---|
| **Hollow horde** | Camp | arrives at dusk or night from an edge | the Hearth (core field); attacks lights and walls in the way | Husks swarm, Hounds hunt colonists outside, Shades phase through dark walls, Knights siege | all dead, or dawn: Hollow in daylight on unroofed tiles take 3% hp/s and flee to the edge |
| **Thieves** | Camp | day | stockpile field: the most valuable reachable stacks | Gutterkin grab a stack and flee (old goblin logic re-keyed to items) | all fled or dead |
| **Beasts** (manhunter pack, spiders from an opened cavern) | Camp | any | colonists (people target) | attack the nearest colonist; spiders spin webs (slow) | dead, or 1 day passes (they wander off) |
| **Reaver warband** | Hamlet | day | colonists, then stockpiles | ranged reavers keep distance and use cover; the captain gives morale | 50% losses or the captain downed: they flee; downed reavers can be captured |
| **Sappers** (Gutterkin delvers) | Village | night | stockpiles and vault rooms; path cost through rock and walls | dig through natural rock (4x slower than a miner) and walls (by hp); the route preview shows the planned tunnel | the delvers die or flee; their tunnels stay |
| **Hollow Rift** | Village | night, on blighted land | spawns a horde each night | the old Rift: a tear that spawns Hollow until **closed** (a colonist with Lore 6+ channels for 1 game hour at the Rift while guarded) | closed |
| **Breach from the deep** | Hold, or earlier if a tunnel comes within 15 tiles of the Hollow seep | night | colonists in tunnels, then the Hearth | the seep wakes; Hollow come through the tunnels instead of the edge: tunnel defence (doors, deadfalls, lights) matters | all dead; the seep can be **sealed** for 2 seasons with a Duskstone wall ring and a Ward stone next to it |
| **Siege** (reavers or Hollow Knights) | Hold | camp arrives by day | camp at 25-35 tiles from the Hearth, out of tower range | they build a ram or Riftspawner over 1-2 days, then bombard and assault | the camp is broken (engine destroyed, or 50% losses), or the assault fails |
| **Wyvern** | Hold | day | the most valuable outdoor structure or colonist | flies, strafes, ignores walls; ballistas and archers on towers | dead or 40% hp (flees) |
| **Grey Pilgrims** (procession) | Village, Ashfall only | day | crosses the map edge to edge along a path near the colony | a choice letter: **let them pass** (they leave a 1-tile blight trail and no fight) or **fight** (tainted mourners: every wound has 30% taint) | they leave the map |
| **Hollow Lord** (great incursion) | Hold / Stronghold / Crownhold | see 9.6 | per Lord | the old boss modules | the Lord is destroyed (or the colony falls) |

**Raid AI** (`js/game/threat/raiders.js`, adapted from `enemies.js` and `foes.js`):
- Each raid has `goal` (core, loot, people, dig) and `morale` (0-100). Raiders follow the flow field for their goal; a raider with a target in `engage.js` range fights it.
- **Flow fields** (`js/game/threat/flow.js`): at most 3 live at once (core, loot, dig), only while hostiles of that goal are on the map. Each field is **built whole inside one tick** (a bucket-queue Dijkstra over u16 costs: target < 1.5 ms on an A15 at 128, bench gate < 0.6 ms desktop) on ticks where `tick % 10 == slot` (slot 0, 3 and 6 for core, loot and dig), and only if its inputs (hostile passability, and door and wall hp in 25% bands) changed since its last build. Between builds the last field is used. Fields and their build ticks are **saved while a raid is live** (u16 per tile, about 2-6 KB each after deflate), because a field built at tick T cannot be rebuilt at a later load tick; a load therefore continues with the same field (C13). The "people" goal uses A* per pack leader (re-pathed every 40 ticks, the path saved like a colonist's) with followers steering after it.
- Doors: hostiles must break them (door hp). Locked gates count as walls. Raiders score paths with wall hp as cost (the old siege commitment logic), so a weak spot in the wall draws them.

### 9.4 Warnings

Every scheduled threat goes through three warning stages. The information shown grows as arrival nears:

| Stage | When | Shows |
|---|---|---|
| **Omen** | the warning tick (6-24 h ahead, per storyteller) | letter + a **countdown chip** in the top bar ("Hollow horde: 14 h"), the threat type and the **edge** (an edge marker on the map and the minimap) |
| **Sighted** | 4 h before | approximate size ("about 12"), the main enemy types, a **route preview line** from the edge to the goal (the old `waves.js` route preview) |
| **Imminent** | 1 h before | exact composition, the game drops to 1x, auto-pause if the setting is on |

- **Earlier warnings**: +2 h per manned watchtower on the threat's edge, +6 h with a Signal beacon (all edges), +12 h with the Starglass Observatory (Lanternhold). Lead time never exceeds 36 h.
- **Without warning**: fires (smoke and a flame icon, the fire emergency of 5.1 responds), cave-ins (2 s rumble and cracks; with the Cave Sense perk 2 h of crack overlay), beasts from a cavern the colony just opened (the cavern discovery itself is the warning: a letter says "something moves in the dark").
- Disasters have their own warnings in 9.7.

### 9.5 Defence gameplay

- **Draft** (button on the colonist card, the colonist rail long-press, or "Draft all soldiers" on the threat chip). Drafted colonists stop work, equip their soldier outfit at the nearest armoury rack if it is within 20 tiles, and take orders.
- **Squads**: up to 4 squads (6 with the War Room). Each squad has a colour, a banner (heraldry art) and a rally point. Orders: **Move** (tap a tile), **Attack** (tap a hostile), **Hold** (stay and fire at will), **Guard** (tap a zone: `engage.js` guardZone), **Retreat** (to the shelter zone). Squad leaders path; members keep formation offsets.
- **Positioning matters**: barricades and walls are cover (ranged hit -40%); embrasures and towers (+3 range, sight 12, ranged hits on the archer -50%); **light**: Hollow take +25% damage on lit tiles (light 2+) and Shades are pinned (cannot phase) on them; chokepoints through gates and tunnel mouths; overhead-roofed tunnels stop wyverns and fire.
- **Defensive structures** (7.7): towers need a soldier during the Night watch schedule or a drafted archer. Traps rearm by a hauler. The Hearth fires on its own at night. Mage spires and Lumen lamps need no operator.
- **Civilians**: when the alarm bell rings (or the threat reaches Imminent with "auto-shelter" on), non-drafted colonists go to the **Shelter zone** (a zone type) and wait. Colonists outside a shelter whose path crosses a raider's line of sight get the "Under threat" alert.
- **After the fight**: downed hostiles can be **captured** (Care work: rescue to a prison bed); corpses get a "Burn or bury" auto-designation (Hollow leave **greyash** filth: dread +1 until cleaned); damaged structures get auto repair designations; loot stays where it fell, forbidden until the raid ends.
- **Mood**: a repelled raid gives "We held the line" +6 x 2 days; a death gives the death thoughts (4.5).

### 9.6 Hollow Lords

The three bosses (`bossart.js`, `colossusart.js`, `kingart.js`, logic from `boss.js`, `colossus.js`, `hollowking.js`) are long-term goals, not random raids.

| Lord | Available from | Behaviour (old module, telegraphs kept) | Weakness | Reward |
|---|---|---|---|---|
| **Gloomwyrm** | Hold | flies over walls, strafes with a telegraphed line, snuffs lights it passes | ballistas, crossbows, lit ground (it lands to bite in the dark) | Lord's Ember, Wyrm-bone trophy, 20 wyrm scales (armour material x1.4) |
| **Bone Colossus** | Stronghold | walks through walls, slam telegraph, weak spot on its back | mauls and halberds at the weak spot, deadfalls | Lord's Ember, Colossus skull trophy, 60 bone |
| **Hollow King** | Crownhold, after another Lord | summons Knights, snuffs braziers, teleports between dark tiles | full light coverage, silver and lumensteel | Lord's Ember, the King's circlet (Legendary art) |

- **Challenge or wait.** At the tier, a **Challenge Pyre** (Monuments menu) can be built. Lighting it schedules the Lord 2 days later. If the player never lights it, the Lord comes on its own 2 seasons after the tier was reached, with a 2-day warning. So the player can prepare, but cannot avoid it forever.
- A Lord's raid brings an escort worth 40% of the normal threat budget.
- If the colony repels a Lord's escort but the Lord survives (it retreats at 25% hp), it returns in 1 season with its hp carried over.

### 9.7 Disasters (`js/data/incidents.js`, cat `disaster`)

| Disaster | When | Warning | Effect | Counterplay |
|---|---|---|---|---|
| **Fire** | lightning in Highsun storms, Ash Imps, Pyromaniac breaks, unattended forges (1%/day, 0 with a stone floor) | flames and smoke; the fire alert and the fire emergency (5.1) | spreads to flammable tiles and adjacent wood (cellular, every 10 ticks), burns items and props | stone floors and walls, wells (x2 extinguish speed), keep colonists near the home area |
| **Blight surge** | Ashfall | 1 day ("the grey stirs at the edge") | blight +60 on 30-80 edge tiles, spreads toward unlit land | Ward stones, light, Waystones, Seed Vault |
| **Crop blight** | Thaw and Highsun | none (the first infected crop shows grey) | spreads crop to crop, 1 tile/hour | harvest early, scarecrows, Seed Vault |
| **Grey Cough** (plague) | any, more in Deepcold | the first cough | contagious in shared rooms; immunity race over 5-10 days | bedrooms over barracks, doctors, bathhouse, clean infirmary |
| **Cave-in** | lost support (3.4) or a **Deep tremor** event (Village+) | 2 s rumble and cracks; a tremor letter 6 h ahead marks 5-20 weak tiles | collapse to rubble, damage, buried items | support pillars and props, avoid risky mining |
| **Cold snap** | Deepcold, sometimes Ashfall | 1 day | -15 C for 3-6 days; outdoor crops die; Frost Wraiths more likely | fires, walls and roofs, wool and fur, stored food |
| **Drought** | Highsun | at season start (the season letter forecasts it) | crop growth x0.5, fire chance x2 | wells by the fields, the river, Moonwell |
| **Flood** | Thaw | 12 h ("the river swells") | river-side tiles within 2 become shallow water for 2 days; items there wash away (25%) | build above the floodplain, granaries |
| **Vermin** | any | none | -20% of food in non-granary, non-barrel stores | granaries, barrel racks, ice house, underground cellars |
| **Long Eclipse** | Village+, rare | 1 day | a full day of night: Hollow active and strong, crops do not grow | lights, food reserves |
| **Ember gutter** | rare | none | the Hearth loses 3 days of fuel | keep a fuel stock |

### 9.8 Positive events and visitors

| Event | Tier | Frequency | What happens |
|---|---|---|---|
| **Wanderer joins** | Camp | 8-14 days | a letter with the colonist's card: accept or refuse |
| **Migrant group** | Hamlet | on tier-up, and in Thaw | 2-4 colonists; refuse costs nothing |
| **Refugees** | Hamlet | rare | 2-5 wounded colonists; accepting schedules a reaver raid in 1-2 days |
| **Trader caravan** | Hamlet (Camp: 1 pedlar) | every 8 days (Tradehold 5) | arrives at the trade post (or the Hearth) and stays 1 day. Types: **Ironmonger** (metals, tools, weapons), **Clothier** (cloth, apparel, dyes), **Grain barge** (by river: food, seeds, animals), **Gem broker** (gems, jewellery; buys art), **Hollow-hunter company** (silver weapons, ember tonic, hires out 1 soldier). Prices: base value x (1.4 buy / 0.6 sell) adjusted by the Envoy's Social |
| **Wandering hero** | Village | rare | one of the 12 hero classes asks to join for a task (deliver 2 fine meals per day for 5 days, or build them a Fine bedroom) |
| **Envoy with a request** | Hamlet | 1 per season | a world faction asks for goods by a deadline (40 bread to the River League, 10 iron spears to the Hearthwatch); rewards goodwill, silver, a tech tablet or a colonist |
| **Bountiful season** | Camp | 1 per year | crop yields +30% for the season |
| **Herd passing** | Camp | 2 per year | 6-12 deer cross the map (hunting) |
| **Starfall** | Village | rare | a lumenite meteor lands on the surface (5 lumenite ore and a crater) |
| **Old cache** | Camp | when exploring ruins | loot chest with items; sometimes a dormant Husk guard |
| **Year's Turning** | Hamlet with a Great hall or tavern | each year end | a festival: everyone gathers 4 h, +8 mood for 2 days |

**World factions** (`js/data/factions.js`, new; not the old factions): the **River League** (traders), the **Hearthwatch** (remnant knights, envoys and refugees), the **Ashfang Reavers** (raiders), the **Gutterkin** (thieves; can be paid off: 200 coins halves their raids for a season), the **Grey Pilgrims** (neutral, tainted). Goodwill -100..100 for the League, Hearthwatch and Gutterkin changes prices, envoy frequency and whether a captured raider can be ransomed. No diplomacy screen: goodwill is a line in the Colony panel and letters.

### 9.9 Failure and legacy

- **The colony falls** when no free, able colonist remains: all dead, all downed with nobody to rescue for 24 h, all in extreme breaks, or all captured. The screen "The Hearth goes cold" shows the Chronicle summary (years, deeds, the dead).
- **Reclaim (default).** A new band of 3 arrives on the same map 1-3 seasons later (the time skip is simulated as a quick decay pass, not the full sim):
  - structures are at 30-70% hp, 20% of roofs and props collapse, food rots, 50% of other items are looted;
  - the dead lie where they fell, unless buried; unburied ones have risen as Husks that sleep in the ruins;
  - a **Hollow nest** sits on the cold Hearth: clearing it (a raid-sized fight with warning, on the player's schedule) and rekindling the Hearth returns the old claims;
  - kept: the map, exploration, techs (all of them, as "lore remembered"), the Chronicle, deeds, the charter if the Hearth is rekindled, and the nemeses; lost: the colonists; the Lords already defeated stay defeated;
  - the band gets one **heirloom**: the best named item of the fallen colony.
- **New colony** on a new seed is always available from the colony list.
- **Reload**: outside Ironhold, the colony list offers the backup slot (up to 60 s to 1 game day older) for any colony. Ironhold colonies have a single slot and the fall is final, except for Reclaim.
- Reclaim also carries over the living **nemeses** (9.10): the new band inherits the old hold's enemies.

### 9.10 Actors, nemeses and consequences (`js/game/threat/cast.js`, `nemesis.js`, `aftermath.js`; data in `incidents.js`, `text/nemesis.js`)

Points decide how big a threat is; the cast decides who it is about. Every incident can name actors and leave something behind.

**Cast selectors** (data, evaluated when the incident is planned; ties broken by colonist id; the result is saved in the queue entry):

| Selector | Picks | Used by |
|---|---|---|
| `lowestMood` | the unhappiest able colonist | a Hollow-whisper omen (a dream letter); Grey Pilgrims (one of them asks to join the procession) |
| `rivalPair` | the pair with the lowest opinion | a brawl minor; a duel challenge during a reaver raid |
| `captainSlayer` | the colonist who downed the last raid captain | a reaver vengeance raid: its captain hunts them (the route preview ends at their bed) |
| `bestCrafter:<skill>` | the top holder of a skill | commissions (Forgehold); thieves target that colonist's workshop |
| `newest` | the latest arrival | "a face from the past": kin among the raiders (spare or fight) |
| `wounded` | a tainted or badly wounded colonist | Hollow hordes path toward them (they smell the taint) |

The letter names them ("They come for Bryn, who felled Vask at the ford").

**Nemeses** (`s.st.nemeses`, at most 6 alive):
- A reaver captain who flees or is ransomed, a Gloom Hound alpha, or an elite Hollow (warden affix) that survives to dawn becomes a **nemesis**: a generated name and an epithet from its wound ("Vask the Ash-Jawed", "the Hound with the Split Ear"), its scar recorded, and a **grudge** against the colonist who wounded it most.
- It returns after 1-2 seasons leading a major of its kind, with +1 affix per return (data list: armoured, swift, rallying, burning) and its grudge target in the cast. The omen letter shows its portrait with the scar.
- Killing it writes a Chronicle deed and drops a named trophy (its weapon or a fang). A nemesis that kills its target gains a title and returns once more.

**Aftermath** (each major rolls 0-2 entries from its `after` list):

| Aftermath | From | Leaves |
|---|---|---|
| Siege-camp ruin | sieges | the camp's palisade, tents and wrecked engine stay on the map: salvage wood and iron, or keep it as an outpost |
| Captive | reavers, Pilgrims | a downed raider with a backstory card (deserter, conscript, or a spy 15% of the time): recruit, ransom or release |
| Blight scar | Hollow hordes and Rifts | a 3-8 tile blight patch where they fell, until cleansed |
| Stolen heirloom | thieves | the most valuable named item is carried off; 3-10 days later an envoy says where the thieves' camp is: send a squad off-map (letter-resolved) or buy it back |
| Wreckage and gear | reavers | real weapons and armour where they fell (the Armourer refits them) |
| A hero's memory | the death of a Master | a goal: "Raise a statue of Hal" within 10 days for a lasting +3, or "Hal is forgotten" -4 |

---

## 10. Phone UX

Rules for every screen: touch only, targets >= 44 pt, text >= 14 px (body 16 px, numbers in grids 17 px), SVG icons from `icons.js` (no emoji), safe-area insets, no hover, no horizontal page scroll, one-thumb reach for the common actions (bottom of the screen). **The budget is the Safari browser viewport, not the screen**: most players start in a Safari tab, where the toolbar takes the bottom of the screen.

### 10.1 Layout

Planning viewports (the Stage 0 spike measures them on device and writes the real values into `balance.js` LAYOUT; the gate tests these sizes):

| Context | Viewport (pt) | World height, nothing selected | With a peek card (rail hidden) |
|---|---|---|---|
| iPhone 13 mini, Safari portrait | 375 x 635 | 483 | 415 |
| iPhone 13, Safari portrait | 390 x 664 | 512 | 444 |
| Pro Max, Safari portrait | 430 x 740 | 588 | 520 |
| iPhone 13, Home Screen app portrait | 390 x 763 | 611 | 543 |
| iPhone 13, Safari landscape | 844 x 335 (47 pt safe areas left and right) | 291 | full height; the card is a 320 pt overlay |

**Portrait:**
```
+------------------------------------------+  safe-area top
|[=] D14 Thaw 09:40 |[Horde 14h]|[food 6d v]|   top bar 44 pt
|(o)(o)(o)(o)(o)(o)(o)(o)  >                |   colonist rail 52 pt (h-scroll; hides under any card or sheet)
|                                       [!]|
|              world canvas             [!]|   alert stack (right edge, 44 pt icons, 4 visible + "+N")
|                                       [!]|
|[map]                                      |
+------------------------------------------+
| [>>] | Build | Orders | Zones | Colony   |   bottom bar 56 pt + safe-area bottom
+------------------------------------------+
```
- **Top bar (44 pt)** at 375 pt: Menu icon (44) + clock (about 105: "D14 Thaw 09:40" at 15 px tabular figures; below 380 pt the season becomes a 20 pt glyph) + threat chip (flexible, at least 44: icon + "14h"; absent when nothing is scheduled) + stock chip (72: "food 6d" and a chevron), with 8 pt gaps: 340 of 343 pt. The stock chip expands a two-row strip over the rail (food days, wood, stone, steel, meals, up to 4 pinned kinds) that closes after 4 s or on a tap; a long-press opens the Stock tab.
- **Colonist rail (52 pt)**: 44 pt portraits with mood ring, rank border and alert badge. It hides while a peek card or sheet is open.
- **Bottom bar (56 pt)**: the **speed button** at the left (the thumb's easiest spot; mirrored by the left-handed setting) and 4 tabs of 72 pt.
- **Peek card (120 pt)**: the default for any selection, sitting on the bottom bar. Colonist: portrait, name, role chip, current job, mood bar, 3 actions (Draft, Role, Prioritise). Building: name, status or current bill, 3 actions (Bills, Upgrade or Spec, Copy). Item: Forbid, Haul now, Locate. Zone: Preset, Expand, Delete. Raid: composition, Draft all soldiers, Jump to edge.
- **Full sheet**: a second tap on the same subject, or dragging the card up, opens it at 75% height (the world above stays live and pannable); drag to 92% or down to close.
- **Tool bar** replaces the bottom tabs while a tool is active: tool name, mode chips (Add / Remove, Risky mining, pillar pattern), Undo (last 5 s), Done. The speed button stays.

**Landscape (844 x 335):** one 44 pt top row (Menu, clock, threat chip, stock chip, then the colonist rail inline, scrolling); the bottom bar becomes a 56 pt vertical rail on the right with the speed button at its bottom, near the right thumb; the alert stack sits left of it. Peek cards and sheets are a **320 pt overlay panel** from the right, over the canvas: the canvas never resizes, the camera shifts so the selection stays visible left of the panel.

### 10.2 Gestures

| Gesture | No tool | In a tool (designate, zone, build, stamp) |
|---|---|---|
| One-finger drag | pan | paints the tool: rectangle (designations, zones, floors, stamps, carve), line (walls, fences, tracks) or single (furniture, paste) |
| Two-finger drag | pan | pan |
| Pinch | zoom (0.3-2.0) | zoom |
| Tap | select: **colonists win**: a tap within 22 pt of a colonist's (or a pip's) centre selects the nearest colonist; a second tap on the same tile cycles item > building > zone > tile; a second tap on the same colonist opens the full sheet | single-tile apply |
| Long-press (450 ms) | context menu for the thing under the finger (colonist: Draft, Prioritise..., Follow; item: Forbid, Haul now; building: Copy, Upgrade, Bills) | erase mode for that stroke |
| Two-finger tap | pause / resume, **only if enabled in Settings (off by default)**: it can fire when a pinch starts | same |

- **Loupe**: during any tool drag a 120 pt loupe appears 80 pt above the finger showing the tiles at 2x with the rectangle edges, and the rectangle size ("6 x 4, 18 tiles") in 16 px text. Without it, small tiles under a thumb cannot be aimed.
- **Edge scroll**: dragging within 40 pt of the screen edge in a tool scrolls the camera.
- **Prioritise**: with a colonist selected, long-press a target (rock, frame, bench, patient) and pick "Prioritise: Mine here". This is the RimWorld "force job" and it is how the player overrides roles for one task.
- **Drafted orders**: with drafted colonists selected, tap a tile to move, tap a hostile to attack; the order line (old art) shows the order for 1.5 s.
- Under zoom 0.5 colonists are drawn as pips (12.4) whose hit area is 44 pt whatever the zoom.

### 10.3 Menus

- **Build** (the Architect): a horizontally scrolling strip of icon-and-label tabs (each at least 64 x 44 pt): **Rooms** (the stamps, 10.11), Structure, Housing, Storage, Farm, Workshops, Furniture, Defence, Light, Utility, Civic, Monuments, Charter. Each tab is a 2-column grid (3 in landscape) of cards: icon, name, cost in item icons, tier badge. Locked cards stay visible, greyed, with the reason in one line ("Needs Smelting", "Needs Village"). Tapping a card starts placement: a ghost follows the finger with a green/red footprint, a **material chip** (Granite / Limestone / Wood...) and a **rotate** button. Walls, fences and floors place by drag.
- **Orders**: Mine, **Carve hall**, Chop, Harvest, Haul, Hunt, Tame, Smooth, Engrave, Prospect, Deconstruct, Forbid / Allow, Cancel. Each is a tool.
- **Zones**: Stockpile (preset first), Grow, Pen, Burial, Dump, Shelter, Roof, No roof, Home area (where colonists clean and fight fires), Allowed area (per-colonist restriction). Zone tools: New, Expand, Shrink, Delete.
- **Colony** opens a sheet whose tabs are a scrolling icon-and-label strip (the selected tab centred): **People** (list with roles), **Work** (roles; Advanced grid), **Schedule**, **Research**, **Stock** (all items by category with counts, tap to find on map), **Chronicle**, **Hold** (tier progress, charter, Hearth, factions, wealth, nemeses).
- **Menu** (the top-left icon): Save now, Back up (share sheet), Colonies, Settings, Help, Quit to title.

### 10.4 Roles and the work grid

- **Default (Roles)**: the People and Work tabs list colonists with a primary-role chip and a second-role chip (44 pt each). Tapping a chip opens a role picker: a 2-column grid of the 13 role cards (icon, name, key work), the best-suited ones marked by skill and passion. A coverage row at the bottom warns when a key work has nobody at priority 1 or 2 ("No one cooks").
- **Advanced grid** (toggle): rows are colonists (portrait 32 pt and first name, sticky left column 96 pt); columns are the 13 work types, header icons 44 pt; tap a header for its name and to sort rows by that skill.
  - Portrait: **3 pages of at most 5 columns**: Labour (Haul, Chop, Mine, Build, Grow), Make (Cook, Smith, Craft, Tailor, Art), Care (Care, Animals, Lore), chosen by a segmented control. 96 + 5 x 48 = 336 pt fits the 343 pt content width at 375. Landscape: 2 pages of 7 and 6 columns (96 + 7 x 48 = 432 pt).
  - A cell shows the priority number (17 px, bold for 1, faint for 4, empty when off) over a **skill bar** (4 pt tall, length = level / 20) and a flame mark for a passion (keen: one, burning: two). No small text inside cells.
  - **Tap** cycles 1 > 2 > 3 > 4 > off > 1. **Long-press** opens a picker (1, 2, 3, 4, off, "Whole row", "Whole column"). A disabled work type (backstory) shows a hatched cell that does not respond. Any edit marks the colonist "Custom".

### 10.5 Colonist inspection

Tapping a portrait or a colonist opens the colonist **peek card** (10.1); a second tap or a drag up opens the sheet:
- **Header**: name, profession and rank, role chips, mood bar with the break thresholds marked, current job ("Mining granite"), buttons **Draft**, **Follow** (camera lock), **Locate**.
- **Tabs** (a scrolling icon-and-label strip): **Needs** (up to 5 bars, the top 6 thoughts with values and time left), **Skills** (15 rows: level bar, passion, XP to next, perk icons; tapping a row explains what the skill affects), **Health** (a simple body figure with wounded parts tinted, wound list with tended state, taint meter), **Gear** (slots, outfit picker), **Social** (5 strongest relations), **Log** (the colonist's last 20 events), **Bio** (ancestry, backstory, traits with plain-language effects).
- Swipe left/right on the header to go to the next/previous colonist.

### 10.6 Alerts, letters and notifications

| Kind | Examples | Presentation |
|---|---|---|
| **Letter** (major) | raid omen, nemesis returns, wanderer, trader, tier reached, charter choice, perk choice, Ember-touched demand, Lord challenge | a card sheet with text and choices; auto-pause option; stays in the Letters list |
| **Alert** (condition, persistent while true) | starving, bleeding, mood break risk, idle colonists, no doctor, food < 3 days, Hearth fuel < 1 day, unburied corpses, stockpile full, bed missing, taint rising, demand unmet | right-edge icon stack (4 visible, "+N"); tap: jump to the subject; long-press: explain and "snooze 1 day" |
| **Toast** (transient) | discovery, masterwork finished, research done, skill rank up, signature perk | the existing one-lane toast queue under the top bar, 3 s |
| **Threat chip** | countdown to the next known threat | top bar; tap: jump to the edge and show the route preview |

Audio cues accompany letters (bell), threat stages (horn, faster drums) and discoveries (a chime). No system notifications: the game does not run in the background (D4).

### 10.7 Speed and pause

- One 56 pt **speed button** at the left of the bottom bar. **Tap**: pause or resume. **Hold 250 ms**: a fan of four 48 pt buttons (1x, 2x, 3x, 5x) arcs above it; slide onto one and release, or tap one. The button shows the current speed as 1-3 chevrons (5x: three chevrons and a dot) and an amber ring when paused. 5x is greyed with its reason while blocked (D3).
- Auto-slowdown rules in 2.2. When paused, a thin amber frame around the canvas and the word "Paused" (16 px) show it.
- Two-finger tap pause is a secondary control, off by default (10.2).

### 10.8 Information architecture

```
Title: Continue | Colonies | New colony | Settings | Import | Play the classic Embercrown (/classic/)
  New colony: Start (8.5) > Band (colonists, rerolls, suggested roles) > Storyteller + difficulty > Map seed + size > Name + banner
In game
  Top: Menu, clock+season, threat chip, stock chip; colonist rail (tap: peek card)
  Right: alerts
  Bottom: Speed | Build | Orders | Zones | Colony (People, Work, Schedule, Research, Stock, Chronicle, Hold)
  Selection: peek card first, then the full sheet: colonist, building (bills, owner, tier/spec, fuel), item, zone (filters), raid (composition)
  Cards: Dawn Ledger, Next steps, demand card, A2HS and backup prompts
```

### 10.9 Onboarding and pacing (`js/ui/coach.js`, rewritten tips)

The Hearthwatch Remnant start has a guided opening as a **checklist card** (collapsible, at the top-left of the world view), one step at a time, each step detected from state, never forced. The pacing goal: **the first room and the first warning within about 15 minutes of play.**

| When | Steps |
|---|---|
| Day 1, 06:00-16:00 at 1x (about 5 min) | Chop 10 trees (Orders > Chop, drag over them) · Make a stockpile next to the Hearth (Zones > Stockpile, pick "All") · then the coach: "Hold the speed button for 3x" |
| Day 1 16:00 - day 2 18:00 at 3x (about 4.5 min) | Carve into the mountain (Orders > Carve hall, drag on the rock face) · Build a mason's bench (it adds "Blocks, until 100" by itself) · Stamp your first room (Build > Rooms > Bedroom, drag 5 x 4) · Read the room's tier |
| Day 2, 18:00 | **The first omen**: a coach card on warnings, drafting and light; "Place 2 braziers by the door" |
| Day 3, 21:00 | The first horde (3-4 Husks): "Draft, then Hold at the door" |
| Day 4, 06:00 | The Dawn Ledger and Next steps (10.10) take over from the coach |

- **Add to Home Screen**: after the first room is built (not at first launch), in a Safari tab only (`navigator.standalone` false), a card: "Keep your hold safe: add Embercrown to your Home Screen" with the 3 iOS steps (Share > Add to Home Screen > Add) and a note that the app gets the full screen height. It mentions "Move colony to the app" (11.5). Shown at most twice per colony.
- Menus show **only what the tier and techs allow**, plus locked cards with reasons. Charter, research and trade appear with their first letter.
- Every panel has a "?" that explains it in 2-3 short lines.
- **Help** (Menu > Help) lists the core mechanics as short cards (Roles, Stockpiles, Bills, Rooms and stamps, Light and the Hollow, Digging and support, The hooks of section 1).
- Settings: text size (100/115/130%), reduce motion, colour-blind-safe overlays (designations use patterns as well as colour), auto-pause rules, Advanced work grid, two-finger-tap pause, battery saver (30 fps always), left-handed layout (speed button and alert stack mirrored), storage (11.2).

### 10.10 Dawn Ledger and Next steps (`js/ui/ledger.js`; rules in `js/data/advice.js`)

Short sessions need a reason to act in the first minute.
- **Dawn Ledger**: a one-card summary shown at 06:00 each game day (toast-sized, tap to expand) and on every resume (D4). Lines: **built** (rooms by role, structures), **crafted** (counts by category, named items), **learned** (rank-ups, perks), **found** (discoveries), **lost** (deaths, stolen items, collapses) and **open alerts**. Counters live in `s.colony.ledger` (saved, reset at 06:00).
- **Next steps**: after the coach ends, the same card shows 3 suggestions from data rules `{ id, when: s => bool, score: s => n, text, go: { panel | tool } }`, for example "Food lasts 2 days: add a grow zone", "Iron found: build a bloomery", "Bryn is idle: give her a role", "Horde in 14 h from the east: 2 braziers by the east door". Each has a Go button. The top 3 by score that were not dismissed in the last 2 game days show. About 30 rules ship in Stage 2 (G owns the data, I the card).

### 10.11 Stamps, carve and copy (`js/game/tools/stamp.js`, `carve.js`, `copy.js`)

The largest tap savers in the design; all three use the loupe and the Undo chip.
- **Room stamps** (Build > Rooms): Bedroom, Dorm, Workshop, Dining hall, Store, Infirmary, Barracks, Plain room. Drag a rectangle (at least 3 x 3 inside). It places wall blueprints on the border (existing rock and walls are reused, so a stamp inside a carved hall adds only the missing walls), one door on the side nearest the Hearth (drag the door marker to move it), floor blueprints inside (material chip), and with **Furnish** on (default) the set for the room: Bedroom = bed, end table, sconce; Dorm = 1 bunk per 6 tiles; Dining hall = tables and chairs for its size; Workshop = the chosen bench and a shelf; Store = a stockpile with the Store preset. One command: `stamp {kind, rect, wallMat, floorMat, door, furnish, bench?}`. A 5 x 4 bedroom costs Build, Rooms, Bedroom, drag, Done: 5 taps.
- **Carve hall** (Orders > Carve hall): drag a rectangle in rock. It designates the whole rectangle for mining except a pillar plan that meets the Chebyshev-4 support rule (3.4): **Natural pillars** (leave one rock tile on a 9-tile grid aligned to the rectangle centre; free; default), **Built pillars** (mine everything and queue stone pillars at the same points, installed as soon as their neighbours are open), or **Props** (timber). The preview shows the plan; the player can drag one pillar marker to shift the whole grid. "Smooth walls" in the same command queues smoothing of the hall's faces. `carve {rect, pattern, smooth}`.
- **Copy and paste**: a selected room's peek card has Copy. It stores the room's walls, door, floors and furniture (relative layout and materials) as a template (up to 8 in `s.colony.templates`). Paste places blueprints at the finger with rotate and a red/green footprint: `paste {templateId, x, y, rot}`.

---

## 11. Persistence and saves (`js/game/save/codec.js`, `fields.js`, `colonysave.js`, `slots.js`, `idb.js`; `js/engine/save.js` adapted)

### 11.1 Storage risks on iPhone Safari, and the answers

| Risk | Answer |
|---|---|
| GitHub Pages serves all of the user's projects from one origin (`<user>.github.io`); the about 5 MB localStorage quota is shared with all of them and with the classic game's `embercrown.*` keys | Colony blobs live in **IndexedDB** (its quota is a share of disk, hundreds of MB), as raw bytes. localStorage holds only small keys (11.2), under 300 KB in total |
| localStorage strings cost about 2 bytes per character and base64 adds 33% | No base64 in IndexedDB; base64 only for text export and the quick-save |
| Safari deletes all script-writable storage after 7 days of Safari use without a visit to the site | A Home Screen app has its own storage and usage count, so onboarding prompts Add to Home Screen (10.9); in a Safari tab, the backup prompt (11.5) runs on a real-time clock; `navigator.storage.persist()` is requested on first save and its answer is shown in Settings > Storage ("protected" or "may be cleared") |
| A Home Screen app has a separate storage container: a colony started in a Safari tab is not in the app | **Move colony to the app** (11.5) |
| Eviction happens anyway | The Colonies screen notices a colony whose blob is missing (index present but IndexedDB empty, or both gone) and offers Import with the last backup's name and date; the persist test simulates eviction (14.4) |

### 11.2 Keys and stores

**IndexedDB** database `ec2`, version 1:

| Store | Key | Value |
|---|---|---|
| `slots` | `<colonyId>:a`, `:b`, `:dawn` | `{ bytes: Uint8Array (the EC2 blob), tick, day, savedAt, crc }` |
| `meta` | `<colonyId>` | the colony card: `{ name, banner, day, tier, pop, storyteller, iron, lastPlayed, bytes, size, newest: 'a' \| 'b', lastBackupAt, a2hsShown }` |

**localStorage**:

| Key | Content | Size |
|---|---|---|
| `ec2.index` | mirror of the `meta` cards, so the title screen draws without waiting for IndexedDB | < 4 KB |
| `ec2.settings` | settings (not part of any colony) | < 2 KB |
| `ec2.quick` | the emergency quick-save of the current colony only: `{ colonyId, tick, text }` (text = "EC2:" + base64), written synchronously on `pagehide` and `visibilitychange` hidden | 70-270 KB |

- Up to **8 colonies** (IndexedDB has room for more; 8 keeps the list short on a phone).
- On launch, if `ec2.quick` is newer than the newest IndexedDB slot of its colony, it is decoded, CRC-checked, written into the older slot and removed.
- IndexedDB unavailable (rare; some private modes): the game runs with one colony in localStorage (`ec2.c.<id>.a` and `.b`, text form) and shows the alert "Storage limited: export to keep your hold".
- `QuotaExceededError` on the quick-save: skip it (the last IndexedDB slot stands) and raise the alert "Storage nearly full: back up or delete a colony".
- **Classic keys**: `/classic/` still reads and writes `embercrown.run`, `embercrown.meta` and `embercrown.run.broken`. The colony game never writes or clears them. Settings > Storage shows their size and offers "Export and clear classic saves" (export first, then remove).

### 11.3 Save blob format (`EC2`)

```
EC2 blob  = MAGIC 'EC2\0' | u16 formatVersion | u16 stateVersion | u16 w | u16 h | u32 tick | u32 crc32(payload)
            | u8 compression (1 deflate-raw, 2 RLE) | payload
payload   = compress( LAYERS | ENTITIES | RUNTIME )
LAYERS    = for each layer in a fixed order: u8 layerId, u8 encoding (0 raw, 1 bitset), u32 byteLength, bytes
            order: terrain, mat, ore, floor, roof, plant, growth, blight, zone, desig, fog(bits), known(bits)
ENTITIES  = u32 length + UTF-8 JSON of { meta, colony, st, col, items, bld, zones, anim, foes, raids, rel, chron, rng }
RUNTIME   = u32 length + the saved runtime of contract C13: think queue, path queue, per-mover paths (u16 tile lists
            with cursors), unreachable memories, and, only while a raid is live, the flow fields (u16 x N each) with
            their build ticks and input stamps
Text form = "EC2:" + base64(blob)      (text export, clipboard, the quick-save)
```
- **One deflate over the concatenated sections** compresses better than per-layer streams (large runs of rock, grass and zeros). Measured on the current map: 7.2 KB for 4 layers; with 12 layers and mined areas expect 10-20 KB late game. A live raid adds 2-6 KB per flow field.
- **Entities as positional arrays** with a field list per entity type (`js/game/save/fields.js`), for example a colonist is `[id, name, anc, age, look, bs, attrs, skills(15 x [lvl, xp, passion, today]), traits, needs(5), mood, health, gear, sched, role, prio(13), job, path, x, y, ...]`. Items are one flat int array `[k, m, q, n, x, y, hp, flags, age, ...]` per stack plus a side table for named items. Expected raw entity JSON at 30 colonists, 2,000 stacks and 1,500 buildings: about 150 KB, deflated to 25-45 KB.
- **Derived data is not saved** unless C13 says so: `occ`, `itemAt`, regions, rooms, temperatures, light, depth, support, walk costs, stock totals, reservations (rebuilt from saved jobs), zone fields, indexes. `initRuntime(s)` rebuilds them; the determinism gate checks that a rebuild equals the live caches (14.4 (e)).
- Fallback when `CompressionStream` is missing (iOS < 16.4): compression byte 2, a 60-line sync RLE codec in `codec.js`. Both decoders are always available.

### 11.4 Continuous autosave

- **When**: every 60 s of real time while the game runs; on `visibilitychange` hidden and `pagehide`; after each letter is answered; on tier-up, raid end, colonist death and the year turn; on "Save now". Never during a frame that already exceeded its budget (it slips to the next idle frame). Save timing is real-time, but saving never changes sim state, so it does not touch determinism.
- **How** (target < 8 ms main-thread work on an iPhone 13 at 30 colonists; measured in the Stage 0 spike):
  1. `snapshot(s)`: copy typed layers (`slice()`), build entity arrays and the runtime section, `JSON.stringify` (sync, about 3-5 ms).
  2. `CompressionStream('deflate-raw')` (async, off the critical path).
  3. One IndexedDB `readwrite` transaction: put the blob into the older slot and update `meta`; on `complete`, update `ec2.index`. Then read the header back and check the CRC.
- Saves are **deterministic snapshots**: they include the RNG states, the tick, every colonist's job, toil index and path, raid plans, the storyteller queue with casts, and the C13 runtime section, so a reload continues identically (14.4).
- On `pagehide` the async path may not finish, so the lifecycle path also writes the **synchronous quick-save** (RLE + base64, about 10-15 ms) into `ec2.quick`; it is promoted on the next launch (11.2).

### 11.5 Colonies, export, import, backups and moving to the app

- The **Colonies** screen lists each colony as a card (banner, name, "Year 2, Ashfall day 4", tier, population, storyteller, size in KB, last played, last backup) with Continue, Back up, Load backup, Move to app (Safari only), Delete (a hold-to-delete button of 1.5 s).
- **Export**: the blob as a file `<name>-y<year>d<day>.ecsave` through the Web Share sheet (`navigator.share({ files })`: Save to Files, iCloud Drive, AirDrop), else a download; and "Copy as text" (the text form). **Import**: file picker or paste; it validates the magic, version and CRC, and adds the colony to the list (a new id if the id exists).
- **"Back up your hold" prompt**: once per game season at dawn, at most once every 3 real days, and always when the last backup is older than 6 real days while the game runs in a Safari tab. One tap opens the share sheet with the file. `lastBackupAt` is stored in `meta`. The prompt can be turned off in Settings only after the game runs as a Home Screen app.
- **Move colony to the app**: in a Safari tab, Colonies > colony > Move to app copies the colony as text to the clipboard and shows 3 steps (Add to Home Screen, open the app, tap "Paste a colony from Safari"). In the app, the title screen with no colonies shows "Paste a colony from Safari" (it reads the clipboard on the tap; falls back to the file picker). After a verified import the app says "Moved. You can delete the Safari copy"; nothing is deleted automatically.
- A save from a newer `stateVersion` refuses to load with a clear message; older versions go through `migrations[]` in `state.js` (the framework is kept, the list starts empty at colony v1). Every migration ships with a real, non-empty fixture in `tools/fixtures/` (the old 0-byte fixture is deleted).

### 11.6 Map size before module load

`grid.js` exports `let W, H, N` as live bindings plus `setMapSize(w, h)`; nothing allocates map-sized buffers at import (D1). `createColony` and `loadColony` call `setMapSize` from the header before `initRuntime`. That makes the 96 x 96 Small Vale and a later 160 x 160 option a header field, with no module reload.

---

## 12. Performance budget

Target device: **iPhone 13 (A15), Safari, DPR capped at 2**. 60 fps at 1x-3x with 30 colonists, 40 hostiles and 2,000 item stacks on a 128 map whenever the view moves or a fight is on screen; 30 fps when still (12.4). 5x renders at 30 fps.

### 12.1 Caps

| Thing | Cap | When exceeded |
|---|---|---|
| Colonists | soft 30, hard 40 | no more arrivals offered; births off |
| Hostiles on the map | 80 (60 per raid) | the composer upgrades to elites |
| Animals | 60 (tame + wild) | wild spawns stop; breeding stops at pen capacity |
| Item stacks | 4,000 (stone piles count; expected under 2,500 at day 300) | haulers merge stacks; a "Too many items" alert suggests a dump zone |
| Buildings + frames (walls count) | 3,000 | placement refused with a toast |
| Flame flicker | 64 flames nearest the camera centre | others static (all light comes from the light texture) |
| Particles | 900 (pool) | oldest recycled |
| Live flow fields | 3 | goals share fields |
| Nemeses alive | 6 | the oldest retires (a Chronicle line) |

### 12.2 Frame budget (16.6 ms)

| Part | Budget | How |
|---|---|---|
| Sim | <= 4 ms per frame at 3x (one tick per frame) | per-tick budgets below |
| Render | <= 8 ms | chunked terrain, culling, cached sprites, low-res darkness |
| UI / DOM | <= 1.5 ms | DOM updates batched at 4 Hz for the HUD; sheets update at 2 Hz unless touched |
| Headroom (GC, compositor) | about 3 ms | no per-frame allocations in the sim and the render loop |

### 12.3 Sim scheduling (20 Hz ticks)

| System | Cadence | Per-tick budget |
|---|---|---|
| Movement, combat, engage | every tick | about 0.1 ms at 30 + 40 movers (measured 0.06 ms desktop) |
| Think (job selection) | saved FIFO queue, at most 6 colonists per tick | <= 0.6 ms |
| A* | requests in a saved FIFO; **expansion budget 8,000 per tick** shared (about 1.5 ms on an A15). A search starts only while budget remains and always runs to completion (per-search cap `N*N/2`, 8,192 at 128), so no half-done search exists at the end of a tick. The region graph rejects unreachable goals first. If the 1b tunnel-maze bench misses budget, paths become hierarchical: A* over region links first, then local A* inside each region pair | <= 1.5 ms |
| Regions | regions are split at 16 x 16 cluster borders, with **two label sets**: colonist (doors passable) and hostile (doors are walls with hp; locked gates are walls). Dirty clusters and their links are relabelled at the end of the tick in which passability changed | about 0.02 ms per dirty cluster; full rebuild 0.3 ms |
| Zone distance fields | per filter group, at the end of a tick in which a zone was edited, filled up or freed (5.6) | <= 0.4 ms each, at most 8 groups |
| Needs and mood | each colonist every 20 ticks (`tick % 20 == id % 20`), integer maths | < 0.05 ms |
| Plants and growth | one 16 x 16 cluster per tick round-robin (64 ticks = whole map), growth scaled by elapsed ticks | < 0.1 ms |
| Item rot | 200 stacks per tick round-robin by index | < 0.05 ms |
| Rooms | dirty-area flood fill at the end of a tick in which walls, doors or rock changed | < 1 ms when it runs |
| Temperature | rooms and `rt.heat` at the end of a tick in which rooms or heat sources changed; base every 600 ticks | < 0.2 ms when it runs |
| Light map (`rt.light`) | per dirty light source, a flood fill blocked by walls, closed doors and rock, at the end of a tick in which a light, wall, door or fuel state changed, and at day-phase ticks | < 0.5 ms when it runs |
| Fire | every 10 ticks, cellular | < 0.1 ms |
| Flow fields | only with hostiles; at most one whole build per tick, on `tick % 10 == slot`, only when inputs changed (9.3) | <= 1.5 ms on the ticks it runs |
| Storyteller, tiers, wealth check | every 600 / 14,400 ticks | negligible |

**End of tick.** Everything above that runs "at the end of the tick" runs in `sim.js`'s `endOfTick(s)` in this fixed order: regions, rooms, temperature, light, zone fields, flow fields; each only if its dirty flag is set. Dirty flags are set only by the terrain API (C5) and the item and zone APIs (C6). This is how contract C13 holds: after any tick, every derived cache equals a rebuild from saved state.

The determinism rule for scheduling: every cadence derives from `s.tick` and entity ids, never from wall-clock time or frame rate, so 1x and 5x produce identical states.

### 12.4 Rendering a big map

**Terrain chunks in three bands.** A tile is 32 world units and zoom 1 is 1 pt per unit (`camera.js`), so the band sizes come from the largest phone viewport (430 x 932 pt):

| Band | Zoom | Chunk | TSCALE | Canvas | Max visible | LRU (1.5x) | Held at most |
|---|---|---|---|---|---|---|---|
| Near | >= 0.75 | 8 x 8 tiles (256 units) | 2 | 512 px, 1 MB | 24 | 36 | 36 MB |
| Mid | 0.45-0.75 | 16 x 16 tiles (512 units) | 1 | 512 px, 1 MB | 18 | 27 | 27 MB |
| Far | 0.3-0.45 | 16 x 16 tiles | 0.5 | 256 px, 256 KB | 32 | 48 | 12 MB |

- Band edges have ±0.03 hysteresis. Only the active band and its neighbour hold canvases (at most near + mid = 63 MB); the third band is released over the following frames.
- An evicted chunk sets `canvas.width = canvas.height = 0` before the reference is dropped: iOS frees canvas memory reliably only then, and its total canvas-memory cap includes the sprite cache.
- **Never blank**: while a chunk bakes, its rect draws the **tile-colour texture** (the minimap's W x H canvas, 1 px per tile) scaled up with smoothing off: coarse but correct.
- **At most 1 full chunk bake per frame**, nearest the camera first. Full bakes are only for chunks entering the view and band changes.
- **Patch redraw**: a mined, floored, smoothed or tilled tile redraws its 3 x 3 tile patch in place inside every held chunk that contains it (clip to the patch, redraw the 9 tiles with their autotile masks), about 0.1 ms, up to 8 patches per frame. `markDirty(tx, ty)` (called by `world/terrain.js`) queues patches, not bakes.
- **Baked into chunks**: terrain, natural rock with autotiled faces (4-neighbour mask, 16 variants per stone), known ore and gem glints, stone piles' ground marks, constructed floors, smoothed and engraved stone, tilled soil, blight tint.
- **Drawn per frame, culled to the view**: built walls and doors (they take damage), buildings, furniture, plants with growth stages, item stacks (bucketed per chunk), colonists, animals, hostiles, projectiles, particles; overlays for zones, designations, blueprints, stamp and carve previews and room outlines (only the visible tiles, from per-chunk index lists; zones only while the Zones menu or a zone is selected, designations always at 50% alpha).

**Level of detail.**
- Zoom >= 0.5: full detail.
- Zoom < 0.5 is the **strategic view** (colonists would be about 9 pt tall): colonists become **pips** (a 20 pt disc at constant screen size with the role icon and a mood ring; job, alert and draft badges; a 44 pt hit area); the members of a raid merge into a **raid blob** (a red hull around them with a count and the raid's icon); a lone beast is a red pip; item stacks are 4 px colour dots; numbers, need icons and health bars hide.
- Zoom < 0.35: plants stop swaying and particles stop.

**Light and darkness (one source of truth).** The sim light map `rt.light` (3.3) is the only light model; `render/light.js` has none of its own.
- The renderer keeps one **light texture at 2 px per tile** (256 x 256 at 128) that combines fog, roof darkness, the ambient night level and per-tile light. Each open tile's 4 pixels take its own light. Each wall or rock tile's pixels take the light of the open neighbour **on that pixel's side**, so a rock wall between a lit tunnel and a dark one is lit on one face only, and light never shows through rock.
- It is rebuilt for dirty tiles (light map, fog or roof changes, from the C13 end-of-tick pass) and fully at day-phase ticks, then drawn scaled over the world with smoothing on (bilinear over half a tile). The Stage 0 spike compares smoothing off, and a 4 px-per-tile texture, on device; the owner picks one and it goes in `balance.js` RENDER.
- Flames flicker by modulating the alpha of their own tiles in the texture (the 64 nearest); there are no free additive light sprites over rock. Hollow emissive rims stay as they are.
- Tunnels by day therefore cost the same as the surface at night.

- **Sprite cache**: the existing LRU, capped at **48 MB** (was 64); colonist sprites keyed by an integer (`body | palette << 4 | hair << 8 | tool << 12 | frame << 16`) to avoid string keys.
- **Minimap**: the W x H tile-colour canvas (also the chunk placeholder), patched per dirty tile, colonists drawn over it every 2 s.
- **Battery**: `loop.js` gets a render throttle. **60 fps** while panning, zooming, a sheet or card animates, or combat is on screen (a hostile or a projectile in view); otherwise **30 fps** (the sim is unaffected: at 3x and 30 fps a frame runs 2 ticks). Paused and still: at most 10 fps (and at once on input). A full-screen menu covers the canvas: no draws. "Battery saver" caps at 30 fps always. 5x renders at 30 fps.

### 12.5 Memory budget

Terrain chunks <= 63 MB (two bands) + sprite cache <= 48 MB + light and tile-colour textures < 2 MB + state and indexes < 15 MB, so about **130 MB** in total. The Stage 0 spike measures the iOS canvas-memory ceiling on an iPhone 13; if it is under 160 MB, the near LRU drops to 30 and the sprite cache to 40 MB.

---

## 13. Architecture

Same principles as today: plain ES modules, no build step, the sim is pure and deterministic, the UI never mutates state (it sends commands), every number lives in `js/data/`, systems plug in through the BUS.

### 13.1 Module map

| Folder / file | Responsibility | Source |
|---|---|---|
| `js/main.js` | shell: title, colony list, new-colony flow, lifecycle (pause and save on hide), settings, service worker | ADAPT `main.js` |
| `js/engine/loop.js`, `input.js`, `camera.js`, `rng.js`, `particles.js`, `audio.js`, `sprites*.js`, `*art.js` | engine and art | REUSE (+ render throttle, + new SFX) |
| `js/engine/render/index.js` | frame orchestration, y-sort, camera transform | ADAPT `render.js` (split) |
| `js/engine/render/terrain.js` | chunk bake, LRU, dirty set, rock autotile | ADAPT |
| `js/engine/render/entities.js` | buildings, furniture, plants, items, people, foes | ADAPT |
| `js/engine/render/overlays.js` | zones, designations, blueprints, rooms, order lines, route previews, loupe data | NEW |
| `js/engine/render/light.js` | draws the 2 px-per-tile light texture from the sim's `rt.light` (no light model of its own), flame flicker, Hollow emissive rims | ADAPT |
| `js/engine/art/` (new art modules) | `rockart.js`, `itemart.js`, `furnitureart.js`, `benchart.js`, `cropart.js`, `animalart.js`, `colonistart.js` (extends the villager), `overlayart.js` | NEW |
| `js/engine/save.js` | envelope, storage helpers, quarantine, persist() | ADAPT |
| `js/game/core/grid.js` | map size, layer ids, terrain tables (passable, mineable, buildable, roofable), index helpers | ADAPT |
| `js/game/core/state.js` | `createColony`, `initRuntime`, migrations | ADAPT (heavy) |
| `js/game/core/schema.js` | entity factories and field lists (the state contract) | NEW |
| `js/game/core/time.js` | calendar helpers, day phases, seasons | NEW (from `cycle.js`) |
| `js/game/core/sim.js` | `tick()` order, system registry, per-tick caches | ADAPT |
| `js/game/core/commands.js` | command names, validators, `applyCommand` dispatch | ADAPT (from `sim.js`) |
| `js/game/core/bus.js` | hook lists | ADAPT `hooks.js` (slimmed) |
| `js/game/core/mods.js` | the modifier engine: traits, perks, specs, charters, rooms, techs all add `{key, op, value, when}` | NEW |
| `js/game/core/content.js` | loads and indexes all data files, validates references | REPLACE |
| `js/game/core/events.js` | `emit` names and the event drain (FX, audio, Chronicle, toasts) | ADAPT (`common.js`) |
| `js/game/world/mapgen.js` | generation (3.2) | REPLACE (salvage noise, river, BFS) |
| `js/game/world/terrain.js` | `mineTile`, `setFloor`, `setRoof`, plant changes; calls `markDirty`, region and room invalidation | NEW |
| `js/game/world/regions.js` | cluster-split regions, two label sets (colonist, hostile), region graph and distance estimate | NEW |
| `js/game/world/support.js` | roof support distance, cave-ins | NEW |
| `js/game/world/rooms.js` | room detection, roles, stats, tiers | NEW |
| `js/game/world/light.js` | `rt.light`: flood fill from lights, the Hearth and lumenite, blocked by walls, closed doors and rock; day phase; keeps `s.lit` for combat. The single light source for sim and render | ADAPT (`fog.js` `computeLight`) |
| `js/game/world/temperature.js` | season, underground and room temperatures, `rt.heat` (3.6) | NEW |
| `js/game/world/fog.js` | surface fog and underground reveal | ADAPT |
| `js/game/world/plants.js`, `fire.js`, `weather.js`, `blight.js`, `claims.js`, `mechanisms.js` | growth, fire, weather, blight, claimed land, levers, plates and linked gates | NEW (`blight` salvages Hollowing) |
| `js/game/people/colonists.js` | generation, spawn, ancestry, look | NEW (salvage `heroes.js` shapes) |
| `js/game/people/skills.js`, `needs.js`, `mood.js`, `breaks.js`, `health.js`, `social.js`, `draft.js`, `roles.js`, `embertouch.js`, `perks.js` | 4.2-4.8, roles (5.1), Ember-touched (4.5), perk hooks (8.1), drafting and squads | NEW (`draft.js` from `units.js`) |
| `js/game/work/think.js`, `jobs.js`, `toils.js`, `reserve.js` | job selection, toil runner, reservations | NEW |
| `js/game/work/items.js`, `stockpiles.js`, `haul.js`, `bills.js`, `construct.js`, `quality.js` | items, stockpiles, hauling, bills, frames, quality rolls | NEW (salvage `villagers.js` carry and door logic) |
| `js/game/work/givers/*.js` | one file per work giver: `haul`, `clean`, `refuel` (Haul); `chop`, `mine`, `build`, `grow`, `cook` (incl. brewing and milling), `smith`, `craft`, `tailor`, `art`, `lore`, `care` (tend, rescue, prisoners, talk down), `fire` (the emergency); `animals.js` is owned by K | NEW |
| `js/game/colony/wealth.js`, `tiers.js`, `research.js`, `charters.js`, `charters/*.js`, `chronicle.js`, `trade.js`, `caravans.js`, `factions.js`, `deeds.js`, `ledger.js` | colony-level systems, the five charter mechanics, the Dawn Ledger counters | NEW (`chronicle` and `deeds` from `meta/records.js`) |
| `js/game/animals/*.js` | animal AI (wild, tame, manhunter), taming, pens, breeding, herds and herd drives | NEW |
| `js/game/threat/storyteller.js`, `incidents.js`, `raidplan.js`, `raiders.js`, `flow.js`, `rift.js`, `cast.js`, `nemesis.js`, `aftermath.js`, `lords/*.js` | section 9 | REPLACE `director.js`, ADAPT `waves.js`, `enemies.js`, `foes.js`, `objectives.js` (Rift), boss modules |
| `js/game/systems/pathing.js`, `movement.js`, `spatial.js` | A* with the shared budget and saved queue, walk costs, doors, movement, spatial hash: infrastructure for every mover (owner B) | REUSE / ADAPT (A* cap and budget, walk costs, doors) |
| `js/game/systems/engage.js`, `combat.js` | combat for colonists, raiders and animals (owner H) | REUSE |
| `js/game/defence/*.js` | towers, traps, ballista, spire, Hearth shots, braziers | ADAPT `buildings.js`, `structures.js` |
| `js/game/save/codec.js`, `fields.js`, `colonysave.js`, `slots.js`, `idb.js`, `rtsave.js` | section 11; `rtsave.js` writes and reads the C13 runtime section | NEW |
| `js/game/controller.js` | input to tools and commands, selection, ghost placement | ADAPT |
| `js/game/tools/*.js` | `rect.js` (designations and zones), `line.js` (walls), `place.js` (structures), `order.js` (drafted), `stamp.js`, `carve.js`, `copy.js` (10.11) | NEW (salvage wall-line drawing) |
| `js/ui/hud.js`, `toolbar.js`, `sheet.js`, `architect.js`, `orders.js`, `zonesui.js`, `colonistui.js`, `workgrid.js`, `schedule.js`, `billsui.js`, `filterui.js`, `researchui.js`, `stockui.js`, `holdui.js`, `alerts.js`, `letters.js`, `chronicleui.js`, `colonies.js`, `newcolony.js`, `coach.js`, `loupe.js`, `peek.js`, `speed.js`, `rolesui.js`, `ledger.js`, `demandui.js`, `a2hs.js`, `backup.js` | section 10 | ADAPT `hud`, `buildbar`, `infocard`, `heroui`, `coach`, `runscreens` (event dialog); the rest NEW |
| `js/ui/dom.js`, `icons.js`, `modal.js`, `toast.js`, `debug.js` | widgets | REUSE (+ icons) |
| `classic/` | the frozen roguelite, served at `/classic/` (13.5) | COPY at the Stage 1 merge |

### 13.2 State schema (`js/game/core/schema.js` is the source of truth)

```js
s = {
  v: 1, id, name, seed, w: 128, h: 128,
  tick, speed,                              // speed is not simulation state; kept for resume only
  rng: { main, story, gen, names, combat }, // mulberry32 states per stream
  L: { terrain, mat, ore, floor, roof, plant, growth, blight, zone, desig: Uint8Array(w*h),
       fog, known: Uint8Array(ceil(w*h/8)) },
  colony: { tier, hearth: { id, lvl, fuel }, charters: [], techs: Uint8Array bitset, lore, research: { cur, pts },
            claims: [waystone ids], factions: { league, hearthwatch, gutterkin }, deeds: [], lordsDone: [],
            storyteller, difficulty, iron, starts, ledger: {...}, templates: [], ember: { colId, bench, demand, deadline } | null },
  st: { queue: [{ id, inc, warnTick, arriveTick, stage, plan, cast }], tension, lastMajorDay, cooldowns: {}, history: [],
        nemeses: [ Nemesis ] },
  col: [ Colonist ],         // see below
  items: [ Stack | null ],   // free list in rt
  bld: [ Building | null ],  // structures, furniture, frames and blueprints
  zones: [ Zone ],
  anim: [ Animal ], foes: [ Foe ], raids: [ Raid ],
  rel: { [pairKey]: [op, kind] },
  chron: [ [tick, kind, templateId, args] ],   // capped 600; older entries fold into year summaries
}
Colonist = { id, name, anc, age, look: {skin, hair, hairC, beard, cloth}, bs: [child, adult],
  at: [might, wits, grace], sk: [[lvl, xp, passion, todayTicks] x 15], perks: [], traits: [],
  need: [food, rest, joy, warmth, light], mood, thoughts: [[id, ticksLeft, stack]],
  hp: { parts: [6], blood, wounds: [], taint, illness }, gear: { slots, outfit }, sched: Uint8Array(24),
  role: [primary, secondary | null], custom: bool, prio: Uint8Array(13),   // prio is computed from roles unless custom
  soldier, squad, drafted, bed, area, x, y, job, path: { tiles: Uint16Array, i } | null,
  unreach: [[targetKey, untilTick]], log: [], breakState, inspo }
Nemesis = { id, name, epithet, kind, affixes: [], scar, grudge: colId, returns, nextTick }
Building = { id, def, x, y, rot, mat, q, hp, st: 'bp' | 'frame' | 'done', need, got, work,
  lvl, spec: [], owner, fuel, bills: [Bill], link, name, maker }
Stack = { id, k, m, q, n, x, y, hp, f, age, name?, maker? }
Zone = { id, type, name, pri, filter: { cats, mats, q: [lo, hi] }, crop?, area? }
Raid = { id, inc, pts, edge, goal, morale, members: [foeIds], stage }
```
`s.rt` holds: `occ`, `itemAt`, `region`, `regionH`, `regionGraph`, `room`, `rooms`, `roomTemp`, `heat`, `light`, `lit`, `depth`, `support`, `walkCost`, `res` (reservations), `stock` (totals by kind), the work indexes (5.3), zone distance fields and free lists, flow fields, the spatial hashes, the path queue, the think queue, dirty flags, the item free-slot heap. **Each one is classed in the C13 table (13.3)**; the saved ones are written in the blob's RUNTIME section (11.3).

### 13.3 Contracts that other modules rely on

- **Commands** (`commands.js`): `designate {kind, rect, add}`, `cancelRect {rect, kinds}`, `place {def, x, y, rot, mat}`, `placeLine {def, path, mat}`, `stamp {kind, rect, wallMat, floorMat, door, furnish, bench?}`, `carve {rect, pattern, smooth}`, `copyRoom {roomId}`, `paste {templateId, x, y, rot}`, `deconstruct {ids|rect}`, `zone {op: new|expand|shrink|delete, type, rect, zoneId, preset}`, `zoneCfg {zoneId, patch}`, `bill {op: add|edit|remove|move, bId, bill}`, `role {colId, primary, secondary}`, `prio {colId, work, p}` (Advanced), `sched {colId, hours}`, `soldier {colId, on}`, `draft {colIds, on}`, `order {colIds, kind: move|attack|hold|guard|retreat|sally, target}`, `prioritise {colId, target, work}`, `forbid {ids|rect, on}`, `upgrade {bId}`, `spec {bId, spec}`, `assign {bId, colId}`, `outfit {colId, outfit}`, `research {tech}`, `charter {id}`, `letter {id, choice}`, `trade {visitId, buy, sell}`, `caravan {colIds, goods, town}`, `garrison {colId, bId}`, `vigil {colId, bId}`, `feast {roomId}`, `perk {colId, perk}`, `challenge {lord}`. Each has a validator; invalid commands are dropped with a reason (UI shows it as a toast). The determinism tool records `[tick, cmd]` logs. Speed is not a command (it is not sim state).
- **Runtime determinism contract (C13, `js/game/core/rtcontract.js`).** Invariant: *any `s.rt` data that affects a sim decision is either saved, or brought up to date at the end of every tick in which its inputs changed.* Every `rt` key is classed here; `tools/tests/rt-contract.test.mjs` fails on a key that is not listed, and the determinism gate (14.4 (d), (e)) checks the classes.

| `rt` data | Class | Rule |
|---|---|---|
| `region`, `regionH`, `regionGraph` | end-of-tick | dirty clusters relabelled in `endOfTick` |
| `room`, `rooms`, `roomTemp`, `heat` | end-of-tick | dirty areas, then temperatures |
| `light`, `lit` | end-of-tick | dirty sources and day-phase ticks |
| zone distance fields and free lists | end-of-tick | when a zone is edited, fills or frees |
| `occ`, `itemAt`, `support`, `depth`, `walkCost` | incremental | updated inside the terrain, item and building API call that changes them |
| work indexes (designations, items by kind, frames, bills, plants, patients) | incremental, ordered | updated in the same call that changes their input; buckets are arrays sorted by tile index or id, never insertion-ordered Sets |
| spatial hashes | per tick | rebuilt at the start of each tick in id order |
| `res` (reservations) | derived, exact | a function of saved jobs (5.4); asserted equal to a rebuild at every tick end in the gate |
| item free-slot heap | derived | lowest free index (5.5) |
| `stock`, wealth | derived | incremental, plus a deterministic full recompute every 14,400 ticks |
| think queue, path queue | **saved** | RUNTIME section |
| colonist and pack-leader paths, unreachable memory | **saved** | with the entity (13.2) |
| flow fields with build ticks and input stamps | **saved while a raid is live** | RUNTIME section; otherwise not present |
| render chunks, sprite cache, light texture, minimap | render only | never read by `js/game/` (checked by `check-imports`) |

  A new `rt` field must be added to this table in the same PR that adds it.
- **BUS hooks** (`bus.js`): `tick` (ordered systems), `workGivers`, `needs`, `thoughts`, `recipes`, `incidents`, `canPlace`, `built`, `removed`, `kill`, `dmgMult`, `draw.world`, `draw.overlay`, `hud`, `card`, `alerts`. Deleted: `runNew`, `runRegion`, `runMap`, `emberMult`, `draftVeto`, `setup`, `mapNode`, `dawnCard`, `beaconReward`.
- **Events** (`emit(s, name, data)` drained by the controller each frame): `mined`, `oreFound`, `discovery`, `built`, `crafted`, `masterwork`, `artifact`, `hauled`, `ate`, `slept`, `broke`, `inspired`, `emberTouched`, `wounded`, `downed`, `died`, `raidWarn`, `raidStage`, `raidEnd`, `nemesis`, `fireStart`, `caveIn`, `tierUp`, `rankUp`, `letter`. FX (`fx.js`), audio, Chronicle and toasts subscribe.
- **Item API** (`items.js`): `spawn(s, k, m, q, n, x, y)`, `take(s, stackId, n)`, `drop(s, col, x, y)`, `findNearest(s, filter, from, region)`, `totals(s, k)`. No module touches `s.items` directly.
- **Terrain API** (`world/terrain.js`, C5): all tile writes go through it; it updates the incremental caches at once and sets the end-of-tick dirty flags for regions, rooms, temperature and light, and queues render patches (`markDirty`). Its read side exposes `lightAt(i)`, `tempAt(i)`, `regionOf(i, side)` and `regionDist(a, b)` for E, F, H and C.
- **Modifier engine** (`mods.js`): `mod(s, entity, key, base)` folds every active modifier (trait, perk, ancestry, spec, charter, room, tech, season, difficulty) for a key such as `work.mine.speed` or `quality.forge`. Content adds modifiers in data; logic only calls `mod`.

### 13.4 Content data files (`js/data/`)

| File | Content |
|---|---|
| `balance.js` | every tuning number by section (TIME, NEEDS, WORK, PATH, THREAT, SAVE, RENDER) |
| `worldgen.js`, `biomes.js` (reuse), `biomes-ext.js` (reuse) | generation tables, palettes, stone and ore palettes |
| `materials.js`, `items.js`, `quality.js`, `plants.js`, `animals.js` | 6.1, 6.2, 5.8, 6.5 |
| `recipes.js` | 6.4 |
| `structures/housing.js`, `walls.js`, `storage.js`, `farming.js`, `workshops.js`, `defence.js`, `utility.js`, `civic.js`, `monuments.js`, `charter.js` | section 7 and 8.3 |
| `rooms.js`, `research.js`, `tiers.js`, `charters.js`, `specs.js`, `professions.js`, `perks.js` (33) | 7.11, 7.12, 8 |
| `roles.js`, `advice.js`, `embertouch.js` | 5.1, 10.10, 4.5 |
| `skills.js`, `traits.js`, `needs.js`, `thoughts.js`, `breaks.js`, `worktypes.js`, `ancestries.js`, `names.js`, `backstories.js`, `starts.js` | section 4, 5.1, 8.5 |
| `storytellers.js`, `incidents.js`, `raiders.js` (from `enemies.js` + `enemies-p4.js`), `factions.js` (world factions, new), `traders.js` | section 9 |
| `deeds.js` (from `achievements.js`), `heraldry.js` (reuse) | goals and banners |
| `text/*.js` | letter, thought, Chronicle, nemesis names and epithets, artifact names and help text templates (kept out of logic for tone editing) |

`tools/validate-data.mjs` checks every reference (recipe items and benches exist, structure techs exist, art keys and kit parts are registered, no duplicate ids, every tier and tech referenced exists, every work type has a giver, every role names existing work types, every spec's `adds` names an existing recipe, toil or structure, every perk's `grants` names a registered hook) and fails the build gate on any error.

### 13.5 Delete and keep

**Delete in Stage 0** (git history keeps them):
- Game: `js/game/modes.js`, `realmmap.js`, `run.js`, `runflow.js`, `meta/citadel.js`; systems `dawncards.js`, `relics-p4.js`, `objectives.js` (after moving `RIFT_DEF` and the rift behaviour into `threat/rift.js`), `factions.js` (after moving ancestry data), `director.js` (after salvaging the PACE curve into the storyteller notes), `economy.js` and `villagers.js` (after Stage 1 replaces them; they are unhooked in Stage 0).
- UI: `realmmap-ui.js`, `citadelui.js`, `dawncardui.js`, `runscreens.js` (after moving `showEventDialog` / `showEventResult` into `letters.js`).
- Data: `cards.js`, `boons.js`, `beacons.js`, `relics.js`, `relics-p4.js`, `perks.js` (the old one; the new `perks.js` is a different file), `citadel.js`, `modifiers.js`, `events.js` (rewritten as `text/incidents.js`).
- CSS: `run.css`, `citadel.css`; `codex.css` until the Codex returns.
- Tools: `migrate.mjs`, `fixtures/v3-bounties.json`, `runflow.mjs`, `modes.mjs`, `start.mjs`, `pacing.mjs`, `economy.mjs`, `rewards.mjs`, `cards.mjs`, `heroes.mjs`, `headless.mjs`, `runsim.mjs`, `runsim-lib.mjs`.
- Art: `citadelart.js` is kept only if the title backdrop uses it (decision: yes, as the title screen's growing hold; otherwise delete in Stage 3).
- Repo: the 72 root PNG screenshots move out (deleted; test screenshots go to `tools/out/`, git-ignored). The unrelated Python project (`src/`, `tests/`, `pyproject.toml`, `uv.lock`, `MANIFEST.in`, `CLAUDE_example.md`) is left alone but excluded from `sw.js`; moving it out is the owner's call.

**Classic copy** (`/classic/`, owner J, at the Stage 1 merge): copy the last roguelite build (`index.html`, `css/`, `js/`, `icons/`, `assets/`, `manifest.webmanifest`) from `main` at the merge-base into `classic/`, check that every path is relative, give it no service worker (it is not cached offline) and link it from the title screen ("Play the classic Embercrown"). It is frozen: no changes except a fix for a broken load. Its `embercrown.*` keys are left alone (11.2).

**Keep**: everything marked REUSE in the inventory, all art modules, `boss.js` / `colossus.js` / `hollowking.js` (adapted in Stage 3), `meta/records.js` (becomes Chronicle and deeds), the determinism, smoke, interact, persist, check-sw and icon tools.

---

## 14. Build plan

### 14.1 Ground rules

- Work happens on branch **`colony`** (D12). Each workstream merges small PRs into `colony` at least every 2 days; **`tools/gate.mjs` must pass on every merge** (it runs the checks in 14.4 that exist at that stage).
- **One owner per file.** Every file has exactly one owning workstream (14.2). Another workstream changes it only by a PR the owner reviews.
- **Contracts freeze in two steps** (14.3). C1, C2-core, C3, C5, C6 and C13 freeze at the end of Stage 0. The others are **provisional** until the Stage 1a fun review: the owner may change them with a PR that updates every consumer's stubs and tests in the same PR. After a contract freezes, a change is a PR by its owner, reviewed by every consumer listed in 14.2. New commands, events and data fields may be **added** to a frozen contract at any time; existing ones are not changed.
- **No npm in the shipped game.** Tests use what is already available: Node 22 built-ins (`node --test`, `node:assert`) for headless tests, and the globally installed Playwright that `tools/smoke.mjs` uses today (Chromium and WebKit) for browser checks. Nothing from `tools/` ships or goes in `sw.js`.
- **Determinism rules** for all sim code (checked by review and by the gate):
  - no `Math.random`, `Date`, `performance.now` or frame time in `js/game/`; RNG only through `s.rng` streams;
  - integer or fixed-point maths for needs, growth, timers and XP;
  - iteration over arrays or `Map`s only, never over object keys whose order could differ;
  - every cadence in ticks; every derived cache follows C13 (13.3); `endOfTick` order fixed (12.3);
  - **same-engine determinism**: `Math.sin`, `cos`, `atan2` and `sqrt` are allowed in the sim (the reused `movement.js:167-173,356` and `engage.js:103,122,197-200` use them). Saves are snapshots, so a game only has to repeat itself on the engine that runs it. The determinism suite runs in **Node (V8)** and in **Playwright WebKit (JavaScriptCore)**, the engine of every iPhone browser. An exported save continued on another engine is valid, it simply has a different future;
  - no sim code reads a render-only cache (`check-imports` enforces `js/game/` never imports `js/engine/render/`).
- A **debug hook** `window.__ec` (dev builds and `?debug=1`) exposes `state`, `send(cmd)`, `step(n)`, `stats()` so Playwright tests read state instead of pixels.

### 14.2 Workstreams (11)

| WS | Name | Owns (files) | Provides | Consumes |
|---|---|---|---|---|
| **A** | Core, time and save | `js/game/core/*` (grid, state, schema, time, sim incl. `endOfTick`, commands, bus, mods, events, content, rtcontract), `js/game/save/*`, `js/engine/save.js`, `js/main.js` | C1, C2, C3, C4, C8, C10, C13, C14 | C11 |
| **B** | World and movement | `js/game/world/*` (mapgen, terrain, regions, support, rooms, light, temperature, fog, plants, fire, weather, blight, claims, mechanisms), `js/game/systems/{pathing,movement,spatial}.js`, `js/data/worldgen.js`, `plants.js` | C5 (terrain write and read API: light, temperature, regions, region graph), `requestPath`, movement | C1-C4, C13 |
| **C** | Rendering | `js/engine/render/*`, `loop.js` throttle, `camera.js` | C9: `markDirty`, overlays, bands, light texture, LOD | C1, C5, D's keys |
| **D** | Art and audio | `js/engine/art/*` (new; kit parts), `sprites*.js` extensions, `audio.js`, `fx.js`, `icons.js` | the art key registry (`js/engine/art/keys.js`): kit = base + props + material tint; SFX names | C8 |
| **E** | Work, items and logistics | `js/game/work/*` (think, jobs, toils, reserve, items, stockpiles, haul, bills, construct, quality, givers/* except `animals.js`) | C6, C7, stock totals, zone fields | C1-C5, C13, mods |
| **F** | People | `js/game/people/*` (incl. roles, embertouch, perks), `js/data/skills.js`, `traits.js`, `needs.js`, `thoughts.js`, `breaks.js`, `ancestries.js`, `names.js`, `backstories.js`, `perks.js`, `professions.js`, `roles.js`, `embertouch.js` | colonist factory, needs/mood/health API, role application, draft and squads | C1-C7 |
| **G** | Content data | every other `js/data/*` file (materials, items, recipes, structures/*, rooms, research, tiers, charters, specs, starts, quality, animals, factions, traders, deeds, advice, worktypes, text/*), `js/data/schema.js`, `tools/validate-data.mjs` | C11 and the content registry | C1 |
| **H** | Threats and combat | `js/game/threat/*` (storyteller, incidents, raidplan, raiders, flow, rift, cast, nemesis, aftermath, lords/*), `js/game/defence/*`, `js/game/systems/{engage,combat}.js`, `js/data/storytellers.js`, `incidents.js`, `raiders.js` | C12, raids, flow fields, defences, combat | C1-C7, F draft API |
| **I** | UI and UX | `js/ui/*`, `js/game/controller.js`, `js/game/tools/*` (incl. stamp, carve, copy), `css/style.css`, `index.html`, `manifest.webmanifest` | every screen in section 10 | C3, read-only state, C9, icons |
| **J** | Tooling, QA and repo | `tools/*` (gate, determinism incl. WebKit, colonybot, bench, smoke, ui-phone, persist, render-check, spike harness, check-sw), `sw.js`, `classic/`, repo hygiene | the gate, bench thresholds, bot and balance report | everything (read-only) |
| **K** | Colony systems and animals | `js/game/colony/*` (wealth, tiers, research, charters and `charters/*`, trade, caravans, factions, deeds, chronicle, ledger), `js/game/animals/*`, `js/game/work/givers/animals.js` | progression, charter mechanics, animal AI, ledger counters | C1-C7, C11 data |

Eleven workstreams. A and J can share one person after Stage 1; D can be two people; G and K can share one person during Stage 1, when there is little content.

### 14.3 Shared contracts

| Id | Contract | File | Owner (reviewers) | Freezes |
|---|---|---|---|---|
| C1 | map size, layer ids and enums, terrain tables, tile index helpers | `js/game/core/grid.js` | A (B) | **end of Stage 0** |
| C2-core | state root, ids, RNG streams, and the core fields of Colonist, Stack, Building, Zone (id, kind or def, position, owner, job, path) | `js/game/core/schema.js` | A (all) | **end of Stage 0** |
| C2-full | every other entity field | `js/game/core/schema.js` | A (all) | after the 1a fun review |
| C3 | command names, payloads and validators | `js/game/core/commands.js` | A (I) | **end of Stage 0** (additions any time) |
| C4 | BUS hook names, tick order and `endOfTick` order | `js/game/core/bus.js`, `sim.js` | A | after the 1a fun review |
| C5 | terrain write API, invalidation, and the read API (light, temperature, regions, region graph) | `js/game/world/terrain.js` | B (C, E, H) | **end of Stage 0** |
| C6 | item API | `js/game/work/items.js` | E (F, H, K) | **end of Stage 0** |
| C7 | work-giver and toil contract (5.3) | `js/game/work/jobs.js` | E (F, H, K) | after the 1a fun review |
| C8 | event names and payloads | `js/game/core/events.js` | A (D, I) | after the 1a fun review |
| C9 | render API: `markDirty`, `setOverlay`, art key lookup, LOD hooks | `js/engine/render/index.js` | C (D, I) | after the 1a fun review |
| C10 | EC2 blob format (11.3) | `js/game/save/codec.js` | A | after the 1a fun review (later changes bump `formatVersion` with a migration) |
| C11 | data schemas (structure, recipe, item, trait, perk, spec, role, advice, incident text) | `js/data/schema.js` | G (E, F, H, K) | after the 1a fun review |
| C12 | incident, cast and raid-plan schema | `js/game/threat/incidents.js` | H (K) | end of Stage 1b |
| C13 | runtime determinism contract (13.3) and its test | `js/game/core/rtcontract.js`, `tools/tests/rt-contract.test.mjs` | A (B, E, H) | **end of Stage 0** |
| C14 | storage API: `listColonies`, `readSlot`, `writeSlot`, `quickSave`, `promoteQuick`, `exportBlob`, `importBlob`, `persistState` | `js/game/save/slots.js` | A (I) | after the 1a fun review |

### 14.4 The gate (`tools/gate.mjs`)

| Check | Tool | Starts | Pass condition |
|---|---|---|---|
| Imports | `tools/check-imports.mjs` | 0 | every module imports headless in Node with no side effects and no map-sized allocation at import; `js/game/` never imports `js/engine/render/` |
| Unit tests | `node --test tools/tests/` | 0 | all pass, including `rt-contract.test.mjs` (no unlisted `rt` key) |
| Data | `tools/validate-data.mjs` | 0 | no broken references, no duplicate ids (13.4) |
| Determinism | `tools/determinism.mjs` (Node) and `tools/determinism-webkit.mjs` (the same suite in a Playwright WebKit page) | 1a | (a) same seed and command log twice: identical state hash; (b) save at 5 random ticks, load, continue: identical hash to the uninterrupted run (from 1b, at least two saves mid-raid: one at the Sighted stage, one with hostiles in melee); (c) 1x and 5x runs of the same log: identical hash; (d) reservations equal `rebuildFromJobs` at every tick end; (e) at 20 random ticks, every end-of-tick and incremental cache equals a from-scratch rebuild |
| Colony bot | `tools/colonybot.mjs` | 1a | per-stage targets (below) on seeds 1-5 |
| Balance report | `tools/colonybot.mjs --report` | 2 | XP: first Master on day 25-60 and no level 20 before day 100 (soak: first Grandmaster day 110-200); threat mix per storyteller and per charter; item stacks and save size over time |
| Bench | `tools/bench.mjs` (from `scratchpad/colony/bench/`) | 1a | desktop Node thresholds: tick p95 < 1.0 ms with the stage's stress scene; A* budget of 8,000 expansions per tick never exceeded, path p95 < 1.5 ms on the tunnel-maze scene; flow field whole build < 0.6 ms; save snapshot + deflate < 25 ms; blob < 40 KB at bot day 5 (1a), < 60 KB at day 30 (1b), < 100 KB at day 200 (Stage 3) |
| Phone UI | `tools/ui-phone.mjs` (Playwright WebKit with touch emulation) | 1a | viewports: portrait 375 x 635, 390 x 664 and 430 x 740 (Safari), 390 x 763 (Home Screen app); landscape 844 x 335 and 932 x 380 (Safari). No console errors; no horizontal overflow on any screen; every visible interactive element >= 44 x 44 pt; every visible text node >= 14 px computed; world height with nothing selected >= 480 pt at 390 x 664 and >= 400 pt with a peek card; the flows listed per stage |
| Persistence | `tools/persist.mjs` | 1a | reload restores the colony; a `pagehide` quick-save is promoted on the next load; **eviction**: delete the IndexedDB database between runs (and, separately, localStorage too): the title shows the colony as missing and offers Import, with no crash; IndexedDB disabled: the localStorage fallback works; export then import round-trips byte-identical entities; quick-save quota error raises the alert |
| Render memory and battery | `tools/render-check.mjs` | 1a | after panning the whole map in all three bands: held chunks <= near 36 + mid 27, or mid 27 + far 48; no blank chunk rect is drawn in any frame; mining a tile triggers a patch, not a bake; still camera, no combat: 30 ± 2 draws/s; paused and still: <= 10; full-screen menu: 0 |
| Service worker | `tools/check-sw.mjs` | 1a | file list matches shipped files; `/classic/` requests are not cached |

### 14.5 Stage 0: clear the ground and retire the unknowns (about 1.5 weeks; A and J lead)

| WS | Deliverables | Acceptance |
|---|---|---|
| A | branch `colony`; delete list (13.5); `core/*` with real `grid.js` (live `W/H/N`, `setMapSize`), `schema.js` (C2-core complete), `commands.js` (validators for every command in 13.3, appliers stubbed), `bus.js`, `events.js`, `rtcontract.js`; `createColony(seed)` returns an empty valid state; `slots.js` and `idb.js` skeletons | `check-imports` passes; schema round-trip test (factory > JSON > factory); `rt-contract` test runs against the stub `rt` |
| B | `terrain.js` API stubs with invalidation flags and the read API; `pathing.js` moved under B with the 8,000 budget and the `N*N/2` cap; region stub with two label sets | unit: `mineTile` on a stub map flips terrain and sets the region, room, light and render dirty flags; `bench.mjs` truncation check: 0 of 400 reachable pairs truncated at 128 |
| C | render split into `render/*` with the old drawing still working on a flat test map; the spike scenes (S1, S2) | old visuals render via `?debug=1&scene=flat` |
| E | `items.js` and `jobs.js` contracts with JSDoc; toil runner skeleton; `reserve.js` with the single `endJob` exit | unit: a fake job `goto > work(10) > drop` completes in a stub world; interrupting it at each toil leaves no reservation |
| F, H, K | module skeletons for their folders against the provisional contracts | imports headless |
| G | `js/data/schema.js`; empty-but-valid data files for every name in 13.4 with 2-3 sample entries each | `validate-data` passes |
| I | title screen with "New colony" / "Continue" placeholders on `colony`; the layout shell at the 10.1 sizes (spike S5, S6) | `ui-phone` loads the title at every gate viewport with no console errors |
| J | `gate.mjs`, `check-imports.mjs`, `node --test` layout, bench moved into `tools/`, the WebKit determinism harness, the spike harness, root screenshots and the 0-byte fixture removed | `gate.mjs` runs green on the stubs, in Node and in WebKit |

**Device spike (S1-S6; owners C, A and I, with J's harness).** Run on a real iPhone 13 in Safari and as a Home Screen app. Results go to `tools/spike/results.json`; numbers go into `balance.js` (RENDER, SAVE, LAYOUT) before the Stage 0 freeze.

| # | Question | Method | Decision it feeds |
|---|---|---|---|
| S1 | Chunk memory and band switches at zoom 0.3-2.0 | `?debug=1&scene=spike-map`: a generated 128 map, scripted pans through all three bands for 5 minutes | no blank rects and no tab reload; the measured canvas-memory ceiling sets the LRU and sprite-cache sizes (12.5) |
| S2 | The look of darkness and light in tunnels | a carved tunnel map with sconces: 2 px texture with smoothing on and off, and a 4 px texture | the owner picks one; 1-tile tunnels readable at zoom 0.75; no light visible through a 1-tile rock wall |
| S3 | Save time and size | snapshot + `CompressionStream` + IndexedDB put of a synthetic day-200 state (30 colonists, 4,000 stacks, a mined map, a live raid with 3 flow fields) | main thread < 8 ms; blob < 100 KB; the put completes < 50 ms |
| S4 | Storage eviction and containers | write in Safari, open as a Home Screen app; clear website data; swipe-kill during a save; `persist()` answer | the quick-save path proven to survive a swipe-kill; the 11.1 answers confirmed or changed |
| S5 | Real viewport heights | `visualViewport` in Safari portrait and landscape (toolbar shown and collapsed) and standalone, on the smallest and largest available iPhones | the 10.1 table and the gate viewports |
| S6 | Touch | loupe aiming, colonist-first tap, 44 pt pip hit areas, the speed button's hold fan | 9 of 10 test taps hit the intended target, or the sizes change |

### 14.6 Stage 1a: Dig and build (about 3 weeks; a sandbox on a device by week 3)

**Scope.** No raids, no needs, no mood: the question is whether digging and building are fun on a phone.
- **World**: 128 x 128, mapgen steps 1-4, 7, 9, 10 and one cavern, with the massif guarantee; surface fog and underground reveal; roof and darkness (look only, no dread); support planning (striped preview), natural pillars.
- **Colonists**: the Hearthwatch Remnant band of 3 (Human art with 4 hair styles x 6 palettes), 15 skills with the new XP curve and cap, 4 traits (Hardworking, Lazy, Quick Learner, Dark-sighted). They do not eat, sleep or mope in 1a.
- **Work**: the 13 work types in data; roles Miner, Builder, Crafter, Hauler and Generalist (Advanced grid hidden); givers **Haul, Mine, Chop, Build, Craft**; exact reservations; region-graph job ranking; unreachable memory.
- **Items**: wood, stone piles, blocks, ore (coal, copper, tin, iron; stock only), bed, table, chair, door, prop and pillar items.
- **Structures (14)**: Hearth L1 (no fuel yet), wood and stone wall, door, plank floor, flagstone, bed, table, chair, carpenter's bench, mason's bench, torch sconce (light only), wooden prop, stone pillar, stockpile zone.
- **Tools**: rectangle designations (Mine, Chop, Cancel) with the loupe; **Carve hall**; **room stamps** (Bedroom, Store, Workshop, Plain room); copy and paste of rooms; stockpiles by preset; place; wall lines.
- **Save**: EC2 in IndexedDB with a/b slots, the quick-save, Continue, one colony, export and import.
- **UI**: the 10.1 layout (top bar, rail, bottom bar with the speed button, peek card, full sheet), Build (Rooms, Structure, Furniture, Workshops), Orders, Zones, colonist sheet (Skills, Bio), the role picker, the bills sheet with smart defaults, stockpile presets.
- **Render**: the three chunk bands, placeholders, patch redraws, rock autotile, ore glints, the light texture from the sim, strategic pips, the 30/60 fps throttle.

| WS | Stage 1a deliverables | Acceptance (in addition to the gate) |
|---|---|---|
| A | tick order with `endOfTick`, command appliers for the slice, time and speeds, EC2 codec (layers, entities, runtime), IndexedDB slots, quick-save and promotion, lifecycle saves, title > new colony > game > continue | determinism (a), (c), (d), (e) green in Node and WebKit, (b) on non-raid ticks; blob < 40 KB at bot day 5; snapshot < 8 ms in the browser bench |
| B | mapgen (slice steps and the massif guarantee), terrain API, cluster regions with two label sets and the region graph, roof, support planning, natural pillars, depth, fog and reveal, the light map, trees, claims (Hearth only), pathing with the saved path queue | seeds 1-100: start site reaches 3 edges, >= 4 coal and >= 3 iron veins, 1 cavern, max depth >= 30, Underdeep >= 300 tiles; generation < 80 ms in Node; unit: mining relabels regions at the end of the tick; unit: light does not cross a 1-tile rock wall |
| C | renderer as scoped; minimap and placeholder texture; throttle | `render-check` green; browser bench at 128, by day and in tunnels, within 1.2x the old 40 x 40 day baseline |
| D | kit art: rock faces for 4 stones, mined floor, 4 ore glints, stone pile, slice items, furniture frames (wood and stone families), bench base with 2 tool props, door, plank and flagstone floors, sconce, prop, pillar, designation marks, zone tints, colonist hair and clothes, pips; SFX dig, ore strike, saw, hammer, door | every art key used by slice data resolves (validate-data art check); the contact sheet `?debug=1&scene=art` renders every key with no errors |
| E | think with region-graph ranking, toils, exact reservations, items with lowest-free-index slots, stone piles, stockpiles with zone fields and free lists, haul (stone only when needed), construct (blueprint > frame > done), bills with smart defaults, the 5 givers | unit: two haulers split a stack; a frame cancelled mid-build drops its materials; an unreachable job is rejected without an A* call; mining 1,500 tiles leaves <= 160 stone stacks; filling one cell does not rebuild a zone field |
| F | colonist generation, skills, XP curve and daily cap, 4 traits, role application | unit: `XP(n)` matches the 4.2 table; the cap counts 2,400 full-rate work ticks per skill per day; each role preset produces the expected priority array |
| G | data for every slice item, recipe (about 12), structure (14), work type, role and smart bill | validate-data green |
| H | nothing visible in 1a: storyteller, `hollow_horde` and the flow field built behind a flag against provisional C12 | unit: a whole-tick flow field equals a reference Dijkstra; a saved and reloaded field is byte-identical |
| I | layout, speed button, peek card, sheets, Build, Orders, Zones, stamps, carve, copy and paste, loupe, role picker, bills, stockpile presets | `ui-phone` flows at every gate viewport: (1) title > New colony > game in < 3 s; (2) Carve hall 9 x 9 creates mine designations and a pillar plan (read via `__ec`); (3) Bedroom stamp 5 x 4 creates blueprints for walls, door, floor and bed in <= 5 taps; (4) speed: tap pauses, the hold fan selects 3x; (5) reload > Continue restores the colony; (6) the world-height checks of 14.4 |
| J | gate for 1a; `colonybot.mjs` v0 (scripted sandbox: stockpile, chop, carve a hall, stamp 3 bedrooms and a workshop, build furniture); a device build on a Pages preview branch for the fun review | see below |
| K | wealth (HUD only) | unit: incremental wealth equals a full recompute |

**1a bot targets** (`colonybot --seeds 1-5 --days 5`): >= 80 tiles mined and a carved hall of >= 40 tiles with a valid pillar plan; 3 stamped bedrooms with beds installed; idle share < 30% of colonist work hours; median haul latency (item appears > item stored) < 2 game hours.

**Fun review (end of week 3; go or no-go for 1b).** The owner plus 2-3 players who have not seen the design, 30 minutes each on an iPhone in Safari, with only the in-game coach.
- Measured: taps and minutes to the first room; minutes to the first carved hall; how far they dig by choice after minute 20; fps drops; lost saves (must be 0).
- Asked: "What did you want to do next?", "What annoyed you?", "Would you open it again tomorrow?".
- **Go** if at least 2 of 3 players keep digging or building past minute 20 by choice and no save is lost. Otherwise one more week of 1a on the top three complaints, then review again. The provisional contracts freeze after a Go.

### 14.7 Stage 1b: First night (about 3 weeks)

**Scope.** Needs **Food, Rest and Light** (dread), mood with about 20 thoughts, minor breaks (Sulk, Comfort binge), simple health (HP, downed, rescue, bed rest); Cook (campfire with its smart bill), berries, hearthroot, grow zone and the Grow giver; Smith (bloomery and forge: copper, tin and iron ingots, spear and pick); Care (rescue only); Refuel in Haul with Hearth fuel; braziers; the Steady Flame storyteller with `hollow_horde` (cast `wounded`), the three warning stages, countdown chip, edge marker and route preview; the core flow field (saved while live); drafting with Move, Attack and Hold; the Hearth night shot; braziers and the lit-tile bonus; dawn retreat; the Dawn Ledger and Next steps (first 10 rules); the coach to day 4 with the day-2 omen; the Add to Home Screen card, the backup prompt and Move to app; the 5x rule. Structures +6 (campfire, bloomery, forge, brazier, grow zone, Hearth fuel): 20 in all.

| WS | Stage 1b deliverables | Acceptance (in addition to the gate) |
|---|---|---|
| A | dawn slot, backup prompt timing, Move to app import, persist-state display | persist gate green, including eviction and quick-save promotion |
| B | berries and hearthroot, Hearth fuel and light, temperature with constant seasons (the full model is Stage 2) | unit: a brazier lights its tunnel and not the next one |
| C | horde in the new renderer, route preview, raid blobs in the strategic view, the combat 60 fps trigger | `render-check` with 3 colonists and 8 hostiles at night in tunnels |
| D | campfire, bloomery, forge and brazier kits, crops, Husk and Hound restyled from existing art, horn and drum SFX | contact sheet complete for 1b |
| E | Cook, Grow, Smith, Care (rescue) and Refuel givers; smart bills for campfire and bloomery | bot: no starvation in 10 days |
| F | 3 needs, mood and thoughts with quarter-gap smoothing, 2 minor breaks, simple health and rescue, the draft API | unit: a colonist with food 0 eats before working; a -20 thought moves mood 75% of the way within 30 game minutes |
| G | 1b data; 10 advice rules | validate-data; every slice recipe is crafted at least once in the bot run |
| H | Steady Flame (majors only), `hollow_horde`, warnings, route preview, saved flow field, dawn retreat, drafting orders through engage, Hearth shot, brazier bonus | bot: first omen on day 2 at 18:00 ± 1 h, arrival on day 3 at night, warned >= 12 h, resolved; with 3 drafted colonists and 2 braziers the first raid is repelled on 5 of 5 seeds without a death; determinism (b) green with saves mid-raid |
| I | threat chip, omen letter, alerts (starving, idle, raid, Hearth fuel), Dawn Ledger, Next steps, coach, A2HS card, backup prompt, Move to app, Needs and Health tabs, draft controls | `ui-phone` flows: the omen shows the chip; draft > move order; the Dawn Ledger appears on resume and the game is paused; scripted 3x play reaches the first omen in <= 15 minutes |
| J | gate; `colonybot` v1 (stockpile, chop, mine, beds, campfire bill, walls, braziers, draft on Imminent); the tunnel-maze bench (decides HPA-lite, 12.3); the `/classic/` copy; the merge | see the Stage 1 gate |
| K | tier Camp; ledger counters | unit: ledger counters reset at 06:00 and survive a save |

**Stage 1 gate (merge `colony` into `main`; the new game is on the start screen; `/classic/` goes live):**
1. `colonybot --seeds 1-5 --days 10`: all colonies alive with 3 colonists; >= 60 tiles mined; a roofed room with 3 beds; >= 30 simple meals cooked; >= 1 raid warned and repelled; zero starvation deaths; idle share < 30%; median haul latency < 2 game hours.
2. All gate checks in 14.4 green, at every gate viewport.
3. A 20-minute playtest on a real iPhone 13 in Safari and again as a Home Screen app: no frame below 50 fps at 3x during the first raid; 30 fps while still; battery drain within 10% of the old game over the same time; the colony continues after a swipe-kill mid-raid.

### 14.8 Stage 2: the hold grows (about 6 weeks)

| WS | Deliverables | Acceptance |
|---|---|---|
| A | settings, the multi-colony list (8), migrations framework with a v1 fixture, Ironhold, Settings > Storage (persist state, classic keys) | persist: 8 colonies at bot day 60 fit; the v1 fixture loads |
| B | cave-ins and collapse, rooms with roles, stats and tiers (incl. Cellar), the **temperature model** (3.6), blight and Waystones, seasons and weather (rain, cold snap, drought), fire spread, the remaining caverns, ruins and 1 vault, the underground spring, **mechanisms: levers, pressure plates, locked gates, linked deadfalls**; HPA-lite paths if the 1b maze bench failed | unit: a 10 x 10 unsupported room collapses, a 9 x 9 does not; room tiers match hand-built fixtures; fire spreads only on flammable tiles; a lever locks a linked gate and the hostile region set changes; a fireplace in a 10-tile room adds 12 C |
| C | room outlines, fire and smoke, weather tint, season palettes, crop stages, animals | `render-check` with 30 colonists, 40 hostiles and fires on screen stays within budget |
| D | kits for every Hamlet and Village structure, crops (8 x 4 stages), hen, goat, sheep, ox, wolf, boar, deer, spider; Gutterkin and reaver looks from existing art; ancestry looks (4) | contact sheet complete; new art parts for Stage 2 <= 45 |
| E | full stockpile filters (preset first, then the tree), shelves and racks, input shelves, auto-bills for furniture ghosts, outfits and armoury racks, cleaning in Haul, the remaining givers (Tailor, Art, Lore, full Care, brewing in Cook), the fire emergency | bot: idle share < 25% at 10 colonists; no item stays unhauled > 1 game day when space exists |
| F | all 5 needs, 24 traits, all breaks and inspirations, **Ember-touched**, wounds, bleeding, infection, taint, tending, illness, relationships, death and burial with Husk rising, the 33 perks with letters and hooks, professions and ranks, the schedule editor, soldier duty and squads, all 13 roles and the Advanced grid data | unit: an untended cut infects after 12 h; taint reaches 100 and the colonist turns (scripted); a met Ember-touched demand produces a named artifact and an unmet one a major break (scripted); bot: average mood > 45 at day 60 |
| G | all Camp, Hamlet and Village content: items, base recipes (about 60), structures (about 90), research eras Kindling, Hearth and Hold incl. Mechanisms, tiers to Village, Hearth levels 1-3, quality, the food chain (farming, cooking, brewing, preserving), traders, world factions, deeds (first 20), advice rules (30) | validate-data; bot reaches Hamlet by day 25 and Village by day 70 on 4 of 5 seeds |
| H | all three storytellers and difficulties; thieves, beasts, reavers, sappers, Rift, breach from the deep; minors and disasters (fire, blight surge, crop blight, Grey Cough, cave-in tremor, cold snap, drought, flood, vermin); visitors; loot and capture; **cast selectors, nemeses and aftermath** (9.10); squads and guard; towers, traps, ballista, deadfalls; multi-goal flow fields; sapper digging | bot (100 days, Steadfast): 12-20 majors; no two majors closer than 2 days except Wandering Ember rules; every major warned >= 6 h; at least one nemesis returns on 3 of 5 seeds; flow fields never exceed 3 live; unit: sappers dig 4x slower than miners |
| I | full Architect with all stamps, Orders, Zones; every colonist sheet tab; schedule, research, stock, Chronicle and Hold tabs; trade sheet; letters with choices; the demand card; the nemesis omen card; complete alerts; help cards; settings | `ui-phone`: every Stage 2 screen at every gate viewport and at 130% text has no overflow; every alert jumps to its subject |
| J | bot v2 (a role-and-bill policy, not a script, that runs 100+ days), soak test (bot 300 days), the balance report | soak: save < 100 KB, item stacks < 2,500 at day 300, no state growth beyond caps, tick p95 < 1.0 ms at day 300 |
| K | wealth, tiers to Village, research, trade, factions, deeds, Chronicle, ledger; **animals**: wild AI, manhunters, taming, pens, breeding, the Animals giver | unit: a tamed goat stays in its pen; bot: a herd of >= 4 by day 40 on Greenvale seeds |

### 14.9 Stage 3: charters and Lords (about 6 weeks)

| WS | Deliverables | Acceptance |
|---|---|---|
| A | Small Vale 96 x 96; the Reclaim flow (nemeses carried over); year summaries in the Chronicle | determinism across a Reclaim; a 96 and a 128 colony load in the same session |
| B | full ruins and vaults with lore tablets, the Deep Cavern and Hollow seep, Duskstone and the Underdeep, floodgates, the ore track | unit: a floodgate open or closed changes regions |
| C | Wonder art states, Lord telegraphs in the new renderer, lumenite glow through rock (through the light map), mirrors | budget holds with the Bone Colossus on screen |
| D | charter structures (15), Wonders in 3 stages, trophies, Master looks, the Elderwood start biome, raid music underground | contact sheet complete |
| E | workshop tiers and the **36 specialisations with their 61 recipes and new actions**, re-tooling, carts | one scripted test per specialisation, generated from `specs.js`, shows its Adds working |
| F | surgery, prosthetics, ageing, wandering heroes, the 9 signature perks complete | bot: first Master between day 25 and 60; no Grandmaster before day 100 |
| G | the remaining structures (to the full catalogue), Crown era research, tiers to Crownhold, Hearth levels 4-5, the Ember Crown, the five charters, Wonders, deeds (60), all starts | validate-data; bot reaches Hold by year 2 on 3 of 5 seeds |
| H | sieges (with the Sally target), wyverns, Grey Pilgrims, the three Hollow Lords with the Challenge Pyre, Lord return rules, the **strong charter nudges** | bot (Steadfast, 3 years): each Lord fought once on at least 2 of 5 seeds; no raid exceeds 60 raiders; per charter, the first major after chartering matches 8.3 and the next 3 majors are >= 2 preferred types on 4 of 5 seeds |
| I | charter letter, specialisation picker (shows each Adds first), Wonder progress, Lord challenge, caravan sheet, Vigil and garrison controls, colony list with backups, Codex light (bestiary, structures) | `ui-phone` flows for each new screen |
| J | perf soak at Crownhold scale (30 colonists, 3,000 buildings, 4,000 items, 80 hostiles); the device test checklist | bench thresholds hold at that scale |
| K | the five charter mechanics: commissions (Forgehold), herd drives (Greenhold), the light network and Vigils (Lanternhold), outbound caravans (Tradehold), garrisons and sallies (Bulwark, with H) | one unit test per mechanic; bot: a Tradehold caravan leaves and returns on 3 of 5 seeds |

### 14.10 Stage 4: long years (open-ended)

Births and children (setting, off by default), festivals and weddings polish, more incidents, thoughts, advice rules and nemesis kinds, balance passes driven by the bot report, accessibility review, real-device performance tuning, audio themes per season, translations groundwork (all text already lives in `js/data/text/`).

### 14.11 Dependency order at a glance

```
Stage 0:  A,J ──> frozen: C1, C2-core, C3, C5, C6, C13 ──> everyone     (+ device spike S1-S6 ──> balance.js)
Stage 1a: A (tick, save) ─┬─> B (world, paths) ─┬─> E (work) ──> bot v0 ──> fun review ──> freeze C2-full, C4, C7-C11, C14
                          │                     └─> C (render) <── D (kit art)
                          ├─> F (skills, roles)
                          └─> G (slice data) ──> E, F;  I builds on C3 with stub appliers from day 1
Stage 1b: F (needs, mood) ──> H (storyteller, horde, draft) ──> bot v1 ──> Stage 1 gate ──> merge + /classic/
Stage 2-3: all workstreams in parallel against frozen contracts; G's data drives E, F, H and K content.
```

---

## Appendix: where each requested topic lives

| Requested topic | Section |
|---|---|
| Response to the review | 0 |
| Pitch, pillars, not repetitive | 1 |
| Core loops, time model, offline | 2 |
| World, generation, digging, fog, expansion, temperature | 3 |
| Colonists: attributes, skills, traits, needs, mood, health, relations, death, arrivals | 4 |
| Jobs, roles, priority grid, job selection, hauling, stockpiles, reservations | 5 (roles and grid UI in 10.4) |
| Items, materials, quality, production chains, recipes, food, medicine, gear, furniture, art, trade goods | 6 and 5.8 |
| Structures catalogue, rooms and room value, research and discovery | 7 |
| Specialisations: professions, workshop specs, charters, prosperity tiers, starts | 8 |
| Threats, storyteller, warnings, defence, disasters, positive events, failure and legacy, actors and nemeses | 9 |
| Phone UX, stamps and carving, Dawn Ledger | 10 |
| Persistence and saves | 11 |
| Performance budget | 12 |
| Architecture, state schema, delete and keep, data files | 13 |
| Build plan, workstreams, stages, acceptance tests | 14 |
