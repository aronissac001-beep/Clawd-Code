// Realm fields, steps 1-5 and 7 of EMBERCROWN-WORLD.md 1.2 (owner L): plates, elevation and the sea, temperature
// and its swing, rainfall, drainage, then volcanism, rock provinces, taint and wildness.
// Determinism (1.2, tools/check-mapgen.mjs lints this file): every step draws from its own private mulberry32
// seeded by stream(step, seed, reroll), never s.rng; only + - * / and integer ops; ties break by region index.
// Nothing is allocated at import: every layer is built per call.
import { hashString, rint, rnd, nextU32 } from '../core/rand.js';
import { GEN, REALM_GEN } from '../../data/realm/params.js';

/** D8 directions in a fixed order (the 3-bit direction of the `flow` layer): N, NE, E, SE, S, SW, W, NW. */
export const DX = Object.freeze([0, 1, 1, 1, 0, -1, -1, -1]);
export const DY = Object.freeze([-1, -1, 0, 1, 1, 1, 0, -1]);

/** The u32 seed of one generation step's stream (1.2); a re-roll (1.4) uses index n > 0. */
export function stream(step, seed, reroll = 0) {
  return hashString('realm:' + step + ':' + seed + ':' + REALM_GEN.version + (reroll ? ':' + reroll : '')) || 0x9e3779b9;
}
/** A private generator over one u32 seed (the rand.js helpers read r.rng.g). */
export const gen = (seed) => ({ rng: { g: seed >>> 0 || 0x9e3779b9 } });
export const ri = (R, a, b) => rint(R, 'g', a, b);
export const rf = (R) => rnd(R, 'g');
export const ru = (R) => nextU32(R, 'g');

function hash2(x, y, seed) {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ seed) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const smooth = (t) => t * t * (3 - 2 * t);
/** Integer-hash value noise in [0, 1) with lattice spacing `cell`, smoothstep blended. */
export function vnoise(x, y, cell, seed) {
  const fx = x / cell, fy = y / cell, x0 = Math.floor(fx), y0 = Math.floor(fy);
  const u = smooth(fx - x0), v = smooth(fy - y0);
  const a = hash2(x0, y0, seed), b = hash2(x0 + 1, y0, seed), c = hash2(x0, y0 + 1, seed), d = hash2(x0 + 1, y0 + 1, seed);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}
/** 4-octave fractal value noise in [0, 1). */
export function fbm4(x, y, cell, seed) {
  return (vnoise(x, y, cell, seed) * 8 + vnoise(x, y, cell / 2, seed ^ 0x51ed27) * 4
    + vnoise(x, y, cell / 4, seed ^ 0x2b79f5) * 2 + vnoise(x, y, cell / 8, seed ^ 0x6c8e9c)) / 15;
}
/** Floor of the square root of a non-negative integer, by integer Newton steps (exact on every engine). */
export function isqrt(v) {
  if (v < 2) return v;
  let x = v, y = Math.floor((x + 1) / 2);
  while (y < x) { x = y; y = Math.floor((x + Math.floor(v / x)) / 2); }
  return x;
}
const clamp8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.floor(v));

/** Fresh layers of 1.1 for an n x n realm (one byte a region; `site` two). */
export function allocFields(n) {
  const N = n * n;
  return {
    elev: new Uint8Array(N), temp: new Int8Array(N), amp: new Uint8Array(N), rain: new Uint8Array(N),
    drain: new Uint8Array(N), volc: new Uint8Array(N), taint: new Uint8Array(N), wild: new Uint8Array(N),
    geo: new Uint8Array(N), biome: new Uint8Array(N), flow: new Uint8Array(N), site: new Uint16Array(N),
    owner: new Uint8Array(N), road: new Uint8Array(N),
  };
}

/** Distance from (x, y) to the map edge on `side` ('n' | 'e' | 's' | 'w'). */
export function edgeDist(side, x, y, n) {
  return side === 'n' ? y : side === 's' ? n - 1 - y : side === 'w' ? x : n - 1 - x;
}

