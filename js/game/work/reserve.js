// Reservations (doc 5.4; owner E). s.rt.res is EXACTLY a function of the saved jobs (C13 class
// derived-exact): Map<key, Array<[holder, n]>> built from every colonist's job.claims. The only
// writers are claim() / release() / releaseAll() below, and they always change job.claims and
// s.rt.res together, so the table equals rebuildFromJobs(s) at every moment, not only at tick end.
//
// Every exit from a job (end, fail, interrupt, death, draft, downed, break, despawn, the target
// deconstructed or destroyed) goes through the single endJob(s, col, reason). There is no periodic
// sweep: a leak is a bug, and checkReservations (installed as a tick check in debug builds and in
// the determinism gate, 14.4 (d)) names the leaking job.
//
// Consumers: F calls endJob(s, col, 'death' | 'draft' | 'downed' | 'break'); B/H/K call
// endJobsOn(s, keyBld(id) | keyCol(id) | keyAnim(id) | keyTile(i), 'targetGone') when a target is
// deconstructed, destroyed or removed; removing a colonist from s.col must call endJob first.

import { tileOfW, clamp, idx, W, H } from '../core/grid.js';
import { colById } from '../core/state.js';
import { registerRebuild, rtEqual } from '../core/rtcontract.js';
import { keyItem, keyKind, keyId, END, NO_THINK, getMover, jobTypeOf, requestThink, reservedByOthers } from './jobs.js';
import { getItem, put, setStackGoneHandler } from './items.js';

// ---- Pair lists (sorted by holder) -------------------------------------------------------------
function addPair(res, key, holder, n) {
  let p = res.get(key);
  if (!p) { res.set(key, [[holder, n]]); return; }
  let j = 0;
  while (j < p.length && p[j][0] < holder) j++;
  if (j < p.length && p[j][0] === holder) { p[j][1] = p[j][1] === 0 || n === 0 ? 0 : p[j][1] + n; return; }
  p.splice(j, 0, [holder, n]);
}
function removePair(res, key, holder) {
  const p = res.get(key);
  if (!p) return;
  for (let j = 0; j < p.length; j++) if (p[j][0] === holder) { p.splice(j, 1); break; }
  if (!p.length) res.delete(key);
}

// ---- Claims ---------------------------------------------------------------------------------
/** Units available on a key: an item stack's count; other targets are exclusive-only (Infinity). */
function capacity(s, key) {
  if (keyKind(key) !== 'item') return Infinity;
  const it = getItem(s, keyId(key));
  return it ? it.n : -1;
}
/**
 * Could `col` claim `key` now? n = 0 exclusive, n > 0 a count of an item stack.
 * @returns {boolean}
 */
export function canClaim(s, col, key, n = 0) {
  if (!Number.isInteger(key) || key < 0 || !Number.isInteger(n) || n < 0) return false;
  const cap = capacity(s, key);
  if (cap < 0) return false;                                  // the stack is gone
  const others = reservedByOthers(s, key, col.id);
  if (others === Infinity) return false;                      // someone holds it exclusively
  if (n === 0) return others === 0;
  if (cap === Infinity) return others === 0;                  // partial counts only make sense on stacks
  let mine = 0;
  for (const c of (col.job && col.job.claims) || []) if (c[0] === key) mine = c[1];
  return others + mine + n <= cap;
}
/** Claim key for col's current job. @returns {boolean} false (and nothing changed) when not available */
export function claim(s, col, key, n = 0) {
  const job = col.job;
  if (!job || !canClaim(s, col, key, n)) return false;
  if (!job.claims) job.claims = [];
  let found = false;
  for (const c of job.claims) if (c[0] === key) { c[1] = c[1] === 0 || n === 0 ? 0 : c[1] + n; found = true; break; }
  if (!found) job.claims.push([key, n]);
  addPair(s.rt.res, key, col.id, n);
  return true;
}
/** Drop one claim of col's job (e.g. pickup releases the stack once it has taken its units). */
export function release(s, col, key) {
  const job = col.job;
  if (!job || !job.claims) return false;
  const j = job.claims.findIndex((c) => c[0] === key);
  if (j < 0) return false;
  job.claims.splice(j, 1);
  removePair(s.rt.res, key, col.id);
  return true;
}
/** Drop every claim of a job held by col (called by endJob only). */
function releaseAll(s, col, job) {
  if (!job.claims) return;
  for (const c of job.claims) removePair(s.rt.res, c[0], col.id);
  job.claims = [];
}

