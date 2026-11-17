// Time and speeds (owner A; doc 2.2, 10.7, D3): the real-time clock half of the loop, the 5x rule
// and the auto-slowdown, and the tick order with endOfTick (12.3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../js/game/core/time.js';
import { createColony } from '../../js/game/core/state.js';
import { newColonist, newFoe, newRaid, newAnimal } from '../../js/game/core/schema.js';
import { TICK_ORDER, END_OF_TICK, registerSystem, registerEndOfTick, resetBus } from '../../js/game/core/bus.js';
import { tick } from '../../js/game/core/sim.js';
import { dirtyClear } from '../../js/game/core/rtcontract.js';

test('Clock: ticks per real second at each speed; never more than 4 per frame; owed time is dropped', () => {
  for (const [mult, perSec] of [[1, 20], [2, 40], [3, 60], [5, 100]]) {
    const c = new T.Clock(); c.setSpeed(mult);
    let n = 0; for (let f = 0; f < 60; f++) n += c.frame(1 / 60);
    assert.ok(Math.abs(n - perSec) <= 1, `${mult}x: ${n} ticks in 1 s at 60 fps`);
    const c30 = new T.Clock(); c30.setSpeed(mult);
    let m = 0; for (let f = 0; f < 30; f++) { const k = c30.frame(1 / 30); assert.ok(k <= T.MAX_TICKS_PER_FRAME); m += k; }
    assert.ok(Math.abs(m - perSec) <= 1, `${mult}x at 30 fps: ${m}`);
  }
  const p = new T.Clock(); p.setSpeed(0); assert.equal(p.frame(1), 0, 'paused');
  const slow = new T.Clock(); slow.setSpeed(5); assert.equal(slow.frame(0.5), T.MAX_TICKS_PER_FRAME); assert.equal(slow.acc, 0, 'a slow frame banks nothing');
  assert.deepEqual(T.SPEED_MULTS, [0, 1, 2, 3, 5]);
});

test('5x is blocked by a drafted colonist, an arrived raid member or an aggroed beast; an idle foe does not block', () => {
  const s = createColony('SPD');
  assert.equal(T.fastBlocked(s), null);
  assert.equal(T.allowedSpeed(s, 5), 5);
  s.col.push(newColonist(1, { drafted: true }));
  assert.match(T.fastBlocked(s), /drafted/); assert.equal(T.allowedSpeed(s, 5), 3); assert.equal(T.speedBlocked(s, 3), null);
  s.col[0].drafted = false;
  const r = newRaid(1, 'hollow_horde', { stage: 'warned' }); s.raids.push(r);
  s.foes.push(newFoe(1, 'husk', { raid: 1 }));
  assert.equal(T.fastBlocked(s), null, 'a warned raid has not arrived');
  r.stage = 'active'; assert.match(T.fastBlocked(s), /raiders/);
  s.raids.length = 0; s.foes.length = 0;
  s.anim.push(newAnimal(1, 'spider', { st: { aggro: false } })); assert.equal(T.fastBlocked(s), null, 'a sleeping spider');
  s.anim[0].st.aggro = true; assert.match(T.fastBlocked(s), /beast/);
});

test('auto-slowdown to 1x on raid arrival, a downed colonist or a major letter (each can be turned off)', () => {
  assert.equal(T.slowdownFor([{ name: 'raidStage', data: { stage: 'active' } }], 3), 1);
  assert.equal(T.slowdownFor([{ name: 'raidStage', data: { stage: 'sighted' } }], 3), 3);
  assert.equal(T.slowdownFor([{ name: 'downed', data: { id: 1 } }], 5), 1);
  assert.equal(T.slowdownFor([{ name: 'letter', data: { kind: 'minor' } }], 2), 2);
  assert.equal(T.slowdownFor([{ name: 'letter', data: { kind: 'major' } }], 2), 1);
  assert.equal(T.slowdownFor([{ name: 'downed', data: {} }], 5, { downed: false }), 5);
  assert.equal(T.slowdownFor([{ name: 'downed', data: {} }], 0), 0, 'paused stays paused');
});

test('tick order: systems by slot, endOfTick passes in their fixed order, a pass may dirty a later pass in the same tick', () => {
  resetBus();
  const s = createColony('ORDER');
  const seen = [];
  registerSystem('colony', 'z', () => seen.push('colony'));
  registerSystem('think', 'a', (st) => { seen.push('think'); st.rt.dirty.regions = true; });
  registerSystem('spatial', 'm', () => seen.push('spatial'));
  registerEndOfTick('light', () => seen.push('light'));
  registerEndOfTick('regions', (st) => { seen.push('regions'); st.rt.dirty.rooms = true; });
  registerEndOfTick('rooms', () => seen.push('rooms'));
  tick(s);
  assert.deepEqual(seen, ['spatial', 'think', 'colony', 'regions', 'rooms']);
  assert.ok(dirtyClear(s.rt.dirty));
  assert.equal(s.tick, 1);
  assert.deepEqual(END_OF_TICK, ['regions', 'rooms', 'temperature', 'light', 'zoneFields', 'flowFields']);
  assert.equal(TICK_ORDER[0], 'spatial');
  resetBus();
});
