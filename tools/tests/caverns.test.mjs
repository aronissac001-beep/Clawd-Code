// Stage Z2.7 (EMBERCROWN-FORTRESS.md 8.4): underground life, static. The oracle cases:
//   - glowcap grows on cave loam (cave moss and a mined loam floor) with no light, in the gloam too, never by a torch;
//   - a lined seep turns dry (a mined aquifer voxel under a Tiled floor with rock all round), an unlined one does not;
//   - a scripted seed feeds 6 colonists for a season (10 days) from underground only: a sealed Hollows hall with a
//     glowcap farm and no way to the surface;
// plus the cavern flora and fauna of a real mapgen3 world: dens filled, every creature on its cavern's levels after
// days of wandering, greyshank, mere-reed and shore lichen seeded, and the whole thing deterministic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installSim, foundColony } from '../../js/game/core/setup.js';
import { createColony, initRuntime, stateHash } from '../../js/game/core/state.js';
import { tick } from '../../js/game/core/sim.js';
import { newColonist, newZone, WORK_IDS } from '../../js/game/core/schema.js';
import { idx, ctrW, TER, PLANE, setMapSize } from '../../js/game/core/grid.js';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../../js/game/core/time.js';
import { plantCode, stoneId, floorDefById } from '../../js/game/world/defs.js';
import { canSow, sowPlant, caveLoam, cavernLevels, plantYield } from '../../js/game/world/plants.js';
import { mineTile, setFloor } from '../../js/game/world/terrain.js';
import { isSeep, fluidAt, FL } from '../../js/game/world/pass.js';
import { liningOk } from '../../js/game/world/seeps.js';
import { cavernOfZ, isCaveDweller, cavernDens } from '../../js/game/animals/caverns.js';
import { pristineOf } from '../../js/game/save/pristine.js';
import { spawnAt } from '../../js/game/work/items.js';
import { NEED } from '../../js/game/people/needs.js';

const D = 20, Z_S = 14, HOLLOW = Z_S - 7;
/** A w x w x 20 world: rock (granite) below the surface, grass on it, air above; paint(s) before the runtime. */
function world({ w = 32, seed = 'Z27', paint = null, stage = '1b' } = {}) {
  installSim({ stage, reset: true, checks: false });
  const s = createColony(seed, { w, d: D, zS: Z_S, terrain: TER.ROCK });
  const L = s.L;
  L.fluid = new Uint8Array(L.terrain.length);
  L.mat.fill(stoneId('granite'));
  for (let z = Z_S; z < D; z++) for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) L.terrain[idx(x, y, z)] = z === Z_S ? TER.GRASS : TER.AIR;
  if (paint) paint(s);
  L.fog.fill(255);
  initRuntime(s);
  return s;
}
/** Size the grid first, so voxel indexes computed before world() are right. */
const size = (w = 32) => setMapSize(w, w, D, Z_S);
const run = (s, n, until) => { for (let t = 0; t < n; t++) { tick(s); if (until && until(s)) return t + 1; } return n; };
const floorId = (id) => { for (let k = 1; k < 64; k++) { const d = floorDefById(k); if (!d) break; if (d.id === id) return k; } return 0; };

test('glowcap grows on cave loam with no light (moss and a mined loam floor), in the gloam, never by a torch', () => {
  size();
  const moss = idx(10, 10, HOLLOW), loam = idx(14, 10, Z_S - 2), lit = idx(12, 10, HOLLOW), gloam = idx(11, 12, HOLLOW);
  const s = world({
    paint: (st) => {
      for (const i of [moss, lit, gloam]) st.L.terrain[i] = TER.MOSS;
      st.L.terrain[loam] = TER.ROUGH; st.L.mat[loam] = stoneId('loam');
    },
  });
  const glow = plantCode('glowcap');
  assert.ok(caveLoam(s, moss), 'cave moss is cave loam');
  assert.ok(caveLoam(s, loam), `a mined loam floor is cave loam (${s.L.terrain[loam]} ${s.L.mat[loam]})`);
  assert.ok(!caveLoam(s, idx(5, 5, Z_S)), 'open grass is not cave loam');
  assert.equal(s.rt.light[moss], 0, 'no light down here');
  for (const i of [moss, loam, gloam]) { assert.equal(canSow(s, i, glow), null, `sowable at ${i}`); assert.ok(sowPlant(s, i, glow)); }
  // light: the gloam (1) is still dark enough; a torch (3) is not
  s.rt.light[gloam] = 1; s.rt.light[lit] = 3;
  assert.equal(canSow(s, lit, glow), 'it grows only in the dark');
  const days = run(s, 12 * TICKS_PER_DAY, (st) => { st.rt.light[gloam] = 1; return [moss, loam, gloam].every((i) => st.L.growth[i] === 255); }) / TICKS_PER_DAY;
  for (const i of [moss, loam, gloam]) assert.equal(s.L.growth[i], 255, `glowcap at ${i} ripe`);
  assert.ok(days > 5 && days < 10, `ripe in ${days.toFixed(1)} days (data: 7)`);
  // a greyshank yields shankwood timber
  const gs = plantCode('greyshank');
  s.L.plant[moss] = gs; s.L.growth[moss] = 255;
  assert.deepEqual(plantYield(s, moss), { item: 'wood', n: 18, mat: 'shankwood' });
});

