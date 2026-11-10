// ===== combatdata.js : unit lines with affinity upgrades, fauna, satellites, promotions, defenses =====
// cls: melee | ranged | mounted | siege | recon | naval_melee | naval_ranged (civilians have no cls)
// str = melee strength (also defense), rstr = ranged attack strength, range in tiles.
// Each line has a first tier for everyone, then a second and third tier that split by affinity:
// Communion units are grown (Chitin), Lattice units are built (Lumenite), Lineage units are trained and armored (Ferrite).
const LINES = {
  infantry: { name: 'Infantry', t1: 'militia', t2: { tech: 'combat_doctrine', lvl: 3, communion: 'thornguard', lattice: 'servitor', lineage: 'vanguard' }, t3: { tech: 'plasma_weapons', lvl: 7, communion: 'sporewarden', lattice: 'exo_legion', lineage: 'paladin' } },
  ranged: { name: 'Ranged', t1: 'skirmisher', t2: { tech: 'combat_doctrine', lvl: 3, communion: 'spineflinger', lattice: 'railgunner', lineage: 'longwatch' }, t3: { tech: 'plasma_weapons', lvl: 7, communion: 'bloomcaller', lattice: 'arc_lancer', lineage: 'sentinel_corps' } },
  mobile: { name: 'Mobile', t1: 'rover', t2: { tech: 'exo_tactics', lvl: 3, communion: 'wildrunner', lattice: 'hover_lancer', lineage: 'dragoon' }, t3: { tech: 'gravitic_armor', lvl: 7, communion: 'stormback', lattice: 'phase_skimmer', lineage: 'cuirassier' } },
  siege: { name: 'Siege', t1: 'mortar', t2: { tech: 'heavy_alloys', lvl: 3, communion: 'spore_mortar', lattice: 'mass_driver', lineage: 'howitzer' }, t3: { tech: 'siege_engines', lvl: 7, communion: 'gravemaw', lattice: 'breaker', lineage: 'citadel_gun' } },
  navy: { name: 'Navy', t1: 'skiff', t2: { tech: 'hydrodynamics', lvl: 3, communion: 'reef_stalker', lattice: 'hydrofoil', lineage: 'cutter' }, t3: { tech: 'deep_ocean', lvl: 7, communion: 'tide_kraken', lattice: 'aegis_hull', lineage: 'dreadnought' } },
  fleet: { name: 'Fleet', t1: 'gunboat', t2: { tech: 'hydrodynamics', lvl: 3, communion: 'spine_barge', lattice: 'rail_frigate', lineage: 'missile_cruiser' }, t3: { tech: 'deep_ocean', lvl: 7, communion: 'abyssal_siren', lattice: 'arc_carrier', lineage: 'battleship' } },
};
const AFF_RES = { communion: 'chitin', lattice: 'lumenite', lineage: 'ferrite' };
const MIL = {
  militia: { name: 'Marine', cls: 'melee', str: 10, moves: 2, cost: 30, glyph: '🪖', line: 'infantry', tier: 1 },
  scout: { name: 'Explorer', cls: 'recon', str: 4, moves: 3, cost: 25, glyph: '🧭' },
  skirmisher: { name: 'Skirmisher', cls: 'ranged', str: 6, rstr: 9, range: 2, moves: 2, cost: 42, tech: 'ballistics', glyph: '🔫', line: 'ranged', tier: 1 },
  rover: { name: 'Rover', cls: 'mounted', str: 13, moves: 4, cost: 55, tech: 'mobile_warfare', res: 'chitin', glyph: '🚙', line: 'mobile', tier: 1 },
  mortar: { name: 'Mortar Crawler', cls: 'siege', str: 7, rstr: 15, range: 2, moves: 2, cost: 72, tech: 'artillery', glyph: '💥', line: 'siege', tier: 1 },
  skiff: { name: 'Patrol Skiff', cls: 'naval_melee', str: 10, moves: 3, cost: 45, tech: 'marine_tech', coastOnly: true, glyph: '🚤', line: 'navy', tier: 1 },
  gunboat: { name: 'Gunboat', cls: 'naval_ranged', str: 8, rstr: 12, range: 2, moves: 3, cost: 60, tech: 'tidal_power', coastOnly: true, glyph: '⛴️', line: 'fleet', tier: 1 },
  // tier 2
  thornguard: { name: 'Thornguard', cls: 'melee', str: 21, moves: 2, cost: 72, veilHeal: 10, glyph: '🌵', aff: 'communion', line: 'infantry', tier: 2, note: 'Heals 10 more on Veil tiles.' },
  servitor: { name: 'Servitor Frame', cls: 'melee', str: 23, moves: 2, cost: 78, healBonus: 5, glyph: '🦾', aff: 'lattice', line: 'infantry', tier: 2, note: 'Self-repairing: heals 5 more each turn.' },
  vanguard: { name: 'Vanguard', cls: 'melee', str: 22, moves: 2, cost: 75, homeDef: 15, glyph: '🛡️', aff: 'lineage', line: 'infantry', tier: 2, note: '+15% defense in your territory.' },
  spineflinger: { name: 'Spineflinger', cls: 'ranged', str: 11, rstr: 18, range: 2, moves: 2, cost: 80, forestWalk: true, glyph: '🦔', aff: 'communion', line: 'ranged', tier: 2, note: 'Moves through Fungal Forest freely.' },
  railgunner: { name: 'Railgunner', cls: 'ranged', str: 10, rstr: 20, range: 2, moves: 2, cost: 85, glyph: '🔫', aff: 'lattice', line: 'ranged', tier: 2 },
  longwatch: { name: 'Longwatch', cls: 'ranged', str: 13, rstr: 18, range: 2, moves: 2, cost: 82, homeDef: 15, glyph: '🎯', aff: 'lineage', line: 'ranged', tier: 2, note: '+15% defense in your territory.' },
  wildrunner: { name: 'Wildrunner', cls: 'mounted', str: 23, moves: 4, cost: 95, forestWalk: true, glyph: '🦌', aff: 'communion', line: 'mobile', tier: 2, note: 'A tamed loper herd with riders. Moves through Fungal Forest freely.' },
  hover_lancer: { name: 'Hover Lancer', cls: 'mounted', str: 24, moves: 5, cost: 100, glyph: '🛸', aff: 'lattice', line: 'mobile', tier: 2 },
  dragoon: { name: 'Dragoon', cls: 'mounted', str: 26, moves: 4, cost: 98, glyph: '🏍️', aff: 'lineage', line: 'mobile', tier: 2 },
  spore_mortar: { name: 'Spore Mortar', cls: 'siege', str: 12, rstr: 28, range: 2, moves: 2, cost: 125, glyph: '🍄', aff: 'communion', line: 'siege', tier: 2 },
  mass_driver: { name: 'Mass Driver', cls: 'siege', str: 12, rstr: 27, range: 3, moves: 2, cost: 132, glyph: '🧲', aff: 'lattice', line: 'siege', tier: 2 },
  howitzer: { name: 'Howitzer', cls: 'siege', str: 14, rstr: 30, range: 2, moves: 2, cost: 128, glyph: '💣', aff: 'lineage', line: 'siege', tier: 2 },
  reef_stalker: { name: 'Reef Stalker', cls: 'naval_melee', str: 20, moves: 4, cost: 85, glyph: '🦈', aff: 'communion', line: 'navy', tier: 2 },
  hydrofoil: { name: 'Hydrofoil', cls: 'naval_melee', str: 20, moves: 5, cost: 90, glyph: '🚤', aff: 'lattice', line: 'navy', tier: 2 },
  cutter: { name: 'Cutter', cls: 'naval_melee', str: 23, moves: 4, cost: 88, glyph: '🛥️', aff: 'lineage', line: 'navy', tier: 2 },
  spine_barge: { name: 'Spine Barge', cls: 'naval_ranged', str: 14, rstr: 24, range: 2, moves: 4, cost: 105, glyph: '🐡', aff: 'communion', line: 'fleet', tier: 2 },
  rail_frigate: { name: 'Rail Frigate', cls: 'naval_ranged', str: 13, rstr: 26, range: 2, moves: 5, cost: 110, glyph: '🚢', aff: 'lattice', line: 'fleet', tier: 2 },
  missile_cruiser: { name: 'Missile Cruiser', cls: 'naval_ranged', str: 15, rstr: 25, range: 2, moves: 4, cost: 108, glyph: '🛳️', aff: 'lineage', line: 'fleet', tier: 2 },
  // tier 3: each affinity's own strategic resource
  sporewarden: { name: 'Sporewarden', cls: 'melee', str: 40, moves: 2, cost: 160, res: 'chitin', veilHeal: 15, forestWalk: true, glyph: '🌳', aff: 'communion', line: 'infantry', tier: 3, note: 'Heals 15 more on Veil tiles; moves through Fungal Forest freely.' },
  exo_legion: { name: 'Exo Legion', cls: 'melee', str: 43, moves: 2, cost: 165, res: 'lumenite', healBonus: 10, glyph: '🤖', aff: 'lattice', line: 'infantry', tier: 3, note: 'Self-repairing: heals 10 more each turn.' },
  paladin: { name: 'Paladin Corps', cls: 'melee', str: 42, moves: 2, cost: 165, res: 'ferrite', homeDef: 25, glyph: '⚔️', aff: 'lineage', line: 'infantry', tier: 3, note: '+25% defense in your territory.' },
  bloomcaller: { name: 'Bloomcaller', cls: 'ranged', str: 20, rstr: 34, range: 2, moves: 2, cost: 170, res: 'chitin', forestWalk: true, glyph: '🌺', aff: 'communion', line: 'ranged', tier: 3 },
  arc_lancer: { name: 'Arc Lancer', cls: 'ranged', str: 18, rstr: 37, range: 2, moves: 2, cost: 175, res: 'lumenite', glyph: '⚡', aff: 'lattice', line: 'ranged', tier: 3 },
  sentinel_corps: { name: 'Sentinel Corps', cls: 'ranged', str: 23, rstr: 34, range: 2, moves: 2, cost: 172, res: 'ferrite', homeDef: 20, glyph: '🎯', aff: 'lineage', line: 'ranged', tier: 3 },
  stormback: { name: 'Stormback', cls: 'mounted', str: 46, moves: 5, cost: 190, res: 'chitin', forestWalk: true, glyph: '🦏', aff: 'communion', line: 'mobile', tier: 3 },
  phase_skimmer: { name: 'Phase Skimmer', cls: 'mounted', str: 46, moves: 6, cost: 195, res: 'lumenite', glyph: '🛸', aff: 'lattice', line: 'mobile', tier: 3 },
  cuirassier: { name: 'Cuirassier', cls: 'mounted', str: 50, moves: 4, cost: 195, res: 'ferrite', glyph: '🏍️', aff: 'lineage', line: 'mobile', tier: 3 },
  gravemaw: { name: 'Gravemaw', cls: 'siege', str: 24, rstr: 56, range: 2, moves: 2, cost: 240, res: 'chitin', glyph: '🐛', aff: 'communion', line: 'siege', tier: 3 },
  breaker: { name: 'Breaker Engine', cls: 'siege', str: 22, rstr: 57, range: 3, moves: 2, cost: 250, res: 'lumenite', glyph: '🔆', aff: 'lattice', line: 'siege', tier: 3 },
  citadel_gun: { name: 'Citadel Gun', cls: 'siege', str: 26, rstr: 60, range: 2, moves: 2, cost: 245, res: 'ferrite', glyph: '🧨', aff: 'lineage', line: 'siege', tier: 3 },
  tide_kraken: { name: 'Tide Kraken', cls: 'naval_melee', str: 44, moves: 5, cost: 170, res: 'chitin', glyph: '🐙', aff: 'communion', line: 'navy', tier: 3 },
  aegis_hull: { name: 'Aegis Hull', cls: 'naval_melee', str: 44, moves: 6, cost: 175, res: 'lumenite', glyph: '🛡️', aff: 'lattice', line: 'navy', tier: 3 },
  dreadnought: { name: 'Dreadnought', cls: 'naval_melee', str: 50, moves: 4, cost: 180, res: 'ferrite', glyph: '⚓', aff: 'lineage', line: 'navy', tier: 3 },
  abyssal_siren: { name: 'Abyssal Siren', cls: 'naval_ranged', str: 26, rstr: 50, range: 2, moves: 5, cost: 210, res: 'chitin', glyph: '🧜', aff: 'communion', line: 'fleet', tier: 3 },
  arc_carrier: { name: 'Arc Carrier', cls: 'naval_ranged', str: 24, rstr: 52, range: 3, moves: 5, cost: 215, res: 'lumenite', glyph: '🛩️', aff: 'lattice', line: 'fleet', tier: 3 },
  battleship: { name: 'Battleship', cls: 'naval_ranged', str: 30, rstr: 52, range: 2, moves: 4, cost: 215, res: 'ferrite', glyph: '🚢', aff: 'lineage', line: 'fleet', tier: 3 },
  // unique units (replaces: the first-tier unit they stand in for)
  pulse_sentry: { name: 'Pulse Sentry', cls: 'ranged', str: 7, rstr: 11, range: 3, moves: 2, cost: 42, tech: 'ballistics', glyph: '📡', civ: 'halcyon', replaces: 'skirmisher', line: 'ranged', tier: 1 },
  contract_rover: { name: 'Contract Rover', cls: 'mounted', str: 13, moves: 5, cost: 55, tech: 'mobile_warfare', res: 'chitin', glyph: '🚙', civ: 'kestrel', replaces: 'rover', goldOnKill: true, line: 'mobile', tier: 1 },
  grove_ranger: { name: 'Grove Ranger', cls: 'melee', str: 12, moves: 2, cost: 30, glyph: '🌲', civ: 'brightwater', replaces: 'militia', forestWalk: true, line: 'infantry', tier: 1 },
  legionary: { name: 'Pact Legionary', cls: 'melee', str: 13, moves: 2, cost: 32, glyph: '🪖', civ: 'ironveil', replaces: 'militia', homeDef: 25, line: 'infantry', tier: 1 },
  veil_chanter: { name: 'Veil Chanter', cls: 'ranged', str: 7, rstr: 9, range: 2, moves: 2, cost: 42, tech: 'ballistics', glyph: '🎶', civ: 'choir', replaces: 'skirmisher', forestWalk: true, healBonus: 10, line: 'ranged', tier: 1 },
  forge_crawler: { name: 'Forge Crawler', cls: 'siege', str: 11, rstr: 17, range: 3, moves: 2, cost: 72, tech: 'artillery', glyph: '🔥', civ: 'forgeborn', replaces: 'mortar', line: 'siege', tier: 1 },
  reef_lancer: { name: 'Reef Lancer', cls: 'naval_melee', str: 13, moves: 4, cost: 45, tech: 'marine_tech', coastOnly: true, glyph: '🚤', civ: 'tidecall', replaces: 'skiff', line: 'navy', tier: 1 },
  wayfinder: { name: 'Wayfinder', cls: 'recon', str: 5, moves: 4, cost: 25, glyph: '🧭', civ: 'pathfinder', replaces: 'scout', charges: 3 },
  // native fauna (never built; some can be tamed by Communion)
  skitter: { name: 'Skitterswarm', cls: 'melee', str: 7, moves: 3, cost: 25, glyph: '🦗', fauna: true, desc: 'A rolling carpet of hand-sized hunters.' },
  delver: { name: 'Delver', cls: 'melee', str: 15, moves: 2, cost: 45, glyph: '🪱', fauna: true, ignoreTerrain: true, desc: 'A burrower that erupts from below. Ignores terrain.' },
  spinemaw: { name: 'Spinemaw', cls: 'ranged', str: 9, rstr: 13, range: 2, moves: 2, cost: 45, glyph: '🦂', fauna: true, desc: 'Flings barbed quills from a distance.' },
  ravager: { name: 'Ravager', cls: 'melee', str: 27, moves: 3, cost: 90, glyph: '🐗', fauna: true, desc: 'A pack predator the size of a lander.' },
  titanoth: { name: 'Titanoth', cls: 'melee', str: 48, moves: 2, cost: 220, glyph: '🦣', fauna: true, colossus: true, ignoreTerrain: true, desc: 'A walking hill. The ground shakes for a day after it passes.' },
  tidewyrm: { name: 'Tidewyrm', cls: 'naval_melee', str: 22, moves: 4, cost: 80, glyph: '🐉', fauna: true, desc: 'A sea serpent that hunts in the shallows.' },
};
for (const k in MIL) {
  const m = MIL[k];
  UNITS[k] = Object.assign(UNITS[k] || {}, { key: k, civilian: false, sight: 2, strength: m.str }, m);
}
// tier 2 and 3 tech and level, copied onto each unit
for (const lk in LINES) for (const tk of ['t2', 't3']) { const L = LINES[lk][tk]; for (const a of ['communion', 'lattice', 'lineage']) Object.assign(UNITS[L[a]], { tech: L.tech, affLvl: L.lvl }); }
UNITS.scout.recon = true; UNITS.scout.ignoreTerrain = true; UNITS.militia.canFortify = true;
UNITS.wayfinder.recon = true; UNITS.wayfinder.ignoreTerrain = true;
for (const k in UNITS) {
  const U = UNITS[k];
  U.naval = U.cls === 'naval_melee' || U.cls === 'naval_ranged';
  U.ranged = U.cls === 'ranged' || U.cls === 'siege' || U.cls === 'naval_ranged';
  U.military = !U.civilian;
  if (U.military && U.cls !== 'recon') U.canFortify = !U.naval;
}
const BASE_UNITS = ['settler', 'builder', 'caravan', 'scout', 'militia', 'skirmisher', 'rover', 'mortar', 'skiff', 'gunboat'];
for (const lk in LINES) for (const tk of ['t2', 't3']) for (const a of ['communion', 'lattice', 'lineage']) BASE_UNITS.push(LINES[lk][tk][a]);
BUILDABLE_UNITS.length = 0; BASE_UNITS.forEach(k => BUILDABLE_UNITS.push(k));
// The unit a faction actually builds for a base type (its unique unit if it has one).
function unitFor(civKey, base) {
  for (const k in MIL) if (MIL[k].replaces === base && MIL[k].civ === civKey) return k;
  return base;
}
function baseOf(key) { return (MIL[key] && MIL[key].replaces) || key; }

