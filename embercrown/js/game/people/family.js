// Births, children and teens (EMBERCROWN-FORTRESS.md 3.13, F14; step Z2.8). Owner F. Data: js/data/visitors.js
// FAMILY (the nursery is a room role in js/data/rooms.js). Births are ON by default; Settings > Hold turns them
// off (owner decision 6), through the `births { on }` command.
//
// Saved state: s.colony.family (plain JSON on the colony record, so the colony codec saves it and the state hash
// covers it; created by ensureFamily on the first family step, the same tick in an uninterrupted run and in a
// loaded one, so v2 fixtures and Z1 saves load with none and continue):
//   { v: 1, on: bool, kids: [[colId, bornTick, bearerId, otherId, stage]] sorted by colId (stage 0 child, 1 teen,
//     2 grown), light: [[colId, untilTick]] sorted by colId (a bearer's light work) }
//   (A: please add `family: null` to schema.newColonyRecord() so the field is part of C2-full.)
//
// Rules (3.13):
//   - once a season (day 0 of the season, FAMILY.seasonHour) every pair of living spouses whose beds stand in the
//     same Fine+ bedroom may have a child: hash3(seed, pairKey, season index) % 1000 < birthPermille, x bigPct with
//     more than bigHold colonists, x lowFoodPct under lowFoodDays of food. Never past the hard cap: the head count
//     (children at one half, headCount) plus the child must stay <= CAPS.colonistsHard. The bearer is the
//     younger spouse aged 18-50 (the lower id on a tie) and has at most one child per birthGapDays.
//   - the child: the bearer's ancestry and family name, age 0, no skill levels, each facet one parent's +-1
//     (hash3), kin to both parents; laid in a nursery cradle when the hold has one, else at the bearer's bed.
//     Parents "My child was born", everyone else "A birth in the hold"; a Chronicle line, a minor letter, the
//     Annals (a colonist record linked to the parents and a birth event). The bearer works at lightPct for
//     lightDays.
//   - children (age < childTo) do no work (every priority off, custom) and never soldier; at childTo they become
//     teens: their roles' priorities come back, they work at teenPct speed and still never soldier; at teenTo they
//     are grown ("came of age"). Ages advance with health.js birthdays (one game year per year of age).
//   - a child learns by watching: x childXpPct of every XP award a parent earns on the same level, through the
//     work XP hook (familyXp). A child's death: "My child died" for the parents on top of death.js's kin grief
//     (Kin x2), "A child of the hold died" for everyone else.
//   - headCount(s): the R2 population caps count children at one half (H / K: migrant and petition checks).
//
// Determinism: every roll is hash3 of the seed and ids; the only RNG draw is generateColonist (streams 'main'
// and 'names') at a birth. No rt key is added.
//
// Hooks into other owners' code (requests in the Z2.8 report):
//   people/index.js (F)  installFamily() after installPeople (wraps the work hooks speed and xp, the BUS.kill
//                        listener, the 'social' slot system 'family' at order 30, the births applier)
//   commands.js (A)      `births { on: bool }`; installFamily registers the applier once the spec exists
//   draft.js (F)         draftVeto: 'too young' when canSoldier(col) is false
//   events2.js (H)       tierMigrants: headCount(s) in place of the living count
//   ui (I)               Settings > Hold: a "Births" switch (birthsOn / the births command); the colonist card
//                        shows lifeStage(col) and parentsOf(s, col.id)

import { TICKS_PER_HOUR, TICKS_PER_DAY, DAYS_PER_SEASON } from '../core/time.js';
import { BUS } from '../core/bus.js';
import { COMMANDS, registerApplier } from '../core/commands.js';
import { workHooks, setWorkHooks } from '../work/jobs.js';
import { colTile } from '../work/reserve.js';
import { bldById } from '../core/state.js';
import { idx } from '../core/grid.js';
import { roomInfo } from '../world/rooms.js';
import { CAPS } from '../../data/balance.js';
import { FAMILY, WORDS } from '../../data/visitors.js';
import { def } from './defs.js';
import { generateColonist, spawnColonist } from './colonists.js';
import { applyRoles } from './roles.js';
import { addThought } from './mood.js';
import { kindOf, setKind, pairKey } from './social.js';
import { getKey, putKey, hash3 } from './peoplerec.js';
import { psyOf, setPsy } from './personality.js';
import { addChron } from '../colony/chronicle.js';
import { addLegend, legendEvent } from '../colony/legends.js';
import { sendLetter, fillText } from '../threat/letters.js';

const F = FAMILY;
const SEASON_TICKS = DAYS_PER_SEASON * TICKS_PER_DAY;
const b36 = (n) => (n >>> 0).toString(36);

