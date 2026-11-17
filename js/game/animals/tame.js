// Taming and training (doc 5.1 Animals work, 6.5). Owner K. Stage 2 feature; Stage 0 skeleton.
// Taming is an Animals job (work/givers/animals.js): success chance from the tamer's Animals level
// against the kind's `tame` level (js/data/animals.js), rolled on the 'main' stream.

import { def } from '../colony/defs.js';
import { level } from '../people/skills.js';

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
