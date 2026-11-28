// Realm generation (EMBERCROWN-WORLD.md 1.1-1.5, steps 1-8 and 11 of 1.2; owner L).
//   for (const p of createRealm(params)) ...   // a generator: yields { phase, k, of } per phase, returns the realm
//   const realm = buildRealm(params);          // the same, run to the end
// History (step 9) and roads (step 10) are W3: until then the tables are empty and the world is "unsettled".
// Deterministic on every engine (tools/check-realm.mjs compares Node with the browsers); never reads s.rng.
import { hashString, seedOf } from '../core/rand.js';
import { REALM_GEN, SIZES, PARAM_ROWS, NAME_PARTS, GEN, START_FIT } from '../../data/realm/params.js';
import { allocFields, platesStep, elevationStep, temperatureStep, rainStep, drainageStep, drainLakes, geologyStep, stream, gen, ri } from './fields.js';
import { riversStep, riverFaults } from './rivers.js';
import { biomesStep } from './biomes.js';
import { hash32, isEmbarkable, startFits } from './query.js';
import { REALM_BIOMES } from '../../data/realm/biomes.js';
import { historyGen, checkHistory } from './history.js';
import { HISTORY } from '../core/flags.js';

export const REALM_V = 1;
/** The layers of 1.1 in their fixed record order (9.2). */
export const LAYERS = Object.freeze(['elev', 'temp', 'amp', 'rain', 'drain', 'volc', 'taint', 'wild', 'geo', 'biome', 'flow', 'site', 'owner', 'road']);
export const PHASES = Object.freeze(['plates', 'elevation', 'temperature', 'rainfall', 'drainage', 'rivers', 'geology', 'biomes', 'guarantees']);

/** A generated world name for a seed (offered on the Create world sheet, 1.5). */
export function worldName(seed) {
  const h = hash32(seedOf(seed), 'name'), a = NAME_PARTS.a, b = NAME_PARTS.b;
  return a[h % a.length] + b[(h >>> 8) % b.length];
}

/** Params of 1.5 with defaults filled and bad values replaced by the default. */
export function normalizeParams(p = {}) {
  const out = {};
  for (const k of Object.keys(PARAM_ROWS)) {
    const row = PARAM_ROWS[k], v = p[k];
    out[k] = row.values.includes(v) ? v : row.def;
  }
  out.seed = p.seed === undefined || p.seed === null || p.seed === '' ? 1 : seedOf(p.seed);
  const name = typeof p.name === 'string' ? p.name.trim().slice(0, 24) : '';
  out.name = name || worldName(out.seed);
  return out;
}

/** The sea sides (1-3 of 'n', 'e', 's', 'w') for the params, from the 'sea' stream. */
function seaSides(params) {
  const R = gen(stream('sea', params.seed)), all = ['n', 'e', 's', 'w'];
  const k = params.sea === 'random' ? ri(R, 1, 3) : params.sea;
  for (let i = 3; i > 0; i--) { const j = ri(R, 0, i); const t = all[i]; all[i] = all[j]; all[j] = t; }
  return all.slice(0, k).sort();
}

/** Step 11 (1.4): the failing guarantees of a built realm: [{ rule, detail }]. The civ rules wait for W3. */
export function checkRealm(realm) {
  const { n, fields: f, params } = realm, N = n * n, G = GEN.guarantee, fails = [];
  let embark = 0;
  const biomes = new Set(), fit = Object.fromEntries(Object.keys(START_FIT).map((k) => [k, 0]));
  for (let i = 0; i < N; i++) {
    if (!isEmbarkable(realm, i)) continue;
    embark++; biomes.add(f.biome[i]);
    for (const k of Object.keys(fit)) if (startFits(realm, i, k)) fit[k]++;
  }
  if (embark < G.embark[params.size]) fails.push({ rule: 'embark', detail: `${embark} embarkable regions, need ${G.embark[params.size]}` });
  if (biomes.size < G.biomes[params.size]) fails.push({ rule: 'biomes', detail: `${biomes.size} embarkable biomes, need ${G.biomes[params.size]}` });
  for (const k of Object.keys(fit)) if (!fit[k]) fails.push({ rule: 'start', detail: `no region fits the start ${k}` });
  const rv = riverFaults(f, n, realm.seaLevel);
  if (rv.length) fails.push({ rule: 'rivers', detail: rv.slice(0, 3).join('; ') });
  return fails;
}

