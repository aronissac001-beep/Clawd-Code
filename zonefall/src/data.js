// ============================================================================
// ZONEFALL 3 — static game data. Units: metres, seconds.
// ============================================================================
export const VERSION = '4.5.0';

export const RAR_COL = { common: '#7d827a', uncommon: '#5f9a4f', rare: '#3f7ec8', epic: '#9a52c9', legendary: '#e0a030' };

// ---------------------------------------------------------------------------
// ITEMS  cat: res comp val food drink med ammo throw gun melee armor helmet bag key art bp
// ---------------------------------------------------------------------------
export const ITEMS = {
  wood: { name: 'Wood', cat: 'res', col: '#a0703f', stack: 1000, val: 0.2 },
  stone: { name: 'Stone', cat: 'res', col: '#9aa0a6', stack: 1000, val: 0.2 },
  metal_ore: { name: 'Metal Ore', cat: 'res', col: '#a07a62', stack: 1000, val: 0.5 },
  sulfur_ore: { name: 'Sulfur Ore', cat: 'res', col: '#d6c64a', stack: 1000, val: 0.5 },
  hqm_ore: { name: 'HQ Metal Ore', cat: 'res', col: '#6aa8d0', stack: 200, val: 4, rar: 'uncommon' },
  metal: { name: 'Metal Fragments', cat: 'res', col: '#b9bec6', stack: 1000, val: 0.6 },
  hqm: { name: 'HQ Metal', cat: 'res', col: '#8cc4e8', stack: 200, val: 6, rar: 'rare' },
  sulfur: { name: 'Sulfur', cat: 'res', col: '#ead64c', stack: 1000, val: 0.6 },
  charcoal: { name: 'Charcoal', cat: 'res', col: '#3a3a3a', stack: 1000, val: 0.2 },
  gunpowder: { name: 'Gunpowder', cat: 'res', col: '#6b707c', stack: 1000, val: 1 },
  explosives: { name: 'Explosives', cat: 'res', col: '#9a3a2a', stack: 100, val: 12, rar: 'uncommon' },
  scrap: { name: 'Scrap', cat: 'res', col: '#c98d48', stack: 2000, val: 1, rar: 'uncommon' },
  cloth: { name: 'Cloth', cat: 'res', col: '#cdb999', stack: 1000, val: 0.5 },
  leather: { name: 'Leather', cat: 'res', col: '#8a5a36', stack: 500, val: 0.8 },
  animal_fat: { name: 'Animal Fat', cat: 'res', col: '#e8dcb0', stack: 500, val: 0.4 },
  bone: { name: 'Bone Fragments', cat: 'res', col: '#e6dcc6', stack: 500, val: 0.3 },
  low_fuel: { name: 'Low Grade Fuel', cat: 'res', col: '#c8783a', stack: 500, val: 1.2 },

  pipe: { name: 'Metal Pipe', cat: 'comp', col: '#9aa3ad', stack: 20, val: 12 },
  spring: { name: 'Metal Spring', cat: 'comp', col: '#b7bcc2', stack: 20, val: 18, rar: 'uncommon' },
  gears: { name: 'Gears', cat: 'comp', col: '#8e959e', stack: 20, val: 12 },
  circuit: { name: 'Circuit Board', cat: 'comp', col: '#3f9a55', stack: 20, val: 22, rar: 'uncommon' },
  rope: { name: 'Rope', cat: 'comp', col: '#bb9b62', stack: 20, val: 8 },
  tape: { name: 'Duct Tape', cat: 'comp', col: '#8a8f95', stack: 20, val: 8 },
  fuse: { name: 'Electric Fuse', cat: 'comp', col: '#d0b040', stack: 5, val: 30, rar: 'uncommon', desc: 'Powers card readers at monuments.' },

  cigs: { name: 'Cigarettes', cat: 'val', col: '#d8d0b8', stack: 10, val: 14 },
  rotgut: { name: 'Bottle of Rotgut', cat: 'val', col: '#6e8f5a', stack: 5, val: 22 },
  watch: { name: 'Old Watch', cat: 'val', col: '#d4b04a', stack: 5, val: 45, rar: 'uncommon' },
  chain: { name: 'Gold Chain', cat: 'val', col: '#e8c040', stack: 5, val: 70, rar: 'rare' },
  intel: { name: 'Intel Folder', cat: 'val', col: '#c9a35e', stack: 3, val: 120, rar: 'rare' },
  gpu: { name: 'Graphics Card', cat: 'val', col: '#2e8a4a', stack: 3, val: 260, rar: 'epic' },
  idol: { name: 'Reactor Idol', cat: 'val', col: '#e0a030', stack: 1, val: 600, rar: 'legendary' },

  raw_meat: { name: 'Raw Meat', cat: 'food', col: '#c0504a', stack: 20, val: 1, use: { food: 6, hp: -4, time: 1.2 }, cook: 'cooked_meat', desc: 'Cook it on a campfire first.' },
  cooked_meat: { name: 'Cooked Meat', cat: 'food', col: '#8a5030', stack: 20, val: 3, use: { food: 32, water: -2, hp: 6, time: 1.4 } },
  berries: { name: 'Wild Berries', cat: 'food', col: '#c0304a', stack: 20, val: 1, use: { food: 8, water: 5, time: 0.8 } },
  mushroom: { name: 'Mushroom', cat: 'food', col: '#c8a070', stack: 20, val: 1, use: { food: 12, hp: 2, time: 0.9 } },
  canned: { name: 'Canned Stew', cat: 'food', col: '#b06a3a', stack: 10, val: 8, use: { food: 30, water: 5, hp: 8, time: 1.6 } },
  water_bottle: { name: 'Water Bottle', cat: 'drink', col: '#5aa0d8', stack: 5, val: 4, use: { water: 45, time: 1.2 } },

  bandage: { name: 'Bandage', cat: 'med', col: '#e8e0d0', stack: 10, val: 6, use: { hp: 12, bleed: true, time: 1.6 } },
  medkit: { name: 'Field Medkit', cat: 'med', col: '#d84a3c', stack: 3, val: 40, rar: 'uncommon', use: { hp: 55, bleed: true, time: 3.0 } },
  stim: { name: 'Combat Stim', cat: 'med', col: '#4ac8d8', stack: 3, val: 60, rar: 'rare', use: { hp: 30, speed: 12, time: 0.7 } },
  antirad: { name: 'Anti-Rad Pills', cat: 'med', col: '#5fb85a', stack: 5, val: 25, rar: 'uncommon', use: { rad: -45, time: 1.0 } },

  arrow: { name: 'Wooden Arrow', cat: 'ammo', col: '#b08a58', stack: 64, val: 0.5 },
  pistol_ammo: { name: 'Pistol Rounds', cat: 'ammo', col: '#d0a84a', stack: 128, val: 0.8 },
  shell: { name: 'Buckshot Shells', cat: 'ammo', col: '#c84a3a', stack: 64, val: 1.5 },
  rifle_ammo: { name: 'Rifle Rounds', cat: 'ammo', col: '#c0b070', stack: 128, val: 1.6, rar: 'uncommon' },
  ap_ammo: { name: 'AP Rifle Rounds', cat: 'ammo', col: '#7088ff', stack: 128, val: 3, rar: 'rare' },
  rocket: { name: 'Rocket', cat: 'ammo', col: '#6a7a4a', stack: 6, val: 80, rar: 'epic' },

  beancan: { name: 'Beancan Grenade', cat: 'throw', col: '#8a8f95', stack: 10, val: 10 },
  grenade: { name: 'Frag Grenade', cat: 'throw', col: '#5d6b3c', stack: 5, val: 30, rar: 'uncommon' },
  satchel: { name: 'Satchel Charge', cat: 'throw', col: '#8a7048', stack: 10, val: 40, rar: 'uncommon', desc: 'Throw at walls and doors. Blows a hole in wood.' },
  c4: { name: 'Timed Explosive', cat: 'throw', col: '#6a7058', stack: 6, val: 200, rar: 'epic', desc: 'Sticks and destroys almost anything.' },
  supply_signal: { name: 'Supply Signal', cat: 'throw', col: '#8a5ac8', stack: 3, val: 90, rar: 'rare', desc: 'Throw to call an airdrop on the smoke.' },

  bow: { name: 'Hunting Bow', cat: 'gun', col: '#9a6a3a', stack: 1, val: 20 },
  pipe_pistol: { name: 'Pipe Pistol', cat: 'gun', col: '#8a7a68', stack: 1, val: 40 },
  revolver: { name: 'Six-Shooter', cat: 'gun', col: '#9a9aa6', stack: 1, val: 90, rar: 'uncommon' },
  boomstick: { name: 'Boomstick', cat: 'gun', col: '#7a5a3a', stack: 1, val: 80, rar: 'uncommon' },
  pump: { name: 'Pump Shotgun', cat: 'gun', col: '#3c3c42', stack: 1, val: 180, rar: 'rare' },
  smg: { name: 'Scrap SMG', cat: 'gun', col: '#6a6e74', stack: 1, val: 200, rar: 'rare' },
  ar: { name: 'Assault Rifle', cat: 'gun', col: '#4a4038', stack: 1, val: 420, rar: 'epic' },
  hunting: { name: 'Bolt Rifle', cat: 'gun', col: '#6a4a2a', stack: 1, val: 360, rar: 'epic' },
  rocket_launcher: { name: 'Rocket Launcher', cat: 'gun', col: '#4e5a3a', stack: 1, val: 500, rar: 'epic' },

  rock: { name: 'Rock', cat: 'melee', col: '#8a8a8a', stack: 1, val: 0, desc: 'Gathers a little wood and stone.' },
  torch: { name: 'Torch', cat: 'melee', col: '#a0703f', stack: 1, val: 2, desc: 'Light in the dark.' },
  spear_wood: { name: 'Wooden Spear', cat: 'melee', col: '#a0703f', stack: 1, val: 4 },
  knife: { name: 'Rusty Knife', cat: 'melee', col: '#a8a8a8', stack: 1, val: 6 },
  machete: { name: 'Machete', cat: 'melee', col: '#c8ccd2', stack: 1, val: 30, rar: 'uncommon' },
  hatchet: { name: 'Stone Hatchet', cat: 'melee', col: '#9a9aa0', stack: 1, val: 10 },
  pickaxe: { name: 'Stone Pickaxe', cat: 'melee', col: '#9a9aa0', stack: 1, val: 10 },
  salv_axe: { name: 'Salvaged Axe', cat: 'melee', col: '#d0d4da', stack: 1, val: 45, rar: 'uncommon' },
  salv_pick: { name: 'Salvaged Pick', cat: 'melee', col: '#d0d4da', stack: 1, val: 45, rar: 'uncommon' },

  burlap: { name: 'Burlap Shirt', cat: 'armor', col: '#b8a07a', stack: 1, val: 4, armor: 0.08, warm: 1 },
  wood_armor: { name: 'Wood Chestplate', cat: 'armor', col: '#a0703f', stack: 1, val: 10, armor: 0.16 },
  vest_scrap: { name: 'Scrap Vest', cat: 'armor', col: '#8a7a5a', stack: 1, val: 30, armor: 0.22 },
  vest_sign: { name: 'Road-Sign Vest', cat: 'armor', col: '#c8c04a', stack: 1, val: 80, armor: 0.32, rar: 'uncommon' },
  vest_plate: { name: 'Plate Carrier', cat: 'armor', col: '#4a5a3a', stack: 1, val: 220, armor: 0.46, spd: 0.96, rar: 'rare' },
  vest_heavy: { name: 'Heavy Plate Armor', cat: 'armor', col: '#3a3a44', stack: 1, val: 480, armor: 0.6, spd: 0.86, rar: 'epic' },
  hazmat: { name: 'Hazmat Suit', cat: 'armor', col: '#d8c040', stack: 1, val: 160, armor: 0.12, rad: 0.75, rar: 'rare' },

  helm_wood: { name: 'Wooden Helmet', cat: 'helmet', col: '#a0703f', stack: 1, val: 6, armor: 0.05, crit: 0.4 },
  helm_bucket: { name: 'Bucket Helmet', cat: 'helmet', col: '#8a8f95', stack: 1, val: 15, armor: 0.08, crit: 0.5 },
  helm_gas: { name: 'Gas Mask', cat: 'helmet', col: '#4a5a3a', stack: 1, val: 70, armor: 0.04, rad: 0.45, crit: 0.3, rar: 'uncommon' },
  helm_riot: { name: 'Riot Helmet', cat: 'helmet', col: '#2a2a30', stack: 1, val: 120, armor: 0.14, crit: 0.8, rar: 'rare' },
  helm_mil: { name: 'Military Helmet', cat: 'helmet', col: '#4e5a3a', stack: 1, val: 260, armor: 0.2, crit: 1, rad: 0.15, rar: 'epic' },

  bag_small: { name: 'Satchel Bag', cat: 'bag', col: '#9a8460', stack: 1, val: 12, slots: 6 },
  bag_ruck: { name: 'Rucksack', cat: 'bag', col: '#5d6b3c', stack: 1, val: 80, slots: 12, rar: 'uncommon' },
  bag_mil: { name: 'Military Pack', cat: 'bag', col: '#3e4a34', stack: 1, val: 240, slots: 18, rar: 'rare' },

  key_green: { name: 'Green Keycard', cat: 'key', col: '#3cb050', stack: 3, val: 60, rar: 'uncommon' },
  key_blue: { name: 'Blue Keycard', cat: 'key', col: '#3c78d0', stack: 3, val: 160, rar: 'rare' },
  key_red: { name: 'Red Keycard', cat: 'key', col: '#d03c3c', stack: 3, val: 400, rar: 'epic' },

  art_ember: { name: 'Ember Shard', cat: 'art', col: '#ff7a3a', stack: 1, val: 180, rar: 'rare', fx: { regen: 1.2, radRate: 0.6 }, desc: '+1.2 HP/s regen, emits radiation' },
  art_moth: { name: 'Glass Moth', cat: 'art', col: '#9ae8ff', stack: 1, val: 200, rar: 'rare', fx: { speed: 0.14, radRate: 0.4 }, desc: '+14% move speed, emits radiation' },
  art_bloom: { name: 'Iron Bloom', cat: 'art', col: '#c0c8d8', stack: 1, val: 260, rar: 'epic', fx: { armor: 0.12, speed: -0.05 }, desc: '+12% armor, -5% speed' },
  art_pearl: { name: 'Void Pearl', cat: 'art', col: '#8a5aff', stack: 1, val: 300, rar: 'epic', fx: { radRes: 0.5 }, desc: 'Blocks 50% of radiation' },
  art_heart: { name: 'Heartstone', cat: 'art', col: '#ff3a6a', stack: 1, val: 380, rar: 'legendary', fx: { maxhp: 30, radRate: 0.3 }, desc: '+30 max HP, emits radiation' },
};
export const ART_IDS = ['art_ember', 'art_moth', 'art_bloom', 'art_pearl', 'art_heart'];

