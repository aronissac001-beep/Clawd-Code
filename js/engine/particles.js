// Pooled visual particles (owner C; EMBERCROWN-WORLD.md 7.2 item 1, G19). Purely cosmetic: uses
// Math.random freely because nothing here feeds back into the deterministic simulation.
//
// Every particle is a baked pixel frame from the FX sheet (js/engine/art/fx.js) drawn with drawImage
// at a whole native pixel: no path, arc, ellipse, gradient, filter or font call per frame. Fading is a
// step to a thinner (dithered) frame, growth a step to a bigger one. Floating numbers are glyph frames
// of the same sheet. update() and draw() allocate nothing: the pool is fixed, the tint of a colour is
// resolved once at spawn, and frame lookups are typed-array reads.
//
// Kinds: puff, ember, spark, chip, leaf, petal, flake, mote, drop, splash, ripple (alias ring), puddle,
// foot, text. Options (spawn / burst): z vx vy vz g life size color (a RAMP name, a PAL name or a hex;
// burst also takes an array) text add spin drag, burst: speed spread.
import { fxLayout, fxTint, fxSheet, fxText, tintColours, GLYPH_H } from './art/fx.js';

const MAX = 900;
const NPX = 2; // world units per native pixel (art/pixel.js NPX)
const NONE = Object.freeze({});
const PI4 = Math.PI / 4;

const K = { puff: 1, ember: 2, spark: 3, chip: 4, leaf: 5, ring: 6, ripple: 6, text: 7, petal: 8, flake: 9, mote: 10, drop: 11, splash: 12, puddle: 13, foot: 14 };
// frame indices (filled from the FX layout on first construction)
const F = { puff: new Int16Array(9), sq: new Int16Array(4), star: 0, chip: 0, drop: 0, splash: new Int16Array(3), ripple: new Int16Array(6), rippleFade: 0, rippleRx: new Int16Array([2, 3, 5, 7, 10, 14]),
  leaf: new Int16Array(4), petal: new Int16Array(2), mote: new Int16Array(2), puddle: new Int16Array(6), foot: new Int16Array(6), ready: false };
function frames() {
  if (F.ready) return;
  const ix = fxLayout().index;
  for (let s = 0; s < 3; s++) for (let a = 0; a < 3; a++) F.puff[s * 3 + a] = ix[`puff${s}a${a}`];
  for (let n = 1; n <= 3; n++) F.sq[n] = ix[`sq${n}`];
  F.star = ix.star; F.chip = ix.chip; F.drop = ix.drop; F.rippleFade = ix['ripple-fade'];
  for (let k = 0; k < 3; k++) F.splash[k] = ix[`splash${k}`];
  for (let k = 0; k < 6; k++) F.ripple[k] = ix[`ripple${k}`];
  for (let k = 0; k < 4; k++) F.leaf[k] = ix[`leaf${k}`];
  for (let k = 0; k < 2; k++) { F.petal[k] = ix[`petal${k}`]; F.mote[k] = ix[`mote${k}`]; }
  for (let s = 0; s < 2; s++) for (let a = 0; a < 3; a++) { F.puddle[s * 3 + a] = ix[`puddle${s}a${a}`]; F.foot[s * 3 + a] = ix[`foot${s ? 'R' : 'L'}a${a}`]; }
  F.ready = true;
}
const clampN = (v) => (v < 1.5 ? 1 : v < 2.5 ? 2 : 3);
const fadeStep = (u) => (u < 0.6 ? 0 : u < 0.85 ? 1 : 2);

/** A pool slot with every field present from the start (one hidden class, double fields). */
function slot() {
  return { on: false, kind: '', k: 0, x: 0.5, y: 0.5, z: 0.5, vx: 0.5, vy: 0.5, vz: 0.5, g: 0.5, life: 0.5, max: 1.5, size: 3.5, color: '', tint: 0, text: '', add: false, spin: 0.5, rot: 0.5, drag: 0.9 };
}

