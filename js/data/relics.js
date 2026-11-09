// Relics: run-long artifacts found in events, ruins, shrines and the merchant.
// `mods` are added to s.mods at region start (lightMult multiplies, every other
// key adds). `start` is a one-shot bonus granted at each region start.
// `hooks` are optional, deterministic callbacks: onDawn(s, ctx) and
// onHearthFall(s, ctx), where ctx = { relic: run.relics entry, emit(text) }.
// onHearthFall returns true to stop the Hearth's destruction.

import { DEFAULT_MODS } from './balance.js';
import { BEACONS } from './beacons.js';

export const RARITIES = {
  common:    { label: 'Common',    color: '#c9c2b4' },
  rare:      { label: 'Rare',      color: '#5aa9e6' },
  legendary: { label: 'Legendary', color: '#f0a030' },
  cursed:    { label: 'Cursed',    color: '#a46ad0' },
};

export const RELICS = {
  // Common
  whetstone: {
    id: 'whetstone', name: 'Soldier’s Whetstone', rarity: 'common', icon: 'sword', tags: ['war'],
    text: 'Soldiers deal 10% more damage.',
    mods: { soldierDmg: 0.1 },
  },
  fletching: {
    id: 'fletching', name: 'Grey Goose Fletching', rarity: 'common', icon: 'tower', tags: ['war'],
    text: 'All arrows deal 12% more damage.',
    mods: { rangedDmg: 0.12 },
  },
  ploughcharm: {
    id: 'ploughcharm', name: 'Ploughwright’s Charm', rarity: 'common', icon: 'hoe', tags: ['harvest'],
    text: 'Farms grow 15% more food.',
    mods: { farmYield: 0.15 },
  },
  woodtoken: {
    id: 'woodtoken', name: 'Woodsman’s Token', rarity: 'common', icon: 'axe', tags: ['harvest'],
    text: 'Woodcutters and masons gather 15% faster.',
    mods: { chopSpeed: 0.15 },
  },
  plumbline: {
    id: 'plumbline', name: 'Mason’s Plumb', rarity: 'common', icon: 'wall', tags: ['ward'],
    text: 'Walls and Gates have 20% more health.',
    mods: { wallHp: 0.2 },
  },
  pack: {
    id: 'pack', name: 'Traveller’s Pack', rarity: 'common', icon: 'wood', tags: ['harvest'],
    text: 'Start each region with +40 food and +40 wood.',
    start: { food: 40, wood: 40 },
  },
  coalbox: {
    id: 'coalbox', name: 'Everburning Coal', rarity: 'common', icon: 'brazier', tags: ['fire', 'light'],
    text: 'Braziers light +1 tile farther.',
    mods: { lightRadius: 1 },
  },
  harvestidol: {
    id: 'harvestidol', name: 'Harvest Idol', rarity: 'common', icon: 'food', tags: ['harvest'],
    text: 'Gain 20 food every dawn.',
    hooks: {
      onDawn(s) { s.res.food += 20; },
    },
  },

  // Rare
  miserspurse: {
    id: 'miserspurse', name: 'Miser’s Purse', rarity: 'rare', icon: 'gold', tags: ['coin'],
    text: 'Each dawn, earn 10% interest on banked gold (up to 30).',
    mods: { interest: 0.1 },
  },
  manyhands: {
    id: 'manyhands', name: 'Ring of Many Hands', rarity: 'rare', icon: 'pop', tags: ['harvest'],
    text: 'Each House holds 1 more villager.',
    mods: { popPerHouse: 1 },
  },
  emberheart: {
    id: 'emberheart', name: 'Ember Heart', rarity: 'rare', icon: 'nova', tags: ['fire'],
    text: 'Heartflame Nova deals 30% more damage and recharges 5 s faster.',
    mods: { novaDmg: 0.3, novaCd: 5 },
  },
  hawkeye: {
    id: 'hawkeye', name: 'Hawkeye Lens', rarity: 'rare', icon: 'eye', tags: ['war'],
    text: 'Watchtowers +1 range. Towers deal 10% more damage.',
    mods: { towerRange: 1, towerDmg: 0.1 },
  },
  heraldhorn: {
    id: 'heraldhorn', name: 'Herald’s Horn', rarity: 'rare', icon: 'banner', tags: ['war'],
    text: 'Royal Banner lasts 4 s longer and recharges 8 s faster.',
    mods: { bannerDur: 4, bannerCd: 8 },
  },

  // Legendary
  phoenix: {
    id: 'phoenix', name: 'Phoenix Feather', rarity: 'legendary', icon: 'flame', tags: ['fire'],
    text: 'Once per run, the Hearth rises from destruction at half health.',
    hooks: {
      onHearthFall(s, ctx) {
        const h = s.rt && s.rt.hearth;
        if (!h || ctx.relic.used) return false;
        ctx.relic.used = true;
        h.hp = Math.ceil(h.maxHp / 2);
        ctx.emit('The Phoenix Feather burns away. The Hearth rises again!');
        return true;
      },
    },
  },
  firstlantern: {
    id: 'firstlantern', name: 'Lantern of the First King', rarity: 'legendary', icon: 'sun', tags: ['light'],
    text: 'Brazier and Hearth light reach 50% farther.',
    mods: { lightMult: 1.5 },
  },
  oathblade: {
    id: 'oathblade', name: 'Oathblade of Dawnhold', rarity: 'legendary', icon: 'crown', tags: ['war'],
    text: 'The Sovereign deals 50% more damage. Soldiers deal 15% more damage.',
    mods: { sovDmg: 0.5, soldierDmg: 0.15 },
  },

  // Cursed: a real upside paired with a real downside.
  cursedcrown: {
    id: 'cursedcrown', name: 'Cursed Crown', rarity: 'cursed', icon: 'crown', tags: ['coin', 'curse'],
    text: 'House taxes and Market income +50%, but Hollow have 12% more health.',
    mods: { goldMult: 0.5, enemyHp: 0.12 },
  },
  bloodchalice: {
    id: 'bloodchalice', name: 'Blood Moon Chalice', rarity: 'cursed', icon: 'moon', tags: ['coin', 'curse'],
    text: 'Region gold and Ember rewards +40%, but waves are 20% larger.',
    mods: { lootMult: 0.4, waveMult: 0.2 },
  },
  graveidol: {
    id: 'graveidol', name: 'Gravewood Idol', rarity: 'cursed', icon: 'skull', tags: ['curse'],
    text: 'Builders work 30% faster, but Hollow move 12% faster.',
    mods: { buildSpeed: 0.3, enemySpeed: 0.12 },
  },
};

