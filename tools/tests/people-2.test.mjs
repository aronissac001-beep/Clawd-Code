// Workstream F, Stage 2 (doc 14.8 row F): all 5 needs, 24 traits, breaks and inspirations,
// Ember-touched, wounds, bleeding, infection, taint, tending, illness, relationships, death and burial
// with Husk rising, the 33 perks and their hooks (earned by deeds since Stage 2.9: perks-earn.test), professions and ranks, schedules, soldier duty
// and squads, the 13 roles and the Advanced grid data.
// Acceptance: an untended cut infects after 12 h; taint reaches 100 and the colonist turns (scripted);
// a met Ember-touched demand produces a named artifact and an unmet one a major break (scripted).
// (The bot target, average mood > 45 at day 60, is measured with the colony bot.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installSim, foundColony, findSite } from '../../js/game/core/setup.js';
import { step, tick } from '../../js/game/core/sim.js';
import { applyCommand } from '../../js/game/core/commands.js';
import { FIX, WORK_IDS, SCHED, SKILL_IDS, NEED_IDS } from '../../js/game/core/schema.js';
import { TICKS_PER_HOUR, TICKS_PER_DAY } from '../../js/game/core/time.js';
import { stateHash } from '../../js/game/core/state.js';
import { addBuilding } from '../../js/game/core/apply.js';
import { saveBlobSync, loadBlobSync } from '../../js/game/save/colonysave.js';
import { completeBuilding } from '../../js/game/work/construct.js';
import { spawn, totals, destroy as destroyStack } from '../../js/game/work/items.js';
import { rebuildFromJobs } from '../../js/game/work/reserve.js';
import { think } from '../../js/game/work/think.js';
import { CONTENT } from '../../js/data/index.js';
import { rumbleTicks } from '../../js/game/world/support.js';
import { setWeather } from '../../js/game/world/weather.js';
import { tempAt } from '../../js/game/world/terrain.js';
import { PEOPLE } from '../../js/data/needs.js';
import {
  needs, health, breaks, embertouch, social, death, perks, skills, roles, draft, colonists, joy, mood,
} from '../../js/game/people/index.js';

const F = (pts) => pts * FIX;
function colony(seed = 'F-2') {
  installSim({ stage: '2', reset: true, checks: true });
  return foundColony({ seed, name: 'F Hold' });
}
const hearth = (s) => s.bld[s.colony.hearth.id];
function built(s, defId, dx = 4, dy = 4) {
  const hb = hearth(s), d = CONTENT.get('structure', defId);
  const at = findSite(s, hb.x + dx, hb.y + dy, d.size[0], d.size[1], 1);
  const b = addBuilding(s, defId, at[0], at[1], 0, null);
  completeBuilding(s, b);
  return b;
}
/** Step n ticks with the storyteller quiet (no raids in these scripted scenes). */
function calm(s, n, until = () => false) {
  for (let k = 0; k < n; k++) { if (s.tick % 600 === 0) { s.st.queue.length = 0; } tick(s); if (until()) return true; }
  return false;
}
const stopAll = (s) => { for (const c of s.col) { c.custom = true; c.prio = new Uint8Array(WORK_IDS.length); c.job = null; } s.rt.res = rebuildFromJobs(s); };

// ---- data counts ---------------------------------------------------------------------------------------------
test('F data: 5 needs, the 24 trait rows (29 traits in pairs), 33 perks, 13 roles, 15 professions, every break', () => {
  assert.deepEqual(CONTENT.all('need').map((n) => n.id), NEED_IDS.slice());
  assert.equal(CONTENT.all('trait').length, 29, 'the 24 rows of the 4.3 table: 5 rows are pairs (Hardworking / Lazy ...)');
  for (const [a, b] of [['hardworking', 'lazy'], ['quick_learner', 'slow'], ['steady', 'volatile'], ['cheerful', 'gloomy'], ['brave', 'craven']]) assert.equal(CONTENT.get('trait', a).excl, b);
  const perkList = CONTENT.all('perk');
  assert.equal(perkList.length, 33);
  for (const sk of CONTENT.all('skill')) {
    const mine = perkList.filter((p) => p.skill === sk.id);
    if (sk.key) { assert.equal(mine.filter((p) => p.lvl === 10).length, 2, sk.id); assert.equal(mine.filter((p) => p.lvl === 20).length, 2, sk.id); }
    else assert.deepEqual(mine.map((p) => p.lvl), [15], sk.id);
  }
  assert.equal(CONTENT.all('role').length, 13);
  assert.equal(CONTENT.all('profession').length, 15);
  for (const sev of ['minor', 'major', 'extreme']) assert.ok(CONTENT.all('break').filter((b) => b.sev === sev).length >= 3, sev);
  assert.ok(CONTENT.all('thought').length >= 100, `${CONTENT.all('thought').length} thoughts`);
});

