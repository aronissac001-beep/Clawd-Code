// Placeholder structure and item art (owner C; doc 12.4 "drawn per frame"). Stands in for D's kit
// (js/engine/art/keys.js registers real art through index.js registerArt; any key it registers
// wins over these). Every Stage 1a structure has a readable stand-in here: walls (autotiled by the
// neighbouring walls, doors and rock, tinted by material), doors (open while someone stands in
// them), beds, tables, chairs, the two benches, sconces, props and pillars; anything else gets a
// neutral box of its real footprint. Items are drawn by category with their material tint.
//
// Sprites are cached in the shared sprite cache (sprites.js) under integer keys, so a frame with
// hundreds of walls allocates no strings: key = KIT_BASE + def index, material index, mask, state.
// Render only: reads state, never writes it. Nothing allocates at import.

import { TILE } from '../../game/core/grid.js';
import { def as contentDef } from '../../game/core/content.js';
import * as SP from '../sprites.js';

const T = TILE;
const TAU = Math.PI * 2;
const INK = 'rgba(30,22,16,0.8)';
const shade = SP.shade;
const KIT_BASE = 0x60000000; // sprite key ranges: D's colonists use 0x40000000-0x43ffffff

// small-int ids for def and material names (assigned on first sight; render-session only)
const ids = new Map();
const small = (name) => { let v = ids.get(name); if (v === undefined) { v = ids.size + 1; ids.set(name, v); } return v; };

const tintCache = new Map();
/** Material tint (js/data/materials.js), with fallbacks for wood and unknown stone. */
export function tintOf(mat, fallback = '#8a8478') {
  if (!mat) return fallback;
  let t = tintCache.get(mat);
  if (t === undefined) { const m = contentDef('material', mat); t = (m && m.tint) || (mat === 'wood' ? '#9a6b3f' : fallback); tintCache.set(mat, t); }
  return t;
}
export const isWoodMat = (mat) => !mat || mat === 'wood';

