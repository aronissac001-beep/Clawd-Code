// Stage Z3.4 (EMBERCROWN-FORTRESS.md 2.8 Z3, 8.5): fluids lite and water control. Oracle: a channel under the
// river floods z-1 and stops at walls; a closed floodgate holds a flood and a lever two levels up releases it;
// 4,096 active cells step in < 0.1 ms desktop; determinism with saves mid-flood; a scripted breach is stopped
// by closing a floodgate from a lever two levels away.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createColony, initRuntime } from '../../js/game/core/state.js';
import { resetBus } from '../../js/game/core/bus.js';
import { idx, TER, N, PLANE } from '../../js/game/core/grid.js';
import { newBuilding } from '../../js/game/core/schema.js';
import { step } from '../../js/game/core/sim.js';
import { installWorld, mineTile, refreshBuilding } from '../../js/game/world/terrain.js';
import { setWorldStage } from '../../js/game/world/worldrec.js';
import { setWorldContent } from '../../js/game/world/defs.js';
import { CONTENT } from '../../js/data/index.js';
import { link, setLever, GATE } from '../../js/game/world/mechanisms.js';
import { FLOW, fluidRec, activate, fluidStep, activeCount, fluidBlocked, wadeOut } from '../../js/game/world/fluids.js';
import { passable } from '../../js/game/world/terrain.js';

const EXTRA = {
  floodgate: { id: 'floodgate', name: 'Floodgate', kind: 'construct', size: [1, 1], flags: ['wall', 'lockable', 'floodgate'] },
  liftbridge: { id: 'liftbridge', name: 'Raising bridge', kind: 'construct', size: [1, 3], flags: ['floor', 'bridge', 'lockable', 'liftbridge'] },
};
setWorldContent({ get: (k, id) => (k === 'structure' && EXTRA[id]) || CONTENT.get(k, id) });

const ZS = 4, ZT = ZS - 1;   // the surface and the tunnel level under it
/** 32 x 32 x 6: rock below zS, grass on zS with a river strip (x 0-4, y 10) of shallow water. */
function world(seed = 'FL') {
  resetBus(); setWorldStage('3'); installWorld();
  const s = createColony(seed, { w: 32, d: 6, zS: ZS });
  const L = s.L;
  L.fluid = new Uint8Array(N);
  for (let i = 0; i < N; i++) { const z = (i / PLANE) | 0; L.terrain[i] = z < ZS ? TER.ROCK : z === ZS ? TER.GRASS : TER.AIR; }
  for (let x = 0; x <= 12; x++) L.terrain[idx(x, 10, ZS)] = TER.SHALLOW;
  initRuntime(s);
  return s;
}
const tunnel = (s, x0, x1, y = 10, z = ZT) => { for (let x = x0; x <= x1; x++) mineTile(s, idx(x, y, z)); };
const dep = (s, x, y, z) => s.L.fluid[idx(x, y, z)] & 7;
function place(s, def, x, y, z) {
  const b = newBuilding(s.bld.length, def, x, y, 0, null, { z, st: 'done' });
  s.bld.push(b); refreshBuilding(s, b); return b;
}

test('a channel under the river floods z-1 and stops at walls', () => {
  const s = world();
  tunnel(s, 2, 16);
  step(s, 400);
  for (let x = 2; x <= 12; x++) assert.equal(dep(s, x, 10, ZT), 7, `under the river x ${x} full`);
  for (let x = 13; x <= 16; x++) assert.equal(dep(s, x, 10, ZT), 19 - x, `slope at x ${x}`);
  assert.equal(dep(s, 17, 10, ZT), 0, 'rock past the end stays dry');
  assert.equal(dep(s, 6, 9, ZT) + dep(s, 6, 11, ZT), 0, 'side walls hold');
  for (let i = 0; i < ZT * PLANE; i++) assert.equal(s.L.fluid[i] & 7, 0, 'nothing below z-1 (floors and rock)');
  assert.ok(activeCount(s) < FLOW.maxActive);
});

function gateScene(seed, gx = 14) {
  const s = world(seed);
  tunnel(s, 2, 24);
  const gate = place(s, 'floodgate', gx, 10, ZT);
  const lever = place(s, 'lever', gx, 12, ZT + 2);   // two levels up (z 5)
  assert.equal(link(s, gate.id, lever.id), null);
  return { s, gate, lever };
}

