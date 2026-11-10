// ===== ships.js : ship designs, fleets, movement, civilian orders, starbases, shipbuilding =====
function hullAvailable(e, h) {
  if (h === 'picket' || HULLS[h].civ) return true;
  return TECH_LIST.some(t => t[5].hull === h && e.techs[t[0]]);
}
function compAvailable(e, c) {
  if (e.techs[c]) return true; // starting components share their tech id
  for (const id in e.techs) { const t = TECHS[id]; if (t && t.un.comp === c) return true; }
  return false;
}
SW.hullAvailable = hullAvailable; SW.compAvailable = compAvailable;
function availableComps(e, slot) { return Object.keys(COMPS).filter(k => COMPS[k].slot === slot && compAvailable(e, k)); }
SW.availableComps = availableComps;
function designById(e, id) {
  if (!e._dmap || e._dmapN !== e.designs.length) { e._dmap = new Map(e.designs.map(d => [d.id, d])); e._dmapN = e.designs.length; }
  return e._dmap.get(id);
}
SW.designById = designById;

function designStats(G, e, d) {
  const m = empMods(G, e);
  if (e._dsFor !== m) { e._ds = {}; e._dsFor = m; }
  if (e._ds[d.id]) return e._ds[d.id];
  const H = HULLS[d.hull], st = { hull: H.hull * (1 + mv(m, 'hull%') / 100), armor: 0, shield: 0, evasion: H.evasion + mv(m, 'evasion+'), speed: H.speed, weapons: [], pd: 0, repair: mv(m, 'repair+'), acc: 0, size: H.size, civ: !!H.civ };
  const ds = DEF_SCALE[H.size] || 1, ws = WPN_SCALE[H.size] || 1;
  let cost = H.cost;
  for (const k of d.comps) {
    const C = COMPS[k]; if (!C) continue; cost += C.cost * (H.size || 1);
    if (C.slot === 'w') st.weapons.push({ type: C.type, dmg: C.dmg * ws * (1 + mv(m, 'fleetDmg%') / 100), acc: C.acc });
    if (C.armor) st.armor += C.armor * ds * (1 + mv(m, 'armor%') / 100);
    if (C.shield) st.shield += C.shield * ds * (1 + mv(m, 'shield%') / 100);
    if (C.evasion) st.evasion += C.evasion;
    if (C.speed) st.speed += C.speed;
    if (C.pd) st.pd = Math.min(0.7, st.pd + C.pd);
    if (C.repair) st.repair += C.repair;
    if (C.acc) st.acc += C.acc;
  }
  st.hull = Math.round(st.hull); st.armor = Math.round(st.armor); st.shield = Math.round(st.shield);
  if (H.civ) st.cost = { minerals: Math.round(H.mcost * (1 + mv(m, 'shipCost%') / 200)), ...(H.fcost ? { food: H.fcost } : {}) };
  else st.cost = { alloys: Math.round(cost * (1 + mv(m, 'shipCost%') / 100)) };
  st.days = H.days;
  st.power = shipPower(st);
  e._ds[d.id] = st;
  return st;
}
SW.designStats = designStats;
function shipPower(st) { const dps = sum(st.weapons, w => w.dmg * w.acc / 100); return Math.round(Math.sqrt(Math.max(1, dps) * (st.hull + st.armor + st.shield)) * 0.6); }
// stats of one ship of an empire's fleet (designs or monsters)
function shipStats(G, e, s) {
  if (s.m) { const M = MONSTERS[s.m]; const sc = G.crisis && G.crisis.scale && s.m.startsWith('hollow') ? G.crisis.scale : 1; return { hull: M.hull * sc, armor: M.armor * sc, shield: M.shield * sc, evasion: M.evasion, speed: M.speed, weapons: [{ type: M.type, dmg: M.dmg * sc, acc: 85 }], pd: 0, repair: s.m.startsWith('hollow') ? 1 : 0.5, size: M.size, power: Math.round(Math.sqrt(M.dmg * sc * (M.hull + M.armor + M.shield) * sc) * 0.6), monster: true }; }
  if (typeof s.d === 'string') { const A = ARMIES[s.d]; return { hull: A.hp * 1.5, armor: 0, shield: 0, evasion: 10, speed: 0.95, weapons: [], pd: 0, repair: 0, size: 0, power: 0, army: true }; }
  const d = designById(e, s.d); return designStats(G, e, d);
}
SW.shipStats = shipStats;
function shipSize(G, e, s) { if (s.m) return 0; const d = designById(e, s.d); return d ? HULLS[d.hull].size : 0; }
function fleetPower(G, f) { const e = G.empires[f.owner]; let p = 0; for (const s of f.ships) { const st = shipStats(G, e, s); p += st.power * (0.3 + 0.7 * s.hp / Math.max(1, st.hull)); } return Math.round(p); }
function fleetCmd(G, f) { const e = G.empires[f.owner]; return sum(f.ships, s => shipSize(G, e, s)); }
function cmdLimit(G, e) { return 20 + mv(empMods(G, e), 'cmd+') + Math.floor(navalCap(G, e) / 20); }
function empirePower(G, e) { let p = 0; for (const f of G.fleets) if (f.owner === e.id && f.kind === 'war') p += fleetPower(G, f); return p; }
SW.fleetPower = fleetPower; SW.fleetCmd = fleetCmd; SW.cmdLimit = cmdLimit; SW.empirePower = empirePower;

