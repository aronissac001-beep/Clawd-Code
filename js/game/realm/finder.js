// The site finder, the reach rule and the region card's facts (EMBERCROWN-WORLD.md 3.2-3.4, 3.3; owner L; step W2.7b).
//   FILTERS                      the finder's rows (3.4) and their options; defaultFilters() the all-Any set
//   regionTraits(realm)          per-region feature arrays the scoring reads (built once per realm, cached)
//   scoreTraits(T, i, F)         -1 (a hard filter excludes region i) or its soft score (>= 0)
//   findSites(realm, F, o)       every allowed match, best first: { list: [{ rx, ry, i, score, q }], count }
//   reachOf(realm, rx, ry, o)    the parent-civ reach rule (3.2): { ok, unsettled, civs: [{ id, civ, days }], alone }
//   settleBlockOf(realm, rx, ry, o)  why Settle here is off: 'edge' | 'sea' | 'peak' | 'site' | 'used' | 'reach' | null
//   cardFacts(realm, rx, ry, o)  the region card's facts (3.3) as codes and numbers; the UI words them
// Pure reads of a realm (gen.js createRealm) and its opts.region (region.js); never reads s.rng or the DOM.
// Words live in the UI (js/ui/regioncard.js, finderui.js); this file returns codes so it stays testable in Node.
// Allowed regions (3.2): embarkable, no site, not used by an earlier hold of this world, and a parent civ within
// REACH_DAYS travel days (the W2 world has no civs yet: it is "unsettled" and every embarkable region is open).
import { GEN, START_FIT } from '../../data/realm/params.js';
import { REALM_BIOMES, BIOME_INDEX } from '../../data/realm/biomes.js';
import { DX, DY } from './fields.js';
import { BAND, bandOf } from './biomes.js';
import { idx, inside, isSea, isEmbarkable, band, riverClass, isLake, isCoast, startFits, neighbours, civOf, travelDays } from './query.js';
import { regionOpts, regionFacts } from './region.js';

export const REACH_DAYS = 12;
/** Starts that may found out of reach (3.2 exception): "No one will come to help". */
export const ALONE_STARTS = Object.freeze(['lone_ember', 'refugees']);
/** Days for the Neighbours filter: a site this close is "near"; none this close is "isolated". */
export const NEAR_DAYS = 6, ISOLATED_DAYS = 8;
export const GEMS = Object.freeze(['garnet', 'sapphire', 'emerald', 'ruby', 'amber']);
export const ORES = Object.freeze(['iron', 'copper', 'coal', 'gold', 'gems']);
/** Ore weight (% of the base vein count, worldgen.js GEN3.provinces) at or above which the card says "signs of" / "rumoured". */
export const ORE_SIGNS = 200, ORE_RUMOUR = 150;

/** The finder rows (3.4): id, kind ('multi' chips or 'one' segmented), options; 'any' is the neutral choice. */
export const FILTERS = Object.freeze([
  { id: 'biomes', kind: 'multi', opts: REALM_BIOMES.filter((b) => b.embark).map((b) => b.id) },
  { id: 'climate', kind: 'one', opts: ['cold', 'temperate', 'warm', 'any'] },
  { id: 'river', kind: 'one', opts: ['need', 'none', 'any'] },
  { id: 'lake', kind: 'one', opts: ['need', 'any'] },
  { id: 'aquifer', kind: 'one', opts: ['none', 'light', 'heavy', 'any'] },
  { id: 'mountain', kind: 'one', opts: ['thin', 'thick', 'any'] },
  { id: 'ores', kind: 'multi', opts: ORES },
  { id: 'ember', kind: 'one', opts: ['shallow', 'deep', 'any'] },
  { id: 'hollow', kind: 'one', opts: ['low', 'any', 'high'], soft: true },
  { id: 'wild', kind: 'one', opts: ['calm', 'any', 'wild'], soft: true },
  { id: 'neigh', kind: 'one', opts: ['traders', 'isolated', 'enemies', 'any'], soft: true },
  { id: 'fit', kind: 'start', opts: Object.keys(START_FIT) },
]);
/** Every row at Any (no chips, no start). */
export function defaultFilters() {
  return { biomes: [], climate: 'any', river: 'any', lake: 'any', aquifer: 'any', mountain: 'any', ores: [], ember: 'any', hollow: 'any', wild: 'any', neigh: 'any', fit: null };
}
/** A filter set read from storage: unknown keys and values dropped, the rest defaulted. */
export function cleanFilters(raw) {
  const F = defaultFilters();
  if (!raw || typeof raw !== 'object') return F;
  for (const row of FILTERS) {
    const v = raw[row.id];
    if (row.kind === 'multi') { if (Array.isArray(v)) F[row.id] = row.opts.filter((o) => v.includes(o)); }
    else if (row.kind === 'start') { if (typeof v === 'string' && row.opts.includes(v)) F[row.id] = v; }
    else if (typeof v === 'string' && row.opts.includes(v)) F[row.id] = v;
  }
  return F;
}

