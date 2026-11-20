// Stage Z1 E10: the 3D generator (EMBERCROWN-FORTRESS.md 2.2). Oracle: seeds 1-100 pass every 2.2 guarantee with
// <= 4 re-rolls of any step; two runs hash equal; the regeneration fallback matches; mapgen < 95 ms in Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createColony } from '../../js/game/core/state.js';
import { installSim } from '../../js/game/core/setup.js';
import { TER, PLANE, N, D, W, H, idx, setMapSize, allocLayers } from '../../js/game/core/grid.js';
import { generate3, generateWorld3, bandFill, baseMaskOf, heightOf } from '../../js/game/world/mapgen3.js';
import { stoneId, depositId } from '../../js/game/world/defs.js';
import { unsupportedCount, hangHeld, overAir } from '../../js/game/world/support.js';
import { regeneratePristine } from '../../js/game/save/pristine.js';
import { crc32, PRISTINE_LAYERS } from '../../js/game/save/codec.js';
import { lintAll } from '../check-mapgen.mjs';

installSim({ stage: '3' });
const ZS = 14;
const fresh = (seed) => createColony(seed, { d: 20, zS: ZS, terrain: TER.AIR });
const hashL = (L) => PRISTINE_LAYERS.map((k) => crc32(L[k]).toString(16)).join('.');

test('check-mapgen: no inexact Math in the generators', () => {
  const { findings } = lintAll();
  assert.deepEqual(findings, []);
});

test('seeds 1-100: every 2.2 guarantee with <= 4 re-rolls per step; mapgen median < 95 ms', () => {
  const times = [];
  for (let seed = 1; seed <= 100; seed++) {
    const s = fresh(seed), t0 = performance.now(), info = generate3(s);
    times.push(performance.now() - t0);
    assert.deepEqual(info.fails, [], `seed ${seed}`);
    for (const [k, v] of Object.entries(info.rerolls)) assert.ok(v <= 4, `seed ${seed}: ${k} re-rolled ${v} times`);
    for (const c of Object.values(info.below.caverns)) {
      assert.ok(c.open >= 600 && c.parts <= 3, `seed ${seed} ${c.id}: ${c.open} open in ${c.parts} parts`);
      if (c.zl >= 0) assert.ok(c.ramps >= 4 && c.bigRamped === c.bigParts, `seed ${seed} ${c.id}: ramps`);
    }
  }
  times.sort((a, b) => a - b);
  assert.ok(times[50] < 95, `median ${times[50].toFixed(1)} ms`);
});

test('two runs hash equal; the regeneration fallback matches every CRC', () => {
  const a = fresh(7); generate3(a); const ha = hashL(a.L);
  const b = fresh(7); generate3(b); assert.equal(hashL(b.L), ha);
  const c = fresh(7), info = generateWorld3(c), p = info.pristine;
  const r = regeneratePristine({ ...p, pristineId: p.id, pristineCrc: p.crc }, c.seed);
  assert.ok(r, 'regenerated world matches');
});

