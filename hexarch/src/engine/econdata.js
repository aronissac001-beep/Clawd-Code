// ===== econdata.js : techs, buildings, improvements, economy constants =====
const MP = 6; // move points per tile of movement; roads cost 2, railroads 1

const ERAS = ['Ancient', 'Classical', 'Medieval', 'Renaissance', 'Industrial'];

// Improvements (index 0 = none). Each resource has exactly one matching improvement.
const IMPROV = [
  null,
  { key: 'farm', name: 'Farm', tech: 'agriculture', glyph: '', add: { f: 1 }, desc: '+1 food. Needs flat land or hills; desert needs fresh water.' },
  { key: 'mine', name: 'Mine', tech: 'mining', glyph: '⛏️', add: { p: 1 }, desc: '+1 production on hills, iron, saltpeter and gems.' },
  { key: 'quarry', name: 'Quarry', tech: 'masonry', glyph: '🧱', add: { p: 1 }, desc: '+1 production on stone.' },
  { key: 'camp', name: 'Camp', tech: 'hunting', glyph: '🏕️', add: { g: 1 }, desc: '+1 gold on deer and furs.' },
  { key: 'pasture', name: 'Pasture', tech: 'animal_husbandry', glyph: '🐑', add: { p: 1 }, desc: '+1 production on horses and cattle.' },
  { key: 'plantation', name: 'Plantation', tech: 'calendar', glyph: '🌱', add: { g: 1 }, desc: '+1 gold on silk, spices and wine.' },
  { key: 'lumbermill', name: 'Lumber Mill', tech: 'construction', glyph: '🪵', add: { p: 1 }, desc: '+1 production on forest.' },
  { key: 'boats', name: 'Fishing Boats', tech: 'sailing', glyph: '⛵', add: { f: 1 }, desc: '+1 food on fish and pearls. Built from an adjacent land tile.' },
];
const IMPI = {}; IMPROV.forEach((m, i) => { if (m) IMPI[m.key] = i; });
const RES_IMPROV = { wheat: 'farm', cattle: 'pasture', deer: 'camp', fish: 'boats', stone: 'quarry', horses: 'pasture', iron: 'mine',
  saltpeter: 'mine', silk: 'plantation', spices: 'plantation', gems: 'mine', wine: 'plantation', furs: 'camp', pearls: 'boats' };

