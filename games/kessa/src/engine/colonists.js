// ===== colonists.js : people: generation, needs, homes, jobs, births, deaths, homesickness =====
function makePerson(G, o = {}) {
  const r = rng(G);
  const sex = o.sex || (r.chance(0.5) ? 'f' : 'm');
  const first = r.pick(sex === 'f' ? NAMES_F : NAMES_M), last = o.last || r.pick(NAMES_L);
  const specs = Object.keys(SPECS);
  let spec = o.spec; if (!spec) spec = r.chance(0.3) ? 'none' : r.pick(specs.filter(s => s !== 'none'));
  const good = Object.keys(TRAITS).filter(t => TRAITS[t].good), bad = Object.keys(TRAITS).filter(t => !TRAITS[t].good);
  const traits = [];
  if (o.traits) traits.push(...o.traits);
  else {
    const ng = r.chance(0.55) ? 1 + (r.chance(0.25) ? 1 : 0) : 0, nb = r.chance(0.4) ? 1 : 0;
    for (let i = 0; i < ng; i++) { const t = r.pick(good); if (!traits.includes(t)) traits.push(t); }
    for (let i = 0; i < nb; i++) { const t = r.pick(bad); if (!traits.includes(t)) traits.push(t); }
  }
  const wants = r.shuffle(WANTS.slice()).slice(0, 2);
  return { name: first + ' ' + last, sex, age: o.age !== undefined ? o.age : Math.round(r.range(21, 48) * 10) / 10, spec, traits, wants,
    health: 100, sanity: o.sanity || 85, comfort: 55, morale: 70, home: null, job: null, shift: null, rest: 0, hs: 0, leaving: false };
}
function refreshApplicants(G, n) {
  G.applicants = G.applicants.filter(a => !a.stale);
  while (G.applicants.length < n) { const p = makePerson(G); p.aid = G.nextId++; G.applicants.push(p); }
}
function stage(c) { return c.age < 14 ? 'child' : c.age < 18 ? 'youth' : c.age < 65 ? 'adult' : 'senior'; }
function canWork(c) { return stage(c) === 'adult' && !c.leaving && c.home; }

function addColonist(G, p, home) {
  const c = Object.assign({}, p); delete c.aid; delete c.stale;
  c.id = G.nextId++; c.home = home || null; c.arrived = G.tick;
  G.colonists.push(c); G._cById.set(c.id, c);
  G.st.everColonists = true; G._jobsDirty = true;
  return c;
}
function removeColonist(G, c) {
  if (c.job) { const b = bById(G, c.job); if (b && b.jobs) for (const sh of b.jobs) { const i = sh.indexOf(c.id); if (i >= 0) sh.splice(i, 1); } }
  G.colonists.splice(G.colonists.indexOf(c), 1); G._cById.delete(c.id); G._jobsDirty = true;
}
function die(G, c, cause) {
  removeColonist(G, c); G.st.deaths++;
  G.st.deathsBy = G.st.deathsBy || {}; G.st.deathsBy[cause] = (G.st.deathsBy[cause] || 0) + 1;
  log(G, c.name + ' has died (' + cause + ').', 'bad');
  fx(G, { k: 'death' });
}

// per-dome summary: housing, residents, services
function domeInfo(G) {
  const info = new Map();
  for (const b of G.buildings) if (!b.mod && BUILDINGS[b.t].dome) info.set(b.id, { b, cap: 0, comfortSum: 0, res: [], svc: {}, want: {}, health: 0, sanity: 0, comfortBonus: 0, birth: 0, medical: 0, safety: 0, school: 0, ok: b.built && !b.broken });
  for (const m of G.buildings) {
    if (!m.mod || !m.built || !m.on) continue;
    const I = info.get(m.dome); if (!I || !I.ok) continue;
    const d = MODULES[m.t];
    if (d.housing) { I.cap += d.housing; I.comfortSum += d.housing * d.comfort; }
    const staffed = !d.jobs || m.jobs.some(s => s.length);
    const powered = I.b._pf > 0.4;
    if (d.service && staffed && powered) I.svc[d.service.cat] = (I.svc[d.service.cat] || 0) + d.service.cap;
    if (I.b.wear >= 100) I.comfortBonus -= 12;
    if (staffed && powered) { I.health += d.health || 0; I.sanity += d.sanity || 0; I.comfortBonus += d.comfortBonus || 0; I.birth += d.birth || 0; }
  }
  for (const c of G.colonists) { const I = info.get(c.home); if (I) { I.res.push(c); for (const w of c.wants) I.want[w] = (I.want[w] || 0) + 1; } }
  for (const I of info.values()) {
    I.comfortBase = I.cap ? I.comfortSum / I.cap : 0;
    I.sat = {}; for (const w in I.want) I.sat[w] = Math.min(1, (I.svc[w] || 0) / I.want[w]);
    const n = I.res.length;
    I.medical = n ? Math.min(1, (I.svc.medical || 0) / n) : 0; I.safety = n ? Math.min(1, (I.svc.safety || 0) / n) : 0;
    I.school = I.svc.education || 0;
    I.grumblers = I.res.filter(c => c.traits.includes('grumbler')).length; I.sociable = I.res.filter(c => c.traits.includes('sociable')).length;
  }
  G._domes = info;
  return info;
}

