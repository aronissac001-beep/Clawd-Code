// The storyteller (doc 9.1, 9.4, 9.10). Owner H. Provisional API; behind installThreat's `storyteller`
// flag in Stage 1a (nothing visible), on in 1b with The Steady Flame and `hollow_horde`, and with all
// three storytellers and every incident from Stage 2 (the people stage, F's stage2()).
//
// Runs every game hour (tick % 600 == 0) on the 'story' RNG stream. Nothing hostile reaches the map
// without a queue entry in s.st.queue (C12 QueueEntry), kept sorted by arriveTick then id.
// Warning and arrival ticks are whole hours (rounded up), so the hourly run never misses a stage.
// Stages: queued -> omen (warnTick: letter, countdown chip, edge; the cast is selected; a hostile
// incident makes its Raid entity with stage 'warned' and its plan) -> sighted (4 h before: size, route
// preview; raidLive from here) -> imminent (1 h) -> arrival (the incident's logic.start, or spawnRaid
// for a hostile one), which removes the entry. First raid of the default start: omen on day 2 at
// 18:00, a small horde at 21:00 on day 3 (27 h warning), from js/data/starts.js story.firstMajorD.
//
// Majors after the first (9.1 Scheduling): the storyteller's majorD window [lo, hi] days is rolled
// once per ended major (s.st.cooldowns.majorDay = the earliest day the next one may ARRIVE;
// majorFrom = the lastMajorDay it was rolled from). From that day on, each game hour with no major
// queued or live schedules one, unless tension is above THREAT.pushBackTension: then the day moves
// back by one (a beaten-up colony gets room). The incident is drawn by weight among majors of the
// colony's tier and season whose cooldown has run out; it arrives at its `arrive` hour on the first
// such day that leaves a full warning lead (the storyteller's warnH roll, capped at THREAT.maxWarnH)
// and at least RULES.minGapD days after the last major's arrival; the omen comes that lead earlier.
// Tension falls THREAT.tensionDecayPerDay at midnight, rises tensionPerMajor when a major ends
// (raiders.js) and tensionPerDeath when a colonist dies (BUS.kill, installStoryHooks).
//
// Stage 2 additions:
//   - Nemeses (9.10): when a nemesis is due, the next major is one of its kind (nemesis.incidentFor)
//     led by it (entry.nem), with its grudge target in the cast (role 'grudge').
//   - Earlier warnings (9.4): a hostile entry rolls its edge when scheduled (entry.side); manned
//     towers facing that edge and a signal beacon add hours to the lead (defence/towers.js
//     warningBonusH), never past maxWarnH.
//   - Minors and boons (9.1): at the start of each 10-day block the storyteller rolls how many minor
//     slots (its `minors` range) and boon slots (`boons`) the block gets and on which days
//     (s.st.small = { block, minor: [day], boon: [day] }). On such a day at 06:00 a minor slot draws a
//     minor threat or a disaster, a boon slot a visitor or a boon, by weight among the eligible (a
//     wanderer x3 and on half its cooldown while fewer than 5 colonists live: smallHoldWeight)
//     (tier, season, cooldown, requires), never before day RULES.smallFromDay and never within 24 h
//     of a queued major. Each is scheduled with its own warning lead (0: no warning) at its hour.
//   - Choice letters expire into their default answer (letters.js).
//
// Stage Z2 (step Z2.10, F26: every threat has a cause; causes.js): a hostile incident is eligible only
// while a live cause allows it, and its pick weight is its data weight times its causes' summed weight
// (causes.js causedWeight). A scheduled hostile entry carries entry.cause = [kind, subject] and entry.why
// (the cause line, filled at scheduling); the omen letter (here for non-raid omens; warnings.omenText for
// raids) ends with it, and an arrival is written to the Annals with it (only once s.legend exists: the
// legend records are dark until the colony index wires them). Non-hostile incidents need no cause.

