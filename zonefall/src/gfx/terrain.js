// ============================================================================
// ZONEFALL 3 — terrain meshes (chunked heightfield with blended biome vertex
// colours + tiled detail texture), sea, roads, map image.
// ============================================================================
import { THREE, M } from './materials.js';
import { WORLD, RES, N, CHUNK, NCH, B, WATER_Y, sampleH } from '../world/gen.js';
import { clamp, lerp, makeNoise } from '../util.js';

const BCOL = {
  // comic palette: saturated, sunny ground colours
  [B.OCEAN]: [0.34, 0.46, 0.38], [B.BEACH]: [0.95, 0.84, 0.56], [B.GRASS]: [0.42, 0.63, 0.22], [B.FOREST]: [0.3, 0.5, 0.18],
  [B.ARID]: [0.86, 0.63, 0.36], [B.SNOW]: [0.9, 0.93, 0.98], [B.ROCK]: [0.56, 0.54, 0.52], [B.LAKE]: [0.38, 0.44, 0.3],
};

export function buildTerrain(W) {
  const group = new THREE.Group(); group.name = 'terrain';
  const noise = makeNoise(W.seed + 77);
  // ---- per-vertex colour (blurred biome colour + noise + slope + wetness)
  const col = new Float32Array(N * N * 3);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i; const c = BCOL[W.biome[k]] || BCOL[B.GRASS];
    col[k * 3] = c[0]; col[k * 3 + 1] = c[1]; col[k * 3 + 2] = c[2];
  }
  blur(col, 2);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, x = i * RES, z = j * RES, h = W.h[k];
    const hx = W.h[j * N + Math.min(N - 1, i + 1)] - W.h[j * N + Math.max(0, i - 1)], hz = W.h[Math.min(N - 1, j + 1) * N + i] - W.h[Math.max(0, j - 1) * N + i];
    const slope = Math.hypot(hx, hz) / (2 * RES);
    const n = noise.fbm(x / 22, z / 22, 3) * 0.16 + noise(x / 5, z / 5) * 0.05;
    let r = col[k * 3], g = col[k * 3 + 1], b = col[k * 3 + 2];
    r *= 1 + n; g *= 1 + n; b *= 1 + n * 0.8;
    // steep -> rock
    const rk = clamp((slope - 0.45) * 2.2, 0, 0.85); r = lerp(r, 0.47, rk); g = lerp(g, 0.46, rk); b = lerp(b, 0.44, rk);
    // underwater: wet sand -> deep teal
    if (h < 0.35) { const wt = clamp((0.35 - h) / 3, 0, 1); r = lerp(r * 0.82, 0.16, wt); g = lerp(g * 0.85, 0.3, wt); b = lerp(b * 0.85, 0.32, wt); }
    // roads (dirt shoulders under the asphalt ribbon) + flattened monument pads
    if (W.road[k]) { r = lerp(r, 0.42, 0.55); g = lerp(g, 0.38, 0.55); b = lerp(b, 0.32, 0.55); }
    if (W.flat[k]) { r = lerp(r, 0.5, 0.35); g = lerp(g, 0.47, 0.35); b = lerp(b, 0.4, 0.35); }
    col[k * 3] = r; col[k * 3 + 1] = g; col[k * 3 + 2] = b;
  }
  // normals from the whole heightfield (central differences), not per chunk: a chunk's own computeVertexNormals only
  // sees its side of a border, so the shading broke along every chunk edge. Stored as normalized bytes (a quarter of
  // the memory of floats)
  const nrm = new Int8Array(N * N * 3);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, hx = (W.h[j * N + Math.min(N - 1, i + 1)] - W.h[j * N + Math.max(0, i - 1)]) / ((Math.min(N - 1, i + 1) - Math.max(0, i - 1)) * RES);
    const hz = (W.h[Math.min(N - 1, j + 1) * N + i] - W.h[Math.max(0, j - 1) * N + i]) / ((Math.min(N - 1, j + 1) - Math.max(0, j - 1)) * RES), l = Math.hypot(hx, 1, hz);
    nrm[k * 3] = Math.round(-hx / l * 127); nrm[k * 3 + 1] = Math.round(1 / l * 127); nrm[k * 3 + 2] = Math.round(-hz / l * 127);
  }
  const mat = M.mat('#ffffff', { vc: true, tex: 'terrain', texSize: 256 });
  const CV = CHUNK / RES; // cells per chunk side
  for (let cj = 0; cj < NCH; cj++) for (let ci = 0; ci < NCH; ci++) {
    const i0 = ci * CV, j0 = cj * CV, i1 = Math.min(N - 1, i0 + CV), j1 = Math.min(N - 1, j0 + CV);
    if (i0 >= N - 1 || j0 >= N - 1) continue;
    let maxH = -99; for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) maxH = Math.max(maxH, W.h[j * N + i]);
    void maxH;
    const vw = i1 - i0 + 1, vh = j1 - j0 + 1;
    const pos = new Float32Array(vw * vh * 3), cc = new Float32Array(vw * vh * 3), uv = new Float32Array(vw * vh * 2), nn = new Int8Array(vw * vh * 3);
    for (let j = 0; j < vh; j++) for (let i = 0; i < vw; i++) {
      const gi = i0 + i, gj = j0 + j, k = gj * N + gi, v = j * vw + i;
      pos[v * 3] = gi * RES; pos[v * 3 + 1] = W.h[k]; pos[v * 3 + 2] = gj * RES;
      nn[v * 3] = nrm[k * 3]; nn[v * 3 + 1] = nrm[k * 3 + 1]; nn[v * 3 + 2] = nrm[k * 3 + 2];
      cc[v * 3] = col[k * 3]; cc[v * 3 + 1] = col[k * 3 + 1]; cc[v * 3 + 2] = col[k * 3 + 2];
      uv[v * 2] = gi * RES / 6; uv[v * 2 + 1] = gj * RES / 6;
    }
    const idx = [];
    for (let j = 0; j < vh - 1; j++) for (let i = 0; i < vw - 1; i++) {
      const a = j * vw + i, b = a + 1, c = a + vw, d = c + 1;
      // alternate diagonal for less banding
      if ((i + j) & 1) idx.push(a, c, b, b, c, d); else idx.push(a, c, d, a, d, b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(cc, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('normal', new THREE.BufferAttribute(nn, 3, true));
    g.setIndex(idx); g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, mat); mesh.receiveShadow = true; mesh.castShadow = false; mesh.name = 'tchunk';
    group.add(mesh);
  }
  // ---- seabed far out (beyond the heightfield)
  const bed = new THREE.Mesh(new THREE.PlaneGeometry(WORLD * 6, WORLD * 6), M.mat('#1d3a44'));
  bed.rotation.x = -Math.PI / 2; bed.position.set(WORLD / 2, -14.5, WORLD / 2); group.add(bed);
  // ---- sea
  const seaTex = M.texture('water', 128).clone(); seaTex.needsUpdate = true; seaTex.repeat.set(220, 220);
  const seaMat = new THREE.MeshLambertMaterial({ color: new THREE.Color('#3d7c94'), map: seaTex, transparent: true, opacity: 0.8, depthWrite: false });
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(WORLD * 4, WORLD * 4), seaMat);
  sea.rotation.x = -Math.PI / 2; sea.position.set(WORLD / 2, WATER_Y - 0.05, WORLD / 2); sea.renderOrder = 1; sea.receiveShadow = true;
  group.add(sea);
  // ---- roads: resampled every ~2 m and lifted clear of the terrain at every sample, so the
  // ground can't poke through between points; own materials with a depth offset (no shimmer)
  const ringMat = M.surf('asphalt').clone(), spurMat = M.surf('gravel').clone(), dashMat = M.mat('#d8c890').clone();
  for (const [m, f] of [[ringMat, -2], [spurMat, -2], [dashMat, -5]]) { m.polygonOffset = true; m.polygonOffsetFactor = f; m.polygonOffsetUnits = f * 2; }
  W.roads.forEach((p, ri) => {
    const width = ri === 0 ? 7.5 : 6.2;
    // resample the centre line
    const pts = [];
    for (let i = 0; i < p.length - 1; i++) {
      const [x0, z0] = p[i], [x1, z1] = p[i + 1]; const L = Math.hypot(x1 - x0, z1 - z0); const n = Math.max(1, Math.ceil(L / 2));
      const h0 = p.hs ? p.hs[i] : sampleH(W, x0, z0), h1 = p.hs ? p.hs[i + 1] : sampleH(W, x1, z1);
      for (let k = 0; k < n; k++) { const t = k / n; pts.push([lerp(x0, x1, t), lerp(z0, z1, t), lerp(h0, h1, t)]); }
    }
    const last = p[p.length - 1]; pts.push([last[0], last[1], p.hs ? p.hs[p.length - 1] : sampleH(W, last[0], last[1])]);
    const pos = [], uv = [], idx = []; let acc = 0; const cy = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let dx = b[0] - a[0], dz = b[1] - a[1]; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
      const nx = -dz, nz = dx; const [x, z, hh] = pts[i];
      if (i > 0) acc += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]);
      let top = Math.max(hh, sampleH(W, x, z));
      for (const s of [-1, 1]) top = Math.max(top, sampleH(W, x + nx * width / 2 * s, z + nz * width / 2 * s), sampleH(W, x + nx * width / 4 * s, z + nz * width / 4 * s));
      top += 0.1; cy.push(top);
      for (const s of [-1, 1]) { pos.push(x + nx * width / 2 * s, top, z + nz * width / 2 * s); uv.push((s + 1) / 2 * width / 6, acc / 6); }
      if (i > 0) { const v = i * 2; idx.push(v - 2, v - 1, v, v - 1, v + 1, v); } // counter-clockwise from above (the old order faced down and was culled)
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, ri === 0 ? ringMat : spurMat); m.receiveShadow = true; m.renderOrder = 0;
    group.add(m);
    // centre line dashes on the ring road
    if (ri === 0) {
      const dpos = [], didx = []; let n = 0, run = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const [x0, z0] = pts[i], [x1, z1] = pts[i + 1]; const L = Math.hypot(x1 - x0, z1 - z0) || 1; const dx = (x1 - x0) / L, dz = (z1 - z0) / L;
        run += L; if (run % 5 > 2.2) continue; // 2.2 m dash every 5 m
        const y = Math.max(cy[i], cy[i + 1]) + 0.03;
        dpos.push(x0 - dz * 0.1, y, z0 + dx * 0.1, x0 + dz * 0.1, y, z0 - dx * 0.1, x1 - dz * 0.1, y, z1 + dx * 0.1, x1 + dz * 0.1, y, z1 - dx * 0.1);
        didx.push(n, n + 2, n + 1, n + 1, n + 2, n + 3); n += 4;
      }
      const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.Float32BufferAttribute(dpos, 3)); dg.setIndex(didx); dg.computeVertexNormals();
      const dm = new THREE.Mesh(dg, dashMat); dm.receiveShadow = true; group.add(dm);
    }
  });
  M.gpuOnly(group); // the terrain mesh never changes after it's built
  return { group, sea, seaTex };
}

