// Passability, walk cost and structure footprints (owner B; part of contract C5, doc 3.3, 12.3).
// The low-level pieces shared by terrain.js (writes), regions.js (labels) and pathing.js (A*).
// Pure functions of saved state (s.L, s.bld) plus the incremental caches they define:
//   rt.walkCost  u8 per tile: 0 = blocked for everyone; 1-250 = walk cost x10 for everyone
//                (10 = normal); WALK_DOOR (255) = a door: colonists pass at DOOR_WALK10,
//                hostiles treat it as a wall (doors are walls with hp for them, 12.3).
//   rt.occ       building id per tile (-1 none), from each building's footprint.
//   rt.support   Chebyshev distance to the nearest support (rock, rubble, built wall, pillar,
//                prop), capped at SUPPORT_CAP (3.4).
//   rt.depth     Chebyshev distance into rock (3.2 step 2): sources are non-rock tiles that are
//                open to the sky (roof 0 or 1); the map edge counts as rock. Mined tiles keep a
//                rock roof (2 or 3), so mining never changes depth.
// Nothing here allocates at import (D1).

import { W, H, N, TER, TER_WALK10, TER_OPAQUE, ROOF, idx } from '../core/grid.js';
import { structDef, hasFlag, sizeOf } from './defs.js';

export const WALK_DOOR = 255;            // walkCost code: colonists pass, hostiles blocked
export const WALK_MAX = 250;             // largest plain walk cost x10
export const DOOR_WALK10 = 15;           // a colonist opening a door walks at 1.5x (balance PATH, G)
export const SUPPORT_RADIUS = 4;         // Chebyshev distance within which a roof is supported (3.4)
export const SUPPORT_CAP = 7;            // rt.support is capped here (13.3)
export const DEPTH_CAP = 255;

/** Label sets (12.3): 0 colonists (doors passable), 1 hostiles (doors and locked gates are walls). */
export const SIDE = Object.freeze({ COL: 0, HOS: 1 });
export const sideOf = (side) => (side === 1 || side === 'hos' || side === 'hostile' ? 1 : 0);

/** Walk cost x10 a side pays to ENTER a tile with walkCost w; 0 = cannot enter. */
export const stepCost = (w, side) => (w === 0 ? 0 : w === WALK_DOOR ? (side === 1 ? 0 : DOOR_WALK10) : w);
export const passW = (w, side) => w !== 0 && (side === 0 || w !== WALK_DOOR);

// ---- Structure info (Stage 0 stub; E/G plug in the data-driven version) -------------------------
// pass(s, b) -> { walk, support, opaque }
//   walk: -1 keep the terrain cost, 0 blocked, 1-250 cost x10, WALK_DOOR a door
//   support: 1 if it holds up a roof (walls, pillars, props); opaque: 1 if it blocks light and sight
// footprint(s, b) -> array of tile indexes (Stage 0: 1 x 1 at (b.x, b.y), as A's occ stub).
const OPEN = Object.freeze({ walk: -1, support: 0, opaque: 0 });
const WALL = Object.freeze({ walk: 0, support: 1, opaque: 1 });
const DOOR = Object.freeze({ walk: WALK_DOOR, support: 1, opaque: 1 });
const POST = Object.freeze({ walk: 0, support: 1, opaque: 0 });
const FURN = Object.freeze({ walk: -1, support: 0, opaque: 0 });
export const PASS_PRESETS = Object.freeze({ OPEN, WALL, DOOR, POST, FURN, BLOCK: Object.freeze({ walk: 0, support: 0, opaque: 0 }) });

