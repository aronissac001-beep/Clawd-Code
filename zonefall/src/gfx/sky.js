// ============================================================================
// ZONEFALL 4 — comic-book sky dome. One draw call, one cheap fragment shader:
// vivid 3-stop gradient (pale warm horizon -> bright cyan -> saturated blue by
// day; bold orange / magenta at dusk; deep blue — never black — at night),
// crisp sun disc with a flat halo ring, crisp moon with flat maria, bright
// twinkling stars, and flat two-tone cloud puffs with crisp anti-aliased edges
// and a thin ink rim. Thickens to a grey two-tone deck with the weather.
//
//   const sky = new Sky(scene);
//   sky.update(dayT, camera, weather);  // dayT 0..1 (0 midnight, .25 dawn, .5 noon, .75 dusk), weather 0..1
//   sky.horizon  THREE.Color (linear)  -> scene.fog.color / background (bright, it is the haze colour)
//   sky.sunDir   THREE.Vector3          -> directional light (sun by day, moon by night, swung over the top at twilight)
//   extras: sky.zenith, sky.mid, sky.glow, sky.sunColor (suggested light colour), sky.sunPos / sky.moonPos
//           (true disc directions), sky.day / night / dusk / elev / weather, sky.mesh
//
// Pipeline: the dome ignores camera.far (rotation-only view matrix, z pinned inside the clip volume) and draws
// first with depthTest/depthWrite off. It is never tone-mapped by three: rendering straight to the screen
// three.js mixes fog AFTER tone mapping, so an untone-mapped dome matches the fogged distance exactly; rendering
// into an offscreen (HalfFloat) target it outputs plain linear colour, which the post pass tone-maps together with
// the fog — again an exact match. The highlight knee + dither are applied only when drawing straight to the screen.
// ============================================================================
import { THREE } from './materials.js';

const TAU = Math.PI * 2;
const SUN_TILT = 0.5;   // sun path leans toward +Z (south): noon elevation ~61°
const MOON_TILT = 0.98; // moon path leans further south: midnight elevation ~34°, so it is seen at eye level
const SUN_R = 0.026;    // angular radii (rad), exaggerated so they read on a phone
const MOON_R = 0.03;

const sat = x => (x < 0 ? 0 : x > 1 ? 1 : x);
const sstep = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lin = hex => new THREE.Color(hex); // Color.set(hex) converts sRGB -> linear working space

// ---------------------------------------------------------------- palette (sRGB hex, as displayed)
// keyed by sun elevation e = sin((dayT - .25) * 2PI) — the same curve Renderer.setTime uses.
//      e      zenith     mid        horizon    glow     amt   cloud lit  cloud shade
const KEYS = [
  [-1.00, '#0c1a50', '#15296c', '#21407e', '#000000', 0.0, '#4a64a6', '#25386e'],
  [-0.30, '#0d1c54', '#172d72', '#244584', '#000000', 0.0, '#4c66a8', '#263a72'],
  [-0.15, '#1a2266', '#3a3a92', '#6a4c9c', '#c24a8c', 0.35, '#8a70b8', '#3f3678'],
  [-0.06, '#262a7c', '#7e3a94', '#e2568e', '#ff6a3a', 0.6, '#f68a9a', '#6c3c80'],
  [ 0.00, '#343a98', '#c84a90', '#ff8a3c', '#ffb43a', 0.85, '#ffb27a', '#b0507e'],
  [ 0.06, '#3a5cc0', '#e48296', '#ffb466', '#ffd060', 0.55, '#ffe0b2', '#c47a96'],
  [ 0.16, '#2f78de', '#8ccaf2', '#ffe2b4', '#fff0c0', 0.22, '#ffffff', '#a9c2ea'],
  [ 0.32, '#2380ee', '#6cc6f6', '#f6f2e0', '#fff6e0', 0.1, '#ffffff', '#a6c4ee'],
  [ 1.00, '#1c7ae8', '#62c0f4', '#f2f2e2', '#fff6e0', 0.06, '#ffffff', '#a4c2ee'],
].map(k => ({ e: k[0], zen: lin(k[1]), mid: lin(k[2]), hor: lin(k[3]), glow: lin(k[4]).multiplyScalar(k[5]), cld: lin(k[6]), cldD: lin(k[7]) }));
// overcast deck (scaled by daylight)
const OVC = { zen: lin('#8796ac'), mid: lin('#a2aebe'), hor: lin('#c4ccd4'), cld: lin('#d4dae2'), cldD: lin('#8b96a8') };

