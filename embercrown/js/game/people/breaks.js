// Mental breaks and inspirations (doc 4.5). Owner F. Provisional API; off until 1b.
//
// col.breakState = null | { id, sev, until } (C2 json). A break ends the colonist's job through
// E's single exit (endJob, reason 'break'); the break's behaviour (Sulk wandering, Comfort binge)
// is a job type the think step picks while breakState is set (1b, with E's C7).
// col.inspo = null | { id, until } (Stage 2).
// Thresholds (mood, 0..100): NEEDS.breakAt { minor, major, extreme } plus 'break.threshold'
// trait points (Steady -5, Volatile +6). Checked every NEEDS.breakCheckEvery ticks (one game hour):
// chance per hour = breakChancePerHourPct[sev], scaled up by how far below the threshold.

import { FIX } from '../core/schema.js';
import { TICKS_PER_HOUR } from '../core/time.js';
import { rnd, nextU32 } from '../core/rand.js';
import { emit } from '../core/events.js';
import { END } from '../work/jobs.js';
import { endJob } from '../work/reserve.js';
import { bal, all, traitPct } from './defs.js';

export const SEVS = Object.freeze(['minor', 'major', 'extreme']);

/** Mood thresholds x FIX for a colonist: { minor, major, extreme }. */
export function thresholds(col) {
  const b = bal('needs').breakAt || { minor: 35, major: 20, extreme: 8 };
  const add = traitPct(col, 'break.threshold') - 100;
  return { minor: (b.minor + add) * FIX, major: (b.major + add) * FIX, extreme: (b.extreme + add) * FIX };
}
/** The worst severity the colonist's mood is at risk of, or null. */
export function breakRisk(col) {
  const t = thresholds(col);
  if (col.mood <= t.extreme) return 'extreme';
  if (col.mood <= t.major) return 'major';
  if (col.mood <= t.minor) return 'minor';
  return null;
}
/** Chance (per mille) of a break this check. */
export function breakChance(col) {
  const sev = breakRisk(col);
  if (!sev) return 0;
  const pct = (bal('needs').breakChancePerHourPct || [2, 4, 8])[SEVS.indexOf(sev)];
  const thr = thresholds(col)[sev];
  const depth = thr > 0 ? Math.min(thr, thr - col.mood) : 0;
  return pct * 10 + (thr > 0 ? Math.floor((pct * 10 * depth) / thr) : 0);
}

/** Start a break of a severity: picks among that severity's breaks (trait-gated ones need the trait). */
export function startBreak(s, col, sev) {
  const list = all('break').filter((b) => b.sev === sev && (!b.trait || col.traits.includes(b.trait)));
  if (!list.length) return null;
  const b = list[Math.floor(rnd(s, 'main') * list.length)];
  const hours = b.hours[0] + (nextU32(s, 'main') % (b.hours[1] - b.hours[0] + 1));
  col.breakState = { id: b.id, sev, until: s.tick + hours * TICKS_PER_HOUR };
  if (col.job) endJob(s, col, END.BREAK);
  emit(s, 'broke', { colId: col.id, brk: b.id });
  return col.breakState;
}

/** Tick system (slot 'mood', after mood): end finished breaks; roll new ones once per game hour. */
export function breaksSystem(s) {
  for (const col of s.col) if (col.breakState && s.tick >= col.breakState.until) col.breakState = null;
  const every = bal('needs').breakCheckEvery || TICKS_PER_HOUR;
  if (s.tick % every !== 0) return;
  for (const col of s.col) {
    if (col.breakState || col.drafted || col.hp.dead || col.hp.down) continue;
    const p = breakChance(col);
    if (p > 0 && nextU32(s, 'main') % 1000 < p) startBreak(s, col, breakRisk(col));
  }
}
