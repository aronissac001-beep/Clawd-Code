// ===== ai.js : computer opponents =====
function aiTakeTurn(G, pid) {
  if (G.players[pid].barbarian) { barbarianTurn(G, pid); computeVisibility(G, pid); return; }
  if (G.players[pid].minor) { minorTurn(G, pid); return; }
  const P0 = G.players[pid];
  if (!P0.landed && P0.landing && P0.landing.length && !G.cities.some(c => c.owner === pid)) { let bi = 0, bv = -Infinity; P0.landing.forEach((t, i) => { const v = siteScore(G.map, G._grid, t) - (i ? 3 : 0); if (v > bv) { bv = v; bi = i; } }); chooseLanding(G, pid, bi); }
  aiWarPlanner(G, pid);
  aiDiplomacy(G, pid);
  aiCityStates(G, pid);
  aiGreat(G, pid);
  const mine = G.units.filter(u => u.owner === pid);
  const military = [];
  // settlers act first so escorts can follow them to their new position
  mine.sort((a, b) => (UNITS[b.type].founds ? 1 : 0) - (UNITS[a.type].founds ? 1 : 0));
  for (const u of mine) {
    if (!G.units.includes(u)) continue;
    u.ai = u.ai || {};
    if (UNITS[u.type].founds) aiSettler(G, u);
    else if (UNITS[u.type].charges && !UNITS[u.type].recon) aiBuilder(G, u);
    else if (UNITS[u.type].trade) aiCaravan(G, u);
    else if (UNITS[u.type].orbital) aiLaunch(G, u);
    else if (UNITS[u.type].recon) aiScout(G, u);
    else if (UNITS[u.type].spy) aiSpy(G, u);
    else military.push(u);
  }
  aiMilitaryTurn(G, pid, military);
  aiCityBombard(G, pid);
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
    for (const n of G.natural || []) if (g.dist(n.tile, t) <= 2 && n.tile !== t) s += 8; // settle next to natural wonders
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
  if (u.order && u.order.t === 'dig') return;
  const P = G.players[u.owner], g = G._grid;
  if (studyStatus(G, u) && studyStatus(G, u).ok && !faunaHostile(G, u.owner, u.tile)) { studyNest(G, u); return; }
  if (digStatus(G, u).ok) { startDig(G, u); return; }
  const decode = hasTech(P, 'deep_resonance') && (G.sites || []).some(s => s.kind === 'vault' && P.explored[s.tile] && !P.vaults.includes(s.id));
  if ((u.charges || 0) > 0 || decode) {
    // the nearest known site worth an expedition; Echo Vaults are worth any journey once they can be decoded
    let best = null, bd = 14;
    for (const s of G.sites || []) {
      if (!P.explored[s.tile] || (s.kind === 'vault' && P.vaults.includes(s.id))) continue;
      if ((u.charges || 0) <= 0 && !(s.kind === 'vault' && hasTech(P, 'deep_resonance'))) continue;
      if (s.kind === 'vault' && hasTech(P, 'deep_resonance')) { const d = g.dist(s.tile, u.tile) - 30; if (d < bd && !G.units.some(o => o !== u && o.owner === u.owner && o.ai && o.ai.site === s.id)) { bd = d; best = s; } continue; }
      if (s.kind === 'vault' && !hasTech(P, 'deep_resonance') && (P.vaultHeard || []).includes(s.id)) continue;
      if (G._civ.has(s.tile) && G._civ.get(s.tile) !== u) continue;
      if (G.units.some(o => o !== u && o.owner === u.owner && o.ai && o.ai.site === s.id)) continue;
      const d = g.dist(s.tile, u.tile); if (d < bd) { bd = d; best = s; }
    }
    if (best) {
      u.ai.site = best.id;
      let goal = best.tile;
      if (best.kind === 'vault' && (G._mil.get(goal) || G._civ.get(goal) || G._cityAt.has(goal))) { const st = G._grid.neighbors(goal).filter(n => passableFor(G, u, n) && !G._civ.has(n) && !G._cityAt.has(n) && !foreignBlocked(G, u, n, u.owner)).sort((x, y) => g.dist(x, u.tile) - g.dist(y, u.tile))[0]; if (st !== undefined) goal = st; }
      const r = advanceToward(G, u, goal); if (digStatus(G, u).ok) startDig(G, u); if (!r.failed) return;
    }
    u.ai.site = null;
  } else if (G.turn % 4 === 0) {
    const lab = ownCities(G, u.owner).filter(c => c.buildings.includes('library')).sort((a, b) => g.dist(a.tile, u.tile) - g.dist(b.tile, u.tile))[0];
    if (lab && g.dist(lab.tile, u.tile) < 15) { advanceToward(G, u, lab.tile); return; }
  }
  if (u.ai.idleUntil && G.turn < u.ai.idleUntil) return aiReturnHome(G, u);
  u.order = { t: 'explore' };
  runOrder(G, u);
  if (u.order && u.order.t === 'explore') u.order = null;
  else if (!u.order) { u.ai.idleUntil = G.turn + 10; aiReturnHome(G, u); }
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
  halcyon: { f: 1.1, p: 1.25, g: 0.85, s: 1.2, c: 0.8, expand: 1.25 },
  kestrel: { f: 1.0, p: 1.15, g: 1.3, s: 1.1, c: 0.85, expand: 1.15 },
  brightwater: { f: 1.25, p: 1.15, g: 0.85, s: 1.05, c: 1.0, expand: 1.25 },
  ironveil: { f: 1.05, p: 1.3, g: 0.8, s: 1.05, c: 0.8, expand: 1.1 },
  choir: { f: 1.1, p: 1.15, g: 0.85, s: 1.15, c: 1.05, expand: 1.15 },
  forgeborn: { f: 1.0, p: 1.15, g: 0.8, s: 1.1, c: 0.75, expand: 1.05 },
  tidecall: { f: 1.15, p: 1.15, g: 1.15, s: 1.05, c: 0.9, expand: 1.15 },
  pathfinder: { f: 1.1, p: 1.1, g: 0.9, s: 1.1, c: 0.9, expand: 1.1 },
};
function personaOf(G, pid) { return PERSONA[civKey(G.players[pid])] || PERSONA.minor; }
// The long-term plan of an AI: its affinity victory, the Awakening, or conquest (Dominion). Fixed once chosen.
const PLAN_ODDS = { halcyon: [0.25, 0.05], kestrel: [0.15, 0.1], brightwater: [0.15, 0.05], ironveil: [0.05, 0.3], choir: [0.2, 0.05], forgeborn: [0.1, 0.15], tidecall: [0.15, 0.2], pathfinder: [0.2, 0.05] };
function aiPlan(G, pid) {
  const P = G.players[pid]; if (P.minor || P.barbarian) return 'none';
  if (!P.aiPlan) {
    const [aw, dom] = PLAN_ODDS[civKey(P)] || [0.15, 0.1], r = RNG.fromSeed(G.seed + '|plan' + pid).next();
    const V = G.cfg.victories, projects = V.rootsong || V.convergence || V.genesis;
    P.aiPlan = r < aw && V.awakening ? 'awakening' : (r < aw + dom || (!projects && r < 0.5)) && V.domination ? 'domination' : 'affinity';
  }
  return P.aiPlan;
}
// The affinity this AI is pursuing. Its lean first, sometimes another; once a level 4 lead exists it sticks.
function aiAffinity(G, pid) {
  const P = G.players[pid];
  if (P.minor || P.barbarian) return 'lineage';
  const pa = primaryAff(P);
  if (pa && affLevel(P, pa) >= 4) { P.aiAff = pa; return pa; }
  if (!P.aiAff) {
    const lean = CIVS[P.civ].lean || 'lineage', r = RNG.fromSeed(G.seed + '|aff' + pid).next();
    P.aiAff = r < 0.6 ? lean : AFF_KEYS[Math.floor(r * 1000) % 3];
  }
  return P.aiAff;
}

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
  v += w.f * (rep.food || 0) * (pct.f || 0) / 100;
  if (B.veilF) v += c.worked.filter(t => G.map.veil[t]).length * w.f;
  v += w.p * rep.prod * (pct.p || 0) / 100 + w.g * rep.gold * (pct.g || 0) / 100 * 0.8 + w.s * rep.sci * (pct.s || 0) / 100 + w.c * rep.cul * (pct.c || 0) / 100 * 0.7;
  let h = B.h || 0;
  v += h * (hap < 0 ? 3.2 : hap < 4 ? 1.6 : 0.5);
  if (B.keepFood) v += B.keepFood * 0.025 * Math.max(1, c.pop - 2) * w.f;
  if (B.waterF || B.waterP) { const water = c.worked.filter(t => TERRAIN[G.map.terrain[t]].water).length; v += water * ((B.waterF || 0) * w.f + (B.waterP || 0) * w.p); }
  if (B.mountainS) v += Math.min(3, adjacentMountains(G, c.tile)) * w.s;
  const P = G.players[c.owner];
  v -= (B.upkeep || 0) * w.g * ((P.lastGold || 0) < 0 ? 1.6 : 0.6);
  return v;
}

