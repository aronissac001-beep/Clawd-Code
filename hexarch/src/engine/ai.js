// ===== ai.js : computer opponents =====
function aiTakeTurn(G, pid) {
  const mine = G.units.filter(u => u.owner === pid);
  // settlers act first so escorts can follow them to their new position
  mine.sort((a, b) => (UNITS[b.type].founds ? 1 : 0) - (UNITS[a.type].founds ? 1 : 0));
  for (const u of mine) {
    if (!G.units.includes(u)) continue;
    u.ai = u.ai || {};
    if (UNITS[u.type].founds) aiSettler(G, u);
    else if (UNITS[u.type].charges) aiBuilder(G, u);
    else if (UNITS[u.type].trade) aiCaravan(G, u);
    else if (UNITS[u.type].recon) aiScout(G, u);
    else aiGuard(G, u);
  }
  aiSpend(G, pid);
  computeVisibility(G, pid);
}

function aiPickSite(G, u, myCities) {
  const g = G._grid, pid = u.owner, ex = G.players[pid].explored, map = G.map;
  const R = myCities.length ? 9 : 3;
  const bad = u.ai.bad || [];
  const taken = G.units.filter(o => o.owner === pid && o !== u && o.ai && o.ai.target != null).map(o => o.ai.target);
  const tiles = g.within(u.tile, R).slice(), dd = tiles.map(t => g.dst[t]);
  let best = null, bestS = -Infinity, here = -Infinity;
  for (let k = 0; k < tiles.length; k++) {
    const t = tiles[k];
    if (!ex[t] || bad.includes(t)) continue;
    if (!foundCheck(G, pid, t).ok) continue;
    if (taken.some(x => g.dist(x, t) < MIN_CITY_DIST)) continue;
    let s = siteScore(map, g, t);
    let ov = 0; for (const o of g.within(t, 2)) if (map.owner[o] >= 0) ov++;
    s -= ov * 1.2;
    if (myCities.length) {
      let dmin = 99; for (const c of myCities) dmin = Math.min(dmin, g.dist(c.tile, t));
      if (dmin > 8) continue;
      s -= Math.max(0, dmin - 5) * 1.5;
      for (const c of G.cities) if (c.owner !== pid && g.dist(c.tile, t) < 6) s -= 5;
    }
    s -= dd[k] * (myCities.length ? 1.2 : 2.5);
    if (t === u.tile) here = s;
    if (s > bestS) { bestS = s; best = t; }
  }
  if (!myCities.length && here > -Infinity && here >= bestS - 3) return u.tile;
  return best;
}

function aiSettler(G, u) {
  const pid = u.owner, myCities = G.cities.filter(c => c.owner === pid);
  if (u.ai.target != null && !foundCheck(G, pid, u.ai.target).ok) u.ai.target = null;
  if (u.ai.target == null) u.ai.target = aiPickSite(G, u, myCities);
  if (u.ai.target == null) { u.order = { t: 'explore' }; runOrder(G, u); u.order = null; return; }
  if (u.tile !== u.ai.target) {
    const r = advanceToward(G, u, u.ai.target);
    if (r.failed) { (u.ai.bad = u.ai.bad || []).push(u.ai.target); u.ai.target = null; return; }
  }
  if (u.tile === u.ai.target && u.moves > 0) {
    if (canFoundCity(G, u).ok) foundCity(G, u);
    else u.ai.target = null;
  }
}

function aiScout(G, u) {
  if (u.ai.idleUntil && G.turn < u.ai.idleUntil) return aiReturnHome(G, u);
  u.order = { t: 'explore' };
  runOrder(G, u);
  if (!u.order) { u.ai.idleUntil = G.turn + 10; aiReturnHome(G, u); }
}

function aiReturnHome(G, u) {
  const g = G._grid, myCities = G.cities.filter(c => c.owner === u.owner);
  if (!myCities.length) return;
  let best = null, bd = 1e9;
  for (const c of myCities) { const d = g.dist(c.tile, u.tile); if (d < bd) { bd = d; best = c; } }
  if (bd > 2) advanceToward(G, u, best.tile);
}

