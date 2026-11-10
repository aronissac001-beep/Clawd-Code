// ===== galaxy.js : procedural galaxy (stars, starlanes, planets, deposits, nebulae, special systems) =====
var GALAXY_SIZES = { small: { n: 120, empires: 5, label: 'Small · 120 stars' }, medium: { n: 200, empires: 7, label: 'Medium · 200 stars' }, large: { n: 300, empires: 9, label: 'Large · 300 stars' } };
var GALAXY_SHAPES = { spiral2: 'Spiral, 2 arms', spiral4: 'Spiral, 4 arms', elliptical: 'Elliptical', ring: 'Ring' };
PLANET_TYPES.beacon = { name: 'Wake Beacon', cols: ['#203050', '#6fd6ff', '#e8fbff'], tex: 'beacon' };

function genStars(o, n, shape) {
  const R = 52 * Math.sqrt(n), minD = 38, pts = [];
  const cell = minD, grid = new Map();
  const key = (x, y) => Math.floor(x / cell) + ',' + Math.floor(y / cell);
  const ok = (x, y) => {
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const b = grid.get((cx + dx) + ',' + (cy + dy)); if (!b) continue;
      for (const p of b) if (hyp(p[0] - x, p[1] - y) < minD) return false;
    }
    return true;
  };
  const arms = shape === 'spiral4' ? 4 : 2, twist = shape === 'spiral4' ? 3.2 : 3.8;
  let tries = 0;
  while (pts.length < n && tries < n * 400) {
    tries++;
    let x, y;
    if (shape === 'spiral2' || shape === 'spiral4') {
      const d = 0.1 + Math.pow(rnd(o), 0.8) * 0.9;
      if (rnd(o) < 0.16) { // bulge
        const a = rnd(o) * Math.PI * 2, rr = (0.08 + rnd(o) * 0.22) * R; x = Math.cos(a) * rr; y = Math.sin(a) * rr;
      } else {
        const arm = Math.floor(rnd(o) * arms), a = arm * Math.PI * 2 / arms + d * twist + rgauss(o) * (0.28 - d * 0.1);
        const rr = d * R + rgauss(o) * 18; x = Math.cos(a) * rr; y = Math.sin(a) * rr;
      }
    } else if (shape === 'ring') {
      const a = rnd(o) * Math.PI * 2, rr = R * (0.55 + rnd(o) * 0.45); x = Math.cos(a) * rr; y = Math.sin(a) * rr;
    } else {
      const a = rnd(o) * Math.PI * 2, rr = R * Math.sqrt(rnd(o)) * 0.98; x = Math.cos(a) * rr; y = Math.sin(a) * rr * 0.72;
      if (hyp(x, y) < R * 0.07) continue;
    }
    if (hyp(x, y) < R * 0.06) continue; // the galactic core is empty
    if (!ok(x, y)) continue;
    const p = [x, y]; pts.push(p); const k = key(x, y); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(p);
  }
  return { pts, R };
}
function segCross(a, b, c, d) {
  const o1 = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const o2 = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
  const o3 = (d[0] - c[0]) * (a[1] - c[1]) - (d[1] - c[1]) * (a[0] - c[0]);
  const o4 = (d[0] - c[0]) * (b[1] - c[1]) - (d[1] - c[1]) * (b[0] - c[0]);
  return (o1 * o2 < 0) && (o3 * o4 < 0);
}
function segPointDist(a, b, p) {
  const vx = b[0] - a[0], vy = b[1] - a[1], L = vx * vx + vy * vy;
  const t = clamp(((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L, 0, 1);
  return hyp(a[0] + vx * t - p[0], a[1] + vy * t - p[1]);
}
function genLanes(o, pts) {
  const n = pts.length, edges = [], cand = [];
  const maxL = 135;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const d = hyp(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]); if (d < maxL) cand.push([d, i, j]);
  }
  cand.sort((a, b) => a[0] - b[0]);
  const deg = new Int32Array(n), adj = Array.from({ length: n }, () => []);
  const crosses = (i, j) => {
    for (const [a, b] of edges) { if (a === i || a === j || b === i || b === j) continue; if (segCross(pts[i], pts[j], pts[a], pts[b])) return true; }
    return false;
  };
  const nearStar = (i, j) => {
    for (let k = 0; k < n; k++) { if (k === i || k === j) continue; if (Math.abs(pts[k][0] - pts[i][0]) > 140 && Math.abs(pts[k][0] - pts[j][0]) > 140) continue; if (segPointDist(pts[i], pts[j], pts[k]) < 16) return true; }
    return false;
  };
  const add = (i, j) => { edges.push([i, j]); adj[i].push(j); adj[j].push(i); deg[i]++; deg[j]++; };
  for (const [d, i, j] of cand) {
    if (deg[i] >= 4 || deg[j] >= 4) continue;
    if (d > 95 && (deg[i] >= 2 && deg[j] >= 2)) continue;
    if (rnd(o) < 0.12 && deg[i] >= 2 && deg[j] >= 2) continue; // some sparseness creates chokepoints
    if (crosses(i, j) || nearStar(i, j)) continue;
    add(i, j);
  }
  // connect components
  for (let guard = 0; guard < 200; guard++) {
    const comp = new Int32Array(n).fill(-1); let c = 0;
    for (let s = 0; s < n; s++) if (comp[s] < 0) { const q = [s]; comp[s] = c; for (let k = 0; k < q.length; k++) for (const w of adj[q[k]]) if (comp[w] < 0) { comp[w] = c; q.push(w); } c++; }
    if (c <= 1) break;
    // shortest link from component 0 to any other component, preferring non-crossing
    let best = null;
    for (let i = 0; i < n; i++) if (comp[i] === 0) for (let j = 0; j < n; j++) if (comp[j] !== 0) {
      const d = hyp(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
      if (!best || d < best[0]) { if (!crosses(i, j)) best = [d, i, j]; }
    }
    if (!best) for (let i = 0; i < n; i++) if (comp[i] === 0) for (let j = 0; j < n; j++) if (comp[j] !== 0) {
      const d = hyp(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]); if (!best || d < best[0]) best = [d, i, j];
    }
    add(best[1], best[2]);
  }
  return adj;
}

