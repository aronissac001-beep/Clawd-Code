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
// immediate dangers to people: domes failing now, starvation, falling health; each with a cause and time left
function dangers(G) {
  const out = [], info = G._domes || domeInfo(G), groups = new Map();
  for (const I of info.values()) {
    if (!I.res.length) continue;
    const b = I.b, name = BUILDINGS[b.t].name, at = { x: b.x + b.s / 2, y: b.y + b.s / 2 };
    if (!b.built || !I.ok) { out.push({ id: 'dome-' + b.id, text: I.res.length + ' colonists live in an unfinished or broken ' + name + ' and are losing health.', extra: { at } }); continue; }
    const minH = Math.min(...I.res.map(c => c.health));
    const lack = [];
    if (b._of !== undefined && b._of < 0.99) lack.push(['oxygen', 'airsynth', 4.5 * (1 - b._of)]);
    if (b._wf !== undefined && b._wf < 0.99) lack.push(['water', 'icedrill', 1.6 * (1 - b._wf)]);
    if (b._pf !== undefined && b._pf < 0.5) lack.push(['power', 'battery', 0.4]);
    if (!lack.length) continue;
    const loss = lack.reduce((s, l) => s + l[2], 0), hrs = minH / Math.max(0.1, loss), key = lack.map(l => l[0]).join(' and ');
    const g = groups.get(key) || { domes: 0, res: 0, hrs: 1e9, at, lack }; g.domes++; g.res += I.res.length; if (hrs < g.hrs) { g.hrs = hrs; g.at = at; } groups.set(key, g);
  }
  for (const [key, g] of groups) {
    const k0 = g.lack[0][0], offT = { oxygen: ['airsynth', 'algae'], water: ['icedrill', 'condenser', 'reclaimer'], power: ['solar', 'wind', 'fuelgen', 'battery', 'thinfilm', 'reactor'] }[k0];
    const down = G.buildings.filter(x => x.built && offT.includes(x.t) && (!x.on || x.broken)).length;
    const fix = (down ? down + ' ' + (k0 === 'oxygen' ? 'air' : k0 === 'water' ? 'water' : 'power') + ' building' + (down > 1 ? 's are' : ' is') + ' switched off or broken. ' : '') + (k0 === 'oxygen' ? 'Restore or build Air Synthesizers, or move people to a dome with air.' : k0 === 'water' ? 'Restore water production on the domes\' pipe network.' : 'Add power or batteries for the domes.');
    out.push({ id: 'dome-' + key, text: (g.domes > 1 ? g.domes + ' domes are' : 'A dome is') + ' short of ' + key + ' right now: ' + g.res + ' residents could die in about ' + hoursText(g.hrs) + '. ' + fix, extra: { at: g.at, act: { k: 'build', type: g.lack[0][1] } } });
  }
  const pop = G.colonists.length;
  if (pop && G.res.food < 1) out.push({ id: 'starving', text: 'Food has run out: ' + pop + ' colonists are starving. Order food by rocket and get farms staffed.', extra: { act: { k: 'tab', tab: 'rockets' } } });
  const sick = G.colonists.filter(c => c.health < 70);
  if (sick.length && !out.length) out.push({ id: 'sick', text: sick.length + ' colonist' + (sick.length > 1 ? 's are' : ' is') + ' in poor health (lowest ' + Math.round(Math.min(...sick.map(c => c.health))) + '). Check their dome\'s life support, food and clinic.', extra: { act: { k: 'tab', tab: 'people' } } });
  return out;
}
// hours until oxygen and water run out at today's rates, and the crises worth an emergency measure
function lifeForecast(G) {
  const T = lifeTotals(G), out = {};
  for (const k of ['o', 'w']) { const R = T[k], net = R.prod - R.dem; out[k] = { net, hrs: net < -0.01 ? R.sto / -net : Infinity, sto: R.sto }; }
  return out;
}
function emergencies(G, dz) {
  const out = [], F = lifeForecast(G), pop = G.colonists.length; if (!pop) return out;
  const airBad = dz.some(d => /oxygen/.test(d.text)) || F.o.hrs < 12, waterBad = dz.some(d => /water/.test(d.text)) || F.w.hrs < 18;
  if (airBad && !candleCheck(G).err) out.push({ sev: 'bad', id: 'em-candles', text: 'Emergency: light oxygen candles (' + (candleCheck(G).stock ? 'the lander\'s own stock, restocked every 25 sols' : CANDLE.fuel + ' fuel, ' + CANDLE.polymers + ' polymers') + '): +' + CANDLE.rate + ' oxygen an hour in every inhabited dome for ' + CANDLE.hours + ' h, time to repair or build air.', act: { k: 'crisis', what: 'candles', label: 'Light candles' } });
  else if (airBad && G.candles && G.candles.until > G.tick) out.push({ sev: 'warn', id: 'em-candles', text: 'Oxygen candles are burning: ' + (G.candles.until - G.tick) + ' h left. Fix the air before they go out.' });
  const sh = shelterOffer(G);
  if ((airBad || waterBad) && sh.ok && G.colonists.some(c => c.health < 75)) out.push({ sev: 'bad', id: 'em-shelter', text: 'Emergency: move the ' + sh.n + ' most at risk (of ' + sh.of + ' in failing domes) into the lander\'s shelter for ' + Math.round(SHELTER.hours / 24 * 10) / 10 + ' sols. They are safe there but cannot work, and their sanity falls.', act: { k: 'crisis', what: 'shelter', label: 'Shelter ' + sh.n } });
  const foodLow = (G.rate.food || []).reduce((a, b) => a + b, 0) < -0.5 && G.res.food < pop * 3;
  if ((waterBad || foodLow) && !G.ration) out.push({ sev: 'warn', id: 'em-ration', text: 'Ration water and food: domes use half the water per person and everyone eats 30% less, at a cost in sanity and comfort.', act: { k: 'crisis', what: 'ration', label: 'Ration' } });
  if (G.ration && !waterBad && !foodLow) out.push({ sev: 'info', id: 'em-unration', text: 'Rationing is on, but water and food look safe now. Lift it to restore morale.', act: { k: 'crisis', what: 'unration', label: 'Lift rationing' } });
  // out of upkeep materials and unable to buy them: the emergency drop
  const upk = upkeepPerSol(G), dry = ['parts', 'sinter', 'metals'].filter(k => G.res[k] < 5 && (upk[k] || 0) > 0.5);
  const canBuy = G.funds > 300 && G.rockets.some(r => r.st === 'home');
  const lifeRisk = G.buildings.some(b => b.built && !b.mod && (['airsynth', 'icedrill', 'condenser', 'algae', 'reclaimer'].includes(b.t) || BUILDINGS[b.t].dome) && (b.broken || b.wear >= 90));
  if (dry.length && !canBuy && lifeRisk && dropOffer(G).ok) out.push({ sev: 'bad', id: 'em-drop', text: 'Emergency: ' + dry.map(k => RES[k].name.toLowerCase()).join(' and ') + ' are gone and upkeep is failing. The sponsor can drop ' + DROP.give.parts + ' parts, ' + DROP.give.metals + ' metals and ' + DROP.give.sinter + ' sinter right now for ' + dropOffer(G).price + ' funding (into debt if need be) and some confidence.', act: { k: 'crisis', what: 'drop', label: 'Call the drop' } });
  // early warnings: worn life support with no upkeep material, and storms that will cut water
  for (const b of G.buildings) {
    if (!b.built || b.mod || b.broken || !['airsynth', 'icedrill', 'condenser', 'algae', 'reclaimer'].includes(b.t) || b.wear < 85) continue;
    const r = BUILDINGS[b.t].maint; if (G.res[r] >= 1) continue;
    const rate = WEAR_BASE * (BUILDINGS[b.t].wear || 1) * DIFFICULTY[G.cfg.difficulty].maint, hrs = (150 - b.wear) / Math.max(0.05, rate);
    out.push({ sev: hrs < 24 ? 'bad' : 'warn', id: 'wearing-' + b.id, text: 'The ' + BUILDINGS[b.t].name + ' is wearing out and there are no ' + RES[r].name.toLowerCase() + ' for its upkeep: it breaks in about ' + hoursText(hrs) + '. Get ' + RES[r].name.toLowerCase() + ' (rocket, or raise its maker to High priority).', act: { k: 'tab', tab: 'rockets' } });
    break;
  }
  const dust = G.hz.upcoming.find(u => u.kind === 'dust');
  if (dust) {
    let cond = 0; for (const b of G.buildings) if (b.t === 'condenser' && b.built && b.on && !b.broken) cond += b._out || 0;
    const lossW = cond * 0.7, net = F.w.net - lossW;
    if (lossW > 0.2 && net < 0) { const hrs = F.w.sto / -net; if (hrs < (dust.dur || 30)) out.push({ sev: 'warn', id: 'storm-water', text: 'The dust storm in ' + Math.max(0, dust.at - G.tick) + ' h will cut condensers to 30%: water would fall short by ' + round1(-net) + '/h and the tanks last about ' + hoursText(hrs) + ' of the storm\'s ' + hoursText(dust.dur || 30) + '. Add Water Tanks or an Ice Drill now.', act: { k: 'build', type: 'watertank' } }); }
  }
  return out;
}
function hoursText(h) { return h > 48 ? Math.round(h / 24) + ' sols' : Math.max(1, Math.round(h)) + ' h'; }
// materials that upkeep will use per sol at the current wear rates (drones service at 65 wear)
function upkeepPerSol(G) {
  const diff = DIFFICULTY[G.cfg.difficulty].maint, mm = Math.max(0.25, 1 + M(G, 'maint')), out = {};
  for (const b of G.buildings) { if (!b.built || b.mod) continue; const d = BUILDINGS[b.t]; if (!d.maint) continue; out[d.maint] = (out[d.maint] || 0) + WEAR_BASE * (d.wear || 1) * diff * mm * (b.on ? 1 : 0.25) * 24 / 65; }
  return out;
}
function advice(G) {
  const out = [], pop = G.colonists.length, sol = solOf(G.tick), { pn, wn, L } = mainNets(G), base = L ? center(L) : { x: 32, y: 32 };
  const add = (sev, id, text, extra) => out.push(Object.assign({ sev, id, text }, extra || {}));
  const rate = k => (G.rate[k] || []).reduce((a, b) => a + b, 0);
  // people in danger come first, read straight from domes and health (never from forecasts or plans)
  const dz = dangers(G);
  for (const d of dz) add('bad', d.id, d.text, d.extra);
  // emergency measures, offered while people are in danger (or about to be)
  for (const e of emergencies(G, dz)) add(e.sev, e.id, e.text, { act: e.act });
  // decisions and deadlines
  if (G.event) add('bad', 'event', 'A decision is waiting: ' + eventInfo(G).title + '.', { act: { k: 'event' } });
  // the wider world: offers waiting, a beacon about to fade, an idle skimmer
  if (G.world) {
    const W = G.world, beacon = W.sites.find(s => s.fades && !s.claimed && !s.exp);
    if (W.offers.length) add('info', 'trade', W.offers.length + ' trade offer' + (W.offers.length > 1 ? 's' : '') + ' from rival colonies ' + (W.offers.length > 1 ? 'are' : 'is') + ' waiting.', { act: { k: 'tab', tab: 'world', sub: 'trade' } });
    if (beacon && beacon.fades - sol <= 6) add('warn', 'beacon', 'A distress beacon on the world map fades in ' + Math.max(0, beacon.fades - sol) + ' sols: stranded people need an expedition' + (padOf(G) ? '.' : ' (build an Expedition Pad).'), { act: { k: 'tab', tab: 'world', sub: 'exp' } });
    else if (padOf(G) && padOf(G).built && !W.exps.length && W.sites.some(s => !s.claimed && !s.exp) && pop >= 20) add('info', 'skimmer', 'The skimmer is on its pad and ' + W.sites.filter(s => !s.claimed).length + ' remote sites are open.', { act: { k: 'tab', tab: 'world', sub: 'exp' } });
  }
  if (!G.st.everColonists && !G.rockets.some(r => r.ark.length)) { const left = DIFFICULTY[G.cfg.difficulty].patience - sol, why = arkBlock(G); add(left < 12 ? 'bad' : why ? 'info' : 'warn', 'patience', 'The sponsor expects colonists within ' + left + ' sols. ' + (why ? 'Before an ark can launch: ' + why : 'Ready: open Rockets → Ark, pick applicants and launch an ark.'), { act: why && /Living Quarters/.test(why) && freeDome(G, 1) ? { k: 'module', dome: freeDome(G, 1).id, type: 'quarters' } : { k: 'tab', tab: 'rockets' } }); }
  if (G.council) for (const k in FACTIONS) { const d = G.council.dem[k]; if (!d) continue; const left = (d.due - G.tick) / 24; add(left < 2 ? 'warn' : 'info', 'council-' + k, FACTIONS[k].name + ' (support ' + Math.round(G.council.sup[k]) + ') asks: ' + d.text + ' ' + Math.floor(demandProgress(G, d)) + ' / ' + d.need + ', ' + Math.max(0, Math.ceil(left)) + ' sols left.', { act: { k: 'tab', tab: 'people', sub: 'council' } }); }
  // Reshaping Kessa: point at the first step once it is possible
  if (techDone(G, 'hazeforge') && G.colonists.length >= 30 && !G.buildings.some(b => b.t === 'hazeforge')) add('info', 'terra-forge', 'Reshaping Kessa: a Haze Forge warms the planet and thickens the Veil. Over many sols the frost melts, lakes fill the craters and the ground turns green (Goals → Reshaping).', { act: { k: 'build', type: 'hazeforge' } });
  const C = G.contracts && G.contracts.active;
  if (C) { const left = (C.due - G.tick) / 24; add(left < 3 ? 'warn' : 'info', 'contract', 'Contract "' + C.name + '": ' + Math.floor(contractProgress(G, C)) + ' / ' + C.need + ', ' + Math.max(0, Math.ceil(left)) + ' sols left.', { act: { k: 'tab', tab: 'rockets' } }); }
  if (G.contracts && G.contracts.offer) add('info', 'offer', 'The sponsor offers a contract worth ' + G.contracts.offer.reward + ' funding.', { act: { k: 'tab', tab: 'rockets' } });
  // life support forecasts
  const T = lifeTotals(G);
  const domesLived = G.buildings.filter(b => !b.mod && BUILDINGS[b.t].dome && b.built);
  if (domesLived.length) {
    for (const [k, name, build] of [['o', 'Oxygen', 'airsynth'], ['w', 'Water', 'icedrill']]) {
      const R = T[k], net = R.prod - R.dem, wip = plannedMake(G, k === 'o' ? 'oxygen' : 'water');
      if (net < -0.01) {
        const hrs = R.sto / -net;
        let fix = k === 'o' ? 'Build an Air Synthesizer (or an Algae Reactor).' : '';
        if (k === 'w') { const d = nearestFreeDeposit(G, 'ice', base); fix = d ? 'Build an Ice Drill on the ice at ' + d.x + ',' + d.y + ', or Frost Condensers anywhere.' : 'No free water ice is known: survey more sectors (Layers → Survey), build Frost Condensers, research Water Reclamation and Deep Sounding.'; }
        if (wip > 0) fix = 'Sites under construction would add ' + round1(wip) + '/h once drones finish them' + (wip + net < 0 ? ', still not enough. ' + fix : '. Make sure they have drones and materials.');
        add(hrs < 36 || wip + net < 0 ? 'bad' : 'warn', 'short-' + k, name + ' use exceeds production by ' + round1(-net) + '/h: tanks last ' + hoursText(hrs) + '. ' + fix, { act: { k: 'build', type: k === 'o' ? 'airsynth' : (nearestFreeDeposit(G, 'ice', base) ? 'icedrill' : 'condenser') } });
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
    const wipTxt = pb.planned ? ' (' + pb.planned + ' power site' + (pb.planned > 1 ? 's' : '') + ' under construction)' : '';
    if (pb.daily < pb.demand * 24 * 1.05) add(dem > prod + sto + 0.5 ? 'bad' : 'warn', 'power', 'Power: you use about ' + Math.round(pb.demand * 24) + ' a sol but make only ' + Math.round(pb.daily) + wipTxt + '. Build about ' + Math.max(1, Math.ceil((pb.demand * 24 * 1.15 - pb.daily) / pb.perSolar)) + ' more Solar Arrays (or Wind Masts).', { act: { k: 'build', type: 'solar' } });
    else if (pb.night > pb.cap * 0.95) add(dem > prod + sto + 0.5 ? 'bad' : 'warn', 'night', 'Nights need about ' + Math.round(pb.night) + ' stored power but batteries hold ' + Math.round(pb.cap) + wipTxt + '. Build about ' + Math.max(1, Math.ceil((pb.night * 1.1 - pb.cap) / 60)) + ' more Battery Banks.', { act: { k: 'build', type: 'battery' } });
  }
  const up = G.hz.upcoming.find(u => u.kind === 'dust');
  if (up) add('warn', 'dust', 'Dust storm in ' + Math.max(0, up.at - G.tick) + ' h: solar will collapse. Wind Masts and Fuel Generators keep running; consider turning off factories (lower their priority).', { act: { k: 'build', type: 'wind' } });
  // food
  if (pop > 0) {
    const eatPerSol = pop * Math.max(0.4, 1 + M(G, 'foodUse')), r = rate('food');
    const farmsPlanned = G.buildings.filter(b => !b.built && (b.t === 'hydro' || b.t === 'greenhouse' || b.t === 'vfarm')).length;
    if (r < -0.5 && G.res.food / -r < 6) { const fd = freeDome(G, 1); add(G.res.food / -r < 2 ? 'bad' : 'warn', 'food', 'Food falls by ' + Math.round(-r) + ' a sol: ' + Math.round(G.res.food) + ' left, about ' + hoursText(G.res.food / -r * 24) + '. ' + (farmsPlanned ? farmsPlanned + ' farm site(s) are under construction; until they run, ' : '') + (fd ? 'add Hydroponics to a dome' : 'build a Greenhouse') + ', make sure farms have workers, or order food by rocket.', { act: fd ? { k: 'module', dome: fd.id, type: 'hydro' } : { k: 'build', type: 'greenhouse' } }); }
    // homes and jobs
    const info = G._domes || domeInfo(G), homes = [...info.values()].reduce((s, I) => s + I.cap, 0);
    const homesPlanned = G.buildings.some(b => !b.built && (b.t === 'quarters' || b.t === 'apartments' || (!b.mod && BUILDINGS[b.t].dome)));
    if (homes - pop < 3 && !homesPlanned) { const fd = freeDome(G, 1); add(homes < pop ? 'warn' : 'info', 'homes', (homes < pop ? (pop - homes) + ' colonists have no bed.' : 'Homes are nearly full.') + (fd ? ' Add Living Quarters to a dome.' : ' Every dome is full: build a new dome.'), { act: fd ? { k: 'module', dome: fd.id, type: 'quarters' } : { k: 'build', type: 'dome_s' } }); }
    const idle = G.colonists.filter(c => canWork(c) && !c.job).length;
    if (idle >= 4) add('info', 'idle', idle + ' adults have no job. Build workplaces near their domes, open more shifts, or move them (People → Unemployed has one-tap fixes).', { act: { k: 'tab', tab: 'people', filter: 'idle' } });
    let open = 0; for (const b of G.buildings) { if (!b.built || !b.jobs || !b.on) continue; const d = def(b); for (let s2 = 0; s2 < 2; s2++) if (b.shifts[s2]) open += Math.max(0, staffSlots(G, d) - b.jobs[s2].length); }
    if (open >= 8 && idle === 0) add('info', 'jobs', open + ' day-shift job slots are empty. Bring more colonists by ark.', { act: { k: 'tab', tab: 'rockets' } });
  }
  // growth: what the next ark needs
  if (pop > 0 && pop < DIFFICULTY[G.cfg.difficulty].pop && G.rockets.some(r => r.st === 'home') && !G.rockets.some(r => r.st === 'out' && r.ark.length)) {
    const why = arkBlock(G), probs = why ? [why] : arkCheck(G, arkSize(G));
    const domeWip = G.buildings.some(b => !b.built && !b.mod && BUILDINGS[b.t].dome) || G.buildings.some(b => b.mod && !b.built && MODULES[b.t].housing);
    if (domeWip && probs.length && /Homes/.test(probs[0])) probs[0] = probs[0] + ' (new homes are under construction).';
    if (probs.length) { const p0 = probs[0], act = domeWip && /Homes/.test(p0) ? null : /Oxygen/.test(p0) ? { k: 'build', type: 'airsynth' } : /Water/.test(p0) ? { k: 'build', type: nearestFreeDeposit(G, 'ice', base) ? 'icedrill' : 'condenser' } : /Homes|beds|Living Quarters/.test(p0) ? (freeDome(G, 1) ? { k: 'module', dome: freeDome(G, 1).id, type: 'quarters' } : { k: 'build', type: 'dome_s' }) : /Food/.test(p0) ? { k: 'build', type: 'greenhouse' } : { k: 'tab', tab: 'rockets' };
      add('warn', 'nextark', 'Before the next ark of ' + arkSize(G) + ' colonists: ' + probs.join(' '), act ? { act } : {}); }
  }
  // materials: running out now, or falling fast enough to run out within a few sols (upkeep stops without them)
  const upk = upkeepPerSol(G);
  for (const k of ['parts', 'metals', 'sinter', 'polymers', 'electronics']) {
    const r = rate(k), u = upk[k] || 0, stock = G.res[k], sols = r < -0.3 ? stock / -r : Infinity;
    const empty = stock < 15 && r <= 0.5 && sol > 4 && (u > 0.3 || k === 'parts' || k === 'metals' || k === 'sinter');
    if (!empty && !(sols < 5 && u > 0.3)) continue;
    const maker = { parts: 'works', metals: 'oremine', sinter: 'sinterer', polymers: 'polymer', electronics: 'foundry' }[k], has = G.buildings.some(b => b.t === maker), can = unlocked(G, maker);
    const needsCrew = maker !== 'sinterer' && !G.colonists.length;
    const head = empty ? RES[k].name + ' are running out (' + Math.floor(stock) + ' left).' : RES[k].name + ' fall by ' + round1(-r) + ' a sol: ' + Math.floor(stock) + ' left, about ' + hoursText(sols * 24) + '.';
    const domesB = G.buildings.filter(b => !b.mod && BUILDINGS[b.t].dome && b.built);
    const makers = G.buildings.filter(b => b.t === maker && b.built && b.jobs && !BUILDINGS[maker].auto && !b.broken && b.on);
    const reachable = makers.filter(b => domesB.some(d => workplaceReach(G, b, d)));
    if (!needsCrew && makers.length && !reachable.length && G.colonists.length) { add(stock < 5 || sols < 2 ? 'bad' : 'warn', 'mat-' + k, (empty ? RES[k].name + ' are running out (' + Math.floor(stock) + ' left).' : RES[k].name + ' fall by ' + round1(-r) + ' a sol: ' + Math.floor(stock) + ' left.') + ' No dome is close enough for anyone to work your ' + BUILDINGS[maker].name + ': build one within walking range of a dome.', { act: { k: 'build', type: maker, nearDome: true } }); continue; }
    const idleMakers = reachable.filter(b => !b.jobs.some(j => j.length));
    if (!needsCrew && idleMakers.length && G.colonists.length) { add(stock < 5 || sols < 2 ? 'bad' : 'warn', 'mat-' + k, (empty ? RES[k].name + ' are running out (' + Math.floor(stock) + ' left).' : RES[k].name + ' fall by ' + round1(-r) + ' a sol: ' + Math.floor(stock) + ' left.') + ' Your ' + BUILDINGS[maker].name + (idleMakers.length > 1 ? (/s$/.test(BUILDINGS[maker].name) ? ' have' : 's have') : ' has') + ' no workers: other jobs come first. Give ' + (idleMakers.length > 1 ? 'them' : 'it') + ' High priority.', { act: { k: 'prio', ids: idleMakers.map(b => b.id), label: 'High priority' } }); continue; }
    const fix = needsCrew ? 'Order ' + RES[k].name.toLowerCase() + ' by rocket: a ' + BUILDINGS[maker].name + ' needs colonists to work it.'
      : has ? 'Make sure your ' + BUILDINGS[maker].name + ' has workers, build another, or order by rocket.'
        : can ? 'Build a ' + BUILDINGS[maker].name + (k === 'sinter' ? ' on fine regolith' : '') + ', or order by rocket.' : 'Order ' + RES[k].name.toLowerCase() + ' by rocket.';
    add(stock < 5 || sols < 2 ? 'bad' : 'warn', 'mat-' + k, head + (u > 0.3 ? ' Upkeep alone needs about ' + round1(u) + ' a sol; without it buildings wear out and break.' : '') + ' ' + fix, { act: needsCrew || (has && G.funds > 200) || !can ? { k: 'tab', tab: 'rockets' } : { k: 'build', type: maker } });
  }
  const cap2 = storageCap(G); for (const k of ['metals', 'sinter', 'food']) if (G.res[k] >= cap2 - 0.5) add('info', 'full-' + k, RES[k].name + ' storage is full: production is wasted. Build a Cargo Depot, or sell the surplus (Rockets → Exports).', { act: (G.trade.keep[k] || -1) < 0 ? { k: 'tab', tab: 'exports' } : { k: 'build', type: 'depot' } });
  // funding
  const fr = (G.st.lastStipend || 0) - (G.st.lastPayroll || 0);
  if (sol > 20 && G.funds < 400 && pop > 0) {
    const sell = Object.keys(EXPORT).filter(k => EXPORT[k].sat && (G.trade.keep[k] === undefined || G.trade.keep[k] < 0) && G.res[k] > 120).sort((a, b) => G.res[b] * exportPrice(G, b) - G.res[a] * exportPrice(G, a))[0];
    const crit = G.res.parts < 10 || G.res.metals < 15 || G.res.food < pop * 2;
    const adv = crit && G.funds < 150 && !advanceOffer(G).err;
    add('warn', 'funds', 'Funding is low (' + Math.round(G.funds) + '; stipend ' + (G.st.lastStipend || 0) + ', payroll ' + (G.st.lastPayroll || 0) + (G.loan ? ', advance repayment ' + G.loan.per : '') + ' a sol). ' + (adv ? 'Supplies are critical: the sponsor will advance ' + advanceOffer(G).amount + ' funding (Rockets → Sponsor). ' : '') + (sell ? 'You hold ' + Math.floor(G.res[sell]) + ' ' + RES[sell].name.toLowerCase() + ': sell the surplus on returning rockets (Rockets → Exports). ' : '') + 'Mine rare metals for export, and take sponsor contracts.', { act: adv ? { k: 'tab', tab: 'sponsor' } : sell ? { k: 'tab', tab: 'exports' } : { k: 'build', type: 'raremine' } });
  }
  if (G.res.rare >= 20 && !G.exportOn) add('info', 'export', 'You hold ' + Math.floor(G.res.rare) + ' rare metals but exports are off.', { act: { k: 'tab', tab: 'rockets' } });
  // grid and drones
  let stranded = 0, strandedB = null; for (const b of G.buildings) if (b.built && !b.mod && b.t !== 'lander' && (b._pn !== pn || b._wn !== wn) && ((BUILDINGS[b.t].use && (BUILDINGS[b.t].use.power || BUILDINGS[b.t].use.water)) || BUILDINGS[b.t].make || BUILDINGS[b.t].dome)) { stranded++; strandedB = strandedB || b; }
  if (stranded) add('warn', 'grid', stranded + ' building' + (stranded > 1 ? 's are' : ' is') + ' not on the main grid. Use Connect to grid' + (stranded > 1 ? ' on each (Show finds the first).' : '.'), { at: { x: strandedB.x + strandedB.s / 2, y: strandedB.y + strandedB.s / 2 }, act: { k: 'connect', id: strandedB.id } });
  const hubs = hubsOf(G); let farSite = null;
  for (const b of G.buildings) if (!b.built && !b.mod) { const c = center(b); if (!hubs.some(h => cheb(h.x, h.y, c.x, c.y) <= h.r + 0.5)) { farSite = b; break; } }
  if (farSite) add('warn', 'nodrones', 'The ' + BUILDINGS[farSite.t].name + ' site has no drones in range. Send the Drone Crawler there, or build a Drone Hub nearby.', { at: { x: farSite.x + farSite.s / 2, y: farSite.y + farSite.s / 2 }, act: G.vehicles.some(v => v.t === 'crawler') ? { k: 'crawler', id: farSite.id } : { k: 'build', type: 'hub' } });
  const waiting = G.buildings.filter(b => !b.built && !b.paid && b._st === 'materials').length;
  if (waiting >= 2) add('info', 'materials', waiting + ' construction sites wait for materials. Lower the construction reserve or raise their priority to High.', { act: { k: 'show', what: 'reserve' } });
  // research
  if (!G.research.cur && Object.keys(TECHS).some(id => techAvailable(G, id))) add('warn', 'research', 'Nothing is being researched.', { act: { k: 'tab', tab: 'research' } });
  // the road to Independence
  if (techCount(G) >= 16 && pop >= 40 && !techDone(G, 'charter') && G.research.cur !== 'charter' && !G.research.queue.includes('charter')) add('info', 'charter', 'Independence needs the Charter of Kessa (Social research, after Canopy Domes). Queue it now so the labs work towards it.', { act: { k: 'tab', tab: 'research' } });
  if (G.ms.spire && pop >= DIFFICULTY[G.cfg.difficulty].pop && G.funds < buyoutCost(G)) add('info', 'buyout', 'Everything is in place for Independence except ' + Math.ceil(buyoutCost(G) - G.funds) + ' funding for the buyout. Hold off on arks and big purchases, and sell surplus on returning rockets.', { act: { k: 'tab', tab: 'exports' } });
  // what next
  const ailing = G.colonists.some(c => c.health < 90);
  if (!out.some(a => a.sev !== 'info') && !ailing) {
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
Object.assign(KC, { lifeForecast, emergencies, upkeepPerSol, dangers, sendCrawler, arkCheck, powerBudget, autoConnectSite, advice, autoConnect, nearestFreeDeposit, lifeTotals });
