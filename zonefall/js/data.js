'use strict';
// ============================================================================
// ZONEFALL — static game data: items, weapons, recipes, structures, enemies,
// loot tables and zones. Everything tunable lives here.
// ============================================================================

const TILE = 32;
const VERSION = '1.0.0';

const RAR_COL = { common: '#7d827a', uncommon: '#5f9a4f', rare: '#3f7ec8', epic: '#9a52c9', legendary: '#e0a030' };

// ---------------------------------------------------------------------------
// ITEMS
// cat: res | comp | val | med | ammo | throw | gun | melee | armor | helmet | bag | key | art | bp
// ---------------------------------------------------------------------------
const ITEMS = {
  // resources
  wood:       { name: 'Wood', cat: 'res', icon: 'log', col: '#a0703f', stack: 1000, val: 0.2 },
  stone:      { name: 'Stone', cat: 'res', icon: 'rock', col: '#9aa0a6', stack: 1000, val: 0.2 },
  metal_ore:  { name: 'Metal Ore', cat: 'res', icon: 'ore', col: '#a07a62', stack: 1000, val: 0.5 },
  sulfur_ore: { name: 'Sulfur Ore', cat: 'res', icon: 'ore', col: '#d6c64a', stack: 1000, val: 0.5 },
  hqm_ore:    { name: 'HQ Metal Ore', cat: 'res', icon: 'ore', col: '#6aa8d0', stack: 200, val: 4, rar: 'uncommon' },
  metal:      { name: 'Metal Fragments', cat: 'res', icon: 'plate', col: '#b9bec6', stack: 1000, val: 0.6 },
  hqm:        { name: 'HQ Metal', cat: 'res', icon: 'ingot', col: '#8cc4e8', stack: 200, val: 6, rar: 'rare' },
  sulfur:     { name: 'Sulfur', cat: 'res', icon: 'powder', col: '#ead64c', stack: 1000, val: 0.6 },
  charcoal:   { name: 'Charcoal', cat: 'res', icon: 'powder', col: '#3a3a3a', stack: 1000, val: 0.2 },
  gunpowder:  { name: 'Gunpowder', cat: 'res', icon: 'powder', col: '#6b707c', stack: 1000, val: 1 },
  scrap:      { name: 'Scrap', cat: 'res', icon: 'gear', col: '#c98d48', stack: 2000, val: 1, rar: 'uncommon' },
  cloth:      { name: 'Cloth', cat: 'res', icon: 'cloth', col: '#cdb999', stack: 1000, val: 0.5 },

  // components
  pipe:    { name: 'Metal Pipe', cat: 'comp', icon: 'pipe', col: '#9aa3ad', stack: 20, val: 12 },
  spring:  { name: 'Metal Spring', cat: 'comp', icon: 'spring', col: '#b7bcc2', stack: 20, val: 18, rar: 'uncommon' },
  gears:   { name: 'Gears', cat: 'comp', icon: 'gear', col: '#8e959e', stack: 20, val: 12 },
  circuit: { name: 'Circuit Board', cat: 'comp', icon: 'chip', col: '#3f9a55', stack: 20, val: 22, rar: 'uncommon' },
  rope:    { name: 'Rope', cat: 'comp', icon: 'rope', col: '#bb9b62', stack: 20, val: 8 },
  tape:    { name: 'Duct Tape', cat: 'comp', icon: 'tape', col: '#8a8f95', stack: 20, val: 8 },

  // valuables (sell to the Trader)
  cigs:   { name: 'Cigarettes', cat: 'val', icon: 'box', col: '#d8d0b8', stack: 10, val: 14 },
  rotgut: { name: 'Bottle of Rotgut', cat: 'val', icon: 'bottle', col: '#6e8f5a', stack: 5, val: 22 },
  watch:  { name: 'Old Watch', cat: 'val', icon: 'watch', col: '#d4b04a', stack: 5, val: 45, rar: 'uncommon' },
  chain:  { name: 'Gold Chain', cat: 'val', icon: 'chain', col: '#e8c040', stack: 5, val: 70, rar: 'rare' },
  intel:  { name: 'Intel Folder', cat: 'val', icon: 'folder', col: '#c9a35e', stack: 3, val: 120, rar: 'rare' },
  gpu:    { name: 'Graphics Card', cat: 'val', icon: 'gpu', col: '#2e8a4a', stack: 3, val: 260, rar: 'epic' },
  idol:   { name: 'Reactor Idol', cat: 'val', icon: 'idol', col: '#e0a030', stack: 1, val: 600, rar: 'legendary' },

  // medical / consumables
  bandage: { name: 'Bandage', cat: 'med', icon: 'bandage', col: '#e8e0d0', stack: 10, val: 6, use: { heal: 12, bleed: true, time: 1.6 } },
  medkit:  { name: 'Field Medkit', cat: 'med', icon: 'medkit', col: '#d84a3c', stack: 3, val: 40, rar: 'uncommon', use: { heal: 55, bleed: true, time: 3.2 } },
  stim:    { name: 'Combat Stim', cat: 'med', icon: 'syringe', col: '#4ac8d8', stack: 3, val: 60, rar: 'rare', use: { heal: 30, speed: 12, time: 0.7 } },
  antirad: { name: 'Anti-Rad Pills', cat: 'med', icon: 'pill', col: '#5fb85a', stack: 5, val: 25, rar: 'uncommon', use: { rad: -45, time: 1.0 } },
  canned:  { name: 'Canned Stew', cat: 'med', icon: 'can', col: '#b06a3a', stack: 5, val: 8, use: { heal: 8, regen: 12, time: 1.8 } },

  // ammo
  pistol_ammo: { name: 'Pistol Rounds', cat: 'ammo', icon: 'ammo', col: '#d0a84a', stack: 120, val: 0.8 },
  shell:       { name: 'Buckshot Shells', cat: 'ammo', icon: 'shell', col: '#c84a3a', stack: 60, val: 1.5 },
  rifle_ammo:  { name: 'Rifle Rounds', cat: 'ammo', icon: 'ammo2', col: '#c0b070', stack: 120, val: 1.6, rar: 'uncommon' },
  ap_ammo:     { name: 'AP Rifle Rounds', cat: 'ammo', icon: 'ammo2', col: '#7088ff', stack: 120, val: 3, rar: 'rare' },

  // throwables
  grenade: { name: 'Frag Grenade', cat: 'throw', icon: 'grenade', col: '#5d6b3c', stack: 5, val: 30, rar: 'uncommon' },

  // guns
  pipe_pistol: { name: 'Pipe Pistol', cat: 'gun', icon: 'pistol', col: '#8a7a68', stack: 1, val: 40 },
  revolver:    { name: 'Six-Shooter', cat: 'gun', icon: 'revolver', col: '#9a9aa6', stack: 1, val: 90, rar: 'uncommon' },
  boomstick:   { name: 'Boomstick', cat: 'gun', icon: 'shotgun', col: '#7a5a3a', stack: 1, val: 80, rar: 'uncommon' },
  pump:        { name: 'Pump Shotgun', cat: 'gun', icon: 'shotgun', col: '#3c3c42', stack: 1, val: 180, rar: 'rare' },
  smg:         { name: 'Scrap SMG', cat: 'gun', icon: 'smg', col: '#6a6e74', stack: 1, val: 200, rar: 'rare' },
  ar:          { name: 'Assault Rifle', cat: 'gun', icon: 'rifle', col: '#4a4038', stack: 1, val: 420, rar: 'epic' },
  hunting:     { name: 'Bolt Rifle', cat: 'gun', icon: 'sniper', col: '#6a4a2a', stack: 1, val: 360, rar: 'epic' },

  // melee & tools
  knife:     { name: 'Rusty Knife', cat: 'melee', icon: 'blade', col: '#a8a8a8', stack: 1, val: 6 },
  machete:   { name: 'Machete', cat: 'melee', icon: 'blade', col: '#c8ccd2', stack: 1, val: 30, rar: 'uncommon' },
  hatchet:   { name: 'Stone Hatchet', cat: 'melee', icon: 'axe', col: '#9a9aa0', stack: 1, val: 10 },
  pickaxe:   { name: 'Stone Pickaxe', cat: 'melee', icon: 'pick', col: '#9a9aa0', stack: 1, val: 10 },
  salv_axe:  { name: 'Salvaged Axe', cat: 'melee', icon: 'axe', col: '#d0d4da', stack: 1, val: 45, rar: 'uncommon' },
  salv_pick: { name: 'Salvaged Pick', cat: 'melee', icon: 'pick', col: '#d0d4da', stack: 1, val: 45, rar: 'uncommon' },

  // armor
  vest_scrap: { name: 'Scrap Vest', cat: 'armor', icon: 'vest', col: '#8a7a5a', stack: 1, val: 30, armor: 0.18 },
  vest_sign:  { name: 'Road-Sign Vest', cat: 'armor', icon: 'vest', col: '#c8c04a', stack: 1, val: 80, armor: 0.32, rar: 'uncommon' },
  vest_plate: { name: 'Plate Carrier', cat: 'armor', icon: 'vest', col: '#4a5a3a', stack: 1, val: 220, armor: 0.46, spd: 0.96, rar: 'rare' },
  vest_heavy: { name: 'Heavy Plate Armor', cat: 'armor', icon: 'vest', col: '#3a3a44', stack: 1, val: 480, armor: 0.6, spd: 0.86, rar: 'epic' },
  hazmat:     { name: 'Hazmat Suit', cat: 'armor', icon: 'suit', col: '#d8c040', stack: 1, val: 160, armor: 0.1, rad: 0.75, rar: 'rare' },

  helm_bucket: { name: 'Bucket Helmet', cat: 'helmet', icon: 'helmet', col: '#8a8f95', stack: 1, val: 15, armor: 0.08, crit: 0.5 },
  helm_gas:    { name: 'Gas Mask', cat: 'helmet', icon: 'mask', col: '#4a5a3a', stack: 1, val: 70, armor: 0.04, rad: 0.45, crit: 0.3, rar: 'uncommon' },
  helm_riot:   { name: 'Riot Helmet', cat: 'helmet', icon: 'helmet', col: '#2a2a30', stack: 1, val: 120, armor: 0.14, crit: 0.8, rar: 'rare' },
  helm_mil:    { name: 'Military Helmet', cat: 'helmet', icon: 'helmet', col: '#4e5a3a', stack: 1, val: 260, armor: 0.2, crit: 1, rad: 0.15, rar: 'epic' },

  bag_small: { name: 'Satchel Bag', cat: 'bag', icon: 'bag', col: '#9a8460', stack: 1, val: 12, slots: 14 },
  bag_ruck:  { name: 'Rucksack', cat: 'bag', icon: 'bag', col: '#5d6b3c', stack: 1, val: 80, slots: 20, rar: 'uncommon' },
  bag_mil:   { name: 'Military Pack', cat: 'bag', icon: 'bag', col: '#3e4a34', stack: 1, val: 240, slots: 28, rar: 'rare' },

  key_green: { name: 'Green Keycard', cat: 'key', icon: 'card', col: '#3cb050', stack: 3, val: 60, rar: 'uncommon' },
  key_blue:  { name: 'Blue Keycard', cat: 'key', icon: 'card', col: '#3c78d0', stack: 3, val: 160, rar: 'rare' },
  key_red:   { name: 'Red Keycard', cat: 'key', icon: 'card', col: '#d03c3c', stack: 3, val: 400, rar: 'epic' },

  // artifacts (Stalker-style): equip in the artifact belt for bonuses
  art_ember: { name: 'Ember Shard', cat: 'art', icon: 'art', col: '#ff7a3a', stack: 1, val: 180, rar: 'rare', fx: { regen: 1.2, radRate: 0.6 }, desc: '+1.2 HP/s regen, emits radiation' },
  art_moth:  { name: 'Glass Moth', cat: 'art', icon: 'art', col: '#9ae8ff', stack: 1, val: 200, rar: 'rare', fx: { speed: 0.14, radRate: 0.4 }, desc: '+14% move speed, emits radiation' },
  art_bloom: { name: 'Iron Bloom', cat: 'art', icon: 'art', col: '#c0c8d8', stack: 1, val: 260, rar: 'epic', fx: { armor: 0.12, speed: -0.05 }, desc: '+12% armor, -5% speed' },
  art_pearl: { name: 'Void Pearl', cat: 'art', icon: 'art', col: '#8a5aff', stack: 1, val: 300, rar: 'epic', fx: { radRes: 0.5 }, desc: 'Blocks 50% of radiation' },
  art_heart: { name: 'Heartstone', cat: 'art', icon: 'art', col: '#ff3a6a', stack: 1, val: 380, rar: 'legendary', fx: { maxhp: 30, radRate: 0.3 }, desc: '+30 max HP, emits radiation' },
};

