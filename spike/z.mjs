// The on-device z-level bench (EMBERCROWN-FORTRESS.md 8.2 step S9.1; owner J, with C for the renderer).
// Browser-safe copies of the prototype benches (scratchpad zlevel/proto: world.mjs, path.mjs, render.mjs,
// suite.mjs, bench-render.mjs, bench-save.mjs), in one module so the page needs no other file. Nothing here
// touches the game. Run it from spike/z.html (Safari, the Home Screen, or tools/spike/run.mjs --page=z).
//
// Measured: mapgen of a 128 x 128 x 20 world (and its hash, so engines can be compared), region relabel and
// graph rebuild, link-heuristic 3D A* on the dug fortress (the 3D maze), the region-level Dijkstra and the
// per-region local flow fields of hierarchical flow, a one-level renderer switching levels at 390 x 664 and
// 844 x 335, inflate of a 3 MB world, and a canvas-memory ceiling probe. Every number sits beside PROTO's
// Chromium figure and the doc's A15 estimate (6.x), so the owner's pasted report says at once whether the
// phone is within 1.5x of the estimates (8.2 S9.1: otherwise the doc is revised before E1).

// ==== World (proto/world.mjs) ========================================================================
export const TER = Object.freeze({ AIR: 0, ROCK: 1, SOIL: 2, FLOOR: 3, GRASS: 4, STAIR_U: 5, STAIR_D: 6, STAIR_UD: 7, RAMP: 8, RAMP_TOP: 9, WATER: 10, TREE: 11, WALL: 12 });
export const WALK = Uint8Array.from([0, 0, 0, 10, 10, 10, 10, 10, 12, 12, 0, 0, 0]);
export const UPSET = Uint8Array.from([0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 0]);
export const DOWNSET = Uint8Array.from([0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 0, 0, 0]);
export const SOLID = Uint8Array.from([0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1]);

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash3(x, y, z, s) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647) + Math.imul(s, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, z, s) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash3(xi, yi, z, s), b = hash3(xi + 1, yi, z, s), c = hash3(xi, yi + 1, z, s), d = hash3(xi + 1, yi + 1, z, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, y, z, s) => vnoise(x, y, z, s) * 0.6 + vnoise(x * 2.1, y * 2.1, z, s + 7) * 0.3 + vnoise(x * 4.3, y * 4.3, z, s + 13) * 0.1;

function stoneAt(x, y, z, zS, D, seed) {
  const depth = zS - z + (fbm(x / 23, y / 23, 0, seed + 31) - 0.5) * 3;
  if (depth < 2) return 1;
  return Math.max(1, Math.min(6, 2 + ((depth - 2) / Math.max(2, (zS - 2) / 4)) | 0));
}

/** The pristine prototype world: { W, H, D, PLANE, N, zS, seed, ter, mat, ore, height, caverns }. */
export function generate(W, H, D, seed) {
  const PLANE = W * H, N = PLANE * D;
  const zS = D - 6;
  const ter = new Uint8Array(N), mat = new Uint8Array(N), ore = new Uint8Array(N);
  const height = new Uint8Array(PLANE);
  const rng = mulberry32(seed ^ 0x9e3779b9);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const e = fbm(x / 40, y / 40, 0, seed) * 0.6 + (x / W) * 0.9 - 0.62;
    height[y * W + x] = e > 0 ? Math.min(D - 1, zS + Math.ceil(e * 14)) : zS;
  }
  // Math.sin is not bit-exact across engines (the inexact-Math lint of 2.2); worldHash shows whether it differed here
  const riverY = (x) => (H * 0.3 + Math.sin(x / 17 + seed) * 8) | 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = y * W + x, h = height[c];
    for (let z = 0; z < D; z++) {
      const i = z * PLANE + c;
      if (z < h) { ter[i] = h === zS && z >= zS - 2 ? TER.SOIL : TER.ROCK; mat[i] = ter[i] === TER.SOIL ? 0 : stoneAt(x, y, z, zS, D, seed); }
      else if (z === h) {
        if (h === zS && Math.abs(y - riverY(x)) < 2 && x < W * 0.55) ter[i] = TER.WATER;
        else ter[i] = h === zS && hash3(x, y, 1, seed) < 0.06 ? TER.TREE : TER.GRASS;
      } else ter[i] = TER.AIR;
    }
  }
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const c = y * W + x, h = height[c];
    if (h + 1 >= D || ter[h * PLANE + c] !== TER.GRASS) continue;
    for (const d of [1, -1, W, -W]) if (height[c + d] === h + 1 && hash3(x, y, 2, seed) < 0.35) { ter[h * PLANE + c] = TER.RAMP; ter[(h + 1) * PLANE + c] = TER.RAMP_TOP; break; }
  }
  const caverns = [];
  for (const f of D >= 20 ? [0.55, 0.3, 0.1] : [0.5, 0.15]) { const z = Math.max(0, Math.round(zS * f)); if (!caverns.includes(z)) caverns.push(z); }
  for (const z of caverns) {
    let a = new Uint8Array(PLANE), b = new Uint8Array(PLANE);
    for (let c = 0; c < PLANE; c++) { const x = c % W, y = (c / W) | 0; a[c] = (x > 2 && y > 2 && x < W - 3 && y < H - 3 && rng() < 0.47 + (fbm(x / 30, y / 30, z, seed + 5) - 0.5) * 0.4) ? 1 : 0; }
    for (let it = 0; it < 5; it++) {
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        let n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) n += a[(y + dy) * W + x + dx];
        b[y * W + x] = n >= 5 ? 1 : 0;
      }
      [a, b] = [b, a];
    }
    for (let c = 0; c < PLANE; c++) if (a[c]) ter[z * PLANE + c] = TER.FLOOR;
  }
  const veins = 30 * Math.ceil(D / 12);
  for (let v = 0; v < veins; v++) {
    let x = (rng() * W) | 0, y = (rng() * H) | 0, z = (rng() * (zS + 2)) | 0;
    const kind = 1 + ((rng() * 6) | 0), len = 20 + ((rng() * 40) | 0);
    for (let k = 0; k < len; k++) {
      const i = z * PLANE + y * W + x;
      if (ter[i] === TER.ROCK) ore[i] = kind;
      x = Math.max(0, Math.min(W - 1, x + ((rng() * 3) | 0) - 1)); y = Math.max(0, Math.min(H - 1, y + ((rng() * 3) | 0) - 1));
      if (rng() < 0.12) z = Math.max(0, Math.min(D - 1, z + (rng() < 0.5 ? -1 : 1)));
    }
  }
  return { W, H, D, PLANE, N, zS, seed, ter, mat, ore, height, caverns };
}