// ---- Step 1: plates ------------------------------------------------------------------------------
export function platesStep(rx, reroll = 0) {
  const P = GEN.plates, R = gen(stream('plates', rx.seed, reroll)), n = rx.n, k = ri(R, P.count[0], P.count[1]), plates = [];
  for (let i = 0; i < k; i++) {
    // oceanic plates lie toward the sea sides (an inland one would make a sunken basin, so they are rare)
    const x = ri(R, 0, n - 1), y = ri(R, 0, n - 1);
    let dSea = n;
    for (const sd of rx.sides) { const d = edgeDist(sd, x, y, n); if (d < dSea) dSea = d; }
    const oceanic = ri(R, 0, 99) < (dSea < n * P.oceanReach ? P.oceanicPct : P.inlandOceanicPct);
    plates.push({ x, y, dx: ri(R, -P.drift, P.drift), dy: ri(R, -P.drift, P.drift),
      oceanic, old: ri(R, 0, 99) < P.oldPct, basalt: ri(R, 0, 1) === 1,
      base: oceanic ? ri(R, P.baseOcean[0], P.baseOcean[1]) : ri(R, P.baseLand[0], P.baseLand[1]) });
  }
  rx.plates = plates;
}

// ---- Step 2: elevation, sea level, sea, islands --------------------------------------------------
export function elevationStep(rx, reroll = 0) {
  const { n, sc, plates, sides } = rx, P = GEN.plates, E = GEN.elev, N = n * n, f = rx.f;
  const R = gen(stream('elev', rx.seed, reroll)), sN = ru(R), sJ = ru(R);
  const raw = new Float64Array(N), plate = new Uint8Array(N), conv = new Float64Array(N);
  const width = P.width * sc, C = E.coast * sc, rim = E.rim * sc, land = [];
  for (const sd of ['n', 'e', 's', 'w']) if (!sides.includes(sd)) land.push(sd);
  let lo = Infinity, hi = -Infinity;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x;
    // nearest and second-nearest plate seeds (squared distance; ties by plate index)
    let a = 0, b = -1, da = Infinity, db = Infinity;
    for (let p = 0; p < plates.length; p++) {
      const ddx = x - plates[p].x, ddy = y - plates[p].y, d = ddx * ddx + ddy * ddy;
      if (d < da) { b = a; db = da; a = p; da = d; } else if (d < db) { b = p; db = d; }
    }
    const A = plates[a], B = plates[b];
    const nx = B.x - A.x, ny = B.y - A.y, len = isqrt(nx * nx + ny * ny) || 1;
    const t = (db - da) / (2 * len);                    // distance to the bisector
    const fb = t < width ? 1 - t / width : 0;           // 1 on the boundary, 0 beyond `width`
    const cv = ((A.dx - B.dx) * nx + (A.dy - B.dy) * ny) / len;  // > 0: the plates converge
    let e = A.base * (1 - fb / 2) + B.base * (fb / 2);
    if (cv > 0) e += cv * P.ridge * fb * (A.oceanic && B.oceanic ? 0.5 : 1) * 4;
    else e += cv * P.rift * fb * 4;
    e += (fbm4(x, y, E.cell * sc, sN) - 0.5) * E.noise * 2;
    let dSea = Infinity;
    for (const sd of sides) {
      const d = edgeDist(sd, x, y, n) + (vnoise(x, y, 8 * sc, sJ ^ sd.charCodeAt(0)) - 0.5) * 2 * E.coastJitter * sc;
      if (d < dSea) dSea = d;
      if (d < C) { const u = (C - d) / C; e -= E.coastDrop * u * u; }
    }
    for (const sd of land) { const d = edgeDist(sd, x, y, n); if (d < rim) e += (rim - d) * E.rimRise; }
    e += ((dSea < 40 * sc ? dSea : 40 * sc) * E.inland) / sc;
    raw[i] = e; plate[i] = a; conv[i] = cv > 0 ? cv * fb : 0;
    if (e < lo) lo = e;
    if (e > hi) hi = e;
  }
  const span = hi - lo || 1, hist = new Uint32Array(256);
  for (let i = 0; i < N; i++) { const v = clamp8(((raw[i] - lo) * 255) / span); f.elev[i] = v; hist[v]++; }
  // sea level by percentile: the lowest level that leaves at most landPct % of the map at or above it
  const want = Math.floor((N * ri(R, E.landPct[0], E.landPct[1])) / 100);
  let sl = 255, cum = 0;
  while (sl > 1 && cum + hist[sl] <= want) { cum += hist[sl]; sl--; }
  rx.seaLevel = sl + 1;
  rx.plate = plate; rx.conv = conv;
  seaMask(rx);
}

