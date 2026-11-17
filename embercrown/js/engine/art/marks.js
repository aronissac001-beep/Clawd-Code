// Overlay art (owner D; doc 12.4 overlays and level of detail, 14.6 row D): designation marks,
// zone tints and the strategic pips. All of it is drawn above the darkness by C's overlay layer, so
// it always reads; designations at 50% alpha (the caller sets globalAlpha).
//
//   drawDesigMark(g, kind, tx, ty, k)     kind: mine | chop | harvest | smooth | engrave | prospect | risky | forbid | cancel;
//                                         k = 1 / zoom (line widths stay >= 2 px on screen)
//   DESIG_MARKS                           [bit, kind] in drawing order (grid.js DESIG bits)
//   zoneTint(type, i)                     fill colour of a zone tile (type: stockpile | growzone | dump; i: zone id)
//   drawZoneTile(g, type, tx, ty, edges, k, i)   tint plus the border on the open edges (N 1, E 2, S 4, W 8)
//   drawPip(g, x, y, z, o)                a constant-screen-size pip (20 pt disc) at world (x, y) for zoom z;
//                                         o: { kind: 'colonist' | 'foe' | 'beast', role, mood (0-100), drafted, alert, job }
//   drawRaidBlob(g, pts, z, n)            the red hull around a raid's members, with the count
//   PIP_PT, PIP_HIT_PT                    20 pt disc, 44 pt hit area
//   MARK_PARTS                            kit parts (desig, ghost, zonetint, pip, ...) for the sheet and the KIT_PARTS check
// Text drawn here (the raid count) is >= 14 px on screen.

import { TILE, DESIG } from '../../game/core/grid.js';
import { ART as Hlp } from '../sprites.js';
import { ART as REG } from './keys.js';

const T = TILE;
const TAU = Math.PI * 2;
export const PIP_PT = 20, PIP_HIT_PT = 44;
export const DESIG_MARKS = Object.freeze([[DESIG.MINE, 'mine'], [DESIG.CHOP, 'chop'], [DESIG.HARVEST, 'harvest'], [DESIG.SMOOTH, 'smooth'],
  [DESIG.ENGRAVE, 'engrave'], [DESIG.PROSPECT, 'prospect'], [DESIG.RISKY, 'risky'], [DESIG.FORBID, 'forbid']]);
const markColour = (kind) => (REG[`mark.${kind}`] ? REG[`mark.${kind}`].tint : '#ffffff');

