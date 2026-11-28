// W3.5 (EMBERCROWN-WORLD.md 2.7 Beasts and Artifacts, 3.6 ruins / relics / lairs): relics and lairs from history.
// Oracle:
//   - a region whose history holds a lost artifact places it in a vault or ruin with its world key (a named item on
//     the floor there and a ['world_relic', voxel, seed, 'wa<id>'] row at the same voxel);
//   - a world beast with a lair in or next to the region gets a surface lair row; the hold's beast carries its world
//     key, its history name (with the identity seed) and its record and deeds (beastHistory, the peek card's read);
//   - razed sites and battlefields of the region are ruins of their kind; the guarantees still pass;
//   - with no region, and with a region whose history lists are empty, the hashes are identical (to W0 and W2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createColony } from '../../js/game/core/state.js';
import { installSim } from '../../js/game/core/setup.js';
import { TER, PLANE, W } from '../../js/game/core/grid.js';
import { generateWorld3 } from '../../js/game/world/mapgen3.js';
import { crc32, PRISTINE_LAYERS } from '../../js/game/save/codec.js';
import { buildRealm } from '../../js/game/realm/gen.js';
import { regionOpts } from '../../js/game/realm/region.js';
import { isEmbarkable, idx } from '../../js/game/realm/query.js';
import { artifactName, eventsOf } from '../../js/data/text/realm.js';
import { holdBeasts, beastHistory } from '../../js/game/threat/beasts/gen.js';

installSim({ stage: '3' });
const fresh = (seed) => createColony(seed, { d: 20, zS: 14, terrain: TER.AIR });
const hashS = (s, info) => PRISTINE_LAYERS.map((k) => crc32(s.L[k]).toString(16)).join('.') + '|' + s.bld.length + '|' + s.items.length + '|'
  + crc32(new TextEncoder().encode(JSON.stringify(info.meta.dormant))).toString(16);
const cheb = (a, x, y) => Math.max(Math.abs(a.x - x), Math.abs(a.y - y));
/** The history lists in the form requested of js/game/realm/region.js (W3.5 request): world keys, sites, names, seeds. */
function richRegion(realm, rx, ry) {
  const o = regionOpts(realm, rx, ry), T = realm.tables;
  o.ruins = T.sites.filter((s) => cheb(s, rx, ry) === 0 && ((s.razed !== null && s.razed !== undefined) || s.kind === 'battlefield'))
    .map((s) => ({ kind: s.kind === 'battlefield' ? 'battlefield' : 'ruin', key: 'ws' + s.id, name: s.name }));
  o.relics = T.artifacts.filter((a) => a.lost && typeof a.x === 'number' && cheb(a, rx, ry) === 0)
    .map((a) => ({ key: 'wa' + a.id, site: a.at, name: artifactName(a), kind: a.kind, mat: a.mat }));
  o.lairs = T.beasts.filter((b) => b.alive !== false && cheb(b, rx, ry) <= 1).map((b) => ({ key: 'wb' + b.id, seed: b.seed >>> 0, dx: b.x - rx, dy: b.y - ry }));
  return o;
}
const realms = new Map();
const realmOf = (seed) => realms.get(seed) || realms.set(seed, buildRealm({ seed }, { history: true })).get(seed);
/** Embarkable regions of a realm: the first with a lost artifact, with a lair, with a battlefield and with a razed site (distinct). */
function pickRegions(realm, n = 4) {
  const want = [(o) => o.relics.length, (o) => o.lairs.length, (o) => o.ruins.some((x) => x.kind === 'battlefield'), (o) => o.ruins.some((x) => x.kind === 'ruin')];
  const out = [], seen = new Set();
  for (const ok of want) {
    for (let i = 0; i < realm.n * realm.n; i++) {
      if (!isEmbarkable(realm, i) || seen.has(i)) continue;
      const rx = i % realm.n, ry = (i - rx) / realm.n, o = richRegion(realm, rx, ry);
      if (ok(o)) { seen.add(i); out.push({ rx, ry, o }); break; }
    }
  }
  return out.slice(0, n);
}
const hold = (o) => { const s = fresh(o.seed); const info = generateWorld3(s, { region: o }); return { s, info }; };
const rowsOf = (info, kind) => info.meta.dormant.filter((r) => r[0] === kind);
const itemAt = (s, v) => s.items.filter((it) => it && ((it.z | 0) * PLANE + it.y * W + it.x) === v);

test('no region, and a region with empty history lists: hashes identical to W0 and W2', () => {
  // W0 (mapgen3-region.test.mjs) for v1; W2 (8775b90, before W3.5) for regions of a history-less realm (seed 7)
  const V1 = { 1: '8d84ba99.e490f356.39a9c379.f6e830b1.4573b056.1be6f48a.4f50c0de|84|12|8d58b0f6', 2: 'f4f7716f.3006c7d7.8c2256f3.8e9b537.70272506.8f03490c.fd6cc1cd|64|9|38b74d61' };
  for (const seed of [1, 2]) { const s = fresh(seed), info = generateWorld3(s); assert.equal(hashS(s, info), V1[seed], `v1 seed ${seed}`); }
  const R2 = { '8,12': '97fa17d6.f498e930.e4ac2450.5658e72e.48f814ec.5961afbd.10c3bc1f|56|9|d9483c46', '41,13': 'ddf81a22.3c5cfb77.4089b649.c4125d52.844692c0.cf0f92d1.1372982b|57|9|689ccaf' };
  const r = buildRealm({ seed: 7 });
  for (const [k, h] of Object.entries(R2)) {
    const [rx, ry] = k.split(',').map(Number), { s, info } = hold(regionOpts(r, rx, ry));
    assert.equal(hashS(s, info), h, `region ${k}`);
    assert.deepEqual(info.region.history, { ruins: [], relics: [], lairs: [] });
  }
});

