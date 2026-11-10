// ===== combat.js : space battles, starbase capture, retreat, repair, ground invasion, planet capture =====
function applyHit(t, dmg, type) {
  const mult = DMG_VS[type] || DMG_VS.kin;
  if (t.sh > 0) { const d = dmg * mult[0]; if (d <= t.sh) { t.sh -= d; return; } dmg = (d - t.sh) / mult[0]; t.sh = 0; }
  if (t.ar > 0) { const d = dmg * mult[1]; if (d <= t.ar) { t.ar -= d; return; } dmg = (d - t.ar) / mult[1]; t.ar = 0; }
  t.hp -= dmg * mult[2];
}
function combatDay(G) {
  const at = new Map();
  for (const f of G.fleets) { if (f.prog !== 0 || !f.ships.length) continue; let a = at.get(f.sys); if (!a) at.set(f.sys, a = []); a.push(f); }
  G._fight = {}; G._shots = {};
  const fought = new Set();
  for (const [sid, fl] of at) {
    const s = G.systems[sid];
    const owners = new Set(fl.map(f => f.owner)); if (s.sb && !s.sb.dis && s.sb.owner >= 0) owners.add(s.sb.owner);
    if (owners.size < 2) continue;
    // anyone armed facing an enemy?
    const ow = Array.from(owners);
    let any = false;
    for (let i = 0; i < ow.length && !any; i++) for (let j = i + 1; j < ow.length; j++) if (hostile(G, ow[i], ow[j])) { any = true; break; }
    if (!any) continue;
    const armed = fl.some(f => f.kind === 'war' || f.kind === 'monster') || (s.sb && !s.sb.dis && s.sb.lvl > 0);
    if (!armed) continue;
    // guardians never leave their post and only fight what enters
    battle(G, s, fl);
    fought.add(sid);
  }
  // shields recharge, hull repair out of combat
  if (G.day % 2 === 0) for (const f of G.fleets) {
    if (fought.has(f.sys) && f.prog === 0) continue;
    const e = G.empires[f.owner];
    const s = G.systems[f.sys];
    const own = s.owner === f.owner;
    const dock = own && s.sb && s.sb.owner === f.owner && s.sb.mods.includes('drydock') ? 10 : 0;
    for (const sh of f.ships) {
      const st = shipStats(G, e, sh);
      sh.sh = Math.min(st.shield, sh.sh + st.shield * 0.2);
      const rep = (st.repair + (own ? 1 : 0.2) + dock) / 100;
      sh.hp = Math.min(st.hull, sh.hp + st.hull * rep);
      if (own && f.prog === 0 && s.sb && s.sb.owner === f.owner) sh.ar = Math.min(st.armor, (sh.ar || 0) + st.armor * 0.1);
    }
    if (f.morale < 100) f.morale = Math.min(100, f.morale + 4);
  }
}
function battle(G, s, fl) {
  const sid = s.id;
  G._fight[sid] = 1;
  const shots = G._shots[sid] = [];
  const units = []; // {f, i, ship, st, owner}
  for (const f of fl) {
    const e = G.empires[f.owner];
    f.ships.forEach((sh, i) => units.push({ f, i, sh, st: shipStats(G, e, sh), owner: f.owner, w: f.kind === 'war' || f.kind === 'monster' ? 3 : 1 }));
  }
  let sbU = null;
  if (s.sb && !s.sb.dis) { const st = sbStats(G, s); sbU = { sb: s.sb, owner: s.sb.owner, st, sh: s.sb, w: 2 }; }
  const shooters = units.filter(u => (u.f.kind === 'war' || u.f.kind === 'monster') && u.st.weapons.length);
  const all = sbU ? units.concat([sbU]) : units;
  const powerOf = {};
  for (const u of units) powerOf[u.owner] = (powerOf[u.owner] || 0) + (u.st.power || 0) * (u.sh.hp / Math.max(1, u.st.hull));
  if (sbU) powerOf[sbU.owner] = (powerOf[sbU.owner] || 0) + Math.sqrt(sbU.st.dmg * (sbU.st.hull + sbU.st.shield)) * 0.6;
  const fire = (u, w, srcRef) => {
    const tg = all.filter(t => t.sh.hp > 0 && hostile(G, u.owner, t.owner));
    if (!tg.length) return;
    let tot = 0; for (const t of tg) tot += t.w; let r = rnd(G) * tot, t = tg[0];
    for (const x of tg) { r -= x.w; if (r <= 0) { t = x; break; } }
    const ev = t.sb ? 0 : t.st.evasion;
    const hitP = clamp((w.acc + (u.st.acc || 0) - ev) / 100, 0.1, 0.97);
    let hit = rnd(G) < hitP;
    if (hit && w.type === 'mis' && t.st.pd && rnd(G) < t.st.pd) hit = false;
    if (hit) applyHit(t.sh, w.dmg * (0.85 + rnd(G) * 0.3), w.type);
    if (shots.length < 40) shots.push({ a: srcRef, b: t.sb ? 'sb' : t.f.id + ':' + t.i, ty: w.type, h: hit ? 1 : 0, o: u.owner });
  };
  for (const u of shooters) for (const w of u.st.weapons) fire(u, w, u.f.id + ':' + u.i);
  if (sbU && sbU.st.dmg > 0) {
    const n = 4, per = sbU.st.dmg / n;
    for (let k = 0; k < n; k++) fire(sbU, { type: k % 2 ? 'beam' : 'kin', dmg: per, acc: 85 }, 'sb');
  }
  // casualties
  const killedBy = (owner) => { // credit the strongest hostile side present
    let best = -1, bp = -1; for (const k in powerOf) if (hostile(G, owner, +k) && powerOf[k] > bp) { bp = powerOf[k]; best = +k; } return best;
  };
  for (const f of fl) {
    const dead = f.ships.filter(sh => sh.hp <= 0); if (!dead.length) continue;
    const e = G.empires[f.owner];
    const killer = killedBy(f.owner), K = G.empires[killer];
    f.ships = f.ships.filter(sh => sh.hp > 0);
    if (e.kind === 'major') { e.stats.shipsLost += dead.length; if (K && K.kind === 'major') addExhaustion(G, e.id, killer, dead.length * (f.kind === 'war' ? 1.5 : 0.5)); }
    if (K && K.kind === 'major') {
      K.stats.shipsKilled += dead.length;
      for (const sh of dead) if (sh.m) {
        const M = MONSTERS[sh.m]; for (const r in M.reward) addResource(G, K, r, M.reward[r]);
        if (sh.m.startsWith('hollow')) K.stats.crisisKills += M.size;
        if (sh.m === 'warden_ai' || sh.m === 'stormmother') { log(G, -1, `${K.name} has destroyed ${M.name}!`, sid, 'major'); }
      }
    }
    f.morale = Math.max(0, f.morale - 15 * dead.length / (dead.length + f.ships.length));
    if (!f.ships.length) {
      removeFleet(G, f);
      if (e.kind === 'major' && !e.ai) log(G, e.id, `${f.name} was destroyed at ${s.name}.`, sid, 'bad');
      if (K && K.kind === 'major' && !K.ai && f.kind !== 'monster') log(G, K.id, `We destroyed the ${e.adj} ${f.name} at ${s.name}.`, sid, 'good');
      if (K && K.kind === 'major' && !K.ai && f.kind === 'monster') log(G, K.id, `${f.name} destroyed at ${s.name}.`, sid, 'good');
    } else if (e.kind === 'major' && !e.ai && f.kind === 'war') log(G, e.id, `${f.name} lost ${dead.length} ship${dead.length > 1 ? 's' : ''} at ${s.name}.`, sid, 'bad');
  }
  // starbase defeated
  if (sbU && s.sb.hp <= 0) starbaseDefeated(G, s, killedBy(s.sb.owner));
  // retreat when beaten
  for (const f of fl) {
    if (!G.fleets.includes(f) || f.kind === 'monster' || G.empires[f.owner].kind !== 'major') continue;
    const mine = powerOf[f.owner] || 0; let enemy = 0;
    for (const k in powerOf) if (hostile(G, f.owner, +k)) enemy += powerOf[k];
    if (!enemy) continue;
    const e = G.empires[f.owner];
    const hpR = sum(f.ships, sh => sh.hp) / Math.max(1, sum(f.ships, sh => shipStats(G, e, sh).hull));
    const threshold = f.stance === 'passive' ? 0.75 : 0.35;
    if (f.kind !== 'war' || (hpR < threshold && enemy > mine * 1.1) || f.morale < 20) retreat(G, f);
  }
}
function retreat(G, f) {
  if (f.path.length) return; // already leaving
  const s = G.systems[f.sys];
  const safe = s.lanes.filter(w => !G.fleets.some(g => g.sys === w && g.prog === 0 && (g.kind === 'war' || g.kind === 'monster') && hostile(G, f.owner, g.owner)));
  const opts = safe.length ? safe : s.lanes;
  const home = opts.find(w => G.systems[w].owner === f.owner) ?? opts[Math.floor(rnd(G) * opts.length)];
  if (home == null) return;
  f.path = [home]; f.order = null; f.work = 0;
  if (f.kind === 'war') for (const sh of f.ships) sh.hp *= 0.92;
  const e = G.empires[f.owner];
  if (!e.ai) log(G, e.id, `${f.name} is retreating from ${s.name}.`, s.id, 'bad');
}
function starbaseDefeated(G, s, by) {
  const sb = s.sb, old = sb.owner, E = G.empires[old], B = G.empires[by];
  if (!B) { sb.dis = 1; return; }
  if (B.kind === 'fauna') { sb.dis = 1; sb.hp = 0; return; }
  const hasCol = s.planets.some(pid => G.planets[pid].col && G.planets[pid].col.owner === old);
  if (hasCol) {
    sb.dis = 1; sb.hp = 0; sb.queue = [];
    if (!E.ai) log(G, old, `The starbase at ${s.name} has been disabled!`, s.id, 'bad');
    if (B.kind === 'major' && !B.ai) log(G, by, `Enemy starbase at ${s.name} disabled. Invade its planets to take the system.`, s.id, 'good');
    return;
  }
  captureSystem(G, s, by);
}
function captureSystem(G, s, by) {
  const old = s.owner, E = G.empires[old], B = G.empires[by];
  s.owner = by;
  if (B.kind === 'crisis') { s.sb = null; for (const pid of s.planets) G.planets[pid].station = null; }
  else { s.sb.owner = by; s.sb.lvl = Math.max(0, s.sb.lvl - 1); s.sb.dis = 0; s.sb.queue = []; s.sb.mods = s.sb.mods.slice(0, SB_LEVELS[s.sb.lvl].slots); sbReset(G, s); s.sb.hp *= 0.3; s.sb.sh = 0; }
  updateOwnership(G);
  if (E && E.kind === 'major') { addExhaustion(G, old, by, 2); if (!E.ai) log(G, old, `${s.name} has been captured by ${B.name}.`, s.id, 'bad'); }
  if (B.kind === 'major') { B.stats.planetsTaken += 0; if (!B.ai) log(G, by, `We have captured ${s.name}.`, s.id, 'good'); revealAround(G, B, s.id, 1); }
  if (E && E.kind === 'major') checkElimination(G, E);
}
SW.captureSystem = captureSystem;