/** Corner brackets in the kind's colour with its glyph in the middle. g in world units. */
export function drawDesigMark(g, kind, tx, ty, k = 1) {
  const bx = tx * T + 3, by = ty * T + 3, s = T - 6, c = 7, col = markColour(kind);
  const lw = Math.max(2, 2 * k);
  // dark under-stroke so the mark reads on pale stone and on snow
  for (const pass of [0, 1]) {
    g.strokeStyle = pass ? col : 'rgba(10,8,6,0.75)'; g.lineWidth = pass ? lw : lw + 1.6 * k;
    g.beginPath();
    g.moveTo(bx, by + c); g.lineTo(bx, by); g.lineTo(bx + c, by);
    g.moveTo(bx + s - c, by); g.lineTo(bx + s, by); g.lineTo(bx + s, by + c);
    g.moveTo(bx + s, by + s - c); g.lineTo(bx + s, by + s); g.lineTo(bx + s - c, by + s);
    g.moveTo(bx + c, by + s); g.lineTo(bx, by + s); g.lineTo(bx, by + s - c);
    g.stroke();
    glyph(g, kind, tx * T + T / 2, ty * T + T / 2, pass ? col : 'rgba(10,8,6,0.75)', pass ? lw * 0.75 : lw * 0.75 + 1.6 * k);
  }
}
/** The kind's glyph centred at (x, y), about 12 units across. */
function glyph(g, kind, x, y, col, lw) {
  g.strokeStyle = col; g.fillStyle = col; g.lineWidth = lw; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath();
  switch (kind) {
    case 'mine': g.moveTo(x - 5, y - 2); g.quadraticCurveTo(x, y - 7, x + 5, y - 2); g.moveTo(x, y - 4.5); g.lineTo(x - 3, y + 6); break; // pick
    case 'chop': g.moveTo(x - 4, y + 6); g.lineTo(x + 2, y - 5); g.moveTo(x + 1, y - 6); g.lineTo(x + 6, y - 2); g.lineTo(x + 3, y + 1); break; // axe
    case 'harvest': g.arc(x, y + 1, 5, Math.PI * 1.1, Math.PI * 0.15); g.moveTo(x + 4.5, y + 3); g.lineTo(x + 2, y + 7); break; // sickle
    case 'smooth': for (const d of [-4, 0, 4]) { g.moveTo(x - 6, y + d); g.quadraticCurveTo(x - 3, y + d - 2.5, x, y + d); g.quadraticCurveTo(x + 3, y + d + 2.5, x + 6, y + d); } break;
    case 'engrave': for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5; const px = x + Math.cos(a) * 6, py = y + Math.sin(a) * 6; if (i) g.lineTo(px, py); else g.moveTo(px, py); } g.closePath(); break;
    case 'prospect': g.arc(x - 1.5, y - 1.5, 4, 0, TAU); g.moveTo(x + 1.5, y + 1.5); g.lineTo(x + 6, y + 6); break; // lens
    case 'risky': g.moveTo(x, y - 6); g.lineTo(x + 6.5, y + 5); g.lineTo(x - 6.5, y + 5); g.closePath(); g.moveTo(x, y - 2); g.lineTo(x, y + 1.5); break;
    case 'forbid': g.arc(x, y, 6, 0, TAU); g.moveTo(x - 4.2, y + 4.2); g.lineTo(x + 4.2, y - 4.2); break;
    case 'cancel': g.moveTo(x - 5, y - 5); g.lineTo(x + 5, y + 5); g.moveTo(x + 5, y - 5); g.lineTo(x - 5, y + 5); break;
    default: g.arc(x, y, 2, 0, TAU); break;
  }
  g.stroke();
}

// ---- Zones -----------------------------------------------------------------------------------------
const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };
const ZONE_CACHE = new Map();
/** Fill colour of a zone tile; neighbouring zones of one type alternate two shades by id so their edges read. */
export function zoneTint(type, i = 0, a = 0.28) {
  const key = `${type}:${i & 1}:${a}`;
  let c = ZONE_CACHE.get(key);
  if (!c) {
    const base = (REG[`overlay.${type}`] || REG['overlay.stockpile']).tint;
    c = hexA(i & 1 ? shadeHex(base, -0.18) : base, a);
    ZONE_CACHE.set(key, c);
  }
  return c;
}
function shadeHex(hex, f) { const n = parseInt(hex.slice(1), 16); const s = (v) => Math.max(0, Math.min(255, Math.round(v * (1 + f)))); return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => s(v).toString(16).padStart(2, '0')).join(''); }
/** A zone tile: the tint plus a dashed border on its open edges (N 1, E 2, S 4, W 8) and, for a dump, hatching. */
export function drawZoneTile(g, type, tx, ty, edges = 0, k = 1, i = 0) {
  const bx = tx * T, by = ty * T;
  g.fillStyle = zoneTint(type, i); g.fillRect(bx, by, T, T);
  if (type === 'dump') {
    g.save(); g.beginPath(); g.rect(bx, by, T, T); g.clip();
    g.strokeStyle = zoneTint(type, i, 0.45); g.lineWidth = 2 * k; g.beginPath();
    for (let d = -T; d < T; d += 10) { g.moveTo(bx + d, by); g.lineTo(bx + d + T, by + T); }
    g.stroke(); g.restore();
  }
  if (!edges) return;
  const base = (REG[`overlay.${type}`] || REG['overlay.stockpile']).tint;
  g.strokeStyle = hexA(base, 0.9); g.lineWidth = Math.max(1.5, 2 * k);
  g.setLineDash([6 * k, 4 * k]);
  g.beginPath();
  if (edges & 1) { g.moveTo(bx, by + 1); g.lineTo(bx + T, by + 1); }
  if (edges & 2) { g.moveTo(bx + T - 1, by); g.lineTo(bx + T - 1, by + T); }
  if (edges & 4) { g.moveTo(bx, by + T - 1); g.lineTo(bx + T, by + T - 1); }
  if (edges & 8) { g.moveTo(bx + 1, by); g.lineTo(bx + 1, by + T); }
  g.stroke(); g.setLineDash([]);
}

