// ===== data.js : resources, species, ethos, governments, stars, planets, jobs, districts, buildings, traditions, edicts =====
var RES = ['energy', 'minerals', 'food', 'alloys', 'goods', 'influence', 'unity', 'lumen', 'vita', 'forge'];
var STOCK_RES = ['energy', 'minerals', 'food', 'alloys', 'goods', 'influence', 'unity'];
var RESEARCH = ['lumen', 'vita', 'forge'];
var RES_INFO = {
  energy: { name: 'Energy', color: '#ffd65a', desc: 'Pays upkeep for buildings, districts, ships and starbases. A deficit lowers stability and output.' },
  minerals: { name: 'Minerals', color: '#e8835a', desc: 'Raw material for districts, buildings, stations and civilian ships.' },
  food: { name: 'Food', color: '#7ee07a', desc: 'Every pop eats. A shortage stops growth and can starve pops.' },
  alloys: { name: 'Alloys', color: '#b9a7ff', desc: 'Refined metals for warships, starbases and outposts.' },
  goods: { name: 'Goods', color: '#ffae5c', desc: 'Consumer goods kept by pops and specialists. A shortage hurts stability and research.' },
  influence: { name: 'Influence', color: '#d58cff', desc: 'Claims new systems, signs treaties and enacts edicts.' },
  unity: { name: 'Unity', color: '#ff7fb6', desc: 'Adopts traditions.' },
  lumen: { name: 'Lumen research', color: '#6fc3ff', desc: 'Energy, shields, beams, sensors and computing.' },
  vita: { name: 'Vita research', color: '#73f0b0', desc: 'Life, growth, food, society and ground forces.' },
  forge: { name: 'Forge research', color: '#ffb35c', desc: 'Industry, hulls, armor, kinetics, missiles and starbases.' },
};
var STREAM_NAMES = { lumen: 'Lumen', vita: 'Vita', forge: 'Forge' };

// ---------- species ----------
var TRAITS = {
  industrious: { name: 'Industrious', cost: 2, mods: { 'minerals%': 15, 'alloys%': 10 }, desc: '+15% minerals, +10% alloys' },
  brilliant: { name: 'Brilliant', cost: 2, mods: { 'research%': 10 }, desc: '+10% research' },
  adaptable: { name: 'Adaptable', cost: 2, mods: { 'hab+': 10 }, desc: '+10% habitability' },
  fertile: { name: 'Fertile', cost: 1, mods: { 'growth%': 20 }, desc: '+20% pop growth', opp: 'languid' },
  charismatic: { name: 'Charismatic', cost: 1, mods: { 'amen%': 15 }, desc: '+15% amenities', opp: 'solitary' },
  hardy: { name: 'Hardy', cost: 1, mods: { 'army%': 20, 'hab+': 5 }, desc: '+20% army damage, +5% habitability', opp: 'fragile' },
  thrifty: { name: 'Thrifty', cost: 1, mods: { 'energy%': 10 }, desc: '+10% energy' },
  devoted: { name: 'Devoted', cost: 1, mods: { 'unity%': 15 }, desc: '+15% unity' },
  wayfaring: { name: 'Wayfaring', cost: 1, mods: { 'outpostCost%': -15, 'colonySpeed%': 25 }, desc: '-15% outpost influence cost, colonies settle 25% faster' },
  agrarian: { name: 'Agrarian', cost: 1, mods: { 'food%': 15 }, desc: '+15% food' },
  enduring: { name: 'Enduring', cost: 1, mods: { 'stability+': 5 }, desc: '+5 stability', opp: 'quarrelsome' },
  fragile: { name: 'Fragile', cost: -1, mods: { 'army%': -25, 'hab+': -5 }, desc: '-25% army damage, -5% habitability', opp: 'hardy' },
  languid: { name: 'Languid', cost: -1, mods: { 'growth%': -20 }, desc: '-20% pop growth', opp: 'fertile' },
  solitary: { name: 'Solitary', cost: -1, mods: { 'amen%': -15 }, desc: '-15% amenities', opp: 'charismatic' },
  wasteful: { name: 'Wasteful', cost: -1, mods: { 'popGoods%': 25 }, desc: '+25% goods upkeep' },
  unfocused: { name: 'Unfocused', cost: -1, mods: { 'research%': -10 }, desc: '-10% research' },
  quarrelsome: { name: 'Quarrelsome', cost: -1, mods: { 'stability+': -5 }, desc: '-5 stability', opp: 'enduring' },
  ravenous: { name: 'Ravenous', cost: -1, mods: { 'popFood%': 20 }, desc: '+20% food eaten' },
};
var TRAIT_POINTS = 2, TRAIT_MAX = 5;
var BODY_TYPES = ['Saurian', 'Avian', 'Mollusk', 'Arthropod', 'Fungoid', 'Mammalian', 'Lithic', 'Aquatic'];

