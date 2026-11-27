// Contract C6 (owner E; reviewers F, H, K; FROZEN at the end of Stage 0, additions only after):
// the item API (doc 5.5, 13.3). No module touches s.items, s.rt.itemAt, s.rt.itemFree,
// s.rt.stock or s.rt.idx.items directly: they go through these functions, which keep every
// cache exact at once (C13 class incremental / derived), so a rebuild from saved state always
// equals the live value.
//
// Model
// - A Stack (schema 'items') lies on one tile: { id, k, m, q, n, x, y, hp, f, age, name?, maker? }.
//   One stack per ground tile. Stage 2 (an addition): a tile of a finished storage building (a def
//   with `store`: shelves, racks, the granary) holds up to storeCap stacks (store.stacks spread over
//   its footprint, rounded up). rt.itemAt[tile] is then the LOWEST stack id on the tile, and the
//   work index part rt.idx.slots { tile: [ids sorted] } lists every tile that holds 2 or more stacks
//   (stacksOn reads both). The stack id is its index in s.items; a new stack takes the LOWEST free index (s.rt.itemFree,
//   kept sorted ascending; trailing free slots are trimmed), so ids after a load match the live game.
// - Carried items are not stacks: take() returns a Bundle { k, m, q, n, hp, age, name, maker }
//   that the job holds in job.carry (saved with the colonist). drop() / put() turn it back into
//   stacks. endJob drops any carry still held, so items are never lost on an interrupt.
// - Colony stock (s.rt.stock, the HUD numbers): totals by kind of non-forbidden stacks on
//   stockpile tiles, updated incrementally here, rebuilt at load, recomputed every 14,400 ticks.
// - Work index (s.rt.idx.items): kind -> stack ids sorted ascending, and '@' + category -> ids.
//   Empty buckets are deleted. s.rt.idx.itemsC: every stack id by 16 x 16 cluster (CW * CH sorted
//   arrays), for the givers' nearest-first ring search (5.3). The other parts of rt.idx
//   (designations, frames, bills) are registered with jobs.registerIdxPart by their owners.
// - Cell hook: stockpiles.js keeps per-zone free-cell lists exact; it is told (setCellHook) every
//   time a tile gains its first stack or loses its last one.
//
// Determinism: integer maths only; buckets are id-sorted arrays; placement scans rings in a
// fixed order; nothing iterates object keys or s.rt.res.

import { idx, tx, ty, tz, inB, N, CLUSTERS, clusterOf, TER_PASSABLE } from '../core/grid.js';
import { newStack } from '../core/schema.js';
import { zoneById, bldById } from '../core/state.js';
import { structDef } from '../core/content.js';
import { registerRebuild } from '../core/rtcontract.js';
import { WORK, keyItem, reservedByOthers, idxParts } from './jobs.js';

// ---- Item definitions (G's js/data/items.js through content.js: setItemDefs) -----------------
/**
 * @typedef {object} ItemDef
 * @property {number} stack   stack limit (1 = unique: weapons, apparel, furniture, art)
 * @property {string} cat     stockpile category id ('wood', 'stone', 'ore', 'blocks', 'meals', ...)
 * @property {number} [mass]  mass per unit (carry capacity, 5.6)
 */
// Stage 0 stub: the 5.5 stack limits for the Stage 1a kinds, used only until content.js installs
// G's data with setItemDefs. Not a tuning table: G's items.js is the source of truth.
const STUB_DEFS = {
  wood: { stack: 75, cat: 'wood', mass: 3 }, stone: { stack: 10, cat: 'stone', mass: 12 },
  block: { stack: 75, cat: 'blocks', mass: 1 }, ore: { stack: 50, cat: 'ore', mass: 1 },
  coal: { stack: 50, cat: 'ore', mass: 1 }, ingot: { stack: 75, cat: 'ingots', mass: 1 },
  meal: { stack: 10, cat: 'meals', mass: 1 }, gem: { stack: 25, cat: 'gems', mass: 1 },
  coins: { stack: 500, cat: 'coins', mass: 0 },
};
const FALLBACK_DEF = Object.freeze({ stack: 75, cat: 'misc', mass: 1 });
let defLookup = (k) => STUB_DEFS[k] || (k.startsWith('ore_') ? STUB_DEFS.ore : null);
/** Install the item-definition lookup: fn(kind) -> ItemDef | null. Call before any colony exists. */
export function setItemDefs(fn) { defLookup = fn; }
/** Definition of a kind (unknown kinds: stack 75, category 'misc'). */
export const itemDef = (k) => defLookup(k) || FALLBACK_DEF;
export const stackLimit = (k) => Math.max(1, itemDef(k).stack | 0);
export const categoryOf = (k) => itemDef(k).cat;

