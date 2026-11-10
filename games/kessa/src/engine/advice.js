// ===== advice.js : the colony advisor: forecasts, problems and what to build next =====
// each item: { sev: 'bad'|'warn'|'info', id, text, at?: {x,y}, act?: { k: 'build'|'connect'|'tab'|'show', ... } }
function mainNets(G) { const L = G.buildings.find(b => b.t === 'lander'); return { pn: L ? L._pn : -1, wn: L ? L._wn : -1, L }; }
function nearestFreeDeposit(G, type, from) {
  let best = null, bd = 1e9;
  for (const d of G.deposits) { if (d.type !== type || d.amount <= 50 || !depKnown(G, d) || G.buildings.some(b => b.dep === d.id)) continue; const dd = Math.hypot(d.x - from.x, d.y - from.y); if (dd < bd) { bd = dd; best = d; } }
  return best;
}
function plannedMake(G, r) { let s = 0; for (const b of G.buildings) if (!b.built && !b.mod) { const d = BUILDINGS[b.t]; if (d.make && d.make[r]) s += d.make[r]; } return s; }
function freeDome(G, slots) { for (const b of G.buildings) if (!b.mod && b.built && BUILDINGS[b.t].dome && domeFree(G, b) >= slots) return b; return null; }
function lifeTotals(G) {
  const o = { w: { prod: 0, dem: 0, sto: 0 }, o: { prod: 0, dem: 0, sto: 0 } };
  if (G._wnets) for (const n of G._wnets.values()) for (const k of ['w', 'o']) { o[k].prod += Math.max(0, n[k].prod); o[k].dem += n[k].dem; o[k].sto += n[k].sto; }
  return o;
}
// expected daily solar/wind/other output, the dark-hours deficit, and battery capacity
function powerBudget(G) {
  let daily = 0, steady = 0, demand = 0, cap = 0, planned = 0;
  const sunAvg = 0.37 * 24, perSolar = BUILDINGS.solar.gen.amt * sunAvg * (1 + M(G, 'solar'));
  for (const b of G.buildings) {
    if (!b.on || b.broken) continue; const d = def(b);
    if (!b.built) { if (d.gen || d.battery) planned++; if (!d.gen && !d.battery) continue; }
    if (d.gen) { if (d.gen.kind === 'solar') daily += d.gen.amt * sunAvg * (1 + M(G, 'solar')); else if (d.gen.kind === 'fuel') { if (G.res.fuel > 5) { daily += d.gen.amt * 24 * 0.5; steady += d.gen.amt * 0.5; } } else { const a = d.gen.kind === 'wind' ? d.gen.amt * 1.4 : d.gen.amt * 0.9; daily += a * 24; steady += a; } }
    if (d.make && d.make.power) { daily += d.make.power * 24; steady += d.make.power; }
    if (d.battery) cap += d.battery * (1 + M(G, 'battery'));
    if (d.use && d.use.power) demand += d.use.power * (d.jobs && !d.auto ? 0.8 : 1) * (1 + M(G, 'powerUse'));
  }
  return { daily, demand, cap, night: Math.max(0, demand - steady) * 11, perSolar, planned };
}
function hoursText(h) { return h > 48 ? Math.round(h / 24) + ' sols' : Math.max(1, Math.round(h)) + ' h'; }
function advice(G) {
  const out = [], pop = G.colonists.length, sol = solOf(G.tick), { pn, wn, L } = mainNets(G), base = L ? center(L) : { x: 32, y: 32 };
  const add = (sev, id, text, extra) => out.push(Object.assign({ sev, id, text }, extra || {}));
  const rate = k => (G.rate[k] || []).reduce((a, b) => a + b, 0);
  // decisions and deadlines first
  if (G.event) add('bad', 'event', 'A decision is waiting: ' + EVENTS[G.event.id].title + '.', { act: { k: 'event' } });
  if (!G.st.everColonists && !G.rockets.some(r => r.ark.length)) { const left = DIFFICULTY[G.cfg.difficulty].patience - sol, why = arkBlock(G); add(left < 12 ? 'bad' : why ? 'info' : 'warn', 'patience', 'The sponsor expects colonists within ' + left + ' sols. ' + (why ? 'Before an ark can launch: ' + why : 'Ready: open Rockets → Colonists, pick applicants and launch an ark.'), { act: why && /Living Quarters/.test(why) && freeDome(G, 1) ? { k: 'module', dome: freeDome(G, 1).id, type: 'quarters' } : { k: 'tab', tab: 'rockets' } }); }
  const C = G.contracts && G.contracts.active;
  if (C) { const left = (C.due - G.tick) / 24; add(left < 3 ? 'warn' : 'info', 'contract', 'Contract "' + C.name + '": ' + Math.floor(contractProgress(G, C)) + ' / ' + C.need + ', ' + Math.max(0, Math.ceil(left)) + ' sols left.', { act: { k: 'tab', tab: 'rockets' } }); }
  if (G.contracts && G.contracts.offer) add('info', 'offer', 'The sponsor offers a contract worth ' + G.contracts.offer.reward + ' funding.', { act: { k: 'tab', tab: 'rockets' } });
  // life support forecasts
  const T = lifeTotals(G);
  const domesLived = G.buildings.filter(b => !b.mod && BUILDINGS[b.t].dome && b.built);
  if (domesLived.length) {
    for (const [k, name, build] of [['o', 'Oxygen', 'airsynth'], ['w', 'Water', 'icedrill']]) {
      const R = T[k], net = R.prod + plannedMake(G, k === 'o' ? 'oxygen' : 'water') - R.dem;
      if (net < -0.01) {
        const hrs = R.sto / -net;
        let fix = k === 'o' ? 'Build an Air Synthesizer (or an Algae Reactor).' : '';
        if (k === 'w') { const d = nearestFreeDeposit(G, 'ice', base); fix = d ? 'Build an Ice Drill on the ice at ' + d.x + ',' + d.y + ', or Frost Condensers anywhere.' : 'No free water ice is known: survey more sectors (Layers → Survey), build Frost Condensers, research Water Reclamation and Deep Sounding.'; }
        add(hrs < 24 ? 'bad' : 'warn', 'short-' + k, name + ' use exceeds production by ' + round1(-net) + '/h: tanks last ' + hoursText(hrs) + '. ' + fix, { act: { k: 'build', type: k === 'o' ? 'airsynth' : (nearestFreeDeposit(G, 'ice', base) ? 'icedrill' : 'condenser') } });
      } else if (R.prod > 0 && R.sto < R.dem * 6 && pop > 0) add('info', 'tank-' + k, name + ' tanks are low (' + Math.round(R.sto) + '). Add ' + (k === 'o' ? 'Air' : 'Water') + ' Tanks as a buffer for storms.', { act: { k: 'build', type: k === 'o' ? 'airtank' : 'watertank' } });
    }
  }
  // ice running out
  for (const b of G.buildings) if (b.t === 'icedrill' && b.built) { const d = G.deposits[b.dep]; if (d && d.amount > 0 && d.amount / 2.4 < 5 * 24) { const nd = nearestFreeDeposit(G, 'ice', b); add('warn', 'ice-' + b.id, 'An Ice Drill\'s deposit runs dry in about ' + hoursText(d.amount / 2.4) + '. ' + (nd ? 'Next free ice: ' + nd.x + ',' + nd.y + '.' : 'No other free ice is known yet.'), { at: { x: b.x + 1, y: b.y + 1 } }); } }
  // power
  let prod = 0, dem = 0, sto = 0, cap = 0; if (G._pnets) for (const n of G._pnets.values()) { prod += n.prod; dem += n.demand; sto += n.stored; cap += n.cap; }
  const env = G._env || envNow(G);
  // a day/night energy budget: daily generation vs use, and battery size vs the night gap
  const pb = powerBudget(G);
  if (pb.demand > 0) {
    if (pb.planned >= 3) add('info', 'power-wip', pb.planned + ' power buildings are under construction.');
    else if (pb.daily < pb.demand * 24 * 1.05) add(dem > prod + sto + 0.5 ? 'bad' : 'warn', 'power', 'Power: you use about ' + Math.round(pb.demand * 24) + ' a sol but make only ' + Math.round(pb.daily) + '. Build about ' + Math.max(1, Math.ceil((pb.demand * 24 * 1.15 - pb.daily) / pb.perSolar)) + ' more Solar Arrays (or Wind Masts).', { act: { k: 'build', type: 'solar' } });
    else if (pb.night > pb.cap * 0.95) add(dem > prod + sto + 0.5 ? 'bad' : 'warn', 'night', 'Nights need about ' + Math.round(pb.night) + ' stored power but batteries hold ' + Math.round(pb.cap) + '. Build about ' + Math.max(1, Math.ceil((pb.night * 1.1 - pb.cap) / 60)) + ' more Battery Banks.', { act: { k: 'build', type: 'battery' } });
  }
  const up = G.hz.upcoming.find(u => u.kind === 'dust');
  if (up) add('warn', 'dust', 'Dust storm in ' + Math.max(0, up.at - G.tick) + ' h: solar will collapse. Wind Masts and Fuel Generators keep running; consider turning off factories (lower their priority).', { act: { k: 'build', type: 'wind' } });
  // food
  if (pop > 0) {
    const eatPerSol = pop * Math.max(0.4, 1 + M(G, 'foodUse')), r = rate('food');
    const farmsPlanned = G.buildings.filter(b => !b.built && (b.t === 'hydro' || b.t === 'greenhouse' || b.t === 'vfarm')).length;
    if (r < -0.5 && G.res.food / -r < 6 && !farmsPlanned) { const fd = freeDome(G, 1); add(G.res.food / -r < 2 ? 'bad' : 'warn', 'food', 'Food falls by ' + Math.round(-r) + ' a sol: ' + Math.round(G.res.food) + ' left, about ' + hoursText(G.res.food / -r * 24) + '. ' + (fd ? 'Add Hydroponics to a dome' : 'Build a Greenhouse') + ', and make sure farms have workers. Food can also come by rocket.', { act: fd ? { k: 'module', dome: fd.id, type: 'hydro' } : { k: 'build', type: 'greenhouse' } }); }
    // homes and jobs
    const info = G._domes || domeInfo(G), homes = [...info.values()].reduce((s, I) => s + I.cap, 0);
    const homesPlanned = G.buildings.some(b => !b.built && (b.t === 'quarters' || b.t === 'apartments' || (!b.mod && BUILDINGS[b.t].dome)));
    if (homes - pop < 3 && !homesPlanned) { const fd = freeDome(G, 1); add(homes < pop ? 'warn' : 'info', 'homes', (homes < pop ? (pop - homes) + ' colonists have no bed.' : 'Homes are nearly full.') + (fd ? ' Add Living Quarters to a dome.' : ' Every dome is full: build a new dome.'), { act: fd ? { k: 'module', dome: fd.id, type: 'quarters' } : { k: 'build', type: 'dome_s' } }); }
    const idle = G.colonists.filter(c => canWork(c) && !c.job).length;
    if (idle >= 4) add('info', 'idle', idle + ' adults have no job. Build workplaces near their domes, or open more shifts.', { act: { k: 'tab', tab: 'people' } });
    let open = 0; for (const b of G.buildings) { if (!b.built || !b.jobs || !b.on) continue; const d = def(b); for (let s2 = 0; s2 < 2; s2++) if (b.shifts[s2]) open += Math.max(0, staffSlots(G, d) - b.jobs[s2].length); }
    if (open >= 8 && idle === 0) add('info', 'jobs', open + ' day-shift job slots are empty. Bring more colonists by ark.', { act: { k: 'tab', tab: 'rockets' } });
  }
  // materials
  for (const k of ['parts', 'metals', 'sinter']) {
    const r = rate(k); if (!(G.res[k] < 15 && r <= 0.5 && sol > 4)) continue;
    const maker = { parts: 'works', metals: 'oremine', sinter: 'sinterer' }[k], has = G.buildings.some(b => b.t === maker);
    const needsCrew = (k === 'parts' || k === 'metals') && !G.colonists.length;
    add('warn', 'mat-' + k, RES[k].name + ' are running out (' + Math.floor(G.res[k]) + '). Upkeep stops without them. ' + (needsCrew || has ? 'Order ' + RES[k].name.toLowerCase() + ' by rocket' + (needsCrew ? ': a ' + BUILDINGS[maker].name + ' needs colonists to work it.' : ', and make sure your ' + BUILDINGS[maker].name + ' has workers.') : 'Build a ' + BUILDINGS[maker].name + (k === 'sinter' ? ' on fine regolith.' : ' and staff it, or order by rocket.')), { act: needsCrew || has ? { k: 'tab', tab: 'rockets' } : { k: 'build', type: maker } });
  }
  const cap2 = storageCap(G); for (const k of ['metals', 'sinter', 'food']) if (G.res[k] >= cap2 - 0.5) add('info', 'full-' + k, RES[k].name + ' storage is full: production is wasted. Build a Cargo Depot.', { act: { k: 'build', type: 'depot' } });
  // funding
  const fr = (G.st.lastStipend || 0) - (G.st.lastPayroll || 0);
  if (sol > 20 && G.funds < 400 && pop > 0) add('warn', 'funds', 'Funding is low (' + Math.round(G.funds) + '; stipend ' + (G.st.lastStipend || 0) + ', payroll ' + (G.st.lastPayroll || 0) + ' a sol). Mine rare metals and export them on returning rockets, and take sponsor contracts.', { act: { k: 'build', type: 'raremine' } });
  if (G.res.rare >= 20 && !G.exportOn) add('info', 'export', 'You hold ' + Math.floor(G.res.rare) + ' rare metals but exports are off.', { act: { k: 'tab', tab: 'rockets' } });
  // grid and drones
  let stranded = 0, strandedB = null; for (const b of G.buildings) if (b.built && !b.mod && b.t !== 'lander' && (b._pn !== pn || b._wn !== wn) && ((BUILDINGS[b.t].use && (BUILDINGS[b.t].use.power || BUILDINGS[b.t].use.water)) || BUILDINGS[b.t].make || BUILDINGS[b.t].dome)) { stranded++; strandedB = strandedB || b; }
  if (stranded) add('warn', 'grid', stranded + ' building' + (stranded > 1 ? 's are' : ' is') + ' not on the main grid. Tap it and use Connect to grid.', { at: { x: strandedB.x + strandedB.s / 2, y: strandedB.y + strandedB.s / 2 }, act: { k: 'connect', id: strandedB.id } });
  const hubs = hubsOf(G); let farSite = null;
  for (const b of G.buildings) if (!b.built && !b.mod) { const c = center(b); if (!hubs.some(h => cheb(h.x, h.y, c.x, c.y) <= h.r + 0.5)) { farSite = b; break; } }
  if (farSite) add('warn', 'nodrones', 'The ' + BUILDINGS[farSite.t].name + ' site has no drones in range. Send the Drone Crawler there, or build a Drone Hub nearby.', { at: { x: farSite.x + farSite.s / 2, y: farSite.y + farSite.s / 2 }, act: G.vehicles.some(v => v.t === 'crawler') ? { k: 'crawler', id: farSite.id } : { k: 'build', type: 'hub' } });
  const waiting = G.buildings.filter(b => !b.built && !b.paid && b._st === 'materials').length;
  if (waiting >= 2) add('info', 'materials', waiting + ' construction sites wait for materials. Lower the construction reserve or raise their priority to High.', { act: { k: 'show', what: 'reserve' } });
  // research
  if (!G.research.cur && Object.keys(TECHS).some(id => techAvailable(G, id))) add('warn', 'research', 'Nothing is being researched.', { act: { k: 'tab', tab: 'research' } });
  // what next
  if (!out.some(a => a.sev !== 'info')) {
    const next = !G.buildings.some(b => b.t === 'dome_s' || b.t === 'dome_m' || b.t === 'dome_l') ? ['Build a dome next to your base for the first colonists.', 'dome_s']
      : !G.buildings.some(b => b.t === 'lab') && pop >= 8 ? ['Build a Research Station: scientists research much faster.', 'lab']
        : !G.buildings.some(b => b.t === 'raremine') && pop >= 8 ? ['Build a Rare Ore Extractor: rare metals are your main export income.', 'raremine']
          : !G.buildings.some(b => b.t === 'works') && pop >= 6 ? ['Build a Machine Works to make your own parts.', 'works'] : null;
    if (next) add('info', 'next', next[0], { act: { k: 'build', type: next[1] } });
    else add('info', 'ok', 'Things look steady. Check Goals for the road to Independence.', { act: { k: 'tab', tab: 'goals' } });
  }
  const order = { bad: 0, warn: 1, info: 2 };
  return out.sort((a, b) => order[a.sev] - order[b.sev]);
}
// plan cable and pipe from a building to the main grid along the cheapest open route
function autoConnect(G, id, dryRun) {
  const b = bById(G, id); if (!b || b.mod) return { err: 'Nothing to connect' };
  if (G._netDirty) computeNets(G);
  const { pn, wn } = mainNets(G), n = MAP_N, s = b.s;
  const mine = (x, y) => x >= b.x && y >= b.y && x < b.x + s && y < b.y + s;
  const okTile = (x, y) => x >= 0 && y >= 0 && x < n && y < n && !G._occ[y * n + x] && G._T.slope[y * n + x] <= SLOPE_LINE;
  const isGoal = (x, y) => { for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= n || yy >= n || mine(xx, yy)) continue; const k = yy * n + xx; if (G._occ[k] && G._cableNet[k] === pn && G._pipeNet[k] === wn) return true; } const k = y * n + x; return (G.cable[k] === 1 && G._cableNet[k] === pn) || G.cable[k] === 3; };
  const prev = new Int32Array(n * n).fill(-1), q = [];
  for (let i = 0; i < s; i++) for (const [x, y] of [[b.x + i, b.y - 1], [b.x + i, b.y + s], [b.x - 1, b.y + i], [b.x + s, b.y + i]]) if (okTile(x, y) && prev[y * n + x] === -1) { prev[y * n + x] = -2; q.push(y * n + x); }
  let end = -1;
  for (let qi = 0; qi < q.length; qi++) { const i = q[qi], x = i % n, y = (i / n) | 0; if (isGoal(x, y)) { end = i; break; } for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (okTile(xx, yy) && prev[yy * n + xx] === -1) { prev[yy * n + xx] = i; q.push(yy * n + xx); } } }
  if (end < 0) return { err: 'No open route to the main grid (slopes or buildings in the way)' };
  const path = []; for (let c = end; c >= 0; c = prev[c]) path.push([c % n, (c / n) | 0]);
  const newC = path.filter(([x, y]) => !G.cable[y * n + x]).length, newP = path.filter(([x, y]) => !G.pipe[y * n + x]).length;
  const cost = Math.round((newC + newP) * BUILDINGS.cable.cost.metals * 100) / 100;
  if (dryRun) return { ok: true, tiles: path.length, cost, path };
  if (newC) placeLine(G, 'cable', path); if (newP) placeLine(G, 'pipe', path);
  return { ok: true, tiles: path.length, cost, path };
}
// will the colony support n more colonists? returns a list of problems
function arkCheck(G, n, foodIn) {
  const T = lifeTotals(G), probs = [];
  const o = T.o.prod - T.o.dem - n * 0.1 * (1 + M(G, 'o2Use')), w = T.w.prod - T.w.dem - n * 0.07;
  if (o < 0) probs.push('Oxygen: production would fall short by ' + round1(-o) + '/h (tanks ' + Math.round(T.o.sto) + ').');
  if (w < 0) probs.push('Water: production would fall short by ' + round1(-w) + '/h (tanks ' + Math.round(T.w.sto) + ').');
  const info = G._domes || domeInfo(G), homes = [...info.values()].reduce((s, I) => s + I.cap, 0), inbound = G.rockets.reduce((s, r) => s + (r.st === 'out' ? r.ark.length : 0), 0);
  if (homes < G.colonists.length + inbound + n) probs.push('Homes: ' + homes + ' beds for ' + (G.colonists.length + inbound + n) + ' people.');
  // farms already built will be staffed by the newcomers: count them at two full shifts
  let farmCap = 0; for (const b of G.buildings) if (b.built && b.on) { const d = def(b); if (d.prod && d.prod.out && d.prod.out.food) farmCap += d.prod.out.food * (d.jobs ? 16 : 24) * prodMult(G, b); }
  const eat = (G.colonists.length + inbound + n) * Math.max(0.4, 1 + M(G, 'foodUse'));
  const r = Math.max((G.rate.food || []).reduce((a, b) => a + b, 0) - n, farmCap * 0.85 - eat);
  const stock = G.res.food + (foodIn || 0);
  if (r < 0 && stock < -r * 8) probs.push('Food: stocks' + (foodIn ? ' (with this cargo)' : '') + ' would last about ' + Math.max(0, Math.round(stock / -r)) + ' sols.');
  return probs;
}
// drive the crawler next to a site so its drones can work there
function sendCrawler(G, id) {
  const b = bById(G, id), v = G.vehicles.find(x => x.t === 'crawler'); if (!b || !v) return { err: 'No Drone Crawler' };
  const c = center(b), r = Math.ceil(b.s / 2) + 1;
  for (const [dx, dy] of [[r, 0], [0, r], [-r, 0], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r], [r + 2, 0], [0, r + 2]]) { const res = moveVehicle(G, v.id, Math.round(c.x + dx), Math.round(c.y + dy)); if (res.ok) return res; }
  return { err: 'No route for the crawler' };
}
function autoConnectSite(G, id) { return autoConnect(G, id, false); }
Object.assign(KC, { sendCrawler, arkCheck, powerBudget, autoConnectSite, advice, autoConnect, nearestFreeDeposit, lifeTotals });