const ART_IDS = ['art_ember', 'art_moth', 'art_bloom', 'art_pearl', 'art_heart'];

// ---------------------------------------------------------------------------
// WEAPON STATS
// ---------------------------------------------------------------------------
const WEAPONS = {
  pipe_pistol: { dmg: 16, rof: 3, mag: 8, reload: 1.8, spread: 0.07, speed: 950, range: 360, ammo: 'pistol_ammo', pen: 0.15, noise: 420, sfx: 'pistol', len: 10 },
  revolver:    { dmg: 30, rof: 2, mag: 6, reload: 2.2, spread: 0.04, speed: 1000, range: 430, ammo: 'pistol_ammo', pen: 0.25, noise: 480, sfx: 'pistol', len: 12 },
  boomstick:   { dmg: 9, pellets: 8, rof: 3, mag: 2, reload: 2.4, spread: 0.22, speed: 820, range: 240, ammo: 'shell', pen: 0.05, noise: 620, sfx: 'shotgun', len: 16 },
  pump:        { dmg: 11, pellets: 8, rof: 1.3, mag: 5, reload: 3.0, spread: 0.17, speed: 850, range: 280, ammo: 'shell', pen: 0.08, noise: 620, sfx: 'shotgun', len: 18 },
  smg:         { dmg: 15, rof: 9, mag: 24, reload: 2.4, spread: 0.11, speed: 1000, range: 380, ammo: 'pistol_ammo', pen: 0.2, noise: 520, sfx: 'smg', auto: true, len: 15 },
  ar:          { dmg: 25, rof: 7.5, mag: 30, reload: 2.6, spread: 0.06, speed: 1250, range: 580, ammo: 'rifle_ammo', alt: 'ap_ammo', pen: 0.45, noise: 720, sfx: 'rifle', auto: true, len: 20 },
  hunting:     { dmg: 95, rof: 0.85, mag: 5, reload: 3.2, spread: 0.01, speed: 1600, range: 820, ammo: 'rifle_ammo', alt: 'ap_ammo', pen: 0.6, noise: 820, sfx: 'sniper', len: 24 },
};
// AP ammo adds penetration and a bit of damage
const AMMO_MOD = { ap_ammo: { pen: 0.35, dmg: 1.1 } };

