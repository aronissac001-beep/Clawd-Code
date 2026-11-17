// Contract C7 (owner E; reviewers F, H, K; provisional until the 1a fun review): the work-giver
// and toil contract (doc 5.3), plus the small shared pieces every work module needs (target keys,
// the reservation value format and its read side, the mover hook, unreachable memory, the think
// request). This file imports nothing from js/game/work/, so items.js, reserve.js, toils.js and
// think.js can all depend on it without cycles.
//
// Layering (no cycles):
//   jobs.js (contract) <- items.js (C6) <- reserve.js (claims, beginJob, endJob) <- toils.js (runner) <- think.js
//
// Determinism (14.1): everything here is saved data or a pure function of saved data. Job, toil
// and claim records are plain JSON (saved with the colonist, short keys). Registries hold code,
// never state; registration order never changes a result (givers are sorted by order, then id).

import { WORK_IDS } from '../core/schema.js';

// ---- Tuning (until G's js/data/balance.js WORK section exists; content.js calls setWorkBalance) --
/** Work numbers from the doc (5.3, 5.4, 12.3). Read through WORK; override with setWorkBalance. */
export const WORK = {
  thinksPerTick: 6,      // 5.3: at most 6 thinks per tick colony-wide
  candidatesK: 12,       // 5.3: give up after 12 valid-looking candidates
  unreachTicks: 600,     // 5.3: unreachable memory lasts 600 ticks
  rethinkTicks: 60,      // 5.3: interruptible jobs re-think every 60 ticks (Stage 1a)
  idleWaitTicks: 60,     // idle fallback: wait this long, then think again
  maxToilSteps: 8,       // instant toils (reserve, pickup, drop) chained in one tick, at most this many
  gotoRetries: 3,        // a goto that ends off its goal re-requests a path this many times, then fails
  spillRadius: 6,        // items.put: rings searched for room around the drop tile (169 tiles)
  stockRecompute: 14400, // 13.3: stock full recompute every 14,400 ticks
};
/** Merge balance overrides (numbers only, known keys only). */
export function setWorkBalance(patch) {
  for (const k of Object.keys(patch || {})) {
    if (!(k in WORK)) throw new Error(`jobs: unknown WORK key ${k}`);
    if (!Number.isInteger(patch[k]) || patch[k] < 0) throw new Error(`jobs: WORK.${k} must be a non-negative integer`);
    WORK[k] = patch[k];
  }
}

// ---- Target keys (5.4) ----------------------------------------------------------------------
/** Integer target keys: one number space for tiles, item stacks, buildings, colonists, animals. */
export const KEY = Object.freeze({ TILE: 0, ITEM: 1e6, BLD: 2e6, COL: 3e6, ANIM: 4e6, SPAN: 1e6 });
export const keyTile = (i) => i;                 // tile index (N <= 65,536)
export const keyItem = (id) => KEY.ITEM + id;    // s.items index
export const keyBld = (id) => KEY.BLD + id;      // s.bld index
export const keyCol = (id) => KEY.COL + id;      // colonist id (rescue, tend)
export const keyAnim = (id) => KEY.ANIM + id;    // animal id (K: tame, milk, slaughter)
/** 'tile' | 'item' | 'bld' | 'col' | 'anim' */
export function keyKind(key) {
  if (key < KEY.ITEM) return 'tile';
  if (key < KEY.BLD) return 'item';
  if (key < KEY.COL) return 'bld';
  if (key < KEY.ANIM) return 'col';
  return 'anim';
}
/** The id or tile index inside a key. */
export const keyId = (key) => key % KEY.SPAN;

// ---- Reservations: value format and read side (writers live in reserve.js) -------------------
// s.rt.res : Map<key, Array<[holder, n]>>, pairs sorted by holder (colonist id).
//   n = 0  exclusive (the whole target: a tile to mine, a bench, a bed, a frame, a whole stack)
//   n > 0  a count of an item stack (two haulers can split one stack)
// It is exactly a function of the saved jobs (job.claims of every colonist). Never iterate it in
// sim code (Map order is insertion order, which a rebuild does not reproduce): only look up keys.

/** Pairs on a key, or null. */
export const claimsOn = (s, key) => s.rt.res.get(key) || null;
/** True when someone other than `holder` (default: anyone) holds a claim on key. */
export function isReserved(s, key, holder = -1) {
  const p = s.rt.res.get(key);
  if (!p) return false;
  for (let i = 0; i < p.length; i++) if (p[i][0] !== holder) return true;
  return false;
}
/** Count reserved on key by others than holder; Infinity when another holds it exclusively. */
export function reservedByOthers(s, key, holder = -1) {
  const p = s.rt.res.get(key);
  if (!p) return 0;
  let n = 0;
  for (let i = 0; i < p.length; i++) {
    if (p[i][0] === holder) continue;
    if (p[i][1] === 0) return Infinity;
    n += p[i][1];
  }
  return n;
}
/** The count holder has on key: 0 exclusive, > 0 partial, -1 none. */
export function myClaim(s, key, holder) {
  const p = s.rt.res.get(key);
  if (p) for (let i = 0; i < p.length; i++) if (p[i][0] === holder) return p[i][1];
  return -1;
}

