// Stage 2 integration fixes (X, 2.7): the rules the balance and play-test pass changed, one test each.
// - the tainted, infected or badly ill rest in bed (taint falls only in bed), and patients doze there
// - a Hearth under a day of fuel is refuelled before other work by anyone with Haul enabled
// - storage buildings (granary ...) are walked into, so food stored in one can be eaten
// - a migrant group asks to join the day after a tier-up; refugees' pursuers keep the 2-day gap
// - the Chronicle names the cause of a death; new bills fetch from anywhere
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installSim, foundColony, findSite } from '../../js/game/core/setup.js';
import { tick } from '../../js/game/core/sim.js';
import { FIX, WORK_IDS, newBill } from '../../js/game/core/schema.js';
import { TICKS_PER_HOUR, TICKS_PER_DAY } from '../../js/game/core/time.js';
import { addBuilding } from '../../js/game/core/apply.js';
import { completeBuilding } from '../../js/game/work/construct.js';
import { spawn } from '../../js/game/work/items.js';
import { rebuildFromJobs } from '../../js/game/work/reserve.js';
import { think } from '../../js/game/work/think.js';
import { URGENT_REFUEL_GIVER } from '../../js/game/work/givers/refuel.js';
import { hearthFuelDays } from '../../js/game/world/fuel.js';
import { foodFor } from '../../js/game/people/needjobs.js';
import { kill } from '../../js/game/people/health.js';
import { chronLine } from '../../js/game/colony/chronicle.js';
import { CONTENT } from '../../js/data/index.js';
import { idx } from '../../js/game/core/grid.js';

function colony(seed = 'X-2') {
  installSim({ stage: '2', reset: true, checks: true });
  return foundColony({ seed, name: 'X Hold' });
}
const hearth = (s) => s.bld[s.colony.hearth.id];
function built(s, defId, dx = 4, dy = 4) {
  const hb = hearth(s), d = CONTENT.get('structure', defId);
  const at = findSite(s, hb.x + dx, hb.y + dy, d.size[0], d.size[1], 1);
  const b = addBuilding(s, defId, at[0], at[1], 0, null);
  completeBuilding(s, b);
  return b;
}
/** Step n ticks with the storyteller quiet (no raids in these scenes). */
function calm(s, n, every = () => {}) { for (let k = 0; k < n; k++) { if (s.tick % 600 === 0) s.st.queue.length = 0; tick(s); every(); } }
const HAUL = WORK_IDS.indexOf('haul');

test('a tainted colonist who can walk rests in bed, and the taint falls there', () => {
  const s = colony();
  const c = s.col[0];
  for (const o of s.col) if (o !== c) { o.custom = true; o.prio = new Uint8Array(WORK_IDS.length); }
  built(s, 'bed', 3, 3);
  c.hp.taint = 30 * FIX;
  c.job = null; s.rt.res = rebuildFromJobs(s);
  let rested = 0;
  calm(s, 12 * TICKS_PER_HOUR, () => { if (c.job && c.job.type === 'bedrest') rested++; });
  assert.ok(rested > 6 * TICKS_PER_HOUR, `in bed rest ${rested} of 12 h of ticks`);
  assert.ok(c.hp.taint < 30 * FIX, `taint ${c.hp.taint / FIX} fell below 30`);
  assert.ok(!c.hp.dead);
});

test('a Hearth under a day of fuel is refuelled first, by anyone with Haul enabled', () => {
  const s = colony();
  const hb = hearth(s);
  s.colony.hearth.fuel = Math.floor(TICKS_PER_DAY / 2);
  assert.ok(hearthFuelDays(s) < 1);
  spawn(s, 'wood', null, 0, 30, hb.x + 4, hb.y);
  const c = s.col[0];
  c.custom = true; c.prio = new Uint8Array(WORK_IDS.length); c.prio[HAUL] = 4;   // haul last of all
  c.job = null; s.rt.res = rebuildFromJobs(s);
  assert.equal(URGENT_REFUEL_GIVER.candidates(s, c, 4).length, 1, 'the Hearth is an urgent target');
  think(s, c);
  assert.ok(c.job && c.job.type === 'refuel' && c.job.giver === 'urgentRefuel', `job ${c.job && c.job.type}/${c.job && c.job.giver}`);
  s.colony.hearth.fuel = 2 * TICKS_PER_DAY;
  assert.equal(URGENT_REFUEL_GIVER.candidates(s, c, 4).length, 0, 'not urgent above a day');
});