// ---- Job start and the single exit ------------------------------------------------------------
/**
 * Start a job: all `claims` ([key, n] pairs) are taken atomically, or none and false is returned.
 * The colonist must be idle (col.job null); a giver's make() result may be a Job or { job, claims }.
 * @returns {boolean}
 */
export function beginJob(s, col, job, claims = []) {
  if (col.job || !job) return false;
  if (job.job && Array.isArray(job.claims) && !job.toils) { claims = job.claims; job = job.job; }
  // Atomic: check them all first (claims within one list must name distinct keys).
  for (const [key, n] of claims) if (!canClaim(s, col, key, n)) return false;
  job.claims = [];
  job.t0 = s.tick;
  col.job = job;
  for (const [key, n] of claims) claim(s, col, key, n);
  return true;
}

/** The colonist's tile coordinates (clamped to the map). */
export function colTileXY(col) {
  return [clamp(tileOfW(col.x), 0, W - 1), clamp(tileOfW(col.y), 0, H - 1)];
}
/** The colonist's tile index (clamped to the map; no allocation). */
export const colTile = (col) => idx(clamp(tileOfW(col.x), 0, W - 1), clamp(tileOfW(col.y), 0, H - 1));

/**
 * THE single exit of every job (5.4). Releases every claim, drops any carry at the colonist's
 * tile, stops its path, runs the job type's onEnd hook and (unless the colonist is gone or
 * downed) queues a think.
 * @param {object} s @param {object} col @param {string} reason one of END.* or a toil failure reason
 * @returns {boolean} false when the colonist had no job
 */
export function endJob(s, col, reason = END.INTERRUPT) {
  const job = col.job;
  if (!job) return false;
  releaseAll(s, col, job);
  col.job = null;
  const b = job.carry;
  job.carry = null;
  if (b && b.n > 0) { const [x, y] = colTileXY(col); put(s, b, x, y); }
  const m = getMover();
  if (m) m.stop(s, col); else col.path = null;
  const hooks = jobTypeOf(job.type);
  if (hooks && hooks.onEnd) hooks.onEnd(s, col, job, reason);
  if (!NO_THINK.has(reason)) requestThink(s, col.id);
  return true;
}
/** Alias for interrupt paths (F's draft and breaks, think's re-evaluation). */
export const interrupt = (s, col, reason = END.INTERRUPT) => endJob(s, col, reason);

/** End every job holding a claim on key (a target that was deconstructed, destroyed or removed). */
export function endJobsOn(s, key, reason = END.TARGET_GONE) {
  const p = s.rt.res.get(key);
  if (!p) return 0;
  const holders = p.map((x) => x[0]);
  let n = 0;
  for (const h of holders) { const c = colById(s, h); if (c && endJob(s, c, reason)) n++; }
  return n;
}
setStackGoneHandler((s, id) => endJobsOn(s, keyItem(id), END.TARGET_GONE));

// ---- Rebuild and the gate check (14.4 (d)) ---------------------------------------------------
/** The reservation table as a pure function of saved jobs. */
export function rebuildFromJobs(s) {
  const res = new Map();
  for (const c of s.col) {
    const cl = c.job && c.job.claims;
    if (cl) for (const [key, n] of cl) addPair(res, key, c.id, n);
  }
  return res;
}

/** null when s.rt.res equals rebuildFromJobs(s); otherwise a message naming the leaking job. */
export function checkReservations(s) {
  const live = s.rt.res, want = rebuildFromJobs(s);
  if (rtEqual(live, want)) return null;
  const keys = new Set([...live.keys(), ...want.keys()]);
  for (const key of [...keys].sort((a, b) => a - b)) {
    const a = live.get(key) || [], b = want.get(key) || [];
    if (rtEqual(a, b)) continue;
    const holders = [...new Set([...a, ...b].map((x) => x[0]))].sort((x, y) => x - y);
    const who = holders.map((h) => {
      const c = colById(s, h);
      if (!c) return `holder ${h} (no such colonist)`;
      return c.job ? `colonist ${h} job '${c.job.type}' at toil ${c.job.i}${c.job.toils[c.job.i] ? ` (${c.job.toils[c.job.i].t})` : ''}` : `colonist ${h} (no job)`;
    });
    return `reservation leak on ${keyKind(key)} ${keyId(key)} (key ${key}): live ${JSON.stringify(a)} vs jobs ${JSON.stringify(b)}; ${who.join(', ')}`;
  }
  return 'reservation table differs from rebuildFromJobs';
}

registerRebuild('res', rebuildFromJobs);