// Ethos: each empire holds two, never an opposed pair
var ETHOS = {
  vanguard: { name: 'Vanguard', opp: 'concord', mods: { 'fleetDmg%': 10, 'naval+': 8 }, desc: 'Honor is won in battle. +10% weapon damage, +8 naval capacity.' },
  concord: { name: 'Concord', opp: 'vanguard', mods: { 'opinion+': 15, 'influence+': 1, 'exhaust%': -10 }, desc: 'Peace is the highest craft. +15 opinion, +1 influence, -10% war exhaustion.' },
  ascendant: { name: 'Ascendant', opp: 'devout', mods: { 'research%': 10 }, desc: 'Knowledge lifts the people. +10% research.' },
  devout: { name: 'Devout', opp: 'ascendant', mods: { 'unity%': 20, 'stability+': 4 }, desc: 'The stars are sacred. +20% unity, +4 stability.' },
  frontier: { name: 'Frontier', opp: 'insular', mods: { 'outpostCost%': -20, 'growth%': 5 }, desc: 'Every horizon is a promise. -20% outpost cost, +5% growth.' },
  insular: { name: 'Insular', opp: 'frontier', mods: { 'sbDef%': 30, 'stability+': 5, 'opinion+': -10 }, desc: 'Our home is our fortress. +30% starbase strength, +5 stability, -10 opinion.' },
  mercantile: { name: 'Mercantile', opp: 'zealous', mods: { 'energy%': 10, 'goods%': 10 }, desc: 'Prosperity is shared. +10% energy and goods, trade pacts are worth more.' },
  zealous: { name: 'Zealous', opp: 'mercantile', mods: { 'army%': 20, 'unity%': 10, 'opinion+': -15 }, desc: 'Ours is the only truth. +20% army damage, +10% unity, -15 opinion with others.' },
};
var GOVS = {
  directorate: { name: 'Directorate', mods: { 'influence+': 1, 'edicts+': 1, 'buildSpeed%': 10 }, desc: 'A single will directs the many. +1 influence, +1 edict slot, +10% build speed.' },
  assembly: { name: 'Open Assembly', mods: { 'unity%': 15, 'stability+': 5 }, desc: 'Every voice is counted. +15% unity, +5 stability.' },
  syndicate: { name: 'Trade Syndicate', mods: { 'energy%': 15, 'goods%': 5 }, desc: 'The ledger rules. +15% energy, +5% goods.' },
  synod: { name: 'Star Synod', mods: { 'unity%': 25, 'amen%': 10 }, desc: 'Priests read the will of the void. +25% unity, +10% amenities.' },
  warhost: { name: 'Warhost', mods: { 'cmd+': 6, 'shipCost%': -10, 'army%': 15 }, desc: 'The fleet is the state. +6 fleet command, -10% ship cost, +15% army damage.' },
  lattice: { name: 'Lattice of Minds', mods: { 'research%': 8, 'techCost%': -5 }, desc: 'Scholars govern by proof. +8% research, -5% tech cost.' },
};
// AI archetypes
var PERSONAS = {
  expansionist: { name: 'Expansionist', ethos: ['frontier', 'mercantile'], gov: 'directorate', expand: 1.25, fleet: 0.8, war: 0.7, research: 1.0, treaty: 1.0, desc: 'Claims every star it can reach.' },
  militarist: { name: 'Militarist', ethos: ['vanguard', 'zealous'], gov: 'warhost', expand: 1.1, fleet: 1.3, war: 1.3, research: 1.05, treaty: 0.6, desc: 'Builds fleets and uses them.' },
  scholarly: { name: 'Scholarly', ethos: ['ascendant', 'concord'], gov: 'lattice', expand: 1.05, fleet: 1.0, war: 0.6, research: 1.5, treaty: 1.4, desc: 'Prizes knowledge and agreements.' },
  mercantile: { name: 'Mercantile', ethos: ['mercantile', 'concord'], gov: 'syndicate', expand: 1.1, fleet: 0.9, war: 0.6, research: 1.0, treaty: 1.6, desc: 'Trades with anyone, fights reluctantly.' },
  isolationist: { name: 'Isolationist', ethos: ['insular', 'ascendant'], gov: 'assembly', expand: 0.95, fleet: 1.1, war: 0.4, research: 1.3, treaty: 0.5, desc: 'Fortifies its borders and keeps to itself.' },
  zealot: { name: 'Zealot', ethos: ['zealous', 'devout'], gov: 'synod', expand: 1.15, fleet: 1.25, war: 1.2, research: 1.0, treaty: 0.5, desc: 'Spreads its faith by persuasion or force.' },
};
var EMPIRE_COLORS = ['#4fa3ff', '#ff5d6c', '#59e08f', '#ffc547', '#c27bff', '#ff8f3f', '#3fe0e0', '#ff7fd0', '#a8d65a', '#e8e8f0'];
var EMPIRE_FORMS = ['Dominion', 'Concordat', 'League', 'Hegemony', 'Commonwealth', 'Assembly', 'Covenant', 'Union', 'Directorate', 'Ascendancy', 'Compact', 'Sovereignty'];

