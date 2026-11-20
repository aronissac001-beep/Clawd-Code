// Stone work (doc 5.1 Craft "smoothing" and Art "engrave"; EMBERCROWN-FORTRESS.md 3.1 Stone Carver and
// Chronicler; owner E; Stage 2.9b). Two givers over the Smooth and Engrave designations (A's `designate`
// command, the Orders menu and the Carve hall Smooth chip; indexed in windex DESIG_INDEX):
//   SMOOTH_GIVER   Craft (Masonry): a rough floor tile marked Smooth is dressed into a smoothed stone floor
//                  (the `f_smooth` floor; beauty for the room) in STONE.smoothMin game minutes.
//   ENGRAVE_GIVER  Art: a smoothed floor marked Engrave is carved with a scene of the hold's story
//                  (the `f_engraved` floor; more beauty) in STONE.engraveMin game minutes.
// The worker stands on the tile. Smoothing counts the `stone_worked` deed; engraving counts `stone_worked`
// and `walls_engraved`. Both floors are structure defs (G, js/data/structures/walls.js): until a def is in
// the content, its giver has no target. A rock face marked Smooth waits (a smoothed wall face needs its own
// mark on the map, Stage Z).

import { DESIG, TER } from '../../core/grid.js';
import { TICKS_PER_MIN } from '../../core/time.js';
import { floorIdOf } from '../../core/apply.js';
import { setFloor } from '../../world/terrain.js';
import { T, makeJob, registerEffect, keyTile, keyId } from '../jobs.js';
import { collect, openTarget, distTo, reachableFrom, clearDesig } from '../windex.js';
import { didDeed } from '../../people/coldeeds.js';

export const STONE = Object.freeze({ smoothMin: 40, engraveMin: 90, smoothFloor: 'f_smooth', engravedFloor: 'f_engraved' });
/** Floor layer ids of the smoothed and engraved floors (0 while the def is not in the content). */
export const smoothId = () => floorIdOf(STONE.smoothFloor);
export const engravedId = () => floorIdOf(STONE.engravedFloor);

/** Can tile i be smoothed now? A rough floor marked Smooth, nothing laid or built on it. */
export function smoothable(s, i) {
  const v = s.L.desig[i];
  return !!(v & DESIG.SMOOTH) && !(v & DESIG.FORBID) && s.L.terrain[i] === TER.ROUGH && s.L.floor[i] === 0 && s.rt.occ[i] < 0 && smoothId() > 0;
}
/** Can tile i be engraved now? A smoothed floor marked Engrave. */
export function engravable(s, i) {
  const v = s.L.desig[i], sid = smoothId();
  return !!(v & DESIG.ENGRAVE) && !(v & DESIG.FORBID) && sid > 0 && s.L.floor[i] === sid && engravedId() > 0;
}
const target = (s, col, i, ok) => {
  if (!ok(s, i) || !openTarget(s, col, keyTile(i)) || !reachableFrom(s, col, i)) return null;
  const d = distTo(s, col, i);
  return d === Infinity ? null : { key: keyTile(i), i, d };
};
function giver({ id, work, desig, ok, min, sk, fx }) {
  return Object.freeze({
    id, work, order: 8,
    candidates(s, col, k) { const d = s.rt.idx.desig[desig]; if (!d) return []; return collect(s, col, (c) => d[c], (i) => target(s, col, i, ok), k); },
    valid(s, col, t) { return !!target(s, col, t.i, ok); },
    make(s, col, t) { const key = keyTile(t.i); return { job: makeJob(id, key, [T.goto(t.i), T.work(min * TICKS_PER_MIN, { sk, fx, key })]), claims: [[key, 0]] }; },
    keyOf: (t) => t.key,
    fromTarget(s, col, tg) { if (!tg || tg.x === undefined) return null; return target(s, col, tg.y * s.w + tg.x, ok); },
  });
}
export const SMOOTH_GIVER = giver({ id: 'smooth', work: 'craft', desig: 'smooth', ok: smoothable, min: STONE.smoothMin, sk: 'masonry', fx: 'smooth' });
export const ENGRAVE_GIVER = giver({ id: 'engrave', work: 'art', desig: 'engrave', ok: engravable, min: STONE.engraveMin, sk: 'art', fx: 'engrave' });

/** Smooth tile i (the effect, also for tests): the smoothed floor, the mark cleared, the deed. */
export function smoothTile(s, col, i) {
  if (!smoothable(s, i)) return false;
  setFloor(s, i, smoothId());
  clearDesig(s, i, DESIG.SMOOTH);
  if (col) didDeed(s, col, 'stone_worked');
  return true;
}
/** Engrave tile i: the engraved floor, the mark cleared, the deeds. */
export function engraveTile(s, col, i) {
  if (!engravable(s, i)) return false;
  setFloor(s, i, engravedId());
  clearDesig(s, i, DESIG.ENGRAVE);
  if (col) { didDeed(s, col, 'stone_worked'); didDeed(s, col, 'walls_engraved'); }
  return true;
}
registerEffect('smooth', (s, col, job) => (smoothTile(s, col, keyId(job.target)) ? undefined : 'targetGone'));
registerEffect('engrave', (s, col, job) => (engraveTile(s, col, keyId(job.target)) ? undefined : 'targetGone'));
