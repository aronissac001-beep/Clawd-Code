// Contract C2 (owner A; reviewers: all). The state schema: the source of truth for the saved
// state root, entity ids, RNG streams and every entity's fields (doc 13.2).
//   C2-core (frozen at the end of Stage 0): the state root, ids, RNG streams, and the core fields
//   of Colonist, Stack, Building and Zone (id, kind or def, position, owner, job, path).
//   C2-full (provisional until the 1a fun review): every other field. Fields may be ADDED any time
//   (with a default); existing ones are not renamed or retyped after the freeze.
//
// Conventions
// - Colonist, Animal and Foe positions (x, y) are WORLD units (TILE = 32 per tile, floats allowed);
//   Stack and Building positions are TILE coordinates (integers). Every positioned entity also has an
//   integer level `z` (C2 v3, EMBERCROWN-FORTRESS.md 7.2): always 0 on a D = 1 map (Stage Z1 step E1).
// - Every voxel index (grid.js: i = (z * H + y) * W + x) is a u32 / Int32: a field holding one has the
//   type `tile`, a path holds a Uint32Array, and VOXEL_REFS lists every other saved place one lives in
//   (job toils and keys, plans, raid edges, the path queue), for the codec and the world migration.
// - Stacks and Buildings use their array index as id: s.items[id], s.bld[id] (null = free slot;
//   a new one always takes the lowest free index, 5.5). Colonists, animals, foes, raids, zones and
//   nemeses take ids from s.next (monotonic, never reused) except zones, which reuse 1..254.
// - Needs and mood are fixed-point integers: 0..100 is stored x100 (0..10000) (14.1).
// - Positional arrays (sk, need, at, prio, sched) follow the fixed id orders below; js/data files
//   must use the same orders (validate-data checks).
// - No Map or Set in saved state; plain objects only where 13.2 says so (rel, cooldowns), and code
//   must not depend on their key order.

import { STREAMS } from './rand.js';
import { N, INDEX_SPAN } from './grid.js';
import { DONE_LEN } from '../../data/deeds-col.js';

// 1: Stages 1a-1b. 2 (Stage 2): difficulty ids of 9.1 (hearthkeeper, warden, steadfast, ironhold; v1
// saves said 'standard', which migrates to 'steadfast') and colony.iron follows the difficulty;
// colony.tierSince (K) and colony.storytellerDay (the once-a-year storyteller change, 9.1) added.
// 3 (Stage 2.9, EMBERCROWN-FORTRESS.md 5.3; migrations[1] in state.js): no Ironhold (F9): the fourth
// difficulty is Hard (threat x1.4, normal slots and backups) and colony.iron is gone; colony.lordsDone and
// colony.charters are gone (1.2, 1.4), and so is Building.spec (no specialisations); a pending perk choice is
// settled to one perk; Colonist.done (the deed counters perks are earned by, 3.1) is added at zero; and
// colony.fallen (the fall, colony/fall.js) is an explicit false. fallSince and fallenAt stay optional keys,
// written only when they happen.
// 4 (the fortress switch, Stage Z1 E13, EMBERCROWN-FORTRESS.md 5.4; migrations[2] in state.js): the world has
// depth. The ENTITIES step only marks the save (meta.world4); js/main.js runs core/migrate4.js migrateWorld on a
// loaded colony with one plane, which then saves as EC3. Tool-made D = 1 states also carry v 4 (no field differs).
export const STATE_VERSION = 4;
/** Difficulties (doc 9.1, amended by EMBERCROWN-FORTRESS.md F9), easiest first. */
export const DIFFICULTIES = Object.freeze(['hearthkeeper', 'warden', 'steadfast', 'hard']);
export const DEFAULT_DIFFICULTY = 'steadfast';
/** Retired difficulty ids and what they read as now (a Stage 2 Ironhold colony is a Hard colony). */
export const RETIRED_DIFFICULTIES = Object.freeze({ ironhold: 'hard', standard: 'steadfast' });
/** A colony record's difficulty as one of DIFFICULTIES: retired ids map (ironhold: hard), iron: true is Hard, else the default. */
export function normDifficulty(d, iron = false) {
  if (iron === true) return 'hard';
  if (DIFFICULTIES.includes(d)) return d;
  return RETIRED_DIFFICULTIES[d] || DEFAULT_DIFFICULTY;
}

