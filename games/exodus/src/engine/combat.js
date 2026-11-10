// ===== combat.js : war, battles, colonies under siege, promotions, upgrades, native fauna =====
function warKey(a, b) { return a < b ? a + '-' + b : b + '-' + a; }
function isBarb(G, pid) { return pid >= 0 && !!G.players[pid].barbarian; }
function atWar(G, a, b) {
  if (a === b || a < 0 || b < 0) return false;
  if (isBarb(G, a) || isBarb(G, b)) return true;
  return !!G.war[warKey(a, b)];
}
function majorPlayers(G) { return G.players.filter(P => !P.barbarian && !P.minor); }
function warStatus(G, a, b) {
  if (a === b || isBarb(G, a) || isBarb(G, b)) return { ok: false, why: 'Not possible.' };
  const A = G.players[a], B = G.players[b];
  if (!B.alive || !A.alive) return { ok: false, why: 'That faction is gone.' };
  if (!A.met.includes(b)) return { ok: false, why: 'You have not met them.' };
  if (atWar(G, a, b)) return { ok: false, why: 'Already at war.' };
  if (allied(G, a, b)) return { ok: false, why: 'You are allies. End the alliance first.' };
  const until = G.peace[warKey(a, b)];
  if (until && until > G.turn) return { ok: false, why: `A peace treaty holds until turn ${until}.` };
  return { ok: true };
}
function declareWar(G, a, b) {
  if (!warStatus(G, a, b).ok) return false;
  G.war[warKey(a, b)] = { since: G.turn, by: a, lost: {}, took: {} }; G._zocVer = (G._zocVer || 0) + 1;
  const A = CIVS[G.players[a].civ], B = CIVS[G.players[b].civ];
  for (const Q of G.players) if (Q.human && (Q.id === a || Q.id === b || Q.met.includes(a))) {
    logEvent(G, Q.id, Q.id === a ? `You declared war on the ${B.name}.` : Q.id === b ? `The ${A.name} declared war on you!` : `The ${A.name} declared war on the ${B.name}.`, -1);
  }
  onWarDeclared(G, a, b);
  for (const pid of [a, b]) computeVisibility(G, pid);
  return true;
}
function makePeace(G, a, b) {
  const k = warKey(a, b); if (!G.war[k]) return false;
  delete G.war[k]; G.peace[k] = G.turn + 10; G._zocVer = (G._zocVer || 0) + 1;
  onPeace(G, a, b);
  const A = CIVS[G.players[a].civ], B = CIVS[G.players[b].civ];
  for (const Q of G.players) if (Q.human && (Q.id === a || Q.id === b || Q.met.includes(a))) {
    logEvent(G, Q.id, Q.id === a || Q.id === b ? `Peace with the ${(Q.id === a ? B : A).name}. The treaty holds for 10 turns.` : `The ${A.name} and the ${B.name} made peace.`, -1);
  }
  return true;
}
// Military power: rough sum of unit strength, scaled by health.
function militaryPower(G, pid) {
  let s = 0;
  for (const u of G.units) if (u.owner === pid && UNITS[u.type].military && UNITS[u.type].cls !== 'recon') { const U = UNITS[u.type]; s += Math.max(U.str, U.rstr || 0) * (0.4 + 0.6 * u.hp / 100); }
  for (const c of G.cities) if (c.owner === pid) s += cityStrength(G, c) * 0.6;
  return s;
}
function warRecord(G, a, b) { return G.war[warKey(a, b)]; }
// Would AI 'to' accept peace offered by 'from'?
function peaceAcceptable(G, from, to) {
  const w = warRecord(G, from, to); if (!w) return { ok: false, why: 'You are not at war.' };
  const turns = G.turn - w.since;
  if (turns < 6) return { ok: false, why: 'They want this war to run a little longer.' };
  const mine = militaryPower(G, to), theirs = militaryPower(G, from);
  const tookFrom = (w.took[to] || 0) - (w.took[from] || 0); // cities 'to' gained minus cities 'from' gained
  if (tookFrom > 0 && turns < 25 && mine > theirs * 0.8) return { ok: false, why: 'They are winning and want more.' };
  if (mine < theirs * 1.15 || turns >= 30 || (w.lost[to] || 0) > (w.lost[from] || 0) + 1) return { ok: true };
  return { ok: false, why: 'They believe they can still win.' };
}

