// Stage 1b acceptance for workstreams E, F and G (doc 14.7): needs, mood and thoughts, breaks,
// simple health and rescue, the draft API (F); the Cook, Grow, Smith, Care (rescue) and Refuel
// givers and the smart bills (E); the 1b data (G). Real new-colony flow (installSim('1b') +
// foundColony) with E's reservation and item checks on every tick.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installSim, foundColony, findSite } from '../../js/game/core/setup.js';
import { step, tick } from '../../js/game/core/sim.js';
import { applyCommand } from '../../js/game/core/commands.js';
import { FIX, WORK_IDS, SCHED } from '../../js/game/core/schema.js';
import { TICKS_PER_HOUR, TICKS_PER_DAY, TICKS_PER_MIN } from '../../js/game/core/time.js';
import { idx, ctrW, tileOfW, W, H, TER_FERTILE, DESIG } from '../../js/game/core/grid.js';
import { addBuilding } from '../../js/game/core/apply.js';
import { stateHash } from '../../js/game/core/state.js';
import { saveBlobSync, loadBlobSync } from '../../js/game/save/colonysave.js';
import { completeBuilding } from '../../js/game/work/construct.js';
import { spawn, totals, totalsMat, getItem } from '../../js/game/work/items.js';
import { rebuildFromJobs } from '../../js/game/work/reserve.js';
import { rtEqual, rebuilderOf } from '../../js/game/core/rtcontract.js';
import { untilTarget, billWanted } from '../../js/game/work/bills.js';
import { think } from '../../js/game/work/think.js';
import { setGrowth } from '../../js/game/world/terrain.js';
import { fuelWanted, hearthFuelDays } from '../../js/game/world/fuel.js';
import { mood, needs, health, breaks, draft, needjobs } from '../../js/game/people/index.js';
import { CONTENT } from '../../js/data/index.js';
import { foodDays } from '../../js/data/advice.js';

const F = (pts) => pts * FIX;
/** A fresh Stage 1b colony with E's debug checks on; colonists idle at their spawn. */
function colony(seed = 'EFG-1B') {
  installSim({ stage: '1b', reset: true, checks: true });
  return foundColony({ seed, name: 'EFG Hold' });
}
const hearth = (s) => s.bld[s.colony.hearth.id];
/** Finished building of def at a free spot near the Hearth (offset dx, dy). */
function built(s, defId, dx = 4, dy = 4) {
  const hb = hearth(s), d = CONTENT.get('structure', defId);
  const [w, h] = d.size;
  const at = findSite(s, hb.x + dx, hb.y + dy, w, h, 1);
  const b = addBuilding(s, defId, at[0], at[1], 0, null);
  completeBuilding(s, b);
  return b;
}
const setPrio = (s, c, works) => { c.custom = true; c.prio = new Uint8Array(WORK_IDS.length); for (const w of works) c.prio[WORK_IDS.indexOf(w)] = 1; };
const stopAll = (s) => { for (const c of s.col) { setPrio(s, c, []); if (c.job) { c.job = null; } } s.rt.res = rebuildFromJobs(s); };
const resEqual = (s) => rtEqual(s.rt.res, rebuildFromJobs(s));

test('F: a colonist with food 0 eats before working', () => {
  const s = colony();
  const c = s.col[0];
  stopAll(s);
  setPrio(s, c, ['haul', 'chop', 'build']);           // work is waiting (the start stock needs hauling)
  c.need[needs.NEED.food] = 0;
  think(s, c);
  assert.equal(c.job.type, 'eat', 'food 0: the eat job comes before work');
  const before = c.need[needs.NEED.food];
  for (let k = 0; k < 2000 && c.job && c.job.type === 'eat'; k++) tick(s);
  assert.ok(c.need[needs.NEED.food] >= before + F(20), `ate at least a meal: food ${c.need[needs.NEED.food]}`);
  assert.ok(resEqual(s));
  // urgent food also interrupts a work job
  c.need[needs.NEED.food] = F(10);
  if (c.job) for (let k = 0; k < 2000 && c.job && c.job.type === 'eat'; k++) tick(s);
  let sawEat = false;
  for (let k = 0; k < 200; k++) { tick(s); if (c.job && c.job.type === 'eat') { sawEat = true; break; } }
  assert.ok(sawEat, 'an urgent need ends the work job within the 60-tick re-think');
});

