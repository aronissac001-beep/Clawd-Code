// ===== mapgen.js : terrain heightmap, craters, ridges, deposits, anomalies =====
const MAP_N = 64, SECTOR = 8;
const TERR = ['Dust plain', 'Rock field', 'Basalt', 'Frost flat', 'Dunes', 'Highland'];
const SLOPE_BUILD = 0.055, SLOPE_LINE = 0.11, SLOPE_DRIVE = 0.14;

// static terrain is regenerated from the seed on load, never saved
function genTerrain(seed) {
  const n = MAP_N, rng = RNG.fromSeed(seed + '/terrain'), noise = makeNoise(rng), N = n * n;
  const h = new Float32Array(N), terr = new Uint8Array(N), slope = new Float32Array(N), crater = new Float32Array(N);
  const ox = rng.range(0, 100), oy = rng.range(0, 100);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const b = noise.fbm(x / 24 + ox, y / 24 + oy, 5) * 0.55;
    const r = Math.pow(noise.ridge(x / 34 + oy, y / 34 + ox, 3), 3) * 0.55;
    h[y * n + x] = b + r;
  }
  // flatten the centre a little so there is always a landing plain
  const cx = n / 2, cy = n / 2;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const d = Math.hypot(x - cx, y - cy), f = clamp(1 - d / 13, 0, 1);
    const i = y * n + x; h[i] = h[i] * (1 - f * 0.75) + 0.3 * f * 0.75;
  }
  // craters: bowl plus raised rim
  const craters = [], nc = 9 + rng.int(6);
  for (let k = 0; k < nc; k++) {
    const r = k < 2 ? rng.range(7, 11) : rng.range(2.5, 6.5);
    let x, y, tries = 0;
    do { x = rng.range(3, n - 3); y = rng.range(3, n - 3); tries++; } while (Math.hypot(x - cx, y - cy) < r + 7 && tries < 40);
    craters.push({ x, y, r });
    const depth = 0.12 + r * 0.018;
    for (let yy = Math.max(0, Math.floor(y - r * 1.6)); yy < Math.min(n, Math.ceil(y + r * 1.6)); yy++)
      for (let xx = Math.max(0, Math.floor(x - r * 1.6)); xx < Math.min(n, Math.ceil(x + r * 1.6)); xx++) {
        const d = Math.hypot(xx - x, yy - y) / r, i = yy * n + xx;
        if (d < 1) { h[i] -= depth * (1 - d * d) * 0.9; crater[i] = Math.max(crater[i], 1 - d); }
        const rim = Math.exp(-Math.pow((d - 1.05) / 0.18, 2)) * depth * 0.55;
        h[i] += rim;
      }
  }
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < N; i++) { mn = Math.min(mn, h[i]); mx = Math.max(mx, h[i]); }
  for (let i = 0; i < N; i++) h[i] = (h[i] - mn) / (mx - mn);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x; let s = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
      s = Math.max(s, Math.abs(h[i] - h[yy * n + xx]));
    }
    slope[i] = s;
  }
  const tn = makeNoise(RNG.fromSeed(seed + '/tex'));
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, v = tn.fbm(x / 9, y / 9, 3), w = tn.fbm(x / 5 + 40, y / 5 + 40, 2);
    let t = 0;
    if (h[i] > 0.72) t = 5;
    else if (crater[i] > 0.35 && h[i] < 0.38) t = 3;
    else if (slope[i] > 0.05) t = 1;
    else if (v > 0.28) t = 4;
    else if (w < -0.33) t = 2;
    terr[i] = t;
  }
  return { n, h, terr, slope, crater, craters };
}

