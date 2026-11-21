// Skills, XP and work speed (doc 4.2). Owner F. Provisional API (C2-full fields: col.sk).
//
// col.sk[i] = [lvl, xp, passion, todayTicks], i in SKILL_IDS order (schema C2).
//   lvl 0-20; xp is the progress inside the current level in XP x XP_FIX (fixed point, 14.1);
//   passion PASSION.NONE | KEEN | BURNING; todayTicks counts raw work ticks on that skill today
//   (the daily soft cap counts them before multipliers) and resets at midnight.
// Curve: reaching level n from n - 1 costs XP(n) = round(xpBase x (growth/1000)^n) (balance 'skill').
// Speed: (speedBasePct + speedPerLvlPct x level)%, x traits, x darkness (dark tiles 80%).
//
// Determinism: XP and speed are integer maths; the XP table is built once from balance numbers
// with Math.pow / Math.round (same-engine rule, 14.1) and checked against the 4.2 table in tests.

import { SKILL_IDS, PASSION } from '../core/schema.js';
import { TICKS_PER_DAY } from '../core/time.js';
import { idx, clamp, tileOfW, W, H } from '../core/grid.js';
import { emit } from '../core/events.js';
import { bal, def, all, traitPct, traitFlag, PEOPLE, stage2 } from './defs.js';
import { FIX, WORK_IDS } from '../core/schema.js';
import { TICKS_PER_HOUR, phaseOf } from '../core/time.js';
import { ensurePeople, putKey } from './peoplerec.js';
import { PROFESSION_RULES } from '../../data/professions.js';

export const MAX_LVL = 20;
export const XP_FIX = 100;
/** Levels that carry a rank title (rankUp event and the Chronicle). */
export const RANKS = Object.freeze([[6, 'Apprentice'], [10, 'Journeyman'], [15, 'Master'], [20, 'Grandmaster']]);
/** skill id -> index into col.sk */
export const SK = Object.freeze(Object.fromEntries(SKILL_IDS.map((id, i) => [id, i])));
export const skillIndex = (id) => (id in SK ? SK[id] : -1);

let table = null, tableKey = '';
function xpTable() {
  const b = bal('skill');
  const key = `${b.xpBase}/${b.xpGrowthPermille}`;
  if (table && key === tableKey) return table;
  const t = [0];
  for (let n = 1; n <= MAX_LVL; n++) t.push(Math.round(b.xpBase * Math.pow(b.xpGrowthPermille / 1000, n)));
  table = t; tableKey = key;
  return t;
}
/** XP needed to reach level n from n - 1 (n 1-20); 0 for n <= 0. */
export const xpFor = (n) => (n <= 0 ? 0 : xpTable()[Math.min(n, MAX_LVL)]);
/** Cumulative XP from level 0 to level n. */
export function xpTotal(n) { let a = 0; for (let k = 1; k <= Math.min(n, MAX_LVL); k++) a += xpFor(k); return a; }
export const level = (col, skillId) => { const i = skillIndex(skillId); return i < 0 ? 0 : col.sk[i][0]; };
export const rankOf = (lvl) => { let r = null; for (const [l, name] of RANKS) if (lvl >= l) r = name; return r; };

/** Work speed percent of a level before modifiers (60 at 0, 130 at 10, 200 at 20). */
export function speedPct(lvl) { const b = bal('skill'); return b.speedBasePct + b.speedPerLvlPct * clamp(lvl | 0, 0, MAX_LVL); }

/** Tile index under a colonist (positions are world units). */
const colTile = (col) => idx(clamp(tileOfW(col.x), 0, W - 1), clamp(tileOfW(col.y), 0, H - 1));

/**
 * Work speed x100 for a toil (E's work hook, jobs.setWorkHooks speed). Skill level, Might for
 * mining (+3% per point above 2, 4.2), the work.speed trait modifier, and darkness (light 0 at
 * the colonist's tile: 80%, unless Dark-sighted). Integer maths, floored once at the end.
 */
/** Work and movement percent from scars and frailty (100 when none). */
export function bodyPct(col) {
  const hp = col.hp;
  if (!hp) return 100;
  let p = 100;
  const sc = hp.scars ? Math.min(hp.scars.length, PEOPLE.health.scarMax) : 0;
  if (sc) p -= sc * PEOPLE.health.scarWorkPct;
  for (let k = 0; k < (hp.frail | 0); k++) p = Math.floor((p * PEOPLE.age.frailWorkPct) / 100);
  return Math.max(30, p);
}

