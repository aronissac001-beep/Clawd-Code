// Workstream A, Stage 1b (doc 14.7 row A): the dawn slot, backup prompt timing, Move to app import and
// the storage display. The browser half (real IndexedDB, eviction, quick-save promotion) is the
// persist gate (tools/persist.mjs); here a small in-memory IndexedDB stands in for it.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { stateHash } from '../../js/game/core/state.js';
import { TICKS_PER_DAY, TICKS_PER_HOUR, START_TICK, DAYS_PER_SEASON } from '../../js/game/core/time.js';
import { saveBlob, loadBlob } from '../../js/game/save/colonysave.js';
import * as slots from '../../js/game/save/slots.js';
import { setIdbFactory, closeDb } from '../../js/game/save/idb.js';
import { backupDue, dawnIndex, seasonKey, DAY_MS, BACKUP, PERSIST_TEXT, promptOn } from '../../js/game/save/backups.js';
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

let idb, ls, clock;
beforeEach(async () => {
  await closeDb();
  idb = fakeIdb(); ls = fakeStorage(); clock = 1_700_000_000_000;
  setIdbFactory(idb);
  slots.setBackends({ localStorage: ls, clock: () => clock, resetIdb: true });
});

function colony(seed = 'A1B') {
  return shell.newColony(seed, { name: 'Emberwatch' });
}

test('dawn slot: written beside a/b, never rotated, survives a/b loss; Continue falls back to it; Load backup', async () => {
  const s = colony();
  const w1 = await shell.saveNow('test');
  assert.equal(w1.which, 'a');
  s.tick = START_TICK + TICKS_PER_DAY;                     // day 2, 06:00
  const d = await shell.saveDawn();
  assert.deepEqual([d.which, d.tick], ['dawn', s.tick]);
  const card = slots.listColonies()[0];
  assert.equal(card.dawnTick, s.tick); assert.equal(card.dawnDay, 1);
  const dawnHash = stateHash(s);
  s.tick += 5 * TICKS_PER_HOUR;
  await shell.saveNow('test'); await shell.saveNow('test');  // a and b rotate; the dawn slot stays
  assert.equal((await slots.readDawn(s.id)).tick, START_TICK + TICKS_PER_DAY);
  assert.deepEqual((await slots.readSlots(s.id)).map((x) => x.which).sort(), ['a', 'b'], 'readSlots lists only a and b');
  // Load backup: back to that morning
  const t = await shell.loadBackup(s.id);
  assert.equal(stateHash(t), dawnHash);
  // a/b lost (or damaged): the card is not missing, and Continue loads the dawn backup
  const db = idb._dbs.get('ec2');
  db.get('slots').delete(`${s.id}:a`); db.get('slots').delete(`${s.id}:b`);
  const cards = await slots.refreshColonies();
  assert.equal(cards[0].missing, undefined, 'a dawn backup keeps the colony loadable');
  const u = await shell.continueColony(s.id);
  assert.equal(stateHash(u), dawnHash);
  // export from the dawn slot; delete removes it
  const ex = await slots.exportBlob(s.id, 'dawn');
  assert.ok(ex.text.startsWith('EC2:'));
  await slots.deleteColony(s.id);
  assert.equal(await slots.readDawn(s.id), null);
});

test('dawn slot is skipped (null) in the localStorage fallback', async () => {
  setIdbFactory(null);
  slots.setBackends({ localStorage: ls, resetIdb: true });
  const g = globalThis.indexedDB; // Node has none
  assert.equal(g, undefined);
  colony('A1B-LS');
  await shell.saveNow('test');
  assert.equal(await shell.saveDawn(), null);
  assert.equal(await slots.readDawn(shell.app.s.id), null);
});

test('dawnIndex and seasonKey', () => {
  assert.equal(dawnIndex(START_TICK), 0);
  assert.equal(dawnIndex(START_TICK + TICKS_PER_DAY - 1), 0);
  assert.equal(dawnIndex(START_TICK + TICKS_PER_DAY), 1);
  assert.equal(seasonKey(0), 0);
  assert.equal(seasonKey(DAYS_PER_SEASON * TICKS_PER_DAY), 1);
  assert.equal(seasonKey(4 * DAYS_PER_SEASON * TICKS_PER_DAY), 4);
});