const SUN_LOW = lin('#ffa040'), SUN_HIGH = lin('#fff6d6'), MOON_LIGHT = lin('#a8bcf0'), MOON_DISC = lin('#eef0ff');
const DAWN_TINT = new THREE.Color(0.9, 0.86, 1.14);

// ---------------------------------------------------------------- noise texture
// Tileable gradient-noise fBm, 4 channels (R: cloud shapes, G: cloud detail, B: moon maria / milky way).
// Built once, shared by every Sky.
let NOISE_TEX = null;
function noiseTexture() {
  if (NOISE_TEX) return NOISE_TEX;
  const S = 256, data = new Uint8Array(S * S * 4);
  let seed = 9137;
  const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const acc = new Float32Array(S * S);
  const octave = (L, amp) => {
    const gx = new Float32Array(L * L), gy = new Float32Array(L * L);
    for (let i = 0; i < L * L; i++) { const a = rnd() * TAU; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
    for (let y = 0; y < S; y++) {
      const fy = y / S * L, iy = Math.floor(fy), ty = fy - iy, sy = ty * ty * ty * (ty * (ty * 6 - 15) + 10);
      const y0 = iy % L, y1 = (iy + 1) % L;
      for (let x = 0; x < S; x++) {
        const fx = x / S * L, ix = Math.floor(fx), tx = fx - ix, sx = tx * tx * tx * (tx * (tx * 6 - 15) + 10);
        const x0 = ix % L, x1 = (ix + 1) % L;
        const k00 = y0 * L + x0, k10 = y0 * L + x1, k01 = y1 * L + x0, k11 = y1 * L + x1;
        const a = gx[k00] * tx + gy[k00] * ty, b = gx[k10] * (tx - 1) + gy[k10] * ty;
        const c = gx[k01] * tx + gy[k01] * (ty - 1), d = gx[k11] * (tx - 1) + gy[k11] * (ty - 1);
        const ab = a + (b - a) * sx, cd = c + (d - c) * sx;
        acc[y * S + x] += (ab + (cd - ab) * sy) * amp;
      }
    }
  };
  const channel = (ch, periods, gain) => {
    acc.fill(0); let amp = 1;
    for (const L of periods) { octave(L, amp); amp *= gain; }
    let lo = 1e9, hi = -1e9; for (let i = 0; i < S * S; i++) { lo = Math.min(lo, acc[i]); hi = Math.max(hi, acc[i]); }
    const k = 255 / (hi - lo || 1); for (let i = 0; i < S * S; i++) data[i * 4 + ch] = (acc[i] - lo) * k;
  };
  channel(0, [4, 8, 16, 32], 0.45);
  channel(1, [8, 16, 32, 64], 0.5);
  channel(2, [5, 10, 20, 40], 0.55);
  for (let i = 0; i < S * S; i++) data[i * 4 + 3] = 255;
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
  return (NOISE_TEX = t);
}

// ---------------------------------------------------------------- shaders
const VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  // camera-centred: rotation only, so the dome never needs re-positioning and never clips at any camera.far
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  p.z = p.w * 0.9995;
  gl_Position = p;
}`;

const FRAG = /* glsl */`
uniform vec3 uZen; uniform vec3 uMid; uniform vec3 uHor; uniform vec3 uGlow;
uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uHalo;
uniform vec3 uMoonDir; uniform vec3 uMoonR; uniform vec3 uMoonU; uniform vec3 uMoonCol; uniform float uMoonAmt;
uniform vec3 uCld; uniform vec3 uCldD; uniform float uCover; uniform float uWeather;
uniform vec4 uWind; uniform float uStars; uniform float uTime; uniform mat3 uStarRot; uniform float uDirect;
uniform sampler2D uNoise;
varying vec3 vDir;

float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
// crisp, anti-aliased step
float cstep(float e, float x) { float w = max(fwidth(x), 1e-5); return smoothstep(e - w, e + w, x); }

