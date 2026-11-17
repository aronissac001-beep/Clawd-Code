// Workshop specialisations (doc 8.2; owner G). Every spec adds a verb: recipes, toils, structures
// or rules; `also` is the one-line number. Recipes it adds carry spec: <this id>.
export const DATA = {
  spec: [
    { id: 'stonecutter', name: 'Stonecutter', bench: ['mason'], tier: 2, adds: { recipes: ['ashlar_blocks'], rules: ['cutInPlace'] }, mods: [],
      text: 'Cut in place: stone piles within 6 tiles of the bench are cut where they lie.', also: '12 blocks per rough stone' },
    { id: 'joiner', name: 'Joiner', bench: ['carpenter'], tier: 2, adds: { rules: ['matchedSet'] }, mods: [],
      text: 'Matched sets: one bill makes a whole bedroom or dining set, and a full set is well appointed.' },
  ],
};