// ---- Drawers (local coordinates: the footprint is (0, top) .. (w*T, top + h*T)) ------------------
/** Wall: mask bits 1 N, 2 E, 4 S, 8 W set when that neighbour is a wall, door or rock (connected). */
function drawWall(g, mat, mask) {
  const wood = isWoodMat(mat), base = wood ? '#8a5e36' : tintOf(mat);
  const n = mask & 1, e = mask & 2, so = mask & 4, w = mask & 8;
  g.fillStyle = shade(base, -0.12); g.fillRect(0, 0, T, T);
  // cap pattern
  g.strokeStyle = shade(base, -0.38); g.lineWidth = 1; g.beginPath();
  if (wood) { for (let k = 1; k < 4; k++) { g.moveTo(0, k * 8); g.lineTo(T, k * 8); } }
  else { g.moveTo(0, T / 2); g.lineTo(T, T / 2); g.moveTo(T / 2, 0); g.lineTo(T / 2, T / 2); g.moveTo(T / 4, T / 2); g.lineTo(T / 4, T); g.moveTo(3 * T / 4, T / 2); g.lineTo(3 * T / 4, T); }
  g.stroke();
  if (!so) { // front face toward the viewer
    const fh = 12;
    g.fillStyle = shade(base, -0.42); g.fillRect(0, T - fh, T, fh);
    g.fillStyle = shade(base, 0.12); g.fillRect(0, T - fh - 2, T, 2);
    g.strokeStyle = shade(base, -0.6); g.beginPath();
    if (wood) { for (let k = 0; k < 4; k++) { g.moveTo(4 + k * 8, T - fh); g.lineTo(4 + k * 8, T); } }
    else { g.moveTo(0, T - fh / 2); g.lineTo(T, T - fh / 2); for (let k = 0; k < 3; k++) { const o = k * 11 + 5; g.moveTo(o, T - fh); g.lineTo(o, T - fh / 2); g.moveTo(o + 5, T - fh / 2); g.lineTo(o + 5, T); } }
    g.stroke();
  }
  if (!n) { g.fillStyle = shade(base, 0.26); g.fillRect(0, 0, T, 2.5); }
  if (!w) { g.fillStyle = shade(base, 0.1); g.fillRect(0, 0, 2.5, so ? T : T - 12); }
  if (!e) { g.fillStyle = shade(base, -0.45); g.fillRect(T - 2.5, 0, 2.5, so ? T : T - 12); }
}
/** Door: horizontal (walls east and west) shows its face; vertical (walls north and south) its edge. */
function drawDoor(g, mat, mask, open) {
  const base = isWoodMat(mat) ? '#8a5a30' : tintOf(mat);
  const vertical = (mask & 1) && (mask & 4) && !((mask & 2) && (mask & 8));
  g.fillStyle = 'rgba(20,14,10,0.35)'; g.fillRect(0, 0, T, T);
  if (!vertical) {
    g.fillStyle = shade(base, -0.45); g.fillRect(0, 4, 4, T - 4); g.fillRect(T - 4, 4, 4, T - 4); g.fillRect(0, 2, T, 4); // frame
    if (open) { g.fillStyle = shade(base, -0.1); g.fillRect(4, 6, 5, T - 6); }
    else {
      g.fillStyle = base; g.fillRect(4, 6, T - 8, T - 6);
      g.strokeStyle = shade(base, -0.35); g.lineWidth = 1; g.beginPath();
      for (let k = 1; k < 4; k++) { g.moveTo(4 + k * 6, 6); g.lineTo(4 + k * 6, T); }
      g.stroke();
      g.fillStyle = '#d8c070'; g.beginPath(); g.arc(T - 9, T / 2 + 4, 1.6, 0, TAU); g.fill();
    }
  } else {
    g.fillStyle = shade(base, -0.45); g.fillRect(T / 2 - 4, 0, 8, 4); g.fillRect(T / 2 - 4, T - 4, 8, 4);
    g.fillStyle = open ? shade(base, -0.1) : base;
    if (open) g.fillRect(T / 2 - 2, 4, 12, 4); else g.fillRect(T / 2 - 3, 4, 6, T - 8);
    g.strokeStyle = INK; g.lineWidth = 0.8; g.strokeRect(T / 2 - 3, 4, 6, T - 8);
  }
}
function drawBed(g, w, h, rot) {
  // a bed along its long axis; the pillow at the head (rot 0 top, 1 right, 2 bottom, 3 left)
  const W2 = w * T, H2 = h * T;
  g.fillStyle = 'rgba(20,15,30,0.3)'; g.fillRect(3, 5, W2 - 4, H2 - 4);
  g.fillStyle = '#7a4e2c'; g.fillRect(2, 2, W2 - 4, H2 - 4);
  g.fillStyle = '#e8dcc0'; g.fillRect(5, 5, W2 - 10, H2 - 10);
  g.fillStyle = '#5a6f9a';
  if (rot === 0) g.fillRect(5, 18, W2 - 10, H2 - 23); else if (rot === 2) g.fillRect(5, 5, W2 - 10, H2 - 23);
  else if (rot === 1) g.fillRect(5, 5, W2 - 23, H2 - 10); else g.fillRect(18, 5, W2 - 23, H2 - 10);
  g.fillStyle = '#f4efe4';
  if (rot === 0) g.fillRect(8, 7, W2 - 16, 8); else if (rot === 2) g.fillRect(8, H2 - 15, W2 - 16, 8);
  else if (rot === 1) g.fillRect(W2 - 15, 8, 8, H2 - 16); else g.fillRect(7, 8, 8, H2 - 16);
  g.strokeStyle = INK; g.lineWidth = 1; g.strokeRect(2, 2, W2 - 4, H2 - 4);
}
function drawTable(g, w, h, mat) {
  const W2 = w * T, H2 = h * T, base = isWoodMat(mat) ? '#9a6a3c' : tintOf(mat);
  g.fillStyle = 'rgba(20,15,30,0.28)'; g.fillRect(4, H2 - 6, W2 - 6, 5);
  g.fillStyle = shade(base, -0.4); g.fillRect(5, H2 - 12, 3, 10); g.fillRect(W2 - 8, H2 - 12, 3, 10);
  g.fillStyle = base; g.fillRect(2, 4, W2 - 4, H2 - 14);
  g.fillStyle = shade(base, -0.25); g.fillRect(2, H2 - 12, W2 - 4, 3);
  g.strokeStyle = INK; g.lineWidth = 1; g.strokeRect(2, 4, W2 - 4, H2 - 13);
}
function drawChair(g, mat) {
  const base = isWoodMat(mat) ? '#9a6a3c' : tintOf(mat);
  g.fillStyle = 'rgba(20,15,30,0.28)'; g.beginPath(); g.ellipse(T / 2, T - 5, 9, 3.5, 0, 0, TAU); g.fill();
  g.fillStyle = shade(base, -0.4); g.fillRect(9, 14, 3, 13); g.fillRect(T - 12, 14, 3, 13);
  g.fillStyle = shade(base, -0.15); g.fillRect(8, 2, T - 16, 12);
  g.fillStyle = base; g.fillRect(7, 13, T - 14, 7);
  g.strokeStyle = INK; g.lineWidth = 1; g.strokeRect(8, 2, T - 16, 12); g.strokeRect(7, 13, T - 14, 7);
}
function drawBench(g, w, h, kind) {
  const W2 = w * T, H2 = h * T, stone = kind === 'mason', top = stone ? '#9a948a' : '#a8784a', leg = '#6a4528';
  g.fillStyle = 'rgba(20,15,30,0.3)'; g.fillRect(3, H2 - 6, W2 - 4, 5);
  g.fillStyle = leg; g.fillRect(4, H2 - 14, 4, 12); g.fillRect(W2 - 8, H2 - 14, 4, 12);
  g.fillStyle = top; g.fillRect(1, 2, W2 - 2, H2 - 14);
  g.fillStyle = shade(top, -0.3); g.fillRect(1, H2 - 13, W2 - 2, 4);
  g.strokeStyle = INK; g.lineWidth = 1; g.strokeRect(1, 2, W2 - 2, H2 - 11);
  if (stone) { // a block and a chisel
    g.fillStyle = '#c8c2b6'; g.fillRect(8, 5, 12, 9); g.strokeRect(8, 5, 12, 9);
    g.fillStyle = '#6a6e74'; g.fillRect(W2 - 22, 9, 12, 2.5); g.fillStyle = '#8a5a30'; g.fillRect(W2 - 12, 8, 6, 4);
  } else { // a plank and a saw
    g.fillStyle = '#d8b07a'; g.fillRect(6, 6, 22, 6); g.strokeRect(6, 6, 22, 6);
    g.fillStyle = '#b8bcc2'; g.beginPath(); g.moveTo(W2 - 26, 6); g.lineTo(W2 - 10, 6); g.lineTo(W2 - 10, 12); g.lineTo(W2 - 26, 9); g.closePath(); g.fill();
    g.fillStyle = '#7a4a28'; g.fillRect(W2 - 10, 5, 5, 7);
  }
}
function drawSconce(g) {
  g.fillStyle = 'rgba(20,15,30,0.25)'; g.beginPath(); g.ellipse(T / 2, T - 6, 6, 2.5, 0, 0, TAU); g.fill();
  g.fillStyle = '#4a4440'; g.fillRect(T / 2 - 1.5, 10, 3, T - 15);          // post
  g.fillStyle = '#6a5a4a'; g.fillRect(T / 2 - 5, 8, 10, 4);                  // cup
  g.fillStyle = '#7a4a28'; g.fillRect(T / 2 - 2, 2, 4, 8);                   // torch head
  g.strokeStyle = INK; g.lineWidth = 0.8; g.strokeRect(T / 2 - 5, 8, 10, 4);
}
function drawProp(g) {
  g.fillStyle = 'rgba(20,15,30,0.3)'; g.beginPath(); g.ellipse(T / 2, T - 5, 9, 3, 0, 0, TAU); g.fill();
  g.fillStyle = '#7a5230'; g.fillRect(T / 2 - 3.5, 2, 7, T - 6);
  g.fillStyle = '#9a6a3c'; g.fillRect(T / 2 - 11, 0, 22, 5);
  g.strokeStyle = INK; g.lineWidth = 1; g.strokeRect(T / 2 - 3.5, 2, 7, T - 6); g.strokeRect(T / 2 - 11, 0, 22, 5);
}
function drawPillar(g, mat) {
  const base = tintOf(mat, '#9a948a');
  g.fillStyle = 'rgba(20,15,30,0.32)'; g.beginPath(); g.ellipse(T / 2, T - 4, 12, 4, 0, 0, TAU); g.fill();
  g.fillStyle = shade(base, -0.3); g.fillRect(T / 2 - 9, 6, 18, T - 10);
  g.fillStyle = shade(base, -0.05); g.fillRect(T / 2 - 9, 6, 6, T - 10);
  g.fillStyle = shade(base, 0.15); g.fillRect(T / 2 - 12, 2, 24, 6); g.fillRect(T / 2 - 12, T - 7, 24, 5);
  g.strokeStyle = INK; g.lineWidth = 1; g.strokeRect(T / 2 - 12, 2, 24, 6); g.strokeRect(T / 2 - 9, 8, 18, T - 15);
}
function drawBox(g, w, h) {
  const W2 = w * T, H2 = h * T;
  g.fillStyle = 'rgba(20,15,30,0.25)'; g.fillRect(4, H2 - 5, W2 - 6, 4);
  g.fillStyle = '#8a6d4a'; g.fillRect(4, 6, W2 - 8, H2 - 10);
  g.fillStyle = '#a7865e'; g.fillRect(4, 4, W2 - 8, 5);
  g.strokeStyle = INK; g.lineWidth = 1; g.strokeRect(4.5, 4.5, W2 - 9, H2 - 9);
}

