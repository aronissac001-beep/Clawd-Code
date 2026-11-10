// ===== data.js : resources, buildings, dome modules, sponsors, commanders, colonists =====
const MATS = ['metals', 'sinter', 'parts', 'polymers', 'electronics', 'fuel', 'food', 'rare', 'crystals'];
const RES = {
  metals: { name: 'Metals', icon: '⛓', color: '#b9c3cc', desc: 'Iron and nickel, mined from surface scatter or deep ore.' },
  sinter: { name: 'Sinter', icon: '▦', color: '#c9a27a', desc: 'Regolith fused into building blocks by a Sinterer.' },
  parts: { name: 'Parts', icon: '⚙', color: '#e6b85c', desc: 'Machine parts. Most buildings need them for upkeep.' },
  polymers: { name: 'Polymers', icon: '⬡', color: '#7fd0c4', desc: 'Plastics and resins for advanced buildings and domes.' },
  electronics: { name: 'Electronics', icon: '⌁', color: '#8fa8ff', desc: 'Circuitry for drones, sensors and late technology.' },
  fuel: { name: 'Fuel', icon: '◆', color: '#ff9a5a', desc: 'Refined from water. Burns in generators and rockets.' },
  food: { name: 'Food', icon: '❀', color: '#9fdc6a', desc: 'Grown in greenhouses and hydroponics. One per colonist per sol.' },
  rare: { name: 'Rare metals', icon: '✦', color: '#e2d3ff', desc: 'Iridium-group metals. Needed for electronics and sold for funding.' },
  crystals: { name: 'Kessite', icon: '❖', color: '#ff7ad9', desc: 'Exotic piezo crystals found only on Kessa. Very valuable.' },
  power: { name: 'Power', icon: '⚡', color: '#ffd84a' },
  water: { name: 'Water', icon: '💧', color: '#5fb8ff' },
  oxygen: { name: 'Oxygen', icon: '◯', color: '#bff1ff' },
  funds: { name: 'Funding', icon: '¤', color: '#f6e27a' },
  rp: { name: 'Research', icon: '⚛', color: '#b48cff' },
};

const DEPOSITS = {
  metal: { name: 'Metal ore', color: '#aab4bd', res: 'metals' },
  ice: { name: 'Water ice', color: '#a8e2ff', res: 'water' },
  rare: { name: 'Rare ore', color: '#cdb6ff', res: 'rare' },
  crystal: { name: 'Kessite vein', color: '#ff7ad9', res: 'crystals' },
  regolith: { name: 'Fine regolith', color: '#d8b48a', res: 'sinter' },
  scrap: { name: 'Metal scatter', color: '#c0c8d0', res: 'metals', surface: true },
  bloom: { name: 'Pale Bloom spores', color: '#cfe8a0', res: 'food', surface: true },
};

const SPECS = {
  none: { name: 'Generalist', icon: '●', color: '#9aa5b1' },
  engineer: { name: 'Engineer', icon: '⚙', color: '#ffb35c' },
  scientist: { name: 'Scientist', icon: '⚛', color: '#b48cff' },
  botanist: { name: 'Botanist', icon: '❀', color: '#8fdc6a' },
  medic: { name: 'Medic', icon: '✚', color: '#ff8080' },
  security: { name: 'Warden', icon: '⛨', color: '#7fb4ff' },
  geologist: { name: 'Geologist', icon: '◭', color: '#d8b48a' },
};

const TRAITS = {
  resilient: { name: 'Resilient', good: true, desc: 'Loses sanity half as fast.' },
  athletic: { name: 'Athletic', good: true, desc: 'Recovers health faster.' },
  optimist: { name: 'Optimist', good: true, desc: '+10 morale.' },
  genius: { name: 'Genius', good: true, desc: '+50% research when working in labs.' },
  tireless: { name: 'Tireless', good: true, desc: 'Night shifts cost no sanity.' },
  sociable: { name: 'Sociable', good: true, desc: 'Raises sanity of dome mates a little.' },
  frugal: { name: 'Frugal', good: true, desc: 'Eats 25% less.' },
  handy: { name: 'Handy', good: true, desc: '+20% output in factories and extractors.' },
  glutton: { name: 'Glutton', good: false, desc: 'Eats twice as much.' },
  gloomy: { name: 'Gloomy', good: false, desc: '-10 morale.' },
  fragile: { name: 'Fragile', good: false, desc: 'Loses health faster.' },
  idler: { name: 'Idler', good: false, desc: '-25% output at work.' },
  skittish: { name: 'Skittish', good: false, desc: 'Disasters cost double sanity.' },
  homesick: { name: 'Homesick', good: false, desc: 'Leaves much sooner when unhappy.' },
  grumbler: { name: 'Grumbler', good: false, desc: 'Lowers comfort of dome mates.' },
  reckless: { name: 'Reckless', good: false, desc: 'Prone to workplace accidents.' },
};

