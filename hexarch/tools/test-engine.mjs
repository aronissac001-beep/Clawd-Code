// Headless checks for the engine. Run: node hexarch/tools/test-engine.mjs
import { loadEngine } from './load-engine.mjs';
const { HX, ev } = loadEngine();
const TERRAIN = ev('TERRAIN'), MAPSIZE = ev('MAPSIZE'), RES = ev('RES');
let fails = 0;
const check = (cond, msg) => { if (!cond) { fails++; console.log('FAIL:', msg); } };

const sizes = ['small', 'medium', 'large'], scripts = ['continents', 'pangaea', 'archipelago', 'islands'];
const dist = {};
let t0 = Date.now(), maps = 0;
for (const size of sizes) for (const script of scripts) for (let s = 0; s < 6; s++) {
  const rivals = MAPSIZE[size].maxCivs - 1;
  const G = HX.makeGame({ size, script, rivals, seed: `t-${size}-${script}-${s}`, difficulty: 3 }, { allAI: true });
  maps++;
  const m = G.map, N = m.W * m.H;
  const cnt = new Array(10).fill(0); let rivers = 0, res = 0;
  for (let i = 0; i < N; i++) { cnt[m.terrain[i]]++; if (m.river[i]) rivers++; if (m.res[i] >= 0) res++; }
  const land = cnt.slice(0, 8).reduce((a, b) => a + b, 0);
  const key = script; dist[key] = dist[key] || { n: 0, land: 0, t: new Array(10).fill(0), rivers: 0 };
  dist[key].n++; dist[key].land += land / N; dist[key].rivers += rivers;
  for (let k = 0; k < 8; k++) dist[key].t[k] += cnt[k] / land;
  check(G.players.length === rivals + 1, 'player count');
  // each civ starts with a settler on land
  for (const P of G.players) {
    const st = G.units.find(u => u.owner === P.id && u.type === 'settler');
    check(st && TERRAIN[m.terrain[st.tile]].land, `settler on land ${size}/${script}/${s}`);
  }
  check(rivers > 0, `rivers exist ${size}/${script}/${s}`);
  // fairness: start landmass size and start quality spread
  const landMask = new Uint8Array(N); for (let i = 0; i < N; i++) landMask[i] = TERRAIN[m.terrain[i]].land && m.terrain[i] !== 7 ? 1 : 0;
  const comp = ev('components')(G._grid, landMask);
  const starts = G.players.map(P => G.units.find(u => u.owner === P.id && u.type === 'settler').tile);
  const minLand = Math.min(...starts.map(t => comp.sizes[comp.id[t]]));
  if (script === 'continents' || script === 'pangaea') check(minLand >= 40, `start landmass >= 40 on ${size}/${script}/${s} (got ${minLand})`);
  const sc = starts.map(t => HX.siteScore(m, G._grid, t));
  dist[key].spread = Math.max(dist[key].spread || 0, Math.min(...sc) / Math.max(...sc));
  dist[key].worst = Math.min(dist[key].worst ?? 1, Math.min(...sc) / Math.max(...sc));
}
console.log(`generated ${maps} maps in ${Date.now() - t0}ms`);
for (const k in dist) {
  const d = dist[k];
  console.log(k.padEnd(12), 'land', (d.land / d.n * 100).toFixed(1) + '%', 'riverTiles', (d.rivers / d.n).toFixed(0),
    TERRAIN.slice(0, 8).map((T, i) => T.key + ':' + (d.t[i] / d.n * 100).toFixed(0)).join(' '), 'worstStartRatio', d.worst.toFixed(2));
}

// determinism: same seed => same map
const a = HX.makeGame({ size: 'medium', script: 'continents', seed: 'det-check', rivals: 3 });
const b = HX.makeGame({ size: 'medium', script: 'continents', seed: 'det-check', rivals: 3 });
check(HX.serializeGame(a) === HX.serializeGame(b), 'same seed gives identical game');

// all-AI play: every civ founds a capital quickly and explores
for (const size of sizes) for (const script of scripts) {
  const G = HX.makeGame({ size, script, rivals: MAPSIZE[size].maxCivs - 1, seed: 'ai-' + size + script, difficulty: 3 }, { allAI: true });
  const capTurn = {};
  const t1 = Date.now();
  while (G.turn <= 60) {
    const pid = G.active;
    HX.aiTakeTurn(G, pid);
    if (!capTurn[pid] && G.cities.some(c => c.owner === pid)) capTurn[pid] = G.turn;
    HX.endPlayerTurn(G);
    const seenTiles = new Set();
    for (const u of G.units) {
      const civ = ev('UNITS')[u.type].civilian, key = (civ ? 'c' : 'm') + u.tile;
      if (seenTiles.has(key)) { check(false, `stacked ${key} on turn ${G.turn} ${size}/${script}`); break; }
      seenTiles.add(key);
      if ((civ ? G._civ : G._mil).get(u.tile) !== u) { check(false, `occupancy index out of sync on ${size}/${script}`); break; }
    }
  }
  const N = G.map.W * G.map.H;
  const expl = G.players.map(P => (P.explored.reduce((x, y) => x + y, 0) / N * 100).toFixed(0) + '%');
  const cities = G.players.map(P => G.cities.filter(c => c.owner === P.id).length);
  console.log(`${size}/${script}: capitals on turns ${JSON.stringify(capTurn)} cities ${cities} explored ${expl} (${Date.now() - t1}ms)`);
  for (const P of G.players) check(capTurn[P.id] && capTurn[P.id] <= 4, `capital by turn 4 for p${P.id} on ${size}/${script}`);
  // each civ has seen most of the landmass its capital sits on (scouts are not stuck)
  const lm = new Uint8Array(N); for (let i = 0; i < N; i++) lm[i] = TERRAIN[G.map.terrain[i]].land && G.map.terrain[i] !== 7 ? 1 : 0;
  const comp = ev('components')(G._grid, lm);
  const own = G.players.map(P => { const c = G.cities.find(x => x.owner === P.id); let a = 0, b = 0;
    for (let i = 0; i < N; i++) if (comp.id[i] === comp.id[c.tile]) { b++; if (P.explored[i]) a++; } return { f: a / b, a, b }; });
  console.log('   own-landmass explored', own.map(x => (x.f * 100).toFixed(0) + '% of ' + x.b).join(', '));
  for (const [k, x] of own.entries()) check(x.a >= Math.min(0.5 * x.b, 300), `p${k} explored enough of home landmass on ${size}/${script} (${x.a}/${x.b})`);
  // save round trip
  const s1 = HX.serializeGame(G), G2 = HX.deserializeGame(s1), s2 = HX.serializeGame(G2);
  check(s1 === s2, 'serialize round trip ' + size + script);
}
console.log(fails ? `${fails} failures` : 'all checks passed');
process.exit(fails ? 1 : 0);
