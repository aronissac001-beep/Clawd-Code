// ===== economy.js : yields, cities, research, culture, trade =====
function civKey(P) { return CIVS[P.civ].key; }
function hasTech(P, k) { return P.techs.includes(k); }
function ownCities(G, pid) { return G.cities.filter(c => c.owner === pid); }

// ---- tiles and improvements ----
function tileOutput(G, pid, t, city) {
  const m = G.map, P = G.players[pid], ter = m.terrain[t], TT = TERRAIN[ter];
  let f = TT.food, p = TT.prod, g = TT.gold, c = 0;
  if (m.lake[t]) { f = 2; g = 1; }
  if (TT.land && m.river[t]) { g += 1; if (ter === T.DESERT) f += 2; }
  const r = m.res[t];
  if (r >= 0 && resVisible(G, pid, r)) { f += RES[r].food; p += RES[r].prod; g += RES[r].gold; }
  const im = m.improv[t];
  if (im) {
    const I = IMPROV[im];
    f += I.add.f || 0; p += I.add.p || 0; g += I.add.g || 0;
    if (I.key === 'farm' && hasTech(P, 'engineering') && isFreshWater(m, G._grid, t)) f += 1;
    if (I.key === 'lumbermill' && hasTech(P, 'machinery')) p += 1;
    if (I.key === 'mine' && civKey(P) === 'emberforge') p += 1;
  }
  if (ter === T.FOREST && civKey(P) === 'verdant') c += 1;
  if (TT.water && city) {
    if (city.buildings.includes('harbor')) f += 1;
    if (city.buildings.includes('lighthouse')) p += 1;
  }
  return { f, p, g, c };
}

// Which improvement can go on tile t for player pid. Returns improvement index or 0 with a reason.
function improvementFor(G, pid, t) {
  const m = G.map, ter = m.terrain[t], TT = TERRAIN[ter], P = G.players[pid];
  if (G._cityAt.has(t)) return { imp: 0, why: 'City tile.' };
  if (m.owner[t] !== pid) return { imp: 0, why: 'Improvements must be inside your territory.' };
  const r = m.res[t];
  let key = null;
  if (r >= 0 && resVisible(G, pid, r)) key = RES_IMPROV[RES[r].key];
  else if (TT.water) return { imp: 0, why: 'Nothing to improve here.' };
  else if (ter === T.HILLS) key = 'mine';
  else if (ter === T.FOREST) key = 'lumbermill';
  else if (ter === T.GRASS || ter === T.PLAINS || ter === T.TUNDRA) key = 'farm';
  else if (ter === T.DESERT && isFreshWater(m, G._grid, t)) key = 'farm';
  if (!key) return { imp: 0, why: `${TERRAIN[ter].name} cannot be improved.` };
  const I = IMPROV[IMPI[key]];
  if (!hasTech(P, I.tech)) return { imp: 0, why: `${I.name} needs ${TECHS[TECHI[I.tech]].name}.`, wants: IMPI[key] };
  if (m.improv[t] === IMPI[key]) return { imp: 0, why: `Already has a ${I.name}.` };
  return { imp: IMPI[key] };
}
// Hills also accept farms (an alternative to the mine)
function improvementChoices(G, pid, t) {
  const out = [], main = improvementFor(G, pid, t);
  if (main.imp) out.push(main.imp);
  const m = G.map;
  if (m.terrain[t] === T.HILLS && !(m.res[t] >= 0 && resVisible(G, pid, m.res[t])) && m.owner[t] === pid && !G._cityAt.has(t)
    && hasTech(G.players[pid], 'agriculture') && m.improv[t] !== IMPI.farm) out.push(IMPI.farm);
  return out;
}
// Actions a builder can take where it stands (including Fishing Boats on adjacent water).
function builderActions(G, u) {
  const acts = [], t = u.tile, m = G.map, P = G.players[u.owner];
  for (const imp of improvementChoices(G, u.owner, t)) acts.push({ kind: 'improv', imp, tile: t });
  for (const n of G._grid.neighbors(t)) {
    if (!TERRAIN[m.terrain[n]].water) continue;
    const ch = improvementFor(G, u.owner, n);
    if (ch.imp === IMPI.boats) acts.push({ kind: 'improv', imp: ch.imp, tile: n });
  }
  if (TERRAIN[m.terrain[t]].land && !G._cityAt.has(t)) {
    if (!m.road[t]) acts.push({ kind: 'road', level: 1, tile: t });
    else if (m.road[t] === 1 && hasTech(P, 'railroad')) acts.push({ kind: 'road', level: 2, tile: t });
  }
  return acts;
}
function doBuilderAction(G, u, act) {
  if (u.moves <= 0) return false;
  const m = G.map, P = G.players[u.owner];
  if (act.kind === 'road') {
    m.road[act.tile] = act.level; P.stats.roads = (P.stats.roads || 0) + 1;
    u.moves = 0; u.order = u.order && u.order.t === 'auto' ? u.order : null;
    return true;
  }
  m.improv[act.tile] = act.imp;
  const key = IMPROV[act.imp].key;
  P.stats.improv[key] = (P.stats.improv[key] || 0) + 1;
  u.moves = 0; u.charges = (u.charges || 1) - 1;
  if (u.order && u.order.t !== 'auto') u.order = null;
  const c = cityById(G, m.ocity[act.tile]); if (c) assignWorkers(G, c);
  if (u.charges <= 0) { removeUnit(G, u); computeVisibility(G, u.owner); if (P.human) logEvent(G, u.owner, 'A Builder has used its last charge.', act.tile); }
  return true;
}

