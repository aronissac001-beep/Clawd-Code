// The Care work giver (doc 4.6, 5.1; owner E; Stage 1b: rescue only). Targets: downed colonists
// who are not in a bed (and not already being carried). The rescuer walks next to the patient,
// lifts them, carries them to a bed (the patient's own, else a free unowned one, F's bedFor), lays
// them down and the patient starts F's bed rest (needjobs.startBedrest), with "Carried to safety".
// Claims: the patient (keyCol, exclusive) and the bed (keyBld) for the whole job; the bed claim
// passes to the patient's bed rest when they are laid down. While carried, the patient's position
// follows the rescuer every tick (the movement slot runs after the jobs slot, so it lags a tick).
// A rescue ended early (interrupted, drafted, the rescuer downed) leaves the patient where they are.
// Tending, surgery, prisoners and talking down breaks arrive in Stage 2.

import { idx, tx, ty, ctrW, cheb } from '../../core/grid.js';
import { colById, bldById } from '../../core/state.js';
import { RUN, NEXT, END, T, makeJob, registerToil, keyCol, keyBld, myClaim, getMover } from '../jobs.js';
import { colTile, release } from '../reserve.js';
import { openTarget, distTo, reachableFrom } from '../windex.js';
import { bedFor, startBedrest } from '../../people/needjobs.js';
import { inBed } from '../../people/health.js';
import { addThought } from '../../people/mood.js';

/** Downed, alive, not lying in bed rest. */
export const needsRescue = (c) => !!c && !c.hp.dead && !!c.hp.down && !inBed(c) && !c.job;

const target = (s, col, p) => {
  if (p === col || !needsRescue(p) || !openTarget(s, col, keyCol(p.id))) return null;
  const pi = colTile(p);
  if (!reachableFrom(s, col, pi)) return null;
  return { key: keyCol(p.id), id: p.id, d: distTo(s, col, pi), plan: null };
};

function rescueJob(s, col, p) {
  const bed = bedFor(s, p, colTile(p));
  if (!bed || !reachableFrom(s, col, idx(bed.x, bed.y))) return null;
  const pi = colTile(p);
  const toils = [T.goto(pi, true), { t: 'lift', c: p.id }, { t: 'carryCol', c: p.id, i: idx(bed.x, bed.y) }, { t: 'layDown', c: p.id, b: bed.id }];
  return { job: makeJob('rescue', keyCol(p.id), toils), claims: [[keyCol(p.id), 0], [keyBld(bed.id), 0]] };
}

export const CARE_GIVER = Object.freeze({
  id: 'care', work: 'care', order: 0,
  candidates(s, col, k) {
    const out = [];
    for (const p of s.col) { const t = target(s, col, p); if (t && t.d !== Infinity) out.push(t); }
    out.sort((a, b) => a.d - b.d || a.key - b.key);
    return out.slice(0, k);
  },
  valid(s, col, t) {
    const p = colById(s, t.id);
    if (!target(s, col, p)) return false;
    t.plan = rescueJob(s, col, p);
    return !!t.plan;
  },
  make(s, col, t) { return t.plan; },
  keyOf: (t) => t.key,
  fromTarget(s, col, tg) { if (!tg || tg.kind !== 'col') return null; return target(s, col, colById(s, tg.id)); },
});

const follow = (p, col) => { p.x = col.x; p.y = col.y; };
const stillOurs = (s, col, id) => myClaim(s, keyCol(id), col.id) >= 0;

registerToil('lift', (s, col, job, toil) => {
  const p = colById(s, toil.c);
  if (!p || !p.hp.down || p.hp.dead || p.job || !stillOurs(s, col, toil.c)) return END.TARGET_GONE;
  const a = colTile(col), b = colTile(p);
  if (cheb(tx(a), ty(a), tx(b), ty(b)) > 1) return 'notThere';
  follow(p, col);
  return NEXT;
});
registerToil('carryCol', (s, col, job, toil) => {
  const p = colById(s, toil.c);
  if (!p || p.hp.dead || !stillOurs(s, col, toil.c)) return END.TARGET_GONE;
  follow(p, col);
  if (colTile(col) === toil.i) { const m = getMover(); if (m && col.path) m.stop(s, col); return NEXT; }
  const m = getMover();
  if (!m) return 'noMover';
  const st = m.status(s, col, toil.i, false);
  if (st === 'pending' || st === 'moving') return RUN;
  if (st === 'failed') return END.UNREACHABLE;
  const ts = job.ts || (job.ts = { r: 0 });
  if (ts.r >= 3) return 'stuck';
  ts.r++;
  return m.request(s, col, toil.i, false) ? RUN : END.UNREACHABLE;
});
registerToil('layDown', (s, col, job, toil) => {
  const p = colById(s, toil.c), b = bldById(s, toil.b);
  if (!p || p.hp.dead || !b || b.st !== 'done' || myClaim(s, keyBld(b.id), col.id) < 0) return END.TARGET_GONE;
  p.x = ctrW(b.x); p.y = ctrW(b.y);
  release(s, col, keyBld(b.id));
  if (!p.job && startBedrest(s, p, b)) addThought(s, p, 'rescued');
  return NEXT;
});

export const GIVER = CARE_GIVER;
