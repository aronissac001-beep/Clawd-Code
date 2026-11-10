// Territory art and UI (Phase 3): a soft amber border around the realm's land,
// dashed outlines and claim-cost tags on bordering zones, beast lairs (a dark
// den mound with bones and glowing eyes), beast miniatures merged into
// UNIT_ART, web strands on webbed friendlies, and the zone card opened by
// tapping wild ground. The card never mutates state: it calls ctl.cmd().
import { sprite, flashOf, UNIT_ART, ART } from './sprites.js';
import { BUS } from '../game/hooks.js';
import { T, N, idx, inB } from '../game/grid.js';
import { LAIR_KINDS, BEASTS } from '../data/beasts.js';
import {
  register as registerSim, territoryOf, zoneById, zoneIdAt, borders, lairAlive, claimCost, claimBlock, TERRITORY,
} from '../game/systems/territory.js';
import { el, tapButton, costHtml } from '../ui/dom.js';
import { canAfford } from '../game/systems/common.js';
import { audio } from './audio.js';

const { INK, shadow, poly, rect, rrect, circle, line } = ART;
const UAX = 13, UAY = 28;

// ---- Beast miniatures (26 x 32 unit frames: 0 idle, 1/2 walk, 3 attack) ------------------------
export const BEAST_ART = {
  direwolf(frame) {
    return (g) => {
      shadow(g, UAX, UAY - 1, 10, 2.8);
      const a = frame === 1 ? 2 : frame === 2 ? -2 : 0;
      for (const [x, k] of [[5.5, 1], [8.5, -1], [17, 1], [20, -1]]) line(g, x, 20.5, x + a * k * 0.8, 27.5, '#4f4840', 2.2);
      // tail
      g.strokeStyle = '#6a6156'; g.lineWidth = 2.6; g.beginPath(); g.moveTo(4.5, 17); g.quadraticCurveTo(0, 14 + a, 1, 10 + a); g.stroke();
      // body and shaggy mane
      g.fillStyle = '#7d7468'; g.beginPath(); g.ellipse(12.5, 18, 9.5, 5.2, 0, 0, Math.PI * 2); g.fill(); g.strokeStyle = INK; g.lineWidth = 0.9; g.stroke();
      poly(g, [14, 13, 20.5, 11.5, 22, 19, 16, 22], '#9a9184', INK, 0.8);
      g.fillStyle = '#c9c0b0'; g.beginPath(); g.ellipse(12, 21, 6, 1.6, 0, 0, Math.PI * 2); g.fill();
      for (let i = 0; i < 4; i++) line(g, 8 + i * 2.6, 13.5, 9 + i * 2.6, 11, '#5a5248', 1.1);
      // head, ears, eye, fangs
      const lunge = frame === 3 ? 1.5 : 0;
      poly(g, [19 + lunge, 12, 25.5 + lunge, 13.5, 26 + lunge, 17.5, 19.5 + lunge, 18.5], '#8a8174', INK, 0.8);
      poly(g, [19.5 + lunge, 12.5, 20.5 + lunge, 8, 22.5 + lunge, 12], '#5f574d', INK, 0.6);
      circle(g, 22.6 + lunge, 14.2, 1.05, '#ffd34a', null);
      if (frame === 3) { poly(g, [23 + lunge, 17.5, 26.5 + lunge, 19.5, 23.5 + lunge, 19.5], '#f2ead8', null); }
    };
  },
  spider(frame) {
    return (g) => {
      shadow(g, UAX, UAY - 2, 11, 3, 0.32);
      const a = frame === 1 ? 1.5 : frame === 2 ? -1.5 : 0;
      // eight jointed legs
      g.strokeStyle = '#2d2530'; g.lineWidth = 1.5;
      for (let i = 0; i < 4; i++) {
        const k = (i % 2 ? 1 : -1) * a, y0 = 17 + i * 1.4;
        g.beginPath(); g.moveTo(11, y0); g.lineTo(4 - i * 0.6, y0 - 5 + i * 1.6 + k); g.lineTo(1.5 - i * 0.3, 25 + i * 0.4 - k * 0.5); g.stroke();
        g.beginPath(); g.moveTo(15, y0); g.lineTo(22 + i * 0.6, y0 - 5 + i * 1.6 - k); g.lineTo(24.5 + i * 0.3, 25 + i * 0.4 + k * 0.5); g.stroke();
      }
      // abdomen with a pale mark, then the head
      circle(g, 13, 15, 7, '#4a3e4e', INK, 1);
      circle(g, 11.5, 13, 3.2, '#5f5263', null);
      poly(g, [13, 11, 15, 14, 13, 18, 11, 14], '#c9b88a', null);
      circle(g, 13, 21.5, 3.8, '#3a3040', INK, 0.8);
      for (const [x, y] of [[11.6, 20.6], [14.4, 20.6], [12.4, 22.2], [13.6, 22.2]]) circle(g, x, y, 0.75, '#ff4a3a', null);
      if (frame === 3) { line(g, 11.5, 24.5, 10.5, 27, '#e8e0d0', 1); line(g, 14.5, 24.5, 15.5, 27, '#e8e0d0', 1); }
    };
  },
  troll(frame) {
    return (g) => {
      shadow(g, UAX, UAY - 1, 9.5, 3, 0.35);
      const a = frame === 1 ? 2 : frame === 2 ? -2 : 0;
      rect(g, 8 + a * 0.5, 21, 4, 7, '#55604a', INK, 0.7); rect(g, 14 - a * 0.5, 21, 4, 7, '#55604a', INK, 0.7);
      // hunched, pot-bellied body with a loincloth
      rrect(g, 4.5, 9, 17, 14, 5, '#6f7a5e');
      g.fillStyle = '#8a9474'; g.beginPath(); g.ellipse(13, 17, 5.5, 4.5, 0, 0, Math.PI * 2); g.fill();
      rect(g, 7, 20, 12, 3, '#6b4a2d', null);
      // long arms, small head with tusks
      line(g, 6, 12, 3, 22, '#5f6a50', 3.2);
      circle(g, 13, 7.5, 4.2, '#7c876a', INK, 0.8);
      circle(g, 11.4, 7, 0.8, '#e8f070', null); circle(g, 14.6, 7, 0.8, '#e8f070', null);
      poly(g, [11, 9.5, 11.6, 11.5, 12.2, 9.6], '#f0ead8', null); poly(g, [13.8, 9.6, 14.4, 11.5, 15, 9.5], '#f0ead8', null);
      // stone-headed club
      const up = frame === 3;
      line(g, 20, 16, up ? 24 : 24.5, up ? 4 : 25, '#5e4026', 2.4);
      circle(g, up ? 24 : 24.5, up ? 3.5 : 25.5, 3, '#8f8c88', INK, 0.8);
    };
  },
};

