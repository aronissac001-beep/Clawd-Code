// Procedural art for the Gloomwyrm: a grey-violet dragon seen from above at a
// tabletop tilt, its altitude shown by lifting the body off a ground shadow.
// The body is cached per detail scale; wings, breath and warnings are drawn
// live each frame (one boss, a handful of paths).
import { sprite, flashOf, glowSprite, ART } from './sprites.js';

const T = 32;
const TILT = 0.78; // y squash of the tabletop view
const PAL = {
  body: '#6e6782', back: '#57506b', belly: '#9d96ad', dark: '#383246',
  wing: '#5b5372', wingHi: '#8d85a6', bone: '#2e2939', horn: '#d9d3e6', eye: '#f1f5ff',
};

// Body pointing +x, anchor at the shoulders. World units.
const BW = 156, BH = 70, BAX = 72, BAY = 35;
function bodySprite(scale) {
  return sprite('wyrm:body', scale, BW, BH, BAX, BAY, (g) => {
    const cy = BAY;
    const { poly } = ART;
    // Tail: tapering scaled whip ending in a barbed spade.
    g.fillStyle = PAL.body; g.strokeStyle = ART.INK; g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(58, cy - 10); g.quadraticCurveTo(30, cy - 7, 10, cy - 1);
    g.lineTo(10, cy + 1); g.quadraticCurveTo(30, cy + 7, 58, cy + 10);
    g.closePath(); g.fill(); g.stroke();
    poly(g, [12, cy, 2, cy - 7, 4, cy, 2, cy + 7], PAL.dark, ART.INK, 1);
    // Hind legs tucked under.
    for (const sy of [-1, 1]) poly(g, [56, cy + sy * 9, 50, cy + sy * 19, 46, cy + sy * 20, 50, cy + sy * 9], PAL.dark, ART.INK, 1);
    // Torso.
    g.fillStyle = PAL.body;
    g.beginPath(); g.ellipse(74, cy, 27, 17, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = PAL.back;
    g.beginPath(); g.ellipse(72, cy, 20, 8, 0, 0, Math.PI * 2); g.fill();
    // Fore claws.
    for (const sy of [-1, 1]) poly(g, [88, cy + sy * 10, 96, cy + sy * 18, 99, cy + sy * 16, 94, cy + sy * 9], PAL.dark, ART.INK, 1);
    // Neck.
    g.fillStyle = PAL.body;
    g.beginPath();
    g.moveTo(92, cy - 9); g.quadraticCurveTo(108, cy - 7, 118, cy - 5);
    g.lineTo(118, cy + 5); g.quadraticCurveTo(108, cy + 7, 92, cy + 9);
    g.closePath(); g.fill(); g.stroke();
    // Head: wedge snout, swept horns.
    poly(g, [114, cy - 8, 132, cy - 6, 146, cy - 2, 148, cy, 146, cy + 2, 132, cy + 6, 114, cy + 8], PAL.body, ART.INK, 1.2);
    poly(g, [120, cy - 5, 136, cy - 3, 144, cy, 136, cy + 3, 120, cy + 5], PAL.back, null);
    for (const sy of [-1, 1]) poly(g, [118, cy + sy * 6, 104, cy + sy * 14, 108, cy + sy * 9, 116, cy + sy * 3], PAL.horn, ART.INK, 0.8);
    // Dorsal spines from the head down the tail.
    g.fillStyle = PAL.horn;
    for (let x = 18; x < 126; x += 8) {
      const w = x < 50 ? 2 : x > 100 ? 2.2 : 3.2;
      poly(g, [x - w, cy - w * 0.8, x + w * 1.6, cy, x - w, cy + w * 0.8], PAL.horn, null);
    }
    // Belly-scale hint along the flanks.
    g.strokeStyle = 'rgba(200,192,220,0.35)'; g.lineWidth = 1;
    for (let x = 58; x < 96; x += 6) { g.beginPath(); g.arc(x, cy, 12, -0.5, 0.5); g.stroke(); g.beginPath(); g.arc(x, cy, 12, Math.PI - 0.5, Math.PI + 0.5); g.stroke(); }
  });
}

// One wing on side sy (-1 left, +1 right) in body space. open: 0 folded .. 1 spread.
function wingPath(g, sy, open, lift) {
  const span = 28 + 72 * open;
  const sx = 80, sh = sy * 11;
  const wx = sx + 14 + 6 * lift, wy = sy * (span * 0.6);           // wrist
  const tx = sx - 2 + 12 * lift, ty = sy * span;                    // wing tip
  const f1x = sx - 30, f1y = sy * (span * 0.8);
  const f2x = sx - 48, f2y = sy * (span * 0.5);
  const rx = sx - 52, ry = sy * 9;                                  // root at the flank
  g.beginPath();
  g.moveTo(sx, sh);
  g.quadraticCurveTo(sx + 12, (sh + wy) / 2, wx, wy);
  g.lineTo(tx, ty);
  g.quadraticCurveTo((tx + f1x) / 2, (ty + f1y) / 2 - sy * 2, f1x, f1y);
  g.quadraticCurveTo((f1x + f2x) / 2 + 4, (f1y + f2y) / 2, f2x, f2y);
  g.quadraticCurveTo((f2x + rx) / 2 + 6, (f2y + ry) / 2, rx, ry);
  g.closePath();
  return { wx, wy, pts: [[tx, ty], [f1x, f1y], [f2x, f2y]] };
}

function drawWing(g, sy, open, lift, flash) {
  const w = wingPath(g, sy, open, lift);
  g.fillStyle = flash ? '#fff6e0' : PAL.wing; g.fill();
  g.strokeStyle = ART.INK; g.lineWidth = 1.4; g.stroke();
  if (flash) return;
  // Finger bones from the wrist and a pale leading edge.
  g.strokeStyle = PAL.bone; g.lineWidth = 2;
  for (const [px, py] of w.pts) { g.beginPath(); g.moveTo(w.wx, w.wy); g.lineTo(px, py); g.stroke(); }
  g.strokeStyle = PAL.wingHi; g.lineWidth = 2.4;
  g.beginPath(); g.moveTo(80, sy * 11); g.quadraticCurveTo(94, (sy * 11 + w.wy) / 2, w.wx, w.wy); g.lineTo(w.pts[0][0], w.pts[0][1]); g.stroke();
}

/** Draw the wyrm at ground point (x, y); e.z lifts the body. */
export function drawBoss(g, e, x, y, time, scale) {
  const z = e.z || 0;
  const hi = Math.min(1, z / 160);
  // Ground shadow: smaller and softer the higher it flies.
  const k = 1 - hi * 0.45;
  g.fillStyle = `rgba(16,12,26,${0.16 * (1 - hi * 0.5)})`;
  g.beginPath(); g.ellipse(x, y, 82 * k, 30 * k, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = `rgba(16,12,26,${0.22 * (1 - hi * 0.6)})`;
  g.beginPath(); g.ellipse(x, y, 52 * k, 18 * k, 0, 0, Math.PI * 2); g.fill();

  const flying = e.flying || z > 2;
  const ang = e.ang || 0; // the sim keeps the heading current while perched too (bites turn it)
  const bx = x, by = y - z - 16;
  const rate = e.fire ? 7 : flying ? 4.2 : 1.2;
  const flap = Math.sin(time * rate + e.id);
  const open = flying ? 0.72 + 0.28 * flap : 0.12 + 0.05 * flap;
  const lift = flying ? flap : 0;
  const flash = e.hitT > 0 ? Math.min(1, e.hitT / 0.14) : 0;

  // Faint ember-grey aura.
  g.globalCompositeOperation = 'lighter';
  const gl = glowSprite('rgba(185,175,225,0.28)');
  g.drawImage(gl.c, bx - 95, by - 80, 190, 160);
  g.globalCompositeOperation = 'source-over';

  if (e.fire) drawBreath(g, e, bx, by, x, y, ang, time);

  g.save();
  g.translate(bx, by);
  g.scale(1, TILT);
  g.rotate(ang);
  const bob = flying ? -flap * 3 : 0;
  g.translate(0, bob * 0.3);
  g.lineJoin = 'round'; g.lineCap = 'round';
  g.translate(-BAX, 0); // wings are laid out in body-sprite space
  drawWing(g, -1, open, lift, false);
  drawWing(g, 1, open, lift, false);
  if (flash) {
    g.globalAlpha = flash * 0.75;
    drawWing(g, -1, open, lift, true);
    drawWing(g, 1, open, lift, true);
    g.globalAlpha = 1;
  }
  g.translate(BAX, 0);
  const sp = bodySprite(scale);
  g.drawImage(sp.c, -sp.ax, -sp.ay, sp.w, sp.h);
  if (flash) {
    const f = flashOf(sp, 'wyrm:body', scale);
    g.globalAlpha = flash * 0.85; g.drawImage(f.c, -sp.ax, -sp.ay, sp.w, sp.h); g.globalAlpha = 1;
  }
  // Pale glowing eyes.
  const ex = 134 - BAX;
  g.globalCompositeOperation = 'lighter';
  const eg = glowSprite('rgba(220,232,255,0.8)');
  for (const sy of [-1, 1]) g.drawImage(eg.c, ex - 6, sy * 4 - 6, 12, 12);
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = PAL.eye;
  for (const sy of [-1, 1]) { g.beginPath(); g.ellipse(ex, sy * 4, 2.4, 1.5, 0, 0, Math.PI * 2); g.fill(); }
  g.restore();
}

// Grey fire pouring from the jaws to the ground ahead.
function drawBreath(g, e, bx, by, x, y, ang, time) {
  const c = Math.cos(ang), s = Math.sin(ang) * TILT;
  const mx = bx + c * 76, my = by + s * 76;            // mouth
  const gx = x + c * 48, gy = y + s * 48;              // ground splash
  const px = -s, py = c;
  g.globalCompositeOperation = 'lighter';
  const gr = g.createLinearGradient(mx, my, gx, gy);
  gr.addColorStop(0, 'rgba(225,220,250,0.6)');
  gr.addColorStop(0.5, 'rgba(160,150,200,0.42)');
  gr.addColorStop(1, 'rgba(120,110,160,0.12)');
  g.fillStyle = gr;
  const w0 = 4, w1 = 22 + Math.sin(time * 20) * 3;
  g.beginPath();
  g.moveTo(mx + px * w0, my + py * w0); g.lineTo(gx + px * w1, gy + py * w1);
  g.lineTo(gx - px * w1, gy - py * w1); g.lineTo(mx - px * w0, my - py * w0);
  g.closePath(); g.fill();
  for (let i = 0; i < 6; i++) {
    const u = Math.random(), r = 4 + u * 10;
    const qx = mx + (gx - mx) * u + px * (Math.random() - 0.5) * w1, qy = my + (gy - my) * u + py * (Math.random() - 0.5) * w1;
    g.fillStyle = `rgba(${170 + (Math.random() * 40) | 0},${160 + (Math.random() * 40) | 0},215,${0.18 + Math.random() * 0.22})`;
    g.beginPath(); g.arc(qx, qy, r, 0, Math.PI * 2); g.fill();
  }
  const sg = glowSprite('rgba(190,180,235,0.4)');
  g.drawImage(sg.c, gx - 36, gy - 24, 72, 48);
  g.globalCompositeOperation = 'source-over';
}

/** World-space danger bands for the pending strafe line(s). */
export function drawBossWarnings(g, s, time) {
  const b = s.boss;
  if (!b) return;
  for (const w of [b.warn, b.warn2]) if (w) drawBand(g, w, time);
}

function drawBand(g, w, time) {
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1, L = Math.hypot(dx, dy);
  if (L < 1) return;
  const hw = w.width / 2;
  const p = Math.max(0, Math.min(1, w.t / w.dur));
  const live = w.t >= w.dur;
  const pulse = 0.5 + 0.5 * Math.sin(time * (live ? 16 : 9));
  g.save();
  g.translate(w.x1, w.y1);
  g.rotate(Math.atan2(dy, dx));
  // Base band, then the charge fill growing toward the far end.
  g.fillStyle = `rgba(255,70,40,${0.12 + 0.08 * pulse})`;
  g.fillRect(0, -hw, L, hw * 2);
  g.fillStyle = live ? `rgba(255,90,50,${0.34 + 0.12 * pulse})` : `rgba(255,120,50,${0.2 + 0.1 * pulse})`;
  g.fillRect(0, -hw, L * p, hw * 2);
  // Hard edges.
  g.strokeStyle = `rgba(255,${live ? 90 : 140},70,${0.75 + 0.25 * pulse})`;
  g.lineWidth = 3;
  g.beginPath(); g.moveTo(0, -hw); g.lineTo(L, -hw); g.moveTo(0, hw); g.lineTo(L, hw); g.stroke();
  // Chevrons marching in the travel direction.
  const gap = 44, off = (time * (live ? 160 : 70)) % gap;
  g.strokeStyle = `rgba(255,214,150,${0.45 + 0.4 * pulse})`;
  g.lineWidth = 5; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath();
  for (let x = off + 10; x < L - 6; x += gap) {
    g.moveTo(x - 9, -hw * 0.55); g.lineTo(x + 5, 0); g.lineTo(x - 9, hw * 0.55);
  }
  g.stroke();
  if (w.dive) {
    // Target ring on the Hearth.
    g.strokeStyle = `rgba(255,80,60,${0.6 + 0.4 * pulse})`; g.lineWidth = 4;
    g.beginPath(); g.arc(L, 0, hw * 1.6 + pulse * 6, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(L - hw, 0); g.lineTo(L + hw, 0); g.moveTo(L, -hw); g.lineTo(L, hw); g.stroke();
  }
  g.restore();
}

/** Light pools for the renderer: grey fire while strafing, eyes, and the warning bands. */
export function bossLights(s, push) {
  const b = s.boss;
  if (!b) return;
  for (const w of [b.warn, b.warn2]) {
    if (!w) continue;
    const L = Math.hypot(w.x2 - w.x1, w.y2 - w.y1), n = Math.max(1, Math.floor(L / (2 * T)));
    for (let i = 0; i <= n; i++) { const u = i / n; push(w.x1 + (w.x2 - w.x1) * u, w.y1 + (w.y2 - w.y1) * u, 1.4 * T, 0.32); }
  }
  const e = b.id && s.rt && s.rt.eById ? s.rt.eById.get(b.id) : null;
  if (!e || !e.alive) return;
  push(e.x, e.y - (e.z || 0) - 16, 1.6 * T, 0.45);
  if (e.fire) {
    const c = Math.cos(e.ang || 0), sn = Math.sin(e.ang || 0) * TILT;
    push(e.x + c * 48, e.y + sn * 48, 3.2 * T, 0.8);
    push(e.x, e.y - (e.z || 0), 2 * T, 0.6);
  }
}
