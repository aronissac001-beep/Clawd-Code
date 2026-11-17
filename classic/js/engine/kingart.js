// Procedural art for the Hollow King: a tall crowned wraith in a tattered
// cloak, drifting a hand above the ground, with violet eyes. Drawn live each
// frame. Also: the summon glyph, the grey snuff flames over Braziers, the
// shadow mark where he will step out, the darkness countdown and the darkness
// veil (an offscreen canvas with holes cut at every light and around the
// Sovereign, drawn in world space over the night).
import { glowSprite, lightSprite, ART } from './sprites.js';
import { lightRadiusOf } from '../game/systems/fog.js';
import { KING } from '../game/systems/hollowking.js';
import { T, WORLD } from '../game/grid.js';

const INK = ART.INK;
const PAL = { cloak: '#2a2238', cloakHi: '#4a3d63', cloakLo: '#17121f', bone: '#c9c4d6', crown: '#c9b26a', crownHi: '#efe0a0', gem: '#b98cff', eye: '#d9b8ff' };
// Hit flash: a cold lightening of the cloak, not a white ghost (he is under fire most of the fight).
const FLASH = { cloak: '#5a4a78', cloakHi: '#8a78b0', cloakLo: '#3a2e50', bone: '#ffffff', crown: '#f4e4a8', crownHi: '#ffffff', gem: '#e8d8ff', eye: '#ffffff' };

/** Draw the King with his ground point at (x, y). */
export function drawBoss(g, e, x, y, time, scale) {
  const P = e.hitT > 0.06 ? FLASH : PAL;
  const bob = Math.sin(time * 2.2 + e.id) * 3;
  const lift = 8 + bob;
  const cast = e.cast || '';
  const cp = e.castP || 0;
  const phase = e.phase || 1;
  const blinkOut = cast === 'teleport' ? cp : 0;
  const blinkIn = e.blinkT > 0 ? e.blinkT / 0.8 : 0;

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
  if (blinkOut > 0) {
    // Teleport shimmer: he thins out and wavers as the shadow mark fills.
    g.globalAlpha = 1 - blinkOut * 0.65;
    g.translate(Math.sin(time * 40) * blinkOut * 2.5, 0);
    g.scale(1 - blinkOut * 0.15, 1 + blinkOut * 0.08);
  }
  if (blinkIn > 0) g.globalAlpha = Math.min(g.globalAlpha, 1 - blinkIn * 0.5);
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

  if (blinkIn > 0) {
    // Arrival: violet shards burst outward.
    g.strokeStyle = `rgba(200,150,255,${blinkIn})`; g.lineWidth = 2.5;
    const r0 = 10 + (1 - blinkIn) * 34;
    for (let i = 0; i < 10; i++) {
      const a = i * 0.628;
      g.beginPath(); g.moveTo(x + Math.cos(a) * r0, y - 40 + Math.sin(a) * r0 * 0.8); g.lineTo(x + Math.cos(a) * (r0 + 8), y - 40 + Math.sin(a) * (r0 + 8) * 0.8); g.stroke();
    }
  }
}

// ---- World-space warnings ----------------------------------------------------------
let veil = null, vg = null;
const VS = 4; // world units per veil pixel

export function drawBossWarnings(g, s, time) {
  const b = s.boss;
  if (!b) return;
  // Darkness veil first so every warning stays readable above it.
  const dk = b.dark ? 1 : b.darkWarn ? Math.min(1, b.darkWarn.t / b.darkWarn.dur) : 0;
  if (dk > 0) drawVeil(g, s, dk, time);

  // Snuffed Braziers: a small grey wisp and the time until they rekindle.
  for (const bd of s.buildings) {
    if (!(bd.snuffT > 0) || !bd.alive) continue;
    const cx = (bd.tx + 0.5) * T, cy = bd.ty * T - 4;
    snuffIcon(g, cx, cy - 18, 0.75, 1 - bd.snuffT / KING.snuffT, time, false);
  }
  const a = b.act;
  if (a) {
    const p = Math.min(1, a.t / a.dur);
    if (a.k === 'summon') drawGlyph(g, a.x, a.y, p, time);
    else if (a.k === 'snuff') for (const id of a.ids) {
      const bd = s.rt.bById.get(id);
      if (bd && bd.alive) snuffIcon(g, (bd.tx + 0.5) * T, bd.ty * T - 22, 1.15, p, time, true);
    }
    else if (a.k === 'teleport') drawShadowMark(g, a.x, a.y, p, time);
  }
  if (b.darkWarn) drawCountdown(g, s, b.darkWarn, time);
  if (b.dark || b.darkWarn) drawSafeRing(g, s, time);
}

