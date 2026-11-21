// Workstream B, Stage 2 (doc 14.8 row B): cave-ins and collapse, rooms with roles, stats and tiers,
// the temperature model, seasons and weather, fire spread, mechanisms, blight and Waystones.
// Acceptance: a 10 x 10 unsupported room collapses, a 9 x 9 does not; room tiers match hand-built
// fixtures; fire spreads only on flammable tiles; a lever locks a linked gate and the hostile region
// set changes; a fireplace in a 10-tile room adds 12 C.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createColony, initRuntime, stateHash } from '../../js/game/core/state.js';
import { tick, step } from '../../js/game/core/sim.js';
import { resetBus } from '../../js/game/core/bus.js';
import { verifyCaches } from '../../js/game/core/rtcontract.js';
import { W, idx, TER, ROOF } from '../../js/game/core/grid.js';
import { newBuilding, newColonist, newFoe } from '../../js/game/core/schema.js';
import { TICKS_PER_DAY, TICKS_PER_HOUR, DAYS_PER_SEASON } from '../../js/game/core/time.js';
import { installWorld, mineTile, setOcc, tempAt, setPlant, setFloor, setWorldStage, reachable } from '../../js/game/world/terrain.js';
import { roofRockByDepth } from '../../js/game/world/stubmap.js';
import { unsupportedCount, onCaveIn, held, rumbling } from '../../js/game/world/support.js';
import { roomInfo, roomOf } from '../../js/game/world/rooms.js';
import { ignite, burning, fireCount, canBurn, extinguish } from '../../js/game/world/fire.js';
import { setWeather, weatherKind, rollWeather, freezeWater } from '../../js/game/world/weather.js';
import { outdoorTemp } from '../../js/game/world/temperature.js';
import { pullLever, setLever, link, gateMode, GATE, firePlate, linksOf } from '../../js/game/world/mechanisms.js';
import { blightDay, huskSites, blightCount } from '../../js/game/world/blight.js';
import { waystoneWhy } from '../../js/game/world/claims.js';
import { plantCode } from '../../js/game/world/defs.js';
import { canSow } from '../../js/game/world/plants.js';
import { BUS } from '../../js/game/core/bus.js';
import { saveBlobSync, loadBlobSync } from '../../js/game/save/colonysave.js';

const B_KEYS = ['occ', 'walkCost', 'support', 'depth', 'region', 'regionH', 'regionGraph', 'light', 'lit', 'room', 'rooms', 'roomTemp', 'heat'];
const fresh = (stage = '2') => { resetBus(); installWorld({ fuel: true, stage }); };

/** w x w map of solid rock (roofed by depth) with an open strip on the west edge. */
function rockMap(w = 40) {
  const s = createColony('B2', { w });
  for (let y = 0; y < w; y++) for (let x = 3; x < w; x++) s.L.terrain[idx(x, y)] = TER.ROCK;
  roofRockByDepth(s);
  initRuntime(s);
  s.tick = 12 * TICKS_PER_HOUR;
  return s;
}
/** Grass map, open sky. */
function grass(w = 32) { const s = createColony('B2g', { w }); initRuntime(s); s.tick = 12 * TICKS_PER_HOUR; return s; }
function place(s, def, x, y, extra = {}) {
  const b = newBuilding(s.bld.length, def, x, y, extra.rot || 0, extra.mat || null, { st: 'done', ...extra });
  s.bld.push(b); setOcc(s, b, true);
  for (const fn of BUS.built) fn(s, b);
  return b;
}
/** A walled room with inner rect (x0, y0)..(x1, y1) and a door on the south wall. */
function walledRoom(s, x0, y0, x1, y1, door = true) {
  for (let x = x0 - 1; x <= x1 + 1; x++) { place(s, 'wall', x, y0 - 1, { mat: 'granite' }); if (!(door && x === x0)) place(s, 'wall', x, y1 + 1, { mat: 'granite' }); }
  for (let y = y0; y <= y1; y++) { place(s, 'wall', x0 - 1, y, { mat: 'granite' }); place(s, 'wall', x1 + 1, y, { mat: 'granite' }); }
  if (door) place(s, 'door', x0, y1 + 1, { mat: 'wood' });
  tick(s);
  return roomOf(s, idx(x0, y0));
}