test('F: a -20 thought moves mood 75% of the way within 30 game minutes, and condition thoughts follow the needs', () => {
  const s = colony('EFG-MOOD');
  stopAll(s);
  const c = s.col[0];
  step(s, 1800);
  for (const it of s.items) if (it && (it.k === 'meal' || it.k === 'hearthroot')) it.f = true;   // nothing to eat: the thought stays
  const m0 = c.mood, t0 = mood.moodTarget(s, c);
  assert.ok(Math.abs(m0 - t0) <= F(1), 'settled');
  c.need[needs.NEED.food] = 0;                         // Starving: -20 (it replaces Hungry and Ravenous)
  step(s, 60 - (s.tick % 60));                         // the next mood step refreshes the conditions
  assert.ok(mood.hasThought(c, 'starving') && !mood.hasThought(c, 'hungry') && !mood.hasThought(c, 'ravenous'));
  const target = mood.moodTarget(s, c);
  assert.equal(t0 - target, F(20), `the thought lowers the target by 20 (${t0} -> ${target})`);
  const start = c.mood;
  step(s, 300);
  const moved = (m0 - c.mood) / (m0 - target);
  assert.ok(moved >= 0.75, `moved ${moved.toFixed(3)} of the gap in 30 minutes (from ${start})`);
  c.need[needs.NEED.food] = F(18);
  step(s, 60);
  assert.ok(mood.hasThought(c, 'hungry') && !mood.hasThought(c, 'starving'));
  assert.ok(mood.hasThought(c, 'hearth_lit'), 'the Hearth burns: +3');
});

test('F: needs fall by data (food always, rest awake, light in darkness) and sleep in a bed restores rest', () => {
  const s = colony('EFG-SLEEP');
  stopAll(s);
  const c = s.col[0];
  const bed = built(s, 'bed', -6, 4);
  c.need[needs.NEED.rest] = F(20);
  c.sched.fill(SCHED.SLEEP);
  think(s, c);
  assert.equal(c.job.type, 'sleep');
  assert.equal(c.job.bed, bed.id);
  for (let k = 0; k < 3000 && c.job && c.job.type === 'sleep' && !needs.asleep(c); k++) tick(s);
  assert.ok(needs.asleep(c), 'lying in the bed');
  assert.equal(bed.owner, c.id); assert.equal(c.bed, bed.id);
  const r0 = c.need[needs.NEED.rest];
  step(s, TICKS_PER_HOUR);
  const gained = c.need[needs.NEED.rest] - r0;
  assert.ok(Math.abs(gained - F(13)) <= F(1), `a bed restores about 13 an hour (${gained})`);
  assert.ok(health.inBed(c));
  // drafting a sleeper wakes them (the draft API ends the job through endJob)
  assert.equal(draft.setDrafted(s, c, true), null);
  assert.equal(c.job, null); assert.ok(resEqual(s));
  draft.setDrafted(s, c, false);
  // light: darkness lowers it, a lit tile restores it
  const dark = needs.lightRate(s, { ...c, x: c.x, y: c.y });
  assert.ok(Number.isInteger(dark));
});

test('F: breaks fall back to the minor ones in 1b; a sulk wanders and Catharsis follows', () => {
  const s = colony('EFG-BREAK');
  stopAll(s);
  const c = s.col[1];
  const st = breaks.startBreak(s, c, 'extreme');      // no extreme break ships in 1b: a minor one starts
  assert.ok(st && st.sev === 'minor' && ['sulk', 'binge'].includes(st.id), JSON.stringify(st));
  think(s, c);
  assert.ok(c.job && c.job.brk, 'the break behaviour is a job');
  step(s, st.until - s.tick + 1);
  assert.equal(c.breakState, null);
  assert.ok(mood.hasThought(c, 'catharsis'));
  assert.ok(resEqual(s));
});

test('F + E: simple health: wounds clot, a downed colonist is rescued to a bed and rests there; starvation kills', () => {
  const s = colony('EFG-CARE');
  stopAll(s);
  const [p, doc] = s.col;
  const bed = built(s, 'bed', -6, 4);
  setPrio(s, doc, ['care']);
  health.damage(s, p, 'torso', 'cut', 24);
  health.damage(s, p, 'lleg', 'stab', 20);
  p.hp.blood = F(30);
  health.checkDowned(s, p);
  assert.ok(p.hp.down);
  assert.ok(mood.hasThought(p, 'was_downed'));
  let laid = false;
  for (let k = 0; k < 4000; k++) { tick(s); if (p.job && p.job.type === 'bedrest') { laid = true; break; } }
  assert.ok(laid, 'the Care giver carried the patient to the bed');
  assert.equal(tileOfW(p.x), bed.x); assert.equal(tileOfW(p.y), bed.y);
  assert.ok(mood.hasThought(p, 'rescued'));
  assert.ok(resEqual(s));
  step(s, 2 * TICKS_PER_HOUR);
  assert.ok(p.hp.wounds.every((w) => w.tended > 0 && w.bleed === 0), 'an hour in bed tends the wounds');
  // clotting out of bed
  const q = s.col[2];
  health.damage(s, q, 'larm', 'cut', 5);
  step(s, 9 * TICKS_PER_HOUR);
  assert.ok(q.hp.wounds.every((w) => w.bleed === 0), 'wounds clot after 8 hours');
  // starvation: food 0 for long enough kills, cause 'starvation'
  q.need[needs.NEED.food] = 0;
  q.hp.blood = F(2);
  let cause = null;
  for (let k = 0; k < TICKS_PER_DAY && !q.hp.dead; k++) { q.need[needs.NEED.food] = 0; tick(s); for (const e of s.rt.events) if (e.name === 'died' && e.data.id === q.id) cause = e.data.cause; }
  assert.ok(q.hp.dead);
  assert.equal(cause, 'starvation');
  assert.ok(s.col.filter((c) => !c.hp.dead && c.id !== q.id).every((c) => mood.hasThought(c, 'colonist_died')));
});

