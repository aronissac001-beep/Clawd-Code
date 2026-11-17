// ============================================================================
// ZONEFALL 4 — renderer: first-person camera, day/night lighting (driven by
// the sky module when present), shadow box around the player, pooled point
// lights, quality levels, and the first-person viewmodel overlay pass.
// ============================================================================
import { THREE, CUT } from './materials.js';
import { clamp, lerp } from '../util.js';
import { InkPass } from './ink.js';

const tmpV = new THREE.Vector3(), tmp2 = new THREE.Vector2();
// reusable colours (setTime runs every frame)
const C = k => new THREE.Color(k);
const COL = { sunDay: C('#fff4e0'), sunDusk: C('#ff9a52'), moon: C('#a8bcf0'), dusk: C('#ffc890'), fogDay: C('#c4dcea'), fogDusk: C('#f0b890'), fogRain: C('#9aa6ae'), fogNight: C('#2a3658') };
const _c1 = new THREE.Color(), _c2 = new THREE.Color();

export const GFX_LEVELS = {
  low: { scale: 0.7, shadows: false, shadowSize: 0, lights: 3, maxDpr: 1.5, far: 260 },
  med: { scale: 0.85, shadows: true, shadowSize: 1024, lights: 4, maxDpr: 2, far: 340 },
  high: { scale: 1, shadows: true, shadowSize: 2048, lights: 6, maxDpr: 2.5, far: 420 },
};