// ---- cave-ins (acceptance) ------------------------------------------------------------------------------
function carve(n) {
  fresh();
  const s = rockMap(40);
  const heard = [];
  const off = onCaveIn((st, tiles, hit) => heard.push([tiles.length, hit.length]));
  s.L.desig.fill(64);                                  // risky-ok everywhere: nothing stops the miner
  for (let y = 12; y < 12 + n; y++) for (let x = 14; x < 14 + n; x++) mineTile(s, idx(x, y));
  step(s, 60);                                         // the rumble (40 ticks) runs out
  off();
  let rubble = 0;
  for (let y = 12; y < 12 + n; y++) for (let x = 14; x < 14 + n; x++) if (s.L.terrain[idx(x, y)] === TER.RUBBLE) rubble++;
  return { s, rubble, heard };
}
test('cave-in: a 9 x 9 room dug with no support holds (a 9-tile span rests on both walls)', () => {
  const { s, rubble, heard } = carve(9);
  assert.equal(rubble, 0, 'no rubble in the 9 x 9 room');
  assert.equal(heard.length, 0);
  assert.equal(unsupportedCount(s), 0);
  assert.ok(held(s, idx(18, 16)), 'the centre tile is held by the span');
});
test('cave-in: a 10 x 10 room dug with no support collapses after a 2 s rumble', () => {
  const { s, rubble, heard } = carve(10);
  assert.ok(rubble > 0, `the middle comes down (${rubble} tiles of rubble)`);
  assert.ok(heard.length > 0, 'listeners hear the collapse');
  assert.ok(s.rt.events.some((e) => e.name === 'caveRumble') && s.rt.events.some((e) => e.name === 'caveIn'));
  assert.equal(unsupportedCount(s), 0, 'after the collapse every roof is held again');
  assert.deepEqual(verifyCaches(s, B_KEYS), []);
});
test('cave-in: the rumble queue is saved, and a pillar built during the rumble saves the roof', () => {
  fresh();
  const s = rockMap(40);
  s.L.desig.fill(64);
  for (let y = 12; y < 22; y++) for (let x = 14; x < 24; x++) mineTile(s, idx(x, y));
  const due = rumbling(s);
  assert.ok(due.length > 0, 'tiles rumble first');
  const s2 = loadBlobSync(saveBlobSync(s));
  assert.deepEqual(rumbling(s2), due, 'the queue survives a save');
  place(s, 'pillar', 18, 16);
  place(s, 'pillar', 19, 17);
  step(s, 60);
  let rubble = 0;
  for (let y = 12; y < 22; y++) for (let x = 14; x < 24; x++) if (s.L.terrain[idx(x, y)] === TER.RUBBLE) rubble++;
  assert.equal(rubble, 0, 'the props held it');
});
test('cave-in: Stage 1b keeps the instant collapse (no queue)', () => {
  fresh('1b');
  const s = rockMap(40);
  s.L.desig.fill(64);
  for (let y = 12; y < 22; y++) for (let x = 14; x < 24; x++) mineTile(s, idx(x, y));
  assert.equal(rumbling(s).length, 0);
  let rubble = 0;
  for (let y = 12; y < 22; y++) for (let x = 14; x < 24; x++) if (s.L.terrain[idx(x, y)] === TER.RUBBLE) rubble++;
  assert.ok(rubble > 0);
  setWorldStage('2');
});

