// ============================================================================
// ZONEFALL 3 — procedural island: heightfield, biomes, lakes, monument sites,
// roads (ring road + spurs), vegetation / resource scatter, beach spawns.
// Pure data, deterministic per seed. Rendering lives in gfx/terrain.js.
// ============================================================================
import { rng, makeNoise, clamp, smooth, lerp, dist } from '../util.js';
import { MONUMENTS } from '../data.js';

export const WORLD = 1920, RES = 2, N = WORLD / RES + 1, WATER_Y = 0, CHUNK = 64;
export const NCH = Math.ceil(WORLD / CHUNK);
/** how much bigger the island is than the original 1.5 km one: things along the coast or a loop scale with LIN_K,
 * things spread over the land with AREA_K, so their density stays the same */
export const LIN_K = WORLD / 1500, AREA_K = LIN_K * LIN_K;
/** how many of a monument type the generator places: unique sites (count 1) stay unique */
export const countOf = def => def.count <= 1 ? def.count : Math.round(def.count * (def.coast ? LIN_K : AREA_K));
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
  // island "elevation" 0 at coast, 1 at centre. The coastline's wobble only depends on the bearing: tabulated
  const CT = 4096, coastT = new Float32Array(CT + 1);
  for (let q = 0; q <= CT; q++) { const a = q / CT * Math.PI * 2 - Math.PI; coastT[q] = nA.fbm(Math.cos(a) * 1.6 + 7, Math.sin(a) * 1.6 + 3, 3); }
  const elev = (x, z) => {
    const dx = x - cx, dz = z - cz, f = (Math.atan2(dz, dx) + Math.PI) / (Math.PI * 2) * CT, q = Math.min(CT - 1, Math.floor(f)), c = coastT[q] + (coastT[q + 1] - coastT[q]) * (f - q);
    const coast = IR * (0.84 + 0.16 * c * 1.6 + 0.05 * nB(x / 60, z / 60));
    return 1 - Math.hypot(dx, dz) / coast;
  };
  W.elev = elev;
  const mountMask = (x, z) => smooth(clamp((nC.fbm(x / 260 + 11, z / 260 - 4, 2) + 0.05) * 3.2, 0, 1));
  // ---- base heights + biomes
  const E = new Float32Array(N * N); // elev per cell (the biome pass needs it again)
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = i * RES, z = j * RES, e = elev(x, z), k = j * N + i; E[k] = e;
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
    const nRiv = Math.round(4 * LIN_K), phase = R.range(0, 6.283);
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
  // distance to the nearest river centre line: exact out to ~130 m (1e9 when there's none that close). Segments are
  // bucketed in 32 m cells
  const RG = 32, RGN = Math.ceil(WORLD / RG), rgrid = Array.from({ length: RGN * RGN }, () => []), rcl = v => clamp(Math.floor(v / RG), 0, RGN - 1);
  for (const rv of W.rivers) for (let i = 0; i < rv.pts.length - 1; i++) { const a = rv.pts[i], b = rv.pts[i + 1]; for (let cj = rcl(Math.min(a[1], b[1])); cj <= rcl(Math.max(a[1], b[1])); cj++) for (let ci = rcl(Math.min(a[0], b[0])); ci <= rcl(Math.max(a[0], b[0])); ci++) rgrid[cj * RGN + ci].push(a[0], a[1], b[0], b[1]); }
  const riverDist = (x, z) => {
    let best = 1e9; const ci = rcl(x), cj = rcl(z);
    for (let j = Math.max(0, cj - 5); j <= Math.min(RGN - 1, cj + 5); j++) for (let i = Math.max(0, ci - 5); i <= Math.min(RGN - 1, ci + 5); i++) { const L = rgrid[j * RGN + i]; for (let q = 0; q < L.length; q += 4) { const d = segDist(x, z, L[q], L[q + 1], L[q + 2], L[q + 3]); if (d < best) best = d; } }
    return best;
  };
  W.riverDist = riverDist;
  // ---- coastal sites: face the quarter-turn that reaches open water soonest (ties go to the one facing away from
  // the island centre), so the sea side isn't blocked by a headland or the far shore of a bay
  /** distance along direction a from a site (radius r) to where properly deep water starts and stays deep, or 1e9 */
  const openSeaAt = (x, z, a, r, far = 320, thr = -1.8, need = 8) => { const c = Math.cos(a), s = Math.sin(a); let run = 0;
    for (let d = r * 0.55; d < r * 0.55 + far; d += 3) { let deep = true; for (const l of [-r * 0.35, 0, r * 0.35]) if (H(x + c * d - s * l, z + s * d + c * l) > thr) { deep = false; break; } if (deep) { if (++run >= need) return d - (need - 1) * 3; } else run = 0; }
    return 1e9; };
  const coastRot = (x, z, r) => {
    const ar = Math.atan2(z - cz, x - cx), radial = ((Math.round(ar / (Math.PI / 2)) % 4) + 4) % 4;
    let best = radial, bd = openSeaAt(x, z, radial * Math.PI / 2, r) - 25;
    for (let q = 0; q < 4; q++) { if (q === radial) continue; const d = openSeaAt(x, z, q * Math.PI / 2, r); if (d < bd) { bd = d; best = q; } }
    return best;
  };
  // ---- monument sites
  const placed = [];
  const order = Object.keys(MONUMENTS).sort((a, b) => MONUMENTS[b].size - MONUMENTS[a].size);
  for (const type of order) {
    const def = MONUMENTS[type]; if (def.late) continue; // newer monuments are placed after the rail (their own random stream) so older worlds keep their layout
    for (let c = 0; c < countOf(def); c++) {
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
      if (def.coast) rot = coastRot(best.x, best.z, def.size);
      const m = { type, name: def.name, x: Math.round(best.x), z: Math.round(best.z), rot, size: def.size, tier: def.tier, idx: c };
      placed.push(m); W.monuments.push(m);
    }
  }
  // ---- ring road
  const ring = [];
  const ringE = 0.2;
  const nRing = Math.round(160 * LIN_K); // ~20 m apart
  for (let s = 0; s < nRing; s++) {
    const a = s / nRing * Math.PI * 2; let lo = 0, hi = IR * 1.2;
    for (let it = 0; it < 22; it++) { const mid = (lo + hi) / 2; if (elev(cx + Math.cos(a) * mid, cz + Math.sin(a) * mid) > ringE) lo = mid; else hi = mid; }
    const rr = lo + nD(s * 0.3 / LIN_K, 2) * 10;
    ring.push([cx + Math.cos(a) * rr, cz + Math.sin(a) * rr]);
  }
  ring.push(ring[0].slice());
  W.roads.push(ring);
  // spurs: every monument links to the ring with a gently curved road. It joins the ring away from the rivers, so
  // a junction never sits on a bridge
  for (const m of W.monuments) {
    let bi = 0, bd = 1e9, bs = 1e9;
    for (let i = 0; i < ring.length - 1; i++) { const d = dist(ring[i][0], ring[i][1], m.x, m.z), sc = d + (riverDist(ring[i][0], ring[i][1]) < 30 ? 80 : 0); if (sc < bs) { bs = sc; bd = d; bi = i; } }
    const end = ring[bi];
    if (bd < m.size * 0.6) continue; // the ring passes through
    const pts = []; const steps = Math.max(2, Math.ceil(bd / 8));
    const nx = -(end[1] - m.z) / bd, nz = (end[0] - m.x) / bd, bend = R.range(-0.12, 0.12) * bd;
    for (let s = 0; s <= steps; s++) { const t = s / steps, b = Math.sin(t * Math.PI) * bend; pts.push([lerp(m.x, end[0], t) + nx * b, lerp(m.z, end[1], t) + nz * b]); }
    // a spur that comes alongside an earlier one joins it there, rather than running beside it to the ring
    for (let i = 1; i < pts.length - 1; i++) {
      const [x, z] = pts[i]; if (dist(x, z, m.x, m.z) < m.size + 12 || riverDist(x, z) < 30) continue;
      let hit = null;
      for (const q of W.roads.slice(1)) for (let j = 0; j < q.length - 1; j++) {
        const a = q[j], b = q[j + 1], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1, t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / L2, 0, 1), px = a[0] + dx * t, pz = a[1] + dz * t;
        if (Math.hypot(x - px, z - pz) < 10 && dist(px, pz, q[0][0], q[0][1]) > 40 && (!hit || Math.hypot(x - px, z - pz) < hit[2])) hit = [px, pz, Math.hypot(x - px, z - pz)];
      }
      if (hit) { pts.length = i; pts.push([hit[0], hit[1]]); break; }
    }
    m.roadFrom = pts[0]; W.roads.push(pts);
  }
  // ---- railway: one loop through the interior, kept clear of monuments, with stations
  {
    const railE = 0.5; let pts = []; const nRail = Math.round(240 * LIN_K);
    for (let s = 0; s < nRail; s++) {
      const a = s / nRail * Math.PI * 2; let lo = 0, hi = IR * 1.2;
      for (let it = 0; it < 22; it++) { const mid = (lo + hi) / 2; if (elev(cx + Math.cos(a) * mid, cz + Math.sin(a) * mid) > railE) lo = mid; else hi = mid; }
      const rr = lo + nC(s * 0.17 / LIN_K, 5.5) * 16;
      pts.push([cx + Math.cos(a) * rr, cz + Math.sin(a) * rr]);
    }
    const clear = () => { for (const p of pts) for (const m of W.monuments) { const d = dist(p[0], p[1], m.x, m.z), need = m.size + 22; if (d < need) { const k = need / Math.max(d, 0.01); p[0] = m.x + (p[0] - m.x) * k; p[1] = m.z + (p[1] - m.z) * k; } } };
    for (let pass = 0; pass < 40; pass++) { // enough passes that a detour round a site eases in and out
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
  // roads don't run along rivers: a bend that strays into a river's course is pushed out to run beside it, so a road
  // only ever crosses a river (no long bridge down the middle of one). Ends and junctions stay put.
  {
    const keep = new Set(); for (const p of W.roads.slice(1)) { keep.add(p[0]); keep.add(p[p.length - 1]); }
    const ends = W.roads.slice(1).map(p => p[p.length - 1]);
    const nearest = (x, z) => { let best = null, bd = 1e9; for (const rv of W.rivers) for (let i = 0; i < rv.pts.length - 1; i++) { const a = rv.pts[i], b = rv.pts[i + 1]; if (Math.abs(a[0] - x) > 40 || Math.abs(a[1] - z) > 40) continue; const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1, t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / L2, 0, 1), px = a[0] + dx * t, pz = a[1] + dz * t, d = Math.hypot(x - px, z - pz); if (d < bd) { bd = d; best = [px, pz, d]; } } return best; };
    for (const [ri, p] of W.roads.entries()) for (let i = 0; i < p.length; i++) {
      const q = p[i]; if (keep.has(q) || ends.some(e => Math.hypot(e[0] - q[0], e[1] - q[1]) < 0.01)) continue;
      const nr = nearest(q[0], q[1]); if (!nr || nr[2] >= 16 || nr[2] < 0.5) continue;
      // only where the road runs along the river here (its neighbours are by the river too), not where it crosses
      const nbr = [-2, -1, 1, 2].map(d => p[clamp(i + d, 0, p.length - 1)]), nn = nbr.map(o => nearest(o[0], o[1]));
      if (nn[1] === null || nn[2] === null || nn[1][2] > 22 || nn[2][2] > 22) continue;
      const across = (o, n) => n && n[2] < 40 && (o[0] - n[0]) * (q[0] - nr[0]) + (o[1] - n[1]) * (q[1] - nr[1]) < 0;
      if (nbr.some((o, j) => across(o, nn[j]))) continue; // near where the road crosses the river: leave it
      const k = 16 / nr[2]; q[0] = nr[0] + (q[0] - nr[0]) * k; q[1] = nr[1] + (q[1] - nr[1]) * k;
      if (ri === 0 && i === 0) p[p.length - 1] = q.slice();
    }
  }
  // roads cross rivers in a straight line: the stretch over a river and 14 m either side becomes one straight run, so
  // each bridge is a single straight deck (a bend on a bridge would leave a gap at the joint)
  {
    const junction = new Set(W.roads.slice(1).map(p => p[p.length - 1][0].toFixed(3) + ',' + p[p.length - 1][1].toFixed(3)));
    for (const [ri, p] of W.roads.entries()) {
      const cum = [0]; for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + dist(p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]));
      const tot = cum[p.length - 1], at = s => { let i = 0; while (i < p.length - 2 && cum[i + 1] < s) i++; const t = clamp((s - cum[i]) / (cum[i + 1] - cum[i] || 1), 0, 1); return [lerp(p[i][0], p[i + 1][0], t), lerp(p[i][1], p[i + 1][1], t)]; };
      const runs = [];
      for (let s = 0; s <= tot; s += 2) { const [x, z] = at(s); if (riverDist(x, z) < 12) { const last = runs[runs.length - 1]; if (last && s - last[1] <= 10) last[1] = s; else runs.push([s, s]); } }
      for (let q = runs.length - 1; q >= 0; q--) {
        const sa = runs[q][0] - 14, sb = runs[q][1] + 14; if (sa < 10 || sb > tot - 10) continue; // too near a spur's ends (or the ring's seam)
        const inner = []; for (let i = 0; i < p.length; i++) if (cum[i] > sa && cum[i] < sb) inner.push(i);
        if (inner.some(i => junction.has(p[i][0].toFixed(3) + ',' + p[i][1].toFixed(3)))) continue;
        const A = at(sa), Bp = at(sb), i0 = inner.length ? inner[0] : p.findIndex((_, i) => cum[i] > sa);
        p.splice(i0, inner.length, A, Bp);
      }
      if (ri === 0) p[p.length - 1] = p[0].slice();
    }
  }
  // roads cross the railway on dry ground, well away from the rivers (a level crossing on a bridge doesn't work): a
  // crossing that falls by a river is slid along the track to the nearest dry spot that works, bending the road to
  // meet it. (After the river straightening above, which can move a crossing.)
  {
    const P2 = W.railway.pts, n2 = P2.length;
    /** bend road p so its crossing c moves to q; null if that would run the road into a monument it doesn't serve */
    const bend = (p, ri, c, q) => {
      const dx = q[0] - c.x, dz = q[1] - c.z, Lb = Math.max(50, Math.hypot(dx, dz) * 2.5), closed = ri === 0;
      // arc length along the road from the crossing, and from the road's ends (a spur's ends stay put)
      const cum = [0]; for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + dist(p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]));
      const sc = cum[c.i] + c.t * (cum[c.i + 1] - cum[c.i]), tot = cum[p.length - 1];
      const np = p.map((v, i) => {
        let s = Math.abs(cum[i] - sc); if (closed) s = Math.min(s, tot - s);
        let w = s < Lb ? 0.5 + 0.5 * Math.cos(Math.PI * s / Lb) : 0;
        if (!closed) w *= smooth(clamp(Math.min(cum[i], tot - cum[i]) / 30, 0, 1));
        return [v[0] + dx * w, v[1] + dz * w];
      });
      if (closed) np[np.length - 1] = np[0].slice();
      const own = W.monuments.find(m => dist(m.x, m.z, p[0][0], p[0][1]) < 1);
      if (np.some((v, i) => Math.hypot(v[0] - p[i][0], v[1] - p[i][1]) > 0.5 && W.monuments.some(m => m !== own && dist(m.x, m.z, v[0], v[1]) < m.size + 8))) return null;
      return np;
    };
    for (let pass = 0; pass < 3; pass++) for (const [ri, p] of W.roads.entries()) {
      for (const c of crossings(p, P2, true)) {
        if (riverDist(c.x, c.z) >= 36) continue;
        // the nearest spot along the track (either way) clear of rivers and monuments that the road can bend to
        let np = null;
        for (let k = 1; k <= 45 && !np; k++) for (const sg of [1, -1]) {
          const q = P2[((c.j + sg * k) % n2 + n2) % n2];
          if (riverDist(q[0], q[1]) < 44 || W.monuments.some(m => dist(m.x, m.z, q[0], q[1]) < m.size + 24)) continue;
          if ((np = bend(p, ri, c, q))) break;
        }
        if (!np) continue;
        // roads that end on this one (spurs joining it) follow it: their last 40 m bend to meet it again
        for (const sp of W.roads) {
          if (sp === p || sp === W.roads[0]) continue;
          const e = sp[sp.length - 1]; let at = null;
          for (let j = 0; j < p.length - 1 && !at; j++) { const a = p[j], b = p[j + 1], ddx = b[0] - a[0], ddz = b[1] - a[1], L2 = ddx * ddx + ddz * ddz || 1, t = clamp(((e[0] - a[0]) * ddx + (e[1] - a[1]) * ddz) / L2, 0, 1); if (Math.hypot(e[0] - a[0] - ddx * t, e[1] - a[1] - ddz * t) < 0.05) at = [j, t]; }
          if (!at) continue;
          const [j, t] = at, ex = lerp(np[j][0], np[j + 1][0], t) - e[0], ez = lerp(np[j][1], np[j + 1][1], t) - e[1]; if (Math.hypot(ex, ez) < 0.01) continue;
          let back = 0; for (let i = sp.length - 1; i >= 0; i--) { if (i < sp.length - 1) back += dist(sp[i][0], sp[i][1], sp[i + 1][0], sp[i + 1][1]); const w = i === sp.length - 1 ? 1 : smooth(clamp(1 - back / 40, 0, 1)); if (w <= 0) break; sp[i][0] += ex * w; sp[i][1] += ez * w; }
        }
        for (let i = 0; i < p.length; i++) { p[i][0] = np[i][0]; p[i][1] = np[i][1]; }
        break; // the crossings changed: look again next pass
      }
    }
  }
  // ---- lakes (away from roads + monuments)
  for (let tries = 0, made = 0, want = Math.round(11 * AREA_K); tries < 3000 * AREA_K && made < want; tries++) {
    const x = R.range(80, WORLD - 80), z = R.range(80, WORLD - 80), e = elev(x, z), r = R.range(9, 20);
    if (e < 0.22 || mountMask(x, z) > 0.75) continue;
    if (W.monuments.some(m => dist(m.x, m.z, x, z) < m.size + r + 25)) continue;
    if (W.roads.some(p => p.some(q => dist(q[0], q[1], x, z) < r + 14))) continue;
    if (W.railway && W.railway.pts.some(q => dist(q[0], q[1], x, z) < r + 18)) continue;
    if (W.lakes.some(l => dist(l.x, l.z, x, z) < l.r + r + 40)) continue;
    if (riverDist(x, z) < r + 30) continue;
    // lakes sit at sea level, so only in low, even ground (in a hillside one would be a pit with a cliff round it)
    let rimHi = -99, rimLo = 99; for (let a = 0; a < 16; a++) { const hh = H(x + Math.cos(a / 16 * 6.283) * (r + 10), z + Math.sin(a / 16 * 6.283) * (r + 10)); rimHi = Math.max(rimHi, hh); rimLo = Math.min(rimLo, hh); }
    if (rimHi > 4.6 || rimHi - rimLo > 3) continue;
    W.lakes.push({ x, z, r }); made++;
  }
  for (const l of W.lakes) forDisc(l.x, l.z, l.r + 10, (k, d) => {
    const t = d / l.r; const target = t < 1 ? WATER_Y - 1.6 * (1 - t * t) - 0.15 : WATER_Y + (t - 1) * 0.9 * (l.r / 10);
    if (t < 1) W.h[k] = Math.min(W.h[k], target); else W.h[k] = lerp(target, W.h[k], smooth(clamp((t - 1) * l.r / 10, 0, 1)));
  });
  // ---- flatten monuments. tgt = the height a cell must keep (monument pads, halt platforms, road and rail beds): the
  // cut-and-fill pass at the end slopes the ground away from these
  const tgt = new Float32Array(N * N).fill(NaN);
  const flattenMon = m => {
    let t = H(m.x, m.z); if (MONUMENTS[m.type].coast) t = 1.0; t = Math.max(0.8, t);
    m.y = t;
    const r = m.size;
    const coast = MONUMENTS[m.type].coast, sc = Math.cos(m.rot * Math.PI / 2), ss = Math.sin(m.rot * Math.PI / 2);
    const seaReach = coast ? openSeaAt(m.x, m.z, m.rot * Math.PI / 2, r, 420, -2.4, 10) : 0; // where open water starts (before any carving)
    forDisc(m.x, m.z, r + 16, (k, d) => {
      if (coast) { // the seaward side (+X local) drops into the sea so piers reach real water
        const x = (k % N) * RES, z = Math.floor(k / N) * RES; const proj = (x - m.x) * sc + (z - m.z) * ss;
        if (proj > r * 0.55) {
          // a quay edge (a wall at the harbors, where the cargo ship's hull comes alongside), then sea; past the pad's rim
          // it eases back into the shore instead of cutting a notch with cliff sides into the coast
          const sea = lerp(t, -1.9, smooth(clamp((proj - r * 0.55) / (m.type === 'harbor' ? 2.5 : r * 0.12), 0, 1)));
          W.h[k] = d < r ? sea : Math.min(W.h[k], lerp(sea, W.h[k], smooth((d - r) / 16))); if (W.h[k] < 0) W.sea[k] = 1; return;
        }
      }
      if (d < r) { W.h[k] = t; W.flat[k] = 1; tgt[k] = t; }
      else W.h[k] = lerp(t, W.h[k], smooth((d - r) / 16));
    });
    // every coastal site gets a channel out to open water, so its sea side is never a pond cut off by a strip of land
    if (coast) {
      const reach = seaReach > 1e8 ? r * 0.55 + 160 : seaReach;
      const d1 = reach + 30, hw = r * 0.62 + 8, cs = [[r * 0.55, -hw], [r * 0.55, hw], [d1, -hw], [d1, hw]].map(([d, l]) => [m.x + sc * d - ss * l, m.z + ss * d + sc * l]);
      const i0 = Math.max(2, Math.floor(Math.min(...cs.map(c => c[0])) / RES)), i1 = Math.min(N - 3, Math.ceil(Math.max(...cs.map(c => c[0])) / RES));
      const j0 = Math.max(2, Math.floor(Math.min(...cs.map(c => c[1])) / RES)), j1 = Math.min(N - 3, Math.ceil(Math.max(...cs.map(c => c[1])) / RES));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { // every cell once, from its own position in the channel
        const x = i * RES, z = j * RES, d = (x - m.x) * sc + (z - m.z) * ss, l = -(x - m.x) * ss + (z - m.z) * sc;
        if (d < r * 0.55 || d > d1 || Math.abs(l) > hw) continue;
        const k = j * N + i; if (W.road[k] || W.rail[k]) continue;
        const edge = smooth(clamp((Math.abs(l) - r * 0.62) / 8, 0, 1)), depth = lerp(-2.4, -1.9, smooth(clamp((r * 0.55 + 6 - d) / 6, 0, 1)));
        const target = lerp(depth, W.h[k], edge);
        if (W.h[k] > target) { W.h[k] = target; if (target < 0) W.sea[k] = 1; }
      }
    }
    // harbors get a dredged basin out front: the cargo ship swings in and out of its berth through here
    if (m.type === 'harbor') forDisc(m.x, m.z, 290, (k) => {
      const x = (k % N) * RES, z = Math.floor(k / N) * RES, proj = (x - m.x) * sc + (z - m.z) * ss, lat = -(x - m.x) * ss + (z - m.z) * sc;
      if (proj < r * 0.55 || proj > 240 || Math.abs(lat) > 165) return;
      // a quay wall along the berth (the ship is ~76 m long); either side of it the dredged edge shelves like a beach,
      // and so do the basin's banks
      const quay = lerp(t, -2.8, smooth(clamp((proj - r * 0.55) / 2.5, 0, 1))), shelf = -2.8 + Math.max(0, r * 0.55 + 12 - proj) * 0.3;
      let target = lerp(quay, Math.max(quay, shelf), smooth(clamp((Math.abs(lat) - 46) / 12, 0, 1)));
      target = Math.max(target, -2.8 + Math.max(0, Math.abs(lat) - 96) * 0.3);
      if (W.h[k] > target) { W.h[k] = target; if (target < 0) W.sea[k] = 1; }
    });
  };
  for (const m of W.monuments) flattenMon(m);
  // ---- railway profile: a gently graded bed (worked out before the roads, which meet it at its height); halts beside it
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
    // stations: by each train yard, then spread around the loop (4 on the old 1.5 km island, more on a bigger one). A platform is a straight 25 m slab, so it
    // wants a straight stretch of track, well away from rivers (their valleys are carved later and would undercut it)
    const angAt = i => { const a = P2[(i - 1 + n) % n], b = P2[(i + 1) % n]; return Math.atan2(b[1] - a[1], b[0] - a[0]); };
    // track points a road crosses (or comes within 10 m of): a halt's platform keeps clear of them
    const roadBy = P2.map(([x, z]) => W.roads.some(p => { for (let j = 0; j < p.length - 1; j++) { const a = p[j], b = p[j + 1]; if (Math.min(a[0], b[0]) > x + 10 || Math.max(a[0], b[0]) < x - 10 || Math.min(a[1], b[1]) > z + 10 || Math.max(a[1], b[1]) < z - 10) continue; if (segDist(x, z, a[0], a[1], b[0], b[1]) < 10) return true; } return false; }));
    const siteOk = (i, relax = 0) => { for (let d = -5; d <= 5; d++) if (roadBy[(i + d + n) % n]) return false; if (relax >= 3) return true; const [x, z] = P2[i]; if (riverDist(x, z) < 34 - relax * 8) return false; let turn = 0; for (let d = -4; d < 4; d++) { let t = angAt((i + d + 1 + n) % n) - angAt((i + d + n) % n); t = Math.atan2(Math.sin(t), Math.cos(t)); turn += Math.abs(t); } return turn < 0.22 + relax * 0.25; };
    const st = [];
    for (const m of W.monuments) if (m.type === 'trainyard') {
      let bi = 0, bd = 1e9; for (let i = 0; i < n; i++) { const d = dist(P2[i][0], P2[i][1], m.x, m.z); if (d < bd && siteOk(i)) { bd = d; bi = i; } }
      if (bd < 170 && !st.some(s => Math.min(Math.abs(s.i - bi), n - Math.abs(s.i - bi)) < n / 8)) st.push({ i: bi, yard: m });
    }
    // fill up the stations, each as far along the loop from the others as possible
    const nSt = Math.round(4 * LIN_K);
    const gap = i => st.length ? Math.min(...st.map(s => Math.min(Math.abs(s.i - i), n - Math.abs(s.i - i)))) : n;
    for (let relax = 0; relax < 4 && st.length < nSt; relax++) while (st.length < nSt) { // relax 3 = anywhere (as before)
      let bi = -1, bg = n / (nSt * 1.75);
      for (let i = 0; i < n; i += 2) { const g = gap(i); if (g <= bg) continue; const [x, z] = P2[i]; if (W.monuments.some(m => dist(m.x, m.z, x, z) < m.size + 26) || !siteOk(i, relax)) continue; bg = g; bi = i; }
      if (bi < 0) break; st.push({ i: bi });
    }
    st.sort((a, b) => a.i - b.i);
    for (const s of st) {
      const [x, z] = P2[s.i], [x1, z1] = P2[(s.i + 1) % n]; const ang = Math.atan2(z1 - z, x1 - x);
      // platform on the side facing the island centre (or the yard)
      const tx = s.yard ? s.yard.x : cx, tz = s.yard ? s.yard.z : cz; const nx = -Math.sin(ang), nz = Math.cos(ang);
      const side = (tx - x) * nx + (tz - z) * nz > 0 ? 1 : -1;
      const names = ['Pine Halt', 'Dust Halt', 'Ridge Halt', 'Hollow Halt', 'North Halt', 'Cedar Halt', 'Marsh Halt'], used = W.stations.map(q => q.name);
      const name = (s.yard ? ['Yard Halt', 'Freight Halt', 'Depot Halt'].find(q => !used.includes(q)) : null) || names.find(q => !used.includes(q)) || 'Halt';
      W.stations.push({ i: s.i, x, z, ang, side, y: hs[s.i], name });
    }
    // the track runs level through each station (the platform is flat), easing back into the grade either side
    {
      const fixed = new Uint8Array(n);
      for (const s of W.stations) for (let d = -5; d <= 5; d++) { const j = (s.i + d + n) % n; hs[j] = s.y; fixed[j] = 1; }
      for (let pass = 0, worst = 1; pass < 120 && worst > 0.005; pass++) {
        worst = 0;
        for (let dir = 0; dir < 2; dir++) for (let q = 0; q < n; q++) {
          const i = dir ? n - 1 - q : q, j = dir ? (i - 1 + n) % n : (i + 1) % n, g = 0.22, d = hs[j] - hs[i];
          if (Math.abs(d) <= g) continue; worst = Math.max(worst, Math.abs(d) - g);
          const fix = (Math.abs(d) - g) * Math.sign(d);
          if (fixed[i] && fixed[j]) continue; else if (fixed[i]) hs[j] -= fix; else if (fixed[j]) hs[i] += fix; else { hs[j] -= fix * 0.5; hs[i] += fix * 0.5; }
        }
      }
    }
  }
  // ---- road profiles: the terrain smoothed, pinned where a road must meet something (a monument's pad, the ring road
  // at a junction, the railway or another road where they cross), with the grade held under 11%
  {
    const G_ROAD = 0.11;
    /** heights for polyline p (closed: the last point repeats the first) with pins [[index, height]] */
    const profile = (p, pins, closed) => {
      const n = closed ? p.length - 1 : p.length, hs = []; for (let i = 0; i < n; i++) hs.push(Math.max(0.45, H(p[i][0], p[i][1])));
      const fix = new Uint8Array(n); for (const [i, y] of pins) { hs[i % n] = y; fix[i % n] = 1; }
      const nb = (i, d) => closed ? (i + d + n) % n : clamp(i + d, 0, n - 1);
      for (let pass = 0; pass < 4; pass++) for (let i = 0; i < n; i++) if (!fix[i] && (closed || (i > 0 && i < n - 1))) hs[i] = (hs[nb(i, -1)] + hs[i] * 2 + hs[nb(i, 1)]) / 4;
      const segs = closed ? n : n - 1, len = []; for (let i = 0; i < segs; i++) { const a = p[i], b = p[(i + 1) % p.length]; len.push(dist(a[0], a[1], b[0], b[1])); }
      for (let pass = 0, worst = 1; pass < 300 && worst > 0.01; pass++) {
        worst = 0;
        for (let dir = 0; dir < 2; dir++) for (let q = 0; q < segs; q++) {
          const i = dir ? segs - 1 - q : q, j = (i + 1) % n, lim = G_ROAD * len[i], d = hs[j] - hs[i];
          if (Math.abs(d) <= lim) continue; worst = Math.max(worst, Math.abs(d) - lim);
          const fx = (Math.abs(d) - lim) * Math.sign(d);
          if (fix[i] && fix[j]) continue; else if (fix[i]) hs[j] -= fx; else if (fix[j]) hs[i] += fx; else { hs[j] -= fx / 2; hs[i] += fx / 2; }
        }
      }
      if (closed) hs.push(hs[0]);
      return hs;
    };
    /** height along a profiled polyline at segment i, fraction t */
    const hAt = (p, i, t) => lerp(p.hs[i], p.hs[Math.min(i + 1, p.hs.length - 1)], t);
    const RW = W.railway, done = [];
    for (const [ri, p] of W.roads.entries()) {
      const closed = ri === 0;
      // crossings with the railway and with every road already profiled (not a spur's own junction with the ring): a
      // point goes in at each, pinned to the other's height
      const xs = [];
      if (RW && RW.hs) for (const c of crossings(p, RW.pts, true)) xs.push({ ...c, y: lerp(RW.hs[c.j], RW.hs[(c.j + 1) % RW.hs.length], c.u) - 0.05 });
      for (const q of done) for (const c of crossings(p, q, false)) { if (!closed && c.i >= p.length - 2 && c.t > 0.9) continue; xs.push({ ...c, y: hAt(q, c.j, c.u) }); }
      xs.sort((a, b) => b.i - a.i || b.t - a.t); // from the far end, so the indices still to come stay good
      const ins = [];
      for (const c of xs) {
        let k;
        if (c.t < 0.05) k = c.i; else if (c.t > 0.95) k = c.i + 1;
        else { p.splice(c.i + 1, 0, [lerp(p[c.i][0], p[c.i + 1][0], c.t), lerp(p[c.i][1], p[c.i + 1][1], c.t)]); k = c.i + 1; for (const q of ins) if (q[0] >= k) q[0]++; }
        ins.push([k, c.y]);
      }
      const pins = ins.slice();
      // monument pads it runs over stay flat: the road lies on them at their height
      const pinned = new Set(pins.map(q => q[0]));
      for (let i = 0; i < p.length; i++) for (const m of W.monuments) if (m.y !== undefined && dist(m.x, m.z, p[i][0], p[i][1]) < m.size * 0.95) { pins.push([i, m.y]); pinned.add(i); }
      // where it runs alongside (or merges into) a road already done, it takes that road's height
      if (!closed) for (let i = 1; i < p.length; i++) {
        if (pinned.has(i)) continue; const [x, z] = p[i]; let bd = 7, by = null;
        for (const q of done) for (let j = 0; j < q.length - 1; j++) { const a = q[j], b = q[j + 1]; if (Math.min(a[0], b[0]) > x + bd || Math.max(a[0], b[0]) < x - bd || Math.min(a[1], b[1]) > z + bd || Math.max(a[1], b[1]) < z - bd) continue;
          const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1, t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / L2, 0, 1), d = Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t); if (d < bd) { bd = d; by = hAt(q, j, t); } }
        if (by !== null) pins.push([i, by]);
      }
      // a spur meets the ring at the ring's height
      if (!closed) { const e = p[p.length - 1], r0 = W.roads[0]; let bi = 0, bd = 1e9; for (let i = 0; i < r0.length; i++) { const d = dist(r0[i][0], r0[i][1], e[0], e[1]); if (d < bd) { bd = d; bi = i; } } if (bd < 1) pins.push([p.length - 1, r0.hs[bi]]); }
      p.hs = profile(p, pins, closed);
      done.push(p);
    }
  }
  /** carve beds along polylines: each cell takes the height of the nearest centre-line point (so a steep stretch or
   *  a junction carves cleanly), the bed within `bed` m, a shoulder easing back into the terrain out to `R` m */
  const carveBeds = (lines, bed, R, set) => {
    const bestD = new Float32Array(N * N).fill(1e9), bestH = new Float32Array(N * N);
    for (const [p, hs, closed] of lines) for (let i = 0; i < (closed ? p.length : p.length - 1); i++) {
      const [x0, z0] = p[i], [x1, z1] = p[(i + 1) % p.length], h0 = hs[i], h1 = hs[(i + 1) % p.length], L = dist(x0, z0, x1, z1), n = Math.max(1, Math.ceil(L / 1.2));
      for (let s = 0; s <= n; s++) { const t = s / n, x = lerp(x0, x1, t), z = lerp(z0, z1, t), hh = lerp(h0, h1, t); forDisc(x, z, R, (k, d) => { if (!W.flat[k] && d < bestD[k]) { bestD[k] = d; bestH[k] = hh; } }); }
    }
    for (let k = 0; k < N * N; k++) { const d = bestD[k]; if (d >= R) continue; if (d < bed) set(k, bestH[k]); else W.h[k] = lerp(bestH[k], W.h[k], smooth((d - bed) / (R - bed))); }
  };
  // ---- roads: carve the bed into the terrain and mark the mask
  carveBeds(W.roads.map(p => [p, p.hs, false]), 4.2, 10, (k, hh) => { W.h[k] = hh; W.road[k] = 1; tgt[k] = hh; });
  // ---- railway bed: cut and filled into the terrain; level ground by each halt
  if (W.railway) {
    carveBeds([[W.railway.pts, W.railway.hs.map(h => h - 0.05), true]], 2.8, 10, (k, hh) => { W.h[k] = hh; W.rail[k] = 1; W.road[k] = 0; tgt[k] = hh; });
    // level ground under and around each station platform
    for (const s of W.stations) {
      const nx = -Math.sin(s.ang) * s.side, nz = Math.cos(s.ang) * s.side;
      for (let a = -12; a <= 12; a += 2) for (let o = 3; o <= 9; o += 2) {
        const x = s.x + Math.cos(s.ang) * a + nx * o, z = s.z + Math.sin(s.ang) * a + nz * o;
        forDisc(x, z, 2.2, k => { if (!W.rail[k]) { W.h[k] = s.y - 0.05; W.flat[k] = 1; tgt[k] = s.y - 0.05; } });
      }
    }
  }
  // ---- rivers: a channel cut just below sea level (the sea water fills it), inside a valley whose walls rise at a
  // walkable slope until they meet the hills, so rivers through high ground run in deep valleys. Roads and the
  // railway keep their own grade: the cut-and-fill pass below rebuilds their embankments up to a bridge.
  const nV = makeNoise(seed + 9), wallC = new Float32Array(N * N).fill(NaN); // valley wall steepness per cell (computed once)
  for (const rv of W.rivers) {
    const n = rv.pts.length;
    for (let i = 0; i < n; i++) {
      const [x, z] = rv.pts[i], t = i / (n - 1), w = lerp(rv.w0, rv.w1, t), bed = WATER_Y - lerp(0.9, 1.7, t);
      forDisc(x, z, w + 60, (k, d) => {
        if (W.flat[k] && !W.road[k] && !W.rail[k]) return; // monument pads stay (they keep clear of rivers anyway)
        if (d < w) { W.h[k] = Math.min(W.h[k], bed + (d / w) * (d / w) * 0.5); W.river[k] = 1; return; }
        let slope = wallC[k]; if (slope !== slope) { const kx = (k % N) * RES, kz = Math.floor(k / N) * RES; slope = wallC[k] = 0.34 + 0.16 * (nV.fbm(kx / 70, kz / 70, 2) + 0.5); }
        const rise = d - w; W.h[k] = Math.min(W.h[k], WATER_Y + 0.12 + rise * slope + rise * rise * 0.0035);
      });
    }
  }
  // dry ravines: shorter valleys cut into hill country (no water), away from roads and the railway
  for (let tries = 0, made = 0, want = Math.round(3 * AREA_K); tries < 900 * AREA_K && made < want; tries++) {
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
  // ---- late monuments: own random stream, clear of roads, rails, stations and older monuments
  {
    const R3 = rng((seed ^ 0x6d2b79f5) >>> 0);
    const clearOf = (x, z, r) => { for (let a = 0; a < 24; a++) for (const f of [0, 0.5, 1]) { const px = x + Math.cos(a / 24 * 6.283) * r * f, pz = z + Math.sin(a / 24 * 6.283) * r * f; if (px < 4 || pz < 4 || px > WORLD - 4 || pz > WORLD - 4) return false; const k = idx(px, pz); if (W.road[k] || W.rail[k] || W.river[k]) return false; } return true; };
    for (const type of Object.keys(MONUMENTS).filter(t => MONUMENTS[t].late && !MONUMENTS[t].offshore).sort((a, b) => MONUMENTS[b].size - MONUMENTS[a].size)) { // biggest first
      const def = MONUMENTS[type];
      for (let c = 0; c < countOf(def); c++) {
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
        if (def.coast) rot = coastRot(best.x, best.z, def.size);
        const m = { type, name: def.name, x: Math.round(best.x), z: Math.round(best.z), rot, size: def.size, tier: def.tier, idx: c, late: true };
        W.monuments.push(m); flattenMon(m);
      }
    }
  }
  // ---- bridges wherever a road's or the railway's full width crosses a river channel. A deck starts where the road
  // leaves the ground: at least 3 m past the water, further out over a deep valley (up to 40 m a side) while the valley
  // floor is more than 2 m below the road. Its ends sit on the bed at the road's own height; under the rest the valley
  // stays open (the cut-and-fill pass below builds the abutments). Roads cross rivers straight (see above), so a deck is
  // one straight piece; a curving track gets a few, overlapping a little at the joints so no gap opens on the outside.
  const addBridges = (p, hs, closed, w, rail) => {
    const n = p.length, segs = closed ? n : n - 1;
    let S = []; // the centre line every ~1 m: [x, z, height]
    for (let i = 0; i < segs; i++) { const a = p[i], b = p[(i + 1) % n], L = dist(a[0], a[1], b[0], b[1]), m = Math.max(1, Math.ceil(L)); for (let s = 0; s < m; s++) { const t = s / m; S.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(hs[i], hs[(i + 1) % n], t)]); } }
    if (!closed) S.push([p[n - 1][0], p[n - 1][1], hs[n - 1]]);
    const dir = k => { const a = S[Math.max(0, k - 1)], b = S[Math.min(S.length - 1, k + 1)]; const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };
    const across = (k, fn) => { const [dx, dz] = dir(k); for (let o = -w / 2; o <= w / 2 + 0.01; o += 1) if (fn(S[k][0] - dz * o, S[k][1] + dx * o)) return true; return false; };
    let wet = S.map((_, k) => across(k, (x, z) => W.river[idx(x, z)]));
    if (closed) { const k0 = wet.indexOf(false); if (k0 > 0) { S = S.slice(k0).concat(S.slice(0, k0)); wet = wet.slice(k0).concat(wet.slice(0, k0)); } } // start on dry ground
    const runs = []; for (let k = 0; k < S.length; k++) if (wet[k]) { const last = runs[runs.length - 1]; if (last && k - last[1] <= 9) last[1] = k; else runs.push([k, k]); }
    const high = k => !across(k, (x, z) => H(x, z) >= S[k][2] - 2); // the ground is well below the road across its whole width
    const dev = (a, b) => { let m = 0; const [x0, z0] = S[a], [x1, z1] = S[b]; for (let k = a + 1; k < b; k++) m = Math.max(m, segDist(S[k][0], S[k][1], x0, z0, x1, z1)); return m; };
    for (const [r0, r1] of runs) {
      let a = Math.max(0, r0 - 3), b = Math.min(S.length - 1, r1 + 3);
      for (let q = 0; q < 40 && a > 0 && high(a); q++) a--;
      for (let q = 0; q < 40 && b < S.length - 1 && high(b); q++) b++;
      const cut = [a];
      for (let s = a; s < b;) { let e = b; while (e > s + 4 && dev(s, e) > 0.4) e--; cut.push(e); s = e; }
      if (cut.length > 2 && cut[cut.length - 1] - cut[cut.length - 2] < 5) cut.splice(cut.length - 2, 1); // no stub of a piece at the end
      for (let q = 0; q < cut.length - 1; q++) {
        const s0 = cut[q], s1 = cut[q + 1], L = dist(S[s0][0], S[s0][1], S[s1][0], S[s1][1]) || 1, ux = (S[s1][0] - S[s0][0]) / L, uz = (S[s1][1] - S[s0][1]) / L;
        // at a joint, run on past it far enough to cover the outside of the bend
        const ext = (from, to) => { const vx = S[to][0] - S[from][0], vz = S[to][1] - S[from][1], l = Math.hypot(vx, vz) || 1, c = clamp((vx * ux + vz * uz) / l, -1, 1); return Math.min(2, w / 2 * Math.tan(Math.acos(c) / 2) + 0.15); };
        const e0 = q > 0 ? ext(cut[q - 1], s0) : 0, e1 = q < cut.length - 2 ? ext(s1, cut[q + 2]) : 0;
        W.bridges.push({ x0: S[s0][0] - ux * e0, z0: S[s0][1] - uz * e0, x1: S[s1][0] + ux * e1, z1: S[s1][1] + uz * e1, y0: S[s0][2] - (S[s1][2] - S[s0][2]) / L * e0, y1: S[s1][2] + (S[s1][2] - S[s0][2]) / L * e1, w, rail });
      }
      // under the deck the ground keeps no bed height (the valley stays open), except the last 2 m at each end, where
      // the deck rests on it
      for (let k = Math.max(0, a - 2); k <= Math.min(S.length - 1, b + 2); k++) {
        const [dx, dz] = dir(k), seat = k - a < 2 || b - k < 2;
        for (let o = -w / 2 - 1; o <= w / 2 + 1.01; o += 0.7) { const c = idx(S[k][0] - dz * o, S[k][1] + dx * o); if (W.flat[c]) continue; tgt[c] = seat ? S[k][2] - (rail ? 0.05 : 0) : NaN; }
      }
    }
  };
  for (const [ri, p] of W.roads.entries()) if (p.hs) addBridges(ri === 0 ? p.slice(0, -1) : p, ri === 0 ? p.hs.slice(0, -1) : p.hs, ri === 0, 9, false);
  if (W.railway && W.railway.hs) addBridges(W.railway.pts, W.railway.hs, true, 5, true);
  // ---- cut and fill: the ground beside every road, the railway, each monument pad and halt platform slopes away at most
  // 35-40 degrees, so there are no cliff walls or pits beside them, embankments carry the roads up to their bridges and
  // the beds and pads keep their heights. River channels, the sea and lakes are left alone. Two raster passes give, for
  // every cell, lo = max over those cells of (height - 0.7 * distance) and hi = min of (height + 0.8 * distance).
  cutAndFill(W, tgt);
  // ---- offshore sites (the oil rig): out in deep water a little past the cargo ship's ring (cargo.js sails
  // coast + 105 m out), clear of the harbors and the ship's lanes in and out, near enough to make out from the
  // shore on a clear day. Own random stream, placed after everything else, never flattened (built on the sea).
  {
    const RO = rng((seed ^ 0x3c6ef372) >>> 0);
    const coastAt = th => { let c = 0; for (const off of [-0.05, 0, 0.05]) { const a = th + off; for (let r = WORLD * 0.72; r > 0; r -= 5) if (H(cx + Math.cos(a) * r, cz + Math.sin(a) * r) > -1.2) { c = Math.max(c, r); break; } } return c; };
    const ring = []; for (let k = 0; k < 240; k++) { const th = k / 240 * Math.PI * 2, r = coastAt(th) + 105; ring.push([cx + Math.cos(th) * r, cz + Math.sin(th) * r]); }
    const ringDist = (x, z) => { let b = 1e9; for (let i = 0; i < ring.length; i++) { const a = ring[i], q = ring[(i + 1) % ring.length]; b = Math.min(b, segDist(x, z, a[0], a[1], q[0], q[1])); } return b; };
    // the ship leaves its last harbor along the ring for 0.6 rad, then heads straight out to sea
    const exits = W.monuments.filter(m => m.type === 'harbor').map(h => { const th = Math.atan2(h.z - cz, h.x - cx) + 0.6, r = coastAt(th) + 105; return [cx + Math.cos(th) * r, cz + Math.sin(th) * r, cx + Math.cos(th) * (r + 380), cz + Math.sin(th) * (r + 380)]; });
    const landWithin = (x, z, R) => { for (let d = 10; d <= R; d += 8) for (let q = 0; q < 40; q++) { const a = q / 40 * Math.PI * 2; if (H(x + Math.cos(a) * d, z + Math.sin(a) * d) > 0.2) return d; } return 1e9; };
    for (const type of Object.keys(MONUMENTS).filter(t => MONUMENTS[t].offshore)) {
      const def = MONUMENTS[type], r = def.size;
      for (let c = 0; c < countOf(def); c++) {
        let best = null;
        for (let tries = 0; tries < 1400 && !best; tries++) {
          const rl = tries / 1400, th = RO.range(0, Math.PI * 2), out = RO.range(r + 34, r + 100 + rl * 60);
          const rr = coastAt(th) + 105 + out, x = cx + Math.cos(th) * rr, z = cz + Math.sin(th) * rr;
          if (x < r + 30 || z < r + 30 || x > WORLD - r - 30 || z > WORLD - r - 30) continue;
          let deep = H(x, z) < -10; for (let q = 0; q < 16 && deep; q++) { const a = q / 16 * Math.PI * 2; if (H(x + Math.cos(a) * r, z + Math.sin(a) * r) > -7) deep = false; }
          if (!deep) continue;
          if (ringDist(x, z) < r + 34 - rl * 8) continue;                                            // the cargo ship sails past, not through
          if (W.monuments.some(m => m.type === 'harbor' && dist(m.x, m.z, x, z) < 330)) continue;     // harbor basins and berth lanes
          if (exits.some(e => segDist(x, z, e[0], e[1], e[2], e[3]) < r + 40)) continue;               // the ship's way out to sea
          if (W.monuments.some(m => dist(m.x, m.z, x, z) < m.size + r + 60)) continue;
          if (landWithin(x, z, 170 + rl * 110) > 1e8) continue;                                        // you can see it from the shore
          if (landWithin(x, z, 180 - rl * 25) < 1e8) continue;                                         // ...but it's well out at sea
          best = { x, z };
        }
        if (!best) continue;
        const m = { type, name: def.name, x: Math.round(best.x), z: Math.round(best.z), rot: RO.int(0, 3), size: r, tier: def.tier, idx: c, late: true, offshore: true, y: WATER_Y };
        W.monuments.push(m);
      }
    }
  }
  /** is (x,z) on (or within pad m of) a bridge deck */
  const onBridge = (x, z, pad = 0) => W.bridges.some(b => { const dx = b.x1 - b.x0, dz = b.z1 - b.z0, L = Math.hypot(dx, dz) || 1, rx = x - b.x0, rz = z - b.z0, t = (rx * dx + rz * dz) / L; return t > -pad && t < L + pad && Math.abs((-rx * dz + rz * dx) / L) < b.w / 2 + pad; });
  // ---- power lines: a network (minimum spanning tree) from the Reactor Sector out to the big sites,
  // pylons every ~40 m, kept out of water, roads, rails and monument pads
  {
    const RP = rng((seed ^ 0x2545f491) >>> 0);
    const hubs = W.monuments.filter(m => ['reactor', 'water', 'trainyard', 'harbor', 'airfield', 'dish', 'garrison', 'observatory', 'quarry', 'gas', 'mart', 'village', 'haven', 'lighthouse', 'radio', 'fishvillage'].includes(m.type));
    const start = hubs.find(m => m.type === 'reactor') || hubs[0];
    if (start && hubs.length > 1) {
      const inT = [start], left = hubs.filter(m => m !== start), edges = [];
      while (left.length) { let bi = -1, bj = -1, bd = 1e12; inT.forEach((a, i) => left.forEach((b, j) => { const d = dist(a.x, a.z, b.x, b.z); if (d < bd) { bd = d; bi = i; bj = j; } })); edges.push([inT[bi], left[bj]]); inT.push(left[bj]); left.splice(bj, 1); }
      const okSpot = (x, z) => {
        if (x < 20 || z < 20 || x > WORLD - 20 || z > WORLD - 20) return false; if (H(x, z) < 0.5) return false;
        for (const [ox, oz] of [[0, 0], [2.5, 0], [-2.5, 0], [0, 2.5], [0, -2.5]]) { const k = idx(x + ox, z + oz); if (W.road[k] || W.rail[k] || W.flat[k] || W.river[k]) return false; }
        if (Math.abs(H(x + 1.5, z) - H(x - 1.5, z)) > 1.8 || Math.abs(H(x, z + 1.5) - H(x, z - 1.5)) > 1.8) return false; // not on a steep bank
        return !W.monuments.some(m => dist(m.x, m.z, x, z) < m.size + 3) && !onBridge(x, z, 3);
      };
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
      // trunk lines: long runs from the Reactor Sector out to the coast (the best zipline rides)
      const a0 = RP.range(0, 6.283), nTrunk = Math.round(5 * LIN_K);
      for (let t = 0; t < nTrunk; t++) {
        let ang = a0 + t / nTrunk * Math.PI * 2 + RP.range(-0.25, 0.25), x = start.x + Math.cos(ang) * (start.size + 10), z = start.z + Math.sin(ang) * (start.size + 10);
        let cur = [];
        for (let s = 0; s < 40 * LIN_K; s++) {
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
    const k = j * N + i, x = i * RES, z = j * RES, h = W.h[k], e = E[k];
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
  // ---- scatter. A 1 m occupancy grid keeps trees, boulders, ore nodes, pylons and roadside loot from standing in each
  // other; trees, boulders and nodes also keep off steep banks (they'd float on one side)
  const OC = Math.ceil(WORLD), occ = new Uint8Array(OC * OC);
  const occDo = (x, z, r, mark) => { const i0 = Math.max(0, Math.floor(x - r)), i1 = Math.min(OC - 1, Math.ceil(x + r)), j0 = Math.max(0, Math.floor(z - r)), j1 = Math.min(OC - 1, Math.ceil(z + r)); for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { if ((i + 0.5 - x) ** 2 + (j + 0.5 - z) ** 2 > r * r) continue; if (mark) occ[j * OC + i] = 1; else if (occ[j * OC + i]) return false; } return true; };
  const free = (x, z, r) => occDo(x, z, r, false), take = (x, z, r) => occDo(x, z, r, true);
  const level = (x, z) => Math.max(Math.abs(H(x + 1, z) - H(x - 1, z)), Math.abs(H(x, z + 1) - H(x, z - 1))) < 1.5;
  for (const l of W.powerlines) for (const [x, z] of l.pts) take(x, z, 2.2);
  for (const b of W.bridges) { const L = dist(b.x0, b.z0, b.x1, b.z1); for (let s = -2; s <= L + 2; s += 2) take(lerp(b.x0, b.x1, s / (L || 1)), lerp(b.z0, b.z1, s / (L || 1)), b.w / 2 + 2.5); } // nothing grows up through a deck
  const SOLID = { pine: 0.8, pine_snow: 0.8, oak: 0.9, birch: 0.7, dead: 0.7, palm: 0.7, cactus: 0.7, stump: 0.6, log_fallen: 1.4, boulder: 1.6 };
  // monuments and halts, bucketed in 64 m cells (pad up to 30 m)
  const MG = 64, MGN = Math.ceil(WORLD / MG), mgrid = Array.from({ length: MGN * MGN }, () => []), mcl = v => clamp(Math.floor(v / MG), 0, MGN - 1);
  for (const o of [...W.monuments.map(m => [m.x, m.z, m.size]), ...W.stations.map(s => [s.x, s.z, 16])]) for (let j = mcl(o[1] - o[2] - 30); j <= mcl(o[1] + o[2] + 30); j++) for (let i = mcl(o[0] - o[2] - 30); i <= mcl(o[0] + o[2] + 30); i++) mgrid[j * MGN + i].push(o);
  const nearMon = (x, z, pad) => { for (const o of mgrid[mcl(z) * MGN + mcl(x)]) if ((o[0] - x) ** 2 + (o[1] - z) ** 2 < (o[2] + pad) ** 2) return true; return false; };
  const nearRoad = (x, z) => { const k = idx(x, z); return W.road[k] === 1; };
  const nearRail = (x, z) => W.rail[idx(x, z)] === 1;
  const roadPad = (x, z, r) => { for (const [ox, oz] of [[r, 0], [-r, 0], [0, r], [0, -r], [r * 1.6, 0], [-r * 1.6, 0], [0, r * 1.6], [0, -r * 1.6]]) if (nearRoad(x + ox, z + oz) || nearRail(x + ox, z + oz)) return true; return nearRoad(x, z) || nearRail(x, z); };
  let vid = 1;
  const addVeg = (kind, x, z, s = 1) => {
    const r = SOLID[kind]; if (r) { if (!free(x, z, r * s + 0.3) || !level(x, z)) return; take(x, z, r * s); }
    W.veg.push({ id: vid++, kind, x, z, s, ry: R() * Math.PI * 2 });
  };
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
        const s = R.range(0.85, 1.15), ry = R() * Math.PI * 2;
        for (const [ox, oz] of [[0, 0], [1.9, -1.4], [-1.7, 1.6], [-1.5, -1.8], [1.6, 1.9]]) { // the first clear, level spot in the cell
          const nx = x + ox, nz = z + oz; if (H(nx, nz) < 0.4 || !free(nx, nz, 1.2 * s) || !level(nx, nz) || roadPad(nx, nz, 2)) continue;
          take(nx, nz, 1.0 * s); W.nodes.push({ id: vid++, type, x: nx, z: nz, s, ry }); break;
        }
      }
      if (b !== B.BEACH && R() < 0.0035) addVeg('rock_small', x, z, R.range(0.8, 1.4));
    }
  }
  // roadside loot, Rust-style: small clusters every so often along the roads — three things to loot, always
  // with a crate among them, sometimes by a car wreck — with empty stretches in between. Own random stream.
  {
    const RS = rng((seed ^ 0x6a09e667) >>> 0);
    const clear = (x, z) => !nearMon(x, z, 4) && H(x, z) >= 0.3 && free(x, z, 1.1) && !onBridge(x, z, 3) && level(x, z) && !W.rail[idx(x, z)] && !W.rail[idx(x + 2, z)] && !W.rail[idx(x - 2, z)] && !W.rail[idx(x, z + 2)] && !W.rail[idx(x, z - 2)] && !(W.road && W.road[idx(x, z)] === 1);
    for (const p of W.roads) {
      let next = RS.range(25, 70), run = 0;
      for (let i = 1; i < p.length - 1; i++) {
        const [x0, z0] = p[i - 1], [x1, z1] = p[i]; const L = dist(x0, z0, x1, z1) || 1; run += L;
        if (run < next) continue;
        run = 0; next = RS.range(55, 115);
        const ux = (x1 - x0) / L, uz = (z1 - z0) / L, side = RS() < 0.5 ? -1 : 1, nx = -uz * side, nz = ux * side, ry = Math.atan2(uz, ux);
        const at = (along, off) => [x1 + ux * along + nx * off, z1 + uz * along + nz * off];
        // exactly three things to loot, always at least one crate (a car wreck sometimes sits with them as scenery)
        const loot = ['crate', RS() < 0.25 ? 'crate' : RS() < 0.3 ? 'barrel_oil' : 'barrel', RS() < 0.3 ? 'barrel_oil' : 'barrel'];
        const spots = [[-1.4, 6.0], [0.2, 6.6], [1.6, 5.8]].map(([a, o]) => [a + RS.range(-0.4, 0.4), o + RS.range(-0.3, 0.3)]);
        const placed = [];
        for (let k = 0; k < 3; k++) {
          let ok = null;
          for (let tr = 0; tr < 6 && !ok; tr++) { const [x, z] = at(spots[k][0] + tr * 0.7 * (tr % 2 ? 1 : -1), spots[k][1] + (tr > 2 ? 1.2 : 0)); if (clear(x, z)) ok = [x, z]; }
          if (!ok) break; placed.push([loot[k], ok[0], ok[1]]);
        }
        if (placed.length < 3) continue; // no room here for a whole cluster (and its crate)
        for (const [kind, x, z] of placed) W.roadside.push({ kind, x, z, ry: RS() * 6.28, n: 1, exact: true });
        if (RS() < 0.3) { const [x, z] = at(RS() < 0.5 ? -5.2 : 5.4, 7.0); if (clear(x, z)) W.roadside.push({ kind: 'car', x, z, ry: ry + (RS() - 0.5) * 0.5, n: 1, exact: true }); }
      }
    }
  }
  // beach spawns
  for (let tries = 0, want = Math.round(60 * LIN_K); tries < 6000 * LIN_K && W.spawns.length < want; tries++) {
    const a = R() * Math.PI * 2; let lo = 0, hi = IR * 1.2;
    for (let it = 0; it < 20; it++) { const mid = (lo + hi) / 2; if (elev(cx + Math.cos(a) * mid, cz + Math.sin(a) * mid) > 0.04) lo = mid; else hi = mid; }
    const x = cx + Math.cos(a) * lo, z = cz + Math.sin(a) * lo;
    if (H(x, z) < 0.4 || nearMon(x, z, 25) || !free(x, z, 2.5) || !level(x, z)) continue; // not in a boulder or on a bank
    W.spawns.push({ x, z, a: a + Math.PI });
  }
  // chunk index for vegetation / nodes
  W.vegChunks = Array.from({ length: NCH * NCH }, () => []);
  for (const v of W.veg) { v.y = H(v.x, v.z); W.vegChunks[chunkOf(v.x, v.z)].push(v); }
  for (const n of W.nodes) n.y = H(n.x, n.z);
  return W;

  /** where polyline p crosses the closed polyline Q: [{ i, t (along p's segment i), j, u (along Q's segment j), x, z }] */
  function crossings(p, Q, qClosed) {
    const out = [], nq = Q.length;
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1], x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), z0 = Math.min(a[1], b[1]), z1 = Math.max(a[1], b[1]);
      for (let j = 0; j < (qClosed ? nq : nq - 1); j++) {
        const c = Q[j], d = Q[(j + 1) % nq];
        if (Math.max(c[0], d[0]) < x0 || Math.min(c[0], d[0]) > x1 || Math.max(c[1], d[1]) < z0 || Math.min(c[1], d[1]) > z1) continue;
        const den = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]); if (Math.abs(den) < 1e-9) continue;
        const t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / den, u = ((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / den;
        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
        out.push({ i, t, j, u, x: lerp(a[0], b[0], t), z: lerp(a[1], b[1], t) });
      }
    }
    return out;
  }
  function forDisc(x, z, r, fn) {
    const i0 = Math.max(0, Math.floor((x - r) / RES)), i1 = Math.min(N - 1, Math.ceil((x + r) / RES));
    const j0 = Math.max(0, Math.floor((z - r) / RES)), j1 = Math.min(N - 1, Math.ceil((z + r) / RES));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const d = Math.hypot(i * RES - x, j * RES - z); if (d <= r) fn(j * N + i, d); }
  }
}