function autoDesignComps(e, hull) {
  const H = HULLS[hull], comps = [];
  const fam = { kin: ['collapsar', 'gauss', 'rail', 'slug'], beam: ['nova', 'prism', 'lumenlance', 'photon'], mis: ['torpedo', 'hunter', 'dart'] };
  const best = {};
  for (const f in fam) { const k = fam[f].find(c => compAvailable(e, c)); if (k) best[f] = k; }
  if (compAvailable(e, 'precursor')) best.beam = 'precursor';
  const ws = Object.values(best).sort((a, b) => COMPS[b].dmg - COMPS[a].dmg).slice(0, 2);
  for (let i = 0; i < H.slots.w; i++) comps.push(ws[i % ws.length]);
  const armor = ['voidplate', 'neutron', 'duralloy', 'ceramite'].find(c => compAvailable(e, c));
  const shield = ['veil4', 'veil3', 'veil2', 'veil1'].find(c => compAvailable(e, c));
  for (let i = 0; i < H.slots.d; i++) comps.push(shield && i % 2 === 1 ? shield : armor || shield);
  const util = ['targeting', 'repair', 'thruster', 'pd', 'booster'].filter(c => compAvailable(e, c));
  for (let i = 0; i < H.slots.u; i++) comps.push(util[i % Math.max(1, util.length)] || 'booster');
  return comps;
}
function autoDesigns(G, e) {
  for (const h of ['surveyor', 'builder', 'colony']) if (!e.designs.some(d => d.hull === h)) e.designs.push({ id: nextId(G, 'design'), name: HULLS[h].name, hull: h, comps: [], obsolete: 0, auto: 1 });
  for (const h of HULL_KEYS) {
    if (!hullAvailable(e, h)) continue;
    const comps = autoDesignComps(e, h);
    const same = e.designs.find(d => d.hull === h && !d.obsolete && d.comps.join() === comps.join());
    if (same) continue;
    const mk = e.designs.filter(d => d.hull === h).length + 1;
    if (e.autoDesign) for (const d of e.designs) if (d.hull === h && d.auto) d.obsolete = 1;
    e.designs.push({ id: nextId(G, 'design'), name: HULLS[h].name + ' Mk ' + (mk <= 12 ? ROMAN[mk - 1] : mk), hull: h, comps, obsolete: 0, auto: 1 });
  }
  if (e._ds) e._ds = {};
}
SW.autoDesigns = autoDesigns;
function bestDesign(G, e, hull) {
  const ds = e.designs.filter(d => d.hull === hull && !d.obsolete);
  return ds.length ? ds[ds.length - 1].id : (e.designs.filter(d => d.hull === hull).pop() || {}).id;
}
SW.bestDesign = bestDesign;
// a player-made design; returns error or the design
function saveDesign(G, e, hull, comps, name, replaceId) {
  const H = HULLS[hull]; if (!H || H.civ || !hullAvailable(e, hull)) return 'Hull not available';
  const need = [].concat(Array(H.slots.w).fill('w'), Array(H.slots.d).fill('d'), Array(H.slots.u).fill('u'));
  if (comps.length !== need.length) return 'Wrong number of components';
  for (let i = 0; i < need.length; i++) { const C = COMPS[comps[i]]; if (!C || C.slot !== need[i] || !compAvailable(e, comps[i])) return 'Invalid component in slot ' + (i + 1); }
  const d = { id: nextId(G, 'design'), name: String(name || H.name).slice(0, 28), hull, comps: comps.slice(), obsolete: 0, auto: 0 };
  e.designs.push(d);
  if (replaceId) { const old = designById(e, replaceId); if (old) old.obsolete = 1; }
  return d;
}
SW.saveDesign = saveDesign;

