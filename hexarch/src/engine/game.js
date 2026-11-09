// ===== game.js : state, rules, turns, persistence =====
function defaultConfig() {
  return { size: 'medium', script: 'continents', civ: 'random', rivals: 3, difficulty: 1, turnLimit: 350,
    barbarians: 'normal', victories: { domination: true, science: true, score: true, culture: true, religion: true, diplomacy: true }, seed: '' };
}

function makeGame(cfgIn, opts) {
  opts = opts || {};
  const cfg = Object.assign(defaultConfig(), cfgIn || {});
  const maxR = MAPSIZE[cfg.size].maxCivs - 1;
  cfg.rivals = Math.max(1, Math.min(maxR, cfg.rivals | 0));
  const seed = cfg.seed && String(cfg.seed).trim() ? String(cfg.seed).trim() : randomSeedString();
  cfg.seed = seed;
  const rng = RNG.fromSeed(seed + '|' + cfg.size + '|' + cfg.script + '|' + cfg.rivals);
  const nCiv = cfg.rivals + 1;
  const { map, grid, starts } = generateMap({ size: cfg.size, script: cfg.script, civs: nCiv }, rng);

  // pick civs: the human's choice (or random) first, then distinct rivals
  const pool = rng.shuffle(CIVS.map((c, i) => i));
  let mine = cfg.civ === 'random' || CIVI[cfg.civ] === undefined ? pool[0] : CIVI[cfg.civ];
  const civs = [mine].concat(pool.filter(i => i !== mine)).slice(0, nCiv);
  const allAI = !!opts.allAI;

  const G = {
    format: SAVE_FORMAT, version: HX_VERSION, cfg, seed, turn: 1, active: 0, nextId: 1,
    map, players: [], units: [], cities: [], log: [], uiLogIdx: 0,
  };
  G._grid = grid; G._rng = rng;
  civs.forEach((ci, pid) => {
    G.players.push({ id: pid, civ: ci, human: !allAI && pid === 0, alive: true, met: [], nameIdx: 0,
      explored: new Uint8Array(grid.N), scouted: new Uint8Array(grid.N), seen: {}, stats: { founded: 0 } });
  });
  initTransient(G);
  const diff = DIFFICULTY[cfg.difficulty] || DIFFICULTY[1];
  G.players.forEach((P, pid) => {
    const s = starts[pid];
    spawnUnit(G, 'settler', pid, s);
    spawnUnit(G, 'militia', pid, s);
    const extra = ['scout'].concat(P.human ? diff.humanExtra : (allAI ? [] : diff.aiExtra));
    for (const type of extra) {
      const t = freeTileNear(G, s, type);
      if (t >= 0) spawnUnit(G, type, pid, t);
    }
  });
  G.players.forEach((P, pid) => computeVisibility(G, pid));
  beginPlayerTurn(G, 0);
  return G;
}

function initTransient(G) {
  const N = G._grid.N;
  G._mil = new Map(); G._civ = new Map(); G._cityAt = new Map();
  for (const u of G.units) occMap(G, u).set(u.tile, u);
  for (const c of G.cities) G._cityAt.set(c.tile, c);
  for (const P of G.players) P._vis = new Uint8Array(N);
  G._los = new Uint8Array(N);
  G._pf = { g: new Float64Array(N), turns: new Int32Array(N), left: new Int32Array(N), prev: new Int32Array(N), stamp: new Int32Array(N), closed: new Int32Array(N), sv: 0 };
  G._exploreRes = new Map();
}

function freeTileNear(G, s, type) {
  const g = G._grid, civ = UNITS[type].civilian;
  for (const t of g.within(s, 2)) {
    if (!passableTerrain(G, t)) continue;
    if ((civ ? G._civ : G._mil).has(t)) continue;
    return t;
  }
  return -1;
}

function logEvent(G, pid, msg, tile) {
  G.log.push({ turn: G.turn, pid, msg, tile: tile === undefined ? -1 : tile });
  if (G.log.length > 300) { const cut = G.log.length - 300; G.log.splice(0, cut); G.uiLogIdx = Math.max(0, G.uiLogIdx - cut); }
}

