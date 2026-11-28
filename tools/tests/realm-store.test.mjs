// The realm record and store (EMBERCROWN-WORLD.md 9.2, step W2.2): the record round-trips byte-identical, the
// IndexedDB v2 -> v3 upgrade adds the `realm` store, dawn backups and exports embed the record (EC3 flags bit 1),
// the fallback order store -> embedded -> dawn -> regeneration (all 3 CRCs), and a missing record never refuses
// a hold. A 20-level stub fortress stands in for the hold; the in-memory IDBFactory honours versions.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { stubFortress, digFortress } from './fortress-stub.mjs';
import { stateHash } from '../../js/game/core/state.js';
import { saveBlob, loadBlob, snapshot, forgetPristine } from '../../js/game/save/colonysave.js';
import * as C from '../../js/game/save/codec.js';
import * as slots from '../../js/game/save/slots.js';
import * as RS from '../../js/game/save/realmstore.js';
import * as R from '../../js/game/realm/record.js';
import { buildRealm, realmHash } from '../../js/game/realm/gen.js';
import { setIdbFactory, closeDb, DB_VERSION, STORES, idbGet, idbPut, idbKeys } from '../../js/game/save/idb.js';
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

const REALMS = new Map();
const realmOf = (seed, size = 'standard') => { const k = seed + ':' + size; if (!REALMS.has(k)) REALMS.set(k, buildRealm({ seed, size })); return REALMS.get(k); };

let idb, ls;
const device = async () => {
  await closeDb(); idb = fakeIdb(); ls = fakeStorage(); setIdbFactory(idb);
  slots.setBackends({ localStorage: ls, clock: () => 1_700_000_000_000, resetIdb: true });
  forgetPristine(); RS.setRealmRegenerator(null);
};
beforeEach(device);

/** A deep hold in world `realm` at (rx, ry): record stored, pristine stored, slot a written; returns { s, h, ref, rec }. */
async function holdInWorld(realm, id = 'w1', rx = 20, ry = 30) {
  const { bytes: rec, crc } = await RS.writeRealm(realm);
  const s = stubFortress(7); s.id = id;
  s.realm = { v: 1, wid: realm.wid, rx, ry, crc, params: realm.params };
  await slots.ensurePristineStored(s);
  digFortress(s);
  await slots.writeSlot(s.id, await saveBlob(s), slots.cardOf(s));
  return { s, h: stateHash(s), ref: { wid: realm.wid, crc, params: realm.params }, rec };
}

test('the record round-trips byte-identical at every size (deflate and RLE); sizes measured for 9.2', async () => {
  for (const size of ['small', 'standard', 'large']) {
    const r = realmOf(1, size), b = await R.encodeRecord(r), d = await R.decodeRecord(b);
    assert.equal(realmHash(d), realmHash(r), size);
    assert.deepEqual(await R.encodeRecord(d), b, `${size}: re-encoding the decoded realm gives the same bytes`);
    const sync = R.encodeRecordSync(r);
    assert.equal(realmHash(R.decodeRecordSync(sync)), realmHash(r));
    assert.deepEqual(R.encodeRecordSync(R.decodeRecordSync(sync)), sync);
    const h = R.readRecordHeader(b);
    assert.equal(h.wid, r.wid); assert.equal(h.size, r.n); assert.equal(h.genVersion, r.gv); assert.deepEqual(h.crc, R.recordParts(r).crc);
    const z = await R.recordSizes(r);
    assert.equal(z.fields, 15 * r.n * r.n);
    if (size === 'standard') assert.ok(z.record < 60_000, `standard record ${z.record} B`);
    console.log(`# realm record ${size} (${r.n}^2, seed 1, no history yet): fields ${z.fields} B, tables ${z.tables} B, events ${z.events} B raw; ${z.record} B deflated, ${sync.length} B RLE`);
  }
  // the store gives back the same bytes
  const r = realmOf(1), w = await RS.writeRealm(r);
  assert.deepEqual(await RS.readRealmBytes(r.wid), w.bytes);
  // a damaged byte anywhere in the body is refused
  const bad = w.bytes.slice(); bad[bad.length - 30] ^= 0x41;
  await assert.rejects(R.decodeRecord(bad), /damaged/);
  const bad2 = R.encodeRecordSync(r); bad2[R.REC_HEADER_BYTES + 5000] ^= 1;
  assert.throws(() => R.decodeRecordSync(bad2), /damaged/);
});

test('IndexedDB version 3: a version 2 database gains the realm store and keeps slots, cards and pristine records', async () => {
  idb._dbs.set('ec2', { version: 2, stores: new Map([['slots', new Map([['old:a', { bytes: new Uint8Array([1, 2]), tick: 5 }]])], ['meta', new Map([['old', { id: 'old', name: 'Old' }]])], ['pristine', new Map([['old', { bytes: new Uint8Array([7]) }]])]]) });
  assert.equal(DB_VERSION, 3); assert.deepEqual([...STORES], ['slots', 'meta', 'pristine', 'realm']);
  assert.deepEqual((await idbGet('slots', 'old:a')).bytes, new Uint8Array([1, 2]));
  assert.equal((await idbGet('meta', 'old')).name, 'Old');
  assert.deepEqual((await idbGet('pristine', 'old')).bytes, new Uint8Array([7]));
  assert.equal(idb._dbs.get('ec2').version, 3);
  assert.ok(idb._dbs.get('ec2').stores.has('realm'));
});

