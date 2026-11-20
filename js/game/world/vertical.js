// Vertical terrain rules (owner B; EMBERCROWN-FORTRESS.md 2.3, 2.4, 7.5; Stage Z1 step E2). Pure reads and
// column scans: links between levels, the dig validity rules for stairs, ramps and channels, where a faller
// lands, and the per-column `cover` and `skyZ` caches. Every WRITE stays in terrain.js (C5), which calls
// refreshColumn() in the same call that changes a column (C13 class INC).
//
//   Vertical moves (2.3, the prototype's rule): a mover changes z only between an "up" voxel (TER_UP:
//   STAIR_U, STAIR_UD, RAMP) and a "down" voxel (TER_DOWN: STAIR_D, STAIR_UD, RAMP_TOP) directly above it.
//   One vertical step costs PATH.VERT (200 = 2 tiles of walking) on normal ground. Nobody steps into AIR.
//
//   cover (u8 of N, computed per column): the lids above each voxel, capped at 3. A lid is a voxel above with
//   anything to stand on or in (every terrain but VOID, AIR and RAMP_TOP: natural rock, a constructed floor,
//   a stair) or a built roof (roof BUILT on the voxel's own level or any level above). cover 0 = open sky.
//   skyZ (u8 of PLANE): the lowest z the sky reaches in the column. The top-down scan stops at the first
//   voxel that is not AIR or RAMP_TOP (that voxel is skyZ, it is lit), or at a built roof (skyZ = its z + 1).
//   So cover[i] === 0 exactly when tz(i) >= skyZ[column].
//   On a D = 1 map cover is 1 under a built roof and 0 elsewhere, and skyZ is 0 or 1; nothing reads them at
//   D = 1 yet (E4 moves light and temperature onto them).

import { W, H, D, PLANE, N, TER, ROOF, TER_UP, TER_DOWN, TER_FLOOR, TER_MINEABLE } from '../core/grid.js';

/** Terrain that is NOT a lid (the sky and the eye pass through): void, open air, the open voxel over a ramp. */
export const TER_SKY = Uint8Array.from({ length: 22 }, (_, t) => (t === TER.VOID || t === TER.AIR || t === TER.RAMP_TOP ? 1 : 0));
/** Solid natural rock for the ramp lean rule and the channel rule (rock and rubble). */
export const isSolidTer = (t) => t === TER.ROCK || t === TER.RUBBLE;
/** A carved or built stair or ramp voxel (vertical connectivity lives here). */
export const isVerticalTer = (t) => t >= TER.STAIR_U && t <= TER.RAMP_TOP;
export const COVER_CAP = 3;

// ---- Links ------------------------------------------------------------------------------------------
/** Terrain allows the step from i up to i + PLANE (ignores buildings: pathing checks walk costs). */
export const upOK = (ter, i) => i + PLANE < N && TER_UP[ter[i]] === 1 && TER_DOWN[ter[i + PLANE]] === 1;
/** Terrain allows the step from i down to i - PLANE. */
export const downOK = (ter, i) => i >= PLANE && TER_DOWN[ter[i]] === 1 && TER_UP[ter[i - PLANE]] === 1;
/** The vertical neighbours of voxel i by terrain (C5 v3 linksOf): [] or [up] or [down] or [up, down]. */
export function linksOf(s, i) {
  const t = s.L.terrain, out = [];
  if (upOK(t, i)) out.push(i + PLANE);
  if (downOK(t, i)) out.push(i - PLANE);
  return out;
}

// ---- Dig rules (2.3) -------------------------------------------------------------------------------
const planar4 = (i, fn) => {
  const x = i % W, y = ((i % PLANE) / W) | 0;
  if (x > 0 && fn(i - 1)) return true;
  if (x < W - 1 && fn(i + 1)) return true;
  if (y > 0 && fn(i - W)) return true;
  return y < H - 1 && fn(i + W);
};
/** The stair kind for level z of a stack from zTop down to zBot (2.3: STAIR_D on top, UD between, U at the bottom). */
export function stairKindAt(z, zTop, zBot) {
  if (zTop === zBot) return TER.STAIR_UD;
  return z === zTop ? TER.STAIR_D : z === zBot ? TER.STAIR_U : TER.STAIR_UD;
}
/** Stairs can be carved here: rock (mined as it is carved) or an open floor that is not already vertical. */
export function canStair(s, i) {
  const t = s.L.terrain[i];
  return TER_MINEABLE[t] === 1 || (TER_FLOOR[t] === 1 && !isVerticalTer(t) && t !== TER.DEEP);
}
/**
 * A ramp can be dug at i (2.3): rock or an open floor at z, below the top level; the voxel above is open air
 * or a plain open floor (it becomes RAMP_TOP); and the slope leans on a solid planar neighbour at z.
 */
