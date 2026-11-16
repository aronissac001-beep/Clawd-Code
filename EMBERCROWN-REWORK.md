# Embercrown Rework Plan

**Verdict.** The owner is right, and the code shows why. Four things go wrong together:

- **Movement.** Units move by editing their position directly, and several systems overwrite it afterwards. That is why characters move strangely.
- **No threat.** The player is not needed to win. The free hero, the Hearth and the Sovereign clear every early night, and repairs undo all damage. That is why it is boring and why the logic feels broken.
- **Too many systems.** About 25 plug-in systems interrupt the loop rather than deepen it.
- **No lasting feedback.** Orders leave nothing on screen, so the player cannot tell whether a command worked.

The fix is to make the game smaller and denser:

- Short days, one dense wave front per night, and a final night that is the climax of each region.
- The Sovereign leads the defence directly.
- One reward pick per dawn.
- Bounties are removed, and heroes take the same orders as squads.

We keep the art, the day/night defence core, the Realm Map, iPhone-first play and the content that works.

All evidence cited below is in `/tmp/claude-0/-home-user-Clawd-Code/ebc4371c-fbfa-5aa9-b9db-34342a9a0671/scratchpad/diag/{movement,logic,fun,systems,controls}/`.

---

## 1. Diagnosis

1. **Fights look broken because combat AI never holds a decision.** Soldiers and the Sovereign re-think only every 0.3-0.35 s (`units.js:51-70`, `:153-165`). When their target dies they walk straight back toward their slot, then turn and lunge again.
   - Militia #33 made 37 reversals and 24 facing flips in 31 s. It walked 430 units for a net 121.
   - The Sovereign walked 337 units for a net 7 on night 12.
   - Hollow at walls re-pick friends they cannot reach (`enemies.js:221-241`), so they vibrate at about 4 Hz. They never commit to a siege: every wall was at 100% after night 7.
   - Melee reach is about 38 units against a 32-unit wall tile, with no line-of-sight test, so blows land through walls.

