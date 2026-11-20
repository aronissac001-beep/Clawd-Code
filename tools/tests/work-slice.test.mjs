// Workstream E, Stage 1a acceptance (doc 14.6 row E) and the slice work loop:
//   two haulers split a stack; a frame cancelled mid-build drops its materials; an unreachable job
//   is rejected without an A* call; mining 1,500 tiles leaves <= 160 stone stacks; filling one cell
//   does not rebuild a zone field. Plus: blueprint > frame > done with deliveries, a stamped
//   bedroom furnished through a D8 auto-bill, smart default bills, stone hauled only when needed,
//   the 5 givers, and save/load mid-job continuing identically. Every run keeps reservations equal
//   to rebuildFromJobs at every tick end (installSim checks) and the caches equal a rebuild.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installSim } from '../../js/game/core/setup.js';
import { createColony, initRuntime, stateHash } from '../../js/game/core/state.js';
import { tick } from '../../js/game/core/sim.js';
import { applyCommand } from '../../js/game/core/commands.js';
import { newColonist, WORK_IDS } from '../../js/game/core/schema.js';
import { idx, ctrW, TER, DESIG, W, H } from '../../js/game/core/grid.js';
import { verifyCaches } from '../../js/game/core/rtcontract.js';
import { structDef } from '../../js/game/core/content.js';
import { saveBlobSync, loadBlobSync } from '../../js/game/save/colonysave.js';
import { pathStats, resetPathStats } from '../../js/game/systems/pathing.js';
import { stoneId } from '../../js/game/world/defs.js';
import { setWorkHooks, workHooks, keyItem } from '../../js/game/work/jobs.js';
import * as I from '../../js/game/work/items.js';
import { fieldBuildCount } from '../../js/game/work/stockpiles.js';
import { refundOf } from '../../js/game/work/construct.js';
import { rollQuality } from '../../js/game/work/quality.js';

const WI = (w) => WORK_IDS.indexOf(w);
/** A flat 48 x 48 grass colony with optional terrain painting, the 1a sim installed with checks. */
function scene({ seed = 'E-SLICE', w = 48, paint = null, fast = 0 } = {}) {
  installSim({ stage: '1a', reset: true, checks: true });
  if (fast) { const base = workHooks().speed; setWorkHooks({ speed: (s, c, t) => base(s, c, t) * fast }); }
  const s = createColony(seed, { w });
  if (paint) paint(s);
  s.L.fog.fill(255);   // explored everywhere (zones and blueprints need explored ground)
  initRuntime(s);
  return s;
}
function addCol(s, x, y, works, opts = {}) {
  const id = s.next.col++;
  const c = newColonist(id, { name: `C${id}`, x: ctrW(x), y: ctrW(y), ...opts });
  c.prio.fill(0);
  for (const [wk, p] of Object.entries(works)) c.prio[WI(wk)] = p;
  s.col.push(c);
  return c;
}
const cmd = (s, c) => { const r = applyCommand(s, c); assert.ok(r.ok, `${c.t}: ${r.reason}`); return r; };
const units = (s, k) => s.items.filter(Boolean).filter((it) => it.k === k).reduce((a, it) => a + it.n, 0)
  + s.col.reduce((a, c) => a + (c.job && c.job.carry && c.job.carry.k === k ? c.job.carry.n : 0) + ((c.job && c.job.held) || []).filter((b) => b.k === k).reduce((x, b) => x + b.n, 0), 0);
function run(s, n, until = null, every = 0) {
  for (let t = 0; t < n; t++) {
    tick(s);
    if (every && t % every === 0) assert.deepEqual(verifyCaches(s), [], `caches at tick ${s.tick}`);
    if (until && until(s)) return t + 1;
  }
  return n;
}
const rockRect = (s, x0, y0, x1, y1, mat = 'granite') => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = idx(x, y); s.L.terrain[i] = TER.ROCK; s.L.mat[i] = stoneId(mat); }
};

