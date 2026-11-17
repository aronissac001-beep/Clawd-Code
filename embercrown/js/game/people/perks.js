// Skill perks (doc 4.2, 8.1): key skills offer 1 of 2 perks at levels 10 and 20; every other skill
// grants one signature perk at 15. Owner F. Provisional API.
//
// col.perks (C2) = [perkId]. A perk's `grants` names a toil, a recipe or a rule (data perks.js);
// systems ask hasRule(col, rule) instead of knowing perk ids. Rule handlers that need code
// register with registerPerkRule (validate-data checks every rule id is registered: RULE_IDS).

import { registerApplier } from '../core/commands.js';
import { colById } from '../core/state.js';
import { all, def } from './defs.js';
import { level } from './skills.js';

export const KEY_LEVELS = Object.freeze([10, 20]);
export const SIGNATURE_LEVEL = 15;

export const hasPerk = (col, id) => col.perks.includes(id);
/** True when any of the colonist's perks grants the rule. */
export function hasRule(col, rule) {
  for (const p of col.perks) { const d = def('perk', p); if (d && d.grants && d.grants.rule === rule) return true; }
  return false;
}
/** Perks of a skill at a level, in data order. */
export const perksAt = (skill, lvl) => all('perk').filter((p) => p.skill === skill && p.lvl === lvl);

/** Choices the colonist has reached but not taken: [{ skill, lvl, options: [perkId] }]. */
export function pendingChoices(col) {
  const out = [];
  for (const sk of all('skill')) {
    const levels = sk.key ? KEY_LEVELS : [SIGNATURE_LEVEL];
    for (const lvl of levels) {
      if (level(col, sk.id) < lvl) continue;
      const opts = perksAt(sk.id, lvl);
      if (opts.length && !opts.some((p) => col.perks.includes(p.id))) out.push({ skill: sk.id, lvl, options: opts.map((p) => p.id) });
    }
  }
  return out;
}
/** Take a perk. null on success, else the reason. */
export function takePerk(s, col, perkId) {
  const p = def('perk', perkId);
  if (!p) return 'no such perk';
  if (col.perks.includes(perkId)) return 'already known';
  if (level(col, p.skill) < p.lvl) return `needs ${p.skill} ${p.lvl}`;
  if (perksAt(p.skill, p.lvl).some((o) => col.perks.includes(o.id))) return 'a perk at that level is already chosen';
  col.perks.push(perkId);
  return null;
}

const RULES = new Map();
/** Code behind a rule id: fn(s, col, ...args). Registration order never matters (lookups by id). */
export function registerPerkRule(rule, fn) { RULES.set(rule, fn); }
export const perkRule = (rule) => RULES.get(rule) || null;
export const perkRuleIds = () => [...RULES.keys()].sort();

export function installPerkCommands() {
  registerApplier('perk', (s, c) => { const r = takePerk(s, colById(s, c.colId), c.perk); return r ? { ok: false, reason: r } : { ok: true }; });
}