// ---- strengths ----
function promoFx(u) { const fx = {}; if (u.promos) for (const k of u.promos) for (const f in PROMO[k].fx) fx[f] = (fx[f] || 0) + PROMO[k].fx[f]; return fx; }
function isRough(G, t) { const k = G.map.terrain[t]; return k === T.HILLS || k === T.FOREST || k === T.MARSH; }
function isEmbarked(G, u) { return !UNITS[u.type].naval && isWater(G, u.tile); }
function wound(hp) { return 0.5 + hp / 200; }
function cityMaxHp(G, c) { let h = 160; for (const k of c.buildings) h += BUILDINGS[BLDI[k]].cityHp || 0; return h; }
function cityStrength(G, c) {
  const P = G.players[c.owner];
  let s = 6 + c.pop * 0.35 + playerEra(P) * 2 + (c.capital ? 2 : 0);
  for (const k of c.buildings) s += BUILDINGS[BLDI[k]].cityStr || 0;
  const g = G._mil.get(c.tile);
  if (g && g.owner === c.owner) s += UNITS[g.type].str * 0.3;
  s *= 1 + (polFx(P).cityStrPct || 0) / 100;
  return s;
}
function cityRange(G, c) { let r = 2; for (const k of c.buildings) r += BUILDINGS[BLDI[k]].cityRange || 0; return r; }
function unitRange(u) { return (UNITS[u.type].range || 0) + (promoFx(u).range || 0); }
function inOwnLand(G, u) { return G.map.owner[u.tile] === u.owner; }
function defenseOf(G, d, att, ranged) {
  const U = UNITS[d.type], fx = promoFx(d), mods = [];
  if (U.civilian) return { str: 0, mods };
  let base = U.str, pct = 0;
  if (isEmbarked(G, d)) { base = 5 + 3 * playerEra(G.players[d.owner]); mods.push('embarked'); }
  else if (!U.naval) {
    const ter = TERRAIN[G.map.terrain[d.tile]];
    if (ter.def && U.cls !== 'mounted' && U.cls !== 'siege') { pct += ter.def; mods.push(`${ter.name} ${ter.def > 0 ? '+' : ''}${ter.def}%`); }
    if (G.map.improv[d.tile] === IMPI.fort) { pct += 50; mods.push('Fort +50%'); }
    if (d.fortTurns >= 1 && d.order && d.order.t === 'fortify') { pct += 25; mods.push('Fortified +25%'); }
    const rough = isRough(G, d.tile);
    if (rough && fx.rough) pct += fx.rough; if (!rough && fx.open) pct += fx.open;
  }
  if (ranged && fx.vsRanged) { pct += fx.vsRanged; mods.push('Cover'); }
  if (att && UNITS[att.type].cls === 'mounted' && U.vsMounted) { pct += U.vsMounted; mods.push('vs mounted'); }
  if (att && UNITS[att.type].naval && U.naval && fx.vsNaval) pct += fx.vsNaval;
  const dfx = polFx(G.players[d.owner]);
  if (inOwnLand(G, d)) {
    if (dfx.homeCombat) { pct += dfx.homeCombat; mods.push(`Home ground +${dfx.homeCombat}%`); }
    if (U.homeDef) pct += U.homeDef;
  }
  if (att && UNITS[att.type].fauna) { const vf = (fx.vsFauna || 0) + (dfx.vsFaunaPct || 0); if (vf) { pct += vf; mods.push(`vs fauna +${vf}%`); } }
  if (G.sats && G.sats.length && satCovers(G, d.owner, 'sat_sentinel', d.tile)) { pct += 20; mods.push('Sentinel +20%'); }
  if (veilAt(G, d.tile) && (U.fauna || dfx.veilHealAll) && !U.naval) { pct += 10; mods.push('In the Veil +10%'); }
  pct += dfx.combatPct || 0;
  const gb = generalBonus(G, d); if (gb) { pct += gb; mods.push('Great General +15%'); }
  return { str: base * (1 + pct / 100) * wound(d.hp), mods };
}
function attackOf(G, a, tgt, ranged) {
  const U = UNITS[a.type], fx = promoFx(a), mods = [];
  let base = ranged ? U.rstr : U.str, pct = 0;
  if (tgt.city) {
    if (U.cls === 'siege') { pct += 100; mods.push('Siege +100%'); }
    if (fx.vsCity) pct += fx.vsCity;
  } else {
    const d = tgt.unit, DU = UNITS[d.type], rough = isRough(G, d.tile);
    if (U.cls === 'siege') { pct -= 25; mods.push('Siege vs units −25%'); }
    if (ranged) { if (rough && fx.roughR) pct += fx.roughR; if (!rough && fx.openR) pct += fx.openR; }
    else { if (rough && fx.rough) pct += fx.rough; if (!rough && fx.open) pct += fx.open; }
    if (DU.cls === 'mounted' && U.vsMounted) { pct += U.vsMounted; mods.push('vs mounted +' + U.vsMounted + '%'); }
    if (DU.naval && U.naval && fx.vsNaval) pct += fx.vsNaval;
    if (!ranged) {
      let flank = 0;
      for (const n of G._grid.neighbors(d.tile)) { const m = G._mil.get(n); if (m && m !== a && m.owner === a.owner && !isEmbarked(G, m)) flank++; }
      if (flank) { pct += Math.min(30, flank * 10); mods.push(`Flanking +${Math.min(30, flank * 10)}%`); }
    }
  }
  if (!ranged && !U.naval) { const dd = G._grid.dirTo(a.tile, tgt.tile); if (dd >= 0 && (G.map.river[a.tile] >> dd) & 1 && !(roadAt(G, a.tile) && roadAt(G, tgt.tile))) { pct -= 20; mods.push('Across glow-river −20%'); } }
  const afx = polFx(G.players[a.owner]);
  if (tgt.unit && UNITS[tgt.unit.type].fauna) { const vf = (fx.vsFauna || 0) + (afx.vsFaunaPct || 0); if (vf) { pct += vf; mods.push(`vs fauna +${vf}%`); } }
  if (afx.homeCombat && inOwnLand(G, a)) { pct += afx.homeCombat; mods.push(`Home ground +${afx.homeCombat}%`); }
  if (U.naval && afx.navalCombat) pct += afx.navalCombat;
  pct += afx.combatPct || 0;
  const gb = generalBonus(G, a); if (gb) { pct += gb; mods.push('Great General +15%'); }
  return { str: base * (1 + pct / 100) * wound(a.hp), mods };
}
function dmgFor(r) { return 30 * (Math.pow((r + 3) / 4, 4) + 1) / 2; }

