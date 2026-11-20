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
node games/kessa/tools/soak.mjs [sols] [seed]     # long-run soak: one bot colony for 420 sols, past Independence and through Reshaping Kessa
node games/kessa/tools/balance.mjs [diff] [from] [to] # bot balance: seeds e-<from>..e-<to-1> for 200 sols (normal 0-8, hard 0-5, easy 0-3)
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
  - `economy.js` stipend, payroll, confidence, prices, contracts, purchases · `politics.js` the council · `assembly.js` the Colony Assembly · `terra.js` Reshaping Kessa · `events.js` decisions and the four mysteries · `world.js` rival colonies, the race, trade, remote sites and expeditions (its own random stream) · `rail.js` the monorail: track networks, trains, commuting, shared drones, freight · `advice.js` advisor, auto-connect, ark checks
  - `save.js` JSON with run-length encoded grids; text export `KESSA1:` + base64
- `src/ui/` canvas rendering and DOM UI: `palette.js` (the one colour palette and the scene colour grades), `render.js` (terrain cache, world, overlays, lighting, weather, picking), `art.js` (drawing primitives and the building catalogue), `art2.js` (domes, construction, damage, vehicles, rockets, people, deposits, the sprite cache), `art3.js` (the Expedition Pad and its skimmer, Rail Stations, the guideway and trains, the three 2.1 wonders),
  `input.js` (tap, drag, pinch, wheel), `app.js` (loop and time), `hud.js`, `panels.js`, `panels2.js`, `menus.js`, `world.js` (the World tab and its drawn map, the station and pad panels), `tips.js` (the guide and the intros), `audio.js`, `storage.js`, `style.css`
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

## Version 2.0: Reshaping Kessa and the Colony Assembly

- **Reshaping Kessa** (`src/engine/terra.js`; Goals → Reshaping):
  - **Four planet gauges:**
    - **Veil:** how thick the air is.
    - **Warmth:** how far the long cold has lifted.
    - **Water:** open water and vapour.
    - **Verdure:** living cover.
  - **What raises the gauges:**
    - **Haze Forge:** Warmth +0.35 and Veil +0.25 a sol.
    - **Lichen Spreader:** Verdure +0.35 a sol once Warmth reaches 15 and Water 10.
    - **Seed Ark** (unique): every spreader works 60% faster.
    - **Lodestone Ring** (unique): the Veil stops leaking away.
    - **Orbital Mirror:** Warmth +0.3 a sol.
    - **Ice comet strikes:** ordered from the panel after Comet Herding, for funding and fuel. Impact is 4 sols later, far from the colony; it gives Water +6, Veil +2.5 and Warmth +0.8, and cracks nearby grid lines.
    - **Melting frost:** Warmth turns frost into Water.
  - **What lowers them:**
    - Without the Lodestone Ring, the Veil leaks away.
    - Thin air lets heat escape.
    - Lichen dies back in the cold and dry.
  - **Seven stages, each with side effects:**

    | Stage | Effects |
    |---|---|
    | The Thaw | Every ice deposit loses 15%. |
    | Meltwater Lakes | Crater floors flood, and nothing new can be built on the water. Drills on flooded deposits get +50%, condensers +20%, and spore beds appear on the shores. |
    | Lichen Crust | +2 comfort. |
    | First Rain | Condensers +30%, solar −10% under cloud. |
    | Moss Carpets | Farms +10%. |
    | Shrublands | Oxygen makers +15%. |
    | Open Sky | Colonists go outside without suits, Field Farms grow food in the open, domes need 25% less air, morale +5. |

  - **Hazards:** a warmer world has rarer, milder cold waves; a thicker Veil burns up meteors; air and water calm dust storms.
