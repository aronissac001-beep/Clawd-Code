// Contract C13 (owner A; reviewers B, E, H; frozen at the end of Stage 0): the runtime
// determinism contract (doc 13.3, D13).
//
//   Invariant: any s.rt data that affects a sim decision is either SAVED, or brought up to date
//   at the end of every tick in which its inputs changed.
//
// Every s.rt key is classed here. tools/tests/rt-contract.test.mjs fails on a key that is not
// listed, and the determinism gate (14.4 (d), (e)) checks the classes. A new rt field must be
// added to this table in the same change that adds it. Keys are allocated by initRuntime() from
// `alloc` (called after setMapSize, never at import).

// C13 v3 (EMBERCROWN-FORTRESS.md 7.3, F25; frozen at the end of Stage Z1 step E1). The rule: every rt key
// is one of
//   - incremental or end-of-tick: a pure function of the saved state, rebuilt whole by initRuntime;
//   - derived, pure (DERIVED_PURE): a cache whose hit equals a rebuild, with NO cap on misses: nothing the
//     sim does may depend on whether it was warm (an LRU may evict; that costs only time);
//   - saved: its key set and order travel in RUNTIME.
// A per-tick cap on cache builds, or a fallback "when not built", is not allowed. Contract test:
// tools/tests/cache-drop.test.mjs drops every key initRuntime rebuilds (droppableKeys) at seeded ticks and
// checks the continued run hashes as the undisturbed one. Voxel-indexed arrays are sized N (all levels);
// labels and voxel indexes are u32 / Int32.
// Z1 adds, each with the step that builds it: cover and skyZ (INC, per column, E2), support per level (INC,
// E4), linkStamp (END, E3), linkCache (DERIVED_PURE, E3), hflow.region (END) and hflow.local (DERIVED_PURE,
// E11), causes (END, daily, Z2), lightQ (SAVED, E4), fluidActive (SAVED, Z3), dirtyLevels (TRANSIENT, E4).
// It removes depth (E4), the flow fields `flow` and their saved form (E11), zoneField and zoneFieldQ (E5).

import { N, PLANE } from './grid.js';

export const RT = Object.freeze({
  SAVED: 'saved',                 // written in the blob's RUNTIME section
  RAID_SAVED: 'saved-while-raid', // saved only while a raid is live; otherwise absent / empty
  END: 'end-of-tick',             // rebuilt in sim.endOfTick when its dirty flag is set
  INC: 'incremental',             // updated inside the API call that changes its inputs
  INC_ORD: 'incremental-ordered', // as INC; buckets are arrays sorted by tile index or id
  PER_TICK: 'per-tick',           // rebuilt at the start of each tick in id order
  DERIVED_EXACT: 'derived-exact', // a pure function of saved state; asserted equal to a rebuild every tick end
  DERIVED: 'derived',             // rebuilt from saved state at load; incremental while running
  DERIVED_PURE: 'derived-pure',   // a pure cache (F25): a hit equals a rebuild; uncapped misses; never saved
  TRANSIENT: 'transient',         // inputs to endOfTick (dirty flags); must be clear at every tick end
  OUTPUT: 'output',               // written by the sim, never read by it (event queue)
  RENDER: 'render-only',          // never read by js/game/ (check-imports enforces)
});

const i32 = () => new Int32Array(N).fill(-1);
const u8 = () => new Uint8Array(N);
const u16 = () => new Uint16Array(N);
const u32 = () => new Uint32Array(N);

