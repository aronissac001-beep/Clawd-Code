// ===== sim.js : the hourly tick: environment, power, life support, production, drones, upkeep =====
const WEAR_BASE = 0.7;
const FARM = new Set(['greenhouse', 'hydro', 'vfarm', 'bloomfarm', 'algae']);
const MINE = new Set(['oremine', 'raremine', 'automine', 'harvester']);
const FACTORY = new Set(['works', 'refinery', 'polymer', 'foundry', 'workshop', 'assembler']);

function noteProd(G, k, v) { if (v) { G._hr.prod[k] = (G._hr.prod[k] || 0) + v; G.sol.prod[k] = (G.sol.prod[k] || 0) + v; } }
function noteUse(G, k, v) { if (v && G._hr) { G._hr.use[k] = (G._hr.use[k] || 0) + v; G.sol.use[k] = (G.sol.use[k] || 0) + v; } }
function gain(G, k, v, cap) {
  if (v <= 0) return 0;
  const room = Math.max(0, cap - G.res[k]), got = Math.min(room, v);
  G.res[k] += got; noteProd(G, k, got); return got;
}

function hazardActive(G, kind) { return G.hz.active.find(h => h.kind === kind); }
function envNow(G) {
  const h = hourOf(G.tick);
  const sun = h >= 6 && h <= 19 ? Math.max(0, Math.sin((h - 5.5) / 14 * Math.PI)) : 0;
  const ds = hazardActive(G, 'dust'), cw = hazardActive(G, 'cold');
  return { h, sun, dust: ds ? ds.sev : 0, cold: !!cw, shift: h >= 6 && h < 14 ? 0 : h >= 14 && h < 22 ? 1 : 2 };
}
// radius buildings (heaters, brushes, lances, masts) cached per tick
function coverage(G, key) {
  const out = [];
  for (const b of G.buildings) { if (b.mod || !b.built || !b.on || b.broken) continue; const r = BUILDINGS[b.t][key]; if (r && (b.pw === undefined || b.pw > 0.5)) { const c = center(b); out.push({ x: c.x, y: c.y, r }); } }
  return out;
}
function covered(list, x, y) { for (const c of list) if (cheb(c.x, c.y, x, y) <= c.r) return true; return false; }

function staffSlots(G, d) { return d.jobs ? Math.max(1, d.jobs - M(G, 'jobReduce')) : 0; }
// performance of the workers present this hour
function staffFactor(G, b, d, env) {
  if (!d.jobs) return 1;
  const slots = staffSlots(G, d);
  if (!b.shifts[env.shift]) return d.auto ? 1 : 0;
  let s = 0;
  for (const cid of b.jobs[env.shift]) { const c = cById(G, cid); if (c && !c.rest && c.home) s += workPerf(G, c, b, d); }
  const f = Math.min(1.5, s / slots);
  return d.auto ? 1 + 0.5 * Math.min(1, f) : f;
}
function workPerf(G, c, b, d) {
  let p = 0.6 + 0.6 * clamp(c.morale, 0, 100) / 100;
  if (d.spec && c.spec === d.spec) p *= 1.25;
  if (c.traits.includes('idler')) p *= 0.75;
  if (c.traits.includes('handy') && (FACTORY.has(b.t) || MINE.has(b.t))) p *= 1.2;
  if (c.traits.includes('genius') && (d.research)) p *= 1.5;
  return p;
}

function step(G) {
  if (G.over && !G.over.continued) return;
  G._hr = { prod: {}, use: {} };
  if (!G.sol) G.sol = { prod: {}, use: {}, short: {} };
  if (G._netDirty) computeNets(G);
  if (G._jobsDirty) assignJobs(G);
  const env = G._env = envNow(G);
  const heat = coverage(G, 'heat'), brush = coverage(G, 'brush');
  G._heat = heat; G._brush = brush;
  powerStep(G, env, heat);
  lifeStep(G, env);
  colonistHour(G, env);
  produceStep(G, env);
  droneStep(G, env);
  wearStep(G, env, brush);
  vehicleStep(G);
  surveyStep(G);
  rocketStep(G);
  hazardStep(G, env);
  // rolling 24h balance per resource
  const h = env.h;
  for (const k of [...MATS, 'power', 'water', 'oxygen', 'rp']) {
    const a = G.rate[k] || (G.rate[k] = new Array(24).fill(0));
    a[h] = round2((G._hr.prod[k] || 0) - (G._hr.use[k] || 0));
  }
  G.tick++;
  if (G.tick % HOURS_PER_SOL === 0) solStep(G);
  syncRng(G);
}
const round2 = v => Math.round(v * 100) / 100;
function run(G, hours) { for (let i = 0; i < hours; i++) { step(G); if (G.over && !G.over.continued) break; } }

