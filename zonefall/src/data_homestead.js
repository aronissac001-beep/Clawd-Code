// ============================================================================
// ZONEFALL — homestead data: electricity, farming and cooking. Items (seeds,
// crops, cooked food, the wire tool), deployables (generator, solar panel,
// wind turbine, battery, switch, splitter, timer, motion sensor, ceiling light,
// electric furnace, door controller, small planter, cooking pot), recipes,
// loot, vendor stock, the electrical spec of every powered deployable, the
// crops and the cooking-pot recipes.
//
//   registerHomesteadData({ ITEMS, RECIPES, RECIPE, LOOT, DEPLOY, DEPLOY_ORDER, OVENS, SHOPS, RECYCLE })
//       once, at the end of data.js (idempotent)
//   registerHomesteadIcons(ART?)   16 px pixel icons for the new item ids (wraps ART.icon / ART.iconURL)
//
// Imports nothing, so data.js can import it without a cycle.
// Units: power in watts (W). Battery charge is in watt-minutes (Wm) of real
// time: 600 Wm runs a 10 W floodlight for an hour. One in-game day is ~12 real
// minutes (the night runs at double speed, so it lasts about 2.6 minutes).
// ============================================================================

export const WIRE_RANGE = 30; // longest cable, metres (port to port)

// ---------------------------------------------------------------------------
// electrical spec per deployable type
//   kind  gen | solar | wind | battery | switch | split | timer | sensor | light | turret | furnace | door
//   ins / outs   number of input / output sockets (an output feeds one cable)
//   use   watts the device itself needs to work (lights pass the rest on through their output)
//   ports: { in: [[x,y,z]], out: [[x,y,z]...], ind: [x,y,z] } socket + indicator lamp positions in
//          model space (model faces +X at ry = 0, origin at the floor centre)
// ---------------------------------------------------------------------------
export const POWER = {
  generator: { kind: 'gen', ins: 0, outs: 1, max: 40, fuel: 'low_fuel', burn: 30, ports: { in: [], out: [[0.53, 0.3, 0.12]], ind: [0.53, 0.42, -0.12] } },
  solar_panel: { kind: 'solar', ins: 0, outs: 1, max: 20, ports: { in: [], out: [[-0.18, 0.36, 0.13]], ind: [-0.18, 0.46, -0.05] } },
  wind_turbine: { kind: 'wind', ins: 0, outs: 1, max: 60, ports: { in: [], out: [[0.2, 0.55, 0.06]], ind: [0.2, 0.68, -0.06] } },
  battery: { kind: 'battery', ins: 1, outs: 1, cap: 600, rate: 50, ports: { in: [[0.42, 0.22, -0.16]], out: [[0.42, 0.22, 0.16]], ind: [0.42, 0.62, 0.17] } },
  switch: { kind: 'switch', ins: 1, outs: 1, use: 1, ports: { in: [[0.0, 0.8, -0.1]], out: [[0.0, 0.8, 0.1]], ind: [0.1, 1.04, 0.07] } },
  splitter: { kind: 'split', ins: 1, outs: 3, use: 0, ports: { in: [[0.1, 0.66, 0]], out: [[0.1, 0.86, -0.1], [0.1, 0.86, 0], [0.1, 0.86, 0.1]], ind: [0.1, 0.76, 0.12] } },
  timer: { kind: 'timer', ins: 1, outs: 1, use: 1, ports: { in: [[0.0, 0.72, -0.1]], out: [[0.0, 0.72, 0.1]], ind: [0.1, 1.02, 0.1] } },
  motion_sensor: { kind: 'sensor', ins: 1, outs: 1, use: 1, range: 9, hold: 5, ports: { in: [[0.0, 0.86, -0.08]], out: [[0.0, 0.86, 0.08]], ind: [0.09, 0.98, 0] } },
  ceiling_light: { kind: 'light', ins: 1, outs: 1, use: 5, grow: 3.4, growK: 0.85, ports: { in: [[0, 2.5, -0.09]], out: [[0, 2.5, 0.09]], ind: [0.09, 2.5, 0] } },
  floodlight: { kind: 'light', ins: 1, outs: 1, use: 10, grow: 7, growK: 1, ports: { in: [[0.1, 0.62, -0.06]], out: [[0.1, 0.62, 0.06]], ind: [0.13, 0.95, 0] } },
  auto_turret: { kind: 'turret', ins: 1, outs: 0, use: 10, ports: { in: [[-0.17, 0.3, 0.12]], out: [], ind: [0.12, 0.5, 0.12] } },
  electric_furnace: { kind: 'furnace', ins: 1, outs: 0, use: 25, rate: 5, ports: { in: [[-0.46, 0.35, 0.2]], out: [], ind: [0.46, 1.3, 0.3] } },
  door_controller: { kind: 'door', ins: 1, outs: 1, use: 2, reach: 2.8, ports: { in: [[0.0, 0.78, -0.09]], out: [[0.0, 0.78, 0.09]], ind: [0.1, 0.98, 0] } },
};
// a powered auto turret: longer reach and a steadier aim
export const TURRET_BOOST = { range: 1.4, spread: 0.5, rof: 1.15 };

