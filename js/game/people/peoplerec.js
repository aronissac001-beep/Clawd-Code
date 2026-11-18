// The people's saved record (owner F; doc 4.5-4.8, 8.1; Stage 2).
//
// A few Stage 2 people rules need colony-level saved state of their own: squads, the last chat of
// each colonist (Lonely), how long each has been in high spirits (inspirations), unburied corpses
// in the dark (Husks rise), who lies in which grave, and the Ember-touched cooldown. It lives in
// s.colony.people (plain JSON, so colonyToPlain / colonyFromPlain save it with the colony record
// and the state hash covers it). Saves made before Stage 2 have none: ensurePeople() creates it on
// the first Stage 2 tick, the same tick in an uninterrupted run and in a loaded one.
//   (A: please add `people: null` to schema.newColonyRecord() so the field is part of C2-full.)
// Every list is [[key, ...]] sorted by key (colonist, item or building id): no Map, no Set, no
// insertion-order dependence.

export function newPeopleRec() {
  return {
    v: 1,
    squads: [],        // [[squadId, name, banner (bldId | null)]] 1..MAX_SQUADS
    chat: [],          // [[colId, lastChatTick]]
    hi: [],            // [[colId, tick mood first reached inspireAt]] while it stays there
    corpses: [],       // [[itemId, colId, darkTicks]] unburied colonist corpses
    graves: [],        // [[bldId, [names]]]
    passion: [],       // [[colId, skillIndex, lastTick]] burning passions last worked
    emberLast: -1,     // tick the last Ember-touched seizure began (-1 never)
    majorTick: -1,     // tick of the last major event (raid repelled, a friend's death): doubles the Ember chance
    unbroken: [],      // [[colId, raidId]] Unbroken used in that raid
    emberHands: [],    // [[colId, day]] Ember Hands used that day
  };
}
const EMPTY = Object.freeze(newPeopleRec());
export const peopleRec = (s) => (s && s.colony && s.colony.people) || EMPTY;
export function ensurePeople(s) {
  if (!s.colony.people) s.colony.people = newPeopleRec();
  const p = s.colony.people;
  for (const k of Object.keys(EMPTY)) if (!(k in p)) p[k] = Array.isArray(EMPTY[k]) ? [] : EMPTY[k];
  return p;
}

/** Sorted [[key, ...]] lists. */
export function findKey(list, key) {
  let lo = 0, hi = list.length - 1;
  while (lo <= hi) { const m = (lo + hi) >> 1, k = list[m][0]; if (k === key) return m; if (k < key) lo = m + 1; else hi = m - 1; }
  return -lo - 1;
}
export function getKey(list, key) { const k = findKey(list, key); return k >= 0 ? list[k] : null; }
export function putKey(list, entry) { const k = findKey(list, entry[0]); if (k >= 0) list[k] = entry; else list.splice(-k - 1, 0, entry); return entry; }
export function dropKey(list, key) { const k = findKey(list, key); if (k >= 0) list.splice(k, 1); return k >= 0; }

import { EVENTS, emit } from '../core/events.js';
/** Emit an event only when the C8 table has the name (names A has not added yet stay silent). */
export function emitIf(s, name, data) { if (name in EVENTS) emit(s, name, data); }

/** A small deterministic hash (no stream state). */
export function hash3(a, b, c) {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77) ^ Math.imul(c | 0, 0xc2b2ae3d)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}
