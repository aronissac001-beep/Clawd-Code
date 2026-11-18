// Relationships (light; doc 4.7). Owner F. Provisional API; chats arrive in Stage 2.
//
// s.rel (C2) maps a pair key to [op, kind]: key = a x 1024 + b with a < b (colonist ids), stored
// as an object key (a string in JSON). op -100..100; kind null | 'kin' | 'friend' | 'rival' |
// 'lover' | 'spouse'. friend and rival follow op (>= 40, <= -40); kin, lover and spouse are set
// by events and kept. Sim code never iterates s.rel's keys: lists go over s.col in id order.

import { FIX } from '../core/schema.js';
import { TICKS_PER_HOUR, TICKS_PER_DAY } from '../core/time.js';
import { PEOPLE, stage2, traitFlag } from './defs.js';
import { ensurePeople, putKey, getKey, peopleRec, hash3 } from './peoplerec.js';
import { satisfy } from './needs.js';
import { addThought } from './mood.js';

export const REL_KINDS = Object.freeze(['kin', 'friend', 'rival', 'lover', 'spouse']);
export const FRIEND_OP = 40, RIVAL_OP = -40, PAIR_SPAN = 1024;

export const pairKey = (a, b) => (a < b ? a * PAIR_SPAN + b : b * PAIR_SPAN + a);
export function relation(s, a, b) { return s.rel[pairKey(a, b)] || null; }
export const opinion = (s, a, b) => { const r = relation(s, a, b); return r ? r[0] : 0; };
export const kindOf = (s, a, b) => { const r = relation(s, a, b); return r ? r[1] : null; };

const derived = (op, kind) => (kind === 'kin' || kind === 'lover' || kind === 'spouse' ? kind : op >= FRIEND_OP ? 'friend' : op <= RIVAL_OP ? 'rival' : null);

/** Change the pair's opinion by d (clamped), updating friend / rival. Returns the new opinion. */
export function addOpinion(s, a, b, d) {
  if (a === b) return 0;
  const k = pairKey(a, b);
  const r = s.rel[k] || [0, null];
  const op = Math.max(-100, Math.min(100, r[0] + d));
  const kind = derived(op, r[1]);
  if (op === 0 && kind === null) delete s.rel[k]; else s.rel[k] = [op, kind];
  return op;
}
/** Set a lasting kind (kin, lover, spouse); null clears it back to the opinion-derived kind. */
export function setKind(s, a, b, kind) {
  const k = pairKey(a, b);
  const r = s.rel[k] || [0, null];
  s.rel[k] = [r[0], kind === null ? derived(r[0], null) : kind];
}

/** The colonist's n strongest relations as [[otherId, op, kind]], by |op| then id (the Social tab). */
export function strongest(s, colId, n = 5) {
  const out = [];
  for (const c of s.col) {
    if (c.id === colId) continue;
    const r = relation(s, colId, c.id);
    if (r) out.push([c.id, r[0], r[1]]);
  }
  out.sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]) || x[0] - y[0]);
  return out.slice(0, n);
}

/** Drop every relation of a colonist who left the colony for good (not on death: grief needs them). */
export function forget(s, colId) {
  for (const c of s.col) if (c.id !== colId) delete s.rel[pairKey(colId, c.id)];
}

// ---- Chats, lovers and loneliness (Stage 2) ------------------------------------------------------------------
// Every game hour each colonist (staggered by id over the hour) who is at joy or eating looks for
// another within PEOPLE.social.chatR tiles who is too (lowest id first); with chatPermille they chat:
// the pair's opinion moves opMin..opMax (a hash of the pair and the tick), x1.5 when either is Kind,
// +1 for a shared ancestry, +1 for a shared passion, -5 for each Abrasive one; both gain PEOPLE.joy.chat
// joy (twice for friends; Loners get none) and "A good talk" when it went well; both chat times are
// saved (s.colony.people.chat) for "Lonely" (3 days without one, mood.js). Once a day at midnight a
// pair at opinion >= loverOp, neither with a lover, may fall in love (loverPermille).

const SO = PEOPLE.social;
const social = (col) => !!col.job && (col.job.type === 'joy' || col.job.type === 'eat') && !col.hp.dead && !col.hp.down;
/** One chat between colonists a and b. Returns the opinion change. */
export function chat(s, a, b) {
  const h = hash3(Math.min(a.id, b.id), Math.max(a.id, b.id), s.tick);
  let d = SO.opMin + (h % (SO.opMax - SO.opMin + 1));
  if (traitFlag(a, 'mood.kind') || traitFlag(b, 'mood.kind')) d = Math.floor((d * SO.kindPct) / 100);
  if (a.anc === b.anc) d += SO.sameAnc;
  for (let i = 0; i < a.sk.length; i++) if (a.sk[i][2] > 0 && b.sk[i][2] > 0) { d += SO.samePassion; break; }
  // an Abrasive tongue: the talk never helps, and each Abrasive one costs SO.abrasive (-5)
  const abr = (traitFlag(a, 'mood.abrasive') ? 1 : 0) + (traitFlag(b, 'mood.abrasive') ? 1 : 0);
  if (abr) d = Math.min(d, 0) + SO.abrasive * abr;
  const op = addOpinion(s, a.id, b.id, d);
  const joy = PEOPLE.joy.chat * FIX * (op >= FRIEND_OP ? 2 : 1);
  for (const c of [a, b]) {
    if (!traitFlag(c, 'mood.loner')) satisfy(c, 'joy', joy);
    if (d > 0) addThought(s, c, 'chat_good');
    putKey(ensurePeople(s).chat, [c.id, s.tick]);
  }
  return d;
}
/** Ticks since the colonist's last chat (since arrival when never: the record's absence counts from 0). */
export function sinceChat(s, col) { const e = getKey(peopleRec(s).chat, col.id); return s.tick - (e ? e[1] : 0); }

/** Tick system (slot 'social'): chats (hourly per colonist), lovers (daily). */
export function socialSystem(s) {
  if (!stage2()) return;
  const slot = s.tick % TICKS_PER_HOUR;
  const R = SO.chatR * 32;
  for (const a of s.col) {
    if ((a.id * 37) % TICKS_PER_HOUR !== slot || !social(a)) continue;
    for (const b of s.col) {
      if (b === a || !social(b) || Math.abs(a.x - b.x) > R || Math.abs(a.y - b.y) > R) continue;
      if (hash3(a.id, b.id, s.tick) % 1000 < SO.chatPermille) chat(s, a, b);
      break;
    }
  }
  if (s.tick % TICKS_PER_DAY !== 0) return;
  const hasLover = (c) => s.col.some((o) => o !== c && !o.hp.dead && (kindOf(s, c.id, o.id) === 'lover' || kindOf(s, c.id, o.id) === 'spouse'));
  for (const a of s.col) {
    if (a.hp.dead || hasLover(a)) continue;
    for (const b of s.col) {
      if (b.id <= a.id || b.hp.dead || hasLover(b) || opinion(s, a.id, b.id) < SO.loverOp) continue;
      if (hash3(a.id, b.id, s.tick) % 1000 >= SO.loverPermille) continue;
      setKind(s, a.id, b.id, 'lover');
      addThought(s, a, 'new_lover'); addThought(s, b, 'new_lover');
      break;
    }
  }
}
