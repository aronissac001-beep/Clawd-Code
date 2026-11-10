// Procedural art for the Hollow Rift: a grey-violet tear in the ground seen at
// the tabletop tilt, with a cracked scar (cached), a swirling maw, a pulsing
// core and stone shards orbiting above it. About three tiles across.
import { sprite, glowSprite, ART } from './sprites.js';

const TILT = 0.62;   // y squash of the ground ellipse
const R = 48;        // scar radius (world units): about three tiles across
const PAL = { scar: '#2b2436', rim: '#4a4058', crack: '#b9a6e6', swirl: '#7f6ea6', swirlHi: '#c9bdf0', core: '#efe8ff', shard: '#6c6480', shardHi: '#a59cc0' };

// Static ground scar: dark blot with jagged edge and radiating cracks.
function scarSprite(scale) {
  const W = R * 2 + 24, H = R * 2 * TILT + 24;
  return sprite('rift:scar', scale, W, H, W / 2, H / 2, (g) => {
    const cx = W / 2, cy = H / 2;
    g.save(); g.translate(cx, cy); g.scale(1, TILT);
    // Scorched halo.
    const gr = g.createRadialGradient(0, 0, R * 0.4, 0, 0, R + 10);
    gr.addColorStop(0, 'rgba(40,32,54,0.55)'); gr.addColorStop(1, 'rgba(40,32,54,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, R + 10, 0, Math.PI * 2); g.fill();
    // Jagged scar.
    g.beginPath();
    for (let i = 0; i <= 18; i++) {
      const a = (i / 18) * Math.PI * 2, rr = R * (0.72 + 0.16 * Math.sin(i * 2.7) + 0.08 * Math.cos(i * 5.1));
      if (i === 0) g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); else g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    g.closePath(); g.fillStyle = PAL.rim; g.fill();
    g.strokeStyle = ART.INK; g.lineWidth = 1.4; g.stroke();
    g.beginPath(); g.ellipse(0, 0, R * 0.62, R * 0.58, 0, 0, Math.PI * 2); g.fillStyle = PAL.scar; g.fill();
    // Cracks running out into the earth.
    g.strokeStyle = 'rgba(185,166,230,0.55)'; g.lineWidth = 1.6;
    for (let i = 0; i < 7; i++) {
      const a = i * 0.9 + 0.3;
      let x = Math.cos(a) * R * 0.6, y = Math.sin(a) * R * 0.6;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 3; k++) {
        const aa = a + Math.sin(i * 3 + k) * 0.4, len = 6 + ((i + k) % 3) * 3;
        x += Math.cos(aa) * len; y += Math.sin(aa) * len; g.lineTo(x, y);
      }
      g.stroke();
    }
    // Broken stones on the rim.
    for (let i = 0; i < 9; i++) {
      const a = i * 0.72 + 0.2, rr = R * 0.78;
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr, s = 2.5 + (i % 3);
      ART.poly(g, [x - s, y, x, y - s * 1.2, x + s, y - s * 0.2, x + s * 0.4, y + s], i % 2 ? PAL.shard : PAL.shardHi, ART.INK, 0.8);
    }
    g.restore();
  });
}

// Hit flash, tracked here from health drops: the sim never ticks a stationary foe's hitT,
// so reading it would leave the rift flashing forever after the first blow. Cosmetic only.
const seen = new Map(); // id -> { hp, at }
function hitFlash(e, time) {
  let m = seen.get(e.id);
  if (!m) {
    if (seen.size > 16) seen.clear();
    m = { hp: e.hp, at: -9 };
    seen.set(e.id, m);
  }
  if (e.hp < m.hp - 0.01) m.at = time;
  m.hp = e.hp;
  const k = 1 - (time - m.at) / 0.14;
  return k > 0 && k <= 1 ? k : 0;
}

/** The static ground scar alone, for a renderer that draws it in the ground/decal pass. */
export function drawRiftGround(g, e, x, y, time, scale) {
  const sc = scarSprite(scale);
  g.drawImage(sc.c, x - sc.ax, y - sc.ay, sc.w, sc.h);
}

