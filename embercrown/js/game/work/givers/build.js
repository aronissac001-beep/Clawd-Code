// The Build work giver (doc 5.1, 7.1; owner E): deliver materials to blueprints, construct
// supplied frames, deconstruct finished buildings marked for it. Candidates come from the frames
// index (by cluster, nearest-first) plus the buildings marked dcon, ranked by the region-graph
// distance to their standing spot.

import { idx, inB } from '../../core/grid.js';
import { bldById } from '../../core/state.js';
import { keyBld } from '../jobs.js';
import { collect, standSpot, openTarget } from '../windex.js';
import { footprint, supplied, deliveryJob, constructJob, deconstructJob } from '../construct.js';

const target = (s, col, b) => {
  if (!b || (b.st === 'done' && !b.dcon)) return null;
  if (!openTarget(s, col, keyBld(b.id))) return null;
  const st = standSpot(s, col, footprint(s, b));
  return st.i < 0 ? null : { key: keyBld(b.id), id: b.id, d: st.d, plan: null };
};

export const BUILD_GIVER = Object.freeze({
  id: 'build', work: 'build', order: 0,
  candidates(s, col, k) {
    const fr = s.rt.idx.frames;
    const out = collect(s, col, (c) => fr[c], (id) => target(s, col, bldById(s, id)), k);
    // deconstruction: finished buildings marked dcon (few; scanned in id order)
    for (const b of s.bld) if (b && b.st === 'done' && b.dcon) { const t = target(s, col, b); if (t && t.d !== Infinity) out.push(t); }
    out.sort((p, q) => p.d - q.d || p.key - q.key);
    return out.slice(0, k);
  },
  valid(s, col, t) {
    const b = bldById(s, t.id);
    if (!b || !target(s, col, b)) return false;
    t.plan = b.st === 'done' ? deconstructJob(s, col, b) : supplied(b) ? constructJob(s, col, b) : deliveryJob(s, col, b);
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
