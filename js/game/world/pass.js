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
//
// Levels (Stage Z1 E4; EMBERCROWN-FORTRESS.md 2.4, 2.5, 2.8). At D > 1:
//   - support is per level: the chamfer runs on each plane at base z * PLANE and never crosses levels.
//     supportPatch(s, x, row) takes the full-volume row (z * H + y, which is what (i / W) | 0 gives),
//     so terrain.js's refreshSupport works unchanged; at D = 1 row === y. Stair voxels and RAMP are
//     supports (2.5).
//   - rt.depth no longer measures rock: it holds the levels below the surface (zS - z, 0 at and above it)
//     for the ore tables and discoveries (2.4: "levels below the surface replace the R2 depth"). Nothing
//     is a depth source, so no terrain write rebuilds it. (A deletes the key with the v4 schema.)
//   - the static `fluid` layer (u8 of N, when s.L.fluid exists): bits 0-2 depth, bit 3 ember, bit 4
//     source. Water of depth 1-2 walks at x2, 3 at x3, 4+ is impassable; any ember is impassable.
//     setFluid(s, i, v) is the write (terrain.js re-exports it as the C5 v3 setFluid).
//   - footprints carry the building's level (b.z).

import { W, H, N, D, PLANE, zS, TER, TER_WALK10, TER_OPAQUE, ROOF, idx } from '../core/grid.js';
import { FLUID } from '../../data/levels.js';
import { structDef, hasFlag, sizeOf } from './defs.js';
import { worldRec, worldStage2, getKey } from './worldrec.js';

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
// like a POST without support, furniture and storage buildings are walkable. Unknown defs fall back to the id text
// (the Stage 0 stub ids: wall_stone, door_wood).
const BLOCK = Object.freeze({ walk: 0, support: 0, opaque: 0 });
const HELD_OPEN = Object.freeze({ walk: -1, support: 1, opaque: 0 });
const LOCKED = Object.freeze({ walk: 0, support: 1, opaque: 1 });
/** Stage 2 mechanisms (mechanisms.js): a door-flagged building's mode, 0 closed, 1 held open, 2 locked. */
export function doorMode(s, b) {
  if (!worldStage2() || b.st !== 'done') return 0;
  const e = getKey(worldRec(s).mech, b.id);
  return e ? e[1] : 0;
}
function defaultPass(s, b) {
  if (b.st !== 'done') return OPEN;      // blueprints and frames never block (E may change this)
  const d = structDef(b.def);
  if (d) {
    if (hasFlag(d, 'door')) { const m = doorMode(s, b); return m === 1 ? HELD_OPEN : m === 2 ? LOCKED : DOOR; }
    if (hasFlag(d, 'wall')) return WALL;
    if (hasFlag(d, 'support')) return POST;
    if (hasFlag(d, 'floor') || d.kind === 'zone' || d.kind === 'designation') return OPEN;
    // storage buildings (granary, barrel and armoury racks, strongbox, ice house) are walked into like
    // shelves (X 2.7: blocking, their inner slots were unreachable and every stack in them was out
    // of reach for eating, cooking and crafting: a hold starved beside a full granary)
    if (d.kind === 'furniture' || d.workbench || d.store) return FURN;
    // traps are stepped on (doc 7.7 "strikes the first hostile to step on it"; X 2.7: as blocking
    // constructs the flow fields led every raider around them, and traps.js fell back to a hit from
    // beside the trap)
    if (hasFlag(d, 'trap')) return FURN;
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
  const z = b.z | 0;
  if (!d || !d.size || (d.size[0] === 1 && d.size[1] === 1)) return [idx(b.x, b.y, z)];
  const [w, h] = sizeOf(d, b.rot | 0), out = [];
  for (let y = b.y; y < b.y + h; y++) for (let x = b.x; x < b.x + w; x++) if (x >= 0 && y >= 0 && x < W && y < H) out.push(idx(x, y, z));
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
  let t = TER_WALK10[s.L.terrain[i]];
  if (t === 0) return 0;
  const fl = s.L.fluid;
  if (fl && fl[i]) { t = fluidWalk(fl[i], t); if (t === 0) return 0; }
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
  if (t >= TER.STAIR_U && t <= TER.RAMP) return true;       // stairs and ramps hold a ceiling (2.5; never at D = 1)
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
  if (D > 1) return false;                                  // depth is levels below the surface at D > 1
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
  for (let z = 0; z < D; z++) chamfer(a, 0, 0, W - 1, H - 1, SUPPORT_CAP, z * PLANE);
  return a;
}
export function depthRebuild(s) {
  const a = new Uint8Array(N);
  if (D > 1) {
    for (let z = 0; z < zS; z++) a.fill(Math.min(DEPTH_CAP, zS - z), z * PLANE, (z + 1) * PLANE);
    return a;
  }
  for (let i = 0; i < N; i++) a[i] = isDepthSource(s, i) ? 0 : DEPTH_CAP;
  chamfer(a, 0, 0, W - 1, H - 1, DEPTH_CAP);
  return a;
}

/**
 * Exact Chebyshev distance transform in place over the inclusive box (two passes, unit weights).
 * Cells outside the box are ignored, so a box edge behaves like the map edge (not a source).
 */
export function chamfer(a, x0, y0, x1, y1, cap, base = 0) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = base + y * W + x;
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
      const i = base + y * W + x;
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

/**
 * Recompute rt.support exactly inside the (2R+1)^2 window around tile (x, y), R = SUPPORT_CAP. At D > 1 the
 * second argument is the full-volume row z * H + y ((i / W) | 0), and the patch stays on level z.
 */
export function supportPatch(s, x, row) {
  const R = SUPPORT_CAP, a = s.rt.support, occ = s.rt.occ;
  const y = row % H, base = row >= H ? ((row / H) | 0) * PLANE : 0;
  const bx0 = Math.max(0, x - 2 * R), by0 = Math.max(0, y - 2 * R);
  const bx1 = Math.min(W - 1, x + 2 * R), by1 = Math.min(H - 1, y + 2 * R);
  const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
  // work in a scratch copy of the outer box so that tiles outside the inner window keep their values
  const tmp = scratch(bw * bh);
  for (let yy = 0; yy < bh; yy++) for (let xx = 0; xx < bw; xx++) {
    const i = base + (by0 + yy) * W + bx0 + xx;
    tmp[yy * bw + xx] = isSupport(s, i, occ) ? 0 : R;
  }
  boxChamfer(tmp, bw, bh, R);
  const ix0 = Math.max(0, x - R), iy0 = Math.max(0, y - R), ix1 = Math.min(W - 1, x + R), iy1 = Math.min(H - 1, y + R);
  for (let yy = iy0; yy <= iy1; yy++) for (let xx = ix0; xx <= ix1; xx++) a[base + yy * W + xx] = tmp[(yy - by0) * bw + (xx - bx0)];
}

// ---- Static fluid (2.8; Z1 and Z2) ------------------------------------------------------------------
export const FL = Object.freeze({ DEPTH: 7, EMBER: 8, SOURCE: 16 });
export const fluidDepth = (v) => v & FL.DEPTH;
export const isEmber = (v) => (v & FL.EMBER) !== 0 && (v & FL.DEPTH) !== 0;
/** Walk cost x10 of terrain cost t with fluid byte v on the voxel (0 = impassable). */
export function fluidWalk(v, t) {
  const dep = v & FL.DEPTH;
  if (!dep) return t;
  if (v & FL.EMBER) return 0;
  const pct = FLUID.walkPct[dep];
  if (!pct) return 0;
  const w = Math.floor((t * pct) / 100);
  return w > WALK_MAX ? WALK_MAX : w;
}
/**
 * The ember voxels of the world (sorted voxel indexes): light and heat sources (2.6). A pure function of the
 * fluid layer, cached per layer array (built by one scan on first use) and kept exact by setFluid.
 */
const EMBERS = new WeakMap();
export function emberVoxels(s) {
  const L = s.L.fluid;
  if (!L) return [];
  let em = EMBERS.get(L);
  if (!em) { em = []; for (let i = 0; i < L.length; i++) if ((L[i] & FL.EMBER) && (L[i] & FL.DEPTH)) em.push(i); EMBERS.set(L, em); }
  return em;
}
/** The fluid byte of voxel i (0 when the world has no fluid layer: every D = 1 world). */
export const fluidAt = (s, i) => (s.L.fluid ? s.L.fluid[i] : 0);
/**
 * Write the fluid byte of voxel i (C5 v3 setFluid; static fluid only until Z3). Patches rt.walkCost and sets
 * the region, light and temperature flags with the voxel in the dirty list when passability or ember
 * changed. Returns true when the byte changed. No-op when the world has no fluid layer.
 */
export function setFluid(s, i, v) {
  const L = s.L.fluid;
  if (!L || L[i] === (v & 255)) return false;
  const before = L[i];
  L[i] = v & 255;
  const em = EMBERS.get(L);
  if (em && isEmber(before) !== isEmber(v)) {
    let lo = 0, hi = em.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (em[m] < i) lo = m + 1; else hi = m; }
    if (isEmber(v)) em.splice(lo, 0, i); else if (em[lo] === i) em.splice(lo, 1);
  }
  const rt = s.rt, w = walkOf(s, i), d = rt.dirty;
  if (rt.walkCost[i] !== w) { const was = rt.walkCost[i]; rt.walkCost[i] = w; if (passW(was, 0) !== passW(w, 0) || passW(was, 1) !== passW(w, 1)) d.regions = true; }
  if (isEmber(before) !== isEmber(v)) { d.light = true; d.temperature = true; }
  d.tiles.push(i);
  return true;
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

/** A lined seep (2.8: block or brick floor and walls around it, Masonry): the voxel dries and its source bit clears. E's job calls it. */
export const lineSeep = (s, i) => setFluid(s, i, fluidAt(s, i) & ~(FL.SOURCE | FL.DEPTH));
/** A seep: water standing in a source voxel (a mined aquifer or a spring); a well on it is a free clean-water well. */
export const isSeep = (s, i) => { const v = fluidAt(s, i); return (v & FL.SOURCE) !== 0 && (v & FL.EMBER) === 0 && (v & FL.DEPTH) !== 0; };

// ---- Dirty levels (2.6 edition 4; D > 1) --------------------------------------------------------------
/**
 * The levels a write at voxel t can change for the per-level passes (light, rooms): its own level z; z-1 and
 * z+1 when the write touches vertical connectivity (the voxel, or the one above or below, is open air, a ramp
 * top, a stair or a ramp); and, where the column's sky line moved, every level between the old and the new
 * line: the levels from skyZ - 1 up when the voxel is at the sky line, and the run of open air under the voxel
 * (a lid laid over a shaft darkens the whole shaft). Adds to the Set `out`.
 */
export function addDirtyLevels(s, t, out, skyZ = s.rt.skyZ) {
  const ter = s.L.terrain, z = (t / PLANE) | 0, c = t % PLANE;
  out.add(z);
  const vert = (v) => v === TER.AIR || (v >= TER.STAIR_U && v <= TER.RAMP_TOP);
  if (vert(ter[t]) || (z + 1 < D && vert(ter[t + PLANE])) || (z > 0 && vert(ter[t - PLANE]))) {
    if (z > 0) out.add(z - 1);
    if (z + 1 < D) out.add(z + 1);
  }
  if (skyZ) {
    const sz = skyZ[c];
    if (z >= sz - 1) for (let k = Math.max(0, sz - 1); k <= Math.min(D - 1, z + 1); k++) out.add(k);
  }
  if (z > 0 && (ter[t - PLANE] === TER.AIR || ter[t - PLANE] === TER.RAMP_TOP)) {
    for (let k = z - 1; k >= 0; k--) {
      out.add(k);
      const v = ter[k * PLANE + c];
      if (v !== TER.AIR && v !== TER.RAMP_TOP) break;
    }
  }
  return out;
}
