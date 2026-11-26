// Stage Z4 water engineering (EMBERCROWN-FORTRESS.md 2.8 deferred, 8.6): the hand pump lifts water one level
// (worked, wheel-driven, lever-stopped), wells by level, and glass windows (block feet and water, pass light,
// bound rooms and add beauty). World-level oracles on a 32 x 32 x 6 hold.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createColony, initRuntime } from '../../js/game/core/state.js';
import { resetBus } from '../../js/game/core/bus.js';
import { idx, TER, N, PLANE } from '../../js/game/core/grid.js';
import { newBuilding } from '../../js/game/core/schema.js';
import { step } from '../../js/game/core/sim.js';
import { installWorld, mineTile, refreshBuilding, passable } from '../../js/game/world/terrain.js';
import { setWorldStage } from '../../js/game/world/worldrec.js';
import { CONTENT } from '../../js/data/index.js';
import { link, setLever, GATE } from '../../js/game/world/mechanisms.js';
import { fluidBlocked } from '../../js/game/world/fluids.js';
import { isOpaque } from '../../js/game/world/pass.js';
import { roomInfo } from '../../js/game/world/rooms.js';
import { pumpState, pumpStroke, wellWatered, wellNear } from '../../js/game/world/pumps.js';
import { PUMP_GIVER } from '../../js/game/work/givers/pump.js';

const ZS = 4, ZT = ZS - 1, ZB = ZS - 2;
function world(seed = 'Z4W') {
  resetBus(); setWorldStage('3'); installWorld();
  const s = createColony(seed, { w: 32, d: 6, zS: ZS });
  const L = s.L;
  L.fluid = new Uint8Array(N);
  for (let i = 0; i < N; i++) { const z = (i / PLANE) | 0; L.terrain[i] = z < ZS ? TER.ROCK : z === ZS ? TER.GRASS : TER.AIR; }
  initRuntime(s);
  return s;
}
function place(s, def, x, y, z, rot = 0) {
  const b = newBuilding(s.bld.length, def, x, y, rot, null, { z, st: 'done' });
  s.bld.push(b); refreshBuilding(s, b); return b;
}
const dep = (s, x, y, z) => s.L.fluid[idx(x, y, z)] & 7;
/** A cistern voxel at (10, 10, ZB) holding `d`, a pump over it on ZT facing east, its outlet (11, 10, ZT). */
function pumpScene(d = 5) {
  const s = world();
  for (const [x, z] of [[10, ZB], [10, ZT], [11, ZT]]) mineTile(s, idx(x, 10, z));
  s.L.fluid[idx(10, 10, ZB)] = d;
  return { s, pump: place(s, 'pump', 10, 10, ZT, 1) };
}

test('the data: a hand pump, a floodgate and a glass window a mid-game hold can research', () => {
  const pump = CONTENT.get('structure', 'pump'), fg = CONTENT.get('structure', 'floodgate'), win = CONTENT.get('structure', 'window');
  assert.equal(pump.tech, 'waterworks'); assert.ok(pump.flags.includes('pump') && pump.flags.includes('lockable'));
  assert.equal(fg.tech, 'mechanisms'); assert.ok(fg.flags.includes('floodgate'));
  assert.equal(win.tech, 'glassblowing'); assert.ok(win.cost.glass > 0);
  for (const t of ['waterworks', 'mechanisms', 'glassblowing']) assert.equal(CONTENT.get('tech', t).era, 'hold');
  assert.ok(CONTENT.get('recipe', 'make_glass'), 'glass comes from the Z2 glassworks chain');
});

test('a hand pump lifts one depth per stroke into the voxel it faces, one level up', () => {
  const { s, pump } = pumpScene(5);
  assert.equal(pumpState(s, pump), 'ok');
  assert.ok(pumpStroke(s, pump));
  assert.equal(dep(s, 10, 10, ZB), 4); assert.equal(dep(s, 11, 10, ZT), 1);
  for (let k = 0; k < 4; k++) pumpStroke(s, pump);
  assert.equal(dep(s, 10, 10, ZB), 0); assert.equal(pumpState(s, pump), 'dry');
  assert.equal(pumpStroke(s, pump), false);
  assert.equal(dep(s, 11, 10, ZT), 5, 'water is conserved');
});

