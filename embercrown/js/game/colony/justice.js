// Crime and justice (EMBERCROWN-FORTRESS.md 3.9, F18; step Z2.12). Owner K. Data: js/data/laws.js; the Lockup room
// role: js/data/rooms.js LOCKUP_ROLE; the screen: js/ui/justiceui.js (Colony > Hold > Justice, and the Laws switch
// of Settings > Hold). ON by default (owner decision 1); the `laws { on }` command turns it off, once a season.
//
// Saved state (plain JSON on the colony record, so colonyToPlain / colonyFromPlain save it and the state hash covers
// it; written lazily by the first case, the first command or the first hourly step that has something to do, the
// same tick in an uninterrupted run and in a loaded one, so v2 fixtures and Z1 saves load with none and continue):
//   s.colony.laws        false when the laws are off; absent or true: on (C2 v3 `laws: bool`)
//   s.colony.cases       [Case] oldest first, at most RULES.caseCap (closed cases drop first) (C2 v3 `cases`)
//     Case = { id, kind, off, vic, wit: [colId], sev, open, key, n, what, st: 'open'|'sentenced'|'dropped',
//              sent: { kind: 'confine'|'fine', days, commuted? } | null, heard }   (key: the break it came from)
//   s.colony.justiceRec  { v, next, warden, wardenSince, lawsDay, serving: [Serve], hist: [[colId, tick]], exile }
//     Serve = { colId, kind, until, bed (confine: the cell bed id), caseId, prio, custom }   (sorted by colId)
//     hist: the tick of each sentence, for the offender's record (a year back); exile: [colId] letters waiting
//   (A: please add `laws: true`, `cases: []`, `justiceRec: null` to schema.newColonyRecord(); absent is the same.)
//
// Rules (3.9):
//   - with the laws on, an act opens a case with the offender, the victim and the witnesses (living colonists on the
//     same level within RULES.witnessR tiles with a clear line, at the moment of the act): vandalism (a Tantrum's
//     smash hit; hits of one break fold into one case), theft and assault (reportCrime: F's acts call it), a broken
//     mandate (offices.js hook; the Steward answers for it). A child does not answer for an act. No case with the
//     laws off.
//   - hearing: hourly, a case open RULES.hearingHours or more whose offender is out of any break is sentenced by the
//     Warden of Law. Before the hold is large enough for a Warden (12), cases are settled by common judgement on the
//     same terms. Once the office is open and nobody holds it, cases wait; after RULES.lawlessDays the
//     Order-valuing colonists feel "Lawless hold".
//   - sentence(sev, record) is a pure function (SENTENCE.byScore): a labour fine (2-4 days: work is Haul and Clean
//     only) or confinement in a Lockup (2-5 days, on a free cell bed). With no free cell the confinement is served
//     as a labour fine (SENTENCE.commuteDays). No beatings and no executions.
//   - reactions: "Justice is done" for the Order-valuing; the victim's opinion of the offender +10.
//   - exile: when a sentence makes RULES.exileCases cases in a year, a choice letter asks whether the offender is
//     sent from the hold (default: they stay). Never offered when fewer than RULES.exileMinLeft free colonists
//     would remain: justice never causes a fall (a confined colonist is still free and able in fall.js terms).
//   - Annals: a 'crime' event at each case and a 'sentence' event at each sentence (legends.js).
//
// Determinism: no RNG at all; witnesses, sentences and cells come from the saved state in id order. No rt key.
//
// Hooks into other owners' code (requests in the Z2.12 report):
//   colony/index.js (K)   installJustice() after installPeople and installOffices (wraps the 'smash' toil and the
//                         urgent think hook, sets the mandate hook, registers the 'justice' system and appliers)
//   commands.js (A)       `laws { on: bool }`, `warden { colId: int | null }`; the appliers register once specs exist
//   needjobs.js (F)       theft and assault call reportCrime(s, 'theft' | 'assault', offender, { victim, what, worse })
//   ui (I)                Settings > Hold mounts justiceui.lawsSwitch; Colony > Hold > Justice opens openJustice

