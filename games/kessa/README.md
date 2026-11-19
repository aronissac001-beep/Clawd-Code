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
- `src/ui/` canvas rendering and DOM UI: `render.js` (terrain cache, world, overlays, lighting, weather, picking), `art.js` (drawing primitives and the building catalogue), `art2.js` (domes, construction, damage, vehicles, rockets, people, deposits, the sprite cache),
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
- **Win**: Independence = population target (70/100/115 by difficulty), 25 technologies, Charter Spire, five self-sufficient sols (no shortages, no imported food, parts or metals), and the sponsor buyout (3000/6000/4500 funding). **Lose**: no colonists by the sponsor's deadline, or an empty colony for three sols.
- Saves: localStorage keys `kessa.settings`, `kessa.save.<slot>` and `kessa.save.<slot>.meta` (autosave plus five manual slots), plus text export/import.

## Version 1.1: economy, advisor, decisions, the Wardens

- **Economy that matters all game** (`economy.js`): the sponsor stipend tapers after sol 30 (to 60/50/40% by difficulty) and is scaled by
  **sponsor confidence** (0-100: contracts, milestones, deaths, leavers, debt). Every colonist born at home costs **Earth payroll** each sol.
  Cargo prices inflate over time and each ark costs 4% more than the last. **Sponsor contracts** (rare metal or Kessite shipments, settlement
  quotas, research milestones, births, self-reliance audits) arrive every 10-16 sols with deadlines and rewards. Funding buys
  **research grants** (rising price), **recruiting drives** for a chosen specialization, the **Orbital Mirror** megaproject (2500 funding),
  the **Resonance Array** (2500) and, finally, the **Independence buyout** (3000/6000/4500), now a fifth Independence condition.
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

## Version 1.2.1: design and style pass

Visual quality only; no rules or balance changed.

- **Design system** (`src/ui/style.css`, top of file):
  - Colour tokens: basalt surfaces `--s0`–`--s4`, three ink levels (all at least 4.9:1 on every surface), dust amber for actions, frost cyan for information, and good/warn/bad signals with their own tinted backgrounds.
  - Type scale 11 / 12.5 / 14 / 15.5 / 18 / 22 / 34, with tabular numbers wherever values change.
  - Spacing 4 / 8 / 12 / 16 / 24, radii 8 / 12 / 16 / 22, and three elevation levels.
  - One style each for buttons (primary, toggle on, danger), segmented controls, pill tabs, cards, list rows, chips, status pills, section labels and progress bars.
  - Every tap target is at least 44 px.
- **Drawn icon set** (`src/ui/icons.js`): about 70 stroke icons on a 24-unit grid. They replace emoji and mixed glyphs for:
  - resources, bottom tabs, building categories, specialists, services and modules;
  - hazards, advisor severity, research fields and controls.
  - `drawIcon` paints the same icons onto canvas for scene art.
- **Screens and panels:**
  - **Main menu:** new title art (mesas, aurora, a lit settlement, frost) and a clear button hierarchy.
  - **New colony:** sponsor and commander cards with colour emblems.
  - **Sheets:** a grabber, a kicker line and an icon or portrait in the header. Building and module panels show a drawn portrait.
  - **Life support and recipes** show as icon values.
  - **People:** colonist rows have specialist avatars.
  - **Advisor:** items carry severity badges.
  - **Decisions and the end screen:** an illustrated header and choice cards.
  - **Top bar:** a single speed control, and resource chips with drawn icons and colour-coded deltas.
  - **Bottom tabs:** drawn icons with an amber marker on the active tab.
- **Map:**
  - Warmer dust and cooler frost.
  - Deposits drawn as crisp tile footprints instead of soft blurs.
  - More baked grain and pebbles for close zoom.
  - Soft contact shadows that follow the sun.
- **Faster lighting:** lamp glows and beacons come from cached sprites, and the dust-storm front is a single band. Storm nights are back near the 1.1 frame times.
- **Motion:** sheets slide up, dialogs pop, toasts and the guide slide in, buttons press, and funding and population flash when they change. All motion switches off under `prefers-reduced-motion`.

## Version 1.3: close-up art, emergencies, the Colony Council

- **Buildings redrawn for full zoom** (`src/ui/art.js`):
  - **One light and one set of materials everywhere:** lit tops, mid left faces, dark right faces, bright front edges and ground pads with a raised edge. The renderer passes a level of detail, so panel seams, hazard corners, bands on tanks and cylinders, ladders, truss bracing and plant rows appear only when zoomed in.
  - **Moving parts:** turbines with tapered blades and nacelles turn; fans spin on air synthesizers, condensers and generators; the hub's dish sweeps; head-frame wheels turn on extractors; the sinterer's conveyor moves; ice drills bob.
  - **Steam and dust** rise from drills, condensers, stacks, kilns and refineries while they work.
  - **Night:** windows light up at night and shine through the dark tint; beacons blink; turbines carry red tip lights.
  - **Domes:** colonists inside are small figures with heads and shadows, more of them at close zoom.
