// Outbound caravans (doc 8.3; since Stage 2.9 a verb every hold has, verbs/outbound.js): send 2-4
// colonists with goods to a named town for 3-6 days; a caravan letter resolves the trip. Owner K. Stage 3 feature; Stage 0 skeleton.
//
// W3.3a (EMBERCROWN-WORLD.md 2.7 caravans row): where inbound caravans come from in a hold with a realm record.
// caravanSources lists the friendly towns and cities within REALM_CARAVAN.reach travel days (living civ, size >= 3,
// a settled kind, not at war with the liege, goodwill Neutral or better): each such civ trades from its nearest one
// (its market town), and the REALM_CARAVAN.sources nearest of those send caravans, so a crowded world does not bury
// the hold in traders. Each comes with its travel days (one Dijkstra
// from the hold over query.js travelDays' step costs), its cadence (travel days x 2 + 5, at least a season: at the
// most once a season per site), whether it sends barges (a great river within 1 region: 1.5x goods) and the goods
// its biome and people favour. trade.js schedules the arrivals. Pure reads; nothing here writes the state.

import { registerApplier } from '../core/commands.js';
import { DAYS_PER_SEASON } from '../core/time.js';
import { isSea, riverClass, band, inside } from '../realm/query.js';
import { BAND } from '../realm/biomes.js';
import { DX, DY } from '../realm/fields.js';
import { REALM_BIOMES } from '../../data/realm/biomes.js';
import { realmRec, sitesNow, liegeCiv, factionOfCiv, goodwill } from './factions.js';

export const CARAVAN = Object.freeze({ minColonists: 2, maxColonists: 4, daysMin: 3, daysMax: 6 });
export function installCaravanCommands() {
  registerApplier('caravan', (s) => ({ ok: false, reason: 'outbound caravans arrive in a later stage' }));
}

/**
 * Realm caravans (2.7). reach: travel days; minSize: the smallest site that sends caravans (a town); kinds: the
 * settled site kinds that may; friendly: the lowest goodwill that still trades (Neutral is > -15); great: the river
 * class of a great river; barge: the goods factor of a barge caravan; first: the earliest first arrival (days).
 */
export const REALM_CARAVAN = Object.freeze({ reach: 12, sources: 6, perTravel: 2, plus: 5, minSize: 3, kinds: Object.freeze(['town', 'city', 'hold', 'grove', 'stilt']),
  friendly: -14, great: 3, barge: 1.5, first: 4 });
/** Item categories a caravan's people and its site's biome favour (2.7 "goods come from the site's biome and people"). */
export const PEOPLE_GOODS = Object.freeze({
  human: ['rawfood', 'cloth', 'tools'], deepforge: ['ingots', 'tools', 'weapons', 'armour', 'gems'], sylvari: ['herbs', 'medicine', 'fibre'],
  emberkin: ['fuel', 'weapons', 'leather'], murrow: ['rawfood', 'preserved', 'drink'], tarnfolk: ['rawfood', 'glass', 'gems'],
  wendrel: ['animal', 'leather', 'cloth'], kilnfolk: ['ingots', 'fuel', 'ore'], lamplost: ['gems', 'glass'], greyborn: ['medicine', 'herbs'],
});
export const BIOME_GOODS = Object.freeze({
  greenvale: ['rawfood', 'drink'], elderwood: ['herbs', 'fibre'], ruins: ['art', 'gems'], ashlands: ['fuel', 'ore'], fen: ['herbs', 'fibre'],
  moor: ['animal', 'cloth'], taiga: ['leather', 'preserved'], tundra: ['leather', 'preserved'], saltflat: ['preserved', 'gems'],
  redscar: ['ore', 'ingots'], shore: ['rawfood', 'glass'], highcrag: ['ore', 'gems'],
});
/** The cadence in days of a site `days` travel days away: days x 2 + 5, at least a season. */
export const cadenceDays = (days) => Math.max(DAYS_PER_SEASON, Math.round(days * REALM_CARAVAN.perTravel + REALM_CARAVAN.plus));

/** Step cost in half-days of entering region j from i: query.js travelDays' (plains 2, road 2, hills 4, mountains 6, river 1; sea 0 = closed). */
function stepCost(R, i, j) {
  if (isSea(R, j)) return 0;
  if (riverClass(R, i) && riverClass(R, j)) return 1;
  const b = band(R, j);
  if (R.fields.road[j]) return 2;
  return b >= BAND.HIGH ? 6 : b === BAND.UP ? 4 : 2;
}
const fieldCache = new WeakMap();
/**
 * Travel days from region (rx, ry) to every region within `max` days (Infinity beyond, or cut off by the sea): one
 * Dijkstra with query.js travelDays' costs and tie order, so each value equals travelDays(R, rx, ry, x, y). Cached per
 * record and region (the land never changes).
 */