// ---- satellites: built in a colony, then launched over a tile within reach. They orbit for a while, then burn up. ----
const SATS = {
  sat_helio: { name: 'Helio Lens', glyph: '☀️', tech: 'orbital_launch', cost: 110, life: 30, radius: 2, text: '+1 production on your worked tiles below it.' },
  sat_survey: { name: 'Survey Eye', glyph: '👁️', tech: 'orbital_launch', cost: 90, life: 30, radius: 3, text: 'Sees 4 tiles around. Your colonies below it get +2 science.' },
  sat_sentinel: { name: 'Sentinel Platform', glyph: '🛡️', tech: 'orbital_defense', cost: 140, life: 25, radius: 2, text: 'Your units below it defend at +20%; enemies and fauna below it take 10 damage each turn.' },
  sat_scrubber: { name: 'Veil Scrubber', glyph: '🧹', tech: 'orbital_defense', cost: 100, life: 20, radius: 2, text: 'Burns away 2 Veil tiles below it each turn.' },
  sat_seeder: { name: 'Bloom Seeder', glyph: '🌸', tech: 'orbital_mechanics', aff: ['communion', 3], cost: 120, life: 25, radius: 2, text: 'Seeds the Veil below it; your units there heal 10 more and worked Veil tiles give +1 food. Communion 3.' },
  sat_relay: { name: 'Lattice Relay', glyph: '📡', tech: 'orbital_mechanics', aff: ['lattice', 3], cost: 140, life: 30, radius: 2, text: '+1 science on your worked tiles below it. Lattice 3.' },
  sat_haven: { name: 'Haven Beacon', glyph: '🕯️', tech: 'orbital_mechanics', aff: ['lineage', 3], cost: 120, life: 30, radius: 2, text: 'Your colonies below it get +2 food and +2 culture. Lineage 3.' },
};
const SAT_RANGE = 4;
for (const k in SATS) {
  const S = SATS[k];
  UNITS[k] = { key: k, name: S.name, civilian: true, moves: 0, sight: 1, strength: 0, glyph: S.glyph, cost: S.cost, tech: S.tech, orbital: true, satAff: S.aff };
  BUILDABLE_UNITS.push(k);
}

