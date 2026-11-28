// Offices and nobles (EMBERCROWN-FORTRESS.md 3.4, F17; step Z2.2). Owner K. Data: js/data/offices.js;
// the screen: js/ui/officesui.js (Colony > Hold > Offices). The Warden of Law is Z2.12's (justice.js).
//
// Saved state (plain JSON on the colony record, so colonyToPlain / colonyFromPlain save it; created lazily by
// ensureOffices on the first hourly tick of the system or by a command, the same tick in an uninterrupted run
// and in a loaded one, so old saves (v2 fixtures, Z1 saves) load with none and continue):
//   s.colony.offices     { officeId: colId } holders, keys in OFFICES order (C2 v3 `offices`)
//   s.colony.mandates    [{ id, by, office, kind: 'make'|'keep', k, m, n, base, open, due, sold }] (C2 v3)
//   s.colony.officeRec   { v, targets: [[k, m, n]], since: { officeId: tick | -1 }, holderSince: { officeId: colId },
//                          lastMandate: { colId: day }, lord: { title, arrived, retainers }, lordDay, brokenDay,
//                          bonus: [6] renown points from met mandates (renown.js reads them, Z2.4), year: [..] }
//   (A: please add `offices: {}`, `mandates: []`, `officeRec: null` to schema.newColonyRecord(); until then
//   they are created lazily, which is the same thing for old saves.)
//
// Determinism: every choice is a hash of the seed, the day and a colonist id (hashString); nothing here draws
// from s.rng except the Lord's arrival, which generates three colonists with generateColonist (the 'main' and
// 'names' streams, at a fixed hour). No rt key is added: needs and plans are recomputed from the state.
//
// W3.3b (EMBERCROWN-WORLD.md 2.7 offices row): in a hold with its realm record (factions.js realmRec) the Lord or Lady
// of the Hold is a younger kin of the liege civ's ruler (lordCandidate: a child, sibling, sibling's child, grandchild,
// then any younger kin of the civ's ruling house), grown, alive in the realm and not already in the hold. The colonist
// takes the figure's name and people; officeRec.lord.fig keeps the figure id, officeRec.wlords (created on the first
// such Lord) every figure sent, and the Lord's legend record links the world key 'wf<id>'. The liege's envoy (envoyOf,
// a living envoy of the liege civ) rides in with the Lord and carries the yearly tribute; the letters name the civ,
// the ruler and the envoy. With no record, or no such kin, the legacy Lord comes (same draws, same letter).
// The world-figure helpers (figAlive, figGrown, figsInHold, envoyOf) are shared with visitors.js.
//
// Hooks into other owners' code (requests in the Z2.2 report):
//   commands.js (A)     `office { id, colId | null }` and `stockTarget { k, m?, n }`; installOffices registers
//                       their appliers once the specs exist
//   colony/index.js     reg('colony', 'offices', officesSystem, 135) and installOffices() under `verbs`
//   trade.js            mandateBars(s, k, m) before selling; noteTradeOut(s, k, m, n) after a sale
//   justice.js (Z2.12)  setMandateBrokenHook(fn(s, mandate) -> true when a case was opened)
//   renown.js (Z2.4)    mandateRenown(s) -> [6] points by RENOWN_DOMAINS
//   ui (I)              Colony > Hold > Offices opens officesui.openOffices(ctx); stockLabel(s, n) in the Stock tab

import { TICKS_PER_HOUR, TICKS_PER_DAY, DAYS_PER_SEASON, DAYS_PER_YEAR, dayOf } from '../core/time.js';
import { hashString } from '../core/rand.js';
import { FIX } from '../core/schema.js';
import { newBill } from '../core/schema.js';
import { COMMANDS, registerApplier } from '../core/commands.js';
import { all, def } from './defs.js';
import { atLeast } from './tiers.js';
import { hasTech } from './research.js';
import { computeWealth } from './wealth.js';
import { addGoodwill, goodwill } from './factions.js';
import { tierDef } from './tiers.js';
import { totalsMat, spawn, forEachItem } from '../work/items.js';
import { untilProduct, MAX_BILLS } from '../work/bills.js';
import { roomInfo, roomById } from '../world/rooms.js';
import { opinion } from '../people/social.js';
import { addThought, removeThought, hasThought } from '../people/mood.js';
import { psyOf, valueOf } from '../people/personality.js';
import { peopleRec } from '../people/peoplerec.js';
import { generateColonist, spawnColonist } from '../people/colonists.js';
import { sendLetter } from '../threat/letters.js';
import { OFFICES, NEEDS, RULES, MANDATE, KEEP_KINDS, DOMAIN_OF, RENOWN_DOMAINS, TEXT, BED_DEFS } from '../../data/offices.js';
import { realmRec, liegeCiv } from './factions.js';
import { addLegend } from './legends.js';
import { HISTORY_PEOPLES } from '../../data/realm/civkinds.js';
import { figureName, civText } from '../../data/text/realm.js';

export { OFFICES, NEEDS };
export const OFFICE_IDS = Object.freeze(OFFICES.map((o) => o.id));
/** The offices the player appoints (the `office` command). */
export const APPOINTED = Object.freeze(OFFICES.filter((o) => o.by === 'player').map((o) => o.id));
export const NOBLES = Object.freeze(['lord', 'thane']);
export const TARGET_MAX = 24;
const TIER_ORDER = ['squalid', 'plain', 'decent', 'fine', 'grand', 'majestic'];
const officeDef = (id) => OFFICES.find((o) => o.id === id) || null;

