// Contract C5 (owner B; reviewers C, E, H; frozen at the end of Stage 0, additions any time):
// the terrain write API, invalidation, and the read API (doc 3.3, 3.4, 12.3, 13.3).
//
// WRITES. Every runtime tile write goes through this file (mapgen writes s.L directly before
// initRuntime). Each write, in the same call:
//   - updates the incremental caches it touches (rt.walkCost, rt.occ, rt.support, rt.depth);
//   - sets the end-of-tick dirty flags in rt.dirty (regions, rooms, temperature, light) and pushes
//     the tile to rt.dirty.tiles (the dirty area list the end-of-tick passes read);
//   - queues a render patch: every listener added with onRenderDirty(fn) is called fn(i). The
//     renderer (C) registers its markDirty(tx, ty) there; js/game/ never imports js/engine/render/,
//     and the sim never reads what the listener does (render-only, C13);
//   - calls the sim-side write hooks (onTileWrite) so other incremental indexes stay exact (E's
//     plant and designation indexes). Hooks must be deterministic.
//   Flags are only set when something they depend on changed (passability for regions, walls and
//   opacity for rooms and light, roofs for light and temperature).
//
// FUEL (Stage 1b): fuel.js holds the Hearth and light fuel rules and E's refuel API (re-exported).
//
// READS (for C, E, F, H): lightAt, tempAt, regionOf, regionDist, plus reachable, compOf,
// passable, walkAt, depthAt, supportAt, roofAt, isKnown. All take (s, i[, side]); side 0 or 'col'
// is the colonist label set, 1 or 'hos' the hostile one (12.3).
//
// INSTALL. installWorld() registers the C13 rebuilds of B's keys, the endOfTick 'regions', 'rooms'
// and 'light' passes, and the world tick systems (fog in 'movement', plant growth in 'plants', cave-ins
// in 'mechanisms'). It is idempotent and has to run again after a bus reset (tests). Nothing happens
// at import.

import { W, H, N, TER, TER_MINEABLE, TER_OPAQUE, ROOF, getBit, setBit, DX8, DY8 } from '../core/grid.js';
import { emit } from '../core/events.js';
import { registerRebuild } from '../core/rtcontract.js';
import { registerEndOfTick } from '../core/bus.js';
import {
  WALK_DOOR, SUPPORT_RADIUS, sideOf, passW, walkOf, isOpaque, isSupport, isDepthSource, footprint,
  occRebuild, walkRebuild, supportRebuild, depthRebuild, supportPatch,
} from './pass.js';
import { regionsPass, regionRebuild, regionHRebuild, regionGraphRebuild } from './regions.js';
import { structDef } from './defs.js';
import { checkCollapse, bindTerrain, installSupport } from './support.js';
import { markClaimsDirty } from './claims.js';
import { installLight } from './light.js';
import { installFog } from './fog.js';
import { installPlants } from './plants.js';
import { installRooms, bindRoof } from './rooms.js';
import { installTemperature, baseTemp, TEMP as TEMP_ } from './temperature.js';
import { installFuel, setFuelRules } from './fuel.js';
import { setWorldStage, worldStage2, ensureWorld } from './worldrec.js';
import { installWeather, bindWeatherTerrain, bindLightning } from './weather.js';
import { installFire, bindFireTerrain, ignite } from './fire.js';
import { installMechanisms, bindMechTerrain } from './mechanisms.js';
import { installBlight, bindBlightTerrain } from './blight.js';
import { waystoneVeto } from './claims.js';
import { BUS } from '../core/bus.js';

export { WALK_DOOR, SIDE, setStructureInfo, DOOR_WALK10, SUPPORT_RADIUS, SUPPORT_CAP } from './pass.js';
export { regionOf, regionDist, reachable, compOf } from './regions.js';
export { setWorldStage, worldStage2, worldRec } from './worldrec.js';
export {
  FUEL, fuelEnabled, usesFuel, fuelTicks, fuelCap, fuelDays, isBurning, acceptsFuel, needsRefuel, fuelWanted, addFuel,
  refuelTargets, hearthFuelDays,
} from './fuel.js';