const ORDINAL = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
function makeFleet(G, owner, sys, ships, kind) {
  const e = G.empires[owner];
  const f = { id: nextId(G, 'fleet'), owner, name: '', sys, path: [], prog: 0, kind, ships: [], order: null, work: 0, auto: 0, morale: 100, home: sys, stance: 'aggressive' };
  for (const s of ships) {
    if (typeof s === 'object') { f.ships.push(s); continue; }
    const d = designById(e, s); const st = designStats(G, e, d);
    f.ships.push({ d: s, hp: st.hull, ar: st.armor, sh: st.shield });
  }
  const n = (e.fleetN = e.fleetN || {}); n[kind] = (n[kind] || 0) + 1;
  f.name = kind === 'war' ? ORDINAL(n[kind]) + ' Fleet' : kind === 'army' ? ORDINAL(n[kind]) + ' Legion Group' : kind === 'survey' ? 'Surveyor ' + ROMAN[(n[kind] - 1) % 12] : kind === 'builder' ? 'Constructor ' + ROMAN[(n[kind] - 1) % 12] : kind === 'colony' ? 'Colony Ark ' + ROMAN[(n[kind] - 1) % 12] : 'Swarm';
  G.fleets.push(f);
  return f;
}
SW.makeFleet = makeFleet;
function spawnMonster(G, key, sys, count, stationary) {
  const M = MONSTERS[key], owner = key.startsWith('hollow') ? G.crisisId : G.faunaId;
  const ships = []; for (let i = 0; i < count; i++) ships.push({ m: key, hp: M.hull, ar: M.armor, sh: M.shield });
  const f = makeFleet(G, owner, sys, ships, 'monster');
  f.name = M.name + (count > 1 ? ' ×' + count : ''); f.stationary = stationary ? 1 : 0;
  // scale crisis ship stats
  if (owner === G.crisisId && G.crisis.scale) for (const s of f.ships) { s.hp *= G.crisis.scale; s.ar *= G.crisis.scale; s.sh *= G.crisis.scale; }
  return f;
}
SW.spawnMonster = spawnMonster;
function fleetById(G, id) { return G.fleets.find(f => f.id === id); }
SW.fleetById = fleetById;
function removeFleet(G, f) { const i = G.fleets.indexOf(f); if (i >= 0) G.fleets.splice(i, 1); }
function fleetsAt(G, sys) { return G.fleets.filter(f => f.sys === sys && f.prog === 0); }
SW.fleetsAt = fleetsAt;

// ---------- hostility & movement ----------
function hostile(G, a, b) {
  if (a === b) return false;
  const A = G.empires[a], B = G.empires[b];
  if (!A || !B) return false;
  if (A.kind !== 'major' || B.kind !== 'major') {
    if (A.kind === 'fauna' && B.kind === 'fauna') return false;
    if ((A.kind === 'fauna' && B.flags.tamed) || (B.kind === 'fauna' && A.flags.tamed)) return false;
    return true;
  }
  return atWar(G, a, b);
}
SW.hostile = hostile;
function fleetSpeed(G, f) {
  const e = G.empires[f.owner];
  let sp = 9;
  for (const s of f.ships) sp = Math.min(sp, 7 * shipStats(G, e, s).speed);
  if (f.kind === 'army') sp = 7 * 0.95;
  if (e.kind === 'major') sp *= 1 + mv(empMods(G, e), 'speed%') / 100;
  if (f.spd && f.spd < sp) sp = f.spd;
  return sp;
}
SW.fleetSpeed = fleetSpeed;
function dangerFor(G, f) {
  // civilian ships route around systems with known hostile forces
  return (sid) => {
    for (const g of G.fleets) if (g.sys === sid && g.prog === 0 && g.owner !== f.owner && (g.kind === 'war' || g.kind === 'monster') && hostile(G, f.owner, g.owner)) return f.kind === 'war' ? 0 : Infinity;
    return 0;
  };
}
function moveTo(G, f, dest) {
  if (f.stationary) return 'Cannot move';
  if (dest === f.sys && f.prog === 0) { f.path = []; return null; }
  const start = f.prog > 0 && f.path.length ? f.path[0] : f.sys;
  const avoid = f.kind === 'war' || f.kind === 'monster' ? null : dangerFor(G, f);
  let p = findPath(G, start, dest, avoid);
  if (!p && avoid) p = findPath(G, start, dest, null);
  if (!p) return 'No route';
  f.path = f.prog > 0 && f.path.length ? [start].concat(p) : p;
  return null;
}
SW.moveTo = moveTo;
function etaDays(G, f, dest) {
  const p = findPath(G, f.sys, dest); if (!p) return Infinity;
  return Math.ceil(pathLength(G, f.sys, p) / fleetSpeed(G, f));
}
SW.etaDays = etaDays;
function moveFleets(G) {
  for (const f of G.fleets.slice()) {
    if (!f.path.length) continue;
    if (f.lockDays > 0) { f.lockDays--; continue; }
    const a = G.systems[f.sys], b = G.systems[f.path[0]];
    const L = Math.max(1, hyp(a.x - b.x, a.y - b.y));
    f.prog += fleetSpeed(G, f) / L;
    if (f.prog >= 1) { f.sys = f.path.shift(); f.prog = 0; if (!f.path.length) f.spd = 0; onArrive(G, f); }
  }
}
function onArrive(G, f) {
  const e = G.empires[f.owner]; if (e.kind !== 'major') return;
  const s = G.systems[f.sys];
  e.known[f.sys] = 1; for (const w of s.lanes) e.known[w] = 1;
  if (s.owner >= 0 && s.owner !== e.id && G.empires[s.owner].kind === 'major') meet(G, e.id, s.owner);
  for (const g of G.fleets) if (g.sys === f.sys && g.prog === 0 && g.owner !== e.id && G.empires[g.owner].kind === 'major') meet(G, e.id, g.owner);
  if (f.kind === 'war' && f.order && f.order.t === 'move') f.order = null;
}

