// Colony <-> EC2 blob (doc 11.3, 11.4). Owner A.
//   snapshot(s)         sync: copies layers, builds the ENTITIES JSON and the RUNTIME bytes (the
//                       main-thread part of a save, budget 8 ms on an iPhone 13; 11.4 step 1)
//   saveBlob(s)         async: snapshot + deflate-raw (RLE when CompressionStream is missing)
//   saveBlobSync(s)     sync: snapshot + RLE (the pagehide quick-save)
//   loadBlob(bytes)     async: any compression -> a live state with s.rt rebuilt (initRuntime)
//   loadBlobSync(bytes) sync: RLE or none
// Format 2 (FORMAT_VERSION): ENTITIES = { fl (field lists), meta, rng, next, colony, st, rel, chron,
//   col, bld, zones, anim, foes, raids (rows without paths), items (flat, save/fields.js) };
//   RUNTIME = save/rtsave.js (saved C13 keys + per-mover u16 paths). Format 1 blobs (Stage 0) still load.
// Saves never change sim state (a snapshot only reads), so saving does not touch determinism.

import { LAYERS, setMapSize } from '../core/grid.js';
import { STATE_VERSION, COLLECTIONS, fromRow, colonyToPlain, colonyFromPlain, storyToPlain, storyFromPlain } from '../core/schema.js';
import { initRuntime, raidLive, migrate } from '../core/state.js';
import { framePayload, unframePayload, encodeBlob, encodeBlobSync, decodeBlob, decodeBlobSync, COMP, fromBase64 } from './codec.js';
import { fieldLists, rowsOf, entitiesOf, packItems, unpackItems, PATH_KINDS } from './fields.js';
import { encodeRuntime, decodeRuntime } from './rtsave.js';

/** The sync part of a save: { header, payload } (payload uncompressed). */
export function snapshot(s) {
  const layers = {};
  for (const l of LAYERS) layers[l.name] = s.L[l.name].slice();
  const ent = {
    fl: fieldLists(),
    meta: { v: s.v, id: s.id, name: s.name, seed: s.seed, w: s.w, h: s.h, tick: s.tick, speed: s.speed },
    rng: s.rng, next: s.next, colony: colonyToPlain(s.colony), st: storyToPlain(s.st), rel: s.rel, chron: s.chron,
  };
  for (const [key, kind] of Object.entries(COLLECTIONS)) {
    if (key === 'items') ent.items = packItems(s.items);
    else ent[key] = rowsOf(kind, s[key]);
  }
  const rt = encodeRuntime(s, raidLive(s));
  return { header: { stateVersion: STATE_VERSION, w: s.w, h: s.h, tick: s.tick }, payload: framePayload(layers, JSON.stringify(ent), rt) };
}

export async function saveBlob(s, comp) { const { header, payload } = snapshot(s); return encodeBlob(header, payload, comp); }
export function saveBlobSync(s, comp = COMP.RLE) { const { header, payload } = snapshot(s); return encodeBlobSync(header, payload, comp); }

// format 1 (Stage 0): rows with paths inside, items as rows, runtime JSON with base64 typed arrays
const TYPED = { Uint8Array, Uint16Array, Int8Array, Int16Array, Int32Array, Uint32Array, Float32Array };
const liveRtV1 = (text) => JSON.parse(text, (k, x) => {
  if (!x || typeof x !== 'object' || !x.$u || !TYPED[x.$u]) return x;
  const b = fromBase64(x.b), T = TYPED[x.$u];
  return new T(b.buffer, b.byteOffset, b.byteLength / T.BYTES_PER_ELEMENT);
});

/** Payload bytes -> live state (runs migrations; refuses newer states). */
export function restore(header, payload) {
  if (header.stateVersion > STATE_VERSION) throw new Error('This colony was saved by a newer version of the game.');
  const fmt = header.formatVersion || 1;
  const sec = unframePayload(payload);
  let ent = JSON.parse(sec.entities);
  ent = migrate(ent, header.stateVersion);   // older saves through core/state.js migrations (11.5)
  setMapSize(header.w, header.h);
  const m = ent.meta;
  const s = {
    v: STATE_VERSION, id: m.id, name: m.name, seed: m.seed, w: m.w, h: m.h, tick: m.tick, speed: m.speed,
    rng: { ...ent.rng }, next: { ...ent.next }, L: sec.layers,
    colony: colonyFromPlain(ent.colony), st: storyFromPlain(ent.st),
    col: [], items: [], bld: [], zones: [], anim: [], foes: [], raids: [],
    rel: ent.rel, chron: ent.chron,
  };
  let rt, paths = null;
  if (fmt >= 2) {
    const fl = ent.fl || {};
    for (const [key, kind] of Object.entries(COLLECTIONS)) {
      if (key === 'items') s.items = unpackItems(ent.items || { strs: [], a: [], xs: [] });
      else s[key] = entitiesOf(kind, ent[key] || [], fl[kind] || null);
    }
    ({ rt, paths } = decodeRuntime(sec.runtimeBytes));
  } else {
    for (const [key, kind] of Object.entries(COLLECTIONS)) s[key] = (ent[key] || []).map((r) => fromRow(kind, r));
    rt = liveRtV1(sec.runtime);
  }
  if (paths) for (const [key, kind] of Object.entries(COLLECTIONS)) {
    if (!PATH_KINDS[kind]) continue;
    const pm = paths[kind];
    if (pm && pm.size) for (const e of s[key]) if (e && pm.has(e.id)) e.path = pm.get(e.id);
  }
  s.rt = null;
  initRuntime(s);
  for (const k of Object.keys(rt)) s.rt[k] = rt[k];
  return s;
}

export async function loadBlob(bytes) { const { header, payload } = await decodeBlob(bytes); return restore(header, payload); }
export function loadBlobSync(bytes) { const { header, payload } = decodeBlobSync(bytes); return restore(header, payload); }
