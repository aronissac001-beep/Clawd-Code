# Kessa Colony

A survival colony builder for iPhone Safari (and desktop browsers), shipped as one self-contained HTML file.
Land robots on Kessa, a cold, dusty exoplanet with two percent oxygen, build power and life support,
bring colonists into glass domes, and grow the settlement until it can declare independence from its sponsor.

- Play file: `docs/kessa/index.html` (generated, do not edit by hand)
- Source: `games/kessa/src` (the engine has no DOM access and runs headless in Node)

## Commands

```
node games/kessa/tools/build.mjs                 # syntax-check every file, inline src into docs/kessa/index.html
node games/kessa/tools/test-engine.mjs [n] [sols] # data checks, 24 maps, n bot colonies for `sols` sols (default 6 x 110), disasters, saves, determinism
node games/kessa/tools/test-ui.mjs [shotDir]      # drives the page at 390x844 with touch; optional screenshot directory
```

`test-ui.mjs` needs Playwright with Chromium already installed (`require('playwright')`).

## Layout

- `src/engine/` pure simulation, deterministic (seeded sfc32 RNG saved with the game), 1 tick = 1 game hour, 24 ticks = 1 sol
  - `core.js` RNG, value noise, helpers · `data.js` resources, buildings, dome modules, sponsors, commanders, traits, cargo
  - `tech.js` 56 techs in 5 fields plus 12 breakthroughs · `mapgen.js` heightmap, craters, ridges, deposits, anomalies
  - `game.js` state, modifiers, placement, lines, networks, research and survey actions
  - `sim.js` the hourly tick: power, water and oxygen per network, production, drones, upkeep, surveys
  - `colonists.js` people, needs, homes, jobs and shifts, births, deaths, homesickness
  - `rockets.js` cargo orders, colonist arks, exports · `vehicles.js` rovers, A* pathing, anomalies
  - `hazards.js` dust storms, meteors, cold waves, quakes, system failures · `goals.js` milestones, independence, defeat, score
  - `economy.js` stipend, payroll, confidence, prices, contracts, purchases · `events.js` decisions and the Warden mystery · `advice.js` advisor, auto-connect, ark checks
  - `save.js` JSON with run-length encoded grids; text export `KESSA1:` + base64
- `src/ui/` canvas rendering and DOM UI: `render.js` (terrain cache, world, overlays, lighting, weather, picking), `art.js` (procedural isometric buildings),
  `input.js` (tap, drag, pinch, wheel), `app.js` (loop and time), `hud.js`, `panels.js`, `panels2.js`, `menus.js`, `tips.js`, `audio.js`, `storage.js`, `style.css`
- `tools/` build, tests, and `bot.js`, an automated player used only by the tests. It plays through the same public actions as the UI
  (`place`, `placeLine`, `addModule`, `orderRocket`, `queueResearch`, `moveVehicle`...).

## Design notes

- **Map**: 64x64 tiles, 8x8 sectors that must be surveyed (queue, Survey Masts, parked Pathfinder, orbital probes). Slopes block building and lines.
  Deposits: metal ore, water ice, rare ore, Kessite crystals, fine regolith, Pale Bloom spore beds, surface metal scatter (mined by drones), and deep deposits revealed by Deep Sounding.
- **Phase 1**: lander (drone hub with storage and a little power), Drone Crawler (mobile hub), Pathfinder (scout), prefabs, sponsor rockets with funding.
- **Grids**: buildings that touch share power and pipes; cables and pipes link the rest. Batteries and tanks store per network. Breaks cut cables; broken pipes leak.
- **Upkeep**: every building wears; drones service it with its upkeep material (metals, sinter, parts, polymers or electronics). Worn buildings run at 60%; fully worn ones break (domes leak air instead).
  Construction keeps a reserve of upkeep materials (editable per resource).
- **Colonists**: age, sex, specialization (engineer, scientist, botanist, medic, warden, geologist), 16 traits, two service wants, health, sanity, comfort, morale.
  Three shifts (night shift costs sanity), housing and 19 dome modules, births, children who grow up (schools give traits), deaths, breakdowns, homesickness.