function aiGuard(G, u) {
  const pid = u.owner, g = G._grid, myCities = G.cities.filter(c => c.owner === pid);
  if (!myCities.length) {
    const s = G.units.find(o => o.owner === pid && UNITS[o.type].founds);
    if (s) { if (u.tile !== s.tile) advanceToward(G, u, s.tile); return; }
    return aiScout(G, u);
  }
  const here = G._cityAt.get(u.tile);
  if (here && here.owner === pid && G._mil.get(u.tile) === u) { u.order = { t: 'fortify' }; return; }
  const open = myCities.filter(c => { const m = G._mil.get(c.tile); return !m; });
  if (open.length) {
    open.sort((a, b) => g.dist(a.tile, u.tile) - g.dist(b.tile, u.tile));
    u.order = null;
    const r = advanceToward(G, u, open[0].tile);
    if (u.tile === open[0].tile) u.order = { t: 'fortify' };
    if (!r.failed) return;
  }
  // every city has a defender: escort the nearest unescorted settler, else patrol near home
  const settler = G.units.find(o => o.owner === pid && UNITS[o.type].founds && !G._mil.has(o.tile));
  if (settler) { u.order = null; if (u.tile !== settler.tile) advanceToward(G, u, settler.tile); return; }
  u.order = null;
  let near = myCities[0]; for (const c of myCities) if (g.dist(c.tile, u.tile) < g.dist(near.tile, u.tile)) near = c;
  if (g.dist(near.tile, u.tile) > 4) advanceToward(G, u, near.tile);
}



// ---- economy AI ----
const PERSONA = {
  aurelian: { f: 1.0, p: 1.0, g: 0.8, s: 1.5, c: 0.8, expand: 1.0 },
  thornwall: { f: 1.0, p: 1.25, g: 0.8, s: 1.1, c: 0.8, expand: 0.9 },
  sunreach: { f: 1.1, p: 1.1, g: 0.8, s: 1.0, c: 0.6, expand: 1.3 },
  meridian: { f: 1.0, p: 1.0, g: 1.4, s: 1.1, c: 0.8, expand: 1.0 },
  verdant: { f: 1.1, p: 0.9, g: 0.8, s: 1.1, c: 1.5, expand: 1.0 },
  emberforge: { f: 1.0, p: 1.4, g: 0.8, s: 1.1, c: 0.7, expand: 1.0 },
};
function personaOf(G, pid) { return PERSONA[civKey(G.players[pid])]; }

// Count good, reachable-looking settle sites near the empire (cached per turn).
function aiSettleSites(G, pid) {
  G._aiCache = G._aiCache || {};
  const key = 'sites' + pid, hit = G._aiCache[key];
  if (hit && hit.turn === G.turn) return hit.n;
  const g = G._grid, ex = G.players[pid].explored, seen = new Set();
  let n = 0;
  for (const c of ownCities(G, pid)) {
    const near = g.within(c.tile, 8).slice();
    for (const t of near) {
      if (seen.has(t) || !ex[t]) continue; seen.add(t);
      if (landComponentOf(G, t) !== landComponentOf(G, c.tile)) continue;
      if (!foundCheck(G, pid, t).ok) continue;
      if (siteScore(G.map, g, t) >= 30) { n++; if (n >= 4) break; }
    }
    if (n >= 4) break;
  }
  G._aiCache[key] = { turn: G.turn, n };
  return n;
}