// ---------- stars and planets ----------
var STAR_TYPES = {
  yellow: { name: 'Yellow star', color: '#ffe7a0', glow: '#ffcf6a', r: 1.0, w: 26, planets: [3, 7] },
  orange: { name: 'Orange star', color: '#ffc28a', glow: '#ff9a4a', r: 0.9, w: 24, planets: [2, 6] },
  red: { name: 'Red dwarf', color: '#ff8f7a', glow: '#ff5040', r: 0.7, w: 26, planets: [1, 5] },
  white: { name: 'White star', color: '#f2f6ff', glow: '#cfe0ff', r: 1.0, w: 10, planets: [2, 6] },
  blue: { name: 'Blue giant', color: '#a9cbff', glow: '#5f9bff', r: 1.35, w: 7, planets: [1, 5] },
  neutron: { name: 'Pulsar', color: '#d8f3ff', glow: '#7ae0ff', r: 0.55, w: 4, planets: [0, 3], energy: 2 },
  hole: { name: 'Black hole', color: '#120818', glow: '#b27aff', r: 1.1, w: 3, planets: [0, 3], lumen: 2 },
};
// climate: wet / dry / cold. caps: relative weights for generator, mining and farming districts
var PLANET_TYPES = {
  tidal: { name: 'Tidal world', climate: 'wet', hab: true, cols: ['#1f5fa8', '#3e8fd6', '#cfe8ff'], caps: [1, 0.6, 1.4], tex: 'ocean' },
  jungle: { name: 'Jungle world', climate: 'wet', hab: true, cols: ['#1e5a2c', '#3e9b46', '#9dd27a'], caps: [0.8, 0.8, 1.4], tex: 'land' },
  fen: { name: 'Fen world', climate: 'wet', hab: true, cols: ['#3d4f2c', '#6f7d43', '#a5b56d'], caps: [1.2, 0.9, 1.0], tex: 'land' },
  dune: { name: 'Dune world', climate: 'dry', hab: true, cols: ['#9a6a2c', '#d6a35a', '#f2d9a0'], caps: [1.4, 1.1, 0.5], tex: 'bands' },
  mesa: { name: 'Mesa world', climate: 'dry', hab: true, cols: ['#7d3b23', '#b8643d', '#e7a676'], caps: [1.0, 1.4, 0.7], tex: 'land' },
  steppe: { name: 'Steppe world', climate: 'dry', hab: true, cols: ['#6e7a33', '#a8a75a', '#ddd59a'], caps: [0.9, 1.0, 1.2], tex: 'land' },
  taiga: { name: 'Taiga world', climate: 'cold', hab: true, cols: ['#25463e', '#4f7f6a', '#dfeee8'], caps: [0.9, 1.1, 1.0], tex: 'land' },
  glacier: { name: 'Glacier world', climate: 'cold', hab: true, cols: ['#6f95b8', '#b8d8ee', '#f4fbff'], caps: [1.3, 1.1, 0.6], tex: 'ice' },
  highland: { name: 'Highland world', climate: 'cold', hab: true, cols: ['#4a4f63', '#7d8299', '#e4e6f0'], caps: [1.0, 1.4, 0.8], tex: 'land' },
  garden: { name: 'Garden world', climate: 'any', hab: true, cols: ['#1d6e5a', '#41b37a', '#e9f7c8'], caps: [1.1, 1.1, 1.3], tex: 'land', rare: true },
  barren: { name: 'Barren rock', cols: ['#4d4a48', '#7c7672', '#a9a29b'], tex: 'crater' },
  molten: { name: 'Molten world', cols: ['#3a1208', '#c2410f', '#ffb347'], tex: 'lava' },
  frozen: { name: 'Frozen rock', cols: ['#6c7f93', '#b7c7d6', '#eef4fa'], tex: 'crater' },
  toxic: { name: 'Toxic world', cols: ['#4c5a12', '#93a51c', '#e2f066'], tex: 'bands' },
  gas: { name: 'Gas giant', cols: ['#7a4f3a', '#c99a6e', '#efd9b8'], tex: 'gas', big: true },
  icegas: { name: 'Ice giant', cols: ['#2d5c8a', '#5ea0c9', '#c4ecff'], tex: 'gas', big: true },
  asteroid: { name: 'Asteroid belt', cols: ['#5e5650', '#8a8078', '#b0a69c'], tex: 'belt' },
  hollowed: { name: 'Hollowed world', cols: ['#140d1c', '#3a2650', '#8a5cc0'], tex: 'crater' },
  relic: { name: 'Relic world', climate: 'any', hab: true, cols: ['#4a4038', '#8c7a5c', '#e8d4a0'], caps: [1.2, 1.2, 0.6], tex: 'city', rare: true },
};
var CLIMATES = { wet: ['tidal', 'jungle', 'fen'], dry: ['dune', 'mesa', 'steppe'], cold: ['taiga', 'glacier', 'highland'] };
var HAB_TYPES = ['tidal', 'jungle', 'fen', 'dune', 'mesa', 'steppe', 'taiga', 'glacier', 'highland'];

