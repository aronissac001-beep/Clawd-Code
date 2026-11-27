// Stage W0.3 (EMBERCROWN-WORLD.md 12.2, 11 item 2; EMBERCROWN-FORTRESS.md 2.8 Z3): the raising bridge can be built.
// Oracle: a lever raises it, the channel is sealed, fluid stops at it in a unit scene. Uses the real data row
// (js/data/structures/utility.js 'liftbridge'), placed with checkPlace and finished through construct.js, so a
// finished bridge stays a building (not the floor layer) and its art draws both states (kit2.js 'liftbridge').
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createColony, initRuntime } from '../../js/game/core/state.js';
import { resetBus } from '../../js/game/core/bus.js';
import { idx, TER, N, PLANE } from '../../js/game/core/grid.js';
import { newBuilding } from '../../js/game/core/schema.js';
import { step } from '../../js/game/core/sim.js';
import { checkPlace, addBuilding } from '../../js/game/core/apply.js';
import { completeBuilding } from '../../js/game/work/construct.js';
import { installWorld, mineTile, refreshBuilding, passable } from '../../js/game/world/terrain.js';
import { setWorldStage } from '../../js/game/world/worldrec.js';
import { CONTENT } from '../../js/data/index.js';
import { link, setLever, pullLever, gateMode, isGate, GATE } from '../../js/game/world/mechanisms.js';
import { fluidBlocked, bridgeRaised } from '../../js/game/world/fluids.js';
import { PARTS2, TOP2 } from '../../js/engine/art/kit2.js';
import { Px } from '../../js/engine/art/pixel.js';

const ZS = 4, ZT = ZS - 1, BX = 16;   // the surface, the channel level under it, the bridge's column
/** 32 x 32 x 6: rock below zS, grass on zS with a river strip (x 0-12, y 10); a 3-wide channel y 9-11 at zT. */
function scene(seed = 'LB') {
  resetBus(); setWorldStage('3'); installWorld();
  const s = createColony(seed, { w: 32, d: 6, zS: ZS });
  const L = s.L;
  L.fluid = new Uint8Array(N);
  for (let i = 0; i < N; i++) { const z = (i / PLANE) | 0; L.terrain[i] = z < ZS ? TER.ROCK : z === ZS ? TER.GRASS : TER.AIR; }
  for (let x = 0; x <= 12; x++) L.terrain[idx(x, 10, ZS)] = TER.SHALLOW;
  initRuntime(s);
  for (let y = 9; y <= 11; y++) for (let x = 2; x <= 26; x++) mineTile(s, idx(x, y, ZT));
  return s;
}
const dep = (s, x, y, z = ZT) => s.L.fluid[idx(x, y, z)] & 7;
const past = (s) => { let n = 0; for (let y = 9; y <= 11; y++) for (let x = BX + 1; x <= 26; x++) n += dep(s, x, y); return n; };
function buildBridge(s) {
  assert.equal(checkPlace(s, 'liftbridge', BX, 9, 0, ZT), null, 'placeable across the channel');
  const b = addBuilding(s, 'liftbridge', BX, 9, 0, null, { z: ZT });
  completeBuilding(s, b);
  return b;
}
function lever(s) {
  const b = newBuilding(s.bld.length, 'lever', BX, 13, 0, null, { z: ZT + 2, st: 'done' });   // two levels up
  s.bld.push(b); refreshBuilding(s, b); return b;
}

test('the data row: Mechanisms research, lockable, a 1 x 3 construct that is no floor', () => {
  const d = CONTENT.get('structure', 'liftbridge');
  assert.ok(d, 'liftbridge row exists');
  assert.equal(d.tech, 'mechanisms');
  assert.deepEqual(d.size, [1, 3]);
  assert.equal(d.kind, 'construct');
  for (const f of ['liftbridge', 'lockable']) assert.ok(d.flags.includes(f), f);
  assert.ok(!d.flags.includes('floor') && !d.flags.includes('door') && !d.flags.includes('wall'), 'no floor, door or wall flag');
  assert.ok(CONTENT.get('tech', 'mechanisms'), 'the Mechanisms research exists');
});