// ---------------------------------------------------------------------------
// WEAPONS (ranges in metres, projectile speed m/s, noise = alert radius m)
// ---------------------------------------------------------------------------
export const WEAPONS = {
  bow: { dmg: 34, rof: 1.1, mag: 1, reload: 0.55, spread: 0.035, speed: 42, range: 32, ammo: 'arrow', pen: 0.05, noise: 6, sfx: 'bow', arrow: true, drop: 0.4 },
  pipe_pistol: { dmg: 18, rof: 3, mag: 8, reload: 1.8, spread: 0.07, speed: 110, range: 24, ammo: 'pistol_ammo', pen: 0.15, noise: 34, sfx: 'pistol' },
  revolver: { dmg: 30, rof: 2, mag: 6, reload: 2.2, spread: 0.04, speed: 120, range: 28, ammo: 'pistol_ammo', pen: 0.25, noise: 38, sfx: 'pistol' },
  boomstick: { dmg: 10, pellets: 8, rof: 3, mag: 2, reload: 2.4, spread: 0.22, speed: 100, range: 15, ammo: 'shell', pen: 0.05, noise: 46, sfx: 'shotgun' },
  pump: { dmg: 12, pellets: 8, rof: 1.3, mag: 5, reload: 3.0, spread: 0.16, speed: 105, range: 18, ammo: 'shell', pen: 0.08, noise: 46, sfx: 'shotgun' },
  smg: { dmg: 15, rof: 9, mag: 24, reload: 2.4, spread: 0.1, speed: 120, range: 25, ammo: 'pistol_ammo', pen: 0.2, noise: 40, sfx: 'smg', auto: true },
  ar: { dmg: 26, rof: 7.5, mag: 30, reload: 2.6, spread: 0.055, speed: 165, range: 38, ammo: 'rifle_ammo', alt: 'ap_ammo', pen: 0.45, noise: 55, sfx: 'rifle', auto: true },
  hunting: { dmg: 95, rof: 0.85, mag: 5, reload: 3.2, spread: 0.01, speed: 230, range: 56, ammo: 'rifle_ammo', alt: 'ap_ammo', pen: 0.6, noise: 62, sfx: 'sniper' },
  rocket_launcher: { dmg: 90, rof: 0.6, mag: 1, reload: 3.6, spread: 0.02, speed: 26, range: 45, ammo: 'rocket', pen: 0.5, noise: 60, sfx: 'rocket', rocket: true },
};
export const AMMO_MOD = { ap_ammo: { pen: 0.35, dmg: 1.1 } };

