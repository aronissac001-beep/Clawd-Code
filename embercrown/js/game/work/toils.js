// The toil runner (doc 5.3; owner E). Runs in the 'jobs' tick slot: for every colonist with a
// job, in s.col order, it runs the current toil's handler; instant toils (reserve, pickup, drop,
// an arrived goto) chain within the same tick up to WORK.maxToilSteps. A handler returns RUN, NEXT
// or a failure reason; a failure and the end of the list both go through endJob (reserve.js).
//
// Toil state lives in the saved job (job.i, job.work, job.ts), so a save mid-toil continues
// identically. Handlers are registered by name (jobs.registerToil) so specialisations and perks
// can add toils (8.1, 8.2) without touching this file.
//
// Movement goes through the Mover hook (jobs.setMover). B's pathing and movement provide the real
// one; until then `straightMover` + `stubMovementSystem` (Stage 0 stubs, straight 8-connected
// lines that ignore walls, one tile per tick) let jobs run in tests and the stub world.

import { idx, tx, ty, cheb, ctrW, TER_PASSABLE } from '../core/grid.js';
import { newPath } from '../core/schema.js';
import { bldById } from '../core/state.js';
import {
  WORK, RUN, NEXT, END, registerToil, toilHandler, effectOf, getMover, workHooks, markUnreachable,
  keyItem, keyBld, myClaim,
} from './jobs.js';
import { getItem, take, put, addCarry, carried, drop } from './items.js';
import { claim, release, endJob, colTile } from './reserve.js';

const atGoal = (col, goal, adj) => {
  const i = colTile(col);
  return adj ? cheb(tx(i), ty(i), tx(goal), ty(goal)) <= 1 : i === goal;
};
const moverOf = () => getMover() || straightMover;

// ---- Core toils -----------------------------------------------------------------------------
/** A goal nobody can stand on (a rack, a granary: storage buildings that block) is reached from next to it. */
const blockedGoal = (s, i) => !!s.rt.walkCost && s.rt.walkCost[i] === 0 && s.rt.occ[i] >= 0;
function gotoToil(s, col, job, toil) {
  const adj = !!toil.adj || blockedGoal(s, toil.i), m = moverOf();
  if (atGoal(col, toil.i, adj)) { if (col.path) m.stop(s, col); return NEXT; }
  const st = m.status(s, col, toil.i, adj);
  if (st === 'pending' || st === 'moving') return RUN;
  if (st === 'failed') { markUnreachable(s, col, job.target); return END.UNREACHABLE; }
  const ts = job.ts || (job.ts = { r: 0 });
  if (ts.r >= WORK.gotoRetries) return 'stuck';
  ts.r++;
  if (!m.request(s, col, toil.i, adj)) { markUnreachable(s, col, job.target); return END.UNREACHABLE; }
  return RUN;
}
registerToil('goto', gotoToil);
registerToil('carry', (s, col, job, toil) => (carried(col) ? gotoToil(s, col, job, toil) : 'notCarrying'));

registerToil('reserve', (s, col, job, toil) => (claim(s, col, toil.key, toil.n || 0) ? NEXT : 'reserved'));

registerToil('pickup', (s, col, job, toil) => {
  const it = getItem(s, toil.id);
  if (!it) return END.TARGET_GONE;
  const ci = colTile(col), x = tx(ci), y = ty(ci);
  if ((it.x !== x || it.y !== y) && !(blockedGoal(s, idx(it.x, it.y)) && cheb(x, y, it.x, it.y) <= 1)) return 'notThere';
  // Release our claim first: the stack may vanish when we empty it, and its id may be reused.
  release(s, col, keyItem(toil.id));
  const b = take(s, toil.id, toil.n, col.id);
  if (!b) return 'nothingToTake';
  if (!addCarry(col, b)) { put(s, b, it.x, it.y); return 'carryMismatch'; }
  return NEXT;
});

