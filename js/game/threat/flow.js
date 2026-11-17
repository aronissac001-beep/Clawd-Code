// Flow fields for raids (doc 9.3, 12.3). Owner H. Provisional API (behind installThreat's flag in 1a).
//
// s.rt.flow (C13 class 'saved-while-raid') = [Field], at most CAPS.flowFields (3) live, one per
// goal. Field = { goal, slot, built, stamp, f: Uint16Array(N) }: f[i] is the walk cost (x10 per
// tile, the walkCost units) from tile i to the nearest goal tile for a hostile, FLOW_UNREACHED
// where no hostile can reach. A field is built WHOLE inside one tick (bucket-queue Dijkstra) on
// ticks where tick % 10 == slot (core 0, loot 3, dig 6), and only when its inputs changed: stamp
// is an FNV-1a hash of rt.walkCost and the goal tiles. Between builds the last field is used.
// Because a field built at tick T cannot be rebuilt identically later, fields are saved while a
// raid is live and dropped when none is (raidLive, core/state.js).
//
// Step costs follow world/pass.js stepCost for the hostile side (doors and walls block in Stage 0;
// door and wall hp as cost arrives with 1b sieges). Diagonals cost x1.4 (rounded) and may not cut
// a blocked corner. The value is the cost of the tiles a walker ENTERS on the way to the goal.

import { N, W, H, DX8, DY8, tileOfW } from '../core/grid.js';
import { raidLive } from '../core/state.js';
import { stepCost, SIDE } from '../world/pass.js';
import { bal } from './defs.js';
import { GOALS } from './incidents.js';

export const FLOW_UNREACHED = 0xffff;
export const GOAL_SLOT = Object.freeze({ core: 0, loot: 3, dig: 6, people: 9 });
export const REBUILD_EVERY = 10;
const DIAG = (c) => ((c * 14 + 5) / 10) | 0;
const BUCKETS = 512, BMASK = BUCKETS - 1; // > the largest single step (250 x 1.4 = 350); a power of two

// Scratch buffers, grown on demand and never at import (D1): per-tile hostile entry cost, goal
// flags, and the bucket queue (singly linked lists in typed arrays).
let pool = null;
function scratch(n, minCap) {
  if (!pool || pool.n !== n) pool = { n, cost: new Uint16Array(n), goal: new Uint8Array(n), tile: new Int32Array(minCap), next: new Int32Array(minCap), heads: new Int32Array(BUCKETS) };
  if (pool.tile.length < minCap) { pool.tile = new Int32Array(minCap); pool.next = new Int32Array(minCap); }
  return pool;
}

/**
 * Build a whole field from goal tiles (bucket-queue Dijkstra).
 * @param {object} s @param {number[]} goals tile indexes @param {number} [side] SIDE.HOS by default
 * @param {Uint16Array} [out] reused when given (length N)
 * @returns {Uint16Array}
 */
export function buildFlowField(s, goals, side = SIDE.HOS, out = null) {
  const wc = s.rt.walkCost;
  const f = out && out.length === N ? out : new Uint16Array(N);
  f.fill(FLOW_UNREACHED);
  const sc = scratch(N, Math.max(1024, N * 3));
  const cost = sc.cost, goal = sc.goal, heads = sc.heads;
  let tile = sc.tile, next = sc.next, cap = tile.length;
  for (let i = 0; i < N; i++) cost[i] = stepCost(wc[i], side);
  goal.fill(0);
  heads.fill(-1);
  let used = 0, count = 0;
  for (const g of goals) {
    if (g < 0 || g >= N || goal[g]) continue;
    goal[g] = 1; f[g] = 0;
    tile[used] = g; next[used] = heads[0]; heads[0] = used; used++; count++;
  }
  const w = W, h = H;
  let cur = 0;
  while (count > 0) {
    const b = cur & BMASK;
    const e = heads[b];
    if (e < 0) { cur++; continue; }
    heads[b] = next[e]; count--;
    const t = tile[e];
    if (f[t] !== cur) continue; // stale entry
    const c0 = cost[t];
    const enter = c0 === 0 ? (goal[t] ? 10 : 0) : c0;
    if (enter === 0) continue;
    const dg = DIAG(enter);
    const tx = t % w, ty = (t / w) | 0;
    if (used + 8 > cap) {   // grow the queue storage (rare: stale entries only)
      cap *= 2;
      const nt = new Int32Array(cap), nn = new Int32Array(cap);
      nt.set(tile.subarray(0, used)); nn.set(next.subarray(0, used));
      tile = sc.tile = nt; next = sc.next = nn;
    }
    if (tx > 0 && ty > 0 && tx < w - 1 && ty < h - 1) {
      // interior tile: fixed offsets, no bounds checks (orthogonals first, then diagonals)
      const n = t - w, e2 = t + 1, so = t + w, we = t - 1;
      const cn = cost[n], ce = cost[e2], cs = cost[so], cw = cost[we];
      let nd = cur + enter;
      if (nd < FLOW_UNREACHED) {
        if (cn !== 0 && nd < f[n]) { f[n] = nd; const bb = nd & BMASK; tile[used] = n; next[used] = heads[bb]; heads[bb] = used; used++; count++; }
        if (ce !== 0 && nd < f[e2]) { f[e2] = nd; const bb = nd & BMASK; tile[used] = e2; next[used] = heads[bb]; heads[bb] = used; used++; count++; }
        if (cs !== 0 && nd < f[so]) { f[so] = nd; const bb = nd & BMASK; tile[used] = so; next[used] = heads[bb]; heads[bb] = used; used++; count++; }
        if (cw !== 0 && nd < f[we]) { f[we] = nd; const bb = nd & BMASK; tile[used] = we; next[used] = heads[bb]; heads[bb] = used; used++; count++; }
      }
      nd = cur + dg;
      if (nd < FLOW_UNREACHED) {
        if (cn !== 0 && ce !== 0) { const j = n + 1; if (cost[j] !== 0 && nd < f[j]) { f[j] = nd; const bb = nd & BMASK; tile[used] = j; next[used] = heads[bb]; heads[bb] = used; used++; count++; } }
        if (cs !== 0 && ce !== 0) { const j = so + 1; if (cost[j] !== 0 && nd < f[j]) { f[j] = nd; const bb = nd & BMASK; tile[used] = j; next[used] = heads[bb]; heads[bb] = used; used++; count++; } }
        if (cs !== 0 && cw !== 0) { const j = so - 1; if (cost[j] !== 0 && nd < f[j]) { f[j] = nd; const bb = nd & BMASK; tile[used] = j; next[used] = heads[bb]; heads[bb] = used; used++; count++; } }
        if (cn !== 0 && cw !== 0) { const j = n - 1; if (cost[j] !== 0 && nd < f[j]) { f[j] = nd; const bb = nd & BMASK; tile[used] = j; next[used] = heads[bb]; heads[bb] = used; used++; count++; } }
      }
      continue;
    }
    for (let d = 0; d < 8; d++) {
      const nx = tx + DX8[d], ny = ty + DY8[d];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (cost[j] === 0) continue;                                              // a hostile cannot stand there
      if (d >= 4 && (cost[ty * w + nx] === 0 || cost[ny * w + tx] === 0)) continue; // no corner cutting
      const nd = cur + (d >= 4 ? dg : enter);
      if (nd < f[j] && nd < FLOW_UNREACHED) {
        f[j] = nd;
        const bb = nd & BMASK;
        tile[used] = j; next[used] = heads[bb]; heads[bb] = used; used++; count++;
      }
    }
  }
  return f;
}

