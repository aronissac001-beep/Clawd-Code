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
// Step costs (Stage 1b): hostileCosts() gives each tile the cost a hostile pays to ENTER it: the
// walk cost of open ground (world/pass.js stepCost, hostile side), and for a finished wall or door
// (structure flags 'wall' / 'door') a smash cost from its hp in 25% bands (SMASH), so a weak spot in
// a wall draws the horde (9.3) and a foe whose next step is such a tile stops and breaks it
// (raiders.js). Other blocking structures (benches, the Hearth) stay closed. Diagonals cost x1.4
// (rounded) and may not cut the corner of a solid tile (rock, wall, door, bench). The value is the
// cost of the tiles a walker ENTERS on the way to the goal. The stamp hashes the cost array and the
// goal tiles, so a wall dropping a hp band, or a colonist the goal follows, rebuilds the field.

import { N, W, H, DX8, DY8, tileOfW } from '../core/grid.js';
import { raidLive } from '../core/state.js';
import { stepCost, SIDE, footprint } from '../world/pass.js';
import { structDef, hasFlag } from '../world/defs.js';
import { bal } from './defs.js';

export const FLOW_UNREACHED = 0xffff;
/** Field goals: the raid goals with a field, then 'edge' (dawn retreat: every open map-edge tile). */
export const FIELD_GOALS = Object.freeze(['core', 'loot', 'dig', 'edge']);
export const GOAL_SLOT = Object.freeze({ core: 0, loot: 3, dig: 6, people: 9, edge: 9 });
export const REBUILD_EVERY = 10;
/** Smash cost x10 of a wall or door by hp band (1 = up to 25% hp .. 4 = above 75%). */
export const SMASH = Object.freeze({ base: 30, perBand: 50 });
const DIAG = (c) => ((c * 14 + 5) / 10) | 0;
const BUCKETS = 512, BMASK = BUCKETS - 1; // > the largest single step (250 x 1.4 = 350); a power of two

// Scratch buffers, grown on demand and never at import (D1): goal flags and the bucket queue
// (singly linked lists in typed arrays).
let pool = null;
function scratch(n, minCap) {
  if (!pool || pool.n !== n) pool = { n, cost: new Uint16Array(n), solid: new Uint8Array(n), goal: new Uint8Array(n), tile: new Int32Array(minCap), next: new Int32Array(minCap), heads: new Int32Array(BUCKETS) };
  if (pool.tile.length < minCap) { pool.tile = new Int32Array(minCap); pool.next = new Int32Array(minCap); }
  return pool;
}

/** A finished wall or door hostiles can break (doors are walls with hp for them, 12.3). */
export function smashable(b) {
  if (!b || b.st !== 'done') return false;
  const d = structDef(b.def);
  return !!d && (hasFlag(d, 'wall') || hasFlag(d, 'door'));
}
/** Max hp of a building (its def's hp, else 100). */
export const maxHpOf = (b) => { const d = structDef(b.def); return (d && d.hp) || 100; };
/** The hp band 1-4 (25% steps) of a building. */
export const hpBand = (b) => Math.max(1, Math.min(4, Math.ceil((4 * Math.max(0, b.hp)) / maxHpOf(b))));

/**
 * Hostile entry costs (u16 per tile, 0 = closed) and solid flags (1 = blocks corner cutting).
 * side COL gives the plain colonist costs (no smashing). Written into the given arrays.
 */
export function hostileCosts(s, side = SIDE.HOS, cost = new Uint16Array(N), solid = new Uint8Array(N)) {
  const wc = s.rt.walkCost, occ = s.rt.occ;
  for (let i = 0; i < N; i++) {
    const c = stepCost(wc[i], side);
    cost[i] = c; solid[i] = c === 0 ? 1 : 0;
    if (c === 0 && side === SIDE.HOS && occ[i] >= 0) {
      const b = s.bld[occ[i]];
      if (smashable(b)) cost[i] = SMASH.base + SMASH.perBand * hpBand(b);
    }
  }
  return { cost, solid };
}

/**
 * Build a whole field from goal tiles (bucket-queue Dijkstra).
 * @param {object} s @param {number[]} goals tile indexes @param {number} [side] SIDE.HOS by default
 * @param {Uint16Array} [out] reused when given (length N)
 * @param {boolean} [smash] true: walls and doors are enterable at their smash cost (hostileCosts)
 * @returns {Uint16Array}
 */
