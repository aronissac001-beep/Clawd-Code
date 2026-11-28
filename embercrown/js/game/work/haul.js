// Hauling (doc 5.6; owner E): which stacks need hauling, and the haul job.
//
// A stack needs hauling when it lies outside any storage zone that accepts it, or in one with a
// lower priority than an accepting zone with free space (stockpiles.needsHaul). Forbidden stacks
// never move. Rough stone (category 'stone') follows the colony setting s.colony.stoneHaul:
// 'needed' (default) and 'never' leave stone piles where they lie (bills and frames fetch stone
// themselves), 'always' hauls them like anything else.
//
// The job: claim the units and the destination tile, walk to the stack, pick up (capacity: 35 mass
// x Might factor), top up with the same kind, material and quality (W0.5: up to TOPUP.stacks more stacks within
// TOPUP.r tiles; was one within 3), carry, store. A stack already in storage is offered to haulers while it is on the
// hourly audit's wait list (W0.5), so the giver's scan does not test every stored stack against every store.

import { winchRoute, winchEnd } from '../colony/verbs/winch.js';
import { idx, tx, ty, tz } from '../core/grid.js';
import { emit } from '../core/events.js';
import { NEXT, T, makeJob, registerToil, keyItem, keyTile, WORK, isUnreachable } from './jobs.js';
import { getItem, categoryOf, stackLimit, freeCount, stackAt, carried, drop, countOn, capAt } from './items.js';
import { colTile } from './reserve.js';
import { needsHaul, findDest, curPri, filterAccepts, zoneAccepts, ownRule, PRI } from './stockpiles.js';
import { zoneById, bldById } from '../core/state.js';
import { capUnits } from './construct.js';
import { reachableFrom, distTo } from './windex.js';
import { workRec } from './filth.js';
import { TICKS_PER_HOUR } from '../core/time.js';
import { worldStage2 } from '../world/worldrec.js';

/** The colony's rough-stone hauling setting: 'never' | 'needed' | 'always'. */
export const stoneMode = (s) => (s.colony && s.colony.stoneHaul) || 'needed';
const isStone = (it) => categoryOf(it.k) === 'stone';

/** Could col haul stack `it` now (before choosing a destination)? */
export function haulable(s, col, it) {
  if (!it || it.f) return false;
  if (isStone(it) && stoneMode(s) !== 'always') return false;
  // (PERF) inside a haul giver's scan, a kind, material and quality already found to need no haul from the ground
  // needs none anywhere (see scanHauls): the scan's 1,500 unstorable ground stacks of a full hold stop here
  const m = scanMemo ? memoGet(it) : undefined;
  if (m === false) return false;
  if (freeCount(s, it.id, col.id) <= 0) return false;
  const i = idx(it.x, it.y, it.z | 0);
  if (isUnreachable(s, col, keyItem(it.id)) || !reachableFrom(s, col, i)) return false;
  // (W0.5) a stack already in storage moves on to a better store on the hourly audit's word (it is on the wait list):
  // the haul giver's scan of up to WORK.scanMax stacks per think tested every stored stack against every store (the
  // granary's footprint walk for each stack of food in a stockpile), and those thinks were the tick p95 spikes
  const cur = curPri(s, it);
  if (worldStage2() && cur >= 0 && !onWaitList(s, it)) return false;
  if (!scanMemo || cur >= 0) return quickAt(s, it, cur);
  if (m !== undefined) return m;
  const v = quickAt(s, it, cur);
  memoSet(it, v);
  return v;
}

