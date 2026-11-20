// Contract C14 (owner A; reviewer I; provisional until the 1a fun review): the storage API
// (doc 11.2, 11.4, 11.5).
//
//   listColonies()                 -> [card]            sync, from ec2.index, so the title draws at once
//   refreshColonies()              -> [card]            async: merges the IndexedDB `meta` cards into
//                                                       ec2.index (localStorage cleared) and marks a card
//                                                       { missing: true } when its blob is gone (eviction)
//   readSlot(colonyId, which?)     -> { bytes, tick, day, savedAt, crc, which } | null  (newest when which is omitted)
//   readSlots(colonyId)            -> [slot] newest first (Continue falls back to the older one)
//   writeSlot(colonyId, bytes, card) -> { which }       the older of a/b; meta and ec2.index after commit;
//                                                       the header is read back and its CRC checked
//   quickSave(s)                   -> boolean           sync; ec2.quick; false on a quota error (alert 'quota')
//   promoteQuick()                 -> colonyId | null   on launch: a newer quick-save becomes the older slot
//   exportBlob(colonyId)           -> { bytes, text, filename }
//   peekBlob(bytesOrText)          -> { id, name, tick, day, pop, stateVersion }  async; validates and reads the card
//   importBlob(bytesOrText, card?) -> colonyId          validates magic, version and CRC; the blob's own id
//                                                       unless taken (then a new id); the caller loads it with
//                                                       that id (s.id is set from the slot, not the blob)
//   writeDawn(colonyId, bytes)     -> { which: 'dawn', tick } | null   the daily dawn backup (1b; IndexedDB
//                                                       only: null in the localStorage fallback)
//   readDawn(colonyId)             -> slot | null       the dawn backup ("Load backup" on the colony card)
//   updateCard(colonyId, patch)    -> card | null       lastBackupAt, backupPromptAt, a2hsShown, ...
//   readSettings() / writeSettings(patch)               ec2.settings (not part of any colony; save/settings.js
//                                                       normalises: every key present, bad values reset)
// Stage 2 (14.8 row A):
//   colonyRoom()                   -> null | reason     can one more colony be added? (MAX_COLONIES 8)
//   writeSlot refuses a NEW colony id when 8 colonies are saved (the error says to delete one first)
// Stage 2.9 (EMBERCROWN-FORTRESS.md 1.3, 5.5): there is no Ironhold. Every colony rotates a and b and keeps
// a dawn backup; a Stage 2 Ironhold colony that had only slot a gets b and dawn on its next save, and its
// card loses `iron` (its difficulty reads as 'hard'). The card gains `fallen` and `fallenAt` (the Ruin).
//   readCopies(colonyId)           -> [{ which, tick, day, year, dayOfSeason, date, savedAt, bytes }]   every stored
//                                                       copy (a, b, dawn), newest first: Settings > Storage >
//                                                       Recover from a device problem
//   restoreCopy(colonyId, bytes, card) -> { which, tick, size }   a recovered copy becomes the colony: written
//                                                       into BOTH a and b (so Continue cannot pick a later copy),
//                                                       read back and checked; the dawn slot is left as it is
//   classicSaves()                 -> { keys: [{ key, chars }], chars }   the /classic/ game's localStorage keys
//   exportClassic()                -> { text, filename, keys, token }     a JSON file of them (export first)
//   clearClassic(token)            -> { removed }      removes them, only with the token of an export of the
//                                                       same contents (export, then clear: 11.2)
//   storageBytes()                 -> { index, settings, quick, classic, classicKeys, colonyText }  localStorage use
//   persistState()                 -> 'protected' | 'may be cleared' | 'unknown'
//   deleteColony(colonyId)
//   storageMode()                  -> 'idb' | 'local' | 'none'  (async; 'local' raises the alert 'limited')
//   onStorageAlert(fn)             fn('limited' | 'quota' | 'missing'); STORAGE_ALERTS has the player text
// Stage Z1 step E8 (EMBERCROWN-FORTRESS.md 5.1, 5.5): EC3 blobs (worlds with depth) and the pristine store.
//   writePristine(colonyId, p)      -> { id, size }   the store `pristine` (IndexedDB v2; ec2.p.<id> in the
//                                                       localStorage fallback): written, read back, CRC-checked
//   readPristineBytes(colonyId)     -> bytes | null
//   ensurePristineStored(s)         -> boolean        before a deep colony's first EC3 save (once per page)
//   pristineResolver(colonyId)      -> async ({ header, embedded, seed }) -> pristine   for colonysave.loadBlob:
//                                       the store, then the blob's own embedded copy, then the dawn blob's,
//                                       then (native worlds) regeneration with all 13 CRCs matching; a record
//                                       that is missing or damaged is rewritten from the copy that worked;
//                                       when none works: MISSING_TEXT, and nothing is overwritten
//   exportBlob embeds the pristine record into an EC3 slot that lacks it; importBlob stores an EC3 file's
//   embedded record (and refuses an EC3 file without one when no matching record is stored); deleteColony
//   deletes the record; quickSave embeds it while the store has not confirmed it.
// Real-time stamps (savedAt, lastPlayed) are fine here: saving never changes sim state (11.4).