export function workSpeed(s, col, toil) {
  const b = bal('skill');
  let v = toil && toil.sk ? speedPct(level(col, toil.sk)) : 100;
  if (toil && toil.sk === 'mining' && b.miningPerMightPct) v = (v * (100 + b.miningPerMightPct * ((col.at[0] | 0) - 2))) / 100;
  v = (v * traitPct(col, 'work.speed')) / 100;
  // darkness: 80% (Dark-sighted never; Night Owls not at night)
  if (s.rt.light[colTile(col)] === 0 && !traitFlag(col, 'work.dark') && !(traitFlag(col, 'work.nightOwl') && phaseOf(s.tick) === 'night')) v = (v * b.darkWorkPct) / 100;
  // Stage 2: Fervour (inspiration) and illness
  if (col.inspo && col.inspo.id === 'fervour' && s.tick < col.inspo.until) v = (v * PEOPLE.inspo.fervourPct) / 100;
  if (col.hp && col.hp.illness) { const d = PEOPLE.illness.find((x) => x.id === col.hp.illness.id); if (d) v = (v * d.workPct) / 100; }
  if (col.hp && (col.hp.scars || col.hp.frail)) v = (v * bodyPct(col)) / 100;
  return Math.max(1, Math.floor(v));
}

/** Learning percent: 100 + learnPerWitsPct x (Wits - 2), x ancestry learn table, x 'learn.xp' traits. */
export function learnPct(col, skillId) {
  const b = bal('skill');
  let p = 100 + b.learnPerWitsPct * ((col.at[1] | 0) - 2);
  const a = def('ancestry', col.anc);
  if (a && a.learn && a.learn[skillId]) p = Math.floor((p * a.learn[skillId]) / 100);
  p = Math.floor((p * traitPct(col, 'learn.xp')) / 100);
  return teachingNear(col) ? Math.floor((p * PEOPLE.inspo.teachingPct) / 100) : p;
}
/** Inspired teaching (4.5): a colonist within teachingR tiles has it (set per tick by the jobs runner's s). */
let TEACH = null;
function teachingNear(col) {
  if (!TEACH) return false;
  const R = PEOPLE.inspo.teachingR * 32;
  for (const t of TEACH) if (t !== col && Math.abs(t.x - col.x) <= R && Math.abs(t.y - col.y) <= R) return true;
  return false;
}
/** Refresh the teachers list (skillsDaySystem slot, every tick; a pure function of saved state). */
export function teachSystem(s) {
  TEACH = null;
  if (!stage2()) return;
  for (const c of s.col) if (c.inspo && c.inspo.id === 'teaching' && s.tick < c.inspo.until && !c.hp.dead) (TEACH || (TEACH = [])).push(c);
}

/**
 * Award XP for `ticks` work ticks on a skill (E's work hook, jobs.setWorkHooks xp). Applies the
 * daily soft cap (first dailyFullTicks ticks per skill per day at 100%, the rest at dailyAfterPct),
 * then passion x learning. Levels up as far as the XP allows and emits `rankUp` at rank levels.
 * @returns {number} levels gained
 */
export function awardXp(s, col, skillId, ticks = 1) {
  const i = skillIndex(skillId);
  if (i < 0 || ticks <= 0) return 0;
  const b = bal('skill'), sk = col.sk[i];
  if (sk[0] >= MAX_LVL) { sk[3] += ticks; return 0; }
  const fullLeft = Math.max(0, b.dailyFullTicks - sk[3]);
  const full = Math.min(ticks, fullLeft), rest = ticks - full;
  sk[3] += ticks;
  if (stage2() && sk[2] > 0) passionTick(s, col, i, sk[2], ticks);
  const eff = full * XP_FIX + Math.floor((rest * XP_FIX * b.dailyAfterPct) / 100);  // ticks x XP_FIX
  const passion = b.passionPct[sk[2]] === undefined ? 100 : b.passionPct[sk[2]];
  let mult = passion * learnPct(col, skillId);                                        // percent x percent
  if (b.learnCapPct && mult > b.learnCapPct * 100) mult = b.learnCapPct * 100;        // (Z2b) stacked learners capped
  sk[1] += Math.floor((eff * mult) / 10000);
  let gained = 0;
  while (sk[0] < MAX_LVL && sk[1] >= xpFor(sk[0] + 1) * XP_FIX) {
    sk[1] -= xpFor(sk[0] + 1) * XP_FIX;
    sk[0]++; gained++;
    if (RANKS.some((r) => r[0] === sk[0])) emit(s, 'rankUp', { colId: col.id, skill: skillId, lvl: sk[0] });
    if (levelHook) levelHook(s, col, skillId, sk[0]);
  }
  if (sk[0] >= MAX_LVL) sk[1] = 0;
  return gained;
}