const SCAFFOLD = 'rgba(210,180,120,0.9)';
/**
 * The kit sprite of building b (def d, footprint w x h tiles) with its neighbour mask (walls,
 * doors) and open flag (doors). Cached under an integer key; null when the def has no stand-in.
 */
export function kitSprite(b, d, w, h, scale, mask, open) {
  const P = PEND;
  P.b = b; P.d = d; P.w = w; P.h = h; P.mask = mask; P.open = open;
  const rot = b.rot & 3;
  const key = KIT_BASE + ((small(b.def) & 0x3ff) << 18) + ((small(b.mat || '-') & 0x3f) << 12) + ((mask & 15) << 8) + (rot << 6) + ((open ? 1 : 0) << 5) + ((w & 3) << 3) + (h & 7);
  return SP.sprite(key, scale, w * T, h * T, 0, 0, drawPending);
}
// The parameters of the sprite being built (no closure per call: a cache hit allocates nothing).
const PEND = { b: null, d: null, w: 1, h: 1, mask: 0, open: false };
function drawPending(g) {
  const { b, d, w, h, mask, open } = PEND, id = b.def, rot = b.rot & 3;
  const flag = (f) => !!(d && d.flags && d.flags.includes(f));
  if (flag('wall') && !flag('door')) drawWall(g, b.mat, mask);
  else if (flag('door')) drawDoor(g, b.mat, mask, open);
  else if (flag('bed')) drawBed(g, w, h, rot);
  else if (flag('table')) drawTable(g, w, h, b.mat);
  else if (flag('seat')) drawChair(g, b.mat);
  else if (id === 'carpenter' || id === 'mason' || (d && d.workbench)) drawBench(g, w, h, id);
  else if (id === 'sconce') drawSconce(g);
  else if (id === 'prop') drawProp(g);
  else if (id === 'pillar') drawPillar(g, b.mat);
  else drawBox(g, w, h);
}