// ---- power ----
function powerStep(G, env, heat) {
  const nets = new Map(), net = id => { let n = nets.get(id); if (!n) { n = { prod: 0, demand: 0, cons: [], gens: [], bats: [], fuelGens: [], stored: 0, cap: 0, use: 0 }; nets.set(id, n); } return n; };
  const fuelCap = 1;
  for (const b of G.buildings) {
    b._pf = 0;
    if (!b.built) continue;
    const d = def(b), id = b._pn; if (id === undefined || id < 0) { b._pf = d.use && d.use.power ? 0 : 1; continue; }
    const n = net(id);
    const active = b.on && !b.broken;
    if (d.battery && active) { n.bats.push(b); const cap = d.battery * (1 + M(G, 'battery')); b._cap = cap; n.stored += b.charge || 0; n.cap += cap; }
    const wf = b.wear >= 100 ? 0.6 : 1;
    if (active && d.gen) {
      let out = 0; const g = d.gen;
      if (g.kind === 'solar') out = g.amt * env.sun * (1 + M(G, 'solar')) * (1 - env.dust * (1 - Math.min(0.7, M(G, 'solarDust'))));
      else if (g.kind === 'wind') { const hh = G._T.h[b.y * MAP_N + b.x]; out = g.amt * (1 + clamp((hh - 0.35) / 0.4, 0, 1)) * (1 + M(G, 'wind')) * (env.dust ? 1.5 : 1); }
      else if (g.kind === 'reactor') out = g.amt * Math.min(1, staffFactor(G, b, d, env));
      else if (g.kind === 'crystal') out = g.amt;
      else if (g.kind === 'fuel') { n.fuelGens.push(b); out = 0; }
      out *= wf; b._out = out; n.prod += out;
    }
    if (d.make && d.make.power && active) { n.prod += d.make.power; b._out = d.make.power; }
    if (d.use && d.use.power && active) {
      if (d.jobs && !d.auto && staffFactor(G, b, d, env) <= 0) { b._pf = 1; b._idle = true; continue; }
      b._idle = false;
      let p = d.use.power * (1 + M(G, 'powerUse'));
      if (env.cold && !b.mod) { const c = center(b); if (!covered(heat, c.x, c.y)) p *= 1.35 - Math.min(0.3, M(G, 'coldRes')); }
      b._pd = p; n.demand += p; n.cons.push(b);
    } else if (!d.use || !d.use.power) b._pf = 1;
  }
  const fuelPer = BUILDINGS.fuelgen.burn;
  for (const [id, n] of nets) {
    let supply = n.prod;
    let deficit = n.demand - supply;
    if (deficit > 0 && n.stored > 0) { const take = Math.min(deficit, n.stored); n.stored -= take; supply += take; deficit -= take; n.drawn = take; }
    if (deficit > 0) for (const g of n.fuelGens) {
      if (deficit <= 0) break;
      const cap = BUILDINGS.fuelgen.gen.amt * (g.wear >= 100 ? 0.6 : 1), want = Math.min(cap, deficit), fuel = fuelPer * want / cap;
      if (G.res.fuel >= fuel) { G.res.fuel -= fuel; noteUse(G, 'fuel', fuel); supply += want; deficit -= want; g._out = want; n.prod += want; } else g._out = 0;
    }
    for (const g of n.fuelGens) if (g._out === undefined) g._out = 0;
    // allocate by priority tier
    let left = supply;
    for (const tier of [2, 1, 0]) {
      const list = n.cons.filter(b => b.prio === tier); if (!list.length) continue;
      const dem = list.reduce((s, b) => s + b._pd, 0), r = dem > 0 ? Math.min(1, left / dem) : 1;
      for (const b of list) b._pf = r;
      left -= dem * r;
    }
    n.use = n.demand - Math.max(0, -left) ;
    n.use = Math.min(n.demand, supply);
    // surplus charges batteries
    if (left > 0 && n.bats.length) {
      let room = n.cap - n.stored, put = Math.min(left, room, n.bats.length * 20);
      n.stored += put; n.charged = put;
    }
    // write battery charge back proportionally
    if (n.bats.length) { const f = n.cap > 0 ? n.stored / n.cap : 0; for (const b of n.bats) b.charge = round2(f * b._cap); }
    noteProd(G, 'power', n.prod); noteUse(G, 'power', n.use);
    if (n.demand > supply + 0.01) G.sol.short.power = (G.sol.short.power || 0) + 1;
  }
  G._pnets = nets;
  for (const b of G.buildings) b.pw = round2(b._pf);
  for (const b of G.buildings) if (b._fuelOut) b._fuelOut = 0;
}

