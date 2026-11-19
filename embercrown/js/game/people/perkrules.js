// Perk grants lookup (owner F; doc 8.1). A perk's `grants` names one rule (schema RULE_IDS) or one
// toil / action id; hasGrant(col, name) is true when any of the colonist's perks grants that name
// (either kind), so systems ask for the verb and never for perk ids. Kept apart from perks.js so
// health.js, skills.js and B's hooks can import it without a cycle.
import { def } from './defs.js';

/** Does any of the colonist's perks grant `name` (a rule or a toil id)? */
export function hasGrant(col, name) {
  if (!col || !col.perks || !col.perks.length) return false;
  for (const p of col.perks) {
    const d = def('perk', p);
    const g = d && d.grants;
    if (g && (g.rule === name || g.toil === name || g.recipe === name)) return true;
  }
  return false;
}
/** The colonists (alive) whose perks grant `name`, in id order. */
export const withGrant = (s, name) => s.col.filter((c) => !c.hp.dead && hasGrant(c, name));