const MELEE = {
  fists:     { dmg: 9, rate: 2.2, reach: 28, wood: 0.35, ore: 0.3 },
  knife:     { dmg: 22, rate: 2.4, reach: 34, wood: 0.5, ore: 0.4 },
  machete:   { dmg: 38, rate: 1.7, reach: 42, wood: 0.8, ore: 0.4 },
  hatchet:   { dmg: 18, rate: 1.9, reach: 36, wood: 1.2, ore: 0.6 },
  pickaxe:   { dmg: 20, rate: 1.7, reach: 36, wood: 0.6, ore: 1.2 },
  salv_axe:  { dmg: 30, rate: 1.8, reach: 38, wood: 2.0, ore: 0.8 },
  salv_pick: { dmg: 32, rate: 1.6, reach: 38, wood: 0.8, ore: 2.0 },
};

// ---------------------------------------------------------------------------
// RECIPES  (wb = workbench tier required, bp = must be learned first)
// ---------------------------------------------------------------------------
const RECIPES = [
  // tier 0 (hand-craft)
  { id: 'bandage', out: 'bandage', n: 1, cost: { cloth: 4 }, wb: 0 },
  { id: 'gunpowder', out: 'gunpowder', n: 10, cost: { charcoal: 30, sulfur: 20 }, wb: 0 },
  { id: 'hatchet', out: 'hatchet', n: 1, cost: { wood: 100, stone: 60 }, wb: 0 },
  { id: 'pickaxe', out: 'pickaxe', n: 1, cost: { wood: 100, stone: 60 }, wb: 0 },
  { id: 'pipe_pistol', out: 'pipe_pistol', n: 1, cost: { wood: 40, metal: 60, pipe: 1 }, wb: 0 },
  { id: 'vest_scrap', out: 'vest_scrap', n: 1, cost: { metal: 40, cloth: 20 }, wb: 0 },
  { id: 'helm_bucket', out: 'helm_bucket', n: 1, cost: { metal: 25 }, wb: 0 },
  { id: 'bag_small', out: 'bag_small', n: 1, cost: { cloth: 30 }, wb: 0 },
  { id: 'canned', out: 'canned', n: 1, cost: { cloth: 2, metal: 5, wood: 10 }, wb: 0 },
  // tier 1
  { id: 'pistol_ammo', out: 'pistol_ammo', n: 20, cost: { metal: 15, gunpowder: 10 }, wb: 1 },
  { id: 'shell', out: 'shell', n: 6, cost: { metal: 12, gunpowder: 12 }, wb: 1 },
  { id: 'boomstick', out: 'boomstick', n: 1, cost: { wood: 100, metal: 80, pipe: 2 }, wb: 1 },
  { id: 'revolver', out: 'revolver', n: 1, cost: { metal: 125, pipe: 1, spring: 1 }, wb: 1, bp: true },
  { id: 'medkit', out: 'medkit', n: 1, cost: { cloth: 15, scrap: 10, bandage: 1 }, wb: 1 },
  { id: 'antirad', out: 'antirad', n: 2, cost: { scrap: 15, cloth: 5 }, wb: 1, bp: true },
  { id: 'grenade', out: 'grenade', n: 1, cost: { metal: 40, gunpowder: 25, rope: 1 }, wb: 1, bp: true },
  { id: 'vest_sign', out: 'vest_sign', n: 1, cost: { metal: 120, cloth: 20, tape: 1 }, wb: 1 },
  { id: 'helm_gas', out: 'helm_gas', n: 1, cost: { metal: 40, cloth: 20, tape: 1 }, wb: 1, bp: true },
  { id: 'bag_ruck', out: 'bag_ruck', n: 1, cost: { cloth: 70, rope: 2 }, wb: 1 },
  { id: 'machete', out: 'machete', n: 1, cost: { metal: 60, wood: 20 }, wb: 1 },
  { id: 'salv_axe', out: 'salv_axe', n: 1, cost: { metal: 120, wood: 40, gears: 1 }, wb: 1 },
  { id: 'salv_pick', out: 'salv_pick', n: 1, cost: { metal: 120, wood: 40, gears: 1 }, wb: 1 },
  // tier 2
  { id: 'rifle_ammo', out: 'rifle_ammo', n: 20, cost: { metal: 30, gunpowder: 25 }, wb: 2 },
  { id: 'smg', out: 'smg', n: 1, cost: { metal: 250, hqm: 4, spring: 1, gears: 1 }, wb: 2, bp: true },
  { id: 'pump', out: 'pump', n: 1, cost: { metal: 200, hqm: 3, pipe: 2, spring: 1 }, wb: 2, bp: true },
  { id: 'vest_plate', out: 'vest_plate', n: 1, cost: { metal: 200, hqm: 8, cloth: 40 }, wb: 2, bp: true },
  { id: 'helm_riot', out: 'helm_riot', n: 1, cost: { metal: 120, hqm: 3, cloth: 20 }, wb: 2 },
  { id: 'hazmat', out: 'hazmat', n: 1, cost: { cloth: 90, tape: 2, metal: 50 }, wb: 2 },
  { id: 'stim', out: 'stim', n: 1, cost: { scrap: 30, cloth: 10, circuit: 1 }, wb: 2, bp: true },
  { id: 'bag_mil', out: 'bag_mil', n: 1, cost: { cloth: 120, rope: 4, hqm: 2 }, wb: 2 },
  // tier 3
  { id: 'ar', out: 'ar', n: 1, cost: { hqm: 30, metal: 200, spring: 2, gears: 2 }, wb: 3, bp: true },
  { id: 'hunting', out: 'hunting', n: 1, cost: { hqm: 15, metal: 150, pipe: 2, spring: 1 }, wb: 3, bp: true },
  { id: 'ap_ammo', out: 'ap_ammo', n: 20, cost: { metal: 30, hqm: 3, gunpowder: 30 }, wb: 3 },
  { id: 'vest_heavy', out: 'vest_heavy', n: 1, cost: { hqm: 40, metal: 300, cloth: 60 }, wb: 3, bp: true },
  { id: 'helm_mil', out: 'helm_mil', n: 1, cost: { hqm: 12, metal: 100, cloth: 20 }, wb: 3 },
];
const RECIPE = Object.fromEntries(RECIPES.map(r => [r.id, r]));