function makePlanet(G, o, sys, idx, type, size, r) {
  const p = { id: G.planets.length, sys: sys.id, name: sys.name + ' ' + ROMAN[idx % 12], type, size, r, ang: rnd(o) * Math.PI * 2, moonOf: -1, dep: null, station: null, col: null, prim: null, seed: Math.floor(rnd(o) * 1e9) };
  G.planets.push(p); sys.planets.push(p.id); return p;
}
function rollDeposit(o, type, star) {
  const t = { molten: [['minerals', 5], ['energy', 3]], barren: [['minerals', 5], ['forge', 2], ['energy', 1]], frozen: [['lumen', 2], ['vita', 1], ['minerals', 3]],
    toxic: [['vita', 3], ['energy', 2]], gas: [['energy', 5], ['lumen', 2]], icegas: [['energy', 3], ['lumen', 3]], asteroid: [['minerals', 6], ['forge', 2]], hollowed: [['lumen', 1]] }[type];
  if (!t) return null;
  const k = rweighted(o, t); let amt = rweighted(o, [[1, 40], [2, 35], [3, 18], [4, 7]]);
  if (star.energy && k === 'energy') amt += star.energy;
  if (star.lumen && k === 'lumen') amt += star.lumen;
  return { [k]: amt };
}
function genSystemBodies(G, o, sys, opts) {
  const st = STAR_TYPES[sys.star];
  let n = rint(o, st.planets[0], st.planets[1]);
  if (opts && opts.minPlanets) n = Math.max(n, opts.minPlanets);
  let r = 62 + rint(o, 0, 14);
  for (let i = 0; i < n; i++) {
    const zone = i / Math.max(1, n - 1);
    let type;
    if (rnd(o) < 0.1) type = 'asteroid';
    else if (zone < 0.25) type = rweighted(o, [['molten', 4], ['barren', 3], ['toxic', 1]]);
    else if (zone < 0.7) type = rnd(o) < 0.24 ? rpick(o, HAB_TYPES) : rweighted(o, [['barren', 3], ['toxic', 2], ['gas', 2], ['frozen', 1]]);
    else type = rweighted(o, [['gas', 4], ['icegas', 3], ['frozen', 3], ['barren', 1]]);
    if (sys.star === 'neutron' || sys.star === 'hole') { if (PLANET_TYPES[type].hab) type = 'barren'; }
    const T = PLANET_TYPES[type];
    const size = T.hab ? rint(o, 8, 22) : T.big ? rint(o, 22, 30) : type === 'asteroid' ? 4 : rint(o, 5, 16);
    const p = makePlanet(G, o, sys, i, type, size, r);
    if (!T.hab && rnd(o) < 0.42) p.dep = rollDeposit(o, type, st);
    if (T.big && rnd(o) < 0.5) {
      const nm = rint(o, 1, 2);
      for (let m = 0; m < nm; m++) {
        const mt = rweighted(o, [['barren', 4], ['frozen', 3], ['toxic', 1], [rpick(o, HAB_TYPES), 1]]);
        const mp = makePlanet(G, o, sys, i, mt, PLANET_TYPES[mt].hab ? rint(o, 6, 12) : rint(o, 3, 8), 18 + m * 9);
        mp.moonOf = p.id; mp.name = p.name + ' ' + 'abc'[m];
        if (!PLANET_TYPES[mt].hab && rnd(o) < 0.35) mp.dep = rollDeposit(o, mt, st);
      }
    }
    r += 34 + rint(o, 0, 16);
  }
}