// ---------- civilian orders ----------
function outpostCost(G, e, sid) {
  const own = ownedSystems(G, e);
  let jumps = 6;
  if (own.length) { const d = jumpDist(G, own, 8); jumps = d[sid] >= 0 ? d[sid] : 8; }
  const m = empMods(G, e);
  return { alloys: 40, influence: Math.round((30 + 6 * Math.max(0, jumps - 1)) * (1 + mv(m, 'outpostCost%') / 100)) };
}
SW.outpostCost = outpostCost;
function canOutpost(G, e, sid) {
  const s = G.systems[sid];
  if (s.owner >= 0) return 'Already claimed';
  if (!e.surv[sid]) return 'Survey the system first';
  if (G.fleets.some(g => g.sys === sid && g.prog === 0 && g.kind === 'monster' && hostile(G, e.id, g.owner))) return 'Hostile creatures guard this system';
  if (G.fleets.some(g => g.owner === e.id && g.kind === 'builder' && g.order && g.order.t === 'outpost' && g.order.sys === sid)) return 'Already being claimed';
  const own = ownedSystems(G, e);
  if (own.length && !s.lanes.some(w => G.systems[w].owner === e.id)) {
    const d = jumpDist(G, own, 3); if (!(d[sid] >= 0 && d[sid] <= 2)) return 'Too far from your borders';
  }
  if (!canAfford(e, outpostCost(G, e, sid))) return 'Not enough alloys or influence';
  return null;
}
SW.canOutpost = canOutpost;
var STATION_COST = { minerals: 75 };
function canStation(G, e, pid) {
  const p = G.planets[pid], s = G.systems[p.sys];
  if (s.owner !== e.id) return 'System not yours';
  if (!p.dep || p.station) return 'No deposit to exploit';
  if (PLANET_TYPES[p.type].hab) return 'Habitable worlds are colonized, not mined';
  if (G.fleets.some(g => g.owner === e.id && g.order && g.order.t === 'station' && g.order.planet === pid)) return 'Already ordered';
  if (!canAfford(e, STATION_COST)) return 'Not enough minerals';
  return null;
}
SW.canStation = canStation;
function canColonize(G, e, pid) {
  const p = G.planets[pid], s = G.systems[p.sys];
  if (!PLANET_TYPES[p.type].hab) return 'Not habitable';
  if (p.col) return 'Already colonized';
  if (p.prim) return 'A native civilization lives here';
  if (s.owner >= 0 && s.owner !== e.id) return 'Another empire owns this system';
  if (!e.surv[p.sys]) return 'Survey the system first';
  if (habitability(G, G.species[e.species], p, e) < 0.2) return 'Habitability too low';
  if (G.fleets.some(g => g.sys === p.sys && g.prog === 0 && g.kind === 'monster' && hostile(G, e.id, g.owner))) return 'Hostile creatures guard this system';
  if (G.fleets.some(g => g.owner === e.id && g.order && g.order.t === 'colonize' && g.order.planet === pid)) return 'A colony ark is already heading there';
  return null;
}
SW.canColonize = canColonize;
function orderFleet(G, f, order) {
  const e = G.empires[f.owner];
  if (!order) { f.order = null; f.work = 0; return null; }
  let err = null, dest;
  if (order.t === 'survey') { if (f.kind !== 'survey') return 'Only surveyors survey'; if (e.surv[order.sys]) return 'Already surveyed'; dest = order.sys; }
  else if (order.t === 'anomaly') { const s = G.systems[order.sys]; if (f.kind !== 'survey' || !s.anom || s.anom.by !== e.id || s.anom.done) return 'No anomaly to study'; dest = order.sys; }
  else if (order.t === 'outpost') { if (f.kind !== 'builder') return 'Only constructors build'; err = canOutpost(G, e, order.sys); dest = order.sys; }
  else if (order.t === 'station') { if (f.kind !== 'builder') return 'Only constructors build'; err = canStation(G, e, order.planet); dest = G.planets[order.planet].sys; }
  else if (order.t === 'colonize') { if (f.kind !== 'colony') return 'Needs a colony ark'; err = canColonize(G, e, order.planet); dest = G.planets[order.planet].sys; }
  else if (order.t === 'invade') { if (f.kind !== 'army') return 'Needs armies'; const p = G.planets[order.planet]; if (!p.col && !p.prim) return 'Nothing to invade'; if (p.col && !hostile(G, e.id, p.col.owner)) return 'Not at war with the owner'; dest = p.sys; }
  else if (order.t === 'bombard') { if (f.kind !== 'war') return 'Needs warships'; const p = G.planets[order.planet]; if (!p.col || !hostile(G, e.id, p.col.owner)) return 'Not an enemy colony'; dest = p.sys; }
  else return 'Unknown order';
  if (err) return err;
  if (order.t === 'outpost') { const c = outpostCost(G, e, order.sys); pay(e, c); order.cost = c; }
  if (order.t === 'station') { pay(e, STATION_COST); order.cost = STATION_COST; }
  if (f.order && f.order.cost) for (const r in f.order.cost) e.res[r] += f.order.cost[r];
  const mv2 = moveTo(G, f, dest); if (mv2) { if (order.cost) for (const r in order.cost) e.res[r] += order.cost[r]; return mv2; }
  f.order = order; f.work = 0;
  return null;
}
SW.orderFleet = orderFleet;
function cancelOrder(G, f) { const e = G.empires[f.owner]; if (f.order && f.order.cost) for (const r in f.order.cost) e.res[r] += f.order.cost[r]; f.order = null; f.work = 0; }
SW.cancelOrder = cancelOrder;
function surveyNeed(G, sid) { return 12 + 3 * G.systems[sid].planets.length; }
function workRate(G, e, f) { const m = empMods(G, e); return f.kind === 'survey' ? 1 + mv(m, 'surveySpeed%') / 100 : f.kind === 'colony' ? 1 + mv(m, 'colonySpeed%') / 100 : 1; }
SW.orderProgress = (G, f) => {
  if (!f.order) return null; const o = f.order;
  const need = o.t === 'survey' ? surveyNeed(G, o.sys) : o.t === 'anomaly' ? 60 : o.t === 'outpost' ? 90 : o.t === 'station' ? 60 : o.t === 'colonize' ? 200 : 0;
  return need ? { work: f.work, need } : null;
};
function fleetOrdersDay(G) {
  for (const f of G.fleets.slice()) {
    const o = f.order; if (!o || f.path.length || f.prog) continue;
    const e = G.empires[f.owner]; if (e.kind !== 'major') continue;
    const here = f.sys;
    if (o.t === 'survey') {
      if (here !== o.sys) { if (moveTo(G, f, o.sys)) f.order = null; continue; }
      f.work += workRate(G, e, f);
      if (f.work >= surveyNeed(G, here)) { f.order = null; f.work = 0; finishSurvey(G, e, here); }
    } else if (o.t === 'anomaly') {
      if (here !== o.sys) { if (moveTo(G, f, o.sys)) f.order = null; continue; }
      f.work += workRate(G, e, f);
      if (f.work >= 60) { const s = G.systems[here]; f.order = null; f.work = 0; s.anom.done = 1; e.stats.anomalies++; startEvent(G, e, s.anom.key, { sys: here, planet: s.anom.planet, fleet: f.id }); }
    } else if (o.t === 'outpost') {
      if (here !== o.sys) { if (moveTo(G, f, o.sys)) cancelOrder(G, f); continue; }
      const s = G.systems[here];
      if (s.owner >= 0 && s.owner !== e.id) { cancelOrder(G, f); if (!e.ai) log(G, e.id, `${s.name} was claimed by someone else first.`, here, 'bad'); continue; }
      if (G.fleets.some(g => g.sys === here && g.prog === 0 && hostile(G, e.id, g.owner) && (g.kind === 'war' || g.kind === 'monster'))) continue;
      f.work++;
      if (f.work >= 90) {
        f.order = null; f.work = 0;
        s.owner = e.id; s.sb = { owner: e.id, lvl: 0, mods: [], hp: 0, sh: 0, queue: [], dis: 0 }; sbReset(G, s);
        updateOwnership(G); revealAround(G, e, here, 1);
        if (!e.ai) log(G, e.id, `Outpost completed: ${s.name} is now yours.`, here, 'good');
        for (const w of s.lanes) { const o2 = G.systems[w].owner; if (o2 >= 0 && o2 !== e.id && G.empires[o2].kind === 'major') meet(G, e.id, o2); }
      }
    } else if (o.t === 'station') {
      const p = G.planets[o.planet];
      if (here !== p.sys) { if (moveTo(G, f, p.sys)) cancelOrder(G, f); continue; }
      if (G.systems[here].owner !== e.id) { cancelOrder(G, f); continue; }
      f.work++;
      if (f.work >= 60) { f.order = null; f.work = 0; p.station = RESEARCH.includes(Object.keys(p.dep)[0]) ? 'lab' : 'mine'; dirty(e); if (!e.ai) log(G, e.id, `${p.station === 'lab' ? 'Research' : 'Mining'} station built at ${p.name}.`, here, 'build'); }
    } else if (o.t === 'colonize') {
      const p = G.planets[o.planet];
      if (here !== p.sys) { if (moveTo(G, f, p.sys)) f.order = null; continue; }
      const err = canColonize(G, e, o.planet);
      if (err && !(err.startsWith('A colony ark'))) { f.order = null; if (!e.ai) log(G, e.id, `Colonization of ${p.name} failed: ${err}.`, here, 'bad'); continue; }
      f.work += workRate(G, e, f);
      if (f.work >= 200) {
        p.col = newColony(G, e, p, 2); p.col.auto = !!e.ai || !!(G.cfg.autoColonies && !e.ai);
        const s = G.systems[here];
        if (s.owner < 0) { s.owner = e.id; s.sb = { owner: e.id, lvl: 0, mods: [], hp: 0, sh: 0, queue: [], dis: 0 }; sbReset(G, s); }
        removeFleet(G, f); updateOwnership(G); dirty(e);
        log(G, e.ai ? e.id : e.id, `New colony founded on ${p.name}.`, here, 'good');
      }
    } else if (o.t === 'invade') {
      const p = G.planets[o.planet];
      if (here !== p.sys) { if (moveTo(G, f, p.sys)) f.order = null; continue; }
      if (!p.col && !p.prim) { f.order = null; continue; }
      if (p.col && !hostile(G, e.id, p.col.owner)) { f.order = null; continue; }
      if (!orbitClear(G, e.id, here)) continue;
      landArmies(G, f, p);
    } else if (o.t === 'bombard') {
      const p = G.planets[o.planet];
      if (here !== p.sys) { if (moveTo(G, f, p.sys)) f.order = null; continue; }
      if (!p.col || !hostile(G, e.id, p.col.owner)) { f.order = null; continue; }
      if (!orbitClear(G, e.id, here)) continue;
      const shield = p.col.bld.includes('pshield') ? 0.5 : 1;
      const dm = empMods(G, G.empires[p.col.owner]);
      p.col.fort = Math.max(0, p.col.fort - (0.6 + fleetPower(G, f) / 400) * shield / (1 + mv(dm, 'fort+') * 0.3));
      if (p.col.fort <= 0 && G.day % 45 === 0 && p.col.pops > 2) { p.col.pops--; addExhaustion(G, p.col.owner, e.id, 1); }
    }
  }
}
function orbitClear(G, eid, sid) {
  const s = G.systems[sid];
  if (s.sb && s.sb.owner !== eid && hostile(G, eid, s.sb.owner) && !s.sb.dis) return false;
  for (const g of G.fleets) if (g.sys === sid && g.prog === 0 && (g.kind === 'war' || g.kind === 'monster') && hostile(G, eid, g.owner)) return false;
  return true;
}
SW.orbitClear = orbitClear;
function finishSurvey(G, e, sid) {
  const s = G.systems[sid];
  e.surv[sid] = 1; revealAround(G, e, sid, 1);
  if (!e.ai) log(G, e.id, `Survey of ${s.name} complete.`, sid, 'info');
  if (s.anom && s.anom.by < 0 && !s.anom.done) {
    const chance = 0.75 * (1 + mv(empMods(G, e), 'anomaly%') / 100);
    if (rnd(G) < chance) {
      s.anom.by = e.id; s.anom.key = pickAnomaly(G, e, s);
      if (!e.ai) log(G, e.id, `Anomaly discovered in ${s.name}: ${EVENTS[s.anom.key].title}. Send a surveyor to study it.`, sid, 'event');
    }
  }
  for (const pid of s.planets) { const p = G.planets[pid]; if (p.prim && !e.flags['prim' + pid]) { e.flags['prim' + pid] = 1; startEvent(G, e, 'prim_found', { sys: sid, planet: pid }); break; } }
}

