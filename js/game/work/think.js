// Job selection (doc 5.3; owner E). Stage 0 skeleton: the saved think FIFO (s.rt.thinkQ, at most
// WORK.thinksPerTick per tick), the work loop over priorities 1..4 and work types in fixed order,
// givers from BUS.workGivers in a registration-independent order, unreachable memory, atomic
// claims through beginJob, and an idle fallback. Stage 1a adds: forced / urgent-need / schedule
// steps (F's hooks), region-graph ranking and the reachable-set rejection before any A* call,
// and the 60-tick re-think of interruptible jobs.

import { WORK_IDS } from '../core/schema.js';
import { colById } from '../core/state.js';
import { BUS } from '../core/bus.js';
import { WORK, T, makeJob, giversFor, isUnreachable, pruneUnreachable, requestThink } from './jobs.js';
import { beginJob } from './reserve.js';

/** The 'think' tick system. */
export function thinkTick(s) {
  const q = s.rt.thinkQ;
  // New or freed colonists that nobody queued (spawned by another system): cheap, id order.
  if (s.tick % WORK.rethinkTicks === 0) for (const c of s.col) if (!c.job && !c.drafted) requestThink(s, c.id);
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

/** Choose a job for an idle colonist. @returns {boolean} true when a work job started */
export function think(s, col) {
  pruneUnreachable(s, col);
  if (col.drafted) return false;            // drafted colonists follow orders (F/H)
  // Stage 1b: forced (breaks, downed), urgent needs and schedule come first (F's hooks).
  for (let p = 1; p <= 4; p++) {
    for (let w = 0; w < WORK_IDS.length; w++) {
      if (col.prio[w] !== p) continue;
      for (const g of giversFor(BUS.workGivers, WORK_IDS[w])) if (tryGiver(s, col, g)) return true;
    }
  }
  beginJob(s, col, makeJob('idle', -1, [T.wait(WORK.idleWaitTicks)]));
  return false;
}