/** Fixed orders of positional arrays (saved by position; never reorder, only append). */
export const SKILL_IDS = Object.freeze(['mining', 'construction', 'woodcraft', 'masonry', 'smithing', 'tailoring',
  'cooking', 'growing', 'animals', 'medicine', 'melee', 'archery', 'social', 'lore', 'art']);
export const WORK_IDS = Object.freeze(['care', 'animals', 'cook', 'build', 'grow', 'mine', 'chop', 'smith',
  'craft', 'tailor', 'art', 'lore', 'haul']);
export const NEED_IDS = Object.freeze(['food', 'rest', 'joy', 'warmth', 'light']);
export const ATTR_IDS = Object.freeze(['might', 'wits', 'grace']);
export const PART_IDS = Object.freeze(['head', 'torso', 'larm', 'rarm', 'lleg', 'rleg']);
export const PART_HP = Object.freeze([25, 40, 20, 20, 25, 25]);
export const SCHED = Object.freeze({ SLEEP: 0, WORK: 1, JOY: 2, ANY: 3 });
export const BUILD_STATES = Object.freeze(['bp', 'frame', 'done']);
export const PASSION = Object.freeze({ NONE: 0, KEEN: 1, BURNING: 2 });
export const FIX = 100;                 // fixed-point scale for needs and mood
export const TECH_BYTES = 32;           // research bitset: up to 256 techs
export const RNG_STREAMS = STREAMS;
/** Id counters on s.next (monotonic). */
export const ID_KINDS = Object.freeze(['col', 'anim', 'foe', 'raid', 'nem', 'letter', 'visit', 'tmpl']);

// ---- Field specs ---------------------------------------------------------------------------
// [name, type, default, core?]   types: int | num | str | bool | ref (int or null) | json | u8:<len> | u16:<len> | path
//   | tile (a voxel index 0..N-1, or null)
// `default` may be a function returning a fresh value. core = part of C2-core.
const nul = null;
const F = (name, type, def, core = false) => ({ name, type, def, core });
const fresh = (v) => () => JSON.parse(JSON.stringify(v));

