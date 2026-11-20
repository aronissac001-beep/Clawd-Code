// Rot (doc 5.5; owner E; Stage 2). Food has a shelf life (item def shelfD, game days at 20 C). Every
// ROT.every ticks each food stack on the map ages by ROT.every x the rate for its tile:
//   above 25 C: 200%   14-25 C: 100%   0-14 C: 25% (cool cellars)   below 0 C: 0 (frozen)
// times the storage building's store.rotPct (barrel rack 66, granary 50, ice house 0). A stack whose
// age reaches its shelf life spoils (it is destroyed through the item API). Carried food and food in
// a batch do not age. Temperatures are B's read API (tempAt). Integer maths only; stacks are visited
// in id order, so the result does not depend on anything but the saved state.

import { idx } from '../core/grid.js';
import { TICKS_PER_DAY } from '../core/time.js';
import { def, structDef } from '../core/content.js';
import { tempAt } from '../world/terrain.js';
import { worldStage2 } from '../world/worldrec.js';
import { destroy, storeBldAt } from './items.js';

export const ROT = Object.freeze({ every: 600 });
let rotOn = true;
/** Turn rot off or on (tests and benches; a game always has it from Stage 2). */
export function setRotEnabled(on) { rotOn = !!on; }
/** Rot rate percent at tile i (temperature, then the storage building there). */
export function rotPct(s, i) {
  const t = tempAt(s, i);
  let p = t > 25 ? 200 : t >= 14 ? 100 : t >= 0 ? 25 : 0;
  const b = s.rt.occ[i] >= 0 ? storeBldAt(s, i) : null;
  if (b) { const st = structDef(b.def).store; if (st.rotPct !== undefined) p = Math.floor((p * st.rotPct) / 100); }
  return p;
}
/** Shelf life of a kind in ticks, or 0 when it never rots. */
export const shelfTicks = (k) => { const d = def('item', k); return d && d.shelfD ? d.shelfD * TICKS_PER_DAY : 0; };
/** The 'rot' tick system. Returns the stacks that spoiled (tests). */
export function rotSystem(s) {
  if (!rotOn || !worldStage2() || s.tick % ROT.every !== 0) return 0;
  const spoil = [];
  for (const it of s.items) {
    if (!it) continue;
    const life = shelfTicks(it.k);
    if (!life) continue;
    const p = rotPct(s, idx(it.x, it.y, it.z | 0));
    if (!p) continue;
    it.age += Math.floor((ROT.every * p) / 100);
    if (it.age >= life) spoil.push(it.id);
  }
  for (const id of spoil) destroy(s, id);
  return spoil.length;
}
