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
- `src/ui/` canvas rendering and DOM UI: `util.js` (DOM, icons, settings, compressed saves), `audio.js` (Web Audio synth + generative music), `art.js` (procedural stars, planets, portraits, event scenes), `shipart.js` (ship, monster and starbase sprites), `render.js` (galaxy and system view), `input.js` (tap, drag, pinch, wheel, keys), `hud.js` (loop, top bar, panels, orders, dialogs, tips), `screens.js` (all full-screen panels), `menus.js` (menus, species creator, saves, end screen)

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
- **Victory**: conquest (last empire standing, or hold more than half of all homeworlds for 5 years), Wake Beacons (research Wakefield Theory, hold three Beacon systems with Keeps for 15 years; a vigil begun before year 80 runs half a year longer for each year earlier, so a young galaxy resists waking; Beacon Keeps do not use starbase capacity), or score at the end date. End screen with score, pops, systems and fleet charts.
- **The Convergence**: at 65% of the game length the Beacons flare. Every empire gets an event, two attuned Beacons are enough to start a vigil (15 years), three finish it in 9, dominion takes 3 years, and AIs start contesting Beacons: they claim free Beacon systems first, declare war on any empire holding two or more, and gang up on whoever has a victory countdown running.
- **Victory race** (trophy button on the map): your Beacons (owned, attuned, needed), homeworlds held against the number needed, your score rank, the rival closest on each path and every running countdown. A banner under the top bar shows the Convergence and any vigil or dominion in progress, in gold when it is yours.
- **Great Projects** (Empire → Projects): seven multi-stage works paid stage by stage, each unlocked by a technology. Sun Lattice (+20% energy, +10% minerals), Archive of Echoes (+15% research, +10% unity), Halo Habitat (a ring of cities around the capital: +30 housing, +5 amenities, +3 building slots, +15% growth), Wake Arch (a permanent starlane from the capital to your farthest system, +10% ship speed), and three unique in the galaxy that only the first builder can claim: Skyward Bastion (+50% starbase strength, naval capacity, fleet command), Resonance Spire (Beacons count without Keeps, vigil 3 years shorter) and the Silencing Bell (only during the crisis: +75% damage against the Hollow Choir). Each finished project is worth 40 score. AIs build them by archetype.
- **The Concord of Stars** (Diplomacy → Concord, from year 25): a galactic council. Every three years the chair passes to the next member, loudest voice first, and the chair puts one of up to three eligible resolutions to the vote; members have a year to vote. Votes are weighed by size (1 + colonies/4 + pops/150), and a member can spend 60 influence once per vote to rally support for half again. Passed resolutions bind every member for 12–25 years: Charter of Open Archives (+10% research), Frontier Claims Act (−25% outpost cost, +5% growth), Armistice of the Lanes (warships +20% cost, +5 stability), Shipwrights' Covenant (warships −15% cost), Concord of the Markets (+10% energy and goods), Sanctuary Rights (+30% starbase strength, +2 fortification), Colonial Aid Fund (smaller empires +20% growth and +10% minerals, larger ones pay 5% of their energy), Beacon Watch Accord (every vigil 3 years longer; proposed once someone holds two Beacons), Censure of the strongest empire (−2 influence a month, −10% research for it) and, during the crisis, a Pact against the Choir. AIs propose and vote by archetype and situation (a censured empire votes against, an empire with a vigil fights the Beacon Watch, smaller empires back colonial aid, chairs they like win their votes). When the chair is yours an event lets you pick the resolution; a Situation alert and a pip on Diplomacy remind you to vote. The Concord tab shows the resolution, what it means for you, the live tally, every member's vote and voice, what is in force and past votes.
- **First goals** (flag button, first 12 years): ten steps through the first decade (research in all streams, survey 12 systems, own 5 systems, build on the capital, a second colony, a tradition, contact, a treaty, 10 warships, a starbase module), each with a hint and a small reward paid the month it is reached.
- **Saves**: autosave every 3/6/12 months (three rotating slots), five manual slots, export/import as text (LZW-compressed, `starwake.` key prefix).
- **Sound**: synthesized effects and generative ambient music that darkens in wartime, both switchable.