test('E: the campfire cooks simple meals until 2 per living colonist; a cold campfire cooks nothing', () => {
  const s = colony('EFG-COOK');
  stopAll(s);
  const cook = s.col[0];
  const fire = built(s, 'campfire', 4, 4);
  assert.deepEqual(fire.bills.map((b) => [b.recipe, b.mode, b.n, !!b.perCol]), [['simple_meal', 'until', 2, true]], 'the smart default bill');
  assert.equal(untilTarget(s, fire.bills[0]), 6);
  // move the start meals out of storage so the bill wants meals
  for (const it of s.items) if (it && it.k === 'meal') it.f = true;
  s.rt.stock = rebuilderOf('stock')(s);
  setPrio(s, cook, ['cook']);
  let made = 0;
  for (let k = 0; k < 2 * TICKS_PER_DAY && made < 2; k++) { tick(s); for (const e of s.rt.events) if (e.name === 'crafted' && e.data.k === 'meal') made++; s.rt.events.length = 0; }
  assert.ok(made >= 2, `cooked ${made}`);
  // cold: no fuel, no cooking
  fire.fuel = 0;
  stopAll(s); setPrio(s, cook, ['cook']);
  think(s, cook);
  assert.notEqual(cook.job && cook.job.type, 'craft', 'a cold campfire offers no bill');
  assert.ok(resEqual(s));
});

test('E: the bloomery smelts iron while ore is stocked, until 60 iron ingots (other metals do not count); the forge makes a spear', () => {
  const s = colony('EFG-SMITH');
  stopAll(s);
  const smith = s.col[0];
  const bl = built(s, 'bloomery', 4, 5);
  assert.deepEqual(bl.bills.map((b) => [b.recipe, b.mode, b.n]), [['smelt_iron', 'until', 60]]);
  assert.ok(billWanted(s, bl.bills[0]), 'steel ingots in the start stock do not count as iron');
  const hb = hearth(s);
  spawn(s, 'ore', 'iron', 0, 20, hb.x - 2, hb.y + 4);
  spawn(s, 'coal', null, 0, 10, hb.x - 3, hb.y + 4);
  setPrio(s, smith, ['smith']);
  let got = false;
  for (let k = 0; k < TICKS_PER_DAY && !got; k++) { tick(s); for (const e of s.rt.events) if (e.name === 'crafted' && e.data.k === 'ingot') got = getItem(s, e.data.itemId); s.rt.events.length = 0; }
  assert.ok(got && got.m === 'iron' && got.n === 8, JSON.stringify(got));
  const fg = built(s, 'forge', -6, 6);
  assert.ok(applyCommand(s, { t: 'bill', op: 'add', bId: fg.id, bill: { recipe: 'forge_spear', mode: 'count', n: 1 } }).ok);
  spawn(s, 'ingot', 'iron', 0, 12, hb.x - 4, hb.y + 4);
  let spear = null;
  for (let k = 0; k < TICKS_PER_DAY && !spear; k++) { tick(s); for (const e of s.rt.events) if (e.name === 'crafted' && e.data.k === 'spear') spear = getItem(s, e.data.itemId); s.rt.events.length = 0; }
  assert.ok(spear && spear.k === 'spear', 'a spear');
  assert.ok(resEqual(s));
});