import { openDb, idbAvailable, idbGet, idbKeys, idbPutMany, idbDelete } from './idb.js';
import { readAnyHeader as readHeader, headerBytesOf, blobToText, textToBlob, encodeBlobSync, crc32, COMP, toBase64, fromBase64, blobKind, decodeAny, unframePayload3, framePayload3, encodeBlob, FLAG_PRISTINE, LAYERS3 } from './codec.js';
import { snapshot, peekEntities, isDeep } from './colonysave.js';
import { encodePristine, decodePristine, pristineMatches, pristineOf, regeneratePristine, readPristineHeader, MISSING_TEXT } from './pristine.js';
import { STATE_VERSION, normDifficulty } from '../core/schema.js';
import { dayOf, yearOf, dayOfSeason, dateText } from '../core/time.js';
import { normalizeSettings, checkSettingsPatch } from './settings.js';

export const MAX_COLONIES = 8;
export const KEY_INDEX = 'ec2.index';
export const KEY_SETTINGS = 'ec2.settings';
export const KEY_QUICK = 'ec2.quick';
export const fallbackKey = (id, which) => `ec2.c.${id}.${which}`;
export const pristineKey = (id) => `ec2.p.${id}`;
export const STORAGE_ALERTS = Object.freeze({
  limited: 'Storage limited: export to keep your hold',
  quota: 'Storage nearly full: back up or delete a colony',
  missing: 'A saved colony is missing from this browser. Import a backup to bring it back.',
});

// ---- Backends (injectable for tests) ------------------------------------------------------------
let local = null;
let now = () => Date.now();
let idbState = null;   // null untested, true usable, false unusable (open failed: some private modes)
export function setBackends({ localStorage: ls, clock, resetIdb } = {}) {
  if (ls !== undefined) local = ls;
  if (clock) now = clock;
  if (resetIdb || ls !== undefined) { idbState = null; storedPristine.clear(); }
}
const ls = () => { if (local) return local; try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (_) { return null; } };

/** Can IndexedDB be used? Opens the database once; a failed open switches to the localStorage fallback. */
async function useIdb() {
  if (idbState !== null) return idbState;
  if (!idbAvailable()) { idbState = false; return false; }
  try { await openDb(); idbState = true; } catch (_) { idbState = false; }
  return idbState;
}
let limitedSaid = false;
/** 'idb' | 'local' | 'none'. The first time the fallback is in use it raises the alert 'limited'. */
export async function storageMode() {
  if (await useIdb()) return 'idb';
  if (!ls()) return 'none';
  if (!limitedSaid) { limitedSaid = true; alert('limited'); }
  return 'local';
}

/** Alerts raised by storage (the UI subscribes). */
const alertFns = [];
export function onStorageAlert(fn) { alertFns.push(fn); return () => { const k = alertFns.indexOf(fn); if (k >= 0) alertFns.splice(k, 1); }; }
const alert = (kind) => { for (const fn of alertFns.slice()) { try { fn(kind, STORAGE_ALERTS[kind]); } catch (_) { /* a UI error never breaks a save */ } } };
const isQuota = (e) => !!e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014 || e.name === 'NS_ERROR_DOM_QUOTA_REACHED');

// ---- Index (ec2.index, a mirror of the meta cards) --------------------------------------------
function readIndex() {
  const l = ls(); if (!l) return [];
  try { const v = JSON.parse(l.getItem(KEY_INDEX) || '[]'); return Array.isArray(v) ? v.filter((c) => c && typeof c.id === 'string') : []; } catch (_) { return []; }
}
function writeIndex(cards) {
  const l = ls(); if (!l) return;
  try { l.setItem(KEY_INDEX, JSON.stringify(cards)); } catch (e) { if (isQuota(e)) alert('quota'); }
}
function upsertCard(card) {
  const cards = readIndex().filter((c) => c.id !== card.id);
  cards.unshift(card);
  writeIndex(cards.slice(0, MAX_COLONIES));
}
const cardById = (id) => readIndex().find((c) => c.id === id) || null;

