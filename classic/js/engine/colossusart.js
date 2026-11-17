// Procedural art for the Bone Colossus: a hulking skeleton of grey bone in the
// same three-quarter side view as the units, about three tiles tall. Drawn live
// each frame (one boss, a few dozen paths): stomping stride, swats, the
// two-fisted slam wind-up, fists buried after the slam with the rib cage
// glowing ember-red while the weak spot is exposed. Also: slam telegraph
// circles, the bone mound it sleeps in by day, and the Bone Husk unit sprite.
import { glowSprite, UNIT_ART, ART } from './sprites.js';
import { COL } from '../game/systems/colossus.js';

const T = 32;
const INK = ART.INK;
const PAL = { bone: '#cfc6b2', boneHi: '#ebe4d2', boneLo: '#968d7a', boneDk: '#6b6455', socket: '#1c1822', void: '#221d28' };
const FLASH = { bone: '#fff6e0', boneHi: '#fffaf0', boneLo: '#f4e8cc', boneDk: '#e8d8b8', socket: '#fff0d8', void: '#f8e8d0' };

const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);

function bone(g, x1, y1, x2, y2, w, P) {
  // A long bone: thick shaft with knobbed ends.
  g.lineCap = 'round';
  g.strokeStyle = INK; g.lineWidth = w + 3;
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  g.strokeStyle = P.bone; g.lineWidth = w;
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  g.strokeStyle = P.boneHi; g.lineWidth = Math.max(1.5, w * 0.3);
  g.beginPath(); g.moveTo(lerp(x1, x2, 0.15) - 1, lerp(y1, y2, 0.15) - 1); g.lineTo(lerp(x1, x2, 0.8) - 1, lerp(y1, y2, 0.8) - 1); g.stroke();
  for (const [x, y] of [[x1, y1], [x2, y2]]) knob(g, x, y, w * 0.62, P);
}
function knob(g, x, y, r, P) {
  g.fillStyle = P.bone; g.strokeStyle = INK; g.lineWidth = 1.5;
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.stroke();
}
function fist(g, x, y, r, P) {
  g.fillStyle = P.boneLo; g.strokeStyle = INK; g.lineWidth = 2;
  g.beginPath(); g.ellipse(x, y, r * 1.1, r, 0, 0, Math.PI * 2); g.fill(); g.stroke();
  // Knuckles.
  g.fillStyle = P.bone;
  for (let i = -1; i <= 1; i++) { g.beginPath(); g.arc(x + i * r * 0.55, y - r * 0.45, r * 0.38, 0, Math.PI * 2); g.fill(); g.stroke(); }
}