// ---- units ----
function isCivilianUnit(u) { return !!UNITS[u.type].civilian; }
function occMap(G, u) { return isCivilianUnit(u) ? G._civ : G._mil; }
function unitById(G, id) { for (const u of G.units) if (u.id === id) return u; return null; }
function unitsAt(G, t) { const a = []; const m = G._mil.get(t), c = G._civ.get(t); if (m) a.push(m); if (c) a.push(c); return a; }
function spawnUnit(G, type, owner, tile) {
  const u = { id: G.nextId++, type, owner, tile, moves: UNITS[type].moves, hp: 100, order: null, skip: false };
  G.units.push(u); occMap(G, u).set(tile, u); G.players[owner].scouted[tile] = 1; return u;
}
function removeUnit(G, u) {
  const k = G.units.indexOf(u); if (k >= 0) G.units.splice(k, 1);
  const m = occMap(G, u); if (m.get(u.tile) === u) m.delete(u.tile);
}
function placeUnit(G, u, t) {
  const m = occMap(G, u); if (m.get(u.tile) === u) m.delete(u.tile);
  u.tile = t; m.set(t, u);
  G.players[u.owner].scouted[t] = 1;
}
function maxMoves(G, u) { return UNITS[u.type].moves; }
function unitSight(G, u) { const t = G.map.terrain[u.tile]; return UNITS[u.type].sight + (TERRAIN[t].elevated ? 1 : 0); }

// ---- movement ----
function passableTerrain(G, t) { const TT = TERRAIN[G.map.terrain[t]]; return !TT.impassable && !TT.water; }
function stepCost(G, u, from, to) {
  const TT = TERRAIN[G.map.terrain[to]];
  if (TT.impassable || TT.water) return Infinity;
  let c = UNITS[u.type].ignoreTerrain ? 1 : TT.move;
  const d = G._grid.dirTo(from, to);
  if (d >= 0 && (G.map.river[from] >> d) & 1) c += 1;
  return c;
}
// Foreign cities and foreign units block entry. knownFor = pid whose vision limits what is known (-1 = ground truth).
function foreignBlocked(G, u, t, knownFor) {
  const city = G._cityAt.get(t);
  if (city && city.owner !== u.owner) return true;
  const vis = knownFor >= 0 ? G.players[knownFor]._vis : null;
  const m = G._mil.get(t), c = G._civ.get(t);
  if (m && m.owner !== u.owner && (!vis || vis[t])) return true;
  if (c && c.owner !== u.owner && (!vis || vis[t])) return true;
  return false;
}
// A friendly unit of the same layer: you may pass through but not stop there.
function ownOccupied(G, u, t) { const o = occMap(G, u).get(t); return !!o && o !== u; }
function blockedFor(G, u, t, knownFor) { return foreignBlocked(G, u, t, knownFor) || ownOccupied(G, u, t); }
function canEnterNow(G, u, cost) { return cost !== Infinity && u.moves > 0 && (u.moves >= cost || u.moves === maxMoves(G, u)); }