const SERVICES = {
  dining: { name: 'Dining', icon: '🍲' }, fitness: { name: 'Fitness', icon: '🏋' }, social: { name: 'Social', icon: '🍸' },
  relax: { name: 'Relaxation', icon: '🌿' }, shopping: { name: 'Shopping', icon: '🛍' }, play: { name: 'Play', icon: '🎲' },
  medical: { name: 'Medical', icon: '✚' }, education: { name: 'Education', icon: '✎' }, safety: { name: 'Safety', icon: '⛨' },
};
const WANTS = ['dining', 'fitness', 'social', 'relax', 'shopping', 'play'];

const CATS = {
  infra: { name: 'Base', icon: '⌂' }, power: { name: 'Power', icon: '⚡' }, life: { name: 'Life support', icon: '💧' },
  industry: { name: 'Industry', icon: '⚒' }, science: { name: 'Science', icon: '⚛' }, domes: { name: 'Domes', icon: '◓' },
  lines: { name: 'Grids', icon: '┼' }, mods: { name: 'Dome modules', icon: '▣' },
};

// use: per-hour draw; make: per-hour network output; prod: per-hour material conversion at full staff
// work: drone-hours to build; maint: resource for upkeep; wear: upkeep speed multiplier
const BUILDINGS = {
  lander: { name: 'Colony Lander', cat: 'infra', size: 3, cost: {}, work: 0, unbuildable: true, art: 'lander',
    hub: { radius: 8, drones: 4, cap: 8 }, storage: 80, battery: 20, make: { power: 3 }, maint: 'metals', wear: 0.3,
    desc: 'Your first foothold on Kessa. Stores supplies, charges drones, lands rockets and gives a little power.' },
  hub: { name: 'Drone Hub', cat: 'infra', size: 2, cost: { metals: 8, parts: 2 }, work: 10, art: 'hub', use: { power: 1 },
    hub: { radius: 9, drones: 4, cap: 12 }, maint: 'parts', wear: 0.8, desc: 'Home of up to 12 drones that build, mine surface deposits, repair grids and maintain everything within 9 tiles.' },
  depot: { name: 'Cargo Depot', cat: 'infra', size: 2, cost: { sinter: 5, metals: 2 }, work: 6, art: 'depot', storage: 120, maint: 'sinter', wear: 0.3,
    desc: 'Raises storage of every material by 120.' },
  mast: { name: 'Survey Mast', cat: 'infra', size: 1, cost: { metals: 4, parts: 1 }, work: 6, art: 'mast', use: { power: 2 }, mast: 14, maint: 'parts', wear: 0.6,
    desc: 'Surveys sectors within 14 tiles on its own and speeds up all surveys by 30%.' },
  assembler: { name: 'Drone Assembler', cat: 'infra', size: 2, cost: { metals: 10, parts: 4, electronics: 2 }, work: 16, art: 'assembler', use: { power: 6 }, tech: 'dronefab',
    jobs: 2, spec: 'engineer', assemble: true, maint: 'parts', wear: 1, desc: 'Builds a drone from 2 parts and 1 electronics roughly every sol, sent to the hub that needs one most.' },
  heater: { name: 'Thermal Beacon', cat: 'infra', size: 1, cost: { metals: 4, parts: 2 }, work: 8, art: 'heater', use: { power: 5 }, heat: 8, tech: 'thermal', maint: 'parts', wear: 0.8,
    desc: 'Keeps buildings within 8 tiles working through cold waves.' },
  brush: { name: 'Static Brush Tower', cat: 'infra', size: 1, cost: { metals: 6, electronics: 1 }, work: 8, art: 'brush', use: { power: 4 }, brush: 8, tech: 'staticbrush', maint: 'parts', wear: 0.6,
    desc: 'Sheds charged dust off buildings within 8 tiles: their upkeep slows by 60%.' },
  lance: { name: 'Meteor Lance', cat: 'infra', size: 1, cost: { metals: 8, electronics: 3 }, work: 12, art: 'lance', use: { power: 6 }, lance: 15, tech: 'lance', maint: 'electronics', wear: 0.5,
    desc: 'A pulsed laser that shatters most meteors heading within 15 tiles.' },
  spire: { name: 'Charter Spire', cat: 'infra', size: 4, cost: { sinter: 120, metals: 80, parts: 40, polymers: 40, electronics: 30 }, work: 260, art: 'spire', use: { power: 20 }, tech: 'charter', maint: 'parts', wear: 0.3, unique: true,
    desc: 'The seat of an independent Kessan government. Required for Independence.' },

  solar: { name: 'Solar Array', cat: 'power', size: 2, cost: { metals: 3 }, work: 6, art: 'solar', gen: { kind: 'solar', amt: 9 }, maint: 'metals', wear: 1,
    desc: 'Up to 9 power in full daylight. Nothing at night, much less in dust storms.' },
  wind: { name: 'Wind Mast', cat: 'power', size: 1, cost: { metals: 4, parts: 1 }, work: 6, art: 'wind', gen: { kind: 'wind', amt: 2.5 }, maint: 'parts', wear: 0.8,
    desc: 'Steady power day and night, up to 2x on high ground and stronger in storms.' },
  fuelgen: { name: 'Fuel Generator', cat: 'power', size: 2, cost: { metals: 6, parts: 2 }, work: 10, art: 'fuelgen', gen: { kind: 'fuel', amt: 16 }, burn: 0.12, maint: 'parts', wear: 1,
    desc: '16 power, burning 0.12 fuel per hour.' },
  battery: { name: 'Battery Bank', cat: 'power', size: 1, cost: { metals: 3, parts: 1 }, work: 5, art: 'battery', battery: 60, maint: 'metals', wear: 0.4,
    desc: 'Stores 60 power for the night.' },
  thinfilm: { name: 'Thin-Film Field', cat: 'power', size: 3, cost: { metals: 6, polymers: 4 }, work: 10, art: 'thinfilm', gen: { kind: 'solar', amt: 26 }, tech: 'thinfilm', maint: 'polymers', wear: 0.8,
    desc: 'A large flexible solar field: 26 power in daylight.' },
  reactor: { name: 'Isotope Reactor', cat: 'power', size: 3, cost: { sinter: 20, metals: 15, parts: 8, electronics: 5 }, work: 40, art: 'reactor', gen: { kind: 'reactor', amt: 70 }, jobs: 3, spec: 'engineer', tech: 'isotope', maint: 'parts', wear: 0.9,
    desc: '70 power around the clock. Needs a crew of engineers.' },
  cell: { name: 'Crystal Cell', cat: 'power', size: 2, cost: { metals: 6, crystals: 3, electronics: 2 }, work: 14, art: 'cell', battery: 400, gen: { kind: 'crystal', amt: 10 }, tech: 'piezo', maint: 'electronics', wear: 0.4,
    desc: 'Kessite lattice storage: holds 400 power and resonates 10 more.' },

  icedrill: { name: 'Ice Drill', cat: 'life', size: 2, cost: { metals: 5, parts: 2 }, work: 10, art: 'icedrill', use: { power: 4 }, make: { water: 2.4 }, deposit: 'ice', maint: 'parts', wear: 1,
    desc: 'Mines a water ice deposit: 2.4 water per hour into the pipe network.' },
  condenser: { name: 'Frost Condenser', cat: 'life', size: 2, cost: { sinter: 4, metals: 3 }, work: 8, art: 'condenser', use: { power: 3 }, make: { water: 0.7 }, maint: 'metals', wear: 1,
    desc: 'Freezes trace vapour out of the air anywhere: 0.7 water per hour. Clogs in dust storms.' },
  airsynth: { name: 'Air Synthesizer', cat: 'life', size: 2, cost: { metals: 4, parts: 2 }, work: 10, art: 'airsynth', use: { power: 5 }, make: { oxygen: 2 }, maint: 'parts', wear: 1,
    desc: 'Cracks carbon dioxide into breathable oxygen: 2 per hour.' },
  watertank: { name: 'Water Tank', cat: 'life', size: 2, cost: { sinter: 3, metals: 2 }, work: 5, art: 'watertank', tank: { water: 80 }, maint: 'sinter', wear: 0.3,
    desc: 'Stores 80 water on its pipe network.' },
  airtank: { name: 'Air Tank', cat: 'life', size: 1, cost: { metals: 3 }, work: 4, art: 'airtank', tank: { oxygen: 60 }, maint: 'metals', wear: 0.3,
    desc: 'Stores 60 oxygen on its pipe network.' },
  reclaimer: { name: 'Water Reclaimer', cat: 'life', size: 2, cost: { sinter: 6, metals: 4, polymers: 3 }, work: 14, art: 'reclaimer', use: { power: 5 }, reclaim: 0.6, tech: 'reclaim', maint: 'polymers', wear: 0.8,
    desc: 'Recycles 60% of the water the domes on its network use.' },
  algae: { name: 'Algae Reactor', cat: 'life', size: 2, cost: { sinter: 6, polymers: 3 }, work: 12, art: 'algae', use: { power: 3, water: 0.3 }, make: { oxygen: 2.5 }, prod: { out: { food: 0.15 } }, tech: 'algae', maint: 'polymers', wear: 0.8,
    desc: 'Algae tanks make 2.5 oxygen and a little food from water and light.' },

  sinterer: { name: 'Regolith Sinterer', cat: 'industry', size: 2, cost: { metals: 4 }, work: 8, art: 'sinterer', use: { power: 4 }, prod: { out: { sinter: 0.5 } }, deposit: 'regolith', jobs: 2, auto: true, maint: 'metals', wear: 1,
    desc: 'Fuses fine regolith into sinter blocks: 0.5 per hour with no crew, 1.5x with a full crew.' },
  oremine: { name: 'Ore Extractor', cat: 'industry', size: 2, cost: { sinter: 6, metals: 3 }, work: 12, art: 'oremine', use: { power: 5 }, prod: { out: { metals: 1 } }, deposit: 'metal', jobs: 3, spec: 'geologist', maint: 'parts', wear: 1,
    desc: 'Digs metal ore: 1 metal per hour with a full shift.' },
  raremine: { name: 'Rare Ore Extractor', cat: 'industry', size: 2, cost: { sinter: 8, metals: 4, parts: 2 }, work: 14, art: 'raremine', use: { power: 6 }, prod: { out: { rare: 0.3 } }, deposit: 'rare', jobs: 3, spec: 'geologist', maint: 'parts', wear: 1,
    desc: 'Mines rare metals: 0.3 per hour with a full shift.' },
  automine: { name: 'Auto-Extractor', cat: 'industry', size: 2, cost: { sinter: 8, metals: 6, electronics: 2 }, work: 16, art: 'automine', use: { power: 7 }, prod: { out: { metals: 0.45 } }, deposit: 'metal|rare', auto: true, tech: 'automine', maint: 'parts', wear: 1.1,
    desc: 'A crewless extractor for metal or rare ore (rare at a third the rate).' },
  harvester: { name: 'Kessite Harvester', cat: 'industry', size: 2, cost: { sinter: 10, metals: 6, electronics: 3 }, work: 20, art: 'harvester', use: { power: 8 }, prod: { out: { crystals: 0.12 } }, deposit: 'crystal', jobs: 2, spec: 'geologist', tech: 'kessite', maint: 'electronics', wear: 1,
    desc: 'Cuts Kessite crystals from a vein: 0.12 per hour with a full shift.' },
  works: { name: 'Machine Works', cat: 'industry', size: 3, cost: { sinter: 10, metals: 6 }, work: 18, art: 'works', use: { power: 8 }, prod: { in: { metals: 0.7 }, out: { parts: 0.4 } }, jobs: 4, spec: 'engineer', maint: 'metals', wear: 1,
    desc: 'Turns 0.7 metals into 0.4 parts per hour with a full shift.' },
  refinery: { name: 'Fuel Refinery', cat: 'industry', size: 2, cost: { sinter: 6, metals: 4 }, work: 12, art: 'refinery', use: { power: 6, water: 0.6 }, prod: { out: { fuel: 0.45 } }, jobs: 3, spec: 'engineer', maint: 'parts', wear: 1,
    desc: 'Splits 0.6 water per hour into 0.45 fuel.' },
  polymer: { name: 'Polymer Plant', cat: 'industry', size: 3, cost: { sinter: 10, metals: 8, parts: 3 }, work: 20, art: 'polymer', use: { power: 9, water: 0.3 }, prod: { in: { fuel: 0.2 }, out: { polymers: 0.35 } }, jobs: 4, spec: 'engineer', tech: 'polychem', maint: 'parts', wear: 1,
    desc: 'Makes 0.35 polymers per hour from fuel and water.' },
  foundry: { name: 'Circuit Foundry', cat: 'industry', size: 3, cost: { sinter: 10, metals: 8, polymers: 4 }, work: 22, art: 'foundry', use: { power: 10 }, prod: { in: { rare: 0.15, polymers: 0.05 }, out: { electronics: 0.2 } }, jobs: 4, spec: 'engineer', tech: 'circuits', maint: 'parts', wear: 1,
    desc: 'Makes 0.2 electronics per hour from rare metals and polymers.' },
  greenhouse: { name: 'Greenhouse', cat: 'industry', size: 3, cost: { sinter: 6, metals: 4, polymers: 2 }, work: 16, art: 'greenhouse', use: { power: 4, water: 0.5 }, prod: { out: { food: 1.1 } }, jobs: 3, spec: 'botanist', maint: 'polymers', wear: 0.8,
    desc: 'Heated crop rows: 1.1 food per hour with a full shift.' },
  bloomfarm: { name: 'Bloom Garden', cat: 'industry', size: 2, cost: { sinter: 4, metals: 2 }, work: 10, art: 'bloomfarm', use: { power: 2, water: 0.2 }, prod: { out: { food: 0.4 } }, deposit: 'bloom', jobs: 2, spec: 'botanist', tech: 'bloom', maint: 'metals', wear: 0.6,
    desc: 'Cultivates native Pale Bloom on a spore bed: 0.4 food per hour.' },

  lab: { name: 'Research Station', cat: 'science', size: 2, cost: { sinter: 6, metals: 4, parts: 2 }, work: 14, art: 'lab', use: { power: 6 }, research: 2.2, jobs: 3, spec: 'scientist', maint: 'parts', wear: 0.8,
    desc: '2.2 research per hour with a full shift of scientists.' },
  observatory: { name: 'Storm Observatory', cat: 'science', size: 2, cost: { sinter: 8, metals: 6, electronics: 2 }, work: 16, art: 'observatory', use: { power: 5 }, research: 0.8, observe: true, tech: 'meteorology', maint: 'parts', wear: 0.6,
    desc: 'Doubles warning time for disasters and gives 0.8 research per hour.' },
  institute: { name: 'Deep Institute', cat: 'science', size: 3, cost: { sinter: 20, metals: 10, polymers: 8, electronics: 6 }, work: 36, art: 'institute', use: { power: 14 }, research: 6, jobs: 4, spec: 'scientist', tech: 'institute', maint: 'electronics', wear: 0.8,
    desc: '6 research per hour with a full shift of scientists.' },

  dome_s: { name: 'Bubble Dome', cat: 'domes', size: 4, cost: { sinter: 14, metals: 10, parts: 2 }, work: 30, art: 'dome', dome: { slots: 6, reach: 12 }, use: { power: 4, oxygen: 0.2, water: 0.2 }, maint: 'sinter', wear: 0.5,
    desc: 'A pressurised dome with 6 module slots. Colonists can work outside it within 12 tiles.' },
  dome_m: { name: 'Vault Dome', cat: 'domes', size: 6, cost: { sinter: 30, metals: 18, parts: 6, polymers: 6 }, work: 60, art: 'dome', dome: { slots: 12, reach: 14 }, use: { power: 8, oxygen: 0.4, water: 0.4 }, tech: 'vaultdome', maint: 'sinter', wear: 0.5,
    desc: 'A larger dome with 12 module slots.' },
  dome_l: { name: 'Canopy Dome', cat: 'domes', size: 8, cost: { sinter: 60, metals: 30, parts: 12, polymers: 14, electronics: 4 }, work: 110, art: 'dome', dome: { slots: 22, reach: 16 }, use: { power: 14, oxygen: 0.7, water: 0.7 }, tech: 'canopy', maint: 'sinter', wear: 0.5,
    desc: 'A vast dome with 22 module slots.' },

  cable: { name: 'Power Cable', cat: 'lines', line: 'cable', cost: { metals: 0.25 }, work: 0.5, art: 'cable', desc: 'Carries power. Tap a start and an end tile. Buildings that touch also share power.' },
  pipe: { name: 'Life Pipe', cat: 'lines', line: 'pipe', cost: { metals: 0.25 }, work: 0.5, art: 'pipe', desc: 'Carries water and oxygen. Buildings that touch also share their pipes.' },
};