export function listColonies() { return readIndex(); }
/** null when one more colony fits, else the player-readable reason (8 colonies, 11.2). */
export function colonyRoom() {
  const n = readIndex().length;
  return n >= MAX_COLONIES ? `You already have ${MAX_COLONIES} colonies. Delete one first.` : null;
}
/** Has the colony fallen (its card says so)? A fallen colony is a read-only Ruin (1.3). */
export function isFallenCard(colonyId) { const c = cardById(colonyId); return !!(c && c.fallen); }

/**
 * Reconcile the index with IndexedDB: cards whose meta exists only in IndexedDB come back (the
 * localStorage was cleared), and a card whose blob is gone in both stores gets `missing: true`.
 */
export async function refreshColonies() {
  const cards = readIndex();
  const idb = await useIdb();
  if (idb) {
    try {
      const ids = (await idbKeys('meta')).filter((k) => typeof k === 'string').sort();
      for (const id of ids) if (!cards.some((c) => c.id === id)) { const m = await idbGet('meta', id); if (m) cards.push({ ...m, id }); }
    } catch (_) { /* keep the index as it is */ }
  }
  let anyMissing = false;
  for (const c of cards) {
    // a colony whose a/b slots are gone but whose dawn backup survives can still be loaded (Load backup)
    const has = (await readSlots(c.id)).length > 0 || !!(await readDawn(c.id));
    if (!has) anyMissing = true;
    if (has) delete c.missing; else c.missing = true;
  }
  cards.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
  writeIndex(cards.slice(0, MAX_COLONIES));
  if (anyMissing) alert('missing');
  return readIndex();
}

/** A colony card (11.2 `meta`) from a live state. */
export function cardOf(s, extra = {}) {
  return {
    id: s.id, name: s.name, banner: s.colony.banner || null, day: dayOf(s.tick), year: yearOf(s.tick), dayOfSeason: dayOfSeason(s.tick),
    tier: s.colony.tier, pop: s.col.length, storyteller: s.colony.storyteller, difficulty: normDifficulty(s.colony.difficulty, s.colony.iron),
    fallen: s.colony.fallen === true, fallenAt: s.colony.fallen === true && Number.isInteger(s.colony.fallenAt) ? s.colony.fallenAt : null,
    d: s.d || 1, deepest: deepestOf(s),
    lastPlayed: now(), ...extra,
  };
}
/**
 * The card's "Deepest" (EMBERCROWN-FORTRESS.md 4.6, 5.5): the lowest level with a voxel whose terrain differs
 * from the pristine world (dug, channelled, built), relative to the surface (0 at the surface, -9 nine levels
 * down). 0 for a world with one plane or no pristine record. A scan from the bottom: under 0.3 ms at D = 20.
 */
export function deepestOf(s) {
  const p = (s.d || 1) > 1 ? pristineOf(s) : null;
  const a = s.L && s.L.terrain, b = p && p.layers && p.layers.terrain;
  if (!a || !b || a.length !== b.length) return 0;
  const plane = s.w * s.h, zs = s.zS | 0;
  for (let z = 0; z < zs; z++) {
    for (let i = z * plane, e = i + plane; i < e; i++) if (a[i] !== b[i]) return z - zs;
  }
  return 0;
}

// ---- Slots ------------------------------------------------------------------------------------
async function pick(colonyId, w) {
  if (await useIdb()) {
    const v = await idbGet('slots', `${colonyId}:${w}`);
    return v && v.bytes ? { ...v, bytes: v.bytes instanceof Uint8Array ? v.bytes : new Uint8Array(v.bytes), which: w } : null;
  }
  const l = ls(); const t = l && l.getItem(fallbackKey(colonyId, w));
  if (!t) return null;
  try {
    const bytes = textToBlob(t); const { header } = readHeader(bytes);
    return { bytes, tick: header.tick, day: dayOf(header.tick), savedAt: 0, crc: header.crc, which: w };
  } catch (_) { return null; }
}
/** Both slots of a colony that exist, newest first (by tick; a tie goes to the later write). */
export async function readSlots(colonyId) {
  const a = await pick(colonyId, 'a'), b = await pick(colonyId, 'b');
  const out = [a, b].filter(Boolean);
  out.sort((x, y) => y.tick - x.tick || (y.savedAt || 0) - (x.savedAt || 0));
  return out;
}
export async function readSlot(colonyId, which) {
  if (which) return pick(colonyId, which);
  return (await readSlots(colonyId))[0] || null;
}

