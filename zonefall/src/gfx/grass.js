// ============================================================================
// ZONEFALL 4 — eye-level comic grass. Two InstancedMeshes (2 draw calls):
//   near: fine 1 m cells (5 tufts / m2), curved 3-tri blades, fades out 6.5 -> 9 m
//   far : coarse 2 m cells (1 tuft / m2), single-triangle blades, fades out 23 -> 30 m
// Each field is a toroidal grid of cell "slots" around the camera. A slot is
// refilled only when its world cell changes, so walking costs a row/column of
// cells per crossing. Tufts are placed deterministically per world cell (no
// swimming), sit on W.height, follow the biome (dense GRASS/FOREST, sparse
// ARID, none on SNOW/BEACH/ROCK/water/roads/monument pads/steep slopes) and
// sway in the vertex shader (rolling gusts + flutter).
// Look: flat two-tone blades — saturated dark base, bright yellow-green tip,
// crisp anti-aliased colour step — on MeshLambertMaterial, which the game
// patches into toon bands (fog, shadows, point lights for free). Up-facing
// normals so a whole field takes one tone, like the ground under it.
//
//   const grass = new Grass(scene, W);
//   grass.update(camX, camZ, timeSec);
//   optional: grass.setWind(dx, dz, strength), grass.addBlocker(x, z, r), grass.clearBlockers(),
//             grass.refresh(), grass.visible = bool, grass.materials, grass.setInkMask(0) (see below),
//             grass.dispose(), grass.stats
//   opts.depthWrite (default false): the blades do not write depth and draw after the opaque pass (far field,
//   then near), so a depth-edge ink pass sees only the ground under them — no scribbles, no extra taps.
//   Pass true to write depth (then mask ink with setInkMask(0) + an alpha test in the ink pass).
// ============================================================================
import { THREE } from './materials.js';
import { B } from '../world/gen.js';
import { makeNoise } from '../util.js';

const TAU = Math.PI * 2;
const sat = x => (x < 0 ? 0 : x > 1 ? 1 : x);
const sstep = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lin = hex => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };

// per-biome density (0..1 of the candidates), blade colours (tip / base, linear) and height
const DENS = [], TIP = [], BASE = [], HGT = [];
for (let i = 0; i < 8; i++) { DENS[i] = 0; TIP[i] = lin('#b4dc3c'); BASE[i] = lin('#4a9428'); HGT[i] = 1; }
DENS[B.GRASS] = 1; TIP[B.GRASS] = lin('#b8de3a'); BASE[B.GRASS] = lin('#4c9a26'); HGT[B.GRASS] = 1.1;
DENS[B.FOREST] = 0.85; TIP[B.FOREST] = lin('#8ccc34'); BASE[B.FOREST] = lin('#2f7a22'); HGT[B.FOREST] = 0.85;
DENS[B.ARID] = 0.22; TIP[B.ARID] = lin('#e6d25a'); BASE[B.ARID] = lin('#9a9636'); HGT[B.ARID] = 0.62;
const TIP_WARM = lin('#e0e650'); // ~1 in 8 tufts get a sunnier tip
// biome blend kernel (centre + 4 taps 2.2 m away) so density / colour ramp softly at biome edges
const OX = [0, 2.2, -2.2, 0, 0], OZ = [0, 0, 0, 2.2, -2.2], WK = [0.4, 0.15, 0.15, 0.15, 0.15];

