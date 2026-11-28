// World map art (owner D; EMBERCROWN-WORLD.md 7.2 item 3, docs/ART-STYLE.md 12): the colours, glyphs and
// icons the world map atlas is baked from. C's js/engine/render/atlas.js does the baking and drawing.
// Pure data plus small cached canvases built on first use (nothing map-sized at import):
//   ATLAS_BIOME           realm biome id -> { r: [dark, mid, light, top], glyphs: [kind...], dens: 0-16 }
//   GLYPHS / GLYPH_KINDS  8 x 8 biome glyphs (tree clumps, pines, peaks, hills, dunes, reeds, waves, ...)
//   glyphSheet()          one canvas holding every glyph: { canvas, at: { kind: x } } (8 px apart, row 0)
//   SITE_KINDS            site icon kinds by size class; siteIcon(kind, tincture) -> an 18 x 18 canvas
//                         (16 x 16 one-bit bits in the tincture, a 1 px ink outline)
//   TINCTURES             civ border and icon colours (dotted heraldry tinctures), civ id -> TINCTURES[id % n]
//   ATLAS_LAYERS          the 10 map layers of 8.3 (Atlas, Elevation, ... Rock): field, kind, colour stops
//                         (palette names, dark-to-light or categorical) and the value range, for the bake
//                         and for the UI's 14 px legend strip
//   cloudTile(), CLOUD_ALPHA   a 64 x 64 tileable ink blob mask for the drifting cloud shadows, and its alpha
//   atlasArtSamples(doc)  contact-sheet figures: every biome ground set, glyph, site icon and layer ramp
// Every colour is a palette name (js/engine/art/palette.js); no hex in this file.
import { PAL, RAMP, BAYER4 } from './palette.js';
import { REALM_BIOMES } from '../../data/realm/biomes.js';
import { GROUND_SET_IDS, groundSetTerrains, paintSurfaceTile, setBiomePalettes } from './ground.js';
import { TER, W as MW } from '../../game/core/grid.js';

setBiomePalettes(REALM_BIOMES); // a numeric s.realm.embark.biome resolves to its ground set

const P = PAL;
/** Map colours of each realm biome: r is the 4-step ramp the hillshade walks (dark to light); flat land is r[2]. */
export const ATLAS_BIOME = Object.freeze({
  sea: { r: RAMP.water, glyphs: ['wave'], dens: 1 },
  peak: { r: [P.slate1, P.slate2, P.mist, P.bone], glyphs: ['peak', 'peak2'], dens: 16 },
  greenvale: { r: [P.moss1, P.moss2, P.moss3, P.sand], glyphs: ['tree', 'hill'], dens: 5 },
  elderwood: { r: [P.moss0, P.moss0, P.moss1, P.moss2], glyphs: ['tree', 'tree2'], dens: 13 },
  ruins: { r: [P.slate0, P.slate1, P.slate2, P.plum1], glyphs: ['ruin', 'tree'], dens: 6 },
  ashlands: { r: [P.ink, P.slate0, P.stone0, P.slate1], glyphs: ['cinder'], dens: 6 },
  fen: { r: [P.moss0, P.leaf, P.moss1, P.moss2], glyphs: ['reed'], dens: 8 },
  moor: { r: [P.umber1, P.plum0, P.plum1, P.rose], glyphs: ['heather', 'hill'], dens: 7 },
  taiga: { r: [P.moss0, P.moss0, P.leaf, P.moss1], glyphs: ['pine', 'pine2'], dens: 12 },
  tundra: { r: [P.slate2, P.slate3, P.frost, P.bone], glyphs: ['rime'], dens: 5 },
  saltflat: { r: [P.umber3, P.tan, P.sand, P.frost], glyphs: ['crack', 'dune'], dens: 5 },
  redscar: { r: [P.ember0, P.umber2, P.ember1, P.tan], glyphs: ['mesa'], dens: 6 },
  shore: { r: [P.tan, P.sand, P.peach, P.bone], glyphs: ['dune'], dens: 3 },
  highcrag: { r: [P.stone0, P.slate2, P.stone1, P.moss3], glyphs: ['crag', 'peak2'], dens: 8 },
});
/** The colours of a realm biome index (unknown: greenvale). */
export const biomeArt = (b) => ATLAS_BIOME[(REALM_BIOMES[b] || REALM_BIOMES[2]).id] || ATLAS_BIOME.greenvale;