// dome modules: built inside a dome slot
const MODULES = {
  quarters: { name: 'Living Quarters', slots: 1, cost: { sinter: 3, metals: 2 }, work: 8, housing: 8, comfort: 45, use: { power: 1 }, desc: 'Homes for 8 colonists. Comfort 45.' },
  apartments: { name: 'Stacked Apartments', slots: 2, cost: { sinter: 6, metals: 4, polymers: 2 }, work: 16, housing: 20, comfort: 35, use: { power: 2 }, tech: 'stacking', desc: 'Dense homes for 20. Comfort 35.' },
  suites: { name: 'Garden Suites', slots: 2, cost: { sinter: 6, metals: 4, polymers: 4 }, work: 16, housing: 8, comfort: 85, use: { power: 2, water: 0.1 }, tech: 'suites', desc: 'Roomy homes for 8. Comfort 85.' },
  nursery: { name: 'Nursery', slots: 1, cost: { sinter: 3, metals: 2, polymers: 1 }, work: 8, housing: 4, comfort: 50, birth: 1, use: { power: 1 }, tech: 'family', desc: 'Doubles births in the dome and homes 4 children.' },
  canteen: { name: 'Canteen', slots: 1, cost: { sinter: 3, metals: 2 }, work: 8, service: { cat: 'dining', cap: 24 }, jobs: 1, use: { power: 1 }, desc: 'Dining for 24.' },
  lounge: { name: 'Lounge', slots: 1, cost: { sinter: 3, metals: 3 }, work: 8, service: { cat: 'social', cap: 24 }, jobs: 1, use: { power: 1 }, desc: 'Social life for 24.' },
  gym: { name: 'Fitness Hall', slots: 1, cost: { sinter: 4, metals: 2 }, work: 8, service: { cat: 'fitness', cap: 24 }, health: 0.05, use: { power: 1 }, desc: 'Fitness for 24, small health bonus.' },
  arboretum: { name: 'Arboretum', slots: 1, cost: { sinter: 3, metals: 1, polymers: 1 }, work: 8, service: { cat: 'relax', cap: 30 }, sanity: 0.06, use: { water: 0.1 }, desc: 'Relaxation for 30, a little sanity.' },
  market: { name: 'Market Hall', slots: 1, cost: { sinter: 4, metals: 2, polymers: 1 }, work: 8, service: { cat: 'shopping', cap: 30 }, jobs: 1, use: { power: 1 }, tech: 'commerce', desc: 'Shopping for 30.' },
  arcade: { name: 'Holo Arcade', slots: 1, cost: { metals: 3, electronics: 1 }, work: 8, service: { cat: 'play', cap: 30 }, use: { power: 2 }, tech: 'holo', desc: 'Play for 30.' },
  clinic: { name: 'Clinic', slots: 1, cost: { sinter: 3, metals: 3, polymers: 1 }, work: 10, service: { cat: 'medical', cap: 24 }, jobs: 1, spec: 'medic', health: 0.25, use: { power: 2 }, desc: 'Heals residents. Medics work best here.' },
  medcenter: { name: 'Medical Center', slots: 2, cost: { sinter: 6, metals: 4, polymers: 3, electronics: 1 }, work: 18, service: { cat: 'medical', cap: 60 }, jobs: 2, spec: 'medic', health: 0.5, sanity: 0.05, use: { power: 4 }, tech: 'medicine', desc: 'Strong healing for 60 and fewer deaths from age.' },
  school: { name: 'School', slots: 1, cost: { sinter: 3, metals: 2 }, work: 8, service: { cat: 'education', cap: 12 }, jobs: 1, use: { power: 1 }, tech: 'schooling', desc: 'Children here grow up with a good trait and a specialization.' },
  security: { name: 'Warden Post', slots: 1, cost: { sinter: 3, metals: 3 }, work: 8, service: { cat: 'safety', cap: 40 }, jobs: 1, spec: 'security', use: { power: 1 }, desc: 'Prevents breakdowns from turning into sabotage.' },
  spa: { name: 'Thermal Spa', slots: 2, cost: { sinter: 6, metals: 3, polymers: 2 }, work: 14, service: { cat: 'relax', cap: 40 }, comfortBonus: 8, sanity: 0.1, use: { power: 3, water: 0.2 }, tech: 'spa', desc: 'Relaxation for 40 and +8 comfort for the whole dome.' },
  hydro: { name: 'Hydroponics', slots: 1, cost: { metals: 3, polymers: 1 }, work: 10, prod: { out: { food: 0.55 } }, jobs: 2, spec: 'botanist', use: { power: 2, water: 0.25 }, desc: '0.55 food per hour with a full shift.' },
  vfarm: { name: 'Vertical Farm', slots: 2, cost: { metals: 6, polymers: 3, electronics: 1 }, work: 18, prod: { out: { food: 1.6 } }, jobs: 3, spec: 'botanist', use: { power: 4, water: 0.4 }, tech: 'vertical', desc: '1.6 food per hour with a full shift.' },
  labmod: { name: 'Lab Module', slots: 1, cost: { sinter: 2, metals: 3, parts: 1 }, work: 10, research: 1.1, jobs: 2, spec: 'scientist', use: { power: 3 }, desc: '1.1 research per hour with a full shift.' },
  workshop: { name: 'Fab Workshop', slots: 1, cost: { sinter: 3, metals: 3 }, work: 10, prod: { in: { metals: 0.25 }, out: { parts: 0.15 } }, jobs: 2, spec: 'engineer', use: { power: 2 }, desc: 'Hand-makes 0.15 parts per hour from metals.' },
};

