// Contract C14 (owner A; reviewer I; provisional until the 1a fun review): the storage API
// (doc 11.2, 11.4, 11.5). Skeleton for Stage 0: every function exists with its final signature;
// the paths that need a real device (persist(), the share sheet) are stubs.
//
//   listColonies()                 -> [card]            (from ec2.index, so the title draws at once)
//   readSlot(colonyId, which?)     -> { bytes, tick, day, savedAt, crc, which } | null  (newest when which is omitted)
//   writeSlot(colonyId, bytes, card) -> { which }       (the older of a/b; meta and ec2.index after commit)
//   quickSave(s)                   -> boolean           (sync; ec2.quick; false on quota error)
//   promoteQuick()                 -> colonyId | null   (on launch: a newer quick-save becomes a slot)
//   exportBlob(colonyId)           -> { bytes, text, filename }
//   importBlob(bytesOrText)        -> colonyId          (validates magic, version and CRC; new id on clash)
//   persistState()                 -> 'protected' | 'may be cleared' | 'unknown'
//   deleteColony(colonyId)
// Real-time stamps (savedAt) are fine here: saving never changes sim state (11.4).

import { idbAvailable, idbGet, idbPutMany, idbDelete } from './idb.js';
import { readHeader, blobToText, textToBlob, encodeBlobSync, crc32, COMP } from './codec.js';
import { snapshot } from './colonysave.js';
import { dayOf, yearOf, dayOfSeason } from '../core/time.js';

export const MAX_COLONIES = 8;
export const KEY_INDEX = 'ec2.index';
export const KEY_SETTINGS = 'ec2.settings';
export const KEY_QUICK = 'ec2.quick';
export const fallbackKey = (id, which) => `ec2.c.${id}.${which}`;

// ---- Backends (injectable for tests) ------------------------------------------------------------
let local = null;
let now = () => Date.now();
export function setBackends({ localStorage: ls, clock } = {}) { if (ls !== undefined) local = ls; if (clock) now = clock; }
const ls = () => { if (local) return local; try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (_) { return null; } };
const useIdb = () => idbAvailable();

/** Alerts raised by storage (the UI subscribes: 'limited' | 'quota'). */
const alertFns = [];
export function onStorageAlert(fn) { alertFns.push(fn); }
const alert = (kind) => { for (const fn of alertFns) fn(kind); };