/** Which slot to write next: the older one (from IndexedDB meta when present, else the index). */
async function nextSlot(colonyId) {
  let newest = null;
  if (await useIdb()) { try { const m = await idbGet('meta', colonyId); if (m && m.newest) newest = m.newest; } catch (_) { /* fall back */ } }
  if (!newest) { const c = cardById(colonyId); if (c && c.newest) newest = c.newest; }
  if (!newest) {
    const slots = await readSlots(colonyId);
    if (slots.length) newest = slots[0].which;
  }
  return newest === 'a' ? 'b' : 'a';
}

let chain = Promise.resolve();
/** Serialise slot writes: two saves never pick the same slot (11.4). */
const serial = (fn) => { const p = chain.then(fn, fn); chain = p.catch(() => null); return p; };

/** The meta card a write stores: the known card, then the new fields; no Ironhold flag (5.5). */
function cardMeta(colonyId, known, card, extra) {
  const meta = { ...(known || {}), ...card, id: colonyId, ...extra };
  if (!meta.createdAt) meta.createdAt = now();   // the backup prompt's clock starts here (11.5)
  delete meta.missing;
  if ('iron' in meta) { if (meta.iron === true) meta.difficulty = 'hard'; delete meta.iron; }
  if (meta.difficulty) meta.difficulty = normDifficulty(meta.difficulty);
  return meta;
}
/** Write one slot record and read it back (IndexedDB) or store its text (the localStorage fallback). */
async function putSlot(colonyId, which, bytes, header, meta) {
  const rec = { bytes, tick: header.tick, day: dayOf(header.tick), savedAt: now(), crc: header.crc };
  if (await useIdb()) {
    try { await idbPutMany([['slots', `${colonyId}:${which}`, rec], ['meta', colonyId, meta]]); } catch (e) { if (isQuota(e)) alert('quota'); throw e; }
    const back = await idbGet('slots', `${colonyId}:${which}`);
    if (!back || !back.bytes || back.bytes.length !== bytes.length || crc32(back.bytes.subarray(headerBytesOf(bytes))) !== header.crc) throw new Error('The save could not be verified.');
  } else {
    const l = ls(); if (!l) throw new Error('This browser has no storage for saves.');
    await storageMode();
    try { l.setItem(fallbackKey(colonyId, which), blobToText(bytes)); } catch (e) { if (isQuota(e)) alert('quota'); throw e; }
  }
}

/** Write the older slot of a colony; resolves once committed, verified and the index is updated. */
export function writeSlot(colonyId, bytes, card) {
  return serial(async () => {
    const { header } = readHeader(bytes);
    const known = cardById(colonyId);
    if (!known) { const why = colonyRoom(); if (why) throw new Error(why); }
    const which = await nextSlot(colonyId);
    const meta = cardMeta(colonyId, known, card, { newest: which, size: bytes.length, bytes: bytes.length });
    await putSlot(colonyId, which, bytes, header, meta);
    upsertCard(meta);
    return { which, tick: header.tick, size: bytes.length };
  });
}

/**
 * The daily dawn backup (11.2 `<id>:dawn`, D11): written once per game day at dawn, never rotated with
 * a/b, so a bad hour of play (or a damaged a/b pair) can be rolled back to the morning. IndexedDB
 * only; in the localStorage fallback there is no room for it and this returns null.
 */
export function writeDawn(colonyId, bytes) {
  return serial(async () => {
    if (!(await useIdb())) return null;
    const { header } = readHeader(bytes);
    const rec = { bytes, tick: header.tick, day: dayOf(header.tick), savedAt: now(), crc: header.crc };
    const prev = cardById(colonyId);
    const puts = [['slots', `${colonyId}:dawn`, rec]];
    let meta = null;
    if (prev) { meta = { ...prev, id: colonyId, dawnTick: header.tick, dawnDay: dayOf(header.tick), dawnSavedAt: rec.savedAt }; delete meta.missing; puts.push(['meta', colonyId, meta]); }
    try { await idbPutMany(puts); } catch (e) { if (isQuota(e)) alert('quota'); throw e; }
    const back = await idbGet('slots', `${colonyId}:dawn`);
    if (!back || !back.bytes || back.bytes.length !== bytes.length || crc32(back.bytes.subarray(headerBytesOf(bytes))) !== header.crc) throw new Error('The dawn backup could not be verified.');
    if (meta) upsertCard(meta);
    return { which: 'dawn', tick: header.tick, size: bytes.length };
  });
}
/** The dawn backup of a colony, or null. */
export async function readDawn(colonyId) {
  if (!(await useIdb())) return null;
  try { return await pick(colonyId, 'dawn'); } catch (_) { return null; }
}

