// Stage Z1 E4 (owner B): world systems across levels (EMBERCROWN-FORTRESS.md 2.5-2.9, 8.3 E4 Oracle).
//   support and collapse per level (10 x 10 stone hall falls and opens air above, 9 x 9 stands; soil 6 x 6 falls,
//   5 x 5 stands; a hanging floor over a shaft; a chain one level per rumble); per-level light (a shaft lights
//   its bottom by day only; an ordinary mine dirties 1 level, a channel 3; a day-phase change relights one
//   level per tick and a save mid-sequence continues identically); temperature by cover and band (a cellar
//   with cover >= 3 sits at 12 C); fog and Sounding (3 levels below); the static fluid layer (seeps); claims by
//   column; the plant cluster list; fire rising; and every per-level cache equal to its rebuild by value after
//   a seeded run of mine, stair, channel, roof and wall writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createColony, initRuntime } from '../../js/game/core/state.js';
import { resetBus } from '../../js/game/core/bus.js';
import { idx, TER, ROOF, W, D, N, PLANE, zS, getBit } from '../../js/game/core/grid.js';
import { tick, endOfTick } from '../../js/game/core/sim.js';
import { phaseOf, TICKS_PER_DAY, seasonOf } from '../../js/game/core/time.js';
import { rtEqual, savedKeys } from '../../js/game/core/rtcontract.js';
import { installWorld, mineTile, channel, digStair, setTerrain, setRoof, setOcc, tempAt, stairKindAt } from '../../js/game/world/terrain.js';
import { coverRebuild, skyZRebuild } from '../../js/game/world/vertical.js';
import { supportRebuild, setFluid, fluidAt, walkRebuild, occRebuild, FL } from '../../js/game/world/pass.js';
import { caveSystem, unsupportedCount, planLevels } from '../../js/game/world/support.js';
import { lightRebuild, lastRelit, lightQueue } from '../../js/game/world/light.js';
import { roomsBuild } from '../../js/game/world/rooms.js';
import { tempRebuild, levelBand } from '../../js/game/world/temperature.js';
import { sounding, sight3, revealKnown } from '../../js/game/world/fog.js';
import { claimRebuild, claimMap } from '../../js/game/world/claims.js';
import { plantClusters, installPlants } from '../../js/game/world/plants.js';
import { ignite, fireSystem } from '../../js/game/world/fire.js';
import { newBuilding, newColonist } from '../../js/game/core/schema.js';
import { worldStage2 } from '../../js/game/world/worldrec.js';
import { rint } from '../../js/game/core/rand.js';
import { FLUID } from '../../js/data/levels.js';

/** cover and skyZ until A lists them in rtcontract (then initRuntime builds them). */
function caches(s) {
  if (!s.rt.cover) s.rt.cover = coverRebuild(s);
  if (!s.rt.skyZ) s.rt.skyZ = skyZRebuild(s);
  return s;
}
/**
 * A d-level world, w wide: rock below the surface zs, grass on it, open air above. `carve(L)` edits the layers
 * before the runtime is built.
 */
function world({ w = 48, d = 10, zs = 7, stage = '2', carve = null, seed = 'W3' } = {}) {
  resetBus(); installWorld({ stage });
  const s = createColony(seed, { w, d, zS: zs });
  const L = s.L;
  for (let i = 0; i < N; i++) { const z = (i / PLANE) | 0; L.terrain[i] = z < zs ? TER.ROCK : z === zs ? TER.GRASS : TER.AIR; L.mat[i] = z < zs ? 3 : 0; }
  L.fluid = new Uint8Array(N);
  if (carve) carve(L, s);
  initRuntime(s);
  return caches(s);
}
const hall = (L, z, x0, y0, n, m = n) => { for (let y = y0; y < y0 + m; y++) for (let x = x0; x < x0 + n; x++) L.terrain[idx(x, y, z)] = TER.ROUGH; };
/** Run the Stage 2 rumble queue to the end (each round advances the clock past the rumble). */
function rumbleOut(s, rounds = 10) {
  for (let k = 0; k < rounds; k++) { const q = s.colony.world && s.colony.world.caveQ; if (!q || !q.length) break; s.tick = Math.max(...q.map((e) => e[1])); caveSystem(s); endOfTick(s); }
}
const count = (s, z, ter) => { let n = 0; for (let i = z * PLANE; i < (z + 1) * PLANE; i++) if (s.L.terrain[i] === ter) n++; return n; };

