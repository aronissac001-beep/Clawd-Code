// Contract C10 (owner A; provisional until the 1a fun review): the EC2 save blob (doc 11.3).
//
//   EC2 blob = MAGIC 'EC2\0' | u16 formatVersion | u16 stateVersion | u16 w | u16 h | u32 tick
//              | u32 crc32(payload) | u8 compression | payload          (little-endian; header 21 bytes)
//   compression: 0 none (tests), 1 deflate-raw (CompressionStream), 2 RLE (sync fallback, quick-save)
//   payload  = compress( LAYERS | ENTITIES | RUNTIME )
//   LAYERS   = per layer in grid.LAYERS order: u8 layerId, u8 encoding (0 raw, 1 bitset), u32 byteLength, bytes
//   ENTITIES = u32 length + UTF-8 JSON
//   RUNTIME  = u32 length + UTF-8 JSON (the saved runtime of C13)
//   text form = "EC2:" + base64(blob)
//
// This file only frames bytes; colonysave.js decides what goes into ENTITIES and RUNTIME.

import { LAYERS } from '../core/grid.js';

export const MAGIC = [0x45, 0x43, 0x32, 0x00];
export const FORMAT_VERSION = 1;
export const HEADER_BYTES = 21;
export const COMP = Object.freeze({ NONE: 0, DEFLATE: 1, RLE: 2 });
export const TEXT_PREFIX = 'EC2:';

// ---- CRC-32 (IEEE) --------------------------------------------------------------------------
let CRC_TABLE = null;
export function crc32(bytes) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---- RLE (compression 2): runs of a repeated byte -------------------------------------------
// Stream of records: 0x00..0x7f n -> n+1 literal bytes follow; 0x80..0xff n -> repeat next byte (n-0x80)+3 times.
export function rleEncode(src) {
  // worst case: one header byte per 128 literals; runs never expand
  const buf = new Uint8Array(src.length + ((src.length + 127) >> 7) + 2);
  let o = 0, i = 0;
  while (i < src.length) {
    let run = 1;
    while (i + run < src.length && src[i + run] === src[i] && run < 130) run++;
    if (run >= 3) { buf[o++] = 0x80 + (run - 3); buf[o++] = src[i]; i += run; continue; }
    let j = i, lit = 0;
    while (j < src.length && lit < 128) {
      if (j + 2 < src.length && src[j] === src[j + 1] && src[j] === src[j + 2]) break;
      j++; lit++;
    }
    buf[o++] = lit - 1;
    for (let k = 0; k < lit; k++) buf[o++] = src[i + k];
    i += lit;
  }
  return buf.slice(0, o);
}
export function rleDecode(src, expectLen = 0) {
  let out = new Uint8Array(expectLen || src.length * 4 + 16), o = 0, i = 0;
  const need = (n) => { if (o + n > out.length) { const b = new Uint8Array((out.length + n) * 2); b.set(out.subarray(0, o)); out = b; } };
  while (i < src.length) {
    const r = src[i++];
    if (r >= 0x80) { const n = r - 0x80 + 3, v = src[i++]; need(n); out.fill(v, o, o + n); o += n; }
    else { const n = r + 1; need(n); out.set(src.subarray(i, i + n), o); o += n; i += n; }
  }
  return out.slice(0, o);
}

// ---- deflate-raw via CompressionStream (browsers, Node 18+) ---------------------------------
export const hasDeflate = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
async function pipe(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}
export const deflateRaw = (bytes) => pipe(bytes, new CompressionStream('deflate-raw'));
export const inflateRaw = (bytes) => pipe(bytes, new DecompressionStream('deflate-raw'));