// ---------- starbases ----------
function bestWeaponTier(e) { if (e._mods && e._mods._bwt) return e._mods._bwt; let t = 1; for (const id in e.techs) { const T = TECHS[id]; if (T && T.un.comp && COMPS[T.un.comp] && COMPS[T.un.comp].slot === 'w') t = Math.max(t, COMPS[T.un.comp].tier); } if (e._mods) e._mods._bwt = t; return t; }
function sbStats(G, sys) {
  const sb = sys.sb, e = G.empires[sb.owner], L = SB_LEVELS[sb.lvl], m = empMods(G, e);
  let hull = L.hull, dmg = L.dmg;
  for (const k of sb.mods) { const M = SB_MODULES[k]; hull += M.hull || 0; if (sb.lvl > 0) dmg += M.dmg || 0; }
  const f = 1 + mv(m, 'sbDef%') / 100;
  const wt = 1 + 0.2 * (bestWeaponTier(e) - 1);
  return { hull: Math.round(hull * f), shield: Math.round(L.shield * f), dmg: Math.round(dmg * f * wt), armor: 0, evasion: 0 };
}
SW.sbStats = sbStats;
function sbReset(G, sys) { const st = sbStats(G, sys); sys.sb.hp = st.hull; sys.sb.sh = st.shield; }
function sbLevelTech(lvl) { return lvl === 1 ? 'keep_starbase' : lvl === 2 ? 'citadel_starbase' : lvl === 3 ? 'bastion_starbase' : null; }
function canSbUpgrade(G, e, sid) {
  const s = G.systems[sid], sb = s.sb; if (!sb || sb.owner !== e.id) return 'Not your starbase';
  if (sb.lvl >= 3) return 'Fully upgraded';
  if (sb.queue.some(q => q.k === 'up')) return 'Upgrade in progress';
  if (sb.dis) return 'Starbase is disabled';
  const t = sbLevelTech(sb.lvl + 1); if (!e.techs[t]) return 'Requires ' + TECHS[t].name;
  if (sb.lvl === 0 && sbUsed(G, e) >= sbCap(G, e)) return 'Starbase capacity reached (' + sbCap(G, e) + ')';
  if (!canAfford(e, scaleCost(G, e, SB_LEVELS[sb.lvl + 1].cost))) return 'Not enough alloys';
  return null;
}
function canSbModule(G, e, sid, key) {
  const s = G.systems[sid], sb = s.sb; if (!sb || sb.owner !== e.id) return 'Not your starbase';
  if (!SB_MODULES[key]) return 'Unknown';
  if (sb.dis) return 'Starbase is disabled';
  if (sb.mods.length + sb.queue.filter(q => q.k === 'mod').length >= SB_LEVELS[sb.lvl].slots) return 'No free module slot';
  if (!canAfford(e, scaleCost(G, e, SB_MODULES[key].cost))) return 'Not enough alloys';
  return null;
}
function sbQueue(G, e, sid, k, key) {
  const s = G.systems[sid];
  let err, cost, days;
  if (k === 'up') { err = canSbUpgrade(G, e, sid); if (err) return err; cost = scaleCost(G, e, SB_LEVELS[s.sb.lvl + 1].cost); days = SB_LEVELS[s.sb.lvl + 1].days; }
  else if (k === 'mod') { err = canSbModule(G, e, sid, key); if (err) return err; cost = scaleCost(G, e, SB_MODULES[key].cost); days = SB_MODULES[key].days; }
  else if (k === 'ship') {
    err = canBuildShip(G, e, sid, key); if (err) return err;
    const d = designById(e, key), st = designStats(G, e, d); cost = st.cost; days = st.days;
  } else return 'Unknown';
  pay(e, cost);
  s.sb.queue.push({ k, key, prog: 0, total: buildDays(G, e, days), cost });
  return null;
}
function canBuildShip(G, e, sid, designId) {
  const s = G.systems[sid], sb = s.sb; if (!sb || sb.owner !== e.id) return 'Not your starbase';
  if (!sb.mods.includes('shipyard')) return 'Needs a shipyard';
  if (sb.dis) return 'Starbase is disabled';
  const d = designById(e, designId); if (!d) return 'Unknown design';
  if (!hullAvailable(e, d.hull)) return 'Hull not available';
  if (sb.queue.filter(q => q.k === 'ship').length >= 10) return 'Queue is full';
  const st = designStats(G, e, d);
  if (!canAfford(e, st.cost)) return 'Not enough ' + (st.civ ? 'minerals' : 'alloys');
  if (d.hull === 'colony' && !colonies(G, e).length) return 'Needs a colony';
  return null;
}
SW.canSbUpgrade = canSbUpgrade; SW.canSbModule = canSbModule; SW.sbQueue = sbQueue; SW.canBuildShip = canBuildShip;
function sbCancel(G, e, sid, idx) { const sb = G.systems[sid].sb; const q = sb.queue[idx]; if (!q) return; for (const r in q.cost) e.res[r] += Math.round(q.cost[r] * 0.9); sb.queue.splice(idx, 1); }
SW.sbCancel = sbCancel;
function shipyards(G, e) { return ownedSystems(G, e).filter(sid => { const sb = G.systems[sid].sb; return sb && sb.owner === e.id && sb.mods.includes('shipyard') && !sb.dis; }); }
SW.shipyards = shipyards;
function sbBuildDay(G) {
  for (const s of G.systems) {
    const sb = s.sb; if (!sb) continue;
    if (!sb.queue.length) {
      if (!sb.dis && G.day % 5 === 0) { const st = sbStats(G, s); if (sb.hp < st.hull || sb.sh < st.shield) if (!G._fight || !G._fight[s.id]) { sb.hp = Math.min(st.hull, sb.hp + st.hull * 0.05); sb.sh = Math.min(st.shield, sb.sh + st.shield * 0.15); } }
      continue;
    }
    if (sb.dis) continue;
    const e = G.empires[sb.owner];
    let yards = sb.mods.filter(x => x === 'shipyard').length, other = 1;
    for (const q of sb.queue.slice()) {
      if (q.k === 'ship') { if (yards <= 0) continue; yards--; } else { if (other <= 0) continue; other--; }
      q.prog++;
      if (q.prog < q.total) continue;
      sb.queue.splice(sb.queue.indexOf(q), 1);
      if (q.k === 'up') { sb.lvl++; sbReset(G, s); dirty(e); if (!e.ai) log(G, e.id, `Starbase at ${s.name} upgraded to ${SB_LEVELS[sb.lvl].name}.`, s.id, 'build'); }
      else if (q.k === 'mod') { sb.mods.push(q.key); dirty(e); if (!e.ai) log(G, e.id, `${SB_MODULES[q.key].name} completed at ${s.name}.`, s.id, 'build'); }
      else shipCompleted(G, e, s.id, q.key);
    }
  }
}
function shipCompleted(G, e, sid, did) {
  const d = designById(e, did); if (!d) return;
  const H = HULLS[d.hull];
  if (H.civ) {
    const f = makeFleet(G, e.id, sid, [did], d.hull === 'surveyor' ? 'survey' : d.hull);
    if (!e.ai) log(G, e.id, `${f.name} launched at ${G.systems[sid].name}.`, sid, 'build');
    return f;
  }
  const lim = cmdLimit(G, e);
  let f = G.fleets.find(x => x.owner === e.id && x.kind === 'war' && x.sys === sid && !x.path.length && x.prog === 0 && x.newShips && fleetCmd(G, x) + H.size <= lim);
  if (!f) { f = makeFleet(G, e.id, sid, [], 'war'); f.newShips = 1; }
  const st = designStats(G, e, d);
  f.ships.push({ d: did, hp: st.hull, ar: st.armor, sh: st.shield });
  dirty(e);
  if (!e.ai) log(G, e.id, `${d.name} completed at ${G.systems[sid].name} (${f.name}).`, sid, 'build');
  return f;
}
SW.shipCompleted = shipCompleted;

