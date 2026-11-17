// Friendly units. `bonus` multiplies damage against enemies with that tag.
// Counter loop in this phase: Spearmen > Gloom Hounds, Archers > Husks,
// Militia (mauls) > Hollow Knights, fire and light > Shades.

export const UNITS = {
  militia: {
    id: 'militia', name: 'Militia', role: 'Maul infantry',
    desc: 'Townsfolk with heavy mauls and stout shields. Crushing blows cave in Hollow armor.',
    strong: 'Hollow Knights', weak: 'Gloom Hound packs',
    cost: { gold: 12, food: 10 }, train: 5,
    hp: 64, armor: 0.1, dmg: 6, dmgType: 'crush', rate: 1.0, range: 0.85, speed: 1.55, sight: 3.5,
    bonus: {}, ranged: false,
  },
  spearman: {
    id: 'spearman', name: 'Spearman', role: 'Pike infantry',
    desc: 'Long spears set against the charge. Gloom Hounds impale themselves.',
    strong: 'Gloom Hounds', weak: 'Hollow Knights',
    cost: { gold: 16, food: 10, wood: 6 }, train: 6,
    hp: 72, armor: 0.15, dmg: 7, dmgType: 'blade', rate: 1.0, range: 1.25, speed: 1.5, sight: 3.5,
    bonus: { beast: 2.2 }, ranged: false,
  },
  archer: {
    id: 'archer', name: 'Archer', role: 'Bow skirmisher',
    desc: 'Volleys from range. Deadly to massed Husks, useless against plate.',
    strong: 'Husks', weak: 'Hollow Knights, Shades',
    cost: { gold: 18, food: 10, wood: 10 }, train: 6,
    hp: 42, armor: 0, dmg: 7, dmgType: 'pierce', rate: 1.15, range: 5, speed: 1.6, sight: 5,
    bonus: {}, ranged: true,
  },
  sovereign: {
    id: 'sovereign', name: 'The Ember-Sovereign', role: 'Your ruler',
    desc: 'Carrier of the Heartflame. Cleaves through foes, but if the Sovereign dies the realm dies too. Falls back to the Hearth when badly hurt.',
    strong: 'Everything, briefly', weak: 'Being surrounded',
    hp: 320, armor: 0.25, dmg: 15, dmgType: 'blade', rate: 0.85, range: 1.1, speed: 1.8, sight: 5,
    bonus: {}, ranged: false, cleave: 3,
  },
  villager: {
    id: 'villager', name: 'Villager', role: 'Worker',
    desc: 'Builds, gathers and farms on their own. Shelters at dusk. Keep them fed.',
    strong: 'Hard work', weak: 'Everything with teeth',
    hp: 30, armor: 0, dmg: 0, speed: 1.75, sight: 2.5,
  },
};

export const SOVEREIGN_ABILITIES = {
  nova: {
    id: 'nova', name: 'Heartflame Nova', cooldown: 24,
    desc: 'A ring of holy fire bursts from the Sovereign: 45 fire damage to nearby Hollow, knocking them back.',
    radius: 2.8, dmg: 45, knock: 40,
  },
  banner: {
    id: 'banner', name: 'Royal Banner', cooldown: 40,
    desc: 'Plant the royal standard for 12 s. Allies within 4 tiles deal +35% damage and attack faster.',
    radius: 4, duration: 12, dmgBonus: 0.35, rateBonus: 0.25,
  },
};
