// Realm fields (EMBERCROWN-WORLD.md W2.1; 1.1-1.5): priority-flood against a brute-force fill, rivers, guarantees,
// determinism, streams and the read API. The 200-seed sweep, the timing and the browser hash are tools/check-realm.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashString } from '../../js/game/core/rand.js';
import { REALM_GEN, SIZES } from '../../js/data/realm/params.js';
import { REALM_BIOMES, BIOME_INDEX } from '../../js/data/realm/biomes.js';
import { createRealm, buildRealm, realmHash, checkRealm, normalizeParams, LAYERS, PHASES, realmStats } from '../../js/game/realm/gen.js';
import { stream, isqrt } from '../../js/game/realm/fields.js';
import { priorityFlood, riverFaults, FLOW } from '../../js/game/realm/rivers.js';
import { classify, BAND } from '../../js/game/realm/biomes.js';
import * as Q from '../../js/game/realm/query.js';

const mul = (seed) => { let t = seed >>> 0; return () => { t = (t + 0x6d2b79f5) >>> 0; let r = Math.imul(t ^ (t >>> 15), t | 1); r ^= r + Math.imul(r ^ (r >>> 7), r | 61); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; };

/** Brute-force depression fill (Planchon-Darboux style relaxation to the minimax path level). */
function bruteFill(elev, w, h, outlet) {
  const N = w * h, W = new Array(N);
  for (let i = 0; i < N; i++) W[i] = outlet[i] ? elev[i] : Infinity;
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i < N; i++) {
      if (outlet[i]) continue;
      const x = i % w, y = (i - x) / w;
      let m = Infinity;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        if (W[yy * w + xx] < m) m = W[yy * w + xx];
      }
      const v = Math.max(elev[i], m);
      if (v < W[i]) { W[i] = v; changed = true; }
    }
  }
  return W;
}

test('priority-flood equals a brute-force depression fill on 200 random 16 x 16 grids', () => {
  const R = mul(4242);
  for (let g = 0; g < 200; g++) {
    const w = 16, h = 16, N = w * h, elev = new Uint8Array(N), outlet = new Uint8Array(N);
    const range = g % 3 === 0 ? 8 : 256;   // some grids with many ties
    for (let i = 0; i < N; i++) elev[i] = Math.floor(R() * range);
    for (let i = 0; i < N; i++) {
      const x = i % w, y = (i - x) / w;
      outlet[i] = g % 2 ? (x === 0 || y === 0 || x === w - 1 || y === h - 1 ? 1 : 0) : (R() < 0.04 ? 1 : 0);
    }
    if (!outlet.some(Boolean)) outlet[0] = 1;
    const { level, order, count } = priorityFlood(elev, w, h, outlet);
    const want = bruteFill(elev, w, h, outlet);
    assert.equal(count, N, `grid ${g}: every cell flooded`);
    for (let i = 0; i < N; i++) assert.equal(level[i], want[i], `grid ${g} cell ${i}`);
    for (let k = 1; k < count; k++) assert.ok(level[order[k]] >= level[order[k - 1]], `grid ${g}: flood order is by level`);
  }
});

test('isqrt is the integer square root', () => {
  for (let v = 0; v < 5000; v++) { const r = isqrt(v); assert.ok(r * r <= v && (r + 1) * (r + 1) > v, String(v)); }
});

test('streams and hash32 follow 1.2 and G2', () => {
  assert.equal(stream('elev', 7), hashString('realm:elev:7:' + REALM_GEN.version));
  assert.equal(stream('elev', 7, 2), hashString('realm:elev:7:' + REALM_GEN.version + ':2'));
  assert.equal(Q.hash32(12, 3, 4, 'hold'), hashString('12:3:4:hold'));
});

test('params are normalized with the 1.5 defaults', () => {
  const p = normalizeParams({ seed: 'Ashmark', size: 'huge', sea: 2, name: '  x'.padEnd(40, 'y') });
  assert.equal(p.size, 'standard'); assert.equal(p.sea, 2); assert.equal(p.history, 250); assert.equal(p.peoples, 'normal');
  assert.equal(p.seed, hashString('Ashmark')); assert.equal(p.name.length, 24);
  assert.ok(normalizeParams({ seed: 5 }).name.length > 0);
});

test('fields: layers, sizes, phases, determinism and climate shape', () => {
  for (const size of ['small', 'standard', 'large']) {
    const it = createRealm({ seed: 11, size }), phases = [];
    let s;
    while (!(s = it.next()).done) phases.push(s.value.phase);
    assert.deepEqual(phases.slice(0, PHASES.length), PHASES);
    const r = s.value, n = SIZES[size];
    assert.equal(r.n, n);
    for (const k of LAYERS) assert.equal(r.fields[k].length, n * n, k);
    assert.equal(r.fields.site.BYTES_PER_ELEMENT, 2);
    assert.equal(realmHash(r), realmHash(buildRealm({ seed: 11, size })), 'same seed, same realm');
    assert.equal(r.wid, Q.hash32(r.seed, r.gv, n));
    // north is colder than south, on average over the sea-level row means
    let north = 0, south = 0;
    for (let x = 0; x < n; x++) { north += r.fields.temp[x]; south += r.fields.temp[(n - 1) * n + x]; }
    assert.ok(north < south, `${size}: north ${north} < south ${south}`);
    // the border of each sea side is mostly sea
    for (const sd of r.sides) {
      let sea = 0;
      for (let k = 0; k < n; k++) { const x = sd === 'w' ? 0 : sd === 'e' ? n - 1 : k, y = sd === 'n' ? 0 : sd === 's' ? n - 1 : k; if (Q.isSea(r, y * n + x)) sea++; }
      assert.ok(sea > n * 0.8, `${size} side ${sd}: ${sea}/${n} sea`);
    }
    const st = realmStats(r), land = st.land / (n * n);
    assert.ok(land > 0.5 && land < 0.8, `land share ${land}`);
  }
  assert.notEqual(realmHash(buildRealm({ seed: 1 })), realmHash(buildRealm({ seed: 2 })));
});

