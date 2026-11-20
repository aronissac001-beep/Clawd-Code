// Vertical work designations (EMBERCROWN-FORTRESS.md 2.3, 4.4; Stage Z1 step E5; owner E): Stairs, Ramp
// and Channel (dug: Mine work, mining skill) and the built floor and built stairs (Construction: Build
// work, a delivered unit of stone, blocks or wood). Dark behind FORTRESS until E13: nothing here runs
// unless a fortress command designates something, so a D = 1 game never holds a vertical designation.
//
// Saved state: s.colony.work.vdig = [[voxel, kind], ...] sorted by voxel (E's saved work record, next to
// the filth list; created only when the first vertical designation is made, so D = 1 hashes are Stage
// 2.9's). The desig layer has no free bit (all eight are used), so these live here instead.
// Index (C13 incremental-ordered): rt.idx.vdig = [CLUSTERS voxel lists, ascending], one per 16 x 16 x 1
// cluster, rebuilt from the saved list and kept exact by setVdig.
//
// Stair kinds are not stored: a stair voxel's kind follows from its column when it is dug or built (2.3:
// STAIR_D on top, STAIR_UD between, STAIR_U at the bottom): it links up when the voxel above is a stair or
// holds a stair designation, and down when the voxel below is one. Neighbouring stair voxels are widened
// to STAIR_UD when a new stair joins them, so a stack can be dug top-down, bottom-up or extended later.
//
// Standing spots (2.3; the goal modes ABOVE and ADJ_STAIR as standSpot modes, so pathing needs only GOAL
// TILE: the worker walks to the chosen voxel itself):
//   stair  ADJ_STAIR: a planar 4-neighbour on its level, or the stair voxel directly above it (ABOVE; a
//          shaft through rock offers only this, so a stack is dug top-down by a miner standing on each
//          stair in turn), or the stair directly below it (an Up stack);
//   ramp, channel, built floor   a planar 4-neighbour on its level (never the voxel itself);
//   built stair                  ADJ_STAIR.
// A channel waits for a channel designation directly above it (top first, 4.4).

import { PLANE, N, CLUSTERS, clusterOf, idx, tx, ty, tz, inB, TER, TER_MINEABLE, TER_UP, TER_DOWN } from '../core/grid.js';
import { TICKS_PER_MIN } from '../core/time.js';
import { digStair, digRamp, channel, buildFloor, setTerrain, canStair, canRamp, canChannel } from '../world/terrain.js';
import { mineAllowed } from '../world/support.js';
import { T, END, makeJob, registerEffect, registerIdxPart, keyTile, keyId, keyItem } from './jobs.js';
import { carried, freeCount } from './items.js';
import { collect, standSpot, openTarget, sortedInsert, sortedRemove, reachableFrom, distTo } from './windex.js';
import { capUnits } from './construct.js';

/** Vertical designation kinds (the u8 in the saved list) and their command names. */
export const VD = Object.freeze({ STAIR: 1, RAMP: 2, CHANNEL: 3, FLOOR: 4, BSTAIR: 5 });
export const VD_NAMES = Object.freeze({ stairs: VD.STAIR, ramp: VD.RAMP, channel: VD.CHANNEL, floor: VD.FLOOR, bstairs: VD.BSTAIR });
const DUG = new Set([VD.STAIR, VD.RAMP, VD.CHANNEL]);
/** Work multipliers on the stone work of the voxel (2.3 table), percent. */
export const VD_WORK_PCT = Object.freeze({ [VD.STAIR]: 120, [VD.RAMP]: 120, [VD.CHANNEL]: 80 });
/** Work of carving into an open floor (no rock to cut) and of a built floor or stair, game minutes. */
export const VD_FLOOR_MIN = 6, VD_BUILD_MIN = 15;

