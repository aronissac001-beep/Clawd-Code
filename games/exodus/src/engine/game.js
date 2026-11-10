// ===== game.js : state, rules, turns, persistence =====
function defaultConfig() {
  return { size: 'medium', script: 'continents', civ: 'random', rivals: 3, difficulty: 1, turnLimit: 350,
    barbarians: 'normal', events: true, ruins: true, quests: true, cityStates: true, veil: true, loadout: { col: 'random', cargo: 'random', ship: 'random' },
    victories: { domination: true, rootsong: true, convergence: true, genesis: true, awakening: true, score: true }, seed: '' };
}

function makeGame(cfgIn, opts) {
  opts = opts || {};
  const cfg = Object.assign(defaultConfig(), cfgIn || {});
  expeditionConfig(cfg);
  cfg.humans = Math.max(1, Math.min(MAPSIZE[cfg.size].maxCivs, cfg.humans | 0 || 1));
  const maxR = MAPSIZE[cfg.size].maxCivs - cfg.humans;
  cfg.rivals = Math.max(cfg.humans > 1 ? 0 : 1, Math.min(maxR, cfg.rivals | 0));
  const seed = cfg.seed && String(cfg.seed).trim() ? String(cfg.seed).trim() : randomSeedString();
  cfg.seed = seed;
  const rng = RNG.fromSeed(seed + '|' + cfg.size + '|' + cfg.script + '|' + cfg.rivals);
  const nCiv = cfg.rivals + cfg.humans;
  const { map, grid, starts } = generateMap({ size: cfg.size, script: cfg.script, civs: nCiv }, rng);

  // pick civs: the human's choice (or random) first, then distinct rivals
  const pool = rng.shuffle(CIVS.map((c, i) => i).filter(i => !CIVS[i].barb && !CIVS[i].minor));
  // humans pick first (hotseat players after the first), then distinct rivals
  const wanted = [cfg.civ].concat((cfg.hotseatCivs || []).slice(0, cfg.humans - 1)), civs = [];
  while (wanted.length < cfg.humans) wanted.push('random');
  for (const w of wanted) { const ci = CIVI[w]; civs.push(ci !== undefined && !civs.includes(ci) && !CIVS[ci].barb ? ci : -1); }
  for (let k = 0; k < civs.length; k++) if (civs[k] < 0) civs[k] = pool.find(i => !civs.includes(i));
  for (const i of pool) if (civs.length < nCiv && !civs.includes(i)) civs.push(i);
  const mine = civs[0];
  const allAI = !!opts.allAI;

  const G = {
    format: SAVE_FORMAT, version: HX_VERSION, cfg, seed, turn: 1, active: 0, nextId: 1,
    map, players: [], units: [], cities: [], log: [], uiLogIdx: 0,
  };
  G._grid = grid; G._rng = rng;
  newMapLayers(map);
  G.routes = []; G.war = {}; G.peace = {}; G.camps = []; G.offers = []; G.dip = {}; G.deals = []; G.wonders = {}; G.pendingEvents = {}; G.hist = { t: [], p: {} }; G.over = null; G.warned = [];
  G.sats = []; G.sites = [];
  civs.forEach((ci, pid) => {
    const P = newPlayer(pid, ci, !allAI && pid < cfg.humans, grid.N);
    P.loadout = pickLoadout(cfg, P, RNG.fromSeed(seed + '|load' + pid), pid);
    G.players.push(P);
  });
  addBarbarians(G);
  initTransient(G);
  generateVeil(G, starts.slice(0, nCiv));
  const diff = DIFFICULTY[cfg.difficulty] || DIFFICULTY[1];
  G.players.forEach((P, pid) => {
    if (P.barbarian) return;
    const s = starts[pid];
    P.landing = landingSites(G, s, pid);
    for (const t of P.landing) for (const k of grid.within(t, 1)) P.explored[k] = 1;
    spawnUnit(G, 'settler', pid, s);
    spawnUnit(G, unitFor(civKey(P), 'militia'), pid, s);
    const extra = [unitFor(civKey(P), 'scout')].concat(P.human ? diff.humanExtra : (allAI ? [] : diff.aiExtra)).map(k => k === 'militia' ? unitFor(civKey(P), 'militia') : k);
    if (P.loadout.col === 'security') extra.push(unitFor(civKey(P), 'militia'));
    if (P.loadout.cargo === 'fabricators') extra.push('builder');
    if (P.loadout.ship === 'swift') extra.push(unitFor(civKey(P), 'scout'));
    for (const type of extra) {
      const t = freeTileNear(G, s, type);
      if (t >= 0) spawnUnit(G, type, pid, t);
    }
    applyLoadoutStart(G, pid, s);
  });
  placeNatural(G, starts.slice(0, nCiv));
  addCityStates(G, starts.slice(0, nCiv));
  placeRuins(G, starts.slice(0, nCiv));
  placeSites(G, starts.slice(0, nCiv));
  placeNests(G, starts.slice(0, nCiv));
  setupExpedition(G);
  G.players.forEach((P, pid) => computeVisibility(G, pid));
  beginPlayerTurn(G, 0);
  return G;
}

