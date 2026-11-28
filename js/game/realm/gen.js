// Realm generation (EMBERCROWN-WORLD.md 1.1-1.5, steps 1-8 and 11 of 1.2; owner L).
//   for (const p of createRealm(params)) ...   // a generator: yields { phase, k, of } per phase, returns the realm
//   const realm = buildRealm(params);          // the same, run to the end
// History (step 9) and roads (step 10) are W3: until then the tables are empty and the world is "unsettled".
// The pin (9.4 part 2 step 2, W3.6): params.pin (a legacy hold's profile) adds one rule after step 8: pinRegion picks
// the region the old hold stands in, forcePin gives it the profile, and history treats it as settled and empty.
// Deterministic on every engine (tools/check-realm.mjs compares Node with the browsers); never reads s.rng.
import { hashString, seedOf } from '../core/rand.js';
import { REALM_GEN, SIZES, PARAM_ROWS, NAME_PARTS, GEN, START_FIT } from '../../data/realm/params.js';
import { allocFields, platesStep, elevationStep, temperatureStep, rainStep, drainageStep, drainLakes, geologyStep, stream, gen, ri } from './fields.js';
import { riversStep, riverFaults } from './rivers.js';
import { biomesStep } from './biomes.js';
import { hash32, isEmbarkable, startFits, idx as ridx, isCoast, isLake, riverClass } from './query.js';
import { REALM_BIOMES, BIOME_INDEX } from '../../data/realm/biomes.js';
import { FLOW } from './rivers.js';
import { CIVKINDS } from '../../data/realm/civkinds.js';
import { BAND, bandOf } from './biomes.js';
import { regionOpts } from './region.js';
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
  const pin = normalizePin(p.pin);
  if (pin) out.pin = pin;   // only when set: a world without a pin normalizes (and hashes) as before
  return out;
}

// ---- the pin (9.4 part 2 step 2; W3.6) ---------------------------------------------------------------------
const SIDES = Object.freeze(['n', 'e', 's', 'w']);
/** The pin rule's numbers: the search radius around the centre and the human-civ reach, in Standard regions. */
export const PIN = Object.freeze({ radius: 12, humanReach: 8 });
/** A legacy hold's profile { side, river, lake, aquiferPct, biome } with bad values dropped, or null. */
export function normalizePin(p) {
  if (!p || typeof p !== 'object' || !SIDES.includes(p.side)) return null;
  const aq = Number.isInteger(p.aquiferPct) ? Math.max(0, Math.min(100, p.aquiferPct)) : 0;
  const bio = typeof p.biome === 'string' && BIOME_INDEX[p.biome] !== undefined && REALM_BIOMES[BIOME_INDEX[p.biome]].embark ? p.biome : 'greenvale';
  return { side: p.side, river: p.river === true, lake: p.lake === true, aquiferPct: aq, biome: bio };
}
const kindId = (c) => (typeof c.kind === 'number' ? (CIVKINDS[c.kind] || {}).id : c.kind);
const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
/**
 * The region a pinned hold stands in: among embarkable, temperate, moist lowland or upland regions off the coast
 * within PIN.radius of the centre whose massif side (regionOpts: the side of the highest neighbour) is the hold's,
 * the best by river match (100), lake match (30), biome match (20), aquifer closeness and nearness to the centre;
 * ties by the lower index. Widens to the whole map, then drops the climate and side terms, when none qualifies.
 * Returns { rx, ry, i, tier } (tier 0 is the rule as written).
 */
