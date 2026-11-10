// ===== events.js : anomalies, event chains, situational events, offers =====
const RW = (G, v) => Math.round(v * (1 + G.day / 7200));
const sysName = (G, c) => c.sys >= 0 ? G.systems[c.sys].name : 'deep space';
const plName = (G, c) => c.planet >= 0 ? G.planets[c.planet].name : sysName(G, c);
function giveAll(G, e, obj) { for (const r in obj) addResource(G, e, r, obj[r]); dirty(e); }
function rewardText(obj) { return Object.keys(obj).map(r => '+' + obj[r] + ' ' + RES_INFO[r].name.replace(' research', '')).join(', '); }
function capitalOf(G, e) { return e.capital >= 0 ? G.planets[e.capital] : null; }
function hurtFleet(G, c, frac) { const f = c.fleet != null ? fleetById(G, c.fleet) : null; if (f) for (const s of f.ships) s.hp = Math.max(1, s.hp * (1 - frac)); }
function loseFleet(G, c) { const f = c.fleet != null ? fleetById(G, c.fleet) : null; if (f) removeFleet(G, f); }
function addDeposit(G, pid, r, n) { const p = G.planets[pid]; if (!p || PLANET_TYPES[p.type].hab) return false; p.dep = p.dep || {}; const k = Object.keys(p.dep)[0] || r; p.dep = { [k]: (p.dep[k] || 0) + n }; return true; }

