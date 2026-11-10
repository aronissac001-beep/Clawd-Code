// ===== ai.js : AI empires (economy, expansion, research, military, diplomacy, war and peace) =====
function persona(e) { return PERSONAS[e.persona] || PERSONAS.mercantile; }
function aiPickTech(G, e, stream) {
  const r = e.research[stream]; if (!r.opts.length) drawOptions(G, e, stream);
  const opts = r.opts;
  let best = opts[0], bw = -1;
  for (const id of opts) {
    const t = techInfo(id);
    let w = t.rep ? 1 : techWeight(G, e, t) * (0.7 + rnd(G) * 0.6);
    if (t.un && t.un.flag === 'beacons') w *= 3;
    if (t.un && t.un.sb && ownedSystems(G, e).length > 6) w *= 1.4;
    if (t.un && t.un.hull) w *= 1.5;
    if (w > bw) { bw = w; best = id; }
  }
  return best;
}
SW.aiPickTech = aiPickTech;
function atWarAny(G, e) { return G.wars.some(w => w.att.includes(e.id) || w.def.includes(e.id)); }
function enemiesOf(G, e) { const s = new Set(); for (const w of G.wars) { if (w.att.includes(e.id)) w.def.forEach(x => s.add(x)); if (w.def.includes(e.id)) w.att.forEach(x => s.add(x)); } return Array.from(s); }
SW.enemiesOf = enemiesOf;
function capSys(G, e) { const p = G.planets[e.capital]; return p ? p.sys : (ownedSystems(G, e)[0] ?? -1); }

function aiMonthly(G, e) {
  const P = persona(e), A = e.ai_ = e.ai_ || {};
  const net = empireEcon(G, e).net;
  // traditions
  if (e.res.unity >= tradCost(G, e)) {
    const prefs = { expansionist: ['expanse', 'prosperity', 'discovery'], militarist: ['dominion', 'bastion', 'prosperity'], scholarly: ['discovery', 'harmony', 'prosperity'], mercantile: ['prosperity', 'harmony', 'expanse'], isolationist: ['bastion', 'discovery', 'prosperity'], zealot: ['harmony', 'dominion', 'expanse'] }[e.persona] || TRADITION_KEYS;
    const open = TRADITION_KEYS.filter(k => e.trads[k] && e.trads[k] <= TRADITIONS[k].nodes.length);
    const pick = open[0] || prefs.find(k => !e.trads[k]) || TRADITION_KEYS.find(k => !e.trads[k]);
    if (pick) takeTradition(G, e, pick);
  }
  if (legacyOpen(e) && e.res.unity >= legacyCost(G, e)) takeLegacy(G, e);
  // edicts
  if (e.res.influence > 160 && activeEdicts(G, e).length < edictSlots(G, e)) {
    const prefs = { expansionist: ['colonial_fervor', 'mining_drive'], militarist: ['forge_quotas', 'fleet_drills'], scholarly: ['research_push', 'civic_drive'], mercantile: ['power_surge', 'mining_drive'], isolationist: ['research_push', 'festival'], zealot: ['civic_drive', 'call_to_arms'] }[e.persona] || ['mining_drive'];
    const extra = Object.keys(EDICTS);
    for (const k of prefs.concat(extra)) if (!canEdict(G, e, k)) { enactEdict(G, e, k); break; }
  }
  // stability emergencies
  for (const p of colonies(G, e)) if ((p.col.stab || 50) < 30 && e.res.influence > 80 && !canEdict(G, e, 'festival')) { enactEdict(G, e, 'festival'); break; }
  aiMarket(G, e);
  aiStarbases(G, e);
  aiShipyard(G, e);
  aiDiplomacy(G, e);
}

