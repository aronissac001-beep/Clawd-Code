// Migration v4 to v5 (owner A with L; review B and K; EMBERCROWN-WORLD.md 9.4). Part 1 (W2.8): shape only.
// Part 2 (W3.6): a world around the old hold (holdProfile, worldParams, chartWorld, settleWorld, migrateHold below).
//
//   v4to5(ent)          `migrations[3]` (state.js): the ENTITIES of a stateVersion 4 save -> stateVersion 5, in place.
//                       A pure function of that object; it never sees the layers or the runtime.
//   weatherToV2(w)      the 6.2 weather record step v1 -> v2 (the current kind kept, calm scalars, no front): a pure
//                       function of the record, for the step that brings the v2 record (W5.1)
//   isWeatherV2(w)      true when a weather record is v2
//
// Part 1, step by step:
//   1. `realm = null`: the hold has no world yet (part 2, W3.6, gives it one: "Charting the wider world").
//   2. The weather record stays v1 here while CLIMATE2 is off. The v2 record (fronts, wind, cloud, fog, wet, snow)
//      arrives with W5.1, which is a declared re-baseline (12.1); converting it now would move every legacy hash and
//      the v1 weather code would ignore the new fields anyway. A v5 save made before W5.1 still holds a v1 record, so
//      weatherToV2 is keyed on the record's own `v` (missing = 1), not on the state version: W5.1 runs it on load for
//      every record that is not yet v2 (and v4to5 runs it here once CLIMATE2 is on).
//   3. `air` is RUNTIME (6.3), and there is no `air` runtime key until W5.9 (its re-baseline). The runtime decoder
//      gives a saved key a v4 save lacks its allocated default, which for `air` will be all zeros, so nothing is
//      written here.
// Local state is untouched: no layer, pristine CRC, entity, stock or RNG stream changes, so a v4 hold continues
// exactly as it did (the legacy-hash rule of 12.1; tools/tests/migrate5.test.mjs).

import * as FLAGS from './flags.js';
import { TER, TER_WATER } from './grid.js';
import { hash32 } from './rand.js';
import { yearOf } from './time.js';
// the shipped registry, not core/content.js: importing content.js from here (state.js imports this module) changes
// the module evaluation order and breaks the idx rebuild check (rt-contract test, determinism (e))
import { CONTENT } from '../../data/index.js';
import { pristineOf } from '../save/pristine.js';
import { REALM_FIELD_V } from './schema.js';
import { createRealm, normalizePin } from '../realm/gen.js';
import { regionOpts } from '../realm/region.js';
import { recordParts } from '../realm/record.js';
import { bindRoles } from '../colony/factions.js';
import { CIVKINDS } from '../../data/realm/civkinds.js';
import { addChron } from '../colony/chronicle.js';

export const WEATHER_V = 2;
/** The calm v2 scalars (6.2 migration: calm, wet 0, snow 0, no front). */
const CALM = Object.freeze({ wind: [0, 0], cloud: 0, fog: 0, wet: 0, snow: 0 });

export const isWeatherV2 = (w) => !!w && typeof w === 'object' && w.v === WEATHER_V;

/** A weather record v1 -> v2 (a new object; a v2 record is returned as it is). hourAt starts at `since`. */
export function weatherToV2(w) {
  if (isWeatherV2(w)) return w;
  const o = w && typeof w === 'object' ? w : {};
  const int = (v, d) => (Number.isInteger(v) ? v : d);
  return {
    v: WEATHER_V, kind: typeof o.kind === 'string' ? o.kind : 'clear', since: int(o.since, 0), until: int(o.until, 0), day: int(o.day, -1),
    front: null, wind: CALM.wind.slice(), cloud: CALM.cloud, fog: CALM.fog, wet: CALM.wet, snow: CALM.snow, hourAt: int(o.since, 0),
  };
}

/** migrations[3]: ENTITIES v4 -> v5 (9.4 part 1). */
export function v4to5(ent) {
  // 1. no world yet (a malformed value is dropped: a hold never fails to load over its realm field, 9.2)
  const r = ent.realm;
  if (!r || typeof r !== 'object' || Array.isArray(r) || !Number.isInteger(r.wid)) ent.realm = null;
  // 2. weather v2 only once the climate front record exists (W5.1 turns CLIMATE2 on with its re-baseline)
  if (FLAGS.CLIMATE2 === true) {
    const w = ent.colony && ent.colony.world;
    if (w && w.weather && !isWeatherV2(w.weather)) w.weather = weatherToV2(w.weather);
  }
  // 3. air: nothing to write (see the header)
  if (ent.meta) ent.meta.migratedFrom = ent.meta.migratedFrom || 4;
  return ent;
}