test('two haulers split one stack, both deliver, nothing is lost', () => {
  const s = scene();
  const a = addCol(s, 4, 10, { haul: 1 }), b = addCol(s, 4, 12, { haul: 1 });
  cmd(s, { t: 'zone', op: 'new', type: 'stockpile', rect: { x0: 30, y0: 8, x1: 34, y1: 12 }, preset: 'all' });
  const id = I.spawn(s, 'wood', 'wood', 0, 30, 6, 11);
  let both = false;
  run(s, 400, () => {
    const pa = a.job && a.job.type === 'haul' && a.job.claims.find((c) => c[0] === keyItem(id));
    const pb = b.job && b.job.type === 'haul' && b.job.claims.find((c) => c[0] === keyItem(id));
    if (pa && pb) { both = true; assert.ok(pa[1] > 0 && pb[1] > 0 && pa[1] + pb[1] <= 30, `split ${pa[1]} + ${pb[1]}`); }
    return both;
  });
  assert.ok(both, 'two haulers held partial claims on the same stack at once');
  run(s, 3000, (st) => units(st, 'wood') === 30 && st.items.filter(Boolean).every((it) => st.L.zone[idx(it.x, it.y)] === 1) && !st.col.some((c) => c.job && c.job.type === 'haul'));
  assert.equal(units(s, 'wood'), 30, 'wood conserved');
  assert.ok(s.items.filter(Boolean).every((it) => s.L.zone[idx(it.x, it.y)] === 1), 'all wood stored');
  assert.equal(I.totals(s, 'wood'), 30, 'colony stock counts it');
  assert.equal(s.rt.res.size, 0);
  assert.deepEqual(verifyCaches(s), []);
});

test('blueprint > frame > done: a door gets its wood delivered in trips, then is built', () => {
  const s = scene({ fast: 4 });
  addCol(s, 6, 6, { build: 1 });
  I.spawn(s, 'wood', 'wood', 0, 40, 8, 8);
  const r = cmd(s, { t: 'place', def: 'door', x: 20, y: 10, rot: 0 });
  const b = s.bld[r.id];
  assert.equal(b.st, 'bp');
  let sawFrame = false;
  run(s, 4000, (st) => { if (b.st === 'frame') sawFrame = true; return b.st === 'done'; }, 97);
  assert.ok(sawFrame, 'became a frame on the first delivery');
  assert.equal(b.st, 'done');
  assert.equal(units(s, 'wood'), 20, '20 wood used');
  assert.equal(s.rt.walkCost[idx(20, 10)], 255, 'the door is a door for the walk map');
});

test('a frame cancelled mid-build drops its materials (and the carry), with no reservation left', () => {
  const s = scene();
  const c = addCol(s, 6, 6, { build: 1 });
  I.spawn(s, 'wood', 'wood', 0, 40, 8, 8);
  const b = s.bld[cmd(s, { t: 'place', def: 'door', x: 20, y: 10, rot: 0 }).id];
  run(s, 6000, () => c.job && c.job.type === 'construct' && b.work > 0);
  assert.equal(c.job && c.job.type, 'construct', 'mid-build');
  assert.equal(b.got.wood, 20);
  cmd(s, { t: 'cancelRect', rect: { x0: 20, y0: 10, x1: 20, y1: 10 }, kinds: ['bp'] });
  assert.equal(s.bld[b.id] || null, null, 'the frame is gone');
  assert.equal(c.job, null, 'the builder stopped');
  assert.equal(units(s, 'wood'), 40, 'the delivered wood is back on the ground');
  const near = s.items.filter(Boolean).filter((it) => it.k === 'wood' && Math.max(Math.abs(it.x - 20), Math.abs(it.y - 10)) <= 1);
  assert.equal(near.reduce((a, it) => a + it.n, 0), 20, 'dropped where the frame stood');
  assert.equal(s.rt.res.size, 0);
  tick(s);
  assert.deepEqual(verifyCaches(s), []);
  // and while carrying: the carried units drop at the builder's feet
  const b2 = s.bld[cmd(s, { t: 'place', def: 'door', x: 24, y: 10, rot: 0 }).id];
  run(s, 3000, () => c.job && c.job.type === 'deliver' && c.job.carry);
  assert.ok(c.job && c.job.carry, 'carrying wood');
  cmd(s, { t: 'cancelRect', rect: { x0: 24, y0: 10, x1: 24, y1: 10 }, kinds: ['bp'] });
  assert.equal(s.bld[b2.id] || null, null);
  assert.equal(units(s, 'wood'), 40, 'nothing lost while carrying');
  assert.equal(s.rt.res.size, 0);
});

