// Ember-touched (doc 4.5): the seized craftsman. Owner F. Stage 2.
//
// s.colony.ember (C2) = null | { colId, skill, bench, demand: [[k, m, n]], start, deadline, met, work,
//   days }. At most one at a time. Tuning: js/data/needs.js PEOPLE.ember; demand tables:
//   js/data/embertouch.js (rows by skill and tier: 2-3 ordinary materials and one from the deep).
//
//   Trigger (emberSystem, once a game day at midnight): a colonist with Smithing, Woodcraft,
//     Masonry, Tailoring, Art or Cooking at 6+, mood >= 30, not downed or in a break, while no one else
//     is Ember-touched and at least 20 days after the last seizure; chance 1.5% a day (a hash of the
//     seed, the colonist and the day: no RNG stream), doubled within 3 days of a major event (a raid
//     repelled, a death: s.colony.people.majorTick). Colonists are tried in id order.
//   Claim: the nearest finished workshop of that skill's work type becomes the bench (none: they wait
//     by the Hearth); emits `emberTouched`; the condition thought "Ember-touched" +4 while it lasts.
//   Demand: every game hour, when the colony stock holds every demanded material it is taken from the
//     stores (E's item API), `met` is set and the colonist works ember.work up to workH game hours at
//     the bench (needjobs.js emberHook: in work hours, after urgent needs).
//   Met: a named artifact (Masterwork or Legendary) appears by the bench, named from text/artifacts.js
//     ('art_name' variants, by hash) with a subject line; the skill gains a level; "Made a thing of
//     legend" +12 for 10 days; a Chronicle line ('chron_artifact'); emits `artifact`.
//   Not met: each day after the first "Unmade work" stacks (-5 a stack); on day 5 (deadlineDays) a
//     major break (a Tantrum, or Hollow-whispered when their dread is high), "The work was lost", and
//     a 10% chance of the Hollow-Touched trait.
// startEmber(s, col, skill) and emberStep(s) are exported for scripted tests and debug.

import { FIX, SKILL_IDS } from '../core/schema.js';
import { TICKS_PER_DAY, TICKS_PER_HOUR, dayOf } from '../core/time.js';
import { tx, ty } from '../core/grid.js';
import { emit } from '../core/events.js';
import { bldById } from '../core/state.js';
import { structDef } from '../core/content.js';
import { T, makeJob, registerToil, RUN, NEXT, keyBld } from '../work/jobs.js';
import { colTile } from '../work/reserve.js';
import { standSpot } from '../work/windex.js';
import { footprint } from '../work/construct.js';
import { spawn as spawnItem, take } from '../work/items.js';
import { addChron } from '../colony/chronicle.js';
import { all, def, PEOPLE, stage2 } from './defs.js';
import { addThought, removeThought } from './mood.js';
import { startBreakOf } from './breaks.js';
import { grantTrait } from './colonists.js';
import { ensurePeople, peopleRec, hash3 } from './peoplerec.js';

const E = PEOPLE.ember;
export const EMBER_SKILLS = Object.freeze(['smithing', 'woodcraft', 'masonry', 'tailoring', 'art', 'cooking']);
export const MIN_LVL = E.minLvl, MIN_MOOD = E.minMood * FIX;
/** What the artifact is, by skill (item kinds; G's art items). */
export const ARTIFACT_KIND = Object.freeze({ smithing: 'sword', woodcraft: 'statue', masonry: 'bigstatue', tailoring: 'tapestry', art: 'figurine', cooking: 'feast' });
const SKILL_WORK = Object.freeze({ smithing: 'smith', woodcraft: 'craft', masonry: 'craft', tailoring: 'tailor', art: 'art', cooking: 'cook' });

export const activeEmber = (s) => s.colony.ember;
const lvl = (col, sk) => col.sk[SKILL_IDS.indexOf(sk)][0];
/** Is this colonist eligible for the daily check? */
export function eligible(s, col) {
  if (s.colony.ember || col.hp.dead || col.hp.down || col.breakState || col.mood < MIN_MOOD) return false;
  return EMBER_SKILLS.some((k) => lvl(col, k) >= MIN_LVL);
}
/** Demand rows for a skill and tier (data). */
export const demandRows = (skill, tier) => all('emberDemand').filter((r) => r.skill === skill && r.tier === tier);