/** Synchronous emergency save on pagehide / hidden (RLE + base64 into ec2.quick). */
export function quickSave(s) {
  const l = ls(); if (!l) return false;
  try {
    // a deep colony whose world record the store has not confirmed yet carries it (founding, then a swipe-kill)
    const embed = isDeep(s) && !pristineStored(s.id, pristineOf(s));
    const { header, payload } = snapshot(s, { embed });
    const text = blobToText(encodeBlobSync(header, payload, COMP.RLE));
    l.setItem(KEY_QUICK, JSON.stringify({ colonyId: s.id, tick: s.tick, savedAt: now(), text }));
    return true;
  } catch (e) {
    if (isQuota(e)) { try { l.removeItem(KEY_QUICK); } catch (_) { /* nothing to free */ } alert('quota'); return false; }
    throw e;
  }
}
/** The pending quick-save record, or null. */
export function peekQuick() {
  const l = ls(); if (!l) return null;
  try { const q = JSON.parse(l.getItem(KEY_QUICK) || 'null'); return q && q.colonyId && q.text ? q : null; } catch (_) { return null; }
}

/** On launch: a quick-save newer than its colony's newest slot is written into the older slot (11.2). */
export async function promoteQuick() {
  const l = ls(); if (!l) return null;
  const raw = l.getItem(KEY_QUICK); if (!raw) return null;
  let q; try { q = JSON.parse(raw); } catch (_) { l.removeItem(KEY_QUICK); return null; }
  let bytes; try { bytes = textToBlob(q.text); readHeader(bytes); } catch (_) { l.removeItem(KEY_QUICK); return null; }
  const newest = await readSlot(q.colonyId);
  let promoted = false;
  if (!newest || q.tick > newest.tick) {
    const card = cardById(q.colonyId) || { id: q.colonyId, name: 'Recovered hold' };
    await writeSlot(q.colonyId, bytes, { ...card, day: dayOf(q.tick), year: yearOf(q.tick), dayOfSeason: dayOfSeason(q.tick) });
    promoted = true;
  }
  l.removeItem(KEY_QUICK);
  return promoted ? q.colonyId : null;
}

const safeName = (n) => String(n || 'hold').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'hold';
export async function exportBlob(colonyId, which) {
  const slot = which === 'dawn' ? await readDawn(colonyId) : await readSlot(colonyId, which);
  if (!slot) throw new Error('No save found for this colony.');
  const card = cardById(colonyId) || { name: 'hold' };
  const bytes = await withPristine(colonyId, slot.bytes);
  return { bytes, text: blobToText(bytes), filename: `${safeName(card.name)}-y${yearOf(slot.tick) + 1}d${dayOfSeason(slot.tick) + 1}.ecsave` };
}

/** Validate a blob (or its text form) and read its card fields without building a state. */
export async function peekBlob(input) {
  const bytes = typeof input === 'string' ? textToBlob(input) : input;
  readHeader(bytes);   // magic, version and CRC, with their player-readable reasons
  let header, ent, embedded;
  try { ({ header, ent, embedded } = await peekEntities(bytes)); } catch (e) { throw new Error('This save is damaged (its contents could not be read).'); }
  if (header.stateVersion > STATE_VERSION) throw new Error('This colony was saved by a newer version of the game.');
  const m = ent.meta || {}, c = ent.colony || {};
  const fallen = c.fallen === true;
  return { bytes, header, embedded, d: header.d || 1, id: m.id || null, name: m.name || 'Imported hold', tick: header.tick, day: dayOf(header.tick), pop: Array.isArray(ent.col) ? ent.col.length : 0,
    stateVersion: header.stateVersion, difficulty: normDifficulty(c.difficulty, c.iron), tier: c.tier | 0,
    fallen, fallenAt: fallen && Number.isInteger(c.fallenAt) ? c.fallenAt : null };
}