// ---- Listeners ----------------------------------------------------------------------------------
const renderSinks = [];
/** Render patch queue: fn(i) for every tile whose baked look may have changed. Returns an unsubscribe. */
export function onRenderDirty(fn) { renderSinks.push(fn); return () => { const k = renderSinks.indexOf(fn); if (k >= 0) renderSinks.splice(k, 1); }; }
const markRender = (i) => { for (let k = 0; k < renderSinks.length; k++) renderSinks[k](i); };

const minedHooks = [];
/** Sim-side hook after a tile is mined: fn(s, i, colId, ore) (F's Seam Follower). Returns an unsubscribe. */
export function onMined(fn) { minedHooks.push(fn); return () => { const k = minedHooks.indexOf(fn); if (k >= 0) minedHooks.splice(k, 1); }; }

const writeHooks = [];
/** Sim-side write hook: fn(s, i, layer, before, after) after a layer write. Returns an unsubscribe. */
export function onTileWrite(fn) { writeHooks.push(fn); return () => { const k = writeHooks.indexOf(fn); if (k >= 0) writeHooks.splice(k, 1); }; }
const hook = (s, i, layer, before, after) => { for (let k = 0; k < writeHooks.length; k++) writeHooks[k](s, i, layer, before, after); };

// ---- Dirty helpers ---------------------------------------------------------------------------------
/** Flag bits for invalidate(): which end-of-tick passes a change feeds. */
export const INV = Object.freeze({ REGIONS: 1, ROOMS: 2, TEMPERATURE: 4, LIGHT: 8, RENDER: 16 });
/** Set end-of-tick flags for tile i and queue its render patch (INV bits). Exposed for B's own systems. */
export function invalidate(s, i, bits) {
  const d = s.rt.dirty;
  if (bits & INV.REGIONS) d.regions = true;
  if (bits & INV.ROOMS) d.rooms = true;
  if (bits & INV.TEMPERATURE) d.temperature = true;
  if (bits & INV.LIGHT) d.light = true;
  if (bits & (INV.REGIONS | INV.ROOMS | INV.TEMPERATURE | INV.LIGHT)) d.tiles.push(i);
  if (bits & INV.RENDER) markRender(i);
}

/** Re-derive walkCost of tile i; returns INV bits for what changed (regions when passability did). */
function refreshWalk(s, i) {
  const rt = s.rt, before = rt.walkCost[i], after = walkOf(s, i);
  if (before === after) return 0;
  rt.walkCost[i] = after;
  return passW(before, 0) !== passW(after, 0) || passW(before, 1) !== passW(after, 1) ? INV.REGIONS | INV.ROOMS | INV.TEMPERATURE : 0;
}
/** After a support source changed at (x, y): patch rt.support. */
const refreshSupport = (s, i) => supportPatch(s, i % W, (i / W) | 0);
/** After a depth source changed: depth is recomputed whole (rare: roofs and terrain at the open edge). */
const refreshDepth = (s) => { s.rt.depth = depthRebuild(s); };

// ---- Write API ----------------------------------------------------------------------------------
/**
 * Mine a rock or rubble tile (3.4). It becomes rough floor (stone material kept, ore cleared),
 * roofed thin at depth 1-4 and overhead deeper; the 8 neighbours become known. Sets the region,
 * room, temperature and light flags, queues the render patch and emits `mined` (and `oreFound`
 * for newly known ore). The caller (E's mine toil) spawns the yield and clears the Mine
 * designation through its own index.
 * @returns {null | { mat: number, ore: number, rubble: boolean, depth: number }} null when not mineable
 */
