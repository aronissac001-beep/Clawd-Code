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
import { bal, def, traitPct } from './defs.js';

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

/** Tick system (slot 'mood'): every moodSmoothEvery ticks, age thoughts and smooth mood. */
export function moodSystem(s) {
  const every = bal('needs').moodSmoothEvery || 60;
  if (s.tick % every !== 0) return;
  for (const col of s.col) {
    if (col.hp.dead) continue;
    let w = 0;
    for (let r = 0; r < col.thoughts.length; r++) {
      const t = col.thoughts[r];
      if (t[1] > 0) { t[1] -= every; if (t[1] <= 0) continue; }
      col.thoughts[w++] = t;
    }
    col.thoughts.length = w;
    col.mood = smoothStep(col.mood, moodTarget(s, col));
  }
}
