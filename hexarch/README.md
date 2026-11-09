# Hexarch

A turn-based 4X strategy game for iPhone Safari, shipped as one self-contained HTML file.

- Play file: `docs/hexarch/index.html` (generated, do not edit by hand)
- Source: `hexarch/src` (engine has no DOM access, so it also runs headless in Node)

## Commands

```
node hexarch/tools/build.mjs          # inline src into docs/hexarch/index.html
node hexarch/tools/test-engine.mjs    # map generation, AI turns, save round trips
node hexarch/tools/test-ui.mjs [dir]  # drives the page at iPhone 14 size; optional screenshot dir
node hexarch/tools/sim.mjs [games] [turns] [size] [script]  # all-AI games with periodic stats
node hexarch/tools/warsim.mjs [games] [turns] [size] [script]  # wars, captures, eliminations, camps per game
```

## Build plan

1. World, exploration, settling, menus, saves (done)
2. Yields, growth, happiness, 22 buildings, 8 improvements plus roads and railroads, trade routes, 48-tech tree with Insights, culture borders (done)
3. Policies (6 trees, 30 policies, finishers), manual tile pinning and tile buying, new terrain art, fog, units, cities, yields lens, world map, event log (done)
4. Religion: faith, 10 pantheons, founding with 6 founder and 8 follower beliefs, 6 enhancers, spread by pressure, Missionaries, Inquisitors, faith purchases, religion lens (done)
5. Combat: 15 land and 5 naval units plus 6 unique units, embarkation, zones of control, siege, city defense and capture, promotions, upgrades, pillage, Forts, war and peace, barbarians (done)
6. Diplomacy: attitudes with visible reasons, trade builder (gold, gold per turn, luxuries, strategic resources, open borders, alliances, war on a third party), closed borders, shared allied vision, denounce, tribute, AI offers inbox, AI luxury swaps, alliances and sea invasions (done)
7. Wonders, six victory types, end screen, notifications, minimap
8. Sound, undo, hotseat, tutorial
9. Headless balance sim and tuning