// ---- Saved list --------------------------------------------------------------------------------------
const listOf = (s) => (s.colony.work && s.colony.work.vdig) || null;
function rec(s) {
  const c = s.colony;
  if (!c.work) c.work = { filth: [] };
  if (!c.work.vdig) c.work.vdig = [];
  return c.work.vdig;
}
const find = (a, i) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m][0] < i) lo = m + 1; else hi = m; } return lo; };
/** The vertical designation kind on voxel i (0 none). */
export function vdigAt(s, i) { const a = listOf(s); if (!a) return 0; const k = find(a, i); return a[k] && a[k][0] === i ? a[k][1] : 0; }
/** Every vertical designation, [[voxel, kind]] ascending (read only; render and UI). */
export const vdigList = (s) => listOf(s) || [];
/** Designations on level z, [[voxel, kind]] (the ghost column and the depth ruler counts, 4.1, 4.4). */
export function vdigOnLevel(s, z) { const lo = z * PLANE, hi = lo + PLANE; return vdigList(s).filter((e) => e[0] >= lo && e[0] < hi); }
/** Set (kind > 0) or clear (0) the designation on voxel i; keeps rt.idx.vdig exact. Returns true on a change. */
export function setVdig(s, i, kind) {
  const cur = vdigAt(s, i);
  if (cur === kind) return false;
  const a = rec(s), k = find(a, i);
  if (kind) { if (cur) a[k][1] = kind; else a.splice(k, 0, [i, kind]); } else a.splice(k, 1);
  const ix = s.rt.idx.vdig;
  if (Array.isArray(ix) && ix.length === CLUSTERS) { if (kind) sortedInsert(ix[clusterOf(i)], i); else sortedRemove(ix[clusterOf(i)], i); }
  if (!a.length) delete s.colony.work.vdig;
  return true;
}
export function rebuildVdigIndex(s) {
  const out = [];
  for (let c = 0; c < CLUSTERS; c++) out.push([]);
  for (const [i] of vdigList(s)) if (i >= 0 && i < N) out[clusterOf(i)].push(i);
  return out;
}
registerIdxPart('vdig', rebuildVdigIndex);

// ---- Rules ---------------------------------------------------------------------------------------------
const isStairTer = (t) => t === TER.STAIR_U || t === TER.STAIR_D || t === TER.STAIR_UD;
const stairy = (s, j, k) => j >= 0 && j < N && (isStairTer(s.L.terrain[j]) || k === VD.STAIR || k === VD.BSTAIR);
/** The stair kind voxel i takes now from its column (2.3). */
export function stairKindFor(s, i) {
  const up = i + PLANE < N && stairy(s, i + PLANE, vdigAt(s, i + PLANE));
  const dn = i >= PLANE && stairy(s, i - PLANE, vdigAt(s, i - PLANE));
  return up && dn ? TER.STAIR_UD : up ? TER.STAIR_U : dn ? TER.STAIR_D : TER.STAIR_UD;
}
/** Widen the stairs next to a new stair at i so they link to it (STAIR_U above it gains down, STAIR_D below gains up). */
function joinStairs(s, i) {
  const t = s.L.terrain[i];
  if (TER_UP[t] && i + PLANE < N && s.L.terrain[i + PLANE] === TER.STAIR_U) setTerrain(s, i + PLANE, TER.STAIR_UD);
  if (TER_DOWN[t] && i >= PLANE && s.L.terrain[i - PLANE] === TER.STAIR_D) setTerrain(s, i - PLANE, TER.STAIR_UD);
}
/** Can kind still be done at voxel i (the terrain allows it)? */
export function vdigFits(s, i, kind) {
  const t = s.L.terrain[i];
  switch (kind) {
    case VD.STAIR: return canStair(s, i);
    case VD.RAMP: return canRamp(s, i);
    case VD.CHANNEL: return canChannel(s, i);
    case VD.FLOOR: return t === TER.AIR;
    case VD.BSTAIR: return t === TER.AIR || (canStair(s, i) && !TER_MINEABLE[t]);
    default: return false;
  }
}
/** Stops a stair or channel stack (4.4): the map edge, fluid, unmineable greystone (no floor and not rock). */
const stackStop = (s, i) => (s.L.fluid && s.L.fluid[i]) || s.L.terrain[i] === TER.VOID || s.L.terrain[i] === TER.DEEP;