function blur(col, passes) {
  const tmp = new Float32Array(col.length);
  for (let p = 0; p < passes; p++) {
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
        const k = (jj * N + ii) * 3; r += col[k]; g += col[k + 1]; b += col[k + 2]; n++;
      }
      const k = (j * N + i) * 3; tmp[k] = r / n; tmp[k + 1] = g / n; tmp[k + 2] = b / n;
    }
    col.set(tmp);
  }
}

/** squares across the map's lettered grid (~190 m each, as on the old 1.5 km island's 8 x 8) */
export const MAP_GRID = Math.round(WORLD / 190);
/** Top-down map image (canvas) of the island for the map screen / minimap. */
export function buildMapCanvas(W, size = 640) {
  // a calm paper-map look: soft biome colours with gentle hill shading, pale roads, blue rivers and sea depth,
  // the railway as a dark dashed line, light power-line dashes, and a lettered grid (MAP_GRID squares of ~190 m:
  // A-J across, 1-10 down on the 1.9 km island)
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
  const img = g.createImageData(size, size); const d = img.data; const sc = WORLD / size;
  const pal = { [B.OCEAN]: [52, 92, 112], [B.LAKE]: [70, 120, 140], [B.BEACH]: [214, 198, 156], [B.GRASS]: [128, 150, 92], [B.FOREST]: [96, 124, 78], [B.ARID]: [196, 170, 124], [B.SNOW]: [226, 230, 236], [B.ROCK]: [146, 142, 134] };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const wx = x * sc, wz = y * sc; const h = sampleH(W, wx, wz); const b = W.biomeAt(wx, wz);
    let [r, gg, bb] = pal[b] || pal[B.GRASS];
    const hx = sampleH(W, wx + 3, wz) - h, hz = sampleH(W, wx, wz + 3) - h; const sh = clamp(1 - (hx + hz) * 0.16, 0.86, 1.12);
    if (h > 0) { r *= sh; gg *= sh; bb *= sh; if (h < 0.6) { r = lerp(r, 214, 0.35); gg = lerp(gg, 198, 0.35); bb = lerp(bb, 156, 0.35); } }
    else { const dd = clamp(-h / 9, 0, 1); r = lerp(96, 40, dd); gg = lerp(150, 78, dd); bb = lerp(168, 104, dd); }
    if (W.isRoad(wx, wz)) { r = 232; gg = 222; bb = 196; }
    else if (W.isFlat(wx, wz)) { r = lerp(r, 176, 0.35); gg = lerp(gg, 168, 0.35); bb = lerp(bb, 150, 0.35); }
    const k = (y * size + x) * 4; d[k] = r; d[k + 1] = gg; d[k + 2] = bb; d[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const k = size / WORLD, px = Math.max(1, size / 640);
  // road edges, so roads read as roads
  // power lines: faint
  if (W.powerlines) { g.strokeStyle = 'rgba(40,36,40,0.28)'; g.lineWidth = px; g.setLineDash([2 * px, 3 * px]); for (const l of W.powerlines) { g.beginPath(); l.pts.forEach((q, i) => i ? g.lineTo(q[0] * k, q[1] * k) : g.moveTo(q[0] * k, q[1] * k)); g.stroke(); } g.setLineDash([]); }
  // railway + halts
  if (W.railway) {
    const P = W.railway.pts; g.lineJoin = 'round';
    for (const [w, col, dash] of [[3.2 * px, '#3a2f28', null], [1.4 * px, '#f0e6d0', [4 * px, 4 * px]]]) { g.strokeStyle = col; g.lineWidth = w; g.setLineDash(dash || []); g.beginPath(); P.forEach((q, i) => i ? g.lineTo(q[0] * k, q[1] * k) : g.moveTo(q[0] * k, q[1] * k)); g.closePath(); g.stroke(); }
    g.setLineDash([]);
  }
  // grid with letters / numbers
  g.strokeStyle = 'rgba(20,16,20,0.16)'; g.lineWidth = px; const step = size / MAP_GRID;
  for (let i = 1; i < MAP_GRID; i++) { g.beginPath(); g.moveTo(i * step, 0); g.lineTo(i * step, size); g.moveTo(0, i * step); g.lineTo(size, i * step); g.stroke(); }
  g.font = `800 ${Math.round(9 * px)}px system-ui`; g.fillStyle = 'rgba(20,16,20,0.42)'; g.textAlign = 'left';
  for (let i = 0; i < MAP_GRID; i++) for (let j = 0; j < MAP_GRID; j++) g.fillText('ABCDEFGHIJKL'[i] + (j + 1), i * step + 3 * px, j * step + 11 * px);
  return c;
}
