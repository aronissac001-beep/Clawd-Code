// Stage Z1 step E5 (EMBERCROWN-FORTRESS.md 8.3): work across levels. The oracle cases:
//   - a 5-level stair stack is dug top-down by one miner standing on each stair in turn (goal mode ABOVE);
//   - a hauler carries stone up 3 levels to the nearest store by region distance (zone fields are gone);
// plus stacks with z (put, spill, fall), 3D work-index buckets, Ramp and Channel jobs, a built floor over
// air and built stairs, a save mid-dig that continues identically, and the D = 1 cluster ring order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installSim } from '../../js/game/core/setup.js';
import { createColony, initRuntime, stateHash } from '../../js/game/core/state.js';
import { tick } from '../../js/game/core/sim.js';
import { newColonist, newZone, WORK_IDS } from '../../js/game/core/schema.js';
import { idx, ctrW, TER, PLANE, CW, CH, setMapSize } from '../../js/game/core/grid.js';
import { verifyCaches } from '../../js/game/core/rtcontract.js';
import { def } from '../../js/game/core/content.js';
const defaultFilter = (p) => ({ cats: def('zonePreset', p).cats.slice(), mats: [], q: [0, 6] });
import * as I from '../../js/game/work/items.js';
import { VD, setVdig, vdigAt, vdigList, designateVertical, stairKindFor } from '../../js/game/work/vdig.js';
import { clusterRings } from '../../js/game/work/windex.js';
import { colTile } from '../../js/game/work/reserve.js';
import { regionDist } from '../../js/game/world/terrain.js';

const WI = (w) => WORK_IDS.indexOf(w);
const SOLID = TER.ROCK;
/** A w x w x d world: rock everywhere below the top level, open rough floor on top; paint(s) before the runtime. */
function world({ w = 32, d = 6, paint = null, seed = 'E5-3D' } = {}) {
  installSim({ stage: '1a', reset: true, checks: true });
  const s = createColony(seed, { w, d, zS: d - 1, terrain: SOLID });
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) s.L.terrain[idx(x, y, d - 1)] = TER.ROUGH;
  s.L.mat.fill(3);
  if (paint) paint(s);
  s.L.fog.fill(255);
  initRuntime(s);
  return s;
}
function addCol(s, x, y, z, works) {
  const id = s.next.col++;
  const c = newColonist(id, { name: `C${id}`, x: ctrW(x), y: ctrW(y), z });
  c.prio.fill(0);
  for (const [wk, p] of Object.entries(works)) c.prio[WI(wk)] = p;
  s.col.push(c);
  return c;
}
// E's runtime caches (rtcontract owner E) equal a rebuild; the world caches are E4's (world3d.test.mjs)
const E_KEYS = ['itemAt', 'idx', 'zoneField', 'zoneFree', 'res', 'itemFree', 'bldFree', 'stock', 'thinkQ'];
const eCaches = (s) => verifyCaches(s).filter((k) => E_KEYS.includes(k));
const run = (s, n, until) => { for (let t = 0; t < n; t++) { tick(s); if (until && until(s)) return t + 1; } return n; };

test('a 5-level stair stack is dug top-down by one miner standing on each stair in turn', () => {
  const s = world();
  const top = 5, X = 12, Y = 12;
  const m = addCol(s, 6, 6, top, { mine: 1 });
  const r = designateVertical(s, { kind: 'stairs', rect: { x0: X, y0: Y, x1: X, y1: Y, z: top }, add: true, levels: 5, dir: 'down' });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.n, 5);
  assert.equal(vdigList(s).length, 5);
  // record where the miner stands each time a voxel of the stack turns into a stair
  const order = [], stands = [];
  const col = (z) => idx(X, Y, z);
  let seen = new Set();
  const ticks = run(s, 40000, (st) => {
    for (let z = top; z >= top - 4; z--) {
      if (seen.has(z)) continue;
      const t = st.L.terrain[col(z)];
      if (t === TER.STAIR_U || t === TER.STAIR_D || t === TER.STAIR_UD) { seen.add(z); order.push(z); stands.push(colTile(m)); }
    }
    return seen.size === 5;
  });
  assert.equal(seen.size, 5, `dug ${seen.size} of 5 in ${ticks} ticks`);
  assert.deepEqual(order, [5, 4, 3, 2, 1], 'top-down');
  for (let k = 1; k < 5; k++) assert.equal(stands[k], col(order[k] + 1), `level ${order[k]} dug from the stair above it`);
  assert.equal(s.L.terrain[col(5)], TER.STAIR_D);
  for (let z = 4; z >= 2; z--) assert.equal(s.L.terrain[col(z)], TER.STAIR_UD);
  assert.equal(s.L.terrain[col(1)], TER.STAIR_U);
  assert.equal(vdigList(s).length, 0, 'the designations are gone');
  assert.equal(s.colony.work.vdig, undefined, 'the saved list is removed when empty');
  // the miner can walk to the bottom: regions link down the shaft
  assert.ok(regionDist(s, idx(6, 6, top), col(1), 0) < Infinity, 'the shaft foot is reachable');
  assert.deepEqual(eCaches(s), []);
  console.log(`# stairs: 5 levels in ${ticks} ticks (${(ticks / 1200).toFixed(1)} game hours), stands ${stands.join(' ')}`);
});

