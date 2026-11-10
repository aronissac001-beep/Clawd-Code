// Phase 4 hero art: Skald, Druid, Duelist and Frostwarden miniatures in the same
// tabletop style and frame layout as js/engine/heroart.js (28 x 34, feet at 14,30;
// frame 0 idle, 1/2 walk, 3 attack), merged into HERO_ART so heroSprite, drawHero and
// the portraits pick them up. Also: thorn and frost bolts, ice on frozen Hollow, roots
// and chill at their feet, the Skald's song ring, and fx for dodges, freezes and kill gold.
// Everything here is cosmetic (Math.random is allowed in drawing).
import { ART } from './sprites.js';
import { HERO_ART } from './heroart.js';
import { perkDef } from '../data/heroes.js';
import { HP4 } from '../data/heroes-p4.js';
import { BUS, ART_HOOKS } from '../game/hooks.js';
import { N, idx } from '../game/grid.js';

const { INK, shadow, poly, rect, rrect, circle, line, shade } = ART;
const T = 32;

// ---- Shared body parts (copied from heroart.js so the build matches; centre x = 14) ----------
function legs(g, f, color, y = 23) {
  const a = f === 1 ? 2 : f === 2 ? -2 : 0;
  rect(g, 11 + a * 0.5, y, 2.8, 6 - Math.max(0, a), color, 'rgba(25,18,12,0.7)', 0.6);
  rect(g, 14.4 - a * 0.5, y, 2.8, 6 - Math.max(0, -a), color, 'rgba(25,18,12,0.7)', 0.6);
}
function torso(g, color, trim, y = 13, w = 12, h = 11) {
  rrect(g, 14 - w / 2, y, w, h, 3, color);
  if (trim) rect(g, 14 - 1.5, y + 1, 3, h - 2, trim, null);
  rect(g, 14 - w / 2 + 0.5, y + h - 3, w - 1, 1.6, 'rgba(60,40,20,0.85)', null);
}
function cape(g, color, f) {
  const sway = f === 1 ? 1 : f === 2 ? -1 : 0;
  poly(g, [8, 13, 20, 13, 22 + sway, 27, 6 + sway, 27], color, INK, 0.8);
  poly(g, [9, 13, 19, 13, 18, 16, 10, 16], shade(color, 0.18), null);
}
function robe(g, f, color, trim) {
  const a = f === 1 ? 1 : f === 2 ? -1 : 0;
  poly(g, [9, 15, 19, 15, 21 + a, 29, 7 + a, 29], color, INK, 0.8);
  if (trim) line(g, 14, 16, 14 + a * 0.5, 29, trim, 1.2);
}
function head(g, skin = '#e8c49a', y = 9, r = 3.9) { circle(g, 14, y, r, skin); }
function circlet(g, y = 7.4, w = 4.4) {
  g.strokeStyle = '#f6d15a'; g.lineWidth = 1.3;
  g.beginPath(); g.ellipse(14, y, w, 1.5, 0, Math.PI * 0.05, Math.PI * 0.95, true); g.stroke();
  circle(g, 14, y - 1.2, 1.1, '#fff0a0', 'rgba(120,80,10,0.8)', 0.5);
}

