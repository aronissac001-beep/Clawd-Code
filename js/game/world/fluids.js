// Fluids lite (owner B/C, Stage Z3.4; EMBERCROWN-FORTRESS.md 2.8 Z3, 6.2). Water and ember flow on the
// `fluid` layer (bits 0-2 depth, bit 3 ember, bit 4 source).
//
//   The active set: s.colony.world.fluid = { act: [voxel], idle: [steps unchanged], q: [voxel], cur }.
//   It lives in the world record (JSON, saved with the colony and covered by the state hash), so a save
//   made mid-flood continues identically (C13); old saves have no record and get an empty one on the first
//   activation. act and q are sorted; idle runs parallel to act. A voxel enters when its fluid or a
//   neighbour's passability changes (terrain writes via onTileWrite, buildings built or removed, a toggled
//   door, gate, floodgate or bridge) and leaves after FLOW.idle unchanged steps. At most FLOW.maxActive
//   (4,096) voxels are active; beyond that new activations wait in q (sorted, drained lowest index first).
//
//   A step (water every 4 ticks, ember every 16): at most FLOW.perStep (2,048) active voxels in index order
//   from the saved cursor:
//     1. fall: as much as fits into the open voxel below, when this voxel has no floor (AIR, a stair down);
//     2. else spread: to each open planar neighbour whose depth is lower by >= 2, toward the average;
//     3. a source refills to 7. A voxel at zS-1 under river, lake or marsh terrain is a source (the breach).
//   Water meeting ember makes cinderstone (rock, mineable). No pressure: water never rises.
//   Solid for fluid: rock, void, lava, walls, closed or locked doors and gates, closed or locked floodgates,
//   a raised bridge (mechanism mode LOCKED). A held-open one passes fluid.
//
//   API: installFluids(), activate(s, i), activateAround(s, i), fluidStep(s, kind), fluidSystem(s),
//   fluidRec(s), fluidBlocked(s, i), activeCount(s), wadeOut(s).
//
//   Wading out (Z3b): water deep enough to block walking (depth >= 4) that rises over a colonist used to trap
//   them where they stood (no region, so no path to food or bed: a seed-2 digger starved in a flooded room).
//   Every water step a colonist on such a voxel swims one tile toward the nearest walkable voxel of the level,
//   through wet voxels, within WADE_R steps.

import { W, H, N, D, PLANE, zS, TER, TILE, DX4, DY4 } from '../core/grid.js';
import { EVENTS, emit } from '../core/events.js';
import { registerSystem, tickSystems, BUS } from '../core/bus.js';
import { FL, setFluid } from './pass.js';
import { worldRec, ensureWorld, getKey } from './worldrec.js';
import { structDef, hasFlag, stoneId } from './defs.js';
import { setTerrain, onTileWrite, passable } from './terrain.js';

export const FLOW = Object.freeze({ water: 4, ember: 16, perStep: 2048, maxActive: 4096, idle: 8, maxQueue: 65536, alertDepth: 4 });

const SOLID_T = new Uint8Array(32);
SOLID_T[TER.ROCK] = 1; SOLID_T[TER.VOID] = 1; SOLID_T[TER.LAVA] = 1;
const HOLE_T = new Uint8Array(32);
HOLE_T[TER.AIR] = 1; HOLE_T[TER.STAIR_D] = 1; HOLE_T[TER.STAIR_UD] = 1;
const SURF_T = new Uint8Array(32);
SURF_T[TER.SHALLOW] = 1; SURF_T[TER.DEEP] = 1; SURF_T[TER.MARSH] = 1;

/** The fluid record (read-only empty view when none). */
export function fluidRec(s) { const w = worldRec(s); return (w && w.fluid) || null; }
function liveRec(s) {
  const w = ensureWorld(s);
  if (!w.fluid) w.fluid = { act: [], idle: [], q: [], cur: 0 };
  return w.fluid;
}
export const activeCount = (s) => { const r = fluidRec(s); return r ? r.act.length : 0; };

const lowerBound = (a, v) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < v) lo = m + 1; else hi = m; } return lo; };

/** Mechanism mode of building b (0 closed, 1 open, 2 locked), from saved state only. */
const modeOf = (s, b) => { const e = getKey(worldRec(s).mech, b.id); return e ? e[1] : 0; };
export const isFloodgate = (b) => !!b && hasFlag(structDef(b.def), 'floodgate');
export const isLiftBridge = (b) => !!b && hasFlag(structDef(b.def), 'liftbridge');
/** A raising bridge is raised (a wall) when its mode is LOCKED (2); otherwise it is a lowered floor. */
export const bridgeRaised = (s, b) => isLiftBridge(b) && b.st === 'done' && modeOf(s, b) === 2;

