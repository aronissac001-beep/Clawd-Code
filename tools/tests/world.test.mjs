// Workstream B, Stage 1a (doc 14.6 row B): mapgen with the massif guarantee, regions at the end of the
// tick, the light map, support planning, natural pillars and cave-ins, plants, claims, rooms and walking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createColony, initRuntime } from '../../js/game/core/state.js';
import { tick, step } from '../../js/game/core/sim.js';
import { resetBus } from '../../js/game/core/bus.js';
import { verifyCaches, dirtyClear } from '../../js/game/core/rtcontract.js';
import { W, H, N, idx, TER, ROOF, DESIG, getBit } from '../../js/game/core/grid.js';
import { newBuilding, newColonist, newPath } from '../../js/game/core/schema.js';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../../js/game/core/time.js';
import { installWorld, mineTile, setOcc, regionOf, reachable, lightAt, depthAt } from '../../js/game/world/terrain.js';
import { generateWorld, generateMap, spawnEdges } from '../../js/game/world/mapgen.js';
import { roofRockByDepth } from '../../js/game/world/stubmap.js';
import { wouldUnsupport, mineAllowed, planUnsupported, pillarsFor, unsupportedCount, onCaveIn } from '../../js/game/world/support.js';
import { plantsSystem, fellPlant, plantYield, treeAt } from '../../js/game/world/plants.js';
import { plantCode } from '../../js/game/world/defs.js';
import { isClaimed, claimRebuild, claimMap } from '../../js/game/world/claims.js';
import { roomOf, roomById, roomTiles } from '../../js/game/world/rooms.js';
import { followPath, findPath, GOAL, installMovement, pathMover } from '../../js/game/systems/pathing.js';

const fresh = () => { resetBus(); installWorld(); };
const B_KEYS = ['occ', 'walkCost', 'support', 'depth', 'region', 'regionH', 'regionGraph', 'light', 'lit', 'room', 'rooms'];

// ---- mapgen ---------------------------------------------------------------------------------------
test('mapgen seeds 1-100: 3 edges, >= 4 coal and >= 3 iron veins, 1 cavern, depth >= 30, Underdeep >= 300, < 80 ms', () => {
  fresh();
  const fails = [], times = [];
  for (let seed = 1; seed <= 100; seed++) {
    const s = createColony(seed);
    const t0 = performance.now();
    const info = generateWorld(s);
    times.push(performance.now() - t0);
    const v = info.veins, bad = [];
    if (info.edges.count < 3) bad.push(`edges ${info.edges.count}`);
    if (v.coal.veins < 4) bad.push(`coal ${v.coal.veins}`);
    if (v.iron.veins < 3) bad.push(`iron ${v.iron.veins}`);
    if (info.caverns.length !== 1) bad.push(`caverns ${info.caverns.length}`);
    if (info.maxDepth < 30) bad.push(`depth ${info.maxDepth}`);
    if (info.underdeep < 300) bad.push(`underdeep ${info.underdeep}`);
    if (info.site.weak) bad.push('site');
    if (info.riverDist > 25) bad.push(`river ${info.riverDist}`);
    if (unsupportedCount(s)) bad.push(`unsupported ${unsupportedCount(s)}`);
    if (spawnEdges(s).length < 3) bad.push('spawn segments');
    if (bad.length) fails.push(`seed ${seed}: ${bad.join(', ')}`);
  }
  assert.deepEqual(fails, []);
  const warm = times.slice(1).sort((a, b) => a - b);
  // the doc's budget is 80 ms in Node; report the warm median and p95 and hold p95 to it
  assert.ok(warm[Math.floor(warm.length * 0.95)] < 80, `p95 ${warm[Math.floor(warm.length * 0.95)].toFixed(1)} ms`);
});

