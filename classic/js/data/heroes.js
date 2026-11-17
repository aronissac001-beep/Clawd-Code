// Heroes: 0-2 named champions, commanded like squads (a post to hold, a foe to attack, or
// guard the Hearth). They join through a Recruit card, level up, earn perks (offered at dawn,
// never mid-night) and die for good.
// js/game/systems/heroes.js runs them; js/ui/heroui.js and js/engine/heroart.js show them.
// Stats use the same units as UNITS (hp, dmg per hit, rate = seconds per attack,
// range/speed/sight in tiles). Perk `stats` are simple adds; `power` raises the class
// ability's strength by that fraction and `abilCd` shortens its cooldown (-0.25 = 25% faster).

export const HERO_CLASSES = {
  paladin: {
    id: 'paladin', name: 'Paladin', role: 'Holy guardian', color: '#e8c25a', cape: '#3e6fb0',
    desc: 'A knight sworn to the Heartflame. Heavy plate, a blessed blade, and a calm that steadies everyone nearby.',
    hp: 190, armor: 0.3, dmg: 11, dmgType: 'blade', rate: 1.0, range: 1.0, speed: 1.55, sight: 5, ranged: false,
    ability: { id: 'aegis', name: 'Aegis Aura', text: 'Allies within 3 tiles take 15% less damage.' },
    perks: {
      3: [
        { id: 'pal_bulwark', name: 'Bulwark', text: '+40 health, +5% armor.', stats: { hp: 40, armor: 0.05 } },
        { id: 'pal_zeal', name: 'Zeal', text: '+3 damage, attacks 10% faster.', stats: { dmg: 3, rate: -0.1 } },
      ],
      6: [
        { id: 'pal_sanctuary', name: 'Sanctuary', text: 'Aegis Aura is twice as strong and reaches further.', stats: { power: 1 } },
        { id: 'pal_vigil', name: 'Vigil', text: 'Regenerates 2 health a second, even in battle.', stats: { regen: 2 } },
      ],
      9: [
        { id: 'pal_lightbearer', name: 'Lightbearer', text: '+60 health, +4 damage.', stats: { hp: 60, dmg: 4 } },
        { id: 'pal_crusade', name: 'Crusade', text: '+25% experience, attacks 10% faster.', stats: { xpMult: 0.25, rate: -0.1 } },
      ],
    },
  },
  ranger: {
    id: 'ranger', name: 'Ranger', role: 'Forest archer', color: '#6fae4a', cape: '#2f6a3a',
    desc: 'A wanderer of the deep woods who sees far and never misses twice.',
    hp: 120, armor: 0.08, dmg: 9, dmgType: 'pierce', rate: 1.05, range: 5.5, speed: 1.75, sight: 7, ranged: true,
    ability: { id: 'volley', name: 'Volley', text: 'Every 7 s looses arrows at up to 3 foes in range.' },
    perks: {
      3: [
        { id: 'rng_longbow', name: 'Longbow', text: '+1 range, +2 damage.', stats: { range: 1, dmg: 2 } },
        { id: 'rng_fleet', name: 'Fleet-footed', text: '+20% speed, +1 sight.', stats: { speed: 0.35, sight: 1 } },
      ],
      6: [
        { id: 'rng_stormvolley', name: 'Storm Volley', text: 'Volley fires twice as often and hits harder.', stats: { power: 0.6, abilCd: -0.45 } },
        { id: 'rng_quickdraw', name: 'Quick Draw', text: 'Attacks 20% faster.', stats: { rate: -0.2 } },
      ],
      9: [
        { id: 'rng_hawkeye', name: 'Hawkeye', text: '+2 range, +4 damage.', stats: { range: 2, dmg: 4 } },
        { id: 'rng_deadeye', name: 'Deadeye', text: 'Attacks 15% faster, +1 sight.', stats: { rate: -0.16, sight: 1 } },
      ],
    },
  },
  rogue: {
    id: 'rogue', name: 'Rogue', role: 'Knife in the dark', color: '#8a7ab8', cape: '#3a2f48',
    desc: 'Quick and quiet. Strikes where the Hollow is not looking.',
    hp: 115, armor: 0.1, dmg: 10, dmgType: 'blade', rate: 0.7, range: 0.9, speed: 2.0, sight: 5, ranged: false,
    ability: { id: 'backstab', name: 'Backstab', text: 'Double damage against foes busy fighting someone else.' },
    perks: {
      3: [
        { id: 'rog_poison', name: 'Coated Blades', text: '+3 damage.', stats: { dmg: 3 } },
        { id: 'rog_shadow', name: 'Shadowstep', text: '+25% speed, +5% armor.', stats: { speed: 0.5, armor: 0.05 } },
      ],
      6: [
        { id: 'rog_assassin', name: 'Assassin', text: 'Backstab deals triple damage.', stats: { power: 0.5 } },
        { id: 'rog_flurry', name: 'Flurry', text: 'Attacks 20% faster.', stats: { rate: -0.14 } },
      ],
      9: [
        { id: 'rog_cutpurse', name: 'Cutthroat', text: '+5 damage, +15% speed.', stats: { dmg: 5, speed: 0.3 } },
        { id: 'rog_evasion', name: 'Evasion', text: '+50 health, +10% armor.', stats: { hp: 50, armor: 0.1 } },
      ],
    },
  },
  pyromancer: {
    id: 'pyromancer', name: 'Pyromancer', role: 'Fire mage', color: '#f08a3a', cape: '#8e2e1e',
    desc: 'A scholar of the Heartflame who learned to throw it. Burns Shades and Knights alike.',
    hp: 95, armor: 0.04, dmg: 10, dmgType: 'fire', rate: 1.4, range: 4.5, speed: 1.5, sight: 5, ranged: true,
    ability: { id: 'splash', name: 'Wildfire', text: 'Fire bolts burst, scorching foes within a tile of the target for half damage.' },
    perks: {
      3: [
        { id: 'pyr_kindling', name: 'Kindling', text: '+4 damage.', stats: { dmg: 4 } },
        { id: 'pyr_wardrobe', name: 'Ash Robes', text: '+35 health, +5% armor.', stats: { hp: 35, armor: 0.05 } },
      ],
      6: [
        { id: 'pyr_inferno', name: 'Inferno', text: 'Wildfire bursts are wider and hotter.', stats: { power: 0.8 } },
        { id: 'pyr_haste', name: 'Quickened Flame', text: 'Casts 20% faster.', stats: { rate: -0.28 } },
      ],
      9: [
        { id: 'pyr_sunfire', name: 'Sunfire', text: '+6 damage, +1 range.', stats: { dmg: 6, range: 1 } },
        { id: 'pyr_scholar', name: 'Scholar', text: '+40% experience, +2 health a second.', stats: { xpMult: 0.4, regen: 2 } },
      ],
    },
  },
  cleric: {
    id: 'cleric', name: 'Cleric', role: 'Healer', color: '#f2e6b0', cape: '#c8b070',
    desc: 'Keeper of the old hymns. Mends the wounded with warm light and smites the Hollow.',
    hp: 120, armor: 0.12, dmg: 7, dmgType: 'magic', rate: 1.2, range: 3.5, speed: 1.55, sight: 5, ranged: true,
    ability: { id: 'mend', name: 'Mending Light', text: 'Every 4 s heals the most wounded ally within 4 tiles for 16.' },
    perks: {
      3: [
        { id: 'clr_hymn', name: 'Hymn of Mending', text: 'Heals 50% more.', stats: { power: 0.5 } },
        { id: 'clr_mace', name: 'Blessed Mace', text: '+3 damage, +20 health.', stats: { dmg: 3, hp: 20 } },
      ],
      6: [
        { id: 'clr_devotion', name: 'Devotion', text: 'Heals twice as often.', stats: { abilCd: -0.5 } },
        { id: 'clr_shield', name: 'Shield of Faith', text: '+50 health, +8% armor.', stats: { hp: 50, armor: 0.08 } },
      ],
      9: [
        { id: 'clr_miracle', name: 'Miracle', text: 'Heals are twice as strong.', stats: { power: 1 } },
        { id: 'clr_tithe', name: 'Sanctity', text: '+40 health, heals 3 health a second.', stats: { hp: 40, regen: 3 } },
      ],
    },
  },
  warlord: {
    id: 'warlord', name: 'Warlord', role: 'Battle leader', color: '#c8503e', cape: '#6a2a20',
    desc: 'A scarred champion with a great axe. Cleaves through crowds and roars allies into a frenzy.',
    hp: 175, armor: 0.2, dmg: 13, dmgType: 'blade', rate: 1.25, range: 1.05, speed: 1.5, sight: 4.5, ranged: false, cleave: 2,
    ability: { id: 'warcry', name: 'War Cry', text: 'In battle, every 14 s: allies within 3.5 tiles deal +20% damage for 6 s.' },
    perks: {
      3: [
        { id: 'war_brute', name: 'Brute', text: '+4 damage.', stats: { dmg: 4 } },
        { id: 'war_hide', name: 'Thick Hide', text: '+45 health.', stats: { hp: 45 } },
      ],
      6: [
        { id: 'war_bloodroar', name: 'Blood Roar', text: 'War Cry is stronger and comes more often.', stats: { power: 0.75, abilCd: -0.3 } },
        { id: 'war_reaver', name: 'Reaver', text: 'Attacks 15% faster.', stats: { rate: -0.19 } },
      ],
      9: [
        { id: 'war_conqueror', name: 'Conqueror', text: '+6 damage, +40 health.', stats: { dmg: 6, hp: 40 } },
        { id: 'war_plunder', name: 'Berserker', text: '+4 damage, attacks 15% faster.', stats: { dmg: 4, rate: -0.19 } },
      ],
    },
  },
  beastmaster: {
    id: 'beastmaster', name: 'Beastmaster', role: 'Wild tracker', color: '#a8844a', cape: '#5a4a2a',
    desc: 'Raised among wolves, speaks to hawks. Her hawk scouts ahead and finds what hides in the fog.',
    hp: 140, armor: 0.12, dmg: 10, dmgType: 'pierce', rate: 0.95, range: 1.2, speed: 1.8, sight: 6, ranged: false,
    bonus: { beast: 1.5 },
    ability: { id: 'hawk', name: 'Hawk Scout', text: 'Every 6 s her hawk flies ahead and reveals the fog around it.' },
    perks: {
      3: [
        { id: 'bst_spear', name: 'Boar Spear', text: '+3 damage, +0.3 range.', stats: { dmg: 3, range: 0.3 } },
        { id: 'bst_pelts', name: 'Bear Pelts', text: '+35 health, +5% armor.', stats: { hp: 35, armor: 0.05 } },
      ],
      6: [
        { id: 'bst_falconer', name: 'Falconer', text: 'The hawk flies further and more often.', stats: { power: 0.8, abilCd: -0.35 } },
        { id: 'bst_pack', name: 'Pack Instinct', text: 'Attacks 15% faster, +15% speed.', stats: { rate: -0.14, speed: 0.27 } },
      ],
      9: [
        { id: 'bst_alpha', name: 'Alpha', text: '+5 damage, +50 health.', stats: { dmg: 5, hp: 50 } },
        { id: 'bst_trophies', name: 'Trophy Hunter', text: '+4 damage, +20% experience.', stats: { dmg: 4, xpMult: 0.2 } },
      ],
    },
  },
  runesmith: {
    id: 'runesmith', name: 'Runesmith', role: 'Rune-hammer', color: '#7ab8d8', cape: '#3a4a5a',
    desc: 'A forge-priest of the deep halls. Every fourth hammer blow sets loose a burst of rune-fire.',
    hp: 165, armor: 0.24, dmg: 11, dmgType: 'crush', rate: 1.15, range: 0.95, speed: 1.4, sight: 4.5, ranged: false,
    ability: { id: 'runeburst', name: 'Rune Burst', text: 'Every 4th blow bursts with magic, hitting foes within 1.5 tiles.' },
    perks: {
      3: [
        { id: 'run_anvil', name: 'Anvil-forged', text: '+40 health, +5% armor.', stats: { hp: 40, armor: 0.05 } },
        { id: 'run_heavy', name: 'Heavy Hammer', text: '+4 damage.', stats: { dmg: 4 } },
      ],
      6: [
        { id: 'run_deeprunes', name: 'Deep Runes', text: 'Rune Burst hits harder and wider.', stats: { power: 0.8 } },
        { id: 'run_stone', name: 'Stoneskin', text: 'Regenerates 2 health a second, +6% armor.', stats: { regen: 2, armor: 0.06 } },
      ],
      9: [
        { id: 'run_master', name: 'Rune Master', text: '+5 damage, attacks 15% faster.', stats: { dmg: 5, rate: -0.17 } },
        { id: 'run_hoard', name: 'Ironclad', text: '+50 health, +8% armor.', stats: { hp: 50, armor: 0.08 } },
      ],
    },
  },
};
export const HERO_CLASS_IDS = Object.keys(HERO_CLASSES);