test('bands, fluids, the Seal, ramps and dormant rows (seed 3)', () => {
  const s = fresh(3), info = generate3(s), L = s.L, M = (n) => stoneId(n);
  const plane = L.terrain.subarray(ZS * PLANE, (ZS + 1) * PLANE), { mask } = baseMaskOf(plane);
  let soil = 0, valley = 0, src = 0, ember = 0, seal = 0, grey = 0;
  for (let c = 0; c < PLANE; c++) {
    if (!(mask[c] & 16)) { valley++; if ([M('loam'), M('clay'), M('sand')].includes(L.mat[(ZS - 1) * PLANE + c])) soil++; }
    if (L.fluid[(ZS - 2) * PLANE + c] & 16) src++;
    if (L.fluid[(ZS - 12) * PLANE + c] & 8) ember++;
    if (L.mat[(ZS - 13) * PLANE + c] === M('sealstone')) seal++;
    if (L.terrain[c] === TER.ROCK && L.mat[c] === M('greystone')) grey++;
  }
  assert.equal(soil, valley, 'topsoil under every valley column');
  assert.ok(src > 500, `aquifer sources ${src}`);
  assert.ok(ember > 10, `ember pool voxels ${ember}`);
  assert.equal(seal, 9, 'a 3 x 3 Seal-stone');
  assert.ok(grey > PLANE - 40, 'the Hollow is greystone');
  // vertical voxels are consistent: every RAMP has its RAMP_TOP and a solid planar neighbour; every top its ramp
  let ramps = 0;
  for (let i = 0; i < N; i++) {
    const t = L.terrain[i];
    if (t === TER.RAMP) {
      ramps++;
      assert.equal(L.terrain[i + PLANE], TER.RAMP_TOP, `ramp ${i}`);
      const x = i % W, y = ((i % PLANE) / W) | 0;
      const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => x + dx >= 0 && y + dy >= 0 && x + dx < W && y + dy < H && L.terrain[i + dy * W + dx] === TER.ROCK);
      assert.ok(nb, `ramp ${i} leans on rock`);
    }
    if (t === TER.RAMP_TOP) assert.equal(L.terrain[i - PLANE], TER.RAMP, `ramp top ${i}`);
  }
  assert.ok(ramps > 100, `ramps ${ramps}`);
  // ore: coal and copper near the start, iron above z 8; deep finds by level
  const has = (name, z0, z1) => { const o = depositId(name); for (let i = z0 * PLANE; i < (z1 + 1) * PLANE; i++) if (L.ore[i] === o) return true; return false; };
  assert.ok(has('iron', 9, D - 1) && has('gold', 0, 6) && has('lumenite', ZS - 11, ZS - 11) && has('heartstone', 0, ZS - 11));
  const kinds = new Set(info.meta.dormant.map((r) => r[0]));
  for (const k of ['passage', 'spring', 'vault', 'seep', 'sleep', 'seal', 'lair', 'lair_gloomwyrm', 'lair_colossus', 'lamplost', 'den_glowbeetle', 'den_gloom_hound', 'husk_barrow', 'forge_site', 'crypt']) assert.ok(kinds.has(k), `dormant ${k}`);
  for (const [k, v, sd] of info.meta.dormant) assert.ok(typeof k === 'string' && Number.isInteger(v) && v >= 0 && v < N && Number.isInteger(sd), `row ${k}`);
  // the Reach starts blighted; the heights rise 1..5 levels
  const zr = ZS - 13;
  let reach = 0, bl = 0;
  for (let c = 0; c < PLANE; c++) { const i = zr * PLANE + c; if (L.terrain[i] !== TER.ROCK) { reach++; if (L.blight[i] === 255) bl++; } }
  assert.equal(bl, reach);
  assert.deepEqual([heightOf(1), heightOf(6), heightOf(7), heightOf(30), heightOf(200)], [1, 1, 2, 5, 5]);
});

test('generateWorld3: Hearth on the surface, nothing unsupported or hanging, start spots', () => {
  for (const seed of [1, 2]) {
    const s = fresh(seed), info = generateWorld3(s);
    const h = s.bld[s.colony.hearth.id];
    assert.equal(h.def, 'hearth'); assert.equal(h.z, ZS);
    assert.equal(unsupportedCount(s), 0);
    let hang = 0;
    for (let i = 0; i < N; i++) if (overAir(s, i) && !hangHeld(s, i)) hang++;
    assert.equal(hang, 0);
    assert.equal(info.spawn.length, 3);
    assert.ok(info.spawn.every((i) => ((i / PLANE) | 0) === ZS));
  }
});

test('bandFill alone (the E9 basic band fill): soil, aquifer and stone bands from a base mask', () => {
  setMapSize(32, 32, 20, ZS);
  const L = allocLayers(), mask = new Uint8Array(32 * 32);
  for (let c = 0; c < 32 * 32; c++) mask[c] = c % 32 < 8 ? 16 | 2 : c % 32 > 28 ? 8 : 0;   // massif west, water east
  bandFill(L, mask, 99);
  const P = 32 * 32, M = (n) => stoneId(n);
  const at = (x, y, z) => z * P + y * 32 + x;
  assert.equal(L.terrain[at(3, 3, 5)], TER.ROCK);
  assert.ok([M('sandstone'), M('limestone')].includes(L.mat[at(3, 3, ZS - 1)]), 'outer stone under the massif');
  assert.equal(L.mat[at(30, 3, ZS - 1)], M('sand'), 'sand under water');
  assert.ok(L.fluid[at(30, 3, ZS - 2)] & 16, 'aquifer under water');
  assert.ok([M('loam'), M('clay')].includes(L.mat[at(15, 3, ZS - 1)]));
  assert.equal(L.mat[at(15, 3, ZS - 12)], M('emberrock'));
  assert.equal(L.mat[at(15, 3, 0)], M('greystone'));
  for (let i = 0; i < ZS * P; i++) assert.equal(L.terrain[i], TER.ROCK);
  const a = L.mat.slice(); bandFill(L, mask, 99); assert.deepEqual(L.mat, a, 'pure');
  setMapSize(128, 128, 20, ZS);
});
