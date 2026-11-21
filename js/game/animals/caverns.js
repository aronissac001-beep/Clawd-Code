// Cavern life (owner K, with B's plants; EMBERCROWN-FORTRESS.md 2.10 and 8.4 step Z2.7). Static: no deep threats
// yet (Z3.1 brings them through the deep passages). At D > 1 only; a D = 1 colony is untouched.
//
//   Fauna   the dens are the pristine meta's dormant rows ([kind, voxel, seed], mapgen3 step 8): each den kind names
//           an animal and how many live at one den (DEN). On the first animal tick of a fortress colony every den is
//           filled; then once a day (CAVE_LIFE.hour) each cavern kind below its dens' total gets one animal back at
//           one of its dens (round robin by day). A den the hold has taken (a built floor, a zone or a building on it)
//           breeds nothing. At most CAVE_LIFE.max cavern animals live at once, and never within CAVE_LIFE.capRoom of
//           the animal cap, so surface herds and farm breeding keep their room. No RNG draw: the den order and the
//           counts are pure functions of the state, so this system never moves the 'main' stream.
//   Range   a cavern creature (kind 'cave', on a level of Caverns I or II) never leaves its cavern: its wander goals
//           are natural floors (cave moss, rough floor, ramps) of that cavern's two levels, never a built floor or
//           a zone (wild.js asks caveGoalOk). Blindfish keep to water (pools, the Mere's shallows).
//   Flora   the first run also plants the cavern flora mapgen3 did not place (plants.seedCavernFlora).
// Saved: herdRec(s).cav = { seeded (0/1), flora (count planted) } in K's herd record (s.colony.herd).

import { W, H, D, PLANE, TER, zS } from '../core/grid.js';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../core/time.js';
import { def, bal } from '../colony/defs.js';
import { pristineOf } from '../save/pristine.js';
import { cavernLevels, seedCavernFlora } from '../world/plants.js';
import { FL } from '../world/pass.js';
import { herdRec, spawnAnimal } from './spawn.js';

export const CAVE_LIFE = Object.freeze({ max: 24, capRoom: 12, hour: 3 });
/** Den kind (dormant row) -> [animal kind, animals per den]. Cavern III's dens (hounds, bats) and barrows are Z3.1's. */
export const DEN = Object.freeze({
  den_glowbeetle: ['beetle', 2], den_cave_spider: ['spider', 1], den_great_spider: ['great_spider', 1],
  den_blindfish: ['blindfish', 2], den_mire_leech: ['mire_leech', 2], den_shellback: ['shellback', 1],
});
const WATER_KINDS = new Set(['blindfish']);

/** The cavern ('hollows' | 'mere') whose levels hold z, or null. */
export function cavernOfZ(z) {
  const lv = cavernLevels();
  for (const id of Object.keys(lv)) if (lv[id].includes(z)) return id;
  return null;
}
/** Is animal a a cavern creature (kind 'cave', living on a level of Caverns I or II)? */
export function isCaveDweller(a) {
  if (D === 1 || !a || a.tame) return false;
  const d = def('animal', a.kind);
  return !!d && d.kind === 'cave' && (a.z | 0) < zS && cavernOfZ(a.z | 0) !== null;
}
const waterAt = (s, i) => { const f = s.L.fluid; return !!f && (f[i] & FL.DEPTH) !== 0 && (f[i] & FL.EMBER) === 0; };
const NATURAL = new Set([TER.MOSS, TER.ROUGH, TER.RAMP, TER.RAMP_TOP]);
/** May cavern creature `kind` take voxel i as a wander goal? Natural, walkable, unbuilt ground (water for blindfish). */
export function caveGoalOk(s, kind, i) {
  const L = s.L;
  if (!NATURAL.has(L.terrain[i]) || L.floor[i] || L.zone[i] || s.rt.occ[i] >= 0 || !(s.rt.walkCost[i] > 0)) return false;
  return WATER_KINDS.has(kind) ? waterAt(s, i) : true;
}

