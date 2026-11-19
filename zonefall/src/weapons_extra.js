// ============================================================================
// ZONEFALL — extra guns: Ratchet Crossbow, Longreach Sniper, Ridgeback Carbine,
// Thresher LMG and the Nailgun (+ its Nails ammo); the second wave: Waterpipe
// Shotgun, Semi-Auto Pistol, Magnum Revolver, Tactical SMG, Lancer Rifle and
// Combat Auto-Shotgun; and WEAPON ATTACHMENTS (sights, scopes, muzzle devices,
// rail laser / flashlight, extended magazine). Data, recipes, blueprints, loot,
// NPC loadouts and 16x16 inventory icons. The first-person models, grips,
// sights and reload animations live in fp/viewmodel.js (ITEM table) and the
// shared held models in gfx/models_chars.js (HELD / HELD_INFO; attachment
// meshes in addAttachments()).
//
// Attachments: a gun stack carries att = { sight?, muzzle?, rail?, mag? } (item
// ids). attFx(stackOrAtt) folds them into multipliers read by combat.js
// (spread, noise, range, flash), player.js (recoil, zoom, reload, laser,
// light) and the UI; attAllowed(gunId) lists what a gun takes; gunMag(stack)
// is the magazine size with an extended magazine fitted.
//
//   registerWeaponsData({ ITEMS, WEAPONS, RECIPES, RECIPE, LOOT, ENEMIES,
//                         BP_BY_TIER?, RECYCLE?, SHOPS? })   once, at the end of data.js (idempotent)
//   registerWeaponsIcons(ART?)   pixel icons for the new ids (wraps ART.icon / ART.iconURL)
//
// Imports nothing, so data.js can import it without a cycle. BP_BY_TIER is
// optional but needed for the new blueprints to show up in random
// "bp_t2" / "bp_t3" loot rolls; RECYCLE and SHOPS are optional extras.
//
// WEAPONS fields beyond the usual ones (read by nothing in the core yet):
//   kick   camera kick per shot in radians (player.js uses it when its RECOIL
//          table has no entry for the id)
//   scope  2 = high-power scope (the viewmodel draws it and narrows the FOV itself)
// ============================================================================

export const WEAPON_IDS = ['crossbow', 'nailgun', 'semi_rifle', 'sniper', 'lmg', 'waterpipe', 'semi_pistol', 'magnum', 'tac_smg', 'lancer', 'auto_shotgun'];
export const ATTACH_IDS = ['att_holo', 'att_scope4', 'att_scope8', 'att_silencer', 'att_brake', 'att_laser', 'att_flashlight', 'att_extmag'];

export const WX_ITEMS = {
  nails: { name: 'Nails', cat: 'ammo', col: '#a9b0b8', stack: 128, val: 0.4, desc: 'Nailgun ammo. Quick to make from metal fragments.' },
  crossbow: { name: 'Ratchet Crossbow', cat: 'gun', col: '#8a5a32', stack: 1, val: 70, rar: 'uncommon', desc: 'Fires wooden arrows harder and flatter than a bow. Cranking the string back takes a while, so make the shot count.' },
  nailgun: { name: 'Nailgun', cat: 'gun', col: '#e0a43a', stack: 1, val: 55, desc: 'A rewired construction nailer. Quiet and quick, but nails lose their bite after a few metres.' },
  semi_rifle: { name: 'Ridgeback Carbine', cat: 'gun', col: '#9a5a2e', stack: 1, val: 280, rar: 'rare', desc: 'Semi-automatic rifle: one shot per tap from a 16-round magazine. Accurate with a moderate kick.' },
  sniper: { name: 'Longreach Sniper', cat: 'gun', col: '#8f8458', stack: 1, val: 540, rar: 'epic', desc: 'Heavy bolt-action rifle with a high-power scope. Work the bolt after every shot.' },
  lmg: { name: 'Thresher LMG', cat: 'gun', col: '#4f5638', stack: 1, val: 580, rar: 'epic', desc: 'Box-fed machine gun with a 60-round belt. Kicks hard and takes an age to reload.' },
  // second wave: the early shotgun and sidearm, a heavy revolver, and late SMG / rifle / shotgun upgrades
  waterpipe: { name: 'Waterpipe Shotgun', cat: 'gun', col: '#7d6a55', stack: 1, val: 45, desc: 'A length of water pipe on a plank. One shell, a brutal blast up close and a slow reload. The first shotgun you can make.' },
  semi_pistol: { name: 'Semi-Auto Pistol', cat: 'gun', col: '#575b63', stack: 1, val: 130, rar: 'uncommon', desc: 'A dependable 10-round sidearm. One shot per tap, quick to reload and accurate at short range.' },
  magnum: { name: 'Magnum Revolver', cat: 'gun', col: '#b9bdc6', stack: 1, val: 280, rar: 'rare', desc: 'Long-barrelled stainless magnum. Six heavy rounds that hit almost like a rifle, with a kick to match.' },
  tac_smg: { name: 'Tactical SMG', cat: 'gun', col: '#3b3e45', stack: 1, val: 430, rar: 'epic', desc: 'A factory-made submachine gun: very fast, controllable and accurate for its size. 30 pistol rounds.' },
  lancer: { name: 'Lancer Rifle', cat: 'gun', col: '#4c5046', stack: 1, val: 460, rar: 'epic', desc: 'Light, smooth automatic rifle. Hits a little softer than the Assault Rifle but kicks far less and fires faster.' },
  auto_shotgun: { name: 'Combat Auto-Shotgun', cat: 'gun', col: '#30333a', stack: 1, val: 480, rar: 'epic', desc: 'Semi-automatic 7-shell shotgun: one blast per tap and no pump to work. Devastating indoors.' },
  // attachments (cat 'att'): fit them on a gun in the inventory
  att_holo: { name: 'Holosight', cat: 'att', col: '#c8423a', stack: 1, val: 90, rar: 'uncommon', desc: 'Red-dot sight: a little zoom and steadier aimed fire.' },
  att_scope4: { name: '4x Scope', cat: 'att', col: '#4a6a8a', stack: 1, val: 160, rar: 'rare', desc: 'Medium-range scope: 4x zoom and much tighter aimed fire, a bit looser from the hip.' },
  att_scope8: { name: '8x Scope', cat: 'att', col: '#6a5aa8', stack: 1, val: 280, rar: 'epic', desc: 'High-power scope: 8x zoom for long shots. Clumsy from the hip.' },
  att_silencer: { name: 'Silencer', cat: 'att', col: '#4a4e56', stack: 1, val: 140, rar: 'rare', desc: 'Much quieter: enemies only hear your shots from close by, and there is no muzzle flash. Slightly shorter range.' },
  att_brake: { name: 'Muzzle Brake', cat: 'att', col: '#8a7a5a', stack: 1, val: 70, rar: 'uncommon', desc: 'Vents the blast sideways: far less recoil, but the shots scatter more.' },
  att_laser: { name: 'Laser Sight', cat: 'att', col: '#e03a2e', stack: 1, val: 110, rar: 'uncommon', desc: 'Puts a red dot on whatever you point at and tightens hip fire a lot.' },
  att_flashlight: { name: 'Weapon Flashlight', cat: 'att', col: '#e8c860', stack: 1, val: 40, desc: 'A bright, long beam under the barrel at night (follows the gun flashlight setting).' },
  att_extmag: { name: 'Extended Magazine', cat: 'att', col: '#7a6a3a', stack: 1, val: 150, rar: 'rare', desc: '40% more rounds per magazine, a little slower to reload.' },
};

