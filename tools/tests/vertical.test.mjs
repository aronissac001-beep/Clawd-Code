// Stage Z1 E2 (owner B): vertical terrain (js/game/world/vertical.js and the terrain API writes): links,
// stairs, ramps, channels, falling, cover and skyZ, the spatial hash by level (EMBERCROWN-FORTRESS.md 2.3,
// 2.4, 8.3 E2 Oracle: a 3-level stair column links z..z-2 and nothing else; a channel over rock makes a ramp
// and an item on it falls).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createColony, initRuntime } from '../../js/game/core/state.js';
import { resetBus } from '../../js/game/core/bus.js';
import { idx, TER, ROOF, TILE, W, D, N, PLANE } from '../../js/game/core/grid.js';
import { newColonist, newStack } from '../../js/game/core/schema.js';
import { rint } from '../../js/game/core/rand.js';
import {
  installWorld, linksOf, digStair, digRamp, channel, buildFloor, setTerrain, setRoof, mineTile, onFall, canRamp,
  stairKindAt, coverAt, skyZAt,
} from '../../js/game/world/terrain.js';
import { coverRebuild, skyZRebuild } from '../../js/game/world/vertical.js';
import { buildStubMap } from '../../js/game/world/stubmap.js';
import { findPath, installMovement, GOAL } from '../../js/game/systems/pathing.js';
import { endOfTick } from '../../js/game/core/sim.js';
import { buildSpatial, near } from '../../js/game/systems/spatial.js';

/** A d-level column world: solid rock below the top level, grass on the top level, 32 x 32. */
function rockWorld(d = 6) {
  resetBus(); installWorld(); installMovement();
  const s = createColony('V-' + d, { w: 32, d });
  s.L.terrain.fill(TER.ROCK);
  for (let i = (D - 1) * PLANE; i < N; i++) s.L.terrain[i] = TER.GRASS;
  initRuntime(s);
  // the cover / skyZ caches until A lists them in rtcontract (then initRuntime builds them)
  if (!s.rt.cover) s.rt.cover = coverRebuild(s);
  if (!s.rt.skyZ) s.rt.skyZ = skyZRebuild(s);
  return s;
}

test('a 3-level stair column links z..z-2 and nothing else', () => {
  const s = rockWorld(6);
  const top = D - 1, x = 10, y = 10;
  // open a floor at the top (grass) and carve a stack of 3 from z top-1 down to top-3
  const zTop = top - 1, zBot = top - 3;
  for (let z = zTop; z >= zBot; z--) assert.ok(digStair(s, idx(x, y, z), stairKindAt(z, zTop, zBot)), `stair at ${z}`);
  assert.equal(s.L.terrain[idx(x, y, zTop)], TER.STAIR_D);
  assert.equal(s.L.terrain[idx(x, y, zTop - 1)], TER.STAIR_UD);
  assert.equal(s.L.terrain[idx(x, y, zBot)], TER.STAIR_U);
  assert.deepEqual(linksOf(s, idx(x, y, zTop)), [idx(x, y, zTop - 1)]);
  assert.deepEqual(linksOf(s, idx(x, y, zTop - 1)), [idx(x, y, zTop), idx(x, y, zBot)]);
  assert.deepEqual(linksOf(s, idx(x, y, zBot)), [idx(x, y, zTop - 1)]);
  assert.deepEqual(linksOf(s, idx(x, y, top)), [], 'the grass above a down stair is not a down voxel');
  assert.deepEqual(linksOf(s, idx(x, y, zBot - 1)), [], 'the rock below the up stair');
  // no other voxel anywhere links
  let others = 0;
  for (let i = 0; i < N; i++) if (i % PLANE !== idx(x, y, 0) && linksOf(s, i).length) others++;
  assert.equal(others, 0);
  // pathing agrees: zTop to zBot through the stack (vertical cost 2 x 200); top level and below are cut off.
  // From E3 the region pre-check runs at D > 1 on the end-of-tick labels, so the tick end comes first.
  endOfTick(s);
  const r = findPath(s, idx(x, y, zTop), idx(x, y, zBot), GOAL.TILE, 0, N);
  assert.equal(r.status, 'ok'); assert.equal(r.cost, 400); assert.equal(r.tiles.length, 2);
  assert.equal(findPath(s, idx(x, y, zTop), idx(x + 1, y, top), GOAL.TILE, 0, N).status, 'unreachable');
  assert.equal(findPath(s, idx(x, y, zTop), idx(x + 1, y, top), GOAL.TILE, 0, N, { noRegionCheck: true }).status, 'fail');
});

