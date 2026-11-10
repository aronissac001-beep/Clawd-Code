// Combo art (Phase 3): a soft glowing link between the buildings of each active
// combo (golden for good ones, sickly violet for backfires), a faint ring around
// each Fey Grove, and a small icon badge at each combo's centre when zoomed in.
// Also adds a "Combos" section to the info card of a building that is part of one.
// Pure drawing: reads s.ext.combos and never mutates simulation state.
import { BUS } from '../game/hooks.js';
import { T } from '../game/grid.js';
import { COMBOS } from '../data/combos.js';
import { register as registerSim } from '../game/systems/combos.js';
import { icon } from '../ui/icons.js';
import { el } from '../ui/dom.js';

const BACKFIRE = '#a77ad8';
function reduced() { return typeof document !== 'undefined' && !!document.body && document.body.classList.contains('reduce-motion'); }
function zoomOf(g) {
  const c = g.canvas;
  const dpr = c && c.clientWidth ? c.width / c.clientWidth : 1;
  return g.getTransform ? g.getTransform().a / dpr : 1;
}
function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ---- Link geometry (cached per active-list version) ------------------------------------------------
// For each combo: member centres and a minimum spanning tree over them, so a line of
// Braziers reads as a chain and a cluster of Houses as a web rather than a star.
function linkCache(s) {
  const X = s.ext.combos;
  const fx = s.rt.combo;
  const ver = fx ? fx.ver : -1;
  let c = s.rt.comboArt;
  if (c && c.ver === ver && c.X === X) return c;
  const list = [];
  for (const a of (X && X.active) || []) {
    const def = COMBOS[a.id];
    if (!def) continue;
    const pts = [];
    for (const id of a.ids) {
      const b = s.rt.bById.get(id);
      if (b) pts.push([(b.tx + b.size / 2) * T, (b.ty + b.size / 2) * T, b.size]);
    }
    const segs = [];
    if (pts.length > 1) {
      const inT = [0];
      const rest = pts.map((_, i) => i).slice(1);
      while (rest.length) {
        let bi = 0, bj = 0, bd = Infinity;
        for (const i of inT) for (let k = 0; k < rest.length; k++) {
          const j = rest[k];
          const d = (pts[i][0] - pts[j][0]) ** 2 + (pts[i][1] - pts[j][1]) ** 2;
          if (d < bd) { bd = d; bi = i; bj = k; }
        }
        const j = rest.splice(bj, 1)[0];
        segs.push([pts[bi][0], pts[bi][1], pts[j][0], pts[j][1]]);
        inT.push(j);
      }
    } // single-building combos (terrain, boulders) get a halo but no link
    list.push({ a, def, color: def.good ? def.color : BACKFIRE, pts, segs, grove: def.test.kind === 'grove', path: null });
  }
  c = s.rt.comboArt = { ver, X, list };
  return c;
}