test('a pump stops when its outlet is full, walled, or a lever locks it; the giver offers only runnable pumps', () => {
  const { s, pump } = pumpScene(5);
  s.L.fluid[idx(11, 10, ZT)] = 7;
  assert.equal(pumpState(s, pump), 'full');
  s.L.fluid[idx(11, 10, ZT)] = 0;
  const lever = place(s, 'lever', 12, 12, ZS);
  assert.equal(link(s, pump.id, lever.id), null);
  setLever(s, lever.id, GATE.LOCKED);
  assert.equal(pumpState(s, pump), 'stopped');
  assert.deepEqual(PUMP_GIVER.candidates(s, { id: 0, x: 0, y: 0, z: ZT }, 4), []);
  setLever(s, lever.id, GATE.CLOSED);
  assert.equal(pumpState(s, pump), 'ok');
  place(s, 'wall', 11, 10, ZT);
  assert.equal(pumpState(s, pump), 'blocked');
});

test('a water wheel within 6 tiles drives a pump on its own, deterministically', () => {
  const run = () => {
    const { s, pump } = pumpScene(7);
    s.L.fluid[idx(10, 10, ZB)] |= 16;            // a source cistern: it refills
    place(s, 'waterwheel', 14, 10, ZT);
    step(s, 200);
    void pump;
    return [dep(s, 11, 10, ZT), dep(s, 10, 10, ZB)];
  };
  const a = run();
  assert.ok(a[0] >= 5, `outlet filled to ${a[0]}`);
  assert.deepEqual(run(), a);
});

test('wells by level: the surface always, deeper only over water or on a seep; fire beating doubles near one', () => {
  const s = world();
  const top = place(s, 'well', 5, 5, ZS);
  assert.ok(wellWatered(s, top));
  mineTile(s, idx(20, 20, ZT)); mineTile(s, idx(20, 20, ZB));
  const deep = place(s, 'well', 20, 20, ZT);
  assert.equal(wellWatered(s, deep), false, 'a dry deep well');
  assert.equal(wellNear(s, idx(24, 20, ZT)), false);
  s.L.fluid[idx(20, 20, ZB)] = 3;
  assert.ok(wellWatered(s, deep), 'water under it');
  assert.ok(wellNear(s, idx(24, 20, ZT)));
  assert.equal(wellNear(s, idx(24, 20, ZB)), false, 'only on its own level');
  s.L.fluid[idx(20, 20, ZB)] = 8 | 3;                   // ember is not water
  assert.equal(wellWatered(s, deep), false);
});

test('a glass window blocks feet and water, lets light through, bounds a room and adds to its beauty', () => {
  const s = world();
  const ring = [];
  for (let x = 4; x <= 8; x++) for (let y = 4; y <= 8; y++) if (x === 4 || x === 8 || y === 4 || y === 8) ring.push([x, y]);
  for (const [x, y] of ring) place(s, x === 8 && y === 6 ? 'window' : 'wall', x, y, ZS);
  const w = idx(8, 6, ZS);
  assert.equal(passable(s, w, 0), false); assert.ok(fluidBlocked(s, w)); assert.equal(isOpaque(s, w), false);
  step(s, 1);
  const id = s.rt.room[idx(6, 6, ZS)];
  assert.ok(id > 0, 'the walls and the window enclose a room');
  assert.equal(s.rt.room[w], 0, 'the window belongs to no room');
  assert.equal(s.rt.room[idx(10, 6, ZS)] === id, false, 'the room does not leak through the window');
  assert.ok(roomInfo(s, id).stats.beauty >= CONTENT.get('structure', 'window').beauty, 'the window counts for beauty');
});