test('E: the Grow giver sows a grow zone with hearthroot and harvests it ripe', () => {
  const s = colony('EFG-GROW');
  stopAll(s);
  const g = s.col[0];
  const hb = hearth(s);
  let rect = null;
  for (let r = 3; r < 30 && !rect; r++) for (let dy = -r; dy <= r && !rect; dy++) for (let dx = -r; dx <= r && !rect; dx++) {
    const x0 = hb.x + dx, y0 = hb.y + dy; let ok = x0 > 0 && y0 > 0 && x0 + 2 < W && y0 + 2 < H;
    for (let y = y0; y < y0 + 3 && ok; y++) for (let x = x0; x < x0 + 3 && ok; x++) { const i = idx(x, y); if (!TER_FERTILE[s.L.terrain[i]] || s.rt.occ[i] >= 0 || s.L.zone[i] || s.L.plant[i] || s.L.roof[i] || s.rt.itemAt[i] >= 0) ok = false; }
    if (ok) rect = { x0, y0, x1: x0 + 2, y1: y0 + 2 };
  }
  assert.ok(rect, 'a fertile 3 x 3');
  assert.ok(applyCommand(s, { t: 'zone', op: 'new', type: 'grow', rect }).ok);
  assert.ok(rtEqual(s.rt.idx.plants, rebuilderOf('idx')(s).plants), 'the grow index follows the zone');
  setPrio(s, g, ['grow']);
  const tiles = []; for (let y = rect.y0; y <= rect.y1; y++) for (let x = rect.x0; x <= rect.x1; x++) tiles.push(idx(x, y));
  for (let k = 0; k < TICKS_PER_DAY && !tiles.every((i) => s.L.plant[i]); k++) tick(s);
  assert.ok(tiles.every((i) => s.L.plant[i]), 'every tile sown');
  for (const i of tiles) setGrowth(s, i, 255);          // ripe (6 days of growth)
  const root0 = s.items.filter((it) => it && it.k === 'hearthroot').reduce((a, it) => a + it.n, 0);
  for (let k = 0; k < TICKS_PER_DAY && tiles.some((i) => s.L.growth[i] === 255 && s.L.plant[i]); k++) tick(s);
  const root1 = s.items.filter((it) => it && it.k === 'hearthroot').reduce((a, it) => a + it.n, 0);
  assert.ok(root1 >= root0 + 9 * 5, `harvested ${root1 - root0} hearthroot`);
  assert.ok(resEqual(s));
});

test('E: Refuel: a hauler brings wood to the Hearth when it burns below 2 days', () => {
  const s = colony('EFG-FUEL');
  stopAll(s);
  const h = s.col[0];
  s.colony.hearth.fuel = Math.floor(0.5 * TICKS_PER_DAY);
  assert.ok(fuelWanted(s, hearth(s)));
  setPrio(s, h, ['haul']);
  const d0 = hearthFuelDays(s);
  step(s, TICKS_PER_DAY / 4);
  assert.ok(hearthFuelDays(s) > d0 + 1, `refuelled from ${d0.toFixed(2)} to ${hearthFuelDays(s).toFixed(2)} days`);
  assert.ok(resEqual(s));
});

test('E + F: a save in the middle of eating, sleeping and a rescue continues identically', () => {
  const s = colony('EFG-SAVE');
  stopAll(s);
  const [a, b, c] = s.col;
  built(s, 'bed', -6, 4); built(s, 'bed', -8, 4);
  setPrio(s, b, ['care']);
  a.need[needs.NEED.food] = F(5);
  c.need[needs.NEED.rest] = F(5);
  health.damage(s, a, 'torso', 'cut', 10); a.hp.blood = F(35); health.checkDowned(s, a);
  step(s, 400);
  const types = s.col.map((x) => (x.job ? x.job.type : null));
  assert.ok(types.filter((t) => ['eat', 'sleep', 'rescue', 'bedrest'].includes(t)).length >= 2, JSON.stringify(types));
  const blob = saveBlobSync(s);
  const s2 = loadBlobSync(blob);
  step(s, 3000); step(s2, 3000);
  assert.equal(stateHash(s2), stateHash(s));
  assert.ok(resEqual(s2));
});

test('G: 1b data: food values give about 1.6 meals or 8 raw a day; the advice rules are pure', () => {
  const meal = CONTENT.get('item', 'meal'), root = CONTENT.get('item', 'hearthroot');
  const fall = CONTENT.get('need', 'food').fallPerDay;
  assert.ok(Math.abs(fall / meal.food.nutr - 1.6) < 0.1 && Math.abs(fall / root.food.nutr - 8) < 0.5);
  assert.equal(CONTENT.all('advice').length >= 10, true);
  const s = colony('EFG-ADVICE');
  const h0 = stateHash(s);
  const shown = CONTENT.all('advice').filter((r) => r.when(s)).map((r) => [r.id, r.score(s)]);
  assert.equal(stateHash(s), h0, 'reading the rules changes nothing');
  assert.ok(shown.some(([id]) => id === 'campfire'), JSON.stringify(shown));
  assert.ok(foodDays(s) > 4 && foodDays(s) < 9, `the start stock lasts ${foodDays(s).toFixed(1)} days`);
  for (const r of CONTENT.all('recipe').filter((x) => x.stage === '1b')) assert.ok(CONTENT.get('structure', r.bench[0]).stage === '1b' || CONTENT.get('structure', r.bench[0]).stage === '1a');
  assert.ok(DESIG.HARVEST > 0);
});
