// Cast selectors (doc 9.10): who an incident is about. Owner H. Provisional API.
//
// A selector is a pure function of the state; ties are broken by colonist id; only able (not dead,
// not downed) colonists are picked. The result is saved in the queue entry (C12 Cast) when the
// incident is planned, so a later load cannot pick someone else.
//   lowestMood, rivalPair, captainSlayer, bestCrafter:<skill>, newest, wounded

import { SKILL_IDS } from '../core/schema.js';
import { opinion, relation } from '../people/social.js';

const alive = (s) => s.col.filter((c) => !c.hp.dead && !c.hp.down).sort((a, b) => a.id - b.id);
function minBy(list, key) { let best = null, bv = Infinity; for (const c of list) { const v = key(c); if (v < bv) { bv = v; best = c; } } return best; }

export const SELECTORS = {
  lowestMood: (s) => { const c = minBy(alive(s), (x) => x.mood); return c ? c.id : null; },
  newest: (s) => { const l = alive(s); return l.length ? l[l.length - 1].id : null; },
  wounded: (s) => {
    const c = minBy(alive(s), (x) => -(x.hp.taint * 10 + x.hp.wounds.reduce((a, w) => a + w.dmg, 0)));
    return c && (c.hp.taint > 0 || c.hp.wounds.length) ? c.id : null;
  },
  rivalPair: (s) => {
    const l = alive(s);
    let best = null, bv = 0;
    for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) {
      if (!relation(s, l[i].id, l[j].id)) continue;
      const op = opinion(s, l[i].id, l[j].id);
      if (op < bv) { bv = op; best = [l[i].id, l[j].id]; }
    }
    return best;
  },
  /** The colonist who downed the last raid captain (recorded in s.st.history as `slayer`). */
  captainSlayer: (s) => {
    for (let k = s.st.history.length - 1; k >= 0; k--) {
      const h = s.st.history[k];
      if (h.slayer !== undefined && h.slayer !== null && alive(s).some((c) => c.id === h.slayer)) return h.slayer;
    }
    return null;
  },
};
/** bestCrafter:<skill> */
function bestCrafter(s, skill) {
  const i = SKILL_IDS.indexOf(skill);
  if (i < 0) return null;
  const c = minBy(alive(s), (x) => -x.sk[i][0]);
  return c ? c.id : null;
}

/** Evaluate one selector string. */
export function select(s, sel) {
  if (typeof sel !== 'string') return null;
  if (sel.startsWith('bestCrafter:')) return bestCrafter(s, sel.slice(12));
  const f = SELECTORS[sel];
  return f ? f(s) : null;
}
/** Evaluate an incident's cast spec { role: selector } into a Cast { role: colId | [a, b] | null }. */
export function selectCast(s, spec) {
  const out = {};
  if (!spec) return out;
  for (const role of Object.keys(spec).sort()) out[role] = select(s, spec[role]);
  return out;
}
