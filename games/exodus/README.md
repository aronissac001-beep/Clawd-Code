# Hexarch: Exodus

A mobile, touch-first 4X about the first colonists on Veyra, a living alien world. It is built from the Hexarch engine (copied, not shared) and turned into a different game: new terrain, resources, factions, tech web, affinities, fauna, satellites, story quests and victories. Every name, text and picture in it is original.

The built game is one self-contained file: `docs/exodus/index.html` (no external requests). It is made for a portrait phone (iPhone 14, 390×844) and also works on desktop browsers.

## Build and test

From the repository root:

```sh
node games/exodus/tools/build.mjs                 # writes docs/exodus/index.html
node games/exodus/tools/test-engine.mjs           # headless engine checks (~40 s)
node games/exodus/tools/test-rogue.mjs            # supply pods, artifacts, Odyssey mode
node games/exodus/tools/test-ui.mjs [shotDir] [dpr]   # Playwright, iPhone 14 at DPR 3 by default
node games/exodus/tools/test-hotseat.mjs [shotDir]    # two players on one phone
node games/exodus/tools/test-late.mjs [shotDir]       # every screen on a turn-180 empire
node games/exodus/tools/test-expedition-ui.mjs [shotDir]
node games/exodus/tools/balance.mjs 80 4 medium bal   # all-AI games in 4 worker processes
node games/exodus/tools/sim.mjs | vicsim.mjs | warsim.mjs   # reports on single AI games
```

The UI tests use a local `playwright` if present, otherwise the global npm install. The build concatenates `src/engine/*.js` and `src/ui/*.js` (order in `tools/build.mjs`) into `src/index.template.html`. `tools/load-engine.mjs` loads the same engine files into a Node VM for the headless tools.

Saves use `localStorage` keys `exodus.save.*` and settings `exodus.settings`, so the game never touches Hexarch's saves.

## What is in the game

**The planet.** Ten terrains (Steppe, Flats, Dunes, Frost, Crystal Ridges, Fungal Forest, Spore Marsh, Spires, Shallows, Deep), glow-rivers, 14 resources including the strategic Chitin, Ferrite and Lumenite that feed each affinity's top units, and ten natural wonders. The **Spore Veil** is a pink, animated hazard layer: it hurts units that are not adapted (10 a turn), lowers morale when it sits in your borders, spreads slowly, and can be scoured by Riggers (Biocontainment), cleared by Veil Scrubber satellites, or embraced by Communion (immune at level 2, worked Veil tiles give science later). Crash sites, Precursor ruins and Echo Vaults are excavated by Explorers, who carry expedition kits; supply pods are opened by walking in.

**Factions and landfall.** Eight sponsors, each with a leader, a bonus, a unique unit, an agenda and an affinity lean (Halcyon Accord, Kestrel Mutual, Brightwater Commune, Ironveil Pact, Choir of Sel, Forgeborn Cooperative, Tidecall Flotilla, Pathfinder Lodge). Before the game you choose an ark loadout (colonists, cargo, ship), and on turn 1 you pick one of three landing sites from orbit. Independent outposts land over the whole game; befriend them with convoys and gifts, and absorb an allied outpost for credits.

**Native fauna.** Six species, from Skitterswarms to the colossal Titanoth and the sea-going Tidewyrm, living in nests. Each faction has its own fauna anger (0–100): attacking, killing and destroying nests raise it, peace lets it fall, and the wild only hunts you when it runs high (or near its nests). Explorers can study nests for science; Communion level 4 with Fauna Ethology tames beasts into your army.

**Affinities.** Communion, Lattice and Lineage, each with 12 levels earned from techs, story choices, excavations and how you treat the planet. Levels grant perks, unlock improvements and buildings, change how other leaders see you, upgrade units into affinity-specific second and third tiers with their own art, and open that affinity's victory.

**Tech web.** 64 techs in eight sectors around Landfall, drawn as a radial web you drag and tap. Each tech teaches affinity points; costs rise with every tech you know. Branches open from either neighbouring sector, and "Research path" queues every step to a far tech.

**Virtues.** Four trees (Resolve, Industry, Inquiry, Kinship) of eight virtues each in four tiers, phase-gated, with depth synergies at 3, 6 and 8 in one tree and Harmony synergies for breadth across all four.

**Satellites.** Four shared types (Helio Lens, Survey Eye, Sentinel Platform, Veil Scrubber) plus one per affinity at level 3. Colonies build them; you launch them over any tile within 4 and they work on everything under their footprint for a few dozen turns, then burn up. Their rings and remaining turns show on the map.

**Story quests.** 29 quests fire on milestones (first colony, first building of each kind, first study, first vault, first satellite, affinity levels 3/6/9 and more). Each asks the council a question with permanent effects and affinity experience.

**Diplomacy.** Agendas, opinion reasons you can expand, trade deals, open borders, alliances, denouncements, war and peace, and AI offers in an inbox.

**Victories.** Rootsong (Communion: grow the Heartbloom), Convergence (Lattice: the Lattice Core), Genesis (Lineage: the Genesis Engine, with the Veil kept out of your land), Awakening (decode three Echo Vaults and build the Listening Array), Dominion (hold half the rival first colonies for about ten turns, or be the last faction), and Legacy (highest score at the turn limit). Each project must be held for a number of turns, and a captured project is destroyed. Victories can be turned off in New Game.

**Also kept from Hexarch and rewritten:** undo of moves that revealed nothing, hotseat for up to the map's player count with a curtain between turns, a first-game tip guide, a codex (Units, Buildings, Wonders, Factions, Veyra), a Hall of Fame, colony events with chains, Visionaries, Agents, directives, the Odyssey roguelike mode with Peril levels, and procedural sound and music that change with phase, war and your affinity.

## Look

Teal, violet and bioluminescent palette; a tilted 3D view with crystal ridges, spires, giant glowing mushrooms and spore pods standing on the tiles; violet sky haze; colony domes that grow into arcology towers around the landed ark; tinted unit tokens with affinity rings, and affinity overlays on upgraded units.

## Layout

- `src/engine/` – rules, AI and map generation. New files for Exodus: `affinity.js`, `virtues.js`, `planet.js` (Veil, landfall, loadouts, excavation), `orbital.js`, `story.js`.
- `src/ui/` – rendering, screens and input. `webui.js` holds the tech web, virtues, affinity, story and landfall screens.
- `tools/` – build, headless loader, tests, balance and simulation reports.
