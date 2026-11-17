import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUS, TICK_ORDER, END_OF_TICK, registerSystem, registerEndOfTick, tickSystems, resetBus, each, product, first } from '../../js/game/core/bus.js';
import { EVENTS, EVENT_NAMES, emit, drain, on, dispatch } from '../../js/game/core/events.js';
import { createColony } from '../../js/game/core/state.js';
import { tick } from '../../js/game/core/sim.js';

test('BUS has the 13.3 hooks and none of the deleted roguelite hooks', () => {
  for (const k of ['workGivers', 'needs', 'thoughts', 'recipes', 'incidents', 'canPlace', 'built', 'removed', 'kill', 'dmgMult', 'hud', 'card', 'alerts']) assert.ok(Array.isArray(BUS[k]), k);
  assert.ok(Array.isArray(BUS.draw.world) && Array.isArray(BUS.draw.overlay));
  for (const k of ['runNew', 'runRegion', 'runMap', 'emberMult', 'draftVeto', 'setup', 'mapNode', 'dawnCard', 'beaconReward']) assert.ok(!(k in BUS), k);
});

test('tick order is fixed by slot, not by registration order', () => {
  resetBus();
  const ran = [];
  registerSystem('colony', 'z', () => ran.push('colony/z'));
  registerSystem('movement', 'b', () => ran.push('movement/b'));
  registerSystem('think', 'a', () => ran.push('think/a'));
  registerSystem('movement', 'a', () => ran.push('movement/a'));
  registerSystem('spatial', 'x', () => ran.push('spatial/x'));
  const s = createColony('BUS');
  tick(s);
  assert.deepEqual(ran, ['spatial/x', 'think/a', 'movement/a', 'movement/b', 'colony/z']);
  assert.equal(tickSystems().length, 5);
  assert.throws(() => registerSystem('nosuchslot', 'q', () => 0));
  assert.throws(() => registerSystem('think', 'a', () => 0), /already/);
  resetBus();
});

test('endOfTick runs only dirty passes, in the fixed order', () => {
  resetBus();
  assert.deepEqual(END_OF_TICK, ['regions', 'rooms', 'temperature', 'light', 'zoneFields', 'flowFields']);
  const ran = [];
  for (const p of END_OF_TICK) registerEndOfTick(p, () => ran.push(p));
  const s = createColony('EOT');
  tick(s); assert.deepEqual(ran, []);
  s.rt.dirty.light = true; s.rt.dirty.regions = true;
  tick(s); assert.deepEqual(ran, ['regions', 'light']);
  assert.equal(s.rt.dirty.light, false);
  resetBus();
  assert.ok(TICK_ORDER.indexOf('think') < TICK_ORDER.indexOf('movement'));
});

test('fold helpers', () => {
  assert.equal(product([() => 2, () => 3]), 6);
  assert.equal(first([() => null, () => 7, () => 9]), 7);
  let n = 0; each([() => n++, () => n++]); assert.equal(n, 2);
});

test('events: the 13.3 names; emit queues, drain empties; unknown names throw', () => {
  for (const k of ['mined', 'oreFound', 'discovery', 'built', 'crafted', 'masterwork', 'artifact', 'hauled', 'ate', 'slept', 'broke', 'inspired', 'emberTouched', 'wounded', 'downed', 'died', 'raidWarn', 'raidStage', 'raidEnd', 'nemesis', 'fireStart', 'caveIn', 'tierUp', 'rankUp', 'letter']) assert.ok(k in EVENTS, k);
  assert.ok('caveRumble' in EVENTS);   // 3.4 rumble before a collapse (world/support.js)
  assert.equal(EVENT_NAMES.length, 26);
  const s = createColony('EV');
  emit(s, 'mined', { i: 5 }); emit(s, 'tierUp', { tier: 1 });
  assert.throws(() => emit(s, 'exploded'));
  const got = []; const off = on('mined', (e) => got.push(e.data.i));
  const evs = dispatch(s);
  assert.equal(evs.length, 2); assert.deepEqual(got, [5]); assert.deepEqual(drain(s), []);
  off();
});
