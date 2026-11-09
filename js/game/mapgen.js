// Procedural region generation. Pure function of (seed, biome): the same seed
// always yields the same map. Produces terrain, resource nodes, spawn points
// at the map edge and hidden caches in the fog.
import { RNG, makeNoise2D } from '../engine/rng.js';
import { N, TER, idx, inB, TER_PASSABLE } from './grid.js';
import { BIOMES } from '../data/biomes.js';

export function generateMap(seed, biomeId = 'greenvale') {
  const biome = BIOMES[biomeId];
  const rng = new RNG(seed);
  const elev = makeNoise2D(rng.int(1, 1e9));
  const wood = makeNoise2D(rng.int(1, 1e9));
  const flora = makeNoise2D(rng.int(1, 1e9));
  const terrain = new Uint8Array(N * N);
  const c = N >> 1; // 20: hearth centre tile
  const hearth = { tx: c - 1, ty: c - 1 };

  // 1. Base: grass, meadows, crags toward the edges.
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const d = Math.hypot(x - c, y - c) / (N * 0.5);
    const e = elev(x * 0.12, y * 0.12, 3) + Math.max(0, d - 0.55) * 0.55;
    let t = TER.GRASS;
    if (flora(x * 0.09 + 40, y * 0.09, 2) > 0.62) t = TER.MEADOW;
    if (e > biome.cragAmount && d > 0.3) t = TER.CRAG;
    terrain[idx(x, y)] = t;
  }

  // 2. River: a meandering band across the map, offset from the centre,
  //    with two sandy fords so both banks connect.
  if (biome.river) {
    const vertical = rng.chance(0.5);
    const side = rng.chance(0.5) ? 1 : -1;
    let pos = c + side * rng.int(8, 12);
    const riverTiles = [];
    for (let s = 0; s < N; s++) {
      pos += rng.int(-1, 1) * (rng.chance(0.6) ? 1 : 0);
      pos = Math.max(4, Math.min(N - 5, pos));
      if (Math.abs(pos - c) < 7) pos = c + side * 7;
      const w = rng.chance(0.35) ? 2 : 1;
      for (let k = 0; k <= w; k++) {
        const x = vertical ? pos + k : s, y = vertical ? s : pos + k;
        if (inB(x, y)) { terrain[idx(x, y)] = TER.WATER; riverTiles.push([x, y, s]); }
      }
    }
    // Sandy banks.
    for (const [x, y] of riverTiles) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (inB(nx, ny) && terrain[idx(nx, ny)] !== TER.WATER && terrain[idx(nx, ny)] !== TER.CRAG && rng.chance(0.55)) terrain[idx(nx, ny)] = TER.SAND;
      }
    }
    // Fords at two positions along the river.
    const fordAt = [rng.int(6, 15), rng.int(24, 33)];
    for (const f of fordAt) for (const [x, y, s] of riverTiles) if (s === f || s === f + 1) terrain[idx(x, y)] = TER.SAND;
  }

  // 3. Clear the Hearth glade.
  for (let y = c - 6; y <= c + 6; y++) for (let x = c - 6; x <= c + 6; x++) {
    if (!inB(x, y)) continue;
    const d = Math.hypot(x - c + 0.5, y - c + 0.5);
    if (d < 5.5) terrain[idx(x, y)] = d < 2.8 ? TER.DIRT : (terrain[idx(x, y)] === TER.MEADOW ? TER.MEADOW : TER.GRASS);
  }

  // 4. Resource nodes.
  const nodes = [];
  const nodeGrid = new Int32Array(N * N);
  let nid = 1;
  const free = (x, y) => inB(x, y) && TER_PASSABLE[terrain[idx(x, y)]] && terrain[idx(x, y)] !== TER.SAND && !nodeGrid[idx(x, y)];
  const nearHearth = (x, y, r) => Math.hypot(x - c + 0.5, y - c + 0.5) < r;
  const addNode = (kind, x, y, amount) => {
    const n = { id: nid++, kind, tx: x, ty: y, amount, max: amount, v: rng.int(0, 5) };
    nodes.push(n); nodeGrid[idx(x, y)] = n.id; return n;
  };

  // Forest from noise, leaving the glade open.
  for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
    if (!free(x, y) || nearHearth(x, y, 6.5)) continue;
    const f = wood(x * 0.14 + 200, y * 0.14 - 50, 3);
    if (f > 1 - biome.forestDensity * 0.72 && rng.chance(0.78)) addNode('tree', x, y, 25);
    else if (rng.chance(0.025)) addNode('tree', x, y, 25);
  }
  // Guaranteed grove close to home so the first Lumber Camp always has work.
  {
    const a = rng.float(0, Math.PI * 2);
    const gx = Math.round(c + Math.cos(a) * 8), gy = Math.round(c + Math.sin(a) * 8);
    for (let k = 0; k < 16; k++) {
      const x = gx + rng.int(-2, 2), y = gy + rng.int(-2, 2);
      if (free(x, y) && !nearHearth(x, y, 6)) addNode('tree', x, y, 25);
    }
  }
  // Rock clusters: one guaranteed near home, the rest further out.
  for (let k = 0; k < biome.rockClusters; k++) {
    const a = rng.float(0, Math.PI * 2);
    const r = k === 0 ? rng.float(6.5, 8) : rng.float(9, 16);
    const gx = Math.round(c + Math.cos(a) * r), gy = Math.round(c + Math.sin(a) * r);
    const count = rng.int(3, 5);
    let placed = 0;
    for (let tries = 0; tries < 30 && placed < count; tries++) {
      const x = gx + rng.int(-1, 1), y = gy + rng.int(-1, 1);
      if (inB(x, y) && TER_PASSABLE[terrain[idx(x, y)]] && !nodeGrid[idx(x, y)] && !nearHearth(x, y, 5.5)) {
        terrain[idx(x, y)] = TER.GRASS; addNode('rock', x, y, 60); placed++;
      }
    }
  }

  // 5. Reachability: flood from the Hearth; anything sealed off from the
  //    edges by crag/water/trees gets a corridor carved so every spawn works.
  const reach = flood(terrain, nodeGrid, c, c);
  const spawns = [];
  const edgeCandidates = [];
  for (let s = 3; s < N - 3; s += 3) {
    edgeCandidates.push([s, 0, 'N'], [s, N - 1, 'S'], [0, s, 'W'], [N - 1, s, 'E']);
  }
  for (const side of ['N', 'S', 'W', 'E']) {
    const cands = edgeCandidates.filter((e) => e[2] === side && reach[idx(e[0], e[1])]);
    rng.shuffle(cands);
    if (cands.length) spawns.push({ tx: cands[0][0], ty: cands[0][1], side });
    if (cands.length > 3) spawns.push({ tx: cands[3][0], ty: cands[3][1], side });
  }
  // Carve fallback corridors for sides with no reachable spawn.
  for (const side of ['N', 'S', 'W', 'E']) {
    if (spawns.some((s) => s.side === side)) continue;
    const s0 = rng.int(12, 27);
    let x = side === 'W' ? 0 : side === 'E' ? N - 1 : s0;
    let y = side === 'N' ? 0 : side === 'S' ? N - 1 : s0;
    const sx = x, sy = y;
    while (Math.abs(x - c) + Math.abs(y - c) > 2) {
      const i = idx(x, y);
      if (!TER_PASSABLE[terrain[i]]) terrain[i] = TER.SAND;
      if (nodeGrid[i]) { const n = nodes.find((q) => q.id === nodeGrid[i]); if (n) n.amount = 0; nodeGrid[i] = 0; }
      if (x !== c) x += Math.sign(c - x); else y += Math.sign(c - y);
    }
    spawns.push({ tx: sx, ty: sy, side });
  }
  const liveNodes = nodes.filter((n) => n.amount > 0);

  // 6. Hidden caches in the outer ring.
  const reach2 = flood(terrain, nodeGrid, c, c);
  const caches = [];
  for (let tries = 0; tries < 300 && caches.length < 4; tries++) {
    const a = rng.float(0, Math.PI * 2), r = rng.float(10, 17);
    const x = Math.round(c + Math.cos(a) * r), y = Math.round(c + Math.sin(a) * r);
    if (!inB(x, y) || !reach2[idx(x, y)] || nodeGrid[idx(x, y)]) continue;
    if (caches.some((q) => Math.hypot(q.tx - x, q.ty - y) < 7)) continue;
    const kind = rng.pick(['wood', 'stone', 'gold', 'food']);
    const amt = { wood: 60, stone: 40, gold: 45, food: 70 }[kind];
    caches.push({ id: caches.length + 1, tx: x, ty: y, taken: false, reward: { [kind]: amt } });
  }

  return { terrain, nodes: liveNodes, nodeGrid, hearth, spawns, caches, biome: biomeId };
}

function flood(terrain, nodeGrid, sx, sy) {
  const seen = new Uint8Array(N * N);
  const q = [idx(sx, sy)];
  seen[q[0]] = 1;
  while (q.length) {
    const i = q.pop();
    const x = i % N, y = (i / N) | 0;
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dy] of nb) {
      const nx = x + dx, ny = y + dy;
      if (!inB(nx, ny)) continue;
      const j = idx(nx, ny);
      if (seen[j] || !TER_PASSABLE[terrain[j]] || nodeGrid[j]) continue;
      seen[j] = 1; q.push(j);
    }
  }
  return seen;
}
