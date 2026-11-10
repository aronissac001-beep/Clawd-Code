// ===== economy.js : modifiers, planets, pops, jobs, stability, monthly income, construction =====
function empMods(G, e) {
  if (e._mods) return e._mods;
  const m = {};
  const add = (src) => { if (src) for (const k in src) m[k] = (m[k] || 0) + src[k]; };
  if (e.kind === 'major') {
    const sp = G.species[e.species];
    for (const t of sp.traits) add(TRAITS[t].mods);
    for (const x of e.ethos) add(ETHOS[x].mods);
    add(GOVS[e.gov] && GOVS[e.gov].mods);
    for (const id in e.techs) { const t = TECHS[id]; if (t && t.un.mods) add(t.un.mods); }
    for (const k of RESEARCH) if (e.rep[k]) { const r = REPEATABLE[k].mods; for (const mk in r) m[mk] = (m[mk] || 0) + r[mk] * e.rep[k]; }
    for (const tr in e.trads) {
      const T = TRADITIONS[tr], n = e.trads[tr];
      add(T.adopt);
      for (let i = 0; i < n - 1 && i < T.nodes.length; i++) add(T.nodes[i].mods);
      if (n > T.nodes.length) add(T.finish);
    }
    for (const k in e.edicts) if (e.edicts[k] > G.day) add(EDICTS[k].mods);
    if (e.legacy) add({ 'energy%': 2 * e.legacy, 'minerals%': 2 * e.legacy, 'alloys%': 2 * e.legacy, 'research%': 2 * e.legacy, 'stability+': Math.min(10, e.legacy) });
    for (const t of e.timed) if (t.until > G.day) add(t.mods);
    if (e.ai) { const d = DIFFICULTY[G.cfg.difficulty] || DIFFICULTY.normal; m.aiBonus = d.ai * 100; }
  }
  e._mods = m;
  return m;
}
SW.empMods = empMods;
function dirty(e) { e._mods = null; e._econ = null; }
SW.dirty = dirty;
const mv = (m, k) => m[k] || 0;

function habitability(G, sp, p, e) {
  const T = PLANET_TYPES[p.type]; if (!T || !T.hab) return 0;
  let base;
  if (p.home) base = 1;
  else if (p.type === 'garden') base = 1;
  else if (p.type === 'relic') base = 0.7;
  else if (p.type === sp.pref) base = 0.8;
  else if (T.climate === PLANET_TYPES[sp.pref].climate) base = 0.6;
  else base = 0.2;
  const add = e ? mv(empMods(G, e), 'hab+') / 100 : 0;
  return clamp(base + add, 0, 1);
}
SW.habitability = habitability;
function distCaps(p) {
  const c = PLANET_TYPES[p.type].caps || [1, 1, 1];
  const f = x => Math.max(1, Math.round(p.size * 0.3 * x));
  return { habitat: p.size, generator: f(c[0]), mining: f(c[1]), farming: f(c[2]), industrial: p.size };
}
function distTotal(col) { let n = 0; for (const k in col.dist) n += col.dist[k]; for (const q of col.queue) if (q.k === 'd') n++; return n; }
function bldSlots(p) { return Math.min(12, 1 + Math.floor(p.col.pops / 5) + (p.home ? 1 : 0)); }
function bldUsed(col) { return col.bld.filter(b => b !== 'seat' && b !== 'hub').length + col.queue.filter(q => q.k === 'b').length; }
SW.distCaps = distCaps; SW.bldSlots = bldSlots; SW.bldUsed = bldUsed;

