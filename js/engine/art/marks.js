// Overlay art (owner D; doc 12.4 overlays and level of detail, 14.6 row D, docs/ART-STYLE.md):
// designation marks, zone tints, blueprints, the strategic pips and the raid blob, as pixel sprites.
// All of it is drawn above the darkness by C's overlay layer, so it always reads; designations at
// 50% alpha (the caller sets globalAlpha).
//
//   markSprite(kind)                      a 16 x 16 px tile sprite: corner brackets and a 7 x 7 glyph
//                                         (mine | chop | harvest | smooth | engrave | prospect | risky | forbid | cancel)
//   drawDesigMark(g, kind, tx, ty, k)     the mark at tile (tx, ty) (g in world units; k is ignored: pixel marks scale with the zoom)
//   zoneSprite(type, edges, i)            a zone tile: a dithered tint plus dashed borders on its open edges (N 1, E 2, S 4, W 8)
//   drawZoneTile(g, type, tx, ty, edges, k, i) / zoneTint(type, i, a)   (the tint colour as rgba, for flat fills)
//   ghostSprite(w, h)                     a blueprint footprint (w x h tiles): dither and a dashed outline
//   pipSprite(o) / drawPip(g, x, y, z, o) the strategic pip: 10 x 10 px drawn at 20 pt (2 device px per pip px at dpr 1, 4 at dpr 2)
//   drawRaidBlob(g, pts, z, n)            a red dithered hull around a raid's members with its count
//   DESIG_MARKS                           [[DESIG bit, kind], ...] in priority order (overlays.js)

import { TILE, DESIG } from '../../game/core/grid.js';
import { ART as REG } from './keys.js';
import { PAL, rgba, dith } from './palette.js';
import { bake, NPX } from './pixel.js';

const T = TILE;
const P = PAL;
export const PIP_PT = 20, PIP_HIT_PT = 44, PIP_PX = 10;
export const DESIG_MARKS = Object.freeze([[DESIG.MINE, 'mine'], [DESIG.CHOP, 'chop'], [DESIG.HARVEST, 'harvest'], [DESIG.SMOOTH, 'smooth'],
  [DESIG.ENGRAVE, 'engrave'], [DESIG.PROSPECT, 'prospect'], [DESIG.RISKY, 'risky'], [DESIG.FORBID, 'forbid']]);
const markColour = (kind) => (REG[`mark.${kind}`] ? REG[`mark.${kind}`].tint : P.bone);

/** 7 x 7 glyphs ('X' = on). */
const GLYPH = {
  mine: ['..XXX..', '.X.X.X.', 'X..X..X', '...X...', '...X...', '...X...', '...X...'],
  chop: ['..X.XX.', '..XXXXX', '..X.XX.', '..X....', '..X....', '..X....', '..X....'],
  harvest: ['..XXX..', '.X...X.', '......X', '......X', '.....X.', '..XXX..', '.X.....'],
  smooth: ['XX..XX.', '..XX..X', '.......', 'XX..XX.', '..XX..X', '.......', 'XX..XX.'],
  engrave: ['...X...', '...X...', 'XXXXXXX', '.XXXXX.', '..XXX..', '.XX.XX.', 'X.....X'],
  prospect: ['.XXX...', 'X...X..', 'X...X..', 'X...X..', '.XXXX..', '.....X.', '......X'],
  risky: ['...X...', '..X.X..', '..XXX..', '.X.X.X.', '.X...X.', 'X..X..X', 'XXXXXXX'],
  forbid: ['..XXX..', '.X...X.', 'X...X.X', 'X..X..X', 'X.X...X', '.X...X.', '..XXX..'],
  cancel: ['X.....X', '.X...X.', '..X.X..', '...X...', '..X.X..', '.X...X.', 'X.....X'],
};
function glyph(p, rows, x, y, c) { for (let j = 0; j < rows.length; j++) for (let i = 0; i < rows[j].length; i++) if (rows[j][i] === 'X') p.px(x + i, y + j, c); }

/** The designation mark of a kind (cached 16 x 16 px tile sprite, outlined in ink). */
export function markSprite(kind) {
  return bake(`mark:${kind}`, 16, 16, 0, 0, (p) => {
    const c = markColour(kind);
    for (const [x, y, dx, dy] of [[1, 1, 1, 1], [14, 1, -1, 1], [1, 14, 1, -1], [14, 14, -1, -1]]) {
      p.px(x, y, c); p.px(x + dx, y, c); p.px(x + dx * 2, y, c); p.px(x, y + dy, c); p.px(x, y + dy * 2, c);
    }
    glyph(p, GLYPH[kind] || GLYPH.cancel, 4, 4, c);
  });
}
/** A designation mark at tile (tx, ty), g in world units. */
export function drawDesigMark(g, kind, tx, ty, k = 1) {
  const sp = markSprite(kind);
  g.drawImage(sp.c, tx * T, ty * T, sp.w, sp.h);
}