export class Renderer {
  constructor(canvas, level = 'med') {
    this.canvas = canvas;
    this.r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.r.toneMapping = THREE.ACESFilmicToneMapping; this.r.toneMappingExposure = 1.05;
    this.r.shadowMap.type = THREE.PCFShadowMap; // crisper, comic-friendly shadow edges (and cheaper)
    this.ink = null; try { this.ink = new InkPass(this.r); } catch (e) { console.warn('ink pass unavailable', e); }
    this.inkOn = true;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog('#a8b8c0', 60, 200);
    this.scene.background = new THREE.Color('#a8b8c0');
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.06, 420);
    this.camera.rotation.order = 'YXZ';
    this.baseFov = 72; this.fovK = 1;
    this.target = new THREE.Vector3(400, 0, 400);
    this.shake = 0; this.overlay = null; this.sky = null;
    // lights
    this.hemi = new THREE.HemisphereLight('#d8e8ff', '#8a7458', 1.2); this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff0d8', 2.2);
    const S = 30; this.sun.shadow.camera.left = -S; this.sun.shadow.camera.right = S; this.sun.shadow.camera.top = S; this.sun.shadow.camera.bottom = -S;
    this.sun.shadow.camera.near = 1; this.sun.shadow.camera.far = 180; this.sun.shadow.bias = -0.0005; this.sun.shadow.normalBias = 0.05;
    this.scene.add(this.sun, this.sun.target);
    this.pool = [];
    for (let i = 0; i < 6; i++) { const l = new THREE.PointLight('#ffb060', 0, 10, 1.6); l.castShadow = false; this.scene.add(l); this.pool.push(l); }
    this.spot = new THREE.SpotLight('#fff4dc', 0, 34, 0.42, 0.6, 1.2); this.scene.add(this.spot, this.spot.target);
    this.sunDir = new THREE.Vector3(-0.5, 1, 0.35).normalize();
    this.setLevel(level);
    this.resize();
    addEventListener('resize', () => this.resize());
    CUT.uCutR.value = 0; // no see-through cut-outs in first person
  }
  setLevel(level) {
    this.level = GFX_LEVELS[level] ? level : 'med'; const L = GFX_LEVELS[this.level];
    this.r.shadowMap.enabled = L.shadows; this.sun.castShadow = L.shadows;
    if (L.shadows) { this.sun.shadow.mapSize.set(L.shadowSize, L.shadowSize); if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; } }
    this.maxLights = L.lights; this.camera.far = L.far;
    for (let i = 0; i < this.pool.length; i++) this.pool[i].visible = i < L.lights;
    this.resize();
    this.scene.traverse(o => { if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) m.needsUpdate = true; } });
  }
  setFov(f) { this.baseFov = clamp(f, 55, 95); this.applyFov(); }
  applyFov() {
    // keep the horizontal field of view sensible on very wide / narrow screens
    const a = Math.max(1, this.camera.aspect);
    const vfov = this.baseFov * this.fovK * (1.75 / a) ** 0.25 / Math.max(1, a / 2.3) ** 0.15;
    this.camera.fov = clamp(vfov * 0.82, 38, 90); this.camera.updateProjectionMatrix();
  }
  resize() {
    const L = GFX_LEVELS[this.level];
    const dpr = Math.min(window.devicePixelRatio || 1, L.maxDpr) * L.scale;
    const w = innerWidth, h = innerHeight;
    this.r.setPixelRatio(dpr); this.r.setSize(w, h, false);
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
    this.camera.aspect = w / h; this.applyFov();
    if (this.ink) { this.r.getDrawingBufferSize(tmp2); this.ink.setSize(tmp2.x, tmp2.y); }
  }
  /** first-person camera at (x,y,z) looking along yaw (game angle: dir = cos/sin in XZ) and pitch (up +) */
  setFP(x, y, z, yaw, pitch, roll = 0, dt = 0.016) {
    let sx = 0, sy = 0;
    if (this.shake > 0) { sx = (Math.random() - 0.5) * this.shake * 0.05; sy = (Math.random() - 0.5) * this.shake * 0.05; this.shake = Math.max(0, this.shake - dt * 3.5); }
    this.camera.position.set(x, y, z);
    this.camera.rotation.set(clamp(pitch + sy, -1.5, 1.5), -yaw - Math.PI / 2 + sx, roll);
    this.target.set(x, y, z);
    this.updateShadowBox(yaw);
  }
  updateShadowBox(yaw = 0) {
    const sd = this.sunDir;
    // centre the shadow box a little ahead of the player so the visible area gets the shadow detail
    const cx = this.target.x + Math.cos(yaw) * 12, cz = this.target.z + Math.sin(yaw) * 12, cy = this.target.y;
    let tx = cx, tz = cz;
    if (this.sun.castShadow) { const texel = (this.sun.shadow.camera.right * 2) / this.sun.shadow.mapSize.x; tx = Math.round(cx / texel) * texel; tz = Math.round(cz / texel) * texel; }
    this.sun.target.position.set(tx, cy, tz);
    this.sun.position.set(tx + sd.x * 80, cy + sd.y * 80, tz + sd.z * 80);
  }
  /**
   * t: 0..1 through the full day (0 = midnight, 0.25 dawn, 0.5 noon, 0.75 dusk).
   */
  setTime(t, weather = 0) {
    const ang = (t - 0.25) * Math.PI * 2;
    const elev = Math.sin(ang);
    const day = clamp(elev * 3 + 0.25, 0, 1);
    const dusk = clamp(1 - Math.abs(elev) * 4, 0, 1) * (elev > -0.35 ? 1 : 0);
    const night = 1 - day; const w = weather;
    if (this.sky) {
      this.sky.update(t, this.camera, w);
      this.sunDir.copy(this.sky.sunDir); if (this.sunDir.y < 0.12) { this.sunDir.y = 0.12; this.sunDir.normalize(); }
    } else {
      const az = (t - 0.25) * Math.PI * 2;
      if (elev > -0.05) this.sunDir.set(-Math.cos(az) * 0.8, Math.max(0.3, elev) + 0.15, 0.45).normalize();
      else this.sunDir.set(Math.cos(az) * 0.6, 0.85, 0.35).normalize();
    }
    // bright, saturated comic lighting: strong sun, generous sky fill, readable nights
    if (day > 0.02) this.sun.color.copy(COL.sunDay).lerp(COL.sunDusk, dusk * 0.85); else this.sun.color.copy(COL.moon);
    this.sun.intensity = day > 0.02 ? lerp(0.9, 2.7, day) * (1 - w * 0.45) : 0.75;
    this.hemi.intensity = lerp(1.15, 1.65, day) * (1 - w * 0.2);
    this.hemi.color.set(day > 0.02 ? '#dcecff' : '#8ea4e6').lerp(COL.dusk, dusk * 0.35);
    this.hemi.groundColor.set(day > 0.02 ? '#8a7458' : '#3a3c58');
    let fc;
    if (this.sky && this.sky.horizon) fc = this.sky.horizon;
    else { _c1.copy(COL.fogDay).lerp(COL.fogDusk, dusk * 0.6).lerp(COL.fogRain, w * 0.6); fc = _c2.copy(COL.fogNight).lerp(_c1, day); }
    this.scene.fog.color.copy(fc); this.scene.background.copy(fc);
    const far = GFX_LEVELS[this.level].far;
    this.scene.fog.near = lerp(28, 85, day) * (1 - w * 0.45); this.scene.fog.far = Math.min(far - 10, lerp(130, 250, day) * (1 - w * 0.35));
    // nothing past the fog is visible: pull the far plane in (fewer draw calls at night / in storms)
    const wantFar = Math.min(far, this.scene.fog.far + 40);
    if (Math.abs(wantFar - this.camera.far) > 4) { this.camera.far = wantFar; this.camera.updateProjectionMatrix(); }
    this.r.toneMappingExposure = lerp(1.75, 1.2, day);
    this.night = night; this.dusk = dusk; this.day = day;
    return { night, dusk, day };
  }
  /** assign pooled point lights to the nearest active light sources */
  assignLights(sources) {
    const n = this.maxLights; const tx = this.target.x, tz = this.target.z;
    sources.sort((a, b) => ((a.x - tx) ** 2 + (a.z - tz) ** 2) - ((b.x - tx) ** 2 + (b.z - tz) ** 2));
    for (let i = 0; i < this.pool.length; i++) {
      const l = this.pool[i], s = i < n ? sources[i] : null;
      if (s && (s.x - tx) ** 2 + (s.z - tz) ** 2 < 80 * 80) { l.position.set(s.x, s.y, s.z); l.color.set(s.color || '#ffb060'); l.intensity = s.intensity; l.distance = s.range; }
      else l.intensity = 0;
    }
  }
  render() {
    CUT.uPlayer.value.set(0, -999, 0);
    if (this.ink && this.inkOn) {
      // world -> offscreen -> ink pass to screen; the viewmodel (which clears depth)
      // is drawn on top afterwards so it cannot wipe the depth the ink pass reads
      this.ink.render(this.camera, () => this.r.render(this.scene, this.camera));
      if (this.overlay) { this.r.autoClear = false; this.overlay.render(this.r, this.camera.aspect); this.r.autoClear = true; }
      return;
    }
    this.r.autoClear = true;
    this.r.render(this.scene, this.camera);
    if (this.overlay) { this.r.autoClear = false; this.overlay.render(this.r, this.camera.aspect); this.r.autoClear = true; }
  }
  /** world -> screen px */
  project(x, y, z, out = {}) {
    tmpV.set(x, y, z).project(this.camera);
    out.x = (tmpV.x * 0.5 + 0.5) * innerWidth; out.y = (-tmpV.y * 0.5 + 0.5) * innerHeight; out.vis = tmpV.z < 1 && tmpV.z > -1; return out;
  }
  /** camera forward vector */
  forward(out = new THREE.Vector3()) { return this.camera.getWorldDirection(out); }
}
