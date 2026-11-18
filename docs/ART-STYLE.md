# Embercrown: The Hold - art style guide

Crisp pixel art, drawn in code. This guide is the contract for every sprite, tile, icon and
illustration from Stage 1b on (owner D; renderer rules owner C). The contact sheet
`?debug=1&scene=art` shows every art key, the palette, the title and the app icons; check it
after any art change (it must report 0 errors and 0 keys not drawn).

## 1. Grid and scale

- **16 x 16 native pixels per map tile.** A tile is 32 world units, so one art pixel = 2 world units
  (`pixel.js NPX`). Every coordinate an art function draws at is a whole native pixel.
- Colonists, animals and Hollow are about **12-16 px tall** inside a 20-24 px sprite canvas (room for
  tools, swings and the outline). Bosses use a 32 px canvas. Furniture and buildings sit on the same
  grid: a bed is 16 x 32, a bench 32 x 16, a wall 16 x 16 plus an 8 px top face (3/4 view).
- Sprites are **baked once at native size** into small offscreen canvases (`pixel.js bake`,
  `tileCanvas`) and cached (`sprites.js` LRU). Nothing is drawn with paths at runtime.
- The renderer draws them at **integer scales with `imageSmoothingEnabled = false`**. The camera
  (`camera.js snap`) steps the zoom so one art pixel covers a whole number of device pixels from
  zoom 0.5 up (at DPR 2: 0.5, 0.75, 1, 1.25 ... 2). Below 0.5 (the strategic view) chunks scale
  smoothly and colonists become pips.
- Terrain chunks bake at the native 16 px per tile in every band (`render/config.js` tscale 0.5), so a
  near chunk is 128 x 128 px. Moving things snap their draw position to whole art pixels.
- UI icons are a separate 16 x 16 one-bit grid (`js/ui/icons.js`), drawn as crisp SVG rectangles in
  `currentColor`. The title illustration and app icons use the same palette at about 3 CSS px per art
  pixel (title) and whole-number scales (app icons: crest 4x in 192 and 180, 12x in 512, 9x maskable).

## 2. Palette (`js/engine/art/palette.js`)

33 named colours. **Every art function takes its colours from `PAL`, `RAMP`, `STONE_RAMP` or `ORE_PX`;
no other hex values in art code.** (The light texture's darkness tints are derived from the palette
and documented in `render/light.js`.)

| Group | Colours | Use |
|---|---|---|
| Cool neutrals | `ink night slate0-3 mist bone` | outlines, night, rock, the Hollow, highlights |
| Warm greys | `stone0 stone1` | granite, limestone, mortar |
| Earth and wood | `umber0-3 tan sand peach` | soil, wood, skin, sandstone |
| Firelight | `ember0 ember1 orange gold flame` | fire, sconces, the Hearth, UI accents |
| Surface greens | `moss0-3` | grass, trees, crops |
| Water | `deep water shallow` | rivers and lakes |
| Cloth, duskstone | `plum0 plum1` | clothes, duskstone, blight |
| Signals | `danger teal violet` | danger and foes, magic, Hollow eyes and rims |

- **Ramps** (`RAMP`) are 3-4 shades dark to light: `wood`, `granite`, `slate`, `cold`, `pale`,
  `sandy`, `skin`, `fire`, `ember`, `grass`, `water`, `plum`, `copper`, `tin`, `iron`, `steel`,
  `gold`, `hollow`, `teal`, `red`. A **material tint** maps to a ramp with `rampOf(materialId, family)`
  (`js/data/materials.js` ids; unknown ids fall back to the family: wood, granite, iron).
- Stones (`STONE_RAMP`) carry a ramp, a fleck colour and a motif (strata, fossil, speckle, cleave,
  column, vein, glint). Ores (`ORE_PX`) are `[dark, body, sparkle]`.
- New colours are added to the palette, with a ramp, never inline. Keep it near 32.

## 3. Outline

- **1 px dark outline (`ink`)** around every character, item, plant, furniture piece and building:
  `bake()` adds it automatically after the draw (`Px.outline`). Ground tiles have no outline; their
  edges are drawn as faces and lips.
- Walls and doors keep the outline off the sides where they join a neighbour (`opt.skip`), so a wall
  run reads as one mass.