import { TICKS_PER_HOUR, TICKS_PER_DAY, DAYS_PER_YEAR, DAYS_PER_SEASON, dayOf, hourOf } from '../core/time.js';
import { FIX, SCHED, WORK_IDS } from '../core/schema.js';
import { idx } from '../core/grid.js';
import { bldById } from '../core/state.js';
import { structDef, def } from '../core/content.js';
import { COMMANDS, registerApplier } from '../core/commands.js';
import { registerSystem, tickSystems } from '../core/bus.js';
import { RUN, NEXT, T, makeJob, registerToil, toilHandler, thinkHooks, setThinkHooks, requestThink, END } from '../work/jobs.js';
import { endJob } from '../work/reserve.js';
import { losClear } from '../systems/pathing.js';
import { roomInfo } from '../world/rooms.js';
import { stage2 } from '../people/defs.js';
import { addThought } from '../people/mood.js';
import { satisfy } from '../people/needs.js';
import { addOpinion, forget } from '../people/social.js';
import { valueOf } from '../people/personality.js';
import { leaveSquad } from '../people/draft.js';
import { setCrimeHook } from '../people/needjobs.js';
import { holdsOn } from './fall.js';
import { legendEvent } from './legends.js';
import { holderOf, officeOf, appoint, setMandateBrokenHook, APPOINTED } from './offices.js';
import { sendLetter, onChoice, fillText } from '../threat/letters.js';
import { CRIMES, CRIME_IDS, SENTENCE, RULES, WARDEN, TEXT } from '../../data/laws.js';

export { CRIMES, CRIME_IDS, WARDEN };
const TILE = 32;
const HAUL = WORK_IDS.indexOf('haul');
const b36 = (n) => (n >>> 0).toString(36);
const colKey = (id) => (id === null || id === undefined ? null : 'c' + b36(id));
const first = (c) => (c && c.name ? c.name.split(' ')[0] : 'Someone');

// ---- the record ------------------------------------------------------------------------------------------------
const newRec = () => ({ v: 1, next: 1, warden: null, wardenSince: -1, lawsDay: -1, serving: [], hist: [], exile: [] });
const EMPTY = Object.freeze(newRec());
/** The justice record (read only; EMPTY before the first write). */
export const justiceRec = (s) => (s && s.colony && s.colony.justiceRec) || EMPTY;
export const casesOf = (s) => (s && s.colony && s.colony.cases) || [];
/** Are the laws kept? On by default (absent means on). */
export const lawsOn = (s) => !!(s && s.colony) && s.colony.laws !== false;
export function ensureJustice(s) {
  const c = s.colony;
  if (typeof c.laws !== 'boolean') c.laws = true;
  if (!Array.isArray(c.cases)) c.cases = [];
  if (!c.justiceRec || typeof c.justiceRec !== 'object') c.justiceRec = newRec();
  const r = c.justiceRec, e = newRec();
  for (const k of Object.keys(e)) if (!(k in r)) r[k] = e[k];
  return r;
}

// ---- people ----------------------------------------------------------------------------------------------------
const colBy = (s, id) => (id === null || id === undefined ? null : s.col.find((c) => c.id === id) || null);
const alive = (c) => !!c && !c.hp.dead && !c.gone;
const adult = (c) => !(c.age !== undefined && c.age < 18);
const living = (s) => s.col.reduce((n, c) => n + (alive(c) ? 1 : 0), 0);
const orderValuing = (s, c) => valueOf(s, c, 'order') >= RULES.orderMin;
const sameTileXY = (c) => [Math.floor(c.x / TILE), Math.floor(c.y / TILE)];

