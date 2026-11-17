# Zonefall 4

A first-person, open-world survival base-builder for the browser that you can install on an iPhone Home Screen. Wash up on a beach with a rock and a torch, gather, build a real base out of foundations and walls, raid monuments for loot, and defend your Tool Cupboard from raids every night.

Zonefall 4 is a full first-person remake with a bright, cel-shaded comic-book look. Everything has hard-banded toon lighting and black ink outlines, with hand-drawn hatching in the textures.

**Play:** https://aronissac001-beep.github.io/Clawd-Code/zonefall/ — open it in Safari, then Share → Add to Home Screen, and play in landscape.

## What's in it
- **First person:**
  - Shooting is real 3D ballistics: bullets drop and travel, headshots crit, and cover blocks shots.
  - Recoil and bloom, aim-down-sights with scopes, sprinting, jumping and crouching. Crouching also keeps you hidden.
  - You chop, mine and build by looking at things.
- **Comic style:**
  - Ink outlines and toon lighting.
  - Floating damage numbers, with crits that shout.
  - Loot beams in rarity colours over dropped weapons and rare loot.
  - Eye-level rain and snow, and readable blue nights.
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
- **Events:**
  - Airdrops, supply signals, and a patrol gunship you can shoot down.
  - Night raids that grow every night, and boss raiders.
- **Meta progression:** perks persist between runs.

## Controls
- **Touch:**
  - Drag on the left side to move. Push the stick all the way forward to sprint.
  - Drag anywhere on the right side to look.
  - The fire buttons also steer while you hold them. There is a big one bottom-right and a small one on the left edge.
  - The other buttons are aim (eye), jump, crouch, reload and heal.
  - The orange hand button is the context action. Hold it to gather.
  - Tap a belt slot to switch items.
- **Keyboard and mouse:** click the game to capture the mouse.

  | Key | Action |
  |---|---|
  | WASD | Move |
  | Shift | Sprint |
  | Mouse | Look |
  | Left click | Fire or swing |
  | Right click or V | Aim |
  | Space | Jump |
  | C or Ctrl | Crouch |
  | E | Use or gather |
  | R | Reload |
  | H | Heal |
  | 1–6 or wheel | Belt slots |
  | B | Build |
  | X | Hammer |
  | Tab | Inventory |
  | Q | Craft (rotates the piece while building) |
  | M | Map |
  | Esc | Pause |

- **Settings:** look sensitivity, field of view, invert Y, aim assist and graphics quality. There is also a Repair button that clears cached files.

## Tech
Plain static files with no build step. It uses ES modules and [Three.js r170](https://threejs.org/), vendored in `lib/`.
- **Models and icons:** every model is procedural low-poly geometry built in code (`src/gfx/models_*.js`). The item icons are pixel art drawn in code (`js/art_icons.js`).
- **Comic look:** two pieces make it:
  - A toon patch on the shared Lambert shader chunk (`src/gfx/materials.js`).
  - A post pass (`src/gfx/ink.js`) that inks silhouettes and creases. It finds them from the Laplacian of 1/z in the depth buffer, then grades colour and tone-maps.
- **Rendering cost:** static monuments merge into one mesh per texture, with material colours folded into vertex colours. Vegetation is instanced in 64–128 m blocks. Crates, nodes and drops live in a distance-culled grid (`src/gfx/cullgrid.js`). The far plane follows the fog.
- **Audio and offline:** the audio is synthesized with WebAudio and is positional, panned by where you look. A network-first service worker lets the game run offline from the Home Screen.

```
src/main.js            boot, wiring
src/game.js            runs, day/night, raids, airdrops, death/respawn, saving, FP camera
src/input.js           touch look/move zones, buttons, mouse pointer lock, keyboard
src/player.js          FP movement, recoil, ADS, gathering, crafting, interactions
src/fp/viewmodel.js    first-person arms and held items
src/bots.js            AI survivors
src/ai.js              NPC + wildlife brains
src/combat.js          weapons, 3D projectiles, headshots, explosions, turrets
src/build.js           building system, Tool Cupboard, raider flow field
src/doors.js           hinged doors and gates
src/world/gen.js       island generation
src/world/kit.js       monument builder kit; src/world/monuments.js = layouts
src/world/live.js      loot, loot beams, resources, NPC spawns, wildlife
src/gfx/*              renderer, ink pass, sky, grass, water, rain/snow, terrain,
                       vegetation, effects, materials, models
src/ui.js              HUD, crosshair, damage numbers, inventory, crafting, build bar, map, menus
```

Run it locally with `python3 -m http.server` in this folder and open `http://localhost:8000/`. The pages in `dev/` are model galleries and test views.