/** Frame overlay: scaffold poles and diagonal braces over the footprint (drawn per frame). */
export function drawScaffold(g, x, y, w, h) {
  const W2 = w * T, H2 = h * T;
  g.strokeStyle = SCAFFOLD; g.lineWidth = 1.5;
  g.strokeRect(x + 2, y + 2, W2 - 4, H2 - 4);
  g.beginPath(); g.moveTo(x + 2, y + H2 - 2); g.lineTo(x + W2 - 2, y + 2); if (W2 > T || H2 > T) { g.moveTo(x + 2, y + 2); g.lineTo(x + W2 - 2, y + H2 - 2); } g.stroke();
}

// ---- Items -----------------------------------------------------------------------------------------
const ITEM_CAT = new Map();
/** Item category from js/data/items.js (cached). */
export function itemCat(k) {
  let c = ITEM_CAT.get(k);
  if (c === undefined) { const d = contentDef('item', k); c = (d && d.cat) || 'misc'; ITEM_CAT.set(k, c); }
  return c;
}
const DOT = { stone: '#9a958e', wood: '#a7774a', ore: '#c07040', blocks: '#c8c2b6', ingots: '#c8ccd2', rawfood: '#d8a64a', meals: '#e8b060', furniture: '#b08a5a', misc: '#c0b0a0' };
export const itemDot = (it) => (it.m && (itemCat(it.k) === 'stone' || itemCat(it.k) === 'blocks') ? tintOf(it.m) : DOT[itemCat(it.k)] || DOT.misc);

