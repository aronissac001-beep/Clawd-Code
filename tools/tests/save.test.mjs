import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createColony, stateHash, checkState } from '../../js/game/core/state.js';
import { newColonist, newStack, newBuilding, newZone, newJob, newPath } from '../../js/game/core/schema.js';
import { saveBlob, saveBlobSync, loadBlob, loadBlobSync } from '../../js/game/save/colonysave.js';
import * as slots from '../../js/game/save/slots.js';

function busyColony() {
  const s = createColony('SAVE-1', { name: 'Ashholm' });
  s.col.push(newColonist(1, { name: 'Bryn', x: 1000.25, y: 2000.5, job: newJob('haul', 77, [['goto', 77]]), path: newPath([5, 6, 7]) }));
  s.items[0] = newStack(0, 'wood', 'pine', 0, 30, 4, 4); s.items[1] = null; s.items[2] = newStack(2, 'stone', 'granite', 0, 10, 9, 9);
  s.bld[0] = newBuilding(0, 'wall', 20, 20, 0, 'granite', { st: 'done' });
  s.zones.push(newZone(1, 'stockpile'));
  s.L.terrain[300] = 9; s.L.fog[3] = 0xff; s.tick = 777; s.rt.thinkQ.push(1); s.rt.pathQ.push([1, 5, 900]);
  s.colony.techs[1] = 4; s.rel['1025'] = [40, 'friend']; s.chron.push([1, 'founded', 't', []]);
  return s;
}

test('snapshot -> EC2 blob -> state round trip (deflate and RLE) keeps the hash', async () => {
  const s = busyColony(), h = stateHash(s);
  const t = await loadBlob(await saveBlob(s));
  assert.equal(stateHash(t), h); assert.deepEqual(checkState(t), []);
  assert.equal(t.items[1], null); assert.ok(t.col[0].path.tiles instanceof Uint32Array);
  assert.deepEqual(t.rt.pathQ, [[1, 5, 900]]);
  assert.equal(t.rt.itemAt[4 * 128 + 4], 0, 'derived caches rebuilt at load');
  const u = loadBlobSync(saveBlobSync(s));
  assert.equal(stateHash(u), h);
});

function fakeStorage(limit = Infinity) {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { let size = 0; for (const [kk, vv] of m) if (kk !== k) size += vv.length; if (size + String(v).length > limit) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; } m.set(k, String(v)); },
    removeItem: (k) => m.delete(k), get size() { return m.size; },
  };
}

test('slots (localStorage fallback in Node): write a/b rotation, read newest, list, export, import, delete', async () => {
  const ls = fakeStorage(); let clock = 1000;
  slots.setBackends({ localStorage: ls, clock: () => clock++ });
  const s = busyColony();
  const w1 = await slots.writeSlot(s.id, await saveBlob(s), slots.cardOf(s));
  s.tick = 900;
  const w2 = await slots.writeSlot(s.id, await saveBlob(s), slots.cardOf(s));
  assert.notEqual(w1.which, w2.which);
  const newest = await slots.readSlot(s.id);
  assert.equal(newest.tick, 900);
  assert.equal(slots.listColonies().length, 1);
  const ex = await slots.exportBlob(s.id);
  assert.match(ex.filename, /^ashholm-y1d1\.ecsave$/); assert.ok(ex.text.startsWith('EC2:'));
  const id2 = await slots.importBlob(ex.text, { name: 'Copy' });
  assert.notEqual(id2, s.id);
  assert.equal(stateHash(await loadBlob((await slots.readSlot(id2)).bytes)), stateHash(await loadBlob(newest.bytes)));
  await slots.deleteColony(id2);
  assert.equal(slots.listColonies().length, 1);
});

test('quick-save is promoted on the next launch when newer; quota errors raise the alert', async () => {
  const ls = fakeStorage();
  slots.setBackends({ localStorage: ls });
  const s = busyColony();
  await slots.writeSlot(s.id, await saveBlob(s), slots.cardOf(s));
  s.tick = 5000;
  assert.equal(slots.quickSave(s), true);
  assert.equal(await slots.promoteQuick(), s.id);
  assert.equal((await slots.readSlot(s.id)).tick, 5000);
  assert.equal(ls.getItem(slots.KEY_QUICK), null);
  const tiny = fakeStorage(10); const alerts = [];
  slots.setBackends({ localStorage: tiny }); slots.onStorageAlert((k) => alerts.push(k));
  assert.equal(slots.quickSave(s), false); assert.deepEqual(alerts, ['quota']);
});