import { TICKS_PER_HOUR, TICKS_PER_DAY, dayOf, seasonOf } from '../core/time.js';
import { BUS } from '../core/bus.js';
import { nextId } from '../core/state.js';
import { nextU32 } from '../core/rand.js';
import { emit } from '../core/events.js';
import { stage2 } from '../people/defs.js';
import { def, all, bal, variants } from './defs.js';
import { incidentDef, incidentList, logicOf, newEntry, inSeason, isHostile, EDGES, SIGHTED_H, IMMINENT_H } from './incidents.js';
import { selectCast } from './cast.js';
import { planRaid } from './raidplan.js';
import { ensureRaid, spawnRaid, raidById, setStage } from './raiders.js';
import { dueNemeses, incidentFor, nemesisById } from './nemesis.js';
import { warningBonusH } from '../defence/towers.js';
import { sendLetter, expireLetters, fillText } from './letters.js';
import { causedWeight, causeWeight, causeFor, causeLine, causesHour, needsCause, withCause } from './causes.js';
import { legendEvent } from '../colony/legends.js';

const T = () => bal('threat');
/** Storyteller tuning (balance.js THREAT), with the 9.1 numbers when a key is missing. */
export function storyTuning() {
  const t = T();
  return {
    tensionDecayPerDay: t.tensionDecayPerDay ?? 8, pushBackTension: t.pushBackTension ?? 60, tensionPerDeath: t.tensionPerDeath ?? 20,
    firstOmenH: t.firstOmenH ?? 18, firstArriveH: t.firstArriveH ?? 21, firstRaidPts: t.firstRaidPts ?? 60, maxWarnH: t.maxWarnH ?? 36,
    arriveH: t.arriveH || { day: 10, dusk: 19, night: 21 },
  };
}
/** Rules the data schema has no field for (9.1): majors at least minGapD days apart; small
 *  incidents from day smallFromDay; a block is blockD days. */
export const RULES = Object.freeze({ minGapD: 2, smallFromDay: 4, blockD: 10, smallHour: 6 });

const ceilHour = (t) => Math.ceil(t / TICKS_PER_HOUR) * TICKS_PER_HOUR;
const roll = (s, lo, hi) => lo + (nextU32(s, 'story') % (hi - lo + 1));

/** Schedule an incident. Returns the queue entry (its id is also the raid's id for a hostile one). */
export function scheduleIncident(s, incId, warnTick, arriveTick, init = {}) {
  const inc = incidentDef(incId);
  if (!inc) throw new Error(`storyteller: unknown incident ${incId}`);
  const a = ceilHour(arriveTick), w = Math.min(a, ceilHour(warnTick));
  const e = newEntry(nextId(s, 'raid'), incId, w, a, { cast: selectCast(s, inc.cast), ...init });
  if (stage2() && needsCause(inc) && !e.cause) {
    const nem = e.nem !== undefined && e.nem !== null ? nemesisById(s, e.nem) : null;
    const c = causeFor(s, inc, nem) || causeFor(s, inc);
    if (c) { e.cause = c; e.why = causeLine(s, c); }
  }
  s.st.queue.push(e);
  s.st.queue.sort((x, y) => x.arriveTick - y.arriveTick || x.id - y.id);
  return e;
}
export const queued = (s, incId) => s.st.queue.filter((e) => e.inc === incId);

/** The colony's storyteller def (s.colony.storyteller, else the default one). */
export function storytellerDef(s) { return def('storyteller', s.colony.storyteller) || all('storyteller').find((x) => x.default) || null; }

/** The scripted first horde is Husks only (9.1: "60 points, 3-4 Husks"). */
export const FIRST_HORDE = Object.freeze(['husk']);
/** The start's scripted first major (8.5, 9.1), when nothing has happened yet. */
export function scheduleFirstMajor(s) {
  const K = storyTuning();
  const st = def('start', s.colony.starts) || all('start').find((x) => x.default);
  const d = (st && st.story && st.story.firstMajorD) || 3;
  const arrive = (d - 1) * TICKS_PER_DAY + K.firstArriveH * TICKS_PER_HOUR;
  const warn = Math.max(0, (d - 2) * TICKS_PER_DAY + K.firstOmenH * TICKS_PER_HOUR);
  const e = scheduleIncident(s, 'hollow_horde', warn, arrive);
  e.plan = planRaid(s, e, K.firstRaidPts, FIRST_HORDE);   // 60 points: three Husks (9.1)
  return e;
}

