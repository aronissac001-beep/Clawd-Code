// The Cook work giver (doc 5.1, 6.5; owner E): bills at cook workbenches (campfire, stove,
// butcher, smokehouse, mills, brewery and casks: brewing is Cook work, 5.1), from the bench-giver
// factory (givers/craft.js); batches that wait unattended (casks, the smokehouse) are recipe waitH.
// Stage 2 adds the fisher's hut (a workplace, 6.5): a Cook catches one fish per FISH_MIN game minutes
// of work, and half as fast when another hut stands within FISH_SHARE_R tiles.

import { tx, ty } from '../../core/grid.js';
import { def } from '../../core/content.js';
import { benchGiver, workplaceGiver } from './craft.js';
import { spawn, spawnAt } from '../items.js';
import { colTile } from '../reserve.js';

export const FISH_MIN = 30, FISH_SHARE_R = 8;
export const GIVER = benchGiver('cook');

/** Another finished fisher's hut within FISH_SHARE_R tiles of b? */
const shared = (s, b) => s.rt.idx.places.some((id) => { const o = s.bld[id]; return o && o !== b && o.def === b.def && Math.max(Math.abs(o.x - b.x), Math.abs(o.y - b.y)) <= FISH_SHARE_R; });
export const FISH_GIVER = workplaceGiver({
  id: 'fish', work: 'cook', defs: ['fisher'], sk: 'cooking', shiftMin: 120, perMin: FISH_MIN, order: 5,
  ok: () => !!def('item', 'fish'),
  yieldFn: (s, col, b, n) => {
    // a shared shore: every other catch is lost (deterministic: by the colonist's work count)
    let got = n;
    if (shared(s, b)) { const job = col.job; got = 0; for (let k = 0; k < n; k++) { job.fishN = (job.fishN | 0) + 1; if (job.fishN % 2 === 0) got++; } }
    if (got > 0) { const ci = colTile(col); spawnAt(s, 'fish', null, 0, got, ci); }
  },
});
