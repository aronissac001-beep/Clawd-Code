// Fuel for lights and the Hearth (owner B; doc 7.7, 8.4, 3.6, 12.3; Stage 1b).
//
//   A finished building whose def has `light.fuel: { k, perDay }` burns fuel while lit: the Hearth
//   (10 wood a day), braziers (6), campfires (4) and torch sconces (2). Fuel is stored in TICKS OF
//   BURN left (an integer): the Hearth's in s.colony.hearth.fuel (the field H's night shot reads),
//   every other building's in b.fuel. One unit of fuel item k gives
//   TICKS_PER_DAY * FUEL.value[k] / perDay ticks (wood = 1; charcoal = 2, so "10 wood or 5 charcoal").
//   A building with no fuel left is cold: no light (lightOf), no heat (temperature.js), and the Hearth
//   fires no night shot (H). Buildings with a light but no `fuel` field (lumen lamps) always shine.
//
//   Rules are ON from Stage 1b (installSim passes installWorld({ fuel: true })). With them off (the
//   Stage 1a sandbox) every light shines and nothing burns, exactly as in 1a.
//
//   Burn: fuelSystem (tick slot 'fire') runs every FUEL.every ticks and takes FUEL.every ticks of burn
//   from every fuelled building in id order (the Hearth first by id like any other). A building that
//   goes cold, and one refuelled from cold, sets the light and temperature flags (C13: rt.light and
//   rt.heat are pure functions of the saved fuel fields) and emits 'fuelOut' / nothing.
//   New buildings: BUS.built gives a finished fuelled light its first load (FUEL.builtDays); a new
//   colony's Hearth starts with FUEL.startDays (A's foundColony calls hearthStartFuel).
//
//   API for E's Refuel giver (Haul work type, 5.1) and I's cards / alerts:
//     fuelEnabled()                 rules on?
//     usesFuel(s, b)                does b burn fuel (rules on, a fuelled light)?
//     fuelTicks(s, b), fuelCap(s, b)  burn left and the most it holds (FUEL.capDays)
//     fuelDays(s, b)                burn left in game days (a float, for display)
//     isBurning(s, b)               finished and (no fuel needed or fuel left)
//     acceptsFuel(s, b, k)          item kind k can fuel b (b's own kind, or charcoal)
//     needsRefuel(s, b)             below FUEL.refuelBelowDays (the giver's trigger, 8.4)
//     fuelWanted(s, b, k?)          { k, n } units to fill it to the cap, or null
//     addFuel(s, b, k, n)           puts up to n units in (never past the cap); returns the units used
//     refuelTargets(s)              ids of buildings that need refuel, in id order (the giver's candidates)
//     hearthFuelDays(s)             the Hearth's fuel in days (the "Hearth fuel < 1 day" alert)

import { TICKS_PER_DAY } from '../core/time.js';
import { BUS, registerSystem, tickSystems } from '../core/bus.js';
import { emit } from '../core/events.js';
import { structDef, itemDefOf } from './defs.js';

/** Tuning (moves to balance.js WORLD with G). */
export const FUEL = Object.freeze({
  every: 60,            // burn cadence in ticks
  capDays: 3,           // days of burn a light holds (an Ember Grate raises the Hearth's in Stage 2)
  refuelBelowDays: 2,   // haulers refuel below this (8.4)
  builtDays: 1,         // a newly finished light comes with one day of fuel
  startDays: 3,         // a new colony's Hearth
  value: Object.freeze({ wood: 1, charcoal: 2 }), // units of the def's fuel kind per item
});

let rulesOn = false;
/** Turn the fuel rules on or off (installWorld({ fuel })). */
export function setFuelRules(on) { rulesOn = !!on; }
export const fuelEnabled = () => rulesOn;

const isHearth = (s, b) => !!b && s.colony && s.colony.hearth && s.colony.hearth.id === b.id && b.def === 'hearth';
/** The def's fuel spec { k, perDay } or null. */
export function fuelSpec(b) {
  const d = b && structDef(b.def);
  return d && d.light && d.light.fuel && d.light.fuel.perDay > 0 ? d.light.fuel : null;
}
export const usesFuel = (s, b) => rulesOn && !!b && b.st === 'done' && !!fuelSpec(b);
export const fuelTicks = (s, b) => (isHearth(s, b) ? s.colony.hearth.fuel | 0 : (b.fuel | 0));
function setTicks(s, b, v) { if (isHearth(s, b)) s.colony.hearth.fuel = v; else b.fuel = v; }
export const fuelCap = () => FUEL.capDays * TICKS_PER_DAY;
export const fuelDays = (s, b) => fuelTicks(s, b) / TICKS_PER_DAY;
export const isBurning = (s, b) => !!b && b.st === 'done' && (!usesFuel(s, b) || fuelTicks(s, b) > 0);

