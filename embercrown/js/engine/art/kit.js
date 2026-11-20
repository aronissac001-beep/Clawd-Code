// Structure, furniture and item kit (owner D; doc 14.6 row D, docs/ART-STYLE.md). The parts named
// by keys.js, drawn as crisp pixel art at the native 16 px per tile: a base (wall block, door frame,
// furniture frames in the wood and stone families, the bench base, posts, the hearth ring, the
// campfire and brazier, item piles) plus props drawn over it (pillow, blanket, cloth, tool props,
// beam, capital, door leaf, kettle, packing tags), in the material's palette ramp (palette.js rampOf).
// The 1 px dark outline is added by the bake (pixel.js bake), light comes from the top-left, and
// walls and furniture stand in the same 3/4 view as the rock faces (a wall's cap is WHP px above it).
//
// Every part is PARTS[name](p, o) in footprint-local NATIVE px: (0, 0) is the top-left corner of
// the footprint; it may draw up to TOP[base] px above it and up to 2 px around it.
// o: { W, H (footprint after rotation, px: 16 per tile), rot, fam ('wood' | 'stone' | 'metal'),
//      r (the material ramp, dark to light), mat (material id or null), v (variant), mask (wall
//      neighbours N 1, E 2, S 4, W 8), open (door), n (stack bucket 0-3) }.
// Flames are not baked: flameSprite(size, frame) is a cached 4-frame pixel flame drawn live.
// Nothing here allocates canvases or runs at import; index.js bakes and caches the sprites.

import { PAL, RAMP } from './palette.js';
import { bake, skey, peek } from './pixel.js';

const P = PAL;
/** Height (px) each base draws above the top of its footprint. */
export const TOP = {
  wallblock: 9, doorframe: 10, 'frame.bed': 5, 'frame.table': 4, 'frame.chair': 8, bench: 4, bracket: 10,
  'post.wood': 18, 'post.stone': 18, hearthring: 8, placeholder: 12, campfire: 2, brazier: 6, bloomery: 15, forgebed: 16,
  logs: 2, stonepile: 2, blocks: 3, orepile: 2, coalpile: 2, ingots: 2, crate: 3, timber: 2, drum: 2, roots: 3, meat: 2, eggs: 2, meal: 2, berries: 2, pickhead: 2, spearshaft: 2,
};
/** Wall height in the 3/4 view in WORLD units (the cap is drawn WH units above the tile); WHP in px. */
export const WH = 16;
export const WHP = 8;

const ramp = (o, fb = RAMP.wood) => o.r || fb;
const vertical = (o) => o.H > o.W;

// ---- Flames ----------------------------------------------------------------------------------------
const FLAME_SIZE = { s: [5, 7], m: [8, 10], l: [12, 14] };
/**
 * A cached pixel flame: size 's' (sconce), 'm' (campfire, brazier), 'l' (the Hearth); frame 0-3.
 * The record's anchor is the flame's base centre (world units).
 */
export function flameSprite(size, frame) {
  const key = skey('flame', (size === 's' ? 0 : size === 'l' ? 2 : 1) * 4 + (frame & 3)), hit = peek(key);
  if (hit) return hit;
  const [w, h] = FLAME_SIZE[size] || FLAME_SIZE.m;
  return bake(key, w + 2, h + 2, (w + 2) / 2, h + 1, (p) => {
    const cx = (w + 2) / 2, base = h + 1;
    const sway = [0, 1, 0, -1][frame & 3], lick = [0, 1, 2, 1][frame & 3];
    // outer tongue (ember red), body (orange), core (gold), heart (flame yellow)
    const tongue = (rx, ry, c, dx) => {
      for (let y = 0; y < ry; y++) {
        const k = y / ry, hw = Math.max(0, Math.round(rx * (1 - k * k * 0.9) - (y > ry * 0.6 ? 0.5 : 0)));
        const x0 = Math.round(cx - hw + dx * k), x1 = Math.round(cx + hw + dx * k);
        if (x1 > x0) p.rect(x0, base - 1 - y, x1 - x0, 1, c);
      }
    };
    tongue(w / 2, h - lick, P.ember1, sway);
    tongue(w / 2 - 1, h - 2 - lick, P.orange, sway);
    tongue(Math.max(1, w / 2 - 2), Math.max(2, h - 4 - lick), P.gold, sway * 0.5);
    tongue(Math.max(1, w / 4), Math.max(1, h / 3), P.flame, 0);
    if (frame & 1) p.px(Math.round(cx + sway * 2), Math.max(0, base - h - 1), P.gold); // a spark
  }, { outline: false });
}
/** Draw the live flame at world (x, y) = its base centre; r: world radius (picks the size); t: seconds. */
export function flame(g, x, y, r, t = 0, calm = false) {
  const size = r >= 11 ? 'l' : r >= 6 ? 'm' : 's';
  const fr = calm ? 0 : ((t * 8 + x * 0.13) | 0) & 3;
  const sp = flameSprite(size, fr);
  g.drawImage(sp.c, Math.round((x - sp.ax) / 2) * 2, Math.round((y - sp.ay) / 2) * 2, sp.w, sp.h);
}