function genGalaxy(G) {
  const o = { rng: rngState(G.seed + ':galaxy') };
  const size = GALAXY_SIZES[G.cfg.size] || GALAXY_SIZES.medium;
  const { pts, R } = genStars(o, size.n, G.cfg.shape);
  G.R = R;
  const adj = genLanes(o, pts);
  const used = new Set();
  G.systems = pts.map((p, i) => ({ id: i, name: makeName(o, used), x: Math.round(p[0] * 10) / 10, y: Math.round(p[1] * 10) / 10, star: rweighted(o, Object.keys(STAR_TYPES), k => STAR_TYPES[k].w), lanes: adj[i].slice().sort((a, b) => a - b), planets: [], owner: -1, nebula: 0, special: null, sb: null, anom: null }));
  G.planets = [];
  // nebulae
  G.nebulae = [];
  const nn = 2 + Math.floor(size.n / 60);
  for (let k = 0; k < nn; k++) {
    const s = rpick(o, G.systems); const rad = 70 + rnd(o) * 70;
    G.nebulae.push({ x: s.x, y: s.y, r: Math.round(rad), hue: rpick(o, [200, 260, 290, 320, 180]), name: makeName(o, used) + ' Nebula' });
    for (const t of G.systems) if (hyp(t.x - s.x, t.y - s.y) < rad) t.nebula = 1;
  }
  for (const s of G.systems) genSystemBodies(G, o, s);
  for (const p of G.planets) if (G.systems[p.sys].nebula && !PLANET_TYPES[p.type].hab && !p.dep && rnd(o) < 0.3) p.dep = { lumen: rint(o, 1, 3) };
  return o;
}