/** The sea: regions below sea level 8-connected to a border region on a sea side. Also flags small islands. */
export function seaMask(rx) {
  const { n, sides } = rx, N = n * n, el = rx.f.elev, sl = rx.seaLevel, sea = new Uint8Array(N), q = new Int32Array(N);
  let h = 0, t = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (x > 0 && y > 0 && x < n - 1 && y < n - 1) continue;
    const i = y * n + x;
    if (el[i] >= sl) continue;
    let on = false;
    for (const sd of sides) if (edgeDist(sd, x, y, n) === 0) on = true;
    if (on) { sea[i] = 1; q[t++] = i; }
  }
  while (h < t) {
    const i = q[h++], x = i % n, y = (i - x) / n;
    for (let d = 0; d < 8; d++) {
      const xx = x + DX[d], yy = y + DY[d];
      if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
      const j = yy * n + xx;
      if (!sea[j] && el[j] < sl) { sea[j] = 1; q[t++] = j; }
    }
  }
  rx.sea = sea;
  // islands: 4-connected land components smaller than GEN.islandMin
  const comp = new Int32Array(N).fill(-1), island = new Uint8Array(N);
  for (let s0 = 0; s0 < N; s0++) {
    if (sea[s0] || comp[s0] >= 0) continue;
    h = 0; t = 0; q[t++] = s0; comp[s0] = s0;
    while (h < t) {
      const i = q[h++], x = i % n, y = (i - x) / n;
      for (let d = 0; d < 8; d += 2) {
        const xx = x + DX[d], yy = y + DY[d];
        if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
        const j = yy * n + xx;
        if (!sea[j] && comp[j] < 0) { comp[j] = s0; q[t++] = j; }
      }
    }
    if (t < GEN.islandMin) for (let k = 0; k < t; k++) island[q[k]] = 1;
  }
  rx.island = island;
}

// ---- Step 3: temperature and the yearly swing -----------------------------------------------------
export function temperatureStep(rx, reroll = 0) {
  const { n, sc } = rx, T = GEN.temp, M = GEN.amp, N = n * n, f = rx.f, sl = rx.seaLevel, sea = rx.sea;
  const R = gen(stream('temp', rx.seed, reroll)), sN = ru(R);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, lat = y / (n - 1);
    let t = T.north + (T.south - T.north) * lat + (vnoise(x, y, 12 * sc, sN) - 0.5) * T.noise;
    if (!sea[i]) t -= (f.elev[i] - sl) / T.lapse;
    t = Math.round(t);
    f.temp[i] = t < T.min ? T.min : t > T.max ? T.max : t;
  }
  // amp grows with distance from the sea (4-connected steps), and a little toward the cold north
  const dist = seaDistance(rx);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, d = dist[i] < M.maxDist * sc ? dist[i] / sc : M.maxDist;
    f.amp[i] = clamp8(M.base + d * M.perRegion + M.north * (1 - y / (n - 1)));
  }
  rx.seaDist = dist;
}

/** Steps (4-connected) from each region to the nearest sea region; 255 cap. Sea is 0. */
export function seaDistance(rx) {
  const n = rx.n, N = n * n, sea = rx.sea, dist = new Uint8Array(N).fill(255), q = new Int32Array(N);
  let h = 0, t = 0;
  for (let i = 0; i < N; i++) if (sea[i]) { dist[i] = 0; q[t++] = i; }
  while (h < t) {
    const i = q[h++], x = i % n, y = (i - x) / n, d1 = dist[i] + 1;
    for (let d = 0; d < 8; d += 2) {
      const xx = x + DX[d], yy = y + DY[d];
      if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
      const j = yy * n + xx;
      if (dist[j] > d1 && d1 < 255) { dist[j] = d1; q[t++] = j; }
    }
  }
  return dist;
}

// ---- Step 4: rainfall (west wind sweep with rain shadow, then a 3 x 3 blur) ----------------------
export function rainStep(rx, reroll = 0) {
  const { n, sc, sides } = rx, Q = GEN.rain, N = n * n, f = rx.f, sl = rx.seaLevel, sea = rx.sea;
  const R = gen(stream('rain', rx.seed, reroll)), sN = ru(R), raw = new Float64Array(N);
  const westSea = sides.includes('w');
  for (let y = 0; y < n; y++) {
    const lat = y / (n - 1);
    let m = westSea ? Q.westSea : Q.westLand;
    if (lat > 0.6) m *= 1 - Q.southDry * (lat - 0.6) / 0.4;
    let prev = sl;
    for (let x = 0; x < n; x++) {
      const i = y * n + x, h = f.elev[i] > sl ? f.elev[i] : sl;
      if (sea[i]) { m += (Q.seaCap - m) * Q.pick; raw[i] = m * Q.fromAir; prev = sl; continue; }
      const rise = h > prev ? h - prev : 0;
      let drop = m * (Q.base + rise * Q.lift * sc);
      if (drop > m * Q.maxDrop) drop = m * Q.maxDrop;
      raw[i] = m * Q.fromAir + drop * Q.fromDrop;
      m -= drop; prev = h;
    }
  }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let s = 0, c = 0;
    for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) {
      if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
      s += raw[yy * n + xx]; c++;
    }
    f.rain[y * n + x] = clamp8(s / c + (vnoise(x, y, 10 * sc, sN) - 0.5) * Q.noise);
  }
}