// ---- glyphs: 8 x 8, '.' clear, other characters index the glyph's colour map -------------------------
export const GLYPHS = Object.freeze({
  tree: { c: { o: P.moss0, d: P.moss1, m: P.moss2, l: P.moss3, t: P.umber1 }, rows: ['..oo....', '.olmo...', 'olmmdo..', 'odmddo..', '.oddo...', '..to.oo.', '..t.olmo', '....odto'] },
  tree2: { c: { o: P.moss0, d: P.moss1, m: P.moss2, l: P.moss3, t: P.umber1 }, rows: ['...oo...', '..olmo..', '.olmmdo.', 'olmmmddo', 'odmmdddo', '.oddddo.', '...tt...', '...tt...'] },
  pine: { c: { o: P.moss0, d: P.leaf, m: P.moss1, l: P.moss2, t: P.umber1 }, rows: ['...o....', '..olo...', '.olmdo..', '..omo...', '.olmdo..', 'olmmddo.', '.ooooo..', '...t....'] },
  pine2: { c: { o: P.moss0, d: P.leaf, m: P.moss1, l: P.moss2, t: P.umber1 }, rows: ['.o...o..', 'olo.olo.', 'omo.omo.', 'olmoolmo', 'ommdommd', '.oo..oo.', '..t...t.', '........'] },
  peak: { c: { o: P.slate0, d: P.slate1, m: P.slate2, l: P.bone, s: P.mist }, rows: ['...o....', '..olo...', '..olso..', '.olmmdo.', '.ommmddo', 'olmmmddo', 'ommmdddo', 'oooooooo'] },
  peak2: { c: { o: P.slate0, d: P.slate1, m: P.slate2, l: P.mist }, rows: ['........', '....o...', '...olo..', '..olmdo.', '.olmmddo', 'olmmmddo', 'oooooooo', '........'] },
  hill: { c: { o: P.moss0, d: P.moss1, l: P.moss3 }, rows: ['........', '........', '........', '...ooo..', '..olldo.', '.olllddo', '.oooooo.', '........'] },
  dune: { c: { d: P.umber3, l: P.peach }, rows: ['........', '........', '..lll...', '.l...d..', 'l.....d.', '....lll.', '...l...d', '..l.....'] },
  reed: { c: { s: P.moss3, h: P.umber2, w: P.shallow }, rows: ['.h...h..', '.s.h.s..', '.s.s.s.h', 's..s.s.s', 's..s..ss', '.s.s..s.', 'wwwwwww.', '........'] },
  wave: { c: { l: P.shallow, f: P.mist }, rows: ['........', '........', '.ff.....', 'l..l....', '....ff..', '...l..l.', '........', '........'] },
  ruin: { c: { o: P.ink, d: P.slate1, l: P.slate3, v: P.violet }, rows: ['........', '.o......', 'olo..o..', 'odo.olo.', 'odooodo.', 'odldldo.', 'oooooooo', '..v.....'] },
  cinder: { c: { o: P.ink, d: P.slate0, m: P.stone0, e: P.ember1, f: P.orange }, rows: ['........', '...ef...', '...oo...', '..omdo..', '.ommddo.', 'ommmddo.', 'oooooooo', '........'] },
  heather: { c: { r: P.rose, p: P.plum1, d: P.plum0 }, rows: ['........', '.r...r..', 'rpr.rpr.', '.pd..pd.', '...r....', '..rpr...', '..dpd...', '........'] },
  crack: { c: { c: P.tan, w: P.bone }, rows: ['........', '.c...c..', '..c.c...', '...c..ww', '..c.c...', '.c...c..', 'c.....c.', '........'] },
  rime: { c: { w: P.bone, f: P.frost, s: P.slate2, g: P.moss3 }, rows: ['........', '..ff....', '.fwwf...', '.sffs.g.', '..ss..gg', '....ff..', '...fwwf.', '....ss..'] },
  mesa: { c: { o: P.ember0, b: P.ember1, t: P.tan, d: P.umber1 }, rows: ['........', '..tttt..', '.obbbbo.', '.otttto.', '.obbbbo.', 'odddddo.', 'oooooooo', '........'] },
  crag: { c: { o: P.slate0, d: P.slate1, l: P.slate3, g: P.moss2 }, rows: ['........', '..oo....', '.olldo..', '.oldddo.', 'olddddoo', 'oooooldo', 'g..gooooo'.slice(0, 8), '........'] },
});
export const GLYPH_KINDS = Object.freeze(Object.keys(GLYPHS));

