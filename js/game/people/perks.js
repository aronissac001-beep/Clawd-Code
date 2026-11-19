// Skill perks (EMBERCROWN-FORTRESS.md 3.1, F10): growth by doing. Owner F.
// No perk is ever picked. Once a game hour, every living colonist is checked against every perk they do
// not hold: a perk is EARNED when its skill level is reached AND its deed is done (the counters of
// people/coldeeds.js; the rules in js/data/deeds-col.js PERK_EARN). A grant shows a toast (the
// `perkEarned` event, once A adds it to C8), writes a Chronicle line and a colonist log line, and adds
// the perk. There is no letter and no choice; both perks of an old pair can be earned, and a colonist can
// hold any number. (The Annals entry joins when s.legend lands in Z2.3.)
//
// col.perks (C2) = [perkId], in the order they were earned. A perk's `grants` names a toil, a recipe or a
// rule (data perks.js); systems ask hasGrant(col, name) (perkrules.js) instead of knowing perk ids. Rule
// handlers that need code register with registerPerkRule (validate-data checks every rule id: RULE_IDS).

import { registerApplier, COMMANDS } from '../core/commands.js';
import { colById } from '../core/state.js';
import { emit, EVENTS } from '../core/events.js';
import { registerSystem, tickSystems } from '../core/bus.js';
import { W, H, TER } from '../core/grid.js';
import { all, def, stage2 } from './defs.js';
import { level } from './skills.js';
import { hasGrant } from './perkrules.js';
import { onMined, setKnown } from '../world/terrain.js';
import { addChron } from '../colony/chronicle.js';
import { PERK_EARN, DEED_RULES } from '../../data/deeds-col.js';
import { deedCount, deedDef, installColDeeds, colDeedsSystem } from './coldeeds.js';
export { hasGrant, withGrant } from './perkrules.js';
export { PERK_EARN };

/** The levels the six key skills' perks sit at, and the signature perks' level (data perks.js). */
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

const RULES = new Map();
/** Code behind a rule id: fn(s, col, ...args). Registration order never matters (lookups by id). */
export function registerPerkRule(rule, fn) { RULES.set(rule, fn); }
export const perkRule = (rule) => RULES.get(rule) || null;
export const perkRuleIds = () => [...RULES.keys()].sort();

// ---- Earning (3.1) ----------------------------------------------------------------------------------------------
/** The earn rule of a perk: { lvl, all?: [{ deed, n }], any?: [{ deed, n }] } or null. */
export const earnOf = (perkId) => PERK_EARN[perkId] || null;
const fill = (tpl, o) => String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (o[k] !== undefined && o[k] !== null ? String(o[k]) : ''));
/**
 * Where a colonist stands on a perk: { id, name, skill, lvl, have (skill level), levelOk, deeds: [{ deed, have,
 * n, met, prog }], any, deedsOk, earned (all of it holds), held }. Pure (the Skills tab reads it).
 */
export function earnState(col, perkId) {
  const p = def('perk', perkId), e = earnOf(perkId);
  if (!p || !e) return null;
  const any = !!e.any, list = e.any || e.all || [];
  const deeds = list.map(({ deed, n }) => {
    const have = Math.min(deedCount(col, deed), n), dd = deedDef(deed);
    return { deed, have: deedCount(col, deed), n, met: have >= n, prog: fill(dd && dd.prog, { have, n }) };
  });
  const lv = level(col, p.skill), levelOk = lv >= e.lvl;
  const deedsOk = any ? deeds.some((d) => d.met) : deeds.every((d) => d.met);
  return { id: p.id, name: p.name, skill: p.skill, lvl: e.lvl, have: lv, levelOk, deeds, any, deedsOk, earned: levelOk && deedsOk, held: col.perks.includes(p.id) };
}
/** The deed line of an earned perk for the toast and the Chronicle: "followed 152 ore seams". */
function whyText(col, perkId) {
  const st = earnState(col, perkId);
  const d = st && (st.deeds.find((x) => x.met) || st.deeds[0]);
  const dd = d && deedDef(d.deed);
  return dd ? fill(dd.past, { n: d.have }) : '';
}
const firstName = (col) => String(col.name || '').split(' ')[0] || col.name;
/** The toast text of a grant: "Bryn has learned Seam Follower: followed 150 ore seams". */
export function grantText(col, perkId) {
  const p = def('perk', perkId), why = whyText(col, perkId);
  return `${firstName(col)} has learned ${p ? p.name : perkId}${why ? ': ' + why : ''}`;
}
/** Add an earned perk: the colonist log line, the Chronicle line and the toast event. */
function grant(s, col, perkId) {
  const p = def('perk', perkId);
  col.perks.push(perkId);
  const why = whyText(col, perkId), text = grantText(col, perkId);
  if (Array.isArray(col.log)) { col.log.push({ tick: s.tick, text: text + '.' }); if (col.log.length > DEED_RULES.logCap) col.log.splice(0, col.log.length - DEED_RULES.logCap); }
  addChron(s, 'perk', 'chron_perk', { colId: col.id, name: firstName(col), perk: p ? p.name : perkId, why });
  if ('perkEarned' in EVENTS) emit(s, 'perkEarned', { colId: col.id, perk: perkId, text });
}
/** Grant every perk the colonist has earned and does not hold (data order). Returns the ids granted. */
export function checkEarned(s, col) {
  const out = [];
  if (!col || !col.hp || col.hp.dead) return out;
  for (const p of all('perk')) {
    if (col.perks.includes(p.id)) continue;
    const st = earnState(col, p.id);
    if (st && st.earned) { grant(s, col, p.id); out.push(p.id); }
  }
  return out;
}
/** Tick system (slot 'social'): once a game hour, every colonist in s.col order (3.1). */
export function perkEarnSystem(s) {
  if (!stage2() || s.tick % DEED_RULES.checkEveryTicks !== 0) return;
  for (const c of s.col) checkEarned(s, c);
}
/**
 * The Skills tab's "next" lines (S9.6): the perks not yet held, key skills first by level, then the
 * signature perks; each with earnState and `text` ("Seam Follower: mined 112 of 150 ore"; "Mining 10" first
 * while the level is short). opts.skill narrows to one skill; opts.limit caps the list.
 */