// ---- health: infection (acceptance) ----------------------------------------------------------------------------
test('health: an untended cut infects after 12 h, and a tended one need not', () => {
  const s = colony();
  stopAll(s);
  const [a, b] = s.col;
  health.damage(s, a, 'larm', 'cut', 6);
  health.damage(s, b, 'larm', 'cut', 6);
  health.tend(s, null, b, 'salve', 100);
  // keep them out of bed so nothing else tends them
  for (const c of [a, b]) c.custom = true;
  let at = -1;
  for (let k = 0; k < 13 * TICKS_PER_HOUR; k++) {
    for (const c of [a, b]) if (c.job && (c.job.type === 'bedrest' || c.job.type === 'sleep')) c.job = null;
    s.rt.res = rebuildFromJobs(s);
    tick(s);
    if (at < 0 && a.hp.wounds[0].infected > 0) at = k;
  }
  assert.ok(at >= 12 * TICKS_PER_HOUR - 20 && at <= 12 * TICKS_PER_HOUR + 20, `infected at ${(at / TICKS_PER_HOUR).toFixed(2)} h`);
  assert.equal(b.hp.wounds[0].infected | 0, 0, 'tended at full quality: no infection');
  assert.ok(health.hurt(a), 'an infected wound sends them to bed');
});
test('health: infection grows to death untended and heals with daily tending', () => {
  const s = colony();
  const c = s.col[0];
  health.damage(s, c, 'larm', 'cut', 5);
  const w = c.hp.wounds[0];
  w.age = 12 * TICKS_PER_HOUR; w.infected = 1; w.rolled = 1; w.infx = FIX;
  // tended every day: it falls away
  for (let d = 0; d < 3; d++) { health.tend(s, null, c, 'poultice'); step(s, TICKS_PER_DAY / 2); }
  assert.equal(w.infected | 0, 0, 'tended daily: the infection is gone');
});

// ---- the Grey Taint turns a colonist (acceptance, scripted) ------------------------------------------------------
test('taint: a Hollow wound taints, the taint reaches 100 and the colonist turns into a Husk', () => {
  const s = colony();
  stopAll(s);
  const c = s.col[0];
  c.hp.taint = F(90);
  c.traits = c.traits.filter((t) => t !== 'hollow_touched');
  const foes0 = s.foes.length, raids0 = s.raids.length;
  // keep them on their feet (in bed the taint would fall)
  for (let k = 0; k < TICKS_PER_DAY && !c.hp.dead; k++) { if (c.job) c.job = null; s.rt.res = rebuildFromJobs(s); tick(s); }
  assert.ok(c.hp.dead && c.hp.turned, 'they turned');
  assert.equal(s.foes.length, foes0 + 1, 'a Husk rose where they stood');
  assert.equal(s.foes[s.foes.length - 1].kind, 'husk');
  assert.equal(s.raids.length, raids0 + 1, 'as a one-member raid that H runs');
  assert.ok(!s.items.some((it) => it && it.k === 'corpse' && it.maker === c.id), 'no corpse is left');
  assert.ok(s.col.filter((o) => !o.hp.dead).every((o) => mood.hasThought(o, 'turned')));
});
test('taint: Hollow-Touched lives through it once', () => {
  const s = colony();
  stopAll(s);
  const c = s.col[0];
  c.traits = ['hollow_touched'];
  c.hp.taint = F(99);
  for (let k = 0; k < 2 * TICKS_PER_HOUR; k++) { if (c.job) c.job = null; s.rt.res = rebuildFromJobs(s); tick(s); }
  assert.ok(!c.hp.dead && c.hp.taint === 0 && c.hp.touched === 1);
});

