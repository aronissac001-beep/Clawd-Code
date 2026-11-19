// Need, break and rest jobs, and the think hooks that pick them (doc 4.4-4.6, 5.3; owner F).
// Stage 1b: installPeople({ needs: true, ... }) registers these hooks with E's think step
// (work/jobs.js setThinkHooks); with them unset (Stage 1a) colonists only work.
//
// Think order (5.3):
//   1. forced    dead or downed: hold (no job; the Care giver rescues the downed); a break's behaviour
//                (Sulk: wander near the Hearth; Comfort binge: eat two meals, then sulk); Rest 0:
//                collapse asleep where they stand.
//   2. urgent    Food < 25: eat; Rest < 15: sleep; Light < 15: walk to a lit tile; a bleeding wound:
//                bed rest.
//   3. schedule  Sleep hours and Rest < 90: sleep. (Joy hours: Stage 2.)
//   5. fallback  Food < 60: eat; standing in the dark with Light < 60: seek light.
//   interrupt    every 60 ticks a working colonist whose urgent need has a job waiting stops work.
//
// Jobs (E's C7 toil lists; plain saved data, so a save mid-meal or mid-sleep continues identically):
//   eat       goto food, pickup n, [goto a table], eat(n ticks): need += nutr x n; Ate raw food /
//             A hot meal / Ate without a table; emits 'ate'. The amount brings Food to about eatTo.
//   sleep     [goto bed], sleep: Rest += perHour (x groundPct on the ground) each game hour; wakes when
//             full, or rested (>= wakeAt) outside Sleep hours, or hungry (urgent food, Rest >= urgent);
//             claims the bed (keyBld) and takes ownership of a free unowned one; emits 'slept'.
//   seekLight goto the nearest lit tile (rt.light >= 2), bask until Light >= seekTo (at most 2 h).
//   bedrest   [goto bed], bedrest: lie in bed while downed or a wound is untended (health.js tends
//             wounds after an hour in bed and heals parts). The Care giver starts it for a rescued patient.
//   sulk      goto a random tile within sulkR of the Hearth, wait sulkWaitMin (repeats while the break lasts).
// Stage 2 (people stage '2'):
//   joy        joy.js: in Joy hours while Joy < 85 (schedule), and whenever Joy < 35 (fallback).
//   seekWarmth Warmth < 25 (urgent): the nearest reachable tile at 14 C or warmer (a heated room, the
//              Hearth's radius); bask until Warmth >= 70 (at most 2 h).
//   breaks     hide (their own room), tantrum (smash 1-3 furniture or items), dark wander (into unlit
//              tunnels), insult spree (cruel words to 1-3 colonists), Hollow-whispered (walk to the Grey
//              Edge: taint when they reach it), catatonic (lie in bed), firestarter (Pyromaniacs set
//              1-3 fires). Each is a plain saved job; the break state counts what is done.
// Every job here carries `need: true` (or `brk: true` for break behaviour) so the interrupt hook
// leaves it alone. The makers are pure: nothing changes until beginJob claims and the toils run.

import { FIX, SCHED } from '../core/schema.js';
import { W, H, idx, tx, ty, inB, TER_PASSABLE, TER_WATER } from '../core/grid.js';
import { TICKS_PER_MIN, TICKS_PER_HOUR, hourOf } from '../core/time.js';
import { bldById } from '../core/state.js';
import { structDef, hasFlag } from '../core/content.js';
import { emit } from '../core/events.js';
import { rnd } from '../core/rand.js';
import { RUN, NEXT, HOLD, T, makeJob, registerToil, keyItem, keyBld, isReserved, myClaim, setThinkHooks, clearThinkHooks } from '../work/jobs.js';
import { candidates as itemCandidates, freeCount } from '../work/items.js';
import { colTile, beginJob } from '../work/reserve.js';
import { reachableFrom, standSpot } from '../work/windex.js';
import { footprint } from '../work/construct.js';
import { bal, def, traitFlag, PEOPLE, stage2 } from './defs.js';
import { NEED, NEED_MAX, needActive, satisfy, urgent } from './needs.js';
import { addThought } from './mood.js';
import { hurt } from './health.js';
import { joyJob, wantsJoy, lowJoy } from './joy.js';
import { roomThoughtsAfterSleep, roomThoughtsAfterMeal } from './surround.js';
import { emberJob } from './embertouch.js';
import { tempAt } from '../world/terrain.js';
import { canBurn, ignite } from '../world/fire.js';
import { removeBuilding } from '../core/apply.js';
import { addOpinion } from './social.js';

