# Hexarch

A turn-based 4X strategy game for iPhone Safari, shipped as one self-contained HTML file.

- Play file: `docs/hexarch/index.html` (generated, do not edit by hand)
- Source: `hexarch/src` (engine has no DOM access, so it also runs headless in Node)

## Commands

```
node hexarch/tools/build.mjs          # inline src into docs/hexarch/index.html
node hexarch/tools/test-engine.mjs    # map generation, AI turns, save round trips
node hexarch/tools/test-ui.mjs [dir]  # drives the page at iPhone 14 size; optional screenshot dir
```

## Build plan

1. World, exploration, settling, menus, saves (this build)
2. Yields, growth, happiness, 24 buildings, 11 improvements, trade routes, 48-tech tree with Insights
3. Culture, borders, 30 policies
4. Religion: faith, pantheons, founding, beliefs, spread
5. Land and naval combat, siege, promotions, barbarians
6. Diplomacy and AI that plays every system
7. Wonders, six victory types, end screen, notifications, minimap
8. Sound, undo, hotseat, tutorial
9. Headless balance sim and tuning