// ---- Ember-touched (acceptance, scripted) ----------------------------------------------------------------------
function emberColony() {
  const s = colony('F-EMBER');
  stopAll(s);
  const c = s.col[0];
  c.sk[SKILL_IDS.indexOf('smithing')][0] = 8;
  c.custom = false;
  const forge = built(s, 'forge', 5, 2);
  return { s, c, forge };
}
test('Ember-touched: a met demand produces a named artifact, a level and "Made a thing of legend"', () => {
  const { s, c, forge } = emberColony();
  const em = embertouch.startEmber(s, c, 'smithing');
  assert.equal(em.bench, forge.id, 'claims the forge');
  assert.ok(em.demand.length >= 3, 'demands 2-3 materials and one from the deep');
  const hb = hearth(s);
  for (const [k, m, n] of em.demand) spawn(s, k, m, 0, n, hb.x - 3, hb.y + 4);
  const lvl0 = c.sk[SKILL_IDS.indexOf('smithing')][0];
  let art = null;
  calm(s, 4 * TICKS_PER_DAY, () => !!(art = s.items.find((it) => it && it.maker === c.id && it.name && it.q >= 4) || null));
  assert.ok(art, 'a named Masterwork or Legendary artifact');
  assert.ok(CONTENT.get('text', 'art_name').variants.includes(art.name), `named ${art.name}`);
  assert.equal(c.sk[SKILL_IDS.indexOf('smithing')][0], lvl0 + 1, 'the skill gained a level');
  assert.ok(mood.hasThought(c, 'ember_made'));
  assert.equal(s.colony.ember, null);
  assert.ok(s.chron.some((e) => e[2] === 'chron_artifact'));
});
test('Ember-touched: an unmet demand leads to a major break on day 5', () => {
  const { s, c } = emberColony();
  embertouch.startEmber(s, c, 'smithing');
  calm(s, 6 * TICKS_PER_DAY, () => s.colony.ember === null);
  const brk = c.breakState;
  assert.ok(brk && brk.sev === 'major', `a major break (${brk && brk.id})`);
  assert.ok(['tantrum', 'hollow_whispered'].includes(brk.id), brk.id);
  assert.ok(mood.hasThought(c, 'ember_failed'));
  assert.equal(s.colony.ember, null);
});
test('Ember-touched: a save mid-seizure continues identically', () => {
  const { s, c } = emberColony();
  embertouch.startEmber(s, c, 'smithing');
  step(s, TICKS_PER_DAY);
  const s2 = loadBlobSync(saveBlobSync(s));
  step(s, TICKS_PER_DAY); step(s2, TICKS_PER_DAY);
  assert.equal(stateHash(s2), stateHash(s));
});

// ---- needs: joy and warmth --------------------------------------------------------------------------------------
test('needs: joy falls and a joy job restores it; warmth falls in the cold and is sought', () => {
  const s = colony();
  stopAll(s);
  const c = s.col[0];
  c.need[needs.NEED.joy] = F(20);
  think(s, c);
  assert.equal(c.job && c.job.type, 'joy', 'low joy: off to a joy activity');
  const j0 = c.need[needs.NEED.joy];
  for (let k = 0; k < 2 * TICKS_PER_HOUR && c.job && c.job.type === 'joy'; k++) tick(s);
  assert.ok(c.need[needs.NEED.joy] > j0 + F(5), `joy rose to ${c.need[needs.NEED.joy] / FIX}`);
  // a cold snap on open ground at night: warmth falls
  const w0 = c.need[needs.NEED.warmth];
  s.colony.world.weather.kind = 'coldsnap'; s.colony.world.weather.until = s.tick + TICKS_PER_DAY;
  s.rt.dirty.temperature = true; tick(s);
  assert.ok(needs.warmthRate(s, c) < 0 || needs.warmthRate(s, c) > 0);
  c.need[needs.NEED.warmth] = F(10);
  c.job = null; s.rt.res = rebuildFromJobs(s);
  think(s, c);
});