const N_ = () => bal('needs');
const E_ = () => N_().eat || {};
const S_ = () => N_().sleep || {};
const L_ = () => N_().light || {};
const below = (col, id, pts) => col.need[NEED[id]] < pts * FIX;
/** Job types made here (the interrupt hook never cuts them short). */
export const NEED_JOBS = Object.freeze(['eat', 'sleep', 'seekLight', 'bedrest', 'sulk', 'joy', 'seekWarmth', 'ember']);
const isNeedJob = (j) => !!j && (j.need || j.brk || NEED_JOBS.includes(j.type));

// ---- Food -------------------------------------------------------------------------------------------
/** The full item def (food values live there; work/items.js keeps only stack, category and mass). */
const itemDef = (k) => def('item', k);
const nutrOf = (k) => { const d = itemDef(k); return d && d.food ? d.food.nutr | 0 : 0; };
/** The food stack col would eat now: the nearest reachable meal, else the nearest raw food. */
export function foodFor(s, col) {
  const from = colTile(col);
  for (const cat of ['meals', 'rawfood']) {
    const cs = itemCandidates(s, { cat, holder: col.id, minN: 1 }, from, (i) => reachableFrom(s, col, i));
    for (const it of cs) if (nutrOf(it.k) > 0) return it;
  }
  return null;
}
/** A finished table within tableR tiles of tile (x, y) the colonist can stand by: its stand tile, or -1. */
function tableSpot(s, col, x, y) {
  const R = E_().tableR || 12;
  let best = -1, bd = Infinity;
  for (const b of s.bld) {
    if (!b || b.st !== 'done' || Math.max(Math.abs(b.x - x), Math.abs(b.y - y)) > R) continue;
    if (!hasFlag(structDef(b.def), 'table')) continue;
    const st = standSpot(s, col, footprint(s, b));
    if (st.i >= 0 && st.d < bd) { bd = st.d; best = st.i; }
  }
  return best;
}
/** The eat job (binge: eat bingeMeals whatever the need). */
export function eatJob(s, col, { binge = false } = {}) {
  const it = foodFor(s, col);
  if (!it) return null;
  const e = E_(), nutr = nutrOf(it.k);
  const want = binge ? (e.bingeMeals || 2) : Math.max(1, Math.round(((e.eatTo || 90) * FIX - col.need[NEED.food]) / (nutr * FIX)));
  const n = Math.min(want, freeCount(s, it.id, col.id));
  if (n <= 0) return null;
  const meal = itemDef(it.k).food.kind !== 'raw';
  const work = n * (meal ? e.eatMinMeal || 10 : e.eatMinRaw || 2) * TICKS_PER_MIN;
  const toils = [T.goto(idx(it.x, it.y)), T.pickup(it.id, n)];
  const table = tableSpot(s, col, it.x, it.y);
  if (table >= 0) toils.push(T.goto(table));
  toils.push({ t: 'eat', n: work, table: table >= 0 ? 1 : 0 });
  const job = makeJob('eat', keyItem(it.id), toils, { need: true, ...(binge ? { brk: true } : {}) });
  return { job, claims: [[keyItem(it.id), n]] };
}
registerToil('eat', (s, col, job, toil) => {
  if (++job.work < toil.n) return RUN;
  const b = job.carry;
  if (!b || !b.n) return 'noFood';
  const d = itemDef(b.k), nutr = d && d.food ? d.food.nutr | 0 : 0;
  satisfy(col, 'food', nutr * FIX * b.n);
  const raw = d && d.food && d.food.kind === 'raw';
  if (raw) { if (!traitFlag(col, 'need.rawOk')) addThought(s, col, 'ate_raw'); }
  else addThought(s, col, b.k === 'finemeal' ? 'ate_fine_meal' : b.k === 'feast' ? 'ate_feast' : 'ate_meal');
  if (!toil.table) addThought(s, col, 'ate_floor');
  else roomThoughtsAfterMeal(s, col, colTile(col));
  job.carry = null;
  if (job.brk && col.breakState) col.breakState.ate = 1;
  emit(s, 'ate', { colId: col.id, k: b.k });
  return NEXT;
});