// ---- the record ------------------------------------------------------------------------------------------------
function newRec() {
  return { v: 1, targets: [], since: {}, holderSince: {}, lastMandate: {}, lord: null, lordDay: -1, brokenDay: -1, bonus: [0, 0, 0, 0, 0, 0], year: null, mandateId: 1 };
}
const EMPTY_REC = Object.freeze(newRec());
/** The office record (read only; EMPTY before the first write). */
export const officeRec = (s) => (s.colony && s.colony.officeRec) || EMPTY_REC;
export const holders = (s) => (s.colony && s.colony.offices) || {};
export const mandatesOf = (s) => (s.colony && s.colony.mandates) || [];
/** Create the saved fields (sim only: the system's hour and the appliers). */
export function ensureOffices(s) {
  const c = s.colony;
  if (!c.offices || typeof c.offices !== 'object') c.offices = {};
  if (!Array.isArray(c.mandates)) c.mandates = [];
  if (!c.officeRec) c.officeRec = newRec();
  const r = c.officeRec, e = newRec();
  for (const k of Object.keys(e)) if (!(k in r)) r[k] = e[k];
  return r;
}
/** Holders rewritten in OFFICES order (canonical key order). */
function setHolder(s, id, colId) {
  const h = { ...holders(s) };
  if (colId === null || colId === undefined) delete h[id]; else h[id] = colId;
  const out = {};
  for (const o of OFFICE_IDS) if (h[o] !== undefined) out[o] = h[o];
  s.colony.offices = out;
  const r = officeRec(s);
  if (r !== EMPTY_REC) { r.since[id] = -1; r.holderSince[id] = colId === null || colId === undefined ? -1 : s.tick; }
}

// ---- people --------------------------------------------------------------------------------------------------
const colBy = (s, id) => (id === null || id === undefined ? null : s.col.find((c) => c.id === id) || null);
const alive = (c) => !!c && !c.hp.dead && !c.gone;
const adult = (c) => !(c.age !== undefined && c.age < 18);
export const livingCount = (s) => s.col.reduce((n, c) => n + (alive(c) ? 1 : 0), 0);
/** The living holder of an office (a colonist), or null. */
export function holderOf(s, id) { const c = colBy(s, holders(s)[id]); return alive(c) ? c : null; }
export const hasOffice = (s, id) => !!holderOf(s, id);
/** The office a colonist holds (the Lord and the Thane first), or null. */
export function officeOf(s, colId) { const h = holders(s); for (const o of OFFICE_IDS) if (h[o] === colId) return o; return null; }
export function officeName(s, id) {
  const o = officeDef(id);
  if (!o) return id;
  if (id === 'lord' && officeRec(s).lord && officeRec(s).lord.title === 'Lady') return o.nameAlt;
  return o.name;
}
const lordTitle = (s) => (officeRec(s).lord && officeRec(s).lord.title) || 'Lord';

/** Is the office open now? (The Thane and the Lord open by their own rules.) */
export function officeOpen(s, id) {
  const o = officeDef(id);
  if (!o) return false;
  const op = o.opens || {};
  if (op.pop && livingCount(s) < op.pop) return false;
  if (op.squad && !(peopleRec(s).squads || []).length) return false;
  if (op.tier && !atLeast(s, op.tier)) return false;
  return true;
}
/** null when colonist colId may take office id, else the reason. */
export function canAppoint(s, id, colId) {
  if (!APPOINTED.includes(id)) return 'that office is not appointed';
  if (colId === null) return null;
  if (!officeOpen(s, id)) return `the ${officeName(s, id)} is not open yet`;
  const c = colBy(s, colId);
  if (!alive(c)) return 'no such colonist';
  if (!adult(c)) return 'too young for an office';
  const cur = officeOf(s, colId);
  if (cur === 'lord' || cur === 'thane') return `${c.name.split(' ')[0]} is the ${officeName(s, cur)}`;
  return null;
}
/** Appoint (or clear, colId null). One office a colonist: a new office moves them. */
export function appoint(s, id, colId) {
  const why = canAppoint(s, id, colId);
  if (why) return { ok: false, reason: why };
  ensureOffices(s);
  if (colId !== null) { const cur = officeOf(s, colId); if (cur && cur !== id) setHolder(s, cur, null); }
  setHolder(s, id, colId);
  return { ok: true };
}

