// Dawn Cards (rework, stream H2): the one reward pick of every dawn. Pure data; the effects
// live in js/game/systems/dawncards.js, driven by the numbers here (player text is built from
// the same numbers, so it cannot drift).
//
// A dawn offers 3 cards (plus mods.draftExtra) drawn from four kinds:
//   blueprint  learn a building for the rest of the run
//   upgrade    a run-long change to how the night plays (ranked: take it again to raise it)
//   hero       a perk for a hero who earned one, or a recruit (cap 2): js/game/systems/heroes.js
//   supplies   the small fallback (resources, a repair, a rest), at most ~15% of the draw weight
// Every option must pass hasEffect() for the realm as it stands, so a heal at full health or a
// repair with nothing damaged is never offered.

/** Draw weight of each kind (per dawn slot). Supplies stay near 15% of the total. */
export const CARD_WEIGHTS = { upgrade: 5, blueprint: 3, hero: 2, heroFirst: 4, supplies: 1.6 };

/**
 * Night-changing upgrades. Fields:
 *   max    ranks (the card may be taken this many times in a run)
 *   needs  { bp: building type the realm must know (or own) } | { sov: true } | { barracks: true }
 *   mods   added to the region's modifiers per rank (DEFAULT_MODS keys)
 *   v      the effect's numbers per rank (index rank-1), read by the dawn card system
 *   text   (rank) -> what the card does at that rank (rank >= 1)
 */
