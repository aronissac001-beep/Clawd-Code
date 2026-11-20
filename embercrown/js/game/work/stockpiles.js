// Stockpiles: zone filters, filter groups, zone distance fields and per-zone free lists (doc 5.6,
// 12.3, 13.3; owner E).
//
//   rt.zoneFree  { rank: Int32Array(N), lists: [{ id, cells: [tile...] }] }
//                rank[i] is the fill order of storage-zone tile i (-1 elsewhere): Chebyshev distance
//                from the zone's door side (the zone tile nearest the Hearth), ties by tile index.
//                lists[] (by zone id) hold the zone's FREE cells (no stack, no building, open ground)
//                sorted by rank. Kept exact incrementally: the item API reports every tile that gains
//                or loses its stack (items.setCellHook), buildings report through BUS.placed /
//                BUS.removed, terrain through B's onTileWrite. Zone edits rebuild it.
//   rt.zoneField [Group]  per filter group (zones with the same filter and priority; at most
//                WORK.zoneGroups, extra filters join the closest group): { key, pri, filter, zones,
//                open }. open lists the group's zones that still have a free cell (C13 end-of-tick).
//                Stage Z1 (E5, F25): the zone DISTANCE FIELDS are gone (they cost 2.5 ms each at D = 20
//                and needed a cap). A haul ranks the open zones by B's region-graph distance
//                (regionDist, 3D, from the cached link Dijkstra: a pure cache) from the stack to each
//                zone's first free cell, nearest first; the rt key keeps its name until A retires it.
// Filling one cell only shrinks a free list; the groups are rebuilt (end of tick, rt.dirty.zoneFields)
// only when a zone's list becomes empty or stops being empty, or a zone is edited.
// Zones may span levels (4.4): a zone's fill order is its Chebyshev distance from the anchor plus two
// per level of difference (PATH.VERT is 2 tiles).
//
// Stage 2 additions
//   Filters are a tree (5.6): { cats, mats, q } plus optional x (excluded categories), k (extra item
//   kinds) and xk (excluded item kinds). The most specific entry wins: an excluded kind, then an
//   allowed kind, then the nearest category up the item's chain that is listed in cats or x.
//   Storage buildings (defs with `store`: shelves, racks, the granary, the armoury rack; items.js
//   holds several stacks per tile on them):
//     - on a stockpile tile, a building takes the zone's filter and priority, narrowed by its own
//       store.cats (an armoury rack in an 'All' stockpile still holds only weapons, armour, apparel);
//     - off any stockpile it is storage of its own: its store.cats (or the 'All' preset) at
//       Preferred when it names categories (racks and storehouses) and Normal when it does not
//       (a plain shelf);
//     - an INPUT SHELF (5.6 "Haul ingredients here"): a shelf off any stockpile, beside a workbench,
//       is linked to it (b.link, saved; set when either is finished) and takes exactly the
//       ingredients of the bench's wanted bills, at Preferred. Crafters fetch from the nearest stack
//       to the bench, so the walk to the store room goes away.
//     rt.idx.stores lists the finished storage buildings (ids ascending); findDest compares the best
//     zone cell (the field, as before) with the best storage-building cell by priority, then by
//     region-graph distance.

import { W, H, N, idx, tx, ty, tz, DX8, DY8, TER_PASSABLE } from '../core/grid.js';
import { registerRebuild } from '../core/rtcontract.js';
import { registerEndOfTick, BUS } from '../core/bus.js';
import { zoneById, bldById } from '../core/state.js';
import { def, structDef } from '../core/content.js';
import { onTileWrite, compOf } from '../world/terrain.js';
import { linkRow, linkH } from '../world/regions.js';
import { footprint } from '../world/pass.js';
import { WORK, keyTile, isReserved } from './jobs.js';
import { categoryOf, stackLimit, setCellHook, getItem, capAt, countOn, stacksOn, storeBldAt, storeCapOf, setRemoving, take, put, putAt, withZoneEdit } from './items.js';
import { registerIdxPart } from './jobs.js';
import { registerApplier } from '../core/commands.js';
import { SLICE_APPLIERS } from '../core/apply.js';

/** Zone types that store items. */
export const STORAGE = Object.freeze(['stockpile', 'dump']);
export const isStorage = (z) => !!z && STORAGE.includes(z.type);
/** Priorities (zone.pri): Low 0, Normal 1, Preferred 2, Critical 3. */
export const PRI = Object.freeze({ LOW: 0, NORMAL: 1, PREFERRED: 2, CRITICAL: 3 });