// ---- the word classes (shared by the finder, the card and the tests) --------------------------------------------
/** Climate class of a mean annual temperature (C): 'cold' below GEN.classify.cold, 'warm' at GEN.classify.warm and above. */
export const climateClass = (temp) => (temp < GEN.classify.cold ? 'cold' : temp >= GEN.classify.warm ? 'warm' : 'temperate');
/** Aquifer class of opts.region.aquiferPct: under 20 none, under 50 light, else heavy. */
export const aquiferClass = (pct) => (pct < 20 ? 'none' : pct < 50 ? 'light' : 'heavy');
/** Mountain class of opts.region.massifPct: 35 or under thin, 42 and over thick, else middling. */
export const massifClass = (pct) => (pct <= 35 ? 'thin' : pct >= 42 ? 'thick' : 'middling');
/** Hollowing class of the taint field: under 100 low, 160 and over high, else some. */
export const hollowClass = (taint) => (taint < 100 ? 'low' : taint >= 160 ? 'high' : 'some');
/** Wildness class of the wild field (the caverns thresholds of 3.6): under 60 calm, 170 and over wild, else some. */
export const wildClass = (wild) => (wild < 60 ? 'calm' : wild >= 170 ? 'wild' : 'some');
/** Rain class of the rain field (GEN.classify arid, dry, moist). */
export const rainClass = (rain) => (rain < GEN.classify.arid ? 'arid' : rain < GEN.classify.dry ? 'dry' : rain < GEN.classify.moist ? 'moist' : 'wet');
/** The top soil of opts.region (3.3: loam, clay, sand or peat). */
export function soilClass(biomeId, soil) {
  if (biomeId === 'fen' || biomeId === 'moor') return 'peat';
  if (soil.sand >= 40) return 'sand';
  if (soil.clay >= 30) return 'clay';
  return 'loam';
}
/** Ore weight of ore `k` in opts.region.ores (gems: the best gem); 100 is the base count every hold has. */
export function oreWeight(ores, k) {
  if (k === 'gems') { let m = 100; for (const g of GEMS) if ((ores[g] || 0) > m) m = ores[g]; return m; }
  return ores[k] || 100;
}
/** 'signs' | 'rumour' | 'none' for an ore weight. */
export const oreWord = (w) => (w >= ORE_SIGNS ? 'signs' : w >= ORE_RUMOUR ? 'rumour' : 'none');

