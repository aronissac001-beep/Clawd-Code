// ===== aiwar.js : military AI, war decisions, native fauna =====
const AGGRESSION = { halcyon: 0.75, kestrel: 0.7, brightwater: 0.7, ironveil: 1.25, choir: 0.75, forgeborn: 1.1, tidecall: 0.95, pathfinder: 0.9 };

function isMil(u) { const U = UNITS[u.type]; return U.military && U.cls !== 'recon'; }
function enemiesOf(G, pid) {
  const vis = G.players[pid]._vis;
  return G.units.filter(u => u.owner !== pid && vis[u.tile] && atWar(G, pid, u.owner));
}
// Tiles reachable this turn with moves left over (so the unit can still attack from there).
function reachLeft(G, u) {
  const g = G._grid, pid = u.owner, max = maxMoves(G, u);
  const best = new Map([[u.tile, u.moves]]), q = [u.tile];
  for (let h = 0; h < q.length; h++) {
    const t = q[h], l = best.get(t); if (l <= 0) continue;
    for (let d = 0; d < 6; d++) {
      const n = g.nb[t * 6 + d];
      if (n < 0 || !passableFor(G, u, n) || foreignBlocked(G, u, n, pid)) continue;
      const c = stepCost(G, u, t, n);
      if (c === Infinity || !(c >= STOP || l >= c || l === max)) continue;
      const nl = c >= STOP ? 0 : Math.max(0, l - c);
      if (best.has(n) && best.get(n) >= nl) continue;
      best.set(n, nl); q.push(n);
    }
  }
  return best;
}
// Best attack this unit can make this turn: { origin, tile, score } or null.
function aiBestAttack(G, u, targets) {
  const U = UNITS[u.type]; if (!isMil(u) || u.moves <= 0) return null;
  const range = U.ranged ? unitRange(u) : 1, g = G._grid;
  const reach = reachLeft(G, u), maxD = Math.ceil(u.moves / MP) + range + 1;
  const near = targets.filter(t => g.dist(t, u.tile) <= maxD);
  if (!near.length) return null;
  const home = u.tile;
  let best = null;
  for (const [o, left] of reach) {
    if (left <= 0 && o !== home) continue;
    if (o !== home && (ownOccupied(G, u, o) || isWater(G, o) !== isWater(G, home) && !U.naval)) continue;
    for (const t of near) {
      if (g.dist(o, t) > range) continue;
      u.tile = o;
      const pv = combatPreview(G, u, t);
      u.tile = home;
      if (!pv.ok) continue;
      let s;
      if (pv.capture && pv.tg.civilian) s = 60;
      else if (pv.tg.city) {
        if (pv.attackerDies) continue;
        s = pv.capture ? 400 : pv.dmgToTarget * 0.8 - pv.dmgToAttacker * (pv.ranged ? 0 : 0.7);
        if (!pv.ranged && pv.dmgToAttacker > u.hp * 0.55 && !pv.capture) continue;
      } else {
        if (pv.attackerDies) continue;
        const kill = pv.kill;
        s = (kill ? 120 + UNITS[pv.tg.unit.type].cost * 0.3 : pv.dmgToTarget / Math.max(10, pv.targetHp) * 60) - pv.dmgToAttacker * 0.9;
        if (!pv.ranged && !kill && pv.dmgToTarget < pv.dmgToAttacker * 1.1) continue;
        if (isBarb(G, pv.tg.unit.owner)) s += 5;
      }
      if (o !== home) { const ter = TERRAIN[G.map.terrain[o]]; s += (ter.def || 0) / 10 - 1; }
      if (!best || s > best.score) best = { origin: o, tile: t, score: s };
    }
  }
  return best && best.score > 0 ? best : null;
}
function aiExecuteAttack(G, u, plan) {
  if (plan.origin !== u.tile) { advanceToward(G, u, plan.origin); if (u.tile !== plan.origin || u.moves <= 0) return null; }
  return doAttack(G, u, plan.tile);
}
function attackTargets(G, pid) {
  const vis = G.players[pid]._vis, out = [];
  for (const u of G.units) if (u.owner !== pid && vis[u.tile] && atWar(G, pid, u.owner)) out.push(u.tile);
  for (const c of G.cities) if (c.owner !== pid && vis[c.tile] && atWar(G, pid, c.owner)) out.push(c.tile);
  return Array.from(new Set(out));
}
function aiPromoteAndUpgrade(G, u) {
  const P = G.players[u.owner];
  for (let k = 0; k < 3; k++) {
    const ch = promoChoices(G, u); if (!ch.length) break;
    const pref = ['shock1', 'shock2', 'accuracy1', 'accuracy2', 'siege1', 'siege2', 'gunnery1', 'raider', 'drill1', 'cover', 'longshot', 'mobility', 'medic', 'shock3', 'navigator'];
    promote(G, u, pref.find(p => ch.includes(p)) || ch[0]);
  }
  const lean = aiAffinity(G, u.owner), opts = upgradeOptions(G, u).filter(o => o.ok);
  const up = opts.find(o => o.aff === lean) || (affLevel(P, lean) < 3 ? opts[0] : null);
  if (up && P.gold - up.cost > 80) upgradeUnit(G, u, up.to);
  if (UNITS[u.type].fauna === undefined && tameStatus(G, u) && tameStatus(G, u).ok && P.gold > 150) tameFauna(G, u);
}
function nearestOwnCity(G, pid, t) {
  let best = null, bd = 1e9;
  for (const c of G.cities) if (c.owner === pid) { const d = G._grid.dist(c.tile, t); if (d < bd) { bd = d; best = c; } }
  return best;
}
// Stand on a free tile at distance 'want' from target (or as close as possible), nearest to the unit.
function stagingTile(G, u, target, want) {
  const g = G._grid; let best = -1, bs = 1e9;
  for (const t of g.within(target, Math.max(want, 1) + 1).slice()) {
    const d = g.dist(t, target); if (d === 0 || d > want) continue;
    if (!passableFor(G, u, t) || foreignBlocked(G, u, t, u.owner) || ownOccupied(G, u, t)) continue;
    if (isWater(G, t) && !UNITS[u.type].naval) continue;
    const s = g.dist(t, u.tile) * 2 + (want - d) * 3 - (TERRAIN[G.map.terrain[t]].def || 0) / 10;
    if (s < bs) { bs = s; best = t; }
  }
  return best;
}