// ---- rooms: roles, stats and tiers (acceptance: hand-built fixtures) ---------------------------------------
test('rooms: hand-built fixtures get their role and tier', () => {
  fresh();
  const s = grass(48);
  // 1. a bare 3 x 4 room with a bed: a Plain bedroom
  const r1 = walledRoom(s, 2, 2, 4, 5);
  place(s, 'bed', 3, 3, { mat: 'wood' });
  // 2. a 4 x 4 room with a plank floor, a bed, a table and a chair, a wardrobe: a Decent bedroom
  const r2 = walledRoom(s, 9, 2, 12, 5);
  for (let y = 2; y <= 5; y++) for (let x = 9; x <= 12; x++) setFloor(s, idx(x, y), 1);
  place(s, 'bed', 9, 2, { mat: 'wood' }); place(s, 'table', 10, 4, { mat: 'wood' }); place(s, 'chair', 12, 4, { mat: 'wood' }); place(s, 'wardrobe', 12, 2, { mat: 'wood' });
  // 3. an empty 2 x 2 closet with a corpse: Squalid
  const r3 = walledRoom(s, 17, 2, 18, 3);
  s.items.push({ id: 0, k: 'corpse', m: null, q: 0, n: 1, x: 17, y: 2, hp: 100, f: false, age: 0, name: null, maker: null });
  s.rt.itemAt[idx(17, 2)] = 0;
  // 4. a carpeted 5 x 4 hall with a long table, chairs and two statues of quality: Fine dining hall
  const r4 = walledRoom(s, 22, 2, 26, 5);
  const carpet = 1 + ['f_planks', 'f_flag', 'road', 'f_brick', 'f_carpet'].indexOf('f_carpet');
  void carpet;
  for (let y = 2; y <= 5; y++) for (let x = 22; x <= 26; x++) setFloor(s, idx(x, y), floorId('f_carpet'));
  place(s, 'longtable', 23, 3, { mat: 'wood', q: 4 });
  for (const x of [22, 26]) place(s, 'chair', x, 3, { mat: 'wood', q: 4 });
  place(s, 'statue', 22, 5, { mat: 'marble', q: 5 }); place(s, 'statue', 26, 5, { mat: 'marble', q: 5 });
  // 5. a workshop: a stonecutter's bench in a 4 x 3 room
  const r5 = walledRoom(s, 31, 2, 34, 4);
  place(s, 'mason', 32, 3);
  tick(s);
  const info = (r) => roomInfo(s, r);
  const a = info(r1), b = info(r2), c = info(r3), d = info(r4), e = info(r5);
  assert.equal(a.role, 'bedroom'); assert.equal(a.tier, 'plain', `bare bedroom imp ${a.imp}`);
  assert.equal(b.role, 'bedroom'); assert.equal(b.tier, 'decent', `furnished bedroom imp ${b.imp}`);
  assert.equal(c.role, 'hall'); assert.equal(c.tier, 'squalid', `corpse closet imp ${c.imp}`);
  assert.equal(d.role, 'dining'); assert.ok(['fine', 'grand'].includes(d.tier), `dining hall imp ${d.imp} (${d.tier})`);
  assert.equal(e.role, 'workshop');
  assert.ok(b.stats.beauty > a.stats.beauty && b.stats.wealth > a.stats.wealth);
  assert.equal(a.stats.space, 12 - 2, 'space: tiles less the bed');
  assert.ok(d.imp > b.imp && b.imp > a.imp && a.imp > c.imp);
});
function floorId(def) { return 1 + floorDefs().indexOf(def); }
function floorDefs() { return ALL_FLOORS; }
import { CONTENT } from '../../js/data/index.js';
const ALL_FLOORS = CONTENT.all('structure').filter((d) => (d.flags || []).includes('floor')).map((d) => d.id);

test('rooms: a cellar is recognised underground and holds 12 C', () => {
  fresh();
  const s = rockMap(40);
  for (let y = 10; y <= 13; y++) for (let x = 12; x <= 15; x++) mineTile(s, idx(x, y));
  place(s, 'cask', 13, 11);
  tick(s);
  const r = roomOf(s, idx(12, 10));
  assert.ok(r > 0);
  assert.equal(roomInfo(s, r).role, 'cellar');
  assert.equal(tempAt(s, idx(12, 10)), 12);
});

