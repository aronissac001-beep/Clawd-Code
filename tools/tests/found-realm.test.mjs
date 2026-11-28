// Founding with a region (EMBERCROWN-WORLD.md G2, 3.6, 9.1; step W2.8; owner A). foundColony({ realm, rx, ry, start })
// founds a 128 x 128 x 20 hold in region (rx, ry): its seed is the region's hold seed, mapgen3 reads opts.region (GEN3
// v2) and the state carries s.realm. Founding the same region twice gives identical hashes, and so does a continuation;
// a save and reload continues identically once the save carries `realm` (save/colonysave.js, request in the W2.8 report).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRealm } from '../../js/game/realm/gen.js';
import { idx, isEmbarkable, isSea } from '../../js/game/realm/query.js';
import { regionOpts, holdSeed } from '../../js/game/realm/region.js';
import { recordParts } from '../../js/game/realm/record.js';
import { installSim, foundColony } from '../../js/game/core/setup.js';
import { stateHash, checkState } from '../../js/game/core/state.js';
import { checkRealmField, STATE_VERSION } from '../../js/game/core/schema.js';
import { tick } from '../../js/game/core/sim.js';
import { saveBlob, loadBlob } from '../../js/game/save/colonysave.js';
import { pristineOf } from '../../js/game/save/pristine.js';

const HOUR = 600;
installSim({ stage: '2' });
const realm = buildRealm({ seed: 11 }, { history: false });
/** The first embarkable regions (row order) of a few biomes, at least 3 apart. */
function picks(k) {
  const out = [], seen = new Set();
  for (let ry = 2; ry < realm.n - 2 && out.length < k; ry += 3) for (let rx = 2; rx < realm.n - 2 && out.length < k; rx += 3) {
    const i = idx(realm, rx, ry);
    if (!isEmbarkable(realm, i)) continue;
    const b = regionOpts(realm, rx, ry).biome;
    if (seen.has(b)) continue;
    seen.add(b); out.push([rx, ry]);
  }
  return out;
}
const P = picks(3);
const found = (rx, ry, extra = {}) => foundColony({ seed: 'ignored', name: 'Test Hold', realm, rx, ry, start: null, d: 20, ...extra });
const run = (s, ticks) => { const t = s.tick + ticks; while (s.tick < t && s.colony.fallen !== true) tick(s); return s; };

test('a world with embarkable regions of 3 biomes', () => { assert.equal(P.length, 3, JSON.stringify(P)); });

test('the hold of a region: its hold seed, its region inputs, s.realm valid', () => {
  const [rx, ry] = P[0], s = found(rx, ry);
  assert.equal(s.seed, holdSeed(realm, rx, ry) >>> 0, 'the hold seed (G2), whatever seed was passed');
  assert.equal(s.v, STATE_VERSION);
  assert.deepEqual([s.w, s.h, s.d, s.zS], [128, 128, 20, 14]);
  assert.deepEqual(checkState(s), []);
  assert.deepEqual(checkRealmField(s.realm), []);
  const r = s.realm;
  assert.deepEqual([r.wid, r.seed, r.gv, r.rx, r.ry, r.civ, r.embarkYear, r.year], [realm.wid >>> 0, realm.seed >>> 0, realm.gv, rx, ry, null, 0, 0]);
  assert.deepEqual(r.crc, recordParts(realm).crc, 'the record reference (9.2)');
  assert.deepEqual(r.embark, regionOpts(realm, rx, ry), 'embark is opts.region');
  assert.equal(pristineOf(s).genVersion, 2, 'a GEN3 v2 world');
  assert.ok(JSON.stringify(r).length < 2048, `s.realm is small (${JSON.stringify(r).length} B)`);
  assert.ok(s.col.length > 0 && s.colony.hearth.id !== null, 'a band and a Hearth');
});

test('founding the same region twice gives identical hashes, also after 2 game hours', () => {
  const [rx, ry] = P[1], a = found(rx, ry), b = found(rx, ry);
  assert.equal(stateHash(a), stateHash(b));
  assert.equal(stateHash(run(a, 2 * HOUR)), stateHash(run(b, 2 * HOUR)));
});

test('different regions found different holds; a passed seed or name does not change the world', () => {
  const h = P.map(([rx, ry]) => stateHash(found(rx, ry)));
  assert.equal(new Set(h).size, P.length);
  const [rx, ry] = P[0];
  assert.equal(stateHash(found(rx, ry, { seed: 12345 })), h[0]);
});

test('a sea region or one outside the world is refused', () => {
  let sea = null;
  for (let i = 0; i < realm.n * realm.n && !sea; i++) if (isSea(realm, i)) sea = [i % realm.n, (i / realm.n) | 0];
  assert.throws(() => found(sea[0], sea[1]), /no hold can be founded/);
  assert.throws(() => found(-1, 0), /outside the world/);
});

test('a realm-less hold has no realm field (the legacy hold)', () => {
  const s = foundColony({ seed: 3, d: 20 });
  assert.ok(!('realm' in s) || s.realm === null);
});

test('save and reload of a realm hold continues identically', async (t) => {
  const [rx, ry] = P[2];
  const a = run(found(rx, ry), HOUR);
  const b = await loadBlob(await saveBlob(a));
  if (!b.realm) { t.skip('the save does not carry realm yet: the save/colonysave.js request of W2.8'); return; }
  assert.deepEqual(b.realm, a.realm);
  assert.equal(stateHash(b), stateHash(a), 'reload hashes as saved');
  assert.equal(stateHash(run(b, 2 * HOUR)), stateHash(run(a, 2 * HOUR)), 'and continues identically');
});