function hallCollapse(n, rel, pillar = true) {
  const zs = 7, z = zs + rel;
  const c = 10 + (n >> 1);
  const s = world({ zs, carve: (L) => { hall(L, z, 10, 10, n); if (pillar) L.terrain[idx(c, c, z)] = TER.ROCK; } });
  assert.equal(worldStage2(), true);
  assert.equal(unsupportedCount(s), 0, 'the pillar holds the hall');
  mineTile(s, idx(c, c, z));
  rumbleOut(s);
  return { s, z, rubble: count(s, z, TER.RUBBLE), air: count(s, z + 1, TER.AIR) };
}

test('2.5: a 10 x 10 unsupported stone hall collapses into rubble and opens air above; a 9 x 9 stands', () => {
  const big = hallCollapse(10, -4);
  assert.equal(levelBand(big.z + 1).soil, false, 'the ceiling is stone');
  assert.ok(big.rubble > 0, `10 x 10: ${big.rubble} voxels of rubble`);
  assert.ok(big.air >= big.rubble, `10 x 10: ${big.air} voxels of open air above (sinkholes)`);
  for (let i = big.z * PLANE; i < (big.z + 1) * PLANE; i++) if (big.s.L.terrain[i] === TER.RUBBLE) assert.equal(big.s.L.terrain[i + PLANE], TER.AIR, 'every rubble voxel has a sinkhole above');
  const ok = hallCollapse(9, -4);
  assert.equal(ok.rubble, 0, '9 x 9 stands');
  assert.equal(ok.air, 0);
});

test('2.5: in soil a 6 x 6 collapses and a 5 x 5 does not', () => {
  const big = hallCollapse(6, -2);
  assert.equal(levelBand(big.z + 1).soil, true, 'the ceiling is topsoil');
  assert.ok(big.rubble > 0, `6 x 6 in soil: ${big.rubble} rubble`);
  const ok = hallCollapse(5, -2);
  assert.equal(ok.rubble, 0, '5 x 5 in soil stands');
  // the same 6 x 6 in stone stands
  const stone = hallCollapse(6, -4);
  assert.equal(stone.rubble, 0);
});