// blueprint items for every bp recipe
for (const r of RECIPES) {
  if (!r.bp) continue;
  ITEMS['bp_' + r.id] = {
    name: 'Blueprint: ' + ITEMS[r.out].name, cat: 'bp', icon: 'bp', col: '#4a8ad8', stack: 1,
    val: 30 + r.wb * 60, rar: r.wb >= 3 ? 'epic' : r.wb === 2 ? 'rare' : 'uncommon', teach: r.id,
  };
}
const BP_BY_TIER = { 1: [], 2: [], 3: [] };
for (const r of RECIPES) if (r.bp) BP_BY_TIER[r.wb].push('bp_' + r.id);
const RESEARCH_COST = { 1: 75, 2: 175, 3: 350 };

// recycling (Recycler structure)
const RECYCLE = {
  pipe: { metal: 6, scrap: 5 }, spring: { metal: 4, hqm: 1, scrap: 8 }, gears: { metal: 13, scrap: 10 },
  circuit: { scrap: 15, hqm: 1 }, rope: { cloth: 15 }, tape: { cloth: 5, scrap: 4 },
  pipe_pistol: { metal: 20, pipe: 1 }, revolver: { metal: 40, spring: 1, scrap: 10 }, boomstick: { metal: 30, pipe: 1 },
  pump: { metal: 60, hqm: 1, spring: 1 }, smg: { metal: 80, hqm: 2, spring: 1 }, ar: { metal: 80, hqm: 10, spring: 1 },
  hunting: { metal: 60, hqm: 6, spring: 1 }, vest_scrap: { metal: 15, cloth: 8 }, vest_sign: { metal: 50, cloth: 8 },
  vest_plate: { metal: 80, hqm: 3, cloth: 15 }, vest_heavy: { metal: 120, hqm: 15 }, hazmat: { cloth: 40, tape: 1 },
  helm_bucket: { metal: 10 }, helm_gas: { metal: 15, cloth: 8 }, helm_riot: { metal: 50, hqm: 1 }, helm_mil: { metal: 40, hqm: 5 },
  machete: { metal: 25 }, salv_axe: { metal: 50, gears: 1 }, salv_pick: { metal: 50, gears: 1 },
  bag_ruck: { cloth: 30, rope: 1 }, bag_mil: { cloth: 50, rope: 2, hqm: 1 },
};