function drawGlyph(g, x, y, p, time) {
  const R = T * 1.7;
  const pulse = 0.5 + 0.5 * Math.sin(time * 9);
  g.save();
  g.translate(x, y);
  g.globalCompositeOperation = 'lighter';
  const gl = glowSprite('rgba(170,110,255,0.6)');
  g.drawImage(gl.c, -R * 1.4, -R * 1.4, R * 2.8, R * 2.8);
  g.globalCompositeOperation = 'source-over';
  g.strokeStyle = `rgba(200,150,255,${0.75 + 0.25 * pulse})`; g.lineWidth = 3;
  g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 2;
  g.beginPath(); g.arc(0, 0, R * 0.72, 0, Math.PI * 2); g.stroke();
  // Charge arc.
  g.strokeStyle = 'rgba(240,220,255,0.95)'; g.lineWidth = 4;
  g.beginPath(); g.arc(0, 0, R * 1.12, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2); g.stroke();
  // Rotating runes and a pentagram.
  g.rotate(time * 0.9);
  g.strokeStyle = `rgba(210,170,255,${0.7 + 0.3 * pulse})`; g.lineWidth = 2;
  g.beginPath();
  for (let i = 0; i <= 5; i++) { const ang = (i * 2 * Math.PI * 2) / 5 - Math.PI / 2; const px = Math.cos(ang) * R * 0.7, py = Math.sin(ang) * R * 0.7; if (i) g.lineTo(px, py); else g.moveTo(px, py); }
  g.stroke();
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2;
    g.save(); g.translate(Math.cos(ang) * R * 0.86, Math.sin(ang) * R * 0.86); g.rotate(ang);
    g.beginPath(); g.moveTo(-3, -4); g.lineTo(3, -4); g.moveTo(0, -4); g.lineTo(0, 4); g.moveTo(-3, 2); g.lineTo(2, 4); g.stroke();
    g.restore();
  }
  g.restore();
}

function drawShadowMark(g, x, y, p, time) {
  const R = T * (0.6 + 0.55 * p);
  g.save();
  g.translate(x, y);
  g.fillStyle = `rgba(14,6,26,${0.55 + 0.3 * p})`;
  g.beginPath(); g.ellipse(0, 0, R, R * 0.6, 0, 0, Math.PI * 2); g.fill();
  // Swirling arms.
  g.strokeStyle = `rgba(170,120,240,${0.6 + 0.3 * Math.sin(time * 10)})`; g.lineWidth = 2.5;
  for (let k = 0; k < 3; k++) {
    g.beginPath();
    for (let i = 0; i <= 14; i++) {
      const u = i / 14, ang = time * 3 + k * 2.09 + u * 3.2, r = R * (0.15 + u * 0.85);
      const px = Math.cos(ang) * r, py = Math.sin(ang) * r * 0.6;
      if (i) g.lineTo(px, py); else g.moveTo(px, py);
    }
    g.stroke();
  }
  // Countdown rim and a crown sigil rising from the pool.
  g.strokeStyle = 'rgba(230,200,255,0.95)'; g.lineWidth = 3.5;
  g.beginPath(); g.ellipse(0, 0, T * 1.2, T * 0.72, 0, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2); g.stroke();
  g.strokeStyle = 'rgba(230,200,255,0.5)'; g.lineWidth = 1.5;
  g.beginPath(); g.ellipse(0, 0, T * 1.2, T * 0.72, 0, 0, Math.PI * 2); g.stroke();
  const cy = -12 - p * 14;
  g.fillStyle = `rgba(201,178,106,${0.5 + 0.5 * p})`; g.strokeStyle = INK; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(-10, cy + 4); g.lineTo(-10, cy - 6); g.lineTo(-5, cy - 1); g.lineTo(0, cy - 10); g.lineTo(5, cy - 1); g.lineTo(10, cy - 6); g.lineTo(10, cy + 4); g.closePath(); g.fill(); g.stroke();
  g.restore();
}

// A grey flame in a dark disc; the ring fills toward the moment it happens (or rekindles).
function snuffIcon(g, x, y, k, p, time, warn) {
  g.save();
  g.translate(x, y);
  g.scale(k, k);
  const pulse = 0.5 + 0.5 * Math.sin(time * 10);
  g.fillStyle = 'rgba(20,16,28,0.85)'; g.strokeStyle = warn ? `rgba(220,90,80,${0.7 + 0.3 * pulse})` : 'rgba(150,145,160,0.8)'; g.lineWidth = 2.5;
  g.beginPath(); g.arc(0, 0, 15, 0, Math.PI * 2); g.fill(); g.stroke();
  g.strokeStyle = warn ? '#ffd0c0' : '#d8d4e0'; g.lineWidth = 3.5;
  g.beginPath(); g.arc(0, 0, 18, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2); g.stroke();
  // Grey flame.
  const f = Math.sin(time * 9) * 1.2;
  g.fillStyle = '#9a96a6';
  g.beginPath(); g.moveTo(-7, 7); g.quadraticCurveTo(-8, -3, f, -12); g.quadraticCurveTo(8, -3, 7, 7); g.quadraticCurveTo(0, 11, -7, 7); g.fill();
  g.fillStyle = '#d6d2de';
  g.beginPath(); g.moveTo(-3.5, 6); g.quadraticCurveTo(-4, 0, f * 0.6, -5); g.quadraticCurveTo(4, 0, 3.5, 6); g.quadraticCurveTo(0, 8, -3.5, 6); g.fill();
  if (warn) { g.strokeStyle = '#e05a4a'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(-10, -10); g.lineTo(10, 10); g.stroke(); }
  g.restore();
}

