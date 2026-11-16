// ============================================================================
// ZONEFALL 3 — terrain meshes (chunked heightfield with blended biome vertex
// colours + tiled detail texture), sea, roads, map image.
// ============================================================================
import { THREE, M } from './materials.js';
import { WORLD, RES, N, CHUNK, NCH, B, WATER_Y, sampleH } from '../world/gen.js';
import { clamp, lerp, makeNoise } from '../util.js';

const BCOL = {
  [B.OCEAN]: [0.36, 0.42, 0.36], [B.BEACH]: [0.84, 0.76, 0.56], [B.GRASS]: [0.45, 0.55, 0.27], [B.FOREST]: [0.33, 0.44, 0.22],
  [B.ARID]: [0.72, 0.6, 0.4], [B.SNOW]: [0.88, 0.9, 0.93], [B.ROCK]: [0.5, 0.49, 0.47], [B.LAKE]: [0.38, 0.4, 0.3],
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
  const mat = M.mat('#ffffff', { vc: true, tex: 'grass', texSize: 256 });
  const CV = CHUNK / RES; // cells per chunk side
  for (let cj = 0; cj < NCH; cj++) for (let ci = 0; ci < NCH; ci++) {
    const i0 = ci * CV, j0 = cj * CV, i1 = Math.min(N - 1, i0 + CV), j1 = Math.min(N - 1, j0 + CV);
    if (i0 >= N - 1 || j0 >= N - 1) continue;
    let maxH = -99; for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) maxH = Math.max(maxH, W.h[j * N + i]);
    void maxH;
    const vw = i1 - i0 + 1, vh = j1 - j0 + 1;
    const pos = new Float32Array(vw * vh * 3), cc = new Float32Array(vw * vh * 3), uv = new Float32Array(vw * vh * 2);
    for (let j = 0; j < vh; j++) for (let i = 0; i < vw; i++) {
      const gi = i0 + i, gj = j0 + j, k = gj * N + gi, v = j * vw + i;
      pos[v * 3] = gi * RES; pos[v * 3 + 1] = W.h[k]; pos[v * 3 + 2] = gj * RES;
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
    g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
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
  // ---- roads
  const ringMat = M.surf('asphalt'), spurMat = M.surf('gravel');
  W.roads.forEach((p, ri) => {
    const width = ri === 0 ? 7.5 : 6.2;
    const pos = [], uv = [], idx = []; let acc = 0;
    for (let i = 0; i < p.length; i++) {
      const a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)];
      let dx = b[0] - a[0], dz = b[1] - a[1]; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
      const nx = -dz, nz = dx; const [x, z] = p[i];
      if (i > 0) acc += Math.hypot(x - p[i - 1][0], z - p[i - 1][1]);
      for (const s of [-1, 1]) {
        const px = x + nx * width / 2 * s, pz = z + nz * width / 2 * s;
        pos.push(px, Math.max(sampleH(W, px, pz), p.hs ? p.hs[i] : 0) + 0.06, pz); uv.push((s + 1) / 2 * width / 6, acc / 6);
      }
      if (i > 0) { const v = i * 2; idx.push(v - 2, v, v - 1, v - 1, v, v + 1); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, ri === 0 ? ringMat : spurMat); m.receiveShadow = true; m.renderOrder = 0;
    m.material.polygonOffset = true; m.material.polygonOffsetFactor = -2;
    group.add(m);
    // centre line dashes on the ring road
    if (ri === 0) {
      const dpos = [], didx = []; let n = 0;
      for (let i = 0; i < p.length - 1; i++) {
        const [x0, z0] = p[i], [x1, z1] = p[i + 1]; const L = Math.hypot(x1 - x0, z1 - z0); const dx = (x1 - x0) / L, dz = (z1 - z0) / L;
        for (let s = 1; s < L - 2; s += 5) {
          const ax = x0 + dx * s, az = z0 + dz * s, bx = ax + dx * 2.2, bz = az + dz * 2.2, y = lerp(p.hs[i], p.hs[i + 1], s / L) + 0.09;
          dpos.push(ax - dz * 0.1, y, az + dx * 0.1, ax + dz * 0.1, y, az - dx * 0.1, bx - dz * 0.1, y, bz + dx * 0.1, bx + dz * 0.1, y, bz - dx * 0.1);
          didx.push(n, n + 2, n + 1, n + 1, n + 2, n + 3); n += 4;
        }
      }
      const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.Float32BufferAttribute(dpos, 3)); dg.setIndex(didx); dg.computeVertexNormals();
      const dm = new THREE.Mesh(dg, M.mat('#d8c890')); dm.receiveShadow = true; group.add(dm);
    }
  });
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

/** Top-down map image (canvas) of the island for the map screen / minimap. */
export function buildMapCanvas(W, size = 512) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
  const img = g.createImageData(size, size); const d = img.data; const sc = WORLD / size;
  const pal = { [B.OCEAN]: [38, 74, 92], [B.LAKE]: [52, 98, 118], [B.BEACH]: [205, 186, 140], [B.GRASS]: [104, 128, 66], [B.FOREST]: [70, 98, 54], [B.ARID]: [180, 150, 100], [B.SNOW]: [222, 228, 234], [B.ROCK]: [122, 120, 116] };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const wx = x * sc, wz = y * sc; const h = sampleH(W, wx, wz); const b = W.biomeAt(wx, wz);
    let [r, gg, bb] = pal[b] || pal[B.GRASS];
    const hx = sampleH(W, wx + 2, wz) - h, hz = sampleH(W, wx, wz + 2) - h; const sh = clamp(1 - (hx + hz) * 0.35, 0.7, 1.25);
    if (h > 0) { r *= sh; gg *= sh; bb *= sh; } else { const dd = clamp(-h / 10, 0, 1); r = lerp(70, 26, dd); gg = lerp(120, 56, dd); bb = lerp(130, 74, dd); }
    if (W.isRoad(wx, wz)) { r = 70; gg = 66; bb = 60; }
    if (W.isFlat(wx, wz)) { r = lerp(r, 140, 0.5); gg = lerp(gg, 134, 0.5); bb = lerp(bb, 120, 0.5); }
    const k = (y * size + x) * 4; d[k] = r; d[k + 1] = gg; d[k + 2] = bb; d[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // grid
  g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 1; const step = size / 8;
  for (let i = 1; i < 8; i++) { g.beginPath(); g.moveTo(i * step, 0); g.lineTo(i * step, size); g.moveTo(0, i * step); g.lineTo(size, i * step); g.stroke(); }
  return c;
}