// ---------------------------------------------------------------------------
// STRUCTURES (base building)
// ---------------------------------------------------------------------------
// block: blocks movement; opaque: blocks bullets; door: player may pass
const STRUCTS = {
  core:      { name: 'Claim Cupboard', hp: 1200, block: true, opaque: true, cost: {}, desc: 'The heart of your base. If it falls, the run ends.', noBuild: true },
  wall_wood: { name: 'Wooden Wall', hp: 260, block: true, opaque: true, cost: { wood: 40 }, wb: 0, upg: 'wall_stone', cat: 'wall', desc: 'Cheap. Burns through fast.' },
  wall_stone:{ name: 'Stone Wall', hp: 650, block: true, opaque: true, cost: { stone: 60 }, wb: 0, upg: 'wall_metal', cat: 'wall', desc: 'Solid early defense.' },
  wall_metal:{ name: 'Sheet Metal Wall', hp: 1300, block: true, opaque: true, cost: { metal: 50 }, wb: 1, upg: 'wall_armor', cat: 'wall', desc: 'Resists explosives better.' },
  wall_armor:{ name: 'Armored Wall', hp: 2800, block: true, opaque: true, cost: { hqm: 6, metal: 40 }, wb: 3, cat: 'wall', desc: 'The best protection there is.' },
  door_wood: { name: 'Wooden Door', hp: 220, block: true, opaque: true, door: true, cost: { wood: 70 }, wb: 0, upg: 'door_metal', cat: 'wall', desc: 'You can walk through. Raiders cannot.' },
  door_metal:{ name: 'Metal Door', hp: 900, block: true, opaque: true, door: true, cost: { metal: 60, gears: 1 }, wb: 1, cat: 'wall', desc: 'A door that holds.' },
  embrasure: { name: 'Embrasure', hp: 600, block: true, opaque: false, cost: { stone: 40, wood: 20 }, wb: 0, cat: 'wall', desc: 'Blocks movement but you can shoot through it.' },
  spikes:    { name: 'Wooden Spikes', hp: 160, block: false, opaque: false, cost: { wood: 60 }, wb: 0, trap: true, cat: 'trap', desc: 'Hurts and slows raiders walking over it.' },
  landmine:  { name: 'Landmine', hp: 50, block: false, opaque: false, cost: { metal: 25, gunpowder: 20 }, wb: 1, trap: true, cat: 'trap', desc: 'Explodes under the first raider to step on it.' },
  shotgun_trap: { name: 'Shotgun Trap', hp: 300, block: true, opaque: true, cost: { wood: 100, metal: 40, pipe: 1 }, wb: 1, turret: { range: 3.6 * TILE, rof: 1.1, dmg: 10, pellets: 6, spread: 0.35, ammo: 'shell', use: 1 }, cat: 'turret', desc: 'Close-range blast. Uses Buckshot from your stash.' },
  auto_turret:  { name: 'Auto Turret', hp: 700, block: true, opaque: true, cost: { metal: 150, hqm: 5, circuit: 2 }, wb: 2, turret: { range: 7.5 * TILE, rof: 6, dmg: 13, pellets: 1, spread: 0.06, ammo: 'pistol_ammo', use: 1 }, cat: 'turret', desc: 'Shreds raiders at range. Uses Pistol Rounds from your stash.' },
  campfire:  { name: 'Campfire', hp: 120, block: false, opaque: false, cost: { wood: 30, stone: 10 }, wb: 0, light: 4.5, cat: 'util', desc: 'Light in the darkness.' },
  floodlight:{ name: 'Floodlight', hp: 200, block: true, opaque: false, cost: { metal: 40, circuit: 1 }, wb: 1, light: 8, cat: 'util', desc: 'Lights up a wide area at night.' },
  workbench1:{ name: 'Workbench T1', hp: 500, block: true, opaque: true, cost: { wood: 200, metal: 60, scrap: 30 }, wb: 0, unique: true, cat: 'util', desc: 'Unlocks tier 1 crafting.' },
  workbench2:{ name: 'Workbench T2', hp: 800, block: true, opaque: true, cost: { metal: 350, hqm: 10, scrap: 200 }, wb: 1, unique: true, cat: 'util', desc: 'Unlocks tier 2 crafting.' },
  workbench3:{ name: 'Workbench T3', hp: 1200, block: true, opaque: true, cost: { metal: 800, hqm: 40, scrap: 500 }, wb: 2, unique: true, cat: 'util', desc: 'Unlocks tier 3 crafting.' },
  furnace:   { name: 'Furnace', hp: 400, block: true, opaque: true, cost: { stone: 150, wood: 30 }, wb: 0, unique: true, light: 2.5, cat: 'util', desc: 'Smelts ore. Burns wood into charcoal.' },
  research:  { name: 'Research Table', hp: 400, block: true, opaque: true, cost: { metal: 150, scrap: 60 }, wb: 0, unique: true, cat: 'util', desc: 'Spend scrap to learn blueprints from items.' },
  recycler:  { name: 'Recycler', hp: 600, block: true, opaque: true, cost: { metal: 250, scrap: 120, gears: 3 }, wb: 1, unique: true, cat: 'util', desc: 'Breaks components and gear back down into resources.' },
  planter:   { name: 'Planter Box', hp: 200, block: true, opaque: false, cost: { wood: 80, cloth: 10 }, wb: 0, cat: 'util', prod: { cloth: 12 }, desc: 'Grows hemp: +12 Cloth every dawn.' },
  water:     { name: 'Water Barrel', hp: 200, block: true, opaque: false, cost: { wood: 60, metal: 20 }, wb: 0, cat: 'util', prod: { heal: 1 }, desc: 'Fully heals you at dawn and doubles your passive regen at base.' },
  bed:       { name: 'Bed', hp: 200, block: false, opaque: false, cost: { wood: 60, cloth: 30 }, wb: 0, unique: true, cat: 'util', desc: 'Respawn here instantly if you fall during a raid.' },
  quarry:    { name: 'Mini Quarry', hp: 500, block: true, opaque: true, cost: { metal: 200, gears: 2, wood: 200 }, wb: 1, cat: 'util', prod: { stone: 120, metal_ore: 50, sulfur_ore: 40 }, desc: 'Digs stone, metal and sulfur ore every dawn.' },
};
const BUILD_ORDER = ['wall_wood', 'door_wood', 'embrasure', 'spikes', 'landmine', 'shotgun_trap', 'auto_turret', 'campfire', 'floodlight',
  'workbench1', 'workbench2', 'workbench3', 'furnace', 'research', 'recycler', 'planter', 'water', 'quarry', 'bed', 'wall_metal', 'door_metal'];

const CORE_LEVELS = [
  { r: 5, hp: 1200, cost: null },
  { r: 8, hp: 2200, cost: { wood: 500, stone: 500, metal: 100 } },
  { r: 11, hp: 4000, cost: { metal: 600, hqm: 15, scrap: 200 } },
  { r: 14, hp: 7000, cost: { metal: 1500, hqm: 50, scrap: 600 } },
];