function aiMarket(G, e) {
  const net = empireEcon(G, e).net;
  const keepE = 400 + Math.max(0, -(net.energy || 0)) * 12;
  if ((net.food || 0) < 0 && e.res.food < 150 && e.res.energy > keepE) marketTrade(G, e, 'food', 100, true);
  if ((net.goods || 0) < 0 && e.res.goods < 100 && e.res.energy > keepE) marketTrade(G, e, 'goods', 50, true);
  if (e.res.minerals < 250 && e.res.energy > keepE + 300) marketTrade(G, e, 'minerals', 200, true);
  for (const r of ['minerals', 'food', 'goods']) { const lim = r === 'minerals' ? 4000 : 2500; if (e.res[r] > lim) marketTrade(G, e, r, Math.floor((e.res[r] - lim * 0.6) / 2), false); }
  if (e.res.energy > keepE + 800 && e.res.alloys < 4000) marketTrade(G, e, 'alloys', Math.floor((e.res.energy - keepE - 400) / marketPrice(G, e, 'alloys', true) / 2), true);
}
function aiStarbases(G, e) {
  const cs = capSys(G, e); if (cs < 0) return;
  const s = G.systems[cs];
  if (s.sb && s.sb.owner === e.id) {
    if (!canSbUpgrade(G, e, cs) && e.res.alloys > SB_LEVELS[s.sb.lvl + 1].cost.alloys + 100) sbQueue(G, e, cs, 'up');
    const want = ['shipyard', 'anchorage', 'anchorage', 'drydock', 'battery', 'tradehub'];
    for (const k of want) { if (s.sb.mods.filter(x => x === k).length < want.filter(x => x === k).length && !canSbModule(G, e, cs, k) && e.res.alloys > 220) { sbQueue(G, e, cs, 'mod', k); break; } }
  }
  // a second shipyard and anchorages on big colonies; fortify chokepoints
  const cols = colonies(G, e);
  if (cols.length >= 4 && e.res.alloys > 400 && sbUsed(G, e) < sbCap(G, e)) {
    const other = cols.filter(p => p.sys !== cs).sort((a, b) => b.col.pops - a.col.pops)[0];
    if (other) { const sb = G.systems[other.sys].sb; if (sb && sb.owner === e.id) { if (sb.lvl === 0 && !canSbUpgrade(G, e, other.sys)) sbQueue(G, e, other.sys, 'up'); else if (sb.lvl > 0 && !sb.mods.includes('shipyard') && !canSbModule(G, e, other.sys, 'shipyard')) sbQueue(G, e, other.sys, 'mod', 'shipyard'); else if (sb.lvl > 0 && !canSbModule(G, e, other.sys, 'anchorage')) sbQueue(G, e, other.sys, 'mod', 'anchorage'); } }
  }
  if (e.techs.wakefield) for (const sid of G.beacons || []) { const sb = G.systems[sid].sb; if (sb && sb.owner === e.id && sb.lvl === 0 && !canSbUpgrade(G, e, sid)) { sbQueue(G, e, sid, 'up'); break; } }
  if (e.res.alloys > 900) {
    for (const sid of ownedSystems(G, e)) {
      const sb = G.systems[sid].sb; if (!sb || sb.owner !== e.id || sb.queue.length) continue;
      if (sb.lvl > 0 && !canSbModule(G, e, sid, 'anchorage')) { sbQueue(G, e, sid, 'mod', 'anchorage'); break; }
      if (!canSbUpgrade(G, e, sid) && (sb.lvl > 0 || G.systems[sid].planets.some(pid => G.planets[pid].col))) { sbQueue(G, e, sid, 'up'); break; }
    }
  }
  if ((e.persona === 'isolationist' || e.persona === 'militarist') && e.res.alloys > 500 && sbUsed(G, e) < sbCap(G, e)) {
    const border = ownedSystems(G, e).filter(sid => G.systems[sid].lanes.some(w => { const o = G.systems[w].owner; return o >= 0 && o !== e.id; }));
    const t = border.find(sid => !canSbUpgrade(G, e, sid));
    if (t != null) sbQueue(G, e, t, 'up');
  }
}
function aiShipyard(G, e) {
  const P = persona(e), net = empireEcon(G, e).net;
  const yards = shipyards(G, e); if (!yards.length) return;
  const yard = yards.includes(capSys(G, e)) ? capSys(G, e) : yards[0];
  const queued = (k) => yards.reduce((n, sid) => n + G.systems[sid].sb.queue.filter(q => q.k === 'ship' && designById(e, q.key).hull === k).length, 0);
  const has = k => G.fleets.filter(f => f.owner === e.id && f.kind === (k === 'surveyor' ? 'survey' : k)).length + queued(k);
  // civilians
  const unsurveyed = G.systems.some(s => e.known[s.id] && !e.surv[s.id]);
  if (unsurveyed && has('surveyor') < (G.day < 7200 ? 2 : 1) && e.res.minerals > 150) sbQueue(G, e, yard, 'ship', bestDesign(G, e, 'surveyor'));
  const builders = P.expand > 1.2 ? 2 : 1;
  if (has('builder') < builders && e.res.minerals > 150) sbQueue(G, e, yard, 'ship', bestDesign(G, e, 'builder'));
  if (has('colony') < (P.expand > 1.2 ? 2 : 1) && e.res.minerals > 380 && e.res.food > 120 && aiColonyTarget(G, e, yard) >= 0) sbQueue(G, e, yard, 'ship', bestDesign(G, e, 'colony'));
  // warships
  const used = navalUsed(G, e), cap = navalCap(G, e);
  const war = atWarAny(G, e), threat = G.crisis.stage === 2 || G.empires.some(x => x.kind === 'major' && x.alive && (x.beaconDays > 0 || x.domDays > 0) && x.id !== e.id);
  const rich = e.res.alloys > 2500 ? 1.35 : 1;
  const want = cap * clamp(P.fleet * (war ? 1.1 : threat ? 1.0 : 0.75) * (G.day < 1800 ? 0.5 : 1) * rich, 0.3, 1.25);
  const inQ = yards.reduce((n, sid) => n + G.systems[sid].sb.queue.filter(q => q.k === 'ship' && !HULLS[designById(e, q.key).hull].civ).length, 0);
  // scrap obsolete small hulls when far over capacity
  if (used > cap * 1.1 && !war) {
    for (const f of G.fleets) { if (f.owner !== e.id || f.kind !== 'war' || f.prog) continue; const i = f.ships.findIndex(s => { const d = designById(e, s.d); return d && d.obsolete && HULLS[d.hull].size <= 2; }); if (i >= 0) { f.ships.splice(i, 1); if (navalUsed(G, e) <= cap) break; } }
    G.fleets = G.fleets.filter(f => f.ships.length || f.kind !== 'war');
  }
  if ((net.energy || 0) < -2 && e.res.energy < 300) return;
  if (used < want && inQ < yards.length + 1) {
    const hulls = HULL_KEYS.filter(h => hullAvailable(e, h)).reverse();
    for (const h of hulls) {
      const d = bestDesign(G, e, h), st = designStats(G, e, designById(e, d));
      if (HULLS[h].size > want - used + 4 && h !== 'picket') continue;
      const reserve = 60;
      if (e.res.alloys >= st.cost.alloys + reserve) { const ys = yards.slice().sort((a, b) => G.systems[a].sb.queue.length - G.systems[b].sb.queue.length); sbQueue(G, e, ys[0], 'ship', d); break; }
    }
  }
  // armies when at war
  if (war) {
    const armies = G.fleets.filter(f => f.owner === e.id && f.kind === 'army').reduce((n, f) => n + f.ships.length, 0);
    const qa = colonies(G, e).reduce((n, p) => n + p.col.queue.filter(q => q.k === 'a').length, 0);
    const kind = e.techs.gene_legions ? 'gene' : e.techs.assault_legions ? 'shock' : 'legion';
    if (armies + qa < 6 + Math.floor(G.day / 7200) * 2 && e.res.minerals > 250) {
      const p = colonies(G, e).filter(q => q.col.queue.length < 2 && q.col.pops >= 3).sort((a, b) => b.col.pops - a.col.pops)[0];
      if (p) queueBuild(G, e, p, 'a', kind);
    }
  }
}
function aiColonyTarget(G, e, from) {
  const d = jumpDist(G, [from], 10);
  let best = -1, bs = 0;
  for (const p of G.planets) {
    if (d[p.sys] < 0 || canColonize(G, e, p.id)) continue;
    const h = habitability(G, G.species[e.species], p, e);
    if (h < 0.5) continue;
    const sc = h * p.size / (2 + d[p.sys]) * (G.systems[p.sys].owner === e.id ? 1.5 : 1);
    if (sc > bs) { bs = sc; best = p.id; }
  }
  return best;
}
function aiCivilians(G, e) {
  const P = persona(e);
  for (const f of G.fleets) {
    if (f.owner !== e.id || f.order || f.path.length || f.prog) continue;
    if (f.kind === 'survey') autoSurvey(G, e, f);
    else if (f.kind === 'colony') { const t = aiColonyTarget(G, e, f.sys); if (t >= 0) orderFleet(G, f, { t: 'colonize', planet: t }); }
    else if (f.kind === 'builder') {
      const own = ownedSystems(G, e);
      const reserve = 30;
      let best = -1, bs = -1e9;
      if (e.res.influence >= 30 + reserve * (P.expand > 1.2 ? 0 : 1) && e.res.alloys >= 40) {
        const d = jumpDist(G, own.length ? own : [f.sys], 3);
        for (const s of G.systems) {
          if (d[s.id] < 1 || d[s.id] > 2 || canOutpost(G, e, s.id)) continue;
          let sc = -d[s.id] * 3;
          for (const pid of s.planets) { const p = G.planets[pid]; if (PLANET_TYPES[p.type].hab && !p.col && !p.prim) sc += 6 * habitability(G, G.species[e.species], p, e) + 1; if (p.dep) sc += 2; }
          if (s.special === 'beacon') sc += (e.techs.wakefield ? 30 : 8) + (P.research > 1.2 ? 15 : 0);
          if (s.lanes.some(w => { const o = G.systems[w].owner; return o >= 0 && o !== e.id; })) sc += 3; // claim contested space
          sc += rnd(G);
          if (sc > bs) { bs = sc; best = s.id; }
        }
      }
      if (best >= 0 && !orderFleet(G, f, { t: 'outpost', sys: best })) continue;
      if (e.res.minerals > 120) autoBuild(G, e, f);
    }
    else if (f.kind === 'army' || f.kind === 'war') { /* handled by aiMilitary */ }
  }
}