export function mineTile(s, i, colId = null) {
  const L = s.L, rt = s.rt, t = L.terrain[i];
  if (!TER_MINEABLE[t]) return null;
  const rubble = t === TER.RUBBLE;
  const mat = L.mat[i], ore = rubble ? 0 : L.ore[i], depth = rt.depth[i];
  L.terrain[i] = TER.ROUGH;
  if (ore) L.ore[i] = 0;
  const roof = depth >= 5 ? ROOF.MOUNTAIN : ROOF.THIN;
  const roofBefore = L.roof[i];
  if (roofBefore !== ROOF.MOUNTAIN || roof === ROOF.MOUNTAIN) L.roof[i] = roof; // an overhead roof is never thinned
  setBit(L.known, i, 1);
  const x = i % W, y = (i / W) | 0;
  for (let d = 0; d < 8; d++) {
    const nx = x + DX8[d], ny = y + DY8[d];
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    const j = ny * W + nx;
    if (getBit(L.known, j)) continue;
    setBit(L.known, j, 1);
    if (L.terrain[j] === TER.ROCK && L.ore[j]) emit(s, 'oreFound', { i: j, ore: L.ore[j] });
    if (writeHooks.length) hook(s, j, 'known', 0, 1);
  }
  refreshWalk(s, i);
  refreshSupport(s, i);
  markClaimsDirty(s);
  // depth is unchanged: the mined tile keeps a rock roof, so it is not a depth source
  invalidate(s, i, INV.REGIONS | INV.ROOMS | INV.TEMPERATURE | INV.LIGHT | INV.RENDER);
  if (writeHooks.length) { hook(s, i, 'terrain', t, TER.ROUGH); if (ore) hook(s, i, 'ore', ore, 0); }
  emit(s, 'mined', { i, mat, ore, colId });
  for (let k = 0; k < minedHooks.length; k++) minedHooks[k](s, i, colId, ore);
  if (worldStage2()) discoverAround(s, i);
  // a support is gone: roofed tiles around it that lost their last support cave in (risky mining, 3.4)
  checkCollapse(s, i);
  return { mat, ore, rubble, depth };
}

/**
 * Discoveries (3.5, Stage 2): a mined tile that opens onto a cavern (moss under the mountain), an
 * underground pool or spring, or an Old Crown vault wall emits `discovery` { kind, i } the first time
 * each kind is met (s.colony.world.disc keeps the kinds found).
 */
function discoverAround(s, i) {
  const x = i % W, y = (i / W) | 0;
  for (let d = 0; d < 8; d++) {
    const nx = x + DX8[d], ny = y + DY8[d];
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    const j = ny * W + nx, t = s.L.terrain[j], roofed = s.L.roof[j] === ROOF.MOUNTAIN;
    let kind = null;
    if (t === TER.MOSS && roofed) kind = 'cavern';
    else if (t === TER.SHALLOW && roofed) kind = 'spring';
    else if (s.rt.occ[j] >= 0) { const b = s.bld[s.rt.occ[j]]; if (b && b.name === 'Old Crown wall') kind = 'vault'; }
    if (!kind) continue;
    const w = ensureWorld(s);
    if (!w.disc) w.disc = [];
    if (w.disc.includes(kind)) continue;
    w.disc.push(kind); w.disc.sort();
    emit(s, 'discovery', { kind, i: j });
  }
}

/** General terrain write (cave-ins to rubble, tilling, ice, mapgen fixes at runtime). */
export function setTerrain(s, i, ter, mat = s.L.mat[i]) {
  const L = s.L, before = L.terrain[i];
  if (before === ter && L.mat[i] === mat) return false;
  const wasSupport = isSupport(s, i), wasOpaque = TER_OPAQUE[before], wasSource = isDepthSource(s, i);
  L.terrain[i] = ter; L.mat[i] = mat;
  let bits = INV.RENDER | refreshWalk(s, i);
  const lost = wasSupport && !isSupport(s, i);
  if (wasSupport !== isSupport(s, i)) refreshSupport(s, i);
  if (wasSource !== isDepthSource(s, i)) refreshDepth(s);
  if (wasOpaque !== TER_OPAQUE[ter]) bits |= INV.LIGHT | INV.ROOMS | INV.TEMPERATURE;
  markClaimsDirty(s);
  invalidate(s, i, bits);
  if (writeHooks.length) hook(s, i, 'terrain', before, ter);
  if (lost) checkCollapse(s, i);
  return true;
}

