// Fog of war (explored tiles only, never re-hidden) and the light map used
// by combat. Light comes from the Hearth and Braziers.
import { BAL } from '../../data/balance.js';
import { levelStats } from '../../data/buildings.js';
import { N, T, idx, inB, tileOf } from '../grid.js';
import { emit } from './common.js';

export function revealAround(s, x, y, r) {
  const cx = x / T, cy = y / T;
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(N - 1, Math.ceil(cx - 0 + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(N - 1, Math.ceil(cy + r));
  let changed = false;
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    const i = idx(tx, ty);
    if (s.fog[i]) continue;
    const dx = tx + 0.5 - cx, dy = ty + 0.5 - cy;
    if (dx * dx + dy * dy <= r * r) { s.fog[i] = 1; changed = true; }
  }
  if (changed) s.rt.fogDirty = true;
  return changed;
}

export function updateFog(s) {
  s.timers.fog = (s.timers.fog || 0) + 1;
  if (s.timers.fog < BAL.fog.updateEvery) return;
  s.timers.fog = 0;
  const k = s.rt.sightMult || 1;
  for (const b of s.buildings) {
    if (!b.built) continue;
    const st = levelStats(b.type, b.level);
    if (st.sight) revealAround(s, (b.tx + b.size / 2) * T, (b.ty + b.size / 2) * T, (st.sight + b.size / 2) * k);
  }
  for (const v of s.villagers) if (v.alive && v.st !== 'sheltered') revealAround(s, v.x, v.y, BAL.villager.sight * k);
  for (const v of s.soldiers) if (v.alive) revealAround(s, v.x, v.y, 3.5 * k);
  for (const v of s.heroes || []) if (v.alive && !v.away) revealAround(s, v.x, v.y, (v.sight || 5) * k);
  if (s.sovereign && s.sovereign.alive) revealAround(s, s.sovereign.x, s.sovereign.y, 5 * k);
  for (const c of s.caches) {
    if (!c.taken && !c.seen && s.fog[idx(c.tx, c.ty)]) { c.seen = true; emit(s, { t: 'cacheSeen', x: (c.tx + 0.5) * T, y: (c.ty + 0.5) * T }); }
  }
}

export function lightRadiusOf(s, b) {
  if (b.snuffT > 0) return b.type === 'hearth' ? 1.5 : 0; // snuffed by the Hollow King
  const st = levelStats(b.type, b.level);
  if (b.type === 'brazier') return (st.light + s.mods.lightRadius) * (s.mods.lightMult || 1);
  if (b.type === 'hearth') return st.light * (s.mods.lightMult || 1);
  return 0;
}

export function computeLight(s) {
  s.lit.fill(0);
  for (const b of s.buildings) {
    if (!b.built || (b.type !== 'brazier' && b.type !== 'hearth')) continue;
    const r = lightRadiusOf(s, b);
    const cx = b.tx + b.size / 2, cy = b.ty + b.size / 2;
    for (let ty = Math.floor(cy - r); ty <= Math.ceil(cy + r); ty++) for (let tx = Math.floor(cx - r); tx <= Math.ceil(cx + r); tx++) {
      if (!inB(tx, ty)) continue;
      const dx = tx + 0.5 - cx, dy = ty + 0.5 - cy;
      if (dx * dx + dy * dy <= r * r) s.lit[idx(tx, ty)] = 1;
    }
  }
  s.rt.lightDirty = false;
}

export function isLitAt(s, x, y) {
  const tx = tileOf(x), ty = tileOf(y);
  return inB(tx, ty) && s.lit[idx(tx, ty)] === 1;
}