// ---------------------------------------------------------------------------
// crops: grow = real seconds from seed to ripe in full light with water
// yield [item, min, max]; plots in a planter hold one plant each
// ---------------------------------------------------------------------------
export const CROPS = {
  hemp: { name: 'Hemp', seed: 'seed_hemp', grow: 330, yield: ['cloth', 10, 14] },
  berry: { name: 'Berry Bush', seed: 'seed_berry', grow: 380, yield: ['berries', 4, 7] },
  corn: { name: 'Corn', seed: 'seed_corn', grow: 440, yield: ['corn', 2, 4] },
  potato: { name: 'Potato', seed: 'seed_potato', grow: 400, yield: ['potato', 3, 5] },
  pumpkin: { name: 'Pumpkin', seed: 'seed_pumpkin', grow: 560, yield: ['pumpkin', 1, 2] },
};
export const CROP_IDS = ['hemp', 'berry', 'corn', 'potato', 'pumpkin'];
export const STAGES = ['Seed', 'Sprout', 'Young', 'Flowering', 'Ripe'];
/** growth (0..100) -> visible stage 0..4 */
export const stageOf = g => g >= 100 ? 4 : g >= 66 ? 3 : g >= 33 ? 2 : g >= 8 ? 1 : 0;
export const FARM = {
  waterUse: 0.12,     // water (0..100 per planter) each growing plant drinks per second
  bottle: 50,         // water from one water bottle
  barrelR: 4,         // a water barrel this close (m) waters the planter by itself
  rain: 0.5,          // water per second a planter in the open gets in heavy rain
  seedChance: 0.55,   // chance of a seed back when you harvest (and 20% more for a second one)
  wildSeed: 0.3,      // chance of a seed when you pick wild hemp or berries
};
// plot positions (model space) for each planter type
export const PLOTS = {
  planter_small: [[0, 0.42, 0]],
  planter: [[-1.0, 0.42, 0], [0, 0.42, 0], [1.0, 0.42, 0]],
};

// ---------------------------------------------------------------------------
// cooking pot recipes (ingredients come from your pockets; the pot must be lit)
// ---------------------------------------------------------------------------
export const COOK = [
  { id: 'pumpkin_soup', out: 'pumpkin_soup', n: 2, cost: { pumpkin: 1, water_bottle: 1 }, time: 10 },
  { id: 'berry_tea', out: 'berry_tea', n: 2, cost: { berries: 4, water_bottle: 1 }, time: 8 },
  { id: 'meat_stew', out: 'meat_stew', n: 2, cost: { raw_meat: 2, potato: 1, corn: 1 }, time: 14 },
  { id: 'wood_hash', out: 'wood_hash', n: 2, cost: { potato: 2, raw_meat: 1 }, time: 10 },
  { id: 'miner_pie', out: 'miner_pie', n: 2, cost: { pumpkin: 1, corn: 1, raw_meat: 1 }, time: 12 },
];
export const POT = { fuel: 'wood', burn: 5, queue: 6 }; // one wood every 5 s while lit

// food buffs: k = what it does, v = strength, t = seconds
export const BUFFS = {
  regen: { name: 'REGEN', cls: 'good', fmt: v => '+' + v + ' HP/s' },
  radres: { name: 'RAD SHIELD', cls: 'rad', fmt: v => Math.round(v * 100) + '%' },
  fed: { name: 'WELL FED', cls: 'good', fmt: v => '-' + Math.round(v * 100) + '% hunger' },
  wood: { name: 'WOODCUTTER', cls: 'buff', fmt: v => '+' + Math.round(v * 100) + '% wood' },
  ore: { name: 'MINER', cls: 'buff', fmt: v => '+' + Math.round(v * 100) + '% ore' },
};

