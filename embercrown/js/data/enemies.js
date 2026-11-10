// The Hollow. `resist` multiplies incoming damage by type (see MATCHUPS for tag
// bonuses on the attacker side). `cost` is the wave-budget price.

export const ENEMIES = {
  husk: {
    id: 'husk', name: 'Husk', color: '#8d8aa3',
    desc: 'A hollowed shell of a villager, drifting toward warmth. Weak alone, dangerous in numbers.',
    weak: 'Archers, towers',
    hp: 32, dmg: 5, dmgType: 'blade', rate: 1.1, range: 0.75, speed: 1.15, aggro: 1.6,
    tags: ['hollow', 'infantry'], cost: 1, radius: 6, prefers: 'any',
  },
  hound: {
    id: 'hound', name: 'Gloom Hound', color: '#6d6890',
    desc: 'Fast, low, hungry. Hunts villagers caught outside and flanks around walls.',
    weak: 'Spearmen',
    hp: 24, dmg: 4, dmgType: 'blade', rate: 0.7, range: 0.7, speed: 2.3, aggro: 4,
    tags: ['hollow', 'beast'], cost: 1.3, radius: 6, prefers: 'living',
  },
  shade: {
    id: 'shade', name: 'Shade', color: '#a79bd6',
    desc: 'A drifting wraith that slips through walls standing in darkness. Light pins it down.',
    weak: 'Fire, Braziers, the Sovereign',
    hp: 28, dmg: 8, dmgType: 'blade', rate: 1.0, range: 0.75, speed: 1.7, aggro: 2.5,
    tags: ['hollow', 'spirit'], cost: 1.7, radius: 6, phase: true, prefers: 'living',
  },
  knight: {
    id: 'knight', name: 'Hollow Knight', color: '#57536b',
    desc: 'Grey plate around nothing at all. Slow, and smashes buildings with brutal blows.',
    weak: 'Militia mauls, fire',
    hp: 150, dmg: 14, dmgType: 'crush', rate: 1.5, range: 0.9, speed: 0.75, aggro: 1.4,
    tags: ['hollow', 'armored'], cost: 4.5, radius: 9, prefers: 'buildings',
  },
};

// Elite affixes (Phase 1 ships two; the data shape allows more).
export const AFFIXES = {
  warden: { id: 'warden', name: 'Warden', hpMult: 5, dmgMult: 1.6, scale: 1.55, desc: 'A towering elite of the Hollow.' },
  swift: { id: 'swift', name: 'Swift', speedMult: 1.45, hpMult: 1.1, scale: 1.05, desc: 'Moves much faster.' },
};