// ---------------------------------------------------------------- attachments
// slot = where it goes. Multipliers (default 1): ads / hip = spread when aiming / from the hip, spread = both,
// recoil, noise (alert radius), range, speed (projectile), mag (magazine size), reload (time).
// zoom = ADS magnification, scope = overlay reticle (0 duplex, 1 mil-dot), flash 0 = no muzzle flash.
export const ATTACH = {
  att_holo: { slot: 'sight', zoom: 1.6, ads: 0.82, holo: 1 },
  att_scope4: { slot: 'sight', zoom: 4, ads: 0.55, hip: 1.15, scope: 0 },
  att_scope8: { slot: 'sight', zoom: 8, ads: 0.4, hip: 1.3, scope: 1 },
  att_silencer: { slot: 'muzzle', noise: 0.2, flash: 0, range: 0.88, speed: 0.9, recoil: 0.9, quiet: 1 },
  att_brake: { slot: 'muzzle', recoil: 0.55, spread: 1.25 },
  att_laser: { slot: 'rail', hip: 0.6, laser: 1 },
  att_flashlight: { slot: 'rail', light: 1 },
  att_extmag: { slot: 'mag', mag: 1.4, reload: 1.12 },
};
export const ATT_SLOTS = ['sight', 'muzzle', 'rail', 'mag'];
export const ATT_SLOT_NAME = { sight: 'Sight', muzzle: 'Muzzle', rail: 'Rail', mag: 'Magazine' };
const AS = ['att_holo', 'att_scope4', 'att_scope8'], AM = ['att_silencer', 'att_brake'], AR = ['att_laser', 'att_flashlight'];
/** what each gun takes (guns not listed take nothing: bow, rocket launcher) */
export const ATT_ALLOW = {
  pipe_pistol: ['att_silencer', ...AR],
  revolver: ['att_holo', ...AR],
  semi_pistol: ['att_holo', 'att_silencer', ...AR, 'att_extmag'],
  magnum: ['att_holo', 'att_scope4', ...AR],
  boomstick: [...AR], waterpipe: [...AR], nailgun: [...AR],
  pump: ['att_holo', 'att_brake', ...AR],
  auto_shotgun: ['att_holo', 'att_brake', ...AR],
  smg: ['att_holo', ...AM, ...AR, 'att_extmag'],
  tac_smg: ['att_holo', 'att_scope4', ...AM, ...AR, 'att_extmag'],
  ar: [...AS, ...AM, ...AR, 'att_extmag'],
  lancer: [...AS, ...AM, ...AR, 'att_extmag'],
  semi_rifle: [...AS, ...AM, ...AR, 'att_extmag'],
  hunting: [...AS, ...AM, ...AR],          // a sight replaces its own hunting scope
  sniper: ['att_silencer', ...AR],         // keeps its fixed high-power scope
  lmg: ['att_holo', 'att_scope4', ...AM, ...AR],
  crossbow: ['att_holo', 'att_scope4', ...AR],
};
for (const k in ATT_ALLOW) Object.freeze(ATT_ALLOW[k]);
const NONE = Object.freeze([]);
/** attachment ids gun `gid` accepts */
export function attAllowed(gid) { return ATT_ALLOW[gid] || NONE; }
const FX0 = Object.freeze({ zoom: 1, ads: 1, hip: 1, spread: 1, recoil: 1, noise: 1, flash: 1, range: 1, speed: 1, mag: 1, reload: 1, laser: 0, light: 0, scope: -1, holo: 0, quiet: 0, sight: 0, n: 0 });
const FX_MUL = ['ads', 'hip', 'spread', 'recoil', 'noise', 'range', 'speed', 'mag', 'reload'];
const fxCache = new WeakMap();
/**
 * Combined effect of a gun's attachments: pass the gun stack, its att object, or null.
 * Returns a frozen object, cached per att object (attachTo / detachFrom always make a new one).
 */
