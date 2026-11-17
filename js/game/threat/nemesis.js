// Nemeses (doc 9.10): raiders who survive and come back. Owner H. Provisional API; Stage 2 content.
//
// s.st.nemeses = [Nemesis] (schema C2: { id, name, epithet, kind, affixes, scar, grudge, returns,
// nextTick }), at most CAPS.nemeses (6) alive: making a seventh retires the oldest (lowest id) with
// a `nemesis` event ('retired'). A nemesis returns after 1-2 seasons leading a major of its kind,
// with +1 affix per return (data list below) and its grudge target in the cast.

import { newNemesis } from '../core/schema.js';
import { nextId } from '../core/state.js';
import { nextU32 } from '../core/rand.js';
import { TICKS_PER_DAY, DAYS_PER_SEASON } from '../core/time.js';
import { emit } from '../core/events.js';
import { bal, variants } from './defs.js';

export const AFFIXES = Object.freeze(['armoured', 'swift', 'rallying', 'burning']);
const pickText = (s, id, fallback) => { const v = variants(id); return v.length ? v[nextU32(s, 'names') % v.length] : fallback; };

/** Make a nemesis from a surviving foe. grudge: the colonist who wounded it most (or null). */
export function makeNemesis(s, foe, { grudge = null, scar = null } = {}) {
  const cap = bal('caps').nemeses || 6;
  while (s.st.nemeses.length >= cap) {
    const old = s.st.nemeses.shift();
    emit(s, 'nemesis', { nemId: old.id, what: 'retired' });
  }
  const seasons = 1 + (nextU32(s, 'story') % 2);
  const n = newNemesis(nextId(s, 'nem'), {
    name: pickText(s, 'nem_name', 'The Nameless'), epithet: pickText(s, 'nem_epithet_jaw', ''), kind: foe.kind,
    scar, grudge, returns: 0, nextTick: s.tick + seasons * DAYS_PER_SEASON * TICKS_PER_DAY,
  });
  s.st.nemeses.push(n);
  emit(s, 'nemesis', { nemId: n.id, what: 'made' });
  return n;
}
/** Nemeses whose return is due, by id. */
export const dueNemeses = (s) => s.st.nemeses.filter((n) => n.nextTick <= s.tick);
/** A nemesis leads a raid: one more return and one more affix (in AFFIXES order). */
export function markReturn(s, n) {
  n.returns++;
  const next = AFFIXES.find((a) => !n.affixes.includes(a));
  if (next) n.affixes.push(next);
  n.nextTick = s.tick + (1 + (nextU32(s, 'story') % 2)) * DAYS_PER_SEASON * TICKS_PER_DAY;
  emit(s, 'nemesis', { nemId: n.id, what: 'returns' });
}
export function slay(s, nemId) {
  const i = s.st.nemeses.findIndex((n) => n.id === nemId);
  if (i < 0) return false;
  s.st.nemeses.splice(i, 1);
  emit(s, 'nemesis', { nemId, what: 'slain' });
  return true;
}
