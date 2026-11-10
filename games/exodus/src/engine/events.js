// ===== events.js : random events with a choice. Humans decide in a dialog; AIs pick by value. =====
const pg = (G, n) => Math.round(n * paceOf(G));
const randomCity = (G, pid, f) => { const cs = ownCities(G, pid).filter(f || (() => true)); return cs.length ? cs[G._rng.int(cs.length)] : null; };
const EVENTS = [
  { key: 'scholar', title: 'A Wandering Scholar', text: ctx => 'A scholar from far away offers to teach at your court, for a fee.',
    setup: (G, pid) => { const P = G.players[pid]; return P.research && P.gold >= pg(G, 50) ? { gold: pg(G, 50), sci: Math.round(techCost(G, P.research) * 0.3) } : null; },
    options: [
      { label: c => `Pay ${c.gold} gold: +${c.sci} science toward your research`, apply: (G, pid, c) => { const P = G.players[pid]; P.gold -= c.gold; if (P.research) P.progress[P.research] = (P.progress[P.research] || 0) + c.sci; }, ai: (G, pid, c) => c.sci * 1.2 - c.gold },
      { label: () => 'Send the scholar on their way', apply: () => {}, ai: () => 0 }] },
  { key: 'harvest', title: 'Bountiful Harvest', text: c => `Rain came at just the right time around ${c.name}.`,
    setup: (G, pid) => { const c = randomCity(G, pid); return c ? { city: c.id, name: c.name, food: pg(G, 25), gold: pg(G, 45) } : null; },
    options: [
      { label: c => `Store the grain: +${c.food} food in ${c.name}`, apply: (G, pid, c) => { const x = cityById(G, c.city); if (x) x.food += c.food; }, ai: (G, pid, c) => c.food * 1.4 },
      { label: c => `Sell the surplus: +${c.gold} gold`, apply: (G, pid, c) => { G.players[pid].gold += c.gold; }, ai: (G, pid, c) => c.gold }] },
  { key: 'fire', title: 'Fire!', text: c => `A fire has broken out in the workshops of ${c.name}.`,
    setup: (G, pid) => { const c = randomCity(G, pid, x => x.prod >= 15); return c ? { city: c.id, name: c.name, gold: pg(G, 35), lost: Math.floor(c.prod * 0.6) } : null; },
    options: [
      { label: c => `Pay ${c.gold} gold for fire brigades`, can: (G, pid, c) => G.players[pid].gold >= c.gold, apply: (G, pid, c) => { G.players[pid].gold -= c.gold; }, ai: (G, pid, c) => -c.gold },
      { label: c => `Let it burn: lose ${c.lost} stored production`, apply: (G, pid, c) => { const x = cityById(G, c.city); if (x) x.prod = Math.max(0, x.prod - c.lost); }, ai: (G, pid, c) => -c.lost * 1.3 }] },
  { key: 'pilgrims', title: 'Pilgrims Arrive', text: () => 'Travellers have come to see your holy places.',
    setup: (G, pid) => G.players[pid].pantheon ? { faith: pg(G, 30), gold: pg(G, 40) } : null,
    options: [
      { label: c => `Welcome them: +${c.faith} faith`, apply: (G, pid, c) => { G.players[pid].faith += c.faith; }, ai: (G, pid, c) => c.faith * (personaOf(G, pid).fa || 1) },
      { label: c => `Charge a toll: +${c.gold} gold`, apply: (G, pid, c) => { G.players[pid].gold += c.gold; }, ai: (G, pid, c) => c.gold * 0.8 }] },
  { key: 'festival', title: 'A Grand Festival', text: () => 'The people ask for a festival to mark a good year.',
    setup: (G, pid) => G.players[pid].gold >= pg(G, 60) ? { gold: pg(G, 60), cul: pg(G, 45) } : null,
    options: [
      { label: c => `Fund it: −${c.gold} gold, +${c.cul} culture`, apply: (G, pid, c) => { const P = G.players[pid]; P.gold -= c.gold; P.culturePool += c.cul; }, ai: (G, pid, c) => c.cul * 1.2 - c.gold },
      { label: () => 'Not this year', apply: () => {}, ai: () => 0 }] },
  { key: 'inventor', title: 'An Ingenious Inventor', text: c => `An inventor in ${c.name} wants funding for a new kind of machine.`,
    setup: (G, pid) => { const c = randomCity(G, pid, x => x.build); return c && G.players[pid].gold >= pg(G, 70) ? { city: c.id, name: c.name, gold: pg(G, 70), prod: pg(G, 60) } : null; },
    options: [
      { label: c => `Fund the workshop: −${c.gold} gold, +${c.prod} production in ${c.name}`, apply: (G, pid, c) => { const x = cityById(G, c.city); G.players[pid].gold -= c.gold; if (x) x.prod += c.prod; }, ai: (G, pid, c) => c.prod * 1.3 - c.gold },
      { label: () => 'Decline politely', apply: () => {}, ai: () => 0 }] },
  { key: 'sickness', title: 'Sickness', text: c => `A fever is spreading through ${c.name}.`,
    setup: (G, pid) => { const c = randomCity(G, pid, x => x.pop >= 6 && !x.buildings.includes('aqueduct')); return c ? { city: c.id, name: c.name, gold: pg(G, 45) } : null; },
    options: [
      { label: c => `Pay ${c.gold} gold for healers`, can: (G, pid, c) => G.players[pid].gold >= c.gold, apply: (G, pid, c) => { G.players[pid].gold -= c.gold; }, ai: (G, pid, c) => -c.gold },
      { label: c => `Ride it out: ${c.name} loses 1 citizen`, apply: (G, pid, c) => { const x = cityById(G, c.city); if (x && x.pop > 1) { x.pop--; assignWorkers(G, x); } }, ai: () => -55 }] },
  { key: 'refugees', title: 'Refugees', text: c => `Families fleeing a far-off war have reached ${c.name}.`,
    setup: (G, pid) => { const c = randomCity(G, pid); return c && civHappiness(G, pid).net >= 1 ? { city: c.id, name: c.name, gold: pg(G, 30) } : null; },
    options: [
      { label: c => `Take them in: +1 citizen in ${c.name}`, apply: (G, pid, c) => { const x = cityById(G, c.city); if (x) { x.pop++; assignWorkers(G, x); } }, ai: (G, pid) => civHappiness(G, pid).net >= 2 ? 50 : -10 },
      { label: c => `Give them supplies and send them on: −${c.gold} gold`, can: (G, pid, c) => G.players[pid].gold >= c.gold, apply: (G, pid, c) => { G.players[pid].gold -= c.gold; }, ai: (G, pid, c) => 5 - c.gold }] },
  { key: 'ore', title: 'A Rich Seam', text: c => `Miners near ${c.name} struck a rich seam of ore.`,
    setup: (G, pid) => { const c = randomCity(G, pid, x => x.tiles.some(t => G.map.improv[t] === IMPI.mine)); return c ? { city: c.id, name: c.name, gold: pg(G, 80), prod: pg(G, 40) } : null; },
    options: [
      { label: c => `Sell it: +${c.gold} gold`, apply: (G, pid, c) => { G.players[pid].gold += c.gold; }, ai: (G, pid, c) => c.gold },
      { label: c => `Forge it: +${c.prod} production in ${c.name}`, apply: (G, pid, c) => { const x = cityById(G, c.city); if (x) x.prod += c.prod; }, ai: (G, pid, c) => c.prod * 1.6 }] },
  { key: 'bandits', title: 'Bandits on the Roads', text: () => 'Highwaymen are robbing caravans and travellers.',
    setup: (G, pid) => ownCities(G, pid).length >= 2 && G.players[pid].gold >= pg(G, 40) ? { gold: pg(G, 30), loss: pg(G, 50) } : null,
    options: [
      { label: c => `Hire guards: −${c.gold} gold`, apply: (G, pid, c) => { G.players[pid].gold -= c.gold; }, ai: (G, pid, c) => -c.gold },
      { label: c => `Ignore them: they steal up to ${c.loss} gold`, apply: (G, pid, c) => { const P = G.players[pid]; P.gold = Math.max(0, P.gold - c.loss); }, ai: (G, pid, c) => -c.loss * 0.9 }] },
  { key: 'artist', title: 'A Visiting Artist', text: c => `A famous painter offers to decorate a hall in ${c.name}.`,
    setup: (G, pid) => { const c = randomCity(G, pid); return c ? { city: c.id, name: c.name, cul: pg(G, 35), faith: pg(G, 25) } : null; },
    options: [
      { label: c => `Paint the town hall: +${c.cul} culture`, apply: (G, pid, c) => { G.players[pid].culturePool += c.cul; }, ai: (G, pid, c) => c.cul * personaOf(G, pid).c },
      { label: c => `Paint the temple: +${c.faith} faith`, apply: (G, pid, c) => { G.players[pid].faith += c.faith; }, ai: (G, pid, c) => c.faith * (personaOf(G, pid).fa || 1) }] },
  { key: 'comet', title: 'A Comet in the Sky', text: () => 'A bright comet hangs over your lands. Everyone wants to know what it means.',
    setup: (G, pid) => ({ sci: pg(G, 25), faith: pg(G, 25) }),
    options: [
      { label: c => `Ask the astronomers: +${c.sci} science`, apply: (G, pid, c) => { const P = G.players[pid]; if (P.research) P.progress[P.research] = (P.progress[P.research] || 0) + c.sci; else P.gold += c.sci; }, ai: (G, pid, c) => c.sci * personaOf(G, pid).s },
      { label: c => `Ask the priests: +${c.faith} faith`, apply: (G, pid, c) => { G.players[pid].faith += c.faith; }, ai: (G, pid, c) => c.faith * (personaOf(G, pid).fa || 1) }] },
  { key: 'lost_map', title: 'An Old Map', text: () => 'A trader sells a map of lands nobody in your court has seen.',
    setup: (G, pid) => G.players[pid].gold >= pg(G, 40) ? { gold: pg(G, 40) } : null,
    options: [
      { label: c => `Buy it for ${c.gold} gold: reveal the land around a far city`, apply: (G, pid, c) => { const P = G.players[pid]; P.gold -= c.gold; const far = G.cities.filter(x => x.owner !== pid && !P.explored[x.tile]); const t = far.length ? far[G._rng.int(far.length)].tile : null; if (t !== null) for (const n of G._grid.within(t, 3)) P.explored[n] = 1; }, ai: () => 10 },
      { label: () => 'Probably a forgery', apply: () => {}, ai: () => 0 }] },
  { key: 'drought', title: 'Drought', text: c => `The rains have failed around ${c.name}.`,
    setup: (G, pid) => { const c = randomCity(G, pid, x => x.food >= 10); return c ? { city: c.id, name: c.name, gold: pg(G, 40), food: Math.floor(c.food * 0.5) } : null; },
    options: [
      { label: c => `Ship in grain: −${c.gold} gold`, can: (G, pid, c) => G.players[pid].gold >= c.gold, apply: (G, pid, c) => { G.players[pid].gold -= c.gold; }, ai: (G, pid, c) => -c.gold },
      { label: c => `Tighten belts: ${c.name} loses ${c.food} stored food`, apply: (G, pid, c) => { const x = cityById(G, c.city); if (x) x.food = Math.max(0, x.food - c.food); }, ai: (G, pid, c) => -c.food * 1.2 }] },
  { key: 'veterans', title: 'Veterans Return', text: () => 'Old soldiers offer to train your troops.',
    setup: (G, pid) => { const us = G.units.filter(u => u.owner === pid && UNITS[u.type].military && UNITS[u.type].cls !== 'recon'); return us.length >= 2 ? { n: Math.min(3, us.length), gold: pg(G, 35) } : null; },
    options: [
      { label: c => `Pay ${c.gold} gold: ${c.n} units gain 15 experience`, can: (G, pid, c) => G.players[pid].gold >= c.gold, apply: (G, pid, c) => { G.players[pid].gold -= c.gold; G.units.filter(u => u.owner === pid && UNITS[u.type].military && UNITS[u.type].cls !== 'recon').slice(0, c.n).forEach(u => { u.xp = (u.xp || 0) + 15; }); }, ai: (G, pid, c) => (AGGRESSION[civKey(G.players[pid])] || 1) * 30 - c.gold },
      { label: () => 'Thank them for their service', apply: () => {}, ai: () => 0 }] },
  { key: 'library_gift', title: 'A Scholar\'s Bequest', text: c => `A scholar in ${c.name} left their books to the city.`,
    setup: (G, pid) => { const c = randomCity(G, pid, x => x.buildings.includes('library')); return c ? { city: c.id, name: c.name, sci: pg(G, 30), cul: pg(G, 30) } : null; },
    options: [
      { label: c => `Study them: +${c.sci} science`, apply: (G, pid, c) => { const P = G.players[pid]; if (P.research) P.progress[P.research] = (P.progress[P.research] || 0) + c.sci; else P.gold += c.sci; }, ai: (G, pid, c) => c.sci * personaOf(G, pid).s },
      { label: c => `Display them: +${c.cul} culture`, apply: (G, pid, c) => { G.players[pid].culturePool += c.cul; }, ai: (G, pid, c) => c.cul * personaOf(G, pid).c }] },
  { key: 'wild_horses', title: 'Wild Horses', text: c => `A herd of wild horses roams near ${c.name}.`,
    setup: (G, pid) => { const c = randomCity(G, pid); return c && hasTech(G.players[pid], 'horseback_riding') ? { city: c.id, name: c.name, gold: pg(G, 50) } : null; },
    options: [
      { label: c => `Tame them: a free Rider in ${c.name}`, apply: (G, pid, c) => { const x = cityById(G, c.city); if (!x) return; const k = unitFor(civKey(G.players[pid]), 'rider'), t = spawnTileFor(G, x, k); if (t >= 0) spawnUnit(G, k, pid, t); }, ai: () => 45 },
      { label: c => `Sell them: +${c.gold} gold`, apply: (G, pid, c) => { G.players[pid].gold += c.gold; }, ai: (G, pid, c) => c.gold }] },
  { key: 'guild_dispute', title: 'A Guild Dispute', text: c => `The craft guilds of ${c.name} are refusing to work.`,
    setup: (G, pid) => { const c = randomCity(G, pid, x => x.build && x.pop >= 4); return c ? { city: c.id, name: c.name, gold: pg(G, 40), cul: pg(G, 20) } : null; },
    options: [
      { label: c => `Raise their wages: −${c.gold} gold`, can: (G, pid, c) => G.players[pid].gold >= c.gold, apply: (G, pid, c) => { G.players[pid].gold -= c.gold; }, ai: (G, pid, c) => -c.gold },
      { label: c => `Hold a festival of crafts: −${c.cul} culture, the city loses this turn's production`, apply: (G, pid, c) => { const P = G.players[pid], x = cityById(G, c.city); P.culturePool = Math.max(0, P.culturePool - c.cul); if (x) x.prod = Math.max(0, x.prod - cityReport(G, x).prod); }, ai: (G, pid, c) => -c.cul - 20 }] },
  { key: 'shipwreck', title: 'A Shipwreck', text: () => 'A foreign ship ran aground on your coast, its hold still full.',
    setup: (G, pid) => ownCities(G, pid).some(c => isCoastal(G.map, G._grid, c.tile)) ? { gold: pg(G, 70), att: 1 } : null,
    options: [
      { label: c => `Salvage the cargo: +${c.gold} gold`, apply: (G, pid, c) => { G.players[pid].gold += c.gold; }, ai: (G, pid, c) => c.gold },
      { label: () => 'Rescue the crew and send them home: +1 happiness for good', apply: (G, pid) => { const cap = G.cities.find(x => x.owner === pid && x.capital); if (cap) cap.masterworks = (cap.masterworks || 0) + 0.5; }, ai: () => 40 }] },
  { key: 'eclipse', title: 'An Eclipse', text: () => 'The sun went dark at midday. The people are frightened.',
    setup: (G, pid) => ({ faith: pg(G, 35), gold: pg(G, 25) }),
    options: [
      { label: c => `Lead prayers: +${c.faith} faith`, apply: (G, pid, c) => { G.players[pid].faith += c.faith; }, ai: (G, pid, c) => c.faith * (personaOf(G, pid).fa || 1) },
      { label: c => `Explain it was the moon: +${c.gold} gold from grateful astronomers' patrons`, apply: (G, pid, c) => { G.players[pid].gold += c.gold; }, ai: (G, pid, c) => c.gold * personaOf(G, pid).s }] },
  // ---- event chains: a choice now, a consequence some turns later ----
  { key: 'strange_lights', title: 'Strange Lights', text: c => `Lights fell from the sky into the hills beyond ${c.name}. The people talk of nothing else.`,
    setup: (G, pid) => { const c = randomCity(G, pid); return c && !G.players[pid].evChain && G.players[pid].gold >= pg(G, 30) ? { city: c.id, name: c.name, gold: pg(G, 30) } : null; },
    options: [
      { label: c => `Send an expedition: −${c.gold} gold (they will report back)`, apply: (G, pid, c) => { G.players[pid].gold -= c.gold; chainEvent(G, pid, 'sky_stone', 6 + G._rng.int(5), { name: c.name }); }, ai: (G, pid, c) => 40 - c.gold },
      { label: () => 'Leave the hills alone', apply: () => {}, ai: () => 0 }] },
  { key: 'sky_stone', chain: true, title: 'The Sky Stone', text: c => `Your expedition returns from the hills beyond ${c.name}, dragging a stone that glows faintly in the dark.`,
    setup: (G, pid, prev) => ({ name: prev.name, sci: Math.round(G.players[pid].research ? techCost(G, G.players[pid].research) * 0.7 : pg(G, 80)), faith: pg(G, 90), relic: relicsLeft(G, pid, false).some(r => r.key === 'starmetal_anvil'), sell: pg(G, 120) }),
    options: [
      { label: c => `Study it: +${c.sci} science toward your research`, apply: (G, pid, c) => { const P = G.players[pid]; if (P.research) P.progress[P.research] = (P.progress[P.research] || 0) + c.sci; else P.gold += c.sci; }, ai: (G, pid, c) => c.sci * personaOf(G, pid).s },
      { label: c => `Raise a shrine around it: +${c.faith} faith`, apply: (G, pid, c) => { G.players[pid].faith += c.faith; }, ai: (G, pid, c) => c.faith * (personaOf(G, pid).fa || 1) },
      { label: c => c.relic ? 'Forge it into an anvil: gain the Starmetal Anvil relic (+6% production)' : `Sell it to a collector: +${c.sell} gold`, apply: (G, pid, c) => { if (c.relic && grantRelic(G, pid, 'starmetal_anvil', 'from the sky stone')) return; G.players[pid].gold += c.sell; }, ai: (G, pid, c) => c.relic ? 110 : c.sell }] },
  { key: 'plague_ship', title: 'A Ship of the Sick', text: c => `A battered ship asks to dock at ${c.name}. Half its crew lie in fever.`,
    setup: (G, pid) => { const c = randomCity(G, pid, x => isCoastal(G.map, G._grid, x.tile)); return c && !G.players[pid].evChain ? { city: c.id, name: c.name } : null; },
    options: [
      { label: () => 'Let them land and tend to them (something may come of it)', apply: (G, pid, c) => { chainEvent(G, pid, G._rng.chance(0.65) ? 'grateful_sailors' : 'harbor_fever', 5 + G._rng.int(4), c); }, ai: () => 15 },
      { label: () => 'Turn them away', apply: () => {}, ai: () => 0 }] },
  { key: 'grateful_sailors', chain: true, title: 'Grateful Sailors', text: c => `The sailors you sheltered in ${c.name} have recovered. Their captain wants to repay you.`,
    setup: (G, pid, prev) => ({ city: prev.city, name: prev.name, gold: pg(G, 110), sci: pg(G, 60) }),
    options: [
      { label: c => `Accept their silver: +${c.gold} gold`, apply: (G, pid, c) => { G.players[pid].gold += c.gold; }, ai: (G, pid, c) => c.gold },
      { label: c => `Ask for their charts: +${c.sci} science and a map of far coasts`, apply: (G, pid, c) => { const P = G.players[pid]; if (P.research) P.progress[P.research] = (P.progress[P.research] || 0) + c.sci; const far = G.cities.filter(x => x.owner !== pid && !P.explored[x.tile] && isCoastal(G.map, G._grid, x.tile)); if (far.length) for (const n of G._grid.within(far[G._rng.int(far.length)].tile, 3)) P.explored[n] = 1; }, ai: (G, pid, c) => c.sci * personaOf(G, pid).s + 15 }] },
  { key: 'harbor_fever', chain: true, title: 'Harbor Fever', text: c => `The fever from the ship has spread through the docks of ${c.name}.`,
    setup: (G, pid, prev) => { const x = cityById(G, prev.city); return x && x.owner === pid ? { city: x.id, name: x.name, gold: pg(G, 50) } : null; },
    options: [
      { label: c => `Pay ${c.gold} gold for healers`, can: (G, pid, c) => G.players[pid].gold >= c.gold, apply: (G, pid, c) => { G.players[pid].gold -= c.gold; }, ai: (G, pid, c) => -c.gold },
      { label: c => `Close the docks: ${c.name} loses 1 citizen`, apply: (G, pid, c) => { const x = cityById(G, c.city); if (x && x.pop > 1) { x.pop--; assignWorkers(G, x); } }, ai: () => -55 }] },
  { key: 'hermit', title: 'The Hermit\'s Riddle', text: () => 'A ragged hermit says he knows where old kings buried their gold, and asks only for bread.',
    setup: (G, pid) => !G.players[pid].evChain && ownCities(G, pid).length ? { gold: pg(G, 15) } : null,
    options: [
      { label: c => `Feed him (−${c.gold} gold) and follow his directions`, apply: (G, pid, c) => { G.players[pid].gold -= c.gold; chainEvent(G, pid, G._rng.chance(0.7) ? 'hermit_gold' : 'hermit_lie', 4 + G._rng.int(4), {}); }, ai: () => 12 },
      { label: () => 'Send him away', apply: () => {}, ai: () => 0 }] },
  { key: 'hermit_gold', chain: true, title: 'The Hermit Was Right', text: () => 'Your diggers found the old kings\' hoard exactly where the hermit said.',
    setup: (G, pid) => ({ gold: pg(G, 160), cul: pg(G, 70) }),
    options: [
      { label: c => `Melt it down: +${c.gold} gold`, apply: (G, pid, c) => { G.players[pid].gold += c.gold; }, ai: (G, pid, c) => c.gold },
      { label: c => `Display the crowns: +${c.cul} culture`, apply: (G, pid, c) => { G.players[pid].culturePool += c.cul; }, ai: (G, pid, c) => c.cul * personaOf(G, pid).c * 1.2 }] },
  { key: 'hermit_lie', chain: true, title: 'An Empty Pit', text: () => 'Your diggers found nothing but rocks. The hermit has vanished, and so has a cart of tools.',
    setup: (G, pid) => ({ gold: Math.min(Math.floor(G.players[pid].gold), pg(G, 25)) }),
    options: [
      { label: c => c.gold > 0 ? `Write it off: −${c.gold} gold` : 'Write it off', apply: (G, pid, c) => { G.players[pid].gold -= c.gold; }, ai: () => 0 }] },
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