export function attFx(x) {
  const att = x && x.id !== undefined ? x.att : x;
  if (!att || typeof att !== 'object') return FX0;
  let o = fxCache.get(att); if (o) return o;
  o = Object.assign({}, FX0);
  for (const k in att) {
    const A = ATTACH[att[k]]; if (!A || A.slot !== k) continue; o.n++;
    for (const f of FX_MUL) if (A[f] !== undefined) o[f] *= A[f];
    if (A.zoom) { o.zoom = A.zoom; o.sight = 1; }
    if (A.scope !== undefined) o.scope = A.scope;
    if (A.flash === 0) o.flash = 0;
    if (A.laser) o.laser = 1; if (A.light) o.light = 1; if (A.holo) o.holo = 1; if (A.quiet) o.quiet = 1;
  }
  Object.freeze(o); fxCache.set(att, o); return o;
}
let WREF = null;   // the game's WEAPONS table (set by registerWeaponsData)
/** magazine size of a gun stack (with an extended magazine fitted) */
export function gunMag(s) {
  const W = s && WREF && WREF[s.id]; if (!W) return 0;
  const k = attFx(s).mag; return k === 1 ? W.mag : Math.max(W.mag + 1, Math.round(W.mag * k));
}
/** reload time of a gun stack */
export function gunReload(s) { const W = s && WREF && WREF[s.id]; return W ? W.reload * attFx(s).reload : 0; }
// NPC guns: chance per slot of carrying an attachment, by enemy type
const NPC_ATT = { scav: 0.06, gunner: 0.1, bandit: 0.22, outlaw: 0.3, brute: 0.3, deckhand: 0.42, soldier: 0.5, hazguard: 0.5, guard: 0.55, warlord: 0.9, ironjack: 0.9 };
const NPC_SLOT = { sight: 1, rail: 0.6, muzzle: 0.45, mag: 0.35 };
/** random attachments for an NPC's gun (or null) */
export function rollNpcAtt(type, gid, rnd = Math.random) {
  const p = NPC_ATT[type] || 0, ok = attAllowed(gid); if (!p || !ok.length) return null;
  const att = {};
  for (const slot of ATT_SLOTS) {
    if (rnd() >= p * NPC_SLOT[slot]) continue;
    const opts = ok.filter(a => ATTACH[a].slot === slot); if (opts.length) att[slot] = opts[Math.floor(rnd() * opts.length) % opts.length];
  }
  return Object.keys(att).length ? att : null;
}

// ranges in metres, projectile speed m/s, noise = alert radius m (see WEAPONS in data.js)
export const WX_WEAPONS = {
  crossbow: { dmg: 62, rof: 1.0, mag: 1, reload: 2.3, spread: 0.02, speed: 64, range: 40, ammo: 'arrow', pen: 0.2, noise: 8, sfx: 'bow', arrow: true, kick: 0.02 },
  nailgun: { dmg: 10, rof: 6.5, mag: 32, reload: 2.1, spread: 0.065, speed: 80, range: 16, ammo: 'nails', pen: 0.05, noise: 12, sfx: 'turret', auto: true, kick: 0.006 },
  semi_rifle: { dmg: 35, rof: 3.6, mag: 16, reload: 2.6, spread: 0.03, speed: 195, range: 46, ammo: 'rifle_ammo', alt: 'ap_ammo', pen: 0.5, noise: 56, sfx: 'rifle', kick: 0.022 },
  sniper: { dmg: 125, rof: 0.6, mag: 5, reload: 3.8, spread: 0.004, speed: 320, range: 90, ammo: 'rifle_ammo', alt: 'ap_ammo', pen: 0.75, noise: 75, sfx: 'sniper', scope: 2, kick: 0.075 },
  lmg: { dmg: 24, rof: 10, mag: 60, reload: 5.2, spread: 0.075, speed: 175, range: 42, ammo: 'rifle_ammo', alt: 'ap_ammo', pen: 0.45, noise: 64, sfx: 'rifle', auto: true, kick: 0.016 },
  waterpipe: { dmg: 11, pellets: 9, rof: 1, mag: 1, reload: 2.1, spread: 0.24, speed: 95, range: 13, ammo: 'shell', pen: 0.05, noise: 44, sfx: 'shotgun', kick: 0.07 },
  semi_pistol: { dmg: 22, rof: 6, mag: 10, reload: 1.6, spread: 0.045, speed: 140, range: 30, ammo: 'pistol_ammo', pen: 0.2, noise: 36, sfx: 'pistol', kick: 0.018 },
  magnum: { dmg: 46, rof: 1.6, mag: 6, reload: 2.8, spread: 0.028, speed: 150, range: 36, ammo: 'pistol_ammo', pen: 0.35, noise: 46, sfx: 'pistol', kick: 0.05 },
  tac_smg: { dmg: 16, rof: 11, mag: 30, reload: 2.2, spread: 0.07, speed: 140, range: 30, ammo: 'pistol_ammo', pen: 0.25, noise: 42, sfx: 'smg', auto: true, kick: 0.008 },
  lancer: { dmg: 23, rof: 8.2, mag: 30, reload: 2.4, spread: 0.04, speed: 175, range: 42, ammo: 'rifle_ammo', alt: 'ap_ammo', pen: 0.45, noise: 54, sfx: 'rifle', auto: true, kick: 0.009 },
  auto_shotgun: { dmg: 11, pellets: 8, rof: 3.2, mag: 7, reload: 3.4, spread: 0.15, speed: 110, range: 18, ammo: 'shell', pen: 0.1, noise: 50, sfx: 'shotgun', kick: 0.045 },
};