// ---- the Warden of Law -----------------------------------------------------------------------------------------
/** Is the Warden's office open? (12 colonists, laws on.) */
export const wardenOpen = (s) => lawsOn(s) && living(s) >= WARDEN.opens.pop;
/** The living Warden, or null. */
export function wardenOf(s) {
  const c = colBy(s, justiceRec(s).warden);
  return alive(c) && lawsOn(s) ? c : null;
}
/** null when colonist colId may be the Warden, else the reason. */
export function canWarden(s, colId) {
  if (!lawsOn(s)) return 'the laws are off';
  if (colId === null) return null;
  if (!wardenOpen(s)) return `the ${WARDEN.name} is not open yet`;
  const c = colBy(s, colId);
  if (!alive(c)) return 'no such colonist';
  if (!adult(c)) return 'too young for an office';
  const cur = officeOf(s, colId);
  if (cur === 'lord' || cur === 'thane') return `${first(c)} is a noble of the hold`;
  if (servingOf(s, colId)) return `${first(c)} is serving a sentence`;
  return null;
}
/** Appoint (or clear, colId null) the Warden. A colonist with another appointed office leaves it. */
export function appointWarden(s, colId) {
  const why = canWarden(s, colId);
  if (why) return { ok: false, reason: why };
  const r = ensureJustice(s);
  if (colId !== null) { const cur = officeOf(s, colId); if (cur && APPOINTED.includes(cur)) appoint(s, cur, null); }
  r.warden = colId;
  r.wardenSince = colId === null ? -1 : s.tick;
  return { ok: true };
}

// ---- the laws switch -------------------------------------------------------------------------------------------
const seasonIdx = (tick) => Math.floor(dayOf(tick) / DAYS_PER_SEASON);
/** May the laws be changed now? (Once a season.) */
export const lawsChangeable = (s) => { const d = justiceRec(s).lawsDay; return d < 0 || seasonIdx(d * TICKS_PER_DAY) !== seasonIdx(s.tick); };
/** Settings > Hold > Laws (the laws command). Turning them off drops the open cases and ends every sentence. */
export function setLaws(s, on) {
  on = !!on;
  if (on === lawsOn(s)) return { ok: true };
  if (!lawsChangeable(s)) return { ok: false, reason: TEXT.bySeason };
  const r = ensureJustice(s);
  s.colony.laws = on;
  r.lawsDay = dayOf(s.tick);
  if (!on) {
    for (const k of s.colony.cases) if (k.st === 'open') k.st = 'dropped';
    for (const sv of r.serving.slice()) release(s, sv);
    r.warden = null; r.wardenSince = -1; r.exile = [];
  }
  return { ok: true };
}

// ---- cases -----------------------------------------------------------------------------------------------------
/** Living colonists (not the offender) on level z within RULES.witnessR tiles of (x, y) with a clear line. */
export function witnessesAt(s, x, y, z, exceptId = -1) {
  const out = [], R = RULES.witnessR;
  for (const c of s.col) {
    if (!alive(c) || c.id === exceptId || (c.z | 0) !== z || c.hp.down) continue;
    const [cx, cy] = sameTileXY(c);
    if (Math.max(Math.abs(cx - x), Math.abs(cy - y)) > R) continue;
    if (!(cx === x && cy === y) && !losClear(s, c.x, c.y, x * TILE + TILE / 2, y * TILE + TILE / 2, 0, 0, z)) continue;
    out.push(c.id);
  }
  return out.sort((a, b) => a - b);
}
function pushCase(s, k) {
  const L = s.colony.cases;
  L.push(k);
  while (L.length > RULES.caseCap) { const j = L.findIndex((x) => x.st !== 'open'); L.splice(j >= 0 ? j : 0, 1); }
}
/**
 * An act that is a crime while the laws are on: open a case (or fold into the same break's case). Returns the case
 * or null (laws off, no such crime, the offender is a child or gone).
 * @param {{ victim?: number|null, what?: string, worse?: boolean, at?: [x, y, z], key?: number }} [o]
 */