// Traits: when a hero falls back to the Hearth (retreat: health fraction), how fast it heals
// when no foe is near (rest: multiplies the idle regeneration), and whether it picks the
// strongest foe within reach instead of the nearest (glory).
export const TRAITS = {
  brave: { id: 'brave', name: 'Brave', text: 'Stands firm: falls back to the Hearth only below 25% health.', retreat: 0.25, rest: 1 },
  lazy: { id: 'lazy', name: 'Lazy', text: 'Loves a sit-down: heals twice as fast when no foe is near. Falls back at 35% health.', retreat: 0.35, rest: 2 },
  gloryseeker: { id: 'gloryseeker', name: 'Glory-seeker', text: 'Picks the strongest foe within reach. Falls back at 30% health.', retreat: 0.3, rest: 1, glory: true },
  cautious: { id: 'cautious', name: 'Cautious', text: 'Falls back at 50% health and heals 50% faster when no foe is near.', retreat: 0.5, rest: 1.5 },
};
export const TRAIT_IDS = Object.keys(TRAITS);
/** A hero's trait (older rosters may name one that no longer exists: they count as Brave). */
export function traitOf(id) { return TRAITS[id] || TRAITS.brave; }

// Total experience needed to reach each level (index 0 = level 1).
export const XP_TABLE = [0, 20, 50, 95, 155, 230, 320, 430, 560, 710];
export const MAX_LEVEL = XP_TABLE.length;
export const PERK_LEVELS = [3, 6, 9];
// Per level above 1: +8% health, +7% damage.
export const LEVEL_GROWTH = { hp: 0.08, dmg: 0.07 };

