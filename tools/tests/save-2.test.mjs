// Workstream A, Stage 2 (doc 14.8 row A): the migrations framework with its v1 fixture, settings,
// Ironhold (one slot, no backups), the 8-colony list and Settings > Storage (classic keys). The browser
// half (real IndexedDB with 8 colonies at bot day 60) is scratch/colony/2/AG/persist-8.mjs (report).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createColony, stateHash, checkState, migrate, migrations, raidLive } from '../../js/game/core/state.js';
import { STATE_VERSION, DIFFICULTIES } from '../../js/game/core/schema.js';
import { installSim, foundColony } from '../../js/game/core/setup.js';
import { step } from '../../js/game/core/sim.js';
import { saveBlob, loadBlob } from '../../js/game/save/colonysave.js';
import { readHeader } from '../../js/game/save/codec.js';
import * as slots from '../../js/game/save/slots.js';
import { setIdbFactory, closeDb } from '../../js/game/save/idb.js';
import { normalizeSettings, checkSettingsPatch, defaultSettings, settingsAttrs, SETTINGS } from '../../js/game/save/settings.js';
import * as shell from '../../js/main.js';

const FIX = new URL('../fixtures/', import.meta.url);
const fixture = () => new Uint8Array(readFileSync(new URL('v1-1b-midraid.ecsave', FIX)));
const meta = JSON.parse(readFileSync(new URL('v1-1b-midraid.json', FIX), 'utf8'));

// ---- a minimal IDBFactory: databases of object stores, async requests, transactions that complete --------
function fakeIdb() {
  const dbs = new Map();
  const later = (fn) => setTimeout(fn, 0);
  const req = (fn) => { const r = { onsuccess: null, onerror: null, result: undefined }; later(() => { try { r.result = fn(); r.onsuccess && r.onsuccess(); } catch (e) { r.error = e; r.onerror && r.onerror(); } }); return r; };
  const clone = (v) => (v && v.bytes instanceof Uint8Array ? { ...v, bytes: v.bytes.slice() } : structuredClone(v));
  function makeDb(name) {
    const stores = dbs.get(name);
    return {
      objectStoreNames: { contains: (n) => stores.has(n) },
      createObjectStore: (n) => { stores.set(n, new Map()); },
      close() {},
      transaction(names) {
        const tx = { oncomplete: null, onerror: null, onabort: null, error: null };
        let pending = 0;
        const done = () => later(() => { if (--pending === 0) tx.oncomplete && tx.oncomplete(); });
        const store = (n) => {
          const m = stores.get(n);
          const op = (fn) => { pending++; const r = req(fn); const s0 = r; setTimeout(done, 0); return s0; };
          return { get: (k) => op(() => (m.has(k) ? clone(m.get(k)) : undefined)), put: (v, k) => op(() => { m.set(k, clone(v)); }), delete: (k) => op(() => { m.delete(k); }), getAllKeys: () => op(() => [...m.keys()].sort()) };
        };
        tx.objectStore = store;
        void names;
        return tx;
      },
    };
  }
  return {
    open(name) {
      const r = { onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null, result: null };
      later(() => {
        const isNew = !dbs.has(name);
        if (isNew) dbs.set(name, new Map());
        r.result = makeDb(name);
        if (isNew && r.onupgradeneeded) r.onupgradeneeded();
        r.onsuccess && r.onsuccess();
      });
      return r;
    },
    deleteDatabase(name) { const r = { onsuccess: null }; later(() => { dbs.delete(name); r.onsuccess && r.onsuccess(); }); return r; },
    _dbs: dbs,
  };
}
function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, clear: () => m.clear(),
  };
}

let idb, ls, clock;
beforeEach(async () => {
  await closeDb();
  idb = fakeIdb(); ls = fakeStorage(); clock = 1_700_000_000_000;
  setIdbFactory(idb);
  slots.setBackends({ localStorage: ls, clock: () => clock, resetIdb: true });
});

test('the v1 fixture is a real Stage 1b save (stateVersion 1, mid-raid, non-empty)', () => {
  const b = fixture();
  assert.ok(b.length > 4000, `fixture is ${b.length} bytes`);
  const { header } = readHeader(b);
  assert.equal(header.stateVersion, 1); assert.equal(header.formatVersion, 2); assert.equal(header.tick, meta.tick);
  assert.ok(STATE_VERSION >= 2 && migrations.length === STATE_VERSION - 1, 'one migration per version step');
});