// ---------------------------------------------------------------------------
// ENEMIES
// ---------------------------------------------------------------------------
// kind: beast | human | mutant
const ENEMIES = {
  dog:     { name: 'Mutt', kind: 'beast', hp: 42, speed: 150, r: 10, col: '#6b5a48', melee: { dmg: 8, rate: 1.2, reach: 22, bleed: 0.3 }, sight: 280, xp: 4, drop: 'beast' },
  boar:    { name: 'Boar', kind: 'beast', hp: 100, speed: 85, charge: 240, r: 13, col: '#5a4232', melee: { dmg: 15, rate: 0.9, reach: 24, bleed: 0.2 }, sight: 220, xp: 6, drop: 'beast' },
  scav:    { name: 'Scav', kind: 'human', hp: 70, speed: 88, r: 10, col: '#7a6a4a', guns: ['pipe_pistol', 'pipe_pistol', 'boomstick'], armor: [0, 0.18], sight: 320, acc: 0.6, xp: 8, drop: 'human1' },
  bandit:  { name: 'Bandit', kind: 'human', hp: 90, speed: 92, r: 10, col: '#5a3a3a', guns: ['revolver', 'smg', 'boomstick', 'pump'], armor: [0.18, 0.32], helm: 0.5, sight: 360, acc: 0.7, xp: 12, drop: 'human2' },
  soldier: { name: 'Soldier', kind: 'human', hp: 110, speed: 95, r: 11, col: '#3e4a34', guns: ['ar', 'ar', 'smg', 'pump'], armor: [0.38, 0.5], helm: 1, sight: 420, acc: 0.8, xp: 18, drop: 'human3' },
  lurker:  { name: 'Lurker', kind: 'mutant', hp: 200, speed: 165, r: 12, col: '#8a6a7a', melee: { dmg: 26, rate: 1.0, reach: 26, bleed: 0.5 }, sight: 300, stealth: true, xp: 25, drop: 'mutant' },
  warlord: { name: 'The Warlord', kind: 'human', hp: 700, speed: 82, r: 14, col: '#2a2a2a', guns: ['ar'], armor: [0.55, 0.55], helm: 1, sight: 460, acc: 0.85, xp: 120, boss: true, drop: 'boss' },
  // night raiders (base defense)
  thug:     { name: 'Raider', kind: 'human', hp: 65, speed: 95, r: 10, col: '#7a3a2a', melee: { dmg: 12, rate: 1.2, reach: 24, struct: 22 }, sight: 260, raider: true, xp: 5, drop: 'raider' },
  gunner:   { name: 'Raider Gunner', kind: 'human', hp: 75, speed: 85, r: 10, col: '#8a4a2a', guns: ['pipe_pistol', 'revolver', 'boomstick'], armor: [0, 0.18], sight: 330, acc: 0.55, raider: true, xp: 7, drop: 'raider' },
  breacher: { name: 'Breacher', kind: 'human', hp: 90, speed: 100, r: 11, col: '#a85a1a', breach: true, armor: [0.18, 0.18], sight: 240, raider: true, xp: 10, drop: 'raider' },
  brute:    { name: 'Armored Brute', kind: 'human', hp: 170, speed: 78, r: 13, col: '#4a3a3a', guns: ['pump', 'smg'], armor: [0.4, 0.5], helm: 1, sight: 330, acc: 0.65, raider: true, xp: 16, drop: 'raider2' },
  rocketeer:{ name: 'Rocketeer', kind: 'human', hp: 100, speed: 80, r: 11, col: '#6a2a4a', rocket: true, armor: [0.3, 0.3], sight: 520, raider: true, xp: 18, drop: 'raider2' },
  ironjack: { name: 'Iron Jack', kind: 'human', hp: 900, speed: 75, r: 15, col: '#1e1e22', guns: ['ar'], armor: [0.6, 0.6], helm: 1, sight: 460, acc: 0.8, raider: true, boss: true, breachBoss: true, xp: 150, drop: 'boss' },
};