// Experience for kills by foe type (warden elites x3, unknown foes 6).
export const KILL_XP = { husk: 4, hound: 5, shade: 6, knight: 14, rift: 40, gloomwyrm: 80, colossus: 80, hollowking: 100 };

export const HERO_RULES = {
  maxHeroes: 2,           // most heroes serving at once
  thinkEvery: 0.35,       // seconds between target choices
  postAggro: 3.5,         // tiles: a hero at its post engages foes this close to the post...
  postLeash: 4.5,         // ...and lets one go beyond this (+ combat.releasePad)
  hearthGuard: 5,         // tiles around the Hearth a hero with no post defends
  marchMax: 12,           // seconds a move order may ignore foes before the hero holds where it is
  shareRadius: 5,         // tiles: nearby heroes share kill experience
  shareFrac: 0.35,
  regenIdle: 0.6, regenHearth: 2, hearthRange: 3,
  carryHeal: 0.4,         // health restored between regions
  supplyGold: 25,         // the "take supplies" option beside a hero offer (until Dawn Cards land)
};

// The Tavern is retired (heroes come from the Recruit card). Its definition stays registered
// so older saves that built one still load and draw it; it is never offered again.
export const TAVERN_BUILDING = {
  tavern: {
    id: 'tavern', name: 'Tavern', cat: 'military', size: 2, solid: true, draftable: false,
    desc: 'An old inn. The champions who drank here now answer the dawn horn instead.',
    levels: [
      { cost: { wood: 50, stone: 20 }, work: 14, hp: 300, sight: 3, light: 1.8 },
      { cost: { wood: 30, stone: 30, gold: 25 }, work: 16, hp: 420, sight: 4, light: 2.0 },
    ],
  },
};

