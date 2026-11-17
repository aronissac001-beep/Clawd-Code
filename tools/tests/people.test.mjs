// Workstream F (people), Stage 0 skeletons and the first Stage 1a / 1b acceptance checks (14.5-14.7
// row F): XP(n) matches the 4.2 table; the daily cap counts 2,400 full-rate work ticks per skill per
// day; each role preset produces the expected priority array; a -20 thought moves mood 75% of the
// way within 30 game minutes; needs fall exactly; drafting releases claims; generation is seeded.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createColony, initRuntime as initRt } from '../../js/game/core/state.js';
import { step } from '../../js/game/core/sim.js';
import { resetBus, BUS } from '../../js/game/core/bus.js';
import { resetAppliers, applyCommand } from '../../js/game/core/commands.js';
import { newColonist, WORK_IDS, SKILL_IDS, FIX, PASSION } from '../../js/game/core/schema.js';
import { TICKS_PER_DAY } from '../../js/game/core/time.js';
import { ctrW, idx } from '../../js/game/core/grid.js';
import { installWork } from '../../js/game/work/index.js';
import { T, makeJob, keyTile } from '../../js/game/work/jobs.js';
import { beginJob } from '../../js/game/work/reserve.js';
import { CONTENT } from '../../js/data/index.js';
import { installPeople, skills, roles, mood, needs, draft, colonists, health } from '../../js/game/people/index.js';

beforeEach(() => { resetBus(); resetAppliers(); installWork({ think: false, stubMove: true }); installPeople(); });

const world = (seed = 'F-1') => createColony(seed, { w: 32 });
const prio = (c) => Object.fromEntries(WORK_IDS.map((w, i) => [w, c.prio[i]]));

test('XP(n) and cumulative XP match the 4.2 table', () => {
  assert.deepEqual([5, 6, 10, 15, 20].map(skills.xpFor), [3780, 4838, 12987, 44621, 153318]);
  assert.deepEqual([5, 6, 10, 15, 20].map(skills.xpTotal), [12250, 17088, 54339, 198955, 695853]);
  assert.deepEqual([0, 10, 20].map(skills.speedPct), [60, 130, 200]);
});

test('daily soft cap: 2,400 full-rate ticks per skill per day, the rest at 20%', () => {
  const s = world();
  const c = newColonist(1, { at: [3, 2, 3] });         // Wits 2: learning 100%
  s.col.push(c);
  const i = SKILL_IDS.indexOf('mining');
  c.sk[i] = [0, 0, PASSION.KEEN, 0];
  skills.awardXp(s, c, 'mining', 6000);                 // a 10-hour shift on one skill
  assert.equal(c.sk[i][3], 6000);
  assert.equal(skills.xpTotal(c.sk[i][0]) * skills.XP_FIX + c.sk[i][1], 3120 * skills.XP_FIX);
  const j = SKILL_IDS.indexOf('masonry');
  c.sk[j] = [0, 0, PASSION.BURNING, 0];
  for (let t = 0; t < 2400; t++) skills.awardXp(s, c, 'masonry', 1);    // tick by tick equals one call
  assert.equal(skills.xpTotal(c.sk[j][0]) * skills.XP_FIX + c.sk[j][1], 3600 * skills.XP_FIX);
  c.sk[i][3] = 2400; s.tick = TICKS_PER_DAY; skills.skillsDaySystem(s);
  assert.equal(c.sk[i][3], 0, 'the counter resets at midnight');
});

test('role presets produce the expected priority arrays (5.1)', () => {
  const c = newColonist(1, { role: ['miner', null] });
  roles.applyRoles(null, c);
  assert.deepEqual(prio(c), { care: 4, animals: 4, cook: 4, build: 3, grow: 4, mine: 1, chop: 4, smith: 4, craft: 4, tailor: 4, art: 4, lore: 4, haul: 3 });
  c.role = ['builder', 'miner'];
  roles.applyRoles(null, c);
  assert.equal(c.prio[WORK_IDS.indexOf('build')], 1);
  assert.equal(c.prio[WORK_IDS.indexOf('mine')], 2, "the second role's 1 becomes 2");
  assert.equal(c.prio[WORK_IDS.indexOf('haul')], 2, 'keeps the better value');
  c.role = ['generalist', null];
  roles.applyRoles(null, c);
  assert.ok([...c.prio].every((p) => p === 3));
  c.bs = [null, 'crown_archivist'];
  roles.applyRoles(null, c);
  assert.equal(c.prio[WORK_IDS.indexOf('mine')], 0, 'backstory disables Mine');
  assert.equal(c.prio[WORK_IDS.indexOf('haul')], 0, 'backstory disables Haul');
  c.sk[SKILL_IDS.indexOf('medicine')][0] = 6; c.role = ['miner', null];
  roles.applyRoles(null, c);
  assert.equal(c.prio[WORK_IDS.indexOf('care')], 2, 'Medicine 6+ puts Care at 2');
  c.custom = true; c.prio[0] = 1; roles.applyRoles(null, c);
  assert.equal(c.prio[0], 1, 'custom priorities are not recomputed');
});

