// Contract C3 (owner A; reviewer I; frozen at the end of Stage 0, additions any time):
// command names, payloads and validators (doc 13.3). The UI never mutates state: it sends
// commands. A command is a plain JSON object { t: <name>, ...payload }. Invalid commands are
// dropped with a reason (the UI shows it as a toast). The determinism tool records [tick, cmd]
// logs. Speed is not a command (it is not sim state).
//
// Shared payload shapes (C3 v3, EMBERCROWN-FORTRESS.md 7.4: every rect and point carries a level z,
// 0 <= z < D; it is optional and reads as 0 when absent, which is the only level of a D = 1 map)
//   rect   { x0, y0, x1, y1, z? }  inclusive tile corners on one level, any order, inside the map
//   tile   { x, y, z? }            tile coordinates inside the map
//   target { x, y } | { id, kind }   kind: 'col' | 'anim' | 'foe' | 'bld' | 'item'
//   goods  [{ k, m?, q?, n }]  item kind, material, quality, count
//
// Appliers are owned by the systems that implement them and plug in with registerApplier(name, fn).
// Until then each command has a stub applier that validates and changes nothing.

import { W, H, D, N, cheb, DESIG_KINDS, ZONE_MAX } from './grid.js';
import { WORK_IDS } from './schema.js';
import { colById, bldById, zoneById } from './state.js';

// ---- Content lookup (G's registry plugs in here; Stage 0 accepts any well-formed id) ---------
const ID_RE = /^[a-z][a-z0-9_:-]{0,47}$/;
let contentHas = null;
/** fn(kind, id) -> boolean; kinds: structure material role recipe tech stamp outfit item zonePreset crop town. */
export function setContentLookup(fn) { contentHas = fn; }
const known = (kind, id) => (contentHas ? contentHas(kind, id) : true);