// melee: reach (m), rate (swings/s), wood/ore gather multipliers, struct = damage to buildings per hit
export const MELEE = {
  fists: { dmg: 7, rate: 2.0, reach: 1.15, wood: 0.25, ore: 0.2, struct: 1 },
  rock: { dmg: 11, rate: 1.55, reach: 1.25, wood: 0.45, ore: 0.45, struct: 2 },
  torch: { dmg: 9, rate: 1.7, reach: 1.3, wood: 0.2, ore: 0.1, struct: 1, light: true, burn: 4 },
  spear_wood: { dmg: 26, rate: 1.3, reach: 1.9, wood: 0.3, ore: 0.2, struct: 2 },
  knife: { dmg: 22, rate: 2.2, reach: 1.2, wood: 0.4, ore: 0.3, struct: 2 },
  machete: { dmg: 38, rate: 1.6, reach: 1.55, wood: 0.7, ore: 0.3, struct: 3 },
  hatchet: { dmg: 20, rate: 1.8, reach: 1.4, wood: 1.0, ore: 0.5, struct: 4 },
  pickaxe: { dmg: 22, rate: 1.6, reach: 1.4, wood: 0.5, ore: 1.0, struct: 4 },
  salv_axe: { dmg: 30, rate: 1.7, reach: 1.5, wood: 1.8, ore: 0.7, struct: 6 },
  salv_pick: { dmg: 32, rate: 1.5, reach: 1.5, wood: 0.7, ore: 1.8, struct: 6 },
};

// throwables / explosives
export const THROWN = {
  beancan: { fuse: 3.2, r: 3.0, dmg: 45, struct: 40, dud: 0.25, sfx: 'small' },
  grenade: { fuse: 2.6, r: 4.2, dmg: 85, struct: 60 },
  satchel: { fuse: 5.0, r: 3.0, dmg: 70, struct: 210, dud: 0.15, sticky: true },
  c4: { fuse: 8.0, r: 3.6, dmg: 150, struct: 900, sticky: true, beep: true },
  supply_signal: { fuse: 4.0, smoke: true, signal: true },
  rocket: { r: 3.4, dmg: 110, struct: 360 },
};

// ---------------------------------------------------------------------------
// RECIPES (wb = workbench tier needed nearby, bp = must be learned)
// ---------------------------------------------------------------------------
export const RECIPES = [
  { id: 'torch', out: 'torch', n: 1, cost: { wood: 30, cloth: 5 }, wb: 0 },
  { id: 'bandage', out: 'bandage', n: 1, cost: { cloth: 4 }, wb: 0 },
  { id: 'spear_wood', out: 'spear_wood', n: 1, cost: { wood: 200 }, wb: 0 },
  { id: 'hatchet', out: 'hatchet', n: 1, cost: { wood: 150, stone: 80 }, wb: 0 },
  { id: 'pickaxe', out: 'pickaxe', n: 1, cost: { wood: 150, stone: 80 }, wb: 0 },
  { id: 'bow', out: 'bow', n: 1, cost: { wood: 200, cloth: 40 }, wb: 0 },
  { id: 'arrow', out: 'arrow', n: 4, cost: { wood: 25, stone: 10 }, wb: 0 },
  { id: 'burlap', out: 'burlap', n: 1, cost: { cloth: 30 }, wb: 0 },
  { id: 'helm_wood', out: 'helm_wood', n: 1, cost: { wood: 80, cloth: 10 }, wb: 0 },
  { id: 'wood_armor', out: 'wood_armor', n: 1, cost: { wood: 200, cloth: 15, rope: 1 }, wb: 0 },
  { id: 'bag_small', out: 'bag_small', n: 1, cost: { cloth: 40, leather: 5 }, wb: 0 },
  { id: 'low_fuel', out: 'low_fuel', n: 4, cost: { animal_fat: 3, cloth: 1 }, wb: 0 },
  { id: 'gunpowder', out: 'gunpowder', n: 10, cost: { charcoal: 30, sulfur: 20 }, wb: 0 },
  { id: 'pipe_pistol', out: 'pipe_pistol', n: 1, cost: { wood: 40, metal: 60, pipe: 1 }, wb: 0 },
  { id: 'vest_scrap', out: 'vest_scrap', n: 1, cost: { metal: 50, cloth: 20 }, wb: 0 },
  { id: 'helm_bucket', out: 'helm_bucket', n: 1, cost: { metal: 25 }, wb: 0 },
  { id: 'water_bottle', out: 'water_bottle', n: 1, cost: { cloth: 5, metal: 5 }, wb: 0, desc: 'Fill it at any lake.' },
  // tier 1
  { id: 'pistol_ammo', out: 'pistol_ammo', n: 20, cost: { metal: 15, gunpowder: 10 }, wb: 1 },
  { id: 'shell', out: 'shell', n: 6, cost: { metal: 12, gunpowder: 12 }, wb: 1 },
  { id: 'beancan', out: 'beancan', n: 1, cost: { metal: 20, gunpowder: 40 }, wb: 1 },
  { id: 'satchel', out: 'satchel', n: 1, cost: { beancan: 2, rope: 1, cloth: 10 }, wb: 1 },
  { id: 'boomstick', out: 'boomstick', n: 1, cost: { wood: 100, metal: 80, pipe: 2 }, wb: 1 },
  { id: 'revolver', out: 'revolver', n: 1, cost: { metal: 125, pipe: 1, spring: 1 }, wb: 1, bp: true },
  { id: 'medkit', out: 'medkit', n: 1, cost: { cloth: 15, scrap: 10, bandage: 1 }, wb: 1 },
  { id: 'antirad', out: 'antirad', n: 2, cost: { scrap: 15, cloth: 5 }, wb: 1, bp: true },
  { id: 'grenade', out: 'grenade', n: 1, cost: { metal: 40, gunpowder: 25, rope: 1 }, wb: 1, bp: true },
  { id: 'vest_sign', out: 'vest_sign', n: 1, cost: { metal: 120, leather: 10, tape: 1 }, wb: 1 },
  { id: 'helm_gas', out: 'helm_gas', n: 1, cost: { metal: 40, cloth: 20, tape: 1 }, wb: 1, bp: true },
  { id: 'bag_ruck', out: 'bag_ruck', n: 1, cost: { cloth: 70, leather: 15, rope: 2 }, wb: 1 },
  { id: 'machete', out: 'machete', n: 1, cost: { metal: 60, wood: 20 }, wb: 1 },
  { id: 'salv_axe', out: 'salv_axe', n: 1, cost: { metal: 120, wood: 40, gears: 1 }, wb: 1 },
  { id: 'salv_pick', out: 'salv_pick', n: 1, cost: { metal: 120, wood: 40, gears: 1 }, wb: 1 },
  // tier 2
  { id: 'rifle_ammo', out: 'rifle_ammo', n: 20, cost: { metal: 30, gunpowder: 25 }, wb: 2 },
  { id: 'explosives', out: 'explosives', n: 1, cost: { gunpowder: 50, low_fuel: 3, sulfur: 10, metal: 10 }, wb: 2 },
  { id: 'smg', out: 'smg', n: 1, cost: { metal: 250, hqm: 4, spring: 1, gears: 1 }, wb: 2, bp: true },
  { id: 'pump', out: 'pump', n: 1, cost: { metal: 200, hqm: 3, pipe: 2, spring: 1 }, wb: 2, bp: true },
  { id: 'vest_plate', out: 'vest_plate', n: 1, cost: { metal: 200, hqm: 8, cloth: 40 }, wb: 2, bp: true },
  { id: 'helm_riot', out: 'helm_riot', n: 1, cost: { metal: 120, hqm: 3, cloth: 20 }, wb: 2 },
  { id: 'hazmat', out: 'hazmat', n: 1, cost: { cloth: 90, tape: 2, metal: 50 }, wb: 2 },
  { id: 'stim', out: 'stim', n: 1, cost: { scrap: 30, cloth: 10, circuit: 1 }, wb: 2, bp: true },
  { id: 'bag_mil', out: 'bag_mil', n: 1, cost: { cloth: 120, leather: 30, rope: 4, hqm: 2 }, wb: 2 },
  { id: 'supply_signal', out: 'supply_signal', n: 1, cost: { gunpowder: 60, metal: 20, circuit: 1 }, wb: 2, bp: true },
  { id: 'rocket', out: 'rocket', n: 1, cost: { explosives: 8, gunpowder: 100, pipe: 2 }, wb: 2, bp: true },
  // tier 3
  { id: 'ar', out: 'ar', n: 1, cost: { hqm: 30, metal: 200, spring: 2, gears: 2 }, wb: 3, bp: true },
  { id: 'hunting', out: 'hunting', n: 1, cost: { hqm: 15, metal: 150, pipe: 2, spring: 1 }, wb: 3, bp: true },
  { id: 'ap_ammo', out: 'ap_ammo', n: 20, cost: { metal: 30, hqm: 3, gunpowder: 30 }, wb: 3 },
  { id: 'vest_heavy', out: 'vest_heavy', n: 1, cost: { hqm: 40, metal: 300, cloth: 60 }, wb: 3, bp: true },
  { id: 'helm_mil', out: 'helm_mil', n: 1, cost: { hqm: 12, metal: 100, cloth: 20 }, wb: 3 },
  { id: 'c4', out: 'c4', n: 1, cost: { explosives: 20, cloth: 5, circuit: 2 }, wb: 3, bp: true },
  { id: 'rocket_launcher', out: 'rocket_launcher', n: 1, cost: { hqm: 40, metal: 100, pipe: 4 }, wb: 3, bp: true },
];
export const RECIPE = Object.fromEntries(RECIPES.map(r => [r.id, r]));
for (const r of RECIPES) {
  if (!r.bp) continue;
  ITEMS['bp_' + r.id] = { name: 'Blueprint: ' + ITEMS[r.out].name, cat: 'bp', col: '#4a8ad8', stack: 1, val: 30 + r.wb * 60, rar: r.wb >= 3 ? 'epic' : r.wb === 2 ? 'rare' : 'uncommon', teach: r.id };
}
export const BP_BY_TIER = { 1: [], 2: [], 3: [] };
for (const r of RECIPES) if (r.bp) BP_BY_TIER[r.wb].push('bp_' + r.id);
export const RESEARCH_COST = { 1: 75, 2: 175, 3: 350 };