test('role and prio commands apply through C3', () => {
  const s = world();
  s.col.push(newColonist(1)); s.next.col = 2;
  assert.ok(applyCommand(s, { t: 'role', colId: 1, primary: 'miner' }).ok);
  assert.equal(s.col[0].prio[WORK_IDS.indexOf('mine')], 1);
  assert.ok(applyCommand(s, { t: 'prio', colId: 1, work: 'art', p: 1 }).ok);
  assert.equal(s.col[0].custom, true);
});

test('a -20 thought moves mood 75% of the way within 30 game minutes', () => {
  resetBus(); installPeople({ mood: true });
  const s = world();
  const c = newColonist(1, { mood: 50 * FIX }); s.col.push(c);
  c.thoughts.push(['hearth_cold', -1, 1]);              // -15 condition thought (the sample data's largest)
  const target = mood.moodTarget(s, c);
  step(s, 300);                                          // 30 game minutes
  const moved = (50 * FIX - c.mood) / (50 * FIX - target);
  assert.ok(moved >= 0.75, `moved ${moved}`);
  assert.equal(mood.smoothStep(5000, 3000), 4500);
  assert.equal(mood.smoothStep(5000, 4999), 4999, 'at least 1');
});

test('needs fall exactly: floor(rate x ticks / day) at every update', () => {
  resetBus(); installPeople({ needs: true });
  const s = world();
  for (let id = 1; id <= 3; id++) s.col.push(newColonist(id));
  step(s, TICKS_PER_DAY);
  for (const c of s.col) {
    const last = TICKS_PER_DAY - ((TICKS_PER_DAY - c.id) % 20 + 20) % 20;   // this colonist's last update tick
    assert.equal(80 * FIX - c.need[needs.NEED.food], Math.floor((needs.fallPerDay(c, 'food') * last) / TICKS_PER_DAY));
  }
  step(s, 20);
  for (const c of s.col) assert.ok(80 * FIX - c.need[needs.NEED.food] >= needs.fallPerDay(c, 'food'), 'a whole day removes the whole fall');
});

test('drafting ends the job through endJob and releases its claims', () => {
  const s = world();
  const c = newColonist(1, { x: ctrW(2), y: ctrW(2) }); s.col.push(c);
  const i = idx(10, 10);
  assert.ok(beginJob(s, c, makeJob('test', keyTile(i), [T.goto(i), T.work(100)]), [[keyTile(i), 0]]));
  assert.ok(s.rt.res.has(keyTile(i)));
  assert.ok(applyCommand(s, { t: 'draft', colIds: [1], on: true }).ok);
  assert.equal(c.drafted, true); assert.equal(c.job, null); assert.equal(s.rt.res.size, 0);
  assert.ok(applyCommand(s, { t: 'draft', colIds: [1], on: false }).ok);
  assert.ok(s.rt.thinkQ.includes(1));
  c.hp.down = true;
  assert.equal(draft.setDrafted(s, c, true), 'they are downed');
});

test('damage, downed and death go through the health API and BUS.kill', () => {
  const s = world();
  const c = newColonist(1); s.col.push(c);
  let killed = 0; BUS.kill.push(() => killed++);
  health.damage(s, c, 'larm', 'cut', 15);
  assert.equal(c.hp.parts[2], 5); assert.equal(c.hp.wounds.length, 1);
  health.damage(s, c, 'head', 'blunt', 30);
  assert.equal(c.hp.dead, true); assert.equal(killed, 1);
  assert.ok(s.rt.events.some((e) => e.name === 'died' && e.data.id === 1));
});