// ---- war planning ----
function aiWarPlanner(G, pid) {
  const P = G.players[pid];
  if (P.barbarian || (G.turn + pid) % 4 !== 0) return;
  const me = militaryPower(G, pid);
  for (const Q of majorPlayers(G)) {
    if (Q.id === pid || !Q.alive || !atWar(G, pid, Q.id)) continue;
    const w = warRecord(G, pid, Q.id), turns = G.turn - w.since, them = militaryPower(G, Q.id);
    const losing = me < them * 0.8 || (w.lost[pid] || 0) >= (w.lost[Q.id] || 0) + 3;
    // conquerors keep a winning war going while the enemy still has cities to take
    const winning = (w.took[pid] || 0) > (w.took[Q.id] || 0) && me > them * 1.2;
    const conqueror = ((AGGRESSION[civKey(P)] || 1) >= 1.1 || aiPlan(G, pid) === 'domination') && G.cfg.victories.domination;
    if (turns >= 8 && (losing || (turns > 40 && !(winning && conqueror && turns < 90)))) {
      if (!Q.human) { if (peaceAcceptable(G, pid, Q.id).ok) makePeace(G, pid, Q.id); }
      else if (!G.offers.some(o => o.from === pid && o.to === Q.id && o.kind === 'peace')) {
        G.offers.push({ id: G.nextId++, kind: 'peace', from: pid, to: Q.id, turn: G.turn });
        logEvent(G, Q.id, `The ${CIVS[P.civ].name} offer peace. Answer in Diplomacy (🤝).`, -1);
      }
    }
  }
  if (G.turn < (aiPlan(G, pid) === 'domination' ? 50 : 35) || majorPlayers(G).some(Q => Q.id !== pid && atWar(G, pid, Q.id))) return;
  const threat = majorPlayers(G).some(Q => Q.id !== pid && Q.alive && projectsOf(G, Q.id).length);
  const dom = aiPlan(G, pid) === 'domination', aggr = (AGGRESSION[civKey(P)] || 1) * (dom ? 1.8 : 1), mine = ownCities(G, pid);
  let best = null, bs = 0;
  for (const Q of majorPlayers(G)) {
    if (Q.id === pid || !warStatus(G, pid, Q.id).ok) continue;
    const theirCities = G.cities.filter(c => c.owner === Q.id && P.seen[c.tile]);
    const close = theirCities.some(c => mine.some(m => { const d = G._grid.dist(m.tile, c.tile);
      return landComponentOf(G, m.tile) === landComponentOf(G, c.tile) ? d <= 12 : d <= 16 && hasTech(P, 'marine_tech') && isCoastal(G.map, G._grid, m.tile) && isCoastal(G.map, G._grid, c.tile); }));
    if (!close) continue;
    if (!theirCities.some(c => { const r = nearestOwnCity(G, pid, c.tile); return r && armyReachable(G, pid, r.tile, c.tile); })) { aiAskPassage(G, pid, Q.id); continue; }
    const att = attitude(G, pid, Q.id).score;
    if (att >= (dom ? 9 : 6)) continue;
    // their allies would join them
    let theirs = militaryPower(G, Q.id); for (const a of alliesOf(G, Q.id)) if (a !== pid) theirs += militaryPower(G, a) * 0.6;
    let s = me / (theirs + 1) * aggr;
    s *= att <= -6 ? 1.5 : att <= -2 ? 1.2 : att >= 3 ? 0.45 : 1;
    if (Q.human) s *= [0.6, 1, 1.15, 1.3][G.cfg.difficulty] || 1;
    // a Dominion plan goes for the rivals that still hold their own first colony
    if (dom && G.cities.some(c => c.owner === Q.id && c.origCap === Q.id && P.seen[c.tile])) s *= domHeld(G, pid) > 0 ? 1.8 : 1.4;
    if (projectsOf(G, Q.id).length) s *= 2.2; // stop a victory project
    else if (G.cities.some(c => c.owner === Q.id && c.build && isProject(c.build.key))) s *= 1.4;
    if (s > bs) { bs = s; best = Q.id; }
  }
  if (best !== null && bs > (threat ? 0.9 : dom ? 0.85 : 1.3) && G._rng.chance(threat ? 0.5 : dom ? 0.6 : 0.3)) {
    if (declareWar(G, pid, best)) aiCallFriends(G, pid, best);
  }
}
// Ask friends to fight alongside us. AI friends decide by their own deal value; humans get a request.
function aiCallFriends(G, pid, target) {
  for (const Q of majorPlayers(G)) {
    if (Q.id === pid || Q.id === target || !Q.alive || atWar(G, Q.id, target) || !warStatus(G, Q.id, target).ok) continue;
    if (attitude(G, Q.id, pid).score < 3 && !allied(G, pid, Q.id)) continue;
    if (Q.human) { if (!G.offers.some(o => o.from === pid && o.to === Q.id && o.kind === 'joinwar')) { G.offers.push({ id: G.nextId++, kind: 'joinwar', from: pid, to: Q.id, target, turn: G.turn }); logEvent(G, Q.id, `The ${CIVS[G.players[pid].civ].name} ask you to join their war on the ${CIVS[G.players[target].civ].name}.`, -1); } continue; }
    const items = [{ by: Q.id, kind: 'war', target }];
    if (dealValue(G, Q.id, pid, items) >= 0) executeDeal(G, pid, Q.id, items);
  }
}
function aiChooseTarget(G, pid) {
  const P = G.players[pid], mine = ownCities(G, pid);
  let best = null, bs = Infinity;
  for (const c of G.cities) {
    if (c.owner === pid || !atWar(G, pid, c.owner) || isBarb(G, c.owner) || !P.seen[c.tile]) continue;
    let d = Infinity, rally = null;
    for (const m of mine) { const dd = G._grid.dist(m.tile, c.tile); if (dd < d) { d = dd; rally = m; } }
    if (!rally) continue;
    let sameLand = landComponentOf(G, rally.tile) === landComponentOf(G, c.tile);
    if (!sameLand) {
      if (!hasTech(P, 'marine_tech')) continue;
      // nearest coastal city of ours, and a sea path from it
      const coast = mine.filter(m => isCoastal(G.map, G._grid, m.tile)).sort((x, y) => G._grid.dist(x.tile, c.tile) - G._grid.dist(y.tile, c.tile))[0];
      if (!coast || !armyReachable(G, pid, coast.tile, c.tile)) continue;
      rally = coast; d = G._grid.dist(coast.tile, c.tile);
    }
    else if (!armyReachable(G, pid, rally.tile, c.tile)) continue;
    // capitals are worth more to a conqueror: they count toward domination
    const capBonus = c.origCap !== undefined && c.origCap === c.owner && ((AGGRESSION[civKey(P)] || 1) >= 1.1 || aiPlan(G, pid) === 'domination') ? 6 : 0;
    const projBonus = c.buildings.some(k => isProject(k)) ? 12 : 0;
    const s = d + cityStrength(G, c) / 4 + c.hp / 40 + (sameLand ? 0 : 8) - capBonus - projBonus;
    if (s < bs) { bs = s; best = { city: c.id, rally: rally.id, sea: !sameLand }; }
  }
  return best;
}
// Ask the civs whose land lies between us and a rival for open borders.
function aiAskPassage(G, pid, target) {
  const tc = G.cities.find(c => c.owner === target && G.players[pid].seen[c.tile]); if (!tc) return;
  const home = nearestOwnCity(G, pid, tc.tile); if (!home) return;
  const g = G._grid, between = new Set();
  for (const t of g.within(home.tile, g.dist(home.tile, tc.tile))) { const o = G.map.owner[t]; if (o >= 0 && o !== pid && o !== target && !isBarb(G, o) && g.dist(t, home.tile) + g.dist(t, tc.tile) <= g.dist(home.tile, tc.tile) + 3) between.add(o); }
  for (const o of between) {
    if (hasOB(G, pid, o) || atWar(G, pid, o) || !G.players[pid].met.includes(o)) continue;
    const items = [{ by: -1, kind: 'ob' }];
    if (G.players[o].human) continue;
    if (dealValue(G, o, pid, items) >= 0) executeDeal(G, pid, o, items);
    else if (G.players[pid].gold > 120) { const pay = [{ by: -1, kind: 'ob' }, { by: pid, kind: 'gold', amount: 60 }]; if (dealValue(G, o, pid, pay) >= 0) executeDeal(G, pid, o, pay); }
  }
}
// Can a land army get from 'from' to next to 'to' (embarking if needed)? A ghost unit walks the path, so nothing on the map changes.
// The target's own borders are treated as open, since we would be at war.
function armyReachable(G, pid, from, to) {
  const key = pid + ':' + from + ':' + to + ':' + Math.floor(G.turn / 10);
  G._osr = G._osr || new Map(); if (G._osr.has(key)) return G._osr.get(key);
  const ghost = { id: -1, type: 'militia', owner: pid, tile: from, moves: 12, hp: 100, xp: 0, promos: [] };
  ghost.moves = maxMoves(G, ghost);
  let ok = false;
  G._openFor = G.map.owner[to];
  try { for (const n of G._grid.neighbors(to)) { if (!passableTerrain(G, n) || G._cityAt.has(n)) continue; const p = findPath(G, ghost, n, 6000); if (p && p.length && p[p.length - 1].turn <= 14) { ok = true; break; } } }
  finally { G._openFor = -1; }
  if (G._osr.size > 400) G._osr.clear();
  G._osr.set(key, ok); return ok;
}