function drawCountdown(g, s, w, time) {
  const sv = s.sovereign;
  const left = Math.max(1, Math.ceil(w.dur - w.t));
  const x = sv && sv.alive ? sv.x : (s.rt.hearth ? (s.rt.hearth.tx + 1.5) * T : WORLD / 2);
  const y = sv && sv.alive ? sv.y - 64 : (s.rt.hearth ? s.rt.hearth.ty * T - 40 : WORLD / 2);
  const frac = (w.dur - w.t) % 1;
  const k = 1 + frac * 0.25;
  g.save();
  g.translate(x, y);
  g.scale(k, k);
  g.fillStyle = 'rgba(16,8,26,0.85)'; g.strokeStyle = 'rgba(200,150,255,0.95)'; g.lineWidth = 3;
  g.beginPath(); g.arc(0, 0, 24, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = '#f0e4ff';
  g.font = '900 34px system-ui, -apple-system, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(left), 0, 1);
  g.restore();
}

function drawSafeRing(g, s, time) {
  const sv = s.sovereign;
  if (!sv || !sv.alive) return;
  const R = KING.sovSafe * T;
  g.save();
  g.strokeStyle = `rgba(255,214,120,${0.55 + 0.25 * Math.sin(time * 4)})`; g.lineWidth = 2.5; g.setLineDash([8, 6]);
  g.beginPath(); g.arc(sv.x, sv.y, R, 0, Math.PI * 2); g.stroke();
  g.setLineDash([]);
  g.restore();
}

// Darkness outside every light pool and the Sovereign's Heartflame.
function drawVeil(g, s, k, time) {
  const b = s.boss;
  if (!veil) {
    if (typeof document === 'undefined') return;
    veil = document.createElement('canvas');
    veil.width = veil.height = Math.ceil(WORLD / VS);
    vg = veil.getContext('2d');
  }
  const W = veil.width;
  vg.globalCompositeOperation = 'source-over';
  vg.clearRect(0, 0, W, W);
  vg.fillStyle = `rgba(8,2,18,${0.7 * k})`;
  vg.fillRect(0, 0, W, W);
  vg.globalCompositeOperation = 'destination-out';
  const ls = lightSprite();
  const hole = (x, y, r) => { const rr = (r * 1.35) / VS; vg.drawImage(ls.c, x / VS - rr, y / VS - rr, rr * 2, rr * 2); };
  for (const bd of s.buildings) {
    if (!bd.built || !bd.alive || (bd.type !== 'brazier' && bd.type !== 'hearth')) continue;
    const r = lightRadiusOf(s, bd);
    if (r > 0) hole((bd.tx + bd.size / 2) * T, (bd.ty + bd.size / 2) * T, r * T);
  }
  const sv = s.sovereign;
  if (sv && sv.alive) hole(sv.x, sv.y, (KING.sovSafe + 0.3) * T);
  // A faint gap around the King himself: the biggest threat stays readable in his own dark.
  const ke = b.id && s.rt.eById.get(b.id);
  if (ke && ke.alive) { vg.globalAlpha = 0.6; hole(ke.x, ke.y - 40, 1.7 * T); vg.globalAlpha = 1; }
  vg.globalCompositeOperation = 'source-over';
  g.save();
  g.imageSmoothingEnabled = true;
  g.drawImage(veil, 0, 0, WORLD, WORLD);
  g.restore();
  // Eyes of the Hollow still glint in the dark: threats stay readable.
  g.fillStyle = 'rgba(220,190,255,0.9)';
  for (const e of s.enemies) {
    if (!e.alive || e.boss || e.stationary) continue;
    const h = 12 * (e.scale || 1);
    g.fillRect(e.x - 2.5, e.y - h, 1.8, 1.8); g.fillRect(e.x + 0.8, e.y - h, 1.8, 1.8);
  }
}

/** Light pools: his eyes, the summon glyph, the shadow mark. */
export function bossLights(s, push) {
  const b = s.boss;
  if (!b) return;
  const e = b.id && s.rt && s.rt.eById ? s.rt.eById.get(b.id) : null;
  if (e && e.alive) push(e.x, e.y - 70, 1.6 * T, 0.6);
  const a = b.act;
  if (a && a.k === 'summon') push(a.x, a.y, 2.4 * T, 0.7);
  if (a && a.k === 'teleport') push(a.x, a.y, 1.4 * T, 0.4);
}