function newPlayer(pid, ci, human, N) {
  return { id: pid, civ: ci, human, alive: true, met: [], nameIdx: 0,
    explored: new Uint8Array(N), scouted: new Uint8Array(N), seen: {},
    gold: ECON.startGold, techs: ['landfall'], research: null, rqueue: [], progress: {}, insights: [], cultureTotal: 0, lastEcon: 1,
    culturePool: 0, policies: [], treesDone: [], aff: { communion: 0, lattice: 0, lineage: 0 }, rage: 15, studied: [], vaults: [], qfx: [], story: [], storyPending: [],
    loadout: null, landed: false, religion: null, faith: 0,
    stats: { founded: 0, improv: {}, roads: 0, scoured: 0, digs: 0, camps: 0, sats: 0, kills: 0 } };
}
function newMapLayers(map) {
  const N = map.W * map.H;
  map.improv = new Uint8Array(N); map.road = new Uint8Array(N); map.veil = new Uint8Array(N);
}

function addBarbarians(G) {
  if (G.players.some(P => P.barbarian)) return;
  const P = newPlayer(G.players.length, CIVI.barbarians, false, G.map.W * G.map.H);
  P.barbarian = true;
  G.players.push(P);
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
  refreshWonders(G);
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
  const u = { id: G.nextId++, type, owner, tile, moves: UNITS[type].moves * MP, hp: 100, order: null, skip: false, xp: 0, promos: [] };
  if (UNITS[type].charges) u.charges = UNITS[type].charges + (type === 'builder' && G.players[owner].policies ? polFx(G.players[owner]).builderCharges || 0 : 0);
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
function maxMoves(G, u) {
  const U = UNITS[u.type]; let m = U.moves;
  if (U.orbital) return 0;
  const fx = polFx(G.players[u.owner]);
  if (u.promos) for (const k of u.promos) m += PROMO[k].fx.moves || 0;
  if (U.naval) m += fx.navalMoves || 0;
  if (U.recon) m += fx.exploreMoves || 0;
  if (U.founds) m += fx.settlerMoves || 0;
  return m * MP;
}
function unitSight(G, u) { const t = G.map.terrain[u.tile]; return UNITS[u.type].sight + (TERRAIN[t].elevated ? 1 : 0); }

// ---- movement ----
// Cities count as road (and railroad once the owner knows Railroad).
function roadAt(G, t) {
  const r = G.map.road[t]; if (r) return r;
  const c = G._cityAt.get(t); if (!c) return 0;
  return hasTech(G.players[c.owner], 'maglev') ? 2 : 1;
}
function resVisible(G, pid, r) {
  if (r < 0) return false;
  const R0 = RES[r]; if (!R0.reveal) return true;
  return hasTech(G.players[pid], R0.reveal);
}
function passableTerrain(G, t) { const TT = TERRAIN[G.map.terrain[t]]; return !TT.impassable && !TT.water; }
const STOP = 1000; // a step that ends the unit's movement for the turn (embark, land, enemy zone of control)
function canEmbarkOn(G, pid, t) {
  const P = G.players[pid], ter = G.map.terrain[t];
  if (P.barbarian) return false;
  if (ter === T.OCEAN) return hasTech(P, 'tidal_power');
  return hasTech(P, 'marine_tech');
}
// Can this unit stand on tile t (ignoring other units)?
function passableFor(G, u, t) {
  const U = UNITS[u.type], ter = G.map.terrain[t], TT = TERRAIN[ter];
  if (U.naval) {
    if (TT.water) return !(U.coastOnly && ter === T.OCEAN);
    const c = G._cityAt.get(t); return !!c && c.owner === u.owner && isCoastal(G.map, G._grid, t);
  }
  if (TT.impassable) return false;
  if (TT.water) return canEmbarkOn(G, u.owner, t);
  return true;
}
function isWater(G, t) { return !!TERRAIN[G.map.terrain[t]].water; }
// Enemy military unit next to tile t (zone of control), as far as u's owner can see.
// Cached per player for the current turn; rebuilt when units die or wars change (G._zocVer).
function inEnemyZoc(G, u, t) {
  const pid = u.owner, key = G.turn * 64 + G.active, ver = G._zocVer || 0;
  let z = G._zoc && G._zoc[pid];
  if (!z || z.key !== key || z.ver !== ver) {
    const arr = new Uint8Array(G._grid.N), vis = G.players[pid]._vis, nb = G._grid.nb;
    for (const m of G.units) {
      if (m.owner === pid || UNITS[m.type].civilian || !vis[m.tile] || !atWar(G, pid, m.owner)) continue;
      for (let d = 0; d < 6; d++) { const n = nb[m.tile * 6 + d]; if (n >= 0) arr[n] = 1; }
    }
    G._zoc = G._zoc || {}; z = G._zoc[pid] = { key, ver, arr };
  }
  return z.arr[t] === 1;
}
function stepCost(G, u, from, to) {
  if (!passableFor(G, u, to)) return Infinity;
  const U = UNITS[u.type];
  if (U.naval) return MP;
  const fw = isWater(G, from), tw = isWater(G, to);
  if (fw !== tw) return STOP;
  if (tw) return MP;
  let c;
  const rf = roadAt(G, from), rt = roadAt(G, to);
  if (rf && rt) c = Math.min(rf, rt) >= 2 ? 1 : 2; // railroad 1/6, road 1/3; roads bridge rivers
  else {
    const TT = TERRAIN[G.map.terrain[to]];
    c = (U.ignoreTerrain || (U.forestWalk && G.map.terrain[to] === T.FOREST) ? 1 : TT.move) * MP;
    const d = G._grid.dirTo(from, to);
    if (d >= 0 && (G.map.river[from] >> d) & 1) c += MP;
  }
  if (U.military && !U.recon && G.war && inEnemyZoc(G, u, from) && inEnemyZoc(G, u, to)) c = STOP;
  return c;
}
// Foreign cities and foreign units block entry. knownFor = pid whose vision limits what is known (-1 = ground truth).
function foreignBlocked(G, u, t, knownFor) {
  const city = G._cityAt.get(t);
  if (city && city.owner !== u.owner) return true;
  if (bordersClosed(G, u, t)) return true;
  const vis = knownFor >= 0 ? G.players[knownFor]._vis : null;
  const m = G._mil.get(t), c = G._civ.get(t);
  if (m && m.owner !== u.owner && (!vis || vis[t])) return true;
  if (c && c.owner !== u.owner && (!vis || vis[t])) return true;
  return false;
}
// A friendly unit of the same layer: you may pass through but not stop there.
function ownOccupied(G, u, t) { const o = occMap(G, u).get(t); return !!o && o !== u; }
function blockedFor(G, u, t, knownFor) { return foreignBlocked(G, u, t, knownFor) || ownOccupied(G, u, t); }
function canEnterNow(G, u, cost) { return cost !== Infinity && u.moves > 0 && (cost >= STOP || u.moves >= cost || u.moves === maxMoves(G, u)); }

// A* over move points with the "full moves can always step" rule. Returns [{t, turn, left}] or null.
// Units may pass through friendly units but never end a turn on one.
function findPath(G, u, dest, maxNodes) {
  if (dest === u.tile) return [];
  if (dest < 0) return null;
  maxNodes = maxNodes || 9000;
  const g = G._grid, pid = u.owner, ex = G.players[pid].explored, max = maxMoves(G, u), BIG = max + 1;
  const pf = G._pf, sv = ++pf.sv;
  const cost = (a, b) => ex[b] ? stepCost(G, u, a, b) : 1;
  const passable = t => ex[t] ? passableFor(G, u, t) && !foreignBlocked(G, u, t, pid) : !UNITS[u.type].naval;
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
      if (l > 0 && (c >= STOP || l >= c || l === max)) { nt = tu; nl = c >= STOP ? 0 : Math.max(0, l - c); }
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
      if (n < 0 || n === u.tile || !ex[n] || !passableFor(G, u, n) || foreignBlocked(G, u, n, pid)) continue;
      const c = stepCost(G, u, t, n);
      if (c === Infinity || !(c >= STOP || l >= c || l === max)) continue;
      const nl = c >= STOP ? 0 : Math.max(0, l - c);
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
      u.tile = next; u.moves = c >= STOP ? 0 : Math.max(0, u.moves - c); steps.push(next); moved = true;
      u.acted = true; u.fortTurns = 0;
      P.scouted[next] = 1;
      computeVisibility(G, u.owner);
      if (G.camps && G.camps.length && UNITS[u.type].military) checkCampCapture(G, u);
      if (G.ruins && G.ruins.length && ruinAt(G, next)) { enterRuin(G, u, [next, start]); if (u.moves <= 0) break; }
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
  if (o.t === 'auto') { const from = u.tile; aiBuilder(G, u); return G.units.includes(u) && u.tile !== from ? [u.tile] : []; }
  if (o.t === 'explore') {
    const all = [];
    for (let k = 0; k < 4 && u.moves > 0; k++) {
      const tgt = findExploreTarget(G, u);
      if (tgt < 0) {
        // a person's unit goes to sleep instead of asking for orders every turn
        u.order = G.players[u.owner].human ? { t: 'sleep' } : null;
        if (G.players[u.owner].human) logEvent(G, u.owner, UNITS[u.type].name + ' has nothing left to explore that it can reach, so it sleeps. Tap it to wake it.', u.tile);
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
      if (G.ruins && G.ruins.length && ex[t] && ruinAt(G, t) && !UNITS[u.type].naval) gain += 14; // ruins are worth a detour
      if (gain > 0) {
        let s = gain / Math.pow(1 + dt / max, 1.3);
        for (const r of res) if (r.id !== u.id && g.dist(r.t, t) < 4) s *= 0.25;
        if (s > bestS) { bestS = s; best = t; }
      }
    }
    if (dt > max * 10) continue;
    for (let d = 0; d < 6; d++) {
      const n = g.nb[t * 6 + d];
      if (n < 0 || !ex[n] || !passableFor(G, u, n) || done.has(n)) continue;
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
  if (t === 'explore' || t === 'auto') return runOrder(G, u);
  if (t === 'heal') u.skip = false;
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
// quiet (used when loading a save): only rebuild what the player sees now, with no side effects,
// so that a loaded game is exactly the saved one; meetings and discoveries happen on the next normal update.
function computeVisibility(G, pid, quiet) {
  const P = G.players[pid], vis = P._vis; vis.fill(0);
  const sees = new Set([pid]); if (!P.barbarian) for (const a of alliesOf(G, pid)) sees.add(a); // allies share vision
  for (const u of G.units) if (sees.has(u.owner)) addSight(G, vis, u.tile, unitSight(G, u));
  for (const c of G.cities) if (sees.has(c.owner)) { addSight(G, vis, c.tile, 2); for (const t of c.tiles) vis[t] = 1; }
  for (const st of G.sats || []) if (sees.has(st.owner) && st.type === 'sat_survey') for (const t of G._grid.within(st.tile, 4)) vis[t] = 1;
  if (quiet) return;
  const ex = P.explored;
  for (let i = 0; i < vis.length; i++) if (vis[i]) ex[i] = 1;
  for (const k of Object.keys(P.seen)) { const t = +k; if (vis[t] && !G._cityAt.has(t)) delete P.seen[k]; }
  for (const c of G.cities) if (vis[c.tile]) P.seen[c.tile] = { id: c.id, o: c.owner, n: c.name, p: c.pop, cap: c.capital ? 1 : 0 };
  for (const u of G.units) if (u.owner !== pid && vis[u.tile]) meet(G, pid, u.owner);
  for (const c of G.cities) if (c.owner !== pid && vis[c.tile]) meet(G, pid, c.owner);
  if (G.natural && G.natural.length) discoverNatural(G, pid);
}
function meet(G, a, b) {
  const A = G.players[a]; if (a === b || A.met.includes(b) || A.barbarian || G.players[b].barbarian) return;
  A.met.push(b);
  const B = G.players[b]; if (!B.met.includes(a)) B.met.push(a);
  logEvent(G, a, 'You have met the ' + CIVS[B.civ].name + ', led by ' + CIVS[B.civ].leader + '.', -1);
  logEvent(G, b, 'You have met the ' + CIVS[A.civ].name + ', led by ' + CIVS[A.civ].leader + '.', -1);
}

// ---- cities ----
function foundCheck(G, pid, t, knowFor) {
  const TT = TERRAIN[G.map.terrain[t]];
  if (!TT.land) return { ok: false, why: 'Colonies must be founded on land.' };
  if (TT.impassable) return { ok: false, why: 'Colonies cannot be founded on Spire Crags.' };
  const o = G.map.owner[t];
  if (o >= 0 && o !== pid) return { ok: false, why: 'This tile belongs to the ' + CIVS[G.players[o].civ].name + '.' };
  if (G.sites && G.sites.some(s => s.tile === t)) return { ok: false, why: 'Colonies cannot be founded on a crash site, ruin or vault.' };
  const g = G._grid;
  for (const c of G.cities) {
    if (g.dist(c.tile, t) < MIN_CITY_DIST) {
      const known = knowFor === undefined || G.players[knowFor].explored[c.tile];
      return { ok: false, why: 'Too close to ' + (known ? c.name : 'another colony') + '. Colonies need ' + (MIN_CITY_DIST - 1) + ' tiles between them.' };
    }
  }
  return { ok: true };
}
function canFoundCity(G, u) {
  if (!UNITS[u.type].founds) return { ok: false, why: 'Only Colony Pods can found colonies.' };
  if (u.moves <= 0) return { ok: false, why: 'No moves left this turn.' };
  return foundCheck(G, u.owner, u.tile, u.owner);
}
function foundCity(G, u) {
  const chk = canFoundCity(G, u); if (!chk.ok) return null;
  const P = G.players[u.owner], civ = CIVS[P.civ];
  const name = P.nameIdx < civ.cities.length ? civ.cities[P.nameIdx] : 'New ' + civ.cities[P.nameIdx % civ.cities.length];
  P.nameIdx++;
  const city = newCity(G, name, u.owner, u.tile, !G.cities.some(c => c.owner === u.owner));
  if (city.capital && !G.cities.some(c => c.origCap === u.owner)) city.origCap = u.owner;
  city.hp = cityMaxHp(G, city);
  G.cities.push(city); G._cityAt.set(city.tile, city);
  for (const t of G._grid.within(city.tile, 1)) claimTile(G, city, t);
  removeUnit(G, u);
  P.stats.founded++;
  computeVisibility(G, u.owner);
  for (const Q of G.players) if (Q.id !== u.owner && Q._vis[city.tile]) computeVisibility(G, Q.id);
  if (G.map.improv[city.tile]) G.map.improv[city.tile] = 0;
  for (const t of G._grid.within(city.tile, 1)) G.map.veil[t] = 0;
  P.landed = true;
  if (P.stats.founded === 1) applyLoadoutColony(G, u.owner, city);
  applyFreeBuildings(G, u.owner);
  assignWorkers(G, city);
  logEvent(G, u.owner, city.name + ' has been founded' + (city.capital ? ' as your capital.' : '.'), city.tile);
  if (P.stats.founded === 1) offerStory(G, u.owner, 'first_night');
  return city;
}
function newCity(G, name, owner, tile, capital) {
  return { id: G.nextId++, name, owner, tile, pop: 1, founded: G.turn, capital, tiles: [],
    food: 0, prod: 0, build: null, queue: [], buildings: capital ? ['palace'] : [], focus: 'balanced', culture: 0, claims: 0, worked: [],
    locked: [], forcedSpec: 0, rel: {} };
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
  const P = G.players[pid];
  healAndRecover(G, pid);
  if (G.turn > P.lastEcon && !P.barbarian) { P.lastEcon = G.turn; processEconomy(G, pid); }
  for (const u of G.units) if (u.owner === pid) { u.moves = maxMoves(G, u); u.skip = false; }
  if (G.players[pid].human) {
    for (const u of G.units.slice()) if (u.owner === pid && u.order && (u.order.t === 'goto' || u.order.t === 'explore' || u.order.t === 'auto')) runOrder(G, u);
  }
  computeVisibility(G, pid);
  if (!P.barbarian && P.alive) { if (!P.minor) { digTurn(G, pid); rogueTurn(G, pid); rollEvent(G, pid); } }
}
function endPlayerTurn(G) {
  const n = G.players.length; let next = G.active, guard = 0;
  if (!G.players[G.active].barbarian) for (const a of alliesOf(G, G.active)) computeVisibility(G, a); // allies see our moves

  do {
    next = (next + 1) % n;
    if (next === 0) { G.turn++; planetRound(G); barbarianRound(G); dipRound(G); minorRound(G); victoryRound(G); }
  } while (!G.players[next].alive && ++guard < n + 1);
  G.active = next;
  beginPlayerTurn(G, next);
}

// ---- persistence ----
function serializeGame(G) {
  const m = G.map;
  const o = {
    format: SAVE_FORMAT, exodus: 1, version: HX_VERSION, cfg: G.cfg, seed: G.seed, turn: G.turn, active: G.active, nextId: G.nextId,
    rng: G._rng.state(), log: G.log, uiLogIdx: G.uiLogIdx,
    map: { W: m.W, H: m.H, terrain: typedToB64(m.terrain), lake: typedToB64(m.lake), river: typedToB64(m.river), res: typedToB64(m.res), owner: typedToB64(m.owner), ocity: typedToB64(m.ocity),
      improv: typedToB64(m.improv), road: typedToB64(m.road), veil: bitsToB64(m.veil) },
    sats: G.sats, sites: G.sites, routes: G.routes, war: G.war, peace: G.peace, camps: G.camps, offers: G.offers, dip: G.dip, deals: G.deals, wonders: G.wonders, hist: G.hist, natural: G.natural, ruins: G.ruins || [], pendingEvents: G.pendingEvents || {}, over: G.over, warned: G.warned,
    players: G.players.map(P => { const q = {}; for (const k in P) if (k[0] !== '_') q[k] = P[k]; q.explored = bitsToB64(P.explored); q.scouted = bitsToB64(P.scouted); return q; }),
    units: G.units, cities: G.cities,
  };
  return JSON.stringify(o);
}
function deserializeGame(str) {
  const o = typeof str === 'string' ? JSON.parse(str) : str;
  if (!o || !o.map || !o.format || o.format > SAVE_FORMAT || !o.exodus) throw new Error('This is not a Hexarch: Exodus save, or it is from a newer version.');
  const mm = o.map;
  const map = { W: mm.W, H: mm.H, terrain: b64ToTyped(mm.terrain, Uint8Array), lake: b64ToTyped(mm.lake, Uint8Array), river: b64ToTyped(mm.river, Uint8Array),
    res: b64ToTyped(mm.res, Int8Array), owner: b64ToTyped(mm.owner, Int8Array), ocity: b64ToTyped(mm.ocity, Int16Array) };
  if (mm.improv) { map.improv = b64ToTyped(mm.improv, Uint8Array); map.road = b64ToTyped(mm.road, Uint8Array); map.veil = mm.veil ? b64ToBits(mm.veil, mm.W * mm.H) : new Uint8Array(mm.W * mm.H); } else newMapLayers(map);
  const G = { format: SAVE_FORMAT, version: o.version, cfg: o.cfg, seed: o.seed, turn: o.turn, active: o.active, nextId: o.nextId,
    map, log: o.log || [], uiLogIdx: o.uiLogIdx || 0, units: o.units, cities: o.cities, routes: o.routes || [], sats: o.sats || [], sites: o.sites || [], war: o.war || {}, peace: o.peace || {}, camps: o.camps || [], offers: (o.offers || []).map(x => Object.assign({ id: 0, kind: 'peace' }, x)), dip: o.dip || {}, deals: o.deals || [], natural: o.natural || [], ruins: o.ruins || [], pendingEvents: o.pendingEvents || {}, wonders: o.wonders || {}, hist: o.hist || { t: [], p: {} }, over: o.over || null, warned: o.warned || [],
    players: o.players.map(p => Object.assign({}, p, { explored: b64ToBits(p.explored, mm.W * mm.H), scouted: b64ToBits(p.scouted, mm.W * mm.H) })) };
  G._grid = new Grid(map.W, map.H);
  G._rng = new RNG(o.rng);
  for (const P of G.players) if (P.barbarian) P.civ = CIVI.barbarians;
  fillDefaults(G);
  initTransient(G);
  applyOmen(G);
  G.players.forEach((P, pid) => computeVisibility(G, pid, true));
  return G;
}

// Older saves: give players and cities any fields added since.
function fillDefaults(G) {
  const N = G.map.W * G.map.H;
  G.players.forEach((P, pid) => { const fresh = newPlayer(pid, P.civ, P.human, N); for (const k in fresh) if (P[k] === undefined) P[k] = fresh[k]; });
  addBarbarians(G);
  for (const u of G.units) { if (u.xp === undefined) u.xp = 0; if (!u.promos) u.promos = []; }
  for (const c of G.cities) { if (c.hp === undefined) c.hp = 200; }
  if (G.cities.length && !G.cities.some(c => c.origCap !== undefined)) for (const c of G.cities) if (c.capital) c.origCap = c.owner;
  G.cities.forEach(c => { const fresh = { food: 0, prod: 0, build: null, queue: [], buildings: [], focus: 'balanced', culture: 0, claims: 0, worked: [], locked: [], forcedSpec: 0, rel: {} };
    for (const k in fresh) if (c[k] === undefined) c[k] = fresh[k]; });
}
var HX = {
  version: HX_VERSION, defaultConfig, makeGame, serializeGame, deserializeGame,
  findPath, reachableTiles, issueMove, runOrder, setOrder, unitsNeedingOrders, disbandUnit,
  canFoundCity, foundCity, foundCheck, beginPlayerTurn, endPlayerTurn, computeVisibility,
  unitsAt, unitById, cityById, tileYield, siteScore, cityYieldPotential, stepCost, randomSeedString, maxMoves,
};