// ---- Lair art -----------------------------------------------------------------------------------
const LW = 92, LH = 70, LAX = 46, LAY = 50; // sprite box; (LAX, LAY) is the den's ground point

function lairSprite(kind, scale) {
  return sprite('lair:' + kind, scale, LW, LH, LAX, LAY, (g) => {
    const cx = LAX, gy = LAY;
    shadow(g, cx, gy + 2, 38, 9, 0.32);
    // Trampled dark earth around the den.
    g.fillStyle = 'rgba(52,40,30,0.55)'; g.beginPath(); g.ellipse(cx, gy + 2, 40, 12, 0, 0, Math.PI * 2); g.fill();
    // The mound.
    const grd = g.createLinearGradient(0, 8, 0, gy + 4);
    grd.addColorStop(0, kind === 'troll' ? '#5d5a50' : '#5a4636'); grd.addColorStop(1, kind === 'troll' ? '#34322c' : '#2e231b');
    g.fillStyle = grd;
    g.beginPath(); g.moveTo(cx - 36, gy + 3);
    g.bezierCurveTo(cx - 34, gy - 22, cx - 16, gy - 38, cx + 2, gy - 37);
    g.bezierCurveTo(cx + 22, gy - 36, cx + 36, gy - 20, cx + 37, gy + 3);
    g.closePath(); g.fill(); g.strokeStyle = INK; g.lineWidth = 1.3; g.stroke();
    // Highlights, roots and grass tufts on the hump.
    g.strokeStyle = 'rgba(255,230,190,0.12)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(cx - 22, gy - 24); g.quadraticCurveTo(cx - 6, gy - 36, cx + 14, gy - 32); g.stroke();
    for (const [x, y] of [[cx - 26, gy - 14], [cx + 24, gy - 18], [cx + 6, gy - 33]]) {
      g.strokeStyle = '#4e6a3a'; g.lineWidth = 1.1;
      g.beginPath(); g.moveTo(x - 2, y); g.lineTo(x - 1, y - 4); g.moveTo(x, y); g.lineTo(x + 0.5, y - 5); g.moveTo(x + 2, y); g.lineTo(x + 2, y - 3.5); g.stroke();
    }
    // Boulders flanking the mouth.
    const big = kind === 'troll' ? 1.45 : 1;
    for (const [x, y, r] of [[cx - 27, gy - 2, 7], [cx + 28, gy - 1, 6], [cx + 16, gy - 26, 4.5]]) {
      const k = r * big;
      poly(g, [x - k, y + 3, x - k * 0.8, y - k * 0.6, x, y - k, x + k * 0.8, y - k * 0.5, x + k, y + 3], '#77736c', INK, 0.9);
      poly(g, [x - k * 0.6, y - k * 0.4, x, y - k * 0.85, x + k * 0.5, y - k * 0.35, x, y - k * 0.05], '#a19c94', null);
    }
    // Cave mouth.
    g.fillStyle = '#3a2c22'; g.beginPath(); g.ellipse(cx, gy - 9, 16, 13, 0, Math.PI, 0); g.lineTo(cx + 16, gy - 1); g.lineTo(cx - 16, gy - 1); g.closePath(); g.fill();
    g.fillStyle = '#0d0909'; g.beginPath(); g.ellipse(cx, gy - 8, 13, 10.5, 0, Math.PI, 0); g.lineTo(cx + 13, gy - 1); g.lineTo(cx - 13, gy - 1); g.closePath(); g.fill();
    // Bones strewn before it.
    const bone = (x, y, a, l) => {
      const dx = Math.cos(a) * l, dy = Math.sin(a) * l * 0.6;
      line(g, x - dx, y - dy, x + dx, y + dy, '#e6dcc6', 2.1);
      circle(g, x - dx, y - dy, 1.4, '#efe6d2', null); circle(g, x + dx, y + dy, 1.4, '#efe6d2', null);
    };
    bone(cx - 20, gy + 6, 0.4, 5); bone(cx - 14, gy + 8, -0.9, 4); bone(cx + 19, gy + 7, 2.6, 5); bone(cx + 9, gy + 9, 0.2, 3.5);
    // A small skull.
    circle(g, cx + 26, gy + 6, 3.4, '#ece3cd', INK, 0.7); rect(g, cx + 24, gy + 7.5, 4, 2.4, '#ece3cd', null);
    circle(g, cx + 24.9, gy + 5.6, 0.9, '#2a1e18', null); circle(g, cx + 27.1, gy + 5.6, 0.9, '#2a1e18', null);
    if (kind === 'wolves') {
      // Gnawed ribcage.
      g.strokeStyle = '#ddd2ba'; g.lineWidth = 1.4;
      for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(cx - 28, gy + 9, 3 + i * 1.6, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); }
    } else if (kind === 'spiders') {
      // Web strands over the mouth and pale egg sacs.
      g.strokeStyle = 'rgba(236,236,246,0.75)'; g.lineWidth = 0.7;
      const ox = cx, oy = gy - 10;
      for (let i = 0; i < 7; i++) { const a = Math.PI + (i / 6) * Math.PI; g.beginPath(); g.moveTo(ox, oy); g.lineTo(ox + Math.cos(a) * 17, oy + Math.sin(a) * 14 + 9); g.stroke(); }
      for (let k = 1; k <= 3; k++) { g.beginPath(); g.ellipse(ox, oy + 2, k * 5, k * 4, 0, Math.PI * 1.02, Math.PI * 1.98); g.stroke(); }
      for (const [x, y] of [[cx - 30, gy - 8], [cx - 25, gy - 12], [cx + 30, gy - 9]]) circle(g, x, y, 2.6, '#efe9dc', 'rgba(120,110,100,0.6)', 0.6);
    } else if (kind === 'troll') {
      // A leaning club and a crude ring of stakes.
      line(g, cx + 20, gy - 2, cx + 31, gy - 22, '#5e4026', 3);
      circle(g, cx + 31.5, gy - 23, 4, '#8f8c88', INK, 0.8);
      for (let i = 0; i < 5; i++) { const x = cx - 34 + i * 5; line(g, x, gy + 4, x + 1, gy - 6 - (i % 2) * 2, '#6b4a2d', 1.8); }
    }
  });
}