// ---- tactical turn ----
function aiMilitaryTurn(G, pid, units) {
  const P = G.players[pid], g = G._grid, cities = ownCities(G, pid);
  for (const u of units) aiPromoteAndUpgrade(G, u);
  // 1. attacks, ranged first so melee can finish off damaged targets
  let targets = attackTargets(G, pid);
  const order = units.slice().sort((a, b) => (UNITS[b.type].ranged ? 1 : 0) - (UNITS[a.type].ranged ? 1 : 0));
  for (const u of order) {
    if (!G.units.includes(u) || !targets.length) continue;
    for (let k = 0; k < 2 && u.moves > 0; k++) {
      const plan = aiBestAttack(G, u, targets); if (!plan) break;
      aiExecuteAttack(G, u, plan);
      targets = attackTargets(G, pid);
      if (!UNITS[u.type].ranged) break;
    }
  }
  // 2. roles for units that still can move
  const enemies = enemiesOf(G, pid).filter(e => isMil(e));
  const threatened = new Set(cities.filter(c => enemies.some(e => g.dist(e.tile, c.tile) <= 4)).map(c => c.id));
  const atWarMajor = majorPlayers(G).some(Q => Q.id !== pid && atWar(G, pid, Q.id));
  if (!atWarMajor) P.aiw = null;
  else if (!P.aiw || !cityById(G, P.aiw.city) || cityById(G, P.aiw.city).owner === pid || !atWar(G, pid, cityById(G, P.aiw.city).owner)) {
    const t = aiChooseTarget(G, pid); P.aiw = t ? { city: t.city, rally: t.rally, sea: !!t.sea, phase: 'gather', since: G.turn } : null;
  }
  const free = units.filter(u => G.units.includes(u) && u.moves > 0);
  // garrisons: one per city, two when threatened
  const garrisoned = new Set();
  for (const c of cities) {
    const want = threatened.has(c.id) ? 2 : 1;
    let have = 0;
    const here = G._mil.get(c.tile); if (here && here.owner === pid) { have++; garrisoned.add(here.id); if (here.moves > 0 && !here.order) here.order = { t: 'fortify' }; }
    for (const u of free) {
      if (have >= want) break;
      if (garrisoned.has(u.id) || UNITS[u.type].naval) continue;
      if (have === 0 && g.dist(u.tile, c.tile) <= 8 && !G._mil.has(c.tile)) { advanceToward(G, u, c.tile); if (u.tile === c.tile) u.order = { t: 'fortify' }; garrisoned.add(u.id); have++; }
      else if (have >= 1 && threatened.has(c.id) && g.dist(u.tile, c.tile) <= 5) { const st = stagingTile(G, u, c.tile, 1); if (st >= 0) advanceToward(G, u, st); garrisoned.add(u.id); have++; }
    }
  }
  const rest = free.filter(u => !garrisoned.has(u.id) && G.units.includes(u) && u.moves > 0);
  // wounded retreat to heal
  for (const u of rest) {
    if (u.hp >= 45) continue;
    const c = nearestOwnCity(G, pid, u.tile);
    if (c && u.tile !== c.tile && !G._mil.has(c.tile)) advanceToward(G, u, c.tile);
    else if (c) { const st = stagingTile(G, u, c.tile, 1); if (st >= 0) advanceToward(G, u, st); }
    u.order = { t: 'fortify' }; u.ai = Object.assign(u.ai || {}, { healing: true });
  }
  const healthy = rest.filter(u => u.hp >= 45 && G.units.includes(u) && u.moves > 0 && !UNITS[u.type].naval);
  // navy: escort a sea invasion toward the target, else guard the nearest coastal city
  const navy = rest.filter(u => u.hp >= 45 && G.units.includes(u) && u.moves > 0 && UNITS[u.type].naval);
  for (const u of navy) {
    u.order = null;
    const tc = P.aiw && cityById(G, P.aiw.city);
    if (tc && P.aiw.phase === 'attack') { const st = stagingTile(G, u, tc.tile, UNITS[u.type].ranged ? 2 : 1); if (st >= 0) advanceToward(G, u, st); }
    else { const c = cities.filter(x => isCoastal(G.map, g, x.tile)).sort((x, y) => g.dist(x.tile, u.tile) - g.dist(y.tile, u.tile))[0]; if (c && g.dist(c.tile, u.tile) > 3) { const st = stagingTile(G, u, c.tile, 2); if (st >= 0) advanceToward(G, u, st); } else u.order = { t: 'fortify' }; }
  }
  // camps near home
  const calm = aiAffinity(G, pid) === 'communion' && !faunaHostile(G, pid);
  for (const camp of G.camps) {
    if (!cities.some(c => g.dist(c.tile, camp.tile) <= (calm ? 4 : 8)) || !P.explored[camp.tile]) continue;
    const hunters = healthy.filter(u => !u.ai || !u.ai.busy).sort((a, b) => g.dist(a.tile, camp.tile) - g.dist(b.tile, camp.tile)).slice(0, 2);
    for (const u of hunters) { u.ai = Object.assign(u.ai || {}, { busy: true }); u.order = null; advanceToward(G, u, camp.tile); }
  }
  // army toward the war target
  const army = healthy.filter(u => G.units.includes(u) && u.moves > 0 && !(u.ai && u.ai.busy));
  if (P.aiw) {
    const tc = cityById(G, P.aiw.city), rally = cityById(G, P.aiw.rally) || nearestOwnCity(G, pid, tc.tile);
    if (rally) {
      const near = army.filter(u => g.dist(u.tile, rally.tile) <= 3).length;
      const need = Math.max(3, Math.round(cityStrength(G, tc) / 8)) + (P.aiw.sea ? 1 : 0);
      if (P.aiw.phase === 'gather' && (near >= need || G.turn - P.aiw.since > (P.aiw.sea ? 24 : 18))) P.aiw.phase = 'attack';
      for (const u of army) {
        u.order = null;
        if (P.aiw.phase === 'gather') { if (g.dist(u.tile, rally.tile) > 2) { const st = stagingTile(G, u, rally.tile, 2); if (st >= 0) advanceToward(G, u, st); } }
        else {
          const want = UNITS[u.type].ranged ? Math.min(2, unitRange(u)) : 1;
          const st = stagingTile(G, u, tc.tile, want);
          if (st >= 0) advanceToward(G, u, st); else advanceToward(G, u, tc.tile);
        }
      }
    }
  } else {
    // peace: settle into cities or fortify at the border
    for (const u of army) {
      if (u.order && u.order.t === 'fortify') continue;
      const c = nearestOwnCity(G, pid, u.tile); if (!c) continue;
      if (g.dist(u.tile, c.tile) > 2) { const st = stagingTile(G, u, c.tile, 2); if (st >= 0) advanceToward(G, u, st); }
      else u.order = { t: 'fortify' };
    }
  }
  for (const u of units) if (u.ai) { u.ai.busy = false; if (u.hp >= 90) u.ai.healing = false; }
  // second pass: anyone who moved into range attacks
  targets = attackTargets(G, pid);
  for (const u of order) if (G.units.includes(u) && u.moves > 0 && targets.length) { const plan = aiBestAttack(G, u, targets); if (plan && plan.origin === u.tile) { doAttack(G, u, plan.tile); targets = attackTargets(G, pid); } }
}
function aiCityBombard(G, pid) {
  for (const c of G.cities) {
    if (c.owner !== pid) continue;
    const ts = cityTargets(G, c); if (!ts.length) continue;
    ts.sort((a, b) => a.hp - b.hp);
    cityBombard(G, c, ts[0].id);
  }
}