/** Import a blob or its text form. Throws a player-readable error on a bad file. */
export async function importBlob(input, card = {}) {
  const p = await peekBlob(input);
  const full = colonyRoom(); if (full) throw new Error(full);
  const taken = (id) => readIndex().some((c) => c.id === id);
  let id = card.id || p.id || 'imp' + crc32(p.bytes).toString(36);
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) id = 'imp' + crc32(p.bytes).toString(36);
  if (taken(id)) { const base = id.slice(0, 32); let k = 2; while (taken(`${base}-${k}`)) k++; id = `${base}-${k}`; }
  if (p.header.format === 3) {
    // an EC3 file carries its world record (5.1): it is stored first, checked against the file's header
    let pr = null;
    if (p.embedded) { try { pr = await decodePristine(p.embedded); } catch (_) { pr = null; } }
    if (!pr || !pristineMatches(pr, p.header)) throw new Error('This save has no usable world record. Export it again from the game to include it.');
    await writePristine(id, pr);
  }
  await writeSlot(id, p.bytes, { name: p.name, pop: p.pop, tier: p.tier, difficulty: p.difficulty, fallen: p.fallen, fallenAt: p.fallenAt, ...card, id, day: p.day, year: yearOf(p.tick), dayOfSeason: dayOfSeason(p.tick), lastPlayed: now() });
  return id;
}

// ---- Recover from a device problem (Settings > Storage, EMBERCROWN-FORTRESS.md 1.3, 5.5) ----------------
/** Every stored copy of a colony (slots a, b and the dawn backup), newest first, with its game date. */
export async function readCopies(colonyId) {
  const out = [];
  for (const w of ['a', 'b']) { const c = await pick(colonyId, w).catch(() => null); if (c) out.push(c); }
  const d = await readDawn(colonyId); if (d) out.push({ ...d, which: 'dawn' });
  out.sort((x, y) => y.tick - x.tick || (y.savedAt || 0) - (x.savedAt || 0) || (x.which < y.which ? -1 : 1));
  return out.map((c) => ({ which: c.which, tick: c.tick, day: dayOf(c.tick), year: yearOf(c.tick), dayOfSeason: dayOfSeason(c.tick), date: dateText(c.tick), savedAt: c.savedAt || 0, bytes: c.bytes }));
}
/**
 * A recovered copy becomes the colony (the caller has loaded it and re-saved it with its Chronicle line):
 * the same bytes go into slot a and slot b, so neither a later copy (a fall, a damaged hour) nor the slot
 * rotation can bring the old newest copy back. The dawn backup is not touched. Serialised with writeSlot.
 */
export function restoreCopy(colonyId, bytes, card = {}) {
  return serial(async () => {
    const { header } = readHeader(bytes);
    const known = cardById(colonyId);
    if (!known) throw new Error('There is no such colony on this device.');
    const meta = cardMeta(colonyId, known, card, { newest: 'a', size: bytes.length, bytes: bytes.length, recoveredAt: now() });
    await putSlot(colonyId, 'b', bytes, header, meta);
    await putSlot(colonyId, 'a', bytes, header, meta);
    upsertCard(meta);
    return { which: 'a', tick: header.tick, size: bytes.length };
  });
}

export async function deleteColony(colonyId) {
  if (await useIdb()) { for (const w of ['a', 'b', 'dawn']) await idbDelete('slots', `${colonyId}:${w}`); await idbDelete('meta', colonyId); await idbDelete('pristine', colonyId); }
  storedPristine.delete(colonyId);
  const l = ls();
  if (l) {
    l.removeItem(fallbackKey(colonyId, 'a')); l.removeItem(fallbackKey(colonyId, 'b')); l.removeItem(pristineKey(colonyId));
    const q = peekQuick(); if (q && q.colonyId === colonyId) l.removeItem(KEY_QUICK);
  }
  writeIndex(readIndex().filter((c) => c.id !== colonyId));
}

/** Update fields of a colony card (e.g. lastBackupAt, a2hsShown) in the index and in IndexedDB meta. */
export async function updateCard(colonyId, patch) {
  const c = cardById(colonyId); if (!c) return null;
  const next = { ...c, ...patch, id: colonyId };
  upsertCard(next);
  if (await useIdb()) { try { await idbPutMany([['meta', colonyId, next]]); } catch (_) { /* the index still has it */ } }
  return next;
}