export const FIELDS = {
  col: [
    F('id', 'int', 0, true), F('name', 'str', '', true), F('anc', 'str', 'human'), F('age', 'int', 30),
    F('look', 'json', fresh({ skin: 0, hair: 0, hairC: 0, beard: 0, cloth: 0 })),
    F('bs', 'json', fresh([null, null])),
    F('at', 'json', fresh([3, 3, 3])),
    F('sk', 'json', () => SKILL_IDS.map(() => [0, 0, 0, 0])),   // [lvl, xp, passion, todayTicks] x 15
    F('perks', 'json', fresh([])), F('traits', 'json', fresh([])),
    F('need', 'json', () => NEED_IDS.map(() => 80 * FIX)),       // fixed-point x100
    F('mood', 'int', 50 * FIX),
    F('thoughts', 'json', fresh([])),                            // [[id, ticksLeft, stack]]
    F('hp', 'json', () => ({ parts: PART_HP.slice(), blood: 100 * FIX, wounds: [], taint: 0, illness: null })),
    F('gear', 'json', fresh({ slots: {}, outfit: null })),
    F('sched', 'u8:24', () => defaultSchedule()),
    F('role', 'json', fresh(['generalist', null])),
    F('custom', 'bool', false),
    F('prio', 'u8:13', () => new Uint8Array(WORK_IDS.length).fill(3)),
    F('soldier', 'bool', false), F('squad', 'ref', nul), F('drafted', 'bool', false),
    F('bed', 'ref', nul, true), F('area', 'ref', nul),
    F('x', 'num', 0, true), F('y', 'num', 0, true),
    F('job', 'json', nul, true),                                 // Job (5.3) or null
    F('path', 'path', nul, true),                                // { tiles: Uint32Array, i } or null
    F('unreach', 'json', fresh([])),                             // [[targetKey, untilTick]]
    F('log', 'json', fresh([])), F('breakState', 'json', nul), F('inspo', 'json', nul),
    F('done', `u16:${DONE_LEN}`, () => new Uint16Array(DONE_LEN)),   // Stage 2.9: deed counters by position (data/deeds-col.js, 3.1)
    F('z', 'int', 0, true),                                      // Z1: level (0 at D = 1)
  ],
  items: [
    F('id', 'int', 0, true), F('k', 'str', '', true), F('m', 'str', nul), F('q', 'int', 0), F('n', 'int', 1, true),
    F('x', 'int', 0, true), F('y', 'int', 0, true), F('hp', 'int', 100), F('f', 'bool', false), F('age', 'int', 0),
    F('name', 'str', nul), F('maker', 'ref', nul),
    F('z', 'int', 0, true),
  ],
  bld: [
    F('id', 'int', 0, true), F('def', 'str', '', true), F('x', 'int', 0, true), F('y', 'int', 0, true),
    F('rot', 'int', 0, true), F('mat', 'str', nul), F('q', 'int', 0), F('hp', 'int', 100),
    F('st', 'str', 'bp', true), F('need', 'json', fresh({})), F('got', 'json', fresh({})), F('work', 'int', 0),
    F('lvl', 'int', 1), F('owner', 'ref', nul, true), F('fuel', 'int', 0),
    F('bills', 'json', fresh([])), F('link', 'ref', nul), F('name', 'str', nul), F('maker', 'ref', nul),
    F('dcon', 'bool', false),                                    // 1a: marked for deconstruction (a Build job)
    F('z', 'int', 0, true),
  ],
  zones: [
    F('id', 'int', 0, true), F('type', 'str', 'stockpile', true), F('name', 'str', ''), F('pri', 'int', 1),
    F('filter', 'json', fresh({ cats: [], mats: [], q: [0, 6] })), F('crop', 'str', nul), F('area', 'json', nul),
  ],
  anim: [
    F('id', 'int', 0, true), F('kind', 'str', '', true), F('name', 'str', nul), F('x', 'num', 0, true), F('y', 'num', 0, true),
    F('hp', 'json', nul), F('tame', 'bool', false), F('owner', 'ref', nul, true), F('pen', 'ref', nul), F('age', 'int', 0),
    F('job', 'json', nul, true), F('path', 'path', nul, true), F('st', 'json', nul),
    F('z', 'int', 0, true),
  ],
  foes: [
    F('id', 'int', 0, true), F('kind', 'str', '', true), F('raid', 'ref', nul), F('x', 'num', 0, true), F('y', 'num', 0, true),
    F('hp', 'json', nul), F('target', 'ref', nul), F('nem', 'ref', nul), F('job', 'json', nul, true), F('path', 'path', nul, true),
    F('st', 'json', nul),
    F('z', 'int', 0, true),
  ],
  raids: [
    F('id', 'int', 0, true), F('inc', 'str', ''), F('pts', 'int', 0), F('edge', 'json', nul), F('goal', 'str', nul),
    F('morale', 'int', 100), F('members', 'json', fresh([])), F('stage', 'str', 'warned'),
  ],
  nem: [
    F('id', 'int', 0, true), F('name', 'str', ''), F('epithet', 'str', ''), F('kind', 'str', ''), F('affixes', 'json', fresh([])),
    F('scar', 'str', nul), F('grudge', 'ref', nul), F('returns', 'int', 0), F('nextTick', 'int', 0),
  ],
};

/** Bill (5.7), an element of Building.bills. */
export function newBill(recipe, init = {}) {
  return { recipe, mode: 'until', n: 10, paused: false, ingredients: null, minSkill: 0, maxSkill: 20, radius: 999, store: 'best', quality: 0, ...init };
}
/** Job (5.3): a toil list. Owned by E (C7, provisional); the shape here is the saved one. */
export function newJob(type, target, toils = [], init = {}) {
  return { type, target, toils, i: 0, work: 0, haul: null, ...init };
}
/** Path: voxel index list (Uint32Array, C2 v3) plus cursor. Any array-like of indexes is copied in. */
export function newPath(tiles, i = 0) { return { tiles: tiles instanceof Uint32Array ? tiles : Uint32Array.from(tiles), i }; }

export function defaultSchedule() {
  const a = new Uint8Array(24).fill(SCHED.WORK);
  for (let h = 0; h < 24; h++) if (h >= 22 || h < 6) a[h] = SCHED.SLEEP; else if (h >= 18) a[h] = SCHED.JOY;
  return a;
}

// ---- Factories --------------------------------------------------------------------------------
const defOf = (f) => (typeof f.def === 'function' ? f.def() : f.def);