// ---- Part 2 (W3.6): a world around the old hold ----------------------------------------------------------------
// It runs on the first load after W3 for a hold with no world (needsWorld), behind the chunked "Charting the wider
// world" screen (the loader drives migrateHold, one generator step per frame), and it is a pure function of the save:
//   1. worldParams: worldSeed = hash32(s.seed, 'realm'), Standard, 250 years, Normal sliders, the generated name;
//   2. holdProfile (from the pristine world, else the live layers): the massif side, river, lake, aquifer share and
//      biome; createRealm(params with `pin`) picks the region, forces it to the profile and keeps it settled and
//      empty through history, with a human civ within 8 regions (realm/gen.js pinRegion, forcePin, pinFaults);
//   3. the caller stores the record (save/realmstore.js writeRealm) before settleWorld; the next dawn embeds it;
//   4-8. settleWorld: s.realm (the pinned region, the years, embark), the roles bound with goodwill kept (K's
//      bindRoles), the liege, the Chronicle line; the vale's pre-history dates itself in world years from
//      embarkYear (colony/legends.js valeChapter), its p<n> keys unchanged. The "What is new" world card is the
//      UI's (ui/intros.js queueWhatsNew(id, ['world'])) once migrateHold returns.
// The hold's local map, its pristine world, entities and stocks are not touched: only s.realm, s.rt.realm and one
// Chronicle row change. Not tick-identical across the upgrade (realm caravans and raids), deterministic after it.
export const CHRON_WORLD = 'chron_world';   // "Year {year}: the hold learned of the wider world" (text: G, js/data/text/chronicle.js)
export const CHART_PHASES = Object.freeze(['plates', 'elevation', 'temperature', 'rainfall', 'drainage', 'rivers', 'geology', 'biomes', 'guarantees', 'history']);
const SIDES = ['n', 'e', 's', 'w'];

/** Does this hold need a world (part 2)? A deep hold with no realm that has not fallen, once HISTORY is on (or `on`). */
export function needsWorld(s, { on = FLAGS.HISTORY === true } = {}) {
  return !!(on && s && !s.realm && (s.d || 1) > 1 && !(s.colony && s.colony.fallen === true));
}

/**
 * The hold's profile for the pin (9.4 part 2 step 2), read from its pristine world (the world as it was made; the
 * live layers when the state has none): massif side = the side the centroid of the columns with rock one level above
 * the surface leans to (ties: the x axis; no massif: 'n'); river = a body of water at the surface that reaches the map
 * edge; lake = one of at least 12 cells that does not; aquiferPct = the share of the valley (non-massif) columns with
 * water two levels down (mapgen3's wet-sand aquifer); biome = the start's map.biome, else greenvale.
 */
export function holdProfile(s) {
  const p = pristineOf(s), L = p && p.layers ? p.layers : s.L, w = s.w, h = s.h, P = w * h, zs = s.zS | 0;
  const t = L.terrain, fl = L.fluid;
  let mx = 0, my = 0, mk = 0;
  const massif = new Uint8Array(P);
  if (zs + 1 < (s.d || 1)) for (let c = 0; c < P; c++) if (t[(zs + 1) * P + c] !== TER.AIR) { massif[c] = 1; mx += c % w; my += (c / w) | 0; mk++; }
  let side = 'n';
  if (mk) {
    const dx = 2 * mx - mk * (w - 1), dy = 2 * my - mk * (h - 1);   // 2 * mk * (centroid - centre): integers only
    side = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'w' : 'e') : (dy < 0 ? 'n' : 's');
  }
  // bodies of surface water (4-connected): one reaching the edge is the river, an inland one of >= 12 cells a lake
  const seen = new Uint8Array(P), wet = (c) => TER_WATER[t[zs * P + c]] === 1;
  let river = false, lake = false;
  const stack = [];
  for (let c0 = 0; c0 < P; c0++) {
    if (seen[c0] || !wet(c0)) continue;
    let n = 0, edge = false;
    stack.push(c0); seen[c0] = 1;
    while (stack.length) {
      const c = stack.pop(), x = c % w, y = (c - x) / w;
      n++;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge = true;
      if (x > 0 && !seen[c - 1] && wet(c - 1)) { seen[c - 1] = 1; stack.push(c - 1); }
      if (x < w - 1 && !seen[c + 1] && wet(c + 1)) { seen[c + 1] = 1; stack.push(c + 1); }
      if (y > 0 && !seen[c - w] && wet(c - w)) { seen[c - w] = 1; stack.push(c - w); }
      if (y < h - 1 && !seen[c + w] && wet(c + w)) { seen[c + w] = 1; stack.push(c + w); }
    }
    if (edge) river = true; else if (n >= 12) lake = true;
  }
  let aq = 0, valley = 0;
  if (fl && zs >= 2) for (let c = 0; c < P; c++) { if (massif[c]) continue; valley++; if (fl[(zs - 2) * P + c]) aq++; }
  const st = s.colony && s.colony.starts ? CONTENT.get('start', s.colony.starts) : null;
  const biome = st && st.map && typeof st.map.biome === 'string' ? st.map.biome : 'greenvale';
  return normalizePin({ side: SIDES.includes(side) ? side : 'n', river, lake, aquiferPct: valley ? Math.round((aq * 100) / valley) : 0, biome });
}

