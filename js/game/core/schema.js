// Contract C2 (owner A; reviewers: all). The state schema: the source of truth for the saved
// state root, entity ids, RNG streams and every entity's fields (doc 13.2).
//   C2-core (frozen at the end of Stage 0): the state root, ids, RNG streams, and the core fields
//   of Colonist, Stack, Building and Zone (id, kind or def, position, owner, job, path).
//   C2-full (provisional until the 1a fun review): every other field. Fields may be ADDED any time
//   (with a default); existing ones are not renamed or retyped after the freeze.
//
// Conventions
// - Colonist, Animal and Foe positions (x, y) are WORLD units (TILE = 32 per tile, floats allowed);
//   Stack and Building positions are TILE coordinates (integers).
// - Stacks and Buildings use their array index as id: s.items[id], s.bld[id] (null = free slot;
//   a new one always takes the lowest free index, 5.5). Colonists, animals, foes, raids, zones and
//   nemeses take ids from s.next (monotonic, never reused) except zones, which reuse 1..254.
// - Needs and mood are fixed-point integers: 0..100 is stored x100 (0..10000) (14.1).
// - Positional arrays (sk, need, at, prio, sched) follow the fixed id orders below; js/data files
//   must use the same orders (validate-data checks).
// - No Map or Set in saved state; plain objects only where 13.2 says so (rel, cooldowns), and code
//   must not depend on their key order.

import { STREAMS } from './rand.js';
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
export const STATE_VERSION = 3;
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
    F('path', 'path', nul, true),                                // { tiles: Uint16Array, i } or null
    F('unreach', 'json', fresh([])),                             // [[targetKey, untilTick]]
    F('log', 'json', fresh([])), F('breakState', 'json', nul), F('inspo', 'json', nul),
    F('done', `u16:${DONE_LEN}`, () => new Uint16Array(DONE_LEN)),   // Stage 2.9: deed counters by position (data/deeds-col.js, 3.1)
  ],
  items: [
    F('id', 'int', 0, true), F('k', 'str', '', true), F('m', 'str', nul), F('q', 'int', 0), F('n', 'int', 1, true),
    F('x', 'int', 0, true), F('y', 'int', 0, true), F('hp', 'int', 100), F('f', 'bool', false), F('age', 'int', 0),
    F('name', 'str', nul), F('maker', 'ref', nul),
  ],
  bld: [
    F('id', 'int', 0, true), F('def', 'str', '', true), F('x', 'int', 0, true), F('y', 'int', 0, true),
    F('rot', 'int', 0, true), F('mat', 'str', nul), F('q', 'int', 0), F('hp', 'int', 100),
    F('st', 'str', 'bp', true), F('need', 'json', fresh({})), F('got', 'json', fresh({})), F('work', 'int', 0),
    F('lvl', 'int', 1), F('owner', 'ref', nul, true), F('fuel', 'int', 0),
    F('bills', 'json', fresh([])), F('link', 'ref', nul), F('name', 'str', nul), F('maker', 'ref', nul),
    F('dcon', 'bool', false),                                    // 1a: marked for deconstruction (a Build job)
  ],
  zones: [
    F('id', 'int', 0, true), F('type', 'str', 'stockpile', true), F('name', 'str', ''), F('pri', 'int', 1),
    F('filter', 'json', fresh({ cats: [], mats: [], q: [0, 6] })), F('crop', 'str', nul), F('area', 'json', nul),
  ],
  anim: [
    F('id', 'int', 0, true), F('kind', 'str', '', true), F('name', 'str', nul), F('x', 'num', 0, true), F('y', 'num', 0, true),
    F('hp', 'json', nul), F('tame', 'bool', false), F('owner', 'ref', nul, true), F('pen', 'ref', nul), F('age', 'int', 0),
    F('job', 'json', nul, true), F('path', 'path', nul, true), F('st', 'json', nul),
  ],
  foes: [
    F('id', 'int', 0, true), F('kind', 'str', '', true), F('raid', 'ref', nul), F('x', 'num', 0, true), F('y', 'num', 0, true),
    F('hp', 'json', nul), F('target', 'ref', nul), F('nem', 'ref', nul), F('job', 'json', nul, true), F('path', 'path', nul, true),
    F('st', 'json', nul),
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
/** Path: tile index list plus cursor. */
export function newPath(tiles, i = 0) { return { tiles: tiles instanceof Uint16Array ? tiles : Uint16Array.from(tiles), i }; }

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
  path: (v) => v && v.tiles instanceof Uint16Array && Number.isInteger(v.i),
};
/** Errors (strings) for one entity; [] when valid. Nullable: str/ref/json/path fields may be null. */
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
