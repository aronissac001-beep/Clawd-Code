// Structure, furniture and item kit (owner D; doc 14.6 row D). The parts named by keys.js: a base
// (wall block, door frame, furniture frames in the wood and stone families, the bench base, posts,
// the hearth ring, item piles) plus props drawn over it (pillow, blanket, cloth, tool props, beam,
// capital, door leaf, kettle, packing tags), tinted by the material. Drawn in the roguelite style
// (sprites.js: chunky miniatures, ink outlines, warm light from the upper left).
//
// Every part is PARTS[name](g, o) in footprint-local world units: (0, 0) is the top-left corner
// of the footprint, it may draw up to o.top units above it (height) and up to 4 units around it.
// o: { W, H (footprint after rotation, world units), rot, fam ('wood' | 'stone' | 'metal'),
//      tint (resolved colour), mat (material id or null), v (variant), mask (wall neighbours
//      N 1, E 2, S 4, W 8), open (door), n (stack bucket 0-3), t (seconds; animated props only) }.
// TOP[base] is the height a base needs above its footprint. Nothing here allocates canvases or
// runs at import; index.js caches the sprites through sprites.js.

import { TILE } from '../../game/core/grid.js';
import { ART as H } from '../sprites.js';
import { ORE_LOOK } from './keys.js';

/** Lighten (f > 0) or darken (f < 0) a colour given as '#rrggbb' or 'rgb(r,g,b)' (shaded colours shade again). */
export function shade(c, f) {
  let r, g2, b;
  if (c[0] === '#') { const n = parseInt(c.slice(1), 16); r = (n >> 16) & 255; g2 = (n >> 8) & 255; b = n & 255; }
  else { const m = c.match(/[\d.]+/g); r = +m[0]; g2 = +m[1]; b = +m[2]; }
  if (f >= 0) { r += (255 - r) * f; g2 += (255 - g2) * f; b += (255 - b) * f; } else { r *= 1 + f; g2 *= 1 + f; b *= 1 + f; }
  return `rgb(${r | 0},${g2 | 0},${b | 0})`;
}

const T = TILE;
const TAU = Math.PI * 2;
const { INK, shadow, poly, rect, rrect, circle, line } = H;
const INK2 = 'rgba(30,22,16,0.55)';

/** Height (world units) each base draws above the top of its footprint. */
export const TOP = {
  wallblock: 18, doorframe: 20, 'frame.bed': 10, 'frame.table': 12, 'frame.chair': 16, bench: 16, bracket: 24,
  'post.wood': 34, 'post.stone': 34, hearthring: 30, placeholder: 26,
  logs: 8, stonepile: 10, blocks: 10, orepile: 8, coalpile: 6, ingots: 6, crate: 10, timber: 6, drum: 8, roots: 8, meat: 6, eggs: 6, meal: 6,
};
/** Wall height in the 3/4 view: the cap is drawn WH units above the tile. */
export const WH = 16;

// ---- Small shared pieces ---------------------------------------------------------------------------
const famOf = (o) => o.fam || 'wood';
function grain(g, x, y, w, h, col, n = 3) {
  g.strokeStyle = col; g.lineWidth = 0.6;
  g.beginPath();
  for (let k = 1; k <= n; k++) { const yy = y + (h * k) / (n + 1); g.moveTo(x + 1, yy); g.quadraticCurveTo(x + w * 0.5, yy + (k & 1 ? 0.8 : -0.8), x + w - 1, yy); }
  g.stroke();
}
function woodBox(g, x, y, w, h, c, lw = 1) { rect(g, x, y, w, h, c, INK, lw); grain(g, x, y, w, h, shade(c, -0.22), Math.max(1, Math.round(h / 4))); }
function stoneBox(g, x, y, w, h, c, lw = 1) {
  rect(g, x, y, w, h, c, INK, lw);
  g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x + 1, y + 1, w - 2, 1.2);
  g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(x + 1, y + h - 2, w - 2, 1.2);
}
const boxOf = (o) => (famOf(o) === 'stone' ? stoneBox : woodBox);
/** Flame (animated by o.t): three tongues, hot core. Used at runtime for sconces and the hearth. */
export function flame(g, x, y, r, t = 0, calm = false) {
  const f1 = calm ? 0 : Math.sin(t * 11 + x) * 0.12 + Math.sin(t * 7.3 + y) * 0.1;
  const layers = [['rgba(255,110,30,0.9)', 1], ['rgba(255,170,60,0.95)', 0.72], ['rgba(255,236,160,1)', 0.42]];
  for (const [c, k] of layers) {
    const rr = r * k;
    g.fillStyle = c; g.beginPath(); g.moveTo(x - rr, y);
    g.quadraticCurveTo(x - rr * 0.9, y - rr * (1.4 + f1), x + f1 * rr * 2, y - rr * (2.3 + f1 * 2));
    g.quadraticCurveTo(x + rr * 0.9, y - rr * (1.3 - f1), x + rr, y);
    g.quadraticCurveTo(x, y + rr * 0.5, x - rr, y); g.fill();
  }
}
/** Rotation helpers: rot 0 = the def's own orientation; odd rotations swap the footprint. */
const vertical = (o) => o.H > o.W;

