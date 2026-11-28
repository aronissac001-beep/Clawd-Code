// Contract C10 (owner A; provisional until the 1a fun review): the EC2 save blob (doc 11.3).
//
//   EC2 blob = MAGIC 'EC2\0' | u16 formatVersion | u16 stateVersion | u16 w | u16 h | u32 tick
//              | u32 crc32(payload) | u8 compression | payload          (little-endian; header 21 bytes)
//   compression: 0 none (tests), 1 deflate-raw (CompressionStream), 2 RLE (sync fallback, quick-save)
//   payload  = compress( LAYERS | ENTITIES | RUNTIME )
//   LAYERS   = per layer in grid.LAYERS order: u8 layerId, u8 encoding (0 raw, 1 bitset), u32 byteLength, bytes
//   ENTITIES = u32 length + UTF-8 JSON
//   RUNTIME  = u32 length + bytes: format 2 = the binary runtime of save/rtsave.js (saved C13 keys
//              as JSON with typed-array blobs, then per-mover u16 paths); format 1 = UTF-8 JSON
//   text form = "EC2:" + base64(blob)
//
// This file only frames bytes; colonysave.js decides what goes into ENTITIES and RUNTIME.

import { LAYERS } from '../core/grid.js';

export const MAGIC = [0x45, 0x43, 0x32, 0x00];
export const FORMAT_VERSION = 2;   // 2: binary RUNTIME, entity field lists, flat item stacks (Stage 1a)
export const HEADER_BYTES = 21;
export const COMP = Object.freeze({ NONE: 0, DEFLATE: 1, RLE: 2 });
export const TEXT_PREFIX = 'EC2:';

