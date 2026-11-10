// ===== nature.js : natural wonders, placed once per world, discovered by exploring =====
const NATURAL = [
  { key: 'skyfall_crater', name: 'Skyfall Crater', glyph: '☄️', on: [T.DESERT, T.PLAINS], y: { s: 3, fa: 1 }, find: { s: 30 }, desc: 'A fallen star left this glassy bowl. +3 science, +1 faith.' },
  { key: 'emerald_falls', name: 'Emerald Falls', glyph: '💧', on: [T.GRASS, T.FOREST], river: true, y: { f: 2, g: 2, c: 1 }, find: { g: 60 }, desc: 'Water roars through green cliffs. +2 food, +2 gold, +1 culture.' },
  { key: 'elder_grove', name: 'Elder Grove', glyph: '🌳', on: [T.FOREST], y: { c: 2, fa: 2 }, find: { fa: 25 }, desc: 'Trees older than any kingdom. +2 culture, +2 faith.' },
  { key: 'glass_sea', name: 'Glass Sea', glyph: '🔮', on: [T.DESERT], y: { g: 3, s: 1 }, find: { g: 60 }, desc: 'Dunes fused into a mirror. +3 gold, +1 science.' },
  { key: 'frost_mirror', name: 'Frost Mirror', glyph: '❄️', on: [T.TUNDRA], y: { c: 3, f: 1 }, find: { c: 25 }, desc: 'A frozen lake that never thaws. +3 culture, +1 food.' },
  { key: 'ember_caldera', name: 'Ember Caldera', glyph: '🌋', on: [T.HILLS], y: { p: 3, s: 1 }, find: { s: 30 }, desc: 'A sleeping fire mountain. +3 production, +1 science.' },
  { key: 'singing_stones', name: 'Singing Stones', glyph: '🪨', on: [T.PLAINS, T.GRASS, T.HILLS], y: { c: 2, fa: 1, p: 1 }, find: { fa: 25 }, desc: 'Wind sings through standing stones. +2 culture, +1 faith, +1 production.' },
  { key: 'sunken_pillars', name: 'Sunken Pillars', glyph: '🏛️', on: [T.COAST], y: { g: 2, c: 2 }, find: { c: 25 }, desc: 'Ruins of a drowned city. +2 gold, +2 culture.' },
  { key: 'pearl_lagoon', name: 'Pearl Lagoon', glyph: '🦪', on: [T.COAST], y: { f: 2, g: 2 }, find: { g: 60 }, desc: 'Warm shallows full of pearls. +2 food, +2 gold.' },
  { key: 'thunder_peak', name: 'Thunder Peak', glyph: '⛰️', on: [T.HILLS], y: { fa: 3, p: 1 }, find: { fa: 25 }, desc: 'Storms circle its summit. +3 faith, +1 production.' },
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
    if (f.fa) P.faith += Math.round(f.fa * k * pace);
    if (f.c) P.culturePool += Math.round(f.c * k * pace);
    if (f.s && P.research) P.progress[P.research] = (P.progress[P.research] || 0) + Math.round(f.s * k * pace);
    if (P.human) logEvent(G, pid, `You discovered ${N.name}${first ? ', the first to see it' : ''}! ` + (f.g ? `+${Math.round(f.g * k * pace)} gold.` : f.fa ? `+${Math.round(f.fa * k * pace)} faith.` : f.c ? `+${Math.round(f.c * k * pace)} culture.` : `+${Math.round(f.s * k * pace)} science toward your research.`), n.tile);
  }
}
function naturalInBorders(G, pid) { return (G.natural || []).filter(n => G.map.owner[n.tile] === pid).length; }
Object.assign(HX, { NATURAL, naturalAt, naturalInBorders });