/** Draw the Colossus with its feet at (x, y). */
export function drawBoss(g, e, x, y, time, scale) {
  const P = e.hitT > 0.06 ? FLASH : PAL;
  const pose = e.pose || 'walk';
  const pt = e.poseT || 0;
  const rise = e.rise > 0 ? Math.min(1, e.rise / COL.rise) : 0;
  const moving = Math.abs(e.x - e.px) + Math.abs(e.y - e.py) > 0.02;
  const cyc = (e.anim || 0) * 6.5;
  const stride = pose === 'walk' && moving ? 1 : 0;
  const weak = !!e.weak;

  // Ground shadow.
  g.fillStyle = 'rgba(16,12,20,0.32)';
  g.beginPath(); g.ellipse(x, y + 2, 46, 14, 0, 0, Math.PI * 2); g.fill();

  g.save();
  g.translate(x, y);
  if ((e.face || 1) < 0) g.scale(-1, 1);
  g.lineJoin = 'round';
  // Rising from the bone mound: everything starts low and squashed.
  if (rise > 0) { g.translate(0, rise * 34); g.scale(1 + rise * 0.25, 1 - rise * 0.55); g.globalAlpha = 1 - rise * 0.35; }

  // Body offsets by pose.
  const stomp = stride ? Math.abs(Math.sin(cyc)) : 0;
  let bodyDy = -stomp * 3;
  let lean = 0;
  if (pose === 'windup') { bodyDy -= ease(pt) * 6; lean = -ease(pt) * 0.08; }
  else if (pose === 'exposed') { bodyDy += 10; lean = 0.22; }

  // Legs: hips, knees, feet; the lifted foot alternates with the stride.
  const liftL = stride ? Math.max(0, Math.sin(cyc)) * 11 : 0, liftR = stride ? Math.max(0, -Math.sin(cyc)) * 11 : 0;
  const swing = stride ? Math.cos(cyc) * 7 : 0;
  const hipY = -44 + bodyDy * 0.6;
  for (const [side, lift, sw] of [[-1, liftL, swing], [1, liftR, -swing]]) {
    const hx = side * 13, fx = side * 18 + sw, fy = -lift, kx = side * 19 + sw * 0.5, ky = -24 - lift * 0.6;
    bone(g, hx, hipY, kx, ky, 9, P);
    bone(g, kx, ky, fx, fy - 4, 8, P);
    // Foot.
    g.fillStyle = P.boneLo; g.strokeStyle = INK; g.lineWidth = 2;
    g.beginPath(); g.ellipse(fx + 5, fy - 2, 11, 5, 0, 0, Math.PI * 2); g.fill(); g.stroke();
  }

  g.save();
  g.translate(0, hipY);
  g.rotate(lean);
  // Pelvis basin.
  g.fillStyle = P.bone; g.strokeStyle = INK; g.lineWidth = 2;
  g.beginPath(); g.moveTo(-20, -4); g.quadraticCurveTo(0, -14, 20, -4); g.lineTo(14, 8); g.quadraticCurveTo(0, 2, -14, 8); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = P.socket; g.beginPath(); g.ellipse(-8, 0, 3.5, 3, 0, 0, Math.PI * 2); g.ellipse(8, 0, 3.5, 3, 0, 0, Math.PI * 2); g.fill();
  // Spine.
  for (let i = 0; i < 4; i++) { const vy = -8 - i * 6; g.fillStyle = P.boneLo; g.strokeStyle = INK; g.lineWidth = 1.5; g.beginPath(); g.ellipse(0, vy, 5, 3, 0, 0, Math.PI * 2); g.fill(); g.stroke(); }

  // Rib cage: dark void, then (if exposed) the ember core, then the ribs over it.
  const cy = -46, rw = 25, rh = 22;
  g.fillStyle = P.void;
  g.beginPath(); g.ellipse(0, cy, rw - 3, rh - 2, 0, 0, Math.PI * 2); g.fill();
  if (weak) {
    const pulse = 0.65 + 0.35 * Math.sin(time * 10);
    g.globalCompositeOperation = 'lighter';
    const gl = glowSprite('rgba(255,110,40,0.95)');
    g.drawImage(gl.c, -rw * 1.9, cy - rh * 1.9, rw * 3.8, rh * 3.8);
    g.globalCompositeOperation = 'source-over';
    const gr = g.createRadialGradient(0, cy, 2, 0, cy, rw);
    gr.addColorStop(0, `rgba(255,240,170,${pulse})`); gr.addColorStop(0.45, 'rgba(255,120,40,0.95)'); gr.addColorStop(1, 'rgba(150,30,20,0.6)');
    g.fillStyle = gr;
    g.beginPath(); g.ellipse(0, cy, rw - 4, rh - 3, 0, 0, Math.PI * 2); g.fill();
    // Heart-ember.
    g.fillStyle = `rgba(255,250,220,${0.7 + 0.3 * pulse})`;
    g.beginPath(); g.arc(2, cy + 2, 5 + pulse * 2, 0, Math.PI * 2); g.fill();
  }
  // Sternum and ribs.
  g.strokeStyle = INK; g.lineWidth = 6.5; g.lineCap = 'round';
  const ribs = [];
  for (let i = 0; i < 5; i++) {
    const ry = cy - rh + 7 + i * 8.5, rr = rw * (0.78 + 0.22 * Math.sin((i + 0.6) / 5.5 * Math.PI));
    ribs.push([ry, rr]);
    g.beginPath(); g.moveTo(0, ry - 2); g.quadraticCurveTo(-rr * 1.15, ry - 4, -rr * 0.85, ry + 7); g.moveTo(0, ry - 2); g.quadraticCurveTo(rr * 1.15, ry - 4, rr * 0.85, ry + 7); g.stroke();
  }
  g.strokeStyle = weak ? '#ffe0b0' : P.bone; g.lineWidth = 4;
  for (const [ry, rr] of ribs) { g.beginPath(); g.moveTo(0, ry - 2); g.quadraticCurveTo(-rr * 1.15, ry - 4, -rr * 0.85, ry + 7); g.moveTo(0, ry - 2); g.quadraticCurveTo(rr * 1.15, ry - 4, rr * 0.85, ry + 7); g.stroke(); }
  g.fillStyle = P.boneHi; g.strokeStyle = INK; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(-3, cy - rh + 2); g.lineTo(3, cy - rh + 2); g.lineTo(2.5, cy + rh - 6); g.lineTo(-2.5, cy + rh - 6); g.closePath(); g.fill(); g.stroke();

  // Shoulder yoke with spiked blades.
  const sy = cy - rh - 4;
  g.fillStyle = P.bone; g.strokeStyle = INK; g.lineWidth = 2;
  g.beginPath(); g.moveTo(-34, sy + 6); g.quadraticCurveTo(0, sy - 10, 34, sy + 6); g.lineTo(28, sy + 12); g.quadraticCurveTo(0, sy + 2, -28, sy + 12); g.closePath(); g.fill(); g.stroke();
  for (const sx of [-1, 1]) ART.poly(g, [sx * 22, sy, sx * 30, sy - 16, sx * 33, sy + 2], P.boneLo, INK, 1.5);

  // Skull: heavy brow, curling horns, glowing sockets.
  const hx = 6, hy = sy - 13 + (pose === 'exposed' ? 6 : 0);
  for (const sx of [-1, 1]) {
    g.strokeStyle = INK; g.lineWidth = 7.5;
    g.beginPath(); g.moveTo(hx + sx * 9, hy - 6); g.quadraticCurveTo(hx + sx * 24, hy - 14, hx + sx * 20, hy - 26); g.stroke();
    g.strokeStyle = P.boneLo; g.lineWidth = 5;
    g.beginPath(); g.moveTo(hx + sx * 9, hy - 6); g.quadraticCurveTo(hx + sx * 24, hy - 14, hx + sx * 20, hy - 26); g.stroke();
  }
  g.fillStyle = P.bone; g.strokeStyle = INK; g.lineWidth = 2;
  g.beginPath(); g.moveTo(hx - 12, hy - 4); g.quadraticCurveTo(hx - 12, hy - 18, hx, hy - 18); g.quadraticCurveTo(hx + 13, hy - 18, hx + 13, hy - 4); g.lineTo(hx + 9, hy + 8); g.lineTo(hx - 8, hy + 8); g.closePath(); g.fill(); g.stroke();
  // Jaw and teeth.
  g.fillStyle = P.boneLo; g.beginPath(); g.moveTo(hx - 8, hy + 6); g.lineTo(hx + 10, hy + 6); g.lineTo(hx + 7, hy + 13); g.lineTo(hx - 5, hy + 13); g.closePath(); g.fill(); g.stroke();
  g.strokeStyle = INK; g.lineWidth = 1;
  for (let i = -1; i <= 2; i++) { g.beginPath(); g.moveTo(hx + i * 3.5, hy + 6); g.lineTo(hx + i * 3.5, hy + 10); g.stroke(); }
  // Sockets.
  g.fillStyle = P.socket;
  g.beginPath(); g.ellipse(hx - 5, hy - 5, 4, 3.5, 0, 0, Math.PI * 2); g.ellipse(hx + 6, hy - 5, 4, 3.5, 0, 0, Math.PI * 2); g.fill();
  const eyeCol = weak || pose === 'windup' ? 'rgba(255,150,70,0.95)' : 'rgba(210,220,255,0.9)';
  g.globalCompositeOperation = 'lighter';
  const eg = glowSprite(eyeCol);
  for (const ex of [hx - 5, hx + 6]) g.drawImage(eg.c, ex - 8, hy - 13, 16, 16);
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = weak || pose === 'windup' ? '#ffd9a0' : '#eef2ff';
  for (const ex of [hx - 5, hx + 6]) { g.beginPath(); g.arc(ex, hy - 5, 1.8, 0, Math.PI * 2); g.fill(); }

  // Arms by pose. Shoulders at (+-30, sy+6).
  const shY = sy + 6;
  let fists;
  if (pose === 'windup') {
    // Raise both fists overhead fast, then hold them there, trembling.
    const u = ease(Math.min(1, pt * 1.7));
    const tr = pt > 0.6 ? Math.sin(time * 40) * 1.5 : 0;
    fists = [[lerp(-36, -8, u) + tr, lerp(8, sy - 34, u)], [lerp(36, 14, u) - tr, lerp(8, sy - 38, u)]];
  } else if (pose === 'exposed') {
    // Fists buried where the slam landed (clamped to arm's reach).
    const f = (e.face || 1) < 0 ? -1 : 1;
    let tx = e.slamX != null ? (e.slamX - e.x) * f : 24, ty = e.slamY != null ? e.slamY - e.y - hipY : -hipY - 6;
    const dx = tx, dy = ty - shY, d = Math.hypot(dx, dy), reach = 165;
    if (d > reach) { tx = dx / d * reach; ty = shY + dy / d * reach; }
    tx = Math.max(-20, tx);
    fists = [[tx - 13, ty + 2], [tx + 13, ty]];
  } else {
    const sw = stride ? Math.sin(cyc) * 8 : Math.sin(time * 1.5) * 1.5;
    const atk = e.atkT > 0 ? Math.min(1, e.atkT / 0.45) : 0;
    fists = [[-36 - sw * 0.3, 6 + sw], [36 + atk * 18, 6 - sw - atk * 22]];
  }
  for (let i = 0; i < 2; i++) {
    const sx = i ? 30 : -30;
    const [fx, fy] = fists[i];
    const ex = (sx + fx) / 2 + (i ? 8 : -8), ey = (shY + fy) / 2 + 4;
    bone(g, sx, shY, ex, ey, 9, P);
    bone(g, ex, ey, fx, fy, 8, P);
    fist(g, fx, fy, 10, P);
  }
  g.restore();
  g.restore();
  g.globalAlpha = 1;
}