// ---- travel fields (multi-source Dijkstra with the travelDays costs of query.js) -------------------------------
/** Half-days to enter region j from i: the same costs as query.js travelDays (plains 1 day, hills 2, mountains 3, river 0.5). */
function stepCost(realm, i, j) {
  if (isSea(realm, j)) return 0;
  if (riverClass(realm, i) && riverClass(realm, j)) return 1;
  const b = band(realm, j);
  if (realm.fields.road[j]) return 2;
  return b >= BAND.HIGH ? 6 : b === BAND.UP ? 4 : 2;
}
/** Travel days from the nearest source region to every region (Infinity where the sea cuts them off). */
export function travelField(realm, sources) {
  const n = realm.n, N = n * n, cost = new Float64Array(N).fill(Infinity), heap = [];
  const less = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  const push = (e) => { heap.push(e); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (!less(heap[c], heap[p])) break; [heap[c], heap[p]] = [heap[p], heap[c]]; c = p; } };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && less(heap[l], heap[m])) m = l; if (r < heap.length && less(heap[r], heap[m])) m = r; if (m === c) break; [heap[c], heap[m]] = [heap[m], heap[c]]; c = m; } }
    return top;
  };
  for (const s of sources) if (s >= 0 && s < N && cost[s] !== 0) { cost[s] = 0; push([0, s]); }
  while (heap.length) {
    const [c, i] = pop();
    if (c > cost[i]) continue;
    const x = i % n, y = (i - x) / n;
    for (let d = 0; d < 8; d++) {
      const xx = x + DX[d], yy = y + DY[d];
      if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
      const j = yy * n + xx, w = stepCost(realm, i, j);
      if (!w) continue;
      if (c + w < cost[j]) { cost[j] = c + w; push([c + w, j]); }
    }
  }
  for (let i = 0; i < N; i++) cost[i] /= 2;
  return cost;
}
const hostileSite = (realm, s) => !!(s && (s.kind === 'lair' || s.hostile || (typeof s.civ === 'number' && realm.tables.civs[s.civ] && realm.tables.civs[s.civ].hostile)));

const CACHE = new WeakMap();
function cacheOf(realm) { let c = CACHE.get(realm); if (!c) { c = { civ: new Map() }; CACHE.set(realm, c); } return c; }
/** Travel days from civ `id`'s territory and its sites to every region (cached per realm). */
function civField(realm, id) {
  const c = cacheOf(realm);
  if (!c.civ.has(id)) {
    const f = realm.fields, N = realm.n * realm.n, src = [];
    for (let i = 0; i < N; i++) if (f.owner[i] === id + 1) src.push(i);
    for (const s of realm.tables.sites || []) if (s && s.civ === id && inside(realm, s.x, s.y)) src.push(idx(realm, s.x, s.y));
    c.civ.set(id, travelField(realm, src));
  }
  return c.civ.get(id);
}

// ---- the reach rule (3.2) ----------------------------------------------------------------------------------------
/**
 * The civs that could back a hold at (rx, ry): each civ whose territory or a site is within REACH_DAYS travel days.
 * ok: at least one is in reach, or the world is unsettled (no civs yet, W2), or the start may go alone (3.2).
 */
export function reachOf(realm, rx, ry, { start = null } = {}) {
  const civs = (realm.tables && realm.tables.civs) || [];
  const alone = ALONE_STARTS.includes(start);
  if (!civs.length) return { ok: true, unsettled: true, alone, civs: [] };
  const i = idx(realm, rx, ry), out = [];
  for (let id = 0; id < civs.length; id++) {
    if (!civs[id]) continue;
    const days = civField(realm, id)[i];
    if (days <= REACH_DAYS) out.push({ id, civ: civs[id], days });
  }
  out.sort((a, b) => a.days - b.days || a.id - b.id);
  return { ok: out.length > 0 || alone, unsettled: false, alone: alone && !out.length, civs: out };
}

/** Why Settle here is off at (rx, ry) (3.2), or null. `used`: the world index's [[slot, rx, ry]]. */
export function settleBlockOf(realm, rx, ry, { used = [], start = null } = {}) {
  if (!inside(realm, rx, ry)) return 'edge';
  const i = idx(realm, rx, ry);
  if (isSea(realm, i)) return 'sea';
  if (band(realm, i) === BAND.PEAK) return 'peak';
  if (!isEmbarkable(realm, i)) return 'edge';
  if (realm.fields.site[i]) return 'site';
  if (used.some((u) => u[1] === rx && u[2] === ry)) return 'used';
  if (!reachOf(realm, rx, ry, { start }).ok) return 'reach';
  return null;
}