- **The map changes visibly:**
  - The frost recedes to wet ground.
  - Lichen, then moss, then shrubs spread over the plains.
  - Crater lakes fill, with a foam edge and moving glints.
  - The horizon turns from dusty amber to blue as the Veil thickens.
  - Rain falls on wet days, or snow while it is still cold.
  - Under the Open Sky, colonists stroll outside their domes without suits.
  - A drawn globe in the panel shows the frost caps shrinking, seas and green spreading and clouds thickening.
  - **Frame time:** the terrain bitmap, lakes included, is rebuilt only when the look changes, about a dozen times in a whole game; only the glints are drawn each frame. Reshaped frames cost about the same as unreshaped ones.
- **New buildings with their own art:** Haze Forge (kiln stacks rolling ochre haze), Lichen Spreader (rotating sprayer boom), Seed Ark (earth-covered archive with a glass growing house), Lodestone Ring (an upright superconducting ring with field pulses), Field Farm (open crop rows with a turning pivot arm).
- **Research:** five late techs, listed last so the order of the rest is unchanged: Haze Forging, Pioneer Lichens, Comet Herding, Seed Ark, Lodestone Field.
- **The Colony Assembly** (`src/engine/assembly.js`; People → Council), from 60 colonists:
  - **Form of government:** you choose one, and the choice is final. If you don't choose within 5 sols, the Assembly becomes a Commonwealth.
    - **Commonwealth:** the 15 seats follow faction size.
    - **Guild Compact:** the Forge gets half again its share of seats.
    - **Academy Rule:** the Lantern gets half again its share.
    - **Hearth Moot:** the Hearth gets half again its share.
  - **Ten laws in five fields:** Labor, Rights, Research, Economy and Security. Each has a real trade-off, for example Production Drive gives factories +20% but morale −5.
  - **Limits:** at most four laws at once, one per field. The Assembly sits every 4 sols.
  - **Votes:** each faction votes by its stance on the law, shifted by its support, and its seats count. The panel forecasts every vote. Winners gain support and losers lose it.
  - **Political crises:** a faction whose support falls below 30 can walk out and force the repeal of a law it opposes.
  - **Independence now also needs the Assembly's backing:** the seat-weighted mood must be 35 or more. The sponsor answers the declaration according to its confidence: a parting grant of 1500, a cold acceptance, or 1500 clawed back.
- **Tests and tools:**
  - The engine test adds 23 Reshaping checks and 13 Assembly checks.
  - The UI test adds the Reshaping tab (globe, gauges, stages, the comet button and why it is locked), a reshaped map (terrain rebuilt, lakes, Open Sky), the Assembly (government, seats, ten laws, a vote), and 375 px checks of the new tab.
  - `tools/soak.mjs` plays 420 sols. The colony wins, then reshapes Kessa through all seven stages. It checks that the simulation stays fast, the save stays compact, the log and effect queue stay bounded, there are no NaNs, and a late save loads and runs.
  - The bot reshapes only after Independence, so the race to Independence is unchanged.
  - The engine's effect queue is now bounded when no screen is reading it, as in headless runs.

## Version 2.1: rivals, expeditions, the monorail and more stories