// ---- cities ----
function workableTiles(G, c) {
  const m = G.map, out = [];
  for (const t of c.tiles) if (t !== c.tile && m.ocity[t] === c.id && m.owner[t] === c.owner) out.push(t);
  return out;
}
const FOCUS = {
  balanced: { f: 1.3, p: 1.0, g: 0.55, c: 0.3 }, food: { f: 2.2, p: 0.7, g: 0.4, c: 0.2 },
  production: { f: 0.9, p: 2.0, g: 0.4, c: 0.2 }, gold: { f: 0.9, p: 0.6, g: 1.8, c: 0.2 },
};
// Pinned tiles are worked first, then the focus picks the rest. forcedSpec citizens stay scholars.
function assignWorkers(G, c) {
  const w = FOCUS[c.focus] || FOCUS.balanced, tiles = workableTiles(G, c);
  c.locked = (c.locked || []).filter(t => tiles.includes(t));
  c.forcedSpec = Math.max(0, Math.min(c.forcedSpec || 0, c.pop));
  const avail = c.pop - c.forcedSpec;
  if (c.locked.length > avail) c.locked = c.locked.slice(c.locked.length - avail);
  const ys = tiles.map(t => ({ t, y: tileOutput(G, c.owner, t, c) }));
  ys.forEach(o => o.s = o.y.f * w.f + o.y.p * w.p + o.y.g * w.g + o.y.c * w.c);
  const pinned = ys.filter(o => c.locked.includes(o.t));
  const free = ys.filter(o => !c.locked.includes(o.t)).sort((a, b) => b.s - a.s || a.t - b.t);
  const n = Math.max(0, Math.min(avail - pinned.length, free.length));
  let chosen = free.slice(0, n), rest = free.slice(n);
  // keep the city fed and growing a little (unless focused elsewhere); only automatic picks are swapped
  const ctr = tileOutput(G, c.owner, c.tile, c);
  let bonusF = 0; for (const b of c.buildings) bonusF += (BUILDINGS[BLDI[b]].y || {}).f || 0;
  const want = c.pop * 2 + (c.focus === 'production' || c.focus === 'gold' ? 0 : 2);
  const foodOf = () => Math.max(2, ctr.f) + 1 + bonusF + chosen.reduce((a, o) => a + o.y.f, 0) + pinned.reduce((a, o) => a + o.y.f, 0);
  for (let it = 0; it < 12 && foodOf() < want && rest.length; it++) {
    rest.sort((a, b) => b.y.f - a.y.f || b.s - a.s);
    const best = rest[0];
    let worst = -1, wf = Infinity;
    chosen.forEach((o, i) => { if (o.y.f < best.y.f && (o.y.f < wf || (o.y.f === wf && o.s < chosen[worst].s))) { wf = o.y.f; worst = i; } });
    if (worst < 0) break;
    rest[0] = chosen[worst]; chosen[worst] = best;
  }
  c.worked = pinned.map(o => o.t).concat(chosen.map(o => o.t));
}
// Tap a tile in tile management: pin it, or unpin it if already pinned.
function toggleTileWork(G, c, t) {
  if (!workableTiles(G, c).includes(t)) return false;
  const i = c.locked.indexOf(t);
  if (i >= 0) c.locked.splice(i, 1);
  else {
    const avail = c.pop - (c.forcedSpec || 0);
    if (avail <= 0) { if (c.forcedSpec > 0) c.forcedSpec--; else return false; }
    if (c.locked.length >= c.pop - c.forcedSpec) c.locked.shift();
    c.locked.push(t);
  }
  assignWorkers(G, c); return true;
}
function setForcedSpec(G, c, n) { c.forcedSpec = Math.max(0, Math.min(c.pop, n)); assignWorkers(G, c); }
function resetTiles(G, c) { c.locked = []; c.forcedSpec = 0; assignWorkers(G, c); }
function tileBuyCost(G, c, t) {
  const m = G.map, g = G._grid;
  if (m.owner[t] >= 0) return null;
  const d = g.dist(c.tile, t); if (d > 3) return null;
  if (!g.neighbors(t).some(n => m.ocity[n] === c.id)) return null;
  const r = m.res[t], bonus = r >= 0 && resVisible(G, c.owner, r) ? (RES[r].kind === 'luxury' ? 25 : RES[r].kind === 'strategic' ? 15 : 8) : 0;
  return Math.round((20 + 10 * d + 2 * c.tiles.length + bonus) * paceOf(G));
}
function buyTile(G, c, t) {
  const cost = tileBuyCost(G, c, t), P = G.players[c.owner];
  if (cost === null || P.gold < cost) return false;
  P.gold -= cost; claimTile(G, c, t); assignWorkers(G, c); computeVisibility(G, c.owner);
  return true;
}
function adjacentMountains(G, t) { let k = 0; for (const n of G._grid.neighbors(t)) if (G.map.terrain[n] === T.MOUNTAIN) k++; return k; }

