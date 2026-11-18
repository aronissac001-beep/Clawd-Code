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
//   isIron(colonyId)               Ironhold (9.1, 11.5): one slot ('a' only, never rotated), no dawn backup,
//                                  no Load backup; the card carries iron: true
//   classicSaves()                 -> { keys: [{ key, chars }], chars }   the /classic/ game's localStorage keys
//   exportClassic()                -> { text, filename, keys, token }     a JSON file of them (export first)
//   clearClassic(token)            -> { removed }      removes them, only with the token of an export of the
//                                                       same contents (export, then clear: 11.2)
//   storageBytes()                 -> { index, settings, quick, classic, classicKeys, colonyText }  localStorage use
//   persistState()                 -> 'protected' | 'may be cleared' | 'unknown'
//   deleteColony(colonyId)
//   storageMode()                  -> 'idb' | 'local' | 'none'  (async; 'local' raises the alert 'limited')
//   onStorageAlert(fn)             fn('limited' | 'quota' | 'missing'); STORAGE_ALERTS has the player text
// Real-time stamps (savedAt, lastPlayed) are fine here: saving never changes sim state (11.4).

import { openDb, idbAvailable, idbGet, idbKeys, idbPutMany, idbDelete } from './idb.js';
import { readHeader, blobToText, textToBlob, encodeBlobSync, decodeBlob, unframePayload, crc32, COMP, HEADER_BYTES } from './codec.js';
import { snapshot } from './colonysave.js';
import { STATE_VERSION } from '../core/schema.js';
import { dayOf, yearOf, dayOfSeason } from '../core/time.js';
import { normalizeSettings, checkSettingsPatch } from './settings.js';

