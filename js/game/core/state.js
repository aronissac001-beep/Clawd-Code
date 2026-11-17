// Colony state: createColony, initRuntime, migrations and the state hash (doc 11.6, 13.2).
// Owner A. The saved shape is defined by schema.js (C2); s.rt by rtcontract.js (C13).

import { setMapSize, allocLayers, LAYERS, TER, N, W, H, idx, DEFAULT_MAP } from './grid.js';
import { initStreams, seedOf } from './rand.js';
import {
  STATE_VERSION, newColonyRecord, newStoryRecord, newIdCounters, toPlain, colonyToPlain, storyToPlain,
  checkEntity, COLLECTIONS, ROOT_KEYS, TECH_BYTES,
} from './schema.js';
import { allocRt, registerRebuild, rebuilderOf, RT_KEYS, RT, savedKeys } from './rtcontract.js';

/** Ordered migrations: migrations[k] turns a stateVersion k+1 plain state into k+2 (11.5). Starts empty at v1. */
export const migrations = [];

/**
 * A new, empty, valid colony: the map allocated at its size, every layer zeroed except terrain
 * (flat `opts.terrain`, default grass; mapgen (B) replaces it), no entities, a fresh runtime.
 * @param {number|string} seed
 * @param {{ w?: number, h?: number, name?: string, id?: string, terrain?: number }} [opts]
 */
export function createColony(seed, opts = {}) {
  const w = opts.w || DEFAULT_MAP, h = opts.h || w;
  setMapSize(w, h);
  const s0 = seedOf(seed);
  const s = {
    v: STATE_VERSION,
    id: opts.id || 'c' + s0.toString(36),
    name: opts.name || 'The Hold',
    seed: s0,
    w, h,
    tick: 0,
    speed: 1,
    rng: initStreams(s0),
    next: newIdCounters(),
    L: allocLayers(),
    colony: newColonyRecord(),
    st: newStoryRecord(),
    col: [], items: [], bld: [], zones: [], anim: [], foes: [], raids: [],
    rel: {},
    chron: [],
  };
  s.L.terrain.fill(opts.terrain === undefined ? TER.GRASS : opts.terrain);
  initRuntime(s);
  return s;
}

/** Build s.rt from saved state (after setMapSize). Every C13 key is allocated, then rebuilt where a rebuild is registered. */
export function initRuntime(s) {
  if (s.w !== W || s.h !== H) setMapSize(s.w, s.h);
  const prevSaved = s.rt ? Object.fromEntries(savedKeys(true).map((k) => [k, s.rt[k]])) : null;
  s.rt = allocRt();
  if (prevSaved) for (const k of Object.keys(prevSaved)) s.rt[k] = prevSaved[k];
  for (const k of Object.keys(RT_KEYS)) {
    const cls = RT_KEYS[k].cls;
    if (cls === RT.SAVED || cls === RT.RAID_SAVED || cls === RT.OUTPUT || cls === RT.RENDER || cls === RT.TRANSIENT) continue;
    const fn = rebuilderOf(k);
    if (fn) s.rt[k] = fn(s);
  }
  return s.rt;
}

// ---- Stage 0 rebuilders (owners replace them by registering their own: last one wins) -------
const lowestFree = (arr) => { const f = []; for (let i = 0; i < arr.length; i++) if (arr[i] === null) f.push(i); return f; };
registerRebuild('itemFree', (s) => lowestFree(s.items));
registerRebuild('bldFree', (s) => lowestFree(s.bld));
registerRebuild('itemAt', (s) => {
  const a = new Int32Array(N).fill(-1);
  for (const it of s.items) if (it) a[idx(it.x, it.y)] = it.id;
  return a;
});
// Stage 0 stub: a 1 x 1 footprint at (x, y). B/E register the real footprint rebuild (structure sizes from data).
registerRebuild('occ', (s) => {
  const a = new Int32Array(N).fill(-1);
  for (const b of s.bld) if (b) a[idx(b.x, b.y)] = b.id;
  return a;
});
// Stage 0 stub: no jobs claim anything yet. E registers rebuildFromJobs (5.4).
registerRebuild('res', () => new Map());