## Playing on a phone: one-tap orders

- The system panel offers **Claim system**, **Survey**, **Study the anomaly**, **Build station**, and a **Colonize** button on every habitable world: the nearest free (or automated) ship goes, or one is queued at the nearest shipyard and sets out by itself when launched.
- The Outliner lists the best **Worlds you could settle**. Constructors cycle *Automate: off → stations → expand + stations*. New colonies are automated by default (Settings → Gameplay).
- Toasts let taps fall through to the map; their › button jumps to the system or the right screen (research, traditions, diplomacy). A tap on a star's core always selects the star rather than a passing fleet.
- Alerts warn when food, energy or minerals will run out within a year (or already have) and name the district that fixes it, when alloys are scarce, when your navy is far weaker than your strongest neighbour's after year 18 (with a shortcut to a shipyard), when a Concord vote is waiting, and about hostile fleets in your space, a hostile neighbor whose fleets outmatch yours, piling energy or influence, free edict slots and Ascension perks. Shipyards queue warships five at a time; the market trades in lots up to 1000.
- Homeworlds are fortresses (double garrison and +4 armies, +60% home starbase), and AI empires give a human ten more peaceful years than they give each other.
- AIs do not start a new war against a human who is already at war (unless the human runs a victory countdown), so wars on a human come one at a time.
- Civilian ships that had to retreat stay away from that system for a year, and automated constructors skip systems where a hostile fleet or monster sits, so a constructor no longer flees the same guarded star over and over.
- The Outliner's settle list shows *No shipyard* instead of a Colonize button when no ark can be built or sent.
- A human starts with two constructors. For the first 15 years AIs do not claim systems within one jump of a human's borders, so free land next to you stays yours to take.
- When Open Lanes or an alliance ends, or a war ends in peace, warships left inside the other side's closed borders are pushed out to the nearest system they may hold, with a message.

## Look and feel: the "Deep Field" design system

All UI styling lives in `src/ui/style.css`, built on tokens defined at its top:

- **Surfaces** step from `--ink-0` (space) through `--ink-1`…`--ink-4` (pressed control), separated by cool translucent edges (`--edge-1/2/3`). Cards, list rows, tech cards, tradition trees and dialogs share one gradient-and-edge recipe with a faint top highlight.
- **Color roles**: one accent, wake cyan (`--acc`), for action, selection and the active tab or nav item; gold for commitment (Begin, Great Projects, unique, paused); green, red and amber only for state. Primary buttons are bright cyan or gold with dark ink text, so their labels pass WCAG AA (the old white-on-cyan did not). Text uses three levels (`--text`, `--text-2`, `--text-3`), all at least 4.5:1 on the surfaces they sit on; empire colors are lifted toward white for star names on the map.
- **Type scale** 11 / 12.5 / 14 / 15.5 / 17 / 20 / 28 / 46 px with tabular numbers for every resource, date and stat; section labels are 11 px uppercase with wide tracking and a fading rule.
- **Spacing** 4 / 8 / 12 / 16 / 20 / 24, **radii** 8 (chips) / 12 (controls) / 16 (cards) / 22 (sheets and dialogs), **elevation** e1 (cards) / e2 (floating panels) / e3 (dialogs), plus a cyan glow ring for selected items.
- **Icons**: one inline-SVG set on a 16-unit grid with 1.5 px strokes: resources, the six screens, ship classes (picket, lancer, warden, monarch, surveyor, constructor, colony ark, army), starbase and modules, beacons, alerts by kind (idle ship, shortage, war, research, tradition, pops), checks and chevrons. Fleets, starbases and projects show their icon in a badge tinted with the owner's color. No emoji or text glyphs are used as icons.
- **Motion**: screens rise in and their content follows in a short stagger (only when a screen opens, not when it re-renders after a tap), dialogs pop in, the selection sheet slides up, tabs and the bottom nav animate an underline, buttons and rows press in, progress bars in dialogs grow, a stockpile that jumps (purchase, reward, bill) bumps its number green or red, and a running victory countdown banner breathes. `prefers-reduced-motion` turns all of it off, along with the rotating selection ring, star corona and menu galaxy.
- **Screens**: the main menu paints a nebula, galactic core and a ringed ocean world under turning spiral dust, with icon buttons and subtitles; the new-game screen opens with a species preview in the empire's color and groups the rest into cards; events get a full-bleed art header with a kind label (Anomaly, Event, Crisis), and first contact, envoys and war declarations a portrait header in the other empire's color; screen headers carry an icon badge; the end screen has an emblem for the victory type and charts with the player's line filled.
- **Art**: stars have tight cores, soft halos and diffraction spikes for hot stars, plus a large granulated version for the system view; planets get drifting clouds on living worlds, storms on some giants, ocean glints, a soft night side and larger textures when drawn big; the galaxy gets a fractal nebula layer shaped by its nebulae and disc; territory fills are lighter so stars and names stay readable; colonized orbits are tinted in the owner's color; ships in the system view show engine glow.