/** Draw the rift at ground point (x, y). noGround: the scar was already drawn by drawRiftGround. */
export function drawRift(g, e, x, y, time, scale, noGround) {
  if (!noGround) drawRiftGround(g, e, x, y, time, scale);
  const hpf = e.maxHp ? Math.max(0, Math.min(1, e.hp / e.maxHp)) : 1;
  const pulse = 0.5 + 0.5 * Math.sin(time * 2.4 + e.id);
  const flash = hitFlash(e, time);
  const mr = R * (0.38 + 0.18 * hpf); // the maw shrinks as the rift weakens

  // Swirling maw: rotating spiral arms inside a squashed ellipse.
  g.save();
  g.translate(x, y); g.scale(1, TILT);
  g.fillStyle = '#16111f';
  g.beginPath(); g.ellipse(0, 0, mr + 4, mr + 2, 0, 0, Math.PI * 2); g.fill();
  g.lineCap = 'round';
  for (let k = 0; k < 4; k++) {
    const base = time * (1.3 + k * 0.15) + k * (Math.PI / 2);
    g.strokeStyle = k % 2 ? PAL.swirl : PAL.swirlHi;
    g.globalAlpha = 0.55 + 0.35 * pulse;
    g.lineWidth = 3.2 - k * 0.4;
    g.beginPath();
    for (let i = 0; i <= 14; i++) {
      const u = i / 14, a = base + u * 4.2, rr = mr * (1 - u * 0.85);
      const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.stroke();
  }
  g.globalAlpha = 1;
  g.restore();

  // Pulsing core glow.
  g.globalCompositeOperation = 'lighter';
  const gl = glowSprite('rgba(170,150,235,0.55)');
  const gs = 50 + 26 * pulse + 30 * flash;
  g.drawImage(gl.c, x - gs, y - gs * TILT - 4, gs * 2, gs * 2 * TILT);
  const cs = 12 + 6 * pulse;
  const cg = glowSprite('rgba(240,232,255,0.9)');
  g.drawImage(cg.c, x - cs, y - cs - 4, cs * 2, cs * 2);
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = flash ? '#fff6e0' : PAL.core;
  g.beginPath(); g.ellipse(x, y - 4, 3 + 2 * pulse, (3 + 2 * pulse) * 0.8, 0, 0, Math.PI * 2); g.fill();

  // Orbiting shards: lifted stones circling above the maw (back half first).
  const shards = [];
  for (let i = 0; i < 7; i++) {
    const a = time * (0.7 + (i % 3) * 0.12) + (i / 7) * Math.PI * 2;
    const rr = R * (0.55 + (i % 2) * 0.22);
    const sx = x + Math.cos(a) * rr, sy = y + Math.sin(a) * rr * TILT;
    const lift = 16 + 8 * Math.sin(time * 1.8 + i * 1.3) + (i % 3) * 4;
    shards.push({ sx, sy, lift, front: Math.sin(a) > 0, s: 3.5 + (i % 3) * 1.2, a });
  }
  shards.sort((p, q) => p.sy - q.sy);
  for (const p of shards) {
    // Small ground shadow, then the shard itself.
    g.fillStyle = 'rgba(16,12,26,0.25)';
    g.beginPath(); g.ellipse(p.sx, p.sy, p.s, p.s * 0.45, 0, 0, Math.PI * 2); g.fill();
    const sy = p.sy - p.lift, s = p.s, tw = Math.cos(time * 3 + p.a) * 0.6;
    ART.poly(g, [p.sx - s * (0.6 + tw * 0.3), sy, p.sx, sy - s * 1.6, p.sx + s * 0.7, sy - s * 0.2, p.sx + s * 0.1, sy + s * 1.1],
      flash ? '#fff6e0' : p.front ? PAL.shardHi : PAL.shard, ART.INK, 0.9);
    g.fillStyle = 'rgba(201,189,240,0.8)';
    g.fillRect(p.sx - 0.6, sy - s * 0.9, 1.2, s * 0.9);
  }

  // Motes drifting up out of the tear (cosmetic randomness).
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = 'rgba(200,188,245,0.7)';
  for (let i = 0; i < 4; i++) {
    const u = (time * 0.6 + i / 4) % 1;
    const mx = x + Math.sin(i * 2.1 + time) * mr * 0.6 + (Math.random() - 0.5) * 1.5;
    const my = y - 4 - u * 46;
    g.globalAlpha = 1 - u;
    g.fillRect(mx - 1.2, my - 1.2, 2.4, 2.4);
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
}

/** Light pools: a cold violet glow over the tear that pulses with the core. */
export function riftLights(e, push) {
  if (!e || !e.alive) return;
  push(e.x, e.y - 6, 2.4 * 32, 0.55);
  push(e.x, e.y - 10, 1.1 * 32, 0.8);
}
