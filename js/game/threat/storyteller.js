// The storyteller (doc 9.1, 9.4). Owner H. Provisional API; behind installThreat's `storyteller`
// flag in Stage 1a (nothing visible), on in 1b with The Steady Flame and `hollow_horde`.
//
// Runs every game hour (tick % 600 == 0) on the 'story' RNG stream. Nothing hostile reaches the map
// without a queue entry in s.st.queue (C12 QueueEntry), kept sorted by arriveTick then id.
// Warning and arrival ticks are whole hours (rounded up), so the hourly run never misses a stage.
// Stages: queued -> omen (warnTick: letter, countdown chip, edge; a major makes its Raid entity
// with stage 'warned') -> sighted (4 h before: size, route preview; raidLive from here) ->
// imminent (1 h) -> arrival (the incident's logic.start, or spawnRaid for a major), which removes
// the entry. First raid of the default start: omen on day 2 at 18:00, a small horde at 21:00 on
// day 3 (27 h warning), from js/data/starts.js story.firstMajorD.

import { TICKS_PER_HOUR, TICKS_PER_DAY } from '../core/time.js';
import { nextId } from '../core/state.js';
import { emit } from '../core/events.js';
import { def, all } from './defs.js';
import { incidentDef, logicOf, newEntry, SIGHTED_H, IMMINENT_H } from './incidents.js';
import { selectCast } from './cast.js';
import { planRaid } from './raidplan.js';
import { ensureRaid, spawnRaid, raidById, setStage } from './raiders.js';

/** Provisional storyteller tuning (9.1); moves to balance.js THREAT (owner G) with the 1b data. */
export const STORY = { tensionDecayPerDay: 8, pushBackTension: 60, firstOmenH: 18, firstArriveH: 21, firstRaidPts: 60 };

const ceilHour = (t) => Math.ceil(t / TICKS_PER_HOUR) * TICKS_PER_HOUR;

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

/** The start's scripted first major (8.5, 9.1), when nothing has happened yet. */
export function scheduleFirstMajor(s) {
  const st = def('start', s.colony.starts) || all('start').find((x) => x.default);
  const d = (st && st.story && st.story.firstMajorD) || 3;
  const arrive = (d - 1) * TICKS_PER_DAY + STORY.firstArriveH * TICKS_PER_HOUR;
  const warn = Math.max(0, (d - 2) * TICKS_PER_DAY + STORY.firstOmenH * TICKS_PER_HOUR);
  const e = scheduleIncident(s, 'hollow_horde', warn, arrive);
  e.plan = planRaid(s, e, STORY.firstRaidPts);
  return e;
}

function advance(s, e) {
  const inc = incidentDef(e.inc), major = inc && inc.cat === 'major';
  if (e.stage === 'queued' && s.tick >= e.warnTick) {
    e.stage = 'omen';
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
  if (st.lastMajorDay < 0 && !st.queue.length && !st.history.length && !s.raids.length) scheduleFirstMajor(s);
  const keep = [];
  for (const e of st.queue) if (!advance(s, e)) keep.push(e);
  st.queue = keep;
  if (s.tick % TICKS_PER_DAY === 0) st.tension = Math.max(0, st.tension - STORY.tensionDecayPerDay);
  // Stage 1b: The Steady Flame's major window (5-7 days, pushed back while tension > 60);
  // Stage 2: daily minors and boons by weight, tier, season and cooldowns; charter nudges (K).
}
