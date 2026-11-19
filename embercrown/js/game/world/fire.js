// Fire (owner B; doc 5.1, 7.x, 9.7, 13.1; data js/data/worldgen.js WORLD.fire; Stage 2).
//
//   Flames live on tiles, in the saved list s.colony.world.fire = [[tile, heat, fuel]] (sorted by
//   tile; fuel = ticks of burning left). A tile can burn when it holds something flammable:
//     a plant (trees, bushes, crops, wild plants), a building whose def has the 'flammable' flag or
//     is made of a flammable material (wood), a flammable constructed floor (planks, carpet), or an
//     item stack of a flammable material or the 'fuel' tag (wood, charcoal).
//   Bare ground, stone, rock, water and ice never burn, so fire spreads ONLY over flammable tiles
//   (acceptance, 14.8). Overhead mountain roofs (roof 3) never catch from a tile outside them.
//
//   fireSystem (tick slot 'fire', every WORLD.fire.every ticks, flames in tile order over a copy):
//     - burns `every` ticks of fuel; damages the building there (WORLD.fire.bldDmg hp per step; at 0 hp
//       it is destroyed through A's removeBuilding(destroyed)), and calls every onBurn(fn) listener
//       with (s, tile, ids of colonists standing there): F applies burn wounds;
//     - may spread to each flammable 8-neighbour: per-mille WORLD.fire.spreadPermille x the weather's
//       spreadPct (rain 30, drought 200) x heat / 100, decided by a hash of (tile, neighbour, tick), so
//       no RNG stream moves and a saved fire continues identically;
//     - rain and snow put outdoor flames out (weather fireOutPermille);
//     - a flame whose fuel is spent burns its tile away: the plant goes, a flammable floor goes, the
//       stack goes (E's item API destroy), and it goes out.
//   Fires give light (light.js reads fireTiles) and set the light flag when they start or go out.
//
//   API: canBurn(s, i), ignite(s, i, heat?) -> bool (H's fire disaster, F's Pyromaniac and
//   Firestarter break, lightning in a drought), burning(s, i), fireTiles(s), fireCount(s),
//   firesNear(s, i, r) (E's fire emergency: sorted tiles within r), extinguish(s, i, amount) -> bool
//   when it went out (E's firefighting toil), onBurn(fn).

import { W, H, ROOF } from '../core/grid.js';
import { emit } from '../core/events.js';
import { registerSystem, tickSystems } from '../core/bus.js';
import { WORLD } from '../../data/worldgen.js';
import { worldRec, ensureWorld, worldStage2, findKey, putKey, hash3 } from './worldrec.js';
import { structDef, hasFlag, plantDef, floorDefById, materialDef, itemDefOf } from './defs.js';
import { spreadPct, fireOutPermille } from './weather.js';
import { removeBuilding } from '../core/apply.js';
import { destroy as destroyStack } from '../work/items.js';

export const FIRE = WORLD.fire;
const DX = [0, 1, 0, -1, 1, 1, -1, -1], DY = [-1, 0, 1, 0, -1, 1, 1, -1];

const burnListeners = [];
/** fn(s, tile, colonistIds) for every burning step on a tile with colonists on it. Returns an unsubscribe. */
export function onBurn(fn) { burnListeners.push(fn); return () => { const k = burnListeners.indexOf(fn); if (k >= 0) burnListeners.splice(k, 1); }; }
let setPlantFn = null, setFloorFn = null;
/** terrain.js hands its plant and floor writers over (avoids an import cycle). */
export function bindFireTerrain(setPlant, setFloor) { setPlantFn = setPlant; setFloorFn = setFloor; }

const matFlammable = (m) => { const d = materialDef(m); return !!d && !!d.tags && d.tags.includes('flammable'); };
/** Is the building flammable (def flag, or a flammable material)? */
export function bldFlammable(b) {
  if (!b) return false;
  const d = structDef(b.def);
  return hasFlag(d, 'flammable') || (!!b.mat && matFlammable(b.mat));
}
function stackFlammable(it) {
  if (!it) return false;
  if (it.m && matFlammable(it.m)) return true;
  const d = itemDefOf(it.k);
  return !!d && ((d.tags && d.tags.includes('fuel')) || (d.mat && [].concat(d.mat).includes('wood') && !it.m));
}
/** What burns on tile i: { plant, bld, floor, item } (each false or the thing). */
function fuelAt(s, i) {
  const L = s.L;
  const plant = L.plant[i] ? plantDef(L.plant[i]) : null;
  const bid = s.rt.occ[i], b = bid >= 0 ? s.bld[bid] : null;
  const fd = floorDefById(L.floor[i]);
  const iid = s.rt.itemAt ? s.rt.itemAt[i] : -1, it = iid >= 0 ? s.items[iid] : null;
  return { plant: !!plant, bld: bldFlammable(b) ? b : null, floor: hasFlag(fd, 'flammable'), item: stackFlammable(it) ? it : null };
}
/** Can tile i burn now? */
export function canBurn(s, i) {
  const f = fuelAt(s, i);
  return f.plant || !!f.bld || f.floor || !!f.item;
}
function fuelTicks(f) {
  let t = 0;
  if (f.bld) t = Math.max(t, FIRE.fuel.bld);
  if (f.plant) t = Math.max(t, FIRE.fuel.plant);
  if (f.floor) t = Math.max(t, FIRE.fuel.grass);
  if (f.item) t = Math.max(t, FIRE.fuel.item);
  return t;
}