const SPONSORS = {
  orrin: { name: 'Orrin-Vask Consortium', funds: 3200, stipend: 55, rockets: 2, desc: 'A rich shipping conglomerate. Plenty of money and rockets; exports pay 25% more.', mods: { export: 0.25 }, start: {} },
  union: { name: 'Union of Free Habitats', funds: 2300, stipend: 40, rockets: 2, desc: 'Orbital cooperatives. Colonist arks cost 35% less and colonists start happier.', mods: { arkCost: -0.35, morale: 5 }, start: {} },
  meridian: { name: 'Meridian Academy', funds: 2000, stipend: 35, rockets: 1, desc: 'A scholarly foundation. +30% research and two techs known at landing.', mods: { research: 0.3 }, start: { techs: 2 } },
  tessaline: { name: 'Tessaline Combine', funds: 2400, stipend: 45, rockets: 2, desc: 'Deep-core miners. +25% mining output and extra metals at landing.', mods: { mine: 0.25 }, start: { metals: 40 } },
  pilgrim: { name: 'Pilgrim Collective', funds: 1200, stipend: 20, rockets: 1, desc: 'A shoestring idealist mission. Hard: little money, but colonists are devoted (+50% births, rarely homesick).', mods: { birth: 0.5, homesick: -0.6, comfort: 5 }, start: {}, hard: true },
};
const COMMANDERS = {
  engineer: { name: 'Field Engineer', desc: 'Buildings cost 15% less and drones build 20% faster.', mods: { buildCost: -0.15, build: 0.2 } },
  agronomist: { name: 'Agronomist', desc: 'Farms grow 25% more. Starts knowing Soil Microbiomes.', mods: { farm: 0.25 }, techs: ['microbes'] },
  physician: { name: 'Flight Surgeon', desc: 'Colonists heal faster and have 30% more children.', mods: { health: 0.15, birth: 0.3 } },
  geoscientist: { name: 'Geoscientist', desc: 'Extractors dig 15% more and surveys run twice as fast.', mods: { mine: 0.15, scan: 1 } },
  financier: { name: 'Financier', desc: 'Sponsor stipend +25% and rocket cargo 15% cheaper.', mods: { funding: 0.25, rocketCost: -0.15 } },
  roboticist: { name: 'Roboticist', desc: 'Drones work 25% faster, hubs hold 4 more, 2 extra drones.', mods: { drone: 0.25, droneCap: 4 }, start: { drones: 2 } },
};
const DIFFICULTY = {
  easy: { name: 'Settled', desc: 'Gentle disasters, more supplies, slower upkeep.', hazard: 0.6, maint: 0.8, funds: 1.3, start: 1.3, patience: 70, pop: 70 },
  normal: { name: 'Frontier', desc: 'The intended challenge.', hazard: 1, maint: 1, funds: 1, start: 1, patience: 50, pop: 100 },
  hard: { name: 'Brink', desc: 'Fierce disasters, faster upkeep, thin supply lines.', hazard: 1.5, maint: 1.25, funds: 0.8, start: 0.8, patience: 40, pop: 130 },
};