let levelHook = null;
/** perks.js hands its perkOnLevel over (avoids an import cycle). */
export function bindLevelHook(fn) { levelHook = fn; }
/** Passions (4.2, Stage 2): keen +1 joy an hour of the work, burning +3; burning work is remembered for "Missing my craft". */
function passionTick(s, col, i, passion, ticks) {
  const rate = (passion === 2 ? 3 : 1) * FIX, t1 = s.tick + ticks, t0 = s.tick;
  const d = Math.floor((rate * t1) / TICKS_PER_HOUR) - Math.floor((rate * t0) / TICKS_PER_HOUR);
  if (d) { const v = col.need[2] + d; col.need[2] = v > 100 * FIX ? 100 * FIX : v; }
  if (passion === 2 && s.tick % 60 === 0) putKey(ensurePeople(s).passion, [col.id * 32 + i, s.tick]);
}

// ---- Professions and ranks (8.1) --------------------------------------------------------------------------
/** Rank title for a level (null under 6). */
export const rankTitle = rankOf;
/**
 * The colonist's profession (derived, never assigned): the highest skill at level 6+ among the work
 * types they have at priority 1 (Soldier: Melee or Archery with soldier duty; Hunter: Archery with
 * Animals work); ties to more XP. null when none (the UI shows the adult backstory's title).
 * @returns {null | { id, name, skill, lvl, rank, title }} title e.g. "Master Smith"
 */
export function professionOf(col) {
  const p1 = new Set();
  for (let w = 0; w < WORK_IDS.length; w++) if (col.prio && col.prio[w] === 1) p1.add(WORK_IDS[w]);
  let best = null;
  for (const pr of all('profession')) {
    const rule = PROFESSION_RULES[pr.id] || {};
    const skills = rule.skills || [pr.skill];
    if (rule.soldier && !col.soldier) continue;
    if (rule.work && !p1.has(rule.work)) continue;
    for (const skId of skills) {
      const i = SK[skId];
      if (i === undefined) continue;
      const sk = def('skill', skId);
      const works = (sk && sk.work) || [];
      if (!rule.soldier && !rule.work && !works.some((w) => p1.has(w))) continue;
      const [lv, xp] = col.sk[i];
      if (lv < 6) continue;
      if (!best || lv > best.lvl || (lv === best.lvl && xp > best.xp)) best = { id: pr.id, name: pr.name, skill: skId, lvl: lv, xp };
    }
  }
  if (!best) return null;
  const rank = rankOf(best.lvl);
  return { id: best.id, name: best.name, skill: best.skill, lvl: best.lvl, rank, title: rank ? `${rank} ${best.name}` : best.name };
}
/** The colonist's title: the profession, else the adult backstory's title, else null. */
export function titleOf(col) {
  const p = professionOf(col);
  if (p) return p.title;
  const b = def('backstory', col.bs && col.bs[1]);
  return b ? b.title : null;
}

/** Midnight: reset every colonist's per-skill daily counter (tick system, slot 'needs'). */
export function skillsDaySystem(s) {
  if (s.tick % TICKS_PER_DAY !== 0) return;
  for (const col of s.col) for (const sk of col.sk) sk[3] = 0;
}

/** Best skill id by level, ties by passion then SKILL_IDS order. */
export function bestSkill(col) {
  let best = 0;
  for (let i = 1; i < col.sk.length; i++) {
    const a = col.sk[i], b = col.sk[best];
    if (a[0] > b[0] || (a[0] === b[0] && a[2] > b[2])) best = i;
  }
  return SKILL_IDS[best];
}
export const passionOf = (col, skillId) => { const i = skillIndex(skillId); return i < 0 ? PASSION.NONE : col.sk[i][2]; };