// ---- military production need ----
function aiMilitaryNeed(G, pid) {
  const cs = ownCities(G, pid), g = G._grid, P = G.players[pid];
  const atWarMajor = majorPlayers(G).some(Q => Q.id !== pid && atWar(G, pid, Q.id));
  const threat = enemiesOf(G, pid).filter(e => isMil(e) && cs.some(c => g.dist(c.tile, e.tile) <= 6)).length;
  const aggr = (AGGRESSION[civKey(P)] || 1) * (aiPlan(G, pid) === 'domination' ? 1.5 : 1);
  let need = Math.ceil(cs.length * (0.9 + 0.3 * aggr)) + 1 + (atWarMajor ? cs.length + 3 : 0) + Math.min(4, threat);
  if (G.camps.some(cp => cs.some(c => g.dist(c.tile, cp.tile) <= 8))) need += 1;
  if (faunaHostile(G, pid)) need += 1;
  const mil = G.units.filter(u => u.owner === pid && isMil(u));
  const by = cls => mil.filter(u => UNITS[u.type].cls === cls).length;
  if (P.aiw && P.aiw.sea) need += 2;
  return { need, have: mil.length, atWar: atWarMajor, sea: !!(P.aiw && P.aiw.sea), ranged: by('ranged'), melee: by('melee') + by('mounted'), siege: by('siege'), naval: mil.filter(u => UNITS[u.type].naval).length };
}
function aiMilitaryValue(G, c, key, mn, w) {
  const U = UNITS[key]; if (!isMil({ type: key })) return -1;
  const deficit = mn.need - mn.have;
  if (U.naval) {
    const coastal = ownCities(G, c.owner).filter(x => isCoastal(G.map, G._grid, x.tile)).length;
    const wantNavy = mn.sea ? 2 + Math.floor(mn.have / 5) : Math.ceil(coastal / 3);
    if ((!mn.atWar && !mn.sea) || !coastal || mn.naval >= wantNavy) return -1;
  } else if (deficit <= 0) return -1;
  const power = Math.max(U.str, (U.rstr || 0) * 1.05) * (U.moves > 2 ? 1.15 : 1);
  let v = power * 0.45 * (1 + Math.max(0, deficit) / Math.max(1, mn.need));
  const tot = Math.max(1, mn.have);
  if (U.cls === 'ranged') v *= mn.ranged / tot < 0.35 ? 1.4 : 0.9;
  if (U.cls === 'melee' || U.cls === 'mounted') v *= mn.melee / tot < 0.45 ? 1.3 : 0.95;
  if (U.cls === 'siege') v *= mn.atWar && mn.siege < 1 + Math.floor(mn.have / 6) ? 1.5 : 0.25;
  if (U.aff) v *= U.aff === aiAffinity(G, c.owner) ? 1.25 : 0.7;
  if (U.tier) v *= 1 + (U.tier - 1) * 0.15;
  return v;
}

