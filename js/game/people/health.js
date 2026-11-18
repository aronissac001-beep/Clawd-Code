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
// (needjobs.js bedrest). hp.bedT counts ticks in bed (json, saved).
// Stage 2 (people stage '2'; tuning js/data/needs.js PEOPLE.health):
//   Tending   tend(s, doctor, patient, med) (E's Care giver; also an hour of bed rest at 30%): quality =
//             Medicine speed% x medicine (none 50, bandage 75, poultice 100, salve 130) x infirmary
//             (+15 in an infirmary room) / 100, capped at 100; stops bleeding; w.lt = the tick.
//   Infection a cut, stab, bite or burn wound reaching infectH (12) hours rolls once: untended it
//             always infects; tended at quality q it infects when a hash of (colonist, wound, tick) %
//             100 < tendedSafePct - q. Infection grows infectPerDay a day unless the wound was tended
//             (or lain in bed) within tendDayH hours, when it falls tendedCurePerDay; at 100 it kills.
//   Grey Taint Hollow blows taint (taintChancePct, hashed): hp.taint rises taintPerDay a day (100 in
//             3 days) while they are up; in bed it falls taintBedPerDay, and within taintRestR of a
//             level-2+ Hearth taintRestPerDay (a tainted colonist goes to bed rest: hurt()).
//             At 100 the colonist turns (death.js: the Husk rises where they stood) unless Hollow-Touched
//             (once: the taint lets go).
//   Illness   hp.illness = { id, sev, imm } (x FIX): incidents call infect(s, col, id); severity and
//             immunity grow a day (bed rest slows severity); immunity 100 cures, severity 100 kills;
//             Grey Cough spreads to those who sleep in the same room (at midnight).
//   Cold      Warmth at 0: a frost wound every frostEveryH hours (hypothermia).
//   Healing   x2 in an infirmary; 'hp.heal' (Delicate +20%) shortens the heal step.
//   Unbroken  (Melee 20 perk) the first lethal blow of each raid leaves them at 1 HP.

import { PART_IDS, PART_HP, FIX } from '../core/schema.js';
import { W as W_, H as H_ } from '../core/grid.js';
import { TICKS_PER_HOUR, TICKS_PER_DAY } from '../core/time.js';
import { BUS, each } from '../core/bus.js';
import { emit } from '../core/events.js';
import { END } from '../work/jobs.js';
import { endJob } from '../work/reserve.js';
import { traitPct, traitFlag, bal, def, PEOPLE, stage2 } from './defs.js';
import { addThought } from './mood.js';
import { ensurePeople, getKey, putKey, hash3 } from './peoplerec.js';
import { roomInfoAt } from '../world/rooms.js';
import { isBurning } from '../world/fuel.js';
import { bldById } from '../core/state.js';
import { level, speedPct } from './skills.js';
import { hasGrant } from './perkrules.js';

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
/** Needs care: downed, a wound still bleeding or untended, or (Stage 2) an infection or a serious illness. */
export const hurt = (col) => !!col.hp.down || col.hp.wounds.some((w) => w.tended === 0 || (w.infected | 0) > 0)
  || (!!col.hp.illness && (col.hp.illness.sev | 0) >= 40 * FIX) || (col.hp.taint | 0) > 0;

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
/** Is the attacker one of the Hollow (raider kind 'hollow')? */
const hollowFoe = (k) => { if (!k || !k.kind || Array.isArray(k.sk)) return false; const d = def('raider', k.kind); return !!d && d.kind === 'hollow'; };
/** The id of the live raid the attacker belongs to (Unbroken counts per raid), or -1. */
const raidOf = (k) => (k && Number.isInteger(k.raid) ? k.raid : -1);

