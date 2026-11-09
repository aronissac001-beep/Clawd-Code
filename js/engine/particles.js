// Pooled visual particles. Purely cosmetic: uses Math.random freely because
// nothing here feeds back into the deterministic simulation.
const MAX = 900;

export class Particles {
  constructor() {
    this.pool = [];
    for (let i = 0; i < MAX; i++) this.pool.push({ on: false });
    this.n = 0; this.cursor = 0;
    this.reduced = false;
  }
  spawn(kind, x, y, o = {}) {
    // Round-robin reuse: when full, the oldest particle is recycled.
    let p = null;
    for (let k = 0; k < MAX; k++) {
      const c = this.pool[(this.cursor + k) % MAX];
      if (!c.on) { p = c; this.cursor = (this.cursor + k + 1) % MAX; break; }
    }
    if (!p) { p = this.pool[this.cursor]; this.cursor = (this.cursor + 1) % MAX; }
    p.on = true; p.kind = kind; p.x = x; p.y = y; p.z = o.z || 0;
    p.vx = o.vx || 0; p.vy = o.vy || 0; p.vz = o.vz || 0; p.g = o.g || 0;
    p.life = 0; p.max = o.life || 1; p.size = o.size || 3; p.color = o.color || '#fff';
    p.text = o.text || ''; p.add = !!o.add; p.spin = o.spin || 0; p.rot = Math.random() * 6.28; p.drag = o.drag ?? 0.9;
    return p;
  }
  burst(kind, x, y, count, o = {}) {
    if (this.reduced) count = Math.ceil(count / 3);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, sp = (o.speed || 40) * (0.4 + Math.random() * 0.8);
      this.spawn(kind, x + (Math.random() - 0.5) * (o.spread || 6), y + (Math.random() - 0.5) * (o.spread || 6), {
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6, vz: o.vz ? o.vz * (0.6 + Math.random() * 0.8) : 0, g: o.g || 0,
        life: (o.life || 0.6) * (0.7 + Math.random() * 0.6), size: (o.size || 3) * (0.7 + Math.random() * 0.6), color: Array.isArray(o.color) ? o.color[(Math.random() * o.color.length) | 0] : o.color, add: o.add, drag: o.drag,
      });
    }
  }
  update(dt) {
    for (const p of this.pool) {
      if (!p.on) continue;
      p.life += dt;
      if (p.life >= p.max) { p.on = false; continue; }
      const d = Math.pow(p.drag, dt * 10);
      p.vx *= d; p.vy *= d;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vz -= p.g * dt; p.z += p.vz * dt;
      if (p.z < 0 && p.g) { p.z = 0; p.vz *= -0.3; p.vx *= 0.6; p.vy *= 0.6; }
      p.rot += p.spin * dt;
    }
  }
  draw(g, additive, view) {
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
          g.font = `800 ${p.size}px system-ui, -apple-system, sans-serif`;
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
  clear() { for (const p of this.pool) p.on = false; }
}
