// Light layer (owner C; doc 12.4 "Light and darkness"). The sim light map s.rt.light (B,
// js/game/world/light.js, Uint8 0-3) is the ONLY light model: this file has none of its own. It keeps
// one texture at cfg.lightPxPerTile px per tile that combines fog, roof darkness, the ambient day
// level and per-tile light, and draws it scaled over the world (smoothing per cfg.lightSmoothing).
//   - An open tile's pixels take its own level: max(ambient under its roof, rt.light).
//   - A wall or rock tile's pixels take the level of the open neighbour ON THAT PIXEL'S SIDE, so a
//     rock wall between a lit tunnel and a dark one is lit on one face only, and light never shows
//     through rock. Interior rock (no open neighbour) is dark.
//   - Unexplored open tiles (fog bit 0) are fog.
// Updates: changed tiles (light, fog, roof, terrain or wall state diffed against shadow copies when
// s.tick moves, plus markTile from the terrain patch queue) and their 4 neighbours; a full rebuild
// when the quantised ambient level changes (day-phase ticks) or on setState.
// Flames flicker by modulating the alpha of their own tiles (the cfg.flickerFlames nearest).
// Hollow emissive rims (SP.EMIS) are drawn after the darkness, as in the roguelite.

import { TILE, W, H, N, TER_OPAQUE, ROOF, getBit } from '../../game/core/grid.js';
import { hourOf, minuteOf, seasonOf } from '../../game/core/time.js';
import * as SP from '../sprites.js';

const T = TILE;
/** Darkness alpha at light level 0, 1, 2, 3 (S2: readable 1-tile tunnels at level 1). */
export const DARK_ALPHA = [236, 172, 108, 0];
const NIGHT_RGB = [10, 12, 34], UNDER_RGB = [9, 8, 14], FOG_RGB = [23, 21, 31], FOG_A = 245;
const AMB_STEPS = 8; // ambient is quantised so a full rebuild happens a few times per dusk and dawn
/** Light level of a rock body with no open face (under a rock roof): dim, so unexplored massif reads as rock and unlit tunnels as darker grooves. */
export const ROCK_BODY = 1;

/** Ambient level 0-3 of open sky at this tick: 3 by day, NIGHT_AMB at night, eased through dawn and dusk. */
export const NIGHT_AMB = 0.85;
export function ambientOf(tick) {
  const h = hourOf(tick) + minuteOf(tick) / 60, cold = seasonOf(tick) === 3;
  const dawn0 = cold ? 6 : 5, night0 = cold ? 20 : 21;
  let u; // 1 = day, 0 = night
  if (h >= night0 || h < dawn0) u = 0;
  else if (h < dawn0 + 2) u = (h - dawn0) / 2;
  else if (h >= night0 - 2) u = (night0 - h) / 2;
  else u = 1;
  u = u * u * (3 - 2 * u);
  return NIGHT_AMB + (3 - NIGHT_AMB) * u;
}
/** Ambient under a roof: built roofs let some light in by day, rock roofs none. */
const roofAmb = (roof, sky) => (roof === ROOF.OPEN ? sky : roof === ROOF.BUILT ? Math.min(sky, 1.6) : 0);

function alphaOf(lv) {
  if (lv >= 3) return 0;
  if (lv <= 0) return DARK_ALPHA[0];
  const k = lv | 0, f = lv - k;
  return Math.round(DARK_ALPHA[k] + (DARK_ALPHA[k + 1] - DARK_ALPHA[k]) * f);
}

export class LightLayer {
  constructor(cfg) {
    this.cfg = cfg;
    this.c = null; this.g = null; this.img = null;
    this.ppt = cfg.lightPxPerTile;
    this.s = null;
    this.amb = -1; this.ambOverride = null;
    this.prev = null;          // shadow copies for the diff
    this.dirty = [];           // tiles to refresh
    this.dirtyMark = null;     // Uint8Array(N) de-dupe
    this.flames = [];          // tile indexes of flames (set by the entity layer each frame)
    this.flickerNext = 0; this.flickerOn = [];
    this.isWall = null;        // (s, i) -> bool for built walls / closed doors (set by index.js)
    this.under = false;
    this.st = { full: 0, tiles: 0, lastMs: 0 };
  }

