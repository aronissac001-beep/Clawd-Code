// The Animals work giver (doc 5.1: hunt, tame, train, milk, shear, slaughter, feed). Owner K (the
// only giver in js/game/work/givers/ that E does not own). Implements E's C7 WorkGiver contract
// (work/jobs.js): { id, work, order, candidates, valid, make, keyOf }. Targets are animal ids;
// keys are keyAnim(id) so E's reservations and unreachable memory cover them.
// Stage 0: the contract shape with no candidates (Stage 2 adds taming, milking and slaughter jobs).

import { keyAnim } from '../jobs.js';

export const ANIMAL_JOBS = Object.freeze(['tame', 'train', 'milk', 'shear', 'slaughter', 'hunt', 'feed']);

export const ANIMALS_GIVER = Object.freeze({
  id: 'animals',
  work: 'animals',
  order: 0,
  /** Nearest-first animal ids worth a job, at most k. Stage 2: tame designations, due products. */
  candidates: () => [],
  valid: () => false,
  make: () => null,
  keyOf: (animalId) => keyAnim(animalId),
});
