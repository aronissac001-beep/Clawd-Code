// The Stage 2.9 migration helper (EMBERCROWN-FORTRESS.md 1.2, 5.3 step 2). Owner F; called by A's state
// migration v2 -> v3 (core/state.js migrations[1]) and re-exported by people/perks.js.
//
// A Stage 2 colonist could have reached a key-skill pair (levels 10 and 20) without taking either perk: the
// old picker waited for the player. Perks are earned now, never chosen (F10), so the migration RESOLVES each
// such choice, never drops it: the colonist gets the perk of the pair whose deed they are nearer to, measured
// from what the Stage 2 save records for them (items they made, structures they built), else the pair's first
// perk, and the Chronicle says so ("Bryn settled into the ways of a Seam Follower").
//
// Pure: data lookups only (people/defs.js and js/data), so the core migration can import it without pulling
// in the sim. Works on plain rows ({ id, name, sk, perks }; items { k, q, maker }; bld { def, maker }).

import { all, def } from './defs.js';
import { PERK_EARN, DEED_RULES } from '../../data/deeds-col.js';

const KEY_LEVELS = [10, 20];
const perksAt = (skill, lvl) => all('perk').filter((p) => p.skill === skill && p.lvl === lvl);
const firstName = (col) => String(col.name || '').split(' ')[0] || col.name;

/**
 * The pair choices a Stage 2 colonist had reached and not taken (the old rule): key skills at 10 and 20 with
 * neither perk of the pair held. col: { sk, perks } (plain is fine). [{ skill, lvl, options: [perkId] }].
 */
export function legacyChoices(col) {
  const out = [], skills = all('skill'), held = col.perks || [];
  for (let k = 0; k < skills.length; k++) {
    const sk = skills[k];
    if (!sk.key) continue;
    const lv = col.sk && col.sk[k] ? col.sk[k][0] | 0 : 0;
    for (const lvl of KEY_LEVELS) {
      if (lv < lvl) continue;
      const opts = perksAt(sk.id, lvl);
      if (opts.length && !opts.some((p) => held.includes(p.id))) out.push({ skill: sk.id, lvl, options: opts.map((p) => p.id) });
    }
  }
  return out;
}
/** What a Stage 2 save records toward a deed for one colonist (items they made, buildings with them as maker). */
function legacyMeasure(col, deed, ev) {
  const R = DEED_RULES, mine = (x) => x && x.maker === col.id;
  const items = (ev.items || []).filter(mine), blds = (ev.bld || []).filter(mine);
  const cat = (k) => { const d = def('item', k); return d ? d.cat : null; };
  const flag = (b, f) => { const d = def('structure', b.def); return !!(d && d.flags && d.flags.includes(f)); };
  switch (deed) {
    case 'forged_fine': return items.filter((it) => R.smithCats.includes(cat(it.k)) && (it.q | 0) >= R.forgedFineQ).length;
    case 'forged_master': return items.filter((it) => R.smithCats.includes(cat(it.k)) && (it.q | 0) >= R.masterQ).length;
    case 'garments': return items.filter((it) => R.garmentCats.includes(cat(it.k))).length;
    case 'walls_built': return blds.filter((b) => flag(b, 'wall')).length;
    case 'supports_built': return blds.filter((b) => flag(b, 'support') && !flag(b, 'wall')).length;
    case 'traps_set': return blds.filter((b) => flag(b, 'trap')).length;
    default: return 0;
  }
}
/**
 * Resolve one old pair choice to the perk whose deed the colonist is nearer to (the larger share of its
 * goal, from what the save records: legacyMeasure); with no measure for either, the pair's first perk.
 * ev = { items: [{ k, q, maker }], bld: [{ def, maker }] } (the save's plain rows are fine).
 */
export function settleChoice(col, options, ev = {}) {
  let best = options[0], bestShare = 0;
  for (const id of options) {
    const e = PERK_EARN[id];
    if (!e) continue;
    let share = 0;
    for (const { deed, n } of e.all || e.any || []) share = Math.max(share, Math.min(1, legacyMeasure(col, deed, ev) / n));
    if (share > bestShare) { best = id; bestShare = share; }
  }
  return best;
}
/** The Chronicle line the migration writes for a settled choice: [tick, 'perk', 'chron_perk_settled', args]. */
export function settledChronEntry(tick, col, perkId) {
  const p = def('perk', perkId);
  return [tick, 'perk', 'chron_perk_settled', { colId: col.id, name: firstName(col), perk: p ? p.name : perkId }];
}
