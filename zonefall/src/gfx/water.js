// ============================================================================
// ZONEFALL 4 — comic-book sea. One draw call, one cheap fragment shader, no
// render targets, writes depth (for the ink-outline pass):
//   - saturated body colour in crisp depth bands: turquoise shallows (see-through
//     over the sand) -> teal -> deep blue; lakes greener and calmer
//   - 3 scrolling samples of a baked, tileable ripple slope map drive a STEPPED
//     fresnel against a flat vivid sky tint -> crisp two-tone ripple patches
//   - crisp white sun / moon glints + glitter path, thin white swirl lines on the
//     swell (iso-lines of the wave height), crisp shoreline foam bands
//   - optional bed-depth map baked from the heightfield (pass W): depth bands,
//     shore transparency, sea/lake mask and a distance-to-shore field for the foam
//
//   const water = makeWater(size, W?);          // W optional: enables depth bands, shore transparency + foam
//   scene.add(water.mesh);                      // game positions it (y = 0 / -0.05, centred on the island)
//   water.update(timeSec, sunDir, skyColor, night, sky?)
//     sunDir: light dir (Vector3), skyColor: horizon/fog Color (linear), night 0..1,
//     sky (optional Sky instance): uses its mid / zenith / glow / sunColor / weather and the TRUE sun & moon
//     positions for the glint (the light dir is clamped and would put the glint path in the wrong place at dusk)
//   water.setDepth(W)                           // (re)bake the depth map later
// Fog is mixed after the (optional) tone-mapping / colour-space chunks exactly like three.js does, so it is
// right both when drawing straight to the screen and into an offscreen HalfFloat target with a post pass.
// ============================================================================
import { THREE } from './materials.js';

