// Pumps and wells by level (owner B; Stage Z4 water engineering, EMBERCROWN-FORTRESS.md 2.8 "deferred to Z4", 8.6).
//
//   Hand pump (data `pump`, flag 'pump'; 1x1): it lifts water one level. The intake is the voxel directly
//   under the pump (z-1), the outlet is the voxel beside it in its facing (rot: DX4/DY4 order, 0 north).
//   A stroke moves one depth step of water from the intake to the outlet (a source intake loses it and
//   refills on its own fluid step) and wakes both voxels in the fluid active set, so a stroke costs two
//   activations: far inside the 2,048-per-step budget of 6.2. Water only: ember is never pumped.
//     worked    a colonist with Haul enabled mans it (work/givers/pump.js), one stroke per PUMP.stroke ticks;
//     driven    a finished water wheel within PUMP.powerR tiles on the same level turns it on its own (the
//               cheap "screw pump"): the 'pumps' system strokes it every PUMP.stroke ticks;
//     stopped   a lever holds it LOCKED (a pump is lockable: it links to a lever like a gate). Closed or
//               open, it runs.
//   pumpState(s, b) -> 'ok' | 'unbuilt' | 'stopped' | 'dry' | 'blocked' | 'full' (the peek card's line).
//
//   Wells by level (data `well`): a well on the surface (z >= zS) draws ground water as it always did; below
//   the surface it needs water under it (a water voxel at z-1) or in its own voxel (a well on a seep).
//   A watered well doubles fire beating within PUMP.wellR tiles on its level (the def's fire.fight mod).
//   There is no drink need in the design, so a well is a firefighting and washing point, not a thirst one.
//
//   Pure: everything reads saved state (bld, fluid layer, mech record); no RNG (C13). Old saves have no pumps.

import { W, H, D, PLANE, zS, idx, DX4, DY4 } from '../core/grid.js';
import { registerSystem, tickSystems } from '../core/bus.js';
import { FL, setFluid } from './pass.js';
import { structDef, hasFlag } from './defs.js';
import { activate, fluidBlocked } from './fluids.js';
import { worldRec, getKey } from './worldrec.js';

const LOCKED = 2;   // mechanisms.GATE.LOCKED (read from the saved mech record; no import cycle)
const mechState = (s, id) => { const w = worldRec(s), e = w && w.mech ? getKey(w.mech, id) : null; return e ? e[1] : 0; };

export const PUMP = Object.freeze({ stroke: 20, shift: 600, powerR: 6, wellR: 15 });

export const isPump = (b) => !!b && hasFlag(structDef(b.def), 'pump');
export const isWell = (b) => !!b && b.def === 'well';
const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/** The intake voxel (under the pump), or -1 on the bottom level. */
export const pumpIntake = (b) => ((b.z | 0) > 0 ? idx(b.x, b.y, (b.z | 0) - 1) : -1);
/** The outlet voxel (beside the pump in its facing), or -1 off the map. */
export function pumpOutlet(b) {
  const r = (b.rot | 0) & 3, x = b.x + DX4[r], y = b.y + DY4[r];
  return x < 0 || y < 0 || x >= W || y >= H ? -1 : idx(x, y, b.z | 0);
}
/** A finished water wheel within PUMP.powerR on the pump's level drives it. */
export function pumpDriven(s, b) {
  for (const o of s.bld) if (o && o.def === 'waterwheel' && o.st === 'done' && (o.z | 0) === (b.z | 0) && cheb(o, b) <= PUMP.powerR) return true;
  return false;
}
/** Why a pump would or would not stroke now. */
export function pumpState(s, b) {
  if (!isPump(b) || b.st !== 'done') return 'unbuilt';
  if (mechState(s, b.id) === LOCKED) return 'stopped';
  const fl = s.L.fluid, a = pumpIntake(b), o = pumpOutlet(b);
  if (!fl || D <= 1 || a < 0) return 'dry';
  const v = fl[a];
  if ((v & FL.EMBER) || !(v & FL.DEPTH)) return 'dry';
  if (o < 0 || fluidBlocked(s, o)) return 'blocked';
  const u = fl[o];
  if ((u & FL.EMBER) || (u & FL.DEPTH) >= 7) return 'full';
  return 'ok';
}
/** One stroke: one depth step from the intake to the outlet. Returns true when water moved. */
export function pumpStroke(s, b) {
  if (pumpState(s, b) !== 'ok') return false;
  const fl = s.L.fluid, a = pumpIntake(b), o = pumpOutlet(b), v = fl[a], u = fl[o];
  const left = (v & FL.DEPTH) - 1;
  setFluid(s, a, left || (v & FL.SOURCE) ? (v & ~FL.DEPTH) | left : 0);
  setFluid(s, o, (u & FL.SOURCE) | ((u & FL.DEPTH) + 1));
  activate(s, a); activate(s, o);
  return true;
}
/** Water wheel driven pumps stroke on their own every PUMP.stroke ticks (bld order). */
export function pumpSystem(s) {
  if (D <= 1 || !s.L.fluid || s.tick % PUMP.stroke !== 0) return;
  for (const b of s.bld) if (isPump(b) && b.st === 'done' && pumpDriven(s, b)) pumpStroke(s, b);
}

/** A well has water: on the surface always; below it, water in its voxel or the one under it. */
export function wellWatered(s, b) {
  if (!isWell(b) || b.st !== 'done') return false;
  const z = b.z | 0;
  if (D <= 1 || z >= zS) return true;
  const fl = s.L.fluid;
  if (!fl) return false;
  const i = idx(b.x, b.y, z), wet = (v) => (v & FL.DEPTH) !== 0 && !(v & FL.EMBER);
  return wet(fl[i]) || (fl[i] & FL.SOURCE) !== 0 || (z > 0 && wet(fl[i - PLANE]));
}
/** A watered well stands within PUMP.wellR tiles of voxel i on its level. */
export function wellNear(s, i) {
  const z = (i / PLANE) | 0, x = i % W, y = ((i % PLANE) / W) | 0;
  for (const b of s.bld) {
    if (!isWell(b) || (b.z | 0) !== z || Math.max(Math.abs(b.x - x), Math.abs(b.y - y)) > PUMP.wellR) continue;
    if (wellWatered(s, b)) return true;
  }
  return false;
}

export function installPumps() {
  if (!tickSystems().some((x) => x.slot === 'mechanisms' && x.name === 'pumps')) registerSystem('mechanisms', 'pumps', pumpSystem, 25);
}