// ---- native fauna ----
// Fauna roam near their nests. They hunt only factions that have angered them, or that come too close to a nest.
function faunaTargets(G, pid) {
  const vis = G.players[pid]._vis, out = [];
  for (const u of G.units) if (u.owner !== pid && vis[u.tile] && faunaHostile(G, u.owner, u.tile)) out.push(u.tile);
  for (const c of G.cities) if (c.owner !== pid && vis[c.tile] && faunaHostile(G, c.owner)) out.push(c.tile);
  return Array.from(new Set(out));
}
function barbarianTurn(G, pid) {
  const g = G._grid, rng = G._rng;
  for (const u of G.units.filter(x => x.owner === pid)) {
    if (!G.units.includes(u)) continue;
    const targets = faunaTargets(G, pid);
    const plan = aiBestAttack(G, u, targets);
    if (plan) { aiExecuteAttack(G, u, plan); continue; }
    if (canPillage(G, u) && faunaHostile(G, G.map.owner[u.tile])) { pillage(G, u); continue; }
    let goal = -1, gd = 7;
    for (const x of G.units) if (x.owner !== pid && G.players[pid]._vis[x.tile] && faunaHostile(G, x.owner, x.tile) && (UNITS[x.type].civilian || x.hp < 60)) { const d = g.dist(x.tile, u.tile); if (d < gd) { gd = d; goal = x.tile; } }
    if (goal < 0) for (const c of G.cities) if (faunaHostile(G, c.owner)) { const d = g.dist(c.tile, u.tile); if (d < gd) { gd = d; goal = c.tile; } }
    if (goal < 0) {
      const camp = G.camps.find(cp => cp.id === u.camp);
      const around = g.within(camp ? camp.tile : u.tile, UNITS[u.type].colossus ? 6 : 3).filter(t => passableFor(G, u, t) && !G._mil.has(t) && !G._cityAt.has(t));
      if (around.length) goal = around[rng.int(around.length)];
    }
    if (goal >= 0) {
      const tgt = G._cityAt.get(goal) || G._mil.get(goal) || G._civ.get(goal);
      if (tgt) { const st = stagingTile(G, u, goal, UNITS[u.type].ranged ? 2 : 1); if (st >= 0) advanceToward(G, u, st); }
      else advanceToward(G, u, goal);
      const p2 = aiBestAttack(G, u, faunaTargets(G, pid));
      if (p2 && p2.origin === u.tile) doAttack(G, u, p2.tile);
    }
  }
}