// ---------- military ----------
function sysThreat(G, eid, sid) {
  let p = 0; const s = G.systems[sid];
  for (const g of G.fleets) if (g.sys === sid && g.prog === 0 && (g.kind === 'war' || g.kind === 'monster') && hostile(G, eid, g.owner)) p += fleetPower(G, g);
  if (s.sb && !s.sb.dis && hostile(G, eid, s.sb.owner) && s.sb.lvl > 0) { const st = sbStats(G, s); p += Math.sqrt(st.dmg * (s.sb.hp + s.sb.sh)) * 0.6; }
  return p;
}
SW.sysThreat = sysThreat;
function aiMilitary(G, e) {
  const fleets = G.fleets.filter(f => f.owner === e.id && f.kind === 'war' && f.ships.length);
  const home = capSys(G, e); if (home < 0) return;
  // merge idle fleets that share a system
  const lim = cmdLimit(G, e), idleAt = new Map();
  for (const f of fleets) if (!f.path.length && !f.prog) { let a = idleAt.get(f.sys); if (!a) idleAt.set(f.sys, a = []); a.push(f); }
  for (const grp of idleAt.values()) {
    if (grp.length < 2) continue;
    const cmds = grp.map(f => fleetCmd(G, f));
    for (let i = 0; i < grp.length; i++) for (let j = i + 1; j < grp.length; j++) {
      if (!grp[i].ships.length || !grp[j].ships.length || cmds[i] + cmds[j] > lim) continue;
      grp[i].ships.push(...grp[j].ships); grp[j].ships = []; cmds[i] += cmds[j]; cmds[j] = 0; grp[i].newShips = 0;
    }
  }
  if (fleets.some(f => !f.ships.length)) G.fleets = G.fleets.filter(f => f.ships.length || f.kind !== 'war');
  const live = G.fleets.filter(f => f.owner === e.id && f.kind === 'war' && f.ships.length);
  const enemies = enemiesOf(G, e);
  const crisis = G.crisis.stage === 2;
  // idle fleets in the same system act as one battle group
  const groups = new Map();
  for (const f of live) {
    if (f.path.length || f.prog) continue;
    const hpR = sum(f.ships, s => s.hp) / Math.max(1, sum(f.ships, s => shipStats(G, e, s).hull));
    if (hpR < 0.55) { if (G.systems[f.sys].owner !== e.id) moveTo(G, f, home); continue; }
    if (f.sys === home && e.res.alloys > 300) { const rc = refitCost(G, e, f); if (rc.n && rc.alloys < e.res.alloys - 150) refitFleet(G, f); }
    let g = groups.get(f.sys); if (!g) groups.set(f.sys, g = []); g.push(f);
  }
  for (const [at, grp] of groups) {
    const pow = sum(grp, f => fleetPower(G, f));
    let target = -1, ts = -1e9;
    const d = jumpDist(G, [at], 14);
    if (enemies.length) {
      for (const s of G.systems) {
        if (d[s.id] < 0) continue;
        const enemyOwned = s.owner >= 0 && enemies.includes(s.owner);
        const enemyFleet = G.fleets.some(g => g.sys === s.id && g.prog === 0 && g.kind === 'war' && enemies.includes(g.owner));
        if (!enemyOwned && !enemyFleet) continue;
        const thr = sysThreat(G, e.id, s.id);
        if (thr > pow * 0.85) continue;
        let sc = -d[s.id] * 4 + s.planets.filter(pid => G.planets[pid].col).length * 8 + (s.planets.some(pid => G.planets[pid].home && G.planets[pid].col && enemies.includes(G.planets[pid].col.owner)) ? 12 : 0) + (enemyFleet ? 10 : 0) + (s.owner === e.id ? 15 : 0);
        if (s.sb && enemies.includes(s.sb.owner) && !s.sb.dis) sc += 6;
        if (sc > ts) { ts = sc; target = s.id; }
      }
    }
    if (crisis) {
      for (const g of G.fleets) {
        if (g.owner !== G.crisisId || g.prog || d[g.sys] < 0 || d[g.sys] > 10) continue;
        const thr = sysThreat(G, e.id, g.sys); if (thr > pow * 0.8) continue;
        const sc = 30 - d[g.sys] * 3 + (G.systems[g.sys].owner === e.id ? 25 : 0) + (g.stationary ? 15 : 0);
        if (sc > ts) { ts = sc; target = g.sys; }
      }
    }
    if (target < 0 && !enemies.length) {
      const P = persona(e);
      for (const g of G.fleets) {
        if (g.owner !== G.faunaId || g.prog || d[g.sys] < 0 || d[g.sys] > (G.systems[g.sys].special === 'beacon' ? 9 : 5)) continue;
        const thr = sysThreat(G, e.id, g.sys); if (thr > pow * 0.6) continue;
        const near = G.systems[g.sys].owner === e.id || G.systems[g.sys].lanes.some(w => G.systems[w].owner === e.id);
        if (!near && !g.stationary && G.systems[g.sys].special !== 'beacon') continue;
        const sc = -d[g.sys] * 3 + (g.stationary ? 6 : 0) + (G.systems[g.sys].special === 'beacon' ? 10 + (P.research > 1.2 ? 15 : 0) : 0);
        if (sc > ts) { ts = sc; target = g.sys; }
      }
    }
    if (target >= 0 && target !== at) {
      const spd = Math.min(...grp.map(f => fleetSpeed(G, f)));
      for (const f of grp) { if (!moveTo(G, f, target)) f.spd = spd; }
      continue;
    }
    if (target === at && at !== home) {
      const pl = G.systems[at].planets.map(id => G.planets[id]).find(p => p.col && enemies.includes(p.col.owner));
      if (pl && orbitClear(G, e.id, at)) for (const f of grp) if (!f.order || f.order.t !== 'bombard') orderFleet(G, f, { t: 'bombard', planet: pl.id });
      continue;
    }
    if (target < 0 && at !== home) for (const f of grp) if (!(f.order && f.order.t === 'bombard')) moveTo(G, f, home);
  }
  // armies: invade planets where our fleets hold orbit
  if (enemies.length) {
    const armies = G.fleets.filter(f => f.owner === e.id && f.kind === 'army' && !f.path.length && !f.prog && !f.order);
    for (const a of armies) for (const b of armies) if (a !== b && G.fleets.includes(a) && G.fleets.includes(b) && a.sys === b.sys) mergeFleets(G, a, b);
    for (const a of G.fleets.filter(f => f.owner === e.id && f.kind === 'army' && !f.path.length && !f.prog && !f.order)) {
      let best = -1, bs = -1e9; const d = jumpDist(G, [a.sys], 14);
      const str = sum(a.ships, s => ARMIES[s.d].dmg * 8 + s.hp);
      for (const p of G.planets) {
        if (!p.col || !enemies.includes(p.col.owner) || d[p.sys] < 0) continue;
        if (!orbitClear(G, e.id, p.sys)) continue;
        if (!G.fleets.some(g => g.owner === e.id && g.kind === 'war' && g.sys === p.sys && !g.prog)) continue;
        if (p.col.def * (0.5 + p.col.fort / 200) > str) continue;
        const sc = -d[p.sys] + p.col.pops + (p.home ? 15 : 0);
        if (sc > bs) { bs = sc; best = p.id; }
      }
      if (best >= 0) orderFleet(G, a, { t: 'invade', planet: best });
    }
  }
}