function cityReport(G, c, hap, conn) {
  const P = G.players[c.owner], ck = civKey(P), fx = polFx(P);
  if (hap === undefined) hap = civHappiness(G, c.owner).net;
  if (!conn) conn = connections(G, c.owner);
  const ctr = tileOutput(G, c.owner, c.tile, c);
  let f = Math.max(2, ctr.f) + 1, p = Math.max(1, ctr.p), g = ctr.g, cul = ctr.c + 1, s = ECON.cityFlatSci;
  for (const t of c.worked) { const y = tileOutput(G, c.owner, t, c); f += y.f; p += y.p; g += y.g; cul += y.c; }
  const spec = Math.max(0, c.pop - c.worked.length);
  s += spec * (ECON.specialist.s + (fx.specSci || 0)) + c.pop * ECON.popSci; g += spec * ECON.specialist.g;
  let pf = 0, pp = 0, pg = 0, ps = fx.sciPct || 0, pc = fx.culPct || 0, keep = fx.keepFood || 0, h = 0, upkeep = 0;
  cul += fx.cityCul || 0; p += fx.cityProd || 0;
  if (c.capital) {
    f += fx.capFood || 0; cul += fx.capCul || 0; pp += fx.capProdPct || 0; pg += fx.capGoldPct || 0; keep += fx.capKeep || 0;
    g += Math.floor(c.pop / 2) * (fx.capGoldPer2Pop || 0);
  }
  if ((fx.garrisonCul || fx.garrisonGold) && cityGarrisoned(G, c)) { cul += fx.garrisonCul || 0; g += fx.garrisonGold || 0; }
  for (const k of c.buildings) {
    const B = BUILDINGS[BLDI[k]], y = B.y || {}, pct = B.pct || {};
    f += y.f || 0; p += y.p || 0; g += y.g || 0; s += y.s || 0; cul += y.c || 0;
    pp += pct.p || 0; pg += pct.g || 0; ps += pct.s || 0; pc += pct.c || 0;
    keep += B.keepFood || 0; upkeep += B.upkeep || 0;
    if (B.mountainS) s += Math.min(3, adjacentMountains(G, c.tile));
    if (k === 'library' && ck === 'aurelian') s += 1;
    if (k === 'temple') { cul += fx.templeCul || 0; g += fx.templeGold || 0; f += fx.templeFood || 0; }
    if (k === 'library' || k === 'university') s += fx.libSci || 0;
    if (k === 'observatory' || k === 'laboratory') s += fx.labSci || 0;
    if (k === 'market') g += fx.marketGold || 0;
  }
  let routeNote = 0;
  for (const r of G.routes) {
    const ry = routeYield(G, r); if (!ry) continue;
    if (r.from === c.id) { g += ry.fromG + (fx.routeGold || 0); s += ry.fromS; routeNote++; }
    if (r.to === c.id) { f += ry.toF; p += ry.toP; g += ry.toG; }
  }
  let connG = 0;
  if (!c.capital && conn.road.has(c.id)) { connG = 1 + Math.floor(c.pop / 2) + (fx.connGold || 0); g += connG; }
  if (conn.rail.has(c.id)) pp += 15;
  if (ck === 'aurelian') ps += 10;
  if (ck === 'meridian') g += 2;
  p *= 1 + pp / 100; s *= 1 + ps / 100; g *= 1 + pg / 100; cul *= 1 + pc / 100;
  if (hap <= -10) { p *= 0.8; g *= 0.8; }
  if (!P.human) { const m = (DIFFICULTY[G.cfg.difficulty] || DIFFICULTY[1]).aiYield; p *= m; s *= m; g *= m; }
  const eaten = c.pop * 2; let net = f - eaten;
  let growthNote = '';
  if (net > 0 && hap <= -10) { net = 0; growthNote = 'Growth stopped: empire is very unhappy.'; }
  else if (net > 0 && hap < 0) { net = net / 2; growthNote = 'Growth halved: empire is unhappy.'; }
  return { food: f, eaten, foodNet: net, prod: p, prodBld: ck === 'emberforge' ? p * 1.15 : p, prodMil: p * (1 + (fx.milProdPct || 0) / 100), gold: g, upkeep, sci: s, cul,
    keepFood: Math.min(65, keep), spec, connG, routes: routeNote, growthNote };
}