// ---- breaks and inspirations -------------------------------------------------------------------------------
test('breaks: every Stage 2 break has a behaviour job; a talk-down ends one; an inspiration speeds work', () => {
  const s = colony();
  stopAll(s);
  const [a, b] = s.col;
  for (const id of ['hide', 'tantrum', 'dark_wander', 'insult_spree', 'hollow_whispered', 'catatonic']) {
    a.breakState = null; a.job = null; s.rt.res = rebuildFromJobs(s);
    breaks.startBreakOf(s, a, id);
    think(s, a);
    assert.ok(a.job && a.job.brk, `${id}: a break job (${a.job && a.job.type})`);
  }
  b.sk[SKILL_IDS.indexOf('social')][0] = 20;
  let ok = false;
  for (let k = 0; k < 40 && !ok; k++) { s.tick++; ok = breaks.talkDown(s, b, a); }
  assert.ok(ok, 'a Social 20 colonist talks them down');
  assert.equal(a.breakState, null);
  const toil = { sk: 'mining' };
  const v0 = skills.workSpeed(s, a, toil);
  breaks.inspire(s, a, 'fervour');
  assert.ok(Math.abs(skills.workSpeed(s, a, toil) - v0 * 1.5) <= 1, 'Fervour: half again as fast');
});

// ---- death, burial, rising ----------------------------------------------------------------------------------
test('death: a corpse, grief by relation, burial in a grave; unburied in the dark it rises at night', () => {
  const s = colony();
  stopAll(s);
  const [a, b, c] = s.col;
  social.addOpinion(s, a.id, b.id, 60);
  social.setKind(s, a.id, c.id, 'lover');
  health.kill(s, a, 'wounds');
  assert.ok(s.items.some((it) => it && it.k === 'corpse' && it.maker === a.id), 'a corpse');
  assert.ok(mood.hasThought(b, 'friend_died') && mood.hasThought(c, 'lover_died'));
  // burial
  const g = built(s, 'grave', -6, 4);
  b.custom = true; b.prio[WORK_IDS.indexOf('haul')] = 1;
  calm(s, TICKS_PER_DAY, () => death.graveNames(s, g.id).length > 0);
  assert.ok(!s.items.some((it) => it && it.k === 'corpse'), 'buried');
  assert.deepEqual(death.graveNames(s, g.id), [a.name]);
  assert.ok(mood.hasThought(b, 'buried_someone') || mood.hasThought(c, 'buried_someone'));
  // a second death, left in the dark: it rises
  b.prio = new Uint8Array(WORK_IDS.length); c.prio = new Uint8Array(WORK_IDS.length);
  health.kill(s, b, 'wounds');
  const corpse = s.items.find((it) => it && it.k === 'corpse' && it.maker === b.id);
  s.rt.light[corpse.y * s.w + corpse.x] = 0;
  const rec = s.colony.people.corpses.find((e) => e[0] === b.id);
  rec[1] = 2 * TICKS_PER_DAY;
  const foes0 = s.foes.length;
  for (let k = 0; k < TICKS_PER_DAY && s.foes.length === foes0; k++) tick(s);
  assert.equal(s.foes.length, foes0 + 1, 'the dead rose');
  assert.ok(!s.items.some((it) => it && it.k === 'corpse' && it.maker === b.id));
});