test('mapgen is deterministic and the massif guarantee holds per side', () => {
  fresh();
  const a = createColony('GEN-DET'), b = createColony('GEN-DET');
  const ia = generateWorld(a), ib = generateWorld(b);
  assert.deepEqual(ia, ib);
  for (const k of ['terrain', 'mat', 'ore', 'roof', 'plant', 'growth', 'fog', 'known']) assert.deepEqual(a.L[k], b.L[k], k);
  for (const side of ['n', 'e', 'w']) {
    const s = createColony('GEN-SIDE');
    const info = generateMap(s, { side });
    assert.equal(info.side, side);
    assert.ok(info.maxDepth >= 30 && info.underdeep >= 300, `${side}: ${info.maxDepth} ${info.underdeep}`);
  }
});

test('a fresh world: Hearth done and lit, explored start, rock roofed by depth, every cache exact', () => {
  fresh();
  const s = createColony(11);
  const info = generateWorld(s);
  const h = s.bld[s.colony.hearth.id];
  assert.equal(h.def, 'hearth'); assert.equal(h.st, 'done');
  const c = idx(info.hearth.cx, info.hearth.cy);
  assert.equal(getBit(s.L.fog, c), 1);
  assert.ok(isClaimed(s, c));
  for (let i = 0; i < N; i++) {
    if (s.L.terrain[i] !== TER.ROCK) continue;
    assert.equal(s.L.roof[i], depthAt(s, i) >= 5 ? ROOF.MOUNTAIN : ROOF.THIN);
    assert.ok(s.L.mat[i] > 0);
  }
  tick(s);
  assert.deepEqual(verifyCaches(s, B_KEYS), []);
  assert.ok(lightAt(s, c + 3 * W) >= 2, 'the Hearth lights its ground');
});

// ---- regions at the end of the tick ------------------------------------------------------------------
test('mining a tunnel into the massif relabels regions at the end of the tick', () => {
  fresh();
  const s = createColony(3);
  const info = generateWorld(s);
  tick(s);
  // walk from the Hearth toward the massif side until the first rock tile, then dig 6 tiles in
  const dir = { n: [0, -1], e: [1, 0], w: [-1, 0] }[info.side];
  let x = info.hearth.cx, y = info.hearth.cy;
  while (s.L.terrain[idx(x, y)] !== TER.ROCK) { x += dir[0]; y += dir[1]; }
  const from = idx(x - dir[0], y - dir[1]), tunnel = [];
  for (let k = 0; k < 6; k++) tunnel.push(idx(x + k * dir[0], y + k * dir[1]));
  for (const i of tunnel) {
    assert.ok(mineTile(s, i));
    assert.equal(regionOf(s, i), 0, 'labels change only at the end of the tick');
    tick(s);
    assert.notEqual(regionOf(s, i), 0);
    assert.ok(reachable(s, from, i), 'the tunnel is reachable from the open ground');
  }
  assert.deepEqual(verifyCaches(s, B_KEYS), []);
  const p = findPath(s, from, tunnel[5], GOAL.TILE, 0);
  assert.equal(p.status, 'ok');
  assert.equal(p.tiles.length, 6);
});

// ---- light ------------------------------------------------------------------------------------------
/** 32 x 32 stub: rock everywhere east of x = 4, two parallel tunnels at y = 10 and y = 12, one rock row between. */
function tunnels() {
  fresh();
  const s = createColony('LIGHT', { w: 32 });
  for (let y = 0; y < 32; y++) for (let x = 4; x < 32; x++) s.L.terrain[idx(x, y)] = TER.ROCK;
  roofRockByDepth(s);
  initRuntime(s);
  return s;
}
test('light does not cross a 1-tile rock wall', () => {
  const s = tunnels();
  for (let x = 4; x < 24; x++) { mineTile(s, idx(x, 10)); mineTile(s, idx(x, 12)); }
  s.tick = 13 * TICKS_PER_HOUR; // daytime: the tunnel mouths get a little daylight, the depths none
  const b = newBuilding(0, 'brazier', 16, 10, 0, null, { st: 'done' });
  s.bld.push(b); setOcc(s, b, true);
  tick(s);
  assert.ok(lightAt(s, idx(17, 10)) >= 2, 'lit beside the brazier');
  assert.ok(lightAt(s, idx(16, 11)) === 0, 'the rock between holds no light');
  for (let x = 12; x <= 20; x++) assert.equal(lightAt(s, idx(x, 12)), 0, `dark behind the wall at ${x}`);
  // open a gap in the wall: now the light pours through
  mineTile(s, idx(16, 11));
  tick(s);
  assert.ok(lightAt(s, idx(16, 12)) > 0, 'through the gap');
  assert.deepEqual(verifyCaches(s, B_KEYS), []);
});