// ---- Read side ----------------------------------------------------------------------------
/** Z1: the voxel index of a stack (or anything with x, y in tiles and an integer z; z 0 at D = 1). */
export const stackTile = (it) => idx(it.x, it.y, it.z | 0);
/** Stack by id, or null. */
export const getItem = (s, id) => (Number.isInteger(id) && id >= 0 && id < s.items.length ? s.items[id] : null);
/** Stack on tile index i (the lowest id when a storage tile holds several), or null. */
export function stackAt(s, i) { const id = s.rt.itemAt[i]; return id >= 0 ? s.items[id] : null; }
const NONE = Object.freeze([]);
/** Ids of every stack on tile i, ascending (read only). */
export function stacksOn(s, i) {
  const sl = s.rt.idx.slots;
  const m = sl ? sl[i] : undefined;
  if (m) return m;
  const id = s.rt.itemAt[i];
  return id >= 0 ? [id] : NONE;
}
/** Number of stacks on tile i. */
export const countOn = (s, i) => { const sl = s.rt.idx.slots; const m = sl ? sl[i] : undefined; return m ? m.length : s.rt.itemAt[i] >= 0 ? 1 : 0; };

// ---- Storage buildings (Stage 2: shelves, racks, storehouses) -----------------------------------
let removingBld = -1;
/** stockpiles.js: treat building id as already gone while BUS.removed runs (its tiles hold 1 stack). */
export function setRemoving(id) { removingBld = id; }
/** The finished storage building on tile i (def.store), or null. */
export function storeBldAt(s, i) {
  const o = s.rt.occ[i];
  if (o < 0 || o === removingBld) return null;
  const b = bldById(s, o);
  if (!b || b.st !== 'done') return null;
  const d = structDef(b.def);
  return d && d.store ? b : null;
}
/** Stacks per tile of a storage def (store.stacks over the footprint, rounded up; at least 1). */
export function storeCapOf(d) {
  const sz = (d && d.size) || [1, 1];
  const n = Math.max(1, (sz[0] | 0) * (sz[1] | 0));
  return Math.max(1, Math.ceil(((d && d.store && d.store.stacks) | 0 || 1) / n));
}
/** How many stacks tile i can hold: 1 on open ground, storeCap on a storage building, 0 elsewhere. */
export function capAt(s, i) {
  if (TER_PASSABLE[s.L.terrain[i]] !== 1) return 0;
  const o = s.rt.occ[i];
  if (o < 0 || o === removingBld) return 1;
  const b = storeBldAt(s, i);
  return b ? storeCapOf(structDef(b.def)) : 0;
}
/** Number of live stacks (the 4,000 cap, 12.1). */
export const liveCount = (s) => s.items.length - s.rt.itemFree.length;
/** Visit every live stack in id order: fn(stack). */
export function forEachItem(s, fn) { const a = s.items; for (let i = 0; i < a.length; i++) if (a[i]) fn(a[i]); }
/** Colony stock of a kind (5.5): non-forbidden units in stockpiles. */
export const totals = (s, k) => s.rt.stock[k] || 0;
/** Colony stock of a kind in one material (iron ingots): a scan of the kind's bucket, same rule as totals. */
export function totalsMat(s, k, m) {
  if (m === null || m === undefined) return totals(s, k);
  const a = s.rt.idx.items[k];
  let n = 0;
  if (a) for (let j = 0; j < a.length; j++) { const it = s.items[a[j]]; if (it.m === m && counts(s, it)) n += it.n; }
  return n;
}
/** The bundle a colonist carries, or null. */
export const carried = (col) => (col.job && col.job.carry) || null;
/** Units of a stack not reserved by others than holder (colonist id; -1 = by anyone). */
export function freeCount(s, id, holder = -1) {
  const it = getItem(s, id);
  if (!it) return 0;
  const r = reservedByOthers(s, keyItem(id), holder);
  return r === Infinity ? 0 : Math.max(0, it.n - r);
}

