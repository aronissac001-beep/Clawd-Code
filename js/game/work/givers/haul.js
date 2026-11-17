// The Haul work giver (doc 5.6; owner E): stacks that need a better stockpile, nearest-first by
// cluster from the hauler, ranked by region-graph distance (stone only when the colony setting says
// 'always'; otherwise bills and frames fetch it themselves).

import { idx, inB } from '../../core/grid.js';
import { getItem, stackAt, stacksInCluster } from '../items.js';
import { collect } from '../windex.js';
import { haulable, haulCandidate, haulJob } from '../haul.js';

export const HAUL_GIVER = Object.freeze({
  id: 'haul', work: 'haul', order: 0,
  candidates(s, col, k) { return collect(s, col, (c) => stacksInCluster(s, c), (id) => haulCandidate(s, col, id), k); },
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