// What is on a tile that unit a could attack? Returns null or { city } / { unit } / { civilian }.
function targetAt(G, a, t) {
  const c = G._cityAt.get(t);
  if (c && c.owner !== a.owner && atWar(G, a.owner, c.owner)) return { city: c, tile: t };
  const m = G._mil.get(t);
  if (m && m.owner !== a.owner && atWar(G, a.owner, m.owner)) return { unit: m, tile: t };
  const v = G._civ.get(t);
  if (v && v.owner !== a.owner && atWar(G, a.owner, v.owner) && !c) return { civilian: v, tile: t };
  return null;
}
function attackStatus(G, a, t) {
  const U = UNITS[a.type];
  if (!U.military || U.cls === 'recon') return { ok: false, why: 'This unit cannot attack.' };
  if (a.moves <= 0) return { ok: false, why: 'No moves left this turn.' };
  if (isEmbarked(G, a)) return { ok: false, why: 'Units cannot attack while embarked.' };
  if (!G.players[a.owner]._vis[t]) return { ok: false, why: 'You cannot see that tile.' };
  const tg = targetAt(G, a, t);
  if (!tg) {
    const any = G._cityAt.get(t) || G._mil.get(t) || G._civ.get(t);
    if (any && any.owner !== a.owner && !isBarb(G, any.owner)) return { ok: false, why: `You are at peace with the ${CIVS[G.players[any.owner].civ].name}.`, peace: any.owner };
    return { ok: false, why: 'Nothing to attack there.' };
  }
  const d = G._grid.dist(a.tile, t), water = isWater(G, t);
  if (U.ranged) {
    if (tg.civilian) return { ok: false, why: 'Ranged units cannot capture civilians.' };
    if (d > unitRange(a)) return { ok: false, why: 'Out of range.' };
    return { ok: true, tg, ranged: true };
  }
  if (d !== 1) return { ok: false, why: 'Melee units must be next to their target.' };
  if (U.naval && !water && !(tg.city && isCoastal(G.map, G._grid, t))) return { ok: false, why: 'Ships can only attack at sea or coastal colonies.' };
  if (!U.naval && water) return { ok: false, why: 'Land units cannot attack at sea.' };
  return { ok: true, tg, ranged: false };
}
function combatPreview(G, a, t) {
  const st = attackStatus(G, a, t); if (!st.ok) return st;
  const tg = st.tg;
  if (tg.civilian) return Object.assign({ capture: true, name: UNITS[tg.civilian.type].name }, st);
  const A = attackOf(G, a, tg, st.ranged);
  let D, name, hp;
  if (tg.city) { D = { str: cityStrength(G, tg.city), mods: [] }; name = tg.city.name; hp = tg.city.hp; }
  else { D = defenseOf(G, tg.unit, a, st.ranged); name = UNITS[tg.unit.type].name; hp = tg.unit.hp; }
  const r = A.str / Math.max(0.5, D.str);
  const toT = dmgFor(r), toA = st.ranged ? 0 : dmgFor(1 / r);
  return Object.assign(st, { name, atk: A, def: D, dmgToTarget: Math.round(toT), dmgToAttacker: Math.round(toA), targetHp: hp,
    kill: !tg.city && toT * 0.85 >= hp, capture: !!tg.city && !st.ranged && !UNITS[a.type].naval && toT * 0.85 >= hp, attackerDies: toA * 0.85 >= a.hp });
}

