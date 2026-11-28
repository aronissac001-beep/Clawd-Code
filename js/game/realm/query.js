// The realm's read API for the sim and the UI (EMBERCROWN-WORLD.md 1.6; owner L). Pure reads of a realm object
// (gen.js createRealm) and of a hold's s.realm deltas; nothing here writes. The history tables (civs, sites,
// figures) are filled in W3; until then the lookups that need them return null or [].
import { GEN, START_FIT } from '../../data/realm/params.js';
import { REALM_BIOMES, BIOME_INDEX } from '../../data/realm/biomes.js';
import { FLOW } from './rivers.js';
import { BAND, bandOf, nextToBand } from './biomes.js';
import { DX, DY } from './fields.js';

/** hash32(...parts) of EMBERCROWN-WORLD.md G2 lives in js/game/core/rand.js (owner A). */
export { hash32 } from '../core/rand.js';

export const idx = (realm, rx, ry) => ry * realm.n + rx;
export const inside = (realm, rx, ry) => rx >= 0 && ry >= 0 && rx < realm.n && ry < realm.n;
export const isSea = (realm, i) => realm.fields.elev[i] < realm.seaLevel;
export const band = (realm, i) => bandOf(realm.fields.elev[i], realm.bands);
export const riverClass = (realm, i) => (realm.fields.flow[i] & FLOW.CLS) >> FLOW.CLS_SHIFT;
export const isLake = (realm, i) => (realm.fields.flow[i] & FLOW.LAKE) !== 0;
export const isCoast = (realm, i) => (realm.fields.flow[i] & FLOW.COAST) !== 0;
export const isEmbarkable = (realm, i) => (realm.fields.flow[i] & FLOW.EMBARK) !== 0;
export const biomeOf = (realm, i) => REALM_BIOMES[realm.fields.biome[i]];
/** The region water at i flows into (D8), or -1 for the sea. */
export function downOf(realm, i) {
  if (isSea(realm, i)) return -1;
  const n = realm.n, x = i % n, y = (i - x) / n, d = realm.fields.flow[i] & FLOW.DIR;
  return (y + DY[d]) * n + x + DX[d];
}

/** Whether region i suits start preset `startId` (3.8 Fits; params.js START_FIT). The civ part waits for W3. */
export function startFits(realm, i, startId) {
  const fit = START_FIT[startId];
  if (!fit || !isEmbarkable(realm, i)) return false;
  const f = realm.fields, b = band(realm, i);
  if (fit.relief === 'thick' && !(b >= BAND.UP || nextToBand(f, realm.n, realm.bands, i, BAND.HIGH))) return false;
  if (fit.deepSoil) {
    const id = REALM_BIOMES[f.biome[i]].id;
    if (b !== BAND.LOW || f.drain[i] < GEN.classify.lowDrain || id === 'saltflat' || id === 'ashlands') return false;
  }
  if (fit.water && !(riverClass(realm, i) || isLake(realm, i) || isCoast(realm, i))) return false;
  if (fit.biomes && !fit.biomes.some((id) => BIOME_INDEX[id] === f.biome[i])) return false;
  return true;
}

/** The civ owning region (rx, ry) at the end of history, or null. */
export function civOf(realm, rx, ry) {
  if (!inside(realm, rx, ry)) return null;
  const o = realm.fields.owner[idx(realm, rx, ry)];
  return o ? realm.tables.civs[o - 1] || null : null;
}
/** The site at region (rx, ry), or null. */
export function siteOf(realm, rx, ry) {
  if (!inside(realm, rx, ry)) return null;
  const s = realm.fields.site[idx(realm, rx, ry)];
  return s ? realm.tables.sites[s - 1] || null : null;
}
/** A historical figure by id, or null. */
export const figure = (realm, id) => (realm.tables.figures && realm.tables.figures[id]) || null;

/** Up to k nearest sites to (rx, ry): [{ site, id, d2 }], by squared distance then site id. */
export function neighbours(realm, rx, ry, k = 6) {
  const out = [], sites = realm.tables.sites || [];
  for (let id = 0; id < sites.length; id++) {
    const s = sites[id];
    if (!s) continue;
    const dx = s.x - rx, dy = s.y - ry;
    out.push({ site: s, id, d2: dx * dx + dy * dy });
  }
  out.sort((a, b) => a.d2 - b.d2 || a.id - b.id);
  return out.slice(0, k);
}

/** Cost in half-days of entering region j from i (1.2 step 10 costs: plains 1, hills 2, mountains 3, river 0.5). */
function stepCost(realm, i, j) {
  if (isSea(realm, j)) return 0;
  if (riverClass(realm, i) && riverClass(realm, j)) return 1;
  const b = band(realm, j), r = realm.fields.road[j];
  if (r) return 2;
  return b >= BAND.HIGH ? 6 : b === BAND.UP ? 4 : 2;
}
/**
 * Travel days by land from (ax, ay) to (bx, by): the cheapest 8-connected path (Dijkstra, ties by region
 * index), one region a day on plains. Infinity when the sea cuts them off. Optional `max` stops early.
 */
export function travelDays(realm, ax, ay, bx, by, max = Infinity) {
  const n = realm.n, N = n * n, src = ay * n + ax, dst = by * n + bx;
  if (!inside(realm, ax, ay) || !inside(realm, bx, by)) return Infinity;
  if (src === dst) return 0;
  const cost = new Float64Array(N).fill(Infinity), heap = [];
  const less = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  const push = (e) => { heap.push(e); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (!less(heap[c], heap[p])) break; [heap[c], heap[p]] = [heap[p], heap[c]]; c = p; } };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && less(heap[l], heap[m])) m = l; if (r < heap.length && less(heap[r], heap[m])) m = r; if (m === c) break; [heap[c], heap[m]] = [heap[m], heap[c]]; c = m; } }
    return top;
  };
  cost[src] = 0; push([0, src]);
  while (heap.length) {
    const [c, i] = pop();
    if (c > cost[i]) continue;
    if (i === dst) return c / 2;
    if (c / 2 > max) return Infinity;
    const x = i % n, y = (i - x) / n;
    for (let d = 0; d < 8; d++) {
      const xx = x + DX[d], yy = y + DY[d];
      if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
      const j = yy * n + xx, w = stepCost(realm, i, j);
      if (!w) continue;
      if (c + w < cost[j]) { cost[j] = c + w; push([c + w, j]); }
    }
  }
  return Infinity;
}

/** A hold's standing with civ `civ` from its s.realm deltas (9.1 `stand` rows [civ, goodwill, flags]), or null. */
export function standing(sRealm, civ) {
  const row = sRealm && Array.isArray(sRealm.stand) ? sRealm.stand.find((r) => r[0] === civ) : null;
  return row ? { civ, goodwill: row[1], flags: row[2] | 0 } : null;
}
