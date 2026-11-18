// Hauling (doc 5.6; owner E): which stacks need hauling, and the haul job.
//
// A stack needs hauling when it lies outside any storage zone that accepts it, or in one with a
// lower priority than an accepting zone with free space (stockpiles.needsHaul). Forbidden stacks
// never move. Rough stone (category 'stone') follows the colony setting s.colony.stoneHaul:
// 'needed' (default) and 'never' leave stone piles where they lie (bills and frames fetch stone
// themselves), 'always' hauls them like anything else.
//
// The job: claim the units and the destination tile, walk to the stack, pick up (capacity: 35 mass
// x Might factor), top up with the same kind, material and quality within 3 tiles, carry, store.

import { idx, tx, ty } from '../core/grid.js';
import { emit } from '../core/events.js';
import { NEXT, T, makeJob, registerToil, keyItem, keyTile, WORK, isUnreachable } from './jobs.js';
import { getItem, categoryOf, stackLimit, freeCount, stackAt, carried, drop } from './items.js';
import { colTile } from './reserve.js';
import { needsHaul, findDest } from './stockpiles.js';
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
  if (freeCount(s, it.id, col.id) <= 0) return false;
  const i = idx(it.x, it.y);
  if (isUnreachable(s, col, keyItem(it.id)) || !reachableFrom(s, col, i)) return false;
  return needsHaul(s, it);
}

/** Haul candidate for the givers' collect(): { key, d, id } or null. */
export function haulCandidate(s, col, id) {
  const it = getItem(s, id);
  if (!haulable(s, col, it)) return null;
  return { key: keyItem(id), id, d: distTo(s, col, idx(it.x, it.y)) };
}

/** The haul job for stack `it`, or null when no destination can take it. */
export function haulJob(s, col, it) {
  const dest = findDest(s, col, it);
  if (!dest) return null;
  const room = dest.merge >= 0 ? stackLimit(it.k) - getItem(s, dest.merge).n : stackLimit(it.k);
  const want = Math.min(room, capUnits(col, it.k));
  const n = Math.min(want, freeCount(s, it.id, col.id));
  if (n <= 0) return null;
  const toils = [T.goto(idx(it.x, it.y)), T.pickup(it.id, n)];
  const claims = [[keyItem(it.id), n], [keyTile(dest.i), 0]];
  let got = n;
  if (got < want) {
    // top up: same kind, material, quality within WORK.topUpR, also needing a haul
    const R = WORK.topUpR;
    outer: for (let r = 1; r <= R; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = it.x + dx, y = it.y + dy;
        if (x < 0 || y < 0 || x >= s.w || y >= s.h) continue;
        const o = stackAt(s, idx(x, y));
        if (!o || o.id === it.id || o.k !== it.k || o.m !== it.m || o.q !== it.q || o.f || o.name || it.name) continue;
        if (idx(o.x, o.y) === dest.i || !needsHaul(s, o)) continue;
        const n2 = Math.min(want - got, freeCount(s, o.id, col.id));
        if (n2 <= 0) continue;
        toils.push(T.goto(idx(o.x, o.y)), T.pickup(o.id, n2));
        claims.push([keyItem(o.id), n2]);
        got += n2;
        break outer;   // one top-up stack
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
  if (Math.max(Math.abs(tx(ci) - tx(toil.i)), Math.abs(ty(ci) - ty(toil.i))) > 1) return 'notThere';
  const id = drop(s, col, tx(toil.i), ty(toil.i));
  if (id >= 0) emit(s, 'hauled', { itemId: id, colId: col.id });
  return carried(col) ? 'noRoom' : NEXT;
});

// ---- Stale hauls (Stage 2): nothing waits more than a day while there is room ------------------------------
// Haulers take the nearest stacks first, so with work always near, a stack far away could wait for
// ever. Every hour haulAudit (slot 'jobs') writes the stacks that need a haul into E's saved record
// s.colony.work.wait = [[id, since, kind]] (ids ascending; since = the first audit that saw it waiting).
// The Haul giver offers the ones waiting STALE_H hours or more first, oldest first.
export const STALE_H = 8, URGENT_H = 16;
const waitable = (s, it) => !!it && !it.f && !(isStone(it) && stoneMode(s) !== 'always') && needsHaul(s, it);
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