/**
 * The fortress designate step for the vertical kinds (4.4). c: { kind: 'stairs'|'ramp'|'channel'|'floor'|
 * 'bstairs', rect (with z), add, levels?, dir? ('down' | 'up') }. Stairs: `levels` voxels in the column
 * including the view level (default 2: Down 1), so the tool's "Down 3" sends levels 4; Channel: `levels`
 * levels downward, top first (no Up); the rest: the view level only. A stack stops at the first voxel
 * where it cannot go (the red end mark): its last level is then where it stopped.
 * @returns {{ ok: true, n } | { ok: false, reason }}
 */
export function designateVertical(s, c) {
  const kind = VD_NAMES[c.kind];
  if (!kind) return { ok: false, reason: `unknown kind ${c.kind}` };
  const r = c.rect, z0 = r.z | 0;
  const x0 = Math.min(r.x0, r.x1), x1 = Math.max(r.x0, r.x1), y0 = Math.min(r.y0, r.y1), y1 = Math.max(r.y0, r.y1);
  if (!inB(x0, y0, z0) || !inB(x1, y1, z0)) return { ok: false, reason: 'off the map' };
  const up = c.dir === 'up';
  const levels = kind === VD.STAIR || kind === VD.BSTAIR ? Math.max(2, c.levels | 0 || 2) : kind === VD.CHANNEL ? Math.max(1, c.levels | 0 || 1) : 1;
  let n = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    for (let k = 0; k < levels; k++) {
      const z = up && kind !== VD.CHANNEL ? z0 + k : z0 - k;
      if (!inB(x, y, z)) break;
      const i = idx(x, y, z);
      if (!c.add) { if (vdigAt(s, i) === kind && setVdig(s, i, 0)) n++; continue; }
      if (stackStop(s, i)) break;
      // a stair stack passes through voxels that are already stairs; a channel stack through open air
      if ((kind === VD.STAIR || kind === VD.BSTAIR) && isStairTer(s.L.terrain[i])) continue;
      if (kind === VD.CHANNEL && s.L.terrain[i] === TER.AIR) continue;
      let fits = vdigFits(s, i, kind);
      // a channel below a designated channel: its floor may be rock now (it becomes a ramp first)
      if (!fits && kind === VD.CHANNEL && k > 0 && TER_MINEABLE[s.L.terrain[i]]) fits = true;
      if (!fits && kind === VD.STAIR && s.L.terrain[i] === TER.AIR) break;   // needs built stairs (Structure tab)
      if (!fits) { if (kind === VD.STAIR || kind === VD.CHANNEL) break; continue; }
      if (setVdig(s, i, kind)) n++;
    }
  }
  if (!n) return { ok: false, reason: c.add ? `nothing to ${c.kind} there` : 'nothing to remove' };
  return { ok: true, n };
}
/** Cancel (cancelRect) of vertical kinds on the rect's level, or on every level with allLevels. */
export function cancelVertical(s, rect, kinds, allLevels = false) {
  const want = new Set(kinds.map((k) => VD_NAMES[k]).filter(Boolean));
  if (!want.size) return 0;
  const x0 = Math.min(rect.x0, rect.x1), x1 = Math.max(rect.x0, rect.x1), y0 = Math.min(rect.y0, rect.y1), y1 = Math.max(rect.y0, rect.y1), z = rect.z | 0;
  let n = 0;
  for (const [i, k] of vdigList(s).slice()) {
    if (!want.has(k)) continue;
    const x = tx(i), y = ty(i);
    if (x < x0 || x > x1 || y < y0 || y > y1 || (!allLevels && tz(i) !== z)) continue;
    if (setVdig(s, i, 0)) n++;
  }
  return n;
}

