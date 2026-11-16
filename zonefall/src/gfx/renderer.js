// ============================================================================
// ZONEFALL 3 — renderer: Three.js scene, follow camera, day/night lighting,
// shadow box that follows the player, pooled point lights, quality levels.
// ============================================================================
import { THREE, M, CUT } from './materials.js';
import { clamp, lerp } from '../util.js';

const tmpV = new THREE.Vector3();

export const GFX_LEVELS = {
  low: { scale: 0.75, shadows: false, shadowSize: 0, lights: 3, maxDpr: 1.5 },
  med: { scale: 0.85, shadows: true, shadowSize: 1024, lights: 4, maxDpr: 2 },
  high: { scale: 1, shadows: true, shadowSize: 2048, lights: 6, maxDpr: 2.5 },
};

export class Renderer {
  constructor(canvas, level = 'med') {
    this.canvas = canvas;
    this.r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.r.toneMapping = THREE.ACESFilmicToneMapping; this.r.toneMappingExposure = 1.05;
    this.r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog('#a8b8c0', 60, 170);
    this.scene.background = new THREE.Color('#a8b8c0');
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.5, 400);
    this.camDist = 25; this.camPitch = 58 * Math.PI / 180; this.zoom = 1;
    this.target = new THREE.Vector3(400, 0, 400); this.camPos = new THREE.Vector3();
    this.shake = 0;
    // lights
    this.hemi = new THREE.HemisphereLight('#cfe0ff', '#5a4a3a', 0.9); this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff0d8', 2.2);
    this.sun.shadow.camera.left = -34; this.sun.shadow.camera.right = 34; this.sun.shadow.camera.top = 34; this.sun.shadow.camera.bottom = -34;
    this.sun.shadow.camera.near = 1; this.sun.shadow.camera.far = 160; this.sun.shadow.bias = -0.0006; this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);
    this.pool = []; // point light pool
    for (let i = 0; i < 6; i++) { const l = new THREE.PointLight('#ffb060', 0, 10, 1.6); l.castShadow = false; this.scene.add(l); this.pool.push(l); }
    this.spot = new THREE.SpotLight('#fff4dc', 0, 26, 0.5, 0.55, 1.2); this.scene.add(this.spot, this.spot.target);
    this.setLevel(level);
    this.resize();
    addEventListener('resize', () => this.resize());
  }
  setLevel(level) {
    this.level = GFX_LEVELS[level] ? level : 'med'; const L = GFX_LEVELS[this.level];
    this.r.shadowMap.enabled = L.shadows; this.sun.castShadow = L.shadows;
    if (L.shadows) { this.sun.shadow.mapSize.set(L.shadowSize, L.shadowSize); if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; } }
    this.maxLights = L.lights;
    for (let i = 0; i < this.pool.length; i++) this.pool[i].visible = i < L.lights;
    this.resize();
    // materials must recompile when shadow settings change
    this.scene.traverse(o => { if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) m.needsUpdate = true; } });
  }
  resize() {
    const L = GFX_LEVELS[this.level];
    const dpr = Math.min(window.devicePixelRatio || 1, L.maxDpr) * L.scale;
    const w = innerWidth, h = innerHeight;
    this.r.setPixelRatio(dpr); this.r.setSize(w, h, false);
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
    this.camera.aspect = w / h;
    // keep roughly the same ground width visible on narrow / wide screens
    this.camera.fov = clamp(36 * (1.9 / Math.max(1.2, this.camera.aspect)) ** 0.35, 30, 48);
    this.camera.updateProjectionMatrix();
  }
  /** follow target (x,y,z) with optional look-ahead (lx,lz) */
  follow(x, y, z, lx = 0, lz = 0, dt = 0.016, snap = false) {
    const k = snap ? 1 : 1 - Math.exp(-dt * 6);
    this.target.x = lerp(this.target.x, x + lx, k); this.target.z = lerp(this.target.z, z + lz, k); this.target.y = lerp(this.target.y, y, snap ? 1 : 1 - Math.exp(-dt * 4));
    const d = this.camDist * this.zoom;
    this.camPos.set(this.target.x, this.target.y + Math.sin(this.camPitch) * d, this.target.z + Math.cos(this.camPitch) * d);
    if (this.shake > 0) { const s = this.shake * 0.35; this.camPos.x += (Math.random() - 0.5) * s; this.camPos.y += (Math.random() - 0.5) * s; this.camPos.z += (Math.random() - 0.5) * s; this.shake = Math.max(0, this.shake - dt * 3); }
    this.camera.position.copy(this.camPos); this.camera.lookAt(this.target);
    // shadow box follows the target, sun direction set by setTime()
    const sd = this.sunDir || tmpV.set(-0.5, 1, 0.35).normalize();
    this.sun.target.position.copy(this.target);
    this.sun.position.set(this.target.x + sd.x * 70, this.target.y + sd.y * 70, this.target.z + sd.z * 70);
    // snap shadow camera to texel grid to avoid shimmering
    if (this.sun.castShadow) {
      const texel = 68 / this.sun.shadow.mapSize.x;
      this.sun.target.position.x = Math.round(this.sun.target.position.x / texel) * texel; this.sun.target.position.z = Math.round(this.sun.target.position.z / texel) * texel;
      this.sun.position.x = this.sun.target.position.x + sd.x * 70; this.sun.position.z = this.sun.target.position.z + sd.z * 70;
    }
  }
  /**
   * t: 0..1 through the full day (0 = midnight, 0.25 dawn, 0.5 noon, 0.75 dusk).
   * Returns { night: 0..1 }.
   */
  setTime(t, weather = 0) {
    const ang = (t - 0.25) * Math.PI * 2; // 0 at dawn, PI/2 noon
    const elev = Math.sin(ang); // -1..1
    const day = clamp(elev * 3 + 0.25, 0, 1); // ~0 at night
    const dusk = clamp(1 - Math.abs(elev) * 4, 0, 1) * (elev > -0.35 ? 1 : 0);
    const night = 1 - day;
    // sun or moon direction
    const az = (t - 0.25) * Math.PI * 2;
    if (elev > -0.05) this.sunDir = tmpV.set(-Math.cos(az) * 0.8, Math.max(0.3, elev) + 0.15, 0.45).normalize().clone();
    else this.sunDir = tmpV.set(Math.cos(az) * 0.6, 0.85, 0.35).normalize().clone();
    const sunCol = new THREE.Color('#fff2dc').lerp(new THREE.Color('#ff9a52'), dusk * 0.85);
    const moonCol = new THREE.Color('#9fb4e8');
    const w = weather; // 0 clear .. 1 storm
    this.sun.color.copy(day > 0.02 ? sunCol : moonCol);
    this.sun.intensity = day > 0.02 ? lerp(0.6, 2.4, day) * (1 - w * 0.55) : 0.55;
    this.hemi.intensity = lerp(0.62, 1.0, day) * (1 - w * 0.3);
    this.hemi.color.set(day > 0.02 ? '#d2e2ff' : '#7a8cc8').lerp(new THREE.Color('#ffc890'), dusk * 0.35);
    this.hemi.groundColor.set(day > 0.02 ? '#5f503e' : '#2a2a3c');
    const fogDay = new THREE.Color('#b9c8cc').lerp(new THREE.Color('#e8b48a'), dusk * 0.6).lerp(new THREE.Color('#8a9298'), w * 0.6);
    const fogNight = new THREE.Color('#121a2c');
    const fc = fogNight.clone().lerp(fogDay, day);
    this.scene.fog.color.copy(fc); this.scene.background.copy(fc);
    this.scene.fog.near = lerp(32, 70, day) * (1 - w * 0.4); this.scene.fog.far = lerp(110, 190, day) * (1 - w * 0.35);
    this.r.toneMappingExposure = lerp(1.45, 1.05, day);
    this.night = night; this.dusk = dusk;
    return { night, dusk, day };
  }
  /** assign pooled point lights to the nearest active light sources */
  assignLights(sources) {
    const n = this.maxLights; const tx = this.target.x, tz = this.target.z;
    sources.sort((a, b) => ((a.x - tx) ** 2 + (a.z - tz) ** 2) - ((b.x - tx) ** 2 + (b.z - tz) ** 2));
    for (let i = 0; i < this.pool.length; i++) {
      const l = this.pool[i], s = i < n ? sources[i] : null;
      if (s && (s.x - tx) ** 2 + (s.z - tz) ** 2 < 70 * 70) { l.position.set(s.x, s.y, s.z); l.color.set(s.color || '#ffb060'); l.intensity = s.intensity; l.distance = s.range; }
      else l.intensity = 0;
    }
  }
  render(player) {
    if (player) { CUT.uPlayer.value.set(player.x, player.y + 1.0, player.z); CUT.uCam.value.copy(this.camera.position); }
    else CUT.uPlayer.value.set(0, -999, 0);
    this.r.render(this.scene, this.camera);
  }
  /** world -> screen px */
  project(x, y, z, out = {}) {
    tmpV.set(x, y, z).project(this.camera);
    out.x = (tmpV.x * 0.5 + 0.5) * innerWidth; out.y = (-tmpV.y * 0.5 + 0.5) * innerHeight; out.vis = tmpV.z < 1 && tmpV.z > -1; return out;
  }
  /** screen px -> ground point (intersect plane y = gy) */
  unproject(sx, sy, gy = 0, out = {}) {
    const ndc = new THREE.Vector3(sx / innerWidth * 2 - 1, -(sy / innerHeight) * 2 + 1, 0.5).unproject(this.camera);
    const dir = ndc.sub(this.camera.position).normalize();
    const t = (gy - this.camera.position.y) / dir.y;
    out.x = this.camera.position.x + dir.x * t; out.z = this.camera.position.z + dir.z * t; return out;
  }
}
