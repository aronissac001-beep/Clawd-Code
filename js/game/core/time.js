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