// ---- Index ---------------------------------------------------------------------------------------
function readIndex() {
  const l = ls(); if (!l) return [];
  try { const v = JSON.parse(l.getItem(KEY_INDEX) || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; }
}
function writeIndex(cards) { const l = ls(); if (l) l.setItem(KEY_INDEX, JSON.stringify(cards)); }
function upsertCard(card) {
  const cards = readIndex().filter((c) => c.id !== card.id);
  cards.unshift(card);
  writeIndex(cards.slice(0, MAX_COLONIES));
}

export function listColonies() { return readIndex(); }

/** A colony card (11.2 `meta`) from a live state. */
export function cardOf(s, extra = {}) {
  return {
    id: s.id, name: s.name, banner: s.colony.banner || null, day: dayOf(s.tick), year: yearOf(s.tick), dayOfSeason: dayOfSeason(s.tick),
    tier: s.colony.tier, pop: s.col.length, storyteller: s.colony.storyteller, iron: s.colony.iron, lastPlayed: now(), ...extra,
  };
}

// ---- Slots ------------------------------------------------------------------------------------
export async function readSlot(colonyId, which) {
  const pick = async (w) => {
    if (useIdb()) { const v = await idbGet('slots', `${colonyId}:${w}`); return v ? { ...v, which: w } : null; }
    const l = ls(); const t = l && l.getItem(fallbackKey(colonyId, w));
    if (!t) return null;
    const bytes = textToBlob(t); const { header } = readHeader(bytes);
    return { bytes, tick: header.tick, day: dayOf(header.tick), savedAt: 0, crc: header.crc, which: w };
  };
  if (which) return pick(which);
  const a = await pick('a'), b = await pick('b');
  if (a && b) return a.tick >= b.tick ? a : b;
  return a || b;
}

/** Write the older slot of a colony; resolves once committed and the index is updated. */
export async function writeSlot(colonyId, bytes, card) {
  const { header } = readHeader(bytes);
  const card0 = readIndex().find((c) => c.id === colonyId);
  const which = card0 && card0.newest === 'a' ? 'b' : 'a';
  const rec = { bytes, tick: header.tick, day: dayOf(header.tick), savedAt: now(), crc: header.crc };
  const meta = { ...card, id: colonyId, newest: which, size: bytes.length, bytes: bytes.length };
  if (useIdb()) {
    await idbPutMany([['slots', `${colonyId}:${which}`, rec], ['meta', colonyId, meta]]);
    const back = await idbGet('slots', `${colonyId}:${which}`);
    if (!back || crc32(back.bytes.subarray(21)) !== header.crc) throw new Error('save verify failed');
  } else {
    const l = ls(); if (!l) throw new Error('no storage');
    if (!readIndex().some((c) => c.id === colonyId) && readIndex().length >= 1) alert('limited');
    l.setItem(fallbackKey(colonyId, which), blobToText(bytes));
  }
  upsertCard(meta);
  return { which };
}

/** Synchronous emergency save on pagehide / hidden (RLE + base64 into ec2.quick). */
export function quickSave(s) {
  const l = ls(); if (!l) return false;
  try {
    const { header, payload } = snapshot(s);
    const text = blobToText(encodeBlobSync(header, payload, COMP.RLE));
    l.setItem(KEY_QUICK, JSON.stringify({ colonyId: s.id, tick: s.tick, text }));
    return true;
  } catch (e) {
    if (e && (e.name === 'QuotaExceededError' || e.code === 22)) { alert('quota'); return false; }
    throw e;
  }
}

/** On launch: a quick-save newer than its colony's newest slot is written into the older slot. */
export async function promoteQuick() {
  const l = ls(); if (!l) return null;
  const raw = l.getItem(KEY_QUICK); if (!raw) return null;
  let q; try { q = JSON.parse(raw); } catch (_) { l.removeItem(KEY_QUICK); return null; }
  let bytes; try { bytes = textToBlob(q.text); readHeader(bytes); } catch (_) { l.removeItem(KEY_QUICK); return null; }
  const newest = await readSlot(q.colonyId);
  if (!newest || q.tick > newest.tick) {
    const card = readIndex().find((c) => c.id === q.colonyId) || { id: q.colonyId, name: 'Recovered hold' };
    await writeSlot(q.colonyId, bytes, card);
  }
  l.removeItem(KEY_QUICK);
  return q.colonyId;
}

export async function exportBlob(colonyId) {
  const slot = await readSlot(colonyId);
  if (!slot) throw new Error('No save found for this colony.');
  const card = readIndex().find((c) => c.id === colonyId) || { name: 'hold', year: 0, dayOfSeason: 0 };
  const safe = String(card.name || 'hold').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'hold';
  return { bytes: slot.bytes, text: blobToText(slot.bytes), filename: `${safe}-y${(card.year || 0) + 1}d${(card.dayOfSeason || 0) + 1}.ecsave` };
}

/** Import a blob or its text form. Throws a player-readable error on a bad file. */
export async function importBlob(input, card = {}) {
  const bytes = typeof input === 'string' ? textToBlob(input) : input;
  const { header } = readHeader(bytes);
  if (readIndex().length >= MAX_COLONIES) throw new Error(`You already have ${MAX_COLONIES} colonies. Delete one first.`);
  let id = card.id || 'imp' + crc32(bytes).toString(36);
  while (readIndex().some((c) => c.id === id)) id += 'x';
  await writeSlot(id, bytes, { name: 'Imported hold', ...card, id, day: dayOf(header.tick), lastPlayed: now() });
  return id;
}

export async function deleteColony(colonyId) {
  if (useIdb()) { await idbDelete('slots', `${colonyId}:a`); await idbDelete('slots', `${colonyId}:b`); await idbDelete('slots', `${colonyId}:dawn`); await idbDelete('meta', colonyId); }
  const l = ls(); if (l) { l.removeItem(fallbackKey(colonyId, 'a')); l.removeItem(fallbackKey(colonyId, 'b')); }
  writeIndex(readIndex().filter((c) => c.id !== colonyId));
}

/** navigator.storage.persist() answer for Settings > Storage. Requested on the first save. */
export async function persistState() {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage || !navigator.storage.persist) return 'unknown';
    if (await navigator.storage.persisted()) return 'protected';
    return (await navigator.storage.persist()) ? 'protected' : 'may be cleared';
  } catch (_) { return 'unknown'; }
}