test('an unreachable job is rejected without an A* call', () => {
  // a sealed rock pocket with a stack, a designated rock tile inside it and a blueprint; a hauler,
  // a miner and a builder outside
  const s = scene({ paint: (st) => {
    rockRect(st, 20, 10, 30, 20);
    for (let y = 13; y <= 17; y++) for (let x = 23; x <= 27; x++) st.L.terrain[idx(x, y)] = TER.ROUGH;
    st.L.terrain[idx(25, 15)] = TER.ROCK;
  } });
  addCol(s, 5, 5, { haul: 1, mine: 1, build: 1 });
  cmd(s, { t: 'zone', op: 'new', type: 'stockpile', rect: { x0: 2, y0: 30, x1: 6, y1: 34 }, preset: 'all' });
  I.spawn(s, 'wood', 'wood', 0, 20, 24, 14);
  cmd(s, { t: 'designate', kind: 'mine', rect: { x0: 25, y0: 15, x1: 25, y1: 15 }, add: true });
  cmd(s, { t: 'place', def: 'door', x: 26, y: 16, rot: 0 });
  resetPathStats();
  run(s, 600);
  assert.equal(pathStats.searches, 0, 'no A* search was started');
  assert.equal(s.col[0].job && s.col[0].job.type, 'idle');
  assert.equal(s.L.terrain[idx(25, 15)], TER.ROCK);
  // opening the pocket makes all three reachable
  cmd(s, { t: 'designate', kind: 'mine', rect: { x0: 20, y0: 15, x1: 22, y1: 15 }, add: true });
  run(s, 20000, (st) => st.L.terrain[idx(25, 15)] === TER.ROUGH && I.stackAt(st, idx(24, 14)) === null);
  assert.equal(s.L.terrain[idx(25, 15)], TER.ROUGH, 'mined once reachable');
  assert.ok(pathStats.searches > 0);
});

test('mining 1,500 tiles leaves at most 160 stone stacks (stone piles, never hauled)', () => {
  // a 60 x 40 Carve hall with natural pillars (A's carve tool: a 9-tile grid keeps every roof supported)
  const s = scene({ w: 80, fast: 12, paint: (st) => rockRect(st, 4, 10, 63, 49) });
  for (let k = 0; k < 3; k++) addCol(s, 10 + 15 * k, 6, { mine: 1, haul: 2 });
  cmd(s, { t: 'zone', op: 'new', type: 'stockpile', rect: { x0: 66, y0: 2, x1: 75, y1: 8 }, preset: 'all' });
  cmd(s, { t: 'carve', rect: { x0: 4, y0: 10, x1: 63, y1: 49 }, pattern: 'natural', smooth: false });
  const want = s.L.desig.reduce((a, v) => a + (v & DESIG.MINE ? 1 : 0), 0);
  assert.ok(want >= 1500, `${want} tiles designated`);
  const roughCount = (st) => { let n = 0; for (let i = 0; i < st.L.terrain.length; i++) if (st.L.terrain[i] === TER.ROUGH) n++; return n; };
  const stoneStacks = (st) => st.items.filter(Boolean).filter((it) => it.k === 'stone').length;
  let at1500 = null;
  const ticks = run(s, 80000, (st) => {
    if (st.tick % 20 !== 0) return false;
    if (!at1500 && roughCount(st) >= 1500) at1500 = [roughCount(st), stoneStacks(st)];
    return st.L.desig.every((v) => !(v & DESIG.MINE));
  }, 4999);
  assert.ok(at1500 && at1500[1] <= 160, `at ${at1500 && at1500[0]} tiles mined: ${at1500 && at1500[1]} stone stacks`);
  let mined = 0;
  for (let i = 0; i < s.L.terrain.length; i++) if (s.L.terrain[i] === TER.ROUGH) mined++;
  const piles = s.items.filter(Boolean).filter((it) => it.k === 'stone');
  const stone = piles.reduce((a, it) => a + it.n, 0);
  const per1500 = Math.round((piles.length * 1500) / mined);
  assert.ok(mined >= 1500, `mined ${mined} in ${ticks} ticks`);
  assert.ok(per1500 <= 160, `${piles.length} stone stacks for ${stone} stone from ${mined} tiles (${per1500} per 1,500)`);
  assert.ok(stone >= mined * 0.6 && stone <= mined * 0.8, `stone yield ${stone} of ${mined}`);
  assert.ok(piles.every((it) => s.L.zone[idx(it.x, it.y)] === 0), 'stone is left in place (hauled only when needed)');
  assert.equal(s.L.terrain.filter((t) => t === TER.RUBBLE).length, 0, 'no cave-in');
  console.log(`# mining: ${at1500[0]} tiles -> ${at1500[1]} stone stacks; all ${mined} tiles in ${ticks} ticks -> ${piles.length} stacks (${stone} stone; ${per1500} per 1,500 tiles)`);
});

