// Stage 2 structure kit (owner D; doc 7.2-7.9, 14.8 row D; docs/ART-STYLE.md). The Hamlet and Village
// buildables (and the Camp ones that were placeholders) as KIT PARTS: a few bases that read the key
// they draw (o.key) for their variant, plus four props, in the material's ramp (o.r) with the 1 px
// ink outline added by the bake. Stage 2 adds 40 structure parts (the 14.8 budget is 45):
//   bases   shell kiln stove mill vat rack chest bedroll fence bigdoor field tower ballista trap barricade
//           stele beacon bellpost well grave bellows switch yard statue hanging stall fireplace potwheel
//           desks plot headframe frame.seat
//   props   wares (the goods on a bench, by key) wallmark (stakes, bands, slit, pane) sign (a shop board
//           by key) bunkframe
//   floors  cobbles bricks carpet deck (ground.js paints them through paintGround; drawers here)
// Same contract as kit.js: PARTS2[name](p, o) in footprint-local native px, (0, 0) the footprint's
// top-left; it may draw up to TOP2[name] px above it. o.W, o.H: footprint px; o.fam: wood | stone |
// metal; o.r: the material ramp; o.key: the art key; o.v: variant; o.mask: wall neighbours.

import { PAL, RAMP, dith } from './palette.js';
import { board, block, boxOf } from './kit.js';

const P = PAL;
const ramp = (o, fb = RAMP.wood) => o.r || fb;
const k_ = (o) => (o.key || '').replace(/^struct\./, '');

/** Height (px) each Stage 2 base draws above the top of its footprint. */
export const TOP2 = {
  shell: 14, kiln: 14, stove: 8, mill: 22, vat: 6, rack: 12, chest: 3, bedroll: 1, fence: 6, bigdoor: 12, field: 6, tower: 30,
  ballista: 8, trap: 3, barricade: 6, stele: 14, beacon: 10, bellpost: 18, well: 10, grave: 6, bellows: 4, switch: 10, yard: 10,
  statue: 18, hanging: 16, stall: 14, fireplace: 12, potwheel: 6, desks: 6, plot: 14, headframe: 26, 'frame.seat': 6,
  cobbles: 0, bricks: 0, carpet: 0, deck: 0,
  // Z2 (Z2_PARTS): the bench add-ons, the winch, the cell bed and the memorial slab
  addon: 12, winch: 16, cellbed: 6, slab: 14,
};

// ---- Shared pieces ----------------------------------------------------------------------------------
/** A pitched roof seen in 3/4: the ridge along the width, thatch (wood) or slates (stone), eaves overhang. */
function roof(p, x, y, w, h, fam, v = 0) {
  const r = fam === 'wood' ? RAMP.sandy : fam === 'metal' ? RAMP.iron : RAMP.slate;
  p.rect(x - 1, y, w + 2, h, r[1]);
  p.hl(x - 1, y, w + 2, r[3]); p.hl(x - 1, y + 1, w + 2, r[2]);
  for (let yy = y + 3; yy < y + h - 1; yy += 3) {
    for (let xx = x; xx < x + w; xx += fam === 'wood' ? 2 : 4) p.px(xx + ((yy >> 1) & 1) + (v & 1), yy, r[0]);
    if (fam !== 'wood') p.hl(x - 1, yy + 1, w + 2, r[0]);
  }
  p.hl(x - 1, y + h - 1, w + 2, r[0]);
  p.dither(x + w - 4, y + 2, 4, h - 3, r[0], 6);
}
/** A front wall face with a door and windows (lit windows at night are the renderer's business). */
function frontWall(p, x, y, w, h, r, fam, door = true) {
  if (fam === 'wood') { p.rect(x, y, w, h, r[1]); for (let xx = x + 3; xx < x + w; xx += 4) p.vl(xx, y, h, r[0]); p.hl(x, y, w, r[2]); }
  else { p.rect(x, y, w, h, r[1]); for (let yy = y + 3; yy < y + h; yy += 3) p.hl(x, yy, w, r[0]); for (let yy = y; yy < y + h; yy += 6) for (let xx = x + ((yy >> 1) & 2) + 2; xx < x + w; xx += 6) p.vl(xx, yy, 3, r[0]); p.hl(x, y, w, r[2]); }
  p.vl(x, y, h, r[2]); p.vl(x + w - 1, y, h, r[0]);
  if (door) { const dx = x + (w >> 1) - 3; p.rect(dx, y + h - 9, 6, 9, P.night); p.rect(dx + 1, y + h - 8, 4, 8, RAMP.darkwood[1]); p.vl(dx + 3, y + h - 8, 8, RAMP.darkwood[0]); p.px(dx + 4, y + h - 4, P.gold); }
  for (let xx = x + 3; xx + 4 < x + w - 2; xx += 12) { if (door && Math.abs(xx + 2 - (x + (w >> 1))) < 6) continue; p.rect(xx, y + 3, 4, 4, P.night); p.px(xx + 1, y + 4, P.gold); p.hl(xx, y + 7, 4, r[0]); }
}
const smoke = (p, x, y) => { p.px(x, y, P.slate2); p.px(x + 1, y - 2, P.slate3); p.px(x, y - 4, P.mist); };

