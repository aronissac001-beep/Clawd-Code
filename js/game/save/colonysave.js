// Colony <-> EC2 blob (doc 11.3, 11.4). Owner A.
//   snapshot(s)        sync: copies layers, builds the ENTITIES and RUNTIME JSON (the main-thread part)
//   saveBlob(s)        async: snapshot + deflate-raw (RLE when CompressionStream is missing)
//   saveBlobSync(s)    sync: snapshot + RLE (the pagehide quick-save)
//   loadBlob(bytes)    async: any compression -> a live state with s.rt rebuilt (initRuntime)
//   loadBlobSync(bytes) sync: RLE or none
// Entities are positional rows in schema field order (save/fields.js will refine per entity).
// Saved runtime is what C13 classes as saved (think and path queues; flow fields while a raid is live).

import { LAYERS, setMapSize } from '../core/grid.js';
import { STATE_VERSION, COLLECTIONS, toRow, fromRow, colonyToPlain, colonyFromPlain, storyToPlain, storyFromPlain } from '../core/schema.js';
import { initRuntime, raidLive, migrations } from '../core/state.js';
import { savedKeys } from '../core/rtcontract.js';
import { framePayload, unframePayload, encodeBlob, encodeBlobSync, decodeBlob, decodeBlobSync, COMP, toBase64, fromBase64 } from './codec.js';

// Typed arrays in the saved runtime (flow fields, u16 x N) travel as base64 of their bytes
// (little-endian, as on every supported device) rather than as number lists.
const TYPED = { Uint8Array, Uint16Array, Int8Array, Int16Array, Int32Array, Uint32Array, Float32Array };
const bytesOf = (x) => new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
const plainRt = (v) => JSON.parse(JSON.stringify(v, (k, x) => (ArrayBuffer.isView(x) ? { $u: x.constructor.name, b: toBase64(bytesOf(x)) } : x)));
const liveRt = (v) => JSON.parse(JSON.stringify(v), (k, x) => {
  if (!x || typeof x !== 'object' || !x.$u || !TYPED[x.$u]) return x;
  const b = fromBase64(x.b), T = TYPED[x.$u];
  return new T(b.buffer, b.byteOffset, b.byteLength / T.BYTES_PER_ELEMENT);
});

/** The sync part of a save: { header, payload } (payload uncompressed). */
export function snapshot(s) {
  const layers = {};
  for (const l of LAYERS) layers[l.name] = s.L[l.name].slice();
  const ent = {
    meta: { v: s.v, id: s.id, name: s.name, seed: s.seed, w: s.w, h: s.h, tick: s.tick, speed: s.speed },
    rng: s.rng, next: s.next, colony: colonyToPlain(s.colony), st: storyToPlain(s.st), rel: s.rel, chron: s.chron,
  };
  for (const [key, kind] of Object.entries(COLLECTIONS)) ent[key] = s[key].map((e) => toRow(kind, e));
  const rt = {};
  for (const k of savedKeys(raidLive(s))) rt[k] = plainRt(s.rt[k]);
  return { header: { stateVersion: STATE_VERSION, w: s.w, h: s.h, tick: s.tick }, payload: framePayload(layers, JSON.stringify(ent), JSON.stringify(rt)) };
}

export async function saveBlob(s, comp) { const { header, payload } = snapshot(s); return encodeBlob(header, payload, comp); }
export function saveBlobSync(s, comp = COMP.RLE) { const { header, payload } = snapshot(s); return encodeBlobSync(header, payload, comp); }

/** Payload bytes -> live state (runs migrations; refuses newer states). */
export function restore(header, payload) {
  if (header.stateVersion > STATE_VERSION) throw new Error('This colony was saved by a newer version of the game.');
  const { layers, entities, runtime } = unframePayload(payload);
  let ent = JSON.parse(entities);
  for (let v = header.stateVersion; v < STATE_VERSION; v++) ent = migrations[v - 1](ent);
  setMapSize(header.w, header.h);
  const m = ent.meta;
  const s = {
    v: STATE_VERSION, id: m.id, name: m.name, seed: m.seed, w: m.w, h: m.h, tick: m.tick, speed: m.speed,
    rng: { ...ent.rng }, next: { ...ent.next }, L: layers,
    colony: colonyFromPlain(ent.colony), st: storyFromPlain(ent.st),
    col: [], items: [], bld: [], zones: [], anim: [], foes: [], raids: [],
    rel: ent.rel, chron: ent.chron,
  };
  for (const [key, kind] of Object.entries(COLLECTIONS)) s[key] = (ent[key] || []).map((r) => fromRow(kind, r));
  const rt = liveRt(JSON.parse(runtime));
  s.rt = null;
  initRuntime(s);
  for (const k of Object.keys(rt)) s.rt[k] = rt[k];
  return s;
}

export async function loadBlob(bytes) { const { header, payload } = await decodeBlob(bytes); return restore(header, payload); }
export function loadBlobSync(bytes) { const { header, payload } = decodeBlobSync(bytes); return restore(header, payload); }
