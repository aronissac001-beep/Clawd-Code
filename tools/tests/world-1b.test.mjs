// Workstream B, Stage 1b (doc 14.7 row B): berries and hearthroot, Hearth fuel and light, temperature
// with constant seasons. Acceptance: a brazier lights its tunnel and not the next one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createColony, initRuntime, stateHash } from '../../js/game/core/state.js';
import { tick, step } from '../../js/game/core/sim.js';
import { resetBus } from '../../js/game/core/bus.js';
import { verifyCaches } from '../../js/game/core/rtcontract.js';
import { W, CW, CH, idx, TER, ROOF } from '../../js/game/core/grid.js';
import { newBuilding } from '../../js/game/core/schema.js';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../../js/game/core/time.js';
import { drain } from '../../js/game/core/events.js';
import { installWorld, mineTile, setOcc, lightAt, tempAt } from '../../js/game/world/terrain.js';
import { roofRockByDepth } from '../../js/game/world/stubmap.js';
import {
  FUEL, setFuelRules, fuelTicks, fuelDays, isBurning, addFuel, fuelWanted, needsRefuel, refuelTargets, acceptsFuel,
  hearthStartFuel, hearthFuelDays,
} from '../../js/game/world/fuel.js';
import { outdoorTemp, TEMP } from '../../js/game/world/temperature.js';
import { isRipe, harvestPlant, canSow, sowPlant, plantsSystem } from '../../js/game/world/plants.js';
import { plantCode } from '../../js/game/world/defs.js';
import { generateWorld } from '../lib/mapgen1.js';
import { saveBlob, loadBlob } from '../../js/game/save/colonysave.js';
import { BUS } from '../../js/game/core/bus.js';

const KEYS = ['occ', 'walkCost', 'support', 'depth', 'region', 'regionH', 'light', 'lit', 'room', 'rooms', 'roomTemp', 'heat'];
const NIGHT = 23 * TICKS_PER_HOUR;          // day 0, 23:00 (Thaw night)
const fresh = (fuel = true) => { resetBus(); installWorld({ fuel }); };

/** 32 x 32: rock east of x = 4; tunnels (rows of mined floor) at the given rows, x 4..23. */
function tunnels(rows = [10, 12], opts = {}) {
  fresh(opts.fuel !== false);
  const s = createColony('B1B', { w: 32 });
  for (let y = 0; y < 32; y++) for (let x = 4; x < 32; x++) s.L.terrain[idx(x, y)] = TER.ROCK;
  roofRockByDepth(s);
  initRuntime(s);
  for (const y of rows) for (let x = opts.x0 ?? 4; x < 24; x++) mineTile(s, idx(x, y));
  s.tick = NIGHT;
  tick(s);
  return s;
}
function place(s, def, x, y, extra = {}) {
  const b = newBuilding(s.bld.length, def, x, y, 0, null, { st: 'done', ...extra });
  s.bld.push(b); setOcc(s, b, true);
  return b;
}
const finish = (s, b) => { for (const fn of BUS.built) fn(s, b); };

// ---- acceptance: a brazier lights its tunnel and not the next one -----------------------------------------
test('a brazier lights its tunnel and not the next one (1-tile rock wall, at night, under the mountain)', () => {
  const s = tunnels([10, 12]);
  for (let x = 4; x < 24; x++) assert.equal(lightAt(s, idx(x, 10)) + lightAt(s, idx(x, 12)), 0, `both tunnels dark at night (x ${x})`);
  const b = place(s, 'brazier', 16, 10);
  finish(s, b);                                    // its first load of fuel
  tick(s);
  let litA = 0;
  for (let x = 4; x < 24; x++) if (lightAt(s, idx(x, 10)) > 0) litA++;
  assert.ok(lightAt(s, idx(17, 10)) >= 2 && lightAt(s, idx(15, 10)) >= 2, 'lit beside the brazier');
  assert.ok(litA >= 9, `its tunnel is lit for r5 each way (${litA} tiles)`);
  for (let x = 4; x < 24; x++) assert.equal(lightAt(s, idx(x, 12)), 0, `the next tunnel stays dark at x ${x}`);
  for (let x = 4; x < 24; x++) assert.equal(lightAt(s, idx(x, 11)), 0, 'the rock wall holds no light');
  assert.ok(s.rt.lit[idx(16, 10)] === 1 && s.rt.lit[idx(16, 12)] === 0, 'combat lit flags follow');
  assert.deepEqual(verifyCaches(s, KEYS), []);
  // a tunnel that meets the brazier's only corner to corner (rock on both sides of the corner) stays dark
  const t = tunnels([10], { x0: 4 });
  for (let x = 24; x < 30; x++) mineTile(t, idx(x, 11));       // starts diagonally below the end tile (23, 10)
  const b2 = place(t, 'brazier', 21, 10); finish(t, b2);
  tick(t);
  assert.ok(lightAt(t, idx(23, 10)) >= 2, 'its own tunnel end is lit');
  for (let x = 24; x < 30; x++) assert.equal(lightAt(t, idx(x, 11)), 0, `no light through the corner at x ${x}`);
  assert.deepEqual(verifyCaches(t, KEYS), []);
});