test('a hauler carries stone up 3 levels to the nearest store by region distance', () => {
  // z 0..5; a stair column at (4, 4) from z 1 to z 4; open halls on z 1 and z 4; stone on z 1;
  // store A on z 4 next to the stair top; store B on z 1 but 22 tiles away (nearer in plan, farther by region)
  const s = world({ paint(st) {
    for (let y = 2; y < 30; y++) for (let x = 2; x < 30; x++) { st.L.terrain[idx(x, y, 1)] = TER.ROUGH; }
    for (let y = 2; y < 9; y++) for (let x = 2; x < 9; x++) st.L.terrain[idx(x, y, 4)] = TER.ROUGH;
    st.L.terrain[idx(4, 4, 1)] = TER.STAIR_U; st.L.terrain[idx(4, 4, 2)] = TER.STAIR_UD; st.L.terrain[idx(4, 4, 3)] = TER.STAIR_UD; st.L.terrain[idx(4, 4, 4)] = TER.STAIR_D;
    st.zones.push(newZone(1, 'stockpile', { name: 'Upper store', filter: defaultFilter('all'), pri: 1 }));
    st.zones.push(newZone(2, 'stockpile', { name: 'Far store', filter: defaultFilter('all'), pri: 1 }));
    for (let y = 5; y < 8; y++) for (let x = 6; x < 9; x++) st.L.zone[idx(x, y, 4)] = 1;
    for (let y = 24; y < 27; y++) for (let x = 24; x < 27; x++) st.L.zone[idx(x, y, 1)] = 2;
    st.colony.stoneHaul = 'always';
  } });
  const from = idx(6, 6, 1);
  const dA = regionDist(s, from, idx(6, 5, 4), 0), dB = regionDist(s, from, idx(24, 24, 1), 0);
  assert.ok(dA < dB, `store A nearer by region distance (${dA} < ${dB})`);
  I.spawn(s, 'stone', 'granite', 0, 4, 6, 6, { z: 1 });
  const it0 = I.stackAt(s, from);
  assert.ok(it0 && it0.z === 1, 'a stack on level 1');
  const h = addCol(s, 5, 6, 1, { haul: 1 });
  const ticks = run(s, 20000, (st) => st.items.every((it) => !it || it.k !== 'stone' || st.L.zone[I.stackTile(it)] !== 0) && !h.job);
  const stored = s.items.filter((it) => it && it.k === 'stone');
  assert.equal(stored.reduce((a, it) => a + it.n, 0), 4, 'all 4 stone');
  for (const it of stored) {
    assert.equal(it.z, 4, 'stored three levels up');
    assert.equal(s.L.zone[I.stackTile(it)], 1, 'in the upper store');
  }
  assert.equal(h.z, 4, 'the hauler climbed the stairs');
  assert.deepEqual(eCaches(s), []);
  console.log(`# haul up 3 levels: stored in ${ticks} ticks; region distance A ${dA} vs B ${dB}`);
});

test('stacks carry z: put spills on its own level, the index buckets are per level, a channel drops a stack', () => {
  const s = world({ paint(st) { for (let y = 2; y < 12; y++) for (let x = 2; x < 12; x++) st.L.terrain[idx(x, y, 3)] = TER.ROUGH; } });
  const a = I.spawn(s, 'wood', 'pine', 0, 75, 5, 5, { z: 3 }), b = I.spawn(s, 'wood', 'pine', 0, 30, 5, 5, { z: 3 });
  assert.equal(s.items[a].z, 3); assert.equal(s.items[b].z, 3, 'the spill stays on level 3');
  assert.notEqual(I.stackTile(s.items[b]), idx(5, 5, 3));
  const c5 = I.spawn(s, 'wood', 'pine', 0, 5, 5, 5, { z: 5 });
  assert.equal(I.stackAt(s, idx(5, 5, 5)).id, c5, 'same x, y on another level is another tile');
  assert.equal(s.rt.idx.itemsC.length, CW * CH * 6, 'clusters on every level');
  tick(s);
  assert.deepEqual(eCaches(s), []);
  // channel the floor under the level-5 stack: it falls to level 3 (over the open hall)? level 4 is rock: it becomes a ramp
  const ch = idx(5, 5, 5);
  assert.equal(designateVertical(s, { kind: 'channel', rect: { x0: 5, y0: 5, x1: 5, y1: 5, z: 5 }, add: true }).ok, true);
  addCol(s, 8, 8, 5, { mine: 1 });
  run(s, 20000, (st) => !vdigAt(st, ch));
  assert.equal(s.L.terrain[ch], TER.RAMP_TOP);
  assert.equal(s.L.terrain[ch - PLANE], TER.RAMP);
  const fell = s.items.filter((it) => it && it.k === 'wood' && it.n === 5)[0];
  assert.ok(fell && fell.z === 4, `the stack slid down onto the ramp (z ${fell && fell.z})`);
  assert.deepEqual(eCaches(s), []);
});