/** The colonist's best Ember skill (level, then data order). */
function emberSkill(col) {
  let best = null;
  for (const k of EMBER_SKILLS) if (lvl(col, k) >= MIN_LVL && (!best || lvl(col, k) > lvl(col, best))) best = k;
  return best;
}
/** The nearest finished workshop for a skill: its id, or null. */
function benchFor(s, col, skill) {
  const work = SKILL_WORK[skill], c = colTile(col);
  let best = null, bd = Infinity;
  for (const b of s.bld) {
    if (!b || b.st !== 'done') continue;
    const d = structDef(b.def);
    if (!d || !d.workbench || d.workbench.workType !== work) continue;
    const dist = Math.abs(b.x - tx(c)) + Math.abs(b.y - ty(c));
    if (dist < bd) { bd = dist; best = b.id; }
  }
  return best;
}
/** Roll the demand: 2-3 ordinary materials and one from the deep ([[k, m, n]]). */
export function rollDemand(s, col, skill) {
  const tierId = (all('tier')[s.colony.tier | 0] || { id: 'camp' }).id;
  const rows = demandRows(skill, tierId).length ? demandRows(skill, tierId) : demandRows(skill, 'camp');
  if (!rows.length) return [];
  const row = rows[0], seed = hash3(col.id, s.tick, 0xe1);
  const mats = Object.keys(row.mats).sort(), deep = Object.keys(row.deep).sort();
  const nMats = 2 + (seed % 2);
  const out = [];
  for (let k = 0; k < mats.length && out.length < nMats; k++) {
    const key = mats[(k + (seed >>> 3)) % mats.length];
    const [kind, m] = key.split(':');
    out.push([kind, m || null, row.mats[key]]);
  }
  const dk = deep[(seed >>> 7) % deep.length];
  const [kind, m] = dk.split(':');
  out.push([kind, m || null, row.deep[dk]]);
  return out;
}

/** Seize a colonist (the daily trigger, or a scripted test). Returns the ember record. */
export function startEmber(s, col, skill = emberSkill(col)) {
  if (!skill) return null;
  const rec = ensurePeople(s);
  s.colony.ember = { colId: col.id, skill, bench: benchFor(s, col, skill), demand: rollDemand(s, col, skill), start: s.tick, deadline: s.tick + E.deadlineDays * TICKS_PER_DAY, met: -1, work: 0, days: 0 };
  rec.emberLast = s.tick;
  emit(s, 'emberTouched', { colId: col.id, bId: s.colony.ember.bench });
  return s.colony.ember;
}
/** Units of kind k (material m) the colony holds anywhere on the map, not forbidden (the demand card). */
function stockOf(s, k, m) {
  let n = 0;
  for (const it of s.items) if (it && it.k === k && (!m || it.m === m) && !it.f) n += it.n;
  return n;
}
/** Does the colony hold every demanded material now? */
export const demandMet = (s, em) => em.demand.every(([k, m, n]) => stockOf(s, k, m) >= n);
/** The demand card rows: [{ k, m, n, have, ok }]. */
export const demandCard = (s) => { const em = s.colony.ember; return em ? em.demand.map(([k, m, n]) => ({ k, m, n, have: stockOf(s, k, m), ok: stockOf(s, k, m) >= n })) : []; };
/** Take the demanded materials out of the stores (lowest stack ids first). */
function consumeDemand(s, em) {
  for (const [k, m, n] of em.demand) {
    let left = n;
    for (let id = 0; id < s.items.length && left > 0; id++) {
      const it = s.items[id];
      if (!it || it.k !== k || (m && it.m !== m) || it.f) continue;
      const b = take(s, id, Math.min(left, it.n));
      if (b) left -= b.n;
    }
  }
}
function finish(s, em, col) {
  const b = em.bench !== null ? bldById(s, em.bench) : null;
  const at = b ? standSpot(s, col, footprint(s, b)).i : colTile(col);
  const i = at >= 0 ? at : colTile(col);
  const names = (def('text', 'art_name') || { variants: ['Emberwork'] }).variants || ['Emberwork'];
  const name = names[hash3(col.id, em.start, 0xa7) % names.length];
  const q = E.artifactQ[hash3(col.id, s.tick, 0xa8) % E.artifactQ.length];
  const kind = ARTIFACT_KIND[em.skill] || 'figurine';
  const mat = (em.demand.find((d) => d[1]) || [null, null])[1];
  const id = spawnItem(s, kind, mat, q, 1, tx(i), ty(i), { name, maker: col.id });
  const sk = col.sk[SKILL_IDS.indexOf(em.skill)];
  if (sk[0] < 20) { sk[0]++; sk[1] = 0; }
  addThought(s, col, 'ember_made');
  removeThought(col, 'ember_touched');
  addChron(s, 'artifact', 'chron_artifact', { maker: col.name, item: name, kind, colId: col.id });
  emit(s, 'artifact', { itemId: id, colId: col.id, name });
  s.colony.ember = null;
  return id;
}
function fail(s, em, col) {
  removeThought(col, 'ember_touched');
  removeThought(col, 'unmade_work');
  addThought(s, col, 'ember_failed');
  const dread = col.need[4] < 20 * FIX;
  startBreakOf(s, col, dread ? 'hollow_whispered' : 'tantrum', 'major');
  if (hash3(col.id, s.tick, 0xaf) % 100 < E.touchedPct) grantTrait(col.traits, 'hollow_touched');
  s.colony.ember = null;
}

