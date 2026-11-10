// ===== data.js : static definitions for the planet Veyra =====
// Terrain indices keep their internal names (GRASS..OCEAN) so map code stays simple; everything shown to players is alien.
const T = { GRASS: 0, PLAINS: 1, DESERT: 2, TUNDRA: 3, HILLS: 4, FOREST: 5, MARSH: 6, MOUNTAIN: 7, COAST: 8, OCEAN: 9 };
const TERRAIN = [
  { key: 'steppe', name: 'Lumen Steppe', food: 2, prod: 0, gold: 0, move: 1, def: 0, color: '#3f9c8a', land: true, desc: 'Teal grass that glows faintly at night. Good farmland.' },
  { key: 'flats', name: 'Rust Flats', food: 1, prod: 1, gold: 0, move: 1, def: 0, color: '#a0674a', land: true, desc: 'Iron-red plains of wind-polished stone and hardy lichen.' },
  { key: 'dunes', name: 'Glass Dunes', food: 0, prod: 1, gold: 0, move: 1, def: 0, color: '#b9a3c9', land: true, desc: 'Lilac sand shot through with fused glass. Barren unless watered.' },
  { key: 'frost', name: 'Frost Shelf', food: 1, prod: 0, gold: 0, move: 1, def: 0, color: '#8fb3c4', land: true, desc: 'Blue ice over ancient soil, near the poles.' },
  { key: 'ridge', name: 'Crystal Ridges', food: 0, prod: 2, gold: 0, move: 2, def: 25, color: '#6f7aa8', land: true, blocks: true, elevated: true, desc: 'Rolling ridges studded with resonant crystal. Units here see farther and defend better.' },
  { key: 'fungal', name: 'Fungal Forest', food: 1, prod: 1, gold: 0, move: 2, def: 25, color: '#5a3f86', land: true, blocks: true, desc: 'Towering caps and glowing gills. Slow going, good cover.' },
  { key: 'marsh', name: 'Spore Marsh', food: 1, prod: 0, gold: 0, move: 2, def: -15, color: '#5a6f4e', land: true, desc: 'Warm bog that breathes out clouds of spores.' },
  { key: 'spire', name: 'Spire Crags', food: 0, prod: 0, gold: 0, move: Infinity, def: 0, color: '#5d5670', land: true, blocks: true, impassable: true, desc: 'Needle peaks and sheer canyons. Impassable.' },
  { key: 'shallows', name: 'Shallows', food: 1, prod: 0, gold: 1, move: Infinity, def: 0, color: '#2a9fae', water: true, desc: 'Warm turquoise shelf seas.' },
  { key: 'deep', name: 'Brine Deep', food: 1, prod: 0, gold: 0, move: Infinity, def: 0, color: '#23285e', water: true, desc: 'A violet, faintly toxic ocean.' },
];