function canBuildItem(G, c, item) {
  const P = G.players[c.owner];
  if (item.k === 'u') {
    const U = UNITS[item.key];
    if (!BUILDABLE_UNITS.includes(item.key)) return { ok: false, why: 'Not available.' };
    if (U.tech && !hasTech(P, U.tech)) return { ok: false, why: `Needs ${TECHS[TECHI[U.tech]].name}.` };
    return { ok: true };
  }
  const B = BUILDINGS[BLDI[item.key]];
  if (!B || B.hidden) return { ok: false, why: 'Not available.' };
  if (c.buildings.includes(B.key)) return { ok: false, why: 'Already built.' };
  if (B.tech && !hasTech(P, B.tech)) return { ok: false, why: `Needs ${TECHS[TECHI[B.tech]].name}.` };
  if (B.coastal && !isCoastal(G.map, G._grid, c.tile)) return { ok: false, why: 'Needs a coastal city.' };
  if (B.req && !c.buildings.includes(B.req) && !(c.build && c.build.key === B.req) && !c.queue.some(q => q.key === B.req))
    return { ok: false, why: `Needs a ${BUILDINGS[BLDI[B.req]].name}.` };
  return { ok: true };
}
function itemName(item) { return item.k === 'u' ? UNITS[item.key].name : BUILDINGS[BLDI[item.key]].name; }
function sameItem(a, b) { return a && b && a.k === b.k && a.key === b.key; }
function availableItems(G, c) {
  const out = [];
  for (const key of BUILDABLE_UNITS) { const it = { k: 'u', key }; if (canBuildItem(G, c, it).ok) out.push(it); }
  for (const B of BUILDINGS) {
    const it = { k: 'b', key: B.key };
    if (sameItem(c.build, it) || c.queue.some(q => sameItem(q, it))) continue;
    if (canBuildItem(G, c, it).ok) out.push(it);
  }
  return out;
}
function setBuild(G, c, item, queue) {
  if (!canBuildItem(G, c, item).ok) return false;
  if (queue && c.build) { if (c.queue.length < 6) c.queue.push(item); }
  else c.build = item;
  return true;
}
function removeQueued(G, c, idx) { c.queue.splice(idx, 1); }
function itemRate(r, item) { return item.k === 'b' ? r.prodBld : UNITS[item.key].civilian ? r.prod : r.prodMil; }
function buyCost(G, c) {
  if (!c.build) return Infinity;
  const remaining = Math.max(0, itemCost(G, c.build, c.owner) - c.prod);
  const fx = polFx(G.players[c.owner]);
  return Math.ceil((remaining * 2.2 + 10 * paceOf(G)) * (1 + (fx.buyPct || 0) / 100));
}
function canBuy(G, c) {
  const P = G.players[c.owner];
  if (!c.build) return { ok: false, why: 'Nothing in production.' };
  if (c.boughtTurn === G.turn) return { ok: false, why: 'Already bought something here this turn.' };
  if (c.build.k === 'u' && c.build.key === 'settler' && c.pop < 2) return { ok: false, why: 'Settlers need a city of size 2.' };
  const cost = buyCost(G, c);
  if (P.gold < cost) return { ok: false, why: `Costs ${cost} gold.`, cost };
  return { ok: true, cost };
}
function buyItem(G, c) {
  const chk = canBuy(G, c); if (!chk.ok) return false;
  G.players[c.owner].gold -= chk.cost;
  c.prod = Math.max(c.prod, itemCost(G, c.build, c.owner));
  c.boughtTurn = G.turn;
  return completeBuild(G, c);
}
function spawnTileFor(G, c, type) {
  const civ = UNITS[type].civilian, occ = civ ? G._civ : G._mil;
  if (!occ.has(c.tile)) return c.tile;
  for (const t of G._grid.within(c.tile, 1)) if (t !== c.tile && passableTerrain(G, t) && !occ.has(t) && !foreignBlocked(G, { owner: c.owner }, t, -1)) return t;
  return -1;
}
// Finish the current item if enough production is stored. Returns true when something completed.
function completeBuild(G, c) {
  if (!c.build) return false;
  const item = c.build, cost = itemCost(G, item, c.owner), P = G.players[c.owner];
  if (c.prod < cost) return false;
  if (item.k === 'u') {
    if (item.key === 'settler' && c.pop < 2) return false;
    const t = spawnTileFor(G, c, item.key); if (t < 0) return false;
    const u = spawnUnit(G, item.key, c.owner, t);
    u.moves = 0;
    if (UNITS[item.key].trade) u.home = c.id;
    if (item.key === 'settler') { c.pop--; c.food = 0; assignWorkers(G, c); refreshSeen(G, c); }
  } else {
    c.buildings.push(item.key);
  }
  c.prod -= cost;
  if (P.human) logEvent(G, c.owner, `${c.name} has finished ${itemName(item)}.`, c.tile);
  c.build = null;
  while (c.queue.length && !c.build) { const nx = c.queue.shift(); if (canBuildItem(G, c, nx).ok) c.build = nx; }
  computeVisibility(G, c.owner);
  return true;
}
function pickBorderTile(G, c) {
  const g = G._grid, m = G.map;
  let best = -1, bs = -Infinity;
  for (const t of g.within(c.tile, 3)) {
    if (m.owner[t] >= 0) continue;
    const d = g.dst[t];
    let adj = false; for (let k = 0; k < 6; k++) { const n = g.nb[t * 6 + k]; if (n >= 0 && m.ocity[n] === c.id) { adj = true; break; } }
    if (!adj) continue;
    const y = tileOutput(G, c.owner, t, c);
    let s = y.f * 1.2 + y.p + y.g * 0.6 - d * 0.5;
    const r = m.res[t];
    if (r >= 0 && resVisible(G, c.owner, r)) s += RES[r].kind === 'luxury' ? 3 : RES[r].kind === 'strategic' ? 2 : 1;
    if (TERRAIN[m.terrain[t]].water) s -= 0.4;
    if (s > bs) { bs = s; best = t; }
  }
  return best;
}