// y: flat yields (f food, p production, g gold, s science, c culture), pct: percent bonuses, h: happiness
const BUILDINGS = [
  { key: 'palace', name: 'Palace', cost: 0, upkeep: 0, hidden: true, y: { p: 2, s: 2, g: 3, c: 1 }, desc: 'Seat of government.' },
  { key: 'monument', name: 'Monument', tech: 'mysticism', cost: 35, upkeep: 0, y: { c: 2 }, desc: '+2 culture.' },
  { key: 'granary', name: 'Granary', tech: 'pottery', cost: 45, upkeep: 1, y: { f: 2 }, keepFood: 15, desc: '+2 food. Keeps 15% of food when the city grows.' },
  { key: 'library', name: 'Library', tech: 'writing', cost: 60, upkeep: 1, y: { s: 2 }, pct: { s: 10 }, desc: '+2 science, +10% science.' },
  { key: 'market', name: 'Market', tech: 'currency', cost: 80, upkeep: 0, y: { g: 2 }, pct: { g: 20 }, desc: '+2 gold, +20% gold.' },
  { key: 'temple', name: 'Temple', tech: 'philosophy', cost: 75, upkeep: 1, y: { c: 1 }, h: 2, desc: '+2 happiness, +1 culture.' },
  { key: 'amphitheater', name: 'Amphitheater', tech: 'drama', cost: 100, upkeep: 1, y: { c: 3 }, h: 1, desc: '+3 culture, +1 happiness.' },
  { key: 'arena', name: 'Arena', tech: 'construction', cost: 100, upkeep: 2, h: 3, desc: '+3 happiness.' },
  { key: 'harbor', name: 'Harbor', tech: 'shipbuilding', cost: 90, upkeep: 2, coastal: true, y: { g: 1 }, waterF: 1, desc: '+1 food on worked water tiles, +1 gold. Connects the city by sea.' },
  { key: 'courthouse', name: 'Courthouse', tech: 'civil_service', cost: 110, upkeep: 1, y: { g: 1 }, h: 2, desc: '+2 happiness, +1 gold.' },
  { key: 'aqueduct', name: 'Aqueduct', tech: 'engineering', cost: 120, upkeep: 1, keepFood: 35, desc: 'Keeps 35% of food when the city grows.' },
  { key: 'workshop', name: 'Workshop', tech: 'guilds', cost: 130, upkeep: 2, y: { p: 2 }, pct: { p: 15 }, desc: '+2 production, +15% production.' },
  { key: 'university', name: 'University', tech: 'education', cost: 160, upkeep: 2, req: 'library', y: { s: 3 }, pct: { s: 25 }, desc: '+3 science, +25% science. Needs a Library.' },
  { key: 'lighthouse', name: 'Lighthouse', tech: 'compass', cost: 100, upkeep: 1, coastal: true, waterP: 1, desc: '+1 production on worked water tiles.' },
  { key: 'bank', name: 'Bank', tech: 'banking', cost: 190, upkeep: 0, req: 'market', y: { g: 2 }, pct: { g: 25 }, desc: '+2 gold, +25% gold. Needs a Market.' },
  { key: 'printing', name: 'Printing House', tech: 'printing', cost: 180, upkeep: 2, y: { s: 2, c: 2 }, desc: '+2 science, +2 culture.' },
  { key: 'observatory', name: 'Observatory', tech: 'astronomy', cost: 200, upkeep: 2, y: { s: 2 }, pct: { s: 15 }, mountainS: 1, desc: '+2 science, +15% science, +1 science per adjacent Mountain (max 3).' },
  { key: 'opera', name: 'Opera House', tech: 'architecture', cost: 210, upkeep: 2, req: 'amphitheater', y: { c: 4 }, h: 1, desc: '+4 culture, +1 happiness. Needs an Amphitheater.' },
  { key: 'museum', name: 'Museum', tech: 'humanism', cost: 250, upkeep: 3, y: { c: 5 }, pct: { c: 15 }, desc: '+5 culture, +15% culture.' },
  { key: 'factory', name: 'Factory', tech: 'industrialization', cost: 300, upkeep: 3, req: 'workshop', y: { p: 4 }, pct: { p: 25 }, desc: '+4 production, +25% production. Needs a Workshop.' },
  { key: 'laboratory', name: 'Laboratory', tech: 'scientific_method', cost: 300, upkeep: 3, req: 'university', y: { s: 4 }, pct: { s: 25 }, desc: '+4 science, +25% science. Needs a University.' },
  { key: 'hospital', name: 'Hospital', tech: 'sanitation', cost: 260, upkeep: 2, req: 'aqueduct', y: { f: 3 }, keepFood: 25, desc: '+3 food. Keeps 25% more food when the city grows. Needs an Aqueduct.' },
  { key: 'stock_exchange', name: 'Stock Exchange', tech: 'economics', cost: 300, upkeep: 0, req: 'bank', y: { g: 3 }, pct: { g: 25 }, desc: '+3 gold, +25% gold. Needs a Bank.' },
];
const BLDI = {}; BUILDINGS.forEach((b, i) => BLDI[b.key] = i);

