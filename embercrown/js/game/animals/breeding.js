// Breeding (doc 6.5): tame animals of a kind breed up to their pen's capacity. Owner K.
// Stage 2 feature; Stage 0 skeleton. Checked once per game day; stops at the animal cap.

import { TICKS_PER_DAY } from '../core/time.js';
/** Tick system (slot 'animals'), daily. */
export function breedingSystem(s) { if (s.tick % TICKS_PER_DAY !== 0) return; }