test('2.5: a hanging floor over a shaft; a 9-wide bridge holds, a 10-wide one falls; chains go one level per rumble', () => {
  for (const [span, falls] of [[9, false], [10, true]]) {
    const zs = 7, x1 = 10 + span;            // the bridge: x 11..x1 at y 11 on the surface, over a shaft
    const s = world({ zs, carve: (L) => {
      for (let y = 4; y <= 18; y++) for (let x = 11; x <= x1; x++) { L.terrain[idx(x, y, zs - 1)] = TER.AIR; if (y !== 11) L.terrain[idx(x, y, zs)] = TER.AIR; }
      for (let x = 11; x <= x1; x++) L.terrain[idx(x, 11, zs)] = TER.ROUGH;
      L.terrain[idx(11, 11, zs - 1)] = TER.ROCK;               // one rock voxel under the bridge's first tile
    } });
    assert.equal(unsupportedCount(s), 0);
    setTerrain(s, idx(11, 11, zs - 1), TER.AIR);               // it goes: the bridge now spans 10 + 1 .. x1 + 1
    rumbleOut(s);
    const mid = idx(10 + ((span + 2) >> 1), 11, zs);
    assert.equal(s.L.terrain[mid] === TER.AIR, falls, `bridge of ${span}: the middle ${s.L.terrain[mid] === TER.AIR ? 'fell' : 'held'}`);
  }
  // a chain: a wide hall at z comes down and opens sinkholes at z + 1; the surface floor at z + 2 over them then
  // hangs and lets go a rumble later, never in the same tick
  const zs = 8, z = zs - 2;
  const s = world({ zs, d: 12, carve: (L) => { hall(L, z, 8, 8, 22); L.terrain[idx(19, 19, z)] = TER.ROCK; } });
  mineTile(s, idx(19, 19, z));
  const q0 = s.colony.world.caveQ.length;
  assert.ok(q0 > 0, 'the hall rumbles first');
  s.tick = s.colony.world.caveQ[0][1]; caveSystem(s); endOfTick(s);
  const zUp = z + 1, airUp = count(s, zUp, TER.AIR);
  assert.ok(count(s, z, TER.RUBBLE) > 0 && airUp > 0, `collapsed: ${count(s, z, TER.RUBBLE)} rubble, ${airUp} sinkholes`);
  const next = s.colony.world.caveQ.filter((e) => ((e[0] / PLANE) | 0) === z + 2).length;
  assert.ok(next > 0, `the chain waits a rumble: ${next} voxels at z + 2 rumble`);
  assert.equal(count(s, z + 2, TER.AIR), 0, 'nothing at z + 2 fell in the same tick');
  rumbleOut(s);
  assert.ok(count(s, z + 2, TER.AIR) > 0, 'then it falls');
});

test('2.5 planning: a channel preview stripes the floors above that would hang', () => {
  const zs = 7, z = zs - 3;
  const s = world({ zs, carve: (L) => { hall(L, z, 10, 10, 12, 12); hall(L, z + 1, 10, 10, 12, 12); } });
  const ch = []; for (let y = 10; y < 22; y++) for (let x = 10; x < 22; x++) ch.push(idx(x, y, z));
  const p = planLevels(s, { x0: 10, y0: 10, x1: 21, y1: 21, z }, null, ch);
  // channelling the whole 12 x 12 leaves the middle of the floor above over air with no anchor within 4
  assert.ok(p.above.length > 0, `${p.above.length} voxels striped on the level above`);
  for (const j of p.above) assert.equal((j / PLANE) | 0, z + 1);
});

test('2.6: a shaft lights its bottom by day only', () => {
  const zs = 8;
  const s = world({ zs, d: 12, carve: (L) => { for (let z = zs; z > zs - 5; z--) L.terrain[idx(20, 20, z)] = TER.AIR; L.terrain[idx(20, 20, zs - 5)] = TER.ROUGH; } });
  let day = -1, night = -1;
  for (let t = 0; t < TICKS_PER_DAY && (day < 0 || night < 0); t += 60) { const p = phaseOf(t); if (p === 'day' && day < 0) day = t; if (p === 'night' && night < 0) night = t; }
  const bottom = idx(20, 20, zs - 5);
  s.tick = day; let l = lightRebuild(s);
  assert.equal(l[bottom], 3, 'day: the shaft bottom is in full daylight');
  assert.equal(l[idx(20, 20, zs - 6)], 0, 'the rock under it is dark');
  assert.equal(l[idx(30, 30, zs - 5)], 0, 'rock elsewhere on the level is dark');
  s.tick = night; l = lightRebuild(s);
  assert.equal(l[bottom], 0, 'night: dark');
});

test('2.6: an ordinary mine dirties 1 level, a channel 3', () => {
  const zs = 8, z = zs - 4;
  const s = world({ zs, d: 12, carve: (L) => { hall(L, z, 10, 10, 6); hall(L, z - 1, 10, 10, 6); } });
  tick(s);                      // the first fortress tick creates the relight record and lights everything once
  mineTile(s, idx(20, 20, z)); tick(s);
  assert.deepEqual(lastRelit.dirty, [z], `ordinary mine: ${lastRelit.dirty}`);
  channel(s, idx(12, 12, z)); tick(s);
  assert.deepEqual(lastRelit.dirty, [z - 1, z, z + 1], `channel: ${lastRelit.dirty}`);
  assert.ok(rtEqual(s.rt.light, lightRebuild(s)), 'the incremental light equals a rebuild');
});