export function pinRegion(realm, pin) {
  const { n, fields: f } = realm, C = GEN.classify, c = (n - 1) >> 1, rad = Math.round(PIN.radius * n / 64);
  const tiers = [{ r: rad, clim: true, side: true }, { r: n, clim: true, side: true }, { r: n, clim: false, side: true }, { r: n, clim: false, side: false }];
  for (let t = 0; t < tiers.length; t++) {
    const T = tiers[t];
    let best = null, bs = -Infinity;
    for (let ry = 0; ry < n; ry++) for (let rx = 0; rx < n; rx++) {
      const d = cheb(rx, ry, c, c);
      if (d > T.r) continue;
      const i = ridx(realm, rx, ry);
      if (!isEmbarkable(realm, i)) continue;
      const b = bandOf(f.elev[i], realm.bands);
      if (T.clim && (b !== BAND.LOW && b !== BAND.UP || f.temp[i] < C.cold || f.temp[i] >= C.warm || f.rain[i] < C.dry || isCoast(realm, i))) continue;
      const o = regionOpts(realm, rx, ry);
      if (T.side && (o.side !== pin.side || o.sea)) continue;
      const sc = ((riverClass(realm, i) > 0) === pin.river ? 100 : 0) + (isLake(realm, i) === pin.lake ? 30 : 0) + (o.biome === pin.biome ? 20 : 0)
        - Math.abs(o.aquiferPct - pin.aquiferPct) / 4 - d / 2;
      if (sc > bs) { bs = sc; best = { rx, ry, i, tier: t }; }
    }
    if (best) return best;
  }
  throw new Error('pinRegion: the world has no embarkable region');
}
/** Force region i to the profile: its biome, its lake flag, and a river (class 1, out along the drainage) when the hold has one and it has none. */
export function forcePin(realm, i, pin) {
  const f = realm.fields;
  f.biome[i] = BIOME_INDEX[pin.biome];
  f.flow[i] = pin.lake ? f.flow[i] | FLOW.LAKE : f.flow[i] & ~FLOW.LAKE;
  if (pin.river && !(f.flow[i] & FLOW.CLS)) f.flow[i] = (f.flow[i] & ~FLOW.CLS) | (1 << FLOW.CLS_SHIFT);
  if (!pin.river && (f.flow[i] & FLOW.CLS)) f.flow[i] &= ~FLOW.CLS;
}
/**
 * History over a realm with regions `settled` (indices) held settled and empty (9.4 part 2 step 2; W3.7 marks its
 * embarked holds' regions the same way): while it runs their elevation reads as sea, so no capital, town, battlefield
 * or lair is placed there and no road crosses them; the land is restored before the generator returns.
 */
export function* historyAround(realm, settled, reroll = 0) {
  const f = realm.fields, keep = settled.map((i) => f.elev[i]), below = realm.seaLevel > 0 ? realm.seaLevel - 1 : 0;
  for (const i of settled) f.elev[i] = below;
  try { yield* historyGen(realm, reroll); } finally { settled.forEach((i, k) => { f.elev[i] = keep[k]; }); }
}
/**
 * The pin's own history guarantees: a living human kingdom (kind 'realm', the liege of 9.4 step 4; with `kingdom`
 * false, a human civ of any kind) with a site within PIN.humanReach (scaled), and no site in the region. createRealm
 * re-rolls history for the kingdom; when no re-roll gives one it takes the first that gives a human civ.
 */
export function pinFaults(realm, kingdom = true) {
  if (!realm.pin) return [];
  const T = realm.tables, reach = Math.max(3, Math.round(PIN.humanReach * realm.n / 64)), { rx, ry } = realm.pin, fails = [];
  const ok = T.sites.some((s) => s.razed === null && s.civ !== null && T.civs[s.civ] && T.civs[s.civ].fell === null && T.civs[s.civ].people === 'human' && (!kingdom || kindId(T.civs[s.civ]) === 'realm') && cheb(s.x, s.y, rx, ry) <= reach);
  if (!ok) fails.push({ rule: 'pin', detail: `no human ${kingdom ? 'kingdom' : 'civ'} within ${reach} regions of the pinned region` });
  if (realm.fields.site[ridx(realm, rx, ry)]) fails.push({ rule: 'pin', detail: 'a site stands in the pinned region' });
  return fails;
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
export function* createRealm(params = {}, { history = HISTORY, settled = [] } = {}) {
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
  const held = settled.filter((i) => Number.isInteger(i) && i >= 0 && i < n * n);
  if (P.pin) {   // 9.4 part 2 step 2 (W3.6): the rule after step 8; a pinned world has its own id (never an unpinned world's)
    const at = pinRegion(realm, P.pin);
    forcePin(realm, at.i, P.pin);
    realm.pin = { rx: at.rx, ry: at.ry, tier: at.tier };
    realm.wid = hash32(P.seed, REALM_GEN.version, n, 'pin');
    if (!held.includes(at.i)) held.push(at.i);
  }
  if (history) {   // 2.3 (W3.1a): the years of history, re-rolled as 1.4 says; dark until the HISTORY flag
    let hr = 0, hf;
    const run = (r) => (held.length ? historyAround(realm, held, r) : historyGen(realm, r));
    let soft = -1;   // the first re-roll whose only fault is a pin without a human kingdom near (a human civ of another kind is)
    for (;;) {
      yield* run(hr);
      const base = checkHistory(realm);
      hf = base.concat(pinFaults(realm));
      if (!hf.length) break;
      if (soft < 0 && !base.length && !pinFaults(realm, false).length) soft = hr;
      if (hr >= GEN.guarantee.rerolls) {
        if (soft >= 0) { if (soft !== hr) yield* run(soft); hf = checkHistory(realm).concat(pinFaults(realm, false)); }
        break;
      }
      hr++;
    }
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