export function buildFlowField(s, goals, side = SIDE.HOS, out = null, smash = false) {
  const f = out && out.length === N ? out : new Uint16Array(N);
  f.fill(FLOW_UNREACHED);
  const sc = scratch(N, Math.max(1024, N * 3));
  const cost = sc.cost, sol = sc.solid, goal = sc.goal, heads = sc.heads;
  if (smash) hostileCosts(s, side, cost, sol);
  else { const wc = s.rt.walkCost; for (let i = 0; i < N; i++) { const c = stepCost(wc[i], side); cost[i] = c; sol[i] = c === 0 ? 1 : 0; } }
  let tile = sc.tile, next = sc.next, cap = tile.length;
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
      let nd = cur + enter;
      if (nd < FLOW_UNREACHED) {
        if (cost[n] !== 0 && nd < f[n]) { f[n] = nd; const bb = nd & BMASK; tile[used] = n; next[used] = heads[bb]; heads[bb] = used; used++; count++; }
        if (cost[e2] !== 0 && nd < f[e2]) { f[e2] = nd; const bb = nd & BMASK; tile[used] = e2; next[used] = heads[bb]; heads[bb] = used; used++; count++; }
        if (cost[so] !== 0 && nd < f[so]) { f[so] = nd; const bb = nd & BMASK; tile[used] = so; next[used] = heads[bb]; heads[bb] = used; used++; count++; }
        if (cost[we] !== 0 && nd < f[we]) { f[we] = nd; const bb = nd & BMASK; tile[used] = we; next[used] = heads[bb]; heads[bb] = used; used++; count++; }
      }
      nd = cur + dg;
      if (nd < FLOW_UNREACHED) {
        const on = !sol[n], oe = !sol[e2], os = !sol[so], ow = !sol[we];
        if (on && oe) { const j = n + 1; if (cost[j] !== 0 && nd < f[j]) { f[j] = nd; const bb = nd & BMASK; tile[used] = j; next[used] = heads[bb]; heads[bb] = used; used++; count++; } }
        if (os && oe) { const j = so + 1; if (cost[j] !== 0 && nd < f[j]) { f[j] = nd; const bb = nd & BMASK; tile[used] = j; next[used] = heads[bb]; heads[bb] = used; used++; count++; } }
        if (os && ow) { const j = so - 1; if (cost[j] !== 0 && nd < f[j]) { f[j] = nd; const bb = nd & BMASK; tile[used] = j; next[used] = heads[bb]; heads[bb] = used; used++; count++; } }
        if (on && ow) { const j = n - 1; if (cost[j] !== 0 && nd < f[j]) { f[j] = nd; const bb = nd & BMASK; tile[used] = j; next[used] = heads[bb]; heads[bb] = used; used++; count++; } }
      }
      continue;
    }
    for (let d = 0; d < 8; d++) {
      const nx = tx + DX8[d], ny = ty + DY8[d];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (cost[j] === 0) continue;                                              // a hostile cannot stand there
      if (d >= 4 && (sol[ty * w + nx] || sol[ny * w + tx])) continue;           // no corner cutting
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

/**
 * The neighbour of tile i a hostile should step to (lowest value; ties in DX8 order), or -1.
 * With s given, a diagonal step may not cut the corner of a solid tile (hostile side).
 */
export function flowStep(f, i, s = null) {
  const x = i % W, y = (i / W) | 0;
  const wc = s ? s.rt.walkCost : null;
  let best = -1, bv = f[i];
  for (let d = 0; d < 8; d++) {
    const nx = x + DX8[d], ny = y + DY8[d];
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    const j = ny * W + nx;
    if (f[j] >= bv) continue;
    if (wc && d >= 4 && (stepCost(wc[y * W + nx], SIDE.HOS) === 0 || stepCost(wc[ny * W + x], SIDE.HOS) === 0)) continue;
    bv = f[j]; best = j;
  }
  return best;
}

/** Input stamp: FNV-1a over the hostile cost array (walk costs, wall and door hp bands) and the goal tiles (u32). */
export function flowStamp(s, goals) {
  let h = 0x811c9dc5;
  const sc = scratch(N, 1024);
  const { cost } = hostileCosts(s, SIDE.HOS, sc.cost, sc.solid);
  for (let i = 0; i < N; i++) { h ^= cost[i]; h = Math.imul(h, 0x01000193); }
  for (const g of goals) { h ^= g & 0xffff; h = Math.imul(h, 0x01000193); h ^= g >>> 16; h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** Open map-edge tiles for a hostile, ascending (the dawn retreat's goal). */
export function edgeTiles(s) {
  const out = [], wc = s.rt.walkCost;
  const add = (i) => { if (stepCost(wc[i], SIDE.HOS) !== 0) out.push(i); };
  for (let x = 0; x < W; x++) add(x);
  for (let y = 1; y < H - 1; y++) { add(y * W); add(y * W + W - 1); }
  for (let x = 0; x < W; x++) add((H - 1) * W + x);
  return out;
}
export const onEdge = (i) => { const x = i % W, y = (i / W) | 0; return x === 0 || y === 0 || x === W - 1 || y === H - 1; };

/** Goal tiles for a field goal, ascending: core = the Hearth's footprint (no Hearth: the colonists),
 *  loot and dig = item stacks (Stage 2 refines), edge = the open map edge. */
export function goalTiles(s, goal) {
  const out = [];
  const tileOfCol = (c) => tileOfW(c.y) * W + tileOfW(c.x);
  if (goal === 'core') {
    const hb = s.colony.hearth.id !== null ? s.bld[s.colony.hearth.id] : null;
    if (hb) for (const i of footprint(s, hb)) out.push(i);
    else for (const c of s.col) if (!c.hp.dead) out.push(tileOfCol(c));
  } else if (goal === 'loot' || goal === 'dig') {
    for (const it of s.items) if (it) out.push(it.y * W + it.x);
  } else if (goal === 'people') {
    for (const c of s.col) if (!c.hp.dead) out.push(tileOfCol(c));
  } else if (goal === 'edge') {
    for (const i of edgeTiles(s)) out.push(i);
  }
  if (!out.length) out.push(((H >> 1) * W) + (W >> 1));
  return [...new Set(out)].sort((a, b) => a - b);
}

export const fieldFor = (s, goal) => { for (const fl of s.rt.flow) if (fl.goal === goal) return fl; return null; };
/** The field goal a raid walks now: its goal, or 'edge' while it retreats. */
export const fieldGoalOf = (r) => (r.stage === 'retreat' ? 'edge' : r.goal);

/** Goals needed now: those of raids from 'sighted' to 'retreat' (a retreating raid wants 'edge'), in
 *  FIELD_GOALS order, at most CAPS.flowFields. The 'people' goal has no field: it uses A* per pack
 *  leader (9.3). */
export function liveGoals(s) {
  const want = [];
  for (const g of FIELD_GOALS) if (s.raids.some((r) => r.stage !== 'warned' && r.stage !== 'ended' && fieldGoalOf(r) === g)) want.push(g);
  return want.slice(0, bal('caps').flowFields || 3);
}

/** (Re)build one field now. */
export function rebuildField(s, fl) {
  const goals = goalTiles(s, fl.goal);
  fl.stamp = flowStamp(s, goals);
  fl.f = buildFlowField(s, goals, SIDE.HOS, fl.f, true);
  fl.built = s.tick;
  return fl;
}

/** Tick system (slot 'raids', after raid stages): keep the live set and rebuild on its slot tick. */
export function flowSystem(s) {
  if (!raidLive(s)) { if (s.rt.flow.length) s.rt.flow = []; return; }
  const want = liveGoals(s);
  const kept = s.rt.flow.filter((fl) => want.includes(fl.goal));
  for (const g of want) if (!kept.some((fl) => fl.goal === g)) kept.push(rebuildField(s, { goal: g, slot: GOAL_SLOT[g], built: -1, stamp: 0, f: null }));
  kept.sort((a, b) => FIELD_GOALS.indexOf(a.goal) - FIELD_GOALS.indexOf(b.goal));
  s.rt.flow = kept;
  for (const fl of kept) {
    if (s.tick % REBUILD_EVERY !== fl.slot % REBUILD_EVERY || fl.built === s.tick) continue;
    const goals = goalTiles(s, fl.goal);
    if (flowStamp(s, goals) !== fl.stamp) rebuildField(s, fl);
  }
}

/**
 * Route preview (9.4 Sighted): the tiles from a raid's edge tile down its goal field to the goal,
 * at most `max` steps; [] when the field is not built yet or the edge cannot reach the goal.
 */
export function routeTiles(s, raid, max = 400) {
  const fl = fieldFor(s, raid.goal);
  if (!fl || !raid.edge) return [];
  let i = raid.edge.i;
  if (fl.f[i] === FLOW_UNREACHED) return [];
  const out = [i];
  for (let k = 0; k < max && fl.f[i] > 0; k++) {
    const j = flowStep(fl.f, i, s);
    if (j < 0) break;
    out.push(j); i = j;
  }
  return out;
}