// ---- traits and scoring (3.4) ------------------------------------------------------------------------------------
const CLIMATE = { cold: 0, temperate: 1, warm: 2 }, AQ = { none: 0, light: 1, heavy: 2 }, MASSIF = { thin: 0, middling: 1, thick: 2 };
const HOLLOW = { low: 0, some: 1, high: 2 }, WILD = { calm: 0, some: 1, wild: 2 };
/**
 * Per-region features, from opts.region and the fields (built once per realm; about 20-40 ms at 64 x 64 on a
 * desktop, then cached): ok (embarkable, no site), climate, river class, lake, aquifer, massif, ore bits, ember shallow,
 * hollowing, wildness, days to the nearest site and the nearest hostile site, start-fit bits.
 */
export function regionTraits(realm) {
  const c = cacheOf(realm);
  if (c.traits) return c.traits;
  const n = realm.n, N = n * n, f = realm.fields;
  const T = { n, N, ok: new Uint8Array(N), climate: new Uint8Array(N), river: new Uint8Array(N), lake: new Uint8Array(N), aquifer: new Uint8Array(N),
    massif: new Uint8Array(N), ores: new Uint8Array(N), shallow: new Uint8Array(N), hollow: new Uint8Array(N), wild: new Uint8Array(N),
    site: new Float32Array(N), enemy: new Float32Array(N), fit: new Uint8Array(N), q: new Int16Array(N), biome: f.biome };
  const starts = Object.keys(START_FIT);
  const siteSrc = [], enemySrc = [];
  for (const s of realm.tables.sites || []) {
    if (!s || !inside(realm, s.x, s.y)) continue;
    (hostileSite(realm, s) ? enemySrc : siteSrc).push(idx(realm, s.x, s.y));
  }
  const sf = travelField(realm, siteSrc), ef = travelField(realm, enemySrc);
  for (let i = 0; i < N; i++) {
    T.site[i] = sf[i]; T.enemy[i] = ef[i];
    if (!isEmbarkable(realm, i) || f.site[i]) continue;
    const x = i % n, y = (i - x) / n, o = regionOpts(realm, x, y);
    T.ok[i] = 1;
    T.climate[i] = CLIMATE[climateClass(f.temp[i])];
    T.river[i] = riverClass(realm, i);
    T.lake[i] = isLake(realm, i) ? 1 : 0;
    T.aquifer[i] = AQ[aquiferClass(o.aquiferPct)];
    T.massif[i] = MASSIF[massifClass(o.massifPct)];
    let bits = 0;
    ORES.forEach((k, b) => { if (oreWeight(o.ores, k) >= ORE_RUMOUR) bits |= 1 << b; });
    T.ores[i] = bits;
    T.shallow[i] = o.ember.rel === -11 ? 1 : 0;
    T.hollow[i] = HOLLOW[hollowClass(f.taint[i])];
    T.wild[i] = WILD[wildClass(f.wild[i])];
    let fit = 0;
    starts.forEach((id, b) => { if (startFits(realm, i, id)) fit |= 1 << b; });
    T.fit[i] = fit;
    T.q[i] = quality(realm, i);
  }
  c.traits = T;
  return T;
}

/**
 * The tie-break among equal scores (higher first): a bigger river, a lake, room from the world's edge (up to 8
 * regions), less taint and less wildness. Integers: 4 * river class + 3 * lake + min(8, edge distance) - taint / 64 - wild / 64.
 */
export function quality(realm, i) {
  const n = realm.n, x = i % n, y = (i - x) / n, f = realm.fields;
  return 4 * riverClass(realm, i) + (isLake(realm, i) ? 3 : 0) + Math.min(8, x, y, n - 1 - x, n - 1 - y) - (f.taint[i] >> 6) - (f.wild[i] >> 6);
}
/** Compiled filters: the bit masks and codes scoreTraits reads. */
export function compileFilters(F) {
  F = cleanFilters(F);
  const bset = new Uint8Array(REALM_BIOMES.length);
  for (const id of F.biomes) bset[BIOME_INDEX[id]] = 1;
  let ores = 0;
  for (const k of F.ores) ores |= 1 << ORES.indexOf(k);
  const startBit = F.fit ? 1 << Object.keys(START_FIT).indexOf(F.fit) : 0;
  return { F, biomes: F.biomes.length ? bset : null, ores, startBit };
}
/**
 * The score of region i under compiled filters C: -1 when a hard filter excludes it (biome, climate, river, lake,
 * aquifer, mountain, ores, ember, start fit), else the soft points (hollowing, wildness, neighbours: 2 for a full
 * match, 1 for a half match, 0 otherwise; Any adds nothing).
 */
