// The Animals work giver (doc 5.1: hunt, tame, train, milk, shear, slaughter, feed). Owner K (the
// only giver in js/game/work/givers/ that E does not own). Implements E's C7 WorkGiver contract
// (work/jobs.js): { id, work, order, candidates, valid, make, keyOf }. Targets are animal ids;
// keys are keyAnim(id) so E's reservations and unreachable memory cover them.
//
// Stage 2 (14.8 K), four givers in the Animals work type, in order:
//   tame       wild farm kinds (hen, goat, sheep, ox) within AUTO_R of the Hearth, when a pen has room
//              for one more and the handler has the Animals level (tame.canTame); any tameable animal
//              by the prioritise command. The handler holds the animal still, walks up and works
//              TAME_MIN minutes, then tame.tryTame rolls (a failure makes it wary for a day).
//   produce    a tame animal whose milk or wool is due (breeding.productReady): MILK_MIN minutes of
//              Animals work, then the product drops at the animal (haulers store it).
//   hunt       game (deer, hares; the boar only by order) while the hold has less than HUNT_FOOD_DAYS days of food, or any
//              wild animal by the prioritise command: strike every STRIKE_EVERY ticks (worn weapon,
//              else fists; Archery or Melee sets the hit chance) until it dies (a carcass drops for
//              the butcher). A boar or wolf turns on the hunter (manhunter.js).
//   slaughter  the youngest grown animal of a pen holding more than it has room for.
// A job's animal is 'held' (wild.js) from its first toil; the hold ends with the job (registerJobType).
// Train and feed (troughs are filled by haulers through their store filter) wait for Stage 3.

import { W, cheb } from '../../core/grid.js';
import { bldById } from '../../core/state.js';
import { FIX } from '../../core/schema.js';
import { TICKS_PER_MIN } from '../../core/time.js';
import { nextU32 } from '../../core/rand.js';
import { RUN, NEXT, END, T, makeJob, keyAnim, registerToil, registerJobType, myClaim, getMover, workHooks } from '../jobs.js';
import { colTile } from '../reserve.js';
import { openTarget, distTo, reachableFrom } from '../windex.js';
import { def } from '../../colony/defs.js';
import { level } from '../../people/skills.js';
import { animalById, animTile, hurtAnimal, killAnimal } from '../../animals/spawn.js';
import { canTame, tryTame, wary } from '../../animals/tame.js';
import { penRoomFor, penOf, penRoom } from '../../animals/pens.js';
import { productReady, takeProduct, grown } from '../../animals/breeding.js';
import { isManhunter, blowOf } from '../../animals/manhunter.js';

export const ANIMAL_JOBS = Object.freeze(['tame', 'train', 'milk', 'shear', 'slaughter', 'hunt', 'feed']);
export const AUTO_R = 40, TAME_MIN = 20, MILK_MIN = 10, SLAUGHTER_MIN = 6, STRIKE_EVERY = 30, HUNT_FOOD_DAYS = 4, HOLD_TICKS = 1500, CHASE_TICKS = 900;
const FARM = new Set(['farm']), GAME = new Set(['wild']);

const hearth = (s) => { const h = s.colony.hearth; const b = h && h.id !== null ? bldById(s, h.id) : null; return b ? [b.x + 1, b.y + 1] : null; };
const nearHome = (s, a) => { const h = hearth(s); if (!h) return true; const i = animTile(a); return cheb(i % W, (i / W) | 0, h[0], h[1]) <= AUTO_R; };
/** Days of food in the hold: nutrition of every non-forbidden food stack / (colonists x a day's need). */
export function foodDays(s) {
  let nutr = 0;
  const st = s.rt.stock;
  for (const k of Object.keys(st).sort()) { const d = def('item', k); if (d && d.food) nutr += (d.food.nutr | 0) * st[k]; }
  let n = 0; for (const c of s.col) if (!c.hp.dead) n++;
  return n ? Math.floor(nutr / (n * 32)) : 99;
}
function cand(s, col, a) {
  if (!a || !openTarget(s, col, keyAnim(a.id))) return null;
  const i = animTile(a);
  if (!reachableFrom(s, col, i)) return null;
  const d = distTo(s, col, i);
  return d === Infinity ? null : { key: keyAnim(a.id), id: a.id, d };
}
const ranked = (s, col, k, want) => {
  const out = [];
  for (const a of s.anim) if (want(a)) { const t = cand(s, col, a); if (t) out.push(t); }
  out.sort((p, q) => p.d - q.d || p.key - q.key);
  return out.slice(0, k);
};
const job = (type, a, toils) => ({ job: makeJob(type, keyAnim(a.id), [{ t: 'holdAnim', a: a.id }, ...toils], { anim: a.id }), claims: [[keyAnim(a.id), 0]] });