// ---- Majors after the first --------------------------------------------------------------------
const isMajor = (incId) => { const d = incidentDef(incId); return !!d && d.cat === 'major'; };
/** A major is queued, or a major raid is on the books (any stage before 'ended'). */
export const majorPending = (s) => s.st.queue.some((e) => isMajor(e.inc)) || s.raids.some((r) => isMajor(r.inc) && r.stage !== 'ended');

/** Roll the day the next major may arrive (after one ended on `day`). Saved in st.cooldowns.majorDay. */
export function rollNextMajorDay(s, day = dayOf(s.tick)) {
  const sd = storytellerDef(s);
  const [lo, hi] = (sd && sd.majorD) || [5, 7];
  s.st.cooldowns.majorDay = day + roll(s, lo, hi);
  return s.st.cooldowns.majorDay;
}

const tierIndex = (id) => { const t = def('tier', id); return t ? t.i : 0; };
/** Is this incident live at the current build stage? Stage 1b: the horde only. */
export const stageAllows = (d) => !!d && (stage2() || d.id === 'hollow_horde');
/** Can incident d happen now (tier, season, cooldown, requires, stage)? */
export function eligible(s, d) {
  if (!stageAllows(d) || tierIndex(d.minTier) > s.colony.tier || !inSeason(d, seasonOf(s.tick))) return false;
  if ((d.weight | 0) <= 0) return false;
  const until = s.st.cooldowns[`inc:${d.id}`];
  if (until !== undefined && dayOf(s.tick) < until) return false;
  const lg = logicOf(d.id);
  if (lg && lg.requires && !lg.requires(s)) return false;
  if (d.requires && !d.requires(s)) return false;
  if (stage2() && needsCause(d) && causeWeight(s, d) <= 0) return false;   // F26: no cause, no incident
  return true;
}
/** Major incidents the colony can get now (tier, season, cooldown, requires), in data order. */
export function eligibleMajors(s) { return incidentList().filter((d) => d.cat === 'major' && eligible(s, d)); }
function pickWeighted(s, list, wf = null) {
  const w = (d) => Math.max(0, wf ? wf(d) : d.weight | 0);
  let total = 0;
  for (const d of list) total += w(d);
  if (total <= 0) return null;
  let r = nextU32(s, 'story') % total;
  for (const d of list) { r -= w(d); if (r < 0) return d; }
  return list[list.length - 1];
}
/** Boon weights while the hold is small (9.1 population balance, X 2.7): with fewer than 5 able
 *  colonists a wanderer is three times as likely, so a Camp that lost people can still grow. */
function smallHoldWeight(s) {
  const n = s.col.reduce((k, c) => k + (c.hp.dead ? 0 : 1), 0);
  if (n >= 5) return null;
  return (d) => (d.id === 'wanderer' ? (d.weight | 0) * 3 : d.weight | 0);
}
/** The arrival hour of an incident (its `arrive` word; 'any' draws an hour). */
function arriveHour(s, inc) {
  const H = storyTuning().arriveH;
  if (inc.arrive === 'any' || H[inc.arrive] === undefined) return roll(s, 0, 23);
  return H[inc.arrive];
}
/** The tick the last major arrived (st.lastMajorArrive), or -Infinity. */
const lastArrive = (s) => (s.st.lastMajorArrive === undefined ? -Infinity : s.st.lastMajorArrive);

/** A hostile entry's edge side, rolled at scheduling (Stage 2), and the earlier-warning hours it earns. */
function rollSide(s, e) {
  if (!stage2()) return 0;
  e.side = EDGES[nextU32(s, 'story') % 4];
  return warningBonusH(s, e.side);
}

