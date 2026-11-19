// Needs (doc 4.4). Owner F. Off in Stage 1a (colonists do not eat, sleep or mope); from Stage 1b
// installPeople({ needs: true }) runs Food, Rest and Light (dread); Joy and Warmth join in Stage 2
// (each need def's `stage`, js/data/needs.js).
//
// col.need = [food, rest, joy, warmth, light] in NEED_IDS order, fixed point 0..100 x FIX (C2).
// Each colonist updates every NEEDS.every ticks, when tick % every == id % every (12.3).
// Falls are exact integers over a day: the drop between ticks t0 and t1 is
//   floor(rate x t1 / DAY) - floor(rate x t0 / DAY), rate = fallPerDay x FIX x traits / 100,
// so a day always removes exactly `rate`, whatever the cadence (1x and 5x identical).
//   Food falls always (Glutton: 'need.food' trait modifier). Rest falls while awake; sleep restores
//   it in the sleep toil (needjobs.js). Light ("dread", high is good) falls at fallPerDay in darkness
//   (rt.light 0; Dark-sighted colonists are spared), at NEEDS.light.dimPct of that in dim light, and
//   rises at NEEDS.light.litPerDay on lit tiles (level >= 2); within NEEDS.light.hollowR tiles of a
//   hostile it falls an extra hollowPerDay. A sleeper's light need does not change.
// Starvation (food 0) is health's (health.js: blood loss), and the thoughts are mood's.
// Stage 2: Joy falls always (joy.js restores it); Warmth falls only below PEOPLE.warmth.below C at the
// colonist's tile (B's tempAt: rooms, heat, weather), by perDegree a day for each degree under it,
// times the 'cold.rate' modifier (Emberkin x1.5) and less apparel insulation (wear.insul, 3% a point,
// at most 80%); at or above it Warmth returns warmPerDay. The bar hides while the tile is warm.

import { NEED_IDS, FIX } from '../core/schema.js';
import { TICKS_PER_DAY } from '../core/time.js';
import { TILE } from '../core/grid.js';
import { curToil } from '../work/jobs.js';
import { colTile } from '../work/reserve.js';
import { bal, def, all, inStage, traitPct, traitFlag, PEOPLE } from './defs.js';
import { tempAt } from '../world/terrain.js';

export const NEED = Object.freeze(Object.fromEntries(NEED_IDS.map((n, i) => [n, i])));
export const NEED_MAX = 100 * FIX;
/** Needs whose fall the needs system runs at the people stage (data order = NEED_IDS order). */
export function activeNeeds() {
  const out = [];
  for (const d of all('need')) if (inStage(d)) out.push(d.id);
  return out;
}
export const needActive = (id) => activeNeeds().includes(id);

/** Fall per day (x FIX) of a need for a colonist, after the 'need.<id>' trait modifier (Glutton). */
export function fallPerDay(col, needId) {
  const d = def('need', needId);
  const base = d ? d.fallPerDay : (bal('needs').fallPerDay || {})[needId] || 0;
  return Math.floor((base * FIX * traitPct(col, 'need.' + needId)) / 100);
}
/** Exact integer fall between ticks t0 < t1. */
export const fallBetween = (rate, t0, t1) => Math.floor((rate * t1) / TICKS_PER_DAY) - Math.floor((rate * t0) / TICKS_PER_DAY);

/** Need value (x FIX). */
export const needOf = (col, needId) => col.need[NEED[needId]];
/** True when a need is below its urgent threshold (think puts it before work, 5.3). */
export function urgent(col, needId) {
  const u = bal('needs').urgent || {};
  return needId in u && col.need[NEED[needId]] < u[needId] * FIX;
}
/** Add (or remove, with a negative amount) to a need, clamped to 0..100 x FIX. */
export function satisfy(col, needId, amount) {
  const i = NEED[needId];
  const v = col.need[i] + amount;
  col.need[i] = v < 0 ? 0 : v > NEED_MAX ? NEED_MAX : v;
  return col.need[i];
}

/** Is the colonist asleep (in the sleep toil of a sleep job, needjobs.js)? Sleepers do not tire. */
export function asleep(col) {
  const j = col.job;
  if (!j || j.type !== 'sleep') return false;
  const t = curToil(j);
  return !!t && t.t === 'sleep';
}