void main() {
  vec3 d = normalize(vDir);
  float h = d.y, hp = max(h, 0.0);
  float above = smoothstep(-0.04, 0.0, h);
  // ---- vivid 3-stop gradient
  vec3 col = mix(mix(uHor, uMid, smoothstep(0.0, 0.3, hp)), uZen, smoothstep(0.16, 0.85, hp));
  // ---- dawn / dusk: bold band toward the sun + soft wash around it
  vec2 sh = normalize(uSunDir.xz + vec2(1e-5));
  float az = dot(normalize(d.xz + vec2(1e-5)), sh) * 0.5 + 0.5;
  float mu = dot(d, uSunDir), mup = max(mu, 0.0);
  col += uGlow * (pow(az, 4.0) * exp(-hp * 5.0) * above + pow(mup, 8.0) * 0.25 * above);
  col += uHalo * (pow(mup, 18.0) * above);
  // ---- stars + faint milky way
  if (uStars > 0.002) {
    vec3 sd = uStarRot * d;
    vec3 p = sd * 95.0, ip = floor(p), fp = fract(p) - 0.5;
    float r = hash13(ip);
    vec3 o = vec3(hash13(ip + 17.1), hash13(ip + 41.7), hash13(ip + 73.3)) - 0.5;
    float px = max(length(fwidth(p)), 1e-4);
    float dd = length(fp - o * 0.55) / max(0.22, px * 1.1);
    float mag = step(0.94, r) * (0.5 + 2.2 * pow(fract(r * 91.7), 3.0));
    float tw = 0.65 + 0.35 * sin(uTime * (1.3 + 3.7 * fract(r * 13.1)) + r * 80.0);
    vec3 sc = mix(vec3(0.8, 0.88, 1.0), vec3(1.0, 0.9, 0.7), fract(r * 37.3));
    float vis = uStars * smoothstep(0.01, 0.2, h);
    col += sc * (mag * tw * smoothstep(1.0, 0.3, dd) * 1.5 * vis);
    float mw = exp(-pow(dot(sd, vec3(0.32, 0.38, 0.87)) / 0.2, 2.0));
    float mt = texture2D(uNoise, sd.xz * 0.55 + sd.y * 0.21).b;
    col += vec3(0.3, 0.36, 0.62) * (mw * smoothstep(0.4, 0.8, mt) * 0.1 * vis);
  }
  // ---- moon: crisp disc, flat maria, halo ring
  if (uMoonAmt > 0.002) {
    vec3 md = d - uMoonDir;
    vec2 q = vec2(dot(md, uMoonR), dot(md, uMoonU)) / ${MOON_R.toFixed(4)};
    float r = length(q);
    float front = step(0.0, dot(d, uMoonDir)) * above;
    float disc = (1.0 - cstep(1.0, r)) * front;
    float mare = texture2D(uNoise, q * 0.19 + vec2(0.37, 0.61)).b;
    vec3 mc = uMoonCol * mix(1.0, 0.78, cstep(0.56, mare));
    float ring = (1.0 - cstep(1.75, r)) * front;
    col = mix(col, mix(col, uMoonCol, 0.16), ring * uMoonAmt);
    col = mix(col, mc, disc * uMoonAmt);
    col += uMoonCol * (pow(max(dot(d, uMoonDir), 0.0), 60.0) * 0.06) * uMoonAmt * above;
  }
  // ---- sun: crisp disc + flat halo ring + bloom
  float sdist = length(d - uSunDir) / ${SUN_R.toFixed(4)};
  float sdisc = (1.0 - cstep(1.0, sdist)) * smoothstep(-0.012, 0.003, h);
  float sring = (1.0 - cstep(1.9, sdist)) * above;
  vec3 sunL = uSunCol * (sdisc + sring * 0.12 + pow(mup, 900.0) * 0.15) * above;
  // ---- clouds: flat two-tone puffs (crisp edge, shade on the side away from the sun, thin ink rim)
  vec2 cuv = d.xz / (hp + 0.16);
  vec2 uv1 = cuv * 0.095 + uWind.xy, uv2 = cuv * 0.3 + uWind.zw;
  float n = texture2D(uNoise, uv1).r * 0.88 + texture2D(uNoise, uv2).g * 0.12;
  vec2 ts = sh * 0.035;
  float n2 = texture2D(uNoise, uv1 + ts).r * 0.88 + texture2D(uNoise, uv2 + ts * 3.2).g * 0.12;
  float th = 1.0 - uCover;
  float hfade = smoothstep(0.0, 0.12, h);
  float ca = cstep(th, n) * hfade;
  float shade = cstep(0.012, n2 - n + 0.004 * (1.0 - uWeather)) * (1.0 - uWeather * 0.35);
  shade = max(shade, cstep(th + 0.2, n) * uWeather);                          // heavy cores under a storm deck
  float rim = (1.0 - cstep(th + 0.012, n)) * ca;                               // thin ink line just inside the edge
  vec3 cc = mix(uCld, uCldD, shade);
  cc = mix(cc, uCldD * 0.72, rim * 0.6);
  cc += uHalo * (pow(mup, 6.0) * 0.5 * (1.0 - shade));                         // warm sun-side cloud edges at dawn / dusk
  cc = mix(cc, uHor, (1.0 - smoothstep(0.0, 0.28, h)) * 0.45);                 // distance haze near the horizon
  col = mix(col + sunL, cc, ca);
  col += uSunCol * (pow(mup, 12.0) * 0.01 * uWeather) * above;                 // sun glow through an overcast deck
  if (uDirect > 0.5) {
    // straight to the screen (no post pass): soft knee for the highlights + dither against banding
    col = mix(col, 1.0 - 0.2 * exp((0.8 - col) * 5.0), step(0.8, col));
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
  if (uDirect > 0.5) gl_FragColor.rgb += (hash12(gl_FragCoord.xy) - 0.5) * (1.5 / 255.0);
}`;

// ---------------------------------------------------------------- Sky
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color(), _m4 = new THREE.Matrix4(), _axis = new THREE.Vector3(0, 0.57, -0.82).normalize();

export class Sky {
  constructor(scene, opts = {}) {
    this.radius = opts.radius || 380;
    this.horizon = new THREE.Color('#f2f2e2');
    this.mid = new THREE.Color('#62c0f4');
    this.zenith = new THREE.Color('#1c7ae8');
    this.glow = new THREE.Color(0, 0, 0);
    this.sunColor = new THREE.Color('#fff6d6');
    this.cloudColor = new THREE.Color(1, 1, 1); this.cloudShade = new THREE.Color(0.6, 0.6, 0.6);
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.sunPos = new THREE.Vector3(0, 1, 0); this.moonPos = new THREE.Vector3(0, -1, 0);
    this.day = 1; this.night = 0; this.dusk = 0; this.elev = 1; this.weather = 0;
    this.u = {
      uZen: { value: this.zenith }, uMid: { value: this.mid }, uHor: { value: this.horizon }, uGlow: { value: this.glow },
      uSunDir: { value: this.sunPos }, uSunCol: { value: new THREE.Color() }, uHalo: { value: new THREE.Color() },
      uMoonDir: { value: this.moonPos }, uMoonR: { value: new THREE.Vector3(1, 0, 0) }, uMoonU: { value: new THREE.Vector3(0, 1, 0) },
      uMoonCol: { value: new THREE.Color() }, uMoonAmt: { value: 0 },
      uCld: { value: this.cloudColor }, uCldD: { value: this.cloudShade }, uCover: { value: 0.4 }, uWeather: { value: 0 },
      uWind: { value: new THREE.Vector4() }, uStars: { value: 0 }, uTime: { value: 0 }, uStarRot: { value: new THREE.Matrix3() },
      uDirect: { value: 1 }, uNoise: { value: noiseTexture() },
    };
    const mat = new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: VERT, fragmentShader: FRAG, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false, toneMapped: false });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(this.radius, 32, 16), mat);
    this.mesh.name = 'sky'; this.mesh.renderOrder = -1000; this.mesh.frustumCulled = false;
    this.mesh.castShadow = false; this.mesh.receiveShadow = false; this.mesh.matrixAutoUpdate = false;
    const U = this.u;
    // knee + dither only when drawing straight to the screen (no offscreen target / post pass)
    this.mesh.onBeforeRender = (renderer) => { U.uDirect.value = renderer.getRenderTarget() === null ? 1 : 0; };
    if (scene) scene.add(this.mesh);
    this.update(0.5, null, 0);
  }

  /** dayT 0..1 (0 = midnight, .25 dawn, .5 noon, .75 dusk), camera (optional), weather 0 clear .. 1 overcast/storm */
  update(dayT, camera, weather = 0) {
    const w = sat(weather || 0); this.weather = w;
    const ang = (dayT - 0.25) * TAU, e = Math.sin(ang), ca = Math.cos(ang);
    this.elev = e;
    // ---- sun + moon positions (unit vectors). Sun: rises +X, sets -X, leans +Z. Moon: opposite phase (full), rises at dusk.
    this.sunPos.set(ca, e * Math.cos(SUN_TILT), e * Math.sin(SUN_TILT));
    this.moonPos.set(-ca, -e * Math.cos(MOON_TILT), -e * Math.sin(MOON_TILT));
    // ---- light direction: sun by day, moon by night, swung over the top through twilight (never through zero)
    const ws = sstep(-0.1, 0.03, e);
    _a.set(this.sunPos.x, Math.max(this.sunPos.y, 0.1), this.sunPos.z).normalize();
    _b.set(this.moonPos.x * 0.7, Math.max(this.moonPos.y, 0.45), this.moonPos.z).normalize();
    this.sunDir.copy(_b).lerp(_a, ws); this.sunDir.y += Math.sin(Math.PI * ws) * 0.6; this.sunDir.normalize();
    // ---- phase factors (same formulas as Renderer.setTime)
    this.day = sat(e * 3 + 0.25); this.night = 1 - this.day;
    this.dusk = sat(1 - Math.abs(e) * 4) * (e > -0.35 ? 1 : 0);
    // ---- palette
    let i = 0; while (i < KEYS.length - 2 && e > KEYS[i + 1].e) i++;
    const A = KEYS[i], Bk = KEYS[i + 1], t = sat((e - A.e) / (Bk.e - A.e));
    this.zenith.copy(A.zen).lerp(Bk.zen, t); this.mid.copy(A.mid).lerp(Bk.mid, t); this.horizon.copy(A.hor).lerp(Bk.hor, t);
    this.glow.copy(A.glow).lerp(Bk.glow, t);
    this.cloudColor.copy(A.cld).lerp(Bk.cld, t); this.cloudShade.copy(A.cldD).lerp(Bk.cldD, t);
    // dawn is a touch cooler / rosier than dusk
    const dawn = dayT < 0.5 ? this.dusk : 0;
    if (dawn > 0) { this.glow.r *= 1 + (DAWN_TINT.r - 1) * dawn; this.glow.g *= 1 + (DAWN_TINT.g - 1) * dawn; this.glow.b *= 1 + (DAWN_TINT.b - 1) * dawn; }
    // ---- weather: blend toward a flat blue-grey deck, scaled by how bright the clear sky is
    if (w > 0) {
      const lh = this.horizon.r * 0.2126 + this.horizon.g * 0.7152 + this.horizon.b * 0.0722;
      const k = Math.min(1, lh / 0.85) * 0.92 + 0.08, ww = w * 0.9;
      this.horizon.lerp(_c.copy(OVC.hor).multiplyScalar(k), ww); this.mid.lerp(_c.copy(OVC.mid).multiplyScalar(k), ww);
      this.zenith.lerp(_c.copy(OVC.zen).multiplyScalar(k), ww);
      this.cloudColor.lerp(_c.copy(OVC.cld).multiplyScalar(k), w * 0.8); this.cloudShade.lerp(_c.copy(OVC.cldD).multiplyScalar(k), w * 0.8);
      this.glow.multiplyScalar(1 - w * 0.8);
    }
    // ---- sun / moon colours
    const sw = sstep(-0.03, 0.32, e);
    this.sunColor.copy(SUN_LOW).lerp(SUN_HIGH, sw);
    if (ws < 0.5) this.sunColor.lerp(MOON_LIGHT, 1 - ws * 2);
    const U = this.u;
    U.uSunCol.value.copy(SUN_LOW).lerp(SUN_HIGH, sw).multiplyScalar((2.2 + 4 * sw) * sstep(-0.06, 0.0, e) * (1 - 0.75 * w));
    U.uHalo.value.copy(SUN_LOW).lerp(SUN_HIGH, sw * 0.5).multiplyScalar((0.45 * (1 - sstep(0.02, 0.4, e)) + 0.06) * sstep(-0.08, 0.0, e) * (1 - 0.7 * w));
    U.uMoonAmt.value = sstep(-0.03, 0.06, this.moonPos.y) * (1 - 0.7 * this.day) * (1 - 0.85 * w);
    U.uMoonCol.value.copy(MOON_DISC).multiplyScalar(0.85 + 0.35 * this.night);
    U.uMoonR.value.crossVectors(this.moonPos, _up).normalize(); U.uMoonU.value.crossVectors(U.uMoonR.value, this.moonPos).normalize();
    U.uStars.value = (1 - sstep(-0.24, -0.05, e)) * (1 - w * 0.95);
    U.uCover.value = 0.36 + 0.62 * w; U.uWeather.value = w;
    // ---- animation (real time, wrapped so float precision stays good)
    const now = performance.now() * 0.001;
    U.uTime.value = now % 3600;
    U.uWind.value.set((now * 0.0013) % 1, (now * 0.0006) % 1, (now * 0.0024) % 1, (now * 0.001) % 1);
    U.uStarRot.value.setFromMatrix4(_m4.makeRotationAxis(_axis, dayT * TAU));
    if (camera) { this.mesh.position.copy(camera.position); this.mesh.updateMatrix(); this.mesh.updateMatrixWorld(); }
  }

  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); if (this.mesh.parent) this.mesh.parent.remove(this.mesh); }
}
