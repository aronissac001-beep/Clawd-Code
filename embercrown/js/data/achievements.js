// Feats (achievements). Each one pays a one-time Ember reward when earned.
//
// Shape: { id, name, text, icon, reward, group,
//          progress?(meta) -> number, target?  (counter feats: earned when progress >= target)
//          check?(ctx) -> bool                 (condition feats)
//          available?() -> bool }              (hidden while the content it needs is absent)
//
// check(ctx) is asked at three moments; ctx = { meta, run, entry, final, runEnd }:
//   live     during a region, on a few sim events: entry = a snapshot of the region so far,
//            final = false (so "won the region" conditions never fire early)
//   region   a region was folded into the run: entry = that region's record, final = true
//   run end  the run is over: runEnd = true, run.outcome is set, entry = null
// A region record (js/game/meta/records.js regionRecord) holds:
//   won, result, nodeType, act, mode, nights, kills, killsBy {type: n}, built {type: n},
//   builtN, towers (bool: a tower stood or was raised), villagersLost, villagers (alive at
//   the end), bonusNights, claims, zones, decrees (signed this region), bloodMoons,
//   bloodWinter, boss (type slain or null), heroesAlive, heroMax, heroes [classes], revents [ids]
// Lifetime counters live in meta.life (see records.js lifeOf). Meta keys: meta.ach, meta.life, meta.codex.
import { COMBOS } from './combos.js';
import { BUILDINGS } from './buildings.js';
import { ENEMIES } from './enemies.js';
import { RELICS } from './relics.js';

/** Building types that count as towers for "Hands of the People" (plus any def with tower: true). */
export const TOWER_TYPES = ['tower', 'ballista', 'spire'];
export function isTowerType(type) { return TOWER_TYPES.includes(type) || !!(BUILDINGS[type] && BUILDINGS[type].tower); }