// ---------------------------------------------------------------------------
// ITEMS
// ---------------------------------------------------------------------------
const SEED = c => 'Plant it in a planter. Needs water and light; ' + c + '.';
export const HOME_ITEMS = {
  wire_tool: { name: 'Wire Tool', cat: 'melee', col: '#d8402e', stack: 1, val: 6, desc: 'Hold it, then tap an electric item to run a cable from its output. Walk to another one and tap it to plug the cable into its input (cables reach 30 m). Tap the first one again to cancel. Tap an item whose outputs are all used to unplug cables.' },
  seed_hemp: { name: 'Hemp Seeds', cat: 'seed', col: '#8aa04a', stack: 50, val: 1, desc: SEED('grows hemp for cloth') },
  seed_berry: { name: 'Berry Seeds', cat: 'seed', col: '#c0304a', stack: 50, val: 1, desc: SEED('grows a berry bush') },
  seed_corn: { name: 'Corn Seeds', cat: 'seed', col: '#f0c838', stack: 50, val: 2, desc: SEED('grows corn') },
  seed_potato: { name: 'Seed Potatoes', cat: 'seed', col: '#b08a5a', stack: 50, val: 2, desc: SEED('grows potatoes') },
  seed_pumpkin: { name: 'Pumpkin Seeds', cat: 'seed', col: '#e8862a', stack: 50, val: 2, desc: SEED('grows pumpkins, slowly') },
  corn: { name: 'Corn', cat: 'food', col: '#f0c838', stack: 20, val: 2, use: { food: 9, water: 3, time: 1.0 }, cook: 'cooked_corn', desc: 'Eat it raw, roast it on a campfire, or cook it in a pot.' },
  potato: { name: 'Potato', cat: 'food', col: '#b08a5a', stack: 20, val: 2, use: { food: 6, time: 1.0 }, cook: 'baked_potato', desc: 'Much better baked on a campfire, or cooked in a pot.' },
  pumpkin: { name: 'Pumpkin', cat: 'food', col: '#e8862a', stack: 10, val: 4, use: { food: 14, water: 8, time: 1.4 }, desc: 'Make soup or pie with it in a cooking pot.' },
  cooked_corn: { name: 'Roasted Corn', cat: 'food', col: '#d8a028', stack: 20, val: 3, use: { food: 20, water: 4, hp: 4, time: 1.1 } },
  baked_potato: { name: 'Baked Potato', cat: 'food', col: '#a8703a', stack: 20, val: 3, use: { food: 26, hp: 6, time: 1.2 } },
  pumpkin_soup: { name: 'Pumpkin Soup', cat: 'food', col: '#e07a20', stack: 10, val: 9, use: { food: 30, water: 22, hp: 10, time: 1.6, buff: { k: 'regen', v: 0.8, t: 150 } }, desc: 'Heals 0.8 HP a second for 2½ minutes.' },
  berry_tea: { name: 'Berry Tea', cat: 'drink', col: '#a83a5a', stack: 10, val: 7, use: { water: 32, food: 3, time: 1.2, buff: { k: 'radres', v: 0.4, t: 240 } }, desc: 'Blocks 40% of radiation for 4 minutes.' },
  meat_stew: { name: 'Meat Stew', cat: 'food', col: '#8a4a2a', stack: 10, val: 11, use: { food: 50, water: 10, hp: 15, time: 1.8, buff: { k: 'fed', v: 0.5, t: 360 } }, desc: 'Hunger and thirst drain half as fast for 6 minutes.' },
  wood_hash: { name: 'Woodcutter\'s Hash', cat: 'food', col: '#b0803a', stack: 10, val: 9, use: { food: 32, hp: 6, time: 1.5, buff: { k: 'wood', v: 0.35, t: 300 } }, desc: '35% more wood from trees for 5 minutes.' },
  miner_pie: { name: 'Miner\'s Pie', cat: 'food', col: '#c89048', stack: 10, val: 9, use: { food: 34, hp: 8, time: 1.5, buff: { k: 'ore', v: 0.35, t: 300 } }, desc: '35% more stone and ore from rocks for 5 minutes.' },
};
export const SEED_IDS = ['seed_hemp', 'seed_berry', 'seed_corn', 'seed_potato', 'seed_pumpkin'];