export const fireTiles = (s) => worldRec(s).fire.map((e) => e[0]);
export const fireCount = (s) => worldRec(s).fire.length;
export const burning = (s, i) => findKey(worldRec(s).fire, i) >= 0;
/** Burning tiles within Chebyshev r of tile i, sorted. */
export function firesNear(s, i, r) {
  const x = i % W, y = (i / W) | 0, out = [];
  for (const e of worldRec(s).fire) { const j = e[0]; if (Math.max(Math.abs((j % W) - x), Math.abs(((j / W) | 0) - y)) <= r) out.push(j); }
  return out;
}

/** Set tile i alight. Returns true when a new flame started. */
export function ignite(s, i, heat = FIRE.startHeat) {
  if (!worldStage2()) return false;
  const w = ensureWorld(s);
  if (findKey(w.fire, i) >= 0 || w.fire.length >= FIRE.max) return false;
  const f = fuelAt(s, i);
  const fuel = fuelTicks(f);
  if (!fuel) return false;
  putKey(w.fire, [i, Math.max(1, Math.min(100, heat | 0)), fuel]);
  s.rt.dirty.light = true;
  emit(s, 'fireStart', { i });
  return true;
}
function goOut(s, w, i) {
  const k = findKey(w.fire, i);
  if (k < 0) return false;
  w.fire.splice(k, 1);
  s.rt.dirty.light = true;
  return true;
}
/** Firefighting (E): take `amount` fuel ticks off the flame at i. Returns true when it went out. */
export function extinguish(s, i, amount = FIRE.extinguish) {
  const w = s.colony.world;
  if (!w) return false;
  const k = findKey(w.fire, i);
  if (k < 0) return false;
  const e = w.fire[k];
  e[2] -= Math.max(1, amount | 0);
  e[1] = Math.max(1, e[1] - 10);
  if (e[2] > 0) return false;
  return goOut(s, w, i);
}

/** The tile's flammable things are consumed (a spent flame). */
function burnAway(s, i) {
  const f = fuelAt(s, i);
  if (f.plant && setPlantFn) setPlantFn(s, i, 0, 0);
  if (f.floor && setFloorFn) setFloorFn(s, i, 0);
  if (f.item) destroyStack(s, f.item.id);
  if (f.bld) removeBuilding(s, f.bld, true);
}

/** Tick system (slot 'fire'). */
export function fireSystem(s) {
  const w = s.colony.world;
  if (!w || !w.fire.length || s.tick % FIRE.every !== 0) return;
  const spread = spreadPct(s), out = fireOutPermille(s);
  const list = w.fire.map((e) => e.slice());
  for (const [i, heat] of list) {
    const k = findKey(w.fire, i);
    if (k < 0) continue;                                   // put out earlier this step
    const e = w.fire[k];
    const x = i % W, y = (i / W) | 0, roof = s.L.roof[i];
    // rain on open sky
    if (out && roof === ROOF.OPEN && hash3(i, s.tick, 0x51) % 1000 < out) { goOut(s, w, i); continue; }
    // burn what stands here
    const f = fuelAt(s, i);
    if (!f.plant && !f.bld && !f.floor && !f.item) { goOut(s, w, i); continue; }
    if (f.bld) {
      f.bld.hp -= FIRE.bldDmg;
      if (f.bld.hp <= 0) removeBuilding(s, f.bld, true);
    }
    const who = [];
    for (const c of s.col) if (!c.hp.dead && Math.floor(c.x / 32) === x && Math.floor(c.y / 32) === y) who.push(c.id);
    if (who.length) for (const fn of burnListeners) fn(s, i, who);
    e[2] -= FIRE.every;
    if (e[1] < 100) e[1] = Math.min(100, e[1] + 10);
    // spread to flammable neighbours
    for (let d = 0; d < 8; d++) {
      const nx = x + DX[d], ny = y + DY[d];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (findKey(w.fire, j) >= 0) continue;
      if (s.L.roof[j] === ROOF.MOUNTAIN && roof !== ROOF.MOUNTAIN) continue;   // a tunnel never catches from outside
      const p = Math.floor((FIRE.spreadPermille * (s.L.roof[j] === ROOF.OPEN ? spread : 100) * heat) / 10000);
      if (p <= 0 || hash3(i, j, s.tick) % 1000 >= p) continue;
      if (!canBurn(s, j)) continue;
      ignite(s, j, Math.max(10, heat >> 1));
    }
    const k2 = findKey(w.fire, i);
    if (k2 >= 0 && w.fire[k2][2] <= 0) { burnAway(s, i); goOut(s, w, i); }
  }
}

export function installFire() {
  if (!tickSystems().some((x) => x.slot === 'fire' && x.name === 'flames')) registerSystem('fire', 'flames', fireSystem, 10);
}