// ---- Toils (5.3) ----------------------------------------------------------------------------
/**
 * A toil is a plain saved object `{ t, ...args }`. Handlers are registered by name (toils.js
 * registers the core set; specialisations and perks add their own with registerToil).
 * Core toils:
 *   goto     { t, i, adj }       walk to tile i (adj 1: stop on any 8-neighbour)
 *   reserve  { t, key, n }       claim a target mid-job (n 0 exclusive, > 0 a stack count)
 *   pickup   { t, id, n }        take up to n from stack id into the job's carry (must stand on it)
 *   carry    { t, i, adj }       goto that fails when nothing is carried
 *   drop     { t, i }            put the carry down at tile i (-1: where the colonist stands)
 *   work     { t, n, sk, fx, key } n work in ticks at speed 1.0 (game minutes x 10); sk skill id
 *                                  for XP and speed; fx effect run on completion; key: a target that
 *                                  must still be claimed by this job while working (-1 none)
 *   useBench { t, b, n, sk, fx } work at building b (must exist and be claimed by this job)
 *   wait     { t, n }            stand for n ticks
 * @typedef {{ t: string, [arg: string]: any }} Toil
 */
export const T = Object.freeze({
  goto: (i, adj = false) => ({ t: 'goto', i, adj: adj ? 1 : 0 }),
  reserve: (key, n = 0) => ({ t: 'reserve', key, n }),
  pickup: (id, n) => ({ t: 'pickup', id, n }),
  carry: (i, adj = false) => ({ t: 'carry', i, adj: adj ? 1 : 0 }),
  drop: (i = -1) => ({ t: 'drop', i }),
  work: (n, { sk = null, fx = null, key = -1 } = {}) => ({ t: 'work', n, sk, fx, key }),
  useBench: (b, n, { sk = null, fx = null } = {}) => ({ t: 'useBench', b, n, sk, fx }),
  wait: (n) => ({ t: 'wait', n }),
});

/** Toil handler results: RUN (stay on this toil next tick), NEXT (advance now), or a failure reason string. */
export const RUN = 0, NEXT = 1;

/**
 * @callback ToilHandler
 * @param {object} s state  @param {object} col colonist  @param {Job} job  @param {Toil} toil
 * @returns {0|1|string} RUN, NEXT or a failure reason (the runner then calls endJob(s, col, reason))
 */
const TOILS = new Map();
/** Register a toil handler by name (later registration of the same name replaces it). */
export function registerToil(name, fn) {
  if (typeof name !== 'string' || typeof fn !== 'function') throw new Error('jobs: registerToil(name, fn)');
  TOILS.set(name, fn);
}
export const toilHandler = (name) => TOILS.get(name) || null;
export const toilNames = () => [...TOILS.keys()].sort();

/**
 * Effects run when a work / useBench toil completes: fn(s, col, job, toil) -> undefined | failure
 * string. Named so the toil stays plain data (e.g. 'mine' -> terrain.mineTile, 'build' -> frame done).
 */
const EFFECTS = new Map();
export function registerEffect(name, fn) { EFFECTS.set(name, fn); }
export const effectOf = (name) => EFFECTS.get(name) || null;

// ---- Jobs (5.3) -----------------------------------------------------------------------------
/**
 * A job, saved with the colonist (col.job; schema field `job`, json). Extends schema.newJob.
 * @typedef {object} Job
 * @property {string} type     job type (usually the giver id: 'mine', 'haul', 'idle')
 * @property {number} target   target key (KEY.*) or -1
 * @property {Toil[]} toils    the toil list
 * @property {number} i        current toil index
 * @property {number} work     progress of the current toil (work toils: x100 fixed point)
 * @property {{itemId:number,count:number}|null} haul  haul plan (5.6)
 * @property {Array<[number, number]>} claims  [key, n] claims held by this job (reserve.js writes)
 * @property {Bundle|null} carry  items carried (items.js Bundle); dropped by endJob if still held
 * @property {object|null} ts  toil scratch (reset when the toil advances), e.g. goto retries
 * @property {number} t0      tick the job started
 * @property {string|null} giver  work-giver id that made it
 */
export function makeJob(type, target, toils, init = {}) {
  return { type, target, toils, i: 0, work: 0, haul: null, claims: [], carry: null, ts: null, t0: 0, giver: null, ...init };
}
/** Current toil or null. */
export const curToil = (job) => (job && job.i < job.toils.length ? job.toils[job.i] : null);