test('death records: past KEEP_DEAD dead, the longest dead with no corpse leave s.col with their relations (soak cap)', () => {
  const s = colony();
  stopAll(s);
  const [a] = s.col;
  const hb = hearth(s);
  const made = [];
  for (let k = 0; k < death.KEEP_DEAD + 6; k++) {
    const c = colonists.generateColonist(s);
    colonists.spawnColonist(s, c, hb.x + 2, hb.y + 2);
    social.addOpinion(s, a.id, c.id, 30);
    health.kill(s, c, 'wounds');
    made.push(c);
  }
  // the first two keep their corpse; the rest are gone (buried or risen)
  for (const c of made.slice(2)) { const it = death.corpseOf(s, c.id); if (it) destroyStack(s, it.id); s.colony.people.corpses = s.colony.people.corpses.filter((e) => e[0] !== c.id); }
  for (const it of s.items) if (it && it.k === 'corpse' && made.slice(2).some((c) => c.id === it.maker)) assert.fail('corpse left');
  assert.equal(death.pruneDead(s), 0, 'nobody leaves within a day of dying');
  for (let k = 0; k < TICKS_PER_DAY; k++) tick(s);
  const dead = () => s.col.filter((c) => c.hp.dead).length;
  assert.equal(dead(), death.KEEP_DEAD, 'capped at KEEP_DEAD');
  for (const c of made.slice(0, 2)) assert.ok(s.col.includes(c), 'a dead colonist with a corpse on the map stays');
  const gone = made.filter((c) => !s.col.includes(c));
  assert.equal(gone.length, 6);
  for (const c of gone) assert.equal(social.relation(s, a.id, c.id), null, 'their relations are forgotten');
  assert.ok(gone.every((c) => c.id < made[made.length - 1].id), 'the longest dead go first');
  // the colony runs on, and saves and loads
  for (let k = 0; k < TICKS_PER_HOUR * 3; k++) tick(s);
  const back = loadBlobSync(saveBlobSync(s));
  assert.equal(stateHash(back), stateHash(s));
});

// ---- social -------------------------------------------------------------------------------------------------
test('social: chats move opinions (Kind, Abrasive), friends and rivals follow, lovers form', () => {
  const s = colony();
  const [a, b] = s.col;
  a.traits = ['kind']; b.traits = [];
  let sum = 0;
  for (let k = 0; k < 20; k++) { s.tick += 7; sum += social.chat(s, a, b); }
  assert.ok(sum > 20 && social.opinion(s, a.id, b.id) >= 40 && social.kindOf(s, a.id, b.id) === 'friend');
  a.traits = ['abrasive'];
  const op = social.opinion(s, a.id, b.id);
  for (let k = 0; k < 10; k++) { s.tick += 7; social.chat(s, a, b); }
  assert.ok(social.opinion(s, a.id, b.id) < op, 'an abrasive tongue costs friends');
  assert.ok(social.strongest(s, a.id).length >= 1);
});

// ---- perks, professions, ranks ----------------------------------------------------------------------------------
test('perks: a level-up alone grants nothing and raises no letter (perks are earned by deeds, perks-earn.test); Unbroken survives a lethal blow', () => {
  const s = colony();
  const c = s.col[0];
  const ci = SKILL_IDS.indexOf('cooking');
  c.sk[ci] = [14, 0, 1, 0];
  skills.awardXp(s, c, 'cooking', 0);
  while (c.sk[ci][0] < 15) skills.awardXp(s, c, 'cooking', 2400);
  assert.ok(!c.perks.includes('hearth_cook'), 'no signature perk without its deed (3.1)');
  const mi = SKILL_IDS.indexOf('mining');
  c.sk[mi] = [9, 0, 1, 0];
  s.rt.events.length = 0;
  while (c.sk[mi][0] < 10) { c.sk[mi][3] = 0; skills.awardXp(s, c, 'mining', 2400); }
  assert.ok(!s.rt.events.some((e) => e.name === 'letter' && e.data.kind === 'perk'), 'no perk letter');
  assert.equal(perks.pendingChoices, undefined, 'there are no choices (the picker API is gone)');
  c.perks.push('seam_follower');
  assert.ok(perks.hasGrant(c, 'seamFollower'));
  c.perks.push('unbroken');
  const r = health.damage(s, c, 'head', 'blunt', 999, { id: 9, kind: 'husk', raid: 5 });
  assert.equal(r.dead, false, 'Unbroken: alive at 1 HP');
  assert.equal(health.damage(s, c, 'head', 'blunt', 999, { id: 9, kind: 'husk', raid: 5 }).dead, true, 'once a raid');
});
test('professions: the best priority-1 skill at 6+ with its rank', () => {
  const s = colony();
  const c = s.col[0];
  c.custom = true; c.prio = new Uint8Array(WORK_IDS.length); c.prio[WORK_IDS.indexOf('smith')] = 1;
  for (const sk of c.sk) sk[0] = 3;
  c.sk[SKILL_IDS.indexOf('smithing')][0] = 15;
  assert.equal(skills.professionOf(c).title, 'Master Smith');
  c.prio[WORK_IDS.indexOf('smith')] = 2;
  assert.equal(skills.professionOf(c), null);
  c.soldier = true; c.sk[SKILL_IDS.indexOf('melee')][0] = 10;
  assert.equal(skills.professionOf(c).title, 'Journeyman Soldier');
});