let GSHEET = null;
/** Every glyph baked into one canvas, 8 px apart: { canvas, at: { kind: x } }. */
export function glyphSheet() {
  if (GSHEET) return GSHEET;
  const c = document.createElement('canvas'); c.width = GLYPH_KINDS.length * 8; c.height = 8;
  const g = c.getContext('2d'), at = {};
  GLYPH_KINDS.forEach((k, n) => {
    at[k] = n * 8;
    const G = GLYPHS[k];
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const ch = G.rows[y][x], col = ch && G.c[ch]; if (col) { g.fillStyle = col; g.fillRect(n * 8 + x, y, 1, 1); } }
  });
  GSHEET = { canvas: c, at };
  return GSHEET;
}

// ---- site icons: 16 x 16 one-bit, by size class (hex rows, 4 digits a row) ---------------------------
export const SITE_KINDS = Object.freeze(['camp', 'hamlet', 'village', 'town', 'city', 'hold', 'tower', 'ruin', 'lair', 'grove', 'battlefield', 'pin']);
const ICON_BITS = Object.freeze({
  camp: '0000000000000100038007c00ee01c703c787c7cffff00000000000000000000',
  hamlet: '000000000000018003c007e00ff01ff80ff00db00db00f300f30000000000000',
  village: '000000000000180c3c1e7e3fff7f6e3f6e377e37763f763b0000000000000000',
  town: '000000002814381c3bdc3ffc3a5c3ffc3ffc3e7c3c3c3c3c3ffc000000000000',
  city: '000001002ba83bb83ab87ffe5ab47ffe7ffe7e7e7c3e7c3effff000000000000',
  hold: '00000000018003c007e00ff01e783c3c781e73ce67e666666666ffff00000000',
  tower: '0000000002a003e003e001c0014001c001c0014003e003e007f0000000000000',
  ruin: '00000000000010001800190019801588154c155c3ffc64c60000000000000000',
  lair: '000000000000000003c00ff01ff83c3c381c781e718e724effff000000000000',
  grove: '0000018003c037ec7bde7bdefdbf7bde33cc1188118811880000000000000000',
  battlefield: '00004002200410080810042002400180018002402c3418182424400200000000',
  pin: '000003c007e00c300c300c3007e003c003c00180018001800000000000000000',
});
const ICONS = new Map();
/** The icon of a site kind in a tincture: an 18 x 18 canvas (the 16 x 16 bits at +1, a 1 px ink outline). */
export function siteIcon(kind, tint = P.bone) {
  const key = kind + tint;
  let c = ICONS.get(key);
  if (c) return c;
  const hex = ICON_BITS[kind] || ICON_BITS.pin, on = (x, y) => x >= 0 && y >= 0 && x < 16 && y < 16 && ((parseInt(hex.slice(y * 4, y * 4 + 4), 16) >> (15 - x)) & 1) === 1;
  c = document.createElement('canvas'); c.width = 18; c.height = 18;
  const g = c.getContext('2d');
  g.fillStyle = P.ink;
  for (let y = -1; y <= 16; y++) for (let x = -1; x <= 16; x++) if (!on(x, y) && (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1))) g.fillRect(x + 1, y + 1, 1, 1);
  g.fillStyle = tint;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (on(x, y)) g.fillRect(x + 1, y + 1, 1, 1);
  ICONS.set(key, c);
  return c;
}
/** Civ tinctures (borders and site icons): civ id -> TINCTURES[id % TINCTURES.length]. */
export const TINCTURES = Object.freeze([P.danger, P.gold, P.teal, P.violet, P.bone, P.orange, P.shallow, P.rose, P.moss3, P.frost, P.ember1, P.plum1, P.sand]);