test('storage buildings are walked into: food stored in the middle of a granary can be eaten', () => {
  const s = colony();
  const g = built(s, 'granary', 5, 5);
  const mid = idx(g.x + 1, g.y + 1);
  assert.notEqual(s.rt.walkCost[mid], 0, 'the granary does not block');
  for (const it of s.items) if (it && CONTENT.get('item', it.k) && CONTENT.get('item', it.k).food) it.f = true;   // only the granary's food
  spawn(s, 'hearthroot', null, 0, 20, g.x + 1, g.y + 1);
  const f = foodFor(s, s.col[0]);
  assert.ok(f && f.k === 'hearthroot' && f.x === g.x + 1 && f.y === g.y + 1, 'the stored hearthroot is the food found');
});

test('a migrant group asks to join the day after a tier-up', () => {
  const s = colony();
  calm(s, TICKS_PER_HOUR);
  s.colony.tier = 1;
  for (let k = 0; k < TICKS_PER_HOUR; k++) tick(s);
  const e = s.st.queue.find((x) => x.inc === 'migrants');
  assert.ok(e, 'a migrants entry is queued');
  assert.equal(Math.floor(e.arriveTick / TICKS_PER_DAY), Math.floor(s.tick / TICKS_PER_DAY) + 1, 'it comes the next day');
  for (let k = 0; k < TICKS_PER_HOUR; k++) tick(s);
  assert.equal(s.st.queue.filter((x) => x.inc === 'migrants').length, 1, 'once per tier');
});

test('the Chronicle names the cause of a death; old lines without one still read', () => {
  const s = colony();
  const c = s.col[0];
  kill(s, c, 'taint', null);
  const e = s.chron.filter((x) => x[1] === 'death').pop();
  assert.equal(chronLine(e), `${c.name} died of the Grey Taint.`);
  assert.equal(chronLine([0, 'death', 'chron_death', { name: 'Bryn' }]), 'Bryn died.');
});

test('new bills fetch their ingredients from anywhere', () => {
  assert.equal(newBill('smelt_iron').radius, 999);
});

test('a downed colonist is rescued by anyone, and a bleeding patient tended by anyone (no Care enabled)', async () => {
  const { URGENT_RESCUE_GIVER, URGENT_TEND_GIVER } = await import('../../js/game/work/givers/care.js');
  const { damage } = await import('../../js/game/people/health.js');
  const s = colony();
  built(s, 'bed', 3, 3);
  const [p, helper] = s.col;
  for (const o of s.col) { o.custom = true; o.prio = new Uint8Array(WORK_IDS.length); o.prio[HAUL] = 1; o.job = null; }
  s.rt.res = rebuildFromJobs(s);
  p.hp.down = true;   // downed out of bed
  assert.equal(URGENT_RESCUE_GIVER.candidates(s, helper, 4).length >= 1, true, 'the downed colonist is an urgent rescue');
  think(s, helper);
  assert.ok(helper.job && helper.job.giver === 'urgentRescue', `job ${helper.job && helper.job.giver}`);
  // a bleeding patient in bed: tended by the helper even with Care off
  calm(s, 3 * TICKS_PER_HOUR);
  p.hp.down = false;
  damage(s, p, 1, 'cut', 8, null);
  assert.ok(p.hp.wounds.some((w) => w.bleed > 0 && w.tended === 0));
  let tended = false;
  calm(s, 6 * TICKS_PER_HOUR, () => { if (!tended && p.hp.wounds.every((w) => w.tended > 0 || w.bleed === 0)) tended = true; });
  assert.ok(tended, 'the bleeding stopped');
  assert.equal(URGENT_TEND_GIVER.candidates(s, helper, 4).length, 0, 'no urgent tend once nothing bleeds');
});
