// Seeded RNG streams kept in the state (s.rng.<stream> is a u32 mulberry32 state), so a save
// restores every stream exactly. All sim randomness goes through these (14.1); never Math.random.
// The step is bit-identical to js/engine/rng.js RNG.next (reused generator).

export const STREAMS = Object.freeze(['main', 'story', 'gen', 'names', 'combat']);

/** FNV-1a 32-bit plus an avalanche, identical to js/engine/rng.js hashString. */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** hash32(...parts) of EMBERCROWN-WORLD.md G2: hashString(parts.join(':')), integers in base 10. */
export const hash32 = (...parts) => hashString(parts.join(':'));

/** A seed (number or text) as a u32. */
export const seedOf = (seed) => (typeof seed === 'number' ? seed >>> 0 : hashString(String(seed)));

/** Fresh stream states for a colony seed: { main, story, gen, names, combat }. */
export function initStreams(seed) {
  const base = seedOf(seed), r = {};
  for (const k of STREAMS) r[k] = hashString(k + ':' + base) || 0x9e3779b9;
  return r;
}

/** Next u32 from stream `k` of s.rng (advances it). */
export function nextU32(s, k) {
  let t = (s.rng[k] = (s.rng[k] + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}
/** Float in [0, 1). */
export const rnd = (s, k = 'main') => nextU32(s, k) / 4294967296;
/** Integer in [a, b] inclusive. */
export const rint = (s, k, a, b) => a + Math.floor(rnd(s, k) * (b - a + 1));
/** True with probability p (p in [0, 1]); p given as permille integer with rchanceP. */
export const rchance = (s, k, p) => rnd(s, k) < p;
export const rchanceP = (s, k, permille) => nextU32(s, k) % 1000 < permille;
export function rpick(s, k, arr) { return arr[Math.floor(rnd(s, k) * arr.length)]; }
export function rshuffle(s, k, arr) {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd(s, k) * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
  return arr;
}
/** A derived u32 seed for a labelled sub-generator (mapgen steps: fork(s, 'gen', 'gen:river')). Advances the stream once. */
export const fork = (s, k, label) => hashString(label + ':' + nextU32(s, k));
