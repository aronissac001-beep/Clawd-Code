// Workstream K (colony systems and animals), Stage 0 skeletons and the first acceptance checks
// (14.6-14.7 row K): incremental wealth equals a full recompute (C13 check (e)); ledger counters
// reset at 06:00 and survive a save. Also: tier-up after a full day, the Chronicle cap, renown and
// the hold verbs (no charters since Stage 2.9), research, the Animals giver contract and animal spawning.
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
import { installColony, wealth, ledger, chronicle, verbs, research } from '../../js/game/colony/index.js';
import { installAnimals, spawn } from '../../js/game/animals/index.js';
import { CONTENT } from '../../js/data/index.js';

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
  // Stage 2.9: a tier asks for no choice. No charter letter, no charter command; Crownhold asks for no slain beast.
  assert.ok(!s.rt.events.some((e) => e.name === 'letter' && e.data && /charter/.test(String(e.data.kind || e.data.id || ''))), 'no charter letter');
  assert.equal(applyCommand(s, { t: 'charter', id: 'forgehold' }).ok, false);
  assert.ok(CONTENT.all('tier').every((t) => !('lord' in t)), 'no tier is gated on a slain beast');
});

test('Stage 2.9: renown and the hold verbs replace the charters; nothing about them is chosen or gated', () => {
  assert.deepEqual(CONTENT.all('renown').map((d) => d.id), ['smithing', 'growing', 'lore', 'trade', 'arms', 'delving']);
  assert.deepEqual(CONTENT.all('charter'), []);
  assert.deepEqual([...verbs.VERB_IDS], ['commissions', 'herds', 'lightnet', 'outbound', 'garrisons']);
  for (const id of verbs.VERB_IDS) assert.equal(verbs.VERBS[id].id, id);
  // the former charter structures are ordinary structures: no path, no charter group
  for (const id of ['greatanvil', 'keep']) { const d = CONTENT.get('structure', id); assert.ok(d && !d.path && d.cat !== 'charter', id); }
  // wonders are prestige buildings with no percentage effects
  for (const d of CONTENT.all('structure').filter((x) => x.cat === 'prestige')) assert.ok(!(d.mods && d.mods.length) && !(d.flags || []).includes('wonder'), d.id);
  const s = createColony('K-V', { w: 32 });
  installColony({ verbs: true });
  step(s, TICKS_PER_HOUR);   // the verb stubs tick without touching state
  assert.equal(s.colony.tier, 0);
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

// ---- Stage 1a (14.6 row K): incremental wealth equals a full recompute ---------------------------
import { nextU32 } from '../../js/game/core/rand.js';
import { rtEqual } from '../../js/game/core/rtcontract.js';

test('incremental wealth equals a full recompute after every tick of random item, building and skill changes', () => {
  const s = createColony('K-INC', { w: 32 });
  for (let id = 1; id <= 3; id++) s.col.push(newColonist(id));
  const r = (n) => nextU32(s, 'main') % n;
  const kinds = [['wood', null], ['stone', 'granite'], ['block', 'slate'], ['ore', 'iron'], ['coal', null], ['ingot', 'steel'], ['chair', 'marble'], ['bed', null]];
  const defs = [['wall', 'granite'], ['wall', null], ['door', null], ['f_flag', 'basalt'], ['f_planks', null], ['carpenter', null], ['bed', 'wood'], ['pillar', 'granite'], ['sconce', null]];
  let checks = 0, sawChange = 0, prev = -1;
  for (let t = 0; t < 400; t++) {
    const op = r(10);
    if (op < 3) { const [k, m] = kinds[r(kinds.length)]; I.spawn(s, k, m, r(3), 1 + r(9), r(32), r(32)); }
    else if (op < 5) { const live = s.items.filter(Boolean); if (live.length) { const it = live[r(live.length)]; I.take(s, it.id, 1 + r(it.n)); } }
    else if (op === 5) { const [d, m] = defs[r(defs.length)]; let id = s.bld.indexOf(null); if (id < 0) id = s.bld.length; s.bld[id] = newBuilding(id, d, r(32), r(32), 0, m, { st: r(2) ? 'done' : 'bp' }); }
    else if (op === 6) { const live = s.bld.filter(Boolean); if (live.length) { const b = live[r(live.length)]; b.st = b.st === 'done' ? 'frame' : 'done'; } }
    else if (op === 7) { const live = s.bld.filter(Boolean); if (live.length) s.bld[live[r(live.length)].id] = null; }
    else if (op === 8) { const c = s.col[r(3)]; c.sk[r(15)][0] = r(21); }
    else { const live = s.items.filter(Boolean); if (live.length) I.setForbidden(s, live[r(live.length)].id, true); }
    step(s, 1);
    assert.ok(rtEqual(s.rt.wealth, wealth.computeWealth(s)), `tick ${t}: live ${JSON.stringify(s.rt.wealth)} full ${JSON.stringify(wealth.computeWealth(s))}`);
    checks++;
    if (s.rt.wealth.total !== prev) sawChange++;
    prev = s.rt.wealth.total;
    if (t === 200) {   // a save and load mid-run: the loaded state starts without a memo and stays exact
      const s2 = loadBlobSync(saveBlobSync(s));
      step(s2, 1);
      assert.ok(rtEqual(s2.rt.wealth, wealth.computeWealth(s2)));
    }
  }
  assert.equal(checks, 400);
  assert.ok(sawChange > 100, `the wealth moved ${sawChange} times`);
  assert.deepEqual(verifyCaches(s, ['wealth']), []);
});

test('wealth follows 6.7: items in full, structures at half, 5 coins per skill level; walls at half again for threat', () => {
  const s = createColony('K-67', { w: 32 });
  I.spawn(s, 'wood', 'wood', 0, 50, 2, 2);                       // 50 x 1.2 = 60 coins
  s.bld.push(newBuilding(0, 'wall', 8, 8, 0, 'granite', { st: 'done' }));      // 5 blocks x 0.9 x 120% = 5.4 coins
  s.bld.push(newBuilding(1, 'carpenter', 10, 8, 0, null, { st: 'done' }));     // 40 wood = 48 coins
  s.bld.push(newBuilding(2, 'carpenter', 12, 8, 0, null, { st: 'bp' }));       // blueprints count nothing
  const c = newColonist(1); c.sk[0][0] = 6; c.sk[1][0] = 4; s.col.push(c);    // 10 levels = 50 coins
  const w = wealth.computeWealth(s);
  assert.equal(w.items, 60);
  assert.equal(w.bld, Math.floor((54 + 480) * 50 / 100 / 10));
  assert.equal(w.pop, 50);
  assert.equal(w.total, Math.floor((600 + Math.floor((54 + 480) / 2)) / 10) + 50);
  assert.equal(w.threat, Math.floor((600 + Math.floor((54 + 480) / 2) - Math.floor(Math.floor(54 / 2) / 2)) / 10) + 50, 'the wall counts at 50% for threat');
  step(s, 1);
  assert.equal(wealth.wealthOf(s), w.total, 'the HUD value');
  const stoneWall = wealth.buildingValue({ def: 'wall', mat: 'granite', q: 0 }), woodWall = wealth.buildingValue({ def: 'wall', mat: 'wood', q: 0 });
  assert.equal(stoneWall, Math.floor(9 * 5 * 120 / 100)); assert.equal(woodWall, 12 * 8, 'a wooden wall costs 8 wood');
  assert.ok(wealth.buildingValue({ def: 'bed', mat: 'marble', q: 2 }) > wealth.buildingValue({ def: 'bed', mat: 'wood', q: 1 }), 'furniture by material and quality');
});

test('incremental wealth stays cheap: 4,000 stacks and 3,000 buildings, unchanged ticks cost a scan only', () => {
  const s = createColony('K-PERF', { w: 128 });
  for (let i = 0; i < 4000; i++) I.spawn(s, i % 2 ? 'wood' : 'block', i % 2 ? null : 'granite', 0, 1 + (i % 50), (i * 7) % 128, ((i * 7) / 128) | 0);
  for (let i = 0; i < 3000; i++) s.bld.push(newBuilding(i, 'wall', i % 128, 100 + ((i / 128) | 0), 0, 'granite', { st: 'done' }));
  wealth.wealthSystem(s);
  const t0 = process.hrtime.bigint();
  for (let k = 0; k < 200; k++) { s.tick++; wealth.wealthSystem(s); }
  const us = Number(process.hrtime.bigint() - t0) / 1000 / 200;
  assert.ok(rtEqual(s.rt.wealth, wealth.computeWealth(s)));
  assert.ok(us < 400, `${us.toFixed(1)} us per tick`);   // ~10 us for the stacks; buildings are dictionary-mode objects (schema make()), see the K report
  console.log(`# wealth tick with 4,000 stacks + 3,000 buildings: ${us.toFixed(1)} us`);
});