/** Dig the prototype's mid-game fortress in place (about 11k voxels, 8 levels below the valley). */
export function digFortress(w, seed, levels = 8) {
  const { W, H, D, PLANE, zS, ter, height } = w;
  const rng = mulberry32(seed * 7 + 1);
  let mined = 0;
  const dig = (x, y, z, t = TER.FLOOR) => {
    if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1 || z < 0 || z >= D) return;
    const i = z * PLANE + y * W + x;
    if (SOLID[ter[i]] && ter[i] !== TER.TREE) { ter[i] = t; mined++; } else if (t !== TER.FLOOR && ter[i] !== TER.AIR) ter[i] = t;
  };
  const rect = (x0, y0, x1, y1, z) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) dig(x, y, z); };
  const my = H >> 1;
  let fx = 0; while (fx < W - 1 && height[my * W + fx] <= zS + 1) fx++;
  const sx = Math.min(W - 20, fx + 14), sy = my;
  const zBot = Math.max(0, Math.min(...w.caverns));
  const zTop = Math.min(D - 2, zS + 3);
  rect(fx - 2, my - 1, sx, my + 1, zS);
  const shaft = (cx, cy, za, zb) => {
    for (let z = za; z <= zb; z++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const t = z === za ? TER.STAIR_U : z === zb ? TER.STAIR_D : TER.STAIR_UD;
      const i = z * PLANE + (cy + dy) * W + cx + dx; if (SOLID[ter[i]]) mined++; ter[i] = t;
    }
  };
  const fortLevels = [];
  for (let k = 1; k <= levels && zS - k > zBot; k++) fortLevels.push(zS - k);
  const upper = [];
  for (let z = zS + 1; z <= zTop; z++) if (height[sy * W + sx] > z) upper.push(z);
  const all = [...upper, zS, ...fortLevels];
  for (const z of all) {
    const full = z >= zS - 4;
    rect(sx - 6, sy - 6, sx + 6, sy + 6, z);
    const arms = full ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : [[0, 1], [1, 0]];
    for (const [ax, ay] of arms) {
      const len = full ? 36 + ((rng() * 12) | 0) : 20;
      for (let k = 7; k < len; k++) {
        const x = sx + ax * k, y = sy + ay * k;
        if (x < 3 || y < 3 || x > W - 4 || y > H - 4) break;
        dig(x, y, z); if (full) dig(x + ay, y + ax, z);
        if (full && k % 6 === 0) {
          for (const side of [-1, 1]) {
            const ox = ay * side, oy = ax * side;
            dig(x + ox * (side > 0 ? 2 : 1), y + oy * (side > 0 ? 2 : 1), z);
            const cx = x + ox * 4, cy = y + oy * 4;
            rect(cx - 1, cy - 1, cx + 2, cy + 2, z);
          }
        }
      }
      if (full) { const ex = Math.max(8, Math.min(W - 9, sx + ax * len)), ey = Math.max(8, Math.min(H - 9, sy + ay * len)); rect(ex - 4, ey - 4, ex + 4, ey + 4, z); }
    }
    for (let t = 0; t < (full ? 3 : 2); t++) {
      let x = sx, y = sy;
      for (let k = 0; k < 180; k++) { dig(x, y, z); const r = rng(); if (r < 0.25) x++; else if (r < 0.5) x--; else if (r < 0.75) y++; else y--; x = Math.max(3, Math.min(W - 4, x)); y = Math.max(3, Math.min(H - 4, y)); }
    }
  }
  shaft(sx, sy, Math.min(...all), Math.max(...all));
  const s2x = Math.max(8, sx - 40);
  for (let k = 0; k + 1 < fortLevels.length && fortLevels[k + 1] >= zS - 4; k++) shaft(s2x, sy, fortLevels[k + 1], fortLevels[k]);
  shaft(s2x, sy, fortLevels[0], zS);
  const deepest = Math.min(...all);
  for (const zc of [...w.caverns].sort((a, b) => b - a)) {
    let best = -1, bd = 1e9;
    for (let c = 0; c < PLANE; c++) if (ter[zc * PLANE + c] === TER.FLOOR) { const d = Math.abs((c % W) - sx) + Math.abs(((c / W) | 0) - sy); if (d < bd) { bd = d; best = c; } }
    if (best < 0) continue;
    const bx = best % W, by = (best / W) | 0;
    for (let x = Math.min(sx, bx); x <= Math.max(sx, bx); x++) dig(x, sy, deepest);
    for (let y = Math.min(sy, by); y <= Math.max(sy, by); y++) dig(bx, y, deepest);
    for (let z = zc; z <= deepest; z++) { const i = z * PLANE + by * W + bx; if (SOLID[ter[i]]) mined++; ter[i] = z === zc ? TER.STAIR_U : z === deepest ? TER.STAIR_D : TER.STAIR_UD; }
  }
  const hearth = fortLevels.length ? fortLevels[0] * PLANE + sy * W + sx + 4 : zS * PLANE + sy * W + sx + 4;
  return { mined, hearth, levels: all, shaft: [sx, sy] };
}
export function walkOf(w) { const walk = new Uint8Array(w.N); for (let i = 0; i < w.N; i++) walk[i] = WALK[w.ter[i]]; return walk; }

/** FNV-1a over byte arrays, as 8 hex digits (equal hashes on two engines = the same world). */
export function fnv(...arrs) { let h = 0x811c9dc5; for (const a of arrs) for (let i = 0; i < a.length; i++) h = Math.imul(h ^ a[i], 16777619); return (h >>> 0).toString(16).padStart(8, '0'); }

// ==== Pathing (proto/path.mjs) =======================================================================
export const CL = 16, LOCAL = 128, VERT = 200;
const DX8 = [1, -1, 0, 0, 1, 1, -1, -1], DY8 = [0, 0, 1, -1, 1, -1, 1, -1];

export function labelAll(w, walk, lab = new Uint32Array(w.N), stats = {}) {
  const { W, H, D } = w, CW = W / CL, CH = H / CL;
  lab.fill(0);
  const st = new Int32Array(CL * CL);
  let skipped = 0, done = 0;
  for (let z = 0; z < D; z++) for (let cy = 0; cy < CH; cy++) for (let cx = 0; cx < CW; cx++) {
    const n = labelCluster(w, walk, lab, (z * CH + cy) * CW + cx, st);
    if (n < 0) skipped++; else done++;
  }
  stats.skipped = skipped; stats.labelled = done;
  return lab;
}
export function labelCluster(w, walk, lab, c, st) {
  const { W, H, PLANE } = w, CW = W / CL, CH = H / CL;
  const z = (c / (CW * CH)) | 0, r = c % (CW * CH), x0 = (r % CW) * CL, y0 = ((r / CW) | 0) * CL;
  const base = z * PLANE;
  let any = false;
  for (let y = y0; y < y0 + CL && !any; y++) for (let x = x0; x < x0 + CL; x++) if (walk[base + y * W + x]) { any = true; break; }
  for (let y = y0; y < y0 + CL; y++) lab.fill(0, base + y * W + x0, base + y * W + x0 + CL);
  if (!any) return -1;
  let local = 0;
  for (let y = y0; y < y0 + CL; y++) for (let x = x0; x < x0 + CL; x++) {
    const i = base + y * W + x;
    if (!walk[i] || lab[i]) continue;
    const id = c * LOCAL + (++local);
    let sp = 0; st[sp++] = i; lab[i] = id;
    while (sp) {
      const j = st[--sp], jx = j % W, jy = ((j - base) / W) | 0;
      if (jx > x0 && walk[j - 1] && !lab[j - 1]) { lab[j - 1] = id; st[sp++] = j - 1; }
      if (jx < x0 + CL - 1 && walk[j + 1] && !lab[j + 1]) { lab[j + 1] = id; st[sp++] = j + 1; }
      if (jy > y0 && walk[j - W] && !lab[j - W]) { lab[j - W] = id; st[sp++] = j - W; }
      if (jy < y0 + CL - 1 && walk[j + W] && !lab[j + W]) { lab[j + W] = id; st[sp++] = j + W; }
    }
  }
  return local;
}
export function buildGraph(w, lab) {
  const { W, H, D, PLANE, N, ter } = w;
  const links = new Map();
  const SH = 262144;
  const add = (ta, tb, vert) => {
    let a = lab[ta], b = lab[tb];
    if (!a || !b || a === b) return;
    let A = ta, B = tb;
    if (a > b) { [a, b] = [b, a]; [A, B] = [B, A]; }
    const k = a * SH + b;
    let L = links.get(k);
    if (!L) { L = { a, b, list: [], vert }; links.set(k, L); }
    L.list.push(A, B);
  };
  for (let z = 0; z < D; z++) {
    const base = z * PLANE;
    for (let y = 0; y < H; y++) for (let x = CL - 1; x < W - 1; x += CL) { const i = base + y * W + x; if (lab[i] && lab[i + 1]) add(i, i + 1, false); }
    for (let y = CL - 1; y < H - 1; y += CL) for (let x = 0; x < W; x++) { const i = base + y * W + x; if (lab[i] && lab[i + W]) add(i, i + W, false); }
  }
  for (let i = 0; i < N - PLANE; i++) if (UPSET[ter[i]] && DOWNSET[ter[i + PLANE]]) add(i, i + PLANE, true);
  const maxId = (W / CL) * (H / CL) * D * LOCAL + 1;
  const par = new Int32Array(maxId); for (let r = 0; r < maxId; r++) par[r] = r;
  const find = (r) => { while (par[r] !== r) { par[r] = par[par[r]]; r = par[r]; } return r; };
  const arr = [...links.values()];
  const regLinks = new Map();
  arr.forEach((L, li) => {
    const m = (L.list.length >> 1) >> 1;
    L.ta = L.list[m * 2]; L.tb = L.list[m * 2 + 1]; L.n = L.list.length >> 1; L.list = null; L.id = li;
    L.cross = L.vert ? VERT : 100;
    const ra = find(L.a), rb = find(L.b); if (ra !== rb) par[ra] = rb;
    for (const r of [L.a, L.b]) { let v = regLinks.get(r); if (!v) regLinks.set(r, (v = [])); v.push(li); }
  });
  const comp = new Int32Array(maxId);
  for (let r = 1; r < maxId; r++) comp[r] = find(r);
  return { links: arr, regLinks, comp, maxId };
}