// Data-driven (structure defs from G through world/defs.js): flags 'door' > DOOR, 'wall' > WALL,
// 'support' (pillars, props) > POST, 'floor' > OPEN, other constructs (the Hearth, benches) block
// like a POST without support, furniture is walkable. Unknown defs fall back to the id text
// (the Stage 0 stub ids: wall_stone, door_wood).
const BLOCK = Object.freeze({ walk: 0, support: 0, opaque: 0 });
function defaultPass(s, b) {
  if (b.st !== 'done') return OPEN;      // blueprints and frames never block (E may change this)
  const d = structDef(b.def);
  if (d) {
    if (hasFlag(d, 'door')) return DOOR;
    if (hasFlag(d, 'wall')) return WALL;
    if (hasFlag(d, 'support')) return POST;
    if (hasFlag(d, 'floor') || d.kind === 'zone' || d.kind === 'designation') return OPEN;
    if (d.kind === 'furniture' || d.workbench) return FURN;
    return BLOCK;
  }
  const id = b.def;
  if (id.includes('door') || id.includes('gate')) return DOOR;
  if (id.includes('wall')) return WALL;
  if (id.includes('pillar') || id.includes('prop')) return POST;
  return FURN;
}
/** Footprint: def size (rotated) with (b.x, b.y) the top-left tile, clipped to the map. */
function defaultFootprint(s, b) {
  const d = structDef(b.def);
  if (!d || !d.size || (d.size[0] === 1 && d.size[1] === 1)) return [idx(b.x, b.y)];
  const [w, h] = sizeOf(d, b.rot | 0), out = [];
  for (let y = b.y; y < b.y + h; y++) for (let x = b.x; x < b.x + w; x++) if (x >= 0 && y >= 0 && x < W && y < H) out.push(idx(x, y));
  return out;
}
let passOf = defaultPass;
let footprintOf = defaultFootprint;

/**
 * Replace the structure resolvers (E or G, once structure data has `pass` and size fields).
 * Both must be pure functions of the building record and content data.
 * @param {{ pass?: (s, b) => {walk:number, support:number, opaque:number}, footprint?: (s, b) => number[] }} r
 */
export function setStructureInfo(r = {}) {
  passOf = r.pass || defaultPass;
  footprintOf = r.footprint || defaultFootprint;
}
export const structPass = (s, b) => passOf(s, b);
export const footprint = (s, b) => footprintOf(s, b);

// ---- Per-tile computations ------------------------------------------------------------------------
const bldAt = (s, occ, i) => { const id = occ[i]; return id >= 0 ? s.bld[id] || null : null; };

/** walkCost of tile i from terrain and the building in `occ` (rt.occ or a rebuilt one). */
export function walkOf(s, i, occ = s.rt.occ) {
  const t = TER_WALK10[s.L.terrain[i]];
  if (t === 0) return 0;
  const b = bldAt(s, occ, i);
  if (!b) return t;
  const p = passOf(s, b);
  if (p.walk < 0) return t;
  if (p.walk === 0 || p.walk === WALK_DOOR) return p.walk;
  return p.walk > WALK_MAX ? WALK_MAX : p.walk;
}
/** A support source (3.4): natural rock or rubble, or a supporting building. */
export function isSupport(s, i, occ = s.rt.occ) {
  const t = s.L.terrain[i];
  if (t === TER.ROCK || t === TER.RUBBLE) return true;
  const b = bldAt(s, occ, i);
  return !!b && passOf(s, b).support === 1;
}
/** Blocks light and sight: opaque terrain or an opaque building (closed doors count). */
export function isOpaque(s, i, occ = s.rt.occ) {
  if (TER_OPAQUE[s.L.terrain[i]]) return true;
  const b = bldAt(s, occ, i);
  return !!b && passOf(s, b).opaque === 1;
}
/** A depth source: not rock or rubble, and open to the sky (no roof or a built roof). */
export function isDepthSource(s, i) {
  const t = s.L.terrain[i];
  if (t === TER.ROCK || t === TER.RUBBLE) return false;
  const r = s.L.roof[i];
  return r === ROOF.OPEN || r === ROOF.BUILT;
}

// ---- From-scratch rebuilds (C13 gate check (e) and initRuntime) ------------------------------------
/** occ from every building's footprint, in id order (a later id wins a shared tile). */
export function occRebuild(s) {
  const a = new Int32Array(N).fill(-1);
  for (const b of s.bld) if (b) for (const i of footprintOf(s, b)) if (i >= 0 && i < N) a[i] = b.id;
  return a;
}
export function walkRebuild(s, occ = occRebuild(s)) {
  const a = new Uint8Array(N);
  for (let i = 0; i < N; i++) a[i] = walkOf(s, i, occ);
  return a;
}
export function supportRebuild(s, occ = occRebuild(s)) {
  const a = new Uint8Array(N);
  for (let i = 0; i < N; i++) a[i] = isSupport(s, i, occ) ? 0 : SUPPORT_CAP;
  chamfer(a, 0, 0, W - 1, H - 1, SUPPORT_CAP);
  return a;
}
export function depthRebuild(s) {
  const a = new Uint8Array(N);
  for (let i = 0; i < N; i++) a[i] = isDepthSource(s, i) ? 0 : DEPTH_CAP;
  chamfer(a, 0, 0, W - 1, H - 1, DEPTH_CAP);
  return a;
}

