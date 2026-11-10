// ===== actors.js : roaming fauna, native civilizations, the Hollow Choir crisis =====
var CRISIS_LEVELS = { off: 0, mild: 0.7, normal: 1, strong: 1.5 };
function monstersDay(G) {
  for (const f of G.fleets) {
    if (f.kind !== 'monster' || f.stationary || f.path.length || f.prog) continue;
    if (f.owner === G.faunaId) {
      if (rnd(G) > 0.04) continue;
      const s = G.systems[f.sys];
      const isRaider = f.ships[0] && f.ships[0].m === 'scavenger';
      const opts = s.lanes.filter(w => (isRaider || G.systems[w].owner < 0) && !G.fleets.some(g => g.sys === w && g.stationary));
      if (opts.length) f.path = [rpick(G, opts)];
    } else if (f.owner === G.crisisId) crisisMove(G, f);
  }
  // the crisis consumes worlds it holds orbit over
  if (G.crisis.stage >= 2 && G.day % 45 === 0) {
    for (const f of G.fleets) {
      if (f.owner !== G.crisisId || f.prog || f.stationary) continue;
      const s = G.systems[f.sys];
      if (!orbitClear(G, G.crisisId, s.id)) continue;
      for (const pid of s.planets) {
        const p = G.planets[pid]; if (!p.col) continue;
        const owner = G.empires[p.col.owner];
        p.col.pops -= 1;
        if (p.col.pops <= 0) {
          p.col = null; p.type = 'hollowed'; p.station = null; updateOwnership(G); dirty(owner);
          log(G, -1, `${p.name} has been hollowed by the Choir. Nothing lives there now.`, s.id, 'bad');
          checkElimination(G, owner);
        }
      }
      if (s.owner >= 0 && s.owner !== G.crisisId && !s.planets.some(pid => G.planets[pid].col)) { if (s.sb) s.sb.hp = 0; captureSystem(G, s, G.crisisId); }
    }
  }
}
function crisisMove(G, f) {
  const d = jumpDist(G, [f.sys], 12);
  let best = -1, bs = 1e9;
  for (const s of G.systems) {
    if (d[s.id] < 0 || s.owner < 0 || G.empires[s.owner].kind !== 'major') continue;
    const sc = d[s.id] * 10 - s.planets.filter(pid => G.planets[pid].col).length * 3 + rnd(G) * 6;
    if (sc < bs) { bs = sc; best = s.id; }
  }
  if (best >= 0 && best !== f.sys) moveTo(G, f, best);
}
function actorsMonthly(G) {
  // natives slowly advance
  for (const p of G.planets) {
    if (!p.prim) continue;
    p.prim.prog += rnd(G) < 0.5 ? 1 : 0;
    if (p.prim.prog >= 150 && p.prim.stage < 3) { p.prim.stage++; p.prim.prog = 0; p.prim.pops += 2; if (p.prim.observed >= 0 && !G.empires[p.prim.observed].ai) log(G, p.prim.observed, `The ${p.prim.name} of ${p.name} have entered a new age.`, p.sys, 'info'); }
  }
  // voidmoths drift back into empty space over time
  if (G.day % (DAYS_YEAR * 5) === 0) {
    const n = G.fleets.filter(f => f.owner === G.faunaId && !f.stationary).length;
    if (n < Math.floor(G.systems.length / 40)) {
      const free = G.systems.filter(s => s.owner < 0 && !G.fleets.some(f => f.sys === s.id));
      if (free.length) spawnMonster(G, 'voidmoth', rpick(G, free).id, 2, false);
    }
  }
  crisisMonthly(G);
}
function crisisMonthly(G) {
  const lvl = CRISIS_LEVELS[G.cfg.crisis] ?? 1; if (!lvl) return;
  const C = G.crisis, omen = Math.floor(G.endDay * 0.42 / DAYS_MONTH) * DAYS_MONTH, arrive = Math.floor(G.endDay * 0.5 / DAYS_MONTH) * DAYS_MONTH;
  if (C.stage === 0 && G.day >= omen) {
    C.stage = 1; for (const e of alive(G)) startEvent(G, e, 'crisis_omen', {});
    log(G, -1, 'Stars at the rim of the galaxy are going dark.', -1, 'major');
  }
  if (C.stage === 1 && G.day >= arrive) crisisArrive(G, lvl);
  if (C.stage === 2) {
    const spires = G.fleets.filter(f => f.owner === G.crisisId && f.stationary);
    if (!spires.length) {
      C.stage = 3;
      const hero = alive(G).slice().sort((a, b) => b.stats.crisisKills - a.stats.crisisKills)[0];
      if (hero) { hero.flags.lightbringer = 1; addTimed(G, hero, 'Lightbringer', { 'unity%': 20, 'stability+': 5 }, DAYS_YEAR * 30); }
      for (const e of alive(G)) startEvent(G, e, 'crisis_end', { hero: hero ? 'The ' + hero.name : 'No one' });
      log(G, -1, 'The Hollow Choir has been defeated.', -1, 'major');
      G.empires[G.crisisId].alive = false;
      return;
    }
    const roam = G.fleets.filter(f => f.owner === G.crisisId && !f.stationary).length;
    if (G.day % (DAYS_MONTH * 4) === 0 && roam < 6 + spires.length * 3) {
      for (const sp of spires) {
        C.waves = (C.waves || 0) + 1;
        const f = spawnMonster(G, 'hollow_drone', sp.sys, 2 + Math.floor(C.waves / 6), false);
        if (C.waves % 3 === 0) f.ships.push(...spawnMonster(G, 'hollow_reaver', sp.sys, 1, false).ships.splice(0));
        G.fleets = G.fleets.filter(x => x.ships.length);
        f.name = 'Hollow Choir';
      }
    }
  }
}
function crisisArrive(G, lvl) {
  const C = G.crisis;
  const powers = alive(G).map(e => empirePower(G, e)).sort((a, b) => b - a);
  const top = powers[0] || 1000, med = powers[Math.floor(powers.length / 2)] || 500;
  C.scale = Math.round(clamp((top * 0.3 + med * 0.7) / 2000, 1, 14) * lvl * 100) / 100;
  C.stage = 2;
  const cr = G.empires[G.crisisId]; cr.alive = true;
  // spires at the galactic rim, far from capitals
  const caps = alive(G).map(e => G.planets[e.capital] ? G.planets[e.capital].sys : -1).filter(x => x >= 0);
  const capD = jumpDist(G, caps, 4);
  const rim = G.systems.filter(s => hyp(s.x, s.y) > G.R * 0.7 && capD[s.id] < 0 && !s.special).map(s => s.id);
  const cands = rim.length >= 3 ? rim : G.systems.filter(s => capD[s.id] < 0).map(s => s.id);
  const o = { rng: G.rng };
  const sites = spreadPick(G, o, cands, G.cfg.size === 'small' ? 2 : 3, caps, 0);
  const names = [];
  for (const sid of sites) {
    const s = G.systems[sid];
    for (const f of G.fleets.filter(f => f.sys === sid && f.kind !== 'monster')) removeFleet(G, f);
    if (s.owner >= 0) { for (const pid of s.planets) { const p = G.planets[pid]; if (p.col) { const ow = G.empires[p.col.owner]; p.col = null; p.type = 'hollowed'; checkElimination(G, ow); } } }
    s.owner = G.crisisId; s.sb = null; s.special = 'rift';
    const sp = spawnMonster(G, 'hollow_spire', sid, 1, true); sp.name = 'Hollow Spire';
    spawnMonster(G, 'hollow_drone', sid, 3, false).name = 'Hollow Choir';
    names.push(s.name);
    for (const e of alive(G)) e.known[sid] = 1;
  }
  updateOwnership(G);
  for (const e of alive(G)) startEvent(G, e, 'crisis_arrive', { names: names.join(', ') });
  log(G, -1, `The Hollow Choir has arrived at ${names.join(', ')}.`, sites[0], 'major');
}
SW.crisisArrive = crisisArrive;