// ---- Names ---------------------------------------------------------------------------
const NAME_A = ['Al', 'Bran', 'Cael', 'Dor', 'Ely', 'Fen', 'Gar', 'Hal', 'Ior', 'Jor', 'Kes', 'Lir', 'Mor', 'Nym', 'Os', 'Per', 'Quel', 'Ren', 'Sar', 'Tam', 'Ul', 'Vor', 'Wyn', 'Ys', 'Zar', 'Bel', 'Thal', 'Cor'];
const NAME_B = ['ric', 'wen', 'dor', 'mira', 'thas', 'iel', 'gar', 'ova', 'an', 'eth', 'ys', 'unn', 'ara', 'ek', 'olt', 'ine', 'ath', 'ro', 'wyn', 'is'];
const EPITHETS = ['the Bold', 'the Grey', 'Ashborn', 'the Quiet', 'Emberhand', 'the Unbowed', 'Duskwalker', 'the Lucky', 'Ironbrow', 'of the Vale', 'the Wanderer', 'Brightblade', 'the Patient', 'Oathkeeper', 'the Fox', 'Stormcaller', 'the Tall', 'Hollowbane', 'the Thrifty', 'Lanternheart'];

/** Seeded hero name: two syllable parts plus an epithet. r: an RNG with pick(). */
export function heroName(r) {
  return `${r.pick(NAME_A)}${r.pick(NAME_B)} ${r.pick(EPITHETS)}`;
}

