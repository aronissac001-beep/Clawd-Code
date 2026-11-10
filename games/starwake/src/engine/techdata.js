// ===== techdata.js : technologies (three streams, five tiers, plus repeatables) =====
var TIER_COST = [0, 130, 700, 2000, 4800, 9500];
var TIER_NEED = [0, 0, 3, 7, 12, 17]; // techs needed in a stream before a tier can be drawn
// [id, name, stream, tier, prereq, unlocks]
// unlocks: { bld, comp, hull, sb, mods, army, flag }
var TECH_LIST = [
  // ---- Lumen ----
  ['photon', 'Photon Cutters', 'lumen', 1, null, { comp: 'photon' }],
  ['veil1', 'Deflector Veils', 'lumen', 1, null, { comp: 'veil1' }],
  ['fusion_lattice', 'Fusion Lattice', 'lumen', 1, null, { mods: { 'energy%': 10 } }],
  ['sensors', 'Survey Sensors', 'lumen', 1, null, { mods: { 'surveySpeed%': 25, 'anomaly%': 20 } }],
  ['cog_ledgers', 'Cognitive Ledgers', 'lumen', 1, null, { mods: { 'sprawl+': 10 } }],
  ['trade_protocols', 'Trade Protocols', 'lumen', 1, null, { bld: 'exchange' }],
  ['lumenlance', 'Lumen Lances', 'lumen', 2, 'photon', { comp: 'lumenlance' }],
  ['veil2', 'Aegis Veils', 'lumen', 2, 'veil1', { comp: 'veil2' }],
  ['plasma_dynamo', 'Plasma Dynamos', 'lumen', 2, 'fusion_lattice', { mods: { 'energy%': 10 } }],
  ['deep_optics', 'Deep Optics', 'lumen', 2, null, { bld: 'observatory' }],
  ['quantum_relays', 'Quantum Relays', 'lumen', 2, null, { mods: { 'research%': 5 } }],
  ['holo_arts', 'Holographic Arts', 'lumen', 2, null, { bld: 'theater' }],
  ['lane_drive', 'Lane Resonance Drives', 'lumen', 2, null, { mods: { 'speed%': 20 } }],
  ['prism', 'Prism Rays', 'lumen', 3, 'lumenlance', { comp: 'prism' }],
  ['veil3', 'Halo Veils', 'lumen', 3, 'veil2', { comp: 'veil3' }],
  ['zero_point', 'Zero-Point Taps', 'lumen', 3, 'plasma_dynamo', { bld: 'nexus' }],
  ['lattice_comp', 'Lattice Computing', 'lumen', 3, 'quantum_relays', { bld: 'grandlab', mods: { 'research%': 5 } }],
  ['intercept', 'Intercept Lattices', 'lumen', 3, null, { comp: 'pd' }],
  ['fold_drive', 'Fold Drives', 'lumen', 3, 'lane_drive', { mods: { 'speed%': 25 } }],
  ['nova', 'Nova Beams', 'lumen', 4, 'prism', { comp: 'nova' }],
  ['veil4', 'Eclipse Veils', 'lumen', 4, 'veil3', { comp: 'veil4' }],
  ['dark_siphons', 'Dark Energy Siphons', 'lumen', 4, 'zero_point', { mods: { 'energy%': 15 } }],
  ['planet_shield', 'Planetary Shields', 'lumen', 4, null, { bld: 'pshield' }],
  ['synthetic_minds', 'Synthetic Minds', 'lumen', 4, 'lattice_comp', { mods: { 'research%': 10 } }],
  ['wakefield', 'Wakefield Theory', 'lumen', 5, null, { flag: 'beacons', mods: { 'research%': 5 } }],
  ['singularity_core', 'Singularity Cores', 'lumen', 5, 'dark_siphons', { mods: { 'energy%': 20, 'fleetDmg%': 5 } }],
  ['precog_grid', 'Precognition Grid', 'lumen', 5, null, { mods: { 'evasion+': 8, 'sbDef%': 20 } }],
  // ---- Vita ----
  ['hydroponics', 'Hydroponics', 'vita', 1, null, { bld: 'hydro' }],
  ['genome_mapping', 'Genome Mapping', 'vita', 1, null, { mods: { 'growth%': 10 } }],
  ['soil_eng', 'Soil Engineering', 'vita', 1, null, { mods: { 'food%': 10 } }],
  ['xeno_eco', 'Xeno-Ecology', 'vita', 1, null, { mods: { 'hab+': 10 } }],
  ['militia', 'Militia Doctrine', 'vita', 1, null, { mods: { 'armyHp%': 20, 'army%': 10 } }],
  ['civic_rites', 'Civic Rites', 'vita', 1, null, { bld: 'monument', mods: { 'unity%': 5 } }],
  ['gene_clinic', 'Gene Clinics', 'vita', 2, 'genome_mapping', { bld: 'clinic' }],
  ['adaptive_biomes', 'Adaptive Biomes', 'vita', 2, 'xeno_eco', { mods: { 'hab+': 10 } }],
  ['assault_legions', 'Assault Legions', 'vita', 2, 'militia', { army: 'shock' }],
  ['gene_archive', 'Gene Archives', 'vita', 2, null, { bld: 'genelab' }],
  ['cultural_archives', 'Cultural Archives', 'vita', 2, null, { mods: { 'unity%': 15 } }],
  ['nutrient_synth', 'Nutrient Synthesis', 'vita', 2, 'soil_eng', { mods: { 'popFood%': -10, 'food%': 5 } }],
  ['civic_pedagogy', 'Civic Pedagogy', 'vita', 2, null, { mods: { 'stability+': 3 } }],
  ['biome_sculpt', 'Biome Sculpting', 'vita', 3, 'adaptive_biomes', { mods: { 'hab+': 10 } }],
  ['food_processing', 'Food Processing', 'vita', 3, 'nutrient_synth', { bld: 'processing' }],
  ['clone_vats', 'Clone Vats', 'vita', 3, 'gene_clinic', { mods: { 'growth%': 25 } }],
  ['choir', 'Resonant Choirs', 'vita', 3, 'cultural_archives', { mods: { 'unity%': 15, 'stability+': 3 } }],
  ['neural_pedagogy', 'Neural Pedagogy', 'vita', 3, null, { mods: { 'research%': 5, 'amen%': 10 } }],
  ['arcology', 'Arcology Spires', 'vita', 4, null, { bld: 'arcology' }],
  ['longevity', 'Longevity Therapy', 'vita', 4, 'clone_vats', { mods: { 'stability+': 5, 'growth%': 10 } }],
  ['gene_legions', 'Gene-Forged Legions', 'vita', 4, 'assault_legions', { army: 'gene', mods: { 'armyHp%': 30 } }],
  ['empathic_diplomacy', 'Empathic Diplomacy', 'vita', 4, null, { mods: { 'opinion+': 20, 'influence+': 1 } }],
  ['ascended_bio', 'Ascended Biology', 'vita', 5, null, { mods: { 'energy%': 5, 'minerals%': 5, 'food%': 5, 'alloys%': 5, 'goods%': 5 } }],
  ['living_hulls', 'Living Hulls', 'vita', 5, null, { mods: { 'repair+': 1, 'hull%': 10 } }],
  ['communion', 'Communion of Minds', 'vita', 5, 'choir', { mods: { 'unity%': 25, 'edicts+': 1 } }],
  // ---- Forge ----
  ['lancer_hull', 'Lancer Frames', 'forge', 1, null, { hull: 'lancer' }],
  ['keep_starbase', 'Keep Starbases', 'forge', 1, null, { sb: 1 }],
  ['deep_mining', 'Deep Core Mining', 'forge', 1, null, { mods: { 'minerals%': 10 } }],
  ['dart', 'Dart Missiles', 'forge', 1, null, { comp: 'dart' }],
  ['duralloy', 'Duralloy Plating', 'forge', 1, null, { comp: 'duralloy' }],
  ['foundry_auto', 'Foundry Automation', 'forge', 1, null, { mods: { 'alloys%': 10 } }],
  ['proving_grounds', 'Proving Grounds', 'forge', 1, null, { bld: 'proving' }],
  ['rail', 'Rail Drivers', 'forge', 2, null, { comp: 'rail' }],
  ['hunter', 'Hunter Swarms', 'forge', 2, 'dart', { comp: 'hunter' }],
  ['warden_hull', 'Warden Frames', 'forge', 2, 'lancer_hull', { hull: 'warden' }],
  ['mineral_refining', 'Mineral Refining', 'forge', 2, 'deep_mining', { bld: 'refinery' }],
  ['citadel_starbase', 'Citadel Starbases', 'forge', 2, 'keep_starbase', { sb: 2 }],
  ['thrusters', 'Vector Thrusters', 'forge', 2, null, { comp: 'thruster' }],
  ['workshop_auto', 'Workshop Automation', 'forge', 2, null, { mods: { 'goods%': 15 } }],
  ['gauss', 'Gauss Lances', 'forge', 3, 'rail', { comp: 'gauss' }],
  ['monarch_hull', 'Monarch Frames', 'forge', 3, 'warden_hull', { hull: 'monarch' }],
  ['neutron_weave', 'Neutron Weave', 'forge', 3, 'duralloy', { comp: 'neutron' }],
  ['alloy_crucible', 'Alloy Crucibles', 'forge', 3, 'foundry_auto', { bld: 'crucible' }],
  ['torpedo', 'Star Torpedoes', 'forge', 3, 'hunter', { comp: 'torpedo' }],
  ['bastion_starbase', 'Bastion Starbases', 'forge', 3, 'citadel_starbase', { sb: 3 }],
  ['repair_drones', 'Repair Drones', 'forge', 3, null, { comp: 'repair' }],
  ['fleet_doctrine', 'Fleet Doctrine', 'forge', 3, null, { bld: 'admiralty', mods: { 'cmd+': 4 } }],
  ['collapsar', 'Collapsar Drivers', 'forge', 4, 'gauss', { comp: 'collapsar' }],
  ['void_armor', 'Void Plating', 'forge', 4, 'neutron_weave', { comp: 'voidplate' }],
  ['fleet_logistics', 'Fleet Logistics', 'forge', 4, null, { mods: { 'naval+': 15, 'cmd+': 6 } }],
  ['targeting', 'Targeting Lattices', 'forge', 4, null, { comp: 'targeting' }],
  ['orbital_works', 'Orbital Foundries', 'forge', 4, null, { mods: { 'shipCost%': -10, 'buildSpeed%': 15 } }],
  ['wake_forge', 'Wake Forges', 'forge', 5, 'alloy_crucible', { mods: { 'alloys%': 20 } }],
  ['paragon_frames', 'Paragon Frames', 'forge', 5, 'monarch_hull', { mods: { 'hull%': 20 } }],
  ['starlance', 'Starlance Batteries', 'forge', 5, null, { mods: { 'sbDef%': 30, 'fleetDmg%': 5 } }],
];
var TECHS = {};
for (const [id, name, stream, tier, pre, un] of TECH_LIST) TECHS[id] = { id, name, stream, tier, pre, un };
// hidden techs granted by events only
TECHS.precursor_lance = { id: 'precursor_lance', name: 'Precursor Lances', stream: 'lumen', tier: 0, pre: null, un: { comp: 'precursor' }, hidden: true };
TECHS.leviathan_bond = { id: 'leviathan_bond', name: 'Leviathan Bond', stream: 'vita', tier: 0, pre: null, un: { mods: { 'hull%': 5 } }, hidden: true };
var START_TECHS = ['slug', 'ceramite', 'booster', 'picket_hull'];
for (const id of START_TECHS) TECHS[id] = { id, name: { slug: 'Slug Throwers', ceramite: 'Ceramite Plating', booster: 'Ion Boosters', picket_hull: 'Picket Frames' }[id], stream: 'forge', tier: 0, pre: null, un: { comp: id === 'picket_hull' ? null : id, hull: id === 'picket_hull' ? 'picket' : null }, hidden: true };
var REPEATABLE = { lumen: { name: 'Lumen Refinements', mods: { 'lumen%': 4, 'shield%': 3 } }, vita: { name: 'Vita Refinements', mods: { 'vita%': 4, 'growth%': 3 } }, forge: { name: 'Forge Refinements', mods: { 'forge%': 4, 'hull%': 3 } } };

