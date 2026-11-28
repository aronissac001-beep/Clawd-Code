// The pristine store and the EC3 fallback order (EMBERCROWN-FORTRESS.md 5.1, 5.2, 5.5; Stage Z1 step E8), on a
// 20-level stub fortress with an in-memory IDBFactory that honours database versions (the v1 -> v2 upgrade).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { stubFortress, digFortress, deepPath } from './fortress-stub.mjs';
import { stateHash } from '../../js/game/core/state.js';
import { saveBlob, saveBlobSync, loadBlob, loadBlobSync, forgetPristine } from '../../js/game/save/colonysave.js';
import * as C from '../../js/game/save/codec.js';
import * as P from '../../js/game/save/pristine.js';
import * as slots from '../../js/game/save/slots.js';
import { setIdbFactory, closeDb, DB_VERSION, STORES, idbGet, idbDelete, idbPut } from '../../js/game/save/idb.js';

// ---- an IDBFactory with versions: open(name, v) upgrades (onupgradeneeded) only when v is above the stored one --
function fakeIdb() {
  const dbs = new Map();   // name -> { version, stores: Map }
  const later = (fn) => setTimeout(fn, 0);
  const req = (fn) => { const r = { onsuccess: null, onerror: null, result: undefined }; later(() => { try { r.result = fn(); r.onsuccess && r.onsuccess(); } catch (e) { r.error = e; r.onerror && r.onerror(); } }); return r; };
  const clone = (v) => (v && v.bytes instanceof Uint8Array ? { ...v, bytes: v.bytes.slice() } : structuredClone(v));
  const makeDb = (d) => ({
    objectStoreNames: { contains: (n) => d.stores.has(n) },
    createObjectStore: (n) => { d.stores.set(n, new Map()); },
    close() {},
    transaction(names) {
      for (const n of [].concat(names)) if (!d.stores.has(n)) throw new Error(`NotFoundError: no store ${n}`);
      const tx = { oncomplete: null, onerror: null, onabort: null, error: null };
      let pending = 0;
      const done = () => later(() => { if (--pending === 0) tx.oncomplete && tx.oncomplete(); });
      tx.objectStore = (n) => {
        const m = d.stores.get(n);
        const op = (fn) => { pending++; const r = req(fn); setTimeout(done, 0); return r; };
        return { get: (k) => op(() => (m.has(k) ? clone(m.get(k)) : undefined)), put: (v, k) => op(() => { m.set(k, clone(v)); }), delete: (k) => op(() => { m.delete(k); }), getAllKeys: () => op(() => [...m.keys()].sort()) };
      };
      return tx;
    },
  });
  return {
    open(name, version = 1) {
      const r = { onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null, result: null };
      later(() => {
        let d = dbs.get(name);
        if (d && version < d.version) { r.error = new Error('VersionError'); r.onerror && r.onerror(); return; }
        const up = !d || version > d.version;
        if (!d) { d = { version, stores: new Map() }; dbs.set(name, d); }
        r.result = makeDb(d);
        if (up) { d.version = version; r.onupgradeneeded && r.onupgradeneeded(); }
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
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, clear: () => m.clear() };
}

let idb, ls;
beforeEach(async () => {
  await closeDb();
  idb = fakeIdb(); ls = fakeStorage();
  setIdbFactory(idb);
  slots.setBackends({ localStorage: ls, clock: () => 1_700_000_000_000, resetIdb: true });
  forgetPristine(); P.setRegenerator(null);
});

/** A founded stub fortress whose record is stored, saved into slot a; returns { s, h, bytes }. */
async function founded(seed = 7) {
  const s = stubFortress(seed); s.id = 'deep' + seed;
  await slots.ensurePristineStored(s);
  digFortress(s); deepPath(s);
  const bytes = await saveBlob(s);
  await slots.writeSlot(s.id, bytes, slots.cardOf(s));
  return { s, h: stateHash(s), bytes };
}

test('the pristine record: round-trips with all 13 CRCs; a damaged byte is refused; size measured', async () => {
  const s = stubFortress(7), p = P.pristineOf(s);
  assert.equal(p.crc.length, 13); assert.equal(p.layers.terrain.length, 128 * 128 * 20);
  const b = await P.encodePristine(p);
  const q = await P.decodePristine(b);
  assert.equal(q.id, p.id); assert.deepEqual(q.crc, p.crc); assert.deepEqual(q.meta, p.meta);
  for (const n of C.PRISTINE_LAYERS) assert.deepEqual(q.layers[n], p.layers[n], n);
  const sync = P.encodePristineSync(p);
  assert.equal(P.decodePristineSync(sync).id, p.id);
  // damage the compressed body, then a stored CRC: both refused
  const bad = b.slice(); bad[b.length - 40] ^= 0x5a;
  await assert.rejects(P.decodePristine(bad), /damaged/);
  const bad2 = sync.slice(); bad2[P.PHEADER_BYTES + 1000] ^= 1;
  assert.throws(() => P.decodePristineSync(bad2), /damaged/);
  const raw = P.encodePristineSync(p, C.COMP.NONE);
  console.log(`# pristine record (stub fortress, 128 x 128 x 20): ${b.length} B deflated, ${sync.length} B RLE, ${raw.length} B raw`);
  assert.ok(P.pristineMatches(q, { pristineId: p.id, w: 128, h: 128, d: 20, zS: 14, pristineCrc: p.crc }));
  assert.ok(!P.pristineMatches(q, { pristineId: p.id, w: 128, h: 128, d: 20, zS: 14, pristineCrc: p.crc.map((c, k) => (k === 4 ? c ^ 1 : c)) }));
});

test('IndexedDB version 2: a version 1 database gains the pristine store and keeps its slots and cards', async () => {
  // a Stage 2.9 database (version 1: slots, meta)
  idb._dbs.set('ec2', { version: 1, stores: new Map([['slots', new Map([['old:a', { bytes: new Uint8Array([1, 2, 3]), tick: 5 }]])], ['meta', new Map([['old', { id: 'old', name: 'Old' }]])]]) });
  assert.ok(DB_VERSION >= 2); assert.deepEqual([...STORES].slice(0, 3), ['slots', 'meta', 'pristine']);
  assert.deepEqual((await idbGet('slots', 'old:a')).bytes, new Uint8Array([1, 2, 3]));
  assert.equal((await idbGet('meta', 'old')).name, 'Old');
  assert.equal(idb._dbs.get('ec2').version, DB_VERSION);
  assert.ok(idb._dbs.get('ec2').stores.has('pristine'));
  await idbPut('pristine', 'old', { bytes: new Uint8Array([9]) });
  assert.deepEqual((await idbGet('pristine', 'old')).bytes, new Uint8Array([9]));
});

test('save and continue through the store: EC3 slot, record stored and read back, load to the same hash', async () => {
  const { s, h, bytes } = await founded();
  assert.equal(C.blobKind(bytes), 'EC3');
  assert.ok(!(C.readHeader3(bytes).header.flags & C.FLAG_PRISTINE), 'slots a and b reference the record, no copy');
  assert.ok(await slots.readPristineBytes(s.id));
  forgetPristine();
  const t = await loadBlob((await slots.readSlot(s.id)).bytes, { pristine: slots.pristineResolver(s.id) });
  assert.equal(stateHash(t), h);
  // without the store and without any copy, the default loader refuses
  forgetPristine();
  await assert.rejects(loadBlob(bytes), new RegExp(P.MISSING_TEXT.slice(0, 30)));
});

test('a deleted pristine record is recovered from the dawn blob (and written back)', async () => {
  const { s, h } = await founded();
  const dawn = await saveBlob(s, undefined, { embed: true });
  assert.ok(C.readHeader3(dawn).header.flags & C.FLAG_PRISTINE);
  await slots.writeDawn(s.id, dawn);
  await idbDelete('pristine', s.id);
  forgetPristine();
  assert.equal(await slots.readPristineBytes(s.id), null);
  const t = await loadBlob((await slots.readSlot(s.id, 'a')).bytes, { pristine: slots.pristineResolver(s.id) });
  assert.equal(stateHash(t), h);
  const back = await slots.readPristineBytes(s.id);
  assert.ok(back, 'the store has the record again');
  assert.equal((await P.decodePristine(back)).id, P.pristineOf(s).id);
  // the dawn blob alone is self-sufficient
  forgetPristine();
  assert.equal(stateHash(await loadBlob(dawn)), h);
  assert.equal(stateHash(loadBlobSync(saveBlobSync(s, C.COMP.RLE, { embed: true }))), h, 'the sync RLE form carries an RLE copy');
});

test('a native world regenerates with matching CRCs; a generator that drifted is refused', async () => {
  const { s, h } = await founded(11);
  await idbDelete('pristine', s.id);
  forgetPristine();
  const slot = (await slots.readSlot(s.id)).bytes;
  let calls = 0;
  P.setRegenerator(({ seed, w, d, zS }) => { calls++; return stubFortress(11, { w, d, zS, seedCheck: seed }); });
  const t = await loadBlob(slot, { pristine: slots.pristineResolver(s.id) });
  assert.equal(calls, 1); assert.equal(stateHash(t), h);
  assert.ok(await slots.readPristineBytes(s.id), 'written back');
  // a generator that changed since founding (other content) does not match: refused, nothing written
  await idbDelete('pristine', s.id);
  forgetPristine();
  P.setRegenerator(() => stubFortress(12));
  await assert.rejects(loadBlob(slot, { pristine: slots.pristineResolver(s.id) }), /world record is missing/);
  assert.equal(await slots.readPristineBytes(s.id), null);
});

test('a corrupted CRC is refused without overwriting anything', async () => {
  const { s } = await founded();
  const slotA = (await slots.readSlot(s.id, 'a')).bytes.slice();
  // the stored record damaged (one bit in a stored CRC): no copy and no generator, so the load is refused
  const rec = (await slots.readPristineBytes(s.id)).slice();
  rec[24] ^= 1;
  await idbPut('pristine', s.id, { bytes: rec, id: 0 });
  forgetPristine();
  await assert.rejects(loadBlob(slotA, { pristine: slots.pristineResolver(s.id) }), /world record is missing/);
  assert.deepEqual(await slots.readPristineBytes(s.id), rec, 'the damaged record is left as it was');
  assert.deepEqual((await slots.readSlot(s.id, 'a')).bytes, slotA, 'the slot is untouched');
  // a blob whose own CRC is damaged is refused at the header, before any store is read
  const bad = slotA.slice(); bad[bad.length - 5] ^= 0x10;
  await assert.rejects(loadBlob(bad, { pristine: slots.pristineResolver(s.id) }), /damaged/);
  await assert.rejects(slots.importBlob(bad), /damaged/);
  // a header that names other CRCs than the record: refused, the record is not replaced from it
  const p = P.pristineOf(s);
  const other = await saveBlob(s, undefined, { pristine: { ...p, crc: p.crc.map((c, k) => (k ? c : c ^ 7)) } });
  await assert.rejects(loadBlob(other, { pristine: slots.pristineResolver(s.id) }), /world record is missing/);
  assert.deepEqual(await slots.readPristineBytes(s.id), rec);
});

test('export embeds the record; import into an empty device stores it and the colony loads', async () => {
  const { s, h } = await founded();
  const ex = await slots.exportBlob(s.id);
  assert.ok(ex.text.startsWith('EC3:'));
  assert.ok(C.readHeader3(ex.bytes).header.flags & C.FLAG_PRISTINE, 'the export is self-sufficient');
  // a new device
  await closeDb(); setIdbFactory(fakeIdb()); slots.setBackends({ localStorage: fakeStorage(), resetIdb: true }); forgetPristine();
  const peek = await slots.peekBlob(ex.text);
  assert.equal(peek.d, 20); assert.equal(peek.pop, 7);
  const id = await slots.importBlob(ex.text);
  assert.ok(await slots.readPristineBytes(id));
  forgetPristine();
  const t = await loadBlob((await slots.readSlot(id)).bytes, { pristine: slots.pristineResolver(id) });
  assert.equal(stateHash(t), h);
  // an EC3 file without its record cannot be imported on a device that lacks it
  await assert.rejects(slots.importBlob(await saveBlob(s)), /no usable world record/);
  // deleting the colony deletes its record
  await slots.deleteColony(id);
  assert.equal(await slots.readPristineBytes(id), null);
});

test('the quick-save embeds the record until the store confirms it; the localStorage fallback keeps one too', async () => {
  const s = stubFortress(5); s.id = 'q5';
  slots.quickSave(s);
  const q = slots.peekQuick();
  assert.ok(C.readHeader3(C.textToBlob(q.text)).header.flags & C.FLAG_PRISTINE, 'not yet stored: embedded');
  await slots.ensurePristineStored(s);
  slots.quickSave(s);
  assert.ok(!(C.readHeader3(C.textToBlob(slots.peekQuick().text)).header.flags & C.FLAG_PRISTINE), 'stored: referenced');
  // no IndexedDB: the record goes to localStorage
  await closeDb(); setIdbFactory(null);
  const l2 = fakeStorage();
  slots.setBackends({ localStorage: l2, resetIdb: true });
  const s2 = stubFortress(6); s2.id = 'ls6';
  await slots.ensurePristineStored(s2);
  assert.ok(l2.getItem(slots.pristineKey('ls6')));
  await slots.writeSlot(s2.id, await saveBlob(s2), slots.cardOf(s2));
  forgetPristine();
  const t = await loadBlob((await slots.readSlot(s2.id)).bytes, { pristine: slots.pristineResolver(s2.id) });
  assert.equal(stateHash(t), stateHash(s2));
});