/** One hourly step of an active seizure (exported for tests). */
export function emberStep(s) {
  const em = s.colony.ember;
  if (!em) return;
  const col = s.col.find((c) => c.id === em.colId);
  if (!col || col.hp.dead) { s.colony.ember = null; return; }
  if (em.met < 0 && demandMet(s, em)) { consumeDemand(s, em); em.met = s.tick; }
  if (em.met >= 0) { if (em.work >= E.workH * TICKS_PER_HOUR) finish(s, em, col); return; }
  const day = Math.floor((s.tick - em.start) / TICKS_PER_DAY);
  if (day > em.days) { em.days = day; addThought(s, col, 'unmade_work'); }
  if (s.tick >= em.deadline) fail(s, em, col);
}

/** Tick system (slot 'mood'): the hourly step and the daily trigger. */
export function emberSystem(s) {
  if (!stage2()) return;
  if (s.tick % TICKS_PER_HOUR === 0) emberStep(s);
  if (s.tick % TICKS_PER_DAY !== 0 || s.colony.ember) return;
  const rec = peopleRec(s), day = dayOf(s.tick);
  if (rec.emberLast >= 0 && s.tick - rec.emberLast < E.cooldownDays * TICKS_PER_DAY) return;
  const boost = rec.majorTick >= 0 && s.tick - rec.majorTick <= E.afterMajorDays * TICKS_PER_DAY ? 2 : 1;
  for (const col of s.col) {
    if (!eligible(s, col)) continue;
    if (hash3(s.seed >>> 0, col.id, day) % 1000 < E.chancePermille * boost) { startEmber(s, col); addThought(s, col, 'ember_touched'); return; }
  }
}

// ---- The work at the bench (needjobs.js calls emberJob from the schedule hook in work hours) -------------
/** The ember job for the seized colonist now, or null (not them, or nothing to do). */
export function emberJob(s, col) {
  const em = s.colony.ember;
  if (!stage2() || !em || em.colId !== col.id) return null;
  const b = em.bench !== null ? bldById(s, em.bench) : null;
  const st = b ? standSpot(s, col, footprint(s, b)) : null;
  if (em.met < 0) {
    // waiting for the materials: they stand by their bench (or the Hearth) and will not work
    if (st && st.i >= 0) return makeJob('ember', -1, [T.goto(st.i), T.wait(TICKS_PER_HOUR)], { need: true });
    return null;
  }
  if (!st || st.i < 0) return makeJob('ember', -1, [{ t: 'emberWork', n: TICKS_PER_HOUR }], { need: true });
  return { job: makeJob('ember', keyBld(b.id), [T.goto(st.i), { t: 'emberWork', n: TICKS_PER_HOUR }], { need: true }), claims: [[keyBld(b.id), 0]] };
}
registerToil('emberWork', (s, col, job, toil) => {
  const em = s.colony.ember;
  if (!em || em.colId !== col.id) return NEXT;
  em.work++;
  return ++job.work >= toil.n ? NEXT : RUN;
});
