# Zonefall

A mobile-first survival **extraction roguelike base-builder** that runs in the browser and installs to the iPhone Home Screen as an offline app.

* **Day — the Zone:** deploy into one of five procedurally generated areas (forest, village, radar monument, military garrison, reactor). Loot crates, chop trees, mine ore, fight mutants, scavs and soldiers, grab artifacts out of anomalies, open keycard vaults, then reach an exfil before the **Emission** hits. Die and you lose everything but your secure pouch.
* **Night — the raid:** waves of raiders path toward your **Claim Cupboard** through the weakest part of your walls. Breachers plant satchels, rocketeers shell walls, a boss shows up every 7th night. If the Cupboard falls, the run ends.
* **Base:** build/upgrade walls (wood → stone → metal → armored), doors, embrasures, traps, turrets, lights, workbenches T1–T3, furnace, research table, recycler, planters, quarry. Expand the claim radius. Trade valuables to the Trader. Research blueprints.
* **Meta:** Legacy points from each run unlock permanent perks.

No build step, no dependencies: plain HTML + JavaScript, Canvas 2D graphics, Web Audio synthesized sound.

## Install on iPhone
1. Open the hosted page in **Safari** (e.g. `https://<user>.github.io/<repo>/zonefall/`).
2. Tap **Share → Add to Home Screen**.
3. Launch from the icon — it runs full-screen and offline. Play in landscape.

## Controls
Touch: left thumb moves (push to the edge to sprint), right thumb aims and fires (aim assist on), contextual **Interact** button (hold to gather), R reload, ⇄ swap, + heal, ● grenade.
Keyboard: WASD, mouse aim/fire, E interact, R, Q, H, G, I/Tab bag, B build, M map.

## Run locally
```
python3 -m http.server 8000
# open http://localhost:8000/zonefall/
```
