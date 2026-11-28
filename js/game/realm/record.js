// The realm record (EMBERCROWN-WORLD.md 9.2, G3; format owner L, store owner A in js/game/save/realmstore.js).
//
//   'ECR\0' | u16 recVersion (1) | u32 wid | u16 size | u16 genVersion | u16 years | u8 compression (1 deflate-raw, 2 RLE)
//           | u32[3] crc (fields, tables, events) | u32 byteLength (raw payload) | payload        (33-byte header)
//   payload = compress( FIELDS (the LAYERS of gen.js in order, one byte a region, `site` u16 little-endian: 15 n^2 bytes)
//             | u32 len + TABLES (UTF-8 JSON { head, tables }) | u32 len + EVENTS (12-byte rows) )
//
//   encodeRecord(realm, comp?)   async -> bytes (deflate-raw where CompressionStream exists, else RLE)
//   encodeRecordSync(realm)      sync, RLE
//   recordParts(realm)           -> { fields, tables, events, crc: [3] } raw sections (regeneration compares the crc)
//   readRecordHeader(bytes)      -> { recVersion, wid, size, genVersion, years, comp, crc, byteLength }; throws when not a record
//   decodeRecord(bytes)          async -> the realm object of gen.js createRealm (realmHash equal to the encoded one);
//                                throws "damaged" when any section's CRC differs
//   recordFits(header, ref)      does a record header fit a hold's reference { wid, crc? } (9.2: wid and all 3 CRCs)
// W3.7, the recVersion path (history for W2-era worlds):
//   recVersion 1   W2.2: a world written before history existed (empty tables, no events, years 0)
//   recVersion 2   W3.7: the same layout; TABLES `head` may carry `base`, the 3 CRCs of the history-less record a
//                  W2-era world grew from, so a hold that still references the old CRCs finds the grown record
//   hasHistory(realm) / needsHistory(realm)   has the world its years of history / is it a world that should get them
//   historyLater(realm, settled)  generator ({ phase: 'history', year, of }): a NEW realm, the stored fields with the
//                                 history of 2.3 run over them (re-rolled as createRealm does), the regions `settled`
//                                 (indices: the embarked holds') held settled and empty (gen.js historyAround), and
//                                 `base` = the old record's CRCs; the old realm is not touched
//   grewFrom(realm, ref)          is `realm` the grown form of the record `ref` ({ wid, crc }) references?
// A record is rewritten only by this path (9.2), and only from a history-less one.
// The CRCs are over the raw sections, so a regeneration with the current generator is accepted only when it rebuilds
// the same bytes (9.2 fallback order). `head` keeps what the realm object holds beside its fields and tables.
import { crc32, deflateRaw, inflateRaw, rleEncode, rleDecode, hasDeflate, COMP } from '../save/codec.js';
import { LAYERS, historyAround } from './gen.js';
import { allocFields } from './fields.js';
import { checkHistory } from './history.js';
import { GEN } from '../../data/realm/params.js';

export const REC_MAGIC = Object.freeze([0x45, 0x43, 0x52, 0x00]);
/** 1: W2.2 (no history); 2: W3.7 (TABLES head may carry `base`). Readers take every version up to this one. */
export const REC_VERSION = 2;
export const REC_HEADER_BYTES = 33;
export const EVENT_BYTES = 12;
export const DAMAGED_TEXT = 'This world record is damaged.';
/** Bytes a region in FIELDS (1.1: 15). */
export const BYTES_PER_REGION = LAYERS.reduce((k, name) => k + (name === 'site' ? 2 : 1), 0);

const te = new TextEncoder(), td = new TextDecoder();
const isCrc3 = (a) => Array.isArray(a) && a.length === 3 && a.every((c) => Number.isInteger(c));