/** Roll a hero's identity (class optional; `avoid` lists classes not to pick). Plain data. */
export function rollHero(r, cls, locked, avoid) {
  let ids = Object.keys(HERO_CLASSES);
  if (locked && locked.length) { const f = ids.filter((c) => !locked.includes(c)); if (f.length) ids = f; }
  if (avoid && avoid.length) { const f = ids.filter((c) => !avoid.includes(c)); if (f.length) ids = f; }
  return {
    name: heroName(r),
    cls: cls && HERO_CLASSES[cls] ? cls : r.pick(ids),
    trait: r.pick(TRAIT_IDS),
  };
}

/** The perk choice for a class at a perk level: [{ id, name, text, stats }, ...] or null. */
export function perkChoice(cls, level) {
  const c = HERO_CLASSES[cls];
  return (c && c.perks && c.perks[level]) || null;
}

/** Find a perk definition by id. */
export function perkDef(id) {
  for (const c in HERO_CLASSES) {
    const P = HERO_CLASSES[c].perks;
    for (const lv in P) for (const p of P[lv]) if (p.id === id) return p;
  }
  return null;
}

/** Level (1..MAX_LEVEL) for a total experience value. */
export function levelForXp(xp) {
  let lv = 1;
  while (lv < MAX_LEVEL && xp >= XP_TABLE[lv]) lv++;
  return lv;
}
