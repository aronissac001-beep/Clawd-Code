// Colony systems (owner K): one entry point that plugs wealth, tiers, research, the hold verbs, the
// Chronicle, deeds and the Dawn Ledger into the sim. Importing has no side effects; installColony()
// registers the tick systems (slot 'colony'), the C13 rebuild for rt.wealth, the command appliers
// (research, trade, caravan) and the BUS / terrain hooks of the ledger and the Chronicle.
// Animals install separately (js/game/animals/index.js).
//
// Stage 1a: wealth (HUD). Stage 1b: + tier Camp and the ledger. Stage 2: everything else.

import { registerSystem, tickSystems } from '../core/bus.js';
import { wealthSystem, installWealthRebuild } from './wealth.js';
import { tiersSystem } from './tiers.js';
import { researchSystem, installResearchCommands, installResearchGates, uninstallResearchGates } from './research.js';
import { verbsSystem } from './verbs/index.js';
import { ledgerSystem, installLedger, onTap, offTap } from './ledger.js';
import { deedsSystem } from './deeds.js';
import { installChronicle, chronicleTap, chronicleFounding } from './chronicle.js';
import { installTradeCommands, tradeSystem } from './trade.js';
import { installCaravanCommands } from './caravans.js';

export * as wealth from './wealth.js';
export * as tiers from './tiers.js';
export * as research from './research.js';
export * as verbs from './verbs/index.js';
export * as chronicle from './chronicle.js';
export * as ledger from './ledger.js';
export * as deeds from './deeds.js';
export * as factions from './factions.js';
export * as trade from './trade.js';
export * as caravans from './caravans.js';
export { setColonyContent } from './defs.js';

const has = (slot, name) => tickSystems().some((x) => x.slot === slot && x.name === name);
const reg = (slot, name, fn, order = 0) => { if (!has(slot, name)) registerSystem(slot, name, fn, order); };

/**
 * Register K's colony systems (idempotent).
 * @param {{ tiers?: boolean, research?: boolean, verbs?: boolean, ledger?: boolean, deeds?: boolean,
 *           chronicle?: boolean, commands?: boolean }} [opts]  (`charters`: the pre-Stage-2.9 name of `verbs`)
 */
export function installColony({ tiers = false, research = false, charters = false, verbs = charters, ledger = false, deeds = false, chronicle = true, commands = true, trade = research } = {}) {
  installWealthRebuild();
  reg('colony', 'wealth', wealthSystem, 100);   // last in the slot: after every system that changes items or buildings
  if (tiers) reg('colony', 'tiers', tiersSystem, 110);
  // Stage 2 (research on): the research gates and discoveries, the Chronicle's story lines, caravans and envoys
  if (research) { reg('colony', 'research', researchSystem, 120); installResearchGates(); onTap(chronicleTap); reg('colony', 'founding', chronicleFounding, 105); }
  else { uninstallResearchGates(); offTap(chronicleTap); }
  if (trade) reg('colony', 'trade', tradeSystem, 125);
  if (verbs) reg('colony', 'verbs', verbsSystem, 130);
  if (ledger) { installLedger(); reg('colony', 'ledger', ledgerSystem, 140); }
  if (deeds) reg('colony', 'deeds', deedsSystem, 150);
  if (chronicle) installChronicle();
  if (commands) { installResearchCommands(); installTradeCommands(); installCaravanCommands(); }
}
