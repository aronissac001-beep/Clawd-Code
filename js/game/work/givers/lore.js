// The Lore work giver (doc 5.1, 7.12; owner E; Stage 2). Two parts:
//   STUDY_GIVER   the study desk (a workplace): one scholar per desk works a shift; every game
//                 minute of work at speed 1.0 is one lore point (7.12: 1 point per 10 work ticks x
//                 speed), paid to K's research (colony/research.js addLore: the current research, or
//                 the colony's banked lore when nothing is being researched).
//   LORE_BENCH    bills at Lore workbenches (the scriptorium copies books), from the bench factory.
// The survey table (reveal veins around a chosen spot) waits for a target command (Stage 3).

import { benchGiver, workplaceGiver } from './craft.js';
import { addLore } from '../../colony/research.js';

export const STUDY_SHIFT_MIN = 120;
export const STUDY_GIVER = workplaceGiver({
  id: 'study', work: 'lore', defs: ['study'], sk: 'lore', shiftMin: STUDY_SHIFT_MIN, perMin: 1, order: 0,
  yieldFn: (s, col, b, n) => { addLore(s, n); },
});
export const LORE_BENCH_GIVER = benchGiver('lore', 'lorebench');

export const GIVER = STUDY_GIVER;
