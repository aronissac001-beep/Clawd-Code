// The Care work giver (doc 4.6, 5.1; owner E; Stage 1b: rescue only). Targets: downed colonists
// who are not in a bed (and not already being carried). The rescuer walks next to the patient,
// lifts them, carries them to a bed (the patient's own, else a free unowned one, F's bedFor), lays
// them down and the patient starts F's bed rest (needjobs.startBedrest), with "Carried to safety".
// Claims: the patient (keyCol, exclusive) and the bed (keyBld) for the whole job; the bed claim
// passes to the patient's bed rest when they are laid down. While carried, the patient's position
// follows the rescuer every tick (the movement slot runs after the jobs slot, so it lags a tick).
// A rescue ended early (interrupted, drafted, the rescuer downed) leaves the patient where they are.
// Stage 2 (full Care, 5.1): tend, talk down, feed patients and the apothecary's bills:
//   TEND_GIVER   a patient who needs a doctor (F's needsTending) and lies in bed or is downed. The
//                doctor fetches the best-tending medicine within reach (F's medPct: salve > poultice >
//                bandage > herbs; none at all is allowed, at lower quality), walks beside the patient,
//                works TEND_MIN game minutes (Medicine) and F's tend() applies it (1 unit used).
//   TALK_GIVER   a colonist in a break: a talker with Social 8+ walks over and tries F's talkDown();
//                a failed try puts the breaker in the talker's unreachable memory for 600 ticks.
//   FEED_GIVER   a bedridden patient (downed, or in bed rest) whose Food is below FEED_BELOW: a meal
//                (or raw food) carried to the bed; F's satisfy() feeds it.
//   CARE_BENCH   bills at Care workbenches (the apothecary), from the bench-giver factory.
// Surgery and prisoners wait for H's captives (Stage 3).

import { idx, tx, ty, tz, ctrW, cheb } from '../../core/grid.js';
import { colById, bldById } from '../../core/state.js';
import { FIX } from '../../core/schema.js';
import { TICKS_PER_MIN, TICKS_PER_DAY } from '../../core/time.js';
import { RUN, NEXT, END, T, makeJob, registerToil, keyCol, keyBld, keyItem, myClaim, getMover, workHooks, markUnreachable } from '../jobs.js';
import { colTile, release } from '../reserve.js';
import { openTarget, distTo, reachableFrom } from '../windex.js';
import { candidates as itemCandidates, carried, freeCount } from '../items.js';
import { def } from '../../core/content.js';
import { benchGiver } from './craft.js';
import { bedFor, startBedrest } from '../../people/needjobs.js';
import { inBed, needsTending, tend, medPct, bleedRate } from '../../people/health.js';
import { addThought } from '../../people/mood.js';
import { talkDown } from '../../people/breaks.js';
import { satisfy } from '../../people/needs.js';
import { level } from '../../people/skills.js';

/** Downed, alive, not lying in bed rest. */
export const needsRescue = (c) => !!c && !c.hp.dead && !!c.hp.down && !inBed(c) && !c.job;

const target = (s, col, p) => {
  if (p === col || !needsRescue(p) || !openTarget(s, col, keyCol(p.id))) return null;
  const pi = colTile(p);
  if (!reachableFrom(s, col, pi)) return null;
  return { key: keyCol(p.id), id: p.id, d: distTo(s, col, pi), plan: null };
};

function rescueJob(s, col, p) {
  const bed = bedFor(s, p, colTile(p));
  if (!bed || !reachableFrom(s, col, idx(bed.x, bed.y, bed.z | 0))) return null;
  const pi = colTile(p);
  const toils = [T.goto(pi, true), { t: 'lift', c: p.id }, { t: 'carryCol', c: p.id, i: idx(bed.x, bed.y, bed.z | 0) }, { t: 'layDown', c: p.id, b: bed.id }];
  return { job: makeJob('rescue', keyCol(p.id), toils), claims: [[keyCol(p.id), 0], [keyBld(bed.id), 0]] };
}