function aiBuildingValue(G, c, B, rep, hap, w) {
  const y = B.y || {}, pct = B.pct || {};
  let v = w.f * (y.f || 0) + w.p * (y.p || 0) + w.g * (y.g || 0) * 0.8 + w.s * (y.s || 0) + w.c * (y.c || 0) * 0.7;
  v += w.p * rep.prod * (pct.p || 0) / 100 + w.g * rep.gold * (pct.g || 0) / 100 * 0.8 + w.s * rep.sci * (pct.s || 0) / 100 + w.c * rep.cul * (pct.c || 0) / 100 * 0.7;
  let h = B.h || 0; if (B.key === 'temple' && hasTech(G.players[c.owner], 'theology')) h += 1;
  v += h * (hap < 0 ? 3.2 : hap < 4 ? 1.6 : 0.5);
  if (B.keepFood) v += B.keepFood * 0.025 * Math.max(1, c.pop - 2) * w.f;
  if (B.waterF || B.waterP) { const water = c.worked.filter(t => TERRAIN[G.map.terrain[t]].water).length; v += water * ((B.waterF || 0) * w.f + (B.waterP || 0) * w.p); }
  if (B.mountainS) v += Math.min(3, adjacentMountains(G, c.tile)) * w.s;
  const P = G.players[c.owner];
  v -= (B.upkeep || 0) * w.g * ((P.lastGold || 0) < 0 ? 1.6 : 0.6);
  return v;
}

function aiChooseProduction(G, c) {
  const pid = c.owner, P = G.players[pid], w = personaOf(G, pid), hap = civHappiness(G, pid).net, rep = cityReport(G, c, hap);
  const cities = ownCities(G, pid), mine = G.units.filter(u => u.owner === pid);
  const building = (k) => cities.filter(x => x.build && x.build.k === 'u' && x.build.key === k).length;
  let best = null, bs = -Infinity;
  for (const it of availableItems(G, c)) {
    const cost = itemCost(G, it);
    let v = -1;
    if (it.k === 'u') {
      const k = it.key;
      if (k === 'settler') {
        if (hap < 1 || aiSettleSites(G, pid) === 0) continue;
        if (mine.filter(u => u.type === 'settler').length + building('settler') >= 2) continue;
        v = 16 * w.expand / (1 + cities.length * 0.18) * (c.pop >= 2 ? 1 : 0.4);
      } else if (k === 'builder') {
        const charges = mine.filter(u => u.type === 'builder').reduce((a, u) => a + (u.charges || 0), 0) + building('builder') * 3;
        let todo = 0;
        for (const x of cities) for (const t of x.tiles) if (improvementChoices(G, pid, t).length && (x.worked.includes(t) || G.map.res[t] >= 0)) todo++;
        if (todo <= charges) continue;
        v = Math.min(8, 2 + (todo - charges) * 0.9);
      } else if (k === 'militia') {
        if (G._mil.has(c.tile) || building('militia') >= cities.filter(x => !G._mil.has(x.tile)).length) continue;
        v = 7;
      } else if (k === 'scout') {
        if (mine.some(u => u.type === 'scout') || building('scout') || G.turn > 60) continue;
        v = 2.5;
      } else if (k === 'caravan') {
        const used = G.routes.filter(r => r.owner === pid).length + mine.filter(u => u.type === 'caravan').length + building('caravan');
        if (used >= routeCapacity(G, pid)) continue;
        v = 6.5 * (w.g > 1 ? 1.2 : 1);
      }
    } else {
      v = aiBuildingValue(G, c, BUILDINGS[BLDI[it.key]], rep, hap, w);
    }
    const sc = v / cost * (1 + G._rng.next() * 0.06);
    if (sc > bs) { bs = sc; best = it; }
  }
  if (best) c.build = best;
}