/** The live dens: [{ kind (animal), n, at (voxel), cav }] in dormant-row order (rows of a cavern the world lacks drop). */
export function cavernDens(s) {
  const p = pristineOf(s), rows = (p && p.meta && p.meta.dormant) || [], out = [];
  for (const r of rows) {
    if (!Array.isArray(r) || !DEN[r[0]]) continue;
    const [kind, n] = DEN[r[0]], cav = cavernOfZ((r[1] / PLANE) | 0);
    if (cav && def('animal', kind)) out.push({ kind, n, at: r[1] | 0, cav });
  }
  return out;
}
/** A spawn voxel for a den: the den itself, or for water kinds the nearest water voxel within 12 tiles; -1 if taken. */
function denSpot(s, den) {
  const L = s.L, at = den.at;
  if (L.floor[at] || L.zone[at] || s.rt.occ[at] >= 0) return -1;   // the hold has taken it
  if (!WATER_KINDS.has(den.kind)) return caveGoalOk(s, den.kind, at) ? at : -1;
  const z = (at / PLANE) | 0, x0 = at % W, y0 = ((at % PLANE) / W) | 0;
  for (let r = 0; r <= 12; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = x0 + dx, y = y0 + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = z * PLANE + y * W + x;
      if (caveGoalOk(s, den.kind, i)) return i;
    }
  }
  return -1;
}
const room = (s, nCave) => nCave < CAVE_LIFE.max && s.anim.length < (bal('caps').animals || 60) - CAVE_LIFE.capRoom;
function spawnAt(s, kind, i) {
  const a = spawnAnimal(s, kind, i % W, ((i % PLANE) / W) | 0, { z: (i / PLANE) | 0, age: 3 * TICKS_PER_DAY });
  return a;
}
/** Live cavern creatures by `${cav}:${kind}`, and their total. */
function census(s) {
  const by = new Map();
  let n = 0;
  for (const a of s.anim) {
    if (!isCaveDweller(a)) continue;
    const k = `${cavernOfZ(a.z | 0)}:${a.kind}`;
    by.set(k, (by.get(k) || 0) + 1); n++;
  }
  return { by, n };
}

/** Fill every den (the first run). Returns the animals spawned. */
export function populateDens(s) {
  let { n } = census(s), made = 0;
  for (const den of cavernDens(s)) {
    for (let k = 0; k < den.n && room(s, n); k++) {
      const i = denSpot(s, den);
      if (i < 0 || !spawnAt(s, den.kind, i)) break;
      n++; made++;
    }
  }
  return made;
}
/** The daily return: each cavern kind below its dens' total gets one animal back at one of its dens. */
export function refillDens(s, day) {
  const dens = cavernDens(s), { by } = census(s);
  let n = 0;
  for (const v of by.values()) n += v;
  const groups = new Map();
  for (const den of dens) { const k = `${den.cav}:${den.kind}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(den); }
  let made = 0;
  for (const [k, ds] of groups) {
    let want = 0;
    for (const d of ds) want += d.n;
    if ((by.get(k) || 0) >= want || !room(s, n)) continue;
    for (let t = 0; t < ds.length; t++) {
      const den = ds[(day + t) % ds.length], i = denSpot(s, den);
      if (i < 0) continue;
      if (spawnAt(s, den.kind, i)) { n++; made++; }
      break;
    }
  }
  return made;
}

/** Tick system (slot 'animals'): the first run seeds the flora and fills the dens; then the daily return. */
export function cavernLifeSystem(s) {
  if (D === 1 || !s.rt || !s.rt.walkCost) return;
  const h = herdRec(s);
  if (!h.cav) h.cav = { seeded: 0, flora: 0 };
  if (!h.cav.seeded) {
    h.cav.seeded = 1;
    h.cav.flora = seedCavernFlora(s);
    populateDens(s);
    return;
  }
  if (s.tick % TICKS_PER_DAY !== CAVE_LIFE.hour * TICKS_PER_HOUR) return;
  refillDens(s, Math.floor(s.tick / TICKS_PER_DAY));
}