/**
 * Schedule the next major now (called hourly once the window is open). Returns the entry or null
 * (nothing eligible). The arrival is at the incident's hour on the earliest day that leaves the
 * whole warning lead after now; the omen comes `lead` hours before it.
 */
export function scheduleMajor(s) {
  let inc = null, nem = null;
  if (stage2()) {
    for (const n of dueNemeses(s)) { const d = incidentDef(incidentFor(n)); if (d && eligibleNem(s, d)) { inc = d; nem = n; break; } }
  }
  if (!inc) inc = pickWeighted(s, eligibleMajors(s), stage2() ? (d) => causedWeight(s, d) : null);
  if (!inc) return null;
  const K = storyTuning(), sd = storytellerDef(s);
  const w = (sd && sd.warnH) || inc.warnH || [12, 24];
  let lead = Math.min(K.maxWarnH, roll(s, w[0], w[1]));
  const hour = arriveHour(s, inc);
  const probe = {};
  const bonus = isHostile(inc) ? rollSide(s, probe) : 0;
  lead = Math.min(K.maxWarnH, lead + bonus);
  let day = Math.max(dayOf(s.tick), s.st.cooldowns.majorDay | 0);
  const gapFrom = lastArrive(s) + RULES.minGapD * TICKS_PER_DAY;
  while (day * TICKS_PER_DAY + hour * TICKS_PER_HOUR - lead * TICKS_PER_HOUR < s.tick || day * TICKS_PER_DAY + hour * TICKS_PER_HOUR < gapFrom) day++;
  const arrive = day * TICKS_PER_DAY + hour * TICKS_PER_HOUR;
  const init = {};
  if (probe.side) { init.side = probe.side; init.bonusH = bonus; }
  if (nem) init.nem = nem.id;
  const e = scheduleIncident(s, inc.id, arrive - lead * TICKS_PER_HOUR, arrive, init);
  if (inc.cooldownD) s.st.cooldowns[`inc:${inc.id}`] = day + inc.cooldownD;
  s.st.lastMajorArrive = arrive;
  return e;
}
/** A nemesis-led major ignores the incident cooldown, not the tier (its grievance is its cause). */
function eligibleNem(s, d) { return stageAllows(d) && tierIndex(d.minTier) <= s.colony.tier; }

/** The hourly major check (9.1 Scheduling). */
export function majorCheck(s) {
  const st = s.st;
  if (st.lastMajorDay < 0 && !st.queue.length && !st.history.length && !s.raids.length) { scheduleFirstMajor(s); st.lastMajorArrive = st.queue[0].arriveTick; return; }
  if (majorPending(s)) return;
  // a fresh window after each major (majorFrom remembers which major the roll belongs to)
  if (st.cooldowns.majorDay === undefined || st.cooldowns.majorFrom !== st.lastMajorDay) {
    rollNextMajorDay(s, st.lastMajorDay < 0 ? dayOf(s.tick) : st.lastMajorDay);
    st.cooldowns.majorFrom = st.lastMajorDay;
  }
  const day = dayOf(s.tick);
  if (day < st.cooldowns.majorDay) return;
  if (st.tension > storyTuning().pushBackTension) { st.cooldowns.majorDay = day + 1; return; }
  scheduleMajor(s);
}