export const MAX_COLONIES = 8;
export const KEY_INDEX = 'ec2.index';
export const KEY_SETTINGS = 'ec2.settings';
export const KEY_QUICK = 'ec2.quick';
export const fallbackKey = (id, which) => `ec2.c.${id}.${which}`;
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
  if (resetIdb || ls !== undefined) idbState = null;
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
/** Is the colony an Ironhold colony (one slot, no backups)? */
export function isIron(colonyId) { const c = cardById(colonyId); return !!(c && c.iron); }

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
    tier: s.colony.tier, pop: s.col.length, storyteller: s.colony.storyteller, iron: !!s.colony.iron, difficulty: s.colony.difficulty || null,
    lastPlayed: now(), ...extra,
  };
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
async function nextSlot(colonyId, iron = false) {
  if (iron) return 'a';   // Ironhold: one slot, overwritten in place (an IndexedDB put is atomic and read back)
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

/** Write the older slot of a colony; resolves once committed, verified and the index is updated. */
export function writeSlot(colonyId, bytes, card) {
  return serial(async () => {
    const { header } = readHeader(bytes);
    const known = cardById(colonyId);
    if (!known) { const why = colonyRoom(); if (why) throw new Error(why); }
    const iron = !!((card && card.iron) || (known && known.iron));
    const which = await nextSlot(colonyId, iron);
    const rec = { bytes, tick: header.tick, day: dayOf(header.tick), savedAt: now(), crc: header.crc };
    const prev = known || {};
    const meta = { ...prev, ...card, id: colonyId, newest: which, size: bytes.length, bytes: bytes.length };
    if (!meta.createdAt) meta.createdAt = now();   // the backup prompt's clock starts here (11.5)
    delete meta.missing;
    if (iron) meta.iron = true;
    if (await useIdb()) {
      try { await idbPutMany([['slots', `${colonyId}:${which}`, rec], ['meta', colonyId, meta]]); } catch (e) { if (isQuota(e)) alert('quota'); throw e; }
      const back = await idbGet('slots', `${colonyId}:${which}`);
      if (!back || !back.bytes || back.bytes.length !== bytes.length || crc32(back.bytes.subarray(HEADER_BYTES)) !== header.crc) throw new Error('The save could not be verified.');
    } else {
      const l = ls(); if (!l) throw new Error('This browser has no storage for saves.');
      await storageMode();
      try { l.setItem(fallbackKey(colonyId, which), blobToText(bytes)); } catch (e) { if (isQuota(e)) alert('quota'); throw e; }
    }
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
    if (isIron(colonyId)) return null;   // Ironhold keeps no backups (11.5)
    if (!(await useIdb())) return null;
    const { header } = readHeader(bytes);
    const rec = { bytes, tick: header.tick, day: dayOf(header.tick), savedAt: now(), crc: header.crc };
    const prev = cardById(colonyId);
    const puts = [['slots', `${colonyId}:dawn`, rec]];
    let meta = null;
    if (prev) { meta = { ...prev, id: colonyId, dawnTick: header.tick, dawnDay: dayOf(header.tick), dawnSavedAt: rec.savedAt }; delete meta.missing; puts.push(['meta', colonyId, meta]); }
    try { await idbPutMany(puts); } catch (e) { if (isQuota(e)) alert('quota'); throw e; }
    const back = await idbGet('slots', `${colonyId}:dawn`);
    if (!back || !back.bytes || back.bytes.length !== bytes.length || crc32(back.bytes.subarray(HEADER_BYTES)) !== header.crc) throw new Error('The dawn backup could not be verified.');
    if (meta) upsertCard(meta);
    return { which: 'dawn', tick: header.tick, size: bytes.length };
  });
}
/** The dawn backup of a colony, or null. */
export async function readDawn(colonyId) {
  if (isIron(colonyId)) return null;
  if (!(await useIdb())) return null;
  try { return await pick(colonyId, 'dawn'); } catch (_) { return null; }
}

/** Synchronous emergency save on pagehide / hidden (RLE + base64 into ec2.quick). */
export function quickSave(s) {
  const l = ls(); if (!l) return false;
  try {
    const { header, payload } = snapshot(s);
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
  return { bytes: slot.bytes, text: blobToText(slot.bytes), filename: `${safeName(card.name)}-y${yearOf(slot.tick) + 1}d${dayOfSeason(slot.tick) + 1}.ecsave` };
}

/** Validate a blob (or its text form) and read its card fields without building a state. */
export async function peekBlob(input) {
  const bytes = typeof input === 'string' ? textToBlob(input) : input;
  const { header, payload } = await decodeBlob(bytes);
  if (header.stateVersion > STATE_VERSION) throw new Error('This colony was saved by a newer version of the game.');
  let ent;
  try { ent = JSON.parse(unframePayload(payload).entities); } catch (_) { throw new Error('This save is damaged (its contents could not be read).'); }
  const m = ent.meta || {}, c = ent.colony || {};
  const iron = c.iron === true || c.difficulty === 'ironhold';
  return { bytes, id: m.id || null, name: m.name || 'Imported hold', tick: header.tick, day: dayOf(header.tick), pop: Array.isArray(ent.col) ? ent.col.length : 0,
    stateVersion: header.stateVersion, iron, tier: c.tier | 0 };
}

/** Import a blob or its text form. Throws a player-readable error on a bad file. */
export async function importBlob(input, card = {}) {
  const p = await peekBlob(input);
  const full = colonyRoom(); if (full) throw new Error(full);
  const taken = (id) => readIndex().some((c) => c.id === id);
  let id = card.id || p.id || 'imp' + crc32(p.bytes).toString(36);
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) id = 'imp' + crc32(p.bytes).toString(36);
  if (taken(id)) { const base = id.slice(0, 32); let k = 2; while (taken(`${base}-${k}`)) k++; id = `${base}-${k}`; }
  await writeSlot(id, p.bytes, { name: p.name, pop: p.pop, tier: p.tier, ...card, iron: p.iron || !!card.iron, id, day: p.day, year: yearOf(p.tick), dayOfSeason: dayOfSeason(p.tick), lastPlayed: now() });
  return id;
}

export async function deleteColony(colonyId) {
  if (await useIdb()) { for (const w of ['a', 'b', 'dawn']) await idbDelete('slots', `${colonyId}:${w}`); await idbDelete('meta', colonyId); }
  const l = ls();
  if (l) {
    l.removeItem(fallbackKey(colonyId, 'a')); l.removeItem(fallbackKey(colonyId, 'b'));
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