test('rivers run downhill and end in the sea or a lake; 20 seeds pass the guarantees', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const r = buildRealm({ seed }), f = r.fields, n = r.n;
    assert.deepEqual(riverFaults(f, n, r.seaLevel), [], `seed ${seed}`);
    assert.deepEqual(checkRealm(r), [], `seed ${seed}`);
    assert.equal(r.warnings.length, 0);
    // walk every river to its end: no loops, never rising, ending in sea or lake
    let rivers = 0;
    for (let i = 0; i < n * n; i++) {
      if (!Q.riverClass(r, i)) continue;
      rivers++;
      let c = i, steps = 0;
      while (Q.riverClass(r, c)) {
        const d = Q.downOf(r, c);
        assert.ok(f.elev[d] <= f.elev[c], `seed ${seed}: rises at ${c}`);
        c = d;
        assert.ok(++steps < n * n, `seed ${seed}: river loops`);
      }
      assert.ok(Q.isSea(r, c) || Q.isLake(r, c), `seed ${seed}: river from ${i} ends on land`);
    }
    assert.ok(rivers > 20, `seed ${seed}: ${rivers} river regions`);
    // embarkable means land, not a peak, not a small island
    for (let i = 0; i < n * n; i++) if (Q.isEmbarkable(r, i)) { assert.ok(!Q.isSea(r, i)); assert.notEqual(Q.band(r, i), BAND.PEAK); assert.ok(REALM_BIOMES[f.biome[i]].embark); }
  }
});

test('classification follows the 1.3 order', () => {
  const B = BIOME_INDEX;
  assert.equal(classify(BAND.LOW, 10, 100, 120, 0, 200, 0), B.ruins);
  assert.equal(classify(BAND.LOW, 10, 50, 120, 200, 0, 0), B.ashlands);
  assert.equal(classify(BAND.LOW, 10, 100, 120, 0, 0, FLOW.COAST), B.shore);
  assert.equal(classify(BAND.UP, -10, 100, 120, 0, 0, 0), B.tundra);
  assert.equal(classify(BAND.HIGH, 5, 100, 120, 0, 0, 0), B.highcrag);
  assert.equal(classify(BAND.LOW, 10, 200, 40, 0, 0, 0), B.fen);
  assert.equal(classify(BAND.LOW, 10, 120, 120, 0, 0, 0), B.greenvale);
  assert.equal(classify(BAND.LOW, 10, 200, 120, 0, 0, 0), B.elderwood);
  assert.equal(classify(BAND.UP, 0, 60, 120, 0, 0, 0), B.moor);
  assert.equal(classify(BAND.LOW, 0, 120, 120, 0, 0, 0), B.taiga);
  assert.equal(classify(BAND.LOW, 25, 20, 120, 0, 0, 0), B.saltflat);
  assert.equal(classify(BAND.UP, 18, 60, 120, 0, 0, 0), B.redscar);
  assert.equal(classify(BAND.PEAK, 10, 100, 120, 0, 0, 0), B.peak);
  assert.equal(REALM_BIOMES.filter((b) => b.embark).length, 12);
});

test('query: travel days, start fit and empty history tables', () => {
  const r = buildRealm({ seed: 3 }, { history: false }), n = r.n;
  const land = [];
  for (let i = 0; i < n * n; i++) if (Q.isEmbarkable(r, i) && Q.band(r, i) === BAND.LOW) land.push(i);
  const a = land[0], b = land[1];
  assert.equal(Q.travelDays(r, a % n, (a - (a % n)) / n, a % n, (a - (a % n)) / n), 0);
  const d = Q.travelDays(r, a % n, (a - (a % n)) / n, b % n, (b - (b % n)) / n);
  assert.ok(d > 0 && d < Infinity);
  assert.equal(Q.civOf(r, 1, 1), null); assert.equal(Q.siteOf(r, 1, 1), null); assert.deepEqual(Q.neighbours(r, 5, 5), []);
  assert.deepEqual(Q.standing({ stand: [[3, 40, 1]] }, 3), { civ: 3, goodwill: 40, flags: 1 });
  assert.equal(Q.standing(null, 3), null);
  let fits = 0;
  for (let i = 0; i < n * n; i++) if (Q.startFits(r, i, 'tarn_shore')) { fits++; assert.ok(Q.riverClass(r, i) || Q.isLake(r, i) || Q.isCoast(r, i)); }
  assert.ok(fits > 0);
});
