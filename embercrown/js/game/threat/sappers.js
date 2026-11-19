// Sappers (doc 9.3): Gutterkin delvers tunnel toward the stores. Owner H. Stage 2.
//
// A sapper raid walks the 'dig' field (flow.js prices natural rock at DIG_COST, so the route preview
// shows the planned tunnel). A delver whose next step is rock digs it: foe.st.dig = [tile, ticks]
// counts up to digTicks(s, tile) = SAPPER_SLOW (4) x the miner's work for that tile (E's mineTicks at
// speed 1.0), then the tile is mined through B's mineTile (no colonist: their tunnels stay, and the
// stone falls as usual). Walls and doors in the way are broken by hp like any smasher (fight.js).
// The incident: sapper_raid (Village, night, goal 'dig'); its logic is the default raid (spawnRaid),
// with the delvers' dig step in raiders.js movement.

import { mineTile } from '../world/terrain.js';
import { mineTicks } from '../work/givers/mine.js';
import { TER } from '../core/grid.js';

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