// ---- roles, the grid, schedules, squads ----------------------------------------------------------------------
test('roles: 13 roles, the Advanced grid data, schedule presets, soldier squads', () => {
  const s = colony();
  const c = s.col[0];
  assert.equal(applyCommand(s, { t: 'role', colId: c.id, primary: 'herder', secondary: 'scholar' }).ok, true);
  assert.equal(c.prio[WORK_IDS.indexOf('animals')], 1);
  assert.equal(c.prio[WORK_IDS.indexOf('lore')], 2);
  const grid = roles.workGrid(s);
  assert.equal(grid.length, s.col.length);
  assert.equal(grid[0].cells.length, 13);
  assert.ok(grid[0].cells.every((x) => 'p' in x && 'skill' in x && 'off' in x));
  assert.equal(roles.scheduleName(roles.schedulePreset('night')), 'night');
  assert.equal(roles.schedulePreset('day')[23], SCHED.SLEEP);
  assert.equal(roles.schedulePreset('day')[19], SCHED.JOY);
  assert.equal(applyCommand(s, { t: 'role', colId: c.id, primary: 'soldier' }).ok, true);
  assert.equal(c.soldier, true);
  assert.equal(c.squad, 1, 'a new soldier joins the first squad');
  assert.deepEqual(draft.squadList(s).map((q) => [q.id, q.members.length]), [[1, 1]]);
  c.mood = F(20); c.traits = ['craven'];
  assert.match(draft.draftVeto(s, c), /frightened/);
});

// ---- traits and generation ------------------------------------------------------------------------------------
test('traits: Stage 2 colonists roll from all 29; exclusive pairs never meet; Night Owls keep the night watch', () => {
  const s = colony();
  const seen = new Set();
  for (let k = 0; k < 200; k++) {
    const c = colonists.generateColonist(s);
    for (const t of c.traits) seen.add(t);
    for (const t of c.traits) { const d = CONTENT.get('trait', t); assert.ok(!d.excl || !c.traits.includes(d.excl)); }
    if (c.traits.includes('night_owl')) assert.equal(roles.scheduleName(c.sched), 'night');
  }
  assert.ok(seen.size >= 24, `${seen.size} traits seen`);
});

// ---- determinism with the Stage 2 people rules ------------------------------------------------------------------
test('people: a Stage 2 colony saved and reloaded continues identically over two days', () => {
  const s = colony('F-DET');
  step(s, TICKS_PER_DAY);
  const s2 = loadBlobSync(saveBlobSync(s));
  step(s, 2 * TICKS_PER_DAY); step(s2, 2 * TICKS_PER_DAY);
  assert.equal(stateHash(s2), stateHash(s));
});