export const PARTS = {
  // ---- Walls and doors ------------------------------------------------------------------------------
  wallblock(g, o) {
    const m = o.mask | 0, N = m & 1, E = m & 2, S = m & 4, W = m & 8, c = o.tint, stone = famOf(o) !== 'wood';
    const capY = -WH, capH = T;
    if (!S) shadow(g, T / 2, T + 1, T * 0.55, 3.5, 0.3);
    // front face toward the viewer (only where the south neighbour is not a wall)
    if (!S) {
      const fy = T - WH, fc = shade(c, -0.28);
      rect(g, 0, fy, T, WH, fc, null);
      if (stone) {
        g.strokeStyle = shade(c, -0.5); g.lineWidth = 0.8; g.beginPath();
        g.moveTo(0, fy + WH / 2); g.lineTo(T, fy + WH / 2);
        for (const x of [10, 22]) { g.moveTo(x, fy); g.lineTo(x, fy + WH / 2); }
        for (const x of [4, 16, 28]) { g.moveTo(x, fy + WH / 2); g.lineTo(x, fy + WH); }
        g.stroke();
        g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, fy + 0.5, T, 1);
      } else {
        g.strokeStyle = shade(c, -0.52); g.lineWidth = 0.9; g.beginPath();
        for (const x of [6, 13, 19, 26]) { g.moveTo(x, fy); g.lineTo(x, fy + WH); }
        g.stroke();
        rect(g, 0, fy + 5, T, 2.2, shade(c, -0.12), null);
        g.fillStyle = '#4a4440'; g.fillRect(3, fy + 5.4, 1.2, 1.2); g.fillRect(T - 4, fy + 5.4, 1.2, 1.2);
      }
      line(g, 0, T, T, T, INK, 1);
    }
    // the cap (top surface), lifted WH units
    const cc = shade(c, stone ? 0.08 : 0.02);
    g.fillStyle = cc; g.fillRect(0, capY, T, capH);
    if (stone) {
      g.strokeStyle = shade(c, -0.22); g.lineWidth = 0.8; g.beginPath();
      g.moveTo(0, capY + T / 2); g.lineTo(T, capY + T / 2);
      g.moveTo(T / 2 + ((o.v | 0) % 2 ? 4 : -4), capY); g.lineTo(T / 2 + ((o.v | 0) % 2 ? 4 : -4), capY + T / 2);
      g.moveTo(T / 2 + ((o.v | 0) % 2 ? -6 : 6), capY + T / 2); g.lineTo(T / 2 + ((o.v | 0) % 2 ? -6 : 6), capY + T);
      g.stroke();
    } else {
      // log ends seen from above: a row of rounds
      for (let k = 0; k < 4; k++) {
        const x = 4 + k * 8;
        circle(g, x, capY + T / 2, 3.6, shade(c, 0.12), INK2, 0.7);
        circle(g, x, capY + T / 2, 1.6, shade(c, -0.15), null);
      }
      g.strokeStyle = shade(c, -0.3); g.lineWidth = 0.7; g.beginPath(); g.moveTo(0, capY + 6); g.lineTo(T, capY + 6); g.moveTo(0, capY + T - 6); g.lineTo(T, capY + T - 6); g.stroke();
    }
    // outlines where the wall run ends
    g.strokeStyle = INK; g.lineWidth = 1; g.beginPath();
    if (!N) { g.moveTo(0, capY); g.lineTo(T, capY); }
    if (!W) { g.moveTo(0, capY); g.lineTo(0, S ? capY + capH : T); }
    if (!E) { g.moveTo(T, capY); g.lineTo(T, S ? capY + capH : T); }
    if (!S) { g.moveTo(0, capY + capH); g.lineTo(T, capY + capH); }
    g.stroke();
    if (!N) { g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(0.5, capY + 0.5, T - 1, 1.5); }
    if (!E) { g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(T - 2.5, capY, 2, S ? capH : capH + WH); }
  },
  doorframe(g, o) {
    // horizontal: a door in an E-W wall run (faces the viewer); vertical: in a N-S run (edge on)
    const m = o.mask | 0, horiz = (m & 10) !== 0 || !(m & 5), c = o.tint, post = shade(c, -0.18);
    if (horiz) {
      shadow(g, T / 2, T + 1, T * 0.5, 3, 0.28);
      woodBox(g, 0, -WH, 5, T + WH - 1, post, 1);
      woodBox(g, T - 5, -WH, 5, T + WH - 1, post, 1);
      woodBox(g, 0, -WH - 2, T, 6, shade(c, -0.05), 1);
    } else {
      // edge on: a narrow threshold with the frame on the north and south ends
      rect(g, 11, 0, 10, T, shade(c, -0.35), INK, 0.8);
      woodBox(g, 9, -WH, 14, 5, post, 1);
      woodBox(g, 9, T - WH - 1, 14, WH + 1, post, 1);
    }
  },
  doorleaf(g, o) {
    const m = o.mask | 0, horiz = (m & 10) !== 0 || !(m & 5), c = o.tint;
    if (horiz) {
      if (o.open) { // swung inward: the leaf seen edge on against the west post, the threshold shaded (whoever walks through stays visible)
        g.fillStyle = 'rgba(20,14,10,0.35)'; g.fillRect(5, -WH + 4, T - 10, WH);
        woodBox(g, 5, -WH + 5, 4, T + WH - 7, shade(c, 0.05), 0.8);
      } else {
        woodBox(g, 5, -WH + 4, T - 10, T + WH - 5, c, 1);
        g.strokeStyle = shade(c, -0.4); g.lineWidth = 0.8; g.beginPath();
        for (const x of [11, 16, 21]) { g.moveTo(x, -WH + 4); g.lineTo(x, T - 1); }
        g.stroke();
        rect(g, 5, -WH + 9, T - 10, 2.2, '#4a4440', null); rect(g, 5, T - 9, T - 10, 2.2, '#4a4440', null);
        circle(g, T - 9, T / 2 - 3, 1.4, '#c8a040', INK2, 0.5);
      }
    } else if (o.open) {
      woodBox(g, 11, -WH + 5, 3, T + 0, shade(c, 0.05), 0.8);
    } else {
      woodBox(g, 12, -WH + 5, 8, T - 2, c, 0.9);
      line(g, 16, -WH + 6, 16, T - 3, shade(c, -0.4), 0.7);
    }
  },

  // ---- Furniture frames (wood and stone families) --------------------------------------------------
  'frame.bed'(g, o) {
    const fam = famOf(o), c = o.tint, v = vertical(o), W = o.W, Hh = o.H;
    shadow(g, W / 2, Hh - 2, W * 0.48, 4, 0.28);
    // head end: rot 0 north, 1 east, 2 south, 3 west
    const r = o.rot & 3;
    if (fam === 'stone') {
      stoneBox(g, 3, 2, W - 6, Hh - 4, shade(c, -0.12), 1);
      stoneBox(g, 4, Hh - 10, W - 8, 7, shade(c, -0.28), 0.8); // carved front plinth
    } else {
      woodBox(g, 3, 3, W - 6, Hh - 6, shade(c, -0.08), 1);
      for (const [x, y] of [[2, 1], [W - 6, 1], [2, Hh - 7], [W - 6, Hh - 7]]) rect(g, x, y, 4, 5, shade(c, -0.25), INK, 0.8); // posts
    }
    // headboard
    if (v) { const y = r === 2 ? Hh - 10 : -8; (fam === 'stone' ? stoneBox : woodBox)(g, 2, y, W - 4, 10, shade(c, 0.05), 1); }
    else { const x = r === 1 ? W - 8 : 0; (fam === 'stone' ? stoneBox : woodBox)(g, x, -6, 8, Hh + 2, shade(c, 0.05), 1); }
    // mattress
    if (v) rrect(g, 5, 4, W - 10, Hh - 10, 3, '#e8dcc4', INK2, 0.8);
    else rrect(g, 5, 4, W - 10, Hh - 10, 3, '#e8dcc4', INK2, 0.8);
  },
  pillow(g, o) {
    const W = o.W, Hh = o.H, r = o.rot & 3;
    if (vertical(o)) { const y = r === 2 ? Hh - 16 : 4; rrect(g, 7, y, W - 14, 9, 3.5, '#f6efe0', INK2, 0.8); }
    else { const x = r === 1 ? W - 16 : 6; rrect(g, x, 6, 9, Hh - 14, 3.5, '#f6efe0', INK2, 0.8); }
  },
  blanket(g, o) {
    const W = o.W, Hh = o.H, r = o.rot & 3;
    const cols = ['#8c3a3a', '#3a5c8c', '#4f7a3a', '#8a6a2a'], c = cols[(o.v | 0) & 3];
    let x, y, w, h;
    if (vertical(o)) { x = 4; w = W - 8; h = Hh * 0.55; y = r === 2 ? 4 : Hh - h - 5; }
    else { y = 4; h = Hh - 8; w = W * 0.55; x = r === 1 ? 4 : W - w - 5; }
    rrect(g, x, y, w, h, 3, c, INK, 0.9);
    g.strokeStyle = shade(c, 0.3); g.lineWidth = 1.2; g.beginPath();
    if (vertical(o)) { const yy = r === 2 ? y + h - 3 : y + 3; g.moveTo(x + 1, yy); g.lineTo(x + w - 1, yy); } else { const xx = r === 1 ? x + w - 3 : x + 3; g.moveTo(xx, y + 1); g.lineTo(xx, y + h - 1); }
    g.stroke();
    g.fillStyle = shade(c, -0.25); g.fillRect(vertical(o) ? x : x + w * 0.45, vertical(o) ? y + h * 0.45 : y, vertical(o) ? w : 1.2, vertical(o) ? 1.2 : h);
  },
  'frame.table'(g, o) {
    const fam = famOf(o), c = o.tint, W = o.W, Hh = o.H, top = 9;
    shadow(g, W / 2, Hh - 2, W * 0.46, 4, 0.28);
    // legs (wood) or a pedestal (stone)
    if (fam === 'stone') stoneBox(g, W / 2 - 6, Hh - top - 4, 12, top + 2, shade(c, -0.3), 0.9);
    else for (const x of [4, W - 8]) { rect(g, x, Hh - top - 6, 4, top + 4, shade(c, -0.3), INK, 0.8); }
    // top slab with its front edge
    const ty = 2 - top;
    boxOf(o)(g, 1, ty, W - 2, Hh - 6, shade(c, 0.04), 1);
    rect(g, 1, ty + Hh - 6, W - 2, 4, shade(c, -0.25), INK, 0.8);
  },
  cloth(g, o) { // a narrow runner along the long side, with a candle
    const W = o.W, Hh = o.H, ty = 2 - 9, th = Hh - 6;
    if (W >= Hh) { rect(g, 4, ty + th / 2 - 4, W - 8, 8, '#b8484a', INK2, 0.6); rect(g, 4, ty + th / 2 - 1, W - 8, 1.2, '#e0c070', null); }
    else { rect(g, W / 2 - 4, ty + 4, 8, th - 8, '#b8484a', INK2, 0.6); rect(g, W / 2 - 0.6, ty + 4, 1.2, th - 8, '#e0c070', null); }
    const cx = W / 2 + (W >= Hh ? 10 : 0), cy = ty + th / 2 + (W >= Hh ? 0 : 10);
    rect(g, cx - 1.6, cy - 7, 3.2, 6, '#f0e6cc', INK2, 0.5); circle(g, cx, cy - 8.5, 1.3, '#ffc860', null);
  },
  'frame.chair'(g, o) {
    const fam = famOf(o), c = o.tint, r = o.rot & 3, bx = boxOf(o);
    shadow(g, T / 2, T - 4, 9, 3, 0.26);
    // facing: rot 0 south (back to the north), 1 west, 2 north, 3 east
    if (r === 2) { bx(g, 8, 6, 16, 14, shade(c, 0.04), 1); bx(g, 8, 18, 16, 8, shade(c, -0.1), 1); return; } // back toward the viewer
    if (r !== 0) { const x = r === 1 ? 22 : 6; bx(g, 9, 12, 14, 12, shade(c, 0.04), 1); bx(g, x, -2, 4, 26, shade(c, -0.08), 1); rect(g, 9, 24, 14, 3, shade(c, -0.3), INK, 0.7); return; }
    bx(g, 8, -6, 16, 14, shade(c, -0.06), 1); // backrest
    if (fam !== 'stone') { line(g, 12, -4, 12, 6, shade(c, -0.35), 1); line(g, 20, -4, 20, 6, shade(c, -0.35), 1); }
    bx(g, 7, 10, 18, 11, shade(c, 0.05), 1); // seat
    rect(g, 7, 21, 18, 3, shade(c, -0.3), INK, 0.7);
    if (fam !== 'stone') for (const x of [8, 22]) rect(g, x, 24, 2.5, 3, shade(c, -0.35), null);
  },

  // ---- Workshops: the bench base and its tool props ----------------------------------------------
  bench(g, o) {
    // a heavy trestle bench; the carpenter's is all timber, the mason's has a stone slab top
    const W = o.W, Hh = o.H, wood = '#8a6038', top = o.fam === 'stone' ? o.tint : '#a8784a', v = vertical(o);
    shadow(g, W / 2, Hh - 1, W * 0.5, 5, 0.3);
    const legH = 12;
    // legs and stretcher
    if (v) { for (const y of [4, Hh - 10]) { woodBox(g, 3, y - legH + 6, 4, legH, shade(wood, -0.2), 0.8); woodBox(g, W - 7, y - legH + 6, 4, legH, shade(wood, -0.2), 0.8); } }
    else { for (const x of [4, W - 9]) woodBox(g, x, Hh - legH - 2, 5, legH, shade(wood, -0.2), 0.9); woodBox(g, 6, Hh - 8, W - 12, 3, shade(wood, -0.3), 0.7); }
    // top
    const ty = -10, th = Hh - 8;
    if (o.fam === 'stone') { woodBox(g, 0, ty + th - 2, W, 5, shade(wood, -0.05), 1); stoneBox(g, 2, ty, W - 4, th, shade(top, 0.04), 1); }
    else { woodBox(g, 0, ty, W, th, top, 1); }
    rect(g, 0, ty + th, W, 4, shade(o.fam === 'stone' ? top : wood, -0.3), INK, 0.8);
    // a vice / end stop
    if (!v) { woodBox(g, W - 8, ty - 3, 6, 6, shade(wood, -0.1), 0.8); line(g, W - 5, ty - 4, W - 5, ty - 8, '#5a5560', 1.4); }
  },
  'tool.saw'(g, o) { // carpenter: a frame saw resting across the top
    const x = o.W > o.H ? 8 : 6, y = -6;
    poly(g, [x, y + 6, x + 18, y + 2, x + 18, y + 5, x, y + 9], '#c8ccd2', INK, 0.7);
    g.strokeStyle = '#6a6e76'; g.lineWidth = 0.6; g.beginPath(); for (let k = 0; k < 6; k++) { g.moveTo(x + 2 + k * 3, y + 8.5 - k * 0.7); g.lineTo(x + 3 + k * 3, y + 9.6 - k * 0.7); } g.stroke();
    rrect(g, x - 6, y + 5, 7, 5, 2, '#6b4a2d', INK, 0.7);
  },
  'tool.plane'(g, o) { const x = o.W > o.H ? o.W - 22 : 8, y = o.W > o.H ? 2 : 22; rrect(g, x, y - 8, 10, 5, 1.5, '#9a6a3e', INK, 0.7); rect(g, x + 4, y - 10, 2, 3, '#c8ccd2', null); },
  'planks.offcut'(g, o) { if (o.W <= o.H) return; for (let k = 0; k < 2; k++) woodBox(g, o.W - 20 + k * 3, o.H - 4 - k * 3, 14, 3, '#c09060', 0.6); },
  'tool.mallet'(g, o) { // mason: a wooden mallet
    const x = o.W > o.H ? 10 : 8, y = -4;
    line(g, x, y + 4, x + 10, y - 1, '#6b4a2d', 1.6);
    rrect(g, x + 8, y - 5, 7, 7, 2, '#8a6a44', INK, 0.8);
  },
  'tool.chisel'(g, o) { const x = o.W > o.H ? 24 : 12, y = o.W > o.H ? -3 : 20; line(g, x, y, x + 9, y + 2, '#c8ccd2', 1.6); line(g, x - 3, y - 0.6, x + 1, y + 0.2, '#6b4a2d', 2.2); },
  'block.offcut'(g, o) { if (o.W <= o.H) return; const c = shade(o.tint || '#8c8784', 0.1); stoneBox(g, o.W - 17, -8, 9, 7, c, 0.8); stoneBox(g, o.W - 14, o.H - 5, 8, 6, shade(c, -0.1), 0.7); },

  // ---- Light and supports --------------------------------------------------------------------------
  bracket(g, o) { // torch sconce: an iron bracket on a short wooden post; the flame is drawn live above (FLAME_AT)
    shadow(g, T / 2, T - 6, 6, 2.2, 0.24);
    woodBox(g, T / 2 - 2, -4, 4, T - 6, shade(o.tint, -0.15), 0.8);
    g.strokeStyle = '#3a3438'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(T / 2, 4); g.quadraticCurveTo(T / 2 + 7, 2, T / 2 + 6, -8); g.stroke();
    rrect(g, T / 2 + 3, -14, 6, 8, 1.5, '#5a3a22', INK, 0.8); // torch head
    g.fillStyle = '#2a2224'; g.fillRect(T / 2 + 3.5, -14, 5, 2);
  },
  flame(g, o) { flame(g, o.fx ?? T / 2 + 6, o.fy ?? -13, o.fr ?? 4, o.t || 0, !!o.calm); },
  'post.wood'(g, o) {
    shadow(g, T / 2, T - 6, 9, 3, 0.28);
    woodBox(g, T / 2 - 4, -26, 8, T + 18, shade(o.tint, -0.05), 1);
    // braces
    line(g, T / 2 - 4, -12, T / 2 - 12, -24, shade(o.tint, -0.25), 2.2);
    line(g, T / 2 + 4, -12, T / 2 + 12, -24, shade(o.tint, -0.25), 2.2);
    rect(g, T / 2 - 6, T - 10, 12, 3, shade(o.tint, -0.35), INK, 0.7);
  },
  beam(g, o) { woodBox(g, 0, -32, T, 7, shade(o.tint, 0.06), 1); g.fillStyle = '#4a4440'; g.fillRect(T / 2 - 1, -30, 2, 2); },
  'post.stone'(g, o) {
    const c = o.tint;
    shadow(g, T / 2, T - 5, 11, 3.5, 0.3);
    stoneBox(g, T / 2 - 10, T - 12, 20, 7, shade(c, -0.15), 1); // plinth
    rect(g, T / 2 - 7, -24, 14, T + 13, shade(c, 0.02), INK, 1); // shaft
    g.strokeStyle = shade(c, -0.25); g.lineWidth = 0.8; g.beginPath(); for (const x of [-3.5, 0, 3.5]) { g.moveTo(T / 2 + x, -22); g.lineTo(T / 2 + x, T - 13); } g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.2)'; g.fillRect(T / 2 - 6, -23, 2, T + 10);
  },
  capital(g, o) { const c = o.tint; stoneBox(g, T / 2 - 11, -31, 22, 8, shade(c, 0.08), 1); rect(g, T / 2 - 9, -24, 18, 2.5, shade(c, -0.2), INK2, 0.6); },

  // ---- The Hearth (L1, 3 x 3) ---------------------------------------------------------------------
  hearthring(g, o) {
    const W = o.W, cx = W / 2, cy = o.H / 2 + 6, c = o.tint;
    shadow(g, cx, cy + 22, 40, 12, 0.32);
    // flagged dais
    g.fillStyle = shade(c, -0.25); g.beginPath(); g.ellipse(cx, cy + 6, 44, 30, 0, 0, TAU); g.fill(); g.strokeStyle = INK; g.lineWidth = 1; g.stroke();
    g.fillStyle = shade(c, -0.1); g.beginPath(); g.ellipse(cx, cy + 2, 40, 26, 0, 0, TAU); g.fill();
    // ring of tinted stones (back half first)
    const ring = (front) => {
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * TAU, sy = Math.sin(a);
        if ((sy > 0) !== front) continue;
        const x = cx + Math.cos(a) * 26, y = cy + sy * 15 - 4;
        rrect(g, x - 6, y - 5, 12, 9, 3, shade(c, 0.12 - ((k * 7) % 5) * 0.05), INK, 0.9);
        g.fillStyle = 'rgba(255,255,255,0.2)'; g.fillRect(x - 4, y - 4, 7, 1.2);
      }
    };
    ring(false);
    // ember bed
    g.fillStyle = '#3a2218'; g.beginPath(); g.ellipse(cx, cy - 4, 20, 11, 0, 0, TAU); g.fill();
    for (let k = 0; k < 9; k++) circle(g, cx - 14 + ((k * 37) % 28), cy - 7 + ((k * 17) % 8), 2.2, k % 3 ? '#e0602a' : '#ffb04a', null);
    // logs
    line(g, cx - 12, cy - 2, cx + 10, cy - 9, '#6b4a2d', 4); line(g, cx - 10, cy - 9, cx + 12, cy - 2, '#5a3d24', 4);
    ring(true);
  },
  kettle(g, o) { // a tripod and kettle on the east side of the ring
    const x = o.W - 16, y = o.H / 2 - 2;
    line(g, x - 7, y + 14, x, y - 14, '#3a3438', 1.4); line(g, x + 7, y + 14, x, y - 14, '#3a3438', 1.4); line(g, x, y + 16, x, y - 14, '#3a3438', 1.2);
    line(g, x, y - 12, x, y - 4, '#5a5560', 0.8);
    g.fillStyle = '#2e2a30'; g.beginPath(); g.ellipse(x, y + 1, 6, 5, 0, 0, TAU); g.fill(); g.strokeStyle = INK; g.lineWidth = 0.8; g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(x - 3, y - 2, 3, 1.2);
  },

  // ---- Placeholder for later structures: a stone plinth, a timber frame and a pennant -----------
  placeholder(g, o) {
    const W = o.W, Hh = o.H, c = o.tint;
    shadow(g, W / 2, Hh - 3, W * 0.48, 6, 0.28);
    stoneBox(g, 2, 4, W - 4, Hh - 8, shade(c, -0.2), 1);
    for (let x = 6; x <= W - 6; x += Math.max(12, (W - 12) / 3)) line(g, x, Hh - 6, x, -16, '#8a6a3e', 2);
    line(g, 4, -12, W - 4, -12, '#9a7848', 2); line(g, 4, Hh / 2, W - 4, Hh / 2 - 6, '#7a5a34', 1.4);
    line(g, W / 2, -12, W / 2, -24, '#5a4330', 1.4);
    poly(g, [W / 2, -24, W / 2 + 10, -21, W / 2, -17], '#c8902e', INK2, 0.6);
  },

  // ---- Items (o.n: stack bucket 0-3) --------------------------------------------------------------
  logs(g, o) {
    const n = 1 + (o.n | 0), c = '#7a5232';
    shadow(g, 16, 22, 12, 3.5, 0.26);
    for (let k = 0; k < n; k++) {
      const y = 20 - (k >> 1) * 5 - (k & 1) * 2, x = 4 + (k & 1) * 4;
      rrect(g, x, y - 3, 22, 6, 3, c, INK, 0.8);
      g.strokeStyle = shade(c, -0.3); g.lineWidth = 0.6; g.beginPath(); g.moveTo(x + 3, y - 1); g.lineTo(x + 16, y - 1); g.stroke();
      g.fillStyle = '#d8b07a'; g.beginPath(); g.ellipse(x + 22, y, 2.6, 3, 0, 0, TAU); g.fill(); g.strokeStyle = INK2; g.stroke();
      g.fillStyle = '#a8804e'; g.beginPath(); g.arc(x + 22, y, 1, 0, TAU); g.fill();
    }
  },
  stonepile(g, o) {
    const n = 2 + (o.n | 0) * 2, c = o.tint || '#8c8784';
    shadow(g, 16, 23, 12, 4, 0.28);
    const P = [[8, 22], [16, 23], [24, 22], [12, 17], [20, 17], [16, 12], [10, 12], [22, 12]];
    for (let k = 0; k < Math.min(n, P.length); k++) {
      const [x, y] = P[k], r = 4.6 - (k > 4 ? 0.8 : 0);
      poly(g, [x - r, y + r * 0.6, x - r * 0.7, y - r * 0.7, x + r * 0.2, y - r, x + r, y - r * 0.3, x + r * 0.8, y + r * 0.7], shade(c, k & 1 ? -0.12 : 0.02), INK, 0.8);
      g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(x - r * 0.5, y - r * 0.6, r * 0.8, 1.2);
    }
  },
  blocks(g, o) {
    const n = 1 + (o.n | 0), c = o.tint || '#8c8784';
    shadow(g, 16, 24, 12, 3.5, 0.26);
    const slots = [[5, 18], [17, 18], [5, 10], [17, 10], [11, 4], [11, 14]];
    for (let k = 0; k < Math.min(slots.length, n + (n > 2 ? 2 : 0)); k++) {
      const [x, y] = slots[k];
      stoneBox(g, x, y, 11, 7, shade(c, 0.06 - (k % 3) * 0.05), 0.9);
      rect(g, x, y + 7, 11, 3, shade(c, -0.3), INK, 0.7);
    }
  },
  orepile(g, o) { // host rock with metal flecks
    const c = (o.mat && ORE_LOOK[o.mat] && ORE_LOOK[o.mat].c) || o.tint || '#b8734a', host = '#6e6862', n = 2 + (o.n | 0) * 2;
    shadow(g, 16, 23, 11, 3.5, 0.26);
    const P = [[9, 21], [17, 22], [24, 20], [13, 15], [21, 15], [17, 10], [10, 11], [24, 12]];
    for (let k = 0; k < Math.min(n, P.length); k++) {
      const [x, y] = P[k];
      poly(g, [x - 4, y + 3, x - 3, y - 3, x + 1, y - 4, x + 4, y - 1, x + 3, y + 3], shade(host, k & 1 ? -0.1 : 0.04), INK, 0.8);
      circle(g, x - 0.5, y - 0.5, 1.6, c, null); circle(g, x + 2, y + 1, 1, shade(c, 0.4), null);
    }
  },
  coalpile(g, o) {
    const n = 3 + (o.n | 0) * 2;
    shadow(g, 16, 23, 11, 3.5, 0.26);
    for (let k = 0; k < Math.min(10, n); k++) {
      const x = 7 + ((k * 7) % 18), y = 22 - ((k / 3) | 0) * 4 - (k & 1);
      g.fillStyle = '#1a191d'; g.beginPath(); g.ellipse(x, y, 4, 3, 0, 0, TAU); g.fill(); g.strokeStyle = INK; g.lineWidth = 0.6; g.stroke();
      g.fillStyle = '#6a6a78'; g.fillRect(x - 2, y - 2, 2, 0.8);
    }
  },
  ingots(g, o) {
    const n = 1 + (o.n | 0), c = o.tint || '#7b7f86';
    shadow(g, 16, 23, 11, 3, 0.26);
    for (let k = 0; k < n + 1; k++) {
      const x = 6 + (k % 2) * 10, y = 19 - ((k / 2) | 0) * 5;
      poly(g, [x, y + 4, x + 12, y + 4, x + 10, y, x + 2, y], shade(c, 0.05), INK, 0.8);
      g.fillStyle = 'rgba(255,255,255,0.4)'; g.fillRect(x + 3, y + 0.8, 6, 0.8);
    }
  },
  crate(g, o) { // installable furniture travels packed: a lashed bundle in its material
    const c = o.tint || '#9a6b3f', fam = famOf(o);
    shadow(g, 16, 25, 12, 3.5, 0.26);
    (fam === 'stone' ? stoneBox : woodBox)(g, 5, 6, 22, 16, shade(c, -0.02), 1);
    rect(g, 5, 22, 22, 4, shade(c, -0.3), INK, 0.8);
    line(g, 12, 6, 12, 26, '#c8b088', 1.4); line(g, 5, 13, 27, 13, '#c8b088', 1.4);
  },
  'tag.bed'(g) { rrect(g, 17, 15, 8, 5, 1, '#f0e6cc', INK2, 0.6); rect(g, 17, 14, 2, 3, '#f0e6cc', INK2, 0.5); },
  'tag.table'(g) { rect(g, 16, 15, 9, 2, '#f0e6cc', INK2, 0.6); rect(g, 17, 17, 1.6, 3, '#f0e6cc', null); rect(g, 23, 17, 1.6, 3, '#f0e6cc', null); },
  'tag.chair'(g) { rect(g, 17, 13, 2, 7, '#f0e6cc', INK2, 0.5); rect(g, 17, 17, 7, 2, '#f0e6cc', INK2, 0.5); rect(g, 22, 18, 1.6, 3, '#f0e6cc', null); },
  timber(g, o) { const c = o.tint || '#9a6b3f'; shadow(g, 16, 22, 13, 3, 0.26); woodBox(g, 2, 15, 28, 6, c, 0.9); woodBox(g, 6, 10, 20, 4, shade(c, 0.08), 0.8); },
  drum(g, o) { // a column section lying on its side
    const c = o.tint || '#8c8784';
    shadow(g, 16, 24, 12, 3.5, 0.26);
    rect(g, 6, 10, 18, 12, shade(c, -0.05), INK, 1);
    g.fillStyle = shade(c, 0.12); g.beginPath(); g.ellipse(24, 16, 4, 6, 0, 0, TAU); g.fill(); g.strokeStyle = INK; g.lineWidth = 0.9; g.stroke();
    g.strokeStyle = shade(c, -0.25); g.lineWidth = 0.7; g.beginPath(); g.moveTo(6, 14); g.lineTo(24, 14); g.moveTo(6, 18); g.lineTo(24, 18); g.stroke();
  },
  roots(g, o) {
    const n = 2 + (o.n | 0);
    shadow(g, 16, 23, 10, 3, 0.24);
    for (let k = 0; k < n; k++) {
      const x = 9 + k * 4, y = 20 - (k & 1) * 2;
      poly(g, [x - 3, y - 4, x + 3, y - 4, x + 1, y + 4, x - 1, y + 4], k & 1 ? '#c8743a' : '#d8844a', INK, 0.7);
      line(g, x, y - 4, x - 2, y - 9, '#5a8a3a', 1.2); line(g, x, y - 4, x + 2, y - 8, '#6a9a44', 1.2);
    }
  },
  meat(g) { shadow(g, 16, 23, 9, 3, 0.24); rrect(g, 8, 13, 16, 9, 4, '#b8504a', INK, 0.8); g.fillStyle = '#f0d8c8'; g.beginPath(); g.ellipse(13, 16, 3, 2, 0, 0, TAU); g.fill(); },
  eggs(g) { shadow(g, 16, 23, 9, 3, 0.24); for (const [x, y] of [[11, 18], [17, 19], [21, 17], [15, 15]]) { g.fillStyle = '#efe4cc'; g.beginPath(); g.ellipse(x, y, 3, 3.8, 0, 0, TAU); g.fill(); g.strokeStyle = INK2; g.lineWidth = 0.6; g.stroke(); } },
  meal(g) { shadow(g, 16, 23, 10, 3, 0.24); g.fillStyle = '#7a5a3e'; g.beginPath(); g.ellipse(16, 18, 10, 5, 0, 0, TAU); g.fill(); g.strokeStyle = INK; g.lineWidth = 0.8; g.stroke(); g.fillStyle = '#d8a64a'; g.beginPath(); g.ellipse(16, 16.5, 7.5, 3.2, 0, 0, TAU); g.fill(); circle(g, 13, 16, 1.4, '#8a4a2a', null); circle(g, 19, 17, 1.2, '#6a8a3a', null); },
};

/** Where the live flame of a lit structure sits (footprint-local), and its radius. */
export const FLAME_AT = {
  'struct.sconce': (o) => [T / 2 + 6, -13, 4],
  'struct.hearth': (o) => [o.W / 2, o.H / 2 - 6, 13],
};

/** Stack bucket 0-3 from a count and the item's stack limit. */
export function bucketOf(n, stack = 75) {
  if (stack <= 1 || n <= 1) return 0;
  const f = n / stack;
  return f < 0.25 ? 1 : f < 0.75 ? 2 : 3;
}
