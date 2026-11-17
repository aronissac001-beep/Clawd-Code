// Workstream B, contract C5 (js/game/world/terrain.js): the write API, invalidation flags and the
// read API on stub maps (doc 14.5 row B: "mineTile on a stub map flips terrain and sets the region,
// room, light and render dirty flags").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createColony, initRuntime } from '../../js/game/core/state.js';
import { tick } from '../../js/game/core/sim.js';
import { resetBus } from '../../js/game/core/bus.js';
import { verifyCaches, dirtyClear } from '../../js/game/core/rtcontract.js';
import { idx, TER, ROOF, getBit, W } from '../../js/game/core/grid.js';
import { newBuilding } from '../../js/game/core/schema.js';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../../js/game/core/time.js';
import {
  installWorld, mineTile, setTerrain, setFloor, setRoof, setOcc, onRenderDirty, lightAt, tempAt, regionOf,
  regionDist, reachable, passable, depthAt, supportAt, supported, WALK_DOOR, SUPPORT_CAP,
} from '../../js/game/world/terrain.js';
import { roofRockByDepth } from '../../js/game/world/stubmap.js';

const B_KEYS = ['occ', 'walkCost', 'support', 'depth', 'region', 'regionH', 'regionGraph'];

/** 32 x 32: grass west of x = 16, rock east of it, roofed by depth. */
function stub(seed = 'TER-1') {
  resetBus(); installWorld();
  const s = createColony(seed, { w: 32 });
  for (let y = 0; y < 32; y++) for (let x = 16; x < 32; x++) s.L.terrain[idx(x, y)] = TER.ROCK;
  s.L.ore[idx(16, 10)] = 3; s.L.ore[idx(17, 11)] = 4;
  roofRockByDepth(s);
  initRuntime(s);
  return s;
}

test('mineTile on a stub map flips terrain and sets the region, room, light and render dirty flags', () => {
  const s = stub();
  const i = idx(16, 10);
  const mat = s.L.mat[i];
  const seen = [];
  const off = onRenderDirty((t) => seen.push(t));
  assert.equal(s.rt.walkCost[i], 0);
  assert.equal(regionOf(s, i), 0);
  const r = mineTile(s, i, 7);
  off();
  assert.deepEqual(r, { mat, ore: 3, rubble: false, depth: 1 });
  assert.equal(s.L.terrain[i], TER.ROUGH);
  assert.equal(s.L.mat[i], mat, 'stone material kept');
  assert.equal(s.L.ore[i], 0, 'ore cleared');
  assert.equal(s.L.roof[i], ROOF.THIN, 'depth 1-4: thin roof');
  const d = s.rt.dirty;
  assert.ok(d.regions && d.rooms && d.light && d.temperature, 'region, room, temperature and light flags');
  assert.ok(d.tiles.includes(i), 'tile in the dirty area list');
  assert.deepEqual(seen, [i], 'render patch queued');
  assert.equal(s.rt.walkCost[i], 10, 'walk cost updated at once (incremental)');
  for (const [x, y] of [[15, 9], [17, 10], [17, 11], [16, 11]]) assert.equal(getBit(s.L.known, idx(x, y)), 1, `known ${x},${y}`);
  const ev = s.rt.events.map((e) => e.name);
  assert.ok(ev.includes('mined') && ev.includes('oreFound'));
  assert.equal(s.rt.events.find((e) => e.name === 'mined').data.colId, 7);
  // regions relabel at the end of the tick; then every B cache equals a from-scratch rebuild
  assert.equal(regionOf(s, i), 0, 'labels are end-of-tick');
  tick(s);
  assert.ok(dirtyClear(s.rt.dirty));
  assert.notEqual(regionOf(s, i), 0);
  assert.ok(reachable(s, i, idx(3, 3)), 'the mined tile joins the open ground');
  assert.deepEqual(verifyCaches(s, B_KEYS), []);
});

test('mineTile refuses non-mineable tiles and changes nothing', () => {
  const s = stub();
  assert.equal(mineTile(s, idx(3, 3)), null);
  assert.ok(dirtyClear(s.rt.dirty));
  assert.equal(s.rt.events.length, 0);
});

test('deep mining: overhead roof, depth unchanged, support patched exactly', () => {
  const s = stub('TER-2');
  const depth0 = s.rt.depth.slice();
  // a 9-long tunnel from the face, then a 5 x 5 hall at its end
  for (let x = 16; x <= 24; x++) mineTile(s, idx(x, 16));
  for (let y = 14; y <= 18; y++) for (let x = 25; x <= 29; x++) mineTile(s, idx(x, y));
  assert.equal(s.L.roof[idx(16, 16)], ROOF.THIN);
  assert.equal(s.L.roof[idx(24, 16)], ROOF.MOUNTAIN, 'depth >= 5: overhead mountain');
  assert.deepEqual(s.rt.depth, depth0, 'mining never changes depth');
  assert.equal(depthAt(s, idx(24, 16)), 9);
  assert.equal(supportAt(s, idx(27, 16)), 3, 'hall centre: 3 tiles to the nearest rock');
  assert.ok(supported(s, idx(27, 16)));
  assert.equal(supportAt(s, idx(3, 3)), SUPPORT_CAP, 'open ground far from rock is capped');
  tick(s);
  assert.deepEqual(verifyCaches(s, B_KEYS), []);
});