test('the v1 fixture loads through the migrations: valid, mid-raid, difficulty renamed, and it continues deterministically', async () => {
  installSim({ stage: '1b' });
  const s = await loadBlob(fixture());
  assert.deepEqual(checkState(s), []);
  assert.equal(s.v, STATE_VERSION);
  assert.equal(s.tick, meta.tick);
  assert.deepEqual(s.col.map((c) => c.name), meta.colonists);
  assert.equal(s.items.filter(Boolean).length, meta.items);
  assert.equal(s.bld.filter(Boolean).length, meta.buildings);
  assert.equal(s.foes.length, meta.foes);
  assert.ok(raidLive(s), 'the raid is still live');
  assert.equal(s.colony.difficulty, 'steadfast'); assert.equal(s.colony.iron, false); assert.equal(s.colony.tierSince, -1);
  // continue: 600 ticks, then a save and load mid-continuation runs on identically to the uninterrupted copy
  step(s, 600);
  const bytes = await saveBlob(s);
  assert.equal(readHeader(bytes).header.stateVersion, STATE_VERSION, 're-saved at the current version');
  const t = await loadBlob(bytes);
  assert.equal(stateHash(t), stateHash(s));
  step(s, 600); step(t, 600);
  assert.equal(stateHash(t), stateHash(s));
  assert.deepEqual(checkState(s), []);
});

test('migrate(): v1 difficulty ids to the 9.1 ids; Ironhold implies iron; newer or broken versions refuse', () => {
  const ent = (c) => ({ meta: { v: 1 }, colony: c });
  assert.equal(migrate(ent({ difficulty: 'standard', iron: false }), 1).colony.difficulty, 'steadfast');
  assert.equal(migrate(ent({ difficulty: 'nightmare' }), 1).colony.difficulty, 'steadfast');
  const w = migrate(ent({ difficulty: 'warden', iron: false }), 1).colony;
  assert.deepEqual([w.difficulty, w.iron, w.tierSince, w.storytellerDay], ['warden', false, -1, -1]);
  assert.deepEqual([migrate(ent({ difficulty: 'ironhold' }), 1).colony.iron, migrate(ent({ difficulty: 'standard', iron: true }), 1).colony.difficulty], [true, 'ironhold']);
  assert.throws(() => migrate(ent({}), STATE_VERSION + 1), /newer version/);
  assert.throws(() => migrate(ent({}), 0), /no valid state version/);
  assert.equal(migrate(ent({ difficulty: 'warden' }), STATE_VERSION).colony.difficulty, 'warden', 'current saves pass through');
  for (const d of DIFFICULTIES) assert.equal(migrate(ent({ difficulty: d }), 1).colony.difficulty, d);
});

test('a v1 blob that claims a newer state version is refused with a clear message', async () => {
  const b = fixture().slice();
  new DataView(b.buffer).setUint16(6, STATE_VERSION + 1, true);
  await assert.rejects(() => loadBlob(b), /newer version/);
});

test('settings: defaults, normalisation, a patch keeps only valid keys, attributes for the page', () => {
  const d = defaultSettings();
  for (const k of Object.keys(SETTINGS)) assert.equal(d[k], SETTINGS[k].def, k);
  assert.equal(d.twoFingerPause, false, 'two-finger pause is off by default (10.2)');
  const n = normalizeSettings({ textSize: '130', reduceMotion: 'yes', junk: 1, leftHanded: true });
  assert.deepEqual([n.textSize, n.reduceMotion, n.leftHanded, 'junk' in n], [130, false, true, false]);
  const p = checkSettingsPatch({ textSize: 140, batterySaver: true, nope: 2 });
  assert.deepEqual(p.ok, { batterySaver: true });
  assert.deepEqual(p.rejected.map((r) => r[0]).sort(), ['nope', 'textSize']);
  // through slots (localStorage)
  slots.writeSettings({ textSize: 115, volume: 101, autoPauseImminent: true });
  const r = slots.readSettings();
  assert.deepEqual([r.textSize, r.volume, r.autoPauseImminent], [115, 80, true]);
  ls.setItem(slots.KEY_SETTINGS, '{broken');
  assert.deepEqual(slots.readSettings(), defaultSettings());
  assert.equal(settingsAttrs({ textSize: 130, leftHanded: true })['data-ec-text'], '130');
  assert.equal(settingsAttrs({ leftHanded: true })['data-ec-hand'], 'left');
});

