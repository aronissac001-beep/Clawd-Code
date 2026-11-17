// The Hearth's night shot (doc 8.4, 9.5). Owner H. Provisional API; on from Stage 1b.
//
// At night a fuelled Hearth (s.colony.hearth: { id, lvl, fuel }) fires on its own: every
// `shot.every` ticks it hits the `shot.targets` nearest hostiles within its light radius, for
// `shot.dmg` each (hearthLevel rows in js/data/tiers.js; logic K, numbers G). Nearest is by
// Chebyshev tile distance, ties by foe id. A cold Hearth (fuel 0) does not fire.

import { phaseOf } from '../core/time.js';
import { tileOfW, cheb } from '../core/grid.js';
import { all } from '../threat/defs.js';
import { damageFoe } from '../threat/raiders.js';

export const hearthBuilding = (s) => (s.colony.hearth.id !== null ? s.bld[s.colony.hearth.id] || null : null);
export const hearthLevelDef = (s) => all('hearthLevel').find((h) => h.lvl === s.colony.hearth.lvl) || null;

/** Targets for one shot: [foe], nearest first. */
export function shotTargets(s, hb, lv) {
  const r = lv.light ? lv.light.r : 8;
  const c = [];
  for (const f of s.foes) {
    const d = cheb(tileOfW(f.x), tileOfW(f.y), hb.x, hb.y);
    if (d <= r) c.push([d, f.id, f]);
  }
  c.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return c.slice(0, lv.shot.targets).map((x) => x[2]);
}

/** Tick system (slot 'defence'). */
export function hearthShotSystem(s) {
  if (!s.foes.length || phaseOf(s.tick) !== 'night' || s.colony.hearth.fuel <= 0) return;
  const hb = hearthBuilding(s), lv = hearthLevelDef(s);
  if (!hb || !lv || !lv.shot || s.tick % lv.shot.every !== 0) return;
  for (const f of shotTargets(s, hb, lv)) damageFoe(s, f, lv.shot.dmg, 'fire', { kind: 'hearth', id: hb.id });
}
