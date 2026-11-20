// Joy (doc 4.4, 5.2; owner F; Stage 2). Joy falls 30 a day (needs.js); these jobs restore it.
//
//   A colonist goes for joy in their Joy hours (schedule) while Joy < PEOPLE.joy.until, or any time
//   it drops under seekBelow. The activity is picked from what the hold offers, in a fixed order,
//   with a hash of (colonist, day, hour) for variety:
//     drink    an ale, mead or wine from the stores (the item's food.joy x 4 points, its nutrition too)
//     shrine   pray at a shrine or temple (Devout: twice the joy)
//     games    a dice board or a tavern
//     spar     soldiers train at a training yard (Melee XP as well)
//     hearth   sit within PEOPLE.joy.hearthR of the Hearth (always there: the fallback)
//   An activity job is [goto spot, joy(kind, up to maxH hours)]; the joy toil adds the kind's points per
//   game hour as exact integers per tick and ends when Joy reaches `until`. Chats (social.js) happen
//   between colonists who are both at joy or eating within 3 tiles.
// Jobs carry need: true, so the interrupt hook leaves them alone; they are plain saved data.

import { FIX, SCHED } from '../core/schema.js';
import { idx, tx, ty, inB, TER_PASSABLE, TER_WATER } from '../core/grid.js';
import { TICKS_PER_HOUR, hourOf, dayOf } from '../core/time.js';
import { bldById } from '../core/state.js';
import { emit } from '../core/events.js';
import { RUN, NEXT, T, makeJob, registerToil, keyItem, isReserved, keyBld } from '../work/jobs.js';
import { candidates as itemCandidates, freeCount } from '../work/items.js';
import { colTile } from '../work/reserve.js';
import { reachableFrom, standSpot } from '../work/windex.js';
import { footprint } from '../work/construct.js';
import { def, traitFlag, PEOPLE } from './defs.js';
import { NEED, NEED_MAX, satisfy } from './needs.js';
import { awardXp } from './skills.js';
import { addThought } from './mood.js';
import { hash3 } from './peoplerec.js';

const J = PEOPLE.joy;
export const JOY_KINDS = Object.freeze(['drink', 'shrine', 'games', 'spar', 'hearth']);
const JOY_THOUGHT = Object.freeze({ shrine: 'prayed', games: 'played_games', spar: 'sparred', hearth: 'by_the_hearth' });
const BLD_KINDS = Object.freeze({ shrine: ['shrine', 'temple'], games: ['dicetable', 'tavern'], spar: ['trainingyard'] });

/** Joy points an hour of `kind` gives this colonist. */
export function joyPerHour(col, kind) {
  const base = J[kind] | 0;
  return kind === 'shrine' && traitFlag(col, 'mood.devout') ? Math.floor((base * J.devoutPct) / 100) : base;
}
export const wantsJoy = (s, col) => col.need[NEED.joy] < J.until * FIX && col.sched[hourOf(s.tick)] === SCHED.JOY;
export const lowJoy = (col) => col.need[NEED.joy] < J.seekBelow * FIX;