/** The building at voxel i blocks fluid. */
function bldBlocks(s, i) {
  const id = s.rt.occ[i];
  if (id < 0) return false;
  const b = s.bld[id];
  if (!b || b.st !== 'done') return false;
  const d = structDef(b.def);
  if (!d) return false;
  if (hasFlag(d, 'liftbridge')) return modeOf(s, b) === 2;
  if (hasFlag(d, 'door') || hasFlag(d, 'floodgate')) return modeOf(s, b) !== 1;
  return hasFlag(d, 'wall') || hasFlag(d, 'window');   // Z4: a glass window holds water like a wall
}
/** Voxel i is solid for fluid (2.8 Z3). */
export function fluidBlocked(s, i) { return SOLID_T[s.L.terrain[i]] === 1 || bldBlocks(s, i); }
/** Voxel i has no floor: fluid in it falls (a hole, not covered by a lowered bridge or built floor). */
function holeAt(s, i) {
  if (!HOLE_T[s.L.terrain[i]]) return false;
  const id = s.rt.occ[i];
  if (id >= 0) { const b = s.bld[id]; if (b && b.st === 'done' && hasFlag(structDef(b.def), 'floor')) return false; }
  return true;
}
/** A voxel at zS-1 under surface water: the river breach source. */
const surfSource = (s, i) => D > 1 && ((i / PLANE) | 0) === zS - 1 && SURF_T[s.L.terrain[i + PLANE]] === 1;

// ---- Activation -------------------------------------------------------------------------------------
/** Add voxel i to the active set (or the queue when full). */
export function activate(s, i) {
  if (!s.L.fluid || i < 0 || i >= N) return;
  if (pend) { pend.push(i); return; }      // raised during a step: applied after the walk
  const r = liveRec(s), a = r.act;
  const k = lowerBound(a, i);
  if (a[k] === i) { r.idle[k] = 0; return; }
  if (a.length < FLOW.maxActive) { a.splice(k, 0, i); r.idle.splice(k, 0, 0); if (k < r.cur) r.cur++; return; }
  const q = r.q, j = lowerBound(q, i);
  if (q[j] !== i && q.length < FLOW.maxQueue) q.splice(j, 0, i);
}
const wet = (s, i) => (s.L.fluid[i] & FL.DEPTH) !== 0;
/** Activate i (when it holds fluid or is a breach source) and its 6 neighbours holding fluid. */
export function activateAround(s, i) {
  const fl = s.L.fluid;
  if (!fl || i < 0 || i >= N) return;
  if (wet(s, i) || (fl[i] & FL.SOURCE) || surfSource(s, i)) activate(s, i);
  const x = i % W, y = ((i % PLANE) / W) | 0;
  if (x > 0 && wet(s, i - 1)) activate(s, i - 1);
  if (x < W - 1 && wet(s, i + 1)) activate(s, i + 1);
  if (y > 0 && wet(s, i - W)) activate(s, i - W);
  if (y < H - 1 && wet(s, i + W)) activate(s, i + W);
  if (i >= PLANE && wet(s, i - PLANE)) activate(s, i - PLANE);
  if (i + PLANE < N && wet(s, i + PLANE)) activate(s, i + PLANE);
}
/** Activate every voxel of a building's footprint and the fluid around it (a toggle, a build, a removal). */
export function activateBuilding(s, b, tiles) { if (s.L.fluid) for (const i of tiles) activateAround(s, i); }