// ---- Minors, disasters, visitors and boons (Stage 2) -------------------------------------------
const SMALL_CATS = Object.freeze({ minor: ['minor', 'disaster'], boon: ['visitor', 'boon'] });
/** Pick `n` distinct day offsets 0..blockD-1, ascending. */
function pickDays(s, n) {
  const out = [];
  for (let k = 0; k < n && out.length < RULES.blockD; k++) {
    let d = nextU32(s, 'story') % RULES.blockD;
    while (out.includes(d)) d = (d + 1) % RULES.blockD;
    out.push(d);
  }
  return out.sort((a, b) => a - b);
}
/** The small-incident plan for the current 10-day block (rolled once, saved in s.st.small). */
export function smallPlan(s) {
  const block = Math.floor(dayOf(s.tick) / RULES.blockD);
  let p = s.st.small;
  if (p && p.block === block) return p;
  const sd = storytellerDef(s);
  const [ml, mh] = (sd && sd.minors) || [3, 3], [bl, bh] = (sd && sd.boons) || [3, 3];
  const base = block * RULES.blockD;
  p = { block, minor: pickDays(s, roll(s, ml, mh)).map((d) => base + d), boon: pickDays(s, roll(s, bl, bh)).map((d) => base + d) };
  s.st.small = p;
  return p;
}
/** Eligible small incidents of a slot kind ('minor' | 'boon'), in data order. */
export function eligibleSmall(s, slot) { return incidentList().filter((d) => SMALL_CATS[slot].includes(d.cat) && eligible(s, d)); }
/** Schedule a small incident now, with its own lead and hour. */
export function scheduleSmall(s, inc) {
  const lead = inc.warnH ? roll(s, inc.warnH[0], inc.warnH[1]) : 0;
  const hour = arriveHour(s, inc);
  let day = dayOf(s.tick);
  while (day * TICKS_PER_DAY + hour * TICKS_PER_HOUR - lead * TICKS_PER_HOUR < s.tick) day++;
  const arrive = day * TICKS_PER_DAY + hour * TICKS_PER_HOUR;
  const init = {};
  if (isHostile(inc)) { const bonus = rollSide(s, init); if (bonus) init.bonusH = bonus; }
  const L = Math.min(storyTuning().maxWarnH, lead + (init.bonusH | 0));
  const e = scheduleIncident(s, inc.id, arrive - L * TICKS_PER_HOUR, arrive, init);
  // (a small hold's wanderer comes back in half the time: X 2.7, two early deaths left Camps at 3
  // colonists past day 25 with the wanderer on its 6-day cooldown)
  if (inc.cooldownD) s.st.cooldowns[`inc:${inc.id}`] = day + (inc.id === 'wanderer' && smallHoldWeight(s) ? Math.ceil(inc.cooldownD / 2) : inc.cooldownD);
  return e;
}
const majorWithin = (s, ticks) => s.st.queue.some((e) => isMajor(e.inc) && Math.abs(e.arriveTick - s.tick) < ticks) || s.raids.some((r) => isMajor(r.inc) && (r.stage === 'active' || r.stage === 'retreat'));
/** The daily small-incident check (06:00, Stage 2). Returns the entries scheduled. */
export function smallCheck(s) {
  const out = [];
  if (!stage2()) return out;
  const day = dayOf(s.tick);
  if (day < RULES.smallFromDay) return out;
  const p = smallPlan(s);
  for (const slot of ['minor', 'boon']) {
    if (!p[slot].includes(day)) continue;
    if (slot === 'minor' && majorWithin(s, TICKS_PER_DAY)) { const k = p[slot].indexOf(day); if (day + 1 < (p.block + 1) * RULES.blockD && !p[slot].includes(day + 1)) p[slot][k] = day + 1; continue; }
    const inc = pickWeighted(s, eligibleSmall(s, slot), slot === 'boon' ? smallHoldWeight(s) : (d) => causedWeight(s, d));
    if (inc) out.push(scheduleSmall(s, inc));
  }
  return out;
}