/** A load-like clone (saved state, rt rebuilt, saved rt keys copied), as tools/tests/cache-drop.test.mjs does. */
function loadClone(s) {
  const { rt, ...rest } = s;
  const c = structuredClone(rest);
  initRuntime(c);
  for (const k of savedKeys(true)) c.rt[k] = structuredClone(rt[k]);
  return caches(c);
}

test('2.6: a day-phase change relights one sky-exposed level per tick, and a save mid-sequence continues identically', () => {
  const zs = 6;
  const s = world({ zs, d: 12, carve: (L) => { for (let z = zs; z > zs - 4; z--) L.terrain[idx(20, 20, z)] = TER.AIR; L.terrain[idx(20, 20, zs - 4)] = TER.ROUGH; } });
  // the tick before dawn
  let t0 = TICKS_PER_DAY;
  while (phaseOf(t0) === phaseOf(t0 - 1)) t0++;
  s.tick = t0 - 3; tick(s); tick(s);       // relight record made, all lit at night
  assert.equal(lightQueue(s).q.length, 0);
  tick(s);                                 // the phase changes: levels queue, one relights this tick
  const queued = lightQueue(s).q.length;
  assert.ok(queued >= 5, `${queued + 1} sky-exposed levels relit over ${queued + 1} ticks`);
  assert.equal(lastRelit.dirty.length, 1, 'one level per tick');
  assert.equal(lastRelit.dirty[0], D - 1, 'top-down');
  tick(s); tick(s);
  assert.ok(rtEqual(s.rt.light, lightRebuild(s)), 'mid-sequence: the live map equals a rebuild of the saved state');
  const c = loadClone(s);
  assert.ok(rtEqual(c.rt.light, s.rt.light), 'the loaded copy lights the same');
  for (let k = 0; k < queued + 2; k++) {
    tick(s); tick(c);
    assert.ok(rtEqual(s.rt.light, c.rt.light), `tick ${k}: same light`);
    assert.deepEqual(lightQueue(s), lightQueue(c));
  }
  assert.equal(lightQueue(s).q.length, 0, 'the sequence finished');
  assert.ok(rtEqual(s.rt.light, lightRebuild(s)));
});

test('2.6: a cellar with cover >= 3 sits at 12 C in every season; open sky is outdoor', () => {
  const zs = 8, z = zs - 4;
  const s = world({ zs, d: 12, carve: (L) => hall(L, z, 10, 10, 3) });
  const i = idx(11, 11, z);
  assert.ok(s.rt.cover[i] >= 3);
  assert.ok(s.rt.room[i] > 0, 'the cellar is a room');
  for (let season = 0; season < 4; season++) {
    s.tick = season * TICKS_PER_DAY * 15 + 600 * 12;
    if (seasonOf(s.tick) !== season) continue;
    const t = tempRebuild(s);
    assert.equal(t.roomTemp[s.rt.room[i]], 12, `season ${season}`);
  }
  // the Ember layer and the Hollow Reach read their bands (cover >= 3)
  const deep = world({ zs: 14, d: 20, w: 32, carve: (L) => { hall(L, 2, 5, 5, 3); hall(L, 1, 5, 5, 3); } });
  deep.tick = 600 * 12;
  const td = tempRebuild(deep);
  assert.equal(td.roomTemp[deep.rt.room[idx(6, 6, 2)]], 38, 'the ember layer');
  assert.equal(td.roomTemp[deep.rt.room[idx(6, 6, 1)]], 2, 'the Hollow Reach');
});