function aiChooseProduction(G, c) {
  const best = aiRankProduction(G, c, true)[0];
  if (best) c.build = best.it;
}
// Every buildable item scored by value per production cost, best first. noise=false is for the
// human's advisor: no randomness, so asking for advice never changes the game.
function aiRankProduction(G, c, noise) {
  const ranked = [];
  const pid = c.owner, P = G.players[pid], w = personaOf(G, pid), hap = civHappiness(G, pid).net, rep = cityReport(G, c, hap);
  const cities = ownCities(G, pid), mine = G.units.filter(u => u.owner === pid);
  const building = (k) => cities.filter(x => x.build && x.build.k === 'u' && x.build.key === k).length;
  const mn = aiMilitaryNeed(G, pid);
  mn.have += cities.filter(x => x !== c && x.build && x.build.k === 'u' && isMil({ type: x.build.key })).length;
  let best = null, bs = -Infinity;
  for (const it of availableItems(G, c)) {
    const cost = itemCost(G, it, pid);
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
      } else if (isMil({ type: k })) {
        v = aiMilitaryValue(G, c, k, mn, w);
        if (v < 0) continue;
        if (building(k) >= 2) v *= 0.6;
      } else if (UNITS[k].recon) {
        const have = mine.filter(u => UNITS[u.type].recon).length + building(k);
        const sites = (G.sites || []).filter(s => P.explored[s.tile] && !(s.kind === 'vault' && P.vaults.includes(s.id))).length;
        const vaultHunt = hasTech(P, 'deep_resonance') && P.vaults.length < 3 && (aiPlan(G, pid) === 'awakening' || (G.sites || []).filter(s => s.kind === 'vault').length >= 3) ? 2 : 0;
        if (have >= (G.turn > 60 ? (sites > 1 ? 1 : 0) : 1) + (sites > 4 ? 1 : 0) + vaultHunt || (G.turn > 220 && !vaultHunt)) continue;
        v = 2.5 + Math.min(4, sites * 0.6);
      } else if (UNITS[k].orbital) {
        const mineSats = G.sats.filter(s => s.owner === pid).length + mine.filter(u => UNITS[u.type].orbital).length + cities.filter(x => x.build && x.build.k === 'u' && UNITS[x.build.key].orbital).length;
        if (mineSats >= Math.max(1, Math.ceil(cities.length / 2)) || mine.some(u => u.type === k)) continue;
        v = k === 'sat_sentinel' ? (mn.atWar ? 9 : 2) : k === 'sat_scrubber' ? (veilInBorders(G, pid) >= 4 && aiAffinity(G, pid) !== 'communion' ? 7 : 1) : k === 'sat_seeder' ? 5 : 7;
      } else if (k === 'spy') {
        if (w.s < 1.1 || mine.some(u => u.type === 'spy') || building('spy') || G.turn % 3) continue;
        v = 3.5;
      } else if (k === 'caravan') {
        const used = G.routes.filter(r => r.owner === pid).length + mine.filter(u => u.type === 'caravan').length + building('caravan');
        if (used >= routeCapacity(G, pid)) continue;
        v = 6.5 * (w.g > 1 ? 1.2 : 1);
      }
    } else if (isWonder(it.key) || isProject(it.key)) {
      v = aiGreatWorkValue(G, c, BUILDINGS[BLDI[it.key]], rep, hap, w, cities);
      if (v <= 0) continue;
    } else {
      v = aiBuildingValue(G, c, BUILDINGS[BLDI[it.key]], rep, hap, w);
      const B = BUILDINGS[BLDI[it.key]];
      if (B.cityStr) { const border = G.cities.some(x => x.owner !== pid && !isBarb(G, x.owner) && G._grid.dist(x.tile, c.tile) <= 8); v += (mn.atWar ? 4 : 0) + (border ? 1.5 : 0) + (c.capital ? 1 : 0); }
      if (B.xp) v += mn.atWar ? 2 : 0.4;
    }
    const sc = v / cost * (noise ? 1 + G._rng.next() * 0.06 : 1);
    ranked.push({ it, sc, v });
  }
  return ranked.sort((a, b) => b.sc - a.sc);
}