test('a channel over rock makes a ramp; an item and a colonist on it fall onto the ramp', () => {
  const s = rockWorld(5);
  const top = D - 1, i = idx(8, 8, top);
  const st = newStack(0, 'stone', null, 0, 3, 8, 8); st.z = top; s.items.push(st);
  const c = newColonist(0, { x: 8 * TILE + 16, y: 8 * TILE + 16 }); c.z = top; s.col.push(c);
  const fell = [];
  const off = onFall((_s, f) => fell.push([f.kind, f.from, f.to, f.levels, f.dmg, f.hp]));
  const r = channel(s, i);
  off();
  assert.ok(r);
  assert.equal(r.here, TER.RAMP_TOP);
  assert.ok(r.below, 'the rock below was mined into the ramp (its yield is returned)');
  assert.equal(s.L.terrain[i], TER.RAMP_TOP);
  assert.equal(s.L.terrain[i - PLANE], TER.RAMP);
  assert.deepEqual(linksOf(s, i), [i - PLANE]);
  assert.deepEqual(fell, [['col', i, i - PLANE, 1, 0, 0], ['item', i, i - PLANE, 1, 0, 25]]);
  assert.equal(c.z, top - 1);
});

test('a channel over open floor makes air; movers fall to the first floor below with fall damage', () => {
  const s = rockWorld(6);
  const top = D - 1, x = 5, y = 5;
  // a shaft: mine z top-1 and top-2 at (x, y) and channel them from below upward is not allowed; dig a 4-level drop
  mineTile(s, idx(x, y, top - 4));                      // the landing floor 4 levels down
  for (let z = top - 3; z <= top - 1; z++) setTerrain(s, idx(x, y, z), TER.AIR);
  const c = newColonist(0, { x: x * TILE + 16, y: y * TILE + 16 }); c.z = top; s.col.push(c);
  const fell = [];
  onFall((_s, f) => fell.push([f.kind, f.levels, f.dmg]));
  const r = channel(s, idx(x, y, top));
  assert.equal(r.here, TER.AIR); assert.equal(r.below, null);
  assert.equal(c.z, top - 4);
  assert.deepEqual(fell, [['col', 4, 30]], '10 blunt per level beyond the first');
  assert.equal(channel(s, idx(x, y, top)), null, 'air cannot be channelled');
  assert.equal(channel(s, idx(1, 1, 0)), null, 'level 0 has nothing below');
});

test('ramps need a solid planar neighbour and open space above; built floors close air', () => {
  const s = rockWorld(4);
  const top = D - 1;
  // mine a 3 x 3 room on top-1 (rock all round), then a ramp at its middle-edge voxel leaning on the wall
  for (let y = 10; y <= 12; y++) for (let x = 10; x <= 12; x++) mineTile(s, idx(x, y, top - 1));
  setTerrain(s, idx(10, 11, top), TER.AIR);              // open space over the ramp spot
  assert.ok(canRamp(s, idx(10, 11, top - 1)));
  assert.ok(digRamp(s, idx(10, 11, top - 1)));
  assert.equal(s.L.terrain[idx(10, 11, top - 1)], TER.RAMP);
  assert.equal(s.L.terrain[idx(10, 11, top)], TER.RAMP_TOP);
  assert.deepEqual(linksOf(s, idx(10, 11, top - 1)), [idx(10, 11, top)]);
  // a voxel in the middle of a big open floor has no rock to lean on
  resetBus(); installWorld();
  const f = createColony('V-flat', { w: 32, d: 3 });
  assert.equal(canRamp(f, idx(16, 16, 0)), false);
  // built floor over air
  assert.equal(buildFloor(s, idx(11, 11, top - 1)), false, 'only over air');
  setTerrain(s, idx(11, 11, top), TER.AIR);
  assert.ok(buildFloor(s, idx(11, 11, top), 2));
  assert.equal(s.L.terrain[idx(11, 11, top)], TER.ROUGH);
  assert.equal(s.L.floor[idx(11, 11, top)], 2);
});

