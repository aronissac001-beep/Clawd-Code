// ============================================================================
// ZONEFALL 4 — eye-level rain and snow. A fixed set of streaks / flakes lives
// in a box that wraps around the camera; all motion is done in the vertex
// shader, so it costs two draw calls and no per-frame CPU work.
// ============================================================================
import { THREE } from './materials.js';

const BOX = 26;          // metres, wraps around the camera
const RAIN_N = 2400, SNOW_N = 2600;

const VERT_COMMON = `
  uniform vec3 uCam; uniform float uT; uniform float uBox; uniform vec2 uWind; uniform float uFall;
  attribute vec4 aSeed; varying float vA;
  vec3 wrapPos() {
    vec3 p = aSeed.xyz * uBox;
    float sp = uFall * (0.8 + aSeed.w * 0.4);
    p += vec3(uWind.x, -sp, uWind.y) * uT;
    vec3 base = uCam - vec3(uBox * 0.5, uBox * 0.42, uBox * 0.5);
    return base + mod(p - base, uBox);
  }`;

export class Precip {
  constructor(scene) {
    this.scene = scene; this.t = 0; this.k = 0; this.snowK = 0;
    this.rain = this.make(RAIN_N, true); this.snow = this.make(SNOW_N, false);
  }
  make(n, streaks) {
    const verts = streaks ? n * 2 : n;
    const seed = new Float32Array(verts * 4), end = new Float32Array(verts), pos = new Float32Array(verts * 3);
    for (let i = 0; i < n; i++) {
      const s = [Math.random(), Math.random(), Math.random(), Math.random()];
      for (let e = 0; e < (streaks ? 2 : 1); e++) { const v = streaks ? i * 2 + e : i; seed.set(s, v * 4); end[v] = e; }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    if (streaks) geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    const uniforms = {
      uCam: { value: new THREE.Vector3() }, uT: { value: 0 }, uBox: { value: BOX }, uWind: { value: new THREE.Vector2(1.4, 0.6) },
      uFall: { value: streaks ? 16 : 1.9 }, uLen: { value: 1.1 }, uCol: { value: new THREE.Color(streaks ? '#c4d0dc' : '#ffffff') },
      uAlpha: { value: 0 }, uScale: { value: innerHeight * 0.9 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms, transparent: true, depthWrite: false,
      vertexShader: streaks
        ? VERT_COMMON + `
          uniform float uLen; attribute float aEnd;
          void main() {
            vec3 p = wrapPos();
            vec3 vel = normalize(vec3(uWind.x, -uFall, uWind.y));
            p -= vel * uLen * aEnd;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            float d = length(mv.xyz);
            vA = (1.0 - smoothstep(uBox * 0.3, uBox * 0.5, d)) * smoothstep(0.6, 2.0, d) * (0.55 + 0.45 * aEnd);
            gl_Position = projectionMatrix * mv;
          }`
        : VERT_COMMON + `
          uniform float uScale;
          void main() {
            vec3 p = wrapPos();
            p.x += sin(uT * 1.3 + aSeed.w * 40.0) * 0.35; p.z += cos(uT * 1.1 + aSeed.x * 40.0) * 0.35;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            float d = length(mv.xyz);
            vA = (1.0 - smoothstep(uBox * 0.3, uBox * 0.5, d)) * smoothstep(0.4, 1.2, d);
            gl_PointSize = min(0.07 * uScale / -mv.z, 24.0);
            gl_Position = projectionMatrix * mv;
          }`,
      fragmentShader: streaks
        ? `uniform vec3 uCol; uniform float uAlpha; varying float vA; void main() { gl_FragColor = vec4(uCol, vA * uAlpha); }`
        : `uniform vec3 uCol; uniform float uAlpha; varying float vA;
           void main() { vec2 c = gl_PointCoord - 0.5; float r = dot(c, c); if (r > 0.25) discard; gl_FragColor = vec4(uCol, vA * uAlpha * (1.0 - r * 3.0)); }`,
    });
    const obj = streaks ? new THREE.LineSegments(geo, mat) : new THREE.Points(geo, mat);
    obj.frustumCulled = false; obj.renderOrder = 7; obj.visible = false; this.scene.add(obj);
    return { obj, mat, geo, n, streaks };
  }
  /** k = weather 0..1, snow = 0..1 (biome), sheltered = under a roof */
  update(dt, cam, k, snow, sheltered, night) {
    this.t += dt;
    // fade in/out smoothly (shelter fades quicker)
    const want = sheltered ? 0 : k;
    this.k += (want - this.k) * Math.min(1, dt * (sheltered ? 6 : 1.5));
    this.snowK += ((snow ? 1 : 0) - this.snowK) * Math.min(1, dt * 0.8);
    const wind = 1 + k * 2.2;
    for (const [L, w] of [[this.rain, 1 - this.snowK], [this.snow, this.snowK]]) {
      const a = this.k * w; const on = a > 0.02;
      L.obj.visible = on; if (!on) continue;
      const u = L.mat.uniforms; u.uCam.value.copy(cam); u.uT.value = this.t % 1000;
      u.uWind.value.set(1.2 * wind, 0.5 * wind);
      u.uAlpha.value = (L.streaks ? 0.52 : 0.9) * Math.min(1, a * 1.3) * (night ? 0.7 : 1);
      u.uScale.value = innerHeight * 0.9;
      L.geo.setDrawRange(0, Math.ceil(L.n * Math.min(1, 0.25 + a)) * (L.streaks ? 2 : 1));
    }
  }
}