export function reportCrime(s, kind, offender, o = {}) {
  if (!lawsOn(s) || !CRIMES[kind] || !alive(offender) || !adult(offender)) return null;
  const r = ensureJustice(s);
  const key = o.key !== undefined ? o.key : offender.breakState ? offender.breakState.until : s.tick;
  const vic = o.victim === undefined || o.victim === offender.id ? null : o.victim;
  const [x, y, z] = o.at || [...sameTileXY(offender), offender.z | 0];
  const wit = witnessesAt(s, x, y, z, offender.id);
  const same = s.colony.cases.find((k) => k.st === 'open' && k.kind === kind && k.off === offender.id && k.key === key);
  if (same) {
    same.n++;
    for (const w of wit) if (!same.wit.includes(w)) same.wit.push(w);
    same.wit.sort((a, b) => a - b);
    if (vic !== null && same.vic === null) same.vic = vic;
    if ((o.worse || same.n >= 3) && same.sev === CRIMES[kind].sev) same.sev++;
    return same;
  }
  const k = { id: r.next++, kind, off: offender.id, vic, wit, sev: Math.min(4, CRIMES[kind].sev + (o.worse ? 1 : 0)), open: s.tick, key, n: 1,
    what: o.what || '', st: 'open', sent: null, heard: null };
  pushCase(s, k);
  const verb = fillText(CRIMES[kind].verb, { what: k.what || 'something', victim: first(colBy(s, vic)) });
  legendEvent(s, 'crime', [colKey(offender.id), colKey(vic)], fillText(TEXT.annalsCrime, { name: offender.name, verb }));
  return k;
}

/** The pure sentence of a severity and a record (sentenced cases in the last year): { kind, days }. */
export function sentence(sev, record) {
  const B = SENTENCE.byScore, score = Math.max(1, (sev | 0) + Math.min(Math.max(0, record | 0), SENTENCE.recordMax));
  const row = B[Math.min(score, B.length - 1)];
  return { kind: row[0], days: row[1] };
}
/** The offender's record: sentenced cases in the year before tick. */
export function recordOf(s, colId, tick = s.tick) {
  const from = tick - DAYS_PER_YEAR * TICKS_PER_DAY;
  return justiceRec(s).hist.reduce((n, [id, t]) => n + (id === colId && t > from && t <= tick ? 1 : 0), 0);
}

// ---- Lockups and serving -----------------------------------------------------------------------------------------
export const servingOf = (s, colId) => justiceRec(s).serving.find((x) => x.colId === colId) || null;
/** Every finished cell bed in a Lockup room with a door, by id: [{ b, room }]. */
export function lockupCells(s) {
  const out = [];
  if (!s.rt || !s.rt.room) return out;
  for (const b of s.bld) {
    if (!b || b.def !== 'cellbed' || b.st !== 'done') continue;
    const id = s.rt.room[idx(b.x, b.y, b.z | 0)];
    const ri = id ? roomInfo(s, id) : null;
    const rec = id ? s.rt.rooms[id] : null;
    if (!ri || ri.role !== 'lockup' || !rec || !(Array.isArray(rec.doors) ? rec.doors.length : rec.doors)) continue;
    out.push({ b, room: id });
  }
  return out;
}
export const hasLockup = (s) => lockupCells(s).length > 0;
function freeCell(s) {
  const used = new Set(justiceRec(s).serving.filter((x) => x.kind === 'confine').map((x) => x.bed));
  for (const c of lockupCells(s)) if (!used.has(c.b.id)) return c.b;
  return null;
}
function putServing(r, sv) { r.serving.push(sv); r.serving.sort((a, b) => a.colId - b.colId); }
function startServing(s, col, k, sent) {
  const r = ensureJustice(s);
  let kind = sent.kind, days = sent.days, bed = -1;
  if (kind === 'confine') {
    const b = freeCell(s);
    if (b) bed = b.id; else { kind = 'fine'; days = SENTENCE.commuteDays[Math.min(days, SENTENCE.commuteDays.length - 1)]; sent.commuted = days; }
  }
  const sv = { colId: col.id, kind, until: s.tick + days * TICKS_PER_DAY, bed, caseId: k.id, prio: null, custom: !!col.custom };
  if (kind === 'fine') {
    sv.prio = Array.from(col.prio);
    for (let i = 0; i < col.prio.length; i++) col.prio[i] = i === HAUL ? 1 : 0;
    col.custom = true;
    addThought(s, col, 'fined');
  } else addThought(s, col, 'confined');
  putServing(r, sv);
  if (col.job && !col.job.need && !col.job.brk && !col.drafted) endJob(s, col, END.INTERRUPT);
  requestThink(s, col.id);
  return sv;
}
function release(s, sv) {
  const r = ensureJustice(s), col = colBy(s, sv.colId);
  r.serving.splice(r.serving.indexOf(sv), 1);
  if (!col) return;
  if (sv.kind === 'fine' && sv.prio) { for (let i = 0; i < col.prio.length && i < sv.prio.length; i++) col.prio[i] = sv.prio[i]; col.custom = sv.custom; }
  if (col.job && col.job.type === 'confine') endJob(s, col, END.INTERRUPT);
  requestThink(s, col.id);
}

