// ===== tech.js : research fields, 56 techs, 12 breakthroughs =====
const FIELDS = {
  bio: { name: 'Biotech', color: '#8fdc6a', icon: '❀' },
  eng: { name: 'Engineering', color: '#ffb35c', icon: '⚒' },
  robo: { name: 'Robotics', color: '#6fd0ff', icon: '⚙' },
  phys: { name: 'Physics', color: '#b48cff', icon: '⚛' },
  soc: { name: 'Social', color: '#ff8fb0', icon: '☺' },
};
const TECH_COST = t => Math.round(110 * Math.pow(1.42, t - 1) / 5) * 5;
const TECH_LIST = [
  // Biotech
  ['microbes', 'bio', 'Soil Microbiomes', {}, { farm: 0.15 }, 'Farms grow 15% more.'],
  ['algae', 'bio', 'Algae Cultures', { unlock: ['algae'] }, {}, 'Algae Reactors: oxygen and a little food.'],
  ['bloom', 'bio', 'Pale Bloom Domestication', { unlock: ['bloomfarm'] }, {}, 'Bloom Gardens on native spore beds.'],
  ['nutrition', 'bio', 'Closed-Loop Nutrition', {}, { foodUse: -0.15 }, 'Colonists eat 15% less.'],
  ['vertical', 'bio', 'Vertical Farming', { unlock: ['vfarm'] }, {}, 'Vertical Farm dome module.'],
  ['medicine', 'bio', 'Regenerative Medicine', { unlock: ['medcenter'] }, { health: 0.1 }, 'Medical Center module; faster healing.'],
  ['geneedit', 'bio', 'Crop Gene Editing', {}, { farm: 0.3 }, 'Farms grow 30% more.'],
  ['adaptive', 'bio', 'Adaptive Physiology', {}, { o2Use: -0.15, health: 0.1 }, 'Colonists breathe 15% less oxygen and heal faster.'],
  ['longevity', 'bio', 'Telomere Therapy', {}, { oldAge: 10, health: 0.1 }, 'Colonists live 10 years longer.'],
  ['biosphere', 'bio', 'Pocket Biospheres', {}, { domeAir: -0.5, comfort: 5 }, 'Domes need half the base oxygen and water; +5 comfort.'],
  ['genome', 'bio', 'Kessan Genome', {}, { birth: 0.3, sanity: 0.05 }, 'Native-born colonists are Resilient; +30% births.'],
  // Engineering
  ['sintering', 'eng', 'Hot Sintering', {}, { sinter: 0.3 }, 'Sinterers make 30% more.'],
  ['polychem', 'eng', 'Polymer Chemistry', { unlock: ['polymer'] }, {}, 'Polymer Plant.'],
  ['vaultdome', 'eng', 'Vault Domes', { unlock: ['dome_m'] }, {}, 'Vault Dome: 12 module slots.'],
  ['thermal', 'eng', 'Thermal Beacons', { unlock: ['heater'] }, { coldRes: 0.25 }, 'Thermal Beacon; buildings resist cold a little.'],
  ['reclaim', 'eng', 'Water Reclamation', { unlock: ['reclaimer'] }, {}, 'Water Reclaimer.'],
  ['stacking', 'eng', 'Stacked Housing', { unlock: ['apartments'] }, {}, 'Stacked Apartments module.'],
  ['seals', 'eng', 'Dust-Proof Seals', {}, { maint: -0.2 }, 'Upkeep 20% slower.'],
  ['canopy', 'eng', 'Canopy Domes', { unlock: ['dome_l'], req: ['stacking'] }, {}, 'Canopy Dome: 22 module slots.'],
  ['leanfab', 'eng', 'Lean Fabrication', {}, { factory: 0.25, buildCost: -0.1 }, 'Factories +25%; buildings cost 10% less.'],
  ['arcology', 'eng', 'Arcology Design', {}, { domeSlots: 2 }, 'Every dome gains 2 module slots.'],
  ['selfheal', 'eng', 'Self-Healing Alloys', {}, { maint: -0.25, lineFault: -0.5 }, 'Upkeep 25% slower; half as many grid faults.'],
  // Robotics
  ['swarm', 'robo', 'Swarm Coordination', {}, { drone: 0.25 }, 'Drones work 25% faster.'],
  ['dronefab', 'robo', 'Drone Fabrication', { unlock: ['assembler'] }, {}, 'Drone Assembler.'],
  ['uplink', 'robo', 'Long-Range Uplinks', {}, { hubRange: 2 }, 'Drone hubs reach 2 tiles farther.'],
  ['automine', 'robo', 'Autonomous Extraction', { unlock: ['automine'], req: ['circuits'] }, {}, 'Auto-Extractor needs no crew.'],
  ['heavycrawler', 'robo', 'Heavy Crawlers', {}, { crawler: 3, vehicleSpeed: 0.3 }, 'Crawlers carry 3 more drones; vehicles 30% faster.'],
  ['hiveracks', 'robo', 'Hive Racks', {}, { droneCap: 6 }, 'Drone hubs hold 6 more drones.'],
  ['autolines', 'robo', 'Automated Lines', {}, { jobReduce: 1, factory: 0.1 }, 'Workplaces need one fewer worker per shift.'],
  ['staticbrush', 'robo', 'Electrostatic Shedding', { unlock: ['brush'] }, { dustWear: -0.2 }, 'Static Brush Tower; dust storms wear less.'],
  ['overseer', 'robo', 'Overseer AI', {}, { drone: 0.3, research: 0.1 }, 'Drones +30%; research +10%.'],
  ['nanoasm', 'robo', 'Nano-Assembly', {}, { build: 0.5, factory: 0.2 }, 'Construction +50%; factories +20%.'],
  ['swarmmind', 'robo', 'Swarm Mind', {}, { drone: 0.5, maint: -0.15 }, 'Drones +50%; upkeep 15% slower.'],
  // Physics
  ['photovolt', 'phys', 'Dust-Tolerant Photovoltaics', {}, { solar: 0.2, solarDust: 0.3 }, 'Solar +20% and loses less in dust.'],
  ['circuits', 'phys', 'Circuit Lithography', { unlock: ['foundry'], req: ['polychem'] }, {}, 'Circuit Foundry.'],
  ['meteorology', 'phys', 'Atmospheric Modelling', { unlock: ['observatory'] }, { warn: 0.3 }, 'Storm Observatory; longer disaster warnings.'],
  ['thinfilm', 'phys', 'Thin-Film Solar', { unlock: ['thinfilm'] }, {}, 'Thin-Film Field.'],
  ['deepsound', 'phys', 'Deep Sounding', {}, { deep: 1 }, 'Reveals deep ore in every surveyed sector.'],
  ['institute', 'phys', 'Applied Theory', { unlock: ['institute'] }, { research: 0.1 }, 'Deep Institute; research +10%.'],
  ['isotope', 'phys', 'Isotope Power', { unlock: ['reactor'] }, {}, 'Isotope Reactor.'],
  ['lance', 'phys', 'Pulsed Lasers', { unlock: ['lance'] }, {}, 'Meteor Lance.'],
  ['kessite', 'phys', 'Kessite Resonance', { unlock: ['harvester'] }, { export: 0.15 }, 'Kessite Harvester; exports +15%.'],
  ['piezo', 'phys', 'Piezo Lattices', { unlock: ['cell'] }, {}, 'Crystal Cell.'],
  ['supercond', 'phys', 'Warm Superconductors', {}, { powerUse: -0.15, battery: 0.5 }, 'Power use -15%; batteries +50%.'],
  ['massdriver', 'phys', 'Orbital Mass Driver', {}, { rocketCost: -0.25, rocketCap: 20, rocketTime: -0.3 }, 'Cheaper, bigger, faster rockets.'],
  // Social
  ['schooling', 'soc', 'Frontier Pedagogy', { unlock: ['school'] }, {}, 'School module.'],
  ['commerce', 'soc', 'Frontier Commerce', { unlock: ['market'] }, { funding: 0.1 }, 'Market Hall; stipend +10%.'],
  ['family', 'soc', 'Family Programs', { unlock: ['nursery'] }, { birth: 0.2 }, 'Nursery module; +20% births.'],
  ['holo', 'soc', 'Holo Entertainment', { unlock: ['arcade'] }, {}, 'Holo Arcade module.'],
  ['shiftpsy', 'soc', 'Shift Psychology', {}, { nightShift: -0.5, morale: 5 }, 'Night shifts half as draining; +5 morale.'],
  ['spa', 'soc', 'Thermal Spas', { unlock: ['spa'] }, {}, 'Thermal Spa module.'],
  ['suites', 'soc', 'Garden Architecture', { unlock: ['suites'] }, {}, 'Garden Suites module.'],
  ['media', 'soc', 'Colony Media', {}, { funding: 0.2, homesick: -0.3 }, 'Stipend +20%; fewer homesick colonists.'],
  ['civics', 'soc', 'Civic Councils', {}, { morale: 10, comfort: 5 }, '+10 morale, +5 comfort.'],
  ['charter', 'soc', 'Charter of Kessa', { unlock: ['spire'], req: ['canopy'] }, {}, 'Charter Spire: the path to Independence.'],
  ['identity', 'soc', 'Kessan Identity', {}, { homesick: -0.8, morale: 5 }, 'Colonists rarely want to leave.'],
];
const TECHS = {};
{
  const tierOf = {};
  for (const [id, field, name, opt, mods, desc] of TECH_LIST) {
    tierOf[field] = (tierOf[field] || 0) + 1;
    const tier = tierOf[field];
    TECHS[id] = { id, field, name, tier, cost: TECH_COST(tier), unlock: opt.unlock || [], req: opt.req || [], mods, desc };
  }
  // within a field, each tech needs the one before it
  const byField = {};
  for (const t of Object.values(TECHS)) (byField[t.field] = byField[t.field] || []).push(t);
  for (const list of Object.values(byField)) for (let i = 1; i < list.length; i++) list[i].req = [list[i - 1].id, ...list[i].req];
}
const BREAKTHROUGHS = {
  bt_flux: { name: 'Flux-Core Drones', mods: { drone: 0.4 }, desc: 'Drones work 40% faster.' },
  bt_frostglass: { name: 'Frostglass', mods: { domeCost: -0.3 }, desc: 'Domes cost 30% less.' },
  bt_lichen: { name: 'Lichen Symbiosis', mods: { oxygen: 0.25 }, desc: 'Oxygen production +25%.' },
  bt_damping: { name: 'Seismic Damping', mods: { quake: -0.8 }, desc: 'Quakes do 80% less damage.' },
  bt_hum: { name: 'The Wardens\' Hum', mods: { research: 0.25 }, desc: 'Research +25%, decoded from the basalt Wardens.' },
  bt_umbrella: { name: 'Magnetic Umbrella', mods: { meteor: -0.6 }, desc: 'Meteors do 60% less damage.' },
  bt_dustsail: { name: 'Dust Sails', mods: { wind: 0.6 }, desc: 'Wind Masts +60%.' },
  bt_somnic: { name: 'Somnic Rest', mods: { sanity: 0.1, nightShift: -0.5 }, desc: 'Better sleep: sanity recovers faster.' },
  bt_mantle: { name: 'Mantle Taps', mods: { mine: 0.3 }, desc: 'Extractors +30%.' },
  bt_cryo: { name: 'Cryo Stasis Pods', mods: { arkSize: 4, arkCost: -0.2 }, desc: 'Arks carry 4 more colonists for 20% less.' },
  bt_hydrogel: { name: 'Hydrogel Soils', mods: { farm: 0.3 }, desc: 'Farms +30%.' },
  bt_printed: { name: 'Printed Circuits', mods: { electronics: 0.5 }, desc: 'Electronics output +50%.' },
};
for (const [id, b] of Object.entries(BREAKTHROUGHS)) { b.id = id; b.field = 'bt'; b.tier = 0; b.cost = 650; b.unlock = []; b.req = []; b.breakthrough = true; TECHS[id] = b; }
FIELDS.bt = { name: 'Breakthroughs', color: '#ffd84a', icon: '✸' };

const ANOMALIES = {
  signal: { name: 'Repeating Signal', desc: 'A faint radio pulse from beneath the dust.' },
  cache: { name: 'Buried Cache', desc: 'Radar shows a dense, regular object.' },
  warden: { name: 'Basalt Warden', desc: 'A lone pillar of glassy basalt that hums at dusk.' },
  bloom: { name: 'Fossil Bloom Bed', desc: 'Pale fossil filaments in a shallow crater.' },
  wreck: { name: 'Probe Wreckage', desc: 'An early survey probe, crashed decades ago.' },
  vent: { name: 'Warm Vent', desc: 'A fissure measurably warmer than its surroundings.' },
};
Object.assign(KC, { FIELDS, TECHS, BREAKTHROUGHS, ANOMALIES });
