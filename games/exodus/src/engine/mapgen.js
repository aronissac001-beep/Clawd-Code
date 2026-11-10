// ===== mapgen.js : procedural world generation =====
function makeNoise3(rng) {
  const base = []; for (let i = 0; i < 256; i++) base.push(i); rng.shuffle(base);
  const p = new Uint8Array(512); for (let i = 0; i < 512; i++) p[i] = base[i & 255];
  const G3 = [1,1,0, -1,1,0, 1,-1,0, -1,-1,0, 1,0,1, -1,0,1, 1,0,-1, -1,0,-1, 0,1,1, 0,-1,1, 0,1,-1, 0,-1,-1];
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + (b - a) * t;
  const gr = (h, x, y, z) => { const o = (h % 12) * 3; return G3[o] * x + G3[o + 1] * y + G3[o + 2] * z; };
  return function (x, y, z) {
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    x -= X; y -= Y; z -= Z;
    const xi = X & 255, yi = Y & 255, zi = Z & 255;
    const u = fade(x), v = fade(y), w = fade(z);
    const A = p[xi] + yi, AA = p[A] + zi, AB = p[A + 1] + zi, B = p[xi + 1] + yi, BA = p[B] + zi, BB = p[B + 1] + zi;
    return lerp(
      lerp(lerp(gr(p[AA], x, y, z), gr(p[BA], x - 1, y, z), u), lerp(gr(p[AB], x, y - 1, z), gr(p[BB], x - 1, y - 1, z), u), v),
      lerp(lerp(gr(p[AA + 1], x, y, z - 1), gr(p[BA + 1], x - 1, y, z - 1), u), lerp(gr(p[AB + 1], x, y - 1, z - 1), gr(p[BB + 1], x - 1, y - 1, z - 1), u), v),
      w);
  };
}
function fbm3(n, x, y, z, oct) {
  let a = 1, f = 1, s = 0, m = 0;
  for (let o = 0; o < oct; o++) { s += a * n(x * f + o * 17.3, y * f, z * f); m += a; a *= 0.5; f *= 2.03; }
  return s / m;
}
// Sample noise on a cylinder so the map wraps seamlessly east-west.
function cyl(W, c, r, freq) {
  const px = c + 0.5 * (r & 1), a = px / W * Math.PI * 2, Rc = W / (Math.PI * 2);
  return [Math.cos(a) * Rc * freq, Math.sin(a) * Rc * freq, r * 0.866 * freq];
}
function wrapDelta(d, W) { d = ((d % W) + W) % W; return d > W / 2 ? d - W : d; }
function quantile(arr, q) { const s = Float32Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)))]; }

function components(g, mask) {
  const id = new Int32Array(g.N).fill(-1), sizes = [];
  for (let i = 0; i < g.N; i++) {
    if (!mask[i] || id[i] >= 0) continue;
    const cid = sizes.length, st = [i]; id[i] = cid; let n = 0;
    while (st.length) { const t = st.pop(); n++; for (let d = 0; d < 6; d++) { const k = g.nb[t * 6 + d]; if (k >= 0 && mask[k] && id[k] < 0) { id[k] = cid; st.push(k); } } }
    sizes.push(n);
  }
  return { id, sizes };
}

function makeCenters(key, W, H, rng) {
  const cs = [];
  if (key === 'continents') {
    const k = W >= 70 ? 3 : (rng.chance(0.5) ? 3 : 2), x0 = rng.range(0, W);
    for (let i = 0; i < k; i++) cs.push({ x: x0 + i * W / k + rng.range(-W / k * 0.12, W / k * 0.12), y: H * rng.range(0.38, 0.62), rx: W / k * 0.40, ry: H * 0.40 });
  } else if (key === 'pangaea') {
    const x0 = rng.range(0, W);
    cs.push({ x: x0, y: H * 0.5, rx: W * 0.33, ry: H * 0.44 });
    cs.push({ x: x0 + W * rng.range(0.12, 0.2), y: H * rng.range(0.35, 0.65), rx: W * 0.16, ry: H * 0.3 });
  } else if (key === 'archipelago') {
    // jittered grid so islands start apart; channels are carved between them later
    const kx = Math.max(3, Math.round(W / 14)), ky = Math.max(2, Math.round(H * 0.72 / 12));
    const sx = W / kx, sy = H * 0.72 / ky, x0 = rng.range(0, W);
    for (let a = 0; a < kx; a++) for (let b = 0; b < ky; b++)
      cs.push({ x: x0 + (a + 0.5 + rng.range(-0.2, 0.2)) * sx, y: H * 0.14 + (b + 0.5 + rng.range(-0.2, 0.2)) * sy, rx: sx * 0.42, ry: sy * 0.45 });
  } else {
    const k = Math.round(W * H / 110);
    for (let i = 0; i < k; i++) cs.push({ x: rng.range(0, W), y: H * rng.range(0.14, 0.86), rx: rng.range(2.4, 4.6), ry: rng.range(2.2, 4) });
  }
  return cs;
}

