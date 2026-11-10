// ===== hazards.js : dust storms, meteor showers, cold waves, quakes, system failures =====
const HAZARDS = {
  dust: { name: 'Dust storm', first: [8, 12], every: [12, 20], warn: 18, icon: '🌪', desc: 'Solar output collapses, condensers clog, upkeep runs fast.' },
  meteor: { name: 'Meteor shower', first: [6, 9], every: [10, 17], warn: 8, icon: '☄', desc: 'Impacts damage buildings and sever grids.' },
  cold: { name: 'Cold wave', first: [16, 22], every: [18, 28], warn: 24, icon: '❄', desc: 'Buildings draw more power and freeze without heat.' },
  quake: { name: 'Quake', first: [12, 16], every: [15, 25], warn: 4, icon: '≋', desc: 'Shakes buildings near the epicentre and breaks lines.' },
};
function hzMult(G) { return DIFFICULTY[G.cfg.difficulty].hazard; }
function scheduleHazards(G, initial) {
  const r = rng(G), sol = solOf(G.tick);
  for (const k in HAZARDS) {
    if (G.hz.next[k]) continue;
    const H = HAZARDS[k];
    const span = initial ? H.first : H.every;
    let sols = r.range(span[0], span[1]);
    if (!initial) sols = sols * Math.max(0.5, 1 - sol / 220) / Math.max(0.5, hzMult(G));
    G.hz.next[k] = Math.round(G.tick + sols * HOURS_PER_SOL + r.int(24));
  }
}
function warnHours(G, kind) {
  const obs = G.buildings.some(b => b.t === 'observatory' && b.built && b.on && !b.broken);
  return Math.round(HAZARDS[kind].warn * (1 + M(G, 'warn')) * (obs ? 2 : 1));
}
function hazardStep(G, env) {
  const r = rng(G), sol = solOf(G.tick), hm = hzMult(G);
  for (const k in HAZARDS) {
    const at = G.hz.next[k];
    if (!at || G.hz.upcoming.some(u => u.kind === k) || G.hz.active.some(u => u.kind === k)) continue;
    if (G.tick >= at - warnHours(G, k)) {
      const sev = clamp((0.4 + sol / 170 + r.range(0, 0.2)) * Math.sqrt(hm), 0.3, 1);
      const L = G.land;
      const u = { kind: k, at, sev: Math.round(sev * 100) / 100, x: clamp(L.x + 1 + r.int(30) - 15, 4, MAP_N - 5), y: clamp(L.y + 1 + r.int(30) - 15, 4, MAP_N - 5) };
      if (k === 'dust') { u.sev = Math.min(0.9, u.sev); u.dur = Math.round(20 + 36 * sev); }
      else if (k === 'cold') u.dur = Math.round(24 + 30 * sev);
      else if (k === 'meteor') u.dur = 3;
      else u.dur = 2;
      G.hz.upcoming.push(u);
      const hrs = Math.max(0, at - G.tick);
      log(G, 'Warning: ' + HAZARDS[k].name.toLowerCase() + ' expected in ' + hrs + ' hours' + (k === 'meteor' || k === 'quake' ? ' near ' + u.x + ',' + u.y : '') + '. ' + HAZARDS[k].desc, 'warn', k === 'meteor' || k === 'quake' ? u : null);
      fx(G, { k: 'warn', kind: k });
    }
  }
  for (const u of G.hz.upcoming.slice()) {
    if (G.tick < u.at) continue;
    G.hz.upcoming.splice(G.hz.upcoming.indexOf(u), 1);
    u.end = G.tick + u.dur; G.hz.n++;
    G.hz.active.push(u);
    log(G, HAZARDS[u.kind].name + ' has begun' + (u.kind === 'dust' || u.kind === 'cold' ? ' and will last about ' + Math.round(u.dur / 24 * 10) / 10 + ' sols' : '') + '.', 'bad', u.kind === 'meteor' || u.kind === 'quake' ? u : null);
    if (u.kind === 'meteor') { u.hits = []; const n = Math.round((4 + 7 * u.sev) * Math.sqrt(hm)); for (let i = 0; i < n; i++) u.hits.push([G.tick + r.int(u.dur), clamp(Math.round(u.x + r.range(-9, 9)), 0, MAP_N - 1), clamp(Math.round(u.y + r.range(-9, 9)), 0, MAP_N - 1)]); }
    if (u.kind === 'quake') quake(G, u);
    fx(G, { k: 'hazard', kind: u.kind });
  }
  for (const a of G.hz.active.slice()) {
    if (a.kind === 'meteor') for (const h of a.hits) if (h[0] === G.tick) impact(G, h[1], h[2]);
    if (G.tick >= a.end) {
      G.hz.active.splice(G.hz.active.indexOf(a), 1);
      delete G.hz.next[a.kind];
      log(G, HAZARDS[a.kind].name + ' is over.', 'info');
      if (a.kind === 'dust') G.ms.storm = G.ms.storm || solOf(G.tick);
      scheduleHazards(G, false);
    }
  }
}
function impact(G, x, y) {
  const r = rng(G);
  const lances = coverage(G, 'lance');
  if (covered(lances, x, y) && r.chance(0.8)) { fx(G, { k: 'intercept', x, y }); return; }
  fx(G, { k: 'meteor', x, y });
  const dm = Math.max(0.2, 1 + M(G, 'meteor'));
  const id = G._occ[y * MAP_N + x];
  if (id) {
    const b = bById(G, id), d = BUILDINGS[b.t];
    if (b.built && b.t !== 'lander') {
      b.wear += (d.dome ? 70 : 95) * dm;
      if (d.dome) for (const c of G.colonists) if (c.home === b.id) c.sanity = Math.max(0, c.sanity - 8);
      if (b.wear >= 150) { b.wear = 150; b.broken = true; G._netDirty = true; log(G, 'A meteor wrecked the ' + d.name + '.', 'bad', b); }
      else log(G, 'A meteor struck the ' + d.name + '.', 'warn', b);
    } else if (!b.built) { b.prog = Math.max(0, b.prog - 10); }
  }
  for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= MAP_N || yy >= MAP_N) continue;
    const i = yy * MAP_N + xx;
    for (const k of ['cable', 'pipe']) if (G[k][i] === 1 && (dx === 0 && dy === 0 || r.chance(0.5 * dm))) { G[k][i] = 2; G._netDirty = true; }
  }
  for (const v of G.vehicles) if (cheb(v.x, v.y, x, y) < 1 && v.t === 'crawler' && v.drones > 0 && r.chance(0.5)) { v.drones--; log(G, 'A meteor destroyed a drone at the crawler.', 'warn', v); }
  if (!id && !depAt(G, x, y) && r.chance(0.6)) { G.deposits.push({ id: G.deposits.length, type: 'scrap', x, y, r: 0, amount: 8 + r.int(14), max: 22, deep: false, meteor: true }); G._dep = depositGrid(G); }
}
function quake(G, u) {
  const r = rng(G), R = 10 + 6 * u.sev, qm = Math.max(0.1, 1 + M(G, 'quake'));
  let hit = 0;
  for (const b of G.buildings) {
    if (b.mod || !b.built || b.t === 'lander') continue;
    const c = center(b), d = dist(c.x, c.y, u.x, u.y); if (d > R) continue;
    b.wear += 55 * u.sev * (1 - d / R) * qm * (BUILDINGS[b.t].dome ? 0.7 : 1);
    if (b.wear >= 150) { b.wear = 150; b.broken = true; hit++; }
  }
  let lines = 0;
  for (let y = Math.max(0, Math.floor(u.y - R)); y < Math.min(MAP_N, u.y + R); y++) for (let x = Math.max(0, Math.floor(u.x - R)); x < Math.min(MAP_N, u.x + R); x++) {
    const i = y * MAP_N + x; if (dist(x, y, u.x, u.y) > R) continue;
    for (const k of ['cable', 'pipe']) if (G[k][i] === 1 && r.chance(0.1 * u.sev * qm)) { G[k][i] = 2; lines++; }
  }
  G._netDirty = true;
  if (hit || lines) log(G, 'The quake broke ' + (hit ? hit + ' building' + (hit > 1 ? 's' : '') : '') + (hit && lines ? ' and ' : '') + (lines ? lines + ' grid segment' + (lines > 1 ? 's' : '') : '') + '.', 'bad', u);
}
// random faults once per sol
function systemFailures(G) {
  const r = rng(G), hm = hzMult(G), lf = Math.max(0.1, 1 + M(G, 'lineFault'));
  let n = 0;
  for (const k of ['cable', 'pipe']) { const L = G[k]; for (let i = 0; i < L.length && n < 3; i++) if (L[i] === 1 && r.chance(0.0016 * hm * lf)) { L[i] = 2; n++; G._netDirty = true; } }
  if (n) log(G, n + ' grid fault' + (n > 1 ? 's' : '') + ' detected (' + (n > 1 ? 'breaks or leaks' : 'a break or leak') + '). Drones in range will fix ' + (n > 1 ? 'them' : 'it') + '.', 'warn');
  if (solOf(G.tick) > 6 && r.chance(0.12 * hm)) {
    const list = G.buildings.filter(b => !b.mod && b.built && !b.broken && b.t !== 'lander' && !BUILDINGS[b.t].dome && BUILDINGS[b.t].maint);
    if (list.length) { const b = r.pick(list); b.wear = 150; b.broken = true; G._netDirty = true; log(G, 'System failure: the ' + BUILDINGS[b.t].name + ' has malfunctioned.', 'bad', b); }
  }
}
Object.assign(KC, { HAZARDS, warnHours });