function aiTechValue(G, pid, key, w, cities) {
  const P = G.players[pid];
  let v = 1.5;
  const nC = Math.max(1, cities.length);
  for (const B of BUILDINGS) if (B.tech === key && !B.hidden) {
    const y = B.y || {};
    v += (w.f * (y.f || 0) + w.p * (y.p || 0) + w.g * (y.g || 0) + w.s * (y.s || 0) * 1.2 + w.c * (y.c || 0) + (B.h || 0) * 1.5
      + ((B.pct || {}).s || 0) / 10 * w.s + ((B.pct || {}).p || 0) / 10 * w.p + ((B.pct || {}).g || 0) / 12 * w.g + (B.keepFood ? 1 : 0)) * Math.min(nC, 6) * 0.5;
  }
  for (let i = 1; i < IMPROV.length; i++) if (IMPROV[i].tech === key) {
    let k = 0; for (const c of cities) for (const t of c.tiles) { const ch = improvementFor(G, pid, t); if (ch.wants === i) k++; }
    v += 1 + k * 1.3;
  }
  for (const R0 of RES) if (R0.reveal === key) v += 4;
  const T0 = TECHS[TECHI[key]], fx = T0.fx || {};
  if (fx.routes) v += 5 * (w.g > 1 ? 1.3 : 1);
  if (fx.templeH) v += cities.filter(c => c.buildings.includes('temple')).length * 1.5;
  if (fx.irrigation) v += 3; if (fx.millP) v += 2;
  if (T0.later) v += T0.later.length * 1.2;
  if (key === 'grand_theory') v += 40;
  return v;
}
function aiChooseResearch(G, pid) {
  const P = G.players[pid], w = personaOf(G, pid), cities = ownCities(G, pid), avail = availableTechs(P);
  if (!avail.length) return;
  const sci = Math.max(1, P.lastSci || 3);
  let best = null, bs = -Infinity;
  for (const k of avail) {
    let v = aiTechValue(G, pid, k, w, cities);
    // look one step ahead so gateway techs are not starved
    let ahead = 0;
    for (const t of TECHS) if (t.pre.includes(k) && t.pre.every(x => x === k || hasTech(P, x))) ahead = Math.max(ahead, aiTechValue(G, pid, t.key, w, cities));
    v += ahead * 0.35;
    const turns = Math.max(1, (techCost(G, k) - (P.progress[k] || 0)) / sci);
    const sc = v / turns * (1 + G._rng.next() * 0.05);
    if (sc > bs) { bs = sc; best = k; }
  }
  setResearch(G, pid, best);
}

