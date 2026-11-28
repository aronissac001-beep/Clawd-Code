// Roads (EMBERCROWN-WORLD.md 1.2 step 10, 2.3 step 9; owner L). After history: A* over regions between friendly
// sites (the sites of one living civ, and the nearest sites of two civs bound by a pact and not at war).
// Cost in half-days: plains 2, hills 4, mountains 6, a river or lake barge 1, an existing road 1; the sea is
// closed. 4-connected; the open list breaks ties by f, then g, then region index (a total order, so every engine
// agrees). The `road` layer is a bitmask N 1, E 2, S 4, W 8 (js/engine/render/atlas.js draws E and S links).
// No randomness: the roads are a pure function of the fields and the sites. Lint: tools/check-mapgen.mjs.
import { HISTORY_GEN } from '../../data/realm/civkinds.js';
import { BAND, bandOf } from './biomes.js';
import { FLOW } from './rivers.js';

const DIR4 = Object.freeze([[0, -1, 1, 4], [1, 0, 2, 8], [0, 1, 4, 1], [-1, 0, 8, 2]]);   // dx, dy, bit here, bit there
const cheb = (a, b) => { const dx = a.x > b.x ? a.x - b.x : b.x - a.x, dy = a.y > b.y ? a.y - b.y : b.y - a.y; return dx > dy ? dx : dy; };

/** Entry cost (half-days) of region j from i, or 0 when closed. */
function cost(realm, i, j) {
  const f = realm.fields, C = HISTORY_GEN.road;
  if (f.elev[j] < realm.seaLevel) return 0;
  if (f.road[j]) return 1;
  const wet = (k) => (f.flow[k] & (FLOW.CLS | FLOW.LAKE)) !== 0;
  if (wet(i) && wet(j)) return C.river;
  const b = bandOf(f.elev[j], realm.bands);
  return b >= BAND.HIGH ? C.mount : b === BAND.UP ? C.hill : C.plain;
}

/** A* from region a to region b: the path as region indices a..b, or null. Scratch arrays come from S. */
export function roadPath(realm, a, b, S) {
  const n = realm.n, g = S.g, from = S.from, stamp = S.stamp, mark = ++S.k;
  const bx = b % n, by = (b - bx) / n, heap = [];
  const h = (i) => { const x = i % n, y = (i - x) / n; return (x > bx ? x - bx : bx - x) + (y > by ? y - by : by - y); };
  const less = (p, q) => p[0] < q[0] || (p[0] === q[0] && (p[1] < q[1] || (p[1] === q[1] && p[2] < q[2])));
  const push = (e) => { heap.push(e); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (!less(heap[c], heap[p])) break; const t = heap[c]; heap[c] = heap[p]; heap[p] = t; c = p; } };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && less(heap[l], heap[m])) m = l; if (r < heap.length && less(heap[r], heap[m])) m = r; if (m === c) break; const t = heap[c]; heap[c] = heap[m]; heap[m] = t; c = m; } }
    return top;
  };
  stamp[a] = mark; g[a] = 0; from[a] = -1; push([h(a), 0, a]);
  while (heap.length) {
    const [, gc, i] = pop();
    if (gc > g[i]) continue;
    if (i === b) {
      const path = [];
      for (let k = b; k >= 0; k = from[k]) path.push(k);
      return path.reverse();
    }
    const x = i % n, y = (i - x) / n;
    for (const [dx, dy] of DIR4) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
      const j = yy * n + xx, w = cost(realm, i, j);
      if (!w) continue;
      const ng = gc + w;
      if (stamp[j] !== mark || ng < g[j]) { stamp[j] = mark; g[j] = ng; from[j] = i; push([ng + h(j), ng, j]); }
    }
  }
  return null;
}

/** Write a path's links into the `road` layer. */
function lay(realm, path) {
  const n = realm.n, r = realm.fields.road;
  for (let k = 1; k < path.length; k++) {
    const i = path[k - 1], j = path[k], d = j - i;
    const dir = d === -n ? 0 : d === 1 ? 1 : d === n ? 2 : 3;
    r[i] |= DIR4[dir][2]; r[j] |= DIR4[dir][3];
  }
}

/**
 * Step 10: clear the road layer, then lay the roads of a settled realm and return the roads table
 * [[siteA, siteB, halfDays]] (siteA < siteB). Within each living civ, its `perCiv` largest living sites join
 * the nearest already-joined one (a Prim tree from the capital) when within `reach`; each pact pair joins its
 * nearest two living sites when within `reach`. `friendly(ca, cb)` says whether two civs may share a road.
 */
export function roadsStep(realm, sites, civs, friendly) {
  const n = realm.n, N = n * n, C = HISTORY_GEN.road, reach = Math.max(4, Math.round(C.reach * n / 64));
  realm.fields.road.fill(0);
  const S = { g: new Int32Array(N), from: new Int32Array(N), stamp: new Int32Array(N), k: 0 };
  const out = [], done = new Set();
  const live = (s) => s && s.razed === null && s.civ !== null;
  const join = (sa, sb) => {
    const a = sa.id < sb.id ? sa : sb, b = a === sa ? sb : sa, key = a.id * 65536 + b.id;
    if (done.has(key)) return;
    done.add(key);
    const p = roadPath(realm, a.y * n + a.x, b.y * n + b.x, S);
    if (!p) return;
    let hd = 0;
    for (let k = 1; k < p.length; k++) hd += cost(realm, p[k - 1], p[k]);
    lay(realm, p);
    out.push([a.id, b.id, hd]);
  };
  for (const c of civs) {
    if (c.fell !== null) continue;
    const mine = sites.filter((s) => live(s) && s.civ === c.id).sort((p, q) => q.size - p.size || (p.id === c.cap ? -1 : q.id === c.cap ? 1 : p.id - q.id)).slice(0, C.perCiv);
    const tree = mine.length ? [mine[0]] : [];
    for (let k = 1; k < mine.length; k++) {
      let best = null, bd = 1e9;
      for (const t of tree) { const d = cheb(mine[k], t); if (d < bd || (d === bd && t.id < best.id)) { bd = d; best = t; } }
      if (best && bd <= reach) join(mine[k], best);
      tree.push(mine[k]);
    }
  }
  for (const c of civs) {
    if (c.fell !== null) continue;
    for (const o of c.pacts.slice().sort((p, q) => p - q)) {
      if (o <= c.id || civs[o].fell !== null || !friendly(c.id, o)) continue;
      let best = null, bd = 1e9;
      for (const sa of sites) {
        if (!live(sa) || sa.civ !== c.id) continue;
        for (const sb of sites) {
          if (!live(sb) || sb.civ !== o) continue;
          const d = cheb(sa, sb);
          if (d < bd) { bd = d; best = [sa, sb]; }
        }
      }
      if (best && bd <= reach) join(best[0], best[1]);
    }
  }
  return out;
}
