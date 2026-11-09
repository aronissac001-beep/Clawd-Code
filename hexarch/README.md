# Hexarch

A turn-based 4X strategy game for iPhone Safari, shipped as one self-contained HTML file.

- Play file: `docs/hexarch/index.html` (generated, do not edit by hand)
- Source: `hexarch/src` (engine has no DOM access, so it also runs headless in Node)

## Commands

```
node hexarch/tools/build.mjs          # inline src into docs/hexarch/index.html
node hexarch/tools/test-engine.mjs    # map generation, AI turns, save round trips
node hexarch/tools/test-ui.mjs [dir]  # drives the page at iPhone 14 size; optional screenshot dir
node hexarch/tools/test-hotseat.mjs [dir]  # two players sharing the phone
node hexarch/tools/vicsim.mjs 4 medium continents  # full all-AI games: who wins, how and when
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
7. Wonders and victory: 22 world wonders, 5 great projects, six victory types with live progress, score, history graphs, end screen, warnings, drawn unit icons (done)
8. Synthesized sound effects and generative music, move undo, pass-and-play hotseat for up to 4 players, first-game tips (done)
9. Balance: 100-game parallel harness (tools/balance.mjs) with a watchdog and seven tuning rounds (done). Latest 100 medium games with free cities, all map types: win rate when present 5–35% per civ (target ≤35%), victories 63% science / 29% culture / 8% diplomatic, turn-100 leader/median score 1.21, no military unit above 13% of builds.

## Content added after the plan
- 10 natural wonders with discovery rewards and +1 happiness inside your borders
- 20 random events, each with two choices (can be turned off for a new game)
- Two more civilizations, Frostmark Holds and the Coralline Thalassocracy, and a Huge map for eight civs
- Great People: scientists, engineers, merchants, artists and generals
- Free cities: twelve city-states of six types to befriend with gold or conquer
- Leader quotes that change with mood; bit-packed saves
- A sixth era: six Modern techs before Grand Theory (54 techs in all), with Infantry, Landships, Field Guns, Destroyers, five buildings and two wonders
- Drawn unit icons, era-styled cities with walls and landmarks, and improvement art