// ---- yields and site evaluation (shared with AI) ----
function tileYield(map, i) {
  const t = map.terrain[i], TT = TERRAIN[t];
  let f = TT.food, p = TT.prod, g = TT.gold;
  if (map.lake[i]) { f = 2; g = 1; }
  if (TT.land && map.river[i]) { g += 1; if (t === T.DESERT) f += 2; }
  const r = map.res[i];
  if (r >= 0) { f += RES[r].food; p += RES[r].prod; g += RES[r].gold; }
  return { f, p, g };
}
function tileValue(map, i) {
  const t = map.terrain[i];
  if (t === T.MOUNTAIN) return 0.3;
  const y = tileYield(map, i);
  let v = y.f * 1.0 + y.p * 0.85 + y.g * 0.45;
  if (t === T.OCEAN) v *= 0.6;
  if (t === T.HILLS || t === T.FOREST) v += 0.6; // improvable later
  return v;
}
function isFreshWater(map, g, i) {
  if (map.river[i]) return true;
  for (let d = 0; d < 6; d++) { const n = g.nb[i * 6 + d]; if (n >= 0 && map.lake[n]) return true; }
  return false;
}
function isCoastal(map, g, i) {
  for (let d = 0; d < 6; d++) { const n = g.nb[i * 6 + d]; if (n >= 0 && TERRAIN[map.terrain[n]].water && !map.lake[n]) return true; }
  return false;
}
function siteScore(map, g, i) {
  const t = map.terrain[i];
  if (!TERRAIN[t].land || t === T.MOUNTAIN) return -1;
  let s = 0;
  const tiles = g.within(i, 2);
  for (const k of tiles) {
    const d = g.dst[k];
    let v = tileValue(map, k);
    const r = map.res[k];
    if (r >= 0) v += RES[r].kind === 'luxury' ? 1.5 : RES[r].kind === 'strategic' ? 1.0 : 0.5;
    s += v * (d === 0 ? 1.4 : d === 1 ? 1.15 : 0.8);
  }
  if (isFreshWater(map, g, i)) s += 4;
  if (isCoastal(map, g, i)) s += 2;
  if (t === T.HILLS) s += 1.5;
  if (t === T.MARSH) s -= 4;
  if (t === T.DESERT || t === T.TUNDRA) s -= 2;
  return s;
}

// ---- rivers along hex edges, walked over the vertex graph ----
const CORNER_X = [1, 1, 0, -1, -1, 0];   // in half-hex-width units
const CORNER_Y = [-1, 1, 2, 1, -1, -2];  // in half-side units
function buildVertexGraph(g) {
  const W2 = g.W * 2, vmap = new Map(), vTiles = [], vAdj = [];
  const vid = (x, y) => {
    x = ((x % W2) + W2) % W2; const key = x * 100000 + (y + 10);
    let id = vmap.get(key); if (id === undefined) { id = vTiles.length; vmap.set(key, id); vTiles.push([]); vAdj.push([]); }
    return id;
  };
  for (let i = 0; i < g.N; i++) {
    const c = g.col(i), r = g.row(i), cx = 2 * c + (r & 1), cy = 3 * r, ids = [];
    for (let k = 0; k < 6; k++) { const v = vid(cx + CORNER_X[k], cy + CORNER_Y[k]); ids.push(v); vTiles[v].push(i); }
    for (let d = 0; d < 6; d++) {
      const a = ids[d], b = ids[(d + 1) % 6];
      if (!vAdj[a].some(e => e.v === b)) { vAdj[a].push({ v: b, t: i, d }); vAdj[b].push({ v: a, t: i, d }); }
    }
  }
  return { vTiles, vAdj };
}
function setRiverEdge(map, g, t, d) {
  map.river[t] |= (1 << d);
  const n = g.nb[t * 6 + d];
  if (n >= 0) map.river[n] |= (1 << ((d + 3) % 6));
}
function genRivers(map, g, hgt, count, rng) {
  const { vTiles, vAdj } = buildVertexGraph(g);
  const V = vTiles.length, vh = new Float32Array(V), wet = new Uint8Array(V), onRiver = new Uint8Array(V);
  for (let v = 0; v < V; v++) {
    let s = 0, n = 0, w = 0;
    for (const t of vTiles[v]) { if (TERRAIN[map.terrain[t]].water) w = 1; s += hgt[t]; n++; }
    vh[v] = s / n; wet[v] = w || vTiles[v].length < 3 ? 1 : 0;
  }
  const sources = [];
  for (let v = 0; v < V; v++) {
    if (wet[v]) continue;
    if (!vTiles[v].some(t => map.terrain[t] === T.HILLS || map.terrain[t] === T.MOUNTAIN)) continue;
    sources.push(v);
  }
  sources.sort((a, b) => vh[b] - vh[a]);
  const pool = sources.slice(0, Math.max(count * 6, Math.floor(sources.length * 0.5)));
  rng.shuffle(pool);
  let made = 0;
  for (const src of pool) {
    if (made >= count) break;
    if (onRiver[src]) continue;
    const path = [], visited = new Set([src]);
    let cur = src, ok = false;
    for (let step = 0; step < 40; step++) {
      if (wet[cur] || (step > 0 && onRiver[cur])) { ok = true; break; }
      let best = null, bh = Infinity;
      for (const e of vAdj[cur]) {
        if (visited.has(e.v)) continue;
        if (map.river[e.t] & (1 << e.d)) continue;
        const hh = vh[e.v] + rng.next() * 0.04;
        if (hh < bh) { bh = hh; best = e; }
      }
      if (!best || bh > vh[cur] + 0.03) break;
      path.push(best); visited.add(best.v); cur = best.v;
    }
    if (!ok || path.length < 3) continue;
    for (const e of path) setRiverEdge(map, g, e.t, e.d);
    for (const v of visited) onRiver[v] = 1;
    made++;
  }
  return made;
}