// the confinement job: walk to the cell bed, stay an hour (Rest comes back in the colonist's sleep hours)
registerToil('confine', (s, col, job, toil) => {
  const sv = servingOf(s, col.id);
  if (!sv || sv.kind !== 'confine') return NEXT;
  const w = job.work++;
  if (w % (TICKS_PER_HOUR / 60) === 0 && col.sched[hourOf(s.tick)] === SCHED.SLEEP) satisfy(col, 'rest', Math.floor((RULES.cellRestPerHour * FIX) / 60));
  return w + 1 < toil.n ? RUN : NEXT;
});
/** The urgent-hook job of a confined colonist (after their urgent needs), or null. */
export function confineJob(s, col) {
  if (!lawsOn(s) || col.drafted || col.breakState || col.hp.down) return null;
  const sv = servingOf(s, col.id);
  if (!sv || sv.kind !== 'confine') return null;
  const b = bldById(s, sv.bed);
  if (!b || b.st !== 'done') return null;
  return makeJob('confine', -1, [T.goto(idx(b.x, b.y, b.z | 0), true), { t: 'confine', n: TICKS_PER_HOUR }], { need: true });
}

// ---- hearings ----------------------------------------------------------------------------------------------------
/** Who hears cases now: 'warden' (a Warden), 'common' (the office not open yet) or null (cases wait). */
export function judge(s) {
  if (!lawsOn(s)) return null;
  if (wardenOf(s)) return 'warden';
  return wardenOpen(s) ? null : 'common';
}
function hear(s, k) {
  const col = colBy(s, k.off), r = ensureJustice(s);
  if (!alive(col)) { k.st = 'dropped'; return; }
  const rec = recordOf(s, col.id);
  const sent = sentence(k.sev, rec);
  k.st = 'sentenced'; k.heard = s.tick; k.sent = { ...sent };
  r.hist.push([col.id, s.tick]);
  while (r.hist.length > RULES.histCap) r.hist.shift();
  const sv = servingOf(s, col.id);
  if (sv) release(s, sv);   // a new sentence replaces the one being served
  startServing(s, col, k, k.sent);
  const crime = CRIMES[k.kind].name.toLowerCase();
  const days = k.sent.commuted || k.sent.days;
  const text = fillText(k.sent.commuted ? TEXT.sentenceCommuted : k.sent.kind === 'confine' ? TEXT.sentenceConfine : TEXT.sentenceFine, { name: col.name, days, crime });
  sendLetter(s, 'minor', { title: TEXT.sentenceTitle, text, data: { colId: col.id } });
  legendEvent(s, 'sentence', [colKey(col.id), colKey(k.vic)], fillText(TEXT.annalsSentence, { name: col.name, what: `${k.sent.commuted || k.sent.kind === 'fine' ? 'labour' : 'the lockup'}, ${days} days` }));
  for (const c of s.col) if (alive(c) && c.id !== col.id && orderValuing(s, c)) addThought(s, c, 'justice_done');
  const vic = colBy(s, k.vic);
  if (alive(vic)) addOpinion(s, vic.id, col.id, RULES.victimOpinion);
  if (recordOf(s, col.id) >= RULES.exileCases) offerExile(s, col);
}
function offerExile(s, col) {
  const r = ensureJustice(s);
  if (r.exile.includes(col.id)) return;
  let free = 0;
  for (const c of s.col) if (c !== col && holdsOn(s, c)) free++;
  if (free < RULES.exileMinLeft) return;
  r.exile.push(col.id);
  sendLetter(s, 'choice', { title: TEXT.exileTitle, text: fillText(TEXT.exileText, { name: col.name, n: recordOf(s, col.id) }), choices: TEXT.exileChoices.slice(),
    deflt: 1, hours: RULES.exileHours, data: { k: 'exile', colId: col.id } });
}
/** The answer to the exile letter. True when the colonist left the hold. */
export function answerExile(s, colId, yes) {
  const r = ensureJustice(s), col = colBy(s, colId);
  const k = r.exile.indexOf(colId);
  if (k >= 0) r.exile.splice(k, 1);
  if (!alive(col)) return false;
  let free = 0;
  for (const c of s.col) if (c !== col && holdsOn(s, c)) free++;
  if (!yes || !lawsOn(s) || free < RULES.exileMinLeft) { sendLetter(s, 'minor', { title: TEXT.exileTitle, text: fillText(TEXT.stays, { name: col.name }) }); return false; }
  exile(s, col);
  return true;
}
onChoice('exile', (s, l, choice) => { answerExile(s, l.data.colId, choice === 0); });
/** The colonist leaves the hold for good (dropping what they carry, their bed, squad, offices and relations). */
function exile(s, col) {
  const r = ensureJustice(s), sv = servingOf(s, col.id);
  if (sv) release(s, sv);
  if (col.job) endJob(s, col, END.INTERRUPT);
  if (col.bed !== null && col.bed !== undefined) { const b = bldById(s, col.bed); if (b && b.owner === col.id) b.owner = null; col.bed = null; }
  for (const b of s.bld) if (b && b.owner === col.id) b.owner = null;
  if (col.squad !== null && col.squad !== undefined) leaveSquad(s, col);
  if (r.warden === col.id) { r.warden = null; r.wardenSince = -1; }
  const off = officeOf(s, col.id);
  if (off && APPOINTED.includes(off)) appoint(s, off, null);
  for (const k of s.colony.cases) if (k.st === 'open' && k.off === col.id) k.st = 'dropped';
  legendEvent(s, 'sentence', [colKey(col.id)], fillText(TEXT.exiled, { name: col.name }));
  sendLetter(s, 'minor', { title: TEXT.exileTitle, text: fillText(TEXT.exiled, { name: col.name }) });
  forget(s, col.id);
  s.col.splice(s.col.indexOf(col), 1);
}