// Full report of one colony: jobs, housing, amenities, stability, output and upkeep
function planetReport(G, p) {
  const c = p.col, e = G.empires[c.owner], m = empMods(G, e), sp = G.species[c.sp];
  const hab = habitability(G, sp, p, e);
  let housing = 0, amen = 0, stabB = 0, armies = 2, pct = {}, flat = {}, upkeep = {}, naval = 0, sprawl = 0;
  const slots = {};
  for (const k in c.dist) {
    const n = c.dist[k]; if (!n) continue; const D = DISTRICTS[k];
    housing += D.housing * n; amen += (D.amen || 0) * n;
    for (const j in D.jobs) slots[j] = (slots[j] || 0) + D.jobs[j] * n;
    for (const r in D.upkeep) addTo(upkeep, r, D.upkeep[r] * n);
  }
  for (const b of c.bld) {
    const B = BUILDINGS[b];
    housing += B.housing || 0; amen += B.amen || 0; stabB += B.stab || 0; armies += B.armies || 0; naval += B.naval || 0; sprawl += B.sprawl || 0;
    if (B.jobs) for (const j in B.jobs) slots[j] = (slots[j] || 0) + B.jobs[j];
    if (B.pct) for (const r in B.pct) addTo(pct, r, B.pct[r]);
    if (B.flat) for (const r in B.flat) addTo(flat, r, B.flat[r]);
    if (B.upkeep) for (const r in B.upkeep) addTo(upkeep, r, B.upkeep[r]);
  }
  // fill jobs by strata
  const order = Object.keys(JOBS).filter(j => slots[j]);
  const filled = {}; let left = c.pops;
  for (let s = 0; s <= 2; s++) {
    const js = order.filter(j => JOBS[j].strata === s); const S = sum(js, j => slots[j]);
    if (!S) continue;
    if (left >= S) { for (const j of js) filled[j] = slots[j]; left -= S; continue; }
    let given = 0; for (const j of js) { filled[j] = Math.floor(slots[j] * left / S); given += filled[j]; }
    let rem = left - given;
    for (const j of js) { if (rem <= 0) break; if (filled[j] < slots[j]) { filled[j]++; rem--; } }
    left = 0;
  }
  const unemployed = left;
  // amenities
  for (const j in filled) amen += (JOBS[j].amen || 0) * filled[j];
  amen *= 1 + mv(m, 'amen%') / 100;
  const demand = c.pops;
  // stability
  const sb = [];
  const push = (label, v) => { if (Math.abs(v) >= 0.5) sb.push([label, Math.round(v)]); };
  push('Base', 50);
  push('Empire modifiers', mv(m, 'stability+'));
  push('Buildings', stabB);
  for (const j in filled) if (JOBS[j].stab) push('Wardens', JOBS[j].stab * filled[j]);
  if (DESIGNATIONS[c.desig] && DESIGNATIONS[c.desig].stab) push('Designation', DESIGNATIONS[c.desig].stab);
  const ad = amen - demand;
  push(ad >= 0 ? 'Amenities surplus' : 'Amenities shortage', ad >= 0 ? Math.min(10, ad * 0.5) : Math.max(-30, ad * 1.5));
  if (unemployed > 1) push('Unemployment', -(unemployed - 1) * 3);
  if (c.pops > housing) push('Overcrowding', -(c.pops - housing) * 3);
  if (hab < 1) push('Habitability', -(1 - hab) * 15);
  const df = e.deficit || {};
  if (df.energy) push('Energy deficit', -10);
  if (df.goods) push('Goods shortage', -15);
  if (df.food) push('Starvation', -15);
  if (df.influence) push('Influence debt', -5);
  const ex = warExhaustionOf(G, e.id); if (ex > 0) push('War exhaustion', -ex * 0.12);
  if (c.unrest > 0) push('Recent unrest', -c.unrest);
  if (c.occupied) push('Newly conquered', -15);
  if (e.flags.plague && e.flags.plague > G.day && p.id === e.capital) push('Plague', -10);
  const stab = clamp(sum(sb, x => x[1]), 0, 100);
  const sMult = stab >= 60 ? 1 + (stab - 60) / 200 : stab < 40 ? Math.max(0.5, 1 - (40 - stab) / 80) : 1;
  // output
  const out = {}, cons = {};
  const desJobs = DESIGNATIONS[c.desig] && DESIGNATIONS[c.desig].jobs || [];
  const ai = mv(m, 'aiBonus') / 100;
  const resPct = r => mv(m, r + '%') + (RESEARCH.includes(r) ? mv(m, 'research%') : 0) + (pct[r] || 0);
  const mineralShort = df.minerals ? 0.5 : 1;
  for (const j in filled) {
    const J = JOBS[j], n = filled[j]; if (!n) continue;
    const dj = desJobs.includes(j) ? 0.15 : 0;
    const shortMul = J.in && J.in.minerals ? mineralShort : 1;
    for (const r in J.out) addTo(out, r, J.out[r] * n * (1 + resPct(r) / 100 + dj + ai) * sMult * shortMul * (df.energy ? 0.85 : 1) * (df.goods && RESEARCH.includes(r) ? 0.75 : 1));
    if (J.in) for (const r in J.in) addTo(cons, r, J.in[r] * n);
  }
  for (const r in flat) addTo(out, r, flat[r] * (1 + resPct(r) / 100 + ai));
  addTo(cons, 'food', c.pops * POP_UPKEEP.food * (1 + mv(m, 'popFood%') / 100));
  addTo(cons, 'goods', c.pops * POP_UPKEEP.goods * (1 + mv(m, 'popGoods%') / 100));
  for (const r in upkeep) addTo(cons, r, upkeep[r]);
  // growth
  const free = housing - c.pops;
  let gRate = (5 + 0.1 * c.pops) * hab * (1 + (mv(m, 'growth%') + (pct.growth || 0)) / 100);
  if (free <= 0) gRate = 0;
  if (df.food) gRate = 0;
  const gNeed = 50 + 3 * c.pops;
  const defMax = Math.round((armies + Math.floor(c.pops / 5) + sum(Object.keys(filled), j => (JOBS[j].armies || 0) * filled[j])) * DEF_ARMY.hp * (1 + mv(m, 'armyHp%') / 100));
  return { hab, housing, free, amen: Math.round(amen), demand, stab: Math.round(stab), stabBreak: sb, sMult, slots, filled, unemployed, out, cons, gRate, gNeed, defMax, naval, sprawl, pct };
}
SW.planetReport = planetReport;