// ---- the record ------------------------------------------------------------------------------------------------
const newRec = () => ({ v: 1, on: true, kids: [], light: [] });
const EMPTY = Object.freeze(newRec());
/** The family record (read only; births on before the first write). */
export const familyRec = (s) => (s && s.colony && s.colony.family) || EMPTY;
export function ensureFamily(s) {
  const c = s.colony;
  if (!c.family || typeof c.family !== 'object') c.family = newRec();
  const r = c.family;
  if (typeof r.on !== 'boolean') r.on = true;
  if (!Array.isArray(r.kids)) r.kids = [];
  if (!Array.isArray(r.light)) r.light = [];
  return r;
}
/** Births on (the default) or off. */
export const birthsOn = (s) => familyRec(s).on !== false;
/** Settings > Hold "Births" (the births command). */
export function setBirths(s, on) { ensureFamily(s).on = !!on; return { ok: true }; }

// ---- ages and the head count -----------------------------------------------------------------------------------
/** 'child' | 'teen' | 'adult' by age. */
export function lifeStage(col) {
  const a = col && col.age !== undefined ? col.age | 0 : 30;
  return a < F.childTo ? 'child' : a < F.teenTo ? 'teen' : 'adult';
}
export const isChild = (col) => lifeStage(col) === 'child';
/** May this colonist soldier (draft.js veto)? Never a child or a teen. */
export const canSoldier = (col) => lifeStage(col) === 'adult';
/** The R2 population caps' head count: the living, children at one half (rounded down). */
export function headCount(s) {
  let n2 = 0;
  for (const c of s.col) if (c && !c.hp.dead) n2 += isChild(c) ? (2 * F.childHeadPct) / 100 : 2;
  return Math.floor(n2 / 2);
}
const living = (s) => { let n = 0; for (const c of s.col) if (c && !c.hp.dead) n++; return n; };
/** Work speed percent from age and light work (100 for a grown colonist at full work). */
export function familyWorkPct(s, col) {
  let p = lifeStage(col) === 'teen' ? F.teenPct : 100;
  const l = getKey(familyRec(s).light, col.id);
  if (l && s.tick < l[1]) p = Math.floor((p * F.lightPct) / 100);
  return p;
}
/** The parents' ids of a colonist ([] for one born outside the hold). */
export function parentsOf(s, colId) { const k = getKey(familyRec(s).kids, colId); return k ? [k[2], k[3]].filter((x) => x !== null && x >= 0) : []; }
/** The living children (age < childTo) of a colonist. */
export function childrenOf(s, colId) {
  const out = [];
  for (const k of familyRec(s).kids) {
    if (k[2] !== colId && k[3] !== colId) continue;
    const c = colById(s, k[0]);
    if (c && !c.hp.dead && isChild(c)) out.push(c);
  }
  return out;
}
/** Where a child wants to be (the nearer living parent's tile; a think hook can walk them there). */
export function followTarget(s, col) {
  if (!isChild(col)) return null;
  let best = null, bd = Infinity;
  for (const pid of parentsOf(s, col.id)) {
    const p = colById(s, pid);
    if (!p || p.hp.dead) continue;
    const d = Math.abs(p.x - col.x) + Math.abs(p.y - col.y) + 1000 * Math.abs((p.z | 0) - (col.z | 0));
    if (d < bd) { bd = d; best = p; }
  }
  return best ? colTile(best) : null;
}
const colById = (s, id) => { for (const c of s.col) if (c && c.id === id) return c; return null; };