const TAU = Math.PI * 2;
const sat = x => (x < 0 ? 0 : x > 1 ? 1 : x);
const sstep = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const fract = x => x - Math.floor(x);
function rng(seed) { let a = seed >>> 0 || 1; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------------------------------------------------------------- ripple slope map (tileable)
// RG = height slope (d/du, d/dv) normalised to 0..1, B = height (crests, used for foam breakup), A = 255
let WAVE_TEX = null;
function waveTexture() {
  if (WAVE_TEX) return WAVE_TEX;
  const S = 256, N = S * S, R = rng(4242);
  const hgt = new Float32Array(N), su = new Float32Array(N), sv = new Float32Array(N);
  // sum of integer-wavevector sines (tiles exactly), mostly along a prevailing wind
  const waves = [];
  for (let i = 0; i < 22; i++) {
    const a = 0.6 + (R() - 0.5) * (i < 14 ? 1.9 : 4.5), k = 2 + Math.pow(R(), 1.4) * 15;
    const kx = Math.round(Math.cos(a) * k), kz = Math.round(Math.sin(a) * k); if (!kx && !kz) continue;
    const km = Math.hypot(kx, kz);
    waves.push(kx, kz, (0.55 + 0.45 * R()) / Math.pow(km, 1.2), R() * TAU);
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, i = y * S + x; let h = 0, du = 0, dv = 0;
    for (let w = 0; w < waves.length; w += 4) {
      const kx = waves[w], kz = waves[w + 1], A = waves[w + 2], th = TAU * (kx * u + kz * v) + waves[w + 3];
      const s = Math.sin(th), c = Math.cos(th);
      h += A * s; du += A * TAU * kx * c; dv += A * TAU * kz * c;
    }
    hgt[i] = h; su[i] = du; sv[i] = dv;
  }
  // periodic gradient-noise chop on top (breaks the regularity of the sines)
  const L = 16, gx = new Float32Array(L * L), gy = new Float32Array(L * L);
  for (let i = 0; i < L * L; i++) { const a = R() * TAU; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
  const nz = new Float32Array(N);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const fx = x / S * L, fy = y / S * L, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const x0 = ix % L, x1 = (ix + 1) % L, y0 = iy % L, y1 = (iy + 1) % L;
    const g = (xi, yi, dx, dy) => gx[yi * L + xi] * dx + gy[yi * L + xi] * dy;
    const a = g(x0, y0, tx, ty), b = g(x1, y0, tx - 1, ty), c = g(x0, y1, tx, ty - 1), d = g(x1, y1, tx - 1, ty - 1);
    nz[y * S + x] = (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
  }
  let mh = 0, ms = 0;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, k = 0.55 * S / L * 0.25;
    su[i] += (nz[y * S + (x + 1) % S] - nz[y * S + (x + S - 1) % S]) * k * L;
    sv[i] += (nz[((y + 1) % S) * S + x] - nz[((y + S - 1) % S) * S + x]) * k * L;
    hgt[i] += nz[i] * 0.4;
    mh = Math.max(mh, Math.abs(hgt[i])); ms = Math.max(ms, Math.abs(su[i]), Math.abs(sv[i]));
  }
  const data = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    data[i * 4] = 127.5 + 127 * su[i] / ms; data[i * 4 + 1] = 127.5 + 127 * sv[i] / ms;
    data[i * 4 + 2] = 127.5 + 127 * hgt[i] / mh; data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = 4; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
  return (WAVE_TEX = t);
}

// ---------------------------------------------------------------- bed depth map (from the heightfield)
// RGBA8: R/A = signed depth below y = 0 as 16 bits (hi/lo byte), range -6..14 m — read with texelFetch at the
//          4 grid corners and interpolated on the SAME triangles terrain.js builds, so the waterline is exact
//        G = open-sea mask (vs lakes), dilated 2 cells (bilinear)
//        B = distance to the shoreline in metres / 16 (sub-cell accurate at the waterline, chamfer beyond; bilinear)
function depthTexture(W) {
  const n = W.n, h = W.h, bio = W.biome, res = W.res || 2, N2 = n * n;
  const sea = new Uint8Array(N2);
  for (let i = 0; i < N2; i++) sea[i] = bio ? (bio[i] === 0 ? 1 : 0) : 1; // B.OCEAN === 0
  for (let pass = 0; pass < 2; pass++) {
    const src = sea.slice();
    for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) { const k = j * n + i; if (!src[k] && (src[k - 1] || src[k + 1] || src[k - n] || src[k + n])) sea[k] = 1; }
  }
  // shoreline distance: exact crossing between a water cell and a land neighbour, then a 2-pass chamfer
  const dist = new Float32Array(N2).fill(1e9);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i, hk = h[k];
    if (hk >= 0) { dist[k] = 0; continue; }
    const nb = (kk) => { const hl = h[kk]; if (hl >= 0) { const d = res * (-hk) / (hl - hk); if (d < dist[k]) dist[k] = d; } };
    if (i > 0) nb(k - 1); if (i < n - 1) nb(k + 1); if (j > 0) nb(k - n); if (j < n - 1) nb(k + n);
  }
  const dg = res * Math.SQRT2;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i; let d = dist[k]; if (d === 0) continue;
    if (i > 0) d = Math.min(d, dist[k - 1] + res); if (j > 0) { d = Math.min(d, dist[k - n] + res); if (i > 0) d = Math.min(d, dist[k - n - 1] + dg); if (i < n - 1) d = Math.min(d, dist[k - n + 1] + dg); }
    dist[k] = d;
  }
  for (let j = n - 1; j >= 0; j--) for (let i = n - 1; i >= 0; i--) {
    const k = j * n + i; let d = dist[k]; if (d === 0) continue;
    if (i < n - 1) d = Math.min(d, dist[k + 1] + res); if (j < n - 1) { d = Math.min(d, dist[k + n] + res); if (i < n - 1) d = Math.min(d, dist[k + n + 1] + dg); if (i > 0) d = Math.min(d, dist[k + n - 1] + dg); }
    dist[k] = d;
  }
  const data = new Uint8Array(N2 * 4);
  for (let i = 0; i < N2; i++) {
    const q = Math.round((Math.min(14, Math.max(-6, -h[i])) + 6) / 20 * 65535);
    data[i * 4] = q >> 8; data[i * 4 + 3] = q & 255; data[i * 4 + 1] = sea[i] * 255;
    data[i * 4 + 2] = Math.round(Math.min(1, dist[i] / 16) * 255);
  }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.unpackAlignment = 1; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------- shaders