/** The FIELDS section: every layer in LAYERS order. */
export function fieldsBytes(realm) {
  const N = realm.n * realm.n, out = new Uint8Array(N * BYTES_PER_REGION);
  let o = 0;
  for (const name of LAYERS) {
    const a = realm.fields[name];
    if (!a || a.length !== N) throw new Error(`realm record: layer ${name} has the wrong size`);
    if (name === 'site') { for (let i = 0; i < N; i++) { const v = a[i]; out[o++] = v & 0xff; out[o++] = v >>> 8; } }
    else { out.set(new Uint8Array(a.buffer, a.byteOffset, N), o); o += N; }
  }
  return out;
}
/** The TABLES section: the realm's tables plus `head` (what else the realm object carries). */
export function tablesText(realm) {
  const head = { v: realm.v, gv: realm.gv, seed: realm.seed, params: realm.params, sides: realm.sides, seaLevel: realm.seaLevel,
    bands: realm.bands, plates: realm.plates, hotspots: realm.hotspots, falls: realm.falls, warnings: realm.warnings, rerolls: realm.rerolls };
  if (isCrc3(realm.base)) head.base = realm.base.map((c) => c >>> 0);   // only a grown record (W3.7): other TABLES bytes are as before
  return JSON.stringify({ head, tables: realm.tables });
}
/** The EVENTS section: a packed Uint8Array of 12-byte rows (W3.1), or the empty list of an unsettled world. */
export function eventsBytes(realm) {
  const ev = realm.events;
  if (ev instanceof Uint8Array) { if (ev.length % EVENT_BYTES) throw new Error('realm record: events are not 12-byte rows'); return ev; }
  if (!ev || !ev.length) return new Uint8Array(0);
  throw new Error('realm record: events must be a packed Uint8Array of 12-byte rows');
}
export function recordParts(realm) {
  const fields = fieldsBytes(realm), tables = te.encode(tablesText(realm)), events = eventsBytes(realm);
  return { fields, tables, events, crc: [crc32(fields), crc32(tables), crc32(events)] };
}

function frame(parts) {
  const { fields, tables, events } = parts, out = new Uint8Array(fields.length + 8 + tables.length + events.length), dv = new DataView(out.buffer);
  out.set(fields, 0); let o = fields.length;
  dv.setUint32(o, tables.length, true); out.set(tables, o + 4); o += 4 + tables.length;
  dv.setUint32(o, events.length, true); out.set(events, o + 4);
  return out;
}
function header(realm, parts, rawLen, comp, body) {
  const out = new Uint8Array(REC_HEADER_BYTES + body.length), dv = new DataView(out.buffer);
  out.set(REC_MAGIC, 0);
  dv.setUint16(4, REC_VERSION, true); dv.setUint32(6, realm.wid >>> 0, true); dv.setUint16(10, realm.n, true);
  dv.setUint16(12, realm.gv | 0, true); dv.setUint16(14, realm.years | 0, true); out[16] = comp;
  for (let k = 0; k < 3; k++) dv.setUint32(17 + 4 * k, parts.crc[k] >>> 0, true);
  dv.setUint32(29, rawLen, true);
  out.set(body, REC_HEADER_BYTES);
  return out;
}
export async function encodeRecord(realm, comp = hasDeflate() ? COMP.DEFLATE : COMP.RLE) {
  const parts = recordParts(realm), raw = frame(parts);
  const body = comp === COMP.DEFLATE ? await deflateRaw(raw) : comp === COMP.RLE ? rleEncode(raw) : raw;
  return header(realm, parts, raw.length, comp, body);
}
export function encodeRecordSync(realm, comp = COMP.RLE) {
  if (comp === COMP.DEFLATE) throw new Error('deflate is async');
  const parts = recordParts(realm), raw = frame(parts);
  return header(realm, parts, raw.length, comp, comp === COMP.RLE ? rleEncode(raw) : raw);
}