// ---- Ground: slam telegraph, shockwave, bone mound --------------------------------
// Cosmetic only: the last telegraphed circle, so the shockwave can ring out where it
// landed (also between the two back-to-back slams of phase 3, keyed on b.slams).
const lastWarn = { x: 0, y: 0, r: 0, on: false };
let shock = null, lastSlams = -1, lastTime = -1;

export function drawBossWarnings(g, s, time) {
  const b = s.boss;
  if (!b) return;
  const slams = b.slams || 0;
  const fresh = time - lastTime >= 0 && time - lastTime < 0.5; // drawn continuously (not after a pause or a load)
  lastTime = time;
  if (slams !== lastSlams) {
    if (fresh && slams === lastSlams + 1 && lastWarn.on && (b.state === 'windup' || b.state === 'exposed')) shock = { x: lastWarn.x, y: lastWarn.y, r: lastWarn.r, at: time };
    lastSlams = slams;
    lastWarn.on = false;
  }
  if (b.state === 'withdrawn' || b.state === 'slain' || b.state === 'dormant') shock = null;
  if (b.warn) {
    lastWarn.x = b.warn.x; lastWarn.y = b.warn.y; lastWarn.r = b.warn.r; lastWarn.on = true;
    drawSlamCircle(g, b.warn, time);
  }
  if (shock) {
    const u = (time - shock.at) / 0.6;
    if (u >= 1 || u < 0) shock = null;
    else {
      g.strokeStyle = `rgba(255,210,160,${0.8 * (1 - u)})`; g.lineWidth = 6 * (1 - u) + 1;
      g.beginPath(); g.arc(shock.x, shock.y, shock.r * (0.6 + u * 0.8), 0, Math.PI * 2); g.stroke();
      g.strokeStyle = `rgba(90,60,40,${0.6 * (1 - u)})`; g.lineWidth = 2.5;
      for (let i = 0; i < 9; i++) {
        const a = i * 0.7 + shock.x * 0.01, r0 = shock.r * 0.2, r1 = shock.r * (0.7 + 0.25 * Math.sin(i * 3.1));
        g.beginPath(); g.moveTo(shock.x + Math.cos(a) * r0, shock.y + Math.sin(a) * r0); g.lineTo(shock.x + Math.cos(a + 0.12) * r1, shock.y + Math.sin(a + 0.12) * r1); g.stroke();
      }
    }
  }
  if (b.state === 'withdrawn' && b.mx != null) drawMound(g, b.mx, b.my, time, s.cycle.phase === 'dusk' ? 1 : 0, false);
  else if (b.state === 'slain' && b.lx) drawMound(g, b.lx, b.ly, time, 0, true);
}