// ---- Filters ---------------------------------------------------------------------------------------
const ancestors = new Map();
/** A category and its parents ('wood' -> ['wood', 'raw']), from G's itemCat tree. */
export function catChain(cat) {
  let a = ancestors.get(cat);
  if (a) return a;
  a = [];
  let c = cat, guard = 0;
  while (c && guard++ < 8) { a.push(c); const d = def('itemCat', c); c = d && d.parent ? d.parent : null; }
  ancestors.set(cat, a);
  return a;
}
/**
 * Does a zone filter { cats, mats, q, x?, k?, xk? } accept stack (or bundle) it? (the tree rule above)
 */
export function filterAccepts(f, it) {
  if (!f) return false;
  if (f.xk && f.xk.includes(it.k)) return false;
  let ok = !!(f.k && f.k.includes(it.k));
  if (!ok) {
    const chain = catChain(categoryOf(it.k));
    for (const c of chain) {
      if (f.x && f.x.includes(c)) return false;
      if (f.cats.includes(c)) { ok = true; break; }
    }
  }
  if (!ok) return false;
  if (f.mats && f.mats.length && !f.mats.includes(it.m)) return false;
  const q = it.q | 0;
  if (f.q && (q < f.q[0] || q > f.q[1])) return false;
  return true;
}
export const zoneAccepts = (z, it) => isStorage(z) && filterAccepts(z.filter, it);
/** Category list test (store.cats): the item's chain meets the list. */
const inCats = (cats, it) => { for (const c of catChain(categoryOf(it.k))) if (cats.includes(c)) return true; return false; };

// ---- Storage buildings ----------------------------------------------------------------------------------
const ALL_CATS = () => { const p = def('zonePreset', 'all'); return p ? p.cats : ['raw', 'materials', 'food']; };
/** The workbench an input shelf feeds (b.link), or null. */
export function inputBench(s, b) {
  if (!b || b.link === null || b.link === undefined) return null;
  const w = bldById(s, b.link);
  return w && w.st === 'done' && structDef(w.def) && structDef(w.def).workbench ? w : null;
}
/** Ingredient filters of a bench's bills that still want making: [{ k } | { cat }]. */
export function benchIngredients(s, w) {
  const out = [];
  for (const bl of w.bills || []) {
    if (bl.paused) continue;
    const r = def('recipe', bl.recipe);
    if (!r) continue;
    for (const ing of r.in || []) if (!out.some((o) => o.k === ing.k && o.cat === ing.cat)) out.push({ k: ing.k, cat: ing.cat });
  }
  return out;
}
const ingAccepts = (ings, it) => ings.some((g) => (g.k ? g.k === it.k : inCats([g.cat], it)));
/** Is tile i a storage-building tile off any storage zone? */
const ownTile = (s, i) => { const z = s.L.zone[i]; return !z || !isStorage(zoneById(s, z)); };
/**
 * The storage rule of a storage-building tile off any stockpile: { pri, ok(it) }. Input shelves take
 * their bench's ingredients; racks their store.cats; plain shelves the 'All' preset.
 */
export function ownRule(s, b) {
  const d = structDef(b.def), st = d.store;
  const w = inputBench(s, b);
  if (w) { const ings = benchIngredients(s, w); return { pri: PRI.PREFERRED, ok: (it) => !it.f && ingAccepts(ings, it) }; }
  if (st.cats && st.cats.length) return { pri: PRI.PREFERRED, ok: (it) => !it.f && inCats(st.cats, it) };
  const cats = ALL_CATS();
  return { pri: PRI.NORMAL, ok: (it) => !it.f && inCats(cats, it) };
}
/** Does the storage building's own category list (if any) let stack `it` onto its tiles? */
const storeCatsOk = (b, it) => { const st = structDef(b.def).store; return !st.cats || !st.cats.length || inCats(st.cats, it); };