// ---- stock targets and the Steward -----------------------------------------------------------------------------
export const targetsOf = (s) => officeRec(s).targets.map(([k, m, n]) => ({ k, m, n }));
const tkey = (k, m) => `${k}:${m || ''}`;
/** Set a stock target (n 0 removes it). */
export function setStockTarget(s, k, m, n) {
  if (!def('item', k)) return { ok: false, reason: 'no such item' };
  const r = ensureOffices(s), mm = m || null, i = r.targets.findIndex((t) => t[0] === k && t[1] === mm);
  if (n <= 0) { if (i >= 0) r.targets.splice(i, 1); return { ok: true }; }
  if (i >= 0) r.targets[i][2] = n;
  else { if (r.targets.length >= TARGET_MAX) return { ok: false, reason: `at most ${TARGET_MAX} targets` }; r.targets.push([k, mm, n]); }
  r.targets.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : (a[1] || '') < (b[1] || '') ? -1 : (a[1] || '') > (b[1] || '') ? 1 : 0));
  return { ok: true };
}
/** A recipe may be worked now (its research known). */
const recipeOk = (s, r) => !r.tech || hasTech(s, r.tech);
/** Does recipe r make product (k, m) as an 'until' bill counts it? m null: any material. */
function makes(r, k, m) {
  const p = untilProduct(r);
  if (!p || p.k !== k) return false;
  return !m || p.m === m;
}
/**
 * The bench and recipe that would make (k, m): recipes in data order, finished benches by id; a bench whose
 * bills are full is skipped unless it already holds the bill (`keep`). null when no bench in the hold can.
 */
export function benchFor(s, k, m = null, keepKey = null) {
  for (const r of all('recipe')) {
    if (!makes(r, k, m) || !recipeOk(s, r)) continue;
    for (const b of s.bld) {
      if (!b || b.st !== 'done' || !r.bench.includes(b.def)) continue;
      const has = keepKey && b.bills.some((x) => x.steward === keepKey);
      if (!has && b.bills.length >= MAX_BILLS) continue;
      return { b, r };
    }
  }
  return null;
}
/** The Steward's plan: each target with the bench that takes it, or the reason none does. */
export function stewardPlan(s) {
  const st = hasOffice(s, 'steward');
  return targetsOf(s).map((t) => {
    const key = tkey(t.k, t.m), p = benchFor(s, t.k, t.m, key), it = def('item', t.k);
    return { ...t, key, name: it ? it.name : t.k, stock: totalsMat(s, t.k, t.m), bench: p ? p.b.id : null, benchDef: p ? p.b.def : null, recipe: p ? p.r.id : null,
      why: !st ? 'no Steward' : p ? null : 'no bench in the hold can make it' };
  });
}
/** Hourly: targets into bills (with a living Steward), else the Steward's bills are taken down. */
export function stewardHour(s) {
  const live = hasOffice(s, 'steward'), plan = live ? stewardPlan(s) : [], want = new Map(plan.filter((p) => p.bench !== null).map((p) => [p.key, p]));
  for (const b of s.bld) {
    if (!b || !b.bills || !b.bills.length) continue;
    for (let j = b.bills.length - 1; j >= 0; j--) {
      const bl = b.bills[j];
      if (!bl.steward) continue;
      const p = want.get(bl.steward);
      if (p && p.bench === b.id && p.recipe === bl.recipe) { if (bl.n !== p.n || bl.mode !== 'until') { bl.n = p.n; bl.mode = 'until'; } want.delete(bl.steward); }
      else b.bills.splice(j, 1);
    }
  }
  for (const p of want.values()) {
    const b = s.bld[p.bench];
    if (b && b.bills.length < MAX_BILLS) b.bills.push(newBill(p.recipe, { mode: 'until', n: p.n, steward: p.key }));
  }
}

// ---- the Reckoner ----------------------------------------------------------------------------------------------
/** A count as the Stock tab shows it: exact with a Reckoner, else rounded above 20 ("about 40"). */
export function stockLabel(s, n) {
  if (hasOffice(s, 'reckoner') || n <= 20) return String(n);
  const r = n < 100 ? 10 : n < 1000 ? 50 : 100;
  return `about ${Math.round(n / r) * r}`;
}

// ---- requests: room needs --------------------------------------------------------------------------------------
/** Every room with its info, the defs it holds and the owners of its beds (one pass; ids ascending). */
export function roomsList(s) {
  const out = [], rooms = s.rt.rooms || [];
  for (let id = 1; id < rooms.length; id++) {
    if (!roomById(s, id)) continue;
    const info = roomInfo(s, id);
    if (!info) continue;
    const defs = new Set(), beds = [];
    for (const bid of info.contents) { const b = s.bld[bid]; if (!b) continue; defs.add(b.def); if (BED_DEFS.includes(b.def) && b.owner !== null && b.owner !== undefined) beds.push(b.owner); }
    out.push({ id, info, defs, beds, ti: Math.max(0, TIER_ORDER.indexOf(info.tier)) });
  }
  return out;
}
function roomFits(R, need, colId) {
  const q = need.room;
  if (q.role && R.info.role !== q.role) return false;
  if (q.notRole && q.notRole.includes(R.info.role)) return false;
  if (q.tier && R.ti < TIER_ORDER.indexOf(q.tier)) return false;
  if (q.bed && !R.beds.includes(colId)) return false;
  if (q.has) for (const g of q.has) if (!g.some((d) => R.defs.has(d))) return false;
  return true;
}
const builtAny = (s, defs) => s.bld.some((b) => b && b.st === 'done' && defs.includes(b.def));
/**
 * The needs of every holder, met or not: { officeId: [{ id, label, met, room }] }, holders in OFFICES order;
 * an `own` room (an office) serves the first holder that fits it only.
 */