// Set bonuses: active while the run owns >= count relics carrying `tag`.
export const RELIC_SETS = [
  {
    id: 'pyre', name: 'The Pyre', tag: 'fire', count: 3,
    text: 'Hearth bolts +5 damage, Nova +25% damage, Braziers light +1 tile.',
    mods: { hearthDmg: 5, novaDmg: 0.25, lightRadius: 1 },
  },
];

// Ids of every relic of one rarity, in definition order (callers shuffle with a run RNG).
export function relicPool(rarity) {
  return Object.keys(RELICS).filter((id) => RELICS[id].rarity === rarity);
}

// Icon names present in js/ui/icons.js (its path map is private, so copied here).
const ICON_NAMES = ['food', 'wood', 'stone', 'gold', 'pop', 'sword', 'sun', 'moon', 'pause', 'play',
  'fast', 'nightskip', 'menu', 'sound', 'mute', 'map', 'nova', 'banner', 'check', 'x', 'info', 'hammer',
  'trash', 'up', 'crown', 'flame', 'tower', 'farm', 'house', 'skull', 'shield', 'gear', 'plus', 'minus',
  'beacon', 'book', 'axe', 'pick', 'hoe', 'wall', 'gate', 'brazier', 'barracks', 'lumber', 'quarry',
  'export', 'import', 'dice', 'share', 'eye'];
const START_KEYS = ['food', 'wood', 'stone', 'gold', 'villagers'];
const HOOK_NAMES = ['onDawn', 'onHearthFall'];

// Throws a descriptive Error on the first invalid entry; returns true otherwise.
export function validateContent() {
  const fail = (where, msg) => { throw new Error(`Content error in ${where}: ${msg}`); };
  const checkCommon = (where, key, e) => {
    if (e.id !== key) fail(where, `id "${e.id}" does not match key "${key}"`);
    if (!e.name || typeof e.name !== 'string') fail(where, 'missing name');
    if (!ICON_NAMES.includes(e.icon)) fail(where, `unknown icon "${e.icon}"`);
    if (!e.text || e.text.length > 90) fail(where, `text missing or longer than 90 chars`);
    checkMods(where, e.mods);
    if (e.start != null) {
      for (const [k, v] of Object.entries(e.start)) {
        if (!START_KEYS.includes(k)) fail(where, `unknown start key "${k}"`);
        if (typeof v !== 'number' || !Number.isFinite(v)) fail(where, `start.${k} is not a number`);
      }
    }
  };
  const checkMods = (where, mods) => {
    if (mods == null) return;
    for (const [k, v] of Object.entries(mods)) {
      if (!(k in DEFAULT_MODS)) fail(where, `unknown mods key "${k}" (not in DEFAULT_MODS)`);
      if (typeof v !== 'number' || !Number.isFinite(v)) fail(where, `mods.${k} is not a number`);
    }
  };

  for (const [key, r] of Object.entries(RELICS)) {
    const where = `RELICS.${key}`;
    checkCommon(where, key, r);
    if (!RARITIES[r.rarity]) fail(where, `invalid rarity "${r.rarity}"`);
    if (!Array.isArray(r.tags)) fail(where, 'tags must be an array');
    if (r.hooks != null) {
      for (const [h, fn] of Object.entries(r.hooks)) {
        if (!HOOK_NAMES.includes(h)) fail(where, `unknown hook "${h}"`);
        if (typeof fn !== 'function') fail(where, `hook ${h} is not a function`);
      }
    }
  }
  for (const set of RELIC_SETS) {
    const where = `RELIC_SETS.${set.id}`;
    if (!set.id || !set.name || !set.text) fail(where, 'missing id, name or text');
    if (!(set.count > 0)) fail(where, 'count must be positive');
    checkMods(where, set.mods);
    const owners = Object.values(RELICS).filter((r) => r.tags.includes(set.tag)).length;
    if (owners < set.count) fail(where, `only ${owners} relics carry tag "${set.tag}", need ${set.count}`);
  }
  for (const [key, b] of Object.entries(BEACONS)) {
    const where = `BEACONS.${key}`;
    checkCommon(where, key, b);
    if (b.stackable != null && typeof b.stackable !== 'boolean') fail(where, 'stackable must be boolean');
  }
  return true;
}
