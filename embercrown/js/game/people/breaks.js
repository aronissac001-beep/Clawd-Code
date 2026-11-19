// Mental breaks and inspirations (doc 4.5). Owner F. Provisional API; off until 1b.
//
// col.breakState = null | { id, sev, until } (C2 json). A break ends the colonist's job through
// E's single exit (endJob, reason 'break'); the break's behaviour (Sulk wandering, Comfort binge)
// is a job type the think step picks while breakState is set (1b, with E's C7).
// col.inspo = null | { id, until } (Stage 2): Fervour (work x1.5 for 2 days), Inspired trade (the next
// trade 20% better, for 10 days; K reads it), Inspired teaching (colonists within 6 tiles learn x2
// for a day). A colonist at mood >= NEEDS.inspireAt for NEEDS.inspireHours has
// NEEDS.inspireChancePerDayPct a day (rolled at noon from a hash; s.colony.people.hi keeps when the
// high spirits began). talkDown(s, talker, col) is the Care job's roll (E): a Social 8+ colonist ends
// a break in progress, chance by Social and opinion (Silver Tongue +20).
// Thresholds (mood, 0..100): NEEDS.breakAt { minor, major, extreme } plus 'break.threshold'
// trait points (Steady -5, Volatile +6). Checked every NEEDS.breakCheckEvery ticks (one game hour):
// chance per hour = breakChancePerHourPct[sev], scaled up by how far below the threshold.

import { FIX } from '../core/schema.js';
import { TICKS_PER_HOUR } from '../core/time.js';
import { rnd, nextU32 } from '../core/rand.js';
import { emit } from '../core/events.js';
import { END } from '../work/jobs.js';
import { endJob } from '../work/reserve.js';
import { bal, all, def, inStage, traitPct, traitFlag, PEOPLE, stage2 } from './defs.js';
import { addThought } from './mood.js';
import { asleep } from './needs.js';
import { ensurePeople, getKey, putKey, dropKey, hash3 } from './peoplerec.js';
import { level } from './skills.js';
import { opinion } from './social.js';
import { hasGrant } from './perkrules.js';
import { TICKS_PER_DAY } from '../core/time.js';

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

/** Breaks of a severity this colonist can have at the people stage (trait-gated ones need the trait). */
export const breaksOf = (col, sev) => all('break').filter((b) => b.sev === sev && inStage(b) && (!b.trait || col.traits.includes(b.trait)));
/**
 * Start a break of a severity: picks among that severity's breaks; while a severity has none at this
 * stage (Stage 1b ships only the minor ones), the next milder severity is used.
 */
export function startBreak(s, col, sev) {
  let k = SEVS.indexOf(sev), list = [];
  while (k >= 0 && !(list = breaksOf(col, SEVS[k])).length) k--;
  if (!list.length) return null;
  sev = SEVS[k];
  // Gluttons reach for food: a comfort binge is three times as likely among the minor breaks
  const weightOf = (x) => (x.id === 'binge' && traitFlag(col, 'break.binge') ? 3 : 1);
  let total = 0;
  for (const x of list) total += weightOf(x);
  let r = Math.floor(rnd(s, 'main') * total), b = list[list.length - 1];
  for (const x of list) { r -= weightOf(x); if (r < 0) { b = x; break; } }
  const hours = b.hours[0] + (nextU32(s, 'main') % (b.hours[1] - b.hours[0] + 1));
  col.breakState = { id: b.id, sev, until: s.tick + hours * TICKS_PER_HOUR };
  if (col.job) endJob(s, col, END.BREAK);
  emit(s, 'broke', { colId: col.id, brk: b.id });
  return col.breakState;
}

/** Start a named break (Ember-touched failure, scripted tests). Returns the break state or null. */
export function startBreakOf(s, col, id, sev = null) {
  const b = def('break', id);
  if (!b || !inStage(b) || (b.trait && !col.traits.includes(b.trait))) return startBreak(s, col, sev || 'major');
  const hours = b.hours[0] + (nextU32(s, 'main') % (b.hours[1] - b.hours[0] + 1));
  col.breakState = { id: b.id, sev: b.sev, until: s.tick + hours * TICKS_PER_HOUR };
  if (col.job) endJob(s, col, END.BREAK);
  emit(s, 'broke', { colId: col.id, brk: b.id });
  return col.breakState;
}
/** Talk a breaking colonist down (E's Care job at the breaker). Returns true when it worked. */
export function talkDown(s, talker, col) {
  if (!col.breakState || !talker || talker === col) return false;
  const soc = level(talker, 'social');
  if (soc < 8) return false;
  let pct = 30 + 5 * (soc - 8) + Math.trunc(opinion(s, talker.id, col.id) / 4) + (hasGrant(talker, 'parley') ? 20 : 0);
  if (col.breakState.sev === 'extreme') pct -= 15;
  if (hash3(talker.id, col.id, s.tick) % 100 >= Math.max(5, Math.min(95, pct))) return false;
  endBreak(s, col);
  addThought(s, col, 'talked_down');
  return true;
}
/**
 * Arrest a breaking colonist (4.5): a drafted, able colonist within ARREST_R tiles ends a major or
 * extreme break and confines the breaker to bed for a day (the catatonic behaviour: they lie in their
 * bed, or on the spot). H's order system (an `arrest` order) or a command calls it. null or the reason.
 */