// ---- Sleep and beds ---------------------------------------------------------------------------------------
const isBed = (b) => !!b && b.st === 'done' && hasFlag(structDef(b.def), 'bed');
/** A bed col may lie in now: its own (if not taken), else the nearest free unowned one in reach. */
export function bedFor(s, col, from = colTile(col)) {
  const own = col.bed !== null ? bldById(s, col.bed) : null;
  if (isBed(own) && own.owner === col.id && !isReserved(s, keyBld(own.id), col.id) && reachableFrom(s, col, idx(own.x, own.y))) return own;
  const R = S_().bedSearchR || 60, fx = tx(from), fy = ty(from);
  let best = null, bd = Infinity;
  for (const b of s.bld) {
    if (!isBed(b) || (b.owner !== null && b.owner !== col.id) || isReserved(s, keyBld(b.id), col.id)) continue;
    const d = Math.max(Math.abs(b.x - fx), Math.abs(b.y - fy));
    if (d > R || d >= bd || !reachableFrom(s, col, idx(b.x, b.y))) continue;
    bd = d; best = b;
  }
  return best;
}
/** Make b col's bed (the assign command's rule: one owner, one bed). */
export function ownBed(s, col, b) {
  if (b.owner === col.id && col.bed === b.id) return;
  if (b.owner !== null && b.owner !== col.id) return;
  if (col.bed !== null && col.bed !== b.id) { const old = bldById(s, col.bed); if (old && old.owner === col.id) old.owner = null; }
  b.owner = col.id; col.bed = b.id;
}
/** The sleep job: to a bed when one is free, else on the ground where they stand (collapse: always there). */
export function sleepJob(s, col, { collapse = false } = {}) {
  const b = collapse ? null : bedFor(s, col);
  if (b) return { job: makeJob('sleep', keyBld(b.id), [T.goto(idx(b.x, b.y)), { t: 'sleep', g: 0 }], { need: true, bed: b.id }), claims: [[keyBld(b.id), 0]] };
  return makeJob('sleep', -1, [{ t: 'sleep', g: 1 }], { need: true, bed: -1, ...(collapse ? { collapse: 1 } : {}) });
}
const sleepHour = (s, col) => col.sched[hourOf(s.tick)] === SCHED.SLEEP;
registerToil('sleep', (s, col, job, toil) => {
  if (job.work === 0 && job.bed >= 0) {
    const b = bldById(s, job.bed);
    if (!isBed(b) || myClaim(s, keyBld(b.id), col.id) < 0) return 'lostBed';
    ownBed(s, col, b);
  }
  const sp = S_();
  const rate = Math.floor(((sp.perHour || 13) * FIX * (toil.g ? sp.groundPct || 60 : 100)) / 100);   // per game hour
  const w = job.work++;
  satisfy(col, 'rest', Math.floor((rate * (w + 1)) / TICKS_PER_HOUR) - Math.floor((rate * w) / TICKS_PER_HOUR));
  const rest = col.need[NEED.rest];
  const u = N_().urgent || {};
  const wake = rest >= NEED_MAX
    || (rest >= (sp.wakeAt || 90) * FIX && !sleepHour(s, col))
    || (needActive('food') && urgent(col, 'food') && rest >= (u.rest || 15) * FIX && !!foodFor(s, col));
  if (!wake) return RUN;
  if (job.work >= TICKS_PER_HOUR) { addThought(s, col, toil.g ? 'slept_ground' : 'slept_bed'); if (!toil.g && job.bed >= 0) roomThoughtsAfterSleep(s, col, job.bed); }
  emit(s, 'slept', { colId: col.id, bed: job.bed });
  return NEXT;
});