- **Glyphs become icons:** every text built through the UI (log, toasts, panels, costs) shows the drawn icon set instead of the old text glyphs (⛓ ▦ ⚙ ¤ …).
- **Emergencies, with real costs** (the advisor offers them as soon as they would help, and the bot uses them):
  - **Oxygen candles:** 6 fuel and 4 polymers give +2.6 oxygen an hour in every inhabited dome for 24 h.
  - **The lander shelter:** the 12 most at-risk residents of failing domes wait out 2.5 sols in the lander. They are safe but cannot work, and their sanity falls. The shelter then needs 15 sols to restock.
  - **Rationing:** half the water per person and 30% less food, at a cost in sanity and comfort.
  - **The sponsor's emergency drop:** 16 parts, 25 metals and 25 sinter at once, even in debt. It costs 450+ funding and confidence, and can be called every 20 sols.
  - **Earlier forecasts:** a HUD chip counts down when air or water will run out within 30 h. The advisor warns when worn life support has no upkeep material left (with hours until it breaks), and when a coming dust storm will empty the water tanks.
- **Brink, retuned to be hard but fair:**
  - Upkeep is ×1.15 instead of ×1.25.
  - Payroll is 0.35 per colonist from home instead of 0.45.
  - Independence needs 115 colonists instead of 130 and a 4500 buyout instead of 10000. The sponsor's stake in a Brink colony is smaller, while hazards (×1.5), thin funding (×0.8) and the 40-sol patience stay.
  - The advisor no longer tells you to raise the priority of a broken or switched-off factory, and it says so when no dome is close enough to staff it.
- **The Colony Council** (People → Council), from 25 colonists:
  - **Three factions,** with members by specialization: the Hearth (families, farmers, the Kessa-born), the Forge (engineers, miners) and the Lantern (scientists, medics).
  - **Demands with deadlines:** new services, beds, closing night shifts, parts, exports, a new factory, technologies, surveys, anomalies.
  - **Support:** meeting a demand raises support (+16); failing (−14) or refusing (−8) lowers it, and support drifts back towards 50.
  - **Above 65 a faction grants a perk:** comfort and births; factories and mining; or research and healing.
  - **Below 25 it protests** with the matching penalty. Demands compete for the same workers and materials, so whom to please is a real choice.
- **Phone ergonomics at 375 px** (iPhone mini, SE):
  - The build and research tabs are compact icon grids.
  - Filter and specialization rows wrap.
  - Every tab button is 44 px.
  - The clock is shorter.
  - The UI test now opens every sheet at 375 px and checks that tab rows fit, nothing overflows, and targets stay at 44 px.

## Version 1.3.1: art pass

Visual assets only: no rules or balance changed.

- **Terrain** (`render.js`, built once per map):
  - **Ground types:**
    - Dust plains carry faint wind streaks.
    - Rock fields and highlands are strewn with faceted boulders.
    - Basalt breaks into a network of cracked plates.
    - Frost flats are bright patches with blue edges and glints.
    - Dunes have paired lit and shaded ripple crests.
    - Highlands and steep ridges show contour strata.
  - **Transitions:** ground types meet along noisy, fairly crisp borders instead of soft smears.
  - **Shading:** slopes are shaded more strongly, and convex ground catches light while hollows darken.
  - **Craters** read at a glance: the far wall of the bowl is lit and the near wall is in shadow, the rim catches the sun, boulders are scattered around the rim, and the largest craters throw pale rays.
  - **Close-up grit:** at close zoom, fine grit is drawn on the visible tiles so the magnified ground stays crisp.
- **Deposits** each have their own look:
  - metal ore as grey chunks with glints;
  - water ice as cracked pale sheets;
  - rare ore as violet crystal clusters;
  - Kessite as tall pink crystals that glow;
  - regolith as soft mounds;
  - scrap as twisted plates and rods;
  - Pale Bloom as swaying spore pods.
  The claim area is a soft colour wash with a dashed edge until something mines it.