// ---- resolving an attack ----
function gainXp(G, u, n, vsBarb) { if (vsBarb && u.xp >= 45) return; u.xp = (u.xp || 0) + n; gainGeneralPoints(G, u.owner, n * (vsBarb ? 0.5 : 1)); }
// Fauna anger toward a faction: rises when it attacks fauna, fades when it leaves them alone.
function enrage(G, pid, n) { const P = G.players[pid]; if (!P || P.barbarian || P.minor) return; const fx = polFx(P); P.rage = Math.max(0, Math.min(100, (P.rage || 0) + n * (fx.faunaCalm ? 0.6 : 1))); }
function recordLoss(G, loser, winner) { const w = warRecord(G, loser, winner); if (w) w.lost[loser] = (w.lost[loser] || 0) + 1; }
function killUnit(G, u, by) {
  removeUnit(G, u); G._zocVer = (G._zocVer || 0) + 1;
  if (by >= 0) recordLoss(G, u.owner, by);
  if (by >= 0 && isBarb(G, u.owner) && !isBarb(G, by)) { const Q = G.players[by]; Q.stats.kills = (Q.stats.kills || 0) + 1; enrage(G, by, 3); if (Q.stats.kills === 1) offerStory(G, by, 'first_kill'); }
  if (G.players[u.owner].human) logEvent(G, u.owner, `Your ${UNITS[u.type].name} was destroyed${by >= 0 ? (isBarb(G, by) ? ' by native fauna' : ' by the ' + CIVS[G.players[by].civ].name) : ''}.`, u.tile);
  computeVisibility(G, u.owner);
}
function captureCivilian(G, a, v) {
  const t = v.tile, to = a.owner;
  removeUnit(G, v);
  if (G.players[v.owner].human) logEvent(G, v.owner, `Your ${UNITS[v.type].name} was captured.`, t);
  computeVisibility(G, v.owner);
  if (!isBarb(G, to) && (v.type === 'settler' || v.type === 'builder' || v.type === 'caravan')) {
    const nu = spawnUnit(G, v.type === 'settler' ? 'builder' : v.type, to, t); nu.moves = 0;
    if (nu.type === 'builder') nu.charges = Math.max(1, v.charges || 1);
  }
}
function moveAfterKill(G, a, t) {
  if (!passableFor(G, a, t) || G._mil.has(t)) return;
  const v = G._civ.get(t); if (v && v.owner !== a.owner) captureCivilian(G, a, v);
  if (G._civ.get(t) && G._civ.get(t).owner !== a.owner) return;
  const m = occMap(G, a); if (m.get(a.tile) === a) m.delete(a.tile);
  a.tile = t; m.set(t, a); G.players[a.owner].scouted[t] = 1;
  if (G.ruins && G.ruins.length && ruinAt(G, t)) enterRuin(G, a);
  if (G.camps.length) checkCampCapture(G, a);
}
function doAttack(G, a, t) {
  const pv = combatPreview(G, a, t); if (!pv.ok) return null;
  const from = a.tile, res = { from, to: t, ranged: pv.ranged, dmgT: 0, dmgA: 0, killedT: false, killedA: false, captured: false, moved: false };
  a.moves = 0; a.acted = true; a.fortTurns = 0; if (a.order) a.order = null;
  const P = G.players[a.owner], vsBarb = pv.tg.unit ? isBarb(G, pv.tg.unit.owner) : pv.tg.city ? false : isBarb(G, pv.tg.civilian.owner);
  if (vsBarb && !isBarb(G, a.owner)) enrage(G, a.owner, 2);
  if (pv.capture && pv.tg.civilian) {
    captureCivilian(G, a, pv.tg.civilian); moveAfterKill(G, a, t); res.moved = a.tile === t; res.captured = true;
    computeVisibility(G, a.owner); return res;
  }
  const rnd = () => 0.8 + G._rng.next() * 0.4;
  let toT = Math.round(pv.dmgToTarget * rnd()), toA = pv.ranged ? 0 : Math.round(pv.dmgToAttacker * rnd());
  res.dmgT = toT; res.dmgA = toA;
  if (pv.tg.city) {
    const c = pv.tg.city, def = c.owner;
    c.hp = Math.max(0, c.hp - toT); c.hitTurn = G.turn;
    a.hp -= toA; gainXp(G, a, 3, false);
    if (G.players[def].human) logEvent(G, def, `${c.name} is under attack (${c.hp} health left).`, c.tile);
    if (a.hp <= 0) { a.hp = 0; killUnit(G, a, def); res.killedA = true; }
    else if (c.hp <= 0 && !pv.ranged && !UNITS[a.type].naval) {
      if (isBarb(G, a.owner)) { c.hp = 1; const loot = Math.min(G.players[def].gold, 30); G.players[def].gold -= loot; c.food = Math.max(0, c.food - 10); if (G.players[def].human) logEvent(G, def, `Fauna rampaged through ${c.name}: ${loot} credits of supplies were lost.`, c.tile); }
      else { const gm = G._mil.get(c.tile); if (gm && gm.owner === def) killUnit(G, gm, a.owner); captureCity(G, c, a.owner); moveAfterKill(G, a, t); res.captured = true; res.moved = a.tile === t; }
    } else if (c.hp <= 0) c.hp = 1;
  } else {
    const d = pv.tg.unit;
    d.hp -= toT; a.hp -= toA;
    gainXp(G, a, pv.ranged ? 3 : 5, vsBarb); if (d.hp > 0) gainXp(G, d, 3, isBarb(G, a.owner));
    d.fortTurns = d.fortTurns || 0;
    if (G.players[d.owner].human && d.hp > 0) logEvent(G, d.owner, `Your ${UNITS[d.type].name} was attacked by ${isBarb(G, a.owner) ? 'a wild' : 'a ' + CIVS[P.civ].adj} ${UNITS[a.type].name} (−${toT}).`, d.tile);
    if (d.hp <= 0) {
      res.killedT = true; gainXp(G, a, 2, vsBarb);
      if (UNITS[a.type].goldOnKill) { const g = Math.round(UNITS[d.type].cost * 0.3); P.gold += g; }
      killUnit(G, d, a.owner);
    }
    if (a.hp <= 0) { a.hp = 0; res.killedA = true; killUnit(G, a, d.owner); }
    else if (res.killedT && !pv.ranged) { moveAfterKill(G, a, t); res.moved = a.tile === t; }
  }
  if (P.human && !res.killedA) logEvent(G, a.owner, `${UNITS[a.type].name} hit ${pv.name} for ${toT}` + (res.killedT ? ', destroying it.' : res.captured ? ` and captured ${pv.name}!` : '.') + (toA ? ` It took ${toA} damage.` : ''), t);
  computeVisibility(G, a.owner);
  return res;
}

