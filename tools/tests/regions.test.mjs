// Workstream B (js/game/world/regions.js): cluster regions with two label sets and the region
// graph; dirty-cluster relabelling equals a full rebuild (C13).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createColony, initRuntime } from '../../js/game/core/state.js';
import { tick } from '../../js/game/core/sim.js';
import { resetBus } from '../../js/game/core/bus.js';
import { verifyCaches } from '../../js/game/core/rtcontract.js';
import { idx, TER, N, CW, CH, W } from '../../js/game/core/grid.js';
import { rint } from '../../js/game/core/rand.js';
import { installWorld, mineTile, setTerrain, regionOf, reachable, compOf, regionDist } from '../../js/game/world/terrain.js';
import { buildStubMap } from '../../js/game/world/stubmap.js';
import { LOCAL_MAX, clusterOfRegion, regionRebuild, regionGraphRebuild } from '../../js/game/world/regions.js';

const R_KEYS = ['region', 'regionH', 'regionGraph', 'walkCost', 'support', 'depth', 'occ'];

function bench(size = 64, seed = 3) {
  resetBus(); installWorld();
  const s = createColony('REG-' + seed, { w: size });
  buildStubMap(s, 'bench', seed);
  initRuntime(s);
  return s;
}

test('labels are canonical per 16 x 16 cluster and 0 on blocked tiles', () => {
  const s = bench();
  for (let i = 0; i < N; i++) {
    const r = s.rt.region[i];
    if (s.rt.walkCost[i] === 0) { assert.equal(r, 0); continue; }
    const c = (((i / W) | 0) >> 4) * CW + ((i % W) >> 4);
    assert.equal(clusterOfRegion(r), c, `tile ${i} label ${r} outside its cluster`);
    assert.ok((r - 1) % LOCAL_MAX < LOCAL_MAX);
  }
  assert.deepEqual(regionRebuild(s), s.rt.region);
  const g = s.rt.regionGraph.col;
  assert.equal(g.slots, CW * CH * LOCAL_MAX + 1);
  assert.ok(g.regions >= CW * CH, `${g.regions} regions`);
});

test('two label sets: doors join colonists only', () => {
  const s = bench(128, 3);
  const doors = s.bld.filter((b) => b && b.def.includes('door'));
  assert.equal(doors.length, 3);
  for (const d of doors) {
    const inside = idx(d.x, d.y - 1), outside = idx(d.x, d.y + 1);
    assert.ok(reachable(s, inside, outside, 'col'), 'colonists walk through the door');
    assert.ok(!reachable(s, inside, outside, 'hos'), 'hostiles are walled out');
    assert.equal(s.rt.regionH[idx(d.x, d.y)], 0);
    assert.notEqual(s.rt.region[idx(d.x, d.y)], 0);
  }
  assert.ok(s.rt.regionGraph.hos.regions > s.rt.regionGraph.col.regions, 'hostile set has the extra room regions');
});

test('relabelling only dirty clusters equals a full rebuild, tick after tick', () => {
  const s = bench(64, 5);
  const R = { rng: { main: 99 } };
  const rock = [];
  for (let i = 0; i < N; i++) if (s.L.terrain[i] === TER.ROCK) rock.push(i);
  for (let t = 0; t < 60; t++) {
    for (let k = 0; k < 6; k++) mineTile(s, rock[rint(R, 'main', 0, rock.length - 1)]);
    if (t % 7 === 0) setTerrain(s, rint(R, 'main', 0, N - 1), TER.DEEP);
    if (t % 11 === 0) setTerrain(s, rint(R, 'main', 0, N - 1), TER.ROCK, 3);
    tick(s);
    if (t % 5 === 0) assert.deepEqual(verifyCaches(s, R_KEYS), [], `tick ${s.tick}`);
  }
  assert.deepEqual(verifyCaches(s, R_KEYS), []);
  assert.deepEqual(regionGraphRebuild(s), s.rt.regionGraph);
});