// wb = workbench tier, bp = needs a blueprint (inserted after the last recipe of the same tier)
export const WX_RECIPES = [
  { id: 'nails', out: 'nails', n: 20, cost: { metal: 15 }, wb: 1 },
  { id: 'nailgun', out: 'nailgun', n: 1, cost: { metal: 100, gears: 1, pipe: 1, tape: 1 }, wb: 1 },
  { id: 'crossbow', out: 'crossbow', n: 1, cost: { wood: 120, metal: 60, rope: 2, gears: 1 }, wb: 1 },
  { id: 'semi_rifle', out: 'semi_rifle', n: 1, cost: { metal: 220, hqm: 6, spring: 1, pipe: 1 }, wb: 2, bp: true },
  { id: 'sniper', out: 'sniper', n: 1, cost: { hqm: 25, metal: 180, pipe: 2, spring: 2 }, wb: 3, bp: true },
  { id: 'lmg', out: 'lmg', n: 1, cost: { hqm: 40, metal: 300, spring: 2, gears: 3 }, wb: 3, bp: true },
  { id: 'waterpipe', out: 'waterpipe', n: 1, cost: { wood: 120, metal: 60, pipe: 1 }, wb: 0 },
  { id: 'semi_pistol', out: 'semi_pistol', n: 1, cost: { metal: 150, pipe: 1, spring: 1 }, wb: 1, bp: true },
  { id: 'magnum', out: 'magnum', n: 1, cost: { metal: 180, hqm: 5, pipe: 1, spring: 1 }, wb: 2, bp: true },
  { id: 'tac_smg', out: 'tac_smg', n: 1, cost: { hqm: 15, metal: 150, spring: 2, gears: 1 }, wb: 3, bp: true },
  { id: 'lancer', out: 'lancer', n: 1, cost: { hqm: 25, metal: 180, spring: 2, gears: 2 }, wb: 3, bp: true },
  { id: 'auto_shotgun', out: 'auto_shotgun', n: 1, cost: { hqm: 20, metal: 200, spring: 2, pipe: 2 }, wb: 3, bp: true },
  // attachments
  { id: 'att_flashlight', out: 'att_flashlight', n: 1, cost: { metal: 30, tape: 1 }, wb: 1 },
  { id: 'att_brake', out: 'att_brake', n: 1, cost: { metal: 70, pipe: 1 }, wb: 1 },
  { id: 'att_silencer', out: 'att_silencer', n: 1, cost: { metal: 60, pipe: 1, tape: 1 }, wb: 1, bp: true },
  { id: 'att_laser', out: 'att_laser', n: 1, cost: { metal: 50, circuit: 1, tape: 1 }, wb: 2, bp: true },
  { id: 'att_holo', out: 'att_holo', n: 1, cost: { metal: 60, hqm: 2, circuit: 1 }, wb: 2, bp: true },
  { id: 'att_extmag', out: 'att_extmag', n: 1, cost: { metal: 120, spring: 2 }, wb: 2, bp: true },
  { id: 'att_scope4', out: 'att_scope4', n: 1, cost: { metal: 80, hqm: 4, gears: 1 }, wb: 2, bp: true },
  { id: 'att_scope8', out: 'att_scope8', n: 1, cost: { metal: 100, hqm: 10, gears: 2 }, wb: 3, bp: true },
];