// ---- the 10 layers of 8.3 ------------------------------------------------------------------------------
// kind 'seq': value -> t in 0..1 over range, stops dark/low to high (Bayer-dithered between stops);
// 'cat': the stop of the value; 'atlas': the biome art. Ramps are colour-blind safe (8.9): temperature
// blue-orange, drainage purple-green, the rest single-hue with a steady lightness change.
export const ATLAS_LAYERS = Object.freeze([
  { id: 'atlas', kind: 'atlas' },
  { id: 'elev', field: 'elev', kind: 'seq', land: true, range: [0, 255], stops: ['moss1', 'moss2', 'moss3', 'tan', 'umber3', 'stone1', 'slate3', 'bone'] },
  { id: 'temp', field: 'temp', kind: 'seq', signed: true, range: [-25, 30], unit: 'C', stops: ['deep', 'water', 'shallow', 'frost', 'sand', 'gold', 'orange', 'ember1'] },
  { id: 'rain', field: 'rain', kind: 'seq', range: [0, 255], stops: ['sand', 'tan', 'moss3', 'moss2', 'leaf', 'water', 'deep'] },
  { id: 'drain', field: 'drain', kind: 'seq', range: [0, 255], stops: ['plum0', 'plum1', 'rose', 'peach', 'moss3', 'moss2', 'moss1'] },
  { id: 'ember', field: 'volc', kind: 'seq', range: [0, 255], stops: ['slate1', 'stone0', 'ember0', 'ember1', 'orange', 'gold', 'flame'] },
  { id: 'hollow', field: 'taint', kind: 'seq', range: [0, 255], stops: ['mist', 'slate3', 'violet', 'plum1', 'plum0', 'ink'] },
  { id: 'wild', field: 'wild', kind: 'seq', range: [0, 255], stops: ['sand', 'moss3', 'moss2', 'moss1', 'moss0'] },
  { id: 'peoples', field: 'owner', kind: 'cat', none: 'stone1', stops: TINCTURES.map((c) => Object.keys(P).find((k) => P[k] === c)) },
  { id: 'rock', field: 'geo', kind: 'cat', stops: ['sand', 'stone1', 'slate1', 'plum1', 'ember1'] },
]);
export const layerDef = (id) => ATLAS_LAYERS.find((l) => l.id === id) || ATLAS_LAYERS[0];

// ---- cloud shadows -----------------------------------------------------------------------------------
let CLOUD = null;
/**
 * A 64 x 64 tileable mask of solid ink blobs (the drifting cloud shadows). C draws it at 2 map px a cloud px
 * with a low alpha, so a shadow darkens the land under it by one even step and keeps the map's pixels crisp.
 */
export function cloudTile() {
  if (CLOUD) return CLOUD;
  const N = 64, c = document.createElement('canvas'); c.width = N; c.height = N;
  const g = c.getContext('2d'); g.fillStyle = P.ink;
  // integer value noise on a 32 and a 16 px lattice (both wrap at 64)
  const h = (x, y) => { let v = (((x & 63) * 374761393) ^ ((y & 63) * 668265263) ^ 0x2545f491) | 0; v = Math.imul(v ^ (v >>> 13), 1274126177); return ((v ^ (v >>> 16)) >>> 0) % 256; };
  const vn = (x, y, s) => {
    const gx = Math.floor(x / s), gy = Math.floor(y / s), fx = (x - gx * s) / s, fy = (y - gy * s) / s;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), w = 64 / s;
    const a = h((gx % w) * s, (gy % w) * s), b = h(((gx + 1) % w) * s, (gy % w) * s), cc = h((gx % w) * s, ((gy + 1) % w) * s), d = h(((gx + 1) % w) * s, ((gy + 1) % w) * s);
    return (a + (b - a) * sx) + ((cc + (d - cc) * sx) - (a + (b - a) * sx)) * sy;
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (vn(x, y, 32) * 0.7 + vn(x, y, 16) * 0.3 > 145) g.fillRect(x, y, 1, 1);
  CLOUD = c;
  return c;
}
/** The alpha C draws the cloud tile at (one even shade step; never a gradient). */
export const CLOUD_ALPHA = 0.16;