- **The wider world** (`src/engine/world.js`; the new **World** tab):
  - **A drawn regional map of Kessa** (`src/ui/world.js`): shaded relief with contour lines, craters, frost at the high latitudes, region names, a compass and a scale. Seas and green spread on it as Kessa is reshaped. Your colony, the rivals and the remote sites are drawn on top, with dashed routes and a moving skimmer for expeditions. Tap anything on it for details.
  - **Two or three rival colonies** (two on Settled), one for each sponsor that is not yours: Vask Landing (freight town), Concord Ring (fast-growing families), Lyceum Station (researchers), Deepcut (canyon miners) and Hope Hollow (poor but tireless). Each founds a dome, takes colonists, researches, suffers storms and breaches, raises a wonder and in time declares independence.
  - **The race:** seven milestones (first dome, 50 and 100 colonists, the first expedition home, 25 technologies, the first wonder, the first free colony). Whoever gets there first takes it; your sponsor pays a prize (250-550) and gains confidence, and loses a little confidence when a rival wins. The **rivalry board** compares population, domes and technologies, and each open race shows who leads.
  - **Trade:** every 5-9 sols a rival offers to sell goods (parts, electronics, metals, research...) for funding, to buy your goods, or to swap. Offers last 3 sols. Prices follow each rival's habits and its relations with you; imported food, parts and metals still count against the five self-reliant sols.
  - **Rivalry decisions:** storm damage at a rival (send parts and polymers, or not), recruiters poaching your people, a joint survey, sensor logs for sale, and survivors walking in from a rival's wrecked outpost. Your answers move relations; hostile rivals poach more.
  - **Remote sites and expeditions:** eight kinds of site (derelict freighter, glacier cave, Kessite field, pillar ruins, distress beacon, deep rift, lost supply drop, fresh impact crater). An **Expedition Pad** (Base) launches a skimmer rocket with a crew of the right specialists (stand-ins lower the odds), drones, and for the beacon the Pathfinder. The trip takes 1-3 sols each way plus 1-4 on site and costs fuel. The crew and drones are away for the whole trip. Results: supplies, research, a breakthrough, survivors, relics, or an accident (injuries, lost drones, rarely a death). Rivals send their own crews: whoever works a site first takes it, and distress beacons fade if nobody comes.
  - **Relics:** seven, each with a lasting bonus (research, vehicles, farms, morale, storms, comfort, safer expeditions). Three reveal the third new wonder.
  - The world draws from its own random stream, so the colony's own events, hazards and people are not shuffled by it.
  - The advisor points out waiting trade offers, a distress beacon about to fade and an idle skimmer; the World tab shows a dot while offers wait. Help has new sections on the wider world, expeditions and the monorail.
- **The monorail** (`src/engine/rail.js`):
  - **Rail Station** (Base) and **Monorail Track** (Grids). Tap a station and **Lay track** to another: the route is found for you around buildings, and the guideway rides on pylons, so it crosses steeper ground and water than cables and pipes. Track can also be laid tile by tile.
  - Stations joined by track form a line. Each line runs a train (more for longer lines) that shuttles from stop to stop, waiting an hour at each; a station without power stops its line.
  - **Commuters:** colonists can take jobs within 10 tiles of any stop on a running line that has a stop within their dome's reach, so far mines and a second settlement can share workers.
  - **Shared drones:** drone hubs within 7 tiles of the line's stops lend each other drones.
  - **Freight:** extractors within 10 tiles of a stop ship 15% more, if the line also serves the lander or a depot.
  - **Art:** a concrete guideway on pylons with a running rail and a shadow, glass-roofed stations with a lift tower and signal light, and two- or three-car cream trains with a teal window band, an orange nose, a headlight and lit windows at night (cargo containers ride on when the line carries freight). Planned track is a dashed amber line. Trains move one game hour at a time in the engine and are interpolated on screen.
- **More stories:**
  - **The Bloom Below:** two finds among the fossil bloom beds and warm vents start it. A choice (study the spores or grow them), the breakthrough Mycelial Signalling, the Bloom Heart on the map, and a second choice (commune with it, or harvest its enzymes for the farms). Ends with the Undergrove.
  - **The Ninth Moon:** a fragment falls on a sol set by the map seed. The Pathfinder finds it machined; report it to the sponsor or keep it quiet; Orbital Forensics shows a derelict relay in a decaying orbit; nudge it down gently with fuel or hail it (its capsule then lands hard and cracks lines). Ends with the Skyward Relay.
  - **Three wonders with their own art:** the **Undergrove** (a sunken garden of glowing pale caps under a glass lantern, with drifting spores: food, comfort, calmer minds), the **Skyward Relay** (a guyed lattice tower with a turning crown of dishes and a beam to the ninth moon at night: faster, cheaper rockets, research, warnings) and the **Great Orrery** (bronze rings turning round a glowing sun on a stepped plinth, rebuilt from three relics: research, morale, safer expeditions).
  - **Six new colony events:** a wedding, a workshop feud, a mural, a song of Kessa, a sleepwalker in an airlock, and an old engineer who wants to teach.
  - Goals lists all four mysteries and the relics; three new milestones and two new Free Kessa goals.