test('the brazier tunnel goes dark when its fuel runs out and lights again when refuelled', () => {
  const s = tunnels([10, 12]);
  const b = place(s, 'brazier', 16, 10); finish(s, b);
  assert.equal(fuelTicks(s, b), FUEL.builtDays * TICKS_PER_DAY, 'built with one day of fuel');
  tick(s); drain(s);
  assert.ok(lightAt(s, idx(17, 10)) >= 2);
  step(s, FUEL.builtDays * TICKS_PER_DAY + FUEL.every);
  assert.equal(fuelTicks(s, b), 0);
  assert.ok(!isBurning(s, b));
  assert.ok(drain(s).some((e) => e.name === 'fuelOut' && e.data.bId === b.id), 'fuelOut event');
  // (the day passed: at 23:00 + 1 day it is night again)
  for (let x = 4; x < 24; x++) assert.equal(lightAt(s, idx(x, 10)), 0, `cold brazier: dark at x ${x}`);
  assert.deepEqual(verifyCaches(s, KEYS), []);
  assert.ok(needsRefuel(s, b) && refuelTargets(s).includes(b.id));
  const want = fuelWanted(s, b);
  assert.deepEqual(want, { k: 'wood', n: FUEL.capDays * 6 }, '6 wood a day, filled to the cap');
  assert.equal(addFuel(s, b, 'wood', 100), want.n, 'never past the cap');
  assert.equal(fuelDays(s, b), FUEL.capDays);
  assert.equal(addFuel(s, b, 'stone', 5), 0);
  assert.ok(!acceptsFuel(s, b, 'stone') && acceptsFuel(s, b, 'wood'));
  tick(s);
  assert.ok(lightAt(s, idx(17, 10)) >= 2, 'lit again');
  assert.equal(refuelTargets(s).length, 0);
  assert.deepEqual(verifyCaches(s, KEYS), []);
});

test('the Hearth burns 10 wood a day; a cold Hearth gives no light; rules off (1a) every light shines', () => {
  fresh(true);
  const s = createColony(7, { w: 64 });
  generateWorld(s);
  hearthStartFuel(s);
  tick(s);
  const hb = s.bld[s.colony.hearth.id];
  const c = idx(hb.x + 1, hb.y + 4);
  assert.equal(hearthFuelDays(s), FUEL.startDays, 'a new colony starts with 3 days');
  assert.ok(lightAt(s, c) >= 2, 'the Hearth lights its ground');
  const f0 = s.colony.hearth.fuel;
  step(s, TICKS_PER_DAY);
  assert.equal(f0 - s.colony.hearth.fuel, TICKS_PER_DAY, 'one day of burn per day');
  assert.equal(fuelWanted(s, hb), null, 'at 2 days left: not yet');
  step(s, FUEL.every);
  assert.deepEqual(fuelWanted(s, hb), { k: 'wood', n: 10 }, 'below 2 days: one day of wood (10) fills it');
  s.colony.hearth.fuel = 61; s.rt.dirty.light = true;
  s.tick = (Math.floor(s.tick / TICKS_PER_DAY) + 1) * TICKS_PER_DAY + 23 * TICKS_PER_HOUR - 1; // just before a burn, at night
  step(s, 180);
  assert.equal(s.colony.hearth.fuel, 0, 'burnt out');
  assert.equal(lightAt(s, c), 0, 'a cold Hearth at night: dark');
  assert.deepEqual(verifyCaches(s, KEYS), []);
  assert.equal(addFuel(s, hb, 'wood', 5), 5);
  tick(s);
  assert.ok(lightAt(s, c) >= 2, 'refuelled: lit');
  // Stage 1a rules: nothing burns, every finished light shines
  setFuelRules(false);
  s.colony.hearth.fuel = 0; s.rt.dirty.light = true; tick(s);
  assert.ok(lightAt(s, c) >= 2);
  const f1 = s.colony.hearth.fuel; step(s, 600); assert.equal(s.colony.hearth.fuel, f1);
  setFuelRules(true);
});