// ---- resources ----
function placeResources(map, g, rng) {
  const land = [], coast = [];
  for (let i = 0; i < g.N; i++) {
    const t = map.terrain[i];
    if (TERRAIN[t].land && t !== T.MOUNTAIN) land.push(i);
    else if (t === T.COAST && !map.lake[i]) coast.push(i);
  }
  const L = land.length;
  const plan = [
    ['ferrite', L * 0.022], ['chitin', L * 0.024], ['lumenite', L * 0.02],
    ['silkweb', L * 0.007], ['embermoss', L * 0.007], ['prism', L * 0.006], ['nectar', L * 0.007], ['icefern', L * 0.006], ['abysspearl', coast.length * 0.02],
    ['glowroot', L * 0.025], ['grazer', L * 0.02], ['loper', L * 0.02], ['basalt', L * 0.018], ['shimmerfish', coast.length * 0.07],
  ];
  for (const [key, cnt] of plan) {
    const ri = RESI[key], R0 = RES[ri], want = Math.max(1, Math.round(cnt));
    const cands = rng.shuffle((R0.on.includes(T.COAST) ? coast : land).filter(i => R0.on.includes(map.terrain[i])));
    let placed = 0;
    for (const i of cands) {
      if (placed >= want) break;
      if (map.res[i] >= 0) continue;
      let crowd = false;
      for (let d = 0; d < 6; d++) { const n = g.nb[i * 6 + d]; if (n >= 0 && map.res[n] >= 0 && (map.res[n] === ri || RES[map.res[n]].kind !== 'bonus')) { crowd = true; break; } }
      if (crowd) continue;
      map.res[i] = ri; placed++;
    }
  }
}

