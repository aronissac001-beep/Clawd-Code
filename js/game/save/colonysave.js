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
//
// EC3 (EMBERCROWN-FORTRESS.md 5.1, 5.2; step E8): a colony with d > 1 saves as EC3, every layer a
// changed-chunk XOR against its pristine world (save/pristine.js, attached beside the state), the RUNTIME at
// version 3 (u32 paths). A D = 1 colony keeps saving EC2 exactly as before. opts:
//   snapshot(s, { embed })   embed the pristine record (dawn backups and exports: flags bit 0)
//   snapshot(s, { raw })     EC3 with raw layers (encodings 0 and 1; tests and debug maps)
//   loadBlob(bytes, { pristine })   pristine: a pristine object, or async ({ header, embedded, seed }) -> object;
//                            default: the blob's embedded copy, then one this page already holds.

import { LAYERS, setMapSize } from '../core/grid.js';
import { STATE_VERSION, COLLECTIONS, fromRow, colonyToPlain, colonyFromPlain, storyToPlain, storyFromPlain } from '../core/schema.js';
import { initRuntime, raidLive, migrate } from '../core/state.js';
import {
  framePayload, unframePayload, encodeBlob, encodeBlobSync, decodeBlob, decodeBlobSync, COMP, fromBase64,
  blobKind, decodeAny, decodeAnySync, framePayload3, unframePayload3, LAYERS3, PRISTINE_LAYERS, layerLen3, chunkGeom, xorEncode, xorApply, ENC, FLAG_PRISTINE,
} from './codec.js';
import { fieldLists, rowsOf, entitiesOf, packItems, unpackItems, PATH_KINDS } from './fields.js';
import { encodeRuntime, decodeRuntime, RT_VERSION3 } from './rtsave.js';
import { pristineOf, attachPristine, pristineMatches, decodePristine, decodePristineSync, encodePristine, encodePristineSync, MISSING_TEXT } from './pristine.js';

/** Does this state save as EC3 (a world with depth)? */
export const isDeep = (s) => (s.d || 1) > 1;

/** The sync part of a save: { header, payload } (payload uncompressed). */
export function snapshot(s, opts = {}) {
  if (isDeep(s)) return snapshot3(s, opts);
  const layers = {};
  for (const l of LAYERS) layers[l.name] = s.L[l.name].slice();
  const ent = {
    fl: fieldLists(),
    meta: { v: s.v, id: s.id, name: s.name, seed: s.seed, w: s.w, h: s.h, tick: s.tick, speed: s.speed },
    rng: s.rng, next: s.next, colony: colonyToPlain(s.colony), st: storyToPlain(s.st), rel: s.rel, chron: s.chron,
    ...(typeof s.legend === 'string' && s.legend ? { legend: s.legend } : {}),   // Z2: the Annals (OPTIONAL_KEYS)
  };
  for (const [key, kind] of Object.entries(COLLECTIONS)) {
    if (key === 'items') ent.items = packItems(s.items);
    else ent[key] = rowsOf(kind, s[key]);
  }
  const rt = encodeRuntime(s, raidLive(s));
  return { header: { stateVersion: STATE_VERSION, w: s.w, h: s.h, tick: s.tick }, payload: framePayload(layers, JSON.stringify(ent), rt) };
}

export async function saveBlob(s, comp, opts = {}) {
  if (isDeep(s) && opts.embed && pristineOf(s)) await encodePristine(pristineOf(s));
  const { header, payload } = snapshot(s, opts); return encodeBlob(header, payload, comp);
}
export function saveBlobSync(s, comp = COMP.RLE, opts = {}) { const { header, payload } = snapshot(s, { ...opts, sync: true }); return encodeBlobSync(header, payload, comp); }