function drawSlamCircle(g, w, time) {
  const p = Math.max(0, Math.min(1, w.t / w.dur));
  const pulse = 0.5 + 0.5 * Math.sin(time * (8 + p * 10));
  g.save();
  g.fillStyle = `rgba(255,50,30,${0.14 + 0.08 * pulse})`;
  g.beginPath(); g.arc(w.x, w.y, w.r, 0, Math.PI * 2); g.fill();
  // Growing inner disc: when it meets the rim, the fists land.
  g.fillStyle = `rgba(255,80,40,${0.22 + 0.16 * p})`;
  g.beginPath(); g.arc(w.x, w.y, w.r * p, 0, Math.PI * 2); g.fill();
  g.strokeStyle = `rgba(255,${Math.round(150 - 90 * p)},70,${0.8 + 0.2 * pulse})`; g.lineWidth = 4;
  g.beginPath(); g.arc(w.x, w.y, w.r, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = `rgba(255,220,170,${0.5 + 0.4 * pulse})`; g.lineWidth = 2.5;
  g.beginPath(); g.arc(w.x, w.y, w.r * p, 0, Math.PI * 2); g.stroke();
  // Inward chevrons from four sides.
  g.strokeStyle = `rgba(255,235,190,${0.55 + 0.4 * pulse})`; g.lineWidth = 4; g.lineCap = 'round'; g.lineJoin = 'round';
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2 + Math.PI / 4;
    const rr = w.r * (1.18 - 0.12 * ((time * 2) % 1));
    const cx = w.x + Math.cos(a) * rr, cy = w.y + Math.sin(a) * rr;
    const ux = -Math.cos(a), uy = -Math.sin(a), px = -uy, py = ux;
    g.beginPath(); g.moveTo(cx - ux * 7 + px * 9, cy - uy * 7 + py * 9); g.lineTo(cx + ux * 5, cy + uy * 5); g.lineTo(cx - ux * 7 - px * 9, cy - uy * 7 - py * 9); g.stroke();
  }
  g.restore();
}