// ---------------------------------------------------------------------------
// LOOT TABLES: [id, weight, min, max]
// ---------------------------------------------------------------------------
const LOOT = {
  barrel: { rolls: [1, 2], items: [['scrap', 10, 2, 6], ['metal', 6, 8, 25], ['pipe', 4, 1, 1], ['gears', 3, 1, 1], ['spring', 1.5, 1, 1], ['rope', 3, 1, 1], ['tape', 3, 1, 1], ['pistol_ammo', 3, 4, 10], ['cloth', 3, 4, 10]] },
  crate: { rolls: [2, 4], items: [['wood', 6, 20, 60], ['metal', 7, 15, 40], ['cloth', 7, 5, 15], ['scrap', 9, 4, 12], ['pistol_ammo', 6, 8, 18], ['shell', 4, 3, 8], ['bandage', 6, 1, 2], ['canned', 5, 1, 2], ['rope', 3, 1, 1], ['pipe', 4, 1, 1], ['spring', 2, 1, 1], ['gears', 3, 1, 2], ['tape', 3, 1, 1], ['gunpowder', 3, 10, 25], ['cigs', 4, 1, 2], ['rotgut', 2, 1, 1], ['watch', 1.2, 1, 1], ['bp_t1', 1.2, 1, 1], ['key_green', 0.7, 1, 1], ['pipe_pistol', 1, 1, 1], ['machete', 0.6, 1, 1], ['vest_scrap', 0.8, 1, 1], ['helm_bucket', 0.8, 1, 1]] },
  toolbox: { rolls: [2, 3], items: [['pipe', 6, 1, 2], ['spring', 4, 1, 1], ['gears', 6, 1, 2], ['circuit', 3, 1, 1], ['tape', 5, 1, 2], ['rope', 4, 1, 2], ['metal', 4, 20, 50], ['scrap', 5, 5, 15], ['salv_axe', 0.5, 1, 1], ['salv_pick', 0.5, 1, 1]] },
  medbox: { rolls: [2, 3], items: [['bandage', 10, 1, 3], ['medkit', 4, 1, 1], ['antirad', 4, 1, 2], ['stim', 1, 1, 1], ['canned', 4, 1, 2], ['cloth', 3, 8, 16], ['bp_antirad', 0.7, 1, 1], ['bp_stim', 0.4, 1, 1]] },
  ammobox: { rolls: [2, 3], items: [['pistol_ammo', 10, 12, 30], ['shell', 6, 5, 12], ['rifle_ammo', 4, 10, 25], ['ap_ammo', 0.6, 6, 15], ['gunpowder', 5, 15, 35], ['grenade', 1.2, 1, 1]] },
  military: { rolls: [3, 5], items: [['rifle_ammo', 8, 15, 35], ['pistol_ammo', 5, 15, 30], ['shell', 4, 8, 14], ['ap_ammo', 1.5, 8, 20], ['grenade', 3, 1, 2], ['medkit', 4, 1, 1], ['stim', 1.5, 1, 1], ['antirad', 3, 1, 2], ['hqm', 4, 2, 6], ['circuit', 3, 1, 2], ['spring', 3, 1, 2], ['revolver', 1.2, 1, 1], ['smg', 1, 1, 1], ['pump', 1, 1, 1], ['ar', 0.35, 1, 1], ['vest_sign', 1.5, 1, 1], ['vest_plate', 0.6, 1, 1], ['helm_riot', 1, 1, 1], ['helm_gas', 1.2, 1, 1], ['bag_ruck', 0.8, 1, 1], ['bp_t2', 1.6, 1, 1], ['key_blue', 0.7, 1, 1], ['intel', 1.2, 1, 1], ['watch', 1.5, 1, 1]] },
  elite: { rolls: [4, 6], items: [['ap_ammo', 5, 15, 30], ['rifle_ammo', 5, 25, 45], ['grenade', 3, 1, 3], ['medkit', 4, 1, 2], ['stim', 3, 1, 2], ['hqm', 6, 5, 15], ['ar', 1.5, 1, 1], ['hunting', 1.5, 1, 1], ['vest_plate', 1.5, 1, 1], ['vest_heavy', 0.6, 1, 1], ['helm_mil', 1, 1, 1], ['hazmat', 1, 1, 1], ['bag_mil', 1, 1, 1], ['bp_t3', 2.5, 1, 1], ['bp_t2', 1.5, 1, 1], ['key_red', 0.8, 1, 1], ['gpu', 1.2, 1, 1], ['intel', 2, 1, 1], ['chain', 2, 1, 1]] },
  cache: { rolls: [2, 4], items: [['scrap', 6, 15, 40], ['antirad', 3, 1, 2], ['medkit', 2, 1, 1], ['chain', 2, 1, 1], ['watch', 3, 1, 1], ['rifle_ammo', 3, 10, 20], ['pistol_ammo', 4, 15, 30], ['bp_t1', 2, 1, 1], ['bp_t2', 1.2, 1, 1], ['key_green', 1.2, 1, 1], ['key_blue', 0.5, 1, 1], ['grenade', 1.5, 1, 1]] },
  // corpses
  beast: { rolls: [0, 1], items: [['cloth', 6, 3, 8], ['canned', 2, 1, 1]] },
  mutant: { rolls: [1, 2], items: [['cloth', 3, 5, 12], ['scrap', 4, 10, 25], ['antirad', 2, 1, 1], ['art_any', 0.5, 1, 1], ['idol', 0.08, 1, 1]] },
  human1: { rolls: [1, 2], items: [['pistol_ammo', 8, 4, 12], ['shell', 3, 2, 5], ['bandage', 5, 1, 2], ['scrap', 5, 3, 10], ['cigs', 4, 1, 1], ['canned', 3, 1, 1], ['key_green', 0.5, 1, 1]] },
  human2: { rolls: [1, 3], items: [['pistol_ammo', 6, 8, 18], ['shell', 4, 3, 8], ['bandage', 5, 1, 2], ['medkit', 1.5, 1, 1], ['scrap', 5, 6, 15], ['rotgut', 2, 1, 1], ['watch', 1, 1, 1], ['bp_t1', 0.8, 1, 1], ['key_green', 0.8, 1, 1], ['grenade', 0.8, 1, 1]] },
  human3: { rolls: [2, 3], items: [['rifle_ammo', 8, 10, 25], ['ap_ammo', 1, 5, 12], ['medkit', 3, 1, 1], ['stim', 1, 1, 1], ['grenade', 2, 1, 1], ['hqm', 2, 1, 4], ['intel', 1, 1, 1], ['bp_t2', 0.7, 1, 1], ['key_blue', 0.5, 1, 1]] },
  boss: { rolls: [4, 5], items: [['ap_ammo', 5, 20, 40], ['stim', 4, 1, 2], ['medkit', 4, 1, 2], ['hqm', 5, 10, 20], ['vest_heavy', 2, 1, 1], ['helm_mil', 2, 1, 1], ['bp_t3', 4, 1, 1], ['key_red', 3, 1, 1], ['gpu', 2, 1, 1], ['chain', 3, 1, 2]] },
  raider: { rolls: [0, 2], items: [['scrap', 8, 3, 10], ['metal', 5, 10, 25], ['pistol_ammo', 4, 4, 10], ['cloth', 4, 4, 10], ['gunpowder', 3, 5, 15], ['bandage', 3, 1, 1], ['cigs', 2, 1, 1]] },
  raider2: { rolls: [1, 2], items: [['scrap', 8, 10, 20], ['hqm', 3, 1, 3], ['shell', 4, 4, 8], ['pistol_ammo', 4, 8, 16], ['gunpowder', 4, 10, 25], ['medkit', 1.5, 1, 1], ['bp_t1', 1, 1, 1], ['bp_t2', 0.5, 1, 1]] },
};

const CONTAINERS = {
  barrel:   { name: 'Barrel', loot: 'barrel', breakable: true, col: '#5a6a7a', search: 0 },
  crate:    { name: 'Wooden Crate', loot: 'crate', col: '#8a6a3a', search: 0.35 },
  toolbox:  { name: 'Toolbox', loot: 'toolbox', col: '#b03a2a', search: 0.35 },
  medbox:   { name: 'Medical Box', loot: 'medbox', col: '#e8e8e0', search: 0.35 },
  ammobox:  { name: 'Ammo Box', loot: 'ammobox', col: '#4e5a34', search: 0.4 },
  military: { name: 'Military Crate', loot: 'military', col: '#3e4a2e', search: 0.5 },
  elite:    { name: 'Elite Crate', loot: 'elite', col: '#2a3a4a', search: 0.6 },
  cache:    { name: 'Hidden Stash', loot: 'cache', col: '#5a4a3a', search: 0.45 },
  corpse:   { name: 'Body', col: '#000', search: 0.3 },
};