test('EC3 flags bit 1: the realm block after the pristine block; readers find it with or without the flag', async () => {
  const s = stubFortress(7); s.id = 'c1';
  const rec = await R.encodeRecord(realmOf(1));
  for (const embed of [false, true]) {
    const { header, payload } = snapshot(s, { embed });
    const sec = C.unframePayload3(payload, embed);
    const body = C.framePayload3(sec.pristine, C.LAYERS3.map((l) => ({ id: l.id, ...sec.layers[l.name] })), sec.entities, sec.runtimeBytes, rec);
    const blob = await C.encodeBlob({ ...header, flags: header.flags | C.FLAG_REALM }, body);
    const out = C.unframePayload3((await C.decodeAny(blob)).payload, embed);   // the flag left out: found by magic
    assert.deepEqual(out.realm, rec); assert.equal(out.entities, sec.entities);
    assert.deepEqual(C.unframePayload3((await C.decodeAny(blob)).payload, embed, true).realm, rec);
    assert.equal(C.unframePayload3(payload, embed).realm, null, 'no block, none found');
    // colonysave (which passes only the pristine flag) still loads it to the same hash
    const t = await loadBlob(blob, embed ? {} : { pristine: (await import('../../js/game/save/pristine.js')).pristineOf(s) });
    assert.equal(stateHash(t), stateHash(s));
    assert.deepEqual(await RS.embeddedRealmOf(blob), rec);
  }
});

test('the dawn backup embeds the record; a deleted store record is recovered from the dawn blob and rewritten', async () => {
  const realm = realmOf(1), { s, ref, rec } = await holdInWorld(realm);
  assert.equal(slots.listColonies()[0].wid, realm.wid, 'the card carries the world id');
  const d = await slots.writeDawn(s.id, await saveBlob(s, undefined, { embed: true }));
  const dawn = await slots.readDawn(s.id);
  assert.ok(C.readHeader3(dawn.bytes).header.flags & C.FLAG_REALM); assert.ok(C.readHeader3(dawn.bytes).header.flags & C.FLAG_PRISTINE);
  assert.equal(d.size, dawn.bytes.length);
  assert.deepEqual(await RS.embeddedRealmOf(dawn.bytes), rec);
  // the store loses the record
  await closeDb(); idb._dbs.get('ec2').stores.get('realm').clear(); slots.setBackends({ resetIdb: true });
  assert.equal(await RS.readRealmBytes(realm.wid), null);
  const got = await RS.realmResolver(s.id)({ ref: { wid: ref.wid, crc: ref.crc } });
  assert.equal(got.from, 'dawn'); assert.equal(realmHash(got.realm), realmHash(realm));
  assert.deepEqual(await RS.readRealmBytes(realm.wid), rec, 'the store is rewritten from the dawn copy');
  assert.equal((await RS.resolveRealm({ ref, colonyId: s.id })).from, 'store');
});

test('a corrupted CRC goes down the fallback order: store -> embedded -> dawn -> regeneration -> missing', async () => {
  const realm = realmOf(1), { s, ref, rec } = await holdInWorld(realm);
  await slots.writeDawn(s.id, await saveBlob(s, undefined, { embed: true }));
  const corruptStore = async () => { const v = await idbGet('realm', realm.wid); const b = v.bytes.slice(); b[17] ^= 0xff; await idbPut('realm', realm.wid, { ...v, bytes: b }); slots.setBackends({ resetIdb: true }); };
  // 1. the store's crc field is damaged: the blob's own embedded copy wins
  await corruptStore();
  let got = await RS.resolveRealm({ ref, colonyId: s.id, embedded: rec });
  assert.equal(got.from, 'embedded'); assert.deepEqual(await RS.readRealmBytes(realm.wid), rec);
  // 2. damaged again, no embedded copy: the dawn blob's
  await corruptStore();
  got = await RS.resolveRealm({ ref, colonyId: s.id });
  assert.equal(got.from, 'dawn');
  // 3. damaged, no dawn copy: regeneration with the current generator, accepted as all 3 CRCs match
  await corruptStore();
  let calls = 0;
  RS.setRealmRegenerator((p) => { calls++; return buildRealm(p); });
  got = await RS.resolveRealm({ ref, colonyId: 'no-such-hold' });
  assert.equal(got.from, 'regen'); assert.equal(calls, 1); assert.equal(realmHash(got.realm), realmHash(realm));
  assert.deepEqual(await RS.readRealmBytes(realm.wid), rec, 'regeneration rebuilds the same record');
  // 4. a generator that changed (one region differs): refused, and with nothing else the record is missing
  await corruptStore();
  RS.setRealmRegenerator((p) => { const r = buildRealm(p); r.fields.taint[5] ^= 1; return r; });
  got = await RS.resolveRealm({ ref, colonyId: 'no-such-hold' });
  assert.equal(got.realm, null); assert.equal(got.from, 'missing'); assert.match(got.text, /world record is missing/);
  // 5. a reference whose CRCs differ from every copy is never served the wrong record
  RS.setRealmRegenerator(null);
  got = await RS.resolveRealm({ ref: { ...ref, crc: [1, 2, 3] }, colonyId: s.id, embedded: rec });
  assert.equal(got.realm, null);
});