test('fuel and light survive a save mid-burn and continue identically', async () => {
  const s = tunnels([10, 12]);
  const b = place(s, 'brazier', 16, 10); finish(s, b);
  step(s, 5000);
  const t = await loadBlob(await saveBlob(s));
  assert.equal(stateHash(t), stateHash(s));
  assert.equal(fuelTicks(t, t.bld[b.id]), fuelTicks(s, b));
  step(s, 20000); step(t, 20000);
  assert.equal(stateHash(t), stateHash(s));
  assert.equal(lightAt(t, idx(17, 10)), lightAt(s, idx(17, 10)));
  assert.deepEqual(verifyCaches(t, KEYS), []);
});

// ---- temperature (3.6, constant seasons) ------------------------------------------------------------------
test('temperature: seasons are constants, night is 4 C colder, deep rooms are 12 C, a brazier warms its room', () => {
  assert.equal(outdoorTemp(12 * TICKS_PER_HOUR), 10);
  assert.equal(outdoorTemp(10 * TICKS_PER_DAY + 12 * TICKS_PER_HOUR), 22);
  assert.equal(outdoorTemp(20 * TICKS_PER_DAY + 23 * TICKS_PER_HOUR), 4);
  assert.equal(outdoorTemp(30 * TICKS_PER_DAY + 12 * TICKS_PER_HOUR), -6);
  // a closed 10-tile chamber deep in the rock (x 14..18, y 10..11)
  fresh(true);
  const s = createColony('TEMP', { w: 32 });
  for (let y = 0; y < 32; y++) for (let x = 4; x < 32; x++) s.L.terrain[idx(x, y)] = TER.ROCK;
  roofRockByDepth(s); initRuntime(s);
  for (let y = 10; y <= 11; y++) for (let x = 14; x <= 18; x++) mineTile(s, idx(x, y));
  s.tick = 12 * TICKS_PER_HOUR; tick(s);
  const room = s.rt.room[idx(15, 10)];
  assert.ok(room > 0 && s.rt.rooms[room].n === 10, 'a 10-tile room');
  assert.equal(tempAt(s, idx(15, 10)), 12, 'deep rock: 12 C');
  const b = place(s, 'brazier', 16, 11); finish(s, b); tick(s);
  assert.equal(tempAt(s, idx(15, 10)), 12 + 6, 'a brazier (60 C x tiles) warms a 10-tile room by 6 C');
  assert.deepEqual(verifyCaches(s, KEYS), []);
  b.fuel = 0; s.rt.dirty.temperature = true; s.rt.dirty.light = true; tick(s);
  assert.equal(tempAt(s, idx(15, 10)), 12, 'a cold brazier gives no heat');
  assert.deepEqual(verifyCaches(s, KEYS), []);
});

