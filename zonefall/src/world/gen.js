// ============================================================================
// ZONEFALL 3 — procedural island: heightfield, biomes, lakes, monument sites,
// roads (ring road + spurs), vegetation / resource scatter, beach spawns.
// Pure data, deterministic per seed. Rendering lives in gfx/terrain.js.
// ============================================================================
import { rng, makeNoise, clamp, smooth, lerp, dist } from '../util.js';
import { MONUMENTS } from '../data.js';

export const WORLD = 1500, RES = 2, N = WORLD / RES + 1, WATER_Y = 0, CHUNK = 64;
export const NCH = Math.ceil(WORLD / CHUNK);
export const B = { OCEAN: 0, BEACH: 1, GRASS: 2, FOREST: 3, ARID: 4, SNOW: 5, ROCK: 6, LAKE: 7 };

export function generateWorld(seed) {
  const R = rng(seed);
  const nA = makeNoise(seed + 1), nB = makeNoise(seed + 2), nC = makeNoise(seed + 3), nD = makeNoise(seed + 4);
  const W = {
    seed, size: WORLD, res: RES, n: N,
    powerlines: [],
    h: new Float32Array(N * N), biome: new Uint8Array(N * N), road: new Uint8Array(N * N), flat: new Uint8Array(N * N), sea: new Uint8Array(N * N), rail: new Uint8Array(N * N), river: new Uint8Array(N * N),
    monuments: [], roads: [], lakes: [], veg: [], nodes: [], spawns: [], roadside: [], railway: null, stations: [], rivers: [], ravines: [], bridges: [],
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
    if (e < 0) h = Math.max(-14, e * 55) + 0.1; // continuous with the land profile: clean waterlines at eye level
    else {
      h = smooth(clamp(e / 0.09, 0, 1)) * 2.2 + 0.1;
      h += Math.max(0, nB.fbm(x / 150, z / 150, 4) + 0.12) * 5.5 * smooth(clamp((e - 0.04) / 0.25, 0, 1));
      h += Math.pow(nC.ridge(x / 120, z / 120, 4), 2.2) * 15 * mountMask(x, z) * smooth(clamp((e - 0.18) / 0.3, 0, 1));
    }
    W.h[k] = h;
  }
  const H = (x, z) => sampleH(W, x, z);
  W.height = H;
  // ---- river courses: from springs in the hills out to the sea, meandering (carved later, after roads and rail)
  {
    const nRiv = 4, phase = R.range(0, 6.283);
    for (let r = 0; r < nRiv; r++) {
      const a0 = phase + r / nRiv * Math.PI * 2 + R.range(-0.35, 0.35);
      // spring: where the island elevation is ~0.62 along that bearing
      let lo = 0, hi = IR * 1.2; for (let it = 0; it < 22; it++) { const mid = (lo + hi) / 2; if (elev(cx + Math.cos(a0) * mid, cz + Math.sin(a0) * mid) > 0.62) lo = mid; else hi = mid; }
      let x = cx + Math.cos(a0) * lo, z = cz + Math.sin(a0) * lo; const pts = [[x, z]]; const wob = R.range(0, 100), turn = R.range(-0.5, 0.5);
      for (let s = 0, sea = 0; s < 500 && sea < 8; s++) {
        const out = Math.atan2(z - cz, x - cx);
        const ang = out + turn * Math.sin(s * 0.012) + 0.55 * nD(wob + s * 0.035, r * 7.1) + 0.25 * Math.sin(s * 0.11 + wob);
        x += Math.cos(ang) * 5; z += Math.sin(ang) * 5; pts.push([x, z]);
        if (x < 30 || z < 30 || x > WORLD - 30 || z > WORLD - 30) break;
        if (elev(x, z) < -0.02) sea++;
      }
      if (pts.length > 30) W.rivers.push({ pts, w0: 2.6, w1: 7.5 });
    }
  }
  const segDist = (px, pz, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1; const t = clamp(((px - ax) * dx + (pz - az) * dz) / L2, 0, 1); return Math.hypot(px - (ax + dx * t), pz - (az + dz * t)); };
  const riverDist = (x, z) => { let best = 1e9; for (const rv of W.rivers) for (let i = 0; i < rv.pts.length - 1; i += 1) { const a = rv.pts[i], b = rv.pts[i + 1]; if (Math.abs(a[0] - x) > best + 10 && Math.abs(a[1] - z) > best + 10) continue; best = Math.min(best, segDist(x, z, a[0], a[1], b[0], b[1])); } return best; };
  W.riverDist = riverDist;
  // ---- monument sites
  const placed = [];
  const order = Object.keys(MONUMENTS).sort((a, b) => MONUMENTS[b].size - MONUMENTS[a].size);
  for (const type of order) {
    const def = MONUMENTS[type]; if (def.late) continue; // newer monuments are placed after the rail (their own random stream) so older worlds keep their layout
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
        if (placed.some(p => dist(p.x, p.z, x, z) < p.size + r + 40 - rl * 34 + ((p.type === 'harbor' || type === 'harbor') && def.coast && MONUMENTS[p.type].coast ? 120 : 0))) continue; // keep harbor basins clear
        if (riverDist(x, z) < r + 22) continue; // keep clear of the river valleys
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
  // ---- railway: one loop through the interior, kept clear of monuments, with stations
  {
    const railE = 0.5; let pts = [];
    for (let s = 0; s < 240; s++) {
      const a = s / 240 * Math.PI * 2; let lo = 0, hi = IR * 1.2;
      for (let it = 0; it < 22; it++) { const mid = (lo + hi) / 2; if (elev(cx + Math.cos(a) * mid, cz + Math.sin(a) * mid) > railE) lo = mid; else hi = mid; }
      const rr = lo + nC(s * 0.17, 5.5) * 16;
      pts.push([cx + Math.cos(a) * rr, cz + Math.sin(a) * rr]);
    }
    const clear = () => { for (const p of pts) for (const m of W.monuments) { const d = dist(p[0], p[1], m.x, m.z), need = m.size + 16; if (d < need) { const k = need / Math.max(d, 0.01); p[0] = m.x + (p[0] - m.x) * k; p[1] = m.z + (p[1] - m.z) * k; } } };
    for (let pass = 0; pass < 10; pass++) {
      clear();
      pts = pts.map((p, i) => { const a = pts[(i - 1 + pts.length) % pts.length], b = pts[(i + 1) % pts.length]; return [(a[0] + p[0] * 2 + b[0]) / 4, (a[1] + p[1] * 2 + b[1]) / 4]; });
    }
    clear();
    // resample to an even 4 m spacing (closed loop)
    const ring2 = pts.concat([pts[0]]); const cum = [0];
    for (let i = 1; i < ring2.length; i++) cum.push(cum[i - 1] + dist(ring2[i - 1][0], ring2[i - 1][1], ring2[i][0], ring2[i][1]));
    const L = cum[cum.length - 1], n = Math.round(L / 4), out = [];
    for (let s = 0, j = 0; s < n; s++) {
      const d = s / n * L; while (cum[j + 1] < d) j++;
      const t = (d - cum[j]) / (cum[j + 1] - cum[j] || 1);
      out.push([lerp(ring2[j][0], ring2[j + 1][0], t), lerp(ring2[j][1], ring2[j + 1][1], t)]);
    }
    W.railway = { pts: out, len: L, step: L / n };
  }
  // ---- lakes (away from roads + monuments)
  for (let tries = 0, made = 0; tries < 3000 && made < 11; tries++) {
    const x = R.range(80, WORLD - 80), z = R.range(80, WORLD - 80), e = elev(x, z), r = R.range(9, 20);
    if (e < 0.22 || mountMask(x, z) > 0.75) continue;
    if (W.monuments.some(m => dist(m.x, m.z, x, z) < m.size + r + 25)) continue;
    if (W.roads.some(p => p.some(q => dist(q[0], q[1], x, z) < r + 14))) continue;
    if (W.railway && W.railway.pts.some(q => dist(q[0], q[1], x, z) < r + 18)) continue;
    if (W.lakes.some(l => dist(l.x, l.z, x, z) < l.r + r + 40)) continue;
    if (riverDist(x, z) < r + 30) continue;
    W.lakes.push({ x, z, r }); made++;
  }
  for (const l of W.lakes) forDisc(l.x, l.z, l.r + 10, (k, d) => {
    const t = d / l.r; const target = t < 1 ? WATER_Y - 1.6 * (1 - t * t) - 0.15 : WATER_Y + (t - 1) * 0.9 * (l.r / 10);
    if (t < 1) W.h[k] = Math.min(W.h[k], target); else W.h[k] = lerp(target, W.h[k], smooth(clamp((t - 1) * l.r / 10, 0, 1)));
  });
  // ---- flatten monuments
  const flattenMon = m => {
    let t = H(m.x, m.z); if (MONUMENTS[m.type].coast) t = 1.0; t = Math.max(0.8, t);
    m.y = t;
    const r = m.size;
    const coast = MONUMENTS[m.type].coast, sc = Math.cos(m.rot * Math.PI / 2), ss = Math.sin(m.rot * Math.PI / 2);
    forDisc(m.x, m.z, r + 16, (k, d) => {
      if (coast) { // the seaward side (+X local) drops into the sea so piers reach real water
        const x = (k % N) * RES, z = Math.floor(k / N) * RES; const proj = (x - m.x) * sc + (z - m.z) * ss;
        if (proj > r * 0.55) { const sea = lerp(t, -1.9, smooth(clamp((proj - r * 0.55) / (r * 0.12), 0, 1))); W.h[k] = d < r ? sea : Math.min(W.h[k], sea); W.sea[k] = 1; return; }
      }
      if (d < r) { W.h[k] = t; W.flat[k] = 1; }
      else W.h[k] = lerp(t, W.h[k], smooth((d - r) / 16));
    });
    // harbors get a dredged basin out front: the cargo ship swings in and out of its berth through here
    if (m.type === 'harbor') forDisc(m.x, m.z, 250, (k) => {
      const x = (k % N) * RES, z = Math.floor(k / N) * RES, proj = (x - m.x) * sc + (z - m.z) * ss, lat = -(x - m.x) * ss + (z - m.z) * sc;
      if (proj < r * 0.55 || proj > 240 || Math.abs(lat) > 125) return;
      let target = lerp(t, -2.8, smooth(clamp((proj - r * 0.55) / (r * 0.12), 0, 1)));
      target = lerp(target, 30, smooth(clamp((Math.abs(lat) - 100) / 25, 0, 1)));
      if (W.h[k] > target) { W.h[k] = target; if (target < 0) W.sea[k] = 1; }
    });
  };
  for (const m of W.monuments) flattenMon(m);
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
  // ---- railway bed: a gently graded profile, cut and filled into the terrain; stations beside it
  if (W.railway) {
    const R2 = W.railway, P2 = R2.pts, n = P2.length;
    let hs = P2.map(q => Math.max(1.0, H(q[0], q[1])));
    for (let pass = 0; pass < 40; pass++) hs = hs.map((h, i) => (hs[(i - 1 + n) % n] + h * 2 + hs[(i + 1) % n]) / 4);
    // limit the grade (max 5.5% per 4 m): pull peaks down / valleys up until the closed loop agrees
    for (let pass = 0, worst = 1; pass < 80 && worst > 0.005; pass++) {
      worst = 0;
      for (let dir = 0; dir < 2; dir++) for (let s = 0; s < n; s++) {
        const i = dir ? n - 1 - s : s, j = dir ? (i - 1 + n) % n : (i + 1) % n; const g = 0.22;
        const d = hs[j] - hs[i]; if (Math.abs(d) > g) { worst = Math.max(worst, Math.abs(d) - g); const fix = (Math.abs(d) - g) * Math.sign(d) * 0.5; hs[j] -= fix; hs[i] += fix; }
      }
    }
    R2.hs = hs;
    // stations: by each train yard, then spread around the loop (4 in all)
    const st = [];
    for (const m of W.monuments) if (m.type === 'trainyard') {
      let bi = 0, bd = 1e9; for (let i = 0; i < n; i++) { const d = dist(P2[i][0], P2[i][1], m.x, m.z); if (d < bd) { bd = d; bi = i; } }
      if (bd < 170 && !st.some(s => Math.min(Math.abs(s.i - bi), n - Math.abs(s.i - bi)) < n / 8)) st.push({ i: bi, yard: m });
    }
    // fill up to 4 stations, each as far along the loop from the others as possible
    const gap = i => st.length ? Math.min(...st.map(s => Math.min(Math.abs(s.i - i), n - Math.abs(s.i - i)))) : n;
    while (st.length < 4) {
      let bi = -1, bg = n / 7;
      for (let i = 0; i < n; i += 2) { const g = gap(i); if (g <= bg) continue; const [x, z] = P2[i]; if (W.monuments.some(m => dist(m.x, m.z, x, z) < m.size + 26)) continue; bg = g; bi = i; }
      if (bi < 0) break; st.push({ i: bi });
    }
    st.sort((a, b) => a.i - b.i);
    for (const s of st) {
      const [x, z] = P2[s.i], [x1, z1] = P2[(s.i + 1) % n]; const ang = Math.atan2(z1 - z, x1 - x);
      // platform on the side facing the island centre (or the yard)
      const tx = s.yard ? s.yard.x : cx, tz = s.yard ? s.yard.z : cz; const nx = -Math.sin(ang), nz = Math.cos(ang);
      const side = (tx - x) * nx + (tz - z) * nz > 0 ? 1 : -1;
      const names = ['Pine Halt', 'Dust Halt', 'Ridge Halt', 'Hollow Halt', 'North Halt'], used = W.stations.map(q => q.name);
      const name = s.yard ? (used.includes('Yard Halt') ? 'Freight Halt' : 'Yard Halt') : names.find(q => !used.includes(q)) || 'Halt';
      W.stations.push({ i: s.i, x, z, ang, side, y: hs[s.i], name });
    }
    for (let i = 0; i < n; i++) {
      const [x0, z0] = P2[i], [x1, z1] = P2[(i + 1) % n], h0 = hs[i], h1 = hs[(i + 1) % n];
      for (let s = 0; s <= 3; s++) {
        const t = s / 3, x = lerp(x0, x1, t), z = lerp(z0, z1, t), hh = lerp(h0, h1, t);
        forDisc(x, z, 10, (k, d) => {
          if (W.flat[k]) return;
          if (d < 2.8) { W.h[k] = hh - 0.05; W.rail[k] = 1; W.road[k] = 0; }
          else if (!W.rail[k]) { const b = smooth((d - 2.8) / 7.2); W.h[k] = lerp(hh - 0.05, W.h[k], b); }
        });
      }
    }
    // level ground under and around each station platform
    for (const s of W.stations) {
      const nx = -Math.sin(s.ang) * s.side, nz = Math.cos(s.ang) * s.side;
      for (let a = -12; a <= 12; a += 2) for (let o = 3; o <= 9; o += 2) {
        const x = s.x + Math.cos(s.ang) * a + nx * o, z = s.z + Math.sin(s.ang) * a + nz * o;
        forDisc(x, z, 2.2, k => { if (!W.rail[k]) { W.h[k] = s.y - 0.05; W.flat[k] = 1; } });
      }
    }
  }
  // ---- rivers: a channel cut just below sea level (the sea water fills it), inside a valley whose walls rise at a
  // walkable slope until they meet the hills, so rivers through high ground run in deep valleys. Roads and the
  // railway keep their own grade: an embankment carries them to a bridge over the channel.
  const keepH = new Float32Array(N * N).fill(-99); // road / rail heights to restore as embankments
  for (const p of W.roads) if (p.hs) for (let i = 0; i < p.length - 1; i++) { const [x0, z0] = p[i], [x1, z1] = p[i + 1]; const L = dist(x0, z0, x1, z1), n = Math.ceil(L / 2); for (let s = 0; s <= n; s++) { const t = s / n; const k = idx(lerp(x0, x1, t), lerp(z0, z1, t)); keepH[k] = Math.max(keepH[k], lerp(p.hs[i], p.hs[i + 1], t)); } }
  if (W.railway && W.railway.hs) { const P2 = W.railway.pts, hs2 = W.railway.hs, n2 = P2.length; for (let i = 0; i < n2; i++) { const [x0, z0] = P2[i], [x1, z1] = P2[(i + 1) % n2]; for (let s = 0; s <= 2; s++) { const t = s / 2; const k = idx(lerp(x0, x1, t), lerp(z0, z1, t)); keepH[k] = Math.max(keepH[k], lerp(hs2[i], hs2[(i + 1) % n2], t) - 0.05); } } }
  const nV = makeNoise(seed + 9);
  for (const rv of W.rivers) {
    const n = rv.pts.length;
    for (let i = 0; i < n; i++) {
      const [x, z] = rv.pts[i], t = i / (n - 1), w = lerp(rv.w0, rv.w1, t), bed = WATER_Y - lerp(0.9, 1.7, t);
      forDisc(x, z, w + 60, (k, d) => {
        if (W.flat[k] && !W.road[k] && !W.rail[k]) return; // monument pads stay (they keep clear of rivers anyway)
        if (d < w) { W.h[k] = Math.min(W.h[k], bed + (d / w) * (d / w) * 0.5); W.river[k] = 1; return; }
        const kx = (k % N) * RES, kz = Math.floor(k / N) * RES;
        const slope = 0.34 + 0.16 * (nV.fbm(kx / 70, kz / 70, 2) + 0.5);
        const rise = d - w; W.h[k] = Math.min(W.h[k], WATER_Y + 0.12 + rise * slope + rise * rise * 0.0035);
      });
    }
  }
  // dry ravines: shorter valleys cut into hill country (no water), away from roads and the railway
  for (let tries = 0, made = 0; tries < 900 && made < 3; tries++) {
    const x0 = R.range(120, WORLD - 120), z0 = R.range(120, WORLD - 120); if (elev(x0, z0) < 0.3 || H(x0, z0) < 9) continue;
    if (riverDist(x0, z0) < 60 || W.monuments.some(m => dist(m.x, m.z, x0, z0) < m.size + 28)) continue;
    // run through the high ground: of 8 headings, take the one whose path stays highest
    const len = R.range(110, 180); let pts = null, bestLow = -1;
    for (let q = 0; q < 8; q++) { const a = q / 8 * 6.283 + R.range(-0.2, 0.2), cand = []; let low = 99; for (let s = 0; s <= len; s += 4) { const ang = a + 0.4 * Math.sin(s * 0.02 + tries); const x = x0 + Math.cos(ang) * s, z = z0 + Math.sin(ang) * s; cand.push([x, z]); low = Math.min(low, H(x, z)); } if (low > bestLow) { bestLow = low; pts = cand; } }
    if (bestLow < 6) continue;
    // depth tapers to nothing near roads, rails, monuments and the ends
    const near = pts.map(([x, z]) => { for (let q = 0; q < 12; q++) { const aa = q / 12 * 6.283; for (const f of [6, 14, 22]) { const kk = idx(x + Math.cos(aa) * f, z + Math.sin(aa) * f); if (W.road[kk] || W.rail[kk] || W.flat[kk]) return 1; } } return 0; });
    let mul = pts.map((_, i) => near[i] ? 0 : Math.min(1, i / 8, (pts.length - 1 - i) / 8));
    for (let pass = 0; pass < 4; pass++) mul = mul.map((m, i) => Math.min(m, ((mul[i - 1] ?? 0) + m * 2 + (mul[i + 1] ?? 0)) / 4 + 0.001));
    if (mul.filter(m => m > 0.6).length < 9) continue;
    const orig = pts.map(([x, z]) => H(x, z)); // measure before cutting (overlapping cuts must not compound)
    for (let i = 0; i < pts.length; i++) {
      const [x, z] = pts[i], depth = Math.min(10, orig[i] - 2.5) * mul[i]; if (depth < 0.3) continue; const floor = Math.max(2, orig[i] - depth);
      forDisc(x, z, 34, (k, d) => { if (W.flat[k] || W.road[k] || W.rail[k]) return; const w = 3.5; const target = d < w ? floor : floor + (d - w) * 0.62; W.h[k] = Math.min(W.h[k], lerp(W.h[k], target, mul[i])); });
    }
    W.ravines.push({ pts }); made++;
  }
  // embankments: roads and the railway keep their grade right up to the channel
  for (let k = 0; k < N * N; k++) {
    if (keepH[k] < -50) continue; const kx = (k % N) * RES, kz = Math.floor(k / N) * RES;
    forDisc(kx, kz, 12, (q, d) => { if (W.river[q]) return; const want = keepH[k] - 0.15 - Math.max(0, d - 4.2) * 0.75; if (W.h[q] < want) W.h[q] = want; });
  }
  // bridges where a road or the railway crosses a river channel
  const addBridges = (pts, hs, closed, w, rail) => {
    const n = pts.length; let run = null;
    const flush = () => {
      // a road that runs *along* a river for a stretch gets a causeway instead of a long bridge
      if (run && run.pts.length > 17) { for (const [x, z, y] of run.pts) forDisc(x, z, 6.5, (k, d) => { W.river[k] = 0; W.h[k] = Math.max(W.h[k], y - 0.15 - Math.max(0, d - 4.2) * 0.6); }); run = null; return; }
      if (run && run.pts.length > 1) { const a = run.pts[0], b = run.pts[run.pts.length - 1]; const ext = 3, L = dist(a[0], a[1], b[0], b[1]) || 1, ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L; W.bridges.push({ x0: a[0] - ux * ext, z0: a[1] - uz * ext, x1: b[0] + ux * ext, z1: b[1] + uz * ext, y0: a[2], y1: b[2], w, rail }); } run = null; };
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const [x0, z0] = pts[i], [x1, z1] = pts[(i + 1) % n], L = dist(x0, z0, x1, z1), m = Math.max(1, Math.ceil(L / 2));
      for (let s = 0; s < m; s++) { const t = s / m, x = lerp(x0, x1, t), z = lerp(z0, z1, t), y = lerp(hs[i], hs[(i + 1) % n], t) + (rail ? 0 : 0);
        if (W.river[idx(x, z)]) { if (!run) run = { pts: [] }; run.pts.push([x, z, y]); } else flush(); }
    }
    flush();
  };
  for (const p of W.roads) if (p.hs) addBridges(p, p.hs, false, 9, false);
  if (W.railway && W.railway.hs) addBridges(W.railway.pts, W.railway.hs, true, 5, true);
  // ---- late monuments: own random stream, clear of roads, rails, stations and older monuments
  {
    const R3 = rng((seed ^ 0x6d2b79f5) >>> 0);
    const clearOf = (x, z, r) => { for (let a = 0; a < 24; a++) for (const f of [0, 0.5, 1]) { const px = x + Math.cos(a / 24 * 6.283) * r * f, pz = z + Math.sin(a / 24 * 6.283) * r * f; if (px < 4 || pz < 4 || px > WORLD - 4 || pz > WORLD - 4) return false; const k = idx(px, pz); if (W.road[k] || W.rail[k] || W.river[k]) return false; } return true; };
    for (const type of Object.keys(MONUMENTS).filter(t => MONUMENTS[t].late).sort((a, b) => MONUMENTS[b].size - MONUMENTS[a].size)) { // biggest first
      const def = MONUMENTS[type];
      for (let c = 0; c < def.count; c++) {
        let best = null;
        for (let tries = 0; tries < 4000 && !best; tries++) {
          const x = R3.range(60, WORLD - 60), z = R3.range(60, WORLD - 60), e = elev(x, z), rl = tries / 4000, r = def.size;
          if (def.coast) { if (e < 0.03 - rl * 0.02 || e > 0.1 + rl * 0.05) continue; }
          else if (def.tier >= 2) { if (e < 0.22 - rl * 0.08) continue; }
          else if (e < 0.14 - rl * 0.06) continue;
          let hmin = 99, hmax = -99, wet = 0;
          for (let s = 0; s < 16; s++) { const a = s / 16 * Math.PI * 2; for (const f of [0.4, 0.9]) { const hh = H(x + Math.cos(a) * r * f, z + Math.sin(a) * r * f); hmin = Math.min(hmin, hh); hmax = Math.max(hmax, hh); if (hh < 0.3) wet++; } }
          if (!def.coast && (hmax - hmin > 7 + tries * 0.004 || wet > 0)) continue;
          if (W.monuments.some(p => dist(p.x, p.z, x, z) < p.size + r + 30 - rl * 18 + (p.type === 'harbor' ? 130 : 0))) continue; // harbors keep their ship basin clear
          if (W.stations.some(s => dist(s.x, s.z, x, z) < r + 30)) continue;
          if (W.lakes.some(l => dist(l.x, l.z, x, z) < l.r + r + 12)) continue;
          if (riverDist(x, z) < r + 24) continue;
          if (!clearOf(x, z, r + 18)) continue;
          best = { x, z };
        }
        if (!best) continue;
        let rot = R3.int(0, 3);
        if (def.coast) { const a = Math.atan2(best.z - cz, best.x - cx); rot = ((Math.round(a / (Math.PI / 2)) % 4) + 4) % 4; }
        const m = { type, name: def.name, x: Math.round(best.x), z: Math.round(best.z), rot, size: def.size, tier: def.tier, idx: c, late: true };
        W.monuments.push(m); flattenMon(m);
      }
    }
  }
  // ---- power lines: a network (minimum spanning tree) from the Reactor Sector out to the big sites,
  // pylons every ~40 m, kept out of water, roads, rails and monument pads
  {
    const RP = rng((seed ^ 0x2545f491) >>> 0);
    const hubs = W.monuments.filter(m => ['reactor', 'water', 'trainyard', 'harbor', 'airfield', 'dish', 'garrison', 'observatory', 'quarry', 'gas', 'mart', 'village', 'haven', 'lighthouse', 'radio', 'fishvillage'].includes(m.type));
    const start = hubs.find(m => m.type === 'reactor') || hubs[0];
    if (start && hubs.length > 1) {
      const inT = [start], left = hubs.filter(m => m !== start), edges = [];
      while (left.length) { let bi = -1, bj = -1, bd = 1e12; inT.forEach((a, i) => left.forEach((b, j) => { const d = dist(a.x, a.z, b.x, b.z); if (d < bd) { bd = d; bi = i; bj = j; } })); edges.push([inT[bi], left[bj]]); inT.push(left[bj]); left.splice(bj, 1); }
      const okSpot = (x, z) => { if (x < 20 || z < 20 || x > WORLD - 20 || z > WORLD - 20) return false; if (H(x, z) < 0.5) return false; for (const [ox, oz] of [[0, 0], [2.5, 0], [-2.5, 0], [0, 2.5], [0, -2.5]]) { const k = idx(x + ox, z + oz); if (W.road[k] || W.rail[k] || W.flat[k] || W.river[k]) return false; } return true; };
      for (const [a, b] of edges) {
        const d = dist(a.x, a.z, b.x, b.z), ux = (b.x - a.x) / d, uz = (b.z - a.z) / d, px = -uz, pz = ux;
        const s0 = a.size * 0.9 + 8, s1 = d - b.size * 0.9 - 8; if (s1 - s0 < 60) continue;
        const n = Math.max(2, Math.round((s1 - s0) / 40)), pts = [];
        for (let i = 0; i <= n; i++) {
          const s = lerp(s0, s1, i / n), j = (i && i < n) ? RP.range(-3, 3) : 0; let got = null;
          for (const [ds, dl] of [[0, 0], [4, 0], [-4, 0], [0, 6], [0, -6], [9, 0], [-9, 0], [0, 12], [0, -12], [14, 6], [-14, -6]]) { const x = a.x + ux * (s + ds) + px * (j + dl), z = a.z + uz * (s + ds) + pz * (j + dl); if (okSpot(x, z)) { got = [x, z]; break; } }
          if (got) pts.push([got[0], got[1], H(got[0], got[1])]);
        }
        // split where a gap got too long (a lake or a big monument in the way)
        let cur = [pts[0]];
        for (let i = 1; i < pts.length; i++) { if (dist(pts[i][0], pts[i][1], pts[i - 1][0], pts[i - 1][1]) > 70) { if (cur.length > 2) W.powerlines.push({ pts: cur }); cur = []; } cur.push(pts[i]); }
        if (cur.length > 2) W.powerlines.push({ pts: cur });
      }
      // trunk lines: five long runs from the Reactor Sector out to the coast (the best zipline rides)
      const a0 = RP.range(0, 6.283);
      for (let t = 0; t < 5; t++) {
        let ang = a0 + t / 5 * Math.PI * 2 + RP.range(-0.25, 0.25), x = start.x + Math.cos(ang) * (start.size + 10), z = start.z + Math.sin(ang) * (start.size + 10);
        let cur = [];
        for (let s = 0; s < 40; s++) {
          let got = null;
          for (const [ds, dl] of [[0, 0], [5, 0], [-5, 0], [0, 6], [0, -6], [10, 0], [0, 12], [0, -12], [-10, 0], [15, 8], [15, -8]]) { const px = x + Math.cos(ang) * ds - Math.sin(ang) * dl, pz = z + Math.sin(ang) * ds + Math.cos(ang) * dl; if (okSpot(px, pz) && !W.monuments.some(m => dist(m.x, m.z, px, pz) < m.size + 4)) { got = [px, pz]; break; } }
          if (got) { if (cur.length && dist(got[0], got[1], cur[cur.length - 1][0], cur[cur.length - 1][1]) > 72) { if (cur.length > 2) W.powerlines.push({ pts: cur }); cur = []; } cur.push([got[0], got[1], H(got[0], got[1])]); }
          ang += RP.range(-0.12, 0.12); x += Math.cos(ang) * 42; z += Math.sin(ang) * 42;
          if (elev(x, z) < 0.05) break;
        }
        if (cur.length > 2) W.powerlines.push({ pts: cur });
      }
    }
  }
  // ---- biomes
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, x = i * RES, z = j * RES, h = W.h[k], e = elev(x, z);
    let b;
    if (h < WATER_Y - 0.05) b = e < 0.02 || W.sea[k] ? B.OCEAN : B.LAKE;
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
  W.onRail = (x, z, r = 0) => { if (W.rail[idx(x, z)]) return true; if (r > 0) for (const [ox, oz] of [[r, 0], [-r, 0], [0, r], [0, -r], [r * 0.7, r * 0.7], [-r * 0.7, r * 0.7], [r * 0.7, -r * 0.7], [-r * 0.7, -r * 0.7]]) if (W.rail[idx(x + ox, z + oz)]) return true; return false; };
  W.walkable = (x, z) => x > 2 && z > 2 && x < WORLD - 2 && z < WORLD - 2 && H(x, z) > WATER_Y - 0.9;
  // ---- scatter
  const nearMon = (x, z, pad) => W.monuments.some(m => dist(m.x, m.z, x, z) < m.size + pad) || W.stations.some(s => dist(s.x, s.z, x, z) < 16 + pad);
  const nearRoad = (x, z) => { const k = idx(x, z); return W.road[k] === 1; };
  const nearRail = (x, z) => W.rail[idx(x, z)] === 1;
  const roadPad = (x, z, r) => { for (const [ox, oz] of [[r, 0], [-r, 0], [0, r], [0, -r], [r * 1.6, 0], [-r * 1.6, 0], [0, r * 1.6], [0, -r * 1.6]]) if (nearRoad(x + ox, z + oz) || nearRail(x + ox, z + oz)) return true; return nearRoad(x, z) || nearRail(x, z); };
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
    if (R() > 0.55) continue;
    const [x0, z0] = p[i], [x1, z1] = p[i + 1]; const L = dist(x0, z0, x1, z1) || 1; const side = R() < 0.5 ? -1 : 1;
    const nx = -(z1 - z0) / L * side, nz = (x1 - x0) / L * side;
    const x = x0 + nx * R.range(5.2, 7), z = z0 + nz * R.range(5.2, 7);
    if (nearMon(x, z, 4) || H(x, z) < 0.3) continue;
    if (W.rail[idx(x, z)] || W.rail[idx(x + 2, z)] || W.rail[idx(x - 2, z)] || W.rail[idx(x, z + 2)] || W.rail[idx(x, z - 2)]) continue;
    const kind = R() < 0.12 ? 'car' : R() < 0.2 ? 'crate' : R() < 0.35 ? 'barrel_oil' : 'barrel';
    W.roadside.push({ kind, x, z, ry: Math.atan2(z1 - z0, x1 - x0) + (R() - 0.5) * 0.6, n: kind.startsWith('barrel') ? R.int(1, 3) : 1 });
  }
  // beach spawns
  for (let tries = 0; tries < 6000 && W.spawns.length < 60; tries++) {
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