// ---- EC3 ------------------------------------------------------------------------------------------
const ZEROS = new Map();
const zeros = (n) => { let z = ZEROS.get(n); if (!z) { z = new Uint8Array(n); ZEROS.set(n, z); } return z; };
function entitiesOfState(s) {
  const ent = {
    fl: fieldLists(),
    meta: { v: s.v, id: s.id, name: s.name, seed: s.seed, w: s.w, h: s.h, d: s.d, zS: s.zS, tick: s.tick, speed: s.speed },
    rng: s.rng, next: s.next, colony: colonyToPlain(s.colony), st: storyToPlain(s.st), rel: s.rel, chron: s.chron,
    ...(typeof s.legend === 'string' && s.legend ? { legend: s.legend } : {}),   // Z2: the Annals (OPTIONAL_KEYS)
  };
  for (const [key, kind] of Object.entries(COLLECTIONS)) {
    if (key === 'items') ent.items = packItems(s.items);
    else ent[key] = rowsOf(kind, s[key]);
  }
  return ent;
}
/** The sync part of an EC3 save: { header (format 3), payload }. Needs the state's pristine world. */
function snapshot3(s, opts) {
  const p = opts.pristine || pristineOf(s);
  if (!p) throw new Error('This hold has no world record to save against.');
  if (p.w !== s.w || p.h !== s.h || p.d !== s.d || p.zS !== s.zS) throw new Error('The world record does not fit this hold.');
  remember(p);
  const g = chunkGeom(s.w, s.h, s.d);
  const layers = LAYERS3.map((l) => {
    const bitset = l.enc === 1, len = layerLen3(l, g.n), cur = s.L[l.name] || zeros(len);
    if (cur.length !== len) throw new Error(`EC3: layer ${l.name} has ${cur.length} bytes, expected ${len}`);
    if (opts.raw) return { id: l.id, enc: bitset ? ENC.BITSET : ENC.RAW, bytes: cur };
    return { id: l.id, enc: ENC.XOR, bytes: xorEncode(g, cur, PRISTINE_LAYERS.includes(l.name) ? p.layers[l.name] : null, bitset) };
  });
  const embed = !!opts.embed;
  // a sync blob (the RLE quick-save) must load synchronously too: its copy is never deflated
  const rec = !embed ? null : opts.sync ? (p.bytes && p.bytesComp !== COMP.DEFLATE ? p.bytes : encodePristineSync(p)) : (p.bytes || encodePristineSync(p));
  const rt = encodeRuntime(s, raidLive(s), RT_VERSION3);
  const header = {
    format: 3, stateVersion: STATE_VERSION, w: s.w, h: s.h, d: s.d, zS: s.zS, genVersion: p.genVersion | 0, worldKind: p.worldKind,
    flags: embed ? FLAG_PRISTINE : 0, tick: s.tick, pristineId: p.id, pristineCrc: p.crc,
  };
  return { header, payload: framePayload3(rec, layers, JSON.stringify(entitiesOfState(s)), rt) };
}

/** The live layers of an EC3 payload: the pristine world plus the XOR chunks (5.2 step 4). */
function layersOf3(header, sec, p) {
  const g = chunkGeom(header.w, header.h, header.d), L = {};
  for (const l of LAYERS3) {
    const bitset = l.enc === 1, len = layerLen3(l, g.n), { enc, bytes } = sec.layers[l.name];
    if (enc === ENC.RAW || enc === ENC.BITSET) {
      if (bytes.length !== len) throw new Error(`This save is damaged (layer ${l.name} has the wrong size).`);
      L[l.name] = bytes.slice();
      continue;
    }
    if (enc !== ENC.XOR) throw new Error(`This save uses an unknown map encoding (${enc}).`);
    const base = PRISTINE_LAYERS.includes(l.name) ? p.layers[l.name].slice() : new Uint8Array(len);
    L[l.name] = xorApply(g, base, bytes, bitset);
  }
  return L;
}

const recent = new Map();   // pristineId -> pristine object, the last two this page used (a re-load needs no store)
const remember = (p) => { recent.delete(p.id); recent.set(p.id, p); while (recent.size > 2) recent.delete(recent.keys().next().value); return p; };
/** Forget the pristine worlds this page holds (tests: the store and fallbacks must be exercised). */
export function forgetPristine() { recent.clear(); }

