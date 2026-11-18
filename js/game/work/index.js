// Work, items and logistics (owner E): one entry point that plugs the work systems into the sim.
// Importing this file has no side effects beyond registering the C13 rebuilds (items, res, work
// indexes, zone fields and free lists) and the toils and effects; installWork() registers the tick
// systems, the endOfTick 'zoneFields' pass, the BUS hooks that keep E's incremental indexes exact
// (placed, removed, designated, zoned, zoneCfg, billsChanged, built, B's onTileWrite), the work
// givers and the prioritise hook. A (sim setup) and J (determinism, bot) call installWork() after
// resetBus().

import { BUS, registerSystem, tickSystems } from '../core/bus.js';
import { registerRebuild } from '../core/rtcontract.js';
import { addTickCheck } from '../core/sim.js';
import { DESIG } from '../core/grid.js';
import { onTileWrite } from '../world/terrain.js';
import { WORK, setMover } from './jobs.js';
import { rebuildItemAt, rebuildItemFree, rebuildItemIndex, rebuildStock, recomputeStock, checkItems } from './items.js';
import { rebuildFromJobs, checkReservations } from './reserve.js';
import { runJobs, straightMover, stubMovementSystem } from './toils.js';
import { thinkTick, prioritiseHook } from './think.js';
import { installIndexHooks, clearDesig } from './windex.js';
import { installStockpiles } from './stockpiles.js';
import { installBills } from './bills.js';
import './construct.js';
import './haul.js';
import { HAUL_GIVER } from './givers/haul.js';
import { MINE_GIVER } from './givers/mine.js';
import { CHOP_GIVER } from './givers/chop.js';
import { BUILD_GIVER } from './givers/build.js';
import { CRAFT_GIVER } from './givers/craft.js';
import { GIVER as COOK_GIVER } from './givers/cook.js';
import { GIVER as SMITH_GIVER } from './givers/smith.js';
import { GROW_GIVER, HARVEST_GIVER } from './givers/grow.js';
import { CARE_GIVER } from './givers/care.js';
import { REFUEL_GIVER } from './givers/refuel.js';

export * as items from './items.js';
export * as jobs from './jobs.js';
export * as reserve from './reserve.js';
export * as stockpiles from './stockpiles.js';
export * as construct from './construct.js';
export * as bills from './bills.js';
export * as haul from './haul.js';
export * as quality from './quality.js';
export * as windex from './windex.js';

/** The Stage 1a givers (14.6): Haul, Mine, Chop, Build, Craft. */
export const SLICE_GIVERS = Object.freeze([HAUL_GIVER, MINE_GIVER, CHOP_GIVER, BUILD_GIVER, CRAFT_GIVER]);
/**
 * The Stage 1b givers (14.7): Cook (campfire bills), Grow (grow zones) and Harvest (wild berries),
 * Smith (bloomery and forge bills), Care (rescue) and Refuel (Haul). They are registered by default
 * with the slice givers: in a Stage 1a game they never find a target (no campfire, bloomery, forge
 * or grow zone can be built there, nobody is downed, and the fuel rules are off).
 */
export const FIRST_NIGHT_GIVERS = Object.freeze([COOK_GIVER, GROW_GIVER, HARVEST_GIVER, SMITH_GIVER, CARE_GIVER, REFUEL_GIVER]);
export const ALL_GIVERS = Object.freeze([...SLICE_GIVERS, ...FIRST_NIGHT_GIVERS]);

const has = (slot, name) => tickSystems().some((x) => x.slot === slot && x.name === name);
const reg = (slot, name, fn) => { if (!has(slot, name)) registerSystem(slot, name, fn); };
let offPlant = null;
/** A felled or vanished tree loses its Chop designation (E's index stays exact). */
function onPlantWrite(s, i, layer, before, after) {
  if (layer === 'plant' && after === 0 && (s.L.desig[i] & DESIG.CHOP)) clearDesig(s, i, DESIG.CHOP);
}

/**
 * Register E's tick systems, hooks and givers (idempotent).
 * @param {{ think?: boolean, stubMove?: boolean, checks?: boolean, givers?: object[] | false }} [opts]
 *   think: register the think system (default true); stubMove: Stage 0 straight-line mover and
 *   movement (tests without B's pathing); checks: debug tick checks (reservations equal
 *   rebuildFromJobs, item caches consistent) that throw on the first leak; givers: the work givers
 *   to put in BUS.workGivers (default ALL_GIVERS; false for none).
 * @returns {() => void} removes the debug checks
 */
export function installWork({ think = true, stubMove = false, checks = false, givers = ALL_GIVERS } = {}) {
  registerRebuild('itemAt', rebuildItemAt); registerRebuild('itemFree', rebuildItemFree);
  registerRebuild('idx', rebuildItemIndex); registerRebuild('stock', rebuildStock);
  registerRebuild('res', rebuildFromJobs);
  installIndexHooks();
  installStockpiles();
  installBills();
  if (!offPlant) offPlant = onTileWrite(onPlantWrite);
  if (givers) for (const g of givers) if (!BUS.workGivers.includes(g)) BUS.workGivers.push(g);
  if (!BUS.prioritise.includes(prioritiseHook)) BUS.prioritise.push(prioritiseHook);
  if (think) reg('think', 'think', thinkTick);
  reg('jobs', 'toils', runJobs);
  reg('colony', 'stock-recompute', (s) => { if (s.tick % WORK.stockRecompute === 0) recomputeStock(s); });
  if (stubMove) { setMover(straightMover); reg('movement', 'stub-move', stubMovementSystem); }
  if (!checks) return () => {};
  const offs = [addTickCheck(checkReservations), addTickCheck(checkItems)];
  return () => offs.forEach((f) => f());
}
