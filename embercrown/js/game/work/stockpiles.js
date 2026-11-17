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
//                open, dist: Uint16Array(N) | null, lab: Uint8Array(N) | null }. dist/lab are a
//                multi-source BFS (8-way, over all tiles) from every tile of every zone of the group
//                that still has a free cell; lab is the zone id of the nearest seed. Straight-line
//                geometry on purpose: the field must not depend on walls (it is rebuilt only when a
//                zone is edited, fills or frees: C13 end-of-tick), and reachability is checked
//                separately (region labels) when a cell is chosen.
// Filling one cell only shrinks a free list; the field is rebuilt (end of tick, rt.dirty.zoneFields)
// only when a zone's list becomes empty or stops being empty.

import { W, H, N, idx, tx, ty, DX8, DY8, TER_PASSABLE } from '../core/grid.js';
import { registerRebuild } from '../core/rtcontract.js';
import { registerEndOfTick, BUS } from '../core/bus.js';
import { zoneById, bldById } from '../core/state.js';
import { def } from '../core/content.js';
import { onTileWrite, compOf, regionDist } from '../world/terrain.js';
import { footprint } from '../world/pass.js';
import { WORK, keyTile, isReserved } from './jobs.js';
import { categoryOf, stackLimit, setCellHook, getItem } from './items.js';

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
/** Does a zone filter { cats, mats, q } accept stack (or bundle) it? */
export function filterAccepts(f, it) {
  if (!f) return false;
  const chain = catChain(categoryOf(it.k));
  let ok = false;
  for (const c of chain) if (f.cats.includes(c)) { ok = true; break; }
  if (!ok) return false;
  if (f.mats && f.mats.length && !f.mats.includes(it.m)) return false;
  const q = it.q | 0;
  if (f.q && (q < f.q[0] || q > f.q[1])) return false;
  return true;
}
export const zoneAccepts = (z, it) => isStorage(z) && filterAccepts(z.filter, it);

/** Priority of the storage zone holding stack `it` when that zone accepts it, else -1. */
export function curPri(s, it) {
  const zid = s.L.zone[idx(it.x, it.y)];
  if (!zid) return -1;
  const z = zoneById(s, zid);
  return z && zoneAccepts(z, it) ? z.pri : -1;
}

// ---- Free cells ---------------------------------------------------------------------------------------
/** A storage cell that can take a new stack: open ground, no building (ignoring `ignoreBld`), no stack. */
export function cellFree(s, i, ignoreBld = -1) {
  if (TER_PASSABLE[s.L.terrain[i]] !== 1) return false;
  const o = s.rt.occ[i];
  if (o >= 0 && o !== ignoreBld) return false;
  return s.rt.itemAt[i] < 0;
}
function hearthAt(s) {
  const h = s.colony.hearth;
  const b = h && h.id !== null ? bldById(s, h.id) : null;
  return b ? [b.x + 1, b.y + 1] : [W >> 1, H >> 1];
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
  const [hx, hy] = hearthAt(s);
  const byId = storageTiles(s);
  const ids = [...byId.keys()].sort((a, b) => a - b);
  for (const id of ids) {
    const tiles = byId.get(id);
    if (!tiles.length) { lists.push({ id, cells: [] }); continue; }
    let anchor = tiles[0], ad = Infinity;
    for (const i of tiles) { const dx = tx(i) - hx, dy = ty(i) - hy, d = dx * dx + dy * dy; if (d < ad) { ad = d; anchor = i; } }
    const ax = tx(anchor), ay = ty(anchor);
    const order = tiles.map((i) => [Math.max(Math.abs(tx(i) - ax), Math.abs(ty(i) - ay)), i]);
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
  return `${z.pri}|${[...f.cats].sort().join(',')}|${[...(f.mats || [])].sort().join(',')}|${(f.q || [0, 6]).join(',')}`;
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
    if (!g) { g = { key, pri: z.pri, filter: { cats: [...z.filter.cats].sort(), mats: [...(z.filter.mats || [])].sort(), q: (z.filter.q || [0, 6]).slice() }, zones: [], open: [], dist: null, lab: null }; groups.push(g); }
    g.zones.push(z.id);
  }
  return groups;
}
let fieldBuilds = 0;
/** Number of end-of-tick zone-field rebuilds so far (tests: filling one cell must not rebuild). Not sim state. */
export const fieldBuildCount = () => fieldBuilds;

