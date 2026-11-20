// Threats (owner H): one entry point that plugs the threat systems into the sim.
// Importing has no side effects; installThreat() registers tick systems (storyteller; raids, flow
// and rift in 'raids'; foe movement in 'movement'; blows in 'engage'), the `order` applier and the
// incident logic of the Stage 1b horde. Defence (js/game/defence/) installs separately.
//
// Stage 1a: installThreat({ storyteller: false }) - nothing visible; flow fields are built only
// when a test or the bot puts a live raid on the map.
// Stage 1b: installThreat({ storyteller: true }).
// Stage 2 (F's people stage '2'): every incident of js/data/incidents.js, the three storytellers and
// difficulties, nemeses, aftermath, loot and capture, choice letters (the `letter` command).

import { registerSystem, tickSystems } from '../core/bus.js';
import { storytellerSystem, installStoryHooks } from './storyteller.js';
import { raidsSystem, foeMoveSystem } from './raiders.js';
import { flowSystem } from './flow.js';
import { riftSystem } from './rift.js';
import { installOrderCommands } from './orders.js';
import { fightSystem } from './fight.js';
import { installHorde } from './horde.js';
import { installRaids2 } from './raids2.js';
import { installEvents2 } from './events2.js';
import { installLetterCommand } from './letters.js';
import { installNemesis } from './nemesis.js';
import { installAftermath } from './aftermath.js';

export * as incidents from './incidents.js';
export * as storyteller from './storyteller.js';
export * as raidplan from './raidplan.js';
export * as raiders from './raiders.js';
export * as flow from './flow.js';
export * as cast from './cast.js';
export * as nemesis from './nemesis.js';
export * as aftermath from './aftermath.js';
export * as rift from './rift.js';
export * as orders from './orders.js';
export * as fight from './fight.js';
export * as horde from './horde.js';
export * as raids2 from './raids2.js';
export * as events2 from './events2.js';
export * as letters from './letters.js';
export * as capture from './capture.js';
export * as sappers from './sappers.js';
export * as warnings from './warnings.js';
export * as stats from './stats.js';
export * as beasts from './beasts/index.js';
export { setThreatContent } from './defs.js';

const has = (slot, name) => tickSystems().some((x) => x.slot === slot && x.name === name);
const reg = (slot, name, fn, order = 0) => { if (!has(slot, name)) registerSystem(slot, name, fn, order); };

/**
 * Register H's threat systems (idempotent).
 * @param {{ storyteller?: boolean, raids?: boolean, commands?: boolean }} [opts]
 */
export function installThreat({ storyteller = false, raids = true, commands = true } = {}) {
  if (storyteller) { reg('storyteller', 'storyteller', storytellerSystem); installStoryHooks(); }
  if (raids) {
    reg('raids', 'raids', raidsSystem);
    reg('raids', 'flow', flowSystem, 10);
    reg('raids', 'rift', riftSystem, 20);
    reg('movement', 'foes', foeMoveSystem, 10);
    reg('engage', 'fight', fightSystem);
    installHorde();
    // Stage 2 incidents (their logic only runs once the storyteller schedules them: stage2())
    installRaids2();
    installEvents2();
    installNemesis();
    installAftermath();
  }
  if (commands) { installOrderCommands(); installLetterCommand(); }
}