// ---- the broken-mandate hook ---------------------------------------------------------------------------------------
/** offices.js: a noble's mandate was broken. The Steward answers for it (no Steward: no case). */
export function mandateBroken(s, md) {
  const st = holderOf(s, 'steward');
  if (!st || st.id === md.by) return false;
  const it = def('item', md.k);
  return !!reportCrime(s, 'mandate', st, { victim: md.by, what: it && it.name ? it.name.toLowerCase() : md.k, key: -md.id });
}

// ---- the tick ----------------------------------------------------------------------------------------------------
/** Tick system (slot 'colony', hourly): sentences served, hearings, the Lawless thought, the Warden's office. */
export function justiceSystem(s) {
  if (s.tick % TICKS_PER_HOUR !== 0 || !stage2()) return;
  const c = s.colony;
  if (!c.justiceRec && !(c.cases && c.cases.length)) return;   // nothing has happened: no write
  const r = ensureJustice(s);
  // sentences served (or the colonist is gone)
  for (const sv of r.serving.slice()) { const col = colBy(s, sv.colId); if (!alive(col) || s.tick >= sv.until) release(s, sv); }
  // the Warden leaves the office when gone, or when they took another office since
  if (r.warden !== null) { const w = colBy(s, r.warden); if (!alive(w) || officeOf(s, r.warden)) { r.warden = null; r.wardenSince = -1; } }
  if (!lawsOn(s)) return;
  const who = judge(s);
  let waiting = false;
  for (const k of c.cases) {
    if (k.st !== 'open') continue;
    const off = colBy(s, k.off);
    if (!alive(off)) { k.st = 'dropped'; continue; }
    if (who && s.tick - k.open >= RULES.hearingHours * TICKS_PER_HOUR && !off.breakState) { hear(s, k); continue; }
    if (s.tick - k.open > RULES.lawlessDays * TICKS_PER_DAY) waiting = true;
  }
  if (waiting && s.tick % TICKS_PER_DAY === 0) for (const col of s.col) if (alive(col) && orderValuing(s, col)) addThought(s, col, 'lawless_hold');
}