// [table, id, weight, min, max]
const WX_LOOT = [
  ['barrel', 'nails', 2, 6, 14], ['crate', 'nails', 2.5, 8, 20], ['toolbox', 'nails', 3, 10, 24], ['raider', 'nails', 2, 6, 14], ['human1', 'nails', 1.5, 5, 12],
  ['crate', 'nailgun', 0.7, 1, 1], ['toolbox', 'nailgun', 1.0, 1, 1],
  ['crate', 'crossbow', 0.45, 1, 1], ['ammobox', 'crossbow', 0.5, 1, 1], ['cache', 'crossbow', 0.5, 1, 1],
  ['military', 'semi_rifle', 0.8, 1, 1], ['airdrop', 'semi_rifle', 1.5, 1, 1], ['cargo', 'semi_rifle', 1.2, 1, 1],
  ['military', 'bp_semi_rifle', 0.5, 1, 1], ['elite', 'bp_semi_rifle', 0.4, 1, 1],
  ['elite', 'sniper', 0.5, 1, 1], ['airdrop', 'sniper', 0.8, 1, 1], ['cargo', 'sniper', 1.0, 1, 1],
  ['elite', 'bp_sniper', 0.45, 1, 1], ['cargo', 'bp_sniper', 0.6, 1, 1],
  ['elite', 'lmg', 0.45, 1, 1], ['military', 'lmg', 0.12, 1, 1],   // the LMG itself only comes from these crates (or crafting)
  ['elite', 'bp_lmg', 0.4, 1, 1], ['cargo', 'bp_lmg', 0.5, 1, 1],
  // second-wave guns
  ['crate', 'waterpipe', 0.8, 1, 1], ['barrel', 'waterpipe', 0.25, 1, 1], ['raider', 'waterpipe', 0.4, 1, 1],
  ['crate', 'semi_pistol', 0.4, 1, 1], ['ammobox', 'semi_pistol', 0.7, 1, 1], ['cache', 'semi_pistol', 0.6, 1, 1], ['human2', 'semi_pistol', 0.3, 1, 1],
  ['crate', 'bp_semi_pistol', 0.35, 1, 1], ['cache', 'bp_semi_pistol', 0.5, 1, 1],
  ['military', 'magnum', 0.6, 1, 1], ['airdrop', 'magnum', 1, 1, 1], ['military', 'bp_magnum', 0.45, 1, 1],
  ['elite', 'tac_smg', 0.8, 1, 1], ['airdrop', 'tac_smg', 1.2, 1, 1], ['cargo', 'tac_smg', 1.2, 1, 1], ['military', 'tac_smg', 0.15, 1, 1],
  ['elite', 'bp_tac_smg', 0.45, 1, 1], ['cargo', 'bp_tac_smg', 0.5, 1, 1],
  ['elite', 'lancer', 0.7, 1, 1], ['airdrop', 'lancer', 1.2, 1, 1], ['cargo', 'lancer', 1.4, 1, 1],
  ['elite', 'bp_lancer', 0.4, 1, 1], ['cargo', 'bp_lancer', 0.5, 1, 1],
  ['elite', 'auto_shotgun', 0.6, 1, 1], ['airdrop', 'auto_shotgun', 1, 1, 1], ['cargo', 'auto_shotgun', 1, 1, 1],
  ['elite', 'bp_auto_shotgun', 0.4, 1, 1], ['boss', 'bp_auto_shotgun', 1, 1, 1],
  // attachments and their blueprints
  ['crate', 'att_flashlight', 0.9, 1, 1], ['toolbox', 'att_flashlight', 1.2, 1, 1], ['toolbox', 'att_brake', 0.8, 1, 1], ['crate', 'att_brake', 0.4, 1, 1],
  ['ammobox', 'att_silencer', 0.5, 1, 1], ['ammobox', 'att_laser', 0.5, 1, 1], ['ammobox', 'att_holo', 0.4, 1, 1], ['ammobox', 'att_brake', 0.6, 1, 1],
  ['military', 'att_holo', 1.4, 1, 1], ['military', 'att_silencer', 1, 1, 1], ['military', 'att_laser', 1, 1, 1], ['military', 'att_extmag', 0.8, 1, 1],
  ['military', 'att_scope4', 0.7, 1, 1], ['military', 'att_flashlight', 1, 1, 1],
  ['elite', 'att_scope4', 1.4, 1, 1], ['elite', 'att_scope8', 0.8, 1, 1], ['elite', 'att_extmag', 1.2, 1, 1], ['elite', 'att_silencer', 1.2, 1, 1], ['elite', 'att_holo', 1, 1, 1],
  ['airdrop', 'att_scope4', 1.2, 1, 1], ['airdrop', 'att_scope8', 0.8, 1, 1], ['airdrop', 'att_extmag', 1, 1, 1], ['airdrop', 'att_holo', 1.2, 1, 1],
  ['cargo', 'att_scope8', 1.2, 1, 1], ['cargo', 'att_extmag', 1.2, 1, 1], ['cargo', 'att_silencer', 1, 1, 1],
  ['human3', 'att_holo', 0.6, 1, 1], ['human3', 'att_laser', 0.4, 1, 1], ['human3', 'att_flashlight', 0.6, 1, 1], ['boss', 'att_scope8', 1.5, 1, 1],
  ['cache', 'att_silencer', 0.5, 1, 1], ['cache', 'bp_att_silencer', 0.5, 1, 1],
  ['ammobox', 'bp_att_silencer', 0.4, 1, 1], ['military', 'bp_att_holo', 0.5, 1, 1], ['military', 'bp_att_laser', 0.5, 1, 1], ['military', 'bp_att_extmag', 0.4, 1, 1],
  ['military', 'bp_att_scope4', 0.4, 1, 1], ['elite', 'bp_att_scope4', 0.5, 1, 1], ['elite', 'bp_att_scope8', 0.4, 1, 1], ['cargo', 'bp_att_scope8', 0.5, 1, 1],
];

// extra guns in NPC loadouts (one entry each, so they stay the odd one out)
const WX_ENEMY_GUNS = {
  scav: ['nailgun', 'waterpipe'], gunner: ['nailgun', 'waterpipe', 'semi_pistol'], bandit: ['crossbow', 'semi_pistol', 'magnum'], outlaw: ['magnum', 'tac_smg'],
  soldier: ['semi_rifle', 'lancer', 'tac_smg'], deckhand: ['semi_rifle', 'auto_shotgun', 'lancer'], hazguard: ['lmg', 'tac_smg', 'auto_shotgun'], brute: ['auto_shotgun'],
};