// ---- Internal cache maintenance ------------------------------------------------------------
function sortedInsert(a, v) {
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < v) lo = m + 1; else hi = m; }
  a.splice(lo, 0, v);
}
function sortedRemove(a, v) {
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < v) lo = m + 1; else hi = m; }
  if (a[lo] === v) a.splice(lo, 1);
}
function bucketAdd(s, name, id) { const b = s.rt.idx.items; (b[name] || (b[name] = [])); sortedInsert(b[name], id); }
function bucketDel(s, name, id) { const b = s.rt.idx.items; const a = b[name]; if (!a) return; sortedRemove(a, id); if (!a.length) delete b[name]; }
function clusterAdd(s, i, id) { const c = s.rt.idx.itemsC; if (c) sortedInsert(c[clusterOf(i)], id); }
function clusterDel(s, i, id) { const c = s.rt.idx.itemsC; if (c) sortedRemove(c[clusterOf(i)], id); }
let cellHook = null;
/** stockpiles.js installs: fn(s, tileIndex) after a tile gained its first stack or lost its last one. */
export function setCellHook(fn) { cellHook = fn; }
/** Stack ids in 16 x 16 cluster c (sorted ascending; read only). */
export const stacksInCluster = (s, c) => s.rt.idx.itemsC[c];

/** Stockpile tile? A zone of type 'stockpile', or (Stage 2) a finished storage building's tile. */
export function inStockpile(s, i) {
  const z = s.L.zone[i];
  if (z) { const zone = zoneById(s, z); if (zone && zone.type === 'stockpile') return true; }
  return s.rt.occ[i] >= 0 && !!storeBldAt(s, i);
}
const counts = (s, it) => !it.f && inStockpile(s, stackTile(it));
function stockAdd(s, k, d) {
  if (!d) return;
  const st = s.rt.stock, v = (st[k] || 0) + d;
  if (v) st[k] = v; else delete st[k];
}

function slots(s) { const ix = s.rt.idx; return ix.slots || (ix.slots = {}); }
/** A stack id joins tile ti (itemAt keeps the lowest id; idx.slots lists tiles with 2+). */
function slotAdd(s, ti, id) {
  const cur = s.rt.itemAt[ti];
  if (cur < 0) { s.rt.itemAt[ti] = id; return; }
  const sl = slots(s);
  const a = sl[ti] || (sl[ti] = [cur]);
  sortedInsert(a, id);
  s.rt.itemAt[ti] = a[0];
}
function slotDel(s, ti, id) {
  const sl = s.rt.idx.slots;
  const a = sl ? sl[ti] : undefined;
  if (!a) { s.rt.itemAt[ti] = -1; return; }
  sortedRemove(a, id);
  s.rt.itemAt[ti] = a.length ? a[0] : -1;
  if (a.length < 2) delete sl[ti];
}
function allocId(s) {
  const f = s.rt.itemFree;
  if (f.length) return f.shift();
  s.items.push(null);
  return s.items.length - 1;
}
function freeId(s, id) {
  s.items[id] = null;
  const f = s.rt.itemFree;
  if (id === s.items.length - 1) {
    s.items.pop();
    while (s.items.length && s.items[s.items.length - 1] === null) { s.items.pop(); f.pop(); }
  } else sortedInsert(f, id);
}

