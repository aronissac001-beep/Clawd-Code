// Calendar helpers (doc 2.2, D3). Pure functions of the integer tick; every cadence is in ticks.
// These are contract values from D3, not tuning numbers (tuning lives in js/data/balance.js).

export const TPS = 20;                  // sim ticks per second at 1x
export const TICKS_PER_MIN = 10;        // one game minute (the unit of every `work` value)
export const TICKS_PER_HOUR = 600;
export const TICKS_PER_DAY = 14400;
export const DAYS_PER_SEASON = 10;
export const SEASONS = Object.freeze(['thaw', 'highsun', 'ashfall', 'deepcold']);
export const SEASON_NAMES = Object.freeze(['Thaw', 'Highsun', 'Ashfall', 'Deepcold']);
export const DAYS_PER_YEAR = DAYS_PER_SEASON * SEASONS.length;
/** A new colony starts on day 1 at 06:00 (10.9: the coach's first morning). */
export const START_HOUR = 6;
export const START_TICK = START_HOUR * TICKS_PER_HOUR;
/** Ticks per real second for each speed step; speed is not sim state (2.2). */
export const SPEEDS = Object.freeze([0, 20, 40, 60, 100]);
export const MAX_TICKS_PER_FRAME = 4;

export const hourOf = (tick) => Math.floor(tick / TICKS_PER_HOUR) % 24;
export const minuteOf = (tick) => Math.floor(tick / TICKS_PER_MIN) % 60;
export const dayOf = (tick) => Math.floor(tick / TICKS_PER_DAY);
export const seasonOf = (tick) => Math.floor(dayOf(tick) / DAYS_PER_SEASON) % SEASONS.length;
export const yearOf = (tick) => Math.floor(dayOf(tick) / DAYS_PER_YEAR);
export const dayOfSeason = (tick) => dayOf(tick) % DAYS_PER_SEASON;
export const isMidnight = (tick) => tick % TICKS_PER_DAY === 0;

/** 'dawn' 05-07, 'day', 'dusk' 19-21, 'night' 21-05; Deepcold nights are 20:00-06:00. */
export function phaseOf(tick) {
  const h = hourOf(tick), cold = seasonOf(tick) === 3;
  const dawn0 = cold ? 6 : 5, night0 = cold ? 20 : 21;
  if (h >= night0 || h < dawn0) return 'night';
  if (h < dawn0 + 2) return 'dawn';
  if (h >= night0 - 2) return 'dusk';
  return 'day';
}

/** "Year 2, Ashfall day 4" (1-based for people). */
export function dateText(tick) {
  return `Year ${yearOf(tick) + 1}, ${SEASON_NAMES[seasonOf(tick)]} day ${dayOfSeason(tick) + 1}`;
}
/** "14:05" */
export function clockText(tick) {
  const h = hourOf(tick), m = minuteOf(tick);
  return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
}

// ---- Speeds (2.2, 10.7; owner A). Speed is not sim state: these helpers only read the state. ------
/** Speed multipliers the speed button offers (0 = paused). Index = speed step. */
export const SPEED_MULTS = Object.freeze([0, 1, 2, 3, 5]);
/** Ticks per real second at a multiplier (1x = 20). */
export const tpsAt = (mult) => TPS * mult;
// raid stages of C12 (threat/incidents.js RAID_STAGES) in which its members are on the map
const RAID_ACTIVE = new Set(['active', 'retreat']);

/**
 * Why 5x is blocked right now, or null (D3): an active raid member (a foe whose raid has arrived),
 * an aggroed creature (a beast or Hollow with a hostile target) or a drafted colonist. An idle cave
 * spider asleep in its cavern does not block it.
 */
export function fastBlocked(s) {
  for (let i = 0; i < s.col.length; i++) if (s.col[i].drafted) return 'a colonist is drafted';
  if (s.foes.length) {
    const live = new Map();
    for (const r of s.raids) live.set(r.id, RAID_ACTIVE.has(r.stage));
    for (const f of s.foes) {
      if (f.raid !== null && f.raid !== undefined && live.get(f.raid)) return 'raiders are on the map';
      if (f.target !== null && f.target !== undefined) return 'a hostile is attacking';
    }
  }
  for (const a of s.anim) if (!a.tame && a.st && a.st.aggro) return 'a beast is hunting';
  return null;
}
/** The reason a speed multiplier is not allowed now, or null. */
export const speedBlocked = (s, mult) => (mult >= 5 ? fastBlocked(s) : null);
/** The multiplier the game should run at: `want` unless it is blocked (5x falls back to 3x). */
export const allowedSpeed = (s, want) => (want >= 5 && fastBlocked(s) ? 3 : want);

/** Events that drop the game to 1x (2.2; each a setting, default on): raid arrival, a downed colonist, a major letter. */
export const SLOWDOWN_EVENTS = Object.freeze({ raidStage: (d) => !!d && d.stage === 'active', downed: () => true, letter: (d) => !d || d.kind !== 'minor' });
/** Given drained events (C8) and the current multiplier, the multiplier to switch to (or `mult` unchanged). */
export function slowdownFor(events, mult, enabled = { raidStage: true, downed: true, letter: true }) {
  if (mult <= 1) return mult;
  for (const e of events) { const f = SLOWDOWN_EVENTS[e.name]; if (f && enabled[e.name] !== false && f(e.data)) return 1; }
  return mult;
}

/**
 * Real time to ticks (the clock half of the loop). Pure: the caller passes the frame's dt in
 * seconds, so js/game/ never reads a real clock. A frame never runs more than MAX_TICKS_PER_FRAME
 * ticks (2.2): extra owed time is dropped, never banked, so a slow phone runs slower, not jumpier.
 * Determinism does not depend on it: one tick is one tick at every speed (14.4 (c)).
 */
export class Clock {
  constructor() { this.mult = 0; this.acc = 0; this.ticks = 0; }
  setSpeed(mult) { this.mult = mult; if (!mult) this.acc = 0; }
  /** Number of ticks to run for a frame of `dt` seconds. */
  frame(dt) {
    if (!this.mult || !(dt > 0)) return 0;
    this.acc += Math.min(dt, 0.25) * TPS * this.mult;
    let n = Math.floor(this.acc);
    this.acc -= n;
    if (n > MAX_TICKS_PER_FRAME) { n = MAX_TICKS_PER_FRAME; this.acc = 0; }
    this.ticks += n;
    return n;
  }
}
