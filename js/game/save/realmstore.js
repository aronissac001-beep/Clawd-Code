// The realm store and the world index (EMBERCROWN-WORLD.md 9.2, G3; step W2.2; owner A, record format L in
// js/game/realm/record.js). IndexedDB store `realm` (version 3, key: world id), ec2.r.<wid> (base64) in the
// localStorage fallback. Every hold founded in a world shares its record; dawn backups and exports embed a copy
// (EC3 flags bit 1, slots.js). The record is never rewritten except by W3.7.
//
//   writeRealm(realmOrBytes)         -> { wid, size, crc, bytes }   written, read back and every section CRC-checked
//                                       (world creation lists the world only after this resolves)
//   readRealmBytes(wid)              -> bytes | null
//   resolveRealm({ ref, colonyId, embedded, params })
//                                    -> { realm, bytes, from: 'store' | 'embedded' | 'dawn' | 'regen' }
//                                     | { realm: null, from: 'missing', text }
//       the fallback order of 9.2: the store, the blob's own embedded copy, the dawn blob's copy, then regeneration
//       with the current generator (ref.params), accepted only if all 3 CRCs match. A copy that worked is written
//       back when the store's record is missing or damaged. When none works the hold still loads: `text` is the
//       World tab line and the sim keeps its realm deltas only (caravans, raids and letters fall back, 9.2).
//   realmResolver(colonyId)          -> async ({ ref, embedded }) -> the same, for the load path (9.3 step 2)
//   deleteRealm(wid, { force })      -> { deleted, holds }   refused (deleted false) while holds use the world, unless force
//   World index (`meta`, key world:<wid>; ec2.w.<wid> in the fallback): { wid, name, size, year, holds: [[slot, rx, ry]] }
//   readWorld(wid) / listWorlds() / writeWorld(row) / noteHold(wid, slot, rx, ry, info) / dropHold(slot)
//   rebuildWorldIndex()              -> [row]   from the colony cards' and slots' realm fields (when the rows are lost)
// W3.7, history for W2-era worlds (the one rewrite of a record, 9.2):
//   holdNeedsHistory(s, { on })      a hold founded in a world before history (s.realm, embarkYear 0), HISTORY on
//   growRealm(realm, { holds, frame, now, budgetMs, progress })
//                                    -> { realm, bytes }   record.js historyLater over the stored fields with every
//                                       embarked hold's region settled and empty (the world index, the colony cards
//                                       and `holds` [[rx, ry]]), chunked like migrate5.migrateHold, then written over
//                                       the old record (writeRealm: read back, CRC-checked) and the row's year set
//   adoptHistory(s, realm)           the hold takes the grown record: s.realm.crc, embarkYear = the history's years,
//                                       year = embarkYear + the hold's game years, the five roles bound as in 9.4
//                                       step 4 (factions.js bindRoles; goodwill untouched), the liege, s.rt.realm.
//                                       Nothing else in the state changes.
//   upgradeHold(s, { colonyId, embedded, frame, now, budgetMs, progress, on })
//                                    -> null (nothing to do) | { from: 'grown' | 'grew' | 'missing', realm }
//       the loader's one call, after loadBlob and before play: the store's record already grown by another hold
//       of the world ('grown': resolveRealm serves it by its `base`), else the hold's record grown now ('grew');
//       a missing record changes nothing (the hold loads as today, 9.2).
import { idbGet, idbKeys, idbPutMany, idbDelete } from './idb.js';
import { toBase64, fromBase64, blobKind, decodeAny, unframePayload3, FLAG_REALM } from './codec.js';
import { storeBackend as B, listColonies, readSlot, readDawn } from './slots.js';
import { peekEntities } from './colonysave.js';
import { REALM_TEXT } from './backups.js';
import { encodeRecord, decodeRecord, readRecordHeader, recordFits, recordParts, refOfHeader, isRecord, needsHistory, hasHistory, grewFrom, historyLater } from '../realm/record.js';
import { buildRealm } from '../realm/gen.js';
import { HISTORY } from '../core/flags.js';
import { yearOf } from '../core/time.js';
import { bindRoles } from '../colony/factions.js';