// ---------- ground invasion ----------
function landArmies(G, f, p) {
  const e = G.empires[f.owner];
  if (!p.siege || p.siege.att !== e.id) p.siege = { att: e.id, armies: [] };
  p.siege.armies.push(...f.ships);
  removeFleet(G, f);
  if (p.col && !G.empires[p.col.owner].ai) log(G, p.col.owner, `Enemy armies have landed on ${p.name}!`, p.sys, 'bad');
  if (!e.ai) log(G, e.id, `Our armies have landed on ${p.name}.`, p.sys, 'info');
}
function primDefense(p) { return p.prim.pops * 40 * (p.prim.stage + 1); }
function groundDay(G) {
  for (const p of G.planets) {
    if (!p.siege) continue;
    const sg = p.siege, A = G.empires[sg.att];
    if (!sg.armies.length || !A.alive) { p.siege = null; continue; }
    const am = empMods(G, A);
    let defOwner = p.col ? G.empires[p.col.owner] : null;
    const fort = p.col ? p.col.fort : 30;
    if (p.prim && sg.def == null) sg.def = primDefense(p);
    const attDmg = sum(sg.armies, a => ARMIES[a.d].dmg) * (1 + mv(am, 'army%') / 100) * (0.4 + 0.6 * (1 - fort / 100)) * (0.85 + rnd(G) * 0.3);
    let defPool = p.col ? p.col.def : sg.def;
    const dm = defOwner ? empMods(G, defOwner) : {};
    const defDmg = (defPool / DEF_ARMY.hp) * DEF_ARMY.dmg * (1 + mv(dm, 'army%') / 100) * (0.85 + rnd(G) * 0.3);
    defPool -= attDmg;
    let dd = defDmg;
    while (dd > 0 && sg.armies.length) { const a = sg.armies[0]; if (a.hp > dd) { a.hp -= dd; dd = 0; } else { dd -= a.hp; sg.armies.shift(); } }
    if (p.col) p.col.def = Math.max(0, defPool); else sg.def = Math.max(0, defPool);
    if (defPool <= 0) {
      p.siege = null;
      if (p.col) transferPlanet(G, p, A.id, true);
      else conquerPrimitive(G, p, A);
    } else if (!sg.armies.length) {
      p.siege = null;
      if (!A.ai) log(G, A.id, `Our invasion of ${p.name} has failed.`, p.sys, 'bad');
      if (defOwner && !defOwner.ai) log(G, defOwner.id, `The invasion of ${p.name} was repelled!`, p.sys, 'good');
      if (defOwner) addExhaustion(G, A.id, defOwner.id, 2);
    }
  }
}
function transferPlanet(G, p, to, conquest) {
  const c = p.col, from = c.owner, E = G.empires[from], T = G.empires[to];
  for (const q of c.queue) if (q.cost) for (const r in q.cost) E.res[r] += Math.round(q.cost[r] * 0.5);
  c.queue = []; c.owner = to; c.def = 0; c.fort = 30; c.auto = T.ai ? true : c.auto; c.grow = 0;
  if (conquest) { c.occupied = G.day; c.pops = Math.max(1, Math.round(c.pops * 0.9)); }
  if (c.bld.includes('seat')) { c.bld.splice(c.bld.indexOf('seat'), 1, 'hub'); }
  const s = G.systems[p.sys];
  const others = s.planets.some(pid => pid !== p.id && G.planets[pid].col && G.planets[pid].col.owner === from);
  updateOwnership(G);
  if (!others && s.owner === from) {
    s.owner = to;
    if (s.sb) { s.sb.owner = to; s.sb.dis = 0; s.sb.queue = []; s.sb.lvl = Math.max(0, s.sb.lvl - 1); s.sb.mods = s.sb.mods.slice(0, SB_LEVELS[s.sb.lvl].slots); sbReset(G, s); s.sb.hp *= 0.3; }
    else { s.sb = { owner: to, lvl: 0, mods: [], hp: 0, sh: 0, queue: [], dis: 0 }; sbReset(G, s); }
  }
  updateOwnership(G);
  if (E.capital === p.id) {
    const cols = colonies(G, E);
    E.capital = cols.length ? cols.sort((a, b) => b.col.pops - a.col.pops)[0].id : -1;
    if (E.capital >= 0) { const nc = G.planets[E.capital].col; if (nc.bld.includes('hub')) nc.bld.splice(nc.bld.indexOf('hub'), 1, 'seat'); else nc.bld.unshift('seat'); }
  }
  T.stats.planetsTaken++;
  addExhaustion(G, from, to, 6);
  dirty(E); dirty(T);
  log(G, from, `${p.name} has fallen to ${T.name}.`, p.sys, 'bad');
  log(G, to, `${p.name} has been conquered.`, p.sys, 'good');
  checkElimination(G, E);
}
SW.transferPlanet = transferPlanet;
function checkElimination(G, E) {
  if (E.kind !== 'major' || !E.alive) return;
  if (colonies(G, E).length) return;
  E.alive = false;
  for (const s of G.systems) if (s.owner === E.id) { s.owner = -1; s.sb = null; for (const pid of s.planets) G.planets[pid].station = null; }
  G.fleets = G.fleets.filter(f => f.owner !== E.id);
  for (const w of G.wars.slice()) if (w.att.includes(E.id) || w.def.includes(E.id)) { w.att = w.att.filter(x => x !== E.id); w.def = w.def.filter(x => x !== E.id); if (!w.att.length || !w.def.length) endWar(G, w, 'status'); }
  updateOwnership(G);
  log(G, -1, `${E.name} has been destroyed.`, -1, 'major');
}
SW.checkElimination = checkElimination;
function conquerPrimitive(G, p, A) {
  const sp = makeSpecies(G, G, { name: p.prim.name, pref: p.type, traits: [] });
  const pops = Math.max(3, Math.round(p.prim.pops * 0.7));
  p.col = newColony(G, A, p, pops); p.col.sp = sp.id; p.col.occupied = G.day; p.col.auto = A.ai || p.col.auto;
  p.col.dist.habitat = 1; p.col.dist.farming = 1;
  p.prim = null;
  const s = G.systems[p.sys];
  if (s.owner < 0) { s.owner = A.id; s.sb = { owner: A.id, lvl: 0, mods: [], hp: 0, sh: 0, queue: [], dis: 0 }; sbReset(G, s); }
  updateOwnership(G); dirty(A);
  log(G, A.id, `The natives of ${p.name} have been brought under our rule.`, p.sys, 'good');
  for (const e of majors(G)) if (e.id !== A.id && e.alive) addOpinion(G, e, A.id, 'Conquered natives', -15, 3600);
}
function addResource(G, e, r, v) {
  if (RESEARCH.includes(r)) { const rs = e.research[r]; rs.prog += v; } else e.res[r] = (e.res[r] || 0) + v;
}
SW.addResource = addResource;