export function scoreTraits(T, i, C) {
  if (!T.ok[i]) return -1;
  const F = C.F;
  if (C.biomes && !C.biomes[T.biome[i]]) return -1;
  if (F.climate !== 'any' && T.climate[i] !== CLIMATE[F.climate]) return -1;
  if (F.river === 'need' && !T.river[i]) return -1;
  if (F.river === 'none' && T.river[i]) return -1;
  if (F.lake === 'need' && !T.lake[i]) return -1;
  if (F.aquifer !== 'any' && T.aquifer[i] !== AQ[F.aquifer]) return -1;
  if (F.mountain !== 'any' && T.massif[i] !== MASSIF[F.mountain]) return -1;
  if (C.ores && (T.ores[i] & C.ores) !== C.ores) return -1;
  if (F.ember === 'shallow' && !T.shallow[i]) return -1;
  if (F.ember === 'deep' && T.shallow[i]) return -1;
  if (C.startBit && !(T.fit[i] & C.startBit)) return -1;
  let s = 0;
  if (F.hollow === 'low') s += 2 - T.hollow[i];
  else if (F.hollow === 'high') s += T.hollow[i];
  if (F.wild === 'calm') s += 2 - T.wild[i];
  else if (F.wild === 'wild') s += T.wild[i];
  if (F.neigh === 'traders') s += T.site[i] <= NEAR_DAYS ? 2 : T.site[i] <= REACH_DAYS ? 1 : 0;
  else if (F.neigh === 'isolated') s += T.site[i] > ISOLATED_DAYS && T.enemy[i] > ISOLATED_DAYS ? 2 : T.site[i] > NEAR_DAYS ? 1 : 0;
  else if (F.neigh === 'enemies') s += T.enemy[i] <= NEAR_DAYS ? 2 : T.enemy[i] <= REACH_DAYS ? 1 : 0;
  return s;
}

/**
 * Every allowed region matching filters F, best first (score descending, then quality(), then region index): { list, count }.
 * o: { used: [[slot, rx, ry]], start } (the reach rule of 3.2 uses the start's "alone" exception).
 */
export function findSites(realm, F, { used = [], start = null } = {}) {
  const T = regionTraits(realm), C = compileFilters(F);
  const taken = new Set(used.map((u) => u[2] * realm.n + u[1]));
  const civs = (realm.tables && realm.tables.civs) || [];
  const fields = civs.length && !ALONE_STARTS.includes(start) ? civs.map((c, id) => (c ? civField(realm, id) : null)).filter(Boolean) : null;
  const list = [];
  for (let i = 0; i < T.N; i++) {
    const s = scoreTraits(T, i, C);
    if (s < 0 || taken.has(i)) continue;
    if (fields && !fields.some((d) => d[i] <= REACH_DAYS)) continue;
    list.push({ rx: i % T.n, ry: (i / T.n) | 0, i, score: s, q: T.q[i] });
  }
  list.sort((a, b) => b.score - a.score || b.q - a.q || a.i - b.i);
  return { list, count: list.length };
}

// ---- the region card's facts (3.3) -------------------------------------------------------------------------------
const SIDE_NAME = Object.freeze({ n: 'north', e: 'east', s: 'south', w: 'west' });
/** The direction word from (ax, ay) to (bx, by): one of the eight compass points, or 'here'. */
export function compass(ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  if (!dx && !dy) return 'here';
  const ns = Math.abs(dy) * 2 >= Math.abs(dx) ? (dy < 0 ? 'n' : 's') : '';
  const ew = Math.abs(dx) * 2 >= Math.abs(dy) ? (dx < 0 ? 'w' : 'e') : '';
  return ns + ew;
}
/**
 * Everything the region card shows (3.3), as codes and numbers: { facts (regionFacts), opts (regionOpts),
 * climate: { cls, rain }, ground: { aquifer, aquiferPct, soil, side, massif, massifPct, river: { cls, in, out } | null, lake, coast },
 * rock: { geo, stones, ores: [{ k, w, word }] }, depth: { shallow, rel, caverns }, danger: { hollow, wild, lean, lairs, enemies },
 * neighbours: [{ name, kind, civ, people, days }], history: [], reach, block }.
 */
