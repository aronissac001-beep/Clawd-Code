// Workstream A, Stage 2 (doc 14.8 row A): the migrations framework with its v1 fixture, settings,
// the 8-colony list and Settings > Storage (classic keys). Stage 2.9 (EMBERCROWN-FORTRESS.md 1.3, 5.5; S9.4):
// no Ironhold (Hard rotates a and b and keeps a dawn backup; a Stage 2 Ironhold save gets them on its next
// save), the Ruin is never re-saved over its pre-fall copy, and Settings > Storage > Recover from a device
// problem. The browser
// half (real IndexedDB with 8 colonies at bot day 60) is scratch/colony/2/AG/persist-8.mjs (report).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createColony, stateHash, checkState, migrate, migrations, raidLive } from '../../js/game/core/state.js';
import { STATE_VERSION, DIFFICULTIES, normDifficulty } from '../../js/game/core/schema.js';
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
  assert.equal(s.colony.difficulty, 'steadfast'); assert.ok(!s.colony.iron); assert.equal(s.colony.tierSince, -1);
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

test('migrate(): v1 difficulty ids to the 9.1 ids; a v1 Ironhold reads as Hard; newer or broken versions refuse', () => {
  const ent = (c) => ({ meta: { v: 1 }, colony: c });
  assert.equal(migrate(ent({ difficulty: 'standard', iron: false }), 1).colony.difficulty, 'steadfast');
  assert.equal(migrate(ent({ difficulty: 'nightmare' }), 1).colony.difficulty, 'steadfast');
  const w = migrate(ent({ difficulty: 'warden', iron: false }), 1).colony;
  assert.deepEqual([w.difficulty, 'iron' in w, w.tierSince, w.storytellerDay, w.fallen], ['warden', false, -1, -1, false]);
  // a v1 Ironhold colony (iron: true) is a Hard colony from Stage 2.9 on (EMBERCROWN-FORTRESS.md 1.3, F9)
  const ih = migrate(ent({ difficulty: 'standard', iron: true }), 1).colony;
  assert.equal(ih.difficulty, 'hard');
  assert.equal(normDifficulty(ih.difficulty, ih.iron), 'hard');
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

const FIX2 = (n) => new Uint8Array(readFileSync(new URL(n, FIX)));

test('Hard: rotates a and b and keeps a dawn backup like every colony; there is no Ironhold rule left', async () => {
  installSim({ stage: '1a' });
  const s = foundColony({ seed: 'HARD-1', name: 'Hard Test', difficulty: 'hard', w: 64 });
  assert.equal(s.colony.difficulty, 'hard');
  assert.throws(() => foundColony({ seed: 'x', difficulty: 'ironhold', w: 32 }), /unknown difficulty/);
  const w1 = await slots.writeSlot(s.id, await saveBlob(s), slots.cardOf(s));
  step(s, 30);
  const w2 = await slots.writeSlot(s.id, await saveBlob(s), slots.cardOf(s));
  assert.deepEqual([w1.which, w2.which], ['a', 'b']);
  assert.equal((await slots.readSlots(s.id)).length, 2);
  assert.ok(await slots.writeDawn(s.id, await saveBlob(s)));
  assert.ok(await slots.readDawn(s.id));
  const card = slots.listColonies()[0];
  assert.equal(card.difficulty, 'hard');
  assert.ok(!('iron' in card));
  assert.equal(typeof slots.isIron, 'undefined', 'the Ironhold storage rule is gone');
});

test('a Stage 2 Ironhold save (v2-s2-iron) imports as Hard, loses iron on its card and gets b and dawn on its next saves', async () => {
  installSim({ stage: '2' });
  const bytes = FIX2('v2-s2-iron.ecsave');
  const peek = await slots.peekBlob(bytes);
  assert.equal(peek.difficulty, 'hard');
  assert.ok(!('iron' in peek));
  // an Ironhold card as Stage 2 stored it: only slot a, iron: true
  const id = await slots.importBlob(bytes, { iron: true });
  let card = slots.listColonies().find((c) => c.id === id);
  assert.equal(card.difficulty, 'hard');
  assert.ok(!('iron' in card), 'the meta card loses iron');
  assert.deepEqual((await slots.readSlots(id)).map((x) => x.which), ['a']);
  const s = await shell.continueColony(id);
  assert.ok(s);
  step(s, 60);
  await shell.saveNow('test');
  assert.deepEqual((await slots.readSlots(id)).map((x) => x.which).sort(), ['a', 'b'], 'slot b on the next save');
  assert.ok(await shell.saveDawn(), 'and a dawn backup');
  assert.ok(await slots.readDawn(id));
  card = slots.listColonies().find((c) => c.id === id);
  assert.ok(!('iron' in card));
  shell.app.s = null;
});

test('Settings > Storage > Recover from a device problem: every copy with its date; a pre-fall copy comes back with an honest Chronicle line', async () => {
  installSim({ stage: '2', reset: true });
  const s = foundColony({ seed: 'RECOVER-1', name: 'Recover Hold', w: 64 });
  s.st.queue.length = 0;
  shell.app.s = s;
  await shell.saveNow('one');                    // a: tick t1
  await shell.saveDawn();                        // dawn: t1
  const t1 = s.tick;
  step(s, 600);
  await shell.saveNow('two');                    // b: t1 + 600
  // the hold falls (set directly: fall.test.mjs covers the rule), the ruin is saved once into the older slot (a)
  step(s, 1);
  s.colony.fallen = true; s.colony.fallenAt = s.tick;
  assert.ok(shell.checkFall(), 'checkFall announces the fall once (and saves the ruin)');
  assert.equal(shell.checkFall(), null);
  for (let k = 0; k < 50 && (shell.app.saving || !slots.isFallenCard(s.id)); k++) await new Promise((r) => setTimeout(r, 10));
  let card = slots.listColonies().find((c) => c.id === s.id);
  assert.equal(card.fallen, true);
  assert.equal(card.fallenAt, s.colony.fallenAt);
  const before = (await slots.readSlots(s.id)).map((x) => [x.which, x.tick]);
  // saving the ruin again changes nothing: the pre-fall copy in the other slot survives
  const again = await shell.saveNow('again');
  assert.equal(again.skipped, 'ruin');
  assert.deepEqual((await slots.readSlots(s.id)).map((x) => [x.which, x.tick]), before);
  const list = await shell.recoveryList();
  const mine = list.find((c) => c.id === s.id);
  assert.equal(mine.fallen, true);
  assert.match(mine.fellText, /^Year 1, Thaw day 1$/);
  assert.deepEqual(mine.copies.map((k) => k.which).sort(), ['a', 'b', 'dawn']);
  assert.ok(mine.copies.every((k) => /^Year \d+, \w+ day \d+$/.test(k.date)));
  assert.equal(mine.copies[0].fallen, true, 'the newest copy is the ruin');
  assert.ok(shell.RECOVER_TEXT.confirm.includes('A fallen hold stays fallen in its Annals.'));
  // recover the dawn copy (before the fall)
  const r = await shell.recoverCopy(s.id, 'dawn');
  assert.equal(r.tick, t1);
  assert.equal(r.colony.fallen, false);
  const line = r.chron[r.chron.length - 1];
  assert.deepEqual([line[1], line[2], line[3].from], ['recovered', 'chron_recovered', 'dawn']);
  assert.match(line[3].date, /^Year 1, Thaw day 1$/);
  assert.equal(line[3].fell, mine.fellText, 'the line names the fall it rolls back');
  assert.equal(shell.app.ruin, false);
  // both slots now hold the recovered copy, so Continue cannot pick the ruin; the card is no longer fallen
  const now = await slots.readSlots(s.id);
  assert.deepEqual(now.map((x) => x.tick), [t1, t1]);
  card = slots.listColonies().find((c) => c.id === s.id);
  assert.equal(card.fallen, false);
  const back = await shell.continueColony(s.id);
  assert.equal(stateHash(back), stateHash(r));
  step(back, 300); step(r, 300);
  assert.equal(stateHash(back), stateHash(r), 'the recovered colony goes on deterministically');
  await assert.rejects(() => shell.recoverCopy(s.id, 'nope'), /no longer stored/);
  shell.app.s = null;
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
