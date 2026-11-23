// Vertical defence (EMBERCROWN-FORTRESS.md 8.5 Z3.2; 2.10, 3.8 Fortifications). Owner H. Stage Z3.
//
// - Shots across levels: an archer shoots down (or up) through open air up to FORT.maxDrop levels. The
//   shot is the 3D segment between the two voxel centres: where it crosses the floor of level k it needs
//   that voxel open (TER_SKY air, or a murder hole), and on each level the planar part must not pass an
//   opaque voxel (natural rock or rubble, or a voxel that blocks foes and is not a fortification).
// - Fortifications (data ids FORT_WALLS, or the flag 'fortification'): archers shoot through, foes cannot
//   pass (they block walking like a wall). Murder holes (FORT_HOLES, or the flag 'murderhole'): a floor
//   colonists stand on that shots pass down through.
// - Perches: a colonist under cover (a cavern, cover >= 1) beside a drop (open air at its level) is on a
//   ledge or a chasm lip: ranged hits on them x COMBAT.coverPct.
// - Flyers (2.10): may enter a voxel only when its cover is 0 (z >= skyZ of the column), so open shafts
//   let them down and they never go under rock or a roof. flyStep moves a flyer one step toward a goal.
// Pure functions of the state; no randomness, no new saved state.

import { W, H, D, PLANE, tileOfW } from '../core/grid.js';
import { SIDE } from '../world/pass.js';
import { passable } from '../world/terrain.js';
import { TER_SKY, isSolidTer, coverAt as coverOf } from '../world/vertical.js';
import { structDef, hasFlag } from '../world/defs.js';

export const FORT = Object.freeze({ maxDrop: 2, sample: 8 });
export const FORT_WALLS = Object.freeze(['fortwall']);
export const FORT_HOLES = Object.freeze(['murderhole']);

const vox = (x, y, z) => z * PLANE + y * W + x;
function bldAt(s, i) {
  const occ = s.rt && s.rt.occ;
  if (!occ) return null;
  const id = occ.length > i ? occ[i] : -1;
  const b = id >= 0 ? s.bld[id] : null;
  return b && b.st === 'done' ? b : null;
}
const isKind = (b, ids, flag) => !!b && (ids.includes(b.def) || hasFlag(structDef(b.def), flag));
export const isFortWall = (b) => isKind(b, FORT_WALLS, 'fortification');
export const isMurderHole = (b) => isKind(b, FORT_HOLES, 'murderhole');

/** Does voxel i stop a shot (rock, or a foe-blocking voxel that is not a fortification)? */
export function opaque(s, i) {
  const t = s.L.terrain[i];
  if (isSolidTer(t)) return true;
  if (TER_SKY[t] === 1 || passable(s, i, SIDE.HOS)) return false;
  const b = bldAt(s, i);
  return !(isFortWall(b) || isMurderHole(b));
}
/** Can a shot pass down through the floor of voxel i (open air or a murder hole)? */
export const floorOpen = (s, i) => TER_SKY[s.L.terrain[i]] === 1 || isMurderHole(bldAt(s, i));

/** Planar segment on level z (world units), start and end tiles not tested. */
function planar(s, x0, y0, x1, y1, z) {
  const ta = vox(tileOfW(x0), tileOfW(y0), z), tb = vox(tileOfW(x1), tileOfW(y1), z);
  const dx = x1 - x0, dy = y1 - y0, n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / FORT.sample));
  let last = ta;
  for (let k = 1; k < n; k++) {
    const x = tileOfW(x0 + (dx * k) / n), y = tileOfW(y0 + (dy * k) / n);
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    const i = vox(x, y, z);
    if (i === last || i === ta || i === tb) continue;
    last = i;
    if (opaque(s, i)) return false;
  }
  return true;
}
let fortMemo = null;
/** Any done fortification wall in s (memoised per tick). */
function anyFort(s) {
  if (fortMemo && fortMemo.s === s && fortMemo.t === s.tick && fortMemo.n === s.bld.length) return fortMemo.v;
  const v = s.bld.some((b) => b && b.st === 'done' && isFortWall(b));
  fortMemo = { s, t: s.tick, n: s.bld.length, v };
  return v;
}

