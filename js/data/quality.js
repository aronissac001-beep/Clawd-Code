// Quality levels (doc 5.8; owner G). All six, in order. min is the lowest roll that reaches the
// level (roll = skill level + N(0, 2.5) + bonuses; tuning in balance.js QUALITY). Effects are
// integer percents applied to value, beauty, comfort, armour and weapon damage.
export const DATA = {
  quality: [
    { id: 'crude', name: 'Crude', min: -99, value: 50, beauty: 50, comfort: 80, armour: 80, dmg: 85 },
    { id: 'plain', name: 'Plain', min: 3, value: 100, beauty: 100, comfort: 100, armour: 100, dmg: 100 },
    { id: 'fine', name: 'Fine', min: 8, value: 150, beauty: 150, comfort: 110, armour: 110, dmg: 110 },
    { id: 'superior', name: 'Superior', min: 13, value: 250, beauty: 200, comfort: 120, armour: 120, dmg: 120 },
    { id: 'masterwork', name: 'Masterwork', min: 17, value: 500, beauty: 300, comfort: 135, armour: 135, dmg: 130 },
    { id: 'legendary', name: 'Legendary', min: 20, value: 1000, beauty: 500, comfort: 150, armour: 150, dmg: 145 },
  ],
};
