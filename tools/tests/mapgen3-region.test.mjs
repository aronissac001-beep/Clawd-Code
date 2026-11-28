// W2.3 (EMBERCROWN-WORLD.md 3.6, 3.7; GEN3 v2): region inputs to mapgen3. Oracle:
//   - with no opts.region, seeds 1-5 give world hashes identical to W0 (the v1 path, genVersion 1);
//   - 12 biomes x 20 seeds (real regions of Standard realms 1-8) pass checkGuarantees;
//   - each biome's knob values of 1.3 measured within +-20 % (a 1-point floor for knobs under 5 %);
//   - a river region's water enters on river.in and leaves on river.out (every in/out pair, every class);
//   - previewSurface equals the surface of generate3 at plane zS, tile by tile.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createColony } from '../../js/game/core/state.js';
import { installSim } from '../../js/game/core/setup.js';
import { TER, PLANE, N, idx } from '../../js/game/core/grid.js';
import { generate3, generateWorld3, previewSurface, PREVIEW_KEYS, regenerate3 } from '../../js/game/world/mapgen3.js';
import { stoneId, plantCode } from '../../js/game/world/defs.js';
import { unsupportedCount, hangHeld, overAir } from '../../js/game/world/support.js';
import { crc32, PRISTINE_LAYERS } from '../../js/game/save/codec.js';
import { GEN3 } from '../../js/data/worldgen.js';
import { REALM_BIOMES } from '../../js/data/realm/biomes.js';
import { buildRealm } from '../../js/game/realm/gen.js';
import { regionOpts, regionFacts, holdSeed } from '../../js/game/realm/region.js';

installSim({ stage: '3' });
const ZS = 14, W = 128;
const fresh = (seed) => createColony(seed, { d: 20, zS: ZS, terrain: TER.AIR });
const hashL = (L) => PRISTINE_LAYERS.map((k) => crc32(L[k]).toString(16)).join('.');
// W0 (aa82fa1; mapgen3 and its tables unchanged from there to W2.2): the 7 pristine layer CRCs of generateWorld3, seeds 1-5
const W0 = {
  1: '8d84ba99.e490f356.39a9c379.f6e830b1.4573b056.1be6f48a.4f50c0de',
  2: 'f4f7716f.3006c7d7.8c2256f3.8e9b537.70272506.8f03490c.fd6cc1cd',
  3: '28120678.58b49984.8320ed34.aed015ea.1f8ff837.800e039d.1119396f',
  4: 'aa67e886.1cf991.ee536f7.4bc2977f.8298508d.7f489e95.3d50f0a2',
  5: '46a6f7c9.2d32d1ca.26bc4e87.922bdc0a.97b750a2.c3a4799b.c68fcfa6',
};
const BIOMES = REALM_BIOMES.filter((b) => b.embark).map((b) => b.id);

test('no opts.region: seeds 1-5 hash as W0 and stamp genVersion 1', () => {
  for (let seed = 1; seed <= 5; seed++) {
    const s = fresh(seed), info = generateWorld3(s);
    assert.equal(hashL(s.L), W0[seed], `seed ${seed}`);
    assert.equal(info.pristine.genVersion, GEN3.legacyVersion);
    assert.equal(info.region, undefined);
  }
});

// 20 regions of every biome from Standard realms 1-8 (river regions first, then spread over the rest)
const realms = [];
const picks = Object.fromEntries(BIOMES.map((b) => [b, []]));
{
  const all = Object.fromEntries(BIOMES.map((b) => [b, [[], []]]));
  for (let ws = 1; ws <= 8; ws++) {
    const realm = buildRealm({ seed: ws });
    realms.push(realm);
    for (let i = 0; i < realm.n * realm.n; i++) {
      if (!(realm.fields.flow[i] & 0x80)) continue;
      const id = REALM_BIOMES[realm.fields.biome[i]].id, riv = (realm.fields.flow[i] >> 3) & 3;
      all[id][riv ? 0 : 1].push([ws - 1, i % realm.n, (i / realm.n) | 0]);
    }
  }
  for (const b of BIOMES) {
    const [rv, rest] = all[b], take = (list, k) => { const out = []; for (let j = 0; j < k && list.length; j++) out.push(list[Math.floor((j * list.length) / k)]); return out; };
    const r1 = take(rv, Math.min(8, rv.length));
    picks[b] = r1.concat(take(rest, 20 - r1.length));
  }
}
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const near = (got, want, what) => {
  const tol = Math.max(Math.abs(want) * 0.2, Math.abs(want) < 5 ? 1 : 0);
  assert.ok(Math.abs(got - want) <= tol, `${what}: measured ${got.toFixed(2)}, knob ${want} (+-${tol.toFixed(2)})`);
};