const WX_RECYCLE = {
  crossbow: { wood: 30, metal: 20, rope: 1 }, nailgun: { metal: 30, gears: 1 }, semi_rifle: { metal: 70, hqm: 2, spring: 1 },
  sniper: { metal: 60, hqm: 8, spring: 1 }, lmg: { metal: 100, hqm: 12, spring: 1, gears: 1 },
  waterpipe: { wood: 30, metal: 20, pipe: 1 }, semi_pistol: { metal: 50, spring: 1 }, magnum: { metal: 60, hqm: 2, spring: 1 },
  tac_smg: { metal: 60, hqm: 6, spring: 1 }, lancer: { metal: 70, hqm: 9, spring: 1 }, auto_shotgun: { metal: 70, hqm: 7, spring: 1 },
  att_holo: { metal: 20, circuit: 1 }, att_scope4: { metal: 25, hqm: 1, gears: 1 }, att_scope8: { metal: 30, hqm: 4, gears: 1 },
  att_silencer: { metal: 20, pipe: 1 }, att_brake: { metal: 25 }, att_laser: { metal: 15, circuit: 1 }, att_flashlight: { metal: 10, tape: 1 },
  att_extmag: { metal: 40, spring: 1 },
};
// [shop, id, n, price]
const WX_SHOP = [['arms', 'nails', 30, 12], ['arms', 'crossbow', 1, 160], ['arms', 'waterpipe', 1, 90], ['arms', 'att_flashlight', 1, 60], ['arms', 'att_brake', 1, 110], ['tech', 'att_laser', 1, 180]];

function bpItem(ITEMS, r) {
  const out = ITEMS[r.out];
  return { name: 'Blueprint: ' + (out ? out.name : r.out), cat: 'bp', col: '#4a8ad8', stack: 1, val: 30 + r.wb * 60, rar: r.wb >= 3 ? 'epic' : r.wb === 2 ? 'rare' : 'uncommon', teach: r.id };
}

/** Adds the new guns, ammo, recipes, blueprints, loot and NPC loadouts to the game's data tables. Safe to call twice. */
export function registerWeaponsData({ ITEMS, WEAPONS, RECIPES, RECIPE, LOOT, ENEMIES, BP_BY_TIER, RECYCLE, SHOPS } = {}) {
  const out = { items: 0, weapons: 0, recipes: 0, bps: 0, loot: 0, npc: 0 };
  if (WEAPONS) WREF = WEAPONS;
  if (ITEMS) for (const id in WX_ITEMS) if (!ITEMS[id]) { ITEMS[id] = Object.assign({}, WX_ITEMS[id]); out.items++; }
  if (WEAPONS) for (const id in WX_WEAPONS) if (!WEAPONS[id]) { WEAPONS[id] = Object.assign({}, WX_WEAPONS[id]); out.weapons++; }
  if (Array.isArray(RECIPE) && !RECIPES) { RECIPES = RECIPE; RECIPE = null; }   // tolerate the list passed as RECIPE
  for (const r of WX_RECIPES) {
    let rec = (RECIPES && RECIPES.find(q => q.id === r.id)) || (RECIPE && RECIPE[r.id]) || null;
    if (!rec) rec = Object.assign({}, r, { cost: Object.assign({}, r.cost) });
    if (RECIPES && !RECIPES.includes(rec)) {
      // keep the crafting list ordered by workbench tier: after the last recipe of the same tier
      let at = -1; for (let i = 0; i < RECIPES.length; i++) if ((RECIPES[i].wb || 0) === r.wb) at = i;
      if (at < 0) RECIPES.push(rec); else RECIPES.splice(at + 1, 0, rec);
      out.recipes++;
    }
    if (RECIPE && !RECIPE[r.id]) RECIPE[r.id] = rec;
    if (rec.bp) {
      const bid = 'bp_' + rec.id;
      if (ITEMS && !ITEMS[bid]) { ITEMS[bid] = bpItem(ITEMS, rec); out.bps++; }
      if (BP_BY_TIER && BP_BY_TIER[rec.wb] && !BP_BY_TIER[rec.wb].includes(bid)) BP_BY_TIER[rec.wb].push(bid);
    }
  }
  if (LOOT) for (const [t, id, w, a, b] of WX_LOOT) { const T = LOOT[t]; if (T && T.items && !T.items.some(e => e[0] === id)) { T.items.push([id, w, a, b]); out.loot++; } }
  if (ENEMIES) for (const k in WX_ENEMY_GUNS) { const E = ENEMIES[k]; if (!E || !Array.isArray(E.guns)) continue; for (const g of WX_ENEMY_GUNS[k]) if (!E.guns.includes(g)) { E.guns.push(g); out.npc++; } }
  if (RECYCLE) for (const id in WX_RECYCLE) if (!RECYCLE[id]) RECYCLE[id] = Object.assign({}, WX_RECYCLE[id]);
  if (SHOPS) for (const [s, id, n, price] of WX_SHOP) { const S = SHOPS[s]; if (S && S.stock && !S.stock.some(e => e[0] === id)) S.stock.push([id, n, price]); }
  return out;
}

// ============================================================================
// ICONS — 16x16 pixel art in the style of js/art_icons.js (side views pointing
// right, light from the top-left, 1px dark outline). Digits 1-5 are a ramp of the
// item colour; letters are fixed palette colours.
// ============================================================================
const OUTC = '#181425', HI = '#fff4d6', LO = '#1a1530';
const FIXP = {
  o: OUTC, k: '#262b44', h: '#ffffff', s: '#c0cbdc', m: '#8b9bb4', n: '#5a6988', N: '#3a4466',
  w: '#e4a672', W: '#b86f50', v: '#733e39', V: '#3e2731', p: '#ead4aa', q: '#d2a684',
  y: '#fee761', g: '#feae34', u: '#d77643', t: '#be4a2f', r: '#e43b44', R: '#a22633',
  l: '#63c74d', L: '#3e8948', D: '#265c42', b: '#0099db', c: '#2ce8f5',
  a: '#c9ccd1', A: '#9ea3a9', X: '#6c7178', Z: '#45484f',
  Y: '#f0cf7a', H: '#d0a84a', I: '#97702e', U: '#5e4220',
};
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
function mixHex(a, b, t) { const A = hexRgb(a), B = hexRgb(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); }
function rampOf(col) { return { 1: mixHex(col, HI, 0.55), 2: mixHex(col, HI, 0.25), 3: col, 4: mixHex(col, LO, 0.36), 5: mixHex(col, LO, 0.6) }; }

