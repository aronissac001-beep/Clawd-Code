// The Grow work giver (doc 5.1, 6.5; owner E; Stage 1b). Targets: tiles of grow zones (idx.plants,
// by cluster, nearest-first) that need work now, and Harvest designations (wild berry bushes).
//   harvest  a ripe crop or bush on the tile (B's isRipe): the grower stands on it, works
//            harvestWork minutes (Growing), B's harvestPlant pulls a crop (the tile is free to sow
//            again) or resets a bush, and the yield drops on the tile (haulers store it).
//   sow      an empty tile where the zone's crop can be sown now (B's canSow: fertile, open sky,
//            warm enough, nothing on it): sowWork minutes, then B's sowPlant. A zone with no crop
//            set grows hearthroot.
// Effects go through B's plants API and E's item API (C5, C6).

import { idx, tx, ty, inB, DESIG } from '../../core/grid.js';
import { TICKS_PER_MIN } from '../../core/time.js';
import { plantCode } from '../../world/defs.js';
import { isRipe, harvestPlant, harvestWork, canSow, sowPlant, sowWork } from '../../world/plants.js';
import { T, makeJob, registerEffect, keyTile, keyId } from '../jobs.js';
import { spawn } from '../items.js';
import { def } from '../../core/content.js';
import { collect, standSpot, openTarget, clearDesig } from '../windex.js';

export const DEFAULT_CROP = 'hearthroot';
const zoneOf = (s, i) => { const id = s.L.zone[i]; if (!id) return null; for (const z of s.zones) if (z.id === id) return z; return null; };
/** The plant code a grow zone tile should hold (its zone's crop, default hearthroot), or 0. */
export function cropCode(s, i) {
  const z = zoneOf(s, i);
  if (!z || z.type !== 'grow') return 0;
  return plantCode(z.crop || DEFAULT_CROP);
}
/** What tile i of a grow zone needs now: 'harvest', 'sow' or null. */
export function growNeed(s, i) {
  if (s.L.desig[i] & DESIG.FORBID) return null;
  if (s.L.plant[i]) return isRipe(s, i) ? 'harvest' : null;
  const code = cropCode(s, i);
  return code && canSow(s, i, code) === null ? 'sow' : null;
}
const target = (s, col, i, what) => {
  if (!what || !openTarget(s, col, keyTile(i))) return null;
  const st = standSpot(s, col, [i], { onTarget: true });
  return st.i < 0 ? null : { key: keyTile(i), i, stand: st.i, d: st.d, what };
};
function growJob(s, col, t) {
  const key = keyTile(t.i);
  const n = Math.max(1, t.what === 'sow' ? sowWork(s, t.i) : harvestWork(s, t.i)) * TICKS_PER_MIN;
  return { job: makeJob(t.what === 'sow' ? 'sow' : 'harvest', key, [T.goto(t.stand), T.work(n, { sk: 'growing', fx: t.what, key })], t.what === 'sow' ? { crop: cropCode(s, t.i) } : {}), claims: [[key, 0]] };
}

export const GROW_GIVER = Object.freeze({
  id: 'grow', work: 'grow', order: 0,
  candidates(s, col, k) { const p = s.rt.idx.plants; return collect(s, col, (c) => p[c], (i) => target(s, col, i, growNeed(s, i)), k); },
  valid(s, col, t) { return !!target(s, col, t.i, growNeed(s, t.i)) && growNeed(s, t.i) === t.what; },
  make(s, col, t) { return growJob(s, col, t); },
  keyOf: (t) => t.key,
  fromTarget(s, col, tg) { if (!tg || tg.x === undefined || !inB(tg.x, tg.y)) return null; const i = idx(tg.x, tg.y); return target(s, col, i, growNeed(s, i) || (wildRipe(s, i) ? 'harvest' : null)); },
});

/** A designated wild plant that is ripe (the Harvest designation, any tile). */
const wildRipe = (s, i) => !!(s.L.desig[i] & DESIG.HARVEST) && !(s.L.desig[i] & DESIG.FORBID) && isRipe(s, i);
/** Harvest designations (wild berries): the Grow work type, after the zones. */
export const HARVEST_GIVER = Object.freeze({
  id: 'harvest', work: 'grow', order: 10,
  candidates(s, col, k) { const d = s.rt.idx.desig.harvest; return collect(s, col, (c) => d[c], (i) => (wildRipe(s, i) ? target(s, col, i, 'harvest') : null), k); },
  valid(s, col, t) { return wildRipe(s, t.i) && !!target(s, col, t.i, 'harvest'); },
  make(s, col, t) { return growJob(s, col, t); },
  keyOf: (t) => t.key,
});

registerEffect('harvest', (s, col, job) => {
  const i = keyId(job.target);
  const y = harvestPlant(s, i);
  if (s.L.desig[i] & DESIG.HARVEST) clearDesig(s, i, DESIG.HARVEST);
  if (y && y.n > 0 && def('item', y.item)) spawn(s, y.item, null, 0, y.n, tx(i), ty(i));
  return undefined;
});
registerEffect('sow', (s, col, job) => {
  const i = keyId(job.target);
  const code = job.crop || cropCode(s, i);
  if (code) sowPlant(s, i, code);   // the tile may have changed since: sowPlant checks canSow again
  return undefined;
});

export const GIVER = GROW_GIVER;