test('mining into the sealed cavern connects it at the end of the tick', () => {
  const s = bench(128, 3);
  let cav = -1;
  for (let i = 0; i < N; i++) if (s.L.terrain[i] === TER.MOSS) { cav = i; break; }
  assert.ok(cav >= 0);
  const outside = idx(2, 2);
  assert.ok(!reachable(s, outside, cav));
  assert.equal(regionDist(s, outside, cav), Infinity);
  // dig a straight tunnel west from the cavern until it meets walkable ground outside the cavern
  const y = (cav / W) | 0;
  let exit = -1;
  for (let x = cav % W; x >= 0; x--) {
    const i = idx(x, y);
    if (s.L.terrain[i] === TER.ROCK) { mineTile(s, i); continue; }
    if (s.L.terrain[i] !== TER.MOSS && s.rt.walkCost[i] !== 0) { exit = i; break; }
  }
  assert.ok(exit >= 0, 'the tunnel reached open ground');
  assert.ok(!reachable(s, exit, cav), 'stale until the end-of-tick pass');
  tick(s);
  assert.ok(reachable(s, exit, cav), 'connected after the end-of-tick relabel');
  assert.ok(Number.isFinite(regionDist(s, exit, cav)));
  assert.deepEqual(verifyCaches(s, R_KEYS), []);
  assert.notEqual(regionOf(s, cav), 0);
});

test('Z1 E1 index types: u32 labels over all levels, 16 x 16 x 1 clusters, links only within a level (D = 3)', async () => {
  const G = await import('../../js/game/core/grid.js');
  const R = await import('../../js/game/world/regions.js');
  G.setMapSize(32, 32, 3, 2);
  const walk = new Uint8Array(G.N).fill(10);
  const lab = R.labelAll(walk, 0);
  assert.ok(lab instanceof Uint32Array && lab.length === 32 * 32 * 3);
  const g = R.buildGraph(lab);
  assert.equal(g.regions, 12, '4 clusters on each of 3 levels');
  assert.ok(g.links instanceof Float64Array && g.links.length === 12, '4 planar links per level');
  for (const k of g.links) assert.equal(R.clusterOfRegion(R.linkA(k)) >> 2, R.clusterOfRegion(R.linkB(k)) >> 2, 'same level');
  const comps = new Set([0, 1, 2].map((z) => g.comp[lab[G.idx(5, 5, z)]]));
  assert.equal(comps.size, 3, 'no vertical links before E3');
  assert.equal(lab[G.idx(20, 3, 1)], G.clusterOf(G.idx(20, 3, 1)) * R.LOCAL_MAX + 1, 'canonical labels');
  G.setMapSize(128);
});

// ---- Stage Z1 E3: vertical links, incremental only, canonical by value ---------------------------------------
test('E3 vertical links: a stair column joins the levels; components span levels; labels stay canonical', async () => {
  const G = await import('../../js/game/core/grid.js');
  const R = await import('../../js/game/world/regions.js');
  G.setMapSize(32, 32, 3, 2);
  const walk = new Uint8Array(G.N).fill(10), ter = new Uint8Array(G.N).fill(TER.ROUGH);
  ter[G.idx(5, 5, 0)] = TER.STAIR_U; ter[G.idx(5, 5, 1)] = TER.STAIR_UD; ter[G.idx(5, 5, 2)] = TER.STAIR_D;
  ter[G.idx(6, 5, 0)] = TER.STAIR_U; ter[G.idx(6, 5, 1)] = TER.STAIR_D;        // a second stair beside: same group
  ter[G.idx(20, 20, 0)] = TER.RAMP; ter[G.idx(20, 20, 1)] = TER.RAMP_TOP;     // a ramp elsewhere: a second group
  const lab = R.labelAll(walk, 0), g = R.buildGraph(lab, ter);
  const vert = [];
  for (let l = 0; l < g.links.length; l++) if (g.tb[l] - g.ta[l] === G.PLANE) vert.push([g.ta[l], g.tb[l]]);
  assert.deepEqual(vert.sort((a, b) => a[0] - b[0]), [[G.idx(5, 5, 0), G.idx(5, 5, 1)], [G.idx(20, 20, 0), G.idx(20, 20, 1)], [G.idx(5, 5, 1), G.idx(5, 5, 2)]].sort((a, b) => a[0] - b[0]));
  const comps = new Set([0, 1, 2].map((z) => g.comp[lab[G.idx(9, 9, z)]]));
  assert.equal(comps.size, 1, 'one component over three levels');
  assert.equal(g.comp[lab[G.idx(9, 9, 2)]], lab[G.idx(0, 0, 0)], 'the root is the smallest region id');
  G.setMapSize(128);
});