export const CARE_GIVER = Object.freeze({
  id: 'care', work: 'care', order: 0,
  candidates(s, col, k) {
    const out = [];
    for (const p of s.col) { const t = target(s, col, p); if (t && t.d !== Infinity) out.push(t); }
    out.sort((a, b) => a.d - b.d || a.key - b.key);
    return out.slice(0, k);
  },
  valid(s, col, t) {
    const p = colById(s, t.id);
    if (!target(s, col, p)) return false;
    t.plan = rescueJob(s, col, p);
    return !!t.plan;
  },
  make(s, col, t) { return t.plan; },
  keyOf: (t) => t.key,
  fromTarget(s, col, tg) { if (!tg || tg.kind !== 'col') return null; return target(s, col, colById(s, tg.id)); },
});

const follow = (p, col) => { p.x = col.x; p.y = col.y; };
const stillOurs = (s, col, id) => myClaim(s, keyCol(id), col.id) >= 0;

registerToil('lift', (s, col, job, toil) => {
  const p = colById(s, toil.c);
  if (!p || !p.hp.down || p.hp.dead || p.job || !stillOurs(s, col, toil.c)) return END.TARGET_GONE;
  const a = colTile(col), b = colTile(p);
  if (tz(a) !== tz(b) || cheb(tx(a), ty(a), tx(b), ty(b)) > 1) return 'notThere';
  follow(p, col);
  return NEXT;
});
registerToil('carryCol', (s, col, job, toil) => {
  const p = colById(s, toil.c);
  if (!p || p.hp.dead || !stillOurs(s, col, toil.c)) return END.TARGET_GONE;
  follow(p, col);
  if (colTile(col) === toil.i) { const m = getMover(); if (m && col.path) m.stop(s, col); return NEXT; }
  const m = getMover();
  if (!m) return 'noMover';
  const st = m.status(s, col, toil.i, false);
  if (st === 'pending' || st === 'moving') return RUN;
  if (st === 'failed') return END.UNREACHABLE;
  const ts = job.ts || (job.ts = { r: 0 });
  if (ts.r >= 3) return 'stuck';
  ts.r++;
  return m.request(s, col, toil.i, false) ? RUN : END.UNREACHABLE;
});
registerToil('layDown', (s, col, job, toil) => {
  const p = colById(s, toil.c), b = bldById(s, toil.b);
  if (!p || p.hp.dead || !b || b.st !== 'done' || myClaim(s, keyBld(b.id), col.id) < 0) return END.TARGET_GONE;
  p.x = ctrW(b.x); p.y = ctrW(b.y);
  release(s, col, keyBld(b.id));
  if (!p.job && startBedrest(s, p, b)) addThought(s, p, 'rescued');
  return NEXT;
});