let BUF = null;
function buffers(N) {
  if (BUF && BUF.N === N) return BUF;
  BUF = { N, g: new Int32Array(N), came: new Int32Array(N), open: new Uint32Array(N), closed: new Uint32Array(N), hk: new Float64Array(4096), hv: new Int32Array(4096), gen: 0, hcache: new Int32Array(N), hgen: new Uint32Array(N) };
  return BUF;
}
export function astarBytes() { return BUF ? BUF.g.byteLength * 6 + BUF.hk.byteLength + BUF.hv.byteLength : 0; }
const KEY_SHIFT = 1048576;
const oct100 = (dx, dy) => (dx > dy ? 100 * dx + 40 * dy : 100 * dy + 40 * dx);

/** 3D A* from `from` to `goal`; heur null (octile + VERT x |dz|) or a linkHeuristic(). */
export function astar(w, walk, from, goal, cap = 1e9, heur = null) {
  const { W, PLANE, N, ter } = w;
  const B = buffers(N);
  const { g, came, open, closed } = B;
  if (++B.gen >= 0xfffffff0) { open.fill(0); closed.fill(0); B.gen = 1; }
  const gen = B.gen;
  const gz = (goal / PLANE) | 0, gr = goal - gz * PLANE, gx = gr % W, gy = (gr / W) | 0;
  const hOct = (i) => { const z = (i / PLANE) | 0, r = i - z * PLANE; return oct100(Math.abs((r % W) - gx), Math.abs(((r / W) | 0) - gy)) + VERT * Math.abs(z - gz); };
  const hOf = heur ? (i) => heur.h(i) : hOct;
  let hk = B.hk, hv = B.hv, n = 0, heapMax = 0;
  const push = (k, v) => {
    if (n >= hk.length) { const a = new Float64Array(hk.length * 2); a.set(hk); const b = new Int32Array(hv.length * 2); b.set(hv); B.hk = hk = a; B.hv = hv = b; }
    let p = n++;
    while (p > 0) { const q = (p - 1) >> 1; if (hk[q] < k || (hk[q] === k && hv[q] <= v)) break; hk[p] = hk[q]; hv[p] = hv[q]; p = q; }
    hk[p] = k; hv[p] = v;
    if (n > heapMax) heapMax = n;
  };
  const pop = () => {
    const top = hv[0], k = hk[--n], v = hv[n];
    let p = 0;
    for (;;) {
      const l = 2 * p + 1; if (l >= n) break;
      const r = l + 1, m = r < n && (hk[r] < hk[l] || (hk[r] === hk[l] && hv[r] < hv[l])) ? r : l;
      if (hk[m] > k || (hk[m] === k && hv[m] >= v)) break;
      hk[p] = hk[m]; hv[p] = hv[m]; p = m;
    }
    hk[p] = k; hv[p] = v; return top;
  };
  g[from] = 0; came[from] = -1; open[from] = gen;
  push(hOf(from) * KEY_SHIFT, from);
  let expanded = 0;
  const relax = (cur, nb, step) => {
    const ng = g[cur] + step;
    if (closed[nb] === gen) return;
    if (open[nb] !== gen || ng < g[nb]) { open[nb] = gen; g[nb] = ng; came[nb] = cur; const h = hOf(nb); push((ng + h) * KEY_SHIFT + h, nb); }
  };
  while (n > 0) {
    const cur = pop();
    if (closed[cur] === gen) continue;
    closed[cur] = gen;
    if (cur === goal) { let len = 0; for (let t = cur; t !== from; t = came[t]) len++; return { status: 'ok', len, cost: g[cur], expanded, heapMax }; }
    if (expanded >= cap) return { status: 'trunc', expanded, heapMax };
    expanded++;
    const z = (cur / PLANE) | 0, r = cur - z * PLANE, cx = r % W, cy = (r / W) | 0;
    for (let d = 0; d < 8; d++) {
      const nx = cx + DX8[d], ny = cy + DY8[d];
      if (nx < 0 || ny < 0 || nx >= W || ny >= w.H) continue;
      const nb = cur + DY8[d] * W + DX8[d], c = walk[nb];
      if (!c) continue;
      if (d >= 4 && (!walk[cur + DX8[d]] || !walk[cur + DY8[d] * W])) continue;
      relax(cur, nb, d < 4 ? c * 10 : c * 14);
    }
    if (UPSET[ter[cur]] && cur + PLANE < N && DOWNSET[ter[cur + PLANE]]) relax(cur, cur + PLANE, VERT);
    if (DOWNSET[ter[cur]] && cur >= PLANE && UPSET[ter[cur - PLANE]]) relax(cur, cur - PLANE, VERT);
  }
  return { status: 'fail', expanded, heapMax };
}

/** The link heuristic toward `goal` (Dijkstra over (link, side) nodes from the goal region; F4). */
export function linkHeuristic(w, lab, G, goal, stats = {}) {
  const t0 = performance.now();
  const { W, PLANE } = w;
  const { links, regLinks } = G;
  const octT = (a, b) => {
    const za = (a / PLANE) | 0, zb = (b / PLANE) | 0, ra = a - za * PLANE, rb = b - zb * PLANE;
    return oct100(Math.abs((ra % W) - (rb % W)), Math.abs(((ra / W) | 0) - ((rb / W) | 0))) + VERT * Math.abs(za - zb);
  };
  const cost = new Float64Array(2 * links.length).fill(Infinity);
  const tileOf = (node) => (node & 1 ? links[node >> 1].tb : links[node >> 1].ta);
  const regOf = (node) => (node & 1 ? links[node >> 1].b : links[node >> 1].a);
  const gReg = lab[goal];
  let hk = new Float64Array(64), hv = new Int32Array(64), n = 0;
  const push = (k, v) => { if (n >= hk.length) { const a = new Float64Array(hk.length * 2); a.set(hk); hk = a; const b = new Int32Array(hv.length * 2); b.set(hv); hv = b; } let p = n++; while (p > 0) { const q = (p - 1) >> 1; if (hk[q] <= k) break; hk[p] = hk[q]; hv[p] = hv[q]; p = q; } hk[p] = k; hv[p] = v; };
  const pop = () => { const top = hv[0], k = hk[--n], v = hv[n]; let p = 0; for (;;) { const l = 2 * p + 1; if (l >= n) break; const r = l + 1, m = r < n && hk[r] < hk[l] ? r : l; if (hk[m] >= k) break; hk[p] = hk[m]; hv[p] = hv[m]; p = m; } hk[p] = k; hv[p] = v; return top; };
  for (const li of regLinks.get(gReg) || []) {
    const lk = links[li];
    const near = lk.a === gReg ? 2 * li : 2 * li + 1, far = near ^ 1;
    const c0 = octT(tileOf(near), goal);
    if (c0 < cost[near]) cost[near] = c0;
    const c1 = c0 + lk.cross;
    if (c1 < cost[far]) { cost[far] = c1; push(c1, far); }
  }
  let settled = 0;
  while (n) {
    const node = pop(); const c = cost[node];
    settled++;
    const r = regOf(node), t = tileOf(node);
    for (const mi of regLinks.get(r) || []) {
      if (mi === node >> 1) continue;
      const mk = links[mi];
      const near = mk.a === r ? 2 * mi : 2 * mi + 1, far = near ^ 1;
      const cn = c + octT(tileOf(near), t);
      if (cn < cost[near]) cost[near] = cn;
      const cf = cn + mk.cross;
      if (cf < cost[far]) { cost[far] = cf; push(cf, far); }
    }
  }
  stats.dijkstraMs = performance.now() - t0; stats.settled = settled;
  const B = buffers(w.N);
  const hgen = ++B.hgenN || (B.hgenN = 1);
  const hc = B.hcache, hg = B.hgen;
  return {
    cost, tileOf, regOf, gReg, goal,
    h(i) {
      if (hg[i] === hgen) return hc[i];
      const r = lab[i];
      let best;
      if (r === gReg) best = octT(i, goal);
      else {
        best = 1e9;
        const ls = regLinks.get(r);
        if (ls) for (const li of ls) { const lk = links[li]; const node = lk.a === r ? 2 * li : 2 * li + 1; const c = cost[node]; if (c < 1e9) { const v = c + octT(i, tileOf(node)); if (v < best) best = v; } }
        best = best >= 1e9 ? octT(i, goal) : Math.max(octT(i, goal), Math.round(best));
      }
      hg[i] = hgen; hc[i] = best;
      return best;
    },
  };
}