// ---- Settings and storage use (Settings > Storage, 11.1, 11.2) ---------------------------------------
/** The settings: always complete and valid (save/settings.js defaults fill what is missing or bad). */
export function readSettings() {
  const l = ls(); if (!l) return normalizeSettings({});
  try { return normalizeSettings(JSON.parse(l.getItem(KEY_SETTINGS) || '{}')); } catch (_) { return normalizeSettings({}); }
}
/** Merge a patch (invalid keys are ignored: see checkSettingsPatch) and store; returns the settings now. */
export function writeSettings(patch) {
  const { ok } = checkSettingsPatch(patch);
  const next = normalizeSettings({ ...readSettings(), ...ok });
  const l = ls(); if (!l) return next;
  try { l.setItem(KEY_SETTINGS, JSON.stringify(next)); } catch (e) { if (isQuota(e)) alert('quota'); }
  return next;
}
/** localStorage use in characters (about 2 bytes each in Safari): ours, the classic game's, and fallback colonies. */
export function storageBytes() {
  const l = ls(); const out = { index: 0, settings: 0, quick: 0, classic: 0, classicKeys: [], colonyText: 0, other: 0 };
  if (!l) return out;
  const keys = [];
  try {
    if (typeof l.length === 'number' && typeof l.key === 'function') for (let k = 0; k < l.length; k++) keys.push(l.key(k));
  } catch (_) { /* some private modes */ }
  keys.sort();
  for (const k of keys) {
    const n = (l.getItem(k) || '').length + k.length;
    if (k === KEY_INDEX) out.index += n; else if (k === KEY_SETTINGS) out.settings += n; else if (k === KEY_QUICK) out.quick += n;
    else if (k.startsWith('ec2.c.')) out.colonyText += n;
    else if (k.startsWith('embercrown.')) { out.classic += n; out.classicKeys.push(k); } else out.other += n;
  }
  return out;
}

// ---- Classic saves (/classic/ keeps embercrown.* in localStorage; 11.2: export first, then clear) ----
const classicKeyList = () => {
  const l = ls(); if (!l) return [];
  const keys = [];
  try { if (typeof l.length === 'number' && typeof l.key === 'function') for (let k = 0; k < l.length; k++) { const x = l.key(k); if (x && x.startsWith('embercrown.')) keys.push(x); } } catch (_) { /* private modes */ }
  return keys.sort();
};
/** The classic game's keys and their size in characters (Settings > Storage). */
export function classicSaves() {
  const l = ls(); const keys = classicKeyList().map((key) => ({ key, chars: ((l && l.getItem(key)) || '').length + key.length }));
  return { keys, chars: keys.reduce((n, k) => n + k.chars, 0) };
}
const tokenOf = (text) => crc32(new TextEncoder().encode(text)).toString(36);
/** A JSON backup of every classic key (for the share sheet or a download), and the token clearClassic needs. */
export function exportClassic() {
  const l = ls(); const keys = classicKeyList();
  const data = {}; for (const k of keys) data[k] = l.getItem(k);
  const text = JSON.stringify({ kind: 'embercrown-classic', exportedAt: now(), keys: data });
  return { text, filename: 'embercrown-classic-saves.json', keys, token: tokenOf(JSON.stringify(data)) };
}
/** Remove the classic keys, only if `token` is from an export of exactly what is stored now. */
export function clearClassic(token) {
  const l = ls(); if (!l) return { removed: 0 };
  const keys = classicKeyList();
  const data = {}; for (const k of keys) data[k] = l.getItem(k);
  if (!token || token !== tokenOf(JSON.stringify(data))) throw new Error('Export the classic saves first: they changed since the last export.');
  for (const k of keys) l.removeItem(k);
  return { removed: keys.length };
}

let persistAnswer = null;
/** navigator.storage.persist() answer for Settings > Storage. Requested on the first save (11.1). */
export async function persistState() {
  if (persistAnswer === 'protected') return persistAnswer;
  try {
    if (typeof navigator === 'undefined' || !navigator.storage || !navigator.storage.persist) return (persistAnswer = 'unknown');
    if (await navigator.storage.persisted()) return (persistAnswer = 'protected');
    return (persistAnswer = (await navigator.storage.persist()) ? 'protected' : 'may be cleared');
  } catch (_) { return (persistAnswer = 'unknown'); }
}
export const lastPersistState = () => persistAnswer;

// ---- The pristine store (EMBERCROWN-FORTRESS.md 5.1, 5.5; Stage Z1 step E8) --------------------------------
const storedPristine = new Map();   // colonyId -> pristineId the store holds, confirmed this page (read back)
const pristineStored = (colonyId, p) => !!p && storedPristine.get(colonyId) === p.id;