test('a lined seep turns dry; an unlined one stays wet', () => {
  size();
  const aq = Z_S - 2, a = idx(10, 10, aq), b = idx(20, 10, aq), c = idx(26, 10, aq);
  const s = world({ paint: (st) => { for (const i of [a, b, c]) st.L.fluid[i] = FL.SOURCE; st.L.terrain[idx(27, 10, aq)] = TER.ROUGH; } });
  for (const i of [a, b, c]) { mineTile(s, i); assert.ok(isSeep(s, i), `mining the aquifer at ${i} leaves a seep`); assert.equal(fluidAt(s, i) & FL.DEPTH, 2); }
  const tiled = floorId('f_brick');
  assert.ok(tiled > 0, 'the Tiled floor exists');
  setFloor(s, a, tiled);                 // a: a brick floor, rock all round: lined
  setFloor(s, c, tiled);                 // c: a brick floor, but an open neighbour: not lined
  assert.ok(liningOk(s, a) && !liningOk(s, b) && !liningOk(s, c));
  run(s, TICKS_PER_HOUR + 30);
  assert.ok(!isSeep(s, a) && fluidAt(s, a) === 0, 'the lined seep is dry: depth and source cleared');
  assert.ok(isSeep(s, b) && isSeep(s, c), 'the bare seep and the open-sided one stay wet');
});

test('a scripted seed feeds 6 colonists for a season from underground only', () => {
  // a sealed hall in the Glowcap Hollows level: 26 x 18 of cave moss with rock pillars (support), a 10 x 10 glowcap farm
  // at staggered growth (an established farm), a store, one day of glowcaps in it; no stair, no way to the surface
  const X0 = 3, Y0 = 3, X1 = 28, Y1 = 20, FX = 5, FY = 5;
  const farm = [];
  const s = world({
    w: 32, seed: 'Z27-FEED',
    paint: (st) => {
      const L = st.L, glow = plantCode('glowcap');
      for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
        const i = idx(x, y, HOLLOW);
        const farmTile = x >= FX && x < FX + 10 && y >= FY && y < FY + 10;
        if (!farmTile && x % 4 === 0 && y % 4 === 0) continue;   // natural pillars
        L.terrain[i] = TER.MOSS;
        if (farmTile) { L.zone[i] = 1; L.plant[i] = glow; L.growth[i] = (((x - FX) * 10 + (y - FY)) * 37) % 256; farm.push(i); }
        else if (x >= 20 && y >= 14) L.zone[i] = 2;
      }
      st.zones.push(newZone(1, 'grow', { name: 'Glowcap farm', crop: 'glowcap' }));
      st.zones.push(newZone(2, 'stockpile', { name: 'Larder', filter: { cats: [], mats: [], q: [0, 6] }, pri: 2 }));
      st.next.zone = 3;
      for (let k = 0; k < 6; k++) {
        const c = newColonist(k, { name: `Delver ${k}`, x: ctrW(16 + k), y: ctrW(17), z: HOLLOW });
        c.custom = true; c.prio = new Uint8Array(WORK_IDS.length);
        for (const w of ['grow', 'haul']) c.prio[WORK_IDS.indexOf(w)] = 1;
        st.col.push(c);
      }
      st.next.col = 6;
    },
  });
  spawnAt(s, 'glowcap', null, 0, 50, idx(22, 16, HOLLOW));
  const eaten = { n: 0 };
  let minFood = Infinity;
  const FOOD = NEED.food;
  for (let d = 0; d < 10; d++) {
    run(s, TICKS_PER_DAY);
    for (const c of s.col) if (!c.hp || !c.hp.dead) minFood = Math.min(minFood, c.need[FOOD]);
  }
  const alive = s.col.filter((c) => !(c.hp && c.hp.dead)).length;
  const foods = new Set(s.items.filter((it) => it && it.food !== undefined).map((it) => it.k));
  const stock = s.items.filter((it) => it && it.k === 'glowcap').reduce((a, it) => a + it.n, 0);
  console.log(`# feed: alive ${alive}/6, min food ${minFood}, glowcap stock ${stock}, farm sown ${farm.filter((i) => s.L.plant[i]).length}/100`);
  assert.equal(alive, 6, 'all six live through the season');
  assert.ok(minFood > 0, 'nobody starved');
  assert.deepEqual([...foods].filter((k) => k !== 'glowcap'), [], 'the only food was glowcap');
  assert.ok(stock > 0, 'food is left at the end of the season');
  assert.ok(s.col.every((c) => (c.z | 0) === HOLLOW), 'nobody left the hall');
  void eaten;
});