// Players currently watching a city see its new size at once.
function refreshSeen(G, c) {
  for (const Q of G.players) if (Q._vis[c.tile] && Q.seen[c.tile]) Q.seen[c.tile].p = c.pop;
}

// ---- empire-wide ----
function luxuriesOf(G, pid) {
  const m = G.map, set = new Set();
  for (const c of G.cities) if (c.owner === pid) for (const t of c.tiles) {
    const r = m.res[t];
    if (r >= 0 && RES[r].kind === 'luxury' && m.improv[t] === IMPI[RES_IMPROV[RES[r].key]]) set.add(RES[r].key);
  }
  return set;
}
function strategicCounts(G, pid) {
  const m = G.map, out = { horses: 0, iron: 0, saltpeter: 0 };
  for (const c of G.cities) if (c.owner === pid) for (const t of c.tiles) {
    const r = m.res[t];
    if (r >= 0 && RES[r].kind === 'strategic' && resVisible(G, pid, r) && m.improv[t] === IMPI[RES_IMPROV[RES[r].key]]) out[RES[r].key]++;
  }
  return out;
}
function civHappiness(G, pid) {
  const P = G.players[pid], cs = ownCities(G, pid);
  let pop = 0, bld = 0;
  for (const c of cs) {
    pop += c.pop;
    for (const k of c.buildings) bld += BUILDINGS[BLDI[k]].h || 0;
    if (c.buildings.includes('temple') && hasTech(P, 'theology')) bld += 1;
  }
  const lux = luxuriesOf(G, pid), fx = polFx(P);
  let pol = (fx.happy || 0) + (fx.happyPerCity || 0) * cs.length;
  if (fx.happyGarrison) pol += fx.happyGarrison * cs.filter(c => cityGarrisoned(G, c)).length;
  if (fx.venueHappy) pol += fx.venueHappy * cs.reduce((a, c) => a + (c.buildings.includes('amphitheater') ? 1 : 0) + (c.buildings.includes('arena') ? 1 : 0), 0);
  const luxEach = ECON.luxHappy + (fx.luxExtra || 0);
  const plus = ECON.baseHappy + lux.size * luxEach + bld + pol;
  const minus = cs.length * ECON.perCityUnhappy + Math.floor(pop * ECON.perPopUnhappy);
  return { net: plus - minus, plus, minus, lux: Array.from(lux), luxEach, base: ECON.baseHappy, bld, pol, pop, cities: cs.length };
}
function connections(G, pid) {
  const cs = ownCities(G, pid), cap = cs.find(c => c.capital), road = new Set(), rail = new Set();
  if (!cap) return { road, rail };
  const g = G._grid;
  const flood = (minLevel, out) => {
    const seen = new Set([cap.tile]), q = [cap.tile];
    for (let h = 0; h < q.length; h++) {
      const t = q[h];
      for (let d = 0; d < 6; d++) { const n = g.nb[t * 6 + d]; if (n < 0 || seen.has(n)) continue; if (roadAt(G, n) >= minLevel) { seen.add(n); q.push(n); } }
    }
    for (const c of cs) if (c !== cap && seen.has(c.tile)) out.add(c.id);
  };
  flood(1, road); if (hasTech(G.players[pid], 'railroad')) flood(2, rail);
  if (cap.buildings.includes('harbor')) for (const c of cs) if (c !== cap && c.buildings.includes('harbor')) road.add(c.id);
  return { road, rail };
}
function unitUpkeep(G, pid) {
  const n = G.units.filter(u => u.owner === pid).length, free = ECON.freeUnitsBase + ownCities(G, pid).length + (polFx(G.players[pid]).freeUnits || 0);
  return Math.max(0, n - free);
}
function civReport(G, pid) {
  const hap = civHappiness(G, pid), conn = connections(G, pid);
  let gold = 0, upkeep = 0, sci = 0, cul = 0;
  const cities = [];
  for (const c of ownCities(G, pid)) {
    const r = cityReport(G, c, hap.net, conn);
    gold += r.gold; upkeep += r.upkeep; sci += r.sci; cul += r.cul;
    cities.push({ c, r });
  }
  const uu = unitUpkeep(G, pid);
  return { hap, conn, gold, upkeep, unitUpkeep: uu, goldNet: gold - upkeep - uu, sci, cul, cities };
}