// ---- Payload framing --------------------------------------------------------------------------
const te = new TextEncoder(), td = new TextDecoder();
/** LAYERS | ENTITIES | RUNTIME as one Uint8Array. `layers` maps layer name -> Uint8Array. */
export function framePayload(layers, entitiesJson, runtimeJson) {
  const ent = te.encode(entitiesJson), rtb = te.encode(runtimeJson);
  let len = 8 + ent.length + rtb.length;
  for (const l of LAYERS) len += 6 + layers[l.name].length;
  const out = new Uint8Array(len), dv = new DataView(out.buffer);
  let o = 0;
  for (const l of LAYERS) {
    const a = layers[l.name];
    out[o] = l.id; out[o + 1] = l.enc; dv.setUint32(o + 2, a.length, true); out.set(a, o + 6); o += 6 + a.length;
  }
  dv.setUint32(o, ent.length, true); out.set(ent, o + 4); o += 4 + ent.length;
  dv.setUint32(o, rtb.length, true); out.set(rtb, o + 4);
  return out;
}
export function unframePayload(p) {
  const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
  const layers = {};
  let o = 0;
  for (const l of LAYERS) {
    if (p[o] !== l.id) throw new Error(`EC2: layer ${l.name} expected id ${l.id}, found ${p[o]}`);
    const n = dv.getUint32(o + 2, true);
    layers[l.name] = p.slice(o + 6, o + 6 + n); o += 6 + n;
  }
  const el = dv.getUint32(o, true); const entities = td.decode(p.subarray(o + 4, o + 4 + el)); o += 4 + el;
  const rl = dv.getUint32(o, true); const runtime = td.decode(p.subarray(o + 4, o + 4 + rl));
  return { layers, entities, runtime };
}

// ---- Blob header ------------------------------------------------------------------------------
export function writeHeader(h, payload, comp) {
  const out = new Uint8Array(HEADER_BYTES + payload.length), dv = new DataView(out.buffer);
  out.set(MAGIC, 0);
  dv.setUint16(4, FORMAT_VERSION, true); dv.setUint16(6, h.stateVersion, true);
  dv.setUint16(8, h.w, true); dv.setUint16(10, h.h, true); dv.setUint32(12, h.tick >>> 0, true);
  dv.setUint32(16, crc32(payload), true); out[20] = comp;
  out.set(payload, HEADER_BYTES);
  return out;
}
/** Parse and check a blob header. Throws with a player-readable reason. */
export function readHeader(blob) {
  if (!(blob instanceof Uint8Array) || blob.length < HEADER_BYTES) throw new Error('Not an Embercrown save (too short).');
  for (let i = 0; i < 4; i++) if (blob[i] !== MAGIC[i]) throw new Error('Not an Embercrown save.');
  const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const h = { formatVersion: dv.getUint16(4, true), stateVersion: dv.getUint16(6, true), w: dv.getUint16(8, true), h: dv.getUint16(10, true), tick: dv.getUint32(12, true), crc: dv.getUint32(16, true), comp: blob[20] };
  if (h.formatVersion > FORMAT_VERSION) throw new Error('This save is from a newer version of the game.');
  const payload = blob.subarray(HEADER_BYTES);
  if (crc32(payload) !== h.crc) throw new Error('This save is damaged (checksum mismatch).');
  return { header: h, payload };
}

/** Compress a payload into a blob (async: deflate when available, else RLE). */
export async function encodeBlob(h, payload, comp = hasDeflate() ? COMP.DEFLATE : COMP.RLE) {
  const body = comp === COMP.DEFLATE ? await deflateRaw(payload) : comp === COMP.RLE ? rleEncode(payload) : payload;
  return writeHeader(h, body, comp);
}
/** Synchronous blob (RLE or none), for the pagehide quick-save. */
export function encodeBlobSync(h, payload, comp = COMP.RLE) {
  if (comp === COMP.DEFLATE) throw new Error('deflate is async');
  return writeHeader(h, comp === COMP.RLE ? rleEncode(payload) : payload, comp);
}
export async function decodeBlob(blob) {
  const { header, payload } = readHeader(blob);
  const raw = header.comp === COMP.DEFLATE ? await inflateRaw(payload) : header.comp === COMP.RLE ? rleDecode(payload) : payload.slice();
  return { header, payload: raw };
}
export function decodeBlobSync(blob) {
  const { header, payload } = readHeader(blob);
  if (header.comp === COMP.DEFLATE) throw new Error('deflate is async');
  return { header, payload: header.comp === COMP.RLE ? rleDecode(payload) : payload.slice() };
}

// ---- Text form --------------------------------------------------------------------------------
export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromBase64(text) {
  const s = atob(text), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
export const blobToText = (blob) => TEXT_PREFIX + toBase64(blob);
export function textToBlob(text) {
  const t = String(text).trim();
  if (!t.startsWith(TEXT_PREFIX)) throw new Error('Not an Embercrown save text (it should start with EC2:).');
  return fromBase64(t.slice(TEXT_PREFIX.length).replace(/\s+/g, ''));
}
