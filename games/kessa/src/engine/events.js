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
  const pool = Object.keys(EVENTS).filter(k => !EVENTS[k].story && !(EVENTS[k].cond && !EVENTS[k].cond(G)) && (G.evSeen || []).slice(-5).indexOf(k) < 0);
  if (!pool.length) return;
  const id = rng(G).pick(pool);
  G.event = { id, at: G.tick };
  G.evSeen = (G.evSeen || []).concat(id).slice(-12);
  G.evNext = G.tick + (7 + rng(G).int(6)) * HOURS_PER_SOL;
  log(G, 'Decision needed: ' + EVENTS[id].title + '.', 'warn');
  fx(G, { k: 'event' });
}
// title and text of the waiting decision (some are written for the rival or story they come from)
function eventInfo(G) { const e = G.event && EVENTS[G.event.id]; if (!e) return { title: '', text: '' }; return { title: typeof e.title === 'function' ? e.title(G) : e.title, text: typeof e.text === 'function' ? e.text(G) : e.text }; }
function eventChoices(G) { const e = G.event && EVENTS[G.event.id]; if (!e) return []; return e.choices.map((c, i) => ({ i, label: c.label, note: c.note || '', ok: !c.ok || c.ok(G) })); }
function resolveEvent(G, i) {
  const e = G.event && EVENTS[G.event.id]; if (!e) return false;
  const c = e.choices[i]; if (!c || (c.ok && !c.ok(G))) return false;
  if (c.run) c.run(G);
  log(G, eventInfo(G).title + ': ' + c.label + '.', 'info');
  G.event = null; return true;
}
// an unanswered decision resolves itself with the last (do-nothing) option after a sol
function eventHour(G) { if (G.event && G.tick - G.event.at >= 24) { const e = EVENTS[G.event.id]; resolveEvent(G, e.choices.length - 1); } if (!G.event && G.evq && G.evq.length && G.tick % 6 === 0) storyEvent(G, G.evq.shift()); }

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
  storyTech(G, id);
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
  storyBuilt(G, b);
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
Object.assign(KC, { EVENTS, eventInfo, eventChoices, resolveEvent, MYSTERY, HALCYON });
// ===== 2.1: more colony life, and two new mysteries: the Bloom Below and the Ninth Moon =====
Object.assign(EVENTS, {
  wedding: { title: 'A wedding under glass', text: 'Two colonists want to marry under the dome. A proper ceremony means a feast and an evening off for their friends.',
    cond: G => G.colonists.length >= 20,
    choices: [{ label: 'Hold the ceremony (20 food)', note: 'everyone cheers up', ok: G => G.res.food >= 20, run: G => { G.res.food -= 20; allCol(G, c => { c.sanity = Math.min(100, c.sanity + 8); c.comfort = Math.min(100, c.comfort + 4); }); } },
      { label: 'A quiet signing', run: G => allCol(G, c => { c.sanity = Math.min(100, c.sanity + 2); }) }] },
  feud: { title: 'A feud in the workshop', text: 'Two engineers have been at each other for weeks. Tools go missing, shifts start late.',
    cond: G => G.colonists.filter(c => c.spec === 'engineer').length >= 4,
    choices: [{ label: 'Mediate: a sol off for both', note: 'they cool down', run: G => { for (let i = 0; i < 2; i++) { const c = someone(G, c => c.spec === 'engineer' && !c.rest); if (c) { c.rest = 24; c.sanity = Math.min(100, c.sanity + 15); } } G._jobsDirty = true; } },
      { label: 'Let them sort it out', note: 'it festers', run: G => { for (let i = 0; i < 2; i++) { const c = someone(G, c => c.spec === 'engineer'); if (c) c.sanity = Math.max(0, c.sanity - 22); } } }] },
  mural: { title: 'A mural for the dome', text: 'A colonist with a painter\'s eye offers to cover a dome wall with the view of Earth\'s sky, if you can spare pigment made from polymers.',
    cond: G => G.buildings.some(b => b.built && BUILDINGS[b.t] && BUILDINGS[b.t].dome),
    choices: [{ label: 'Paint it (4 polymers)', note: 'comfort up for good', ok: G => G.res.polymers >= 4, run: G => { G.res.polymers -= 4; G.bonus.comfort = (G.bonus.comfort || 0) + 1; computeMods(G); } },
      { label: 'Not now' }] },
  anthem: { title: 'A song of Kessa', text: 'A Kessa-born teenager wrote a song about the dust and the domes. Half the colony hums it. The sponsor\'s media team would love to air it at home.',
    cond: G => G.st.births >= 1,
    choices: [{ label: 'Broadcast it home', note: 'sponsor confidence up', run: G => addConf(G, 5, 'a song from Kessa went viral') },
      { label: 'Keep it ours', note: 'sanity up', run: G => allCol(G, c => { c.sanity = Math.min(100, c.sanity + 6); }) }] },
  sleepwalker: { title: 'A walk outside', text: 'A night-shift worker was found in an airlock with the outer door half open, still asleep. The interlocks failed to stop them.',
    cond: G => G.buildings.some(b => b.shifts && b.shifts[2] && b.built),
    choices: [{ label: 'Fit new interlocks (6 parts)', ok: G => G.res.parts >= 6, run: G => { G.res.parts -= 6; } },
      { label: 'A stern warning', note: 'it happens again: someone is hurt', run: G => { const c = someone(G); if (c) c.health = Math.max(5, c.health - 35); } }] },
  teacher: { title: 'The old engineer\'s request', text: 'The colony\'s oldest worker asks to leave the works and teach the children full time.',
    cond: G => G.colonists.some(c => stage(c) === 'child') && G.colonists.some(c => c.age >= 55 && stage(c) === 'adult'),
    choices: [{ label: 'Let them teach', note: 'children grow up skilled', run: G => { const c = someone(G, c => c.age >= 55 && stage(c) === 'adult'); if (c) { c.rest = 24; c.teacher = true; } for (const k of G.colonists) if (stage(k) === 'child' && !k.traits.includes('handy') && k.traits.length < 3) { k.traits.push('handy'); break; } G.research.pool = (G.research.pool || 0) + 80; } },
      { label: 'Keep them at work', note: 'they are disappointed', run: G => { const c = someone(G, c => c.age >= 55 && stage(c) === 'adult'); if (c) c.sanity = Math.max(0, c.sanity - 15); } }] },
  // ---- the Bloom Below: fossil spore beds and warm vents lead to the heart of a living network ----
  m_bloom1: { myst: true, story: true, title: 'Spores that turn to each other', text: 'The samples from the bloom beds and the warm vents glow faintly at night, and the spores in separate jars lean towards each other. The Lantern wants to study them; the farmers want to grow them.',
    choices: [{ label: 'Culture them in a sealed lab (6 polymers)', note: 'research now', ok: G => G.res.polymers >= 6, run: G => { G.res.polymers -= 6; G.research.pool = (G.research.pool || 0) + 300; G.myst3.path = 'study'; } },
      { label: 'Plant them in a farm bed', note: 'food now, and they spread', run: G => { G.res.food += 40; G.myst3.path = 'grow'; } }] },
  m_bloom2: { myst: true, story: true, title: 'The heart of the Bloom', text: 'Under the dust lies a warm hollow laced with pale threads, all running to one throbbing knot. It reacts to voices. What now?',
    choices: [{ label: 'Commune: let the scientists sit with it', note: 'research, the Lantern pleased', run: G => { G.research.pool = (G.research.pool || 0) + 450; if (G.council) setSupport(G, 'lantern', 10, 'they met the Bloom'); G.myst3.choice = 'commune'; } },
      { label: 'Harvest its enzymes', note: 'farms +10% for good, the Hearth pleased', run: G => { G.bonus.farm = (G.bonus.farm || 0) + 0.1; computeMods(G); G.res.food += 60; if (G.council) setSupport(G, 'hearth', 10, 'the enzymes feed the farms'); G.myst3.choice = 'harvest'; } }] },
  // ---- the Ninth Moon: a fragment falls, an unknown satellite is found, and it answers ----
  m_moon1: { myst: true, story: true, title: 'Machined, not fallen', text: 'The Pathfinder\'s scans are clear: the fragment is worked metal, cooled long ago in orbit. Tracking finds its source: a dark ninth moon nobody catalogued.',
    choices: [{ label: 'Report it to the sponsor', note: '+400 funding, confidence up', run: G => { G.funds += 400; addConf(G, 6, 'a discovery for the history books'); G.myst4.path = 'report'; } },
      { label: 'Keep it quiet and study it', note: 'research now, the sponsor uneasy', run: G => { G.research.pool = (G.research.pool || 0) + 400; addConf(G, -3, 'secrets from Kessa'); G.myst4.path = 'quiet'; } }] },
  m_moon2: { myst: true, story: true, title: 'The ninth moon is falling', text: 'Orbital Forensics: the ninth moon is a derelict relay, older than any human flight, and its orbit is decaying. Something inside it is still awake.',
    choices: [{ label: 'Nudge it down gently (20 fuel)', note: 'a soft landing near the colony', ok: G => G.res.fuel >= 20, run: G => { G.res.fuel -= 20; moonCapsule(G, true); } },
      { label: 'Hail it', note: 'it answers, and drops something hard', run: G => moonCapsule(G, false) }] },
});
const BLOOM = [
  'Two finds share something alive: spores in the bloom beds and in the warm vents are the same organism, and they signal to each other. A new breakthrough, Mycelial Signalling, can be researched.',
  'The signals all point one way. The Bloom Heart has been marked on the map. Send the Pathfinder.',
  'The heart can be grown into a sunken garden that feeds and calms the colony. Engineers can build the Undergrove (Science).',
  'The Undergrove opens. Pale caps glow in the dark below the dust, and the whole colony sleeps better.',
];
const MOON = [
  'Last night a streak crossed the sky and did not burn up. Something came down far from the colony: a Fallen Fragment has been marked on the map. Send the Pathfinder.',
  'A new breakthrough, Orbital Forensics, can be researched to learn what the ninth moon is.',
  'The Moonfall Capsule has landed. Send the Pathfinder to recover it.',
  'Inside the capsule: a perfect map of every orbit around Kessa and a key to the relay\'s voice. Engineers can build the Skyward Relay (Science).',
  'The Skyward Relay is live. The ninth moon answers every hour now, guiding rockets down through the dust.',
];
// a quiet, flat spot far from the base, chosen from the seed (story sites never touch the colony's own random stream)
function storySpot(G, key) {
  const r = RNG.fromSeed(G.seed + '/' + key), L = G.land;
  for (let k = 0; k < 600; k++) { const x = 3 + r.int(MAP_N - 6), y = 3 + r.int(MAP_N - 6); if (Math.hypot(x - L.x, y - L.y) < 16 || G._T.slope[y * MAP_N + x] > SLOPE_DRIVE * 0.7 || G._occ[y * MAP_N + x] || depAt(G, x, y) || G.anomalies.some(a => Math.hypot(a.x - x, a.y - y) < 4)) continue; return { x, y }; }
  return farSpot(G);
}
function storyEvent(G, id) { if (G.event) { (G.evq = G.evq || []).push(id); return; } G.event = { id, at: G.tick }; log(G, 'Decision needed: ' + EVENTS[id].title + '.', 'warn'); fx(G, { k: 'event' }); }
function storyAnomaly(G, kind, p) { G.anomalies.push({ id: nextAnomalyId(G), kind, x: p.x, y: p.y, done: false, roll: 0, story: true }); const s = sectorOf(p.x, p.y); G.sectors[sectorIndex(s.sx, s.sy)].st = 1; }
function bloomAnomaly(G, a) {
  const B0 = G.myst3 || (G.myst3 = { stage: 0, seen: 0 });
  if (a.kind === 'heart') { B0.stage = 3; G.research.done.myst_bloom = G.tick; computeMods(G); log(G, BLOOM[2], 'good', a); storyEvent(G, 'm_bloom2'); return true; }
  if ((a.kind === 'bloom' || a.kind === 'vent') && B0.stage === 0) { B0.seen++; if (B0.seen >= 2) { B0.stage = 1; if (!G.research.found.includes('myst_mycel')) G.research.found.push('myst_mycel'); log(G, BLOOM[0], 'good'); storyEvent(G, 'm_bloom1'); } }
  return false;
}
function moonAnomaly(G, a) {
  const M4 = G.myst4 || (G.myst4 = { stage: 0 });
  if (a.kind === 'fragment') { M4.stage = 2; if (!G.research.found.includes('myst_orbit')) G.research.found.push('myst_orbit'); log(G, MOON[1], 'good', a); storyEvent(G, 'm_moon1'); return true; }
  if (a.kind === 'capsule') { M4.stage = 4; G.research.done.myst_moon = G.tick; computeMods(G); log(G, MOON[3], 'good', a); return true; }
  return false;
}
function moonCapsule(G, soft) {
  const M4 = G.myst4; M4.stage = 3; M4.soft = soft;
  let p = storySpot(G, 'capsule');
  if (soft) { const L = G.land, r = RNG.fromSeed(G.seed + '/soft'); for (let k = 0; k < 300; k++) { const x = clamp(L.x + r.int(25) - 12, 2, MAP_N - 3), y = clamp(L.y + r.int(25) - 12, 2, MAP_N - 3); if (Math.hypot(x - L.x, y - L.y) < 8 || G._occ[y * MAP_N + x] || G._T.slope[y * MAP_N + x] > SLOPE_DRIVE * 0.7 || depAt(G, x, y)) continue; p = { x, y }; break; } }
  else for (let yy = p.y - 3; yy <= p.y + 3; yy++) for (let xx = p.x - 3; xx <= p.x + 3; xx++) { if (xx < 0 || yy < 0 || xx >= MAP_N || yy >= MAP_N) continue; const i = yy * MAP_N + xx; for (const k of ['cable', 'pipe']) if (G[k][i] === 1) { G[k][i] = 2; G._netDirty = true; } }
  storyAnomaly(G, 'capsule', p); fx(G, { k: 'meteor', x: p.x, y: p.y });
  log(G, MOON[2] + (soft ? ' It came down softly, close to the colony.' : ' It hit hard and cracked grid lines nearby.'), soft ? 'good' : 'warn', p);
}
// the Ninth Moon begins on a sol chosen from the seed, once the colony has people
function storySol(G) {
  const M4 = G.myst4 || (G.myst4 = { stage: 0 });
  if (!G.myst3) G.myst3 = { stage: 0, seen: 0 };
  if (M4.stage === 0 && G.st.everColonists && G.colonists.length >= 15) {
    const due = 32 + RNG.fromSeed(G.seed + '/moonday').int(14);
    if (solOf(G.tick) >= due) { M4.stage = 1; const p = storySpot(G, 'fragment'); storyAnomaly(G, 'fragment', p); fx(G, { k: 'meteor', x: p.x, y: p.y }); log(G, MOON[0], 'good', p); }
  }
  if (!G.event && G.evq && G.evq.length) storyEvent(G, G.evq.shift());
}
function storyTech(G, id) {
  if (id === 'myst_mycel' && G.myst3 && G.myst3.stage === 1) { G.myst3.stage = 2; const p = storySpot(G, 'heart'); storyAnomaly(G, 'heart', p); log(G, BLOOM[1], 'good', p); }
  if (id === 'myst_orbit' && G.myst4 && G.myst4.stage === 2) storyEvent(G, 'm_moon2');
}
function storyBuilt(G, b) {
  if (b.t === 'undergrove' && G.myst3) { G.myst3.stage = 4; G.ms.bloom = solOf(G.tick); log(G, BLOOM[3] + (G.myst3.choice === 'commune' ? ' The scientists swear it dreams.' : ' The farms around it have never grown better.'), 'good', b); }
  if (b.t === 'relay' && G.myst4) { G.myst4.stage = 5; G.ms.moon = solOf(G.tick); log(G, MOON[4], 'good', b); }
  if (b.t === 'orrery') { G.ms.orrery = solOf(G.tick); log(G, 'The Great Orrery turns again. Its rings show the sky of Kessa as it was a hundred thousand years ago, when someone else watched it.', 'good', b); }
}
Object.assign(KC, { BLOOM, MOON, storySol });