// ---------- fleet management ----------
function mergeFleets(G, a, b) {
  if (a.owner !== b.owner || a.kind !== b.kind || a.sys !== b.sys || a.prog || b.prog) return 'Fleets must be together';
  if (a.kind === 'war' && fleetCmd(G, a) + fleetCmd(G, b) > cmdLimit(G, G.empires[a.owner])) return 'Over the fleet command limit';
  a.ships.push(...b.ships); removeFleet(G, b); a.newShips = 0; return null;
}
function splitFleet(G, f) {
  if (f.ships.length < 2 || f.prog) return 'Cannot split';
  const half = f.ships.splice(Math.ceil(f.ships.length / 2));
  const g = makeFleet(G, f.owner, f.sys, half, f.kind); return g;
}
function refitCost(G, e, f) {
  let cost = 0, n = 0;
  for (const s of f.ships) { const d = designById(e, s.d); if (!d || !d.obsolete) continue; const nb = bestDesign(G, e, d.hull); if (nb === d.id) continue; cost += Math.max(10, designStats(G, e, designById(e, nb)).cost.alloys - designStats(G, e, d).cost.alloys); n++; }
  return { alloys: Math.round(cost), n };
}
function refitFleet(G, f) {
  const e = G.empires[f.owner]; const s = G.systems[f.sys];
  if (!s.sb || s.sb.owner !== e.id || !s.sb.mods.includes('shipyard') || f.prog) return 'Must be docked at one of your shipyards';
  const c = refitCost(G, e, f); if (!c.n) return 'Nothing to upgrade';
  if (e.res.alloys < c.alloys) return 'Not enough alloys';
  e.res.alloys -= c.alloys;
  for (const sh of f.ships) { const d = designById(e, sh.d); if (!d || !d.obsolete) continue; const nb = bestDesign(G, e, d.hull); const st = designStats(G, e, designById(e, nb)); sh.d = nb; sh.hp = st.hull; sh.ar = st.armor; sh.sh = st.shield; }
  return null;
}
SW.mergeFleets = mergeFleets; SW.splitFleet = splitFleet; SW.refitCost = refitCost; SW.refitFleet = refitFleet;
function disbandFleet(G, f) { removeFleet(G, f); dirty(G.empires[f.owner]); }
SW.disbandFleet = disbandFleet;

