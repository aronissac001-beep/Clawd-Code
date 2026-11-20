// The pristine world (owner A; EMBERCROWN-FORTRESS.md 5.1, F6, F28). Pure: no storage here (slots.js holds
// the IndexedDB store `pristine` and the fallback order), no sim imports beyond the grid.
//
// A colony's pristine world is the world as it was made: built ONCE, by the generator at founding (or by the
// v3 -> v4 migration, E9), never regenerated in normal play. EC3 saves are its XOR delta (codec.js). It
// holds the 7 layers that a fresh world can have non-zero (codec.PRISTINE_LAYERS); the other 6 are zero.
//
//   record = 'ECP\0' | u32 pristineId | u16 w, h, d, zS | u16 genVersion | u8 worldKind | u8 compression
//            | u32[13] crc (per layer, codec.LAYERS3 order; a zero layer's CRC for the 6 empty ones)
//            | compress( the 7 layers, N bytes each, in PRISTINE_LAYERS order | u32 length + meta JSON )
//            (72-byte header; compression 1 deflate-raw, 2 RLE where CompressionStream is missing, 0 tests)
//   meta     = { dormant: [...], amendments: [...], baseMask?: base64 } (2.2 step 8, 5.6, 5.4)
//   pristineId = crc32 of the header fields w..worldKind and the 13 CRCs (equal worlds share an id)
//
// In memory a state's pristine world lives in a WeakMap beside the state (`pristineOf(s)`), not in s.rt:
// the sim never sees it (C13 class "save-base"; s.rt is rebuilt by initRuntime and must not drop it).

import { crc32, COMP, LAYERS3, PRISTINE_LAYERS, layerLen3, compress, decompress, hasDeflate, rleEncode, rleDecode, WORLD_KIND } from './codec.js';

export const PMAGIC = [0x45, 0x43, 0x50, 0x00];
export const PHEADER_BYTES = 72;
export const MISSING_TEXT = "This hold's world record is missing. Import a backup file to restore it.";
const te = new TextEncoder(), td = new TextDecoder();

// ---- CRCs ---------------------------------------------------------------------------------------
const zeroCrc = new Map();
function crcZeros(n) {
  let c = zeroCrc.get(n);
  if (c === undefined) { c = crc32(new Uint8Array(n)); zeroCrc.set(n, c); }
  return c;
}
/** The 13 per-layer CRCs of a pristine world (`layers` holds the 7; the rest are zero layers of their size). */
export function layerCrcs(layers, n) {
  return LAYERS3.map((l) => (PRISTINE_LAYERS.includes(l.name) && layers[l.name] ? crc32(layers[l.name]) : crcZeros(layerLen3(l, n))));
}
function idOf(p) {
  const b = new Uint8Array(11 + 52), dv = new DataView(b.buffer);
  dv.setUint16(0, p.w, true); dv.setUint16(2, p.h, true); dv.setUint16(4, p.d, true); dv.setUint16(6, p.zS, true);
  dv.setUint16(8, p.genVersion | 0, true); b[10] = p.worldKind;
  for (let k = 0; k < 13; k++) dv.setUint32(11 + 4 * k, p.crc[k] >>> 0, true);
  return crc32(b) >>> 0;
}

// ---- Build ----------------------------------------------------------------------------------------
/**
 * The pristine world of a state, from its live layers as they are now (call it right after the generator
 * ran, before any change). opts: { worldKind (3 native, 2 migrated), genVersion, meta }.
 */
export function buildPristine(s, opts = {}) {
  const d = s.d || 1, zs = s.zS || 0, n = s.w * s.h * d;
  const layers = {};
  for (const name of PRISTINE_LAYERS) {
    const a = s.L[name];
    layers[name] = a ? a.slice() : new Uint8Array(n);
    if (layers[name].length !== n) throw new Error(`pristine: layer ${name} has ${layers[name].length} bytes, expected ${n}`);
  }
  return makePristine({ w: s.w, h: s.h, d, zS: zs, genVersion: opts.genVersion | 0, worldKind: opts.worldKind || WORLD_KIND.NATIVE, layers, meta: opts.meta || {} });
}
/** A pristine object from its parts (computes the CRCs and the id). */
export function makePristine({ w, h, d, zS, genVersion = 0, worldKind = WORLD_KIND.NATIVE, layers, meta = {} }) {
  const p = { w, h, d, zS, genVersion, worldKind, layers, meta, crc: layerCrcs(layers, w * h * d), id: 0, bytes: null };
  p.id = idOf(p);
  return p;
}

/** Does pristine `p` match a blob header (its id and all 13 CRCs)? */
export function pristineMatches(p, header) {
  if (!p || p.id !== header.pristineId || p.w !== header.w || p.h !== header.h || p.d !== header.d || p.zS !== header.zS) return false;
  for (let k = 0; k < 13; k++) if ((p.crc[k] >>> 0) !== (header.pristineCrc[k] >>> 0)) return false;
  return true;
}

