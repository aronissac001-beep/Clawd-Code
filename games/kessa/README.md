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
  the **Resonance Array** (2500) and, finally, the **Independence buyout** (3000/6000/10000), now a fifth Independence condition.
  Returning rockets always carry exports; without 5 local fuel the sponsor refuels them and keeps 25%.
- **Advisor** (`advice.js`, the 💡 button): shortage forecasts (tank hours, ice left under drills, a day/night power budget with a battery
  count), homes, jobs, food, materials, storage, funding, stranded buildings, sites without drones, contracts, and "what to build next",
  each with a shortcut (Build, Add module, Connect to grid, Send Crawler, Show, Decide, open a screen).
  Ark launches now check air, water, food and beds for the newcomers and say exactly what blocks a launch.
- **Warnings never say all is well while people are in danger.** The advisor's first section is read straight from domes and colonists'
  health (domes short of air, water or power now, with hours to the first death and the likely cause; starvation; poor health), and a red
  ⚠ chip appears in the HUD. Planned or unfinished buildings only change the wording of a shortage, never hide or soften it. The engine also
  logs a warning half a sol before a populated network's tanks run dry and when food runs out. "Things look steady" appears only when
  nobody is ailing. (In 1.1 work-in-progress, planned sites could mask shortages and colonists died while the advisor said "steady".)
- **Upkeep fallbacks**: when a building's upkeep material runs out, drones improvise with another at a worse rate
  (sinter ↔ metals at 2x, then parts; polymers, parts and electronics via parts or metals), so one exhausted deposit no longer collapses a colony.
- **Colony decisions** (`events.js`): 13 events with two choices each (costs in funding, parts, food, sanity, confidence; some permanent bonuses).
- **The Choir of the Wardens**: a mystery across the game. Three Warden or signal finds unlock the Warden Harmonics breakthrough, which reveals
  the Choir; a day-long investigation there unlocks the Resonance Array (+25% research, +8 morale) and the story's end.
- **Fewer tedious moments**: buildings placed away from the grid get cable and pipe planned automatically (toggle "Auto-link"); stranded
  buildings offer Connect to grid; extractors open on the nearest usable deposit and the ghost hops to the next free spot after each placement;
  surveys and research continue automatically when their queues run dry (both toggleable); live panels no longer re-render under your finger;
  toasts no longer block taps on open panels; the water panel finds the nearest free ice; the lander battery holds 80.
- **Visual life**: colonists walk between home and work at shift changes, static lightning in dust storms, auroras on some nights,
  rocket contrails, Orbital Mirror and Resonance Array art, the Choir's ring of pillars, status badges that stay readable zoomed out.

## Version 1.2: fairer curve, job control, a guided start, the Halcyon sleepers

- **A fairer difficulty curve without a funding glut.**
  - **Exports for any surplus** (Rockets → Exports): choose per good whether to keep it or sell what is above 200 / 100 / 30, or everything.
    Rare metals and Kessite always fetch full price. Made goods (parts, metals, sinter, polymers, electronics, fuel, food) flood the
    market: each sale lowers that good's price, which recovers about 8% a sol. So industry can earn a living, but not unlimited money.
  - **Empty pickup runs**: when about 300 funding of exports is waiting and the fleet is idle, a rocket flies out to collect it (toggle).
  - **Sponsor advance** (Rockets → Sponsor): 600-1000 funding now, repaid at 125% over 20 sols out of later stipends; one at a time,
    costs a little confidence. The advisor offers it when supplies are critical and the coffers are empty.
  - **Upkeep forecast**: material warnings fire when parts, metals, sinter, polymers or electronics will run out within 5 sols, not only
    when they are nearly gone, and say how much upkeep alone needs. If the maker exists but has no workers, the advisor says so and offers
    "High priority". Resource panels show upkeep per sol and export price.
  - The advisor points at the Charter of Kessa once the colony is established, and at the buyout once everything else is in place.
