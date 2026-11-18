// World content lookups (owner B). The world modules read structure, plant and generation data
// through here, so tests can swap the registry (setWorldContent) and nothing indexes data twice.
// Pure: the default registry is G's CONTENT (js/data/index.js), built once at its own import.

import { CONTENT } from '../../data/index.js';
import { STONES, DEPOSITS, DATA as GEN_DATA } from '../../data/worldgen.js';
import { DATA as PLANT_DATA } from '../../data/plants.js';

let REG = CONTENT;
const cache = new Map();
/** Replace the content registry (tests); null restores the default. */
export function setWorldContent(reg) { REG = reg || CONTENT; cache.clear(); }

/** Structure def by id, or null. A building record's def may carry a material suffix ('wall:granite') in tests. */
export function structDef(id) {
  if (!id) return null;
  let d = cache.get(id);
  if (d !== undefined) return d;
  d = REG.get('structure', id) || (id.includes(':') ? REG.get('structure', id.split(':')[0]) : null) || null;
  cache.set(id, d);
  return d;
}
export const hasFlag = (d, f) => !!(d && d.flags && d.flags.includes(f));
/** [w, h] of a structure def after rotation (rot 1 and 3 swap the sides). */
export function sizeOf(d, rot = 0) {
  const sz = d && d.size ? d.size : [1, 1];
  return rot & 1 ? [sz[1], sz[0]] : [sz[0], sz[1]];
}

// ---- Stones and deposits (L.mat, L.ore ids) -------------------------------------------------
export const stoneId = (name) => { const k = STONES.indexOf(name); return k < 0 ? 0 : k; };
export const stoneName = (id) => STONES[id] || null;
export const depositId = (name) => { const k = DEPOSITS.indexOf(name); return k < 0 ? 0 : k; };
export const depositName = (id) => DEPOSITS[id] || null;
/** Deposit def (worldgen DATA.deposit) for an L.ore id, or null. */
export function depositDef(id) {
  const n = DEPOSITS[id];
  if (!n) return null;
  for (const d of GEN_DATA.deposit) if (d.id === n) return d;
  return null;
}
/** Rock layer def for a stone id (each stone belongs to one layer), or null. */
export function layerOfStone(id) {
  const n = STONES[id];
  if (!n) return null;
  for (const l of GEN_DATA.rockLayer) if (l.stones.includes(n)) return l;
  return null;
}
/** Rock layer def for a depth (tiles into rock). */
export function layerOfDepth(depth) {
  const L = GEN_DATA.rockLayer;
  for (const l of L) if (depth >= l.depth[0] && depth <= l.depth[1]) return l;
  return depth < L[0].depth[0] ? L[0] : L[L.length - 1];
}

// ---- Plants (L.plant codes = index + 1) -----------------------------------------------------
export const PLANTS = PLANT_DATA.plant;
export const plantDef = (code) => (code > 0 && code <= PLANTS.length ? PLANTS[code - 1] : null);
export function plantCode(id) { for (let k = 0; k < PLANTS.length; k++) if (PLANTS[k].id === id) return k + 1; return 0; }
export const isTreeCode = (code) => { const p = plantDef(code); return !!p && p.kind === 'tree'; };

// ---- Hearth levels and items (Stage 1b: fuel and light) -------------------------------------
/** hearthLevel row (js/data/tiers.js) for a Hearth level, or null. */
export function hearthLevelOf(lvl) {
  for (const h of REG.all('hearthLevel')) if (h.lvl === lvl) return h;
  return null;
}
/** Item def by kind, or null. */
export const itemDefOf = (k) => (k ? REG.get('item', k) : null);

// ---- Rooms, floors and materials (Stage 2: room roles, stats and tiers) -----------------------
/** Room role defs (js/data/rooms.js) in match order. */
export function roomRoles() {
  const k = '#roomRoles';
  let v = cache.get(k);
  if (!v) { v = REG.all('room').slice().sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1)); cache.set(k, v); }
  return v;
}
/** Room tier defs, lowest first (Squalid .. Majestic). */
export function roomTiers() {
  const k = '#roomTiers';
  let v = cache.get(k);
  if (!v) { v = REG.all('roomTier').slice().sort((a, b) => a.min - b.min); cache.set(k, v); }
  return v;
}
/** Constructed floor def for an L.floor id (1-based index among the floor structures), or null. */
export function floorDefById(id) {
  if (!id) return null;
  const k = '#floors';
  let v = cache.get(k);
  if (!v) { v = REG.all('structure').filter((d) => hasFlag(d, 'floor')); cache.set(k, v); }
  return v[id - 1] || null;
}
/** Material def by id, or null. */
export const materialDef = (id) => (id ? REG.get('material', id) : null);

/** Every def of a content kind (data order). */
export const allOf = (kind) => REG.all(kind);
