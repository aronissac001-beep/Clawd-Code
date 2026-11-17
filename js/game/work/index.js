// Work, items and logistics (owner E): one entry point that plugs the work systems into the sim.
// Importing this file has no side effects beyond registering the C13 rebuilds (items, res) and the
// core toils; installWork() registers the tick systems. A (sim setup) and J (determinism, bot)
// call installWork() after resetBus().

import { registerSystem, tickSystems } from '../core/bus.js';
import { registerRebuild } from '../core/rtcontract.js';
import { addTickCheck } from '../core/sim.js';
import { WORK, setMover } from './jobs.js';
import { rebuildItemAt, rebuildItemFree, rebuildItemIndex, rebuildStock, recomputeStock, checkItems } from './items.js';
import { rebuildFromJobs, checkReservations } from './reserve.js';
import { runJobs, straightMover, stubMovementSystem } from './toils.js';
import { thinkTick } from './think.js';

export * as items from './items.js';
export * as jobs from './jobs.js';
export * as reserve from './reserve.js';

const has = (slot, name) => tickSystems().some((x) => x.slot === slot && x.name === name);
const reg = (slot, name, fn) => { if (!has(slot, name)) registerSystem(slot, name, fn); };

/**
 * Register E's tick systems (idempotent).
 * @param {{ think?: boolean, stubMove?: boolean, checks?: boolean }} [opts]
 *   think: register the think system (default true); stubMove: Stage 0 straight-line mover and
 *   movement (until B's pathing lands); checks: debug tick checks (reservations equal
 *   rebuildFromJobs, item caches consistent) that throw on the first leak.
 * @returns {() => void} removes the debug checks
 */
export function installWork({ think = true, stubMove = false, checks = false } = {}) {
  registerRebuild('itemAt', rebuildItemAt); registerRebuild('itemFree', rebuildItemFree);
  registerRebuild('idx', rebuildItemIndex); registerRebuild('stock', rebuildStock);
  registerRebuild('res', rebuildFromJobs);
  if (think) reg('think', 'think', thinkTick);
  reg('jobs', 'toils', runJobs);
  reg('colony', 'stock-recompute', (s) => { if (s.tick % WORK.stockRecompute === 0) recomputeStock(s); });
  if (stubMove) { setMover(straightMover); reg('movement', 'stub-move', stubMovementSystem); }
  if (!checks) return () => {};
  const offs = [addTickCheck(checkReservations), addTickCheck(checkItems)];
  return () => offs.forEach((f) => f());
}