test('cover and skyZ: rules, and the incremental caches equal a rebuild after 1,000 random writes', () => {
  const s = rockWorld(6);
  const top = D - 1, c = idx(3, 3, 0);
  assert.equal(skyZAt(s, c), top, 'grass on top: the sky stops at the surface');
  assert.equal(coverAt(s, idx(3, 3, top)), 0);
  assert.equal(coverAt(s, idx(3, 3, top - 1)), 1);
  assert.equal(coverAt(s, idx(3, 3, top - 2)), 2);
  assert.equal(coverAt(s, idx(3, 3, 0)), 3, 'capped at 3');
  // a channelled shaft: open air all the way down to a floor 3 levels below the surface
  mineTile(s, idx(3, 3, top - 3));
  for (let z = top; z >= top - 2; z--) setTerrain(s, idx(3, 3, z), TER.AIR);
  assert.equal(skyZAt(s, c), top - 3, 'a shaft lets the sky down to its floor');
  assert.equal(coverAt(s, idx(3, 3, top - 3)), 0);
  // a built roof over the shaft top
  setRoof(s, idx(3, 3, top), ROOF.BUILT);
  assert.equal(skyZAt(s, c), top + 1);
  assert.equal(coverAt(s, idx(3, 3, top)), 1);
  assert.equal(coverAt(s, idx(3, 3, top - 3)), 1);
  // random writes, then compare by value
  const R = { rng: { main: 77 } };
  const ters = [TER.AIR, TER.ROCK, TER.ROUGH, TER.GRASS, TER.STAIR_UD, TER.RAMP_TOP];
  for (let k = 0; k < 1000; k++) {
    const i = rint(R, 'main', 0, N - 1);
    if (rint(R, 'main', 0, 4) === 0) setRoof(s, i, rint(R, 'main', 0, 1) ? ROOF.BUILT : ROOF.OPEN);
    else setTerrain(s, i, ters[rint(R, 'main', 0, ters.length - 1)]);
  }
  assert.deepEqual(s.rt.cover, coverRebuild(s));
  assert.deepEqual(s.rt.skyZ, skyZRebuild(s));
  for (let i = 0; i < N; i++) assert.equal(s.rt.cover[i] === 0, ((i / PLANE) | 0) >= s.rt.skyZ[i % PLANE]);
});

test('stub maps flat3d and tower3d are deterministic, and every stair or ramp voxel is a link end', () => {
  for (const kind of ['flat3d', 'tower3d']) {
    resetBus(); installWorld();
    const a = createColony('V-' + kind, { w: 32, d: 5 }); buildStubMap(a, kind, 9); initRuntime(a);
    const b = createColony('V-' + kind, { w: 32, d: 5 }); buildStubMap(b, kind, 9); initRuntime(b);
    assert.deepEqual(a.L.terrain, b.L.terrain);
    let ends = 0;
    for (let i = 0; i < N; i++) {
      const t = a.L.terrain[i];
      if (t >= TER.STAIR_U && t <= TER.RAMP_TOP) { assert.ok(linksOf(a, i).length >= 1, `${kind} ${t} at ${i} links`); ends++; }
    }
    assert.ok(ends >= (kind === 'tower3d' ? 8 : 40), `${kind}: ${ends} link ends`);
  }
});

test('D = 1: mining is Stage 2 mining (roof by depth), and no vertical voxel is ever made', () => {
  resetBus(); installWorld();
  const s = createColony('V-D1', { w: 32 });
  buildStubMap(s, 'bench', 1); initRuntime(s);
  let i = 0; while (s.L.terrain[i] !== TER.ROCK) i++;
  const roof = s.rt.depth[i] >= 5 ? ROOF.MOUNTAIN : ROOF.THIN;
  assert.ok(mineTile(s, i));
  assert.equal(s.L.terrain[i], TER.ROUGH);
  assert.ok(s.L.roof[i] === roof || s.L.roof[i] === ROOF.MOUNTAIN);
  assert.equal(channel(s, i), null, 'no level below at D = 1');
  assert.equal(digRamp(s, i), null, 'no level above at D = 1');
  assert.deepEqual(linksOf(s, i), []);
});

test('the spatial hash is keyed by level', () => {
  resetBus(); installWorld();
  const s = createColony('V-sp', { w: 32, d: 3 });
  for (let k = 0; k < 6; k++) { const c = newColonist(k, { x: 100 + k * 3, y: 100 }); c.z = k % 3; s.col.push(c); }
  const sp = buildSpatial(s);
  assert.deepEqual(near(sp, 'col', 100, 100, 1, 64).map((c) => c.id), [1, 4]);
  assert.deepEqual(near(sp, 'col', 100, 100, 0, 64).map((c) => c.id), [0, 3]);
  assert.deepEqual(near(sp, 'col', 900, 900, 0, 64), []);
});