export const RECYCLE = {
  pipe: { metal: 6, scrap: 5 }, spring: { metal: 4, hqm: 1, scrap: 8 }, gears: { metal: 13, scrap: 10 }, circuit: { scrap: 15, hqm: 1 },
  rope: { cloth: 15 }, tape: { cloth: 5, scrap: 4 }, fuse: { scrap: 20, metal: 5 },
  pipe_pistol: { metal: 20, pipe: 1 }, revolver: { metal: 40, spring: 1, scrap: 10 }, boomstick: { metal: 30, pipe: 1 }, pump: { metal: 60, hqm: 1, spring: 1 },
  smg: { metal: 80, hqm: 2, spring: 1 }, ar: { metal: 80, hqm: 10, spring: 1 }, hunting: { metal: 60, hqm: 6, spring: 1 }, rocket_launcher: { metal: 40, hqm: 10, pipe: 2 },
  vest_scrap: { metal: 15, cloth: 8 }, vest_sign: { metal: 50, cloth: 8 }, vest_plate: { metal: 80, hqm: 3, cloth: 15 }, vest_heavy: { metal: 120, hqm: 15 }, hazmat: { cloth: 40, tape: 1 },
  helm_bucket: { metal: 10 }, helm_gas: { metal: 15, cloth: 8 }, helm_riot: { metal: 50, hqm: 1 }, helm_mil: { metal: 40, hqm: 5 },
  machete: { metal: 25 }, salv_axe: { metal: 50, gears: 1 }, salv_pick: { metal: 50, gears: 1 }, bag_ruck: { cloth: 30, rope: 1 }, bag_mil: { cloth: 50, rope: 2, hqm: 1 },
  cigs: { scrap: 3 }, rotgut: { scrap: 5 }, watch: { scrap: 10 }, chain: { scrap: 16 },
};