test('colonist generation is seeded and follows the 4.1 rules', () => {
  const a = world('GEN'), b = world('GEN');
  const ba = colonists.startingBand(a, 'hearthwatch'), bb = colonists.startingBand(b, 'hearthwatch');
  assert.deepEqual(JSON.stringify(ba.map((c) => [c.name, c.sk, c.traits, c.at])), JSON.stringify(bb.map((c) => [c.name, c.sk, c.traits, c.at])));
  assert.equal(ba.length, 3);
  assert.ok(ba[0].sk[SKILL_IDS.indexOf('construction')][0] >= 6, 'the first slot needs Construction 6+');
  for (const c of ba) {
    const sum = c.at[0] + c.at[1] + c.at[2];
    assert.ok(sum >= 8 && sum <= 10);
    assert.ok(!(c.traits.includes('lazy') && c.traits.includes('hardworking')));
    const passions = c.sk.filter((x) => x[2] > 0).length;
    assert.ok(passions >= 3 && passions <= 5, `human passions ${passions}`);
  }
  for (const c of ba) colonists.spawnColonist(a, c, 4, 4);
  assert.deepEqual(a.col.map((c) => c.id), [1, 2, 3]);
});

// ---- Stage 1a (14.6 row F) with the slice data ---------------------------------------------------
const expected = {
  miner: { care: 4, animals: 4, cook: 4, build: 3, grow: 4, mine: 1, chop: 4, smith: 4, craft: 4, tailor: 4, art: 4, lore: 4, haul: 3 },
  builder: { care: 4, animals: 4, cook: 4, build: 1, grow: 4, mine: 4, chop: 3, smith: 4, craft: 4, tailor: 4, art: 4, lore: 4, haul: 2 },
  crafter: { care: 4, animals: 4, cook: 4, build: 4, grow: 4, mine: 4, chop: 4, smith: 4, craft: 1, tailor: 1, art: 4, lore: 4, haul: 3 },
  hauler: { care: 4, animals: 4, cook: 4, build: 3, grow: 4, mine: 4, chop: 3, smith: 4, craft: 4, tailor: 4, art: 4, lore: 4, haul: 1 },
  generalist: Object.fromEntries(WORK_IDS.map((w) => [w, 3])),
};

test('each 1a role preset produces the expected priority array, alone and as a second role', () => {
  for (const [id, want] of Object.entries(expected)) {
    const c = newColonist(1, { role: [id, null] });
    roles.applyRoles(null, c);
    assert.deepEqual(prio(c), want, id);
  }
  const c = newColonist(1, { role: ['miner', 'crafter'] });
  roles.applyRoles(null, c);
  assert.deepEqual(prio(c), { ...expected.miner, craft: 2, tailor: 2 }, "miner + crafter: the second role's 1s become 2s");
  c.role = ['hauler', 'builder']; roles.applyRoles(null, c);
  assert.deepEqual(prio(c), { ...expected.hauler, build: 2 }, "hauler + builder: build 2, haul stays 1, chop keeps 3");
  c.role = ['crafter', 'generalist']; roles.applyRoles(null, c);
  assert.deepEqual(prio(c), Object.fromEntries(WORK_IDS.map((w) => [w, ['craft', 'tailor'].includes(w) ? 1 : w === 'haul' ? 3 : 4])),
    "a second generalist (all 3) lowers nothing below the crafter's own values");
});

test('Quick Learner learns x1.4, Wits adds 8% a point, passions scale XP; levels emit rankUp at 6', () => {
  const s = world();
  const mk = (traits, at = [3, 2, 3]) => { const c = newColonist(s.col.length + 1, { traits, at }); s.col.push(c); return c; };
  const i = SKILL_IDS.indexOf('mining');
  const plain = mk([]), quick = mk(['quick_learner']), wits4 = mk([], [3, 4, 3]);
  for (const c of [plain, quick, wits4]) c.sk[i] = [0, 0, PASSION.KEEN, 0];
  for (const c of [plain, quick, wits4]) skills.awardXp(s, c, 'mining', 1000);
  const total = (c) => skills.xpTotal(c.sk[i][0]) * skills.XP_FIX + c.sk[i][1];
  assert.equal(total(plain), 1000 * skills.XP_FIX);
  assert.equal(total(quick), 1400 * skills.XP_FIX);
  assert.equal(total(wits4), 1160 * skills.XP_FIX);
  const none = mk([]); none.sk[i] = [0, 0, PASSION.NONE, 0];
  skills.awardXp(s, none, 'mining', 1000);
  assert.equal(total(none), 500 * skills.XP_FIX, 'no passion: x0.5');
  const c = mk([]); c.sk[i] = [5, skills.xpFor(6) * skills.XP_FIX - 50, PASSION.KEEN, 0];
  assert.equal(skills.awardXp(s, c, 'mining', 1), 1);
  assert.equal(c.sk[i][0], 6);
  assert.ok(s.rt.events.some((e) => e.name === 'rankUp' && e.data.colId === c.id && e.data.lvl === 6));
  c.sk[i] = [20, 0, PASSION.KEEN, 0];
  assert.equal(skills.awardXp(s, c, 'mining', 5000), 0, 'level 20 is the cap');
});