// ---- Step 5: drainage (noise, up on slopes, down in basins) --------------------------------------
export function drainageStep(rx, reroll = 0) {
  const { n, sc } = rx, D = GEN.drain, f = rx.f;
  const R = gen(stream('drain', rx.seed, reroll)), sN = ru(R);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, e = f.elev[i];
    let slope = 0, higher = 0;
    for (let d = 0; d < 8; d++) {
      const xx = x + DX[d], yy = y + DY[d];
      if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
      const o = f.elev[yy * n + xx], dd = o > e ? o - e : e - o;
      if (dd > slope) slope = dd;
      if (o > e) higher++;
    }
    f.drain[i] = clamp8(D.base + (fbm4(x, y, 12 * sc, sN) - 0.5) * D.noise + slope * D.slope - higher * D.basin);
  }
}
/** After the rivers step: lake regions drain badly. */
export function drainLakes(rx) {
  const f = rx.f;
  for (let i = 0; i < rx.n * rx.n; i++) if (rx.lake[i]) f.drain[i] = clamp8(f.drain[i] - GEN.drain.lake);
}

// ---- Step 7: volcanism, rock provinces, taint, wildness -------------------------------------------
export function geologyStep(rx, reroll = 0) {
  const { n, sc, plates } = rx, V = GEN.volc, T = GEN.taint, Wd = GEN.wild, N = n * n, f = rx.f, pr = rx.params;
  const R = gen(stream('geo', rx.seed, reroll)), sV = ru(R), sT = ru(R), sW = ru(R);
  const hot = [], hk = ri(R, V.hotspots[0], V.hotspots[1]);
  for (let k = 0; k < hk; k++) { const r = ri(R, V.radius[0], V.radius[1]) * sc; hot.push({ x: ri(R, 0, n - 1), y: ri(R, 0, n - 1), r2: r * r }); }
  const fr = T.falls[pr.hollowing], falls = [], fk = ri(R, fr[0], fr[1]), peak = T.peak[pr.hollowing];
  for (let k = 0; k < fk; k++) {
    // a fall site of the Old Crown lies on land (first land region in a seeded scan from a random start)
    let i0 = ri(R, 0, N - 1);
    for (let s = 0; s < N && rx.sea[i0]; s++) i0 = (i0 + 7919) % N;
    const r = ri(R, T.radius[0], T.radius[1]) * sc;
    falls.push({ x: i0 % n, y: Math.floor(i0 / n), r2: r * r });
  }
  rx.hotspots = hot; rx.falls = falls;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x;
    let v = 0, t = 0;
    for (const h of hot) { const dx = x - h.x, dy = y - h.y, d2 = dx * dx + dy * dy; if (d2 < h.r2) { const u = 255 * (1 - d2 / h.r2); if (u > v) v = u; } }
    const b = rx.conv[i] * V.boundary;
    if (b > v) v = b;
    f.volc[i] = clamp8(v + (vnoise(x, y, 8 * sc, sV) - 0.5) * V.noise);
    for (const h of falls) { const dx = x - h.x, dy = y - h.y, d2 = dx * dx + dy * dy; if (d2 < h.r2) { const u = peak * (1 - d2 / h.r2); if (u > t) t = u; } }
    f.taint[i] = clamp8(t + (vnoise(x, y, 6 * sc, sT) - 0.5) * T.noise);
    f.wild[i] = clamp8(Wd.base + fbm4(x, y, 12 * sc, sW) * Wd.noise + f.taint[i] / Wd.taint + Wd.offset[pr.wildness]);
    // rock province: 4 ash field (hot ground), 3 metamorphic belt (converging boundary), else by plate type and age
    const P = plates[rx.plate[i]];
    f.geo[i] = f.volc[i] > GEN.classify.ashGeo ? 4 : rx.conv[i] > 1.2 ? 3 : P.oceanic ? (P.basalt ? 2 : 0) : P.old ? 1 : 0;
  }
}
