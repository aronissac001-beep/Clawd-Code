// ZONEFALL 3 — small shared helpers (math, rng, noise, DOM)
export const $ = s => document.querySelector(s);
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = t => t * t * (3 - 2 * t);
export const rand = (a, b) => a + Math.random() * (b - a);
export const randi = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];
export const chance = p => Math.random() < p;
export const dist = (ax, az, bx, bz) => Math.hypot(bx - ax, bz - az);
export const dist2 = (ax, az, bx, bz) => (bx - ax) * (bx - ax) + (bz - az) * (bz - az);
export const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
export const fmtTime = s => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
export function weighted(list, wIdx = 1, R = Math.random) {
  let tot = 0; for (const e of list) tot += e[wIdx];
  let r = R() * tot;
  for (const e of list) { r -= e[wIdx]; if (r <= 0) return e; }
  return list[list.length - 1];
}
export function shuffle(a, R = Math.random) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// deterministic RNG (mulberry32)
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  const f = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  f.range = (lo, hi) => lo + f() * (hi - lo);
  f.int = (lo, hi) => Math.floor(lo + f() * (hi - lo + 1));
  f.pick = arr => arr[Math.floor(f() * arr.length)];
  f.chance = p => f() < p;
  return f;
}
export function hash2(x, z, s = 0) { let h = (x * 374761393 + z * 668265263 + s * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }

// 2D gradient noise (Perlin-ish), seeded
export function makeNoise(seed) {
  const R = rng(seed); const p = new Uint8Array(512); const perm = [...Array(256).keys()];
  shuffle(perm, R); for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const gx = new Float32Array(256), gz = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const a = R() * Math.PI * 2; gx[i] = Math.cos(a); gz[i] = Math.sin(a); }
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  function n2(x, z) {
    const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
    const X = xi & 255, Z = zi & 255;
    const g = (ix, iz, dx, dz) => { const h = p[p[ix] + iz]; return gx[h] * dx + gz[h] * dz; };
    const a = g(X, Z, xf, zf), b = g(X + 1, Z, xf - 1, zf), c = g(X, Z + 1, xf, zf - 1), d = g(X + 1, Z + 1, xf - 1, zf - 1);
    const u = fade(xf), v = fade(zf);
    return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v; // ~ -0.7..0.7
  }
  n2.fbm = (x, z, oct = 4, lac = 2, gain = 0.5) => { let s = 0, amp = 1, f = 1, norm = 0; for (let i = 0; i < oct; i++) { s += n2(x * f, z * f) * amp; norm += amp; amp *= gain; f *= lac; } return s / norm; };
  n2.ridge = (x, z, oct = 4) => { let s = 0, amp = 1, f = 1, norm = 0; for (let i = 0; i < oct; i++) { s += (1 - Math.abs(n2(x * f, z * f) * 1.4)) * amp; norm += amp; amp *= 0.5; f *= 2; } return s / norm; };
  return n2;
}

// tiny binary min-heap keyed by Float64Array costs
export class Heap {
  constructor() { this.a = []; this.k = []; }
  get size() { return this.a.length; }
  push(v, key) { const a = this.a, k = this.k; a.push(v); k.push(key); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= k[i]) break; [a[p], a[i]] = [a[i], a[p]]; [k[p], k[i]] = [k[i], k[p]]; i = p; } }
  pop() {
    const a = this.a, k = this.k; const top = a[0]; const lv = a.pop(), lk = k.pop();
    if (a.length) { a[0] = lv; k[0] = lk; let i = 0; for (; ;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < a.length && k[l] < k[m]) m = l; if (r < a.length && k[r] < k[m]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; [k[m], k[i]] = [k[i], k[m]]; i = m; } }
    return top;
  }
}

export function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }
