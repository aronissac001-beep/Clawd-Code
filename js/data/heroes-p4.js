// Phase 4 hero classes: Skald, Druid, Duelist and Frostwarden (12 classes in all).
// Same schema as HERO_CLASSES in js/data/heroes.js. Their abilities run in
// js/game/systems/relics-p4.js (keyed by class id) from the numbers in HP4, and
// the player text below is built from those same numbers.
// Perk stats are plain adds like the core perks; the extra keys `morale` (Skald),
// `root` (Druid) and `dodge` (Duelist) are read only by the Phase 4 ability code.
// Unlocks: skald and druid need u_guild1, duelist and frostwarden need u_guild2.

/** Ability tuning. `power` (perks) scales strength, `abilCd` (perks) shortens cooldowns. */
export const HP4 = {
  skald: { aura: 0.15, radius: 4, radiusPerPower: 0.25, morale: 0.5 },
  druid: { every: 6, radius: 3, heal: 10, rootSlow: 0.4, rootTime: 2, rootSlowPerRoot: 0.2 },
  duelist: { dodge: 0.25, dodgeMax: 0.5, lone: 2, crit: 0.5 },
  frostwarden: { chill: 0.3, chillTime: 2, every: 8, freeze: 2, radius: 1, winter: 0.25 },
};
const pct = (v) => `${Math.round(v * 100)}%`;
const S = HP4.skald, D = HP4.druid, U = HP4.duelist, F = HP4.frostwarden;