// ---- Stage 2: tend, talk down, feed, the apothecary ---------------------------------------------------
export const TEND_MIN = 15, TALK_MIN = 6, FEED_BELOW = 35, TALK_SOCIAL = 8;
const bedridden = (p) => !!p && !p.hp.dead && (!!p.hp.down || inBed(p));
const nearCol = (col, p) => { const a = colTile(col), b = colTile(p); return tz(a) === tz(b) && cheb(tx(a), ty(a), tx(b), ty(b)) <= 1; };
/** The candidate list shared by the patient givers: colonists passing `want`, nearest first. */
function patients(s, col, k, want) {
  const out = [];
  for (const p of s.col) {
    if (p === col || !want(s, col, p) || !openTarget(s, col, keyCol(p.id))) continue;
    const pi = colTile(p);
    if (!reachableFrom(s, col, pi)) continue;
    const d = distTo(s, col, pi);
    if (d !== Infinity) out.push({ key: keyCol(p.id), id: p.id, d });
  }
  out.sort((a, b) => a.d - b.d || a.key - b.key);
  return out.slice(0, k);
}
/** Medicine to fetch: the stack with the best tending value within reach (ties: nearest, then id). */
function bestMedicine(s, col) {
  const from = colTile(col);
  let best = null, bv = -1, bd = Infinity;
  for (const f of [{ cat: 'medicine' }, { cat: 'herbs' }]) {
    for (const it of itemCandidates(s, { ...f, holder: col.id, minN: 1 }, from, (i) => reachableFrom(s, col, i), 6)) {
      const v = medPct(it.k), d = distTo(s, col, idx(it.x, it.y, it.z | 0));
      if (v > bv || (v === bv && d < bd)) { bv = v; bd = d; best = it; }
    }
  }
  return best;
}
const wantsTend = (s, col, p) => bedridden(p) && needsTending(p) && (!p.job || p.job.type === 'bedrest');
function tendJob(s, col, p) {
  const med = bestMedicine(s, col);
  const toils = [], claims = [[keyCol(p.id), 0]];
  if (med) { toils.push(T.goto(idx(med.x, med.y, med.z | 0)), T.pickup(med.id, 1)); claims.push([keyItem(med.id), 1]); }
  toils.push(T.goto(colTile(p), true), { t: 'tend', c: p.id, n: TEND_MIN * TICKS_PER_MIN, sk: 'medicine' });
  return { job: makeJob('tend', keyCol(p.id), toils), claims };
}
export const TEND_GIVER = Object.freeze({
  id: 'tend', work: 'care', order: 1,
  candidates(s, col, k) { return patients(s, col, k, wantsTend); },
  valid(s, col, t) { const p = colById(s, t.id); return !!p && wantsTend(s, col, p); },
  make(s, col, t) { return tendJob(s, col, colById(s, t.id)); },
  keyOf: (t) => t.key,
  fromTarget(s, col, tg) { if (!tg || tg.kind !== 'col') return null; const p = colById(s, tg.id); return p && wantsTend(s, col, p) ? { key: keyCol(p.id), id: p.id, d: distTo(s, col, colTile(p)) } : null; },
});
/** Emergencies for anyone (think.js asks every able, undrafted colonist before the work loop, Stage 2):
 * a downed colonist lying out of bed (doc 4.6: "rescued to a bed by the nearest Doctor or any
 * colonist") and a bedridden patient still bleeding, tended at the helper's own Medicine (a poor
 * tend risks infection later, but stops the bleeding now). X 2.7 balance: with the only doctor
 * hurt or busy, the downed bled out beside able colonists (21 of 98 bot deaths were blood loss). */
const anyDown = (s) => s.col.some((p) => !p.hp.dead && p.hp.down);
export const URGENT_RESCUE_GIVER = Object.freeze({
  ...CARE_GIVER, id: 'urgentRescue',
  candidates(s, col, k) { return anyDown(s) ? CARE_GIVER.candidates(s, col, k) : []; },
});
// (and a festering wound, infection 40+, untended for half a day: X 2.7 soak, four colonists hurt in
// one raid died of infection together while the one doctor was busy)
const festering = (s, p) => p.hp.wounds.some((w) => (w.infected | 0) >= 40 && s.tick - (w.lt | 0) > TICKS_PER_DAY / 2);
const urgentPatient = (s, p) => !p.hp.dead && (bleedRate(p) > 0 || festering(s, p));
const wantsUrgentTend = (s, col, p) => urgentPatient(s, p) && wantsTend(s, col, p);
export const URGENT_TEND_GIVER = Object.freeze({
  ...TEND_GIVER, id: 'urgentTend',
  candidates(s, col, k) { return s.col.some((p) => urgentPatient(s, p)) ? patients(s, col, k, wantsUrgentTend) : []; },
  valid(s, col, t) { const p = colById(s, t.id); return !!p && wantsUrgentTend(s, col, p); },
  fromTarget: () => null,
});
registerToil('tend', (s, col, job, toil) => {
  const p = colById(s, toil.c);
  if (!p || p.hp.dead || myClaim(s, keyCol(p.id), col.id) < 0) return END.TARGET_GONE;
  if (!nearCol(col, p)) return 'notThere';
  const h = workHooks();
  const sp = h.speed(s, col, toil) | 0;
  if (sp > 0) job.work += sp;
  if (h.xp) h.xp(s, col, 'medicine', 1);
  if (job.work < toil.n * 100) return RUN;
  const c = carried(col);
  const med = c && def('item', c.k) ? c.k : null;
  if (c) { c.n -= 1; if (c.n <= 0) job.carry = null; }
  tend(s, col, p, med);
  return NEXT;
});

