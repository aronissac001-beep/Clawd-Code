// ===== data.js : static game definitions =====
const T = { GRASS: 0, PLAINS: 1, DESERT: 2, TUNDRA: 3, HILLS: 4, FOREST: 5, MARSH: 6, MOUNTAIN: 7, COAST: 8, OCEAN: 9 };
const TERRAIN = [
  { key: 'grass', name: 'Grassland', food: 2, prod: 0, gold: 0, move: 1, def: 0, color: '#6c9e46', land: true },
  { key: 'plains', name: 'Plains', food: 1, prod: 1, gold: 0, move: 1, def: 0, color: '#a99b52', land: true },
  { key: 'desert', name: 'Desert', food: 0, prod: 1, gold: 0, move: 1, def: 0, color: '#d6c286', land: true },
  { key: 'tundra', name: 'Tundra', food: 1, prod: 0, gold: 0, move: 1, def: 0, color: '#8e9b8f', land: true },
  { key: 'hills', name: 'Hills', food: 0, prod: 2, gold: 0, move: 2, def: 25, color: '#8f8452', land: true, blocks: true, elevated: true },
  { key: 'forest', name: 'Forest', food: 1, prod: 1, gold: 0, move: 2, def: 25, color: '#3d7639', land: true, blocks: true },
  { key: 'marsh', name: 'Marsh', food: 1, prod: 0, gold: 0, move: 2, def: -15, color: '#4d7263', land: true },
  { key: 'mountain', name: 'Mountains', food: 0, prod: 0, gold: 0, move: Infinity, def: 0, color: '#7b756f', land: true, blocks: true, impassable: true },
  { key: 'coast', name: 'Coast', food: 1, prod: 0, gold: 1, move: Infinity, def: 0, color: '#3a8db0', water: true },
  { key: 'ocean', name: 'Ocean', food: 1, prod: 0, gold: 0, move: Infinity, def: 0, color: '#1d4d79', water: true },
];

// kind: bonus | strategic | luxury. reveal: tech key that makes it visible (tech arrives in Phase 2).
const RES = [
  { key: 'wheat', name: 'Wheat', kind: 'bonus', food: 1, prod: 0, gold: 0, on: [T.PLAINS, T.GRASS], glyph: '🌾' },
  { key: 'cattle', name: 'Cattle', kind: 'bonus', food: 1, prod: 0, gold: 0, on: [T.GRASS], glyph: '🐄' },
  { key: 'deer', name: 'Deer', kind: 'bonus', food: 1, prod: 0, gold: 0, on: [T.FOREST, T.TUNDRA], glyph: '🦌' },
  { key: 'fish', name: 'Fish', kind: 'bonus', food: 2, prod: 0, gold: 0, on: [T.COAST], glyph: '🐟' },
  { key: 'stone', name: 'Stone', kind: 'bonus', food: 0, prod: 1, gold: 0, on: [T.HILLS, T.DESERT, T.PLAINS], glyph: '🪨' },
  { key: 'horses', name: 'Horses', kind: 'strategic', food: 0, prod: 1, gold: 0, on: [T.GRASS, T.PLAINS], glyph: '🐎', reveal: 'animal_husbandry' },
  { key: 'iron', name: 'Iron', kind: 'strategic', food: 0, prod: 1, gold: 0, on: [T.HILLS, T.PLAINS, T.DESERT, T.TUNDRA], glyph: '⚒️', reveal: 'bronze_working' },
  { key: 'saltpeter', name: 'Saltpeter', kind: 'strategic', food: 0, prod: 1, gold: 0, on: [T.DESERT, T.PLAINS, T.TUNDRA, T.HILLS], glyph: '🧂', reveal: 'steel' },
  { key: 'silk', name: 'Silk', kind: 'luxury', food: 0, prod: 0, gold: 2, on: [T.FOREST], glyph: '🧵' },
  { key: 'spices', name: 'Spices', kind: 'luxury', food: 1, prod: 0, gold: 1, on: [T.MARSH, T.FOREST], glyph: '🌶️' },
  { key: 'gems', name: 'Gems', kind: 'luxury', food: 0, prod: 0, gold: 3, on: [T.HILLS, T.DESERT], glyph: '💎' },
  { key: 'wine', name: 'Wine', kind: 'luxury', food: 0, prod: 0, gold: 2, on: [T.PLAINS, T.GRASS], glyph: '🍇' },
  { key: 'furs', name: 'Furs', kind: 'luxury', food: 0, prod: 0, gold: 2, on: [T.TUNDRA, T.FOREST], glyph: '🦊' },
  { key: 'pearls', name: 'Pearls', kind: 'luxury', food: 0, prod: 0, gold: 2, on: [T.COAST], glyph: '🐚' },
];
const RESI = {}; RES.forEach((r, i) => RESI[r.key] = i);