// ---- Work amounts ------------------------------------------------------------------------------------------
let mineTicksFn = null;
/** givers/mine.js installs its stone-work function (avoids an import cycle). */
export function setMineTicks(fn) { mineTicksFn = fn; }
/** Ticks of work for kind at voxel i at speed 1.0. */
export function vdigTicks(s, i, kind) {
  if (kind === VD.FLOOR || kind === VD.BSTAIR) return VD_BUILD_MIN * TICKS_PER_MIN;
  let j = i;
  if (kind === VD.CHANNEL && i >= PLANE && TER_MINEABLE[s.L.terrain[i - PLANE]]) j = i - PLANE;   // the rock below is cut into a ramp
  const base = TER_MINEABLE[s.L.terrain[j]] && mineTicksFn ? mineTicksFn(s, j) : VD_FLOOR_MIN * TICKS_PER_MIN;
  return Math.max(1, Math.floor((base * (VD_WORK_PCT[kind] || 100)) / 100));
}

// ---- Targets ---------------------------------------------------------------------------------------------
const standMode = (kind) => (kind === VD.STAIR || kind === VD.BSTAIR ? 'adjStair' : 'adj');
/** A vertical work target at voxel i for col, or null. dug: the Mine giver's kinds, else the Build giver's. */
function target(s, col, i, dug) {
  const kind = vdigAt(s, i);
  if (!kind || DUG.has(kind) !== dug) return null;
  if (!vdigFits(s, i, kind)) {
    if (kind === VD.CHANNEL && TER_MINEABLE[s.L.terrain[i]]) return null;   // waits for the channel above to cut it into a ramp
    return null;
  }
  if (kind === VD.CHANNEL && i + PLANE < N && vdigAt(s, i + PLANE) === VD.CHANNEL) return null;   // top first
  if (!openTarget(s, col, keyTile(i))) return null;
  const st = standSpot(s, col, [i], { mode: standMode(kind) });
  if (st.i < 0 || st.i === i) return null;
  return { key: keyTile(i), i, kind, stand: st.i, d: st.d };
}
/** Dropped designations that can never be done (the voxel changed under them). */
function stale(s, i) {
  const kind = vdigAt(s, i);
  if (!kind || vdigFits(s, i, kind)) return false;
  if (kind === VD.CHANNEL && TER_MINEABLE[s.L.terrain[i]]) return false;
  if ((kind === VD.STAIR || kind === VD.BSTAIR) && isStairTer(s.L.terrain[i])) return true;
  return kind !== VD.CHANNEL || s.L.terrain[i] === TER.AIR || s.L.terrain[i] === TER.RAMP_TOP;
}

/** The Mine giver's vertical part: Stairs, Ramp and Channel designations, nearest first (3D cluster rings). */
export const VDIG_GIVER = Object.freeze({
  id: 'vdig', work: 'mine', order: 1,
  candidates(s, col, k) {
    if (!listOf(s)) return [];
    const d = s.rt.idx.vdig;
    return collect(s, col, (c) => d[c], (i) => target(s, col, i, true), k);
  },
  valid(s, col, t) {
    const r = target(s, col, t.i, true);
    if (!r) return false;
    return !TER_MINEABLE[s.L.terrain[r.kind === VD.CHANNEL && TER_MINEABLE[s.L.terrain[t.i - PLANE]] ? t.i - PLANE : t.i]] || mineAllowed(s, t.i);
  },
  make(s, col, t) {
    const key = keyTile(t.i);
    return { job: makeJob('vdig', key, [T.goto(t.stand), T.work(vdigTicks(s, t.i, t.kind), { sk: 'mining', fx: 'vdig', key })]), claims: [[key, 0]] };
  },
  keyOf: (t) => t.key,
  fromTarget(s, col, tg) { if (!tg || tg.x === undefined || !inB(tg.x, tg.y, tg.z | 0)) return null; return target(s, col, idx(tg.x, tg.y, tg.z | 0), true); },
});

