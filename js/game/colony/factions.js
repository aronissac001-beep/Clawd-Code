// World factions and goodwill (doc 9.8). Owner K. Provisional API; Stage 2 feature.
// s.colony.factions = { league, hearthwatch, gutterkin } goodwill -100..100 (C2). Goodwill changes
// prices (trade.js), envoy frequency and whether a captured raider can be ransomed.

export const GOODWILL_IDS = Object.freeze(['league', 'hearthwatch', 'gutterkin']);
export const goodwill = (s, f) => (GOODWILL_IDS.includes(f) ? s.colony.factions[f] | 0 : 0);
export function addGoodwill(s, f, d) {
  if (!GOODWILL_IDS.includes(f)) return 0;
  const v = Math.max(-100, Math.min(100, (s.colony.factions[f] | 0) + d));
  s.colony.factions[f] = v;
  return v;
}
/** Price percent adjustment from goodwill: +-10% at +-100 (Stage 2 tuning moves to balance.js). */
export const goodwillPricePct = (s, f) => 100 - Math.trunc(goodwill(s, f) / 10);