// ---- install -------------------------------------------------------------------------------------------------------
export const lawsCmd = (s, c) => setLaws(s, c.on);
export const wardenCmd = (s, c) => appointWarden(s, c.colId === undefined ? null : c.colId);
/** The Tantrum's smash toil, wrapped: each hit on a finished building opens (or adds to) a vandalism case. */
function wrapSmash(orig) {
  const w = (s, col, job, toil) => {
    const b = bldById(s, toil.b);
    const was = b && b.st === 'done' ? { def: b.def, x: b.x, y: b.y, z: b.z | 0, owner: b.owner === undefined ? null : b.owner } : null;
    const res = orig(s, col, job, toil);
    if (res === NEXT && was && lawsOn(s) && stage2()) {
      const after = bldById(s, toil.b), gone = !after || after.st !== 'done';
      const d = structDef(was.def);
      reportCrime(s, 'vandalism', col, { victim: was.owner, what: (d && d.name ? d.name.toLowerCase() : was.def), worse: gone, at: [was.x, was.y, was.z] });
    }
    return res;
  };
  w.justice = true;
  return w;
}
/** Register the justice system, wrap the smash toil and the urgent hook, set the mandate hook (idempotent). */
export function installJustice() {
  setCrimeHook(reportCrime);   // (Z2b) F's break acts: theft and assault open cases
  const sm = toilHandler('smash');
  if (sm && !sm.justice) registerToil('smash', wrapSmash(sm));
  const h = thinkHooks();
  if (h.urgent && !h.urgent.justice) {
    const prev = h.urgent;
    const u = (s, col) => prev(s, col) || confineJob(s, col);
    u.justice = true;
    setThinkHooks({ urgent: u });
  }
  setMandateBrokenHook(mandateBroken);
  if (!tickSystems().some((x) => x.slot === 'colony' && x.name === 'justice')) registerSystem('colony', 'justice', justiceSystem, 137);
  if ('laws' in COMMANDS) registerApplier('laws', lawsCmd);
  if ('warden' in COMMANDS) registerApplier('warden', wardenCmd);
}

// ---- the screen (pure) ---------------------------------------------------------------------------------------------
/** Everything the Justice screen shows. */
export function justiceView(s) {
  const r = justiceRec(s), w = wardenOf(s), now = s.tick;
  const name = (id) => { const c = colBy(s, id); return c ? c.name : 'someone gone'; };
  const cases = casesOf(s).slice().reverse().map((k) => ({
    id: k.id, kind: k.kind, crime: CRIMES[k.kind] ? CRIMES[k.kind].name : k.kind, offender: name(k.off), victim: k.vic === null ? null : name(k.vic),
    witnesses: k.wit.map(name), st: k.st, sev: k.sev, what: k.what, days: Math.floor((now - k.open) / TICKS_PER_DAY),
    sent: k.sent ? { kind: k.sent.commuted ? 'fine' : k.sent.kind, days: k.sent.commuted || k.sent.days, commuted: !!k.sent.commuted } : null,
  }));
  return {
    on: lawsOn(s), changeable: lawsChangeable(s), judge: judge(s), open: wardenOpen(s),
    warden: w ? { id: w.id, name: w.name, sinceDays: Math.floor((now - r.wardenSince) / TICKS_PER_DAY) } : null,
    lockup: { cells: lockupCells(s).length, met: hasLockup(s) },
    serving: r.serving.map((sv) => ({ colId: sv.colId, name: name(sv.colId), kind: sv.kind, daysLeft: Math.max(0, Math.ceil((sv.until - now) / TICKS_PER_DAY)) })),
    cases, waiting: cases.filter((k) => k.st === 'open').length,
  };
}