// ---- support ------------------------------------------------------------------------------------------
test('support planning: unsafe tiles are refused unless risky-ok; the plan preview stripes them', () => {
  const s = tunnels();
  // within 4 (Chebyshev) of support: an 8 x 8 hall with its rock walls kept needs no pillar, a 9 x 9
  // hall needs one, at its centre (the doc's "up to 9 x 9" is one tile generous; 3.4 rule wins)
  const centre = idx(14, 10);
  assert.deepEqual(pillarsFor(s, { x0: 10, y0: 6, x1: 18, y1: 14 }), [centre]);
  assert.deepEqual(pillarsFor(s, { x0: 10, y0: 6, x1: 17, y1: 13 }), []);
  for (let y = 6; y <= 14; y++) for (let x = 10; x <= 18; x++) {
    const i = idx(x, y);
    if (i === centre) continue;
    assert.equal(wouldUnsupport(s, i), false, `${x},${y}`);
    mineTile(s, i);
  }
  assert.equal(wouldUnsupport(s, centre), true, 'the centre of a 9 x 9 hall is load-bearing');
  assert.equal(mineAllowed(s, centre), false);
  assert.equal(unsupportedCount(s), 0);
  tick(s);
  // a 12 x 12 hall planned in one go: its middle would be more than 4 from any support
  const r = { x0: 10, y0: 18, x1: 21, y1: 29 };
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) s.L.desig[idx(x, y)] |= DESIG.MINE;
  const striped = planUnsupported(s, r);
  assert.ok(striped.length > 0, 'the preview marks the middle of an unsupported hall');
  assert.equal(striped.length, 16);
  for (const i of striped) { const x = i % W, y = (i / W) | 0; assert.ok(x >= 14 && x <= 17 && y >= 22 && y <= 25, `striped ${x},${y}`); }
  // natural pillars fix the plan
  const pil = pillarsFor(s, r);
  assert.equal(pil.length, 1, `pillars ${pil.length}`);
  for (const i of pil) s.L.desig[i] &= ~DESIG.MINE;
  assert.deepEqual(planUnsupported(s, r), []);
  // mining the planned tiles in index order never needs risky-ok, and leaves nothing unsupported
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
    const i = idx(x, y);
    if (!(s.L.desig[i] & DESIG.MINE)) continue;
    assert.ok(mineAllowed(s, i), `allowed ${x},${y}`);
    mineTile(s, i); s.L.desig[i] = 0;
  }
  assert.equal(unsupportedCount(s), 0);
  tick(s);
  assert.deepEqual(verifyCaches(s, B_KEYS), []);
});

test('cave-in: mining the last support in risky mode collapses the roof to rubble', () => {
  const s = tunnels();
  // a 13 x 10 hall with a natural pillar near the middle (Stage 2: a 9-tile span between two walls
  // holds by itself, 14.8, so the hall is 10 tall: row 10 is 5 from the north wall and 6 from the south)
  const pillar = idx(16, 10);
  for (let y = 6; y <= 15; y++) for (let x = 10; x <= 22; x++) { const i = idx(x, y); if (i !== pillar) mineTile(s, i); }
  assert.equal(unsupportedCount(s), 0, 'the pillar holds the hall up');
  assert.equal(wouldUnsupport(s, pillar), true, 'the pillar is load-bearing');
  assert.equal(mineAllowed(s, pillar), false);
  s.L.desig[pillar] |= DESIG.RISKY;
  assert.equal(mineAllowed(s, pillar), true, 'risky-ok overrides');
  const heard = [];
  const off = onCaveIn((st, tiles) => heard.push(...tiles));
  s.col.push(newColonist(0, { x: 16 * 32 + 16, y: 10 * 32 + 16 }));
  mineTile(s, pillar);
  off();
  assert.ok(heard.length > 0, 'listeners hear the collapse');
  for (const i of heard) assert.equal(s.L.terrain[i], TER.RUBBLE);
  assert.ok(s.rt.events.some((e) => e.name === 'caveIn'));
  const c = s.col[0], ci = idx(Math.floor(c.x / 32), Math.floor(c.y / 32));
  assert.notEqual(s.rt.walkCost[ci], 0, 'the colonist was pushed to open ground');
  assert.equal(unsupportedCount(s), 0);
  tick(s);
  assert.deepEqual(verifyCaches(s, B_KEYS), []);
});