// Promotions. req: any one of these keys first ('any' = any promotion).
const PROMOS = [
  { key: 'shock1', name: 'Assault I', cls: ['melee', 'mounted'], req: [], fx: { open: 15 }, text: '+15% strength in open terrain.' },
  { key: 'shock2', name: 'Assault II', cls: ['melee', 'mounted'], req: ['shock1'], fx: { open: 15 }, text: '+15% more in open terrain.' },
  { key: 'shock3', name: 'Assault III', cls: ['melee', 'mounted'], req: ['shock2'], fx: { open: 20 }, text: '+20% more in open terrain.' },
  { key: 'drill1', name: 'Ranger I', cls: ['melee', 'mounted'], req: [], fx: { rough: 15 }, text: '+15% strength in rough terrain (ridges, fungal forest, marsh).' },
  { key: 'drill2', name: 'Ranger II', cls: ['melee', 'mounted'], req: ['drill1'], fx: { rough: 15 }, text: '+15% more in rough terrain.' },
  { key: 'drill3', name: 'Ranger III', cls: ['melee', 'mounted'], req: ['drill2'], fx: { rough: 20 }, text: '+20% more in rough terrain.' },
  { key: 'mobility', name: 'Overdrive', cls: ['mounted'], req: ['any'], fx: { moves: 1 }, text: '+1 movement.' },
  { key: 'accuracy1', name: 'Targeting I', cls: ['ranged'], req: [], fx: { openR: 15 }, text: '+15% ranged attack against units in open terrain.' },
  { key: 'accuracy2', name: 'Targeting II', cls: ['ranged'], req: ['accuracy1'], fx: { openR: 15 }, text: '+15% more against units in open terrain.' },
  { key: 'barrage1', name: 'Saturation I', cls: ['ranged'], req: [], fx: { roughR: 15 }, text: '+15% ranged attack against units in rough terrain.' },
  { key: 'barrage2', name: 'Saturation II', cls: ['ranged'], req: ['barrage1'], fx: { roughR: 15 }, text: '+15% more against units in rough terrain.' },
  { key: 'longshot', name: 'Long Range', cls: ['ranged', 'naval_ranged'], req: ['accuracy2', 'barrage2', 'gunnery2'], fx: { range: 1 }, text: '+1 range.' },
  { key: 'siege1', name: 'Breacher I', cls: ['siege'], req: [], fx: { vsCity: 25 }, text: '+25% against colonies.' },
  { key: 'siege2', name: 'Breacher II', cls: ['siege'], req: ['siege1'], fx: { vsCity: 25 }, text: '+25% more against colonies.' },
  { key: 'cover', name: 'Cover', cls: ['melee', 'ranged', 'siege'], req: [], fx: { vsRanged: 33 }, text: '+33% defense against ranged attacks.' },
  { key: 'medic', name: 'Medic', cls: ['melee', 'ranged', 'mounted', 'siege'], req: ['any'], fx: { heal: 10 }, text: 'This unit and adjacent friends heal 10 more each turn.' },
  { key: 'veilwalk', name: 'Veil Filters', cls: ['melee', 'ranged', 'mounted', 'siege'], req: [], fx: { veilImmune: 1 }, text: 'The Veil no longer harms this unit.' },
  { key: 'hunter', name: 'Fauna Hunter', cls: ['melee', 'ranged', 'mounted'], req: [], fx: { vsFauna: 33 }, text: '+33% against native fauna.' },
  { key: 'gunnery1', name: 'Gunnery I', cls: ['naval_ranged', 'naval_melee'], req: [], fx: { vsNaval: 15 }, text: '+15% against ships.' },
  { key: 'gunnery2', name: 'Gunnery II', cls: ['naval_ranged', 'naval_melee'], req: ['gunnery1'], fx: { vsNaval: 15 }, text: '+15% more against ships.' },
  { key: 'raider', name: 'Coastal Raider', cls: ['naval_ranged', 'naval_melee'], req: [], fx: { vsCity: 33 }, text: '+33% against colonies.' },
  { key: 'navigator', name: 'Navigator', cls: ['naval_ranged', 'naval_melee'], req: ['any'], fx: { moves: 1 }, text: '+1 movement.' },
];
const PROMO = {}; PROMOS.forEach(p => PROMO[p.key] = p);
const XP_STEPS = [10, 30, 60, 100, 150, 210, 280];

