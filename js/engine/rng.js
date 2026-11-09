// Seeded pseudo-random numbers. Every simulation decision draws from an RNG
// created here, so a run is fully reproducible from its seed text.
// mulberry32: tiny, fast, 32-bit state that is trivial to save and restore.

export function hashString(str) {
  // FNV-1a 32-bit, then a final avalanche so similar seeds diverge.
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export class RNG {
  constructor(seed) { this.s = (seed >>> 0) || 0x9e3779b9; }
  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  float(a = 0, b = 1) { return a + (b - a) * this.next(); }
  int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); } // inclusive
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  weighted(items, weightOf) {
    let total = 0;
    for (const it of items) total += Math.max(0, weightOf(it));
    let r = this.next() * total;
    for (const it of items) { r -= Math.max(0, weightOf(it)); if (r <= 0) return it; }
    return items[items.length - 1];
  }
  fork(label) { return new RNG(hashString(label + ':' + this.s)); }
  getState() { return this.s >>> 0; }
  setState(s) { this.s = s >>> 0; }
}

// Deterministic 2D value noise for terrain, built on a seed.
export function makeNoise2D(seed) {
  const perm = new Uint8Array(512);
  const r = new RNG(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = r.int(0, i); const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const val = (x, y) => perm[(perm[x & 255] + y) & 511] / 255;
  const fade = (t) => t * t * (3 - 2 * t);
  function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const a = val(xi, yi), b = val(xi + 1, yi), c = val(xi, yi + 1), d = val(xi + 1, yi + 1);
    const u = fade(xf), v = fade(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  return function fbm(x, y, oct = 3) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < oct; o++) { sum += noise(x * freq, y * freq) * amp; norm += amp; amp *= 0.5; freq *= 2; }
    return sum / norm;
  };
}

// Cheap integer hash for per-tile cosmetic variation (no state).
export function hash2(x, y, s = 0) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Human-friendly seed text for sharing, e.g. "EMBER-4821". UI only.
const WORDS = ['ASH', 'EMBER', 'CROWN', 'LANTERN', 'HEARTH', 'BRAND', 'CINDER', 'DAWN', 'TORCH', 'FORGE', 'WICK', 'GLEAM', 'SPARK', 'BEACON', 'KINDLE', 'GLOW'];
export function randomSeedText() {
  const w = WORDS[Math.floor(Math.random() * WORDS.length)];
  return w + '-' + String(1000 + Math.floor(Math.random() * 9000));
}