// automated civilians (player's auto-explore and auto-build toggles, and the AI)
function nearestUnsurveyed(G, e, f) {
  const d = jumpDist(G, [f.prog && f.path.length ? f.path[0] : f.sys], 40);
  const taken = new Set(G.fleets.filter(g => g.owner === e.id && g !== f && g.order && (g.order.t === 'survey' || g.order.t === 'anomaly')).map(g => g.order.sys));
  let best = -1, bd = 1e9;
  for (const s of G.systems) {
    if (d[s.id] < 0 || taken.has(s.id)) continue;
    const anomaly = s.anom && s.anom.by === e.id && !s.anom.done;
    if (!anomaly && (e.surv[s.id] || !e.known[s.id])) continue;
    if (G.fleets.some(g => g.sys === s.id && g.prog === 0 && g.kind === 'monster' && hostile(G, e.id, g.owner))) continue;
    const sc = d[s.id] - (anomaly ? 2 : 0) + (s.owner >= 0 && s.owner !== e.id ? 1 : 0);
    if (sc < bd) { bd = sc; best = s.id; }
  }
  return best;
}
function autoSurvey(G, e, f) {
  if (f.order || f.path.length) return;
  const sid = nearestUnsurveyed(G, e, f);
  if (sid < 0) return;
  const s = G.systems[sid];
  if (s.anom && s.anom.by === e.id && !s.anom.done && e.surv[sid]) orderFleet(G, f, { t: 'anomaly', sys: sid });
  else orderFleet(G, f, { t: 'survey', sys: sid });
}
function autoBuild(G, e, f) {
  if (f.order || f.path.length) return;
  for (const sid of ownedSystems(G, e)) for (const pid of G.systems[sid].planets) if (!canStation(G, e, pid)) { if (!orderFleet(G, f, { t: 'station', planet: pid })) return; }
}
function autoCivilians(G, e) {
  for (const f of G.fleets) {
    if (f.owner !== e.id || !f.auto) continue;
    if (f.kind === 'survey') autoSurvey(G, e, f);
    else if (f.kind === 'builder') autoBuild(G, e, f);
  }
}
SW.autoSurvey = autoSurvey;