/** rt key -> { cls, owner, rule, alloc } */
export const RT_KEYS = Object.freeze({
  // reachability, rooms, temperature, light (B)
  region: { cls: RT.END, owner: 'B', rule: 'colonist labels (u32, canonical); dirty clusters relabelled in endOfTick', alloc: u32 },
  regionH: { cls: RT.END, owner: 'B', rule: 'hostile labels (doors closed, u32); as region', alloc: u32 },
  regionGraph: { cls: RT.END, owner: 'B', rule: 'region links; with region', alloc: () => ({ links: [] }) },
  room: { cls: RT.END, owner: 'B', rule: 'room id per tile; dirty areas in endOfTick', alloc: u16 },
  rooms: { cls: RT.END, owner: 'B', rule: 'room records by id; with room', alloc: () => [] },
  roomTemp: { cls: RT.END, owner: 'B', rule: 'room temperatures; after rooms', alloc: () => [] },
  heat: { cls: RT.END, owner: 'B', rule: 'outdoor heat near fires (Int8); with temperature', alloc: () => new Int8Array(N) },
  light: { cls: RT.END, owner: 'B', rule: 'light 0-3; dirty sources and day-phase ticks', alloc: u8 },
  lit: { cls: RT.END, owner: 'B', rule: 'lit-for-combat flags; with light', alloc: u8 },
  // tile caches updated by the terrain, item and building APIs
  occ: { cls: RT.INC, owner: 'B', rule: 'building id per tile (-1 none); building API', alloc: i32 },
  itemAt: { cls: RT.INC, owner: 'E', rule: 'item stack id per tile (-1 none); item API', alloc: i32 },
  support: { cls: RT.INC, owner: 'B', rule: 'distance to nearest support, cap 7; terrain API', alloc: u8 },
  depth: { cls: RT.INC, owner: 'B', rule: 'distance into rock; terrain API', alloc: u8 },
  cover: { cls: RT.INC, owner: 'B', rule: 'lids over each voxel, cap 3 (2.4); refreshColumn in the terrain API', alloc: u8 },
  skyZ: { cls: RT.INC, owner: 'B', rule: 'lowest sky-lit level per column (2.4); with cover', alloc: () => new Uint8Array(PLANE) },
  walkCost: { cls: RT.INC, owner: 'B', rule: 'walk cost x10 (0 blocked); terrain and building API', alloc: u8 },
  // work (E)
  idx: { cls: RT.INC_ORD, owner: 'E', rule: 'work indexes (designations, items by kind, frames, bills, plants, patients); arrays sorted by tile or id', alloc: () => ({ desig: [], items: {}, frames: [], bills: [], plants: [], patients: [] }) },
  zoneField: { cls: RT.END, owner: 'E', rule: 'zone distance fields per filter group; when a zone is edited, fills or frees', alloc: () => [] },
  zoneFree: { cls: RT.END, owner: 'E', rule: 'per-zone free cell lists; with zoneField', alloc: () => [] },
  res: { cls: RT.DERIVED_EXACT, owner: 'E', rule: 'reservations: a function of saved jobs (5.4); asserted equal to rebuildFromJobs', alloc: () => new Map() },
  itemFree: { cls: RT.DERIVED, owner: 'E', rule: 'lowest free s.items index (min-heap of null slots)', alloc: () => [] },
  bldFree: { cls: RT.DERIVED, owner: 'E', rule: 'lowest free s.bld index (min-heap of null slots)', alloc: () => [] },
  stock: { cls: RT.DERIVED, owner: 'E', rule: 'colony stock by kind; incremental, full recompute every 14,400 ticks', alloc: () => ({}) },
  wealth: { cls: RT.DERIVED, owner: 'K', rule: 'colony wealth; incremental, full recompute every 14,400 ticks', alloc: () => ({ total: 0 }) },
  thinkQ: { cls: RT.SAVED, owner: 'E', rule: 'think FIFO of colonist ids (RUNTIME section)', alloc: () => [] },
  // movement (B)
  spatial: { cls: RT.PER_TICK, owner: 'B', rule: 'spatial hashes rebuilt at the start of each tick in id order', alloc: () => ({}) },
  pathQ: { cls: RT.SAVED, owner: 'B', rule: 'path request FIFO (RUNTIME section)', alloc: () => [] },
  // threats (H)
  flow: { cls: RT.RAID_SAVED, owner: 'H', rule: 'flow fields with build ticks and input stamps; saved while a raid is live', alloc: () => [] },
  // control and output (A)
  dirty: { cls: RT.TRANSIENT, owner: 'A', rule: 'endOfTick dirty flags and areas; set by the C5/C6 APIs, cleared by endOfTick', alloc: () => newDirty() },
  events: { cls: RT.OUTPUT, owner: 'A', rule: 'emit() queue, drained by the controller; the sim never reads it', alloc: () => [] },
  render: { cls: RT.RENDER, owner: 'C', rule: 'optional render-side caches; never read by js/game/', alloc: () => null },
});