// ---------- jobs, districts, buildings ----------
// out: produced per worker; in: consumed per worker; amen: amenities produced; strata decides fill order
var JOBS = {
  magistrate: { name: 'Magistrate', strata: 0, out: { unity: 2.5, influence: 0.25 }, amen: 2 },
  administrator: { name: 'Administrator', strata: 1, out: { unity: 2.5 }, in: { goods: 0.5 } },
  researcher: { name: 'Researcher', strata: 1, out: { lumen: 2, vita: 2, forge: 2 }, in: { goods: 0.5 } },
  lumenist: { name: 'Astrometrist', strata: 1, out: { lumen: 6 }, in: { goods: 0.5 } },
  biologist: { name: 'Gene Scholar', strata: 1, out: { vita: 6 }, in: { goods: 0.5 } },
  engineer: { name: 'Fabricator', strata: 1, out: { forge: 6 }, in: { goods: 0.5 } },
  smelter: { name: 'Smelter', strata: 1, out: { alloys: 3 }, in: { minerals: 3 } },
  artisan: { name: 'Artisan', strata: 1, out: { goods: 4 }, in: { minerals: 2 } },
  cantor: { name: 'Cantor', strata: 1, out: { unity: 2 }, amen: 4 },
  performer: { name: 'Performer', strata: 1, out: {}, amen: 9 },
  trader: { name: 'Trader', strata: 1, out: { energy: 5 }, amen: 1 },
  technician: { name: 'Technician', strata: 2, out: { energy: 4 } },
  miner: { name: 'Miner', strata: 2, out: { minerals: 4 } },
  farmer: { name: 'Farmer', strata: 2, out: { food: 6 } },
  clerk: { name: 'Clerk', strata: 2, out: { energy: 2 }, amen: 2 },
  warden: { name: 'Warden', strata: 2, out: {}, amen: 1, stab: 1, armies: 0.5 },
};
var POP_UPKEEP = { food: 1, goods: 0.12 };
var DISTRICTS = {
  habitat: { name: 'Habitat', housing: 6, jobs: { clerk: 1 }, amen: 3, cost: { minerals: 220 }, upkeep: { energy: 1 }, days: 200, desc: 'Housing for 6 pops, 1 clerk, +3 amenities' },
  generator: { name: 'Generator', housing: 2, jobs: { technician: 2 }, cost: { minerals: 200 }, upkeep: {}, days: 180, cap: 0, desc: '2 technicians (+4 energy each)' },
  mining: { name: 'Mining', housing: 2, jobs: { miner: 2 }, cost: { minerals: 200 }, upkeep: { energy: 1 }, days: 180, cap: 1, desc: '2 miners (+4 minerals each)' },
  farming: { name: 'Farming', housing: 2, jobs: { farmer: 2 }, cost: { minerals: 200 }, upkeep: { energy: 1 }, days: 180, cap: 2, desc: '2 farmers (+6 food each)' },
  industrial: { name: 'Industrial', housing: 2, jobs: { smelter: 1, artisan: 1 }, cost: { minerals: 300 }, upkeep: { energy: 2 }, days: 240, desc: '1 smelter (alloys), 1 artisan (goods)' },
};
var DISTRICT_KEYS = Object.keys(DISTRICTS);
var BUILDINGS = {
  seat: { name: 'Seat of Governance', capital: true, jobs: { magistrate: 2 }, housing: 5, amen: 10, stab: 5, flat: { energy: 8, minerals: 8, alloys: 3, lumen: 5, vita: 5, forge: 5, unity: 2 }, desc: 'Capital seat. 2 magistrates, +5 housing, +10 amenities, base output', cost: {}, days: 0 },
  hub: { name: 'Colony Hub', colony: true, housing: 4, amen: 5, jobs: { magistrate: 1 }, desc: 'Founding hub of a colony. +4 housing, +5 amenities, 1 magistrate', cost: {}, days: 0 },
  lab: { name: 'Research Lab', jobs: { researcher: 2 }, cost: { minerals: 300 }, upkeep: { energy: 2 }, days: 240, desc: '2 researchers (+2 to every research stream each)' },
  grandlab: { name: 'Grand Laboratory', jobs: { researcher: 4 }, cost: { minerals: 500, alloys: 40 }, upkeep: { energy: 4 }, days: 300, tech: 'lattice_comp', desc: '4 researchers' },
  observatory: { name: 'Deep Observatory', jobs: { lumenist: 1 }, pct: { lumen: 15 }, unique: true, cost: { minerals: 350 }, upkeep: { energy: 2 }, days: 260, tech: 'deep_optics', desc: '1 astrometrist (+6 lumen), +15% lumen here' },
  genelab: { name: 'Gene Archive', jobs: { biologist: 1 }, pct: { vita: 15 }, unique: true, cost: { minerals: 350 }, upkeep: { energy: 2 }, days: 260, tech: 'gene_archive', desc: '1 gene scholar (+6 vita), +15% vita here' },
  proving: { name: 'Proving Grounds', jobs: { engineer: 1 }, pct: { forge: 15 }, unique: true, cost: { minerals: 350 }, upkeep: { energy: 2 }, days: 260, tech: 'proving_grounds', desc: '1 fabricator (+6 forge), +15% forge here' },
  foundry: { name: 'Alloy Foundry', jobs: { smelter: 2 }, cost: { minerals: 350 }, upkeep: { energy: 2 }, days: 240, desc: '2 smelters (+3 alloys each)' },
  workshop: { name: 'Goods Workshop', jobs: { artisan: 2 }, cost: { minerals: 300 }, upkeep: { energy: 2 }, days: 220, desc: '2 artisans (+4 goods each)' },
  hall: { name: 'Hall of Accord', jobs: { administrator: 2 }, cost: { minerals: 300 }, upkeep: { energy: 2 }, days: 240, sprawl: 10, desc: '2 administrators (+3 unity each), +10 administrative capacity' },
  temple: { name: 'Temple of Stars', jobs: { cantor: 2 }, cost: { minerals: 280 }, upkeep: { energy: 2 }, days: 220, stab: 2, desc: '2 cantors (+2 unity, +4 amenities each), +2 stability' },
  theater: { name: 'Holo-Theater', jobs: { performer: 2 }, cost: { minerals: 300 }, upkeep: { energy: 3 }, days: 240, tech: 'holo_arts', desc: '2 performers (+9 amenities each)' },
  exchange: { name: 'Commerce Exchange', jobs: { trader: 2 }, cost: { minerals: 300 }, upkeep: { energy: 1 }, days: 240, tech: 'trade_protocols', desc: '2 traders (+5 energy each)' },
  hydro: { name: 'Hydroponics Bay', jobs: { farmer: 2 }, cost: { minerals: 250 }, upkeep: { energy: 2 }, days: 200, tech: 'hydroponics', desc: '2 farmers without a district' },
  clinic: { name: 'Gene Clinic', amen: 4, pct: { growth: 30 }, unique: true, cost: { minerals: 300 }, upkeep: { energy: 2 }, days: 240, tech: 'gene_clinic', desc: '+30% pop growth here, +4 amenities' },
  nexus: { name: 'Energy Nexus', pct: { energy: 20 }, unique: true, cost: { minerals: 400 }, upkeep: { energy: 1 }, days: 300, tech: 'zero_point', desc: '+20% energy here' },
  refinery: { name: 'Mineral Refinery', pct: { minerals: 20 }, unique: true, cost: { minerals: 400 }, upkeep: { energy: 2 }, days: 300, tech: 'mineral_refining', desc: '+20% minerals here' },
  processing: { name: 'Food Processor', pct: { food: 20 }, unique: true, cost: { minerals: 350 }, upkeep: { energy: 2 }, days: 260, tech: 'food_processing', desc: '+20% food here' },
  crucible: { name: 'Alloy Crucible', jobs: { smelter: 1 }, pct: { alloys: 20 }, unique: true, cost: { minerals: 450, alloys: 30 }, upkeep: { energy: 3 }, days: 320, tech: 'alloy_crucible', desc: '1 smelter, +20% alloys here' },
  garrison: { name: 'Garrison', jobs: { warden: 2 }, stab: 3, armies: 2, cost: { minerals: 250 }, upkeep: { energy: 1 }, days: 200, desc: '2 wardens, +2 defense armies, +3 stability' },
  monument: { name: 'Wake Monument', flat: { unity: 5 }, stab: 5, unique: true, cost: { minerals: 400 }, upkeep: { energy: 2 }, days: 300, tech: 'civic_rites', desc: '+5 unity, +5 stability' },
  arcology: { name: 'Arcology Spire', housing: 12, amen: 3, cost: { minerals: 600, alloys: 50 }, upkeep: { energy: 4 }, days: 360, tech: 'arcology', desc: '+12 housing, +3 amenities' },
  pshield: { name: 'Planetary Shield', fort: 2, armies: 2, unique: true, cost: { minerals: 400, alloys: 40 }, upkeep: { energy: 3 }, days: 300, tech: 'planet_shield', desc: 'Halves bombardment, +2 defense armies' },
  admiralty: { name: 'Admiralty', naval: 8, unique: true, cost: { minerals: 400, alloys: 50 }, upkeep: { energy: 3 }, days: 300, tech: 'fleet_doctrine', desc: '+8 naval capacity, ships built in this system gain veterancy' },
};
var DESIGNATIONS = {
  auto: { name: 'Balanced', desc: 'No focus.' },
  mining: { name: 'Mining World', jobs: ['miner'], desc: '+15% miner output' },
  generator: { name: 'Generator World', jobs: ['technician', 'clerk', 'trader'], desc: '+15% technician, clerk and trader output' },
  agri: { name: 'Agri World', jobs: ['farmer'], desc: '+15% farmer output' },
  forge: { name: 'Forge World', jobs: ['smelter', 'artisan'], desc: '+15% smelter and artisan output' },
  tech: { name: 'Tech World', jobs: ['researcher', 'lumenist', 'biologist', 'engineer'], desc: '+15% researcher output' },
  unity: { name: 'Unity World', jobs: ['administrator', 'cantor', 'magistrate'], desc: '+15% unity jobs, +5 stability', stab: 5 },
};

