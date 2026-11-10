// ===== nature.js : Veyra's natural wonders, placed once per world, discovered by exploring =====
const NATURAL = [
  { key: 'hollow_titan', name: 'Hollow Titan', glyph: '🦴', on: [T.PLAINS, T.DESERT], y: { s: 3, c: 1 }, find: { s: 30 }, desc: 'The ribcage of a beast larger than any colony, bleached and humming in the wind. +3 science, +1 culture.' },
  { key: 'lumina_falls', name: 'Lumina Falls', glyph: '💧', on: [T.GRASS, T.FOREST], river: true, y: { f: 2, g: 2, c: 1 }, find: { g: 60 }, desc: 'A waterfall that glows blue-green all night. +2 food, +2 credits, +1 culture.' },
  { key: 'choir_spires', name: 'Choir Spires', glyph: '🎼', on: [T.HILLS], y: { c: 3, p: 1 }, find: { c: 25 }, desc: 'Crystal columns that sing when the wind turns. +3 culture, +1 production.' },
  { key: 'abyssal_rift', name: 'Abyssal Rift', glyph: '🕳️', on: [T.PLAINS, T.DESERT], y: { p: 3, s: 1 }, find: { s: 30 }, desc: 'A canyon so deep its floor has never been seen. Its walls are rich in ore. +3 production, +1 science.' },
  { key: 'mother_grove', name: 'Mother Grove', glyph: '🍄', on: [T.FOREST], y: { f: 2, c: 2 }, find: { c: 25 }, desc: 'The oldest fungal cap on Veyra, a kilometre across. +2 food, +2 culture.' },
  { key: 'glass_eye', name: 'The Glass Eye', glyph: '👁️', on: [T.DESERT], y: { g: 3, s: 1 }, find: { g: 60 }, desc: 'A perfect lens of fused sand, staring at the sky. +3 credits, +1 science.' },
  { key: 'frozen_leviathan', name: 'Frozen Leviathan', glyph: '🧊', on: [T.TUNDRA], y: { c: 2, s: 2 }, find: { s: 30 }, desc: 'A sea monster locked in ice since before the Precursors. +2 culture, +2 science.' },
  { key: 'ember_vents', name: 'Ember Vents', glyph: '♨️', on: [T.HILLS], y: { p: 3, g: 1 }, find: { g: 60 }, desc: 'Geysers of mineral steam that never cool. +3 production, +1 credit.' },
  { key: 'drowned_spire', name: 'Drowned Spire', glyph: '🗼', on: [T.COAST], y: { s: 2, c: 2 }, find: { c: 25 }, desc: 'A Precursor tower rising from the shallows. +2 science, +2 culture.' },
  { key: 'kelp_cathedral', name: 'Kelp Cathedral', glyph: '🌊', on: [T.COAST], y: { f: 2, g: 2 }, find: { g: 60 }, desc: 'A forest of violet kelp taller than any building. +2 food, +2 credits.' },
];
const NATI = {}; NATURAL.forEach((n, i) => NATI[n.key] = i);
const NATURAL_COUNT = { tiny: 2, small: 3, medium: 5, large: 7, huge: 9 };
// Placed with its own RNG stream so existing seeds keep the same land and starts.
function placeNatural(G, starts) {
  const m = G.map, g = G._grid, rng = RNG.fromSeed(G.seed + '|nature'), want = NATURAL_COUNT[G.cfg.size] || 4;
  const pool = rng.shuffle(NATURAL.map((n, i) => i)), out = [];
  for (const ni of pool) {
    if (out.length >= want) break;
    const N = NATURAL[ni], cands = [];
    for (let t = 0; t < m.W * m.H; t++) {
      if (!N.on.includes(m.terrain[t]) || m.res[t] >= 0 || m.lake[t]) continue;
      if (N.river && !m.river[t]) continue;
      if (N.on.includes(T.COAST) && !g.neighbors(t).some(n => TERRAIN[m.terrain[n]].land)) continue;
      if (starts.some(s => g.dist(s, t) < 4) || out.some(o => g.dist(o.tile, t) < 8)) continue;
      cands.push(t);
    }
    if (cands.length) out.push({ key: N.key, tile: cands[rng.int(cands.length)] });
  }
  G.natural = out;
  for (const n of out) if (G.map.veil) G.map.veil[n.tile] = 0;
}
function naturalAt(G, t) { if (!G._nwAt) { G._nwAt = new Map(); for (const n of G.natural || []) G._nwAt.set(n.tile, NATURAL[NATI[n.key]]); } return G._nwAt.get(t) || null; }
// First sight of a natural wonder: a one-time reward and a log line.
function discoverNatural(G, pid) {
  const P = G.players[pid]; if (P.barbarian || !G.natural) return;
  P.nwSeen = P.nwSeen || [];
  for (const n of G.natural) {
    if (P.nwSeen.includes(n.key) || !P._vis[n.tile]) continue;
    P.nwSeen.push(n.key);
    const N = NATURAL[NATI[n.key]], first = !G.players.some(Q => Q !== P && (Q.nwSeen || []).includes(n.key)), k = first ? 1 : 0.5;
    const f = N.find, pace = paceOf(G);
    if (f.g) P.gold += Math.round(f.g * k * pace);
    if (f.c) P.culturePool += Math.round(f.c * k * pace);
    if (f.s) { const n2 = Math.round(f.s * k * pace); if (P.research) P.progress[P.research] = (P.progress[P.research] || 0) + n2; else P.progress._bank = (P.progress._bank || 0) + n2; }
    if (P.human) logEvent(G, pid, `You discovered ${N.name}${first ? ', the first to see it' : ''}! ` + (f.g ? `+${Math.round(f.g * k * pace)} credits.` : f.c ? `+${Math.round(f.c * k * pace)} culture.` : `+${Math.round(f.s * k * pace)} science.`), n.tile);
  }
}
function naturalInBorders(G, pid) { return (G.natural || []).filter(n => G.map.owner[n.tile] === pid).length; }
Object.assign(HX, { NATURAL, naturalAt, naturalInBorders });