export function needsView(s, rooms = null) {
  const out = {}, used = new Set();
  let R = rooms;
  for (const o of OFFICES) {
    const c = holderOf(s, o.id);
    if (!c) continue;
    out[o.id] = o.needs.map((nid) => {
      const n = NEEDS[nid];
      if (!n) return { id: nid, label: nid, met: true, room: null };
      if (n.build) return { id: nid, label: n.label, met: builtAny(s, n.build), room: null };
      if (!R) R = roomsList(s);
      const hit = R.find((x) => !(n.room.own && used.has(x.id)) && roomFits(x, n, c.id));
      if (hit && n.room.own) used.add(hit.id);
      return { id: nid, label: n.label, met: !!hit, room: hit ? hit.id : null };
    });
  }
  return out;
}

// ---- thoughts --------------------------------------------------------------------------------------------------
/** Make condition thought id present with stack k (k 0: absent). */
function setCond(s, col, id, k = 1) {
  if (k <= 0) { if (hasThought(col, id)) removeThought(col, id); return; }
  if (!hasThought(col, id) && !addThought(s, col, id)) return;
  const t = col.thoughts.find((x) => x[0] === id);
  if (t && t[2] !== k) t[2] = k;
}
const orderValuing = (s, c) => valueOf(s, c, 'order') >= RULES.orderMin;

// ---- the Thane -------------------------------------------------------------------------------------------------
/** The sum of every other living colonist's opinion of colonist c. */
export function summedOpinion(s, c) {
  let v = 0;
  for (const o of s.col) if (o !== c && alive(o)) v += opinion(s, o.id, c.id);
  return v;
}
/** Who the colonists would choose now: the highest summed opinion (ties: the lower id); not the Lord. Pure. */
export function electThane(s) {
  const lord = holders(s).lord;
  let best = null, bv = -Infinity;
  for (const c of s.col) {
    if (!alive(c) || !adult(c) || c.id === lord) continue;
    const v = summedOpinion(s, c);
    if (v > bv) { bv = v; best = c; }
  }
  return best;
}
function chooseThane(s, yearly) {
  const c = electThane(s);
  if (!c) return;
  const prev = holders(s).thane;
  if (prev === c.id) { if (yearly) letter(s, 'minor', TEXT.thaneKept, '', { name: c.name }); return; }
  const cur = officeOf(s, c.id);
  if (cur && cur !== 'thane') setHolder(s, cur, null);
  setHolder(s, 'thane', c.id);
  addThought(s, c, 'chosen_thane');
  letter(s, 'minor', TEXT.thaneChosen, yearly ? TEXT.thaneChosenText : TEXT.thaneFirstText, { name: c.name });
}

// ---- the Lord or Lady of the Hold --------------------------------------------------------------------------------
const hearthSpot = (s) => {
  const h = s.colony.hearth, b = h && h.id !== null && h.id !== undefined ? s.bld[h.id] : null;
  return b ? [b.x, b.y + 3, b.z | 0] : [s.w >> 1, s.h >> 1, s.zS | 0];
};
/** The Hearthwatch sends a Lord: Hold rank, 20 living colonists, no living Lord, at most once a year. */
export function lordDue(s) {
  const r = officeRec(s);
  if (hasOffice(s, 'lord') || !officeOpen(s, 'lord')) return false;
  return r.lordDay < 0 || dayOf(s.tick) - r.lordDay >= RULES.lordEveryDays;
}
export function lordArrive(s) {
  const r = ensureOffices(s), [x, y, z] = hearthSpot(s);
  const R = realmRec(s), L = R ? liegeCiv(s) : null, kin = R && L !== null ? lordCandidate(s, R, L) : null;
  const title = kin ? (kin.f.sex ? 'Lord' : 'Lady') : hashString(`lord:${s.seed}:${dayOf(s.tick)}`) & 1 ? 'Lady' : 'Lord';
  const lord = generateColonist(s, kin ? { name: figureName(kin.f), ...(def('ancestry', kin.f.people) ? { anc: kin.f.people } : {}) } : {});
  spawnColonist(s, lord, x, y, z);
  addThought(s, lord, 'new_arrival');
  const ret = [];
  for (let k = 0; k < RULES.lordRetainers; k++) {
    const c = generateColonist(s, { req: { skill: 'melee', min: 6 } });
    spawnColonist(s, c, x + k + 1, y, z);
    addThought(s, c, 'new_arrival');
    ret.push(c.id);
  }
  setHolder(s, 'lord', lord.id);
  if (holders(s).thane === lord.id) setHolder(s, 'thane', null);
  r.lord = { title, id: lord.id, arrived: s.tick, retainers: ret };
  r.lordDay = dayOf(s.tick);
  const names = ret.map((id) => colBy(s, id).name);
  const retainers = names.length ? `two retainers, ${names.join(' and ')}` : 'no retainers';
  if (!kin) { letter(s, 'incident', TEXT.lordArrives, TEXT.lordArrivesText, { title, name: lord.name, retainers }); return lord; }
  r.lord.fig = kin.f.id;
  r.wlords = [...(Array.isArray(r.wlords) ? r.wlords : []), kin.f.id];
  addLegend(s, 'c', lord.id, { links: ['wf' + kin.f.id], text: lord.name });
  const env = envoyOf(s, R, L), civ = R.tables.civs[L];
  letter(s, 'incident', TEXT.lordArrives, REALM_TEXT.lordArrivesText + (env ? REALM_TEXT.lordEnvoy : ''), {
    title, name: lord.name, retainers, civ: civText(civ), Civ: capF(civText(civ)), kin: kinWord(kin), ruler: figureName(kin.ruler), envoy: env ? figureName(env) : '' });
  return lord;
}