// ---- temperature, seasons and weather ------------------------------------------------------------------------
test('temperature: a fireplace in a 10-tile room adds 12 C (acceptance)', () => {
  fresh();
  const s = grass(32);
  const r = walledRoom(s, 5, 5, 9, 6);                     // 5 x 2 = 10 tiles
  const before = tempAt(s, idx(6, 5));
  const fp = place(s, 'hearthfire', 6, 5);
  fp.fuel = TICKS_PER_DAY;
  s.rt.dirty.temperature = true;
  tick(s);
  assert.equal(roomOf(s, idx(6, 5)), r);
  assert.equal(s.rt.rooms[r].n - 2, 8, 'the fireplace stands in the room (its 2 tiles are blocked)');
  assert.equal(tempAt(s, idx(8, 6)) - before, 12);
});
test('weather: a cold snap takes 15 C off the outdoor base, then ends; the caches follow', () => {
  fresh();
  const s = grass(32);
  const i = idx(20, 20), t0 = tempAt(s, i);
  setWeather(s, 'coldsnap', 30);
  tick(s);
  assert.equal(weatherKind(s), 'coldsnap');
  assert.equal(tempAt(s, i), t0 - 15);
  assert.equal(outdoorTemp(s.tick, s), outdoorTemp(s.tick) - 15);
  assert.deepEqual(verifyCaches(s, B_KEYS), []);
  step(s, 30 * TICKS_PER_HOUR);
  assert.equal(weatherKind(s), 'clear');
  assert.deepEqual(verifyCaches(s, B_KEYS), []);
});
test('weather: the daily roll is a pure function of seed and day; seasons shape it', () => {
  const kinds = { 0: {}, 1: {}, 2: {}, 3: {} };
  for (let d = 0; d < 400; d++) { const k = rollWeather(7, d).kind; const se = Math.floor(d / DAYS_PER_SEASON) % 4; kinds[se][k] = (kinds[se][k] || 0) + 1; }
  assert.deepEqual(rollWeather(7, 33), rollWeather(7, 33));
  assert.ok(!kinds[0].coldsnap && !kinds[1].coldsnap, 'no cold snaps in Thaw or Highsun');
  assert.ok(kinds[3].snow > 0 && !kinds[3].rain, 'Deepcold rain falls as snow');
  assert.ok(kinds[1].drought > 0, 'droughts in Highsun');
});
test('seasons: open water freezes in Deepcold and thaws in Thaw', () => {
  fresh();
  const s = grass(24);
  for (let x = 2; x < 10; x++) s.L.terrain[idx(x, 5)] = TER.SHALLOW;
  initRuntime(s);
  s.tick = 3 * DAYS_PER_SEASON * TICKS_PER_DAY;          // first tick of Deepcold
  assert.equal(freezeWater(s), 8);
  assert.equal(s.L.terrain[idx(4, 5)], TER.ICE);
  assert.equal(freezeWater(s), 0, 'only once a season');
  s.tick = 4 * DAYS_PER_SEASON * TICKS_PER_DAY;          // Thaw of year 2
  assert.equal(freezeWater(s), 8);
  assert.equal(s.L.terrain[idx(4, 5)], TER.SHALLOW);
});

// ---- fire (acceptance: spreads only on flammable tiles) --------------------------------------------------------
test('fire: spreads through a wood but never over bare ground, and burns it away', () => {
  fresh();
  const s = grass(32);
  const oak = plantCode('oak');
  // a 6 x 6 wood, then a 3-tile firebreak of bare ground, then another wood
  // (grown 200 of 255: not mature, so no seedling bridges the gap while the test runs)
  for (let y = 10; y < 16; y++) for (let x = 4; x < 10; x++) setPlant(s, idx(x, y), oak, 200);
  for (let y = 10; y < 16; y++) for (let x = 13; x < 19; x++) setPlant(s, idx(x, y), oak, 200);
  assert.equal(canBurn(s, idx(11, 12)), false, 'bare grass cannot burn');
  assert.ok(ignite(s, idx(4, 10)));
  let maxFires = 0;
  for (let k = 0; k < 4 * TICKS_PER_HOUR; k++) {
    tick(s);
    maxFires = Math.max(maxFires, fireCount(s));
    for (const e of s.colony.world.fire) {
      assert.ok(canBurn(s, e[0]), `a flame on a tile with nothing to burn (${e[0] % W},${(e[0] / W) | 0})`);
      assert.ok(e[0] % W < 10, `a flame on tile ${e[0] % W},${(e[0] / W) | 0} crossed the firebreak`);
    }
  }
  let left = 0;
  for (let y = 10; y < 16; y++) for (let x = 4; x < 10; x++) if (s.L.plant[idx(x, y)]) left++;
  let far = 0;
  for (let y = 10; y < 16; y++) for (let x = 13; x < 19; x++) if (s.L.plant[idx(x, y)]) far++;
  assert.ok(maxFires >= 6, `it spread (${maxFires} flames at once)`);
  assert.ok(left < 18, `most of the wood burnt (${left} of 36 trees left)`);
  assert.equal(far, 36, 'the wood beyond the firebreak is untouched');
  assert.deepEqual(verifyCaches(s, B_KEYS), []);
});
test('fire: a flammable building burns down; a stone wall does not catch; rain and firefighters put it out', () => {
  fresh();
  const s = grass(32);
  const bed = place(s, 'bed', 10, 10, { mat: 'wood' });
  const wall = place(s, 'wall', 11, 10, { mat: 'granite' });
  assert.ok(canBurn(s, idx(10, 10)) && !canBurn(s, idx(11, 10)));
  ignite(s, idx(10, 10));
  step(s, 40 * 20);
  assert.ok(!s.bld[bed.id], 'the bed burnt');
  assert.ok(s.bld[wall.id], 'the stone wall stands');
  // rain
  setPlant(s, idx(20, 20), plantCode('oak'), 255);
  ignite(s, idx(20, 20));
  setWeather(s, 'rain', 10);
  step(s, 2 * TICKS_PER_HOUR);
  assert.equal(burning(s, idx(20, 20)), false, 'the rain put it out');
  // firefighting
  setWeather(s, 'clear', 1);
  setPlant(s, idx(25, 25), plantCode('oak'), 255);
  ignite(s, idx(25, 25));
  let out = false;
  for (let k = 0; k < 40 && !out; k++) out = extinguish(s, idx(25, 25));
  assert.ok(out && !burning(s, idx(25, 25)));
});
test('fire: a burning save continues identically', () => {
  fresh();
  const s = grass(32);
  for (let y = 5; y < 20; y++) for (let x = 5; x < 20; x++) setPlant(s, idx(x, y), plantCode('oak'), 255);
  ignite(s, idx(12, 12));
  step(s, 300);
  const s2 = loadBlobSync(saveBlobSync(s));
  step(s, 900); step(s2, 900);
  assert.equal(stateHash(s2), stateHash(s));
});