export function travelField(R, rx, ry, max = REALM_CARAVAN.reach) {
  let byR = fieldCache.get(R);
  if (!byR) fieldCache.set(R, (byR = new Map()));
  const key = `${rx},${ry},${max}`;
  if (byR.has(key)) return byR.get(key);
  const n = R.n, N = n * n, cost = new Float64Array(N).fill(Infinity), heap = [];
  if (inside(R, rx, ry)) {
    const less = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
    const push = (e) => { heap.push(e); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (!less(heap[c], heap[p])) break; [heap[c], heap[p]] = [heap[p], heap[c]]; c = p; } };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && less(heap[l], heap[m])) m = l; if (r < heap.length && less(heap[r], heap[m])) m = r; if (m === c) break; [heap[c], heap[m]] = [heap[m], heap[c]]; c = m; } }
      return top;
    };
    const src = ry * n + rx;
    cost[src] = 0; push([0, src]);
    while (heap.length) {
      const [c, i] = pop();
      if (c > cost[i]) continue;
      if (c / 2 > max) break;
      const x = i % n, y = (i - x) / n;
      for (let d = 0; d < 8; d++) {
        const xx = x + DX[d], yy = y + DY[d];
        if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
        const j = yy * n + xx, w = stepCost(R, i, j);
        if (w && c + w < cost[j]) { cost[j] = c + w; push([c + w, j]); }
      }
    }
  }
  const out = new Float64Array(N).fill(Infinity);
  for (let i = 0; i < N; i++) if (cost[i] / 2 <= max) out[i] = cost[i] / 2;
  byR.set(key, out);
  return out;
}
/** A great river (class >= REALM_CARAVAN.great) within 1 region of (x, y): its caravans come by barge. */
export function bargeAt(R, x, y) {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const xx = x + dx, yy = y + dy;
    if (inside(R, xx, yy) && riverClass(R, yy * R.n + xx) >= REALM_CARAVAN.great) return true;
  }
  return false;
}
/** The wars going on now (record wars with the s.realm.wars deltas), as a Set of 'a:b' (a < b) civ pairs. */
function warPairs(s, R) {
  const m = new Map();
  const put = (a, b, began, ended) => { if (Number.isInteger(a) && Number.isInteger(b)) m.set(`${Math.min(a, b)}:${Math.max(a, b)}:${began | 0}`, ended === undefined ? null : ended); };
  for (const w of R.tables.wars || []) put(w.a, w.b, w.began, w.ended);
  for (const d of (s.realm && s.realm.wars) || []) { if (Array.isArray(d)) put(d[0], d[1], d[2], d[3]); else if (d && typeof d === 'object') put(d.a, d.b, d.began, d.ended); }
  const out = new Set();
  for (const [k, ended] of m) if (ended === null) { const [a, b] = k.split(':'); out.add(`${a}:${b}`); }
  return out;
}
/** Whether civ id is at war with the liege now. */
export function atWarWithLiege(s, R, id, wars = warPairs(s, R)) {
  const L = liegeCiv(s);
  return L !== null && id !== L && wars.has(`${Math.min(id, L)}:${Math.max(id, L)}`);
}
/**
 * The sites that send caravans now (the nearest market town of each of the `sources` nearest friendly civs), by site
 * id: [{ site, name, civ, fac, people, biome, days, cadence, barge, goods }].
 * [] with no realm record (the legacy schedule runs).
 */
export function caravanSources(s, R = realmRec(s)) {
  if (!R || !s.realm) return [];
  const K = REALM_CARAVAN, tf = travelField(R, s.realm.rx, s.realm.ry, K.reach), wars = warPairs(s, R), best = new Map();
  for (const x of sitesNow(s, R)) {
    if (x.civ === null || x.size < K.minSize || !K.kinds.includes(x.kind)) continue;
    const c = R.tables.civs[x.civ];
    if (!c || c.fell !== null) continue;
    const days = tf[x.y * R.n + x.x];
    if (!(days <= K.reach)) continue;
    const fac = factionOfCiv(s, x.civ);
    if (goodwill(s, fac) < K.friendly || atWarWithLiege(s, R, x.civ, wars)) continue;
    const o = best.get(x.civ);
    if (o && (o.days < days || (o.days === days && o.site < x.id))) continue;
    const biome = (REALM_BIOMES[R.fields.biome[x.y * R.n + x.x]] || {}).id || 'greenvale';
    const goods = [...new Set([...(PEOPLE_GOODS[c.people] || []), ...(BIOME_GOODS[biome] || [])])];
    best.set(x.civ, { site: x.id, name: R.tables.sites[x.id].name || '', civ: x.civ, fac, people: c.people, biome, days, cadence: cadenceDays(days), barge: bargeAt(R, x.x, x.y), goods });
  }
  const out = [...best.values()].sort((a, b) => a.days - b.days || a.site - b.site).slice(0, K.sources);
  return out.sort((a, b) => a.site - b.site);
}
