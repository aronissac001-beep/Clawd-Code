// The storyteller (doc 9.1, 9.4). Owner H. Provisional API; behind installThreat's `storyteller`
// flag in Stage 1a (nothing visible), on in 1b with The Steady Flame and `hollow_horde`.
//
// Runs every game hour (tick % 600 == 0) on the 'story' RNG stream. Nothing hostile reaches the map
// without a queue entry in s.st.queue (C12 QueueEntry), kept sorted by arriveTick then id.
// Warning and arrival ticks are whole hours (rounded up), so the hourly run never misses a stage.
// Stages: queued -> omen (warnTick: letter, countdown chip, edge; the cast is selected; a major
// makes its Raid entity with stage 'warned' and its plan) -> sighted (4 h before: size, route preview; raidLive from here) ->
// imminent (1 h) -> arrival (the incident's logic.start, or spawnRaid for a major), which removes
// the entry. First raid of the default start: omen on day 2 at 18:00, a small horde at 21:00 on
// day 3 (27 h warning), from js/data/starts.js story.firstMajorD.
//
// Majors after the first (9.1 Scheduling): the storyteller's majorD window [lo, hi] days is rolled
// once per ended major (s.st.cooldowns.majorDay = the earliest day the next one may ARRIVE;
// majorFrom = the lastMajorDay it was rolled from).
// From that day on, each game hour with no major queued or live schedules one, unless tension is
// above THREAT.pushBackTension: then the day moves back by one (a beaten-up colony gets room). The
// incident is drawn by weight among majors of the colony's tier and season whose cooldown has run
// out; it arrives at its `arrive` hour on the first such day that leaves a full warning lead
// (the storyteller's warnH roll, capped at THREAT.maxWarnH), and the omen comes that lead earlier.
// Tension falls THREAT.tensionDecayPerDay at midnight, rises tensionPerMajor when a major ends
// (raiders.js) and tensionPerDeath when a colonist dies (BUS.kill, installStoryHooks).
// Minors and boons (daily rolls by weight, tier, season and cooldowns) arrive in Stage 2.

import { TICKS_PER_HOUR, TICKS_PER_DAY, dayOf, seasonOf } from '../core/time.js';
import { BUS } from '../core/bus.js';
import { nextId } from '../core/state.js';
import { nextU32 } from '../core/rand.js';
import { emit } from '../core/events.js';
import { def, all, bal } from './defs.js';
import { incidentDef, incidentList, logicOf, newEntry, inSeason, SIGHTED_H, IMMINENT_H } from './incidents.js';
import { selectCast } from './cast.js';
import { planRaid } from './raidplan.js';
import { ensureRaid, spawnRaid, raidById, setStage } from './raiders.js';

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

const ceilHour = (t) => Math.ceil(t / TICKS_PER_HOUR) * TICKS_PER_HOUR;
const roll = (s, lo, hi) => lo + (nextU32(s, 'story') % (hi - lo + 1));

/** Schedule an incident. Returns the queue entry (its id is also the raid's id for a major). */
export function scheduleIncident(s, incId, warnTick, arriveTick, init = {}) {
  const inc = incidentDef(incId);
  if (!inc) throw new Error(`storyteller: unknown incident ${incId}`);
  const a = ceilHour(arriveTick), w = Math.min(a, ceilHour(warnTick));
  const e = newEntry(nextId(s, 'raid'), incId, w, a, { cast: selectCast(s, inc.cast), ...init });
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
/** Major incidents the colony can get now (tier, season, cooldown, requires), in data order. */
export function eligibleMajors(s) {
  const day = dayOf(s.tick), season = seasonOf(s.tick);
  const cd = s.st.cooldowns;
  return incidentList().filter((d) => {
    if (d.cat !== 'major' || tierIndex(d.minTier) > s.colony.tier || !inSeason(d, season)) return false;
    const until = cd[`inc:${d.id}`];
    if (until !== undefined && day < until) return false;
    const lg = logicOf(d.id);
    if (lg && lg.requires && !lg.requires(s)) return false;
    if (d.requires && !d.requires(s)) return false;
    return true;
  });
}
function pickWeighted(s, list) {
  let total = 0;
  for (const d of list) total += Math.max(0, d.weight | 0);
  if (total <= 0) return null;
  let r = nextU32(s, 'story') % total;
  for (const d of list) { r -= Math.max(0, d.weight | 0); if (r < 0) return d; }
  return list[list.length - 1];
}
/** The arrival hour of an incident (its `arrive` word; 'any' draws an hour). */
function arriveHour(s, inc) {
  const H = storyTuning().arriveH;
  if (inc.arrive === 'any' || H[inc.arrive] === undefined) return roll(s, 0, 23);
  return H[inc.arrive];
}

/**
 * Schedule the next major now (called hourly once the window is open). Returns the entry or null
 * (nothing eligible). The arrival is at the incident's hour on the earliest day that leaves the
 * whole warning lead after now; the omen comes `lead` hours before it.
 */
export function scheduleMajor(s) {
  const inc = pickWeighted(s, eligibleMajors(s));
  if (!inc) return null;
  const K = storyTuning(), sd = storytellerDef(s);
  const w = (sd && sd.warnH) || inc.warnH || [12, 24];
  const lead = Math.min(K.maxWarnH, roll(s, w[0], w[1]));
  const hour = arriveHour(s, inc);
  let day = Math.max(dayOf(s.tick), s.st.cooldowns.majorDay | 0);
  while (day * TICKS_PER_DAY + hour * TICKS_PER_HOUR - lead * TICKS_PER_HOUR < s.tick) day++;
  const arrive = day * TICKS_PER_DAY + hour * TICKS_PER_HOUR;
  const e = scheduleIncident(s, inc.id, arrive - lead * TICKS_PER_HOUR, arrive);
  if (inc.cooldownD) s.st.cooldowns[`inc:${inc.id}`] = day + inc.cooldownD;
  return e;
}

/** The hourly major check (9.1 Scheduling). */
export function majorCheck(s) {
  const st = s.st;
  if (st.lastMajorDay < 0 && !st.queue.length && !st.history.length && !s.raids.length) { scheduleFirstMajor(s); return; }
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

function advance(s, e) {
  const inc = incidentDef(e.inc), major = inc && inc.cat === 'major';
  if (e.stage === 'queued' && s.tick >= e.warnTick) {
    e.stage = 'omen';
    // the cast is chosen when the incident is planned (the omen), and saved in the entry (9.10)
    if (inc && inc.cast) e.cast = selectCast(s, inc.cast);
    if (major) ensureRaid(s, e);
    emit(s, 'raidWarn', { raidId: e.id, arriveTick: e.arriveTick });
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
  else if (major) spawnRaid(s, e);
  return true;
}

/** Tick system (slot 'storyteller'). */
export function storytellerSystem(s) {
  if (s.tick % TICKS_PER_HOUR !== 0) return;
  const st = s.st;
  if (s.tick % TICKS_PER_DAY === 0) st.tension = Math.max(0, st.tension - storyTuning().tensionDecayPerDay);
  majorCheck(s);
  const keep = [];
  for (const e of st.queue) if (!advance(s, e)) keep.push(e);
  st.queue = keep;
}

/** Story hooks (idempotent): a colonist's death raises tension (9.1). */
const onKill = (s, victim) => { if (victim && Array.isArray(victim.sk)) s.st.tension = Math.min(100, s.st.tension + storyTuning().tensionPerDeath); };
export function installStoryHooks() { if (!BUS.kill.includes(onKill)) BUS.kill.push(onKill); }
