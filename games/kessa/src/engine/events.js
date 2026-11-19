// ===== events.js : colony events with choices, and the Choir of the Wardens mystery =====
const someone = (G, pred) => { const list = G.colonists.filter(pred || (c => stage(c) === 'adult')); return list.length ? rng(G).pick(list) : null; };
const allCol = (G, f) => { for (const c of G.colonists) f(c); };
const EVENTS = {
  scrubbers: { title: 'Grit in the scrubbers', text: 'Fine ferrite dust has clogged the air scrubbers of a dome. The filters can be swapped now, or drones can clean them during routine upkeep.',
    cond: G => G.buildings.some(b => b.built && BUILDINGS[b.t] && BUILDINGS[b.t].dome),
    choices: [{ label: 'Swap filters (8 parts)', ok: G => G.res.parts >= 8, run: G => { G.res.parts -= 8; } },
      { label: 'Leave it to the drones', note: 'a dome takes heavy wear', run: G => { const d = G.buildings.filter(b => b.built && BUILDINGS[b.t] && BUILDINGS[b.t].dome); const b = rng(G).pick(d); b.wear = Math.min(149, b.wear + 70); } }] },
  letters: { title: 'Letters from home', text: 'A bundle of messages from Earth arrives at once. People are wistful; some talk of going back.',
    choices: [{ label: 'Host a broadcast night (150)', ok: G => G.funds >= 150, run: G => { G.funds -= 150; allCol(G, c => { c.sanity = Math.min(100, c.sanity + 10); c.hs = Math.max(0, c.hs - 1); }); } },
      { label: 'Carry on', note: 'sanity falls, homesickness grows', run: G => allCol(G, c => { c.sanity = Math.max(0, c.sanity - 8); if (c.morale < 45) c.hs += 1; }) }] },
  stowaway: { title: 'A stowaway', text: 'Rocket crew found a sixteen-year-old hiding in a cargo pod. They want to stay on Kessa.',
    cond: G => G.colonists.length > 5,
    choices: [{ label: 'Welcome them', note: '+1 colonist', run: G => { const d = G.buildings.find(b => b.built && BUILDINGS[b.t] && BUILDINGS[b.t].dome); const p = makePerson(G, { age: 16 }); addColonist(G, p, d ? d.id : null); rehome(G); } },
      { label: 'Send them home', note: 'the sponsor approves', run: G => addConf(G, 4, 'rules upheld') }] },
  gala: { title: 'The sponsor\'s gala', text: 'The sponsor wants live footage of happy colonists for a fundraising gala. It would take a day of everyone\'s time.',
    cond: G => G.colonists.length >= 10,
    choices: [{ label: 'Stage the show', note: 'a sol of research lost, confidence up', run: G => { G.research.pool = Math.max(0, (G.research.pool || 0) - 150); addConf(G, 10, 'the gala was a hit'); } },
      { label: 'Politely decline', run: G => addConf(G, -5, 'gala declined') }] },
  meteorite: { title: 'An iron meteorite', text: 'Drones found a meteorite of almost pure nickel-iron. Museums at home would pay well for it.',
    choices: [{ label: 'Sell it (+450)', run: G => { G.funds += 450; } }, { label: 'Smelt it (+60 metals)', run: G => { G.res.metals += 60; } }] },
  lab: { title: 'Lab accident', text: 'A culture vessel cracked in a lab. Containment needs polymer sheeting, or the staff can tough it out.',
    cond: G => G.colonists.some(c => c.spec === 'scientist'),
    choices: [{ label: 'Seal it (6 polymers)', ok: G => G.res.polymers >= 6, run: G => { G.res.polymers -= 6; } },
      { label: 'Tough it out', note: 'two scientists fall ill', run: G => { for (let i = 0; i < 2; i++) { const c = someone(G, c => c.spec === 'scientist'); if (c) c.health = Math.max(1, c.health - 45); } } }] },
  festival: { title: 'First Light festival', text: 'Colonists propose a festival on the anniversary of landing: music, real food, a sol off.',
    cond: G => G.colonists.length >= 15,
    choices: [{ label: 'Celebrate (200 funding, 25 food)', ok: G => G.funds >= 200 && G.res.food >= 25, run: G => { G.funds -= 200; G.res.food -= 25; allCol(G, c => { c.comfort = Math.min(100, c.comfort + 15); c.sanity = Math.min(100, c.sanity + 15); }); } },
      { label: 'Work as usual', note: 'comfort falls', run: G => allCol(G, c => { c.comfort = Math.max(0, c.comfort - 6); }) }] },
  strike: { title: 'Night-shift grievance', text: 'Night-shift workers want the C shift closed for a while. They are exhausted.',
    cond: G => G.buildings.some(b => b.shifts && b.shifts[2] && b.built),
    choices: [{ label: 'Close night shifts', note: 'less output, rested workers', run: G => { for (const b of G.buildings) if (b.shifts) b.shifts[2] = false; G._jobsDirty = true; allCol(G, c => { c.sanity = Math.min(100, c.sanity + 12); }); } },
      { label: 'Refuse', note: 'morale drops', run: G => allCol(G, c => { c.sanity = Math.max(0, c.sanity - 10); }) }] },
  rival: { title: 'A rival\'s offer', text: 'A competing consortium quietly offers 700 funding for your survey data. Your sponsor would not be pleased.',
    choices: [{ label: 'Sell the data (+700)', run: G => { G.funds += 700; addConf(G, -10, 'data sold to a rival'); } }, { label: 'Refuse', run: G => addConf(G, 4, 'loyalty noted') }] },
  seeds: { title: 'Seed vault offer', text: 'A seed vault at home offers cold-hardy cultivars bred for low pressure, for 300 funding.',
    cond: G => G.buildings.some(b => b.built && (b.t === 'hydro' || b.t === 'greenhouse' || b.t === 'vfarm')),
    choices: [{ label: 'Buy them (300)', note: 'farms +10% for good', ok: G => G.funds >= 300, run: G => { G.funds -= 300; G.bonus.farm = (G.bonus.farm || 0) + 0.1; computeMods(G); } }, { label: 'Decline' }] },
  medical: { title: 'Medical supply gap', text: 'The clinic is running short of medicine. An express shipment costs 250 funding.',
    cond: G => G.colonists.length >= 12,
    choices: [{ label: 'Pay for it (250)', ok: G => G.funds >= 250, run: G => { G.funds -= 250; allCol(G, c => { c.health = Math.min(100, c.health + 20); }); } },
      { label: 'Ration', note: 'some fall ill', run: G => { for (let i = 0; i < 6; i++) { const c = someone(G); if (c) c.health = Math.max(5, c.health - 25); } } }] },
  firmware: { title: 'Drone firmware patch', text: 'Engineers at home wrote a better swarm scheduler. Licensing it costs 200 funding.',
    choices: [{ label: 'License it (200)', note: 'drones +10% for good', ok: G => G.funds >= 200, run: G => { G.funds -= 200; G.bonus.drone = (G.bonus.drone || 0) + 0.1; computeMods(G); } }, { label: 'Skip it' }] },
  wanderer: { title: 'Wanderer\'s itch', text: 'A geologist asks to take the Pathfinder on a long solo survey. It would be risky and lonely.',
    cond: G => G.colonists.some(c => c.spec === 'geologist') && G.sectors.some(s => !s.st),
    choices: [{ label: 'Let them go', note: 'surveys an unknown sector', run: G => { const i = G.sectors.findIndex(s => !s.st); if (i >= 0) finishSurvey(G, i); const c = someone(G, c => c.spec === 'geologist'); if (c) c.sanity = Math.max(0, c.sanity - 15); } },
      { label: 'Not now', run: G => { const c = someone(G, c => c.spec === 'geologist'); if (c) c.sanity = Math.max(0, c.sanity - 5); } }] },
};
function eventsSol(G) {
  if (G.event || !G.st.everColonists || G.colonists.length < 6) return;
  if (!G.evNext) { G.evNext = G.tick + (4 + rng(G).int(5)) * HOURS_PER_SOL; return; }
  if (G.tick < G.evNext) return;
  const pool = Object.keys(EVENTS).filter(k => !(EVENTS[k].cond && !EVENTS[k].cond(G)) && (G.evSeen || []).slice(-5).indexOf(k) < 0);
  if (!pool.length) return;
  const id = rng(G).pick(pool);
  G.event = { id, at: G.tick };
  G.evSeen = (G.evSeen || []).concat(id).slice(-12);
  G.evNext = G.tick + (7 + rng(G).int(6)) * HOURS_PER_SOL;
  log(G, 'Decision needed: ' + EVENTS[id].title + '.', 'warn');
  fx(G, { k: 'event' });
}
function eventChoices(G) { const e = G.event && EVENTS[G.event.id]; if (!e) return []; return e.choices.map((c, i) => ({ i, label: c.label, note: c.note || '', ok: !c.ok || c.ok(G) })); }
function resolveEvent(G, i) {
  const e = G.event && EVENTS[G.event.id]; if (!e) return false;
  const c = e.choices[i]; if (!c || (c.ok && !c.ok(G))) return false;
  if (c.run) c.run(G);
  log(G, e.title + ': ' + c.label + '.', 'info');
  G.event = null; return true;
}
// an unanswered decision resolves itself with the last (do-nothing) option after a sol
function eventHour(G) { if (G.event && G.tick - G.event.at >= 24) { const e = EVENTS[G.event.id]; resolveEvent(G, e.choices.length - 1); } }