test('backup prompt timing: once per season at dawn, at most every 3 real days, always when 6 days stale in Safari', () => {
  const t0 = 1_700_000_000_000, day = DAY_MS;
  const card = { id: 'c', createdAt: t0 };
  const tick = START_TICK + 3 * TICKS_PER_DAY;
  // a new colony: no prompt in its first 3 days, even at dawn
  assert.equal(backupDue({ card, now: t0 + 2 * day, tick, atDawn: true }), null);
  // after 3 days, at dawn, once per season
  assert.deepEqual(backupDue({ card, now: t0 + 3 * day, tick, atDawn: true }).reason, 'season');
  assert.equal(backupDue({ card, now: t0 + 3 * day, tick, atDawn: false }), null, 'only at dawn');
  const prompted = { ...card, backupPromptAt: t0 + 3 * day, backupPromptSeason: seasonKey(tick) };
  assert.equal(backupDue({ card: prompted, now: t0 + 7 * day, tick: tick + TICKS_PER_DAY, atDawn: true, standalone: true }), null, 'same season: not again (app)');
  const nextSeason = tick + DAYS_PER_SEASON * TICKS_PER_DAY;
  assert.equal(backupDue({ card: prompted, now: t0 + 5 * day, tick: nextSeason, atDawn: true }), null, 'a new season but within 3 days of the last prompt');
  assert.equal(backupDue({ card: prompted, now: t0 + 6 * day, tick: nextSeason, atDawn: true, standalone: true }).reason, 'season');
  // stale: 6 real days since the last backup, in a Safari tab, at any time
  const backedUp = { ...card, lastBackupAt: t0 };
  assert.equal(backupDue({ card: backedUp, now: t0 + 5.9 * day, tick }), null);
  assert.equal(backupDue({ card: backedUp, now: t0 + 6 * day, tick }).reason, 'stale');
  assert.equal(backupDue({ card: backedUp, now: t0 + 6 * day, tick, standalone: true }), null, 'the stale rule is for Safari tabs');
  // a backup resets the clock: none within 3 days of it
  assert.equal(backupDue({ card: { ...card, lastBackupAt: t0 + 4 * day }, now: t0 + 6 * day, tick, atDawn: true }), null);
  // off in Settings: honoured only as a Home Screen app
  const off = { backupPrompt: false };
  assert.equal(backupDue({ card, now: t0 + 9 * day, tick, atDawn: true, standalone: true, settings: off }), null);
  assert.equal(backupDue({ card, now: t0 + 9 * day, tick, atDawn: true, standalone: false, settings: off }).reason, 'stale');
  assert.ok(promptOn(off, false) && !promptOn(off, true));
  assert.equal(backupDue({ card: { ...card, missing: true }, now: t0 + 9 * day, tick }), null);
  assert.equal(BACKUP.minGapDays, 3); assert.equal(BACKUP.staleDays, 6);
});

test('checkBackup marks the prompt on the card and fires once per gap', async () => {
  const s = colony('A1B-PROMPT');
  await shell.saveNow('test');
  const now = clock + 4 * DAY_MS;   // the slots clock stamped createdAt
  const due = shell.checkBackup(true, now);
  assert.equal(due && due.reason, 'season');
  assert.equal(shell.app.backupDue.id, s.id);
  await new Promise((r) => setTimeout(r, 30));
  const card = slots.listColonies().find((c) => c.id === s.id);
  assert.equal(card.backupPromptAt, now); assert.equal(card.backupPromptSeason, seasonKey(s.tick));
  assert.equal(shell.checkBackup(true, now + 1000), null, 'not again so soon');
});

test('Move to app: Safari copies the text; the app imports it from the paste, verified, under a new id when taken', async () => {
  const s = colony('A1B-MOVE');
  s.tick += 2 * TICKS_PER_HOUR;
  await shell.saveNow('test');
  const out = await shell.moveToApp(s.id);
  assert.ok(out.ok && out.text.startsWith('EC2:'));
  assert.equal(out.copied, false, 'no clipboard in Node: the UI shows the text');
  assert.equal(out.steps.length, 3);
  // the Home Screen app's container: empty storage, then "Paste a colony from Safari"
  await closeDb(); idb = fakeIdb(); setIdbFactory(idb); slots.setBackends({ localStorage: fakeStorage(), resetIdb: true });
  const r = await shell.pasteColonyFromSafari(out.text);
  assert.equal(r.verified, true); assert.equal(r.id, s.id, 'the colony keeps its id in the app');
  assert.match(r.text, /Moved/);
  const t = await shell.continueColony(r.id);
  assert.equal(stateHash(t), stateHash(await loadBlob((await slots.readSlot(r.id)).bytes)));
  // pasted twice: a second copy under a new id
  const r2 = await shell.pasteColonyFromSafari(out.text);
  assert.notEqual(r2.id, r.id); assert.ok(r2.verified);
  await assert.rejects(() => shell.pasteColonyFromSafari('hello'), /does not hold a colony/);
  // the file-picker fallback, bytes and text
  const bytes = (await slots.exportBlob(r.id)).bytes;
  const r3 = await shell.importColonyFile({ arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) });
  assert.ok(r3.verified);
  const r4 = await shell.importColonyFile({ arrayBuffer: async () => new TextEncoder().encode(out.text + '\n').buffer });
  assert.ok(r4.verified);
});

test('storage display: persist answer text, mode, colony sizes and localStorage use incl. classic keys', async () => {
  const s = colony('A1B-INFO');
  await shell.saveNow('test');
  ls.setItem('embercrown.run', 'x'.repeat(500));
  const info = await shell.storageInfo();
  assert.ok(['protected', 'may be cleared', 'unknown'].includes(info.persist));
  assert.equal(info.persistText, PERSIST_TEXT[info.persist]);
  assert.equal(info.mode, 'idb');
  assert.equal(info.colonies[0].id, s.id); assert.ok(info.colonies[0].size > 0);
  assert.ok(info.local.classic >= 500 && info.local.classicKeys.includes('embercrown.run'));
  assert.ok(info.local.index > 0);
  assert.equal(shell.isStandalone(), false);
  shell.writeSettings({ backupPrompt: false });
  assert.equal(shell.readSettings().backupPrompt, false);
});

test('a saved state round-trips through the dawn slot byte for byte', async () => {
  const s = colony('A1B-RT');
  const bytes = await saveBlob(s);
  await slots.writeSlot(s.id, bytes, slots.cardOf(s));
  await slots.writeDawn(s.id, bytes);
  const back = await slots.readDawn(s.id);
  assert.deepEqual([...back.bytes], [...bytes]);
});