// ---- world figures (W3.3b; visitors.js reads these too) -------------------------------------------------------
/** The realm words of the offices (original wording; a request moves them into js/data/offices.js TEXT). */
export const REALM_TEXT = Object.freeze({
  lordArrivesText: '{Civ} has sent {title} {name}, {kin} of {ruler}, to take the seat of the hold, with {retainers}. The Thane keeps the title, but the Lord takes precedence.',
  lordEnvoy: ' {envoy}, an envoy of {civ}, rode in with them.',
  tribute: 'Tribute from {civ}',
  tributeText: 'Pleased with how {name} is kept, {civ} sends {what}.',
  tributeEnvoy: 'Pleased with how {name} is kept, {civ} sends {what}, carried by its envoy {envoy}.',
});
const KIN_WORDS = Object.freeze({ child: ['daughter', 'son'], sibling: ['sister', 'brother'], nephew: ['niece', 'nephew'], grandchild: ['granddaughter', 'grandson'], kin: ['kinswoman', 'kinsman'] });
/** The kin degrees of lordCandidate, nearest first. */
export const LORD_KIN = Object.freeze(['child', 'sibling', 'nephew', 'grandchild', 'kin']);
const capF = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);
const kinWord = (k) => KIN_WORDS[k.rel][k.f.sex ? 1 : 0];
/** The age a people's figure is grown at (HISTORY_PEOPLES lifespan[0]). */
export const adultAt = (p) => ((HISTORY_PEOPLES[p] || HISTORY_PEOPLES.human).lifespan || [18])[0];
const deadBit = (s, id) => { const d = (s.realm && s.realm.dead) || []; return ((d[id >> 5] | 0) >>> (id & 31)) & 1; };
/** Is world figure f alive in the realm now: alive at the end of history, not dead since embark (s.realm.dead), born? */
export const figAlive = (s, f) => !!f && f.died === null && !deadBit(s, f.id) && f.born <= ((s.realm && s.realm.year) | 0);
/** Alive and grown (their people's lifespan[0]). */
export const figGrown = (s, f) => figAlive(s, f) && ((s.realm.year | 0) - f.born) >= adultAt(f.people);
/** The world figures in the hold now or for good: its visitors, those who joined it, its Lords. */
export function figsInHold(s) {
  const out = new Set(), c = s.colony || {};
  for (const v of c.visitors || []) if (Number.isInteger(v.fig)) out.add(v.fig);
  for (const id of (c.visitRec && c.visitRec.joined) || []) out.add(id);
  for (const id of officeRec(s).wlords || []) out.add(id);
  return out;
}
/** The ruler of civ L now: the last of its rulers alive in the realm, else its last ruler; null with none. */
export function civRuler(s, R, L) {
  const c = R.tables.civs[L], rs = (c && c.rulers) || [];
  for (let k = rs.length - 1; k >= 0; k--) { const f = R.tables.figures[rs[k]]; if (figAlive(s, f)) return f; }
  return rs.length ? R.tables.figures[rs[rs.length - 1]] || null : null;
}
/**
 * The Lord's world figure (2.7): a younger kin of the liege civ L's ruler, grown, alive, of civ L, not in the hold.
 * Degrees in LORD_KIN order (kin: a younger descendant, to 3 generations, of one of the civ's rulers, or one of the
 * ruler's people bearing the ruler's family name); within one, the eldest, then the lower id. Returns { f, rel, ruler } or null (pure).
 */
export function lordCandidate(s, R = realmRec(s), L = R ? liegeCiv(s) : null) {
  if (!R || L === null || !R.tables.civs[L]) return null;
  const ruler = civRuler(s, R, L);
  if (!ruler) return null;
  const F = R.tables.figures, busy = figsInHold(s), par = (f) => (f && f.kin && f.kin[0] >= 0 ? F[f.kin[0]] || null : null);
  const ok = (f) => f && f.id !== ruler.id && f.civ === L && f.born > ruler.born && !busy.has(f.id) && figGrown(s, f);
  const house = new Set(R.tables.civs[L].rulers || []);
  const degree = (f) => {
    const p = par(f), g = par(p);
    if (p && p.id === ruler.id) return 0;
    if (p && ruler.kin && p.id === ruler.kin[0]) return 1;
    if (g && ruler.kin && g.id === ruler.kin[0]) return 2;
    if (g && g.id === ruler.id) return 3;
    for (let a = p, k = 0; a && k < 3; a = par(a), k++) if (house.has(a.id)) return 4;
    return f.people === ruler.people && f.nm && ruler.nm && f.nm[1] === ruler.nm[1] ? 4 : -1;   // of the ruler's house name
  };
  let best = null, bd = 9;
  for (const f of F) {
    if (!ok(f)) continue;
    const d = degree(f);
    if (d < 0 || d > bd) continue;
    if (d < bd || f.born < best.born || (f.born === best.born && f.id < best.id)) { best = f; bd = d; }
  }
  return best ? { f: best, rel: LORD_KIN[bd], ruler } : null;
}
/** The world figure of the hold's Lord (officeRec.lord.fig), or null. */
export function lordFigure(s, R = realmRec(s)) {
  const l = officeRec(s).lord;
  return R && l && Number.isInteger(l.fig) ? R.tables.figures[l.fig] || null : null;
}
/** The envoy civ L sends now (2.7): a living grown envoy of L not in the hold, turning by the world year; else null. */
export function envoyOf(s, R, L) {
  if (!R || L === null || L === undefined) return null;
  const busy = figsInHold(s), list = (R.tables.figures || []).filter((f) => f && f.civ === L && f.role === 'envoy' && !busy.has(f.id) && figGrown(s, f));
  return list.length ? list[((s.realm.year | 0) >>> 0) % list.length] : null;
}