function colonistHour(G, env) {
  const info = domeInfo(G);
  const food = G.res.food;
  let foodNeed = 0;
  for (const c of G.colonists) foodNeed += (c.traits.includes('glutton') ? 2 : c.traits.includes('frugal') ? 0.75 : 1) * (stage(c) === 'child' ? 0.5 : 1);
  foodNeed = foodNeed / 24 * Math.max(0.4, 1 + M(G, 'foodUse'));
  const foodF = foodNeed > 0 ? Math.min(1, food / foodNeed) : 1;
  if (foodNeed > 0) { const used = Math.min(food, foodNeed); G.res.food -= used; noteUse(G, 'food', used); if (foodF < 1) G.sol.short.food = (G.sol.short.food || 0) + 1; }
  const hazard = G.hz.active.some(h => h.kind !== 'quake');
  const hm = 1 + M(G, 'health'), sm = M(G, 'sanity');
  const dead = [];
  for (const c of G.colonists) {
    const I = info.get(c.home);
    const fragile = c.traits.includes('fragile') ? 1.5 : 1;
    let dh = 0, ds = 0;
    if (!I || !I.ok) { dh -= (I && I.b.built ? 1.2 : 3) * fragile; ds -= 1; }
    else {
      const b = I.b, o = b._of === undefined ? 1 : b._of, w = b._wf === undefined ? 1 : b._wf, p = b._pf === undefined ? 1 : b._pf;
      if (o < 1) dh -= 4.5 * (1 - o) * fragile;
      if (w < 1) dh -= 1.6 * (1 - w) * fragile;
      if (p < 0.5) { dh -= (env.cold ? 1.2 : 0.4) * fragile; ds -= 0.5; }
      dh += (0.12 + I.medical * (0.15 + I.health)) * hm * (c.traits.includes('athletic') ? 2 : 1);
      if (I.health && I.sat.fitness) dh += 0.03;
      ds += I.sanity + 0.02 * Math.min(3, I.sociable);
    }
    if (foodF < 1) dh -= 0.9 * (1 - foodF) * fragile;
    const working = c.job && c.shift === env.shift && !c.rest;
    if (working) {
      ds -= 0.15;
      if (env.shift === 2 && !c.traits.includes('tireless')) ds -= 0.55 * Math.max(0, 1 + M(G, 'nightShift'));
    } else ds += 0.22 + sm + (I && I.sat.relax ? 0.1 * I.sat.relax : 0);
    if (hazard) ds -= 0.15 * (c.traits.includes('skittish') ? 2 : 1);
    if (c.homeless) ds -= 0.15;
    if (c.traits.includes('resilient') && ds < 0) ds *= 0.5;
    c.health = clamp(c.health + dh, 0, 100);
    c.sanity = clamp(c.sanity + ds, 0, 100);
    // comfort drifts towards what the home offers
    let target = 10;
    if (I && I.ok) {
      const base = c.homeless ? 15 : I.comfortBase;
      let sat = 0; for (const wv of c.wants) sat += I.sat[wv] || 0; sat /= c.wants.length;
      target = base * 0.7 + 38 * sat + I.comfortBonus + M(G, 'comfort') - 3 * Math.min(4, I.grumblers - (c.traits.includes('grumbler') ? 1 : 0));
    }
    c.comfort = clamp(c.comfort + (clamp(target, 0, 100) - c.comfort) * 0.04, 0, 100);
    let mor = (c.health + c.sanity + c.comfort) / 3 + M(G, 'morale');
    if (c.traits.includes('optimist')) mor += 10; if (c.traits.includes('gloomy')) mor -= 10;
    c.morale = clamp(mor, 0, 100);
    if (c.rest > 0) c.rest--;
    if (I && I.ok && !lifeOK(I.b)) {
      G._evac = true;
      const b = I.b, key = 'alert' + b.id;
      if (!G.flags[key] || G.tick - G.flags[key] > 12) {
        G.flags[key] = G.tick;
        const what = b._of < 0.99 ? 'oxygen' : b._wf < 0.99 ? 'water' : 'power';
        log(G, 'The ' + BUILDINGS[b.t].name + ' is short of ' + what + '! Residents will move out if another dome has air.', 'bad', { x: b.x + b.s / 2, y: b.y + b.s / 2 });
      }
    }
    if (c.health <= 0) dead.push([c, !I || !I.ok ? 'exposure' : (I.b._of < 1 ? 'suffocation' : foodF < 1 ? 'starvation' : I.b._wf < 1 ? 'dehydration' : 'cold')]);
  }
  for (const [c, why] of dead) die(G, c, why);
  if (G._evac) { G._evac = false; if (G.tick % 3 === 0) G._jobsDirty = true; }
}

