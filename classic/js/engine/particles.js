// Pooled visual particles. Purely cosmetic: uses Math.random freely because
// nothing here feeds back into the deterministic simulation.
const MAX = 900;
const NONE = Object.freeze({});

export class Particles {
  constructor() {
    this.pool = [];
    for (let i = 0; i < MAX; i++) this.pool.push({ on: false });
    this.n = 0; this.cursor = 0; // n: live particles
    this.reduced = false;
    this.fonts = new Map(); // text size -> CSS font string (built once, not every frame)
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
  spawn(kind, x, y, o = NONE) {
    const p = this.take();
    p.kind = kind; p.x = x; p.y = y; p.z = o.z || 0;
    p.vx = o.vx || 0; p.vy = o.vy || 0; p.vz = o.vz || 0; p.g = o.g || 0;
    p.life = 0; p.max = o.life || 1; p.size = o.size || 3; p.color = o.color || '#fff';
    p.text = o.text || ''; p.add = !!o.add; p.spin = o.spin || 0; p.rot = Math.random() * 6.28; p.drag = o.drag ?? 0.9;
    return p;
  }
  // Same particles as spawn() with per-particle options, without building an options object each.
  burst(kind, x, y, count, o = NONE) {
    if (this.reduced) count = Math.ceil(count / 3);
    const speed = o.speed || 40, spread = o.spread || 6, life = o.life || 0.6, size = o.size || 3, g = o.g || 0;
    const multi = Array.isArray(o.color), add = !!o.add, drag = o.drag ?? 0.9;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, sp = speed * (0.4 + Math.random() * 0.8);
      const px = x + (Math.random() - 0.5) * spread, py = y + (Math.random() - 0.5) * spread;
      const vx = Math.cos(a) * sp, vy = Math.sin(a) * sp * 0.6, vz = o.vz ? o.vz * (0.6 + Math.random() * 0.8) : 0;
      const pl = life * (0.7 + Math.random() * 0.6), ps = size * (0.7 + Math.random() * 0.6);
      const color = multi ? o.color[(Math.random() * o.color.length) | 0] : o.color;
      const p = this.take();
      p.kind = kind; p.x = px; p.y = py; p.z = 0;
      p.vx = vx || 0; p.vy = vy || 0; p.vz = vz || 0; p.g = g;
      p.life = 0; p.max = pl || 1; p.size = ps || 3; p.color = color || '#fff';
      p.text = ''; p.add = add; p.spin = 0; p.rot = Math.random() * 6.28; p.drag = drag;
    }
  }
  update(dt) {
    // The first frame after a long task can report a negative dt (its timestamp predates the
    // task): ageing particles backwards would give puffs a negative radius and throw in draw().
    if (!(dt > 0) || !this.n) return;
    for (const p of this.pool) {
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
  draw(g, additive, view) {
    if (!this.n) return;
    let lastFont = '';
    for (const p of this.pool) {
      if (!p.on || p.add !== additive) continue;
      if (p.x < view.x0 || p.x > view.x1 || p.y < view.y0 || p.y > view.y1) continue;
      const u = p.life / p.max;
      const y = p.y - p.z;
      switch (p.kind) {
        case 'ember': {
          g.globalAlpha = (1 - u) * 0.9;
          g.fillStyle = p.color;
          g.fillRect(p.x - p.size / 2, y - p.size / 2, p.size, p.size);
          break;
        }
        case 'puff': {
          g.globalAlpha = (1 - u) * 0.55;
          g.fillStyle = p.color;
          g.beginPath(); g.arc(p.x, y, p.size * (0.6 + u * 1.4), 0, 6.283); g.fill();
          break;
        }
        case 'chip': case 'spark': {
          g.globalAlpha = 1 - u;
          g.fillStyle = p.color;
          g.fillRect(p.x - p.size / 2, y - p.size / 2, p.size, p.size);
          break;
        }
        case 'leaf': {
          g.globalAlpha = Math.min(1, (1 - u) * 2) * 0.85;
          g.fillStyle = p.color;
          g.save(); g.translate(p.x, y); g.rotate(p.rot);
          g.beginPath(); g.ellipse(0, 0, p.size, p.size * 0.45, 0, 0, 6.283); g.fill();
          g.restore();
          break;
        }
        case 'ring': {
          g.globalAlpha = (1 - u) * 0.9;
          g.strokeStyle = p.color; g.lineWidth = 3 * (1 - u) + 1;
          g.beginPath(); g.ellipse(p.x, y, p.size * (0.2 + u * 0.8), p.size * (0.2 + u * 0.8) * 0.6, 0, 0, 6.283); g.stroke();
          break;
        }
        case 'text': {
          g.globalAlpha = Math.min(1, (1 - u) * 2.2);
          let font = this.fonts.get(p.size);
          if (!font) this.fonts.set(p.size, (font = `800 ${p.size}px system-ui, -apple-system, sans-serif`));
          if (font !== lastFont) { g.font = font; lastFont = font; }
          g.textAlign = 'center';
          g.lineWidth = 3; g.strokeStyle = 'rgba(20,14,10,0.85)';
          g.strokeText(p.text, p.x, y);
          g.fillStyle = p.color; g.fillText(p.text, p.x, y);
          break;
        }
      }
    }
    g.globalAlpha = 1;
  }
  clear() { for (const p of this.pool) p.on = false; this.n = 0; }
}