// ---------------------------------------------------------------------------
// BUILDING (Rust-style: 3 m foundations, walls on edges, tiers)
// ---------------------------------------------------------------------------
export const CELL = 3, FOUND_H = 0.6, WALL_H = 2.6, CEIL_T = 0.2;
export const TIERS = ['twig', 'wood', 'stone', 'metal', 'armored'];
export const TIER = {
  twig: { name: 'Twig', cost: { wood: 10 }, hp: 20, col: '#b08a58' },
  wood: { name: 'Wood', cost: { wood: 60 }, hp: 250, col: '#a27748' },
  stone: { name: 'Stone', cost: { stone: 90 }, hp: 500, col: '#8d8c88' },
  metal: { name: 'Sheet Metal', cost: { metal: 60 }, hp: 1000, col: '#8a9099' },
  armored: { name: 'Armored', cost: { hqm: 8 }, hp: 2000, col: '#3d4148' },
};
// kind: cell (on a 3 m cell) | edge (on a cell edge)
export const PIECES = {
  foundation: { name: 'Foundation', kind: 'cell', mult: 1, hpMult: 1.2, desc: 'Everything sits on foundations.' },
  wall: { name: 'Wall', kind: 'edge', mult: 1, hpMult: 1 },
  doorway: { name: 'Doorway', kind: 'edge', mult: 0.7, hpMult: 1, desc: 'Holds a door.' },
  window: { name: 'Window', kind: 'edge', mult: 0.7, hpMult: 1, desc: 'Shoot out of it. Raiders cannot climb in.' },
  lowwall: { name: 'Low Wall', kind: 'edge', mult: 0.5, hpMult: 0.6, desc: 'Waist-high. Blocks walking, not bullets.' },
  ceiling: { name: 'Roof', kind: 'cell', mult: 0.6, hpMult: 0.6, roof: true, desc: 'A roof keeps radstorms and rain off you.' },
};
export const PIECE_ORDER = ['foundation', 'wall', 'doorway', 'window', 'lowwall', 'ceiling'];
// doors (go in doorways) and high external walls
export const DOORS = {
  door_wood: { name: 'Wooden Door', cost: { wood: 150 }, hp: 220, wb: 0 },
  door_metal: { name: 'Sheet Metal Door', cost: { metal: 150 }, hp: 650, wb: 0 },
  door_armored: { name: 'Armored Door', cost: { hqm: 20, metal: 100, gears: 2 }, hp: 1500, wb: 3 },
  gate_wood: { name: 'High Wood Gate', cost: { wood: 400 }, hp: 1300, wb: 0, gate: true },
  gate_stone: { name: 'High Stone Gate', cost: { stone: 500, metal: 50 }, hp: 2600, wb: 1, gate: true },
};
export const HIGHWALLS = {
  highwall_wood: { name: 'High Wood Wall', tier: 'wood', cost: { wood: 300 }, hp: 1500, wb: 0 },
  highwall_stone: { name: 'High Stone Wall', tier: 'stone', cost: { stone: 400 }, hp: 3000, wb: 1 },
};
// deployables (placed freely, snapped to 0.5 m)
export const DEPLOY = {
  tc: { name: 'Tool Cupboard', cost: { wood: 150 }, hp: 450, wb: 0, unique: true, slots: 18, desc: 'Claims the land. Stops decay. Raiders will come for it — if it falls, the run ends.' },
  sleeping_bag: { name: 'Sleeping Bag', cost: { cloth: 30 }, hp: 60, wb: 0, max: 3, spawn: 120, desc: 'Respawn point (2 min cooldown).' },
  campfire: { name: 'Campfire', cost: { wood: 60 }, hp: 100, wb: 0, oven: 'campfire', light: 7, desc: 'Cooks meat, gives light. Burns wood.' },
  box_small: { name: 'Small Box', cost: { wood: 80 }, hp: 150, wb: 0, slots: 12 },
  box_large: { name: 'Large Box', cost: { wood: 250, metal: 50 }, hp: 300, wb: 0, slots: 30 },
  furnace: { name: 'Furnace', cost: { stone: 200, wood: 50, low_fuel: 10 }, hp: 500, wb: 0, oven: 'furnace', light: 3, desc: 'Smelts ore with wood as fuel.' },
  workbench1: { name: 'Workbench T1', cost: { wood: 300, metal: 100, scrap: 50 }, hp: 500, wb: 0, unique: true, wbTier: 1 },
  workbench2: { name: 'Workbench T2', cost: { metal: 500, hqm: 20, scrap: 300 }, hp: 800, wb: 1, unique: true, wbTier: 2 },
  workbench3: { name: 'Workbench T3', cost: { metal: 1000, hqm: 60, scrap: 800 }, hp: 1200, wb: 2, unique: true, wbTier: 3 },
  research: { name: 'Research Table', cost: { metal: 150, scrap: 60 }, hp: 400, wb: 0, unique: true, desc: 'Turn an item into a blueprint for scrap.' },
  recycler: { name: 'Recycler', cost: { metal: 300, scrap: 200, gears: 4 }, hp: 600, wb: 2, unique: true },
  bed: { name: 'Bed', cost: { cloth: 60, metal: 40, wood: 40 }, hp: 200, wb: 1, max: 2, spawn: 60, desc: 'Respawn point (1 min cooldown).' },
  water_barrel: { name: 'Water Barrel', cost: { wood: 80, metal: 20 }, hp: 200, wb: 0, desc: 'Fills with water every dawn. Drink from it.' },
  planter: { name: 'Planter Box', cost: { wood: 100, cloth: 10 }, hp: 200, wb: 0, prod: { cloth: 15, berries: 3 }, desc: 'Grows hemp and berries: harvest every dawn.' },
  lantern: { name: 'Lantern', cost: { metal: 20, low_fuel: 5 }, hp: 60, wb: 0, light: 6 },
  floodlight: { name: 'Floodlight', cost: { metal: 60, circuit: 1 }, hp: 200, wb: 1, light: 12 },
  spikes: { name: 'Spike Barricade', cost: { wood: 120 }, hp: 200, wb: 0, trap: 'spikes', desc: 'Hurts and slows raiders.' },
  landmine: { name: 'Landmine', cost: { metal: 30, gunpowder: 30 }, hp: 50, wb: 1, trap: 'mine' },
  shotgun_trap: { name: 'Shotgun Trap', cost: { wood: 120, metal: 50, pipe: 1 }, hp: 300, wb: 1, turret: { range: 7, rof: 1.1, dmg: 11, pellets: 6, spread: 0.35, ammo: 'shell' }, desc: 'Uses shells from your Tool Cupboard.' },
  auto_turret: { name: 'Auto Turret', cost: { metal: 200, hqm: 8, circuit: 2 }, hp: 800, wb: 2, turret: { range: 16, rof: 6, dmg: 14, pellets: 1, spread: 0.05, ammo: 'pistol_ammo' }, desc: 'Uses pistol rounds from your Tool Cupboard.' },
  quarry: { name: 'Mini Quarry', cost: { metal: 250, gears: 3, wood: 300 }, hp: 500, wb: 1, prod: { stone: 150, metal_ore: 60, sulfur_ore: 50 }, desc: 'Digs ore every dawn.' },
};
export const DEPLOY_ORDER = ['tc', 'sleeping_bag', 'campfire', 'box_small', 'box_large', 'furnace', 'workbench1', 'workbench2', 'workbench3', 'research', 'recycler', 'bed',
  'water_barrel', 'planter', 'lantern', 'floodlight', 'spikes', 'landmine', 'shotgun_trap', 'auto_turret', 'quarry'];
export const TC_RANGE = 32;

// ovens: what they cook (per second while lit with fuel)
export const OVENS = {
  campfire: { fuel: 'wood', burn: 0.25, rate: 0.5, cooks: { raw_meat: 'cooked_meat', wood: 'charcoal' }, slots: 6 },
  furnace: { fuel: 'wood', burn: 0.5, rate: 3, cooks: { metal_ore: 'metal', sulfur_ore: 'sulfur', hqm_ore: 'hqm', wood: 'charcoal' }, slots: 6 },
};

// ---------------------------------------------------------------------------
// WORLD RESOURCES
// ---------------------------------------------------------------------------
export const NODES = {
  tree: { hp: 160, yield: [['wood', 1]], tool: 'wood' },
  stone: { hp: 240, yield: [['stone', 1]], tool: 'ore', bonus: [['metal_ore', 0.04]] },
  metal: { hp: 200, yield: [['metal_ore', 0.7], ['stone', 0.3]], tool: 'ore', bonus: [['hqm_ore', 0.012]] },
  sulfur: { hp: 200, yield: [['sulfur_ore', 0.8], ['stone', 0.2]], tool: 'ore' },
  hqm: { hp: 120, yield: [['hqm_ore', 0.18], ['stone', 0.82]], tool: 'ore' },
};
export const GATHER_PER_HIT = 16;