export const ARREST_R = 2;
export function arrest(s, officer, col) {
  if (!col || !col.breakState) return 'they are not in a break';
  if (col.breakState.arrested) return 'already confined';
  if (col.breakState.sev === 'minor') return 'only a major or extreme break needs an arrest';
  if (!officer || officer === col || !officer.drafted || officer.hp.dead || officer.hp.down) return 'needs a drafted colonist';
  const R = ARREST_R * 32;
  if (Math.abs(officer.x - col.x) > R || Math.abs(officer.y - col.y) > R) return 'too far away';
  col.breakState = { id: 'catatonic', sev: 'extreme', until: s.tick + TICKS_PER_DAY, arrested: 1 };
  if (col.job) endJob(s, col, END.BREAK);
  addThought(s, col, 'arrested');
  emit(s, 'broke', { colId: col.id, brk: 'arrested' });
  return null;
}

// Squad banners (Banner-maker, Tailoring 15): a soldier within BANNER_R tiles of their squad's banner
// never breaks (here) or flees (H reads bannerHolds). bannerAt lives in draft.js with the squads.
let bannerFn = null;
/** draft.js hands its bannerHolds over (avoids an import cycle). */
export function bindBanner(fn) { bannerFn = fn; }

export const INSPO_KINDS = Object.freeze(['fervour', 'trade', 'teaching']);
/** The colonist's live inspiration id, or null. */
export const inspiration = (s, col) => (col.inspo && col.inspo.id && s.tick < col.inspo.until ? col.inspo.id : null);
function inspoDays(id) { const I = PEOPLE.inspo; return id === 'fervour' ? I.fervourDays : id === 'trade' ? I.tradeDays : I.teachingDays; }
/** Inspire a colonist (the daily roll, or scripted). */
export function inspire(s, col, id) {
  col.inspo = { id, until: s.tick + inspoDays(id) * TICKS_PER_DAY };
  addThought(s, col, 'inspired');
  emit(s, 'inspired', { colId: col.id, kind: id });
  return col.inspo;
}
/** Hourly: high spirits tracking, and the noon roll (Stage 2). */
function inspoStep(s) {
  const N = bal('needs'), rec = ensurePeople(s), noon = s.tick % TICKS_PER_DAY === 12 * TICKS_PER_HOUR;
  for (const col of s.col) {
    if (col.inspo && s.tick >= col.inspo.until) col.inspo = null;
    if (col.hp.dead) continue;
    if (col.mood >= (N.inspireAt || 85) * FIX) { if (!getKey(rec.hi, col.id)) putKey(rec.hi, [col.id, s.tick]); }
    else dropKey(rec.hi, col.id);
    if (!noon || col.inspo || col.breakState) continue;
    const e = getKey(rec.hi, col.id);
    if (!e || s.tick - e[1] < (N.inspireHours || 12) * TICKS_PER_HOUR) continue;
    const h = hash3(col.id, s.tick, 0x1a5);
    if (h % 100 < (N.inspireChancePerDayPct || 3)) inspire(s, col, INSPO_KINDS[(h >>> 8) % INSPO_KINDS.length]);
  }
}

/** End a break: its behaviour job ends through E's single exit, and "Catharsis" follows. */
export function endBreak(s, col) {
  col.breakState = null;
  if (col.job && col.job.brk) endJob(s, col, END.INTERRUPT);
  addThought(s, col, 'catharsis');
}

/** Tick system (slot 'mood', after mood): end finished breaks; roll new ones once per game hour. */
export function breaksSystem(s) {
  for (const col of s.col) if (col.breakState && s.tick >= col.breakState.until) endBreak(s, col);
  const every = bal('needs').breakCheckEvery || TICKS_PER_HOUR;
  if (s.tick % every !== 0) return;
  if (stage2()) inspoStep(s);
  for (const col of s.col) {
    if (col.breakState || col.drafted || col.hp.dead || col.hp.down || asleep(col)) continue;
    if (bannerFn && col.squad && bannerFn(s, col)) continue;
    const p = breakChance(col);
    if (p > 0 && nextU32(s, 'main') % 1000 < p) startBreak(s, col, breakRisk(col));
  }
}