// ---- Strategic pips --------------------------------------------------------------------------------
const ROLE_GLYPH = {
  miner: (g, r) => { g.moveTo(-r * 0.6, -r * 0.2); g.quadraticCurveTo(0, -r * 0.8, r * 0.6, -r * 0.2); g.moveTo(0, -r * 0.5); g.lineTo(-r * 0.3, r * 0.6); },
  builder: (g, r) => { g.moveTo(-r * 0.5, r * 0.55); g.lineTo(r * 0.25, -r * 0.2); g.moveTo(-r * 0.05, -r * 0.5); g.lineTo(r * 0.55, r * 0.05); },
  crafter: (g, r) => { g.moveTo(-r * 0.6, r * 0.1); g.lineTo(r * 0.6, r * 0.1); g.moveTo(-r * 0.4, r * 0.1); g.lineTo(-r * 0.4, r * 0.6); g.moveTo(r * 0.4, r * 0.1); g.lineTo(r * 0.4, r * 0.6); g.moveTo(-r * 0.2, -r * 0.5); g.lineTo(r * 0.3, -r * 0.1); },
  hauler: (g, r) => { g.rect(-r * 0.5, -r * 0.35, r, r * 0.8); g.moveTo(-r * 0.5, r * 0.05); g.lineTo(r * 0.5, r * 0.05); },
  generalist: (g, r) => { g.arc(0, 0, r * 0.45, 0, TAU); },
};
/** One pip at world (x, y); its size is constant on screen (z = zoom). */
export function drawPip(g, x, y, z, o = {}) {
  const k = 1 / z, r = (PIP_PT / 2) * k, kind = o.kind || 'colonist';
  const fill = kind === 'foe' ? '#c8506a' : kind === 'beast' ? '#d0704a' : o.drafted ? '#e0904a' : '#e8c06a';
  g.fillStyle = 'rgba(10,8,6,0.6)'; g.beginPath(); g.arc(x, y + 1.5 * k, r + 2 * k, 0, TAU); g.fill();
  g.fillStyle = fill; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  if (kind === 'colonist') {
    // mood ring: green to amber to red, an arc proportional to mood
    const m = Math.max(0, Math.min(100, o.mood ?? 60));
    const mc = m >= 60 ? '#7ad06a' : m >= 35 ? '#e8c04a' : '#e85a4a';
    g.strokeStyle = 'rgba(10,8,6,0.55)'; g.lineWidth = 3 * k; g.beginPath(); g.arc(x, y, r - 0.5 * k, 0, TAU); g.stroke();
    g.strokeStyle = mc; g.lineWidth = 2.4 * k; g.beginPath(); g.arc(x, y, r - 0.5 * k, -Math.PI / 2, -Math.PI / 2 + TAU * (m / 100)); g.stroke();
    // role glyph
    g.save(); g.translate(x, y); g.strokeStyle = '#3a2a1a'; g.lineWidth = 2 * k; g.lineCap = 'round'; g.beginPath();
    (ROLE_GLYPH[o.role] || ROLE_GLYPH.generalist)(g, r * 0.95); g.stroke(); g.restore();
    if (o.drafted) badge(g, x + r * 0.8, y - r * 0.8, k, '#a3242b', 'sword');
    else if (o.alert) badge(g, x + r * 0.8, y - r * 0.8, k, '#e85a4a', 'alert');
    else if (o.job) badge(g, x + r * 0.8, y - r * 0.8, k, '#4a6a8a', 'job');
  } else {
    g.strokeStyle = '#ffd0d8'; g.lineWidth = 2 * k; g.beginPath(); g.arc(x, y, r - 1 * k, 0, TAU); g.stroke();
    // a fanged chevron for foes, a paw for beasts
    g.fillStyle = '#3a1218'; g.beginPath();
    if (kind === 'foe') { g.moveTo(x - r * 0.5, y - r * 0.3); g.lineTo(x, y + r * 0.45); g.lineTo(x + r * 0.5, y - r * 0.3); g.lineTo(x + r * 0.2, y - r * 0.3); g.lineTo(x, y + r * 0.05); g.lineTo(x - r * 0.2, y - r * 0.3); g.closePath(); }
    else { g.arc(x, y + r * 0.15, r * 0.3, 0, TAU); for (const a of [-0.5, -0.17, 0.17, 0.5]) { g.moveTo(x + Math.sin(a * 2) * r * 0.5 + r * 0.14, y - r * 0.35); g.arc(x + Math.sin(a * 2) * r * 0.5, y - r * 0.35, r * 0.14, 0, TAU); } }
    g.fill();
  }
}
function badge(g, x, y, k, col, kind) {
  const r = 5.5 * k;
  g.fillStyle = 'rgba(10,8,6,0.7)'; g.beginPath(); g.arc(x, y, r + 1.2 * k, 0, TAU); g.fill();
  g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  g.strokeStyle = '#fff4e0'; g.lineWidth = 1.4 * k; g.beginPath();
  if (kind === 'sword') { g.moveTo(x - r * 0.5, y + r * 0.5); g.lineTo(x + r * 0.5, y - r * 0.5); g.moveTo(x - r * 0.45, y - r * 0.05); g.lineTo(x + r * 0.05, y + r * 0.45); }
  else if (kind === 'alert') { g.moveTo(x, y - r * 0.55); g.lineTo(x, y + r * 0.1); g.moveTo(x, y + r * 0.45); g.lineTo(x, y + r * 0.5); }
  else { g.arc(x, y, r * 0.35, 0, TAU); }
  g.stroke();
}
/** A raid blob: a translucent red hull around the members' world points (flat [x, y, ...]) with the count. */
export function drawRaidBlob(g, pts, z, n) {
  const k = 1 / z;
  if (!pts || pts.length < 2) return;
  let cx = 0, cy = 0, m = pts.length / 2;
  for (let i = 0; i < pts.length; i += 2) { cx += pts[i]; cy += pts[i + 1]; }
  cx /= m; cy /= m;
  let r = 0;
  for (let i = 0; i < pts.length; i += 2) r = Math.max(r, Math.hypot(pts[i] - cx, pts[i + 1] - cy));
  r += 16 * k;
  g.fillStyle = 'rgba(200,60,80,0.28)'; g.strokeStyle = 'rgba(255,120,130,0.9)'; g.lineWidth = 2.5 * k;
  g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill(); g.stroke();
  drawPip(g, cx, cy, z, { kind: 'foe' });
  const px = Math.max(14, 15) * k;
  g.font = `700 ${px}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 3 * k; g.strokeStyle = 'rgba(10,8,6,0.85)'; g.strokeText(String(n ?? m), cx, cy + r * 0.62);
  g.fillStyle = '#fff0f0'; g.fillText(String(n ?? m), cx, cy + r * 0.62);
}

/** Kit parts drawn in a 32 x 32 cell (origin at the cell's top-left) for the contact sheet. */
export const MARK_PARTS = {
  desig: () => {}, // the corner brackets: drawn with the glyph by drawDesigMark
  ghost: (g, o) => { g.fillStyle = 'rgba(120,190,255,0.22)'; g.fillRect(0, 0, o.W || T, o.H || T); g.strokeStyle = 'rgba(160,210,255,0.85)'; g.lineWidth = 1.5; g.setLineDash([5, 4]); g.strokeRect(1, 1, (o.W || T) - 2, (o.H || T) - 2); g.setLineDash([]); },
  zonetint: (g, o) => drawZoneTile(g, o.type || 'stockpile', 0, 0, 15, 1, 0),
  pip: (g, o) => drawPip(g, T / 2, T / 2, 1, o),
  moodring: () => {}, roleglyph: () => {}, foeglyph: () => {}, 'badge.draft': () => {}, count: () => {},
  raidblob: (g) => drawRaidBlob(g, [8, 10, 22, 12, 14, 22], 1.6, 3),
};
for (const [, kind] of [...DESIG_MARKS, [0, 'cancel']]) MARK_PARTS[`glyph.${kind}`] = (g) => drawDesigMark(g, kind, 0, 0, 1);
