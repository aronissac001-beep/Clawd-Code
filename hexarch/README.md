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
hexarch/tools/deploy-pages.sh "msg"  # publish the built game to GitHub Pages (gh-pages branch)
node hexarch/tools/test-late.mjs  # late-game smoke test: every screen on a turn-180 huge-map empire
node hexarch/tools/test-rogue.mjs  # ruins, relics, Expedition drafts and curses (headless)
node hexarch/tools/test-expedition-ui.mjs [dir]  # an Expedition run in the browser
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
9. Balance: 100-game parallel harness (tools/balance.mjs) with a watchdog and fifteen tuning rounds (done). Latest 100 medium games with free cities, the Modern era, Golden Ages and spies, all map types: win rate when present 12–32% per civ (target ≤35%), victories 57% science / 37% culture / 6% diplomatic, median end turn 260, turn-100 leader/median score 1.24.

## Content added after the plan
- 10 natural wonders with discovery rewards and +1 happiness inside your borders
- 20 random events, each with two choices (can be turned off for a new game)
- Two more civilizations, Frostmark Holds and the Coralline Thalassocracy, and a Huge map for eight civs
- Great People: scientists, engineers, merchants, artists and generals
- Free cities: twelve city-states of six types to befriend with gold or conquer
- Leader quotes that change with mood; bit-packed saves
- Advisor picks for builds and research, a Codex encyclopedia, a Hall of Fame of finished games, Golden Ages, Quick start, spies, upgrade-ready badges
- A sixth era: six Modern techs before Grand Theory (54 techs in all), with Infantry, Landships, Field Guns, Destroyers, five buildings and two wonders
- Drawn unit icons, era-styled cities with walls and landmarks, and improvement art
- 3D terrain view (Settings): tilted camera, per-terrain height with shaded cliff faces, upright trees and peaks, distance haze, units standing on the ground
- Roguelike layer:
  - Ancient ruins on every map (can be turned off): the first land unit to step on one gets treasure, science, culture, faith, a map, recruits, a Builder, a citizen, experience, a relic, or a barbarian trap. AI scouts detour for them.
  - 21 relics, each unique in the world and feeding the same effect keys as policies; four are double-edged (Blood Crown, Hungry Coin, Mad Prophet's Skull, Iron Oath). The Dowsing Rod shows every ruin and doubles ruin rewards.
  - Expedition mode (main menu): choose one of three boons at the start and at every new era (relics or one-off windfalls), one ironman save slot with no undo, and Heat 0-6. Each Heat level adds a curse (raging barbarians, harder rivals, lean start, −2 happiness, an extra rival, armed rivals) and +25% run score; winning unlocks the next level. Runs are recorded in the Hall of Fame.
- Balance re-check with ruins and relics on (100 medium games): win rate when present 10–33% per civ, victories 50% science / 46% culture / 4% diplomatic, median end turn 255.
- Quests: at each new era (and once early on) human players may take one of two optional objectives with a deadline (loot ruins, found cities, grow a city, research, build a wonder, clear a camp, adopt policies, hold gold, construct buildings) for a relic or gold. The 📜 button tracks progress. Can be turned off for a new game.
- Barbarian hoards: about 30% of camps (marked 💎) have an extra guard and give a relic when destroyed.
- Short Expeditions: 150 turns, with all costs scaled to match.
- Living map (Settings): water glints and drifting cloud shadows, redrawn at about 9 fps while idle; off in battery mode.
- Balance re-check with quests and hoards (100 medium games): win rate when present 9–27% per civ, victories 59% science / 36% culture / 5% diplomatic.
- World omens: ten world-wide rules (Age of Reason, Gold Rush, Age of Zeal, Age of Muses, Age of Iron, Age of Plenty, Restless Forges, Long Peace, Lost Kingdoms with twice the ruins, Age of Wonders Past with a free relic for everyone). Every Expedition rolls one from its seed; a toggle adds one to other games.
- Event chains: Strange Lights → The Sky Stone, A Ship of the Sick → Grateful Sailors or Harbor Fever, The Hermit's Riddle → treasure or an empty pit (27 events in all).
- 3D cliff faces are pre-rendered per terrain and height; the idle living-map loop runs at about 6–7 fps.
- Fixed: the Expedition screen offered a Tiny map that does not exist (now Small, Medium, Large); city banners showed a doubled ❗! when idle.
- Balance re-check with event chains (100 medium games): win rate when present 11–30% per civ, victories 62% science / 30% culture / 8% diplomatic.