// ---- Field checks: each returns null (ok) or a reason ----------------------------------------
const isInt = Number.isInteger;
const int = (lo, hi) => (v) => (isInt(v) && v >= lo && v <= hi ? null : `must be an integer ${lo}-${hi}`);
const bool = (v) => (typeof v === 'boolean' ? null : 'must be true or false');
const id = (kind) => (v) => (typeof v !== 'string' || !ID_RE.test(v) ? 'must be an id' : known(kind, v) ? null : `unknown ${kind} ${v}`);
const oneOf = (list) => (v) => (list.includes(v) ? null : `must be one of ${list.join(', ')}`);
const opt = (f) => (v, s, c) => (v === undefined || v === null ? null : f(v, s, c));
const text = (max) => (v) => (typeof v === 'string' && v.length <= max ? null : `must be text up to ${max} characters`);
function tileXY(x, y) { return isInt(x) && isInt(y) && x >= 0 && y >= 0 && x < W && y < H; }
/** A level: absent (level 0) or an integer 0..D-1. */
const zOk = (z) => z === undefined || (isInt(z) && z >= 0 && z < D);
/** The level of a payload (rect, tile, command): its z, or 0. */
export const zOf = (v) => (v && isInt(v.z) ? v.z : 0);
const level = (v) => (zOk(v) ? null : `must be a level 0-${D - 1}`);
const rect = (v) => {
  if (!v || typeof v !== 'object') return 'must be a rectangle';
  for (const k of ['x0', 'y0', 'x1', 'y1']) if (!isInt(v[k])) return 'rectangle corners must be integers';
  if (!tileXY(v.x0, v.y0) || !tileXY(v.x1, v.y1)) return 'rectangle is off the map';
  if (!zOk(v.z)) return 'rectangle level is off the map';
  return null;
};
const tile = (v) => (v && tileXY(v.x, v.y) && zOk(v.z) ? null : 'must be a tile on the map');
/** `levels` (1-10) from the rect's level in `dir` ('down' default) must stay inside the map. */
const levelsIn = (c) => {
  if (c.levels === undefined) return null;
  const z = zOf(c.rect), n = c.levels;
  return (c.dir === 'up' ? z + n - 1 < D : z - n + 1 >= 0) ? null : 'those levels run off the map';
};
const TARGET_KINDS = ['col', 'anim', 'foe', 'bld', 'item'];
const target = (v) => {
  if (!v || typeof v !== 'object') return 'must be a target';
  if ('id' in v) return isInt(v.id) && v.id >= 0 && TARGET_KINDS.includes(v.kind) ? null : 'target needs an id and kind';
  return tile(v);
};
const colId = (v, s) => (isInt(v) && colById(s, v) ? null : 'no such colonist');
const colIds = (v, s) => {
  if (!Array.isArray(v) || v.length === 0 || v.length > 40) return 'must list 1-40 colonists';
  if (new Set(v).size !== v.length) return 'colonist listed twice';
  for (const x of v) if (colId(x, s)) return 'no such colonist';
  return null;
};
const bId = (v, s) => (bldById(s, v) ? null : 'no such building');
const zoneId = (v, s) => (isInt(v) && v >= 1 && v <= ZONE_MAX && zoneById(s, v) ? null : 'no such zone');
const nonNegId = int(0, 0x7fffffff);
const ids = (v) => (Array.isArray(v) && v.length > 0 && v.length <= 4000 && v.every((x) => isInt(x) && x >= 0) ? null : 'must list ids');
const goods = (v) => {
  if (!Array.isArray(v) || v.length > 64) return 'must list goods';
  for (const g of v) {
    if (!g || typeof g !== 'object') return 'bad goods entry';
    if (id('item')(g.k)) return id('item')(g.k);
    if (g.m !== undefined && g.m !== null && id('material')(g.m)) return id('material')(g.m);
    if (g.q !== undefined && int(0, 6)(g.q)) return 'quality must be 0-6';
    if (int(1, 100000)(g.n)) return 'count must be 1-100000';
  }
  return null;
};
const linePath = (v) => {
  if (!Array.isArray(v) || v.length === 0 || v.length > 512) return 'must be a line of 1-512 tiles';
  for (let i = 0; i < v.length; i++) {
    const p = v[i];
    if (!Array.isArray(p) || !tileXY(p[0], p[1]) || !zOk(p[2])) return 'line tile off the map';
    if (i && zOf({ z: p[2] }) !== zOf({ z: v[0][2] })) return 'line tiles must be on one level';
    if (i && cheb(p[0], p[1], v[i - 1][0], v[i - 1][1]) !== 1) return 'line tiles must touch';
  }
  return null;
};
const exactlyOne = (a, b) => (c) => ((c[a] !== undefined) !== (c[b] !== undefined) ? null : `needs ${a} or ${b}`);

export const DESIG_NAMES = Object.freeze(Object.keys(DESIG_KINDS));
export const CANCEL_KINDS = Object.freeze([...DESIG_NAMES, 'bp', 'zone', 'bill']);
export const ZONE_TYPES = Object.freeze(['stockpile', 'grow', 'pen', 'burial', 'home', 'area', 'dump']);
export const ZONE_OPS = Object.freeze(['new', 'expand', 'shrink', 'delete']);
export const BILL_OPS = Object.freeze(['add', 'edit', 'remove', 'move']);
export const BILL_MODES = Object.freeze(['count', 'until', 'forever']);
export const ORDER_KINDS = Object.freeze(['move', 'attack', 'hold', 'guard', 'retreat', 'sally']);
export const CARVE_PATTERNS = Object.freeze(['natural', 'pillar', 'prop']);
export const ROTS = Object.freeze([0, 1, 2, 3]);