// Hit flash from health drops (the sim never ticks a stationary foe's hitT). Cosmetic only.
const hitSeen = new Map();
function hitFlash(e, time) {
  let m = hitSeen.get(e.id);
  if (!m) { if (hitSeen.size > 24) hitSeen.clear(); m = { hp: e.hp, at: -9 }; hitSeen.set(e.id, m); }
  if (e.hp < m.hp - 0.01) m.at = time;
  m.hp = e.hp;
  const k = 1 - (time - m.at) / 0.14;
  return k > 0 && k <= 1 ? k : 0;
}

/** BUS.draw.entity.lair */
export function drawLair(g, e, x, y, time, scale) {
  const kind = e.lairKind || 'wolves';
  const sp = lairSprite(kind, scale);
  g.drawImage(sp.c, x - sp.ax, y - sp.ay, sp.w, sp.h);
  const f = hitFlash(e, time);
  if (f > 0) {
    const fl = flashOf(sp, 'lair:' + kind, scale);
    g.globalAlpha = f * 0.7; g.drawImage(fl.c, x - sp.ax, y - sp.ay, sp.w, sp.h); g.globalAlpha = 1;
  }
}

const EYES = { wolves: ['255,206,80', 3], spiders: ['255,70,60', 4], troll: ['200,240,90', 2] };
// Glowing eyes in the den mouth, drawn after the lighting pass so they read at night.
function drawLairEyes(g, s, view, time) {
  for (const e of s.enemies) {
    if (e.type !== 'lair' || !e.alive) continue;
    if (e.x < view.x0 || e.x > view.x1 || e.y < view.y0 || e.y > view.y1) continue;
    const [rgb, pairs] = EYES[e.lairKind] || EYES.wolves;
    const night = s.cycle.phase === 'night' || s.cycle.phase === 'dusk';
    for (let k = 0; k < pairs; k++) {
      // Each pair blinks on its own slow rhythm.
      const ph = (time * (0.35 + k * 0.11) + e.id * 0.37 + k * 0.29) % 1;
      if (ph > 0.93) continue;
      const ex = e.x - 7 + ((k * 7) % 15), ey = e.y - 12 + ((k * 5) % 6) - (k === 1 ? 3 : 0);
      const a = (night ? 0.95 : 0.7) * (0.75 + 0.25 * Math.sin(time * 3 + k));
      g.fillStyle = `rgba(${rgb},${a})`;
      g.beginPath(); g.ellipse(ex - 1.8, ey, 1.2, 0.9, 0, 0, 6.283); g.ellipse(ex + 1.8, ey, 1.2, 0.9, 0, 0, 6.283); g.fill();
      if (night) { g.fillStyle = `rgba(${rgb},0.18)`; g.beginPath(); g.ellipse(ex, ey, 6, 3.5, 0, 0, 6.283); g.fill(); }
    }
  }
}