// ---------- traditions ----------
var TRADITIONS = {
  expanse: { name: 'Expanse', color: '#59e08f', adopt: { 'outpostCost%': -10 }, nodes: [
    { name: 'Pathfinders', mods: { 'surveySpeed%': 30 }, desc: 'Surveys 30% faster' },
    { name: 'Colonial Charter', mods: { 'colonySpeed%': 40 }, desc: 'Colonies settle 40% faster' },
    { name: 'Open Horizons', mods: { 'sprawl+': 15 }, desc: '+15 administrative capacity' },
    { name: 'New Roots', mods: { 'growth%': 15 }, desc: '+15% growth' },
    { name: 'Claimstakers', mods: { 'outpostCost%': -15 }, desc: '-15% outpost cost' },
  ], finish: { 'hab+': 10 }, desc: 'Expansion and settlement' },
  bastion: { name: 'Bastion', color: '#8fb4ff', adopt: { 'sbDef%': 15 }, nodes: [
    { name: 'Deep Garrisons', mods: { 'armyHp%': 25 }, desc: '+25% army health' },
    { name: 'Star Forts', mods: { 'sbDef%': 25 }, desc: '+25% starbase strength' },
    { name: 'Civic Order', mods: { 'stability+': 5 }, desc: '+5 stability' },
    { name: 'Fortress Worlds', mods: { 'fort+': 1 }, desc: 'Planets resist bombardment better' },
    { name: 'Long Watch', mods: { 'sbCap+': 2 }, desc: '+2 starbase capacity' },
  ], finish: { 'buildSpeed%': 15 }, desc: 'Defense and order' },
  dominion: { name: 'Dominion', color: '#ff5d6c', adopt: { 'naval+': 6 }, nodes: [
    { name: 'Drill Masters', mods: { 'fleetDmg%': 10 }, desc: '+10% weapon damage' },
    { name: 'Grand Fleets', mods: { 'cmd+': 8 }, desc: '+8 fleet command' },
    { name: 'Iron Resolve', mods: { 'exhaust%': -25 }, desc: '-25% war exhaustion' },
    { name: 'Shipwrights', mods: { 'shipCost%': -15 }, desc: '-15% ship cost' },
    { name: 'Hull Doctrine', mods: { 'hull%': 15 }, desc: '+15% ship hull' },
  ], finish: { 'naval+': 12, 'army%': 15 }, desc: 'War and conquest' },
  discovery: { name: 'Discovery', color: '#6fc3ff', adopt: { 'research%': 5 }, nodes: [
    { name: 'Field Science', mods: { 'anomaly%': 50 }, desc: 'Anomalies 50% more common' },
    { name: 'Open Archives', mods: { 'research%': 5 }, desc: '+5% research' },
    { name: 'Peer Review', mods: { 'techCost%': -5 }, desc: '-5% tech cost' },
    { name: 'Polymaths', mods: { 'lumen%': 5, 'vita%': 5, 'forge%': 5 }, desc: '+5% each research stream' },
    { name: 'Insight Engines', mods: { 'research%': 5 }, desc: '+5% research' },
  ], finish: { 'techCost%': -10 }, desc: 'Science and exploration' },
  prosperity: { name: 'Prosperity', color: '#ffc547', adopt: { 'energy%': 5 }, nodes: [
    { name: 'Deep Shafts', mods: { 'minerals%': 10 }, desc: '+10% minerals' },
    { name: 'Smart Grids', mods: { 'energy%': 10 }, desc: '+10% energy' },
    { name: 'Craft Guilds', mods: { 'goods%': 15 }, desc: '+15% goods' },
    { name: 'Swift Builders', mods: { 'buildSpeed%': 20, 'buildCost%': -10 }, desc: '+20% build speed, -10% build cost' },
    { name: 'Refined Smelting', mods: { 'alloys%': 10 }, desc: '+10% alloys' },
  ], finish: { 'energy%': 5, 'minerals%': 5, 'food%': 5 }, desc: 'Industry and wealth' },
  harmony: { name: 'Harmony', color: '#ff7fd0', adopt: { 'unity%': 10 }, nodes: [
    { name: 'Shared Songs', mods: { 'amen%': 10 }, desc: '+10% amenities' },
    { name: 'Envoys', mods: { 'opinion+': 15, 'influence+': 1 }, desc: '+15 opinion, +1 influence' },
    { name: 'Common Purpose', mods: { 'stability+': 5 }, desc: '+5 stability' },
    { name: 'Wide Council', mods: { 'edicts+': 1 }, desc: '+1 edict slot' },
    { name: 'One People', mods: { 'tradCost%': -15 }, desc: '-15% tradition cost' },
  ], finish: { 'unity%': 15, 'influence+': 1 }, desc: 'Unity and diplomacy' },
};
var TRADITION_KEYS = Object.keys(TRADITIONS);