/** Surface and soil measurements of one generated region world. */
function measure(s, info, r) {
  const L = s.L, bS = ZS * PLANE, b1 = (ZS - 1) * PLANE, b2 = (ZS - 2) * PLANE, M = (n) => stoneId(n);
  const oak = plantCode('oak'), pine = plantCode('pine');
  let open = 0, trees = 0, oaks = 0, meadow = 0, land = 0, blight = 0, valley = 0, clay = 0, loam = 0, sand = 0, aq = 0, water = 0;
  for (let c = 0; c < PLANE; c++) {
    const t = L.terrain[bS + c], p = L.plant[bS + c];
    if (t === TER.GRASS || t === TER.MEADOW || t === TER.DIRT || t === TER.RICH) { open++; if (p === oak || p === pine) trees++; }
    if (p === oak) oaks++;
    if (t === TER.MEADOW) meadow++;
    const wet = t === TER.DEEP || t === TER.SHALLOW || t === TER.ICE || t === TER.MARSH;
    if (wet) water++;
    if (t !== TER.ROCK && !wet && t !== TER.AIR) { land++; if (L.blight[bS + c]) blight++; }
    if (!(info.baseMask[c] & 16) && !(info.baseMask[c] & 8)) {
      valley++;
      const m = L.mat[b1 + c];
      if (L.terrain[b1 + c] === TER.ROCK) { if (m === M('clay')) clay++; else if (m === M('loam')) loam++; else if (m === M('sand')) sand++; }
      if (L.fluid[b2 + c] & 16) aq++;
    }
  }
  return {
    forest: ((trees / open - 0.018) / 0.532) * 100, oaks, meadow: (meadow * 100) / (open + 1), blight: (blight * 100) / land,
    clay: (clay * 100) / (clay + loam), sand: (sand * 100) / valley, aquifer: water ? (aq * 100) / valley : null,
  };
}

