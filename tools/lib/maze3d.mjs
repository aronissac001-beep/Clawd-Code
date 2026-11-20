// The 3D maze scene (owner J, written by B for Stage Z1 E3; EMBERCROWN-FORTRESS.md 8.3 E3, 6.2): the
// prototype's world (spike/z.mjs generate: 128 x 128 x 20, valley at z 14, a mountain east, three cavern
// levels) with its mid-game fortress dug in (digFortress: 3 x 3 stair shafts, halls, corridors, bedrooms,
// exploratory tunnels, stair columns down into the caverns), converted to game terrain ids. Deterministic.
import { createColony, initRuntime } from '../../js/game/core/state.js';
import { TER, N } from '../../js/game/core/grid.js';
import { generate, digFortress, TER as PT } from '../../spike/z.mjs';

const MAP = new Uint8Array(13);
MAP[PT.AIR] = TER.AIR; MAP[PT.ROCK] = TER.ROCK; MAP[PT.SOIL] = TER.ROCK; MAP[PT.FLOOR] = TER.ROUGH;
MAP[PT.GRASS] = TER.GRASS; MAP[PT.STAIR_U] = TER.STAIR_U; MAP[PT.STAIR_D] = TER.STAIR_D; MAP[PT.STAIR_UD] = TER.STAIR_UD;
MAP[PT.RAMP] = TER.RAMP; MAP[PT.RAMP_TOP] = TER.RAMP_TOP; MAP[PT.WATER] = TER.DEEP; MAP[PT.TREE] = TER.ROCK; MAP[PT.WALL] = TER.ROCK;

/** A colony state on the maze3d world (initRuntime done). Returns { s, hearth, shaft, levels, zS }. */
export function maze3dColony(seed = 99, { w = 128, d = 20, init = true } = {}) {
  const pw = generate(w, w, d, seed);
  const fort = digFortress(pw, seed);
  const s = createColony('MAZE3D-' + seed, { w, d, zS: pw.zS });
  const L = s.L;
  L.roof.fill(0); L.ore.fill(0); L.plant && L.plant.fill(0);
  for (let i = 0; i < N; i++) { L.terrain[i] = MAP[pw.ter[i]]; L.mat[i] = pw.ter[i] === PT.ROCK ? 1 + pw.mat[i] : 0; }
  if (init) initRuntime(s);
  return { s, hearth: fort.hearth, shaft: fort.shaft, levels: fort.levels, zS: pw.zS, caverns: pw.caverns };
}