const life = (m) => m.life || {};
const codex = (m) => m.codex || {};
const won = (c) => !!(c.runEnd && c.run && c.run.outcome && c.run.outcome.result === 'victory');
const regionWon = (c) => !!(c.final && c.entry && c.entry.won);
/** Omens of Ruin active on a run (the Citadel stores them in run.ext.citadel.omens; missing = none). */
export function omenCount(run) {
  const o = run && run.ext && run.ext.citadel && run.ext.citadel.omens;
  if (Array.isArray(o)) return o.length;
  if (typeof o === 'number') return o;
  if (o && typeof o === 'object') return Object.values(o).filter(Boolean).length;
  return 0;
}
/** Enemy types the Bestiary counts toward "every foe" (bosses have their own feats). */
export function bestiaryFoes() { return Object.keys(ENEMIES).filter((t) => !ENEMIES[t].boss); }
/** Combos found outside Sandbox (records.js keeps meta.codex.combos; meta.combos also holds Sandbox finds). */
const combosFound = (m) => ((codex(m).combos || []).filter((id) => COMBOS[id]).length);
const killed = (m, t) => ((codex(m).enemies || {})[t] || 0);
const factionWin = (id) => (c) => won(c) && c.run.faction === id;
const towerNames = () => TOWER_TYPES.filter((t) => BUILDINGS[t]).map((t) => BUILDINGS[t].name);
function orList(a) { return a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} or ${a[a.length - 1]}`; }

export const ACHIEVEMENTS = [
  // ---- Milestones (lifetime counters) ----
  { id: 'first_light', group: 'Milestones', name: 'First Light', icon: 'beacon', reward: 10,
    text: 'Clear your first region.', progress: (m) => life(m).regions || 0, target: 1 },
  { id: 'beacon_chain', group: 'Milestones', name: 'A Chain of Beacons', icon: 'beacon', reward: 40,
    text: 'Clear 25 regions.', progress: (m) => life(m).regions || 0, target: 25 },
  { id: 'kills_100', group: 'Milestones', name: 'Blooded', icon: 'sword', reward: 10,
    text: 'Slay 100 foes.', progress: (m) => life(m).kills || 0, target: 100 },
  { id: 'kills_1000', group: 'Milestones', name: 'Hollowbane', icon: 'sword', reward: 50,
    text: 'Slay 1,000 foes.', progress: (m) => life(m).kills || 0, target: 1000 },
  { id: 'kills_5000', group: 'Milestones', name: 'The Grey Tide Breaks', icon: 'skull', reward: 120,
    text: 'Slay 5,000 foes.', progress: (m) => life(m).kills || 0, target: 5000 },
  { id: 'nights_100', group: 'Milestones', name: 'Long Vigil', icon: 'moon', reward: 50,
    text: 'Survive 100 nights.', progress: (m) => life(m).nights || 0, target: 100 },
  { id: 'blood_10', group: 'Milestones', name: 'Red Moon Rising', icon: 'moon', reward: 40,
    text: 'Survive 10 Blood Moons.', progress: (m) => life(m).bloodMoons || 0, target: 10 },
  { id: 'built_300', group: 'Milestones', name: 'Master Builder', icon: 'hammer', reward: 40,
    text: 'Raise 300 buildings.', progress: (m) => life(m).built || 0, target: 300 },
  { id: 'runs_10', group: 'Milestones', name: 'Wanderer', icon: 'map', reward: 25,
    text: 'Finish 10 runs, won or lost.', progress: (m) => life(m).runs || 0, target: 10 },

  // ---- Codex ----
  { id: 'combo_1', group: 'Codex', name: 'Hidden Harmony', icon: 'eye', reward: 10,
    text: 'Discover a building combo.', progress: (m) => combosFound(m), target: 1 },
  { id: 'combo_5', group: 'Codex', name: 'Town Planner', icon: 'house', reward: 30,
    text: 'Discover 5 building combos.', progress: (m) => combosFound(m), target: 5 },
  { id: 'combo_all', group: 'Codex', name: 'Grand Design', icon: 'castle', reward: 120,
    get text() { return `Discover all ${Object.keys(COMBOS).length} building combos, the ill-omened ones too.`; },
    progress: (m) => combosFound(m), get target() { return Object.keys(COMBOS).length; } },
  { id: 'relics_10', group: 'Codex', name: 'Collector', icon: 'relic', reward: 30,
    text: 'Find 10 different relics.', progress: (m) => (codex(m).relics || []).length, target: 10 },
  { id: 'relics_25', group: 'Codex', name: 'Reliquary Keeper', icon: 'relic', reward: 90,
    text: 'Find 25 different relics.', progress: (m) => (codex(m).relics || []).length, target: 25,
    available: () => Object.keys(RELICS).length >= 25 },
  { id: 'kinds_15', group: 'Codex', name: 'Architect of Vael', icon: 'book', reward: 50,
    text: 'Raise 15 different kinds of building.', progress: (m) => (codex(m).buildings || []).filter((t) => BUILDINGS[t] && BUILDINGS[t].cat).length, target: 15 },
  { id: 'bestiary', group: 'Codex', name: 'Naturalist of the Dark', icon: 'skull', reward: 100,
    get text() { return `Slay or destroy one of everything in the Bestiary: ${bestiaryFoes().length} kinds of creature and structure, bosses aside.`; },
    progress: (m) => bestiaryFoes().filter((t) => killed(m, t) > 0).length, get target() { return bestiaryFoes().length; } },
  { id: 'lairs_10', group: 'Codex', name: 'Den Breaker', icon: 'axe', reward: 30,
    text: 'Destroy 10 beast lairs.', progress: (m) => killed(m, 'lair'), target: 10, available: () => !!ENEMIES.lair },

  // ---- Regions ----
  { id: 'no_losses', group: 'Regions', name: 'Not One Lost', icon: 'heart', reward: 25,
    text: 'Clear a region of 3 or more nights without a single villager dying.',
    check: (c) => regionWon(c) && c.entry.villagersLost === 0 && c.entry.nights >= 3 },
  { id: 'thriving', group: 'Regions', name: 'Thriving Realm', icon: 'pop', reward: 40,
    text: 'Clear a region with 30 or more villagers living.', check: (c) => regionWon(c) && c.entry.villagers >= 30 },
  { id: 'greedy', group: 'Regions', name: 'Pushing Your Luck', icon: 'flame', reward: 40,
    text: 'Light a Beacon after staying 3 or more bonus nights.',
    check: (c) => regionWon(c) && c.entry.nodeType !== 'boss' && c.entry.bonusNights >= 3 },
  { id: 'winter_blood', group: 'Regions', name: 'Red Snow', icon: 'moon', reward: 40,
    text: 'Survive a Blood Moon in winter.', check: (c) => !!(c.entry && c.entry.bloodWinter > 0) },
  { id: 'land_8', group: 'Regions', name: 'Land Grab', icon: 'map', reward: 50,
    text: 'Claim 8 zones of land in a single region.', check: (c) => !!(c.entry && c.entry.claims >= 8) },
  { id: 'decrees_3', group: 'Regions', name: 'Lawgiver', icon: 'book', reward: 50,
    text: 'Sign 3 decrees in a single region.', check: (c) => !!(c.entry && c.entry.decrees >= 3) },
  { id: 'hero_10', group: 'Regions', name: 'Living Legend', icon: 'crown', reward: 60,
    text: 'Raise a hero to level 10.', check: (c) => !!(c.entry && c.entry.heroMax >= 10) },
  { id: 'heroes_4', group: 'Regions', name: 'Fellowship', icon: 'crown', reward: 30,
    text: 'Clear a region with 4 heroes alive.', check: (c) => regionWon(c) && c.entry.heroesAlive >= 4 },
  { id: 'rift', group: 'Regions', name: 'Riftsealer', icon: 'mystery', reward: 20,
    text: 'Destroy a Hollow Rift.', check: (c) => !!(c.entry && c.entry.killsBy && c.entry.killsBy.rift > 0) },
  { id: 'wonder', group: 'Regions', name: 'Wonder of the Age', icon: 'castle', reward: 60,
    text: 'Complete a Wonder.', check: (c) => !!(c.entry && c.entry.built && Object.keys(c.entry.built).some((t) => BUILDINGS[t] && (BUILDINGS[t].wonder || BUILDINGS[t].cat === 'wonder'))),
    available: () => Object.values(BUILDINGS).some((d) => d.wonder || d.cat === 'wonder') },

  // ---- Bosses ----
  { id: 'boss_gloomwyrm', group: 'Bosses', name: 'Wyrmfall', icon: 'wyrm', reward: 50,
    text: 'Slay the Gloomwyrm.', check: (c) => !!(c.entry && c.entry.boss === 'gloomwyrm') || (c.meta.codex && (c.meta.codex.bosses || []).includes('gloomwyrm')) },
  { id: 'boss_colossus', group: 'Bosses', name: 'Bonebreaker', icon: 'skull', reward: 80,
    text: 'Shatter the Bone Colossus.', check: (c) => !!(c.entry && c.entry.boss === 'colossus') || (c.meta.codex && (c.meta.codex.bosses || []).includes('colossus')) },
  { id: 'boss_hollowking', group: 'Bosses', name: 'Kingslayer', icon: 'crown', reward: 120,
    text: 'Unmake the Hollow King.', check: (c) => !!(c.entry && c.entry.boss === 'hollowking') || (c.meta.codex && (c.meta.codex.bosses || []).includes('hollowking')) },

  // ---- Runs ----
  { id: 'win', group: 'Runs', name: 'The Realm Rekindled', icon: 'trophy', reward: 100,
    text: 'Win a run.', progress: (m) => life(m).wins || 0, target: 1 },
  { id: 'win_brutal', group: 'Runs', name: 'Through the Fire', icon: 'flame', reward: 150,
    text: 'Win a run on Brutal.', check: (c) => won(c) && c.run.difficulty === 'brutal' },
  { id: 'no_towers', group: 'Runs', name: 'Hands of the People', icon: 'shield', reward: 150,
    get text() { return `Win a run without ever raising a ${orList(towerNames())}.`; },
    check: (c) => won(c) && !!c.run.ext && !!c.run.ext.records && !c.run.ext.records.partial && !c.run.ext.records.towers },
  { id: 'omens_3', group: 'Runs', name: 'Defiance', icon: 'omen', reward: 150,
    text: 'Win a run with 3 or more Omens of Ruin active.', check: (c) => won(c) && omenCount(c.run) >= 3 },
  { id: 'endless_20', group: 'Runs', name: 'The Long Night', icon: 'moon', reward: 80,
    text: 'Survive 20 nights in Endless mode.', progress: (m) => (m.best && m.best.endless) || 0, target: 20 },
  { id: 'daily', group: 'Runs', name: 'Daily Devotion', icon: 'sun', reward: 25,
    text: 'Clear 3 regions in a single Daily Realm.', check: (c) => !!(c.runEnd && c.run.mode === 'daily' && (c.run.regionsCleared || 0) >= 3) },
  { id: 'hoard', group: 'Runs', name: 'Dragon’s Hoard', icon: 'gold', reward: 30,
    text: 'Clear a region and carry 400 gold or more out of it.', check: (c) => regionWon(c) && c.entry.gold >= 400 },

  // ---- Factions (win with each people) ----
  { id: 'win_dawnhold', group: 'Factions', name: 'Banner of the Dawn', icon: 'sun', reward: 60, text: 'Win a run as Dawnhold.', check: factionWin('dawnhold') },
  { id: 'win_sylvari', group: 'Factions', name: 'Song of the Leaves', icon: 'heart', reward: 60, text: 'Win a run as the Sylvari.', check: factionWin('sylvari') },
  { id: 'win_deepforge', group: 'Factions', name: 'Hammer and Hearth', icon: 'hammer', reward: 60, text: 'Win a run as Deepforge.', check: factionWin('deepforge') },
  { id: 'win_emberkin', group: 'Factions', name: 'Drums of Victory', icon: 'flame', reward: 60, text: 'Win a run as the Emberkin.', check: factionWin('emberkin') },
  { id: 'win_mirefolk', group: 'Factions', name: 'Lords of the Mire', icon: 'omen', reward: 80, text: 'Win a run as the Mirefolk.', check: factionWin('mirefolk') },
  { id: 'win_palecourt', group: 'Factions', name: 'The Pale Crown', icon: 'skull', reward: 80, text: 'Win a run as the Pale Court.', check: factionWin('palecourt') },
];
export const ACHIEVEMENT_BY_ID = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));
export const ACH_GROUPS = ['Milestones', 'Codex', 'Regions', 'Bosses', 'Runs', 'Factions'];
/** Feats shown and earnable now (hides ones whose content is not in the game). */
export function activeAchievements() { return ACHIEVEMENTS.filter((a) => !a.available || a.available()); }