function stationOutput(G, p, m) {
  if (!p.station || !p.dep) return null;
  const out = {};
  const ai = mv(m, 'aiBonus') / 100;
  for (const r in p.dep) out[r] = p.dep[r] * 1.5 * (1 + (mv(m, r + '%') + (RESEARCH.includes(r) ? mv(m, 'research%') : 0)) / 100 + ai);
  return out;
}
function navalUsed(G, e) { let n = 0; for (const f of G.fleets) if (f.owner === e.id && f.kind === 'war') for (const s of f.ships) n += shipSize(G, e, s); return n; }
function navalCap(G, e) {
  if (e._ncDay === G.day && e._nc != null && e._ncVer === G._ownVer) return e._nc;
  const m = empMods(G, e); let cap = 20 + mv(m, 'naval+');
  for (const sid of ownedSystems(G, e)) { const sb = G.systems[sid].sb; if (sb && sb.owner === e.id) cap += 4 * sb.mods.filter(x => x === 'anchorage').length; }
  for (const p of colonies(G, e)) for (const b of p.col.bld) cap += BUILDINGS[b].naval || 0;
  e._nc = cap; e._ncDay = G.day; e._ncVer = G._ownVer;
  return cap;
}
SW.navalUsed = navalUsed; SW.navalCap = navalCap;
function sprawlInfo(G, e) {
  const m = empMods(G, e), cols = colonies(G, e);
  const used = ownedSystems(G, e).length + cols.length * 4 + sum(cols, p => p.col.pops) * 0.2;
  let cap = 40 + mv(m, 'sprawl+'); for (const p of cols) for (const b of p.col.bld) cap += BUILDINGS[b].sprawl || 0;
  return { used: Math.round(used), cap, over: Math.max(0, Math.round(used - cap)) };
}
SW.sprawlInfo = sprawlInfo;
function sbCap(G, e) { return 2 + colonies(G, e).length + mv(empMods(G, e), 'sbCap+'); }
function sbUsed(G, e) { let n = 0; for (const sid of ownedSystems(G, e)) { const sb = G.systems[sid].sb; if (sb && sb.owner === e.id && sb.lvl > 0) n++; } return n; }
SW.sbCap = sbCap; SW.sbUsed = sbUsed;