export const UPGRADES = {
  chain: {
    id: 'chain', name: 'Chain Shot', icon: 'tower', max: 2, needs: { bp: 'tower' },
    v: [{ dmg: 6, range: 2.5 }, { dmg: 10, range: 3 }],
    text: (r) => `Watchtower and Ballista arrows leap to a second foe within ${UPGRADES.chain.v[r - 1].range} tiles for ${UPGRADES.chain.v[r - 1].dmg} damage.`,
  },
  cleave: {
    id: 'cleave', name: 'Royal Cleave', icon: 'crown', max: 2, needs: { sov: true },
    v: [{ dmg: 8, range: 1.3 }, { dmg: 13, range: 1.6 }],
    text: (r) => `The Sovereign's blows also strike every foe within ${UPGRADES.cleave.v[r - 1].range} tiles of the target for ${UPGRADES.cleave.v[r - 1].dmg} damage.`,
  },
  pyre: {
    id: 'pyre', name: 'Pyre Nova', icon: 'nova', max: 2, needs: { sov: true },
    v: [{ dps: 6, secs: 4, radius: 2.2 }, { dps: 10, secs: 5, radius: 2.6 }],
    text: (r) => { const v = UPGRADES.pyre.v[r - 1]; return `Heartflame Nova leaves the ground burning for ${v.secs} s: ${v.dps} damage a second to Hollow within ${v.radius} tiles.`; },
  },
  snare: {
    id: 'snare', name: 'Snaring Light', icon: 'brazier', max: 2, needs: {},
    v: [{ slow: 0.25 }, { slow: 0.4 }],
    text: (r) => `Hollow on lit ground (the Hearth's and Braziers' light) move ${Math.round(UPGRADES.snare.v[r - 1].slow * 100)}% slower.`,
  },
  brace: {
    id: 'brace', name: 'Spear Brace', icon: 'shield', max: 2, needs: { barracks: true },
    v: [{ mult: 0.5 }, { mult: 0.8 }],
    text: (r) => `Spearmen deal ${Math.round(UPGRADES.brace.v[r - 1].mult * 100)}% more damage while they stand their ground.`,
  },
  volley: {
    id: 'volley', name: 'Steady Volley', icon: 'tower', max: 2, needs: { barracks: true },
    v: [{ mult: 0.3, beyond: 3 }, { mult: 0.5, beyond: 3 }],
    text: (r) => `Archers and Crossbowmen deal ${Math.round(UPGRADES.volley.v[r - 1].mult * 100)}% more damage to foes more than ${UPGRADES.volley.v[r - 1].beyond} tiles away.`,
  },
  execute: {
    id: 'execute', name: 'Headsman’s Due', icon: 'axe', max: 1, needs: {},
    v: [{ mult: 0.35, below: 0.35 }],
    text: () => `Your soldiers, heroes and Sovereign deal ${Math.round(UPGRADES.execute.v[0].mult * 100)}% more damage to foes below ${Math.round(UPGRADES.execute.v[0].below * 100)}% health.`,
  },
  guard: {
    id: 'guard', name: 'Shield the Crown', icon: 'shield', max: 1, needs: { barracks: true },
    v: [{ cut: 0.25, range: 3 }],
    text: () => `Soldiers within ${UPGRADES.guard.v[0].range} tiles of the Sovereign take ${Math.round(UPGRADES.guard.v[0].cut * 100)}% less damage.`,
  },
  firebrand: {
    id: 'firebrand', name: 'Ember Blade', icon: 'flame', max: 2, needs: { sov: true },
    v: [{ dps: 4, secs: 3 }, { dps: 7, secs: 3 }],
    text: (r) => `The Sovereign's blows set foes burning: ${UPGRADES.firebrand.v[r - 1].dps} damage a second for ${UPGRADES.firebrand.v[r - 1].secs} s.`,
  },
  pinning: {
    id: 'pinning', name: 'Pinning Arrows', icon: 'tower', max: 1, needs: { bp: 'tower' },
    v: [{ slow: 0.35, secs: 1.2 }],
    text: () => `Watchtower and Ballista arrows slow the foe they hit by ${Math.round(UPGRADES.pinning.v[0].slow * 100)}% for ${UPGRADES.pinning.v[0].secs} s.`,
  },
  kindling: {
    id: 'kindling', name: 'Kindling', icon: 'flame', max: 1, needs: {},
    v: [{ dmg: 10, radius: 1.2 }],
    text: () => `Hollow slain on lit ground burst into flame, dealing ${UPGRADES.kindling.v[0].dmg} damage to foes within ${UPGRADES.kindling.v[0].radius} tiles.`,
  },
  hightowers: {
    id: 'hightowers', name: 'High Towers', icon: 'tower', max: 2, needs: { bp: 'tower' },
    mods: { towerRange: 1 },
    text: (r) => `Watchtowers and Ballistae reach +${r} tile${r > 1 ? 's' : ''} farther.`,
  },
  bodkin: {
    id: 'bodkin', name: 'Bodkin Points', icon: 'tower', max: 2, mods: { rangedDmg: 0.15 }, needs: {},
    text: (r) => `All arrows deal ${15 * r}% more damage.`,
  },
  kindlednova: {
    id: 'kindlednova', name: 'Kindled Nova', icon: 'nova', max: 2, mods: { novaDmg: 0.3, novaCd: 5 }, needs: { sov: true },
    text: (r) => `Heartflame Nova deals ${30 * r}% more damage and recharges ${5 * r} s sooner.`,
  },
  longbanner: {
    id: 'longbanner', name: 'Long Banner', icon: 'banner', max: 1, mods: { bannerDur: 4, bannerCd: 8 }, needs: { sov: true },
    text: () => 'The Royal Banner lasts 4 s longer and recharges 8 s sooner.',
  },
  hearthfire: {
    id: 'hearthfire', name: 'Hearthfire', icon: 'flame', max: 2, mods: { hearthDmg: 5 }, needs: {},
    text: (r) => `The Hearth's ember bolts deal +${5 * r} damage.`,
  },
  drill: {
    id: 'drill', name: 'Drill Yard', icon: 'sword', max: 2, mods: { soldierDmg: 0.12 }, needs: { barracks: true },
    text: (r) => `Every soldier deals ${12 * r}% more damage.`,
  },
  stoneskin: {
    id: 'stoneskin', name: 'Stone Skin', icon: 'wall', max: 1, mods: { wallHp: 0.3 }, needs: { bp: 'wall' },
    text: () => 'Walls and Gates have 30% more health (the ones standing too).',
  },
  vigor: {
    id: 'vigor', name: 'Royal Vigor', icon: 'heart', max: 2, needs: { sov: true },
    v: [{ hp: 40 }, { hp: 40 }],
    text: () => `The Sovereign gains ${UPGRADES.vigor.v[0].hp} max health, and that much health now.`,
  },
  dawnrest: {
    id: 'dawnrest', name: 'Dawn Rest', icon: 'sun', max: 1, needs: { sov: true },
    v: [{ heal: 0.25 }],
    text: () => `The Sovereign regains ${Math.round(UPGRADES.dawnrest.v[0].heal * 100)}% of its health at every dawn.`,
  },
  surgeons: {
    id: 'surgeons', name: 'Field Surgeons', icon: 'heart', max: 1, needs: { barracks: true },
    v: [{ heal: 1 }],
    text: () => 'Soldiers return to full health at every dawn.',
  },
  tithe: {
    id: 'tithe', name: 'Hollow Tithe', icon: 'gold', max: 2, needs: {},
    v: [{ gold: 1 }, { gold: 2 }],
    text: (r) => `Gain ${UPGRADES.tithe.v[r - 1].gold} gold for every Hollow slain.`,
  },
};
export const UPGRADE_LIST = Object.values(UPGRADES);