// ---- tame ---------------------------------------------------------------------------------------------
const autoTame = (s, col, a) => {
  const d = def('animal', a.kind);
  return !a.tame && !!d && FARM.has(d.kind) && !wary(s, a) && !isManhunter(a) && !canTame(col, a) && nearHome(s, a) && penRoomFor(s, a.kind);
};
export const TAME_GIVER = Object.freeze({
  id: 'tame', work: 'animals', order: 0,
  candidates(s, col, k) { return ranked(s, col, k, (a) => autoTame(s, col, a)); },
  valid(s, col, t) { const a = animalById(s, t.id); return !!a && !a.tame && !canTame(col, a) && !wary(s, a); },
  make(s, col, t) { const a = animalById(s, t.id); return job('tame', a, [{ t: 'nearAnim', a: a.id }, { t: 'tameAnim', a: a.id, n: TAME_MIN * TICKS_PER_MIN }]); },
  keyOf: (t) => t.key,
  fromTarget(s, col, tg) { if (!tg || tg.kind !== 'anim') return null; const a = animalById(s, tg.id); return a && !a.tame && !canTame(col, a) ? cand(s, col, a) : null; },
});
// ---- produce (milk, shear) ------------------------------------------------------------------------------
export const PRODUCE_GIVER = Object.freeze({
  id: 'produce', work: 'animals', order: 1,
  candidates(s, col, k) { return ranked(s, col, k, (a) => a.tame && productReady(a)); },
  valid(s, col, t) { const a = animalById(s, t.id); return !!a && a.tame && productReady(a); },
  make(s, col, t) { const a = animalById(s, t.id); return job('milk', a, [{ t: 'nearAnim', a: a.id }, { t: 'milkAnim', a: a.id, n: MILK_MIN * TICKS_PER_MIN }]); },
  keyOf: (t) => t.key,
  fromTarget(s, col, tg) { if (!tg || tg.kind !== 'anim') return null; const a = animalById(s, tg.id); return a && a.tame && productReady(a) ? cand(s, col, a) : null; },
});
// ---- hunt -----------------------------------------------------------------------------------------------
// dangerous game (a threat cost: the boar) is hunted only on the player's order
const autoHunt = (s, a) => { const d = def('animal', a.kind); return !a.tame && !!d && GAME.has(d.kind) && !d.pts && nearHome(s, a) && !isManhunter(a); };
export const HUNT_GIVER = Object.freeze({
  id: 'hunt', work: 'animals', order: 2,
  candidates(s, col, k) { if (foodDays(s) >= HUNT_FOOD_DAYS) return []; return ranked(s, col, k, (a) => autoHunt(s, a)); },
  valid(s, col, t) { const a = animalById(s, t.id); return !!a && !a.tame; },
  make(s, col, t) { const a = animalById(s, t.id); return job('hunt', a, [{ t: 'nearAnim', a: a.id }, { t: 'strikeAnim', a: a.id }]); },
  keyOf: (t) => t.key,
  fromTarget(s, col, tg) { if (!tg || tg.kind !== 'anim') return null; const a = animalById(s, tg.id); return a && !a.tame ? cand(s, col, a) : null; },
});
// ---- slaughter (an overfull pen) ---------------------------------------------------------------------------
function cullOf(s) {
  const out = [];
  for (const a of s.anim) {
    if (!a.tame || a.pen === null || !penOf(s, a)) continue;
    const r = penRoom(s, a.pen);
    if (r.used <= r.cap || !grown(a)) continue;
    out.push(a);
  }
  return out;
}
export const SLAUGHTER_GIVER = Object.freeze({
  id: 'slaughter', work: 'animals', order: 3,
  candidates(s, col, k) { const c = cullOf(s); if (!c.length) return []; return ranked(s, col, k, (a) => c.includes(a)); },
  valid(s, col, t) { const a = animalById(s, t.id); return !!a && cullOf(s).includes(a); },
  make(s, col, t) { const a = animalById(s, t.id); return job('slaughter', a, [{ t: 'nearAnim', a: a.id }, { t: 'killAnim', a: a.id, n: SLAUGHTER_MIN * TICKS_PER_MIN }]); },
  keyOf: (t) => t.key,
});
export const ANIMAL_GIVERS = Object.freeze([TAME_GIVER, PRODUCE_GIVER, HUNT_GIVER, SLAUGHTER_GIVER]);
/** The giver E's think finds first (kept for the Stage 0 import). */
export const ANIMALS_GIVER = TAME_GIVER;