function addStack(s, k, m, q, n, x, y, extra) {
  const id = allocId(s);
  const it = newStack(id, k, m, q, n, x, y, extra);
  s.items[id] = it;
  const ti = stackTile(it);
  slotAdd(s, ti, id);
  bucketAdd(s, k, id); bucketAdd(s, '@' + categoryOf(k), id); clusterAdd(s, ti, id);
  if (counts(s, it)) stockAdd(s, k, n);
  if (cellHook) cellHook(s, ti);
  return it;
}
function removeStack(s, it, notify) {
  if (counts(s, it)) stockAdd(s, it.k, -it.n);
  const ti = stackTile(it);
  slotDel(s, ti, it.id);
  bucketDel(s, it.k, it.id); bucketDel(s, '@' + categoryOf(it.k), it.id); clusterDel(s, ti, it.id);
  freeId(s, it.id);
  if (cellHook) cellHook(s, ti);
  if (notify && goneHandler) goneHandler(s, it.id);
}
let goneHandler = null;
/** reserve.js installs: fn(s, stackId) ends every job holding a claim on a vanished stack. */
export function setStackGoneHandler(fn) { goneHandler = fn; }

// ---- Placement --------------------------------------------------------------------------------
/** Can a stack lie on tile i? (open terrain with no building, or a storage building's tile) */
export function canHold(s, i) { return capAt(s, i) > 0; }
/** Would `b` merge into stack `it`? (same kind, material, quality, forbid state; not unique; room left) */
const mergeable = (it, b, f) => it.k === b.k && it.m === b.m && it.q === b.q && it.f === f && !it.name && !b.name && it.n < stackLimit(it.k);

/** Visit tiles of level z in Chebyshev rings around (x, y), fixed order, up to radius R: fn(i) -> true stops. */
function rings(x, y, z, R, fn) {
  if (inB(x, y, z) && fn(idx(x, y, z))) return;
  for (let r = 1; r <= R; r++) {
    for (let k = -r; k <= r; k++) if (inB(x + k, y - r, z) && fn(idx(x + k, y - r, z))) return;          // top, left to right
    for (let k = -r + 1; k <= r; k++) if (inB(x + r, y + k, z) && fn(idx(x + r, y + k, z))) return;      // right, top to bottom
    for (let k = r - 1; k >= -r; k--) if (inB(x + k, y + r, z) && fn(idx(x + k, y + r, z))) return;      // bottom, right to left
    for (let k = r - 1; k >= -r + 1; k--) if (inB(x - r, y + k, z) && fn(idx(x - r, y + k, z))) return;  // left, bottom to top
  }
}

/**
 * @typedef {object} Bundle  items off the ground (carried, or about to be placed)
 * @property {string} k  @property {string|null} m  @property {number} q  @property {number} n
 * @property {number} hp  @property {number} age  @property {string|null} name  @property {number|null} maker
 */
export const makeBundle = (k, m = null, q = 0, n = 1, extra = {}) => ({ k, m, q, n, hp: 100, age: 0, name: null, maker: null, ...extra });

/**
 * Put a bundle on the ground at (x, y) of level z (opts.z, default 0: the D = 1 level): merge into a
 * matching stack with room, else start a new stack, spilling outward in rings (WORK.spillRadius) over
 * tiles of that level that can hold items. `b.n` is reduced by what was placed (> 0 afterwards only if
 * no room was found).
 * @returns {number} id of the first stack that received items, or -1
 */
export function put(s, b, x, y, { f = false, z = 0 } = {}) {
  let first = -1;
  const lim = stackLimit(b.k);
  z |= 0;
  rings(x, y, z, WORK.spillRadius, (i) => {
    const cap = capAt(s, i);
    if (cap <= 0) return false;
    const ids = stacksOn(s, i);
    for (let j = 0; j < ids.length && b.n > 0; j++) {
      const cur = s.items[ids[j]];
      if (!mergeable(cur, b, f)) continue;
      const add = Math.min(b.n, lim - cur.n);
      // age (rot): the merged stack takes the units' average age, so a fresh harvest freshens a store
      if (b.age !== cur.age) cur.age = Math.floor((cur.age * cur.n + b.age * add) / (cur.n + add));
      cur.n += add;
      if (counts(s, cur)) stockAdd(s, cur.k, add);
      b.n -= add;
      if (first < 0) first = cur.id;
    }
    // new stacks while the tile has room (a ground tile: one, when it is empty)
    while (b.n > 0 && countOn(s, i) < cap) {
      const add = Math.min(b.n, lim);
      const it = addStack(s, b.k, b.m, b.q, add, tx(i), ty(i), { hp: b.hp, age: b.age, f, name: b.name, maker: b.maker, z });
      b.n -= add;
      if (first < 0) first = it.id;
    }
    return b.n <= 0;
  });
  return first;
}

