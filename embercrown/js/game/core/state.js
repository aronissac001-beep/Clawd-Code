// Colony state: createColony, initRuntime, migrations and the state hash (doc 11.6, 13.2).
// Owner A. The saved shape is defined by schema.js (C2); s.rt by rtcontract.js (C13).

import { setMapSize, allocLayers, LAYERS, TER, N, W, H, D, zS, idx, DEFAULT_MAP } from './grid.js';
import { initStreams, seedOf } from './rand.js';
import {
  STATE_VERSION, newColonyRecord, newStoryRecord, newIdCounters, toPlain, colonyToPlain, storyToPlain,
  checkEntity, COLLECTIONS, ROOT_KEYS, DEPTH_KEYS, OPTIONAL_KEYS, TECH_BYTES, DIFFICULTIES, DEFAULT_DIFFICULTY, normDifficulty,
} from './schema.js';
import { legacyChoices, settleChoice, settledChronEntry } from '../people/perklegacy.js';
import { allocRt, registerRebuild, rebuilderOf, RT_KEYS, RT, savedKeys } from './rtcontract.js';

/**
 * Ordered migrations (11.5): migrations[k] turns the ENTITIES section of a stateVersion k+1 save (the
 * plain JSON of save/colonysave.js: { meta, colony, st, col, ... }) into stateVersion k+2. Each one is a
 * pure function of that object, may change it in place and returns it; it never sees the layers or the
 * runtime (those formats are versioned by the codec, C10). Every migration ships with a real fixture
 * in tools/fixtures/ (v1: v1-1b-midraid.ecsave, a Stage 1b save made mid-raid) and a test that loads
 * it and continues it (tools/tests/save-2.test.mjs). Fields that are only ADDED need no migration:
 * colonyFromPlain and fromPlain fill defaults.
 */
export const migrations = [
  // v1 -> v2 (Stage 2): the 9.1 difficulty ids; the meta records the version it came from. (A v1 colony with
  // iron: true was an Ironhold colony; from Stage 2.9 that reads as Hard, EMBERCROWN-FORTRESS.md 1.3, F9.)
  function v1to2(ent) {
    const c = ent.colony || (ent.colony = {});
    const d = c.difficulty;
    c.difficulty = d === 'standard' || !DIFFICULTIES.includes(d) ? DEFAULT_DIFFICULTY : d;
    c.iron = c.iron === true;
    if (c.iron) c.difficulty = 'hard';
    if (c.tierSince === undefined) c.tierSince = -1;
    if (c.storytellerDay === undefined) c.storytellerDay = -1;
    if (ent.meta) ent.meta.migratedFrom = ent.meta.migratedFrom || 1;
    return ent;
  },
  // v2 -> v3 (Stage 2.9, EMBERCROWN-FORTRESS.md 5.3): the removals. Fixtures: tools/fixtures/v2-s2-*.ecsave.
  function v2to3(ent) {
    const c = ent.colony || (ent.colony = {});
    // 1. no Ironhold: iron: true (or the old 'ironhold' id) is Hard, and colony.iron is gone (the slots card
    //    drops its own `iron` on the next write, save/slots.js)
    c.difficulty = normDifficulty(c.difficulty, c.iron);
    delete c.iron;
    // 2. a pending perk choice is settled to the perk whose deed the colonist is nearer to (perklegacy.js)
    settlePendingPerks(ent);
    // 3. Colonist.done is a schema field added with its default (zero counters; no back-fill): rows lack it
    // 4. no Lords to slay, no charters, no specialisations
    delete c.lordsDone; delete c.charters; delete c.spec; delete c.specs;
    dropColumn(ent, 'bld', 'spec');
    // 5. the fall is explicit
    c.fallen = c.fallen === true;
    if (ent.meta) ent.meta.migratedFrom = ent.meta.migratedFrom || 2;
    return ent;
  },
];

/**
 * migrations[2], v3 -> v4 (the fortress switch, EMBERCROWN-FORTRESS.md 5.4; Stage Z1 E9). The world step needs
 * the layers, which an ENTITIES migration never sees, so this part only marks the save (ent.meta.world4) and the
 * loader runs core/migrate4.js migrateWorld(s) on the built D = 1 state. It joins the list when STATE_VERSION
 * becomes 4 (step E13); until then no save reaches it and the D = 1 game is unchanged.
 */
export function v3to4(ent) {
  if (ent.meta) { ent.meta.world4 = true; ent.meta.migratedFrom = ent.meta.migratedFrom || 3; }
  return ent;
}
if (STATE_VERSION >= 4 && migrations.length === 2) migrations.push(v3to4);