test('filling one cell does not rebuild a zone field; filling the last one does', () => {
  const s = scene();
  cmd(s, { t: 'zone', op: 'new', type: 'stockpile', rect: { x0: 10, y0: 10, x1: 12, y1: 12 }, preset: 'all' });
  tick(s);
  const g = s.rt.zoneField[0];
  assert.ok(g && g.open.length === 1 && !('dist' in g), 'one open group (Z1 E5: no zone distance field)');
  const n0 = fieldBuildCount(), field0 = g;
  I.spawn(s, 'wood', 'wood', 0, 5, 11, 11);
  tick(s);
  assert.equal(fieldBuildCount(), n0, 'no rebuild after filling one cell');
  assert.equal(s.rt.zoneField[0], field0, 'same group object');
  assert.equal(s.rt.zoneFree.lists[0].cells.length, 8);
  assert.deepEqual(verifyCaches(s), []);
  for (let y = 10; y <= 12; y++) for (let x = 10; x <= 12; x++) if (!I.stackAt(s, idx(x, y))) I.spawn(s, 'stone', 'granite', 0, 1, x, y);
  tick(s);
  assert.equal(fieldBuildCount(), n0 + 1, 'the zone filled up: one rebuild');
  assert.equal(s.rt.zoneField[0].open.length, 0);
  assert.deepEqual(verifyCaches(s), []);
  // freeing a cell reopens it (one more rebuild)
  I.destroy(s, I.stackAt(s, idx(10, 10)).id);
  tick(s);
  assert.equal(fieldBuildCount(), n0 + 2);
  assert.deepEqual(s.rt.zoneFree.lists[0].cells, [idx(10, 10)]);
  assert.deepEqual(verifyCaches(s), []);
});

test('stone is hauled only when needed: the mason fetches it; "always" hauls piles', () => {
  const s = scene({ fast: 6 });
  addCol(s, 6, 6, { haul: 1, craft: 1, build: 1 });
  cmd(s, { t: 'zone', op: 'new', type: 'stockpile', rect: { x0: 30, y0: 4, x1: 36, y1: 10 }, preset: 'all' });
  I.spawn(s, 'stone', 'granite', 0, 10, 10, 20);
  I.spawn(s, 'wood', 'wood', 0, 40, 8, 8);
  run(s, 600);
  assert.equal(I.stackAt(s, idx(10, 20)).n, 10, 'the pile stays (When needed)');
  // a mason's bench: its cost needs 2 stone (fetched by the builder), then its default bill cuts blocks
  const b = s.bld[cmd(s, { t: 'place', def: 'mason', x: 14, y: 14, rot: 0 }).id];
  assert.deepEqual(b.bills.map((x) => [x.recipe, x.mode, x.n]), [['cut_blocks', 'until', 100]], 'smart default bill');
  run(s, 20000, () => units(s, 'block') >= 30, 499);
  assert.equal(b.st, 'done');
  assert.ok(units(s, 'block') >= 30, `blocks ${units(s, 'block')}`);
  assert.equal(units(s, 'stone'), 10 - 2 - units(s, 'block') / 10, 'stone went into the bench and the blocks');
  assert.ok(s.items.filter(Boolean).filter((it) => it.k === 'block').every((it) => it.m === 'granite'), 'blocks keep the stone material');
  // 'always': a stone pile is hauled to the stockpile
  s.colony.stoneHaul = 'always';
  I.spawn(s, 'stone', 'slate', 0, 3, 4, 30);
  run(s, 6000, (st) => !I.stackAt(st, idx(4, 30)));
  assert.equal(I.stackAt(s, idx(4, 30)), null, 'hauled');
});