/** The supplies fallback. amount(depth) scales with the region's depth. `needs`: 'damaged' |
 *  'sovHurt' | 'soldiersHurt' (checked by hasEffect). */
export const SUPPLIES = {
  timber: { id: 'timber', name: 'Timber and Stone', icon: 'wood', res: (d) => ({ wood: 45 + 8 * d, stone: 25 + 5 * d }) },
  larder: { id: 'larder', name: 'A Full Larder', icon: 'food', res: (d) => ({ food: 60 + 10 * d }) },
  tithe: { id: 'tithe', name: 'Pilgrim Tithe', icon: 'gold', res: (d) => ({ gold: 35 + 6 * d }) },
  masons: { id: 'masons', name: 'Masons’ Vigil', icon: 'hammer', needs: 'damaged' },
  rest: { id: 'rest', name: 'A Quiet Hour', icon: 'crown', needs: 'sovHurt' },
};

/** The Beacon reward pick: 3 options, relics and lasting (run) bonuses from js/data/beacons.js. */
export const BEACON_PICK = {
  options: 3,
  // Relic rarities offered, by node type (one roll per relic option).
  relicRarity: { region: ['common', 'rare'], cursed: ['rare', 'legendary'], boss: ['rare', 'legendary'] },
  legendaryChance: { region: 0.1, cursed: 0.35, boss: 0.5 },
};

const ICONS = ['food', 'wood', 'stone', 'gold', 'pop', 'sword', 'sun', 'moon', 'nova', 'banner', 'hammer', 'up', 'crown',
  'flame', 'tower', 'house', 'skull', 'shield', 'beacon', 'book', 'axe', 'wall', 'brazier', 'heart', 'relic'];
/** Throws on the first malformed card (run by tools/cards.mjs). */
export function validateCards() {
  for (const [id, u] of Object.entries(UPGRADES)) {
    const w = `UPGRADES.${id}`;
    if (u.id !== id) throw new Error(`${w}: id mismatch`);
    if (!u.name || !ICONS.includes(u.icon)) throw new Error(`${w}: name or icon`);
    if (!(u.max >= 1)) throw new Error(`${w}: max`);
    if (u.v && u.v.length < u.max) throw new Error(`${w}: v has fewer ranks than max`);
    for (let r = 1; r <= u.max; r++) { const t = u.text(r); if (!t || t.length > 140) throw new Error(`${w}: text rank ${r}`); }
  }
  for (const [id, c] of Object.entries(SUPPLIES)) if (c.id !== id || !ICONS.includes(c.icon)) throw new Error(`SUPPLIES.${id}`);
  return true;
}