// ---- Borders --------------------------------------------------------------------------------------
// Directed edges with land on the right, chained into closed loops, then drawn
// with rounded corners (quadratic curves through edge midpoints).
function loopsOf(inSet) {
  const edges = []; // [x0, y0, x1, y1]
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!inSet(x, y)) continue;
    if (!inSet(x, y - 1)) edges.push([x, y, x + 1, y]);
    if (!inSet(x + 1, y)) edges.push([x + 1, y, x + 1, y + 1]);
    if (!inSet(x, y + 1)) edges.push([x + 1, y + 1, x, y + 1]);
    if (!inSet(x - 1, y)) edges.push([x, y + 1, x, y]);
  }
  const from = new Map();
  edges.forEach((e, i) => { const k = e[1] * (N + 1) + e[0]; (from.get(k) || from.set(k, []).get(k)).push(i); });
  const used = new Uint8Array(edges.length);
  const loops = [];
  for (let i = 0; i < edges.length; i++) {
    if (used[i]) continue;
    const pts = [];
    let j = i;
    while (j >= 0 && !used[j]) {
      used[j] = 1;
      const e = edges[j];
      pts.push(e[0], e[1]);
      const list = from.get(e[3] * (N + 1) + e[2]) || [];
      j = -1;
      for (const c of list) if (!used[c]) { j = c; break; }
    }
    if (pts.length >= 6) loops.push(pts);
  }
  return loops;
}
function smoothPath(loops) {
  const p = new Path2D();
  for (const pts of loops) {
    const n = pts.length / 2;
    const mx = (i) => ((pts[(i % n) * 2] + pts[((i + 1) % n) * 2]) / 2) * T;
    const my = (i) => ((pts[(i % n) * 2 + 1] + pts[((i + 1) % n) * 2 + 1]) / 2) * T;
    p.moveTo(mx(0), my(0));
    for (let i = 1; i <= n; i++) p.quadraticCurveTo(pts[(i % n) * 2] * T, pts[(i % n) * 2 + 1] * T, mx(i), my(i));
    p.closePath();
  }
  return p;
}

