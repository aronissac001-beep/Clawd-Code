// Realm rivers and lakes, step 6 of EMBERCROWN-WORLD.md 1.2 (owner L).
// Priority-flood fill of depressions (binary heap keyed by level then region index, a total order), so every
// depth filled above its own level becomes a lake whose surface is the fill level; D8 flow to the lowest
// earlier-flooded neighbour; flow accumulated by rain from the sources down; stream, river and great river by
// thresholds; one erosion step. Elevation never rises along a river and every river ends in sea or a lake.
import { GEN } from '../../data/realm/params.js';
import { DX, DY } from './fields.js';

/** flow layer bits (1.1). */
export const FLOW = Object.freeze({ DIR: 7, CLS_SHIFT: 3, CLS: 0x18, LAKE: 0x20, COAST: 0x40, EMBARK: 0x80 });

/**
 * Priority-flood over a w x h grid of levels 0-255 (8-connected; w * h <= 65536). `outlet[i]` truthy marks the
 * cells water leaves by.
 * Returns { level, order, count }: level[i] = the lowest level water at i can drain at (the depression fill);
 * order = the cells in flood order (outlets first, each cell after the neighbour that reached it).
 * Cells unreachable from any outlet keep level 65535 and are not in `order`.
 */
export function priorityFlood(elev, w, h, outlet) {
  const N = w * h, level = new Uint16Array(N).fill(65535), done = new Uint8Array(N), order = new Int32Array(N);
  const heap = new Int32Array(N + 8 * N); let hn = 0, count = 0;
  const SH = 16384 * 4;                                   // key = level * SH + index; index < SH
  const push = (k) => { let c = hn++; heap[c] = k; while (c > 0) { const p = (c - 1) >> 1; if (heap[p] <= k) break; heap[c] = heap[p]; c = p; } heap[c] = k; };
  const pop = () => {
    const top = heap[0], k = heap[--hn]; let c = 0;
    for (;;) { let m = 2 * c + 1; if (m >= hn) break; if (m + 1 < hn && heap[m + 1] < heap[m]) m++; if (heap[m] >= k) break; heap[c] = heap[m]; c = m; }
    heap[c] = k; return top;
  };
  for (let i = 0; i < N; i++) if (outlet[i]) { level[i] = elev[i]; push(elev[i] * SH + i); }
  while (hn) {
    const k = pop(), i = k % SH;
    if (done[i]) continue;
    done[i] = 1; order[count++] = i;
    const x = i % w, y = (i - x) / w, L = level[i];
    for (let d = 0; d < 8; d++) {
      const xx = x + DX[d], yy = y + DY[d];
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const j = yy * w + xx;
      if (done[j]) continue;
      const v = elev[j] > L ? elev[j] : L;
      if (v < level[j]) { level[j] = v; push(v * SH + j); }
    }
  }
  return { level, order, count };
}

/**
 * Lakes: filled cells at least lakeDepth deep. A filled basin (8-connected) larger than `max` keeps only its
 * deepest part as lake (the smallest depth cut that leaves at most `max` cells); the rest is a flat valley floor.
 */
function lakes(elev, level, sea, n, max, lake) {
  const N = n * n, seen = new Uint8Array(N), q = new Int32Array(N), hist = new Uint32Array(256), D = GEN.river.lakeDepth;
  for (let s0 = 0; s0 < N; s0++) {
    if (sea[s0] || seen[s0] || level[s0] - elev[s0] < D) continue;
    let h = 0, t = 0; q[t++] = s0; seen[s0] = 1; hist.fill(0);
    while (h < t) {
      const i = q[h++], x = i % n, y = (i - x) / n;
      hist[level[i] - elev[i]]++;
      for (let d = 0; d < 8; d++) {
        const xx = x + DX[d], yy = y + DY[d];
        if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
        const j = yy * n + xx;
        if (!seen[j] && !sea[j] && level[j] - elev[j] >= D) { seen[j] = 1; q[t++] = j; }
      }
    }
    let cut = D, left = t;
    while (left > max && cut < 255) { left -= hist[cut]; cut++; }
    for (let k = 0; k < t; k++) if (level[q[k]] - elev[q[k]] >= cut) lake[q[k]] = 1;
  }
}

