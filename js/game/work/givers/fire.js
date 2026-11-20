// The fire emergency (doc 5.1; owner E; Stage 2). Fire is not a work type: a fire inside the home
// area interrupts every able, non-drafted colonist within FIRE_R tiles who is not in a break and not
// doing Care (after urgent needs, before work); haulers anywhere on the map join. It ends when the
// fire is out.
//   Home area: the tiles of the 'home' zones when the player painted any, else the claimed land (B).
//   fireDuty(s, col)  the firefighting job for col now, or null (think.js asks it after the urgent
//                     needs; its interrupt check ends an ordinary job every rethink when it says yes).
//   The job: walk beside the nearest home fire (one firefighter per burning tile: keyTile), beat it
//   every BEAT_TICKS with B's extinguish() until it goes out, at most FIGHT_TICKS, then think again
//   (the next fire is the next job). Medicine-free, tool-free: buckets come with wells (Stage 3).
//   FIRE_GIVER makes the same job inside the Haul work type, so idle haulers anywhere join.

import { W, tx, ty, tz, cheb } from '../../core/grid.js';
import { WORK_IDS } from '../../core/schema.js';
import { RUN, NEXT, T, makeJob, registerToil, keyTile, myClaim } from '../jobs.js';
import { colTile } from '../reserve.js';
import { openTarget, distTo, reachableFrom } from '../windex.js';
import { fireTiles, burning, extinguish, FIRE } from '../../world/fire.js';
import { worldStage2 } from '../../world/worldrec.js';
import { isClaimed } from '../../world/claims.js';
import { able } from '../../people/health.js';

export const FIRE_R = 25, BEAT_TICKS = 20, FIGHT_TICKS = 900;
const HAUL = WORK_IDS.indexOf('haul');
const CARE_JOBS = new Set(['rescue', 'tend', 'feed', 'talkdown']);

/** Is tile i in the home area? */
export function inHome(s, i) {
  let anyHome = false;
  for (const z of s.zones) if (z.type === 'home') { anyHome = true; if (s.L.zone[i] === z.id) return true; }
  return anyHome ? false : isClaimed(s, i);
}
/** Burning tiles inside the home area, ascending. */
export function homeFires(s) {
  if (!worldStage2() || !s.colony.world || !s.colony.world.fire || !s.colony.world.fire.length) return [];
  return fireTiles(s).filter((i) => inHome(s, i));
}
/** Is the colonist on emergency duty for fire tile list `fires` (range, ability, current job)? */
function onDuty(s, col, fires) {
  if (!fires.length || col.drafted || !able(col)) return false;
  const j = col.job;
  if (j && (j.type === 'firefight' || j.need || CARE_JOBS.has(j.type) || j.forced)) return false;
  if (col.prio[HAUL] > 0) return true;
  const ci = colTile(col), x = tx(ci), y = ty(ci);
  return fires.some((i) => cheb(x, y, tx(i), ty(i)) <= FIRE_R);
}
/** The firefighting job for col at the nearest reachable home fire, or null. */
export function fireJobFor(s, col, fires = homeFires(s)) {
  let best = -1, bd = Infinity;
  for (const i of fires) {
    if (!openTarget(s, col, keyTile(i)) || !reachableFrom(s, col, i) && !nearReach(s, col, i)) continue;
    const d = distTo(s, col, i);
    if (d < bd || (d === bd && i < best)) { bd = d; best = i; }
  }
  if (best < 0) return null;
  return { job: makeJob('firefight', keyTile(best), [T.goto(best, true), { t: 'beat', i: best }]), claims: [[keyTile(best), 0]] };
}
// a burning wall or tree: reachable when a 4-neighbour is
const nearReach = (s, col, i) => [i - 1, i + 1, i - W, i + W].some((j) => j >= 0 && j < s.L.terrain.length && reachableFrom(s, col, j));
/** think.js: the emergency step (null when there is no duty). */
export function fireDuty(s, col) {
  const fires = homeFires(s);
  if (!onDuty(s, col, fires)) return null;
  if (col.prio[HAUL] <= 0) {
    const ci = colTile(col), x = tx(ci), y = ty(ci);
    return fireJobFor(s, col, fires.filter((i) => cheb(x, y, tx(i), ty(i)) <= FIRE_R));
  }
  return fireJobFor(s, col, fires);
}
/** think.js interrupt: should col drop its current job for the fire? */
export const fireInterrupts = (s, col) => !!col.job && !!fireDuty(s, col);

registerToil('beat', (s, col, job, toil) => {
  if (!burning(s, toil.i)) return NEXT;
  if (myClaim(s, keyTile(toil.i), col.id) < 0) return 'lostClaim';
  const ci = colTile(col);
  if (tz(ci) !== tz(toil.i) || cheb(tx(ci), ty(ci), tx(toil.i), ty(toil.i)) > 1) return 'notThere';
  job.work++;
  if (job.work % BEAT_TICKS === 0 && extinguish(s, toil.i, FIRE.extinguish)) return NEXT;
  return job.work >= FIGHT_TICKS ? NEXT : RUN;
});

export const FIRE_GIVER = Object.freeze({
  id: 'firefight', work: 'haul', order: -10,
  candidates(s, col, k) {
    const fires = homeFires(s);
    if (!fires.length) return [];
    const out = [];
    for (const i of fires) { if (!openTarget(s, col, keyTile(i))) continue; const d = distTo(s, col, i); out.push({ key: keyTile(i), i, d: d === Infinity ? 1e9 : d }); }
    out.sort((a, b) => a.d - b.d || a.key - b.key);
    return out.slice(0, k);
  },
  valid(s, col, t) { return burning(s, t.i) && inHome(s, t.i); },
  make(s, col, t) { return fireJobFor(s, col, [t.i]); },
  keyOf: (t) => t.key,
});
export const GIVER = FIRE_GIVER;