test('12 biomes x 20 seeds: checkGuarantees, knob values of 1.3 within 20 %, river edges, support', () => {
  const t0 = performance.now();
  let rivers = 0, worlds = 0;
  for (const b of BIOMES) {
    const B = GEN3.biomes[b], acc = {}, want = {};
    const add = (k, v, kn) => { if (v === null || v !== v) return; (acc[k] || (acc[k] = [])).push(v); (want[k] || (want[k] = [])).push(kn); };
    assert.equal(picks[b].length, 20, `${b}: 20 regions`);
    for (const [k, [ri, rx, ry]] of picks[b].entries()) {
      const r = regionOpts(realms[ri], rx, ry);
      assert.equal(r.biome, b);
      const s = fresh(r.seed), info = generate3(s, { region: r });
      worlds++;
      assert.deepEqual(info.fails, [], `${b} region ${rx},${ry} of realm ${ri + 1}`);
      for (const [kk, v] of Object.entries(info.rerolls)) assert.ok(v <= 4, `${b}: ${kk} re-rolled ${v}`);
      assert.equal(info.genVersion, GEN3.version);
      const m = measure(s, info, r), g = info.region;
      const mid = (p) => (p ? (p[0] + p[1]) / 2 : null);
      add('forest %', m.forest, B.forestPct !== undefined ? B.forestPct : 20); add('meadow %', m.meadow, B.meadowPct !== undefined ? B.meadowPct : 14);
      add('blight %', m.blight, r.blight); add('top clay %', m.clay, r.soil.clay); if (r.soil.sand) add('top sand %', m.sand, r.soil.sand);
      add('aquifer %', m.aquifer, r.aquiferPct); add('massif %', (g.massifTiles * 100) / PLANE, r.massifPct);
      add('ruins', info.ruins, B.ruins !== undefined ? B.ruins : 3); add('ember pools', info.below.ember, mid(r.ember.pools));
      add('lakes', g.lakes, (B.lakes !== undefined ? B.lakes : 1) + (r.lake ? 1 : 0));
      for (const kk of ['hills', 'rocks', 'ravines']) if (B[kk]) add(kk, kk === 'hills' ? info.hills : g[kk], mid(B[kk]));
      if (B.pines) assert.equal(m.oaks, 0, `${b}: pines only`);
      if (r.ember.rel === -11) assert.equal(s.L.mat[idx(5, 5, ZS - 11)], stoneId('emberrock'), `${b}: shallow ember layer`);
      // the 1.3 knob rows fold into opts.region where 1.3 names them
      if (B.aquiferPct !== undefined) assert.equal(r.aquiferPct, B.aquiferPct);
      if (B.topClayPct !== undefined) assert.equal(r.soil.clay, B.topClayPct);
      if (B.massifPct) assert.ok(r.massifPct >= B.massifPct[0] && r.massifPct <= B.massifPct[1]);
      if (B.ember) assert.deepEqual(r.ember, B.ember);
      // the sea band of a shore lies along its edge
      if (g.sea) {
        let wet = 0;
        for (let t = 0; t < W; t++) { const [x, y] = g.sea.side === 'n' ? [t, 0] : g.sea.side === 's' ? [t, W - 1] : g.sea.side === 'w' ? [0, t] : [W - 1, t]; const tt = s.L.terrain[idx(x, y, ZS)]; if (tt === TER.DEEP || tt === TER.SHALLOW || tt === TER.ROCK) wet++; }
        assert.ok(wet >= W - 2, `${b}: sea along ${g.sea.side} (${wet})`);
      }
      if (r.river) {
        rivers++;
        assert.ok(g.riverEdges.includes(r.river.in) && g.riverEdges.includes(r.river.out), `${b} ${rx},${ry}: river ${r.river.in}->${r.river.out} touches ${g.riverEdges}`);
        for (const e of g.riverEdges) assert.ok([r.river.in, r.river.out, r.sea].includes(e), `${b}: river on a third edge ${e}`);
      }
      if (k === 0) {   // a whole world: the Hearth, nothing unsupported or hanging
        const w = fresh(r.seed); generateWorld3(w, { region: r });
        assert.equal(unsupportedCount(w), 0, `${b}: unsupported`);
        let hang = 0;
        for (let i = 0; i < N; i++) if (overAir(w, i) && !hangHeld(w, i)) hang++;
        assert.equal(hang, 0, `${b}: hanging`);
      }
    }
    // measured knob values (means over the 20 worlds) against the knob (1.3 row, or the opts.region value it set)
    const row = [];
    for (const k of Object.keys(acc)) {
      if ((k === 'forest %' && B.forestPct === undefined && b !== 'greenvale') || (k === 'meadow %' && B.meadowPct === undefined && b !== 'greenvale')) continue;
      const got = mean(acc[k]), kn = mean(want[k]);
      row.push(`${k} ${got.toFixed(1)}/${kn.toFixed(1)}`);
      near(got, kn, `${b} ${k}`);
    }
    console.log(`# ${b}: ${row.join(', ')}`);
  }
  assert.ok(rivers >= 40, `${rivers} river regions`);
  console.log(`# ${worlds} region worlds, ${rivers} with a river, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
});

test('river.in -> river.out for every ordered edge pair and class, around the massif', () => {
  const [ri, rx, ry] = picks.greenvale[1];
  const base = regionOpts(realms[ri], rx, ry), S = ['n', 'e', 's', 'w'];
  for (const side of S) for (const a of S) for (const bb of S) {
    if (a === bb) continue;
    const cls = 1 + ((S.indexOf(a) + S.indexOf(bb) + S.indexOf(side)) % 3);
    const r = { ...base, side, sea: null, river: { in: a, out: bb, cls } };
    const s = fresh(base.seed), info = generate3(s, { region: r });
    assert.deepEqual(info.fails, [], `massif ${side} river ${a}->${bb}`);
    assert.equal(info.region.side, side);
    assert.deepEqual(info.region.riverEdges, [a, bb].sort(), `massif ${side} river ${a}->${bb} class ${cls}`);
  }
});

test('previewSurface equals generate3 at plane zS, tile by tile (v1 and every biome)', () => {
  const cases = [[3, {}], [4, {}]].concat(BIOMES.map((b) => { const [ri, rx, ry] = picks[b][2]; const r = regionOpts(realms[ri], rx, ry); return [r.seed, { region: r }]; }));
  for (const [seed, opts] of cases) {
    const pv = previewSurface(seed, opts), s = fresh(seed);
    generate3(s, opts);
    const L = s.L, bS = ZS * PLANE;
    for (const k of ['terrain', 'plant', 'growth', 'blight']) {
      let diff = -1;
      for (let c = 0; c < PLANE && diff < 0; c++) if (pv[k][c] !== L[k][bS + c]) diff = c;
      assert.equal(diff, -1, `${opts.region ? opts.region.biome : 'v1'} seed ${seed}: ${k} differs at ${diff}`);
    }
    assert.equal(pv.colour.length, PLANE);
    assert.ok(pv.colour.every((v) => v < PREVIEW_KEYS.length));
  }
});

test('region worlds: deterministic, regenerate with their region, refuse without it; facts and hold seed', () => {
  const [ri, rx, ry] = picks.moor[3], realm = realms[ri], r = regionOpts(realm, rx, ry);
  assert.deepEqual(regionOpts(realm, rx, ry), r);
  assert.equal(r.seed, holdSeed(realm, rx, ry));
  const a = fresh(r.seed); generate3(a, { region: r });
  const b = fresh(r.seed); generate3(b, { region: JSON.parse(JSON.stringify(r)) });
  assert.equal(hashL(b.L), hashL(a.L));
  const g = regenerate3({ seed: r.seed, w: 128, h: 128, d: 20, zS: ZS, genVersion: 2, region: r });
  assert.equal(hashL(g.L), hashL(a.L));
  assert.throws(() => regenerate3({ seed: r.seed, w: 128, h: 128, d: 20, zS: ZS, genVersion: 2 }));
  const f = regionFacts(realm, rx, ry);
  assert.equal(f.biome, 'moor'); assert.equal(f.seed, r.seed); assert.ok(f.embark);
});
