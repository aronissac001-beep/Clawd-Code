// The Craft work giver (doc 5.1, 5.7; owner E) and the bench-giver factory it is made from: any
// work type whose jobs are bills at workbenches (Craft; Cook, Smith, Tailor and Art use the same
// factory when their stage comes). Candidates: finished benches of this work type with bills
// (rt.idx.bills), not in use, ranked by the region-graph distance to their standing spot.

import { idx, inB } from '../../core/grid.js';
import { bldById } from '../../core/state.js';
import { structDef } from '../../core/content.js';
import { WORK, keyBld } from '../jobs.js';
import { standSpot, openTarget } from '../windex.js';
import { footprint } from '../construct.js';
import { workableBill, craftJob } from '../bills.js';
import { usesFuel, isBurning } from '../../world/fuel.js';

/** A bench-bill work giver for work type `work` (benches whose def has workbench.workType === work). */
export function benchGiver(work, id = work) {
  const target = (s, col, b) => {
    if (!b || b.st !== 'done' || !b.bills || !b.bills.length) return null;
    const d = structDef(b.def);
    if (!d || !d.workbench || (d.workbench.workType || 'craft') !== work) return null;
    if (usesFuel(s, b) && !isBurning(s, b)) return null;    // a cold campfire cooks nothing (Stage 1b fuel rules)
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