/**
 * Per job type hooks: { onEnd(s, col, job, reason) } (e.g. construct drops a cancelled frame's
 * materials; haul clears a plan). Runs inside endJob after claims are released and the carry dropped.
 */
const JOB_TYPES = new Map();
export function registerJobType(type, hooks) { JOB_TYPES.set(type, hooks); }
export const jobTypeOf = (type) => JOB_TYPES.get(type) || null;

/** endJob reasons (5.4: every exit goes through endJob). Others may be added; failure toils return free text. */
export const END = Object.freeze({
  DONE: 'done', FAIL: 'fail', INTERRUPT: 'interrupt', DEATH: 'death', DRAFT: 'draft', DOWNED: 'downed',
  BREAK: 'break', DESPAWN: 'despawn', TARGET_GONE: 'targetGone', UNREACHABLE: 'unreachable', CANCEL: 'cancel',
  BAD_TOIL: 'badToil', RETHINK: 'rethink',
});
/** Reasons after which the colonist does not queue a think (it is gone or cannot act). */
export const NO_THINK = new Set([END.DEATH, END.DESPAWN, END.DOWNED]);

// ---- Work givers (5.3) ----------------------------------------------------------------------
/**
 * A work giver (js/game/work/givers/*.js), registered through BUS.workGivers.
 * @typedef {object} WorkGiver
 * @property {string} id      unique id ('mine', 'haul', 'build')
 * @property {string} work    work type id (schema WORK_IDS)
 * @property {number} [order] order inside the work type (lower first; ties by id)
 * @property {(s:object, c:object, k:number) => any[]} candidates  cheap nearest-first targets from an index, at most k
 * @property {(s:object, c:object, target:any) => boolean} valid   still valid now (reserved? forbidden? skill?)
 * @property {(s:object, c:object, target:any) => ({job: Job, claims: Array<[number, number]>}|Job|null)} make
 *           build the job; claims listed here are taken atomically by beginJob (all or none)
 * @property {(target:any) => number} [keyOf]  target key, for unreachable memory (default: the target if a number)
 */
export function checkGiver(g) {
  const errs = [];
  if (!g || typeof g.id !== 'string') errs.push('id');
  if (!WORK_IDS.includes(g && g.work)) errs.push(`work ${g && g.work}`);
  for (const f of ['candidates', 'valid', 'make']) if (!g || typeof g[f] !== 'function') errs.push(f);
  return errs;
}
/** Givers of a work type from a list (BUS.workGivers), in a registration-independent order. */
export function giversFor(list, work) {
  const out = [];
  for (let i = 0; i < list.length; i++) if (list[i].work === work) out.push(list[i]);
  out.sort((a, b) => (a.order || 0) - (b.order || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

// ---- Movement hook (B provides requestPath and movement; Stage 0 uses toils.straightMover) ----
/**
 * @typedef {object} Mover
 * @property {(s, col, goal:number, adj:boolean) => boolean} request  ask for a path (may be queued, 12.3);
 *           false when the goal is known unreachable now (region labels), with no A* call
 * @property {(s, col, goal:number, adj:boolean) => 'none'|'pending'|'moving'|'failed'} status
 * @property {(s, col) => void} stop  drop the colonist's path and any queued request
 */
let MOVER = null;
export function setMover(m) { MOVER = m; }
export const getMover = () => MOVER;

// ---- Hooks into F (skills, speed) until the modifier engine and F's skills land ------------------
/** speed(s, col, toil) -> integer x100 (100 = speed 1.0); xp(s, col, skillId, ticks) awards XP. */
const WORK_HOOKS = { speed: () => 100, xp: null };
export function setWorkHooks(h) { Object.assign(WORK_HOOKS, h); }
export const workHooks = () => WORK_HOOKS;

// ---- Unreachable memory (5.3; saved on the colonist as [[key, untilTick]]) -------------------
export function isUnreachable(s, col, key) {
  const u = col.unreach;
  for (let i = 0; i < u.length; i++) if (u[i][0] === key && u[i][1] > s.tick) return true;
  return false;
}
export function markUnreachable(s, col, key, ticks = WORK.unreachTicks) {
  if (key < 0) return;
  const until = s.tick + ticks;
  for (const e of col.unreach) if (e[0] === key) { e[1] = until; return; }
  col.unreach.push([key, until]);
}
/** Drop expired entries (in place, order kept). */
export function pruneUnreachable(s, col) {
  const u = col.unreach;
  let w = 0;
  for (let r = 0; r < u.length; r++) if (u[r][1] > s.tick) u[w++] = u[r];
  u.length = w;
}

// ---- Think requests (s.rt.thinkQ, saved FIFO of colonist ids; think.js drains it) -----------
/** Queue a think for a colonist (no duplicates). */
export function requestThink(s, colId) {
  const q = s.rt.thinkQ;
  for (let i = 0; i < q.length; i++) if (q[i] === colId) return false;
  q.push(colId);
  return true;
}