export const realmKey = (wid) => `ec2.r.${wid >>> 0}`;
export const worldKey = (wid) => `world:${wid >>> 0}`;
export const worldLocalKey = (wid) => `ec2.w.${wid >>> 0}`;
export const isWorldKey = (k) => typeof k === 'string' && k.startsWith('world:');
export { REALM_TEXT };

let regenerate = (params) => buildRealm(params);
/** Tests: replace the generator the last fallback runs (null restores buildRealm). */
export function setRealmRegenerator(fn) { regenerate = typeof fn === 'function' ? fn : (params) => buildRealm(params); }

const confirmed = new Map();   // wid -> crc key the store holds, confirmed this page
const crcKey = (crc) => crc.map((c) => c >>> 0).join(',');
/** Forget what this page confirmed (tests; slots.setBackends calls it with resetIdb). */
export function forgetRealms() { confirmed.clear(); }

async function putBytes(wid, bytes, h) {
  if (await B.useIdb()) {
    try { await idbPutMany([['realm', wid >>> 0, { bytes, wid: wid >>> 0, crc: h.crc, savedAt: B.now() }]]); } catch (e) { if (B.isQuota(e)) B.alert('quota'); throw e; }
    return;
  }
  const l = B.ls(); if (!l) throw new Error('This browser has no storage for saves.');
  try { l.setItem(realmKey(wid), toBase64(bytes)); } catch (e) { if (B.isQuota(e)) B.alert('quota'); throw e; }
}
export async function readRealmBytes(wid) {
  if (await B.useIdb()) {
    try { const v = await idbGet('realm', wid >>> 0); return v && v.bytes ? (v.bytes instanceof Uint8Array ? v.bytes : new Uint8Array(v.bytes)) : null; } catch (_) { return null; }
  }
  const l = B.ls(); const t = l && l.getItem(realmKey(wid));
  if (!t) return null;
  try { return fromBase64(t); } catch (_) { return null; }
}

/** Store a realm (object or record bytes); read it back and check it. Throws REALM_TEXT.unverified when it cannot. */
export async function writeRealm(input) {
  const bytes = input instanceof Uint8Array ? input : await encodeRecord(input);
  const h = readRecordHeader(bytes);
  await putBytes(h.wid, bytes, h);
  const back = await readRealmBytes(h.wid);
  let ok = !!back && back.length === bytes.length;
  if (ok) { try { const r = await decodeRecord(back); ok = r.wid === h.wid; } catch (_) { ok = false; } }
  if (!ok) throw new Error(REALM_TEXT.unverified);
  confirmed.set(h.wid, crcKey(h.crc));
  return { wid: h.wid, size: bytes.length, crc: h.crc.slice(), bytes };
}
/** Is a record that fits `ref` in the store (and whole)? Remembered once confirmed. */
export async function realmStored(ref) {
  if (!ref) return false;
  if (Array.isArray(ref.crc) && confirmed.get(ref.wid >>> 0) === crcKey(ref.crc)) return true;
  const b = await readRealmBytes(ref.wid);
  if (!b) return false;
  try { const h = readRecordHeader(b); if (!recordFits(h, ref)) return false; await decodeRecord(b); confirmed.set(h.wid, crcKey(h.crc)); return true; } catch (_) { return false; }
}

/** The embedded realm record of a save blob (EC3 flags bit 1), or null. */
export async function embeddedRealmOf(bytes) {
  if (blobKind(bytes) !== 'EC3') return null;
  const { header, payload } = await decodeAny(bytes);
  if (!(header.flags & FLAG_REALM)) return null;
  return unframePayload3(payload, (header.flags & 1) !== 0, true).realm;
}