// ---- starting positions with fairness normalization ----
function chooseStarts(map, g, n, rng) {
  const landMask = new Uint8Array(g.N);
  for (let i = 0; i < g.N; i++) landMask[i] = TERRAIN[map.terrain[i]].land && map.terrain[i] !== T.MOUNTAIN ? 1 : 0;
  const comp = components(g, landMask);
  let landCount = 0; for (let i = 0; i < g.N; i++) landCount += landMask[i];
  const all = [];
  for (let i = 0; i < g.N; i++) {
    if (!landMask[i]) continue;
    if (map.terrain[i] === T.MARSH) continue;
    const lat = Math.abs(g.row(i) / (g.H - 1) * 2 - 1); if (lat > 0.72) continue;
    all.push({ i, c: comp.id[i], s: siteScore(map, g, i) + rng.next() * 0.5 });
  }
  all.sort((a, b) => b.s - a.s);
  // A landmass of size s supports about s/28 civs; prefer big landmasses, relax only if needed.
  const perCiv = 28;
  let chosen = [];
  for (const minComp of [40, 30, 20, 14, 8]) {
    const cands = all.filter(c => comp.sizes[c.c] >= minComp);
    let D = Math.sqrt(landCount / n) * 0.95;
    while (D > 3) {
      chosen = []; const used = new Map();
      for (const c of cands) {
        const cap = Math.max(1, Math.floor(comp.sizes[c.c] / perCiv));
        if ((used.get(c.c) || 0) >= cap) continue;
        if (chosen.every(s => g.dist(s, c.i) >= D)) { chosen.push(c.i); used.set(c.c, (used.get(c.c) || 0) + 1); }
        if (chosen.length === n) break;
      }
      if (chosen.length === n) break;
      D *= 0.9;
    }
    if (chosen.length === n) break;
  }
  if (chosen.length < n) throw new Error('Could not place starting positions');
  normalizeStarts(map, g, chosen, rng);
  return rng.shuffle(chosen);
}
function ensureNear(map, g, s, key, maxD, rng) {
  const ri = RESI[key];
  const near = g.within(s, maxD);
  if (near.some(t => map.res[t] === ri)) return false;
  const spots = near.filter(t => g.dst[t] >= 2 && map.res[t] < 0 && RES[ri].on.includes(map.terrain[t]));
  if (!spots.length) return false;
  map.res[rng.pick(spots)] = ri; return true;
}
function normalizeStarts(map, g, starts, rng) {
  for (const s of starts) {
    // tame mountain-locked starts
    let m = 0;
    for (const n of g.neighbors(s)) if (map.terrain[n] === T.MOUNTAIN) { if (++m > 1) map.terrain[n] = T.HILLS; }
    if (map.terrain[s] === T.DESERT || map.terrain[s] === T.TUNDRA) map.terrain[s] = T.PLAINS;
    ensureNear(map, g, s, 'chitin', 5, rng);
    ensureNear(map, g, s, 'ferrite', 6, rng);
    ensureNear(map, g, s, 'lumenite', 7, rng);
  }
  const scores = () => starts.map(s => siteScore(map, g, s));
  let sc = scores();
  const target = Math.max(...sc) * 0.93;
  const food = [['glowroot', [T.PLAINS, T.GRASS]], ['grazer', [T.GRASS]], ['loper', [T.FOREST, T.TUNDRA]], ['shimmerfish', [T.COAST]], ['basalt', [T.HILLS, T.DESERT, T.PLAINS]]];
  starts.forEach((s, k) => {
    for (let tries = 0; tries < 6 && siteScore(map, g, s) < target; tries++) {
      const ring = g.within(s, 2).filter(t => t !== s && map.res[t] < 0);
      const opts = [];
      for (const t of ring) for (const [key, on] of food) if (on.includes(map.terrain[t])) opts.push([t, key]);
      if (!opts.length) break;
      const [t, key] = rng.pick(opts); map.res[t] = RESI[key];
    }
  });
}