// A* over move points with the "full moves can always step" rule. Returns [{t, turn, left}] or null.
// Units may pass through friendly units but never end a turn on one.
function findPath(G, u, dest, maxNodes) {
  if (dest === u.tile) return [];
  if (dest < 0) return null;
  maxNodes = maxNodes || 9000;
  const g = G._grid, pid = u.owner, ex = G.players[pid].explored, max = maxMoves(G, u), BIG = max + 1;
  const pf = G._pf, sv = ++pf.sv;
  const cost = (a, b) => ex[b] ? stepCost(G, u, a, b) : 1;
  const passable = t => ex[t] ? passableTerrain(G, t) && !foreignBlocked(G, u, t, pid) : true;
  if (!passable(dest) || ownOccupied(G, u, dest)) return null;
  const heap = new MinHeap();
  pf.stamp[u.tile] = sv; pf.g[u.tile] = 0; pf.turns[u.tile] = 0; pf.left[u.tile] = u.moves; pf.prev[u.tile] = -1; pf.closed[u.tile] = 0;
  heap.push(g.dist(u.tile, dest), u.tile);
  let nodes = 0;
  while (heap.size) {
    const t = heap.pop();
    if (pf.closed[t] === sv) continue;
    pf.closed[t] = sv;
    if (t === dest) break;
    if (++nodes > maxNodes) return null;
    const tu = pf.turns[t], l = pf.left[t];
    const canWaitHere = t === u.tile || !ownOccupied(G, u, t);
    for (let d = 0; d < 6; d++) {
      const n = g.nb[t * 6 + d];
      if (n < 0 || (pf.stamp[n] === sv && pf.closed[n] === sv)) continue;
      if (!passable(n)) continue;
      const c = cost(t, n); if (c === Infinity) continue;
      let nt, nl;
      if (l > 0 && (l >= c || l === max)) { nt = tu; nl = Math.max(0, l - c); }
      else { if (!canWaitHere) continue; nt = tu + 1; nl = Math.max(0, max - c); }
      const ng = nt * BIG + (max - nl);
      if (pf.stamp[n] === sv && pf.g[n] <= ng) continue;
      pf.stamp[n] = sv; pf.g[n] = ng; pf.turns[n] = nt; pf.left[n] = nl; pf.prev[n] = t; pf.closed[n] = 0;
      heap.push(ng + g.dist(n, dest), n);
    }
  }
  if (pf.stamp[dest] !== sv || pf.closed[dest] !== sv) return null;
  const out = [];
  for (let t = dest; t !== u.tile; t = pf.prev[t]) out.push({ t, turn: pf.turns[t], left: pf.left[t] });
  return out.reverse();
}

// Tiles where the unit could end its move this turn (known map only).
function reachableTiles(G, u) {
  const g = G._grid, pid = u.owner, ex = G.players[pid].explored, max = maxMoves(G, u);
  const best = new Map([[u.tile, u.moves]]), q = [u.tile], out = new Set();
  for (let h = 0; h < q.length; h++) {
    const t = q[h], l = best.get(t);
    if (l <= 0) continue;
    for (let d = 0; d < 6; d++) {
      const n = g.nb[t * 6 + d];
      if (n < 0 || n === u.tile || !ex[n] || !passableTerrain(G, n) || foreignBlocked(G, u, n, pid)) continue;
      const c = stepCost(G, u, t, n);
      if (!(l >= c || l === max)) continue;
      const nl = Math.max(0, l - c);
      if (best.has(n) && best.get(n) >= nl) continue;
      best.set(n, nl); q.push(n);
      if (!ownOccupied(G, u, n)) out.add(n);
    }
  }
  return Array.from(out);
}

// Move along the planned route toward dest using this turn's moves. Returns { steps, failed }.
function advanceToward(G, u, dest) {
  const steps = [], start = u.tile, om = occMap(G, u), P = G.players[u.owner];
  let failed = false, blocked = false;
  for (let guard = 0; guard < 6 && u.moves > 0 && u.tile !== dest; guard++) {
    const path = findPath(G, u, dest);
    if (!path || !path.length) { failed = true; break; }
    let moved = false;
    for (const st of path) {
      if (st.turn > 0) break;
      const next = st.t, c = stepCost(G, u, u.tile, next);
      if (foreignBlocked(G, u, next, -1)) { blocked = true; if (next === dest) failed = true; break; }
      if (!canEnterNow(G, u, c)) break;
      u.tile = next; u.moves = Math.max(0, u.moves - c); steps.push(next); moved = true;
      P.scouted[next] = 1;
      computeVisibility(G, u.owner);
    }
    if (blocked || !moved) break;
  }
  // never finish on top of a friendly unit of the same layer
  while (steps.length && ownOccupied(G, u, u.tile)) { steps.pop(); u.tile = steps.length ? steps[steps.length - 1] : start; }
  if (om.get(start) === u) om.delete(start);
  om.set(u.tile, u);
  if (u.tile !== start) computeVisibility(G, u.owner);
  return { steps, failed, blocked };
}