// ---- mandates --------------------------------------------------------------------------------------------------
const h32 = (s, ...parts) => hashString(`${parts.join(':')}:${s.seed}`);
const itemName = (k, m, n = 2) => {
  const it = def('item', k), md = m ? def('material', m) : null;
  const base = (it ? it.name : k).toLowerCase();
  return `${md ? md.name.toLowerCase() + ' ' : ''}${base}${n > 1 && !/s$/.test(base) ? 's' : ''}`;
};
/** Items of (k, m) anywhere in the hold (stockpiled or not, forbidden or not): what a Make mandate counts. */
export function heldCount(s, k, m = null) {
  const a = s.rt.idx && s.rt.idx.items ? s.rt.idx.items[k] : null;
  let n = 0;
  if (a) for (let j = 0; j < a.length; j++) { const it = s.items[a[j]]; if (it && (!m || it.m === m)) n += it.n; }
  return n;
}
function holdHasMaterial(s, m) { let f = false; forEachItem(s, (it) => { if (!f && it.m === m) f = true; }); return f; }
/** A Make mandate the noble would ask for now, or null (pure). */
export function makeMandateFor(s, noble, office) {
  const psy = psyOf(s, noble);
  const liked = psy.p.filter((x) => x[0] === 'item').map((x) => x[1]);
  const can = (k) => !!def('item', k) && !!benchFor(s, k, null);
  let k = liked.find(can) || null;
  if (!k) { const pool = MANDATE.kinds.filter(can); if (pool.length) k = pool[h32(s, 'mk', dayOf(s.tick), noble.id) % pool.length]; }
  if (!k) return null;
  // the material: the noble's liked material when a recipe makes this kind of it and the hold has seen it
  let m = null;
  const lm = psy.p.find((x) => x[0] === 'material');
  if (lm && all('recipe').some((r) => r.out && r.out[0] && r.out[0].k === k && r.out[0].matFrom !== undefined) && holdHasMaterial(s, lm[1])) m = lm[1];
  const spec = MANDATE.make[office];
  return { kind: 'make', k, m, n: spec.n, days: spec.days };
}
export function keepMandateFor(s, noble) {
  const pool = KEEP_KINDS.filter(([k, m]) => def('item', k) && totalsMat(s, k, m) > 0);
  if (!pool.length) return null;
  const [k, m] = pool[h32(s, 'kp', dayOf(s.tick), noble.id) % pool.length];
  return { kind: 'keep', k, m, n: 0 };
}
const mandateWhat = (md) => (md.kind === 'make' ? `${md.n} ${itemName(md.k, md.m, md.n)}` : itemName(md.k, md.m));
function openMandate(s, noble, office) {
  const r = ensureOffices(s), day = dayOf(s.tick);
  const keep = h32(s, 'kind', day, noble.id) % 100 < MANDATE.keepPct;
  const md = (keep && keepMandateFor(s, noble)) || makeMandateFor(s, noble, office);
  if (!md) return null;
  const seasonEnd = (Math.floor(day / DAYS_PER_SEASON) + 1) * DAYS_PER_SEASON * TICKS_PER_DAY;
  const rec = { id: r.mandateId++, by: noble.id, office, kind: md.kind, k: md.k, m: md.m, n: md.n, base: md.kind === 'make' ? heldCount(s, md.k, md.m) : 0,
    open: s.tick, due: md.kind === 'make' ? s.tick + md.days * TICKS_PER_DAY : seasonEnd, sold: false };
  s.colony.mandates.push(rec);
  r.lastMandate[noble.id] = day;
  const tpl = md.kind === 'make' ? TEXT.mandateMake : TEXT.mandateKeep;
  letter(s, 'minor', 'A mandate', tpl, { title: office === 'lord' ? lordTitle(s) : 'Thane', name: noble.name, n: md.n, what: md.kind === 'make' ? itemName(md.k, md.m, md.n) : itemName(md.k, md.m), days: md.days });
  return rec;
}
/** Progress of a Make mandate: made so far (stock above the stock when it opened). */
export const mandateMade = (s, md) => (md.kind === 'make' ? Math.max(0, heldCount(s, md.k, md.m) - md.base) : 0);
let brokenHook = null;
/** Justice (Z2.12): fn(s, mandate) -> true when it opened a case for the broken mandate. */
export function setMandateBrokenHook(fn) { brokenHook = fn || null; }
function closeMandate(s, md, met) {
  const r = ensureOffices(s), noble = colBy(s, md.by);
  s.colony.mandates.splice(s.colony.mandates.indexOf(md), 1);
  if (!alive(noble)) return;
  if (met) {
    addThought(s, noble, 'mandate_met');
    const dom = RENOWN_DOMAINS.indexOf(DOMAIN_OF[md.k] || 'smithing');
    if (dom >= 0) r.bonus[dom] += 2;
    if (md.office === 'lord') addGoodwill(s, 'hearthwatch', RULES.goodwillMet);
    letter(s, 'minor', 'A mandate met', TEXT.mandateMet, { what: mandateWhat(md), name: noble.name });
  } else {
    addThought(s, noble, 'mandate_broken');
    r.brokenDay = dayOf(s.tick);
    if (md.office === 'lord') addGoodwill(s, 'hearthwatch', RULES.goodwillBroken);
    const handled = brokenHook ? !!brokenHook(s, md) : false;
    if (!handled) for (const c of s.col) if (alive(c) && c !== noble && orderValuing(s, c)) addThought(s, c, 'mandate_ignored');
    letter(s, 'minor', 'A mandate broken', TEXT.mandateBroken, { what: mandateWhat(md), name: noble.name });
  }
}
/** Trade (trade.js): is (k, m) barred from leaving the hold by a Keep mandate? */
export function mandateBars(s, k, m = null) { return mandatesOf(s).some((md) => md.kind === 'keep' && !md.sold && md.k === k && (!md.m || md.m === m)); }
/** Trade (trade.js): n of (k, m) left the hold; a Keep mandate on it is broken. */
export function noteTradeOut(s, k, m = null, n = 1) {
  if (n <= 0) return;
  for (const md of mandatesOf(s)) if (md.kind === 'keep' && md.k === k && (!md.m || md.m === m)) md.sold = true;
}
/** The renown points met mandates have earned, by RENOWN_DOMAINS (renown.js, Z2.4). */
export const mandateRenown = (s) => officeRec(s).bonus.slice();

