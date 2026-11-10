// ===== econdata.js : improvements, buildings, the technology web, economy constants =====
const MP = 6; // move points per tile of movement; roads cost 2, maglev 1

// Phases of the colony replace historical eras: they follow how many technologies a faction knows.
const ERAS = ['Landfall', 'Foothold', 'Expansion', 'Ascent', 'Dominion', 'Apotheosis'];

// Improvements (index 0 = none). Each resource has exactly one matching improvement. aff: [affinity, level] needed.
const IMPROV = [
  null,
  { key: 'farm', name: 'Hydro Farm', tech: 'hydroponics', glyph: '', add: { f: 1 }, desc: '+1 food. Needs flat land or ridges; Glass Dunes need fresh water.' },
  { key: 'mine', name: 'Drill Rig', tech: 'fabrication', glyph: '⛏️', add: { p: 1 }, desc: '+1 production on ridges, Ferrite, Lumenite and Prism Shards.' },
  { key: 'quarry', name: 'Quarry', tech: 'geomechanics', glyph: '🧱', add: { p: 1 }, desc: '+1 production on Basalt.' },
  { key: 'camp', name: 'Harvest Camp', tech: 'xenobiology', glyph: '🏕️', add: { g: 1 }, desc: '+1 credit on Lopers, Chitin and Icefern.' },
  { key: 'pasture', name: 'Herd Pen', tech: 'xenobiology', glyph: '🐑', add: { p: 1 }, desc: '+1 production on Drift Grazers.' },
  { key: 'plantation', name: 'Bloom Garden', tech: 'ecology', glyph: '🌱', add: { g: 1 }, desc: '+1 credit on Silkweb, Ember Moss and Nectarbloom.' },
  { key: 'lumbermill', name: 'Spore Mill', tech: 'spore_lore', glyph: '🍄', add: { p: 1 }, desc: '+1 production on Fungal Forest.' },
  { key: 'boats', name: 'Kelp Nets', tech: 'marine_tech', glyph: '⛵', add: { f: 1 }, desc: '+1 food on Shimmerfish and Abyss Pearls. Built from an adjacent land tile.' },
  { key: 'biowell', name: 'Biowell', tech: 'mycelial_net', aff: ['communion', 2], glyph: '🫧', add: { f: 1, s: 1 }, desc: '+1 food, +1 science. Communion 2. Built only on Veil tiles, which it keeps.' },
  { key: 'nexus', name: 'Data Node', tech: 'augmentation', aff: ['lattice', 2], glyph: '📡', add: { p: 1, s: 1 }, desc: '+1 production, +1 science. Lattice 2. On Rust Flats, Glass Dunes or Frost Shelf.' },
  { key: 'terrace', name: 'Arcadia Terrace', tech: 'terraforming', aff: ['lineage', 2], glyph: '🏡', add: { f: 1, c: 1 }, desc: '+1 food, +1 culture. Lineage 2. On Lumen Steppe or Rust Flats free of the Veil.' },
];
const IMPI = {}; IMPROV.forEach((m, i) => { if (m) IMPI[m.key] = i; });
const RES_IMPROV = { glowroot: 'farm', grazer: 'pasture', loper: 'camp', shimmerfish: 'boats', basalt: 'quarry', chitin: 'camp', ferrite: 'mine',
  lumenite: 'mine', silkweb: 'plantation', embermoss: 'plantation', prism: 'mine', nectar: 'plantation', icefern: 'camp', abysspearl: 'boats' };