const MAPSIZE = {
  small: { key: 'small', name: 'Small', W: 44, H: 28, maxCivs: 4, rivers: 9 },
  medium: { key: 'medium', name: 'Medium', W: 60, H: 38, maxCivs: 5, rivers: 15 },
  large: { key: 'large', name: 'Large', W: 76, H: 48, maxCivs: 6, rivers: 24 },
};
const MAPSCRIPT = {
  continents: { key: 'continents', name: 'Continents', land: 0.38, freq: 1 / 10, wm: 0.62, wn: 0.55, minComp: 4, channel: 0.09 },
  pangaea: { key: 'pangaea', name: 'Pangaea', land: 0.40, freq: 1 / 11, wm: 0.66, wn: 0.5, minComp: 4 },
  archipelago: { key: 'archipelago', name: 'Archipelago', land: 0.32, freq: 1 / 7, wm: 0.6, wn: 0.5, minComp: 3, channel: 0.12 },
  islands: { key: 'islands', name: 'Islands', land: 0.26, freq: 1 / 5, wm: 0.5, wn: 0.65, minComp: 2, channel: 0.1 },
};
const DIFFICULTY = [
  { key: 'settler', name: 'Settler', aiYield: 0.8, aiExtra: [], humanExtra: ['militia'], desc: 'Rivals produce 20% less. You start with an extra Militia.' },
  { key: 'standard', name: 'Standard', aiYield: 1.0, aiExtra: [], humanExtra: [], desc: 'Everyone plays by the same rules.' },
  { key: 'veteran', name: 'Veteran', aiYield: 1.15, aiExtra: ['militia'], humanExtra: [], desc: 'Rivals produce 15% more and start with an extra Militia.' },
  { key: 'deity', name: 'Deity', aiYield: 1.35, aiExtra: ['settler', 'militia'], humanExtra: [], desc: 'Rivals produce 35% more and start with a second Settler.' },
];
const TURN_LIMITS = [250, 350, 500];
const VICTORIES = [
  { key: 'domination', name: 'Domination', desc: 'Hold every rival capital.' },
  { key: 'science', name: 'Science', desc: 'Research Grand Theory, then finish the Skyward Project.' },
  { key: 'score', name: 'Score', desc: 'Highest score when the turn limit is reached.' },
  { key: 'culture', name: 'Culture', desc: 'Complete five policy trees, then build the Grand Exhibition.' },
  { key: 'religion', name: 'Religion', desc: 'Your faith leads in over 60% of the cities of every surviving civ for 15 turns.' },
  { key: 'diplomacy', name: 'Diplomatic', desc: 'Stay allied with most surviving civs for 20 turns.' },
];
const BARBARIANS = [{ key: 'off', name: 'Off' }, { key: 'normal', name: 'Normal' }, { key: 'raging', name: 'Raging' }];

// Units available in Phase 1. strength is used by combat in a later phase.
const UNITS = {
  settler: { key: 'settler', name: 'Settler', civilian: true, moves: 2, sight: 2, strength: 0, glyph: '⛺', founds: true },
  scout: { key: 'scout', name: 'Scout', civilian: false, moves: 3, sight: 2, strength: 4, glyph: '🧭', recon: true, ignoreTerrain: true },
  militia: { key: 'militia', name: 'Militia', civilian: false, moves: 2, sight: 2, strength: 8, glyph: '🛡️', canFortify: true },
};

