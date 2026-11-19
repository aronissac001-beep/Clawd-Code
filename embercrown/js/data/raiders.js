// Raiders and Hollow Lords (doc 9.2, 9.3, 9.6). OWNER H.
// pts: threat cost (9.2); hp: hit points; tags pick which incidents may bring them (raidplan.raiderPool).
// Combat numbers (speed, damage, reach, cadence, aggro, the tier a raider first appears at, ranged and
// digging) live in js/game/threat/stats.js until the C11 raider schema (G) takes those fields.
// art: a foe key in D's registry (js/engine/art/keys.js).
export const DATA = {
  raider: [
    // ---- the Hollow (hordes, Rifts, the breach from the deep) ----
    { id: 'husk', name: 'Husk', kind: 'hollow', pts: 20, hp: 40, tags: ['hollow', 'rift', 'breach'], art: 'foe.husk' },
    { id: 'swift_husk', name: 'Swift Husk', kind: 'hollow', pts: 28, hp: 34, tags: ['hollow', 'rift', 'breach'], art: 'foe.swift_husk' },
    { id: 'gloom_hound', name: 'Gloom Hound', kind: 'hollow', pts: 30, hp: 45, tags: ['hollow', 'beast', 'breach'], art: 'foe.hound' },
    { id: 'shade', name: 'Shade', kind: 'hollow', pts: 45, hp: 50, tags: ['hollow', 'shade', 'breach'], art: 'foe.shade' },
    { id: 'hollow_knight', name: 'Hollow Knight', kind: 'hollow', pts: 90, hp: 140, tags: ['hollow', 'knight', 'breach'], art: 'foe.knight' },
    // the tear itself: a Hollow Rift on the map (it does not move; close it or break it)
    { id: 'rift', name: 'Hollow Rift', kind: 'hollow', pts: 160, hp: 400, tags: ['rift'], art: 'foe.rift' },
    // ---- the Gutterkin (thieves and sappers) ----
    { id: 'gutter_thief', name: 'Gutterkin thief', kind: 'gutterkin', pts: 25, hp: 30, tags: ['thief'], art: 'foe.thief' },
    { id: 'delver', name: 'Gutterkin delver', kind: 'gutterkin', pts: 50, hp: 50, tags: ['sapper'], art: 'foe.delver' },
    // ---- the Ashfang reavers (real gear; it drops as loot) ----
    { id: 'reaver_club', name: 'Reaver', kind: 'reaver', pts: 40, hp: 60, tags: ['reaver'], art: 'foe.reaver' },
    { id: 'reaver_spear', name: 'Reaver spearman', kind: 'reaver', pts: 55, hp: 65, tags: ['reaver'], art: 'foe.reaver_spear' },
    { id: 'reaver_bow', name: 'Reaver archer', kind: 'reaver', pts: 55, hp: 50, tags: ['reaver'], art: 'foe.reaver_bow' },
    { id: 'reaver_xbow', name: 'Reaver crossbowman', kind: 'reaver', pts: 80, hp: 55, tags: ['reaver'], art: 'foe.reaver_xbow' },
    { id: 'reaver_captain', name: 'Reaver captain', kind: 'reaver', pts: 120, hp: 110, tags: ['reaver'], art: 'foe.captain' },
    // ---- beasts (manhunter packs, and spiders from opened caverns) ----
    { id: 'wolf', name: 'Wolf', kind: 'beast', pts: 25, hp: 55, tags: ['beast'], art: 'foe.wolf' },
    { id: 'boar', name: 'Wild boar', kind: 'beast', pts: 30, hp: 80, tags: ['beast'], art: 'foe.boar' },
    { id: 'cave_spider', name: 'Cave spider', kind: 'beast', pts: 35, hp: 50, tags: ['beast'], art: 'foe.spider' },
    { id: 'great_spider', name: 'Great spider', kind: 'beast', pts: 140, hp: 220, tags: ['beast'], art: 'foe.great_spider' },
  ],
  lord: [
    { id: 'gloomwyrm', name: 'Gloomwyrm', tier: 'hold', art: 'boss.gloomwyrm', text: 'Flies over walls and snuffs the lights it passes.' },
    { id: 'colossus', name: 'Bone Colossus', tier: 'stronghold', art: 'boss.colossus', text: 'Walks through walls; strike the weak spot on its back.' },
  ],
};