// ---- The scan memo (PERF: bot v4 seed 4's tick p95 after day 200) ------------------------------------------------
// A think's haul scan tests up to WORK.scanMax stacks; in a full hold nearly all are ground stacks with nowhere to go,
// and the think ticks were the p95. needsHaulQuick(s, it) at curPri -1 reads of the stack only its kind, material and
// quality (the zone filters, the storage rules: `f` is false here) and its walk component (storesFor's slot reach).
// Within one scan the state is only read and the colonist is fixed, and the memo is filled only from a stack that
// passed reachableFrom (so in the colonist's component). Every stack that could still pass is in that component, and
// the answer only falls as curPri rises (each test is "a priority above curPri"), so a `false` stored for a kind,
// material and quality rejects any alike stack at once, and a ground stack in the component reuses either answer.
// The memo lives for one scan (scanHauls) and nothing of it is saved: haulable's answers are exactly the unmemoized ones.
let scanMemo = null;
/** Run fn() (a haul giver's candidate scan: reads only) with the scan memo on. */
export function scanHauls(fn) {
  const prev = scanMemo;
  scanMemo = new Map();
  try { return fn(); } finally { scanMemo = prev; }
}
function memoGet(it) {
  const a = scanMemo.get(it.k);
  if (!a) return undefined;
  const q = it.q | 0;
  for (let j = 0; j < a.length; j += 3) if (a[j] === it.m && a[j + 1] === q) return a[j + 2];
  return undefined;
}
function memoSet(it, v) {
  let a = scanMemo.get(it.k);
  if (!a) { a = []; scanMemo.set(it.k, a); }
  a.push(it.m, it.q | 0, v);
}
/** Is stack `it` on E's saved haul wait list (s.colony.work.wait, ids ascending; the same kind: ids are reused)? */
function onWaitList(s, it) {
  const w = s.colony.work && s.colony.work.wait;
  if (!w || !w.length) return false;
  let lo = 0, hi = w.length - 1;
  while (lo <= hi) { const m = (lo + hi) >> 1, v = w[m][0]; if (v === it.id) return w[m][2] === it.k; if (v < it.id) lo = m + 1; else hi = m - 1; }
  return false;
}

/**
 * needsHaul(s, it), exactly, without walking the storage buildings' footprints when no storage building could beat
 * where the stack lies (W0.5: the haul giver's scan of up to WORK.scanMax stacks per think spent most of its time in
 * that walk for stacks already stored; the think ticks were the bot's tick p95 spikes). needsHaul is bestPri > curPri:
 * an open zone group above curPri that accepts the stack decides it here; else only a storage building whose own rule
 * ranks above curPri and takes the stack can, and then the full test runs.
 */
export function needsHaulQuick(s, it) { return quickAt(s, it, curPri(s, it)); }
/** needsHaulQuick with curPri(s, it) = cur given. */
function quickAt(s, it, cur) {
  for (const g of s.rt.zoneField) {
    if (!g.open.length || g.pri <= cur) continue;
    if (filterAccepts(g.filter, it) || g.open.some((id) => zoneAccepts(zoneById(s, id), it))) return true;
  }
  const ids = s.rt.idx.stores;
  if (!ids || !ids.length || cur >= PRI.PREFERRED) return false;
  for (const id of ids) {
    const b = bldById(s, id);
    if (!b || b.st !== 'done') continue;
    const r = ownRule(s, b);
    if (r.pri > cur && r.ok(it)) return needsHaul(s, it);
  }
  return false;
}

/** Haul candidate for the givers' collect(): { key, d, id } or null. */
export function haulCandidate(s, col, id) {
  const it = getItem(s, id);
  if (!haulable(s, col, it)) return null;
  return { key: keyItem(id), id, d: distTo(s, col, idx(it.x, it.y, it.z | 0)) };
}

/** Top-ups of one haul (W0.5): radius in tiles on the stack's level, and the most extra stacks. */
export const TOPUP = Object.freeze({ r: 5, stacks: 6 });