function issueMove(G, u, dest) {
  u.order = { t: 'goto', dest }; u.skip = false;
  return runOrder(G, u);
}
function runOrder(G, u) {
  const o = u.order; if (!o) return [];
  if (o.t === 'goto') {
    const r = advanceToward(G, u, o.dest);
    if (u.tile === o.dest) u.order = null;
    else if (r.failed) { u.order = null; if (G.players[u.owner].human) logEvent(G, u.owner, UNITS[u.type].name + ' could not reach its destination.', u.tile); }
    return r.steps;
  }
  if (o.t === 'explore') {
    const all = [];
    for (let k = 0; k < 4 && u.moves > 0; k++) {
      const tgt = findExploreTarget(G, u);
      if (tgt < 0) {
        u.order = null;
        if (G.players[u.owner].human) logEvent(G, u.owner, UNITS[u.type].name + ' has nothing left to explore that it can reach.', u.tile);
        break;
      }
      const r = advanceToward(G, u, tgt);
      all.push(...r.steps);
      if (!r.steps.length) break;
    }
    return all;
  }
  return [];
}

// Pick the reachable known tile with the best ratio of newly revealed tiles to travel time.
function findExploreTarget(G, u) {
  const g = G._grid, pid = u.owner, P = G.players[pid], ex = P.explored, max = maxMoves(G, u);
  let res = G._exploreRes.get(pid); if (!res) { res = []; G._exploreRes.set(pid, res); }
  const dist = new Map([[u.tile, 0]]), heap = new MinHeap(); heap.push(0, u.tile);
  let best = -1, bestS = 0, nodes = 0;
  const done = new Set();
  while (heap.size && nodes < 1500) {
    const t = heap.pop(); if (done.has(t)) continue; done.add(t); nodes++;
    const dt = dist.get(t);
    if (t !== u.tile && !P.scouted[t] && !ownOccupied(G, u, t)) {
      let gain = 0;
      for (const k of g.within(t, 2)) if (!ex[k]) gain++;
      if (gain > 0) {
        let s = gain / Math.pow(1 + dt / max, 1.3);
        for (const r of res) if (r.id !== u.id && g.dist(r.t, t) < 4) s *= 0.25;
        if (s > bestS) { bestS = s; best = t; }
      }
    }
    if (dt > max * 10) continue;
    for (let d = 0; d < 6; d++) {
      const n = g.nb[t * 6 + d];
      if (n < 0 || !ex[n] || !passableTerrain(G, n) || done.has(n)) continue;
      if (foreignBlocked(G, u, n, pid)) continue;
      const c = stepCost(G, u, t, n), nd = dt + c;
      if (!dist.has(n) || dist.get(n) > nd) { dist.set(n, nd); heap.push(nd, n); }
    }
  }
  if (best >= 0) { const k = res.findIndex(r => r.id === u.id); if (k >= 0) res.splice(k, 1); res.push({ id: u.id, t: best }); }
  return best;
}

function setOrder(G, u, t) {
  if (t === 'skip') { u.skip = true; return []; }
  if (t === 'wake') { u.order = null; u.skip = false; return []; }
  u.order = { t }; u.skip = false;
  if (t === 'explore') return runOrder(G, u);
  return [];
}
function needsOrders(G, u) { return u.moves > 0 && !u.order && !u.skip; }
function unitsNeedingOrders(G, pid) { return G.units.filter(u => u.owner === pid && needsOrders(G, u)); }
function disbandUnit(G, u) { removeUnit(G, u); computeVisibility(G, u.owner); }

