// ============================================================================
// ZONEFALL 3 — procedural island: heightfield, biomes, lakes, monument sites,
// roads (ring road + spurs), vegetation / resource scatter, beach spawns.
// Pure data, deterministic per seed. Rendering lives in gfx/terrain.js.
// ============================================================================
import { rng, makeNoise, clamp, smooth, lerp, dist } from '../util.js';
import { MONUMENTS } from '../data.js';

export const WORLD = 800, RES = 2, N = WORLD / RES + 1, WATER_Y = 0, CHUNK = 64;
export const NCH = Math.ceil(WORLD / CHUNK);
export const B = { OCEAN: 0, BEACH: 1, GRASS: 2, FOREST: 3, ARID: 4, SNOW: 5, ROCK: 6, LAKE: 7 };

export function generateWorld(seed) {
  const R = rng(seed);
  const nA = makeNoise(seed + 1), nB = makeNoise(seed + 2), nC = makeNoise(seed + 3), nD = makeNoise(seed + 4);
  const W = {
    seed, size: WORLD, res: RES, n: N,
    h: new Float32Array(N * N), biome: new Uint8Array(N * N), road: new Uint8Array(N * N), flat: new Uint8Array(N * N),
    monuments: [], roads: [], lakes: [], veg: [], nodes: [], spawns: [], roadside: [],
  };
  const cx = WORLD / 2, cz = WORLD / 2, IR = WORLD * 0.47;
  // island "elevation" 0 at coast, 1 at centre
  const elev = (x, z) => {
    const dx = x - cx, dz = z - cz; const a = Math.atan2(dz, dx);
    const coast = IR * (0.84 + 0.16 * nA.fbm(Math.cos(a) * 1.6 + 7, Math.sin(a) * 1.6 + 3, 3) * 1.6 + 0.05 * nB(x / 60, z / 60));
    return 1 - Math.hypot(dx, dz) / coast;
  };
  W.elev = elev;
  const mountMask = (x, z) => smooth(clamp((nC.fbm(x / 260 + 11, z / 260 - 4, 2) + 0.05) * 3.2, 0, 1));
  // ---- base heights + biomes
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = i * RES, z = j * RES, e = elev(x, z), k = j * N + i;
    let h;
    if (e < 0) h = Math.max(-14, e * 40) - 0.4;
    else {
      h = smooth(clamp(e / 0.09, 0, 1)) * 2.2 + 0.1;
      h += Math.max(0, nB.fbm(x / 150, z / 150, 4) + 0.12) * 5.5 * smooth(clamp((e - 0.04) / 0.25, 0, 1));
      h += Math.pow(nC.ridge(x / 120, z / 120, 4), 2.2) * 15 * mountMask(x, z) * smooth(clamp((e - 0.18) / 0.3, 0, 1));
    }
    W.h[k] = h;
  }
  const H = (x, z) => sampleH(W, x, z);
  W.height = H;
  // ---- monument sites
  const placed = [];
  const order = Object.keys(MONUMENTS).sort((a, b) => MONUMENTS[b].size - MONUMENTS[a].size);
  for (const type of order) {
    const def = MONUMENTS[type];
    for (let c = 0; c < def.count; c++) {
      let best = null;
      for (let tries = 0; tries < 3000 && !best; tries++) {
        const x = R.range(60, WORLD - 60), z = R.range(60, WORLD - 60), e = elev(x, z), rl = tries / 3000;
        if (def.coast) { if (e < 0.03 - rl * 0.02 || e > 0.1 + rl * 0.05) continue; }
        else if (type === 'haven') { if (e < 0.35 - rl * 0.2 || e > 0.75) continue; }
        else if (def.tier >= 3) { if (e < 0.28 - rl * 0.1) continue; }
        else if (e < 0.14 - rl * 0.06) continue;
        const r = def.size;
        // terrain must be reasonably even (no big mountains) unless coastal
        let hmin = 99, hmax = -99, wet = 0;
        for (let s = 0; s < 16; s++) { const a = s / 16 * Math.PI * 2; for (const f of [0.4, 0.9]) { const hh = H(x + Math.cos(a) * r * f, z + Math.sin(a) * r * f); hmin = Math.min(hmin, hh); hmax = Math.max(hmax, hh); if (hh < 0.3) wet++; } }
        if (!def.coast && (hmax - hmin > 7 + tries * 0.006 || wet > 0)) continue;
        if (placed.some(p => dist(p.x, p.z, x, z) < p.size + r + 40 - rl * 34)) continue;
        best = { x, z };
      }
      if (!best) continue;
      // rotation: coastal sites face the sea with local +X
      let rot = R.int(0, 3);
      if (def.coast) { const a = Math.atan2(best.z - cz, best.x - cx); rot = ((Math.round(a / (Math.PI / 2)) % 4) + 4) % 4; }
      const m = { type, name: def.name, x: Math.round(best.x), z: Math.round(best.z), rot, size: def.size, tier: def.tier, idx: c };
      placed.push(m); W.monuments.push(m);
    }
  }
  // ---- ring road
  const ring = [];
  const ringE = 0.2;
  for (let s = 0; s < 160; s++) {
    const a = s / 160 * Math.PI * 2; let lo = 0, hi = IR * 1.2;
    for (let it = 0; it < 22; it++) { const mid = (lo + hi) / 2; if (elev(cx + Math.cos(a) * mid, cz + Math.sin(a) * mid) > ringE) lo = mid; else hi = mid; }
    const rr = lo + nD(s * 0.3, 2) * 10;
    ring.push([cx + Math.cos(a) * rr, cz + Math.sin(a) * rr]);
  }
  ring.push(ring[0].slice());
  W.roads.push(ring);
  // spurs: every non-coastal monument links to the ring (or nearest monument) with a gently curved road
  for (const m of W.monuments) {
    let bi = 0, bd = 1e9;
    for (let i = 0; i < ring.length; i++) { const d = dist(ring[i][0], ring[i][1], m.x, m.z); if (d < bd) { bd = d; bi = i; } }
    const end = ring[bi];
    if (bd < m.size * 0.6) continue; // the ring passes through
    const pts = []; const steps = Math.max(2, Math.ceil(bd / 8));
    const nx = -(end[1] - m.z) / bd, nz = (end[0] - m.x) / bd, bend = R.range(-0.12, 0.12) * bd;
    for (let s = 0; s <= steps; s++) { const t = s / steps, b = Math.sin(t * Math.PI) * bend; pts.push([lerp(m.x, end[0], t) + nx * b, lerp(m.z, end[1], t) + nz * b]); }
    m.roadFrom = pts[0]; W.roads.push(pts);
  }
  // ---- lakes (away from roads + monuments)
  for (let tries = 0, made = 0; tries < 1500 && made < 5; tries++) {
    const x = R.range(80, WORLD - 80), z = R.range(80, WORLD - 80), e = elev(x, z), r = R.range(9, 20);
    if (e < 0.22 || mountMask(x, z) > 0.75) continue;
    if (W.monuments.some(m => dist(m.x, m.z, x, z) < m.size + r + 25)) continue;
    if (W.roads.some(p => p.some(q => dist(q[0], q[1], x, z) < r + 14))) continue;
    if (W.lakes.some(l => dist(l.x, l.z, x, z) < l.r + r + 40)) continue;
    W.lakes.push({ x, z, r }); made++;
  }
  for (const l of W.lakes) forDisc(l.x, l.z, l.r + 10, (k, d) => {
    const t = d / l.r; const target = t < 1 ? WATER_Y - 1.6 * (1 - t * t) - 0.15 : WATER_Y + (t - 1) * 0.9 * (l.r / 10);
    if (t < 1) W.h[k] = Math.min(W.h[k], target); else W.h[k] = lerp(target, W.h[k], smooth(clamp((t - 1) * l.r / 10, 0, 1)));
  });
  // ---- flatten monuments
  for (const m of W.monuments) {
    let t = H(m.x, m.z); if (MONUMENTS[m.type].coast) t = 1.0; t = Math.max(0.8, t);
    m.y = t;
    const r = m.size;
    forDisc(m.x, m.z, r + 16, (k, d) => {
      if (d < r) { W.h[k] = t; W.flat[k] = 1; }
      else W.h[k] = lerp(t, W.h[k], smooth((d - r) / 16));
    });
  }
  // ---- roads: heights follow a smoothed profile; mark mask
  for (const p of W.roads) {
    const hs = p.map(q => Math.max(0.45, H(q[0], q[1])));
    for (let pass = 0; pass < 4; pass++) for (let i = 1; i < hs.length - 1; i++) hs[i] = (hs[i - 1] + hs[i] * 2 + hs[i + 1]) / 4;
    p.hs = hs;
    for (let i = 0; i < p.length - 1; i++) {
      const [x0, z0] = p[i], [x1, z1] = p[i + 1]; const L = dist(x0, z0, x1, z1); const n = Math.ceil(L / 1.5);
      for (let s = 0; s <= n; s++) {
        const t = s / n, x = lerp(x0, x1, t), z = lerp(z0, z1, t), hh = lerp(hs[i], hs[i + 1], t);
        forDisc(x, z, 9, (k, d) => {
          if (W.flat[k]) return;
          if (d < 4.2) { W.h[k] = hh; W.road[k] = 1; }
          else { const b = smooth((d - 4.2) / 4.8); W.h[k] = lerp(hh, W.h[k], b); }
        });
      }
    }
  }
  // ---- biomes
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, x = i * RES, z = j * RES, h = W.h[k], e = elev(x, z);
    let b;
    if (h < WATER_Y - 0.05) b = e < 0.02 ? B.OCEAN : B.LAKE;
    else if (h < 1.6 && e < 0.1) b = B.BEACH;
    else {
      const lat = z / WORLD + nD.fbm(x / 180, z / 180, 3) * 0.12;
      if (h > 11.5 && mountMask(x, z) > 0.5) b = B.ROCK;
      else if (lat < 0.27) b = B.SNOW;
      else if (lat > 0.72) b = B.ARID;
      else b = nB.fbm(x / 90 + 40, z / 90 - 20, 3) > 0.02 ? B.FOREST : B.GRASS;
    }
    W.biome[k] = b;
  }
  W.biomeAt = (x, z) => W.biome[idx(x, z)];
  W.isRoad = (x, z) => W.road[idx(x, z)] === 1;
  W.isFlat = (x, z) => W.flat[idx(x, z)] === 1;
  W.isWater = (x, z) => H(x, z) < WATER_Y - 0.05;
  W.walkable = (x, z) => x > 2 && z > 2 && x < WORLD - 2 && z < WORLD - 2 && H(x, z) > WATER_Y - 0.9;
  // ---- scatter
  const nearMon = (x, z, pad) => W.monuments.some(m => dist(m.x, m.z, x, z) < m.size + pad);
  const nearRoad = (x, z) => { const k = idx(x, z); return W.road[k] === 1; };
  const roadPad = (x, z, r) => { for (const [ox, oz] of [[r, 0], [-r, 0], [0, r], [0, -r]]) if (nearRoad(x + ox, z + oz)) return true; return nearRoad(x, z); };
  let vid = 1;
  const addVeg = (kind, x, z, s = 1) => W.veg.push({ id: vid++, kind, x, z, s, ry: R() * Math.PI * 2 });
  const CS = 4;
  for (let gz = 4; gz < WORLD - 4; gz += CS) for (let gx = 4; gx < WORLD - 4; gx += CS) {
    const x = gx + R() * CS, z = gz + R() * CS; const h = H(x, z); if (h < 0.4) continue;
    const b = W.biomeAt(x, z); if (b === B.OCEAN || b === B.LAKE) continue;
    const mon = nearMon(x, z, 6), road = roadPad(x, z, 3);
    const dens = nA.fbm(x / 50, z / 50, 2) * 0.5 + 0.5;
    const r = R();
    if (!mon && !road) {
      if (b === B.FOREST) {
        const tt = 0.3 + dens * 0.3;
        if (r < tt) addVeg(R() < 0.55 ? 'pine' : R() < 0.75 ? 'oak' : 'birch', x, z, R.range(0.8, 1.25));
        else if (r < tt + 0.1) addVeg(R() < 0.6 ? 'bush' : 'fern', x, z, R.range(0.7, 1.3));
        else if (r < tt + 0.12) addVeg('mushroom', x, z);
        else if (r < tt + 0.13) addVeg('stump', x, z, R.range(0.8, 1.2));
        else if (r < tt + 0.137) addVeg('log_fallen', x, z, R.range(0.8, 1.2));
      } else if (b === B.GRASS) {
        if (r < 0.035 + dens * 0.04) addVeg(R() < 0.6 ? 'oak' : 'birch', x, z, R.range(0.8, 1.2));
        else if (r < 0.06) addVeg('bush', x, z, R.range(0.7, 1.2));
        else if (r < 0.078) addVeg('hemp', x, z);
        else if (r < 0.088) addVeg('berry_bush', x, z);
      } else if (b === B.SNOW) {
        if (r < 0.1 + dens * 0.16) addVeg('pine_snow', x, z, R.range(0.8, 1.3));
        else if (r < 0.12) addVeg('dead', x, z, R.range(0.8, 1.2));
      } else if (b === B.ARID) {
        if (r < 0.02) addVeg('cactus', x, z, R.range(0.7, 1.3));
        else if (r < 0.035) addVeg('dead', x, z, R.range(0.7, 1.1));
        else if (r < 0.06) addVeg('bush', x, z, R.range(0.5, 0.9));
      } else if (b === B.BEACH) {
        if (r < 0.012 && W.elev(x, z) > 0.03) addVeg('palm', x, z, R.range(0.8, 1.2));
        else if (r < 0.02) addVeg('log_fallen', x, z, R.range(0.7, 1));
      } else if (b === B.ROCK) {
        if (r < 0.05) addVeg('pine', x, z, R.range(0.6, 1));
      }
      // grass tufts for lushness
      if ((b === B.GRASS || b === B.FOREST) && R() < 0.55) addVeg('grass', x + R() * 2, z + R() * 2, R.range(0.7, 1.4));
      if (b === B.ARID && R() < 0.1) addVeg('grass', x, z, R.range(0.5, 0.9));
    }
    // boulders and resource nodes
    if (!mon && !road) {
      const rocky = b === B.ROCK ? 1 : mountMask(x, z) > 0.5 ? 0.6 : 0.25;
      if (R() < 0.0042 * rocky * 4) addVeg('boulder', x, z, R.range(0.7, 1.4));
      if (R() < 0.021 * (0.35 + rocky * 1.6)) {
        const t = R(); let type = t < 0.45 ? 'stone' : t < 0.8 ? 'metal' : 'sulfur';
        if (b === B.ROCK && R() < 0.12) type = 'hqm';
        if (b === B.ARID && type === 'stone' && R() < 0.4) type = 'sulfur';
        W.nodes.push({ id: vid++, type, x, z, s: R.range(0.85, 1.15), ry: R() * Math.PI * 2 });
      }
      if (b !== B.BEACH && R() < 0.0035) addVeg('rock_small', x, z, R.range(0.8, 1.4));
    }
  }
  // roadside barrels + wrecks
  for (const p of W.roads) for (let i = 2; i < p.length - 2; i += 2) {
    if (R() > 0.42) continue;
    const [x0, z0] = p[i], [x1, z1] = p[i + 1]; const L = dist(x0, z0, x1, z1) || 1; const side = R() < 0.5 ? -1 : 1;
    const nx = -(z1 - z0) / L * side, nz = (x1 - x0) / L * side;
    const x = x0 + nx * R.range(5.2, 7), z = z0 + nz * R.range(5.2, 7);
    if (nearMon(x, z, 4) || H(x, z) < 0.3) continue;
    const kind = R() < 0.12 ? 'car' : R() < 0.2 ? 'crate' : R() < 0.35 ? 'barrel_oil' : 'barrel';
    W.roadside.push({ kind, x, z, ry: Math.atan2(z1 - z0, x1 - x0) + (R() - 0.5) * 0.6, n: kind.startsWith('barrel') ? R.int(1, 3) : 1 });
  }
  // beach spawns
  for (let tries = 0; tries < 4000 && W.spawns.length < 40; tries++) {
    const a = R() * Math.PI * 2; let lo = 0, hi = IR * 1.2;
    for (let it = 0; it < 20; it++) { const mid = (lo + hi) / 2; if (elev(cx + Math.cos(a) * mid, cz + Math.sin(a) * mid) > 0.04) lo = mid; else hi = mid; }
    const x = cx + Math.cos(a) * lo, z = cz + Math.sin(a) * lo;
    if (H(x, z) < 0.4 || nearMon(x, z, 25)) continue;
    W.spawns.push({ x, z, a: a + Math.PI });
  }
  // chunk index for vegetation / nodes
  W.vegChunks = Array.from({ length: NCH * NCH }, () => []);
  for (const v of W.veg) { v.y = H(v.x, v.z); W.vegChunks[chunkOf(v.x, v.z)].push(v); }
  for (const n of W.nodes) n.y = H(n.x, n.z);
  return W;

  function forDisc(x, z, r, fn) {
    const i0 = Math.max(0, Math.floor((x - r) / RES)), i1 = Math.min(N - 1, Math.ceil((x + r) / RES));
    const j0 = Math.max(0, Math.floor((z - r) / RES)), j1 = Math.min(N - 1, Math.ceil((z + r) / RES));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const d = Math.hypot(i * RES - x, j * RES - z); if (d <= r) fn(j * N + i, d); }
  }
}

export function idx(x, z) { const i = clamp(Math.round(x / RES), 0, N - 1), j = clamp(Math.round(z / RES), 0, N - 1); return j * N + i; }
export function chunkOf(x, z) { const i = clamp(Math.floor(x / CHUNK), 0, NCH - 1), j = clamp(Math.floor(z / CHUNK), 0, NCH - 1); return j * NCH + i; }
export function sampleH(W, x, z) {
  const fx = clamp(x / RES, 0, N - 1.001), fz = clamp(z / RES, 0, N - 1.001);
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j; const h = W.h;
  const a = h[j * N + i], b = h[j * N + i + 1], c = h[(j + 1) * N + i], d = h[(j + 1) * N + i + 1];
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}