export const HERO_CLASSES_P4 = {
  skald: {
    id: 'skald', name: 'Skald', role: 'War-singer', color: '#e0a848', cape: '#7a3a2a', unlock: 'u_guild1',
    desc: 'A singer of old battle-songs with a round shield and a brass horn. Where she sings, spears strike harder and hearts lift.',
    hp: 150, armor: 0.16, dmg: 10, dmgType: 'blade', rate: 1.1, range: 1.0, speed: 1.6, sight: 5, ranged: false,
    ability: { id: 'warsong', name: 'War Song', text: `Allies within ${S.radius} tiles deal ${pct(S.aura)} more damage. Each foe she slays lifts Morale by ${S.morale}.` },
    perks: {
      3: [
        { id: 'skd_mail', name: 'Ringmail', text: '+40 health, +5% armor.', stats: { hp: 40, armor: 0.05 } },
        { id: 'skd_axe', name: 'Bearded Axe', text: '+3 damage, attacks 10% faster.', stats: { dmg: 3, rate: -0.11 } },
      ],
      6: [
        { id: 'skd_anthem', name: 'Battle Anthem', text: 'War Song is 60% stronger and reaches 15% further.', stats: { power: 0.6 } },
        { id: 'skd_rousing', name: 'Rousing Verse', text: 'Her kills lift Morale twice as much. Heals 1 health a second.', stats: { morale: 1, regen: 1 } },
      ],
      9: [
        { id: 'skd_saga', name: 'Living Legend', text: '+50 health, +4 damage.', stats: { hp: 50, dmg: 4 } },
        { id: 'skd_mead', name: 'Mead-hall Tales', text: '+50% bounty gold, +25% experience.', stats: { goldMult: 0.5, xpMult: 0.25 } },
      ],
    },
  },
  druid: {
    id: 'druid', name: 'Druid', role: 'Grove-keeper', color: '#62b86a', cape: '#3a5a2a', unlock: 'u_guild1',
    desc: 'A keeper of the old groves. Green light knits wounds closed, and roots rise to hold the Hollow where they stand.',
    hp: 115, armor: 0.08, dmg: 7, dmgType: 'magic', rate: 1.3, range: 4, speed: 1.55, sight: 5.5, ranged: true,
    ability: { id: 'wildgrowth', name: 'Wild Growth', text: `Every ${D.every} s heals all allies within ${D.radius} tiles for ${D.heal}. Her bolts root foes: ${pct(D.rootSlow)} slower for ${D.rootTime} s.` },
    perks: {
      3: [
        { id: 'drd_bloom', name: 'Bloom', text: 'Wild Growth heals 50% more.', stats: { power: 0.5 } },
        { id: 'drd_bark', name: 'Barkskin', text: '+35 health, +6% armor.', stats: { hp: 35, armor: 0.06 } },
      ],
      6: [
        { id: 'drd_thorns', name: 'Grasping Thorns', text: 'Roots hold twice as long and slow 60%.', stats: { root: 1 } },
        { id: 'drd_cycle', name: 'Verdant Cycle', text: 'Wild Growth comes twice as often.', stats: { abilCd: -0.5 } },
      ],
      9: [
        { id: 'drd_oak', name: 'Heart of Oak', text: '+60 health, +4 damage.', stats: { hp: 60, dmg: 4 } },
        { id: 'drd_grove', name: 'Grove-Elder', text: '+40% experience, heals 2 health a second.', stats: { xpMult: 0.4, regen: 2 } },
      ],
    },
  },
  duelist: {
    id: 'duelist', name: 'Duelist', role: 'Fast blade', color: '#e0607e', cape: '#4a2a4a', unlock: 'u_guild2',
    desc: 'A fencing master with a feathered hat and a needle-thin blade. Hard to hit, and deadly against a foe who stands alone.',
    hp: 125, armor: 0.1, dmg: 11, dmgType: 'blade', rate: 0.8, range: 0.95, speed: 2.0, sight: 5, ranged: false,
    ability: { id: 'grace', name: 'Fencer’s Grace', text: `Dodges ${pct(U.dodge)} of blows. Deals ${pct(U.crit)} more damage to a foe with no other Hollow within ${U.lone} tiles.` },
    perks: {
      3: [
        { id: 'dul_footwork', name: 'Footwork', text: '+10% dodge chance, +15% speed.', stats: { dodge: 0.1, speed: 0.3 } },
        { id: 'dul_edge', name: 'Keen Edge', text: '+3 damage.', stats: { dmg: 3 } },
      ],
      6: [
        { id: 'dul_lunge', name: 'Killing Lunge', text: 'Strikes on a lone foe deal double damage.', stats: { power: 1 } },
        { id: 'dul_flurry', name: 'Whirling Steel', text: 'Attacks 20% faster.', stats: { rate: -0.16 } },
      ],
      9: [
        { id: 'dul_master', name: 'Blademaster', text: '+5 damage, +40 health.', stats: { dmg: 5, hp: 40 } },
        { id: 'dul_prize', name: 'Prize Fighter', text: '+70% bounty gold.', stats: { goldMult: 0.7 } },
      ],
    },
  },
  frostwarden: {
    id: 'frostwarden', name: 'Frostwarden', role: 'Ice mage', color: '#8ad0f0', cape: '#2a4a7a', unlock: 'u_guild2',
    desc: 'A mage of the high passes who carries winter in a crystal staff. Her frost slows the Hollow and can lock them in ice.',
    hp: 105, armor: 0.06, dmg: 9, dmgType: 'magic', rate: 1.35, range: 4.5, speed: 1.45, sight: 5, ranged: true,
    ability: { id: 'rime', name: 'Rime', text: `Bolts chill foes ${pct(F.chill)} slower for ${F.chillTime} s. Every ${F.every} s freezes her target and foes within ${F.radius} tile of it for ${F.freeze} s. +${pct(F.winter)} damage in winter.` },
    perks: {
      3: [
        { id: 'frw_shards', name: 'Ice Shards', text: '+3 damage.', stats: { dmg: 3 } },
        { id: 'frw_furs', name: 'Snow-bear Furs', text: '+35 health, +5% armor.', stats: { hp: 35, armor: 0.05 } },
      ],
      6: [
        { id: 'frw_deep', name: 'Deep Freeze', text: 'Freezes last 50% longer and spread 50% wider.', stats: { power: 0.5 } },
        { id: 'frw_glacier', name: 'Glacial Focus', text: 'Freezes recharge 40% faster.', stats: { abilCd: -0.4 } },
      ],
      9: [
        { id: 'frw_winter', name: 'Heart of Winter', text: '+6 damage, +1 range.', stats: { dmg: 6, range: 1 } },
        { id: 'frw_scholar', name: 'Hoarfrost Scholar', text: '+40% experience, heals 2 health a second.', stats: { xpMult: 0.4, regen: 2 } },
      ],
    },
  },
};