// ---------------------------------------------------------------------------
// ENEMIES / NPCS / ANIMALS (speed m/s, sight m, reach m)
// ---------------------------------------------------------------------------
export const ENEMIES = {
  chicken: { name: 'Chicken', kind: 'animal', model: 'chicken', hp: 18, speed: 2.6, r: 0.25, flee: true, sight: 10, drop: 'chicken', xp: 1 },
  deer: { name: 'Deer', kind: 'animal', model: 'deer', hp: 70, speed: 6.4, r: 0.45, flee: true, sight: 22, drop: 'deer', xp: 3 },
  boar: { name: 'Boar', kind: 'animal', model: 'boar', hp: 130, speed: 3.4, charge: 6.8, r: 0.5, melee: { dmg: 14, rate: 1.0, reach: 1.25, bleed: 0.2 }, sight: 14, drop: 'boar', xp: 5, territorial: true },
  wolf: { name: 'Wolf', kind: 'animal', model: 'wolf', hp: 85, speed: 6.2, r: 0.4, melee: { dmg: 11, rate: 1.3, reach: 1.2, bleed: 0.35 }, sight: 24, drop: 'wolf', xp: 5, pack: true },
  bear: { name: 'Bear', kind: 'animal', model: 'bear', hp: 340, speed: 5.4, r: 0.8, melee: { dmg: 32, rate: 0.9, reach: 1.7, bleed: 0.4 }, sight: 18, drop: 'bear', xp: 14 },
  scav: { name: 'Scav', kind: 'human', look: 'scav', hp: 80, speed: 3.6, r: 0.35, guns: ['pipe_pistol', 'pipe_pistol', 'boomstick', 'bow'], armor: [0, 0.16], sight: 22, acc: 0.6, xp: 8, drop: 'human1' },
  bandit: { name: 'Bandit', kind: 'human', look: 'bandit', hp: 100, speed: 3.8, r: 0.35, guns: ['revolver', 'smg', 'boomstick', 'pump'], armor: [0.16, 0.32], helm: 0.5, sight: 26, acc: 0.7, xp: 12, drop: 'human2' },
  soldier: { name: 'Garrison Trooper', kind: 'human', look: 'soldier', hp: 120, speed: 3.9, r: 0.35, guns: ['ar', 'ar', 'smg', 'pump'], armor: [0.38, 0.5], helm: 1, sight: 32, acc: 0.8, xp: 18, drop: 'human3' },
  hazguard: { name: 'Hazmat Sentry', kind: 'human', look: 'hazguard', hp: 130, speed: 3.7, r: 0.35, guns: ['smg', 'ar', 'pump'], armor: [0.3, 0.4], helm: 1, sight: 30, acc: 0.78, xp: 20, drop: 'human3', radImmune: true },
  lurker: { name: 'Lurker', kind: 'mutant', look: 'lurker', hp: 220, speed: 6.6, r: 0.4, melee: { dmg: 28, rate: 1.0, reach: 1.35, bleed: 0.5 }, sight: 24, stealth: true, xp: 25, drop: 'mutant', radImmune: true },
  warlord: { name: 'The Warlord', kind: 'human', look: 'warlord', hp: 900, speed: 3.4, r: 0.45, guns: ['ar'], armor: [0.55, 0.55], helm: 1, sight: 38, acc: 0.85, xp: 120, boss: true, drop: 'boss' },
  guard: { name: 'Haven Guard', kind: 'human', look: 'guard', hp: 2000, speed: 3.8, r: 0.38, guns: ['ar'], armor: [0.7, 0.7], helm: 1, sight: 40, acc: 0.95, xp: 0, guard: true, drop: null },
  trader: { name: 'Trader', kind: 'human', look: 'trader', hp: 9999, speed: 0, r: 0.38, trader: true, sight: 0, xp: 0, drop: null, invuln: true },
  // night raiders
  thug: { name: 'Raider', kind: 'human', look: 'raider', hp: 75, speed: 4.0, r: 0.35, melee: { dmg: 12, rate: 1.2, reach: 1.2, struct: 24 }, sight: 18, raider: true, xp: 5, drop: 'raider', heldMelee: 'machete' },
  gunner: { name: 'Raider Gunner', kind: 'human', look: 'raider', hp: 80, speed: 3.6, r: 0.35, guns: ['pipe_pistol', 'revolver', 'boomstick'], armor: [0, 0.16], sight: 24, acc: 0.55, raider: true, xp: 7, drop: 'raider' },
  breacher: { name: 'Breacher', kind: 'human', look: 'breacher', hp: 95, speed: 4.2, r: 0.36, breach: true, armor: [0.16, 0.16], sight: 18, raider: true, xp: 10, drop: 'raider', heldMelee: 'satchel' },
  brute: { name: 'Armored Brute', kind: 'human', look: 'brute', hp: 180, speed: 3.3, r: 0.42, guns: ['pump', 'smg'], armor: [0.4, 0.5], helm: 1, sight: 24, acc: 0.65, raider: true, xp: 16, drop: 'raider2' },
  rocketeer: { name: 'Rocketeer', kind: 'human', look: 'rocketeer', hp: 110, speed: 3.4, r: 0.36, rocket: true, armor: [0.3, 0.3], sight: 34, raider: true, xp: 18, drop: 'raider2' },
  ironjack: { name: 'Iron Jack', kind: 'human', look: 'ironjack', hp: 1000, speed: 3.2, r: 0.5, guns: ['ar'], armor: [0.6, 0.6], helm: 1, sight: 34, acc: 0.8, raider: true, boss: true, breachBoss: true, xp: 150, drop: 'boss' },
  // AI survivors (bots that play like other players — see bots.js)
  survivor: { name: 'Survivor', kind: 'human', look: 'survivor', hp: 100, speed: 4.5, r: 0.35, sight: 30, acc: 0.66, xp: 10, drop: null, bot: true },
  // fortress defenders
  outlaw: { name: 'Outlaw', kind: 'human', look: 'bandit', hp: 110, speed: 3.8, r: 0.35, guns: ['smg', 'pump', 'revolver', 'ar'], armor: [0.2, 0.4], helm: 0.6, sight: 28, acc: 0.72, xp: 14, drop: 'human2' },
};