// Empire-wide monthly balance with a breakdown per resource
function empireEcon(G, e) {
  if (e._econ && e._econDay === G.day) return e._econ;
  const m = empMods(G, e), net = {}, brk = {};
  const add = (r, v, label) => { if (!v) return; net[r] = (net[r] || 0) + v; (brk[r] = brk[r] || {}); brk[r][label] = (brk[r][label] || 0) + v; };
  const planets = {};
  for (const p of colonies(G, e)) {
    const rep = planetReport(G, p); planets[p.id] = rep;
    for (const r in rep.out) add(r, rep.out[r], 'Planet jobs');
    for (const r in rep.cons) add(r, -rep.cons[r], r === 'food' || r === 'goods' ? 'Pops and specialists' : 'Upkeep and inputs');
  }
  for (const sid of ownedSystems(G, e)) {
    const s = G.systems[sid];
    for (const pid of s.planets) { const so = stationOutput(G, G.planets[pid], m); if (so) for (const r in so) add(r, so[r], 'Stations'); }
    if (s.sb && s.sb.owner === e.id) {
      add('energy', -SB_LEVELS[s.sb.lvl].upkeep, 'Starbases');
      for (const md of s.sb.mods) if (SB_MODULES[md].energy) add('energy', SB_MODULES[md].energy * (1 + mv(m, 'energy%') / 100 + (e.ethos.includes('mercantile') ? 0.25 : 0)), 'Trade hubs');
    }
  }
  // ships and armies
  const used = navalUsed(G, e), cap = navalCap(G, e), over = used > cap ? used / cap : 1;
  let shipE = 0, shipA = 0, civ = 0, armies = 0;
  for (const f of G.fleets) {
    if (f.owner !== e.id) continue;
    if (f.kind === 'war') for (const s of f.ships) { const z = shipSize(G, e, s); shipE += 0.5 * z; shipA += 0.1 * z; }
    else if (f.kind === 'army') armies += f.ships.length * 0.4;
    else civ += f.ships.length * 0.5;
  }
  add('energy', -shipE * over, 'Fleet upkeep'); add('alloys', -shipA * over, 'Fleet upkeep');
  add('energy', -civ, 'Civilian ships'); add('energy', -armies, 'Armies');
  // base income
  add('influence', 3 + mv(m, 'influence+'), 'Base');
  const capP = G.planets[e.capital];
  if (!capP || !capP.col || capP.col.owner !== e.id) add('influence', -1, 'No capital');
  // treaties
  for (const k in e.rel) {
    const r = e.rel[k]; if (!r.treaties) continue;
    if (r.treaties.trade) add('energy', 3 + Math.min(10, colonies(G, G.empires[k]).length) * (e.ethos.includes('mercantile') ? 0.8 : 0.5), 'Trade pacts');
    if (r.treaties.nap || r.treaties.alliance || r.treaties.research || r.treaties.trade) add('influence', -0.25 * Object.keys(r.treaties).filter(t => r.treaties[t]).length, 'Treaty upkeep');
  }
  const ra = researchAgreementBonus(G, e);
  if (ra) for (const r of RESEARCH) add(r, (net[r] || 0) * ra, 'Research agreements');
  // sprawl penalty is applied to costs, shown separately
  for (const r in net) net[r] = Math.round(net[r] * 100) / 100;
  e._econ = { net, brk, planets, naval: { used, cap } };
  e._econDay = G.day;
  return e._econ;
}
SW.empireEcon = empireEcon;

