// Colony charters (doc 8.3). Owner K. Provisional API; the first charter at Hamlet (Stage 3 content).
//
// s.colony.charters = [charterId] (at most 2: the first at Hamlet, a second, different one at
// Stronghold). Each charter's signature mechanic lives in charters/<id>.js; this file holds the
// shared rules and the storyteller nudge that H's storyteller multiplies into incident weights:
// preferred tags x3, rare tags x0.3, and the first major after chartering fixed (`story.first`).

import { registerApplier } from '../core/commands.js';
import { def } from './defs.js';
import { atLeast } from './tiers.js';
import { MECHANIC as forgehold } from './charters/forgehold.js';
import { MECHANIC as greenhold } from './charters/greenhold.js';
import { MECHANIC as lanternhold } from './charters/lanternhold.js';
import { MECHANIC as tradehold } from './charters/tradehold.js';
import { MECHANIC as bulwark } from './charters/bulwark.js';

export const MECHANICS = Object.freeze({ forgehold, greenhold, lanternhold, tradehold, bulwark });
export const CHARTER_IDS = Object.freeze(['forgehold', 'greenhold', 'lanternhold', 'tradehold', 'bulwark']);
export const SLOT_TIERS = Object.freeze(['hamlet', 'stronghold']);
export const PREFER_PCT = 300, RARE_PCT = 30;

export const hasCharter = (s, id) => s.colony.charters.includes(id);
/** null when the colony may take this charter now, else the reason. */
export function canCharter(s, id) {
  if (!def('charter', id)) return 'no such charter';
  if (hasCharter(s, id)) return 'already chartered';
  const n = s.colony.charters.length;
  if (n >= SLOT_TIERS.length) return 'no charter slot left';
  if (!atLeast(s, SLOT_TIERS[n])) return `needs the ${SLOT_TIERS[n]} tier`;
  return null;
}
export function takeCharter(s, id) {
  const r = canCharter(s, id);
  if (r) return r;
  s.colony.charters.push(id);
  return null;
}

/** Weight percent (100 = unchanged) the charters give an incident with these tags. */
export function charterWeightPct(s, tags = []) {
  let pct = 100;
  for (const id of s.colony.charters) {
    const st = (def('charter', id) || {}).story;
    if (!st) continue;
    if ((st.prefer || []).some((t) => tags.includes(t))) pct = Math.floor((pct * PREFER_PCT) / 100);
    else if ((st.rare || []).some((t) => tags.includes(t))) pct = Math.floor((pct * RARE_PCT) / 100);
  }
  return pct;
}
/** The fixed first major after the latest charter, or null. */
export function firstMajorAfter(s) {
  const id = s.colony.charters[s.colony.charters.length - 1];
  const st = id ? (def('charter', id) || {}).story : null;
  return st && st.first ? st.first : null;
}

/** Tick system (slot 'colony'): each chartered mechanic's tick. */
export function chartersSystem(s) { for (const id of s.colony.charters) { const m = MECHANICS[id]; if (m) m.tick(s); } }

export function installCharterCommands() {
  registerApplier('charter', (s, c) => { const r = takeCharter(s, c.id); return r ? { ok: false, reason: r } : { ok: true }; });
}