test('a lever raises it, the channel is sealed and fluid stops at it; lowered, it flows again', () => {
  const s = scene();
  const b = buildBridge(s);
  assert.equal(s.bld[b.id], b, 'a finished bridge stays a building');
  assert.equal(b.st, 'done');
  assert.ok(isGate(b));
  const lv = lever(s);
  assert.equal(link(s, b.id, lv.id), null);
  // lowered (the lever's resting mode): it passes fluid
  for (let y = 9; y <= 11; y++) assert.ok(!fluidBlocked(s, idx(BX, y, ZT)), `lowered passes fluid at y ${y}`);
  assert.ok(!bridgeRaised(s, b));
  // raise it: the lever holds it locked; pullLever goes closed > locked
  assert.equal(pullLever(s, lv.id), GATE.LOCKED);
  assert.equal(gateMode(s, b), GATE.LOCKED);
  assert.ok(bridgeRaised(s, b));
  for (let y = 9; y <= 11; y++) assert.ok(fluidBlocked(s, idx(BX, y, ZT)), `raised seals the channel at y ${y}`);
  // breach the river: the flood fills the channel up to the bridge and stops there
  step(s, 600);
  assert.ok(dep(s, BX - 1, 10) > 0, 'the flood reaches the bridge');
  for (let y = 9; y <= 11; y++) assert.equal(dep(s, BX, y), 0, `nothing in the raised bridge at y ${y}`);
  assert.equal(past(s), 0, 'nothing past the raised bridge');
  // lower it from the lever: the held water runs on
  setLever(s, lv.id, GATE.OPEN);
  assert.ok(!bridgeRaised(s, b));
  step(s, 400);
  assert.ok(past(s) > 0, 'released past the lowered bridge');
});

test('the same scene with no bridge floods past (the bridge is what holds it)', () => {
  const s = scene();
  step(s, 600);
  assert.ok(past(s) > 0);
});

test('determinism: two runs of the raised scene agree voxel for voxel', () => {
  const run = () => { const s = scene('LB2'); const b = buildBridge(s); const lv = lever(s); link(s, b.id, lv.id); setLever(s, lv.id, GATE.LOCKED); step(s, 500); return Array.from(s.L.fluid); };
  assert.deepEqual(run(), run());
});

test('walking: lowered it is crossed, raised it is a wall', () => {
  const s = scene();
  const b = buildBridge(s); const lv = lever(s); link(s, b.id, lv.id);
  assert.ok(passable(s, idx(BX, 10, ZT), 0), 'lowered: walkable');
  setLever(s, lv.id, GATE.LOCKED);
  assert.ok(!passable(s, idx(BX, 10, ZT), 0), 'raised: a wall');
});

/** Record the fills of a part into a w x h pixel grid (a fake 2D context). */
function paint(part, o, top) {
  const w = o.W + 4, hh = o.H + top + 4, grid = new Array(w * hh).fill(null);
  const g = { fillStyle: null, fillRect(x, y, rw, rh) { for (let j = y; j < y + rh; j++) for (let i = x; i < x + rw; i++) if (i >= 0 && j >= 0 && i < w && j < hh) grid[j * w + i] = this.fillStyle; } };
  PARTS2[part](new Px(g, 2, top + 2), o);
  return grid;
}
test('its art draws both states in both orientations (kit2.js liftbridge)', () => {
  assert.equal(typeof PARTS2.liftbridge, 'function');
  assert.ok(TOP2.liftbridge > 0);
  for (const [W, H] of [[16, 48], [48, 16]]) {
    const lo = paint('liftbridge', { W, H, open: 0 }, TOP2.liftbridge), hi = paint('liftbridge', { W, H, open: 1 }, TOP2.liftbridge);
    const filled = (a) => a.filter(Boolean).length, diff = lo.filter((c, i) => c !== hi[i]).length;
    assert.ok(filled(lo) >= W * H * 0.9, `lowered covers its footprint ${W}x${H}`);
    assert.ok(diff > W * H * 0.3, `raised differs from lowered ${W}x${H}: ${diff} px`);
    const above = (a) => a.slice(0, (TOP2.liftbridge + 2) * (W + 4)).filter(Boolean).length;
    assert.ok(above(hi) > above(lo), 'raised stands above the footprint');
  }
});
