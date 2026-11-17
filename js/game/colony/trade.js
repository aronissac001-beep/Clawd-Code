// Trade with visiting caravans (doc 9.8). Owner K. Provisional API; Stage 2 feature.
// A visit (trader type from js/data/traders.js) stays 1 day at the trade post or the Hearth. Prices:
// base value x buyPct / sellPct, adjusted by the Envoy's Social and the faction's goodwill.
// Visits need a saved home (an addition requested from A: s.colony.visits); until then the
// `trade` command is rejected with a reason.

import { registerApplier } from '../core/commands.js';
import { def } from './defs.js';
import { goodwillPricePct } from './factions.js';

/** Price in tenths of a coin the colony pays for `n` of an item from a trader. */
export function buyPrice(s, traderId, k, n) {
  const t = def('trader', traderId), d = def('item', k);
  if (!t || !d) return 0;
  return Math.ceil((d.value * n * t.buyPct * goodwillPricePct(s, t.faction)) / 10000);
}
/** Price the colony gets for `n` of an item. */
export function sellPrice(s, traderId, k, n) {
  const t = def('trader', traderId), d = def('item', k);
  if (!t || !d) return 0;
  return Math.floor((d.value * n * t.sellPct * (200 - goodwillPricePct(s, t.faction))) / 10000);
}
export function installTradeCommands() {
  registerApplier('trade', () => ({ ok: false, reason: 'no trader is visiting' }));
}