/** Priority stack `it` has where it lies (a storage zone or storage building that accepts it), else -1. */
export function curPri(s, it) {
  const i = idx(it.x, it.y, it.z | 0);
  const b = s.rt.occ[i] >= 0 ? storeBldAt(s, i) : null;
  const zid = s.L.zone[i];
  if (zid) {
    const z = zoneById(s, zid);
    if (isStorage(z)) return zoneAccepts(z, it) && (!b || storeCatsOk(b, it)) ? z.pri : -1;
  }
  if (b) { const r = ownRule(s, b); return r.ok(it) ? r.pri : -1; }
  return -1;
}
/** Can a zone cell i take stack `it` (a storage building on it narrows the zone filter)? */
const zoneCellOk = (s, i, it) => { const b = s.rt.occ[i] >= 0 ? storeBldAt(s, i) : null; return !b || storeCatsOk(b, it); };

// ---- Free cells ---------------------------------------------------------------------------------------
/**
 * A storage cell that can take a new stack: open ground with no building and no stack, or a storage
 * building's tile with a slot left (`ignoreBld`: that building counts as gone).
 */
export function cellFree(s, i, ignoreBld = -1) {
  if (ignoreBld >= 0) setRemoving(ignoreBld);
  const free = countOn(s, i) < capAt(s, i);
  if (ignoreBld >= 0) setRemoving(-1);
  return free;
}
function hearthAt(s) {
  const h = s.colony.hearth;
  const b = h && h.id !== null ? bldById(s, h.id) : null;
  return b ? [b.x + 1, b.y + 1, b.z | 0] : [W >> 1, H >> 1, 0];
}
/** Tiles of every storage zone: Map zoneId -> sorted tile list (scan order). */
function storageTiles(s) {
  const byId = new Map();
  for (const z of s.zones) if (isStorage(z)) byId.set(z.id, []);
  const L = s.L.zone;
  for (let i = 0; i < N; i++) { const z = L[i]; if (z) { const a = byId.get(z); if (a) a.push(i); } }
  return byId;
}
/** From-scratch rt.zoneFree (C13 rebuild). */
export function rebuildZoneFree(s) {
  const rank = new Int32Array(N).fill(-1), lists = [];
  const [hx, hy, hz] = hearthAt(s);
  const byId = storageTiles(s);
  const ids = [...byId.keys()].sort((a, b) => a - b);
  for (const id of ids) {
    const tiles = byId.get(id);
    if (!tiles.length) { lists.push({ id, cells: [] }); continue; }
    let anchor = tiles[0], ad = Infinity;
    for (const i of tiles) { const dx = tx(i) - hx, dy = ty(i) - hy, dz = 2 * (tz(i) - hz), d = dx * dx + dy * dy + dz * dz; if (d < ad) { ad = d; anchor = i; } }
    const ax = tx(anchor), ay = ty(anchor), az = tz(anchor);
    const order = tiles.map((i) => [Math.max(Math.abs(tx(i) - ax), Math.abs(ty(i) - ay)) + 2 * Math.abs(tz(i) - az), i]);
    order.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    for (let k = 0; k < order.length; k++) rank[order[k][1]] = k;
    const cells = [];
    for (const [, i] of order) if (cellFree(s, i)) cells.push(i);
    lists.push({ id, cells });
  }
  return { rank, lists };
}
const listOf = (s, zid) => { const l = s.rt.zoneFree.lists; for (let k = 0; k < l.length; k++) if (l[k].id === zid) return l[k]; return null; };
/** Free cells of a zone in fill order (read only), or []. */
export const freeCells = (s, zid) => { const l = listOf(s, zid); return l ? l.cells : []; };

/** Re-derive whether storage tile i is free (after its stack, building or terrain changed). */
export function cellChanged(s, i, ignoreBld = -1) {
  const zf = s.rt.zoneFree;
  if (!zf || !zf.rank || zf.rank.length !== N) return;
  const r = zf.rank[i];
  if (r < 0) return;
  const list = listOf(s, s.L.zone[i]);
  if (!list) return;
  const a = list.cells, was = a.length === 0;
  // binary search by rank
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (zf.rank[a[m]] < r) lo = m + 1; else hi = m; }
  const present = a[lo] === i;
  const free = cellFree(s, i, ignoreBld);
  if (free && !present) a.splice(lo, 0, i);
  else if (!free && present) a.splice(lo, 1);
  else return;
  if (was !== (a.length === 0)) s.rt.dirty.zoneFields = true;
}