const BUCKETS = 512, BMASK = BUCKETS - 1;
/** Whole-map 3D bucket-queue flow field (the design replaces it with hierarchical flow; kept as the reference). */
export function flowField(w, walk, goals, f = new Uint16Array(w.N), pool = {}) {
  const { W, H, PLANE, N, ter } = w;
  f.fill(0xffff);
  if (!pool.tile) { pool.tile = new Int32Array(1 << 16); pool.next = new Int32Array(1 << 16); pool.heads = new Int32Array(BUCKETS); }
  let tile = pool.tile, next = pool.next; const heads = pool.heads; heads.fill(-1);
  let free = 0, count = 0;
  const push = (i, c) => {
    if (free >= tile.length) { const a = new Int32Array(tile.length * 2); a.set(tile); pool.tile = tile = a; const b = new Int32Array(next.length * 2); b.set(next); pool.next = next = b; }
    const b = c & BMASK; tile[free] = i; next[free] = heads[b]; heads[b] = free++; count++;
  };
  for (const gt of goals) { f[gt] = 0; push(gt, 0); }
  let cur = 0, visited = 0;
  while (count) {
    let e = heads[cur & BMASK];
    while (e < 0) { cur++; e = heads[cur & BMASK]; }
    heads[cur & BMASK] = next[e]; count--;
    const i = tile[e];
    if (f[i] !== cur) continue;
    visited++;
    const z = (i / PLANE) | 0, r = i - z * PLANE, x = r % W, y = (r / W) | 0;
    const ci = walk[i];
    for (let d = 0; d < 8; d++) {
      const nx = x + DX8[d], ny = y + DY8[d];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = i + DY8[d] * W + DX8[d];
      if (!walk[j]) continue;
      if (d >= 4 && (!walk[i + DX8[d]] || !walk[i + DY8[d] * W])) continue;
      const nc = cur + (d < 4 ? ci : ((ci * 14 + 5) / 10) | 0);
      if (nc < f[j]) { f[j] = nc; push(j, nc); }
    }
    if (UPSET[ter[i]] && i + PLANE < N && DOWNSET[ter[i + PLANE]]) { const j = i + PLANE, nc = cur + VERT / 10; if (nc < f[j]) { f[j] = nc; push(j, nc); } }
    if (DOWNSET[ter[i]] && i >= PLANE && UPSET[ter[i - PLANE]]) { const j = i - PLANE, nc = cur + VERT / 10; if (nc < f[j]) { f[j] = nc; push(j, nc); } }
  }
  return { f, visited };
}

const LF = { c: new Int32Array(256), q: new Int32Array(4096) };
/** One region's local field (hierarchical flow, F5): cluster-local typed arrays; returns voxels settled. */
export function localFieldTyped(w, walk, lab, G, Hh, r, out = LF.c) {
  const { W, PLANE } = w, CWn = W / CL;
  const cl = ((r - 1) / LOCAL) | 0, z = (cl / (CWn * (w.H / CL))) | 0, rr = cl % (CWn * (w.H / CL));
  const x0 = (rr % CWn) * CL, y0 = ((rr / CWn) | 0) * CL, base = z * PLANE + y0 * W + x0;
  out.fill(0x3fffffff);
  const q = LF.q; let qh = 0, qt = 0;
  const loc = (i) => { const o = i - base; return ((o / W) | 0) * CL + (o % W); };
  const seed = (t, c) => { const l = loc(t); if (c < out[l]) { out[l] = c; q[qt++ & 4095] = l; } };
  if (r === Hh.gReg) seed(Hh.goal, 0);
  for (const li of G.regLinks.get(r) || []) { const lk = G.links[li]; const node = lk.a === r ? 2 * li : 2 * li + 1; const c = Hh.cost[node]; if (c < 1e9) seed(Hh.tileOf(node), c); }
  let n = 0;
  while (qh !== qt) {
    const l = q[qh++ & 4095], c = out[l], lx = l & 15, ly = l >> 4, i = base + ly * W + lx; n++;
    for (let d = 0; d < 8; d++) {
      const dx = DX8[d], dy = DY8[d];
      const nx = lx + dx, ny = ly + dy; if (nx < 0 || ny < 0 || nx > 15 || ny > 15) continue;
      const j = i + dy * W + dx; if (lab[j] !== r) continue;
      if (d >= 4 && (!walk[i + dx] || !walk[i + dy * W])) continue;
      const nl = ny * 16 + nx, nc = c + (d < 4 ? walk[j] * 10 : walk[j] * 14);
      if (nc < out[nl]) { out[nl] = nc; q[qt++ & 4095] = nl; }
    }
  }
  return n;
}

// ==== One-level renderer (proto/render.mjs) ==========================================================
const PX = 16;
const COL = {
  [TER.AIR]: '#0c0d14', [TER.ROCK]: '#5d5866', [TER.SOIL]: '#6b4f3a', [TER.FLOOR]: '#8a8494', [TER.GRASS]: '#4f7a3a',
  [TER.STAIR_U]: '#a39a7d', [TER.STAIR_D]: '#a39a7d', [TER.STAIR_UD]: '#a39a7d', [TER.RAMP]: '#7f8a5a', [TER.RAMP_TOP]: '#3f4a2a',
  [TER.WATER]: '#2c5a8a', [TER.TREE]: '#2f5a2a', [TER.WALL]: '#77707f',
};
const STONE = ['#5d5866', '#6a6472', '#57606a', '#625a52', '#4c4a58', '#6e5f5a', '#4a5560'];
const ORE = ['', '#d8b04a', '#c06a3a', '#9ad0d8', '#d0d0d8', '#7ad07a', '#b07ad0'];
const phash = (i, k) => { let h = Math.imul(i ^ (k * 0x9e3779b9), 2654435761); h ^= h >>> 15; return (h >>> 0) / 4294967296; };

