// A 20-level stub fortress for the EC3 codec and pristine tests (Stage Z1 step E8; needs neither mapgen3 nor
// the 3D systems: only core/state.js is loaded, so initRuntime runs the Stage 0 rebuilders).
//   stubFortress(seed)  a 128 x 128 x 20 world, surface zS = 14: stone below (soil at z 12-13), ore, a seep pool,
//                       a massif rising up to 3 levels above the valley, grass and plants on the surface; its
//                       pristine world is built and attached at once (as founding does), then colonists, stacks,
//                       buildings and zones are added with z
//   digFortress(s)      after the pristine: a stair shaft at (60, 60) to z = 0, a 9 x 9 hall every third level
//                       (built floors, a zone, known and fog bits), mined surface tunnels and trampled plants
//   deepPath(s)         a colonist path down the shaft (voxel indexes far above 65535)
import { TER, idx, setBit } from '../../js/game/core/grid.js';
import { createColony } from '../../js/game/core/state.js';
import { newColonist, newStack, newBuilding, newZone, newPath } from '../../js/game/core/schema.js';
import { buildPristine, attachPristine } from '../../js/game/save/pristine.js';

const STONE = 3, SOIL = 1;
const hash = (i, k = 0) => (Math.imul(i ^ (k * 0x9e3779b9), 2654435761) >>> 0);

export function stubFortress(seed = 7, { d = 20, zS = 14, w = 128 } = {}) {
  const s = createColony(seed, { w, d, zS, terrain: TER.AIR });
  const L = s.L, h = w;
  for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = idx(x, y, z), r = hash(i, seed);
    const massif = x > 80 ? Math.min(3, 1 + ((x - 80) >> 4)) : 0;   // levels of rock above the valley
    if (z < zS) { L.terrain[i] = TER.ROCK; L.mat[i] = z >= zS - 2 ? SOIL : STONE + (z < 6 ? 1 : 0); if (r % 61 === 0) L.ore[i] = 1 + (r % 5); }
    else if (z === zS) {
      if (massif) { L.terrain[i] = TER.ROCK; L.mat[i] = STONE; continue; }
      L.terrain[i] = r % 9 === 0 ? TER.DIRT : TER.GRASS;
      if (r % 3 === 0) { L.plant[i] = 1 + (r % 12); L.growth[i] = r & 255; }
      if (x < 6 && r % 2) L.blight[i] = r & 3;
    } else if (z - zS <= massif) { L.terrain[i] = TER.ROCK; L.mat[i] = STONE; }
  }
  L.fluid = new Uint8Array(L.terrain.length);   // C1 v3 layer 13 (not in grid.LAYERS until the switch)
  for (let y = 40; y < 44; y++) for (let x = 20; x < 26; x++) L.fluid[idx(x, y, 3)] = 4;   // a seep pool
  attachPristine(s, buildPristine(s, { worldKind: 3, genVersion: 1, meta: { amendments: [], dormant: [{ k: 'vault', z: 2 }] } }));
  // entities on the surface and below
  for (let k = 0; k < 7; k++) s.col.push(newColonist(k, { name: `Delver ${k}`, x: 50 + k, y: 52, z: zS }));
  s.next.col = 7;
  for (let k = 0; k < 120; k++) s.items.push(newStack(k, k % 3 ? 'stone' : 'wood', k % 3 ? 'granite' : null, 2, 1 + (k % 9), 40 + (k % 20), 60 + ((k / 20) | 0), { z: k < 60 ? zS : zS - 3 }));
  for (let k = 0; k < 30; k++) s.bld.push(newBuilding(k, 'wall', 70 + (k % 10), 50 + ((k / 10) | 0), 0, 'granite', { z: k < 20 ? zS : zS - 6 }));
  s.zones.push(newZone(1, 'stock', { name: 'Store' }));
  return s;
}

export function digFortress(s, x = 60, y = 60) {
  const L = s.L;
  for (let k = 1; k <= s.zS; k++) {
    const z = s.zS - k, i = idx(x, y, z);
    L.terrain[i] = k === s.zS ? TER.STAIR_U : TER.STAIR_UD; L.ore[i] = 0;
    if (k % 3 === 0) for (let dy = -4; dy <= 4; dy++) for (let dx = 1; dx <= 9; dx++) {
      const j = idx(x + dx, y + dy, z);
      L.terrain[j] = TER.ROUGH; L.ore[j] = 0;
      if ((dx + dy) % 3 === 0) L.floor[j] = 2;
      if (dx > 5) L.zone[j] = 1;
      setBit(L.known, j, 1); setBit(L.fog, j, 1);
    }
  }
  L.terrain[idx(x, y, s.zS)] = TER.STAIR_D;
  for (let t = 0; t < 40; t++) { const j = idx(81 + t, 70, s.zS); L.terrain[j] = TER.ROUGH; L.roof[j] = 3; }   // a tunnel into the massif
  for (let t = 0; t < 300; t++) { const j = idx(10 + (t % 60), 10 + ((t / 60) | 0), s.zS); L.plant[j] = 0; L.growth[j] = 0; L.desig[j] = t % 7 === 0 ? 2 : 0; }
  for (let yy = 0; yy < s.h; yy++) for (let xx = 0; xx < 70; xx++) setBit(L.known, idx(xx, yy, s.zS), 1);
  return s;
}

export function deepPath(s, x = 60, y = 60) {
  const c = s.col.find(Boolean); if (!c) return null;
  const tiles = [];
  for (let z = s.zS; z >= 0; z--) tiles.push(idx(x, y, z));
  c.path = newPath(tiles, 3);
  s.col[1].path = newPath([idx(1, 1, 2)], -1);   // a failed path
  return c;
}