test('2.7: Sounding reveals the column 1-3 levels below; sight goes through stairs and down a shaft', () => {
  const zs = 8, z = zs - 2;
  const s = world({ zs, d: 12, carve: (L) => hall(L, z, 10, 10, 5) });
  const at = idx(12, 12, z);
  const n = sounding(s, at);
  assert.ok(n > 0);
  for (let k = 1; k <= 3; k++) assert.equal(getBit(s.L.known, idx(12, 12, z - k)), 1, `level -${k} known`);
  assert.equal(getBit(s.L.known, idx(12, 12, z - 4)), 0, 'not 4 below');
  assert.equal(getBit(s.L.known, idx(12 + 4, 12, z - 1)), 0, 'radius 3');
  // prospecting a cylinder +-1 level
  assert.ok(revealKnown(s, idx(30, 30, z), 2, 1) > 0);
  assert.equal(getBit(s.L.known, idx(30, 30, z + 1)), 1);
  // mining marks the voxels above and below known
  mineTile(s, idx(15, 12, z));
  assert.equal(getBit(s.L.known, idx(15, 12, z - 1)), 1);
  assert.equal(getBit(s.L.known, idx(15, 12, z + 1)), 1);
  // sight down a shaft from its lip
  const t = world({ zs, d: 12, carve: (L) => { for (let k = 0; k < 3; k++) L.terrain[idx(20, 20, zs - k)] = TER.AIR; L.terrain[idx(20, 20, zs - 3)] = TER.ROUGH; } });
  sight3(t, idx(21, 20, zs));
  assert.equal(getBit(t.L.fog, idx(20, 20, zs - 3)), 1, 'the shaft floor is seen from the lip');
});

test('2.8: the static fluid layer: depth walk costs, ember blocks, a mined aquifer leaves a seep', () => {
  const zs = 8, z = zs - 2;
  const s = world({ zs, d: 12, carve: (L) => { hall(L, z, 10, 10, 6); L.fluid[idx(16, 12, z)] = FL.SOURCE; } });
  const i = idx(11, 11, z), base = s.rt.walkCost[i];
  setFluid(s, i, 2); assert.equal(s.rt.walkCost[i], base * 2);
  setFluid(s, i, 3); assert.equal(s.rt.walkCost[i], base * 3);
  setFluid(s, i, 4); assert.equal(s.rt.walkCost[i], 0);
  setFluid(s, i, FL.EMBER | 1); assert.equal(s.rt.walkCost[i], 0);
  setFluid(s, i, 0); assert.equal(s.rt.walkCost[i], base);
  // mining the aquifer voxel (a source in rock) leaves a seep: depth 2, still a source
  mineTile(s, idx(16, 12, z));
  assert.equal(fluidAt(s, idx(16, 12, z)), FL.SOURCE | FLUID.seepDepth);
  assert.equal(s.rt.walkCost[idx(16, 12, z)], 20);
  assert.deepEqual(walkRebuild(s, occRebuild(s)), s.rt.walkCost);
  // an ember pool lights and heats its level
  setFluid(s, idx(12, 14, z), FL.EMBER | 3); tick(s);
  assert.ok(s.rt.light[idx(12, 13, z)] >= 1, 'ember light');
});