// ---- Stage 2 health extras: Ember Hands, scars, frostbite, ageing -------------------------------------------------
test('health: Ember Hands stops a dying colonist bleeding once a day; big wounds can scar; Warmth 0 brings frostbite', () => {
  const s = colony();
  stopAll(s);
  const [a, b, c] = s.col;
  a.x = b.x; a.y = b.y;
  b.perks.push('ember_hands');
  health.damage(s, a, 'torso', 'stab', 30);
  a.hp.blood = F(20);
  assert.ok(health.bleedRate(a) > 0);
  calm(s, health.HEALTH.every * 2);
  assert.equal(health.bleedRate(a), 0, 'the touch stops the bleeding');
  assert.equal(a.hp.dead, undefined);
  // the second dying colonist the same day gets nothing
  c.x = b.x; c.y = b.y;
  health.damage(s, c, 'torso', 'stab', 30); c.hp.blood = F(20);
  calm(s, health.HEALTH.every * 2);
  assert.ok(health.bleedRate(c) > 0, 'once a day');
  // scars: a big wound healing away scars at the hashed scarPct
  let scars = 0;
  for (let k = 0; k < 400; k++) {
    const col = { id: k, hp: { parts: [25, 40 - 15, 20, 20, 25, 25], wounds: [{ part: 1, kind: 'cut', dmg: 1, big: 1, age: k * 37, tended: 50, infected: 0, bleed: 0 }] } };
    if (health.healStep(col) >= 0) scars++;
  }
  assert.ok(scars > 400 * PEOPLE.health.scarPct / 100 / 3 && scars < 400 * PEOPLE.health.scarPct / 100 * 3, `${scars} of 400 scarred`);
  const sp = skills.workSpeed(s, b, null);
  b.hp.scars = [1, 2];
  assert.equal(skills.workSpeed(s, b, null), Math.max(1, Math.floor((sp * (100 - 2 * PEOPLE.health.scarWorkPct)) / 100)), 'each scar costs work speed');
  // frostbite: Warmth at 0 for a few hours wounds a limb
  setWeather(s, 'coldsnap', 24);
  let spot = -1;
  for (let i = 0; i < s.L.terrain.length && spot < 0; i++) if (s.rt.walkCost[i] && !s.rt.room[i] && tempAt(s, i) < 0 && s.rt.heat[i] === 0) spot = i;
  assert.ok(spot >= 0, 'a freezing tile');
  a.hp.blood = F(100);
  const put = () => { a.x = (spot % 128) * 32 + 16; a.y = Math.floor(spot / 128) * 32 + 16; a.job = null; a.path = null; a.need[3] = 0; };
  for (let k = 0; k < (PEOPLE.warmth.frostEveryH + 1) * TICKS_PER_HOUR && !a.hp.dead; k++) { put(); s.rt.res = rebuildFromJobs(s); tick(s); }
  assert.ok(a.hp.wounds.some((w) => w.kind === 'frost'), 'a frost wound');
});
test('ageing: a year every 40 days; frailty from 65 slows work; old age can end a life after 80', () => {
  const s = colony();
  stopAll(s);
  const [a, b] = s.col;
  const age0 = a.age;
  const toYear = PEOPLE.age.daysPerYear * TICKS_PER_DAY - (s.tick % (PEOPLE.age.daysPerYear * TICKS_PER_DAY));
  s.tick += toYear - 1;
  calm(s, 1);
  assert.equal(a.age, age0 + 1, 'a birthday');
  b.age = 120;
  s.tick += PEOPLE.age.daysPerYear * TICKS_PER_DAY - 1;
  calm(s, 1);
  assert.equal(b.hp.dead, true, 'death of old age far past 80');
  const sp = skills.workSpeed(s, a, null);
  a.hp.frail = 1;
  assert.equal(skills.workSpeed(s, a, null), Math.floor((sp * PEOPLE.age.frailWorkPct) / 100));
  health.setAgeing(false);
  const age1 = a.age;
  s.tick += PEOPLE.age.daysPerYear * TICKS_PER_DAY - 1; calm(s, 1);
  assert.equal(a.age, age1, 'the setting turns ageing off');
  health.setAgeing(true);
});