/** Ticks of burn one unit of item k gives building b (0 when k cannot fuel it). */
export function ticksPerUnit(b, k) {
  const f = fuelSpec(b);
  if (!f || !k) return 0;
  const v = k === f.k ? (FUEL.value[k] || 1) : (FUEL.value[k] || 0);
  if (!v || !itemDefOf(k)) return 0;
  return Math.floor((TICKS_PER_DAY * v) / f.perDay);
}
export const acceptsFuel = (s, b, k) => usesFuel(s, b) && ticksPerUnit(b, k) > 0;
export const needsRefuel = (s, b) => usesFuel(s, b) && fuelTicks(s, b) < FUEL.refuelBelowDays * TICKS_PER_DAY;

/** Units of k (default: the def's own fuel kind) that fill b to its cap, or null when not needed. */
export function fuelWanted(s, b, k = null) {
  if (!needsRefuel(s, b)) return null;
  const kind = k || fuelSpec(b).k, per = ticksPerUnit(b, kind);
  if (!per) return null;
  const n = Math.floor((fuelCap() - fuelTicks(s, b)) / per);
  return n > 0 ? { k: kind, n } : null;
}

const coldChanged = (s) => { s.rt.dirty.light = true; s.rt.dirty.temperature = true; };

/** Put up to n units of k into b (never past the cap). Returns the units used (0 when it cannot take any). */
export function addFuel(s, b, k, n) {
  if (!usesFuel(s, b)) return 0;
  const per = ticksPerUnit(b, k);
  if (!per || n <= 0) return 0;
  const have = fuelTicks(s, b), room = Math.floor((fuelCap() - have) / per);
  const used = Math.min(n | 0, room);
  if (used <= 0) return 0;
  setTicks(s, b, have + used * per);
  if (have <= 0) coldChanged(s);
  return used;
}

/** Ids of finished buildings below the refuel threshold, in id order. */
export function refuelTargets(s) {
  const out = [];
  if (!rulesOn) return out;
  for (const b of s.bld) if (b && needsRefuel(s, b)) out.push(b.id);
  return out;
}
export function hearthFuelDays(s) {
  const h = s.colony.hearth;
  return h && h.id !== null ? (h.fuel | 0) / TICKS_PER_DAY : 0;
}

/** The burn (tick slot 'fire'). */
export function fuelSystem(s) {
  if (!rulesOn || s.tick % FUEL.every !== 0) return;
  for (const b of s.bld) {
    if (!b || b.st !== 'done' || !fuelSpec(b)) continue;
    const t = fuelTicks(s, b);
    if (t <= 0) continue;
    const nt = t > FUEL.every ? t - FUEL.every : 0;
    setTicks(s, b, nt);
    if (nt === 0) { coldChanged(s); emit(s, 'fuelOut', { bId: b.id, def: b.def }); }
  }
}

/** BUS.built: a newly finished fuelled light comes with its first load. */
function onBuilt(s, b) {
  if (!usesFuel(s, b) || fuelTicks(s, b) > 0) return;
  setTicks(s, b, Math.min(fuelCap(), FUEL.builtDays * TICKS_PER_DAY));
  coldChanged(s);
}
/** A new colony's Hearth fuel (foundColony). */
export function hearthStartFuel(s) {
  if (!rulesOn || !s.colony.hearth || s.colony.hearth.id === null) return;
  s.colony.hearth.fuel = FUEL.startDays * TICKS_PER_DAY;
  s.rt.dirty.light = true; s.rt.dirty.temperature = true;
}

export function installFuel() {
  if (!BUS.built.includes(onBuilt)) BUS.built.push(onBuilt);
  if (!tickSystems().some((x) => x.slot === 'fire' && x.name === 'fuel')) registerSystem('fire', 'fuel', fuelSystem, 0);
}