// ---------- diplomacy ----------
function aiDiplomacy(G, e) {
  const P = persona(e), A = e.ai_;
  const others = alive(G).filter(o => o.id !== e.id && hasContact(G, e.id, o.id));
  // treaties
  if (G.day % (DAYS_MONTH * 6) === (e.id * DAYS_MONTH) % (DAYS_MONTH * 6)) {
    for (const o of others) {
      if (atWar(G, e.id, o.id)) continue;
      for (const k of ['nap', 'trade', 'research', 'alliance']) {
        if (rel(G, e.id, o.id).treaties[k] || canPropose(G, e.id, o.id, k)) continue;
        if (!evalTreaty(G, o.id, e.id, k).ok) continue; // would we want it ourselves?
        if (rnd(G) > 0.4 * P.treaty) continue;
        if (o.ai) { if (evalTreaty(G, e.id, o.id, k).ok) signTreaty(G, e.id, o.id, k); else rel(G, e.id, o.id).ask = G.day + 360; }
        else if (!G.pending.some(p => p.e === o.id && p.key === 'ai_offer')) { startEvent(G, o, 'ai_offer', { other: e.id, treaty: k }); rel(G, e.id, o.id).ask = G.day + DAYS_YEAR * 2; }
        break;
      }
    }
    for (const o of others) { const op = opinion(G, e.id, o.id).total; for (const k in rel(G, e.id, o.id).treaties) if (op < -40 && rel(G, e.id, o.id).treaties[k]) { cancelTreaty(G, e.id, o.id, k); break; } }
  }
  // peace
  for (const w of G.wars.slice()) {
    const side = sideOf(w, e.id); if (!side || !w.lead.includes(e.id)) continue;
    const mine = side, theirs = side === 'att' ? 'def' : 'att';
    const oLead = G.empires[side === 'att' ? w.lead[1] : w.lead[0]];
    let terms = null;
    if (w.exh[theirs] > 60 && w.exh[mine] < 40) terms = 'surrender';
    else if (w.exh[mine] > 45 || (G.day - w.start) > DAYS_YEAR * 12) terms = 'status';
    if (w.exh[mine] > 85 && w.exh[theirs] < 50) terms = 'concede';
    if (!terms) continue;
    if (oLead.ai) { if (evalPeace(G, e.id, w, terms).ok) endWar(G, w, terms === 'status' ? 'status' : 'win', terms === 'surrender' ? mine : terms === 'concede' ? theirs : null); }
    else if ((A['peace' + w.id] || 0) < G.day) { A['peace' + w.id] = G.day + DAYS_YEAR; startEvent(G, oLead, 'peace_offer', { other: e.id, war: w.id, terms: terms === 'concede' ? 'surrender' : 'status' }); }
  }
  // war
  if ((A.nextWar || 0) > G.day) return;
  A.nextWar = G.day + DAYS_MONTH * (4 + Math.floor(rnd(G) * 6));
  const calm = { easy: 35, normal: 20, hard: 15, brutal: 10 }[G.cfg.difficulty] || 20;
  if (G.day < DAYS_YEAR * calm) return; // early peace while empires find their feet
  if (warsOf(G, e.id).length >= (P.war > 1.2 ? 2 : 1)) return;
  if (warExhaustionOf(G, e.id) > 20) return;
  const myP = empirePower(G, e);
  let best = null, bs = 0;
  for (const o of others) {
    if (canDeclare(G, e.id, o.id)) continue;
    const near = bordering(G, e.id, o.id);
    const beacon = o.beaconDays > 0 || o.domDays > 0;
    if (!near && !beacon && !(e.techs.wakefield && (G.beacons || []).some(sid => G.systems[sid].owner === o.id))) continue;
    const theirP = empirePower(G, o) + sum(alive(G).filter(x => x.id !== o.id && rel(G, o.id, x.id).treaties.alliance), x => empirePower(G, x) * 0.7);
    const ratio = myP / Math.max(1, theirP);
    const op = opinion(G, e.id, o.id).total;
    const beaconWar = e.techs.wakefield && beaconsHeld(G, e) >= 1 && (G.beacons || []).some(sid => G.systems[sid].owner === o.id);
    let sc = (ratio - 1.4 / P.war) * 40 - op * 0.5 - (rel(G, e.id, o.id).treaties.nap ? 30 : 0) + (beacon ? 60 : 0) + (beaconWar ? 35 : 0);
    if (G.crisis.stage === 2) sc -= 60;
    if (P.war < 0.7 && !beacon) sc -= 25;
    if (!o.ai && G.cfg.difficulty === 'easy') sc -= 20;
    if (sc > bs) { bs = sc; best = o; }
  }
  if (best && bs > 10 && rnd(G) < 0.5 * P.war) {
    const goal = rnd(G) < 0.7 ? 'conquest' : rnd(G) < 0.5 ? 'humiliate' : 'plunder';
    declareWar(G, e.id, best.id, goal);
  }
}
