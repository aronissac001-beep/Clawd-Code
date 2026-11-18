// The Haul work giver (doc 5.6; owner E): stacks that need a better stockpile, nearest-first by
// cluster from the hauler, ranked by region-graph distance (stone only when the colony setting says
// 'always'; otherwise bills and frames fetch it themselves).

import { idx, inB } from '../../core/grid.js';
import { getItem, stackAt, stacksInCluster } from '../items.js';
import { collect } from '../windex.js';
import { haulable, haulCandidate, haulJob, staleHauls, URGENT_H } from '../haul.js';

export const HAUL_GIVER = Object.freeze({
  id: 'haul', work: 'haul', order: 0,
  candidates(s, col, k) {
    // Stage 2: stacks that waited STALE_H hours come first, oldest first (haul.js)
    const stale = [];
    for (const id of staleHauls(s)) { const t = haulCandidate(s, col, id); if (t) stale.push(t); if (stale.length >= 4) break; }
    const near = collect(s, col, (c) => stacksInCluster(s, c), (id) => haulCandidate(s, col, id), k);
    if (!stale.length) return near;
    return stale.concat(near.filter((t) => !stale.some((x) => x.id === t.id))).slice(0, k);
  },
  valid(s, col, t) {
    const it = getItem(s, t.id);
    if (!haulable(s, col, it)) return false;
    t.plan = haulJob(s, col, it);
    return !!t.plan;
  },
  make(s, col, t) { return t.plan; },
  keyOf: (t) => t.key,
  fromTarget(s, col, tg) {
    if (!tg) return null;
    const it = tg.kind === 'item' ? getItem(s, tg.id) : tg.x !== undefined && inB(tg.x, tg.y) ? stackAt(s, idx(tg.x, tg.y)) : null;
    return it ? haulCandidate(s, col, it.id) : null;
  },
});

/** Stacks waiting URGENT_H hours or more (think.js asks it for anyone with Haul enabled, before work). */
export const URGENT_HAUL_GIVER = Object.freeze({
  ...HAUL_GIVER, id: 'urgentHaul',
  candidates(s, col, k) {
    const out = [];
    for (const id of staleHauls(s, URGENT_H)) { const t = haulCandidate(s, col, id); if (t) out.push(t); if (out.length >= k) break; }
    return out;
  },
});