/** The haul job for stack `it`, or null when no destination can take it. */
export function haulJob(s, col, it) {
  let dest = findDest(s, col, it);
  if (!dest) return null;
  // Z2.4 the winch (2.3): a haul between the two ends' levels of a winch's shaft drops at the winch end on the
  // stack's level and the winch carries it; a stack already waiting there is left to the winch. A stack the winch
  // landed is hauled on as usual (it never rides back).
  const from = idx(it.x, it.y, it.z | 0);
  const wb = (s.colony.winch || s.bld.some((b) => b && b.def === 'winch')) ? winchRoute(s, from, dest.i) : null;
  const landed = wb ? (s.colony.winch && s.colony.winch.landed[wb.id]) || [] : null;
  if (wb && !landed.includes(it.id)) {
    const end = winchEnd(s, wb, it.z | 0);
    if (end === from) return null;
    if (end >= 0) {
      // (W0.5) only onto a landing that can take the stack; else the hauler takes the stairs to the store itself.
      // Dropped on a taken landing the stack spilled beside it, needed a haul again and was carried back to the
      // landing, for ever (bot v4 seed 2: 10,000 trips in 20 days, a hauler's whole time)
      const o = stackAt(s, end);
      const merge = o && !landed.includes(o.id) && o.k === it.k && o.m === it.m && o.q === it.q && !o.f && !o.name && !it.name && o.n < stackLimit(o.k) ? o.id : -1;
      if (merge >= 0 || countOn(s, end) < capAt(s, end)) dest = { i: end, merge };
    }
  }
  const room = dest.merge >= 0 ? stackLimit(it.k) - getItem(s, dest.merge).n : stackLimit(it.k);
  const want = Math.min(room, capUnits(col, it.k));
  const n = Math.min(want, freeCount(s, it.id, col.id));
  if (n <= 0) return null;
  const toils = [T.goto(idx(it.x, it.y, it.z | 0)), T.pickup(it.id, n)];
  const claims = [[keyItem(it.id), n], [keyTile(dest.i), 0]];
  let got = n;
  if (got < want) {
    // top up (W0.5): same kind, material and quality, also needing a haul, nearest ring first within TOPUP.r tiles
    // on the stack's level, up to TOPUP.stacks more stacks (a field's yields, a felling's logs, a bench's output go
    // in one trip instead of one trip each: the haul queue, and so the wait before a hauler comes, gets shorter)
    const R = Math.max(WORK.topUpR, TOPUP.r), z = it.z | 0;
    let extra = 0;
    outer: for (let r = 1; r <= R; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = it.x + dx, y = it.y + dy;
        if (x < 0 || y < 0 || x >= s.w || y >= s.h) continue;
        const o = stackAt(s, idx(x, y, z));
        if (!o || o.id === it.id || o.k !== it.k || o.m !== it.m || o.q !== it.q || o.f || o.name || it.name) continue;
        const oi = idx(o.x, o.y, o.z | 0);
        if (oi === dest.i || !needsHaulQuick(s, o) || (r > WORK.topUpR && (isUnreachable(s, col, keyItem(o.id)) || !reachableFrom(s, col, oi)))) continue;
        const n2 = Math.min(want - got, freeCount(s, o.id, col.id));
        if (n2 <= 0) continue;
        toils.push(T.goto(oi), T.pickup(o.id, n2));
        claims.push([keyItem(o.id), n2]);
        got += n2;
        if (got >= want || ++extra >= TOPUP.stacks) break outer;
      }
    }
  }
  toils.push(T.carry(dest.i), { t: 'store', i: dest.i });
  return { job: makeJob('haul', keyItem(it.id), toils, { haul: { itemId: it.id, count: got } }), claims };
}

// 'store': put the carry down on tile i (on it or next to it) and report the haul.
registerToil('store', (s, col, job, toil) => {
  if (!carried(col)) return NEXT;
  const ci = colTile(col);
  if (tz(ci) !== tz(toil.i) || Math.max(Math.abs(tx(ci) - tx(toil.i)), Math.abs(ty(ci) - ty(toil.i))) > 1) return 'notThere';
  const id = drop(s, col, tx(toil.i), ty(toil.i), tz(toil.i));
  if (id >= 0) emit(s, 'hauled', { itemId: id, colId: col.id });
  return carried(col) ? 'noRoom' : NEXT;
});

// ---- Stale hauls (Stage 2): nothing waits more than a day while there is room ------------------------------
// Haulers take the nearest stacks first, so with work always near, a stack far away could wait for
// ever. Every hour haulAudit (slot 'jobs') writes the stacks that need a haul into E's saved record
// s.colony.work.wait = [[id, since, kind]] (ids ascending; since = the first audit that saw it waiting).
// The Haul giver offers the ones waiting STALE_H hours or more first, oldest first.
export const STALE_H = 8, URGENT_H = 16;
const waitable = (s, it) => !!it && !it.f && !(isStone(it) && stoneMode(s) !== 'always') && needsHaulQuick(s, it);
export function haulAudit(s) {
  if (!worldStage2() || s.tick % TICKS_PER_HOUR !== 0) return;
  const old = (s.colony.work && s.colony.work.wait) || [];
  const out = [];
  let k = 0;
  for (let id = 0; id < s.items.length; id++) {
    const it = s.items[id];
    while (k < old.length && old[k][0] < id) k++;
    if (!waitable(s, it)) continue;
    const prev = k < old.length && old[k][0] === id && old[k][2] === it.k ? old[k][1] : s.tick;
    out.push([id, prev, it.k]);
  }
  if (out.length || old.length) workRec(s).wait = out;
}
/**
 * Stale stacks (waiting `h` hours or more, default STALE_H), oldest first: [id]. Past URGENT_H the
 * think step (think.js) offers them to anyone with Haul enabled ahead of their other work, so a
 * stack with somewhere to go is stored within a day even when every hauler has work of their own.
 */
export function staleHauls(s, h = STALE_H) {
  const w = s.colony.work && s.colony.work.wait;
  if (!w || !w.length) return [];
  const lim = s.tick - h * TICKS_PER_HOUR;
  return w.filter((e) => e[1] <= lim).sort((a, b) => a[1] - b[1] || a[0] - b[0]).map((e) => e[0]);
}