// ---- Zones -------------------------------------------------------------------------------------------
const ZONE_CACHE = new Map();
const zoneBase = (type) => (REG[`overlay.${type}`] || REG['overlay.stockpile']).tint;
/** Fill colour of a zone tile as rgba (flat fills, legends); neighbouring zones alternate by id. */
export function zoneTint(type, i = 0, a = 0.28) {
  const key = `${type}:${i & 1}:${a}`;
  let c = ZONE_CACHE.get(key);
  if (!c) { c = rgba(zoneBase(type), i & 1 ? a * 0.75 : a); ZONE_CACHE.set(key, c); }
  return c;
}
/** A zone tile sprite: a dithered tint (two phases for neighbouring zones) and dashed borders on its open edges. */
export function zoneSprite(type, edges = 0, i = 0) {
  return bake(`zone:${type}:${edges & 15}:${i & 1}`, 16, 16, 0, 0, (p) => {
    const c = zoneBase(type);
    if (type === 'dump') { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if ((x + y + (i & 1) * 2) % 4 === 0) p.px(x, y, c); }
    else for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (dith(x + (i & 1) * 2, y, 4)) p.px(x, y, c);
    for (let k = 0; k < 16; k++) {
      if ((k >> 1) & 1) continue; // 2 on, 2 off
      if (edges & 1) p.px(k, 0, c);
      if (edges & 4) p.px(k, 15, c);
      if (edges & 8) p.px(0, k, c);
      if (edges & 2) p.px(15, k, c);
    }
  }, { outline: false });
}
/** A zone tile at (tx, ty) (g in world units). */
export function drawZoneTile(g, type, tx, ty, edges = 0, k = 1, i = 0) {
  const sp = zoneSprite(type, edges, i);
  g.drawImage(sp.c, tx * T, ty * T, sp.w, sp.h);
}

/** A blueprint footprint of w x h tiles: blue dither and a dashed outline. */
export function ghostSprite(w = 1, h = 1) {
  const W = w * 16, Hh = h * 16;
  return bake(`ghost:${w}:${h}`, W, Hh, 0, 0, (p) => {
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) if (dith(x, y, 3)) p.px(x, y, P.shallow);
    for (let x = 0; x < W; x++) if ((x >> 1) & 1) { p.px(x, 0, P.mist); p.px(x, Hh - 1, P.mist); }
    for (let y = 0; y < Hh; y++) if ((y >> 1) & 1) { p.px(0, y, P.mist); p.px(W - 1, y, P.mist); }
  }, { outline: false });
}

/** The support-plan stripe tile: orange diagonal stripes, 2 px wide. */
export function stripeSprite() {
  return bake('stripes', 16, 16, 0, 0, (p) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (((x + y) & 7) < 2) p.px(x, y, P.orange); }, { outline: false });
}
/** A preview tile (stamp, carve, place): green (ok) or red (blocked) dither with a 1 px frame. */
export function previewSprite(ok) {
  return bake(ok ? 'pv:1' : 'pv:0', 16, 16, 0, 0, (p) => {
    const c = ok ? P.moss3 : P.danger, edge = ok ? P.flame : P.peach;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (dith(x, y, 6)) p.px(x, y, c);
    p.hl(1, 1, 14, edge); p.hl(1, 14, 14, edge); p.vl(1, 1, 14, edge); p.vl(14, 1, 14, edge);
  }, { outline: false });
}
/** The order line / route preview: 2 x 2 px dashes marching along the tile centres (world units). */
export function pixelPath(g, path, w, time = 0) {
  const off = (time * 16) % 12;
  let run = 0;
  for (let j = 1; j < path.length; j++) {
    const a = path[j - 1], b = path[j];
    const ax = (a % w + 0.5) * T, ay = (((a / w) | 0) + 0.5) * T, bx = (b % w + 0.5) * T, by = (((b / w) | 0) + 0.5) * T;
    const len = Math.max(Math.abs(bx - ax), Math.abs(by - ay)), n = Math.max(1, Math.round(len / 2));
    for (let k = 0; k < n; k++, run += 2) {
      if ((run + 12 - off) % 12 >= 6) continue;
      const x = Math.round((ax + ((bx - ax) * k) / n) / 2) * 2, y = Math.round((ay + ((by - ay) * k) / n) / 2) * 2;
      g.fillStyle = P.ink; g.fillRect(x - 4, y - 4, 8, 8);
      g.fillStyle = P.flame; g.fillRect(x - 2, y - 2, 4, 4);
    }
  }
}

// ---- Strategic pips --------------------------------------------------------------------------------------
/** 4 x 4 role glyphs (ink inside the pip). */
const ROLE_G = {
  miner: ['XXX.', '.X.X', '.X..', 'X...'], builder: ['.XX.', '.XX.', '.X..', 'X...'], crafter: ['XXXX', 'X..X', 'X..X', '....'],
  hauler: ['XXXX', 'X..X', 'XXXX', '....'], generalist: ['.XX.', 'X..X', 'X..X', '.XX.'],
};
const FILL = { colonist: P.gold, drafted: P.orange, foe: P.danger, beast: P.ember1 };
/**
 * A cached pip sprite (10 x 10 px). o: { kind 'colonist' | 'foe' | 'beast', role, mood 0-100, drafted, job, alert }.
 * The mood ring shows mood in 8 steps.
 */