// deposits, anomalies and the landing site are rolled once and saved with the game
function genFeatures(seed, T) {
  const n = T.n, rng = RNG.fromSeed(seed + '/features');
  const deps = [], anomalies = [];
  const used = new Uint8Array(n * n);
  const flatAt = (x, y, r) => { for (let yy = y - r; yy <= y + r; yy++) for (let xx = x - r; xx <= x + r; xx++) { if (xx < 1 || yy < 1 || xx >= n - 1 || yy >= n - 1) return false; if (T.slope[yy * n + xx] > SLOPE_BUILD) return false; } return true; };
  // landing site: flattest 3x3 near the centre
  let land = null, best = Infinity;
  for (let y = n / 2 - 8; y <= n / 2 + 8; y++) for (let x = n / 2 - 8; x <= n / 2 + 8; x++) {
    if (!flatAt(x, y, 2)) continue;
    const s = Math.hypot(x - n / 2, y - n / 2) + rng.next();
    if (s < best) { best = s; land = { x: x - 1, y: y - 1 }; }
  }
  if (!land) land = { x: n / 2 - 1, y: n / 2 - 1 };
  for (let yy = land.y - 2; yy < land.y + 5; yy++) for (let xx = land.x - 2; xx < land.x + 5; xx++) used[yy * n + xx] = 1;
  const lc = { x: land.x + 1, y: land.y + 1 };
  const place = (type, amt, opt = {}) => {
    for (let tries = 0; tries < 400; tries++) {
      let x, y;
      if (opt.near) { const a = rng.range(0, Math.PI * 2), d = rng.range(opt.near[0], opt.near[1]); x = Math.round(lc.x + Math.cos(a) * d); y = Math.round(lc.y + Math.sin(a) * d); }
      else { x = 2 + rng.int(n - 4); y = 2 + rng.int(n - 4); }
      if (x < 2 || y < 2 || x >= n - 2 || y >= n - 2) continue;
      const i = y * n + x;
      if (used[i]) continue;
      if (!opt.any && T.slope[i] > SLOPE_BUILD) continue;
      if (opt.minD && Math.hypot(x - lc.x, y - lc.y) < opt.minD) continue;
      if (opt.prefer && !opt.prefer(i) && tries < 300) continue;
      const r = opt.r === undefined ? 1 : opt.r;
      for (let yy = y - r - 1; yy <= y + r + 1; yy++) for (let xx = x - r - 1; xx <= x + r + 1; xx++) if (xx >= 0 && yy >= 0 && xx < n && yy < n) used[yy * n + xx] = 1;
      const d = { id: deps.length, type, x, y, r, amount: amt, max: amt, deep: !!opt.deep };
      deps.push(d); return d;
    }
    return null;
  };
  const A = (a, b) => Math.round(rng.range(a, b));
  // guaranteed starters near the lander
  place('regolith', A(3000, 4200), { near: [5, 9], r: 1 }) || place('regolith', A(3000, 4200), { near: [4, 12], r: 1, any: true });
  place('ice', A(2200, 3200), { near: [7, 12], r: 1 }) || place('ice', A(2200, 3200), { near: [5, 14], r: 1, any: true }) || place('ice', A(2200, 3200), { near: [4, 15], r: 0, any: true });
  place('metal', A(1400, 2000), { near: [8, 13], r: 1 });
  place('metal', A(1000, 1600), { near: [10, 16], r: 1 });
  for (let k = 0; k < 7; k++) place('scrap', A(20, 40), { near: [3, 8], r: 0 });
  place('rare', A(500, 800), { near: [11, 16], r: 1 }) || place('rare', A(500, 800), { near: [9, 18], r: 1, any: true });
  // the rest of the region
  for (let k = 0; k < 6; k++) place('regolith', A(2500, 4500), { r: 1 });
  for (let k = 0; k < 7; k++) place('ice', A(1800, 3400), { r: 1, prefer: i => T.crater[i] > 0.2 || T.terr[i] === 3 });
  for (let k = 0; k < 6; k++) place('metal', A(600, 1300), { r: 1 });
  for (let k = 0; k < 4; k++) place('rare', A(250, 600), { r: 1, minD: 10 });
  for (let k = 0; k < 3; k++) place('crystal', A(120, 260), { r: 0, minD: 16 });
  for (let k = 0; k < 4; k++) place('bloom', A(1500, 2500), { r: 1, minD: 8, prefer: i => T.crater[i] > 0.1 });
  for (let k = 0; k < 30; k++) place('scrap', A(15, 45), { r: 0, minD: 6, any: true });
  // deep deposits: hidden until Deep Sounding
  for (let k = 0; k < 5; k++) place('metal', A(1600, 2800), { r: 1, deep: true, minD: 6 });
  for (let k = 0; k < 3; k++) place('rare', A(700, 1200), { r: 1, deep: true, minD: 10 });
  for (let k = 0; k < 3; k++) place('ice', A(2500, 4000), { r: 1, deep: true, minD: 6 });
  // anomalies
  const kinds = Object.keys(ANOMALIES);
  for (let k = 0; k < 13; k++) {
    for (let tries = 0; tries < 200; tries++) {
      const x = 2 + rng.int(n - 4), y = 2 + rng.int(n - 4), i = y * n + x;
      if (used[i] || T.slope[i] > SLOPE_DRIVE * 0.8 || Math.hypot(x - lc.x, y - lc.y) < 7) continue;
      used[i] = 1;
      anomalies.push({ id: k, kind: kinds[k % kinds.length], x, y, done: false, roll: rng.int(1000) });
      break;
    }
  }
  return { deps, anomalies, land };
}

// per-tile deposit index (-1 = none); rebuilt whenever deposits change
function depositGrid(G) {
  const n = MAP_N, g = new Int16Array(n * n).fill(-1);
  for (const d of G.deposits) {
    if (d.amount <= 0 && DEPOSITS[d.type].surface) continue;
    for (let y = d.y - d.r; y <= d.y + d.r; y++) for (let x = d.x - d.r; x <= d.x + d.r; x++) if (x >= 0 && y >= 0 && x < n && y < n) g[y * n + x] = d.id;
  }
  return g;
}
Object.assign(KC, { MAP_N, SECTOR, TERR, SLOPE_BUILD, SLOPE_LINE, SLOPE_DRIVE, genTerrain, genFeatures, depositGrid });
