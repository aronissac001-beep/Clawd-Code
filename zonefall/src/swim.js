// ============================================================================
// ZONEFALL — swimming. Walk out past your depth and you swim: head and
// shoulders above the surface, stick to move (sprint for a faster crawl),
// swim where you look, jump to come up, crouch to dive. Under water you hold
// your breath (the bar shows how long you have left), the view turns blue and
// sound goes muffled; run out of air and you start to drown. You can't use
// weapons while you swim, and nothing on land can follow you out.
// Falling into deep water from a cliff, a zipline or a bridge doesn't hurt.
// ============================================================================
import { G } from './state.js';
import { Sfx } from './audio.js';
import { WATER_Y } from './world/gen.js';
import { Build } from './build.js';
import { moveActor } from './actors.js';
import { hurt } from './combat.js';
import { clamp } from './util.js';
import { THREE } from './gfx/materials.js';

const FLOAT = 1.34;            // feet below the surface while swimming: eyes ~0.3 m above the water
const DEEP = 1.35, SHALLOW = 1.15; // start swimming deeper than this, stand up shallower than this
const AIR = 22;                // seconds of breath under water

// the water seen from below: a bright, rippling ceiling that follows you (the sea mesh is one-sided)
let roof = null;
function makeRoof() {
  if (roof || typeof document === 'undefined' || !G.scene) return roof;
  const n = 128, cv = document.createElement('canvas'); cv.width = cv.height = n; const g = cv.getContext('2d');
  // soft caustic net: wobbly bright lines over a mid tone (tinted teal by the material), tiles seamlessly
  g.fillStyle = '#8c8c8c'; g.fillRect(0, 0, n, n);
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 1.9;
  let r = 7; const R = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 26; k++) { const x = R() * n, y = R() * n, w = 18 + R() * 30, a = R() * 6.28;
    for (const ox of [-n, 0, n]) for (const oy of [-n, 0, n]) { g.beginPath(); g.moveTo(x + ox, y + oy); g.quadraticCurveTo(x + ox + Math.cos(a) * w * 0.5 - Math.sin(a) * 8, y + oy + Math.sin(a) * w * 0.5 + Math.cos(a) * 8, x + ox + Math.cos(a) * w, y + oy + Math.sin(a) * w); g.stroke(); } }
  const tex = new THREE.CanvasTexture(cv); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(52, 52); tex.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.PlaneGeometry(240, 240); geo.rotateX(Math.PI / 2); // faces down
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: '#9fe2ee', transparent: true, opacity: 0.92, depthWrite: false, fog: true });
  const mesh = new THREE.Mesh(geo, mat); mesh.name = 'waterRoof'; mesh.renderOrder = -1; mesh.visible = false; mesh.frustumCulled = false;
  G.scene.add(mesh);
  roof = { mesh, tex, mat };
  return roof;
}

let ui = null;
function makeUi() {
  if (ui || typeof document === 'undefined') return ui;
  const st = document.createElement('style');
  st.textContent = `#uwtint{position:fixed;inset:0;pointer-events:none;z-index:6;background:radial-gradient(ellipse at 50% 40%,rgba(40,120,150,.16),rgba(8,40,62,.62));opacity:0;transition:opacity .25s}
#breath{position:fixed;left:50%;bottom:calc(92px + var(--sab,0px));transform:translateX(-50%);z-index:30;width:min(220px,40vw);height:10px;border:2px solid #120c10;border-radius:6px;background:rgba(10,20,30,.6);display:none;overflow:hidden;box-shadow:2px 2px 0 #120c10}
#breath i{display:block;height:100%;width:100%;background:linear-gradient(90deg,#7fe0ff,#36d2ff);transition:width .15s linear}
#breath.low i{background:linear-gradient(90deg,#ff6a4a,#ffb04a)}
#breath b{position:absolute;left:0;right:0;top:-18px;text-align:center;font:800 11px system-ui;color:#dff6ff;text-shadow:0 1px 0 #000}`;
  document.head.appendChild(st);
  const tint = document.createElement('div'); tint.id = 'uwtint'; document.body.appendChild(tint);
  const bar = document.createElement('div'); bar.id = 'breath'; bar.innerHTML = '<b>AIR</b><i></i>'; document.body.appendChild(bar);
  ui = { tint, bar, fill: bar.querySelector('i') };
  return ui;
}