// ---------------------------------------------------------------------------
// ZONES (expedition destinations)
// ---------------------------------------------------------------------------
const ZONES = [
  {
    id: 'outskirts', name: 'Pine Outskirts', tier: 1, danger: 1, size: 70, time: 330,
    desc: 'Overgrown forest at the edge of the Zone. Trees, ore, wildlife and a few desperate scavs.',
    ground: ['#3a4a2e', '#34442a', '#3e4e32'], trees: 0.07, rocks: 0.025, ores: 0.012, houses: 3, sheds: 3,
    barrels: 20, crates: 8, caches: 2, anomalies: 2, rads: 1, radPow: 4,
    spawns: [['dog', 4, [2, 3]], ['boar', 3, [1, 1]], ['scav', 4, [1, 2]]],
    loot: { crate: 6, toolbox: 2, medbox: 2, ammobox: 1 },
  },
  {
    id: 'village', name: 'Hollow Creek', tier: 1, danger: 2, size: 74, time: 330,
    desc: 'An abandoned village. Many houses to loot — and bandits who think so too.',
    ground: ['#46503a', '#414b36', '#4b553e'], trees: 0.03, rocks: 0.012, ores: 0.006, houses: 11, sheds: 4, roads: true,
    barrels: 24, crates: 14, caches: 3, anomalies: 3, rads: 2, radPow: 6,
    spawns: [['scav', 5, [1, 3]], ['bandit', 3, [1, 2]], ['dog', 2, [2, 3]]],
    loot: { crate: 10, toolbox: 4, medbox: 4, ammobox: 3, military: 1 },
  },
  {
    id: 'radar', name: 'Dish Array', tier: 2, danger: 3, size: 78, time: 360, monument: 'radar',
    desc: 'A radar monument. Irradiated core behind a GREEN keycard door holds military loot.',
    ground: ['#4a4a3e', '#454538', '#504f42'], trees: 0.025, rocks: 0.02, ores: 0.012, houses: 4, sheds: 3, roads: true,
    barrels: 26, crates: 10, caches: 3, anomalies: 5, rads: 3, radPow: 10, radCenter: 14,
    spawns: [['bandit', 5, [1, 2]], ['scav', 3, [1, 2]], ['soldier', 2, [1, 2]], ['dog', 2, [2, 3]]],
    loot: { crate: 8, toolbox: 4, medbox: 3, ammobox: 4, military: 3 }, vault: { key: 'key_green', loot: ['military', 'military', 'elite', 'ammobox'] },
  },
  {
    id: 'garrison', name: 'Garrison 9', tier: 3, danger: 4, size: 82, time: 360, monument: 'garrison', boss: 'warlord',
    desc: 'A fortified military base held by soldiers and the Warlord. BLUE keycard armory.',
    ground: ['#4c4a40', '#47453b', '#525046'], trees: 0.015, rocks: 0.012, ores: 0.01, houses: 3, sheds: 5, roads: true,
    barrels: 26, crates: 8, caches: 3, anomalies: 4, rads: 2, radPow: 8,
    spawns: [['soldier', 7, [1, 3]], ['bandit', 3, [1, 2]]],
    loot: { crate: 6, toolbox: 4, medbox: 4, ammobox: 6, military: 6 }, vault: { key: 'key_blue', loot: ['elite', 'elite', 'military', 'ammobox'] },
  },
  {
    id: 'reactor', name: 'Reactor Sector', tier: 4, danger: 5, size: 86, time: 380, monument: 'reactor',
    desc: 'The heart of the Zone. Lethal radiation, Lurkers, artifacts. RED keycard vault.',
    ground: ['#3e3a40', '#39353b', '#433f45'], trees: 0.01, rocks: 0.02, ores: 0.015, houses: 3, sheds: 3, roads: true,
    barrels: 22, crates: 6, caches: 4, anomalies: 10, rads: 5, radPow: 14, radCenter: 22,
    spawns: [['lurker', 5, [1, 2]], ['soldier', 4, [1, 3]], ['dog', 3, [3, 4]]],
    loot: { crate: 4, toolbox: 3, medbox: 4, ammobox: 4, military: 5, elite: 2 }, vault: { key: 'key_red', loot: ['elite', 'elite', 'elite', 'military'], artifacts: 2 },
  },
];

// ---------------------------------------------------------------------------
// PERKS (meta progression between runs)
// ---------------------------------------------------------------------------
const PERKS = [
  { id: 'pockets', name: 'Deep Pockets', cost: 3, desc: 'Secure pouch holds 5 items instead of 3.' },
  { id: 'kit', name: 'Survivor Kit', cost: 4, desc: 'Start each run with a Boomstick and 12 shells.' },
  { id: 'stockpile', name: 'Stockpile', cost: 5, desc: 'Start with +300 wood, +300 stone, +100 metal.' },
  { id: 'medic', name: 'Field Medic', cost: 4, desc: 'Healing items work 30% faster and heal 20% more.' },
  { id: 'scholar', name: 'Scholar', cost: 6, desc: 'Start with Revolver and Anti-Rad blueprints known.' },
  { id: 'tough', name: 'Thick Skin', cost: 6, desc: '+20 max HP.' },
  { id: 'scavenger', name: 'Scavenger', cost: 7, desc: 'Containers roll one extra item.' },
  { id: 'engineer', name: 'Engineer', cost: 8, desc: 'Structures have +25% HP. Start with a Workbench T1.' },
];

const TIPS = [
  'Raids get bigger every night. Upgrade walls from wood to stone to metal.',
  'Breachers carry satchel charges — kill them before they reach your walls.',
  'Anything in your secure pouch survives death in the Zone.',
  'Hold the Interact button to gather from trees and rocks.',
  'The Emission comes when the clock runs out. Get indoors or extract!',
  'Turrets pull ammo from your stash. Keep it stocked.',
  'Valuables like watches and graphics cards sell to the Trader for scrap.',
  'Research Tables turn an item into a permanent blueprint.',
  'Radiation drains health. Anti-Rad pills, gas masks and hazmat suits help.',
  'Artifacts sit inside anomalies — the shimmering distortions. Approach carefully.',
  'Gunshots are loud. Every enemy nearby will come looking.',
  'Raiders follow the weakest path to your Cupboard. Use that.',
];