// ---- CRC-32 (IEEE) --------------------------------------------------------------------------
// Slicing-by-8 (same value as the bytewise table; EC3 checks about 2.3 MB of pristine layers per load).
let CRC_TABLE = null, CRC8 = null;
function crcTables() {
  CRC_TABLE = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c >>> 0; }
  CRC8 = new Uint32Array(256 * 8);
  CRC8.set(CRC_TABLE);
  for (let t = 1; t < 8; t++) for (let n = 0; n < 256; n++) { const p = CRC8[(t - 1) * 256 + n]; CRC8[t * 256 + n] = (p >>> 8) ^ CRC_TABLE[p & 0xff]; }
}
export function crc32(bytes) {
  if (!CRC_TABLE) crcTables();
  const T = CRC8;
  let c = 0xffffffff, i = 0;
  const n8 = bytes.length & ~7;
  for (; i < n8; i += 8) {
    const a = (c ^ (bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24))) >>> 0;
    c = T[1792 + (a & 0xff)] ^ T[1536 + ((a >>> 8) & 0xff)] ^ T[1280 + ((a >>> 16) & 0xff)] ^ T[1024 + (a >>> 24)]
      ^ T[768 + bytes[i + 4]] ^ T[512 + bytes[i + 5]] ^ T[256 + bytes[i + 6]] ^ T[bytes[i + 7]];
  }
  for (; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
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
/** LAYERS | ENTITIES | RUNTIME as one Uint8Array. `layers` maps layer name -> Uint8Array; runtime is bytes or a JSON string. */
export function framePayload(layers, entitiesJson, runtime) {
  const ent = te.encode(entitiesJson), rtb = typeof runtime === 'string' ? te.encode(runtime) : runtime;
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
  const rl = dv.getUint32(o, true); const runtimeBytes = p.subarray(o + 4, o + 4 + rl);
  return { layers, entities, runtimeBytes, get runtime() { return td.decode(runtimeBytes); } };
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

/** Compress a payload into a blob (async: deflate when available, else RLE). `h.format === 3` writes an EC3 header. */
export async function encodeBlob(h, payload, comp = hasDeflate() ? COMP.DEFLATE : COMP.RLE) {
  const body = comp === COMP.DEFLATE ? await deflateRaw(payload) : comp === COMP.RLE ? rleEncode(payload) : payload;
  return h.format === 3 ? writeHeader3(h, body, comp) : writeHeader(h, body, comp);
}
/** Synchronous blob (RLE or none), for the pagehide quick-save. */
export function encodeBlobSync(h, payload, comp = COMP.RLE) {
  if (comp === COMP.DEFLATE) throw new Error('deflate is async');
  const body = comp === COMP.RLE ? rleEncode(payload) : payload;
  return h.format === 3 ? writeHeader3(h, body, comp) : writeHeader(h, body, comp);
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
/** Text form of either format ("EC2:" or "EC3:" + base64); textToBlob reads both. */
export const blobToText = (blob) => blobToTextAny(blob);
export const textToBlob = (text) => textToBlobAny(text);

// ================================================================================================
// Contract C10 v3 (owner A; EMBERCROWN-FORTRESS.md 5.1, frozen at the end of Stage Z1 step E8): EC3.
//
//   EC3 blob = MAGIC 'EC3\0' | u16 formatVersion (3) | u16 stateVersion | u16 w | u16 h | u16 d | u16 zS
//              | u16 genVersion | u8 worldKind (3 native, 2 migrated) | u8 flags (bit 0: PRISTINE embedded,
//                bit 1: REALM embedded, EMBERCROWN-WORLD.md 9.2)
//              | u32 tick | u32 pristineId | u32[13] pristineCrc (one per layer, LAYERS3 order)
//              | u32 crc32(payload) | u8 compression | payload                       (85-byte header)
//   payload  = compress( [PRISTINE] | [REALM] | LAYERS | ENTITIES | RUNTIME )
//   PRISTINE = only when flags bit 0: u32 length + the pristine record (save/pristine.js), already deflated
//   REALM    = only when flags bit 1: u32 length + the realm record (realm/record.js, 'ECR\0', already compressed).
//              A reader not told the flag finds it by its magic (a layer frame there would need a 1 GB layer).
//   LAYERS   = per layer in LAYERS3 order: u8 layerId, u8 encoding, u32 byteLength, bytes
//              encoding 3 (chunk XOR): u8[ceil(CW*CH*D/8)] changed-chunk bitmap, then for each set bit in
//              index order the chunk's bytes XOR the pristine chunk (16 x 16 bytes; bitsets: 16 rows x 2 bytes)
//              encodings 0 (raw) and 1 (bitset, raw bits) stay for tests and D = 1 debug maps
//   ENTITIES = u32 length + UTF-8 JSON;  RUNTIME = u32 length + rtsave.js version 3 (u32 paths)
//   text form = "EC3:" + base64(blob)
// A chunk is the 16 x 16 x 1 cluster of grid.clusterOf: c = (z * CH + cy) * CW + cx. Outside-the-map cells
// of an edge chunk are 0. The EC2 reader above (decodeBlob, readHeader, unframePayload) is frozen: decodeV2.

export const MAGIC3 = [0x45, 0x43, 0x33, 0x00];
export const FORMAT_VERSION3 = 3;
export const HEADER3_BYTES = 85;
export const TEXT_PREFIX3 = 'EC3:';
export const WORLD_KIND = Object.freeze({ MIGRATED: 2, NATIVE: 3 });
export const FLAG_PRISTINE = 1;
export const FLAG_REALM = 2;
const REALM_MAGIC = [0x45, 0x43, 0x52, 0x00];
export const ENC = Object.freeze({ RAW: 0, BITSET: 1, XOR: 3 });
/** The 13 saved layers of EC3, in blob order (5.1): the twelve of C1 plus `fluid` (id 13) before the bitsets. */
export const LAYERS3 = Object.freeze([
  ...LAYERS.filter((l) => l.enc === 0),
  { id: 13, name: 'fluid', enc: 0 },
  ...LAYERS.filter((l) => l.enc === 1),
]);
/** The layers a pristine world holds (the other six are zero in every pristine world). */
export const PRISTINE_LAYERS = Object.freeze(['terrain', 'mat', 'ore', 'plant', 'growth', 'blight', 'fluid']);
export const layerLen3 = (l, n) => (l.enc === 1 ? (n + 7) >> 3 : n);

/** 'EC2' | 'EC3' | null from the first bytes of a blob. */
export function blobKind(blob) {
  if (!(blob instanceof Uint8Array) || blob.length < 4) return null;
  const m = (M) => M.every((v, i) => blob[i] === v);
  return m(MAGIC) ? 'EC2' : m(MAGIC3) ? 'EC3' : null;
}

// ---- Chunk XOR (encoding 3) -------------------------------------------------------------------
/** Chunk geometry for a w x h x d map. */
export function chunkGeom(w, h, d) {
  const cw = Math.ceil(w / 16), ch = Math.ceil(h / 16);
  return { w, h, d, plane: w * h, n: w * h * d, cw, ch, chunks: cw * ch * d, mapBytes: Math.ceil((cw * ch * d) / 8) };
}
const chunkOfVoxel = (g, i) => { const x = i % g.w, r = (i / g.w) | 0, y = r % g.h, z = (r / g.h) | 0; return (z * g.ch + ((y >> 4))) * g.cw + (x >> 4); };

/**
 * The changed-chunk bitmap of `cur` against `base` (null = all zero): a full compare (never a touched-set,
 * 5.1), through Uint32 views where the layout allows.
 */
export function changedChunks(g, cur, base, bitset) {
  const map = new Uint8Array(g.mapBytes);
  const mark = (c) => { map[c >> 3] |= 1 << (c & 7); };
  const len = cur.length;
  const al = (a) => a && (a.byteOffset & 3) === 0;
  const u32ok = al(cur) && (!base || al(base)) && (len & 3) === 0 && (bitset ? g.w % 32 === 0 : g.w % 4 === 0);
  if (u32ok) {
    const a = new Uint32Array(cur.buffer, cur.byteOffset, len >> 2), b = base ? new Uint32Array(base.buffer, base.byteOffset, len >> 2) : null;
    for (let k = 0; k < a.length; k++) {
      if (b ? a[k] === b[k] : a[k] === 0) continue;
      if (!bitset) { mark(chunkOfVoxel(g, k << 2)); continue; }
      // 32 bits = 32 voxels of one row (w % 32 == 0): two chunks; mark each half that differs
      const x = b ? (a[k] ^ b[k]) >>> 0 : a[k];
      if (x & 0xffff) mark(chunkOfVoxel(g, k << 5));
      if (x >>> 16) mark(chunkOfVoxel(g, (k << 5) + 16));
    }
    return map;
  }
  for (let i = 0; i < len; i++) {
    const x = base ? cur[i] ^ base[i] : cur[i];
    if (!x) continue;
    if (!bitset) { mark(chunkOfVoxel(g, i)); continue; }
    for (let k = 0; k < 8; k++) if ((x >> k) & 1) { const v = (i << 3) + k; if (v < g.n) mark(chunkOfVoxel(g, v)); }
  }
  return map;
}

/** Encode one layer as encoding 3: bitmap + XOR chunks. */
export function xorEncode(g, cur, base, bitset) {
  const map = changedChunks(g, cur, base, bitset);
  let nset = 0;
  for (let k = 0; k < map.length; k++) { let v = map[k]; while (v) { nset += v & 1; v >>= 1; } }
  const cb = bitset ? 32 : 256;
  const out = new Uint8Array(map.length + nset * cb);
  out.set(map, 0);
  let o = map.length;
  for (let c = 0; c < g.chunks; c++) {
    if (!((map[c >> 3] >> (c & 7)) & 1)) continue;
    const cx = c % g.cw, cy = ((c / g.cw) | 0) % g.ch, z = (c / (g.cw * g.ch)) | 0;
    const x0 = cx << 4, y0 = cy << 4, xn = Math.min(16, g.w - x0), yn = Math.min(16, g.h - y0);
    for (let r = 0; r < yn; r++) {
      const row = (z * g.h + y0 + r) * g.w + x0;
      if (!bitset) {
        for (let k = 0; k < xn; k++) out[o + (r << 4) + k] = base ? cur[row + k] ^ base[row + k] : cur[row + k];
      } else {
        for (let k = 0; k < xn; k++) {
          const v = row + k, bit = ((cur[v >> 3] ^ (base ? base[v >> 3] : 0)) >> (v & 7)) & 1;
          if (bit) out[o + (r << 1) + (k >> 3)] |= 1 << (k & 7);
        }
      }
    }
    o += cb;
  }
  return out;
}

/** Apply an encoding-3 layer onto `target` (a copy of the pristine layer, or zeros), in place. */
export function xorApply(g, target, enc, bitset) {
  const map = enc.subarray(0, g.mapBytes), cb = bitset ? 32 : 256;
  let o = g.mapBytes;
  for (let c = 0; c < g.chunks; c++) {
    if (!((map[c >> 3] >> (c & 7)) & 1)) continue;
    if (o + cb > enc.length) throw new Error('This save is damaged (a map chunk is missing).');
    const cx = c % g.cw, cy = ((c / g.cw) | 0) % g.ch, z = (c / (g.cw * g.ch)) | 0;
    const x0 = cx << 4, y0 = cy << 4, xn = Math.min(16, g.w - x0), yn = Math.min(16, g.h - y0);
    for (let r = 0; r < yn; r++) {
      const row = (z * g.h + y0 + r) * g.w + x0;
      if (!bitset) { for (let k = 0; k < xn; k++) target[row + k] ^= enc[o + (r << 4) + k]; }
      else for (let k = 0; k < xn; k++) if ((enc[o + (r << 1) + (k >> 3)] >> (k & 7)) & 1) { const v = row + k; target[v >> 3] ^= 1 << (v & 7); }
    }
    o += cb;
  }
  return target;
}

// ---- EC3 payload framing ----------------------------------------------------------------------
/**
 * [PRISTINE] | [REALM] | LAYERS | ENTITIES | RUNTIME. `layers` is [{ id, enc, bytes }] in LAYERS3 order (already
 * encoded); `pristine` and `realm` are record bytes or null (the header's flags bits 0 and 1 must say so).
 */
export function framePayload3(pristine, layers, entitiesJson, runtime, realm = null) {
  const ent = te.encode(entitiesJson), rtb = typeof runtime === 'string' ? te.encode(runtime) : runtime;
  let len = (pristine ? 4 + pristine.length : 0) + (realm ? 4 + realm.length : 0) + 8 + ent.length + rtb.length;
  for (const l of layers) len += 6 + l.bytes.length;
  const out = new Uint8Array(len), dv = new DataView(out.buffer);
  let o = 0;
  if (pristine) { dv.setUint32(0, pristine.length, true); out.set(pristine, 4); o = 4 + pristine.length; }
  if (realm) { dv.setUint32(o, realm.length, true); out.set(realm, o + 4); o += 4 + realm.length; }
  for (const l of layers) { out[o] = l.id; out[o + 1] = l.enc; dv.setUint32(o + 2, l.bytes.length, true); out.set(l.bytes, o + 6); o += 6 + l.bytes.length; }
  dv.setUint32(o, ent.length, true); out.set(ent, o + 4); o += 4 + ent.length;
  dv.setUint32(o, rtb.length, true); out.set(rtb, o + 4);
  return out;
}
/**
 * -> { pristine (bytes | null), realm (bytes | null), layers: { name: { enc, bytes } }, entities, runtimeBytes }.
 * hasRealm: the header's flags bit 1; left out, the block is found by its magic.
 */
export function unframePayload3(p, hasPristine, hasRealm) {
  const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
  let o = 0, pristine = null, realm = null;
  const need = (n) => { if (o + n > p.length) throw new Error('This save is damaged (it is cut short).'); };
  if (hasPristine) { need(4); const n = dv.getUint32(0, true); o = 4; need(n); pristine = p.slice(4, 4 + n); o += n; }
  if (hasRealm === undefined) hasRealm = o + 8 <= p.length && REALM_MAGIC.every((v, k) => p[o + 4 + k] === v);
  if (hasRealm) { need(4); const n = dv.getUint32(o, true); o += 4; need(n); realm = p.slice(o, o + n); o += n; }
  const layers = {};
  for (const l of LAYERS3) {
    need(6);
    if (p[o] !== l.id) throw new Error(`EC3: layer ${l.name} expected id ${l.id}, found ${p[o]}`);
    const enc = p[o + 1], n = dv.getUint32(o + 2, true); o += 6; need(n);
    layers[l.name] = { enc, bytes: p.subarray(o, o + n) }; o += n;
  }
  need(4); const el = dv.getUint32(o, true); o += 4; need(el);
  const entities = td.decode(p.subarray(o, o + el)); o += el;
  need(4); const rl = dv.getUint32(o, true); o += 4; need(rl);
  return { pristine, realm, layers, entities, runtimeBytes: p.subarray(o, o + rl) };
}

// ---- EC3 header -------------------------------------------------------------------------------
/** h = { stateVersion, w, h, d, zS, genVersion, worldKind, flags, tick, pristineId, pristineCrc[13] } */
export function writeHeader3(h, body, comp) {
  const out = new Uint8Array(HEADER3_BYTES + body.length), dv = new DataView(out.buffer);
  out.set(MAGIC3, 0);
  dv.setUint16(4, FORMAT_VERSION3, true); dv.setUint16(6, h.stateVersion, true);
  dv.setUint16(8, h.w, true); dv.setUint16(10, h.h, true); dv.setUint16(12, h.d, true); dv.setUint16(14, h.zS, true);
  dv.setUint16(16, h.genVersion | 0, true); out[18] = h.worldKind; out[19] = h.flags | 0;
  dv.setUint32(20, h.tick >>> 0, true); dv.setUint32(24, h.pristineId >>> 0, true);
  for (let k = 0; k < 13; k++) dv.setUint32(28 + 4 * k, (h.pristineCrc[k] || 0) >>> 0, true);
  dv.setUint32(80, crc32(body), true); out[84] = comp;
  out.set(body, HEADER3_BYTES);
  return out;
}
/** Parse and check an EC3 header (and the payload CRC). Throws with a player-readable reason. */
export function readHeader3(blob) {
  if (!(blob instanceof Uint8Array) || blob.length < HEADER3_BYTES) throw new Error('Not an Embercrown save (too short).');
  if (blobKind(blob) !== 'EC3') throw new Error('Not an Embercrown save.');
  const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const pristineCrc = [];
  for (let k = 0; k < 13; k++) pristineCrc.push(dv.getUint32(28 + 4 * k, true));
  const h = {
    format: 3, formatVersion: dv.getUint16(4, true), stateVersion: dv.getUint16(6, true), w: dv.getUint16(8, true), h: dv.getUint16(10, true),
    d: dv.getUint16(12, true), zS: dv.getUint16(14, true), genVersion: dv.getUint16(16, true), worldKind: blob[18], flags: blob[19],
    tick: dv.getUint32(20, true), pristineId: dv.getUint32(24, true), pristineCrc, crc: dv.getUint32(80, true), comp: blob[84],
  };
  if (h.formatVersion > FORMAT_VERSION3) throw new Error('This save is from a newer version of the game.');
  const payload = blob.subarray(HEADER3_BYTES);
  if (crc32(payload) !== h.crc) throw new Error('This save is damaged (checksum mismatch).');
  return { header: h, payload };
}

/** The frozen EC2 reader (5.3): EC2 blob -> { header, payload }. */
export const decodeV2 = (blob) => decodeBlob(blob);

/** Either format: header (format 2 or 3) and the raw payload. Async (deflate). */
export async function decodeAny(blob) {
  if (blobKind(blob) !== 'EC3') { const r = await decodeBlob(blob); r.header.format = 2; return r; }
  const { header, payload } = readHeader3(blob);
  return { header, payload: await decompress(payload, header.comp) };
}
export function decodeAnySync(blob) {
  if (blobKind(blob) !== 'EC3') { const r = decodeBlobSync(blob); r.header.format = 2; return r; }
  const { header, payload } = readHeader3(blob);
  if (header.comp === COMP.DEFLATE) throw new Error('deflate is async');
  return { header, payload: header.comp === COMP.RLE ? rleDecode(payload) : payload.slice() };
}
/** Header only (either format), CRC-checked: what slots.js stores beside the bytes. */
export const readAnyHeader = (blob) => (blobKind(blob) === 'EC3' ? readHeader3(blob) : readHeader(blob));
export const headerBytesOf = (blob) => (blobKind(blob) === 'EC3' ? HEADER3_BYTES : HEADER_BYTES);

export async function compress(bytes, comp) { return comp === COMP.DEFLATE ? deflateRaw(bytes) : comp === COMP.RLE ? rleEncode(bytes) : bytes; }
export async function decompress(bytes, comp) { return comp === COMP.DEFLATE ? inflateRaw(bytes) : comp === COMP.RLE ? rleDecode(bytes) : bytes.slice(); }

/** Text form of either format; textToBlob reads both. */
export const blobToTextAny = (blob) => (blobKind(blob) === 'EC3' ? TEXT_PREFIX3 : TEXT_PREFIX) + toBase64(blob);
export function textToBlobAny(text) {
  const t = String(text).trim();
  if (t.startsWith(TEXT_PREFIX3)) return fromBase64(t.slice(TEXT_PREFIX3.length).replace(/\s+/g, ''));
  if (t.startsWith(TEXT_PREFIX)) return fromBase64(t.slice(TEXT_PREFIX.length).replace(/\s+/g, ''));
  throw new Error('Not an Embercrown save text (it should start with EC2: or EC3:).');
}
