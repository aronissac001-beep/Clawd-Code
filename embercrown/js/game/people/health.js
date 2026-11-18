// Health: body parts, wounds, blood, downed and death (doc 4.6, 4.8). Owner F. Provisional API.
//
// col.hp (C2 json) = { parts: [6 part HP, PART_IDS order], blood (x FIX), wounds: [Wound], taint
// (0..100 x FIX), illness: null | { id, sev }, down?: bool, dead?: bool }.
// Wound = { part, kind, dmg, bleed (blood x FIX lost per hour), tended (0-100), infected (0-100), age (ticks) }.
// Damage goes through damage(); death through kill(), which ends the job (E's endJob, reason
// 'death'), runs BUS.kill and emits `died`. The corpse item, Chronicle line and grave come from
// the subscribers (E items, K chronicle) through BUS.kill, so this file imports neither.
// Stage 1b ("simple health", no Medicine yet): bleeding, downed, death; wounds clot by themselves
// after HEALTH.clotH hours; an hour in bed tends them (quality bedTendPct); in bed every part heals
// 1 HP per healH hours (the matching wound shrinks with it); blood returns while nothing bleeds;
// starving (food 0, with needs on) bleeds blood away (death cause 'starvation'). Downed colonists
// are carried to a bed by the Care giver's Rescue job (work/givers/care.js) and rest there
// (needjobs.js bedrest). hp.bedT counts ticks in bed (json, saved). Infection and taint: Stage 2.

import { PART_IDS, PART_HP, FIX } from '../core/schema.js';
import { TICKS_PER_HOUR, TICKS_PER_DAY } from '../core/time.js';
import { BUS, each } from '../core/bus.js';
import { emit } from '../core/events.js';
import { END } from '../work/jobs.js';
import { endJob } from '../work/reserve.js';
import { traitPct, bal } from './defs.js';
import { addThought } from './mood.js';

export const PART = Object.freeze(Object.fromEntries(PART_IDS.map((p, i) => [p, i])));
export const WOUND_KINDS = Object.freeze(['cut', 'stab', 'blunt', 'burn', 'bite', 'frost', 'taint']);
/**
 * Provisional health tuning (4.6). Moves to balance.js section HEALTH (owner G) with the 1b data;
 * read through HEALTH so callers do not change.
 */
export const HEALTH = {
  bleedPerDmg: { cut: 30, stab: 40, blunt: 5, burn: 0, bite: 30, frost: 0, taint: 10 }, // blood x FIX per hour per dmg point
  downBlood: 40 * FIX, downPain: 80, every: 20,
  clotH: 8, bedTendH: 1, bedTendPct: 30, healH: 4, bloodPerDay: 60 * FIX, starveBloodPerDay: 50 * FIX,
};
export function setHealthBalance(patch) { Object.assign(HEALTH, patch || {}); }
/** Read balance.js HEALTH (G) into HEALTH (blood figures x FIX). installPeople calls it. */
export function loadHealthBalance() {
  const b = bal('health');
  if (!b || !Object.keys(b).length) return;
  const p = {};
  for (const k of ['every', 'downPain', 'clotH', 'bedTendH', 'bedTendPct', 'healH']) if (Number.isInteger(b[k])) p[k] = b[k];
  if (b.bleedPerDmg) p.bleedPerDmg = { ...b.bleedPerDmg };
  for (const k of ['downBlood', 'bloodPerDay', 'starveBloodPerDay']) if (Number.isInteger(b[k])) p[k] = b[k] * FIX;
  setHealthBalance(p);
}
let simpleHealth = false;
/** Stage 1b health rules on (clotting, bed rest, healing, starvation). */
export function setSimpleHealth(on) { simpleHealth = !!on; }
/** Is the colonist lying in a bed (a bedrest job, or asleep in a bed)? */
export function inBed(col) {
  const j = col.job;
  if (!j || (j.type !== 'bedrest' && j.type !== 'sleep') || !(j.bed >= 0)) return false;
  const t = j.toils[j.i];
  return !!t && (t.t === 'bedrest' || t.t === 'sleep');
}
/** Needs care: downed, or a wound still bleeding or untended. */
export const hurt = (col) => !!col.hp.down || col.hp.wounds.some((w) => w.tended === 0);

const lethalPart = (pi) => pi === PART.head || pi === PART.torso;
export const isDown = (col) => !!col.hp.down;
export const isDead = (col) => !!col.hp.dead;
export const able = (col) => !col.hp.down && !col.hp.dead && !col.breakState;
/** Pain = untended damage points (4.6). */
export function pain(col) { let p = 0; for (const w of col.hp.wounds) if (w.tended === 0) p += w.dmg; return p; }
/** Blood lost per hour (x FIX) from untended wounds. */
export function bleedRate(col) { let b = 0; for (const w of col.hp.wounds) if (w.tended === 0) b += w.bleed; return b; }

/**
 * Damage a colonist's part (combat, traps, cave-ins, fire). The 'dmg.taken' trait modifier applies
 * (Tough, Delicate). Emits `wounded`, then `downed` or `died` as it happens.
 * @returns {{ dmg: number, down: boolean, dead: boolean }}
 */