const zoneCfgPatch = (v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'patch must be an object';
  for (const k of Object.keys(v)) {
    const val = v[k];
    if (k === 'name') { if (text(40)(val)) return text(40)(val); }
    else if (k === 'pri') { if (int(0, 3)(val)) return 'priority must be 0-3'; }
    else if (k === 'filter') {
      if (!val || !Array.isArray(val.cats) || !Array.isArray(val.mats) || !Array.isArray(val.q) || val.q.length !== 2) return 'bad filter';
      if (int(0, 6)(val.q[0]) || int(0, 6)(val.q[1]) || val.q[0] > val.q[1]) return 'bad quality range';
    } else if (k === 'crop') { if (opt(id('crop'))(val)) return opt(id('crop'))(val); }
    else if (k === 'area') { if (val !== null && typeof val !== 'object') return 'bad area'; }
    else return `zone has no setting ${k}`;
  }
  return null;
};
const billPayload = (v, s, c) => {
  if (!v || typeof v !== 'object') return 'needs a bill';
  const b = bldById(s, c.bId);
  const nb = b ? b.bills.length : 0;
  if (c.op === 'add') {
    if (nb >= 10) return 'a workbench holds at most 10 bills';
    if (id('recipe')(v.recipe)) return id('recipe')(v.recipe);
  } else {
    if (int(0, Math.max(0, nb - 1))(v.i) || nb === 0) return 'no such bill';
    if (c.op === 'move' && (int(0, Math.max(0, nb - 1))(v.to))) return 'bad bill position';
  }
  if (c.op === 'add' || c.op === 'edit') {
    if (v.mode !== undefined && oneOf(BILL_MODES)(v.mode)) return oneOf(BILL_MODES)(v.mode);
    if (v.n !== undefined && int(0, 9999)(v.n)) return 'count must be 0-9999';
    if (v.paused !== undefined && bool(v.paused)) return 'paused must be true or false';
    if (v.minSkill !== undefined && int(0, 20)(v.minSkill)) return 'skill must be 0-20';
    if (v.maxSkill !== undefined && int(0, 20)(v.maxSkill)) return 'skill must be 0-20';
    if (v.radius !== undefined && int(1, 999)(v.radius)) return 'radius must be 1-999';
    if (v.quality !== undefined && int(0, 6)(v.quality)) return 'quality must be 0-6';
  }
  return null;
};
const hours = (v) => (Array.isArray(v) && v.length === 24 && v.every((h) => isInt(h) && h >= 0 && h <= 3) ? null : 'must be 24 hour cells of 0-3');

/**
 * Command specs: name -> { fields: { field: check }, rule?: (cmd, s) -> reason | null }.
 * Every field listed is required unless its check is wrapped in opt().
 * Stage 2.9 (EMBERCROWN-FORTRESS.md 1.2, 1.4; step S9.5a): no command makes a pick-1-of-N choice or
 * summons a threat. The charter, specialisation, perk and Pyre commands are gone: renown, add-ons and
 * perks are earned by what the hold does, and great beasts come only when a cause holds.
 */
