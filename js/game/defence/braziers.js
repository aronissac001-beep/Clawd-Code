// Light as a weapon (doc 7.7, 9.5): the Hollow take more damage on lit tiles (light 2+) and Shades
// are pinned there. Owner H. Provisional API.
//
// litBonus is a BUS.dmgMult handler (C4): (s, attacker, target, dmgType) -> multiplier. It reads the
// sim's light map (s.rt.light, B's C5; the single light source for sim and render) at the target's
// tile. Brazier fuel and light come from B's light map and E's Refuel giver; nothing here burns fuel.

import { tileOfW, W, H, clamp } from '../core/grid.js';
import { def } from '../threat/defs.js';

/** Provisional (9.5); moves to balance.js THREAT (owner G) with the 1b data. */
export const DEFENCE = { litHollowPct: 125, litMinLevel: 2 };

const isFoe = (e) => !!e && 'raid' in e && 'kind' in e;
export const isHollow = (foe) => { const d = def('raider', foe.kind); return !!(d && (d.kind === 'hollow' || (d.tags || []).includes('hollow'))); };
export const litAt = (s, wx, wy) => s.rt.light[clamp(tileOfW(wy), 0, H - 1) * W + clamp(tileOfW(wx), 0, W - 1)] >= DEFENCE.litMinLevel;

/** BUS.dmgMult handler. */
export function litBonus(s, attacker, target) {
  if (!isFoe(target) || !isHollow(target)) return 1;
  return litAt(s, target.x, target.y) ? DEFENCE.litHollowPct / 100 : 1;
}