// Builders: improve the most valuable tile, then connect cities with roads.
function aiBuilderPlan(G, u) {
  const pid = u.owner, g = G._grid, m = G.map, P = G.players[pid];
  G._aiCache = G._aiCache || {};
  const rk = 'bres' + pid + '_' + G.turn; const res = G._aiCache[rk] = G._aiCache[rk] || new Set();
  const lux = luxuriesOf(G, pid);
  let best = null, bs = 0.4;
  const near = g.within(u.tile, 10).slice(), dd = near.map(t => g.dst[t]);
  for (let k = 0; k < near.length; k++) {
    const t = near[k];
    if (m.owner[t] !== pid || res.has(t)) continue;
    const c = cityById(G, m.ocity[t]); if (!c) continue;
    const worked = c.worked.includes(t);
    for (const imp of improvementChoices(G, pid, t)) {
      const I = IMPROV[imp];
      if (imp === IMPI.boats) continue;
      let v = (I.add.f || 0) * 1.3 + (I.add.p || 0) * 1.1 + (I.add.g || 0) * 0.8;
      if (m.improv[t]) v -= 1.0;
      const r = m.res[t];
      if (r >= 0 && resVisible(G, pid, r)) { const R0 = RES[r]; if (R0.kind === 'luxury' && !lux.has(R0.key)) v += 6; if (R0.kind === 'strategic') v += 2; v += 0.5; }
      if (imp === IMPI.farm && m.terrain[t] === T.HILLS) v -= 0.5;
      v *= worked ? 1.6 : 0.8;
      const s = v - dd[k] * 0.3;
      if (s > bs) { bs = s; best = { stand: t, act: { kind: 'improv', imp, tile: t } }; }
    }
    if (TERRAIN[m.terrain[t]].water) {
      const ch = improvementFor(G, pid, t);
      if (ch.imp === IMPI.boats) {
        const stand = g.neighbors(t).find(n => passableTerrain(G, n) && !G._cityAt.has(n) && !ownOccupied(G, u, n));
        if (stand !== undefined) { const s = 2.6 * (worked ? 1.6 : 0.8) - dd[k] * 0.3; if (s > bs) { bs = s; best = { stand, act: { kind: 'improv', imp: ch.imp, tile: t } }; } }
      }
    }
  }
  if (best) { res.add(best.act.tile); return best; }
  // roads toward cities that are not connected to the capital
  const cs = ownCities(G, pid), cap = cs.find(c => c.capital), conn = connections(G, pid);
  if (!cap) return null;
  const loose = cs.filter(c => c !== cap && !conn.road.has(c.id)).sort((a, b) => g.dist(a.tile, cap.tile) - g.dist(b.tile, cap.tile));
  for (const c of loose) {
    if (landComponentOf(G, c.tile) !== landComponentOf(G, cap.tile)) continue;
    const ghost = { type: 'builder', owner: pid, tile: cap.tile, moves: MP * 2, id: -1 };
    const path = findPath(G, ghost, c.tile, 4000);
    if (!path) continue;
    const t = path.map(s => s.t).find(x => !roadAt(G, x) && !res.has(x));
    if (t !== undefined) { res.add(t); return { stand: t, act: { kind: 'road', level: 1, tile: t } }; }
  }
  return null;
}
function aiBuilder(G, u) {
  u.ai = u.ai || {};
  for (let step = 0; step < 2 && u.moves > 0 && G.units.includes(u); step++) {
    const plan = aiBuilderPlan(G, u);
    if (!plan) { aiReturnHome(G, u); return; }
    if (u.tile !== plan.stand) {
      const r = advanceToward(G, u, plan.stand);
      if (r.failed || u.tile !== plan.stand) return;
    }
    if (u.moves > 0) doBuilderAction(G, u, plan.act);
  }
}
function aiCaravan(G, u) {
  if (G.routes.filter(r => r.owner === u.owner).length >= routeCapacity(G, u.owner)) { removeUnit(G, u); return; }
  let best = null, bs = -Infinity;
  for (const t of routeTargets(G, u)) {
    const y = t.y, s = y.fromG + y.fromS * 1.3 + y.toF * 1.2 + y.toP * 1.1 + (y.domestic ? 0 : 0.5);
    if (s > bs) { bs = s; best = t; }
  }
  if (best) establishRoute(G, u, best.city.id);
}
// Keep a reserve, spend the rest on the cheapest useful purchases; steer focus when broke.
function aiSpend(G, pid) {
  const P = G.players[pid], cs = ownCities(G, pid);
  const reserve = 60 + 8 * cs.length;
  for (let k = 0; k < cs.length && P.gold > reserve + 40; k++) {
    let best = null, bc = Infinity;
    for (const c of cs) {
      if (!c.build) continue;
      const chk = canBuy(G, c);
      if (!chk.ok || P.gold - chk.cost < reserve) continue;
      const pri = c.build.k === 'u' && (c.build.key === 'settler' || c.build.key === 'builder') ? 0.7 : 1;
      if (chk.cost * pri < bc) { bc = chk.cost * pri; best = c; }
    }
    if (!best || !buyItem(G, best)) break;
  }
  const net = P.lastGold || 0;
  if (net < 0 && P.gold < 40) {
    const big = cs.filter(c => c.focus !== 'gold').sort((a, b) => b.pop - a.pop)[0];
    if (big) { big.focus = 'gold'; assignWorkers(G, big); }
  } else if (net > 12) {
    for (const c of cs) if (c.focus === 'gold') { c.focus = 'balanced'; assignWorkers(G, c); break; }
  }
}

HX.aiTakeTurn = aiTakeTurn;
HX.aiChooseProduction = aiChooseProduction;
HX.aiChooseResearch = aiChooseResearch;