// ---- main entry ----
function generateMap(opt, rng) {
  const sz = MAPSIZE[opt.size], script = MAPSCRIPT[opt.script];
  const W = sz.W, H = sz.H, g = new Grid(W, H), N = g.N;
  const nA = makeNoise3(rng), nB = makeNoise3(rng), nC = makeNoise3(rng), nD = makeNoise3(rng), nE = makeNoise3(rng);
  const centers = makeCenters(script.key, W, H, rng);
  const v = new Float32Array(N);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const i = r * W + c;
    const [x, y, z] = cyl(W, c, r, script.freq);
    const [wx, wy, wz] = cyl(W, c, r, 1 / 14);
    let px = c + 0.5 * (r & 1) + nE(wx, wy, wz) * 5, py = r + nE(wx + 40, wy, wz) * 4;
    let mask = 0, m2 = -9;
    for (const ct of centers) {
      const dx = wrapDelta(px - ct.x, W) / ct.rx, dy = (py - ct.y) / ct.ry;
      const m = 1 - Math.sqrt(dx * dx + dy * dy);
      if (m > mask) { m2 = mask; mask = m; } else if (m > m2) m2 = m;
    }
    let val = script.wm * mask + script.wn * fbm3(nA, x, y, z, 5);
    // keep separate landmasses separate: water along the seam between two centers' zones
    if (script.channel && m2 > -1 && mask - m2 < script.channel) val -= 2;
    const lat = Math.abs(r / (H - 1) * 2 - 1);
    if (lat > 0.78) val -= (lat - 0.78) * 3.5;
    v[i] = val;
  }
  const thr = quantile(v, 1 - script.land);
  const land = new Uint8Array(N); for (let i = 0; i < N; i++) land[i] = v[i] > thr ? 1 : 0;
  // remove specks
  let cc = components(g, land);
  for (let i = 0; i < N; i++) if (land[i] && cc.sizes[cc.id[i]] < script.minComp) land[i] = 0;
  cc = components(g, land);

  let vmax = thr; for (let i = 0; i < N; i++) if (land[i] && v[i] > vmax) vmax = v[i];
  const height = new Float32Array(N), ridge = new Float32Array(N);
  const landList = [];
  for (let i = 0; i < N; i++) {
    if (!land[i]) continue;
    height[i] = (v[i] - thr) / (vmax - thr + 1e-6);
    const [x, y, z] = cyl(W, g.col(i), g.row(i), script.freq * 2.2);
    const rr = 1 - Math.abs(fbm3(nC, x, y, z, 3)); ridge[i] = rr * rr;
    landList.push(i);
  }
  const terrain = new Uint8Array(N).fill(T.OCEAN);
  const ms = landList.map(i => ({ i, s: 0.45 * height[i] + 0.55 * ridge[i] })).sort((a, b) => b.s - a.s);
  const nm = Math.floor(ms.length * 0.065), nh = Math.floor(ms.length * 0.14);
  const relief = new Uint8Array(N);
  ms.forEach((e, k) => { if (k < nm) relief[e.i] = cc.sizes[cc.id[e.i]] >= 12 ? 2 : 1; else if (k < nm + nh) relief[e.i] = 1; });

  // distance-to-water (0..3) for moisture
  const wd = new Uint8Array(N).fill(9); const q = [];
  for (let i = 0; i < N; i++) if (!land[i]) { wd[i] = 0; q.push(i); }
  for (let h = 0; h < q.length; h++) { const t = q[h]; if (wd[t] >= 3) continue; for (let d = 0; d < 6; d++) { const n = g.nb[t * 6 + d]; if (n >= 0 && wd[n] > wd[t] + 1) { wd[n] = wd[t] + 1; q.push(n); } } }

  let marsh = 0; const marshCap = landList.length * 0.035;
  for (const i of landList) {
    if (relief[i] === 2) { terrain[i] = T.MOUNTAIN; continue; }
    if (relief[i] === 1) { terrain[i] = T.HILLS; continue; }
    const c = g.col(i), r = g.row(i);
    const lat = Math.abs(r / (H - 1) * 2 - 1);
    const [x, y, z] = cyl(W, c, r, script.freq * 1.4);
    const temp = 1 - lat * 1.05 + fbm3(nD, x, y, z, 3) * 0.3 - height[i] * 0.12;
    const moist = 0.5 + fbm3(nB, x, y, z, 4) * 0.95 + (wd[i] <= 1 ? 0.03 : wd[i] >= 3 ? -0.05 : 0);
    let t;
    if (temp < 0.24) t = moist > 0.64 ? T.FOREST : T.TUNDRA;
    else if (temp > 0.6 && moist < 0.36) t = T.DESERT;
    else if (moist > 0.72 && height[i] < 0.3 && temp > 0.35 && marsh < marshCap) { t = T.MARSH; marsh++; }
    else if (moist > 0.57) t = T.FOREST;
    else if (moist > 0.42 && temp > 0.38) t = T.GRASS;
    else t = T.PLAINS;
    terrain[i] = t;
  }
  // water: lakes, coast, ocean
  const lake = new Uint8Array(N);
  const water = new Uint8Array(N); for (let i = 0; i < N; i++) water[i] = land[i] ? 0 : 1;
  const wc = components(g, water);
  for (let i = 0; i < N; i++) {
    if (land[i]) continue;
    if (wc.sizes[wc.id[i]] <= 9) { lake[i] = 1; terrain[i] = T.COAST; continue; }
    let adj = false; for (let d = 0; d < 6; d++) { const n = g.nb[i * 6 + d]; if (n >= 0 && land[n]) { adj = true; break; } }
    terrain[i] = adj ? T.COAST : T.OCEAN;
  }
  const map = {
    W, H, terrain, lake, river: new Uint8Array(N), res: new Int8Array(N).fill(-1),
    owner: new Int8Array(N).fill(-1), ocity: new Int16Array(N).fill(-1),
  };
  const hgt = new Float32Array(N);
  for (let i = 0; i < N; i++) hgt[i] = land[i] ? height[i] + (terrain[i] === T.MOUNTAIN ? 0.35 : terrain[i] === T.HILLS ? 0.12 : 0) : -1;
  genRivers(map, g, hgt, sz.rivers, rng);
  placeResources(map, g, rng);
  const starts = chooseStarts(map, g, opt.civs, rng);
  return { map, grid: g, starts };
}