2. **Locomotion has no velocity, steering or arrival.** `movement.js` moves position directly, and later steps overwrite x/y:
   - knockback, which also ignores solidity (`common.js` `hurt()`)
   - position-rewinding slows (`foes.js:70,363`, `territory.js:630`, `relics-p4.js:187`)
   - a direct separation push (`movement.js:70-86`)

   Rendering then guesses the walk frame from the change in position (`render.js:416-417`). The effects:
   - Movers turn in 45° steps: 54-62% of moving ticks lie on a compass direction, against 13% for random headings.
   - Units walk single file and pile into blobs. The separation radius is 9 units while sprites are 12 wide.
   - Units slide in a frozen walk pose (88% of the idle Sovereign's movement), and facing flicks 0.5-1 times per second.
   - Knockback pushes Hollow **through walls** (`hknock.mjs`). `stepToward` lets them walk out of the solid tile on the far side (`movement.js:25-26`).

3. **The player is not needed.** A player who builds 3 buildings and then does nothing wins region 1. The Hearth ends at 1188-1472 of 1500.
   - The free starting Paladin (`heroes.js:124` `makeStarter`, auto night-guard 8 tiles), the Hearth bolt and the Sovereign kill everything.
   - The Sovereign had no target for 86-96% of each night.

4. **The night barely happens.**
   - Waves of 4, 6, 7, 7 and 8 are split over 1-4 fronts (`balance.js` base 4, linear 3, quad 0.32; the director's lull cuts 30%).
   - At most 2-4 Hollow are alive at once. Contact combat is about 5-10 s of a 135 s cycle.
   - In one seed, night-1 spawns walked a 73-76 tile route and never arrived (`waves.js:25-29` picks spawns by map side only).
   - Prosperity regions were cleared at 80 s into Day 1 with **0 nights held**, because `checkBeacon` (`cycle.js:89-94`) has no night requirement.

5. **No attrition, then a cliff.**
   - The Hearth is repaired to full every day: 10 hp/s per builder with 3 builders. Soldiers heal 40% at dawn (`cycle.js:182`), and the Sovereign regenerates 6 hp/s near the Hearth.
   - So nights 1-5 never threaten anything. Then the night-6 Blood Moon (×1.8 plus a Warden, `waves.js:271,310-315`) destroyed the Hearth in 3 of 4 bot runs.

6. **The day is 90 s of waiting** (`balance.js:10`).
   - The bot could afford nothing on 77-86% of its build checks. It made 11 useful actions on Day 1 and 3 on Day 2.
   - Villagers wander around the Hearth for 61-74% of daylight, because job slots are 1-2 per building while population grows past them (`villagers.js:89-97`).
   - Lumber camps run out of trees in about 2.5 days with almost no warning. Region 2 of FUN-1 soft-locked on wood.

7. **System pile-up.** Across 4 headless runs (29 regions, 115 nights):
   - 2.14 modal choices per night and 8.5 per region, plus about 3.2 toasts per minute.
   - About 17 sources of stat modifiers.
   - About 78% of the 30.6k lines of JS are plug-ins: Morale/Dread, decrees, weather, seasons, combos, territory, storytellers, omens and others.
   - Half the "rewards" are flat resource handouts: 61% of boon weight. The Ember Spring event charged 15 stone and then said "Nothing needed repair".
   - Prosperity targets reset each act, so they can be met on day 1 (`objectives.js:47`).

8. **Bounties are a dead end.**
   - Posting one takes 5 taps through a modal. The gold goes into `hero.purse`, which nothing ever spends (`heroes.js:173-174`).
   - Posting attack bounties *lowered* hero kills, from 1.76 to 0.83 per minute.
   - Heroes wander out alone and die permanently: the starting Paladin died to Dire Wolves on night 1.
   - Heroes use a third control scheme (card, then Rally, with a 45 s cooldown) and pace 2-5 tiles around the Hearth for 88% of the day (`heroes.js:310-331`).

9. **Orders leave no trace, and the HUD eats the screen.**
   - `controller.js:812` clears the selection after every order. Rally flags draw only while selected (`render.js:237`), and the order ring lasts 0.4 s. So squads seem to wander on their own.
   - The HUD covers 46% of the portrait screen, and only 20% is tappable map at dusk. A coach card sits on the Sovereign at region start, and 3 of 3 taps on the Sovereign failed.
   - In landscape the Barracks training buttons are below the fold (scrollHeight 766 vs 216).
   - The dusk countdown is truncated to "Day 1…" (`style.css:390`).

10. **Smaller logic bugs**:
    - Double level-up toast with a numeric id ("9 reached level 2!", `controller.js:350` plus `heroes.js:242`).
    - Hounds' "hunts villagers" is not implemented (`enemies.js:26`).
    - Riftspawner Husks are missing from the dusk forecast (night 4 forecast 5 Hollow; 13 arrived).
    - The Shrine offers a full heal at full HP (`run.js:338`).
    - Explore bounties pay out 2+ tiles short of the flag.
    - A hero level-up perk modal freezes the battle mid-night (`sim.js` tick returns early while `s.pending` is set).

---

## 2. The new core loop

**Pitch (readable in 30 s):** *Build by day. Lead the fire by night. Pick one card at dawn. Survive the Long Night, light the Beacon, march on.*

### Minute to minute (one cycle is about 85-100 s, and at least 40% of it is fighting)

| Phase | Length | What the player does |
|---|---|---|
| **Day** | 35 s (the first day of a region: 50 s) | Spend. Dawn income arrives as a visible lump, so every day starts with a real spend decision: a tower here, a house there, train 3 spearmen. Villagers build and repair visibly, but repairs **cost wood or stone**. **Call the Night** is a big button and pays +1 gold per second skipped. The day ends early on its own when nothing is affordable and no build is queued. |
| **Dusk** | 6 s | Tonight's front or fronts appear: a **faint route line** from each spawn to the town, a count, and icons for the foe types. The player moves the Sovereign and squads to meet them. The build bar collapses. |
| **Night** | until the wave is dead plus 3 s (minimum 12 s, maximum 75 s) | **The Sovereign is your hand.** With the Sovereign selected (the default), a tap on the ground walks it there at full speed with no slow motion. It fights on its own, and Nova and the Banner cast at its position. Tapping a squad portrait selects that squad, and the next ground taps move it until you reselect. Towers and the Hearth support but cannot solo a wave. The Hollow arrive within about 8 s, as one or two dense crowds you can read. |
| **Dawn** | 3 s plus **one** card pick | Wounds stay. Pick 1 of 3 **Dawn Cards** that change how the next night plays: tower arrows chain, the Sovereign cleaves, Braziers slow, Nova leaves fire, a new blueprint, a hero perk, or recruit a hero. The game autosaves. |

### Region to region

- **A region is 3 nights**, about 4-5 minutes at 1x.
  - Nights 1-2 build up.
  - **Night 3 is the Long Night**: the hardest wave, led by an elite, scaled by depth. It replaces the every-6th-night Blood Moon.
  - The Beacon lights only after the Long Night is survived. Every region plays its nights.
- **The objective** is always *Hold for 3 nights*, plus **one optional side goal** for bonus loot. Side goals are drawn from today's Prosperity, Edict and Rift objectives, e.g. "Destroy the Rift for a rare relic" or "Lose no buildings". A Rift region keeps the Rift as the main threat.
- **Lighting the Beacon** gives one reward pick (a relic or a run bonus). Then the player chooses the next node on the Realm Map.
- **An act** is 3 regions, with optional Mystery and Merchant branches, then the Boss: about 18-22 minutes. The run saves between regions. A full run is 3 acts, about 1 hour in 3 phone sessions. Endless mode stays for long play.
- **Depth scaling** uses one global index, `depth = act*3 + step`. It drives waves, objectives and loot, so nothing resets at an act boundary.

### What makes it fun (the targets we tune to)

- Each night is a visible crowd: 10 / 16 / 26+ foes at depth 0, rising about 25% per depth. The player sees towers and Nova mow them down.
- Damage carries over. A weak night 1 makes night 3 scary, and the day's spend decision is real: repair or expand.
- About 12 or more meaningful taps per minute, with at most 1 modal per dawn and 1 per region end.
- Movement reads as intentional:
  - Curved paths, lanes side by side, no pops.
  - Fighters hold after a kill.
  - Hollow commit to breaking walls.

---

## 3. Workstreams (parallel, minimal file overlap)

**Ground rules**

- Each stream **owns** its files. Edits to another stream's file are limited to the lines listed under "shared touch".
- Day 0: every stream agrees on the contracts in §3.0.
- Stream H1 (cuts) merges first, within days 1-2. Everyone else starts on their own files at once and rebases onto H1.
- Every stream must keep `tools/smoke.mjs`, `tools/determinism.mjs` and `tools/persist.mjs` green. Hit-stop and fades are render-time only and never touch the 20 Hz sim.

### 3.0 Shared contracts (agreed on day 0)

| Contract | Owner | Consumers |
|---|---|---|
| `stepToward` / `followPath` write `e.vx, e.vy, e.locoDist` (distance walked this tick under the unit's own power) and `e.walk` (0/1, with hysteresis) | A | G (render), B |
| `setFacing(e, dirX, mode)` with 150 ms / 4-unit hysteresis; `mode` is `'move'` or `'target'` | A | B, C |
| `applyImpulse(e, dx, dy)` (a decaying 0.15 s impulse that respects solidity) and `e.slowMult` (a speed multiplier, never a position rewind) | A | B, D (foes), H2 (cards) |
| `losClear(s, x0, y0, x1, y1, who)`, a supercover tile raycast in `pathing.js` | A | B, C |
| `engage.js`: `acquire(s, e, {center, radius, leash, los})`, `hold(e, secs)`, `attackSlot(target, e)` (ring at melee reach, at most 3-4 attackers), `guardZone(squad)` | B | C (heroes), units |
| `HOOKS.dawnCard(s)` returns the pending card choice; `HOOKS.beaconReward(s)` | H2 | D (`cycle.js` calls it) |
| `fx.js` `handleEvent(ctl, ev)`, all the per-event FX moved out of `controller.js` | G | F |
| `e.fade` (0..1) for villagers entering and leaving shelter | E writes | G draws |
| State v4 schema and fields removed or added (§H1) | H1 | everyone |

`balance.js` is co-owned **by section**: `combat` belongs to B; `cycle`, `waves`, `RUN` and the new `depth` block belong to D; `economy`, `villager` and `repair` belong to E. No stream edits another stream's block.

---

### A. Locomotion and steering ("characters move strangely")

**Goal.** Smooth, intentional motion: velocity-based steering with arrival, smoothed paths, lanes, and animation that matches motion.

**Owns:** `js/game/systems/movement.js`, `js/game/systems/pathing.js`, `js/game/sim.js` (tick body only).

**Shared touch:**
- `common.js` `hurt()` knockback block, to call `applyImpulse`.
- `foes.js:70,363` and `relics-p4.js:187`, to convert slows to `slowMult`.

**Changes**

1. **Steering model.**
   - Seek with arrival: slow down within 1 tile and stop within 0.5 units.
   - Cap turn rate at about 540°/s.
   - Walk-out-of-solid applies only to the tile the unit already occupies (`movement.js:25-26`).
2. **String-pull A\* results** (`pathing.js:167-203`) with a clearance raycast. `followPath` steers to a look-ahead point 1-1.5 tiles along the path, not to the next tile center (`movement.js:57-66`).
3. **Flow-field enemies:**
   - Seek the farthest downstream tile in line of sight (2-4 steps of `next[]`).
   - Give each a persistent sideways lane offset of ±10-14 units, replacing the ±4.8 jitter at `enemies.js:274`, where B applies it.
4. **Separation becomes a velocity term** capped at 30% of max speed.
   - Radius: 14 for soldiers and heroes, 10 for villagers.
   - Computed from a snapshot after everyone has moved.
   - Idle units within 0.5 units of their slot get low weight.
5. **Animation** advances `e.anim` from `locoDist`. `e.walk` turns on above 20% of nominal speed sustained for 2 ticks. Movement while blocked does not animate (`movement.js:23`).
6. **`setFacing` hysteresis**, facing along velocity while moving.
7. **Knockback**: `applyImpulse` respects `solidForEnemy`, as Nova already does at `units.js:356`, and applies only to melee or heavy hits, not tower arrows.
8. **`losClear`** helper.

**Acceptance.** Re-run `diag/movement/{analyze,wiggle,bystate}.mjs` on the same scenarios.

- Share of moving ticks within 3° of a compass direction: **< 25%** for path and flow movers (today 41-62%).
- Shade path length vs straight line: p90 **< 1.35** (today 1.96).
- Moving with no walk-cycle advance: **< 3%** (today 13-88%). Walk/idle toggles: **< 0.2/s** (today up to 1.28).
- Engaged soldier pairs within 8 units: **< 0.15 per tick** (today 0.73).
- `hknock.mjs` repro: the Husk never ends inside or beyond the wall tile; x stays below 512 after 20 hits.
- No unit pops more than 6 units in one tick, apart from shelter entry, which is now a fade.
- Frame time with 70 movers on iPhone 13 emulation (4x CPU throttle): sim tick **< 3 ms**.

---

### B. Combat behaviour (dithering, wall vibration, idle squads)

**Goal.** Fighters commit, hold and spread out. Walls get sieged. Squads defend an area, not a point.

**Owns:** `js/game/systems/units.js`, `js/game/systems/enemies.js`, new `js/game/systems/engage.js`, `js/data/units.js`, the `combat` block of `js/data/balance.js`, `js/data/enemies.js` (behaviour fields only).

**Changes**

1. **Re-target in the same tick** when the target is dead (set think to 0). Prefer foes near the unit, not near the flag (`units.js:59,66,159`).
2. **Hold state.** After a kill, stay and face the last foe for 0.8-1.2 s. Return only if nothing is within aggro. The return uses arrival steering.
3. **Hysteresis.** Engage within aggro, release beyond leash + 1 tile, keep a target for at least 1 s.
4. **Guard zone** of 6-8 tiles for each squad. A sieged building or a foe inside the zone moves the working rally point there, and it returns 3 s after the last threat. Ranged units step forward until a foe is in range, then hold.
5. **LOS gate** on the target filters for enemies, soldiers and the Sovereign, and on the melee reach check. Arrows may fly over walls; melee may not.
6. **Siege commitment.** When the bite path is blocked, siege the blocking tile for at least 2.5 s or until it breaks (`enemies.js:221-241`).
7. **Attack slots.** At most 3-4 melee attackers per foe, spread on a ring by approach angle. The extras pick another foe.
8. **Formation slots** widen to 20×20 or a staggered wedge (`units.js:17-20`).
9. **Hounds** (`prefers:'living'`) search for villagers and soldiers in a wider radius and ignore buildings (`enemies.js:26`). The flanking offset uses A's lane offset.
10. **Sovereign AI** (`units.js:153-165`): with no order it auto-fights within 4 tiles of where it stands. A move order overrides that until arrival.

**Acceptance** (`diag/movement` scenarios F, P, E_walls, D_full, re-run):

- Soldier reversals of more than 120° per moving second: **< 0.4** (today 1.66).
- Sovereign facing flips: **< 0.2/s** (today 0.97).
- E_walls: **0** melee hits landed with LOS blocked.
- E_walls: at least one wall below 80% HP by the end of night 7, i.e. sieges happen.
- E_walls: hound #76's reversal pattern is gone, with fewer than 5 reversals in 22 s.
- E_walls: within 3 s of a siege starting inside its zone, the squad is within 2 tiles of the besieged wall. The Sovereign and archers move more than 0 units.
- No foe with more than 4 melee attackers on any tick.
- `tools/determinism.mjs` green.

---

### C. Heroes and bounty removal (owner request)

**Goal.** No bounties. Heroes are 0-2 named champions, commanded exactly like squads, with a calm guard-post AI.

**Owns:** `js/game/systems/heroes.js`, `js/data/heroes.js`, `js/data/heroes-p4.js`, `js/ui/heroui.js`, `js/engine/heroart*.js` (only if a card needs it).

**Changes**

1. **Delete the bounty system** (full map in the systems lens):
   - `heroes.js`: `BOUNTY_KINDS`, `bounties`/`bseq`, `bountyById`, lines 149-231, think step 3 (355-381), `updateBounties` calls (508, 577), explore payout (559-575), `cmdPlaceBounty`/`cmdCancelBounty` (626-663), `onKill` payout (716-735), escrow refund (798-802), `purse`, `bountyId`/`skipB`/`skipT`, and the `goldMult` collector.
   - `heroui.js`: `bountyButton`, `openPicker`, `bountyTool`, `drawBounties`, `FLAG_SVG`, the bounty `GK_TEXT`, and the right-rail button.
   - Data: `maxBounties`, `bountyGold`, `avoidRadius`, `exploreReveal`, `bountyXp`. The 9 `+X% bounty gold` perks (`heroes.js:25,45,64,105,125,146,166`; `heroes-p4.js:36,76`) are replaced with real stat perks.
   - `TRAITS` keep only retreat, rest and glory. Quirks are dropped.
2. **Delete Rally** (`cmdRally`, `rallyTool`, the Rally button and its cooldown).
3. **New commands**, registered from `heroes.js`: `heroMove` (move there and hold the post), `heroAttack`, `heroAuto`. Heroes become selectable and portrait-pickable like squads (F wires the input).
4. **Guard-post AI.** Hold the post facing outward, engage through `engage.acquire` within aggro of the post, return when clear, retreat below the trait threshold. With no post set, night-guard within 5 tiles of the Hearth. **Never chase guard beasts** unless ordered. Idle wander (`heroes.js:310-331`) is removed.
5. **No free starter hero.** `makeStarter` (`heroes.js:124`, `:770`, `:776`) is removed. Heroes come from the "Recruit" Dawn or Beacon card or a Mystery event (H2 supplies the card; C supplies `recruitHero(s, cls)`). The cap is 2.
6. **Perks.** Perk choices are never queued mid-night (today `heroes.js:245`, `:765`). They are offered as a Dawn Card option (H2 pulls from `pendingPerks`).
7. **Hero card** becomes a bottom sheet with HP, level, one ability and kills.
8. Drop the duplicate named toast at `heroes.js:242`, or keep it if F removes `controller.js:350`. **Decision: keep 242; F deletes 350.**

**Acceptance**

- `grep -rni bounty js/` returns nothing outside the state migration.
- A new run has 0 heroes.
- Picking the Recruit card spawns one.
- A portrait tap followed by a ground tap moves the hero to within 1 tile of the target in under 4 s (Playwright, real taps).
- Over a 90 s day, an idle hero at its post moves less than 1 tile per minute.
- No perk modal ever appears while `s.cycle.phase === 'night'` (headless, 20 nights).
- A night-1 hero death with no player order happens in **0 of 10** seeds (today 1 of 5).

---

### D. Pacing: nights, waves, objectives ("boring", "logic doesn't work")

**Goal.** Every region plays 3 escalating nights, ending in the Long Night. Waves are dense, arrive fast and are forecast honestly. The player must act to win.

**Owns:** `js/game/systems/waves.js`, `js/game/systems/cycle.js`, `js/game/systems/objectives.js`, `js/game/systems/director.js` (strip to invisible pacing), `js/game/mapgen.js` (spawn validation), the `cycle`/`waves`/`RUN`/`depth` blocks of `balance.js`, `js/data/modifiers.js`.

**Shared touch:** `foes.js:233-258` (forecast the riftspawner brood).

**Changes**

1. **Cycle.**
   - `dayLen` 35 (50 on the first day of a region), `duskLen` 6, `nightMin` 12, `nightMax` 75, `dawnLen` 3.
   - The night ends when the wave is dead plus 3 s.
   - Calling the night early pays gold per skipped second. The day auto-ends when nothing is affordable and nothing is queued (E exposes `anyAffordable(s)`).
2. **Wave budget by region night and depth.**
   - Night 1 = 10 + 4d, night 2 = 16 + 5d, Long Night = 26 + 7d, plus one elite.
   - Fronts: 1 / 1 / 2 at depth 0-3, then 2 / 2 / 3.
   - Delete the Blood Moon cadence, keeping the Warden as the Long Night elite. The Warden's damage to the Hearth is capped at 40% of Hearth max HP per night, and it targets walls and towers first.
   - Endless mode: every 3rd night is a Long Night.
   - Delete the lull and the storyteller pick. One Steady pacing curve stays inside `director.js`, invisible: no omens, no events.
3. **Spawn validation** in `mapgen.js` / `planNight`. Reject a spawn whose flow distance is more than 1.4× straight-line or more than 30 tiles, or carve a road to it. Spawns sit 14-20 tiles out, so contact comes within about 8 s.
4. **Route preview.** Export the per-front flow polyline for G to draw at dusk.
5. **Honest forecast.** The riftspawner brood (min(lifeCap, nights × brood)) is added to the forecast counts (`waves.js:321`).
6. **Objectives.**
   - Main objective: *Hold for 3 nights*, or *Destroy the Rift within 3 nights*.
   - Side goal: Prosperity, Edict or "lose no buildings", for bonus loot. Targets are scaled by global depth (`objectives.js:47-48`).
   - `checkBeacon` (`cycle.js:89-94`) requires the Long Night to be survived.
7. **Attrition.**
   - Remove the 40% soldier heal at dawn (`cycle.js:182`). Soldiers heal 15% at dawn; more requires a healer building.
   - Sovereign regen near the Hearth drops from 6 to 2 hp/s.
   - Lifting the Blood Moon dawn rule becomes moot.
8. The dawn pending choice (`cycle.js:63-65`) calls `HOOKS.dawnCard(s)`. The blueprint-draft logic moves to H2.

**Acceptance.** New `tools/pacing.mjs`, built from `diag/logic/hsim.mjs`, `diag/fun/waves.mjs` and `diag/logic/s15.mjs` logic, run on 10 seeds:

- **AFK bot** (3 economy buildings, no other input) loses region 1 by the Long Night in **≥ 8 of 10** seeds (today it wins).
- The `runsim` "modest bot" wins region 1 in ≥ 8 of 10 and finishes Act I in ≥ 5 of 10.
- The first Hollow comes within 6 tiles of the Hearth **≤ 10 s** into the night, on every seed (FUN-1 night 1 never arrived).
- Peak Hollow alive on the Long Night at depth 0: **≥ 20** (today the peak is 4).
- Contact combat (any Hollow within 8 tiles of a building) takes **≥ 35%** of cycle time (today about 5-10%).
- Forecast total equals spawned total on every night.
- The Beacon can never be lit before the Long Night is survived.
- Region length at 1x: **4-6 min**.
- No single night accounts for more than 50% of Hearth losses across the seeds (no cliff).

---

### E. Day economy and villagers

**Goal.** A short, decision-dense day. Visible lumps of income, wounds that cost something to fix, no idle milling, no silent soft-locks.

**Owns:** `js/game/systems/economy.js`, `js/game/systems/villagers.js`, `js/game/systems/buildings.js`, `js/game/systems/structures.js`, `js/data/buildings.js`, `buildings-ext.js`, `buildings-civic.js`, the `economy`/`villager`/`repair` blocks of `balance.js`.

**Shared touch:** `common.js` `spawnVillager` door placement (line 186).

**Changes**

1. **Dawn income lump.**
   - Every producer banks its day output and pays a visible lump at dawn, emitted as an `incomeLump` event for G to draw as flying icons.
   - The day trickle is kept at a lower rate, so villager work still reads.
   - Starting resources are tuned so Day 1 offers 3+ affordable choices.
2. **Repairs cost resources and are capped.** 1 wood per 8 HP for wood buildings and 1 stone per 8 HP for stone; 4 hp/s per builder. Hearth damage carries across nights, and the HUD shows it.
3. **Population growth** only while open job slots exist. Farm slots rise to 2.
4. **Idle villagers** stand at their house door or carry loads between buildings. The Hearth ring wander (`villagers.js:90-97,139`) is removed. The HUD shows an `idle: N` count.
5. **Lumber camp placement** needs at least 150 wood within the radius, and the ghost shows the total (E exposes `placeInfo(s, type, tx, ty)` for F). A depleted camp gets a persistent badge, and its workers walk up to 3 extra tiles before the camp is marked depleted.
6. **Shelter transition.** Villagers walk to the door tile and fade out over 0.25 s (`e.fade`), and fade in on leaving and walk one tile out (`villagers.js:119,124,243-244`).
7. **No-wood soft-lock guard.** If wood income is 0 and wood is below the cheapest wood producer, offer the Hearth trade inline: emit `softlock` and F shows the button.
8. `anyAffordable(s)` for D's auto-end of the day.
9. Remove the Ember Spring-type "pay for nothing": any event that repairs must check `needsRepair` first (owned by H2 for the event data).

**Acceptance** (headless, 10 seeds plus the `diag/fun/play.mjs` bot):

- Villager wander share of daylight: **< 20%** (today 61-74%).
- Day-1 build checks with something affordable: **≥ 60%** (today 23%). Useful actions per day: **≥ 6** on every day of region 1.
- Wood income never sits at 0 for a whole day without the soft-lock prompt showing.
- Repairing 500 Hearth HP consumes wood or stone.
- Hearth HP at dusk is no higher than HP at dawn plus repair capacity.
- Shelter pops of more than 24 units in a single tick: **0** (today 13).

---

### F. Controls and HUD (feedback, persistent selection, screen space)

**Goal.**

- The player always sees what they ordered.
- One control language for the Sovereign, squads and heroes.
- At least 60% of the screen is tappable map.
- Every important action is reachable without scrolling.

**Owns:** `js/game/controller.js`, `js/engine/input.js`, `js/ui/hud.js`, `buildbar.js`, `infocard.js`, `toast.js`, `coach.js`, `modal.js`, `css/style.css`, `css/run.css`, `render.js` **selection and order overlay section only** (`render.js:230-260`, `640-660`).

**Changes**

1. **Persistent selection.**
   - The Sovereign is the default selection.
   - A tap on a portrait selects that unit. Ground taps move the selected unit and foe taps attack, and the selection stays (`controller.js:812` no longer clears it).
   - Tapping the selected portrait again, or the crown button, returns to the Sovereign.
   - Hit priority in `pick()` uses the nearest center, not a fixed type order (`controller.js:745-750`).
2. **Slow motion.** No automatic slow motion (`controller.js:139`). A **Plan** (pause) button sits next to speed, and orders can be given while paused.
3. **Order feedback.**
   - Every squad's rally flag is always drawn, color-coded and numbered to match its portrait, and dimmed when not selected.
   - A dashed path runs from each moving unit to its destination.
   - The destination marker stays until arrival.
4. **One message lane.**
   - A single line above the bottom bar holds a queue: duplicates are dropped, at most 1 is visible, and nothing shows while a modal is open.
   - Coach tips are one line, never drawn over the Hearth or the Sovereign's screen rect, and hidden while a ghost is placed. Tips are cut to 6 total.
   - Dusk and night banners become a 1-line top strip shown for 2 s.
5. **Build.**
   - Drag from the bar and release on a valid tile to build. An invalid release cancels with a reason.
   - Tapping a bar item gives the ghost with ✓/✕ attached beside it. A tap outside the ghost cancels and is handled as a normal tap.
   - The finger offset drops to 32 px, and the ghost is clamped to the free map area (`controller.js:587,606,653,790-796`).
6. **Cards put actions first.** A horizontal row of 56 px buttons for train, upgrade and workers sits under the title, with the description behind an "i". Landscape uses a full-height left side sheet; portrait uses a half-height bottom sheet.
7. **Top bar** becomes one 44 pt strip: food, wood, stone, gold, pop and idle count, and a large dusk countdown in the phase ring (fixing `style.css:390`), flashing in the last 10 s.
   - The objective is shown as a chip under it.
   - The right rail holds Nova and Banner only, with distinct icons.
   - The build bar hides at dusk and night.
8. **Explanations** open on tap (pointerup with no movement) or long-press, not on pointerdown (`hud.js:30,43`). With nothing to do, a tap on empty ground does nothing.
9. **Portraits** go in a vertical rail on the thumb side, with squad color and number. The hero gets a round frame and the Sovereign a crown.
10. Move the FX `switch` out to G's `fx.js`. Delete the bounty FX (`controller.js:348-349,562,774`) and the numeric-id toast (`controller.js:350`).
11. Inline buttons for E's soft-lock trade and D's Call the Night.

**Acceptance** (Playwright, real taps, iPhone 13 portrait plus 844×390 landscape; extend `diag/controls/s*.mjs`):

- Tappable map share **≥ 60%** by day and **≥ 70%** at night in portrait (today 39% and 20%).
- At region start, 3 of 3 taps on the Sovereign select or act on it.
- 5 s after a squad order, its flag is drawn at the target, verified by pixel probe.
- A second ground tap without reselecting moves the same squad again.
- Landscape Barracks: the first tap on Train queues a unit, and every action button is inside the card viewport.
- `.cl` countdown: scrollWidth ≤ clientWidth in both orientations.
- At most 1 toast in the DOM at any time, and 0 while `#modal` is open.
- Drag-to-build: one gesture places a Farm in under 1 s.
- Every tap target is 44 pt or larger.
- Selecting a unit no longer changes `timeScale`.

---

### G. Readability and juice (night mood, hits that land)

**Goal.** The night looks like night, the Hollow pop out of the ground, hits and kills feel heavy, and units animate correctly.

**Owns:** `js/engine/render.js` (everything except F's overlay section), `js/engine/particles.js`, `js/engine/loop.js`, new `js/engine/fx.js`, `js/engine/foeart.js`, `js/engine/sprites.js` (unit draw), `js/engine/audio.js`.

**Changes**

1. **Night grade** much darker outside light pools, with strong warm pools around the Hearth, Braziers, towers and the Sovereign. Dusk ramps to it over 6 s.
2. **Hollow readability**: an emissive rim plus eyes, and a slight drop shadow. Elites get a distinct glow color.
3. **Walk frame** from `e.walk` and `e.anim` (A's contract), replacing `render.js:416-417`. Villager shelter fade comes from `e.fade`.
4. **Hit feedback.**
   - A 40-60 ms render-time hit-stop on Sovereign and Nova kills (in `loop.js`, the sim is untouched).
   - A white flash on the struck sprite and a larger damage number, kept above zoom 0.45.
   - Death burst plus small shake. Ember pickups fly to the gold chip.
   - A kill-streak pop on the Sovereign.
5. **Dusk route lines** from D's polylines, faint and animated toward the town, plus edge markers that are never under HUD insets.
6. **Income lump FX** for E's `incomeLump` event.
7. **`fx.js`** owns every event-to-particle mapping, moved from `controller.js:218-222` and the rest of the switch. FX cases for cut systems are deleted.

**Acceptance** (screenshots in `diag/`, scripted):

- Night: mean luminance of ground outside light pools is **≤ 45%** of day.
- Husk vs ground contrast ratio at night is **≥ 3:1**, sampled on the sprite against its surrounding tile.
- Hit-stop measured at 40-60 ms of frozen render after a Sovereign kill. The sim tick count is unaffected (determinism green).
- 60-foe Long Night: p95 frame **< 16.7 ms** on iPhone 13 emulation with 4x CPU throttle.
- A dusk screenshot shows a route line for every front.

---

### H1. Cuts, merges and save migration

**Goal.** Delete the systems that do not pull their weight, keep old saves loading, and shrink the codebase by at least 25%.

**Owns:**

- `js/game/content.js` and `js/game/hooks.js`.
- `js/game/state.js`, which holds the v3→v4 migration.
- Deleted outright: `mood.js`, `moodui.js`, `data/decrees.js`, `weather.js`, `weatherfx.js`, `combos.js` (system and data), `comboart.js`, `territory.js`, `territoryart.js`, `seasons.js`, `seasonui.js`, `directorui.js` (storyteller pick and region events), `data/storytellers.js`, `data/omens.js`, `data/regionevents.js`.
- Trimmed: `js/game/systems/factions.js`, `js/data/factions.js`, `js/data/faction-content.js`, `js/game/meta/records.js`, `js/data/achievements.js`, `js/ui/codexui.js`.
- `EMBERCROWN.md`.

**Changes**

1. **Remove the registrations** from `content.js:69-78`. `BUS` lists that become empty stay as empty arrays. `canPlace` loses its territory veto: you build anywhere explored within 12 tiles of the Hearth.
2. **Factions.** All 4 are kept. Drawbacks that reference cut systems are rewritten:
   - Deepforge: "builds 20% slower" only.
   - Emberkin: "Houses hold 1 fewer" in place of Morale and lairs.
   - The Cathedral of Dawn's Morale aura becomes a +15% work-speed aura.

   Only Dawnhold is open on the first run; the others are unlocked through the Citadel.
3. **State v4 migration.**
   - Refund `sum(ext.heroes.bounties[].gold)` to `s.res.gold`.
   - Delete `bounties`, `bseq`, hero `bountyId`/`skipB`/`skipT`/`purse`, and the `ext` keys for mood, territory, seasons, weather, combos and director events.
   - Convert a `bloodMoon` countdown to Long Night indexing.
   - A pending choice of a cut kind (decree, regionEvent) is dropped.
   - The run roster's `purse` is dropped.
4. **Records and achievements** that reference cut systems are retired, keeping only earned flags.
5. **Coach tips** for the cut systems are deleted; F rewrites the remaining tips.

**Acceptance**

- `tools/smoke.mjs`, `determinism.mjs` and `persist.mjs` are green.
- A saved v3 region with 2 active bounties (fixture captured from the snapshot) loads, and its gold rises by the escrowed amount.
- `grep -rniE "morale|dread|decree|weather|season|combo|territory|lair|storyteller|omen" js/` hits only the migration and changelog.
- `wc -l js/**/*.js` total falls by at least 7,500 lines.
- Modal choices per region (`diag/systems/measure.mjs`): **≤ 4** (today 8.5).

---

### H2. Rewards and run structure (one pick per dawn, shorter acts)

**Goal.** One meaningful reward per dawn and one per Beacon, a 3-region act, and a one-tap start.

**Owns:**

- New `js/game/systems/dawncards.js`, which implements `HOOKS.dawnCard` and `HOOKS.beaconReward`.
- Reward data: `js/data/boons.js` (becomes `cards.js`), `js/data/beacons.js`, `js/data/perks.js`, and `js/data/relics.js` plus `relics-p4.js` (data parts).
- `js/data/citadel.js` with `js/game/meta/citadel.js`, and `js/data/events.js`.
- Run flow: `js/game/run.js`, `js/game/realmmap.js`, `js/game/runflow.js`.
- Screens: `js/ui/runscreens.js`, `js/ui/realmmap-ui.js`, `js/ui/citadelui.js`, and `js/main.js` (setup flow).

**Changes**

1. **One Dawn Card pool:**
   - blueprints (moved here from `cycle.js:85-97` `makeDraft`);
   - night-changing upgrades (about 20: tower chain, Sovereign cleave, Nova fire trail, Brazier slow, spear brace, and so on);
   - hero perks (from C's `pendingPerks`);
   - Recruit a hero (cap 2, via C's `recruitHero`).

   Every option must pass `hasEffect(s, card)`, so a heal at full HP or a repair with nothing damaged is never offered. A small "Take supplies" fallback covers what boons used to give, with resource cards about 15% of weight at most (today 61%).
2. **One Beacon reward pick** (a relic or a run bonus). It replaces the Beacon bonus plus the extra draft.
3. **Map nodes:** Region (with up to 4 visible modifier tags), Cursed Region, Mystery, Merchant, Boss.
   - The Ruin node is cut, merged into Cursed.
   - The Shrine is cut: its heal moves to the Merchant, gated by `hp < maxHp` (fixing `run.js:338`), and its blessings move to Mystery.
4. **Acts.** `stepsPerAct` drops to 3 regions plus branches, then the Boss. The global `depth` from D drives all scaling.
5. **Content trim.** Relics go to about 20 with no sets; those that touch cut systems are removed. The Citadel goes to about 10 upgrades. The offered building pool goes to about 15, with the rest unlocked in the Citadel. Events are trimmed to 12 Mystery events. Daily and Sandbox are hidden from the main menu; Endless unlocks after the first Act win.
6. **One-tap start.** "Play" starts a Campaign with Dawnhold, Standard difficulty and a random seed, straight to the region with a 3-card blueprint pick. Setup options unlock after the first run (`main.js`, `runscreens.js`). The setup screen must fit 844 px with no scroll.
7. **Region-end screen** shows a one-line cause on loss: "The Hearth fell to Warden Knights from the east."

**Acceptance**

- Headless 20 nights: **exactly 1** pending choice per dawn and 1 per region end. No other modal during play, apart from the Mystery and Merchant node screens.
- An enumeration test over every card × fixture state finds 0 offered options with no effect.
- Taps from the title screen to the first building ghost: **≤ 4**.
- `tools/runsim.mjs` Act I duration at 1x: **15-25 game-minutes** (today 50-87).
- Setup screen scrollHeight ≤ viewport.

---

### Integration plan

| Day | Milestone |
|---|---|
| 0 | Contracts in §3.0 merged as stubs: empty `engage.js`, the `setFacing`/`applyImpulse`/`losClear` signatures, `HOOKS.dawnCard` defaulting to the current boon choice, `fx.js` re-exporting the old switch. |
| 1-2 | **H1 merges** (cuts and the v4 migration). Everyone rebases. |
| 3-6 | A, B, C, D, E, F and G land behind `?rework=1` where they change balance, so A/B and D/E can be tuned separately. |
| 7 | Remove the flag. Run all acceptance suites together, plus a 20-minute device playtest on a real iPhone (one region in each orientation). |
| 8-9 | Tuning pass on the D/E numbers using `tools/pacing.mjs` and the playtest notes. |

---

## 4. Cut / merge list

| System | Decision | Why (evidence) |
|---|---|---|
| **Bounty flags** (+ purse, Rally, `goldMult` perks, the Greedy trait) | **Cut** | Owner request. A dead gold sink that lowers hero kills, takes 5 taps and adds a third control scheme. |
| **Free starter hero** | **Cut** | Makes AFK play win. The Sovereign is the early champion. |
| Morale / Dread / Book of Decrees | **Cut** | An unexplained run-loss meter and 24 decree modals; about 970 lines. |
| Weather, Seasons | **Cut** | About 960 lines, the most common toasts, and the winter-territory rule no one can infer. Winter may return as an Act II biome palette only. |
| Territory zones, claims, lairs | **Cut** | Hidden build rule, 7,918 failed builds, stray taps opening zone cards. Building is now anywhere explored within 12 tiles of the Hearth. |
| Hidden adjacency combos | **Cut** | Invisible by design. Can return later as visible adjacency bonuses in the ghost. |
| Storyteller choice, omens, in-region random events | **Cut** (keep invisible pacing) | 58 region-event modals, and the omen button points to yet another button. |
| Blood Moon every 6th night | **Merge → Long Night** (each region's 3rd night) | Removes the cliff, and every region gets a climax. |
| Survive / Prosperity / Edict / Rift objectives | **Merge**: Hold 3 nights (or the Rift) + 1 optional side goal | Prosperity skipped the defence entirely. |
| Dawn Offering, blueprint draft, decree, Beacon bonus, hero perk | **Merge → one Dawn Card**, plus one Beacon reward | 2.14 choices per night become 1. |
| Shrine, Wheel, Ruin nodes | **Cut / merge** into Merchant (heal), Mystery (blessings), Cursed (Ruin) | Fewer node types; fixes the useless heal. |
| Tavern blueprint | **Cut**; recruit through a card or Mystery | Hero access no longer depends on draft luck. |
| Hero quirks, most traits | **Cut** | Meaningless without bounties. |
| Automatic slow motion on select | **Replace** with a Plan (pause) button | Speed lurches on every order. |
| Daily, Sandbox (menu) | **Hide** | Fewer pre-play decisions. |
| Relics 45→~20, Citadel 30→~10, buildings offered 35→~15, events 45→12, modifiers →4 visible tags | **Trim** to an unlock track | Breadth was added before the core was fun. |

**Kept as is or improved:** all art and procedural sprites, the Realm Map, the 3 bosses, Endless, factions (rewritten), squads and the unit counter triangle, light versus the Hollow (Braziers), towers and walls, Nova and Banner, relics (trimmed), the Citadel (trimmed), Mystery and Merchant, offline PWA, and synthesized audio.

---

## 5. Risks

1. **Determinism and saves.** Steering, LOS and attack slots change the order sim state is mutated in.
   - *Mitigation:* all new logic stays inside the fixed tick, and separation is computed from a snapshot.
   - `determinism.mjs` must stay green on every PR.
   - Hit-stop and fades are render-only.
   - The v4 migration is tested against a real v3 save fixture, including the bounty refund.
2. **Over-correcting difficulty.** Removing the free hero, adding attrition, adding denser waves and adding paid repairs could stack into frustration.
   - *Mitigation:* D and E tune behind `?rework=1`, with the AFK-loses / modest-bot-wins bracket as the gate.
   - Standard difficulty targets a win rate of about 60% for the modest bot in region 1-3; Gentle difficulty gets 0.7× wave budgets.
3. **iPhone performance.** 60-80 foes with steering, LOS raycasts and lighting pools.
   - *Mitigation:* LOS runs at think rate (every 0.3 s), not every tick, and is cached per tile pair per tick. The light pass stays at low resolution.
   - The frame and tick budgets in the A and G acceptance tests are hard gates.
4. **Parallel-merge conflicts** in `balance.js`, `render.js`, `controller.js`, `common.js` and `cycle.js`.
   - *Mitigation:* section ownership as stated, contracts merged first, and H1 merged early.
   - A shared-touch line list per stream; anything outside it needs the owner's review.
5. **The game may feel thinner after cuts.**
   - *Mitigation:* depth moves to the Dawn Card upgrades, which change how a night plays, and to the Long Night.
   - Cut systems are deleted from main but tagged in git (`pre-rework`), so a well-tested one can return as a card or map event.
6. **Gesture conflicts on touch.** Drag-to-build versus pan, and persistent selection plus ground taps versus accidental moves.
   - *Mitigation:* a drag that starts on the bar always builds; a drag that starts on the map always pans.
   - Ground taps move only the selected unit, and the dashed path shows the result at once.
   - Plan (pause) gives a safe mode.
7. **Bots are not humans.** Headless metrics prove the numbers, not the feel.
   - *Mitigation:* a mandatory real-device playtest at day 7, using the owner's original phrasing as the checklist: "logic works", "not boring", "moves naturally", "no bounties".