function borderCache(s) {
  const X = territoryOf(s);
  let c = s.rt.terrArt;
  if (c && c.ver === X.ver && c.X === X) return c;
  const own = (x, y) => inB(x, y) && X.zones[X.grid[idx(x, y)] - 1].owned;
  const owned = smoothPath(loopsOf(own));
  // Bordering zones: dashed outline except where they meet the realm's own border.
  const open = new Path2D(), held = new Path2D();
  const tags = [];
  for (const z of X.zones) {
    if (z.owned || !borders(s, z)) continue;
    const p = lairAlive(s, z) ? held : open;
    tags.push(z.id);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (X.grid[idx(x, y)] !== z.id) continue;
      const side = (nx, ny) => { if (!inB(nx, ny)) return false; const o = X.grid[idx(nx, ny)]; return o !== z.id && !X.zones[o - 1].owned; };
      if (side(x, y - 1)) { p.moveTo(x * T, y * T); p.lineTo((x + 1) * T, y * T); }
      if (side(x + 1, y)) { p.moveTo((x + 1) * T, y * T); p.lineTo((x + 1) * T, (y + 1) * T); }
      if (side(x, y + 1)) { p.moveTo(x * T, (y + 1) * T); p.lineTo((x + 1) * T, (y + 1) * T); }
      if (side(x - 1, y)) { p.moveTo(x * T, y * T); p.lineTo(x * T, (y + 1) * T); }
    }
  }
  c = s.rt.terrArt = { ver: X.ver, X, owned, open, held, tags };
  return c;
}