// y: flat yields (f food, p production, g credits, s science, c culture), pct: percent bonuses, h: morale. aff: [affinity, level].
const BUILDINGS = [
  { key: 'palace', name: 'Command Hub', cost: 0, upkeep: 0, hidden: true, y: { p: 2, s: 2, g: 3, c: 1 }, glyph: '🛰️', desc: 'The landed ark, now the seat of the colony.' },
  { key: 'monument', name: 'Memory Archive', tech: 'colonial_charter', cost: 35, upkeep: 0, y: { c: 2 }, glyph: '🗄️', desc: '+2 culture. Records of the old world, read aloud each evening.' },
  { key: 'granary', name: 'Hydroponics Bay', tech: 'hydroponics', cost: 45, upkeep: 1, y: { f: 2 }, keepFood: 15, glyph: '🪴', desc: '+2 food. Keeps 15% of food when the colony grows.' },
  { key: 'library', name: 'Field Lab', tech: 'field_physics', cost: 60, upkeep: 1, y: { s: 2 }, pct: { s: 10 }, glyph: '🧪', desc: '+2 science, +10% science.' },
  { key: 'market', name: 'Credit Exchange', tech: 'commerce', cost: 80, upkeep: 0, y: { g: 2 }, pct: { g: 20 }, glyph: '💱', desc: '+2 credits, +20% credits.' },
  { key: 'temple', name: 'Med Clinic', tech: 'biocontainment', cost: 70, upkeep: 1, y: { c: 1 }, h: 2, glyph: '⚕️', desc: '+2 morale, +1 culture.' },
  { key: 'amphitheater', name: 'Commons Dome', tech: 'civics', cost: 100, upkeep: 1, y: { c: 3 }, h: 1, glyph: '🎭', desc: '+3 culture, +1 morale.' },
  { key: 'arena', name: 'Holo Arena', tech: 'civics', cost: 100, upkeep: 2, h: 3, glyph: '🏟️', desc: '+3 morale.' },
  { key: 'harbor', name: 'Tidal Docks', tech: 'tidal_power', cost: 90, upkeep: 2, coastal: true, y: { g: 1 }, waterF: 1, glyph: '⚓', desc: '+1 food on worked water tiles, +1 credit. Links the colony by sea.' },
  { key: 'courthouse', name: 'Colony Tribunal', tech: 'civics', cost: 110, upkeep: 1, y: { g: 1 }, h: 2, glyph: '⚖️', desc: '+2 morale, +1 credit.' },
  { key: 'aqueduct', name: 'Water Recycler', tech: 'ecology', cost: 120, upkeep: 1, keepFood: 35, glyph: '🚰', desc: 'Keeps 35% of food when the colony grows.' },
  { key: 'workshop', name: 'Fab Foundry', tech: 'automation', cost: 130, upkeep: 2, y: { p: 2 }, pct: { p: 15 }, glyph: '🔧', desc: '+2 production, +15% production.' },
  { key: 'university', name: 'Xeno Institute', tech: 'quantum_theory', cost: 160, upkeep: 2, req: 'library', y: { s: 3 }, pct: { s: 25 }, glyph: '🎓', desc: '+3 science, +25% science. Needs a Field Lab.' },
  { key: 'lighthouse', name: 'Sonar Station', tech: 'hydrodynamics', cost: 100, upkeep: 1, coastal: true, waterP: 1, glyph: '🗼', desc: '+1 production on worked water tiles.' },
  { key: 'bank', name: 'Credit Vault', tech: 'finance', cost: 190, upkeep: 0, req: 'market', y: { g: 2 }, pct: { g: 25 }, glyph: '🏦', desc: '+2 credits, +25% credits. Needs a Credit Exchange.' },
  { key: 'printing', name: 'Netcore Relay', tech: 'quantum_computing', cost: 180, upkeep: 2, y: { s: 2, c: 2 }, glyph: '📶', desc: '+2 science, +2 culture.' },
  { key: 'observatory', name: 'Sky Array', tech: 'gravitics', cost: 200, upkeep: 2, y: { s: 2 }, pct: { s: 15 }, mountainS: 1, glyph: '🔭', desc: '+2 science, +15% science, +1 science per adjacent Spire Crag (max 3).' },
  { key: 'opera', name: 'Concord Forum', tech: 'planetary_media', cost: 210, upkeep: 2, req: 'amphitheater', y: { c: 4 }, h: 1, glyph: '🏛️', desc: '+4 culture, +1 morale. Needs a Commons Dome.' },
  { key: 'museum', name: 'Precursor Museum', tech: 'xenoarchaeology', cost: 250, upkeep: 3, y: { c: 5 }, pct: { c: 15 }, glyph: '🏺', desc: '+5 culture, +15% culture.' },
  { key: 'factory', name: 'Assembly Plant', tech: 'nanofabrication', cost: 300, upkeep: 3, req: 'workshop', y: { p: 4 }, pct: { p: 25 }, glyph: '🏭', desc: '+4 production, +25% production. Needs a Fab Foundry.' },
  { key: 'laboratory', name: 'Quantum Lab', tech: 'quantum_computing', cost: 300, upkeep: 3, req: 'university', y: { s: 4 }, pct: { s: 25 }, glyph: '⚛️', desc: '+4 science, +25% science. Needs a Xeno Institute.' },
  { key: 'hospital', name: 'Vitality Ward', tech: 'genetic_medicine', cost: 260, upkeep: 2, req: 'aqueduct', y: { f: 3 }, keepFood: 25, glyph: '🏥', desc: '+3 food. Keeps 25% more food on growth. Needs a Water Recycler.' },
  { key: 'power_plant', name: 'Fusion Reactor', tech: 'fusion_power', cost: 380, upkeep: 3, req: 'factory', y: { p: 4 }, pct: { p: 20 }, glyph: '☢️', desc: '+4 production, +20% production. Needs an Assembly Plant.' },
  { key: 'research_lab', name: 'Cognition Tank', tech: 'synthetic_cognition', cost: 400, upkeep: 3, req: 'laboratory', y: { s: 5 }, pct: { s: 20 }, glyph: '🧠', desc: '+5 science, +20% science. Needs a Quantum Lab.' },
  { key: 'broadcast_tower', name: 'Holo Broadcast', tech: 'planetary_media', cost: 380, upkeep: 3, req: 'museum', y: { c: 5 }, pct: { c: 20 }, glyph: '📡', desc: '+5 culture, +20% culture. Needs a Precursor Museum.' },
  { key: 'stadium', name: 'Gravball Stadium', tech: 'longevity', cost: 360, upkeep: 3, h: 4, glyph: '🏀', desc: '+4 morale.' },
  { key: 'supermarket', name: 'Vertical Farm', tech: 'arcology_design', cost: 300, upkeep: 2, y: { f: 4 }, keepFood: 10, glyph: '🌾', desc: '+4 food. Keeps 10% more food on growth.' },
  { key: 'stock_exchange', name: 'Trade Spire', tech: 'postscarcity', cost: 300, upkeep: 0, req: 'bank', y: { g: 3 }, pct: { g: 25 }, glyph: '📈', desc: '+3 credits, +25% credits. Needs a Credit Vault.' },
  // affinity buildings
  { key: 'symbiont_garden', name: 'Symbiont Garden', tech: 'gene_weaving', aff: ['communion', 2], cost: 120, upkeep: 1, y: { f: 2, s: 1 }, veilF: 1, glyph: '🌿', desc: '+2 food, +1 science; worked Veil tiles +1 food. Communion 2.' },
  { key: 'gaia_node', name: 'Gaia Node', tech: 'neural_symbiosis', aff: ['communion', 6], cost: 280, upkeep: 2, y: { s: 3, c: 2 }, pct: { f: 10 }, h: 1, glyph: '🌳', desc: '+3 science, +2 culture, +1 morale, +10% food. Communion 6.' },
  { key: 'neural_hub', name: 'Neural Hub', tech: 'machine_learning', aff: ['lattice', 2], cost: 130, upkeep: 1, y: { s: 2, p: 1 }, glyph: '🔌', desc: '+2 science, +1 production. Lattice 2.' },
  { key: 'assembler_core', name: 'Assembler Core', tech: 'synthetic_cognition', aff: ['lattice', 6], cost: 300, upkeep: 2, y: { p: 3, s: 2 }, pct: { p: 10 }, glyph: '🤖', desc: '+3 production, +2 science, +10% production. Lattice 6.' },
  { key: 'heritage_hall', name: 'Heritage Hall', tech: 'heritage', aff: ['lineage', 2], cost: 120, upkeep: 1, y: { c: 3 }, h: 1, glyph: '🏛️', desc: '+3 culture, +1 morale. Lineage 2.' },
  { key: 'arcology', name: 'Arcology', tech: 'arcology_design', aff: ['lineage', 6], cost: 300, upkeep: 2, y: { f: 3, p: 2 }, h: 2, keepFood: 10, glyph: '🏙️', desc: '+3 food, +2 production, +2 morale, keeps 10% more food. Lineage 6.' },
];
const BLDI = {}; BUILDINGS.forEach((b, i) => BLDI[b.key] = i);