// ---------------------------------------------------------------------------
// DEPLOYABLES (glyph = a build-bar icon from the UI icon set; glyphRows = our own 16 px glyph)
// litState: its light follows d.state.lit (powered lights, the cooking pot)
// ---------------------------------------------------------------------------
export const HOME_DEPLOY = {
  generator: { name: 'Fuel Generator', cost: { metal: 150, gears: 2, pipe: 1 }, hp: 400, wb: 1, slots: 6, elec: true, desc: 'Burns low grade fuel to make 40 W (one fuel every 30 s at full load). Wire its output to lights, a battery and more.' },
  solar_panel: { name: 'Solar Panel', cost: { metal: 120, circuit: 1 }, hp: 200, wb: 1, elec: true, desc: 'Up to 20 W in full sun, less in rain, nothing at night or under a roof. Put it on your roof.' },
  wind_turbine: { name: 'Wind Turbine', cost: { metal: 250, gears: 3, circuit: 1 }, hp: 400, wb: 2, elec: true, desc: 'Up to 60 W in a strong wind. The higher it stands (hilltops, rooftops), the more it makes.' },
  battery: { name: 'Battery', cost: { metal: 80, scrap: 40, circuit: 1 }, hp: 300, wb: 1, elec: true, desc: 'Stores power from its input and feeds up to 50 W out when the input runs short (at night, or when the fuel runs out).' },
  switch: { name: 'Switch', cost: { metal: 15 }, hp: 100, wb: 0, elec: true, desc: 'Tap it to turn the power on or off for everything after it. Uses 1 W.' },
  splitter: { name: 'Splitter', cost: { metal: 15 }, hp: 100, wb: 0, elec: true, desc: 'One input, three outputs: power goes to whatever needs it.' },
  timer: { name: 'Day/Night Timer', cost: { metal: 25, gears: 1 }, hp: 100, wb: 1, elec: true, desc: 'Passes power only at night (or only by day). Saves your battery. Uses 1 W.' },
  motion_sensor: { name: 'Motion Sensor', cost: { metal: 30, circuit: 1 }, hp: 100, wb: 1, elec: true, desc: 'Passes power while something moves within 9 m: wire lights or a door controller after it. Uses 1 W.' },
  ceiling_light: { name: 'Ceiling Light', cost: { metal: 25, cloth: 5 }, hp: 80, wb: 0, elec: true, litState: true, light: 6.5, lightCol: '#ffd9a0', lightK: 3.6, lightY: 2.05, desc: 'Needs 5 W. Hangs from the floor above (outdoors it stands on a pole). Crops under it grow at night and indoors. Passes the rest of the power on.' },
  electric_furnace: { name: 'Electric Furnace', cost: { metal: 200, gears: 2, circuit: 1 }, hp: 500, wb: 2, slots: 6, elec: true, desc: 'Needs 25 W. Smelts ore faster than a furnace and burns no wood.' },
  door_controller: { name: 'Door Controller', cost: { metal: 40, gears: 1 }, hp: 150, wb: 1, elec: true, desc: 'Put it next to one of your doors or gates: power opens the door and holds it open, losing power shuts it. Uses 2 W.' },
  planter_small: { name: 'Small Planter', cost: { wood: 50, cloth: 5 }, hp: 120, wb: 0, desc: 'Grows one crop from seed. Needs water (a water bottle, a water barrel next to it, or rain) and light (sun, or a powered light).' },
  cook_pot: { name: 'Cooking Pot', cost: { metal: 40, wood: 60 }, hp: 150, wb: 0, slots: 8, litState: true, light: 4, lightCol: '#ffa050', lightK: 1.6, lightY: 0.5, desc: 'A pot over a fire. Cooks soups, stews, teas and pies that give buffs. Burns wood.' },
};
export const HOME_ORDER = ['planter_small', 'cook_pot', 'generator', 'solar_panel', 'wind_turbine', 'battery', 'switch', 'splitter', 'timer', 'motion_sensor', 'ceiling_light', 'electric_furnace', 'door_controller'];
// build-bar glyphs (h = white, s = light, m = mid grey)
const GL = {
  generator: ['..hhhhhhhh..', '..hssssssh..', 'hhhhhhhhhhhh', 'hsmmmmmmmmsh', 'hsmhhmmmmhsh', 'hsmhhmmmhhsh', 'hsmmmmmmmmsh', 'hsmmmmmmmmsh', 'hhhhhhhhhhhh', '.hs......hs.'],
  solar_panel: ['hhhhhhhhhhhh', 'hmmhmmhmmhmh', 'hmmhmmhmmhmh', 'hhhhhhhhhhhh', 'hmmhmmhmmhmh', 'hmmhmmhmmhmh', 'hhhhhhhhhhhh', '.....hs.....', '.....hs.....', '...hhhhhh...'],
  wind_turbine: ['hh..........', '.hhs........', '..hhs.......', '...hhhhhhhhh', '...hhs......', '..hh.hs.....', '.hh..hs.....', 'hh...hs.....', '.....hs.....', '.....hs.....', '.....hs.....', '...hhhhhh...'],
  battery: ['..hh....hh..', '..hs....hs..', 'hhhhhhhhhhhh', 'hsssssssssmh', 'hs.h.....smh', 'hshhh.hhhsmh', 'hs.h.....smh', 'hsssssssssmh', 'hmmmmmmmmmmh', 'hhhhhhhhhhhh'],
  switch: ['.......hh...', '......hs....', '.....hs.....', '..hhhhhhhh..', '..hsmmmmsh..', '..hsmhhmsh..', '..hsmmmmsh..', '..hhhhhhhh..', '.....hs.....', '.....hs.....', '.....hs.....', '...hhhhhh...'],
  splitter: ['hh...hh...hh', 'hs...hs...hs', '.hs..hs..hs.', '..hs.hs.hs..', '...hhhhhh...', '...hsmmsh...', '...hhhhhh...', '.....hs.....', '.....hs.....', '.....hs.....'],
  timer: ['...hhhhhh...', '..hs....sh..', '.hs..hs..sh.', 'hs...hs...sh', 'hs...hhhh.sh', 'hs........sh', '.hs......sh.', '..hs....sh..', '...hhhhhh...'],
  motion_sensor: ['h..........h', '.h..hhhh..h.', '...hsssmh...', '..hssmmmsh..', '..hhhhhhhh..', '.....hs.....', '.....hs.....', '.....hs.....', '...hhhhhh...'],
  door_controller: ['hhhhhh......', 'hsssmh......', 'hs..mh.hh...', 'hs..mhhssh..', 'hs..mh.hh...', 'hs..mh......', 'hs.hmh......', 'hs..mh......', 'hs..mh......', 'hhhhhh......'],
};
for (const k in GL) HOME_DEPLOY[k].glyphRows = GL[k];
HOME_DEPLOY.ceiling_light.glyph = 'light'; HOME_DEPLOY.electric_furnace.glyph = 'smelt'; HOME_DEPLOY.planter_small.glyph = 'planter'; HOME_DEPLOY.cook_pot.glyph = 'cook';

