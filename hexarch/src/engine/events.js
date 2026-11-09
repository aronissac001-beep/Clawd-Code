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
];
const EVI = {}; EVENTS.forEach((e, i) => EVI[e.key] = i);
// Roll at the start of a player's turn: about one event every 14 turns, never two within 8 turns, no repeats within 50.
function rollEvent(G, pid) {
  const P = G.players[pid];
  if (P.barbarian || G.cfg.events === false || G.turn < 12 || !ownCities(G, pid).length) return;
  P.evLast = P.evLast || {};
  if (G.pendingEvents && G.pendingEvents[pid]) return;
  if (G.turn - (P.evAt || -99) < 8 || !G._rng.chance(1 / 14)) return;
  const opts = EVENTS.filter(e => G.turn - (P.evLast[e.key] || -99) >= 50);
  for (let tries = 0; tries < 4 && opts.length; tries++) {
    const E = opts.splice(G._rng.int(opts.length), 1)[0], ctx = E.setup(G, pid);
    if (!ctx) continue;
    P.evAt = G.turn; P.evLast[E.key] = G.turn;
    if (P.human) { G.pendingEvents = G.pendingEvents || {}; G.pendingEvents[pid] = { key: E.key, ctx, turn: G.turn }; }
    else { const choices = E.options.filter(o => !o.can || o.can(G, pid, ctx)); const best = choices.sort((a, b) => b.ai(G, pid, ctx) - a.ai(G, pid, ctx))[0]; if (best) best.apply(G, pid, ctx); }
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