// ---- cities: capture, bombard, elimination ----
function captureCity(G, c, by) {
  const old = c.owner, A = G.players[by];
  const w = warRecord(G, by, old); if (w) w.took[by] = (w.took[by] || 0) + 1;
  c.owner = by;
  c.pop = Math.max(1, Math.ceil(c.pop * 0.75)); c.food = 0; c.prod = 0; c.build = null; c.queue = []; c.locked = []; c.forcedSpec = 0;
  const wasCap = c.capital;
  const lostProj = c.buildings.filter(k => isProject(k));
  c.buildings = c.buildings.filter(k => k !== 'palace' && !isProject(k)); c.capital = false;
  for (const k of lostProj) for (const Q of G.players) if (Q.human) logEvent(G, Q.id, `${BUILDINGS[BLDI[k]].name} in ${c.name} was destroyed when the colony fell.`, c.tile);
  if (c.origCap === by || !G.cities.some(x => x.owner === by && x.capital)) { c.capital = true; c.buildings.push('palace'); }
  c.hp = Math.round(cityMaxHp(G, c) * 0.5); c.unrest = Math.max(2, Math.ceil(c.pop / 2));
  for (const t of c.tiles) G.map.owner[t] = by;
  G.routes = G.routes.filter(r => r.from !== c.id && r.to !== c.id);
  if (wasCap) { const rest = ownCities(G, old).sort((a, b) => b.pop - a.pop); if (rest.length) { rest[0].capital = true; if (!rest[0].buildings.includes('palace')) rest[0].buildings.push('palace'); } }
  for (const Q of G.players) {
    if (!Q.human) continue;
    if (Q.id === by) logEvent(G, Q.id, `You captured ${c.name}!`, c.tile);
    else if (Q.id === old) { /* below */ }
    else if (Q.id === old) logEvent(G, Q.id, `${c.name} has fallen to the ${CIVS[A.civ].name}!`, c.tile);
    else if (Q.met.includes(by) && Q.explored[c.tile]) logEvent(G, Q.id, `The ${CIVS[A.civ].name} captured ${c.name}.`, c.tile);
  }
  for (const x of ownCities(G, by)) assignWorkers(G, x);
  for (const x of ownCities(G, old)) assignWorkers(G, x);
  refreshWonders(G);
  computeVisibility(G, by); computeVisibility(G, old);
  checkElimination(G, old);
}
function checkElimination(G, pid) {
  const P = G.players[pid];
  if (!P.alive || P.barbarian) return;
  if (G.cities.some(c => c.owner === pid) || G.units.some(u => u.owner === pid && u.type === 'settler')) return;
  P.alive = false;
  for (const u of G.units.filter(x => x.owner === pid)) removeUnit(G, u);
  for (const k of Object.keys(G.war)) { const [a, b] = k.split('-').map(Number); if (a === pid || b === pid) delete G.war[k]; }
  for (const Q of G.players) if (Q.human) logEvent(G, Q.id, Q.id === pid ? 'Your faction has fallen.' : `The ${CIVS[P.civ].name} have been destroyed.`, -1);
}
function cityTargets(G, c) {
  if (c.firedTurn === G.turn || c.hp <= 0 || (c.unrest || 0) > 0) return [];
  const out = [], vis = G.players[c.owner]._vis;
  for (const t of G._grid.within(c.tile, cityRange(G, c))) {
    const m = G._mil.get(t); if (m && vis[t] && atWar(G, c.owner, m.owner)) out.push(m);
  }
  return out;
}
function cityBombard(G, c, unitId) {
  const d = cityTargets(G, c).find(u => u.id === unitId); if (!d) return null;
  const A = cityStrength(G, c) * 0.9, D = defenseOf(G, d, null, true).str;
  const dmg = Math.round(dmgFor(A / Math.max(0.5, D)) * (0.8 + G._rng.next() * 0.4));
  c.firedTurn = G.turn; d.hp -= dmg;
  const killed = d.hp <= 0;
  if (G.players[d.owner].human) logEvent(G, d.owner, `${c.name} fired on your ${UNITS[d.type].name} (−${dmg}).`, d.tile);
  if (killed) killUnit(G, d, c.owner);
  return { from: c.tile, to: d.tile, dmgT: dmg, killedT: killed, ranged: true };
}

