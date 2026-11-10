// ===== rockets.js : sponsor rockets, cargo orders, colonist arks, exports =====
function rocketCap(G) { return ROCKET.cap + M(G, 'rocketCap'); }
// prices rise over time, and every ark is harder to fill than the last
function cargoPrice(G, key) { return Math.round(CARGO[key].price * Math.max(0.4, 1 + M(G, 'rocketCost')) * priceInflation(G)); }
function arkPrice(G) { return Math.round(ROCKET.arkPrice * Math.max(0.3, 1 + M(G, 'arkCost')) * Math.max(0.4, 1 + M(G, 'rocketCost')) * priceInflation(G) * arkEscalation(G)); }
function arkSize(G) { return ROCKET.ark + M(G, 'arkSize'); }
function travelTime(G) { return Math.round(ROCKET.travel * Math.max(0.4, 1 + M(G, 'rocketTime'))); }
function cargoUnlocked(G, key) { const c = CARGO[key]; return !c.prefab || unlocked(G, c.prefab); }
// a dome that can take colonists right now
function arkReady(G) { return !arkBlock(G); }
// why an ark cannot launch yet (null if it can)
function arkBlock(G) {
  const info = domeInfo(G), list = [...info.values()];
  if (!list.length) return 'Build a dome first.';
  if (!list.some(I => I.ok)) return 'Your dome is still under construction.';
  if (!list.some(I => I.ok && I.cap > 0)) return G.buildings.some(b => b.mod && MODULES[b.t].housing && !b.built) ? 'Living Quarters are still being built in the dome.' : 'Add Living Quarters to the dome: colonists need beds.';
  const homes = list.filter(I => I.ok && I.cap > 0);
  if (!homes.some(I => I.b._pf > 0.5)) return 'The dome has no power right now (check batteries for the night).';
  if (!homes.some(I => I.b._pf > 0.5 && (I.b._of === undefined || I.b._of >= 0.99))) return 'The dome is short of oxygen: it needs an Air Synthesizer on its pipe network.';
  if (!homes.some(I => I.b._pf > 0.5 && (I.b._of === undefined || I.b._of >= 0.99) && (I.b._wf === undefined || I.b._wf >= 0.99))) return 'The dome is short of water: it needs an Ice Drill or Condenser on its pipe network.';
  return null;
}
function orderSummary(G, cargo, arkIds) {
  let w = 0, price = 0;
  for (const k in cargo) { if (!cargo[k]) continue; if (!CARGO[k] || !cargoUnlocked(G, k)) return { err: 'Unknown cargo' }; w += CARGO[k].w * cargo[k]; price += cargoPrice(G, k) * cargo[k]; }
  if (arkIds && arkIds.length) price += arkPrice(G);
  return { w, price, cap: rocketCap(G) };
}
function orderRocket(G, cargo, arkIds) {
  arkIds = arkIds || [];
  const R = G.rockets.find(r => r.st === 'home'); if (!R) return { err: 'No rocket is free' };
  const s = orderSummary(G, cargo, arkIds); if (s.err) return s;
  if (s.w > s.cap) return { err: 'Too heavy: ' + s.w + ' of ' + s.cap };
  if (s.price > G.funds) return { err: 'Not enough funding' };
  if (!s.w && !arkIds.length) return { err: 'The rocket is empty' };
  if (arkIds.length) {
    if (arkIds.length > arkSize(G)) return { err: 'An ark holds ' + arkSize(G) };
    const why = arkBlock(G); if (why) return { err: why };
  }
  const ark = [];
  for (const id of arkIds) { const a = G.applicants.find(x => x.aid === id); if (!a) return { err: 'Applicant gone' }; ark.push(a); }
  G.applicants = G.applicants.filter(a => !arkIds.includes(a.aid));
  G.funds -= s.price; noteUse(G, 'funds', s.price);
  if (ark.length) G.st.arks = (G.st.arks || 0) + 1;
  Object.assign(R, { st: 'out', t: travelTime(G), cargo: Object.assign({}, cargo), ark, leavers: [], exp: null });
  log(G, 'Rocket ' + R.id + ' launched from home' + (ark.length ? ' with ' + ark.length + ' colonists' : '') + '. Arrival in ' + R.t + ' hours.', 'info');
  return { ok: true, rocket: R };
}
function landingSpot(G) { const L = G.buildings.find(b => b.t === 'lander'); return { x: L.x + 1, y: L.y + 1 }; }
function rocketStep(G) {
  for (const R of G.rockets) {
    if (R.st === 'home') continue;
    R.t--;
    if (R.t > 0) continue;
    if (R.st === 'out') {
      R.st = 'landed'; R.t = ROCKET.unload;
      const got = [];
      for (const k in R.cargo) {
        const n = R.cargo[k], c = CARGO[k]; if (!n) continue;
        if (c.give) for (const r in c.give) { G.res[r] += c.give[r] * n; G.sol.imp = G.sol.imp || {}; G.sol.imp[r] = (G.sol.imp[r] || 0) + c.give[r] * n; }
        if (c.drones) { const L = G.buildings.find(b => b.t === 'lander'); let left = n; for (const h of G.buildings.filter(b => b.built && !b.mod && BUILDINGS[b.t].hub && b.t !== "lander").sort((a, b) => a.drones - b.drones)) { const add = Math.min(left, hubCap(G, h) - h.drones); if (add > 0) { h.drones += add; left -= add; } } L.drones += left; }
        if (c.vehicle) for (let i = 0; i < n; i++) { const p = landingSpot(G); addVehicle(G, c.vehicle, p.x + 2 + i, p.y + 2); }
        if (c.prefab) G.prefabs[c.prefab] = (G.prefabs[c.prefab] || 0) + n;
        if (c.probe) G.probes += n;
        got.push(n + '× ' + c.name);
      }
      if (R.ark.length) {
        for (const p of R.ark) { const c = addColonist(G, p, null); c.sanity = Math.max(c.sanity, 80); }
        G.st.arrived += R.ark.length;
        rehome(G);
        log(G, R.ark.length + ' colonists have arrived on Kessa.', 'good', landingSpot(G));
        R.ark = [];
      }
      log(G, 'Rocket ' + R.id + ' landed' + (got.length ? ': ' + got.join(', ') : '') + '.', 'good', landingSpot(G));
      fx(G, { k: 'land', id: R.id });
      R.cargo = null;
    } else if (R.st === 'landed') {
      // passengers home and exports
      const leavers = G.colonists.filter(c => c.leaving);
      for (const c of leavers) { removeColonist(G, c); G.st.left++; }
      if (leavers.length) addConf(G, -leavers.length, 'colonists went home unhappy');
      if (leavers.length) { rehome(G); log(G, leavers.length + ' homesick colonist' + (leavers.length > 1 ? 's' : '') + ' left for home.', 'warn'); }
      R.leavers = leavers.length;
      R.exp = null;
      if (G.exportOn) {
        const rare = Math.min(40, Math.floor(G.res.rare)), crys = Math.min(20, Math.floor(G.res.crystals));
        if (rare || crys) {
          // a rocket without 5 local fuel is refuelled by the sponsor, who keeps a quarter of the sale
          const fuelled = G.res.fuel >= 5;
          if (fuelled) { G.res.fuel -= 5; noteUse(G, 'fuel', 5); }
          G.res.rare -= rare; G.res.crystals -= crys; noteUse(G, 'rare', rare); noteUse(G, 'crystals', crys);
          R.exp = { rare, crystals: crys, surcharge: !fuelled };
        }
      }
      R.st = 'back'; R.t = travelTime(G);
      log(G, 'Rocket ' + R.id + ' lifted off for home' + (R.exp ? ' carrying ' + [R.exp.rare ? R.exp.rare + ' rare metals' : '', R.exp.crystals ? R.exp.crystals + ' Kessite' : ''].filter(Boolean).join(' and ') : '') + '.', 'info');
      fx(G, { k: 'launch', id: R.id });
    } else if (R.st === 'back') {
      R.st = 'home';
      if (R.exp) {
        const v = Math.round((R.exp.rare * 26 + R.exp.crystals * 75) * (1 + M(G, 'export')) * (R.exp.surcharge ? 0.75 : 1));
        G.funds += v; G.st.exportFunds += v; noteProd(G, 'funds', v);
        contractExport(G, R.exp);
        log(G, 'Exports sold at home for ' + v + ' funding' + (R.exp.surcharge ? ' (a quarter went to the sponsor for fuel: refine your own to keep it)' : '') + '.', 'good');
        G.ms.export = G.ms.export || solOf(G.tick);
      }
      R.exp = null;
    }
  }
}
Object.assign(KC, { arkBlock, rocketCap, cargoPrice, arkPrice, arkSize, travelTime, cargoUnlocked, arkReady, orderSummary, orderRocket });
