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
- **Exploration and expansion**: surveyors, 19 anomalies and 11 chained follow-ups (folded starlanes, a vault with a weapon inside, a leviathan hatchling that joins your fleet, a plague...), 7 random events, outposts claimed with influence, mining and research stations, colony arks, habitability by climate.
- **Research**: three cards per stream drawn from 82 techs (tiers unlock as you learn), plus infinite refinements.
- **Traditions and edicts**: six trees of five traditions with adoption and completion bonuses, repeatable Legacy Works, nine timed edicts.
- **Military**: four hulls with weapon/defense/utility slots, 25 components (kinetic beats shields, beams beat armor, missiles ignore evasion but meet point defense), auto-design or manual designer, fleet command limit and naval capacity, merge/split/refit/stance, starbases with four levels and five modules, day-by-day combat with retreat and morale, starbase capture, bombardment, three army types and ground invasion.
- **Diplomacy**: first contact, opinion with reasons, non-aggression pacts, research agreements, trade pacts, defensive alliances, gifts and insults, war with three war goals, war exhaustion, white peace / demand surrender / concede, AI offers to the player.
- **Other actors**: roaming voidmoths, guardians (the Old Sentinel, the Mother of Storms, crystal tenders), scavengers, native civilizations to observe, uplift or invade, and the Hollow Choir: a mid-game crisis from the galactic rim that hollows worlds until its Spires fall.
- **Victory**: conquest (last empire standing, or hold more than half of all homeworlds for 5 years), Wake Beacons (research Wakefield Theory, hold three Beacon systems with Keeps for 18 years), or score at the end date. End screen with score, pops, systems and fleet charts.
- **Saves**: autosave every 3/6/12 months (three rotating slots), five manual slots, export/import as text (LZW-compressed, `starwake.` key prefix).
- **Sound**: synthesized effects and generative ambient music that darkens in wartime, both switchable.
