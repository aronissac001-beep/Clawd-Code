// The world's saved record (owner B; doc 3.1, 3.4, 3.6, 7.8, 9.7; Stage 2).
//
// Stage 2 world systems need a little saved state of their own: the weather, burning tiles, the
// cave-in rumble queue, mechanism states (levers, gates, plates, deadfalls) and the season the
// water froze for. It lives in s.colony.world (a plain JSON object, so colonyToPlain / colonyFromPlain
// save and restore it with the colony record, and the state hash covers it). Saves made before
// Stage 2 have no world record: ensureWorld() creates it on the first Stage 2 tick, the same tick in
// an uninterrupted run and in a loaded one, so a save continues identically.
//   (A: please add `world: null` to schema.newColonyRecord() so the field is part of C2-full; until
//   then it is an added key, which colonyFromPlain already keeps.)
//
//   worldRec(s)        read-only view (a frozen empty record when there is none yet; never mutates)
//   ensureWorld(s)     the live record, created when missing (tick systems and write APIs only)
//   setWorldStage(st)  '2' turns the Stage 2 world rules on (weather, fire, blight, rumbling cave-ins,
//                      mechanisms, frozen water); earlier stages keep the Stage 1b world exactly.
//
// Every list in the record is kept sorted (tile index or building id), so no code depends on
// insertion order, and nothing in it is a Map, Set or typed array (JSON only, 13.2).

import { EVENTS, emit } from '../core/events.js';

export const WORLD_REC_V = 1;

/** A fresh world record. */
export function newWorldRec() {
  return {
    v: WORLD_REC_V,
    weather: { kind: 'clear', since: 0, until: 0, day: -1 },  // kind: clear | rain | snow | coldsnap | drought
    fire: [],          // [[tile, heat 1-100, fuel ticks left]] sorted by tile
    caveQ: [],         // [[tile, collapseTick]] sorted by tile
    mech: [],          // [[bldId, state]] sorted by id: lever 0/1, gate 0 closed / 1 open / 2 locked, deadfall 0 armed / 1 sprung
    frozen: -1,        // the year*4+season index the water was last frozen for (-1 never)
    blightDay: -1,     // the last day the blight spread / cleansing ran
    litDays: [],       // (reserved) [[tile, days lit]] for a finer cleansing rule
    disc: [],          // discovery kinds met so far (cavern, spring, vault), sorted
  };
}
const EMPTY = Object.freeze({ ...newWorldRec(), weather: Object.freeze(newWorldRec().weather), fire: Object.freeze([]), caveQ: Object.freeze([]), mech: Object.freeze([]), litDays: Object.freeze([]), disc: Object.freeze([]) });

/** Read view: the record, or a frozen empty one. */
export const worldRec = (s) => (s && s.colony && s.colony.world) || EMPTY;
/** The live record (created on first use by a tick system or a write API). */
export function ensureWorld(s) {
  if (!s.colony.world) s.colony.world = newWorldRec();
  return s.colony.world;
}

let STAGE2 = false;
/** Turn the Stage 2 world rules on ('2', '3', '4') or off ('1a', '1b'). */
export function setWorldStage(stage) { STAGE2 = stage === '2' || stage === '3' || stage === '4'; }
export const worldStage2 = () => STAGE2;

// ---- Sorted pair lists [[key, ...]] ------------------------------------------------------------------
/** Index of key in a list sorted by [0], or -(insertion point) - 1. */
export function findKey(list, key) {
  let lo = 0, hi = list.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1, k = list[m][0];
    if (k === key) return m;
    if (k < key) lo = m + 1; else hi = m - 1;
  }
  return -lo - 1;
}
export function getKey(list, key) { const k = findKey(list, key); return k >= 0 ? list[k] : null; }
/** Insert or replace the entry for key (entry[0] === key). */
export function putKey(list, entry) {
  const k = findKey(list, entry[0]);
  if (k >= 0) list[k] = entry; else list.splice(-k - 1, 0, entry);
  return entry;
}
export function dropKey(list, key) { const k = findKey(list, key); if (k >= 0) list.splice(k, 1); return k >= 0; }

/** A small deterministic hash (no stream state): weather days, fire spread, blight. */
export function hash3(a, b, c) {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77) ^ Math.imul(c | 0, 0xc2b2ae3d)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

/** Emit an event only when the C8 table has the name (names A has not added yet stay silent). */
export function emitIf(s, name, data) { if (name in EVENTS) emit(s, name, data); }