export const Swim = {
  /** you can walk / swim anywhere inside the map edge (deep water stops NPCs, not you) */
  edgeOk(x, z) { const s = G.W.size; return x > 2 && z > 2 && x < s - 2 && z < s - 2; },
  /** water depth under you (y-aware: a pier above a swimmer doesn't count) */
  depthAt(x, z, y) { return WATER_Y - Build.floorY(x, z, y); },
  /** is the eye under the surface? */
  under(p) { return !!p.swim && p.y + (p.eye || 1.62) < WATER_Y - 0.04; },
  /** per frame from updatePlayer, before stance + movement. Returns true while swimming (this moved the player). */
  tick(p, dt, Input, blocked) {
    const d = this.depthAt(p.x, p.z, p.swim ? p.y : p.y + Math.max(0, p.airY || 0));
    if (!p.swim) {
      if (p.airY > 0 && d > DEEP && p.y + p.airY < WATER_Y + 0.15) this.enter(p, true);   // fell in
      else if (p.airY <= 0 && d > DEEP && !p.vehicle) this.enter(p, false);             // waded out of your depth
      else { this.breathe(p, dt, false); return false; }
    } else if (d < SHALLOW) { this.leave(p); this.breathe(p, dt, false); return false; }
    const S = p.swim;
    const mv = blocked ? { x: 0, y: 0, mag: 0, sprint: false } : Input.moveVec();
    // up / down: jump rises, crouch dives; moving forward you swim where you look
    const up = !blocked && Input.held.jump ? 1 : 0, down = !blocked && Input.held.crouch ? 1 : 0;
    let vy = (up - down) * 1.9;
    if (!up && !down && mv.y > 0.3) vy += Math.sin(p.pitch) * 1.7 * mv.y; else if (!up && !down && S.dive > 0) vy += 0.35; // you drift back up
    const maxDive = Math.max(0, d - FLOAT - 0.35);
    S.dive = clamp(S.dive - vy * dt, 0, maxDive);
    // across the water (deep water is open to you, the map edge isn't)
    const spd = (mv.sprint && mv.y > 0.5 ? 3.5 : 2.5) * (S.dive > 0.4 ? 0.85 : 1);
    if (mv.mag > 0.04) {
      const fx = Math.cos(p.yaw), fz = Math.sin(p.yaw), rx = -Math.sin(p.yaw), rz = Math.cos(p.yaw);
      const k = Math.min(1, mv.mag * 1.12) / Math.max(mv.mag, 1e-3), size = G.W.size;
      G.phys.swimOk = this.edgeOk; void size;
      try { moveActor(p, (fx * mv.y + rx * mv.x) * k * spd * dt, (fz * mv.y + rz * mv.x) * k * spd * dt, dt); } finally { G.phys.swimOk = null; }
    } else p.speedNow = 0;
    p.y = WATER_Y - FLOAT - S.dive; p.airY = 0; p.vy = 0; p.eye = 1.62; p.crouch = false; p.sprinting = false; p.ang = p.yaw;
    p.ads = 0; p.aiming = false; p.st.aim = false; p.fireCd -= dt; p.swingCd -= dt; p.trigWas = false;
    // strokes and bubbles
    const under = this.under(p);
    S.strokeT -= dt * (p.speedNow > 0.3 ? (spd > 3 ? 1.5 : 1) : 0.35);
    if (S.strokeT <= 0) { S.strokeT = 0.85; if (under) { Sfx.noise(0.3, 600, 1.4, 0.05, 'lowpass', 0, 0.6); Sfx.tone(300 + Math.random() * 300, 0.08, 0.02, 'sine', 0.05, 1.8); } else Sfx.noise(0.32, 1300, 0.8, p.speedNow > 0.3 ? 0.07 : 0.03, 'lowpass', 0, 0.45); }
    if (G.onNoise && p.speedNow > 0.3 && !under && (S.noiseT = (S.noiseT || 0) - dt) <= 0) { S.noiseT = 1; G.onNoise(p.x, p.z, 6, p); }
    this.breathe(p, dt, under);
    return true;
  },
  enter(p, fell) {
    p.swim = { dive: fell ? Math.min(1.2, Math.max(0, this.depthAt(p.x, p.z, WATER_Y - 1) - FLOAT - 0.35)) : 0, strokeT: 0.3 };
    p.airY = 0; p.vy = 0; p.zipSoft = false;
    Sfx.splash(); if (fell) { Sfx.noise(0.5, 900, 0.7, 0.25, 'lowpass', 0, 0.4); }
    if (G.vm) G.vm.hidden = true;
    if (!this.told && G.ui) { this.told = true; G.ui.toast('Swimming · jump to rise, crouch to dive · watch your air', 'good'); }
  },
  leave(p) { p.swim = null; p.y = Build.floorY(p.x, p.z, p.y + 1.4); Sfx.splash(); },
  breathe(p, dt, under) {
    if (p.o2 === undefined) p.o2 = AIR;
    if (under) {
      p.o2 = Math.max(0, p.o2 - dt);
      if (p.o2 <= 0) { p.drownT = (p.drownT || 0) - dt; if (p.drownT <= 0) { p.drownT = 1; hurt(p, 8, { kind: 'drown' }); Sfx.noise(0.4, 500, 1, 0.12, 'lowpass', 0, 0.5); } }
      else if ((p.bubT = (p.bubT || 0) - dt) <= 0) { p.bubT = 1.6 + Math.random() * 1.5; Sfx.tone(500 + Math.random() * 500, 0.05, 0.015, 'sine', 0, 1.9); }
    } else { p.o2 = Math.min(AIR, p.o2 + dt * 4); p.drownT = 0; }
    if (Sfx.setMuffle) Sfx.setMuffle(under);
    if (G.rend) G.rend.underwater = under ? 1 : 0;
    const Rf = under ? makeRoof() : roof;
    if (Rf) {
      if (Rf.mesh.parent !== G.scene && G.scene) G.scene.add(Rf.mesh); // a new run builds a new scene
      Rf.mesh.visible = under;
      if (under) { Rf.mesh.position.set(p.x, WATER_Y - 0.06, p.z); Rf.tex.offset.set((G.t || 0) * 0.012 + p.x / 6, (G.t || 0) * 0.008 + p.z / 6); const L = G.rend && G.rend.day !== undefined ? 0.35 + 0.65 * G.rend.day : 1; Rf.mat.color.setRGB(0.5 * L, 0.95 * L, 1.0 * L); }
    }
    const U = makeUi(); if (!U) return;
    U.tint.style.opacity = under ? '1' : '0';
    const show = !!p.swim && p.o2 < AIR - 0.05;
    U.bar.style.display = show ? 'block' : 'none';
    if (show) { U.fill.style.width = Math.round(p.o2 / AIR * 100) + '%'; U.bar.classList.toggle('low', p.o2 < 6); }
  },
  /** clear the overlay (death, menus) */
  reset(p) { if (p) { p.swim = null; p.o2 = AIR; } if (Sfx.setMuffle) Sfx.setMuffle(false); if (G.rend) G.rend.underwater = 0; if (roof) roof.mesh.visible = false; if (ui) { ui.tint.style.opacity = '0'; ui.bar.style.display = 'none'; } },
};