// Wonders: local yields plus the empire-wide effect; only strong cities race for them, one at a time.
// Projects: the road to victory, valued very highly once available.
function aiGreatWorkValue(G, c, B, rep, hap, w, cities) {
  const pid = c.owner, P = G.players[pid], n = cities.length;
  const prods = cities.map(x => x === c ? rep.prod : (x._aiProd || 0)).sort((a, b) => b - a);
  c._aiProd = rep.prod;
  const strong = rep.prod >= (prods[Math.min(1, prods.length - 1)] || 0) * 0.9;
  if (B.project) {
    if (!strong && n > 2) return -1;
    return B.victory === 'awakening' ? (aiPlan(G, pid) === 'awakening' ? 95 : 70) : (B.aff && B.aff[0] === aiAffinity(G, pid) ? 90 : 55);
  }
  if (!strong) return -1;
  if (cities.some(x => x !== c && x.build && isWonder(x.build.key))) return -1;
  let v = aiBuildingValue(G, c, B, rep, hap, w);
  const fx = B.fx || {}, once = B.once || {};
  const sci = P.lastSci || 5, cul = P.lastCul || 3, gold = Math.max(8, P.lastGold || 0) + 10, prod = n * Math.max(3, rep.prod * 0.6);
  v += w.s * sci * (fx.sciPct || 0) / 100 + w.c * 0.7 * cul * (fx.culPct || 0) / 100 + w.g * 0.8 * gold * (fx.goldPct || 0) / 100 + w.p * prod * (fx.prodPct || 0) / 100;
  v += w.p * n * (fx.cityProd || 0) + n * 0.1 * w.f * (fx.keepFood || 0) + (fx.routeGold || 0) * w.g * 0.8 * G.routes.filter(r => r.owner === pid).length;
  const hh = (fx.happy || 0) + (fx.happyPerCity || 0) * n + (fx.venueHappy || 0) * cities.filter(x => x.buildings.includes('amphitheater') || x.buildings.includes('arena')).length;
  v += hh * (hap < 0 ? 3.2 : hap < 4 ? 1.6 : 0.5);
  v += ((fx.xp || 0) / 10 + (fx.milProdPct || 0) / 10 + (fx.combatPct || 0) / 5) * (AGGRESSION[civKey(P)] || 1);
  v += (fx.navalMoves || 0) * 1.5 + (fx.attBonus || 0) * 2 + (fx.satLife || 0) / 10;
  for (const a of AFF_KEYS) if (fx['affPct_' + a]) v += a === aiAffinity(G, pid) ? 6 : 0.5;
  if (once.freeTech && P.research) v += w.s * techCost(G, P.research, pid) / 35;
  if (once.freePolicy) v += w.c * policyCost(G, pid) / 35;
  return (v + 3) * 1.5;
}
function aiTechValue(G, pid, key, w, cities) {
  const P = G.players[pid];
  let v = 1.5;
  const nC = Math.max(1, cities.length), lean = aiAffinity(G, pid);
  for (const B of BUILDINGS) if (B.tech === key && (B.wonder || B.project) && !G.wonders[B.key]) {
    if (B.project) v += B.victory === 'awakening' ? 10 : B.aff && B.aff[0] === lean ? 45 : 2;
    else v += 1.5;
  }
  for (const B of BUILDINGS) if (B.tech === key && !B.hidden && !B.wonder && !B.project) {
    if (B.aff && B.aff[0] !== lean) continue;
    const y = B.y || {};
    v += (w.f * (y.f || 0) + w.p * (y.p || 0) + w.g * (y.g || 0) + w.s * (y.s || 0) * 1.2 + w.c * (y.c || 0) + (B.h || 0) * 1.5
      + ((B.pct || {}).s || 0) / 10 * w.s + ((B.pct || {}).p || 0) / 10 * w.p + ((B.pct || {}).g || 0) / 12 * w.g + (B.keepFood ? 1 : 0)) * Math.min(nC, 6) * 0.5;
  }
  for (let i = 1; i < IMPROV.length; i++) if (IMPROV[i].tech === key) {
    let k = 0; for (const c of cities) for (const t of c.tiles) { const ch = improvementFor(G, pid, t); if (ch.wants === i) k++; }
    v += 1 + k * 1.3;
  }
  for (const R0 of RES) if (R0.reveal === key) v += R0.key === AFF_RES[lean] ? 7 : 3;
  const T0 = TECHS[TECHI[key]], fx = T0.fx || {};
  if (fx.routes) v += 5 * (w.g > 1 ? 1.3 : 1);
  if (fx.irrigation) v += 3; if (fx.millP) v += 2; if (fx.sciPct) v += 4 * w.s; if (fx.combatPct) v += 2;
  for (const k in SATS) if (SATS[k].tech === key) v += 2;
  for (const k in UNITS) { const U = UNITS[k]; if (U.tech === key && U.military && (!U.aff || U.aff === lean)) v += 1.5 * (AGGRESSION[civKey(P)] || 1); }
  if (T0.later) v += T0.later.length * 1.2;
  // affinity: the heart of the AI's long plan
  const a = techAffinity(key);
  v += (a[lean] || 0) * 0.45 + Object.keys(a).filter(k => k !== lean).reduce((s2, k) => s2 + a[k] * 0.06, 0);
  if (key === 'deep_resonance') v += aiPlan(G, pid) === 'awakening' ? 70 : 8;
  if (aiPlan(G, pid) === 'awakening' && T0.s === 4) v *= 1.5;
  if (aiPlan(G, pid) === 'domination' && T0.s === 6) v *= 1.6;
  return v;
}
function aiChooseResearch(G, pid) { const best = aiBestResearch(G, pid, true); if (best) setResearch(G, pid, best); }
// The best tech to research now; noise=false for the human's advisor (no randomness used).
function aiBestResearch(G, pid, noise) {
  const P = G.players[pid], w = personaOf(G, pid), cities = ownCities(G, pid), avail = availableTechs(P);
  if (!avail.length) return null;
  const sci = Math.max(1, P.lastSci || 3);
  let best = null, bs = -Infinity;
  for (const k of avail) {
    let v = aiTechValue(G, pid, k, w, cities);
    // look one step ahead so gateway techs are not starved
    let ahead = 0;
    for (const t of TECHS) if (!hasTech(P, t.key) && (t.pre.includes(k) || t.any.includes(k)) && t.pre.every(x => x === k || hasTech(P, x))) ahead = Math.max(ahead, aiTechValue(G, pid, t.key, w, cities));
    v += ahead * 0.35;
    const turns = Math.max(1, (techCost(G, k, pid) - (P.progress[k] || 0)) / sci);
    const sc = v / turns * (noise ? 1 + G._rng.next() * 0.05 : 1);
    if (sc > bs) { bs = sc; best = k; }
  }
  return best;
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
      v += (I.add.s || 0) * 1.0 + (I.add.c || 0) * 0.6;
      if (m.veil[t] && imp !== IMPI.biowell && affLevel(P, 'communion') < 2) v -= 0.6;
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
  // the Veil inside our borders: burn it back (or, for Communion, leave it)
  if (hasTech(P, 'biocontainment') && aiAffinity(G, pid) !== 'communion' && affLevel(P, 'communion') < 2) {
    for (let k = 0; k < near.length; k++) { const t = near[k]; if (m.owner[t] === pid && m.veil[t] && !res.has(t) && passableTerrain(G, t) && dd[k] <= 6 && !G.camps.some(c => c.tile === t)) { res.add(t); return { stand: t, act: { kind: 'scour', tile: t } }; } }
  }
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



HX.aiChooseProduction = aiChooseProduction; HX.aiRankProduction = aiRankProduction; HX.aiBestResearch = aiBestResearch;
HX.aiChooseResearch = aiChooseResearch;

HX.aiTakeTurn = aiTakeTurn;
HX.aiCityBombard = aiCityBombard;
HX.aiBestAttack = aiBestAttack;