// ---------------------------------------------------------------- geometry
function rng(seed) { let a = seed >>> 0 || 1; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** one tuft: nb blades, root at y = 0, tallest ~0.5 m. segs 2 = curved blade (5 verts / 3 tris), 1 = single tapered triangle.
 *  attribute bladeT = 0 at the root .. 1 at the tip (drives the two-tone split) */
function tuftGeometry(nb, spread, wMin, wMax, hMin, hMax, seed, segs = 2) {
  const R = rng(seed), pos = [], nor = [], bt = [], idx = [];
  for (let b = 0; b < nb; b++) {
    const a = b / nb * TAU + R() * 0.9, r = (0.2 + 0.8 * Math.sqrt(R())) * spread;
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    const la = a + (R() - 0.5) * 1.3, lx = Math.cos(la), lz = Math.sin(la); // lean outward-ish
    const sx = -lz, sz = lx; // blade width runs across the lean
    const h = hMin + R() * (hMax - hMin), w = wMin + R() * (wMax - wMin), bend = (0.22 + R() * 0.38) * h;
    const v0 = pos.length / 3;
    const put = (x, y, z, t) => { pos.push(x, y, z); nor.push(0, 1, 0); bt.push(t); };
    const ty = h - bend * 0.22;
    put(cx - sx * w * 0.5, 0, cz - sz * w * 0.5, 0); put(cx + sx * w * 0.5, 0, cz + sz * w * 0.5, 0);
    if (segs === 1) {
      put(cx + lx * bend * 0.8, ty, cz + lz * bend * 0.8, 1);
      idx.push(v0, v0 + 1, v0 + 2);
    } else {
      const mY = h * 0.52, mo = bend * 0.3;
      put(cx + lx * mo - sx * w * 0.36, mY, cz + lz * mo - sz * w * 0.36, 0.52); put(cx + lx * mo + sx * w * 0.36, mY, cz + lz * mo + sz * w * 0.36, 0.52);
      put(cx + lx * bend, ty, cz + lz * bend, 1);
      idx.push(v0, v0 + 1, v0 + 3, v0, v0 + 3, v0 + 2, v0 + 2, v0 + 3, v0 + 4);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('bladeT', new THREE.Float32BufferAttribute(bt, 1));
  g.setIndex(idx); g.computeBoundingSphere();
  return g;
}
let GEO = null;
function geometries() {
  return GEO || (GEO = {
    near: tuftGeometry(8, 0.22, 0.04, 0.06, 0.24, 0.5, 11, 2),   // 24 tris
    far: tuftGeometry(10, 0.34, 0.06, 0.09, 0.22, 0.46, 23, 1),  // 10 tris
  });
}

// ---------------------------------------------------------------- material
function grassMaterial(U, fade) {
  // Lambert: the game patches Lambert lighting into hard toon bands (materials.js), so grass bands exactly like the terrain
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  m.onBeforeCompile = sh => {
    sh.uniforms.uTime = U.uTime; sh.uniforms.uCam = U.uCam; sh.uniforms.uWind = U.uWind; sh.uniforms.uFade = fade; sh.uniforms.uInk = U.uInk;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform vec3 uCam; uniform vec4 uWind; uniform vec2 uFade;\nattribute float bladeT; attribute vec3 iBase; varying float vBT; varying vec3 vBase;')
      .replace('#include <begin_vertex>', `vec3 transformed = vec3( position );
vBT = bladeT; vBase = iBase;
#ifdef USE_INSTANCING
{
  vec3 ip = instanceMatrix[3].xyz;
  float fade = 1.0 - smoothstep(uFade.x, uFade.y, distance(ip.xz, uCam.xz));
  float k = position.y * 2.0; k *= k;                                   // bend weight: root 0 .. tip ~1
  float roll = dot(ip.xz, uWind.xy) * 0.09 - uTime * 1.3;               // gust fronts rolling downwind
  float gust = 0.5 + 0.5 * sin(roll) * (0.65 + 0.35 * sin(roll * 0.37 + ip.z * 0.05));
  float flick = sin(uTime * 3.9 + ip.x * 2.1 + ip.z * 1.7 + position.x * 7.0 + position.z * 5.0);
  vec2 wv = uWind.xy * (uWind.z * (0.3 + gust)) + vec2(-uWind.y, uWind.x) * (flick * uWind.w);
  mat3 im = mat3(instanceMatrix);
  vec3 lw = (transpose(im) * vec3(wv.x, 0.0, wv.y)) * (k / max(dot(im[0], im[0]), 1e-6));
  transformed += lw;
  transformed.y -= dot(lw.xz, lw.xz) * 1.2;                             // bent blades get shorter
  transformed *= fade;                                                  // shrink into the ground at the edge
  vBT = bladeT - (1.0 - fade) * 0.7;                                    // and lose the bright tip first
}
#endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vBT; varying vec3 vBase; uniform float uInk;')
      // flat two-tone: base colour below the split, tip colour (instanceColor) above, crisp AA edge
      .replace('#include <color_fragment>', `#if defined( USE_COLOR )
{ float w = max(fwidth(vBT), 1e-4); diffuseColor.rgb *= mix(vBase, vColor, smoothstep(0.42 - w, 0.42 + w, vBT)); }
#endif`)
      // keep the up-facing normal on both sides (no dark backs)
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n\tnormal = normalize( vNormal );')
      // optional ink mask for an outline post pass reading an offscreen target's alpha (1 = normal)
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n\tgl_FragColor.a = uInk;');
  };
  m.customProgramCacheKey = () => 'zf_grass3';
  return m;
}

// ---------------------------------------------------------------- one recycled field
class Field {
  constructor(owner, geo, mat, cell, half, per, salt) {
    this.o = owner; this.S = cell; this.H = half; this.G = half * 2 + 1; this.per = per; this.salt = salt;
    const slots = this.G * this.G, n = slots * per; this.count = n;
    const g = geo.clone(); // own copy so the per-instance base colour attribute can live on it
    this.base = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3); this.base.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iBase', this.base);
    const mesh = new THREE.InstancedMesh(g, mat, n);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3); mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = true; mesh.name = 'grass';
    mesh.matrixAutoUpdate = false;
    this.mesh = mesh;
    this.slotX = new Int32Array(slots).fill(-0x7fffffff); this.slotZ = new Int32Array(slots).fill(-0x7fffffff);
    this.live = new Uint8Array(slots); this.liveN = 0;
    this.cx = -0x7fffffff; this.cz = -0x7fffffff;
    this.st = 1;
    // allocation-free deterministic rng (mulberry32) seeded per cell in fill()
    this.rnd = () => { let a = this.st = (this.st + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  update(camX, camZ, force) {
    const S = this.S, H = this.H, G = this.G;
    const ccx = Math.floor(camX / S), ccz = Math.floor(camZ / S);
    if (!force && ccx === this.cx && ccz === this.cz) return;
    this.cx = ccx; this.cz = ccz;
    let lo = 0x7fffffff, hi = -1;
    for (let cz = ccz - H; cz <= ccz + H; cz++) {
      const sz = ((cz % G) + G) % G;
      for (let cx = ccx - H; cx <= ccx + H; cx++) {
        const slot = sz * G + (((cx % G) + G) % G);
        if (!force && this.slotX[slot] === cx && this.slotZ[slot] === cz) continue;
        this.slotX[slot] = cx; this.slotZ[slot] = cz;
        this.fill(slot, cx, cz);
        if (slot < lo) lo = slot; if (slot > hi) hi = slot;
      }
    }
    if (hi < 0) return;
    const per = this.per, im = this.mesh.instanceMatrix, ic = this.mesh.instanceColor, ib = this.base;
    im.clearUpdateRanges(); im.addUpdateRange(lo * per * 16, (hi - lo + 1) * per * 16); im.needsUpdate = true;
    ic.clearUpdateRanges(); ic.addUpdateRange(lo * per * 3, (hi - lo + 1) * per * 3); ic.needsUpdate = true;
    ib.clearUpdateRanges(); ib.addUpdateRange(lo * per * 3, (hi - lo + 1) * per * 3); ib.needsUpdate = true;
  }
  fill(slot, cx, cz) {
    const S = this.S, per = this.per, m = this.mesh.instanceMatrix.array, c = this.mesh.instanceColor.array, bc = this.base.array, o = this.o._s;
    // deterministic per (cell, salt): mulberry32 seeded by an integer hash
    let st = Math.imul(cx, 374761393) ^ Math.imul(cz, 668265263) ^ Math.imul(this.salt, 1274126177);
    this.st = Math.imul(st ^ (st >>> 13), 1274126177) ^ (st >>> 16);
    const rnd = this.rnd;
    let live = 0;
    for (let k = 0; k < per; k++) {
      const i = slot * per + k, mo = i * 16, co = i * 3;
      // stratified jitter inside the cell so tufts never clump
      const gx = per === 4 ? (k & 1) * 0.5 : k / per, gz = per === 4 ? (k >> 1) * 0.5 : 0;
      const x = (cx + (per === 4 ? gx + rnd() * 0.5 : rnd())) * S, z = (cz + (per === 4 ? gz + rnd() * 0.5 : rnd())) * S;
      const pick = rnd(), rot = rnd() * TAU, r1 = rnd(), r2 = rnd(), r3 = rnd();
      const d = this.o.sample(x, z, o);
      if (pick >= d) { // empty: collapse to a zero-size matrix far below the world
        m.fill(0, mo, mo + 16); m[mo + 13] = -1000; m[mo + 15] = 1; continue;
      }
      live++;
      const ws = 0.8 + 0.4 * r1, hs = o.h * (0.62 + 0.62 * r2) * (0.85 + 0.15 * d);
      const ca = Math.cos(rot), sa = Math.sin(rot);
      m[mo] = ca * ws; m[mo + 1] = 0; m[mo + 2] = -sa * ws; m[mo + 3] = 0;
      m[mo + 4] = 0; m[mo + 5] = hs; m[mo + 6] = 0; m[mo + 7] = 0;
      m[mo + 8] = sa * ws; m[mo + 9] = 0; m[mo + 10] = ca * ws; m[mo + 11] = 0;
      m[mo + 12] = x; m[mo + 13] = o.y - 0.04; m[mo + 14] = z; m[mo + 15] = 1;
      const v = 0.96 + 0.08 * r3, warm = r3 > 0.88 ? 0.45 : 0;
      c[co] = (o.r + (TIP_WARM[0] - o.r) * warm) * v; c[co + 1] = (o.g + (TIP_WARM[1] - o.g) * warm) * v; c[co + 2] = (o.b + (TIP_WARM[2] - o.b) * warm) * v;
      bc[co] = o.br * v; bc[co + 1] = o.bg * v; bc[co + 2] = o.bb * v;
    }
    this.liveN += live - this.live[slot]; this.live[slot] = live;
  }
}

// ---------------------------------------------------------------- Grass
export class Grass {
  constructor(scene, W, opts = {}) {
    this.W = W; this.scene = scene;
    const seed = W && W.seed != null ? W.seed : 1;
    this.pn = makeNoise(seed + 911);  // clumps / clearings
    this.blockers = [];
    this._s = { r: 0, g: 0, b: 0, br: 0, bg: 0, bb: 0, h: 1, y: 0 };
    this.U = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector4(0.8, 0.6, 0.1, 0.022) }, uInk: { value: 1 } };
    const geo = geometries();
    this.fadeNear = { value: new THREE.Vector2(6.5, 9.2) };
    this.fadeFar = { value: new THREE.Vector2(23, 30) };
    this.materials = [grassMaterial(this.U, this.fadeNear), grassMaterial(this.U, this.fadeFar)];
    const dw = !!opts.depthWrite; for (const m of this.materials) m.depthWrite = dw;
    this.near = new Field(this, geo.near, this.materials[0], 1, 9, 5, 101);
    this.far = new Field(this, geo.far, this.materials[1], 2, 15, 4, 202);
    this.meshes = [this.far.mesh, this.near.mesh];
    if (!dw) { this.far.mesh.renderOrder = 50; this.near.mesh.renderOrder = 51; } // after the opaque world, near over far
    this.radius = 30;
    if (opts.wind) this.setWind(opts.wind[0], opts.wind[1], opts.wind[2]);
    if (scene) for (const m of this.meshes) scene.add(m);
    this._lastX = NaN; this._lastZ = NaN;
  }
  get visible() { return this.near.mesh.visible; }
  set visible(v) { for (const m of this.meshes) m.visible = !!v; }
  get stats() { return { instances: this.near.count + this.far.count, live: this.near.liveN + this.far.liveN, drawCalls: 2 }; }

  /** wind direction (world XZ, normalised here) and strength (tip offset in m, ~0.1 breeze .. 0.25 gale) */
  setWind(dx, dz, strength = 0.1) {
    const l = Math.hypot(dx, dz) || 1; const w = this.U.uWind.value;
    w.set(dx / l, dz / l, strength, 0.012 + strength * 0.1);
  }
  /** alpha the blades write (default 1). An ink-outline post pass reading the offscreen target can skip edges
   *  where any tap has alpha < 0.5 after setInkMask(0) — thousands of thin blades otherwise turn into scribbles. */
  setInkMask(a = 0) { this.U.uInk.value = a; }
  /** keep grass out of a circle (player foundations, deployables...). Call refresh() after a batch. */
  addBlocker(x, z, r) { this.blockers.push(x, z, r * r); }
  clearBlockers() { this.blockers.length = 0; }
  refresh() { if (!isNaN(this._lastX)) { this.near.update(this._lastX, this._lastZ, true); this.far.update(this._lastX, this._lastZ, true); } }

  update(camX, camZ, timeSec = 0) {
    this.U.uTime.value = timeSec % 4000;
    this.U.uCam.value.set(camX, 0, camZ);
    this._lastX = camX; this._lastZ = camZ;
    this.near.update(camX, camZ, false);
    this.far.update(camX, camZ, false);
  }

  /** density 0..1 at (x,z); writes tip (o.r,g,b) + base (o.br,bg,bb) colours, height scale (o.h), ground height (o.y) */
  sample(x, z, o) {
    const W = this.W;
    let d = 0, r = 0, g = 0, b = 0, br = 0, bg = 0, bb = 0, hm = 0;
    for (let k = 0; k < 5; k++) {
      const bi = W.biomeAt(x + OX[k], z + OZ[k]), wd = WK[k] * DENS[bi];
      if (wd > 0) { const t = TIP[bi], s = BASE[bi]; d += wd; r += wd * t[0]; g += wd * t[1]; b += wd * t[2]; br += wd * s[0]; bg += wd * s[1]; bb += wd * s[2]; hm += wd * HGT[bi]; }
    }
    if (d < 0.03) return 0;
    if (W.isRoad(x, z) || W.isFlat(x, z)) return 0;
    const y = W.height(x, z); if (y < 0.3) return 0;
    const bl = this.blockers;
    for (let i = 0; i < bl.length; i += 3) { const dx = x - bl[i], dz = z - bl[i + 1]; if (dx * dx + dz * dz < bl[i + 2]) return 0; }
    const sx = W.height(x + 0.8, z) - W.height(x - 0.8, z), sz = W.height(x, z + 0.8) - W.height(x, z - 0.8);
    const slope = Math.hypot(sx, sz) / 1.6;
    const pn = this.pn(x / 11, z / 11) + this.pn(x / 4.3 + 17, z / 4.3 - 9) * 0.5;
    const dens = d * sstep(0.3, 0.85, y) * (1 - sat((slope - 0.36) * 3)) * sstep(-0.5, -0.08, pn);
    if (dens <= 0.01) return 0;
    const inv = 1 / d;
    o.r = r * inv; o.g = g * inv; o.b = b * inv; o.br = br * inv; o.bg = bg * inv; o.bb = bb * inv;
    o.h = (hm * inv) * (0.8 + 0.35 * sstep(-0.2, 0.4, pn)); o.y = y;
    return dens;
  }

  dispose() {
    for (const m of this.meshes) { if (m.parent) m.parent.remove(m); m.geometry.dispose(); m.material.dispose(); m.dispose(); }
  }
}