// ---- Filter groups and distance fields --------------------------------------------------------------
const filterKey = (z) => {
  const f = z.filter || { cats: [], mats: [], q: [0, 6] };
  return `${z.pri}|${[...f.cats].sort().join(',')}|${[...(f.mats || [])].sort().join(',')}|${(f.q || [0, 6]).join(',')}|${(f.x || []).join(',')}|${(f.k || []).join(',')}|${(f.xk || []).join(',')}`;
};
/** Groups of storage zones (no fields), in order of their first zone id. */
export function zoneGroups(s) {
  const groups = [];
  const zs = s.zones.filter(isStorage).sort((a, b) => a.id - b.id);
  for (const z of zs) {
    const key = filterKey(z);
    let g = groups.find((x) => x.key === key);
    if (!g && groups.length >= WORK.zoneGroups) {
      // over the cap: join the closest group (same priority first, then the most shared categories)
      let best = null, bs = -1;
      for (const x of groups) {
        const shared = x.filter.cats.filter((c) => z.filter.cats.includes(c)).length;
        const score = (x.pri === z.pri ? 1000 : 0) + shared;
        if (score > bs) { bs = score; best = x; }
      }
      g = best;
    }
    if (!g) {
      const f = z.filter, gf = { cats: [...f.cats].sort(), mats: [...(f.mats || [])].sort(), q: (f.q || [0, 6]).slice() };
      for (const k of ['x', 'k', 'xk']) if (f[k] && f[k].length) gf[k] = [...f[k]].sort();
      g = { key, pri: z.pri, filter: gf, zones: [], open: [] };
      groups.push(g);
    }
    g.zones.push(z.id);
  }
  return groups;
}
let fieldBuilds = 0;
/** Number of end-of-tick zone-group rebuilds so far (tests: filling one cell must not rebuild). Not sim state. */
export const fieldBuildCount = () => fieldBuilds;

/** A group's zones that still have a free cell (zone id order). Z1: no distance field any more (F25). */
function buildField(s, g, free) {
  g.open = g.zones.filter((id) => { const l = free.lists.find((x) => x.id === id); return !!l && l.cells.length > 0; });
}
/** From-scratch rt.zoneField (C13 rebuild): groups and their fields from saved state. */
export function rebuildZoneField(s) {
  const fz = rebuildZoneFree(s);
  const groups = zoneGroups(s);
  for (const g of groups) buildField(s, g, fz);
  return groups;
}
/** The endOfTick 'zoneFields' pass: free lists, then fields. */
export function zoneFieldsPass(s) {
  s.rt.zoneFree = rebuildZoneFree(s);
  const groups = zoneGroups(s);
  for (const g of groups) buildField(s, g, s.rt.zoneFree);
  s.rt.zoneField = groups;
  fieldBuilds++;
}

// ---- Choosing a destination (5.6) ---------------------------------------------------------------------
/** Can a hauler stand on or next to storage tile i at all (X 2.7: the middle of a 3 x 3 granary has
 * only granary around it, so its free slot counted as room nobody could ever fill, and food in the
 * stockpiles "needed a haul" for good)? */
function slotOpen(s, i, comp = -1) {
  const ok = (j) => s.rt.walkCost[j] !== 0 && (comp <= 0 || compOf(s, j, 0) === comp);
  if (ok(i)) return true;
  if (s.rt.walkCost[i] !== 0) return false;
  const x = tx(i), y = ty(i), z = tz(i);
  for (let k = 0; k < 8; k++) { const nx = x + DX8[k], ny = y + DY8[k]; if (nx >= 0 && ny >= 0 && nx < W && ny < H && ok(idx(nx, ny, z))) return true; }
  return false;
}
/** Storage buildings off any stockpile with a free slot that take `it`: [[b, pri]] (idx.stores order). */
function storesFor(s, it) {
  const out = [];
  const ids = s.rt.idx.stores;
  if (!ids) return out;
  // (only slots a hauler could reach from where the stack lies: a strongbox in a sealed vault does not
  // make every coin in the stockpiles "need a haul": X 2.7)
  const comp = it && it.x !== undefined ? compOf(s, idx(it.x, it.y, it.z | 0), 0) : -1;
  for (const id of ids) {
    const b = bldById(s, id);
    if (!b || b.st !== 'done') continue;
    // the rule first (Stage 2.9b): most stacks are not what a granary or strongbox takes, and the room
    // scan below cost every haul candidate a footprint walk (bench: 0.6 ms a haul think on day 30)
    const r = ownRule(s, b);
    if (!r.ok(it)) continue;
    let room = false;
    for (const i of footprint(s, b)) if (ownTile(s, i) && countOn(s, i) < capAt(s, i) && slotOpen(s, i, comp)) { room = true; break; }
    if (room) out.push([b, r.pri]);
  }
  return out;
}
/** Highest priority among storage (zone groups and storage buildings) with room that accepts `it` (-1 none). */
export function bestPri(s, it) {
  let best = -1;
  for (const g of s.rt.zoneField) {
    if (!g.open.length || g.pri <= best) continue;
    if (filterAccepts(g.filter, it) || g.open.some((id) => zoneAccepts(zoneById(s, id), it))) best = g.pri;
  }
  if (s.rt.idx.stores && s.rt.idx.stores.length) for (const [, p] of storesFor(s, it)) if (p > best) best = p;
  return best;
}
/** Should stack `it` move to a better stockpile (5.6 (a) and (b))? */
export const needsHaul = (s, it) => bestPri(s, it) > curPri(s, it);

