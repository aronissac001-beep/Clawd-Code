// Projectiles (arrows, ember bolts). Pooled; homing toward a live target and
// resolved on arrival so slow bolts can still miss a fast hound.
import { T } from '../grid.js';
import { hurt, getE, emit } from './common.js';
import { HOOKS } from '../hooks.js';

export function spawnProjectile(s, kind, x, y, target, dmg, type, bonus, speedTiles, arc) {
  const pool = s.rt.projPool || (s.rt.projPool = []);
  const p = pool.pop() || {};
  const d = Math.hypot(target.x - x, target.y - y);
  p.alive = true; p.kind = kind; p.x = x; p.y = y; p.px = x; p.py = y; p.sx = x; p.sy = y;
  p.tid = target.id; p.tx = target.x; p.ty = target.y - 6 - (target.z || 0); p.t = 0;
  p.dur = Math.max(0.12, d / (speedTiles * T)); p.dmg = dmg; p.type = type; p.bonus = bonus || null;
  p.arc = arc || 0; p.z = 0; p.dist = d;
  s.projectiles.push(p);
  return p;
}

export function updateProjectiles(s, dt) {
  const list = s.projectiles;
  let w = 0;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    p.px = p.x; p.py = p.y;
    const t = getE(s, p.tid);
    if (t) { p.tx = t.x; p.ty = t.y - 6 - (t.z || 0); }
    p.t += dt;
    const u = Math.min(1, p.t / p.dur);
    p.x = p.sx + (p.tx - p.sx) * u;
    p.y = p.sy + (p.ty - p.sy) * u;
    p.z = p.arc * p.dist * 0.22 * Math.sin(Math.PI * u);
    if (u >= 1) {
      if (t && Math.hypot(t.x - p.tx, t.y - 6 - (t.z || 0) - p.ty) < 26 + (t.boss ? 20 : 0)) {
        hurt(s, t, p.dmg, p.type, p.bonus, p.sx, p.sy);
        if (p.kind === 'arcane' && HOOKS.onArcaneHit) HOOKS.onArcaneHit(s, p, t);
      }
      emit(s, { t: 'impact', x: p.x, y: p.y, kind: p.kind });
      p.alive = false;
      (s.rt.projPool || (s.rt.projPool = [])).push(p);
      continue;
    }
    list[w++] = p;
  }
  list.length = w;
}
