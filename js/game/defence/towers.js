// Watchtowers, archer platforms and stone towers, cover and early warning (doc 7.7, 9.4, 9.5).
// Owner H. Stage 2.
//
// A finished tower (flag 'tower': tower, platform, stonetower; the ballista has its own module) is
// manned by a drafted colonist standing beside its footprint (Chebyshev 1): at most the def's `cap`
// defenders at once, by colonist id. A manned tower gives its defender the def's `dmg.range` mod in
// tiles (+3 for a watchtower), halves ranged hits on them, and lends a bow to one who has none
// (fight.js TOWER_BOW).
// Cover: a colonist beside a barricade, an embrasure or a wall takes ranged hits x COMBAT.coverPct.
// Early warning (9.4): every finished tower facing the threat's edge (its centre in that half of the
// map) adds its `warn.edge` mod (watchtower +2 h, stone tower +3 h) when the colony has a soldier to
// keep the watch; a finished signal beacon adds its `warn.all` (+6 h) for every edge. The storyteller
// adds these to the lead when it schedules a hostile incident (never past THREAT.maxWarnH).

import { W, H, tileOfW, cheb } from '../core/grid.js';
import { footprint } from '../world/pass.js';
import { structDef, hasFlag } from '../world/defs.js';
import { COMBAT } from '../threat/stats.js';
import { onPerch } from './vertical.js';

export const TOWER_DEFS = Object.freeze(['tower', 'platform', 'stonetower']);
export const isTower = (b) => !!b && b.st === 'done' && TOWER_DEFS.includes(b.def);
/** Done towers, by id. */
export function towers(s) { const out = []; for (const b of s.bld) if (isTower(b)) out.push(b); return out; }
const modOf = (d, key) => { let v = 0; for (const m of (d && d.mods) || []) if (m.key === key && m.op === 'add') v += m.value | 0; return v; };

/** Is colonist c beside building b's footprint? */
function beside(s, c, b) {
  const x = tileOfW(c.x), y = tileOfW(c.y);
  const P = W * H;
  for (const i of footprint(s, b)) if (((i / P) | 0) === (c.z | 0) && cheb(x, y, i % W, ((i % P) / W) | 0) <= 1) return true;
  return false;
}
/** The tower colonist c mans now: { b, range } or null (drafted, beside it, within its cap by id). */
export function towerOf(s, c) {
  if (!c.drafted) return null;
  for (const b of s.bld) {
    if (!isTower(b) || !beside(s, c, b)) continue;
    const d = structDef(b.def), cap = (d && d.cap) || 1;
    let before = 0;
    for (const o of s.col) if (o.id < c.id && o.drafted && !o.hp.dead && beside(s, o, b)) before++;
    if (before < cap) return { b, range: Math.max(1, modOf(d, 'dmg.range') || COMBAT.towerRangeTiles) };
  }
  return null;
}
const COVER_FLAGS = ['wall'];
/** Percent of ranged hits that land on colonist c (100 in the open). */
export function coverAt(s, c) {
  if (towerOf(s, c)) return COMBAT.towerCoverPct;
  const x = tileOfW(c.x), y = tileOfW(c.y), base = (c.z | 0) * W * H;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const xx = x + dx, yy = y + dy;
    if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
    const id = s.rt.occ[base + yy * W + xx];
    const b = id >= 0 ? s.bld[id] : null;
    if (!b || b.st !== 'done') continue;
    const d = structDef(b.def);
    if (b.def === 'barricade' || b.def === 'embrasure' || (d && COVER_FLAGS.some((f) => hasFlag(d, f)))) return COMBAT.coverPct;
  }
  return onPerch(s, c) ? COMBAT.coverPct : 100;   // Z3.2: a cavern ledge or chasm lip
}
/** Does a tower's centre face edge `side` (lie in that half of the map)? */
function faces(b, side) {
  const d = structDef(b.def), sz = (d && d.size) || [1, 1];
  const cx = b.x + sz[0] / 2, cy = b.y + sz[1] / 2;
  return side === 'n' ? cy < H / 2 : side === 's' ? cy >= H / 2 : side === 'w' ? cx < W / 2 : side === 'e' ? cx >= W / 2 : false;
}
/** Extra warning hours for a raid from `side` (towers facing it, with a soldier to man them; beacons). */
export function warningBonusH(s, side) {
  let h = 0;
  const watch = s.col.some((c) => c.soldier && !c.hp.dead);
  for (const b of s.bld) {
    if (!b || b.st !== 'done') continue;
    const d = structDef(b.def);
    if (!d) continue;
    h += modOf(d, 'warn.all');
    if (watch && TOWER_DEFS.includes(b.def) && faces(b, side)) h += modOf(d, 'warn.edge');
  }
  return h;
}
/** Tick system (slot 'defence'): towers act through their defenders (fight.js); nothing per tick. */
export function towersSystem() {}
