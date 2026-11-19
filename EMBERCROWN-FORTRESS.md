# Embercrown: The Hold - revision 3: the fortress (colony builder, true z-levels, no roguelite)

Status: **design of record for revision 3, edition 4** (edition 4 answers the review of edition 3; the changes are listed in 0.1). This document supersedes the parts of `EMBERCROWN-COLONY.md` (revision 2) that it names. Everything this document does not name still holds, and is cited here as "R2 x.y" (section x.y of `EMBERCROWN-COLONY.md`). Appendix A lists every R2 section with its status: kept, amended or replaced.

Inputs: the owner's request and clarifications (below), `STUDY.md` (every single-layer assumption and every roguelike element in the live code, with paths), and `PROTO.md` with the prototype in `proto/` (z-level memory, pathing, flow, render and save measurements). All three live in the same scratchpad folder as this file. Repo state: `/home/user/Clawd-Code`, branch `claude/vibrant-ride-japlke`, HEAD `06d46a6`. Stages 0-2 are built and deployed; HEAD is an untested Stage 3.0 WIP snapshot.

**The owner's request, verbatim:** "Remove rogue like elements from the game a focus on making it more of a great colony builder like dwarf fortress".

**The owner's clarified choices:**
1. **Remove** the old classic roguelite (its link and the `/classic/` copy).
2. **Remove** every pick-1-of-N choice. Colonists grow by doing.
3. **Remove** Reclaim and Ironhold. A colony is one long, continuous, saved world.
4. **Remove** boss-and-win goals: the Challenge Pyre, Lords as summoned bosses, Wonders and the Great Hearth as end goals. Threats arrive on their own. There is no end goal.
5. **Add true z-levels:** a multi-level fortress dug down level by level, with building on every floor and with stairs and ramps. The owner accepts a big engine change.

**The hard constraints still hold:**
- iPhone first: the Safari viewports are 390 x 664 portrait and 844 x 335 landscape. Touch only, 60 fps while moving, battery friendly.
- No frameworks, npm or build step.
- The sim is deterministic and seeded, and save/load continues identically.
- Saves are small, live in IndexedDB and can be exported and imported.
- Original IP: no names or art from Dwarf Fortress or RimWorld.
- Text >= 14 px, touch targets >= 44 pt.
- Stage 2 saves must migrate, if at all feasible. **They can, and they do** (section 5).
- **Minimum supported device** (new in edition 4): iPhone 11 (A13, 4 GB) on iOS 17 Safari. The design target stays the iPhone 13 (A15). The total memory ceiling of about 140 MB (6.4) must hold on the A13; the device bench in Stage 2.9 (8.2, step S9.1) measures both phones where the owner has them, and the A13 gets the Battery saver defaults (pre-bake z-1 only) if it misses.

---

## 0. Decisions taken in this revision

Each decision is numbered F1-F28. A decision either replaces an R2 decision or adds a new one.