/** A unit of building material for a built floor or stair: stone, blocks or wood, nearest by region distance. */
const MAT_CATS = ['blocks', 'stone', 'wood'];
function materialFor(s, col) {
  let best = null, bd = Infinity;
  const b = s.rt.idx.items;
  for (const cat of MAT_CATS) {
    const a = b['@' + cat];
    if (!a) continue;
    for (const id of a) {
      const it = s.items[id];
      if (!it || it.f || freeCount(s, id, col.id) <= 0) continue;
      const ti = idx(it.x, it.y, it.z | 0);
      if (!reachableFrom(s, col, ti)) continue;
      const d = distTo(s, col, ti);
      if (d < bd || (d === bd && best && id < best.id)) { bd = d; best = it; }
    }
  }
  return best;
}
/** The Build giver's vertical part: built floors (over air) and built stairs. */
export const VBUILD_GIVER = Object.freeze({
  id: 'vbuild', work: 'build', order: 1,
  candidates(s, col, k) {
    if (!listOf(s)) return [];
    const d = s.rt.idx.vdig;
    return collect(s, col, (c) => d[c], (i) => target(s, col, i, false), k);
  },
  valid(s, col, t) {
    if (!target(s, col, t.i, false)) return false;
    const it = materialFor(s, col);
    if (!it) return false;
    t.mat = it.id;
    return capUnits(col, it.k) >= 1;
  },
  make(s, col, t) {
    const key = keyTile(t.i), it = s.items[t.mat];
    const toils = [T.goto(idx(it.x, it.y, it.z | 0)), T.pickup(it.id, 1), T.carry(t.stand), T.work(vdigTicks(s, t.i, t.kind), { sk: 'construction', fx: 'vbuild', key })];
    return { job: makeJob('vbuild', key, toils), claims: [[key, 0], [keyItem(it.id), 1]] };
  },
  keyOf: (t) => t.key,
  fromTarget(s, col, tg) { if (!tg || tg.x === undefined || !inB(tg.x, tg.y, tg.z | 0)) return null; return target(s, col, idx(tg.x, tg.y, tg.z | 0), false); },
});

// ---- Effects --------------------------------------------------------------------------------------------------
/** The yield of a dug voxel (as Mine: the deposit, else rough stone on WORK.stoneYieldPct), dropped at the stand. */
let yieldFn = null;
/** givers/mine.js installs: fn(s, col, r, minedVoxel) drops what mining gave. */
export function setMineYield(fn) { yieldFn = fn; }
registerEffect('vdig', (s, col, job) => {
  const i = keyId(job.target), kind = vdigAt(s, i);
  if (!kind) return undefined;
  if (stale(s, i)) { setVdig(s, i, 0); return undefined; }
  let r = null;
  if (kind === VD.STAIR) { r = digStair(s, i, stairKindFor(s, i), col.id); if (r) joinStairs(s, i); }
  else if (kind === VD.RAMP) r = digRamp(s, i, col.id);
  else if (kind === VD.CHANNEL) { const c = channel(s, i, col.id); r = c ? c.below || { floor: true } : null; }
  if (!r) return undefined;
  setVdig(s, i, 0);
  if (!r.floor && !r.rubble && yieldFn) yieldFn(s, col, r, i);
  return undefined;
});
registerEffect('vbuild', (s, col, job) => {
  const i = keyId(job.target), kind = vdigAt(s, i);
  const b = carried(col);
  if (!kind || !b || !vdigFits(s, i, kind)) { if (kind && !vdigFits(s, i, kind)) setVdig(s, i, 0); return kind ? END.TARGET_GONE : undefined; }
  if (s.L.terrain[i] === TER.AIR) buildFloor(s, i, 0);
  if (kind === VD.BSTAIR) { digStair(s, i, stairKindFor(s, i), col.id); joinStairs(s, i); }
  b.n -= 1;
  if (b.n <= 0) job.carry = null;
  setVdig(s, i, 0);
  return undefined;
});