- **Round 5 polish**: system-view labels (planets, moons, belts, starbase, fleets) are placed after drawing: each tries below, above, right and left of its body and takes the first free spot, selected and colonized worlds first, and minor labels give way instead of overlapping. At mid zoom the galaxy shows only Fortress-level starbase rings, other empires' colony dots only when zoomed in, and other empires' uncolonized system names only close up. New event pictures for worlds (a lit planet with clouds and a moon, with lights, harvest ships or refugee convoys), crystal fields, holographic star charts and the Concord's hall. The menu dust fades out behind the title and tagline. Empire colors used as text anywhere in the interface pass through `tc()`, which lifts them toward white until they reach 4.6:1 on the lightest card.

Measured after the pass (headless Chromium, DPR 3, same busy machine, two runs each): galaxy panning averages 4.7–7.1 ms per frame against 4.9–7.0 ms before, and the system view 9.0–9.8 ms against 9.7–10.0 ms.

## Art (all procedural: canvas and inline SVG, no image files)

- **Ships** (`src/ui/shipart.js`): a distinct silhouette for each hull, drawn once per hull and empire color and then reused. The Picket is a winged dart, the Lancer a spear with twin engine pods, the Warden an armored wedge with four turrets, and the Monarch a capital ship with a lit bridge, six turrets and four engines. The civilian ships are a Surveyor with a sensor dish, a Constructor with crane arms, a Colony Ark with a habitat ring and an Army transport with drop pods. Each has plated metal shading, empire-color trim lines and nozzles. Engine flames flicker live, and ships below 55% hull burn and smoke. At close galaxy zoom a fleet shows its biggest ship in a ringed badge; farther out the vector chevrons stay for legibility. All sprites for the empires in play are drawn when a game starts.
- **Monsters and the crisis**: layered translucent voidmoth wings, a crystal tender's shard cluster, the Old Sentinel's ringed eye, the Mother of Storms' vortex with lightning, a patched-together scavenger, a starwhale with glowing spots, and the Hollow Choir's angular drones, spiked reavers and obsidian Spires with violet fissures.
- **Starbases**: a hub that grows with each level. An Outpost has three arms and a beacon light, a Keep longer arms, a Citadel six arms and a ring, a Bastion an outer armored ring. Modules sit on the arms: a shipyard frame, anchorage pylons, gun batteries, trade pods and a repair dock. Disabled starbases fade and carry a red cross.
- **Planets**: each of the 20 body types has its own surface recipe, sampled on a true sphere so features bend toward the limb.
  - Ocean archipelagos, jungles with rivers, misty fens with lakes, wind-carved dunes, terraced mesas with canyons, streaked steppes, snowy taiga, cracked glaciers, snow-capped highlands, Earth-like gardens with deserts and ice caps.
  - Cratered barren and frozen rocks, molten worlds with glowing lava veins, swirling toxic bands, banded gas and ice giants with storms, hollowed shells with violet fissures, relic ecumenopolises, crystal-lattice Beacons.
  - Living worlds get clouds and an atmosphere rim tinted by the world; oceans catch a glint. Colonized worlds show city lights on the night side.
  - Ringed giants draw their rings in two halves around the planet.