// Insight conditions: t = type, n = amount, k = key(s). Earning one cuts the tech cost by a third.
const TECHS = [
  // Ancient
  { key: 'agriculture', name: 'Agriculture', era: 0, pre: [], ins: { t: 'cities', n: 1, text: 'Found a city' } },
  { key: 'pottery', name: 'Pottery', era: 0, pre: [], ins: { t: 'pop', n: 2, text: 'Grow a city to size 2' } },
  { key: 'mining', name: 'Mining', era: 0, pre: [], ins: { t: 'workTerrain', k: ['hills'], n: 1, text: 'Work a Hills tile' } },
  { key: 'hunting', name: 'Hunting', era: 0, pre: [], ins: { t: 'explored', n: 80, text: 'Explore 80 tiles' } },
  { key: 'animal_husbandry', name: 'Animal Husbandry', era: 0, pre: ['agriculture'], ins: { t: 'ownRes', k: ['cattle', 'horses'], n: 1, text: 'Hold a Cattle tile' } },
  { key: 'mysticism', name: 'Mysticism', era: 0, pre: ['hunting'], ins: { t: 'nearMountain', n: 1, text: 'Own a city next to Mountains' }, later: ['Shrine', 'Pantheon'] },
  { key: 'archery', name: 'Archery', era: 0, pre: ['hunting'], ins: { t: 'military', n: 3, text: 'Have 3 military units' }, later: ['Archer'] },
  { key: 'bronze_working', name: 'Bronze Working', era: 0, pre: ['mining'], ins: { t: 'improv', k: 'mine', n: 1, text: 'Build a Mine' }, later: ['Spearman'] },
  { key: 'sailing', name: 'Sailing', era: 0, pre: ['pottery'], ins: { t: 'coastal', n: 1, text: 'Found a coastal city' }, later: ['Galley', 'Coastal embarking'] },
  { key: 'writing', name: 'Writing', era: 0, pre: ['pottery'], ins: { t: 'met', n: 1, text: 'Meet another civilization' } },
  // Classical
  { key: 'masonry', name: 'Masonry', era: 1, pre: ['mining'], ins: { t: 'ownTerrain', k: ['hills'], n: 4, text: 'Hold 4 Hills tiles' }, later: ['Walls'] },
  { key: 'horseback_riding', name: 'Horseback Riding', era: 1, pre: ['animal_husbandry'], ins: { t: 'improv', k: 'pasture', n: 1, text: 'Build a Pasture' }, later: ['Rider'] },
  { key: 'iron_working', name: 'Iron Working', era: 1, pre: ['bronze_working'], ins: { t: 'improvRes', k: ['iron'], n: 1, text: 'Mine an Iron deposit' }, later: ['Swordsman'] },
  { key: 'mathematics', name: 'Mathematics', era: 1, pre: ['writing', 'masonry'], ins: { t: 'build', k: 'library', n: 1, text: 'Build a Library' }, later: ['Catapult'] },
  { key: 'currency', name: 'Currency', era: 1, pre: ['writing', 'pottery'], ins: { t: 'gold', n: 60, text: 'Hold 60 gold' }, fx: { routes: 1 } },
  { key: 'philosophy', name: 'Philosophy', era: 1, pre: ['mysticism', 'writing'], ins: { t: 'build', k: 'monument', n: 2, text: 'Build 2 Monuments' }, later: ['Found a religion'] },
  { key: 'drama', name: 'Drama', era: 1, pre: ['philosophy'], ins: { t: 'culture', n: 8, text: 'Make 8 culture per turn' } },
  { key: 'construction', name: 'Construction', era: 1, pre: ['masonry'], ins: { t: 'roads', n: 6, text: 'Build 6 roads' } },
  { key: 'calendar', name: 'Calendar', era: 1, pre: ['pottery', 'mysticism'], ins: { t: 'ownRes', k: ['silk', 'spices', 'wine'], n: 1, text: 'Hold Silk, Spices or Wine' } },
  { key: 'shipbuilding', name: 'Shipbuilding', era: 1, pre: ['sailing'], ins: { t: 'improv', k: 'boats', n: 1, text: 'Build Fishing Boats' }, later: ['Warship'] },
  // Medieval
  { key: 'feudalism', name: 'Feudalism', era: 2, pre: ['construction', 'horseback_riding'], ins: { t: 'improv', k: 'farm', n: 6, text: 'Build 6 Farms' }, later: ['Pikeman', 'Fort'] },
  { key: 'civil_service', name: 'Civil Service', era: 2, pre: ['currency', 'philosophy'], ins: { t: 'cities', n: 5, text: 'Have 5 cities' }, fx: { policyCost: 1 } },
  { key: 'theology', name: 'Theology', era: 2, pre: ['philosophy', 'drama'], ins: { t: 'build', k: 'temple', n: 3, text: 'Build 3 Temples' }, fx: { templeH: 1 }, later: ['Grand Temple', 'Enhance religion'] },
  { key: 'engineering', name: 'Engineering', era: 2, pre: ['construction', 'mathematics'], ins: { t: 'pop', n: 7, text: 'Grow a city to size 7' }, fx: { irrigation: 1 } },
  { key: 'steel', name: 'Steel', era: 2, pre: ['iron_working'], ins: { t: 'improv', k: 'mine', n: 5, text: 'Build 5 Mines' }, later: ['Longsword'] },
  { key: 'machinery', name: 'Machinery', era: 2, pre: ['engineering', 'archery'], ins: { t: 'improv', k: 'lumbermill', n: 3, text: 'Build 3 Lumber Mills' }, fx: { millP: 1 }, later: ['Crossbowman'] },
  { key: 'compass', name: 'Compass', era: 2, pre: ['shipbuilding', 'mathematics'], ins: { t: 'build', k: 'harbor', n: 1, text: 'Build a Harbor' }, later: ['Ocean embarking'] },
  { key: 'guilds', name: 'Guilds', era: 2, pre: ['currency', 'construction'], ins: { t: 'routes', n: 2, text: 'Run 2 trade routes' } },
  { key: 'education', name: 'Education', era: 2, pre: ['civil_service', 'theology'], ins: { t: 'build', k: 'library', n: 3, text: 'Build 3 Libraries' } },
  { key: 'chivalry', name: 'Chivalry', era: 2, pre: ['feudalism', 'horseback_riding'], ins: { t: 'improvRes', k: ['horses'], n: 2, text: 'Improve 2 Horses' }, later: ['Knight'] },
  // Renaissance
  { key: 'printing', name: 'Printing', era: 3, pre: ['education', 'guilds'], ins: { t: 'build', k: 'university', n: 1, text: 'Build a University' } },
  { key: 'gunpowder', name: 'Gunpowder', era: 3, pre: ['steel', 'machinery'], ins: { t: 'improvRes', k: ['saltpeter'], n: 1, text: 'Mine Saltpeter' }, later: ['Musketeer'] },
  { key: 'astronomy', name: 'Astronomy', era: 3, pre: ['education', 'compass'], ins: { t: 'build', k: 'lighthouse', n: 1, text: 'Build a Lighthouse' }, later: ['Caravel'] },
  { key: 'navigation', name: 'Navigation', era: 3, pre: ['astronomy'], ins: { t: 'coastal', n: 3, text: 'Have 3 coastal cities' }, later: ['Frigate', 'Transport'] },
  { key: 'banking', name: 'Banking', era: 3, pre: ['guilds', 'education'], ins: { t: 'gold', n: 300, text: 'Hold 300 gold' } },
  { key: 'metallurgy', name: 'Metallurgy', era: 3, pre: ['steel', 'gunpowder'], ins: { t: 'build', k: 'workshop', n: 3, text: 'Build 3 Workshops' }, later: ['Cannon'] },
  { key: 'architecture', name: 'Architecture', era: 3, pre: ['printing', 'engineering'], ins: { t: 'build', k: 'amphitheater', n: 3, text: 'Build 3 Amphitheaters' } },
  { key: 'humanism', name: 'Humanism', era: 3, pre: ['printing', 'theology'], ins: { t: 'culture', n: 30, text: 'Make 30 culture per turn' } },
  { key: 'exploration', name: 'Exploration', era: 3, pre: ['navigation'], ins: { t: 'metAll', n: 1, text: 'Meet every civilization' }, fx: { routes: 1 }, later: ['Faster ocean movement'] },
  // Industrial
  { key: 'scientific_method', name: 'Scientific Method', era: 4, pre: ['astronomy', 'printing'], ins: { t: 'build', k: 'observatory', n: 1, text: 'Build an Observatory' } },
  { key: 'industrialization', name: 'Industrialization', era: 4, pre: ['banking', 'metallurgy'], ins: { t: 'build', k: 'workshop', n: 5, text: 'Build 5 Workshops' } },
  { key: 'rifling', name: 'Rifling', era: 4, pre: ['gunpowder', 'metallurgy'], ins: { t: 'military', n: 8, text: 'Have 8 military units' }, later: ['Rifleman'] },
  { key: 'military_science', name: 'Military Science', era: 4, pre: ['chivalry', 'metallurgy'], ins: { t: 'military', n: 10, text: 'Have 10 military units' }, later: ['Artillery'] },
  { key: 'steam_power', name: 'Steam Power', era: 4, pre: ['industrialization', 'navigation'], ins: { t: 'build', k: 'factory', n: 1, text: 'Build a Factory' }, later: ['Ironclad'] },
  { key: 'railroad', name: 'Railroad', era: 4, pre: ['steam_power'], ins: { t: 'roads', n: 20, text: 'Build 20 roads' } },
  { key: 'sanitation', name: 'Sanitation', era: 4, pre: ['scientific_method', 'engineering'], ins: { t: 'pop', n: 15, text: 'Grow a city to size 15' } },
  { key: 'economics', name: 'Economics', era: 4, pre: ['banking', 'scientific_method'], ins: { t: 'build', k: 'bank', n: 3, text: 'Build 3 Banks' } },
  { key: 'grand_theory', name: 'Grand Theory', era: 4, pre: ['scientific_method', 'industrialization', 'rifling', 'military_science', 'steam_power', 'railroad', 'sanitation', 'economics'], ins: null, later: ['Skyward Project'] },
];
const TECHI = {}; TECHS.forEach((t, i) => TECHI[t.key] = i);
const ERA_BASE = [26, 100, 320, 1300, 3400];
TECHS.forEach(t => {
  const k = TECHS.filter(u => u.era === t.era).indexOf(t);
  t.cost = t.key === 'grand_theory' ? 10000 : Math.round(ERA_BASE[t.era] * (1 + 0.08 * k));
});