/** A stair write through the terrain API; a floor -> stair write keeps the walk cost, so it is flagged here
 *  until terrain.js flags vertical-connectivity changes itself (requested E3 -> B, terrain.js setTerrain). */
async function stairWrite(s, i, kind) {
  const { digStair } = await import('../../js/game/world/terrain.js');
  const r = digStair(s, i, kind);
  if (r && !s.rt.dirty.tiles.includes(i)) { s.rt.dirty.regions = true; s.rt.dirty.tiles.push(i); }
  return r;
}

for (const [kind, w, d] of [['flat3d', 48, 5], ['tower3d', 32, 8]]) {
  test(`E3 ${kind}: 1,000 random mine, stair and channel writes, the incremental graph equals a full rebuild by value`, async () => {
    const { buildStubMap: stub } = await import('../../js/game/world/stubmap.js');
    const G = await import('../../js/game/core/grid.js');
    const { channel } = await import('../../js/game/world/terrain.js');
    resetBus(); installWorld();
    const s = createColony('REG3-' + kind, { w, d });
    stub(s, kind, 21); initRuntime(s);
    const R = { rng: { main: 1234 } };
    const kinds = [TER.STAIR_U, TER.STAIR_D, TER.STAIR_UD];
    let writes = 0, mines = 0, stairs = 0, chans = 0, stamps = new Set([s.rt.regionGraph.col.stamp]);
    for (let t = 0; writes < 1000; t++) {
      for (let k = 0; k < 10; k++, writes++) {
        const i = rint(R, 'main', 0, G.N - 1);
        if (rint(R, 'main', 0, 2) === 0) { if (await stairWrite(s, i, kinds[rint(R, 'main', 0, 2)])) stairs++; }
        else if (s.L.terrain[i] === TER.ROCK) { if (mineTile(s, i)) mines++; }
        else if (rint(R, 'main', 0, 3) === 0) setTerrain(s, i, TER.ROCK, 3);
        else if (channel(s, i)) chans++;
      }
      tick(s);
      stamps.add(s.rt.regionGraph.col.stamp);
      if (t % 10 === 0) assert.deepEqual(regionGraphRebuild(s), s.rt.regionGraph, `tick ${s.tick}`);
    }
    assert.deepEqual(verifyCaches(s, ['region', 'regionH', 'regionGraph']), []);
    assert.deepEqual(regionGraphRebuild(s), s.rt.regionGraph);
    assert.ok(stairs > 50 && mines > 20 && chans > 10, `${stairs} stairs, ${mines} mined, ${chans} channels`);
    console.log(`# ${kind}: ${writes} writes (${mines} mined, ${stairs} stairs, ${chans} channels), ${stamps.size} link stamps, graph equal by value`);
  });
}

test('E3 a door splits the hostile labels only; a door-free cluster copies its colonist labels', () => {
  const s = bench(128, 3);
  assert.deepEqual(verifyCaches(s, ['region', 'regionH', 'regionGraph']), []);
  let same = 0, diff = 0;
  for (let i = 0; i < N; i++) if (s.rt.region[i] === s.rt.regionH[i]) same++; else diff++;
  assert.ok(diff > 0 && same > diff);
});