// ---- water and oxygen over pipe networks ----
function lifeStep(G, env) {
  const nets = new Map(), net = id => { let n = nets.get(id); if (!n) { n = { w: { prod: 0, dem: 0, sto: 0, cap: 0 }, o: { prod: 0, dem: 0, sto: 0, cap: 0 }, tanks: [], cons: [], domeW: 0, reclaim: [], leaks: 0 }; nets.set(id, n); } return n; };
  // leaking pipe tiles
  if (G._pipeNet) for (let i = 0; i < G.pipe.length; i++) if (G.pipe[i] === 2 && G._pipeNet[i] >= 0) net(G._pipeNet[i]).leaks++;
  const popIn = new Map();
  for (const c of G.colonists) if (c.home) popIn.set(c.home, (popIn.get(c.home) || 0) + 1);
  for (const b of G.buildings) {
    b._wf = 1; b._of = 1;
    if (!b.built) continue;
    const d = def(b), id = b._wn; if (id === undefined || id < 0) continue;
    const n = net(id), active = b.on && !b.broken, wf = b.wear >= 100 ? 0.6 : 1;
    if (d.tank && active) { n.tanks.push(b); if (d.tank.water) { n.w.sto += b.water; n.w.cap += d.tank.water; } if (d.tank.oxygen) { n.o.sto += b.oxygen; n.o.cap += d.tank.oxygen; } }
    if (d.make && active) {
      const pf = b._pf;
      if (d.make.water) {
        let out = d.make.water * pf * wf * (1 + M(G, 'water'));
        if (b.t === 'condenser' && env.dust) out = 0;
        if (b.t === 'icedrill') { const dp = G.deposits[b.dep]; if (!dp || dp.amount <= 0) out = 0; else { if (env.cold && !covered(G._heat, b.x + 1, b.y + 1)) out *= 0.5; out = Math.min(out, dp.amount); dp.amount -= out; } }
        b._out = out; n.w.prod += out;
      }
      if (d.make.oxygen) { let out = d.make.oxygen * pf * wf * (1 + M(G, 'oxygen')); if (d.use && d.use.water) out *= 1; b._out = out; n.o.prod += out; }
    }
    if (d.reclaim && active) n.reclaim.push(b);
    // demand
    let dw = 0, dox = 0;
    if (active && d.dome) {
      const pop = popIn.get(b.id) || 0, air = 1 + M(G, 'domeAir');
      dw = d.use.water * air + pop * 0.1; dox = d.use.oxygen * air + pop * 0.1 * (1 + M(G, 'o2Use'));
      b._pop = pop;
    } else if (active && d.use && d.use.water && !b._idle) dw = d.use.water * (b.mod ? 1 : Math.min(1, b._pf + 0.001));
    if (b.mod && active && d.use && d.use.water) dw = d.use.water;
    if (dw || dox) { n.cons.push({ b, dw, dox }); n.w.dem += dw; n.o.dem += dox; if (d.dome) n.domeW += dw; }
  }
  for (const [id, n] of nets) {
    for (const r of n.reclaim) { const out = Math.min(n.domeW * BUILDINGS.reclaimer.reclaim, 3) * r._pf; r._out = out; n.w.prod += out; }
    if (n.leaks) { const lw = Math.min(n.w.sto + n.w.prod, 0.6 * n.leaks), lo = Math.min(n.o.sto + n.o.prod, 0.6 * n.leaks); n.w.prod -= lw; n.o.prod -= lo; n.leakW = lw; n.leakO = lo; }
    for (const [key, r] of [['w', 'water'], ['o', 'oxygen']]) {
      const R = n[key];
      const avail = Math.max(0, R.prod) + R.sto;
      const ratio = R.dem > 0 ? Math.min(1, avail / R.dem) : 1;
      // high-priority consumers (domes) first when short
      let left = avail;
      const sorted = n.cons.slice().sort((a, b) => (b.b.prio - a.b.prio) || ((def(b.b).dome ? 1 : 0) - (def(a.b).dome ? 1 : 0)));
      for (const c of sorted) { const want = key === 'w' ? c.dw : c.dox; if (!want) continue; const got = Math.min(want, left); left -= got; c['f' + key] = got / want; }
      const used = avail - left;
      R.used = used;
      const net = R.prod - used; // >0 fill tanks, <0 drain tanks
      let sto = clamp(R.sto + net, 0, R.cap);
      R.newSto = sto; R.ratio = ratio;
      noteProd(G, r, Math.max(0, R.prod)); noteUse(G, r, used);
      if (R.dem > avail + 0.01) G.sol.short[r] = (G.sol.short[r] || 0) + 1;
    }
    for (const c of n.cons) { c.b._wf = c.fw === undefined ? 1 : c.fw; c.b._of = c.fo === undefined ? 1 : c.fo; }
    // write tank levels back proportionally
    for (const t of n.tanks) { const d = BUILDINGS[t.t].tank; if (d.water) t.water = round2(n.w.cap ? n.w.newSto * d.water / n.w.cap : 0); if (d.oxygen) t.oxygen = round2(n.o.cap ? n.o.newSto * d.oxygen / n.o.cap : 0); }
  }
  G._wnets = nets;
}