// cargo the sponsor can ship: weight in cargo units, price in funding
const CARGO = {
  metals: { name: '10 Metals', give: { metals: 10 }, w: 4, price: 60 },
  sinter: { name: '10 Sinter', give: { sinter: 10 }, w: 4, price: 45 },
  parts: { name: '5 Parts', give: { parts: 5 }, w: 2, price: 70 },
  polymers: { name: '5 Polymers', give: { polymers: 5 }, w: 2, price: 75 },
  electronics: { name: '4 Electronics', give: { electronics: 4 }, w: 1, price: 110 },
  food: { name: '20 Food', give: { food: 20 }, w: 3, price: 50 },
  fuel: { name: '10 Fuel', give: { fuel: 10 }, w: 3, price: 50 },
  drone: { name: 'Drone', drones: 1, w: 1, price: 55 },
  crawler: { name: 'Drone Crawler', vehicle: 'crawler', w: 8, price: 320 },
  pathfinder: { name: 'Pathfinder Rover', vehicle: 'pathfinder', w: 6, price: 260 },
  probe: { name: 'Orbital Probe', probe: 1, w: 1, price: 80 },
  pf_hub: { name: 'Prefab Drone Hub', prefab: 'hub', w: 4, price: 150 },
  pf_airsynth: { name: 'Prefab Air Synthesizer', prefab: 'airsynth', w: 3, price: 120 },
  pf_icedrill: { name: 'Prefab Ice Drill', prefab: 'icedrill', w: 3, price: 120 },
  pf_dome_s: { name: 'Prefab Bubble Dome', prefab: 'dome_s', w: 10, price: 420 },
  pf_works: { name: 'Prefab Machine Works', prefab: 'works', w: 6, price: 220 },
  pf_fuelgen: { name: 'Prefab Fuel Generator', prefab: 'fuelgen', w: 4, price: 140 },
};
const ROCKET = { cap: 30, travel: 36, unload: 4, ark: 10, arkPrice: 520 };