- **Intros to the newer systems** (`src/ui/tips.js`): short cards for the world map, trade, expeditions, the monorail, the Assembly and Reshaping Kessa, each shown once when it first matters (after the first-colony guide), with Show me, Got it and No more intros. Settings → Intros to new systems turns them back on.
- **Fixes to 2.0:**
  - **Lakes no longer drown buildings:** buildings that stood on a crater floor before it flooded get an earth levee, drawn as a dry island with a raised rim, and the log says so. Ice drills set into a lake get one too.
  - **The bot uses the Assembly:** it takes a Commonwealth and passes Hazard Wardens, Open Laboratories and Export Quotas when the vote would pass and the Assembly is content, so laws, votes and crises (repeals forced by an angry faction) happen in every long bot game.
  - **The late population fall:** it was not a bug. Colonists age 0.2 years a sol, the founding generation arrived within a few dozen sols, the bot stopped sending arks once it had enough people for Independence, and births need free beds and comfort. A free Kessa now draws **settlers** of its own: every three sols, if there are free beds in domes that breathe, morale is decent and nobody went short, up to 6 people arrive to replace those the colony has lost, until it is back to its largest size so far. The bot also keeps sending arks towards the Free Kessa goal of 250.
- **Balance:** no 2.0 rule was changed for the race to Independence. The bot builds rail and sends expeditions only after Independence (and in the tests), and researches the two new mysteries late, so the 2.1 systems do not slow its race.

## Version 2.2: art, palette and UI pass

Visual quality and small UI fixes only; no rules or balance changed.

- **One palette** (`src/ui/palette.js`, `PAL`): every colour the map, the art, the world map and the HUD accents use is a named token in one place.
  - **Value plan:** the ground sits in dark-middle rust and ochre values, buildings in light bone and pale steel with saturated accents (signal orange, teal) and dark recesses, so the colony separates from the ground at every zoom.
  - **Ground** by terrain type (dust plains, rock field, basalt, frost, dunes, highland), wet ground, lichen, moss and shrubs for the Reshaping stages, and water (deep, mid, shallow, foam, wet sand, sky reflection).
  - **Light:** shadows lean cool violet and lit ground leans warm; cast shadows use one shadow colour.
  - **Materials** (`PAL.mat`, used as `MAT` by all building art), **emissive** colours (windows, lamps, beacons, cyan status lights, headlights, thrusters, dome glow) and **UI accents**, which are mirrored into the stylesheet's custom properties at load.
  - **Colour grades** for day, dusk, night, dust storm and cold wave (`sceneGrade`): a vertical multiply grade, a sky colour and an aerial haze, blended continuously by the sun height, storm severity and cold, so day turns to night without steps.
- **Buildings ("models"):**
  - The shared primitives were rebuilt and every building inherits them: box walls fall from a lit top into contact shadow at the ground (ambient occlusion), tops carry a soft gradient, lit edges get a bevel highlight and the vertical corner a thin light line, walls have paired dark and light panel lines and rivet rows up close.
  - Cylinders (tanks, towers, the lander) have a crisp specular stripe, a dark terminator, a foot shadow, banding with lit edges and a bevelled rim; spheres have a hard glint and warm bounce light underneath.
  - Concrete pads sit in a soft occlusion skirt with a lit front lip.
  - Windows reflect the sky by day and glow warm at night; doors light up at night.
  - **Domes** now look like glass: the far inside wall is tinted, the shell is clear in the middle and thicker at the rim (Fresnel), a sky reflection band crosses the upper left, a specular glint, a warm bounce on the shadow side, a two-tone geodesic frame with nodes up close, a shaded lawn and kerb, and a warm interior glow at night.
  - Solar arrays have a sky sheen and bright frames; batteries a teal band and vents; condensers a tray and manifold.
