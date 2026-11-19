// World factions and goodwill (doc 9.8). Owner K. Provisional API; Stage 2 feature.
// s.colony.factions = { league, hearthwatch, gutterkin } goodwill -100..100 (C2). Goodwill changes
// prices (trade.js), envoy frequency and whether a captured raider can be ransomed.

import { def } from './defs.js';

export const GOODWILL_IDS = Object.freeze(['league', 'hearthwatch', 'gutterkin']);
/** Stage 2: the standings start at the data's `start` values (trade.js calls it once, with its record). */
export function seedGoodwill(s) {
  const f = s.colony.factions;
  for (const id of GOODWILL_IDS) { const d = def('faction', id); if (d && Number.isInteger(d.start) && !(f[id] | 0)) f[id] = d.start; }
}
/** The standing as a word for the Colony panel line. */
export function standingOf(s, f) { const g = goodwill(s, f); return g >= 50 ? 'Allied' : g >= 15 ? 'Friendly' : g > -15 ? 'Neutral' : g > -50 ? 'Wary' : 'Hostile'; }
export const goodwill = (s, f) => (GOODWILL_IDS.includes(f) ? s.colony.factions[f] | 0 : 0);
export function addGoodwill(s, f, d) {
  if (!GOODWILL_IDS.includes(f)) return 0;
  const v = Math.max(-100, Math.min(100, (s.colony.factions[f] | 0) + d));
  s.colony.factions[f] = v;
  return v;
}
/** Price percent adjustment from goodwill: +-10% at +-100 (Stage 2 tuning moves to balance.js). */
export const goodwillPricePct = (s, f) => 100 - Math.trunc(goodwill(s, f) / 10);
