// ===== core.js : RNG, encoding, hex grid, heap (Hexarch: Exodus) =====
'use strict';
const HX_VERSION = '1.0.0';
const SAVE_FORMAT = 1;
const SQ3 = Math.sqrt(3);

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

// sfc32 generator; state is 4 uint32 and is saved with the game.
class RNG {
  constructor(state) { this.s = new Uint32Array(4); for (let i = 0; i < 4; i++) this.s[i] = state[i] >>> 0; }
  static fromSeed(str) { const r = new RNG(cyrb128(String(str))); for (let i = 0; i < 15; i++) r.next(); return r; }
  next() {
    const s = this.s;
    let a = s[0], b = s[1], c = s[2], d = s[3];
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    s[0] = a; s[1] = b; s[2] = c; s[3] = d;
    return (t >>> 0) / 4294967296;
  }
  int(n) { return Math.floor(this.next() * n); }
  range(a, b) { return a + this.next() * (b - a); }
  chance(p) { return this.next() < p; }
  pick(a) { return a[this.int(a.length)]; }
  shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = this.int(i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  state() { return Array.from(this.s); }
}

const SEED_A = ['violet','glowing','sporebound','crystal','drifting','silent','tidal','amber','umbral','prismatic','frozen','rust','teal','hollow','lucent','fungal','shimmering','abyssal','orbital','cobalt','ashen','verdant','iridescent','pale','singing','sunken','molten','misted','wandering','distant','feral','ancient','new','quiet'];
const SEED_B = ['landing','nebula','spire','veil','bloom','reef','crater','rift','canyon','lattice','orbit','comet','delta','grove','shelf','dune','drift','nest','beacon','haven','ark','signal','echo','vault','moon','basin','shard','tide','frontier','colony','harbor','hollow'];
function randomSeedString() {
  const r = Math.random;
  return SEED_A[Math.floor(r() * SEED_A.length)] + '-' + SEED_B[Math.floor(r() * SEED_B.length)] + '-' + (100 + Math.floor(r() * 900));
}

function u8ToB64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64ToU8(b) {
  const s = atob(b); const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}
function typedToB64(ta) { return u8ToB64(new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength)); }
// 0/1 arrays packed eight to a byte, prefixed with '~' so old unpacked saves still load.
function bitsToB64(a) { const out = new Uint8Array((a.length + 7) >> 3); for (let i = 0; i < a.length; i++) if (a[i]) out[i >> 3] |= 1 << (i & 7); return '~' + u8ToB64(out); }
function b64ToBits(b, n) { if (b[0] !== '~') return b64ToTyped(b, Uint8Array); const u = b64ToU8(b.slice(1)), out = new Uint8Array(n); for (let i = 0; i < n; i++) out[i] = (u[i >> 3] >> (i & 7)) & 1; return out; }
function b64ToTyped(b, Ctor) { const u = b64ToU8(b); return new Ctor(u.buffer, 0, u.byteLength / Ctor.BYTES_PER_ELEMENT); }

// Pointy-top hexes, odd-r offset rows (odd rows shifted right), horizontal wrap.
// Direction d (0..5) = E, SE, SW, W, NW, NE. Edge d of a hex lies between corners d and d+1.
const DIR_NAMES = ['E', 'SE', 'SW', 'W', 'NW', 'NE'];
const NB_EVEN = [[1, 0], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1]];
const NB_ODD = [[1, 0], [1, 1], [0, 1], [-1, 0], [0, -1], [1, -1]];

class Grid {
  constructor(W, H) {
    this.W = W; this.H = H; this.N = W * H;
    this.nb = new Int32Array(this.N * 6);
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      const i = r * W + c, t = (r & 1) ? NB_ODD : NB_EVEN;
      for (let d = 0; d < 6; d++) {
        const rr = r + t[d][1];
        this.nb[i * 6 + d] = (rr < 0 || rr >= H) ? -1 : rr * W + (((c + t[d][0]) % W) + W) % W;
      }
    }
    this.stamp = new Int32Array(this.N); this.stampV = 0; this.dst = new Int32Array(this.N);
    // axial coordinates, precomputed for fast distance
    this.q = new Int32Array(this.N); this.r = new Int32Array(this.N);
    for (let i = 0; i < this.N; i++) { const r = (i / W) | 0, c = i - r * W; this.r[i] = r; this.q[i] = c - ((r - (r & 1)) >> 1); }
  }
  col(i) { return i % this.W; }
  row(i) { return (i / this.W) | 0; }
  idx(c, r) { if (r < 0 || r >= this.H) return -1; const W = this.W; return r * W + ((c % W) + W) % W; }
  dist(a, b) {
    const W = this.W, dr = this.r[b] - this.r[a];
    let dq = this.q[b] - this.q[a];
    // wrap east-west: try the copy shifted by one world width in the nearer direction
    const adr = dr < 0 ? -dr : dr;
    let d1 = ((dq < 0 ? -dq : dq) + adr + (dq + dr < 0 ? -(dq + dr) : dq + dr)) >> 1;
    const dq2 = dq > 0 ? dq - W : dq + W;
    const d2 = ((dq2 < 0 ? -dq2 : dq2) + adr + (dq2 + dr < 0 ? -(dq2 + dr) : dq2 + dr)) >> 1;
    return d1 < d2 ? d1 : d2;
  }
  // BFS ring expansion. Returns tiles ordered by distance; distances readable via this.dst[t]
  // until the next call to within().
  within(i, radius) {
    const st = ++this.stampV, out = [i], nb = this.nb, stamp = this.stamp, dst = this.dst;
    stamp[i] = st; dst[i] = 0;
    let head = 0;
    while (head < out.length) {
      const t = out[head++], d = dst[t];
      if (d >= radius) continue;
      for (let k = 0; k < 6; k++) {
        const n = nb[t * 6 + k];
        if (n < 0 || stamp[n] === st) continue;
        stamp[n] = st; dst[n] = d + 1; out.push(n);
      }
    }
    return out;
  }
  inLast(t) { return this.stamp[t] === this.stampV; }
  dirTo(a, b) { for (let d = 0; d < 6; d++) if (this.nb[a * 6 + d] === b) return d; return -1; }
  neighbors(i) { const o = []; for (let d = 0; d < 6; d++) { const n = this.nb[i * 6 + d]; if (n >= 0) o.push(n); } return o; }
}

class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v, top = v[0], lk = k.pop(), lv = v.pop(), n = k.length;
    if (n > 0) {
      let i = 0;
      while (true) {
        let l = 2 * i + 1; if (l >= n) break;
        if (l + 1 < n && k[l + 1] < k[l]) l++;
        if (k[l] >= lk) break;
        k[i] = k[l]; v[i] = v[l]; i = l;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}