// kind: bonus | strategic | luxury. reveal: tech key that makes it visible.
const RES = [
  { key: 'glowroot', name: 'Glowroot', kind: 'bonus', food: 1, prod: 0, gold: 0, on: [T.PLAINS, T.GRASS], glyph: '🥕', desc: 'Luminous tubers, edible once boiled.' },
  { key: 'grazer', name: 'Drift Grazers', kind: 'bonus', food: 1, prod: 0, gold: 0, on: [T.GRASS], glyph: '🦕', desc: 'Placid six-legged herd beasts.' },
  { key: 'loper', name: 'Lopers', kind: 'bonus', food: 1, prod: 0, gold: 0, on: [T.FOREST, T.TUNDRA], glyph: '🦎', desc: 'Long-legged forest runners.' },
  { key: 'shimmerfish', name: 'Shimmerfish', kind: 'bonus', food: 2, prod: 0, gold: 0, on: [T.COAST], glyph: '🐠', desc: 'Schools of light-flashing fish.' },
  { key: 'basalt', name: 'Basalt', kind: 'bonus', food: 0, prod: 1, gold: 0, on: [T.HILLS, T.DESERT, T.PLAINS], glyph: '🪨', desc: 'Dense volcanic stone.' },
  { key: 'chitin', name: 'Chitin', kind: 'strategic', food: 0, prod: 1, gold: 0, on: [T.GRASS, T.PLAINS, T.FOREST], glyph: '🐚', reveal: 'xenobiology', desc: 'Shed shells of great beasts, light and hard. Feeds Rovers and Communion units.' },
  { key: 'ferrite', name: 'Ferrite', kind: 'strategic', food: 0, prod: 1, gold: 0, on: [T.HILLS, T.PLAINS, T.DESERT, T.TUNDRA], glyph: '⚙️', reveal: 'geomechanics', desc: 'Magnetic iron ore. Feeds Lineage units and heavy armor.' },
  { key: 'lumenite', name: 'Lumenite', kind: 'strategic', food: 0, prod: 1, gold: 0, on: [T.DESERT, T.PLAINS, T.TUNDRA, T.HILLS], glyph: '🔷', reveal: 'quantum_theory', desc: 'A crystal that stores light as energy. Feeds Lattice units and plasma weapons.' },
  { key: 'silkweb', name: 'Silkweb', kind: 'luxury', food: 0, prod: 0, gold: 2, on: [T.FOREST], glyph: '🕸️', desc: 'Iridescent thread spun between fungal caps.' },
  { key: 'embermoss', name: 'Ember Moss', kind: 'luxury', food: 1, prod: 0, gold: 1, on: [T.MARSH, T.FOREST], glyph: '🍄', desc: 'A warm moss with a peppery, calming scent.' },
  { key: 'prism', name: 'Prism Shards', kind: 'luxury', food: 0, prod: 0, gold: 3, on: [T.HILLS, T.DESERT], glyph: '💎', desc: 'Crystals that split starlight into colors no one has named.' },
  { key: 'nectar', name: 'Nectarbloom', kind: 'luxury', food: 0, prod: 0, gold: 2, on: [T.PLAINS, T.GRASS], glyph: '🌺', desc: 'Sweet blossoms that open only at dusk.' },
  { key: 'icefern', name: 'Icefern', kind: 'luxury', food: 0, prod: 0, gold: 2, on: [T.TUNDRA, T.FOREST], glyph: '🌿', desc: 'Frost-loving fronds prized as medicine.' },
  { key: 'abysspearl', name: 'Abyss Pearls', kind: 'luxury', food: 0, prod: 0, gold: 2, on: [T.COAST], glyph: '🫧', desc: 'Black pearls that hum when held.' },
];
const RESI = {}; RES.forEach((r, i) => RESI[r.key] = i);
const STRATS = ['chitin', 'ferrite', 'lumenite'];

const MAPSIZE = {
  small: { key: 'small', name: 'Small', W: 44, H: 28, maxCivs: 4, rivers: 9 },
  medium: { key: 'medium', name: 'Medium', W: 60, H: 38, maxCivs: 5, rivers: 15 },
  large: { key: 'large', name: 'Large', W: 76, H: 48, maxCivs: 6, rivers: 24 },
  huge: { key: 'huge', name: 'Huge', W: 92, H: 58, maxCivs: 8, rivers: 34 },
};
const MAPSCRIPT = {
  continents: { key: 'continents', name: 'Continents', land: 0.38, freq: 1 / 10, wm: 0.62, wn: 0.55, minComp: 4, channel: 0.09 },
  pangaea: { key: 'pangaea', name: 'Supercontinent', land: 0.40, freq: 1 / 11, wm: 0.66, wn: 0.5, minComp: 4 },
  archipelago: { key: 'archipelago', name: 'Archipelago', land: 0.32, freq: 1 / 7, wm: 0.6, wn: 0.5, minComp: 3, channel: 0.12 },
  islands: { key: 'islands', name: 'Shattered Isles', land: 0.26, freq: 1 / 5, wm: 0.5, wn: 0.65, minComp: 2, channel: 0.1 },
};
const DIFFICULTY = [
  { key: 'settler', name: 'Pioneer', aiYield: 0.8, aiExtra: [], humanExtra: ['militia'], desc: 'Rival colonies produce 20% less. You land with an extra Marine squad.' },
  { key: 'standard', name: 'Colonist', aiYield: 1.0, aiExtra: [], humanExtra: [], desc: 'Every colony plays by the same rules.' },
  { key: 'veteran', name: 'Veteran', aiYield: 1.15, aiExtra: ['militia'], humanExtra: [], desc: 'Rivals produce 15% more and land with an extra Marine squad.' },
  { key: 'deity', name: 'Sovereign', aiYield: 1.35, aiExtra: ['settler', 'militia'], humanExtra: [], desc: 'Rivals produce 35% more and land with a second Colony Pod.' },
];
const TURN_LIMITS = [250, 350, 500];
const VICTORIES = [
  { key: 'domination', name: 'Dominion', desc: 'Capture the first colonies of half of the rival factions (rounded down, at least one) and hold them for 10 turns, or be the last faction standing.' },
  { key: 'rootsong', name: 'Rootsong', aff: 'communion', desc: 'Reach Communion 8, research Rootsong Theory and grow the Heartbloom. Keep it for 15 turns while the planet wakes.' },
  { key: 'convergence', name: 'Convergence', aff: 'lattice', desc: 'Reach Lattice 8, research the Singularity Mesh and build the Lattice Core. Keep it for 15 turns while minds upload.' },
  { key: 'genesis', name: 'Genesis', aff: 'lineage', desc: 'Reach Lineage 8, research the Genesis Protocol and build the Genesis Engine. Keep your land clear of the Veil for 15 turns while it reshapes the world.' },
  { key: 'awakening', name: 'Awakening', desc: 'Research Deep Resonance, decode 3 Echo Vaults with Explorers and build the Listening Array. Hold it for 18 turns until the Sleepers answer.' },
  { key: 'score', name: 'Legacy', desc: 'Highest score when the turn limit is reached.' },
];
const BARBARIANS = [{ key: 'off', name: 'Off' }, { key: 'normal', name: 'Normal' }, { key: 'raging', name: 'Restless' }];