/** Make an entity of `kind` with every field at its default, then `init` applied. Unknown keys throw. */
export function make(kind, init = {}) {
  const spec = FIELDS[kind];
  if (!spec) throw new Error(`schema: unknown entity kind ${kind}`);
  const e = {};
  for (const f of spec) e[f.name] = defOf(f);
  for (const k of Object.keys(init)) {
    if (!(k in e)) throw new Error(`schema: ${kind} has no field ${k}`);
    e[k] = init[k];
  }
  return e;
}
export const newColonist = (id, init = {}) => make('col', { ...init, id });
export const newStack = (id, k, m, q, n, x, y, init = {}) => make('items', { ...init, id, k, m, q, n, x, y });
export const newBuilding = (id, def, x, y, rot = 0, mat = null, init = {}) => make('bld', { ...init, id, def, x, y, rot, mat });
export const newZone = (id, type, init = {}) => make('zones', { ...init, id, type });
export const newAnimal = (id, kind, init = {}) => make('anim', { ...init, id, kind });
export const newFoe = (id, kind, init = {}) => make('foes', { ...init, id, kind });
export const newRaid = (id, inc, init = {}) => make('raids', { ...init, id, inc });
export const newNemesis = (id, init = {}) => make('nem', { ...init, id });

// ---- Plain (JSON-safe) form ------------------------------------------------------------------
const clone = (v) => (v === null || typeof v !== 'object' ? v : JSON.parse(JSON.stringify(v)));
/** The typed-array class of a u8:<len> or u16:<len> field, else null. */
const TYPED_OF = { u8: Uint8Array, u16: Uint16Array };
export const typedOf = (f) => TYPED_OF[f.type.slice(0, f.type.indexOf(':'))] || null;
function plainOf(f, v) {
  if (v === null || v === undefined) return null;
  if (typedOf(f)) return Array.from(v);
  if (f.type === 'path') return { tiles: Array.from(v.tiles), i: v.i };
  return clone(v);
}
function liveOf(f, v) {
  if (v === null || v === undefined) return typedOf(f) ? defOf(f) : null;
  const T = typedOf(f);
  if (T) { const len = +f.type.slice(f.type.indexOf(':') + 1), a = new T(len); a.set(Array.from(v).slice(0, len)); return a; }
  if (f.type === 'path') return newPath(v.tiles, v.i);
  return clone(v);
}
/** Entity -> JSON-safe object (typed arrays to arrays). Fields not in the spec are dropped. */
export function toPlain(kind, e) {
  if (e === null) return null;
  const o = {};
  for (const f of FIELDS[kind]) o[f.name] = plainOf(f, e[f.name]);
  return o;
}
/** JSON-safe object -> entity. Missing fields take their default (forward-compatible additions). */
export function fromPlain(kind, o) {
  if (o === null) return null;
  const e = {};
  for (const f of FIELDS[kind]) e[f.name] = f.name in o ? liveOf(f, o[f.name]) : defOf(f);
  return e;
}
/** Positional array form (for save/fields.js): values in field order. */
export const toRow = (kind, e) => (e === null ? null : FIELDS[kind].map((f) => plainOf(f, e[f.name])));
export function fromRow(kind, row) {
  if (row === null) return null;
  const e = {}; const spec = FIELDS[kind];
  for (let i = 0; i < spec.length; i++) e[spec[i].name] = i < row.length ? liveOf(spec[i], row[i]) : defOf(spec[i]);
  return e;
}

// ---- State root -------------------------------------------------------------------------------
/** Saved collections of the root and their entity kinds (`null` slots allowed in items and bld). */
export const COLLECTIONS = Object.freeze({ col: 'col', items: 'items', bld: 'bld', zones: 'zones', anim: 'anim', foes: 'foes', raids: 'raids' });
/** Every key of the saved state root, in order (s.rt and s.L are handled separately). */
export const ROOT_KEYS = Object.freeze(['v', 'id', 'name', 'seed', 'w', 'h', 'tick', 'speed', 'rng', 'next', 'L',
  'colony', 'st', 'col', 'items', 'bld', 'zones', 'anim', 'foes', 'raids', 'rel', 'chron']);
/**
 * Root keys only a D > 1 state has (Stage Z1, before state v4 makes them every state's, 7.2): d (levels) and
 * zS (the surface level). A D = 1 state has neither, so its saves and hashes are Stage 2.9's.
 */
export const DEPTH_KEYS = Object.freeze(['d', 'zS']);