export function canRamp(s, i) {
  if (i + PLANE >= N) return false;
  const L = s.L.terrain, t = L[i], a = L[i + PLANE];
  if (!(TER_MINEABLE[t] === 1 || (TER_FLOOR[t] === 1 && !isVerticalTer(t) && t !== TER.DEEP))) return false;
  if (!(a === TER.AIR || (TER_FLOOR[a] === 1 && !isVerticalTer(a) && a !== TER.DEEP))) return false;
  return planar4(i, (j) => isSolidTer(L[j]));
}
/** A channel can be dug at i: an open floor (not air) above level 0. */
export function canChannel(s, i) {
  if (i < PLANE) return false;
  const t = s.L.terrain[i];
  return TER_FLOOR[t] === 1 && t !== TER.AIR;
}
/** What a channel at i leaves: { here, below } terrain ids (below null when level z-1 is unchanged). */
export function channelResult(s, i) {
  const b = s.L.terrain[i - PLANE];
  return TER_MINEABLE[b] === 1 ? { here: TER.RAMP_TOP, below: TER.RAMP } : { here: TER.AIR, below: null };
}

// ---- Falling (2.3) ---------------------------------------------------------------------------------
/** Where something in voxel i falls to: the first voxel below the open air that has a floor (i if it is not air). */
export function fallTarget(s, i) {
  const t = s.L.terrain;
  let j = i;
  while (j >= PLANE && t[j] === TER.AIR) j -= PLANE;
  if (t[j] === TER.AIR || TER_FLOOR[t[j]] === 1) return j;
  return j + PLANE;                 // landed on something with no floor (lava, void): stays just above it
}
/** Items fall from a voxel with no floor for them: open air and the open voxel over a ramp (2.3 channel). */
export const itemFalls = (t) => t === TER.AIR || t === TER.RAMP_TOP;
/** Blunt damage of a fall of `levels` levels: 10 per level beyond the first, in one wound (2.3). */
export const fallDamage = (levels) => (levels > 1 ? 10 * (levels - 1) : 0);
/** Item hp lost (percent points) for a fall of `levels` levels: 25 per level (2.3). */
export const fallItemHp = (levels) => 25 * levels;

// ---- cover and skyZ (2.4, 2.6) ---------------------------------------------------------------------
/** Recompute cover and skyZ for column c (0..PLANE-1) into the given arrays. Returns true if skyZ changed. */
export function columnScan(s, c, cover, skyZ) {
  const ter = s.L.terrain, roof = s.L.roof;
  let lids = 0, sky = -1;
  for (let z = D - 1; z >= 0; z--) {
    const i = z * PLANE + c;
    const built = roof[i] === ROOF.BUILT ? 1 : 0;
    if (sky < 0 && built) sky = z + 1;
    if (cover) cover[i] = lids + built > COVER_CAP ? COVER_CAP : lids + built;
    if (sky < 0 && TER_SKY[ter[i]] !== 1) sky = z;
    if (TER_SKY[ter[i]] !== 1 || built) lids++;
  }
  if (sky < 0) sky = 0;
  const changed = skyZ ? skyZ[c] !== sky : false;
  if (skyZ) skyZ[c] = sky;
  return changed;
}
/** From-scratch cover (u8 of N): the C13 rebuild. */
export function coverRebuild(s) {
  const a = new Uint8Array(N);
  for (let c = 0; c < PLANE; c++) columnScan(s, c, a, null);
  return a;
}
/** From-scratch skyZ (u8 of PLANE): the C13 rebuild. */
export function skyZRebuild(s) {
  const a = new Uint8Array(PLANE);
  for (let c = 0; c < PLANE; c++) columnScan(s, c, null, a);
  return a;
}
/**
 * Terrain API hook: the column of voxel i changed (terrain or roof). Patches rt.cover and rt.skyZ when they
 * exist (rtcontract rows `cover` and `skyZ`, A). Returns true when skyZ changed (vertical light dirtying, E4).
 */
export function refreshColumn(s, i) {
  const rt = s.rt;
  if (!rt.cover && !rt.skyZ) return false;
  return columnScan(s, i % PLANE, rt.cover || null, rt.skyZ || null);
}
/** coverAt (C5 v3 read): lids over voxel i, 0..3. Falls back to a column scan when the cache is absent. */
export function coverAt(s, i) {
  if (s.rt && s.rt.cover) return s.rt.cover[i];
  const ter = s.L.terrain, roof = s.L.roof, c = i % PLANE, z0 = (i / PLANE) | 0;
  let n = roof[i] === ROOF.BUILT ? 1 : 0;
  for (let z = z0 + 1; z < D && n < COVER_CAP; z++) { const j = z * PLANE + c; if (TER_SKY[ter[j]] !== 1 || roof[j] === ROOF.BUILT) n++; }
  return n > COVER_CAP ? COVER_CAP : n;
}
/** skyZAt: the lowest z the sky reaches over column c (or voxel i: any voxel of the column). */
export function skyZAt(s, i) {
  const c = i % PLANE;
  if (s.rt && s.rt.skyZ) return s.rt.skyZ[c];
  let sky = 0;
  const ter = s.L.terrain, roof = s.L.roof;
  for (let z = D - 1; z >= 0; z--) {
    const j = z * PLANE + c;
    if (roof[j] === ROOF.BUILT) { sky = z + 1; break; }
    if (TER_SKY[ter[j]] !== 1) { sky = z; break; }
  }
  return sky;
}
