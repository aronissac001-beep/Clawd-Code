// Region inputs to the 3D generator (EMBERCROWN-WORLD.md 3.6, G9; owner L, landed by W2.3 as request W2.3a).
//   regionOpts(realm, rx, ry)   the plain `opts.region` object generate3 / previewSurface read (GEN3 v2); also kept in
//                               s.realm.embark, so a debug regeneration can rebuild the hold
//   holdSeed(realm, rx, ry)     the region's hold seed, hash32(worldSeed, rx, ry, 'hold') (G2)
//   regionFacts(realm, rx, ry)  the plain facts of a region for the region card (3.3)
// Pure reads of a realm (gen.js createRealm); integers only (check-mapgen.mjs lints this file); never reads s.rng.
// The biome's knob row (js/data/worldgen.js GEN3.biomes, 1.3) overrides the field-derived value where 1.3 names one.
import { GEN3 } from '../../data/worldgen.js';
import { REALM_BIOMES } from '../../data/realm/biomes.js';
import { DX, DY } from './fields.js';
import { artifactName } from '../../data/text/realm.js';
import { BAND, BAND_NAMES, bandOf } from './biomes.js';
import { hash32, idx, inside, isSea, riverClass, isLake, isCoast, isEmbarkable, downOf } from './query.js';

export const REGION_V = 2;
const SIDES = Object.freeze(['n', 'e', 's', 'w']);
const OPP = Object.freeze({ n: 's', s: 'n', e: 'w', w: 'e' });
/** The card sides of each D8 direction (fields.js DX/DY order: N, NE, E, SE, S, SW, W, NW). */
const CARD = Object.freeze([['n'], ['n', 'e'], ['e'], ['e', 's'], ['s'], ['s', 'w'], ['w'], ['w', 'n']]);
/** The three D8 directions on each card side. */
const SIDE_DIRS = Object.freeze({ n: [7, 0, 1], e: [1, 2, 3], s: [3, 4, 5], w: [5, 6, 7] });
const GEO_NAMES = Object.freeze(['sedimentary basin', 'granite shield', 'basalt flood', 'metamorphic belt', 'ash field']);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** The hold seed of region (rx, ry) (G2). */
export const holdSeed = (realm, rx, ry) => hash32(realm.seed, rx, ry, 'hold');

/** The 8 neighbours of i: [{ d, j }] with j = -1 off the map. */
function around(realm, rx, ry) {
  const out = [];
  for (let d = 0; d < 8; d++) {
    const x = rx + DX[d], y = ry + DY[d];
    out.push({ d, j: inside(realm, x, y) ? idx(realm, x, y) : -1 });
  }
  return out;
}
/** Card side of D8 direction d; a diagonal picks the component not in `avoid`, else by `bit`. */
function cardOf(d, avoid, bit) {
  const c = CARD[d];
  if (c.length === 1) return c[0];
  const ok = c.filter((s) => !avoid.includes(s));
  return ok.length === 1 ? ok[0] : c[bit & 1];
}