test('2.9: claims by column and through stairs; the plant cluster list; fire rises', () => {
  const zs = 8;
  const s = world({ zs, d: 12, w: 64 });
  const hb = newBuilding(0, 'hearth', 20, 20, 0, null, { z: zs }); hb.st = 'done';
  s.bld.push(hb); setOcc(s, hb, true);
  // a shaft of stairs from the surface down 3 levels far outside the disc, then a tunnel back under the disc
  const m = claimMap(s);
  assert.equal(m[idx(20, 20, zs - 5)], 1, 'a column under the disc is claimed on every level');
  assert.equal(m[idx(60, 60, zs)], 0);
  for (let k = 0; k <= 3; k++) digStair(s, idx(50, 50, zs - k), stairKindAt(zs - k, zs, zs - 3));
  for (let x = 51; x < 58; x++) mineTile(s, idx(x, 50, zs - 3));
  assert.deepEqual(claimMap(s), claimRebuild(s));
  // plants: only clusters with plants are visited
  installPlants();
  for (let k = 0; k < 5; k++) s.L.plant[idx(3 + k, 3, zs)] = 1;
  const t = world({ zs, d: 12, carve: (L) => { L.plant[idx(3, 3, zs)] = 1; L.plant[idx(40, 40, zs)] = 1; L.plant[idx(40, 40, zs - 3)] = 1; } });
  assert.deepEqual(plantClusters(t), [zs * 9 + 0, (zs - 3) * 9 + 8, zs * 9 + 8].sort((a, b) => a - b));
  // fire rises: a flame under a burnable voxel above it may catch it (and never a deep hall from outside)
  const f = world({ zs, d: 12, carve: (L) => { L.plant[idx(10, 10, zs)] = 3; L.plant[idx(10, 10, zs + 1)] = 3; L.terrain[idx(10, 10, zs + 1)] = TER.GRASS; } });
  assert.ok(ignite(f, idx(10, 10, zs), 100));
  let rose = false;
  for (let k = 0; k < 400 && !rose; k++) { f.tick++; fireSystem(f); rose = f.colony.world.fire.some((e) => e[0] === idx(10, 10, zs + 1)); }
  assert.ok(rose, 'the flame climbed to the voxel above');
});

test('every per-level cache equals its rebuild by value after 400 seeded writes over 200 ticks', () => {
  const zs = 8;
  const s = world({ zs, d: 12, w: 48, carve: (L) => { hall(L, zs - 2, 6, 6, 8); hall(L, zs - 4, 20, 20, 9); for (let z = zs; z > zs - 4; z--) L.terrain[idx(30, 30, z)] = TER.AIR; } });
  const g = { s: 0x1234abcd };
  const R = (n) => { g.s = (Math.imul(g.s ^ (g.s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0; return g.s % n; };
  const wall = (x, y, z) => { const b = newBuilding(s.bld.length, 'wall', x, y, 0, 'granite', { z }); b.st = 'done'; s.bld.push(b); setOcc(s, b, true); };
  let writes = 0, bad = [];
  s.tick = 600 * 4;
  for (let t = 0; t < 200; t++) {
    for (let k = 0; k < 2; k++) {
      const x = 2 + R(W - 4), y = 2 + R(W - 4), z = 1 + R(zs), i = idx(x, y, z), op = R(6);
      if (op === 0 || op === 1) { if (mineTile(s, i)) writes++; }
      else if (op === 2) { if (channel(s, i)) writes++; }
      else if (op === 3) { if (digStair(s, i, TER.STAIR_UD)) writes++; }
      else if (op === 4) { if (setRoof(s, idx(x, y, Math.min(D - 1, zs + R(2))), R(2) ? ROOF.BUILT : ROOF.OPEN)) writes++; }
      else if (s.L.terrain[i] === TER.ROUGH && s.rt.occ[i] < 0) { wall(x, y, z); writes++; }
    }
    tick(s);
    if (t % 20 === 19 || t === 199) {
      const occ = occRebuild(s), r = roomsBuild(s, occ, walkRebuild(s, occ)), tp = tempRebuild(s);
      const checks = { light: lightRebuild(s, occ), support: supportRebuild(s, occ), room: r.room, rooms: r.rooms, roomTemp: tp.roomTemp, heat: tp.heat, cover: coverRebuild(s), skyZ: skyZRebuild(s) };
      for (const [k, v] of Object.entries(checks)) if (!rtEqual(s.rt[k], v)) bad.push(`${k} at ${t}`);
      assert.deepEqual(claimMap(s), claimRebuild(s));
    }
  }
  assert.ok(writes > 100, `${writes} writes`);
  assert.deepEqual(bad, []);
});
