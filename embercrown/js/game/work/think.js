// Job selection (doc 5.3; owner E): the saved think FIFO (s.rt.thinkQ, at most
// WORK.thinksPerTick per tick), the work loop over priorities 1..4 and work types in fixed order,
// givers from BUS.workGivers in a registration-independent order, unreachable memory, atomic
// claims through beginJob, and an idle fallback (idle jobs are interruptible: a wait of
// WORK.rethinkTicks, then a new think). Inside a giver, candidates are collected nearest-first by
// cluster and ranked by region-graph distance (windex.collect); a target outside the colonist's
// component is dropped there, before any A* call. Stage 1b adds the forced / urgent-need /
// schedule steps (F's hooks, jobs.setThinkHooks; Stage 1b) and the fallback before the idle wait;
// interruptible jobs end early when F's interrupt hook says an urgent need calls.
// The `prioritise` command (BUS.prioritise) forces one target through its work type's givers.
// Stage 2 adds two self-care steps between the urgent needs / schedule (F) and the work loop: the
// fire emergency (givers/fire.js: a home fire within 25 tiles, or any for haulers) and dressing
// (outfit.js: the best allowed gear, at most every DRESS_EVERY ticks), then a stack that has waited
// URGENT_H hours for a haul (anyone with Haul enabled). The fire emergency also ends ordinary jobs at
// the staggered rethink.

import { WORK_IDS } from '../core/schema.js';
import { colById } from '../core/state.js';
import { BUS } from '../core/bus.js';
import { WORK, T, END, HOLD, makeJob, giversFor, isUnreachable, pruneUnreachable, requestThink, thinkHooks } from './jobs.js';
import { beginJob, endJob, canClaim } from './reserve.js';
import { fireDuty, fireInterrupts } from './givers/fire.js';
import { dressJob } from './outfit.js';
import { URGENT_HAUL_GIVER } from './givers/haul.js';
import { worldStage2 } from '../world/worldrec.js';

/** The 'think' tick system. */
export function thinkTick(s) {
  const q = s.rt.thinkQ;
  const H = thinkHooks(), R = WORK.rethinkTicks;
  // New or freed colonists that nobody queued (spawned by another system): cheap, id order.
  if (s.tick % R === 0) for (const c of s.col) if (!c.job && !c.drafted && !c.hp.dead) requestThink(s, c.id);
  // Interruptible jobs re-think every R ticks (staggered by id) when an urgent need calls (F's hook).
  const st2 = worldStage2();
  if (H.interrupt || st2) {
    for (const c of s.col) {
      const j = c.job;
      if (!j || j.forced || c.drafted || c.id % R !== s.tick % R) continue;
      if (H.interrupt && H.interrupt(s, c)) endJob(s, c, END.RETHINK);
      else if (st2 && fireInterrupts(s, c)) endJob(s, c, END.RETHINK);
    }
  }
  let n = 0;
  while (n < WORK.thinksPerTick && q.length) {
    const c = colById(s, q.shift());
    if (!c || c.job) continue;
    n++;
    think(s, c);
  }
}

/** Try one giver: its candidates nearest-first; the first valid one whose claims are free starts. */
export function tryGiver(s, col, g) {
  const cands = g.candidates(s, col, WORK.candidatesK) || [];
  for (const t of cands) {
    const key = g.keyOf ? g.keyOf(t) : typeof t === 'number' ? t : -1;
    if (key >= 0 && isUnreachable(s, col, key)) continue;
    if (!g.valid(s, col, t)) continue;
    const made = g.make(s, col, t);
    if (!made) continue;
    const job = made.toils ? made : made.job;
    const claims = made.toils ? [] : made.claims || [];
    if (!job.giver) job.giver = g.id;
    if (beginJob(s, col, job, claims)) return true;
  }
  return false;
}

/** Start a hook's job (a Job or { job, claims }). */
function startMade(s, col, made, id) {
  const job = made.toils ? made : made.job;
  const claims = made.toils ? [] : made.claims || [];
  if (!job) return false;
  if (!job.giver) job.giver = id;
  return beginJob(s, col, job, claims);
}
const STEPS = Object.freeze(['forced', 'urgent', 'schedule']);
const HAUL_W = WORK_IDS.indexOf('haul');

/** Choose a job for an idle colonist. @returns {boolean} true when a job started */
export function think(s, col) {
  pruneUnreachable(s, col);
  if (col.drafted) return false;            // drafted colonists follow orders (F/H)
  const H = thinkHooks();
  // 1-3: forced (breaks, downed), urgent needs and the schedule come first (F's hooks, Stage 1b).
  for (const step of STEPS) {
    const f = H[step];
    if (!f) continue;
    const r = f(s, col);
    if (r === HOLD) return false;
    if (r && startMade(s, col, r, step)) return true;
  }
  if (worldStage2()) {
    const f = fireDuty(s, col);
    if (f && startMade(s, col, f, 'fire')) return true;
    const d = dressJob(s, col);
    if (d && startMade(s, col, d, 'dress')) return true;
    if (col.prio[HAUL_W] > 0 && tryGiver(s, col, URGENT_HAUL_GIVER)) return true;
  }
  for (let p = 1; p <= 4; p++) {
    for (let w = 0; w < WORK_IDS.length; w++) {
      if (col.prio[w] !== p) continue;
      for (const g of giversFor(BUS.workGivers, WORK_IDS[w])) if (tryGiver(s, col, g)) return true;
    }
  }
  // 5: any need below the fallback line, then the idle wait
  if (H.fallback) { const r = H.fallback(s, col); if (r && r !== HOLD && startMade(s, col, r, 'fallback')) return true; }
  beginJob(s, col, makeJob('idle', -1, [T.wait(WORK.idleWaitTicks)]));
  return false;
}

/**
 * BUS.prioritise: the player taps a target and picks a work type for a colonist. The first giver of
 * that work type that can make a job of the target (giver.fromTarget) takes over: the current job
 * ends (interrupt) and the forced job starts. Returns true when it started.
 */
export function prioritiseHook(s, col, target, work) {
  for (const g of giversFor(BUS.workGivers, work)) {
    if (!g.fromTarget) continue;
    const t = g.fromTarget(s, col, target);
    if (!t || !g.valid(s, col, t)) continue;
    const made = g.make(s, col, t);
    if (!made) continue;
    const job = made.toils ? made : made.job;
    const claims = made.toils ? [] : made.claims || [];
    // claims held by the current job are released by the interrupt; others must be free now
    const mine = new Set(((col.job && col.job.claims) || []).map((c) => c[0]));
    if (!claims.every(([key, n]) => mine.has(key) || canClaim(s, col, key, n))) continue;
    if (!job.giver) job.giver = g.id;
    job.forced = true;
    if (col.job) endJob(s, col, END.INTERRUPT);
    if (beginJob(s, col, job, claims)) return true;
  }
  return null;
}