// ---- Light -----------------------------------------------------------------------------------------------
const litTile = (s, i) => s.rt.light[i] >= 2 && TER_PASSABLE[s.L.terrain[i]] === 1 && !TER_WATER[s.L.terrain[i]];
/** The nearest lit tile col can reach (ring scan up to seekR tiles), or -1. */
export function nearestLit(s, col) {
  if (!s.rt.light) return -1;
  const c = colTile(col), cx = tx(c), cy = ty(c), R = L_().seekR || 40;
  for (let r = 0; r <= R; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = idx(x, y);
      if (litTile(s, i) && reachableFrom(s, col, i)) return i;
    }
  }
  return -1;
}
export function seekLightJob(s, col) {
  const i = nearestLit(s, col);
  if (i < 0) return null;
  return makeJob('seekLight', i, [T.goto(i), { t: 'bask', n: 2 * TICKS_PER_HOUR }], { need: true });
}
registerToil('bask', (s, col, job, toil) => (++job.work >= toil.n || col.need[NEED.light] >= (L_().seekTo || 60) * FIX ? NEXT : RUN));

// ---- Bed rest ----------------------------------------------------------------------------------------------
/** The bed rest job for a hurt colonist who can walk. */
export function bedrestJob(s, col) {
  const b = bedFor(s, col);
  if (!b) return null;
  return { job: makeJob('bedrest', keyBld(b.id), [T.goto(idx(b.x, b.y)), { t: 'bedrest' }], { need: true, bed: b.id }), claims: [[keyBld(b.id), 0]] };
}
/** Put a (downed) patient who lies on bed b into bed rest (the Care giver's rescue). */
export function startBedrest(s, patient, b) {
  if (patient.job) return false;
  const job = makeJob('bedrest', keyBld(b.id), [{ t: 'bedrest' }], { need: true, bed: b.id });
  if (!beginJob(s, patient, job, [[keyBld(b.id), 0]])) return false;
  ownBed(s, patient, b);
  return true;
}
registerToil('bedrest', (s, col, job) => {
  const b = bldById(s, job.bed);
  if (!isBed(b) || myClaim(s, keyBld(b.id), col.id) < 0) return 'lostBed';
  job.work++;
  // a patient who can walk gets up to eat (and to sleep in the night: the sleep job lies in the
  // same bed) and comes back after (the urgent hook); the downed are fed in bed (Care)
  if (stage2() && !col.hp.down && ((needActive('food') && below(col, 'food', U('food'))) || (needActive('rest') && below(col, 'rest', U('rest'))))) return NEXT;
  return hurt(col) ? RUN : NEXT;
});
const bleeding = (col) => col.hp.wounds.some((w) => w.bleed > 0 && w.tended === 0);
/** Stage 2 bed rest for a walking colonist: the Grey Taint, an infected wound or a serious illness. */
export const needsBed = (col) => (col.hp.taint | 0) > 0 || col.hp.wounds.some((w) => (w.infected | 0) > 0)
  || (!!col.hp.illness && (col.hp.illness.sev | 0) >= 40 * FIX);

// ---- Breaks ------------------------------------------------------------------------------------------------
/** A sulk walk: a random open tile within sulkR of the Hearth (or of the colonist), then a wait. */
export function sulkJob(s, col) {
  const h = s.colony.hearth, hb = h && h.id !== null ? bldById(s, h.id) : null;
  const c = colTile(col);
  const cx = hb ? hb.x + 1 : tx(c), cy = hb ? hb.y + 1 : ty(c), R = N_().sulkR || 8;
  let goal = -1;
  for (let k = 0; k < 12 && goal < 0; k++) {
    const x = cx + Math.floor(rnd(s, 'main') * (2 * R + 1)) - R, y = cy + Math.floor(rnd(s, 'main') * (2 * R + 1)) - R;
    if (!inB(x, y)) continue;
    const i = idx(x, y);
    if (TER_PASSABLE[s.L.terrain[i]] === 1 && !TER_WATER[s.L.terrain[i]] && s.rt.occ[i] < 0 && reachableFrom(s, col, i)) goal = i;
  }
  const wait = T.wait((N_().sulkWaitMin || 45) * TICKS_PER_MIN);
  return makeJob('sulk', -1, goal >= 0 ? [T.goto(goal), wait] : [wait], { brk: true });
}
function breakJob(s, col) {
  const bs = col.breakState, d = def('break', bs.id);
  if (d && d.job === 'binge' && !bs.ate) { const j = eatJob(s, col, { binge: true }); if (j) return j; }
  const kind = d && d.job;
  const BR = PEOPLE.breaks;
  if (kind === 'hide') { const j = hideJob(s, col); if (j) return j; }
  if (kind === 'tantrum' && (bs.done | 0) < (bs.goal || BR.tantrumHits[1])) { const j = smashJob(s, col); if (j) return j; }
  if (kind === 'darkwander') { const j = darkJob(s, col); if (j) return j; }
  if (kind === 'insult' && (bs.done | 0) < 3) { const j = insultJob(s, col); if (j) return j; }
  if (kind === 'whispered') { const j = edgeJob(s, col); if (j) return j; }
  if (kind === 'catatonic') { const j = catatonicJob(s, col); if (j) return j; }
  if (kind === 'firestarter' && (bs.done | 0) < 3) { const j = fireJob(s, col); if (j) return j; }
  return sulkJob(s, col);
}