  setState(s, opts = {}) {
    this.s = s;
    this.ppt = opts.ppt || this.cfg.lightPxPerTile;
    if (!this.c) { this.c = document.createElement('canvas'); this.g = this.c.getContext('2d'); }
    const cw = W * this.ppt, ch = H * this.ppt;
    if (this.c.width !== cw || this.c.height !== ch) { this.c.width = cw; this.c.height = ch; }
    this.img = this.g.createImageData(cw, ch);
    this.base = new Uint8Array(cw * ch); // alpha before flicker
    this.dirtyMark = new Uint8Array(N);
    this.prev = { light: new Uint8Array(N), roof: new Uint8Array(N), ter: new Uint8Array(N), fog: new Uint8Array(s.L.fog.length), wall: new Uint8Array(N), tick: -1 };
    this.amb = -1;
    this.flickerOn.length = 0;
  }
  /** Force the ambient sky level (debug scenes); null returns to the clock. */
  setAmbient(v) { this.ambOverride = v; this.amb = -1; }
  markTile(i) { if (this.dirtyMark && !this.dirtyMark[i]) { this.dirtyMark[i] = 1; this.dirty.push(i); } }
  markAll() { this.amb = -1; }

  levelOpen(s, i, sky) {
    const L = s.L, lt = s.rt.light ? s.rt.light[i] : 0, a = roofAmb(L.roof[i], sky);
    return lt > a ? lt : a;
  }
  opaque(s, i) { return TER_OPAQUE[s.L.terrain[i]] === 1 || (this.isWall ? this.isWall(s, i) : false); }

