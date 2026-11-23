// The great beasts' art (owner D; EMBERCROWN-FORTRESS.md 1.1 and 3.12, step S9.2a). Salvaged from the
// roguelite's boss modules (bossart.js, colossusart.js, kingart.js, foeart.js; deleted in Stage 2.9,
// git history keeps them) before they were removed, so the three Hollow Lords keep their look when they
// return as unique legends in Stage Z3. Nothing imports this module yet: it is not shipped until a
// beast renderer (owner C, Z3) draws from it. It reads no sim state: each painter draws one entity record
// at a world point, so it stays pure render code (Math.random is cosmetic only, as in sprites.js).
// The scripted parts of the old bosses are not salvaged (F13: no weak-spot script, no teleport, no
// darkness veil, no snuffed braziers, no 25% retreat, no escort except the Hollow King's Knights, whose
// art is the 'knight' foe sprite in beings.js). The telegraph painters (strafe band, slam circle) stay:
// a beast's attacks are still telegraphed (Deep Reader shows them 1 s earlier).
//
//   drawGloomwyrm(g, e, x, y, time, scale)   e: { id, z, ang, flying, fire, hitT }; (x, y) the ground point
//   drawStrafeBand(g, w, time)               w: { x1, y1, x2, y2, width, t, dur, dive } (world units)
//   drawColossus(g, e, x, y, time, scale)    e: { pose: 'walk'|'windup'|'exposed', poseT, rise (s), x, y, px, py,
//                                            anim, face, weak, atkT, hitT, slamX, slamY }; (x, y) the feet
//   drawSlamCircle(g, w, time)               w: { x, y, r, t, dur }
//   drawBoneMound(g, x, y, time, stir, dead) the heap of bones the Colossus sleeps in (stir 0-1)
//   drawHollowKing(g, e, x, y, time, scale)  e: { id, face, phase, cast: ''|'summon', castP, atkT, hitT }
//   wyvernBody(g, frame)                     an ash wyvern body in a 64 x 44 box (anchor 32, 30), for the
//                                            generated winged beasts; frame 0 glide, 1 up, 2 down, 3 strike
//   beastLights(kind, e, push)               light pools: push(x, y, radius, strength); kind 'gloomwyrm' |
//                                            'colossus' | 'hollowking'
// Every size is in world units (T = 32 per tile), as the old renderer drew them.
import { sprite, flashOf, glowSprite, ART } from '../sprites.js';

const T = 32;
const INK = ART.INK;
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);