export class LevelRenderer {
  constructor(w, cfg = {}) {
    this.w = w; this.cfg = Object.assign({ lru: 96, belowDepth: 1, prefetch: false, bakesPerFrame: 1 }, cfg);
    this.held = new Map(); this.ph = new Map();
    this.st = { bakes: 0, bakeMs: 0, bakeMax: 0, phBuilds: 0, phMs: 0, evict: 0, prefetched: 0 };
    this.bakeTimes = [];
  }
  key(z, band, cx, cy) { return ((z * 2 + band) * 64 + cy) * 64 + cx; }
  paintTile(g, x, y, z, depth = 0) {
    const w = this.w, i = z * w.PLANE + y * w.W + x, t = w.ter[i], px = x * PX, py = y * PX;
    if (t === TER.AIR) {
      if (z > 0 && depth < this.cfg.belowDepth) {
        this.paintTile(g, x, y, z - 1, depth + 1);
        g.fillStyle = depth === 0 ? 'rgba(8,10,20,0.55)' : 'rgba(8,10,20,0.35)'; g.fillRect(px, py, PX, PX);
        const W = w.W;
        if (y > 0 && w.ter[i - W] !== TER.AIR) { g.fillStyle = '#2a2730'; g.fillRect(px, py, PX, 2); }
        if (x > 0 && w.ter[i - 1] !== TER.AIR) { g.fillStyle = '#2a2730'; g.fillRect(px, py, 2, PX); }
      } else { g.fillStyle = COL[TER.AIR]; g.fillRect(px, py, PX, PX); }
      return;
    }
    if (t === TER.ROCK || t === TER.SOIL) {
      g.fillStyle = t === TER.SOIL ? COL[TER.SOIL] : STONE[w.mat[i] % STONE.length]; g.fillRect(px, py, PX, PX);
      const W = w.W, open = (j) => { const tt = w.ter[j]; return tt !== TER.ROCK && tt !== TER.SOIL; };
      g.fillStyle = '#3a3642';
      if (y < w.H - 1 && open(i + W)) g.fillRect(px, py + PX - 4, PX, 4);
      if (y > 0 && open(i - W)) g.fillRect(px, py, PX, 2);
      if (x > 0 && open(i - 1)) g.fillRect(px, py, 2, PX);
      if (x < W - 1 && open(i + 1)) g.fillRect(px + PX - 2, py, 2, PX);
      for (let k = 0; k < 3; k++) { g.fillStyle = k ? '#6f6a78' : '#4e4a56'; g.fillRect(px + ((phash(i, k) * 13) | 0), py + ((phash(i, k + 5) * 13) | 0), 2, 2); }
      if (w.ore[i]) { g.fillStyle = ORE[w.ore[i]]; g.fillRect(px + 4, py + 5, 2, 2); g.fillRect(px + 10, py + 9, 2, 2); g.fillRect(px + 7, py + 12, 1, 1); }
      return;
    }
    g.fillStyle = COL[t] || '#f0f'; g.fillRect(px, py, PX, PX);
    for (let k = 0; k < 4; k++) { g.fillStyle = k & 1 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.12)'; g.fillRect(px + ((phash(i, k) * 14) | 0), py + ((phash(i, k + 9) * 14) | 0), 2, 1); }
    if (t >= TER.STAIR_U && t <= TER.STAIR_UD) {
      g.fillStyle = '#3c3830';
      for (let k = 0; k < 4; k++) g.fillRect(px + 2, py + 2 + k * 3, PX - 4, 1);
      g.fillStyle = '#e8d8a0';
      if (t !== TER.STAIR_D) g.fillRect(px + 6, py + 1, 4, 2);
      if (t !== TER.STAIR_U) g.fillRect(px + 6, py + 13, 4, 2);
    } else if (t === TER.RAMP || t === TER.RAMP_TOP) {
      g.fillStyle = t === TER.RAMP ? '#a8b070' : '#6a7040';
      for (let k = 0; k < 3; k++) g.fillRect(px + 3 + k * 3, py + 12 - k * 4, 3, 3);
    } else if (t === TER.TREE) { g.fillStyle = '#1f3f1a'; g.fillRect(px + 3, py + 2, 10, 9); g.fillStyle = '#5a3a20'; g.fillRect(px + 7, py + 11, 2, 4); }
  }
  bake(z, band, cx, cy) {
    const T = band === 0 ? 8 : 16;
    const t0 = performance.now();
    const c = document.createElement('canvas'); c.width = T * PX; c.height = T * PX;
    const g = c.getContext('2d');
    g.translate(-cx * T * PX, -cy * T * PX);
    for (let y = cy * T; y < cy * T + T; y++) for (let x = cx * T; x < cx * T + T; x++) this.paintTile(g, x, y, z);
    const dt = performance.now() - t0;
    this.st.bakes++; this.st.bakeMs += dt; if (dt > this.st.bakeMax) this.st.bakeMax = dt; this.bakeTimes.push(dt);
    this.held.set(this.key(z, band, cx, cy), { c, z, band, cx, cy });
    while (this.held.size > this.cfg.lru) { const [k0, v0] = this.held.entries().next().value; v0.c.width = v0.c.height = 0; this.held.delete(k0); this.st.evict++; }
    return dt;
  }
  placeholder(z) {
    let c = this.ph.get(z); if (c) return c;
    const t0 = performance.now(), w = this.w;
    c = document.createElement('canvas'); c.width = w.W; c.height = w.H;
    const g = c.getContext('2d'), img = g.createImageData(w.W, w.H), d = img.data;
    const rgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
    const tab = {}; for (const k in COL) tab[k] = rgb(COL[k]);
    for (let p = 0; p < w.PLANE; p++) {
      let t = w.ter[z * w.PLANE + p], dim = 1;
      if (t === TER.AIR && z > 0) { t = w.ter[(z - 1) * w.PLANE + p]; dim = 0.45; }
      const c3 = tab[t] || [255, 0, 255];
      d[p * 4] = c3[0] * dim; d[p * 4 + 1] = c3[1] * dim; d[p * 4 + 2] = c3[2] * dim; d[p * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    this.ph.set(z, c);
    this.st.phBuilds++; this.st.phMs += performance.now() - t0;
    while (this.ph.size > 6) { const k0 = this.ph.keys().next().value; this.ph.get(k0).width = 0; this.ph.delete(k0); }
    return c;
  }
  draw(g, cam, z, entities, idle) {
    const t0 = performance.now();
    const band = cam.zoom >= 0.75 ? 0 : 1, T = band === 0 ? 8 : 16, U = 32;
    const cw = g.canvas.width, ch = g.canvas.height, dpr = cam.dpr;
    const vw = cw / dpr / cam.zoom, vh = ch / dpr / cam.zoom;
    const x0 = cam.x - vw / 2, y0 = cam.y - vh / 2;
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#17151f'; g.fillRect(0, 0, cw, ch);
    const s = dpr * cam.zoom;
    g.setTransform(s, 0, 0, s, -x0 * s, -y0 * s);
    g.imageSmoothingEnabled = false;
    const cx0 = Math.max(0, Math.floor(x0 / (T * U))), cy0 = Math.max(0, Math.floor(y0 / (T * U)));
    const cx1 = Math.min(this.w.W / T - 1, Math.floor((x0 + vw) / (T * U))), cy1 = Math.min(this.w.H / T - 1, Math.floor((y0 + vh) / (T * U)));
    const missing = [];
    let ph = null, phRects = 0;
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const k = this.key(z, band, cx, cy), v = this.held.get(k);
      if (v) { this.held.delete(k); this.held.set(k, v); g.drawImage(v.c, cx * T * U, cy * T * U, T * U, T * U); }
      else {
        ph = ph || this.placeholder(z);
        g.drawImage(ph, cx * T, cy * T, T, T, cx * T * U, cy * T * U, T * U, T * U); phRects++;
        const dx = (cx + 0.5) * T * U - cam.x, dy = (cy + 0.5) * T * U - cam.y; missing.push([dx * dx + dy * dy, cx, cy]);
      }
    }
    let bakeMs = 0, baked = 0;
    missing.sort((a, b) => a[0] - b[0]);
    for (let k = 0; k < missing.length && baked < this.cfg.bakesPerFrame; k++) { bakeMs += this.bake(z, band, missing[k][1], missing[k][2]); baked++; }
    if (idle && this.cfg.prefetch && !missing.length) {
      outer: for (const zz of [z - 1, z + 1]) {
        if (zz < 0 || zz >= this.w.D) continue;
        for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) if (!this.held.has(this.key(zz, band, cx, cy))) { bakeMs += this.bake(zz, band, cx, cy); this.st.prefetched++; break outer; }
      }
    }
    let shown = 0;
    for (const e of entities) {
      if (e.z !== z) continue;
      if (e.x < x0 - U || e.y < y0 - U || e.x > x0 + vw + U || e.y > y0 + vh + U) continue;
      g.fillStyle = e.c; g.fillRect(e.x - 8, e.y - 20, 16, 20); g.fillStyle = '#f0d8b0'; g.fillRect(e.x - 5, e.y - 26, 10, 8); g.fillStyle = '#222'; g.fillRect(e.x - 8, e.y, 16, 3);
      shown++;
    }
    g.globalAlpha = 0.25; g.drawImage(ph || this.placeholder(z), 0, 0, this.w.W, this.w.H, 0, 0, this.w.W * U, this.w.H * U); g.globalAlpha = 1;
    return { ms: performance.now() - t0, bakeMs, baked, missing: missing.length - baked, phRects, shown, held: this.held.size };
  }
  canvasBytes() { let b = 0; for (const v of this.held.values()) b += v.c.width * v.c.height * 4; for (const c of this.ph.values()) b += c.width * c.height * 4; return b; }
  dispose() { for (const v of this.held.values()) v.c.width = v.c.height = 0; for (const c of this.ph.values()) c.width = c.height = 0; this.held.clear(); this.ph.clear(); }
}