test('a closed floodgate holds a flood; a lever two levels up releases it; a raised bridge blocks', () => {
  const { s, gate, lever } = gateScene('FG');
  assert.ok(fluidBlocked(s, idx(14, 10, ZT)), 'closed floodgate is solid for fluid');
  step(s, 400);
  assert.ok(dep(s, 13, 10, ZT) > 0, 'flood reaches the gate');
  for (let x = 15; x <= 24; x++) assert.equal(dep(s, x, 10, ZT), 0, `held at x ${x}`);
  setLever(s, lever.id, GATE.OPEN);
  assert.ok(!fluidBlocked(s, idx(14, 10, ZT)));
  step(s, 400);
  for (let x = 15; x <= 18; x++) assert.ok(dep(s, x, 10, ZT) > 0, `released to x ${x}`);
  // raising bridge: lowered passes fluid, raised (LOCKED) is a wall
  const br = place(s, 'liftbridge', 20, 9, ZT);
  assert.ok(!fluidBlocked(s, idx(20, 10, ZT)));
  link(s, br.id, lever.id); setLever(s, lever.id, GATE.LOCKED);
  assert.ok(fluidBlocked(s, idx(20, 10, ZT)) && fluidBlocked(s, idx(14, 10, ZT)));
  void gate;
});

test('4,096 active cells step in < 0.1 ms desktop (2,048 per step) and the set is capped', () => {
  resetBus(); setWorldStage('3'); installWorld();
  const s = createColony('BENCH', { w: 128, d: 3, zS: 2 });
  s.L.fluid = new Uint8Array(N);
  for (let i = 0; i < N; i++) { const z = (i / PLANE) | 0; s.L.terrain[i] = z < 1 ? TER.ROCK : z === 1 ? TER.ROUGH : TER.GRASS; }
  initRuntime(s);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) s.L.fluid[idx(x, y, 1)] = 3;   // settled pond
  // rock rim so nothing spreads
  for (let y = 0; y <= 64; y++) for (let x = 0; x <= 64; x++) if (x === 64 || y === 64) s.L.terrain[idx(x, y, 1)] = TER.ROCK;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) activate(s, idx(x, y, 1));
  activate(s, idx(100, 100, 1)); activate(s, idx(101, 100, 1));
  assert.equal(activeCount(s), FLOW.maxActive);
  assert.equal(fluidRec(s).q.length, 2, 'overflow queues');
  for (let k = 0; k < 300; k++) { fluidStep(s, 'water'); fluidRec(s).idle.fill(0); }   // warm the JIT
  // best median of 3 rounds of 15, so a busy machine (full parallel suite) does not fail the gate
  let med = Infinity;
  for (let round = 0; round < 3; round++) {
    const ts = [];
    for (let k = 0; k < 15; k++) { const t0 = performance.now(); const r = fluidStep(s, 'water'); ts.push(performance.now() - t0); assert.ok(r.done <= FLOW.perStep); }
    ts.sort((a, b) => a - b);
    med = Math.min(med, ts[7]);
  }
  console.log(`fluid step 2,048 of 4,096 active: median ${(med * 1000).toFixed(1)} us`);
  assert.ok(med < 0.1, `step ${med} ms`);
  step(s, 40 * FLOW.water);
  assert.equal(activeCount(s), 0, 'a settled pond retires after idle steps');
});

/** A save mid-flood: the world record (JSON) and the layers travel; runtime is rebuilt. */
function reload(s) {
  const t = createColony('FL', { w: 32, d: 6, zS: ZS });
  for (const k of Object.keys(s.L)) t.L[k] = s.L[k].slice();
  t.bld = JSON.parse(JSON.stringify(s.bld)); t.tick = s.tick;
  t.colony.world = JSON.parse(JSON.stringify(s.colony.world));
  initRuntime(t);
  return t;
}
test('determinism with a save mid-flood', () => {
  const a = gateScene('FL').s; setLever(a, a.bld[1].id, GATE.OPEN); step(a, 300);
  const b0 = gateScene('FL').s; setLever(b0, b0.bld[1].id, GATE.OPEN); step(b0, 30);
  assert.ok(activeCount(b0) > 0, 'mid-flood');
  const b = reload(b0); step(b, 270);
  assert.deepEqual(Array.from(b.L.fluid), Array.from(a.L.fluid));
  assert.deepEqual(b.colony.world.fluid, a.colony.world.fluid);
});

