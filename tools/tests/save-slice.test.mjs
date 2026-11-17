// EC2 saves of a real Stage 1a colony (owner A; doc 11.2-11.5, 14.6 row A): the day-5 size budget,
// the format-2 sections (layers, entity rows with field lists, flat items, binary runtime with paths),
// the quick-save text size, import / export, and eviction handling in the localStorage fallback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { day5Colony, sliceColony } from './slice-scene.mjs';
import { stateHash, checkState, raidLive } from '../../js/game/core/state.js';
import { verifyCaches } from '../../js/game/core/rtcontract.js';
import { newPath, newRaid } from '../../js/game/core/schema.js';
import { snapshot, saveBlob, loadBlob, saveBlobSync, loadBlobSync } from '../../js/game/save/colonysave.js';
import { encodeBlob, decodeBlob, unframePayload, COMP, blobToText } from '../../js/game/save/codec.js';
import * as slots from '../../js/game/save/slots.js';

const { s: day5, mined } = await day5Colony();

test('day 5: blob < 40 KB (deflate), snapshot fast, load equals the saved state and its caches', async () => {
  assert.ok(mined >= 80, `mined ${mined}`);
  const snap = snapshot(day5);
  const blob = await encodeBlob(snap.header, snap.payload, COMP.DEFLATE);
  assert.ok(blob.length < 40 * 1024, `day-5 blob ${(blob.length / 1024).toFixed(1)} KB`);
  const t0 = performance.now(); for (let k = 0; k < 5; k++) snapshot(day5); const ms = (performance.now() - t0) / 5;
  assert.ok(ms < 8, `snapshot ${ms.toFixed(2)} ms`);
  const back = await loadBlob(blob);
  assert.equal(stateHash(back), stateHash(day5));
  assert.deepEqual(checkState(back), []);
  assert.deepEqual(verifyCaches(back), []);
  const rle = saveBlobSync(day5);
  assert.ok(blobToText(rle).length < 270 * 1024, 'the quick-save text fits the 11.2 estimate');
  assert.equal(stateHash(loadBlobSync(rle)), stateHash(day5));
});

test('format 2: entity rows carry field lists, items are flat, paths travel in the binary runtime', async () => {
  const s = sliceColony('FMT-2');
  const c = s.col[0];
  c.path = newPath([10, 11, 12, 13], 2);
  s.col[1].path = newPath([], -1);  // a failed path survives as i = -1
  const { payload } = await decodeBlob(await saveBlob(s));
  const sec = unframePayload(payload);
  const ent = JSON.parse(sec.entities);
  assert.ok(Array.isArray(ent.fl.col) && ent.fl.col[0] === 'id');
  assert.ok(Array.isArray(ent.items.a) && Array.isArray(ent.items.strs));
  assert.ok(ent.col[0][ent.fl.col.indexOf('path')] == null, 'no path in the entity row');
  assert.ok(ent.col[0].length <= ent.fl.col.length, 'trailing defaults may be trimmed');
  const t = await loadBlob(await saveBlob(s));
  assert.deepEqual(Array.from(t.col[0].path.tiles), [10, 11, 12, 13]); assert.equal(t.col[0].path.i, 2);
  assert.equal(t.col[1].path.i, -1);
  assert.equal(stateHash(t), stateHash(s));
});

test('flow fields are saved only while a raid is live', async () => {
  const s = sliceColony('FLOW-1');
  s.rt.flow.push({ goal: 0, built: 5, stamp: 9, field: new Uint16Array(s.w * s.h).fill(7) });
  assert.equal(raidLive(s), false);
  const quiet = await loadBlob(await saveBlob(s));
  assert.equal(quiet.rt.flow.length, 0, 'no live raid: not saved');
  s.raids.push(newRaid(s.next.raid++, 'hollow_horde', { stage: 'active' }));
  assert.equal(raidLive(s), true);
  const loud = await loadBlob(await saveBlob(s));
  assert.equal(loud.rt.flow.length, 1);
  assert.ok(loud.rt.flow[0].field instanceof Uint16Array && loud.rt.flow[0].field[100] === 7);
  assert.equal(stateHash(loud), stateHash(s));
});

function fakeStorage(limit = Infinity) {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { let size = 0; for (const [kk, vv] of m) if (kk !== k) size += vv.length; if (size + String(v).length > limit) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; } m.set(k, String(v)); },
    removeItem: (k) => m.delete(k), clear: () => m.clear(), keys: () => [...m.keys()],
  };
}

test('storage (localStorage fallback): limited alert, peek and import keep the id, eviction marks the card missing', async () => {
  const ls = fakeStorage();
  const alerts = [];
  slots.setBackends({ localStorage: ls });
  const off = slots.onStorageAlert((k) => alerts.push(k));
  assert.equal(await slots.storageMode(), 'local');
  assert.ok(alerts.includes('limited'));
  const bytes = await saveBlob(day5);
  await slots.writeSlot(day5.id, bytes, slots.cardOf(day5));
  const p = await slots.peekBlob(blobToText(bytes));
  assert.equal(p.id, day5.id); assert.equal(p.name, day5.name); assert.equal(p.pop, day5.col.length);
  // a second import of the same colony gets a new id; the first keeps its own
  const id2 = await slots.importBlob(bytes);
  assert.notEqual(id2, day5.id); assert.ok(id2.startsWith(day5.id));
  assert.equal(slots.listColonies().length, 2);
  // eviction: the blobs go, the index stays
  for (const k of ls.keys()) if (k.startsWith('ec2.c.')) ls.removeItem(k);
  const cards = await slots.refreshColonies();
  assert.ok(cards.every((c) => c.missing === true));
  assert.ok(alerts.includes('missing'));
  // a damaged import is refused with a readable reason
  const bad = bytes.slice(); bad[bad.length - 3] ^= 0xff;
  await assert.rejects(() => slots.importBlob(bad), /damaged/);
  await assert.rejects(() => slots.importBlob('hello'), /EC2/);
  off();
});

test('writes are serialised: concurrent saves fill a and b, never the same slot twice', async () => {
  slots.setBackends({ localStorage: fakeStorage() });
  const s = sliceColony('SER-1');
  const b1 = await saveBlob(s); s.tick += 10; const b2 = await saveBlob(s); s.tick += 10; const b3 = await saveBlob(s);
  const [w1, w2, w3] = await Promise.all([slots.writeSlot(s.id, b1, slots.cardOf(s)), slots.writeSlot(s.id, b2, slots.cardOf(s)), slots.writeSlot(s.id, b3, slots.cardOf(s))]);
  assert.deepEqual([w1.which, w2.which, w3.which], ['a', 'b', 'a']);
  const all = await slots.readSlots(s.id);
  assert.deepEqual(all.map((x) => x.tick), [s.tick, s.tick - 10]);
});