// Defensive and military buildings
BUILDINGS.push(
  { key: 'walls', name: 'Perimeter Wall', tech: 'fabrication', cost: 60, upkeep: 1, cityStr: 5, cityHp: 50, glyph: '🧱', desc: '+5 colony defense, +50 colony health.' },
  { key: 'barracks', name: 'Training Grounds', tech: 'fabrication', cost: 60, upkeep: 1, xp: 15, glyph: '🎖️', desc: 'New land units start with 15 experience.' },
  { key: 'castle', name: 'Shield Generator', tech: 'heavy_alloys', cost: 110, upkeep: 2, req: 'walls', cityStr: 7, cityHp: 50, glyph: '🔰', desc: '+7 colony defense, +50 colony health. Needs a Perimeter Wall.' },
  { key: 'armory', name: 'Armory Bay', tech: 'combat_doctrine', cost: 110, upkeep: 2, req: 'barracks', xp: 15, glyph: '🗃️', desc: 'New land units start with 15 more experience. Needs Training Grounds.' },
  { key: 'bastion', name: 'Bastion Array', tech: 'megastructures', cost: 180, upkeep: 2, req: 'castle', cityStr: 10, cityHp: 75, cityRange: 1, glyph: '🏰', desc: '+10 colony defense, +75 colony health, +1 colony attack range. Needs a Shield Generator.' },
);
BUILDINGS.forEach((b, i) => BLDI[b.key] = i);
IMPROV.push({ key: 'fort', name: 'Bulwark Post', tech: 'automation', glyph: '🏯', add: {}, desc: '+50% defense for a unit standing here.' });
IMPROV.forEach((m, i) => { if (m) IMPI[m.key] = i; });

// Native fauna are an extra player using this entry (never offered in the faction picker).
CIVS.push({ key: 'barbarians', name: 'Veyran Fauna', adj: 'Wild', leader: 'The Wild', color: '#c9408a', dark: '#3e0d29', barb: true,
  bonus: '', bonusText: '', uu: '', uuText: '', cities: [] });
CIVI.barbarians = CIVS.length - 1;
// species a nest spawns, by the world's most advanced phase
const BARB_UNITS = [['skitter', 'skitter', 'spinemaw'], ['skitter', 'delver', 'spinemaw'], ['delver', 'spinemaw', 'ravager'], ['ravager', 'spinemaw', 'delver'], ['ravager', 'ravager', 'spinemaw']];
const CAMP_MAX = { small: 6, medium: 9, large: 12, huge: 15 };
