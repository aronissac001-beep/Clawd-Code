// The fortress switch (EMBERCROWN-FORTRESS.md 8.3 E13; 5.3): FORTRESS is on, so a new colony is a 128 x 128 x 20
// hold saved as EC3, and an EC2 colony (one plane, Stage 2) migrates on Continue: saved as EC3 into the older
// slot while the newer keeps the EC2 blob, its pristine world stored, the Chronicle line and the card's depth.
// The browser half is tools/persist.mjs (the four fixtures, a fresh install); here an in-memory IndexedDB.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stateHash } from '../../js/game/core/state.js';
import { step } from '../../js/game/core/sim.js';
import { TICKS_PER_DAY } from '../../js/game/core/time.js';
import { FORTRESS, fortressRequested } from '../../js/game/core/flags.js';
import { blobKind } from '../../js/game/save/codec.js';
import * as slots from '../../js/game/save/slots.js';
import { setIdbFactory, closeDb } from '../../js/game/save/idb.js';
import * as shell from '../../js/main.js';

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

let idb;
beforeEach(async () => {
  await closeDb();
  idb = fakeIdb();
  setIdbFactory(idb);
  let now = 1_700_000_000_000;
  slots.setBackends({ localStorage: fakeStorage(), clock: () => (now += 1000), resetIdb: true });
});

test('the switch is on: a new colony is a 128 x 128 x 20 hold saved as EC3', async () => {
  assert.equal(FORTRESS, true);
  assert.equal(fortressRequested(''), true);
  const s = shell.newColony('E13-NEW', { name: 'Deepwatch' });
  assert.deepEqual([s.w, s.h, s.d, s.zS], [128, 128, 20, 14]);
  await shell.saveNow('test');
  const [slot] = await slots.readSlots(s.id);
  assert.equal(blobKind(slot.bytes), 'EC3');
  const card = slots.listColonies().find((c) => c.id === s.id);
  assert.equal(card.d, 20);
  assert.equal(card.deepest, 0, 'nothing dug below the surface yet');
});

test('an EC2 colony migrates on Continue: EC3 in the older slot, EC2 kept in the newer, then continues identically', async () => {
  const bytes = new Uint8Array(readFileSync(new URL('../fixtures/v2-s2-day60.ecsave', import.meta.url)));
  const id = await slots.importBlob(bytes);
  const s = await shell.continueColony(id);
  assert.deepEqual([s.d, s.zS], [20, 14]);
  assert.ok(s.chron.some((e) => e[2] === 'chron_depth'), 'the Chronicle line');
  assert.equal(shell.app.deepened, id, 'the returning-player card is due');
  const kinds = (await slots.readSlots(id)).map((x) => blobKind(x.bytes));
  assert.deepEqual(kinds, ['EC3', 'EC2'], 'the migrated save is newest; the EC2 blob is kept beside it');
  assert.ok(await slots.readPristineBytes(id), 'the pristine world is stored');
  const h0 = stateHash(s);
  // Continue again: the EC3 slot loads to the same state (no second migration)
  const t = await shell.continueColony(id);
  assert.equal(stateHash(t), h0);
  // play a day, save, reload: identical
  step(t, TICKS_PER_DAY);
  const h1 = stateHash(t);
  await shell.saveNow('test');
  assert.deepEqual((await slots.readSlots(id)).map((x) => blobKind(x.bytes)), ['EC3', 'EC3'], 'the next save replaces the EC2 blob');
  const u = await shell.continueColony(id);
  assert.equal(stateHash(u), h1);
  step(t, 600); step(u, 600);
  assert.equal(stateHash(u), stateHash(t));
});