- Hollow foes get a second, emissive 1 px rim (`pixelRim`) drawn after the darkness, so they read at
  night.

## 4. Shading and dithering

- **Light comes from the top-left.** Top and left edges take the light shade, bottom and right edges
  the dark shade (`Px.box`), and round things get their highlight up and left.
- 2-3 tones per surface; a 4th only for a highlight pixel. No gradients: transitions use the 4 x 4
  **Bayer ordered dither** (`palette.js BAYER4`, `dith(x, y, level 0-16)`, `Px.dither`), in absolute
  pixel coordinates so patterns line up across tiles.
- Contact shadows are a dithered `ink` ellipse under the feet (`Px.shadow`).
- Keep texture sparse: specks and cracks on 5-15% of a tile's pixels, never a full checker over a
  large area (water uses a level-2 dither plus a few ripple dashes).

## 5. Terrain

- **Rock**: autotiles from the 4-neighbour open mask (16 variants per stone, 2 hash variants each):
  a lit top lip and a dark front face on open sides, per-stone motif and cracks on the body, unknown
  rock dim with no motif. **Ore glints** are 1-2 px sparkles in the ore's colours, kept off the faces.
- **Floors**: mined floor (rough specks), rubble, smoothed stone, planks, flagstone (material ramp).
- **Surface**: grass with sparse tufts and flowers, meadow, soil, sand, marsh, moss, tilled rows, water
  with shore foam; fringes paint inside the tile so a 3 x 3 patch redraw matches a full bake.
- **Water shimmer**: 2 frames, drawn per frame over visible water (not baked).
- Trees and bushes are chunky clusters of 3-4 greens with an outline and 3 growth stages (sapling,
  young, grown); they never scale.

## 6. Characters and animation

- Silhouette at 16 px: head (4 x 4 face), hair (4 styles: cropped, braid, mane, topknot x 6 colours),
  beard (5), **tunic colour per role** (Miner, Builder, Crafter, Hauler, Generalist), belt, legs.
- Frames (`people.js`): 0 idle, 1 and 2 walk (cycle 1, 0, 2, 0 by distance walked), 3 and 4 the work
  swing with the job's tool (pick, axe, hammer, saw, mallet), 5-7 carry (a stack held at the chest).
- Foes and animals: 0 idle, 1 and 2 walk, 3 strike. Bosses are placeholders until Stage 3.
- The selection ring is a 1 px dashed pixel ellipse under the feet (flame and bone; danger red and bone when drafted).
- Animation is whole-frame swaps at 2-6 fps; positions snap to whole art pixels. No rotation or
  scaling of sprites; no sub-pixel easing.

## 7. Light and darkness (`render/light.js`)

- The sim light map `rt.light` stays the only light model. The renderer's darkness texture is 8 px
  per tile (one light pixel per 2 x 2 art pixels), drawn with smoothing off.
- Darkness is **posterised to 5 bands** (alpha 0, 50, 100, 160, 200) with Bayer-dithered edges, so
  light falls off in stepped rings.
- Tiles lit by fire (rt.light above their ambient) take a **warm cast**: the bands go gold near the
  flame, ember, then warm dark at the pool's rim, with a per-pixel falloff from the nearest flame
  (`FIRE_R`). Light still never crosses rock: the falloff only shapes tiles the sim already lit.
- Unlit open ground at night is cold blue; under rock it is near black; fog is flat.

## 8. Marks, zones and pips

- Designation marks: corner brackets and a glyph in the order's colour (mine flame, chop moss3, forbid
  danger ...). Zones: a dithered tint with dashed edges where the zone ends. Blueprints: a shallow-blue
  dither with a dashed border. Stripes and previews are pixel tiles too.
- Strategic pips (zoom < 0.5): a 10 px disc drawn at 2 CSS px per pixel in screen space, the role
  glyph inside, a mood ring; foes red; raids a dithered red hull with a count.

## 9. Rules of thumb

- Text is never drawn into art (the raid count is the only number; UI text stays HTML, >= 14 px).
- No emoji, no image files, no external art; original designs only.
- Every art key in `js/engine/art/keys.js` must draw (the contact sheet and `validate-data` check it).
- A new piece: pick its ramp, block the silhouette in the mid shade, add the top-left light and the
  bottom-right shadow, one highlight, then let `bake()` outline it. Check it at zoom 1 on a phone.