const VERT = /* glsl */`
varying vec3 vW;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */`
uniform sampler2D uWave; uniform sampler2D uDepth;
uniform vec4 uOffA; uniform vec4 uOffB; uniform vec4 uDepthXf; uniform vec2 uGrid;
uniform float uHasDepth; uniform float uWaterY; uniform float uFoamPh; uniform float uLight;
uniform vec3 uSkyTint; uniform vec3 uGlow; uniform vec3 uSunDir;
uniform vec3 uGlintDir; uniform vec3 uGlintCol;
uniform vec3 uShallow; uniform vec3 uMid; uniform vec3 uDeep;
uniform vec3 uLakeShallow; uniform vec3 uLakeMid; uniform vec3 uLakeDeep; uniform vec3 uFoamCol;
varying vec3 vW;
#include <common>
#include <fog_pars_fragment>

const mat2 RB = mat2(0.8, 0.6, -0.6, 0.8);
const mat2 RC = mat2(0.28, -0.96, 0.96, 0.28);
// crisp, anti-aliased step
float cstep(float e, float x) { float w = max(fwidth(x), 1e-5); return smoothstep(e - w, e + w, x); }
float dAt(ivec2 c) { c = clamp(c, ivec2(0), ivec2(int(uGrid.y) - 1)); vec4 t = texelFetch(uDepth, c, 0); return (t.r * 65280.0 + t.a * 255.0) / 65535.0 * 20.0 - 6.0; }
// bed depth interpolated on the terrain's own triangles (terrain.js alternates the diagonal by (i + j) parity).
// returns (depth, |slope| per metre) of that exact triangle
vec2 bedDepth(vec2 p) {
  vec2 g = p * uGrid.x; vec2 f = floor(g); vec2 t = g - f; ivec2 i = ivec2(f);
  float a = dAt(i), b = dAt(i + ivec2(1, 0)), c = dAt(i + ivec2(0, 1)), d = dAt(i + ivec2(1, 1));
  vec2 gr; float h;
  if (((i.x + i.y) & 1) == 1) {
    if (t.x + t.y < 1.0) { gr = vec2(b - a, c - a); h = a + gr.x * t.x + gr.y * t.y; }
    else { gr = vec2(d - c, d - b); h = d - gr.x * (1.0 - t.x) - gr.y * (1.0 - t.y); }
  } else {
    if (t.y > t.x) { gr = vec2(d - c, c - a); } else { gr = vec2(b - a, d - b); }
    h = a + gr.x * t.x + gr.y * t.y;
  }
  return vec2(h, length(gr) * uGrid.x);
}

