// ===== story.js : story quests. Milestones raise a question; each answer is a permanent bonus and a step toward an affinity =====
// choice: { label, fx (kept forever), aff: {key: xp}, gold, cul, sci (one-time), text }
const STORY = [
  { key: 'first_night', glyph: '🌌', title: 'The First Night', text: 'Your first colony is founded. As Veyra\'s twin moons rise, the colonists gather. What will the first night be remembered for?',
    choices: [
      { label: 'A night of rationing and discipline', fx: { capFood: 1 }, aff: { lineage: 5 }, text: 'Capital +1 food. +5 Lineage.' },
      { label: 'A night spent listening to the forest', fx: { capCul: 1 }, aff: { communion: 5 }, text: 'Capital +1 culture. +5 Communion.' },
      { label: 'A night spent wiring the colony grid', fx: { capProd: 1 }, aff: { lattice: 5 }, text: 'Capital +1 production. +5 Lattice.' }] },
  { key: 'hydro_bay', glyph: '🪴', title: 'Seeds of Two Worlds', text: 'The first Hydroponics Bay is ready. The agronomists argue over what to plant in it.',
    choices: [
      { label: 'The old seeds from home, unchanged', fx: { 'b.granary.c': 1 }, aff: { lineage: 10 }, text: 'Hydroponics Bays +1 culture. +10 Lineage.' },
      { label: 'Cross them with Veyran glowroot', fx: { 'b.granary.s': 1 }, aff: { communion: 10 }, text: 'Hydroponics Bays +1 science. +10 Communion.' },
      { label: 'Automated drip-feed towers', fx: { 'b.granary.p': 1 }, aff: { lattice: 10 }, text: 'Hydroponics Bays +1 production. +10 Lattice.' }] },
  { key: 'field_lab', glyph: '🧪', title: 'Strange Readings', text: 'The Field Lab\'s instruments pick up a pulse in the planet\'s magnetic field. Every night, the same pattern.',
    choices: [
      { label: 'Feed it to the colony computers', fx: { 'b.library.s': 1 }, aff: { lattice: 10 }, text: 'Field Labs +1 science. +10 Lattice.' },
      { label: 'Map it against the fungal blooms', fx: { 'b.library.f': 1 }, aff: { communion: 10 }, text: 'Field Labs +1 food. +10 Communion.' },
      { label: 'Ignore it and finish the soil survey', fx: { 'b.library.p': 1 }, aff: { lineage: 10 }, text: 'Field Labs +1 production. +10 Lineage.' }] },
  { key: 'clinic', glyph: '⚕️', title: 'Spore Fever', text: 'The Med Clinic treats its first cases of spore fever. Some patients say they can hear the forest.',
    choices: [
      { label: 'Cure them, whatever it takes', fx: { 'b.temple.c': 1, scourCul: 2 }, aff: { lineage: 10 }, text: 'Med Clinics +1 culture; scouring the Veil gives +2 culture. +10 Lineage.' },
      { label: 'Let them listen, and take notes', fx: { 'b.temple.s': 1 }, aff: { communion: 10 }, text: 'Med Clinics +1 science. +10 Communion.' },
      { label: 'Fit neural dampeners', fx: { 'b.temple.p': 1 }, aff: { lattice: 10 }, text: 'Med Clinics +1 production. +10 Lattice.' }] },
  { key: 'exchange', glyph: '💱', title: 'The Credit Question', text: 'The Credit Exchange opens. Should Veyra keep the old currency of home?',
    choices: [
      { label: 'Keep the old credit, backed by the ark', fx: { 'b.market.g': 2 }, aff: { lineage: 10 }, text: 'Credit Exchanges +2 credits. +10 Lineage.' },
      { label: 'An algorithmic currency, audited by machines', fx: { 'b.market.s': 1, 'b.market.g': 1 }, aff: { lattice: 10 }, text: 'Credit Exchanges +1 credit, +1 science. +10 Lattice.' },
      { label: 'Barter in seeds and spores', fx: { 'b.market.f': 1, 'b.market.g': 1 }, aff: { communion: 10 }, text: 'Credit Exchanges +1 credit, +1 food. +10 Communion.' }] },
  { key: 'foundry', glyph: '🔧', title: 'Fuel for the Forge', text: 'The Fab Foundry needs a steady fuel. There are three candidates.',
    choices: [
      { label: 'Burn fungal pulp', fx: { 'b.workshop.f': 1 }, aff: { communion: 10 }, text: 'Fab Foundries +1 food. +10 Communion.' },
      { label: 'Lumenite cells', fx: { 'b.workshop.p': 1 }, aff: { lattice: 10 }, text: 'Fab Foundries +1 production. +10 Lattice.' },
      { label: 'Imported ark reactor cores', fx: { 'b.workshop.g': 2 }, aff: { lineage: 10 }, text: 'Fab Foundries +2 credits. +10 Lineage.' }] },
  { key: 'docks', glyph: '⚓', title: 'The Violet Sea', text: 'Your Tidal Docks reach the Brine Deep. Something vast moves in the water beyond them.',
    choices: [
      { label: 'Mark its paths and keep clear', fx: { 'b.harbor.f': 1 }, aff: { communion: 10 }, text: 'Tidal Docks +1 food. +10 Communion.' },
      { label: 'Arm the docks', fx: { 'b.harbor.p': 1, navalCombat: 10 }, aff: { lineage: 10 }, text: 'Tidal Docks +1 production. +10 Lineage.' },
      { label: 'Send down a sensor drone', fx: { 'b.harbor.s': 1 }, aff: { lattice: 10 }, text: 'Tidal Docks +1 science. +10 Lattice.' }] },
  { key: 'perimeter', glyph: '🧱', title: 'What the Wall Is For', text: 'The Perimeter Wall is finished. The colonists want to know what it keeps out.',
    choices: [
      { label: 'Everything that is not us', fx: { cityStrPct: 10 }, aff: { lineage: 10 }, text: 'Colonies +10% defense. +10 Lineage.' },
      { label: 'Nothing: open the gates by day', fx: { 'b.walls.c': 1 }, aff: { communion: 10 }, text: 'Perimeter Walls +1 culture. +10 Communion.' },
      { label: 'Line it with sensor nodes', fx: { 'b.walls.s': 1 }, aff: { lattice: 10 }, text: 'Perimeter Walls +1 science. +10 Lattice.' }] },
  { key: 'institute', glyph: '🎓', title: 'The Curriculum', text: 'The Xeno Institute opens its doors. What should the first class study?',
    choices: [
      { label: 'Veyran biology', fx: { 'b.university.f': 1, 'b.university.s': 1 }, aff: { communion: 15 }, text: 'Xeno Institutes +1 food, +1 science. +15 Communion.' },
      { label: 'Machine cognition', fx: { 'b.university.s': 2 }, aff: { lattice: 15 }, text: 'Xeno Institutes +2 science. +15 Lattice.' },
      { label: 'The history of home', fx: { 'b.university.c': 2 }, aff: { lineage: 15 }, text: 'Xeno Institutes +2 culture. +15 Lineage.' }] },
  { key: 'commons', glyph: '🎭', title: 'The First Festival', text: 'The Commons Dome hosts its first festival. What should it celebrate?',
    choices: [
      { label: 'Landfall Day', fx: { happy: 1, 'b.amphitheater.c': 1 }, aff: { lineage: 10 }, text: '+1 morale. Commons Domes +1 culture. +10 Lineage.' },
      { label: 'The Bloom, when the forests glow', fx: { happy: 1, 'b.amphitheater.f': 1 }, aff: { communion: 10 }, text: '+1 morale. Commons Domes +1 food. +10 Communion.' },
      { label: 'The Uplink, when the grid came online', fx: { happy: 1, 'b.amphitheater.s': 1 }, aff: { lattice: 10 }, text: '+1 morale. Commons Domes +1 science. +10 Lattice.' }] },
  { key: 'museum', glyph: '🏺', title: 'The Exhibit', text: 'The Precursor Museum must choose its centerpiece.',
    choices: [
      { label: 'A Precursor skull, unexplained', fx: { 'b.museum.s': 2 }, aff: { communion: 10, lattice: 5 }, text: 'Precursor Museums +2 science. +10 Communion, +5 Lattice.' },
      { label: 'The ark\'s flag', fx: { 'b.museum.c': 2 }, aff: { lineage: 15 }, text: 'Precursor Museums +2 culture. +15 Lineage.' }] },
  { key: 'the_naming', glyph: '🦎', title: 'The Naming', text: 'Xenobiologists have catalogued a thousand species. Should they get Veyran names, or names from home?',
    choices: [
      { label: 'Names from home, to remember', aff: { lineage: 15 }, cul: 40, text: '+40 culture. +15 Lineage.' },
      { label: 'Names from the sounds they make', aff: { communion: 15 }, cul: 40, text: '+40 culture. +15 Communion.' },
      { label: 'Serial numbers in a shared database', aff: { lattice: 15 }, sci: 40, text: '+40 science. +15 Lattice.' }] },
  { key: 'the_hum', glyph: '🔮', title: 'The Hum', text: 'Deep Resonance confirms it: the Echo Vaults are listening for something. A reply may be possible.',
    choices: [
      { label: 'Answer in mathematics', fx: { sciPct: 5 }, aff: { lattice: 10 }, text: '+5% science. +10 Lattice.' },
      { label: 'Answer in music', fx: { culPct: 5 }, aff: { communion: 10 }, text: '+5% culture. +10 Communion.' },
      { label: 'Answer in our oldest languages', fx: { happy: 2 }, aff: { lineage: 10 }, text: '+2 morale. +10 Lineage.' }] },
  { key: 'doctrine', glyph: '🎖️', title: 'Rules of Engagement', text: 'Combat Doctrine is written. How should colonial soldiers treat the native fauna?',
    choices: [
      { label: 'As wildlife: avoid and contain', fx: { rageDecay: 1 }, aff: { communion: 10 }, text: 'Fauna anger toward you fades twice as fast. +10 Communion.' },
      { label: 'As a threat: hunt them', fx: { vsFaunaPct: 25 }, aff: { lineage: 10 }, text: '+25% combat strength against fauna. +10 Lineage.' },
      { label: 'As data: track every one', fx: { xp: 10 }, aff: { lattice: 10 }, text: 'New units start with 10 experience. +10 Lattice.' }] },
  { key: 'first_study', glyph: '🔍', title: 'The Nest', text: 'Your Explorer watched a fauna nest for a full day. The beasts did not attack.',
    choices: [
      { label: 'Leave offerings at the nest', fx: { rageDecay: 1 }, aff: { communion: 10 }, text: 'Fauna anger toward you fades twice as fast. +10 Communion.' },
      { label: 'Tag them with trackers', fx: { nestSci: 25 }, aff: { lattice: 10 }, text: 'Nest studies give 25% more. +10 Lattice.' },
      { label: 'Map it for later clearing', fx: { vsFaunaPct: 15 }, aff: { lineage: 10 }, text: '+15% strength against fauna. +10 Lineage.' }] },
  { key: 'first_ruin', glyph: '🏛️', title: 'Those Who Came Before', text: 'The ruins are older than anything on Veyra. Someone lived here, and left.',
    choices: [
      { label: 'They became part of the planet', aff: { communion: 15 }, sci: 30, text: '+30 science. +15 Communion.' },
      { label: 'They uploaded themselves', aff: { lattice: 15 }, sci: 30, text: '+30 science. +15 Lattice.' },
      { label: 'They failed. We will not', aff: { lineage: 15 }, cul: 30, text: '+30 culture. +15 Lineage.' }] },
  { key: 'first_vault', glyph: '🔮', title: 'The Vault Speaks', text: 'The Echo Vault opened and played a long, slow chord. Then it showed a star map.',
    choices: [
      { label: 'Record everything', fx: { sciPct: 5 }, text: '+5% science.' },
      { label: 'Broadcast it to every colony', fx: { culPct: 5, happy: 1 }, text: '+5% culture, +1 morale.' }] },
  { key: 'first_sat', glyph: '🛰️', title: 'Eyes in the Sky', text: 'Your first satellite is in orbit. From up there, the Veil looks like a living thing breathing.',
    choices: [
      { label: 'Map the Veil to burn it back', fx: { satLife: 5 }, aff: { lineage: 10 }, text: 'Satellites last 5 turns longer. +10 Lineage.' },
      { label: 'Map the Veil to learn from it', fx: { veilSci: 1 }, aff: { communion: 10 }, text: 'Worked Veil tiles +1 science. +10 Communion.' },
      { label: 'Link the satellites into one network', fx: { sciPct: 3 }, aff: { lattice: 10 }, text: '+3% science. +10 Lattice.' }] },
  { key: 'first_scour', glyph: '🔥', title: 'Clean Earth', text: 'Riggers have burned back the Veil. The ground beneath is grey and bare.',
    choices: [
      { label: 'Plant the old crops at once', fx: { 'i.farm.f': 0, cityFood: 1 }, aff: { lineage: 10 }, text: '+1 food in every colony. +10 Lineage.' },
      { label: 'Let the native moss return', fx: { 'i.camp.g': 1 }, aff: { communion: 10 }, text: 'Harvest Camps +1 credit. +10 Communion.' }] },
  { key: 'first_kill', glyph: '🦗', title: 'Blood on the Steppe', text: 'Your soldiers killed their first native beast. Its body glows for hours.',
    choices: [
      { label: 'Study the carcass', sci: 25, aff: { communion: 5, lattice: 5 }, text: '+25 science. +5 Communion, +5 Lattice.' },
      { label: 'Mount its head over the gate', fx: { vsFaunaPct: 10 }, aff: { lineage: 10 }, text: '+10% strength against fauna. +10 Lineage.' }] },
  // affinity milestones
  { key: 'aff_communion3', glyph: '🌿', title: 'The Green Choir', text: 'Communion has taken root. Some colonists have begun to sing to the forests at dusk.', choices: [
    { label: 'Build singing groves', fx: { cityCul: 1 }, aff: { communion: 10 }, text: '+1 culture in every colony.' },
    { label: 'Grow living walls', fx: { cityStrPct: 10 }, aff: { communion: 10 }, text: 'Colonies +10% defense.' }] },
  { key: 'aff_communion6', glyph: '🌳', title: 'The Root Council', text: 'The fungal forests answer when spoken to. Will you let them advise the colonies?', choices: [
    { label: 'Yes, in matters of food', fx: { foodPct: 5 }, aff: { communion: 15 }, text: '+5% food.' },
    { label: 'Yes, in matters of war', fx: { combatPct: 5 }, aff: { communion: 15 }, text: '+5% combat strength.' }] },
  { key: 'aff_communion9', glyph: '🌸', title: 'Veyra Dreams of Us', text: 'Your people dream the same dream on the same nights. The planet is dreaming them.', choices: [
    { label: 'Dream deeper', fx: { sciPct: 5, culPct: 5 }, aff: { communion: 20 }, text: '+5% science and culture.' },
    { label: 'Wake and build', fx: { prodPct: 8 }, aff: { communion: 20 }, text: '+8% production.' }] },
  { key: 'aff_lattice3', glyph: '💠', title: 'The First Upload', text: 'A dying engineer asks to be uploaded into the colony grid. The Lattice says it can be done.', choices: [
    { label: 'Let her teach from the grid', fx: { sciPct: 3 }, aff: { lattice: 10 }, text: '+3% science.' },
    { label: 'Let her run the factories', fx: { prodPct: 3 }, aff: { lattice: 10 }, text: '+3% production.' }] },
  { key: 'aff_lattice6', glyph: '🤖', title: 'Machine Rights', text: 'The colony\'s machine minds ask for a vote in the council.', choices: [
    { label: 'Grant it', fx: { citySci: 1 }, aff: { lattice: 15 }, text: '+1 science in every colony.' },
    { label: 'Grant them a role in defense', fx: { combatPct: 5 }, aff: { lattice: 15 }, text: '+5% combat strength.' }] },
  { key: 'aff_lattice9', glyph: '⚡', title: 'One Mind', text: 'Thousands of colonists now share thoughts through the Lattice. Should the rest be linked too?', choices: [
    { label: 'Link the scholars', fx: { sciPct: 8 }, aff: { lattice: 20 }, text: '+8% science.' },
    { label: 'Link the builders', fx: { bldPct: 10 }, aff: { lattice: 20 }, text: '+10% production toward buildings.' }] },
  { key: 'aff_lineage3', glyph: '🧬', title: 'The Genome Vault', text: 'Lineage scholars propose sealing a perfect copy of the human genome in every colony.', choices: [
    { label: 'Seal the vaults', fx: { happy: 2 }, aff: { lineage: 10 }, text: '+2 morale.' },
    { label: 'Use them to breed hardier colonists', fx: { cityFood: 1 }, aff: { lineage: 10 }, text: '+1 food in every colony.' }] },
  { key: 'aff_lineage6', glyph: '🏙️', title: 'A Second Home', text: 'Lineage architects unveil plans for cities indistinguishable from the old capitals of home.', choices: [
    { label: 'Build them as they were', fx: { culPct: 5 }, aff: { lineage: 15 }, text: '+5% culture.' },
    { label: 'Build them as fortresses', fx: { cityStrPct: 15 }, aff: { lineage: 15 }, text: 'Colonies +15% defense.' }] },
  { key: 'aff_lineage9', glyph: '🌍', title: 'Green Fields', text: 'Where the Veil has burned away, old-world grass grows. Children have never seen anything like it.', choices: [
    { label: 'Plant it everywhere', fx: { cityFood: 1, happy: 2 }, aff: { lineage: 20 }, text: '+1 food in every colony, +2 morale.' },
    { label: 'Keep it in the parks', fx: { culPct: 8 }, aff: { lineage: 20 }, text: '+8% culture.' }] },
];
const STORYI = {}; STORY.forEach(s => STORYI[s.key] = s);
const STORY_BUILDINGS = { granary: 'hydro_bay', library: 'field_lab', temple: 'clinic', market: 'exchange', workshop: 'foundry', harbor: 'docks', walls: 'perimeter', university: 'institute', amphitheater: 'commons', museum: 'museum' };
const STORY_TECHS = { xenobiology: 'the_naming', deep_resonance: 'the_hum', combat_doctrine: 'doctrine' };