var EVENTS = {
  // ---------------- anomalies ----------------
  derelict: { title: 'The Silent Derelict', art: 'ship', anomaly: 1,
    text: (G, e, c) => `Drifting in the outer dark of ${sysName(G, c)} hangs a vessel of unknown make, kilometers long and utterly silent. Its hull bears no markings we recognize. The airlocks look like they were built for something much larger than us.`,
    opts: (G, e, c) => [
      { t: 'Board it and search the archives', ai: 2, fx: () => { if (rnd(G) < 0.65) return { next: 'derelict_archive', delay: 30 }; return { next: 'derelict_trap', delay: 20 }; } },
      { t: `Strip the hull for alloys (+${RW(G, 80)} alloys)`, ai: 1, fx: () => giveAll(G, e, { alloys: RW(G, 80) }) },
    ] },
  derelict_archive: { title: 'Derelict: The Archive', art: 'library',
    text: (G, e, c) => `Our team reached the core. Behind a door that opened at our touch they found a crystalline archive still humming with power. Its makers called themselves the Ulvaen, and they wrote of a long flight from something they would not name.`,
    opts: (G, e, c) => [{ t: `Copy everything (+${RW(G, 120)} Lumen, +${RW(G, 60)} Forge)`, ai: 1, fx: () => giveAll(G, e, { lumen: RW(G, 120), forge: RW(G, 60) }) }] },
  derelict_trap: { title: 'Derelict: Awakened Defenses', art: 'storm',
    text: (G, e, c) => `The moment our team crossed the threshold, old turrets flickered to life. The crew escaped with their lives, but our surveyor was raked by fire before it could pull away.`,
    opts: (G, e, c) => [{ t: 'A hard lesson (surveyor damaged, +40 Forge)', ai: 1, fx: () => { hurtFleet(G, c, 0.6); giveAll(G, e, { forge: 40 }); } }] },
  crystals: { title: 'Singing Crystals', art: 'crystal', anomaly: 1,
    text: (G, e, c) => `The surface of ${plName(G, c)} is covered with crystal spires that resonate in a slow chord when starlight strikes them. Our sensors register structure in the sound, almost like language.`,
    opts: (G, e, c) => [
      { t: `Study the harmonics (+${RW(G, 110)} Vita)`, ai: 1, fx: () => giveAll(G, e, { vita: RW(G, 110) }) },
      { t: 'Harvest them (planet gains a rich mineral deposit)', ai: 2, fx: () => { if (!addDeposit(G, c.planet, 'minerals', 3)) giveAll(G, e, { minerals: RW(G, 200) }); } },
    ] },
  gravity_echo: { title: 'Gravity Echo', art: 'void', anomaly: 1,
    text: (G, e, c) => `Something in ${sysName(G, c)} is bending space in a slow, regular pulse, like a heartbeat with no heart. The source has no mass we can find.`,
    opts: (G, e, c) => [
      { t: 'Keep listening (the echo may deepen)', ai: 2, fx: () => ({ next: 'gravity_echo2', delay: 180 }) },
      { t: 'Log it and move on (+40 Lumen)', ai: 1, fx: () => giveAll(G, e, { lumen: 40 }) },
    ] },
  gravity_echo2: { title: 'The Echo Deepens', art: 'void',
    text: (G, e, c) => `Months of measurement have resolved the echo. It is the shadow of a starlane that once existed, folded away and waiting. With a probe tuned to its rhythm, we might be able to open it again.`,
    opts: (G, e, c) => [
      { t: 'Launch the probe (opens a new starlane)', ai: 2, fx: () => { foldLane(G, e, c); } },
      { t: `Publish the data (+${RW(G, 160)} Lumen)`, ai: 1, fx: () => giveAll(G, e, { lumen: RW(G, 160) }) },
    ] },
  vault: { title: 'The Sealed Vault', art: 'vault', anomaly: 1,
    text: (G, e, c) => `Under the ice of ${plName(G, c)}, our surveyor found a vault door, three hundred meters across, inscribed with rings of symbols that rotate when touched.`,
    opts: (G, e, c) => [
      { t: 'Try to solve the rings', ai: 2, fx: () => ({ next: 'vault2', delay: 120 }) },
      { t: 'Leave it sealed (+30 unity)', ai: 1, fx: () => giveAll(G, e, { unity: 30 }) },
    ] },
  vault2: { title: 'The Vault: Second Ring', art: 'vault',
    text: (G, e, c) => `The outer ring has turned into place. Behind it lies a second, smaller door, and a warning written in the same symbols: "What sleeps here was put here for a reason."`,
    opts: (G, e, c) => [
      { t: 'Open the inner door', ai: 2, fx: () => rnd(G) < 0.7 ? { next: 'vault_treasure', delay: 60 } : { next: 'vault_guardian', delay: 30 } },
      { t: `Respect the warning (+${RW(G, 60)} unity, +${RW(G, 60)} Vita)`, ai: 1, fx: () => giveAll(G, e, { unity: RW(G, 60), vita: RW(G, 60) }) },
    ] },
  vault_treasure: { title: 'The Vault: Treasure of Ages', art: 'library',
    text: (G, e, c) => `Inside, preserved in perfect vacuum, lay the plans for a weapon that focuses starlight into a lance. Our engineers believe they can build it.`,
    opts: (G, e, c) => [{ t: 'Learn Precursor Lances (new weapon)', ai: 1, fx: () => { e.techs.precursor_lance = 1; dirty(e); autoDesigns(G, e); } }] },
  vault_guardian: { title: 'The Vault: Something Wakes', art: 'storm',
    text: (G, e, c) => `The inner door opened on a chamber of sleeping machines. They are not sleeping any more. A swarm of scavenger drones has burst from the vault and claimed ${sysName(G, c)}.`,
    opts: (G, e, c) => [{ t: 'We will deal with them (+60 Forge)', ai: 1, fx: () => { spawnMonster(G, 'scavenger', c.sys, 3, false); giveAll(G, e, { forge: 60 }); } }] },
  sleepers: { title: 'Frozen Sleepers', art: 'alien', anomaly: 1,
    text: (G, e, c) => `A crashed ark on ${plName(G, c)} still holds hundreds of cryogenic pods. Most have failed. Forty-one occupants are still alive, of a species that matches nothing in our records.`,
    opts: (G, e, c) => [
      { t: 'Revive them and offer a home (+2 pops on the capital)', ai: 2, fx: () => { const p = capitalOf(G, e); if (p) p.col.pops += 2; } },
      { t: `Study the pods (+${RW(G, 100)} Vita)`, ai: 1, fx: () => giveAll(G, e, { vita: RW(G, 100) }) },
    ] },
  lost_colony: { title: 'A Beacon from the Lost', art: 'planet', anomaly: 1, cond: (G, e, s) => s.planets.some(pid => PLANET_TYPES[G.planets[pid].type].hab && !G.planets[pid].col && !G.planets[pid].prim),
    text: (G, e, c) => `A faint distress beacon on ${sysName(G, c)} leads to a tiny settlement of castaways, the last survivors of a colony ship that strayed generations ago. They ask to join us.`,
    opts: (G, e, c) => [
      { t: 'Welcome them (a new colony is founded here)', ai: 3, fx: () => { const s = G.systems[c.sys]; const p = s.planets.map(id => G.planets[id]).find(q => PLANET_TYPES[q.type].hab && !q.col && !q.prim); if (p && (s.owner < 0 || s.owner === e.id)) { p.col = newColony(G, e, p, 3); p.col.auto = !!e.ai || !!G.cfg.autoColonies; if (s.owner < 0) { s.owner = e.id; s.sb = { owner: e.id, lvl: 0, mods: [], hp: 0, sh: 0, queue: [], dis: 0 }; sbReset(G, s); } updateOwnership(G); dirty(e); } else giveAll(G, e, { unity: 80 }); } },
      { t: 'Take them home (+1 pop on the capital, +40 unity)', ai: 1, fx: () => { const p = capitalOf(G, e); if (p) p.col.pops += 1; giveAll(G, e, { unity: 40 }); } },
    ] },
  stellar_storm: { title: 'Stellar Storm', art: 'storm', anomaly: 1,
    text: (G, e, c) => `The star of ${sysName(G, c)} is throwing off a storm of charged plasma. Inside it, our instruments catch glimpses of physics we have never seen.`,
    opts: (G, e, c) => [
      { t: `Fly into the storm (+${RW(G, 200)} Lumen, surveyor badly damaged)`, ai: 1, fx: () => { giveAll(G, e, { lumen: RW(G, 200) }); hurtFleet(G, c, 0.75); } },
      { t: 'Observe from a safe distance (+50 Lumen)', ai: 2, fx: () => giveAll(G, e, { lumen: 50 }) },
    ] },
  bloom: { title: 'Microbial Bloom', art: 'planet', anomaly: 1,
    text: (G, e, c) => `The oceans of ${plName(G, c)} are blooming with a microbe that eats metal and glows blue at night. It could be a gift to our biologists, or a plague.`,
    opts: (G, e, c) => [
      { t: `Bring samples home (+${RW(G, 180)} Vita, 30% risk of plague)`, ai: 1, fx: () => { giveAll(G, e, { vita: RW(G, 180) }); if (rnd(G) < 0.3) return { next: 'bloom_plague', delay: 90 }; } },
      { t: 'Study it in orbit only (+60 Vita)', ai: 2, fx: () => giveAll(G, e, { vita: 60 }) },
    ] },
  bloom_plague: { title: 'The Blue Plague', art: 'riot',
    text: (G, e, c) => `The metal-eating microbe has escaped containment on our capital. Hospitals are full and the night streets glow faintly blue.`,
    opts: (G, e, c) => [
      { t: `Quarantine and fund a cure (-${RW(G, 150)} energy)`, ai: 2, fx: () => { e.res.energy = Math.max(0, e.res.energy - RW(G, 150)); } },
      { t: 'Let it burn out (-10 capital stability for 4 years)', ai: 1, fx: () => { e.flags.plague = G.day + 1440; dirty(e); } },
    ] },
  hollow_rock: { title: 'Hollow Asteroid', art: 'ship', anomaly: 1,
    text: (G, e, c) => `One of the rocks in ${sysName(G, c)} is hollow. Inside is a hidden dock, recently used, packed with stolen cargo.`,
    opts: (G, e, c) => [
      { t: `Seize the cargo (+${RW(G, 150)} energy, +${RW(G, 100)} minerals)`, ai: 2, fx: () => { giveAll(G, e, { energy: RW(G, 150), minerals: RW(G, 100) }); if (rnd(G) < 0.5) return { next: 'raiders_return', delay: 120 }; } },
      { t: 'Leave a tracking beacon (+40 Forge)', ai: 1, fx: () => giveAll(G, e, { forge: 40 }) },
    ] },
  raiders_return: { title: 'The Owners Return', art: 'fleet',
    text: (G, e, c) => `The scavengers whose cargo we took have come back for revenge. A raider band has appeared in ${sysName(G, c)}.`,
    opts: (G, e, c) => [{ t: 'Let them come', ai: 1, fx: () => { spawnMonster(G, 'scavenger', c.sys, 2 + Math.floor(G.day / 10000), false); } }] },
  whispers: { title: 'The Whispering Void', art: 'void', anomaly: 1,
    text: (G, e, c) => `Our surveyor crew in ${sysName(G, c)} report hearing voices in the static, always just below understanding. Some of the crew have started to sing along.`,
    opts: (G, e, c) => [
      { t: `Record the songs (+${RW(G, 90)} unity)`, ai: 2, fx: () => { giveAll(G, e, { unity: RW(G, 90) }); return { next: 'whispers2', delay: 360 }; } },
      { t: 'Shield the crew and leave (+30 Lumen)', ai: 1, fx: () => giveAll(G, e, { lumen: 30 }) },
    ] },
  whispers2: { title: 'The Voices Return', art: 'void',
    text: (G, e, c) => `The songs recorded in ${sysName(G, c)} have spread through our worlds. Choirs perform them in plazas. Some say the songs are a gift; others say they are a summons.`,
    opts: (G, e, c) => [
      { t: 'Embrace the songs (+15% unity, -3 stability for 10 years)', ai: 2, fx: () => addTimed(G, e, 'The Void Songs', { 'unity%': 15, 'stability+': -3 }, 3600) },
      { t: 'Ban them (+5 stability for 5 years)', ai: 1, fx: () => addTimed(G, e, 'Silence Edict', { 'stability+': 5 }, 1800) },
    ] },
  shattered_moon: { title: 'Shattered Moon', art: 'planet', anomaly: 1,
    text: (G, e, c) => `A moon in ${sysName(G, c)} was broken apart long ago. Its fragments are laced with pure metals, exposed by the impact.`,
    opts: (G, e, c) => [{ t: 'Mark it for mining (deposit, or minerals now)', ai: 1, fx: () => { if (!addDeposit(G, c.planet, 'minerals', 3)) giveAll(G, e, { minerals: RW(G, 250) }); } }] },
  star_map: { title: 'A Map of Stars', art: 'map', anomaly: 1,
    text: (G, e, c) => `Carved into a cliff on ${plName(G, c)} is a map of this region of the galaxy, accurate to within a light-year. Three points are marked with the same strange sigil.`,
    opts: (G, e, c) => [
      { t: 'Follow the sigils (reveals much of the galaxy)', ai: 2, fx: () => { for (const s of G.systems) if (rnd(G) < 0.35) e.known[s.id] = 1; for (const id of G.beacons || []) e.known[id] = 1; return { next: 'star_map2', delay: 300 }; } },
      { t: 'Photograph it (+60 Lumen)', ai: 1, fx: () => giveAll(G, e, { lumen: 60 }) },
    ] },
  star_map2: { title: 'The Sigils Align', art: 'beacon',
    text: (G, e, c) => `Our scholars have matched the sigils to the Wake Beacons, ancient structures scattered across the galaxy. The map's makers believed that whoever attunes enough Beacons can wake the starlanes themselves.`,
    opts: (G, e, c) => [{ t: `Remarkable (+${RW(G, 200)} Lumen toward Wakefield Theory)`, ai: 1, fx: () => giveAll(G, e, { lumen: RW(G, 200) }) }] },
  egg: { title: 'The Starwhale Egg', art: 'egg', anomaly: 1,
    text: (G, e, c) => `In the asteroid field of ${sysName(G, c)} rests an egg the size of a mountain. Something inside is moving. It turns toward our ship.`,
    opts: (G, e, c) => [
      { t: 'Wait for it to hatch', ai: 2, fx: () => ({ next: 'egg2', delay: 240 }) },
      { t: `Harvest it (+${RW(G, 220)} Vita)`, ai: 1, fx: () => giveAll(G, e, { vita: RW(G, 220) }) },
    ] },
  egg2: { title: 'The Hatchling', art: 'egg',
    text: (G, e, c) => `The egg has hatched. The young starwhale seems to have imprinted on our surveyor, following it like a calf. It is already larger than any ship we have built.`,
    opts: (G, e, c) => [
      { t: 'Bond with it (a Tamed Starwhale joins your fleets)', ai: 2, fx: () => { const f = makeFleet(G, e.id, c.sys, [{ m: 'leviathan', hp: MONSTERS.leviathan.hull, ar: MONSTERS.leviathan.armor, sh: MONSTERS.leviathan.shield }], 'war'); f.name = 'Starwhale'; e.techs.leviathan_bond = 1; dirty(e); } },
      { t: 'Release it into the wild (+60 unity)', ai: 1, fx: () => giveAll(G, e, { unity: 60 }) },
    ] },
  mirror: { title: 'Mirror World', art: 'planet', anomaly: 1,
    text: (G, e, c) => `The surface of ${plName(G, c)} is a single, perfect reflector. The planet glows with stolen starlight that could power a nation.`,
    opts: (G, e, c) => [{ t: 'Tap the light (energy deposit, or energy now)', ai: 1, fx: () => { if (!addDeposit(G, c.planet, 'energy', 3)) giveAll(G, e, { energy: RW(G, 250) }); } }] },
  data_ghost: { title: 'Ghost in the Satellite', art: 'library', anomaly: 1,
    text: (G, e, c) => `An ancient satellite orbiting ${plName(G, c)} contains a mind, a damaged intelligence that asks, politely, to be set free.`,
    opts: (G, e, c) => [
      { t: 'Set it free (+10% research for 10 years)', ai: 2, fx: () => addTimed(G, e, 'Grateful Ghost', { 'research%': 10 }, 3600) },
      { t: `Extract its memories (+${RW(G, 150)} Lumen, +${RW(G, 150)} Forge)`, ai: 1, fx: () => giveAll(G, e, { lumen: RW(G, 150), forge: RW(G, 150) }) },
      { t: 'Erase it (+20 influence)', ai: 0, fx: () => giveAll(G, e, { influence: 20 }) },
    ] },
  drifting_library: { title: 'The Drifting Library', art: 'library', anomaly: 1,
    text: (G, e, c) => `A station shaped like a seed pod drifts through ${sysName(G, c)}. Its walls are covered in writing, millions of pages etched in metal.`,
    opts: (G, e, c) => [{ t: `Read what we can (+${RW(G, 70)} to every research stream)`, ai: 1, fx: () => giveAll(G, e, { lumen: RW(G, 70), vita: RW(G, 70), forge: RW(G, 70) }) }] },
  ion_gardens: { title: 'Ion Gardens', art: 'planet', anomaly: 1, cond: (G, e, s) => s.planets.some(pid => PLANET_TYPES[G.planets[pid].type].big),
    text: (G, e, c) => `In the upper clouds of a gas giant in ${sysName(G, c)} float vast gardens of living ion-sails, feeding on lightning.`,
    opts: (G, e, c) => [
      { t: `Study them (+${RW(G, 140)} Vita)`, ai: 1, fx: () => giveAll(G, e, { vita: RW(G, 140) }) },
      { t: 'Harvest their charge (energy deposit on the giant)', ai: 2, fx: () => { const g = G.systems[c.sys].planets.find(pid => PLANET_TYPES[G.planets[pid].type].big); if (g == null || !addDeposit(G, g, 'energy', 3)) giveAll(G, e, { energy: RW(G, 200) }); } },
    ] },
  graveyard: { title: 'Graveyard of Ships', art: 'fleet', anomaly: 1,
    text: (G, e, c) => `Thousands of wrecks orbit the star of ${sysName(G, c)}, the remains of a battle fought before our species learned to use fire.`,
    opts: (G, e, c) => [
      { t: `Salvage the wrecks (+${RW(G, 160)} alloys)`, ai: 2, fx: () => giveAll(G, e, { alloys: RW(G, 160) }) },
      { t: `Study the battle (+${RW(G, 180)} Forge)`, ai: 1, fx: () => giveAll(G, e, { forge: RW(G, 180) }) },
    ] },
  time_wreck: { title: 'The Slow Ship', art: 'ship', anomaly: 1,
    text: (G, e, c) => `A wreck in ${sysName(G, c)} is trapped in a bubble of slowed time. Inside, its crew are frozen mid-step, and the bubble is shrinking.`,
    opts: (G, e, c) => [
      { t: 'Pull them out before it closes', ai: 1, fx: () => rnd(G) < 0.5 ? { next: 'time_wreck_ok', delay: 30 } : giveAll(G, e, { lumen: 40 }) },
      { t: `Measure the bubble (+${RW(G, 120)} Lumen)`, ai: 2, fx: () => giveAll(G, e, { lumen: RW(G, 120) }) },
    ] },
  time_wreck_ok: { title: 'Out of Time', art: 'alien',
    text: (G, e, c) => `We pulled four survivors from the bubble. They are explorers from an empire that fell twelve thousand years ago, and they are eager to share their engineering.`,
    opts: (G, e, c) => [{ t: `Welcome them (+${RW(G, 220)} Forge, +1 pop)`, ai: 1, fx: () => { giveAll(G, e, { forge: RW(G, 220) }); const p = capitalOf(G, e); if (p) p.col.pops++; } }] },
  sunken_city: { title: 'The Drowned City', art: 'planet', anomaly: 1, cond: (G, e, s) => s.planets.some(pid => ['tidal', 'jungle', 'fen'].includes(G.planets[pid].type)),
    text: (G, e, c) => `Sonar sweeps of ${sysName(G, c)} have found towers under a planetary ocean, lit by lamps that still burn after a hundred thousand years.`,
    opts: (G, e, c) => [
      { t: `Send divers into the archives (+${RW(G, 90)} unity, +${RW(G, 90)} Vita)`, ai: 2, fx: () => giveAll(G, e, { unity: RW(G, 90), vita: RW(G, 90) }) },
      { t: 'Leave a shrine above the waves (+5% unity for 10 years)', ai: 1, fx: () => addTimed(G, e, 'Shrine of the Drowned', { 'unity%': 5, 'stability+': 2 }, 3600) },
    ] },
  pulsar_choir: { title: 'The Counting Pulsar', art: 'science', anomaly: 1,
    text: (G, e, c) => `The radio pulses in ${sysName(G, c)} are not random. They count: one, two, three, five, seven... Something taught a dead star to recite primes.`,
    opts: (G, e, c) => [
      { t: 'Decode the full message (results in a year)', ai: 2, fx: () => ({ next: 'pulsar_choir2', delay: 360 }) },
      { t: `Publish the discovery (+${RW(G, 120)} Lumen)`, ai: 1, fx: () => giveAll(G, e, { lumen: RW(G, 120) }) },
    ] },
  pulsar_choir2: { title: 'The Prime Message', art: 'science',
    text: (G, e, c) => `The prime sequence was a key. Beneath it lay a treatise on field theory older than any living species, and our physicists have barely slept since.`,
    opts: (G, e, c) => [
      { t: `Pour it into current projects (+${RW(G, 160)} to every research stream)`, ai: 2, fx: () => giveAll(G, e, { lumen: RW(G, 160), vita: RW(G, 160), forge: RW(G, 160) }) },
      { t: 'Found an academy around it (+8% research for 10 years)', ai: 1, fx: () => addTimed(G, e, 'Prime Academy', { 'research%': 8 }, 3600) },
    ] },
  nomad_fleet: { title: 'The Drifter Flotilla', art: 'refugee', anomaly: 1,
    text: (G, e, c) => `A ragged flotilla of nomads drifts through ${sysName(G, c)}, living on ships older than our cities. Their elders ask what we will do with them.`,
    opts: (G, e, c) => [
      { t: 'Offer them a home (+2 pops on the capital)', ai: 2, fx: () => { const p = capitalOf(G, e); if (p) p.col.pops += 2; } },
      { t: `Trade with them (+${RW(G, 180)} energy)`, ai: 1, fx: () => giveAll(G, e, { energy: RW(G, 180) }) },
      { t: `Seize their ships (+${RW(G, 150)} alloys; raiders will seek revenge)`, ai: 0, fx: () => { giveAll(G, e, { alloys: RW(G, 150) }); return { next: 'raiders_return', delay: 200 }; } },
    ] },
  ancient_yard: { title: 'The Sleeping Shipyard', art: 'fleet', anomaly: 1,
    text: (G, e, c) => `A shipyard of unknown origin orbits in ${sysName(G, c)}, its slips still holding a half-finished hull. The assembly drones wait for orders in a language we almost understand.`,
    opts: (G, e, c) => [
      { t: 'Finish the hull (a free warship joins your fleets)', ai: 2, fx: () => { const hull = ['monarch', 'warden', 'lancer', 'picket'].find(h => hullAvailable(e, h)) || 'picket'; const d = bestDesign(G, e, hull); if (d != null) { const f = makeFleet(G, e.id, c.sys, [d], 'war'); f.name = 'Yardborn'; } } },
      { t: `Study the drones (+${RW(G, 200)} Forge)`, ai: 1, fx: () => giveAll(G, e, { forge: RW(G, 200) }) },
    ] },
  separatists: { title: 'Voices of Autonomy', art: 'riot', random: 1, cond: (G, e) => colonies(G, e).length >= 7,
    text: (G, e, c) => `Our far colonies are demanding a say in their own affairs. Petitions, then marches, then strikes: the movement is growing.`,
    opts: (G, e, c) => [
      { t: 'Grant a charter of autonomy (+6 stability, -1 influence per month for 10 years)', ai: 2, fx: () => addTimed(G, e, 'Autonomy Charter', { 'stability+': 6, 'influence+': -1 }, 3600) },
      { t: 'Suppress the movement (+80 influence, -6 stability for 5 years)', ai: 1, fx: () => { giveAll(G, e, { influence: 80 }); addTimed(G, e, 'Crackdown', { 'stability+': -6 }, 1800); } },
    ] },
  grand_expo: { title: 'A Galactic Exposition', art: 'contact', random: 1, cond: (G, e) => G.day > 5400 && Object.keys(e.rel).some(k => e.rel[k].contact >= 0),
    text: (G, e, c) => `Our diplomats propose a grand exposition: a festival of arts and science to which every known empire would be invited.`,
    opts: (G, e, c) => [
      { t: `Host it (-${RW(G, 200)} energy, +25 opinion with everyone you know)`, ai: 1, fx: () => { e.res.energy = Math.max(0, e.res.energy - RW(G, 200)); for (const k in e.rel) if (e.rel[k].contact >= 0 && G.empires[k].alive) addOpinion(G, G.empires[k], e.id, 'Grand exposition', 25, 3600); } },
      { t: 'Spend the money at home (+10% goods for 5 years)', ai: 1, fx: () => addTimed(G, e, 'Domestic Fair', { 'goods%': 10 }, 1800) },
    ] },
  brain_drain: { title: 'The Brain Drain', art: 'science', random: 1, cond: (G, e) => G.day > 3600,
    text: (G, e, c) => `A rival academy is luring our best researchers away with grand salaries. Our labs are emptying.`,
    opts: (G, e, c) => [
      { t: `Match their offers (-${RW(G, 150)} energy)`, ai: 2, fx: () => { e.res.energy = Math.max(0, e.res.energy - RW(G, 150)); } },
      { t: 'Let them go (-10% research for 3 years)', ai: 1, fx: () => addTimed(G, e, 'Brain Drain', { 'research%': -10 }, 1080) },
    ] },
  // ---------------- natives ----------------
  prim_found: { title: 'A World That Looks Up', art: 'prim',
    text: (G, e, c) => { const p = G.planets[c.planet]; return `The ${p.prim.name} of ${p.name} are a ${['stone-age', 'bronze-age', 'industrial', 'atomic'][p.prim.stage]} civilization. They do not know we exist. Our scientists ask to watch them from hidden posts.`; },
    opts: (G, e, c) => [
      { t: 'Observe them in secret (+unity, more to come)', ai: 2, fx: () => { const p = G.planets[c.planet]; if (p.prim && p.prim.observed < 0) p.prim.observed = e.id; giveAll(G, e, { unity: 25 }); return { next: 'prim_watch', delay: 900 }; } },
      { t: 'Leave them alone', ai: 1, fx: () => {} },
    ] },
  prim_watch: { title: 'The Watchers Report', art: 'prim',
    text: (G, e, c) => { const p = G.planets[c.planet]; return p.prim ? `Years of quiet observation of the ${p.prim.name} have taught us much. Now our observers ask: should we reveal ourselves and lift them to the stars? We must own the ${G.systems[p.sys].name} system to do it.` : `The natives we watched are gone from our view.`; },
    opts: (G, e, c) => { const p = G.planets[c.planet]; const can = p.prim && G.systems[p.sys].owner === e.id; return [
      { t: can ? 'Uplift them (the planet joins your empire)' : 'Uplift them (requires owning the system: +unity instead)', ai: 3, fx: () => { if (can) upliftPrimitive(G, e, p); else giveAll(G, e, { unity: RW(G, 60) }); } },
      { t: `Keep watching (+${RW(G, 80)} unity, +${RW(G, 80)} Vita)`, ai: 1, fx: () => giveAll(G, e, { unity: RW(G, 80), vita: RW(G, 80) }) },
    ]; } },
  // ---------------- situational ----------------
  labor_dispute: { title: 'Labor Dispute', art: 'riot', random: 1, cond: (G, e) => colonies(G, e).some(p => (p.col.stab || 50) < 45),
    text: (G, e, c) => `Workers on ${plName(G, c)} have laid down their tools, demanding shorter shifts and better rations.`,
    opts: (G, e, c) => [
      { t: `Meet their demands (-${RW(G, 100)} energy, +10 stability there for 5 years)`, ai: 2, fx: () => { e.res.energy = Math.max(0, e.res.energy - RW(G, 100)); const p = G.planets[c.planet]; if (p && p.col) p.col.unrest = 0; addTimed(G, e, 'Labor Accord', { 'stability+': 3 }, 1800); } },
      { t: `Crack down (+${RW(G, 80)} minerals, unrest there)`, ai: 1, fx: () => { giveAll(G, e, { minerals: RW(G, 80) }); const p = G.planets[c.planet]; if (p && p.col) p.col.unrest = 12; } },
    ] },
  harvest: { title: 'Bountiful Harvest', art: 'harvest', random: 1,
    text: (G, e, c) => `Perfect seasons across our worlds have produced the largest harvest in living memory.`,
    opts: (G, e, c) => [
      { t: `Store it (+${RW(G, 200)} food)`, ai: 1, fx: () => giveAll(G, e, { food: RW(G, 200) }) },
      { t: 'Hold a festival (+15% amenities, +3 stability for 3 years)', ai: 1, fx: () => addTimed(G, e, 'Harvest Festival', { 'amen%': 15, 'stability+': 3 }, 1080) },
    ] },
  breakthrough: { title: 'Scientific Breakthrough', art: 'science', random: 1,
    text: (G, e, c) => `A young researcher has published a paper that has every lab in the empire buzzing. Where should we focus the follow-up work?`,
    opts: (G, e, c) => RESEARCH.map(k => ({ t: `${STREAM_NAMES[k]} (+${RW(G, 120)})`, ai: 1, fx: () => giveAll(G, e, { [k]: RW(G, 120) }) })) },
  refugees: { title: 'Refugee Flotilla', art: 'refugee', random: 1, cond: (G) => G.day > 3600,
    text: (G, e, c) => `A ragged flotilla of refugees has arrived at our border, fleeing a war in distant space. They ask for sanctuary.`,
    opts: (G, e, c) => [
      { t: 'Grant sanctuary (+3 pops on your largest colonies)', ai: 2, fx: () => { const cs = colonies(G, e).slice().sort((a, b) => b.col.pops - a.col.pops); for (let i = 0; i < 3 && cs.length; i++) cs[i % cs.length].col.pops++; } },
      { t: 'Turn them away (+20 influence)', ai: 1, fx: () => giveAll(G, e, { influence: 20 }) },
    ] },
  envoy: { title: 'The Grey Envoy', art: 'envoy', random: 1, cond: (G) => G.day > 2400,
    text: (G, e, c) => `A lone ship of impossible design has hailed us. Its pilot, a grey figure who gives no name, offers a gift "for the coming dark", in return for a tithe.`,
    opts: (G, e, c) => [
      { t: `Pay the tithe (-${RW(G, 120)} energy, +${RW(G, 200)} to a random research stream)`, ai: 2, fx: () => { e.res.energy = Math.max(0, e.res.energy - RW(G, 120)); giveAll(G, e, { [rpick(G, RESEARCH)]: RW(G, 200) }); } },
      { t: 'Send it away', ai: 1, fx: () => {} },
    ] },
  solar_flare: { title: 'Solar Flare', art: 'storm', random: 1,
    text: (G, e, c) => `A massive flare from our home star has scorched the orbital grid. Repair crews are already at work.`,
    opts: (G, e, c) => [
      { t: `Repair at once (-${RW(G, 80)} minerals)`, ai: 2, fx: () => { e.res.minerals = Math.max(0, e.res.minerals - RW(G, 80)); } },
      { t: 'Ration power (-10% energy for 2 years)', ai: 1, fx: () => addTimed(G, e, 'Damaged Grid', { 'energy%': -10 }, 720) },
    ] },
  golden_age: { title: 'Age of Wonders', art: 'science', random: 1, cond: (G, e) => G.day > 7200,
    text: (G, e, c) => `Artists, engineers and philosophers across our worlds speak of a golden age. The people want to build something to remember it by.`,
    opts: (G, e, c) => [
      { t: 'Build monuments (+10% unity, +5 stability for 10 years)', ai: 1, fx: () => addTimed(G, e, 'Golden Age', { 'unity%': 10, 'stability+': 5 }, 3600) },
      { t: 'Invest in industry (+10% minerals and alloys for 10 years)', ai: 1, fx: () => addTimed(G, e, 'Golden Age of Industry', { 'minerals%': 10, 'alloys%': 10 }, 3600) },
    ] },
  // ---------------- diplomacy and crises ----------------
  first_contact: { title: 'First Contact', art: 'contact',
    text: (G, e, c) => { const o = G.empires[c.other], sp = G.species[o.species]; return `Our ships have met the ${o.name}, a ${sp.body.toLowerCase()} people who call themselves the ${sp.name}. They value ${o.ethos.map(x => ETHOS[x].name).join(' and ')} and are ruled as a ${GOVS[o.gov].name}.`; },
    opts: (G, e, c) => [
      { t: 'Send greetings (+10 opinion)', ai: 1, fx: () => addOpinion(G, G.empires[c.other], e.id, 'Warm greetings', 10, 3600) },
      { t: 'Warn them to keep their distance (+15 influence, -20 opinion)', ai: 1, fx: () => { giveAll(G, e, { influence: 15 }); addOpinion(G, G.empires[c.other], e.id, 'Hostile greeting', -20, 3600); } },
    ] },
  war_declared: { title: 'War!', art: 'war',
    text: (G, e, c) => `The ${G.empires[c.other].name} has declared war on us. Their goal: ${WAR_GOALS[c.goal].name}. ${WAR_GOALS[c.goal].desc}`,
    opts: (G, e, c) => [{ t: 'To arms!', ai: 1, fx: () => {} }] },
  ai_offer: { title: 'A Proposal', art: 'envoy',
    text: (G, e, c) => `The ${G.empires[c.other].name} proposes a ${TREATIES[c.treaty].name}. ${TREATIES[c.treaty].desc}`,
    opts: (G, e, c) => [
      { t: `Accept (-${treatyCost(c.treaty) / 2} influence)`, ai: 1, fx: () => { if (!rel(G, e.id, c.other).treaties[c.treaty] && !atWar(G, e.id, c.other) && G.empires[c.other].alive) { signTreaty(G, c.other, e.id, c.treaty); } } },
      { t: 'Decline', ai: 1, fx: () => addOpinion(G, G.empires[c.other], e.id, 'Rejected our proposal', -5, 1800) },
    ] },
  peace_offer: { title: 'An Offer of Peace', art: 'envoy',
    text: (G, e, c) => { const w = G.wars.find(x => x.id === c.war); return w ? `The ${G.empires[c.other].name} offers ${c.terms === 'status' ? 'a white peace: both sides keep what they hold.' : 'to yield to us. ' + WAR_GOALS[sideOf(w, e.id) === 'att' ? w.goal : 'humiliate'].desc}` : 'The war has already ended.'; },
    opts: (G, e, c) => [
      { t: 'Accept', ai: 1, fx: () => { const w = G.wars.find(x => x.id === c.war); if (w) { const ms = sideOf(w, e.id); endWar(G, w, c.terms === 'status' ? 'status' : 'win', c.terms === 'status' ? null : ms); } } },
      { t: 'Refuse and fight on', ai: 1, fx: () => {} },
    ] },
  crisis_omen: { title: 'The Stars Go Dark', art: 'hollow',
    text: (G, e, c) => `Astronomers across the galaxy report the same thing: at the rim, stars are dimming one by one, as if something is drinking their light. Old texts from a dozen species speak of a Hollow Choir that sings the stars to sleep.`,
    opts: (G, e, c) => [{ t: 'Prepare the fleets', ai: 1, fx: () => {} }] },
  crisis_arrive: { title: 'The Hollow Choir', art: 'hollow',
    text: (G, e, c) => `Spires of black crystal have torn their way into ${c.names}. From them pour silent ships that sing in frequencies that make our sensors weep. They are coming for every living world. Destroy the Spires to end this.`,
    opts: (G, e, c) => [{ t: 'Every empire must stand together', ai: 1, fx: () => {} }] },
  crisis_end: { title: 'The Choir Falls Silent', art: 'beacon',
    text: (G, e, c) => `The last Hollow Spire has shattered. The stars at the rim are rekindling. ${c.hero} struck the most blows against the Choir.`,
    opts: (G, e, c) => [{ t: 'The galaxy endures', ai: 1, fx: () => {} }] },
};
var ANOMALY_KEYS = Object.keys(EVENTS).filter(k => EVENTS[k].anomaly);
var RANDOM_EVENT_KEYS = Object.keys(EVENTS).filter(k => EVENTS[k].random);