function monthlyEconomy(G, e) {
  e._econ = null;
  const ec = empireEcon(G, e);
  const df = {};
  for (const r of STOCK_RES) {
    e.res[r] = (e.res[r] || 0) + (ec.net[r] || 0);
    if (e.res[r] < 0) { df[r] = 1; e.res[r] = 0; }
    const capR = r === 'influence' ? 1000 : r === 'unity' ? 1e9 : 25000;
    if (e.res[r] > capR) e.res[r] = capR;
  }
  // starvation kills pops; alloy debt damages fleets
  if (df.food) for (const p of colonies(G, e)) if (p.col.pops > 1 && rchance(G, 0.15)) { p.col.pops--; if (!e.ai) log(G, e.id, `Starvation on ${p.name}: a pop has died.`, p.sys, 'bad'); }
  if (df.alloys) for (const f of G.fleets) if (f.owner === e.id && f.kind === 'war') for (const s of f.ships) s.hp = Math.max(1, s.hp * 0.97);
  if (!e.ai) for (const r in df) if (!e.deficit[r]) log(G, e.id, `${RES_INFO[r].name} deficit! Stockpile is empty.`, -1, 'bad');
  e.deficit = df;
  // growth and planet upkeep
  for (const p of colonies(G, e)) {
    const c = p.col, rep = ec.planets[p.id];
    c.stab = rep.stab;
    if (rep.gRate > 0) {
      c.grow += rep.gRate;
      if (c.grow >= rep.gNeed) { c.grow = 0; c.pops++; if (!e.ai && c.pops % 5 === 0) log(G, e.id, `${p.name} has grown to ${c.pops} pops.`, p.sys, 'good'); }
    } else if (rep.free < 0 && c.pops > 1 && rchance(G, 0.08)) c.pops--; // emigration from overcrowding
    if (c.unrest > 0) c.unrest = Math.max(0, c.unrest - 1);
    if (c.occupied && G.day - c.occupied > 720) c.occupied = 0;
    c.def = Math.min(rep.defMax, c.def + rep.defMax * 0.1);
    c.fort = Math.min(100, c.fort + 5);
    if (rep.stab < 15 && rchance(G, 0.06)) {
      c.unrest = 10;
      const b = c.bld.filter(x => x !== 'seat' && x !== 'hub');
      if (b.length && rchance(G, 0.4)) { const k = rpick(G, b); c.bld.splice(c.bld.indexOf(k), 1); log(G, e.id, `Riots on ${p.name} destroyed the ${BUILDINGS[k].name}.`, p.sys, 'bad'); }
      else log(G, e.id, `Unrest on ${p.name}. Stability is dangerously low.`, p.sys, 'bad');
    }
    if (c.auto) autoPlanet(G, e, p);
  }
  dirty(e);
}