async function tryRecord(bytes, ref) {
  if (!bytes || !isRecord(bytes)) return null;
  try { const h = readRecordHeader(bytes); if (!recordFits(h, ref)) return null; return await decodeRecord(bytes); } catch (_) { return null; }
}
/** The fallback order of 9.2 (see the head of this file). `ref` is the hold's { wid, crc, params }. */
export async function resolveRealm({ ref, colonyId = null, embedded = null, params = null } = {}) {
  if (!ref || !Number.isInteger(ref.wid)) return { realm: null, from: 'missing', text: REALM_TEXT.missing };
  let storeState = 'missing';
  const stored = await readRealmBytes(ref.wid);
  if (stored) {
    const r = await tryRecord(stored, ref);
    if (r) { confirmed.set(r.wid, crcKey(readRecordHeader(stored).crc)); return { realm: r, bytes: stored, from: 'store' }; }
    storeState = 'damaged';
    try {
      const h = readRecordHeader(stored);
      if (h.wid === (ref.wid >>> 0) && Array.isArray(ref.crc)) {
        const g = await decodeRecord(stored);
        storeState = 'other';
        // W3.7: another hold of this world grew the record; this hold still references the history-less one
        if (grewFrom(g, ref)) { confirmed.set(g.wid, crcKey(h.crc)); return { realm: g, bytes: stored, from: 'store', grown: true }; }
      }
    } catch (_) { storeState = 'damaged'; }
  }
  let realm = null, bytes = null, from = null;
  if ((realm = await tryRecord(embedded, ref))) { bytes = embedded; from = 'embedded'; }
  if (!realm && colonyId) {
    const dawn = await readDawn(colonyId).catch(() => null);
    const e = dawn ? await embeddedRealmOf(dawn.bytes).catch(() => null) : null;
    if ((realm = await tryRecord(e, ref))) { bytes = e; from = 'dawn'; }
  }
  const p = params || ref.params;
  if (!realm && p && Array.isArray(ref.crc)) {
    try {
      const r = regenerate(p);
      const crc = recordParts(r).crc;
      if (r.wid === (ref.wid >>> 0) && crc.every((c, k) => c === (ref.crc[k] >>> 0))) { bytes = await encodeRecord(r); realm = await decodeRecord(bytes); from = 'regen'; }
    } catch (_) { realm = null; }
  }
  if (!realm) return { realm: null, from: 'missing', text: REALM_TEXT.missing };
  if (storeState !== 'other') { try { await writeRealm(bytes); } catch (_) { /* the hold still loads; the next load retries */ } }
  return { realm, bytes, from };
}
export const realmResolver = (colonyId) => ({ ref, embedded = null, params = null } = {}) => resolveRealm({ ref, colonyId, embedded, params });

// ---- World index ------------------------------------------------------------------------------------
const cleanRow = (row) => ({ wid: row.wid >>> 0, name: String(row.name || 'Unnamed world').slice(0, 24), size: row.size | 0, year: row.year | 0,
  holds: (Array.isArray(row.holds) ? row.holds : []).filter((x) => Array.isArray(x) && typeof x[0] === 'string').map((x) => [x[0], x[1] | 0, x[2] | 0]) });