export const isRecord = (b) => b instanceof Uint8Array && b.length >= REC_HEADER_BYTES && REC_MAGIC.every((v, i) => b[i] === v);
export function readRecordHeader(bytes) {
  if (!isRecord(bytes)) throw new Error('Not a world record.');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const h = { recVersion: dv.getUint16(4, true), wid: dv.getUint32(6, true), size: dv.getUint16(10, true), genVersion: dv.getUint16(12, true),
    years: dv.getUint16(14, true), comp: bytes[16], crc: [0, 1, 2].map((k) => dv.getUint32(17 + 4 * k, true)), byteLength: dv.getUint32(29, true) };
  if (h.recVersion > REC_VERSION) throw new Error('This world record is from a newer version of the game.');
  return h;
}
/** Does a record header fit a hold's reference? { wid, crc: [3] } (crc optional: a reference without one fits by wid). */
export function recordFits(h, ref) {
  if (!h || !ref || (h.wid >>> 0) !== (ref.wid >>> 0)) return false;
  return !Array.isArray(ref.crc) || (ref.crc.length === 3 && ref.crc.every((c, k) => (c >>> 0) === h.crc[k]));
}
/** The reference a hold keeps to its record (s.realm: wid and the 3 CRCs, 9.2). */
export const refOfHeader = (h) => ({ wid: h.wid >>> 0, crc: h.crc.slice() });

function unframe(h, raw) {
  const N = h.size * h.size, flen = N * BYTES_PER_REGION;
  if (raw.length !== h.byteLength || raw.length < flen + 8) throw new Error(DAMAGED_TEXT);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const fields = raw.subarray(0, flen);
  const tl = dv.getUint32(flen, true); if (flen + 8 + tl > raw.length) throw new Error(DAMAGED_TEXT);
  const tables = raw.subarray(flen + 4, flen + 4 + tl);
  const el = dv.getUint32(flen + 4 + tl, true); if (flen + 8 + tl + el !== raw.length || el % EVENT_BYTES) throw new Error(DAMAGED_TEXT);
  const events = raw.subarray(flen + 8 + tl);
  const parts = { fields, tables, events };
  const crc = [crc32(fields), crc32(tables), crc32(events)];
  if (crc.some((c, k) => c !== h.crc[k])) throw new Error(DAMAGED_TEXT);
  return parts;
}
function build(h, parts) {
  const n = h.size, N = n * n, f = allocFields(n), src = parts.fields;
  let o = 0;
  for (const name of LAYERS) {
    const a = f[name];
    if (name === 'site') { for (let i = 0; i < N; i++) { a[i] = src[o] | (src[o + 1] << 8); o += 2; } }
    else { new Uint8Array(a.buffer, a.byteOffset, N).set(src.subarray(o, o + N)); o += N; }
  }
  let doc;
  try { doc = JSON.parse(td.decode(parts.tables)); } catch (_) { throw new Error(DAMAGED_TEXT); }
  const hd = doc.head || {};
  return {
    v: hd.v, gv: h.genVersion, wid: h.wid, seed: hd.seed, n, params: hd.params, sides: hd.sides, seaLevel: hd.seaLevel, bands: hd.bands, fields: f,
    plates: hd.plates, hotspots: hd.hotspots, falls: hd.falls, tables: doc.tables, events: parts.events.length ? parts.events.slice() : [],
    warnings: hd.warnings, rerolls: hd.rerolls, years: h.years, ...(isCrc3(hd.base) ? { base: hd.base.map((c) => c >>> 0) } : {}),
  };
}
async function rawOf(bytes, h) {
  const body = bytes.subarray(REC_HEADER_BYTES);
  try {
    if (h.comp === COMP.DEFLATE) return await inflateRaw(body);
    if (h.comp === COMP.RLE) return rleDecode(body, h.byteLength);
    if (h.comp === COMP.NONE) return body.slice();
  } catch (_) { throw new Error(DAMAGED_TEXT); }
  throw new Error(DAMAGED_TEXT);
}
export async function decodeRecord(bytes) {
  const h = readRecordHeader(bytes);
  return build(h, unframe(h, await rawOf(bytes, h)));
}
export function decodeRecordSync(bytes) {
  const h = readRecordHeader(bytes);
  if (h.comp === COMP.DEFLATE) throw new Error('deflate is async');
  let raw; try { raw = h.comp === COMP.RLE ? rleDecode(bytes.subarray(REC_HEADER_BYTES), h.byteLength) : bytes.slice(REC_HEADER_BYTES); } catch (_) { throw new Error(DAMAGED_TEXT); }
  return build(h, unframe(h, raw));
}
/** Is the record whole (every section CRC right)? Async; never throws. */
export async function recordOk(bytes) { try { await decodeRecord(bytes); return true; } catch (_) { return false; } }