// ---- Shared pieces ----------------------------------------------------------------------------------
/** A wooden board (horizontal) with grain, lit from the top-left. */
export function board(p, x, y, w, h, r) {
  p.rect(x, y, w, h, r[2]);
  p.hl(x, y, w, r[3]);
  p.hl(x, y + h - 1, w, r[0]);
  for (let i = x + 2; i < x + w - 1; i += 4) p.px(i, y + 1 + ((i >> 2) % Math.max(1, h - 2)), r[1]);
}
/** A stone block with a lit top-left edge. */
export function block(p, x, y, w, h, r) {
  p.rect(x, y, w, h, r[1]);
  p.hl(x, y, w, r[2]); p.vl(x, y, h, r[2]); p.px(x, y, r[3]);
  p.hl(x, y + h - 1, w, r[0]); p.vl(x + w - 1, y, h, r[0]);
}
export const boxOf = (o) => (o.fam === 'stone' || o.fam === 'metal' ? block : board);

export const PARTS = {
  // ---- Walls and doors ------------------------------------------------------------------------------
  wallblock(p, o) {
    const m = o.mask | 0, S = m & 4, r = ramp(o, RAMP.granite), wood = o.fam === 'wood';
    // the cap (top surface), lifted WHP px: rows -8..7
    const cy = -WHP;
    if (wood) {
      p.rect(0, cy, 16, 16, r[1]);
      for (let k = 0; k < 4; k++) { // log ends seen from above
        const x = 2 + k * 4;
        p.rect(x - 1, cy + 5, 3, 3, r[3]); p.px(x, cy + 6, r[1]); p.px(x + 1, cy + 7, r[0]);
      }
      p.hl(0, cy + 2, 16, r[0]); p.hl(0, cy + 12, 16, r[0]); p.hl(0, cy + 1, 16, r[2]);
    } else {
      p.rect(0, cy, 16, 16, r[2]);
      const off = (o.v & 1) * 4;
      p.hl(0, cy + 7, 16, r[1]); p.hl(0, cy + 15, 16, r[1]);
      p.vl((6 + off) % 16, cy, 7, r[1]); p.vl((14 + off) % 16, cy + 8, 7, r[1]); p.vl((2 + off) % 16, cy + 8, 7, r[1]);
      p.px((1 + off) % 16, cy + 1, r[3]); p.px((9 + off) % 16, cy + 9, r[3]);
    }
    if (!(m & 1)) p.hl(0, cy, 16, r[3]);
    if (!(m & 8)) p.vl(0, cy, 16, r[3]);
    if (!(m & 2)) p.vl(15, cy, S ? 16 : 16, r[0]);
    // the face toward the viewer (only where the south neighbour is not a wall): rows 8..15
    if (!S) {
      const fy = 16 - WHP;
      if (wood) {
        p.rect(0, fy, 16, WHP, r[1]);
        for (let x = 3; x < 16; x += 4) p.vl(x, fy, WHP, r[0]);
        p.hl(0, fy + 3, 16, r[0]); p.px(2, fy + 3, P.slate3); p.px(13, fy + 3, P.slate3);
        p.hl(0, fy, 16, r[2]);
      } else {
        p.rect(0, fy, 16, WHP, r[1]);
        p.hl(0, fy + 3, 16, r[0]); p.hl(0, fy + 7, 16, r[0]);
        const off = (o.v & 1) * 4;
        p.vl((4 + off) % 16, fy, 3, r[0]); p.vl((12 + off) % 16, fy, 3, r[0]); p.vl((8 + off) % 16, fy + 4, 3, r[0]); p.vl(off, fy + 4, 3, r[0]);
        p.hl(0, fy, 16, r[2]);
      }
      if (!(m & 8)) p.vl(0, fy, WHP, r[2]);
      if (!(m & 2)) p.vl(15, fy, WHP, r[0]);
    }
  },
  doorframe(p, o) {
    // horizontal: a door in an E-W run (faces the viewer); vertical: in a N-S run (edge on)
    const m = o.mask | 0, horiz = (m & 10) !== 0 || !(m & 5), r = ramp(o);
    if (horiz) {
      p.rect(0, -WHP - 1, 3, 16 + WHP + 1, r[1]); p.vl(0, -WHP - 1, 16 + WHP + 1, r[2]);
      p.rect(13, -WHP - 1, 3, 16 + WHP + 1, r[1]); p.vl(15, -WHP - 1, 16 + WHP + 1, r[0]);
      board(p, 0, -WHP - 2, 16, 3, r);
    } else {
      p.rect(5, 0, 6, 16, P.night);
      block(p, 4, -WHP, 8, 4, r);
      block(p, 4, 16 - WHP - 1, 8, WHP + 1, r);
    }
  },
  doorleaf(p, o) {
    const m = o.mask | 0, horiz = (m & 10) !== 0 || !(m & 5), r = ramp(o);
    if (horiz) {
      if (o.open) { // swung inward: a dark doorway and the leaf edge on against the west post
        p.rect(3, -WHP + 1, 10, 16 + WHP - 2, P.night);
        p.dither(3, 8, 10, 7, P.slate0, 6);
        p.rect(3, -WHP + 2, 2, 16 + WHP - 3, r[2]); p.vl(4, -WHP + 2, 16 + WHP - 3, r[0]);
      } else {
        p.rect(3, -WHP + 1, 10, 16 + WHP - 2, r[2]);
        for (const x of [5, 8, 11]) p.vl(x, -WHP + 1, 16 + WHP - 2, r[1]);
        p.hl(3, -WHP + 1, 10, r[3]);
        p.hl(3, -WHP + 4, 10, P.slate1); p.hl(3, 11, 10, P.slate1);
        p.px(11, 4, P.gold); p.px(11, 5, P.umber0);
      }
    } else if (o.open) {
      p.rect(5, -WHP + 4, 2, 16 + WHP - 8, r[2]);
    } else {
      p.rect(6, -WHP + 4, 4, 16 + WHP - 6, r[2]); p.vl(8, -WHP + 4, 16 + WHP - 6, r[0]); p.px(7, 4, P.gold);
    }
  },

  // ---- Furniture frames (wood and stone families) ---------------------------------------------------
  'frame.bed'(p, o) {
    const r = ramp(o), W = o.W, Hh = o.H, rot = o.rot & 3, stone = o.fam !== 'wood', bx = boxOf(o);
    // frame with corner posts
    if (stone) { block(p, 1, 1, W - 2, Hh - 2, r); block(p, 2, Hh - 4, W - 4, 3, [r[0], r[0], r[1], r[1]]); }
    else { board(p, 1, 1, W - 2, Hh - 2, r); for (const [x, y] of [[0, 0], [W - 3, 0], [0, Hh - 3], [W - 3, Hh - 3]]) p.rect(x, y, 3, 3, r[0]); }
    // headboard at the head end (rot 0 north, 1 east, 2 south, 3 west), raised
    if (vertical(o)) { const y = rot === 2 ? Hh - 4 : -4; bx(p, 0, y, W, 5, r); }
    else { const x = rot === 1 ? W - 4 : 0; bx(p, x, -3, 4, Hh + 3, r); }
    // mattress
    p.rect(2, 2, W - 4, Hh - 4, P.mist); p.hl(2, 2, W - 4, P.bone); p.vl(W - 3, 2, Hh - 4, P.slate3);
  },
  pillow(p, o) {
    const W = o.W, Hh = o.H, rot = o.rot & 3;
    if (vertical(o)) { const y = rot === 2 ? Hh - 7 : 2; p.rect(3, y, W - 6, 4, P.bone); p.hl(3, y + 3, W - 6, P.mist); p.px(3, y, P.mist); }
    else { const x = rot === 1 ? W - 7 : 2; p.rect(x, 3, 4, Hh - 6, P.bone); p.vl(x + 3, 3, Hh - 6, P.mist); }
  },
  blanket(p, o) {
    const W = o.W, Hh = o.H, rot = o.rot & 3;
    const RS = [RAMP.red, RAMP.water, RAMP.grass, RAMP.plum], r = RS[(o.v | 0) & 3];
    let x, y, w, h;
    if (vertical(o)) { x = 1; w = W - 2; h = Math.round(Hh * 0.55); y = rot === 2 ? 2 : Hh - h - 1; }
    else { y = 1; h = Hh - 2; w = Math.round(W * 0.55); x = rot === 1 ? 2 : W - w - 1; }
    p.rect(x, y, w, h, r[1]);
    p.dither(x + (w >> 1), y, w - (w >> 1), h, r[0], 6);
    if (vertical(o)) p.hl(x, rot === 2 ? y + h - 2 : y + 1, w, r[3]); else p.vl(rot === 1 ? x + w - 2 : x + 1, y, h, r[3]);
    p.px(x + 1, y + 1, r[2]);
  },
  'frame.table'(p, o) {
    const r = ramp(o), W = o.W, Hh = o.H, stone = o.fam !== 'wood';
    // legs, the front apron, then the top raised 3 px
    p.rect(1, Hh - 6, 2, 6, r[0]); p.rect(W - 3, Hh - 6, 2, 6, r[0]);
    p.rect(0, Hh - 8, W, 3, r[1]); p.hl(0, Hh - 6, W, r[0]);
    if (stone) block(p, 0, -3, W, Hh - 5, r); else { board(p, 0, -3, W, Hh - 5, r); for (let y = 1; y < Hh - 9; y += 4) p.hl(1, y, W - 2, r[1]); }
  },
  cloth(p, o) { // a runner along the long side, hanging over the front, with a candle
    const W = o.W, Hh = o.H;
    if (W >= Hh) { p.rect(4, -1, W - 8, Hh - 8, P.ember1); p.hl(4, -1, W - 8, P.orange); p.rect(4, Hh - 8, W - 8, 2, P.ember0); p.dither(4, -1, W - 8, Hh - 7, P.ember0, 3); }
    else { p.rect(3, 1, W - 6, Hh - 10, P.ember1); p.vl(3, 1, Hh - 10, P.orange); }
    const cx = (W >> 1) - 1;
    p.rect(cx, -5, 2, 3, P.bone); p.px(cx, -6, P.gold); p.px(cx + 1, -3, P.mist);
  },
  'frame.chair'(p, o) {
    const r = ramp(o), rot = o.rot & 3, bx = boxOf(o);
    // legs, seat, and the back on the side the chair faces away from
    p.rect(4, 11, 1, 4, r[0]); p.rect(11, 11, 1, 4, r[0]);
    if (rot === 0) { bx(p, 4, -7, 8, 12, r); p.hl(5, -4, 6, r[1]); }
    bx(p, 3, 6, 10, 5, r);
    if (rot === 1) bx(p, 11, -4, 3, 12, r);
    if (rot === 3) bx(p, 2, -4, 3, 12, r);
    if (rot === 2) { bx(p, 4, 4, 8, 8, r); }
  },
  bench(p, o) {
    const r = ramp(o), W = o.W, Hh = o.H;
    // legs and a front apron with a drawer, the top raised 3 px
    p.rect(1, Hh - 7, 2, 7, r[0]); p.rect(W - 3, Hh - 7, 2, 7, r[0]);
    p.rect(1, Hh - 3, W - 2, 1, r[0]);
    p.rect(0, Hh - 9, W, 4, r[1]); p.hl(0, Hh - 6, W, r[0]);
    if (W >= Hh) { p.rect(W / 2 - 3, Hh - 8, 6, 2, r[0]); p.px(W / 2, Hh - 8, P.gold); }
    boxOf(o)(p, 0, -3, W, Hh - 6, r);
  },
  'tool.saw'(p, o) { // a bow saw resting across the top
    const x = o.W >= o.H ? 3 : 2, y = 0;
    p.rect(x, y, 9, 2, P.mist); p.hl(x, y + 1, 9, P.slate2);
    for (let i = x; i < x + 9; i += 2) p.px(i, y + 2, P.slate2);
    p.rect(x + 9, y - 1, 3, 3, P.umber2); p.px(x + 9, y - 1, P.umber3);
  },
  'tool.plane'(p, o) { const x = o.W >= o.H ? o.W - 10 : 4, y = o.W >= o.H ? 1 : 16; p.rect(x, y, 5, 3, P.umber3); p.hl(x, y, 5, P.tan); p.rect(x + 2, y - 1, 1, 2, P.mist); },
  'planks.offcut'(p, o) { if (o.W < o.H) return; for (let k = 0; k < 2; k++) board(p, o.W - 9 + k * 2, o.H - 4 - k * 2, 7, 2, RAMP.wood); },
  'tool.mallet'(p, o) { const x = o.W >= o.H ? 4 : 3, y = 0; p.rect(x, y, 4, 4, P.umber3); p.hl(x, y, 4, P.tan); p.vl(x + 3, y, 4, P.umber1); p.rect(x + 4, y + 1, 5, 1, P.umber2); },
  'tool.chisel'(p, o) { const x = o.W >= o.H ? 12 : 6, y = o.W >= o.H ? 1 : 14; p.rect(x, y, 4, 1, P.mist); p.rect(x - 3, y, 3, 1, P.umber2); p.px(x + 3, y, P.bone); },
  'block.offcut'(p, o) { if (o.W < o.H) return; const r = ramp(o, RAMP.granite); block(p, o.W - 8, -1, 5, 4, r); block(p, o.W - 7, o.H - 4, 4, 3, r); },
  bracket(p, o) { // torch sconce: an iron bracket on a short wooden post; the flame is drawn live above (FLAME_AT)
    const r = ramp(o);
    p.rect(7, -4, 2, 18, r[1]); p.vl(7, -4, 18, r[2]); p.rect(6, 13, 4, 2, r[0]);
    p.rect(9, -6, 4, 1, P.slate2); p.rect(10, -9, 4, 3, P.slate1); p.hl(10, -9, 4, P.slate3); // the cup
    p.rect(11, -10, 2, 1, P.umber1);
  },
  flame() {}, // live, drawn per frame (flameSprite)
  'post.wood'(p, o) {
    const r = ramp(o);
    p.shadow(8, 15, 5, 1.5, 8);
    p.rect(6, -14, 4, 29, r[1]); p.vl(6, -14, 29, r[2]); p.vl(9, -14, 29, r[0]);
    p.px(7, -6, r[0]); p.px(8, 3, r[0]);
    p.rect(3, -12, 2, 4, r[0]); p.rect(11, -12, 2, 4, r[0]); // braces
  },
  beam(p, o) { const r = ramp(o); board(p, 0, -17, 16, 4, r); p.px(7, -16, P.slate1); },
  'post.stone'(p, o) {
    const r = ramp(o, RAMP.granite);
    p.shadow(8, 15, 6, 1.6, 8);
    p.rect(4, -12, 8, 26, r[1]); p.rect(4, -12, 2, 26, r[2]); p.rect(10, -12, 2, 26, r[0]);
    p.hl(5, -4, 6, r[0]); p.hl(5, 5, 6, r[0]);
    block(p, 3, 12, 10, 3, r);
  },
  capital(p, o) { const r = ramp(o, RAMP.granite); block(p, 2, -16, 12, 4, r); p.hl(3, -12, 10, r[0]); },
  hearthring(p, o) {
    const W = o.W, Hh = o.H, cx = W / 2, cy = Hh / 2 + 2, r = ramp(o, RAMP.granite);
    // the pit, its coals and the stone ring
    // a cold Hearth (no fuel, or the ruin): grey ash and charred ends where the coals glowed
    p.ellipse(cx, cy, W / 2 - 3, Hh / 2 - 6, P.ink);
    p.ellipse(cx, cy, W / 2 - 6, Hh / 2 - 9, o.cold ? P.slate1 : P.ember0);
    for (let k = 0; k < 14; k++) p.px(cx - 10 + ((k * 7) % 21), cy - 4 + ((k * 5) % 9), o.cold ? (k & 1 ? P.slate2 : P.slate0) : k & 1 ? P.orange : P.ember1);
    const n = 16;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2, x = Math.round(cx + Math.cos(a) * (W / 2 - 5)) - 3, y = Math.round(cy + Math.sin(a) * (Hh / 2 - 8)) - 2;
      block(p, x, y, 6, 4, (k & 1) ? r : [r[0], r[1], r[2], r[3]]);
    }
    // andirons
    p.rect(cx - 7, cy - 2, 2, 4, P.slate1); p.rect(cx + 5, cy - 2, 2, 4, P.slate1);
    board(p, cx - 8, cy, 16, 2, RAMP.darkwood);
  },
  kettle(p, o) { // a tripod and kettle on the east side of the ring
    const x = o.W - 12, y = 4;
    p.line(x, y + 12, x + 4, y - 4, P.slate1); p.line(x + 8, y + 12, x + 4, y - 4, P.slate1);
    p.ellipse(x + 4, y + 4, 4, 3, P.slate1); p.hl(x + 1, y + 2, 6, P.slate2); p.px(x + 2, y + 2, P.slate3);
    p.rect(x + 3, y - 1, 2, 1, P.slate2);
  },
  campfire(p, o) { // a ring of stones around crossed logs; the flame is live (FLAME_AT)
    const r = RAMP.granite;
    p.ellipse(8, 10, 6, 3.5, P.ink); p.ellipse(8, 10, 4.5, 2.4, o.cold ? P.slate1 : P.ember0);
    if (o.cold) { p.px(6, 10, P.slate2); p.px(9, 11, P.slate0); p.px(10, 9, P.slate2); } else { p.px(6, 10, P.orange); p.px(9, 11, P.ember1); p.px(10, 9, P.orange); }
    p.line(3, 12, 12, 8, P.umber1); p.line(3, 11, 12, 7, P.umber2); p.line(4, 8, 13, 12, P.umber2); p.line(4, 7, 13, 11, P.umber3);
    for (const [x, y] of [[1, 9], [4, 6], [9, 5], [13, 8], [12, 12], [6, 13], [2, 12]]) { p.rect(x, y, 3, 2, r[1]); p.px(x, y, r[3]); p.px(x + 2, y + 1, r[0]); }
  },
  brazier(p, o) { // an iron bowl of coals on three legs; the flame is live (FLAME_AT)
    p.shadow(8, 15, 5, 1.4, 8);
    p.line(4, 15, 6, 8, P.slate1); p.line(12, 15, 10, 8, P.slate1); p.vl(8, 9, 6, P.slate0);
    p.ellipse(8, 5, 6, 3, P.slate1); p.rect(2, 5, 12, 3, P.slate1); p.hl(2, 7, 12, P.slate0); p.hl(3, 5, 10, P.slate2);
    if (o.cold) { p.ellipse(8, 4.5, 4.5, 1.6, P.slate0); p.px(6, 4, P.slate2); p.px(9, 5, P.slate1); p.px(10, 4, P.slate2); } else { p.ellipse(8, 4.5, 4.5, 1.6, P.ember0); p.px(6, 4, P.orange); p.px(9, 5, P.gold); p.px(10, 4, P.ember1); }
    p.px(2, 5, P.slate3);
  },
  bloomery(p, o) { // a squat shaft furnace of stone and clay on a plinth: the glowing mouth at the front,
    // leather bellows on the west side, a slag lump and a few coals; a small live flame licks the top
    const r = ramp(o, RAMP.granite), cl = RAMP.wood;
    p.shadow(16, 29, 14, 2.5, 8);
    // the plinth: top surface and front face with mortar joints
    p.rect(2, 16, 28, 8, r[1]); p.hl(2, 16, 28, r[2]); p.vl(2, 16, 8, r[2]); p.px(2, 16, r[3]);
    p.rect(2, 24, 28, 5, r[0]); p.hl(2, 24, 28, r[1]);
    for (const x of [8, 15, 22]) p.vl(x, 25, 4, P.ink);
    // the shaft: tapered rows (wide at the base), lit on the west, clay daub bands
    for (let y = -12; y <= 21; y++) {
      const k = (y + 12) / 33, hw = Math.round(5 + k * 4), x0 = 16 - hw, x1 = 16 + hw;
      p.rect(x0, y, x1 - x0, 1, r[1]);
      p.px(x0, y, r[2]); p.px(x0 + 1, y, r[2]); p.px(x1 - 1, y, r[0]); p.px(x1 - 2, y, r[0]);
      if (((y + 12) & 3) === 3) for (let x = x0 + 2; x < x1 - 2; x += 3) p.px(x + (((y + 12) >> 2) & 1), y, r[0]);
    }
    for (const by of [-4, 6]) { const hw = Math.round(5 + ((by + 12) / 33) * 4); p.rect(16 - hw, by, hw * 2, 2, cl[1]); p.hl(16 - hw, by, hw * 2, cl[2]); p.px(16 - hw, by, cl[3]); }
    // the throat at the top: a dark ring with embers
    p.rect(12, -13, 8, 2, P.ink); p.hl(13, -13, 6, P.ember0); p.px(15, -13, P.orange); p.px(17, -13, P.gold);
    // the mouth: an arch, coals glowing inside
    p.rect(13, 14, 6, 8, P.ink); p.hl(14, 13, 4, P.ink);
    p.rect(14, 16, 4, 6, P.ember0); p.rect(14, 19, 4, 3, P.ember1); p.px(15, 20, P.orange); p.px(16, 21, P.gold); p.px(14, 17, P.orange); p.px(17, 18, P.flame);
    // bellows on the west: a leather wedge with boards and a nozzle into the mouth
    p.rect(1, 18, 7, 5, P.umber2); p.hl(1, 18, 7, P.umber3); p.hl(1, 22, 7, P.umber1);
    p.px(3, 20, P.umber1); p.px(5, 20, P.umber1);
    p.rect(0, 17, 2, 7, cl[1]); p.vl(0, 17, 7, cl[2]);
    p.hl(8, 20, 5, P.slate1); p.px(12, 20, P.slate2);
    // a slag lump and coals at the east foot
    p.rect(23, 20, 4, 3, P.slate0); p.px(23, 20, P.slate2); p.px(25, 21, P.ember1);
    for (const [x, y] of [[26, 17], [28, 18], [27, 19]]) { p.rect(x, y, 2, 1, P.night); p.px(x, y, P.slate2); }
  },
  forgebed(p, o) { // a smith's forge: a stone hearth with a hooded chimney and a coal bed (west), an anvil
    // on a stump (south-east), a quench tub (north-east), tongs leaning; the coals' flame is live
    const r = ramp(o, RAMP.granite), wd = RAMP.darkwood || RAMP.wood;
    p.shadow(16, 29, 14, 2.5, 8);
    // the chimney hood behind the hearth
    p.rect(4, -14, 10, 4, r[1]); p.hl(4, -14, 10, r[2]); p.vl(13, -14, 4, r[0]);
    p.rect(2, -10, 14, 12, r[1]); p.vl(2, -10, 12, r[2]); p.vl(3, -10, 12, r[2]); p.vl(15, -10, 12, r[0]); p.hl(2, -10, 14, r[2]);
    for (let y = -7; y < 2; y += 4) for (let x = 4 + ((y >> 2) & 1) * 2; x < 15; x += 4) p.px(x, y, r[0]);
    p.rect(4, 0, 10, 2, P.ink);
    // the hearth: top (the coal bed) and front face
    p.rect(1, 2, 16, 10, r[1]); p.hl(1, 2, 16, r[2]); p.vl(1, 2, 10, r[2]); p.px(1, 2, r[3]);
    p.ellipse(9, 7, 6, 3, P.ink); p.ellipse(9, 7, 4.5, 2, P.ember0);
    for (const [x, y, c] of [[6, 7, P.orange], [8, 6, P.gold], [10, 8, P.ember1], [11, 6, P.orange], [9, 8, P.flame], [7, 8, P.ember1]]) p.px(x, y, c);
    p.rect(1, 12, 16, 12, r[0]); p.hl(1, 12, 16, r[1]); p.vl(1, 12, 12, r[1]);
    p.hl(2, 17, 14, P.ink); p.vl(9, 13, 4, P.ink); p.vl(5, 18, 5, P.ink); p.vl(13, 18, 5, P.ink);
    p.rect(6, 14, 6, 3, P.ink); p.hl(7, 15, 4, P.ember0);                                   // the ash door
    // the quench tub (north-east): staves and dark water
    p.rect(21, 2, 9, 9, wd[1]); p.vl(21, 2, 9, wd[2]); p.vl(29, 2, 9, wd[0]); p.hl(21, 5, 9, P.slate1); p.hl(21, 9, 9, P.slate1);
    p.ellipse(25.5, 2.5, 4, 1.6, P.deep); p.px(24, 2, P.shallow);
    // the stump and the anvil (south-east)
    p.rect(21, 20, 7, 9, wd[1]); p.vl(21, 20, 9, wd[2]); p.vl(27, 20, 9, wd[0]); p.hl(21, 19, 7, P.tan); p.px(23, 19, wd[2]);
    p.rect(18, 14, 13, 2, P.slate2); p.hl(18, 14, 13, P.slate3); p.px(30, 15, P.slate1);            // face and horn
    p.px(17, 14, P.slate2); p.px(16, 15, P.slate1);
    p.rect(22, 16, 5, 2, P.slate1); p.rect(20, 18, 9, 1, P.slate1); p.hl(20, 18, 9, P.slate0);
    p.rect(24, 12, 4, 2, P.umber2); p.px(27, 12, P.slate2); p.hl(19, 13, 4, P.slate3);               // a hammer resting, a hot bar
    p.px(19, 13, P.orange); p.px(20, 13, P.gold);
    // tongs leaning on the hearth
    p.line(17, 22, 19, 11, P.slate1); p.line(18, 23, 20, 12, P.slate2);
  },
  placeholder(p, o) { // a later structure: a staked plot with a sign (its art arrives in its stage)
    const W = o.W, Hh = o.H;
    p.dither(1, 1, W - 2, Hh - 2, P.umber2, 4);
    for (const [x, y] of [[0, 0], [W - 2, 0], [0, Hh - 2], [W - 2, Hh - 2]]) { p.rect(x, y - 3, 2, 5, P.umber2); p.px(x, y - 3, P.tan); }
    p.hl(2, 0, W - 4, P.tan); p.hl(2, Hh - 1, W - 4, P.tan); p.vl(0, 2, Hh - 4, P.tan); p.vl(W - 1, 2, Hh - 4, P.tan);
    const sx = (W >> 1) - 5, sy = (Hh >> 1) - 10;
    p.rect(sx + 4, sy + 6, 2, 10, P.umber1);
    board(p, sx, sy, 10, 7, RAMP.wood);
    p.rect(sx + 3, sy + 2, 4, 1, P.umber0); p.px(sx + 6, sy + 3, P.umber0); p.px(sx + 5, sy + 4, P.umber0); p.px(sx + 5, sy + 6, P.umber0);
  },

  // ---- Items (stacks on the ground; n = stack bucket 0-3) -------------------------------------------
  logs(p, o) {
    const r = ramp(o), k = [1, 2, 3, 4][o.n | 0];
    p.shadow(8, 13, 7, 1.6, 8);
    const at = [[2, 9], [6, 9], [4, 6], [5, 3]];
    for (let i = 0; i < k; i++) {
      const [x, y] = at[i];
      p.rect(x, y, 8, 3, r[1]); p.hl(x, y, 8, r[2]); p.hl(x, y + 2, 8, r[0]);
      p.rect(x + 8, y, 2, 3, r[3]); p.px(x + 8, y + 1, r[1]);
    }
  },
  stonepile(p, o) {
    const r = ramp(o, RAMP.granite), k = [1, 2, 4, 6][o.n | 0];
    p.shadow(8, 13, 6.5, 1.6, 8);
    const at = [[5, 9, 5, 4], [9, 10, 4, 3], [2, 10, 4, 3], [7, 6, 4, 4], [3, 7, 3, 3], [10, 7, 3, 3]];
    for (let i = 0; i < k; i++) { const [x, y, w, h] = at[i]; block(p, x, y, w, h, r); }
  },
  blocks(p, o) {
    const r = ramp(o, RAMP.granite), k = [1, 2, 3, 5][o.n | 0];
    p.shadow(8, 13, 7, 1.6, 8);
    const at = [[2, 9], [8, 9], [5, 5], [2, 1], [8, 1]];
    for (let i = 0; i < k; i++) { const [x, y] = at[i]; block(p, x, y, 6, 4, r); p.hl(x + 1, y + 1, 4, r[2]); }
  },
  orepile(p, o) { // host rock with metal flecks
    const r = ramp(o, RAMP.copper), host = RAMP.slate, k = [1, 2, 3, 5][o.n | 0];
    p.shadow(8, 13, 6.5, 1.6, 8);
    const at = [[4, 9], [9, 9], [6, 6], [2, 7], [10, 6]];
    for (let i = 0; i < k; i++) { const [x, y] = at[i]; block(p, x, y, 4, 4, host); p.px(x + 1, y + 1, r[2]); p.px(x + 2, y + 2, r[1]); p.px(x + 1, y + 1, r[3]); }
  },
  coalpile(p, o) {
    const k = [2, 3, 5, 7][o.n | 0];
    p.shadow(8, 13, 6.5, 1.6, 8);
    const at = [[4, 10], [8, 10], [6, 8], [10, 8], [3, 8], [7, 6], [5, 11]];
    for (let i = 0; i < k; i++) { const [x, y] = at[i]; p.rect(x, y, 3, 2, P.night); p.px(x, y, P.slate2); }
  },
  ingots(p, o) {
    const r = ramp(o, RAMP.iron), k = [1, 2, 3, 4][o.n | 0];
    p.shadow(8, 13, 7, 1.5, 8);
    const at = [[2, 10], [8, 10], [5, 7], [5, 4]];
    for (let i = 0; i < k; i++) { const [x, y] = at[i]; p.rect(x + 1, y, 5, 1, r[3]); p.rect(x, y + 1, 7, 2, r[1]); p.hl(x, y + 1, 7, r[2]); p.px(x + 6, y + 2, r[0]); }
  },
  crate(p, o) { // installable furniture travels packed: a lashed crate in its material
    const r = ramp(o);
    p.shadow(8, 13, 7, 1.6, 8);
    (o.fam === 'stone' ? block : board)(p, 2, 3, 12, 10, r);
    p.vl(2, 3, 10, r[0]); p.vl(13, 3, 10, r[0]); p.hl(2, 7, 12, r[0]);
    p.vl(5, 3, 10, P.umber0); // the lashing
  },
  'tag.bed'(p) { p.rect(8, 9, 4, 2, P.bone); p.px(8, 8, P.bone); },
  'tag.table'(p) { p.hl(7, 8, 5, P.bone); p.px(8, 9, P.bone); p.px(11, 9, P.bone); },
  'tag.chair'(p) { p.vl(8, 7, 4, P.bone); p.hl(8, 9, 3, P.bone); p.px(10, 10, P.bone); },
  timber(p, o) { const r = ramp(o); p.shadow(8, 13, 7.5, 1.5, 8); board(p, 1, 9, 14, 3, r); board(p, 3, 6, 10, 3, r); p.rect(14, 9, 1, 3, r[3]); },
  drum(p, o) { // a column section lying on its side
    const r = ramp(o, RAMP.granite);
    p.shadow(8, 13, 7, 1.5, 8);
    p.rect(3, 6, 9, 6, r[1]); p.hl(3, 6, 9, r[2]); p.hl(3, 11, 9, r[0]);
    p.ellipse(12.5, 9, 2, 3, r[2]); p.px(12, 8, r[3]);
  },
  roots(p, o) { // hearthroot: orange tubers with green tops
    const k = [1, 2, 3, 4][o.n | 0];
    p.shadow(8, 13, 6, 1.5, 8);
    const at = [[4, 9], [8, 10], [6, 7], [10, 7]];
    for (let i = 0; i < k; i++) { const [x, y] = at[i]; p.rect(x, y, 3, 3, P.orange); p.px(x, y, P.gold); p.px(x + 2, y + 2, P.ember1); p.px(x + 1, y - 1, P.moss3); p.px(x + 2, y - 2, P.moss2); }
  },
  berries(p, o) { // a heap of red berries on leaves
    const k = [3, 5, 8, 11][o.n | 0];
    p.shadow(8, 13, 6, 1.5, 8);
    p.rect(3, 10, 10, 2, P.moss1); p.px(2, 11, P.moss2); p.px(13, 10, P.moss2);
    const at = [[5, 9], [8, 9], [10, 10], [6, 7], [9, 7], [4, 10], [7, 5], [11, 8], [3, 8], [8, 11], [12, 9]];
    for (let i = 0; i < k; i++) { const [x, y] = at[i]; p.rect(x, y, 2, 2, P.danger); p.px(x, y, P.peach); p.px(x + 1, y + 1, P.ember1); }
  },
  pickhead(p) { // a pick lying on the ground: an ash haft and an iron head
    p.shadow(8, 13, 7, 1.4, 8);
    p.line(2, 12, 12, 7, P.umber2); p.line(3, 12, 12, 8, P.umber3);
    p.line(9, 3, 15, 10, P.slate2); p.px(9, 3, P.mist); p.px(15, 10, P.slate3); p.px(12, 6, P.slate1);
  },
  spearshaft(p) { // a spear lying on the ground: a long haft, a binding and a leaf-shaped iron head
    p.shadow(8, 13, 7.5, 1.3, 8);
    p.line(0, 13, 11, 6, P.umber2); p.line(1, 13, 11, 7, P.umber3);
    p.px(10, 6, P.tan); p.px(11, 6, P.tan);
    p.rect(12, 4, 2, 2, P.slate2); p.px(14, 3, P.slate3); p.px(15, 2, P.mist); p.px(12, 4, P.mist); p.px(13, 5, P.slate1);
  },
  meat(p) { p.shadow(8, 13, 6, 1.5, 8); p.rect(3, 7, 9, 5, P.ember1); p.hl(3, 7, 9, P.danger); p.rect(4, 8, 2, 2, P.peach); p.rect(12, 9, 2, 2, P.bone); p.hl(3, 11, 9, P.ember0); },
  eggs(p) { p.shadow(8, 13, 6, 1.5, 8); for (const [x, y] of [[4, 9], [8, 10], [10, 8], [6, 7]]) { p.rect(x, y, 3, 3, P.bone); p.px(x + 2, y + 2, P.mist); p.px(x, y, P.flame); } },
  meal(p) { p.shadow(8, 13, 6.5, 1.5, 8); p.ellipse(8, 10, 6, 3, P.umber2); p.hl(3, 12, 10, P.umber1); p.ellipse(8, 9, 4.5, 1.6, P.gold); p.px(6, 9, P.ember1); p.px(10, 9, P.moss3); p.px(8, 8, P.flame); },
};

/** Where the live flame of a lit structure sits (footprint-local WORLD units, base centre), and its world radius. */
export const FLAME_AT = {
  'struct.sconce': (o) => [24, -20, 4],
  'struct.hearth': (o) => [o.W / 2, o.H / 2 + 2, 13],
  'struct.campfire': (o) => [16, 20, 8],
  'struct.brazier': (o) => [16, 8, 7],
  'struct.bloomery': (o) => [32, -24, 4],
  'struct.forge': (o) => [18, 16, 4],
};

/** Stack bucket 0-3 from a count and the item's stack limit. */
export function bucketOf(n, stack = 75) {
  if (stack <= 1 || n <= 1) return 0;
  const f = n / stack;
  return f < 0.25 ? 1 : f < 0.75 ? 2 : 3;
}
