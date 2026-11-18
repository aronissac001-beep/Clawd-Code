// Animals (owner K): one entry point that plugs the animal systems into the sim (slot 'animals')
// and the Animals work givers (js/game/work/givers/animals.js, K's) into BUS.workGivers.
// Importing has no side effects. Stage 2 (ai: true) turns the AI on: wild arrivals, wandering and
// grazing, pens, breeding and products, manhunters, and penGuard in the 'path' slot.

import { BUS, registerSystem, tickSystems } from '../core/bus.js';
import { wildSystem, penGuard } from './wild.js';
import { manhunterSystem, installManhunters } from './manhunter.js';
import { pensSystem, installPens } from './pens.js';
import { breedingSystem } from './breeding.js';
import { wildSpawnSystem } from './spawn.js';
import { ANIMAL_GIVERS } from '../work/givers/animals.js';

export * as spawn from './spawn.js';
export * as wild from './wild.js';
export * as manhunter from './manhunter.js';
export * as tame from './tame.js';
export * as pens from './pens.js';
export * as breeding from './breeding.js';
export * as herds from './herds.js';

const has = (slot, name) => tickSystems().some((x) => x.slot === slot && x.name === name);
const reg = (slot, name, fn, order = 0) => { if (!has(slot, name)) registerSystem(slot, name, fn, order); };

/** Register K's animal systems and the Animals givers (idempotent). */
export function installAnimals({ ai = false, giver = true } = {}) {
  reg('animals', 'manhunter', manhunterSystem, 10);
  if (ai) {
    installManhunters(); installPens();
    reg('animals', 'spawn', wildSpawnSystem, 0);
    reg('animals', 'wild', wildSystem, 5);
    reg('animals', 'pens', pensSystem, 20);
    reg('animals', 'breeding', breedingSystem, 30);
    reg('path', 'pen-guard', penGuard, 50);
  }
  if (giver) for (const g of ANIMAL_GIVERS) if (!BUS.workGivers.includes(g)) BUS.workGivers.push(g);
}