// ---- Ground: glowing links and member halos ----------------------------------------------------------
function drawLinks(g, s, view, time) {
  const X = s.ext.combos;
  if (!X || !X.active || !X.active.length) return;
  const c = linkCache(s);
  const rm = reduced();
  g.save();
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (let n = 0; n < c.list.length; n++) {
    const it = c.list[n];
    const a = it.a;
    if (a.cx < view.x0 - 200 || a.cx > view.x1 + 200 || a.cy < view.y0 - 200 || a.cy > view.y1 + 200) continue;
    const pulse = rm ? 1 : 0.78 + 0.22 * Math.sin(time * 2.1 + n * 1.7);
    const col = it.color;
    if (it.grove) {
      const R = 2.1 * T;
      g.fillStyle = rgba(col, 0.07 * pulse);
      g.beginPath(); g.arc(a.cx, a.cy, R, 0, Math.PI * 2); g.fill();
      g.setLineDash([5, 7]); g.lineDashOffset = rm ? 0 : -time * 5;
      g.strokeStyle = rgba(col, 0.55 * pulse); g.lineWidth = 2;
      g.beginPath(); g.arc(a.cx, a.cy, R, 0, Math.PI * 2); g.stroke();
      g.setLineDash([]);
      // A few slow motes over the grove (deterministic from time, purely cosmetic).
      if (!rm) for (let k = 0; k < 5; k++) {
        const ang = time * 0.6 + k * 1.256, rr = R * (0.35 + 0.12 * k);
        const y = a.cy + Math.sin(ang) * rr * 0.6 - 6 - 4 * Math.sin(time * 1.3 + k);
        g.fillStyle = rgba('#eaffc8', 0.5 + 0.3 * Math.sin(time * 3 + k));
        g.beginPath(); g.arc(a.cx + Math.cos(ang) * rr, y, 1.6, 0, Math.PI * 2); g.fill();
      }
      continue;
    }
    // Halos under each member.
    for (const p of it.pts) {
      const r = (p[2] * T) / 2 + 7;
      g.fillStyle = rgba(col, 0.17 * pulse);
      g.beginPath(); g.ellipse(p[0], p[1] + 2, r, r * 0.8, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = rgba(col, 0.55 * pulse); g.lineWidth = 1.8;
      g.beginPath(); g.ellipse(p[0], p[1] + 2, r, r * 0.8, 0, 0, Math.PI * 2); g.stroke();
    }
    if (!it.segs.length) continue;
    // Soft glow: wide faint stroke, a medium one, then a bright thread.
    const backfire = !it.def.good;
    let path = it.path;
    if (backfire && !rm) {
      // A slow wobble for the sickly links (rebuilt each frame; straight links are cached).
      path = new Path2D();
      const w = 5 * Math.sin(time * 1.4 + n);
      for (const sg of it.segs) {
        path.moveTo(sg[0], sg[1]);
        path.quadraticCurveTo((sg[0] + sg[2]) / 2 + w, (sg[1] + sg[3]) / 2 - w, sg[2], sg[3]);
      }
    } else if (!path) {
      path = it.path = new Path2D();
      for (const sg of it.segs) { path.moveTo(sg[0], sg[1]); path.lineTo(sg[2], sg[3]); }
    }
    g.strokeStyle = rgba(col, 0.13 * pulse); g.lineWidth = 12; g.stroke(path);
    g.strokeStyle = rgba(col, 0.28 * pulse); g.lineWidth = 5.5; g.stroke(path);
    if (backfire) { g.setLineDash([6, 6]); g.lineDashOffset = rm ? 0 : -time * 8; }
    g.strokeStyle = rgba(backfire ? '#d6b8ff' : '#fff4cc', 0.85 * pulse); g.lineWidth = 1.6; g.stroke(path);
    g.setLineDash([]);
  }
  g.restore();
}

// ---- Overlay: icon badge at each combo's centre -----------------------------------------------------------
const IMG = new Map();
function iconImage(name, color) {
  const k = name + color;
  let img = IMG.get(k);
  if (img || typeof Image === 'undefined') return img || null;
  const svg = icon(name).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" ')
    .replace('fill="currentColor"', `fill="${color}"`).replace(/currentColor/g, color);
  img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  IMG.set(k, img);
  return img;
}
function drawBadges(g, s, view) {
  const X = s.ext.combos;
  if (!X || !X.active || !X.active.length) return;
  const z = zoomOf(g);
  if (z <= 0.7) return;
  const R = 13 / z;   // 26 px across on screen whatever the zoom
  const c = linkCache(s);
  g.save();
  for (const it of c.list) {
    const a = it.a;
    if (a.cx < view.x0 || a.cx > view.x1 || a.cy < view.y0 || a.cy > view.y1) continue;
    // Sit above single buildings so the badge never hides the roof; at the centroid otherwise.
    const x = a.cx, y = it.pts.length === 1 ? a.cy - (it.pts[0][2] * T) / 2 - R - 10 : a.cy - 8;
    g.fillStyle = 'rgba(32,22,18,0.86)';
    g.beginPath(); g.arc(x, y, R, 0, Math.PI * 2); g.fill();
    g.strokeStyle = it.color; g.lineWidth = 2 / z;
    g.beginPath(); g.arc(x, y, R, 0, Math.PI * 2); g.stroke();
    const img = iconImage(it.def.icon, it.def.good ? '#ffe7a8' : '#d6b8ff');
    if (img && img.complete && img.naturalWidth) g.drawImage(img, x - R * 0.62, y - R * 0.62, R * 1.24, R * 1.24);
  }
  g.restore();
}

// ---- Info card -------------------------------------------------------------------------------------------
function comboCard(box, s, b) {
  const X = s.ext.combos;
  if (!X || !X.active || !b) return;
  const seen = new Set();
  for (const a of X.active) {
    if (!a.ids.includes(b.id) || seen.has(a.id)) continue;
    seen.add(a.id);
    const def = COMBOS[a.id];
    if (!def) continue;
    // Plain spans, not a small element: that would shrink the text below 14px.
    const row = el('div', 'queue', '<b></b> <span></span>');
    row.querySelector('b').textContent = def.good ? def.name : `${def.name} (backfire)`;
    row.querySelector('span').textContent = def.text;
    box.appendChild(row);
  }
}

let done = false;
export function register() {
  if (done) return;
  done = true;
  registerSim();
  BUS.draw.ground.push(drawLinks);
  BUS.draw.overlay.push(drawBadges);
  BUS.card.push(comboCard);
}