// ---- the technology web ----
// Eight sectors around Landfall. In each: a branch (b1) with a leaf (l1), a second branch (b2) with two leaves (l2),
// a third branch (b3) with two leaves (l3). A branch opens from its own sector's inner branch OR a neighbor's, so the web
// can be crossed sideways. aff: affinity experience granted (C Communion, L Lattice, G Lineage).
const SECTORS = [
  { key: 'habitation', name: 'Habitation', glyph: '🏠', color: '#ff8f9b' },
  { key: 'xenobio', name: 'Xenobiology', glyph: '🧫', color: '#6be0a3' },
  { key: 'engineering', name: 'Engineering', glyph: '🏗️', color: '#ffb36b' },
  { key: 'cybernetics', name: 'Cybernetics', glyph: '🤖', color: '#f2d15c' },
  { key: 'physics', name: 'Physics', glyph: '⚛️', color: '#7fc4ff' },
  { key: 'society', name: 'Society', glyph: '🗳️', color: '#e6a3ff' },
  { key: 'defense', name: 'Defense', glyph: '🛡️', color: '#ff7a6b' },
  { key: 'orbit', name: 'Ocean and Orbit', glyph: '🛰️', color: '#5fd6d6' },
];
const RING_BASE = { root: 0, b1: 24, l1: 48, b2: 130, l2: 300, b3: 820, l3: 1750 };
const RING_LV = { root: 0, b1: 1, l1: 1.5, b2: 2, l2: 2.5, b3: 3, l3: 3.5 };
const TECHS = [
  { key: 'landfall', name: 'Landfall', s: -1, r: 'root', pre: [], desc: 'The arks are down. What we carried is all we have.' },
  // 0 Habitation
  { key: 'hydroponics', name: 'Hydroponics', s: 0, r: 'b1', ins: { t: 'cities', n: 1, text: 'Found a colony' }, desc: 'Grow the seeds of home under glass.' },
  { key: 'biocontainment', name: 'Biocontainment', s: 0, r: 'l1', aff: { G: 10 }, ins: { t: 'pop', n: 3, text: 'Grow a colony to size 3' }, later: ['Scour the Veil'], desc: 'Seal the colony against spores, and learn to burn the Veil away.' },
  { key: 'ecology', name: 'Applied Ecology', s: 0, r: 'b2', aff: { C: 5, G: 5 }, ins: { t: 'improv', k: 'farm', n: 3, text: 'Build 3 Hydro Farms' }, fx: { irrigation: 1 }, desc: 'Understand how Veyran soil feeds and poisons.' },
  { key: 'genetic_medicine', name: 'Genetic Medicine', s: 0, r: 'l2', aff: { G: 20 }, ins: { t: 'pop', n: 8, text: 'Grow a colony to size 8' }, desc: 'Keep the human genome whole against alien microbes.' },
  { key: 'terraforming', name: 'Terraforming', s: 0, r: 'l2', aff: { G: 20 }, ins: { t: 'scoured', n: 4, text: 'Scour 4 Veil tiles' }, desc: 'Reshape the land itself to suit human lungs.' },
  { key: 'arcology_design', name: 'Arcology Design', s: 0, r: 'b3', aff: { G: 15 }, ins: { t: 'pop', n: 14, text: 'Grow a colony to size 14' }, desc: 'Cities that are single buildings, sealed and self-sufficient.' },
  { key: 'genesis_protocol', name: 'Genesis Protocol', s: 0, r: 'l3', aff: { G: 50 }, desc: 'A plan to remake Veyra, continent by continent, into a second Earth.' },
  { key: 'longevity', name: 'Longevity Therapy', s: 0, r: 'l3', aff: { G: 30 }, desc: 'Lives long enough to see the new world finished.' },
  // 1 Xenobiology
  { key: 'xenobiology', name: 'Xenobiology', s: 1, r: 'b1', aff: { C: 10 }, ins: { t: 'explored', n: 80, text: 'Explore 80 tiles' }, desc: 'Name and catalogue the life of Veyra.' },
  { key: 'spore_lore', name: 'Spore Lore', s: 1, r: 'l1', aff: { C: 10 }, ins: { t: 'workTerrain', k: ['fungal'], n: 1, text: 'Work a Fungal Forest tile' }, desc: 'The spores are not a poison. They are a language.' },
  { key: 'gene_weaving', name: 'Gene Weaving', s: 1, r: 'b2', aff: { C: 20 }, ins: { t: 'studied', n: 1, text: 'Study a fauna nest' }, desc: 'Splice Veyran traits into crops, livestock and, carefully, ourselves.' },
  { key: 'fauna_ethology', name: 'Fauna Ethology', s: 1, r: 'l2', aff: { C: 20 }, ins: { t: 'studied', n: 2, text: 'Study 2 fauna nests' }, later: ['Tame fauna (Communion 4)'], desc: 'Learn the moods of the great beasts, and how to calm them.' },
  { key: 'mycelial_net', name: 'Mycelial Networks', s: 1, r: 'l2', aff: { C: 20 }, ins: { t: 'improv', k: 'lumbermill', n: 2, text: 'Build 2 Spore Mills' }, fx: { millP: 1 }, later: ['Seed the Veil (Communion 3)'], desc: 'The fungal forests share one root system. We can listen in.' },
  { key: 'neural_symbiosis', name: 'Neural Symbiosis', s: 1, r: 'b3', aff: { C: 15 }, desc: 'Minds that share their thoughts with the planet.' },
  { key: 'rootsong_theory', name: 'Rootsong Theory', s: 1, r: 'l3', aff: { C: 50 }, desc: 'Veyra is dreaming. A song grown from its roots could wake it.' },
  { key: 'biosphere_mind', name: 'Biosphere Mind', s: 1, r: 'l3', aff: { C: 30 }, desc: 'Every forest a neuron, every herd a thought.' },
  // 2 Engineering
  { key: 'fabrication', name: 'Fabrication', s: 2, r: 'b1', aff: { L: 5 }, ins: { t: 'workTerrain', k: ['ridge'], n: 1, text: 'Work a Crystal Ridge' }, desc: 'Turn landers into workshops and ore into tools.' },
  { key: 'geomechanics', name: 'Geomechanics', s: 2, r: 'l1', aff: { G: 5 }, ins: { t: 'improv', k: 'mine', n: 1, text: 'Build a Drill Rig' }, desc: 'Read the planet\'s rock and find its metals.' },
  { key: 'automation', name: 'Industrial Automation', s: 2, r: 'b2', aff: { L: 10 }, ins: { t: 'improv', k: 'mine', n: 3, text: 'Build 3 Drill Rigs' }, desc: 'Machines that run while the colony sleeps.' },
  { key: 'heavy_alloys', name: 'Heavy Alloys', s: 2, r: 'l2', aff: { G: 10 }, ins: { t: 'improvRes', k: ['ferrite'], n: 1, text: 'Rig a Ferrite deposit' }, desc: 'Ferrite plate for walls, hulls and armor.' },
  { key: 'maglev', name: 'Maglev Transit', s: 2, r: 'l2', aff: { L: 10 }, ins: { t: 'roads', n: 8, text: 'Build 8 roads' }, desc: 'Magnetic rails that make distance vanish.' },
  { key: 'nanofabrication', name: 'Nanofabrication', s: 2, r: 'b3', aff: { L: 10, G: 5 }, ins: { t: 'build', k: 'workshop', n: 3, text: 'Build 3 Fab Foundries' }, desc: 'Assemblers smaller than a cell.' },
  { key: 'fusion_power', name: 'Fusion Power', s: 2, r: 'l3', aff: { L: 15 }, desc: 'A small star in every colony.' },
  { key: 'megastructures', name: 'Megastructures', s: 2, r: 'l3', aff: { L: 5, G: 10 }, desc: 'Building on the scale of mountains.' },
  // 3 Cybernetics
  { key: 'robotics', name: 'Robotics', s: 3, r: 'b1', aff: { L: 10 }, ins: { t: 'military', n: 3, text: 'Have 3 military units' }, fx: { builderCharges: 1 }, desc: 'Tireless hands for the frontier. Riggers gain an extra charge.' },
  { key: 'drone_logistics', name: 'Drone Logistics', s: 3, r: 'l1', aff: { L: 10 }, ins: { t: 'routes', n: 1, text: 'Run a convoy route' }, fx: { routes: 1 }, desc: 'Flights of drones carry cargo between colonies.' },
  { key: 'machine_learning', name: 'Machine Learning', s: 3, r: 'b2', aff: { L: 20 }, ins: { t: 'build', k: 'library', n: 2, text: 'Build 2 Field Labs' }, desc: 'Minds that learn faster than their teachers.' },
  { key: 'augmentation', name: 'Augmentation', s: 3, r: 'l2', aff: { L: 20 }, ins: { t: 'military', n: 6, text: 'Have 6 military units' }, desc: 'Better eyes, faster nerves, steel bones.' },
  { key: 'swarm_intelligence', name: 'Swarm Intelligence', s: 3, r: 'l2', aff: { L: 20 }, fx: { healAll: 5 }, desc: 'Repair swarms follow every army. Units heal 5 more each turn.' },
  { key: 'synthetic_cognition', name: 'Synthetic Cognition', s: 3, r: 'b3', aff: { L: 15 }, desc: 'Machines that wonder about themselves.' },
  { key: 'singularity_mesh', name: 'Singularity Mesh', s: 3, r: 'l3', aff: { L: 50 }, desc: 'A single mind made of every mind in the colony.' },
  { key: 'autonomous_war', name: 'Autonomous Warfare', s: 3, r: 'l3', aff: { L: 20 }, fx: { combatPct: 5 }, desc: 'Machines that fight without fear. +5% combat strength.' },
  // 4 Physics
  { key: 'field_physics', name: 'Field Physics', s: 4, r: 'b1', ins: { t: 'met', n: 1, text: 'Meet another faction' }, desc: 'Veyra\'s magnetic field is strange. Measure it.' },
  { key: 'signal_analysis', name: 'Signal Analysis', s: 4, r: 'l1', aff: { L: 5 }, ins: { t: 'explored', n: 160, text: 'Explore 160 tiles' }, desc: 'Something under the crust is transmitting.' },
  { key: 'quantum_theory', name: 'Quantum Theory', s: 4, r: 'b2', aff: { L: 5 }, ins: { t: 'build', k: 'library', n: 3, text: 'Build 3 Field Labs' }, desc: 'The physics of Lumenite crystals.' },
  { key: 'xenoarchaeology', name: 'Xenoarchaeology', s: 4, r: 'l2', aff: { C: 10, G: 10 }, ins: { t: 'digs', n: 2, text: 'Excavate 2 sites' }, fx: { digPct: 50 }, desc: 'Who built the vaults, and where did they go? Excavations pay 50% more.' },
  { key: 'gravitics', name: 'Gravitics', s: 4, r: 'l2', aff: { L: 10 }, ins: { t: 'nearMountain', n: 1, text: 'Own a colony next to Spire Crags' }, desc: 'Gravity is a field like any other.' },
  { key: 'quantum_computing', name: 'Quantum Computing', s: 4, r: 'b3', aff: { L: 10 }, ins: { t: 'build', k: 'university', n: 2, text: 'Build 2 Xeno Institutes' }, desc: 'Computation in every possible world at once.' },
  { key: 'deep_resonance', name: 'Deep Resonance', s: 4, r: 'l3', aff: { C: 10, L: 10, G: 10 }, desc: 'The Echo Vaults are not ruins. They are receivers.' },
  { key: 'unified_field', name: 'Unified Field Theory', s: 4, r: 'l3', aff: { C: 10, G: 10 }, fx: { sciPct: 10 }, desc: 'One equation for everything. +10% science.' },
  // 5 Society
  { key: 'colonial_charter', name: 'Colonial Charter', s: 5, r: 'b1', ins: { t: 'cities', n: 2, text: 'Have 2 colonies' }, desc: 'Write down who we are, before we forget.' },
  { key: 'commerce', name: 'Frontier Commerce', s: 5, r: 'l1', ins: { t: 'gold', n: 60, text: 'Hold 60 credits' }, fx: { routes: 1 }, desc: 'Credits, contracts and convoys between colonies.' },
  { key: 'civics', name: 'Colony Civics', s: 5, r: 'b2', aff: { G: 5 }, ins: { t: 'cities', n: 4, text: 'Have 4 colonies' }, fx: { policyCost: 1 }, desc: 'Courts, councils and commons. Virtues cost 10% less.' },
  { key: 'heritage', name: 'Heritage Studies', s: 5, r: 'l2', aff: { G: 20 }, ins: { t: 'build', k: 'monument', n: 3, text: 'Build 3 Memory Archives' }, desc: 'What made us human, kept alive by study.' },
  { key: 'finance', name: 'Interstellar Finance', s: 5, r: 'l2', aff: { L: 5 }, ins: { t: 'gold', n: 300, text: 'Hold 300 credits' }, fx: { routes: 1 }, desc: 'Credit lines that stretch back toward the stars.' },
  { key: 'planetary_media', name: 'Planetary Media', s: 5, r: 'b3', aff: { C: 5, G: 5 }, ins: { t: 'culture', n: 30, text: 'Make 30 culture per turn' }, desc: 'Every colony hears every voice.' },
  { key: 'cultural_memory', name: 'Cultural Memory', s: 5, r: 'l3', aff: { C: 10, G: 20 }, desc: 'A culture that remembers everything it has ever been.' },
  { key: 'postscarcity', name: 'Post-Scarcity Economics', s: 5, r: 'l3', aff: { L: 5, G: 5 }, desc: 'When fabricators make anything, what is wealth?' },
  // 6 Defense
  { key: 'ballistics', name: 'Ballistics', s: 6, r: 'b1', ins: { t: 'military', n: 2, text: 'Have 2 military units' }, desc: 'Rifles that work in Veyra\'s heavy air.' },
  { key: 'mobile_warfare', name: 'Mobile Warfare', s: 6, r: 'l1', aff: { C: 5 }, ins: { t: 'improvRes', k: ['chitin'], n: 1, text: 'Harvest a Chitin deposit' }, desc: 'Chitin-plated rovers for the open flats.' },
  { key: 'combat_doctrine', name: 'Combat Doctrine', s: 6, r: 'b2', aff: { G: 5 }, ins: { t: 'military', n: 5, text: 'Have 5 military units' }, desc: 'Each philosophy fights its own way. Opens second-tier units.' },
  { key: 'artillery', name: 'Artillery Systems', s: 6, r: 'l2', aff: { L: 5 }, ins: { t: 'camps', n: 1, text: 'Destroy a fauna nest' }, desc: 'Guns that crack colony walls.' },
  { key: 'exo_tactics', name: 'Exo Tactics', s: 6, r: 'l2', aff: { C: 5, L: 5 }, ins: { t: 'military', n: 8, text: 'Have 8 military units' }, desc: 'Fast strike forces in powered frames, or on beast-back.' },
  { key: 'plasma_weapons', name: 'Plasma Weapons', s: 6, r: 'b3', aff: { L: 10 }, ins: { t: 'improvRes', k: ['lumenite'], n: 1, text: 'Rig a Lumenite deposit' }, desc: 'Lumenite charged until it burns. Opens third-tier units.' },
  { key: 'gravitic_armor', name: 'Gravitic Armor', s: 6, r: 'l3', aff: { L: 10 }, desc: 'Armor that floats.' },
  { key: 'siege_engines', name: 'Siege Engines', s: 6, r: 'l3', aff: { C: 10, G: 10 }, desc: 'Walking fortresses and living battering rams.' },
  // 7 Ocean and Orbit
  { key: 'marine_tech', name: 'Marine Technology', s: 7, r: 'b1', aff: { C: 5 }, ins: { t: 'coastal', n: 1, text: 'Found a coastal colony' }, later: ['Coastal embarking'], desc: 'Hulls that survive the Brine Deep.' },
  { key: 'tidal_power', name: 'Tidal Power', s: 7, r: 'l1', aff: { C: 5 }, ins: { t: 'improv', k: 'boats', n: 1, text: 'Lay Kelp Nets' }, later: ['Deep-water embarking'], desc: 'Veyra\'s twin moons pull great tides. Harness them.' },
  { key: 'orbital_launch', name: 'Orbital Launch', s: 7, r: 'b2', aff: { L: 5 }, ins: { t: 'build', k: 'workshop', n: 1, text: 'Build a Fab Foundry' }, desc: 'Back to the sky. Satellites watch and power the colonies.' },
  { key: 'hydrodynamics', name: 'Hydrodynamics', s: 7, r: 'l2', aff: { C: 5, G: 5 }, ins: { t: 'coastal', n: 3, text: 'Have 3 coastal colonies' }, desc: 'Faster, deadlier ships.' },
  { key: 'orbital_defense', name: 'Orbital Defense', s: 7, r: 'l2', aff: { G: 10 }, ins: { t: 'sats', n: 1, text: 'Launch a satellite' }, desc: 'Guns and scrubbers in orbit.' },
  { key: 'orbital_mechanics', name: 'Orbital Mechanics', s: 7, r: 'b3', aff: { C: 10, L: 5 }, ins: { t: 'sats', n: 2, text: 'Launch 2 satellites' }, fx: { satLife: 10 }, desc: 'Stable orbits: satellites last 10 turns longer.' },
  { key: 'deep_ocean', name: 'Deep Ocean Habitats', s: 7, r: 'l3', aff: { C: 15, G: 5 }, desc: 'Cities and fleets under the violet sea.' },
  { key: 'star_lift', name: 'Star Lift', s: 7, r: 'l3', aff: { C: 5, L: 10 }, desc: 'A road to orbit, and maybe home.' },
];
const TECHI = {}; TECHS.forEach((t, i) => TECHI[t.key] = i);
// Wire up the web: leaves need their branch; a branch opens from an inner branch of its own or a neighboring sector.
(function wireWeb() {
  const at = (s, r) => TECHS.filter(t => t.s === ((s + 8) % 8) && t.r === r);
  for (const t of TECHS) {
    t.pre = t.pre || []; t.any = []; t.aff = t.aff || {};
    if (t.r === 'b1') t.pre = ['landfall'];
    else if (t.r === 'l1') t.pre = [at(t.s, 'b1')[0].key];
    else if (t.r === 'b2') t.any = [at(t.s, 'b1')[0].key, at(t.s - 1, 'b1')[0].key];
    else if (t.r === 'l2') t.pre = [at(t.s, 'b2')[0].key];
    else if (t.r === 'b3') t.any = [at(t.s, 'b2')[0].key, at(t.s + 1, 'b2')[0].key];
    else if (t.r === 'l3') t.pre = [at(t.s, 'b3')[0].key];
    t.lv = RING_LV[t.r];
    t.cost = RING_BASE[t.r];
    t.era = Math.floor(t.lv); // used for ordering and display
  }
  // order the leaves within a sector for drawing
  for (let s = 0; s < 8; s++) for (const r of ['l2', 'l3']) at(s, r).forEach((t, i) => t.slot = i === 0 ? -1 : 1);
  for (let s = 0; s < 8; s++) at(s, 'l1').forEach(t => t.slot = 1);
})();
// Victory techs and their projects
const VICTORY_TECH = { rootsong: 'rootsong_theory', convergence: 'singularity_mesh', genesis: 'genesis_protocol', awakening: 'deep_resonance' };