function techDesc(t) {
  const u = t.un, parts = [];
  if (u.bld) parts.push('Building: ' + BUILDINGS[u.bld].name);
  if (u.comp) parts.push('Component: ' + COMPS[u.comp].name);
  if (u.hull) parts.push('Hull: ' + HULLS[u.hull].name);
  if (u.sb) parts.push('Starbase: ' + SB_LEVELS[u.sb].name);
  if (u.army) parts.push('Army: ' + ARMIES[u.army].name);
  if (u.flag === 'beacons') parts.push('Lets Wake Beacons be attuned (Beacon victory)');
  if (u.mods) parts.push(modsText(u.mods));
  return parts.join(' · ');
}
var MOD_NAMES = {
  'energy%': '% energy', 'minerals%': '% minerals', 'food%': '% food', 'alloys%': '% alloys', 'goods%': '% goods', 'unity%': '% unity',
  'lumen%': '% lumen', 'vita%': '% vita', 'forge%': '% forge', 'research%': '% research', 'influence+': ' influence/month', 'growth%': '% pop growth',
  'hab+': '% habitability', 'stability+': ' stability', 'amen%': '% amenities', 'army%': '% army damage', 'armyHp%': '% army health',
  'fleetDmg%': '% weapon damage', 'hull%': '% ship hull', 'shield%': '% shields', 'armor%': '% armor', 'evasion+': ' evasion', 'speed%': '% ship speed',
  'cmd+': ' fleet command', 'naval+': ' naval capacity', 'outpostCost%': '% outpost cost', 'shipCost%': '% ship cost', 'buildSpeed%': '% build speed',
  'buildCost%': '% build cost', 'surveySpeed%': '% survey speed', 'sbDef%': '% starbase strength', 'opinion+': ' opinion', 'popFood%': '% food eaten',
  'popGoods%': '% goods upkeep', 'edicts+': ' edict slot', 'techCost%': '% tech cost', 'tradCost%': '% tradition cost', 'colonySpeed%': '% colony speed',
  'sprawl+': ' admin capacity', 'anomaly%': '% anomaly chance', 'exhaust%': '% war exhaustion', 'repair+': '% hull repair/day', 'fort+': ' fortification', 'sbCap+': ' starbase capacity',
};
function modsText(m) {
  return Object.keys(m).map(k => (m[k] > 0 ? '+' : '') + m[k] + (MOD_NAMES[k] || ' ' + k)).join(', ');
}