function drawMound(g, x, y, time, stir, dead) {
  g.save();
  g.translate(x, y);
  g.fillStyle = 'rgba(20,16,24,0.3)'; g.beginPath(); g.ellipse(0, 4, 44, 14, 0, 0, Math.PI * 2); g.fill();
  const P = PAL;
  const jig = stir ? Math.sin(time * 18) * 1.2 : 0;
  // A heap of long bones, the skull on top.
  const bones = [[-30, 2, 4, -8], [-8, 6, 26, -4], [-22, -6, 10, 4], [6, -10, 34, 2], [-34, -4, -10, -14], [12, 6, 30, -10], [-14, -14, 16, -12]];
  for (const [x1, y1, x2, y2] of bones) bone(g, x1 + jig, y1, x2 - jig, y2, 6, P);
  // Ribs poking out.
  g.strokeStyle = INK; g.lineWidth = 5;
  for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(-6 + i * 7, -6); g.quadraticCurveTo(-10 + i * 7, -22, -2 + i * 7, -26); g.stroke(); }
  g.strokeStyle = P.bone; g.lineWidth = 3;
  for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(-6 + i * 7, -6); g.quadraticCurveTo(-10 + i * 7, -22, -2 + i * 7, -26); g.stroke(); }
  const sx = dead ? 22 : -14, sy = dead ? 0 : -16;
  g.fillStyle = P.bone; g.strokeStyle = INK; g.lineWidth = 2;
  g.beginPath(); g.ellipse(sx, sy, 12, 10, dead ? 0.6 : -0.2, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = P.socket; g.beginPath(); g.ellipse(sx - 4, sy - 1, 3, 2.6, 0, 0, Math.PI * 2); g.ellipse(sx + 4, sy - 1, 3, 2.6, 0, 0, Math.PI * 2); g.fill();
  if (!dead) {
    // Faint cold light in the sockets: it is only sleeping.
    // One cached glow sprite, faded with globalAlpha (a per-alpha colour key would
    // build a new 128x128 canvas in the sprite cache every frame).
    const a = 0.35 + 0.25 * Math.sin(time * 2) + stir * 0.4;
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = Math.max(0, Math.min(1, a / 0.9));
    const eg = glowSprite('rgba(200,210,255,0.9)');
    g.drawImage(eg.c, sx - 14, sy - 12, 28, 22);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }
  g.restore();
}