/** Constructed floor id (0 none). Room stats change (beauty, value); the chunk patch redraws. */
export function setFloor(s, i, floor) {
  const before = s.L.floor[i];
  if (before === floor) return false;
  s.L.floor[i] = floor;
  invalidate(s, i, INV.ROOMS | INV.RENDER);
  if (writeHooks.length) hook(s, i, 'floor', before, floor);
  return true;
}

/** Roof (ROOF.*). Changes darkness (light), room roofing and temperature, and possibly depth. */
export function setRoof(s, i, roof) {
  const before = s.L.roof[i];
  if (before === roof) return false;
  const wasSource = isDepthSource(s, i);
  s.L.roof[i] = roof;
  if (wasSource !== isDepthSource(s, i)) refreshDepth(s);
  markClaimsDirty(s);
  invalidate(s, i, INV.LIGHT | INV.ROOMS | INV.TEMPERATURE | INV.RENDER);
  if (writeHooks.length) hook(s, i, 'roof', before, roof);
  return true;
}

/** Plant kind and growth (plants are drawn per frame; no end-of-tick pass depends on them). */
export function setPlant(s, i, plant, growth = 0) {
  const before = s.L.plant[i];
  s.L.plant[i] = plant; s.L.growth[i] = growth;
  if (before !== plant && writeHooks.length) hook(s, i, 'plant', before, plant);
}
/** Growth only (the plants system's hot path: no hooks, no flags). */
export function setGrowth(s, i, growth) { s.L.growth[i] = growth; }
/** Blight 0-255 (baked tint: render patch when the visible band changes). */
export function setBlight(s, i, v) {
  const before = s.L.blight[i];
  if (before === v) return;
  s.L.blight[i] = v;
  if ((before >> 6) !== (v >> 6)) markRender(i);
}
/** Known bit (material and ore visible): render patch. */
export function setKnown(s, i, on = true) {
  if (!!getBit(s.L.known, i) === on) return;
  setBit(s.L.known, i, on ? 1 : 0);
  markRender(i);
  if (writeHooks.length) hook(s, i, 'known', on ? 0 : 1, on ? 1 : 0);
}
/** Explored bit (surface fog): render patch. */
export function setExplored(s, i, on = true) {
  if (!!getBit(s.L.fog, i) === on) return;
  setBit(s.L.fog, i, on ? 1 : 0);
  markRender(i);
}

/**
 * A building appeared, changed state (blueprint > frame > done, door locked) or is about to go.
 * on = true writes its footprint into rt.occ, false clears it (call before s.bld[id] = null).
 * Updates walk cost and support, and sets region, room, temperature and light flags when they changed.
 */
export function setOcc(s, b, on = true) {
  const rt = s.rt, d = structDef(b.def), lost = [];
  for (const i of footprint(s, b)) {
    if (i < 0 || i >= N) continue;
    const wasSupport = isSupport(s, i), wasOpaque = isOpaque(s, i);
    if (on) rt.occ[i] = b.id; else if (rt.occ[i] === b.id) rt.occ[i] = -1;
    let bits = refreshWalk(s, i);
    if (wasSupport !== isSupport(s, i)) { refreshSupport(s, i); if (wasSupport) lost.push(i); }
    if (wasOpaque !== isOpaque(s, i)) bits |= INV.LIGHT | INV.ROOMS | INV.TEMPERATURE;
    if (bits) invalidate(s, i, bits);
  }
  // a light source (the Hearth, sconces) or a claiming building (the Hearth, waystones) changed
  if (d && d.light) s.rt.dirty.light = true;
  if (d && (d.heat || b.def === 'icehouse')) s.rt.dirty.temperature = true;
  if (d && d.claim) markClaimsDirty(s);
  for (const i of lost) checkCollapse(s, i);
}
/** Re-derive the tiles of a building after its state changed in place (st, def, lock). */
export const refreshBuilding = (s, b) => setOcc(s, b, true);