function mandateDay(s) {
  for (const md of mandatesOf(s).slice()) {
    if (!alive(colBy(s, md.by)) || holders(s)[md.office] !== md.by) { s.colony.mandates.splice(s.colony.mandates.indexOf(md), 1); continue; }
    if (md.kind === 'make' && mandateMade(s, md) >= md.n) closeMandate(s, md, true);
    else if (md.kind === 'keep' && md.sold) closeMandate(s, md, false);
    else if (s.tick >= md.due) closeMandate(s, md, md.kind === 'keep');
  }
  const r = officeRec(s), day = dayOf(s.tick);
  for (const id of NOBLES) {
    const c = holderOf(s, id);
    if (!c || mandatesOf(s).some((md) => md.by === c.id)) continue;
    const last = r.lastMandate[c.id];
    const since = last === undefined ? Math.floor((s.tick - (r.holderSince[id] >= 0 ? r.holderSince[id] : s.tick)) / TICKS_PER_DAY) : day - last;
    if (since < MANDATE.gapDays) continue;
    if (h32(s, 'open', day, c.id) % 100 < MANDATE.openPct) openMandate(s, c, id);
  }
}

// ---- letters ---------------------------------------------------------------------------------------------------
const fill = (t, v) => String(t).replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined && v[k] !== null ? String(v[k]) : ''));
function letter(s, kind, title, text, vars) {
  if (!s.st) return;
  sendLetter(s, kind, { title: fill(title, vars), text: fill(text || title, vars), data: { k: 'office' } });
}

