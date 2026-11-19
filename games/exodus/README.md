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

**Tech web.** 64 techs in eight sectors around Landfall, drawn as a radial web you drag and tap, with up to four Quick picks above it (the suggested tech first, then the ones that feed your affinity) so research is one tap on a phone. Each tech teaches affinity points; costs rise with every tech you know. The first two rings are cheap so the opening turns move quickly, and Riggers can build Hydro Farms from landfall. Branches open from either neighbouring sector, and "Research path" queues every step to a far tech.

**Virtues.** Four trees (Resolve, Industry, Inquiry, Kinship) of eight virtues each in four tiers, phase-gated, with depth synergies at 3, 6 and 8 in one tree and Balance synergies for breadth across all four.

**Satellites.** Four shared types (Helio Lens, Survey Eye, Sentinel Platform, Veil Scrubber) plus one per affinity at level 3. Colonies build them; you launch them over any tile within 4 and they work on everything under their footprint for a few dozen turns, then burn up. On the map each one is a small craft with solar wings circling its own orbit high over its footprint, with a beam to the ground, a fading trail, its ring and the turns it has left.

**Story quests.** 29 quests fire on milestones (first colony, first building of each kind, first study, first vault, first satellite, affinity levels 3/6/9 and more). Each asks the council a question with permanent effects and affinity experience; every answer carries the color and glyph of the affinity it leans toward, and the dialog reminds you which way your colony leans.

**War.** AI factions plan campaigns: they pick a target colony, mass an army (with siege engines) at their nearest colony, and only then declare war and march. A campaign they planned is pressed while it is going well or the walls are half down; a conqueror keeps going for the next first colony. Captured colonies keep half their health so they can be held.

**Sieges.** Ranged units and siege engines wear a colony down; at 1 health its walls are down (🔥 on its banner). A healthy melee soldier standing next to it when its faction's turn begins marches in and takes it, so a siege no longer depends on a melee unit having a move left after crossing rough ground. Tap an enemy colony to see a health bar, which of your units can strike it this turn and for how much in all, and who is at the walls. The defender is warned the moment its walls fall.

**Diplomacy.** Agendas, opinion reasons you can expand, trade deals, open borders, alliances, denouncements, war and peace, and AI offers in an inbox.

**Veil storms.** From turn 25 the Veil sometimes boils up into a storm a few tiles wide that drifts for four to six turns, drawn as a slow violet vortex with lightning. Under it the Veil spreads and units in the open lose 12 health a turn unless Veil-adapted; colonies under it sample the spores for science but lose some stored food. A Veil Scrubber satellite overhead tears a storm apart. Routes that end under a storm warn you, and so does the tile panel.

**Landfall goals.** Nine early objectives (🎯 on the right, with a done count) pay credits, science, culture, production or affinity as soon as you reach them: a second colony, four techs, three improved tiles, 120 explored tiles, a first virtue, a Field Lab, an excavation, first contact and a size-4 colony. They lapse after turn 120 and can be turned off in New Game.

**Victories.** Rootsong (Communion: grow the Heartbloom), Convergence (Lattice: the Lattice Core), Genesis (Lineage: the Genesis Engine, with the Veil kept out of your land), Awakening (decode three Echo Vaults and build the Listening Array), Dominion (hold conquered rival colonies worth two points per rival, where a rival's first colony counts 2 and any other colony it founded 1, for about 12 turns, or be the last faction), and Legacy (highest score at the turn limit). Each project must be held for a number of turns, and a captured project is destroyed. Victories can be turned off in New Game.

**Also kept from Hexarch and rewritten:** undo of moves that revealed nothing, hotseat for up to the map's player count with a curtain between turns, a first-game tip guide, a codex (Units, Buildings, Wonders, Factions, Veyra), a Hall of Fame, colony events with chains, Visionaries, Agents, directives, the Odyssey roguelike mode with Peril levels, and procedural sound and music that change with phase, war and your affinity.

## Look

Teal, violet and bioluminescent palette; a tilted 3D view with crystal ridges, spires, giant glowing mushrooms and spore pods standing on the tiles; violet sky haze; colony domes that grow into arcology towers around the landed ark; tinted unit tokens with affinity rings, and affinity overlays on upgraded units. A slow day and night cycle (about a minute, off with ambient animation or battery mode) dims the land at night while fungal forests, spore marshes, ridges and spires glow. Fauna breathe and sway on their tokens, the Titanoth carries a pink aura, and your units standing in the Veil get a pulsing pink warning ring.

## Playing on a phone

- Stories and events never open on top of another screen; they wait for the map. Tips never cover a dialog.
- A route that would end a turn inside the Spore Veil says so before you confirm the move, and each turn the log tells you which units the Veil burned.
- The Affinity screen says where experience comes from and shows the next perk for each affinity.
- An Explorer with nothing left to explore goes to sleep instead of asking for orders every turn.
- A tip suggests spending credits when they pile up.

## Balance

`tools/balance.mjs` plays full all-AI games on medium maps (five factions), mixing the four map types; every tenth game is a conquest setup with only Dominion and Legacy on. The last 100-game run gave:

- **Win rate when present:** every faction between 11% and 35%. Forgeborn is highest at 23 of 65 games.
- **Victory types:** Genesis 22%, Rootsong 21%, Dominion 20%, Convergence 19%, Awakening 13%, Legacy 5%.
- **Dominion:** 15 of the 90 standard games and 5 of the 10 conquest setups.
- **Game length:** the median game ends on turn 208.
- **Eliminations:** about 0.18 factions per game.

The report also lists, per game, the most conquest points any one faction held at once.

## Layout

- `src/engine/` – rules, AI and map generation. New files for Exodus: `affinity.js`, `virtues.js`, `planet.js` (Veil, landfall, loadouts, excavation), `orbital.js`, `story.js`.
- `src/ui/` – rendering, screens and input. `webui.js` holds the tech web, virtues, affinity, story and landfall screens.
- `tools/` – build, headless loader, tests, balance and simulation reports.
