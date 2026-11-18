// Mood and thoughts (doc 4.5). Owner F. Provisional API; off in Stage 1a, on from 1b.
//
// col.thoughts = [[id, ticksLeft, stack]] (C2). ticksLeft -1 = a condition thought that lasts while
// its cause holds (the caller removes it); otherwise it counts down and expires at 0.
// col.mood is fixed point 0..100 x FIX. Target = moodBase + 'mood.base' trait points + the sum of
// active thought values (a stacked thought counts value x (1 + (stack - 1) x decay%)).
// Every NEEDS.moodSmoothEvery ticks mood moves a quarter of the gap toward the target, rounded
// away from zero and at least 1 (a -20 shock lands three-quarters of the way in about 30 game minutes).

import { FIX } from '../core/schema.js';
import { TICKS_PER_HOUR } from '../core/time.js';
import { bldById } from '../core/state.js';
import { isBurning, fuelEnabled } from '../world/fuel.js';
import { bal, def, traitPct } from './defs.js';
import { NEED, activeNeeds } from './needs.js';
import { pain } from './health.js';
import { surroundings } from './surround.js';
import { stage2 } from './defs.js';

export const MOOD_MAX = 100 * FIX;
const clampMood = (v) => (v < 0 ? 0 : v > MOOD_MAX ? MOOD_MAX : v);

/** Add (or refresh, or stack) a thought by id. Unknown ids are ignored (returns false). */
export function addThought(s, col, id) {
  const d = def('thought', id);
  if (!d) return false;
  const ticks = d.durationH > 0 ? d.durationH * TICKS_PER_HOUR : -1;
  for (const t of col.thoughts) {
    if (t[0] !== id) continue;
    t[1] = ticks;
    if (d.stack) t[2] = Math.min(d.stack.max, t[2] + 1);
    return true;
  }
  col.thoughts.push([id, ticks, 1]);
  return true;
}
export function removeThought(col, id) {
  const i = col.thoughts.findIndex((t) => t[0] === id);
  if (i >= 0) col.thoughts.splice(i, 1);
  return i >= 0;
}
export const hasThought = (col, id) => col.thoughts.some((t) => t[0] === id);

/** Mood points (x FIX) of one thought entry. */
export function thoughtValue(entry) {
  const d = def('thought', entry[0]);
  if (!d) return 0;
  const k = entry[2] | 0;
  const pct = d.stack && k > 1 ? 100 + (k - 1) * d.stack.decay : 100;
  return Math.trunc((d.value * FIX * pct) / 100);
}
/** The mood the colonist is heading for (x FIX). */
export function moodTarget(s, col) {
  let v = (bal('needs').moodBase || 50) * FIX + (traitPct(col, 'mood.base') - 100) * FIX;
  for (const t of col.thoughts) v += thoughtValue(t);
  return clampMood(v);
}
/** One smoothing step: a quarter of the gap, rounded away from zero, at least 1. */
export function smoothStep(mood, target) {
  const gap = target - mood;
  if (gap === 0) return mood;
  const q = gap > 0 ? Math.ceil(gap / 4) : Math.floor(gap / 4);
  return clampMood(mood + q);
}

/** Give every living colonist a thought (colony events: a raid repelled, a death). */
export function addThoughtAll(s, id, exceptId = -1) {
  let n = 0;
  for (const c of s.col) if (!c.hp.dead && c.id !== exceptId && addThought(s, c, id)) n++;
  return n;
}
/** Make condition thought `id` present (on) or absent (off). */
function setCondition(s, col, id, on) {
  const has = hasThought(col, id);
  if (on && !has) addThought(s, col, id);
  else if (!on && has) removeThought(col, id);
}

/**
 * Condition thoughts (durationH 0) follow the state (Stage 1b): per active need the thought of the
 * lowest threshold that holds (Hungry < 25, Ravenous < 10, Starving at 0; Tired, Exhausted; Uneasy,
 * Dread, Terror); the Hearth burning or cold (while the colony has a Hearth and fuel rules are on:
 * a Hearth without fuel rules always burns); in pain (untended damage >= NEEDS.painThought).
 */
export function refreshConditions(s, col) {
  for (const id of activeNeeds()) {
    const d = def('need', id);
    if (!d || !d.thoughts || !d.thoughts.length) continue;
    const v = col.need[NEED[id]];
    let pick = null, lo = Infinity;
    for (const r of d.thoughts) if (v < r.below * FIX && r.below < lo) { lo = r.below; pick = r.thought; }
    for (const r of d.thoughts) setCondition(s, col, r.thought, r.thought === pick);
  }
  const h = s.colony && s.colony.hearth;
  const hb = h && h.id !== null && h.id !== undefined ? bldById(s, h.id) : null;
  if (hb && def('thought', 'hearth_lit')) {
    const lit = !fuelEnabled() || isBurning(s, hb);
    setCondition(s, col, 'hearth_lit', lit);
    setCondition(s, col, 'hearth_cold', !lit);
  }
  if (def('thought', 'in_pain')) setCondition(s, col, 'in_pain', pain(col) >= (bal('needs').painThought || 15));
}
let conditionsOn = false;
/** Turn condition-thought upkeep on (installPeople with needs and mood, Stage 1b). */
export function setConditionThoughts(on) { conditionsOn = !!on; }

/** Tick system (slot 'mood'): every moodSmoothEvery ticks, age thoughts and smooth mood. */
export function moodSystem(s) {
  const every = bal('needs').moodSmoothEvery || 60;
  if (s.tick % every !== 0) return;
  for (const col of s.col) {
    if (col.hp.dead) continue;
    if (conditionsOn) refreshConditions(s, col);
    let w = 0;
    for (let r = 0; r < col.thoughts.length; r++) {
      const t = col.thoughts[r];
      if (t[1] > 0) { t[1] -= every; if (t[1] <= 0) continue; }
      col.thoughts[w++] = t;
    }
    col.thoughts.length = w;
    // Stage 2: rooms, surroundings, traits, people and the body, once a game hour (staggered by id)
    if (conditionsOn && stage2() && (s.tick + col.id * every) % (10 * every) === 0) surroundings(s, col);
    col.mood = smoothStep(col.mood, moodTarget(s, col));
  }
}