test('a stamped bedroom gets walls, a door, floors and a bed (D8 auto-bill at the carpenter)', () => {
  const s = scene({ fast: 8, seed: 'E-BEDROOM' });
  for (let k = 0; k < 3; k++) addCol(s, 4 + k, 4, { build: 1, craft: 2, haul: 3 });
  cmd(s, { t: 'zone', op: 'new', type: 'stockpile', rect: { x0: 2, y0: 30, x1: 8, y1: 36 }, preset: 'all' });
  for (let k = 0; k < 6; k++) I.spawn(s, 'wood', 'wood', 0, 75, 4 + k, 8);
  const bench = s.bld[cmd(s, { t: 'place', def: 'carpenter', x: 12, y: 6, rot: 0 }).id];
  const r = cmd(s, { t: 'stamp', kind: 'bedroom', rect: { x0: 20, y0: 10, x1: 24, y1: 13 }, wallMat: 'wood', furnish: true });
  const bed = r.ids.map((id) => s.bld[id]).find((b) => b && b.def === 'bed');
  assert.ok(bed, 'the stamp planned a bed');
  run(s, 60000, () => bed.st === 'done' && s.bld.every((b) => !b || b.st === 'done'), 997);
  assert.equal(bench.st, 'done');
  assert.equal(bed.st, 'done', 'the bed is installed');
  assert.ok(bed.q >= 0 && bed.q <= 5 && bed.mat === 'wood');
  assert.ok(s.bld.every((b) => !b || b.st === 'done'), 'every blueprint finished');
  let floors = 0;
  for (let y = 11; y <= 12; y++) for (let x = 21; x <= 23; x++) if (s.L.floor[idx(x, y)]) floors++;
  assert.ok(floors >= 3, `floors laid: ${floors}`);
  assert.ok(!bench.bills.some((b) => b.bp), 'the blueprint bill is gone once made');
  assert.deepEqual(verifyCaches(s), []);
});

test('deconstruct returns materials; quality rolls are deterministic and in range', () => {
  const s = scene({ fast: 8 });
  addCol(s, 6, 6, { build: 1 });
  I.spawn(s, 'wood', 'wood', 0, 40, 8, 8);
  const b = s.bld[cmd(s, { t: 'place', def: 'door', x: 20, y: 10, rot: 0 }).id];
  run(s, 6000, () => b.st === 'done');
  assert.deepEqual(refundOf(b), [['wood', 'wood', 0, 10]]);
  cmd(s, { t: 'deconstruct', ids: [b.id] });
  run(s, 3000, () => !s.bld[b.id]);
  assert.equal(s.bld[b.id] || null, null);
  assert.equal(units(s, 'wood'), 30);
  const a = createColony('Q'), c = createColony('Q');
  const qa = [], qc = [];
  for (let k = 0; k < 200; k++) { qa.push(rollQuality(a, k % 21)); qc.push(rollQuality(c, k % 21)); }
  assert.deepEqual(qa, qc);
  assert.ok(qa.every((q) => q >= 0 && q <= 5));
  assert.ok(qa.slice(0, 3).every((q) => q <= 1), 'level 0 rolls crude or plain');
});

test('the 5 givers together: save and load mid-job continues identically, caches stay exact', () => {
  const build = () => {
    const s = scene({ fast: 6, seed: 'E-MIX', paint: (st) => rockRect(st, 30, 4, 46, 30) });
    addCol(s, 10, 10, { mine: 1, haul: 2, build: 3 });
    addCol(s, 12, 10, { build: 1, craft: 2, chop: 3, haul: 3 });
    addCol(s, 14, 10, { haul: 1, chop: 2, craft: 3 });
    s.L.plant[idx(5, 20)] = 1; s.L.growth[idx(5, 20)] = 255;   // an oak
    s.L.plant[idx(8, 22)] = 2; s.L.growth[idx(8, 22)] = 200;   // a pine
    for (let k = 0; k < 4; k++) I.spawn(s, 'wood', 'wood', 0, 60, 16 + k, 16);
    cmd(s, { t: 'zone', op: 'new', type: 'stockpile', rect: { x0: 2, y0: 36, x1: 8, y1: 42 }, preset: 'all' });
    cmd(s, { t: 'designate', kind: 'chop', rect: { x0: 0, y0: 18, x1: 10, y1: 24 }, add: true });
    cmd(s, { t: 'designate', kind: 'mine', rect: { x0: 30, y0: 10, x1: 36, y1: 12 }, add: true });
    cmd(s, { t: 'place', def: 'carpenter', x: 16, y: 26, rot: 0 });
    cmd(s, { t: 'placeLine', def: 'wall', path: [[20, 30], [21, 30], [22, 30], [23, 30]], mat: 'wood' });
    return s;
  };
  const A = build();
  const hashes = [];
  for (let t = 0; t < 3000; t++) { tick(A); if (t % 500 === 499) hashes.push(stateHash(A)); }
  let B = build();
  const got = [];
  for (let t = 0; t < 3000; t++) {
    if (t === 777 || t === 1601 || t === 2400) {
      const jobs = B.col.map((c) => c.job && c.job.type);
      B = loadBlobSync(saveBlobSync(B));
      assert.deepEqual(B.col.map((c) => c.job && c.job.type), jobs, 'jobs survive the save');
      assert.deepEqual(verifyCaches(B), []);
    }
    tick(B);
    if (t % 500 === 499) got.push(stateHash(B));
    if (t % 250 === 0) assert.deepEqual(verifyCaches(B), [], `caches at ${t}`);
  }
  assert.deepEqual(got, hashes, 'save/load mid-job continues identically');
  assert.ok(A.L.plant[idx(5, 20)] === 0, 'the oak was felled');
  assert.ok(A.L.terrain[idx(33, 11)] === TER.ROUGH, 'the miner dug');
  assert.ok(A.bld.some((b) => b && b.def === 'wall' && b.st === 'done'), 'a wall was built');
  assert.ok(structDef('carpenter'));
});

