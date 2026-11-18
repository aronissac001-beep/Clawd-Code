// The Clean work giver (doc 5.1: clean filth is Haul work; owner E; Stage 2). Targets: filthy tiles
// (work/filth.js), the nearest first: the FILTH_CANDS nearest by straight distance, then ranked by
// the region-graph distance. The cleaner stands on the tile and works FILTH.cleanMin game minutes per
// unit; the effect clears the tile.

import { tx, ty } from '../../core/grid.js';
import { TICKS_PER_MIN } from '../../core/time.js';
import { T, makeJob, registerEffect, keyTile, keyId } from '../jobs.js';
import { colTile } from '../reserve.js';
import { openTarget, distTo, reachableFrom } from '../windex.js';
import { FILTH, filthAt, filthTiles, cleanFilth } from '../filth.js';

export const FILTH_CANDS = 24;
const target = (s, col, i) => {
  if (filthAt(s, i) <= 0 || !openTarget(s, col, keyTile(i)) || !reachableFrom(s, col, i)) return null;
  const d = distTo(s, col, i);
  return d === Infinity ? null : { key: keyTile(i), i, d };
};

export const CLEAN_GIVER = Object.freeze({
  id: 'clean', work: 'haul', order: 10,
  candidates(s, col, k) {
    const tiles = filthTiles(s);
    if (!tiles.length) return [];
    const ci = colTile(col), x = tx(ci), y = ty(ci);
    const near = tiles.map((i) => [Math.max(Math.abs(tx(i) - x), Math.abs(ty(i) - y)), i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, FILTH_CANDS);
    const out = [];
    for (const [, i] of near) { const t = target(s, col, i); if (t) out.push(t); }
    out.sort((a, b) => a.d - b.d || a.key - b.key);
    return out.slice(0, k);
  },
  valid(s, col, t) { return !!target(s, col, t.i); },
  make(s, col, t) {
    const key = keyTile(t.i);
    const n = Math.max(1, filthAt(s, t.i) * FILTH.cleanMin) * TICKS_PER_MIN;
    return { job: makeJob('clean', key, [T.goto(t.i), T.work(n, { fx: 'clean', key })]), claims: [[key, 0]] };
  },
  keyOf: (t) => t.key,
  fromTarget(s, col, tg) { if (!tg || tg.x === undefined) return null; return target(s, col, tg.y * s.w + tg.x); },
});
registerEffect('clean', (s, col, job) => { cleanFilth(s, keyId(job.target)); return undefined; });

export const GIVER = CLEAN_GIVER;