/** Sizes for 9.2: raw sections and the encoded record, in bytes. */
export async function recordSizes(realm) {
  const p = recordParts(realm), bytes = await encodeRecord(realm), raw = p.fields.length + 8 + p.tables.length + p.events.length;
  return { fields: p.fields.length, tables: p.tables.length, events: p.events.length, raw, record: bytes.length, comp: bytes[16] };
}

// ---- W3.7: history for W2-era worlds (the recVersion path) ---------------------------------------------------
const evLen = (ev) => (ev && ev.length) | 0;
/** Has the world its history (a W3 world, or one grown by historyLater)? */
export const hasHistory = (realm) => !!realm && ((realm.years | 0) > 0 || evLen(realm.events) > 0 || !!(realm.tables && realm.tables.civs && realm.tables.civs.length));
/** Is it a world without history that should have it (a W2-era record, or one made while HISTORY was dark)? */
export const needsHistory = (realm) => !!realm && !hasHistory(realm) && ((realm.params && realm.params.history) | 0) > 0;
/** Is `realm` the grown form of the record `ref` ({ wid, crc }) references (its `base` is ref's CRCs)? */
export function grewFrom(realm, ref) {
  return !!realm && !!ref && isCrc3(realm.base) && isCrc3(ref.crc) && (realm.wid >>> 0) === (ref.wid >>> 0) && realm.base.every((c, k) => (c >>> 0) === (ref.crc[k] >>> 0));
}
const copy = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
/** A history-less copy of a realm: its fields copied layer by layer, empty tables and events, the head deep-copied. */
function bareCopy(old) {
  const f = allocFields(old.n);
  for (const name of LAYERS) f[name].set(old.fields[name]);
  return {
    v: old.v, gv: old.gv, wid: old.wid >>> 0, seed: old.seed, n: old.n, params: copy(old.params), sides: copy(old.sides), seaLevel: old.seaLevel,
    bands: copy(old.bands), fields: f, plates: copy(old.plates), hotspots: copy(old.hotspots), falls: copy(old.falls),
    tables: { civs: [], sites: [], figures: [], beasts: [], artifacts: [], wars: [] }, events: [], warnings: copy(old.warnings || []), rerolls: old.rerolls,
  };
}
/**
 * History for a stored world without it (W3.7): over a copy of its fields, with the regions `settled` (region
 * indices, the embarked holds') settled and empty, re-rolled as createRealm does (checkHistory, GEN.guarantee.rerolls,
 * warnings 'history.<rule>'). So the result equals createRealm(params, { history: true, settled }) whenever the
 * stored fields are the current generator's. Yields historyGen's steps; returns the new realm with `base`.
 */
export function* historyLater(old, settled = []) {
  if (!needsHistory(old)) throw new Error('historyLater: this world has its history already');
  const base = recordParts(old).crc.map((c) => c >>> 0), realm = bareCopy(old), N = realm.n * realm.n;
  const held = [...new Set(settled.filter((i) => Number.isInteger(i) && i >= 0 && i < N))];
  let hr = 0, hf;
  for (;;) {
    yield* historyAround(realm, held, hr);
    hf = checkHistory(realm);
    if (!hf.length || hr >= GEN.guarantee.rerolls) break;
    hr++;
  }
  for (const fl of hf) realm.warnings.push({ rule: 'history.' + fl.rule, detail: fl.detail });
  realm.base = base;
  return realm;
}