export function cardFacts(realm, rx, ry, { used = [], start = null } = {}) {
  const facts = regionFacts(realm, rx, ry);
  if (!facts) return null;
  const block = settleBlockOf(realm, rx, ry, { used, start });
  if (facts.sea) return { facts, opts: null, block, sea: true };
  const o = regionOpts(realm, rx, ry), i = idx(realm, rx, ry);
  const T = realm.tables || {};
  const near = neighbours(realm, rx, ry, 6).map(({ site }) => {
    const civ = typeof site.civ === 'number' ? T.civs[site.civ] || null : civOf(realm, site.x, site.y);
    return { name: site.name || '', kind: site.kind || 'site', civ: civ ? civ.name || '' : '', people: civ ? civ.people || '' : '', hostile: hostileSite(realm, site),
      days: travelDays(realm, site.x, site.y, rx, ry, 40), dir: compass(rx, ry, site.x, site.y) };
  }).sort((a, b) => a.days - b.days);
  const lairs = (T.beasts || []).filter((b) => b && b.alive !== false).map((b) => {
    const at = b.lair || b, d = Math.max(Math.abs(at.x - rx), Math.abs(at.y - ry));
    return { name: b.name || '', d, dir: compass(rx, ry, at.x, at.y) };
  }).filter((b) => b.d <= 4).sort((a, b) => a.d - b.d).slice(0, 2);
  return {
    facts, opts: o, block, sea: false,
    climate: { cls: climateClass(facts.temp), rain: rainClass(facts.rain), fronts: [...new Set(o.climate.fronts)] },
    ground: { aquifer: aquiferClass(o.aquiferPct), aquiferPct: o.aquiferPct, soil: soilClass(o.biome, o.soil), side: o.side, sideName: SIDE_NAME[o.side],
      massif: massifClass(o.massifPct), massifPct: o.massifPct, river: o.river ? { cls: o.river.cls, in: SIDE_NAME[o.river.in], out: SIDE_NAME[o.river.out] } : null,
      lake: o.lake, coast: isCoast(realm, i), heights: o.heights, band: facts.band },
    rock: { geo: o.geo, stones: o.stones, ores: ORES.map((k) => { const w = oreWeight(o.ores, k); return { k, w, word: oreWord(w) }; }) },
    depth: { shallow: o.ember.rel === -11, rel: o.ember.rel, caverns: o.caverns },
    danger: { hollow: hollowClass(facts.taint), wild: wildClass(facts.wild), lean: facts.lean, lairs, enemies: near.filter((x) => x.hostile && x.days <= REACH_DAYS).length },
    neighbours: near, history: [], reach: reachOf(realm, rx, ry, { start }),
  };
}
/** The 3 x 3 local area around (rx, ry): rows of { rx, ry, dx, dy, inside, sea, biome, river: { in, out } | null, side }. */
export function localArea(realm, rx, ry) {
  const out = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = rx + dx, y = ry + dy;
    if (!inside(realm, x, y)) { out.push({ rx: x, ry: y, dx, dy, inside: false }); continue; }
    const i = idx(realm, x, y), sea = isSea(realm, i);
    const o = sea ? null : regionOpts(realm, x, y);
    out.push({ rx: x, ry: y, dx, dy, inside: true, sea, biome: realm.fields.biome[i], peak: bandOf(realm.fields.elev[i], realm.bands) === BAND.PEAK,
      river: o && o.river ? { in: o.river.in, out: o.river.out, cls: o.river.cls } : null, side: o ? o.side : null, lake: !!(o && o.lake) });
  }
  return out;
}