export const COMMANDS = Object.freeze({
  designate: { fields: { kind: oneOf(DESIG_NAMES), rect, add: bool, levels: opt(int(1, 10)), dir: opt(oneOf(['down', 'up'])) }, rule: levelsIn },
  cancelRect: { fields: { rect, kinds: (v) => (Array.isArray(v) && v.length && v.every((k) => CANCEL_KINDS.includes(k)) ? null : `kinds must be from ${CANCEL_KINDS.join(', ')}`) } },
  place: { fields: { def: id('structure'), x: int(0, 65535), y: int(0, 65535), z: level, rot: oneOf(ROTS), mat: opt(id('material')) }, rule: (c) => (tileXY(c.x, c.y) ? null : 'off the map') },
  placeLine: { fields: { def: id('structure'), path: linePath, mat: opt(id('material')) } },
  stamp: { fields: { kind: id('stamp'), rect, wallMat: opt(id('material')), floorMat: opt(id('material')), door: opt(tile), furnish: bool, bench: opt(id('structure')) } },
  carve: { fields: { rect, pattern: oneOf(CARVE_PATTERNS), smooth: bool, levels: opt(int(1, 10)), dir: opt(oneOf(['down', 'up'])) }, rule: levelsIn },
  copyRoom: { fields: { roomId: int(1, 65535) } },
  paste: { fields: { templateId: nonNegId, x: int(0, 65535), y: int(0, 65535), z: level, rot: oneOf(ROTS) }, rule: (c) => (tileXY(c.x, c.y) ? null : 'off the map') },
  deconstruct: { fields: { ids: opt(ids), rect: opt(rect) }, rule: exactlyOne('ids', 'rect') },
  zone: {
    fields: { op: oneOf(ZONE_OPS), type: opt(oneOf(ZONE_TYPES)), rect: opt(rect), zoneId: opt(zoneId), preset: opt(id('zonePreset')) },
    rule: (c, s) => {
      if (c.op === 'new') { if (!c.type || !c.rect) return 'a new zone needs a type and a rectangle'; if (s.zones.length >= ZONE_MAX) return 'too many zones'; }
      else if (c.zoneId === undefined || c.zoneId === null) return 'needs a zone';
      if ((c.op === 'expand' || c.op === 'shrink') && !c.rect) return 'needs a rectangle';
      return null;
    },
  },
  zoneCfg: { fields: { zoneId, patch: zoneCfgPatch } },
  bill: { fields: { op: oneOf(BILL_OPS), bId, bill: billPayload } },
  role: { fields: { colId, primary: id('role'), secondary: opt(id('role')) }, rule: (c) => (c.secondary && c.secondary === c.primary ? 'second role must differ' : null) },
  prio: { fields: { colId, work: oneOf(WORK_IDS), p: int(0, 4) } },
  sched: { fields: { colId, hours } },
  soldier: { fields: { colId, on: bool } },
  draft: { fields: { colIds, on: bool } },
  order: {
    fields: { colIds, kind: oneOf(ORDER_KINDS), target: opt(target) },
    rule: (c) => ((c.kind === 'hold' || c.kind === 'retreat') || c.target ? null : 'needs a target'),
  },
  prioritise: { fields: { colId, target, work: oneOf(WORK_IDS) } },
  forbid: { fields: { ids: opt(ids), rect: opt(rect), on: bool }, rule: exactlyOne('ids', 'rect') },
  upgrade: { fields: { bId } },
  assign: { fields: { bId, colId: (v, s) => (v === null ? null : colId(v, s)) } },
  outfit: { fields: { colId, outfit: id('outfit') } },
  research: { fields: { tech: id('tech') } },
  letter: { fields: { id: nonNegId, choice: int(0, 9) } },
  trade: { fields: { visitId: nonNegId, buy: goods, sell: goods } },
  caravan: { fields: { colIds, goods, town: id('town') } },
  garrison: { fields: { colId, bId } },
  vigil: { fields: { colId, bId } },
  feast: { fields: { roomId: int(1, 65535) } },
});
export const COMMAND_NAMES = Object.freeze(Object.keys(COMMANDS));

/** null when valid, else the reason (shown as a toast). */
export function validateCommand(s, cmd) {
  if (!cmd || typeof cmd !== 'object') return 'not a command';
  const spec = COMMANDS[cmd.t];
  if (!spec) return `unknown command ${cmd.t}`;
  for (const k of Object.keys(cmd)) if (k !== 't' && !(k in spec.fields)) return `${cmd.t}: unexpected field ${k}`;
  for (const [k, check] of Object.entries(spec.fields)) {
    const r = check(cmd[k], s, cmd);
    if (r) return `${cmd.t}.${k}: ${r}`;
  }
  return spec.rule ? spec.rule(cmd, s) : null;
}

// ---- Appliers ---------------------------------------------------------------------------------
const appliers = new Map();
/** Owner systems plug in: fn(s, cmd) -> { ok: true, ...result } | { ok: false, reason }. */
export function registerApplier(name, fn) {
  if (!(name in COMMANDS)) throw new Error(`commands: unknown command ${name}`);
  appliers.set(name, fn);
}
export const hasApplier = (name) => appliers.has(name);
export function resetAppliers() { appliers.clear(); }

/**
 * Validate and apply one command (between ticks). Returns { ok, reason?, stub? }.
 * `log`, when given, receives [s.tick, cmd] for every accepted command (determinism tool).
 */
export function applyCommand(s, cmd, log = null) {
  const reason = validateCommand(s, cmd);
  if (reason) return { ok: false, reason };
  if (log) log.push([s.tick, JSON.parse(JSON.stringify(cmd))]);
  const fn = appliers.get(cmd.t);
  if (!fn) return { ok: true, stub: true };
  const r = fn(s, cmd) || { ok: true };
  return r;
}

/** Map area guard for UI previews: the number of tiles a rect covers (validators keep it inside the map). */
export const rectTiles = (r) => (Math.abs(r.x1 - r.x0) + 1) * (Math.abs(r.y1 - r.y0) + 1);
export const MAX_RECT_TILES = () => N;