// ---------- edicts (influence, timed) ----------
var EDICTS = {
  mining_drive: { name: 'Mining Drive', cost: 60, days: 3600, mods: { 'minerals%': 15 }, desc: '+15% minerals for 10 years' },
  power_surge: { name: 'Power Surge', cost: 60, days: 3600, mods: { 'energy%': 15 }, desc: '+15% energy for 10 years' },
  research_push: { name: 'Research Push', cost: 80, days: 3600, mods: { 'research%': 10 }, desc: '+10% research for 10 years' },
  festival: { name: 'Festival of Lights', cost: 50, days: 3600, mods: { 'stability+': 8, 'amen%': 10 }, desc: '+8 stability, +10% amenities for 10 years' },
  fleet_drills: { name: 'Fleet Drills', cost: 70, days: 3600, mods: { 'fleetDmg%': 10, 'hull%': 5 }, desc: '+10% weapon damage, +5% hull for 10 years' },
  colonial_fervor: { name: 'Colonial Fervor', cost: 60, days: 3600, mods: { 'growth%': 20, 'colonySpeed%': 30 }, desc: '+20% growth, faster colonies for 10 years' },
  forge_quotas: { name: 'Forge Quotas', cost: 70, days: 3600, mods: { 'alloys%': 15 }, desc: '+15% alloys for 10 years' },
  civic_drive: { name: 'Civic Drive', cost: 50, days: 3600, mods: { 'unity%': 20 }, desc: '+20% unity for 10 years' },
  call_to_arms: { name: 'Call to Arms', cost: 60, days: 1800, mods: { 'army%': 25, 'exhaust%': -20 }, desc: '+25% army damage, -20% war exhaustion for 5 years' },
};
