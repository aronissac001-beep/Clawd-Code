// The tick (doc 12.3). Owner A. Systems register through bus.js; this file only fixes the order.
//   tick(s): s.tick += 1, every registered system in TICK_ORDER, then endOfTick(s). A no-op once the
//   colony has fallen (s.colony.fallen, colony/fall.js), so a Ruin's state hash never changes.
//   endOfTick(s): regions, rooms, temperature, light, zone fields, flow fields - each only when
//   its dirty flag is set - then the dirty flags are cleared (C13: after any tick every derived
//   cache equals a rebuild from saved state).
// Commands (commands.js) are applied between ticks; speed is not sim state (one tick is one tick).

import { tickSystems, END_OF_TICK, endOfTickPass } from './bus.js';
import { newDirty } from './rtcontract.js';

/** Debug / gate checks run after every tick: fn(s) -> null | string (a failure message). */
const afterTick = [];
export function addTickCheck(fn) { afterTick.push(fn); return () => { const i = afterTick.indexOf(fn); if (i >= 0) afterTick.splice(i, 1); }; }
export const tickCheckCount = () => afterTick.length;

export function tick(s) {
  if (s.colony.fallen === true) return;   // a fallen hold is a Ruin: nothing moves again (EMBERCROWN-FORTRESS.md 1.3; colony/fall.js)
  s.tick += 1;
  const sys = tickSystems();
  for (let i = 0; i < sys.length; i++) sys[i].fn(s);
  endOfTick(s);
  if (afterTick.length) {
    for (const fn of afterTick) { const msg = fn(s); if (msg) throw new Error(`tick ${s.tick}: ${msg}`); }
  }
}

export function endOfTick(s) {
  const d = s.rt.dirty;
  for (const pass of END_OF_TICK) {
    if (!d[pass]) continue;
    const fn = endOfTickPass(pass);
    if (fn) fn(s, d);
  }
  if (d.regions || d.rooms || d.temperature || d.light || d.zoneFields || d.flowFields || d.tiles.length) s.rt.dirty = newDirty();
}

/** Run n ticks. */
export function step(s, n = 1) { for (let i = 0; i < n; i++) tick(s); return s; }