const KIT_ITEM = 0x70000000;
const IPEND = { it: null, cat: '', n: 1 };
function drawItemPending(g) { const { it, cat, n } = IPEND; paintItem(g, it, 14, 14, cat, n); }
/** Pile size bucket (the art only changes at these steps). */
function pileOf(cat, n) {
  if (cat === 'stone' || cat === 'ore') return Math.min(6, 1 + (n >> 1)) * 2 - 1;
  if (cat === 'blocks' || cat === 'wood') return Math.min(4, 1 + (n >> 2)) * 4 - 1;
  if (cat === 'ingots') return Math.min(3, 1 + (n >> 2)) * 4 - 1;
  return 1;
}
/** A stack on its tile centre (x, y) in world units: a cached sprite per kind, material, pile size and forbid flag. */
export function drawItem(g, it, x, y, scale = 1) {
  const cat = itemCat(it.k), n = pileOf(cat, Math.min(10, it.n | 0));
  const key = KIT_ITEM + ((small(it.k) & 0x3ff) << 12) + ((small(it.m || '-') & 0x3f) << 5) + ((n & 15) << 1) + (it.f ? 1 : 0);
  IPEND.it = it; IPEND.cat = cat; IPEND.n = n;
  const sp = SP.sprite(key, scale, 28, 28, 14, 14, drawItemPending);
  g.drawImage(sp.c, x - sp.ax, y - sp.ay, sp.w, sp.h);
}
function paintItem(g, it, x, y, cat, n) {
  if (cat === 'stone' || cat === 'ore') {
    const base = it.k === 'coal' ? '#2a2830' : cat === 'stone' ? tintOf(it.m, '#9a958e') : '#8a7a6a';
    const glint = cat === 'ore' && it.k !== 'coal' ? tintOf(it.m, '#d9874a') : null;
    for (let k = 0; k < Math.min(6, 1 + (n >> 1)); k++) {
      const px = x - 8 + (k % 3) * 7, py = y + 4 - ((k / 3) | 0) * 6;
      g.fillStyle = k & 1 ? shade(base, -0.2) : base; g.strokeStyle = INK; g.lineWidth = 0.8;
      g.beginPath(); g.moveTo(px - 3.5, py + 2.5); g.lineTo(px - 1.5, py - 3); g.lineTo(px + 3.5, py - 2); g.lineTo(px + 3, py + 3); g.closePath(); g.fill(); g.stroke();
      if (glint) { g.fillStyle = glint; g.fillRect(px - 1, py - 1, 2, 2); }
    }
  } else if (cat === 'blocks') {
    const base = tintOf(it.m, '#b8b2a8');
    for (let k = 0; k < Math.min(4, 1 + (n >> 2)); k++) {
      const px = x - 9 + (k & 1) * 9, py = y - 1 - (k >> 1) * 6;
      g.fillStyle = base; g.fillRect(px, py, 9, 6); g.fillStyle = shade(base, -0.3); g.fillRect(px, py + 4, 9, 2);
      g.strokeStyle = INK; g.lineWidth = 0.8; g.strokeRect(px, py, 9, 6);
    }
  } else if (cat === 'wood') {
    for (let k = 0; k < Math.min(4, 1 + (n >> 2)); k++) {
      const py = y + 4 - k * 4;
      g.fillStyle = '#8a5e36'; g.fillRect(x - 9, py - 2, 18, 4); g.fillStyle = '#d8b07a'; g.beginPath(); g.ellipse(x + 9, py, 2, 2, 0, 0, TAU); g.fill();
    }
  } else if (cat === 'ingots') {
    const base = tintOf(it.m, '#c8ccd2');
    for (let k = 0; k < Math.min(3, 1 + (n >> 2)); k++) { g.fillStyle = base; g.fillRect(x - 7, y + 2 - k * 4, 14, 4); g.strokeStyle = INK; g.lineWidth = 0.8; g.strokeRect(x - 7, y + 2 - k * 4, 14, 4); }
  } else if (cat === 'furniture') {
    g.fillStyle = '#9a7048'; g.fillRect(x - 9, y - 6, 18, 12); g.strokeStyle = INK; g.lineWidth = 1; g.strokeRect(x - 8.5, y - 5.5, 17, 11);
    g.beginPath(); g.moveTo(x - 8, y - 5); g.lineTo(x + 8, y + 5); g.moveTo(x + 8, y - 5); g.lineTo(x - 8, y + 5); g.stroke();
  } else {
    g.fillStyle = cat === 'meals' ? '#c89050' : '#8a5a2e'; g.fillRect(x - 7, y - 5, 14, 10); g.strokeStyle = INK; g.lineWidth = 1; g.strokeRect(x - 6.5, y - 4.5, 13, 9);
    if (cat === 'rawfood') { g.fillStyle = '#d87a3a'; g.beginPath(); g.arc(x - 2, y - 1, 2.5, 0, TAU); g.arc(x + 3, y + 1, 2.2, 0, TAU); g.fill(); }
  }
  if (it.f) { // forbidden: a small no-entry badge at the top right
    g.fillStyle = 'rgba(30,14,12,0.75)'; g.beginPath(); g.arc(x + 9, y - 8, 4.5, 0, TAU); g.fill();
    g.strokeStyle = '#f0604a'; g.lineWidth = 1.4; g.beginPath(); g.arc(x + 9, y - 8, 3.6, 0, TAU); g.moveTo(x + 6.5, y - 10.5); g.lineTo(x + 11.5, y - 5.5); g.stroke();
  }
}
