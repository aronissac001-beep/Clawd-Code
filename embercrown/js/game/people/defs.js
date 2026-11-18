// People (owner F): content and tuning lookups for js/game/people/*.
// Every number comes from js/data/ (balance.js sections 'skill' and 'needs', and F's data files);
// this module only finds them. The default registry is G's CONTENT (js/data/index.js, pure);
// core/content.js (A) may install a validated one with setPeopleContent(reg).
//
// traitPct / traitFlag fold trait and ancestry modifiers for one key. They are a Stage 0 stand-in
// for A's modifier engine (core/mods.js, `mod(s, entity, key, base)`, 13.3); when it lands these
// two functions forward to it and every caller stays the same.

import { CONTENT } from '../../data/index.js';

let REG = CONTENT;
/** Install the content registry (has, get, all). */
export function setPeopleContent(reg) { REG = reg; }
export const registry = () => REG;
export const def = (kind, id) => (id === null || id === undefined ? null : REG.get(kind, id));
export const all = (kind) => REG.all(kind);
/** A balance.js section's values ('skill', 'needs', 'caps', ...), or {} when absent. */
export function bal(section) { const b = REG.get('balance', section); return (b && b.values) || {}; }

function modsOf(col) {
  const out = [];
  const a = def('ancestry', col.anc);
  if (a && a.mods) for (const m of a.mods) out.push(m);
  for (const t of col.traits) { const d = def('trait', t); if (d && d.mods) for (const m of d.mods) out.push(m); }
  return out;
}
/** Percent multiplier (100 = x1.0) from every 'pct' modifier on `key`; 'add' modifiers add points. */
export function traitPct(col, key) {
  let pct = 100;
  for (const m of modsOf(col)) if (m.key === key && (m.op === 'pct' || m.op === 'add')) pct += m.value | 0;
  return pct < 0 ? 0 : pct;
}
/** True when any trait or the ancestry sets the flag `key`. */
export function traitFlag(col, key) {
  for (const m of modsOf(col)) if (m.key === key && m.op === 'flag' && m.value) return true;
  return false;
}

// ---- The build stage the people systems run (installPeople sets it; doc 14.6-14.8) ----------------
// Stage-tagged content (needs, breaks, roles: `stage` in F's data) is used only when its stage is
// reached. '1a': no needs; '1b': food, rest, light, the minor breaks; '2': joy, warmth and the rest.
const STAGE_ORDER = ['1a', '1b', '2', '3', '4'];
let STAGE = '1a';
export function setPeopleStage(stage) { if (STAGE_ORDER.includes(stage)) STAGE = stage; }
export const peopleStage = () => STAGE;
/** Is def `d` (untagged: always) available at the people stage? */
export const inStage = (d) => !!d && (!d.stage || STAGE_ORDER.indexOf(d.stage) <= STAGE_ORDER.indexOf(STAGE));