// ---- Record bytes -----------------------------------------------------------------------------------
function body(p) {
  const n = p.w * p.h * p.d, mj = te.encode(JSON.stringify(p.meta || {}));
  const out = new Uint8Array(PRISTINE_LAYERS.length * n + 4 + mj.length);
  PRISTINE_LAYERS.forEach((name, k) => out.set(p.layers[name], k * n));
  new DataView(out.buffer).setUint32(PRISTINE_LAYERS.length * n, mj.length, true);
  out.set(mj, PRISTINE_LAYERS.length * n + 4);
  return out;
}
function header(p, comp, bodyLen) {
  const out = new Uint8Array(PHEADER_BYTES + bodyLen), dv = new DataView(out.buffer);
  out.set(PMAGIC, 0); dv.setUint32(4, p.id >>> 0, true);
  dv.setUint16(8, p.w, true); dv.setUint16(10, p.h, true); dv.setUint16(12, p.d, true); dv.setUint16(14, p.zS, true);
  dv.setUint16(16, p.genVersion | 0, true); out[18] = p.worldKind; out[19] = comp;
  for (let k = 0; k < 13; k++) dv.setUint32(20 + 4 * k, p.crc[k] >>> 0, true);
  return out;
}
/** The record bytes (async: deflate-raw when available). Cached on p.bytes. */
export async function encodePristine(p, comp = hasDeflate() ? COMP.DEFLATE : COMP.RLE) {
  if (p.bytes && p.bytesComp === comp) return p.bytes;
  const b = await compress(body(p), comp);
  const out = header(p, comp, b.length); out.set(b, PHEADER_BYTES);
  p.bytes = out; p.bytesComp = comp;
  return out;
}
/** The record bytes, synchronously (RLE or none). */
export function encodePristineSync(p, comp = COMP.RLE) {
  if (comp === COMP.DEFLATE) throw new Error('deflate is async');
  const raw = body(p), b = comp === COMP.RLE ? rleEncode(raw) : raw;
  const out = header(p, comp, b.length); out.set(b, PHEADER_BYTES);
  return out;
}

/** Read a record's header (no inflate). Throws when the bytes are not a pristine record. */
export function readPristineHeader(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < PHEADER_BYTES || !PMAGIC.every((v, i) => bytes[i] === v)) throw new Error('This is not a world record.');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const crc = []; for (let k = 0; k < 13; k++) crc.push(dv.getUint32(20 + 4 * k, true));
  return { id: dv.getUint32(4, true), w: dv.getUint16(8, true), h: dv.getUint16(10, true), d: dv.getUint16(12, true), zS: dv.getUint16(14, true), genVersion: dv.getUint16(16, true), worldKind: bytes[18], comp: bytes[19], crc };
}
function fromBody(hd, raw, bytes) {
  const n = hd.w * hd.h * hd.d, need = PRISTINE_LAYERS.length * n + 4;
  if (raw.length < need) throw new Error("This hold's world record is damaged (it is cut short).");
  const layers = {};
  // views into the one inflated buffer (offsets are multiples of n, so aligned): a pristine world is never written
  PRISTINE_LAYERS.forEach((name, k) => { layers[name] = raw.subarray(k * n, (k + 1) * n); });
  const ml = new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getUint32(PRISTINE_LAYERS.length * n, true);
  let meta = {};
  try { meta = JSON.parse(td.decode(raw.subarray(need, need + ml)) || '{}'); } catch (_) { throw new Error("This hold's world record is damaged (its notes could not be read)."); }
  const p = makePristine({ w: hd.w, h: hd.h, d: hd.d, zS: hd.zS, genVersion: hd.genVersion, worldKind: hd.worldKind, layers, meta });
  // every layer's CRC and the id must be what the record says: a damaged record is refused, never used
  if (p.id !== hd.id || p.crc.some((c, k) => c !== hd.crc[k])) throw new Error("This hold's world record is damaged (checksum mismatch).");
  p.bytes = bytes; p.bytesComp = hd.comp;
  return p;
}
/** Record bytes -> pristine object, every CRC checked (async: deflate). */
export async function decodePristine(bytes) {
  const hd = readPristineHeader(bytes);
  let raw;
  try { raw = await decompress(bytes.subarray(PHEADER_BYTES), hd.comp); } catch (_) { throw new Error("This hold's world record is damaged (it could not be unpacked)."); }
  return fromBody(hd, raw, bytes);
}
export function decodePristineSync(bytes) {
  const hd = readPristineHeader(bytes);
  if (hd.comp === COMP.DEFLATE) throw new Error('deflate is async');
  return fromBody(hd, hd.comp === COMP.RLE ? rleDecode(bytes.subarray(PHEADER_BYTES)) : bytes.slice(PHEADER_BYTES), bytes);
}

// ---- Beside the state ---------------------------------------------------------------------------------
const BY_STATE = new WeakMap();
/** Attach a pristine world to a live state (founding, load, migration). */
export function attachPristine(s, p) { BY_STATE.set(s, p); return p; }
/** The state's pristine world, or null (a D = 1 colony has none: it saves as EC2). */
export const pristineOf = (s) => BY_STATE.get(s) || null;

// ---- Regeneration (the last fallback, native worlds only; 5.1) -------------------------------------------
// The generator registers itself (mapgen3, step E10): fn({ seed, w, h, d, zS, genVersion }) -> state-like
// { w, h, d, zS, L } holding the 7 layers, or null. Accepted only when all 13 CRCs match the save header.
let regenerator = null;
export function setRegenerator(fn) { regenerator = typeof fn === 'function' ? fn : null; }
/** A regenerated pristine world matching `header`, or null. */
export function regeneratePristine(header, seed) {
  if (!regenerator || header.worldKind !== WORLD_KIND.NATIVE) return null;
  let s;
  try { s = regenerator({ seed, w: header.w, h: header.h, d: header.d, zS: header.zS, genVersion: header.genVersion }); } catch (_) { return null; }
  if (!s || !s.L) return null;
  const p = buildPristine({ w: header.w, h: header.h, d: header.d, zS: header.zS, L: s.L }, { worldKind: header.worldKind, genVersion: header.genVersion, meta: s.pristineMeta || {} });
  return pristineMatches(p, header) ? p : null;
}