export class Particles {
  constructor() {
    frames();
    this.pool = [];
    for (let i = 0; i < MAX; i++) this.pool.push(slot());
    this.n = 0; this.cursor = 0; // n: live particles
    this.reduced = false;
    this.rects = fxLayout().rects;
    this.tint0 = fxTint('pale');
  }
  // A free slot (round-robin from the cursor); when all are live, the oldest is recycled.
  take() {
    let p = null;
    if (this.n < MAX) {
      for (let k = 0; k < MAX; k++) {
        const c = this.pool[(this.cursor + k) % MAX];
        if (!c.on) { p = c; this.cursor = (this.cursor + k + 1) % MAX; break; }
      }
    }
    if (!p) { p = this.pool[this.cursor]; this.cursor = (this.cursor + 1) % MAX; }
    if (!p.on) { p.on = true; this.n++; }
    return p;
  }
  /** The tint id of a colour option (the colour string is resolved once per distinct string). */
  tintOf(color) { return color ? fxTint(color) : this.tint0; }
  spawn(kind, x, y, o = NONE) {
    const p = this.take();
    p.kind = kind; p.k = K[kind] || 3; p.x = x; p.y = y; p.z = o.z || 0;
    p.vx = o.vx || 0; p.vy = o.vy || 0; p.vz = o.vz || 0; p.g = o.g || 0;
    p.life = 0; p.max = o.life || 1; p.size = o.size || 3; p.color = o.color || '';
    p.tint = this.tintOf(o.color);
    p.text = o.text || ''; p.add = !!o.add; p.spin = o.spin || 0; p.rot = Math.random() * 6.28; p.drag = o.drag ?? 0.9;
    return p;
  }
  // Same particles as spawn() with per-particle options, without building an options object each.
  burst(kind, x, y, count, o = NONE) {
    if (this.reduced) count = Math.ceil(count / 3);
    const speed = o.speed || 40, spread = o.spread || 6, life = o.life || 0.6, size = o.size || 3, g = o.g || 0;
    const multi = Array.isArray(o.color), add = !!o.add, drag = o.drag ?? 0.9, k = K[kind] || 3, spin = o.spin || 0;
    const one = multi ? 0 : this.tintOf(o.color);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, sp = speed * (0.4 + Math.random() * 0.8);
      const px = x + (Math.random() - 0.5) * spread, py = y + (Math.random() - 0.5) * spread;
      const vx = Math.cos(a) * sp, vy = Math.sin(a) * sp * 0.6, vz = o.vz ? o.vz * (0.6 + Math.random() * 0.8) : 0;
      const pl = life * (0.7 + Math.random() * 0.6), ps = size * (0.7 + Math.random() * 0.6);
      const color = multi ? o.color[(Math.random() * o.color.length) | 0] : o.color;
      const p = this.take();
      p.kind = kind; p.k = k; p.x = px; p.y = py; p.z = 0;
      p.vx = vx || 0; p.vy = vy || 0; p.vz = vz || 0; p.g = g;
      p.life = 0; p.max = pl || 1; p.size = ps || 3; p.color = color || '';
      p.tint = multi ? this.tintOf(color) : one;
      p.text = ''; p.add = add; p.spin = spin; p.rot = Math.random() * 6.28; p.drag = drag;
    }
  }
  update(dt) {
    // The first frame after a long task can report a negative dt (its timestamp predates the
    // task): ageing particles backwards would step frames backwards.
    if (!(dt > 0) || !this.n) return;
    const pool = this.pool;
    for (let i = 0; i < MAX; i++) {
      const p = pool[i];
      if (!p.on) continue;
      p.life += dt;
      if (p.life >= p.max) { p.on = false; this.n--; continue; }
      const d = Math.pow(p.drag, dt * 10);
      p.vx *= d; p.vy *= d;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vz -= p.g * dt; p.z += p.vz * dt;
      if (p.z < 0 && p.g) { p.z = 0; p.vz *= -0.3; p.vx *= 0.6; p.vy *= 0.6; }
      p.rot += p.spin * dt;
    }
  }
  /** One frame f of a sheet at m canvas px per art px, its anchor at world (x, y) snapped to a whole art pixel. */
  blit(g, sheet, f, x, y, m) {
    const r = this.rects, o = f * 6, w = r[o + 2], h = r[o + 3];
    g.drawImage(sheet, r[o] * m, r[o + 1] * m, w * m, h * m, Math.floor(x / NPX) * NPX - r[o + 4] * NPX, Math.floor(y / NPX) * NPX - r[o + 5] * NPX, w * NPX, h * NPX);
  }
  draw(g, additive, view) {
    if (!this.n) return;
    const pool = this.pool;
    // m: device px per art px of this view (canvas px over the view's world width, times NPX); the sheets
    // are baked at m so that every frame is a 1:1 copy
    const cw = g.canvas ? g.canvas.width : 0, vw = view.x1 - view.x0;
    let m = cw > 0 && vw > 0 ? Math.round((cw / vw) * NPX) : NPX;
    if (m < 1) m = 1;
    let alpha = 1;
    for (let i = 0; i < MAX; i++) {
      const p = pool[i];
      if (!p.on || p.add !== additive) continue;
      if (p.x < view.x0 || p.x > view.x1 || p.y < view.y0 || p.y > view.y1) continue;
      const u = p.life / p.max, y = p.y - p.z;
      let f = -1, sq = 0;
      switch (p.k) {
        case 1: { // puff: grows through three sizes, thins through three dithered alphas
          const r = (p.size * (0.6 + u * 1.4)) / NPX;
          f = F.puff[(r < 2.75 ? 0 : r < 4.25 ? 1 : 2) * 3 + (u < 0.25 ? 0 : u < 0.6 ? 1 : 2)];
          break;
        }
        case 2: sq = clampN((p.size / NPX) * (1 - u * 0.7)); break; // ember: shrinks as it cools
        case 3: { const n = clampN((p.size / NPX) * (1 - u * 0.6)); if (n === 3 && u < 0.4) f = F.star; else sq = n; break; }
        case 4: if (p.size >= 4 && u < 0.7) f = F.chip; else sq = clampN(p.size / NPX); break;
        case 5: { const q = (((p.rot / PI4) % 4) + 4) % 4; f = F.leaf[q | 0]; break; }
        case 8: { const q = (((p.rot / PI4) % 2) + 2) % 2; f = F.petal[q | 0]; break; }
        case 9: if (p.size >= 4) f = F.star; else sq = 1; break; // flake
        case 10: f = F.mote[((p.life * 5 + p.rot) | 0) & 1]; break;
        case 11: f = F.drop; break;
        case 12: { const st = (u * 3) | 0; f = F.splash[st > 2 ? 2 : st]; break; }
        case 6: { // ripple / ring: steps out through the ring sizes, the last one thins away
          const rx = (p.size * (0.2 + u * 0.8)) / NPX, R = F.rippleRx;
          let k = 0; while (k < 5 && R[k + 1] <= rx) k++;
          f = k === 5 && u > 0.8 ? F.rippleFade : F.ripple[k];
          break;
        }
        case 13: f = F.puddle[(p.size >= 10 ? 3 : 0) + fadeStep(u)]; break;
        case 14: f = F.foot[(p.rot > 3.14 ? 3 : 0) + fadeStep(u)]; break;
        case 7: { // floating text: one cached glyph-string canvas; k whole art px per glyph px (7 art px tall at k 1 = 14 world units)
          if (!p.text) break;
          const a = (1 - u) * 2.2, k = p.size >= 21 ? Math.round(p.size / 14) : 1, ga = a < 1 ? a : 1;
          if (ga !== alpha) { g.globalAlpha = ga; alpha = ga; }
          const c = fxText(p.text, p.tint, m * k), w = (c.width / m) * NPX, h = GLYPH_H * NPX * k;
          g.drawImage(c, Math.floor((p.x - w * 0.5) / NPX) * NPX, Math.floor((y - h * 0.5) / NPX) * NPX, w, h);
          continue;
        }
      }
      if (alpha !== 1) { g.globalAlpha = 1; alpha = 1; }
      if (sq) { // the sq frames as rects (cheaper than a copy): body, the lit top-left pixel, the shaded corner
        const t = tintColours(p.tint), x0 = Math.floor(p.x / NPX) * NPX - (sq >> 1) * NPX, y0 = Math.floor(y / NPX) * NPX - (sq >> 1) * NPX;
        if (sq > 1) { g.fillStyle = t[1]; g.fillRect(x0, y0, sq * NPX, sq * NPX); }
        g.fillStyle = t[2]; g.fillRect(x0, y0, NPX, NPX);
        if (sq === 3) { g.fillStyle = t[0]; g.fillRect(x0 + 2 * NPX, y0 + 2 * NPX, NPX, NPX); }
        continue;
      }
      if (f < 0) continue;
      this.blit(g, fxSheet(p.tint, m), f, p.x, y, m);
    }
    if (alpha !== 1) g.globalAlpha = 1;
  }
  clear() { for (const p of this.pool) p.on = false; this.n = 0; }
}