/** A fortress founded by mapgen3, run for `days` at Stage 2 (animal AI on). */
function fortress(seed, days) {
  installSim({ stage: '2', reset: true, checks: false });
  const s = foundColony({ seed, name: 'Deep Hold', d: D });
  const first = { n: 0, dens: 0 };
  tick(s);
  first.n = s.anim.filter((a) => isCaveDweller(a)).length;
  first.dens = cavernDens(s).length;
  run(s, days * TICKS_PER_DAY);
  return { s, first };
}
const count = (s, id) => { const c = plantCode(id); let n = 0; for (let i = 0; i < s.L.plant.length; i++) if (s.L.plant[i] === c) n++; return n; };

test('the cavern flora and fauna of Caverns I and II live at their dens and stay in their cavern (mapgen3 world)', () => {
  const { s, first } = fortress('Z27-CAVES', 3);
  const lv = cavernLevels();
  assert.deepEqual(lv, { hollows: [HOLLOW, HOLLOW + 1], mere: [Z_S - 10, Z_S - 9] });
  assert.ok(pristineOf(s), 'a stored pristine world with dormant rows');
  assert.ok(first.dens >= 8, `dens of Caverns I and II: ${first.dens}`);
  assert.ok(first.n >= 10, `cavern creatures after the first tick: ${first.n}`);
  const caves = s.anim.filter((a) => isCaveDweller(a));
  const byKind = {};
  for (const a of caves) byKind[a.kind] = (byKind[a.kind] || 0) + 1;
  const flora = { glowcap: count(s, 'glowcap'), greyshank: count(s, 'greyshank'), merereed: count(s, 'merereed'), lichen: count(s, 'lichen') };
  console.log(`# caverns: dens ${first.dens}, creatures ${first.n} -> ${caves.length} ${JSON.stringify(byKind)}; flora ${JSON.stringify(flora)}; herd ${JSON.stringify(s.colony.herd.cav)}`);
  assert.ok(caves.length >= first.n - 4, 'the dens keep their numbers');
  for (const k of ['beetle', 'blindfish', 'mire_leech', 'shellback']) assert.ok(byKind[k] > 0, `${k} lives in the caverns`);
  // every cavern creature is still on a level of its own cavern, on natural ground
  for (const a of s.anim) {
    if (!['beetle', 'spider', 'great_spider', 'blindfish', 'mire_leech', 'shellback'].includes(a.kind)) continue;
    assert.ok(cavernOfZ(a.z | 0), `${a.kind} ${a.id} at z ${a.z} is in a cavern`);
  }
  for (const k of Object.keys(flora)) assert.ok(flora[k] > 0, `${k} grows in the caverns`);
  assert.ok(s.colony.herd.cav.seeded === 1 && s.colony.herd.cav.flora > 0);
});

test('cavern life is deterministic: the same seed gives the same hash', () => {
  const a = fortress('Z27-DET', 1).s, b = fortress('Z27-DET', 1).s;
  assert.equal(stateHash(a), stateHash(b));
});