// ---------------------------------------------------------------------------
// RECIPES (wb = workbench tier)
// ---------------------------------------------------------------------------
export const HOME_RECIPES = [
  { id: 'wire_tool', out: 'wire_tool', n: 1, cost: { metal: 20, cloth: 10 }, wb: 0 },
  { id: 'seed_hemp', out: 'seed_hemp', n: 2, cost: { cloth: 20 }, wb: 0, desc: 'Pick hemp seeds out of raw cloth.' },
];
// [table, id, weight, min, max]
const HOME_LOOT = [
  ['food', 'seed_corn', 2.2, 1, 3], ['food', 'seed_potato', 2.2, 1, 3], ['food', 'seed_pumpkin', 1.4, 1, 2], ['food', 'seed_hemp', 1.5, 1, 3], ['food', 'seed_berry', 1.5, 1, 3],
  ['food', 'corn', 1.2, 1, 3], ['food', 'potato', 1.2, 1, 3], ['food', 'pumpkin_soup', 0.4, 1, 1],
  ['crate', 'seed_corn', 0.8, 1, 2], ['crate', 'seed_potato', 0.8, 1, 2], ['crate', 'seed_pumpkin', 0.5, 1, 1], ['crate', 'wire_tool', 0.4, 1, 1],
  ['toolbox', 'wire_tool', 1.2, 1, 1],
  ['barrel', 'seed_hemp', 0.6, 1, 2],
  ['human1', 'seed_potato', 0.6, 1, 2], ['human1', 'seed_corn', 0.6, 1, 2],
  ['airdrop', 'meat_stew', 1.2, 1, 2],
];
// [shop, id, n, price]
const HOME_SHOP = [
  ['general', 'seed_hemp', 3, 6], ['general', 'seed_berry', 2, 6], ['general', 'seed_corn', 2, 8], ['general', 'seed_potato', 2, 8], ['general', 'seed_pumpkin', 1, 10],
  ['tech', 'wire_tool', 1, 15],
];
const HOME_RECYCLE = { wire_tool: { metal: 8, cloth: 3 } };