// Units added for the economy
Object.assign(UNITS, {
  builder: { key: 'builder', name: 'Rigger', civilian: true, moves: 2, sight: 2, strength: 0, glyph: '🛠️', cost: 36, charges: 3 },
  caravan: { key: 'caravan', name: 'Convoy', civilian: true, moves: 2, sight: 2, strength: 0, glyph: '🚚', cost: 45, tech: 'commerce', trade: true },
});
UNITS.settler.cost = 48; UNITS.scout.cost = 25; UNITS.militia.cost = 30;
const BUILDABLE_UNITS = ['settler', 'builder', 'scout', 'militia', 'caravan'];

const ECON = {
  baseHappy: 9, perCityUnhappy: 2, perPopUnhappy: 0.5, luxHappy: 4,
  freeUnitsBase: 3, startGold: 10, cityFlatSci: 1, popSci: 0.5,
  specialist: { s: 1, g: 1 },
};
function paceOf(G) { return (G.cfg.turnLimit || 350) / 350; }
function growthNeed(G, pop) { return Math.floor((15 + 6 * (pop - 1) + Math.pow(pop - 1, 1.8)) * paceOf(G)); }
function borderCost(G, n) { return Math.floor((10 + 6 * n + Math.pow(n, 1.5)) * paceOf(G)); }
// Technology cost rises with every technology already known (by pid, or the active player when pid is omitted).
function techCost(G, key, pid) {
  const P = G.players[pid === undefined ? G.active : pid], T0 = TECHS[TECHI[key]];
  const known = P ? Math.max(0, P.techs.length - 1) : 0;
  return Math.round(T0.cost * (1 + 0.035 * known) * paceOf(G));
}
function itemCost(G, item, pid) {
  let base = item.k === 'u' ? UNITS[item.key].cost : BUILDINGS[BLDI[item.key]].cost;
  if (pid !== undefined) {
    const fx = polFx(G.players[pid]);
    if (item.k === 'b' && item.key === 'walls' && fx.wallsHalf) base /= 2;
    if (item.k === 'b' && item.key === 'harbor' && fx.docksHalf) base /= 2;
    if (item.k === 'u') {
      if (item.key === 'settler' && fx.settlerCostPct) base *= 1 + fx.settlerCostPct / 100;
      if (!UNITS[item.key].civilian && fx.milCostPct) base *= 1 + Math.max(-50, fx.milCostPct) / 100;
    }
  }
  return Math.round(base * paceOf(G));
}
