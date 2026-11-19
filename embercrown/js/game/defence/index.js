// Defence (owner H): towers, traps, ballista, spire, the Hearth's night shot and the lit-tile bonus.
// Importing has no side effects; installDefence() registers the tick systems (slot 'defence') and
// the BUS.dmgMult light handler. Stage 1b turns on the Hearth shot and the brazier bonus; Stage 2
// (stage2()) the traps with their rearm giver, the ballista, tower range and cover, early warnings.

import { BUS, registerSystem, tickSystems } from '../core/bus.js';
import { hearthShotSystem } from './hearth.js';
import { litBonus } from './braziers.js';
import { towersSystem } from './towers.js';
import { trapsSystem, installTraps } from './traps.js';
import { ballistaSystem } from './ballista.js';
import { spireSystem } from './spire.js';

export * as hearth from './hearth.js';
export * as braziers from './braziers.js';
export * as towers from './towers.js';
export * as traps from './traps.js';
export * as ballista from './ballista.js';
export * as spire from './spire.js';

const has = (slot, name) => tickSystems().some((x) => x.slot === slot && x.name === name);
const reg = (slot, name, fn, order = 0) => { if (!has(slot, name)) registerSystem(slot, name, fn, order); };

/** Register H's defence systems (idempotent). */
export function installDefence({ hearth = true, light = true } = {}) {
  if (hearth) reg('defence', 'hearth-shot', hearthShotSystem);
  reg('defence', 'towers', towersSystem, 10);
  reg('defence', 'traps', trapsSystem, 20);
  reg('defence', 'ballista', ballistaSystem, 30);
  reg('defence', 'spire', spireSystem, 40);
  if (light && !BUS.dmgMult.includes(litBonus)) BUS.dmgMult.push(litBonus);
  installTraps();
}