// ---- the Choir of the Wardens: a mystery across the whole game ----
const MYSTERY = [
  'The basalt Wardens hum at the same pitch, even kilometres apart. Someone, or something, tuned them.',
  'Warden Harmonics decoded: the hum is a standing wave keyed to a point deep in the region. A new signal source has been marked on the map.',
  'At the Choir, the Pathfinder found a ring of Wardens around a shaft of glassy rock. They answer each other. Engineers think an array could listen back.',
  'The Resonance Array is live. The Wardens fall silent, then sing in unison, and the data streams in: a library of Kessa\'s lost biosphere, left for whoever came next.',
];
function mysteryAnomaly(G, a) {
  const M0 = G.myst;
  if (a.kind === 'choir') {
    M0.stage = 3; G.research.done.myst_choir = G.tick; computeMods(G);
    log(G, MYSTERY[2] + ' (The Resonance Array can now be built.)', 'good', a); return;
  }
  if ((a.kind === 'warden' || a.kind === 'signal') && M0.stage === 0) {
    M0.seen = (M0.seen || 0) + 1;
    if (M0.seen >= 3) {
      M0.stage = 1; if (!G.research.found.includes('myst_harmonics')) G.research.found.push('myst_harmonics');
      log(G, MYSTERY[0] + ' A new breakthrough, Warden Harmonics, can be researched.', 'good');
    }
  }
}
function mysteryTech(G, id) {
  if (id === 'myst_recorder') return halcyonTech(G);
  if (id !== 'myst_harmonics' || G.myst.stage !== 1) return;
  G.myst.stage = 2;
  const best = farSpot(G);
  G.anomalies.push({ id: nextAnomalyId(G), kind: 'choir', x: best.x, y: best.y, done: false, roll: 0, story: true });
  const s = sectorOf(best.x, best.y); G.sectors[sectorIndex(s.sx, s.sy)].st = 1;
  log(G, MYSTERY[1], 'good', best);
}
const nextAnomalyId = G => G.anomalies.reduce((m, a) => Math.max(m, a.id), -1) + 1;
// a flat, empty spot well away from the base, for story sites
function farSpot(G) {
  const L = G.land, r = rng(G);
  let best = null;
  for (let k = 0; k < 400 && !best; k++) { const x = 3 + r.int(MAP_N - 6), y = 3 + r.int(MAP_N - 6); if (Math.hypot(x - L.x, y - L.y) < 18 || G._T.slope[y * MAP_N + x] > SLOPE_DRIVE * 0.7 || G._occ[y * MAP_N + x] || depAt(G, x, y) || G.anomalies.some(a => Math.hypot(a.x - x, a.y - y) < 4)) continue; best = { x, y }; }
  return best || { x: clamp(L.x + 20, 2, MAP_N - 3), y: clamp(L.y - 18, 2, MAP_N - 3) };
}
function mysteryBuilt(G, b) {
  if (b.t === 'array') { G.myst.stage = 4; G.ms.choir = solOf(G.tick); log(G, MYSTERY[3], 'good', b); }
  if (b.t === 'vault') halcyonWake(G, b);
}
// ---- the Halcyon sleepers: a second story, from wrecks and caches ----
const HALCYON = [
  'Two finds carry the same insignia: the survey ship Halcyon, which landed a crew on Kessa forty years ago and then went silent. Its flight recorder is damaged. A new breakthrough, Recorder Forensics, can be researched.',
  'The recorder\'s last entry gives coordinates and one word: "sleep". Halcyon Camp has been marked on the map. Send the Pathfinder.',
  'Under the dust at Halcyon Camp: a sealed cryo vault, its twelve sleepers still alive on a trickle of geothermal power. Engineers can build a Revival Vault to wake them safely (Science).',
  'The Revival Vault opens. Twelve members of the Halcyon crew wake to a colony they never imagined, and ask to stay. Their medicine is forty years old, and better than ours.',
];
function halcyonAnomaly(G, a) {
  const H = G.myst2;
  if (a.kind === 'camp') { H.stage = 3; G.research.done.myst_camp = G.tick; computeMods(G); log(G, HALCYON[2], 'good', a); return; }
  if ((a.kind === 'wreck' || a.kind === 'cache') && H.stage === 0) {
    H.seen = (H.seen || 0) + 1;
    if (H.seen >= 2) { H.stage = 1; if (!G.research.found.includes('myst_recorder')) G.research.found.push('myst_recorder'); log(G, HALCYON[0], 'good'); }
  }
}
function halcyonTech(G) {
  if (G.myst2.stage !== 1) return;
  G.myst2.stage = 2;
  const best = farSpot(G);
  G.anomalies.push({ id: nextAnomalyId(G), kind: 'camp', x: best.x, y: best.y, done: false, roll: 0, story: true });
  const s = sectorOf(best.x, best.y); G.sectors[sectorIndex(s.sx, s.sy)].st = 1;
  log(G, HALCYON[1], 'good', best);
}
function halcyonWake(G, b) {
  G.myst2.stage = 4; G.ms.halcyon = solOf(G.tick);
  const specs = ['engineer', 'engineer', 'scientist', 'scientist', 'medic', 'medic', 'botanist', 'botanist', 'geologist', 'security', 'engineer', 'scientist'];
  for (const spec of specs) { const p = makePerson(G, { spec, age: 30 + rng(G).int(18), traits: ['resilient'] }); const c = addColonist(G, p, null); c.halcyon = true; c.sanity = 90; }
  rehome(G);
  log(G, HALCYON[3], 'good', b);
}
Object.assign(KC, { EVENTS, eventChoices, resolveEvent, MYSTERY, HALCYON });
