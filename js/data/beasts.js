// The great beasts' generation tables (EMBERCROWN-FORTRESS.md 3.12, step Z3.3). OWNER G.
// Plain data for js/game/threat/beasts/gen.js (pure: a beast is a function of its lair row's seed). The body
// plan and the material are picked by js/game/colony/legends.js beastIdentity (so the pre-history and the beast
// agree); everything else here. Every attack maps to an existing sim effect (beasts/index.js ATTACK_FX):
//   wound   a blow of `kind` to a body part (people/health.js damage)
//   sick    a wound plus an illness (people/health.js infect)
//   fire    sets the voxels next to its target alight (world/fire.js ignite)
//   web     the target cannot move for webS seconds
//   dread   the thought 'dread' on every colonist within dreadR tiles (people/mood.js addThought)
//   dark    a darkness aura: light drops by darkDrop within darkR voxels (read by the light pass; f.st.dark)
// Plain JSON only; no code. Names are original.

export const DATA = {
  // Body plans (ids as beastBodyId). size: footprint in tiles; moves: swims | climbs | flies | burrows;
  // zones: the body zones a blow lands on, each [name, weight, hpPct]; base: the foe stats row the beast
  // walks and strikes with (js/game/threat/stats.js); hp: the plan's hit points before the material.
  body: [
    { id: 'serpent', name: 'serpent', size: 2, hp: 520, moves: ['swims', 'climbs'], base: 'great_spider', zones: [['head', 2, 20], ['eyes', 1, 8], ['coils', 6, 60], ['tail', 2, 12]] },
    { id: 'manylegged', name: 'many-legged thing', size: 2, hp: 480, moves: ['climbs'], base: 'great_spider', zones: [['head', 2, 18], ['body', 5, 50], ['legs', 4, 32]] },
    { id: 'winged', name: 'winged thing', size: 2, hp: 420, moves: ['flies'], base: 'great_spider', zones: [['head', 2, 20], ['body', 4, 45], ['wings', 3, 25], ['legs', 1, 10]] },
    { id: 'toad', name: 'great toad', size: 2, hp: 600, moves: ['swims'], base: 'great_spider', zones: [['head', 3, 25], ['belly', 4, 50], ['legs', 2, 25]] },
    { id: 'blob', name: 'blob', size: 2, hp: 700, moves: ['climbs'], base: 'great_spider', zones: [['core', 1, 30], ['mass', 8, 70]] },
    { id: 'giant', name: 'giant', size: 3, hp: 760, moves: [], base: 'hollow_knight', zones: [['head', 1, 15], ['body', 4, 45], ['arms', 2, 20], ['legs', 2, 20]] },
    { id: 'crab', name: 'crab', size: 2, hp: 560, moves: ['swims'], base: 'hollow_knight', zones: [['eyes', 1, 6], ['shell', 6, 64], ['claws', 2, 18], ['legs', 2, 12]] },
    { id: 'eel', name: 'eel', size: 2, hp: 460, moves: ['swims', 'burrows'], base: 'great_spider', zones: [['head', 2, 22], ['body', 6, 66], ['tail', 1, 12]] },
  ],
  // Materials (ids as beastMatId): hpPct of the plan's hp, armour percent off blows; fx: what the body does
  // (ember: sets fires and lights; glass: shatters under blunt blows (blunt x2); fungus: spore filth where it
  // walks); drop: the item its body leaves (first that exists in the items table), n items.
  material: [
    { id: 'stone', name: 'stone', hpPct: 120, armour: 35, fx: null, drop: ['stone'], n: 12, soft: 'eyes' },
    { id: 'ash', name: 'ash', hpPct: 90, armour: 15, fx: null, drop: ['ash', 'stone'], n: 8, soft: 'head' },
    { id: 'glass', name: 'glass', hpPct: 80, armour: 40, fx: 'shatter', drop: ['beast_glass', 'glass', 'stone'], n: 6, soft: 'legs' },
    { id: 'bone', name: 'bone', hpPct: 100, armour: 25, fx: 'shatter', drop: ['bone'], n: 14, soft: 'legs' },
    { id: 'ember', name: 'ember', hpPct: 95, armour: 20, fx: 'burn', drop: ['ember_salts', 'coal', 'stone'], n: 6, soft: 'head' },
    { id: 'fungus', name: 'mould', hpPct: 85, armour: 5, fx: 'spores', drop: ['glowcap', 'bone'], n: 10, soft: 'core' },
    { id: 'salt', name: 'salt', hpPct: 100, armour: 30, fx: null, drop: ['salt', 'stone'], n: 10, soft: 'eyes' },
    { id: 'tar', name: 'tar', hpPct: 110, armour: 10, fx: null, drop: ['tar', 'coal', 'stone'], n: 8, soft: 'head' },
  ],
  // Attacks (1-2 per beast): fx (the sim effect above), kind (wound kind), dmg (per blow), every (ticks).
  attack: [
    { id: 'bite', name: 'bite', fx: 'wound', kind: 'bite', dmg: 12, every: 24 },
    { id: 'crush', name: 'crush', fx: 'wound', kind: 'blunt', dmg: 16, every: 34 },
    { id: 'sting', name: 'sting', fx: 'sick', kind: 'stab', dmg: 8, every: 28, illness: 'grey_cough' },
    { id: 'breath', name: 'breath of fire', fx: 'fire', kind: 'burn', dmg: 6, every: 120 },
    { id: 'web', name: 'spit web', fx: 'web', kind: 'none', dmg: 0, every: 160 },
    { id: 'cry', name: 'dread cry', fx: 'dread', kind: 'none', dmg: 0, every: 600 },
    { id: 'darkness', name: 'darkness', fx: 'dark', kind: 'none', dmg: 0, every: 0 },
  ],
  // Behaviours: goal (the raid goal it walks to; GOALS in threat/incidents.js) and its rule.
  behaviour: [
    { id: 'burrower', name: 'burrower', goal: 'loot', digs: true },
    { id: 'hoarder', name: 'hoarder', goal: 'loot', steals: true },
    { id: 'ambusher', name: 'ambusher', goal: 'people', waitsDark: true },
    { id: 'wanderer', name: 'wanderer', goal: 'core' },
    { id: 'territorial', name: 'territorial', goal: 'people', leash: true },
  ],
  // The three legends: fixed bodies under the same rules (3.12).
  legend: [
    { id: 'gloomwyrm', row: 'lair_gloomwyrm', name: 'The Gloomwyrm', plan: 'winged', mat: 'ash', size: 3, hp: 900, armour: 30,
      attacks: ['breath', 'darkness'], beh: 'hoarder', base: 'great_spider', moves: ['flies'], drop: ['ash', 'gold', 'stone'], n: 12 },
    { id: 'colossus', row: 'lair_colossus', name: 'The Bone Colossus', plan: 'giant', mat: 'bone', size: 3, hp: 1100, armour: 30,
      attacks: ['crush'], beh: 'wanderer', base: 'hollow_knight', moves: ['walls'], drop: ['bone'], n: 30 },
    { id: 'hollowking', row: 'sleep', name: 'The Hollow King', plan: 'giant', mat: 'ash', size: 2, hp: 1000, armour: 35,
      attacks: ['crush', 'darkness'], beh: 'wanderer', base: 'hollow_knight', moves: ['darkstep'], drop: ['ash', 'gold'], n: 10, knights: [4, 8] },
  ],
  tuning: [
    { id: 'beasts', warnH: [24, 48], fleePct: 30, healPctSeason: 5, returnPct: 60, territorialR: 20, webS: 10, dreadR: 6,
      darkR: 4, darkDrop: 2, darkStepR: 6, wyrmRumour: 4, kingYear: 6, kingHunger: 6, kingR: 12, kingDz: 1, dayPct: 25,
      gapD: 20, keeperTier: 4, lore: 8, seasonD: 10 },
  ],
  text: [
    { id: 'beast_omen', text: 'Something vast stirs below: {beast} is waking. It will come in {hours} hours.', vars: ['beast', 'hours'] },
    { id: 'beast_omen_sky', text: 'A great shadow crosses the peaks: {beast} has seen our wealth. It will come in {hours} hours.', vars: ['beast', 'hours'] },
    { id: 'beast_fled', text: '{beast} has fled, wounded, to its lair. It may come again.', vars: ['beast'] },
    { id: 'beast_slain', text: '{beast} is slain. Its body lies where it fell.', vars: ['beast'] },
    { id: 'beast_scar', text: 'a scar from the fight at {place}', vars: ['place'] },
    { id: 'cause_seal', text: 'The Seal-stone has been broken, and the Sleep beneath it is ending.' },
    { id: 'cause_sleep', text: 'Our tunnels have come near the Sleep.' },
    { id: 'cause_kinghunger', text: 'The Hollow hungers, and something under the Seal answers.' },
  ],
};