/** Is the colonist lying in bed rest (the bedrest toil)? Patients doze: their dread does not grow and
 * Joy falls at a third of the rate (X 2.7: a tainted patient in a dark dorm fell into Terror and a break). */
export function inBedrest(col) {
  const j = col.job;
  if (!j || j.type !== 'bedrest') return false;
  const t = curToil(j);
  return !!t && t.t === 'bedrest';
}

/** A hostile within r tiles of the colonist? (s.foes in id order; few on the map.) */
export function hostileNear(s, col, r) {
  const R = r * TILE, R2 = R * R;
  for (const f of s.foes) {
    if (!f || (f.hp && f.hp.hp <= 0)) continue;
    const dx = f.x - col.x, dy = f.y - col.y;
    if (dx * dx + dy * dy <= R2) return true;
  }
  return false;
}

/**
 * Light-need rate for the colonist now: x FIX per day, negative when it falls.
 * @returns {number}
 */
export function lightRate(s, col) {
  const L = bal('needs').light || {};
  const lvl = s.rt.light ? s.rt.light[colTile(col)] : 3;
  let rate;
  if (lvl >= 2) rate = (L.litPerDay || 600) * FIX;
  else {
    const dark = fallPerDay(col, 'light');
    rate = traitFlag(col, 'work.dark') ? 0 : -(lvl === 1 ? Math.floor((dark * (L.dimPct || 40)) / 100) : dark);
  }
  if (s.foes.length && hostileNear(s, col, L.hollowR || 8)) rate -= (L.hollowPerDay || 0) * FIX;
  return rate;
}

/** Apparel insulation points (sum of wear.insul of the items in col.gear.slots). */
export function insulation(col) {
  const g = col.gear && col.gear.slots;
  if (!g) return 0;
  let n = 0;
  for (const k of Object.keys(g).sort()) { const it = g[k]; const d = it && it.k ? def('item', it.k) : null; if (d && d.wear && d.wear.insul) n += d.wear.insul | 0; }
  return n;
}
/** Warmth rate for the colonist now: x FIX per day, negative when it falls (Stage 2). */
export function warmthRate(s, col) {
  const Wm = PEOPLE.warmth, t = tempAt(s, colTile(col));
  if (t >= Wm.below) return Wm.warmPerDay * FIX;
  const cut = Math.min(Wm.maxInsulPct, insulation(col) * Wm.insulPct);
  const fall = Math.floor((((Wm.below - t) * Wm.perDegree * FIX * traitPct(col, 'cold.rate')) / 100) * (100 - cut) / 100);
  return -fall;
}
/** Is the warmth bar relevant (the colonist's tile is below the warm line, or warmth is not full)? */
export const warmthShown = (s, col) => tempAt(s, colTile(col)) < PEOPLE.warmth.below || col.need[NEED.warmth] < NEED_MAX;

/** Tick system (slot 'needs'). */
export function needsSystem(s) {
  const every = bal('needs').every || 20;
  const t1 = s.tick, t0 = Math.max(0, t1 - every), slot = t1 % every;
  const act = activeNeeds();
  for (const col of s.col) {
    if (col.id % every !== slot || col.hp.dead) continue;
    const sleeping = asleep(col), resting = !sleeping && inBedrest(col);
    for (const id of act) {
      if (id === 'light') {
        if (sleeping || resting) continue;
        const r = lightRate(s, col);
        const d = r >= 0 ? fallBetween(r, t0, t1) : -fallBetween(-r, t0, t1);
        if (d) satisfy(col, 'light', d);
        continue;
      }
      if (id === 'warmth') {
        const r = warmthRate(s, col);
        const d = r >= 0 ? fallBetween(r, t0, t1) : -fallBetween(-r, t0, t1);
        if (d) satisfy(col, 'warmth', d);
        continue;
      }
      if (id === 'rest' && sleeping) continue;
      const drop = fallBetween(resting && id === 'joy' ? Math.floor(fallPerDay(col, id) / 3) : fallPerDay(col, id), t0, t1);
      if (drop) satisfy(col, id, -drop);
    }
  }
}