/** the cut-and-fill pass (see generateWorld): tgt = heights the beds and pads must keep (NaN elsewhere) */
function cutAndFill(W, tgt) {
  const h = W.h, sea = W.sea, river = W.river, NN = N * N;
  const lo = new Float32Array(NN), hi = new Float32Array(NN), rc = new Float32Array(NN);
  const sF = 0.7 * RES, sC = 0.8 * RES, sR = 1.0 * RES, dF = sF * Math.SQRT2, dC = sC * Math.SQRT2, dR = sR * Math.SQRT2;
  // lo/hi: the cones from the beds and pads. rc: river channels cap the ground beside them (the water's edge + 1.0 x
  // distance), so a road or railway embankment running beside a river meets it at an even slope, not a wall at the bank
  for (let k = 0; k < NN; k++) { const t = tgt[k]; if (t === t) { lo[k] = t; hi[k] = t; } else { lo[k] = -1e9; hi[k] = 1e9; } rc[k] = river[k] ? Math.max(h[k], WATER_Y) : 1e9; }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i; let a = lo[k], b = hi[k], c = rc[k];
    if (i > 0) { a = Math.max(a, lo[k - 1] - sF); b = Math.min(b, hi[k - 1] + sC); c = Math.min(c, rc[k - 1] + sR); }
    if (j > 0) {
      a = Math.max(a, lo[k - N] - sF); b = Math.min(b, hi[k - N] + sC); c = Math.min(c, rc[k - N] + sR);
      if (i > 0) { a = Math.max(a, lo[k - N - 1] - dF); b = Math.min(b, hi[k - N - 1] + dC); c = Math.min(c, rc[k - N - 1] + dR); }
      if (i < N - 1) { a = Math.max(a, lo[k - N + 1] - dF); b = Math.min(b, hi[k - N + 1] + dC); c = Math.min(c, rc[k - N + 1] + dR); }
    }
    lo[k] = a; hi[k] = b; rc[k] = c;
  }
  for (let j = N - 1; j >= 0; j--) for (let i = N - 1; i >= 0; i--) {
    const k = j * N + i; let a = lo[k], b = hi[k], c = rc[k];
    if (i < N - 1) { a = Math.max(a, lo[k + 1] - sF); b = Math.min(b, hi[k + 1] + sC); c = Math.min(c, rc[k + 1] + sR); }
    if (j < N - 1) {
      a = Math.max(a, lo[k + N] - sF); b = Math.min(b, hi[k + N] + sC); c = Math.min(c, rc[k + N] + sR);
      if (i < N - 1) { a = Math.max(a, lo[k + N + 1] - dF); b = Math.min(b, hi[k + N + 1] + dC); c = Math.min(c, rc[k + N + 1] + dR); }
      if (i > 0) { a = Math.max(a, lo[k + N - 1] - dF); b = Math.min(b, hi[k + N - 1] + dC); c = Math.min(c, rc[k + N - 1] + dR); }
    }
    lo[k] = a; hi[k] = b; rc[k] = c;
  }
  for (let k = 0; k < NN; k++) {
    if (sea[k]) continue;
    const t = tgt[k]; let v = h[k];
    if (t === t) { if (v > t || !river[k]) h[k] = t; continue; } // beds and pads: exactly their height (a river channel under a bridge stays)
    const a = lo[k], b = hi[k];
    if (river[k]) { if (v > b) h[k] = b; continue; }               // a river channel is only ever deepened
    if (a > b) v = (a + b) / 2;                                    // squeezed between two: split the difference
    else { if (v > b) v = b; if (v < a && v > WATER_Y - 0.05) v = a; }
    h[k] = Math.min(v, rc[k]);
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
