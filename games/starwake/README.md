# Starwake

A real-time-with-pause galactic grand strategy game for iPhone Safari (and desktop browsers), shipped as one self-contained HTML file.

- Play file: `docs/starwake/index.html` (generated, do not edit by hand)
- Source: `games/starwake/src` (the engine has no DOM access, so it also runs headless in Node)

## Commands

```
node games/starwake/tools/build.mjs            # inline src into docs/starwake/index.html (syntax-checks every file)
node games/starwake/tools/test-engine.mjs      # galaxy generation, commands, two full AI games, save round trip, determinism
node games/starwake/tools/test-ui.mjs [dir]    # drives the page at iPhone 14 size with touch; optional screenshot dir
node games/starwake/tools/sim.mjs [games] [size] [years] [seed]   # all-AI games: winners by archetype, victory types, wars
node games/starwake/tools/balance.mjs [games] [small,medium] [workers] [seed]  # parallel all-AI games: win share, conquest years, mid-game strength
node games/starwake/tools/playtest.mjs [years] [dir] [size]  # a scripted human plays through the UI by tapping; screenshots every 5 years
```

## Layout

- `src/engine/` pure game logic, deterministic (seeded sfc32 RNG stored in the game state), JSON-serializable state
  - `core.js` RNG, names, Dijkstra/BFS over starlanes · `data.js` resources, traits, ethos, governments, AI archetypes, stars, planets, jobs, districts, buildings, traditions, edicts
  - `techdata.js` 82 technologies in three streams and five tiers, plus repeatables · `shipdata.js` hulls, components, armies, starbases, monsters
  - `galaxy.js` star placement (spiral 2/4 arms, elliptical, ring), planar starlanes, bodies, deposits, nebulae, special systems
  - `game.js` new game, empires, day loop, save format · `economy.js` modifiers, jobs, stability, growth, construction, market
  - `research.js` tech cards, traditions, legacy works, edicts · `ships.js` designs, fleets, movement, civilian orders, starbases, shipbuilding
  - `combat.js` space battles, retreat, starbase capture, ground invasion · `diplomacy.js` contact, opinion, treaties, war, exhaustion, peace
  - `events.js` anomalies, event chains, random events, offers · `actors.js` fauna, natives, the Hollow Choir crisis · `victory.js` score, history, victories · `ai.js` AI empires
- `src/ui/` canvas rendering and DOM UI: `util.js` (DOM, icons, settings, compressed saves), `audio.js` (Web Audio synth + generative music), `art.js` (procedural stars, planets, portraits, event scenes), `render.js` (galaxy and system view), `input.js` (tap, drag, pinch, wheel, keys), `hud.js` (loop, top bar, panels, orders, dialogs, tips), `screens.js` (all full-screen panels), `menus.js` (menus, species creator, saves, end screen)

## Features