// ---- plants ------------------------------------------------------------------------------------------
test('trees grow deterministically, round-robin by cluster, and fell into wood', () => {
  fresh();
  const s = createColony('PLANT', { w: 32 });
  const oak = plantCode('oak');
  const i = idx(5, 5), j = idx(20, 20);
  s.L.plant[i] = oak; s.L.growth[i] = 0;
  s.L.plant[j] = oak; s.L.growth[j] = 200;
  initRuntime(s);
  s.tick = TICKS_PER_DAY * 12; // Highsun: warm
  const t0 = s.tick;
  for (let k = 0; k < TICKS_PER_DAY * 3; k++) { s.tick++; plantsSystem(s); }
  const g3 = s.L.growth[i];
  // 30 days to mature: 3 days is about 25 growth
  assert.ok(g3 >= 20 && g3 <= 31, `growth after 3 days ${g3}`);
  void t0;
  assert.ok(treeAt(s, j));
  assert.deepEqual(plantYield(s, j), { item: 'wood', n: Math.floor((25 * s.L.growth[j]) / 255) });
  const y = fellPlant(s, j);
  assert.ok(y && y.item === 'wood' && y.n >= 19);
  assert.equal(s.L.plant[j], 0);
  // same start, same result
  const s2 = createColony('PLANT', { w: 32 });
  s2.L.plant[i] = oak; initRuntime(s2); s2.tick = TICKS_PER_DAY * 12;
  for (let k = 0; k < TICKS_PER_DAY * 3; k++) { s2.tick++; plantsSystem(s2); }
  assert.equal(s2.L.growth[i], g3);
});

// ---- claims ------------------------------------------------------------------------------------------
test('claims: the Hearth claims radius 14; tunnels connected to claimed land are claimed', () => {
  fresh();
  const s = createColony('CLAIM', { w: 64 });
  for (let y = 0; y < 64; y++) for (let x = 40; x < 64; x++) s.L.terrain[idx(x, y)] = TER.ROCK;
  roofRockByDepth(s);
  s.bld.push(newBuilding(0, 'hearth', 25, 30, 0, null, { st: 'done' }));
  s.colony.hearth.id = 0;
  initRuntime(s);
  const c = idx(26, 31);
  assert.ok(isClaimed(s, c));
  assert.ok(isClaimed(s, idx(26 + 14, 31)) && !isClaimed(s, idx(26 + 15, 31)));
  // a tunnel from the face at x = 40 eastward: claimed as it is dug
  for (let x = 40; x < 56; x++) mineTile(s, idx(x, 31));
  assert.ok(isClaimed(s, idx(55, 31)), 'the far end of the tunnel');
  // a sealed pocket dug elsewhere is not claimed
  mineTile(s, idx(58, 10));
  assert.ok(!isClaimed(s, idx(58, 10)));
  assert.deepEqual(claimMap(s), claimRebuild(s));
});