function prodMult(G, b) {
  let m = 1;
  if (FARM.has(b.t)) m += M(G, 'farm');
  if (MINE.has(b.t)) m += M(G, 'mine');
  if (FACTORY.has(b.t)) m += M(G, 'factory');
  if (b.t === 'sinterer') m += M(G, 'sinter');
  if (b.t === 'foundry') m += M(G, 'electronics');
  return m;
}
// ---- material production and research ----
function produceStep(G, env) {
  const cap = storageCap(G);
  let rp = 1 * (1 + M(G, 'research'));
  for (const b of G.buildings) {
    const d = def(b);
    b._st = statusOf(G, b, d, env);
    if (!b.built || !b.on || b.broken) { b._act = 0; continue; }
    if (!d.prod && !d.research && !d.assemble && !(d.gen && d.gen.kind === 'reactor')) continue;
    const dome = b.mod ? bById(G, b.dome) : null;
    if (dome && (!dome.built || dome.broken)) { b._act = 0; continue; }
    let act = b._pf * staffFactor(G, b, d, env) * (b.wear >= 100 ? 0.6 : 1);
    if (d.use && d.use.water) act *= b._wf;
    if (env.cold && !b.mod && !covered(G._heat, b.x + b.s / 2, b.y + b.s / 2)) act *= 0.7;
    if (dome) act *= Math.min(dome._pf, dome._of > 0.5 ? 1 : 0.3);
    b._act = act;
    if (act <= 0) continue;
    if (d.research) { const r = d.research * act * (1 + M(G, 'research')); rp += r; b._out = r; }
    if (d.assemble) {
      b.asm = (b.asm || 0) + act;
      if (b.asm >= 24 && G.res.parts >= 2 && G.res.electronics >= 1) {
        const hub = G.buildings.filter(h => h.built && !h.mod && BUILDINGS[h.t].hub).sort((a, c) => a.drones - c.drones)[0];
        if (hub && hub.drones < hubCap(G, hub)) { pay(G, { parts: 2, electronics: 1 }); hub.drones++; b.asm = 0; log(G, 'A new drone rolls out of the assembler.', 'info'); }
      }
      b.asm = Math.min(b.asm, 24);
      continue;
    }
    if (!d.prod) continue;
    const mult = prodMult(G, b);
    let f = act;
    if (d.prod.in) for (const k in d.prod.in) { const need = d.prod.in[k] * act; if (need > 0) f = Math.min(f, act * G.res[k] / need); }
    if (f <= 0) { b._st = 'inputs'; continue; }
    // the depot is full: stop rather than waste inputs
    const outs = Object.keys(d.prod.out);
    if (outs.every(k => G.res[k] >= cap - 0.01)) { b._st = 'full'; continue; }
    let dep = null;
    if (d.deposit) { dep = G.deposits[b.dep]; if (!dep || dep.amount <= 0) { b._st = 'depleted'; continue; } }
    if (d.prod.in) for (const k in d.prod.in) { const u = d.prod.in[k] * f; G.res[k] -= u; noteUse(G, k, u); }
    b._out = 0;
    for (const k of outs) {
      let amt = d.prod.out[k] * f * mult;
      if (b.t === 'automine' && dep && dep.type === 'rare') { const v = gain(G, 'rare', amt / 3, cap); dep.amount -= v; b._out += v; continue; }
      if (dep) amt = Math.min(amt, dep.amount);
      const got = gain(G, k, amt, cap);
      if (dep) dep.amount -= got;
      b._out += got;
    }
    if (dep && dep.amount <= 0) { dep.amount = 0; log(G, DEPOSITS[dep.type].name + ' deposit exhausted.', 'warn', dep); }
  }
  G._rp = rp;
  noteProd(G, 'rp', rp);
  const R = G.research;
  R.pool = (R.pool || 0) + rp;
  if (!R.cur) nextResearch(G);
  while (R.cur && R.pool > 0) {
    const id = R.cur, need = techCost(G, id) - (R.prog[id] || 0), take = Math.min(need, R.pool);
    R.prog[id] = (R.prog[id] || 0) + take; R.pool -= take;
    if (R.prog[id] >= techCost(G, id) - 1e-6) { completeTech(G, id); nextResearch(G); } else break;
  }
  if (R.pool > 4000) R.pool = 4000;
}

