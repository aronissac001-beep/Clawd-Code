// Sappers (doc 9.3): Gutterkin delvers tunnel toward the stores. Owner H. Stage 2.
//
// A sapper raid walks the 'dig' field (flow.js prices natural rock at DIG_COST, so the route preview
// shows the planned tunnel). A delver whose next step is rock digs it: foe.st.dig = [tile, ticks]
// counts up to digTicks(s, tile) = SAPPER_SLOW (4) x the miner's work for that tile (E's mineTicks at
// speed 1.0), then the tile is mined through B's mineTile (no colonist: their tunnels stay, and the
// stone falls as usual). Walls and doors in the way are broken by hp like any smasher (fight.js).
// The incident: sapper_raid (Village, night, goal 'dig'); its logic is the default raid (spawnRaid),
// with the delvers' dig step in raiders.js movement.
// Z3.2 (2.10) dig down: a delver whose goal lies on a lower level and stands over rock cuts a stair down,
// one level per digTicks of the rock below (stone work x SAPPER_SLOW per level): its voxel becomes
// STAIR_D (STAIR_UD over an old STAIR_U), the rock below STAIR_U, and it steps down. foe.st.dd = [voxel,
// ticks] (a foe field: old saves have none, which reads as not digging).

import { mineTile, digStair, setTerrain } from '../world/terrain.js';
import { mineTicks } from '../work/givers/mine.js';
import { TER, PLANE, D } from '../core/grid.js';
import { isSolidTer } from '../world/vertical.js';

export const SAPPER_SLOW = 4;
/** Ticks a delver needs to dig rock tile i (4x a miner at speed 1.0). */
export const digTicks = (s, i) => SAPPER_SLOW * mineTicks(s, i);

/** One tick of digging tile j for foe f; returns true when the tile opened. */
export function digStep(s, f, j) {
  if (s.L.terrain[j] !== TER.ROCK) { f.st.dig = null; return true; }
  if (!f.st.dig || f.st.dig[0] !== j) f.st.dig = [j, 0];
  f.st.dig[1]++;
  if (f.st.dig[1] < digTicks(s, j)) return false;
  f.st.dig = null;
  mineTile(s, j, null);
  return true;
}

/** The voxel a delver at voxel i would cut down into toward goal level gz, or -1 (no need, or not rock). */
export function downCut(s, i, gz) {
  if (D <= 1 || i < PLANE || ((i / PLANE) | 0) <= gz) return -1;
  return isSolidTer(s.L.terrain[i - PLANE]) ? i - PLANE : -1;
}
/** One tick of a delver at voxel i cutting a stair down toward level gz; returns true when it spent the tick. */
export function digDown(s, f, i, gz) {
  const j = downCut(s, i, gz);
  if (j < 0) { if (f.st) f.st.dd = null; return false; }
  if (!f.st.dd || f.st.dd[0] !== j) f.st.dd = [j, 0];
  if (++f.st.dd[1] < digTicks(s, j)) return true;
  f.st.dd = null;
  const t = s.L.terrain[i];
  if (t === TER.STAIR_U || t === TER.STAIR_UD) setTerrain(s, i, TER.STAIR_UD);
  else if (!digStair(s, i, TER.STAIR_D, null)) return true;
  digStair(s, j, TER.STAIR_U, null);
  f.z = (j / PLANE) | 0;
  return true;
}