test('setOcc: a wall splits regions, a door joins colonists and blocks hostiles', () => {
  const s = stub('TER-3');
  // a vertical line of walls at x = 8 from y = 0 to 31 with a door at y = 20
  for (let y = 0; y < 32; y++) {
    const b = newBuilding(s.bld.length, y === 20 ? 'door_wood' : 'wall_stone', 8, y, 0, 'granite', { st: 'done' });
    s.bld.push(b);
    setOcc(s, b, true);
  }
  assert.equal(s.rt.walkCost[idx(8, 5)], 0);
  assert.equal(s.rt.walkCost[idx(8, 20)], WALK_DOOR);
  assert.ok(s.rt.dirty.regions && s.rt.dirty.rooms && s.rt.dirty.light);
  assert.ok(s.rt.dirty.tiles.includes(idx(8, 5)));
  tick(s);
  const a = idx(2, 2), b = idx(12, 2);
  assert.ok(reachable(s, a, b, 'col'), 'colonists pass the door');
  assert.ok(!reachable(s, a, b, 'hos'), 'hostiles do not');
  assert.ok(passable(s, idx(8, 20), 0) && !passable(s, idx(8, 20), 1));
  assert.ok(Number.isFinite(regionDist(s, a, b, 0)) && regionDist(s, a, b, 1) === Infinity);
  assert.deepEqual(verifyCaches(s, B_KEYS), []);
  // the door goes: hostiles are now cut off completely, colonists too
  const door = s.bld[20];
  setOcc(s, door, false); s.bld[20] = null;
  const wall = newBuilding(20, 'wall_stone', 8, 20, 0, 'granite', { st: 'done' });
  s.bld[20] = wall; setOcc(s, wall, true);
  tick(s);
  assert.ok(!reachable(s, a, b, 'col'));
  assert.deepEqual(verifyCaches(s, B_KEYS), []);
  // a blueprint does not block
  const bp = newBuilding(s.bld.length, 'wall_stone', 4, 4, 0, 'granite', { st: 'bp' });
  s.bld.push(bp); setOcc(s, bp, true);
  assert.equal(s.rt.walkCost[idx(4, 4)], 10);
  assert.equal(s.rt.occ[idx(4, 4)], bp.id);
});

test('setFloor and setRoof set only what they feed; depth follows roofs on open ground', () => {
  const s = stub('TER-4');
  const i = idx(5, 5);
  assert.ok(setFloor(s, i, 2));
  assert.ok(s.rt.dirty.rooms && !s.rt.dirty.regions && !s.rt.dirty.light);
  tick(s);
  // roofing open ground with a built roof keeps it a depth source
  setRoof(s, i, ROOF.BUILT);
  assert.ok(s.rt.dirty.light && s.rt.dirty.temperature && !s.rt.dirty.regions);
  tick(s);
  assert.deepEqual(verifyCaches(s, ['depth']), []);
  // a thin rock roof over the strip next to the massif makes it count as rock for depth
  for (let y = 0; y < 32; y++) setRoof(s, idx(15, y), ROOF.THIN);
  assert.equal(depthAt(s, idx(16, 0)), 2);
  tick(s);
  assert.deepEqual(verifyCaches(s, B_KEYS), []);
  // terrain writes: rock to rubble keeps support, water blocks
  setTerrain(s, idx(16, 2), TER.RUBBLE);
  setTerrain(s, idx(4, 9), TER.DEEP);
  assert.equal(s.rt.walkCost[idx(4, 9)], 0);
  assert.ok(s.rt.dirty.regions);
  tick(s);
  assert.deepEqual(verifyCaches(s, B_KEYS), []);
});

test('read API: light, temperature by season and underground, region distance', () => {
  const s = stub('TER-5');
  s.rt.light[idx(3, 3)] = 2;
  assert.equal(lightAt(s, idx(3, 3)), 2);
  s.tick = 12 * TICKS_PER_HOUR;                        // Thaw, midday
  assert.equal(tempAt(s, idx(3, 3)), 10);
  s.tick = 10 * TICKS_PER_DAY + 12 * TICKS_PER_HOUR;  // Highsun
  assert.equal(tempAt(s, idx(3, 3)), 22);
  s.tick = 30 * TICKS_PER_DAY + 2 * TICKS_PER_HOUR;   // Deepcold, night
  assert.equal(tempAt(s, idx(3, 3)), -10);
  for (let x = 16; x <= 26; x++) mineTile(s, idx(x, 4));
  assert.equal(tempAt(s, idx(26, 4)), 12, 'depth >= 5 under rock: 12 C');
  const shallow = tempAt(s, idx(17, 4));               // depth 2: blended toward 12 C
  assert.ok(shallow > -10 && shallow < 12, `blended ${shallow}`);
  s.rt.heat[idx(3, 3)] = 5;
  assert.equal(tempAt(s, idx(3, 3)), -5);
  tick(s);
  const d1 = regionDist(s, idx(0, 0), idx(26, 4));
  assert.ok(Number.isFinite(d1) && d1 >= 10 * 26, `region distance ${d1}`);
  assert.equal(regionDist(s, idx(0, 0), idx(30, 30)), Infinity, 'inside rock: unreachable');
  assert.equal(W, 32);
});
