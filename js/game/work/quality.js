// Quality rolls (doc 5.8; owner E). Six levels: Crude 0, Plain 1, Fine 2, Superior 3,
// Masterwork 4, Legendary 5. Roll = skill level + N(0, 2.5) + workshop tier bonus (+1 per level
// above I) [+ traits, perks and inspiration through the modifier engine, Stage 1b].
// Bands: < 3 Crude, < 8 Plain, < 13 Fine, < 17 Superior, < 20 Masterwork, >= 20 Masterwork and
// 1 in 10 Legendary when the level is 16+.
// Deterministic: integer maths (x100 fixed point) and the 'main' RNG stream; N(0, 1) is the
// Irwin-Hall sum of 12 uniforms.

import { nextU32 } from '../core/rand.js';
import { def } from '../core/content.js';
import { SKILL_IDS } from '../core/schema.js';

export const QUALITY_NAMES = Object.freeze(['Crude', 'Plain', 'Fine', 'Superior', 'Masterwork', 'Legendary']);
export const Q = Object.freeze({ CRUDE: 0, PLAIN: 1, FINE: 2, SUPERIOR: 3, MASTERWORK: 4, LEGENDARY: 5 });
/** Band upper bounds (x100): roll < 300 Crude, < 800 Plain, < 1300 Fine, < 1700 Superior, else Masterwork. */
export const BANDS = Object.freeze([300, 800, 1300, 1700, 2000]);
const DEFAULTS = Object.freeze({ rollSdX100: 250, tierBonus: 1, legendaryMinLvl: 16, legendaryChancePct: 10 });
const bal = () => { const b = def('balance', 'quality'); return (b && b.values) || DEFAULTS; };

/** A standard normal sample x10000 (Irwin-Hall: sum of 12 uniforms minus 6). */
export function normalX10000(s) {
  let sum = 0;
  for (let k = 0; k < 12; k++) sum += nextU32(s, 'main') % 10000;
  return sum - 59994;   // 12 x 4999.5
}
/** Level of a skill for a colonist (0-20). */
export const skillLevel = (col, skillId) => { const i = SKILL_IDS.indexOf(skillId); return i < 0 ? 0 : col.sk[i][0] | 0; };

/**
 * Roll the quality of a crafted item.
 * @param {object} s @param {number} lvl skill level @param {number} [benchLvl] workshop level (1 = tier I)
 * @param {number} [bonusX100] extra roll bonus x100 (traits, perks; Stage 1b)
 * @returns {number} 0-5
 */
export function rollQuality(s, lvl, benchLvl = 1, bonusX100 = 0) {
  const b = bal();
  const roll = (lvl | 0) * 100 + Math.trunc((normalX10000(s) * b.rollSdX100) / 10000) + Math.max(0, (benchLvl | 0) - 1) * b.tierBonus * 100 + bonusX100;
  let q = 0;
  while (q < BANDS.length && roll >= BANDS[q]) q++;
  if (q >= 5) {
    q = 4;
    if ((lvl | 0) >= b.legendaryMinLvl && nextU32(s, 'main') % 100 < b.legendaryChancePct) q = 5;
  }
  return q;
}