/**
 * Create items at (x, y) (mined stone, a crafted product, a refund). Merges and spills like put().
 * @param {object} s @param {string} k kind @param {string|null} m material @param {number} q quality 0-5
 * @param {number} n count @param {number} x @param {number} y tile
 * @param {{f?: boolean, hp?: number, age?: number, name?: string|null, maker?: number|null}} [opts]
 * @returns {number} id of the first stack that received items, or -1 (no room within the spill radius)
 */
export function spawn(s, k, m, q, n, x, y, opts = {}) {
  if (!(n > 0) || !Number.isInteger(n)) throw new Error(`items.spawn: bad count ${n}`);
  const b = makeBundle(k, m, q, n, { hp: opts.hp ?? 100, age: opts.age ?? 0, name: opts.name ?? null, maker: opts.maker ?? null });
  return put(s, b, x, y, { f: !!opts.f, z: opts.z | 0 });
}
/** put() at voxel index i (Z1: the level is the voxel's). */
export const putAt = (s, b, i, opts = {}) => put(s, b, tx(i), ty(i), { ...opts, z: tz(i) });
/** spawn() at voxel index i (Z1: the level is the voxel's). */
export const spawnAt = (s, k, m, q, n, i, opts = {}) => spawn(s, k, m, q, n, tx(i), ty(i), { ...opts, z: tz(i) });

/**
 * Take up to n units off stack `id` (never more than are free of other holders' claims when
 * `holder` is given). The stack shrinks or vanishes (its slot is freed; jobs that still claim it
 * end with 'targetGone').
 * @returns {Bundle|null} the items taken, or null when nothing could be taken
 */
export function take(s, id, n, holder = null) {
  const it = getItem(s, id);
  if (!it || !(n > 0)) return null;
  const can = holder === null ? it.n : Math.min(it.n, freeCount(s, id, holder));
  const got = Math.min(n, can);
  if (got <= 0) return null;
  const b = makeBundle(it.k, it.m, it.q, got, { hp: it.hp, age: it.age, name: it.name, maker: it.maker });
  if (got === it.n) removeStack(s, it, true);
  else { it.n -= got; if (counts(s, it)) stockAdd(s, it.k, -got); }
  return b;
}

/** Use up n units in place (a bench consuming ingredients, fire, rot). @returns {number} units consumed */
export function consume(s, id, n) { const b = take(s, id, n); return b ? b.n : 0; }

/** Remove a whole stack (destroyed, buried, despawned). Jobs claiming it end with 'targetGone'. */
export function destroy(s, id) { const it = getItem(s, id); if (it) removeStack(s, it, true); return !!it; }

/**
 * Put down everything the colonist carries at (x, y) (default: its own tile). The job's carry
 * becomes null (or keeps what did not fit, which is then lost only if no tile within the spill
 * radius had room).
 * @returns {number} id of the first stack that received items, or -1
 */
export function drop(s, col, x, y, z = col.z | 0) {
  const b = carried(col);
  if (!b) return -1;
  const id = put(s, b, x, y, { z });
  if (b.n <= 0) col.job.carry = null;
  return id;
}

/** Add a bundle to a colonist's carry (pickup; topping up with the same kind, material, quality). */
export function addCarry(col, b) {
  const c = col.job.carry;
  if (!c) { col.job.carry = b; return true; }
  if (c.k !== b.k || c.m !== b.m || c.q !== b.q || c.name || b.name) return false;
  if (b.age !== c.age) c.age = Math.floor((c.age * c.n + b.age * b.n) / (c.n + b.n));
  c.n += b.n;
  return true;
}

/** Forbid or allow a stack (5.6). */
export function setForbidden(s, id, on) {
  const it = getItem(s, id);
  if (!it || it.f === !!on) return false;
  const was = counts(s, it);
  it.f = !!on;
  const now = counts(s, it);
  if (was !== now) stockAdd(s, it.k, now ? it.n : -it.n);
  return true;
}

