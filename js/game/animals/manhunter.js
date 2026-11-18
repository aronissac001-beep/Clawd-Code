// Manhunters (doc 9.3, beasts): an animal pack turned hostile, or a beast that was hurt.
// Owner K (AI), with H's beast incidents (incidents.js, cat major, tag 'beast': H spawns the pack with
// spawn.spawnAnimal and calls enrage). A manhunter chases the nearest able colonist (its target
// first), bites when beside them (F's damage, 'bite'), and the bitten colonist strikes back (their
// weapon's damage, else fists). It calms down at `until` (MANHUNT_TICKS) and wanders off. While one
// is out, a.st.aggro is set (core/time.js keeps 5x speed off: "a beast is hunting").
// Hurt hook (spawn.setHurtHook): a beast with a threat cost (boar, wolf, spider) turns on whoever hurt
// it; anything else flees.

import { W, cheb } from '../core/grid.js';
import { colById } from '../core/state.js';
import { def } from '../colony/defs.js';
import { requestPath, GOAL } from '../systems/pathing.js';
import { damage } from '../people/health.js';
import { animTile, hurtAnimal, setHurtHook } from './spawn.js';
import { fleeFrom } from './wild.js';
import { colTile } from '../work/reserve.js';

export const MANHUNT_TICKS = 14400;
export const BITE_EVERY = 50, REPATH_EVERY = 40;
export const isManhunter = (a) => !!(a.st && a.st.mode === 'manhunt');
/** Turn an animal hostile until tick + MANHUNT_TICKS (optionally at one colonist first). */
export function enrage(s, a, targetId = null) {
  a.st = { mode: 'manhunt', until: s.tick + MANHUNT_TICKS, target: targetId, aggro: true, bite: 0 };
  a.path = null;
  return a;
}
const ableCol = (c) => !!c && !c.hp.dead && !c.hp.down;
function nearestCol(s, a) {
  const at = animTile(a), ax = at % W, ay = (at / W) | 0;
  let best = null, bd = Infinity;
  for (const c of s.col) {
    if (!ableCol(c)) continue;
    const ci = colTile(c), d = cheb(ax, ay, ci % W, (ci / W) | 0);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}
/** A colonist's blow: the worn weapon's damage, else fists (6). */
export function blowOf(col) {
  const w = col.gear && col.gear.slots ? col.gear.slots.weapon : null;
  const d = w ? def('item', typeof w === 'object' ? w.k : w) : null;
  return d && d.weapon ? d.weapon.dmg | 0 : 6;
}
const PARTS = [1, 2, 3, 4, 5, 1, 4, 5];
/** Tick system (slot 'animals'). */
export function manhunterSystem(s) {
  for (const a of s.anim.slice()) {
    if (!isManhunter(a)) continue;
    const st = a.st;
    if (s.tick >= st.until) { a.st = { mode: 'wander', until: 0, target: null }; continue; }
    let c = st.target !== null ? colById(s, st.target) : null;
    if (!ableCol(c)) { c = nearestCol(s, a); st.target = c ? c.id : null; }
    if (!c) continue;
    const at = animTile(a), ci = colTile(c);
    if (cheb(at % W, (at / W) | 0, ci % W, (ci / W) | 0) <= 1) {
      a.path = null;
      if (s.tick - (st.bite | 0) >= BITE_EVERY) {
        st.bite = s.tick;
        const d = def('animal', a.kind) || {};
        damage(s, c, PARTS[(Math.floor(s.tick / BITE_EVERY) + a.id) % PARTS.length], 'bite', 2 + 2 * (d.size | 0 || 1), a);
        if (ableCol(c) && hurtAnimal(s, a, blowOf(c), c.id)) continue;
      }
    } else if ((s.tick + a.id) % REPATH_EVERY === 0 || !a.path) requestPath(s, 'a', a.id, ci, GOAL.ADJ8);
  }
}
/** The hurt hook: beasts with a threat cost fight back, the rest run. */
function onHurt(s, a, byColId) {
  const d = def('animal', a.kind) || {};
  const by = byColId !== null ? colById(s, byColId) : null;
  if (isManhunter(a)) return;
  if (d.pts) { enrage(s, a, byColId); return; }
  if (by) fleeFrom(s, a, colTile(by));
}
export function installManhunters() { setHurtHook(onHurt); }