/**
 * Exact Chebyshev distance transform in place over the inclusive box (two passes, unit weights).
 * Cells outside the box are ignored, so a box edge behaves like the map edge (not a source).
 */
export function chamfer(a, x0, y0, x1, y1, cap) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * W + x;
      let v = a[i];
      if (v === 0) continue;
      if (x > x0) { const u = a[i - 1] + 1; if (u < v) v = u; }
      if (y > y0) {
        const r = i - W;
        let u = a[r] + 1; if (u < v) v = u;
        if (x > x0) { u = a[r - 1] + 1; if (u < v) v = u; }
        if (x < x1) { u = a[r + 1] + 1; if (u < v) v = u; }
      }
      a[i] = v > cap ? cap : v;
    }
  }
  for (let y = y1; y >= y0; y--) {
    for (let x = x1; x >= x0; x--) {
      const i = y * W + x;
      let v = a[i];
      if (v === 0) continue;
      if (x < x1) { const u = a[i + 1] + 1; if (u < v) v = u; }
      if (y < y1) {
        const r = i + W;
        let u = a[r] + 1; if (u < v) v = u;
        if (x > x0) { u = a[r - 1] + 1; if (u < v) v = u; }
        if (x < x1) { u = a[r + 1] + 1; if (u < v) v = u; }
      }
      a[i] = v > cap ? cap : v;
    }
  }
}

/** Recompute rt.support exactly inside the (2R+1)^2 window around tile (x, y), R = SUPPORT_CAP. */
export function supportPatch(s, x, y) {
  const R = SUPPORT_CAP, a = s.rt.support, occ = s.rt.occ;
  const bx0 = Math.max(0, x - 2 * R), by0 = Math.max(0, y - 2 * R);
  const bx1 = Math.min(W - 1, x + 2 * R), by1 = Math.min(H - 1, y + 2 * R);
  const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
  // work in a scratch copy of the outer box so that tiles outside the inner window keep their values
  const tmp = scratch(bw * bh);
  for (let yy = 0; yy < bh; yy++) for (let xx = 0; xx < bw; xx++) {
    const i = (by0 + yy) * W + bx0 + xx;
    tmp[yy * bw + xx] = isSupport(s, i, occ) ? 0 : R;
  }
  boxChamfer(tmp, bw, bh, R);
  const ix0 = Math.max(0, x - R), iy0 = Math.max(0, y - R), ix1 = Math.min(W - 1, x + R), iy1 = Math.min(H - 1, y + R);
  for (let yy = iy0; yy <= iy1; yy++) for (let xx = ix0; xx <= ix1; xx++) a[yy * W + xx] = tmp[(yy - by0) * bw + (xx - bx0)];
}
let scr = null;
function scratch(n) { if (!scr || scr.length < n) scr = new Uint8Array(Math.max(n, 1024)); return scr; }
function boxChamfer(a, w, h, cap) {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; let v = a[i]; if (v === 0) continue;
    if (x > 0) { const u = a[i - 1] + 1; if (u < v) v = u; }
    if (y > 0) { const r = i - w; let u = a[r] + 1; if (u < v) v = u; if (x > 0) { u = a[r - 1] + 1; if (u < v) v = u; } if (x < w - 1) { u = a[r + 1] + 1; if (u < v) v = u; } }
    a[i] = v > cap ? cap : v;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x; let v = a[i]; if (v === 0) continue;
    if (x < w - 1) { const u = a[i + 1] + 1; if (u < v) v = u; }
    if (y < h - 1) { const r = i + w; let u = a[r] + 1; if (u < v) v = u; if (x > 0) { u = a[r - 1] + 1; if (u < v) v = u; } if (x < w - 1) { u = a[r + 1] + 1; if (u < v) v = u; } }
    a[i] = v > cap ? cap : v;
  }
}
