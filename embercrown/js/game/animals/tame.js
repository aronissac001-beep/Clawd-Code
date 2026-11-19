// Taming and training (doc 5.1 Animals work, 6.5). Owner K.
// Taming is an Animals job (work/givers/animals.js): success chance from the tamer's Animals level
// against the kind's `tame` level (js/data/animals.js), rolled on the 'main' stream. A failed try
// makes the animal wary for TAME_COOLDOWN ticks. A tamed animal joins the nearest pen with room
// (pens.js) and 'tamed' (C8) is emitted: the ledger, the deeds, the Chronicle and the husbandry
// discovery (half cost) read it through the events tap.

import { emit } from '../core/events.js';
import { nextU32 } from '../core/rand.js';
import { TICKS_PER_DAY } from '../core/time.js';
import { def } from '../colony/defs.js';
import { level } from '../people/skills.js';
import { penFor, assignPen } from './pens.js';

export const TAME_COOLDOWN = TICKS_PER_DAY;

/** null when col may try to tame the animal, else the reason. */
export function canTame(col, a) {
  const d = def('animal', a.kind);
  if (!d || a.tame) return 'cannot be tamed';
  if (d.tame === undefined) return 'cannot be tamed';
  if (level(col, 'animals') < d.tame) return `needs Animals ${d.tame}`;
  return null;
}
/** Chance in per mille: 300 at the required level, +50 per level above, at most 950. */
export function tameChancePermille(col, a) {
  const d = def('animal', a.kind);
  if (!d || d.tame === undefined) return 0;
  return Math.max(0, Math.min(950, 300 + 50 * (level(col, 'animals') - d.tame)));
}
/** Mark an animal tamed by a colonist. */
export function setTamed(a, colId) { a.tame = true; a.owner = colId; a.st = { mode: 'follow', until: 0, target: null }; return a; }
/** Is the animal still wary from a failed try? */
export const wary = (s, a) => !!a.st && (a.st.wary | 0) > s.tick;
/** One taming try (the end of the tame toil). Returns true on success. */
export function tryTame(s, col, a) {
  if (canTame(col, a)) return false;
  const ok = nextU32(s, 'main') % 1000 < tameChancePermille(col, a);
  if (!ok) { a.st = { ...(a.st || {}), mode: 'wander', until: 0, target: null, wary: s.tick + TAME_COOLDOWN }; return false; }
  setTamed(a, col.id);
  const p = penFor(s, a);
  if (p) assignPen(s, a, p.id);
  emit(s, 'tamed', { colId: col.id, animId: a.id, kind: a.kind });
  return true;
}
