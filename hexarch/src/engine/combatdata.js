// ===== combatdata.js : military units, promotions, defenses, barbarians =====
// cls: melee | ranged | mounted | siege | recon | naval_melee | naval_ranged (civilians have no cls)
// str = melee strength (also defense), rstr = ranged attack strength, range in tiles.
const MIL = {
  militia: { name: 'Militia', cls: 'melee', str: 8, moves: 2, cost: 28, upg: 'spearman', glyph: '🛡️' },
  scout: { name: 'Scout', cls: 'recon', str: 4, moves: 3, cost: 22, glyph: '🧭' },
  archer: { name: 'Archer', cls: 'ranged', str: 5, rstr: 7, range: 2, moves: 2, cost: 40, tech: 'archery', upg: 'crossbowman', glyph: '🏹' },
  spearman: { name: 'Spearman', cls: 'melee', str: 11, moves: 2, cost: 45, tech: 'bronze_working', upg: 'pikeman', vsMounted: 50, glyph: '🔱' },
  rider: { name: 'Rider', cls: 'mounted', str: 12, moves: 4, cost: 55, tech: 'horseback_riding', res: 'horses', upg: 'knight', glyph: '🐎' },
  swordsman: { name: 'Swordsman', cls: 'melee', str: 14, moves: 2, cost: 55, tech: 'iron_working', res: 'iron', upg: 'longsword', glyph: '⚔️' },
  catapult: { name: 'Catapult', cls: 'siege', str: 6, rstr: 14, range: 2, moves: 2, cost: 70, tech: 'mathematics', upg: 'cannon', glyph: '☄️' },
  pikeman: { name: 'Pikeman', cls: 'melee', str: 16, moves: 2, cost: 70, tech: 'feudalism', upg: 'musketeer', vsMounted: 50, glyph: '⚜️' },
  longsword: { name: 'Longsword', cls: 'melee', str: 21, moves: 2, cost: 85, tech: 'steel', res: 'iron', upg: 'musketeer', glyph: '🗡️' },
  crossbowman: { name: 'Crossbowman', cls: 'ranged', str: 10, rstr: 16, range: 2, moves: 2, cost: 80, tech: 'machinery', glyph: '🎯' },
  knight: { name: 'Knight', cls: 'mounted', str: 20, moves: 4, cost: 90, tech: 'chivalry', res: 'horses', glyph: '🏇' },
  musketeer: { name: 'Musketeer', cls: 'melee', str: 26, moves: 2, cost: 110, tech: 'gunpowder', res: 'saltpeter', upg: 'rifleman', glyph: '💂' },
  cannon: { name: 'Cannon', cls: 'siege', str: 12, rstr: 26, range: 2, moves: 2, cost: 120, tech: 'metallurgy', upg: 'artillery', glyph: '💣' },
  rifleman: { name: 'Rifleman', cls: 'melee', str: 36, moves: 2, cost: 150, tech: 'rifling', glyph: '🪖' },
  artillery: { name: 'Artillery', cls: 'siege', str: 18, rstr: 40, range: 3, moves: 2, cost: 190, tech: 'military_science', res: 'saltpeter', glyph: '🧨' },
  galley: { name: 'Galley', cls: 'naval_melee', str: 10, moves: 3, cost: 45, tech: 'sailing', coastOnly: true, upg: 'caravel', glyph: '🚣' },
  warship: { name: 'Warship', cls: 'naval_ranged', str: 8, rstr: 12, range: 2, moves: 3, cost: 60, tech: 'shipbuilding', coastOnly: true, upg: 'frigate', glyph: '🛶' },
  caravel: { name: 'Caravel', cls: 'naval_melee', str: 18, moves: 4, cost: 80, tech: 'astronomy', upg: 'ironclad', glyph: '⛵' },
  frigate: { name: 'Frigate', cls: 'naval_ranged', str: 14, rstr: 26, range: 2, moves: 4, cost: 110, tech: 'navigation', res: 'iron', glyph: '🚢' },
  ironclad: { name: 'Ironclad', cls: 'naval_melee', str: 40, moves: 4, cost: 160, tech: 'steam_power', res: 'iron', glyph: '🛳️' },
  // unique units (replace: base unit they stand in for)
  cohort_spear: { name: 'Cohort Spear', cls: 'melee', str: 13, moves: 2, cost: 45, tech: 'bronze_working', upg: 'pikeman', vsMounted: 50, glyph: '🔱', civ: 'aurelian', replaces: 'spearman' },
  thornbow: { name: 'Thornbow', cls: 'ranged', str: 6, rstr: 8, range: 2, moves: 2, cost: 40, tech: 'archery', upg: 'crossbowman', glyph: '🏹', civ: 'verdant', replaces: 'archer', forestWalk: true },
  dune_lancer: { name: 'Dune Lancer', cls: 'mounted', str: 20, moves: 5, cost: 90, tech: 'chivalry', res: 'horses', glyph: '🏇', civ: 'sunreach', replaces: 'knight' },
  wallwarden: { name: 'Wallwarden', cls: 'ranged', str: 11, rstr: 16, range: 2, moves: 2, cost: 80, tech: 'machinery', glyph: '🎯', civ: 'thornwall', replaces: 'crossbowman', homeDef: 25 },
  corsair: { name: 'Corsair', cls: 'naval_ranged', str: 14, rstr: 26, range: 2, moves: 4, cost: 110, tech: 'navigation', res: 'iron', glyph: '🏴‍☠️', civ: 'meridian', replaces: 'frigate', goldOnKill: true },
  firedrake: { name: 'Firedrake', cls: 'siege', str: 12, rstr: 26, range: 3, moves: 2, cost: 120, tech: 'metallurgy', upg: 'artillery', glyph: '💣', civ: 'emberforge', replaces: 'cannon' },
};
for (const k in MIL) {
  const m = MIL[k];
  UNITS[k] = Object.assign(UNITS[k] || {}, { key: k, civilian: false, sight: 2, strength: m.str }, m);
}
UNITS.scout.recon = true; UNITS.scout.ignoreTerrain = true; UNITS.militia.canFortify = true;
for (const k in UNITS) {
  const U = UNITS[k];
  U.naval = U.cls === 'naval_melee' || U.cls === 'naval_ranged';
  U.ranged = U.cls === 'ranged' || U.cls === 'siege' || U.cls === 'naval_ranged';
  U.military = !U.civilian;
  if (U.military && U.cls !== 'recon') U.canFortify = !U.naval;
}
const BASE_UNITS = ['settler', 'builder', 'caravan', 'scout', 'militia', 'archer', 'spearman', 'rider', 'swordsman', 'catapult', 'pikeman', 'longsword', 'crossbowman', 'knight',
  'musketeer', 'cannon', 'rifleman', 'artillery', 'galley', 'warship', 'caravel', 'frigate', 'ironclad'];