export const RT_KEY_NAMES = Object.freeze(Object.keys(RT_KEYS));

/** Dirty flags for the endOfTick passes (bus.END_OF_TICK) plus dirty area lists. */
export function newDirty() {
  return { regions: false, rooms: false, temperature: false, light: false, zoneFields: false, flowFields: false, tiles: [] };
}
export const dirtyClear = (d) => !d.regions && !d.rooms && !d.temperature && !d.light && !d.zoneFields && !d.flowFields && d.tiles.length === 0;

export const classOf = (key) => (RT_KEYS[key] ? RT_KEYS[key].cls : null);
export const keysOfClass = (...cls) => RT_KEY_NAMES.filter((k) => cls.includes(RT_KEYS[k].cls));
/** Keys initRuntime rebuilds from saved state (the cache-drop test drops all of them): everything but saved, transient, output and render keys. */
export const droppableKeys = () => keysOfClass(RT.END, RT.INC, RT.INC_ORD, RT.PER_TICK, RT.DERIVED_EXACT, RT.DERIVED, RT.DERIVED_PURE);
/** Keys written in the RUNTIME section (raid-saved ones only while a raid is live). */
export const savedKeys = (raidLive) => keysOfClass(RT.SAVED, ...(raidLive ? [RT.RAID_SAVED] : []));

/** Fresh rt with every contract key allocated for the current map size. */
export function allocRt() {
  const rt = {};
  for (const k of RT_KEY_NAMES) rt[k] = RT_KEYS[k].alloc();
  return rt;
}

/** { unlisted, missing } keys of a live rt against the contract. */
export function checkRt(rt) {
  const have = Object.keys(rt);
  return { unlisted: have.filter((k) => !(k in RT_KEYS)), missing: RT_KEY_NAMES.filter((k) => !(k in rt)) };
}

// ---- Rebuilders (for the gate's check (e) and for initRuntime) -------------------------------
// Owners register a from-scratch rebuild for their END / INC / DERIVED keys: fn(s) -> fresh value.
const rebuilders = new Map();
export function registerRebuild(key, fn) {
  if (!(key in RT_KEYS)) throw new Error(`rtcontract: ${key} is not a C13 key`);
  rebuilders.set(key, fn);
}
export const rebuilderOf = (key) => rebuilders.get(key) || null;
export const rebuildKeys = () => RT_KEY_NAMES.filter((k) => rebuilders.has(k));
export function resetRebuilders() { rebuilders.clear(); }

/** Structural equality for rt values (typed arrays, Map, arrays, plain objects). */
export function rtEqual(a, b) {
  if (a === b) return true;
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b) || a.constructor !== b.constructor || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map) || !(b instanceof Map) || a.size !== b.size) return false;
    for (const [k, v] of a) if (!b.has(k) || !rtEqual(v, b.get(k))) return false;
    return true;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (!rtEqual(a[k], b[k])) return false;
    return true;
  }
  return Number.isNaN(a) && Number.isNaN(b);
}

/** Gate check (e) on one state: every registered rebuild equals the live value. Returns mismatching keys. */
export function verifyCaches(s, keys = rebuildKeys()) {
  const bad = [];
  for (const k of keys) { const fn = rebuilders.get(k); if (fn && !rtEqual(s.rt[k], fn(s))) bad.push(k); }
  return bad;
}