function drawBorders(g, s, view, time) {
  const X = territoryOf(s);
  if (!X || typeof Path2D === 'undefined') return;
  const c = borderCache(s);
  g.save();
  g.lineJoin = 'round'; g.lineCap = 'round';
  // Faint warmth over the realm's land, then a layered glow along its edge.
  g.fillStyle = 'rgba(255,190,90,0.05)'; g.fill(c.owned, 'evenodd');
  const pulse = 0.85 + 0.15 * Math.sin(time * 1.6);
  g.strokeStyle = `rgba(255,160,50,${0.16 * pulse})`; g.lineWidth = 12; g.stroke(c.owned);
  g.strokeStyle = `rgba(255,185,80,${0.32 * pulse})`; g.lineWidth = 6; g.stroke(c.owned);
  g.strokeStyle = 'rgba(255,224,150,0.9)'; g.lineWidth = 1.8; g.stroke(c.owned);
  g.restore();
}

// Bordering zones: faint dashed outlines, drawn above the fog because they are usually half
// explored (red where a lair still holds the land).
function drawClaimable(g, s, view, time) {
  const X = territoryOf(s);
  if (!X || typeof Path2D === 'undefined') return;
  const c = borderCache(s);
  g.save();
  g.lineCap = 'round';
  g.setLineDash([7, 7]); g.lineDashOffset = -time * 6;
  g.lineWidth = 1.6;
  g.strokeStyle = 'rgba(255,232,180,0.45)'; g.stroke(c.open);
  g.strokeStyle = 'rgba(225,90,70,0.55)'; g.stroke(c.held);
  g.setLineDash([]);
  g.restore();
}

// Claim-cost tags at each bordering zone's centre (readable size on screen).
function drawTags(g, s, view) {
  const X = territoryOf(s);
  if (!X) return;
  const dpr = g.canvas && g.canvas.clientWidth ? g.canvas.width / g.canvas.clientWidth : 1;
  const z = g.getTransform ? g.getTransform().a / dpr : 1;
  if (z <= 0.7) return;
  const c = borderCache(s);
  const k = 1 / z; // world units per screen px
  g.save();
  g.font = `800 ${15 * k}px system-ui, -apple-system, sans-serif`;
  g.textBaseline = 'middle'; g.textAlign = 'left';
  for (const id of c.tags) {
    const zn = X.zones[id - 1];
    const x = (zn.cx + 0.5) * T, y = (zn.cy + 0.5) * T;
    if (x < view.x0 || x > view.x1 || y < view.y0 || y > view.y1) continue;
    const lair = lairAlive(s, zn);
    const block = lair ? 'Lair' : claimBlock(s, zn);
    const cost = claimCost(s, zn);
    const ok = !block && canAfford(s.res, cost);
    const parts = lair ? [['Lair', '#ff9a86', null]] : [[String(cost.food), ok ? '#fbe9d0' : '#ff9a86', 'food'], [String(cost.gold), ok ? '#fbe9d0' : '#ff9a86', 'gold']];
    if (!lair && block) parts.push(['locked', '#d8c8b0', null]);
    let w = 12 * k;
    for (const [t, , dot] of parts) w += g.measureText(t).width + (dot ? 15 * k : 0) + 8 * k;
    const h = 26 * k, x0 = x - w / 2, y0 = y - h / 2;
    g.fillStyle = lair ? 'rgba(48,18,16,0.82)' : 'rgba(30,22,18,0.8)';
    g.strokeStyle = lair ? 'rgba(225,90,70,0.9)' : ok ? 'rgba(255,214,130,0.95)' : 'rgba(200,170,120,0.6)';
    g.lineWidth = 1.5 * k;
    g.beginPath(); g.roundRect ? g.roundRect(x0, y0, w, h, 9 * k) : g.rect(x0, y0, w, h); g.fill(); g.stroke();
    let cx = x0 + 10 * k;
    for (const [t, col, dot] of parts) {
      if (dot === 'food') {
        // A wheat ear: stem and four grains.
        g.strokeStyle = '#e8c24a'; g.lineWidth = 1.4 * k;
        g.beginPath(); g.moveTo(cx + 5 * k, y + 7 * k); g.lineTo(cx + 5 * k, y - 6 * k); g.stroke();
        g.fillStyle = '#e8c24a';
        for (const [dx, dy] of [[-2.2, -3.5], [2.2, -3.5], [-2.2, 0.5], [2.2, 0.5]]) { g.beginPath(); g.ellipse(cx + (5 + dx) * k, y + dy * k, 1.8 * k, 2.6 * k, dx * 0.2, 0, 6.283); g.fill(); }
        cx += 14 * k;
      } else if (dot === 'gold') {
        g.fillStyle = '#f0c040'; g.beginPath(); g.arc(cx + 5 * k, y, 5.5 * k, 0, 6.283); g.fill();
        g.strokeStyle = '#7a5310'; g.lineWidth = 1.2 * k; g.beginPath(); g.arc(cx + 5 * k, y, 3.4 * k, 0, 6.283); g.stroke();
        cx += 15 * k;
      }
      g.fillStyle = col; g.fillText(t, cx, y + 1 * k);
      cx += g.measureText(t).width + 8 * k;
    }
  }
  g.restore();
}