const CIVS = [
  { key: 'aurelian', name: 'Aurelian Compact', adj: 'Aurelian', leader: 'Archon Velisar', color: '#e2b544', dark: '#6b5212',
    bonus: 'Academies', bonusText: '+10% science in every city. Libraries give +1 extra science.',
    uu: 'Cohort Spear', uuText: 'Replaces the Spearman with +2 strength.',
    cities: ['Aurelis', 'Castra Vel', 'Lumenor', 'Septara', 'Ovidra', 'Calvenna', 'Marisport', 'Tessaly', 'Duranthe', 'Vellum', 'Orrin Gate', 'Sabellis', 'Quintar', 'Ardena', 'Corvane', 'Halcyra'] },
  { key: 'thornwall', name: 'Thornwall Marches', adj: 'Thornish', leader: 'Margrave Edda', color: '#5b84dc', dark: '#1c2f63',
    bonus: 'Bulwarks', bonusText: '+25% defense inside your own territory. Walls cost half.',
    uu: 'Wallwarden', uuText: 'Replaces the Crossbowman with +25% defense in your territory.',
    cities: ['Thornwall', 'Greyhold', 'Ashbarrow', 'Kettlemere', 'Brackenford', 'Stonewatch', 'Hollin', 'Ravensgate', 'Dunmarsh', 'Wyrmstead', 'Oakhelm', 'Blackbridge', 'Fellmoor', 'Harrowgate', 'Cinderfold', 'Elmsreach'] },
  { key: 'sunreach', name: 'Sunreach Riders', adj: 'Sunreach', leader: 'Sky-Rider Oyuna', color: '#e46a3c', dark: '#6a2410',
    bonus: 'Open Sky', bonusText: '+1 movement for mounted units. Horses are visible from the start.',
    uu: 'Dune Lancer', uuText: 'Replaces the Knight with +1 movement.',
    cities: ['Kesh Tal', 'Ombra', 'Dhuran', 'Saryk', 'Altaq', 'Qirin', 'Tengis', 'Ulanor', 'Merek', 'Burqa', 'Zhelan', 'Ostrakh', 'Yaruq', 'Khalden', 'Ebrin', 'Torvahn'] },
  { key: 'meridian', name: 'Meridian League', adj: 'Meridian', leader: 'Chancellor Lisandra', color: '#2db7a6', dark: '#0d4c45',
    bonus: 'Coin of the Realm', bonusText: '+2 gold in every city. One extra trade route.',
    uu: 'Corsair', uuText: 'Replaces the Frigate and earns gold from victories.',
    cities: ['Meridia', 'Porto Cassel', 'Valmara', 'Sestri', 'Lagunel', 'Corallo', 'Tidewick', 'Amberquay', 'Saltmere', 'Bellacorte', 'Riva Nuova', 'Fennport', 'Marenza', 'Goldhaven', 'Isola Sera', 'Lanterna'] },
  { key: 'verdant', name: 'Verdant Circle', adj: 'Verdant', leader: 'Elder Wren', color: '#62c44c', dark: '#1e5314',
    bonus: 'Grove Keepers', bonusText: 'Forest tiles give +1 faith, and +1 culture in cities with an Amphitheater while left wild. Pantheons come sooner.',
    uu: 'Thornbow', uuText: 'Replaces the Archer and moves through forest at no extra cost.',
    cities: ['Aldergrove', 'Mossheart', 'Thistledown', 'Rowan Hollow', 'Fernwyn', 'Willowmere', 'Briarglen', 'Lichenford', 'Oakenrest', 'Sorrel', 'Hazelbrook', 'Yewcross', 'Bramblevale', 'Glimmerwood', 'Sedgecombe', 'Ivyreach'] },
  { key: 'emberforge', name: 'Emberforge Clans', adj: 'Emberforge', leader: 'Forge-Thane Brannoc', color: '#b85aa6', dark: '#4d1744',
    bonus: 'Forgefire', bonusText: '+15% production toward buildings. Mines give +1 production.',
    uu: 'Firedrake', uuText: 'Replaces the Cannon with +1 range.',
    cities: ['Emberforge', 'Anvilmount', 'Slagdeep', 'Coalbrand', 'Hammerfall', 'Kilnstead', 'Smeltwater', 'Bellowdeep', 'Cinderhall', 'Ironvein', 'Ashforge', 'Flintmarrow', 'Ore Hollow', 'Scoria', 'Quenchmere', 'Tonghold'] },
];
const CIVI = {}; CIVS.forEach((c, i) => CIVI[c.key] = i);

const MIN_CITY_DIST = 4; // centers must be at least this many tiles apart
