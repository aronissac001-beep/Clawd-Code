// IndexedDB access for colony saves (doc 11.2). Owner A. Skeleton for Stage 0: promise wrappers
// over database `ec2` version 1 with stores `slots` and `meta`. Nothing is opened at import.
// The whole module is a no-op where IndexedDB is missing (Node, some private modes): callers
// check idbAvailable() and use the localStorage fallback in slots.js.
// Version 2 (EMBERCROWN-FORTRESS.md 5.5, Stage Z1 step E8) adds the store `pristine` (key: colony id): the
// upgrade only creates missing stores, so a version 1 database keeps every slot and card.

export const DB_NAME = 'ec2';
export const DB_VERSION = 2;
export const STORES = Object.freeze(['slots', 'meta', 'pristine']);

let dbPromise = null;
let factory = null;   // injectable for tests (an IDBFactory)

export function setIdbFactory(f) { factory = f; dbPromise = null; }
const idbf = () => factory || (typeof indexedDB !== 'undefined' ? indexedDB : null);
export const idbAvailable = () => !!idbf();

function req2p(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }

/** Open (and create on first use) the database. Rejects when IndexedDB is unavailable or blocked. */
export function openDb() {
  if (dbPromise) return dbPromise;
  const f = idbf();
  if (!f) return Promise.reject(new Error('IndexedDB unavailable'));
  dbPromise = new Promise((res, rej) => {
    let r;
    try { r = f.open(DB_NAME, DB_VERSION); } catch (e) { rej(e); return; }
    r.onupgradeneeded = () => { const db = r.result; for (const st of STORES) if (!db.objectStoreNames.contains(st)) db.createObjectStore(st); };
    r.onsuccess = () => { const db = r.result; db.onversionchange = () => { db.close(); dbPromise = null; }; res(db); };
    r.onerror = () => { dbPromise = null; rej(r.error); };
    r.onblocked = () => { dbPromise = null; rej(new Error('IndexedDB blocked')); };
  });
  return dbPromise;
}

/** Close the connection (tests, eviction simulation). */
export async function closeDb() { if (!dbPromise) return; try { (await dbPromise).close(); } catch (_) { /* already gone */ } dbPromise = null; }

export async function idbGet(store, key) {
  const db = await openDb();
  return req2p(db.transaction(store, 'readonly').objectStore(store).get(key));
}
export async function idbKeys(store) {
  const db = await openDb();
  return req2p(db.transaction(store, 'readonly').objectStore(store).getAllKeys());
}
export async function idbDelete(store, key) {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  return txDone(tx);
}
/**
 * One readwrite transaction over both stores: puts = [[store, key, value], ...]. Resolves on
 * `complete` (11.4 step 3), so the caller updates ec2.index only after the data is committed.
 */
export async function idbPutMany(puts) {
  const db = await openDb();
  const tx = db.transaction(STORES.slice(), 'readwrite');
  for (const [store, key, val] of puts) tx.objectStore(store).put(val, key);
  return txDone(tx);
}
export const idbPut = (store, key, val) => idbPutMany([[store, key, val]]);

function txDone(tx) {
  return new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error || new Error('transaction aborted'));
  });
}

/** Delete the whole database (Settings > Storage, and the eviction test). */
export async function idbDeleteDatabase() {
  await closeDb();
  const f = idbf(); if (!f) return;
  await new Promise((res) => { const r = f.deleteDatabase(DB_NAME); r.onsuccess = r.onerror = r.onblocked = () => res(); });
}