test('lost artifacts are placed in a vault or ruin with their world keys; lairs and ruins come from history', () => {
  let relics = 0, inRuin = 0, lairs = 0, named = 0, hist = 0, ruins = 0, bf = 0;
  for (const seed of [1, 2, 3]) {
    const realm = realmOf(seed), T = realm.tables;
    for (const { rx, ry, o } of pickRegions(realm)) {
      const { s, info } = hold(o), at = `realm ${seed} region ${rx},${ry}`;
      assert.deepEqual(info.fails, [], at);
      const H = info.region.history, vaults = rowsOf(info, 'vault').map((r) => r[1]);
      // relics: one row and one named item per lost artifact, on a vault or ruin floor
      const rows = rowsOf(info, 'world_relic');
      assert.equal(rows.length, Math.min(8, o.relics.length), `${at} relic rows (at most 8 a region)`);
      for (const rl of o.relics.slice(0, 8)) {
        const row = rows.find((r) => r[3] === rl.key);
        assert.ok(row, `${at} ${rl.key} has a row`);
        const a = T.artifacts[+rl.key.slice(2)];
        assert.ok(a.lost && cheb(a, rx, ry) === 0, `${at} ${rl.key} is lost here`);
        const items = itemAt(s, row[1]);
        assert.ok(items.some((it) => it.name === artifactName(a)), `${at} ${rl.key} item named ${artifactName(a)} at its row`);
        const h = H.relics.find((x) => x.key === rl.key);
        if (h.at === 'vault') assert.ok(vaults.some((v) => { const d = row[1] - v, dy = Math.round(d / W), dx = d - dy * W; return dy >= 1 && dy <= 2 && Math.abs(dx) <= 3; }), `${at} ${rl.key} on a vault floor`);
        else {
          inRuin++;
          const z = (row[1] / PLANE) | 0, c = row[1] - z * PLANE;
          assert.equal(z, 14, `${at} ruin relic on the surface`);
          assert.ok(info.ruins > 0 && s.L.terrain[row[1]] !== TER.ROCK, `${at} ruin floor`);
          void c;
        }
        relics++;
      }
      // lairs: a surface row per living beast in or next to the region; the hold's beast is the history's
      const lr = rowsOf(info, 'world_lair');
      assert.equal(lr.length, Math.min(3, o.lairs.length), `${at} lair rows (at most 3)`);
      s.realm = { wid: realm.wid }; s.rt.realm = realm;
      const bs = holdBeasts(s);
      for (const l of o.lairs.slice(0, 3)) {
        const row = lr.find((r) => r[3] === l.key), rb = T.beasts[+l.key.slice(2)];
        assert.ok(row && ((row[1] / PLANE) | 0) === 14, `${at} ${l.key} surface lair`);
        const b = bs.find((x) => x.wkey === l.key);
        assert.ok(b, `${at} ${l.key} is a hold beast`);
        assert.equal(b.name, rb.name, `${at} ${l.key} name from history`);
        named++;
        const bh = beastHistory(s, b);
        assert.ok(bh && bh.kills === rb.kills && bh.wounds === rb.wounds && bh.born === rb.born, `${at} ${l.key} history`);
        assert.ok(bh.lines.length === Math.min(3, eventsOf(realm, l.key).length) && bh.lines.every((t) => typeof t === 'string' && t.length > 0 && t.length <= 160 && !/[{}]/.test(t)), `${at} ${l.key} deed lines ${JSON.stringify(bh.lines)}`);
        hist += bh.lines.length;
        lairs++;
      }
      // ruins: the history ruins follow the biome's own, each with its site key
      assert.deepEqual(H.ruins, o.ruins.slice(0, H.ruins.length).map((x) => x.key), `${at} ruin keys`);
      ruins += H.ruins.length;
      if (o.ruins.some((x) => x.kind === 'battlefield')) bf += s.bld.filter((b) => b && b.name === 'Grave cairn').length ? 1 : 0;
      // determinism: the same region gives the same hold
      const again = hold(o);
      assert.equal(hashS(again.s, again.info), hashS(s, info), `${at} deterministic`);
    }
  }
  console.log(`relics ${relics} (in ruins ${inRuin}), lairs ${lairs} (named ${named}, ${hist} deed lines), history ruins ${ruins}, battlefields ${bf}`);
  assert.ok(relics >= 3 && lairs >= 2 && ruins >= 4 && bf >= 1, 'the fixtures cover relics, lairs, ruins and battlefields');
});

test("the region's history lists as region.js gives them today (bare ids) still get world keys", () => {
  const realm = realmOf(2), [{ rx, ry }] = pickRegions(realm, 1), o = regionOpts(realm, rx, ry);
  const { s, info } = hold(o);
  assert.deepEqual(info.fails, []);
  for (const r of rowsOf(info, 'world_relic')) assert.match(r[3], /^wa\d+$/);
  for (const r of rowsOf(info, 'world_lair')) assert.match(r[3], /^wb\d+$/);
  assert.equal(rowsOf(info, 'world_relic').length, Math.min(8, o.relics.length));
  s.realm = { wid: realm.wid }; s.rt.realm = realm;
  for (const b of holdBeasts(s).filter((x) => x.wkey)) assert.ok(beastHistory(s, b), `${b.wkey} history`);
  // no realm record (or another world's): no history, never a throw
  s.rt.realm = null;
  for (const b of holdBeasts(s)) assert.equal(beastHistory(s, b), null);
});