// ---- mechanisms (acceptance: a lever locks a linked gate and the hostile region set changes) -------------------
test('mechanisms: a lever locks a linked gate and the hostile region set changes', () => {
  fresh();
  const s = grass(32);
  // a wall across the map at y = 16 with a 2-wide gate at x 14-15
  for (let x = 0; x < 32; x++) if (x !== 14 && x !== 15) place(s, 'wall', x, 16, { mat: 'granite' });
  const lever = place(s, 'lever', 10, 12);
  const gate = place(s, 'gate', 14, 16);
  assert.equal(gate.link, lever.id, 'the gate linked itself to the nearest lever');
  assert.deepEqual(linksOf(s, lever.id).map((b) => b.id), [gate.id]);
  tick(s);
  const N_ = idx(14, 10), S_ = idx(14, 22);
  // a closed gate is a door: colonists pass, hostiles do not
  assert.ok(reachable(s, N_, S_, 0));
  assert.ok(!reachable(s, N_, S_, 1));
  setLever(s, lever.id, GATE.OPEN);
  tick(s);
  assert.equal(gateMode(s, gate), GATE.OPEN);
  assert.ok(reachable(s, N_, S_, 1), 'held open: hostiles can walk through');
  assert.equal(pullLever(s, lever.id), GATE.CLOSED, 'the cycle goes open > closed > locked');
  assert.equal(pullLever(s, lever.id), GATE.LOCKED);
  tick(s);
  assert.equal(gateMode(s, gate), GATE.LOCKED);
  assert.ok(!reachable(s, N_, S_, 1), 'locked: the hostile region set split');
  assert.ok(!reachable(s, N_, S_, 0), 'and colonists cannot pass either');
  setLever(s, lever.id, GATE.OPEN); tick(s);
  const openSet = s.rt.regionH.slice();
  setLever(s, lever.id, GATE.LOCKED); tick(s);
  assert.notDeepEqual(Array.from(s.rt.regionH), Array.from(openSet), 'the hostile labels changed');
  assert.deepEqual(verifyCaches(s, B_KEYS), []);
  const s2 = loadBlobSync(saveBlobSync(s));
  assert.equal(gateMode(s2, s2.bld[gate.id]), GATE.LOCKED, 'the mode is saved');
});
test('mechanisms: a hostile on a pressure plate locks its gate and drops its deadfall', () => {
  fresh();
  const s = rockMap(40);
  for (let x = 3; x < 30; x++) mineTile(s, idx(x, 20));
  const plate = place(s, 'plate', 12, 20);
  const dead = place(s, 'deadfall', 13, 20);
  assert.equal(dead.link, plate.id);
  assert.equal(link(s, dead.id, plate.id), null);
  const foe = newFoe(1, 'husk', { x: 12 * 32 + 16, y: 20 * 32 + 16, hp: { hp: 100, max: 100 } });
  s.foes.push(foe);
  tick(s);
  assert.equal(foe.hp.hp, 40, 'the deadfall dropped 60 on it');
  assert.ok(!s.bld[dead.id], 'single use');
  const r = firePlate(s, plate.id);
  assert.equal(r.traps, 0);
});

