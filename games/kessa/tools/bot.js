// ===== bot.js : an automated player for headless tests. Uses only the public KC actions. =====
var BOT = (() => {
  const N = KC.MAP_N, B_ = KC.BUILDINGS, MOD = KC.MODULES;
  const RESEARCH = ['swarm', 'polychem', 'microbes', 'sintering', 'schooling', 'photovolt', 'vaultdome', 'commerce', 'family', 'dronefab', 'algae', 'circuits', 'uplink',
    'nutrition', 'holo', 'thermal', 'reclaim', 'stacking', 'shiftpsy', 'seals', 'spa', 'canopy', 'suites', 'media', 'civics', 'charter', 'meteorology', 'thinfilm',
    'automine', 'vertical', 'medicine', 'heavycrawler', 'deepsound', 'institute', 'hiveracks', 'geneedit', 'leanfab', 'identity'];
  const lander = G => G.buildings.find(b => b.t === 'lander');
  const count = (G, t, builtOnly) => G.buildings.filter(b => b.t === t && (!builtOnly || b.built)).length;
  const sites = G => G.buildings.filter(b => !b.built).length;
  const occ = (G, x, y) => x >= 0 && y >= 0 && x < N && y < N && G._occ[y * N + x];
  function hubs(G) {
    const out = [];
    for (const b of G.buildings) if (!b.mod && B_[b.t].hub) { const c = KC.center(b); out.push({ x: c.x, y: c.y, r: B_[b.t].hub.radius + KC.M(G, 'hubRange') - 0.5 }); }
    return out;
  }
  const inRange = (H, x, y) => H.some(h => KC.cheb(h.x, h.y, x, y) <= h.r);
  function touches(G, x, y, s) {
    for (let i = -1; i <= s; i++) for (const [xx, yy] of [[x + i, y - 1], [x + i, y + s], [x - 1, y + i], [x + s, y + i]]) {
      if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
      if (i === -1 && (yy === y - 1 || yy === y + s) && (xx === x - 1 || xx === x + s)) continue;
      const k = yy * N + xx; if (G._occ[k] || G.cable[k] === 1 || G.cable[k] === 3) return true;
    }
    return false;
  }
  // the nearest valid spot that touches the base and is in drone range
  function spot(G, type, near, opt = {}) {
    const s = B_[type].size, H = hubs(G);
    let best = null, bd = 1e9;
    const R = opt.R || 22;
    for (let y = Math.max(0, Math.round(near.y - R)); y < Math.min(N, near.y + R); y++) for (let x = Math.max(0, Math.round(near.x - R)); x < Math.min(N, near.x + R); x++) {
      const cx = x + s / 2, cy = y + s / 2, d = Math.hypot(cx - near.x, cy - near.y);
      if (d >= bd) continue;
      if (!opt.anyRange && !inRange(H, cx, cy)) continue;
      if (!KC.canPlace(G, type, x, y).ok) continue;
      if (!opt.loose && !touches(G, x, y, s)) continue;
      if (opt.gap && !gapOk(G, x, y, s)) continue;
      best = { x, y }; bd = d;
    }
    return best;
  }
  // keep one free row around big buildings so later lines and extractors can get through
  function gapOk(G, x, y, s) { let blocked = 0; for (let i = 0; i < s; i++) { if (occ(G, x + i, y - 1)) blocked++; if (occ(G, x + i, y + s)) blocked++; if (occ(G, x - 1, y + i)) blocked++; if (occ(G, x + s, y + i)) blocked++; } return blocked < s * 2; }
  function build(G, type, near, opt) {
    const p = spot(G, type, near, opt) || (opt && opt.fallback !== false ? spot(G, type, near, Object.assign({}, opt, { loose: true })) : null);
    if (!p) return null;
    const b = KC.place(G, type, p.x, p.y);
    if (b.err) return null;
    if (!touches(G, p.x, p.y, b.s)) connect(G, b);
    return b;
  }
  // run cable and pipe from a building to the nearest part of the grid
  function connect(G, b) {
    const s = b.s, start = [], seen = new Int32Array(N * N).fill(-1);
    const mine = (x, y) => x >= b.x && y >= b.y && x < b.x + s && y < b.y + s;
    const goal = (x, y) => { for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= N || yy >= N || mine(xx, yy)) continue; const k = yy * N + xx; if (G._occ[k] && G._occ[k] !== b.id) return true; } const k = y * N + x; return (G.cable[k] === 1 || G.cable[k] === 3) && !mine(x, y); };
    const ok = (x, y) => x >= 0 && y >= 0 && x < N && y < N && !G._occ[y * N + x] && G._T.slope[y * N + x] <= KC.SLOPE_LINE;
    for (let i = 0; i < s; i++) for (const [x, y] of [[b.x + i, b.y - 1], [b.x + i, b.y + s], [b.x - 1, b.y + i], [b.x + s, b.y + i]]) if (ok(x, y)) { start.push([x, y]); seen[y * N + x] = -2; }
    const q = start.slice(); let end = null;
    while (q.length) { const [x, y] = q.shift(); if (goal(x, y)) { end = [x, y]; break; } for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (ok(xx, yy) && seen[yy * N + xx] === -1) { seen[yy * N + xx] = y * N + x; q.push([xx, yy]); } } }
    if (!end) return false;
    const path = []; let c = end[1] * N + end[0];
    while (c >= 0) { path.push([c % N, (c / N) | 0]); c = seen[c]; }
    KC.placeLine(G, 'cable', path); KC.placeLine(G, 'pipe', path);
    return true;
  }
  function depositSpot(G, type, buildType, from) {
    const s = B_[buildType].size, H = hubs(G);
    const deps = G.deposits.filter(d => d.type === type && d.amount > 50 && KC.depKnown(G, d) && !G.buildings.some(b => b.dep === d.id))
      .sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y));
    for (const d of deps) {
      for (let y = d.y - s + 1 - d.r; y <= d.y + d.r; y++) for (let x = d.x - s + 1 - d.r; x <= d.x + d.r; x++) {
        if (!KC.canPlace(G, buildType, x, y).ok) continue;
        if (!inRange(H, x + s / 2, y + s / 2)) return { x, y, needHub: true, d };
        return { x, y, d };
      }
    }
    return null;
  }
  function buildOnDeposit(G, type, buildType, B) {
    const L = lander(G), base = KC.center(L);
    const p = depositSpot(G, type, buildType, base);
    if (!p) return null;
    if (p.needHub) {
      if (sites(G) > 6 || G.buildings.some(b => b.t === 'hub' && !b.built)) return null;
      // a hub between the base and the deposit
      const mid = { x: (base.x + p.x) / 2 + 1, y: (base.y + p.y) / 2 + 1 };
      const h = build(G, 'hub', { x: p.x * 0.7 + base.x * 0.3, y: p.y * 0.7 + base.y * 0.3 }, { R: 10 }) || build(G, 'hub', mid, { R: 10 });
      return null;
    }
    const b = KC.place(G, buildType, p.x, p.y);
    if (b.err) return null;
    if (!touches(G, p.x, p.y, b.s)) connect(G, b);
    return b;
  }
  function genCap(G) {
    let p = 0;
    for (const b of G.buildings) {
      if (b.mod) continue; const d = B_[b.t]; if (!d.gen) continue;
      if (d.gen.kind === 'solar') p += d.gen.amt * 0.37 * (1 + KC.M(G, 'solar'));
      else if (d.gen.kind === 'wind') p += d.gen.amt * 1.4;
      else if (d.gen.kind === 'fuel') p += G.res.fuel > 10 ? d.gen.amt * 0.5 : 0;
      else p += d.gen.amt * 0.9;
    }
    return p + 3;
  }
  function powerDemand(G) {
    let p = 0;
    for (const b of G.buildings) { const d = KC.def(b); if (d.use && d.use.power) p += d.use.power * (d.jobs && !d.auto ? 0.75 : 1); }
    return p;
  }
  function waterCap(G) { let w = 0; for (const b of G.buildings) { if (b.t === 'icedrill') { const dp = G.deposits[b.dep]; if (dp && dp.amount > 30) w += 2.4; } if (b.t === 'condenser') w += 0.55; if (b.t === 'reclaimer') w += 1; } return w; }
  function waterDemand(G, extraPop) { let w = (G.colonists.length + extraPop) * 0.1; for (const b of G.buildings) { const d = KC.def(b); if (d.use && d.use.water) w += d.use.water * (d.dome ? 1 + KC.M(G, 'domeAir') : 1); } return w; }
  function airCap(G) { return count(G, 'airsynth') * 2 * (1 + KC.M(G, 'oxygen')) + count(G, 'algae') * 2.5; }
  function airDemand(G, extraPop) { let o = (G.colonists.length + extraPop) * 0.1 * (1 + KC.M(G, 'o2Use')); for (const b of G.buildings) { const d = KC.def(b); if (d.dome) o += d.use.oxygen * (1 + KC.M(G, 'domeAir')); } return o; }
  function domes(G, built) { return G.buildings.filter(b => !b.mod && B_[b.t].dome && (!built || b.built)); }
  function housing(G) { let h = 0; for (const b of G.buildings) if (b.mod && MOD[b.t].housing) h += MOD[b.t].housing; return h; }
  function foodRate(G) { let f = 0; for (const b of G.buildings) { const d = KC.def(b); if (d.prod && d.prod.out && d.prod.out.food) f += d.prod.out.food * 16 * (d.jobs ? 0.9 : 1) * (1 + KC.M(G, 'farm')); } return f; }
  function modCount(G, dome, t) { return KC.domeModules(G, dome).filter(m => m.t === t).length; }
  function addMod(G, t, pred) {
    for (const d of domes(G).sort((a, b) => KC.domeFree(G, b) - KC.domeFree(G, a))) { if (pred && !pred(d)) continue; if (KC.canAddModule(G, d.id, t).ok) return KC.addModule(G, d.id, t); }
    return null;
  }
  function workers(G) { const adults = G.colonists.filter(c => KC.canWork(c)).length; let slots = 0; for (const b of G.buildings) { const d = KC.def(b); if (d.jobs) slots += KC.staffSlots(G, d) * (b.shifts ? b.shifts.filter(Boolean).length : 2); } return { adults, slots, idle: G.colonists.filter(c => KC.canWork(c) && !c.job).length }; }

  function turn(G, B) {
    const L = lander(G), base = KC.center(L), sol = KC.solOf(G.tick);
    B.log = B.log || [];
    // research
    if (!G.research.cur && !G.research.queue.length) {
      const bt = G.research.found.find(id => !KC.techDone(G, id));
      const next = bt || RESEARCH.find(id => !KC.techDone(G, id)) || Object.keys(KC.TECHS).find(id => KC.techAvailable(G, id));
      if (next) KC.queueResearch(G, next);
    }
    // keep sites manageable
    const busy = sites(G);
    const pop = G.colonists.length, ark = G.rockets.filter(r => r.st === 'out').reduce((s, r) => s + r.ark.length, 0);
    const want = (cond, fn) => { if (cond && sites(G) < 7) fn(); };
    // ---- phase 1: robots ----
    want(count(G, 'solar') < 2, () => build(G, 'solar', base));
    want(count(G, 'sinterer') < 1, () => buildOnDeposit(G, 'regolith', 'sinterer', B));
    want(count(G, 'battery') < 1, () => build(G, 'battery', base));
    want(count(G, 'hub') < 1 && G.prefabs.hub, () => { const ice = G.deposits.find(d => d.type === 'ice' && KC.depKnown(G, d)); const t = ice ? { x: base.x * 0.4 + ice.x * 0.6, y: base.y * 0.4 + ice.y * 0.6 } : base; build(G, 'hub', t, { R: 9 }); });
    want(count(G, 'icedrill') < 1, () => buildOnDeposit(G, 'ice', 'icedrill', B));
    want(count(G, 'airsynth') < 1, () => build(G, 'airsynth', base));
    want(count(G, 'watertank') < 1 && count(G, 'icedrill') > 0, () => build(G, 'watertank', base));
    want(count(G, 'airtank') < 1 && count(G, 'airsynth') > 0, () => build(G, 'airtank', base));
    const nd = domes(G).length;
    want(nd < 1 && count(G, 'icedrill') && count(G, 'airsynth'), () => build(G, 'dome_s', base, { gap: true }));
    // power and life support capacity with a margin for what is coming
    const extra = ark + (G.rockets.some(r => r.st === 'home') && pop < 200 ? 10 : 0);
    if (genCap(G) < powerDemand(G) * 1.3 + 2) want(true, () => { const useWind = G.res.parts > 12 && count(G, 'solar') > 6 && count(G, 'wind') < count(G, 'solar') / 2; if (KC.techDone(G, 'thinfilm') && G.res.polymers > 10) build(G, 'thinfilm', base) || build(G, 'solar', base); else build(G, useWind ? 'wind' : 'solar', base); });
    const batCap = G.buildings.filter(b => B_[b.t] && B_[b.t].battery && b.t !== 'lander').length * 60;
    want(batCap < powerDemand(G) * 9 && count(G, 'battery') < 30, () => build(G, 'battery', base));
    if (count(G, 'icedrill') && waterCap(G) < waterDemand(G, extra) * 1.25 + 0.3) want(true, () => buildOnDeposit(G, 'ice', 'icedrill', B) || (G.res.sinter > 6 && build(G, 'condenser', base)));
    if (count(G, 'airsynth') && airCap(G) < airDemand(G, extra) * 1.25 + 0.2) want(true, () => build(G, 'airsynth', base));
    want(count(G, 'watertank') < Math.ceil(waterDemand(G, 0) / 1.5), () => build(G, 'watertank', base));
    want(count(G, 'airtank') < Math.ceil(airDemand(G, 0) / 1.2), () => build(G, 'airtank', base));
    // storage
    want(KC.storageCap(G) < 80 + 120 * Math.min(6, 1 + Math.floor(sol / 12)) && G.res.sinter > 8 && count(G, 'depot', false) - count(G, 'depot', true) === 0, () => build(G, 'depot', base));
    want(count(G, 'sinterer') < 2 + Math.floor(pop / 40) && G.res.sinter < 40, () => buildOnDeposit(G, 'regolith', 'sinterer', B));
    // ---- domes and modules ----
    for (const d of domes(G)) {
      if (!d.built) continue;
      const res = G.colonists.filter(c => c.home === d.id).length;
      if (modCount(G, d, 'quarters') + modCount(G, d, 'apartments') === 0) addMod(G, 'quarters', x => x === d);
    }
    const homes = housing(G);
    if (homes < pop + extra + 4) {
      const t = KC.unlocked(G, 'apartments') && G.res.polymers > 6 ? 'apartments' : 'quarters';
      if (!addMod(G, t) && !addMod(G, 'quarters') && sites(G) < 7 && !domes(G).some(d => !d.built)) {
        const big = KC.unlocked(G, 'dome_l') && G.res.polymers > 20 && G.res.sinter > 60 ? 'dome_l' : KC.unlocked(G, 'dome_m') && G.res.polymers > 8 && G.res.sinter > 30 ? 'dome_m' : 'dome_s';
        build(G, G.prefabs.dome_s ? 'dome_s' : big, base, { gap: true });
      }
    }
    if (pop > 0) {
      for (const d of domes(G, true)) {
        const res = G.colonists.filter(c => c.home === d.id).length; if (!res) continue;
        const has = t => modCount(G, d, t) > 0;
        const svc = [['canteen', 6], ['lounge', 10], ['clinic', 8], ['arboretum', 12], ['gym', 14], ['security', 18], ['market', 20], ['arcade', 22], ['school', 30], ['nursery', 16], ['spa', 26]];
        for (const [t, minRes] of svc) if (res >= minRes && !has(t) && KC.unlocked(G, t) && KC.domeFree(G, d) > (t === 'spa' ? 2 : 1)) { KC.addModule(G, d.id, t); break; }
      }
    }
    // food: hydroponics in domes, greenhouses outside
    const eat = (pop + extra) * 1.05;
    if (foodRate(G) < eat && (pop > 0 || ark)) {
      if (!(KC.unlocked(G, 'vfarm') && G.res.electronics > 2 && addMod(G, 'vfarm', d => KC.domeFree(G, d) >= 4)) && !addMod(G, 'hydro', d => KC.domeFree(G, d) >= 2 || pop === 0))
        want(G.res.polymers > 4, () => build(G, 'greenhouse', base, { gap: true }));
    }
    // ---- industry and science, once there are people ----
    const W = workers(G);
    const jobsShort = W.idle > 2 || W.adults > W.slots * 0.9;
    if (pop >= 6) {
      want(count(G, 'works') < 1 + Math.floor(pop / 45) && (jobsShort || G.res.parts < 15), () => build(G, 'works', base, { gap: true }));
      want(count(G, 'oremine') < 1 + Math.floor(pop / 50) && (jobsShort || G.res.metals < 40), () => buildOnDeposit(G, 'metal', 'oremine', B));
      want(count(G, 'lab') < Math.floor(pop / 14) && jobsShort, () => build(G, 'lab', base, { gap: true }));
      want(pop >= 10 && count(G, 'refinery') < 1 + Math.floor(pop / 70) && jobsShort, () => build(G, 'refinery', base));
      want(pop >= 16 && count(G, 'raremine') < 1 + Math.floor(pop / 60) && jobsShort, () => buildOnDeposit(G, 'rare', 'raremine', B));
      want(pop >= 20 && KC.unlocked(G, 'polymer') && count(G, 'polymer') < 1 + Math.floor(pop / 70) && (jobsShort || G.res.polymers < 15), () => build(G, 'polymer', base, { gap: true }));
      want(pop >= 30 && KC.unlocked(G, 'foundry') && count(G, 'foundry') < 1 + Math.floor(pop / 80) && (jobsShort || G.res.electronics < 10), () => build(G, 'foundry', base, { gap: true }));
      if (jobsShort && W.idle > 4) addMod(G, 'labmod') || addMod(G, 'workshop');
      want(pop >= 25 && count(G, 'mast') < 1, () => build(G, 'mast', base));
      want(KC.unlocked(G, 'assembler') && count(G, 'assembler') < 1 && pop >= 30, () => build(G, 'assembler', base));
      want(KC.unlocked(G, 'heater') && count(G, 'heater') < Math.floor(pop / 40), () => build(G, 'heater', base, { loose: true }));
      want(KC.unlocked(G, 'reclaimer') && count(G, 'reclaimer') < 1 && G.res.polymers > 6, () => build(G, 'reclaimer', base));
      want(KC.unlocked(G, 'spire') && count(G, 'spire') < 1 && pop >= 60, () => { if (KC.storageCap(G) < 130) build(G, 'depot', base); build(G, 'spire', base, { gap: true }); });
    }
    // too many idle hands: turn on third shifts
    if (W.idle > 6) for (const b of G.buildings) if (b.shifts && !b.shifts[2] && b.built) { KC.setShift(G, b.id, 2, true); break; }
    // ---- vehicles: pathfinder explores, crawler parks at remote sites ----
    for (const v of G.vehicles) {
      if (v.path.length || v.task) continue;
      if (v.t === 'pathfinder') {
        const a = G.anomalies.filter(a => !a.done && KC.scannedAt(G, a.x, a.y)).sort((p, q) => Math.hypot(p.x - v.x, p.y - v.y) - Math.hypot(q.x - v.x, q.y - v.y))[0];
        if (a) { KC.sendToAnomaly(G, v.id, a.id); continue; }
        const s = KC.sectorOf(Math.round(v.x), Math.round(v.y)), si = KC.sectorIndex(s.sx, s.sy);
        if (si >= 0 && !G.sectors[si].st) continue;
        // drive to the nearest unsurveyed sector
        let best = -1, bd = 1e9; const k = N / KC.SECTOR;
        for (let i = 0; i < G.sectors.length; i++) if (!G.sectors[i].st) { const cx = (i % k) * KC.SECTOR + 4, cy = ((i / k) | 0) * KC.SECTOR + 4, dd = Math.hypot(cx - v.x, cy - v.y); if (dd < bd) { bd = dd; best = i; } }
        if (best >= 0) KC.moveVehicle(G, v.id, (best % k) * KC.SECTOR + 4, ((best / k) | 0) * KC.SECTOR + 4);
      } else if (v.t === 'crawler') {
        const H = hubs(G);
        const far = G.buildings.find(b => !b.built && !b.mod && !inRange(H, b.x + b.s / 2, b.y + b.s / 2));
        if (far && KC.cheb(v.x, v.y, far.x, far.y) > 3) KC.moveVehicle(G, v.id, far.x + far.s + 1, far.y);
      }
    }
    if (!G.survey.length) { const k = N / KC.SECTOR; let best = -1, bd = 1e9; for (let i = 0; i < G.sectors.length; i++) if (!G.sectors[i].st) { const cx = (i % k) * KC.SECTOR + 4, cy = ((i / k) | 0) * KC.SECTOR + 4, dd = Math.hypot(cx - base.x, cy - base.y); if (dd < bd) { bd = dd; best = i; } } if (best >= 0) KC.queueSurvey(G, best); }
    if (G.probes > 0 && sol > 3) { const k = N / KC.SECTOR; for (let i = 0; i < G.sectors.length; i++) if (!G.sectors[i].st) { const cx = (i % k) * KC.SECTOR + 4, cy = ((i / k) | 0) * KC.SECTOR + 4; if (Math.hypot(cx - base.x, cy - base.y) < 22) { KC.useProbe(G, i); break; } } }
    // ---- rockets ----
    const free = G.rockets.find(r => r.st === 'home');
    if (free) {
      const cargo = {}; let w = 0; const cap = KC.rocketCap(G);
      const add = (k, n) => { for (let i = 0; i < n; i++) { if (w + KC.CARGO[k].w > cap) return; cargo[k] = (cargo[k] || 0) + 1; w += KC.CARGO[k].w; } };
      const need = (k, lvl) => G.res[k] < lvl;
      const homesFree = housing(G) - pop - ark;
      const wantArk = KC.arkReady(G) && homesFree >= 6 && G.funds > KC.arkPrice(G) + 150 && foodRate(G) + G.res.food / 4 > pop + 8;
      if (need('parts', 25)) add('parts', 3);
      if (need('polymers', 20)) add('polymers', 2);
      if (need('electronics', 8)) add('electronics', 1);
      if (need('metals', 30)) add('metals', 2);
      if (need('food', (pop + 10) * 3) && (pop > 0 || wantArk || domes(G, true).length)) add('food', 2);
      if (pop >= 8 && need('fuel', 10) && count(G, 'refinery') === 0) add('fuel', 1);
      const drones = G.buildings.filter(b => b.built && !b.mod && B_[b.t].hub).reduce((s, b) => s + b.drones, 0);
      const hubN = G.buildings.filter(b => b.built && !b.mod && B_[b.t].hub).length;
      if (drones < hubN * 5) add('drone', 3);
      const ids = wantArk ? G.applicants.slice().sort((a, b) => scoreApp(G, b) - scoreApp(G, a)).slice(0, Math.min(KC.arkSize(G), homesFree)).map(a => a.aid) : [];
      const s = KC.orderSummary(G, cargo, ids);
      const reserve = wantArk ? 0 : KC.arkPrice(G) * (pop > 0 ? 0.6 : 1.2);
      if ((w > 0 || ids.length) && s.price <= G.funds - (ids.length ? 0 : reserve)) {
        const r = KC.orderRocket(G, cargo, ids);
        if (r.err) B.log.push(sol + ': rocket ' + r.err);
      } else if (ids.length && KC.orderSummary(G, {}, ids).price <= G.funds) KC.orderRocket(G, {}, ids);
    }
  }
  function scoreApp(G, a) {
    let s = 0; for (const t of a.traits) s += KC.TRAITS[t].good ? 2 : -3;
    const want = { engineer: 3, scientist: 2.5, botanist: 3, geologist: 2, medic: 1, security: 1, none: 1.5 };
    const have = {}; for (const c of G.colonists) have[c.spec] = (have[c.spec] || 0) + 1;
    s += want[a.spec] / (1 + (have[a.spec] || 0) / 6);
    if (a.age > 50) s -= 1.5;
    return s;
  }
  return { turn };
})();