// put everyone in a dome, preferring domes with free homes
// put everyone in a dome: domes with working life support first, then free homes
function lifeOK(b) { return b.built && !b.broken && (b._of === undefined || b._of >= 0.99) && (b._wf === undefined || b._wf >= 0.99) && (b._pf === undefined || b._pf >= 0.5); }
function rehome(G) {
  const info = domeInfo(G);
  const domes = [...info.values()].filter(I => I.ok);
  const anyLife = domes.some(I => lifeOK(I.b));
  const count = new Map(); for (const I of domes) count.set(I.b.id, 0);
  for (const c of G.colonists) c.homeless = false;
  const move = [];
  for (const c of G.colonists) { const I = info.get(c.home); if (I && I.ok && count.get(c.home) < I.cap && (lifeOK(I.b) || !anyLife)) count.set(c.home, count.get(c.home) + 1); else move.push(c); }
  for (const c of move) {
    let best = null, bs = -1e9;
    for (const I of domes) { const free = I.cap - count.get(I.b.id); const sc = (lifeOK(I.b) ? 4000 : 0) + (free > 0 ? 1000 : 0) + Math.max(-50, free) + (I.b.id === c.home ? 0.5 : 0); if (sc > bs) { bs = sc; best = I; } }
    if (!best) { c.home = null; continue; }
    if (c.home !== best.b.id) { c.home = best.b.id; G._jobsDirty = true; }
    if (count.get(best.b.id) >= best.cap) c.homeless = true;
    count.set(best.b.id, count.get(best.b.id) + 1);
  }
}
function workplaceReach(G, w, dome) {
  if (w.mod) return w.dome === dome.id;
  const dc = center(dome), wc = center(w);
  return cheb(dc.x, dc.y, wc.x, wc.y) <= BUILDINGS[dome.t].dome.reach + dome.s / 2;
}
function assignJobs(G) {
  G._jobsDirty = false;
  rehome(G);
  for (const c of G.colonists) { c.job = null; c.shift = null; }
  const places = G.buildings.filter(b => b.built && b.on && !b.broken && b.jobs && (!b.mod || (bById(G, b.dome) || {}).built));
  for (const b of places) b.jobs = [[], [], []];
  for (const b of G.buildings) if (b.jobs && !places.includes(b)) b.jobs = [[], [], []];
  // dome services first: people need their canteen staffed before the factory
  const svc = b => b.mod && MODULES[b.t].service ? 1 : 0;
  places.sort((a, b) => (b.prio - a.prio) || (svc(b) - svc(a)) || (a.id - b.id));
  const free = G.colonists.filter(canWork);
  const slots = [];
  for (const b of places) { const d = def(b), n = staffSlots(G, d); for (let s = 0; s < 3; s++) if (b.shifts[s]) for (let k = 0; k < n; k++) slots.push({ b, s, spec: d.spec }); }
  // order slots so the first and second shift of every workplace fill before night shifts
  slots.sort((x, y) => (y.b.prio - x.b.prio) || (svc(y.b) - svc(x.b)) || ((x.s === 2) - (y.s === 2)));
  const domeOf = new Map(); for (const b of G.buildings) if (!b.mod && BUILDINGS[b.t].dome) domeOf.set(b.id, b);
  const taken = new Set();
  const tryFill = (slot, pred) => {
    for (const c of free) {
      if (taken.has(c.id) || !pred(c)) continue;
      const dome = domeOf.get(c.home); if (!dome || !workplaceReach(G, slot.b, dome)) continue;
      taken.add(c.id); c.job = slot.b.id; c.shift = slot.s; slot.b.jobs[slot.s].push(c.id); slot.done = true; return true;
    }
    return false;
  };
  for (const sl of slots) if (sl.spec) tryFill(sl, c => c.spec === sl.spec);
  for (const sl of slots) if (!sl.done) tryFill(sl, c => c.spec === 'none');
  for (const sl of slots) if (!sl.done) tryFill(sl, () => true);
}