// ---- visibility ----
function addSight(G, vis, from, radius) {
  const g = G._grid, terr = G.map.terrain, lv = G._los;
  const elev = TERRAIN[terr[from]].elevated || terr[from] === T.MOUNTAIN;
  const tiles = g.within(from, radius);
  for (const t of tiles) {
    const d = g.dst[t];
    let ok = d <= 1;
    if (!ok) {
      for (let k = 0; k < 6; k++) {
        const n = g.nb[t * 6 + k];
        if (n < 0 || !lv[n] || !g.inLast(n) || g.dst[n] !== d - 1) continue;
        const TT = TERRAIN[terr[n]];
        if (terr[n] === T.MOUNTAIN || (TT.blocks && !elev)) continue;
        ok = true; break;
      }
    }
    if (ok) { lv[t] = 1; vis[t] = 1; }
  }
  for (const t of tiles) lv[t] = 0;
}
function computeVisibility(G, pid) {
  const P = G.players[pid], vis = P._vis; vis.fill(0);
  for (const u of G.units) if (u.owner === pid) addSight(G, vis, u.tile, unitSight(G, u));
  for (const c of G.cities) if (c.owner === pid) { addSight(G, vis, c.tile, 2); for (const t of c.tiles) vis[t] = 1; }
  const ex = P.explored;
  for (let i = 0; i < vis.length; i++) if (vis[i]) ex[i] = 1;
  for (const k of Object.keys(P.seen)) { const t = +k; if (vis[t] && !G._cityAt.has(t)) delete P.seen[k]; }
  for (const c of G.cities) if (vis[c.tile]) P.seen[c.tile] = { id: c.id, o: c.owner, n: c.name, p: c.pop, cap: c.capital ? 1 : 0 };
  for (const u of G.units) if (u.owner !== pid && vis[u.tile]) meet(G, pid, u.owner);
  for (const c of G.cities) if (c.owner !== pid && vis[c.tile]) meet(G, pid, c.owner);
}
function meet(G, a, b) {
  const A = G.players[a]; if (a === b || A.met.includes(b)) return;
  A.met.push(b);
  const B = G.players[b]; if (!B.met.includes(a)) B.met.push(a);
  logEvent(G, a, 'You have met the ' + CIVS[B.civ].name + ', led by ' + CIVS[B.civ].leader + '.', -1);
  logEvent(G, b, 'You have met the ' + CIVS[A.civ].name + ', led by ' + CIVS[A.civ].leader + '.', -1);
}

// ---- cities ----
function foundCheck(G, pid, t, knowFor) {
  const TT = TERRAIN[G.map.terrain[t]];
  if (!TT.land) return { ok: false, why: 'Cities must be built on land.' };
  if (TT.impassable) return { ok: false, why: 'Cities cannot be built on Mountains.' };
  const o = G.map.owner[t];
  if (o >= 0 && o !== pid) return { ok: false, why: 'This tile belongs to the ' + CIVS[G.players[o].civ].name + '.' };
  const g = G._grid;
  for (const c of G.cities) {
    if (g.dist(c.tile, t) < MIN_CITY_DIST) {
      const known = knowFor === undefined || G.players[knowFor].explored[c.tile];
      return { ok: false, why: 'Too close to ' + (known ? c.name : 'another city') + '. Cities need ' + (MIN_CITY_DIST - 1) + ' tiles between them.' };
    }
  }
  return { ok: true };
}
function canFoundCity(G, u) {
  if (!UNITS[u.type].founds) return { ok: false, why: 'Only Settlers can found cities.' };
  if (u.moves <= 0) return { ok: false, why: 'No moves left this turn.' };
  return foundCheck(G, u.owner, u.tile, u.owner);
}
function foundCity(G, u) {
  const chk = canFoundCity(G, u); if (!chk.ok) return null;
  const P = G.players[u.owner], civ = CIVS[P.civ];
  const name = P.nameIdx < civ.cities.length ? civ.cities[P.nameIdx] : 'New ' + civ.cities[P.nameIdx % civ.cities.length];
  P.nameIdx++;
  const city = { id: G.nextId++, name, owner: u.owner, tile: u.tile, pop: 1, founded: G.turn, capital: !G.cities.some(c => c.owner === u.owner), tiles: [] };
  G.cities.push(city); G._cityAt.set(city.tile, city);
  for (const t of G._grid.within(city.tile, 1)) claimTile(G, city, t);
  removeUnit(G, u);
  P.stats.founded++;
  computeVisibility(G, u.owner);
  for (const Q of G.players) if (Q.id !== u.owner && Q._vis[city.tile]) computeVisibility(G, Q.id);
  logEvent(G, u.owner, city.name + ' has been founded' + (city.capital ? ' as your capital.' : '.'), city.tile);
  return city;
}
function claimTile(G, city, t) {
  const m = G.map;
  if (m.owner[t] >= 0) return false;
  m.owner[t] = city.owner; m.ocity[t] = city.id; city.tiles.push(t);
  return true;
}
function cityById(G, id) { for (const c of G.cities) if (c.id === id) return c; return null; }
function cityYieldPotential(G, c) {
  let f = 0, p = 0, g = 0;
  for (const t of c.tiles) { const y = tileYield(G.map, t); f += y.f; p += y.p; g += y.g; }
  return { f, p, g };
}