BUILDABLE_UNITS.length = 0; BASE_UNITS.forEach(k => BUILDABLE_UNITS.push(k));
// The unit a civ actually builds for a base type (its unique unit if it has one).
function unitFor(civKey, base) {
  for (const k in MIL) if (MIL[k].replaces === base && MIL[k].civ === civKey) return k;
  return base;
}
function baseOf(key) { return (MIL[key] && MIL[key].replaces) || key; }

// Promotions. req: any one of these keys first ('any' = any promotion).
const PROMOS = [
  { key: 'shock1', name: 'Shock I', cls: ['melee', 'mounted'], req: [], fx: { open: 15 }, text: '+15% strength in open terrain.' },
  { key: 'shock2', name: 'Shock II', cls: ['melee', 'mounted'], req: ['shock1'], fx: { open: 15 }, text: '+15% more in open terrain.' },
  { key: 'shock3', name: 'Shock III', cls: ['melee', 'mounted'], req: ['shock2'], fx: { open: 20 }, text: '+20% more in open terrain.' },
  { key: 'drill1', name: 'Drill I', cls: ['melee', 'mounted'], req: [], fx: { rough: 15 }, text: '+15% strength in rough terrain (hills, forest, marsh).' },
  { key: 'drill2', name: 'Drill II', cls: ['melee', 'mounted'], req: ['drill1'], fx: { rough: 15 }, text: '+15% more in rough terrain.' },
  { key: 'drill3', name: 'Drill III', cls: ['melee', 'mounted'], req: ['drill2'], fx: { rough: 20 }, text: '+20% more in rough terrain.' },
  { key: 'mobility', name: 'Mobility', cls: ['mounted'], req: ['any'], fx: { moves: 1 }, text: '+1 movement.' },
  { key: 'accuracy1', name: 'Accuracy I', cls: ['ranged'], req: [], fx: { openR: 15 }, text: '+15% ranged attack against units in open terrain.' },
  { key: 'accuracy2', name: 'Accuracy II', cls: ['ranged'], req: ['accuracy1'], fx: { openR: 15 }, text: '+15% more against units in open terrain.' },
  { key: 'barrage1', name: 'Barrage I', cls: ['ranged'], req: [], fx: { roughR: 15 }, text: '+15% ranged attack against units in rough terrain.' },
  { key: 'barrage2', name: 'Barrage II', cls: ['ranged'], req: ['barrage1'], fx: { roughR: 15 }, text: '+15% more against units in rough terrain.' },
  { key: 'longshot', name: 'Long Shot', cls: ['ranged', 'naval_ranged'], req: ['accuracy2', 'barrage2', 'gunnery2'], fx: { range: 1 }, text: '+1 range.' },
  { key: 'siege1', name: 'Sapper I', cls: ['siege'], req: [], fx: { vsCity: 25 }, text: '+25% against cities.' },
  { key: 'siege2', name: 'Sapper II', cls: ['siege'], req: ['siege1'], fx: { vsCity: 25 }, text: '+25% more against cities.' },
  { key: 'cover', name: 'Cover', cls: ['melee', 'ranged', 'siege'], req: [], fx: { vsRanged: 33 }, text: '+33% defense against ranged attacks.' },
  { key: 'medic', name: 'Medic', cls: ['melee', 'ranged', 'mounted', 'siege'], req: ['any'], fx: { heal: 10 }, text: 'This unit and adjacent friends heal 10 more each turn.' },
  { key: 'gunnery1', name: 'Gunnery I', cls: ['naval_ranged', 'naval_melee'], req: [], fx: { vsNaval: 15 }, text: '+15% against ships.' },
  { key: 'gunnery2', name: 'Gunnery II', cls: ['naval_ranged', 'naval_melee'], req: ['gunnery1'], fx: { vsNaval: 15 }, text: '+15% more against ships.' },
  { key: 'raider', name: 'Coastal Raider', cls: ['naval_ranged', 'naval_melee'], req: [], fx: { vsCity: 33 }, text: '+33% against cities.' },
  { key: 'navigator', name: 'Navigator', cls: ['naval_ranged', 'naval_melee'], req: ['any'], fx: { moves: 1 }, text: '+1 movement.' },
];
const PROMO = {}; PROMOS.forEach(p => PROMO[p.key] = p);
const XP_STEPS = [10, 30, 60, 100, 150, 210, 280];