export function newColonyRecord() {
  return {
    tier: 0, hearth: { id: null, lvl: 1, fuel: 0 }, techs: new Uint8Array(TECH_BYTES), lore: 0,
    research: { cur: null, pts: 0 }, claims: [], factions: { league: 0, hearthwatch: 0, gutterkin: 0 }, deeds: [],
    storyteller: 'steady', difficulty: DEFAULT_DIFFICULTY, starts: 'remnant',
    tierSince: -1,          // K's tier streak start (tick, -1 none), 8.4
    storytellerDay: -1,     // game day of the last storyteller change (-1 never): once a year (9.1)
    ledger: {}, templates: [], ember: null,
    plans: [],   // 1a: carve-hall pillar plans [{ id, kind, rect, pattern, pillars, natural, built, tick }] (last 16)
    fallen: false,   // Stage 2.9: the hold has fallen (colony/fall.js; never cleared by the sim)
  };
}
export function newStoryRecord() {
  return { queue: [], tension: 0, lastMajorDay: -1, cooldowns: {}, history: [], nemeses: [] };
}
export const newIdCounters = () => Object.fromEntries(ID_KINDS.map((k) => [k, 1]));

/** colony / st records to and from plain form (techs is a typed bitset; nemeses are entities). */
export function colonyToPlain(c) { return { ...clone({ ...c, techs: null }), techs: Array.from(c.techs) }; }
export function colonyFromPlain(o) {
  const base = newColonyRecord();
  const c = { ...base, ...clone({ ...o, techs: null }) };
  c.techs = Uint8Array.from(o.techs || base.techs);
  return c;
}
export function storyToPlain(st) { return { ...clone({ ...st, nemeses: [] }), nemeses: st.nemeses.map((n) => toPlain('nem', n)) }; }
export function storyFromPlain(o) {
  const st = { ...newStoryRecord(), ...clone({ ...o, nemeses: [] }) };
  st.nemeses = (o.nemeses || []).map((n) => fromPlain('nem', n));
  return st;
}

// ---- Validation -------------------------------------------------------------------------------
const TYPE_OK = {
  int: (v) => Number.isInteger(v), num: (v) => typeof v === 'number' && Number.isFinite(v), str: (v) => typeof v === 'string',
  bool: (v) => typeof v === 'boolean', ref: (v) => Number.isInteger(v), json: () => true,
  path: (v) => v && v.tiles instanceof Uint32Array && Number.isInteger(v.i) && v.tiles.every((t) => t < N),
  tile: (v) => Number.isInteger(v) && v >= 0 && v < N,
};
/** True when a non-null value fits a scalar field type (int num str bool ref json path tile). */
export const fieldTypeOk = (type, v) => !!(TYPE_OK[type] && TYPE_OK[type](v));
/** Errors (strings) for one entity; [] when valid. Nullable: str/ref/json/path/tile fields may be null. */
export function checkEntity(kind, e) {
  const errs = [];
  for (const f of FIELDS[kind]) {
    const v = e[f.name];
    if (!(f.name in e)) { errs.push(`${kind}.${f.name} missing`); continue; }
    const T = typedOf(f);
    if (v === null) { if (f.type === 'int' || f.type === 'num' || f.type === 'bool' || T) errs.push(`${kind}.${f.name} null`); continue; }
    if (T) { const len = +f.type.slice(f.type.indexOf(':') + 1); if (!(v instanceof T) || v.length !== len) errs.push(`${kind}.${f.name} not ${T.name}(${len})`); continue; }
    if (!TYPE_OK[f.type](v)) errs.push(`${kind}.${f.name} not ${f.type}`);
  }
  for (const k of Object.keys(e)) if (!FIELDS[kind].some((f) => f.name === k)) errs.push(`${kind}.${k} not in schema`);
  return errs;
}

// ---- Voxel references (C2 v3: every saved voxel index, for the codec and the world migration) ----------
/** Fields of type `tile` per entity kind (FIELDS order). */
export const tileFields = (kind) => FIELDS[kind].filter((f) => f.type === 'tile').map((f) => f.name);
/** Fields of type `path` per entity kind. */
export const pathFields = (kind) => FIELDS[kind].filter((f) => f.type === 'path').map((f) => f.name);
/**
 * Every place in saved state that holds a voxel index besides the `tile` and `path` fields. Kinds:
 *   tile   one index (-1 or null = none)          tiles  an array of indexes
 *   key    a work-target key (jobs.js KEY): an index when key < INDEX_SPAN, else an entity key (left alone)
 * A job (col/anim/foes .job) holds: target (key), claims [[key, n]], toils [{ i (tile), key }], plus the
 * colonist's unreach list [[key, untilTick]]. Add a row here in the same change that saves a new one.
 */