// ---- couples and the season roll -------------------------------------------------------------------------------
function foodDaysOf(s) {
  let nutr = 0;
  const st = (s.rt && s.rt.stock) || {};
  for (const k of Object.keys(st).sort()) { const d = def('item', k); if (d && d.food) nutr += (d.food.nutr | 0) * st[k]; }
  const n = living(s);
  return n ? Math.floor(nutr / (n * 32)) : 99;
}
/** The bedroom room record both spouses' beds stand in, when it is a bedroom at Fine or better; else null. */
export function sharedFineBedroom(s, a, b) {
  if (a.bed === null || b.bed === null || a.bed === undefined || b.bed === undefined) return null;
  const ba = bldById(s, a.bed), bb = bldById(s, b.bed);
  if (!ba || !bb || ba.st !== 'done' || bb.st !== 'done') return null;
  const ra = s.rt.room[idx(ba.x, ba.y, ba.z | 0)], rb = s.rt.room[idx(bb.x, bb.y, bb.z | 0)];
  if (!ra || ra !== rb) return null;
  const info = roomInfo(s, ra);
  return info && info.role === 'bedroom' && info.tierIdx >= F.fineTier ? info : null;
}
/** Living spouse pairs [a, b] (a.id < b.id), id order. */
export function couples(s) {
  const out = [], alive = s.col.filter((c) => c && !c.hp.dead && lifeStage(c) === 'adult');
  for (let i = 0; i < alive.length; i++) for (let j = i + 1; j < alive.length; j++) {
    const a = alive[i], b = alive[j];
    if (kindOf(s, a.id, b.id) === 'spouse') out.push(a.id < b.id ? [a, b] : [b, a]);
  }
  return out;
}
function bearerOf(s, a, b) {
  const ok = (c) => (c.age | 0) >= F.bearerAge[0] && (c.age | 0) <= F.bearerAge[1];
  const cand = [a, b].filter(ok).sort((p, q) => (p.age | 0) - (q.age | 0) || p.id - q.id);
  if (!cand.length) return null;
  const c = cand[0], last = familyRec(s).kids.reduce((t, k) => (k[2] === c.id && k[1] > t ? k[1] : t), -Infinity);
  return s.tick - last >= F.birthGapDays * TICKS_PER_DAY ? c : null;
}
/** The birth chance in permille for the hold as it stands (0 when off or at the cap). */
export function birthPermille(s) {
  if (!birthsOn(s)) return 0;
  const cap = CAPS.colonistsHard;
  // a child counts one half: one more must keep the head count at or under the hard cap
  let n2 = 0;
  for (const c of s.col) if (c && !c.hp.dead) n2 += isChild(c) ? 1 : 2;
  if (n2 + 1 > 2 * cap) return 0;
  let p = F.birthPermille;
  if (living(s) > F.bigHold) p = Math.floor((p * F.bigPct) / 100);
  if (foodDaysOf(s) < F.lowFoodDays) p = Math.floor((p * F.lowFoodPct) / 100);
  return p;
}
/** The season's roll (sim): every eligible couple may have a child. Returns the children born. */
export function seasonRoll(s) {
  const born = [];
  const season = Math.floor(s.tick / SEASON_TICKS);
  for (const [a, b] of couples(s)) {
    const p = birthPermille(s);
    if (p <= 0) break;
    if (!sharedFineBedroom(s, a, b)) continue;
    const bearer = bearerOf(s, a, b);
    if (!bearer) continue;
    if (hash3(s.seed >>> 0, pairKey(a.id, b.id), season) % 1000 >= p) continue;
    born.push(birth(s, bearer, bearer === a ? b : a));
  }
  return born;
}

// ---- a birth ---------------------------------------------------------------------------------------------------
function cradleTile(s, bearer) {
  // a free cradle in a nursery first (id order), then the bearer's bed
  for (const b of s.bld) {
    if (!b || b.def !== 'cradle' || b.st !== 'done') continue;
    const r = s.rt.room[idx(b.x, b.y, b.z | 0)], info = r ? roomInfo(s, r) : null;
    if (info && info.role === 'nursery') return [b.x, b.y, b.z | 0];
  }
  const bed = bearer.bed !== null && bearer.bed !== undefined ? bldById(s, bearer.bed) : null;
  if (bed) return [bed.x, bed.y, bed.z | 0];
  return [Math.floor(bearer.x / 32), Math.floor(bearer.y / 32), bearer.z | 0];
}
const familyName = (name) => { const p = String(name).split(' '); return p.length > 1 ? p.slice(1).join(' ') : p[0]; };
/** A child is born to `bearer` and `other` (sim; tests call it directly). Returns the child. */
export function birth(s, bearer, other) {
  const rec = ensureFamily(s);
  const c = generateColonist(s, { anc: bearer.anc });
  c.name = `${String(c.name).split(' ')[0]} ${familyName(bearer.name)}`;
  c.age = 0;
  c.bs = [null, null];
  for (const x of c.sk) { x[0] = 0; x[1] = 0; x[3] = 0; }
  c.role = ['generalist', null];
  c.soldier = false; c.squad = null; c.drafted = false;
  quietChild(c);
  // facets: each one parent's +-1
  const pa = psyOf(s, bearer), pb = other ? psyOf(s, other) : pa;
  const f = pa.f.map((v, k) => {
    const h = hash3(s.seed >>> 0, c.id, 0xfa0 + k), from = h % 2 === 0 ? v : pb.f[k];
    return Math.max(-3, Math.min(3, (from | 0) + ((h >>> 1) % (2 * F.facetSpread + 1)) - F.facetSpread));
  });
  const [x, y, z] = cradleTile(s, bearer);
  spawnColonist(s, c, x, y, z);
  setPsy(s, c, { f });
  for (const p of [bearer, other]) if (p) setKind(s, c.id, p.id, 'kin');
  putKey(rec.kids, [c.id, s.tick, bearer.id, other ? other.id : -1, 0]);
  putKey(rec.light, [bearer.id, s.tick + F.lightDays * TICKS_PER_DAY]);
  for (const o of s.col) {
    if (!o || o.hp.dead || o === c) continue;
    addThought(s, o, o === bearer || o === other ? 'child_born' : 'birth_in_hold');
  }
  const vars = { name: c.name, a: bearer.name, b: other ? other.name : bearer.name };
  addChron(s, 'people', 'chron_birth', { ...vars, colId: c.id });
  const key = addLegend(s, 'c', c.id, { links: ['c' + b36(bearer.id), other ? 'c' + b36(other.id) : null] });
  legendEvent(s, 'birth', [key]);
  sendLetter(s, 'minor', { title: WORDS.birthTitle, text: fillText(WORDS.birthText, vars), data: { colId: c.id } });
  return c;
}
/** A child does no work and never soldiers. */
function quietChild(c) {
  c.custom = true;
  c.prio = new Uint8Array(c.prio.length);
  c.soldier = false;
  c.drafted = false;
}

