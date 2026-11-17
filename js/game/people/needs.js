// Needs (doc 4.4). Owner F. Provisional API; off in Stage 1a (colonists do not eat, sleep or mope),
// on from 1b (installPeople({ needs: true })).
//
// col.need = [food, rest, joy, warmth, light] in NEED_IDS order, fixed point 0..100 x FIX (C2).
// Each colonist updates every NEEDS.every ticks, when tick % every == id % every (12.3).
// Falls are exact integers over a day: the drop between ticks t0 and t1 is
//   floor(rate x t1 / DAY) - floor(rate x t0 / DAY), rate = fallPerDay x FIX x traits / 100,
// so a day always removes exactly `rate`, whatever the cadence (1x and 5x identical).
// Warmth and Light (dread) depend on temperature and the light map; they arrive with 1b / Stage 2.

import { NEED_IDS, FIX } from '../core/schema.js';
import { TICKS_PER_DAY } from '../core/time.js';
import { bal, def, traitPct } from './defs.js';

export const NEED = Object.freeze(Object.fromEntries(NEED_IDS.map((n, i) => [n, i])));
export const NEED_MAX = 100 * FIX;

/** Fall per day (x FIX) of a need for a colonist, after the 'need.<id>' trait modifier (Glutton). */
export function fallPerDay(col, needId) {
  const d = def('need', needId);
  const base = d ? d.fallPerDay : (bal('needs').fallPerDay || {})[needId] || 0;
  return Math.floor((base * FIX * traitPct(col, 'need.' + needId)) / 100);
}
/** Exact integer fall between ticks t0 < t1. */
export const fallBetween = (rate, t0, t1) => Math.floor((rate * t1) / TICKS_PER_DAY) - Math.floor((rate * t0) / TICKS_PER_DAY);

/** True when a need is below its urgent threshold (think puts it before work, 5.3). */
export function urgent(col, needId) {
  const u = bal('needs').urgent || {};
  return needId in u && col.need[NEED[needId]] < u[needId] * FIX;
}
/** Add (or remove, with a negative amount) to a need, clamped to 0..100 x FIX. */
export function satisfy(col, needId, amount) {
  const i = NEED[needId];
  const v = col.need[i] + amount;
  col.need[i] = v < 0 ? 0 : v > NEED_MAX ? NEED_MAX : v;
  return col.need[i];
}

/** Is the colonist asleep (its job is a sleep job; E's Rest giver, 1b)? Asleep colonists do not tire. */
const asleep = (col) => !!(col.job && col.job.type === 'sleep');

/** Tick system (slot 'needs'). */
export function needsSystem(s) {
  const every = bal('needs').every || 20;
  const t1 = s.tick, t0 = Math.max(0, t1 - every), slot = t1 % every;
  for (const col of s.col) {
    if (col.id % every !== slot || col.hp.dead) continue;
    for (const id of ['food', 'rest', 'joy']) {
      if (id === 'rest' && asleep(col)) continue;
      const drop = fallBetween(fallPerDay(col, id), t0, t1);
      if (drop) satisfy(col, id, -drop);
    }
  }
}