export const VOXEL_REFS = Object.freeze([
  { where: 'col.job / anim.job / foes.job', kind: 'key', field: 'target' },
  { where: 'col.job / anim.job / foes.job', kind: 'key', field: 'claims[][0]' },
  { where: 'col.job / anim.job / foes.job', kind: 'tile', field: 'toils[].i' },
  { where: 'col.job / anim.job / foes.job', kind: 'key', field: 'toils[].key' },
  { where: 'col.unreach', kind: 'key', field: '[][0]' },
  { where: 'colony.plans', kind: 'tiles', field: '[].pillars, [].natural' },
  { where: 'raids', kind: 'tile', field: '[].edge.i' },
  { where: 'st.queue', kind: 'tile', field: '[].plan.edge.i' },
  { where: 'st.dis', kind: 'tiles', field: '[].tiles' },
  { where: 'rt.pathQ', kind: 'tile', field: '[][2] (goal)' },
  { where: 'rt.flow', kind: 'field', field: '[].f (one value per voxel; removed with the flow fields in E11)' },
]);
const isIdx = (v) => Number.isInteger(v) && v >= 0;
const mapKey = (v, fn) => (isIdx(v) && v < INDEX_SPAN ? fn(v, 'key') : v);
const mapTile = (v, fn) => (isIdx(v) ? fn(v, 'tile') : v);
function mapList(a, fn) { if (Array.isArray(a)) for (let k = 0; k < a.length; k++) a[k] = mapTile(a[k], fn); }
function mapJob(j, fn) {
  if (!j || typeof j !== 'object') return;
  if ('target' in j) j.target = mapKey(j.target, fn);
  if (Array.isArray(j.claims)) for (const c of j.claims) if (Array.isArray(c)) c[0] = mapKey(c[0], fn);
  if (Array.isArray(j.toils)) for (const t of j.toils) {
    if (!t || typeof t !== 'object') continue;
    if ('i' in t) t.i = mapTile(t.i, fn);
    if ('key' in t) t.key = mapKey(t.key, fn);
  }
}
/**
 * Apply fn(index, kind) -> index to every voxel index in a live state's saved part (VOXEL_REFS, `tile`
 * and `path` fields, rt.pathQ), in place. kind is 'tile' or 'key'. rt.flow (a per-voxel field) is left to
 * its owner. The world migration (E9) maps i -> i + zS * PLANE with this; the fields-tile test checks it.
 * Returns the count of indexes visited.
 */
export function mapVoxelRefs(s, fn) {
  let n = 0;
  const f = (v, k) => { n++; return fn(v, k); };
  for (const [key, kind] of Object.entries(COLLECTIONS)) {
    const tf = tileFields(kind), pf = pathFields(kind);
    for (const e of s[key]) {
      if (!e) continue;
      for (const name of tf) if (e[name] !== null && e[name] !== undefined) e[name] = mapTile(e[name], f);
      for (const name of pf) { const p = e[name]; if (p && p.tiles) for (let k = 0; k < p.tiles.length; k++) p.tiles[k] = f(p.tiles[k], 'tile'); }
      if ('job' in e) mapJob(e.job, f);
      if (Array.isArray(e.unreach)) for (const u of e.unreach) if (Array.isArray(u)) u[0] = mapKey(u[0], f);
      if (kind === 'raids' && e.edge && typeof e.edge === 'object') e.edge.i = mapTile(e.edge.i, f);
    }
  }
  for (const p of s.colony.plans || []) { if (p) { mapList(p.pillars, f); mapList(p.natural, f); } }
  for (const q of s.st.queue || []) if (q && q.plan && q.plan.edge && typeof q.plan.edge === 'object') q.plan.edge.i = mapTile(q.plan.edge.i, f);
  for (const d of s.st.dis || []) if (d) mapList(d.tiles, f);
  if (s.rt && Array.isArray(s.rt.pathQ)) for (const r of s.rt.pathQ) if (Array.isArray(r)) r[2] = mapTile(r[2], f);
  return n;
}