- **Sprites:** drones have arms, spinning rotor discs, a bone shell with an orange band and red and green navigation lights at night; rockets a polished body, nose cap, shaded fins, a lit porthole, shock diamonds in the plume and a ground glow on lift-off; colonists a shaded suit, a gold visor with a glint and sun shadows; rovers and the crawler cast sun shadows and throw headlight cones on the ground at night.
- **Effects:**
  - **Terrain:** stronger slope light, cool shadows and warm highlights, a low-frequency colour drift, and occlusion on crater floors (all baked, free at run time).
  - **Cast shadows** from every building follow the sun: long and soft at dusk, short at noon, thinned by dust. They are one cached path per sun step (24 steps), drawn with a single fill.
  - **Night lights:** building glows, lamp and beacon lights, vehicle headlights and drone status lights add up in a warm glow pass, with a wide second halo around big lights on Sharp and Balanced; stars over the void at far zoom.
  - **Weather:** a layered dust storm (thick haze, a rolling front, near streaks, blue-white lightning with a glow), auroras as curtains with fine vertical rays, rain and snow in two depths, and a frosted, cracked rim of the view in a cold wave.
  - **Water:** crater lakes have a wet-sand shore, deep-to-shallow colour, the sky reflected on the far half, a far-shore reflection, ripples, a sun streak, broken foam lines and twinkling glints.
- **Quality:** Settings → Graphics drives an effects tier. Battery turns off cast shadows, haze and the wide glow; Sharp keeps everything; Balanced (the default) starts with everything and steps down while frames run slow, then back up.
- **Faster frames, to pay for the effects:** cables and pipes are built once into batched paths and redrawn with a handful of strokes (they cost about 5.7 ms a frame at far zoom before); big domes use a slightly softer sprite instead of being redrawn every frame; status badges are cached sprites of the drawn icon set (no emoji or text per frame); the old per-building contact ellipses are replaced by the single shadow fill.
- **UI quick wins:**
  - The clock says "07:00 day / eve / night" instead of a bare shift letter, and its button has a full spoken label.
  - "Sol 123" no longer truncates at 375 px.
  - "1 sols" reads "1 sol" everywhere text is built.
  - The build menu lists what you can build first; locked designs sink to the end, dimmed.
  - Build card descriptions clamp to three lines, so the grid stays even.
  - The resource strip fades at its right edge to show it scrolls.
  - The Independence checklist uses drawn checks and says "meet every condition" (there are six, not four).
  - Research's toggle reads "Auto-pick on/off".
  - People filters show counts as badges and empty filters step back.
  - Toasts that point at a place on the map show a chevron.
  - Map status badges use the drawn icon set instead of emoji.
  - The top bar, tabs, sheets, cards and build banners take the new palette (a warm hairline, a glow under the active tab, card highlights, rust banners).

## Latest test results

- **2.2** (art, palette and UI pass; the engine is unchanged):
  - `test-engine.mjs`: 869 checks passed, 0 failed (24 maps, 6 bot colonies in 332 s; the winnable run reaches Independence on sol 98).
  - `test-ui.mjs`: 124 checks passed, 0 failed. Two checks that read the colony across a tap (accepting a trade, planning and launching an expedition) now pause the game first: an hour ticking over between the reads could fail them about one run in four.
  - `soak.mjs` (420 sols): 14 checks passed, 0 failed.
  - **Frame time**, the same saved colony (seed `perf-1`, 289 buildings) in both pages, 390x844 at 3x, mean of the middle 30 of 40 frames, three fresh browsers each (zoom 0.35 / 0.8 / 1.6):

    | Page | Day | Night | Storm at night |
    |---|---|---|---|
    | 2.1 | 16.5-18.2 / 18.3-18.7 / 18.7-20 ms | 17.5-18.6 / 16.9-20.1 / 20.5-21.8 ms | 19.8-21 / 21.6-22.3 / 24.7-25.7 ms |
    | 2.2 Balanced | 16.1-17.2 / 17.6-18.1 / 20.1-22.6 ms | 15.4-16.8 / 16.8-18.3 / 18.5-21.8 ms | 19.2-20.3 / 22.5-25.4 / 24.3-25 ms |
    | 2.2 Sharp | 18.4 / 22 / 23.4 ms | 20.7 / 24.5 / 23.9 ms | 23.8 / 28.4 / 25.7 ms |

    Headless frames are slow enough that Balanced runs at its middle tier here (shadows on; haze, the wide glow and the extra storm layers off). Sharp forces every effect and costs 2-6 ms more.