/**
 * createRealm(params): a generator over the phases of 1.2 (steps 1-8, 11). Each yield is { phase, k, of };
 * the return value is the realm: { v, gv, wid, seed, n, params, sides, seaLevel, bands, fields, plates,
 * hotspots, falls, tables, events, warnings, rerolls }. A failed guarantee re-rolls the land (steps 1-2, the
 * plates and elevation streams with re-roll index r) up to GEN.guarantee.rerolls times, then is accepted with
 * a warning row.
 */
export function* createRealm(params = {}, { history = HISTORY } = {}) {
  const P = normalizeParams(params), n = SIZES[P.size], of = PHASES.length;
  const rx = { n, sc: n / 64, seed: P.seed, params: P, sides: seaSides(P), f: null };
  let realm = null, fails = [], r = 0;
  for (;;) {
    rx.f = allocFields(n);
    let k = 0;
    platesStep(rx, r); yield { phase: 'plates', k: k++, of };
    elevationStep(rx, r); yield { phase: 'elevation', k: k++, of };
    temperatureStep(rx); yield { phase: 'temperature', k: k++, of };
    rainStep(rx); yield { phase: 'rainfall', k: k++, of };
    drainageStep(rx); yield { phase: 'drainage', k: k++, of };
    riversStep(rx); drainLakes(rx); yield { phase: 'rivers', k: k++, of };
    geologyStep(rx); yield { phase: 'geology', k: k++, of };
    biomesStep(rx); yield { phase: 'biomes', k: k++, of };
    realm = {
      v: REALM_V, gv: REALM_GEN.version, wid: hash32(P.seed, REALM_GEN.version, n), seed: P.seed, n, params: P,
      sides: rx.sides, seaLevel: rx.seaLevel, bands: rx.bands, fields: rx.f,
      plates: rx.plates.map((p) => ({ ...p })), hotspots: rx.hotspots, falls: rx.falls,
      tables: { civs: [], sites: [], figures: [], beasts: [], artifacts: [], wars: [] }, events: [], warnings: [], rerolls: r,
    };
    fails = checkRealm(realm);
    yield { phase: 'guarantees', k: k++, of };
    if (!fails.length || r >= GEN.guarantee.rerolls) break;
    r++;
  }
  for (const fl of fails) realm.warnings.push({ rule: fl.rule, detail: fl.detail });
  if (history) {   // 2.3 (W3.1a): the years of history, re-rolled as 1.4 says; dark until the HISTORY flag
    let hr = 0, hf;
    for (;;) { yield* historyGen(realm, hr); hf = checkHistory(realm); if (!hf.length || hr >= GEN.guarantee.rerolls) break; hr++; }
    for (const fl of hf) realm.warnings.push({ rule: 'history.' + fl.rule, detail: fl.detail });
  }
  return realm;
}

/** createRealm run to the end. */
export function buildRealm(params = {}, opts) {
  const it = createRealm(params, opts);
  for (;;) { const s = it.next(); if (s.done) return s.value; }
}

/** FNV-1a over bytes, folded into a running u32. */
function fnvBytes(h, bytes) {
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
/** The realm hash (tools/check-realm.mjs): every layer's bytes in LAYERS order, then the header, as 8 hex digits. */
export function realmHash(realm) {
  let h = 0x811c9dc5;
  for (const k of LAYERS) { const a = realm.fields[k]; h = fnvBytes(h, new Uint8Array(a.buffer, a.byteOffset, a.byteLength)); }
  const head = JSON.stringify({ v: realm.v, gv: realm.gv, wid: realm.wid, seed: realm.seed, n: realm.n, params: realm.params, sides: realm.sides,
    seaLevel: realm.seaLevel, bands: realm.bands, plates: realm.plates, hotspots: realm.hotspots, falls: realm.falls,
    tables: realm.tables, events: realm.events, warnings: realm.warnings, rerolls: realm.rerolls });
  h = (h ^ hashString(head)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

/** Counts for tools and tests: { land, sea, lakes, embark, rivers: [c1, c2, c3], biomes: { id: count } } over embarkable regions. */
export function realmStats(realm) {
  const f = realm.fields, N = realm.n * realm.n, out = { land: 0, sea: 0, lakes: 0, embark: 0, rivers: [0, 0, 0], biomes: {} };
  for (let i = 0; i < N; i++) {
    if (f.elev[i] < realm.seaLevel) { out.sea++; continue; }
    out.land++;
    if (f.flow[i] & 0x20) out.lakes++;
    const c = (f.flow[i] >> 3) & 3;
    if (c) out.rivers[c - 1]++;
    if (f.flow[i] & 0x80) { out.embark++; const id = REALM_BIOMES[f.biome[i]].id; out.biomes[id] = (out.biomes[id] || 0) + 1; }
  }
  return out;
}