// ---- v2 -> v3 helpers: they read the ENTITIES rows by name (format 2 writes the field lists in `fl`; a format 1
// blob, Stage 0, has none and its rows are in the schema order of its day, which these lists freeze) -----------
const V2_FIELDS = Object.freeze({
  col: ['id', 'name', 'anc', 'age', 'look', 'bs', 'at', 'sk', 'perks'],
  bld: ['id', 'def', 'x', 'y', 'rot', 'mat', 'q', 'hp', 'st', 'need', 'got', 'work', 'lvl', 'spec', 'owner', 'fuel',
    'bills', 'link', 'name', 'maker', 'dcon'],
});
const namesOf = (ent, kind) => (ent.fl && Array.isArray(ent.fl[kind]) ? ent.fl[kind] : V2_FIELDS[kind]);
function dropColumn(ent, kind, name) {
  const names = namesOf(ent, kind), k = names.indexOf(name);
  if (k < 0) return;
  for (const r of ent[kind] || []) if (Array.isArray(r) && r.length > k) r.splice(k, 1);
  if (ent.fl && ent.fl[kind] === names) names.splice(k, 1);
}
/** Plain { id, name, sk, perks } views of the colonist rows (the perks array is the row's own). */
function colViews(ent) {
  const names = namesOf(ent, 'col'), at = (n) => names.indexOf(n);
  const iId = at('id'), iName = at('name'), iSk = at('sk'), iPerks = at('perks');
  return (ent.col || []).filter(Array.isArray).map((r) => {
    if (!Array.isArray(r[iPerks])) { while (r.length <= iPerks) r.push(null); r[iPerks] = []; }
    return { id: r[iId], name: r[iName], sk: r[iSk], perks: r[iPerks] };
  });
}
/** Stacks with a maker: [{ k, q, maker }] (format 2 packs stacks flat, save/fields.js: 9 numbers a slot). */
function madeItems(ent) {
  const p = ent.items, out = [];
  if (!p) return out;
  if (Array.isArray(p)) {   // format 1 rows: id, k, m, q, n, x, y, hp, f, age, name, maker
    for (const r of p) if (Array.isArray(r) && r[11] !== null && r[11] !== undefined) out.push({ k: r[1], q: r[3], maker: r[11] });
    return out;
  }
  const a = p.a || [], strs = p.strs || [], off = [];
  for (let o = 0; o < a.length;) { if (a[o] === -1) { off.push(-1); o++; } else { off.push(o); o += 9; } }
  for (const [id, extra] of p.xs || []) {
    const o = off[id];
    if (o === undefined || o < 0 || !extra || extra.maker === null || extra.maker === undefined) continue;
    out.push({ k: strs[a[o]], q: a[o + 2], maker: extra.maker });
  }
  return out;
}
/** Buildings with a maker: [{ def, maker }]. */
function madeBuildings(ent) {
  const names = namesOf(ent, 'bld'), iDef = names.indexOf('def'), iMaker = names.indexOf('maker'), out = [];
  for (const r of ent.bld || []) if (Array.isArray(r) && r[iMaker] !== null && r[iMaker] !== undefined) out.push({ def: r[iDef], maker: r[iMaker] });
  return out;
}
/** 5.3 step 2: every open pair choice of every colonist gets exactly one perk, with a Chronicle line. */
function settlePendingPerks(ent) {
  const cols = colViews(ent);
  let ev = null;
  const tick = ent.meta && Number.isInteger(ent.meta.tick) ? ent.meta.tick : 0;
  for (const col of cols) {
    const open = legacyChoices(col);
    if (!open.length) continue;
    ev = ev || { items: madeItems(ent), bld: madeBuildings(ent) };
    for (const ch of open) {
      const perk = settleChoice(col, ch.options, ev);
      col.perks.push(perk);
      (ent.chron || (ent.chron = [])).push(settledChronEntry(tick, col, perk));
    }
  }
}
/** Run the migrations from stateVersion `from` to STATE_VERSION over an ENTITIES object. */
export function migrate(ent, from) {
  if (!Number.isInteger(from) || from < 1) throw new Error('This save has no valid state version.');
  if (from > STATE_VERSION) throw new Error('This colony was saved by a newer version of the game.');
  for (let v = from; v < STATE_VERSION; v++) {
    const fn = migrations[v - 1];
    if (typeof fn !== 'function') throw new Error(`No migration from state version ${v}.`);
    ent = fn(ent);
  }
  return ent;
}

/**
 * A new, empty, valid colony: the map allocated at its size, every layer zeroed except terrain
 * (flat `opts.terrain`, default grass; mapgen (B) replaces it), no entities, a fresh runtime.
 * @param {number|string} seed
 * opts.d > 1 (tests, benches and `?fortress=1` until E13) makes a W x H x d world with the surface at
 * opts.zS (default d - 1); the state then carries `d` and `zS` (DEPTH_KEYS). Without it the colony is D = 1.
 * @param {{ w?: number, h?: number, d?: number, zS?: number, name?: string, id?: string, terrain?: number }} [opts]
 */