function offerStory(G, pid, key) {
  const P = G.players[pid], S = STORYI[key];
  if (!S || !P || P.barbarian || P.minor || G.cfg.story === false) return;
  P.story = P.story || []; P.storyPending = P.storyPending || [];
  if (P.story.includes(key)) return;
  P.story.push(key);
  if (P.human) { P.storyPending.push(key); return; }
  resolveStoryChoice(G, pid, S, aiStoryPick(G, pid, S));
}
function storyOnBuildings(G, pid) {
  const P = G.players[pid], built = (P.stats && P.stats.built) || {};
  for (const k in STORY_BUILDINGS) if (built[k] && !(P.story || []).includes(STORY_BUILDINGS[k])) offerStory(G, pid, STORY_BUILDINGS[k]);
}
function storyOnTech(G, pid, key) { if (STORY_TECHS[key]) offerStory(G, pid, STORY_TECHS[key]); }
function pendingStory(G, pid) {
  const P = G.players[pid], key = P.storyPending && P.storyPending[0]; if (!key) return null;
  const S = STORYI[key];
  return { key, glyph: S.glyph, title: S.title, text: S.text, choices: S.choices.map((c, i) => ({ i, label: c.label, text: c.text })) };
}
function resolveStory(G, pid, i) {
  const P = G.players[pid], key = P.storyPending && P.storyPending[0]; if (!key) return false;
  const S = STORYI[key], ch = S.choices[i]; if (!ch) return false;
  P.storyPending.shift();
  resolveStoryChoice(G, pid, S, i);
  return true;
}
function resolveStoryChoice(G, pid, S, i) {
  const P = G.players[pid], ch = S.choices[i]; if (!ch) return;
  P.storyChoices = P.storyChoices || {}; P.storyChoices[S.key] = i;
  if (ch.fx) { P.qfx = P.qfx || []; P.qfx.push(ch.fx); P._fx = null; }
  if (ch.gold) P.gold += Math.round(ch.gold * paceOf(G));
  if (ch.cul) P.culturePool += Math.round(ch.cul * paceOf(G));
  if (ch.sci) { const n = Math.round(ch.sci * paceOf(G)); if (P.research) P.progress[P.research] = (P.progress[P.research] || 0) + n; else P.progress._bank = (P.progress._bank || 0) + n; }
  for (const a in ch.aff || {}) gainAff(G, pid, a, ch.aff[a], S.title);
  if (P.human) logEvent(G, pid, `${S.glyph} ${S.title}: ${ch.label}. ${ch.text}`, -1);
  for (const c of ownCities(G, pid)) assignWorkers(G, c);
}
// AI: lean toward its chosen affinity; otherwise the first option.
function aiStoryPick(G, pid, S) {
  const P = G.players[pid], lean = aiAffinity(G, pid);
  let best = 0, bs = -Infinity;
  S.choices.forEach((c, i) => {
    let s = (c.aff && c.aff[lean] ? 10 + c.aff[lean] : 0) - (c.aff ? Object.keys(c.aff).filter(a => a !== lean).length * 3 : 0);
    if (c.fx && (c.fx.happy || c.fx.cityFood) && civHappiness(G, pid).net < 2) s += 6;
    s += G._rng.next();
    if (s > bs) { bs = s; best = i; }
  });
  return best;
}
Object.assign(HX, { STORY, offerStory, pendingStory, resolveStory });