const ICONS = {
  // top-down: wooden stock and rail, steel prod across the front, string drawn back to the latch, an arrow on the rail
  crossbow: {
    col: '#a06a3a', extra: { M: '#3a4466' }, rows: [
      '..........kN..',
      '.........hmN..',
      '........h..mn.',
      '.......h...mn.',
      'VW....h....mn.',
      'v322222222tMNk',
      'v4pppppppppMsh',
      'v433333333tMNk',
      'VW....h....mn.',
      '.......h...mn.',
      '........h..mn.',
      '.........hmN..',
      '..........kN..',
    ],
  },
  // battery nailer: round yellow motor body with a black end cap, drive head at the front, black grip on a battery, angled nail magazine
  nailgun: {
    col: '#e8a832', rows: [
      '..........222.',
      '.kk2222222212.',
      'kZZ1111111213.',
      'kZZ3333333334.',
      '.kk4444444434.',
      '....kkk...k44.',
      '....kko...kkk.',
      '...kkk....3s4m',
      '...kkk..nmmNs.',
      '..kkkknmn.....',
      '..kkkkkk......',
      '..222222......',
    ],
  },
  // full wooden stock, blued receiver, short box magazine, peep rear sight and hooded front post
  semi_rifle: {
    col: '#a8642e', rows: [
      '.....n......N.',
      '....NmmN....N.',
      '2...NnnNssssss',
      '3222NnnN2222nN',
      '33334NNk3334..',
      '334.oNk.......',
      '345..Nk.......',
      '.45...........',
    ],
  },
  // khaki stock, big scope with a wide objective bell, long barrel with a muzzle brake, folded bipod
  sniper: {
    col: '#9a8e5e', rows: [
      '..kN......kNNk',
      '..NmssssssmmmN',
      '..kNnnnnnnNNNk',
      '22...N..N.....',
      '3222NNmsssssNN',
      '3333NnnnnnnnNk',
      '344.oNN.mmmm..',
      '345..NN.......',
      '.45...........',
    ],
  },
  // olive receiver with a carry handle, perforated barrel shroud, ammo box with a brass belt, bipod legs
  lmg: {
    col: '#5e6842', rows: [
      '......kNNk....',
      '......N..N....',
      'XX.222222NNNNk',
      'XXZ311113sNsNN',
      'XXZ344444NNNNk',
      'ZZ.ko2222.n.n.',
      '...kY3113.n.n.',
      '....H4444.n.n.',
      '.....5555.....',
    ],
  },
  // plank stock with a taped grip, a long water-pipe barrel
  waterpipe: {
    col: '#8a6a48', rows: [
      '......sssssss.',
      '.....snnnnnnnN',
      'ww..Wsmmmmmmmm',
      'wwWWWnNNNNNNNN',
      'vWWWaAk.......',
      'vvWkaA........',
      'vv..k.........',
    ],
  },
  // slide on a polymer frame, trigger guard, chequered grip with the magazine base
  semi_pistol: {
    col: '#5e636c', rows: [
      '.11111111111..',
      '.2222222222h..',
      '.3333333333...',
      '.k444444444k..',
      '..kZZ4kkk.....',
      '..ZXZ.k.k.....',
      '.ZXZZ.kk......',
      '.ZXZ..........',
      '.mmm..........',
    ],
  },
  // stainless barrel with a vent rib, fat cylinder, wooden grip
  magnum: {
    col: '#b9bdc6', rows: [
      '.k...........k',
      '.2111111111112',
      'k3322222222223',
      'k3443333333334',
      '.k44kkk.......',
      '.WwN.k.k......',
      'WwwW.kk.......',
      'Www...........',
      'vvW...........',
      'vv............',
    ],
  },
  // compact receiver with a handguard, folding stock, curved magazine
  tac_smg: {
    col: '#454950', rows: [
      '.....kk.......',
      'N...2222222...',
      'NNNN3333333mmn',
      'NN.N4444444...',
      '....kZZ.N4....',
      '....ZZk.N44...',
      '....ZZ...N4...',
      '.........N44..',
      '..........N4..',
    ],
  },
  // flat-top rail, skeleton stock, straight magazine, long barrel
  lancer: {
    col: '#5a5e52', rows: [
      '....kkkkkkk...',
      'N..k3333333..k',
      'NN22444444444s',
      'N.N.N4444Nmmmn',
      '...kZZ.N4.....',
      '...ZZk.N4.....',
      '...ZZ..N44....',
      '........N4....',
    ],
  },
  // long receiver, magazine tube under the barrel, pistol grip, folded stock
  auto_shotgun: {
    col: '#3c3f46', rows: [
      'kk..222222222k',
      'kNN2333333333k',
      '.kN444444444k.',
      '...44mmmmmmmn.',
      '...kZk........',
      '...ZZ.........',
      '..kZZ.........',
    ],
  },
  // holosight: open frame with a blue-tinted window and the red dot, on a rail clamp
  att_holo: {
    col: '#c8423a', rows: [
      '...NNNNNNN...',
      '..Nc.....cN..',
      '..N.......N..',
      '..N...rr..N..',
      '..N...rr..N..',
      '..N.......N..',
      '.NNNNNNNNNNN.',
      '.k222222222k.',
      '..k..k.k..k..',
    ],
  },
  // 4x scope: eyepiece, tube with a turret, objective bell with a lens, two rings
  att_scope4: {
    col: '#4a6a8a', rows: [
      '.....kk.......',
      '.....NN.......',
      '22..2222222.22',
      '3322333333322b',
      '4433444444433b',
      '44..4444444.44',
      '....N...N.....',
      '...NNN.NNN....',
    ],
  },
  // 8x scope: longer, with a wide bell and two turrets
  att_scope8: {
    col: '#6a5aa8', rows: [
      '....kk.kk.....',
      '....NN.NN...22',
      '2..22222222233',
      '3322333333333b',
      '4433444444444b',
      '4..44444444.44',
      '.....N....N...',
      '....NNN..NNN..',
    ],
  },
  // silencer: a long ridged can
  att_silencer: {
    col: '#5a5f68', rows: [
      '.k1111111111k.',
      'k122222222222k',
      'k23N333N333N3N',
      'k34N444N444N4N',
      'k455555555555k',
      '.k5555555555k.',
    ],
  },
  // muzzle brake: short block with side ports
  att_brake: {
    col: '#8a7a5a', rows: [
      '.1212121212.',
      'k23kk3kk3k3N',
      'k34kk4kk4k4N',
      'k4545454545N',
      '.5555555555.',
    ],
  },
  // laser module and its beam
  att_laser: {
    col: '#e03a2e', rows: [
      'kNNNNNk.......',
      'NmmmmmmRrrrrrr',
      'NnnnnnnR......',
      'kNNNNNk.......',
      '.k..k.........',
    ],
  },
  // flashlight: body, bezel and a yellow beam
  att_flashlight: {
    col: '#e8c860', rows: [
      '..........yy..',
      '.kkkkkkkNyyy..',
      'kmmmmmmmNyyyyy',
      'knnnnnnnNyyyyy',
      '.kkkkkkkNyyy..',
      '..........yy..',
    ],
  },
  // extended magazine: a long curved box mag with a brass round on top
  att_extmag: {
    col: '#7a6a3a', rows: [
      '..YH......',
      '..3333....',
      '..3443....',
      '..34433...',
      '...4443...',
      '...44433..',
      '....4443..',
      '....44433.',
      '.....4443.',
      '.....5555.',
    ],
  },
  // a strip of collated nails with a red paper band
  nails: {
    col: '#a9b0b8', rows: [
      'hss.hss.hss',
      'mmn.mmn.mmn',
      '.m...m...m.',
      'rrrrrrrrrrr',
      'RRRRRRRRRRR',
      '.m...m...m.',
      '.m...m...m.',
      '.n...n...n.',
      '.n...n...n.',
      '.N...N...N.',
    ],
  },
};