// ---- healing, promotions, upgrades, pillage ----
function healAndRecover(G, pid) {
  const P = G.players[pid], fx = polFx(P), burned = [];
  for (const u of G.units.slice()) {
    if (u.owner !== pid) continue;
    const U = UNITS[u.type], inVeil = veilAt(G, u.tile);
    if (U.orbital) continue;
    const vd = veilDamage(G, u);
    if (vd) { u.hp = Math.max(1, u.hp - vd); u.acted = true; burned.push(u); }
    if (!u.acted && u.hp < 100 && !isEmbarked(G, u)) {
      const c = G._cityAt.get(u.tile), o = G.map.owner[u.tile];
      let hgain = c && c.owner === pid ? 25 : o === pid ? 15 : o < 0 ? 10 : 5;
      if (promoFx(u).heal) hgain += 10;
      hgain += (U.healBonus || 0) + (fx.healAll || 0);
      if (inVeil) hgain += (U.veilHeal || 0) + (fx.veilHealAll || 0) + (U.fauna ? 10 : 0);
      if (G.sats && G.sats.length && satCovers(G, pid, 'sat_seeder', u.tile)) hgain += 10;
      for (const n of G._grid.neighbors(u.tile)) { const m = G._mil.get(n); if (m && m.owner === pid && promoFx(m).heal) { hgain += 10; break; } }
      u.hp = Math.min(100, u.hp + hgain);
    }
    if (U.recon) restockExplorer(G, u);
    if (!u.acted && u.order && u.order.t === 'fortify') u.fortTurns = (u.fortTurns || 0) + 1;
    if (u.order && u.order.t === 'heal' && u.hp >= 100) u.order = null;
    u.acted = false;
  }
  if (burned.length && P.human) {
    const n = burned.length, one = burned[0];
    logEvent(G, pid, n === 1 ? `🌫️ The Veil burned your ${UNITS[one.type].name} (${one.hp} health left). Move it out, scour the Veil with a Rigger, or grow Communion.`
      : `🌫️ The Veil burned ${n} of your units. Move them out, scour the Veil with Riggers, or grow Communion.`, one.tile);
  }
  for (const c of G.cities) {
    if (c.owner !== pid) continue;
    const mx = cityMaxHp(G, c);
    if (c.hp < mx && c.hitTurn !== G.turn && c.hitTurn !== G.turn - 1) c.hp = Math.min(mx, c.hp + 15);
    if (c.unrest > 0) c.unrest--;
  }
  if (!P.barbarian && !P.minor) P.rage = Math.max(0, (P.rage || 0) - (1 + (fx.rageDecay || 0) + (fx.faunaCalm ? 1 : 0)) * (G.turn % 2 ? 1 : 0));
}
function promoChoices(G, u) {
  const U = UNITS[u.type]; if (!U.military) return [];
  const n = (u.promos || []).length; if ((u.xp || 0) < XP_STEPS[Math.min(n, XP_STEPS.length - 1)]) return [];
  return PROMOS.filter(p => p.cls.includes(U.cls) && !u.promos.includes(p.key) &&
    (!p.req.length || p.req.some(r => r === 'any' ? u.promos.length > 0 : u.promos.includes(r)))).map(p => p.key);
}
function promote(G, u, key) {
  if (!promoChoices(G, u).includes(key)) return false;
  u.promos.push(key); u.hp = Math.min(100, u.hp + 15);
  return true;
}
function unitBuildable(G, pid, key) {
  const U = UNITS[key], P = G.players[pid];
  if (U.tech && !hasTech(P, U.tech)) return false;
  if (U.civ && U.civ !== CIVS[P.civ].key) return false;
  return true;
}
// Strategic resources: each improved source supports two units that need it.
function resourceRoom(G, pid, res) {
  const have = strategicCounts(G, pid)[res] * 2;
  let used = 0;
  for (const u of G.units) if (u.owner === pid && UNITS[u.type].res === res) used++;
  for (const c of G.cities) if (c.owner === pid && c.build && c.build.k === 'u' && UNITS[c.build.key].res === res) used++;
  return { have, used, free: have - used };
}
// Upgrade options for a unit: the next tier of its line, one per affinity the faction has reached.
function upgradeOptions(G, u) {
  const U = UNITS[u.type]; if (!U.line || U.tier >= 3) return [];
  const P = G.players[u.owner], L = LINES[U.line], next = U.tier === 1 ? L.t2 : L.t3;
  const affs = U.tier === 1 ? AFF_KEYS : [U.aff];
  const out = [];
  for (const a of affs) {
    const to = next[a], T2 = UNITS[to];
    const cost = Math.round(((T2.cost - U.cost) * 1.5 + 20) * paceOf(G));
    let why = null;
    if (!hasTech(P, T2.tech)) why = `Needs ${TECHS[TECHI[T2.tech]].name}.`;
    else if (affLevel(P, a) < T2.affLvl) why = `Needs ${AFFINITIES[AFFI[a]].name} ${T2.affLvl}.`;
    else if (T2.res && T2.res !== U.res && resourceRoom(G, u.owner, T2.res).free < 1) why = `Needs a spare ${RES[RESI[T2.res]].name}.`;
    else if (!inOwnLand(G, u)) why = 'Upgrade inside your own territory.';
    else if (u.moves <= 0) why = 'No moves left this turn.';
    else if (P.gold < cost) why = `Costs ${cost} credits.`;
    out.push({ to, aff: a, cost, ok: !why, why, visible: hasTech(P, T2.tech) && affLevel(P, a) >= T2.affLvl });
  }
  return out;
}
// The best option (for badges and the AI): its own primary affinity first.
function upgradeInfo(G, u) {
  const opts = upgradeOptions(G, u).filter(o => o.visible); if (!opts.length) return null;
  const pa = primaryAff(G.players[u.owner]);
  return opts.find(o => o.ok && o.aff === pa) || opts.find(o => o.ok) || opts[0];
}
function upgradeUnit(G, u, to) {
  const opts = upgradeOptions(G, u), inf = to ? opts.find(o => o.to === to) : upgradeInfo(G, u);
  if (!inf || !inf.ok) return false;
  G.players[u.owner].gold -= inf.cost;
  u.type = inf.to; u.moves = 0; u.acted = true;
  u.promos = u.promos.filter(k => PROMO[k].cls.includes(UNITS[u.type].cls));
  return true;
}
function canPillage(G, u) {
  const U = UNITS[u.type], t = u.tile;
  if (!U.military || U.naval || U.cls === 'recon' || isEmbarked(G, u) || u.moves <= 0) return false;
  const o = G.map.owner[t];
  return !!G.map.improv[t] && o >= 0 && o !== u.owner && atWar(G, u.owner, o);
}
function pillage(G, u) {
  if (!canPillage(G, u)) return false;
  const t = u.tile, o = G.map.owner[t], name = IMPROV[G.map.improv[t]].name;
  G.map.improv[t] = 0; u.moves = Math.max(0, u.moves - MP); u.acted = true; u.hp = Math.min(100, u.hp + 25);
  if (!isBarb(G, u.owner)) G.players[u.owner].gold += Math.round(15 * paceOf(G));
  if (G.players[o].human) logEvent(G, o, `${isBarb(G, u.owner) ? 'A wild' : 'A ' + CIVS[G.players[u.owner].civ].adj} ${UNITS[u.type].name} wrecked your ${name}.`, t);
  const c = cityById(G, G.map.ocity[t]); if (c) assignWorkers(G, c);
  return true;
}
function militaryXpBonus(G, c, key) {
  const U = UNITS[key]; if (!U.military) return 0;
  let xp = polFx(G.players[c.owner]).xp || 0;
  if (!U.naval) { if (c.buildings.includes('barracks')) xp += 15; if (c.buildings.includes('armory')) xp += 15; }
  return xp;
}