function statusOf(G, b, d, env) {
  if (!b.built) return b.paid ? 'site' : (b.mod ? 'site' : 'materials');
  if (b.broken) return 'broken';
  if (!b.on) return 'off';
  if (b.mod) { const dm = bById(G, b.dome); if (dm && (dm._pf < 0.5 || dm.broken)) return 'nopower'; }
  if (d.use && d.use.power && b._pf < 0.99 && !b._idle) return 'nopower';
  if (d.use && d.use.water && b._wf < 0.99) return 'nowater';
  if (d.dome && b._of < 0.99) return 'noair';
  if (d.jobs && !d.auto) { if (!b.shifts[env.shift]) return 'shiftoff'; if (!b.jobs[env.shift].length) return 'noworkers'; }
  if (b.wear >= 100) return 'upkeep';
  if (d.deposit) { const dp = G.deposits[b.dep]; if (!dp || dp.amount <= 0) return 'depleted'; }
  return 'ok';
}

// ---- drones ----
function hubCap(G, h) { const d = h.vehicle ? VEHICLES.crawler.hub : BUILDINGS[h.t].hub; return d.cap + (h.vehicle ? M(G, 'crawler') : M(G, 'droneCap')); }
function hubsOf(G) {
  const out = [];
  for (const b of G.buildings) {
    if (b.mod || !b.built || b.broken) continue;
    const d = BUILDINGS[b.t]; if (!d.hub) continue;
    if (b.t !== 'lander' && (b._pf < 0.5 || !b.on)) { b._dt = []; continue; }
    const c = center(b); out.push({ src: b, x: c.x, y: c.y, r: d.hub.radius + M(G, 'hubRange'), n: b.drones });
  }
  for (const v of G.vehicles) if (v.t === 'crawler' && !v.path.length) out.push({ src: v, x: v.x + 0.5, y: v.y + 0.5, r: VEHICLES.crawler.hub.radius + Math.floor(M(G, 'hubRange') / 2), n: v.drones });
  return out;
}
function droneTasks(G) {
  const tasks = [], n = MAP_N, cap = storageCap(G);
  for (const kind of ['cable', 'pipe']) {
    const L = G[kind];
    for (let i = 0; i < L.length; i++) {
      if (L[i] === 2) tasks.push({ k: 'fix', p: 5, x: i % n + 0.5, y: ((i / n) | 0) + 0.5, i, kind, max: 1 });
      else if (L[i] === 3) tasks.push({ k: 'line', p: 3, x: i % n + 0.5, y: ((i / n) | 0) + 0.5, i, kind, max: 1 });
    }
  }
  for (const b of G.buildings) {
    const d = def(b);
    let pos;
    if (b.mod) { const dm = bById(G, b.dome); if (!dm || !dm.built) continue; pos = center(dm); } else pos = center(b);
    if (!b.built) tasks.push({ k: 'build', p: 2 + b.prio + (b.paid ? 0.5 : 0), x: pos.x, y: pos.y, b, max: 2 + (b.s || 1) });
    else if (!b.mod && b.broken) tasks.push({ k: 'repair', p: 6, x: pos.x, y: pos.y, b, max: 2 });
    else if (!b.mod && b.wear >= 65 && d.maint) tasks.push({ k: 'maint', p: 4 + (b.wear >= 100 ? 1.5 : 0) + b.prio * 0.2, x: pos.x, y: pos.y, b, max: 1 });
  }
  if (G.res.metals < cap - 0.5 || G.res.food < cap - 0.5)
    for (const dp of G.deposits) if (DEPOSITS[dp.type].surface && dp.amount > 0 && dp.type === 'scrap' && G.res.metals < cap - 0.5 && depKnown(G, dp)) tasks.push({ k: 'mine', p: 1, x: dp.x + 0.5, y: dp.y + 0.5, dp, max: 2 });
  tasks.sort((a, b) => b.p - a.p);
  return tasks;
}
function droneStep(G, env) {
  const hubs = hubsOf(G); if (!hubs.length) return;
  const tasks = droneTasks(G);
  const rate = (1 + M(G, 'drone')) * (env.dust ? 0.8 : 1);
  const cap = storageCap(G);
  for (const h of hubs) { h.src._dt = []; h.left = h.n; }
  for (const t of tasks) t.n = 0;
  // materials are paid when the first drone arrives at a site
  const canStart = t => {
    if (t.k === 'build' && !t.b.paid) { const c = costOf(G, t.b.t, t.b.mod); if (!canAffordReserve(G, c, t.b.prio)) { t.b._st = 'materials'; return false; } pay(G, c); t.b.paid = true; }
    if (t.k === 'line' && !t.paid) { const c = BUILDINGS[t.kind].cost.metals; if (G.res.metals < c) return false; G.res.metals -= c; noteUse(G, 'metals', c); t.paid = true; }
    if (t.k === 'fix' && !t.paid) { if (G.res.metals < 0.5) return false; G.res.metals -= 0.5; noteUse(G, 'metals', 0.5); t.paid = true; }
    if ((t.k === 'maint' || t.k === 'repair') && !t.b.upaid) { const r = def(t.b).maint, need = t.k === 'repair' ? 2 : 1; if (G.res[r] < need) { t.b._need = r; return false; } G.res[r] -= need; noteUse(G, r, need); t.b.upaid = true; t.b._need = null; }
    return true;
  };
  for (let pass = 0; pass < 12; pass++) {
    let any = false;
    for (const t of tasks) {
      if (t.n >= t.max || t.blocked) continue;
      for (const h of hubs) {
        if (h.left <= 0 || cheb(h.x, h.y, t.x, t.y) > h.r + 0.5) continue;
        if (t.n === 0 && !canStart(t)) { t.blocked = true; break; }
        t.n++; h.left--; h.src._dt.push([t.x, t.y, t.k]); any = true;
        break;
      }
    }
    if (!any) break;
  }
  for (const t of tasks) {
    if (!t.n) continue;
    const w = t.n * rate;
    if (t.k === 'line') { G[t.kind][t.i] = 1; G._netDirty = true; }
    else if (t.k === 'fix') { G[t.kind][t.i] = 1; G._netDirty = true; }
    else if (t.k === 'build') {
      const b = t.b, d = def(b);
      b.prog += w * (1 + M(G, 'build'));
      if (b.prog >= d.work) completeBuilding(G, b);
    } else if (t.k === 'maint') { t.b.mp = (t.b.mp || 0) + w; if (t.b.mp >= 2) { t.b.wear = 0; t.b.mp = 0; t.b.upaid = false; } }
    else if (t.k === 'repair') { t.b.rp = (t.b.rp || 0) + w; if (t.b.rp >= 4) { t.b.wear = 0; t.b.rp = 0; t.b.broken = false; t.b.upaid = false; G._netDirty = true; log(G, def(t.b).name + ' repaired.', 'info', t.b); } }
    else if (t.k === 'mine') {
      const amt = Math.min(t.dp.amount, 0.45 * w);
      const got = gain(G, 'metals', amt, cap); t.dp.amount -= got;
      if (t.dp.amount <= 0.01) { t.dp.amount = 0; G._dep = depositGrid(G); }
    }
  }
  // unpaid maintenance attempts must not leak payments: tasks that paid but got no drone are impossible by construction
}
// construction keeps a reserve of upkeep materials untouched (high-priority sites ignore it)
function canAffordReserve(G, cost, prio) {
  for (const k in cost) { const keep = prio >= 2 ? 0 : (G.reserve && G.reserve[k]) || 0; if (G.res[k] - cost[k] < keep - 1e-9) return false; }
  return true;
}
function moveDrones(G, fromId, toId, n) {
  const all = [...G.buildings.filter(b => !b.mod && b.built && BUILDINGS[b.t].hub), ...G.vehicles.filter(v => v.t === 'crawler')];
  const a = all.find(x => x.id === fromId), b = all.find(x => x.id === toId);
  if (!a || !b || a === b) return 0;
  const k = Math.max(0, Math.min(n, a.drones, hubCap(G, b) - b.drones));
  a.drones -= k; b.drones += k;
  return k;
}
function completeBuilding(G, b) {
  const d = def(b);
  b.built = true; b.prog = d.work; b.wear = 0;
  if (d.hub && !b.drones) b.drones = 0;
  G._netDirty = true; G._jobsDirty = true;
  if (d.hub && b.t === 'hub') {
    // new hubs get drones from the lander pool if it has spare, else start with what arrives
    if (b.prefab) b.drones += 2;
    // borrow drones from the best-stocked hub, leaving it at least three
    for (let i = 0; i < 4; i++) {
      const rich = G.buildings.filter(x => x !== b && !x.mod && x.built && BUILDINGS[x.t].hub).sort((p, q) => q.drones - p.drones)[0];
      if (!rich || rich.drones <= 3 || b.drones >= BUILDINGS.hub.hub.drones) break;
      rich.drones--; b.drones++;
    }
  }
  log(G, d.name + ' completed.', 'good', b.mod ? null : b);
  fx(G, { k: 'built', id: b.id });
  if (d.dome) rehome(G);
}