// ---- Parts --------------------------------------------------------------------------------------------
export const PARTS2 = {
  // A walled and roofed building (cottage, longhouse, stone house, granary, coop, barn, tavern, barracks,
  // ice house, temple, crypt, smokehouse, hunter's lodge, fisher's hut): roof over the back two thirds,
  // the front wall with a door, and a key-specific touch (chimney, louvre, hay door, steeple, net).
  shell(p, o) {
    const r = ramp(o), W = o.W, Hh = o.H, k = k_(o), fam = o.fam;
    const wallH = Math.min(14, Math.max(10, Hh >> 1)), roofH = Hh - wallH + 10;
    roof(p, 1, -10, W - 2, roofH, k === 'icehouse' || k === 'crypt' || k === 'stonehouse' || k === 'temple' ? 'stone' : fam, o.v);
    frontWall(p, 1, Hh - wallH, W - 2, wallH, r, fam, k !== 'granary');
    p.dither(1, Hh, W - 2, 1, P.ink, 8);
    if (k === 'hut' || k === 'longhouse' || k === 'stonehouse' || k === 'tavern' || k === 'barracks' || k === 'smokehouse') { // chimney
      const cx = W - 10; block(p, cx, -14, 4, 8, RAMP.granite); smoke(p, cx + 1, -16);
    }
    if (k === 'granary') { p.rect((W >> 1) - 4, Hh - wallH + 2, 8, 6, RAMP.darkwood[1]); p.hl((W >> 1) - 4, Hh - wallH + 2, 8, RAMP.darkwood[2]); for (let x = 3; x < W - 3; x += 5) p.rect(x, Hh - 2, 2, 3, r[0]); }
    if (k === 'barn') { p.line((W >> 1) - 5, Hh - 9, (W >> 1) + 5, Hh - 1, r[2]); p.line((W >> 1) + 5, Hh - 9, (W >> 1) - 5, Hh - 1, r[2]); p.rect((W >> 1) - 3, -6, 6, 4, P.night); }
    if (k === 'temple') { p.rect((W >> 1) - 2, -22, 4, 12, RAMP.granite[2]); p.px(W >> 1, -24, P.gold); p.hl((W >> 1) - 1, -21, 3, P.gold); }
    if (k === 'crypt') { p.rect((W >> 1) - 5, Hh - wallH - 2, 10, 2, RAMP.granite[3]); p.px((W >> 1) - 1, Hh - wallH - 4, P.bone); p.px(W >> 1, Hh - wallH - 4, P.bone); }
    if (k === 'icehouse') { p.dither(2, -9, W - 4, 4, P.mist, 6); p.hl(2, -10, W - 4, P.bone); }
    if (k === 'coop') { p.line(W - 6, Hh - 1, W - 2, Hh - 6, RAMP.wood[1]); p.px(4, Hh - 2, P.bone); p.px(6, Hh - 1, P.gold); }
    if (k === 'fisher') { for (let x = 2; x < W - 2; x += 3) p.px(x, -12 + ((x >> 1) & 1), P.slate3); p.line(W - 4, Hh - 2, W + 1, Hh - 10, RAMP.wood[0]); }
    if (k === 'huntstand') { p.rect(2, Hh - wallH + 3, 5, 4, RAMP.wood[3]); p.px(3, Hh - wallH + 2, RAMP.wood[1]); p.px(5, Hh - wallH + 2, RAMP.wood[1]); }
  },
  // Furnaces and kilns: a domed clay or brick body with a glowing mouth (charcoal kiln, brick kiln,
  // smokehouse oven, glassworks, blast furnace: taller, banded).
  kiln(p, o) {
    const W = o.W, Hh = o.H, k = k_(o), r = k === 'charkiln' ? RAMP.earth : k === 'blastfurnace' ? RAMP.iron : RAMP.red;
    const top = k === 'blastfurnace' ? -14 : -8, cx = W >> 1;
    for (let y = top; y < Hh - 1; y++) {
      const t = (y - top) / (Hh - 1 - top), hw = Math.round((W / 2 - 2) * Math.min(1, 0.45 + t * 0.9));
      p.hl(cx - hw, y, hw * 2, dith(cx, y, 8) && y < top + 3 ? r[2] : r[1]);
      p.px(cx - hw, y, r[2]); p.px(cx + hw - 1, y, r[0]);
    }
    p.dither(cx, top + 2, (W >> 1) - 3, Hh - top - 4, r[0], 5);
    if (k === 'blastfurnace') for (let y = top + 4; y < Hh - 4; y += 6) p.hl(cx - (W >> 1) + 3, y, W - 6, P.slate1);
    if (k === 'kiln' || k === 'blastfurnace') for (let y = top + 3; y < Hh - 2; y += 3) for (let x = cx - 6; x < cx + 6; x += 4) p.px(x + ((y >> 1) & 2), y, r[0]);
    // the mouth and its glow
    p.rect(cx - 4, Hh - 9, 8, 6, P.ink); p.rect(cx - 3, Hh - 7, 6, 4, P.ember1); p.hl(cx - 2, Hh - 5, 4, P.orange); p.px(cx, Hh - 6, P.gold);
    p.rect(cx - 2, top - 3, 4, 3, r[0]); smoke(p, cx, top - 5);
    if (k === 'glassworks') { p.px(cx + 6, Hh - 4, P.teal); p.px(cx + 8, Hh - 4, P.shallow); p.px(cx + 7, Hh - 5, P.teal); }
  },
  // The hearthstove kitchen: a stone range with two pots and a chimney hood.
  stove(p, o) {
    const W = o.W, Hh = o.H, r = RAMP.granite;
    block(p, 0, -2, W, Hh - 2, r);
    p.rect(2, Hh - 8, W - 4, 5, P.ink); p.rect(3, Hh - 7, W - 6, 3, P.ember1); p.hl(4, Hh - 6, W - 8, P.orange);
    for (const x of [5, W - 11]) { p.ellipse(x + 3, 2, 4, 3, P.slate1); p.hl(x, 0, 6, P.slate2); p.px(x + 1, 0, P.slate3); }
    p.rect(W - 6, -8, 5, 7, r[1]); p.vl(W - 6, -8, 7, r[2]); smoke(p, W - 4, -10);
  },
  // Wind and water: a windmill (a timber tower with four sails), a watermill or a water wheel.
  mill(p, o) {
    const W = o.W, Hh = o.H, k = k_(o), r = ramp(o), cx = W >> 1;
    if (k === 'windmill') {
      for (let y = -8; y < Hh - 1; y++) { const hw = Math.round(4 + ((y + 8) / (Hh + 8)) * (W / 2 - 6)); p.hl(cx - hw, y, hw * 2, y % 4 === 0 ? r[0] : r[1]); p.px(cx - hw, y, r[2]); }
      frontWall(p, cx - 5, Hh - 10, 10, 9, r, 'wood', true);
      const hy = -6;
      // four sails: a spar each with a lattice of cloth along it (light top-left, shaded bottom-right)
      for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        p.line(cx, hy, cx + dx * 12, hy + dy * 12, RAMP.darkwood[1]);
        for (let k = 3; k <= 11; k++) { const x = cx + dx * k, y = hy + dy * k; p.px(x + dy, y - dx, dx + dy < 0 ? P.bone : P.mist); p.px(x + 2 * dy, y - 2 * dx, k & 1 ? P.mist : P.slate3); }
      }
      p.disc(cx, hy, 2, RAMP.darkwood[0]);
      return;
    }
    // a wheel on the water side (east) and, for the mill, a little house
    if (k === 'watermill') { roof(p, 1, -8, W - 12, Hh - 4, 'wood', o.v); frontWall(p, 1, Hh - 11, W - 12, 11, r, 'wood', true); }
    const wx = k === 'watermill' ? W - 7 : cx, wy = Hh / 2;
    p.ring(wx, wy, 7, RAMP.darkwood[1]); p.ring(wx, wy, 6, RAMP.darkwood[2]);
    for (let a = 0; a < 8; a++) { const x = Math.round(wx + Math.cos(a * 0.785) * 6), y = Math.round(wy + Math.sin(a * 0.785) * 6); p.line(wx, wy, x, y, RAMP.darkwood[0]); p.rect(x - 1, y - 1, 2, 2, RAMP.wood[2]); }
    p.disc(wx, wy, 1, P.slate2);
    p.rect(wx - 8, Hh - 3, 16, 3, P.shallow); p.dither(wx - 8, Hh - 3, 16, 3, P.water, 8); p.hl(wx - 6, Hh - 3, 3, P.mist);
  },
  // Vats and casks: the fermenting cask, the brewery's vats, the tannery's pits, the feed trough.
  vat(p, o) {
    const W = o.W, Hh = o.H, k = k_(o), r = RAMP.darkwood;
    const barrel = (x, y, w, h) => { p.rect(x, y, w, h, r[1]); p.vl(x, y, h, r[2]); p.vl(x + w - 1, y, h, r[0]); p.hl(x, y + 2, w, P.slate1); p.hl(x, y + h - 3, w, P.slate1); p.ellipse(x + w / 2, y, w / 2, 2, r[2]); p.hl(x + 1, y - 1, w - 2, r[3]); };
    if (k === 'cask') { barrel(3, 1, W - 6, Hh - 3); p.px(W >> 1, Hh - 6, P.gold); return; }
    if (k === 'trough') { board(p, 1, 3, W - 2, Hh - 5, r); p.rect(3, 5, W - 6, Hh - 10, P.sand); p.dither(3, 5, W - 6, Hh - 10, P.tan, 6); return; }
    if (k === 'tannery') {
      for (const x of [2, (W >> 1) + 1]) { block(p, x, 4, (W >> 1) - 3, Hh - 8, RAMP.granite); p.rect(x + 2, 6, (W >> 1) - 7, Hh - 12, P.umber1); p.dither(x + 2, 6, (W >> 1) - 7, Hh - 12, P.umber2, 6); }
      p.rect(4, -4, 10, 7, RAMP.skin[1]); p.hl(4, -4, 10, RAMP.skin[2]); p.line(3, -6, W - 3, -6, RAMP.wood[1]);
      return;
    }
    // brewery: two big vats and a copper kettle
    barrel(2, 0, (W >> 1) - 3, Hh - 4); barrel((W >> 1) + 1, 4, (W >> 1) - 3, Hh - 8);
    p.ellipse(W - 6, Hh - 6, 4, 3, RAMP.copper[1]); p.hl(W - 9, Hh - 8, 6, RAMP.copper[2]);
  },
  // Racks and shelves: shelf, wardrobe, barrel rack, armoury rack (props `wares` fill them).
  rack(p, o) {
    const W = o.W, Hh = o.H, k = k_(o), r = ramp(o);
    const top = -12;
    p.rect(1, top, 2, Hh - top - 1, r[0]); p.rect(W - 3, top, 2, Hh - top - 1, r[0]);
    if (k === 'wardrobe') { board(p, 1, top, W - 2, Hh - top - 2, r); p.vl(W >> 1, top + 2, Hh - top - 5, r[0]); p.px((W >> 1) - 2, 0, P.gold); p.px((W >> 1) + 1, 0, P.gold); return; }
    for (let y = top + 2; y < Hh - 2; y += 6) board(p, 1, y, W - 2, 2, r);
    if (k === 'barrelrack') for (let x = 3; x + 5 < W - 2; x += 6) for (let y = top + 4; y < Hh - 4; y += 6) { p.ellipse(x + 2, y + 2, 3, 2, RAMP.darkwood[1]); p.px(x + 1, y + 1, RAMP.darkwood[3]); p.px(x + 2, y + 2, RAMP.darkwood[0]); }
    if (k === 'weaponrack') for (let x = 4; x < W - 3; x += 4) { p.vl(x, top - 2, Hh - top - 4, RAMP.wood[1]); p.px(x, top - 3, P.mist); p.px(x - 1, top - 2, P.slate3); }
    if (k === 'shelf') for (let y = top + 4; y < Hh - 2; y += 6) { p.rect(3, y - 1, 3, 2, P.tan); p.rect(8, y - 2, 3, 3, P.slate2); }
  },
  chest(p, o) { // the strongbox: an iron-bound chest with a lock
    const W = o.W, Hh = o.H, r = RAMP.darkwood;
    board(p, 2, 3, W - 4, Hh - 5, r); board(p, 2, -2, W - 4, 6, r);
    p.vl(4, -2, Hh, P.slate2); p.vl(W - 5, -2, Hh, P.slate2); p.hl(2, 3, W - 4, P.slate1);
    p.rect((W >> 1) - 1, 2, 3, 3, P.gold); p.px(W >> 1, 3, P.umber0);
  },
  bedroll(p, o) { // a rolled mat and a blanket on the floor
    const W = o.W, Hh = o.H, v = o.v | 0, br = [RAMP.red, RAMP.water, RAMP.grass, RAMP.plum][v & 3];
    p.rect(2, 2, W - 4, Hh - 4, RAMP.sandy[1]); p.hl(2, 2, W - 4, RAMP.sandy[2]);
    p.rect(2, Hh / 2, W - 4, Hh / 2 - 2, br[1]); p.dither(2, Hh / 2, W - 4, Hh / 2 - 2, br[0], 5); p.hl(2, Hh / 2, W - 4, br[2]);
    p.ellipse(W / 2, 4, 4, 2, P.bone);
  },
  // Fences (rails between posts, joined by the wall mask) and the fence gate (a leaf of slats).
  fence(p, o) {
    const m = o.mask | 0, r = ramp(o), gate = k_(o) === 'fencegate';
    p.rect(7, -4, 2, 12, r[0]); p.px(7, -4, r[2]);
    const rail = (x0, x1, y) => { p.hl(x0, y, x1 - x0, r[2]); p.hl(x0, y + 1, x1 - x0, r[0]); };
    const W2 = m & 2 || !(m & 5) ? 16 : 9, W8 = m & 8 || !(m & 5) ? 0 : 7;
    if (gate) { board(p, 1, -1, 14, 3, r); board(p, 1, 4, 14, 3, r); p.line(2, 6, 13, -1, r[1]); return; }
    rail(W8, W2, -1); rail(W8, W2, 4);
    if (m & 4) p.vl(8, 6, 10, r[1]);
    if (m & 1) p.vl(8, -6, 4, r[1]);
  },
  // The iron-bound gate (2 x 1): two leaves with iron bands; locked: a bar across.
  bigdoor(p, o) {
    const W = o.W, r = ramp(o, RAMP.darkwood);
    block(p, 0, -12, 4, 28, RAMP.granite); block(p, W - 4, -12, 4, 28, RAMP.granite); block(p, 0, -14, W, 4, RAMP.granite);
    if (o.open) { p.rect(4, -10, W - 8, 26, P.night); p.dither(4, 8, W - 8, 8, P.slate0, 6); return; }
    p.rect(4, -10, W - 8, 26, r[2]); for (let x = 7; x < W - 4; x += 4) p.vl(x, -10, 26, r[1]);
    for (const y of [-6, 3, 11]) { p.hl(4, y, W - 8, P.slate1); p.hl(4, y + 1, W - 8, P.slate2); }
    p.vl(W >> 1, -10, 26, r[0]); p.px((W >> 1) - 2, 4, P.gold); p.px((W >> 1) + 1, 4, P.gold);
  },
  field(p, o) { // a tilled field: furrows and a scarecrow post in the corner
    const W = o.W, Hh = o.H;
    p.rect(0, 0, W, Hh, P.umber1);
    for (let y = 1; y < Hh; y += 4) { p.hl(1, y, W - 2, P.umber2); p.hl(1, y + 2, W - 2, P.umber0); for (let x = 2; x < W - 2; x += 5) p.px(x + (y & 3), y + 1, P.umber3); }
    p.vl(W - 5, -6, 10, RAMP.wood[1]); p.hl(W - 8, -4, 7, RAMP.wood[1]); p.rect(W - 6, -9, 3, 3, P.sand);
  },
  // Towers: a watchtower (timber legs and a roofed platform), an archer platform (open, railed),
  // a stone tower (round, crenellated); the ballista sits on its own base.
  tower(p, o) {
    const W = o.W, Hh = o.H, k = k_(o), r = ramp(o);
    if (k === 'stonetower') {
      const g = RAMP.granite;
      block(p, 2, -18, W - 4, Hh + 16, g);
      for (let y = -14; y < Hh - 2; y += 5) p.hl(3, y, W - 6, g[0]);
      for (let x = 2; x < W - 2; x += 5) block(p, x, -24, 3, 6, g);
      p.rect((W >> 1) - 2, -8, 4, 6, P.night); p.rect((W >> 1) - 2, 6, 4, 6, P.night);
      return;
    }
    for (const x of [1, W - 4]) { p.rect(x, -10, 3, Hh + 9, r[0]); p.vl(x, -10, Hh + 9, r[1]); }
    p.line(3, Hh - 2, W - 4, 2, r[1]); p.line(W - 4, Hh - 2, 3, 2, r[1]);
    board(p, -1, -12, W + 2, 5, r);
    for (let x = 0; x < W; x += 4) p.vl(x, -18, 6, r[1]);
    p.hl(-1, -18, W + 2, r[2]);
    if (k === 'tower') { roof(p, 0, -30, W, 12, 'wood', o.v); }
    for (let x = 2; x < W - 2; x += 3) p.vl(x, -9, 6, r[0]); // the ladder side
  },
  ballista(p, o) { // a heavy crossbow on a turntable
    const W = o.W, Hh = o.H, cx = W >> 1, r = RAMP.darkwood;
    p.ellipse(cx, Hh / 2 + 3, W / 2 - 2, Hh / 2 - 4, RAMP.granite[1]); p.ellipse(cx, Hh / 2 + 2, W / 2 - 4, Hh / 2 - 6, RAMP.granite[2]);
    board(p, cx - 2, -6, 4, Hh - 4, r);
    p.line(cx - 12, 0, cx, -6, r[2]); p.line(cx + 12, 0, cx, -6, r[2]);
    p.line(cx - 12, 0, cx, 8, P.bone); p.line(cx + 12, 0, cx, 8, P.bone);
    p.rect(cx - 1, -9, 2, 10, P.slate3); p.px(cx, -10, P.mist);
  },
  // Traps (1 x 1): spikes in a pit, the ember pit (coals; brighter when lit), the deadfall (a log
  // slung under the roof on a trip line).
  trap(p, o) {
    const k = k_(o);
    if (k === 'emberpit') { p.ellipse(8, 9, 6, 4, P.ink); p.ellipse(8, 9, 5, 3, P.ember0); for (let i = 0; i < 6; i++) p.px(4 + ((i * 5) % 9), 7 + ((i * 3) % 4), i & 1 ? P.ember1 : P.orange); return; }
    if (k === 'deadfall') { p.line(1, 15, 15, 15, P.mist); board(p, 1, -2, 14, 4, RAMP.darkwood); p.vl(3, -3, 3, P.tan); p.vl(12, -3, 3, P.tan); for (let x = 3; x < 14; x += 3) p.px(x, 3, RAMP.granite[1]); return; }
    p.rect(2, 4, 12, 9, P.umber0); p.dither(2, 4, 12, 9, P.umber1, 6);
    for (let x = 3; x < 14; x += 3) for (const y of [6, 10]) { p.vl(x + ((y >> 2) & 1), y - 2, 3, P.slate3); p.px(x + ((y >> 2) & 1), y - 3, P.mist); }
  },
  barricade(p, o) { // sharpened logs crossed on a sawhorse
    const r = RAMP.wood;
    p.line(1, 14, 7, 0, r[0]); p.line(9, 14, 15, 0, r[0]);
    for (const y of [2, 6, 10]) { board(p, 0, y, 16, 3, r); p.px(0, y + 1, P.tan); p.px(15, y + 1, P.tan); }
  },
  // Standing stones: the waystone (a rune and a soft glow), the ward stone (teal), the memorial
  // obelisk (names), the shrine (a niche with candles).
  stele(p, o) {
    const k = k_(o), g = k === 'wardstone' ? RAMP.slate : k === 'memorial' ? RAMP.pale : RAMP.granite;
    const h = k === 'memorial' ? 26 : 22;
    block(p, 3, 16 - h, 10, h - 2, g); p.rect(2, 12, 12, 4, g[0]); p.hl(2, 12, 12, g[2]);
    if (k === 'waystone') { p.vl(8, 2, 6, P.gold); p.hl(6, 4, 5, P.gold); p.px(8, 1, P.flame); }
    else if (k === 'wardstone') { p.vl(8, -2, 9, P.teal); p.px(7, 0, P.teal); p.px(9, 3, P.teal); }
    else if (k === 'memorial') for (let y = -6; y < 8; y += 3) p.hl(5, y, 6, g[0]);
    else { p.rect(5, -2, 6, 8, P.night); p.px(6, 4, P.flame); p.px(9, 4, P.flame); p.px(6, 5, P.bone); p.px(9, 5, P.bone); p.px(7, 1, P.gold); }
  },
  beacon(p, o) { // the signal beacon: a stone drum and an iron basket of fire (the flame is live)
    const W = o.W, Hh = o.H, g = RAMP.granite;
    block(p, 4, 0, W - 8, Hh - 2, g); for (let y = 4; y < Hh - 3; y += 4) p.hl(5, y, W - 10, g[0]);
    p.rect(6, -6, W - 12, 6, P.slate1); for (let x = 7; x < W - 6; x += 3) p.vl(x, -8, 8, P.slate2);
    p.rect(8, -4, W - 16, 3, P.ember1); p.hl(9, -4, W - 18, P.orange);
  },
  bellpost(p, o) { // the alarm bell: a gallows post and a bronze bell
    const r = RAMP.darkwood;
    p.rect(3, -16, 2, 31, r[1]); p.vl(3, -16, 31, r[2]); board(p, 2, -16, 12, 2, r);
    p.line(5, -10, 9, -14, r[1]);
    p.rect(9, -13, 5, 6, RAMP.copper[1]); p.hl(8, -8, 7, RAMP.copper[0]); p.vl(9, -13, 5, RAMP.copper[2]); p.px(11, -6, P.slate1);
  },
  well(p, o) { // a round stone well with a windlass roof
    const g = RAMP.granite, r = RAMP.wood;
    p.ellipse(8, 10, 7, 5, g[1]); p.ellipse(8, 9, 5, 3, P.deep); p.hl(5, 8, 3, P.shallow);
    for (let a = 0; a < 10; a++) { const x = Math.round(8 + Math.cos(a * 0.63) * 7) - 1, y = Math.round(10 + Math.sin(a * 0.63) * 5) - 1; p.rect(x, y, 3, 2, a & 1 ? g[2] : g[1]); }
    p.vl(1, -6, 14, r[0]); p.vl(14, -6, 14, r[0]); board(p, 0, -8, 16, 3, r); p.hl(3, -2, 10, P.tan); p.rect(7, -1, 2, 4, P.umber2);
  },
  grave(p, o) { // a grave mound with a headstone; the sarcophagus: a carved stone lid
    const W = o.W, Hh = o.H, k = k_(o), g = RAMP.granite;
    if (k === 'sarcophagus') { block(p, 2, 1, W - 4, Hh - 3, g); block(p, 1, -2, W - 2, 5, RAMP.pale); p.vl(W >> 1, 4, Hh - 8, g[0]); p.hl(4, Hh / 2, W - 8, g[0]); return; }
    p.ellipse(W / 2, Hh / 2 + 3, W / 2 - 2, Hh / 2 - 4, P.umber1); p.dither(3, Hh / 2, W - 6, Hh / 2 - 2, P.umber2, 6);
    block(p, 4, -4, W - 8, 9, g); p.hl(6, -1, W - 12, g[0]); p.vl(W >> 1, -2, 5, g[0]);
  },
  bellows(p, o) { // a leather bellows on a frame, its nozzle toward the forge
    const r = RAMP.wood;
    board(p, 1, 9, 14, 3, r); p.rect(2, 2, 10, 7, RAMP.skin[1]); p.hl(2, 2, 10, RAMP.skin[2]); p.hl(2, 5, 10, RAMP.skin[0]);
    board(p, 1, -2, 12, 3, r); p.rect(12, 5, 4, 2, P.slate2); p.px(15, 5, P.slate3);
  },
  switch(p, o) { // a lever in a stone socket, or a pressure plate (a flagstone on a rim)
    const g = RAMP.granite;
    if (k_(o) === 'plate') { p.rect(2, 4, 12, 9, P.slate0); block(p, 3, 4, 10, 8, g); p.dither(3, 4, 10, 8, g[0], 3); p.px(4, 5, P.slate3); return; }
    block(p, 4, 8, 8, 6, g); p.line(8, 9, 12, -4, RAMP.darkwood[1]); p.rect(11, -7, 3, 3, P.danger); p.px(11, -7, P.peach);
  },
  // Yards and rings: the skald's stage (a plank dais with a banner), the sparring pit (sand in a post
  // ring), the training yard (a straw dummy and a target), the woodcutter's yard, the quarry.
  yard(p, o) {
    const W = o.W, Hh = o.H, k = k_(o), r = RAMP.wood;
    if (k === 'stage') { board(p, 0, 2, W, Hh - 3, r); for (let x = 3; x < W; x += 4) p.vl(x, 3, Hh - 5, r[1]); p.vl(W - 4, -10, 12, r[0]); p.rect(W - 11, -10, 7, 6, P.ember1); p.hl(W - 11, -10, 7, P.orange); return; }
    if (k === 'woodyard' || k === 'quarry') {
      p.rect(0, 0, W, Hh, k === 'quarry' ? RAMP.granite[0] : P.umber1); p.dither(0, 0, W, Hh, k === 'quarry' ? RAMP.granite[1] : P.umber2, 4);
      if (k === 'woodyard') { for (let y = 3; y < Hh - 8; y += 4) { board(p, 3, y, W - 16, 3, RAMP.wood); p.disc(3, y + 1, 1, P.tan); } p.rect(W - 10, Hh - 10, 6, 6, RAMP.darkwood[1]); p.line(W - 8, Hh - 12, W - 4, Hh - 16, P.slate3); }
      else for (let x = 2; x < W - 6; x += 9) for (let y = 3; y < Hh - 6; y += 8) block(p, x, y, 7, 5, RAMP.granite);
      return;
    }
    p.rect(1, 1, W - 2, Hh - 2, P.sand); p.dither(1, 1, W - 2, Hh - 2, P.tan, 4);
    for (let x = 1; x < W; x += 8) { p.vl(x, -4, 6, r[0]); p.vl(x, Hh - 6, 6, r[0]); }
    p.hl(1, -2, W - 2, r[1]); p.hl(1, Hh - 4, W - 2, r[1]);
    if (k === 'trainingyard') { p.vl(10, 0, 14, r[1]); p.hl(6, 4, 9, r[1]); p.rect(8, -4, 5, 9, RAMP.sandy[2]); p.disc(W - 12, Hh / 2, 5, P.bone); p.disc(W - 12, Hh / 2, 3, P.danger); p.px(W - 12, Hh / 2, P.gold); }
  },
  statue(p, o) { // a robed figure on a plinth in the material
    const W = o.W, Hh = o.H, r = ramp(o, RAMP.pale), cx = W >> 1, big = W > 16;
    block(p, 2, Hh - 6, W - 4, 5, r);
    const s = big ? 2 : 1;
    p.rect(cx - 3 * s, Hh - 6 - 12 * s, 6 * s, 12 * s, r[2]); p.vl(cx - 3 * s, Hh - 6 - 12 * s, 12 * s, r[3]); p.vl(cx + 3 * s - 1, Hh - 6 - 12 * s, 12 * s, r[0]);
    p.disc(cx, Hh - 6 - 14 * s, 2 * s, r[2]); p.px(cx - s, Hh - 6 - 15 * s, r[3]);
    p.line(cx + 2 * s, Hh - 6 - 10 * s, cx + 6 * s, Hh - 6 - 16 * s, r[1]);
  },
  hanging(p, o) { // a tapestry on a rod, or a banner on a pole (squad colours)
    const k = k_(o), br = [RAMP.red, RAMP.water, RAMP.grass, RAMP.plum][(o.v | 0) & 3];
    if (k === 'banner') { p.vl(3, -14, 29, RAMP.darkwood[1]); p.px(3, -15, P.gold); p.rect(4, -12, 9, 11, br[1]); p.vl(4, -12, 11, br[2]); p.px(8, -9, P.gold); p.px(7, -7, P.gold); p.px(9, -7, P.gold); p.hl(4, -2, 3, br[1]); p.hl(10, -2, 3, br[1]); return; }
    p.hl(0, -12, 16, RAMP.darkwood[1]); p.rect(2, -11, 12, 18, br[1]); p.dither(2, -11, 12, 18, br[0], 4);
    p.rect(4, -8, 8, 8, br[2]); p.px(7, -6, P.gold); p.px(8, -4, P.gold); p.px(6, -3, P.gold); for (let x = 2; x < 14; x += 2) p.px(x, 7, br[2]);
  },
  stall(p, o) { // the trade post: a counter under a striped awning, goods on display
    const W = o.W, Hh = o.H, r = RAMP.wood;
    for (const x of [1, W - 3]) p.rect(x, -12, 2, Hh + 10, r[0]);
    for (let x = 0; x < W; x += 4) p.rect(x, -14, 4, 6, (x >> 2) & 1 ? P.bone : P.ember1);
    p.hl(0, -8, W, P.ember0);
    board(p, 2, Hh - 12, W - 4, 6, r);
    p.rect(5, Hh - 15, 4, 3, P.gold); p.rect(11, Hh - 16, 4, 4, RAMP.copper[1]); p.rect(W - 12, Hh - 15, 5, 3, P.plum1); p.ellipse(W - 6, Hh - 14, 2, 2, P.moss3);
  },
  fireplace(p, o) { // a stone fireplace against a wall: hearthstone, arch, mantel (the flame is live)
    const W = o.W, g = RAMP.granite;
    block(p, 0, -10, W, 24, g); p.rect(5, -2, W - 10, 14, P.ink); p.rect(6, 6, W - 12, 5, P.ember0);
    block(p, -1, -12, W + 2, 3, RAMP.darkwood); p.px(4, -13, P.gold); p.px(W - 6, -13, P.bone);
    board(p, 8, 8, W - 16, 2, RAMP.darkwood);
  },
  potwheel(p, o) { // the potter's wheel: a kick wheel and a pot in the making
    p.ellipse(8, 11, 7, 3, RAMP.darkwood[1]); p.hl(2, 10, 12, RAMP.darkwood[2]);
    p.rect(7, 4, 2, 6, P.slate1); p.ellipse(8, 4, 5, 2, RAMP.earth[2]);
    p.rect(6, -2, 5, 5, RAMP.red[2]); p.hl(6, -2, 5, RAMP.red[3]); p.px(10, 1, RAMP.red[0]);
  },
  desks(p, o) { // the scriptorium: rows of slanted desks with open books and a lamp
    const W = o.W, Hh = o.H, r = ramp(o);
    for (let y = 2; y < Hh - 6; y += 10) for (let x = 2; x < W - 10; x += 14) {
      board(p, x, y, 10, 5, r); p.rect(x + 2, y + 1, 6, 3, P.bone); p.vl(x + 5, y + 1, 3, P.mist); p.rect(x + 1, y + 5, 2, 4, r[0]); p.rect(x + 7, y + 5, 2, 4, r[0]);
    }
    p.px(W - 5, 0, P.flame); p.px(W - 5, 1, P.gold); p.rect(W - 6, 2, 3, 2, P.slate2);
  },
  // Garden plots and farm furniture by key: planter box, mushroom bed, compost heap, beehive skep, scarecrow.
  plot(p, o) {
    const W = o.W, Hh = o.H, k = k_(o), r = ramp(o);
    if (k === 'scarecrow') { p.vl(8, -10, 25, RAMP.wood[0]); p.hl(2, -4, 13, RAMP.wood[1]); p.rect(5, -6, 7, 9, RAMP.plum[1]); p.disc(8, -11, 3, P.sand); p.hl(4, -14, 9, P.umber2); p.px(7, -11, P.ink); p.px(9, -11, P.ink); return; }
    if (k === 'beehive') { p.vl(8, 6, 9, RAMP.wood[0]); for (let y = -6; y < 7; y += 2) { const hw = Math.round(6 - Math.abs(y - 1) * 0.55); p.hl(8 - hw, y, hw * 2, y % 4 ? RAMP.sandy[2] : RAMP.sandy[1]); } p.rect(7, 3, 3, 2, P.ink); p.px(12, -4, P.gold); p.px(3, -2, P.gold); return; }
    if (k === 'compost') { p.ellipse(8, 10, 7, 5, P.umber1); p.dither(2, 6, 12, 8, P.umber2, 6); p.px(5, 8, P.moss2); p.px(10, 7, P.tan); p.px(8, 11, P.moss3); board(p, 0, 12, 16, 3, RAMP.wood); return; }
    board(p, 0, 4, W, Hh - 5, r);
    p.rect(2, 4, W - 4, 4, P.umber1);
    if (k === 'mushbed') { for (let x = 3; x < W - 3; x += 5) for (let y = 6; y < Hh - 4; y += 7) { p.vl(x + 1, y, 2, P.bone); p.rect(x, y - 2, 3, 2, P.teal); p.px(x, y - 2, P.mist); } return; }
    for (let x = 2; x < W - 2; x += 3) { p.vl(x, -2, 6, P.moss2); p.px(x, -3, [P.danger, P.gold, P.violet, P.bone][(x >> 1) & 3]); }
  },
  headframe(p, o) { // the mine headframe: a timber A-frame with a sheave wheel over the shaft
    const W = o.W, Hh = o.H, r = RAMP.darkwood, cx = W >> 1;
    p.rect(cx - 8, Hh / 2 - 4, 16, 10, P.ink); p.dither(cx - 8, Hh / 2 - 4, 16, 10, P.night, 8);
    p.line(4, Hh - 2, cx - 1, -20, r[1]); p.line(W - 5, Hh - 2, cx + 1, -20, r[1]); p.hl(8, Hh / 2 - 6, W - 16, r[2]);
    p.ring(cx, -18, 5, r[2]); p.disc(cx, -18, 1, P.slate2); p.vl(cx + 5, -18, 26, P.slate3);
    board(p, 2, Hh - 6, 10, 4, RAMP.wood); p.rect(W - 12, Hh - 8, 8, 6, P.slate1); p.hl(W - 12, Hh - 8, 8, P.slate2);
  },
  'frame.seat'(p, o) { // a stool, or a long bench seat (2 x 1)
    const W = o.W, r = ramp(o);
    if (W <= 16) { p.rect(4, 6, 2, 8, r[0]); p.rect(10, 6, 2, 8, r[0]); boxOf(o)(p, 2, 2, 12, 5, r); return; }
    for (const x of [2, W - 4]) p.rect(x, 6, 2, 8, r[0]);
    boxOf(o)(p, 0, 2, W, 5, r); p.hl(1, 9, W - 2, r[0]);
  },

  // ---- Props ------------------------------------------------------------------------------------------
  // The goods on a bench top by key: bow and arrows (fletcher), cloth bolts (tailor, loom shuttle),
  // gems (jeweller), a book and quill (study), a map (survey table), a cleaver and a joint (butcher),
  // vials (apothecary), a rough figure (sculptor).
  wares(p, o) {
    const k = k_(o), W = o.W;
    if (k === 'fletcher') { p.line(3, 3, 14, -2, RAMP.wood[2]); p.line(3, 3, 14, -2, RAMP.wood[2]); p.line(4, 1, 13, -3, P.bone); for (let x = 17; x < W - 3; x += 3) { p.vl(x, -4, 7, RAMP.wood[3]); p.px(x, -5, P.slate3); p.px(x, 2, P.danger); } }
    else if (k === 'tailor' || k === 'loom') { for (let x = 3; x < W - 6; x += 7) { p.rect(x, -3, 6, 4, [RAMP.red, RAMP.water, RAMP.plum][(x >> 3) % 3][1]); p.hl(x, -3, 6, P.bone); } if (k === 'loom') { p.rect(2, -10, 2, 12, RAMP.wood[0]); p.rect(W - 4, -10, 2, 12, RAMP.wood[0]); p.hl(2, -10, W - 4, RAMP.wood[1]); for (let x = 5; x < W - 4; x += 2) p.vl(x, -9, 7, P.mist); } }
    else if (k === 'jeweller') { for (const [x, c] of [[4, P.danger], [8, P.teal], [12, P.violet], [16, P.gold]]) { p.rect(x, -1, 2, 2, c); p.px(x, -1, P.bone); } p.rect(W - 8, -3, 5, 3, P.slate1); p.px(W - 6, -4, P.mist); }
    else if (k === 'study' || k === 'surveytable') {
      if (k === 'surveytable') { p.rect(3, -3, W - 6, 6, P.sand); p.dither(3, -3, W - 6, 6, P.tan, 4); p.line(5, 1, W - 8, -2, P.water); p.px(W >> 1, -1, P.danger); }
      else { p.rect(4, -2, 8, 4, P.bone); p.vl(8, -2, 4, P.mist); p.line(W - 8, 1, W - 4, -4, P.bone); p.px(W - 9, 2, P.ink); }
    } else if (k === 'butcher') { p.rect(4, -2, 7, 4, RAMP.red[2]); p.px(5, -1, P.bone); p.rect(W - 10, -3, 5, 2, P.mist); p.rect(W - 6, -3, 3, 1, RAMP.wood[1]); }
    else if (k === 'apothecary') { for (const [x, c] of [[4, P.teal], [7, P.danger], [10, P.moss3], [13, P.violet]]) { p.rect(x, -4, 2, 4, c); p.px(x, -5, P.mist); } p.rect(W - 9, -2, 5, 3, P.moss2); }
    else if (k === 'sculptor') { p.rect(W - 10, -12, 6, 12, RAMP.pale[2]); p.disc(W - 7, -13, 2, RAMP.pale[2]); p.vl(W - 5, -12, 12, RAMP.pale[0]); p.rect(3, -2, 6, 3, RAMP.pale[1]); }
  },
  // Marks on a wall block by key: palisade stakes, the reinforced wall's iron bands, an arrow slit, a window pane.
  wallmark(p, o) {
    const k = k_(o), cy = -8, fy = 8;
    if (k === 'palisade') { for (let x = 1; x < 16; x += 4) { p.rect(x, cy - 3, 3, 3, RAMP.wood[2]); p.px(x + 1, cy - 4, RAMP.wood[3]); } return; }
    if (k === 'rwall') { p.hl(0, fy + 1, 16, P.slate1); p.hl(0, fy + 5, 16, P.slate1); p.px(3, fy + 1, P.slate3); p.px(12, fy + 5, P.slate3); return; }
    if (k === 'embrasure') { p.rect(7, fy, 2, 7, P.ink); p.hl(6, fy + 2, 4, P.ink); return; }
    if (k === 'window') { p.rect(4, fy, 8, 6, P.night); p.rect(5, fy + 1, 6, 4, P.shallow); p.vl(8, fy + 1, 4, P.slate1); p.px(5, fy + 1, P.mist); }
  },
  // A shop board over the door by key (tavern mug, apothecary leaf, smithy anvil...); 1-tile boards.
  sign(p, o) {
    const k = k_(o), x = 2, y = -4;
    p.vl(x, y - 2, 4, RAMP.darkwood[0]); p.rect(x - 1, y, 8, 6, RAMP.wood[1]); p.hl(x - 1, y, 8, RAMP.wood[2]);
    const c = k === 'tavern' ? P.gold : k === 'barracks' ? P.danger : k === 'granary' ? P.sand : k === 'temple' ? P.flame : P.bone;
    p.rect(x + 1, y + 2, 4, 3, c); p.px(x + 2, y + 1, c);
  },
  bunkframe(p, o) { // the upper bunk over a bed frame: posts and a second mattress
    const W = o.W, Hh = o.H, r = ramp(o);
    for (const [x, y] of [[0, -10], [W - 2, -10]]) p.rect(x, y, 2, Hh + 8, r[0]);
    board(p, 1, -10, W - 2, Math.round(Hh * 0.45), r); p.rect(2, -9, W - 4, Math.round(Hh * 0.45) - 3, P.mist); p.hl(2, -9, W - 4, P.bone);
  },

  // ---- Floors (painted by ground.js for the floor layer) ----------------------------------------------
  cobbles(p, o) { const r = ramp(o, RAMP.granite); p.rect(0, 0, 16, 16, r[0]); for (let y = 0; y < 16; y += 4) for (let x = (y & 4) ? 2 : 0; x < 16; x += 4) { p.rect(x, y, 3, 3, r[1]); p.px(x, y, r[2]); } },
  bricks(p, o) { const r = RAMP.red; p.rect(0, 0, 16, 16, r[0]); for (let y = 0; y < 16; y += 4) for (let x = (y & 4) ? -4 : 0; x < 16; x += 8) { p.rect(x + 1, y + 1, 7, 3, r[1]); p.hl(x + 1, y + 1, 7, r[2]); } },
  carpet(p, o) { const r = RAMP.plum; p.rect(0, 0, 16, 16, r[1]); p.dither(0, 0, 16, 16, r[0], 3); p.hl(0, 1, 16, P.gold); p.hl(0, 14, 16, P.gold); for (let x = 3; x < 16; x += 5) p.px(x, 8, P.ember1); },
  deck(p, o) { const r = RAMP.wood; p.rect(0, 0, 16, 16, P.deep); for (let x = 0; x < 16; x += 4) { p.rect(x, 0, 3, 16, r[2]); p.vl(x, 0, 16, r[3]); p.px(x + 1, 5, r[0]); p.px(x + 1, 12, r[0]); } },
  // ---- Stage Z2 (keys.js Z2_PARTS): the bench add-ons, the winch, the cell bed and the memorial slab ----------
  // One base for the add-ons, keyed by the add-on id: each is a small working fixture that reads as its verb at a
  // glance (blocks under a saw, water in a trough, a crucible on coals, silk on a frame), lit from the top-left.
  addon(p, o) {
    const W = o.W, Hh = o.H, k = k_(o), w = RAMP.wood, dw = RAMP.darkwood, g = RAMP.granite;
    const coals = (x, y, n) => { p.rect(x, y, n, 2, P.ember0); for (let i = 0; i < n; i += 2) p.px(x + i, y, i & 2 ? P.orange : P.ember1); };
    if (k === 'cutting_yard') { // a stone on trestles under a frame saw, cut blocks stacked beside
      p.vl(2, 6, 9, dw[0]); p.vl(12, 6, 9, dw[0]); block(p, 1, 3, 13, 5, g); p.vl(7, 3, 5, g[0]);
      p.vl(4, -9, 12, w[1]); p.vl(10, -9, 12, w[1]); p.hl(4, -9, 7, w[2]); p.hl(4, 1, 7, P.slate3); for (let x = 5; x < 10; x += 2) p.px(x, 2, P.mist);
      block(p, 10, 10, 5, 4, RAMP.pale); block(p, 11, 7, 4, 3, RAMP.pale); return;
    }
    if (k === 'cask_cellar') { // two casks racked, a third on top
      p.hl(0, 14, 16, dw[0]); p.vl(1, 6, 9, dw[0]); p.vl(14, 6, 9, dw[0]);
      for (const [x, y] of [[1, 7], [8, 7], [4, 0]]) { p.ellipse(x + 3, y + 3, 4, 3, dw[1]); p.ellipse(x + 3, y + 3, 2, 2, dw[2]); p.px(x + 2, y + 2, dw[3]); p.vl(x + 3, y, 7, P.slate1); p.px(x + 3, y + 3, P.gold); }
      return;
    }
    if (k === 'quench_trough') { // a stone trough of dark water, a curl of steam
      block(p, 0, 4, 16, 10, g); p.rect(2, 6, 12, 5, P.deep); p.dither(2, 6, 12, 5, P.water, 5); p.hl(3, 6, 4, P.shallow);
      p.px(9, 3, P.mist); p.px(10, 1, P.slate3); p.px(9, -1, P.mist); p.line(11, 7, 15, -2, P.slate2); return;
    }
    if (k === 'armourer_stand') { // a cross-stand wearing a mail shirt and a helm
      p.vl(7, -10, 25, dw[1]); p.hl(2, -5, 12, dw[1]); p.rect(5, 13, 6, 2, dw[0]);
      p.rect(3, -4, 10, 11, RAMP.iron[1]); p.dither(3, -4, 10, 11, RAMP.iron[2], 6); p.hl(3, -4, 10, RAMP.iron[3]); p.vl(12, -4, 11, RAMP.iron[0]);
      p.rect(5, -12, 6, 4, RAMP.steel[2]); p.hl(5, -12, 6, RAMP.steel[3]); p.hl(5, -9, 6, RAMP.steel[0]); return;
    }
    if (k === 'slag_pit') { // a stone-lipped pit of cooling slag, glowing at its heart, a rake laid across
      p.ellipse(8, 9, 7, 5, g[1]); p.ellipse(8, 9, 5, 3, P.ink); p.dither(4, 7, 9, 5, P.ember0, 7);
      p.px(7, 9, P.orange); p.px(9, 8, P.ember1); p.px(6, 10, P.ember1); p.line(1, 2, 14, 13, w[1]); p.hl(12, 12, 4, P.slate2); return;
    }
    if (k === 'alloy_crucible') { // a clay crucible on coals, two metals swirled in it
      p.rect(3, 12, 10, 2, g[0]); coals(4, 10, 8);
      for (let y = 1; y < 10; y++) { const hw = 3 + (y < 3 ? y : 3); p.hl(8 - hw, y, hw * 2, RAMP.red[0]); p.px(8 - hw, y, RAMP.red[1]); }
      p.ellipse(8, 1, 5, 2, RAMP.red[1]); p.hl(5, 1, 3, P.gold); p.hl(8, 1, 3, P.mist); p.px(8, 0, P.flame); return;
    }
    if (k === 'ember_forge') { // a low stone hearth open to the ember below: no chimney, the glow comes up from the pool
      block(p, 0, 0, W, Hh - 1, g); p.rect(3, 3, W - 6, Hh - 7, P.ink);
      p.dither(3, 3, W - 6, Hh - 7, P.ember0, 10); p.hl(4, Hh - 6, W - 8, P.ember1); for (let x = 5; x < W - 5; x += 4) p.px(x, Hh - 7, P.orange);
      p.px(W >> 1, 5, P.gold); p.px((W >> 1) + 3, 6, P.flame);
      p.rect(W - 9, -5, 7, 3, RAMP.iron[2]); p.hl(W - 9, -5, 7, RAMP.iron[3]); p.rect(W - 7, -2, 3, 3, RAMP.iron[1]); return;
    }
    if (k === 'tap_stand') { // a cask on a trestle with a brass tap and a mug under it
      p.vl(2, 8, 7, dw[0]); p.vl(13, 8, 7, dw[0]); p.hl(1, 8, 14, dw[1]);
      p.ellipse(8, 3, 6, 5, dw[1]); p.ellipse(8, 3, 4, 3, dw[2]); p.vl(5, -2, 10, P.slate1); p.vl(11, -2, 10, P.slate1); p.px(6, 1, dw[3]);
      p.rect(7, 7, 2, 2, P.gold); p.px(8, 9, P.gold); p.rect(6, 11, 4, 3, P.tan); p.hl(6, 11, 4, P.bone); return;
    }
    if (k === 'hardening_vat') { // a hooped vat of dark wax, a hide hung over its rim
      p.rect(2, 2, 12, 12, dw[1]); p.vl(2, 2, 12, dw[2]); p.vl(13, 2, 12, dw[0]); p.hl(2, 5, 12, P.slate1); p.hl(2, 11, 12, P.slate1);
      p.ellipse(8, 2, 6, 2, P.umber0); p.hl(5, 2, 3, P.umber2); p.rect(10, 0, 5, 9, RAMP.skin[1]); p.hl(10, 0, 5, RAMP.skin[2]); p.vl(14, 1, 8, RAMP.skin[0]); return;
    }
    if (k === 'silk_frame') { // a square frame strung with pale silk in a web, a spool below
      p.rect(1, -8, 2, 22, w[1]); p.rect(13, -8, 2, 22, w[1]); p.hl(1, -8, 14, w[2]); p.hl(1, 6, 14, w[0]);
      for (let x = 4; x < 13; x += 2) p.vl(x, -6, 11, (x >> 1) & 1 ? P.bone : P.mist);
      p.line(3, -6, 12, 4, P.bone); p.line(12, -6, 3, 4, P.mist); p.ellipse(8, 11, 3, 2, P.bone); p.px(7, 10, P.slate3); return;
    }
    if (k === 'glazing_kiln') { // a squat round kiln with glazed pots cooling on its shoulder
      for (let y = -2; y < Hh - 1; y++) { const hw = Math.min(7, 4 + ((y + 2) >> 1)); p.hl(8 - hw, y, hw * 2, RAMP.red[1]); p.px(8 - hw, y, RAMP.red[2]); p.px(7 + hw, y, RAMP.red[0]); }
      p.rect(5, Hh - 7, 6, 5, P.ink); p.rect(6, Hh - 6, 4, 3, P.ember1); p.px(7, Hh - 5, P.gold);
      p.rect(2, -6, 3, 4, P.teal); p.px(2, -6, P.mist); p.rect(11, -6, 3, 4, P.shallow); p.px(11, -6, P.bone); return;
    }
    if (k === 'vault_kiln') { // a kiln of fired brick under a keystone arch
      block(p, 1, 2, 14, Hh - 3, RAMP.red); for (let y = 5; y < Hh - 2; y += 3) p.hl(2, y, 12, RAMP.red[0]);
      for (let a = 0; a < 7; a++) { const x = Math.round(8 - Math.cos(a * 0.52) * 7), y = Math.round(2 - Math.sin(a * 0.52) * 7); p.rect(x - 1, y - 1, 2, 2, a === 3 ? P.gold : RAMP.red[2]); }
      p.rect(5, Hh - 7, 6, 5, P.ink); p.rect(6, Hh - 6, 4, 3, P.ember1); return;
    }
    // (an add-on with no drawing of its own yet: a work trestle with a hammer)
    board(p, 1, 4, 14, 4, w); p.vl(2, 8, 6, dw[0]); p.vl(13, 8, 6, dw[0]); p.line(5, 2, 10, -3, dw[1]); p.rect(9, -5, 4, 3, P.slate2);
  },
  // The winch and shaft: a timber A-frame over a dark hatch, a rope drum with a crank, the rope and a hook going down.
  winch(p, o) {
    const w = RAMP.wood, dw = RAMP.darkwood;
    p.rect(2, 6, 12, 9, P.ink); p.dither(2, 6, 12, 9, P.night, 8); p.hl(2, 6, 12, dw[0]);
    for (const x of [1, 14]) { p.vl(x, 5, 10, w[1]); p.px(x, 5, w[3]); }
    p.line(1, -12, 4, 6, w[1]); p.line(14, -12, 11, 6, w[0]); p.hl(0, -12, 16, w[2]); p.hl(0, -11, 16, w[0]);
    p.rect(3, -9, 10, 4, dw[1]); p.hl(3, -9, 10, dw[3]); for (let x = 4; x < 13; x += 2) p.px(x, -7, P.tan);
    p.vl(13, -8, 4, P.slate2); p.hl(13, -5, 3, P.slate2); p.px(15, -5, P.slate3);
    p.vl(8, -5, 15, P.tan); p.rect(7, 10, 3, 2, P.slate3); p.px(9, 12, P.slate2);
  },
  // The cell bed: a stone bunk with a thin blanket and an iron grille across its foot.
  cellbed(p, o) {
    const W = o.W, Hh = o.H, g = RAMP.granite;
    block(p, 1, 1, W - 2, Hh - 2, g); block(p, 0, -3, W, 5, g);
    p.rect(3, 3, W - 6, Hh - 10, RAMP.cold[2]); p.dither(3, 3, W - 6, Hh - 10, RAMP.cold[1], 5); p.rect(3, 3, W - 6, 4, P.mist);
    p.hl(1, Hh - 6, W - 2, RAMP.iron[1]); for (let x = 2; x < W - 1; x += 3) p.vl(x, Hh - 9, 8, RAMP.iron[2]); p.hl(1, Hh - 9, W - 2, RAMP.iron[3]);
  },
  // The memorial slab: a broad upright stone carved with six name lines, a candle stub at its foot.
  slab(p, o) {
    const g = RAMP.pale;
    p.rect(0, 12, 16, 3, RAMP.granite[0]); p.hl(0, 12, 16, RAMP.granite[2]);
    block(p, 1, -9, 14, 21, g); p.hl(2, -9, 12, P.bone); p.px(1, -9, P.slate3); p.px(14, -9, P.slate3);
    for (let y = -6; y < 10; y += 3) { p.hl(3, y, 4 + ((y + 6) % 4), RAMP.granite[1]); p.hl(9, y, 4 - ((y + 6) % 3), RAMP.granite[1]); }
    p.rect(12, 13, 2, 2, P.bone); p.px(12, 12, P.flame);
  },
};

/** Live flames on Stage 2 kits: [x, y, r] in world units from the footprint's top-left (kit.FLAME_AT form). */
export const FLAME_AT2 = {
  'struct.hearthfire': (o) => [o.W / 2, 18, 6],
  'struct.beacon': (o) => [o.W / 2, -8, 7],
  'struct.lantern': () => [24, -14, 3],
};