/** Light pools: the slam circle, the glowing rib cage, the eyes. */
export function bossLights(s, push) {
  const b = s.boss;
  if (!b) return;
  if (b.warn) push(b.warn.x, b.warn.y, b.warn.r * 1.2, 0.5);
  const e = b.id && s.rt && s.rt.eById ? s.rt.eById.get(b.id) : null;
  if (e && e.alive) {
    push(e.x, e.y - 90, 1.4 * T, 0.5);
    if (b.weakT > 0) push(e.x, e.y - 50, 3.2 * T, 0.95);
  }
  if (b.state === 'withdrawn' && b.mx != null) push(b.mx, b.my - 10, 1.2 * T, 0.35);
}

// ---- Bone Husk unit sprite (26 x 32, anchor 13,28; same contract as UNIT_ART) ----------
function boneHuskArt(frame) {
  return (g) => {
    ART.shadow(g, 13, 27, 6, 2.4);
    const a = frame === 1 ? 2 : frame === 2 ? -2 : 0;
    const B = '#d8d0bf', D = '#8f8775';
    // Legs.
    ART.line(g, 11, 20, 10 - a, 27, INK, 2.6); ART.line(g, 11, 20, 10 - a, 27, B, 1.4);
    ART.line(g, 15, 20, 16 + a, 27, INK, 2.6); ART.line(g, 15, 20, 16 + a, 27, B, 1.4);
    // Pelvis and spine.
    ART.poly(g, [9, 19, 17, 19, 16, 22, 10, 22], B, INK, 0.8);
    ART.line(g, 13, 19, 13, 11, D, 1.6);
    // Ribs.
    for (let i = 0; i < 3; i++) { const y = 12 + i * 2.4; ART.line(g, 13, y, 8.5 + i * 0.6, y + 1.6, B, 1.3); ART.line(g, 13, y, 17.5 - i * 0.6, y + 1.6, B, 1.3); }
    // Arms (rusty blade in the right).
    const atk = frame === 3;
    ART.line(g, 9, 11, 6, atk ? 14 : 19, B, 1.5);
    ART.line(g, 17, 11, atk ? 22 : 20, atk ? 8 : 18, B, 1.5);
    ART.line(g, atk ? 22 : 20, atk ? 8 : 18, atk ? 25 : 21, atk ? 2 : 24, '#8a6a4a', 1.8);
    // Skull.
    ART.circle(g, 13, 7.5, 4, B, INK, 0.9);
    ART.circle(g, 11.4, 7.4, 1.1, '#2a2430', null); ART.circle(g, 14.6, 7.4, 1.1, '#2a2430', null);
    ART.circle(g, 11.4, 7.4, 0.5, '#dfe6ff', null); ART.circle(g, 14.6, 7.4, 0.5, '#dfe6ff', null);
    ART.line(g, 11.5, 10.5, 14.5, 10.5, D, 0.8);
  };
}

let done = false;
export function register() {
  if (done) return;
  done = true;
  UNIT_ART.bonehusk = boneHuskArt;
}