/**
 * Stockpile edits (stockpiles.js): run `fn` (which changes s.L.zone or zone types for `tiles`)
 * with the stock kept exact: stacks on those tiles are uncounted before and recounted after.
 */
let zoneEdits = 0;
/** How many zone edits ran in this process (stockpiles.js keys its per-tick full-store memo on it; never saved). */
export const zoneEditCount = () => zoneEdits;
export function withZoneEdit(s, tiles, fn) {
  const each = (d) => { for (const i of tiles) for (const id of stacksOn(s, i)) { const it = s.items[id]; if (counts(s, it)) stockAdd(s, it.k, d * it.n); } };
  each(-1);
  fn();
  zoneEdits++;
  each(1);
}

// ---- Search ---------------------------------------------------------------------------------
/**
 * @typedef {object} ItemFilter
 * @property {string} [k]       kind (or)
 * @property {string} [cat]     category
 * @property {string} [m]       material
 * @property {[number, number]} [q]  quality range, inclusive
 * @property {number} [minN]    at least this many free units
 * @property {boolean} [forbidden]  include forbidden stacks (default false)
 * @property {number} [holder]  colonist id: only stacks with units free of other holders' claims
 * @property {(it: object) => boolean} [pred]  extra test
 */
function bucketFor(s, f) {
  const b = s.rt.idx.items;
  if (f.k) return b[f.k] || null;
  if (f.cat) return b['@' + f.cat] || null;
  throw new Error('items: a filter needs k or cat');
}
function matches(s, it, f, region) {
  if (it.f && !f.forbidden) return false;
  if (f.m !== undefined && f.m !== null && it.m !== f.m) return false;
  if (f.q && (it.q < f.q[0] || it.q > f.q[1])) return false;
  if (f.k && f.cat && categoryOf(it.k) !== f.cat) return false;
  if (f.holder !== undefined || f.minN) {
    const free = freeCount(s, it.id, f.holder === undefined ? -1 : f.holder);
    if (free < (f.minN || 1)) return false;
  }
  if (region !== null && region !== undefined) {
    const i = stackTile(it);
    if (typeof region === 'function' ? !region(i) : s.rt.region[i] !== region) return false;
  }
  return !f.pred || f.pred(it);
}
/** from: a tile index; distance: squared straight distance in tiles (a level counts as 2 tiles, PATH.VERT); ties: lower id. */
const d2 = (fx, fy, it, fz = 0) => (it.x - fx) * (it.x - fx) + (it.y - fy) * (it.y - fy) + 4 * ((it.z | 0) - fz) * ((it.z | 0) - fz);

/**
 * Nearest matching stack to tile `from`. `region`: null (anywhere), a colonist region label
 * (s.rt.region value; B's labels), or fn(tileIndex) -> boolean. Straight distance; job ranking by
 * region-graph distance is think.js's (5.3).
 * @returns {object|null} the stack
 */
export function findNearest(s, filter, from, region = null) {
  const a = bucketFor(s, filter);
  if (!a) return null;
  const fx = tx(from), fy = ty(from), fz = tz(from);
  let best = null, bd = Infinity;
  for (let j = 0; j < a.length; j++) {
    const it = s.items[a[j]];
    const d = d2(fx, fy, it, fz);
    if (d < bd && matches(s, it, filter, region)) { best = it; bd = d; }
  }
  return best;
}

/** Up to k nearest matching stacks, nearest first (ties by id): the givers' candidates(). */
export function candidates(s, filter, from, region = null, k = WORK.candidatesK) {
  const a = bucketFor(s, filter);
  if (!a) return [];
  const fx = tx(from), fy = ty(from), fz = tz(from);
  const out = [];
  for (let j = 0; j < a.length; j++) {
    const it = s.items[a[j]];
    if (matches(s, it, filter, region)) out.push([d2(fx, fy, it, fz), it.id]);
  }
  out.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const res = [];
  for (let j = 0; j < out.length && j < k; j++) res.push(s.items[out[j][1]]);
  return res;
}