// ---- the daily and yearly steps ----------------------------------------------------------------------------------
function needsDay(s) {
  const r = ensureOffices(s), view = needsView(s), now = s.tick, grace = RULES.unmetGraceDays * TICKS_PER_DAY;
  const season = DAYS_PER_SEASON * TICKS_PER_DAY;
  let noblesUnmet = 0;
  for (const o of OFFICES) {
    const c = holderOf(s, o.id);
    if (!c) { r.since[o.id] = -1; continue; }
    const unmet = (view[o.id] || []).some((n) => !n.met);
    if (!unmet) r.since[o.id] = -1;
    else if (!(r.since[o.id] >= 0)) r.since[o.id] = now;
    const late = unmet && now - r.since[o.id] >= grace;
    const k = late ? Math.min(RULES.unmetMax, RULES.unmetStart + Math.floor((now - r.since[o.id] - grace) / season) * RULES.unmetPerSeason) : 0;
    setCond(s, c, 'office_unmet', k);
    if (late && NOBLES.includes(o.id)) { noblesUnmet++; if (s.colony.factions) addGoodwill(s, 'hearthwatch', RULES.nobleGoodwill); }
  }
  // holders who lost their office keep no office thought
  const h = holders(s);
  for (const c of s.col) if (alive(c) && hasThought(c, 'office_unmet') && !OFFICE_IDS.some((o) => h[o] === c.id)) removeThought(c, 'office_unmet');
  const thane = holderOf(s, 'thane'), wellLed = !!thane && thane.mood >= RULES.wellLedMood * FIX;
  for (const c of s.col) {
    if (!alive(c)) continue;
    setCond(s, c, 'well_led', wellLed ? 1 : 0);
    setCond(s, c, 'nobles_poorly_kept', noblesUnmet && orderValuing(s, c) ? 1 : 0);
  }
}
function yearSnapshot(s) {
  return [livingCount(s), s.next && s.next.col !== undefined ? s.next.col : 0, s.col.filter((c) => c.hp.dead).length];
}
function yearsTurning(s) {
  const r = ensureOffices(s), year = Math.floor(dayOf(s.tick) / DAYS_PER_YEAR);
  if (officeOpen(s, 'thane')) chooseThane(s, true);
  // tribute: a Lord kept well (every need met, no mandate broken this year) and the Hearthwatch friendly enough
  const lord = holderOf(s, 'lord');
  if (lord && !(r.since.lord >= 0) && (r.brokenDay < 0 || dayOf(s.tick) - r.brokenDay > DAYS_PER_YEAR) && goodwill(s, 'hearthwatch') >= RULES.tributeGoodwill) {
    const [x, y, z] = hearthSpot(s), turn = year % 3;
    let what;
    if (turn === 0 && def('item', 'ingot')) { spawn(s, 'ingot', 'silver', 0, RULES.tributeSilver, x, y, { z }); what = `${RULES.tributeSilver} silver ingots`; }
    else if (turn === 1 && def('item', 'cutgem')) { spawn(s, 'cutgem', null, 0, RULES.tributeGems, x, y, { z }); what = `${RULES.tributeGems} cut gems`; }
    else { const c = generateColonist(s); spawnColonist(s, c, x, y, z); addThought(s, c, 'new_arrival'); what = `${c.name}, who will live and work here`; }
    const R = lordFigure(s) ? realmRec(s) : null, L = R ? liegeCiv(s) : null, env = R && L !== null ? envoyOf(s, R, L) : null;
    if (R && L !== null && R.tables.civs[L]) letter(s, 'minor', REALM_TEXT.tribute, env ? REALM_TEXT.tributeEnvoy : REALM_TEXT.tributeText, { name: `${lordTitle(s)} ${lord.name}`, what, civ: civText(R.tables.civs[L]), envoy: env ? figureName(env) : '' });
    else letter(s, 'minor', TEXT.tribute, TEXT.tributeText, { name: `${lordTitle(s)} ${lord.name}`, what });
  }
  // the Keeper's summary letter
  if (hasOffice(s, 'keeper') && r.year) {
    const [, nextCol, dead0] = r.year, born = s.col.filter((c) => c.id >= nextCol).length, died = Math.max(0, s.col.filter((c) => c.hp.dead).length - dead0);
    const t = tierDef(s), w = computeWealth(s).total, md = r.bonus.reduce((a, b) => a + b, 0);
    letter(s, 'minor', TEXT.summary, TEXT.summaryText, { year, alive: livingCount(s), born, died, rank: t ? t.name : 'Camp', extra: `Its wealth is ${w}.${md ? ` Its nobles' mandates have been met ${md / 2} times.` : ''}` });
  }
  r.year = yearSnapshot(s);
}

/** Tick system (slot 'colony'): hourly the Steward, vacated offices, the Thane's first choosing and the Lord;
 * at midnight the requests, thoughts and mandates; at the Year's Turning the Thane, tribute and the summary. */
export function officesSystem(s) {
  if (s.tick % TICKS_PER_HOUR !== 0) return;
  const r = ensureOffices(s);
  // the dead and the departed leave their offices
  const h = holders(s);
  for (const o of OFFICE_IDS) if (h[o] !== undefined && !alive(colBy(s, h[o]))) setHolder(s, o, null);
  if (!r.year) r.year = yearSnapshot(s);
  stewardHour(s);
  if (!holderOf(s, 'thane') && officeOpen(s, 'thane')) chooseThane(s, false);
  if (lordDue(s)) lordArrive(s);
  if (s.tick % TICKS_PER_DAY !== 0) return;
  needsDay(s);
  mandateDay(s);
  const day = dayOf(s.tick);
  if (day > 0 && day % DAYS_PER_YEAR === 0) yearsTurning(s);
}

// ---- commands --------------------------------------------------------------------------------------------------
export const officeCmd = (s, c) => appoint(s, c.id, c.colId === undefined ? null : c.colId);
export const stockTargetCmd = (s, c) => setStockTarget(s, c.k, c.m || null, c.n);
/** Register the appliers of `office` and `stockTarget` once A's command specs exist (idempotent). */
export function installOffices() {
  if ('office' in COMMANDS) registerApplier('office', officeCmd);
  if ('stockTarget' in COMMANDS) registerApplier('stockTarget', stockTargetCmd);
}

/** Everything the Offices screen shows (pure). */
export function officesView(s) {
  const needs = needsView(s), r = officeRec(s), now = s.tick;
  return OFFICES.map((o) => {
    const c = holderOf(s, o.id);
    const since = r.since[o.id];
    return {
      id: o.id, name: officeName(s, o.id), by: o.by, verb: o.verb, openText: o.open, open: officeOpen(s, o.id) || !!c,
      holder: c ? { id: c.id, name: c.name } : null, needs: needs[o.id] || o.needs.map((n) => ({ id: n, label: (NEEDS[n] || {}).label || n, met: false })),
      unmetDays: c && since >= 0 ? Math.floor((now - since) / TICKS_PER_DAY) : 0,
      mandates: mandatesOf(s).filter((m) => m.office === o.id).map((m) => ({ ...m, what: mandateWhat(m), made: mandateMade(s, m), daysLeft: Math.max(0, Math.ceil((m.due - now) / TICKS_PER_DAY)) })),
      score: o.id === 'thane' && c ? summedOpinion(s, c) : null,
    };
  });
}
