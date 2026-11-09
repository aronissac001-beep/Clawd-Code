// ===== aiwar.js : military AI, war decisions, barbarians =====
const AGGRESSION = { aurelian: 0.75, thornwall: 1.0, sunreach: 1.35, meridian: 0.65, verdant: 0.7, emberforge: 1.15 };

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
  const up = upgradeInfo(G, u);
  if (up && up.ok && P.gold - up.cost > 80) upgradeUnit(G, u);
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
    if (turns >= 8 && (losing || turns > 40)) {
      if (!Q.human) { if (peaceAcceptable(G, pid, Q.id).ok) makePeace(G, pid, Q.id); }
      else if (!G.offers.some(o => o.from === pid && o.to === Q.id)) {
        G.offers.push({ from: pid, to: Q.id, turn: G.turn });
        logEvent(G, Q.id, `The ${CIVS[P.civ].name} offer peace. Open Rivals from the menu to answer.`, -1);
      }
    }
  }
  if (G.turn < 35 || majorPlayers(G).some(Q => Q.id !== pid && atWar(G, pid, Q.id))) return;
  const aggr = AGGRESSION[civKey(P)] || 1, mine = ownCities(G, pid);
  let best = null, bs = 0;
  for (const Q of majorPlayers(G)) {
    if (Q.id === pid || !warStatus(G, pid, Q.id).ok) continue;
    const theirCities = G.cities.filter(c => c.owner === Q.id && P.seen[c.tile]);
    const close = theirCities.some(c => mine.some(m => G._grid.dist(m.tile, c.tile) <= 12 && (landComponentOf(G, m.tile) === landComponentOf(G, c.tile) || hasTech(P, 'compass'))));
    if (!close) continue;
    let s = me / (militaryPower(G, Q.id) + 1) * aggr;
    if (Q.human) s *= [0.6, 1, 1.15, 1.3][G.cfg.difficulty] || 1;
    if (s > bs) { bs = s; best = Q.id; }
  }
  if (best !== null && bs > 1.3 && G._rng.chance(0.3)) declareWar(G, pid, best);
}
function aiChooseTarget(G, pid) {
  const P = G.players[pid], mine = ownCities(G, pid);
  let best = null, bs = Infinity;
  for (const c of G.cities) {
    if (c.owner === pid || !atWar(G, pid, c.owner) || isBarb(G, c.owner) || !P.seen[c.tile]) continue;
    let d = Infinity, rally = null;
    for (const m of mine) { const dd = G._grid.dist(m.tile, c.tile); if (dd < d) { d = dd; rally = m; } }
    if (!rally) continue;
    const sameLand = landComponentOf(G, rally.tile) === landComponentOf(G, c.tile);
    if (!sameLand && !hasTech(P, 'sailing')) continue;
    const s = d + cityStrength(G, c) / 4 + c.hp / 40 + (sameLand ? 0 : 6);
    if (s < bs) { bs = s; best = { city: c.id, rally: rally.id }; }
  }
  return best;
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
    const t = aiChooseTarget(G, pid); P.aiw = t ? { city: t.city, rally: t.rally, phase: 'gather', since: G.turn } : null;
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
  // camps near home
  for (const camp of G.camps) {
    if (!cities.some(c => g.dist(c.tile, camp.tile) <= 9) || !P.explored[camp.tile]) continue;
    const hunters = healthy.filter(u => !u.ai || !u.ai.busy).sort((a, b) => g.dist(a.tile, camp.tile) - g.dist(b.tile, camp.tile)).slice(0, 2);
    for (const u of hunters) { u.ai = Object.assign(u.ai || {}, { busy: true }); u.order = null; advanceToward(G, u, camp.tile); }
  }
  // army toward the war target
  const army = healthy.filter(u => G.units.includes(u) && u.moves > 0 && !(u.ai && u.ai.busy));
  if (P.aiw) {
    const tc = cityById(G, P.aiw.city), rally = cityById(G, P.aiw.rally) || nearestOwnCity(G, pid, tc.tile);
    if (rally) {
      const near = army.filter(u => g.dist(u.tile, rally.tile) <= 3).length;
      const need = Math.max(3, Math.round(cityStrength(G, tc) / 8));
      if (P.aiw.phase === 'gather' && (near >= need || G.turn - P.aiw.since > 18)) P.aiw.phase = 'attack';
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
  const aggr = AGGRESSION[civKey(P)] || 1;
  let need = Math.ceil(cs.length * (0.9 + 0.3 * aggr)) + 1 + (atWarMajor ? cs.length + 3 : 0) + Math.min(4, threat);
  if (G.camps.some(cp => cs.some(c => g.dist(c.tile, cp.tile) <= 9))) need += 1;
  const mil = G.units.filter(u => u.owner === pid && isMil(u));
  const by = cls => mil.filter(u => UNITS[u.type].cls === cls).length;
  return { need, have: mil.length, atWar: atWarMajor, ranged: by('ranged'), melee: by('melee') + by('mounted'), siege: by('siege'), naval: mil.filter(u => UNITS[u.type].naval).length };
}
function aiMilitaryValue(G, c, key, mn, w) {
  const U = UNITS[key]; if (!isMil({ type: key })) return -1;
  const deficit = mn.need - mn.have;
  if (U.naval) {
    const coastal = ownCities(G, c.owner).filter(x => isCoastal(G.map, G._grid, x.tile)).length;
    if (!mn.atWar || mn.naval >= Math.ceil(coastal / 3)) return -1;
  } else if (deficit <= 0) return -1;
  const power = Math.max(U.str, (U.rstr || 0) * 1.05) * (U.moves > 2 ? 1.15 : 1);
  let v = power * 0.45 * (1 + Math.max(0, deficit) / Math.max(1, mn.need));
  const tot = Math.max(1, mn.have);
  if (U.cls === 'ranged') v *= mn.ranged / tot < 0.35 ? 1.4 : 0.9;
  if (U.cls === 'melee' || U.cls === 'mounted') v *= mn.melee / tot < 0.45 ? 1.3 : 0.95;
  if (U.cls === 'siege') v *= mn.atWar && mn.siege < 1 + Math.floor(mn.have / 6) ? 1.5 : 0.25;
  if (U.cls === 'mounted' && civKey(G.players[c.owner]) === 'sunreach') v *= 1.3;
  return v;
}

// ---- barbarians ----
function barbarianTurn(G, pid) {
  const g = G._grid, rng = G._rng;
  for (const u of G.units.filter(x => x.owner === pid)) {
    if (!G.units.includes(u)) continue;
    const targets = attackTargets(G, pid);
    const plan = aiBestAttack(G, u, targets);
    if (plan) { aiExecuteAttack(G, u, plan); continue; }
    if (canPillage(G, u)) { pillage(G, u); continue; }
    // move toward something worth raiding
    let goal = -1, gd = 8;
    for (const x of G.units) if (x.owner !== pid && G.players[pid]._vis[x.tile] && (UNITS[x.type].civilian || x.hp < 60)) { const d = g.dist(x.tile, u.tile); if (d < gd) { gd = d; goal = x.tile; } }
    if (goal < 0) for (const c of G.cities) { const d = g.dist(c.tile, u.tile); if (d < gd) { gd = d; goal = c.tile; } }
    if (goal < 0) {
      const camp = G.camps.find(cp => cp.id === u.camp);
      const around = g.within(camp ? camp.tile : u.tile, 4).filter(t => passableTerrain(G, t) && !G._mil.has(t));
      if (around.length) goal = around[rng.int(around.length)];
    }
    if (goal >= 0) {
      const tgt = G._cityAt.get(goal) || G._mil.get(goal) || G._civ.get(goal);
      if (tgt) { const st = stagingTile(G, u, goal, UNITS[u.type].ranged ? 2 : 1); if (st >= 0) advanceToward(G, u, st); }
      else advanceToward(G, u, goal);
      const p2 = aiBestAttack(G, u, attackTargets(G, pid));
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
HX.acceptOffer = (G, idx, yes) => { const o = G.offers[idx]; if (!o) return false; G.offers.splice(idx, 1); if (yes && atWar(G, o.from, o.to)) makePeace(G, o.from, o.to); return true; };