export function damage(s, col, part, kind, dmg, killer = null) {
  if (col.hp.dead) return { dmg: 0, down: false, dead: true };
  const pi = typeof part === 'number' ? part : PART[part];
  let pct = traitPct(col, 'dmg.taken');
  if (stage2() && hollowFoe(killer)) pct = Math.floor((pct * traitPct(col, 'dmg.hollow')) / 100);
  const d = Math.max(1, Math.floor((dmg * pct) / 100));
  const hp = col.hp;
  // Unbroken (Melee 20): the first lethal blow of a raid leaves the part at 1
  let take = d;
  if (stage2() && lethalPart(pi) && hp.parts[pi] - d <= 0 && hasGrant(col, 'unbroken')) {
    const rec = ensurePeople(s), r = raidOf(killer), used = getKey(rec.unbroken, col.id);
    if (!used || used[1] !== r) { putKey(rec.unbroken, [col.id, r]); take = Math.max(0, hp.parts[pi] - 1); }
  }
  hp.parts[pi] = Math.max(0, hp.parts[pi] - take);
  hp.wounds.push({ part: pi, kind, dmg: Math.max(1, take), bleed: (HEALTH.bleedPerDmg[kind] || 0) * Math.max(1, take), tended: 0, infected: 0, age: 0 });
  emit(s, 'wounded', { id: col.id, part: PART_IDS[pi], kind, dmg: d });
  // the Grey Taint rides on Hollow blows (hashed, no stream: combat rolls stay where they were)
  if (stage2() && hollowFoe(killer) && !(hp.taint > 0) && hash3(col.id, s.tick, pi + 17) % 100 < PEOPLE.health.taintChancePct) hp.taint = 1;
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
        let step = HEALTH.healH * TICKS_PER_HOUR;
        if (stage2()) {
          step = Math.floor((step * 100) / Math.max(50, traitPct(col, 'hp.heal')));
          const info = roomInfoAt(s, colTileOf(col));
          if (info && info.role === 'infirmary') step = Math.floor((step * 100) / PEOPLE.health.healInfirmaryPct);
          for (const w of hp.wounds) if (w.tended > 0 || w.infected > 0) w.lt = s.tick;
        }
        if (Math.floor(hp.bedT / step) > Math.floor(bt0 / step)) healStep(col);
      } else if (hp.bedT) hp.bedT = 0;
    }
    if (stage2()) { if (stage2Health(s, col, every, t0, t1)) continue; }
    checkDowned(s, col);
  }
  if (stage2() && s.tick % TICKS_PER_DAY === 0) contagion(s);
}

// ---- Stage 2: tending, infection, taint, illness, cold -----------------------------------------------------
const H2 = () => PEOPLE.health;
const INFECTS = new Set(['cut', 'stab', 'bite', 'burn']);
const MED_PCT = Object.freeze({ none: 50, bandage: 75, poultice: 100, salve: 130 });
/** Medicine percent of an item kind (its def's med field, else the table, else none). */
export function medPct(k) { if (!k) return MED_PCT.none; const d = def('item', k); return d && d.med ? d.med : MED_PCT[k] || MED_PCT.none; }
/** Tend quality 1-100 a doctor gives with medicine kind `med` (null: none) to a patient (where they lie). */
export function tendQuality(s, doctor, patient, med = null) {
  let q = Math.floor((speedPct(doctor ? level(doctor, 'medicine') : 0) * medPct(med)) / 100);
  const info = roomInfoAt(s, colTileOf(patient));
  if (info && info.role === 'infirmary') q += 15 + 2 * info.tierIdx;
  return Math.max(1, Math.min(100, q));
}
const colTileOf = (c) => Math.min(H_ - 1, Math.max(0, Math.floor(c.y / 32))) * W_ + Math.min(W_ - 1, Math.max(0, Math.floor(c.x / 32)));
/**
 * Tend a patient's wounds (E's Care giver, and bed rest). Untended wounds take the quality; infected
 * ones are re-tended (their lt refreshed). Fever Watch doctors stop an infection before it shows.
 * @returns {number} wounds tended
 */
