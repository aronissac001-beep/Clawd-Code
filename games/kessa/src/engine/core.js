// ===== core.js : namespace, seeded RNG, noise, small helpers =====
'use strict';
var KC = {};
const KC_VERSION = '1.0.0';
const SAVE_FORMAT = 1;
const HOURS_PER_SOL = 24;

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

// sfc32: 4 x uint32 of state, saved with the game so runs replay exactly
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
  weighted(items, wf) { let tot = 0; for (const it of items) tot += Math.max(0, wf(it)); let r = this.next() * tot; for (const it of items) { r -= Math.max(0, wf(it)); if (r <= 0) return it; } return items[items.length - 1]; }
  state() { return Array.from(this.s); }
}

// seeded 2D value noise with fractal sum
function makeNoise(rng) {
  const P = new Uint8Array(512), V = new Float32Array(256);
  const perm = []; for (let i = 0; i < 256; i++) perm.push(i);
  rng.shuffle(perm);
  for (let i = 0; i < 512; i++) P[i] = perm[i & 255];
  for (let i = 0; i < 256; i++) V[i] = rng.next() * 2 - 1;
  const sm = t => t * t * (3 - 2 * t);
  function n2(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const a = V[P[(xi & 255) + P[yi & 255]]], b = V[P[((xi + 1) & 255) + P[yi & 255]]];
    const c = V[P[(xi & 255) + P[(yi + 1) & 255]]], d = V[P[((xi + 1) & 255) + P[(yi + 1) & 255]]];
    const u = sm(xf), v = sm(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, oct = 4, lac = 2, gain = 0.5) {
    let s = 0, amp = 1, f = 1, norm = 0;
    for (let o = 0; o < oct; o++) { s += amp * n2(x * f, y * f); norm += amp; amp *= gain; f *= lac; }
    return s / norm;
  }
  function ridge(x, y, oct = 4) {
    let s = 0, amp = 1, f = 1, norm = 0;
    for (let o = 0; o < oct; o++) { s += amp * (1 - Math.abs(n2(x * f, y * f))); norm += amp; amp *= 0.5; f *= 2; }
    return s / norm;
  }
  return { n2, fbm, ridge };
}

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const round1 = v => Math.round(v * 10) / 10;
function cheb(ax, ay, bx, by) { return Math.max(Math.abs(ax - bx), Math.abs(ay - by)); }
function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
function addTo(obj, k, v) { obj[k] = (obj[k] || 0) + v; }
function deepClone(o) { return JSON.parse(JSON.stringify(o)); }
function solOf(tick) { return Math.floor(tick / HOURS_PER_SOL) + 1; }
function hourOf(tick) { return tick % HOURS_PER_SOL; }
function fmtTime(tick) { const h = hourOf(tick); return 'Sol ' + solOf(tick) + ', ' + String(h).padStart(2, '0') + ':00'; }
Object.assign(KC, { RNG, makeNoise, cyrb128, clamp, lerp, cheb, dist, solOf, hourOf, fmtTime, round1, deepClone });

const SEED_A = ['amber', 'ashen', 'basalt', 'cinder', 'cobalt', 'dusk', 'ember', 'ferrite', 'frost', 'glass', 'grey', 'hollow', 'iron', 'lumen', 'mica', 'north', 'onyx', 'pale', 'quiet', 'rime', 'rust', 'salt', 'silent', 'slate', 'storm', 'umber', 'veil', 'wind'];
const SEED_B = ['basin', 'butte', 'cairn', 'caldera', 'crater', 'delta', 'drift', 'dune', 'flats', 'gorge', 'mesa', 'plain', 'reach', 'ridge', 'rift', 'scarp', 'shelf', 'spire', 'steppe', 'terrace', 'vale', 'vent', 'waste'];
function randomSeedName(r) { r = r || Math.random; return SEED_A[Math.floor(r() * SEED_A.length)] + '-' + SEED_B[Math.floor(r() * SEED_B.length)] + '-' + (100 + Math.floor(r() * 900)); }
KC.randomSeedName = randomSeedName;