- **Hazards** escalate with time and difficulty and are announced in advance (longer with a Storm Observatory).
- **Win**: Independence = population target (70/100/130 by difficulty), 25 technologies, Charter Spire, five self-sufficient sols (no shortages, no imported food, parts or metals), and the sponsor buyout (3000/6000/10000 funding). **Lose**: no colonists by the sponsor's deadline, or an empty colony for three sols.
- Saves: localStorage keys `kessa.settings`, `kessa.save.<slot>` and `kessa.save.<slot>.meta` (autosave plus five manual slots), plus text export/import.

## Version 1.1: economy, advisor, decisions, the Wardens

- **Economy that matters all game** (`economy.js`): the sponsor stipend tapers after sol 30 (to 60/50/40% by difficulty) and is scaled by
  **sponsor confidence** (0-100: contracts, milestones, deaths, leavers, debt). Every colonist born at home costs **Earth payroll** each sol.
  Cargo prices inflate over time and each ark costs 4% more than the last. **Sponsor contracts** (rare metal or Kessite shipments, settlement
  quotas, research milestones, births, self-reliance audits) arrive every 10-16 sols with deadlines and rewards. Funding buys
  **research grants** (rising price), **recruiting drives** for a chosen specialization, the **Orbital Mirror** megaproject (2500 funding),
  the **Resonance Array** (1500) and, finally, the **Independence buyout** (3000/6000/10000), now a fifth Independence condition.
  Returning rockets always carry exports; without 5 local fuel the sponsor refuels them and keeps 25%.
- **Advisor** (`advice.js`, the 💡 button): shortage forecasts (tank hours, ice left under drills, a day/night power budget with a battery
  count), homes, jobs, food, materials, storage, funding, stranded buildings, sites without drones, contracts, and "what to build next",
  each with a shortcut (Build, Add module, Connect to grid, Send Crawler, Show, Decide, open a screen).
  Ark launches now check air, water, food and beds for the newcomers and say exactly what blocks a launch.
- **Colony decisions** (`events.js`): 13 events with two choices each (costs in funding, parts, food, sanity, confidence; some permanent bonuses).
- **The Choir of the Wardens**: a mystery across the game. Three Warden or signal finds unlock the Warden Harmonics breakthrough, which reveals
  the Choir; a day-long investigation there unlocks the Resonance Array (+25% research, +8 morale) and the story's end.
- **Fewer tedious moments**: buildings placed away from the grid get cable and pipe planned automatically (toggle "Auto-link"); stranded
  buildings offer Connect to grid; extractors open on the nearest usable deposit and the ghost hops to the next free spot after each placement;
  surveys and research continue automatically when their queues run dry (both toggleable); live panels no longer re-render under your finger;
  toasts no longer block taps on open panels; the water panel finds the nearest free ice; the lander battery holds 80.
- **Visual life**: colonists walk between home and work at shift changes, static lightning in dust storms, auroras on some nights,
  rocket contrails, Orbital Mirror and Resonance Array art, the Choir's ring of pillars, status badges that stay readable zoomed out.

## Latest test results

- `test-engine.mjs 6 110`: 605 checks passed, 0 failed (24 maps; 6 bot colonies across 4 sponsors and 6 commanders all alive after 110 sols on normal with
  77 to 167 colonists, about 30 disasters each and no deaths; one reached Independence on sol 105; the fixed winnable run reaches Independence on sol 91).
  In a separate batch of eight 200-sol bot games, six won Independence between sol 91 and 130, two stalled and one bot colony was lost, so the game can be both won and lost.
- `test-ui.mjs`: 64 checks passed, 0 failed (menu, new colony, tap placement with confirm, cable line, time controls, every panel and tab, survey, vehicles, rockets, save/load, export/import, Continue, overflow and 44 px targets, no page errors or network requests).
- Built page: about 310 KB.
