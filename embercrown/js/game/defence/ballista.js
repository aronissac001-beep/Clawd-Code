// Ballista (doc 7.7): an operated siege weapon. Owner H. Stage 2 (the emberthrower is Hold, Stage 3).
//
// A finished ballista is worked by a drafted colonist standing beside its footprint (the lowest id
// there). Every BALLISTA.every ticks it looses a heavy bolt at the nearest active foe within
// BALLISTA.range tiles of its centre in line of sight (ties by foe id): BALLISTA.dmg stab, and the bolt
// flies on through every other foe within one tile of its line up to the range (it pierces), each
// taking BALLISTA.pierceDmg. A hit rolls the operator's Archery (55% + 3% a level); the operator gains
// Archery XP. Nothing is saved but the building: the cadence is (tick + 7 x building id) % every.

import { W, tileOfW, cheb } from '../core/grid.js';
import { nextU32 } from '../core/rand.js';
import { SIDE, footprint } from '../world/pass.js';
import { losClear } from '../systems/pathing.js';
import { awardXp, level } from '../people/skills.js';
import { stage2 } from '../people/defs.js';
import { damageFoe, raidById } from '../threat/raiders.js';
import { COMBAT } from '../threat/stats.js';

export const ENGINE_DEFS = Object.freeze(['ballista', 'emberthrower']);
export const BALLISTA = Object.freeze({ every: 60, range: 14, dmg: 30, pierceDmg: 18 });
const TW = 32;
const live = (s, f) => { if (f.st && f.st.down) return false; const r = raidById(s, f.raid); return !!r && r.stage === 'active'; };

/** The operator of ballista b: a drafted, standing colonist beside it (lowest id), or null. */
export function operatorOf(s, b) {
  const fp = footprint(s, b);
  for (const c of s.col) {
    if (!c.drafted || c.hp.dead || c.hp.down) continue;
    const x = tileOfW(c.x), y = tileOfW(c.y);
    if (fp.some((i) => cheb(x, y, i % W, (i / W) | 0) <= 1)) return c;
  }
  return null;
}
/** Distance (world units) from point p to the segment a-b. */
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  const x = ax + t * dx - px, y = ay + t * dy - py;
  return Math.sqrt(x * x + y * y);
}
/** Fire one ballista now if it can. Returns the foes hit (ids). */
export function fireBallista(s, b) {
  const op = operatorOf(s, b);
  if (!op) return [];
  const cx = (b.x + 1) * TW, cy = (b.y + 1) * TW, R = BALLISTA.range * TW;
  let best = null, bd = Infinity;
  for (const f of s.foes) {
    if (!live(s, f)) continue;
    const d = (f.x - cx) ** 2 + (f.y - cy) ** 2;
    if (d > R * R || d >= bd || !losClear(s, cx, cy, f.x, f.y, SIDE.HOS)) continue;
    bd = d; best = f;
  }
  if (!best) return [];
  awardXp(s, op, 'archery', COMBAT.xpPerSwing);
  if (nextU32(s, 'combat') % 100 >= Math.min(COMBAT.hitMaxPct, COMBAT.rangedHitPct + COMBAT.hitPerLvlPct * level(op, 'archery'))) return [];
  const dist = Math.sqrt(bd) || 1, ex = cx + ((best.x - cx) * R) / dist, ey = cy + ((best.y - cy) * R) / dist;
  const hit = [best.id];
  const others = s.foes.filter((f) => f !== best && live(s, f) && segDist(f.x, f.y, cx, cy, ex, ey) <= TW);
  damageFoe(s, best, BALLISTA.dmg, 'stab', op);
  for (const f of others) { if (s.foes.includes(f)) { damageFoe(s, f, BALLISTA.pierceDmg, 'stab', op); hit.push(f.id); } }
  return hit;
}
/** Tick system (slot 'defence'). */
export function ballistaSystem(s) {
  if (!stage2() || !s.foes.length) return;
  for (const b of s.bld) {
    if (!b || b.def !== 'ballista' || b.st !== 'done') continue;
    if ((s.tick + 7 * b.id) % BALLISTA.every !== 0) continue;
    fireBallista(s, b);
  }
}