// ==== References: PROTO's Chromium figures (desktop, DPR 2, seed 99, D = 20) and the doc's A15 estimates (6.x)
// `proto` is what tools/spike/run.mjs --browser=chromium must reproduce within +-30% (the S9.1 oracle);
// `a15` is the estimate the iPhone report is judged against (worse than 1.5x on any row: revise the doc before E1).
export const REF = Object.freeze({
  mapgenMs: { proto: 45, a15: 240, node: true, protoFrom: 'Node (PROTO 4 regenWorldMs, D=20); no Chromium figure', unit: 'ms' },
  labelAllMs: { proto: 2.06, a15: 4.1, unit: 'ms' },
  graphMs: { proto: 2.68, a15: 5.3, unit: 'ms' },
  oneClusterUs: { proto: 2.5, a15: 5, unit: 'us' },
  linkP95Ms: { proto: 0.6, a15: 1.2, unit: 'ms' },
  linkMaxMs: { proto: 1.7, a15: 4.3, unit: 'ms' },
  linkExpP95: { proto: 588, exact: true, unit: 'nodes' },
  linkExpMax: { proto: 2618, exact: true, unit: 'nodes' },
  dijkstraP95Ms: { proto: 0.3, a15: 0.4, unit: 'ms' },
  plainP95Ms: { proto: 2.6, a15: 6, unit: 'ms' },
  regionLevelP95Ms: { proto: 0.4, a15: 1.25, unit: 'ms' },
  localFieldUs: { proto: 22.8, a15: 62, unit: 'us' },
  localAllP95Ms: { proto: 1.6, a15: 4, unit: 'ms' },
  wholeFieldP95Ms: { proto: 5.1, a15: 6, unit: 'ms' },
  placeholderMs: { proto: 0.51, a15: 1.6, unit: 'ms' },
  bake16Ms: { proto: 0.43, a15: 2.7, protoFrom: 'fortress level, view below 1 (x2.5 real art x2.5 A15)', unit: 'ms' },
  // a single worst frame (GC and scheduler noise dominate): judged as a budget (<= the 7 ms A15 switch cost of 6.3), not +-30%
  switchFrameMaxMs: { proto: 1.2, a15: 7, budget: true, protoFrom: 'worst frame of 6 switches, zoom 1.25 with pre-bake, 390x664; judged as a budget', unit: 'ms' },
  switchFrames: { proto: 1, a15: 1, exact: true, unit: 'frames' },
  inflateMs: { proto: 4.4, a15: 5, node: true, protoFrom: 'Node inflate of the XOR world (PROTO 4); 5.1 estimates 5 ms on an A15', unit: 'ms' },
});

// ==== The bench ======================================================================================
const pct = (a, p) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))]; };
const r3 = (v) => (v === null || v === undefined || !isFinite(v) ? v : +v.toFixed(3));
const now = () => performance.now();
const tick = () => new Promise((r) => setTimeout(r, 0));
const frame = () => new Promise((r) => requestAnimationFrame(r));

/** performance.now() granularity in ms (Safari rounds to 1 ms; Chromium to 0.1 ms without isolation). */
export function timerResolution() {
  let best = Infinity;
  for (let k = 0; k < 20; k++) { const a = now(); let b = now(); while (b === a) b = now(); if (b - a < best) best = b - a; }
  return +best.toFixed(4);
}

function envInfo() {
  const n = typeof navigator !== 'undefined' ? navigator : {};
  let standalone = false;
  try { standalone = n.standalone === true || (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches); } catch (_) { /* old engines */ }
  return {
    ua: n.userAgent || '', platform: n.platform || '', cores: n.hardwareConcurrency || null, deviceMemoryGB: n.deviceMemory || null,
    dpr: typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, inner: typeof innerWidth === 'number' ? `${innerWidth}x${innerHeight}` : null,
    screen: typeof screen !== 'undefined' ? `${screen.width}x${screen.height}` : null, standalone,
    crossOriginIsolated: typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : null, timerResMs: timerResolution(),
    compressionStream: typeof CompressionStream === 'function',
  };
}

/** Section 1: mapgen of the 128 x 128 x 20 world, then the prototype's dug fortress. */
async function benchMapgen(R) {
  const ms = [];
  let w = null;
  for (let k = 0; k < 4; k++) { const t = now(); w = generate(128, 128, 20, 99); ms.push(now() - t); await tick(); }
  const pristineHash = fnv(w.ter, w.mat, w.ore);
  const t = now(); const fort = digFortress(w, 99); const digMs = now() - t;
  R.world = { W: w.W, H: w.H, D: w.D, N: w.N, zS: w.zS, caverns: w.caverns, mined: fort.mined, pristineHash, worldHash: fnv(w.ter, w.mat, w.ore) };
  R.mapgen = { firstMs: r3(ms[0]), medianMs: r3(pct(ms.slice(1), 0.5)), runs: ms.map(r3), digMs: r3(digMs) };
  return { w, fort };
}

/** Section 2: region relabel (full and one cluster) and the region graph. */
async function benchRegions(R, w, walk) {
  let lab; for (let k = 0; k < 5; k++) { lab = labelAll(w, walk, lab); buildGraph(w, lab); }   // warm, as PROTO
  const st = {}; let t = now();
  for (let k = 0; k < 5; k++) lab = labelAll(w, walk, lab, st);
  const labelAllMs = (now() - t) / 5;
  await tick();
  t = now(); let G; for (let k = 0; k < 5; k++) G = buildGraph(w, lab); const graphMs = (now() - t) / 5;
  const sc = new Int32Array(256); const nC = (w.N / 256) | 0;
  t = now(); for (let k = 0; k < 200; k++) labelCluster(w, walk, lab, (k * 37) % nC, sc); const oneUs = ((now() - t) / 200) * 1000;
  t = now(); for (let k = 0; k < 4000; k++) labelCluster(w, walk, lab, (k * 37) % nC, sc); const oneUsLong = ((now() - t) / 4000) * 1000;
  lab = labelAll(w, walk, lab); G = buildGraph(w, lab);
  R.regions = { labelAllMs: r3(labelAllMs), graphMs: r3(graphMs), oneClusterUs: r3(oneUs), oneClusterUs4000: r3(oneUsLong), clustersSkipped: st.skipped, clustersLabelled: st.labelled, links: G.links.length, vertLinks: G.links.filter((l) => l.vert).length };
  return { lab, G };
}

/** Section 3: 400 seeded pairs on the fortress, link-heuristic A* (with its Dijkstra) and plain A*. */
async function benchPath(R, w, walk, lab, G, fort, timerRes) {
  const hc = G.comp[lab[fort.hearth]];
  const cand = []; for (let i = 0; i < w.N; i++) if (lab[i] && G.comp[lab[i]] === hc) cand.push(i);
  const rng = mulberry32(7);
  const pairs = []; for (let k = 0; k < 400; k++) pairs.push([cand[(rng() * cand.length) | 0], cand[(rng() * cand.length) | 0]]);
  // on a coarse clock (Safari: 1 ms) each search is repeated and the batch divided, so the p95 is not quantised away
  const reps = timerRes > 0.2 ? 10 : 1;
  for (let k = 0; k < 40; k++) astar(w, walk, pairs[k][0], pairs[k][1]);
  await tick();
  const costs = [], plain = { ms: [], exp: [], over: 0 };
  for (let k = 0; k < pairs.length; k++) {
    const [a, b] = pairs[k];
    const t = now(); const p = astar(w, walk, a, b); plain.ms.push(now() - t);
    plain.exp.push(p.expanded); if (p.expanded > 8192) plain.over++; costs.push(p.cost);
    if (k % 50 === 49) await tick();
  }
  for (let k = 0; k < 40; k++) { const H = linkHeuristic(w, lab, G, pairs[k][1]); astar(w, walk, pairs[k][0], pairs[k][1], 1e9, H); }
  const L = { ms: [], dij: [], exp: [], ratio: [], over: 0 };
  for (let k = 0; k < pairs.length; k++) {
    const [a, b] = pairs[k];
    let p = null; const s = {};
    const t = now();
    for (let rr = 0; rr < reps; rr++) { const H = linkHeuristic(w, lab, G, b, s); p = astar(w, walk, a, b, 1e9, H); }
    L.ms.push((now() - t) / reps); L.dij.push(s.dijkstraMs);
    L.exp.push(p.expanded); if (p.expanded > 8192) L.over++;
    L.ratio.push(costs[k] ? p.cost / costs[k] : 1);
    if (k % 25 === 24) await tick();
  }
  R.path = {
    pairs: pairs.length, reachable: cand.length, reps,
    link: { p50Ms: r3(pct(L.ms, 0.5)), p95Ms: r3(pct(L.ms, 0.95)), maxMs: r3(Math.max(...L.ms)), dijkstraP95Ms: r3(pct(L.dij, 0.95)), expP95: pct(L.exp, 0.95), expMax: Math.max(...L.exp), overCap: L.over,
      costRatioMean: r3(L.ratio.reduce((x, y) => x + y, 0) / L.ratio.length), costRatioP95: r3(pct(L.ratio, 0.95)) },
    plain: { p50Ms: r3(pct(plain.ms, 0.5)), p95Ms: r3(pct(plain.ms, 0.95)), maxMs: r3(Math.max(...plain.ms)), expP95: pct(plain.exp, 0.95), expMax: Math.max(...plain.exp), overCap: plain.over },
    astarBuffersMB: r3(astarBytes() / 1048576),
  };
}