// ---- research ----
function techAvailable(P, key) { const t = TECHS[TECHI[key]]; return !hasTech(P, key) && t.pre.every(k => hasTech(P, k)); }
function availableTechs(P) { return TECHS.filter(t => techAvailable(P, t.key)).map(t => t.key); }
function techPath(P, key) {
  const need = new Set(), visit = k => { if (hasTech(P, k) || need.has(k)) return; need.add(k); TECHS[TECHI[k]].pre.forEach(visit); };
  visit(key);
  return TECHS.filter(t => need.has(t.key)).map(t => t.key); // TECHS order respects prerequisites
}
function setResearch(G, pid, key) {
  const P = G.players[pid];
  if (hasTech(P, key)) return false;
  const path = techPath(P, key);
  P.research = path[0]; P.rqueue = path.slice(1);
  if (P.progress._bank) { P.progress[P.research] = (P.progress[P.research] || 0) + P.progress._bank; delete P.progress._bank; }
  return true;
}
function researchTurns(G, pid, key, sci) {
  const P = G.players[pid], left = techCost(G, key) - (P.progress[key] || 0);
  return sci > 0 ? Math.max(1, Math.ceil(left / sci)) : Infinity;
}
function learnTech(G, pid, key) {
  const P = G.players[pid];
  if (hasTech(P, key)) return;
  P.techs.push(key);
  const over = Math.max(0, (P.progress[key] || 0) - techCost(G, key));
  delete P.progress[key];
  if (P.human) logEvent(G, pid, `Research complete: ${TECHS[TECHI[key]].name}.`, -1);
  P.research = null;
  while (P.rqueue.length && !P.research) { const k = P.rqueue.shift(); if (techAvailable(P, k)) P.research = k; }
  if (P.research) P.progress[P.research] = (P.progress[P.research] || 0) + over;
  else P.progress._bank = (P.progress._bank || 0) + over;
  for (const c of ownCities(G, pid)) assignWorkers(G, c);
}

