// Raiders and Hollow Lords (from the roguelite enemies tables) (doc 9.2, 9.6). OWNER H.
// Stage 0 placeholder written by workstream G so every 13.4 file exists and validate-data checks
// the C11 schema end to end. The owner replaces these sample entries freely (keep export DATA).
export const DATA = {
  raider: [
    { id: 'husk', name: 'Husk', kind: 'hollow', pts: 20, hp: 40, tags: ['hollow'], art: 'foe.husk' },
    { id: 'gloom_hound', name: 'Gloom Hound', kind: 'hollow', pts: 30, hp: 45, tags: ['hollow', 'beast'], art: 'foe.hound' },
    { id: 'delver', name: 'Gutterkin delver', kind: 'gutterkin', pts: 50, hp: 50, tags: ['sapper'], art: 'foe.delver' },
  ],
  lord: [
    { id: 'gloomwyrm', name: 'Gloomwyrm', tier: 'hold', art: 'boss.gloomwyrm', text: 'Flies over walls and snuffs the lights it passes.' },
    { id: 'colossus', name: 'Bone Colossus', tier: 'stronghold', art: 'boss.colossus', text: 'Walks through walls; strike the weak spot on its back.' },
  ],
};
