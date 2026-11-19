// The Craft work giver (doc 5.1, 5.7; owner E) and the bench-giver factory it is made from: any
// work type whose jobs are bills at workbenches (Craft; Cook, Smith, Tailor and Art use the same
// factory when their stage comes). Candidates: finished benches of this work type with bills
// (rt.idx.bills), not in use, ranked by the region-graph distance to their standing spot.

import { idx, inB } from '../../core/grid.js';
import { bldById } from '../../core/state.js';
import { structDef } from '../../core/content.js';
import { WORK, RUN, NEXT, END, T, keyBld, makeJob, registerToil, myClaim, workHooks } from '../jobs.js';
import { TICKS_PER_MIN } from '../../core/time.js';
import { standSpot, openTarget } from '../windex.js';
import { footprint } from '../construct.js';
import { workableBill, craftJob, batchLoaded } from '../bills.js';
import { usesFuel, isBurning } from '../../world/fuel.js';

/** A bench-bill work giver for work type `work` (benches whose def has workbench.workType === work). */
export function benchGiver(work, id = work) {
  const target = (s, col, b) => {
    if (!b || b.st !== 'done' || !b.bills || !b.bills.length) return null;
    const d = structDef(b.def);
    if (!d || !d.workbench || (d.workbench.workType || 'craft') !== work) return null;
    if (usesFuel(s, b) && !isBurning(s, b)) return null;    // a cold campfire cooks nothing (Stage 1b fuel rules)
    if (batchLoaded(b)) return null;                         // a cask or kiln works its batch unattended (waitH)
    if (!openTarget(s, col, keyBld(b.id))) return null;
    const st = standSpot(s, col, footprint(s, b));
    return st.i < 0 ? null : { key: keyBld(b.id), id: b.id, d: st.d, plan: null };
  };
  return Object.freeze({
    id, work, order: 0,
    candidates(s, col, k = WORK.candidatesK) {
      const out = [];
      for (const bid of s.rt.idx.bills) { const t = target(s, col, bldById(s, bid)); if (t) out.push(t); }
      out.sort((p, q) => p.d - q.d || p.key - q.key);
      return out.slice(0, k);
    },
    valid(s, col, t) {
      const b = bldById(s, t.id);
      if (!target(s, col, b)) return false;
      const w = workableBill(s, col, b);
      t.plan = w ? craftJob(s, col, b, w.bi, w.picks) : null;
      return !!t.plan;
    },
    make(s, col, t) { return t.plan; },
    keyOf: (t) => t.key,
    fromTarget(s, col, tg) {
      if (!tg) return null;
      let b = null;
      if (tg.kind === 'bld') b = bldById(s, tg.id);
      else if (tg.x !== undefined && inB(tg.x, tg.y)) { const o = s.rt.occ[idx(tg.x, tg.y)]; b = o >= 0 ? bldById(s, o) : null; }
      return target(s, col, b);
    },
  });
}

export const CRAFT_GIVER = benchGiver('craft');

// ---- Workplaces (Stage 2): benches with no bills where a work type simply works (doc 7.6) ---------
/**
 * A workplace giver: finished workplaces of `defs` (rt.idx.places), one worker each, ranked by the
 * region-graph distance to their standing spot. The job is one shift ('shift' toil, shiftMin game
 * minutes at speed 1.0): every `perMin` minutes of work, yieldFn(s, col, b, n) is called with the
 * number of units earned since the last call (lore points, a fish, a rough stone). ok(s, col, b) may
 * refuse a workplace (nothing to research, the catch shared out).
 */
export function workplaceGiver({ id, work, defs, sk, shiftMin = 120, perMin = 1, yieldFn, ok = null, order = 5 }) {
  const target = (s, col, b) => {
    if (!b || b.st !== 'done' || !defs.includes(b.def)) return null;
    if (ok && !ok(s, col, b)) return null;
    if (!openTarget(s, col, keyBld(b.id))) return null;
    const st = standSpot(s, col, footprint(s, b));
    return st.i < 0 ? null : { key: keyBld(b.id), id: b.id, stand: st.i, d: st.d };
  };
  registerPlaceYield(id, yieldFn);
  return Object.freeze({
    id, work, order,
    candidates(s, col, k = WORK.candidatesK) {
      const out = [];
      for (const bid of s.rt.idx.places || []) { const t = target(s, col, bldById(s, bid)); if (t) out.push(t); }
      out.sort((p, q) => p.d - q.d || p.key - q.key);
      return out.slice(0, k);
    },
    valid(s, col, t) { return !!target(s, col, bldById(s, t.id)); },
    make(s, col, t) {
      const key = keyBld(t.id);
      return { job: makeJob(id, key, [T.goto(t.stand), { t: 'shift', b: t.id, n: shiftMin * TICKS_PER_MIN, per: perMin * TICKS_PER_MIN, sk, y: id }]), claims: [[key, 0]] };
    },
    keyOf: (t) => t.key,
    fromTarget(s, col, tg) { if (!tg || tg.kind !== 'bld') return null; return target(s, col, bldById(s, tg.id)); },
  });
}
const YIELDS = new Map();
function registerPlaceYield(id, fn) { YIELDS.set(id, fn); }
// 'shift': work at a workplace; units are paid out as the work passes each `per` (x100 fixed point).
registerToil('shift', (s, col, job, toil) => {
  const b = bldById(s, toil.b);
  if (!b || b.st !== 'done') return END.TARGET_GONE;
  if (myClaim(s, keyBld(b.id), col.id) < 0) return 'lostClaim';
  const h = workHooks();
  const sp = h.speed(s, col, toil) | 0;
  const before = job.work;
  if (sp > 0) job.work += sp;
  if (toil.sk && h.xp) h.xp(s, col, toil.sk, 1);
  const per = Math.max(1, toil.per | 0) * 100;
  const n = Math.floor(job.work / per) - Math.floor(before / per);
  if (n > 0) { const fn = YIELDS.get(toil.y); if (fn) { const r = fn(s, col, b, n); if (typeof r === 'string') return r; } }
  return job.work >= toil.n * 100 ? NEXT : RUN;
});