// Base civilian units. Military lines are in combatdata.js.
const UNITS = {
  settler: { key: 'settler', name: 'Colony Pod', civilian: true, moves: 2, sight: 2, strength: 0, glyph: '🏕️', founds: true },
  scout: { key: 'scout', name: 'Explorer', civilian: false, moves: 3, sight: 2, strength: 4, glyph: '🧭', recon: true, ignoreTerrain: true, charges: 2 },
  militia: { key: 'militia', name: 'Marine', civilian: false, moves: 2, sight: 2, strength: 10, glyph: '🪖', canFortify: true },
};

// The three philosophies of the colonists. Levels come from technologies, story quests and discoveries.
const AFFINITIES = [
  { key: 'communion', name: 'Communion', glyph: '🌿', color: '#5fe0a0', dark: '#0f4a33', motto: 'Become part of Veyra.',
    desc: 'Communion teaches that humanity must stop fighting the planet and join it: gene-weaving with native life, singing to the fauna, breathing the Veil. Its followers grow living cities and beast-riders.' },
  { key: 'lattice', name: 'Lattice', glyph: '💠', color: '#f2c94c', dark: '#5a4210', motto: 'The mind outlives the flesh.',
    desc: 'Lattice holds that flesh is a passing stage. Its engineers weave machine minds through the colony, augment their soldiers and dream of a single networked consciousness.' },
  { key: 'lineage', name: 'Lineage', glyph: '🧬', color: '#ff6f80', dark: '#5c1420', motto: 'Remain human, whatever it costs.',
    desc: 'Lineage swears to carry humanity across the void unchanged: the old genome, the old songs, the old shape. Its builders scour the Veil and remake Veyra into a second home.' },
];
const AFFI = {}; AFFINITIES.forEach((a, i) => AFFI[a.key] = i);