- **Bot balance over 200 sols, 2.1** (`tools/balance.mjs`; the same 8 Frontier, 5 Brink and 3 Settled seeds and set-ups as before; the test bot follows the advisor, passes laws in the Assembly, sells surplus to rivals, and keeps rail and expeditions for after Independence):
  - Frontier 6/8 won (sols 95-124), none lost; the two still standing at sol 200 have 121 and 102 colonists.
  - Brink 3/5 won (sols 116, 121, 149), none lost; two colonies are still hanging on at sol 200 with 12 and 17 colonists.
  - Settled 3/3 won (sols 77, 78, 114).
  - 2.0 for comparison: Frontier 6/8 (sols 109-176), Brink 2/5 (sols 136 and 183), Settled 3/3 (sols 96-162), none lost.
  - Single runs of one seed swing with any change. Other 2.1 configurations measured on the way: with every 2.1 system in the game but none of the bot's new habits, Frontier 6/8 and Brink 3/5; with laws but no trades, Frontier 7/8 and Brink 2/5. None lost.
- **`test-engine.mjs`** (default 6 x 110): 869 checks, all passing (24 maps, 6 bot colonies, about 6 minutes). It adds the world (rivals, the race and its prize, trade offers and their expiry, rivalry decisions, refugees, expeditions from launch to return, a rival claiming a site first, relics and the Orrery, the separate random stream), the monorail (routing around buildings, planned track, trains shuttling, interpolation, commuting, shared drones, freight, a power cut stopping the line, save and load, cutting the track), the bot using rail, expeditions and laws, both new mysteries step by step with their choices, the three new wonders, the new events, lake levees, and **a real 2.0 save** (made by the 2.0 engine from git) loading and playing on.
- **`test-ui.mjs`**: 123 checks, all passing. New: the World tab (the drawn map, tapping a site, the rivalry board and seven races, accepting a trade, the Expedition Pad offer, the crew planner with Swap, launching), Build → Base and Grids offering the station, pad and track, Lay track from a station, a train running, the mystery cards in Goals, the intros (Show me, Got it), and at 375 px the eight bottom tabs fitting with labels apart plus the four World tabs and the station panel without overflow and with 44 px targets.
- **`soak.mjs`** (420 sols): 14 checks, all passing. New checks: the population holds after sol 200 (326 at the end; in 2.0 it fell from about 225 to 120), trains ran and expeditions came home, the Assembly passed laws, and the rivals grew. Engine time stays at 3-6 ms per game hour.
- **Frame time** (headless Chromium with software rendering, 390x844 at 3x; mean of the middle 30 of 40 frames):
  - The same colony in both versions (seed `perf-1` grown 150 sols by the 2.0 bot, 289 buildings, saved and loaded into each page; three fresh browsers each):

    | Version | Day, zoom 0.35 / 0.8 / 1.6 | Storm at night, zoom 0.35 / 0.8 / 1.6 |
    |---|---|---|
    | 2.0 | 14.1-17.4 / 17.9-18.1 / 19.2-20.3 ms | 19.6-19.8 / 20.8-21.1 / 23.5-24.8 ms |
    | 2.1 | 15.1-15.7 / 17.3-17.9 / 18.4-19.6 ms | 19.4-22.2 / 21.0-21.5 / 23.4-24.7 ms |

  - The 2.1 bot's own `perf-1` colony after 150 sols is larger (346 buildings, 227 colonists, 63 tiles of track and a train): 17-17.5 / 18.6-22.9 / 18.8-20.6 ms by day and 22.8-23.6 / 22.1-24.5 / 24.4-26.5 ms in a storm at night; centred on the moving train at zoom 0.8, 9.5-9.7 ms.