// ---- The step --------------------------------------------------------------------------------------
// Scratch for one step (never read across steps): the layers in locals, the written voxels, and the
// activations raised while the active set is being walked (applied after the walk).
let T = null, OCC = null, FLU = null, changed = null, pend = null, alerts = 0;
const blk = (s, j) => SOLID_T[T[j]] === 1 || (OCC[j] >= 0 && bldBlocks(s, j));
function put(s, i, v) { if (setFluid(s, i, v)) changed.push(i); }
function cinder(s, i) {
  const m = stoneId('cinderstone');
  setFluid(s, i, 0); changed.push(i);
  setTerrain(s, i, TER.ROCK, m || s.L.mat[i]);
}
/** Move up to `amt` of the fluid in i (byte v) into j; returns the amount moved (-1: cinderstone formed). */
function moveInto(s, i, v, j, amt) {
  const u = FLU[j], dj = u & FL.DEPTH, ember = v & FL.EMBER;
  if (dj && (u & FL.EMBER) !== ember) { cinder(s, ember ? i : j); return -1; }   // water meets ember
  const room = 7 - dj;
  const m = amt < room ? amt : room;
  if (m <= 0) return 0;
  if (dj < FLOW.alertDepth && dj + m >= FLOW.alertDepth && !ember) alerts++;
  put(s, j, (u & FL.SOURCE) | ember | (dj + m));
  return m;
}
function stepCell(s, i) {
  let v = FLU[i], dep = v & FL.DEPTH;
  const src = (v & FL.SOURCE) !== 0 || surfSource(s, i);
  if (!src && dep < 2 && !(dep && HOLE_T[T[i]])) return;   // quiet: too shallow to spread, nothing to fall
  if (blk(s, i)) return;                                   // a wall built in water holds it until removed
  if (dep) {
    let fell = false;
    if (i >= PLANE && HOLE_T[T[i]] && holeAt(s, i) && !blk(s, i - PLANE)) {           // 1. fall
      const m = moveInto(s, i, v, i - PLANE, dep);
      if (m < 0) return;
      if (m > 0) { fell = true; dep -= m; v = dep || (v & FL.SOURCE) ? (v & ~FL.DEPTH) | dep : 0; put(s, i, v); }
    }
    if (!fell && dep >= 2) {                                                            // 2. else spread
      const x = i % W, y = ((i % PLANE) / W) | 0;
      for (let k = 0; k < 4 && dep >= 2; k++) {
        let j;
        if (k === 0) { if (y === 0) continue; j = i - W; } else if (k === 1) { if (x === 0) continue; j = i - 1; }
        else if (k === 2) { if (x === W - 1) continue; j = i + 1; } else { if (y === H - 1) continue; j = i + W; }
        const dj = FLU[j] & FL.DEPTH;
        if (dep - dj < 2 || blk(s, j)) continue;
        const m = moveInto(s, i, v, j, (dep - dj) >> 1);
        if (m < 0) return;
        if (m > 0) { dep -= m; v = (v & ~FL.DEPTH) | dep; put(s, i, v); }
      }
    }
  }
  if (src && dep < 7) put(s, i, (v & (FL.EMBER | FL.SOURCE)) | 7);                   // 3. sources refill
}

/**
 * One fluid step over the active set (`kind`: 'water' steps water voxels, 'ember' ember voxels, 'all' both).
 * Returns { done, changed } for tests and benches.
 */
export function fluidStep(s, kind = 'all') {
  const r = fluidRec(s);
  if (!r || !s.L.fluid) return { done: 0, changed: 0 };
  while (r.q.length && r.act.length < FLOW.maxActive) {   // drain the queue into free slots
    const i = r.q.shift(), k = lowerBound(r.act, i);
    if (r.act[k] !== i) { r.act.splice(k, 0, i); r.idle.splice(k, 0, 0); }
  }
  const a = r.act, idle = r.idle, n0 = a.length;
  if (!n0) { r.cur = 0; return { done: 0, changed: 0 }; }
  T = s.L.terrain; OCC = s.rt.occ; FLU = s.L.fluid; changed = []; pend = []; alerts = 0;
  const todo = n0 < FLOW.perStep ? n0 : FLOW.perStep, wantW = kind !== 'ember', wantE = kind !== 'water';
  let c = r.cur >= n0 ? 0 : r.cur, drop = 0;
  for (let k = 0; k < todo; k++) {
    const i = a[c], v = FLU[i], em = (v & FL.EMBER) !== 0 && (v & FL.DEPTH) !== 0;
    if (em ? wantE : wantW) {
      const before = changed.length;
      stepCell(s, i);
      if (changed.length > before) idle[c] = 0;
      else if (++idle[c] >= FLOW.idle) { idle[c] = -1; drop++; }
    }
    if (++c >= n0) c = 0;
  }
  const nextStart = todo >= n0 ? -1 : a[c];
  if (drop) {
    let w = 0;
    for (let k = 0; k < n0; k++) if (idle[k] >= 0) { a[w] = a[k]; idle[w] = idle[k]; w++; }
    a.length = w; idle.length = w;
  }
  const wrote = changed, late = pend;
  T = OCC = FLU = null; changed = null; pend = null;
  for (const i of wrote) activateAround(s, i);
  for (const i of late) activate(s, i);
  r.cur = nextStart < 0 ? 0 : lowerBound(a, nextStart);
  if (alerts && 'flood' in EVENTS) emit(s, 'flood', { i: wrote[0], z: (wrote[0] / PLANE) | 0, n: alerts });
  return { done: todo, changed: wrote.length };
}