export function pipSprite(o = {}) {
  const kind = o.kind || 'colonist', col = kind === 'colonist';
  const ms = col ? Math.max(1, Math.min(8, Math.round(((o.mood ?? 60) / 100) * 8))) : 0;
  const badge = !col ? 0 : o.drafted ? 1 : o.alert ? 2 : o.job ? 3 : 0;
  const role = col ? (ROLE_G[o.role] ? o.role : 'generalist') : '';
  return bake(`pip:${kind}:${role}:${ms}:${badge}`, PIP_PX + 2, PIP_PX + 2, (PIP_PX + 2) / 2, (PIP_PX + 2) / 2, (p) => {
    const c = col && o.drafted ? FILL.drafted : FILL[kind] || FILL.colonist;
    p.disc(6, 6, 5, P.ink); p.disc(6, 6, 4, c);
    p.px(4, 3, P.flame === c ? P.bone : P.flame); // the lit top-left
    if (col) {
      const mc = (o.mood ?? 60) >= 60 ? P.moss3 : (o.mood ?? 60) >= 35 ? P.gold : P.danger;
      // the mood ring: the outline ring pixels clockwise from the top, as far as the mood goes
      for (let k = 0; k < 28; k++) {
        const a = -Math.PI / 2 + (k / 28) * Math.PI * 2;
        if (k / 28 >= ms / 8) break;
        p.px(Math.round(6 + Math.cos(a) * 5.2 - 0.5), Math.round(6 + Math.sin(a) * 5.2 - 0.5), mc);
      }
      glyph(p, ROLE_G[role], 4, 4, P.umber0);
      if (badge) { const bc = badge === 1 ? P.danger : badge === 2 ? P.orange : P.shallow; p.rect(8, 0, 4, 4, P.ink); p.rect(9, 1, 2, 2, bc); }
    } else {
      p.ring(6, 6, 3, P.bone);
      if (kind === 'foe') { p.px(5, 5, P.ink); p.px(7, 5, P.ink); p.px(6, 7, P.ink); }
      else { p.px(5, 6, P.ink); p.px(7, 6, P.ink); p.px(6, 5, P.ink); }
    }
  }, { outline: false });
}
/** One pip at world (x, y); its size is constant on screen (z = zoom): PIP_PT points. */
export function drawPip(g, x, y, z, o = {}) {
  const sp = pipSprite(o), k = (PIP_PT / PIP_PX) / z / NPX; // world units per sprite px / NPX
  g.drawImage(sp.c, x - sp.ax * k, y - sp.ay * k, sp.w * k, sp.h * k);
}
/** A raid blob: a red dithered disc around the members' world points (flat [x, y, ...]) with the count. */
export function drawRaidBlob(g, pts, z, n) {
  const k = 1 / z;
  if (!pts || pts.length < 2) return;
  let cx = 0, cy = 0;
  const m = pts.length / 2;
  for (let i = 0; i < pts.length; i += 2) { cx += pts[i]; cy += pts[i + 1]; }
  cx /= m; cy /= m;
  let r = 0;
  for (let i = 0; i < pts.length; i += 2) r = Math.max(r, Math.hypot(pts[i] - cx, pts[i + 1] - cy));
  r += 16 * k;
  const sp = bake('raidhull', 32, 32, 16, 16, (p) => {
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const d = Math.hypot(x + 0.5 - 16, y + 0.5 - 16);
      if (d > 15.5) continue;
      if (d > 14.5) p.px(x, y, P.danger); else if (dith(x, y, 4)) p.px(x, y, P.ember1);
    }
  }, { outline: false });
  g.drawImage(sp.c, cx - r, cy - r, r * 2, r * 2);
  drawPip(g, cx, cy, z, { kind: 'foe' });
  const px = 15 * k;
  g.font = `700 ${px}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 3 * k; g.strokeStyle = P.ink; g.strokeText(String(n ?? m), cx, cy + r * 0.62);
  g.fillStyle = P.bone; g.fillText(String(n ?? m), cx, cy + r * 0.62);
}

/** Kit parts drawn in a 16 x 16 px cell (origin at the cell's top-left) for the contact sheet and KIT_PARTS. */
export const MARK_PARTS = {
  desig: () => {}, // the corner brackets: part of markSprite
  ghost: (p) => { const sp = ghostSprite(1, 1); p.g.drawImage(sp.c, p.ox, p.oy); },
  zonetint: (p, o) => { const sp = zoneSprite(o.type || 'stockpile', 15, 0); p.g.drawImage(sp.c, p.ox, p.oy); },
  pip: (p, o) => { const sp = pipSprite(o); p.g.drawImage(sp.c, p.ox + 2, p.oy + 2); },
  moodring: () => {}, roleglyph: () => {}, foeglyph: () => {}, 'badge.draft': () => {}, count: () => {},
  raidblob: () => {},
};
for (const [, kind] of [...DESIG_MARKS, [0, 'cancel']]) MARK_PARTS[`glyph.${kind}`] = (p) => { const sp = markSprite(kind); p.g.drawImage(sp.c, p.ox, p.oy); };