// ---- Read API -------------------------------------------------------------------------------------
/** Light level 0-3 (the single light source for sim and render, 3.3). */
export const lightAt = (s, i) => s.rt.light[i];
/** Walk cost code of tile i (pass.js encoding: 0 blocked, WALK_DOOR door, else cost x10). */
export const walkAt = (s, i) => s.rt.walkCost[i];
/** Can `side` stand on / walk through tile i? */
export const passable = (s, i, side = 0) => passW(s.rt.walkCost[i], sideOf(side));
export const depthAt = (s, i) => s.rt.depth[i];
export const supportAt = (s, i) => s.rt.support[i];
export const roofAt = (s, i) => s.L.roof[i];
export const isKnown = (s, i) => getBit(s.L.known, i) === 1;
/** True when a roofed tile has a support within SUPPORT_RADIUS (3.4); unroofed tiles are always fine. */
export const supported = (s, i) => s.L.roof[i] === ROOF.OPEN || s.rt.support[i] <= SUPPORT_RADIUS;

// Temperature (3.6): the model lives in world/temperature.js (Stage 1b: rooms and heat sources,
// constant seasons), which fills rt.roomTemp and rt.heat at the end of the tick.
export { TEMP, outdoorTemp } from './temperature.js';
/** Base temperature of tile i (C, integer): outdoor, or blended toward 12 C under rock. */
export const baseTempAt = (s, i) => baseTemp(s, i);
/** Temperature at tile i (C, integer): the room's temperature when it has one, else base + rt.heat. */
export function tempAt(s, i) {
  const rt = s.rt, room = rt.room[i];
  if (room && rt.roomTemp[room] !== undefined && rt.roomTemp[room] !== null) return rt.roomTemp[room];
  const v = baseTemp(s, i) + rt.heat[i];
  return v < TEMP_.MIN ? TEMP_.MIN : v > TEMP_.MAX ? TEMP_.MAX : v;
}

// ---- Install ----------------------------------------------------------------------------------------
/**
 * Register B's C13 rebuilds, the endOfTick passes and the world tick systems. Idempotent; call after
 * resetBus(). opts.fuel turns the Stage 1b fuel rules on or off (fuel.js); omitted, they stay as set.
 * opts.stage ('2' and later) turns the Stage 2 world rules on (weather, fire, blight, rumbling
 * cave-ins, mechanisms, frozen water, Stage 2 map features); omitted, they stay as set (F's
 * installPeople also sets them from the people stage until A's installSim passes the stage here).
 * The Stage 2 systems are always registered and do nothing while the rules are off.
 */
export function installWorld(opts = {}) {
  if (opts.fuel !== undefined) setFuelRules(opts.fuel);
  if (opts.stage !== undefined) setWorldStage(opts.stage);
  bindWeatherTerrain(setTerrain);
  bindFireTerrain(setPlant, setFloor);
  bindMechTerrain(refreshBuilding);
  bindBlightTerrain(setBlight);
  bindLightning(ignite);
  installWeather();
  installFire();
  installMechanisms();
  installBlight();
  if (!BUS.canPlace.includes(waystoneVeto)) BUS.canPlace.push(waystoneVeto);
  bindTerrain(setTerrain);
  bindRoof(setRoof);
  installLight();
  installRooms();
  installFog();
  installPlants();
  installSupport();
  installTemperature();
  installFuel();
  registerRebuild('occ', occRebuild);
  registerRebuild('walkCost', walkRebuild);
  registerRebuild('support', supportRebuild);
  registerRebuild('depth', depthRebuild);
  registerRebuild('region', regionRebuild);
  registerRebuild('regionH', regionHRebuild);
  registerRebuild('regionGraph', regionGraphRebuild);
  registerEndOfTick('regions', (s, d) => { regionsPass(s, d); });
}

/** Debug summary for window.__ec.stats() and tests. */
export function worldStats(s) {
  const g = s.rt.regionGraph;
  let open = 0, doors = 0;
  for (let i = 0; i < N; i++) { const w = s.rt.walkCost[i]; if (w) open++; if (w === WALK_DOOR) doors++; }
  return { open, doors, regions: g && g.col ? g.col.regions : 0, regionsH: g && g.hos ? g.hos.regions : 0, links: g && g.col ? g.col.links.length : 0 };
}