export async function readWorld(wid) {
  if (await B.useIdb()) { try { const v = await idbGet('meta', worldKey(wid)); return v ? cleanRow(v) : null; } catch (_) { return null; } }
  const l = B.ls(); if (!l) return null;
  try { const v = JSON.parse(l.getItem(worldLocalKey(wid)) || 'null'); return v ? cleanRow(v) : null; } catch (_) { return null; }
}
export async function writeWorld(row) {
  const r = cleanRow(row);
  if (await B.useIdb()) { await idbPutMany([['meta', worldKey(r.wid), r]]); return r; }
  const l = B.ls(); if (!l) return r;
  try { l.setItem(worldLocalKey(r.wid), JSON.stringify(r)); } catch (e) { if (B.isQuota(e)) B.alert('quota'); }
  return r;
}
async function worldIds() {
  if (await B.useIdb()) { try { return (await idbKeys('meta')).filter(isWorldKey).map((k) => Number(k.slice(6)) >>> 0); } catch (_) { return []; } }
  const l = B.ls(); const out = [];
  try { for (let k = 0; l && k < l.length; k++) { const x = l.key(k); if (x && x.startsWith('ec2.w.')) out.push(Number(x.slice(6)) >>> 0); } } catch (_) { /* private modes */ }
  return out;
}
/** Every world row, by name then wid. */
export async function listWorlds() {
  const rows = [];
  for (const wid of (await worldIds()).sort((a, b) => a - b)) { const r = await readWorld(wid); if (r) rows.push(r); }
  return rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.wid - b.wid));
}
/** Record that hold `slot` (a colony id) sits in region (rx, ry) of world `wid`; info fills name, size, year. */
export async function noteHold(wid, slot, rx, ry, info = {}) {
  const row = (await readWorld(wid)) || { wid, name: info.name, size: info.size, year: info.year, holds: [] };
  for (const k of ['name', 'size', 'year']) if (info[k] !== undefined) row[k] = info[k];
  row.holds = row.holds.filter((x) => x[0] !== slot);
  row.holds.push([slot, rx | 0, ry | 0]);
  row.holds.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return writeWorld(row);
}
/** A hold was deleted: it leaves every world row (the record stays until its world is deleted). */
export async function dropHold(slot) {
  for (const wid of await worldIds()) {
    const row = await readWorld(wid);
    if (row && row.holds.some((x) => x[0] === slot)) { row.holds = row.holds.filter((x) => x[0] !== slot); await writeWorld(row); }
  }
}
/** The realm reference of a colony: its card's wid/rx/ry, else its newest slot's ENTITIES `realm`. */
async function refOfColony(card) {
  if (card && Number.isInteger(card.wid)) return { wid: card.wid >>> 0, rx: card.rx | 0, ry: card.ry | 0, params: card.realmParams || null };
  const slot = await readSlot(card.id).catch(() => null) || await readDawn(card.id).catch(() => null);
  if (!slot) return null;
  try { const { ent } = await peekEntities(slot.bytes); const r = ent && ent.realm; return r && Number.isInteger(r.wid) ? { wid: r.wid >>> 0, rx: r.rx | 0, ry: r.ry | 0, params: r.params || null, year: r.year } : null; } catch (_) { return null; }
}
/** Rebuild the world rows from the colonies (9.2: the index is rebuilt from the slots' realm fields if it is lost). */
export async function rebuildWorldIndex() {
  const rows = new Map();
  for (const card of listColonies()) {
    const ref = await refOfColony(card);
    if (!ref) continue;
    let row = rows.get(ref.wid) || (await readWorld(ref.wid));
    if (!row) {
      let name = ref.params && ref.params.name, size = 0;
      const b = await readRealmBytes(ref.wid);
      if (b) { try { const h = readRecordHeader(b); size = h.size; if (!name) name = (await decodeRecord(b)).params.name; } catch (_) { /* name stays */ } }
      row = { wid: ref.wid, name, size, year: ref.year | 0, holds: [] };
    }
    row.holds = row.holds.filter((x) => x[0] !== card.id).concat([[card.id, ref.rx, ref.ry]]);
    rows.set(ref.wid, row);
  }
  const out = [];
  for (const row of rows.values()) out.push(await writeWorld(row));
  return out;
}

/** Delete a world's record and row: refused while holds use it, unless force (the confirmation listed them, 9.2). */
export async function deleteRealm(wid, { force = false } = {}) {
  const row = await readWorld(wid);
  const holds = row ? row.holds.map((x) => x[0]) : [];
  for (const c of listColonies()) if (c.wid === (wid >>> 0) && !holds.includes(c.id)) holds.push(c.id);
  if (holds.length && !force) return { deleted: false, holds };
  if (await B.useIdb()) { await idbDelete('realm', wid >>> 0); await idbDelete('meta', worldKey(wid)); }
  const l = B.ls(); if (l) { l.removeItem(realmKey(wid)); l.removeItem(worldLocalKey(wid)); }
  confirmed.delete(wid >>> 0);
  return { deleted: true, holds };
}

/** The reference a hold keeps (s.realm.wid and the 3 CRCs) for a record. */
export const refOfRecord = (bytes) => refOfHeader(readRecordHeader(bytes));