// ---------- planet construction ----------
function scaleCost(G, e, cost, kind) {
  const m = empMods(G, e), out = {};
  const f = 1 + (kind === 'ship' ? mv(m, 'shipCost%') : mv(m, 'buildCost%')) / 100;
  for (const r in cost) out[r] = Math.round(cost[r] * f);
  return out;
}
function canAfford(e, cost) { for (const r in cost) if ((e.res[r] || 0) < cost[r]) return false; return true; }
function pay(e, cost, f) { for (const r in cost) e.res[r] -= cost[r] * (f || 1); dirty(e); }
SW.canAfford = canAfford; SW.scaleCost = scaleCost;
function buildDays(G, e, d) { return Math.max(10, Math.round(d / (1 + mv(empMods(G, e), 'buildSpeed%') / 100))); }
function bldAvailable(G, e, p, key) {
  const B = BUILDINGS[key]; if (!B || B.capital || B.colony) return false;
  if (B.tech && !e.techs[B.tech]) return false;
  if (B.unique && (p.col.bld.includes(key) || p.col.queue.some(q => q.key === key))) return false;
  return true;
}
// returns null if ok, else a reason
function canQueue(G, e, p, kind, key) {
  const c = p.col; if (!c || c.owner !== e.id) return 'Not your colony';
  if (c.queue.length >= 5) return 'Queue is full';
  if (kind === 'd') {
    const caps = distCaps(p), have = (c.dist[key] || 0) + c.queue.filter(q => q.k === 'd' && q.key === key).length;
    if (distTotal(c) >= p.size) return 'No district space left';
    if (have >= caps[key]) return 'No room for more ' + DISTRICTS[key].name.toLowerCase() + ' districts';
    if (!canAfford(e, scaleCost(G, e, DISTRICTS[key].cost))) return 'Not enough resources';
  } else if (kind === 'b') {
    if (!bldAvailable(G, e, p, key)) return 'Not available';
    if (bldUsed(c) >= bldSlots(p)) return 'No free building slot (grows with pops)';
    if (!canAfford(e, scaleCost(G, e, BUILDINGS[key].cost))) return 'Not enough resources';
  } else if (kind === 'a') {
    const A = ARMIES[key]; if (!A || (A.tech && !e.techs[A.tech])) return 'Not available';
    if (c.pops < 3) return 'Needs 3 pops';
    if (!canAfford(e, A.cost)) return 'Not enough resources';
  }
  return null;
}
function queueBuild(G, e, p, kind, key) {
  const err = canQueue(G, e, p, kind, key); if (err) return err;
  const def = kind === 'd' ? DISTRICTS[key] : kind === 'b' ? BUILDINGS[key] : ARMIES[key];
  const cost = kind === 'a' ? def.cost : scaleCost(G, e, def.cost);
  pay(e, cost);
  p.col.queue.push({ k: kind, key, prog: 0, total: buildDays(G, e, def.days), cost });
  return null;
}
function cancelBuild(G, e, p, idx) {
  const q = p.col.queue[idx]; if (!q) return;
  for (const r in q.cost) e.res[r] += Math.round(q.cost[r] * 0.9);
  p.col.queue.splice(idx, 1); dirty(e);
}
function demolish(G, e, p, kind, key) {
  const c = p.col; if (!c || c.owner !== e.id) return 'Not your colony';
  if (kind === 'd') { if (!c.dist[key]) return 'None to remove'; c.dist[key]--; }
  else { const i = c.bld.indexOf(key); if (i < 0 || key === 'seat' || key === 'hub') return 'Cannot remove'; c.bld.splice(i, 1); }
  dirty(e); return null;
}
SW.canQueue = canQueue; SW.queueBuild = queueBuild; SW.cancelBuild = cancelBuild; SW.demolish = demolish; SW.bldAvailable = bldAvailable;
function buildDay(G) {
  for (const p of G.planets) {
    const c = p.col; if (!c || !c.queue.length) continue;
    const q = c.queue[0];
    q.prog++;
    if (q.prog >= q.total) {
      c.queue.shift();
      const e = G.empires[c.owner];
      if (q.k === 'd') { c.dist[q.key] = (c.dist[q.key] || 0) + 1; }
      else if (q.k === 'b') c.bld.push(q.key);
      else if (q.k === 'a') {
        let f = G.fleets.find(x => x.owner === e.id && x.kind === 'army' && x.sys === p.sys && !x.path.length && !x.order);
        if (!f) f = makeFleet(G, e.id, p.sys, [], 'army');
        const A = ARMIES[q.key]; f.ships.push({ d: q.key, hp: Math.round(A.hp * (1 + mv(empMods(G, e), 'armyHp%') / 100)) });
      }
      dirty(e);
      if (!e.ai) log(G, e.id, `${p.name}: ${q.k === 'd' ? DISTRICTS[q.key].name + ' district' : q.k === 'b' ? BUILDINGS[q.key].name : ARMIES[q.key].name} completed.`, p.sys, 'build');
    }
  }
  sbBuildDay(G);
}
// automation: the planet chooses its own builds (used by AI and by the player's automated colonies)
function autoPlanet(G, e, p) {
  const c = p.col; if (c.queue.length >= 1) return;
  const ec = empireEcon(G, e), net = ec.net, rep = ec.planets[p.id] || planetReport(G, p);
  const mins = e.res.minerals;
  if (mins < 150) return;
  const caps = distCaps(p);
  const room = k => (c.dist[k] || 0) < caps[k] && distTotal(c) < p.size;
  const jobsFree = sum(Object.keys(rep.slots), j => rep.slots[j] - (rep.filled[j] || 0));
  const tryD = k => room(k) && !queueBuild(G, e, p, 'd', k);
  const tryB = k => !queueBuild(G, e, p, 'b', k);
  // housing first if crowded
  if (rep.free <= 1 && tryD('habitat')) return;
  if (rep.amen < rep.demand - 2) { if (e.techs.holo_arts && tryB('theater')) return; if (tryB('temple')) return; if (tryD('habitat')) return; }
  if (jobsFree >= 3 && rep.free > 2) return; // let pops fill jobs first
  if ((net.food || 0) < 2 && (tryD('farming') || (e.techs.hydroponics && tryB('hydro')))) return;
  if ((net.energy || 0) < 4 && tryD('generator')) return;
  if ((net.goods || 0) < 1 && (tryB('workshop') || tryD('industrial'))) return;
  if ((net.minerals || 0) < 8 && tryD('mining')) return;
  // specialists when slots allow
  if (bldUsed(c) < bldSlots(p) && c.pops >= 6) {
    const P = e.persona ? PERSONAS[e.persona] : PERSONAS.scholarly;
    const wants = [];
    const unityLow = (net.unity || 0) < 5 + colonies(G, e).length;
    const sprawl = sprawlInfo(G, e);
    if (sprawl.over > 10) wants.push('hall');
    if ((net.alloys || 0) < 6 + colonies(G, e).length * 2 * P.fleet) wants.push('foundry');
    wants.push('lab');
    if (unityLow) wants.push(e.ethos.includes('devout') || e.ethos.includes('zealous') ? 'temple' : 'hall');
    for (const k of ['grandlab', 'observatory', 'genelab', 'proving', 'refinery', 'nexus', 'processing', 'crucible', 'monument', 'clinic', 'exchange', 'pshield', 'arcology', 'admiralty']) wants.push(k);
    if (P.research > 1.2) wants.unshift('lab');
    if (P.fleet > 1.2) wants.unshift('foundry');
    for (const k of wants) if (bldAvailable(G, e, p, k) && tryB(k)) return;
  }
  // otherwise grow the strongest district
  const order = rshuffle(G, ['generator', 'mining', 'farming', 'industrial', 'habitat']);
  if ((net.alloys || 0) < 10) order.unshift('industrial');
  for (const k of order) if (tryD(k)) return;
}
SW.autoPlanet = autoPlanet;
function setDesignation(G, e, p, d) { if (p.col && p.col.owner === e.id && DESIGNATIONS[d]) { p.col.desig = d; dirty(e); } }
SW.setDesignation = setDesignation;

// ---------- galactic market: energy is the currency ----------
var MARKET = { minerals: 1, food: 0.9, alloys: 3.2, goods: 2.4 };
function marketPrice(G, e, r, buy) { const b = MARKET[r]; return buy ? b * (e.ethos.includes('mercantile') ? 1.15 : 1.3) : b * (e.ethos.includes('mercantile') ? 0.7 : 0.6); }
function marketTrade(G, e, r, amt, buy) {
  if (!MARKET[r] || amt <= 0) return 'Invalid trade';
  const price = Math.ceil(marketPrice(G, e, r, buy) * amt);
  if (buy) { if (e.res.energy < price) return 'Not enough energy'; e.res.energy -= price; e.res[r] += amt; }
  else { if (e.res[r] < amt) return 'Not enough ' + RES_INFO[r].name.toLowerCase(); e.res[r] -= amt; e.res.energy += Math.floor(marketPrice(G, e, r, false) * amt); }
  return null;
}
SW.marketPrice = marketPrice; SW.marketTrade = marketTrade;