const mergeable = (a, b) => a.k === b.k && a.m === b.m && a.q === b.q && !a.f && !a.name && !b.name && a.id !== b.id && a.n < stackLimit(a.k);

/**
 * Where to put stack `it` (5.6): the nearest best-priority accepting zone from its group field, then
 * a matching partial stack in that zone, else the zone's first free unreserved cell. Falls back to a
 * scan of every qualifying zone (region-graph nearest) when the field's zone cannot be reached.
 * Storage buildings off the stockpiles compete at their own priority (nearest first).
 * @returns {{ i: number, zoneId: number, merge: number } | null} i the tile, merge a stack id or -1
 */
export function findDest(s, col, it) {
  const top = bestPri(s, it), cur = curPri(s, it);
  if (top < 0 || top <= cur) return null;
  // the best priority first; when nothing there can be reached from the stack (a strongbox in a
  // sealed vault), the next priority down that still beats where it lies (X 2.7: coins never left
  // the ground while an unreachable strongbox had room)
  for (let p = top; p > cur && p >= 0; p--) { const r = destAt(s, col, it, p); if (r) return r; }
  return null;
}
function destAt(s, col, it, best) {
  const from = idx(it.x, it.y, it.z | 0), comp = compOf(s, from, 0);
  const holder = col ? col.id : -1;
  const usable = (z) => !!z && z.pri === best && zoneAccepts(z, it);
  // a tile is reachable when it, or (for a blocking rack) one of its 8 neighbours, is in our component
  const reach = (ti) => {
    if (compOf(s, ti, 0) === comp) return true;
    if (s.rt.walkCost[ti] !== 0) return false;
    const x = tx(ti), y = ty(ti), z = tz(ti);
    for (let k = 0; k < 8; k++) { const nx = x + DX8[k], ny = y + DY8[k]; if (nx >= 0 && ny >= 0 && nx < W && ny < H && compOf(s, idx(nx, ny, z), 0) === comp) return true; }
    return false;
  };
  const pick = (z) => {
    // a partial stack of the same kind in the zone first (keeps stack counts down)
    const bucket = s.rt.idx.items[it.k];
    let mi = -1, md = Infinity;
    if (bucket) for (const id of bucket) {
      const o = getItem(s, id);
      const ti = idx(o.x, o.y, o.z | 0);
      if (s.L.zone[ti] !== z.id || !mergeable(o, it) || isReserved(s, keyTile(ti), holder) || !reach(ti)) continue;
      const d = Math.abs(o.x - it.x) + Math.abs(o.y - it.y) + 2 * Math.abs((o.z | 0) - (it.z | 0));
      if (d < md) { md = d; mi = o.id; }
    }
    if (mi >= 0) { const o = getItem(s, mi); return { i: idx(o.x, o.y, o.z | 0), zoneId: z.id, merge: mi }; }
    for (const c of freeCells(s, z.id)) if (!isReserved(s, keyTile(c), holder) && zoneCellOk(s, c, it) && reach(c)) return { i: c, zoneId: z.id, merge: -1 };
    return null;
  };
  let out = null, od = Infinity;
  // distance to a cell (a blocking rack's from its nearest open neighbour): the link heuristic (see below)
  let row = null;
  const lab = s.rt.region;
  const dist = (ti) => {
    if (comp === 0) return Infinity;
    const one = (j) => (compOf(s, j, 0) !== comp ? Infinity : linkH(row || (row = linkRow(s, from, 0, 0, 0)), lab, j) / 10);
    if (s.rt.walkCost[ti] !== 0) return one(ti);
    let best = Infinity;
    const x = tx(ti), y = ty(ti), z = tz(ti);
    for (let k = 0; k < 8; k++) { const nx = x + DX8[k], ny = y + DY8[k]; if (nx >= 0 && ny >= 0 && nx < W && ny < H && s.rt.walkCost[idx(nx, ny, z)] !== 0) best = Math.min(best, one(idx(nx, ny, z))); }
    return best;
  };
  const offer = (r) => {
    if (!r) return;
    const d = dist(r.i);
    if (d === Infinity && out) return;
    if (!out || d < od || (d === od && r.i < out.i)) { od = d; out = r; }
  };
  // storage buildings at this priority (merge into a partial stack first, else a free slot)
  if (s.rt.idx.stores && s.rt.idx.stores.length) {
    for (const [b, p] of storesFor(s, it)) {
      if (p !== best) continue;
      let r = null;
      for (const i of footprint(s, b)) {
        if (!ownTile(s, i) || isReserved(s, keyTile(i), holder) || !reach(i)) continue;
        for (const id of stacksOn(s, i)) { const o = s.items[id]; if (mergeable(o, it)) { r = { i, zoneId: 0, merge: o.id }; break; } }
        if (r) break;
        if (!r && countOn(s, i) < capAt(s, i)) { r = { i, zoneId: 0, merge: -1 }; break; }
      }
      offer(r);
    }
  }
  // Z1 (F25): the open zones at this priority, nearest first by region-graph distance from the stack to
  // the zone's first free cell (ties: zone id); the first zone with a usable cell wins. The distance is the
  // link heuristic of the stack's cached link Dijkstra (B's linkRow: pure, uncapped): the octile inside a
  // region, else the best link route; on the bot colonies it picks the truly nearest zone (1.00-1.01x the
  // A* optimum) where the centroid regionDist of a D = 1 map picked 1.9-2.4x.
  const zs = [];
  for (const g of s.rt.zoneField) {
    if (g.pri !== best) continue;
    for (const id of g.open) {
      const z = zoneById(s, id);
      if (!usable(z)) continue;
      const cells = freeCells(s, id);
      zs.push([cells.length ? dist(cells[0]) : Infinity, id, z]);
    }
  }
  zs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (const [, , z] of zs) { const r = pick(z); if (r) { offer(r); return out; } }
  return out;
}