// ---- insights ----
function insightMet(G, pid, ins) {
  const P = G.players[pid], m = G.map, cs = ownCities(G, pid), n = ins.n || 1;
  const ownTiles = () => { const a = []; for (const c of cs) for (const t of c.tiles) a.push(t); return a; };
  switch (ins.t) {
    case 'cities': return cs.length >= n;
    case 'pop': return cs.some(c => c.pop >= n);
    case 'workTerrain': return cs.some(c => c.worked.some(t => ins.k.includes(TERRAIN[m.terrain[t]].key)));
    case 'ownTerrain': return ownTiles().filter(t => ins.k.includes(TERRAIN[m.terrain[t]].key)).length >= n;
    case 'explored': { let k = 0; for (let i = 0; i < P.explored.length; i++) k += P.explored[i]; return k >= n; }
    case 'ownRes': return ownTiles().some(t => m.res[t] >= 0 && ins.k.includes(RES[m.res[t]].key) && resVisible(G, pid, m.res[t]));
    case 'improvRes': return ownTiles().filter(t => m.res[t] >= 0 && ins.k.includes(RES[m.res[t]].key) && m.improv[t] === IMPI[RES_IMPROV[RES[m.res[t]].key]]).length >= n;
    case 'improv': return ownTiles().filter(t => m.improv[t] === IMPI[ins.k]).length >= n;
    case 'military': return G.units.filter(u => u.owner === pid && !UNITS[u.type].civilian).length >= n;
    case 'coastal': return cs.filter(c => isCoastal(m, G._grid, c.tile)).length >= n;
    case 'met': return P.met.length >= n;
    case 'metAll': return P.met.length >= G.players.filter(q => q.alive).length - 1;
    case 'nearMountain': return cs.some(c => adjacentMountains(G, c.tile) > 0);
    case 'build': return cs.filter(c => c.buildings.includes(ins.k)).length >= n;
    case 'gold': return P.gold >= n;
    case 'culture': return (P.lastCul || 0) >= n;
    case 'roads': return (P.stats.roads || 0) >= n;
    case 'routes': return G.routes.filter(r => r.owner === pid).length >= n;
  }
  return false;
}
function checkInsights(G, pid) {
  const P = G.players[pid];
  for (const t of TECHS) {
    if (!t.ins || hasTech(P, t.key) || P.insights.includes(t.key)) continue;
    if (!insightMet(G, pid, t.ins)) continue;
    P.insights.push(t.key);
    const half = polFx(P).insightHalf;
    P.progress[t.key] = (P.progress[t.key] || 0) + Math.ceil(techCost(G, t.key) / (half ? 2 : 3));
    if (P.human) logEvent(G, pid, `Insight: ${t.ins.text}. ${t.name} is ${half ? 'half' : 'a third'} cheaper.`, -1);
  }
}

// ---- trade routes ----
function routeCapacity(G, pid) {
  const P = G.players[pid];
  if (!hasTech(P, 'currency')) return 0;
  let n = 1 + (hasTech(P, 'exploration') ? 1 : 0) + (civKey(P) === 'meridian' ? 1 : 0);
  n += Math.floor(ownCities(G, pid).filter(c => c.buildings.includes('market')).length / 2);
  n += polFx(P).routes || 0;
  return n;
}
function routeYield(G, r) {
  const a = cityById(G, r.from), b = cityById(G, r.to);
  if (!a || !b) return null;
  if (a.owner === b.owner) return { fromG: 1, fromS: 0, toF: 2, toP: 1, toG: 0, domestic: true };
  const A = G.players[a.owner], B = G.players[b.owner];
  const diff = B.techs.filter(k => !A.techs.includes(k)).length;
  const dist = G._grid.dist(a.tile, b.tile);
  return { fromG: 2 + Math.floor(b.pop / 3) + Math.floor(dist / 5), fromS: Math.min(3, Math.floor(diff / 2)), toF: 0, toP: 0, toG: 1, domestic: false };
}
let _landComp = null;
function landComponentOf(G, t) {
  if (!_landComp || _landComp.G !== G) {
    const mask = new Uint8Array(G._grid.N);
    for (let i = 0; i < mask.length; i++) mask[i] = TERRAIN[G.map.terrain[i]].land && !TERRAIN[G.map.terrain[i]].impassable ? 1 : 0;
    _landComp = { G, id: components(G._grid, mask).id };
  }
  return _landComp.id[t];
}
function routeOrigin(G, u) {
  const home = cityById(G, u.home);
  if (home && home.owner === u.owner) return home;
  let best = null, bd = 1e9;
  for (const c of ownCities(G, u.owner)) { const d = G._grid.dist(c.tile, u.tile); if (d < bd) { bd = d; best = c; } }
  return best;
}
function routeTargets(G, u) {
  const P = G.players[u.owner], from = routeOrigin(G, u); if (!from) return [];
  const out = [], g = G._grid, sea = hasTech(P, 'sailing');
  for (const c of G.cities) {
    if (c.id === from.id) continue;
    if (c.owner !== u.owner && (!P.met.includes(c.owner) || !P.seen[c.tile])) continue;
    if (G.routes.some(r => r.from === from.id && r.to === c.id)) continue;
    const d = g.dist(from.tile, c.tile);
    const land = landComponentOf(G, from.tile) === landComponentOf(G, c.tile) && d <= 14;
    const water = sea && isCoastal(G.map, g, from.tile) && isCoastal(G.map, g, c.tile) && d <= (hasTech(P, 'compass') ? 24 : 16);
    if (!land && !water) continue;
    out.push({ city: c, from, dist: d, y: routeYield(G, { from: from.id, to: c.id }) });
  }
  return out;
}
function establishRoute(G, u, toId) {
  const t = routeTargets(G, u).find(x => x.city.id === toId);
  if (!t) return false;
  if (G.routes.filter(r => r.owner === u.owner).length >= routeCapacity(G, u.owner)) return false;
  G.routes.push({ owner: u.owner, from: t.from.id, to: toId, since: G.turn });
  removeUnit(G, u); computeVisibility(G, u.owner);
  if (G.players[u.owner].human) logEvent(G, u.owner, `Trade route opened from ${t.from.name} to ${t.city.name}.`, t.city.tile);
  else if (t.city.owner !== u.owner && G.players[t.city.owner].human) logEvent(G, t.city.owner, `A ${CIVS[G.players[u.owner].civ].adj} caravan opened a trade route to ${t.city.name}.`, t.city.tile);
  return true;
}