// fx keys are the shared effect system (see polFx in virtues.js). Faction bonuses use the same keys.
const CIVS = [
  { key: 'halcyon', name: 'Halcyon Accord', adj: 'Halcyon', leader: 'Director Imre Saltan', color: '#4fb8f0', dark: '#0f3a57', lean: 'lattice',
    bonus: "Scholars' Charter", bonusText: '+2 science and +1 food in every colony, +10% science everywhere and +10% affinity experience.', fx: { citySci: 2, sciPct: 10, affPct_all: 10, cityFood: 1 },
    uu: 'Pulse Sentry', uuText: 'Replaces the Skirmisher with +2 ranged strength and +1 range.', agenda: 'scholar',
    lore: 'A union of universities that bought the last ark berths with patents. They came to Veyra to understand it.',
    cities: ['Halcyon', 'New Alexandria', 'Prism Point', 'Saltan Station', 'Meridian Lab', 'Quillon', 'Theorem', 'Brightmarch', 'Asterion', 'Kepler Rest', 'Lumen Hall', 'Axiom', 'Parallax', 'Vesta Deep', 'Corollary', 'Lantern'] },
  { key: 'kestrel', name: 'Kestrel Mutual', adj: 'Kestrel', leader: 'Factor Ysolde Marr', color: '#ffb44d', dark: '#5f3b0a', lean: 'lineage',
    bonus: 'Dividends', bonusText: '+1 convoy route, +10% credits, and buying with credits costs 15% less.', fx: { routes: 1, goldPct: 10, buyPct: -15 },
    uu: 'Contract Rover', uuText: 'Replaces the Rover with +1 movement and earns credits when it wins.', agenda: 'merchant',
    lore: 'A shipping consortium that owned the fleet that carried everyone else. Every colonist still owes them something.',
    cities: ['Kestrel Exchange', 'Margin', 'Port Dividend', 'Marrhaven', 'Ledger Bay', 'Tollgate', 'Bourse', 'Arbitrage', 'Escrow', 'Fairweather', 'Consignment', 'Tenderfoot', 'Coinwater', 'Accrual', 'Freehold', 'Surety'] },
  { key: 'brightwater', name: 'Brightwater Commune', adj: 'Brightwater', leader: 'Steward Ama Okonjo', color: '#9bd45f', dark: '#2c4f10', lean: 'communion',
    bonus: 'Living Soil', bonusText: '+1 food and +1 production in every colony. Colonies keep 10% of their food when they grow.', fx: { cityFood: 1, cityProd: 1, keepFood: 10 },
    uu: 'Grove Ranger', uuText: 'Replaces the Marine with +2 strength and moves through Fungal Forest at no extra cost.', agenda: 'gardener',
    lore: 'Farmers and seed-keepers who left the drowned river deltas of home with ten thousand jars of soil.',
    cities: ['Brightwater', 'Seedfall', 'Okonjo Fields', 'Harrowmeet', 'Long Furrow', 'Greenhearth', 'Mossgate', 'Firstharvest', 'Sowing', 'Tilth', 'Rainward', 'Kindlewood', 'Orchard Rise', 'Loam', 'Wellspring', 'Stillmere'] },
  { key: 'ironveil', name: 'Ironveil Pact', adj: 'Ironveil', leader: 'Marshal Teodor Vance', color: '#ef6a6a', dark: '#5a1717', lean: 'lineage',
    bonus: 'Bulwark Doctrine', bonusText: '+20% combat strength inside your territory. +1 production in every colony. Perimeter Walls cost half and give +1 production.', fx: { homeCombat: 20, cityProd: 1, wallsHalf: 1, 'b.walls.p': 1 },
    uu: 'Pact Legionary', uuText: 'Replaces the Marine with +3 strength and +25% defense in your territory.', agenda: 'soldier',
    lore: 'What remained of three armies after the last war at home. They promised to keep the colonists safe, and to keep them in line.',
    cities: ['Ironveil', 'Fort Vance', 'Bulwark', 'Redoubt', 'Garrison Hill', 'Picket', 'Rampart', 'Sentry', 'Holdfast', 'Muster', 'Vigil', 'Palisade', 'Citadel Nine', 'Breach', 'Steadfast', 'Warden Gap'] },
  { key: 'choir', name: 'Choir of Sel', adj: 'Sel', leader: 'Cantor Liesl Ahn', color: '#c27ae0', dark: '#45185a', lean: 'communion',
    bonus: 'Veil Hymns', bonusText: 'The Veil never harms your units. +25% Communion experience. +1 food, +1 production, +1 science and +1 culture in every colony.', fx: { veilImmune: 1, affPct_communion: 25, cityCul: 1, cityFood: 1, citySci: 1, cityProd: 1 },
    uu: 'Veil Chanter', uuText: 'Replaces the Skirmisher, moves through Fungal Forest at no extra cost and heals 10 more each turn.', agenda: 'mystic',
    lore: 'A choir that sang the ark through its long sleep. They heard Veyra singing back before anyone else landed.',
    cities: ['Sel', 'Cantus', 'Hymnfall', 'Ahn Refuge', 'Chorale', 'Vespers', 'Resonance', 'Lullwater', 'Antiphon', 'Echo Hollow', 'Plainsong', 'Descant', 'Litany', 'Cadence', 'Requiem Rest', 'Aria'] },
  { key: 'forgeborn', name: 'Forgeborn Cooperative', adj: 'Forgeborn', leader: 'Foreman Dace Kirov', color: '#ff8a5c', dark: '#5c2510', lean: 'lattice',
    bonus: 'Foundry Guilds', bonusText: '+5% production toward buildings. Drill Rigs give +1 production.', fx: { bldPct: 5, 'i.mine.p': 1 },
    uu: 'Forge Crawler', uuText: 'Replaces the Mortar Crawler with +1 range and +4 strength.', agenda: 'builder',
    lore: 'The shipwrights and welders who built the arks in orbit, and who mean to build a world.',
    cities: ['Forgeborn', 'Kirov Works', 'Slagwater', 'Rivet', 'Anvilhead', 'Crucible', 'Smelter', 'Gantry', 'Weld', 'Tempering', 'Castplate', 'Bellows', 'Ingot', 'Quench', 'Rolling Mill', 'Arcworks'] },
  { key: 'tidecall', name: 'Tidecall Flotilla', adj: 'Tidecall', leader: 'Admiral Neve Castellan', color: '#37d0c8', dark: '#0d4a47', lean: 'lineage',
    bonus: 'Ocean Arks', bonusText: 'Ships +1 movement. Worked Shallows give +1 credit. Tidal Docks cost half.', fx: { navalMoves: 1, 't.shallows.g': 1, docksHalf: 1 },
    uu: 'Reef Lancer', uuText: 'Replaces the Patrol Skiff with +1 movement and +3 strength.', agenda: 'sailor',
    lore: 'Families who lived on floating arcologies at home and refused to set foot on solid ground until they had to.',
    cities: ['Tidecall', 'Castellan Quay', 'Driftharbor', 'Saltwind', 'Brinestead', 'Keelhaven', 'Spume', 'Undertow', 'Fathom', 'Lagoonmouth', 'Wavebreak', 'Seaglass', 'Coralmere', 'Anchorage', 'Foam Reach', 'Mooring'] },
  { key: 'pathfinder', name: 'Pathfinder Lodge', adj: 'Pathfinder', leader: 'Warden Kaito Ruhl', color: '#f2e15a', dark: '#5a520e', lean: 'communion',
    bonus: 'Trailblazers', bonusText: 'Explorers +1 movement. Excavations finish in 1 turn.', fx: { exploreMoves: 1, digFast: 1 },
    uu: 'Wayfinder', uuText: 'Replaces the Explorer with 3 movement and 3 expedition kits.', agenda: 'explorer',
    lore: 'Surveyors, climbers and wanderers who mapped the dead moons of home and wanted something alive to map.',
    cities: ['Pathfinder', 'Ruhl Camp', 'Cairnfield', 'Trailhead', 'Lookout', 'Switchback', 'Bearing', 'Waymark', 'Summitsend', 'Far Ridge', 'Compass Rose', 'Basecamp', 'Highwater', 'Outlier', 'Wanderwell', 'Horizon'] },
];
const CIVI = {}; CIVS.forEach((c, i) => CIVI[c.key] = i);