// systems as far from each other as possible
function spreadPick(G, o, cands, k, avoid, minJumps) {
  const out = [];
  let distTo = null;
  const pool = cands.slice();
  rshuffle(o, pool);
  for (let i = 0; i < k && pool.length; i++) {
    let best = null, bd = -1;
    for (const s of pool) {
      if (out.includes(s)) continue;
      let d = 1e9;
      for (const q of out.concat(avoid || [])) d = Math.min(d, hyp(G.systems[s].x - G.systems[q].x, G.systems[s].y - G.systems[q].y));
      if (minJumps && avoid && avoid.length) { if (!distTo) distTo = jumpDist(G, avoid, minJumps + 1); if (distTo[s] >= 0 && distTo[s] <= minJumps) continue; }
      const sc = d + rnd(o) * 40;
      if (sc > bd) { bd = sc; best = s; }
    }
    if (best == null) break;
    out.push(best);
  }
  return out;
}
function setHabitable(G, o, sys, type, size) {
  // turn an existing mid-orbit rock into a habitable world, or add a new orbit
  const cand = sys.planets.map(id => G.planets[id]).filter(p => p.moonOf < 0 && !PLANET_TYPES[p.type].hab && p.type !== 'beacon' && !PLANET_TYPES[p.type].big && p.type !== 'asteroid');
  let p;
  if (cand.length) { p = cand[Math.floor(cand.length / 2)]; p.type = type; p.size = size; p.dep = null; }
  else {
    const last = sys.planets.length ? G.planets[sys.planets[sys.planets.length - 1]] : null;
    p = makePlanet(G, o, sys, sys.planets.filter(id => G.planets[id].moonOf < 0).length, type, size, last ? last.r + 40 : 70);
  }
  return p;
}
function placeSpecials(G, o, capitals) {
  const N = G.systems.length;
  const free = G.systems.filter(s => !capitals.includes(s.id) && s.lanes.length >= 1).map(s => s.id);
  const nb = G.cfg.size === 'small' ? 4 : G.cfg.size === 'large' ? 6 : 5;
  const beacons = spreadPick(G, o, free, nb, capitals, 3);
  G.beacons = beacons;
  for (const id of beacons) {
    const s = G.systems[id]; s.special = 'beacon';
    const last = s.planets.length ? G.planets[s.planets[s.planets.length - 1]] : null;
    const p = makePlanet(G, o, s, 11, 'beacon', 10, last ? last.r + 44 : 80); p.name = s.name + ' Beacon';
  }
  const taken = new Set(capitals.concat(beacons));
  const pickFree = (filter) => { const c = free.filter(id => !taken.has(id) && (!filter || filter(G.systems[id]))); if (!c.length) return -1; const id = spreadPick(G, o, c, 1, Array.from(taken), 2)[0]; if (id == null) return -1; taken.add(id); return id; };
  // guardians
  G.guardians = [];
  const sentinelAt = beacons.length ? beacons[Math.floor(rnd(o) * beacons.length)] : pickFree();
  spawnMonster(G, 'warden_ai', sentinelAt, 1, true);
  for (const id of beacons) if (id !== sentinelAt) spawnMonster(G, 'crystal', id, 2, true);
  let stormSys = free.find(id => !taken.has(id) && G.systems[id].nebula);
  if (stormSys == null) stormSys = pickFree(); else taken.add(stormSys);
  if (stormSys >= 0) {
    spawnMonster(G, 'stormmother', stormSys, 1, true); G.systems[stormSys].special = 'storm';
    const p = setHabitable(G, o, G.systems[stormSys], 'garden', 20); p.name = G.systems[stormSys].name + ' Eye';
  }
  const sentinelSys = G.systems[sentinelAt];
  if (sentinelSys) for (const pid of sentinelSys.planets) { const p = G.planets[pid]; if (p.type !== 'beacon' && !PLANET_TYPES[p.type].hab) p.dep = { [rpick(o, ['lumen', 'forge', 'vita'])]: 6 }; }
  const ncry = Math.max(2, Math.floor(N / 60));
  for (let k = 0; k < ncry; k++) {
    const id = pickFree(); if (id < 0) break;
    spawnMonster(G, 'crystal', id, rint(o, 1, 2), true); G.systems[id].special = 'crystals';
    for (const pid of G.systems[id].planets) { const p = G.planets[pid]; if (!PLANET_TYPES[p.type].hab && p.type !== 'beacon') p.dep = { minerals: rint(o, 3, 5) }; }
  }
  // garden worlds and the relic world
  for (let k = 0; k < 2; k++) { const id = pickFree(); if (id >= 0) { G.systems[id].special = 'garden'; setHabitable(G, o, G.systems[id], 'garden', rint(o, 14, 20)); } }
  const rid = pickFree(); if (rid >= 0) { G.systems[rid].special = 'relic'; const p = setHabitable(G, o, G.systems[rid], 'relic', 22); p.relic = 1; spawnMonster(G, 'scavenger', rid, 3, true); }
  // primitive civilizations
  const np = Math.max(2, Math.floor(N / 45));
  const capD = jumpDist(G, capitals, 4);
  const primCands = G.planets.filter(p => PLANET_TYPES[p.type].hab && p.type !== 'garden' && p.type !== 'relic' && !taken.has(p.sys) && capD[p.sys] < 0);
  rshuffle(o, primCands);
  for (let k = 0; k < np && k < primCands.length; k++) {
    const p = primCands[k]; if (G.systems[p.sys].special) continue;
    p.prim = { name: makeName(o, null) + (rpick(o, ['i', 'an', 'ese', 'ar'])), stage: rint(o, 0, 2), prog: rint(o, 0, 40), pops: rint(o, 6, 12), observed: -1, seed: Math.floor(rnd(o) * 1e9) };
    G.systems[p.sys].special = G.systems[p.sys].special || 'primitive';
  }
  // roaming voidmoths in empty space
  const nm = Math.max(3, Math.floor(N / 30));
  for (let k = 0; k < nm; k++) { const id = pickFree(); if (id >= 0) { spawnMonster(G, 'voidmoth', id, rint(o, 1, 3), false); taken.delete(id); } }
  // anomalies
  for (const s of G.systems) if (!capitals.includes(s.id) && rnd(o) < 0.16) s.anom = { key: null, by: -1, done: 0, planet: s.planets.length ? rpick(o, s.planets) : -1 };
}
