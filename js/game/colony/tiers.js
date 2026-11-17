// Prosperity tiers (doc 8.4). Owner K. Provisional API; Camp only in Stage 1b, to Village in Stage 2.
//
// s.colony.tier is the tier index (js/data/tiers.js file order). The next tier is reached when its
// wealth, colonist count and Hearth level (and, for Crownhold, one defeated Lord) all hold for one
// full game day; tiers never drop. Checked every game hour. The start of the current streak is
// s.colony.tierSince (tick, -1 none): an addition to the colony record requested from A (C2-full);
// colonyFromPlain keeps unknown keys, so it is saved meanwhile.

import { TICKS_PER_HOUR, TICKS_PER_DAY } from '../core/time.js';
import { emit } from '../core/events.js';
import { all } from './defs.js';
import { computeWealth } from './wealth.js';

export const tierList = () => all('tier');
export const tierDef = (s) => tierList()[s.colony.tier] || null;
export const tierIndex = (id) => tierList().findIndex((t) => t.id === id);
/** True when the colony's tier is at least the tier id (unknown ids count as reached). */
export function atLeast(s, id) { const i = tierIndex(id); return i < 0 || s.colony.tier >= i; }

const livingColonists = (s) => s.col.reduce((n, c) => n + (c.hp.dead ? 0 : 1), 0);
/** Does the colony meet a tier's conditions right now? */
export function meets(s, t, wealth = computeWealth(s).total) {
  if (!t) return false;
  if (wealth < t.wealth || livingColonists(s) < t.colonists || s.colony.hearth.lvl < t.hearth) return false;
  if (t.lord && !s.colony.lordsDone.length) return false;
  return true;
}

/** Tick system (slot 'colony'). */
export function tiersSystem(s) {
  if (s.tick % TICKS_PER_HOUR !== 0) return;
  const c = s.colony, next = tierList()[c.tier + 1];
  if (c.tierSince === undefined) c.tierSince = -1;
  if (!next || !meets(s, next)) { c.tierSince = -1; return; }
  if (c.tierSince < 0) { c.tierSince = s.tick; return; }
  if (s.tick - c.tierSince < TICKS_PER_DAY) return;
  c.tier++;
  c.tierSince = -1;
  emit(s, 'tierUp', { tier: next.id });
}