test('scripted breach: a floodgate closed from a lever two levels away stops it', () => {
  const { s, lever } = gateScene('BOT', 16);
  setLever(s, lever.id, GATE.OPEN);
  // the script watches a sensor voxel before the gate; when water arrives it pulls the lever closed
  let closedAt = -1;
  for (let t = 0; t < 1200 && closedAt < 0; t++) {
    step(s, 1);
    if (dep(s, 14, 10, ZT) > 0) { setLever(s, lever.id, GATE.CLOSED); closedAt = s.tick; }
  }
  assert.ok(closedAt > 0, 'the breach arrived');
  const beyond = () => { let n = 0; for (let x = 17; x <= 24; x++) n += dep(s, x, 10, ZT); return n; };
  const b0 = beyond();
  step(s, 800);
  assert.ok(beyond() <= b0, 'nothing more passes the closed floodgate');
  assert.ok(dep(s, 15, 10, ZT) > 0, 'the flood is held on the river side');
  assert.ok(dep(s, 20, 10, ZT) === 0, 'and never reaches the far end');
});

test('water meets ember: cinderstone', () => {
  const s = world('EM');
  tunnel(s, 2, 16);
  s.L.fluid[idx(15, 10, ZT)] = 8 | 3;   // an ember pool in the tunnel
  step(s, 200);
  assert.equal(s.L.terrain[idx(15, 10, ZT)], TER.ROCK, 'the ember voxel set to rock');
  assert.equal(s.L.fluid[idx(15, 10, ZT)], 0);
  const f16 = s.L.fluid[idx(16, 10, ZT)];
  assert.ok(!(f16 & 7) || (f16 & 8), 'no water past the new stone (only ember that spread before)');
});

test('fluid render draws the view level only', async () => {
  const { FluidLayer } = await import('../../js/engine/render/fluids.js');
  const s = world('RN');
  s.L.fluid[idx(3, 3, ZT)] = 5; s.L.fluid[idx(4, 3, ZT)] = 8 | 2; s.L.fluid[idx(3, 3, ZS)] = 2;
  const calls = [];
  const g = { fillStyle: '', fillRect: (...a) => calls.push(a) };
  const view = { x0: 0, y0: 0, x1: 32 * 32, y1: 32 * 32 };
  const n = new FluidLayer().draw(g, s, view, ZT, 0);
  assert.equal(n, 2);
  assert.equal(calls.length, 3, 'two fills and one rim line on the deep voxel');
  assert.equal(new FluidLayer().draw(g, s, { x0: 400, y0: 400, x1: 600, y1: 600 }, ZT, 0), 0, 'culled to the view');
});

// Z3b: a seed-2 digger stood in a room that flooded to depth 6 (unwalkable), had no region and starved there
test('a colonist under deep water wades out to walkable footing, one tile per step', () => {
  const s = world('WADE');
  tunnel(s, 2, 16);
  step(s, 400);
  const at = (c) => idx(Math.floor(c.x / 32), Math.floor(c.y / 32), c.z);
  const c = { id: 99, x: 8 * 32 + 16, y: 10 * 32 + 16, z: ZT, hp: { dead: false }, path: [1] };
  s.col.push(c);
  assert.equal(passable(s, at(c), 0), false, 'depth 7 is not walkable');
  wadeOut(s);
  assert.equal(at(c), idx(9, 10, ZT), 'one tile toward the shallow end');
  assert.equal(c.path, null);
  for (let k = 0; k < 12; k++) wadeOut(s);
  assert.equal(passable(s, at(c), 0), true, 'on walkable footing');
  assert.equal(at(c), idx(16, 10, ZT), 'the nearest walkable voxel (depth 3)');
});

test('a colonist whose voxel turns to rock steps out to the nearest walkable voxel', () => {
  const s = world('TOMB');
  tunnel(s, 2, 10, 10, ZT);
  const c = { id: 98, x: 6 * 32 + 16, y: 10 * 32 + 16, z: ZT, hp: { dead: false }, path: null };
  s.col.push(c);
  s.L.terrain[idx(6, 10, ZT)] = TER.ROCK; initRuntime(s);
  wadeOut(s);
  const at = idx(Math.floor(c.x / 32), Math.floor(c.y / 32), c.z);
  assert.ok(at === idx(5, 10, ZT) || at === idx(7, 10, ZT), `out at ${at}`);
  assert.equal(passable(s, at, 0), true);
});