test('stockpile priorities: stacks move to a better zone, and out of zones that do not accept them', () => {
  const s = scene();
  addCol(s, 4, 4, { haul: 1 });
  const low = cmd(s, { t: 'zone', op: 'new', type: 'stockpile', rect: { x0: 10, y0: 10, x1: 12, y1: 12 }, preset: 'all' }).zoneId;
  I.spawn(s, 'wood', 'wood', 0, 10, 2, 20);
  run(s, 2000, (st) => I.stackAt(st, idx(2, 20)) === null && !st.col[0].job?.carry);
  const inLow = () => s.items.filter(Boolean).filter((it) => it.k === 'wood' && s.L.zone[idx(it.x, it.y)] === low).reduce((a, it) => a + it.n, 0);
  assert.equal(inLow(), 10, 'stored in the only zone');
  const food = cmd(s, { t: 'zone', op: 'new', type: 'stockpile', rect: { x0: 30, y0: 30, x1: 32, y1: 32 }, preset: 'store' }).zoneId;
  const best = cmd(s, { t: 'zone', op: 'new', type: 'stockpile', rect: { x0: 20, y0: 4, x1: 22, y1: 6 }, preset: 'all' }).zoneId;
  cmd(s, { t: 'zoneCfg', zoneId: best, patch: { pri: 2 } });
  I.spawn(s, 'wood', 'wood', 0, 5, 31, 31);   // wood in the food store: not accepted there
  run(s, 4000, (st) => st.items.filter(Boolean).every((it) => st.L.zone[idx(it.x, it.y)] === best) && !st.col[0].job?.carry);
  assert.ok(s.items.filter(Boolean).every((it) => s.L.zone[idx(it.x, it.y)] === best), 'all wood in the Preferred zone');
  assert.equal(units(s, 'wood'), 15);
  void food;
  assert.deepEqual(verifyCaches(s), []);
});

test('prioritise: a tapped target replaces the current job', () => {
  const s = scene({ paint: (st) => { rockRect(st, 20, 2, 40, 40); } });
  const c = addCol(s, 18, 20, { mine: 1 });
  cmd(s, { t: 'designate', kind: 'mine', rect: { x0: 20, y0: 18, x1: 20, y1: 22 }, add: true });
  cmd(s, { t: 'designate', kind: 'mine', rect: { x0: 20, y0: 4, x1: 20, y1: 4 }, add: true });
  run(s, 200, () => c.job && c.job.type === 'mine');
  assert.notEqual(c.job.target, idx(20, 4));
  cmd(s, { t: 'prioritise', colId: c.id, target: { x: 20, y: 4 }, work: 'mine' });
  assert.equal(c.job.target, idx(20, 4), 'forced job on the tapped tile');
  assert.ok(c.job.forced);
  run(s, 3000, () => s.L.terrain[idx(20, 4)] === TER.ROUGH);
  assert.equal(s.L.terrain[idx(20, 4)], TER.ROUGH);
  const bad = applyCommand(s, { t: 'prioritise', colId: c.id, target: { x: 2, y: 2 }, work: 'mine' });
  assert.equal(bad.ok, false, 'nothing to mine there');
});