// ---- Storage-building index and lifecycle (Stage 2) ------------------------------------------------------
const isStore = (b) => !!b && b.st === 'done' && !!(structDef(b.def) || {}).store;
export function rebuildStoreIndex(s) { const out = []; for (const b of s.bld) if (isStore(b)) out.push(b.id); return out; }
registerIdxPart('stores', rebuildStoreIndex);
function storeIndexSet(s, b, on) {
  const a = s.rt.idx.stores || (s.rt.idx.stores = []);
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < b.id) lo = m + 1; else hi = m; }
  if (on && a[lo] !== b.id) a.splice(lo, 0, b.id);
  else if (!on && a[lo] === b.id) a.splice(lo, 1);
}
const isBench = (b) => !!b && b.st === 'done' && !!(structDef(b.def) || {}).workbench && !(structDef(b.def).workbench.workplace);
const touches = (s, a, b) => {
  const fa = footprint(s, a), fb = footprint(s, b);
  for (const i of fa) for (const j of fb) if (Math.max(Math.abs(tx(i) - tx(j)), Math.abs(ty(i) - ty(j))) <= 1) return true;
  return false;
};
const isShelf = (b) => { const d = structDef(b.def); return !!d && !!d.store && d.kind === 'furniture'; };
/** Link a finished shelf off the stockpiles to the touching workbench with the lowest id (input shelf). */
function linkShelf(s, sh) {
  if (!isShelf(sh) || !footprint(s, sh).every((i) => ownTile(s, i))) return;
  let w = null;
  for (const b of s.bld) if (isBench(b) && touches(s, sh, b)) { w = b; break; }
  if (w && sh.link !== w.id) { sh.link = w.id; s.rt.dirty.zoneFields = true; }
}
function onBuilt(s, b) {
  if (isStore(b)) {
    storeIndexSet(s, b, true);
    for (const i of footprint(s, b)) cellChanged(s, i);
    linkShelf(s, b);
  }
  if (isBench(b)) for (const id of s.rt.idx.stores || []) { const sh = bldById(s, id); if (sh && (sh.link === null || sh.link === undefined)) linkShelf(s, sh); }
}
/** A storage building goes: stacks beyond one per tile spill nearby; the stock follows; links drop. */
function storeRemoved(s, b) {
  const tiles = footprint(s, b);
  // the stock: uncounted as it was (on the building), recounted as plain ground; the building then
  // counts as gone (items.setRemoving) until this hook ends, so the spill sees one slot per tile
  withZoneEdit(s, tiles, () => setRemoving(b.id));
  try {
    for (const i of tiles) {
      while (countOn(s, i) > capAt(s, i)) {
        const ids = stacksOn(s, i);
        const it = s.items[ids[ids.length - 1]];
        const bun = take(s, it.id, it.n);
        if (bun) putAt(s, bun, i);
      }
    }
  } finally { setRemoving(-1); }
  storeIndexSet(s, b, false);
}
// ---- Install ------------------------------------------------------------------------------------------
let offTile = null;
function onPlaced(s, b) { for (const i of footprint(s, b)) cellChanged(s, i); }
function onRemoved(s, b) {
  if (isStore(b)) storeRemoved(s, b);
  for (const i of footprint(s, b)) cellChanged(s, i, b.id);
  // a removed bench frees its input shelves (they become plain shelves)
  if (isBench(b)) for (const id of s.rt.idx.stores || []) { const sh = bldById(s, id); if (sh && sh.link === b.id) { sh.link = null; s.rt.dirty.zoneFields = true; } }
}
function onZoned(s) { s.rt.zoneFree = rebuildZoneFree(s); s.rt.dirty.zoneFields = true; }
function onZoneCfg(s) { s.rt.dirty.zoneFields = true; }