test('work speed: level curve, Might for mining, Hardworking / Lazy, darkness unless Dark-sighted', () => {
  const s = createColony('F-SPD', { w: 32 });
  initRt(s);
  const c = newColonist(1, { x: ctrW(4), y: ctrW(4), at: [2, 3, 3] }); s.col.push(c);
  const mine = { sk: 'mining' }, build = { sk: 'construction' };
  c.sk[SKILL_IDS.indexOf('mining')][0] = 10; c.sk[SKILL_IDS.indexOf('construction')][0] = 0;
  s.rt.light[idx(4, 4)] = 2;
  assert.equal(skills.workSpeed(s, c, mine), 130);
  assert.equal(skills.workSpeed(s, c, build), 60);
  c.at[0] = 5; assert.equal(skills.workSpeed(s, c, mine), Math.floor(130 * 109 / 100), 'Might 5: +9% mining');
  assert.equal(skills.workSpeed(s, c, build), 60, 'Might does not speed building');
  c.at[0] = 2; c.traits = ['hardworking']; assert.equal(skills.workSpeed(s, c, mine), Math.floor(130 * 115 / 100));
  c.traits = ['lazy']; assert.equal(skills.workSpeed(s, c, mine), Math.floor(130 * 85 / 100));
  c.traits = []; s.rt.light[idx(4, 4)] = 0;
  assert.equal(skills.workSpeed(s, c, mine), 104, 'darkness: 80%');
  c.traits = ['dark_sighted']; assert.equal(skills.workSpeed(s, c, mine), 130, 'Dark-sighted: no penalty');
});

test('the Hearthwatch Remnant band: 3 Humans, one with Construction 6+, 1a looks, traits and roles from data', () => {
  const ids = new Set(['hardworking', 'lazy', 'quick_learner', 'dark_sighted']);
  let builders = 0, granted = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const s = world(seed);
    const band = colonists.startingBand(s, 'hearthwatch');
    assert.equal(band.length, 3);
    assert.ok(band[0].sk[SKILL_IDS.indexOf('construction')][0] >= 6, `seed ${seed}: Construction 6+`);
    for (const c of band) {
      assert.equal(c.anc, 'human');
      assert.ok(c.look.hair >= 0 && c.look.hair < 4 && c.look.hairC < 6 && c.look.cloth < 6, `look ${JSON.stringify(c.look)}`);
      assert.ok(c.traits.length >= 1 && c.traits.length <= 3 && c.traits.every((t) => ids.has(t)), `traits ${c.traits}`);
      assert.ok(!(c.traits.includes('lazy') && c.traits.includes('hardworking')));
      assert.ok(['miner', 'builder', 'crafter', 'hauler', 'generalist'].includes(c.role[0]));
      assert.deepEqual([...c.prio], [...roles.computePrio(c)], 'priorities are computed from the role');
      const best = Math.max(...c.sk.map((x) => x[0]));
      assert.ok(best >= 4 && best <= 14, `best skill ${best}`);
      if (c.role[0] === 'builder') builders++;
      for (const b of c.bs) { const t = { mine_born: 1, smithy_sweep: 1, kitchen_drudge: 1, noble_ward: 1, cave_finder: 1, weaver_child: 1, deep_prospector: 1, farmhand: 1, idle_heir: 1 }[b]; if (t) granted++; }
    }
  }
  assert.ok(builders > 0 && granted > 0);
});

test('a backstory trait is granted unless an exclusive partner is already rolled', () => {
  const t = ['lazy'];
  assert.equal(colonists.grantTrait(t, 'hardworking'), false);
  assert.equal(colonists.grantTrait(t, 'dark_sighted'), true);
  assert.equal(colonists.grantTrait(t, 'dark_sighted'), false, 'no duplicates');
  assert.equal(colonists.grantTrait(t, 'quick_learner'), true);
  assert.equal(colonists.grantTrait(['lazy', 'dark_sighted', 'quick_learner'], 'hardworking'), false, 'at most 3');
});

test('suggested role: the best passion skill with a 1a role, else the next one, else Generalist', () => {
  const c = newColonist(1);
  const R = (ids) => roles.suggestRole(c, CONTENT.all('role'), ids);
  assert.equal(R(['mining']), 'miner');
  assert.equal(R(['archery', 'masonry']), 'crafter', 'no 1a role uses Archery: the next passion decides');
  assert.equal(R(['social', 'melee']), 'generalist');
  assert.equal(R('construction'), 'builder');
});