- **Stars**: each type has its own corona. Yellow and orange stars have breathing rays (fewer and thicker for orange), red dwarfs a dim glow with slow prominence loops, white and blue stars long thin spikes and a lens ring, pulsars two sweeping beams, and black holes a banded accretion disk around a lensing ring. Asteroid belts are a dusty band of rocks of many sizes, lit from the star's side. Systems inside a nebula get a painted nebula backdrop.
- **Galaxy map**: at close zoom each empire's space carries a crisp hex lattice in its color. It is drawn as vector strokes per tile, three shared edges per cell, so it costs little. Lanes are slightly heavier when zoomed in.
- **Portraits**:
  - A backdrop for each ethos: banners (Vanguard), laurels (Concord), circuitry (Ascendant), a halo of rays (Devout), a rising sun over a horizon (Frontier), a hex wall (Insular), coins (Mercantile), flames (Zealous).
  - A key light behind the head.
  - Five clothing cuts (robe, armored pauldrons, high-collared coat, sash with a brooch, glowing tech suit) trimmed in the empire color.
  - Used everywhere a species appears: species picks, the new-game preview, diplomacy, envoys and first contact.
- **UI**: illustrated empty states (no warships, no contact, a galaxy at peace, nothing in force, no shipyards, an empty log), corner ticks on cards and an accent edge on pressed or selected rows.

## Rendering

The galaxy's static layer (glow, blurred soft territory borders, lanes, empire-tinted lanes, stars, markers, names) is cut into 512 px world tiles, each drawn once into its own offscreen canvas and reused while panning. Tiles that scroll into view are rendered under a 5 ms budget per frame; until one is ready the previous tile set (from the last zoom level) is drawn scaled underneath, and the ring of tiles just outside the screen is prefetched only once panning pauses for 120 ms. A zoom change or a map change rebuilds tiles a few at a time instead of redrawing one big layer in a single frame, which caused the old 40–60 ms frames when panning fast. Unscaled tiles are blitted on whole device pixels so seams never show. Text uses outlines instead of shadow blur, and fleet power is cached per day for drawing.

Measured in headless Chromium at DPR 3 on a large galaxy at year 60, panning 25 px per frame with rasterization forced every frame (median of three runs on a shared, busy machine): worst frame 14.6 ms at mid zoom and 25.8 ms at close zoom, against 42.2 / 58.5 ms for the previous single-layer cache; average 4.8 / 6.0 ms against 7.3 / 9.0 ms. Battles show glowing beams with white cores, kinetic tracers, missile trails, muzzle flashes, shield-impact arcs and explosion sparks; stars in the system view have slow corona rays and starbases show docking arms and gun platforms.

## Balance (`balance.mjs`, all-AI, 200 years, small and medium galaxies alternating)

| Archetype | Round 1 (48 games) | Round 2 (64 games) | Round 3 (60 games) | Now (60 games) |
|---|---|---|---|---|
| Expansionist | 35% (46% on small maps) | 19% | 22% | 25% |
| Mercantile | 19% | 23% | 17% | 20% |
| Militarist | 19% | 14% | 15% | 18% |
| Isolationist | 4% | 20% | 8% | 18% |
| Zealot | 19% | 14% | 22% | 12% |
| Scholarly | 4% | 9% | 17% | 7% |