- **Control over work, without micromanagement.**
  - Per-dome **work focus** (dome panel: Any, Life support, Food, Industry, Science, Services): residents fill that kind of job first.
  - **Choose job / Move home / A sol off** on every colonist card. A chosen job or home sticks (📌) until you let them choose again.
  - The colonist list opens with **problem cards**, each with one-tap fixes: unemployed people per dome (move them to a dome with open jobs
    and beds, open night shifts nearby, add a workshop), the homeless (add Living Quarters or Apartments where there is room), the unhappy
    (the main cause, the service most of them miss, and a button to add it), and who is leaving. Rows show the cause of low morale.
- **Guided first colony** (on by default for a new colony; "Guided first colony" on the new-colony screen, Settings → Tutorial tips):
  13 numbered steps covering drones and their range, power and batteries, sinter, ice and air, tanks, the first dome and its modules,
  research, the first ark, industry and the long game. The next thing to tap pulses (tab, category, building card, Place here, Done, Pick
  best, Launch), and **Show me** starts the step for you (opens the drone layer, starts placement on a good spot, opens the dome's module
  list). Steps complete themselves from colony state; Skip and End guide are always there.
- **The Halcyon sleepers**, a second mystery: two probe wrecks or buried caches carry the insignia of a survey ship that landed a crew
  forty years ago. Recorder Forensics (breakthrough) marks Halcyon Camp on the map; the Pathfinder finds a cryo vault there; the
  **Revival Vault** (Science) wakes 12 seasoned colonists who cost no Earth payroll, and heals everyone faster.
  (Stray rings of pillars rolled by the map generator now count as Wardens, so they no longer skip the Choir story.)
- **After Independence: Free Kessa.** Keep playing and the Goals screen lists five new goals (a city of 250, 50 births, both mysteries,
  all three wonders, the Great Storm), each worth 250 score. Six sols after independence the **Great Storm** arrives: a four-sol,
  planet-wide dust storm with 48 hours' warning. Lose anyone and another front forms 30 sols later.
- **Night and storms**: buildings without power go dark at night, so blackouts are visible at a glance; lights come on in dust storms;
  red beacons blink on hubs, masts, the lander and the Spire; rolling walls of dust drift across the view in storms.

## Latest test results

- Bot balance over 200 sols (8 Frontier, 5 Brink, 3 Settled games; the test bot follows the advisor's material, water and food warnings,
  sells surplus and takes advances in emergencies):
  - Before 1.2: Frontier 3/8 won (1 lost, 4 stalled), Brink 0/5 won (4 lost), Settled 3/3 won.
  - After: Frontier 6/8 won (sols 95-158, none lost, 2 still growing with every goal but the buyout met), Brink 1/5 won (sol 124, 4 lost),
    Settled 2/3 won (sols 85 and 103; the third met every goal by sol 200).
  - Funding stays tight: mid-game balances mostly under 3000; peaks of 6-11k only while saving for the buyout.
- `test-engine.mjs 6 110`: data, 24 maps, 6 bot colonies on Frontier for 110 sols, the winnable run, disasters, save/load and determinism,
  the economy, contracts, events, both mysteries, exports and market recovery, pickup runs, the advance, job pins, dome focus,
  the people summary, Free Kessa goals and the Great Storm, and the four "danger" scenarios: 679 checks, all passing; the winnable run reaches Independence on sol 97.
- `test-ui.mjs`: 86 checks (menu, new colony, the guided start, tap placement, lines, time, every panel and tab, exports, the advance,
  choosing a job, problem cards, dome focus, survey, vehicles, rockets, saves, export/import, advisor, decisions, contracts,
  Connect to grid, the danger chip, overflow and 44 px targets, no page errors or network requests).
- Built page: about 420 KB; frame time 14-19 ms by day and 24-26 ms in a dust storm at night (headless Chromium, 390x844 at 3x).