/** Adds the homestead items, deployables, recipes, loot, vendor stock and campfire cooking to the game's data. Safe to call twice. */
export function registerHomesteadData({ ITEMS, RECIPES, RECIPE, LOOT, DEPLOY, DEPLOY_ORDER, OVENS, SHOPS, RECYCLE } = {}) {
  const out = { items: 0, deploys: 0, recipes: 0, loot: 0 };
  if (ITEMS) for (const id in HOME_ITEMS) if (!ITEMS[id]) { const it = HOME_ITEMS[id]; ITEMS[id] = Object.assign({}, it, it.use ? { use: Object.assign({}, it.use) } : null); out.items++; }
  if (DEPLOY) {
    for (const id in HOME_DEPLOY) if (!DEPLOY[id]) { DEPLOY[id] = Object.assign({}, HOME_DEPLOY[id]); out.deploys++; }
    // the old planter box joins the farming system: three plots instead of free hemp and berries every dawn
    const P = DEPLOY.planter; if (P && P.prod) { delete P.prod; P.name = 'Large Planter'; P.glyph = 'planter'; P.desc = 'Grows three crops from seed. Needs water (a water bottle, a water barrel next to it, or rain) and light (sun, or a powered light).'; }
    // existing lights and turrets plug into the grid
    const F = DEPLOY.floodlight; if (F && !F.elec) { F.elec = true; F.litState = true; F.desc = 'Needs 10 W of power. A bright light that also lets crops grow at night. Passes the rest of the power on.'; }
    const T = DEPLOY.auto_turret; if (T && !T.elec) { T.elec = true; T.desc = 'Uses pistol rounds from your Tool Cupboard. Wire 10 W of power to it for 40% more range and a steadier aim.'; }
  }
  if (DEPLOY_ORDER) for (const id of HOME_ORDER) if (!DEPLOY_ORDER.includes(id)) DEPLOY_ORDER.push(id);
  for (const r of HOME_RECIPES) {
    let rec = (RECIPES && RECIPES.find(q => q.id === r.id)) || (RECIPE && RECIPE[r.id]) || null;
    if (!rec) rec = Object.assign({}, r, { cost: Object.assign({}, r.cost) });
    if (RECIPES && !RECIPES.includes(rec)) {
      let at = -1; for (let i = 0; i < RECIPES.length; i++) if ((RECIPES[i].wb || 0) === r.wb) at = i; // after the last recipe of the same tier
      if (at < 0) RECIPES.push(rec); else RECIPES.splice(at + 1, 0, rec);
      out.recipes++;
    }
    if (RECIPE && !RECIPE[r.id]) RECIPE[r.id] = rec;
  }
  if (LOOT) for (const [t, id, w, a, b] of HOME_LOOT) { const T = LOOT[t]; if (T && T.items && !T.items.some(e => e[0] === id)) { T.items.push([id, w, a, b]); out.loot++; } }
  if (OVENS && OVENS.campfire && OVENS.campfire.cooks) { const c = OVENS.campfire.cooks; if (!c.corn) c.corn = 'cooked_corn'; if (!c.potato) c.potato = 'baked_potato'; }
  if (SHOPS) for (const [s, id, n, price] of HOME_SHOP) { const S = SHOPS[s]; if (S && S.stock && !S.stock.some(e => e[0] === id)) S.stock.push([id, n, price]); }
  if (RECYCLE) for (const id in HOME_RECYCLE) if (!RECYCLE[id]) RECYCLE[id] = Object.assign({}, HOME_RECYCLE[id]);
  return out;
}