// ---- The Gloomwyrm: a grey-violet dragon seen from above at a tabletop tilt, its altitude shown by
// lifting the body off a ground shadow. The body is cached per detail scale; wings and breath are live.
const TILT = 0.78; // y squash of the tabletop view
const WYRM = {
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
    g.fillStyle = WYRM.body; g.strokeStyle = ART.INK; g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(58, cy - 10); g.quadraticCurveTo(30, cy - 7, 10, cy - 1);
    g.lineTo(10, cy + 1); g.quadraticCurveTo(30, cy + 7, 58, cy + 10);
    g.closePath(); g.fill(); g.stroke();
    poly(g, [12, cy, 2, cy - 7, 4, cy, 2, cy + 7], WYRM.dark, ART.INK, 1);
    // Hind legs tucked under.
    for (const sy of [-1, 1]) poly(g, [56, cy + sy * 9, 50, cy + sy * 19, 46, cy + sy * 20, 50, cy + sy * 9], WYRM.dark, ART.INK, 1);
    // Torso.
    g.fillStyle = WYRM.body;
    g.beginPath(); g.ellipse(74, cy, 27, 17, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = WYRM.back;
    g.beginPath(); g.ellipse(72, cy, 20, 8, 0, 0, Math.PI * 2); g.fill();
    // Fore claws.
    for (const sy of [-1, 1]) poly(g, [88, cy + sy * 10, 96, cy + sy * 18, 99, cy + sy * 16, 94, cy + sy * 9], WYRM.dark, ART.INK, 1);
    // Neck.
    g.fillStyle = WYRM.body;
    g.beginPath();
    g.moveTo(92, cy - 9); g.quadraticCurveTo(108, cy - 7, 118, cy - 5);
    g.lineTo(118, cy + 5); g.quadraticCurveTo(108, cy + 7, 92, cy + 9);
    g.closePath(); g.fill(); g.stroke();
    // Head: wedge snout, swept horns.
    poly(g, [114, cy - 8, 132, cy - 6, 146, cy - 2, 148, cy, 146, cy + 2, 132, cy + 6, 114, cy + 8], WYRM.body, ART.INK, 1.2);
    poly(g, [120, cy - 5, 136, cy - 3, 144, cy, 136, cy + 3, 120, cy + 5], WYRM.back, null);
    for (const sy of [-1, 1]) poly(g, [118, cy + sy * 6, 104, cy + sy * 14, 108, cy + sy * 9, 116, cy + sy * 3], WYRM.horn, ART.INK, 0.8);
    // Dorsal spines from the head down the tail.
    g.fillStyle = WYRM.horn;
    for (let x = 18; x < 126; x += 8) {
      const w = x < 50 ? 2 : x > 100 ? 2.2 : 3.2;
      poly(g, [x - w, cy - w * 0.8, x + w * 1.6, cy, x - w, cy + w * 0.8], WYRM.horn, null);
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
  g.fillStyle = flash ? '#fff6e0' : WYRM.wing; g.fill();
  g.strokeStyle = ART.INK; g.lineWidth = 1.4; g.stroke();
  if (flash) return;
  // Finger bones from the wrist and a pale leading edge.
  g.strokeStyle = WYRM.bone; g.lineWidth = 2;
  for (const [px, py] of w.pts) { g.beginPath(); g.moveTo(w.wx, w.wy); g.lineTo(px, py); g.stroke(); }
  g.strokeStyle = WYRM.wingHi; g.lineWidth = 2.4;
  g.beginPath(); g.moveTo(80, sy * 11); g.quadraticCurveTo(94, (sy * 11 + w.wy) / 2, w.wx, w.wy); g.lineTo(w.pts[0][0], w.pts[0][1]); g.stroke();
}

/** Draw the Gloomwyrm at ground point (x, y); e.z lifts the body. */
export function drawGloomwyrm(g, e, x, y, time, scale) {
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
  g.fillStyle = WYRM.eye;
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

/** A danger band for a pending strafe line (world units). */
export function drawStrafeBand(g, w, time) {
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


// ---- The Bone Colossus: a hulking skeleton of grey bone in the three-quarter side view of the
// colonists, about three tiles tall, drawn live: stomping stride, swats, the two-fisted slam wind-up,
// fists buried after the slam with the rib cage glowing ember-red (e.weak).
/** Seconds the Colossus takes to stand up from its bones (e.rise counts down from this). */
export const COLOSSUS_RISE = 1.5;
const BONE = { bone: '#cfc6b2', boneHi: '#ebe4d2', boneLo: '#968d7a', boneDk: '#6b6455', socket: '#1c1822', void: '#221d28' };
const BONE_FLASH = { bone: '#fff6e0', boneHi: '#fffaf0', boneLo: '#f4e8cc', boneDk: '#e8d8b8', socket: '#fff0d8', void: '#f8e8d0' };

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
export function drawColossus(g, e, x, y, time, scale) {
  const P = e.hitT > 0.06 ? BONE_FLASH : BONE;
  const pose = e.pose || 'walk';
  const pt = e.poseT || 0;
  const rise = e.rise > 0 ? Math.min(1, e.rise / COLOSSUS_RISE) : 0;
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

/** The slam telegraph: when the inner disc meets the rim, the fists land. */
export function drawSlamCircle(g, w, time) {
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

/** The heap of bones the Colossus sleeps in (stir 0-1 shakes it; dead: the skull rolled aside). */
export function drawBoneMound(g, x, y, time, stir, dead) {
  g.save();
  g.translate(x, y);
  g.fillStyle = 'rgba(20,16,24,0.3)'; g.beginPath(); g.ellipse(0, 4, 44, 14, 0, 0, Math.PI * 2); g.fill();
  const P = BONE;
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

// ---- The Hollow King: a tall crowned wraith in a tattered cloak, drifting a hand above the ground,
// with violet eyes. His Knights are the 'knight' foe sprite (beings.js).
const KING = { cloak: '#2a2238', cloakHi: '#4a3d63', cloakLo: '#17121f', bone: '#c9c4d6', crown: '#c9b26a', crownHi: '#efe0a0', gem: '#b98cff', eye: '#d9b8ff' };
// Hit flash: a cold lightening of the cloak, not a white ghost (he is under fire most of the fight).
const KING_FLASH = { cloak: '#5a4a78', cloakHi: '#8a78b0', cloakLo: '#3a2e50', bone: '#ffffff', crown: '#f4e4a8', crownHi: '#ffffff', gem: '#e8d8ff', eye: '#ffffff' };

/** Draw the King with his ground point at (x, y). */
export function drawHollowKing(g, e, x, y, time, scale) {
  const P = e.hitT > 0.06 ? KING_FLASH : KING;
  const bob = Math.sin(time * 2.2 + e.id) * 3;
  const lift = 8 + bob;
  const cast = e.cast || '';
  const cp = e.castP || 0;
  const phase = e.phase || 1;

  // Shadow (it does not bob).
  g.fillStyle = 'rgba(12,6,22,0.38)';
  g.beginPath(); g.ellipse(x, y + 1, 22, 7, 0, 0, Math.PI * 2); g.fill();

  // Violet aura.
  g.globalCompositeOperation = 'lighter';
  const aura = glowSprite(phase >= 3 ? 'rgba(170,110,255,0.5)' : 'rgba(150,100,230,0.36)');
  g.drawImage(aura.c, x - 46, y - lift - 96, 92, 100);
  g.globalCompositeOperation = 'source-over';

  g.save();
  g.translate(x, y - lift);
  if ((e.face || 1) < 0) g.scale(-1, 1);
  g.lineJoin = 'round'; g.lineCap = 'round';

  // Cloak: long, flaring, ragged hem that ripples.
  const hemY = -2;
  g.fillStyle = P.cloak; g.strokeStyle = INK; g.lineWidth = 2;
  g.beginPath();
  g.moveTo(-11, -64);
  g.quadraticCurveTo(-22, -34, -25, hemY - 4);
  const teeth = 7;
  for (let i = 0; i <= teeth; i++) {
    const u = i / teeth;
    const hx = -25 + u * 50;
    const dip = (i % 2 ? 9 : 0) + Math.sin(time * 5 + i * 1.7) * 2.5;
    g.lineTo(hx, hemY + dip - 4);
  }
  g.quadraticCurveTo(22, -34, 11, -64);
  g.closePath(); g.fill(); g.stroke();
  // Inner fold shadow and a lighter edge.
  g.fillStyle = P.cloakLo;
  g.beginPath(); g.moveTo(-3, -60); g.quadraticCurveTo(-8, -30, -10, hemY + 2); g.lineTo(6, hemY + 4); g.quadraticCurveTo(4, -30, 3, -60); g.closePath(); g.fill();
  g.strokeStyle = P.cloakHi; g.lineWidth = 2;
  g.beginPath(); g.moveTo(-11, -62); g.quadraticCurveTo(-21, -34, -24, hemY - 6); g.stroke();
  // Wisps trailing from the hem.
  g.strokeStyle = 'rgba(120,90,180,0.5)'; g.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    const wx = -14 + i * 14, ph = time * 3 + i * 2;
    g.beginPath(); g.moveTo(wx, hemY + 4); g.quadraticCurveTo(wx + Math.sin(ph) * 5, hemY + 10, wx + Math.sin(ph + 1) * 7, hemY + 16); g.stroke();
  }

  // Arms: long sleeves ending in bone-white claws.
  const atk = e.atkT > 0 ? Math.min(1, e.atkT / 0.3) : 0;
  const raise = cast === 'summon' ? Math.min(1, cp * 2) : 0;
  const sleeves = [
    [-12, -58, -24 + raise * 2, -30 - raise * 36],
    [12, -58, 24 + atk * 12 - raise * 2, -32 - raise * 36 - atk * 8],
  ];
  for (const [sx, sy, hx, hy] of sleeves) {
    g.strokeStyle = INK; g.lineWidth = 10;
    g.beginPath(); g.moveTo(sx, sy); g.quadraticCurveTo((sx + hx) / 2 + (hx > 0 ? 6 : -6), (sy + hy) / 2, hx, hy); g.stroke();
    g.strokeStyle = P.cloak; g.lineWidth = 7.5;
    g.beginPath(); g.moveTo(sx, sy); g.quadraticCurveTo((sx + hx) / 2 + (hx > 0 ? 6 : -6), (sy + hy) / 2, hx, hy); g.stroke();
    // Claws.
    g.strokeStyle = P.bone; g.lineWidth = 1.8;
    for (let k = -1; k <= 1; k++) { g.beginPath(); g.moveTo(hx, hy); g.lineTo(hx + k * 3 + (hx > 0 ? 3 : -3), hy + 6 - Math.abs(k)); g.stroke(); }
  }
  if (raise > 0) {
    // A violet orb gathers between the raised hands.
    g.globalCompositeOperation = 'lighter';
    const og = glowSprite('rgba(190,130,255,0.9)');
    const r = 10 + cp * 14;
    g.drawImage(og.c, -r, -70 - r - raise * 6, r * 2, r * 2);
    g.globalCompositeOperation = 'source-over';
  }

  // Hood around a void face.
  g.fillStyle = P.cloak; g.strokeStyle = INK; g.lineWidth = 2;
  g.beginPath(); g.moveTo(-12, -60); g.quadraticCurveTo(-14, -80, 0, -84); g.quadraticCurveTo(14, -80, 12, -60); g.quadraticCurveTo(0, -56, -12, -60); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#07040c';
  g.beginPath(); g.ellipse(2, -68, 7.5, 8.5, 0, 0, Math.PI * 2); g.fill();
  // Violet eyes.
  const eyeA = phase >= 3 ? 1 : 0.85;
  g.globalCompositeOperation = 'lighter';
  const eg = glowSprite(`rgba(200,140,255,${eyeA})`);
  for (const ex of [-1.5, 5.5]) g.drawImage(eg.c, ex - 8, -78, 16, 16);
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = P.eye;
  for (const ex of [-1.5, 5.5]) { g.beginPath(); g.ellipse(ex, -70, 2, 1.4, 0, 0, Math.PI * 2); g.fill(); }

  // The crown: a tarnished circlet of tall spikes, violet gems.
  const cy0 = -82;
  g.fillStyle = P.crown; g.strokeStyle = INK; g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(-11, cy0 + 3);
  const spikes = [[-11, 10], [-6, 15], [0, 19], [6, 15], [11, 10]];
  for (let i = 0; i < spikes.length; i++) {
    const [sx, h] = spikes[i];
    const next = spikes[i + 1];
    g.lineTo(sx, cy0 - h);
    g.lineTo(next ? (sx + next[0]) / 2 : 12, cy0 - 3);
  }
  g.lineTo(12, cy0 + 3);
  g.closePath(); g.fill(); g.stroke();
  g.fillStyle = P.crownHi; g.fillRect(-11, cy0 - 1, 23, 2);
  g.fillStyle = P.gem;
  for (const gx of [-6, 0, 6]) { g.beginPath(); g.arc(gx, cy0 + 0.5, 1.8, 0, Math.PI * 2); g.fill(); }
  if (phase >= 2) {
    // Cold violet fire licks the crown's tips.
    g.globalCompositeOperation = 'lighter';
    for (const [sx, h] of spikes) {
      const f = 3 + Math.sin(time * 12 + sx) * 1.5;
      g.fillStyle = 'rgba(190,140,255,0.55)';
      g.beginPath(); g.moveTo(sx - 2, cy0 - h + 1); g.quadraticCurveTo(sx, cy0 - h - f * 2.2, sx + 2, cy0 - h + 1); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  }
  g.restore();
  g.globalAlpha = 1;
}

// ---- An ash wyvern body (64 x 44 box, body anchor 32, 30; the ground shadow is drawn separately) ----
// frame: 0 glide, 1 wings up, 2 wings down, 3 talons forward (strike)
export function wyvernBody(g, frame) {
  const { poly, line, circle, shade } = ART;
  const up = frame === 1 ? 1 : frame === 2 ? -1 : frame === 3 ? 0.6 : 0.2;
  const SK = '#8a5a48', SKD = '#5e3a2e', MEM = 'rgba(150,96,78,0.92)';
  // far wing
  const fy = 18 - up * (up > 0 ? 12 : 7);
  poly(g, [30, 20, 40, fy - 2, 52, fy + 1, 46, 21, 38, 22], shade('#8a5a48', -0.3), INK, 0.8);
  // tail
  g.strokeStyle = SKD; g.lineWidth = 2.4; g.beginPath(); g.moveTo(22, 25); g.quadraticCurveTo(12, 28, 4, 24 - up); g.stroke();
  poly(g, [2, 22 - up, 6, 23.5 - up, 3, 27 - up], SKD, INK, 0.6);
  // body
  g.fillStyle = SK; g.beginPath(); g.ellipse(30, 24, 10, 4.6, -0.1, 0, Math.PI * 2); g.fill(); g.strokeStyle = INK; g.lineWidth = 0.9; g.stroke();
  g.fillStyle = '#c9a080'; g.beginPath(); g.ellipse(30, 26.5, 7, 1.7, -0.1, 0, Math.PI * 2); g.fill();
  // legs / talons
  if (frame === 3) {
    line(g, 32, 27, 38, 33, SKD, 2); line(g, 27, 27, 33, 34, SKD, 2);
    for (const [x, y] of [[38, 33], [33, 34]]) { line(g, x, y, x + 2.5, y + 1.5, '#e8e0d0', 0.9); line(g, x, y, x + 1, y + 2.6, '#e8e0d0', 0.9); }
  } else { line(g, 32, 27, 30, 31, SKD, 1.8); line(g, 27, 27, 25, 31, SKD, 1.8); }
  // neck and horned head
  poly(g, [36, 21, 44, 15, 49, 15.5, 52, 18, 47, 20, 41, 23], SK, INK, 0.9);
  poly(g, [45, 15.5, 47, 10.5, 48, 15.5], '#3a2820', null);
  circle(g, 48.5, 17, 0.9, '#ffb347', null);
  if (frame === 3) poly(g, [50, 19, 54, 21, 50, 21], '#f0e6d0', null);
  // near wing: a bat-like membrane on finger bones
  const ny = 20 - up * (up > 0 ? 16 : 9);
  poly(g, [26, 22, 34, ny - 3, 50, ny - 1, 58, ny + 6, 48, ny + 8, 40, 23], MEM, INK, 0.9);
  g.strokeStyle = SKD; g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(34, ny - 3); g.lineTo(48, ny + 8); g.moveTo(34, ny - 3); g.lineTo(42, 22.5); g.moveTo(50, ny - 1); g.lineTo(48, ny + 8); g.stroke();
  line(g, 26, 22, 34, ny - 3, SK, 2);
}

// ---- Light pools ------------------------------------------------------------------------------------
/** Light pools for one beast entity: push(x, y, radius, strength) in world units. */
export function beastLights(kind, e, push) {
  if (!e) return;
  if (kind === 'gloomwyrm') {
    push(e.x, e.y - (e.z || 0) - 16, 1.6 * T, 0.45);
    if (e.fire) {
      const c = Math.cos(e.ang || 0), sn = Math.sin(e.ang || 0) * TILT;
      push(e.x + c * 48, e.y + sn * 48, 3.2 * T, 0.8);
      push(e.x, e.y - (e.z || 0), 2 * T, 0.6);
    }
  } else if (kind === 'colossus') {
    push(e.x, e.y - 90, 1.4 * T, 0.5);
    if (e.weak) push(e.x, e.y - 50, 3.2 * T, 0.95);
  } else if (kind === 'hollowking') {
    push(e.x, e.y - 70, 1.6 * T, 0.6);
  }
}

// ---- Generated beasts: the part-based painter (step Z3.3) --------------------------------------------------
// drawBeast(g, b, x, y, time, opts) paints a generated great beast from its body record (beasts/gen.js: plan,
// mat, size, attacks) with whole-pixel fillRects only (no paths, no allocation per frame): a body block per
// plan, limbs, eyes, and material detail. (x, y) is the centre of its footprint in world units; size 2 or 3
// tiles. opts: { hit (0-1 flash), flee, calm (reduce motion) }. Returns the fillRect count (the render budget
// check: tools/tests/beasts.test.mjs). drawBeastFoe(g, foe, b, time, calm) draws a beast foe at its position.
// Palettes are original: [base, shade, light] per material.
export const BEAST_PAL = Object.freeze({
  stone: ['#7d7a72', '#53514c', '#a8a49a'], ash: ['#5b5550', '#3a3532', '#8a827a'], glass: ['#7fb8c4', '#4e7f8c', '#d2eef2'],
  bone: ['#d8ccb0', '#a3967a', '#f2ead6'], ember: ['#b4482a', '#6e2a18', '#f0a050'], fungus: ['#7a8a4a', '#4c5a2c', '#c4d27a'],
  salt: ['#d6d6cc', '#a2a298', '#f6f6ee'], tar: ['#2e2a2c', '#181618', '#5a5458'],
});
const EYE = '#f0d060', EYE_DARK = '#a02c2c';
function rect(g, c, x, y, w, h) { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h))); }
export function drawBeast(g, b, x, y, time = 0, opts = {}) {
  const P = BEAST_PAL[b.mat] || BEAST_PAL.stone, S = (b.size || 2) * T, u = S / 16;
  const bob = opts.calm ? 0 : Math.round(Math.sin(time * 3) * u * 0.5), step = opts.calm ? 0 : ((time * 4) | 0) & 1;
  const x0 = x - S / 2, y0 = y - S / 2 + bob;
  const base = opts.hit > 0 ? '#ffffff' : P[0];
  let n = 0;
  const R = (c, px, py, w, h) => { rect(g, c, x0 + px * u, y0 + py * u, w * u, h * u); n++; };
  R('rgba(0,0,0,0.28)', 2, 14, 12, 2);   // shadow
  switch (b.plan) {
    case 'serpent': case 'eel':
      for (let k = 0; k < 6; k++) R(k & 1 ? P[1] : base, 1 + k * 2, 8 + ((k + step) & 1) * 2, 3, 4);
      R(base, 11, 4, 4, 5); R(P[2], 12, 5, 2, 1); break;
    case 'manylegged':
      R(base, 3, 6, 10, 5); R(P[2], 4, 6, 8, 1);
      for (let k = 0; k < 4; k++) { R(P[1], 3 + k * 3, 11, 1, 3 + ((k + step) & 1)); R(P[1], 3 + k * 3, 3 + ((k + step) & 1), 1, 3); }
      R(base, 12, 5, 3, 4); break;
    case 'winged':
      R(P[1], 0, 3 - step, 6, 5); R(P[1], 10, 3 - step, 6, 5); R(base, 5, 5, 6, 6); R(P[2], 6, 6, 4, 1); R(base, 7, 2, 3, 3); R(P[1], 6, 11, 1, 3); R(P[1], 9, 11, 1, 3); break;
    case 'toad':
      R(base, 2, 5, 12, 8); R(P[2], 4, 9, 8, 3); R(P[1], 1, 11, 3, 3); R(P[1], 12, 11, 3, 3); R(base, 4, 3, 3, 3); R(base, 9, 3, 3, 3); break;
    case 'blob':
      R(base, 2, 6, 12, 8); R(base, 4, 4, 8, 2); R(P[2], 5, 5, 3, 2); R(P[1], 2, 12, 12, 2); break;
    case 'giant':
      R(base, 5, 1, 6, 4); R(P[1], 4, 5, 8, 6); R(P[2], 5, 5, 6, 1); R(base, 2, 5, 2, 6 + step); R(base, 12, 5, 2, 7 - step); R(P[1], 5, 11, 2, 4); R(P[1], 9, 11, 2, 4); break;
    case 'crab':
      R(base, 3, 6, 10, 6); R(P[2], 4, 6, 8, 1); R(P[1], 0, 4 + step, 3, 3); R(P[1], 13, 4 + step, 3, 3);
      for (let k = 0; k < 3; k++) { R(P[1], 3 + k * 4, 12, 1, 2); R(P[1], 4 + k * 4, 12, 1, 2); } break;
    default:
      R(base, 3, 4, 10, 9);
  }
  // eyes (two), a material detail and the attack tells
  R(b.attacks && b.attacks.includes('darkness') ? EYE_DARK : EYE, 12, 6, 1, 1); R(b.attacks && b.attacks.includes('darkness') ? EYE_DARK : EYE, 13, 6, 1, 1);
  if (b.mat === 'glass') R(P[2], 6, 7, 1, 2);
  else if (b.mat === 'ember') R(step ? '#ffd070' : P[2], 7, 8, 2, 1);
  else if (b.mat === 'fungus') { R(P[2], 5, 4, 1, 1); R(P[2], 9, 5, 1, 1); }
  if (b.attacks && b.attacks.includes('breath') && step) R('#ff8a30', 15, 7, 1, 1);
  if (opts.flee) R('rgba(160,30,30,0.7)', 6, 0, 4, 1);
  return n;
}
/** Draw a beast foe (sim record f with f.st.gb; b its Beast) at its world point. Returns the fillRect count. */
export function drawBeastFoe(g, f, b, time = 0, calm = false) {
  return drawBeast(g, b, f.x, f.y, time, { hit: f.hitT || 0, flee: !!(f.st && f.st.flee), calm });
}
