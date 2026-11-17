// Workstream K (colony systems and animals), Stage 0 skeletons and the first acceptance checks
// (14.6-14.7 row K): incremental wealth equals a full recompute (C13 check (e)); ledger counters
// reset at 06:00 and survive a save. Also: tier-up after a full day, the Chronicle cap, charter
// nudges, research, the Animals giver contract and animal spawning.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createColony } from '../../js/game/core/state.js';
import { step } from '../../js/game/core/sim.js';
import { resetBus, BUS } from '../../js/game/core/bus.js';
import { resetAppliers, applyCommand } from '../../js/game/core/commands.js';
import { verifyCaches } from '../../js/game/core/rtcontract.js';
import { newColonist, newBuilding } from '../../js/game/core/schema.js';
import { idx, TER } from '../../js/game/core/grid.js';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../../js/game/core/time.js';
import { installWorld, mineTile } from '../../js/game/world/terrain.js';
import { saveBlobSync, loadBlobSync } from '../../js/game/save/colonysave.js';
import { installWork } from '../../js/game/work/index.js';
import * as I from '../../js/game/work/items.js';
import { checkGiver } from '../../js/game/work/jobs.js';
import { ANIMALS_GIVER } from '../../js/game/work/givers/animals.js';
import { installColony, wealth, ledger, chronicle, charters, research } from '../../js/game/colony/index.js';
import { installAnimals, spawn } from '../../js/game/animals/index.js';

beforeEach(() => { resetBus(); resetAppliers(); ledger.uninstallLedger(); installWorld(); installWork({ think: false }); installColony({ tiers: true, research: true, ledger: true, deeds: true }); });

test('rt.wealth always equals a full recompute (C13 check (e))', () => {
  const s = createColony('K-W', { w: 32 });
  I.spawn(s, 'wood', null, 0, 30, 3, 3);
  I.spawn(s, 'block', 'granite', 0, 20, 4, 3);
  s.bld.push(newBuilding(0, 'wall', 8, 8, 0, 'granite', { st: 'done' }));
  step(s, 1);
  assert.deepEqual(verifyCaches(s, ['wealth']), []);
  const w = s.rt.wealth;
  assert.ok(w.total > 0 && w.items > 0 && w.bld > 0);
  assert.ok(w.threat < w.total, 'walls count at 50% for threat points');
  I.take(s, 0, 10);
  assert.notDeepEqual(verifyCaches(s, ['wealth']), [], 'between ticks the stand-in lags');
  step(s, 1);
  assert.deepEqual(verifyCaches(s, ['wealth']), []);
});

test('ledger counters reset at 06:00 and survive a save', () => {
  const s = createColony('K-L', { w: 32 });
  for (let x = 20; x < 24; x++) s.L.terrain[idx(x, 5)] = TER.ROCK;
  ledger.bump(s, 'hauled', 3);
  mineTile(s, idx(20, 5)); mineTile(s, idx(21, 5));
  assert.equal(ledger.today(s, 'mined'), 2, 'mined rock is counted through the terrain hook');
  step(s, ledger.RESET_TICK - 1);
  const s2 = loadBlobSync(saveBlobSync(s));
  assert.equal(ledger.today(s2, 'hauled'), 3); assert.equal(ledger.today(s2, 'mined'), 2);
  step(s2, 1);
  assert.equal(ledger.today(s2, 'hauled'), 0, 'reset at 06:00');
  assert.equal(ledger.lifetime(s2, 'mined'), 2, 'lifetime totals stay');
  assert.equal(s2.colony.ledger.since, ledger.RESET_TICK);
});

test('a tier is reached when its conditions hold for one full day', () => {
  const s = createColony('K-T', { w: 32 });
  for (let id = 1; id <= 5; id++) s.col.push(newColonist(id));
  s.colony.hearth.lvl = 2;
  for (let k = 0; k < 9; k++) I.spawn(s, 'ingot', 'steel', 0, 75, k, 0);   // Hamlet needs 8,000 wealth
  assert.ok(wealth.computeWealth(s).total >= 8000, `wealth ${wealth.computeWealth(s).total}`);
  step(s, TICKS_PER_HOUR);
  assert.equal(s.colony.tier, 0);
  step(s, TICKS_PER_DAY);
  assert.equal(s.colony.tier, 1);
  assert.ok(s.rt.events.some((e) => e.name === 'tierUp' && e.data.tier === 'hamlet'));
  assert.equal(charters.canCharter(s, 'forgehold'), null);
  assert.ok(applyCommand(s, { t: 'charter', id: 'forgehold' }).ok);
  assert.equal(charters.canCharter(s, 'bulwark'), 'needs the stronghold tier');
  assert.equal(charters.charterWeightPct(s, ['sapper']), 300);
  assert.equal(charters.charterWeightPct(s, ['beast']), 30);
  assert.equal(charters.firstMajorAfter(s), 'sapper_raid');
});

test('free techs of open eras are granted; research completes at its cost', () => {
  const s = createColony('K-R', { w: 32 });
  step(s, TICKS_PER_HOUR);
  assert.ok(research.hasTech(s, 'masonry') && research.hasTech(s, 'carpentry'));
  assert.equal(research.canResearch(s, 'smelting'), 'that era is not open yet');
  s.colony.tier = 1;
  assert.ok(applyCommand(s, { t: 'research', tech: 'smelting' }).ok);
  assert.equal(research.addLore(s, 199), null);
  assert.equal(research.addLore(s, 1), 'smelting');
  assert.ok(research.hasTech(s, 'smelting'));
});

test('the Chronicle keeps at most 600 entries and folds the oldest into year summaries', () => {
  const s = createColony('K-C', { w: 32 });
  for (let k = 0; k < 650; k++) { s.tick = k * 100; chronicle.addChron(s, 'note', 'chron_note', { k }); }
  assert.equal(s.chron.length, chronicle.CHRON_CAP);
  assert.equal(s.chron[0][1], 'year');
  assert.equal(s.chron[0][3].n + s.chron.length - 1, 650);
  const c = newColonist(1, { name: 'Hal' }); s.col.push(c);
  for (const fn of BUS.kill) fn(s, c, null);
  assert.equal(chronicle.entriesOf(s, 'death').length, 1);
});

test('animals: spawning respects the cap; the Animals giver meets the C7 contract', () => {
  installAnimals();
  const s = createColony('K-A', { w: 32 });
  const a = spawn.spawnAnimal(s, 'goat', 5, 5);
  assert.equal(a.id, 1); assert.equal(a.hp.hp, 45);
  assert.equal(spawn.spawnAnimal(s, 'dragon', 5, 5), null);
  assert.deepEqual(checkGiver(ANIMALS_GIVER), []);
  assert.ok(BUS.workGivers.includes(ANIMALS_GIVER));
  for (let k = 0; k < 70; k++) spawn.spawnAnimal(s, 'hen', 1, 1);
  assert.equal(s.anim.length, 60);
});