// Sticky strands on friendlies a Giant Spider has bitten.
function drawWebs(g, s) {
  const X = territoryOf(s);
  if (!X || !X.webbed.length) return;
  g.save();
  g.strokeStyle = 'rgba(240,240,250,0.8)'; g.lineWidth = 0.8;
  for (const id of X.webbed) {
    const e = s.rt.eById.get(id);
    if (!e || !e.alive) continue;
    const x = e.x, y = e.y - 9;
    g.beginPath();
    for (let i = 0; i < 4; i++) { const a = i * 0.785 + 0.3; g.moveTo(x - Math.cos(a) * 8, y - Math.sin(a) * 7); g.lineTo(x + Math.cos(a) * 8, y + Math.sin(a) * 7); }
    g.stroke();
    g.beginPath(); g.ellipse(x, y, 5, 4, 0, 0, 6.283); g.stroke();
  }
  g.restore();
}

// ---- Zone card (UI) ---------------------------------------------------------------------------------
function zoneCardSig(s, z) {
  const cost = claimCost(s, z);
  return [z.id, z.owned, lairAlive(s, z), claimBlock(s, z) || '', canAfford(s.res, cost), cost.food, cost.gold, z.forest, z.rock].join('|');
}

export function openZoneCard(ctl, zid) {
  const s = ctl.s;
  const z = zoneById(s, zid);
  if (!z) return false;
  const X = territoryOf(s);
  const lair = lairAlive(s, z);
  const kind = z.lairKind ? LAIR_KINDS[z.lairKind] : null;
  const guards = lair ? s.enemies.filter((e) => e.alive && e.lairId === z.lair).length : 0;
  const near = borders(s, z);
  const lines = [];
  if (lair) lines.push(`A ${kind ? kind.name : 'beast lair'} holds this land${guards ? `, guarded by ${guards} beast${guards > 1 ? 's' : ''}` : ''}. Destroy the den (order a squad to attack it, or mark it with a bounty) before you can claim the zone. It holds plunder.`);
  else if (z.lair && z.cleared) lines.push('The lair here has been destroyed. The land lies open.');
  if (near) lines.push(`This land borders your realm. Claim it to build here; your soldiers, heroes and the Sovereign fight ${Math.round((TERRITORY.homeDmg - 1) * 100)}% harder on your own land.`);
  if (z.half) lines.push(`Your home lacks ${z.halfWhy === 'rock' ? 'stone' : 'timber'} within reach, so this zone can be claimed at half price.`);
  const ref = { title: z.name, sub: `Wild land · ${z.tiles} tiles${near ? ' · borders your realm' : ''}`, text: lines, ic: 'map' };
  ctl.card.open('text', ref);
  openRef = ref; openZone = z.id;
  const box = ctl.card.box;
  const holder = el('div', 'zone-card');
  holder.dataset.zone = String(z.id);
  holder.dataset.sig = zoneCardSig(s, z);
  const lairTxt = lair ? `${kind ? kind.name : 'Lair'} (${guards})` : z.lair ? 'Cleared' : 'None';
  const cost = claimCost(s, z);
  const block = claimBlock(s, z);
  const afford = canAfford(s.res, cost);
  const row = el('div', 'row');
  row.style.marginTop = '2px';
  const btn = el('button', 'cbtn gold' + (block || !afford ? ' disabled' : ''), `<span>Claim</span> ${costHtml(cost, s.res)}`);
  btn.setAttribute('aria-label', `Claim ${z.name}`);
  tapButton(btn, () => {
    const why = claimBlock(ctl.s, z);
    if (why) { ctl.toast(why + '.', 'bad'); audio.play('error'); return; }
    const r = ctl.cmd({ t: 'claimZone', zone: z.id });
    if (r && r.ok) ctl.closeCard(); else openZoneCard(ctl, z.id); // the sim's 'sfx' coin event plays the sound
  }, { sound: null });
  row.appendChild(btn);
  holder.appendChild(row);
  // Reason line at 14px (a <small> would shrink it below the 14px minimum).
  const why = block ? block + '.' : !afford ? 'Not enough food or gold yet.' : '';
  if (why) { const p = holder.appendChild(el('p', '')); p.style.fontSize = '14px'; p.style.color = 'var(--parch-dim)'; p.textContent = why; }
  // The Claim button sits right under the title so it is reachable without scrolling on a
  // short landscape screen; the explanation and the zone's numbers follow.
  const sub = box.querySelector('.sub');
  if (sub && sub.nextSibling) box.insertBefore(holder, sub.nextSibling); else box.appendChild(holder);
  box.appendChild(el('div', 'stats', [['Trees', z.forest], ['Rock', z.rock], ['Lair', lairTxt], ['Claims so far', X.claims]].map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('')));
  return true;
}