// ---- Stage 2 break behaviours ------------------------------------------------------------------------------
const passTile = (s, i) => TER_PASSABLE[s.L.terrain[i]] === 1 && !TER_WATER[s.L.terrain[i]];
const waitT = () => T.wait((N_().sulkWaitMin || 45) * TICKS_PER_MIN);
/** Hide: their own bed's room (or where they stand), and wait. */
function hideJob(s, col) {
  const b = col.bed !== null ? bldById(s, col.bed) : null;
  if (b && reachableFrom(s, col, idx(b.x, b.y))) return makeJob('hide', -1, [T.goto(idx(b.x, b.y)), waitT()], { brk: true });
  return null;
}
/** Things a tantrum can smash within 15 tiles: furniture and benches (not walls, doors, the Hearth), nearest first. */
function smashJob(s, col) {
  const c = colTile(col), cx = tx(c), cy = ty(c);
  let best = null, bd = Infinity;
  for (const b of s.bld) {
    if (!b || b.st !== 'done' || b.def === 'hearth') continue;
    const d0 = structDef(b.def);
    if (!d0 || hasFlag(d0, 'wall') || hasFlag(d0, 'door') || hasFlag(d0, 'floor') || d0.kind === 'zone') continue;
    const d = Math.max(Math.abs(b.x - cx), Math.abs(b.y - cy));
    if (d > 15 || d >= bd) continue;
    const st = standSpot(s, col, footprint(s, b));
    if (st.i < 0) continue;
    bd = d; best = { b, st: st.i };
  }
  if (!best) return null;
  return makeJob('tantrum', -1, [T.goto(best.st), { t: 'smash', b: best.b.id, n: 3 * TICKS_PER_MIN }], { brk: true });
}
registerToil('smash', (s, col, job, toil) => {
  if (++job.work < toil.n) return RUN;
  const b = bldById(s, toil.b);
  if (b && b.st === 'done') {
    b.hp -= PEOPLE.breaks.tantrumDmg;
    if (b.hp <= 0) removeBuilding(s, b, true);
  }
  if (col.breakState) col.breakState.done = (col.breakState.done | 0) + 1;
  return NEXT;
});
/** Dark wander: a reachable unlit tile within darkR (ring scan), then a wait there. */
function darkJob(s, col) {
  const c = colTile(col), cx = tx(c), cy = ty(c), R = PEOPLE.breaks.darkR;
  for (let r = 6; r <= R; r += 3) {
    for (let k = 0; k < 8; k++) {
      const a = (rnd(s, 'main') * 8) | 0, x = cx + [r, -r, 0, 0, r, -r, r, -r][a], y = cy + [0, 0, r, -r, r, r, -r, -r][a];
      if (!inB(x, y)) continue;
      const i = idx(x, y);
      if (s.rt.light[i] === 0 && passTile(s, i) && s.rt.occ[i] < 0 && reachableFrom(s, col, i)) return makeJob('darkwander', -1, [T.goto(i), waitT()], { brk: true });
    }
  }
  return null;
}
/** Insult spree: walk up to another able colonist and say something cruel. */
function insultJob(s, col) {
  const others = s.col.filter((o) => o !== col && !o.hp.dead && !o.hp.down && reachableFrom(s, col, colTile(o)));
  if (!others.length) return null;
  const o = others[Math.floor(rnd(s, 'main') * others.length)];
  return makeJob('insult', -1, [T.goto(colTile(o), true), { t: 'insult', c: o.id }], { brk: true });
}
registerToil('insult', (s, col, job, toil) => {
  const o = s.col.find((x) => x.id === toil.c);
  if (o && !o.hp.dead) {
    const [lo, hi] = PEOPLE.breaks.insultOp;
    addOpinion(s, o.id, col.id, -(lo + Math.floor(rnd(s, 'main') * (hi - lo + 1))));
    addThought(s, o, 'insulted');
  }
  if (col.breakState) col.breakState.done = (col.breakState.done | 0) + 1;
  return NEXT;
});
/** Hollow-whispered: toward the nearest reachable map-edge tile. */
function edgeJob(s, col) {
  const c = colTile(col), cx = tx(c), cy = ty(c);
  const cands = [[0, cy], [W - 1, cy], [cx, 0], [cx, H - 1]].sort((a, b) => Math.abs(a[0] - cx) + Math.abs(a[1] - cy) - (Math.abs(b[0] - cx) + Math.abs(b[1] - cy)));
  for (const [x0, y0] of cands) {
    for (let d = 0; d < 20; d++) for (const sg of [1, -1]) {
      const x = x0 === 0 || x0 === W - 1 ? x0 : Math.max(0, Math.min(W - 1, x0 + sg * d)), y = y0 === 0 || y0 === H - 1 ? y0 : Math.max(0, Math.min(H - 1, y0 + sg * d));
      const i = idx(x, y);
      if (passTile(s, i) && reachableFrom(s, col, i)) return makeJob('whispered', -1, [T.goto(i), { t: 'whispered' }], { brk: true });
    }
  }
  return null;
}
registerToil('whispered', (s, col) => {
  col.hp.taint = Math.min(100 * FIX, (col.hp.taint | 0) + PEOPLE.breaks.whisperTaint * FIX);
  if (col.breakState) col.breakState.until = s.tick;   // the Edge has had its say: the break ends
  return NEXT;
});
/** Catatonic: lie in their bed (or where they are). */
function catatonicJob(s, col) {
  const b = bedFor(s, col);
  const lie = { t: 'wait', n: 4 * TICKS_PER_HOUR };
  if (b) return { job: makeJob('catatonic', keyBld(b.id), [T.goto(idx(b.x, b.y)), lie], { brk: true, bed: b.id }), claims: [[keyBld(b.id), 0]] };
  return makeJob('catatonic', -1, [lie], { brk: true });
}
/** Firestarter: a flammable tile within firestarterR, then set it alight. */
function fireJob(s, col) {
  const c = colTile(col), cx = tx(c), cy = ty(c), R = PEOPLE.breaks.firestarterR;
  for (let r = 2; r <= R; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = cx + dx, y = cy + dy;
      if (!inB(x, y)) continue;
      const i = idx(x, y);
      if (!canBurn(s, i)) continue;
      const stand = [i - 1, i + 1, i - W, i + W].find((j) => j >= 0 && j < W * H && passTile(s, j) && s.rt.occ[j] < 0 && reachableFrom(s, col, j));
      if (stand === undefined) continue;
      return makeJob('firestarter', -1, [T.goto(stand), { t: 'setFire', i }], { brk: true });
    }
  }
  return null;
}
registerToil('setFire', (s, col, job, toil) => {
  if (!traitFlag(col, 'mood.firekeeper')) ignite(s, toil.i, 60);
  if (col.breakState) col.breakState.done = (col.breakState.done | 0) + 1;
  return NEXT;
});