// ============================================================================
// ICONS — 16x16 pixel art in the style of js/art_icons.js (light from the
// top-left, 1 px dark outline), drawn procedurally per item.
// ============================================================================
const OUT = '#181425';
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
function mix(a, b, t) { const A = hexRgb(a), B = hexRgb(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); }
const lite = (c, k = 0.35) => mix(c, '#ffffff', k), dark = (c, k = 0.35) => mix(c, '#000000', k);
function canvas16() { const c = document.createElement('canvas'); c.width = c.height = 16; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; return [c, g]; }
function outline(c) {
  const g = c.getContext('2d'), d = g.getImageData(0, 0, 16, 16).data;
  const a = (x, y) => x >= 0 && y >= 0 && x < 16 && y < 16 && d[(y * 16 + x) * 4 + 3] > 0;
  g.fillStyle = OUT;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (!a(x, y) && (a(x - 1, y) || a(x + 1, y) || a(x, y - 1) || a(x, y + 1))) g.fillRect(x, y, 1, 1);
  return c;
}
function painter(g) {
  const px = (x, y, c) => { if (x < 0 || y < 0 || x > 15 || y > 15) return; g.fillStyle = c; g.fillRect(x, y, 1, 1); };
  const ell = (cx, cy, rx, ry, fn) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const u = (x + 0.5 - cx) / rx, v = (y + 0.5 - cy) / ry; if (u * u + v * v <= 1) fn(x, y, u, v); } };
  const rect = (x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) px(x, y, typeof c === 'function' ? c(x, y) : c); };
  return { px, ell, rect };
}
// shaded round body: light top-left, dark bottom-right
const shadeRound = (base, u, v) => { const k = u * 0.55 + v * 0.75; return k < -0.55 ? lite(base, 0.4) : k < -0.1 ? lite(base, 0.15) : k < 0.45 ? base : dark(base, 0.28); };
function drawCob(P, roast) {
  const kA = roast ? '#d8a028' : '#f6d040', kB = roast ? '#b07a1c' : '#e0b028';
  P.ell(8, 7.5, 3.1, 6.6, (x, y, u, v) => P.px(x, y, shadeRound((x + y) % 2 ? kA : kB, u, v)));
  if (roast) for (const [x, y] of [[7, 4], [9, 7], [7, 9], [8, 11], [9, 3]]) P.px(x, y, '#5a3210');
  if (!roast) { // husk leaves and stalk
    const H = '#6a9a34', h = '#4a7a24';
    for (let y = 7; y <= 14; y++) { const w = (y - 6) * 0.45; P.px(Math.round(4.6 - w * 0.6), y, H); P.px(Math.round(4.6 - w * 0.6) + 1, y, h); P.px(Math.round(11.4 + w * 0.6), y, H); P.px(Math.round(11.4 + w * 0.6) - 1, y, h); }
    for (let y = 13; y <= 15; y++) P.px(8, y, '#7a8a3a');
  } else { for (let y = 13; y <= 15; y++) P.px(8, y, '#8a6a3a'); }
}
function drawPotato(P, baked) {
  const B = baked ? '#a8703a' : '#b08a5a';
  P.ell(8, 9, 6.4, 4.6, (x, y, u, v) => P.px(x, y, shadeRound(B, u, v)));
  if (!baked) for (const [x, y] of [[5, 8], [9, 7], [11, 10], [7, 11]]) P.px(x, y, dark(B, 0.45));
  else { P.ell(8, 8, 3.6, 1.6, (x, y) => P.px(x, y, '#f4ecd0')); P.px(8, 7, '#ffe060'); P.px(9, 8, '#ffe060'); P.px(7, 8, '#f8d850'); for (const [x, y] of [[4, 10], [12, 9]]) P.px(x, y, '#5a3210'); }
}
function drawPumpkin(P) {
  const O = '#e8862a';
  for (const [cx, rx] of [[4.6, 3.2], [11.4, 3.2], [8, 3.6]]) P.ell(cx, 10, rx, 4.6, (x, y, u, v) => P.px(x, y, shadeRound(cx === 8 ? O : dark(O, 0.08), u * 0.5 + (cx - 8) / 8, v)));
  for (let y = 7; y <= 13; y++) { P.px(6, y, dark(O, 0.25)); P.px(10, y, dark(O, 0.25)); }
  P.rect(7, 3, 8, 5, '#5a7a2a'); P.px(9, 3, '#4a6a22'); P.px(10, 2, '#6a9a34'); P.px(11, 2, '#6a9a34');
}
function drawSeeds(P, col) {
  const paper = '#e8dcc0';
  P.rect(3, 1, 12, 14, (x, y) => (x === 3 ? lite(paper, 0.3) : x === 12 ? dark(paper, 0.18) : paper));
  P.rect(3, 1, 12, 2, dark(paper, 0.12)); for (let x = 3; x <= 12; x += 2) P.px(x, 1, dark(paper, 0.3));
  P.rect(4, 5, 11, 11, (x, y) => (y === 5 ? lite(col, 0.25) : y === 11 ? dark(col, 0.25) : col));
  for (const [x, y] of [[6, 7], [8, 8], [10, 7], [7, 9], [9, 10]]) P.px(x, y, '#3a2a18');
  P.rect(5, 12, 10, 12, '#9a8a70'); P.rect(5, 3, 8, 3, '#9a8a70');
}
function drawBowl(P, soup, steam = true) {
  const B = '#9a6a40';
  P.ell(8, 9, 6.6, 1.6, (x, y) => P.px(x, y, soup));
  P.ell(8, 9.4, 6.8, 5.2, (x, y, u, v) => { if (v > 0.12) P.px(x, y, shadeRound(B, u, v)); });
  P.rect(5, 15, 10, 15, dark(B, 0.3));
  P.px(4, 9, lite(soup, 0.3)); P.px(6, 9, lite(soup, 0.4));
  if (steam) for (const [x, y] of [[6, 5], [7, 4], [6, 3], [10, 5], [9, 4], [10, 2]]) P.px(x, y, 'rgba(240,240,240,0.85)');
}
function drawMug(P, tea) {
  const C = '#e8e4dc';
  P.rect(3, 6, 10, 14, (x, y) => (x === 3 ? lite(C, 0.4) : x >= 9 ? dark(C, 0.18) : C));
  P.rect(4, 6, 9, 7, tea); P.px(4, 6, lite(tea, 0.35));
  for (const [x, y] of [[11, 8], [12, 8], [13, 9], [13, 10], [13, 11], [12, 12], [11, 12]]) P.px(x, y, dark(C, 0.12));
  P.rect(4, 10, 9, 11, '#c0304a'); P.px(6, 10, '#e05a6a');
  for (const [x, y] of [[5, 4], [6, 3], [5, 2], [8, 4], [9, 3], [8, 1]]) P.px(x, y, 'rgba(240,240,240,0.85)');
}
function drawPlate(P, food, bits) {
  P.ell(8, 12, 7.2, 2.6, (x, y, u, v) => P.px(x, y, v < -0.2 ? '#f4f0e8' : v < 0.4 ? '#d8d4cc' : '#a8a49c'));
  P.ell(8, 9.5, 5, 3.6, (x, y, u, v) => { if (v < 0.75) P.px(x, y, shadeRound(food, u, v)); });
  for (const [x, y, c] of bits) P.px(x, y, c);
}
function drawPie(P) {
  const crust = '#d8a050', fill = '#c86a2a';
  P.rect(2, 11, 13, 13, (x, y) => (y === 13 ? dark(crust, 0.3) : crust));
  P.rect(3, 14, 12, 14, dark(crust, 0.45));
  P.ell(8, 10, 6.8, 3, (x, y, u, v) => P.px(x, y, (x + y) % 3 === 0 ? lite(crust, 0.2) : fill));
  for (let x = 3; x <= 13; x += 3) for (let y = 8; y <= 11; y++) P.px(x, y, lite(crust, 0.15));
  for (const [x, y] of [[6, 5], [7, 4], [10, 5], [9, 3]]) P.px(x, y, 'rgba(240,240,240,0.85)');
}
function drawWireTool(P) {
  // coil of black cable with a red plug, and steel cutters on top
  P.ell(8, 9, 6.2, 5.2, (x, y, u, v) => { const r = Math.hypot(u, v); if (r > 0.42) P.px(x, y, ((x + y) % 3 === 0) ? '#3a3a44' : r > 0.8 ? '#1c1c22' : '#2a2a32'); });
  for (const [x, y] of [[12, 13], [13, 13], [14, 14], [14, 15], [13, 14]]) P.px(x, y, '#2a2a32');
  P.rect(11, 12, 12, 13, '#d8402e'); P.px(11, 12, '#f07a5a'); P.px(13, 12, '#c8ccd2'); P.px(13, 11, '#c8ccd2');
  // cutters: two red handles meeting at steel jaws (top-left)
  for (let i = 0; i < 5; i++) { P.px(3 + i, 7 - i, '#d8402e'); P.px(4 + i, 8 - i, '#a82a20'); }
  for (let i = 0; i < 5; i++) { P.px(1 + i, 5 - i + 4, '#d8402e'); }
  P.px(8, 2, '#c8ccd2'); P.px(9, 1, '#e8ecf0'); P.px(8, 1, '#a8adb2'); P.px(9, 2, '#a8adb2');
}
const ICON = {
  corn: P => drawCob(P, false), cooked_corn: P => drawCob(P, true),
  potato: P => drawPotato(P, false), baked_potato: P => drawPotato(P, true),
  pumpkin: P => drawPumpkin(P),
  pumpkin_soup: P => drawBowl(P, '#e07a20'), meat_stew: P => drawBowl(P, '#8a4a2a'),
  berry_tea: P => drawMug(P, '#a83a5a'),
  wood_hash: P => drawPlate(P, '#b0803a', [[6, 8, '#e8c040'], [9, 9, '#7a4a2a'], [10, 7, '#e8c040'], [7, 10, '#7a4a2a']]),
  miner_pie: P => drawPie(P),
  wire_tool: P => drawWireTool(P),
};
for (const id of SEED_IDS) ICON[id] = P => drawSeeds(P, HOME_ITEMS[id].col);
const iconCache = {};
export function homeIcon(id) {
  if (iconCache[id]) return iconCache[id];
  const f = ICON[id]; if (!f) return null;
  const [c, g] = canvas16(); f(painter(g));
  return (iconCache[id] = outline(c));
}
/** Optional: route ART.icon / ART.iconURL for the homestead ids to the icons above. Returns true if installed. */
export function registerHomesteadIcons(A) {
  A = A || (typeof window !== 'undefined' ? window.ART : null);
  if (!A || !A.iconURL || A._homestead) return false;
  const baseURL = A.iconURL, baseIcon = A.icon, urls = {};
  A.icon = id => (ICON[id] && homeIcon(id)) || (baseIcon ? baseIcon(id) : null);
  A.iconURL = id => {
    if (!ICON[id]) return baseURL(id);
    if (!urls[id]) { try { const c = homeIcon(id); urls[id] = c ? c.toDataURL() : baseURL(id); } catch (e) { urls[id] = baseURL(id); } }
    return urls[id];
  };
  A._homestead = true;
  return true;
}