| Victory type | Round 2 (64 games) | Round 3 (60 games) | Now (60 games) |
|---|---|---|---|
| Score | 46 (72%) | 24 (40%) | 28 (47%) |
| Wake Beacons | 10 (16%) | 31 (52%) | 30 (50%) |
| Conquest | 8 (12%) | 5 (8%) | 2 (3%) |

- Now: Beacon wins come in years 74–182, only 2 of 30 before year 85 (round 3: 8 of 31 in years 48–84); someone starts a vigil in 45 of 60 games; conquest wins in years 108 and 130. About 32 wars and 32 peace deals per game; the Hollow Choir is defeated in 56 of 60 games.
- Variance check: the same 60 seeds with scholarly fleets set 15% larger gave score 53%, scholarly 13%, isolationist 13%, militarist 5%, so a single archetype moves by 5–10 points between near-identical runs. That variant was not kept.
- Round 5 changes: the Concord of Stars, a vigil begun before year 80 runs half a year longer for each year earlier, the Convergence at 65% of the game (was 70%), isolationists govern as a Directorate (+1 influence, +1 edict, +10% build speed), scholars build a second colony ark from year 4, civilian ships avoid guarded systems, and AIs do not open a second war on a human.
- Round 3 changes: the Convergence (two Beacons suffice, shorter clocks, AIs contest Beacons and pile on anyone with a countdown, a 60% chance to declare even for peaceful archetypes), a 15-year Beacon vigil (was 18), Beacon Keeps outside starbase capacity, Great Projects; scholars favor Wakefield Theory, claim Beacons first, fortify Beacon starbases with batteries, take Adaptable and the Expanse tradition early and run two constructors from the start; the Lattice of Minds gives +18% research.
- Round 2 changes: AIs of every archetype run two constructors after year 5 and two colony arks after year 8, with the same influence reserve; the expansionist archetype is Frontier + Devout under an Open Assembly and no longer favors the Fertile trait; Frontier grants +5% growth; administrative sprawl raises research and tradition costs 0.9% per point; homeworlds are fortresses; Insular gives +10% minerals and alloys; isolationists and scholars expand a little more; the Lattice of Minds gives +12% research; score counts pops ×1.2 and technologies ×5.

## Tests

- `test-engine.mjs`: 12 galaxies (3 sizes × 4 shapes) connected with capitals and beacons; player commands (districts, buildings, surveys, research, warships, market, traditions, edicts, custom designs); closed borders and Open Lanes; ascension perks and their slot limit; one-tap colonization that queues an ark and sends it on launch; Great Projects (stages, unique claims), first goals and their rewards, the Concord of Stars (convenes, chair proposes, rally, a passed resolution applies), the Convergence shortening dominion, fleets pushed out when access ends; a scripted war (declare, disable starbase, bombard, invade a fortified homeworld with 30 legions, peace); two full 200-year AI games; save/load round trip; determinism.
- `test-ui.mjs` (64 checks): menu and the ◂ All games link, help, settings, species creator, new game, 44px tap targets, no horizontal overflow, play/pause, tap a star, drag and pinch, system view and planet tap, constructor orders and move mode, one-tap Claim system, every screen (outliner, planet, buildings, research, empire tabs including Ascension perks and beginning a Great Project, the victory race and first goals dialogs, diplomacy including Open Lanes, voting and rallying in the Concord, designer, starbase, log), an event dialog that pauses the game, manual save and load, export/import code, thirty years of play, end screen with charts, no page errors.
- `playtest.mjs`: a scripted human (turns on Automate for its capital in the first month as the planet tip suggests, research, traditions, one-tap claims and colonies, capital buildings, Farming/Generator/Mining districts when a Situation alert asks for one, five-ship batches unless energy is short, more when the navy alert fires) plays 40 years through taps only, then reports its empire, taps per action, red toasts and blocked taps.