export function nextPerks(col, { skill = null, limit = 99 } = {}) {
  const out = [];
  for (const p of all('perk')) {
    if (skill && p.skill !== skill) continue;
    const st = earnState(col, p.id);
    if (!st || st.held) continue;
    const sk = def('skill', p.skill);
    const deedTxt = st.deeds.map((d) => d.prog).join(st.any ? ' or ' : ' and ');
    const parts = [];
    if (!st.levelOk) parts.push(`${sk ? sk.name : p.skill} ${st.lvl}`);
    if (!st.deedsOk) parts.push(deedTxt);
    out.push({ ...st, text: `${p.name}: ${parts.length ? parts.join(', ') : 'learned within the hour'}` });
  }
  out.sort((a, b) => (b.levelOk - a.levelOk) || (a.lvl - b.lvl));
  return out.slice(0, limit);
}

/** Retired with the picks (F10): there are no choices. Kept until the UI drops its import (S9.6). */
export function pendingChoices() { return []; }
/** A skill reached `lvl` (skills.js awardXp's level hook): nothing happens at once; the hourly check earns perks. */
export function perkOnLevel() { return null; }

// ---- The Stage 2.9 migration helper (A's migrations[1], 5.3 step 2) ------------------------------------------------
/**
 * The pair choices a Stage 2 colonist had reached and not taken (the old rule): key skills at 10 and 20 with
 * neither perk of the pair held. col: { sk, perks } (plain is fine). [{ skill, lvl, options: [perkId] }].
 */
export function legacyChoices(col) {
  const out = [];
  for (const sk of all('skill')) {
    if (!sk.key) continue;
    const k = all('skill').indexOf(sk);
    const lv = col.sk && col.sk[k] ? col.sk[k][0] | 0 : 0;
    for (const lvl of KEY_LEVELS) {
      if (lv < lvl) continue;
      const opts = perksAt(sk.id, lvl);
      if (opts.length && !opts.some((p) => col.perks.includes(p.id))) out.push({ skill: sk.id, lvl, options: opts.map((p) => p.id) });
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
    const e = earnOf(id);
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
const has = (slot, name) => tickSystems().some((x) => x.slot === slot && x.name === name);
/** Install the perk systems (idempotent): the deed counters, the hourly earn check, Seam Follower's hook. */
export function installPerks() {
  installColDeeds();
  if (!minedOff) minedOff = onMined(seamFollower);
  if (!has('social', 'coldeeds')) registerSystem('social', 'coldeeds', colDeedsSystem, 35);
  if (!has('social', 'perks-earn')) registerSystem('social', 'perks-earn', perkEarnSystem, 40);
}
/** people/index.js calls this from installPeople: the perk systems, and a refusal for the old `perk` command while it exists. */
export function installPerkCommands() {
  installPerks();
  if ('perk' in COMMANDS) registerApplier('perk', () => ({ ok: false, reason: 'perks are earned by deeds, not chosen' }));
}