/** Register the rebuilds, the end-of-tick pass and the hooks (idempotent; after resetBus). */
export function installStockpiles() {
  registerRebuild('zoneFree', rebuildZoneFree);
  registerRebuild('zoneField', rebuildZoneField);
  registerEndOfTick('zoneFields', zoneFieldsPass);
  setCellHook((s, i) => cellChanged(s, i));
  const add = (list, fn) => { if (!list.includes(fn)) list.push(fn); };
  add(BUS.placed, onPlaced);
  add(BUS.removed, onRemoved);
  add(BUS.built, onBuilt);
  add(BUS.zoned, onZoned);
  add(BUS.zoneCfg, onZoneCfg);
  // zoneCfg keeps the filter tree (x, k, xk) that A's slice applier would drop (owner applier)
  registerApplier('zoneCfg', zoneCfgApplier);
  if (!offTile) offTile = onTileWrite((s, i, layer) => { if (layer === 'terrain') cellChanged(s, i); });
}
registerRebuild('zoneFree', rebuildZoneFree);
registerRebuild('zoneField', rebuildZoneField);

// ---- The full filter (5.6 "Customise": the category tree) -------------------------------------------------
const listOk = (v, kind) => v === undefined || (Array.isArray(v) && v.length <= 64 && v.every((x) => typeof x === 'string' && !!def(kind, x)));
/** A clean copy of a filter patch, or a reason string. */
export function cleanFilter(f) {
  if (!listOk(f.cats, 'itemCat') || !listOk(f.x, 'itemCat')) return 'unknown category in the filter';
  if (!listOk(f.k, 'item') || !listOk(f.xk, 'item')) return 'unknown item in the filter';
  if (!listOk(f.mats, 'material')) return 'unknown material in the filter';
  const out = { cats: f.cats.slice(), mats: f.mats.slice(), q: f.q.slice() };
  for (const key of ['x', 'k', 'xk']) if (f[key] && f[key].length) out[key] = f[key].slice().sort();
  return out;
}
/** zoneCfg (C3) with the filter tree: A's slice applier, then the tree keys it does not copy. */
function zoneCfgApplier(s, c) {
  let tree = null;
  if (c.patch && c.patch.filter) { tree = cleanFilter(c.patch.filter); if (typeof tree === 'string') return { ok: false, reason: tree }; }
  const r = SLICE_APPLIERS.zoneCfg(s, c);
  if (r && r.ok && tree) { const z = zoneById(s, c.zoneId); z.filter = tree; s.rt.dirty.zoneFields = true; for (const fn of BUS.zoneCfg) fn(s, z); }
  return r;
}