- **Anomalies** stand under a column of light with a dashed ground ring.
- **Survey fog:** unsurveyed sectors get a hatch texture, with a soft shadow and a dashed line where they meet surveyed ground.
- **Buildings:** every building now has its own silhouette at every zoom.
  - **New designs:** the Thermal Beacon, Static Brush Tower, Meteor Lance, Drone Assembler, Crystal Cell, Kessite Harvester, Resonance Array, Revival Vault, Isotope Reactor, Rare Ore and Auto-Extractors, Water Reclaimer, Algae Reactor, Polymer Plant, Circuit Foundry, Bloom Garden, Storm Observatory and Deep Institute.
  - **Light and materials:** the same light direction and the same material palette are used everywhere.
- **Domes:** domes are taller, with a geodesic frame that gets finer at close zoom. Inside are a lawn, a paved ring, a plaza, modules with roofs and lit windows, trees, and people.
- **Construction:**
  - **Stages:** the footprint is taped out and the building rises from the ground inside scaffolding as work progresses. A tower crane swings over larger sites, with welding sparks at the top of the work.
  - **States:**
    - Broken buildings are scorched and cracked, with smoke, sparks and a red warning light.
    - Switched-off buildings are greyed out and their machines stand still.
    - Buildings without power are dimmed and blink an amber light.
- **Units:**
  - **Rovers** have six wheels, a cab, a solar deck and an antenna light. They face the way they drive and kick up dust.
  - **The crawler** runs on tracks and carries a drone bay, a raised cab and a turning beacon.
  - **Drones** are small quadcopters whose status light shows the job.
  - **Colonists** walk in pressure suits with helmets and packs, and carry headlamps at night.
  - **Rockets** have fins, a window, landing legs near the ground, a flickering flame, an engine glow and a cloud of dust from the pad.
- **UI:**
  - **Empty states:** they now show a small scene drawn with the map art, a title, a hint and, where useful, a button that goes there. This covers no colonists, no domes, no council yet, no contract and an empty log filter.
  - **Build cards:** each card opens with a banner showing the building as it looks on the map.
  - **Icons:** every line icon now has the same stroke weight at every size.
  - **Sheet headers:** the building portraits in sheet headers use the same art as the map.
- **Performance (sprite cache):** below zoom 2.2, each building's static parts are drawn once per zoom bucket, state and night/day into a sprite.
  - Sprites are trimmed to their content and kept within a pixel budget, oldest first out.
  - Moving parts are drawn on top every frame.
  - Lit windows are recorded with the sprite so they still shine through the night tint.
  - Up close, and for sprites that would be larger than about 3 megapixels, buildings are drawn directly.
- **Tests:** the 375 px check in the UI test now waits for sheet animations to finish before measuring. On a heavily loaded machine it had once measured a sliding close button at 43.99 px.

## Latest test results

- Bot balance over 200 sols, version 1.3 (8 Frontier, 5 Brink, 3 Settled games; the test bot follows the advisor's material, water,
  food, emergency and council prompts, sells surplus and takes advances in emergencies):
  - Frontier 6/8 won (sols 109-176, none lost; the other two alive at 99 and 116 colonists).
  - Brink 2/5 won (sols 136 and 183, none lost; the other three alive but small and in debt). One of the wins lost 51 colonists to a
    single suffocation crisis on the way, so Brink still punishes a slow response to a life-support failure.
  - Settled 3/3 won (sols 96-162).
  - For comparison, 1.2.1: Frontier 6/8, Brink 1/5 (4 lost), Settled 2/3.
- `test-engine.mjs 6 110`: data, 24 maps, 6 bot colonies on Frontier for 110 sols, the winnable run, disasters, grid repair, save/load
  and determinism, the economy, contracts, events, both mysteries, exports and market recovery, pickup runs, the advance, job pins,
  dome focus, the people summary, Free Kessa goals, the Great Storm, the four "danger" scenarios, emergencies (candles, shelter,
  rationing) and the council: 691 checks, all passing. The winnable run reaches Independence on sol 109.
- `test-ui.mjs`: 90 checks (menu, new colony, the guided start, tap placement, lines, time, every panel and tab including the council,
  exports, the advance, choosing a job, problem cards, dome focus, survey, vehicles, rockets, saves, export/import, advisor, decisions,
  contracts, Connect to grid, the danger chip, overflow and 44 px targets at 390 px, ten sheets checked at 375x667 for tab rows that fit,
  no overflow and 44 px targets, no page errors or network requests): all passing.
- Built page: about 491 KB. Frame time (headless Chromium with software rendering, 390x844 at 3x):
  - Small colony: 8-12 ms by day and 9-16 ms in a storm at night, at every zoom.
  - 389-building colony: 21-25 ms by day and 22-28 ms in a storm at night. Close zoom at night is the slowest case because of the lit windows.