// ---- toils ----------------------------------------------------------------------------------------------
const mine = (s, col, a) => !!a && myClaim(s, keyAnim(a.id), col.id) >= 0;
const beside = (col, a) => { const c = colTile(col), i = animTile(a); return cheb(c % W, (c / W) | 0, i % W, (i / W) | 0) <= 1; };
registerToil('holdAnim', (s, col, job, toil) => {
  const a = animalById(s, toil.a);
  if (!mine(s, col, a)) return END.TARGET_GONE;
  if (!isManhunter(a)) { a.st = { ...(a.st || {}), mode: 'held', until: s.tick + HOLD_TICKS }; a.path = null; }
  return NEXT;
});
// walk beside the (held, slowly settling) animal; re-aim while it is still moving
registerToil('nearAnim', (s, col, job, toil) => {
  const a = animalById(s, toil.a);
  if (!mine(s, col, a)) return END.TARGET_GONE;
  if (beside(col, a)) { const m = getMover(); if (m && col.path) m.stop(s, col); return NEXT; }
  if (++job.work > CHASE_TICKS) return 'lostAnimal';
  const m = getMover();
  if (!m) return 'noMover';
  const goal = animTile(a);
  const st = m.status(s, col, goal, true);
  if (st === 'pending' || st === 'moving') { if (job.work % 60 === 0) m.request(s, col, goal, true); return RUN; }
  return m.request(s, col, goal, true) ? RUN : END.UNREACHABLE;
});
function workOn(s, col, job, toil, sk) {
  const h = workHooks();
  const sp = h.speed(s, col, toil) | 0;
  if (sp > 0) job.work += sp;
  if (h.xp) h.xp(s, col, sk, 1);
  return job.work >= toil.n * 100;
}
registerToil('tameAnim', (s, col, job, toil) => {
  const a = animalById(s, toil.a);
  if (!mine(s, col, a) || a.tame) return END.TARGET_GONE;
  if (!beside(col, a)) return 'notThere';
  if (!workOn(s, col, job, toil, 'animals')) return RUN;
  tryTame(s, col, a);
  return NEXT;
});
registerToil('milkAnim', (s, col, job, toil) => {
  const a = animalById(s, toil.a);
  if (!mine(s, col, a)) return END.TARGET_GONE;
  if (!beside(col, a)) return 'notThere';
  if (!workOn(s, col, job, toil, 'animals')) return RUN;
  takeProduct(s, a);
  return NEXT;
});
registerToil('killAnim', (s, col, job, toil) => {
  const a = animalById(s, toil.a);
  if (!mine(s, col, a)) return END.TARGET_GONE;
  if (!beside(col, a)) return 'notThere';
  if (!workOn(s, col, job, toil, 'animals')) return RUN;
  killAnimal(s, a);
  return NEXT;
});
registerToil('strikeAnim', (s, col, job, toil) => {
  const a = animalById(s, toil.a);
  if (!a) return NEXT;                       // it died
  if (myClaim(s, keyAnim(a.id), col.id) < 0) return END.TARGET_GONE;
  if (!beside(col, a)) { const m = getMover(); if (m && ++job.work % 30 === 0) m.request(s, col, animTile(a), true); return job.work > CHASE_TICKS * 100 ? 'lostAnimal' : RUN; }
  job.ts = job.ts || { n: 0 };
  if (++job.ts.n % STRIKE_EVERY !== 0) return RUN;
  const h = workHooks();
  if (h.xp) h.xp(s, col, 'archery', STRIKE_EVERY);
  const hit = 60 + 3 * Math.max(level(col, 'archery'), level(col, 'melee'));
  if (nextU32(s, 'main') % 100 < hit && hurtAnimal(s, a, blowOf(col), col.id)) return NEXT;
  return job.ts.n > 1200 ? NEXT : RUN;
});
// the hold ends with the job, whatever ended it
const unhold = (s, col, job) => { const a = job.anim !== undefined ? animalById(s, job.anim) : null; if (a && a.st && a.st.mode === 'held') { a.st.mode = 'graze'; a.st.until = s.tick + 60; } };
for (const t of ['tame', 'milk', 'hunt', 'slaughter']) registerJobType(t, { onEnd: unhold });
void FIX;
