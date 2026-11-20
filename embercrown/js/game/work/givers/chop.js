// The Chop work giver (doc 5.1; owner E). Targets: tiles with the Chop designation holding a tree;
// the feller stands on the tree tile or next to it. Effect: B's fellPlant, the designation cleared,
// the yield (wood) dropped on the tree's tile.

import { idx, tx, ty, inB, DESIG } from '../../core/grid.js';
import { TICKS_PER_MIN } from '../../core/time.js';
import { isTreeCode, plantDef } from '../../world/defs.js';
import { fellPlant, chopWork } from '../../world/plants.js';
import { T, makeJob, registerEffect, keyTile, keyId } from '../jobs.js';
import { spawn, spawnAt } from '../items.js';
import { def } from '../../core/content.js';
import { collect, standSpot, openTarget, clearDesig } from '../windex.js';

const target = (s, col, i) => {
  if (!(s.L.desig[i] & DESIG.CHOP) || !isTreeCode(s.L.plant[i]) || (s.L.desig[i] & DESIG.FORBID)) return null;
  if (!openTarget(s, col, keyTile(i))) return null;
  const st = standSpot(s, col, [i], { onTarget: true });
  return st.i < 0 ? null : { key: keyTile(i), i, stand: st.i, d: st.d };
};

export const CHOP_GIVER = Object.freeze({
  id: 'chop', work: 'chop', order: 0,
  candidates(s, col, k) { const d = s.rt.idx.desig.chop; return collect(s, col, (c) => d[c], (i) => target(s, col, i), k); },
  valid(s, col, t) { return !!target(s, col, t.i); },
  make(s, col, t) {
    const key = keyTile(t.i);
    const n = Math.max(1, chopWork(s, t.i)) * TICKS_PER_MIN;
    return { job: makeJob('chop', key, [T.goto(t.stand), T.work(n, { sk: 'growing', fx: 'chop', key })]), claims: [[key, 0]] };
  },
  keyOf: (t) => t.key,
  fromTarget(s, col, tg) { if (!tg || tg.x === undefined || !inB(tg.x, tg.y)) return null; return target(s, col, idx(tg.x, tg.y, tg.z | 0)); },
});

/** Material of a plant's yield: the plant's own material, else 'wood' for wood items. */
const yieldMat = (p, item) => (p && p.mat) || (def('item', item) && def('material', item) ? item : null);

registerEffect('chop', (s, col, job) => {
  const i = keyId(job.target);
  const p = plantDef(s.L.plant[i]);
  const y = isTreeCode(s.L.plant[i]) ? fellPlant(s, i) : null;
  clearDesig(s, i, DESIG.CHOP);
  if (y && y.n > 0 && def('item', y.item)) spawnAt(s, y.item, yieldMat(p, y.item), 0, y.n, i);
  return undefined;
});