// Colonist, cargo and ship chosen before landfall. Each gives a starting bonus.
const LOADOUT = {
  colonists: [
    { key: 'agronomists', name: 'Agronomists', glyph: '🌱', fx: { capFood: 2 }, text: 'Capital +2 food.' },
    { key: 'engineers', name: 'Engineers', glyph: '🔧', fx: { capProd: 2 }, text: 'Capital +2 production.' },
    { key: 'scientists', name: 'Scientists', glyph: '🔬', fx: { capSci: 2 }, text: 'Capital +2 science.' },
    { key: 'artists', name: 'Artists', glyph: '🎨', fx: { capCul: 3 }, text: 'Capital +3 culture.' },
    { key: 'security', name: 'Security Detail', glyph: '🛡️', fx: { combatPct: 5 }, text: 'A second Marine squad lands with you. +5% combat strength.' },
  ],
  cargo: [
    { key: 'seed_vault', name: 'Seed Vault', glyph: '🫙', text: 'Your first colony starts with a free Hydroponics Bay.' },
    { key: 'fabricators', name: 'Fabricators', glyph: '🛠️', text: 'A free Rigger lands with you.' },
    { key: 'datacore', name: 'Ark Datacore', glyph: '💾', text: '+40 science toward your first research.' },
    { key: 'credits', name: 'Credit Reserve', glyph: '💠', text: '+120 credits on landing.' },
    { key: 'artifact', name: 'Precursor Relic', glyph: '🏺', text: 'Start with a random artifact.' },
  ],
  ships: [
    { key: 'survey', name: 'Survey Ark', glyph: '🛰️', text: 'The ark mapped the region from orbit: land within 7 tiles of the landing site is revealed.' },
    { key: 'swift', name: 'Swift Lander', glyph: '🚀', text: 'A second Explorer lands with you, and Explorers get +1 movement.', fx: { exploreMoves: 1 } },
    { key: 'fortress', name: 'Fortress Hull', glyph: '🏰', text: 'The ark hull becomes a Perimeter Wall in your first colony.' },
    { key: 'orbital', name: 'Orbital Tug', glyph: '🛸', text: 'A Survey Eye satellite stays in orbit over your landing site for 30 turns.' },
  ],
};

const MIN_CITY_DIST = 4; // centers must be at least this many tiles apart