// ---- the daily step --------------------------------------------------------------------------------------------
/** Daily (sim): children stay off work; teens get their work back; the grown leave the kids list's care. */
export function familyDay(s) {
  const rec = ensureFamily(s);
  rec.light = rec.light.filter((l) => l[1] > s.tick);
  for (const k of rec.kids) {
    const c = colById(s, k[0]);
    if (!c || c.hp.dead) continue;
    const st = lifeStage(c), stage = st === 'child' ? 0 : st === 'teen' ? 1 : 2;
    if (stage === 0) quietChild(c);
    else if (k[4] === 0) { c.custom = false; applyRoles(s, c); }
    if (stage < 2) { c.soldier = false; c.drafted = false; }
    if (stage === 2 && k[4] < 2) addChron(s, 'people', 'chron_grown', { name: c.name, colId: c.id });
    k[4] = stage;
  }
}
/** The 'social' slot system: the season's roll and the daily step. */
export function familySystem(s) {
  const t = s.tick;
  if (t % TICKS_PER_DAY === F.dayHour * TICKS_PER_HOUR) familyDay(s);
  if (t % SEASON_TICKS === F.seasonHour * TICKS_PER_HOUR && birthsOn(s)) { ensureFamily(s); seasonRoll(s); }
}

// ---- hooks -----------------------------------------------------------------------------------------------------
/** BUS.kill listener: a child's death. */
export function familyKill(s, victim) {
  if (!victim || !Array.isArray(victim.sk) || !isChild(victim)) return;
  const par = parentsOf(s, victim.id);
  for (const o of s.col) {
    if (!o || o.hp.dead || o === victim) continue;
    addThought(s, o, par.includes(o.id) ? 'lost_child' : 'child_died');
  }
}
/** The work speed hook around base(s, col, toil). */
export const familySpeed = (base) => (s, col, toil) => {
  const v = base(s, col, toil), p = familyWorkPct(s, col);
  return p === 100 ? v : Math.max(1, Math.floor((v * p) / 100));
};
/** The work XP hook around base(s, col, skillId, ticks): the parent's children on the same level learn x childXpPct. */
export const familyXp = (base) => (s, col, skillId, ticks = 1) => {
  const r = base ? base(s, col, skillId, ticks) : 0;
  if (!isChild(col) && familyRec(s).kids.length) {
    for (const ch of childrenOf(s, col.id)) {
      if ((ch.z | 0) !== (col.z | 0) || !base) continue;
      // x childXpPct, the remainder as a hash-rolled tick (awards come one tick at a time)
      const t100 = ticks * F.childXpPct, share = Math.floor(t100 / 100) + (hash3(ch.id, s.tick, ticks) % 100 < t100 % 100 ? 1 : 0);
      if (share > 0) base(s, ch, skillId, share);
    }
  }
  return r;
};
/** Install (idempotent; after installPeople, which sets the base work hooks). */
export function installFamily() {
  const h = workHooks();
  if (!h.speed.family) {
    const sp = familySpeed(h.speed), xp = familyXp(h.xp);
    sp.family = true; xp.family = true;
    setWorkHooks({ speed: sp, xp });
  }
  if (!BUS.kill.includes(familyKill)) BUS.kill.push(familyKill);
  if ('births' in COMMANDS) registerApplier('births', (s, c) => setBirths(s, c.on));
}