async function pristineFor(header, sec, seed, opt) {
  let p = null;
  if (opt && typeof opt === 'object') p = opt;
  else if (typeof opt === 'function') p = await opt({ header, embedded: sec.pristine, seed });
  else if (sec.pristine) p = await decodePristine(sec.pristine);
  else p = recent.get(header.pristineId) || null;
  if (!p || !pristineMatches(p, header)) throw new Error(MISSING_TEXT);
  return remember(p);
}
function pristineForSync(header, sec, opt) {
  let p = opt && typeof opt === 'object' ? opt : sec.pristine ? decodePristineSync(sec.pristine) : recent.get(header.pristineId) || null;
  if (!p || !pristineMatches(p, header)) throw new Error(MISSING_TEXT);
  return remember(p);
}
/** Payload of an EC3 blob -> { sec, ent } (sections, migrated ENTITIES); refuses newer states. */
function open3(header, payload) {
  if (header.stateVersion > STATE_VERSION) throw new Error('This colony was saved by a newer version of the game.');
  const sec = unframePayload3(payload, (header.flags & FLAG_PRISTINE) !== 0);
  let ent;
  try { ent = JSON.parse(sec.entities); } catch (_) { throw new Error('This save is damaged (its contents could not be read).'); }
  return { sec, ent: migrate(ent, header.stateVersion) };
}
function restore3(header, sec, ent, p) {
  setMapSize(header.w, header.h, header.d, header.zS);
  const L = layersOf3(header, sec, p);
  const s = build(ent, L, sec.runtimeBytes, 2);
  s.d = header.d; s.zS = header.zS;
  attachPristine(s, p);
  return finish(s);
}

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
  return finish(build(ent, sec.layers, fmt >= 2 ? sec.runtimeBytes : sec.runtime, fmt));
}
/** ENTITIES + live layers + RUNTIME -> a state with entities, paths and the saved rt keys (s.rt pending). */
function build(ent, layers, runtime, fmt) {
  const m = ent.meta;
  const s = {
    v: STATE_VERSION, id: m.id, name: m.name, seed: m.seed, w: m.w, h: m.h, tick: m.tick, speed: m.speed,
    rng: { ...ent.rng }, next: { ...ent.next }, L: layers,
    colony: colonyFromPlain(ent.colony), st: storyFromPlain(ent.st),
    col: [], items: [], bld: [], zones: [], anim: [], foes: [], raids: [],
    rel: ent.rel, chron: ent.chron,
    ...(typeof ent.legend === 'string' && ent.legend ? { legend: ent.legend } : {}),
  };
  let rt, paths = null;
  if (fmt >= 2) {
    const fl = ent.fl || {};
    for (const [key, kind] of Object.entries(COLLECTIONS)) {
      if (key === 'items') s.items = unpackItems(ent.items || { strs: [], a: [], xs: [] });
      else s[key] = entitiesOf(kind, ent[key] || [], fl[kind] || null);
    }
    ({ rt, paths } = decodeRuntime(runtime));
  } else {
    for (const [key, kind] of Object.entries(COLLECTIONS)) s[key] = (ent[key] || []).map((r) => fromRow(kind, r));
    rt = liveRtV1(runtime);
  }
  if (paths) for (const [key, kind] of Object.entries(COLLECTIONS)) {
    if (!PATH_KINDS[kind]) continue;
    const pm = paths[kind];
    if (pm && pm.size) for (const e of s[key]) if (e && pm.has(e.id)) e.path = pm.get(e.id);
  }
  s.rt = null;
  s._rt = rt;
  return s;
}
function finish(s) {
  const rt = s._rt; delete s._rt;
  initRuntime(s);
  for (const k of Object.keys(rt)) s.rt[k] = rt[k];
  return s;
}

/** Read the ENTITIES of either format without building a state (peek, import). */
export async function peekEntities(bytes) {
  if (blobKind(bytes) === 'EC3') {
    const { header, payload } = await decodeAny(bytes);
    const sec = unframePayload3(payload, (header.flags & FLAG_PRISTINE) !== 0);
    return { header, ent: JSON.parse(sec.entities), embedded: sec.pristine };
  }
  const { header, payload } = await decodeBlob(bytes);
  header.format = 2;
  return { header, ent: JSON.parse(unframePayload(payload).entities), embedded: null };
}

export async function loadBlob(bytes, opts = {}) {
  if (blobKind(bytes) !== 'EC3') { const { header, payload } = await decodeBlob(bytes); return restore(header, payload); }
  const { header, payload } = await decodeAny(bytes);
  const { sec, ent } = open3(header, payload);
  const p = await pristineFor(header, sec, ent.meta && ent.meta.seed, opts.pristine);
  return restore3(header, sec, ent, p);
}
/**
 * The world of an EC3 blob without building a state (no initRuntime): { header, ent, L, pristine }. Tools,
 * the migration checks and the browser storage check use it; the pristine option is as for loadBlob.
 */
export async function decodeWorld(bytes, opts = {}) {
  const { header, payload } = await decodeAny(bytes);
  if (header.format !== 3) throw new Error('Not an EC3 save.');
  const { sec, ent } = open3(header, payload);
  const p = await pristineFor(header, sec, ent.meta && ent.meta.seed, opts.pristine);
  return { header, ent, L: layersOf3(header, sec, p), pristine: p };
}
export function loadBlobSync(bytes, opts = {}) {
  if (blobKind(bytes) !== 'EC3') { const { header, payload } = decodeBlobSync(bytes); return restore(header, payload); }
  const { header, payload } = decodeAnySync(bytes);
  const { sec, ent } = open3(header, payload);
  return restore3(header, sec, ent, pristineForSync(header, sec, opts.pristine));
}
