// ===== core.js : namespace, seeded RNG, helpers, names, graph search =====
'use strict';
var SW = {};
var SW_VERSION = '1.0.0';
var SAVE_FORMAT = 1;
var DAYS_MONTH = 30, DAYS_YEAR = 360;

function cyrb128(str) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0, k; i < str.length; i++) {
    k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= (h2 ^ h3 ^ h4); h2 ^= h1; h3 ^= h1; h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}
// sfc32 over a plain array of four uint32 (kept in the game state so saves resume the same stream)
function rngState(seed) { const s = cyrb128(String(seed)); const o = { rng: s }; for (let i = 0; i < 12; i++) rnd(o); return o.rng; }
function rnd(o) {
  const s = o.rng;
  let a = s[0] >>> 0, b = s[1] >>> 0, c = s[2] >>> 0, d = s[3] >>> 0;
  let t = (a + b) | 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) | 0;
  c = (c << 21) | (c >>> 11);
  d = (d + 1) | 0;
  t = (t + d) | 0;
  c = (c + t) | 0;
  s[0] = a >>> 0; s[1] = b >>> 0; s[2] = c >>> 0; s[3] = d >>> 0;
  return (t >>> 0) / 4294967296;
}
function rint(o, a, b) { return a + Math.floor(rnd(o) * (b - a + 1)); }
function rpick(o, arr) { return arr[Math.floor(rnd(o) * arr.length)]; }
function rchance(o, p) { return rnd(o) < p; }
function rgauss(o) { let u = 0; for (let i = 0; i < 4; i++) u += rnd(o); return (u - 2) / 0.577; }
// pick from [[item, weight], ...] or array with weight fn
function rweighted(o, items, wfn) {
  let tot = 0; const ws = items.map(x => { const w = Math.max(0, wfn ? wfn(x) : x[1]); tot += w; return w; });
  if (tot <= 0) return null;
  let r = rnd(o) * tot;
  for (let i = 0; i < items.length; i++) { r -= ws[i]; if (r <= 0) return wfn ? items[i] : items[i][0]; }
  return wfn ? items[items.length - 1] : items[items.length - 1][0];
}
function rshuffle(o, arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd(o) * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const sum = (arr, f) => { let s = 0; for (const x of arr) s += f ? f(x) : x; return s; };
const hyp = (dx, dy) => Math.sqrt(dx * dx + dy * dy);
const r1 = v => Math.round(v * 10) / 10;
function nextId(G, k) { G.ids[k] = (G.ids[k] || 0) + 1; return G.ids[k]; }
function addTo(obj, k, v) { obj[k] = (obj[k] || 0) + v; }
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

// ---------- names ----------
const NAME_A = ['Ae', 'Vel', 'Or', 'Thes', 'Ka', 'Ilm', 'Syr', 'Dra', 'Mo', 'Quel', 'Ny', 'Ze', 'Tor', 'Ul', 'Vey', 'Ash', 'Bri', 'Cor', 'Esk', 'Fa', 'Gal', 'Hes', 'Io', 'Jun', 'Kir', 'Lun', 'Mer', 'Nor', 'Oph', 'Pyr', 'Rho', 'Sel', 'Tam', 'Ves', 'Xan', 'Yr', 'Zor', 'Cael', 'Daer', 'Eth', 'Fen', 'Gry', 'Hal', 'Ix', 'Lys', 'Myr', 'Nim', 'Ost', 'Pel', 'Rav', 'Sae', 'Tyr', 'Vor', 'Wen'];
const NAME_B = ['a', 'e', 'i', 'o', 'u', 'ae', 'ia', 'ou', 'ei', 'y', 'ar', 'en', 'ir', 'or', 'an', 'el', 'is', 'on', 'ul', 'ys'];
const NAME_C = ['ra', 'th', 'nis', 'dor', 'lex', 'mir', 'vos', 'tia', 'rax', 'phi', 'lon', 'dra', 'nox', 'sca', 'ven', 'mus', 'tis', 'gar', 'lis', 'qua', 'ron', 'sar', 'tan', 'vex', 'zan', 'kos', 'lae', 'mon', 'rin', 'tos', 'nar', 'dis', 'ker', 'les', 'mae', 'rho', 'sil', 'tor', 'xis', 'yne'];
function makeName(o, used, minLen) {
  for (let k = 0; k < 60; k++) {
    let n = rpick(o, NAME_A);
    const parts = rchance(o, 0.55) ? 2 : rchance(o, 0.6) ? 1 : 3;
    if (parts >= 2) n += rpick(o, NAME_B);
    n += rpick(o, NAME_C);
    if (parts === 3) n += rpick(o, NAME_B) + rpick(o, ['n', 's', 'r', 'th', 'x', 'l']);
    if (rchance(o, 0.08)) n += ' ' + rpick(o, ['Prime', 'Major', 'Minor', 'Reach', 'Deep', 'Gate', 'Rest', 'Hollow']);
    if (n.length < (minLen || 4) || n.length > 14) continue;
    if (!used || !used.has(n)) { if (used) used.add(n); return n; }
  }
  const n = rpick(o, NAME_A) + '-' + rint(o, 10, 999); if (used) used.add(n); return n;
}

// ---------- binary heap for Dijkstra ----------
class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v, top = v[0], lk = k.pop(), lv = v.pop(), n = k.length;
    if (n) {
      let i = 0;
      for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && k[c + 1] < k[c]) c++; if (k[c] >= lk) break; k[i] = k[c]; v[i] = v[c]; i = c; }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}
// shortest path over starlanes, weighted by lane length; avoid(sysId) -> extra cost or Infinity
function findPath(G, from, to, avoid) {
  if (from === to) return [];
  const n = G.systems.length, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1);
  const h = new Heap(); dist[from] = 0; h.push(0, from);
  while (h.size) {
    const u = h.pop(); if (u === to) break;
    const su = G.systems[u], du = dist[u];
    for (const w of su.lanes) {
      const sw = G.systems[w];
      let c = hyp(su.x - sw.x, su.y - sw.y);
      if (avoid && w !== to) { const a = avoid(w); if (a === Infinity) continue; c += a; }
      if (du + c < dist[w]) { dist[w] = du + c; prev[w] = u; h.push(dist[w], w); }
    }
  }
  if (prev[to] < 0) return null;
  const path = []; for (let x = to; x !== from; x = prev[x]) path.push(x);
  return path.reverse();
}
// jump counts from a set of start systems (BFS); maxD limits the search
function jumpDist(G, starts, maxD) {
  const d = new Int16Array(G.systems.length).fill(-1); const q = [];
  for (const s of starts) { d[s] = 0; q.push(s); }
  for (let i = 0; i < q.length; i++) {
    const u = q[i]; if (maxD != null && d[u] >= maxD) continue;
    for (const w of G.systems[u].lanes) if (d[w] < 0) { d[w] = d[u] + 1; q.push(w); }
  }
  return d;
}
function pathLength(G, from, path) {
  let L = 0, a = from;
  for (const b of path) { const s = G.systems[a], t = G.systems[b]; L += hyp(s.x - t.x, s.y - t.y); a = b; }
  return L;
}
SW.findPath = findPath; SW.jumpDist = jumpDist;
SW.rnd = rnd;