// ---- turn flow ----
function beginPlayerTurn(G, pid) {
  G._exploreRes.set(pid, []);
  for (const u of G.units) if (u.owner === pid) { u.moves = maxMoves(G, u); u.skip = false; }
  if (G.players[pid].human) {
    for (const u of G.units.slice()) if (u.owner === pid && u.order && (u.order.t === 'goto' || u.order.t === 'explore')) runOrder(G, u);
  }
  computeVisibility(G, pid);
}
function endPlayerTurn(G) {
  const n = G.players.length; let next = G.active, guard = 0;
  do {
    next = (next + 1) % n;
    if (next === 0) G.turn++;
  } while (!G.players[next].alive && ++guard < n + 1);
  G.active = next;
  beginPlayerTurn(G, next);
}

// ---- persistence ----
function serializeGame(G) {
  const m = G.map;
  const o = {
    format: SAVE_FORMAT, version: HX_VERSION, cfg: G.cfg, seed: G.seed, turn: G.turn, active: G.active, nextId: G.nextId,
    rng: G._rng.state(), log: G.log, uiLogIdx: G.uiLogIdx,
    map: { W: m.W, H: m.H, terrain: typedToB64(m.terrain), lake: typedToB64(m.lake), river: typedToB64(m.river), res: typedToB64(m.res), owner: typedToB64(m.owner), ocity: typedToB64(m.ocity) },
    players: G.players.map(P => { const q = {}; for (const k in P) if (k[0] !== '_') q[k] = P[k]; q.explored = typedToB64(P.explored); q.scouted = typedToB64(P.scouted); return q; }),
    units: G.units, cities: G.cities,
  };
  return JSON.stringify(o);
}
function deserializeGame(str) {
  const o = typeof str === 'string' ? JSON.parse(str) : str;
  if (!o || o.format !== SAVE_FORMAT || !o.map) throw new Error('This is not a Hexarch save, or it is from an incompatible version.');
  const mm = o.map;
  const map = { W: mm.W, H: mm.H, terrain: b64ToTyped(mm.terrain, Uint8Array), lake: b64ToTyped(mm.lake, Uint8Array), river: b64ToTyped(mm.river, Uint8Array),
    res: b64ToTyped(mm.res, Int8Array), owner: b64ToTyped(mm.owner, Int8Array), ocity: b64ToTyped(mm.ocity, Int16Array) };
  const G = { format: o.format, version: o.version, cfg: o.cfg, seed: o.seed, turn: o.turn, active: o.active, nextId: o.nextId,
    map, log: o.log || [], uiLogIdx: o.uiLogIdx || 0, units: o.units, cities: o.cities,
    players: o.players.map(p => Object.assign({}, p, { explored: b64ToTyped(p.explored, Uint8Array), scouted: b64ToTyped(p.scouted, Uint8Array) })) };
  G._grid = new Grid(map.W, map.H);
  G._rng = new RNG(o.rng);
  initTransient(G);
  G.players.forEach((P, pid) => computeVisibility(G, pid));
  return G;
}

var HX = {
  version: HX_VERSION, defaultConfig, makeGame, serializeGame, deserializeGame,
  findPath, reachableTiles, issueMove, runOrder, setOrder, unitsNeedingOrders, disbandUnit,
  canFoundCity, foundCity, foundCheck, beginPlayerTurn, endPlayerTurn, computeVisibility,
  unitsAt, unitById, cityById, tileYield, siteScore, cityYieldPotential, stepCost, randomSeedString,
};
