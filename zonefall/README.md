# Zonefall 3

An open-world, 2.5D survival base-builder for the browser that you can install on an iPhone Home Screen. It plays like the genre's classics: wash up on a beach with a rock and a torch, gather, build a real base out of foundations and walls, explore monuments for loot, and defend your Tool Cupboard from raids every night.

**Play:** https://aronissac001-beep.github.io/Clawd-Code/zonefall/ — open it in Safari, then Share → Add to Home Screen, and play in landscape.

## What's in it
- **One open island** (800 m), generated from a seed: beaches, grassland, forests, a snowy north, an arid south, mountains, lakes and a ring road.
- **Monuments:**
  - Haven Market: a safe zone with vendors, guards and recyclers.
  - Smaller sites: gas stations, supermarkets, lighthouses, Hollow Creek village, scav camps, a quarry.
  - Larger sites: the Dish Array, Harbor, Train Yard and Water Treatment. These have keycard vaults, and some need a fuse or a lever.
  - Military sites: the Airfield and Garrison 9, where the Warlord boss lives.
  - The Reactor Sector, with radiation, anomalies, artifacts and lurkers.
  - Outlaw Forts, which you raid with satchels or C4.
- **Rust-style building:**
  - 3 m foundations, with walls, doorways, windows, low walls and roofs on their edges.
  - Five tiers: twig, wood, stone, sheet metal and armored. The hammer upgrades, repairs, rotates and removes pieces.
  - High external walls and gates.
- **Real doors:** walking into your own door swings it open, and it closes behind you. Raiders and animals have to break doors.
- **Tool Cupboard:** it claims the land, stops decay, stores resources and feeds your turrets. Raiders come for it every night, and if it falls the run ends.
- **Survival:** health, food, water, bleeding and radiation. You hunt, cook, smelt, craft with workbench tiers, research blueprints and recycle.
- **AI survivors:** bots that play like other players. They gather, craft, build their own bases, loot, hunt, fight, hold grudges and chat. Some are friendly and can join your team; some shoot on sight and raid you with satchels.
- **Events:** airdrops, supply signals, night raids that grow every night, and boss raiders.
- **Meta progression:** perks persist between runs.

## Controls
- **Touch:**
  - The left stick moves.
  - The right stick aims; push it to the edge to fire or swing.
  - The big button is the context action. Hold it to gather.
  - Tap a belt slot to switch items or to eat and heal.
- **Keyboard and mouse:**

  | Key | Action |
  |---|---|
  | WASD | Move |
  | Mouse | Aim |
  | Click | Fire or swing |
  | E | Action |
  | R | Reload |
  | 1–6 | Belt slots |
  | B | Build |
  | Tab | Inventory |
  | C | Craft |
  | M | Map |
  | Q | Rotate |
  | Esc | Pause |

## Tech
Plain static files with no build step. It uses ES modules and [Three.js r170](https://threejs.org/), vendored in `lib/`. Every model is procedural low-poly geometry built in code (`src/gfx/models_*.js`), and the item icons are pixel art drawn in code (`js/art_icons.js`). The audio is synthesized with WebAudio. A network-first service worker lets the game run offline from the Home Screen.

```
src/main.js            boot, wiring
src/game.js            runs, day/night, raids, airdrops, death/respawn, saving
src/player.js          controls, gathering, crafting, interactions
src/bots.js            AI survivors
src/ai.js              NPC + wildlife brains
src/combat.js          weapons, projectiles, explosions, turrets
src/build.js           building system, Tool Cupboard, raider flow field
src/doors.js           hinged doors and gates
src/world/gen.js       island generation
src/world/kit.js       monument builder kit; src/world/monuments.js = layouts
src/world/live.js      loot, resources, NPC spawns, wildlife
src/gfx/*              renderer, terrain, vegetation, effects, materials, models
src/ui.js              HUD, inventory, crafting, build bar, map, menus
```

Run it locally with `python3 -m http.server` in this folder and open `http://localhost:8000/`. The pages in `dev/` are model galleries and test views.