let iconCache = null;
/** 16x16 canvas for one of the new ids (null for other ids) */
export function weaponIcon(id) {
  const spec = ICONS[id]; if (!spec || typeof document === 'undefined') return null;
  iconCache = iconCache || {};
  if (iconCache[id]) return iconCache[id];
  const pal = Object.assign({}, FIXP, rampOf(spec.col), spec.extra || {});
  const rows = spec.rows, h = Math.min(14, rows.length), w = Math.min(14, Math.max(...rows.map(r => r.length)));
  const c = document.createElement('canvas'); c.width = c.height = 16; const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
  const ox = Math.floor((16 - w) / 2), oy = Math.floor((16 - h + 1) / 2);
  for (let j = 0; j < h; j++) for (let i = 0; i < w && i < rows[j].length; i++) {
    const ch = rows[j][i]; if (ch === '.' || ch === ' ') continue; const col = pal[ch]; if (!col) continue;
    g.fillStyle = col; g.fillRect(ox + i, oy + j, 1, 1);
  }
  // 1px dark outline around the opaque pixels
  const d = g.getImageData(0, 0, 16, 16).data, on = (x, y) => x >= 0 && y >= 0 && x < 16 && y < 16 && d[(y * 16 + x) * 4 + 3] > 0;
  g.fillStyle = OUTC;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (!on(x, y) && (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1))) g.fillRect(x, y, 1, 1);
  return (iconCache[id] = c);
}

/** Route ART.icon / ART.iconURL for the new gun and ammo ids to the icons above. Returns true if installed. */
export function registerWeaponsIcons(A) {
  A = A || (typeof window !== 'undefined' ? window.ART : null);
  if (!A || !A.iconURL || A._weaponsExtra) return false;
  const baseURL = A.iconURL, baseIcon = A.icon, urls = {};
  A.icon = id => (ICONS[id] && weaponIcon(id)) || (baseIcon ? baseIcon(id) : null);
  A.iconURL = id => {
    if (!ICONS[id]) return baseURL(id);
    if (!urls[id]) { try { const c = weaponIcon(id); urls[id] = c ? c.toDataURL() : baseURL(id); } catch (e) { urls[id] = baseURL(id); } }
    return urls[id];
  };
  A._weaponsExtra = true;
  return true;
}
