// Threats (owner H): one entry point that plugs the threat systems into the sim.
// Importing has no side effects; installThreat() registers tick systems, the `order` applier and
// the incident logic of the Stage 1b horde. Defence (js/game/defence/) installs separately.
//
// Stage 1a: installThreat({ storyteller: false }) - nothing visible; flow fields are built only
// when a test or the bot puts a live raid on the map.
// Stage 1b: installThreat({ storyteller: true }).

import { registerSystem, tickSystems } from '../core/bus.js';
import { storytellerSystem } from './storyteller.js';
import { raidsSystem, foeMoveSystem } from './raiders.js';
import { flowSystem } from './flow.js';
import { riftSystem } from './rift.js';
import { installOrderCommands } from './orders.js';

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
export * as lords from './lords/index.js';
export { setThreatContent } from './defs.js';

const has = (slot, name) => tickSystems().some((x) => x.slot === slot && x.name === name);
const reg = (slot, name, fn, order = 0) => { if (!has(slot, name)) registerSystem(slot, name, fn, order); };

/**
 * Register H's threat systems (idempotent).
 * @param {{ storyteller?: boolean, raids?: boolean, commands?: boolean }} [opts]
 */
export function installThreat({ storyteller = false, raids = true, commands = true } = {}) {
  if (storyteller) reg('storyteller', 'storyteller', storytellerSystem);
  if (raids) {
    reg('raids', 'raids', raidsSystem);
    reg('raids', 'flow', flowSystem, 10);
    reg('raids', 'rift', riftSystem, 20);
    reg('movement', 'foes', foeMoveSystem, 10);
  }
  if (commands) installOrderCommands();
}