test('a ramp, a built floor over air and built stairs', () => {
  const s = world({ paint(st) {
    for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) st.L.terrain[idx(x, y, 4)] = TER.ROUGH;
    st.L.terrain[idx(10, 10, 5)] = TER.AIR;   // a hole in the top level over the level-4 hall
    st.L.terrain[idx(11, 11, 5)] = TER.AIR;   // and one for the built stairs
  } });
  addCol(s, 3, 3, 5, { mine: 1, build: 1 });
  I.spawn(s, 'stone', 'granite', 0, 4, 4, 3, { z: 5 });
  const ok = (c) => { const r = designateVertical(s, c); assert.equal(r.ok, true, `${c.kind}: ${r.reason}`); return r; };
  ok({ kind: 'floor', rect: { x0: 10, y0: 10, x1: 10, y1: 10, z: 5 }, add: true });
  assert.equal(ok({ kind: 'bstairs', rect: { x0: 11, y0: 11, x1: 11, y1: 11, z: 5 }, add: true, levels: 2 }).n, 2);
  // a ramp on level 4 against the rock west of the hall, up to the top level
  ok({ kind: 'ramp', rect: { x0: 1, y0: 8, x1: 1, y1: 8, z: 4 }, add: true });
  assert.equal(designateVertical(s, { kind: 'ramp', rect: { x0: 5, y0: 5, x1: 5, y1: 5, z: 5 }, add: true }).ok, false, 'no ramp on the top level');
  const ticks = run(s, 60000, (st) => vdigList(st).length === 0);
  assert.equal(vdigList(s).length, 0, `left: ${JSON.stringify(vdigList(s))}`);
  assert.equal(s.L.terrain[idx(10, 10, 5)], TER.ROUGH, 'the built floor closed the hole');
  assert.equal(s.L.terrain[idx(11, 11, 5)], TER.STAIR_D, 'built stairs over the air');
  assert.equal(s.L.terrain[idx(11, 11, 4)], TER.STAIR_U, 'built stairs on the hall floor');
  assert.equal(s.L.terrain[idx(1, 8, 4)], TER.RAMP);
  assert.equal(s.L.terrain[idx(1, 8, 5)], TER.RAMP_TOP);
  const stone = s.items.filter((it) => it && it.k === 'stone').reduce((a, it) => a + it.n, 0);
  assert.ok(stone <= 2 + 1, `two units built in (${stone} stone left of 4, plus any ramp yield)`);
  assert.deepEqual(eCaches(s), []);
  console.log(`# built floor, built stairs (2 levels) and a ramp in ${ticks} ticks`);
});

test('stair kinds follow the column; extending a stack widens its end', () => {
  const s = world();
  const i = idx(8, 8, 3);
  setVdig(s, i + PLANE, VD.STAIR); setVdig(s, i - PLANE, VD.STAIR);
  assert.equal(stairKindFor(s, i), TER.STAIR_UD);
  setVdig(s, i - PLANE, 0);
  assert.equal(stairKindFor(s, i), TER.STAIR_U);
  setVdig(s, i + PLANE, 0); setVdig(s, i - PLANE, VD.STAIR);
  assert.equal(stairKindFor(s, i), TER.STAIR_D);
});

test('a save mid-dig continues identically (vdig list and index are saved state and C13 rebuilds)', async () => {
  const { saveBlobSync, loadBlobSync } = await import('../../js/game/save/colonysave.js');
  const { buildPristine, attachPristine } = await import('../../js/game/save/pristine.js');
  const mk = () => {
    const s = world({ seed: 'E5-SAVE' });
    attachPristine(s, buildPristine(s, { worldKind: 3, genVersion: 1, meta: { amendments: [], dormant: [] } }));
    addCol(s, 6, 6, 5, { mine: 1 });
    designateVertical(s, { kind: 'stairs', rect: { x0: 10, y0: 10, x1: 11, y1: 10, z: 5 }, add: true, levels: 4 });
    return s;
  };
  const a = mk();
  run(a, 3000);
  let b;
  try { b = loadBlobSync(saveBlobSync(a)); } catch (e) { assert.fail(`D > 1 save: ${e.message}`); }
  assert.ok(a.colony.work && a.colony.work.vdig && a.colony.work.vdig.length > 0, 'saved mid-dig');
  assert.equal(stateHash(b), stateHash(a), 'loads equal');
  run(a, 3000); run(b, 3000);
  assert.equal(stateHash(b), stateHash(a), 'continues identically');
});

test('the cluster ring order at D = 1 is the Stage 2 order', () => {
  setMapSize(64, 64, 1, 0);
  const got = [];
  clusterRings(1, 1, (c, r) => { got.push(c); return r >= 2; });
  const want = [];
  for (let r = 0; r <= 2; r++) for (let y = 1 - r; y <= 1 + r; y++) for (let x = 1 - r; x <= 1 + r; x++) {
    if (x < 0 || y < 0 || x >= 4 || y >= 4 || Math.max(Math.abs(x - 1), Math.abs(y - 1)) !== r) continue;
    want.push(y * 4 + x);
  }
  assert.deepEqual(got, want);
});