// ---- barbarians ----
function barbPid(G) { return G.players.findIndex(P => P.barbarian); }
function campAt(G, t) { return G.camps.find(c => c.tile === t); }
function checkCampCapture(G, u) {
  const camp = campAt(G, u.tile); if (!camp || isBarb(G, u.owner) || UNITS[u.type].fauna) return;
  G.camps.splice(G.camps.indexOf(camp), 1);
  const P = G.players[u.owner], reward = Math.round((camp.hoard ? 60 : 30) * paceOf(G));
  P.gold += reward; P.stats.camps = (P.stats.camps || 0) + 1;
  enrage(G, u.owner, 12);
  gainXp(G, u, camp.hoard ? 10 : 5, false);
  for (const x of G.units) if (x.camp === camp.id) x.camp = undefined;
  if (P.human) logEvent(G, u.owner, `Fauna nest destroyed. +${reward} credits in salvaged biomass. The wild remembers.`, u.tile);
  if (camp.hoard && !P.minor) { const pool = relicsLeft(G, u.owner, true); if (pool.length) grantRelic(G, u.owner, pool[(camp.id * 7 + G.turn) % pool.length].key, 'from an ancient nest'); }
}
// Will wild fauna hunt this faction's units? Anger, Communion and the nests decide.
function faunaHostile(G, pid, tile) {
  const P = G.players[pid]; if (!P || P.barbarian) return false;
  if (P.minor) return (G.turn % 7) === 0;
  const fx = polFx(P), rage = P.rage || 0;
  if (fx.faunaPeace) return rage >= 90;
  const restless = G.cfg.barbarians === 'raging' ? 15 : 0;
  if (rage >= (fx.faunaCalm ? 60 : 40) - restless) return true;
  if (tile !== undefined && !fx.faunaCalm && rage >= 10 && G.camps.some(c => G._grid.dist(c.tile, tile) <= 2)) return true; // territorial
  return false;
}
function barbarianRound(G) {
  if (G.cfg.barbarians === 'off') return;
  const B = barbPid(G); if (B < 0) return;
  const raging = G.cfg.barbarians === 'raging', g = G._grid, m = G.map, rng = G._rng;
  const max = Math.round((CAMP_MAX[G.cfg.size] || 8) * (raging ? 1.4 : 1));
  // new nests hatch out of sight; once the land is watched everywhere, deep in the Veil far from colonies
  const few = G.camps.length < max / 2;
  if (G.turn >= 10 && G.turn % (raging ? 5 : few ? 5 : 8) === 0 && G.camps.length < max) {
    const seen = new Uint8Array(g.N);
    for (const P of G.players) if (!P.barbarian && P.alive) for (let i = 0; i < g.N; i++) if (P._vis[i]) seen[i] = 1;
    let cands = [];
    const ok = (i, near) => passableTerrain(G, i) && m.owner[i] < 0 && !G._mil.has(i) && !G._civ.has(i) && !G.sites.some(x => x.tile === i)
      && !G.cities.some(c => g.dist(c.tile, i) < near) && !G.camps.some(c => g.dist(c.tile, i) < 5);
    for (let i = 0; i < g.N; i++) if (!seen[i] && ok(i, 5)) cands.push(i);
    if (!cands.length) for (let i = 0; i < g.N; i++) if (m.veil[i] && ok(i, 4)) cands.push(i);
    if (cands.length) { const t = cands[rng.int(cands.length)], id = G.nextId++; G.camps.push({ id, tile: t, timer: 2, hoard: ((id * 2654435761) >>> 0) % 100 < 25 }); m.veil[t] = 1; }
  }
  const era = Math.min(4, Math.max(0, ...majorPlayers(G).filter(P => P.alive).map(P => playerEra(P))));
  for (const camp of G.camps) {
    if (--camp.timer > 0) continue;
    camp.timer = (raging ? 7 : 10) + rng.int(4);
    const kids = G.units.filter(u => u.owner === B && u.camp === camp.id);
    if (kids.length >= (raging ? 3 : 2) + (camp.hoard ? 1 : 0)) continue;
    // sea nests send Tidewyrms; old nests late in the game may wake a Titanoth
    const sea = g.neighbors(camp.tile).find(t => isWater(G, t) && !G._mil.has(t));
    let type;
    if (sea !== undefined && rng.chance(0.3) && G.turn > 30) type = 'tidewyrm';
    else if (camp.hoard && G.turn > 110 && rng.chance(0.25) && !G.units.some(u => u.type === 'titanoth' && u.camp === camp.id)) type = 'titanoth';
    else { const pool = BARB_UNITS[Math.max(0, Math.min(4, era - 1 + (raging ? 1 : 0)))]; type = pool[rng.int(pool.length)]; }
    const spot = type === 'tidewyrm' ? sea : [camp.tile].concat(g.neighbors(camp.tile)).find(t => passableTerrain(G, t) && !G._mil.has(t) && !G._cityAt.has(t));
    if (spot === undefined) continue;
    const u = spawnUnit(G, type, B, spot); u.camp = camp.id;
  }
  computeVisibility(G, B);
}
// Communion can calm a wild beast and bring it into the colony's service.
function tameStatus(G, u) {
  const P = G.players[u.owner], fx = polFx(P);
  if (!fx.tame || !hasTech(P, 'fauna_ethology') || u.moves <= 0) return null;
  const B = barbPid(G);
  const t = G._grid.neighbors(u.tile).find(n => { const m = G._mil.get(n); return m && m.owner === B && (!UNITS[m.type].colossus || affLevel(P, 'communion') >= 7); });
  if (t === undefined) return null;
  const beast = G._mil.get(t), cost = Math.round((20 + UNITS[beast.type].cost * 0.6) * paceOf(G));
  return { beast, cost, ok: P.gold >= cost, why: P.gold >= cost ? '' : `Costs ${cost} credits.` };
}
function tameFauna(G, u) {
  const st = tameStatus(G, u); if (!st || !st.ok) return false;
  const P = G.players[u.owner], b = st.beast;
  P.gold -= st.cost; b.owner = u.owner; b.camp = undefined; b.moves = 0; b.order = null; b.acted = true;
  u.moves = 0; u.acted = true; P.stats.tamed = (P.stats.tamed || 0) + 1;
  gainAff(G, u.owner, 'communion', 4, 'taming');
  G._zocVer = (G._zocVer || 0) + 1;
  if (P.human) logEvent(G, u.owner, `A wild ${UNITS[b.type].name} has been tamed and joins you.`, b.tile);
  computeVisibility(G, u.owner);
  return true;
}

Object.assign(HX, {
  atWar, warStatus, declareWar, makePeace, peaceAcceptable, militaryPower, combatPreview, attackStatus, doAttack, targetAt,
  cityStrength, cityMaxHp, cityTargets, cityBombard, cityRange, unitRange, promoChoices, promote, upgradeInfo, upgradeUnit, upgradeOptions, tameStatus, tameFauna, faunaHostile,
  canPillage, pillage, isEmbarked, resourceRoom, unitBuildable, campAt, majorPlayers, isBarb, defenseOf, warRecord, unitFor,
});