test('temperature: an outdoor fire warms tiles within 3 by heat / 20; the base follows night and season exactly (C13)', () => {
  fresh(true);
  const s = createColony('TEMP2', { w: 32 });
  initRuntime(s);
  s.tick = 12 * TICKS_PER_HOUR; tick(s);
  const b = place(s, 'brazier', 10, 10); finish(s, b); tick(s);
  assert.equal(tempAt(s, idx(13, 10)), 10 + 3, 'within 3: +3 C');
  assert.equal(tempAt(s, idx(14, 10)), 10, 'beyond 3: base');
  // run across a dusk, a night and a season turn, checking the caches at many tick ends
  s.tick = 9 * TICKS_PER_DAY + 18 * TICKS_PER_HOUR;
  s.rt.dirty.temperature = true; tick(s);
  for (let k = 0; k < 60; k++) {
    step(s, 337);
    assert.deepEqual(verifyCaches(s, ['roomTemp', 'heat', 'light']), [], `caches at tick ${s.tick}`);
  }
  assert.ok(Math.abs(tempAt(s, idx(20, 20)) - outdoorTemp(s.tick)) === 0);
  assert.equal(TEMP.UNDER, 12);
});

// ---- berries and hearthroot ---------------------------------------------------------------------------------
test('hearthroot: sown on open fertile soil when warm, grows, is pulled up when ripe; bushes regrow', () => {
  fresh(true);
  const s = createColony('CROP', { w: 32 });
  initRuntime(s);
  s.tick = 12 * TICKS_PER_HOUR; tick(s);
  const root = plantCode('hearthroot');
  const i = idx(8, 8);
  assert.equal(canSow(s, i, root), null);
  assert.ok(sowPlant(s, i, root));
  assert.equal(canSow(s, i, root), 'something grows here');
  assert.equal(canSow(s, idx(9, 8), plantCode('oak')), 'not a sown plant');
  s.L.terrain[idx(10, 8)] = TER.SAND; assert.equal(canSow(s, idx(10, 8), root), 'the ground is not fertile');
  s.L.roof[idx(11, 8)] = ROOF.BUILT; assert.equal(canSow(s, idx(11, 8), root), 'it needs open sky');
  // six days (Thaw is warm, nights 6 C) bring it to ripe
  s.tick -= s.tick % (CW * CH);   // tile (8, 8) is in cluster 0: visit it every CW * CH ticks
  for (let d = 0; d < 7 && !isRipe(s, i); d++) for (let k = 0; k < TICKS_PER_DAY; k += CW * CH) { s.tick += CW * CH; plantsSystem(s); }
  assert.ok(isRipe(s, i), `ripe (growth ${s.L.growth[i]})`);
  assert.deepEqual(harvestPlant(s, i), { item: 'hearthroot', n: 10 });
  assert.equal(s.L.plant[i], 0, 'a crop is pulled up');
  assert.equal(harvestPlant(s, i), null);
  // too cold: Deepcold (-6 C) refuses sowing and stops growth
  s.tick = 30 * TICKS_PER_DAY + 12 * TICKS_PER_HOUR; s.rt.dirty.temperature = true; tick(s);
  assert.equal(canSow(s, idx(12, 12), root), 'too cold to sow');
  const berry = plantCode('berry');
  if (berry) {
    const j = idx(14, 14);
    s.L.plant[j] = berry; s.L.growth[j] = 255;
    const y = harvestPlant(s, j);
    assert.ok(y && y.item === 'berries' && y.n > 0);
    assert.equal(s.L.plant[j], berry, 'a bush stays and regrows');
    assert.equal(s.L.growth[j], 0);
  }
});

test('mapgen: berry bushes on meadows and a patch near the Hearth (when the berry plant exists)', () => {
  const berry = plantCode('berry');
  if (!berry) return; // needs G's berries item and B's plant entry (Stage 1b)
  fresh(true);
  for (const seed of [1, 2, 3, 4, 5]) {
    const s = createColony(seed);
    const info = generateWorld(s);
    let total = 0, near = 0;
    const h = info.hearth;
    for (let k = 0; k < s.L.plant.length; k++) {
      if (s.L.plant[k] !== berry) continue;
      total++;
      if (Math.max(Math.abs((k % W) - h.cx), Math.abs(((k / W) | 0) - h.cy)) <= 12) near++;
    }
    assert.ok(total >= 18, `seed ${seed}: ${total} bushes`);
    assert.ok(near >= 3, `seed ${seed}: ${near} bushes within 12 of the Hearth`);
  }
});