// ---- contact sheet -----------------------------------------------------------------------------------
const SAMPLE_ROWS = [
  [TER.GRASS, TER.GRASS, TER.MEADOW, TER.MEADOW, TER.DIRT, TER.DIRT, TER.RICH, TER.SAND, TER.SAND, TER.MARSH, TER.SHALLOW, TER.DEEP],
  [TER.GRASS, TER.MEADOW, TER.MEADOW, TER.DIRT, TER.DIRT, TER.RICH, TER.SAND, TER.SAND, TER.MARSH, TER.MARSH, TER.SHALLOW, TER.DEEP],
];
/** A strip of every soft terrain of a ground set (with its fringes), 12 x 2 tiles at native size: a canvas. */
export function groundSetSample(set, doc = document) {
  const c = doc.createElement('canvas'); c.width = 12 * 16; c.height = 2 * 16;
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.scale(0.5, 0.5);
  const fake = { L: { terrain: new Uint8Array(MW * 2) }, realm: set === 'default' ? null : { embark: { biome: set } } };
  for (let y = 0; y < 2; y++) for (let x = 0; x < 12; x++) fake.L.terrain[y * MW + x] = SAMPLE_ROWS[y][x];
  for (let y = 0; y < 2; y++) for (let x = 0; x < 12; x++) paintSurfaceTile(g, fake, x, y, true);
  return c;
}
/** Contact-sheet figures: { figures, keys }: every ground set, the glyph sheet, site icons and layer ramps. */
export function atlasArtSamples(doc = document) {
  const figures = [], keys = [];
  const fig = (c, w, html) => { c.style.width = `${w}px`; c.style.imageRendering = 'pixelated'; const f = doc.createElement('figure'), cap = doc.createElement('figcaption'); cap.innerHTML = html; f.append(c, cap); figures.push(f); };
  for (const set of GROUND_SET_IDS) {
    const t = groundSetTerrains(set).length;
    fig(groundSetSample(set, doc), 12 * 16 * 3, `<b>ground.${set}</b> ${set === 'default' ? 'greenvale, elderwood, ruins, ashlands and holds with no world' : `${t} terrains repainted`}`);
    keys.push(`ground.${set}`);
  }
  { const gs = glyphSheet(), c = doc.createElement('canvas'); c.width = gs.canvas.width; c.height = 8; const g = c.getContext('2d'); g.fillStyle = P.sand; g.fillRect(0, 0, c.width, 8); g.drawImage(gs.canvas, 0, 0); fig(c, c.width * 4, `<b>atlas.glyphs</b> ${GLYPH_KINDS.join(', ')}`); keys.push('atlas.glyphs'); }
  { const c = doc.createElement('canvas'); c.width = SITE_KINDS.length * 20; c.height = 20; const g = c.getContext('2d'); g.fillStyle = P.moss2; g.fillRect(0, 0, c.width, 20); SITE_KINDS.forEach((k, n) => g.drawImage(siteIcon(k, TINCTURES[n % TINCTURES.length]), n * 20 + 1, 1)); fig(c, c.width * 3, `<b>atlas.sites</b> ${SITE_KINDS.join(', ')}`); keys.push('atlas.sites'); }
  for (const L of ATLAS_LAYERS) {
    if (!L.stops) continue;
    const c = doc.createElement('canvas'); c.width = L.stops.length * 8; c.height = 6; const g = c.getContext('2d');
    L.stops.forEach((s, n) => { g.fillStyle = P[s]; g.fillRect(n * 8, 0, 8, 6); });
    fig(c, c.width * 3, `<b>atlas.layer.${L.id}</b> ${L.kind}`); keys.push(`atlas.layer.${L.id}`);
  }
  { const c = doc.createElement('canvas'); c.width = 64; c.height = 64; const g = c.getContext('2d'); g.fillStyle = P.moss2; g.fillRect(0, 0, 64, 64); g.drawImage(cloudTile(), 0, 0); fig(c, 128, '<b>atlas.clouds</b> 64 x 64 tile'); keys.push('atlas.clouds'); }
  return { figures, keys };
}
