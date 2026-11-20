// Workshop add-ons (EMBERCROWN-FORTRESS.md 3.7, F12; owner G, logic E in js/game/work/addons.js from Z2.4).
// Replaces the workshop specialisations (Stage 2.9): a bench is never asked to pick one. An add-on
// either is a structure built on a tile next to its bench (`form: 'structure'`; while it stands, the
// bench gains its verbs) or is a master set (`form: 'master'`; open while the hold has a Master of the
// bench's skill). A bench may have any number of add-ons; there is no exclusivity and no re-tooling.
// Every add-on adds a verb (recipes, toils, structures or rules); `also` is the one-line number.
// Recipes it adds carry addon: <this id>. The full audit of the old specialisations lands in Z2.4.
export const DATA = {
  addon: [
    { id: 'cutting_yard', name: 'Cutting yard', bench: ['mason'], form: 'structure', adds: { recipes: ['ashlar_blocks'], rules: ['cutInPlace'] },
      text: 'Cut in place: stone piles within 6 tiles of the bench are cut where they lie.', also: '12 blocks per rough stone' },
    { id: 'matched_sets', name: 'Matched sets', bench: ['carpenter'], form: 'master', adds: { rules: ['matchedSet'] },
      text: 'One bill makes a whole bedroom or dining set, and a full set is well appointed.' },
  ],
};