export function damage(s, col, part, kind, dmg, killer = null) {
  if (col.hp.dead) return { dmg: 0, down: false, dead: true };
  const pi = typeof part === 'number' ? part : PART[part];
  const d = Math.max(1, Math.floor((dmg * traitPct(col, 'dmg.taken')) / 100));
  const hp = col.hp;
  hp.parts[pi] = Math.max(0, hp.parts[pi] - d);
  hp.wounds.push({ part: pi, kind, dmg: d, bleed: (HEALTH.bleedPerDmg[kind] || 0) * d, tended: 0, infected: 0, age: 0 });
  emit(s, 'wounded', { id: col.id, part: PART_IDS[pi], kind, dmg: d });
  if (hp.parts[pi] === 0 && lethalPart(pi)) { kill(s, col, kind, killer); return { dmg: d, down: false, dead: true }; }
  const down = checkDowned(s, col);
  return { dmg: d, down, dead: false };
}

/** Set col.hp.down from blood and pain; emits `downed` on the change. */
export function checkDowned(s, col) {
  const hp = col.hp;
  const now = hp.blood < HEALTH.downBlood || pain(col) > HEALTH.downPain;
  if (now && !hp.down) {
    hp.down = true;
    // a downed colonist already resting in a bed stays there
    if (col.job && col.job.type !== 'bedrest') endJob(s, col, END.DOWNED);
    col.drafted = false;
    addThought(s, col, 'was_downed');
    emit(s, 'downed', { id: col.id });
  } else if (!now && hp.down) hp.down = false;
  return hp.down;
}

/** Death (4.8): end the job, run BUS.kill, emit `died`. The colonist stays in s.col marked dead
 *  until the corpse subscriber (E / K) replaces it; sim systems skip dead colonists. */
export function kill(s, col, cause = 'unknown', killer = null) {
  if (col.hp.dead) return;
  col.hp.dead = true; col.hp.down = false; col.drafted = false;
  if (col.job) endJob(s, col, END.DEATH);
  each(BUS.kill, s, col, killer);
  emit(s, 'died', { id: col.id, cause, killer: killer && killer.id !== undefined ? killer.id : killer });
}

/** Tick system (slot 'health'): every HEALTH.every ticks per colonist (staggered by id). */
export function healthSystem(s) {
  const every = HEALTH.every, slot = s.tick % every, t1 = s.tick, t0 = Math.max(0, t1 - every);
  const per = (rate) => Math.floor((rate * t1) / TICKS_PER_HOUR) - Math.floor((rate * t0) / TICKS_PER_HOUR);
  const perDay = (rate) => Math.floor((rate * t1) / TICKS_PER_DAY) - Math.floor((rate * t0) / TICKS_PER_DAY);
  for (const col of s.col) {
    if (col.id % every !== slot || col.hp.dead) continue;
    const hp = col.hp;
    for (const w of hp.wounds) {
      w.age += every;
      if (simpleHealth && w.bleed && w.age >= HEALTH.clotH * TICKS_PER_HOUR) w.bleed = 0;
    }
    const rate = bleedRate(col);
    if (rate) {
      hp.blood = Math.max(0, hp.blood - per(rate));
      if (hp.blood === 0) { kill(s, col, 'bleeding', null); continue; }
    }
    if (simpleHealth) {
      // starving: food at 0 bleeds blood away
      if (col.need[0] === 0) {
        hp.blood = Math.max(0, hp.blood - perDay(HEALTH.starveBloodPerDay));
        if (hp.blood === 0) { kill(s, col, 'starvation', null); continue; }
      } else if (!rate && hp.blood < 100 * FIX) hp.blood = Math.min(100 * FIX, hp.blood + perDay(HEALTH.bloodPerDay));
      if (inBed(col)) {
        const bt0 = hp.bedT | 0;
        hp.bedT = bt0 + every;
        // an hour of bed rest tends every untended wound
        if (hp.bedT >= HEALTH.bedTendH * TICKS_PER_HOUR) for (const w of hp.wounds) if (w.tended === 0) { w.tended = HEALTH.bedTendPct; w.bleed = 0; }
        const step = HEALTH.healH * TICKS_PER_HOUR;
        if (Math.floor(hp.bedT / step) > Math.floor(bt0 / step)) healStep(col);
      } else if (hp.bedT) hp.bedT = 0;
    }
    checkDowned(s, col);
  }
}
/** One healing step: every damaged part +1 HP, its oldest wound 1 point smaller (healed wounds go). */
export function healStep(col) {
  const hp = col.hp;
  for (let pi = 0; pi < hp.parts.length; pi++) {
    if (hp.parts[pi] >= PART_HP[pi] || hp.parts[pi] === 0) continue;   // destroyed parts do not grow back
    hp.parts[pi]++;
    const w = hp.wounds.find((x) => x.part === pi);
    if (w) w.dmg--;
  }
  hp.wounds = hp.wounds.filter((w) => w.dmg > 0);
}

/** Full health (tests, debug, new arrivals). */
export function healAll(col) { col.hp = { parts: PART_HP.slice(), blood: 100 * FIX, wounds: [], taint: 0, illness: null }; }