| # | Replaces | Decision |
|---|---|---|
| F1 | D2 | **True z-levels.** The world is **128 x 128 x 20** voxels: `W = H = 128`, `D = 20`, `PLANE = 16,384` and `N = 327,680`. `z = 0` is the bottom of the world and z grows upward. The valley floor is at `zS = 14`. The mountain rises to 5 levels above it, and 14 levels lie below it. `D` and `zS` are save-header fields, so a later `D = 24` is a data change. "Depth" means **levels below the surface**, plus **rock cover overhead** (2.4). It no longer means distance into a massif. |
| F2 | (new) | **Index layout** `i = (z*H + y)*W + x`, so one level is one contiguous slice. **Every tile index is a u32 / Int32**: paths, queues, keys, regions, the saved runtime and commands. Entities carry an integer `z`. |
| F3 | (new) | **One view level** at a time, DF-like. Open air shows the level below, dimmed and baked into the chunk. A one-step level change completes in 1 frame because z±1 is pre-baked when idle (PROTO 3). |
| F4 | P2-17 / 12.3 | **Colonist pathing** is 3D A* with the **link heuristic** over the region graph. It is not admissible: paths are 5% longer on average. Its p95 is 0.42-0.53 ms in Node and about 1.2 ms on an A15 (est.). Regions are 16 x 16 x 1 clusters with u32 labels and vertical links at stair and ramp pairs, and they update fully incrementally. |
| F5 | P0-1 flow rule | **Raid movement uses hierarchical flow.** Region-level costs are combined with per-region local fields that are built when first needed, then cached. Local fields are **built without a per-tick cap** (each is 15-25 µs desktop; F25 says why), and every cache is pure, so **flow fields are never saved again**. The R2 rule "flow fields built whole and saved while a raid is live" is withdrawn. |
| F6 | D11 / 11.3 | **Save format 3** (`EC3`). It holds only the changed 16 x 16 x 1 chunks of each layer, XOR'd against the colony's **pristine world**, then deflated. The pristine world is **stored once per colony** (its own IndexedDB record, about 60-70 KB deflated, and embedded in the dawn backup and in every export), so a save never depends on today's generator code reproducing yesterday's world. Regenerating it from the seed is only a fallback, checked by a per-layer CRC in the header (5.1). A D=20 fortress adds about 24-28 KB to today's save. |
| F7 | (new) | **Stage 2 saves migrate.** The old plane becomes level `zS`. The old mountain becomes real rock levels above it, with heights from a `baseMask` computed once from the save (5.4). The levels below are generated from the seed and that mask only, and the result becomes the colony's stored pristine world. Determinism holds from the migrated state on. The game does not continue tick-identically across the upgrade, and the doc says so plainly (5.4). |
| F8 | D10, 9.9 | **No Reclaim.** A colony falls when no free, able colonist remains for 24 game hours. A fallen colony stays in the colony list as a read-only **Ruin**: its Annals, Chronicle and a frozen map can be viewed and exported. It cannot be continued or reclaimed, and a new colony is always a new map. **The Fallen card offers no backup.** Recovering an older copy lives only in Settings > Storage as "Recover from a device problem" (1.3). |
| F9 | 9.1 difficulty | **No Ironhold.** The fourth difficulty is **Hard** (threat x1.4, normal backups). A v2 save with `iron: true` becomes Hard. |
| F10 | 8.1 perks | **Growth by doing.** No perk is ever picked. A perk is **earned** automatically when its skill level is reached **and** the colonist has done its deed (a counter of real actions). Both perks of an old pair can be earned. |
| F11 | 8.3 charters | **Renown replaces charters.** The hold becomes "known for" smithing, growing, lore and light, trade, arms or delving, measured from what it actually does. It is never chosen. Renown **never gates a structure, recipe or mechanic**: it only steers who visits (guild envoys, petitioners, traders), the lean of the incident causes and flavour text (3.10). The former charter mechanics become verbs every hold has. |
| F12 | 8.2 specs | **Workshop add-ons replace specialisations**, but only where they add a verb. A former specialisation that adds a recipe chain, a job kind or a room role becomes an add-on structure built next to its bench; one that only changed a percentage is dropped, and its recipes move to the base bench or the master set. A hold can build all of them (3.7). |
| F13 | 9.6, 7.10, 8.4 | **Great beasts, not bosses.** Most are **generated from the seed** (body, material, attacks, behaviour, name, a pre-history entry) and live in the deep until a cavern the hold has opened lets them out. The three Hollow Lords stay as unique legends with the same rules: no weak-spot script, no teleport script, no 25% retreat, no escort except the Hollow King's Knights. Slaying one is a legend and a trophy, never a requirement. **There is no win state**: no Pyre, no Lord's Ember, no Great Hearth level 5 and no victory screen. Wonders become **prestige buildings** with no percentage effects; only the Deep Gate and the Ember Seal are mechanisms (3.11). |
| F14 | (new) | **Long arcs replace goals:** the descent itself (layer by layer), prosperity ranks, offices and nobles with requests, renown and the visitors it draws, prestige buildings, great beasts and nemeses, legends and the Annals, ageing, and **births and children (Z2, on by default)** so a long world renews itself. |
| F15 | (new) | **Personalities and preferences** (6 facets, 4 values, 5 liked things and 1 disliked thing) drive thoughts and reactions. Traits stay. |
| F16 | 4.5 Ember-touched | **Seizures of craft** (the moods family) fold in Ember-touched: *Ember-touched* (bright), *Brooding* (after a death) and *Hollow-whispered* (dark). Each makes a named artifact. Failure leaves a lasting mark. |
| F17 | (new) | **Offices and nobles.** The player appoints offices (Steward, Reckoner, Marshal, Chief Healer, Keeper of Records, Warden of Law). The **Thane** is chosen by the colonists themselves, and the **Lord or Lady of the Hold** arrives from the Hearthwatch. Nobles make requests and mandates. |
| F18 | (new) | **Justice** is an optional setting, **off by default**, and **deferred to Z4** (edition 4). When on, a Warden of Law sentences crimes to confinement or a labour fine. There are no beatings or executions. |
| F19 | 3.4 water | **Fluids lite** ships in Stage Z3 with **water control**: closed doors, gates and floodgates block fluid, levers work them, and a raising bridge seals a channel. Water and ember (magma) flow in a budgeted active-cell sim with no pressure. Pumps and pressure are Z4. Until Z3 fluids are static. The `fluid` layer exists in save format 3 from Z1, so turning flow on needs no save migration. |
| F20 | 3.4 support | **Support across levels.** A ceiling is the voxel above. The R2 Chebyshev-4 rule runs per level (Chebyshev 2 in soil). An unsupported ceiling falls into the level below as rubble and leaves open air above. A floor that hangs over air obeys the same span rule on its own level. |
| F21 | D12, 13.5 | **The roguelite is gone from the repo.** Delete `classic/`, its link, its tooling and the 71 dead modules (1.1). Git history keeps them. |
| F22 | 10.x | **Level controls in the thumb zone.** Up and down buttons (44 pt each) and a **level chip** form one capsule at the bottom right of the world in portrait (bottom left in landscape), with the alert stack above it. The current band name is always on screen and every band has its own void tint. Tapping the chip opens the **depth ruler**; a relative drag with detents scrubs levels. Navigation stops at the explored range. No world gesture is spent on z. Every tool works on the view level and has a "Levels" chip (4.1-4.4). |
| F23 | 12.5 | **Memory:** dense typed arrays at D=20 come to about 19 MB of sim state (no zone fields). Canvases are capped by a total held-canvas ceiling (6.4). |
| F24 | 14 | **The build plan** starts with **Stage 2.9** (the removals, shipped on their own to `main` with a small state migration), then Stage Z1 (the z-level core, built in eight engine steps that each keep the whole gate green, with a D=1 oracle, merged dark behind a flag and switched on in one small final step), Z2 (DF-like depth systems), Z3 (threats across levels, caverns, great beasts, fluids with water control) and Z4 (polish). Section 8 gives each step as an agent task: files owned, depends on, test command, oracle. |
| F25 | (new) | **The derived-cache rule.** A runtime cache is either **pure and uncapped** (a hit returns exactly what a rebuild would, and nothing the sim does depends on whether it was warm), or its **live key set and order are saved state** that `initRuntime` rebuilds exactly. Nothing may be capped by a per-tick build count over cache misses. Contract test in Z1 (7.3): drop every derived cache at a random tick, continue, and compare hashes. |
| F26 | 9.1-9.3 | **Threats have causes.** The storyteller keeps its pacing budget and the persona chosen at founding, but it may only schedule an incident that has a **live cause in the world state** (a faction grievance from the pre-history, traders spreading word of the hold's silver, a cavern opened, a lair nearby, a seep woken). Every letter names its cause and the Annals log it (2.10). |
| F27 | (new) | **Ranks, not unlocks.** Prosperity tiers become ranks: they change who arrives (migrant waves, nobles, larger caravans) and the threat scale. They stop gating structures in Z2 (step Z2.9): a structure needs its materials, its research and a builder with the skill, nothing else. |
| F28 | (new) | **Saves never depend on generator code.** Because the pristine world is stored (F6), mapgen may change freely between releases; new world content reaches old colonies only through **world amendments** that write into chunks the hold has never seen (5.6). |

**Kept from R2 without change:**
- D3 (time), D4 (no offline sim), D5 (warned majors), D6 (people), D7 (work and roles), D8 (furniture), D9 (ancestries and world factions), D13 (determinism contract C13, extended in 7.3), D14 (phone budgets) and D15 (delivery).
- D1 keeps "no N-sized buffer at import time". N now includes D.

### 0.1 Changes in edition 4 (the review of edition 3)

Every point of the review is accepted unless the answer says otherwise. Numbers are the review's.

| # | Point | Answer | Where |
|---|---|---|---|
| 1 | Capped, lazy caches break determinism after a load | Accepted as a rule (F25). Local flow fields: uncapped. Zone fields: removed; hauling ranks by region distance only. Day-phase relight queue: saved. Region labels: canonical, so a rebuild equals the incremental graph by value. Contract test in Z1 | 6.2, 7.3, 8.3 |
| 2 | Ship the removals first | Accepted: **Stage 2.9** on `main`, with fixtures captured from `078cb71` first and a state v2 to v3 migration. State versions are integers in `schema.js`, so the review's "v2.1" is state v3 and the fortress is state v4 | 1, 5.3, 8.2 |
| 3 | Saves tied to generator code | Accepted: the pristine world is stored (F6, F28). Regeneration stays as a CRC-checked fallback for native worlds. The inexact-Math lint is adopted too, because the fallback and the Node/WebKit equality test need it. All Z2/Z3 world features are generated in the first `mapgen3`, dormant until their stage ships | 2.2, 5.1, 5.6 |
| 4 | Migrated pristine must come from saved data | Accepted: `baseMask` (h, water bit, massif bit) is computed once at migration from the save and stored | 5.4 |
| 5 | Engine switch in green steps with a D=1 oracle | Accepted, in the review's order, written as agent steps. Each step merges to `main` through the gate, dark behind `FORTRESS = false`; one final step flips it | 8.3 |
| 6 | Device check in week 1 | Accepted: an on-device bench page `/spike/z.html` in Stage 2.9, plus an attempt to install Playwright WebKit. Minimum iPhone stated | 0, 8.2 |
| 7 | Percentage great works, renown unlocks | Accepted. Deep Gate and Ember Seal stay mechanisms; the rest are prestige buildings. Renown never gates | 3.10, 3.11 |
| 8 | Scripted bosses | Accepted: seeded deep beasts from data tables; the three Lords stay as unique legends under the same sim rules; escorts dropped except the King's Knights | 3.12 |
| 9 | Threats need causes; dawn retreat underground | Accepted (F26). **Partly disagree** on dropping the storyteller: its pacing budget and the founding persona stay, because they are the difficulty dial the player chose. It may only pick among causes that exist. Dawn retreat applies only on sky-exposed voxels; underground raids end by morale | 2.10 |
| 10 | Births and children in Z2; taverns, temples, libraries, petitioners | Accepted; births on by default. Life goals added to personality | 3.2, 3.13, 8.4 |
| 11 | Water control in Z3 | Accepted: doors, gates and floodgates block fluid, levers, raising bridge. Pumps and pressure stay Z4 | 2.8, 8.5 |
| 12 | Backup on the Fallen card | Accepted: Settings > Storage, "Recover from a device problem". Open question 2 is closed | 1.3, 9 |
| 13 | Cut scope | Accepted: justice to Z4; add-ons only where they add a verb; the freed effort goes to two-level caverns, the aquifer, vertical defence and floodgates | 3.7, 8 |
| 14 | Level column in the thumb zone | Accepted: bottom right above the bottom bar, alerts above, slides with the peek card | 4.1 |
| 15 | Navigation limited to the explored range | Accepted | 4.1 |
| 16 | Level always visible | Accepted: a band name plate beside the chip and a void tint per band; checked at 130% text | 4.1 |
| 17 | Scrubbing in landscape | Accepted: relative drag with acceleration, detents, bake after a 150 ms dwell, column locked during a tool drag or pan | 4.1 |
| 18 | Show what is queued on other levels | Accepted: counts on ruler rows; the ghost column stays while a tool is open | 4.1, 4.4 |
| 19 | Fewer taps | Accepted, with tap budgets. **Disagree** on Channel Up: channelling removes a floor, which is only reachable from that floor's own level, so Up would only queue jobs on levels the hold must climb to anyway. Mine and Carve hall get Up | 4.4 |
| 20 | Landscape safe areas, no haptics | Accepted. The edition had no haptics; the doc now says so explicitly | 4.1 |
| 21 | Light dirtiness | Accepted | 2.6 |
| 22 | Link Dijkstra cost | Narrowing the stamp and the 6-miner bench: accepted. **Disagree** on charging Dijkstra nodes to the expansion budget: whether a goal's Dijkstra runs depends on whether the cache is warm, so charging it would make the budget, and so which searches run this tick, differ after a load. That is exactly point 1. Instead a request-counted cap: at most 6 distinct new goals start searches per tick, counted by requests, not misses | 6.2 |
| 23 | Collisions in one tree | Partly: `sw.js` is **already generated** (`node tools/check-sw.mjs --write` between FILES markers); the rule is "never hand-edit; the merge step regenerates". Single writers for `commands.js`, `schema.js`, `balance.js`, `css/style.css`: accepted | 8.1 |
| 24 | Simplify the migration, add checks | Accepted: no charter or spec steps, no `col.done` back-fill, pending perks resolved to the nearer deed (in Stage 2.9), three new checks | 5.4, 8.2 |
| 25 | Two-level caverns | Accepted for Caverns I and II | 2.2 |
| 26 | Side section in the ruler | Accepted as an optional Z4 view | 4.1, 8.6 |
| 27 | Veins in migrated heights | Accepted | 5.4 |
| 28 | Research by doing; tiers gating structures | Tiers stop gating structures (F27, Z2.9). Research by doing is open question 5 for the owner | 9 |
| 29 | Name hygiene | Already held; kept | - |

---

## 1. Removals (exact list, with what replaces each one)

Paths are from STUDY (b). "Delete" means removed from the tree; git history keeps it. **All of section 1 ships as Stage 2.9** (8.2), on today's single-level engine, before any z-level work. A line marked **(migrate)** has a matching step in the Stage 2.9 state migration v2 to v3 (5.3).

### 1.1 The classic roguelite and its link (F21)

| Remove | Paths | Replacement |
|---|---|---|
| The frozen roguelite copy | `classic/` (113 files, 2.3 MB) | none |
| Title-screen link and its ghost-click guard | `js/ui/colonies.js:2, 56-60, 71`; CSS `.ec-classic` at `css/style.css:75, 86`, plus the header comment at line 4 | The title shows Continue, Colonies, New colony, Settings, Import. R2 10.8 is amended accordingly |
| Classic save tooling | `js/game/save/slots.js:30-34, 353-396` (`classicSaves`, `exportClassic`, `clearClassic`, `storageBytes().classic/classicKeys`); `js/main.js:40-43, 60, 266, 270-287, 363` | Settings > Storage keeps **one** row for one release: "Old roguelite saves: N KB. Export and remove". It removes the `embercrown.*` keys. The release after that drops the row |
| Service worker passthrough | `sw.js:6, 8, 309` (`CLASSIC`) | none |
| Tools | `tools/check-sw.mjs` classic rules (lines 6, 12, 85, 88, 93-127, 154); `tools/classic/`; `tools/bench/legacy/`; the legacy mode in `tools/bench.mjs:20`; `tools/legacy-baseline.json`; the `--legacy` mode of `tools/check-imports.mjs` | `check-sw` instead asserts that no `classic/` path exists |
| Tests | `tools/tests/save-1b.test.mjs:198-207`; `tools/tests/save-2.test.mjs:2, 199-213` | One test for the one-release export-and-remove row |
| Docs | `README.md` ("A roguelite realm-builder"); `EMBERCROWN.md`; `EMBERCROWN-REWORK.md`; R2 D12, 11.1-11.2 classic rows, 13.5 "Classic copy", 0 "Clearing the old keys" | A new README (the pitch in 1.5). `EMBERCROWN.md` and `EMBERCROWN-REWORK.md` are deleted |
| The 71 dead roguelite modules | the full list in STUDY b.1, also in `dead.txt` | none. **Before deleting**, salvage the Lords' art (`bossart.js`, `colossusart.js`, `kingart.js`, `foeart.js`) by moving it into `js/engine/art/beasts.js` (owner D) |
| Roguelite tables in a live file | `js/data/balance.js:1-251` (`BAL`, `MATCHUPS`, `DEFAULT_MODS`, `RUN`) | Delete them. The colony sections from `TIME` on stay |
| Leftover run fields and comments | `js/data/factions.js:30-31, 64` (run and unlock fields); `js/engine/audio.js:22, 212, 257, 674` (`victory`; the "Sovereign" comment); `js/game/core/bus.js:7-8` | Strip them. The `defeat` stinger stays: it plays when a hold falls |

### 1.2 Pick-1-of-N choices (F10, F11, F12)

**Level-up perk picks**
- Remove:
  - `pendingChoices`, `takePerk`, the `KEY_LEVELS` choice and the `perk` letter in `js/game/people/perks.js` (lines 61-76, 104).
  - The `perk` command (`commands.js:179`).
  - `perksBlock` in `js/ui/colonistui.js:209-231`.
  - The "can choose a perk" alert (`js/ui/alerts.js:5, 218-222`; `js/ui/shell.js:57, 284`).
  - The `perk` letter kind (`js/ui/letters.js:27, 30, 40-47, 117`).
  - The perk flow in `tools/ui-phone2.mjs:5, 160`.
  - The choice tests in `people-2`, `ui-2` and `commands`.
- Replacement: **perks earned by deeds** (3.1).
  - `perkrules.js` (`hasGrant`) stays, because it is how a perk acts.
  - `perks.js` keeps its 33 rows and gains an `earn` field.
  - **(migrate)** Perks already taken are kept. A pending choice is **resolved, not dropped**: the colonist gets the perk of the pair whose deed they are nearer to, measured from what the Stage 2 save records per colonist (kills, wounds tended, items they made, structures they built, the 20 log lines). When neither deed has a measure, the pair's first perk is granted. A Chronicle line says so ("Bryn settled into the ways of a Seam Follower").

**Colony charters** (pick 1 of 5 at Hamlet, a second at Stronghold)
- Remove:
  - The `charter` command (`commands.js:172`) and its applier in `js/game/colony/charters.js`.
  - `letter_charter`.
  - The charter references in the `colony`, `hd-2`, `schema`, `commands` and `validate-data` tests, and in `tools/lib/bot2.mjs`.
- Replacement: **renown** (3.10), which never gates anything. The five mechanic stubs in `js/game/colony/charters/*.js` (commissions, herds, the light network, caravans, garrisons) become **verbs every hold has** and move to `js/game/colony/verbs/*.js`. `js/data/charters.js` becomes `js/data/renown.js`. The charter structures (Great Anvil, Keep and the rest of `js/data/structures/charter.js`) become ordinary structures in `js/data/structures/civic.js` and `defence.js`, needing only materials and research.
- **No migration step:** Stage 2 has no UI for charters, so no player save holds one. A save with `colony.charters` set (tests only) has it dropped.

**Workshop specialisations** (pick 1 of 2-3 at tier II and III)
- Remove the `spec` command (`commands.js:168`), the picker and re-tooling.
- Replacement: **add-ons** (3.7). `js/data/specs.js` becomes `js/data/addons.js`.
- **No migration step:** Stage 2 has no UI for specialisations either. A test-only `spec` field is dropped.

**Dawn card-style choices.** None are live: the Dawn Ledger and Next steps are suggestions, not picks. Both stay (R2 10.10).

**Inspiration letters with choices.** None exist. Inspirations already roll automatically (`breaks.js:128-168`) and stay.

**Kept on purpose, because they are decisions, not rewards:**
- accepting or refusing a wanderer or refugees;
- recruiting, ransoming or releasing a captive;
- buying back an heirloom;
- letting the Grey Pilgrims pass or fighting them;
- choosing a start, a storyteller and a difficulty when founding;
- appointing offices (3.4).

### 1.3 Reclaim and Ironhold (F8, F9)

**Reclaim** was never built. It lives only in R2 D10, 9.9 and 9.10. Delete those parts of R2; the R2 9.10 "Reclaim also carries over the living nemeses" bullet goes with them.

**What replaces it: the fall and the Ruin** (owner A for the state and the card, I for the screens):
- **Fall test:** once per game hour, `colony.fallen` is set when no colonist is free and able for 24 consecutive game hours. "Able" means not dead, not downed without a rescuer, not in an extreme break and not captured. The sim then stops: `tick()` becomes a no-op for a fallen colony.
- **Final screen:** "The Hearth goes cold". It shows years lived, deeds, the dead with causes, the deepest level reached (Stage 2.9: the deepest distance into rock), named artifacts, great beasts slain and the last Annals page (Stage 2.9: the last Chronicle page). The `defeat` stinger plays.
- **Ruin card:** the colony card is marked **Fallen** (greyed banner, "Fell in Year 3, Ashfall 4"). It offers:
  - **Annals** (read-only);
  - **View the ruin**: the map at its final state, read-only, with the camera, level controls and inspection, and no commands;
  - **Export** (the save and the Annals as text);
  - **Delete**.
  - There is no Continue.
- **Backups are not on the card.** A fall is meant to stand. The rotating slots and the dawn backup still exist for every colony, for phone accidents and storage faults, and they live in **Settings > Storage > Recover from a device problem**: a list of the colony's stored copies with their game date, behind one confirmation ("Use this only if the game or the phone lost your progress. A fallen hold stays fallen in its Annals."). Loading a copy that predates a fall writes an Annals line, "Recovered from a copy of Year 3, Ashfall 2", so the record stays honest.
- **Arrivals:** wanderers and migrants arrive only while someone lives.
- **A new colony** is always a new seed and map. Nothing carries over: no heirloom, no nemeses, no techs.

**Ironhold**
- Remove:
  - `DIFFICULTIES.ironhold` and `colony.iron` (`js/game/core/schema.js:22-27, 206`);
  - the v1-to-v2 `iron` step in `js/game/core/state.js:22-28`, which is kept for v1 saves but sets `difficulty: 'hard'`;
  - `js/game/core/setup.js:150, 160`;
  - the single-slot and no-dawn-backup rules in `js/game/save/slots.js:28-29, 114-115, 147, 179, 200-207, 229, 246, 303, 316` and `js/main.js:35, 60, 113-122, 265`;
  - the Ironhold text and label in `js/ui/colonies.js:3, 25, 199`;
  - the Ironhold cases in `tools/tests/save-2.test.mjs`.
- Replacement: difficulty **Hard** (`difficultyPct.hard: 140` in `balance.js:315`, renamed from `ironhold`) with normal slots and backups.
- **(migrate)** `iron: true` becomes `difficulty: 'hard'`, and the `meta` card loses `iron`. An Ironhold colony that had only slot `a` gets `b` and `dawn` on its next save.

### 1.4 Boss-and-win goals (F13)

| Remove | Paths | Replacement |
|---|---|---|
| Challenge Pyre and the `challenge` command | `commands.js:180`; `js/game/threat/lords/index.js` (the Pyre comment); R2 9.6 "Challenge or wait" | Great beasts arrive on their own (2.10, 3.12) |
| Lords as stubs gated to tiers | `lords/gloomwyrm.js`, `colossus.js`, `hollowking.js` (`spawn: () => null`); `js/data/raiders.js:31-33`; `js/data/schema.js:105, 112, 142, 335` (`lord`) | The files stay and become `js/game/threat/beasts/*.js`, implemented in Z3. The `lord` data type is renamed `beast` |
| Lord's Ember | `js/data/thoughts.js:129` (`lord_ember`); the R2 4.5 thought list | `slew_beast` (+10 for 10 days for the hold; +15 for the colonist who struck the last blow) |
| Crownhold gated on a slain Lord | `js/data/tiers.js:16-18` (`lord: true`; the Lord names in the tier texts); `js/game/colony/tiers.js:4, 25`; `colony.lordsDone` | Crownhold needs wealth 350,000, 26 colonists and Hearth level 4. **(migrate)** `lordsDone` is dropped. Tiers then become ranks (F27, Z2.9) |
| Wonders as charter goals | `js/data/structures/monuments.js` (`worldforge`, `bastion`: `flags: ['unique', 'wonder']`, `stages`); `js/data/schema.js:98, 269, 578-581`; `js/data/charters.js:7, 11` | **Prestige buildings** (3.11): optional, multi-stage, with room value, a name and an Annals page, and **no percentage effects**. The `wonder` flag becomes `prestige`; the `mods` on these rows are deleted |
| Great Hearth level 5 and the victory screen | doc only (R2 2.1, 7.10, 8.4); `tiers.js` stops at level 3 | Hearth levels stop at 4 (Brightflame). Brightflame is built in Z2 |
| Trophies as requirements | R2 7.10 `trophy` row | A **trophy** is an optional monument made from a slain beast's remains (beauty 30, a legend entry) |
| "Deep Reader: studying a Lord's trophy" | `js/data/perks.js` `deep_reader` text | "studying a great beast's remains shows its telegraphs 1 s earlier" |
| Research names "Wonder-craft" and "Crown-smithing" | doc only (`research.js:6, 15` era `crown`) | "Great halls" and "Crown-smithing" (regalia for nobles, 3.4) |

### 1.5 The new pitch (replaces R2 1, keeping its tone)

*The Hollow took the old kingdom's light. You lead a handful of named survivors to a vale under a mountain, kindle a Hearth, and dig. Level by level the hold goes down: through soil and stone, past glowing caverns and a sunless lake, to the ember-hot rock and the grey cold where the Hollow sleeps. Your people grow by what they do, remember what they saw, quarrel, mourn, make masterworks in strange fevers and bury their dead. Nothing resets. There is no win: only the hold, its years, and the stories it leaves in the Annals.*

**Pillars.** R2 1 stands, with two changes:
- Pillar 3, "Dig deeper, find more", is now literal: deeper levels are richer and more dangerous.
- A new pillar 7: **"A world with a history."** The vale has a past (pre-history generated from the seed), and the hold writes its own.

**Hooks.** The R2 hooks list changes in four places:
- Hook 6 (Reclaim) is replaced by **"The Seal"**: at the bottom of the world a Seal-stone holds the Hollow King asleep, with the richest Heartstone around it.
- Hook 1 (the greed lever) now reads "dig within 2 levels of a seep".
- New: **"The deep has its own life"**: caverns with their own creatures, people and light.
- New: **"Nobles want things"**.

---

## 2. The multi-level world

### 2.1 Size and layout

- **128 x 128 x 20.** PLANE 16,384, N 327,680.
- **Why 20** (PROTO 1 and 2):
  - Path and render costs follow *open voxels*, not D: link A* p95 is 0.42-0.53 ms at D = 12, 20 and 30 alike.
  - Memory and whole-map passes grow with D. Dense state is 12.8 / 21.3 / 32 MB at D = 12 / 20 / 30.
  - D=20 fits three cavern levels, an ember layer and the Hollow in about 21 MB.
  - D=30 would add about 11 MB of mostly pristine rock (66% of its chunks).
- **Dense typed arrays** at D=20, with no paging. Paging would save 13 MB but slows hot loops 1.27x and touches every access (PROTO 1). Paging is reconsidered only if D > 24 or W > 128.
- Level size stays 128 x 128, so a Stage 2 plane maps 1:1 onto level `zS` and the surface play is unchanged.
- Every level is a contiguous slice of every layer. A per-level pass is a loop over `[z*PLANE, (z+1)*PLANE)`.

### 2.2 The layers of the world (native v3 generation)

z counts from the bottom. The UI shows **relative levels**: 0 is the surface, +1..+5 the heights, -1..-14 the depths. Band edges wobble by ±1 level using 2D noise, so layers are not flat, except caverns, whose floors sit on their own level.

| z | UI level | Band | Rock and soil (mining work, game min at speed 1.0) | What is found there | Light, temperature |
|---|---|---|---|---|---|
| 19-15 | +5..+1 | **Heights** | Mountain and hill rock. The massif is 25-35% of the map as in R2 3.2, rising from 1 level at its face to 5 at its core. Outer stones (sandstone, limestone; 12) near the face, granite and slate (20) in the core. Elsewhere: open air | coal, copper and tin near the face; iron in the core; amber, garnet; a high spring; cliff ledges for watch posts | daylight on open ground; under rock, cover rules (2.6) |
| 14 | 0 | **Surface** (`zS`) | Valley floor: grass, meadow, forest, river (2-3 fords), lake, marsh, sand, rich soil. The mountain face and its base, which is where the old "tunnel in" play still starts | every R2 3.2 surface feature (step 7): ruins, start site, spawn edges | daylight; outdoor temperature |
| 13 | -1 | **Topsoil** | Loam, clay pockets, sand under the river and the lake. Soil mines in 6 min and yields soil items: clay, sand, loam (Z2 uses them). Under the massif: outer stone | clay deposits; buried ruins under crypt sites | cover >= 1 |
| 12 | -2 | **Subsoil and aquifer** | Clay and loam. Under the lowland (river, lake, marsh, plus 40% of the valley columns nearest them) lies a **wet sand aquifer** (2.8) | amber; the aquifer is a free clean-water source for wells | 12 C |
| 11-10 | -3, -4 | **Outer stone** | Sandstone, limestone (12) | coal, copper, tin, clay seams, amber, garnet | 12 C |
| 9-7 | -5..-7 | **Middle stone** | Granite, slate (20) | iron, coal, tin, garnet, sapphire; 1-2 **springs**; **Old Crown vaults** (1-2, at z 9-6) | 12 C |
| 8-7 | -6, -7 | **Cavern I: the Glowcap Hollows** (carved into the middle stone, **two levels**) | Cellular-automata cavern: the floor level z 7 is 25-40% open; z 8 holds **ledges** (10-20% open) over it. **Natural ramps** join ledges to the floor (4-10), and **chasms** (`AIR` columns at z 8 over open floor) give drops, overlooks and archers' perches | glowcaps, cave moss, **greyshank** (giant grey fungus; it yields shankwood, the underground timber), cave loam floors (farmable); glowbeetles, cave spiders, blindfish in pools | glowcap light 1 ("gloam"); 11 C |
| 6-4 | -8..-10 | **Deep stone** | Basalt, marble pockets (30) | iron, silver, gold (z <= 6), sapphire, emerald | 12 C |
| 5-4 | -9, -10 | **Cavern II: the Sunless Mere** (carved into the deep stone, **two levels**) | A large underground lake on z 4 (static water until Z3) with shores; z 5 holds **shore cliffs and ledges**, natural ramps down to the shore and 1-2 **rock bridges** (natural floors over `AIR`) across the narrows | mere-reed, dimroot; blindfish, mire leeches, shellbacks (armoured cave crabs); the **Lamplost** camp (a cavern people, 2.10) on a ledge | dark, except shore lichen (1); 10 C |
| 3 | -11 | **Underdeep** | **Duskstone** (45) | lumenite (glows through 3 voxels of rock), gold, ruby, Heartstone | dark; 8 C |
| 2 | -12 | **Ember layer** | **Emberrock** (45; hot, dark red) with **ember pools** (molten rock, fluid kind ember, static until Z3) | Heartstone, ember salts; an ember forge site (Z2 3.7) | ember pools give light 2 and heat; 38 C, up to 60 C beside a pool |
| 1 | -13 | **Cavern III: the Hollow Reach** | A grey cavern plane | 2-3 **Hollow seeps** (the breach sources), Gloom Hound dens, Husk barrows, Duskstone outcrops, Heartstone pockets | dark; **2 C (the grey cold)** |
| 0 | -14 | **The Hollow** | **Greystone**: unmineable, except the **Seal-stone** (a 3 x 3 voxel plug) | the **Sleep** of the Hollow King (a sealed vault around the Seal); Crown relics and a Heartstone hoard | -10 C; no light |

**Ore and gem tables:**
- `js/data/worldgen.js` DEPOSITS keeps its depth columns. They now read **levels below the surface** through a band map: old depth 1-4 means the outer stone levels, 5-12 the middle stone, 13-22 the deep stone, and 23+ the Underdeep and lower.
- Inside the massif at z >= zS, the R2 "distance into the massif" table still applies horizontally, but capped at the middle stone. So the face still gives coal and copper, and the deep stuff needs digging down.
- Veins are 3D random walks of 6-20 voxels (gems 1-3) on `gen3:veins`.
- **Generation guarantees** (checked on seeds 1-100; a failing seed re-rolls only the failing step):
  - the start site lies within 6 tiles of the mountain face;
  - coal and copper exist within 3 levels of the surface and 40 tiles of the start;
  - iron exists above z 8;
  - every cavern floor level is at least 600 open voxels, in at most 3 parts; in Caverns I and II, at least 4 natural ramps join the ledge level to the floor level, and every ledge part over 40 voxels has one;
  - the Seal is not under the start site, and lies at least 30 tiles from it.

**Mapgen steps.** Each step is a `gen3:<step>` fork. The function is pure and returns the whole world (`js/game/world/mapgen3.js`):
1. Surface heightmap and auto ramps (2.3).
2. Column fill: soil, then stone bands by z.
3. Caverns (CA, 5 smoothing passes): two-level caverns at z 8-7 and z 5-4 (the upper level's CA is masked by the lower one's open area, eroded by 1, so ledges overhang open floor; chasms and natural ramps follow), and Cavern III at z 1.
4. The aquifer mask and the springs.
5. 3D veins.
6. Vaults, the seeps, the Seal and the Sleep.
7. The R2 surface features at zS (river, lake, forest, ruins, start site, spawn edges).
8. **Dormant content** (edition 4): every world feature that a later stage uses is placed now, at `genVersion` 1, so native worlds never need a world amendment (5.6) for it. That is the cavern populations' spawn sites and dens (Z2.7, Z3.1), the Lamplost camp, the great beasts' lairs and their generated bodies (3.12), the Gloom Hound dens and Husk barrows of Cavern III, and the floodgate-worthy springs. Each is a short list of `[kind, voxel, seed]` rows in the pristine `meta` record; a system that has not shipped ignores its rows.
9. The guarantees.

**Determinism rules for mapgen** (lint `tools/check-mapgen.mjs`, in the gate): no `Math.sin`, `cos`, `tan`, `exp`, `pow`, `log`, `sqrt` on non-perfect inputs, or `hypot` anywhere under `js/game/world/mapgen*` and `js/data/worldgen.js`; today's `mapgen.js` already uses `sinX`, and that becomes the rule. Integer or float arithmetic in `+ - * /` only, plus the repo's own `sinX` and table lookups. This keeps the regeneration fallback (5.1) and the Node/WebKit equality test honest.

**Budget:** 40-95 ms in Node, about 100-240 ms on an A15 (est.), behind a "Carving the world" splash. It runs **once per colony**, at founding (or at migration); the result is stored as the colony's pristine world (5.1). A normal load inflates the stored copy in about 5 ms instead.

### 2.3 Vertical movement: stairs, ramps, shafts, channels

**New terrain ids** (C1 v3; existing ids 0-15 are unchanged):

| Id | Name | Walkable | Links to | Notes |
|---|---|---|---|---|
| 16 | `AIR` | no (nothing to stand on) | - | open space with no floor; shows the level below, dimmed |
| 17 | `STAIR_U` | yes | z+1 if that voxel is `STAIR_D` or `STAIR_UD` | carved or built |
| 18 | `STAIR_D` | yes | z-1 if that voxel is `STAIR_U` or `STAIR_UD` | |
| 19 | `STAIR_UD` | yes | both | the middle of a stair shaft |
| 20 | `RAMP` | yes | its `RAMP_TOP` at z+1 | needs a solid planar neighbour at z (the slope leans on it) |
| 21 | `RAMP_TOP` | yes | its `RAMP` at z-1, plus planar moves at z+1 | the open voxel above a ramp, drawn as a down-ramp |

**Movement rules** (the prototype's rule):
- A mover changes z only between an "up" voxel and a "down" voxel directly above it.
- Planar moves use 8 neighbours with no corner cutting, as today.
- A vertical step costs 200, which is 2 tiles of walking (`balance.js` PATH `vert`).
- A mover never steps into `AIR`.
- **Falling:** if the voxel under a mover or item becomes `AIR` (a channel or a collapse), it falls to the first floor below. It takes 10 blunt damage per level beyond the first, in one wound. Items take 25% hp per level.

**Generated ramps:**
- Mapgen places a `RAMP` at every one-level step of the surface heightmap where the slope faces open ground (about 1 in 3 edge columns). The heights can therefore be walked onto without digging.
- Cliff steps of 2+ levels get no ramp.

**Digging designations:**
- All of them are tools in Orders (4.4). Work values use R2 3.4, with the stone work by band from 2.2.

| Designation | On | Result | Where the worker stands | Work |
|---|---|---|---|---|
| **Mine** | rock at z | rough floor (the voxel's mat kept); the ceiling is whatever is above | a planar neighbour on z (ADJ4), as today | stone work |
| **Stairs** (part of a stack from the Stairs tool) | rock or floor | `STAIR_D` at the top, `STAIR_UD` in the middle, `STAIR_U` at the bottom | the top voxel: from a planar neighbour. Each lower voxel: **from the stair voxel directly above it** (new goal mode `ABOVE`) | stone work x 1.2 |
| **Ramp** | rock at z with open floor at z+1 next to it, or a wall face | `RAMP` at z and `RAMP_TOP` at z+1 | a planar neighbour on z | stone work x 1.2 |
| **Channel** | an open floor at z | the voxel becomes `AIR`. If z-1 is rock, z-1 becomes `RAMP` and this voxel `RAMP_TOP`. Items fall | a planar neighbour on z (never on the voxel itself) | stone work x 0.8 |
| **Smooth, Engrave, Prospect** | as R2 3.4 and 3.5 | unchanged | | |

**Built vertical structures** (Construction; Z1 ships built stairs, Z2 the rest):
- built stairs (blocks or planks) on open floor or over air;
- built ramps;
- a **built floor** placed on `AIR` (span rule F20);
- **Winch and shaft** (Z2, a utility structure over an `AIR` or stair column): a hauler loads up to 3 stacks at one end, and they arrive at the other end after 2 s per level. It is the vertical hauling shortcut;
- the mine-cart track with its ramp pieces (Z4).

**Shafts.** An open-air column (channelled level by level) is a shaft:
- daylight falls down it to the first floor (2.6);
- items and creatures can fall down it;
- archers can shoot down it (Z3);
- flyers can come down it (Z3);
- a winch can run up and down it.

### 2.4 Depth, cover and roofs

- **`rt.cover[col]`** (u8 per column, incremental): for each voxel, the count of solid voxels above it, capped at 3. Solid means natural rock, a constructed floor or a built roof. It is computed per column from a top-down scan and updated by the terrain API on every write in that column.
- **Ceiling of voxel (x, y, z)** is any of:
  - a solid voxel at z+1;
  - a constructed floor at z+1;
  - a built roof at z (the `roof` layer, R2 3.3, value 1).
- **The `roof` layer keeps only value 1 (BUILT)**, as the RimWorld-style light roof over buildings on any level that is open above. Values 2 (thin) and 3 (mountain) are retired, because real rock above replaces them. **(migrate)**
- **Underground** = `cover >= 1`. **Deep underground** = `cover >= 3`. These replace every R2 use of roof 2 and roof 3:
  - flyers cannot enter `cover >= 1`;
  - fire from outside does not reach `cover >= 3`;
  - "Underground" thoughts read `cover >= 1`;
  - Sylvari "Stone-pressed" reads `cover >= 3`;
  - Deepforge "Rock and hearth" reads `cover >= 3` in a carved room;
  - the ice house reads `cover >= 3` with `z <= zS - 6`.
- **Levels below the surface** (`zS - z`) replace the R2 `depth` for the ore tables, discoveries, the greed lever and the Seep and Sleep wake rules. `rt.depth` and `depthRebuild` are deleted.

### 2.5 Support and cave-ins across levels (F20)

**The rule.** Run R2 3.4 **per level**:
- An open voxel with a ceiling must have a **support within Chebyshev distance 4 on its own level**.
- Supports are: natural rock or soil at z, a built wall, a support pillar, a wooden prop, a stair voxel, or a `RAMP`.
- **Soil is weak.** If the ceiling is soil (z 12-13 under the valley), the distance is **2**, so a room in soil is at most 5 x 5 between pillars. That makes the topsoil a real decision, as it is in the real world.
- **Hanging floors.** A constructed floor or a natural floor voxel over `AIR` must lie within Chebyshev 4, on its own level, of a voxel that stands on something solid, or of a wall, a pillar or rock. A bridge across a shaft is therefore at most 9 wide. Bridges proper (wider spans) are a Z4 structure.
- **Kernels:** per-plane chamfer passes. `pass.js` `supportPatch` and `chamfer` run at an offset of `z*PLANE`. `rt.support` (u8 of N) is kept, and each patch costs as today.

**Collapse:**
- When support is lost, the affected ceiling voxels show cracks and rumble for 40 ticks, then fall.
- **Each unsupported open voxel at z fills with rubble** (terrain 11, mineable, yields 0, or yields stone in soil).
- **The ceiling voxel at z+1 becomes `AIR`**: a sinkhole opens in the level above.
- Colonists at z take 20-45 blunt damage (one wound) and are pushed to the nearest open voxel.
- Anything standing on the collapsed ceiling, at z+1, falls (2.3).
- Items at z are destroyed (50%) or buried (50%).
- **Chains:** a floor at z+1 or z+2 left hanging is re-checked one level per rumble (40 ticks), so a chain shows level by level and never collapses a whole column in one tick.
- `caveQ` holds u32 voxel indexes. The collapse window stays 9 x 9 per level.
- **Planning:** the designation preview shows orange stripes on any voxel whose mining or channelling would leave a ceiling or floor unsupported, **on the view level and on the level above** (the level above shows a faint stripe at the voxels that would lose their floor). The Carve hall tool and the risky-ok flag work unchanged, per level.

### 2.6 Light and temperature across levels

**Light** (`js/game/world/light.js`; R2 3.3 and 12.4 rules otherwise):
- **Per-level flood fill.** The same 8-way kernel runs on one plane. Opaque voxels are rock, soil, walls and closed doors.
- **Sky light.** `rt.skyZ[col]` (u8 per column) is the lowest z the sky reaches: the top-down scan stops at the first voxel that is not `AIR` or `RAMP_TOP` and is not under a built roof. Daylight `DAY[phase]` lights the voxel at `skyZ` and every voxel above it in the column. From there it spills one level per tile under ceilings, as today's roof spill. A shaft channelled down 5 levels lights its bottom floor by day.
- **Between levels.** After the planar floods, one vertical pass carries light through stair pairs, ramp pairs and open air: a voxel at z±1 linked to a lit voxel gets `light - 1`. Spill reaches one level only.
- **Underground sources:**
  - torches, sconces, braziers, the Hearth (R2);
  - lumenite in walls (light 1, radius 2);
  - glowcaps and glowbeetles (light 1);
  - ember pools (light 2, radius 3);
  - shore lichen (light 1).
- **Dirty flags are per level** (edition 4):
  - an ordinary write at z (mining rock into floor, building a wall, a door opening) dirties **level z only**;
  - a write that changes **vertical connectivity** also dirties z-1 and z+1: a voxel becoming or ceasing to be `AIR`, a stair or ramp voxel, a channel, a collapse, a built floor over air, and any write that changes `skyZ` for its column;
  - the terrain API knows which case it is in, because it already updates `cover` and `skyZ` in the same call (7.5).
- **Day-phase relight is spread.** When the day phase changes, the sky-exposed levels (those holding a column with `skyZ <= z`: in practice the surface, the heights and the levels that shafts reach; 6+ planes in a mature hold) are relit **one level per tick, top-down**. The pending list `lightQ` (u8 levels plus the target phase) is **saved state** (RUNTIME, F25), so a load mid-sequence continues it exactly. That caps the spike at one plane, 0.2 ms desktop (0.5 ms A15), instead of about 3 ms on one tick. Sim reads of light on a level still waiting in `lightQ` see the old phase, deterministically.

**Temperature** (`js/game/world/temperature.js`; R2 3.6 otherwise):

| Where | Base |
|---|---|
| `cover = 0` (open sky) | outdoor by season, as R2 |
| `cover = 1` / `2` / `>= 3` | blend outdoor to 12 C at 1/3 / 2/3 / full |
| z 13-5 (the soil and stone bands) | 12 C |
| Cavern I / II | 11 C / 10 C |
| Underdeep | 8 C |
| Ember layer | 38 C (heat sources: an ember pool adds 600 C x tiles, like the Hearth) |
| Hollow Reach | 2 C |
| The Hollow | -10 C |

- **The rest of the model is unchanged.** Rooms are already per level, so room temperature is unchanged. `rt.heat` spreads within Chebyshev 3 on its own level, plus 1 level up through open air (heat rises).
- **New thoughts:** "Sweltering" (-4 above 35 C, -10 above 45 C) and "Heatstroke" (a wound-free health condition above 50 C for 2 h, which slows work x0.7). Ember-proof gear comes in Z2 (3.7).

### 2.7 Fog and discovery per level

- **`fog` and `known` are bitsets of N.**
- **Sight:**
  - a colonist reveals its own level (radius 9 under open sky, 4 under a ceiling, as R2);
  - one level up and down through a stair pair (radius 2);
  - **down through open air**: standing at the lip of a shaft or cliff reveals the floor below, within radius 3.
- **Mining** a voxel marks its 6 face neighbours `known` (4 planar, above and below).
- **Prospect** reveals a cylinder of radius 5 and ±1 level. The **Survey Table** reveals radius 12 and ±2 levels.
- **New: Sounding** (Mining 6+, at any stair bottom): 2 game hours, reveals `known` for the column 1-3 levels below in radius 3, so the player can read what lies under the next floor before cutting into a cavern or an aquifer.
- Lumenite glows through 3 voxels in 3D. Vault walls show when a face neighbour is exposed.
- **Discoveries** (R2 3.5) gain one per band: first soil, first aquifer, each stone band, each cavern ("The Glowcap Hollows", "The Sunless Mere", "The Hollow Reach"), the ember layer, the Seal. Each writes a Chronicle line, a toast and an Annals entry (3.5). Opening a cavern is also the warning for its creatures (2.10).

### 2.8 Fluids (F19)

**Z1 and Z2: static.**
- **Surface water** (river, lake, marsh) stays terrain water (R2 terrain 7 and 8). Ice, fords, floods and fishing are unchanged.
- **Underground water and ember** live in the new **`fluid` layer** (u8 of N): bits 0-2 hold depth 0-7, bit 3 means ember (else water), bit 4 marks a source (aquifer or spring: it refills), bits 5-7 are reserved.
- **Pass rules:**
  - depth 1-3 water: walkable at x2 walk cost (x3 for depth 3);
  - depth >= 4 water: impassable;
  - any ember: impassable;
  - an ember voxel deals 30 burn damage per 20 ticks to anything adjacent that steps into it (pathing never does), and sets fire to flammable neighbours.
- **The aquifer** (z 12) is wet sand marked as a source:
  - mining it leaves a **seep** (water depth 2, source);
  - a stair through it is a "wet stair" (walk cost x2);
  - a built block or brick floor plus walls around a seep **line** it (Masonry, 1 game hour per voxel): the voxel becomes dry and the source bit clears;
  - a well on a seep is a free clean-water well.

**Z3: fluids lite (flow).**
- **The active set.** `rt.fluidActive` is a sorted u32 list of voxels whose fluid may move. A voxel enters it when its fluid or a neighbour's passability changes: mining next to fluid, a channel or collapse above it, a breach, a door or floodgate. It leaves it after 8 unchanged steps.
- **A step:** water every 4 ticks, ember every 16 ticks.
  1. Fall: move as much as fits into `AIR` or open floor below.
  2. Else spread: share with planar 4-neighbours whose depth is lower by >= 2, toward the average.
  3. Sources refill to 7 at their own voxel.
  - There is **no pressure**, so water never rises in a U-bend. Ember plus water makes **cinderstone** (a solid rock voxel, mineable, yields cinder blocks).
- **Budget:** at most 2,048 cells per step, in index order from a saved cursor. At most 4,096 active cells; beyond that, new activations queue. The target is <= 0.25 ms per step on an A15.
- **Surface water as a source.** A river, lake or marsh tile over an `AIR` or open voxel at zS-1 becomes a **source** for that voxel. This is the river breach: dig under the river, and it floods down.
- **Saved:** the `fluid` layer (chunk XOR) and `fluidActive` with its cursor (RUNTIME).
- **Water control (Z3, edition 4).** A flood must be answerable with more than walls:
  - **a closed door, gate or the new floodgate blocks fluid** (it counts as solid for the fluid step). An open one passes it. A floodgate (Masonry or Smithing; 1x1; blocks, iron) is a door that never lets creatures through, and is the one to put in a channel;
  - **levers** (today's lockable gates and levers, R2 7.x mechanisms) work floodgates, gates and bridges on any level; a link may cross levels (the link is a building id pair, not a tile);
  - **raising bridge** (Construction; 1x3 to 1x9 across a channel or a shaft): lowered it is a floor; raised it is a wall that blocks fluid and foes and leaves the voxels under it open. It is the drawbridge of a hold and the lid of a cistern;
  - a toggled door, gate, floodgate or bridge adds its neighbours to `fluidActive`;
  - the bot target: a scripted river breach is stopped by closing a floodgate from a lever two levels away.
- **Deferred to Z4:** pumps and pressure, wells by level, drowning versus swimming (Z3 colonists simply refuse depth >= 4), magma-fed devices.

### 2.9 Claims, plants, fire, weather, blight on levels

- **Claims** (R2 3.1) cover **columns**: the Hearth and Waystone discs are in x, y over every z. An underground voxel outside a disc is claimed when it is connected by tunnel or stairs to claimed voxels (R2 rule, made 3D). `claimMap` becomes a per-column u8 plus the connectivity flood per level.
- **Plants** grow on any level with soil or cave loam and light >= their need. Cavern plants (glowcap, greyshank, dimroot, mere-reed) need no light. The round-robin walks a sorted list of clusters that hold plants: 64 clusters as today, not 1,280.
- **Fire** spreads to planar 8-neighbours and to the voxel above (flames rise). `cover >= 3` stops outside fire as before.
- **Weather** affects open-sky voxels only (`z >= skyZ`). Freezing applies to sky-exposed shallow water.
- **Blight** is a surface layer, plus the Hollow Reach floor, which starts fully blighted and spreads 1 tile a day toward lit ground.

### 2.10 Surface threats, deep threats and what lives in caverns

**Entry points:**
- **Surface edges.** R2 entry segments on the border, at the **surface z of each column**. Raids, visitors, traders, reavers, sieges, the Grey Pilgrims and wild animals arrive here.
- **Deep passages.** Each cavern plane has 2-4 openings at its map edge that lead off-map. Cavern creatures, the Lamplost and wandering deep beasts arrive through them. **Nothing arrives through a cavern's passages until the hold has opened that cavern** (a fortress voxel connected to it). Before that, cavern life wanders inside its cavern and never leaves it.
- **Seeps** (Cavern III, plus any migrated seep at zS): breaches from the deep.
- **Sky:** flyers enter any voxel with `z >= skyZ`, so open shafts let them down.

| Threat | Entry | When (R2 9.3 unless stated) | Across levels |
|---|---|---|---|
| Hollow horde, thieves, reavers, siege, Grey Pilgrims | surface edges | as R2 | they path down stairs and ramps like colonists (hierarchical flow) |
| Beasts (surface) | surface edges | as R2 | |
| Sappers (Gutterkin delvers) | surface edges | Village | **dig down**: a per-level dig field on the target's level, plus stair cuts (stone work x 4 per level) along the region route (Z3) |
| Wyvern, Gloomwyrm | sky | Hold | come down open shafts; cannot enter `cover >= 1` |
| **Cavern creatures** | inside their cavern, then deep passages once opened | always present; manhunter packs as minor threats | |
| **The Lamplost** (cavern people: pale, lantern-bearing scavengers) | Cavern II passages | from the first opening of Cavern II | 50% of visits trade (glowcap ale, blindfish, lumenite dust) and 50% are thieves' raids. Goodwill applies as for the Gutterkin (R2 9.8) |
| **Breach from the deep** | Cavern III seeps (and a migrated zS seep) | Hold, or earlier when a fortress voxel comes within 15 tiles planar and 2 levels of a seep | come **up** through the fortress |
| **Great beasts** (3.12) | from their lair, through caverns the hold has opened (the Gloomwyrm: the sky) | when their cause holds (3.12) | climb or descend like any walker; flyers use shafts |
| Cave-ins, floods, ember breach | no warning but their tells (rumble; the sound of water; a red glow through rock seen within 2 voxels) | when the player digs into them | |

**Every threat has a cause** (F26; `js/game/threat/causes.js`, owner H; data `js/data/causes.js`, owner G):
- **A cause is a fact of the world state**, recomputed once per game day into a sorted list `st.causes` (derived, pure: F25). Each row is `[kind, subject, weight]`. The kinds:

| Cause | Comes from | Makes possible |
|---|---|---|
| **Grievance** | the pre-history (3.5): a world faction the Old Crown wronged, a clan whose vault the hold has looted, a reaver band whose captain the hold killed (nemeses) | raids and sieges by that faction |
| **Rumour of wealth** | traders who visited this year, weighted by the silver, gold and gem stock they saw | thieves, reavers, the Gloomwyrm (a hoarder) |
| **Opened cavern** | a fortress voxel connected to a cavern (2.7) | cavern packs, the Lamplost, deep beasts of that cavern |
| **Near lair** | digging within 12 tiles planar and 2 levels of a lair (mapgen dormant rows) | that lair's beast wakes |
| **Woken seep** | a fortress voxel within 15 tiles planar and 2 levels of a seep, or the Hold rank | breaches |
| **The Hollow's hunger** | lights on the surface at night, the Hearth's level | the Hollow horde (the baseline cause, always present from the first night) |
| **Hard winter** | the season and the weather | starving beasts at the surface edges |

- **The storyteller schedules only from causes.** Its budget and persona (R2 9.1-9.2, chosen at founding) still set the pace and size; it picks an incident kind only if a live cause allows it, weighted by the cause. No cause, no incident of that kind.
- **Letters and the Annals name the cause:** "The Ashen Banner comes for the vault of their fathers, which you opened in Thaw", "Word of your silver has spread since the Fen traders left".
- **Renown leans the weights** (3.10): a hold known for Trade is talked about more, so Rumour weights x1.5.

**How raids end** (replaces the R2 9.3 dawn rule):
- **Daylight harms the Hollow only on sky-exposed voxels** (`z >= skyZ` of the column) and only by day, as R2 (3% hp/s and flee to the edge). Underground there is no dawn.
- **Every raid has morale** (`raid.morale`, saved, 0-100). It drops on losses (-3 per member down), on the leader's death (-30), in light >= 3 for the Hollow (-1 per member-second), and when its goal has been unreachable for 2 game hours (-20). At <= 25 the raid **routs**: it walks back to its entry (edge, passage or seep) and leaves.
- A raid that routs underground may leave stragglers that hole up in dark rooms; they become **lurkers** until found (a minor alert).

**What lives in caverns** (data in `js/data/animals.js` and `plants.js`; kinds marked * exist today):

| Cavern | Fauna | Flora | Resource loop |
|---|---|---|---|
| I Glowcap Hollows | glowbeetle* (tameable light), cave spider* and great spider (webs, silk with the Silk frame add-on), blindfish (fishing in pools) | glowcap* (food), cave moss*, greyshank (timber), cave loam | underground farming and wood: a hold can live without the surface |
| II Sunless Mere | mire leech (bleeding wound), shellback (armoured; shell for armour), blindfish; the Lamplost | mere-reed (cloth fibre), dimroot (brewing), shore lichen (light) | fishing and fibre; trade with the Lamplost |
| III Hollow Reach | Gloom Hounds (dens), Husks (barrows), grey bats (minor swarms) | none living: ashen spore drifts (filth, dread) | Heartstone, Duskstone, the seeps; the most dangerous level |

---

## 3. DF-like depth to add (within the budget)

The rule from R2 8 still holds, reworded for "no picks": **a system adds verbs and stories, not percentages**. Numbers appear only as a short second line.

### 3.1 Growth by doing (F10)

- **Unchanged:** skills, XP, passions and the daily soft cap (R2 4.2).
- **What is new:** what used to be a pick is now earned.
- **Counters.** Each colonist gets `col.done: Uint16Array(32)`, a positional saved field. Each counter has an id in `js/data/deeds-col.js` and is incremented by the system that performs the deed, through a single `didDeed(s, col, key, n = 1)`. Counters saturate at 65,535.
- **The grant.** A perk row gains `earn: { lvl, deed, n }`. Once per game hour, for each colonist, `perks.js` checks every perk whose skill level and counter are both reached. A grant:
  - shows a toast: "Bryn has learned Seam Follower: she followed 150 ore seams";
  - writes a Chronicle line, a colonist log line and an Annals entry;
  - adds the perk.
  - There is no letter and no choice. A colonist can hold any number of perks.

| Skill | Perk (old level) | Earned when (level and deed) |
|---|---|---|
| Mining | Cave Sense (10) | Mining 10 and was within 6 tiles of 2 cave-ins, or mined 400 voxels |
| | Seam Follower (10) | Mining 10 and mined 150 ore voxels |
| | Stonefriend (20) | Mining 20 and carved 3 halls (Carve hall jobs of 40+ voxels) |
| | Heartdelver (20) | Mining 20 and mined 40 gem voxels |
| Construction | Quick Shoring (10) | Construction 10 and built 20 props or pillars |
| | Salvager (10) | Construction 10 and deconstructed 60 structures |
| | Master Builder (20) | Construction 20 and built 300 walls |
| | Siege Engineer (20) | Construction 20 and repaired 40 structures during raids |
| Smithing | Reforger (10) | Smithing 10 and smelted 40 ore loads |
| | Temperer (10) | Smithing 10 and forged 10 items of Excellent or better |
| | Crownsmith (20) | Smithing 20 and forged 3 Masterworks |
| | Ashquencher (20) | Smithing 20, and weapons they forged dealt the killing blow to 30 Hollow |
| Medicine | Field Surgeon (10) | Medicine 10 and tended 40 wounds |
| | Fever Watch (10) | Medicine 10 and cured 5 infections |
| | Taintbreaker (20) | Medicine 20 and tended 15 taint wounds |
| | Ember Hands (20) | Medicine 20 and stopped 5 downed colonists from bleeding out |
| Melee | Shieldwall (10) | Melee 10 and fought in a 1-tile choke in 3 raids |
| | Duelist (10) | Melee 10 and downed 3 captains or elites |
| | Unbroken (20) | Melee 20 and was downed and recovered twice |
| | Warcry (20) | Melee 20 and killed 60 foes |
| Archery | Fire Arrows (10) | Archery 10 and hit 150 shots |
| | Overwatch (10) | Archery 10 and made 20 kills from a tower or on Hold |
| | Deadeye (20) | Archery 20 and killed 5 elites |
| | Volley Captain (20) | Archery 20 and made 30 kills in a squad with 2+ archers |
| Signatures (15) | Trapwright; Stone Carver; Banner-maker; Hearth Cook; Graft-hand; Beast-friend; Deep Reader; Chronicler; Silver Tongue | built or rearmed 30 traps; smoothed or engraved 200 voxels; sewed 20 garments; cooked 200 fine meals; harvested 300 plants; tamed 5 animals; researched 10 techs or read 2 lore tablets; engraved 20 walls; made 20 trades or persuaded 2 prisoners |

- **Balance target** (bot report): by day 120, the median Master holds 1-2 perks of their skill. No perk arrives before its level.
- **Inspirations** (R2 4.5) stay automatic.
- **Teaching (new, small):** a colonist working within 3 tiles of a Master or Grandmaster of the same skill learns x1.25. There is no UI: a "learned from Bryn" log line appears once a day.

### 3.2 Personalities and preferences (F15)

Data lives in `js/data/personality.js` and logic in `js/game/people/personality.js` (owner F). Everything is generated at arrival and fixed. Facets can drift ±1 over years after major events (a friend's death raises Temper with 10% chance).

**Facets** (6, each -3..+3, shown on the Bio tab as plain sentences: "Quick to anger", "Never rattled"):

| Facet | Drives |
|---|---|
| Sociability | chat chance x(1 + 0.15 x f); "Lonely" after 3 days at f >= 1, never at f <= -2 |
| Temper | break thresholds +f; at f >= 2, a Tantrum is the likely break, and insult sprees too |
| Nerve | flee threshold; Dread gain x(1 - 0.1 x f) |
| Diligence | work-shift length the colonist tolerates without "Overworked" (-3) |
| Fancy | beauty and room thoughts x(1 + 0.2 x f); wants art in their bedroom at f >= 2 |
| Reverence | prayer joy; "Unrested dead" thoughts x(1 + 0.25 x f); dislikes desecration (deconstructing graves) |

**Values** (4, each -2..+2): **Craft, Kin, Order, Valour**.
- They colour reactions:
  - Order: crimes, mandates, offices;
  - Valour: "We held the line", fleeing, the great beasts;
  - Kin: deaths of kin, weddings, births (Z4);
  - Craft: masterworks, artifacts, unmet mandates for goods.
- A value of ±2 doubles or halves the matching thoughts. A noble whose value clashes with the hold's renown (a Valour-loving Thane in a hold known for trade) gets "Our hold is soft" (-3).

**Preferences** (5 liked, 1 disliked), drawn from data pools weighted by ancestry:
- Liked: a stone or metal, a gem, a food, a drink, a creature, an item kind (goblets, chairs, axes...).
- Disliked: one creature or one food.
- **Thoughts:**
  - "Admired the granite here" (+2, +4 when Fine+) in a room whose walls, floors or furniture use the liked material;
  - "Ate a favourite dish" (+3);
  - "Saw a glowbeetle" (+2);
  - "Owns a fine goblet" (+3, for a held or bedroom item of the liked kind);
  - "Spiders!" (-3 when within 4 tiles of a disliked creature).
- Preferences also steer the Seizures of craft (3.3) and noble requests (3.4).

**Life goals** (edition 4; one per adult, drawn at arrival from data weighted by values and skills; shown on the Bio tab):
- examples: "Craft a masterwork" (Craft), "Raise a family" (Kin), "See the Hold reach Crownhold" (Order), "Slay a great beast" (Valour), "Walk the deepest level" (any), "Have a room named for them";
- each is a test over existing state or deed counters (3.1), checked once a game day;
- met: "Lived to see it" (+8 for a year, then a lasting +2) and an Annals entry; never met by 70 years of age: "A life unfinished" (-3, lasting);
- no choice, no reward beyond the thought and the story.

**Memories.** The 12 strongest event thoughts (a death, a raid, a collapse, a masterwork, a wedding) leave a **memory** in `col.mem` (at most 8 per colonist): `[thoughtId, year, season, value]`.
- Once a season, each memory rolls a recurrence thought at half value: "Remembered the Ashfall raid" (-3) or "Remembered Hal's wedding" (+2).
- Memories fade by 1 a season and drop at 0.
- This is how a hold's past keeps weighing on its people.

### 3.3 Seizures of craft: the moods family (F16)

This folds R2 4.5 Ember-touched into one system. It reuses the claim-a-bench, demand card, locked bill and named artifact mechanics of `embertouch.js`, which becomes `js/game/people/seizures.js`. `js/data/embertouch.js` becomes `js/data/seizures.js`.

| Seizure | Trigger (checked once per game day; at most one active colony-wide) | Demands | Result if met in 5 days | If not met |
|---|---|---|---|---|
| **Ember-touched** | a crafter (Smithing, Woodcraft, Masonry, Tailoring, Art or Cooking) at 6+, mood >= 30; chance 1.5% a day | 2-4 materials; one is from **deeper than anything mined so far** (as R2), and one is the colonist's **liked material** when it exists | a named artifact (Masterwork or Legendary), +1 skill level, +12 mood for 10 days | "Unmade work" grows; on day 5 a major break, and 10% chance to become Hollow-Touched |
| **Brooding** | within 10 days of the death of a friend, kin or lover; a crafter at 4+ | 1-3 materials plus a **token of the dead**: an item they owned or made, or stone from their grave site | a named **memorial artifact** (beauty x2, "In memory of Hal"); friends of the dead +6 | the colonist becomes **Melancholy** (a lasting trait: -6 base mood until a memorial for the dead is raised) |
| **Hollow-whispered** | Dread >= 60 for 3 days, or Hollow-Touched; any skill at 4+ | none: they seize a bench and take what they want from the stockpiles | a **grey artifact**: value x3, gives Dread +1 within 4 tiles; no skill gain | if interrupted (drafted, confined), the colonist goes **Grey-raging** (an extreme break: attacks the nearest colonist) |

- **Pace:** the colony-wide chance is scaled by `max(0, 1 + floor(pop / 5) - artifacts)`. So a hold of 20 expects about 4-5 artifacts over its life, plus memorials, rather than a steady stream.
- **Artifacts are legends** (3.5): each has a name, its maker, materials, date and subject, and its later deeds ("the axe Ironmourn felled the Bone Colossus").
- Nobles may request to own an artifact (3.4). Thieves target artifacts first.

### 3.4 Offices and nobles (F17)

Data lives in `js/data/offices.js` and logic in `js/game/colony/offices.js` (owner K). UI: Colony > Hold > Offices.

| Office | Opens at | Who chooses | Does (the verb it adds) | Wants (requests) |
|---|---|---|---|---|
| **Steward** | 4 colonists | player appoints | **Stock targets**: "keep 40 meals, 200 blocks". The Steward turns targets into bills, clamped to the benches that can make them. Without a Steward, only bills | an office: a room with a desk and chair, Plain+ |
| **Reckoner** | 6 | player | exact counts in the Stock tab. Without one, counts above 20 show as "about 40"; with one, they are exact and the stock chip shows trends | a desk in any room |
| **Marshal** | first squad | player | squad training schedules, uniforms and alert levels (3.8). Without one, squads work but cannot train on a schedule | an armoury rack and a barracks |
| **Chief Healer** | 8 | player | triage order (the worst first; soldiers first); infirmary supply targets | an infirmary of Decent+ |
| **Keeper of Records** | 10 | player | Annals detail (figure pages, artifact histories); copies of the Chronicle; a yearly summary letter | a study or library of Plain+ |
| **Warden of Law** (Z4) | 12, only with justice on (3.9) | player | judges crimes | a Lockup room |
| **Thane** | 15 colonists | **the colonists**: the colonist with the highest summed opinion of all others, re-chosen each year at the Year's Turning. Not a player pick | mandates and requests (below); a Thane in good mood gives "Well led" +2 to all | a Fine office; a Fine bedroom; a dining seat at a Fine table |
| **Lord or Lady of the Hold** | Hold tier and 20 colonists | **arrives**: a noble of the Hearthwatch with 2 retainers (colonists). They take precedence over the Thane, who keeps the title | larger mandates; a **yearly tribute** from the Hearthwatch when satisfied (silver, a rare item, or a colonist) | a Grand bedroom; a Grand dining hall; a Majestic office (throne hall); a tomb prepared (3.6) |

**Requests:**
- Each office holder has a list of room needs, shown in their peek card and in the Hold tab with a met or unmet mark.
- Unmet after 10 days: the holder gets -4, growing by 2 a season. Nobles' unmet needs also give the colony "Poorly kept nobles" (-1 to all at Order >= 1) and lower Hearthwatch goodwill.

**Mandates** (Thane and Lord only):
- **Make:** "3 silver goblets within 10 days". The kind is drawn from the noble's preferences; the material from what the hold has seen.
- **Keep:** "No steel leaves the hold this season": it bars that item from trade.
- At most one open mandate per noble. A met mandate gives the noble +6 and the hold +2 renown in the matching domain.
- A broken mandate gives the noble -8, plus a crime (3.9) if justice is on. Without justice, it gives "Mandate ignored" (-2 to Order-valuing colonists).

**Regalia:** the Goldsmith add-on's chains of office (R2 8.2) now go to office holders. They give +3 to the holder, and the Steward, Marshal and Keeper effects of R2 8.2 come into force.

### 3.5 Legends and the Annals (history log)

Logic lives in `js/game/colony/legends.js` and the text grammar in `js/data/text/legends.js` (owner K). UI: Colony > **Annals**. The word "Legends" is avoided as a title.

**Pre-history of the vale:**
- 40-120 events over about 300 years before founding, generated at founding from the seed by a small grammar:
  - the Old Crown, its named kings and smiths;
  - the founding and fall of each **vault** on the map (so vault lore tablets name real figures);
  - the ruins (who built the watchtower, who died in the crypt);
  - the world factions' foundings;
  - the **great beasts' earlier deeds** ("Year 812: the Gloomwyrm burned the river town of Hallow Ford");
  - the sealing of the Hollow King under the vale.
- It is a **pure function of the seed and `genVersion`. It is not saved.** That costs 0 KB.

**The colony's history:**
- Chronicle entries (R2) plus **legend records** for named things:
  - **figures**: colonists, nemeses, nobles, great beasts, visitors with names;
  - **artifacts** and named items;
  - **places**: named rooms (a room that reaches Grand gets a name from the text tables, "the Hall of Ashen Light"), tombs, the levels' first openings;
  - **events**: raids, sieges, collapses, floods, deaths, offices, prestige buildings, births, petitioners who stayed.
- Each record is `[kind, id, nameId/args, firstTick, links...]`: a compact array in `s.legend` (cap 1,500 records), with links to Chronicle entries.
- **The Chronicle cap rises** from 600 to 2,000 compact entries. Older entries fold into year summary lines (R2 rule), but **legend records are never folded**. Save budget: about 8-15 KB of JSON at year 5, deflating to about 3-5 KB.

**The Annals screen:**
- tabs: **Years** (a timeline by year and season), **Figures**, **Artifacts**, **Places**;
- each entry is a short page with 44 pt links to related entries and a "Show on map" button (it sets the level);
- the vale's pre-history is the first chapter of Years.

**Engravings and books:** engravings (R2 3.4) and Chronicle copies draw their subjects from the legend records, so the walls of a hold show its own history.

**Export:** the Annals export as plain text from the colony card. For a Ruin, this is the keepsake.

### 3.6 Burial, memorials and the dead

This extends R2 4.8.
- **Graves on any level:** a burial zone with a grave, coffin (Woodcraft), sarcophagus (Masonry) or crypt slot (glazed urn add-on). **Tomb rooms** (role Tomb: 1+ sarcophagus, no beds) have tiers, and a noble's tomb must be Fine+.
- **Memorial slab** (Masonry, engraved with names): for those whose bodies are lost (fallen down a shaft into ember, carried off, collapsed under rubble). One slab names up to 6 colonists.
- **"Unrested dead":** friends and kin get -4, recurring daily, when a dead colonist is neither buried nor named on a memorial within 5 days. It scales with Reverence. Burial or a memorial clears it and gives "Laid to rest" (+2) or "Remembered in stone" (+2).
- **Unchanged:** unburied corpses in the dark rise as Husks after 2 days (R2).
- **A funeral (new, small):** burial in a Tomb room of Decent+ calls friends to gather for 1 game hour (joy kind "mourning", +3).
- Every burial site is a place record in the Annals.

### 3.7 Workshop chains deepened (F12)

- **Add-ons.** Each of the 36 R2 8.2 specialisations is audited against one test: **does it add a verb** (a recipe chain, a job kind, a room role, a mechanism)? Those that do (expected about 15 of 36) become one of the two forms below; those that only changed a number are **dropped**, and any recipes they held move to the base bench or the master set. The audit is the first deliverable of Z2.4 and lands as a table in `js/data/addons.js` (owner G; logic in `js/game/work/addons.js`, owner E):
  - **an add-on structure** built in a tile adjacent to its bench. While it is built, the bench gains the "Adds" verb and recipes. Examples: Quench trough means Temper; Cask cellar means the Cooper recipes and the Cellar role; Silk frame; Light mirror; Brick kiln vault; Drill post means Drill hour; Archery butts mean the Shooting match;
  - **a master recipe set**, unlocked while the hold has a Master of the bench's skill (for example the Weaponsmith's war pick and glaive).
- There is no exclusivity and no re-tooling, and a bench can have several add-ons. **Workshop tiers I-III stay** as upgrades (R2 8.2), but a tier no longer asks for a pick.

**New chains for depth:**

| Chain | Source level | Steps | Gives |
|---|---|---|---|
| Glass | sand (topsoil under water; the aquifer) | sand > Glassworks (fuel) > glass, lenses, lanterns | windows (light through walls, Z4), lenses, lanterns |
| Clay | clay (soil seams) | clay > Potter or Kiln > bricks, pottery, urns | brick walls and vaults, storage urns |
| Underground timber | greyshank (Cavern I) | fell > shankwood > every wood recipe (beauty -1) | wood without the surface |
| Fungus brewing | dimroot, glowcap | brewery > dimroot ale, glowcap spirit | drink for a hold that never sees the sun |
| Silk | tamed cave spiders + Silk frame add-on | spin > spidersilk > tailor | fine cloth |
| Shell and bone | shellbacks, beasts | butcher > shell and bone > crafts and armour (shell lamellar) | armour from the deep |
| Lye and soap | ash + tallow | Apothecary > lye > soap | infirmary cleanliness x1.5 |
| **Ember forge and smelter** | built adjacent to an ember pool on the ember layer | no fuel; +1 quality roll; the only place to make **embersteel** (steel + ember salts) | the reason to build down there |
| Lumensteel | lumenite (Underdeep) | Alloyer add-on (R2) | Hollowbane gear |
| Ember-proof gear | shellback shell + ember salts | Armourer add-on | ignores Sweltering and ember splash |

**Vertical logistics:**
- **Winch and shaft** (Z2): see 2.3.
- **Stockpiles span levels.** A zone is per voxel, so one zone may hold voxels on several levels.
- **Stockpiles near work.** Hauling ranks destinations by region-graph distance in 3D, so a store on the workshop level beats one 2 levels up.
- **The R2 "stone counts as stored near a headframe or quarry" rule** works per level: a headframe at a shaft top counts stone piles on every level of its shaft as stored.

### 3.8 Military: squads, equipment and training

This extends R2 9.5 and `draft.js`/`orders.js` (owners F and H).
- **Squads:** 4, or 6 with a War Room. Each has a **uniform**: per slot (weapon, helm, body, legs, shield), a kind and a minimum material and quality, with "any" allowed. Soldiers fetch uniform pieces from armoury racks on muster. A missing piece raises an alert on the Marshal ("Squad 2 lacks 3 helms") and adds a Steward stock target.
- **Training** (the Marshal is needed for a schedule): a squad schedule per season, for example "Train 2 days in 10".
  - Training happens at a training yard or barracks with a Drill post add-on.
  - It gives melee and archery XP under the normal daily cap.
  - A squad drilled 3 times a season gets **"Drilled"**: it holds formation and does not flee below 50% hp.
- **Orders** (all work on any level; the order marker sits on its voxel and shows a level badge):
  - **Move**, **Attack**, **Hold**, **Guard** (R2);
  - **Station** (tap a voxel: the squad stays there off-duty until relieved);
  - **Patrol** (2-4 voxels, which may be on different levels, walked in a loop);
  - **Defend refuge** (stand at the Refuge zone's doors).
- **Alert levels** (Colony > Military, set by the threat chip or the Marshal):
  - **Peace**;
  - **Muster**: soldiers drop work and equip;
  - **Shelter**: civilians go to **Refuge** zones (the R2 Shelter zone, renamed, on any level) and stay until Peace.
- **Ammunition:** archers refill quivers at armoury racks on muster. The Steward keeps a bolt and arrow target.
- **Fortifications** (Z3): fortification walls (archers shoot through, foes cannot pass) and **murder holes**: archers on z+1 shoot down through open air into a hall at z (2.10, Z3 rules).

### 3.9 Justice (optional; F18)

- **Deferred to Z4** (edition 4: it is off by default, so its effort goes to z-native play first). Until then the acts below happen as break behaviour, without cases.
- **The setting:** Settings > Hold > Laws, **off by default**. It can be changed once a season.
- **Crimes** when on:
  - **vandalism**: items smashed in a Tantrum;
  - **theft**: a Greedy colonist takes a named item into their bedroom;
  - **assault**: a colonist hurt another during a break;
  - **a broken mandate**.
  - Each one creates a case with the offender, the victim and witnesses (colonists within sight).
- **The Warden of Law sentences**, deterministic by severity and record:
  - **confinement** in a Lockup (a room with a cell bed and a locked door) for 1-5 days;
  - or a **labour fine**: the offender's work types are set to Haul and Clean for 2-6 days.
  - Repeat offenders (3 cases in a year) may be **exiled**: a letter the player confirms, a situational decision.
  - There are no beatings and no executions.
- **Reactions:** Order-valuing colonists get "Justice is done" (+2) or "Lawless hold" (-3, when a case waits more than 3 days). The victim's opinion of the offender recovers +10 after the sentence.
- **Without the setting**, the same acts happen (they are break behaviour), only without cases.

### 3.10 Renown (F11)

Data lives in `js/data/renown.js` and logic in `js/game/colony/renown.js` (owner K).
- **Six domains:**
  - **Smithing**: forge output value, masterworks and artifacts;
  - **Growing**: crops harvested, herds, food value;
  - **Lore and light**: research, lights built, lumenite;
  - **Trade**: trade value, caravans;
  - **Arms**: raids repelled, foes slain, great beasts;
  - **Delving**: levels opened, caverns opened, gems.
- **Scoring:** each domain accumulates points from measured activity each season, with a decay of 25% a season.
- **Known for:** a domain whose points exceed both its threshold and 1.5x the median of the others makes the hold **"Known for X"**. That can be at most two domains, with hysteresis of one season.
- **What renown does** (and only this; **it never gates a structure, recipe, mechanic or prestige building**):
  - **who visits:** a guild envoy of the domain (a smith guild envoy bringing commissions, a seed merchant, a scholar, a deep-trader of the Lamplost for Delving), and which **petitioners** ask to stay (3.13);
  - **the lean of causes** (2.10): Trade raises Rumour weights x1.5, Arms makes grievances answer sooner, Delving makes cavern causes weigh x1.25;
  - **flavour:** the hold's epithet in letters ("the Forge under the Mountain"), visitors' lines, engravings' subjects.
- **The former charter mechanics are verbs every hold has** (`js/game/colony/verbs/*.js`): commissions (they arrive with envoys, so a smithing hold sees more of them), herds and herd drives, the light network and Vigils, outbound caravans, garrisons and sallies.

### 3.11 Prestige buildings, two mechanisms and long arcs (F13, F14)

**Prestige buildings** (`js/data/structures/prestige.js`, renamed from `monuments.js`; owner G). They are optional, multi-stage, unique projects with rare inputs. Each gives **room value** (it counts as a room of its role with a high beauty), a **name** from the text tables, an **Annals page** with its builders and dates, and the thoughts any Grand room gives. **None has a percentage effect.**

| Building | Needs (world facts only) | Stages | What it is |
|---|---|---|---|
| World Forge | an ember pool on the hold's level (the forge sits on it) | 3; stage 3 needs embersteel or 3 Heartstones | a Grand forge room; its bench is an ember forge (3.7) |
| Sunspire | a shaft to the sky at least 6 levels deep | 3 | a lit hall at the shaft's foot: a Grand temple or dining role |
| Moonwell | a spring or the aquifer | 3 | a Grand garden room with a well |
| Gilded Exchange | a trade depot | 3 | a Grand hall where caravans unload; traders' lines change |
| Ember Bastion | a gate on the surface entry | 3 | a Grand gatehouse; its walls are ordinary walls of their material |

**The two mechanisms** (they stay, because each is a device with a story, not a buff):

| Mechanism | Needs | Stages | What it does |
|---|---|---|---|
| **Deep Gate** | a cavern's deep passage found (2.10) | 3; built in the passage | a gate across the passage: closed, nothing enters from beyond it; it can be lever-linked (2.8). Creatures may still batter it (hp of its material) |
| **Ember Seal** | the Seal found | 3; at the Seal | while the Hearth burns, breaches from the seeps need twice the cause weight, and the Hollow King cannot wake from time alone (3.12) |

- The ancestry monuments (R2 7.10: Cathedral, Heart Tree, Runehall, War Drum) are audited the same way: their percentage effects are removed; each keeps its room role and Annals page.
- **Long arcs** (what a player works toward, with no end):
  1. **The descent:** each band opened is a discovery, a level name, new materials and new danger.
  2. **Prosperity ranks:** Camp to Crownhold (R2 8.4, Crownhold without the Lord gate); from Z2.9 they gate arrivals, not structures (F27).
  3. **Offices and nobles:** Steward to Lord, and their requests.
  4. **Renown** and the visitors it draws.
  5. **Prestige buildings** and the two mechanisms.
  6. **Great beasts and nemeses:** they come, flee wounded, return and are slain.
  7. **The Annals:** a hold's history worth reading.
  8. **People:** Masters and Grandmasters, artifacts, life goals, ageing, births and children growing up (3.13).

**The Hearth.** Levels 1-4 stay (Brightflame is built in Z2). There is no level 5. The R2 8.4 Hearth fuel rules are unchanged.

### 3.12 Great beasts (generated, plus three legends; F13)

Logic lives in `js/game/threat/beasts/*.js` (owner H; Z3), generation in `js/game/threat/beasts/gen.js` with tables in `js/data/beasts.js` (owner G), art in `js/engine/art/beasts.js` (salvaged Lord art plus a part-based painter, owner D). Each beast is an incident of category `beast` with a **cause** (2.10), warned as a major (Omen 24-48 h, Sighted, Imminent). The player can never summon one.

**Generated deep beasts** (the many):
- **At founding** (`gen3:beasts`, dormant rows of 2.2), mapgen creates **4-6 beasts**, each with a lair voxel in a cavern or the deep stone and a generated body:

| Part | Table (examples; data rows, about 8-12 each) | What it does in the sim |
|---|---|---|
| Body plan | serpent, many-legged, winged, great toad, blob, giant, crab, eel | move set (swims, climbs, flies in caverns, burrows); size 2x2 or 3x3 |
| Material | stone, ash, glass, bone, ember, fungus, salt, tar | hp and armour by material (the item material table); ember: sets fires and lights; glass: shatters on blunt hits; fungus: leaves spore filth |
| Attack (1-2) | bite, crush, sting (sickness), breath of fire, spit web, dread cry, darkness | each is an existing sim effect: wounds, fire (2.9), webbed (cannot move 10 s), Dread, a **darkness aura** that drops light by 2 within 4 voxels (snuffs torches) |
| Behaviour | burrower (mines 1 voxel per 2 s toward ore stockpiles), hoarder (carries off metal), ambusher (waits in dark rooms), wanderer, territorial (stays within 20 of its lair until hurt) | its AI goal |
| Name | syllable tables plus an epithet from body and material ("Ozhrak the Glass Eel") | Annals, letters |

- **Each has a pre-history entry** (3.5): "Year 790: Ozhrak the Glass Eel drowned the Crown's lake-diggers in the Sunless Mere".
- **Its cause** is Opened cavern (its cavern) or Near lair. It never leaves its cavern before the hold opens that cavern.
- **No scripted phases.** It fights with the wound model colonists use: body zones from its plan, and armour from its material, so "where to hit it" is a fact of its body (a glass beast's legs shatter; a stone serpent's eyes are soft), shown by a successful **Study** of its remains or a Lore 8 colonist who saw it.
- **Wounded beasts flee to their lair** when hp < 30% and a path exists (a morale rule, like raids). Wounds heal slowly (5% hp a season) and leave named scars. A beast that flees **may return** when its cause holds again: this is how a nemesis beast happens, not a timer.

**The three legends** (unique, hand-made bodies, same rules):

| Legend | Lair and cause | Body and attacks (sim facts) |
|---|---|---|
| **Gloomwyrm** | a cliff eyrie in the heights; cause Rumour of wealth (it is a hoarder) at a high weight | winged; breath of fire (sets fires, ignites stockpiles); darkness aura; flies, so it comes down open shafts and cannot enter `cover >= 1` |
| **Bone Colossus** | a lair in the deep stone below Cavern II; cause Near lair, or Cavern II opened | giant of bone: walks through built walls (smashes them at 4x a sapper), crush attack; bone shatters under blunt hits on its legs |
| **Hollow King** | the Sleep; cause: the Seal-stone mined, a fortress voxel within 12 tiles planar and 1 level of the Sleep, or (unless the Ember Seal is complete) year >= 6 with the Hollow's hunger high | **steps through darkness**: it can move between dark voxels within 6 tiles of each other, so lit halls stop it; darkness aura; summons **Knights** (its only escort, 4-8, from its budget) |

- **Dropped from edition 3:** the weak-spot script, the teleport script, the retreat at exactly 25% with hp carried, and the 40% escort budget for anything but the King.
- **Kept:** the Hearthkeeper difficulty (beasts only from Stronghold rank, and they down rather than kill); one great beast on the map at a time.
- **Rewards** are what the body leaves: its material as items (glass beast: beast-glass; ember beast: ember salts), a **trophy** (an optional monument), a legend record, the thought `slew_beast`, Arms renown and Annals pages.

### 3.13 Births, children, and the halls that draw visitors (moved from Z4 to Z2)

**Births and children** (setting, **on by default**; R2 4.9 and 4.6 rules otherwise; logic `js/game/people/family.js`, owner F):
- spouses who share a Fine+ bedroom may have a child (chance per season, lower above 40 colonists and when food stock is under 10 days);
- a **cradle** and a **nursery** room role; a mother is on light work for 10 days;
- **children** (age 0-11, one game year per year of age) do not work; they play, follow a parent, learn a skill slowly by watching (x0.25 XP of what the parent does), and have needs and thoughts; a child's death is the hold's worst thought (Kin x2);
- at 12 they become **teens** (half work speed, no soldiering) and at 16 adults, with facets partly inherited (each facet the parent's ±1);
- the population caps of R2 (soft 30, hard 40) count children at one half.

**Taverns, temples and libraries** (room roles in `js/data/rooms.js`; visitors logic `js/game/colony/visitors.js`, owner K):

| Hall | Room role needs | Draws |
|---|---|---|
| **Tavern** | a bar (counter), tables, drink stock, Plain+ | travellers, bards, mercenaries; colonists drink and chat there (joy "revelry") |
| **Temple** | an altar to one of the vale's powers (from the pre-history), Plain+ | pilgrims, priests; "prayed" joy (Reverence) |
| **Library** | shelves holding 5+ books or tablets, a desk, Plain+ | scholars, who read and write books (a book is an item that names a legend record) |

- **Visitors** come by the surface edge or, once Cavern II is open, by its passage (the Lamplost). They stay 2-10 days, use the hall, pay in silver or goods, and leave a Chronicle line.
- **Petitioners:** a visitor who has stayed 5+ days and whose skills match the hold's renown asks to **stay**. This is a letter with yes or no, a situational decision like a wanderer (1.2). Accepted, they become a colonist with their history (an Annals figure from before the hold).
- **The bot target** (Z2): by day 150, a tavern and one other hall on 4 of 5 seeds, and at least 2 petitioners accepted.

---

## 4. Phone UX for z-levels (F22)

All rules of R2 10 hold: touch only, targets >= 44 pt, text >= 14 px, the Safari viewport budget and one thumb. The layouts below are measured against R2 10.1 (390 x 664 portrait: world height 512 pt; 844 x 335 landscape: 291 pt).

### 4.1 Level controls

Layout figures come from `js/ui/layout.js`: portrait world 512 pt high (444 pt with the 120 pt peek card, which hides the 52 pt colonist rail), landscape world 291 pt with the 56 pt side rail on the right.

**The level capsule** (one rounded vertical capsule, so it never reads as an alert, which are circles):
- `[ ▲ ]` (44 x 44): up one level. Its badge shows the colonists above (a count) and a red dot if a hostile is active above.
- `[ -3 ]` level chip (44 x 52): the relative level in 17 px bold tabular figures, with a 14 px band glyph under it.
- `[ ▼ ]` (44 x 44): down one level, with the same badge for below. It is the lowest control, where the thumb rests, because going down is the common move.
- Total 148 pt with 4 pt gaps.

**Portrait: bottom right, in the thumb zone.**
- The capsule sits at the right edge, its bottom 8 pt above the world's bottom edge (the bottom bar's top).
- The alert stack sits **above** it, after a **12 pt gap**: 3 alerts visible plus "+N" (8 + 148 + 12 + 140 + 4 + 44 = 356 pt of 512).
- **With the peek card open** the world is 444 pt; the capsule and the stack slide up with the card's top edge (a 180 ms ease), and the stack shows 2 plus "+N" (8 + 148 + 12 + 92 + 4 + 44 = 308 pt of 444).
- The minimap toggle moves to the top right corner, under the colonist rail.

**Landscape: bottom left**, for the left thumb, `left: max(env(safe-area-inset-left), 8px)`, bottom 8 pt above `env(safe-area-inset-bottom)`. The alert stack stays left of the right rail with 2 visible. The side rail uses `env(safe-area-inset-right)`. Both insets are read in **both rotations** (the notch can be on either side), and `ui-phone` runs landscape-left and landscape-right.

**The level is always on screen** (not only in a toast):
- a **band plate** beside the chip (left of it in portrait, right of it in landscape): the band's short name in 14 px ("Granite", "Glowcaps", "Mere", "Ember"), on a translucent plate, at most 120 pt wide. Every band has a short name of at most 10 characters in `js/data/levels.js`, so it fits at 130% text (18 px, about 95 pt);
- a **void tint per band**: the colour behind uniform unknown-rock chunks, the dimmed level below open air, and the placeholder fill. Soil is umber, outer and middle stone slate blue, caverns teal, deep stone violet-grey, the ember layer dark red, the Hollow ash grey. A glance tells the band; the tints keep 3:1 contrast with the chevrons and lips;
- the 1.2 s toast on a change stays as extra feedback: "Level -4 · Granite".

**Navigation stays inside the explored range:**
- ▼ stops at **the deepest level with a known voxel, plus 1**. Pressing it there shows the bubble "Unexplored below: dig or sound to see more" (2 s).
- ▲ stops at **the highest level holding a known non-`AIR` voxel** (the mountain top, a watch post, a flyer's perch).
- The depth ruler folds every unexplored run of levels into one row ("Unexplored · 9 levels").

**Interactions:**

| Action | Effect |
|---|---|
| Tap ▲ / ▼ | change the view level by 1 |
| Hold ▲ / ▼ (450 ms) | jump to the next **interesting** level in that direction: colonists, designations or jobs, an alert, the surface, the deepest dig |
| **Vertical drag on the chip** | **relative scrub with acceleration**: 1 level per 20 pt of travel when slow, 1 level per 8 pt above 300 pt/s, so 20 levels fit in 160 pt and the 291 pt landscape world is enough. **Detents** at interesting levels: the scrub holds there for 12 pt of travel, and plays a soft tick if sound is on. A label bubble follows ("-7 Glowcap Hollows · 3 colonists · 12 jobs"). While scrubbing the view shows the level's placeholder (6.3); chunks bake only after the level has stayed for **150 ms** |
| **Tap the chip** | opens the **depth ruler** |
| Long-press the chip | "Go to surface" and "Go to deepest dig" |

- **No haptics.** iOS Safari has no `navigator.vibrate`; detents are visual (the bubble snaps) and optionally audible.
- **The capsule locks during world gestures.** While a pan, a pinch or a tool drag owns a pointer, the capsule ignores new pointers, and a tool drag whose finger crosses the capsule keeps drawing. A thumb at the right edge can never change level mid-drag.

**The depth ruler:**
- a 132 pt wide panel from the right edge (portrait) or left edge (landscape), at full world height, over the canvas;
- **one row per explored level** (44 pt; unexplored runs folded), opening centred on the view level and scrolling with momentum; each row reads "-7 · Glowcaps" and carries a colonist count, a red dot for hostiles, an amber dot for alerts and **a count of pending designations and jobs** ("12");
- a vertical drag on the ruler scrubs with the same detents; tapping a row jumps and closes it;
- a header row shows "Surface 0" and "Deepest -9";
- **"Nearest stairs"** (a 44 pt button at the bottom) centres the camera on the nearest stair voxel of the view level.
- **Z4, optional:** a **section view** toggle in the ruler shows a vertical slice through the column under the camera (one 8 pt row per level, tiles 2 pt wide), so the shape of the fortress can be read. It is a display; tapping a row jumps to that level.

No world gesture is used for z, so the R2 10.2 gestures (pinch, one- and two-finger pan, tap, long-press) are unchanged.

### 4.2 What is shown of other levels

- **The level below,** through open air (`AIR`, `RAMP_TOP`, cliff edges): baked into the chunk, dimmed (a 55% dark overlay) with a 2 px cliff lip on the edge. Entities on the level below are not drawn. Their presence shows on the ▼ badge.
- **Stairs and ramps** carry chevrons: ▲ up, ▼ down, both for UD. Tapping a stair voxel adds "Go up" and "Go down" to its peek card, and the view follows.
- **Ceilings** are not drawn. A faint diagonal hatch on floors marks voxels with **no ceiling** (open to the sky or to a shaft above) on underground levels, so shafts are readable.
- **Unknown rock** on deep levels draws as a pattern fill in the band's void tint (4.1) without a chunk canvas (6.3), so empty levels cost no memory and still say which band they are.
- **Designations on other levels** are not shown, except the "levels" preview while a tool is active (4.4).

### 4.3 The colonist rail, alerts and follow

- **The rail:**
  - each portrait shows a **level badge** (14 px, for example "-5") when the colonist is not on the view level;
  - **tapping a portrait** selects the colonist, sets the view level to theirs and centres;
  - the peek card shows "Mining granite · Level -5";
  - long-press keeps the R2 menu, with "Follow" added.
- **Follow** keeps the camera on the colonist, **including level changes**. When they take a stair, the view switches level as they arrive.
- **Alerts** carry their subject's `z`:
  - the icon shows a level badge when it is not the view level;
  - tapping the alert jumps to the subject and sets the level;
  - the alert explanation (long-press) names the level: "Bryn is bleeding · Level -7".
- **The threat chip** names the entry level of underground threats ("Breach -13 · 6h"). Its route preview draws on each level it crosses, with **stair chevrons** marking "goes down here" and "comes up here". Tapping a chevron switches to the next level of the route.
- **Letters** that name a place have a "Show" button that sets the level.

### 4.4 Tools and designations across levels

Every tool works on the **view level** (`cam.z`, UI memory, never sim state).
- **Orders gains:** **Stairs**, **Ramp** and **Channel**, next to Mine and Carve hall (R2 10.3).
- **A "Levels" chip** in the tool bar of Mine, Carve hall, Channel and Stairs:
  - **Mine, Carve hall:** a stepper of 1 | 2 | 3 | 5 levels with a **Down | Up** toggle (Up mines the heights and a migrated mountain, 5.4). A rectangle designates the same footprint on each level; Carve hall plans its pillars per level and aligns them across levels.
  - **Stairs:** **a tap makes a 1 x 1 stair** with no drag; a drag makes a rectangle up to 3 x 3. The depth chips are **Down 1 | 2 | 3 | 5 | 10** and **Up 1 | 2 | 3** (at least 64 x 44 pt), and the tool **remembers the last depth** (UI memory), so a second stair is tap, Done.
    - The tool designates `STAIR_D` at the top, `STAIR_UD` between, and `STAIR_U` at the bottom.
    - Where a level holds an open voxel, the stair carves into the floor.
    - It stops at an impassable voxel: fluid, greystone or the map edge, with a red end mark.
    - **"Down to the next cavern"** is a chip once that cavern's level is known (`known` bits).
  - **Channel:** a rectangle on the view level. With Levels = N it channels N levels downward, top first. There is no Up: a channel removes a floor, and the worker stands beside it on that level, so a channel above the view level is just a channel designated from that level (0.1, point 19).
- **Preview:**
  - the loupe shows "3 x 3 · 4 levels · 36 voxels";
  - support stripes (2.5) show on the view level, and with a faint stripe for the level above;
  - the **ghost column**, a small vertical bar beside the capsule, shows every level that holds designations of the open tool as amber ticks. It stays **as long as the tool is open** (and 3 s after Done). **Tapping a tick jumps to that level.**
- **Cancel** works per level, plus "Cancel all levels" in the tool bar when the Levels chip is above 1.
- **Build** places on the view level. Ghosts that need a floor refuse `AIR` with a reason ("Needs a floor: build one first, or pick a lower level"). **Built floor** and **Built stairs** (Structure tab) work over air.
- **Zones** paint on the view level. One zone can hold voxels on several levels: the Zones tool offers "Add to zone: Main store" when a zone of the same type exists elsewhere.
- **Pick** (`tools/pick.js`) filters by `z === cam.z`. A tap within 22 pt of a colonist on another level does not select it.

**Tap budgets** (flows in `tools/ui-phone.mjs`, counted from the world view with nothing open; the gate fails a flow that needs more):

| Flow | Budget | Path |
|---|---|---|
| Stairs down 3, then view the bottom | 6 | Orders, Stairs, tap a voxel, Down 3, Done, tap the -3 tick in the ghost column |
| A second stair at the same depth | 3 | Stairs (tool still open or reopened from Recent), tap, Done |
| Jump to an endangered colonist on another level | 1 | tap the alert |
| Go down one level and back | 2 | ▼, ▲ |
| Find the deepest dig | 2 | long-press the chip, Go to deepest dig |
| Mine a 5 x 5 room on this level and the one below | 6 | Orders, Mine, drag, Levels, 2, Done |

### 4.5 Minimap per level

- The minimap shows the **view level** (its own W x H tile-colour canvas, 64 KB, built lazily and patched per dirty voxel).
- To its right is a **z-strip**: 20 rows of 4 pt each. This is a display, not a target. The view level is highlighted, colonist presence is drawn as warm ticks and hostiles as red ticks. Tapping the strip opens the depth ruler.
- Tapping the map pans on the view level.
- Edge markers (R2 9.4) show on the surface minimap. A breach marker shows on its own level's minimap and on the z-strip.

### 4.6 Other screens

- **Colonist sheet:**
  - Bio adds the facets, values, preferences and memories (3.2);
  - Skills shows the perks with their deeds: earned perks plus "next: Seam Follower, mined 112 of 150 ore";
  - a "Location" line shows the level.
- **Colony > Hold:** tier, renown (six bars with "Known for"), Offices with their requests, prestige buildings and mechanisms with their stages, halls and their visitors, the Hearth, factions and nemeses.
- **Colony > Military** (new tab): squads, uniforms, schedules, the alert level and orders.
- **Colony > Annals** (renamed from Chronicle): Years, Figures, Artifacts, Places (3.5).
- **Stock:** exact or approximate counts depending on the Reckoner (3.4). Each kind has "Find", which jumps to the level of the largest stack.
- **Title and Colonies:** no classic link. Colony cards show "Deepest: -9" and the Fallen state (1.3).
- **New colony flow:**
  - "Start > Band > Storyteller and difficulty (Hearthkeeper, Warden, Steadfast, Hard) > Map seed > Name";
  - the map size step is gone (128 x 128 x 20 is fixed in Z1);
  - "Carving the world" shows while mapgen runs (2.2).
- **The coach** (R2 10.9) gains three steps after the first room: "Dig a stair down 2 levels (Orders > Stairs, Down 2)"; "Switch levels with ▼, or drag the level chip"; "Build a store near the stairs". The pacing target stays: the first room and the first warning within about 15 minutes.
- **Returning Stage 2 players** see one card after migration: "Your hold now has depth. The old mountain is real rock above you, and there is a world below. Tap ▼ to look." It links to the coach's three new steps.

---

## 5. Save format 3 and the migration from Stage 2 (F6, F7, F28)

Replaces R2 11.3. R2 11.1, 11.2, 11.4 and 11.5 still hold, with the amendments in 5.5.

**Two migrations, in two releases** (edition 4):
- **Stage 2.9** (state v2 to v3, codec `EC2` unchanged): the de-roguelite fields only (5.3).
- **The fortress switch** (state v3 to v4, codec `EC2` to `EC3`): the world becomes 3D (5.4).

### 5.1 Blob layout

```
EC3 blob  = MAGIC 'EC3\0' | u16 formatVersion (3) | u16 stateVersion (4) | u16 w | u16 h | u16 d | u16 zS
            | u16 genVersion | u8 worldKind (3 native, 2 migrated) | u8 flags (bit 0: PRISTINE embedded) | u32 tick
            | u32 pristineId | u32[13] pristineCrc (one per layer) | u32 crc32(payload)
            | u8 compression (1 deflate-raw, 2 RLE) | payload                                  (85-byte header)
payload   = compress( [PRISTINE] | LAYERS | ENTITIES | RUNTIME )
PRISTINE  = only when flags bit 0: u32 length + the pristine record (below), already deflated
LAYERS    = for each layer in fixed order: u8 layerId, u8 encoding, u32 byteLength, bytes
            order: terrain, mat, ore, floor, roof, plant, growth, blight, zone, desig, fluid, fog(bits), known(bits)
            encoding 3 (chunk XOR): u8[ceil(CW*CH*D/8)] changed-chunk bitmap (160 B at D=20), then for each set bit,
            in index order, the chunk's bytes XOR the pristine chunk (16 x 16 bytes; bitsets: 32 bytes)
            encodings 0 (raw) and 1 (bitset) stay for tests and for D=1 debug maps
ENTITIES  = u32 length + UTF-8 JSON (positional rows, R2 11.3), now with z and u32 tiles, plus s.legend
RUNTIME   = u32 length + think queue, path queue, per-mover paths (u32 cursor + u32 voxel list, 0xffffffff = failed),
            unreachable memories (u32 keys), lightQ (2.6), fluidActive + cursor (Z3). No flow fields (F5), no zone fields.
Text form = "EC3:" + base64(blob)

pristine record (IndexedDB store `pristine`, key `<colonyId>`) =
            'ECP\0' | u32 pristineId | u16 w,h,d,zS | u16 genVersion | u8 worldKind | u32[13] crc
            | deflate( the 7 non-zero layers: terrain, mat, ore, plant, growth, blight, fluid | meta JSON )
meta JSON = dormant content rows (2.2 step 8), world amendments applied (5.6), migrated: baseMask (5.4)
```

**The pristine world is stored, not regenerated** (F6, F28):
- It is built **once**: by `mapgen3` at founding, or by the migration (5.4). It is written to the `pristine` store, read back and CRC-checked before the colony's first `EC3` save is written.
- **Size:** about 60-70 KB deflated at D=20 (PROTO 4: plain deflate of a whole dug D=20 world is 68 KB; the pristine world is the same order, and Z1 step E5 measures it). Inflate about 5 ms on an A15 (PROTO: 4.5 ms desktop for E2), against 100-240 ms for mapgen.
- **Where copies live:** the `pristine` store; **embedded in every dawn backup and every export** (flags bit 0), so a file or a dawn slot is always self-sufficient. The rotating slots `a` and `b` reference it by `pristineId` and the per-layer CRCs, which keeps the 60-second autosave small.
- **Fallback:** if the pristine record is missing or fails its CRC, the loader tries, in order: the dawn blob's embedded copy; then, for a **native** world only, regeneration with the current `mapgen3`, accepted only if all 13 CRCs match. If none works, the colony is refused with "This hold's world record is missing. Import a backup file to restore it", and nothing is overwritten.
- **Consequences:** mapgen may change between releases without freezing old generators, and there is no `mapgen2` and no `mapgen3_vN`. `genVersion` stays in the header as information (and selects the generator only for the regeneration fallback). New world content reaches existing colonies only through world amendments (5.6).
- **`rt.pristine` is class "save-base"** in C13: the sim never reads it, and `check-imports` lints it. It holds the 7 layers, about 2.3 MB at D=20.
- **The changed-chunk bitmap** is computed at save time by comparing each layer with its pristine copy through `Uint32Array` views. That is about 1.3 MB of compares at D=20: under 1 ms desktop, about 2 ms on an A15 (est.). A sticky touched-set is not used, because a missed write would corrupt a save and a compare cannot.
- **Size** (PROTO 4): the map payload is about 24-28 KB at D=20, against 68 KB for plain deflate.
  - A colony save (slots `a`, `b`) is about 45-85 KB in mid-game, and under 130 KB at day 300 (the soak gate).
  - The dawn backup and an export add the pristine copy: about 110-150 KB, about 150-200 KB as text. That stays inside R2's 70-270 KB.
  - The RLE quick-save (no pristine) is about 67-79 KB, about 90-105 KB as base64, inside the R2 70-270 KB.
- **Snapshot cost** (target < 10 ms main thread on an A15):
  - layer bitmap and XOR: about 2 ms;
  - entities `JSON.stringify`: 3-5 ms (R2);
  - deflate runs async via `CompressionStream`, as R2. The pristine copy for the dawn blob is already deflated and is appended as bytes.

### 5.2 Load

1. Read the header. Refuse `formatVersion > 3`.
2. `setMapSize(w, h, d, zS)`.
3. Get the pristine world (5.1: the store, the embedded copy or the fallback) and check its CRCs against the header.
4. Apply the XOR chunks.
5. Parse the entities and runtime.
6. `initRuntime(s)` rebuilds every derived cache (C13 as extended in 7.3), and rebuilds exactly the saved key sets of F25.

Load target: under 150 ms on an A15 for a D=20 fortress (inflate about 5 ms, XOR about 2 ms, JSON 5-10 ms, `initRuntime` about 40-60 ms est.: the full relabel is 9-15 ms at 4x throttle, plus light, rooms and support per level). The 400 ms of edition 3 applies only to the regeneration fallback.

### 5.3 Old formats and the Stage 2.9 migration (state v2 to v3)

`codec.js` keeps `decodeV2` (the `EC2` reader, frozen) for import and load.

**Stage 2.9 migration** (`migrations[1]` in `js/game/core/state.js`, owner A; ships in Stage 2.9 with `EC2` unchanged):
1. `iron: true` becomes `difficulty: 'hard'`; `DIFFICULTIES` loses `ironhold`; the `meta` card loses `iron`. An Ironhold colony that had only slot `a` gets `b` and `dawn` on its next save.
2. Pending perk choices are **resolved** to the nearer deed (1.2).
3. `col.done` is created at zero (no back-fill from the log: the 20 log lines are too few to count from, and a counter that starts at zero only delays a perk).
4. `lordsDone`, `charters` and any test-only `spec` fields are dropped.
5. `colony.fallen = false`.
- `s.legend` is **not** part of this step: it is an added field, filled when Z2.3 first loads a colony without one (one figure per colonist, living or dead; one artifact per named item; one event per Chronicle major).
- Fixture: `v2-s2-iron.ecsave` (an Ironhold colony with a pending perk choice), captured from `078cb71` before any change. Test: load, migrate, continue 2 days, save, reload, continue to an identical hash; the colonist with the pending choice holds exactly one of the two perks.

**At the fortress switch**, every `EC2` blob goes through `decodeV2` > state migrations to v3 > **migration v3 to v4** (5.4) > a normal v4 state. The colony is re-saved as `EC3` at once, into the older slot. The newer slot keeps the `EC2` blob until the first successful `EC3` save is verified, so a failed migration loses nothing.

### 5.4 Migration v3 to v4: the world becomes 3D (feasible; here is the exact procedure)

This lives in `js/game/core/migrate4.js` (owner A, reviewed by B and E), registered in `state.js` `migrations[2]`. It is a pure function of the save and the seed.

1. **World shape.** Set `d = 20`, `zS = 14` and `worldKind = 2`. Allocate the 13 layers of N.
2. **`baseMask`, computed once from the save** (W x H u8; stored in the pristine meta and never recomputed):
   - bits 0-2: `h`, the old mountain's height in levels (below);
   - bit 3: water (the save's terrain at the tile is river, lake, marsh or ford);
   - bit 4: massif (the tile is rock, or a mined tile with roof 2 or 3).
   - `h`: run the Stage 2 planar distance transform over the massif bit (`depth2`, with the map edge counting as rock, the R2 3.2 rule); for each massif column `h = clamp(ceil(depth2 / 6), 1, 5)`; every other column `h = 0`.
   - Using the save itself means every old tunnel keeps rock overhead.
3. **Plane zS** is the save's 12 layers, copied. `fluid` at zS is 0; surface water stays terrain water. Roof values 2 and 3 at zS are cleared (2.4); roof 1 (built) is kept.
4. **Levels zS+1..zS+5:** in each column, voxels `zS+1 .. zS+h` are `ROCK` of the column's stone at zS (the old rock tile's mat, or the mined floor's mat). Voxels above are `AIR`. **Ore veins** are seeded in these voxels on `mig4:veins` with the massif-depth table (R2 3.2 by `depth2`), so mining upward is worth doing (coal and copper near the face, iron and amber deeper in).
5. **Levels 0..zS-1** are generated by `mapgen3`'s below-surface part on `gen3:*` streams **from the seed and `baseMask` only**: water columns get the aquifer, massif columns stone from z 13 down, valley columns soil at z 13-12. Dormant content rows are generated as for a native world. Old in-plane caverns, the old seep and vaults stay at zS; the new Cavern III gets its own seeps, and the breach cause counts both.
6. **The pristine world** of a migrated colony is: plane zS **as it is in the save at migration** (the dug state, not Stage 2's untouched map), steps 4 and 5 above, and `baseMask`. It is written to the `pristine` store at once (5.1). So the old plane costs nothing in later saves until it changes again, and no Stage 2 generator is needed.
7. **Entities.** Every colonist, animal, foe, stack and building gets `z = zS`.
8. **Every saved voxel index** gets `+ zS*PLANE`. The list comes from the `tile` field type annotations added to `schema.js` FIELDS (7.2), and a test fails if any `json` field holds a number that looks like a tile but is unannotated (`fields-tile.test.mjs`). Known fields:
   - paths, `pathQ` goals, `unreach` keys;
   - job targets and toil tiles;
   - `colony.world.fire`, `caveQ`, plate cooldowns;
   - raid `edge.i`, `fell` and `loot` of a live raid;
   - letter data holding tiles;
   - aftermath records;
   - `colony.plans` (carve pillars);
   - zone free lists (rebuilt anyway).
9. **Saved flow fields are dropped.** Hierarchical flow rebuilds them from the state (F5). A live raid continues: its members are at zS with remapped plans, and it gets `morale = 100 - 3 x losses so far`.
10. **`initRuntime(s)`.** Then write the Chronicle line "Year 2, Thaw 3: the hold learned the depth of the world", and show the returning-player card (4.6).

**Checks on every migrated fixture** (`tools/tests/migrate4.test.mjs`):
- every old tunnel voxel at zS has `cover >= 1` (the massif bit holds rock at zS+1);
- **no entity stands on `AIR` or inside a solid voxel**, and every colonist's voxel is walkable;
- **no colonist's mood changes by more than 5 from the migration alone**: compare mood after `initRuntime` plus one game hour, migrated, against the same hour on the old build at `078cb71` (the fixture's sidecar JSON records it). Old thin-roof tunnels now have cover 1, so darkness and temperature change; if a fixture exceeds 5, the cause is fixed in the rules (for example the cover-1 temperature blend), not in the migration;
- every `tile` field points inside the map at z = zS;
- the pristine record round-trips with matching CRCs.

**What the migration does and does not promise:**
- A Stage 2 save **does not continue tick-identically across the upgrade**. The new engine has different rules: 3D A* with the link heuristic, the cover-based temperature, hierarchical flow.
- **Determinism holds from the migrated state on**: save, then reload, continues identically.
- Fixtures, **captured in Stage 2.9 step S9.0 from the deployed build `078cb71`** before any change: `v1-1b-midraid.ecsave` (exists), `v2-s2-day60.ecsave` (bot seed 3, day 60), `v2-s2-midraid.ecsave` (a reaver raid in melee), `v2-s2-iron.ecsave` (Ironhold with a pending perk choice). Each must pass "load, migrate to v4, continue 2 game days, save, reload, continue identically".

### 5.5 Amendments to R2 11

- **11.2:**
  - the `meta` card loses `iron` and gains `d`, `deepest` (the lowest z of any dug voxel), `fallen` and `fallenAt`;
  - a new object store `pristine` (key: colony id), in the same database `ec2`, bumped to version 2 (an `onupgradeneeded` that only adds the store);
  - the classic keys row goes (1.1).
- **11.4:** the autosave snapshot includes the bitmap and XOR step (5.1). The dawn write embeds the pristine copy.
- **11.5:** Ironhold text is gone (backups always exist). A Fallen card offers Annals, View the ruin, Export and Delete. **Settings > Storage > Recover from a device problem** lists each colony's stored copies (slots `a`, `b`, `dawn`) with their game dates (1.3). Import accepts `EC2` and `EC3`. Deleting a colony deletes its pristine record.
- **11.6:** `setMapSize(w, h, d, zS)`.

### 5.6 World amendments (new content for existing worlds)

- When a later release adds world content that the first `mapgen3` did not place as dormant rows (2.2 step 8), it ships an **amendment**: `js/game/world/amend/<n>.js`, a pure function of (seed, pristine, live state) that may write only into chunks with **no known bit and no change against the pristine** (never seen, never touched).
- It writes the same voxels into the pristine record and the live layers, so the XOR save stays small; it appends `n` to the pristine meta's `amendments` list. It runs once, at load, before `initRuntime`, and is deterministic.
- A native world created after the release gets the content from mapgen directly and marks the amendment as applied.
- The gate test `amend-idempotent` loads each fixture, applies every amendment twice and checks the second pass changes nothing.

---

## 6. Performance budget (from the prototype)

Replaces R2 12.3-12.5 where they differ. iPhone figures are desktop x 2.5 (PROTO), so **the on-device bench of Stage 2.9 (step S9.1, `/spike/z.html`) replaces every "est." with a measured value before Z1 starts**, and the thresholds below are then retuned by J. The full device play check stays at the Z1 gate.

### 6.1 Memory at D=20 (dense)

| Family | MB | Notes |
|---|---|---|
| `s.L`: 11 u8 layers (with `fluid`) + 2 bitsets of N | 3.7 | |
| `rt` hot: `walkCost`, `region`, `regionH` (u32) | 2.8 | |
| `rt` cold: `occ`, `itemAt`, `room`, `light`, `lit`, `heat`, `support`, `cover`/`skyZ` (columns) | 4.7 | |
| A* scratch: 4 x 32-bit over N with generation stamps; heap grown on demand, capped at the search cap | 5.0 | today's `8N` Float64 heap would be 21 MB at D=20, so it must go (E3) |
| Hierarchical flow: region costs + local field cache (<= 512 fields x 256 voxels x u16) | 0.3 | |
| `rt.pristine` (7 layers) | 2.3 | save-base |
| **Sim state total** | **about 19 MB** (no zone fields) | cap **24 MB**, checked by the bench (`stats().bytes`) |

### 6.2 Sim (per tick at 20 Hz; budgets for an A15 at 3x, where one tick is one frame)

| System | Rule | Budget, A15 (desktop bench gate) |
|---|---|---|
| A* (colonists, animals, foes off-field) | link-heuristic 3D A*; budget **8,000 expansions per tick** (unchanged; A* expansions only, which are cache-independent); per-search cap 8,192; **at most 6 distinct goals start new searches per tick, counted by requests, not cache misses** (F25), the rest wait in the saved FIFO | p95 about 1.2 ms (gate: p95 < 0.6 ms, max expansions < 4,000 on the 3D maze scene, 0 over the cap) |
| Link Dijkstra | per goal, cached (pure). The cache key is `(goal, linkStamp)`; **`linkStamp` bumps only when the link set or a link cost changes** (a link is added or removed, or a link's passability class changes), not on every relabel. Link representatives are fixed (the lowest voxel index of the crossing), so reshaping a region does not change costs | 0.16 ms desktop p95 (gate < 0.3 ms). **Bench `miners6`:** 6 miners digging non-stop on the 3D maze for 2 game hours: Dijkstra time per tick p95 < 0.3 ms desktop, and fewer than 1 stamp bump per 8 mined voxels |
| Regions | incremental per dirty cluster (relabel plus its links, including vertical links to z±1); all-solid clusters skipped; **no full relabel at runtime** (only `initRuntime`). **Labels are canonical**: a region's label is derived from its cluster and its lowest voxel index, so the incremental graph equals a full rebuild **by value**, and anything that iterates regions sees the same order after a load | about 5 µs per cluster (gate: 64 dirty clusters in < 0.5 ms desktop); full rebuild at load < 4.5 ms desktop |
| Hierarchical flow | region-level Dijkstra when the hostile graph or goal changes; local fields lazily, **uncapped**: every field a foe needs this tick is built this tick (F25). The worst case is one per live (goal, region) pair occupied by a foe: 60 foes in 60 regions = 1.5 ms desktop, a one-tick spike; typical raids occupy 5-15 regions | region level 0.1-0.5 ms; one local field 15-25 µs desktop, 75 µs at 4x (gate: region level < 0.6 ms, local p95 < 40 µs) |
| Sapper dig field | per level (PLANE-sized) on the target's level | 0.3 ms (as today) |
| Rooms, light, temperature | **only dirty levels** (a write dirties z only, or z±1 when it changes vertical connectivity: 2.6); the day-phase relight runs **one sky-exposed level per tick** from the saved `lightQ` | 0.2-0.3 ms per level (gate: a 3-level dirty set < 1 ms desktop) |
| Haul destination ranking | **region-graph distance only** (`regionDist`, 3D, from the cached link Dijkstra): pure. Zone distance fields are dropped (F25); they cost 2.5 ms each and needed a cap | inside the A* row |
| Plants | sorted list of clusters holding plants | < 0.1 ms |
| Fluids lite (Z3) | water every 4 ticks, ember every 16; <= 2,048 cells per step | <= 0.25 ms per step (gate < 0.1 ms desktop) |
| Everything else (needs, mood, items, storyteller, fire) | unchanged | R2 12.3 |
| **Sim per frame at 3x** | | **<= 4 ms** (unchanged; gate: tick p95 < 1.0 ms desktop at the Z1 stress scene, < 1.2 ms at Z3) |

**`endOfTick` order** (C4 v3): regions (dirty clusters), rooms (dirty levels), temperature (dirty levels), light (dirty levels, then one `lightQ` level), hierarchical flow invalidation (no building here), fluids (Z3, own cadence). Each runs only if its dirty flag is set.

### 6.3 Render (Chromium-calibrated; real art kit about 2.5x the prototype painter)

- **Unchanged from R2 12.4:** one view level, the three bands, at most **1 full bake per frame** while the view moves, and patch redraws.
- **New:**
  - **Chunk key** `(z, band, cx, cy)` in one shared LRU per band.
  - **The below-level bake** (open air paints the level below, dimmed) measured at 0 ms extra (PROTO 3). A write at (x, y, z) patches the held chunks at z and z+1.
  - **Per-level placeholder:** a tile-colour canvas of W x H (64 KB), built on first view in 0.35-1.6 ms. At most 6 are held (LRU); they also feed the minimap.
  - **Idle pre-bake of z±1:** visible chunks only, 1 per still frame. It stops when done or after 3 s of stillness. **Never with Battery saver on**, and never while paused and still at 10 fps. A one-level switch is then complete in **1 frame**; without pre-bake it takes 6-10 frames and is never blank.
  - **Uniform chunks:** a chunk that is all unknown rock, or all air over unknown rock, draws as a pattern fill and holds no canvas. Most of a deep level costs nothing.
  - **Light texture** for the view level only: a full rebuild on a level change, about 1 ms per plane.
  - **Entities** are filtered by `z === view.z` before the y-sort. That is free at 70 entities.
  - **Scrubbing** (4.1): while the level changes faster than one per 150 ms, only placeholders draw (at most one placeholder build per frame); chunk bakes start after a 150 ms dwell, so a fast scrub through 10 levels costs no bakes.
- **Frame targets:** p95 <= 8 ms render on an A15. A level switch costs at most one placeholder build plus one bake (about 7 ms on an A15 est.), inside the 16.7 ms frame.
- **Battery:** the R2 12.4 throttle is unchanged (60 fps while moving or in combat, 30 still, <= 10 paused). A level change counts as motion for 0.5 s.

### 6.4 Memory: canvases

- **LRU cap per band** = 2.5 x the visible chunk count **of the current viewport** (recomputed on resize), with absolute caps of near 48, mid 36 and far 64.
- **Held-canvas ceiling 72 MB** across bands (R2: 63). When pre-bake would exceed it, pre-bake stops at z-1 only, then stops.
- **Sprite cache** 40 MB (R2: 48).
- **Total about 140 MB** with sim state (R2: 130). If the S9.1 device bench finds the iOS canvas ceiling under 160 MB (or the iPhone 11 lower), pre-bake is limited to z-1 and the near cap drops to 36.

### 6.5 Saves and load

- Snapshot < 10 ms main thread; blob under 85 KB mid-game and under 130 KB at day 300.
- Quick-save RLE < 110 KB as base64.
- Load < 150 ms on an A15 from the stored pristine; < 400 ms on the regeneration fallback. Mapgen alone 100-240 ms (est.), at founding and migration only.

---

## 7. Architecture changes and contracts (amends R2 13)

### 7.1 C1 v3: `js/game/core/grid.js` (owner A, reviewer B)

```js
export let W, H, D, PLANE, N, CW, CH, CLUSTERS, zS;      // live bindings; nothing allocates at import
export function setMapSize(w, h, d, zs) {}
export const idx = (x, y, z) => (z * H + y) * W + x;
export const tx = i => i % W, ty = i => ((i % PLANE) / W) | 0, tz = i => (i / PLANE) | 0;
export const up = i => i + PLANE, down = i => i - PLANE;
export const inB = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < W && y < H && z < D;
export const clusterOf = i => (tz(i) * CH + (ty(i) >> 4)) * CW + (tx(i) >> 4);   // 16 x 16 x 1
export const relLevel = z => z - zS;                    // UI only
export const TER = { /* 0-15 unchanged */ AIR: 16, STAIR_U: 17, STAIR_D: 18, STAIR_UD: 19, RAMP: 20, RAMP_TOP: 21 };
export const ROOF = { OPEN: 0, BUILT: 1 };              // THIN and MOUNTAIN retired (2.4)
// TER_PASSABLE, TER_WALK10, TER_OPAQUE, TER_ROOFABLE gain rows; new TER_UP, TER_DOWN, TER_FLOOR (has a floor)
export const MAP_MAX = 256; export const D_MAX = 32;   // assert N < KEY.SPAN (1e6): holds to D = 61 at 128
```

- `LAYERS` gains `fluid`. `allocLayers` allocates 11 u8 layers plus 2 bitsets of N.
- **Rule:** 2D code that runs on one level takes a `base = z*PLANE` offset. Planar neighbours stay `i ± 1` and `i ± W`, plus a bounds check on x and y.

### 7.2 C2 v3: schema (owner A)

- **`STATE_VERSION 4`** (3 is Stage 2.9's de-roguelite state, 5.3). The root gains `d`, `zS`, `genVersion`, `worldKind` and `pristineId`.
- Already added by state v3 (Stage 2.9): `col.done`, `colony.fallen`, `fallenAt`, and the losses below.
- **Positions.** `x, y` stay in world units for movers and in tiles for stacks and buildings; `z` is added everywhere as an integer level.
- **Paths:** `path: { tiles: Uint32Array, i }`.
- **New field type `tile`** in FIELDS for every voxel index. Every such field is listed, and the codec and the migration use the list.
- **Colonist** gains:
  - `done: Uint16Array(32)` (3.1);
  - `fac: Int8Array(6)` and `val: Int8Array(4)` (3.2);
  - `pref: [[kind, id] x 6]`;
  - `mem: [[thoughtId, year, season, value]]`;
  - `office: id | null`.
- **Colonist loses** the pending perk choices.
- **Colony** gains:
  - `renown: Int32Array(6)`, `known: []`;
  - `offices: { id: colId }`, `mandates: []`;
  - `laws: bool`, `cases: []` (Z4; added fields need no migration);
  - `prestige: {}` (stages of prestige buildings and the two mechanisms);
  - `raid.morale` on live raids; `visitors: []`;
  - `fallen`, `fallenAt`;
  - `deepest`.
- **Colony loses** (already in state v3, Stage 2.9): `iron`, `lordsDone`, `charters`.
- **New root key `legend`** (3.5).
- **`st.queue` entries** may carry a `z` for the entry level, and an `entry` kind: `edge`, `passage`, `seep`, `sky` or `sleep`.

### 7.3 C13 v3: runtime contract additions (`rtcontract.js`, owner A, reviewers B, E, H)

**The rule (F25):** every `rt` key is one of: *incremental* or *end-of-tick* (a pure function of the saved state, rebuilt whole by `initRuntime`); *derived, pure* (a cache whose hit equals a rebuild, **with no cap on misses**: nothing may depend on whether it was warm); or *saved* (its key set and order travel in RUNTIME). A per-tick cap on cache builds or a fallback "when not built" is not allowed.

| `rt` data | Class | Rule |
|---|---|---|
| `region`, `regionH` (u32), `regionGraph` with vertical links | end-of-tick | dirty clusters relabelled with their links; **canonical labels** (6.2) |
| `linkStamp` | end-of-tick | bumps only when the link set or a link cost changes (6.2); recomputed at `initRuntime` as a hash of the link set, so it is a value, not a counter |
| `cover`, `skyZ` (per column) | incremental | updated in the terrain API call that writes the column |
| `support` (u8 of N) | incremental | per-level patch in the terrain API |
| `linkCache` (link Dijkstra per goal) | derived, pure | keyed by `(goal, linkStamp)` |
| `hflow.region` (region-level costs per goal) | end-of-tick | rebuilt when the hostile graph stamp or the goal set changed |
| `hflow.local` (per-region local fields) | derived, pure | keyed by (goal, region, stamp); built on demand, **uncapped**; an LRU of 512 may evict, which costs only time |
| `causes` (2.10) | end-of-tick, daily | recomputed from state once per game day and at `initRuntime` |
| `lightQ` (2.6) | **saved** | RUNTIME |
| `fluidActive` + cursor (Z3) | **saved** | RUNTIME |
| per-level dirty flags (`dirtyLevels` for rooms, light, temperature) | per tick | set by the terrain API, cleared in `endOfTick` |
| `pristine` | save-base | never read by `js/game/` sim modules except `save/*`, `world/mapgen*` and `world/amend/*` (lint) |
| removed: `depth`, flow fields `f` (u16 x N) and their saved form, zone distance fields and `zoneFieldQ` | | |

**Contract test `cache-drop`** (`tools/tests/cache-drop.test.mjs`, in the gate from engine step E1): run bot seeds 1-3 for 2 game days; at 20 random ticks per seed (seeded), clone the state, **drop every derived and end-of-tick key** and call `initRuntime`, then continue both copies for 2,000 ticks and compare `stateHash` every 100 ticks. Any difference fails, naming the first `rt` key whose rebuild differs. Scenes: plain play, mid-raid on two levels, 6 miners digging, mid-day-phase change (so `lightQ` is non-empty).

### 7.4 C3 v3: commands (owner A, reviewer I)

- **Every** `rect` gains `z` (`int(0, D-1)`). `place`, `paste`, `tile` and `order` points gain `z`. `linePath` holds u32 voxel indexes, all on one level.
- **New and changed commands:**
  - `designate { kind: 'mine'|'stairs'|'ramp'|'channel'|..., rect, levels: int(1, 10), dir: 'down'|'up', add }`
  - `carve { rect, pattern, smooth, levels }`
  - `squad { id, uniform?, sched? }`
  - `order { kind: 'move'|'attack'|'hold'|'guard'|'station'|'patrol'|'defendRefuge', squad, pts: [voxel] }`
  - `alert { level: 'peace'|'muster'|'shelter' }`
  - `office { id, colId | null }`
  - `stockTarget { k, m?, n }`
  - `laws { on }` (Z4)
  - `prestige { def, x, y, z, stage }` (reuses `place` validation)
  - `petition { visitorId, accept }` (the letter answer)
  - `link { leverId, targetId, on }` (lever links across levels, Z3)
- **Removed:** `perk`, `challenge`, `charter`, `spec`.
- **Validators** check `0 <= z < D` and that `levels` stay inside the map.

### 7.5 C5 v3: terrain API (owner B, reviewers C, E, H)

- **Writes:**
  - `mineVoxel(s, i)`
  - `digStair(s, i, kind)`
  - `digRamp(s, i)`
  - `channel(s, i)`
  - `buildFloor(s, i, mat)` (over air)
  - `setFluid(s, i, v)`
  - `collapse(s, i)` (internal)
- **Every write:**
  - updates `cover` and `skyZ` for the column;
  - patches `support` on levels z and z+1;
  - sets dirty clusters, and dirty levels: z only, or z-1..z+1 when the write changes vertical connectivity (2.6);
  - queues render patches at z and z+1 (`markDirty(i)`);
  - handles falling entities and items.
- **Reads:**
  - `regionDist(a, b)` (3D, with `|dz| x vert`);
  - `regionOf(i, side)`;
  - `lightAt(i)`, `tempAt(i)`, `coverAt(i)`;
  - `levelBand(z)`;
  - `walkable(i)`;
  - `linksOf(i)` (the vertical neighbours).

### 7.6 Module map changes (amends R2 13.1)

| File | Change |
|---|---|
| `js/game/world/mapgen3.js` | NEW: the 3D generator (2.2) |
| `js/game/world/mapgen.js` | kept for D=1 worlds until the fortress switch, then deleted (no frozen copies: the pristine is stored, F28) |
| `js/game/world/amend/` | NEW, empty until the first world amendment (5.6) |
| `js/game/save/pristine.js` | NEW: the pristine store, its CRCs, embedding and the fallback order (5.1) |
| `tools/check-mapgen.mjs`, `tools/capture-fixture.mjs`, `tools/tests/cache-drop.test.mjs` | NEW (J): the mapgen Math lint, fixture capture from an old commit, the F25 contract test |
| `js/game/world/genworker.js` | NEW, optional: runs `mapgen3` off the main thread at founding and migration |
| `js/game/world/vertical.js` | NEW: stairs, ramps, channels, falling, cover and skyZ |
| `js/game/world/fluids.js` | NEW in Z3: fluids lite |
| `js/game/systems/pathing.js` | ADAPT: 3D A*, the link heuristic, a growable heap |
| `js/game/world/regions.js` | ADAPT: u32 labels, vertical links, incremental only |
| `js/game/threat/flow.js` | REPLACE: hierarchical flow (`hflow`) |
| `js/game/core/migrate4.js` | NEW (the v3 to v4 world migration; the Stage 2.9 v2 to v3 step lives in `state.js`) |
| `js/game/people/seizures.js` | from `embertouch.js` |
| `js/game/people/personality.js` | NEW |
| `js/game/colony/renown.js` + `renown/*.js` | from `charters.js` + `charters/*.js` |
| `js/game/colony/offices.js`, `legends.js`, `prestige.js`, `fall.js`, `visitors.js`, `verbs/*.js` | NEW (`justice.js` in Z4) |
| `js/game/threat/causes.js`, `js/game/threat/beasts/gen.js`, `js/game/people/family.js` | NEW |
| `js/game/work/addons.js` | NEW |
| `js/game/threat/beasts/*.js` | from `lords/*.js` |
| `js/ui/levels.js` | NEW: level column, depth ruler, z-strip |
| `js/ui/annals.js` | from `chronicleui` (the Annals) |
| `js/ui/military.js`, `officesui.js`, `ruin.js` | NEW: the military tab, the offices list, the final screen and ruin viewer |
| `js/data/levels.js` | NEW: band names, glyphs, colours, temperatures |
| `js/data/personality.js`, `offices.js`, `renown.js`, `addons.js`, `seizures.js`, `deeds-col.js`, `text/legends.js`, `structures/prestige.js`, `causes.js`, `beasts.js` | NEW or renamed |
| `js/engine/art/vertical.js` | NEW: stairs, ramps, lips, dim |
| `js/engine/art/beasts.js` | salvaged |
| `js/engine/art/caverns.js` | NEW: cavern flora and fauna |

The workstreams and file ownership of R2 14.2 are unchanged. New files go to the owner of their folder, and `js/ui/levels.js` belongs to I.

---

## 8. Build plan

### 8.1 Ground rules (amends R2 14.1)

- **Steps are agent tasks.** Each step names one owning workstream (R2 14.2: A core and save, B world and movement, C render, D art, E work, F people, G content data, H threats, I UI, J tools and gate, K colony systems). A step lists:
  - **Owns:** the only files it writes. Any other change is a request to that file's owner, landed first as its own small step;
  - **Depends:** the steps that must be merged first;
  - **Builds:** the deliverable;
  - **Test:** the command that must pass (plus the gate);
  - **Oracle:** what defines "correct" for this step (a previous build's hashes, a brute-force reference, a measured number, a table in this doc);
  - **Size:** S (one sitting), M (a few), L (many). There are no engineer-weeks: agents run in parallel wherever **Depends** allows.
- **Trunk, never a big-bang branch.** Every step merges to `main` only through `node tools/gate.mjs --stage=<stage>` green (new stage ids `2.9`, `z1`, `z2`, `z3`). Stage 2.9 ships to players when its gate passes.
- **Z1 merges dark.** `FORTRESS` in `js/game/core/flags.js` (owner A; a module constant, not sim state) stays `false` until step E13: new colonies stay D=1 with today's mapgen and saves stay `EC2`. The D>1 code runs in tests, in the bench and behind the debug URL `?fortress=1` (which only picks the `createColony` path; the save records `d`). So every step keeps the deployed game working, and the switch itself is one small step.
- **Single writers** (edition 4): `js/game/core/commands.js` and `js/game/core/schema.js` (A), `js/data/balance.js` (G), `css/style.css` (I). A step that needs a command, a field, a constant or a style lists it as a request; the writer lands it within the same day as an S step.
- **`sw.js` is never hand-edited.** Its file list is already generated (`node tools/check-sw.mjs --write` between the FILES markers, from the module graph of `index.html`). A step that adds or removes a shipped file runs `--write`; the gate's `check-sw` fails on drift; a merge conflict inside the FILES block is resolved by rerunning `--write`, never by hand.
- **The WIP at HEAD `06d46a6`** (Stage 3.0 bot defence) is judged in S9.0: if `node tools/gate.mjs --stage=2` is green on it, Stage 2.9 builds on it; otherwise `main` stays at `078cb71` and the WIP is parked on `wip/stage-3.0` for salvage.
- **Contracts freeze** at the end of E1 (C1 v3, C2 v3-core, C3 v3, C5 v3 signatures, C13 v3). C10 v3 (EC3) freezes at the end of E8. The rest freeze at the Z1 fun review (E12).

### 8.2 Stage 2.9: the removals (ships on today's engine)

**Playable result:** the same single-level colony, with no roguelite left: no classic link, no picks (perks arrive by doing, with a toast and an Annals line), no Ironhold (Hard instead), no Pyre or Lords to summon, wonders as prestige buildings, and a fall that is final, with a Ruin to read. Existing Stage 2 saves migrate with one small state step.

| Step | Owns | Depends | Builds | Test | Oracle | Size |
|---|---|---|---|---|---|---|
| **S9.0 Baseline and fixtures** (J) | `tools/capture-fixture.mjs`, `tools/fixtures/v2-s2-*.ecsave` and their `.json` sidecars, `tools/tests/fixtures-v2.test.mjs` | - | the WIP decision (8.1); `git worktree add ../ec-078 078cb71`, then `node tools/capture-fixture.mjs --root=../ec-078 --seed=3 --day=60 --out=tools/fixtures/v2-s2-day60.ecsave`, likewise `v2-s2-midraid` (a reaver raid in melee) and `v2-s2-iron` (Ironhold with a pending perk choice). Each sidecar records the old build's `stateHash` after 1 game day of continuation and each colonist's mood after 1 game hour | `node --test tools/tests/fixtures-v2.test.mjs` | the sidecar hashes, produced by `078cb71` itself | S |
| **S9.1 On-device bench** (J, with C) | `spike/z.html`, `spike/z.mjs` (browser-safe copies of `proto/` benches), `tools/spike/run.mjs` (`--page=z`) | - | a page served at `/spike/z.html` on the live site (not precached): link A* p95 on the 3D maze, region relabel, local flow fields, a one-level switch at 390 x 664 and 844 x 335, mapgen time, inflate of a 3 MB world, and a canvas-memory ceiling probe; a **Copy report** button. Also `npx playwright install webkit` in the dev environment: if it installs, the gate gains WebKit runs (`--browser=webkit`) for determinism and Node/WebKit mapgen equality | `node tools/spike/run.mjs --page=z --browser=chromium` prints a report | PROTO's Chromium numbers (within ±30%). **Owner action:** run it on the iPhone 13 (and an iPhone 11 if available) in Safari and from the Home Screen, paste the report; J writes the measured values into 6.x and asks G for the thresholds in `balance.js`. If the A15 is > 1.5x worse than the estimates, this doc is revised **before E1** | S |
| **S9.2 Classic removal** (J) | 1.1 rows: `classic/`, `tools/classic/`, `tools/bench/legacy/`, `tools/legacy-baseline.json`, `tools/check-sw.mjs`, `tools/check-imports.mjs`, `tools/bench.mjs`, the 71 dead modules (after D moves the Lords' art into `js/engine/art/beasts.js` as S9.2a), `README.md`, `EMBERCROWN.md`, `EMBERCROWN-REWORK.md` | S9.0 | everything in 1.1, the one-release "Old roguelite saves" row (I: S9.6) | `node tools/check-sw.mjs && node tools/check-imports.mjs && node --test tools/tests/tooling.test.mjs` | `grep -rn "classic" js/ sw.js index.html` finds only the storage row | M |
| **S9.3 Perks by deeds** (F logic, G data) | F: `js/game/people/perks.js`, `js/game/people/coldeeds.js` (new; `js/game/colony/deeds.js` stays the colony's deeds: a BUS listener that calls `didDeed` on `kill`, `built`, `removed` and job-complete events); G: `js/data/perks.js` (`earn`), `js/data/deeds-col.js` | S9.0 | 3.1 complete; a system with no event for its deed asks its owner to emit one (requests listed in the PR) | `node --test tools/tests/perks-earn.test.mjs` (a colonist with Mining 10 and 150 ore mined gets Seam Follower with no letter; no perk before its level) | the 3.1 table; bot report: median Master holds 1-2 perks by day 120 | M |
| **S9.4 Hard, the fall and the Ruin** (A state and slots, I screens in S9.6) | `js/game/core/schema.js`, `js/game/core/setup.js`, `js/game/colony/fall.js` (new), `js/game/save/slots.js`, `js/main.js` | S9.0 | 1.3 and the Ironhold rows: Hard; the fall test; `tick()` a no-op when fallen; the **Recover from a device problem** panel in Settings > Storage (in `js/main.js`, where Storage lives today) | `node --test tools/tests/fall.test.mjs tools/tests/save-2.test.mjs` (with all colonists downed and no rescuer for 24 h, `fallen` is set and the hash stops changing) | 1.3 | M |
| **S9.5 Boss and win removal** (H logic, G data) | H: `js/game/threat/lords/` to `beasts/` (stubs), the Pyre code; G: `js/data/raiders.js`, `js/data/schema.js`, `js/data/tiers.js`, `js/data/thoughts.js`, `js/data/structures/monuments.js` to `prestige.js` (mods deleted), `js/data/structures/charter.js` rows moved, `js/data/charters.js` to `renown.js`, `js/data/specs.js` | S9.0 | every 1.4 row; the `charter`, `spec`, `perk` and `challenge` commands removed (A lands that in `commands.js` as S9.5a) | `node tools/validate-data.mjs && node --test tools/tests/colony.test.mjs tools/tests/commands.test.mjs` | `grep -rn "ironhold\|pendingChoices\|challenge\|lordsDone\|wonder" js/` finds nothing but migration code | M |
| **S9.6 UI removals** (I) | `js/ui/colonies.js`, `colonistui.js`, `alerts.js`, `letters.js`, `shell.js`, `js/ui/ruin.js` (new), `css/style.css`, `tools/ui-phone2.mjs` | S9.3, S9.4 | the Fallen card, the final screen and the read-only ruin viewer; "Recover from a device problem"; the Skills tab shows earned perks and "next: Seam Follower, mined 112 of 150 ore"; the old-saves row | `node tools/ui-phone.mjs` (all six R2 viewports): "Fallen card opens View the ruin and Export"; no picker remains | R2 10 budgets (44 pt, 14 px, 130% text) | M |
| **S9.7 State v3 and release** (A, then J) | `js/game/core/state.js` (`migrations[1]`), `schema.js` (`STATE_VERSION 3`), `tools/gate.mjs` (stage `2.9`) | S9.2-S9.6 | 5.3 | `node tools/gate.mjs --stage=2.9` | the four fixtures migrate and continue identically after save and reload; `colonybot --seeds=1-5 --days=100` within 10% of the S9.0 baseline report on survival, tier days and idle share | S |

**Stage 2.9 gate:** every R2 14.4 check green; the four fixtures; the greps above empty; `ui-phone` green. Then `main` deploys.

### 8.3 Stage Z1: the z-level core, in steps that keep the gate green

**Playable result (after E13):** a new colony on a 128 x 128 x 20 world digs stairs down through soil and stone into the two-level Glowcap Hollows, builds rooms and workshops on several floors, hauls between levels, and survives surface raids that come down the stairs and rout by morale underground. A Stage 2 colony migrates with its mountain made real rock above it.

The engine order follows the review: E1, E2, E3, render and UI (E6, E7), codec (E8), migration (E9), full mapgen (E10), hierarchical flow (E11). World systems (E4) and work (E5) fan out after E2 and E3.

**E1. Index and depth at D=1** (A, with B for `pathing.js` and `regions.js` index types) — Size L
- **Owns:** `js/game/core/grid.js`, `schema.js`, `commands.js`, `rtcontract.js`, `state.js`, `flags.js`; B: `pathing.js`, `regions.js`; J: `tools/determinism-lib.mjs` (hash), `tools/tests/cache-drop.test.mjs`.
- **Depends:** Stage 2.9 shipped.
- **Builds:** C1 v3 at D=1 (`setMapSize(w, h, 1, 0)`); **every tile index u32 / Int32** (paths, queues, keys, regions, the saved runtime, commands); `z` on every entity and command (always 0); the `tile` field type in FIELDS; C13 v3 classes; `FORTRESS = false`.
- **First, J changes `stateHash` to hash values** (typed arrays by element values, never by array type) and records the Stage 2.9 baseline hashes with the new hash **on the unchanged code**.
- **Test:** `node tools/determinism.mjs --seeds=1-5` and `node tools/gate.mjs --stage=2.9`; `node --test tools/tests/grid.test.mjs tools/tests/schema.test.mjs tools/tests/fields-tile.test.mjs tools/tests/cache-drop.test.mjs`.
- **Oracle:** bot seeds 1-5 give hashes **identical** to the Stage 2.9 baseline at every checkpoint. This step changes no behaviour, so it ships to players as it merges.

**E2. Vertical terrain and plain 3D A* on a flat test map** (B) — Size M
- **Owns:** `js/game/world/vertical.js` (new), `terrain.js`, `js/game/world/stubmap.js` (gains `flat3d`: 5 levels of open floor joined by stairs and ramps, and `tower3d`), `pathing.js`, `movement.js`, `spatial.js`.
- **Depends:** E1.
- **Builds:** ids 16-21 (2.3); stairs, ramps, channels and falling; `cover` and `skyZ` (2.4); plain 3D A* (octile + `|dz| x vert`); `followPath` across stairs; the spatial hash keyed by z.
- **Test:** `node --test tools/tests/vertical.test.mjs tools/tests/pathing3d.test.mjs`.
- **Oracle:** a brute-force 3D Dijkstra over the test maps: A* cost equals it exactly on every pair of 200 seeded pairs. A 3-level stair column links z..z-2 and nothing else; a channel over rock makes a ramp and an item on it falls.

**E3. Vertical regions and the link heuristic** (B) — Size L
- **Owns:** `regions.js`, `pathing.js`, `js/game/world/regiongraph.js` (new); J: `tools/bench.mjs` (the 3D maze scene from `proto/world.mjs` `digFortress` and `miners6`).
- **Depends:** E2.
- **Builds:** u32 **canonical** labels with vertical links, incremental only; `linkStamp`; `linkCache`; link-heuristic A*; the request-counted goal cap (6.2); `regionDist` in 3D. Port `proto/suite.mjs` into `tools/tests/pathing3d.test.mjs`.
- **Test:** `node --test tools/tests/pathing3d.test.mjs tools/tests/regions.test.mjs tools/tests/cache-drop.test.mjs && node tools/bench.mjs --scene=maze3d,miners6`.
- **Oracle:** E2's plain A* (same reachability on every pair; mean cost <= 1.08x; p95 <= 1.15x); the incremental graph equals a full rebuild **by value** after 1,000 random mine and stair writes; bench: link A* p95 < 0.6 ms desktop, max expansions < 4,000, 0 over the cap, `miners6` Dijkstra p95 < 0.3 ms per tick.

**E4. World systems across levels** (B) — Size L
- **Owns:** `pass.js`, `support.js`, `rooms.js`, `light.js`, `temperature.js`, `fog.js`, `claims.js`, `plants.js`, `fire.js`, `weather.js`, `blight.js`, `js/data/levels.js` (G writes the band rows on request).
- **Depends:** E2 (E3 for claims connectivity).
- **Builds:** support and collapse across levels (2.5); per-level light with the edition 4 dirty rule and the saved `lightQ` (2.6); temperature by z; fog per voxel and Sounding (2.7); the static `fluid` layer with seeps and pools (2.8); claims by column; the plant cluster list; fire rising (2.9).
- **Test:** `node --test tools/tests/world3d.test.mjs tools/tests/cache-drop.test.mjs`.
- **Oracle:** the 2.5-2.7 rules as unit cases: a 10 x 10 unsupported hall collapses into the level below and opens air above while a 9 x 9 does not; in soil a 6 x 6 collapses and a 5 x 5 does not; a shaft lights its bottom by day only; a cellar with `cover >= 3` sits at 12 C; Sounding reveals 3 levels below; an ordinary mine dirties 1 level, a channel 3; a phase change relights one level per tick and a save mid-sequence continues identically.

**E5. Work across levels** (E) — Size L
- **Owns:** `jobs.js`, `toils.js`, `think.js`, `windex.js`, `reserve.js`, `items.js`, `stockpiles.js`, `haul.js`, `construct.js`, `bills.js`, `givers/*`.
- **Depends:** E3.
- **Builds:** goal modes `ABOVE` and `ADJ_STAIR`; Stairs, Ramp and Channel jobs; stacks with z; 3D work-index buckets ranked by `regionDist`; stockpiles spanning levels; **zone distance fields removed** (haul ranking by region distance, F25); built floors and built stairs.
- **Test:** `node --test tools/tests/work3d.test.mjs tools/tests/work-jobs.test.mjs && node tools/colonybot.mjs --seeds=1-5 --days=30`.
- **Oracle:** unit: a 5-level stair stack is dug top-down by one miner standing on each stair in turn; a hauler carries stone up 3 levels to the nearest store by region distance. **At D=1 the zone-field removal changes behaviour, so E5 re-baselines the D=1 hashes once**, and the bot report must show median haul latency within 10% of the Stage 2.9 report.

**E6. Render one level** (C, with D for art) — Size L
- **Owns:** `js/engine/render/*`, `camera.js`, `minimap.js`; D: `js/engine/art/vertical.js`, soil, cavern and band-tint palettes.
- **Depends:** E2.
- **Builds:** 6.3: z in the chunk keys, the below bake, per-level placeholders, idle pre-bake of z±1, uniform chunks, the per-level light texture, the entity z filter, chevrons, lips, the ceiling hatch, **band void tints**, a per-level minimap with the z-strip; `setViewLevel(z)`; the 150 ms dwell before baking during a scrub.
- **Test:** `node tools/render-check.mjs --fortress`.
- **Oracle:** switch levels 6 times at 390 x 664 and 844 x 335: every one-step switch complete within 1 frame with pre-bake on, never blank with it off; held canvases <= 72 MB; mining at z patches z and z+1; still camera at 30 ± 2 draws/s; Battery saver stops pre-bake; the S9.1 device numbers for the bake cost.

**E7. UI for levels** (I) — Size L
- **Owns:** `js/ui/levels.js` (new), `toolbar.js`, `architect.js`, `peek.js`, `shell.js`, `alerts.js`, `coach.js`, `css/style.css`, `js/game/tools/*`, `controller.js`, `tools/ui-phone.mjs`.
- **Depends:** E6 (render API), E5 (designation kinds).
- **Builds:** 4.1-4.5: the capsule bottom right with the stack above it, sliding with the peek card; the band plate; the explored-range limits; relative scrub with detents; the capsule lock during gestures; the ruler with job counts and folded unexplored rows; rail badges, Follow across levels, alerts with level; the Stairs, Ramp and Channel tools, tap-to-stair, remembered depth, Mine and Carve hall Up; the persistent, tappable ghost column; pick by z; the "needs a floor" refusal; three coach steps.
- **Test:** `node tools/ui-phone.mjs --fortress` at the six R2 viewports **plus landscape-left and landscape-right** with both safe-area sides.
- **Oracle:** the 4.4 tap budgets; every control >= 44 x 44 pt with >= 12 pt between the capsule and the first alert; all text >= 14 px; no overflow at 130% text (band plate included); flows "drag the chip across 4 levels in landscape within the 291 pt world" and "a tool drag crossing the capsule does not change level".

**E8. EC3 codec and the pristine store** (A) — Size M
- **Owns:** `js/game/save/codec.js`, `colonysave.js`, `fields.js`, `rtsave.js`, `slots.js`, `pristine.js` (new), `js/main.js` (storage upgrade).
- **Depends:** E1 (runs on `stubmap` 3D worlds; E10 is not needed).
- **Builds:** 5.1, 5.2, 5.5: the chunk-XOR codec; the `pristine` store, CRCs, embedding in dawn and export, the fallback order; IndexedDB version 2; `decodeV2` kept.
- **Test:** `node --test tools/tests/codec.test.mjs tools/tests/pristine.test.mjs && node tools/persist.mjs`.
- **Oracle:** round-trip of a 20-level stub fortress is byte-identical; map payload < 30 KB for the prototype fortress; a deleted pristine record is recovered from the dawn blob; a native world regenerates with matching CRCs; a corrupted CRC is refused without overwriting anything; measured pristine size recorded in 5.1.

**E9. Migration v3 to v4** (A; B and E review) — Size M
- **Owns:** `js/game/core/migrate4.js` (new), `state.js` (`migrations[2]`), `tools/tests/migrate4.test.mjs`.
- **Depends:** E4, E8 (and the basic band fill in `mapgen3.js` from E10's first commit, which B lands as an S step: column fill of soil and stone bands only).
- **Builds:** 5.4.
- **Test:** `node --test tools/tests/migrate4.test.mjs`.
- **Oracle:** the four fixtures migrate, continue 2 days, save, reload and continue to an identical hash; the five checks of 5.4 (cover >= 1 over old tunnels, no entity on `AIR` or in rock, mood change <= 5 against the sidecar, tiles in range, pristine CRCs).

**E10. The full generator** (B; G for `js/data/worldgen.js` tables) — Size L
- **Owns:** `js/game/world/mapgen3.js`, `tools/check-mapgen.mjs` (J writes the lint first as E10a).
- **Depends:** E4.
- **Builds:** 2.2: every band, the two-level caverns with ledges, ramps and chasms, Cavern III, the aquifer and springs, 3D veins, vaults, seeps, the Seal and Sleep, the surface features, **all dormant content rows**, the guarantees.
- **Test:** `node tools/check-mapgen.mjs && node --test tools/tests/mapgen3.test.mjs`.
- **Oracle:** seeds 1-100 pass every 2.2 guarantee with <= 4 re-rolls each; two runs hash equal; **Node and WebKit equal** (or Node and Chromium if S9.1 could not install WebKit, noted in the report); mapgen < 95 ms in Node.

**E11. Hierarchical flow and threats on levels** (H) — Size L
- **Owns:** `js/game/threat/flow.js` (hflow), `raiders.js`, `raidplan.js`, `horde.js`, `fight.js`, `orders.js`, `warnings.js`, `defence/*`, `sappers.js`.
- **Depends:** E3 (E5 for loot goals).
- **Builds:** F5 with smash costs on region links; uncapped pure local fields; entries at the surface z of each edge column; combat on the same z; raid morale and routing; daylight harm only on sky-exposed voxels (2.10); a per-level sapper dig field (planar in Z1).
- **Test:** `node --test tools/tests/threat3d.test.mjs tools/tests/cache-drop.test.mjs && node tools/bench.mjs --scene=hflow`.
- **Oracle:** a horde reaches the Hearth on z-3 by the stairs; with the stairs blocked by a locked gate it smashes the gate; an underground raid that loses half its members routs; cache-drop mid-raid on two levels; region-level flow < 0.6 ms and local fields p95 < 40 µs desktop; worst-case uncapped tick (60 foes in distinct regions) < 2 ms desktop.

**E12. Bot v3, gate z1 and the fun review** (J; then all leads) — Size M
- **Owns:** `tools/colonybot.mjs`, `tools/lib/bot3.mjs`, `tools/gate.mjs` (stage `z1`), `tools/determinism*.mjs`.
- **Depends:** E5-E11.
- **Builds:** bot v3 runs with `?fortress=1` semantics: digs a 3 x 1 stair shaft to -6, a workshop level at -3, bedrooms at -2 and a store at the shaft foot, using the Levels chip in its commands; determinism over z; the device play check; then the fun review: a 30-minute play on an iPhone (found, dig down 6 levels, build on 3 floors, survive a raid), at most 5 changes before E13.
- **Test:** `node tools/gate.mjs --stage=z1`.
- **Oracle:** the Z1 gate below.

**E13. The switch** (A, then J) — Size S
- **Owns:** `js/game/core/flags.js`, `js/game/world/mapgen.js` (deleted), `js/ui/colonies.js` text (I).
- **Depends:** E12 green and the fun review's go.
- **Builds:** `FORTRESS = true`: new colonies are 128 x 128 x 20 from `mapgen3`; `EC2` saves migrate on load (5.3); the returning-player card.
- **Test:** `node tools/gate.mjs --stage=z1 --strict`.
- **Oracle:** the four fixtures migrate in the browser build (`node tools/persist.mjs --fixtures`); a fresh install founds a fortress. Then `main` deploys.

**Z1 gate** (before E13):
1. `colonybot --seeds=1-5 --days=30`: every colony alive; a stair shaft reaching -6 or deeper; roofed rooms on >= 3 levels; >= 1 workshop below -2; >= 2 raids warned and repelled, with at least one fought below the surface; zero starvation deaths; idle share < 30%; median haul latency < 2 game hours; save < 85 KB at day 30.
2. Every R2 14.4 check green with the 6.2 thresholds, `cache-drop` on all four scenes, the four migrated fixtures, the 4.4 tap budgets.
3. **Device** (iPhone 13; iPhone 11 if available): no frame below 50 fps at 3x during a raid on two levels; a one-level switch within 1 frame while still; load < 150 ms; battery within 10% of Stage 2.9 over 20 minutes; a swipe-kill mid-raid continues; total memory under the measured ceiling.

### 8.4 Stage Z2: Dwarf-Fortress-like depth systems

**Playable result:** colonists with personalities, preferences, life goals and memories; fevers of craft that make named artifacts; offices, an elected Thane and a Lord with mandates; the Annals with the vale's pre-history; burial and memorials; squads with uniforms and training; underground farming, fungus timber and brewing; **families with children**; taverns, temples and libraries whose visitors may ask to stay; threats that always have a reason; and buildings that need materials and skill, not a rank.

| Step | Agent | Owns | Depends | Builds | Test | Oracle (bot target on seeds 1-5 unless stated) | Size |
|---|---|---|---|---|---|---|---|
| Z2.1 People | F (G data) | `personality.js`, `seizures.js`, `perks.js`, `mood.js`, `social.js`; data `personality.js`, `seizures.js`, `thoughts.js` | E13 | 3.2 (with life goals), 3.3, teaching (3.1), Sweltering and Heatstroke (2.6) | `node --test tools/tests/people-z2.test.mjs` | a liked-granite colonist in a granite Fine room gets +4; a Brooding colonist met with a token makes a memorial; 2-4 artifacts by day 200 on 4 of 5; average mood > 45 at day 100 | L |
| Z2.2 Offices and nobles | K (G, I) | `offices.js`, data `offices.js`, `officesui.js` | E13 | 3.4 without the Warden | `node --test tools/tests/offices.test.mjs` | the Steward turns "keep 40 meals" into a kitchen bill; the Thane has the highest summed opinion; a Thane by day 120 and a Lord by day 250 on 3 of 5 | M |
| Z2.3 Annals and legends | K (I) | `legends.js`, `text/legends.js`, `annals.js` | E13 | 3.5, including pre-history entries for the dormant beasts and lairs | `node --test tools/tests/legends.test.mjs` | pre-history is a pure function of the seed (zero save bytes); 1,500 records under 15 KB raw; every vault and every lair has a pre-history entry; a day-200 Annals lists >= 30 figures | M |
| Z2.4 Renown, verbs, add-ons, chains | K, E, G, D | `renown.js`, `verbs/*.js`, `addons.js`, data `renown.js`, `addons.js`, `recipes.js`, `items.js`, `materials.js` | E13 | 3.10 (steering only); **the add-on audit table first**; the surviving add-ons; the glass, clay, shankwood, fungus brew, silk, shell and bone, and lye chains; the ember forge; ember-proof gear; the winch | `node tools/validate-data.mjs && node --test tools/tests/renown.test.mjs` | `validate-data`: no structure or recipe reads renown; every add-on row names its verb; Known for something by day 150 on 4 of 5; the winch used >= 50 times by day 100 | L |
| Z2.5 Military | F, H, I | `draft.js`, `orders.js`, `military.js` | E13 | 3.8 | `node --test tools/tests/military.test.mjs` | a squad on Muster equips from racks within 1 game hour; a patrol across 2 levels loops; soldiers reach 10 by day 120 on 3 of 5 | M |
| Z2.6 Burial and the dead | F, I | `death.js`, burial UI | E13 | 3.6 | `node --test tools/tests/burial.test.mjs` | a lost body named on a slab clears Unrested; no colonist "Unrested" for > 10 days at day 200 | S |
| Z2.7 Underground life (static) | B, K, D | `plants.js`, `animals/*.js`, data `plants.js`, `animals.js`, `art/caverns.js` | E13 | the cavern flora and fauna of 2.10 living in both levels of Caverns I and II (no deep threats yet); cave farming on loam; aquifer seeps and lining; Brightflame | `node --test tools/tests/caverns.test.mjs` | glowcap grows on cave loam with no light; a lined seep turns dry; a scripted seed feeds 6 colonists for a season from underground only | M |
| Z2.8 Families and halls | F (family), K (visitors), G, I | `family.js`, `visitors.js`, data `rooms.js`, `visitors.js`, letters | Z2.1 | 3.13 | `node --test tools/tests/family.test.mjs tools/tests/visitors.test.mjs` | a child is born to a Fine-bedroom couple; a teen works at half speed; a petitioner's yes adds a colonist with an Annals history; by day 150 a tavern and one other hall on 4 of 5, and >= 2 petitioners accepted; population stays under the hard cap at day 300 | L |
| Z2.9 Ranks, not unlocks | G (J balance) | `js/data/structures/*.js`, `js/data/tiers.js`, `js/data/recipes.js` | E13 | F27: every structure `tier` gate replaced by materials, research or skill, or by "needs an arrival" (a noble's rooms); tiers keep arrivals and the threat scale | `node tools/validate-data.mjs` | no structure row has a `tier` gate unless flagged `arrival`; the bot report: Hamlet and Village days within 15% of Stage 2.9 | M |
| Z2.10 Causes | H (G data) | `causes.js`, `storyteller.js`, `incidents.js`, data `causes.js` | Z2.3 | 2.10 "Every threat has a cause" for surface threats (grievance, rumour, the Hollow's hunger, hard winter); letters and Annals name it | `node --test tools/tests/causes.test.mjs` | no incident is scheduled without a live cause (a property test over 300 bot days); every letter has a cause line; the majors gap stays inside R2 9.3 | M |
| Z2.11 Bot v4 and balance | J | `colonybot`, `lib/bot4.mjs`, report | Z2.1-Z2.10 | policies for offices, squads, burial, add-ons, the winch, halls, petitions; the report adds renown, artifacts, noble satisfaction, births | `node tools/gate.mjs --stage=z2` | the Z2 gate | M |

**Z2 gate:** bot 200 days on seeds 1-5 with every row above holding; the R2 targets (first Master on day 25-60, no level 20 before day 100); save < 110 KB at day 200; tick p95 < 1.0 ms desktop; `ui-phone` green for every new screen at every viewport; `cache-drop` green.

### 8.5 Stage Z3: threats across levels, caverns, great beasts, fluids with water control

**Playable result:** the deep fights back. Opening a cavern lets its life and the Lamplost in; generated beasts with their own bodies and pre-history come up from the caverns the hold opened; the three legends arrive for their reasons; archers shoot down shafts and through murder holes; sappers dig down; water and ember flow, and the hold answers with floodgates, levers and raising bridges.

| Step | Agent | Owns | Depends | Builds | Test | Oracle | Size |
|---|---|---|---|---|---|---|---|
| Z3.1 Deep entries and cavern threats | H, G | `causes.js`, `raidplan.js`, `events2.js`, data `incidents.js` | Z2.10, Z2.7 | the Opened cavern, Near lair and Woken seep causes; deep passages; cavern packs; the Lamplost (trade or thieves); breaches | `node --test tools/tests/deep.test.mjs` | nothing comes through a passage before its cavern is opened; a breach enters at its seep's z and climbs; an underground threat by day 200 on 4 of 5, every one warned >= 6 h | M |
| Z3.2 Vertical defence | H, F | `fight.js`, `defence/*`, `sappers.js` | E11 | archers shoot down through open air up to 2 levels; murder holes and fortification walls; ledge and chasm perches in caverns; flyers via sky voxels and shafts; sappers dig down | `node --test tools/tests/defence3d.test.mjs` | an archer on z+1 hits a foe at z through a channel and not through rock; a wyvern enters a shaft but no voxel with `cover >= 1`; sappers repelled on 3 of 5 | M |
| Z3.3 Great beasts | H, G, D, C | `beasts/*.js`, `beasts/gen.js`, data `beasts.js`, `art/beasts.js` (part-based painter) | Z3.1 | 3.12: generated beasts from the dormant rows, the three legends, fleeing and returning by cause, trophies, the Ember Seal | `node --test tools/tests/beasts.test.mjs` | no command can schedule a beast; generation is a pure function of the seed; every beast's attacks map to existing sim effects; the Hollow King wakes when the Seal is mined; a 3-year bot (Steadfast) meets at least two beasts on 4 of 5 seeds; no fall caused by a beast on 3 of 5; render budget holds with a 3 x 3 beast on screen | L |
| Z3.4 Fluids and water control | B, C | `fluids.js`, mechanisms (`gates`, `levers`, `bridge`), fluid render | E4 | 2.8 flow; river breaches; cinderstone; doors, gates and floodgates block fluid; lever links across levels; the raising bridge; flood alerts | `node --test tools/tests/fluids.test.mjs` | a channel under the river floods z-1 and stops at walls; a closed floodgate holds a flood and opening it from a lever two levels up releases it; 4,096 active cells step in < 0.1 ms desktop; determinism with saves mid-flood; the bot stops a scripted breach with a floodgate | L |
| Z3.5 UI for threats on levels | I | `threatui.js`, `alerts.js`, `levels.js` | Z3.1 | the threat chip with level and cause; route preview with stair chevrons; breach, flood and ember alerts with level; lever-link UI | `node tools/ui-phone.mjs --stage=z3` | tap a breach alert and the view goes to -13 in 1 tap; route chevrons switch levels | M |
| Z3.6 Soak and balance | J, X | bot, soak | Z3.1-Z3.5 | 300-day soak on 5 seeds with every system on; the balance report | `node tools/gate.mjs --stage=z3` | the Z3 gate | M |

**Z3 gate:** a 300-day soak with save < 130 KB, stacks < 2,500, tick p95 < 1.2 ms desktop and the fluid active set < 4,096 at every tick; determinism and `cache-drop` mid-flood and mid-beast; the device check repeated with a great beast fight.

### 8.6 Stage Z4: polish (open-ended)

- **Water engineering:** pumps and pressure, wells by level, swimming and drowning.
- **Justice** (3.9), off by default, with the Warden of Law.
- **Logistics and building:** mine-cart tracks with ramps; windows (glass); bridges wider than the span rule.
- **The ruler's section view** (4.1).
- **Land:** the Small Vale 96 x 96 x 16 (`D` is already a header field); the Elderwood start biome.
- **Art and sound:** audio themes by depth and season; a second cavern art pass.
- **Quality:** an accessibility review; a device tuning pass; translations groundwork.
- **Optional, zero mechanics:** a new colony's pre-history may mention the player's fallen holds by name. The decision is the owner's.

### 8.7 Dependency order

```
S9.0 ─┬─ S9.1 device bench (owner runs it) ──────────────────────────┐ (numbers feed 6.x before E1)
      ├─ S9.2 classic ─┐                                              │
      ├─ S9.3 perks ───┤                                              │
      ├─ S9.4 fall ────┼─ S9.6 UI ─ S9.7 state v3 ─> Stage 2.9 ships  │
      └─ S9.5 bosses ──┘                                  │           │
                                                          v           v
E1 index at D=1 (ships) ─> E2 vertical + plain 3D A* ─┬─> E3 regions + link A* ─┬─> E5 work ──────┐
                    │                                 │                         └─> E11 hflow ────┤
                    │                                 ├─> E4 world systems ─┬─> E10 mapgen3 ─────┤
                    │                                 └─> E6 render ─> E7 UI │                    │
                    └─> E8 EC3 + pristine ────────────────────> E9 migration <┘                    │
                                                                                                  v
                                                      E12 bot v3 + gate z1 + fun review ─> E13 switch (ships)
Z2.1-Z2.7, Z2.9 in parallel ─> Z2.8 (after Z2.1), Z2.10 (after Z2.3) ─> Z2.11 ─> Z2 gate
Z3.1, Z3.2, Z3.4 in parallel ─> Z3.3 (after Z3.1), Z3.5 ─> Z3.6 ─> Z3 gate ─> Z4
```

**Critical path:** E1, E2, E3 (one agent, B, carries E2-E4 and E10, so E4 and E10 may go to a second B agent working in disjoint files: E4 owns the world systems, E10 only `mapgen3.js`). Everything after E3 fans out. The prototype code (`proto/world.mjs`, `proto/path.mjs`) is the starting point for E2, E3 and E10.

---

## 9. Risks and open questions

| Risk | Likelihood | Answer |
|---|---|---|
| A derived cache that depends on warmth slips in and a load diverges | medium | the F25 rule in C13; `cache-drop` in the gate from E1, on four scenes; canonical region labels |
| A missed tile-index field breaks migration or the codec | medium | the `tile` field type and `fields-tile.test` (E1); four real fixtures from `078cb71` (S9.0) |
| The pristine record is lost (storage eviction, a bug) | low | it is embedded in every dawn backup and export; native worlds can regenerate with CRC checks; a refusal never overwrites (5.1) |
| The inadmissible link heuristic gives visibly odd paths | low | +5% average and +15% at p95 (PROTO); invisible on a phone. The `max(octile, 0.85 x link)` variant is the fallback, at 5x expansions |
| The request-counted goal cap (6 per tick) delays jobs | low | 120 new goals a second at 20 Hz against about 3 needed for 30 colonists; the bot's idle share and haul latency are gated |
| Safari is slower than the 2.5x estimate | medium | measured in S9.1 **before E1**, so the architecture can still change; fallbacks: pre-bake limited to z-1, the A* budget cut to 6,000 expansions |
| Too many levels to read on a phone | medium | the explored-range limit, the band plate and tints, the ruler with job counts; the fun review (E12) |
| The fluids sim grows unbounded | low | the active-set cap and budget; fluids can stay static (Z3.4 is cuttable without a save change, because the layer exists) |
| Removing picks makes progression feel flat | medium | deed toasts and Annals entries, life goals, offices and nobles, artifacts, families; the bot report tracks perks per Master |
| Births grow the hold past the phone's budgets | low | births slow above 40 colonists; children count half; the R2 hard cap 40 holds; the soak checks stacks and tick time |
| Ranks, not unlocks, flattens the early pace | medium | Z2.9 is balanced against the Stage 2.9 tier days (within 15%); materials and research still pace the build |
| B is the critical path | high | E4 and E10 can go to a second B agent in disjoint files; E5, E6, E8 and E11 need only E2 or E3; the prototype code as a starting point |

**Open questions for the owner** (each with the default this design takes):
1. Justice comes in Z4, off by default. Should it come at all?
2. *(Closed in edition 4: backups are not on the Fallen card; recovery lives in Settings > Storage.)*
3. The Seal: should mining it ask for a confirmation letter, as a situational decision? The default is yes, one letter.
4. Should Z4 add fallen holds to new colonies' pre-history? The default is no.
5. **Research by doing** (new): today research is a tech tree worked at a desk. Should some techs instead be **discovered** by working a material (the first lumenite smelted teaches Lumensteel), by reading a lore tablet from a vault, or from a visiting scholar? The default is a mix in Z2.4: the tree stays, and about a third of its techs gain a "discovered when" alternative.
6. **Births** default to on (3.13). Should they be off by default, as R2 had them?

---

## Appendix A: R2 sections and their status

| R2 section | Status in revision 3 |
|---|---|
| Decisions D1-D15 | D2, D10, D11, D12 replaced (F1, F8, F6, F21); the rest kept (0) |
| 0 Response to the review | kept as history; the P0-1 flow-field rule replaced by F5 |
| 1 Pitch, pillars, hooks | amended by 1.5 |
| 2.1 Loops | kept; the "Long-term goals" table replaced by 3.11 (long arcs, no victory) |
| 2.2 Time | kept |
| 3.1 Map | amended: 128 x 128 x 20; claims by column (2.9) |
| 3.2 Generation | replaced by 2.2 (the 2D generator stays only until the switch, E13; the pristine world is stored, F28) |
| 3.3 Tile layers | amended by 7.1 and 2.4 (`fluid` added; roof 2 and 3 retired; `depth` removed) |
| 3.4 Digging | amended by 2.3 and 2.5 |
| 3.5 Fog | amended by 2.7 |
| 3.6 Temperature | amended by 2.6 |
| 4.1-4.4 Colonists | kept; personality added (3.2) |
| 4.5 Mood, breaks, Ember-touched | mood and breaks kept; Ember-touched replaced by Seizures of craft (3.3); the Lord's Ember thought removed |
| 4.6-4.9 Health, relationships, death, arrivals | kept; burial extended (3.6); arrivals only while someone lives; births and children in Z2, on by default (3.13) |
| 5 Work | kept; amended by E5 (levels, stairs jobs, region-distance ranking in 3D, zone distance fields removed) |
| 6 Items and production | kept; chains added (3.7) |
| 7.1-7.9 Structures | kept; built floors, built stairs, the winch and add-ons added |
| 7.10 Monuments and wonders | replaced by prestige buildings and two mechanisms (3.11); trophies optional |
| 7.11 Rooms | kept, per level; Tomb role added |
| 7.12 Research | kept; the Crown era renamed per 1.4 |
| 8 Specialisation intro, 8.1 perks | replaced by 3.1 (growth by doing) |
| 8.2 Workshop specialisations | replaced by add-ons (3.7); workshop tiers kept |
| 8.3 Charters | replaced by renown (3.10) |
| 8.4 Tiers and the Hearth | kept without the Lord gate or Hearth level 5; tiers become ranks that gate arrivals, not structures (F27) |
| 8.5 Starts | kept |
| 9.1-9.5 Storyteller, points, threat types, warnings, defence | kept, with every incident needing a cause (F26, 2.10); Ironhold becomes Hard; entries per level; the dawn rule only on sky-exposed voxels, raids rout by morale (2.10); military extended (3.8) |
| 9.6 Hollow Lords | replaced by great beasts (3.12) |
| 9.7, 9.8 Disasters, visitors | kept; floods and ember breach added in Z3 |
| 9.9 Failure and legacy | replaced by 1.3 (the fall and the Ruin) |
| 9.10 Actors, nemeses | kept, without the Reclaim carry-over |
| 10 Phone UX | amended by 4 (levels) and 1.1 (no classic link) |
| 11 Saves | 11.3 replaced by 5.1; the rest amended by 5.5 |
| 12 Performance | amended by 6 |
| 13 Architecture | amended by 7 |
| 13.5 Delete and keep | amended by 1.1 (the classic copy and the dead modules deleted; Lord art salvaged) |
| 14 Build plan | Stages 0-2 done; Stage 3 and 4 replaced by Stage 2.9 and Z1-Z4 (8) |
