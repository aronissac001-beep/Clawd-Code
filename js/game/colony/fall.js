// The fall of a hold (EMBERCROWN-FORTRESS.md 1.3, F8; owner A for the state, I for the screens).
//
// There is no Reclaim and no win: a colony falls when no colonist is free and able for FALL_HOURS
// (24) consecutive game hours, and the fall is final. The fallen colony stays in the colony list as a
// read-only Ruin (its Chronicle, a frozen map, Export and Delete); tick() is a no-op for it
// (core/sim.js), so its state hash never changes again.
//
// "Free and able" (holdsOn): not dead, not captured, not in an extreme break, and not downed without a
// rescuer (a downed colonist lying in a bed has been rescued and counts; one lying where they fell
// does not). A colony that never had a colonist (s.next.col still 1: test scaffolding) never falls.
//
// Saved state, all optional keys of s.colony (absent means "no"; they are written only when they
// happen, so a colony that is not falling hashes exactly as before this file existed):
//   fallSince  tick of the first hourly check that found no colonist free and able; deleted as soon as
//              one is (the 24 hours must be consecutive)
//   fallen     true once fallen (never cleared by the sim; only a Recover from a device problem load of
//              an older copy brings back a colony that had not yet fallen)
//   fallenAt   the tick of the fall
// The state v3 migration (5.3 step 5, S9.7) may make `fallen: false` an explicit default.
//
//   fallSystem(s)       slot 'colony' (last): the hourly check. installFall() registers it.
//   holdsOn(s, col)     is this colonist free and able?
//   isFallen(s)         has the colony fallen?
//   fallSummary(s)      what the final screen and the Ruin card show ("The Hearth goes cold", 1.3)
//
// Pure and deterministic (14.1): reads only saved state; the hourly check runs on tick % hour.

import { registerSystem, tickSystems } from '../core/bus.js';
import { TICKS_PER_HOUR, DAYS_PER_YEAR, yearOf, dayOf, dateText } from '../core/time.js';
import { inBed } from '../people/health.js';
import { addChron, causeWords } from './chronicle.js';

export const FALL_HOURS = 24;
const FALL_TICKS = FALL_HOURS * TICKS_PER_HOUR;

/** Has the colony fallen? */
export const isFallen = (s) => !!(s && s.colony && s.colony.fallen === true);

/** Captured or otherwise taken off the map (no Stage 2 system does this yet; the flags are the hook). */
const captured = (col) => !!(col.hp && col.hp.captured) || !!col.captured;

/** Is this colonist free and able (1.3)? */
export function holdsOn(s, col) {
  if (!col || !col.hp || col.hp.dead || captured(col)) return false;
  if (col.breakState && col.breakState.sev === 'extreme') return false;
  if (col.hp.down && !inBed(col)) return false;
  return true;
}
/** Has the colony ever had a colonist? (s.next.col is the monotonic colonist id counter.) */
const everPeopled = (s) => !!s.next && (s.next.col | 0) > 1;

/** The hourly fall check (exported for tests): returns true on the tick the colony falls. */
export function fallCheck(s) {
  const c = s.colony;
  if (c.fallen === true || !everPeopled(s)) return false;
  for (const col of s.col) {
    if (holdsOn(s, col)) { if ('fallSince' in c) delete c.fallSince; return false; }
  }
  if (!('fallSince' in c)) { c.fallSince = s.tick; return false; }
  if (s.tick - c.fallSince < FALL_TICKS) return false;
  c.fallen = true;
  c.fallenAt = s.tick;
  delete c.fallSince;
  addChron(s, 'fallen', 'chron_fell', { hold: s.name, date: dateText(s.tick), year: yearOf(s.tick) + 1 });
  return true;
}
/** Tick system (slot 'colony', after every other colony system): the check runs once per game hour. */
export function fallSystem(s) {
  if (s.tick % TICKS_PER_HOUR !== 0) return;
  fallCheck(s);
}

const has = (slot, name) => tickSystems().some((x) => x.slot === slot && x.name === name);
/** Register the fall check (idempotent). */
export function installFall() {
  if (!has('colony', 'fall')) registerSystem('colony', 'fall', fallSystem, 900);
}

// ---- The final screen and the Ruin card (read-only; the UI renders it) --------------------------------
/** Hours of the current fall clock (0 when someone holds on): for an alert such as "No one stands: 6 h". */
export function fallClockHours(s) {
  const c = s.colony;
  if (c.fallen === true || !('fallSince' in c)) return 0;
  return Math.floor((s.tick - c.fallSince) / TICKS_PER_HOUR);
}

/**
 * What "The Hearth goes cold" shows (1.3): years lived, deeds, the dead with causes, the deepest
 * distance into rock (Stage 2.9; levels in the fortress), named artifacts, great beasts slain (none
 * before Z3) and the last Chronicle page. Never changes the state.
 * @returns {{ name, fallen, fellAt, fellText, daysLived, yearsLived, deeds: string[], dead: [{ name, cause, tick }],
 *   deepest: number, artifacts: [{ name, maker }], beasts: string[], lastPage: Array, totals: object }}
 */
export function fallSummary(s, pageSize = 12) {
  const c = s.colony;
  const fellAt = c.fallen === true && Number.isInteger(c.fallenAt) ? c.fallenAt : null;
  const end = fellAt === null ? s.tick : fellAt;
  const founded = s.chron.find((e) => e[1] === 'founded');
  const t0 = founded ? founded[0] : 0;
  const days = Math.max(0, dayOf(end) - dayOf(t0));
  const dead = s.chron.filter((e) => e[2] === 'chron_death').map((e) => ({ name: (e[3] && e[3].name) || 'Someone', cause: (e[3] && e[3].cause) || causeWords(null), tick: e[0] }));
  // a colonist still lying in s.col marked dead whose Chronicle line folded away keeps their name
  for (const col of s.col) if (col.hp && col.hp.dead && !dead.some((d) => d.name === col.name)) dead.push({ name: col.name, cause: causeWords(col.hp.cause), tick: col.hp.diedT ?? end });
  const artifacts = [];
  for (const e of s.chron) if (e[2] === 'chron_artifact' && e[3]) artifacts.push({ name: e[3].item || '', maker: e[3].maker || null });
  for (const it of s.items) if (it && it.name && !artifacts.some((a) => a.name === it.name)) artifacts.push({ name: it.name, maker: null });
  let deepest = 0;
  const d = s.rt && s.rt.depth;
  if (d && s.L && s.L.roof) for (let i = 0; i < d.length; i++) if (d[i] > deepest && s.L.roof[i] >= 2) deepest = d[i];
  const total = (c.ledger && c.ledger.total) || {};
  return {
    name: s.name, fallen: c.fallen === true, fellAt, fellText: fellAt === null ? null : dateText(fellAt),
    daysLived: days, yearsLived: Math.floor(days / DAYS_PER_YEAR),
    deeds: Array.isArray(c.deeds) ? c.deeds.slice() : [], dead, deepest, artifacts, beasts: [],
    lastPage: s.chron.slice(-pageSize), totals: { ...total },
  };
}