// ---- arrest, banners, Cave Sense ----------------------------------------------------------------------------------
test('breaks: a drafted colonist arrests a major break (bed for a day); a squad by its banner does not break', () => {
  const s = colony();
  stopAll(s);
  const [a, b, c] = s.col;
  breaks.startBreakOf(s, a, 'tantrum');
  assert.match(breaks.arrest(s, b, a), /drafted/);
  draft.setDrafted(s, b, true);
  b.x = a.x + 500;
  assert.match(breaks.arrest(s, b, a), /far/);
  b.x = a.x; b.y = a.y;
  assert.equal(breaks.arrest(s, b, a), null);
  assert.equal(a.breakState.arrested, 1);
  assert.equal(a.breakState.until - s.tick, TICKS_PER_DAY);
  assert.ok(mood.hasThought(a, 'arrested'));
  // banners: squad 1 with a finished banner, sewn by a Banner-maker; a miserable soldier near it holds
  draft.setSquad(s, c, 1);
  const ban = built(s, 'banner', 2, 2);
  assert.match(draft.setSquadBanner(s, 1, ban.id), /Banner-maker/);
  b.perks.push('banner_maker');
  assert.equal(draft.setSquadBanner(s, 1, ban.id), null);
  c.x = ban.x * 32 + 16; c.y = ban.y * 32 + 16;
  assert.equal(draft.bannerHolds(s, c), true);
  c.x += 20 * 32;
  assert.equal(draft.bannerHolds(s, c), false, 'too far from the banner');
  c.x = ban.x * 32 + 16;
  let broke = false;
  for (let h = 0; h < 48; h++) { c.mood = F(2); if (c.breakState) { broke = true; break; } calm(s, TICKS_PER_HOUR); c.x = ban.x * 32 + 16; c.y = ban.y * 32 + 16; }
  assert.equal(broke, false, 'no break beside the banner');
});
test('perks: Cave Sense gives a 2 h warning before a cave-in', () => {
  const s = colony();
  assert.equal(rumbleTicks(s), 40);
  s.col[0].perks.push('cave_sense');
  assert.equal(rumbleTicks(s), 2 * TICKS_PER_HOUR);
  s.col[0].hp.dead = true;
  assert.equal(rumbleTicks(s), 40, 'only a living colonist sees the cracks');
});
test('social: lovers marry when the hold has a temple; everyone takes the wedding; spouses want one bed', () => {
  const s = colony();
  stopAll(s);
  const [a, b, c] = s.col;
  social.setKind(s, a.id, b.id, 'lover');
  social.addOpinion(s, a.id, b.id, 95);
  assert.equal(social.weddingVenue(s), 0, 'no venue yet');
  // a walled 3 x 3 shrine room next to the Hearth
  const hb = hearth(s);
  const at = findSite(s, hb.x + 6, hb.y, 5, 5, 1);
  const put = (def, x, y, mat) => completeBuilding(s, addBuilding(s, def, x, y, 0, mat || null));
  for (let x = at[0]; x < at[0] + 5; x++) for (const y of [at[1], at[1] + 4]) if (!(y === at[1] + 4 && x === at[0] + 2)) put('wall', x, y, 'wood');
  for (let y = at[1] + 1; y < at[1] + 4; y++) for (const x of [at[0], at[0] + 4]) put('wall', x, y, 'wood');
  put('door', at[0] + 2, at[1] + 4, 'wood');
  put('shrine', at[0] + 2, at[1] + 2);
  calm(s, 1);
  assert.ok(social.weddingVenue(s) > 0, 'the shrine room is a temple');
  let wed = false;
  for (let d = 0; d < 40 && !wed; d++) { s.tick += TICKS_PER_DAY - (s.tick % TICKS_PER_DAY) - 1; calm(s, 1); wed = social.kindOf(s, a.id, b.id) === 'spouse'; }
  assert.ok(wed, 'they married');
  assert.ok(mood.hasThought(a, 'married') && mood.hasThought(b, 'married') && mood.hasThought(c, 'wedding'));
  // a named artifact in the temple: whoever stands there feels "Treasure of the hold"
  spawn(s, 'figurine', null, 5, 1, at[0] + 1, at[1] + 1, { name: 'Ashsong', maker: a.id });
  let seen = false;
  for (let k = 0; k < TICKS_PER_HOUR + 5 && !seen; k++) { c.x = (at[0] + 3) * 32 + 16; c.y = (at[1] + 1) * 32 + 16; c.job = null; c.path = null; s.rt.res = rebuildFromJobs(s); tick(s); seen = mood.hasThought(c, 'treasure'); }
  assert.ok(seen, 'Treasure of the hold');
});
void joy;