void main() {
  vec3 toCam = cameraPosition - vW;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  vec2 p = vW.xz;
  float nearK = 1.0 - smoothstep(5.0, 140.0, dist);
  // ---- ripples: 3 scrolling samples of the slope map (rotated so their patterns never line up)
  vec4 wA = texture2D(uWave, p * 0.047 + uOffA.xy);
  vec4 wB = texture2D(uWave, (RB * p) * 0.137 + uOffA.zw);
  vec4 wC = texture2D(uWave, (RC * p) * 0.43 + uOffB.xy);
  vec2 sl = (wA.xy - 0.5) * 0.30 + ((wB.xy - 0.5) * RB) * 0.26 + ((wC.xy - 0.5) * RC) * (0.2 * (0.25 + 0.75 * nearK));
  sl *= 0.35 + 0.65 * nearK;
  vec3 N = normalize(vec3(-sl.x, 1.0, -sl.y));
  // ---- bed depth / sea mask / distance to shore
  float depth = 12.0, sea = 1.0, shoreD = 16.0, wl = 99.0;
  if (uHasDepth > 0.5) {
    vec3 dm = texture2D(uDepth, p * uDepthXf.xy + uDepthXf.zw).rgb;
    vec2 bd = bedDepth(p);
    depth = max(bd.x + uWaterY, 0.0);
    sea = dm.g; shoreD = dm.b * 16.0;
    wl = depth / max(bd.y, 0.03);                                     // metres to the exact waterline
  }
  // ---- body: crisp depth bands (wobbled a little by the swell so the band edges are not contour-perfect)
  float dq = depth + (wB.z - 0.5) * 0.35;
  float b1 = cstep(mix(0.45, 0.7, sea), dq), b2 = cstep(mix(1.2, 3.2, sea), dq);
  vec3 body = mix(mix(mix(uLakeShallow, uShallow, sea), mix(uLakeMid, uMid, sea), b1), mix(uLakeDeep, uDeep, sea), b2);
  float aBody = mix(mix(0.5, 0.86, b1), 1.0, b2) * smoothstep(0.0, 0.05, depth + 0.02);
  // ---- stepped fresnel against a flat sky tint -> two-tone ripple patches
  float NdV = clamp(dot(N, V), 0.0, 1.0);
  float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  float Fq = 0.42 * cstep(0.22, F) + 0.33 * cstep(0.58, F);
  vec3 R = reflect(-V, N); R.y = abs(R.y);
  vec2 sh = normalize(uSunDir.xz + vec2(1e-5));
  float az = dot(normalize(R.xz + vec2(1e-5)), sh) * 0.5 + 0.5;
  vec3 refl = uSkyTint + uGlow * (pow(az, 10.0) * exp(-R.y * 8.0) * 0.55);              // dusk glow reflected toward the sun
  vec3 col = mix(body, refl, Fq) * uLight;
  float alpha = mix(aBody, 1.0, Fq);
  // ---- thin white swirl lines on the swell (iso-line of the wave height), out in open water only
  float iso = abs(wB.z - 0.8);
  float swirl = (1.0 - smoothstep(0.012, 0.012 + fwidth(wB.z) * 1.2, iso)) * cstep(0.6, wA.z) * nearK * nearK * cstep(1.5, depth) * sea * 0.7;
  // ---- shoreline foam: lapping line + surf lines rolling in, all crisp
  float foam = 0.0;
  if (uHasDepth > 0.5) {
    // lapping line: constant width at the exact waterline (wl jumps across terrain triangle edges, so clamp the AA width)
    float ew = min(fwidth(wl), 0.06), ee = 0.26 + (wC.z - 0.5) * 0.3 + (wB.z - 0.5) * 0.2;
    float edge = (1.0 - smoothstep(ee - ew, ee + ew, wl)) * (1.0 - step(0.5, depth));
    float bands = sin(shoreD * 3.0 + uFoamPh + (wB.z - 0.5) * 5.0) * 0.5 + 0.5;
    float surf = cstep(0.93, bands + (wC.z - 0.5) * 0.3) * (1.0 - smoothstep(0.8, 3.0, shoreD)) * cstep(0.06, depth);
    foam = max(edge, surf * 0.9) * mix(0.35, 1.0, sea) * (0.5 + 0.5 * nearK);
  }
  float white = max(foam, swirl);
  col = mix(col, uFoamCol * max(uLight, 0.2), white);
  alpha = max(alpha, white);
  // ---- crisp glints: sparkles + glitter path
  float gl = max(dot(R, uGlintDir), 0.0);
  float spark = cstep(0.5, pow(gl, 260.0)) + 0.7 * cstep(0.5, pow(gl, 10.0) * smoothstep(0.42, 0.78, wC.z * 0.6 + wB.z * 0.55));
  vec3 spec = uGlintCol * spark;
  col += spec;
  float sLum = clamp(dot(spec, vec3(0.4)), 0.0, 1.0);
  alpha = max(alpha, sLum);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // ---- fog exactly like three.js (after tone mapping; fogColor is in that same space); glints punch through
  #ifdef USE_FOG
    float fogF = smoothstep(fogNear, fogFar, vFogDepth);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogF * (1.0 - sLum * 0.7));
  #endif
}`;

// ---------------------------------------------------------------- factory
const C_SUN = new THREE.Color('#fff6dc'), C_MOON = new THREE.Color('#c8d8ff'), _t = new THREE.Color();
export function makeWater(size = 3200, W = null) {
  const geo = new THREE.PlaneGeometry(size, size, 1, 1); geo.rotateX(-Math.PI / 2);
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uWave: { value: null }, uDepth: { value: null },
    uOffA: { value: new THREE.Vector4() }, uOffB: { value: new THREE.Vector4() }, uDepthXf: { value: new THREE.Vector4(0, 0, 0, 0) }, uGrid: { value: new THREE.Vector2(0.5, 2) },
    uHasDepth: { value: 0 }, uWaterY: { value: 0 }, uFoamPh: { value: 0 }, uLight: { value: 1 },
    uSkyTint: { value: new THREE.Color('#7ccaf2') }, uGlow: { value: new THREE.Color(0, 0, 0) },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uGlintDir: { value: new THREE.Vector3(0, 1, 0) }, uGlintCol: { value: new THREE.Color(0, 0, 0) },
    uShallow: { value: new THREE.Color('#46e0cc') }, uMid: { value: new THREE.Color('#14aebb') }, uDeep: { value: new THREE.Color('#0b6eaa') },
    uLakeShallow: { value: new THREE.Color('#58cfa6') }, uLakeMid: { value: new THREE.Color('#249a8c') }, uLakeDeep: { value: new THREE.Color('#16707c') },
    uFoamCol: { value: new THREE.Color('#ffffff') },
  }]);
  uniforms.uWave.value = waveTexture();
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: true, fog: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'water'; mesh.renderOrder = -1; // first of the transparent pass: smoke / fx above the sea blend over it
  mesh.castShadow = false; mesh.receiveShadow = false;
  const U = uniforms;
  let depthTex = null;
  function setDepth(world) {
    if (depthTex) { depthTex.dispose(); depthTex = null; }
    if (!world || !world.h || !world.n) { U.uHasDepth.value = 0; return; }
    depthTex = depthTexture(world); U.uDepth.value = depthTex; U.uHasDepth.value = 1;
    const n = world.n, res = world.res || (world.size / (n - 1));
    U.uDepthXf.value.set(1 / (res * n), 1 / (res * n), 0.5 / n, 0.5 / n); U.uGrid.value.set(1 / res, n);
  }
  setDepth(W);

  function update(timeSec = 0, sunDir = null, skyColor = null, night = 0, sky = null) {
    const t = timeSec;
    U.uOffA.value.set(fract(t * 0.0057), fract(t * 0.0039), fract(-t * 0.0112), fract(t * 0.0081));
    U.uOffB.value.set(fract(t * 0.0215), fract(-t * 0.0163), 0, 0);
    U.uFoamPh.value = (t * 1.35) % TAU;
    U.uWaterY.value = mesh.position.y;
    const hz = skyColor || _t.setRGB(0.85, 0.88, 0.8);
    const lum = hz.r * 0.2126 + hz.g * 0.7152 + hz.b * 0.0722;
    U.uLight.value = Math.min(1.05, Math.max(0.1, Math.pow(lum / 0.8, 0.85)));
    const w = sky ? sky.weather || 0 : 0;
    // flat sky tint the ripples flip to: the vivid mid-sky blue (falls back to a bluer horizon); weather greys it
    const st = U.uSkyTint.value;
    if (sky && sky.mid) { st.copy(sky.zenith).lerp(sky.mid, 0.45 * sstep(0.3, 1, sky.day)); U.uGlow.value.copy(sky.glow); U.uSunDir.value.copy(sky.sunPos); }
    else { st.setRGB(hz.r * 0.45, hz.g * 0.75, Math.min(1, hz.b * 1.1)); U.uGlow.value.setRGB(0, 0, 0); if (sunDir) U.uSunDir.value.copy(sunDir); }
    st.multiplyScalar(1 / U.uLight.value); // (body * light) and the tint share one scale in the shader
    // glint: real sun disc by day, moon at night
    const gd = U.uGlintDir.value, gc = U.uGlintCol.value;
    if (sky && sky.sunPos) {
      const sy = sky.sunPos.y;
      if (sy > -0.03) { gd.copy(sky.sunPos); gc.copy(C_SUN).lerp(sky.sunColor, 0.4 + 0.6 * (1 - sstep(0.05, 0.4, sy))).multiplyScalar((1.15 + 0.45 * sstep(0.05, 0.4, sy)) * sstep(-0.03, 0.05, sy) * (1 - 0.9 * w)); }
      else { gd.copy(sky.moonPos); gc.copy(C_MOON).multiplyScalar(0.9 * sstep(-0.02, 0.08, sky.moonPos.y) * (1 - 0.9 * w)); }
    } else if (sunDir) {
      gd.copy(sunDir);
      if (night > 0.5) gc.copy(C_MOON).multiplyScalar(0.8); else gc.copy(C_SUN).multiplyScalar(1.5 * sstep(0.0, 0.15, sunDir.y));
    }
  }
  update(0, null, null, 0, null);
  return { mesh, update, setDepth, material: mat, uniforms: U };
}
