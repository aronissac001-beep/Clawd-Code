// Stub maps (owner B) for tests, benches and debug scenes until mapgen.js exists (Stage 1a).
// Deterministic: a private mulberry32 stream from rand.js, never Math.random. Writes s.L directly
// (allowed before initRuntime, like mapgen), then the caller runs initRuntime(s).
//   'flat'   all grass
//   'bench'  a 128-style map: an east massif (rock roofed by depth) with tunnels, halls and a sealed
//            cavern; a river with three fords; a lake; marsh; three walled rooms with doors
//   'maze'   solid rock with a perfect maze of 1-tile tunnels (the worst case for A*; the 1b
//            tunnel-maze bench decides HPA-lite, 12.3)

import { W, H, N, TER, ROOF, idx } from '../core/grid.js';
import { rint, rnd } from '../core/rand.js';
import { newBuilding } from '../core/schema.js';
import { depthRebuild } from './pass.js';

const MAT = { SANDSTONE: 1, GRANITE: 3, BASALT: 5, DUSKSTONE: 7 }; // placeholder ids until materials.js (G)

/** Roof every rock tile by its depth (thin 1-4, overhead deeper), as mapgen step 2-3 will. */
export function roofRockByDepth(s) {
  const depth = depthRebuild(s);
  for (let i = 0; i < N; i++) {
    const t = s.L.terrain[i];
    if (t !== TER.ROCK && t !== TER.RUBBLE) continue;
    const d = depth[i];
    s.L.roof[i] = d >= 5 ? ROOF.MOUNTAIN : ROOF.THIN;
    s.L.mat[i] = d <= 4 ? MAT.SANDSTONE : d <= 12 ? MAT.GRANITE : d <= 22 ? MAT.BASALT : MAT.DUSKSTONE;
  }
  return depth;
}
/** Carve tile i to rough floor keeping a rock roof by depth (so depth does not change). */
function carve(s, depth, i) {
  if (s.L.terrain[i] !== TER.ROCK) return;
  s.L.terrain[i] = TER.ROUGH;
  s.L.ore[i] = 0;
  s.L.roof[i] = depth[i] >= 5 ? ROOF.MOUNTAIN : ROOF.THIN;
}