- Built page: about 750 KB (2.0: 603 KB); 2.2: about 786 KB.

### Earlier results (2.0)

- Bot balance over 200 sols, version 1.3, unchanged in 2.0 (game for game the same results; 8 Frontier, 5 Brink, 3 Settled games; 8 Frontier, 5 Brink, 3 Settled games; the test bot follows the advisor's material, water,
  food, emergency and council prompts, sells surplus and takes advances in emergencies):
  - Frontier 6/8 won (sols 109-176, none lost; the other two alive at 99 and 116 colonists).
  - Brink 2/5 won (sols 136 and 183, none lost; the other three alive but small and in debt). One of the wins lost 51 colonists to a
    single suffocation crisis on the way, so Brink still punishes a slow response to a life-support failure.
  - Settled 3/3 won (sols 96-162).
  - For comparison, 1.2.1: Frontier 6/8, Brink 1/5 (4 lost), Settled 2/3.
- `test-engine.mjs 6 110`: data, 24 maps, 6 bot colonies on Frontier for 110 sols, the winnable run, disasters, grid repair, save/load
  and determinism, the economy, contracts, events, both mysteries, exports and market recovery, pickup runs, the advance, job pins,
  dome focus, the people summary, Free Kessa goals, the Great Storm, the four "danger" scenarios, emergencies (candles, shelter,
  rationing) the council, Reshaping Kessa and the Colony Assembly: 769 checks, all passing on 2.0. The winnable run reaches Independence on sol 109.
- `test-ui.mjs`: 90 checks (menu, new colony, the guided start, tap placement, lines, time, every panel and tab including the council,
  exports, the advance, choosing a job, problem cards, dome focus, survey, vehicles, rockets, saves, export/import, advisor, decisions,
  contracts, Connect to grid, the danger chip, overflow and 44 px targets at 390 px, ten sheets checked at 375x667 for tab rows that fit,
  no overflow and 44 px targets, the Reshaping tab, a reshaped map, the Assembly, no page errors or network requests): 100 checks, all passing on 2.0. The suite also passed 4 runs out of 4 with every CPU core busy, where the
  375 px check had failed 1 run in 4 before it waited for sheet animations.
- `soak.mjs` (420 sols): 10 checks, all passing. Engine time stays at 2-3 ms per game hour from sol 60 to sol 420.
- Built page: about 603 KB (2.0). On a slower run of the same machine, 1.3 measured 21/19/19.5 ms by day and 26/24/27 ms in a storm at night, while 2.0 on a fully reshaped colony measured 18/20.6/18 and 23.4/24.7/25.5 ms. 1.3.1 figures: Frame time (headless Chromium with software rendering, 390x844 at 3x). The colony is seed `perf-1` after 150 bot sols, with 337 buildings. Each figure is the range of two runs:

  | Version | Day, zoom 0.35 / 0.8 / 1.6 | Storm at night, zoom 0.35 / 0.8 / 1.6 |
  |---|---|---|
  | 1.3.1 | 13-14 / 15.5 / 16-17 ms | 18-21 / 19-20 / 20-22 ms |
  | 1.3 | 18-19 / 18-19 / 18 ms | 22-23 / 20-21 / 22-24 ms |

  On a small colony, frames take 12-16 ms at every zoom.