/** Tick system (slot 'mechanisms', after the plates): water every 4 ticks, ember every 16. */
const WADE_R = 24;
const tileOfCol = (c) => { const x = Math.floor(c.x / TILE), y = Math.floor(c.y / TILE); return x < 0 || y < 0 || x >= W || y >= H ? -1 : (c.z | 0) * PLANE + y * W + x; };
/** The first step from voxel i toward the nearest walkable voxel of its level through wet voxels (-1: none in reach). */
export function wadeStep(s, i) {
  const fl = s.L.fluid, z0 = ((i / PLANE) | 0) * PLANE;
  const from = new Map([[i, -1]]);
  let front = [i];
  for (let d = 0; d < WADE_R && front.length; d++) {
    const next = [];
    for (const a of front) {
      const p = a - z0, x = p % W, y = (p / W) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = x + DX4[k], ny = y + DY4[k];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const b = z0 + ny * W + nx;
        if (from.has(b)) continue;
        from.set(b, a);
        if (passable(s, b, 0)) { let c = b; while (from.get(c) !== i) c = from.get(c); return c; }
        if ((fl[b] & FL.DEPTH) && !(fl[b] & FL.EMBER) && !SOLID_T[s.L.terrain[b]] && !bldBlocks(s, b)) next.push(b);
      }
    }
    front = next;
  }
  return -1;
}
/** The nearest walkable voxel of i's level within 8 tiles (ring scan, lowest index first on a ring), -1 when none. */
export function nearestWalkable(s, i) {
  const z0 = ((i / PLANE) | 0) * PLANE, p = i - z0, x = p % W, y = (p / W) | 0;
  for (let r = 1; r <= 8; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    const j = z0 + ny * W + nx;
    if (passable(s, j, 0)) return j;
  }
  return -1;
}
/** Colonists on voxels that water made unwalkable swim one tile toward dry footing (see the header). */
export function wadeOut(s) {
  const fl = s.L.fluid;
  for (const c of s.col) {
    if (!c || (c.hp && c.hp.dead)) continue;
    const i = tileOfCol(c);
    if (i < 0) continue;
    // entombed: the voxel turned solid under them (cinderstone where water met ember, a cave-in); they step out to the
    // nearest walkable voxel of the level (v4 soak seed 3: a colonist stood in rock for days and starved there)
    if (SOLID_T[s.L.terrain[i]]) { const j = nearestWalkable(s, i); if (j >= 0) { c.x = (j % W) * TILE + TILE / 2; c.y = (((j % PLANE) / W) | 0) * TILE + TILE / 2; c.path = null; } continue; }
    if (!(fl[i] & FL.DEPTH) || (fl[i] & FL.EMBER) || passable(s, i, 0)) continue;
    const j = wadeStep(s, i);
    if (j < 0) continue;
    c.x = (j % W) * TILE + TILE / 2; c.y = (((j % PLANE) / W) | 0) * TILE + TILE / 2; c.path = null;
  }
}

export function fluidSystem(s) {
  if (D <= 1 || !s.L.fluid) return;
  if (s.tick % FLOW.water === 0) wadeOut(s);
  const r = fluidRec(s);
  if (!r || (!r.act.length && !r.q.length)) return;
  const t = s.tick;
  if (t % FLOW.ember === 0) fluidStep(s, 'all');
  else if (t % FLOW.water === 0) fluidStep(s, 'water');
}

const onWrite = (s, i, layer) => { if ((layer === 'terrain' || layer === 'floor') && s.L.fluid && D > 1) activateAround(s, i); };
let unWrite = null;
export function installFluids(footprintOf) {
  if (!tickSystems().some((x) => x.slot === 'mechanisms' && x.name === 'fluids')) registerSystem('mechanisms', 'fluids', fluidSystem, 20);
  if (!unWrite) unWrite = onTileWrite(onWrite);
  const tiles = (s, b) => (footprintOf ? footprintOf(s, b) : []);
  if (!BUS.built.some((f) => f.fluidHook)) { const f = (s, b) => { if (s.L.fluid && D > 1) activateBuilding(s, b, tiles(s, b)); }; f.fluidHook = 1; BUS.built.push(f); }
  if (!BUS.removed.some((f) => f.fluidHook)) { const f = (s, b) => { if (s.L.fluid && D > 1) activateBuilding(s, b, tiles(s, b)); }; f.fluidHook = 1; BUS.removed.push(f); }
}