test('a missing record still loads the hold (9.2): the resolver says so and the slot loads to its hash', async () => {
  const realm = realmOf(1), { s, h, ref } = await holdInWorld(realm);
  await RS.deleteRealm(realm.wid, { force: true });
  const got = await RS.resolveRealm({ ref: { wid: ref.wid, crc: ref.crc }, colonyId: s.id });
  assert.equal(got.realm, null); assert.equal(got.text, RS.REALM_TEXT.missing);
  const t = await loadBlob((await slots.readSlot(s.id)).bytes, { pristine: slots.pristineResolver(s.id) });
  assert.equal(stateHash(t), h);
  // the dawn backup and the export are still written, without a record
  await slots.writeDawn(s.id, await saveBlob(s, undefined, { embed: true }));
  assert.ok(!(C.readHeader3((await slots.readDawn(s.id)).bytes).header.flags & C.FLAG_REALM));
  const ex = await slots.exportBlob(s.id);
  assert.ok(!(C.readHeader3(ex.bytes).header.flags & C.FLAG_REALM));
});

test('export embeds the record; import on a fresh device restores the store byte-identical', async () => {
  const realm = realmOf(1), { s, h, rec } = await holdInWorld(realm);
  const ex = await slots.exportBlob(s.id);
  const f = C.readHeader3(ex.bytes).header.flags;
  assert.ok(f & C.FLAG_PRISTINE && f & C.FLAG_REALM);
  await device();
  const id = await slots.importBlob(ex.text);
  assert.deepEqual(await RS.readRealmBytes(realm.wid), rec);
  const t = await loadBlob((await slots.readSlot(id)).bytes, { pristine: slots.pristineResolver(id) });
  assert.equal(stateHash(t), h);
  // export again from the imported slot: the record rides along once (not twice)
  const ex2 = await slots.exportBlob(id);
  assert.deepEqual(await RS.embeddedRealmOf(ex2.bytes), rec);
});

test('world index: rows in meta are never listed as colonies; delete is refused while holds use the world; rebuild', async () => {
  const realm = realmOf(1), { s } = await holdInWorld(realm, 'w1', 20, 30);
  await RS.noteHold(realm.wid, s.id, 20, 30, { name: realm.params.name, size: realm.n, year: 0 });
  assert.ok((await idbKeys('meta')).includes(RS.worldKey(realm.wid)));
  const cards = await slots.refreshColonies();
  assert.deepEqual(cards.map((c) => c.id), ['w1']);
  assert.deepEqual((await RS.listWorlds()).map((w) => [w.wid, w.name, w.holds]), [[realm.wid, realm.params.name, [['w1', 20, 30]]]]);
  const no = await RS.deleteRealm(realm.wid);
  assert.equal(no.deleted, false); assert.deepEqual(no.holds, ['w1']); assert.ok(await RS.readRealmBytes(realm.wid));
  // the row is lost: rebuilt from the cards
  await closeDb(); idb._dbs.get('ec2').stores.get('meta').delete(RS.worldKey(realm.wid)); slots.setBackends({ resetIdb: true });
  assert.equal(await RS.readWorld(realm.wid), null);
  const rows = await RS.rebuildWorldIndex();
  assert.deepEqual(rows.map((w) => [w.wid, w.name, w.size, w.holds]), [[realm.wid, realm.params.name, realm.n, [['w1', 20, 30]]]]);
  // deleting the hold takes it out of the row; then the world can be deleted
  await slots.deleteColony('w1');
  assert.deepEqual((await RS.readWorld(realm.wid)).holds, []);
  assert.equal((await RS.deleteRealm(realm.wid)).deleted, true);
  assert.equal(await RS.readRealmBytes(realm.wid), null); assert.equal(await RS.readWorld(realm.wid), null);
});

test('the localStorage fallback keeps the record and the world row', async () => {
  await closeDb(); setIdbFactory(null); slots.setBackends({ localStorage: ls, resetIdb: true });
  const r = realmOf(1, 'small'), w = await RS.writeRealm(r);
  assert.ok(ls.getItem(RS.realmKey(r.wid)));
  assert.deepEqual(await RS.readRealmBytes(r.wid), w.bytes);
  await RS.noteHold(r.wid, 'x', 1, 2, { name: 'Test' });
  assert.deepEqual((await RS.listWorlds()).map((x) => x.holds), [[['x', 1, 2]]]);
  assert.equal((await RS.resolveRealm({ ref: { wid: r.wid, crc: w.crc } })).from, 'store');
});