// ---------------------------------------------------------------------------
// LOOT TABLES  [id, weight, min, max]
// ---------------------------------------------------------------------------
export const LOOT = {
  barrel: { rolls: [1, 3], items: [['scrap', 12, 2, 6], ['metal', 6, 8, 25], ['pipe', 4, 1, 1], ['gears', 3, 1, 1], ['spring', 1.5, 1, 1], ['rope', 3, 1, 1], ['tape', 3, 1, 1], ['pistol_ammo', 2.5, 4, 10], ['cloth', 3, 4, 10], ['low_fuel', 3, 3, 8], ['fuse', 0.4, 1, 1], ['charcoal', 3, 5, 15], ['sulfur', 1.5, 5, 12], ['bandage', 1.5, 1, 1], ['canned', 1.5, 1, 1], ['shell', 1.5, 2, 4], ['arrow', 1.5, 3, 8]] },
  crate: { rolls: [2, 5], items: [['wood', 5, 20, 60], ['metal', 7, 15, 40], ['cloth', 7, 5, 15], ['scrap', 9, 4, 12], ['pistol_ammo', 6, 8, 18], ['shell', 4, 3, 8], ['bandage', 6, 1, 2], ['canned', 4, 1, 2], ['rope', 3, 1, 1], ['pipe', 4, 1, 1], ['spring', 2, 1, 1], ['gears', 3, 1, 2], ['tape', 3, 1, 1], ['gunpowder', 3, 10, 25], ['cigs', 4, 1, 2], ['rotgut', 2, 1, 1], ['watch', 1.2, 1, 1], ['bp_t1', 1.2, 1, 1], ['key_green', 0.6, 1, 1], ['fuse', 0.6, 1, 1], ['pipe_pistol', 1, 1, 1], ['machete', 0.6, 1, 1], ['vest_scrap', 0.8, 1, 1], ['helm_bucket', 0.8, 1, 1], ['water_bottle', 1.4, 1, 1], ['low_fuel', 2, 5, 12], ['bow', 0.8, 1, 1], ['knife', 0.9, 1, 1], ['hatchet', 1, 1, 1], ['pickaxe', 0.9, 1, 1], ['spear_wood', 0.8, 1, 1], ['burlap', 1.2, 1, 1], ['wood_armor', 0.7, 1, 1], ['helm_wood', 0.7, 1, 1], ['bag_small', 0.5, 1, 1], ['charcoal', 2, 10, 30], ['arrow', 2, 4, 10], ['bp_revolver', 0.5, 1, 1], ['bp_helm_gas', 0.4, 1, 1], ['bp_grenade', 0.4, 1, 1]] },
  food: { rolls: [2, 3], items: [['canned', 8, 1, 2], ['water_bottle', 7, 1, 2], ['berries', 4, 2, 5], ['mushroom', 3, 2, 4], ['cooked_meat', 2, 1, 2], ['cigs', 2, 1, 1], ['rotgut', 1.5, 1, 1], ['raw_meat', 2, 1, 2]] },
  toolbox: { rolls: [2, 4], items: [['pipe', 6, 1, 2], ['spring', 4, 1, 1], ['gears', 6, 1, 2], ['circuit', 3, 1, 1], ['tape', 5, 1, 2], ['rope', 4, 1, 2], ['metal', 4, 20, 50], ['scrap', 5, 5, 15], ['fuse', 1.4, 1, 1], ['salv_axe', 0.5, 1, 1], ['salv_pick', 0.5, 1, 1], ['hatchet', 1.5, 1, 1], ['pickaxe', 1.5, 1, 1], ['knife', 1, 1, 1], ['charcoal', 1.5, 10, 25], ['bp_grenade', 0.3, 1, 1]] },
  medbox: { rolls: [2, 4], items: [['bandage', 10, 1, 3], ['medkit', 4, 1, 1], ['antirad', 4, 1, 2], ['stim', 1, 1, 1], ['canned', 3, 1, 2], ['cloth', 3, 8, 16], ['bp_antirad', 0.7, 1, 1], ['bp_stim', 0.4, 1, 1]] },
  ammobox: { rolls: [2, 4], items: [['pistol_ammo', 10, 12, 30], ['shell', 6, 5, 12], ['rifle_ammo', 4, 10, 25], ['ap_ammo', 0.6, 6, 15], ['gunpowder', 5, 15, 35], ['arrow', 4, 6, 14], ['grenade', 1.2, 1, 1], ['beancan', 2, 1, 2], ['boomstick', 0.6, 1, 1], ['arrow', 2, 6, 14], ['bp_pump', 0.3, 1, 1]] },
  military: { rolls: [3, 6], items: [['rifle_ammo', 8, 15, 35], ['pistol_ammo', 5, 15, 30], ['shell', 4, 8, 14], ['ap_ammo', 1.5, 8, 20], ['grenade', 3, 1, 2], ['medkit', 4, 1, 1], ['stim', 1.5, 1, 1], ['antirad', 3, 1, 2], ['hqm', 4, 2, 6], ['circuit', 3, 1, 2], ['spring', 3, 1, 2], ['revolver', 1.2, 1, 1], ['smg', 1, 1, 1], ['pump', 1, 1, 1], ['ar', 0.35, 1, 1], ['vest_sign', 1.5, 1, 1], ['vest_plate', 0.6, 1, 1], ['helm_riot', 1, 1, 1], ['helm_gas', 1.2, 1, 1], ['bag_ruck', 0.8, 1, 1], ['bp_t2', 1.6, 1, 1], ['key_blue', 0.7, 1, 1], ['fuse', 1.2, 1, 1], ['explosives', 1, 2, 5], ['intel', 1.2, 1, 1], ['watch', 1.5, 1, 1], ['satchel', 1.2, 1, 2], ['boomstick', 1, 1, 1], ['bp_smg', 0.6, 1, 1], ['bp_pump', 0.6, 1, 1], ['bp_vest_plate', 0.5, 1, 1], ['bp_supply_signal', 0.4, 1, 1], ['bp_c4', 0.25, 1, 1]] },
  elite: { rolls: [4, 7], items: [['ap_ammo', 5, 15, 30], ['rifle_ammo', 5, 25, 45], ['grenade', 3, 1, 3], ['medkit', 4, 1, 2], ['stim', 3, 1, 2], ['hqm', 6, 5, 15], ['explosives', 3, 5, 12], ['rocket', 1.2, 1, 2], ['c4', 0.8, 1, 1], ['ar', 1.5, 1, 1], ['hunting', 1.5, 1, 1], ['rocket_launcher', 0.4, 1, 1], ['vest_plate', 1.5, 1, 1], ['vest_heavy', 0.6, 1, 1], ['helm_mil', 1, 1, 1], ['hazmat', 1, 1, 1], ['bag_mil', 1, 1, 1], ['bp_t3', 2.5, 1, 1], ['bp_t2', 1.5, 1, 1], ['key_red', 0.8, 1, 1], ['gpu', 1.2, 1, 1], ['intel', 2, 1, 1], ['chain', 2, 1, 1], ['supply_signal', 0.8, 1, 1], ['bp_ar', 0.6, 1, 1], ['bp_hunting', 0.6, 1, 1], ['bp_vest_heavy', 0.5, 1, 1], ['bp_rocket', 0.5, 1, 1], ['bp_rocket_launcher', 0.35, 1, 1], ['bp_c4', 0.5, 1, 1], ['satchel', 1.5, 1, 2]] },
  cache: { rolls: [3, 5], items: [['scrap', 6, 15, 40], ['antirad', 3, 1, 2], ['medkit', 2, 1, 1], ['chain', 2, 1, 1], ['watch', 3, 1, 1], ['rifle_ammo', 3, 10, 20], ['pistol_ammo', 4, 15, 30], ['bp_t1', 2, 1, 1], ['bp_t2', 1.2, 1, 1], ['key_green', 1.2, 1, 1], ['key_blue', 0.5, 1, 1], ['grenade', 1.5, 1, 1], ['bag_small', 0.8, 1, 1], ['bp_revolver', 0.6, 1, 1], ['bp_smg', 0.3, 1, 1], ['satchel', 0.6, 1, 1]] },
  airdrop: { rolls: [5, 7], items: [['rifle_ammo', 6, 30, 60], ['ap_ammo', 3, 20, 40], ['medkit', 5, 1, 3], ['stim', 3, 1, 2], ['hqm', 5, 10, 25], ['explosives', 3, 5, 15], ['rocket', 2, 1, 3], ['c4', 1.2, 1, 2], ['ar', 2, 1, 1], ['hunting', 1.5, 1, 1], ['smg', 2, 1, 1], ['pump', 2, 1, 1], ['vest_plate', 2, 1, 1], ['vest_heavy', 1, 1, 1], ['helm_mil', 1.5, 1, 1], ['bp_t2', 2, 1, 1], ['bp_t3', 2, 1, 1], ['canned', 3, 2, 4], ['water_bottle', 3, 2, 3]] },
  // creatures
  chicken: { rolls: [1, 1], items: [['raw_meat', 1, 1, 2]], always: [['animal_fat', 1, 2], ['bone', 1, 3]] },
  deer: { rolls: [0, 0], items: [], always: [['raw_meat', 4, 6], ['leather', 6, 10], ['animal_fat', 3, 6], ['bone', 6, 10]] },
  boar: { rolls: [0, 0], items: [], always: [['raw_meat', 4, 6], ['leather', 5, 8], ['animal_fat', 6, 10], ['bone', 5, 8]] },
  wolf: { rolls: [0, 0], items: [], always: [['raw_meat', 2, 4], ['leather', 5, 8], ['animal_fat', 3, 5], ['bone', 5, 8]] },
  bear: { rolls: [0, 0], items: [], always: [['raw_meat', 8, 12], ['leather', 12, 18], ['animal_fat', 10, 16], ['bone', 10, 16]] },
  mutant: { rolls: [1, 2], items: [['cloth', 3, 5, 12], ['scrap', 4, 10, 25], ['antirad', 2, 1, 1], ['art_any', 0.5, 1, 1], ['idol', 0.08, 1, 1]] },
  human1: { rolls: [1, 2], items: [['pistol_ammo', 8, 4, 12], ['arrow', 3, 3, 8], ['shell', 3, 2, 5], ['bandage', 5, 1, 2], ['scrap', 5, 3, 10], ['cigs', 4, 1, 1], ['canned', 3, 1, 1], ['water_bottle', 2, 1, 1], ['key_green', 0.5, 1, 1]] },
  human2: { rolls: [1, 3], items: [['pistol_ammo', 6, 8, 18], ['shell', 4, 3, 8], ['bandage', 5, 1, 2], ['medkit', 1.5, 1, 1], ['scrap', 5, 6, 15], ['rotgut', 2, 1, 1], ['watch', 1, 1, 1], ['bp_t1', 0.8, 1, 1], ['key_green', 0.8, 1, 1], ['grenade', 0.8, 1, 1], ['beancan', 1, 1, 2]] },
  human3: { rolls: [2, 3], items: [['rifle_ammo', 8, 10, 25], ['ap_ammo', 1, 5, 12], ['medkit', 3, 1, 1], ['stim', 1, 1, 1], ['grenade', 2, 1, 1], ['hqm', 2, 1, 4], ['intel', 1, 1, 1], ['bp_t2', 0.7, 1, 1], ['key_blue', 0.5, 1, 1], ['fuse', 0.6, 1, 1]] },
  boss: { rolls: [4, 5], items: [['ap_ammo', 5, 20, 40], ['stim', 4, 1, 2], ['medkit', 4, 1, 2], ['hqm', 5, 10, 20], ['vest_heavy', 2, 1, 1], ['helm_mil', 2, 1, 1], ['bp_t3', 4, 1, 1], ['key_red', 3, 1, 1], ['gpu', 2, 1, 1], ['chain', 3, 1, 2], ['c4', 1, 1, 1]] },
  raider: { rolls: [0, 2], items: [['scrap', 8, 3, 10], ['metal', 5, 10, 25], ['pistol_ammo', 4, 4, 10], ['cloth', 4, 4, 10], ['gunpowder', 3, 5, 15], ['bandage', 3, 1, 1], ['cigs', 2, 1, 1], ['beancan', 1, 1, 1]] },
  raider2: { rolls: [1, 2], items: [['scrap', 8, 10, 20], ['hqm', 3, 1, 3], ['shell', 4, 4, 8], ['pistol_ammo', 4, 8, 16], ['gunpowder', 4, 10, 25], ['medkit', 1.5, 1, 1], ['explosives', 1, 1, 3], ['bp_t1', 1, 1, 1], ['bp_t2', 0.5, 1, 1]] },
};
export const CONTAINERS = {
  barrel: { name: 'Barrel', loot: 'barrel', breakable: true, hp: 30, model: 'barrel', search: 0, respawn: 300 },
  barrel_oil: { name: 'Oil Barrel', loot: null, breakable: true, hp: 30, model: 'barrel_oil', search: 0, respawn: 420, give: [['low_fuel', 8, 18]] },
  crate: { name: 'Wooden Crate', loot: 'crate', model: 'crate', search: 0.35, respawn: 360 },
  food: { name: 'Food Crate', loot: 'food', model: 'food', search: 0.3, respawn: 360 },
  toolbox: { name: 'Toolbox', loot: 'toolbox', model: 'toolbox', search: 0.35, respawn: 420 },
  medbox: { name: 'Medical Box', loot: 'medbox', model: 'medbox', search: 0.35, respawn: 420 },
  ammobox: { name: 'Ammo Box', loot: 'ammobox', model: 'ammobox', search: 0.4, respawn: 420 },
  military: { name: 'Military Crate', loot: 'military', model: 'military', search: 0.5, respawn: 600 },
  elite: { name: 'Elite Crate', loot: 'elite', model: 'elite', search: 0.7, respawn: 900 },
  cache: { name: 'Hidden Stash', loot: 'cache', model: 'cache', search: 0.45, respawn: 1000 },
  locker: { name: 'Locker', loot: 'crate', model: 'locker', search: 0.35, respawn: 420 },
  airdrop: { name: 'Supply Drop', loot: 'airdrop', model: 'airdrop', search: 1.0, respawn: 0 },
};