function tapTile(ctl, tx, ty) {
  const s = ctl.s;
  if (!territoryOf(s) || !inB(tx, ty)) return false;
  const zid = zoneIdAt(s, tx, ty);
  const z = zoneById(s, zid);
  if (!z || z.owned) return false;
  if (ctl.select) ctl.select(null);
  return openZoneCard(ctl, zid);
}

// Keeps an open zone card current as resources, lairs and ownership change. Any command re-renders
// the card's base text (InfoCard.update(s, true)), so the zone section is restored right away.
let openRef = null, openZone = 0;
function cardRefresher(hud, ctl) {
  let t = 0;
  return {
    update(s, dt) {
      if (!ctl.card || ctl.card.kind !== 'text' || ctl.card.ref !== openRef) return;
      const holder = ctl.card.box.querySelector('.zone-card');
      if (!holder) { openZoneCard(ctl, openZone); return; }
      t += dt;
      if (t < 0.4) return;
      t = 0;
      const z = zoneById(s, +holder.dataset.zone);
      if (!z || z.owned) { ctl.card.close(); return; }
      if (zoneCardSig(s, z) !== holder.dataset.sig) openZoneCard(ctl, z.id);
    },
  };
}

// ---- Registration -------------------------------------------------------------------------------------
let done = false;
export function register() {
  if (done) return;
  done = true;
  registerSim();
  for (const id of Object.keys(BEASTS)) if (BEAST_ART[id]) UNIT_ART[id] = BEAST_ART[id];
  BUS.draw.entity.lair = drawLair;
  BUS.draw.ground.push(drawBorders);
  BUS.draw.world.push(drawWebs);
  BUS.draw.overlay.push(drawClaimable, drawLairEyes, drawTags);
  BUS.tapTile.push(tapTile);
  BUS.hud.push(cardRefresher);
}
