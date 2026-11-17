// Ember-touched (doc 4.5): the seized craftsman. Owner F. Stage 2 feature; Stage 0 skeleton.
//
// s.colony.ember (C2) = null | { colId, bench, demand: [[k, m, n]], deadline }. At most one at a
// time. Trigger: a colonist with an EMBER_SKILLS skill at MIN_LVL+, mood >= 30, checked once per
// game day (1.5%, doubled within 3 days of a major event), at most once per 20 days per colony.
// The demand table is js/data/embertouch.js (emberDemand rows by skill and tier). Meeting the
// demand locks a bill on the claimed bench (E's bills) and yields a named artifact
// (text/artifacts.js); missing it leads to a major break (breaks.js).

import { FIX, SKILL_IDS } from '../core/schema.js';
import { TICKS_PER_DAY } from '../core/time.js';
import { all } from './defs.js';

export const EMBER_SKILLS = Object.freeze(['smithing', 'woodcraft', 'masonry', 'tailoring', 'art', 'cooking']);
export const MIN_LVL = 6, MIN_MOOD = 30 * FIX;

export const activeEmber = (s) => s.colony.ember;
/** Is this colonist eligible for the daily check? */
export function eligible(s, col) {
  if (s.colony.ember || col.hp.dead || col.hp.down || col.breakState || col.mood < MIN_MOOD) return false;
  return EMBER_SKILLS.some((k) => col.sk[SKILL_IDS.indexOf(k)][0] >= MIN_LVL);
}
/** Demand rows for a skill and tier (data). */
export const demandRows = (skill, tier) => all('emberDemand').filter((r) => r.skill === skill && r.tier === tier);

/** Tick system (slot 'mood', daily). Stage 0: no trigger (Stage 2 turns it on). */
export function emberSystem(s) {
  if (s.tick % TICKS_PER_DAY !== 0) return;
}
