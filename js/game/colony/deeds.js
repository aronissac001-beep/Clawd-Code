// Deeds (doc 13.4, from the roguelite achievements): the hold's lasting goals. Owner K.
// Provisional API; first 20 deeds in Stage 2.
//
// s.colony.deeds = [deedId] done, in the order they were earned. A deed's goal { event, n, k? }
// names a C8 event; the sim never reads the event queue, so progress is read from the ledger's
// lifetime counters (ledger.js) through EVENT_COUNTER. Checked once per game day at 06:00, after
// the ledger reset (the lifetime totals are not reset).

import { TICKS_PER_DAY } from '../core/time.js';
import { all } from './defs.js';
import { lifetime, RESET_TICK } from './ledger.js';

/** C8 event name -> ledger lifetime key. */
export const EVENT_COUNTER = Object.freeze({ raidEnd: 'raidsRepelled', oreFound: 'oreFound', masterwork: 'masterworks', mined: 'mined', built: 'built', crafted: 'crafted', died: 'deaths' });

export const hasDeed = (s, id) => s.colony.deeds.includes(id);
export function progress(s, d) {
  const key = EVENT_COUNTER[d.goal.event];
  return key ? Math.min(d.goal.n, lifetime(s, key)) : 0;
}
/** Tick system (slot 'colony', order after the ledger). Returns ids earned this call. */
export function deedsSystem(s) {
  if (s.tick % TICKS_PER_DAY !== RESET_TICK) return [];
  const out = [];
  for (const d of all('deed')) if (!hasDeed(s, d.id) && !d.goal.k && progress(s, d) >= d.goal.n) { s.colony.deeds.push(d.id); out.push(d.id); }
  return out;
}