/** The opts.region of region (rx, ry) for mapgen3 (3.6). */
export function regionOpts(realm, rx, ry) {
  const f = realm.fields, i = idx(realm, rx, ry), nb = around(realm, rx, ry);
  const bio = REALM_BIOMES[f.biome[i]] || REALM_BIOMES[2], B = GEN3.biomes[bio.id] || {};
  const own = f.elev[i], band = bandOf(own, realm.bands), h = hash32(realm.seed, rx, ry, 'region');
  // the sea side of a shore: the side with the most sea among its three neighbours
  let sea = null;
  if (B.sea) {
    let best = 0;
    for (const s of SIDES) { let k = 0; for (const d of SIDE_DIRS[s]) { const j = nb[d].j; if (j >= 0 && isSea(realm, j)) k++; } if (k > best) { best = k; sea = s; } }
  }
  // the massif side: the side whose highest neighbour is highest (ties n, e, s, w); never the sea side
  let side = null, top = -1;
  for (const s of SIDES) {
    if (s === sea) continue;
    let m = -1;
    for (const d of SIDE_DIRS[s]) { const j = nb[d].j; if (j >= 0 && !isSea(realm, j) && f.elev[j] > m) m = f.elev[j]; }
    if (m > top) { top = m; side = s; }
  }
  if (!side) side = sea === 'n' ? 's' : 'n';
  // relief: own band, the higher neighbours and a peak next door
  let higher = 0, peak = false;
  for (const { j } of nb) if (j >= 0) { if (f.elev[j] > own) higher++; if (bandOf(f.elev[j], realm.bands) === BAND.PEAK) peak = true; }
  let massifPct = (band >= BAND.HIGH ? 42 : band === BAND.UP ? 35 : 29) + 2 * higher + (peak ? 6 : 0);
  if (B.massifPct) massifPct = B.massifPct[0] + (h % (B.massifPct[1] - B.massifPct[0] + 1));
  massifPct = clamp(massifPct, GEN3.massifPct[0], GEN3.massifPct[1]);
  const heights = peak || band >= BAND.HIGH ? 5 : band === BAND.UP ? 4 : 3;
  // the river: out along the D8 flow, in from the biggest upstream river (else from the massif side, a spring in the heights)
  let river = null;
  const cls = riverClass(realm, i);
  if (cls && !isSea(realm, i)) {
    const down = downOf(realm, i);
    const dOut = nb.findIndex((e) => e.j === down);
    let up = -1, upCls = 0;
    for (const { d, j } of nb) {
      if (j < 0 || isSea(realm, j)) continue;
      const c = riverClass(realm, j);
      if (c && downOf(realm, j) === i && (c > upCls)) { up = d; upCls = c; }
    }
    const out = dOut >= 0 ? cardOf(dOut, [], h >>> 1) : OPP[side];
    let inn = up >= 0 ? cardOf(up, [out], h >>> 2) : side;
    if (inn === out) inn = side !== out ? side : OPP[out];
    river = { in: inn, out, cls };
  }
  // soils and water
  const rain = f.rain[i], drain = f.drain[i], volc = f.volc[i], taint = f.taint[i], wild = f.wild[i], geo = f.geo[i] | 0;
  const aquiferPct = B.aquiferPct !== undefined ? B.aquiferPct : clamp(20 + (((255 - drain) * 40) / 255 | 0) + ((rain * 20) / 255 | 0), 10, 80);
  const soil = { clay: B.topClayPct !== undefined ? B.topClayPct : rain >= 160 ? 26 : rain < 40 ? 10 : 18, sand: B.topSandPct !== undefined ? B.topSandPct : rain < 40 ? 25 : 0 };
  const ember = B.ember ? { pools: B.ember.pools.slice(), rel: B.ember.rel } : { pools: volc > 180 ? [5, 7] : volc > 120 ? [4, 6] : [3, 5], rel: volc > 210 ? -11 : -12 };
  const springs = rain >= 160 ? [2, 3] : rain < 40 ? [0, 1] : [1, 2];
  const prov = GEN3.provinces[geo] || GEN3.provinces[0];
  // the starting blight is seeded in patches of WORLD.blight.startPct (6 %) each, so the share is a multiple of it
  const blight = B.blightPct ? clamp(taint >= 210 ? 18 : 12, B.blightPct[0], B.blightPct[1]) : taint >= 100 ? 12 : 6;
  const seeps = taint >= 160 ? [3, 4] : [2, 3];
  // history (W3): ruins (razed sites, battlefields), lost artifacts and beast lairs at or next to the region
  const T = realm.tables || {}, at = (o, r) => o && typeof o.x === 'number' && Math.max(Math.abs(o.x - rx), Math.abs(o.y - ry)) <= r;
  const ruins = (T.sites || []).filter((s) => at(s, 0) && ((s.razed !== null && s.razed !== undefined) || s.kind === 'battlefield'))
    .map((s) => ({ kind: s.kind === 'battlefield' ? 'battlefield' : 'ruin', key: 'ws' + s.id, name: s.name || null }));
  const relics = (T.artifacts || []).filter((a) => at(a, 0) && a.lost)
    .map((a) => ({ key: 'wa' + a.id, site: Number.isInteger(a.at) ? a.at : null, name: artifactName(a), kind: a.kind, mat: a.mat }));
  const lairs = (T.beasts || []).filter((b) => at(b, 1) && b.alive !== false)
    .map((b) => ({ key: 'wb' + b.id, seed: b.seed >>> 0, dx: b.x - rx, dy: b.y - ry }));
  // spawn edge weights: caravans along land sides (a road doubles it), raids on land sides and from the sea
  const caravan = {}, raid = {};
  for (const s of SIDES) {
    let land = 0, road = 0, water = 0;
    for (const d of SIDE_DIRS[s]) { const j = nb[d].j; if (j < 0) continue; if (isSea(realm, j)) { water++; continue; } if (bandOf(f.elev[j], realm.bands) !== BAND.PEAK) land++; if (f.road[j]) road++; }
    caravan[s] = land ? (road ? 2 : 1) : 0;
    raid[s] = land || (s === sea && water) ? 1 : 0;
  }
  return {
    v: REGION_V, wid: realm.wid >>> 0, rx, ry, seed: holdSeed(realm, rx, ry),
    biome: bio.id, side, sea, massifPct, heights, river, lake: isLake(realm, i), aquiferPct, soil,
    climate: { mean: f.temp[i], amp: f.amp[i], rain, fronts: (B.fronts || []).slice(), wind: B.wind || 0, winter: B.winter !== undefined ? B.winter : null, season: B.season || 0, frozenSoil: !!B.frozenSoil },
    ember, springs, stones: JSON.parse(JSON.stringify(prov.stones)), ores: { ...prov.ores }, geo,
    blight, seeps, wild, ruins, relics, lairs, edges: { caravan, raid }, caverns: wild >= 170 ? 2 : wild < 60 ? 0 : 1,
  };
}

/** Plain facts of region (rx, ry) for the region card (3.3): biome, band, climate numbers, water, rock and threat lean. */
export function regionFacts(realm, rx, ry) {
  if (!inside(realm, rx, ry)) return null;
  const f = realm.fields, i = idx(realm, rx, ry), bio = REALM_BIOMES[f.biome[i]], band = bandOf(f.elev[i], realm.bands);
  const prov = GEN3.provinces[f.geo[i]] || GEN3.provinces[0];
  return {
    rx, ry, biome: bio.id, name: bio.name, desc: bio.desc, lean: bio.lean, band: BAND_NAMES[band],
    embark: isEmbarkable(realm, i), sea: isSea(realm, i), temp: f.temp[i], amp: f.amp[i], rain: f.rain[i], drain: f.drain[i],
    river: riverClass(realm, i), lake: isLake(realm, i), coast: isCoast(realm, i), geo: GEO_NAMES[f.geo[i]] || GEO_NAMES[0],
    stones: prov.stones, ores: Object.keys(prov.ores), taint: f.taint[i], wild: f.wild[i], volc: f.volc[i], seed: holdSeed(realm, rx, ry),
  };
}