// ---- rooms -------------------------------------------------------------------------------------------
test('rooms: walls and a door make a room that auto-roofs; ids are canonical; outdoors is 0', () => {
  fresh();
  const s = createColony('ROOM', { w: 32 });
  initRuntime(s);
  let id = 0;
  const put = (def, x, y) => { const b = newBuilding(id++, def, x, y, 0, null, { st: 'done' }); s.bld.push(b); setOcc(s, b, true); };
  for (let x = 10; x <= 15; x++) { put('wall', x, 10); put('wall', x, 15); }
  for (let y = 11; y <= 14; y++) { put('wall', 10, y); if (y !== 12) put('wall', 15, y); }
  put('door', 15, 12);
  tick(s);
  const r = roomOf(s, idx(12, 12));
  assert.ok(r > 0);
  const rec = roomById(s, r);
  assert.equal(rec.n, 16); assert.equal(rec.doors, 1);
  assert.equal(roomTiles(s, r).length, 16);
  assert.ok(roomTiles(s, r).every((i) => s.L.roof[i] === ROOF.BUILT), 'a built room auto-roofs (7.3)');
  assert.equal(rec.roofed, true);
  assert.equal(roomOf(s, idx(5, 5)), 0, 'outdoors');
  assert.equal(roomOf(s, idx(15, 12)), 0, 'the door belongs to no room');
  assert.deepEqual(verifyCaches(s, ['room', 'rooms']), []);
});

// ---- walking -------------------------------------------------------------------------------------------
test('colonists walk their path in integer units and drop a blocked path', () => {
  fresh();
  const s = createColony('WALK', { w: 32 });
  initRuntime(s);
  const c = newColonist(0, { x: 2 * 32 + 16, y: 5 * 32 + 16 });
  s.col.push(c);
  const p = findPath(s, idx(2, 5), idx(12, 5), GOAL.TILE, 0);
  c.path = newPath(p.tiles, 0);
  let ticks = 0;
  while (c.path && ticks < 1000) { followPath(s, c); ticks++; }
  assert.equal(c.x, 12 * 32 + 16); assert.equal(c.y, 5 * 32 + 16);
  assert.equal(ticks, 64, '10 tiles of 32 units at 5 units a tick');
  assert.ok(Number.isInteger(c.x) && Number.isInteger(c.y));
  // a wall appears on the path: the path is dropped when the mover reaches it
  const back = findPath(s, idx(12, 5), idx(2, 5), GOAL.TILE, 0);
  c.path = newPath(back.tiles, 0);
  const b = newBuilding(0, 'wall', 8, 5, 0, null, { st: 'done' });
  s.bld.push(b); setOcc(s, b, true);
  ticks = 0;
  while (c.path && ticks < 1000) { followPath(s, c); ticks++; }
  assert.equal(c.path, null);
  assert.ok(c.x > 8 * 32 + 16, 'it stops before the wall');
});

test('installMovement: a queued path request is searched in the path slot and walked in the movement slot', () => {
  fresh();
  let mover = null;
  installMovement((m) => { mover = m; });
  assert.equal(mover, pathMover);
  const s = createColony(4);
  const info = generateWorld(s);
  const c = newColonist(0, { x: info.hearth.cx * 32 + 16, y: (info.hearth.cy + 3) * 32 + 16 });
  s.col.push(c);
  tick(s);
  // the first tile reachable from the colonist on a ring 12 tiles out (walls of rock and water vary per map)
  const from = idx(Math.floor(c.x / 32), Math.floor(c.y / 32));
  let goal = -1;
  for (let k = 0; k < 96 && goal < 0; k++) {
    const a = (k * 6.283) / 96, x = info.hearth.cx + Math.round(12 * Math.cos(a)), y = info.hearth.cy + Math.round(12 * Math.sin(a));
    if (x >= 0 && y >= 0 && x < W && y < H && reachable(s, from, idx(x, y))) goal = idx(x, y);
  }
  assert.ok(goal >= 0);
  assert.ok(mover.request(s, c, goal, false));
  assert.equal(mover.status(s, c), 'pending');
  let ticks = 0;
  while (mover.status(s, c) !== 'none' && ticks < 2000) { tick(s); ticks++; }
  assert.equal(idx(Math.floor(c.x / 32), Math.floor(c.y / 32)), goal);
  assert.ok(ticks > 40 && ticks < 400, `${ticks} ticks`);
  // a rock tile deep in the massif is unreachable: refused at once, no search
  let rock = -1;
  for (let i = 0; i < N && rock < 0; i++) if (s.L.terrain[i] === TER.ROCK && depthAt(s, i) > 10) rock = i;
  assert.equal(mover.request(s, c, rock, true), false);
});