/** Write a colony's pristine record, read it back and check every CRC. Throws when it cannot be verified. */
export async function writePristine(colonyId, p) {
  const bytes = await encodePristine(p);
  if (await useIdb()) {
    try { await idbPutMany([['pristine', colonyId, { bytes, id: p.id, savedAt: now() }]]); } catch (e) { if (isQuota(e)) alert('quota'); throw e; }
  } else {
    const l = ls(); if (!l) throw new Error('This browser has no storage for saves.');
    try { l.setItem(pristineKey(colonyId), toBase64(bytes)); } catch (e) { if (isQuota(e)) alert('quota'); throw e; }
  }
  const back = await readPristineBytes(colonyId);
  let ok = false;
  try { ok = !!back && (await decodePristine(back)).id === p.id; } catch (_) { ok = false; }
  if (!ok) throw new Error("The hold's world record could not be verified.");
  storedPristine.set(colonyId, p.id);
  return { id: p.id, size: bytes.length };
}
/** The stored record bytes of a colony, or null. */
export async function readPristineBytes(colonyId) {
  if (await useIdb()) {
    try { const v = await idbGet('pristine', colonyId); return v && v.bytes ? (v.bytes instanceof Uint8Array ? v.bytes : new Uint8Array(v.bytes)) : null; } catch (_) { return null; }
  }
  const l = ls(); const t = l && l.getItem(pristineKey(colonyId));
  if (!t) return null;
  try { return fromBase64(t); } catch (_) { return null; }
}
/** Before a deep colony's EC3 save: its pristine world is in the store (written once, then remembered). */
export async function ensurePristineStored(s) {
  if (!isDeep(s)) return false;
  const p = pristineOf(s);
  if (!p) throw new Error('This hold has no world record to save against.');
  if (pristineStored(s.id, p)) return true;
  const have = await readPristineBytes(s.id);
  if (have) { try { if (readPristineHeader(have).id === p.id && (await decodePristine(have)).id === p.id) { storedPristine.set(s.id, p.id); return true; } } catch (_) { /* rewrite below */ } }
  await writePristine(s.id, p);
  return true;
}

/** The embedded record of an EC3 blob (null when it has none). */
async function embeddedOf(bytes) {
  if (blobKind(bytes) !== 'EC3') return null;
  const { header, payload } = await decodeAny(bytes);
  if (!(header.flags & FLAG_PRISTINE)) return null;
  return unframePayload3(payload, true).pristine;
}
/** The fallback order of 5.1, for colonysave.loadBlob(bytes, { pristine: pristineResolver(id) }). */
export function pristineResolver(colonyId) {
  return async ({ header, embedded, seed }) => {
    let storeState = 'missing';
    const stored = await readPristineBytes(colonyId);
    if (stored) {
      try {
        const p = await decodePristine(stored);
        if (pristineMatches(p, header)) { storedPristine.set(colonyId, p.id); return p; }
        storeState = 'other';   // a valid record of another world state: never overwritten from an older copy
      } catch (_) { storeState = 'damaged'; }
    }
    const tryBytes = async (b) => { if (!b) return null; try { const p = await decodePristine(b); return pristineMatches(p, header) ? p : null; } catch (_) { return null; } };
    let p = await tryBytes(embedded);
    if (!p) { const dawn = await readDawn(colonyId).catch(() => null); if (dawn) p = await tryBytes(await embeddedOf(dawn.bytes).catch(() => null)); }
    if (!p) p = regeneratePristine(header, seed);
    if (!p) throw new Error(MISSING_TEXT);
    if (storeState !== 'other') { try { await writePristine(colonyId, p); } catch (_) { /* the colony still loads; the next save retries */ } }
    return p;
  };
}

/** An EC3 blob with its pristine record embedded (exports, 5.1): unchanged when it has one or is EC2. */
async function withPristine(colonyId, bytes) {
  if (blobKind(bytes) !== 'EC3') return bytes;
  const { header, payload } = await decodeAny(bytes);
  if (header.flags & FLAG_PRISTINE) return bytes;
  const rec = await readPristineBytes(colonyId);
  let ok = false;
  try { ok = !!rec && pristineMatches(await decodePristine(rec), header); } catch (_) { ok = false; }
  if (!ok) { const dawn = await readDawn(colonyId).catch(() => null); if (dawn && dawn.tick === header.tick) return dawn.bytes; throw new Error(MISSING_TEXT); }
  const sec = unframePayload3(payload, false);
  const ordered = LAYERS3.map((l) => ({ id: l.id, enc: sec.layers[l.name].enc, bytes: sec.layers[l.name].bytes }));
  const body = framePayload3(rec, ordered, sec.entities, sec.runtimeBytes);
  return encodeBlob({ ...header, flags: header.flags | FLAG_PRISTINE }, body, header.comp);
}
