// Procedural region generation. Pure function of (seed, biome): the same seed
// always yields the same map. Produces terrain, resource nodes, spawn points
// at the map edge and hidden caches in the fog.
import { RNG, makeNoise2D } from '../engine/rng.js';
import { N, TER, idx, inB, TER_PASSABLE } from './grid.js';
import { BIOMES } from '../data/biomes.js';
import { BAL } from '../data/balance.js';

export function generateMap(seed, biomeId = 'greenvale', opts = {}) {
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

  // 5. Spawn points (stream D): a ring 14-17 tiles out from the Hearth, so the Hollow make
  //    contact within about 8 s of nightfall; up to two per side. Each one must be a fair walk:
  //    at most 1.4x the straight line and 30 tiles on foot (8-way, as the enemy flow field
  //    walks). A side with no fair spot gets a road carved from the ring to the Hearth.
  const SP = BAL.waves;
  const [r0, r1] = SP.spawnRing;
  const sideOf = (x, y) => { const dx = x + 0.5 - c, dy = y + 0.5 - c; return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : (dy > 0 ? 'S' : 'N'); };
  const ring = [];
  for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
    const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
    if (d >= r0 && d <= r1) ring.push([x, y, d, sideOf(x, y)]);
  }
  const fair = (fd, x, y, d) => {
    const v = fd[idx(x, y)];
    return isFinite(v) && v <= SP.spawnMaxFlow && v <= SP.spawnMaxDetour * Math.max(1, d - 1);
  };
  let fd = walkDist(terrain, nodeGrid, hearth);
  const spawns = [];
  for (const side of ['N', 'S', 'W', 'E']) {
    const cands = ring.filter((q) => q[3] === side && TER_PASSABLE[terrain[idx(q[0], q[1])]] && !nodeGrid[idx(q[0], q[1])]);
    rng.shuffle(cands);
    const ok = cands.filter((q) => fair(fd, q[0], q[1], q[2]));
    if (ok.length) {
      spawns.push({ tx: ok[0][0], ty: ok[0][1], side, ok: true });
      const far = ok.find((q) => Math.hypot(q[0] - ok[0][0], q[1] - ok[0][1]) >= 7);
      if (far) spawns.push({ tx: far[0], ty: far[1], side, ok: true });
      continue;
    }
    // No fair spot on this side: carve a road from the ring (on the side's axis) to the Hearth.
    const all = ring.filter((q) => q[3] === side);
    if (!all.length) continue;
    const pick = all[rng.int(0, all.length - 1)];
    carveRoad(terrain, nodeGrid, nodes, pick[0], pick[1], c);
    spawns.push({ tx: pick[0], ty: pick[1], side, ok: true });
    fd = walkDist(terrain, nodeGrid, hearth);
  }
  const liveNodes = nodes.filter((n) => n.amount > 0);

  // 6. Hidden caches in the outer ring.
  const reach2 = flood(terrain, nodeGrid, c, c);
  const caches = [];
  const wantCaches = opts.caches || 4;
  for (let tries = 0; tries < 400 && caches.length < wantCaches; tries++) {
    const a = rng.float(0, Math.PI * 2), r = rng.float(10, 17);
    const x = Math.round(c + Math.cos(a) * r), y = Math.round(c + Math.sin(a) * r);
    if (!inB(x, y) || !reach2[idx(x, y)] || nodeGrid[idx(x, y)]) continue;
    if (caches.some((q) => Math.hypot(q.tx - x, q.ty - y) < (wantCaches > 4 ? 5 : 7))) continue;
    const kind = rng.pick(['wood', 'stone', 'gold', 'food']);
    const amt = { wood: 60, stone: 40, gold: 45, food: 70 }[kind];
    caches.push({ id: caches.length + 1, tx: x, ty: y, taken: false, reward: { [kind]: amt } });
  }

  return { terrain, nodes: liveNodes, nodeGrid, hearth, spawns, caches, biome: biomeId };
}

/** Carve a walkable road from (x, y) toward the centre tile c (rivers become fords). */
function carveRoad(terrain, nodeGrid, nodes, x, y, c) {
  let guard = 0;
  while (Math.abs(x + 0.5 - c) + Math.abs(y + 0.5 - c) > 2 && guard++ < N * 2) {
    const i = idx(x, y);
    if (!TER_PASSABLE[terrain[i]]) terrain[i] = TER.SAND;
    if (nodeGrid[i]) { const n = nodes.find((q) => q.id === nodeGrid[i]); if (n) n.amount = 0; nodeGrid[i] = 0; }
    const dx = c - 0.5 - x, dy = c - 0.5 - y;
    if (Math.abs(dx) >= Math.abs(dy)) x += Math.sign(dx); else y += Math.sign(dy);
  }
}

/** Walking distance in tiles from the Hearth (8-way, no corner cutting; trees and rock block). */
function walkDist(terrain, nodeGrid, hearth) {
  const D = new Float32Array(N * N).fill(Infinity);
  const open = (i) => TER_PASSABLE[terrain[i]] && !nodeGrid[i];
  const q = [];
  for (let y = hearth.ty; y < hearth.ty + 2; y++) for (let x = hearth.tx; x < hearth.tx + 2; x++) { D[idx(x, y)] = 0; q.push(idx(x, y)); }
  // Small map (1600 tiles): a simple label-correcting queue is plenty.
  const DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1];
  for (let h = 0; h < q.length; h++) {
    const i = q[h], x = i % N, y = (i / N) | 0, di = D[i];
    for (let k = 0; k < 8; k++) {
      const nx = x + DX[k], ny = y + DY[k];
      if (!inB(nx, ny)) continue;
      const j = idx(nx, ny);
      if (!open(j)) continue;
      if (k >= 4 && (!open(idx(nx, y)) || !open(idx(x, ny)))) continue;
      const nd = di + (k >= 4 ? Math.SQRT2 : 1);
      if (nd + 1e-6 < D[j]) { D[j] = nd; q.push(j); }
    }
  }
  return D;
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