/** Section 4: hierarchical flow: the region-level Dijkstra to the Hearth and the local fields on 8 raid routes. */
async function benchFlow(R, w, walk, lab, G, fort) {
  const hearth = fort.hearth;
  let ff, pool = {}, o; const whole = [];
  for (let k = 0; k < 15; k++) { const t = now(); o = flowField(w, walk, [hearth], ff, pool); ff = o.f; if (k >= 5) whole.push(now() - t); }
  await tick();
  const hms = []; let Hh;
  for (let k = 0; k < 40; k++) { const t = now(); Hh = linkHeuristic(w, lab, G, hearth); if (k >= 10) hms.push(now() - t); }
  const full = ff, used = new Set(); let starts = [];
  for (let i = 0; i < w.N; i++) { const r = i % w.PLANE, x = r % w.W, y = (r / w.W) | 0; if ((x === 0 || y === 0 || x === w.W - 1 || y === w.H - 1) && full[i] !== 0xffff && (x * 7 + y * 13) % 41 === 0) starts.push(i); }
  starts = starts.slice(0, 8);
  for (const s of starts) { let i = s, guard = 0; while (full[i] > 0 && guard++ < 5000) { used.add(lab[i]); let best = i; for (const d of [1, -1, w.W, -w.W, w.W + 1, w.W - 1, -w.W + 1, -w.W - 1, w.PLANE, -w.PLANE]) { const j = i + d; if (j >= 0 && j < w.N && full[j] < full[best]) best = j; } if (best === i) break; i = best; } }
  for (let k = 0; k < 3; k++) for (const r of used) localFieldTyped(w, walk, lab, G, Hh, r);
  const tms = []; let settled = 0;
  for (let k = 0; k < 20; k++) { const t = now(); settled = 0; for (const r of used) settled += localFieldTyped(w, walk, lab, G, Hh, r); tms.push(now() - t); }
  R.flow = { wholeP95Ms: r3(pct(whole, 0.95)), visited: o.visited, regionLevelP95Ms: r3(pct(hms, 0.95)), regionsOnRaidRoutes: used.size, localAllP95Ms: r3(pct(tms, 0.95)),
    localFieldUs: r3((pct(tms, 0.5) / Math.max(1, used.size)) * 1000), localSettled: settled };
}

/** Section 5: the one-level renderer at a CSS viewport (vw x vh at `dpr`): bakes, placeholders and 6 level switches. */
async function benchRender(R, w, fort, host, vw, vh, dpr) {
  const cv = document.createElement('canvas');
  cv.width = Math.round(vw * dpr); cv.height = Math.round(vh * dpr);
  cv.style.width = vw + 'px'; cv.style.height = vh + 'px'; cv.style.display = 'block';
  host.appendChild(cv);
  const g = cv.getContext('2d', { alpha: false });
  const out = { viewport: `${vw}x${vh}`, dpr };
  try {
    const [sx, sy] = fort.shaft; const zF = w.zS - 1;
    const rng = mulberry32(3);
    const ents = []; for (let k = 0; k < 30; k++) ents.push({ x: (sx + (rng() * 20 - 10)) * 32, y: (sy + (rng() * 20 - 10)) * 32, z: fort.levels[(rng() * fort.levels.length) | 0], c: '#c08040' });
    for (let k = 0; k < 40; k++) ents.push({ x: (rng() * 60) * 32, y: (rng() * 128) * 32, z: w.zS, c: '#a03030' });
    { // bake cost: fortress level with the view below (16 x 16 tiles, band 1) and 8 x 8 (band 0)
      const Rr = new LevelRenderer(w, { belowDepth: 1, lru: 1000 });
      for (let k = 0; k < 4; k++) Rr.bake(zF, 1, k, 4); Rr.bakeTimes.length = 0;
      for (let cy = 0; cy < 8; cy++) for (let cx = 0; cx < 8; cx++) Rr.bake(zF, 1, cx, cy);
      const b16 = Rr.bakeTimes.slice(); Rr.bakeTimes.length = 0;
      for (let cy = 4; cy < 12; cy++) for (let cx = 4; cx < 12; cx++) Rr.bake(zF, 0, cx, cy);
      const b8 = Rr.bakeTimes.slice();
      out.bake16Ms = r3(b16.reduce((a, b) => a + b, 0) / b16.length); out.bake16P95Ms = r3(pct(b16, 0.95)); out.bake8Ms = r3(b8.reduce((a, b) => a + b, 0) / b8.length);
      Rr.dispose();
      const Rp = new LevelRenderer(w); const t = now(); for (let z = 0; z < w.D; z++) Rp.placeholder(z); out.placeholderMs = r3((now() - t) / w.D); Rp.dispose();
    }
    await tick();
    async function run(cfg, zoom, plan) {
      const Rr = new LevelRenderer(w, cfg);
      const cam = { x: sx * 32, y: sy * 32, zoom, dpr };
      let z = zF; const ms = [], gaps = []; let last = 0; const switches = [];
      for (const step of plan) {
        if (step.z !== undefined) { z = step.z; switches.push({ frames: 0, maxMs: 0, done: false }); }
        for (let f = 0; f < step.frames; f++) {
          if (step.pan) { cam.x += 6; cam.y += Math.sin(f / 20) * 4; }
          const ts = await frame(); if (last) gaps.push(ts - last); last = ts;
          const r = Rr.draw(g, cam, z, ents, !step.pan);
          ms.push(r.ms);
          const s = switches[switches.length - 1];
          if (s && !s.done) { s.frames++; s.maxMs = Math.max(s.maxMs, r.ms); if (r.missing === 0 && r.phRects === 0) s.done = true; }
        }
      }
      const res = { frameP50Ms: r3(pct(ms, 0.5)), frameP95Ms: r3(pct(ms, 0.95)), frameMaxMs: r3(Math.max(...ms)), rafGapP95Ms: r3(pct(gaps, 0.95)), bakes: Rr.st.bakes, bakeAvgMs: r3(Rr.st.bakeMs / Math.max(1, Rr.st.bakes)),
        prefetched: Rr.st.prefetched, canvasMB: r3(Rr.canvasBytes() / 1048576), switchFramesToFull: switches.map((s) => (s.done ? s.frames : -s.frames)), switchMaxMs: r3(Math.max(0, ...switches.map((s) => s.maxMs))) };
      Rr.dispose();
      return res;
    }
    const sw = (zs, idle) => { const p = [{ frames: 60, pan: true }]; for (const zz of zs) { if (idle) p.push({ frames: idle }); p.push({ z: zz, frames: 45, pan: false }); p.push({ frames: 30, pan: true }); } return p; };
    const seq = [zF - 1, zF - 2, zF - 1, zF, w.zS, zF];
    out.noPrebake_z1_25 = await run({ prefetch: false }, 1.25, sw(seq, 0));
    out.prebake_z1_25 = await run({ prefetch: true }, 1.25, sw(seq, 30));
    out.prebake_z0_6 = await run({ prefetch: true }, 0.6, sw(seq, 30));
  } finally { cv.width = cv.height = 0; cv.remove(); }
  (R.render = R.render || {})[`${vw}x${vh}`] = out;
}