/** Step 6. Writes elev (lake surfaces, erosion), flow (direction, class, lake, coast) and rx.lake / rx.down. */
export function riversStep(rx) {
  const { n } = rx, N = n * n, f = rx.f, sea = rx.sea, Rv = GEN.river;
  const { level, order, count } = priorityFlood(f.elev, n, n, sea);
  const rank = new Int32Array(N), lake = new Uint8Array(N), down = new Int32Array(N).fill(-1);
  for (let k = 0; k < count; k++) rank[order[k]] = k;
  lakes(f.elev, level, sea, n, Math.floor(Rv.lakeMax * rx.sc * rx.sc), lake);
  for (let i = 0; i < N; i++) if (!sea[i]) f.elev[i] = level[i];
  // D8: the lowest (level, flood rank) neighbour among those flooded earlier, so flow never loops
  const dir = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (sea[i]) continue;
    const x = i % n, y = (i - x) / n;
    let best = -1, bd = 0;
    for (let d = 0; d < 8; d++) {
      const xx = x + DX[d], yy = y + DY[d];
      if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
      const j = yy * n + xx;
      if (rank[j] >= rank[i]) continue;
      if (best < 0 || f.elev[j] < f.elev[best] || (f.elev[j] === f.elev[best] && rank[j] < rank[best])) { best = j; bd = d; }
    }
    down[i] = best; dir[i] = bd;
  }
  // flow accumulation by rain, sources first (reverse flood order)
  const acc = new Float64Array(N);
  for (let k = count - 1; k >= 0; k--) {
    const i = order[k];
    if (sea[i]) continue;
    acc[i] += 1 + f.rain[i] / Rv.perRain;
    if (down[i] >= 0) acc[down[i]] += acc[i];
  }
  const cls = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (!sea[i] && !lake[i]) cls[i] = acc[i] >= Rv.t3 ? 3 : acc[i] >= Rv.t2 ? 2 : acc[i] >= Rv.t1 ? 1 : 0;
  // one erosion step: river cells drop by 1, downstream first, never below sea level or the cell below them
  const sl = rx.seaLevel;
  for (let k = 0; k < count; k++) {
    const i = order[k];
    if (!cls[i]) continue;
    let e = f.elev[i] - 1;
    const dn = down[i], floor = dn >= 0 && !sea[dn] && f.elev[dn] > sl ? f.elev[dn] : sl;
    if (e < floor) e = floor;
    if (e < f.elev[i]) f.elev[i] = e;
  }
  for (let i = 0; i < N; i++) {
    if (sea[i]) { f.flow[i] = 0; continue; }
    const x = i % n, y = (i - x) / n;
    let coast = 0;
    for (let d = 0; d < 8; d += 2) {
      const xx = x + DX[d], yy = y + DY[d];
      if (xx >= 0 && yy >= 0 && xx < n && yy < n && sea[yy * n + xx]) coast = FLOW.COAST;
    }
    f.flow[i] = dir[i] | (cls[i] << FLOW.CLS_SHIFT) | (lake[i] ? FLOW.LAKE : 0) | coast;
  }
  rx.lake = lake; rx.down = down; rx.acc = acc;
}

/** Problems with the rivers of a realm's fields (1.4): [] when every river runs downhill into a river, a lake or the sea. */
export function riverFaults(f, n, seaLevel) {
  const out = [], N = n * n;
  for (let i = 0; i < N; i++) {
    const fl = f.flow[i];
    if (f.elev[i] < seaLevel || !((fl & FLOW.CLS) >> FLOW.CLS_SHIFT)) continue;
    const x = i % n, y = (i - x) / n, d = fl & FLOW.DIR, xx = x + DX[d], yy = y + DY[d];
    if (xx < 0 || yy < 0 || xx >= n || yy >= n) { out.push(`river ${x},${y} runs off the map`); continue; }
    const j = yy * n + xx, gj = f.flow[j];
    if (f.elev[j] > f.elev[i]) out.push(`river ${x},${y} rises into ${xx},${yy}`);
    const ends = f.elev[j] < seaLevel || (gj & FLOW.LAKE) || ((gj & FLOW.CLS) >> FLOW.CLS_SHIFT);
    if (!ends) out.push(`river ${x},${y} ends on dry land at ${xx},${yy}`);
  }
  return out;
}