test('Ironhold: founded with difficulty ironhold; one slot, rewritten in place; no dawn backup and no Load backup', async () => {
  installSim({ stage: '1a' });
  const s = foundColony({ seed: 'IRON-1', name: 'Ironhold Test', difficulty: 'ironhold', w: 64 });
  assert.deepEqual([s.colony.difficulty, s.colony.iron], ['ironhold', true]);
  assert.throws(() => foundColony({ seed: 'x', difficulty: 'impossible', w: 32 }), /unknown difficulty/);
  const w1 = await slots.writeSlot(s.id, await saveBlob(s), slots.cardOf(s));
  step(s, 30);
  const w2 = await slots.writeSlot(s.id, await saveBlob(s), slots.cardOf(s));
  assert.deepEqual([w1.which, w2.which], ['a', 'a']);
  assert.equal((await slots.readSlots(s.id)).length, 1);
  assert.equal(slots.isIron(s.id), true);
  assert.equal(slots.listColonies()[0].iron, true);
  assert.equal(await slots.writeDawn(s.id, await saveBlob(s)), null);
  assert.equal(await slots.readDawn(s.id), null);
  await assert.rejects(() => shell.loadBackup(s.id), /no backups/);
  const back = await loadBlob((await slots.readSlot(s.id)).bytes);
  assert.equal(stateHash(back), stateHash(s));
  // a Steadfast colony still rotates a and b
  const t = foundColony({ seed: 'IRON-2', w: 64 });
  const a = await slots.writeSlot(t.id, await saveBlob(t), slots.cardOf(t)), b = await slots.writeSlot(t.id, await saveBlob(t), slots.cardOf(t));
  assert.deepEqual([a.which, b.which, t.colony.difficulty], ['a', 'b', 'steadfast']);
});

test('the colony list holds 8: a ninth new colony or import is refused with a reason; deleting one makes room', async () => {
  const ids = [];
  for (let k = 0; k < 8; k++) {
    const s = createColony(`EIGHT-${k}`, { w: 32, name: `Hold ${k + 1}` });
    await slots.writeSlot(s.id, await saveBlob(s), slots.cardOf(s));
    ids.push(s.id);
    clock += 1000;
  }
  assert.equal(slots.listColonies().length, 8);
  assert.match(slots.colonyRoom(), /8 colonies/);
  assert.match(shell.colonyRoom(), /8 colonies/);
  const ninth = createColony('EIGHT-9', { w: 32 }), nb = await saveBlob(ninth);
  await assert.rejects(() => slots.writeSlot(ninth.id, nb, slots.cardOf(ninth)), /8 colonies/);
  await assert.rejects(() => slots.importBlob(nb), /8 colonies/);
  assert.throws(() => shell.newColony('EIGHT-10'), /8 colonies/);
  // a known colony still saves at the cap
  const again = await loadBlob((await slots.readSlot(ids[3])).bytes); again.id = ids[3];
  assert.ok((await slots.writeSlot(ids[3], await saveBlob(again), slots.cardOf(again))).which);
  await slots.deleteColony(ids[0]);
  assert.equal(slots.colonyRoom(), null);
  assert.ok(await slots.importBlob(nb));
  assert.equal(slots.listColonies().length, 8);
  // the index stays small (11.2: < 4 KB for 8 cards)
  assert.ok(slots.storageBytes().index < 4096, `index ${slots.storageBytes().index} chars`);
});

test('Settings > Storage: classic saves are listed, exported, and cleared only after an export of the same contents', () => {
  ls.setItem('embercrown.run', JSON.stringify({ wave: 7 })); ls.setItem('embercrown.meta', '{"embers":12}'); ls.setItem('ec2.settings', '{}');
  const c = slots.classicSaves();
  assert.deepEqual(c.keys.map((k) => k.key), ['embercrown.meta', 'embercrown.run']);
  assert.ok(c.chars > 20);
  assert.throws(() => slots.clearClassic('nope'), /Export the classic saves first/);
  const ex = slots.exportClassic();
  assert.deepEqual(JSON.parse(ex.text).keys['embercrown.run'], JSON.stringify({ wave: 7 }));
  ls.setItem('embercrown.run', JSON.stringify({ wave: 8 }));   // the classic game ran again meanwhile
  assert.throws(() => slots.clearClassic(ex.token), /changed/);
  const ex2 = slots.exportClassic();
  assert.deepEqual(slots.clearClassic(ex2.token), { removed: 2 });
  assert.equal(ls.getItem('embercrown.run'), null);
  assert.equal(ls.getItem('ec2.settings'), '{}', 'the colony game keys are untouched');
  assert.equal(slots.classicSaves().keys.length, 0);
});