/** Section 6: deflate and inflate of the dug world's 10 u8 layers plus 2 bitsets (about 3.3 MB raw). */
async function benchInflate(R, w) {
  if (typeof CompressionStream !== 'function' || typeof DecompressionStream !== 'function') { R.inflate = { unavailable: 'CompressionStream is missing (iOS before 16.4)' }; return; }
  const { N, PLANE, W, zS } = w;
  const L = [w.ter, w.mat, w.ore]; for (let k = 0; k < 7; k++) L.push(new Uint8Array(N));
  const rng = mulberry32(3);
  for (let c = 0; c < PLANE; c++) { const z = w.height[c], i = z * PLANE + c; if (w.ter[i] === TER.GRASS && rng() < 0.35) { L[5][i] = 1 + ((rng() * 12) | 0); L[6][i] = (rng() * 256) | 0; } if (z === zS && (c % W) < 6 && rng() < 0.5) L[7][i] = (rng() * 4) | 0; }
  for (let i = 0; i < N; i++) if (w.ter[i] === TER.FLOOR) { const h = Math.imul(i, 2654435761) >>> 0; if (h % 7 === 0) L[3][i] = 1 + (h % 5); if (h % 5 === 0) L[8][i] = 1 + (h % 9); }
  const bits = new Uint8Array(N >> 3); for (let i = 0; i < N; i++) { const t = w.ter[i]; if (t >= 3 && t <= 9) bits[i >> 3] |= 1 << (i & 7); }
  L.push(bits, bits.slice());
  const raw = new Uint8Array(L.reduce((a, x) => a + x.length, 0)); { let o = 0; for (const x of L) { raw.set(x, o); o += x.length; } }
  const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
  let t = now(); const def = await pipe(raw, new CompressionStream('deflate-raw')); const deflateMs = now() - t;
  const inf = []; let back = null;
  for (let k = 0; k < 6; k++) { t = now(); back = await pipe(def, new DecompressionStream('deflate-raw')); inf.push(now() - t); }
  let same = back.length === raw.length; for (let i = 0; same && i < raw.length; i += 4093) if (back[i] !== raw[i]) same = false;
  R.inflate = { rawKB: +(raw.length / 1024).toFixed(1), deflatedKB: +(def.length / 1024).toFixed(1), deflateMs: r3(deflateMs), inflateMedianMs: r3(pct(inf.slice(1), 0.5)), inflateFirstMs: r3(inf[0]), roundTrip: same,
    note: 'async CompressionStream timing (includes stream overhead); E8 inflates the stored pristine world the same way' };
}

/**
 * Section 7: canvas-memory ceiling. Allocates 1024 x 1024 canvases (4 MB each) until getContext fails or a
 * drawn pixel does not read back, or `maxMB` is reached, then frees them. iOS Safari refuses new canvas
 * memory past its limit (getContext returns null) or ends the tab: `onStep(mb)` saves the progress first,
 * so a reload can report the last size reached.
 */
async function benchCanvasCeiling(R, maxMB, onStep) {
  const held = []; let mb = 0, stop = 'reached maxMB';
  try {
    while (mb + 4 <= maxMB) {
      const c = document.createElement('canvas'); c.width = 1024; c.height = 1024;
      const g = c.getContext('2d');
      if (!g) { stop = 'getContext returned null'; break; }
      g.fillStyle = '#7f3f1f'; g.fillRect(0, 0, 1024, 1024);
      const px = g.getImageData(1023, 1023, 1, 1).data;
      if (px[0] !== 0x7f || px[3] !== 255) { stop = 'a drawn pixel did not read back'; c.width = c.height = 0; break; }
      held.push(c); mb += 4;
      if (mb % 32 === 0) { if (onStep) onStep(mb); await tick(); }
    }
  } catch (e) { stop = 'threw: ' + (e && e.message ? e.message : e); }
  for (const c of held) c.width = c.height = 0;
  R.canvasCeiling = { maxMB, reachedMB: mb, stoppedBecause: stop, note: mb >= maxMB ? `no ceiling below ${maxMB} MB` : `ceiling about ${mb} MB of 2D canvas backing stores` };
}

/** Rows comparing the measured values to PROTO (Chromium) and to the A15 estimates. */
export function compare(R) {
  const v = {
    mapgenMs: R.mapgen && R.mapgen.medianMs, labelAllMs: R.regions && R.regions.labelAllMs, graphMs: R.regions && R.regions.graphMs, oneClusterUs: R.regions && R.regions.oneClusterUs,
    linkP95Ms: R.path && R.path.link.p95Ms, linkMaxMs: R.path && R.path.link.maxMs, linkExpP95: R.path && R.path.link.expP95, linkExpMax: R.path && R.path.link.expMax, dijkstraP95Ms: R.path && R.path.link.dijkstraP95Ms,
    plainP95Ms: R.path && R.path.plain.p95Ms, regionLevelP95Ms: R.flow && R.flow.regionLevelP95Ms, localFieldUs: R.flow && R.flow.localFieldUs, localAllP95Ms: R.flow && R.flow.localAllP95Ms,
    wholeFieldP95Ms: R.flow && R.flow.wholeP95Ms, inflateMs: R.inflate && R.inflate.inflateMedianMs,
  };
  const p = R.render && R.render['390x664'];
  if (p) { v.placeholderMs = p.placeholderMs; v.bake16Ms = p.bake16Ms; v.switchFrameMaxMs = p.prebake_z1_25.switchMaxMs; v.switchFrames = Math.max(...p.prebake_z1_25.switchFramesToFull.map(Math.abs)); }
  const rows = [];
  for (const [k, ref] of Object.entries(REF)) {
    const m = v[k];
    if (m === undefined || m === null) continue;
    const vsProto = ref.proto ? +(m / ref.proto).toFixed(2) : null;
    const vsA15 = ref.a15 ? +(m / ref.a15).toFixed(2) : null;
    rows.push({ metric: k, unit: ref.unit, measured: m, proto: ref.proto, vsProto, a15: ref.a15 ?? null, vsA15, exact: !!ref.exact, protoIsNode: !!ref.node, budget: !!ref.budget, worseThan1_5xA15: vsA15 !== null && vsA15 > 1.5, protoFrom: ref.protoFrom || 'PROTO Chromium (desktop, DPR 2)' });
  }
  return rows;
}

/**
 * Run every section. opts: host (element for the render canvases), onProgress(text), onSave(partialReport),
 * probeMB (canvas probe cap; 0 skips it), dpr (render DPR; default devicePixelRatio, at most 3), sections.
 * Returns the report (plain JSON).
 */
export async function runBench({ host = null, onProgress = () => {}, onSave = () => {}, probeMB = 1024, dpr = null, sections = null } = {}) {
  const t0 = now();
  const on = (s) => !sections || sections.includes(s);
  const R = { page: 'spike/z.html', version: 1, started: new Date().toISOString(), env: envInfo(), done: [] };
  const D = Math.min(3, dpr || R.env.dpr || 1);
  onProgress('Generating the 128 x 128 x 20 world');
  await tick();
  const { w, fort } = await benchMapgen(R); R.done.push('mapgen'); onSave(R);
  const walk = walkOf(w);
  let lab = null, G = null;
  if (on('regions') || on('path') || on('flow')) { onProgress('Region relabel and graph'); await tick(); ({ lab, G } = await benchRegions(R, w, walk)); R.done.push('regions'); onSave(R); }
  if (on('path')) { onProgress('Link A* on 400 pairs (and plain A*)'); await tick(); await benchPath(R, w, walk, lab, G, fort, R.env.timerResMs); R.done.push('path'); onSave(R); }
  if (on('flow')) { onProgress('Hierarchical flow: region level and local fields'); await tick(); await benchFlow(R, w, walk, lab, G, fort); R.done.push('flow'); onSave(R); }
  if (on('render') && host) {
    for (const [vw, vh] of [[390, 664], [844, 335]]) { onProgress(`Level switches at ${vw} x ${vh}`); await tick(); await benchRender(R, w, fort, host, vw, vh, D); }
    R.done.push('render'); onSave(R);
  }
  if (on('inflate')) { onProgress('Inflate of a 3 MB world'); await tick(); await benchInflate(R, w); R.done.push('inflate'); onSave(R); }
  R.simBytesMB = r3((w.ter.byteLength * 3 + walk.byteLength + (lab ? lab.byteLength : 0) + astarBytes()) / 1048576);
  R.compare = compare(R);
  if (on('canvas') && probeMB > 0) {
    onProgress('Canvas-memory ceiling probe (last: if the page reloads, it reports the size reached)');
    R.canvasProbeRunning = true; onSave(R);
    await benchCanvasCeiling(R, probeMB, (mb) => { R.canvasProbeAt = mb; onSave(R); });
    delete R.canvasProbeRunning; delete R.canvasProbeAt; R.done.push('canvas');
  }
  R.totalS = +((now() - t0) / 1000).toFixed(1);
  R.finished = new Date().toISOString();
  onSave(R);
  return R;
}