/** The nearest finished building of the given defs the colonist can stand by: { b, stand } or null. */
function nearestBld(s, col, defs) {
  const c = colTile(col), cx = tx(c), cy = ty(c);
  let best = null, bd = Infinity;
  for (const b of s.bld) {
    if (!b || b.st !== 'done' || !defs.includes(b.def)) continue;
    const d = Math.max(Math.abs(b.x - cx), Math.abs(b.y - cy));
    if (d >= bd || d > 60) continue;
    const st = standSpot(s, col, footprint(s, b));
    if (st.i < 0) continue;
    bd = d; best = { b, stand: st.i };
  }
  return best;
}
/** A free tile within hearthR of the Hearth (hash-picked for spread), or -1. */
function hearthSpot(s, col) {
  const h = s.colony.hearth, hb = h && h.id !== null ? bldById(s, h.id) : null;
  if (!hb) return -1;
  const R = J.hearthR, cx = hb.x + 1, cy = hb.y + 1;
  for (let k = 0; k < 16; k++) {
    const r = hash3(col.id, s.tick, k);
    const x = cx + (r % (2 * R + 1)) - R, y = cy + ((r >>> 8) % (2 * R + 1)) - R;
    if (!inB(x, y)) continue;
    const i = idx(x, y, hb.z | 0);
    if (TER_PASSABLE[s.L.terrain[i]] === 1 && !TER_WATER[s.L.terrain[i]] && s.rt.occ[i] < 0 && reachableFrom(s, col, i)) return i;
  }
  return -1;
}
/** A drink in the stores the colonist can reach: the stack, or null. */
function drinkFor(s, col) {
  const cs = itemCandidates(s, { cat: 'drink', holder: col.id, minN: 1 }, colTile(col), (i) => reachableFrom(s, col, i));
  for (const it of cs) { const d = def('item', it.k); if (d && d.food && d.food.kind === 'drink') return it; }
  return null;
}

/** The joy job for a colonist now, or null (nothing reachable, not even the Hearth). */
export function joyJob(s, col) {
  const maxN = J.maxH * TICKS_PER_HOUR;
  const avail = [];
  for (const kind of JOY_KINDS) {
    if (kind === 'drink') { const it = drinkFor(s, col); if (it && freeCount(s, it.id, col.id) > 0) avail.push({ kind, it }); continue; }
    if (kind === 'spar' && !col.soldier) continue;
    if (kind === 'hearth') { const i = hearthSpot(s, col); if (i >= 0) avail.push({ kind, i }); continue; }
    const nb = nearestBld(s, col, BLD_KINDS[kind]);
    if (nb && !isReserved(s, keyBld(nb.b.id), col.id)) avail.push({ kind, i: nb.stand, b: nb.b.id });
  }
  if (!avail.length) return null;
  const pick = avail[hash3(col.id, dayOf(s.tick), hourOf(s.tick)) % avail.length];
  if (pick.kind === 'drink') {
    const it = pick.it;
    const toils = [T.goto(idx(it.x, it.y, it.z | 0)), T.pickup(it.id, 1), { t: 'drink', n: 10 * 10 }];
    return { job: makeJob('joy', keyItem(it.id), toils, { need: true, joy: 'drink' }), claims: [[keyItem(it.id), 1]] };
  }
  const toils = [T.goto(pick.i), { t: 'joy', kind: pick.kind, n: maxN }];
  return makeJob('joy', pick.b !== undefined ? keyBld(pick.b) : -1, toils, { need: true, joy: pick.kind });
}

registerToil('joy', (s, col, job, toil) => {
  const rate = joyPerHour(col, toil.kind) * FIX;
  const w = job.work++;
  satisfy(col, 'joy', Math.floor((rate * (w + 1)) / TICKS_PER_HOUR) - Math.floor((rate * w) / TICKS_PER_HOUR));
  if (toil.kind === 'spar' && w % 10 === 0) awardXp(s, col, 'melee', 10);
  if (job.work < toil.n && col.need[NEED.joy] < NEED_MAX) return RUN;
  if (job.work >= TICKS_PER_HOUR / 2) addThought(s, col, JOY_THOUGHT[toil.kind] || 'by_the_hearth');
  return NEXT;
});
registerToil('drink', (s, col, job, toil) => {
  if (++job.work < toil.n) return RUN;
  const b = job.carry;
  if (!b || !b.n) return 'noDrink';
  const d = def('item', b.k), f = d && d.food;
  if (f) { satisfy(col, 'joy', ((f.joy | 0) * 4) * FIX * b.n); satisfy(col, 'food', (f.nutr | 0) * FIX * b.n); addThought(s, col, 'drank'); }
  job.carry = null;
  emit(s, 'ate', { colId: col.id, k: b.k });
  return NEXT;
});