export function tend(s, doctor, patient, med = null, quality = null) {
  const q = quality === null ? tendQuality(s, doctor, patient, med) : quality;
  let n = 0;
  for (const w of patient.hp.wounds) {
    if (w.tended === 0) { w.tended = q; w.bleed = 0; n++; }
    if (w.tended > 0 || w.infected > 0) { w.lt = s.tick; n += w.infected > 0 ? 1 : 0; }
    if (doctor && hasGrant(doctor, 'fever_watch') && !w.rolled) w.rolled = 1;
  }
  if (n && doctor && doctor !== patient) addThought(s, patient, 'tended');
  return n;
}
/** Does the patient need a doctor (an untended or infected wound, a bad illness, a Grey Taint)? */
export const needsTending = (col) => !col.hp.dead && (col.hp.wounds.some((w) => w.tended === 0 || (w.infected | 0) > 0) || (col.hp.taint | 0) > 0
  || (!!col.hp.illness && (col.hp.illness.sev | 0) >= 20 * FIX));

/** Start an illness (incidents: Grey Cough, Rot Fever; E's food poisoning). false when already ill or immune. */
export function infect(s, col, id) {
  const d = (PEOPLE.illness || []).find((x) => x.id === id);
  if (!d || col.hp.dead || col.hp.illness) return false;
  if (id === 'food_poisoning' && traitFlag(col, 'need.rawOk')) return false;
  col.hp.illness = { id, sev: 1, imm: 0 };
  return true;
}
const perDayOf = (rate, t0, t1) => Math.floor((rate * t1) / TICKS_PER_DAY) - Math.floor((rate * t0) / TICKS_PER_DAY);
/** Near a lit Hearth of level `lvl`+ within r tiles? */
function nearHearth(s, col, lvl, r) {
  const h = s.colony.hearth, hb = h && h.id !== null ? bldById(s, h.id) : null;
  if (!hb || (h.lvl | 0) < lvl || !isBurning(s, hb)) return false;
  const i = colTileOf(col);
  return Math.max(Math.abs((i % W_) - hb.x - 1), Math.abs(((i / W_) | 0) - hb.y - 1)) <= r;
}
/** One Stage 2 health step for a colonist (true when they died in it). */
function stage2Health(s, col, every, t0, t1) {
  const hp = col.hp, h = H2(), bed = inBed(col);
  // infection
  for (const w of hp.wounds) {
    if (!INFECTS.has(w.kind)) continue;
    if (!w.rolled && w.age >= h.infectH * TICKS_PER_HOUR) {
      w.rolled = 1;
      if (w.tended === 0 || hash3(col.id, w.age + w.part * 7919, s.tick) % 100 < h.tendedSafePct - w.tended) w.infected = Math.max(1, w.infected | 0);
    }
    if ((w.infected | 0) <= 0) continue;
    if (bed) w.lt = s.tick;
    const cared = w.lt !== undefined && s.tick - w.lt <= h.tendDayH * TICKS_PER_HOUR;
    const step = perDayOf((cared ? h.tendedCurePerDay : h.infectPerDay) * FIX, t0, t1);
    w.infx = (w.infx | 0) + (cared ? -step : step);
    w.infected = Math.max(0, Math.min(100, Math.ceil(w.infx / FIX)));
    if (cared && w.infx <= 0) { w.infected = 0; w.infx = 0; }
    if (w.infected >= 100) { kill(s, col, 'infection', null); return true; }
  }
  // Grey Taint
  if (hp.taint > 0) {
    const hearth = bed && nearHearth(s, col, h.taintRestHearthLvl, h.taintRestR);
    const before = hp.taint;
    const delta = hearth ? -perDayOf(h.taintRestPerDay * FIX, t0, t1) : bed ? -perDayOf(h.taintBedPerDay * FIX, t0, t1) : perDayOf(h.taintPerDay * FIX, t0, t1);
    hp.taint = Math.max(0, Math.min(100 * FIX, hp.taint + delta));
    for (const a of h.taintAlerts) if (before < a * FIX && hp.taint >= a * FIX) emit(s, 'wounded', { id: col.id, part: 'torso', kind: 'taint', dmg: 0 });
    if (hp.taint >= 100 * FIX) {
      if (traitFlag(col, 'hp.taintSurvive') && !hp.touched) { hp.touched = 1; hp.taint = 0; }
      else { turnFn(s, col); return true; }
    }
  }
  // illness
  if (hp.illness) {
    const d = (PEOPLE.illness || []).find((x) => x.id === hp.illness.id);
    if (!d) hp.illness = null;
    else {
      const sevRate = Math.floor((d.sevPerDay * FIX * (bed ? d.restPct : 100)) / 100);
      hp.illness.sev = Math.min((d.maxSev || 100) * FIX, hp.illness.sev + perDayOf(sevRate, t0, t1));
      hp.illness.imm = hp.illness.imm + perDayOf(d.immPerDay * FIX, t0, t1);
      if (hp.illness.imm >= 100 * FIX) hp.illness = null;
      else if (hp.illness.sev >= 100 * FIX) { kill(s, col, d.id, null); return true; }
    }
  }
  // cold: frostbite at Warmth 0
  if (col.need[3] === 0) {
    const step = h.frostEveryH * TICKS_PER_HOUR;
    if (Math.floor(t1 / step) > Math.floor(t0 / step)) {
      const part = [PART.lleg, PART.rleg, PART.larm, PART.rarm][hash3(col.id, t1, 3) % 4];
      if (damage(s, col, part, 'frost', PEOPLE.warmth.frostDmg).dead) return true;
    }
  }
  return false;
}
/** Grey Cough spreads at midnight to colonists who sleep in the same room as a sufferer. */
function contagion(s) {
  const rooms = new Map();
  for (const c of s.col) {
    if (c.hp.dead || c.bed === null) continue;
    const b = bldById(s, c.bed);
    if (!b) continue;
    const r = s.rt.room[b.y * W_ + b.x];
    if (!r) continue;
    if (!rooms.has(r)) rooms.set(r, []);
    rooms.get(r).push(c);
  }
  for (const [r, list] of [...rooms.entries()].sort((a, b) => a[0] - b[0])) {
    const sick = list.filter((c) => c.hp.illness && (PEOPLE.illness.find((x) => x.id === c.hp.illness.id) || {}).contagionPct);
    if (!sick.length) continue;
    const d = PEOPLE.illness.find((x) => x.id === sick[0].hp.illness.id);
    for (const c of list) if (!c.hp.illness && hash3(c.id, s.tick, r) % 100 < d.contagionPct) infect(s, c, d.id);
  }
}
let turnFn = (s, col) => kill(s, col, 'taint', null);
/** death.js hands over the turning (kill and raise the Husk) to avoid an import cycle. */
export function bindTurn(fn) { turnFn = fn; }
/** Cave-ins (B's onCaveIn): every colonist caught takes 20-45 blunt, one wound. */
export function caveInDamage(s, tiles, hit) {
  const [lo, hi] = PEOPLE.health.caveDmg;
  for (const h of hit || []) {
    if (h.kind !== 'col') continue;
    const c = s.col.find((x) => x.id === h.id);
    if (!c || c.hp.dead) continue;
    const r = hash3(c.id, s.tick, tiles[0] | 0);
    damage(s, c, [PART.head, PART.torso, PART.larm, PART.rarm, PART.lleg, PART.rleg][r % 6], 'blunt', lo + ((r >>> 4) % (hi - lo + 1)));
  }
}
/** Fire (B's onBurn): colonists standing in flames take a burn. */
export function burnDamage(s, tile, ids) {
  for (const id of ids) {
    const c = s.col.find((x) => x.id === id);
    if (!c || c.hp.dead) continue;
    damage(s, c, PART.torso, 'burn', Math.max(1, Math.floor((PEOPLE.health.burnDmg * traitPct(c, 'dmg.fire')) / 100)));
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