  /** Level of open tile j seen from a neighbour: >= 0 its level, -1 blocked (opaque or off the map), -2 fog. Sets this.under. */
  sideLevel(s, nx, ny, sky) {
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) return -1;
    const j = ny * W + nx;
    if (this.opaque(s, j)) return -1;
    if (!getBit(s.L.fog, j)) return -2;
    this.under = s.L.roof[j] !== ROOF.OPEN;
    return this.levelOpen(s, j, sky);
  }
  put(x, y, px, py, rgb, a) {
    const ppt = this.ppt, p = (y * ppt + py) * W * ppt + x * ppt + px, o = p * 4, d = this.img.data;
    d[o] = rgb[0]; d[o + 1] = rgb[1]; d[o + 2] = rgb[2]; d[o + 3] = a; this.base[p] = a;
  }
  /** Write the pixels of tile i into img/base. */
  writeTile(s, i, sky) {
    const ppt = this.ppt, x = i % W, y = (i / W) | 0, L = s.L;
    if (!this.opaque(s, i)) {
      let rgb, a;
      if (!getBit(L.fog, i)) { rgb = FOG_RGB; a = FOG_A; }
      else { a = alphaOf(this.levelOpen(s, i, sky)); rgb = L.roof[i] === ROOF.OPEN ? NIGHT_RGB : UNDER_RGB; }
      for (let py = 0; py < ppt; py++) for (let px = 0; px < ppt; px++) this.put(x, y, px, py, rgb, a);
      return;
    }
    // Wall / rock: each pixel takes the open neighbour on its own side (vertical, then horizontal).
    // With no open neighbour on that side it shows its own body: walls under the sky take the sky,
    // rock under a rock roof the dim ROCK_BODY level (the massif reads as dark rock, not as void).
    const half = ppt / 2;
    const own = L.roof[i] === ROOF.OPEN ? sky : ROCK_BODY, ownRGB = L.roof[i] === ROOF.OPEN ? NIGHT_RGB : UNDER_RGB;
    for (let py = 0; py < ppt; py++) for (let px = 0; px < ppt; px++) {
      const sx = px < half ? -1 : 1, sy = py < half ? -1 : 1;
      let lv = this.sideLevel(s, x, y + sy, sky), under = this.under;
      const h = this.sideLevel(s, x + sx, y, sky);
      if (h > lv) { lv = h; under = this.under; } else if (h === -2 && lv === -1) lv = -2;
      if (lv >= 0) this.put(x, y, px, py, under ? UNDER_RGB : NIGHT_RGB, alphaOf(lv));
      else if (lv === -2) this.put(x, y, px, py, FOG_RGB, FOG_A);
      else this.put(x, y, px, py, ownRGB, alphaOf(own));
    }
  }

  /** Bring the texture up to date with s (cheap when nothing changed). */
  update(s) {
    const t0 = performance.now();
    const sky = this.ambOverride !== null ? this.ambOverride : ambientOf(s.tick);
    const q = Math.round(sky * AMB_STEPS) / AMB_STEPS;
    const P = this.prev, L = s.L, light = s.rt.light;
    if (q !== this.amb) {
      this.amb = q;
      for (let i = 0; i < N; i++) this.writeTile(s, i, q);
      P.light.set(light || P.light.fill(0)); P.roof.set(L.roof); P.ter.set(L.terrain); P.fog.set(L.fog);
      if (this.isWall) for (let i = 0; i < N; i++) P.wall[i] = this.isWall(s, i) ? 1 : 0;
      P.tick = s.tick;
      this.dirty.length = 0; this.dirtyMark.fill(0);
      this.g.putImageData(this.img, 0, 0);
      this.st.full++; this.st.lastMs = performance.now() - t0;
      return true;
    }
    if (P.tick !== s.tick) { // diff the inputs once per tick (about 0.1 ms at 128)
      P.tick = s.tick;
      const occ = s.rt.occ, iw = this.isWall;
      for (let i = 0; i < N; i++) {
        const lw = iw && ((occ && occ[i] >= 0) || P.wall[i]) ? (iw(s, i) ? 1 : 0) : 0;
        if ((light && light[i] !== P.light[i]) || L.roof[i] !== P.roof[i] || L.terrain[i] !== P.ter[i] || lw !== P.wall[i]) {
          if (light) P.light[i] = light[i];
          P.roof[i] = L.roof[i]; P.ter[i] = L.terrain[i]; P.wall[i] = lw;
          this.markTile(i);
        }
      }
      for (let k = 0; k < L.fog.length; k++) if (L.fog[k] !== P.fog[k]) {
        for (let b = 0; b < 8; b++) { const i = k * 8 + b; if (i < N) this.markTile(i); }
        P.fog[k] = L.fog[k];
      }
    }
    if (!this.dirty.length) return false;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    const list = this.dirty;
    for (let k = 0; k < list.length; k++) this.dirtyMark[list[k]] = 0;
    const touch = (i) => { this.writeTile(s, i, q); const x = i % W, y = (i / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
    for (let k = 0; k < list.length; k++) {
      const i = list[k], x = i % W, y = (i / W) | 0;
      touch(i);
      if (x > 0) touch(i - 1); if (x < W - 1) touch(i + 1); if (y > 0) touch(i - W); if (y < H - 1) touch(i + W);
    }
    this.st.tiles += list.length;
    list.length = 0;
    const ppt = this.ppt;
    this.g.putImageData(this.img, 0, 0, x0 * ppt, y0 * ppt, (x1 - x0 + 1) * ppt, (y1 - y0 + 1) * ppt);
    this.st.lastMs = performance.now() - t0;
    return true;
  }

  /** Flame flicker: alpha modulation of the tiles of the nearest flames (render time only). */
  flicker(time, camX, camY, reduceMotion) {
    if (!this.img) return;
    const ppt = this.ppt, cw = W * ppt, d = this.img.data, base = this.base;
    // Restore the tiles flickered last time.
    const restore = () => {
      for (const i of this.flickerOn) {
        const x = i % W, y = (i / W) | 0;
        for (let py = 0; py < ppt; py++) for (let px = 0; px < ppt; px++) { const p = (y * ppt + py) * cw + x * ppt + px; d[p * 4 + 3] = base[p]; }
        this.g.putImageData(this.img, 0, 0, x * ppt, y * ppt, ppt, ppt);
      }
      this.flickerOn.length = 0;
    };
    if (reduceMotion || !this.flames.length) { if (this.flickerOn.length) restore(); return; }
    if (time < this.flickerNext) return;
    this.flickerNext = time + 1 / this.cfg.flickerHz;
    restore();
    const f = this.flames;
    const ctx = camX / T, cty = camY / T;
    const near = f.length <= this.cfg.flickerFlames ? f : f.slice().sort((a, b) => {
      const ax = (a % W) - ctx, ay = ((a / W) | 0) - cty, bx = (b % W) - ctx, by = ((b / W) | 0) - cty;
      return ax * ax + ay * ay - (bx * bx + by * by) || a - b;
    }).slice(0, this.cfg.flickerFlames);
    for (const c of near) {
      const cx = c % W, cy = (c / W) | 0;
      const k = 0.88 + 0.12 * Math.sin(time * 11 + cx * 1.7) * Math.sin(time * 7.3 + cy);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = y * W + x;
        // darker when the flame dips: alpha moves toward the level-0 darkness by (1 - k)
        for (let py = 0; py < ppt; py++) for (let px = 0; px < ppt; px++) {
          const p = (y * ppt + py) * cw + x * ppt + px, a = base[p];
          d[p * 4 + 3] = Math.min(255, a + ((DARK_ALPHA[0] - a) * (1 - k) * 0.6) | 0);
        }
        this.flickerOn.push(i);
        this.g.putImageData(this.img, 0, 0, x * ppt, y * ppt, ppt, ppt);
      }
    }
  }

  /** Draw the visible part of the texture over the world (g in world transform). */
  draw(g, view, smooth) {
    if (!this.c) return;
    const ppt = this.ppt;
    const tx0 = Math.max(0, Math.floor(view.x0 / T) - 1), ty0 = Math.max(0, Math.floor(view.y0 / T) - 1);
    const tx1 = Math.min(W, Math.ceil(view.x1 / T) + 1), ty1 = Math.min(H, Math.ceil(view.y1 / T) + 1);
    if (tx1 <= tx0 || ty1 <= ty0) return;
    const sm = g.imageSmoothingEnabled;
    g.imageSmoothingEnabled = smooth;
    g.drawImage(this.c, tx0 * ppt, ty0 * ppt, (tx1 - tx0) * ppt, (ty1 - ty0) * ppt, tx0 * T, ty0 * T, (tx1 - tx0) * T, (ty1 - ty0) * T);
    g.imageSmoothingEnabled = sm;
  }

  /** Hollow rims and eyes, after the darkness so they are never darkened (roguelite drawEmissive). */
  drawEmissive(g, view, sky) {
    const E = SP.EMIS;
    if (!E.length) return;
    const a = Math.min(1, 0.2 + 0.8 * Math.max(0, (3 - sky) / (3 - NIGHT_AMB)));
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = a;
    for (let i = 0; i < E.length; i += SP.EMIS_N) {
      const rim = E[i + 1], dx = E[i + 2], dy = E[i + 3], k = E[i + 6];
      if (dx > view.x1 || dy > view.y1 || dx + E[i + 4] < view.x0 || dy + E[i + 5] < view.y0) continue;
      g.drawImage(rim.c, dx - k, dy - k, rim.w * k, rim.h * k);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }
}
