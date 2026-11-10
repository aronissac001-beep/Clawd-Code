// ===== shipdata.js : hulls, components, armies, starbases =====
var HULLS = {
  picket: { name: 'Picket', size: 1, slots: { w: 2, d: 1, u: 1 }, hull: 220, evasion: 35, speed: 1.0, cost: 35, days: 60, desc: 'Fast, evasive escort' },
  lancer: { name: 'Lancer', size: 2, slots: { w: 3, d: 2, u: 1 }, hull: 520, evasion: 20, speed: 0.92, cost: 80, days: 100, desc: 'Line skirmisher' },
  warden: { name: 'Warden', size: 4, slots: { w: 4, d: 3, u: 2 }, hull: 1250, evasion: 9, speed: 0.85, cost: 180, days: 160, desc: 'Heavy line ship' },
  monarch: { name: 'Monarch', size: 8, slots: { w: 6, d: 5, u: 2 }, hull: 3100, evasion: 3, speed: 0.78, cost: 420, days: 240, desc: 'Capital ship' },
  // civilian hulls
  surveyor: { name: 'Surveyor', civ: true, size: 0, hull: 150, evasion: 40, speed: 1.35, cost: 0, mcost: 100, days: 60, desc: 'Surveys systems and studies anomalies' },
  builder: { name: 'Constructor', civ: true, size: 0, hull: 150, evasion: 20, speed: 1.1, cost: 0, mcost: 100, days: 60, desc: 'Builds outposts and stations' },
  colony: { name: 'Colony Ark', civ: true, size: 0, hull: 300, evasion: 10, speed: 0.9, cost: 0, mcost: 300, fcost: 100, days: 220, desc: 'Founds a colony on a habitable planet' },
};
var HULL_KEYS = ['picket', 'lancer', 'warden', 'monarch'];
var DEF_SCALE = { 1: 1, 2: 1.5, 4: 2.6, 8: 4.4 };
var WPN_SCALE = { 1: 1, 2: 1.1, 4: 1.3, 8: 1.6 };
// type: kin(etic) beam mis(sile); dmg per day of combat
var COMPS = {
  slug: { name: 'Slug Thrower', slot: 'w', type: 'kin', dmg: 9, acc: 80, cost: 4, tier: 1 },
  rail: { name: 'Rail Driver', slot: 'w', type: 'kin', dmg: 14, acc: 80, cost: 8, tier: 2 },
  gauss: { name: 'Gauss Lance', slot: 'w', type: 'kin', dmg: 21, acc: 82, cost: 12, tier: 3 },
  collapsar: { name: 'Collapsar Driver', slot: 'w', type: 'kin', dmg: 30, acc: 84, cost: 18, tier: 4 },
  photon: { name: 'Photon Cutter', slot: 'w', type: 'beam', dmg: 10, acc: 85, cost: 5, tier: 1 },
  lumenlance: { name: 'Lumen Lance', slot: 'w', type: 'beam', dmg: 15, acc: 85, cost: 9, tier: 2 },
  prism: { name: 'Prism Ray', slot: 'w', type: 'beam', dmg: 23, acc: 86, cost: 13, tier: 3 },
  nova: { name: 'Nova Beam', slot: 'w', type: 'beam', dmg: 32, acc: 88, cost: 19, tier: 4 },
  dart: { name: 'Dart Missile', slot: 'w', type: 'mis', dmg: 12, acc: 100, cost: 5, tier: 1 },
  hunter: { name: 'Hunter Swarm', slot: 'w', type: 'mis', dmg: 19, acc: 100, cost: 9, tier: 2 },
  torpedo: { name: 'Star Torpedo', slot: 'w', type: 'mis', dmg: 29, acc: 100, cost: 14, tier: 3 },
  precursor: { name: 'Precursor Lance', slot: 'w', type: 'beam', dmg: 38, acc: 92, cost: 16, tier: 5 },
  ceramite: { name: 'Ceramite Plating', slot: 'd', armor: 60, cost: 4, tier: 1 },
  duralloy: { name: 'Duralloy Plating', slot: 'd', armor: 100, cost: 7, tier: 2 },
  neutron: { name: 'Neutron Weave', slot: 'd', armor: 150, cost: 11, tier: 3 },
  voidplate: { name: 'Void Plating', slot: 'd', armor: 220, cost: 16, tier: 4 },
  veil1: { name: 'Deflector Veil', slot: 'd', shield: 55, cost: 5, tier: 1 },
  veil2: { name: 'Aegis Veil', slot: 'd', shield: 90, cost: 8, tier: 2 },
  veil3: { name: 'Halo Veil', slot: 'd', shield: 135, cost: 12, tier: 3 },
  veil4: { name: 'Eclipse Veil', slot: 'd', shield: 195, cost: 17, tier: 4 },
  booster: { name: 'Ion Boosters', slot: 'u', evasion: 5, cost: 3, tier: 1 },
  thruster: { name: 'Vector Thrusters', slot: 'u', evasion: 10, speed: 0.1, cost: 6, tier: 2 },
  pd: { name: 'Intercept Lattice', slot: 'u', pd: 0.35, cost: 8, tier: 3 },
  repair: { name: 'Repair Drones', slot: 'u', repair: 1.5, cost: 8, tier: 3 },
  targeting: { name: 'Targeting Lattice', slot: 'u', acc: 10, cost: 10, tier: 4 },
};
// damage multipliers: [vs shield, vs armor, vs hull]
var DMG_VS = { kin: [1.5, 0.7, 1], beam: [0.7, 1.5, 1], mis: [1, 1, 1.25] };
var ARMIES = {
  legion: { name: 'Legion', hp: 180, dmg: 18, cost: { minerals: 80 }, days: 90 },
  shock: { name: 'Shock Legion', hp: 260, dmg: 28, cost: { minerals: 120 }, days: 100, tech: 'assault_legions' },
  gene: { name: 'Gene-Forged Legion', hp: 420, dmg: 42, cost: { minerals: 180, food: 40 }, days: 120, tech: 'gene_legions' },
};
var DEF_ARMY = { hp: 150, dmg: 14 };
var SB_LEVELS = [
  { name: 'Outpost', hull: 500, shield: 0, dmg: 0, slots: 0, cost: {}, days: 0, upkeep: 0.3 },
  { name: 'Keep', hull: 2600, shield: 700, dmg: 45, slots: 2, cost: { alloys: 150 }, days: 240, upkeep: 2 },
  { name: 'Citadel', hull: 6500, shield: 1600, dmg: 110, slots: 4, cost: { alloys: 400 }, days: 360, upkeep: 3.5 },
  { name: 'Bastion', hull: 13000, shield: 3200, dmg: 240, slots: 6, cost: { alloys: 900 }, days: 480, upkeep: 5 },
];
var SB_MODULES = {
  shipyard: { name: 'Shipyard', cost: { alloys: 80 }, days: 120, desc: 'Builds ships. Each shipyard builds one ship at a time.' },
  anchorage: { name: 'Anchorage', cost: { alloys: 60 }, days: 100, naval: 4, desc: '+4 naval capacity' },
  tradehub: { name: 'Trade Hub', cost: { alloys: 60 }, days: 100, energy: 4, desc: '+4 energy per month' },
  battery: { name: 'Gun Battery', cost: { alloys: 100 }, days: 140, dmg: 40, hull: 1500, desc: '+40 damage, +1500 hull' },
  drydock: { name: 'Repair Dock', cost: { alloys: 80 }, days: 120, repair: 5, desc: 'Friendly ships here repair 5% hull per day' },
};
// monsters and the crisis use fixed designs
var MONSTERS = {
  voidmoth: { name: 'Voidmoth Swarm', hull: 450, armor: 0, shield: 0, evasion: 30, dmg: 14, type: 'mis', speed: 0.8, size: 2, reward: { vita: 60 } },
  crystal: { name: 'Crystal Tender', hull: 1400, armor: 300, shield: 0, evasion: 0, dmg: 30, type: 'beam', speed: 0, size: 4, reward: { minerals: 250, forge: 80 } },
  warden_ai: { name: 'The Old Sentinel', hull: 16000, armor: 3000, shield: 3000, evasion: 0, dmg: 260, type: 'beam', speed: 0, size: 30, reward: { lumen: 900, forge: 900, alloys: 300 } },
  stormmother: { name: 'Mother of Storms', hull: 11000, armor: 0, shield: 5000, evasion: 10, dmg: 190, type: 'kin', speed: 0, size: 24, reward: { vita: 900, lumen: 600, energy: 500 } },
  scavenger: { name: 'Scavenger Raider', hull: 380, armor: 80, shield: 40, evasion: 20, dmg: 13, type: 'kin', speed: 1, size: 2, reward: { alloys: 40 } },
  leviathan: { name: 'Tamed Starwhale', hull: 4200, armor: 500, shield: 600, evasion: 5, dmg: 85, type: 'beam', speed: 0.9, size: 0, reward: {} },
  hollow_drone: { name: 'Hollow Drone', hull: 900, armor: 250, shield: 250, evasion: 15, dmg: 32, type: 'beam', speed: 1.0, size: 3, reward: { lumen: 40, forge: 40 } },
  hollow_reaver: { name: 'Hollow Reaver', hull: 3600, armor: 900, shield: 700, evasion: 5, dmg: 100, type: 'kin', speed: 0.9, size: 8, reward: { lumen: 120, forge: 120 } },
  hollow_spire: { name: 'Hollow Spire', hull: 40000, armor: 6000, shield: 6000, evasion: 0, dmg: 380, type: 'beam', speed: 0, size: 60, reward: { lumen: 1500, vita: 1500, forge: 1500 } },
};