// ---- upkeep ----
function wearStep(G, env, brush) {
  const diff = DIFFICULTY[G.cfg.difficulty].maint, mm = Math.max(0.25, 1 + M(G, 'maint'));
  for (const b of G.buildings) {
    if (!b.built || b.mod || b.broken) continue;
    const d = BUILDINGS[b.t];
    let r = WEAR_BASE * (d.wear || 1) * diff * mm;
    if (env.dust) r *= (2 + 2 * env.dust) * Math.max(0.3, 1 + M(G, 'dustWear'));
    if (env.cold && !covered(G._heat, b.x + b.s / 2, b.y + b.s / 2) && b._pf < 0.9) r *= 2;
    if (brush.length && covered(brush, b.x + b.s / 2, b.y + b.s / 2)) r *= 0.4;
    if (!b.on) r *= 0.25;
    b.wear += r;
    if (b.wear >= 150) { b.broken = true; b.wear = 150; G._netDirty = true; log(G, d.name + ' has broken down. Drones will repair it with ' + RES[d.maint].name.toLowerCase() + '.', 'bad', b); fx(G, { k: 'break', id: b.id }); }
  }
}

// ---- surveying ----
function surveyStep(G) {
  const masts = G.buildings.filter(b => b.t === 'mast' && b.built && b.on && !b.broken && b._pf > 0.5);
  const rate = (1 + M(G, 'scan')) * (1 + 0.3 * masts.length);
  if (G.survey.length) {
    const si = G.survey[0], s = G.sectors[si];
    s.p += rate;
    if (s.p >= surveyCost(G, si)) finishSurvey(G, si);
  }
  // masts survey nearby sectors slowly on their own
  if (masts.length && G.tick % 6 === 0) {
    const k = MAP_N / SECTOR;
    for (const m of masts) {
      let best = -1, bd = 1e9;
      for (let i = 0; i < G.sectors.length; i++) {
        if (G.sectors[i].st) continue;
        const cx = (i % k) * SECTOR + SECTOR / 2, cy = ((i / k) | 0) * SECTOR + SECTOR / 2, dd = cheb(cx, cy, m.x, m.y);
        if (dd <= BUILDINGS.mast.mast && dd < bd) { bd = dd; best = i; }
      }
      if (best >= 0) { G.sectors[best].p += 2 * (1 + M(G, 'scan')); if (G.sectors[best].p >= surveyCost(G, best)) finishSurvey(G, best); }
    }
  }
}
Object.assign(KC, { moveDrones, canAffordReserve, step, run, envNow, hubsOf, hubCap, storageCap, staffSlots, hazardActive, prodMult });