registerToil('drop', (s, col, job, toil) => {
  if (!carried(col)) return NEXT;
  const ci = colTile(col);
  let x = tx(ci), y = ty(ci);
  if (toil.i >= 0) {
    if (cheb(x, y, tx(toil.i), ty(toil.i)) > 1) return 'notThere';
    x = tx(toil.i); y = ty(toil.i);
  }
  drop(s, col, x, y);
  return carried(col) ? 'noRoom' : NEXT;
});

function doWork(s, col, job, toil) {
  const h = workHooks();
  const sp = h.speed(s, col, toil) | 0;
  if (sp > 0) job.work += sp;
  if (toil.sk && h.xp) h.xp(s, col, toil.sk, 1);
  if (job.work < toil.n * 100) return RUN;
  if (toil.fx) {
    const fx = effectOf(toil.fx);
    if (!fx) return `noEffect:${toil.fx}`;
    const r = fx(s, col, job, toil);
    if (typeof r === 'string') return r;
  }
  return NEXT;
}
registerToil('work', (s, col, job, toil) => {
  if (toil.key >= 0 && myClaim(s, toil.key, col.id) < 0) return 'lostClaim';
  return doWork(s, col, job, toil);
});
registerToil('useBench', (s, col, job, toil) => {
  if (!bldById(s, toil.b)) return END.TARGET_GONE;
  if (myClaim(s, keyBld(toil.b), col.id) < 0) return 'lostClaim';
  return doWork(s, col, job, toil);
});
registerToil('wait', (s, col, job, toil) => (++job.work >= toil.n ? NEXT : RUN));

// ---- The runner -------------------------------------------------------------------------------
/** Advance one colonist's job by one tick. */
export function stepJob(s, col) {
  for (let step = 0; step < WORK.maxToilSteps; step++) {
    const job = col.job;
    if (!job) return;
    if (job.i >= job.toils.length) { endJob(s, col, END.DONE); return; }
    const toil = job.toils[job.i];
    const h = toilHandler(toil && toil.t);
    if (!h) { endJob(s, col, END.BAD_TOIL); return; }
    const r = h(s, col, job, toil);
    if (col.job !== job) return;                 // the handler or an effect ended the job itself
    if (r === RUN) return;
    if (r === NEXT) {
      job.i++; job.work = 0; job.ts = null;
      if (job.i >= job.toils.length) { endJob(s, col, END.DONE); return; }
      continue;
    }
    endJob(s, col, typeof r === 'string' ? r : END.FAIL);
    return;
  }
}
/** The 'jobs' tick system: every colonist with a job, in s.col order. */
export function runJobs(s) {
  const cs = s.col;
  for (let i = 0; i < cs.length; i++) if (cs[i].job) stepJob(s, cs[i]);
}

// ---- Stage 0 movement stubs (replaced by B's requestPath / movement) ---------------------------
/** Straight 8-connected tile line from (x0, y0) to (x1, y1), excluding the start. */
function line(x0, y0, x1, y1) {
  const out = [];
  let x = x0, y = y0;
  while (x !== x1 || y !== y1) { x += Math.sign(x1 - x); y += Math.sign(y1 - y); out.push(idx(x, y)); }
  return out;
}
/** Stage 0 Mover: straight lines, ignoring walls; a goal on impassable terrain is unreachable unless adj. */
export const straightMover = Object.freeze({
  request(s, col, goal, adj) {
    if (!adj && TER_PASSABLE[s.L.terrain[goal]] !== 1) return false;
    const ci = colTile(col);
    const tiles = line(tx(ci), ty(ci), tx(goal), ty(goal));
    if (adj && tiles.length) tiles.pop();
    col.path = tiles.length ? newPath(tiles) : null;
    return true;
  },
  status(s, col) { return col.path && col.path.i < col.path.tiles.length ? 'moving' : 'none'; },
  stop(s, col) { col.path = null; },
});
/** Stage 0 movement system ('movement' slot): one path tile per tick, colonists at tile centres. */
export function stubMovementSystem(s) {
  for (const col of s.col) {
    const p = col.path;
    if (!p) continue;
    const t = p.tiles[p.i++];
    col.x = ctrW(tx(t)); col.y = ctrW(ty(t));
    if (p.i >= p.tiles.length) col.path = null;
  }
}