export function buildStubMap(s, kind = 'bench', seed = 1) {
  const R = { rng: { main: (seed >>> 0) || 1 } };
  const r = (a, b) => rint(R, 'main', a, b);
  const L = s.L;
  L.terrain.fill(TER.GRASS); L.roof.fill(0); L.mat.fill(0); L.ore.fill(0);
  if (kind === 'flat') return s;
  if (kind === 'maze') return maze(s, R);

  // massif on the east
  const face = new Int32Array(H);
  for (let y = 0; y < H; y++) face[y] = Math.floor(W * 0.64 + 5 * Math.sin(y * 0.09 + seed) + 3 * Math.sin(y * 0.23));
  for (let y = 0; y < H; y++) for (let x = face[y]; x < W; x++) L.terrain[idx(x, y)] = TER.ROCK;
  // a small hill in the north-west
  const hx = Math.floor(W * 0.18), hy = Math.floor(H * 0.2), hr = Math.max(4, Math.floor(W * 0.07));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x - hx) ** 2 + (y - hy) ** 2 < hr * hr) L.terrain[idx(x, y)] = TER.ROCK;
  const depth = roofRockByDepth(s);
  // ore glints
  for (let i = 0; i < N; i++) if (L.terrain[i] === TER.ROCK && rnd(R, 'main') < 0.02) L.ore[i] = r(1, 6);
  // tunnels and halls from the face inward
  const tunnels = Math.max(4, Math.floor(H / 9));
  for (let k = 0; k < tunnels; k++) {
    let y = r(4, H - 5), x = face[y] - 1;
    const len = r(Math.floor(W * 0.12), Math.floor(W * 0.4));
    for (let t = 0; t < len; t++) {
      x = Math.min(W - 2, x + (r(0, 3) ? 1 : 0));
      carve(s, depth, idx(x, y));                       // 4-connected: step x, then y
      y = Math.max(1, Math.min(H - 2, y + r(-1, 1)));
      carve(s, depth, idx(x, y));
      if (k % 4 === 0 && t === len >> 1) for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx > 0 && yy > 0 && xx < W - 1 && yy < H - 1) carve(s, depth, idx(xx, yy));
      }
    }
  }
  // a sealed cavern deep in the massif (unreachable until mined into)
  const cx = W - Math.floor(W * 0.1), cy = Math.floor(H * 0.7), cr = Math.max(3, Math.floor(W * 0.04));
  for (let y = cy - cr; y <= cy + cr; y++) for (let x = cx - cr; x <= cx + cr; x++) {
    if (x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1) continue;
    if ((x - cx) ** 2 + (y - cy) ** 2 <= cr * cr && L.terrain[idx(x, y)] === TER.ROCK) {
      const i = idx(x, y);
      L.terrain[i] = TER.MOSS; L.roof[i] = ROOF.MOUNTAIN;
    }
  }
  // river north-south with three fords
  const fords = [Math.floor(H * 0.16), Math.floor(H * 0.5), Math.floor(H * 0.84)];
  for (let y = 0; y < H; y++) {
    const rx = Math.floor(W * 0.3 + 6 * Math.sin(y * 0.05 + seed));
    const ford = fords.some((f) => Math.abs(y - f) <= 1);
    for (let dx = -3; dx <= 3; dx++) {
      const x = rx + dx;
      if (x < 0 || x >= W) continue;
      const i = idx(x, y);
      if (L.terrain[i] === TER.ROCK) continue;
      L.terrain[i] = Math.abs(dx) <= 1 && !ford ? TER.DEEP : TER.SHALLOW;
      if (Math.abs(dx) === 3 && !ford) L.terrain[i] = TER.SAND;
    }
  }
  // lake and marsh
  const lx = Math.floor(W * 0.13), ly = Math.floor(H * 0.75), la = Math.max(4, Math.floor(W * 0.07)), lb = Math.max(3, Math.floor(H * 0.05));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const e = ((x - lx) / la) ** 2 + ((y - ly) / lb) ** 2, i = idx(x, y);
    if (L.terrain[i] === TER.ROCK) continue;
    if (e < 1) L.terrain[i] = TER.DEEP;
    else if (e < 1.4) L.terrain[i] = TER.SHALLOW;
    else if (e < 2.2 && rnd(R, 'main') < 0.5) L.terrain[i] = TER.MARSH;
  }
  // three walled rooms with doors near the middle of the open ground
  const ox = Math.floor(W * 0.46), oy = Math.floor(H * 0.42);
  for (let k = 0; k < 3; k++) {
    const x0 = ox + k * 8, y0 = oy, x1 = x0 + 6, y1 = y0 + 5;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (x !== x0 && x !== x1 && y !== y0 && y !== y1) continue;
      if (x >= W || y >= H || L.terrain[idx(x, y)] !== TER.GRASS) continue;
      const door = y === y1 && x === x0 + 3;
      s.bld.push(newBuilding(s.bld.length, door ? 'door_wood' : 'wall_stone', x, y, 0, 'granite', { st: 'done' }));
    }
  }
  return s;
}

function maze(s, R) {
  const L = s.L;
  L.terrain.fill(TER.ROCK);
  // cells on odd coordinates; iterative depth-first backtracker
  const cw = Math.floor((W - 1) / 2), ch = Math.floor((H - 1) / 2);
  const seen = new Uint8Array(cw * ch), st = [0];
  seen[0] = 1;
  const open = (cx, cy) => { L.terrain[idx(cx * 2 + 1, cy * 2 + 1)] = TER.ROUGH; };
  open(0, 0);
  const DX = [1, -1, 0, 0], DY = [0, 0, 1, -1];
  while (st.length) {
    const c = st[st.length - 1], cx = c % cw, cy = (c / cw) | 0;
    const opts = [];
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d], ny = cy + DY[d];
      if (nx >= 0 && ny >= 0 && nx < cw && ny < ch && !seen[ny * cw + nx]) opts.push(d);
    }
    if (!opts.length) { st.pop(); continue; }
    const d = opts[Math.floor(rnd(R, 'main') * opts.length)], nx = cx + DX[d], ny = cy + DY[d];
    seen[ny * cw + nx] = 1;
    L.terrain[idx(cx * 2 + 1 + DX[d], cy * 2 + 1 + DY[d])] = TER.ROUGH;
    open(nx, ny);
    st.push(ny * cw + nx);
  }
  // roofs: the maze is all under rock; depth counts from the open surface (none here: cap)
  for (let i = 0; i < N; i++) { L.roof[i] = ROOF.MOUNTAIN; L.mat[i] = MAT.GRANITE; }
  return s;
}