// ---- turn processing ----
function processEconomy(G, pid) {
  const P = G.players[pid], hap = civHappiness(G, pid), conn = connections(G, pid);
  let gold = 0, sci = 0, cul = 0;
  for (const c of ownCities(G, pid)) {
    assignWorkers(G, c);
    const r = cityReport(G, c, hap.net, conn);
    gold += r.gold - r.upkeep; sci += r.sci; cul += r.cul;
    // growth or starvation
    c.food += r.foodNet;
    const need = growthNeed(G, c.pop);
    if (c.food >= need) {
      c.food = c.food - need + Math.floor(need * r.keepFood / 100);
      c.pop++; assignWorkers(G, c); refreshSeen(G, c);
      if (P.human) logEvent(G, pid, `${c.name} has grown to size ${c.pop}.`, c.tile);
    } else if (c.food < 0) {
      if (c.pop > 1) { c.pop--; c.food = Math.floor(growthNeed(G, c.pop) / 2); assignWorkers(G, c); refreshSeen(G, c); if (P.human) logEvent(G, pid, `${c.name} is starving and lost a citizen.`, c.tile); }
      else c.food = 0;
    }
    // production
    if (!c.build && !P.human) aiChooseProduction(G, c);
    if (c.build) { c.prod += itemRate(r, c.build); completeBuild(G, c); }
    // borders
    c.culture += r.cul;
    for (let k = 0; k < 3; k++) {
      const cost = borderCost(G, c.claims);
      if (c.culture < cost) break;
      const t = pickBorderTile(G, c); if (t < 0) break;
      c.culture -= cost; c.claims++; claimTile(G, c, t);
    }
  }
  gold -= unitUpkeep(G, pid);
  P.gold += gold;
  if (P.gold < 0) {
    const deficit = -P.gold; P.gold = 0; sci = Math.max(0, sci - deficit * 2);
    if (P.human) logEvent(G, pid, 'Your treasury is empty. The shortfall is slowing research.', -1);
  }
  P.lastGold = gold; P.lastSci = sci; P.lastCul = cul;
  P.cultureTotal += cul; P.culturePool += cul;
  if (!P.human) aiPolicies(G, pid);
  if (!P.research && !P.human) aiChooseResearch(G, pid);
  if (P.research) {
    P.progress[P.research] = (P.progress[P.research] || 0) + sci;
    if (P.progress[P.research] >= techCost(G, P.research)) {
      learnTech(G, pid, P.research);
      if (!P.research && !P.human) aiChooseResearch(G, pid);
    }
  } else P.progress._bank = (P.progress._bank || 0) + sci;
  checkInsights(G, pid);
  if (P.human) for (const c of ownCities(G, pid)) if (!c.build) logEvent(G, pid, `${c.name} needs something to build.`, c.tile);
}

Object.assign(HX, {
  tileOutput, improvementFor, builderActions, doBuilderAction, assignWorkers, workableTiles, toggleTileWork, setForcedSpec, resetTiles, tileBuyCost, buyTile, cityReport, civReport, civHappiness, connections,
  canBuildItem, availableItems, setBuild, itemRate, removeQueued, buyCost, canBuy, buyItem, itemName, itemCost, growthNeed, borderCost,
  availableTechs, techAvailable, techPath, setResearch, researchTurns, techCost, insightMet,
  routeCapacity, routeTargets, establishRoute, routeYield, strategicCounts, luxuriesOf, unitUpkeep, resVisible, ownCities,
});
