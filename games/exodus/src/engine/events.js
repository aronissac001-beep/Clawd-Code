// ===== events.js : random colony events with a choice. Humans decide in a dialog; AIs pick by value. =====
const pg = (G, n) => Math.round(n * paceOf(G));
const randomCity = (G, pid, f) => { const cs = ownCities(G, pid).filter(f || (() => true)); return cs.length ? cs[G._rng.int(cs.length)] : null; };
const sciTo = (G, pid, n) => { const P = G.players[pid]; if (P.research) P.progress[P.research] = (P.progress[P.research] || 0) + n; else P.progress._bank = (P.progress._bank || 0) + n; };
const EVENTS = [
  { key: 'scholar', title: 'A Stowaway Scientist', text: () => 'A scientist who slept through landfall in a cargo pod offers to join your labs, for a fee.',
    setup: (G, pid) => { const P = G.players[pid]; return P.research && P.gold >= pg(G, 50) ? { gold: pg(G, 50), sci: Math.round(techCost(G, P.research, pid) * 0.3) } : null; },
    options: [
      { label: c => `Pay ${c.gold} credits: +${c.sci} science toward your research`, apply: (G, pid, c) => { G.players[pid].gold -= c.gold; sciTo(G, pid, c.sci); }, ai: (G, pid, c) => c.sci * 1.2 - c.gold },
      { label: () => 'We have scientists enough', apply: () => {}, ai: () => 0 }] },
  { key: 'harvest', title: 'Glowroot Bloom', text: c => `The glowroot fields around ${c.name} have bloomed all at once.`,
    setup: (G, pid) => { const c = randomCity(G, pid); return c ? { city: c.id, name: c.name, food: pg(G, 25), gold: pg(G, 45) } : null; },
    options: [
      { label: c => `Store the harvest: +${c.food} food in ${c.name}`, apply: (G, pid, c) => { const x = cityById(G, c.city); if (x) x.food += c.food; }, ai: (G, pid, c) => c.food * 1.4 },
      { label: c => `Sell the surplus: +${c.gold} credits`, apply: (G, pid, c) => { G.players[pid].gold += c.gold; }, ai: (G, pid, c) => c.gold }] },
  { key: 'fire', title: 'Reactor Fire!', text: c => `A power cell has caught fire in the workshops of ${c.name}.`,
    setup: (G, pid) => { const c = randomCity(G, pid, x => x.prod >= 15); return c ? { city: c.id, name: c.name, gold: pg(G, 35), lost: Math.floor(c.prod * 0.6) } : null; },
    options: [
      { label: c => `Pay ${c.gold} credits for suppression drones`, can: (G, pid, c) => G.players[pid].gold >= c.gold, apply: (G, pid, c) => { G.players[pid].gold -= c.gold; }, ai: (G, pid, c) => -c.gold },
      { label: c => `Let it burn out: lose ${c.lost} stored production`, apply: (G, pid, c) => { const x = cityById(G, c.city); if (x) x.prod = Math.max(0, x.prod - c.lost); }, ai: (G, pid, c) => -c.lost * 1.3 }] },
  { key: 'singing', title: 'The Forest Sings', text: () => 'At dusk the fungal forests hummed in harmony for an hour. Some colonists wept; some were afraid.',
    setup: (G, pid) => ({ aff: 8, cul: pg(G, 35) }),
    options: [
      { label: c => `Record it and listen: +${c.aff} Communion`, apply: (G, pid, c) => { gainAff(G, pid, 'communion', c.aff); }, ai: (G, pid) => aiAffinity(G, pid) === 'communion' ? 60 : 10 },
      { label: c => `Hold a concert of old-world music: +${c.cul} culture, +4 Lineage`, apply: (G, pid, c) => { G.players[pid].culturePool += c.cul; gainAff(G, pid, 'lineage', 4); }, ai: (G, pid, c) => c.cul * 0.8 + (aiAffinity(G, pid) === 'lineage' ? 30 : 0) }] },
  { key: 'festival', title: 'Landfall Day', text: () => 'The colonists ask for a festival on the anniversary of landfall.',
    setup: (G, pid) => G.players[pid].gold >= pg(G, 60) ? { gold: pg(G, 60), cul: pg(G, 45) } : null,
    options: [
      { label: c => `Fund it: −${c.gold} credits, +${c.cul} culture`, apply: (G, pid, c) => { const P = G.players[pid]; P.gold -= c.gold; P.culturePool += c.cul; }, ai: (G, pid, c) => c.cul * 1.2 - c.gold },
      { label: () => 'Not this year', apply: () => {}, ai: () => 0 }] },
  { key: 'inventor', title: 'A Clever Rigger', text: c => `A rigger in ${c.name} has a design for a self-assembling crane.`,
    setup: (G, pid) => { const c = randomCity(G, pid, x => x.build); return c && G.players[pid].gold >= pg(G, 70) ? { city: c.id, name: c.name, gold: pg(G, 70), prod: pg(G, 60) } : null; },
    options: [
      { label: c => `Fund the prototype: −${c.gold} credits, +${c.prod} production in ${c.name}, +4 Lattice`, apply: (G, pid, c) => { const x = cityById(G, c.city); G.players[pid].gold -= c.gold; if (x) x.prod += c.prod; gainAff(G, pid, 'lattice', 4); }, ai: (G, pid, c) => c.prod * 1.3 - c.gold },
      { label: () => 'Decline politely', apply: () => {}, ai: () => 0 }] },
  { key: 'sickness', title: 'Spore Fever', text: c => `Spore fever is spreading through ${c.name}.`,
    setup: (G, pid) => { const c = randomCity(G, pid, x => x.pop >= 5 && !x.buildings.includes('temple')); return c ? { city: c.id, name: c.name, gold: pg(G, 45) } : null; },
    options: [
      { label: c => `Pay ${c.gold} credits for antifungals`, can: (G, pid, c) => G.players[pid].gold >= c.gold, apply: (G, pid, c) => { G.players[pid].gold -= c.gold; }, ai: (G, pid, c) => -c.gold },
      { label: c => `Let the fever run: ${c.name} loses 1 citizen, +6 Communion`, apply: (G, pid, c) => { const x = cityById(G, c.city); if (x && x.pop > 1) { x.pop--; assignWorkers(G, x); } gainAff(G, pid, 'communion', 6); }, ai: (G, pid) => aiAffinity(G, pid) === 'communion' ? -20 : -55 }] },
  { key: 'refugees', title: 'A Late Lander', text: c => `A lander that drifted for years has come down near ${c.name}, full of tired families.`,
    setup: (G, pid) => { const c = randomCity(G, pid); return c && civHappiness(G, pid).net >= 1 ? { city: c.id, name: c.name, gold: pg(G, 30) } : null; },
    options: [
      { label: c => `Take them in: +1 citizen in ${c.name}`, apply: (G, pid, c) => { const x = cityById(G, c.city); if (x) { x.pop++; assignWorkers(G, x); } }, ai: (G, pid) => civHappiness(G, pid).net >= 2 ? 50 : -10 },
      { label: c => `Resupply them for another colony: −${c.gold} credits`, can: (G, pid, c) => G.players[pid].gold >= c.gold, apply: (G, pid, c) => { G.players[pid].gold -= c.gold; }, ai: (G, pid, c) => 5 - c.gold }] },
  { key: 'ore', title: 'A Lumenite Vein', text: c => `Drill crews near ${c.name} hit a vein of glowing crystal.`,
    setup: (G, pid) => { const c = randomCity(G, pid, x => x.tiles.some(t => G.map.improv[t] === IMPI.mine)); return c ? { city: c.id, name: c.name, gold: pg(G, 80), prod: pg(G, 40) } : null; },
    options: [
      { label: c => `Sell it: +${c.gold} credits`, apply: (G, pid, c) => { G.players[pid].gold += c.gold; }, ai: (G, pid, c) => c.gold },
      { label: c => `Use it: +${c.prod} production in ${c.name}`, apply: (G, pid, c) => { const x = cityById(G, c.city); if (x) x.prod += c.prod; }, ai: (G, pid, c) => c.prod * 1.6 }] },
  { key: 'bandits', title: 'Convoy Raiders', text: () => 'Deserters from the arks are raiding convoys between your colonies.',
    setup: (G, pid) => ownCities(G, pid).length >= 2 && G.players[pid].gold >= pg(G, 40) ? { gold: pg(G, 30), loss: pg(G, 50) } : null,
    options: [
      { label: c => `Hire escorts: −${c.gold} credits`, apply: (G, pid, c) => { G.players[pid].gold -= c.gold; }, ai: (G, pid, c) => -c.gold },
      { label: c => `Ignore them: they steal up to ${c.loss} credits`, apply: (G, pid, c) => { const P = G.players[pid]; P.gold = Math.max(0, P.gold - c.loss); }, ai: (G, pid, c) => -c.loss * 0.9 }] },
  { key: 'artist', title: 'A Holo-Artist', text: c => `A famous holo-artist offers to fill a hall in ${c.name} with light.`,
    setup: (G, pid) => { const c = randomCity(G, pid); return c ? { city: c.id, name: c.name, cul: pg(G, 35), sci: pg(G, 25) } : null; },
    options: [
      { label: c => `Scenes of home: +${c.cul} culture`, apply: (G, pid, c) => { G.players[pid].culturePool += c.cul; }, ai: (G, pid, c) => c.cul * personaOf(G, pid).c },
      { label: c => `Scenes of Veyra, from the Field Lab's data: +${c.sci} science`, apply: (G, pid, c) => { sciTo(G, pid, c.sci); }, ai: (G, pid, c) => c.sci * personaOf(G, pid).s }] },
  { key: 'comet', title: 'A Comet Between the Moons', text: () => 'A comet has passed between Veyra\'s twin moons. Everyone wants to know what it means.',
    setup: (G, pid) => ({ sci: pg(G, 25), cul: pg(G, 25) }),
    options: [
      { label: c => `Ask the astronomers: +${c.sci} science`, apply: (G, pid, c) => sciTo(G, pid, c.sci), ai: (G, pid, c) => c.sci * personaOf(G, pid).s },
      { label: c => `Let the poets have it: +${c.cul} culture`, apply: (G, pid, c) => { G.players[pid].culturePool += c.cul; }, ai: (G, pid, c) => c.cul * personaOf(G, pid).c }] },
  { key: 'lost_map', title: 'A Survey Leak', text: () => 'A trader offers orbital survey data stolen from another faction.',
    setup: (G, pid) => G.players[pid].gold >= pg(G, 40) ? { gold: pg(G, 40) } : null,
    options: [
      { label: c => `Buy it for ${c.gold} credits: reveal the land around a far colony`, apply: (G, pid, c) => { const P = G.players[pid]; P.gold -= c.gold; const far = G.cities.filter(x => x.owner !== pid && !P.explored[x.tile]); const t = far.length ? far[G._rng.int(far.length)].tile : null; if (t !== null) for (const n of G._grid.within(t, 3)) P.explored[n] = 1; }, ai: () => 10 },
      { label: () => 'Probably corrupted', apply: () => {}, ai: () => 0 }] },
  { key: 'drought', title: 'Acid Rain', text: c => `Acid rain has scorched the farms around ${c.name}.`,
    setup: (G, pid) => { const c = randomCity(G, pid, x => x.food >= 10); return c ? { city: c.id, name: c.name, gold: pg(G, 40), food: Math.floor(c.food * 0.5) } : null; },
    options: [
      { label: c => `Ship in food: −${c.gold} credits`, can: (G, pid, c) => G.players[pid].gold >= c.gold, apply: (G, pid, c) => { G.players[pid].gold -= c.gold; }, ai: (G, pid, c) => -c.gold },
      { label: c => `Ration: ${c.name} loses ${c.food} stored food`, apply: (G, pid, c) => { const x = cityById(G, c.city); if (x) x.food = Math.max(0, x.food - c.food); }, ai: (G, pid, c) => -c.food * 1.2 }] },
  { key: 'veterans', title: 'Old Soldiers', text: () => 'Veterans of the wars at home offer to train your troops.',
    setup: (G, pid) => { const us = G.units.filter(u => u.owner === pid && UNITS[u.type].military && UNITS[u.type].cls !== 'recon'); return us.length >= 2 ? { n: Math.min(3, us.length), gold: pg(G, 35) } : null; },
    options: [
      { label: c => `Pay ${c.gold} credits: ${c.n} units gain 15 experience`, can: (G, pid, c) => G.players[pid].gold >= c.gold, apply: (G, pid, c) => { G.players[pid].gold -= c.gold; G.units.filter(u => u.owner === pid && UNITS[u.type].military && UNITS[u.type].cls !== 'recon').slice(0, c.n).forEach(u => { u.xp = (u.xp || 0) + 15; }); }, ai: (G, pid, c) => (AGGRESSION[civKey(G.players[pid])] || 1) * 30 - c.gold },
      { label: () => 'Thank them for their service', apply: () => {}, ai: () => 0 }] },
  { key: 'library_gift', title: 'The Ark Logs', text: c => `Engineers in ${c.name} recovered the ark's full flight logs.`,
    setup: (G, pid) => { const c = randomCity(G, pid, x => x.buildings.includes('library')); return c ? { city: c.id, name: c.name, sci: pg(G, 30), cul: pg(G, 30) } : null; },
    options: [
      { label: c => `Study them: +${c.sci} science`, apply: (G, pid, c) => sciTo(G, pid, c.sci), ai: (G, pid, c) => c.sci * personaOf(G, pid).s },
      { label: c => `Publish them: +${c.cul} culture`, apply: (G, pid, c) => { G.players[pid].culturePool += c.cul; }, ai: (G, pid, c) => c.cul * personaOf(G, pid).c }] },
  { key: 'wild_horses', title: 'A Loper Herd', text: c => `A herd of wild lopers grazes near ${c.name}.`,
    setup: (G, pid) => { const c = randomCity(G, pid); return c && hasTech(G.players[pid], 'mobile_warfare') ? { city: c.id, name: c.name, gold: pg(G, 50) } : null; },
    options: [
      { label: c => `Break them to the saddle: a free Rover crew in ${c.name}, +5 Communion`, apply: (G, pid, c) => { const x = cityById(G, c.city); gainAff(G, pid, 'communion', 5); if (!x) return; const k = unitFor(civKey(G.players[pid]), 'rover'), t = spawnTileFor(G, x, k); if (t >= 0) spawnUnit(G, k, pid, t); }, ai: () => 45 },
      { label: c => `Cull them for chitin: +${c.gold} credits`, apply: (G, pid, c) => { G.players[pid].gold += c.gold; enrage(G, pid, 4); }, ai: (G, pid, c) => c.gold }] },
  { key: 'guild_dispute', title: 'A Shift Strike', text: c => `The fabricator crews of ${c.name} are refusing to work double shifts.`,
    setup: (G, pid) => { const c = randomCity(G, pid, x => x.build && x.pop >= 4); return c ? { city: c.id, name: c.name, gold: pg(G, 40), cul: pg(G, 20) } : null; },
    options: [
      { label: c => `Raise their pay: −${c.gold} credits`, can: (G, pid, c) => G.players[pid].gold >= c.gold, apply: (G, pid, c) => { G.players[pid].gold -= c.gold; }, ai: (G, pid, c) => -c.gold },
      { label: c => `Give them the week off: −${c.cul} culture, the colony loses this turn's production`, apply: (G, pid, c) => { const P = G.players[pid], x = cityById(G, c.city); P.culturePool = Math.max(0, P.culturePool - c.cul); if (x) x.prod = Math.max(0, x.prod - cityReport(G, x).prod); }, ai: (G, pid, c) => -c.cul - 20 }] },
  { key: 'shipwreck', title: 'A Beached Hull', text: () => 'A foreign transport ran aground on your shallows, its hold still sealed.',
    setup: (G, pid) => ownCities(G, pid).some(c => isCoastal(G.map, G._grid, c.tile)) ? { gold: pg(G, 70), att: 1 } : null,
    options: [
      { label: c => `Salvage the cargo: +${c.gold} credits`, apply: (G, pid, c) => { G.players[pid].gold += c.gold; }, ai: (G, pid, c) => c.gold },
      { label: () => 'Rescue the crew and send them home: +1 morale for good', apply: (G, pid) => { const cap = G.cities.find(x => x.owner === pid && x.capital); if (cap) cap.masterworks = (cap.masterworks || 0) + 0.5; }, ai: () => 40 }] },
  { key: 'eclipse', title: 'Double Eclipse', text: () => 'Both moons crossed the sun at once. For an hour, the Veil glowed brighter than day.',
    setup: (G, pid) => ({ aff: 6, gold: pg(G, 25) }),
    options: [
      { label: c => `Measure the field surge: +${c.aff} Lattice`, apply: (G, pid, c) => { gainAff(G, pid, 'lattice', c.aff); }, ai: (G, pid) => aiAffinity(G, pid) === 'lattice' ? 60 : 10 },
      { label: c => `Sell tickets to the viewing domes: +${c.gold} credits`, apply: (G, pid, c) => { G.players[pid].gold += c.gold; }, ai: (G, pid, c) => c.gold }] },
  { key: 'gene_purity', title: 'The Purity Petition', text: () => 'Colonists petition the council to ban gene-weaving on human children.',
    setup: (G, pid) => G.turn > 30 ? { cul: pg(G, 30) } : null,
    options: [
      { label: c => `Sign it: +${c.cul} culture, +6 Lineage`, apply: (G, pid, c) => { G.players[pid].culturePool += c.cul; gainAff(G, pid, 'lineage', 6); }, ai: (G, pid) => aiAffinity(G, pid) === 'lineage' ? 60 : 15 },
      { label: () => 'Refuse it: +6 Communion', apply: (G, pid) => { gainAff(G, pid, 'communion', 6); }, ai: (G, pid) => aiAffinity(G, pid) === 'communion' ? 55 : 5 }] },
  // ---- event chains: a choice now, a consequence some turns later ----
  { key: 'strange_lights', title: 'Strange Lights', text: c => `Lights fell from orbit into the ridges beyond ${c.name}. The colonists talk of nothing else.`,
    setup: (G, pid) => { const c = randomCity(G, pid); return c && !G.players[pid].evChain && G.players[pid].gold >= pg(G, 30) ? { city: c.id, name: c.name, gold: pg(G, 30) } : null; },
    options: [
      { label: c => `Send a team: −${c.gold} credits (they will report back)`, apply: (G, pid, c) => { G.players[pid].gold -= c.gold; chainEvent(G, pid, 'sky_stone', 6 + G._rng.int(5), { name: c.name }); }, ai: (G, pid, c) => 40 - c.gold },
      { label: () => 'Leave the ridges alone', apply: () => {}, ai: () => 0 }] },
  { key: 'sky_stone', chain: true, title: 'The Fallen Probe', text: c => `Your team returns from the ridges beyond ${c.name} with a Precursor probe, still faintly warm.`,
    setup: (G, pid, prev) => ({ name: prev.name, sci: Math.round(G.players[pid].research ? techCost(G, G.players[pid].research, pid) * 0.7 : pg(G, 80)), aff: 12, relic: relicsLeft(G, pid, false).some(r => r.key === 'starmetal_anvil'), sell: pg(G, 120) }),
    options: [
      { label: c => `Study it: +${c.sci} science toward your research`, apply: (G, pid, c) => sciTo(G, pid, c.sci), ai: (G, pid, c) => c.sci * personaOf(G, pid).s },
      { label: c => `Link it to the grid: +${c.aff} Lattice`, apply: (G, pid, c) => { gainAff(G, pid, 'lattice', c.aff); }, ai: (G, pid) => aiAffinity(G, pid) === 'lattice' ? 90 : 20 },
      { label: c => c.relic ? 'Melt it into a forge core: gain the Starmetal Anvil artifact (+6% production)' : `Sell it to a collector: +${c.sell} credits`, apply: (G, pid, c) => { if (c.relic && grantRelic(G, pid, 'starmetal_anvil', 'from the probe')) return; G.players[pid].gold += c.sell; }, ai: (G, pid, c) => c.relic ? 110 : c.sell }] },
  { key: 'plague_ship', title: 'A Quarantined Barge', text: c => `A barge asks to dock at ${c.name}. Half its crew lie in spore fever.`,
    setup: (G, pid) => { const c = randomCity(G, pid, x => isCoastal(G.map, G._grid, x.tile)); return c && !G.players[pid].evChain ? { city: c.id, name: c.name } : null; },
    options: [
      { label: () => 'Let them land and tend to them (something may come of it)', apply: (G, pid, c) => { chainEvent(G, pid, G._rng.chance(0.65) ? 'grateful_sailors' : 'harbor_fever', 5 + G._rng.int(4), c); }, ai: () => 15 },
      { label: () => 'Turn them away', apply: () => {}, ai: () => 0 }] },
  { key: 'grateful_sailors', chain: true, title: 'Grateful Sailors', text: c => `The sailors you sheltered in ${c.name} have recovered. Their captain wants to repay you.`,
    setup: (G, pid, prev) => ({ city: prev.city, name: prev.name, gold: pg(G, 110), sci: pg(G, 60) }),
    options: [
      { label: c => `Accept their credits: +${c.gold} credits`, apply: (G, pid, c) => { G.players[pid].gold += c.gold; }, ai: (G, pid, c) => c.gold },
      { label: c => `Ask for their sonar charts: +${c.sci} science and a map of far coasts`, apply: (G, pid, c) => { const P = G.players[pid]; sciTo(G, pid, c.sci); const far = G.cities.filter(x => x.owner !== pid && !P.explored[x.tile] && isCoastal(G.map, G._grid, x.tile)); if (far.length) for (const n of G._grid.within(far[G._rng.int(far.length)].tile, 3)) P.explored[n] = 1; }, ai: (G, pid, c) => c.sci * personaOf(G, pid).s + 15 }] },
  { key: 'harbor_fever', chain: true, title: 'Dockside Fever', text: c => `The fever from the barge has spread through the docks of ${c.name}.`,
    setup: (G, pid, prev) => { const x = cityById(G, prev.city); return x && x.owner === pid ? { city: x.id, name: x.name, gold: pg(G, 50) } : null; },
    options: [
      { label: c => `Pay ${c.gold} credits for antifungals`, can: (G, pid, c) => G.players[pid].gold >= c.gold, apply: (G, pid, c) => { G.players[pid].gold -= c.gold; }, ai: (G, pid, c) => -c.gold },
      { label: c => `Seal the docks: ${c.name} loses 1 citizen`, apply: (G, pid, c) => { const x = cityById(G, c.city); if (x && x.pop > 1) { x.pop--; assignWorkers(G, x); } }, ai: () => -55 }] },
  { key: 'hermit', title: 'The Old Pilot', text: () => 'An old ark pilot swears she saw a cargo pod come down in the wilds, and asks only for a meal.',
    setup: (G, pid) => !G.players[pid].evChain && ownCities(G, pid).length ? { gold: pg(G, 15) } : null,
    options: [
      { label: c => `Feed her (−${c.gold} credits) and follow her directions`, apply: (G, pid, c) => { G.players[pid].gold -= c.gold; chainEvent(G, pid, G._rng.chance(0.7) ? 'hermit_gold' : 'hermit_lie', 4 + G._rng.int(4), {}); }, ai: () => 12 },
      { label: () => 'Send her away', apply: () => {}, ai: () => 0 }] },
  { key: 'hermit_gold', chain: true, title: 'The Pilot Was Right', text: () => 'Your team found the cargo pod exactly where the old pilot said, hull intact.',
    setup: (G, pid) => ({ gold: pg(G, 160), cul: pg(G, 70) }),
    options: [
      { label: c => `Sell the cargo: +${c.gold} credits`, apply: (G, pid, c) => { G.players[pid].gold += c.gold; }, ai: (G, pid, c) => c.gold },
      { label: c => `Open the time capsule inside: +${c.cul} culture`, apply: (G, pid, c) => { G.players[pid].culturePool += c.cul; }, ai: (G, pid, c) => c.cul * personaOf(G, pid).c * 1.2 }] },
  { key: 'hermit_lie', chain: true, title: 'An Empty Crater', text: () => 'Your team found nothing but a scorched crater. The pilot has vanished, and so has a crate of tools.',
    setup: (G, pid) => ({ gold: Math.min(Math.floor(G.players[pid].gold), pg(G, 25)) }),
    options: [
      { label: c => c.gold > 0 ? `Write it off: −${c.gold} credits` : 'Write it off', apply: (G, pid, c) => { G.players[pid].gold -= c.gold; }, ai: () => 0 }] },
];
const EVI = {}; EVENTS.forEach((e, i) => EVI[e.key] = i);
// Schedule a follow-up event for a player (one chain at a time).
function chainEvent(G, pid, key, turns, ctx) { const P = G.players[pid]; if (!P.evChain) P.evChain = { key, at: G.turn + Math.max(1, Math.round(turns * Math.max(0.6, paceOf(G)))), ctx }; }
function fireEvent(G, pid, E, ctx) {
  const P = G.players[pid];
  P.evLast = P.evLast || {};
  P.evAt = G.turn; P.evLast[E.key] = G.turn;
  if (P.human) { G.pendingEvents = G.pendingEvents || {}; G.pendingEvents[pid] = { key: E.key, ctx, turn: G.turn }; }
  else { const choices = E.options.filter(o => !o.can || o.can(G, pid, ctx)); const best = choices.sort((a, b) => b.ai(G, pid, ctx) - a.ai(G, pid, ctx))[0]; if (best) best.apply(G, pid, ctx); }
}
// Roll at the start of a player's turn: about one event every 14 turns, never two within 8 turns, no repeats within 50.
function rollEvent(G, pid) {
  const P = G.players[pid];
  if (P.barbarian || P.minor || G.cfg.events === false || G.turn < 12 || !ownCities(G, pid).length) return;
  P.evLast = P.evLast || {};
  if (G.pendingEvents && G.pendingEvents[pid]) return;
  if (P.evChain && G.turn >= P.evChain.at) { // a follow-up is due
    const ch = P.evChain, E = EVENTS[EVI[ch.key]]; P.evChain = null;
    const ctx = E && E.setup(G, pid, ch.ctx || {}); if (ctx) fireEvent(G, pid, E, ctx);
    return;
  }
  if (G.turn - (P.evAt || -99) < 8 || !G._rng.chance(1 / 14)) return;
  const opts = EVENTS.filter(e => !e.chain && G.turn - (P.evLast[e.key] || -99) >= 50);
  for (let tries = 0; tries < 4 && opts.length; tries++) {
    const E = opts.splice(G._rng.int(opts.length), 1)[0], ctx = E.setup(G, pid);
    if (!ctx) continue;
    fireEvent(G, pid, E, ctx);
    return;
  }
}
function pendingEvent(G, pid) {
  const pe = G.pendingEvents && G.pendingEvents[pid]; if (!pe) return null;
  const E = EVENTS[EVI[pe.key]];
  return { key: pe.key, title: E.title, text: E.text(pe.ctx), options: E.options.map((o, i) => ({ i, label: o.label(pe.ctx), ok: !o.can || o.can(G, pid, pe.ctx) })) };
}
function resolveEvent(G, pid, i) {
  const pe = G.pendingEvents && G.pendingEvents[pid]; if (!pe) return false;
  const E = EVENTS[EVI[pe.key]], o = E.options[i]; if (!o || (o.can && !o.can(G, pid, pe.ctx))) return false;
  o.apply(G, pid, pe.ctx); delete G.pendingEvents[pid];
  return true;
}
Object.assign(HX, { EVENTS, pendingEvent, resolveEvent });