// ---- Rebuilds (C13: initRuntime at load; the gate's check (e)) -------------------------------
export function rebuildItemAt(s) {
  const a = new Int32Array(N).fill(-1);
  for (const it of s.items) if (it) { const i = stackTile(it); if (a[i] < 0) a[i] = it.id; }   // the lowest id
  return a;
}
/** rt.idx.slots from scratch: tiles holding 2 or more stacks -> ids ascending. */
export function rebuildSlots(s) {
  const per = new Map();
  for (const it of s.items) if (it) { const i = stackTile(it); const a = per.get(i); if (a) a.push(it.id); else per.set(i, [it.id]); }
  const out = {};
  for (const [i, a] of per) if (a.length > 1) out[i] = a;
  return out;
}
export function rebuildItemFree(s) {
  const f = [];
  for (let i = 0; i < s.items.length; i++) if (s.items[i] === null) f.push(i);
  return f;
}
export function rebuildItemIndex(s) {
  const items = {};
  const itemsC = [];
  for (let c = 0; c < CLUSTERS; c++) itemsC.push([]);   // Z1: 16 x 16 x 1 clusters on every level
  for (const it of s.items) {
    if (!it) continue;
    for (const name of [it.k, '@' + categoryOf(it.k)]) (items[name] || (items[name] = [])).push(it.id);
    itemsC[clusterOf(stackTile(it))].push(it.id);
  }
  // The other parts (designations, frames, bills, ...) come from their owners (jobs.registerIdxPart);
  // parts nobody registered yet stay empty, as in Stage 0.
  const out = { desig: [], items, itemsC, slots: rebuildSlots(s), frames: [], bills: [], plants: [], patients: [] };
  for (const [name, fn] of idxParts()) out[name] = fn(s);
  return out;
}
export function rebuildStock(s) {
  const st = {};
  for (const it of s.items) if (it && counts(s, it)) st[it.k] = (st[it.k] || 0) + it.n;
  for (const k of Object.keys(st)) if (!st[k]) delete st[k];
  return st;
}
/** Deterministic full recompute (every WORK.stockRecompute ticks; 13.3). */
export function recomputeStock(s) { s.rt.stock = rebuildStock(s); }

/** Consistency check for tests and debug builds: null or the first problem found. */
export function checkItems(s) {
  for (let i = 0; i < s.items.length; i++) {
    const it = s.items[i];
    if (!it) continue;
    if (it.id !== i) return `items[${i}].id ${it.id}`;
    if (!(it.n >= 1 && it.n <= stackLimit(it.k))) return `items[${i}] count ${it.n} (limit ${stackLimit(it.k)})`;
    if (!inB(it.x, it.y, it.z | 0) || !stacksOn(s, stackTile(it)).includes(i)) return `items[${i}] not indexed at its tile`;
  }
  if (s.items.length && s.items[s.items.length - 1] === null) return 'trailing free slot not trimmed';
  return null;
}

// ---- Falling (Z1, 2.3): B's onFall hook hands every stack in a voxel that lost its floor ----------
/**
 * Stack `id` falls to voxel `to`, losing `hpPct` percent points of hp (25 per level). It is taken whole
 * (jobs claiming it end with 'targetGone') and put down at `to` (merging and spilling there as put does);
 * at hp 0 or below it is destroyed. Returns the id of the first stack that received it, or -1.
 */
export function fallStack(s, id, to, hpPct = 0) {
  const it = getItem(s, id);
  if (!it) return -1;
  const b = take(s, id, it.n);
  if (!b) return -1;
  b.hp = (b.hp | 0) - (hpPct | 0);
  if (b.hp <= 0) return -1;
  return putAt(s, b, to, { f: it.f });
}
/** The onFall hook (installWork registers it with B's terrain API). */
export function onItemFall(s, f) { if (f.kind === 'item' && f.ent) fallStack(s, f.ent.id, f.to, f.hp); }

registerRebuild('itemAt', rebuildItemAt);
registerRebuild('itemFree', rebuildItemFree);
registerRebuild('idx', rebuildItemIndex);
registerRebuild('stock', rebuildStock);