// ---- Class miniatures ---------------------------------------------------------------------------
export const HERO_ART_P4 = {
  // War-singer: braided hair, fur-trimmed tunic, round shield with a brass boss, a horn and an axe.
  skald(f, c) {
    return (g) => {
      shadow(g, 14, 29, 7.5, 2.8, 0.32);
      cape(g, c.cape, f);
      legs(g, f, '#5a4030');
      torso(g, '#a8563a', '#e0a848', 13, 12, 11);
      for (let i = 0; i < 4; i++) circle(g, 9.6 + i * 2.9, 13, 1.7, '#d8c8a8', null); // fur collar
      head(g, '#ebc49c', 9, 3.9);
      // braids
      g.fillStyle = '#e8c060'; g.beginPath(); g.arc(14, 8.2, 4.3, Math.PI * 1.02, Math.PI * -0.02); g.fill();
      rect(g, 9.2, 8.5, 1.8, 7, '#e8c060', 'rgba(120,80,20,0.6)', 0.5); rect(g, 17, 8.5, 1.8, 7, '#e8c060', 'rgba(120,80,20,0.6)', 0.5);
      circlet(g, 7.2);
      // brass horn on a strap
      line(g, 9, 13, 18, 22, '#6a4a2a', 0.9);
      poly(g, [16, 21, 20, 20.5, 21.5, 23.5, 17.5, 23], '#e8b84a', INK, 0.6);
      // round shield on the left arm
      circle(g, 6.6, 18.5, 4.2, '#7a5030', INK, 0.8);
      g.strokeStyle = '#c89a4a'; g.lineWidth = 0.9; g.beginPath(); g.arc(6.6, 18.5, 3.1, 0, Math.PI * 2); g.stroke();
      circle(g, 6.6, 18.5, 1.3, '#f0c860', null);
      // bearded axe
      const a = f === 3;
      const hx = a ? 25 : 21.5, hy = a ? 11 : 5;
      line(g, a ? 18 : 19.5, a ? 21 : 23, hx, hy, '#6b4a2d', 1.6);
      poly(g, a ? [hx - 0.5, hy - 3.5, hx + 3.5, hy - 1, hx + 2.5, hy + 3.5, hx - 0.5, hy + 1.5] : [hx - 0.5, hy - 1, hx + 3.5, hy - 2, hx + 3.5, hy + 3.5, hx - 0.5, hy + 2.5], '#d0d4da', INK, 0.6);
      if (a) { line(g, 4, 8, 6, 5, '#f0c860', 0.9); line(g, 2.5, 11, 1, 9, '#f0c860', 0.9); } // a sung note
    };
  },
  // Grove-keeper: hooded green robe, little antler twigs, staff with leaves and a green light.
  druid(f, c) {
    return (g) => {
      shadow(g, 14, 29, 7, 2.6);
      cape(g, c.cape, f);
      robe(g, f, '#4e7a3e', '#a8d070');
      torso(g, '#5e8a48', '#3a5a2a', 12, 11, 7);
      // leaf belt
      for (let i = 0; i < 3; i++) poly(g, [10 + i * 3, 18.5, 11.5 + i * 3, 17, 13 + i * 3, 18.5, 11.5 + i * 3, 20], '#8ac860', null);
      head(g, '#d8b08a', 8.6, 3.8);
      // hood and twig antlers
      g.fillStyle = '#3a5a2a'; g.beginPath(); g.arc(14, 8.8, 4.7, Math.PI * 0.95, Math.PI * 0.05); g.lineTo(18.5, 12); g.lineTo(9.5, 12); g.closePath(); g.fill();
      line(g, 11, 5, 9, 1.5, '#7a5a3a', 0.9); line(g, 9.8, 3, 8, 3, '#7a5a3a', 0.8);
      line(g, 17, 5, 19, 1.5, '#7a5a3a', 0.9); line(g, 18.2, 3, 20, 3, '#7a5a3a', 0.8);
      circlet(g, 7.2, 4.2);
      // grey beard
      poly(g, [11.5, 10.5, 16.5, 10.5, 15.5, 14.5, 14, 15.5, 12.5, 14.5], '#d8d4c8', 'rgba(60,60,50,0.5)', 0.4);
      // gnarled staff with leaves and a glowing seed
      const at = f === 3;
      const sx = at ? 23 : 21, sy = at ? 3 : 2;
      line(g, 19, 28, sx, sy + 3, '#6b4a2d', 1.7);
      poly(g, [sx - 3, sy + 2, sx - 1, sy, sx - 1.5, sy + 3], '#7ac050', null);
      poly(g, [sx + 3, sy + 3, sx + 1, sy + 1, sx + 1.2, sy + 4], '#7ac050', null);
      circle(g, sx, sy, 2.2, '#b8f080', '#3a7a2a', 0.6);
      if (at) { circle(g, sx + 3, sy - 2, 1.2, '#d8ffb0', null); circle(g, sx - 2, sy - 3.5, 0.9, '#d8ffb0', null); }
    };
  },
  // Fast blade: feathered wide hat, slim doublet, a long thin rapier; the attack frame lunges.
  duelist(f, c) {
    return (g) => {
      shadow(g, 14, 29, 6.5, 2.4);
      cape(g, c.cape, f);
      legs(g, f, '#2e2430');
      // slim doublet with a sash
      torso(g, '#7a2e44', '#e0607e', 13.5, 10, 10.5);
      line(g, 9.5, 15, 18.5, 21, '#f0d8a0', 1.2);
      head(g, '#e2b890', 9.4, 3.7);
      // dark hair, moustache
      g.fillStyle = '#3a2418'; g.beginPath(); g.arc(14, 9, 3.9, Math.PI * 1.05, Math.PI * -0.05); g.fill();
      line(g, 12.3, 11.3, 15.7, 11.3, '#3a2418', 0.8);
      circlet(g, 7.6, 3.9);
      // wide hat with a plume
      g.fillStyle = '#3a2a3e'; g.beginPath(); g.ellipse(14, 6.2, 7, 1.7, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = INK; g.lineWidth = 0.6; g.stroke();
      rrect(g, 10.6, 2.4, 6.8, 4, 1.5, '#3a2a3e', INK, 0.6);
      g.strokeStyle = '#e0607e'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(16.5, 4); g.quadraticCurveTo(21, 1, 23.5, 3.5); g.stroke();
      // rapier: raised in guard, thrust straight out when attacking
      const a = f === 3;
      if (a) {
        line(g, 18, 17.5, 28, 17, '#eef2f8', 1.0);
        circle(g, 18, 17.5, 1.5, '#e8c25a', INK, 0.5);
        line(g, 8, 16, 5, 13, '#e2b890', 1.6); // off hand back for balance
      } else {
        line(g, 19, 21, 24, 6, '#eef2f8', 1.0);
        circle(g, 19, 21, 1.5, '#e8c25a', INK, 0.5);
        line(g, 17.6, 20, 20.6, 22, '#c8902e', 1.1);
      }
    };
  },
  // Ice mage: pale robe with a frost mantle, white hair, a tall crystal staff.
  frostwarden(f, c) {
    return (g) => {
      shadow(g, 14, 29, 7, 2.6);
      cape(g, c.cape, f);
      robe(g, f, '#b8d8ee', '#eaf6ff');
      // snowflake hem
      for (let i = 0; i < 3; i++) circle(g, 10 + i * 4, 27, 0.9, '#ffffff', null);
      torso(g, '#d0e6f6', '#5a8ac8', 12, 11, 7);
      // frost mantle
      poly(g, [8.5, 12, 19.5, 12, 18, 15.5, 14, 14, 10, 15.5], '#eaf6ff', 'rgba(60,90,130,0.7)', 0.6);
      head(g, '#f0d4bc', 8.6, 3.8);
      // long white hair
      g.fillStyle = '#f4f8ff'; g.beginPath(); g.arc(14, 8, 4.3, Math.PI * 1.0, 0); g.lineTo(18.3, 13); g.lineTo(16.8, 13); g.lineTo(16.5, 9); g.lineTo(11.5, 9); g.lineTo(11.2, 13); g.lineTo(9.7, 13); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(120,150,190,0.7)'; g.lineWidth = 0.5; g.stroke();
      circlet(g, 7.2);
      // crystal staff
      const at = f === 3;
      const sx = at ? 23.5 : 21.5, sy = at ? 3.5 : 2.5;
      line(g, 19, 28, sx, sy + 3.5, '#5a6a8a', 1.6);
      poly(g, [sx, sy - 4, sx + 2.4, sy, sx, sy + 4, sx - 2.4, sy], '#bfeaff', '#3a6aa0', 0.7);
      line(g, sx, sy - 3, sx, sy + 3, '#ffffff', 0.7);
      if (at) {
        g.strokeStyle = '#e8faff'; g.lineWidth = 0.8;
        for (let k = 0; k < 3; k++) { const ang = k * 2.094; g.beginPath(); g.moveTo(sx + 4 + Math.cos(ang) * 2.2, sy - 2 + Math.sin(ang) * 2.2); g.lineTo(sx + 4 - Math.cos(ang) * 2.2, sy - 2 - Math.sin(ang) * 2.2); g.stroke(); }
      }
    };
  },
};

// ---- Bolts ------------------------------------------------------------------------------------------
function drawP4Bolt(g, p, x, y) {
  if (p === PROBE) { probeSeen = true; return false; }
  if (p.kind === 'p4thorn') {
    const ang = Math.atan2(p.ty - p.sy, p.tx - p.sx), c = Math.cos(ang), s = Math.sin(ang);
    g.strokeStyle = 'rgba(40,70,20,0.85)'; g.lineWidth = 2.4;
    g.beginPath(); g.moveTo(x - c * 8, y - s * 8); g.lineTo(x, y); g.stroke();
    g.strokeStyle = '#9ad860'; g.lineWidth = 1.3; g.stroke();
    g.fillStyle = '#c8f090';
    g.beginPath(); g.moveTo(x + c * 3, y + s * 3); g.lineTo(x - s * 2, y + c * 2); g.lineTo(x + s * 2, y - c * 2); g.closePath(); g.fill();
    // a leaf trailing behind
    g.fillStyle = '#6ab840'; g.beginPath(); g.ellipse(x - c * 6 - s * 2, y - s * 6 + c * 2, 2.2, 1, ang + 0.6, 0, Math.PI * 2); g.fill();
    return true;
  }
  if (p.kind === 'p4frost') {
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = 'rgba(140,210,255,0.35)'; g.beginPath(); g.arc(x, y, 6.5, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#e8f8ff'; g.strokeStyle = '#4a8ac8'; g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(x, y - 4); g.lineTo(x + 2.6, y); g.lineTo(x, y + 4); g.lineTo(x - 2.6, y); g.closePath(); g.fill(); g.stroke();
    return true;
  }
  return false;
}

// ---- World effects (draw.overlay) -------------------------------------------------------------------------
// Drawn in draw.overlay (after lighting) so ice, roots and the song read at night too;
// foes on tiles still hidden by fog are skipped so nothing is revealed early.
function drawP4World(g, s, view, time) {
  const E = s.enemies;
  for (let i = 0; i < E.length; i++) {
    const e = E[i];
    if (!e.alive || !(e.frzT > 0 || (e.p4fx && e.slowT > 0))) continue;
    if (s.fog && !s.fog[idx(Math.min(N - 1, Math.max(0, (e.x / T) | 0)), Math.min(N - 1, Math.max(0, (e.y / T) | 0)))]) continue;
    if (e.frzT > 0) drawIce(g, e, time);
    else if (e.p4fx && e.slowT > 0) (e.p4fx === 1 ? drawRoots : drawChill)(g, e, time);
  }
  const H = s.heroes;
  for (let i = 0; i < H.length; i++) {
    const e = H[i];
    if (e.cls !== 'skald' || !e.alive || e.away) continue;
    // The War Song: a slow golden ring at the edge of the song's reach.
    const st = songRadius(s, e);
    const pulse = 0.5 + 0.5 * Math.sin(time * 2.4 + e.id);
    g.strokeStyle = `rgba(240,200,110,${0.22 + 0.14 * pulse})`;
    g.lineWidth = 1.4;
    g.setLineDash([6, 7]);
    g.beginPath(); g.ellipse(e.x, e.y - 2, st, st * 0.55, 0, 0, Math.PI * 2); g.stroke();
    g.setLineDash([]);
    if (s.cycle && (s.cycle.phase === 'night' || s.cycle.phase === 'dusk')) {
      // drifting notes
      const k = (time * 0.7 + e.id * 0.37) % 1;
      g.fillStyle = `rgba(250,220,140,${(1 - k) * 0.9})`;
      const nx = e.x + Math.sin(time * 1.3 + e.id) * 9, ny = e.y - 30 - k * 14;
      g.beginPath(); g.ellipse(nx, ny, 1.8, 1.3, -0.4, 0, Math.PI * 2); g.fill();
      g.fillRect(nx + 1.2, ny - 6, 0.9, 6);
    }
  }
}
function songRadius(s, e) {
  const S = HP4.skald;
  // Same radius as the sim: power comes from perks.
  let power = 0;
  for (const id of e.perks || []) { const p = perkDef(id); if (p && p.stats.power) power += p.stats.power; }
  return S.radius * (1 + S.radiusPerPower * power) * T;
}
function drawIce(g, e, time) {
  const sc = e.scale || 1, w = 11 * sc, h = 15 * sc;
  g.fillStyle = 'rgba(170,225,255,0.42)';
  g.strokeStyle = 'rgba(230,248,255,0.9)'; g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(e.x - w, e.y + 2); g.lineTo(e.x - w * 0.8, e.y - h * 1.5); g.lineTo(e.x - w * 0.1, e.y - h * 1.9);
  g.lineTo(e.x + w * 0.7, e.y - h * 1.6); g.lineTo(e.x + w, e.y + 2); g.closePath();
  g.fill(); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(e.x - w * 0.5, e.y - h * 1.3); g.lineTo(e.x - w * 0.2, e.y - h * 0.4); g.stroke();
  const tw = 0.5 + 0.5 * Math.sin(time * 6 + e.id);
  g.fillStyle = `rgba(255,255,255,${0.5 + 0.5 * tw})`;
  g.fillRect(e.x + w * 0.35, e.y - h * 1.2, 1.6, 1.6);
}
function drawRoots(g, e, time) {
  const sc = e.scale || 1;
  g.strokeStyle = 'rgba(70,130,40,0.95)'; g.lineWidth = 2.2;
  for (let k = 0; k < 5; k++) {
    const a = k * 1.256 + 0.4, r = 10 * sc;
    const sway = Math.sin(time * 3 + k + e.id) * 1.5;
    g.beginPath();
    g.moveTo(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r * 0.4);
    g.quadraticCurveTo(e.x + Math.cos(a) * r * 0.3 + sway, e.y - 12 * sc, e.x + Math.cos(a) * 3, e.y - 6 * sc);
    g.stroke();
  }
  g.fillStyle = 'rgba(140,200,90,0.9)';
  g.beginPath(); g.ellipse(e.x - 5 * sc, e.y - 5 * sc, 2, 1, 0.6, 0, Math.PI * 2); g.fill();
}
function drawChill(g, e) {
  const sc = e.scale || 1;
  g.strokeStyle = 'rgba(170,225,255,0.75)'; g.lineWidth = 1.3;
  g.beginPath(); g.ellipse(e.x, e.y, 9 * sc, 3.6 * sc, 0, 0, Math.PI * 2); g.stroke();
  g.fillStyle = 'rgba(220,245,255,0.85)';
  for (let k = 0; k < 3; k++) g.fillRect(e.x - 6 * sc + k * 6 * sc, e.y - 14 * sc - (k % 2) * 4, 1.5, 1.5);
}

// ---- Event fx (UI layer) -------------------------------------------------------------------------------
function onFx(ctl, ev) {
  if (ev.t !== 'p4dodge' && ev.t !== 'p4freeze' && ev.t !== 'p4coin') return;
  if (!ctl || !ctl.renderer || !ctl.renderer.particles || (ctl.onScreen && !ctl.onScreen(ev.x, ev.y))) return;
  const P = ctl.renderer.particles;
  if (ev.t === 'p4dodge') {
    P.spawn('text', ev.x, ev.y - 20, { vy: -26, life: 0.7, size: 14, text: 'Dodge', color: '#ffd0e0', drag: 0.85 });
  } else if (ev.t === 'p4freeze') {
    P.burst('spark', ev.x, ev.y - 10, 14, { speed: 70, color: ['#e8f8ff', '#9ad8ff', '#ffffff'], life: 0.6, size: 2.4, add: true });
  } else if (ev.t === 'p4coin' && Math.random() < 0.6) {
    P.spawn('text', ev.x + (Math.random() - 0.5) * 6, ev.y - 16, { vy: -22, life: 0.6, size: 14, text: `+${ev.n}`, color: '#f6d15a', drag: 0.85 });
  }
}

// ---- Projectile drawer chain ----------------------------------------------------------------------------
// ART_HOOKS.drawProjectileExt is a plain function slot that several modules wrap (content.js assigns
// the core drawer at boot, military.js re-wraps whatever is on top whenever it is not its own).
// We wrap it as a plain value too, and re-wrap only when a probe call shows our drawer is no longer
// anywhere in the chain. That keeps the chain finite and stable whatever the registration order:
// a getter/setter or re-wrapping whenever we are not on top would make two wrappers call each other
// forever (stack overflow) or grow the chain every frame.
const PROBE = { kind: 'p4probe', x: 0, y: 0, sx: 0, sy: 0, tx: 0, ty: 0, t: 0, dur: 1, arc: 0, dist: 0, z: 0 };
let probeSeen = false;
let mine = null;
function inChain(g) {
  const cur = ART_HOOKS.drawProjectileExt;
  if (!cur) return false;
  if (cur === mine) return true;
  probeSeen = false;
  try { cur(g, PROBE, 0, 0); } catch (err) { /* another drawer choked on the probe: treat as absent */ }
  return probeSeen;
}
function ensureBoltDrawer(g) {
  if (mine && inChain(g)) return;
  const prev = ART_HOOKS.drawProjectileExt;
  mine = (g2, p, x, y) => drawP4Bolt(g2, p, x, y) || (prev ? prev(g2, p, x, y) : false);
  ART_HOOKS.drawProjectileExt = mine;
}
// BUS.draw.world runs right before the renderer draws projectiles.
function drawWorldHook(g) { ensureBoltDrawer(g); }

// ---- Registration ------------------------------------------------------------------------------------------
let done = false;
export function register() {
  if (done) return;
  done = true;
  for (const [k, fn] of Object.entries(HERO_ART_P4)) HERO_ART[k] = fn;
  ensureBoltDrawer(null);
  BUS.draw.world.push(drawWorldHook);
  BUS.draw.overlay.push(drawP4World);
  BUS.fx.push(onFx);
}