/** The neighbour of tile i a hostile should step to (lowest value; ties in DX8 order), or -1. */
export function flowStep(f, i) {
  const x = i % W, y = (i / W) | 0;
  let best = -1, bv = f[i];
  for (let d = 0; d < 8; d++) {
    const nx = x + DX8[d], ny = y + DY8[d];
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    const j = ny * W + nx;
    if (f[j] < bv) { bv = f[j]; best = j; }
  }
  return best;
}

/** Input stamp: FNV-1a over rt.walkCost and the goal tiles (u32). */
export function flowStamp(s, goals) {
  let h = 0x811c9dc5;
  const wc = s.rt.walkCost;
  for (let i = 0; i < wc.length; i++) { h ^= wc[i]; h = Math.imul(h, 0x01000193); }
  for (const g of goals) { h ^= g & 0xffff; h = Math.imul(h, 0x01000193); h ^= g >>> 16; h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** Goal tiles for a raid goal, ascending (Stage 0: core = the Hearth, else the colonists). */
export function goalTiles(s, goal) {
  const out = [];
  const tileOfCol = (c) => tileOfW(c.y) * W + tileOfW(c.x);
  if (goal === 'core') {
    const hb = s.colony.hearth.id !== null ? s.bld[s.colony.hearth.id] : null;
    if (hb) out.push(hb.y * W + hb.x);
    else for (const c of s.col) if (!c.hp.dead) out.push(tileOfCol(c));
  } else if (goal === 'loot' || goal === 'dig') {
    for (const it of s.items) if (it) out.push(it.y * W + it.x);
  } else if (goal === 'people') {
    for (const c of s.col) if (!c.hp.dead) out.push(tileOfCol(c));
  }
  if (!out.length) out.push(((H >> 1) * W) + (W >> 1));
  return [...new Set(out)].sort((a, b) => a - b);
}

export const fieldFor = (s, goal) => { for (const fl of s.rt.flow) if (fl.goal === goal) return fl; return null; };

/** Goals needed now: those of raids from 'sighted' to 'retreat', in GOALS order, at most CAPS.flowFields.
 *  The 'people' goal has no field: it uses A* per pack leader (9.3). */
export function liveGoals(s) {
  const want = [];
  for (const g of GOALS) if (g !== 'people' && s.raids.some((r) => r.goal === g && r.stage !== 'warned' && r.stage !== 'ended')) want.push(g);
  return want.slice(0, bal('caps').flowFields || 3);
}

/** (Re)build one field now. */
export function rebuildField(s, fl) {
  const goals = goalTiles(s, fl.goal);
  fl.stamp = flowStamp(s, goals);
  fl.f = buildFlowField(s, goals, SIDE.HOS, fl.f);
  fl.built = s.tick;
  return fl;
}

/** Tick system (slot 'raids', after raid stages): keep the live set and rebuild on its slot tick. */
export function flowSystem(s) {
  if (!raidLive(s)) { if (s.rt.flow.length) s.rt.flow = []; return; }
  const want = liveGoals(s);
  const kept = s.rt.flow.filter((fl) => want.includes(fl.goal));
  for (const g of want) if (!kept.some((fl) => fl.goal === g)) kept.push(rebuildField(s, { goal: g, slot: GOAL_SLOT[g], built: -1, stamp: 0, f: null }));
  kept.sort((a, b) => GOALS.indexOf(a.goal) - GOALS.indexOf(b.goal));
  s.rt.flow = kept;
  for (const fl of kept) {
    if (s.tick % REBUILD_EVERY !== fl.slot % REBUILD_EVERY || fl.built === s.tick) continue;
    const goals = goalTiles(s, fl.goal);
    if (flowStamp(s, goals) !== fl.stamp) rebuildField(s, fl);
  }
}