// ---- Warmth (Stage 2) ----------------------------------------------------------------------------------------
/** The nearest reachable tile at seekTemp or warmer (ring scan up to seekR), or -1. */
export function nearestWarm(s, col) {
  const Wm = PEOPLE.warmth, c = colTile(col), cx = tx(c), cy = ty(c);
  for (let r = 0; r <= Wm.seekR; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = cx + dx, y = cy + dy;
      if (!inB(x, y)) continue;
      const i = idx(x, y);
      if (passTile(s, i) && s.rt.occ[i] < 0 && tempAt(s, i) >= Wm.seekTemp && reachableFrom(s, col, i)) return i;
    }
  }
  return -1;
}
export function seekWarmthJob(s, col) {
  const i = nearestWarm(s, col);
  if (i < 0) return null;
  return makeJob('seekWarmth', i, [T.goto(i), { t: 'warm', n: 2 * TICKS_PER_HOUR }], { need: true });
}
registerToil('warm', (s, col, job, toil) => {
  if (++job.work < toil.n && col.need[NEED.warmth] < PEOPLE.warmth.seekTo * FIX) return RUN;
  addThought(s, col, 'warmed_up');
  return NEXT;
});

// ---- The hooks ------------------------------------------------------------------------------------------------
const U = (id) => ((N_().urgent || {})[id] | 0);
export function forcedHook(s, col) {
  if (col.hp.dead || col.hp.down) return HOLD;
  if (col.breakState) return breakJob(s, col);
  if (needActive('rest') && col.need[NEED.rest] === 0) return sleepJob(s, col, { collapse: true });
  return null;
}
export function urgentHook(s, col) {
  if (needActive('food') && below(col, 'food', U('food'))) { const j = eatJob(s, col); if (j) return j; }
  if (needActive('rest') && below(col, 'rest', U('rest'))) return sleepJob(s, col);
  if (needActive('light') && below(col, 'light', U('light')) && s.rt.light && s.rt.light[colTile(col)] < 2) { const j = seekLightJob(s, col); if (j) return j; }
  if (bleeding(col)) { const j = bedrestJob(s, col); if (j) return j; }
  // Stage 2: the tainted, the infected and the badly ill rest in bed too (taint falls only in bed,
  // infection is held back by bed rest; X 2.7: before this nothing sent them, and the Grey Taint
  // turned most colonists hit by a horde)
  // Not for a plain untended cut: a walking colonist with a scratch keeps working (and rescuing) and
  // is tended where they stand; X 2.7 soak: sending every scratched survivor to bed after a beast
  // fight left the downed to bleed out with nobody up to carry them.
  if (stage2() && needsBed(col) && !col.drafted) { const j = bedrestJob(s, col); if (j) return j; }
  if (needActive('warmth') && below(col, 'warmth', PEOPLE.warmth.seekBelow) && tempAt(s, colTile(col)) < PEOPLE.warmth.seekTemp) { const j = seekWarmthJob(s, col); if (j) return j; }
  return null;
}
export function scheduleHook(s, col) {
  if (needActive('rest') && sleepHour(s, col) && below(col, 'rest', (N_().schedule || {}).rest || 90)) return sleepJob(s, col);
  if (stage2() && s.colony.ember && s.colony.ember.colId === col.id && col.sched[hourOf(s.tick)] !== SCHED.JOY) { const j = emberJob(s, col); if (j) return j; }
  if (needActive('joy') && wantsJoy(s, col)) { const j = joyJob(s, col); if (j) return j; }
  return null;
}
export function fallbackHook(s, col) {
  const fb = N_().fallback || 60;
  if (needActive('food') && below(col, 'food', fb)) { const j = eatJob(s, col); if (j) return j; }
  if (needActive('joy') && lowJoy(col)) { const j = joyJob(s, col); if (j) return j; }
  if (needActive('light') && below(col, 'light', fb) && s.rt.light && s.rt.light[colTile(col)] === 0) { const j = seekLightJob(s, col); if (j) return j; }
  return null;
}
/** Stop work when an urgent need has a job waiting (never cuts need or break jobs short). */
export function interruptHook(s, col) {
  if (col.breakState || col.hp.down || isNeedJob(col.job)) return false;
  if (col.job && col.job.type === 'order') return false;
  return !!urgentHook(s, col);
}

/** Register (on) or clear (off) the think hooks. */
export function installNeedJobs(on = true) {
  if (!on) { clearThinkHooks(); return; }
  setThinkHooks({ forced: forcedHook, urgent: urgentHook, schedule: scheduleHook, fallback: fallbackHook, interrupt: interruptHook });
}