// Where can this unit stand to attack tile t this turn? Prefers keeping the most moves.
function attackPlanFor(G, u, t) {
  if (attackStatus(G, u, t).ok) return { origin: u.tile, tile: t };
  if (u.moves <= 0) return null;
  const home = u.tile, U = UNITS[u.type];
  let best = null, bs = -Infinity;
  for (const [o, left] of reachLeft(G, u)) {
    if (o === home || left <= 0 || ownOccupied(G, u, o)) continue;
    if (!U.naval && isWater(G, o)) continue;
    u.tile = o; const st = attackStatus(G, u, t); u.tile = home;
    if (!st.ok) continue;
    const s = left + (TERRAIN[G.map.terrain[o]].def || 0) / 5;
    if (s > bs) { bs = s; best = { origin: o, tile: t }; }
  }
  return best;
}
function previewFrom(G, u, plan) { const home = u.tile; u.tile = plan.origin; const pv = combatPreview(G, u, plan.tile); u.tile = home; return pv; }
HX.attackPlanFor = attackPlanFor; HX.previewFrom = previewFrom;
HX.offerPeace = (G, from, to) => { const ok = peaceAcceptable(G, from, to); if (ok.ok) makePeace(G, from, to); return ok; };
HX.acceptOffer = (G, idx, yes) => { const o = G.offers[idx]; return o ? answerOffer(G, o.id, yes) : false; };