/** The world parameters of a migrated hold (step 1): its own seed, Standard, 250 years, Normal sliders, the pin. */
export function worldParams(s, profile = holdProfile(s)) {
  return { seed: hash32(s.seed >>> 0, 'realm'), size: 'standard', history: 250, peoples: 'normal', wildness: 'normal', hollowing: 'normal', sea: 'random', pin: profile };
}

/** Steps 1-2: the world around the hold, as a generator of { phase, k, of } (createRealm's, history included); returns the realm with realm.pin. */
export function* chartWorld(s) {
  return yield* createRealm(worldParams(s), { history: true });
}

/** The raid and caravan edges of the pinned region with the hold's massif side shut (it is rock on the hold's own map). */
function shutMassif(edges, side) {
  const e = JSON.parse(JSON.stringify(edges || { caravan: {}, raid: {} }));
  for (const k of ['caravan', 'raid']) { if (!e[k]) e[k] = {}; e[k][side] = 0; }
  return e;
}

/** The liege of a pinned hold (step 4): the nearest living human kingdom, else the nearest living human civ (by its nearest living site; ties: the lower id), else null. */
function liegeNear(realm, rx, ry) {
  const T = realm.tables, d = new Map();
  for (const x of T.sites) {
    const c = x.razed === null && x.civ !== null ? T.civs[x.civ] : null;
    if (!c || c.fell !== null || c.people !== 'human') continue;
    const k = Math.max(Math.abs(x.x - rx), Math.abs(x.y - ry)), o = d.get(c.id);
    if (o === undefined || k < o) d.set(c.id, k);
  }
  let best = null, key = null;
  for (const [id, k] of d) {
    const c = T.civs[id], kind = typeof c.kind === 'number' ? (CIVKINDS[c.kind] || {}).id : c.kind, rank = [kind === 'realm' ? 0 : 1, k, id];
    if (!key || rank[0] < key[0] || (rank[0] === key[0] && (rank[1] < key[1] || (rank[1] === key[1] && rank[2] < key[2])))) { best = id; key = rank; }
  }
  return best;
}

/**
 * Steps 4-8 on the loaded state, once the record is stored: s.realm for the pinned region (embarkYear = the history's
 * years, year = embarkYear + the hold's game years; embark = the region's opts for display with climate null, so the
 * weather keeps the greenvale row of today, and the massif side shut to raids and caravans), s.rt.realm = the record,
 * the five roles bound (goodwill untouched), the liege, and the Chronicle line. Returns s.realm.
 */
export function settleWorld(s, realm) {
  if (!realm || !realm.pin) throw new Error('settleWorld: the world has no pinned region');
  const { rx, ry } = realm.pin, years = realm.years | 0;
  const o = regionOpts(realm, rx, ry);
  const embark = { ...o, climate: null, edges: shutMassif(o.edges, o.side), pinned: true };
  s.realm = {
    v: REALM_FIELD_V, wid: realm.wid >>> 0, seed: realm.seed >>> 0, gv: realm.gv | 0, params: JSON.parse(JSON.stringify(realm.params || {})),
    crc: recordParts(realm).crc.map((c) => c >>> 0), rx, ry, civ: null, embarkYear: years, year: years + yearOf(s.tick),
    embark, prep: null, bind: {}, stand: [], sites: [], wars: [], dead: [], ev: [],
  };
  if (!s.rt) s.rt = {};
  s.rt.realm = realm;
  s.realm.civ = liegeNear(realm, rx, ry);   // bindRoles gives hearthwatch to s.realm.civ while it lives
  const bind = bindRoles(s, realm);
  s.realm.civ = bind && Number.isInteger(bind.hearthwatch) ? bind.hearthwatch : null;
  addChron(s, 'world', CHRON_WORLD, { year: s.realm.year });
  return s.realm;
}

/**
 * The whole of part 2 for the loader: chartWorld in steps (after each step, `frame()` is awaited once at least
 * `budgetMs` has passed, so no frame runs long; `progress({ phase, k, of })` may draw the screen), then
 * `write(realm)` stores the record (writeRealm: written, read back, CRC-checked; a throw leaves the hold as it was),
 * then settleWorld. Returns { realm, field }. `now` is the caller's clock (performance.now in the browser; the sim
 * reads no clock): without one, `frame()` is awaited after every step.
 */
export async function migrateHold(s, { write = null, frame = null, progress = null, budgetMs = 30, now = null } = {}) {
  const it = chartWorld(s);
  let t0 = now ? now() : 0, r;
  for (;;) {
    r = it.next();
    if (r.done) break;
    if (progress) progress(r.value);
    if (frame && (!now || now() - t0 >= budgetMs)) { await frame(); if (now) t0 = now(); }
  }
  const realm = r.value;
  if (write) await write(realm);
  return { realm, field: settleWorld(s, realm) };
}
