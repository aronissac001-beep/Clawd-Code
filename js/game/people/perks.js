// Skill perks (doc 4.2, 8.1): key skills offer 1 of 2 perks at levels 10 and 20; every other skill
// grants one signature perk at 15. Owner F. Provisional API.
//
// col.perks (C2) = [perkId]. A perk's `grants` names a toil, a recipe or a rule (data perks.js);
// systems ask hasRule(col, rule) instead of knowing perk ids. Rule handlers that need code
// register with registerPerkRule (validate-data checks every rule id is registered: RULE_IDS).

import { registerApplier } from '../core/commands.js';
import { colById } from '../core/state.js';
import { emit } from '../core/events.js';
import { W, H, TER } from '../core/grid.js';
import { all, def, stage2 } from './defs.js';
import { level } from './skills.js';
import { hasGrant } from './perkrules.js';
import { onMined, setKnown } from '../world/terrain.js';
export { hasGrant, withGrant } from './perkrules.js';

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

// ---- Level-ups (Stage 2): signature perks are granted, choices raise a letter ---------------------------------
/** A skill reached `lvl` (skills.js awardXp calls it): grant the signature perk, or raise the choice letter. */
export function perkOnLevel(s, col, skillId, lvl) {
  if (!stage2()) return null;
  const sk = def('skill', skillId);
  if (!sk) return null;
  if (!sk.key && lvl === SIGNATURE_LEVEL) {
    const p = perksAt(skillId, lvl)[0];
    if (p && !col.perks.includes(p.id)) { col.perks.push(p.id); return { granted: p.id }; }
    return null;
  }
  if (sk.key && KEY_LEVELS.includes(lvl) && perksAt(skillId, lvl).length) {
    emit(s, 'letter', { letterId: col.id * 1000 + SKILL_IDX(skillId) * 32 + lvl, kind: 'perk', colId: col.id, skill: skillId, lvl });
    return { letter: true };
  }
  return null;
}
const SKILL_IDX = (id) => all('skill').findIndex((x) => x.id === id);

// ---- Hooks F implements (the rest are read by their owners through hasGrant) -----------------------------------
/** Seam Follower (Mining 10): mining a vein tile makes the whole connected vein known. */
function seamFollower(s, i, colId, ore) {
  if (!ore || colId === null || colId === undefined) return;
  const col = colById(s, colId);
  if (!col || !hasGrant(col, 'seamFollower')) return;
  const seen = new Set([i]), q = [i];
  for (let h = 0; h < q.length && q.length < 400; h++) {
    const c = q[h], x = c % W, y = (c / W) | 0;
    for (const j of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, y > 0 ? c - W : -1, y < H - 1 ? c + W : -1]) {
      if (j < 0 || seen.has(j) || s.L.ore[j] !== ore || s.L.terrain[j] !== TER.ROCK) continue;
      seen.add(j); q.push(j); setKnown(s, j, true);
    }
  }
}
/** Every rule and toil id the 33 perks name, with where its code lives (validate-data and the perk card). */
export const PERK_HOOKS = Object.freeze({
  caveSense: 'B support.rumbleTicks (F binds a 2 h lead; I shows rumbling())', seamFollower: 'F perks.js', stonefriend: 'E mine toil', heartdelver: 'C render (gem glow)',
  quickShoring: 'E build giver', salvager: 'E deconstruct', master_builder: 'H sapper dig rate', siege_engineer: 'E repair, H',
  reforger: 'E smith recipes', temper: 'E smith recipes', crownsmith: 'E quality', ashquencher: 'E smith recipes',
  fieldSurgeon: 'E care giver', fever_watch: 'F health.tend', taintbreaker: 'E surgery (Stage 3)', ember_hands: 'F health.emberHands (bleeding)',
  shieldwall: 'H combat', duel: 'H combat', unbroken: 'F health.damage', warcry: 'H combat',
  fire_arrows: 'H combat, B fire', overwatch: 'H combat', deadeye: 'H combat', volley: 'H combat',
  trapwright: 'E build giver', stoneCarver: 'E craft giver', banner_maker: 'F draft.bannerHolds (no breaks; H: no fleeing)', hearthCook: 'K feast command',
  graft: 'E grow giver', calm_beast: 'K animals', deep_reader: 'K research', chronicle: 'E art giver', parley: 'F breaks.talkDown, H parley',
});
for (const id of Object.keys(PERK_HOOKS)) RULES.set(id, RULES.get(id) || null);

let minedOff = null;
export function installPerkCommands() {
  if (!minedOff) minedOff = onMined(seamFollower);
  registerApplier('perk', (s, c) => { const r = takePerk(s, colById(s, c.colId), c.perk); return r ? { ok: false, reason: r } : { ok: true }; });
}