/**
 * Line of sight for a shot between movers a and b ({ x, y, z } in world units). Same level: losFn (the
 * planar pathing ray) or, when the hold has fortification walls, the opaque test (shots pass them).
 * Across levels (|dz| <= FORT.maxDrop): the 3D segment through open floors.
 */
export function shotClear(s, a, b, losFn = null) {
  const za = a.z | 0, zb = b.z | 0;
  if (za === zb) {
    if (losFn && losFn()) return true;
    return (!losFn || anyFort(s)) && planar(s, a.x, a.y, b.x, b.y, za);
  }
  const dz = za - zb, n = Math.abs(dz);
  if (n > FORT.maxDrop || D <= 1) return false;
  const top = dz > 0 ? a : b, bot = dz > 0 ? b : a, zt = Math.max(za, zb);
  // crossings: the floor of level k (k = zt .. zb + 1) at z = k, with z running zt + 0.5 -> zb + 0.5
  let px = top.x, py = top.y, pz = zt;
  for (let k = zt; k > zt - n; k--) {
    const t = (zt + 0.5 - k) / n, cx = top.x + (bot.x - top.x) * t, cy = top.y + (bot.y - top.y) * t;
    const tx = tileOfW(cx), ty = tileOfW(cy);
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) return false;
    if (!planar(s, px, py, cx, cy, pz)) return false;
    const fi = vox(tx, ty, k);
    if (!floorOpen(s, fi)) return false;
    if (k - 1 > zt - n && opaque(s, fi - PLANE)) return false;   // the air between two floors
    px = cx; py = cy; pz = k - 1;
  }
  return planar(s, px, py, bot.x, bot.y, pz);
}

/** Is colonist c on a perch (under cover, beside a drop at its level)? */
export function onPerch(s, c) {
  const z = c.z | 0;
  if (z <= 0 || D <= 1) return false;
  const x = tileOfW(c.x), y = tileOfW(c.y), i = vox(x, y, z);
  if (coverOf(s, i) < 1) return false;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const xx = x + dx, yy = y + dy;
    if ((dx || dy) && xx >= 0 && yy >= 0 && xx < W && yy < H && floorOpen(s, vox(xx, yy, z))) return true;
  }
  return false;
}

// ---- Flyers ---------------------------------------------------------------------------------------
/** May a flyer be in voxel i? Only open sky (cover 0), never rock. */
export const flyerMay = (s, i) => i >= 0 && i < PLANE * D && coverOf(s, i) === 0 && !isSolidTer(s.L.terrain[i]);
/**
 * One flyer step toward (gx, gy, gz) (world units, a level): down first when the voxel below is open sky,
 * else planar by `speed` (x then y fallback), never into a voxel a flyer may not enter. Returns true on a move.
 */
export function flyStep(s, f, gx, gy, gz, speed) {
  const x = tileOfW(f.x), y = tileOfW(f.y), z = f.z | 0;
  if (gz < z && flyerMay(s, vox(x, y, z - 1))) { f.z = z - 1; return true; }
  const dx = gx - f.x, dy = gy - f.y, d = Math.sqrt(dx * dx + dy * dy);
  if (d >= 1e-6) {
    const m = Math.min(speed, d);
    const tries = [[f.x + (dx / d) * m, f.y + (dy / d) * m], [f.x + Math.sign(dx) * Math.min(m, Math.abs(dx)), f.y], [f.x, f.y + Math.sign(dy) * Math.min(m, Math.abs(dy))]];
    for (const [nx, ny] of tries) {
      const tx = tileOfW(nx), ty = tileOfW(ny);
      if (tx < 0 || ty < 0 || tx >= W || ty >= H || (nx === f.x && ny === f.y)) continue;
      if (!flyerMay(s, vox(tx, ty, z))) continue;
      f.x = nx; f.y = ny;
      return true;
    }
  }
  if (z + 1 < D && (gz > z || d >= 1e-6) && flyerMay(s, vox(x, y, z + 1))) { f.z = z + 1; return true; }
  return false;
}