export function createColony(seed, opts = {}) {
  const w = opts.w || DEFAULT_MAP, h = opts.h || w, d = opts.d || 1, zs = d > 1 ? (opts.zS === undefined ? d - 1 : opts.zS) : 0;
  setMapSize(w, h, d, zs);
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
  if (d > 1) { s.d = d; s.zS = zs; }
  s.L.terrain.fill(opts.terrain === undefined ? TER.GRASS : opts.terrain);
  initRuntime(s);
  return s;
}

/** Build s.rt from saved state (after setMapSize). Every C13 key is allocated, then rebuilt where a rebuild is registered. */
export function initRuntime(s) {
  const d = s.d || 1, zs = s.zS || 0;
  if (s.w !== W || s.h !== H || d !== D || zs !== zS) setMapSize(s.w, s.h, d, zs);
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
  for (const it of s.items) if (it) a[idx(it.x, it.y, it.z)] = it.id;
  return a;
});
// Stage 0 stub: a 1 x 1 footprint at (x, y). B/E register the real footprint rebuild (structure sizes from data).
registerRebuild('occ', (s) => {
  const a = new Int32Array(N).fill(-1);
  for (const b of s.bld) if (b) a[idx(b.x, b.y, b.z)] = b.id;
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
  for (const k of Object.keys(s)) if (k !== 'rt' && !ROOT_KEYS.includes(k) && !DEPTH_KEYS.includes(k) && !OPTIONAL_KEYS.includes(k)) errs.push(`root.${k} not in schema`);
  if ('d' in s && (!Number.isInteger(s.d) || s.d < 2 || !Number.isInteger(s.zS) || s.zS < 0 || s.zS >= s.d)) errs.push('root.d / root.zS');
  if (s.v !== STATE_VERSION) errs.push(`v ${s.v} != ${STATE_VERSION}`);
  if (!Number.isInteger(s.tick) || s.tick < 0) errs.push('tick');
  const n = s.w * s.h * (s.d || 1);
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
// The hash is of VALUES, never of array types (EMBERCROWN-FORTRESS.md 8.3 E1): a typed array is hashed
// element by element as its integer value (h ^= v >>> 0, then the FNV multiply), so a Uint8Array, a
// Uint16Array and a Uint32Array holding the same numbers hash alike (paths and labels widen to u32 in
// Stage Z1 without moving a hash). For byte arrays this is exactly byte-wise FNV-1a, so every hash
// recorded before the change (fixture sidecars, the Stage 2.9 baseline) still holds. The JSON part is
// value-based already (toPlain turns typed arrays into arrays). An entity's `z` of 0 is left out of the
// hashed JSON: on a D = 1 map it is always 0 and carries nothing, so adding the field moves no hash.
function fnv(h, a) {
  for (let i = 0; i < a.length; i++) { h ^= a[i] >>> 0; h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
/** FNV-1a (32-bit) of a typed array's element values; exported for tools (determinism, cache-drop). */
export const valueHash = (a, h = 0x811c9dc5) => fnv(h, a);
const enc = new TextEncoder();
const hashPlain = (kind, e) => { const o = toPlain(kind, e); if (o && o.z === 0) delete o.z; return o; };
/** Canonical JSON of the saved entities and records (what a save holds besides layers). */
export function entitiesJSON(s) {
  const col = (key, kind) => s[key].map((e) => hashPlain(kind, e));
  return JSON.stringify({
    meta: s.d > 1 ? { v: s.v, id: s.id, name: s.name, seed: s.seed, w: s.w, h: s.h, d: s.d, zS: s.zS, tick: s.tick }
      : { v: s.v, id: s.id, name: s.name, seed: s.seed, w: s.w, h: s.h, tick: s.tick },
    rng: s.rng, next: s.next, colony: colonyToPlain(s.colony), st: storyToPlain(s.st),
    col: col('col', 'col'), items: col('items', 'items'), bld: col('bld', 'bld'), zones: col('zones', 'zones'),
    anim: col('anim', 'anim'), foes: col('foes', 'foes'), raids: col('raids', 'raids'), rel: s.rel, chron: s.chron,
    rt: Object.fromEntries(savedKeys(raidLive(s)).map((k) => [k, s.rt[k]])),
    ...(typeof s.legend === 'string' && s.legend ? { legend: s.legend } : {}),
  });
}
/** 64-bit (two FNV-1a lanes) hex hash of the whole saved state by value, including the saved runtime. */
export function stateHash(s) {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (const l of LAYERS) { a = fnv(a, s.L[l.name]); b = fnv(b ^ l.id, s.L[l.name]); }
  const j = enc.encode(entitiesJSON(s));
  a = fnv(a, j); b = fnv(b ^ 0x9e3779b9, j);
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}