// once per sol
function colonistSol(G) {
  const r = rng(G), info = domeInfo(G);
  const hsMod = Math.max(0, 1 + M(G, 'homesick'));
  for (const c of G.colonists.slice()) {
    const before = stage(c);
    c.age = Math.round((c.age + 0.2) * 100) / 100;
    const now = stage(c);
    if (before !== now) {
      G._jobsDirty = true;
      if (now === 'adult' && c.born !== undefined) {
        const I = info.get(c.home);
        const schooled = I && I.school > 0;
        if (schooled || r.chance(0.5)) c.spec = r.pick(Object.keys(SPECS).filter(s => s !== 'none'));
        if (schooled) { const good = Object.keys(TRAITS).filter(t => TRAITS[t].good && !c.traits.includes(t)); c.traits.push(r.pick(good)); }
        log(G, c.name + ', born on Kessa, has come of age as ' + (c.spec === 'none' ? 'a generalist' : 'a ' + SPECS[c.spec].name.toLowerCase()) + '.', 'good');
      }
      if (now === 'senior') log(G, c.name + ' has retired.', 'info');
    }
    const I = info.get(c.home);
    const lifespan = 76 + M(G, 'oldAge');
    if (c.age > lifespan && r.chance(0.05 * (I && I.medical > 0.5 ? 0.5 : 1) * (1 + (c.age - lifespan) / 5))) { die(G, c, 'old age'); continue; }
    if (c.sanity < 15 && r.chance(0.35)) {
      c.rest = 24; c.sanity = Math.min(100, c.sanity + 25);
      if ((!I || I.safety < 0.5) && r.chance(0.35)) {
        const targets = G.buildings.filter(b => !b.mod && b.built && !b.broken && b.id !== c.home && I && cheb(center(b).x, center(b).y, center(I.b).x, center(I.b).y) < 12);
        if (targets.length) { const t = r.pick(targets); t.wear = Math.min(149, t.wear + 70); log(G, c.name + ' had a breakdown and damaged the ' + BUILDINGS[t.t].name + '. A Warden Post would have stopped it.', 'bad', t); }
        else log(G, c.name + ' had a nervous breakdown and is resting.', 'warn');
      } else log(G, c.name + ' had a nervous breakdown and is resting.', 'warn');
      G._jobsDirty = true;
    }
    if (c.traits.includes('reckless') && c.job && r.chance(0.02)) { c.health -= 35; log(G, c.name + ' was hurt in a workplace accident.', 'warn'); if (c.health <= 0) { die(G, c, 'accident'); continue; } }
    if (!c.leaving && stage(c) !== 'child') {
      if (c.morale < 32) c.hs += (c.traits.includes('homesick') ? 2 : 1) * hsMod;
      else if (c.morale > 50) c.hs = Math.max(0, c.hs - 1);
      if (c.hs >= 3 && c.born === undefined) { c.leaving = true; c.job = null; G._jobsDirty = true; log(G, c.name + ' is homesick and wants to board the next rocket home.', 'warn'); }
    } else if (c.leaving && c.morale > 60) { c.leaving = false; c.hs = 0; G._jobsDirty = true; log(G, c.name + ' has decided to stay after all.', 'good'); }
  }
  // births
  for (const I of info.values()) {
    if (!I.ok) continue;
    const adults = I.res.filter(c => stage(c) === 'adult' && !c.leaving);
    if (adults.length < 2) continue;
    const free = I.cap - I.res.length; if (free <= 0) continue;
    const comfort = adults.reduce((s, c) => s + c.comfort, 0) / adults.length;
    if (comfort < 50) continue;
    const p = 0.012 * adults.length * (1 + M(G, 'birth')) * (1 + I.birth) * (0.6 + (comfort - 50) / 50);
    let births = 0;
    for (let k = 0; k < 2 && births < free; k++) if (r.chance(Math.min(0.9, p - k))) births++;
    for (let k = 0; k < births; k++) {
      const par = r.pick(adults);
      const p2 = makePerson(G, { age: 0, spec: 'none', traits: M(G, 'birth') && techDone(G, 'genome') ? ['resilient'] : [], last: par.name.split(' ').slice(-1)[0], sanity: 100 });
      p2.comfort = 70; p2.morale = 80;
      const c = addColonist(G, p2, I.b.id); c.born = G.tick;
      G.st.births++;
      log(G, 'A child, ' + c.name + ', was born in the ' + BUILDINGS[I.b.t].name + '.', 'good');
      fx(G, { k: 'birth' });
    }
  }
}
Object.assign(KC, { makePerson, refreshApplicants, stage, domeInfo, assignJobs, rehome, addColonist, canWork });