function buildField(s, g, free) {
  g.open = g.zones.filter((id) => { const l = free.lists.find((x) => x.id === id); return !!l && l.cells.length > 0; });
  if (!g.open.length) { g.dist = null; g.lab = null; return; }
  const dist = new Uint16Array(N).fill(0xffff), lab = new Uint8Array(N), q = new Int32Array(N);
  let qh = 0, qt = 0;
  const L = s.L.zone;
  for (let i = 0; i < N; i++) { const z = L[i]; if (z && g.open.includes(z)) { dist[i] = 0; lab[i] = z; q[qt++] = i; } }
  while (qh < qt) {
    const i = q[qh++], x = tx(i), y = ty(i), d = dist[i] + 1;
    for (let k = 0; k < 8; k++) {
      const nx = x + DX8[k], ny = y + DY8[k];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = idx(nx, ny);
      if (dist[j] !== 0xffff) continue;
      dist[j] = d; lab[j] = lab[i]; q[qt++] = j;
    }
  }
  g.dist = dist; g.lab = lab;
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
/** Highest priority among storage groups with a free cell whose filter accepts `it` (-1 none). */
export function bestPri(s, it) {
  let best = -1;
  for (const g of s.rt.zoneField) {
    if (!g.open.length || g.pri <= best) continue;
    if (filterAccepts(g.filter, it) || g.open.some((id) => zoneAccepts(zoneById(s, id), it))) best = g.pri;
  }
  return best;
}
/** Should stack `it` move to a better stockpile (5.6 (a) and (b))? */
export const needsHaul = (s, it) => bestPri(s, it) > curPri(s, it);

const mergeable = (a, b) => a.k === b.k && a.m === b.m && a.q === b.q && !a.f && !a.name && !b.name && a.id !== b.id && a.n < stackLimit(a.k);

/**
 * Where to put stack `it` (5.6): the nearest best-priority accepting zone from its group field, then
 * a matching partial stack in that zone, else the zone's first free unreserved cell. Falls back to a
 * scan of every qualifying zone (region-graph nearest) when the field's zone cannot be reached.
 * @returns {{ i: number, zoneId: number, merge: number } | null} i the tile, merge a stack id or -1
 */
export function findDest(s, col, it) {
  const best = bestPri(s, it);
  if (best < 0 || best <= curPri(s, it)) return null;
  const from = idx(it.x, it.y), comp = compOf(s, from, 0);
  const holder = col ? col.id : -1;
  const usable = (z) => !!z && z.pri === best && zoneAccepts(z, it);
  const pick = (z) => {
    // a partial stack of the same kind in the zone first (keeps stack counts down)
    const bucket = s.rt.idx.items[it.k];
    let mi = -1, md = Infinity;
    if (bucket) for (const id of bucket) {
      const o = getItem(s, id);
      const ti = idx(o.x, o.y);
      if (s.L.zone[ti] !== z.id || !mergeable(o, it) || isReserved(s, keyTile(ti), holder) || compOf(s, ti, 0) !== comp) continue;
      const d = Math.abs(o.x - it.x) + Math.abs(o.y - it.y);
      if (d < md) { md = d; mi = o.id; }
    }
    if (mi >= 0) { const o = getItem(s, mi); return { i: idx(o.x, o.y), zoneId: z.id, merge: mi }; }
    for (const c of freeCells(s, z.id)) if (!isReserved(s, keyTile(c), holder) && compOf(s, c, 0) === comp) return { i: c, zoneId: z.id, merge: -1 };
    return null;
  };
  // fast path: the field's nearest zone
  let fg = null, fd = 0xffff;
  for (const g of s.rt.zoneField) {
    if (g.pri !== best || !g.dist || g.dist[from] >= fd) continue;
    const z = zoneById(s, g.lab[from]);
    if (usable(z)) { fg = g; fd = g.dist[from]; }
  }
  if (fg) { const r = pick(zoneById(s, fg.lab[from])); if (r) return r; }
  // fallback: every qualifying open zone, region-graph nearest first cell
  let out = null, od = Infinity;
  for (const g of s.rt.zoneField) {
    if (g.pri !== best) continue;
    for (const id of g.open) {
      const z = zoneById(s, id);
      if (!usable(z)) continue;
      const r = pick(z);
      if (!r) continue;
      const d = regionDist(s, from, r.i, 0);
      if (d < od || (d === od && out && r.i < out.i)) { od = d; out = r; }
    }
  }
  return out;
}

// ---- Install ------------------------------------------------------------------------------------------
let offTile = null;
function onPlaced(s, b) { for (const i of footprint(s, b)) cellChanged(s, i); }
function onRemoved(s, b) { for (const i of footprint(s, b)) cellChanged(s, i, b.id); }
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
  add(BUS.zoned, onZoned);
  add(BUS.zoneCfg, onZoneCfg);
  if (!offTile) offTile = onTileWrite((s, i, layer) => { if (layer === 'terrain') cellChanged(s, i); });
}
registerRebuild('zoneFree', rebuildZoneFree);
registerRebuild('zoneField', rebuildZoneField);