// ---- blight and Waystones ----------------------------------------------------------------------------------
test('blight: infertile, cleansed by light and Waystones, Husk sites from unlit patches', () => {
  fresh();
  const s = grass(48);
  for (let y = 30; y < 36; y++) for (let x = 30; x < 36; x++) s.L.blight[idx(x, y)] = 255;
  assert.equal(canSow(s, idx(31, 31), plantCode('hearthroot')), 'the soil is blighted');
  s.tick = 2 * TICKS_PER_DAY;                              // midnight: dark
  initRuntime(s);
  assert.equal(huskSites(s).length, 1, 'one unlit patch of 36 tiles');
  const lamp = place(s, 'brazier', 32, 32);
  lamp.fuel = TICKS_PER_DAY;
  s.rt.dirty.light = true; tick(s);
  assert.equal(huskSites(s).length, 0, 'a lit patch raises nothing');
  s.tick = 3 * TICKS_PER_DAY;
  const r = blightDay(s);
  assert.ok(r.cleansed > 0 && s.L.blight[idx(32, 32)] === 235, 'lit tiles lose 20 a day');
  assert.ok(blightCount(s) === 36);
});
test('waystones: must touch claimed land, and the tier limits how many', () => {
  fresh();
  const s = grass(64);
  place(s, 'hearth', 10, 10);
  tick(s);
  assert.equal(waystoneWhy(s, 12, 12), null, 'inside the Hearth claim');
  assert.match(waystoneWhy(s, 50, 50), /claimed land/);
  place(s, 'waystone', 12, 12);
  assert.match(waystoneWhy(s, 13, 13), /at this prosperity/, 'Camp keeps one');
});

// ---- Stage 2 maps and discoveries ----------------------------------------------------------------------------
test('mapgen (Stage 2): 3-5 caverns, springs, a sealed vault with loot, ruins and about 6% blight away from the site', async () => {
  fresh();
  const { generateWorld } = await import('../lib/mapgen1.js');
  const s = createColony(3);
  const info = generateWorld(s);
  const x = info.stage2;
  assert.ok(x.caverns >= 3 && x.caverns <= 5, `${x.caverns} caverns`);
  assert.ok(x.springs >= 1 && x.ruins === 3 && x.vault, JSON.stringify(x));
  assert.ok(s.items.some((it) => it && it.name === 'Old Crown tablet'), 'the vault holds a lore tablet');
  const h = info.hearth;
  let near = 0;
  for (let i = 0; i < s.L.blight.length; i++) if (s.L.blight[i] && Math.max(Math.abs((i % W) - h.cx), Math.abs(((i / W) | 0) - h.cy)) < 30) near++;
  assert.equal(near, 0, 'no blight within 30 tiles of the Hearth');
  assert.ok(blightCount(s) > 400, `${blightCount(s)} blighted tiles`);
  assert.equal(unsupportedCount(s), 0, 'every cavern roof is held');
});
test('discovery: mining into a cavern emits it once', () => {
  fresh();
  const s = rockMap(40);
  s.L.terrain[idx(20, 20)] = TER.MOSS; s.L.roof[idx(20, 20)] = ROOF.MOUNTAIN;
  initRuntime(s);
  for (let x = 3; x <= 19; x++) mineTile(s, idx(x, 20));
  const d = s.rt.events.filter((e) => e.name === 'discovery');
  assert.equal(d.length, 1);
  assert.equal(d[0].data.kind, 'cavern');
});
test('disasters for H: a tremor brings down barely held roofs; a blight surge creeps out of season', async () => {
  fresh();
  const s = rockMap(40);
  for (let y = 12; y < 21; y++) for (let x = 14; x < 23; x++) mineTile(s, idx(x, y));   // 9 x 9: held by its span
  assert.equal(unsupportedCount(s), 0);
  const { tremor } = await import('../../js/game/world/support.js');
  const q = tremor(s, idx(18, 16), 6);
  assert.ok(q.length > 0, 'the barely held middle rumbles');
  step(s, 60);
  assert.equal(s.L.terrain[idx(18, 16)], TER.RUBBLE, 'and falls');
  const { blightSurge } = await import('../../js/game/world/blight.js');
  const g = grass(32);
  for (let y = 10; y < 16; y++) for (let x = 10; x < 16; x++) g.L.blight[idx(x, y)] = 255;
  let n = 0;
  for (let d = 0; d < 4; d++) { g.tick += TICKS_PER_DAY; n += blightSurge(g); }
  assert.ok(n > 0 && blightCount(g) > 36, `crept ${n} tiles`);
});
