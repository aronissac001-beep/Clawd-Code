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
import { onTileWrite, onFall } from '../world/terrain.js';
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
import { CARE_GIVER, TEND_GIVER, TALK_GIVER, FEED_GIVER, CARE_BENCH_GIVER } from './givers/care.js';
import { REFUEL_GIVER } from './givers/refuel.js';
import { GIVER as TAILOR_GIVER } from './givers/tailor.js';
import { GIVER as ART_GIVER } from './givers/art.js';
import { STUDY_GIVER, LORE_BENCH_GIVER, TABLET_GIVER } from './givers/lore.js';
import { FISH_GIVER } from './givers/cook.js';
import { QUARRY_GIVER } from './givers/mine.js';
import { VDIG_GIVER, VBUILD_GIVER, designateVertical, cancelVertical, VD_NAMES } from './vdig.js';
import { onItemFall } from './items.js';
import { CLEAN_GIVER } from './givers/clean.js';
import { FIRE_GIVER } from './givers/fire.js';
import { PUMP_GIVER } from './givers/pump.js';
import { REPAIR_GIVER } from './givers/repair.js';
import { SMOOTH_GIVER, ENGRAVE_GIVER } from './givers/stone.js';
import { filthSystem } from './filth.js';
import { rotSystem } from './rot.js';
import { haulAudit } from './haul.js';
import { batchSystem } from './bills.js';
import { installOutfits } from './outfit.js';
import { upgradeCmd } from './construct.js';
import { registerApplier, DESIG_NAMES } from '../core/commands.js';
import { SLICE_APPLIERS } from '../core/apply.js';
import { worldStage2 } from '../world/worldrec.js';

export * as items from './items.js';
export * as jobs from './jobs.js';
export * as reserve from './reserve.js';
export * as stockpiles from './stockpiles.js';
export * as construct from './construct.js';
export * as bills from './bills.js';
export * as haul from './haul.js';
export * as quality from './quality.js';
export * as windex from './windex.js';
export * as vdig from './vdig.js';

/** The Stage 1a givers (14.6): Haul, Mine, Chop, Build, Craft. */
export const SLICE_GIVERS = Object.freeze([HAUL_GIVER, MINE_GIVER, CHOP_GIVER, BUILD_GIVER, CRAFT_GIVER]);
/**
 * The Stage 1b givers (14.7): Cook (campfire bills), Grow (grow zones) and Harvest (wild berries),
 * Smith (bloomery and forge bills), Care (rescue) and Refuel (Haul). They are registered by default
 * with the slice givers: in a Stage 1a game they never find a target (no campfire, bloomery, forge
 * or grow zone can be built there, nobody is downed, and the fuel rules are off).
 */
export const FIRST_NIGHT_GIVERS = Object.freeze([COOK_GIVER, GROW_GIVER, HARVEST_GIVER, SMITH_GIVER, CARE_GIVER, REFUEL_GIVER]);
/**
 * Stage 2 givers (14.8 row E): Tailor, Art, Lore (study desk and bench bills), full Care (tend, talk
 * down, feed, the apothecary), the fisher's hut and the quarry, cleaning and the fire emergency (Haul), and
 * Repair (Build: damaged structures, givers/repair.js) lore tablets (Lore: givers/lore.js) and
 * Smooth and Engrave (Craft and Art: givers/stone.js), Stage 2.9b.
 * Each one is quiet until the Stage 2 world rules are on (B's worldrec stage switch), so a Stage 1b game
 * plays exactly as before.
 */
const stage2Only = (g) => Object.freeze({ ...g, candidates: (s, c, k) => (worldStage2() ? g.candidates(s, c, k) : []) });
export const HOLD_GIVERS = Object.freeze([TAILOR_GIVER, ART_GIVER, STUDY_GIVER, LORE_BENCH_GIVER, TEND_GIVER, TALK_GIVER, FEED_GIVER, CARE_BENCH_GIVER,
  FISH_GIVER, QUARRY_GIVER, CLEAN_GIVER, FIRE_GIVER, REPAIR_GIVER, TABLET_GIVER, SMOOTH_GIVER, ENGRAVE_GIVER, PUMP_GIVER].map(stage2Only));
/**
 * Stage Z1 (E5): the vertical work givers, Stairs / Ramp / Channel (Mine) and the built floor and stairs
 * (Build). Quiet until a fortress command designates one (vdig.js): a D = 1 game never has a target.
 */
export const LEVEL_GIVERS = Object.freeze([VDIG_GIVER, VBUILD_GIVER]);
export const ALL_GIVERS = Object.freeze([...SLICE_GIVERS, ...FIRST_NIGHT_GIVERS, ...HOLD_GIVERS, ...LEVEL_GIVERS]);

const has = (slot, name) => tickSystems().some((x) => x.slot === slot && x.name === name);
const reg = (slot, name, fn) => { if (!has(slot, name)) registerSystem(slot, name, fn); };
let offPlant = null, offFall = null;
/** A felled or vanished tree loses its Chop designation (E's index stays exact). */
function onPlantWrite(s, i, layer, before, after) {
  if (layer === 'plant' && after === 0 && (s.L.desig[i] & DESIG.CHOP)) clearDesig(s, i, DESIG.CHOP);
}

const VERT_KINDS_LIVE = () => DESIG_NAMES.some((k) => k in VD_NAMES);
function designateWithLevels(s, c) { return c.kind in VD_NAMES ? designateVertical(s, c) : SLICE_APPLIERS.designate(s, c); }
function cancelWithLevels(s, c) {
  const vk = c.kinds.filter((k) => k in VD_NAMES), rest = c.kinds.filter((k) => !(k in VD_NAMES));
  let n = vk.length ? cancelVertical(s, c.rect, vk) : 0;
  if (rest.length) { const r = SLICE_APPLIERS.cancelRect(s, { ...c, kinds: rest }); if (r && r.ok) n += r.n | 0; else if (!n) return r; }
  return n ? { ok: true, n } : { ok: false, reason: 'nothing to cancel there' };
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
  if (!offFall) offFall = onFall(onItemFall);    // Z1: stacks fall with the floor (2.3)
  if (givers) for (const g of givers) if (!BUS.workGivers.includes(g)) BUS.workGivers.push(g);
  if (!BUS.prioritise.includes(prioritiseHook)) BUS.prioritise.push(prioritiseHook);
  if (think) reg('think', 'think', thinkTick);
  reg('jobs', 'toils', runJobs);
  reg('jobs', 'batches', batchSystem);     // Stage 2: unattended batches come out (no batch exists before)
  reg('jobs', 'filth', filthSystem);       // Stage 2 (quiet before)
  reg('jobs', 'haul-audit', haulAudit);    // Stage 2: stale hauls first (quiet before)
  reg('rot', 'rot', rotSystem);            // Stage 2 (quiet before)
  installOutfits();
  registerApplier('upgrade', upgradeCmd);
  // Z1 (E5): the fortress designate kinds (stairs, ramp, channel, floor, bstairs) once A's command spec
  // lists them; every other kind goes to A's slice applier as before
  if (VERT_KINDS_LIVE()) { registerApplier('designate', designateWithLevels); registerApplier('cancelRect', cancelWithLevels); }
  reg('colony', 'stock-recompute', (s) => { if (s.tick % WORK.stockRecompute === 0) recomputeStock(s); });
  if (stubMove) { setMover(straightMover); reg('movement', 'stub-move', stubMovementSystem); }
  if (!checks) return () => {};
  const offs = [addTickCheck(checkReservations), addTickCheck(checkItems)];
  return () => offs.forEach((f) => f());
}