- **Time**: days tick in real time with pause, 1×, 2×, 4× (4/8/16 days per second). Monthly economy, start year 3000, game length 120/200/300 years. Events and full-screen panels pause the game.
- **Galaxy**: 120/200/300 stars, four shapes, planar starlane graph with chokepoints, seven star types, 20 body types including moons, asteroid belts, gas giants, garden and relic worlds; deposits for stations; nebulae; five kinds of special systems. Soft territory borders, fog of war, zoom into a system view with orbiting planets, starbases, fleets and battle effects.
- **Empires**: six premade species or build your own (name, body, home world type, procedural portrait, color, 18 traits with a point budget, 8 ethos in opposed pairs, 6 governments). 5–9 AI empires with six archetypes (expansionist, militarist, scholarly, mercantile, isolationist, zealot) that shape research, building, fleets, diplomacy and war.
- **Economy**: energy, minerals, food, alloys, goods, influence, unity and three research streams (Lumen, Vita, Forge). 16 jobs in three strata, 5 district types limited by planet size and type, 24 buildings, building slots that grow with pops, housing, amenities, stability with a full breakdown, unemployment, overcrowding, riots, designations, planet automation, administrative sprawl, deficits with consequences, a galactic market.
- **Exploration and expansion**: surveyors, 23 anomalies and 12 chained follow-ups (folded starlanes, a vault with a weapon inside, a starwhale hatchling that joins your fleet, a counting pulsar, a sleeping shipyard, a plague...), 10 random events with lasting choices (autonomy movements, a galactic exposition, a brain drain...), outposts claimed with influence, mining and research stations, colony arks, habitability by climate.
- **Research**: three cards per stream drawn from 82 techs (tiers unlock as you learn), plus infinite refinements.
- **Traditions, ascension and edicts**: six trees of five traditions with adoption and completion bonuses; twelve permanent Ascension perks, one slot per seven traditions (Mind Lattice, World Forges, Grand Armada, Eternal Vigil, Void Hunters, Trade League, Wake Resonance...); repeatable Legacy Works; nine timed edicts.
- **Military**: four hulls with weapon/defense/utility slots, 25 components (kinetic beats shields, beams beat armor, missiles ignore evasion but meet point defense), auto-design or manual designer, fleet command limit and naval capacity, merge/split/refit/stance, starbases with four levels and five modules, day-by-day combat with retreat and morale, starbase capture, bombardment, three army types and ground invasion.
- **Diplomacy**: first contact, opinion with reasons, closed borders (warships and armies may not enter another empire's space without an Open Lanes treaty, an alliance or a war; civilian ships always may), non-aggression pacts, research agreements, trade pacts, defensive alliances, gifts and insults, war with three war goals, war exhaustion, white peace / demand surrender / concede, AI offers to the player.
- **Other actors**: roaming voidmoths, guardians (the Old Sentinel, the Mother of Storms, crystal tenders), scavengers, native civilizations to observe, uplift or invade, and the Hollow Choir: a mid-game crisis from the galactic rim that hollows worlds until its Spires fall.
- **Victory**: conquest (last empire standing, or hold more than half of all homeworlds for 5 years), Wake Beacons (research Wakefield Theory, hold three Beacon systems with Keeps for 15 years; Beacon Keeps do not use starbase capacity), or score at the end date. End screen with score, pops, systems and fleet charts.
- **The Convergence**: at 70% of the game length the Beacons flare. Every empire gets an event, two attuned Beacons are enough to start a vigil (15 years), three finish it in 9, dominion takes 3 years, and AIs start contesting Beacons: they claim free Beacon systems first, declare war on any empire holding two or more, and gang up on whoever has a victory countdown running.
- **Victory race** (trophy button on the map): your Beacons (owned, attuned, needed), homeworlds held against the number needed, your score rank, the rival closest on each path and every running countdown. A banner under the top bar shows the Convergence and any vigil or dominion in progress, in gold when it is yours.
- **Great Projects** (Empire → Projects): seven multi-stage works paid stage by stage, each unlocked by a technology. Sun Lattice (+20% energy, +10% minerals), Archive of Echoes (+15% research, +10% unity), Halo Habitat (a ring of cities around the capital: +30 housing, +5 amenities, +3 building slots, +15% growth), Wake Arch (a permanent starlane from the capital to your farthest system, +10% ship speed), and three unique in the galaxy that only the first builder can claim: Skyward Bastion (+50% starbase strength, naval capacity, fleet command), Resonance Spire (Beacons count without Keeps, vigil 3 years shorter) and the Silencing Bell (only during the crisis: +75% damage against the Hollow Choir). Each finished project is worth 40 score. AIs build them by archetype.
- **First goals** (flag button, first 12 years): ten steps through the first decade (research in all streams, survey 12 systems, own 5 systems, build on the capital, a second colony, a tradition, contact, a treaty, 10 warships, a starbase module), each with a hint and a small reward paid the month it is reached.
- **Saves**: autosave every 3/6/12 months (three rotating slots), five manual slots, export/import as text (LZW-compressed, `starwake.` key prefix).
- **Sound**: synthesized effects and generative ambient music that darkens in wartime, both switchable.

## Playing on a phone: one-tap orders

- The system panel offers **Claim system**, **Survey**, **Study the anomaly**, **Build station**, and a **Colonize** button on every habitable world: the nearest free (or automated) ship goes, or one is queued at the nearest shipyard and sets out by itself when launched.
- The Outliner lists the best **Worlds you could settle**. Constructors cycle *Automate: off → stations → expand + stations*. New colonies are automated by default (Settings → Gameplay).
- Toasts let taps fall through to the map; their › button jumps to the system or the right screen (research, traditions, diplomacy). A tap on a star's core always selects the star rather than a passing fleet.
- Alerts warn about hostile fleets in your space, a hostile neighbor whose fleets outmatch yours, piling energy or influence, free edict slots and Ascension perks. Shipyards queue warships five at a time; the market trades in lots up to 1000.
- Homeworlds are fortresses (double garrison and +4 armies, +60% home starbase), and AI empires give a human ten more peaceful years than they give each other.
- A human starts with two constructors. For the first 15 years AIs do not claim systems within one jump of a human's borders, so free land next to you stays yours to take.
- When Open Lanes or an alliance ends, or a war ends in peace, warships left inside the other side's closed borders are pushed out to the nearest system they may hold, with a message.

## Rendering

The galaxy's static layer (glow, blurred soft territory borders, lanes, empire-tinted lanes, stars, markers, names) is drawn into an offscreen canvas twice the screen size and reused while panning; it is rebuilt only when the zoom settles or the map changes. Text uses outlines instead of shadow blur, and fleet power is cached per day for drawing. Measured in headless Chromium at DPR 3 on a large galaxy at year 60, panning with rasterization forced each frame: 5.8 / 6.6 / 9.5 ms per frame at far / mid / close zoom, against 10.8 / 18.9 / 17.0 ms for the previous renderer. Battles show glowing beams with white cores, kinetic tracers, missile trails, muzzle flashes, shield-impact arcs and explosion sparks; stars in the system view have slow corona rays and starbases show docking arms and gun platforms.

## Balance (`balance.mjs`, all-AI, 200 years, small and medium galaxies alternating)

| Archetype | Before (48 games, previous release) | After (64 games) |
|---|---|---|
| Expansionist | 35% (46% on small maps) | 19% |
| Mercantile | 19% | 23% |
| Isolationist | 4% | 20% |
| Militarist | 19% | 14% |
| Zealot | 19% | 14% |
| Scholarly | 4% | 9% |

- Victories after: 46 score, 10 Wake Beacons, 8 conquest. Conquest wins now come in years 121–149 (before: 34, 41, 58, 70, 81, 88, 178).
- About 29 wars and 29 peace deals per game; the Hollow Choir is defeated in 40 of 64 games.
- What changed: AIs of every archetype run two constructors after year 5 and two colony arks after year 8, with the same influence reserve; the expansionist archetype is Frontier + Devout under an Open Assembly and no longer favors the Fertile trait; Frontier grants +5% growth; administrative sprawl raises research and tradition costs 0.9% per point; homeworlds are fortresses; Insular gives +10% minerals and alloys; isolationists and scholars expand a little more; the Lattice of Minds gives +12% research; score counts pops ×1.2 and technologies ×5.

## Tests

- `test-engine.mjs`: 12 galaxies (3 sizes × 4 shapes) connected with capitals and beacons; player commands (districts, buildings, surveys, research, warships, market, traditions, edicts, custom designs); closed borders and Open Lanes; ascension perks and their slot limit; one-tap colonization that queues an ark and sends it on launch; Great Projects (stages, unique claims), first goals and their rewards, the Convergence shortening dominion, fleets pushed out when access ends; a scripted war (declare, disable starbase, bombard, invade a fortified homeworld with 30 legions, peace); two full 200-year AI games; save/load round trip; determinism.
- `test-ui.mjs` (62 checks): menu and the ◂ All games link, help, settings, species creator, new game, 44px tap targets, no horizontal overflow, play/pause, tap a star, drag and pinch, system view and planet tap, constructor orders and move mode, one-tap Claim system, every screen (outliner, planet, buildings, research, empire tabs including Ascension perks and beginning a Great Project, the victory race and first goals dialogs, diplomacy including Open Lanes, designer, starbase, log), an event dialog that pauses the game, manual save and load, export/import code, thirty years of play, end screen with charts, no page errors.
- `playtest.mjs`: a scripted human (research, traditions, one-tap claims and colonies, capital buildings, five-ship batches) plays 40 years through taps only, then reports its empire, taps per action, red toasts and blocked taps.
