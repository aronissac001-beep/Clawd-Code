// The RUNTIME section of an EC2 blob (owner A; doc 11.3, contract C13 saved classes).
//
//   RUNTIME = u8 version (2)
//             u32 jsonLength, UTF-8 JSON of the saved rt keys (C13 class 'saved', plus
//                 'saved-while-raid' while a raid is live); typed arrays inside are replaced by
//                 { $t: ctor, $b: blobIndex } and their bytes follow as blobs
//             u16 blobCount, per blob: u32 byteLength, bytes (little-endian element order)
//             paths: per mover kind in PATH_ORDER: u32 count, per mover: u32 id, u16 cursor
//                 (0xffff = a failed path, i = -1), u32 length, length x u16 tiles
//   Version 3 (EC3, EMBERCROWN-FORTRESS.md 5.1): the same, but each path is u32 cursor (0xffffffff = failed)
//   + u32 length + length x u32 voxels. EC2 blobs keep writing version 2 (D = 1 tiles fit u16).
// Everything is little-endian (every supported device). A typed array is copied into fresh,
// aligned memory on load, so no view ever points into the save buffer.

import { savedKeys } from '../core/rtcontract.js';
import { newPath } from '../core/schema.js';

export const RT_VERSION = 2;
export const RT_VERSION3 = 3;
export const PATH_ORDER = Object.freeze(['col', 'anim', 'foes']);
const TYPED = { Uint8Array, Uint16Array, Int8Array, Int16Array, Int32Array, Uint32Array, Float32Array, Float64Array };
const te = new TextEncoder(), td = new TextDecoder();

/** The RUNTIME bytes for a state. */
export function encodeRuntime(s, raidLive, ver = RT_VERSION) {
  const wide = ver === RT_VERSION3, tb = wide ? 4 : 2, cb = wide ? 4 : 2;
  const blobs = [];
  const json = JSON.stringify(Object.fromEntries(savedKeys(raidLive).map((k) => [k, s.rt[k]])), (k, v) => {
    if (ArrayBuffer.isView(v)) { blobs.push(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)); return { $t: v.constructor.name, $b: blobs.length - 1 }; }
    if (v instanceof Map) return { $map: [...v] };
    return v;
  });
  const jb = te.encode(json);
  let len = 1 + 4 + jb.length + 2;
  for (const b of blobs) len += 4 + b.length;
  const movers = PATH_ORDER.map((kind) => s[kind].filter((e) => e && e.path));
  for (const list of movers) { len += 4; for (const e of list) len += 4 + cb + 4 + tb * e.path.tiles.length; }
  const out = new Uint8Array(len), dv = new DataView(out.buffer);
  let o = 0;
  out[o++] = ver;
  dv.setUint32(o, jb.length, true); o += 4; out.set(jb, o); o += jb.length;
  dv.setUint16(o, blobs.length, true); o += 2;
  for (const b of blobs) { dv.setUint32(o, b.length, true); o += 4; out.set(b, o); o += b.length; }
  for (const list of movers) {
    dv.setUint32(o, list.length, true); o += 4;
    for (const e of list) {
      const p = e.path, t = p.tiles;
      dv.setUint32(o, e.id >>> 0, true);
      if (wide) { dv.setUint32(o + 4, p.i < 0 ? 0xffffffff : p.i, true); dv.setUint32(o + 8, t.length, true); o += 12; for (let k = 0; k < t.length; k++) { dv.setUint32(o, t[k], true); o += 4; } continue; }
      dv.setUint16(o + 4, p.i < 0 ? 0xffff : p.i, true); dv.setUint32(o + 6, t.length, true); o += 10;
      for (let k = 0; k < t.length; k++) { dv.setUint16(o, t[k], true); o += 2; }
    }
  }
  return out;
}

/**
 * Parse RUNTIME bytes. Returns { rt: { key: value }, paths: { kind: Map(id -> path) } }.
 * The caller puts the rt keys on s.rt after initRuntime and the paths on the movers.
 */
export function decodeRuntime(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 0;
  const ver = bytes[o++];
  if (ver !== RT_VERSION && ver !== RT_VERSION3) throw new Error(`EC2: runtime section version ${ver} is not supported`);
  const wide = ver === RT_VERSION3;
  const jl = dv.getUint32(o, true); o += 4;
  const json = td.decode(bytes.subarray(o, o + jl)); o += jl;
  const nb = dv.getUint16(o, true); o += 2;
  const blobs = [];
  for (let k = 0; k < nb; k++) { const n = dv.getUint32(o, true); o += 4; blobs.push(bytes.slice(o, o + n)); o += n; }
  const rt = JSON.parse(json, (k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (v.$t && TYPED[v.$t] && Number.isInteger(v.$b)) { const b = blobs[v.$b], T = TYPED[v.$t]; return new T(b.buffer, b.byteOffset, b.byteLength / T.BYTES_PER_ELEMENT); }
      if (Array.isArray(v.$map)) return new Map(v.$map);
    }
    return v;
  });
  const paths = {};
  for (const kind of PATH_ORDER) {
    const m = new Map();
    const n = dv.getUint32(o, true); o += 4;
    for (let k = 0; k < n; k++) {
      const id = dv.getUint32(o, true);
      if (wide) {
        const cur = dv.getUint32(o + 4, true), len = dv.getUint32(o + 8, true); o += 12;
        const tiles = new Uint32Array(len);
        for (let j = 0; j < len; j++) { tiles[j] = dv.getUint32(o, true); o += 4; }
        m.set(id, newPath(tiles, cur === 0xffffffff ? -1 : cur));
        continue;
      }
      const cur = dv.getUint16(o + 4, true), len = dv.getUint32(o + 6, true); o += 10;
      const tiles = new Uint16Array(len);
      for (let j = 0; j < len; j++) { tiles[j] = dv.getUint16(o, true); o += 2; }
      m.set(id, newPath(tiles, cur === 0xffff ? -1 : cur));
    }
    paths[kind] = m;
  }
  return { rt, paths };
}