function pickAnomaly(G, e, s) {
  const used = new Set(G.systems.filter(x => x.anom && x.anom.key).map(x => x.anom.key));
  let pool = ANOMALY_KEYS.filter(k => !EVENTS[k].cond || EVENTS[k].cond(G, e, s));
  const fresh = pool.filter(k => !used.has(k));
  if (fresh.length) pool = fresh;
  return rpick(G, pool);
}
function eventOptions(G, e, p) { const E = EVENTS[p.key]; return typeof E.opts === 'function' ? E.opts(G, e, p.ctx) : E.opts; }
SW.eventOptions = eventOptions;
function startEvent(G, e, key, ctx, delay) {
  if (!EVENTS[key]) return;
  const p = { id: nextId(G, 'ev'), e: e.id, key, ctx: ctx || {}, at: G.day + (delay || 0) };
  if (e.ai && !delay) { resolveFor(G, e, p, null); return; }
  G.pending.push(p);
}
SW.startEvent = startEvent;
function resolveFor(G, e, p, idx) {
  const opts = eventOptions(G, e, p);
  if (idx == null) { const o = rweighted(G, opts, x => x.ai == null ? 1 : x.ai); idx = opts.indexOf(o); }
  const o = opts[idx]; if (!o) return;
  const res = o.fx(G, e, p.ctx);
  dirty(e);
  if (res && res.next) startEvent(G, e, res.next, p.ctx, res.delay || 1);
}
function resolveEvent(G, pid, idx) {
  const i = G.pending.findIndex(p => p.id === pid); if (i < 0) return 'Gone';
  const p = G.pending[i]; G.pending.splice(i, 1);
  resolveFor(G, G.empires[p.e], p, idx);
  return null;
}
SW.resolveEvent = resolveEvent;
// events waiting for the human player right now
SW.playerEvents = (G, eid) => G.pending.filter(p => p.e === eid && p.at <= G.day);
function firePending(G) {
  if (!G.pending.length) return;
  for (const p of G.pending.slice()) {
    if (p.at > G.day) continue;
    const e = G.empires[p.e];
    if (!e.alive && e.kind === 'major') { G.pending.splice(G.pending.indexOf(p), 1); continue; }
    if (e.ai) { G.pending.splice(G.pending.indexOf(p), 1); resolveFor(G, e, p, null); }
  }
}
function randomEventsMonthly(G) {
  if (G.cfg.events === false) return;
  for (const e of alive(G)) {
    if (rnd(G) > 0.018) continue;
    const pool = RANDOM_EVENT_KEYS.filter(k => !EVENTS[k].cond || EVENTS[k].cond(G, e));
    if (!pool.length) continue;
    const key = rpick(G, pool);
    let ctx = { sys: G.planets[e.capital] ? G.planets[e.capital].sys : -1, planet: e.capital };
    if (key === 'labor_dispute') { const p = colonies(G, e).filter(q => (q.col.stab || 50) < 45)[0]; if (p) ctx = { sys: p.sys, planet: p.id }; }
    startEvent(G, e, key, ctx);
  }
}
function foldLane(G, e, c) {
  const s = G.systems[c.sys];
  const cands = G.systems.filter(t => t.id !== s.id && !s.lanes.includes(t.id) && hyp(t.x - s.x, t.y - s.y) > 250 && hyp(t.x - s.x, t.y - s.y) < 700);
  if (!cands.length) { giveAll(G, e, { lumen: 150 }); return; }
  const t = rpick(G, cands);
  s.lanes.push(t.id); t.lanes.push(s.id); e.known[t.id] = 1;
  G.folded = (G.folded || []).concat([[s.id, t.id]]);
  log(G, -1, `A folded starlane has opened between ${s.name} and ${t.name}.`, s.id, 'major');
}
function upliftPrimitive(G, e, p) {
  const sp = makeSpecies(G, G, { name: p.prim.name, pref: p.type, traits: [] });
  p.col = newColony(G, e, p, p.prim.pops); p.col.sp = sp.id; p.col.auto = !!e.ai || !!G.cfg.autoColonies;
  p.col.dist.habitat = 1; p.col.dist.farming = 1; p.col.dist.generator = 1;
  p.prim = null; updateOwnership(G); dirty(e);
  log(G, e.id, `The natives of ${p.name} have joined us among the stars.`, p.sys, 'good');
}