// Defensive and military buildings
BUILDINGS.push(
  { key: 'walls', name: 'Walls', tech: 'masonry', cost: 60, upkeep: 1, cityStr: 5, cityHp: 50, desc: '+5 city defense, +50 city health.' },
  { key: 'barracks', name: 'Barracks', tech: 'bronze_working', cost: 60, upkeep: 1, xp: 15, desc: 'New land units start with 15 experience.' },
  { key: 'castle', name: 'Castle', tech: 'feudalism', cost: 110, upkeep: 2, req: 'walls', cityStr: 7, cityHp: 50, desc: '+7 city defense, +50 city health. Needs Walls.' },
  { key: 'armory', name: 'Armory', tech: 'steel', cost: 110, upkeep: 2, req: 'barracks', xp: 15, desc: 'New land units start with 15 more experience. Needs Barracks.' },
  { key: 'bastion', name: 'Bastion', tech: 'metallurgy', cost: 180, upkeep: 2, req: 'castle', cityStr: 10, cityHp: 75, cityRange: 1, desc: '+10 city defense, +75 city health, +1 city attack range. Needs a Castle.' },
);
BUILDINGS.forEach((b, i) => BLDI[b.key] = i);
IMPROV.push({ key: 'fort', name: 'Fort', tech: 'feudalism', glyph: '🏯', add: {}, desc: '+50% defense for a unit standing here.' });
IMPROV.forEach((m, i) => { if (m) IMPI[m.key] = i; });

// Barbarians are an extra player using this civ entry (never offered in the civ picker).
CIVS.push({ key: 'barbarians', name: 'Barbarians', adj: 'Barbarian', leader: 'Warlords', color: '#9b2f2a', dark: '#3b0d0b', barb: true,
  bonus: '', bonusText: '', uu: '', uuText: '', cities: [] });
CIVI.barbarians = CIVS.length - 1;
const BARB_UNITS = [['militia', 'archer'], ['spearman', 'archer', 'swordsman'], ['pikeman', 'crossbowman', 'longsword'], ['musketeer', 'crossbowman'], ['rifleman', 'cannon']];
const CAMP_MAX = { small: 4, medium: 6, large: 9 };
