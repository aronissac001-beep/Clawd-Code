// Recipes (doc 6.4; owner G). work is game minutes at speed 1.0 (4.2). in: { k | cat, n, mat? };
// out: { k, n, matFrom? } (matFrom copies the material of ingredient i). spec names the workshop
// specialisation that unlocks the recipe (8.2). Stage 0: one recipe per sample bench + one spec recipe.
export const DATA = {
  recipe: [
    { id: 'simple_meal', name: 'Simple meal', bench: ['campfire'], in: [{ cat: 'rawfood', n: 5 }], out: [{ k: 'meal', n: 1 }],
      skill: 'cooking', work: 30, minSkill: 0, quality: false, xp: 30 },
    { id: 'cut_blocks', name: 'Cut blocks', bench: ['mason'], in: [{ k: 'stone', n: 1 }], out: [{ k: 'block', n: 10, matFrom: 0 }],
      skill: 'masonry', work: 30, minSkill: 0, quality: false, tech: 'masonry', xp: 30 },
    { id: 'ashlar_blocks', name: 'Ashlar blocks', bench: ['mason'], in: [{ k: 'stone', n: 2 }], out: [{ k: 'block', n: 24, matFrom: 0 }],
      skill: 'masonry', work: 50, minSkill: 4, quality: false, tech: 'masonry', spec: 'stonecutter', xp: 50,
      text: 'Two stones dressed together; ashlar walls and floors are cut from these.' },
    { id: 'make_bed', name: 'Bed', bench: ['carpenter'], in: [{ k: 'wood', n: 35 }], out: [{ k: 'bed', n: 1, matFrom: 0 }],
      skill: 'woodcraft', work: 120, minSkill: 0, quality: true, tech: 'carpentry', xp: 120 },
    { id: 'make_table', name: 'Table', bench: ['carpenter'], in: [{ k: 'wood', n: 30 }], out: [{ k: 'table', n: 1, matFrom: 0 }],
      skill: 'woodcraft', work: 90, minSkill: 0, quality: true, tech: 'carpentry', xp: 90 },
  ],
};