// ---- Stages of a queue entry -------------------------------------------------------------------
/** The omen letter of a warned incident without a raid (a disaster with its own warning). */
function omenLetter(s, e, inc) {
  const hours = Math.max(0, Math.ceil((e.arriveTick - s.tick) / TICKS_PER_HOUR));
  const t = variants(inc.letter)[0] || '';
  const text = fillText(t, { hours, edge: e.side ? ({ n: 'north', e: 'east', s: 'south', w: 'west' })[e.side] : 'far' });
  sendLetter(s, 'omen', { inc: inc.id, text: withCause(text, e.why), data: { entry: e.id, ...(e.cause ? { cause: e.cause } : {}) } });
}
function advance(s, e) {
  const inc = incidentDef(e.inc), hostile = isHostile(inc), warned = e.warnTick < e.arriveTick;
  if (e.stage === 'queued' && s.tick >= e.warnTick) {
    e.stage = 'omen';
    // the cast is chosen when the incident is planned (the omen), and saved in the entry (9.10)
    if (inc && inc.cast) e.cast = selectCast(s, inc.cast);
    if (e.nem !== undefined && e.nem !== null) { const n = nemesisById(s, e.nem); if (n) e.cast.grudge = n.grudge; }
    if (hostile) { ensureRaid(s, e); emit(s, 'raidWarn', { raidId: e.id, arriveTick: e.arriveTick }); }
    else if (warned && inc) omenLetter(s, e, inc);
  }
  if (e.stage === 'omen' && s.tick >= e.arriveTick - SIGHTED_H * TICKS_PER_HOUR) {
    e.stage = 'sighted';
    const r = raidById(s, e.id); if (r) setStage(s, r, 'sighted');
  }
  if (e.stage === 'sighted' && s.tick >= e.arriveTick - IMMINENT_H * TICKS_PER_HOUR) {
    e.stage = 'imminent';
    const r = raidById(s, e.id); if (r) setStage(s, r, 'imminent');
  }
  if (s.tick < e.arriveTick) return false;
  const lg = logicOf(e.inc);
  if (lg && lg.start) lg.start(s, e);
  else if (hostile) spawnRaid(s, e);
  if (e.why && inc && inc.cat === 'major') annalsArrival(s, e, inc);
  if (inc && !hostile) {
    const h = s.st.history;
    h.push({ inc: inc.id, cat: inc.cat, day: dayOf(s.tick), result: 'happened', deaths: 0, downed: false, after: [] });
    if (h.length > 40) h.splice(0, h.length - 40);
  }
  return true;
}

/** The Annals line of a major's arrival with its cause (2.10); only once the legend records exist. */
function annalsArrival(s, e, inc) {
  if (typeof s.legend !== 'string') return;
  const nem = e.nem !== undefined && e.nem !== null ? 'm' + (e.nem >>> 0).toString(36) : null;
  legendEvent(s, inc.id === 'siege' ? 'siege' : 'raid', [nem], `${incidentName(inc)} came. ${e.why}`);
}
const incidentName = (inc) => { const n = String(inc.id).replace(/_/g, ' '); return n[0].toUpperCase() + n.slice(1); };

/** Tick system (slot 'storyteller'). */
export function storytellerSystem(s) {
  if (s.tick % TICKS_PER_HOUR !== 0) return;
  const st = s.st;
  if (s.tick % TICKS_PER_DAY === 0) st.tension = Math.max(0, st.tension - storyTuning().tensionDecayPerDay);
  if (stage2()) causesHour(s);
  majorCheck(s);
  if (s.tick % TICKS_PER_DAY === RULES.smallHour * TICKS_PER_HOUR) smallCheck(s);
  if (stage2()) expireLetters(s);
  const keep = [];
  for (const e of st.queue) if (!advance(s, e)) keep.push(e);
  st.queue = keep;
  for (const fn of HOURLY) fn(s);
}
/** Hourly story hooks (disasters that run for days, nemesis bookkeeping): fn(s), in registration order. */
const HOURLY = [];
export function onStoryHour(fn) { if (!HOURLY.includes(fn)) HOURLY.push(fn); }

/** Story hooks (idempotent): a colonist's death raises tension (9.1). */
const onKill = (s, victim) => { if (victim && Array.isArray(victim.sk)) s.st.tension = Math.min(100, s.st.tension + storyTuning().tensionPerDeath); };
export function installStoryHooks() { if (!BUS.kill.includes(onKill)) BUS.kill.push(onKill); }