const wantsTalk = (s, col, p) => !!p.breakState && !p.hp.dead && level(col, 'social') >= TALK_SOCIAL;
export const TALK_GIVER = Object.freeze({
  id: 'talkdown', work: 'care', order: 2,
  candidates(s, col, k) { return patients(s, col, k, wantsTalk); },
  valid(s, col, t) { const p = colById(s, t.id); return !!p && wantsTalk(s, col, p); },
  make(s, col, t) {
    const p = colById(s, t.id);
    return { job: makeJob('talkdown', keyCol(p.id), [T.goto(colTile(p), true), { t: 'talk', c: p.id, n: TALK_MIN * TICKS_PER_MIN }]), claims: [[keyCol(p.id), 0]] };
  },
  keyOf: (t) => t.key,
});
registerToil('talk', (s, col, job, toil) => {
  const p = colById(s, toil.c);
  if (!p || !p.breakState) return NEXT;
  if (!nearCol(col, p)) { if (++job.work > 600) return 'lost'; const m = getMover(); if (m && m.status(s, col, colTile(p), true) === 'none') m.request(s, col, colTile(p), true); return RUN; }
  job.work += 100;
  if (h_xp()) h_xp()(s, col, 'social', 1);
  if (job.work < toil.n * 100) return RUN;
  if (!talkDown(s, col, p)) markUnreachable(s, col, keyCol(p.id));
  return NEXT;
});
const h_xp = () => workHooks().xp;

const nutr = (k) => { const d = def('item', k); return d && d.food ? d.food.nutr | 0 : 0; };
const wantsFood = (s, col, p) => bedridden(p) && p.need[0] < FEED_BELOW * FIX;
function feedJob(s, col, p) {
  const from = colTile(col);
  let it = null;
  for (const f of [{ cat: 'meals' }, { cat: 'preserved' }, { cat: 'rawfood' }]) {
    const c = itemCandidates(s, { ...f, holder: col.id, minN: 1 }, from, (i) => reachableFrom(s, col, i), 1);
    if (c.length) { it = c[0]; break; }
  }
  if (!it || nutr(it.k) <= 0) return null;
  const n = Math.max(1, Math.min(freeCount(s, it.id, col.id), Math.ceil(((80 * FIX) - p.need[0]) / (nutr(it.k) * FIX))));
  const toils = [T.goto(idx(it.x, it.y, it.z | 0)), T.pickup(it.id, n), T.goto(colTile(p), true), { t: 'feed', c: p.id }];
  return { job: makeJob('feed', keyCol(p.id), toils), claims: [[keyCol(p.id), 0], [keyItem(it.id), n]] };
}
export const FEED_GIVER = Object.freeze({
  id: 'feed', work: 'care', order: 3,
  candidates(s, col, k) { return patients(s, col, k, wantsFood); },
  valid(s, col, t) { const p = colById(s, t.id); if (!p || !wantsFood(s, col, p)) return false; t.plan = feedJob(s, col, p); return !!t.plan; },
  make(s, col, t) { return t.plan; },
  keyOf: (t) => t.key,
});
registerToil('feed', (s, col, job, toil) => {
  const p = colById(s, toil.c), c = carried(col);
  if (!p || p.hp.dead || !c) return NEXT;
  if (!nearCol(col, p)) return 'notThere';
  satisfy(p, 'food', nutr(c.k) * FIX * c.n);
  job.carry = null;
  return NEXT;
});

/** Bills at Care workbenches (the apothecary): poultices, salves, draughts, candles. */
export const CARE_BENCH_GIVER = benchGiver('care', 'carebench');
/** Every Care giver, in their order. */
export const CARE_GIVERS = Object.freeze([CARE_GIVER, TEND_GIVER, TALK_GIVER, FEED_GIVER]);

export const GIVER = CARE_GIVER;
