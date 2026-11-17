// Workstream F (people), Stage 0 skeletons and the first Stage 1a / 1b acceptance checks (14.5-14.7
// row F): XP(n) matches the 4.2 table; the daily cap counts 2,400 full-rate work ticks per skill per
// day; each role preset produces the expected priority array; a -20 thought moves mood 75% of the
// way within 30 game minutes; needs fall exactly; drafting releases claims; generation is seeded.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createColony } from '../../js/game/core/state.js';
import { step } from '../../js/game/core/sim.js';
import { resetBus, BUS } from '../../js/game/core/bus.js';
import { resetAppliers, applyCommand } from '../../js/game/core/commands.js';
import { newColonist, WORK_IDS, SKILL_IDS, FIX, PASSION } from '../../js/game/core/schema.js';
import { TICKS_PER_DAY } from '../../js/game/core/time.js';
import { ctrW, idx } from '../../js/game/core/grid.js';
import { installWork } from '../../js/game/work/index.js';
import { T, makeJob, keyTile } from '../../js/game/work/jobs.js';
import { beginJob } from '../../js/game/work/reserve.js';
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