// ---------------------------------------------------------------------------
// MONUMENTS (layouts live in world/monuments.js)
// ---------------------------------------------------------------------------
// count = how many to place; size = footprint radius used for spacing; coast = must touch the shore
export const MONUMENTS = {
  haven: { name: 'Haven Market', tier: 0, count: 1, size: 34, safe: true, desc: 'Neutral trading post. No fighting. Recycler, vendors.' },
  gas: { name: 'Gas Station', tier: 1, count: 4, size: 22, road: true },
  mart: { name: 'Supermarket', tier: 1, count: 3, size: 22, road: true },
  lighthouse: { name: 'Lighthouse', tier: 1, count: 3, size: 18, coast: true },
  village: { name: 'Hollow Creek', tier: 1, count: 2, size: 48 },
  camp: { name: 'Scav Camp', tier: 1, count: 3, size: 20 },
  quarry: { name: 'Stone Quarry', tier: 1, count: 2, size: 30 },
  dish: { name: 'Dish Array', tier: 2, count: 1, size: 42, card: 'green' },
  harbor: { name: 'Harbor', tier: 2, count: 2, size: 50, coast: true, card: 'green' },
  trainyard: { name: 'Train Yard', tier: 2, count: 2, size: 50, card: 'blue' },
  water: { name: 'Water Treatment', tier: 2, count: 1, size: 46, card: 'blue' },
  fort: { name: 'Outlaw Fort', tier: 2, count: 3, size: 26, raid: true, desc: 'An outlaw base. Blow the doors and take their loot room.' },
  airfield: { name: 'Airfield', tier: 3, count: 1, size: 70, card: 'blue' },
  garrison: { name: 'Garrison 9', tier: 3, count: 1, size: 52, card: 'blue', boss: 'warlord' },
  reactor: { name: 'Reactor Sector', tier: 4, count: 1, size: 64, card: 'red' },
};

// ---------------------------------------------------------------------------
// VENDORS (Haven Market) — buy for scrap, sell valuables
// ---------------------------------------------------------------------------
export const SHOPS = {
  general: { name: 'General Goods', stock: [['bandage', 3, 8], ['water_bottle', 1, 10], ['canned', 1, 14], ['arrow', 10, 12], ['low_fuel', 20, 16], ['rope', 1, 14], ['tape', 1, 14], ['cloth', 50, 20], ['bag_small', 1, 30]] },
  arms: { name: 'Arms Dealer', stock: [['pistol_ammo', 20, 18], ['shell', 6, 16], ['rifle_ammo', 20, 40], ['bow', 1, 40], ['pipe_pistol', 1, 70], ['revolver', 1, 160], ['boomstick', 1, 140], ['beancan', 1, 28], ['vest_scrap', 1, 60], ['helm_bucket', 1, 25]] },
  tech: { name: 'Tech Trader', stock: [['fuse', 1, 60], ['key_green', 1, 120], ['circuit', 1, 45], ['gears', 1, 30], ['spring', 1, 40], ['pipe', 1, 25], ['antirad', 1, 45], ['medkit', 1, 80], ['hazmat', 1, 300]] },
};

// ---------------------------------------------------------------------------
// PERKS (meta progression between runs)
// ---------------------------------------------------------------------------
export const PERKS = [
  { id: 'kit', name: 'Survivor Kit', cost: 3, desc: 'Start each run with a bow, 20 arrows and a torch.' },
  { id: 'stockpile', name: 'Stockpile', cost: 4, desc: 'Start with 400 wood and 300 stone.' },
  { id: 'forager', name: 'Forager', cost: 5, desc: 'Gather 25% more wood, stone and ore.' },
  { id: 'medic', name: 'Field Medic', cost: 4, desc: 'Healing items work 30% faster and heal 20% more.' },
  { id: 'scholar', name: 'Scholar', cost: 6, desc: 'Start with Revolver, Anti-Rad and Grenade blueprints known.' },
  { id: 'tough', name: 'Thick Skin', cost: 6, desc: '+20 max HP.' },
  { id: 'scavenger', name: 'Scavenger', cost: 7, desc: 'Containers roll one extra item.' },
  { id: 'engineer', name: 'Engineer', cost: 8, desc: 'Building pieces get +25% HP. Upgrades cost 20% less.' },
  { id: 'iron_gut', name: 'Iron Gut', cost: 4, desc: 'Hunger and thirst drain 35% slower. Raw meat is safe.' },
];

export const TIPS = [
  'Build a Tool Cupboard on your foundations to claim the land and stop decay.',
  'Raiders come at night once you have a Tool Cupboard. Upgrade from twig to wood, stone and metal.',
  'Doors open when you walk into them and close behind you. Raiders have to break them.',
  'Breachers carry satchel charges — kill them before they reach your walls.',
  'Roads are lined with barrels: smash them for scrap and components.',
  'Recycle components at a Gas Station or Haven Market to get scrap and metal.',
  'Keycards and fuses open the vaults inside the big monuments.',
  'Cook raw meat on a campfire. Drink from lakes or water bottles.',
  'Radiation drains health. Anti-Rad pills, gas masks and hazmat suits help.',
  'Artifacts sit inside anomalies in the Reactor Sector. Approach carefully.',
  'Gunshots are loud. Every enemy nearby will come looking.',
  'Raiders follow the weakest path to your Tool Cupboard. Use that.',
  'Throw a supply signal for an airdrop. Others will come for it too.',
  'Outlaw Forts are full of loot — bring satchels or C4 to get in.',
];

// handy lookup for anything placeable
export function buildDef(id) { return PIECES[id] || DOORS[id] || HIGHWALLS[id] || DEPLOY[id] || null; }