// ---- Queries ---------------------------------------------------------------------------------
export const colById = (s, id) => { for (const c of s.col) if (c.id === id) return c; return null; };
export const bldById = (s, id) => (Number.isInteger(id) && id >= 0 && id < s.bld.length ? s.bld[id] : null);
export const itemById = (s, id) => (Number.isInteger(id) && id >= 0 && id < s.items.length ? s.items[id] : null);
export const zoneById = (s, id) => { for (const z of s.zones) if (z.id === id) return z; return null; };
/** A raid is live from the moment it is Sighted until it ends (flow fields are saved meanwhile). */
export const raidLive = (s) => s.raids.some((r) => r.stage !== 'warned' && r.stage !== 'ended');
/** Take the next id of a counter kind (s.next). */
export function nextId(s, kind) { const v = s.next[kind]; s.next[kind] = v + 1; return v; }

// ---- Validation --------------------------------------------------------------------------------
/** Errors for a whole state; [] when valid. */
export function checkState(s) {
  const errs = [];
  for (const k of ROOT_KEYS) if (!(k in s)) errs.push(`root.${k} missing`);
  for (const k of Object.keys(s)) if (k !== 'rt' && !ROOT_KEYS.includes(k)) errs.push(`root.${k} not in schema`);
  if (s.v !== STATE_VERSION) errs.push(`v ${s.v} != ${STATE_VERSION}`);
  if (!Number.isInteger(s.tick) || s.tick < 0) errs.push('tick');
  const n = s.w * s.h;
  for (const l of LAYERS) {
    const a = s.L && s.L[l.name];
    const len = l.enc === 1 ? (n + 7) >> 3 : n;
    if (!(a instanceof Uint8Array) || a.length !== len) errs.push(`L.${l.name} not Uint8Array(${len})`);
  }
  if (!(s.colony.techs instanceof Uint8Array) || s.colony.techs.length !== TECH_BYTES) errs.push('colony.techs');
  for (const [key, kind] of Object.entries(COLLECTIONS)) {
    if (!Array.isArray(s[key])) { errs.push(`${key} not an array`); continue; }
    s[key].forEach((e, i) => {
      if (e === null) { if (key !== 'items' && key !== 'bld') errs.push(`${key}[${i}] null`); return; }
      for (const m of checkEntity(kind, e)) errs.push(`${key}[${i}]: ${m}`);
      if ((key === 'items' || key === 'bld') && e.id !== i) errs.push(`${key}[${i}].id ${e.id} != index`);
    });
  }
  for (const n2 of s.st.nemeses) for (const m of checkEntity('nem', n2)) errs.push(`st.nemeses: ${m}`);
  return errs;
}

// ---- Hash (determinism gate) -------------------------------------------------------------------
function fnv(h, bytes) {
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
const enc = new TextEncoder();
/** Canonical JSON of the saved entities and records (what a save holds besides layers). */
export function entitiesJSON(s) {
  const col = (key, kind) => s[key].map((e) => toPlain(kind, e));
  return JSON.stringify({
    meta: { v: s.v, id: s.id, name: s.name, seed: s.seed, w: s.w, h: s.h, tick: s.tick },
    rng: s.rng, next: s.next, colony: colonyToPlain(s.colony), st: storyToPlain(s.st),
    col: col('col', 'col'), items: col('items', 'items'), bld: col('bld', 'bld'), zones: col('zones', 'zones'),
    anim: col('anim', 'anim'), foes: col('foes', 'foes'), raids: col('raids', 'raids'), rel: s.rel, chron: s.chron,
    rt: Object.fromEntries(savedKeys(raidLive(s)).map((k) => [k, s.rt[k]])),
  });
}
/** 64-bit (two FNV-1a lanes) hex hash of the whole saved state, including the saved runtime. */
export function stateHash(s) {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (const l of LAYERS) { a = fnv(a, s.L[l.name]); b = fnv(b ^ l.id, s.L[l.name]); }
  const j = enc.encode(entitiesJSON(s));
  a = fnv(a, j); b = fnv(b ^ 0x9e3779b9, j);
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}