// Units added for the economy
Object.assign(UNITS, {
  builder: { key: 'builder', name: 'Builder', civilian: true, moves: 2, sight: 2, strength: 0, glyph: '🛠️', cost: 36, charges: 3 },
  caravan: { key: 'caravan', name: 'Caravan', civilian: true, moves: 2, sight: 2, strength: 0, glyph: '🐪', cost: 45, tech: 'currency', trade: true },
});
UNITS.settler.cost = 48; UNITS.scout.cost = 22; UNITS.militia.cost = 28;
const BUILDABLE_UNITS = ['settler', 'builder', 'scout', 'militia', 'caravan'];

const ECON = {
  baseHappy: 9, perCityUnhappy: 2, perPopUnhappy: 0.5, luxHappy: 4,
  freeUnitsBase: 3, startGold: 10, cityFlatSci: 1, popSci: 0.5,
  specialist: { s: 1, g: 1 },
};
function paceOf(G) { return (G.cfg.turnLimit || 350) / 350; }
function growthNeed(G, pop) { return Math.floor((15 + 6 * (pop - 1) + Math.pow(pop - 1, 1.8)) * paceOf(G)); }
function borderCost(G, n) { return Math.floor((10 + 6 * n + Math.pow(n, 1.5)) * paceOf(G)); }
function techCost(G, key) { return Math.round(TECHS[TECHI[key]].cost * paceOf(G)); }
function itemCost(G, item, pid) {
  let base = item.k === 'u' ? UNITS[item.key].cost : BUILDINGS[BLDI[item.key]].cost;
  if (pid !== undefined && item.k === 'u') {
    const fx = polFx(G.players[pid]);
    if (item.key === 'settler' && fx.settlerCostPct) base *= 1 + fx.settlerCostPct / 100;
    if (!UNITS[item.key].civilian && fx.milCostPct) base *= 1 + fx.milCostPct / 100;
  }
  return Math.round(base * paceOf(G));
}