// ---- W3.7: history for W2-era worlds --------------------------------------------------------------------------
/** A hold founded in a world before history (embarkYear 0) that should take it: HISTORY on (or `on`), not fallen. */
export function holdNeedsHistory(s, { on = HISTORY === true } = {}) {
  const r = s && s.realm;
  return !!(on && r && Number.isInteger(r.wid) && Array.isArray(r.crc) && (r.embarkYear | 0) === 0 && !(s.colony && s.colony.fallen === true));
}
/** The regions [rx, ry] of every hold embarked in world `wid`: its index row, the colony cards, then `extra`. */
async function heldRegions(wid, extra = []) {
  const out = [], row = await readWorld(wid);
  if (row) for (const h of row.holds) out.push([h[1], h[2]]);
  for (const c of listColonies()) if (Number.isInteger(c.wid) && (c.wid >>> 0) === (wid >>> 0)) out.push([c.rx | 0, c.ry | 0]);
  for (const h of extra) if (Array.isArray(h)) out.push([h[0] | 0, h[1] | 0]);
  return out;
}
/** Grow a history-less world (record.js historyLater), chunked, and write it over its record. Returns { realm, bytes } (realm decoded from the bytes written). */
export async function growRealm(old, { holds = [], frame = null, now = null, budgetMs = 30, progress = null } = {}) {
  if (!needsHistory(old)) throw new Error('growRealm: this world has its history already');
  const n = old.n, settled = [];
  for (const [rx, ry] of await heldRegions(old.wid, holds)) if (rx >= 0 && ry >= 0 && rx < n && ry < n) settled.push(ry * n + rx);
  const it = historyLater(old, settled);
  let t0 = now ? now() : 0, r;
  for (;;) {
    r = it.next();
    if (r.done) break;
    if (progress) progress(r.value);
    if (frame && (!now || now() - t0 >= budgetMs)) { await frame(); if (now) t0 = now(); }
  }
  const w = await writeRealm(r.value);
  const realm = await decodeRecord(w.bytes);
  const row = await readWorld(realm.wid);
  if (row) { row.year = Math.max(row.year | 0, realm.years | 0); await writeWorld(row); }
  return { realm, bytes: w.bytes };
}
/** The hold takes its world's grown record (see the head of this file). Returns s.realm. */
export function adoptHistory(s, realm) {
  if (!s || !s.realm || !realm || !hasHistory(realm) || (realm.wid >>> 0) !== (s.realm.wid >>> 0)) throw new Error('adoptHistory: not this hold\'s world, or a world without history');
  const f = s.realm, years = realm.years | 0;
  f.crc = recordParts(realm).crc.map((c) => c >>> 0);
  f.embarkYear = years;
  f.year = years + yearOf(s.tick);
  if (!s.rt) s.rt = {};
  s.rt.realm = realm;
  f.civ = null; f.bind = {};
  const bind = bindRoles(s, realm);   // hearthwatch: the nearest human kingdom in reach (9.4 step 4), goodwill untouched
  f.civ = bind && Number.isInteger(bind.hearthwatch) ? bind.hearthwatch : null;
  return f;
}
/** The loader's call for W3.7 (see the head of this file). */
export async function upgradeHold(s, { colonyId = (s && s.id) || null, embedded = null, frame = null, now = null, budgetMs = 30, progress = null, on } = {}) {
  if (!holdNeedsHistory(s, on === undefined ? {} : { on })) return null;
  const ref = { wid: s.realm.wid >>> 0, crc: s.realm.crc.map((c) => c >>> 0), params: s.realm.params || null };
  const got = await resolveRealm({ ref, colonyId, embedded });
  if (!got.realm) return { from: 'missing', realm: null, text: got.text };
  let realm = got.realm, from = 'grown';
  if (!got.grown) {
    if (!needsHistory(realm)) return hasHistory(realm) ? (adoptHistory(s, realm), { from: 'store', realm }) : null;
    ({ realm } = await growRealm(realm, { holds: [[s.realm.rx | 0, s.realm.ry | 0]], frame, now, budgetMs, progress }));
    from = 'grew';
  }
  adoptHistory(s, realm);
  return { from, realm };
}