const VEHICLES = {
  crawler: { name: 'Drone Crawler', speed: 2.2, hub: { radius: 5, drones: 3, cap: 6 }, desc: 'A tracked carrier for 6 drones. Park it anywhere to build and mine within 5 tiles.' },
  pathfinder: { name: 'Pathfinder Rover', speed: 3, scan: true, desc: 'A fast scout. Drive it to an anomaly to investigate, or anywhere to survey that sector quickly.' },
};

const NAMES_F = ['Ada', 'Brin', 'Calla', 'Dena', 'Esme', 'Faye', 'Gita', 'Hana', 'Ines', 'Juno', 'Kira', 'Lio', 'Mara', 'Nadia', 'Oona', 'Pia', 'Quinn', 'Rhea', 'Suri', 'Tova', 'Uma', 'Vela', 'Wren', 'Yara', 'Zia', 'Ayla', 'Bea', 'Coral', 'Dalia', 'Elin', 'Femi', 'Greta', 'Ilse', 'Jae', 'Lumi', 'Mei', 'Noor', 'Odile', 'Priya', 'Saga', 'Tamsin', 'Valka'];
const NAMES_M = ['Arlo', 'Bram', 'Cass', 'Dov', 'Emil', 'Finn', 'Gael', 'Hugo', 'Ivo', 'Jalen', 'Kofi', 'Leif', 'Milo', 'Nico', 'Orin', 'Pax', 'Ravi', 'Sami', 'Teo', 'Ugo', 'Vik', 'Wim', 'Yusuf', 'Zane', 'Anton', 'Basil', 'Cyrus', 'Dario', 'Eero', 'Felix', 'Goran', 'Hiro', 'Idris', 'Joss', 'Kai', 'Lars', 'Mateo', 'Nils', 'Otto', 'Remy', 'Soren', 'Tariq'];
const NAMES_L = ['Abara', 'Bekov', 'Castell', 'Dunmore', 'Eskil', 'Farrow', 'Galt', 'Hollis', 'Ibsen', 'Jaro', 'Kade', 'Lindqvist', 'Moreau', 'Nakamura', 'Okafor', 'Petrov', 'Quell', 'Reyes', 'Sato', 'Torvik', 'Uriel', 'Varga', 'Weller', 'Yilmaz', 'Zhou', 'Achebe', 'Brandt', 'Cruz', 'Dahl', 'Ekwueme', 'Fontaine', 'Grieve', 'Haddad', 'Ishii', 'Kovac', 'Laine', 'Mbeki', 'Novak', 'Ostrom', 'Pyle', 'Rask', 'Sorensen', 'Tanaka', 'Vance', 'Whitlow'];

Object.assign(KC, { MATS, RES, DEPOSITS, SPECS, TRAITS, SERVICES, WANTS, CATS, BUILDINGS, MODULES, SPONSORS, COMMANDERS, DIFFICULTY, CARGO, ROCKET, VEHICLES });
