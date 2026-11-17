// Recipes (doc 6.4; owner G). work is game minutes at speed 1.0 (4.2). in: { k | cat, n, mat? };
// out: { k, n, matFrom? } (matFrom copies the material of ingredient i: a granite table from
// granite blocks). spec names the workshop specialisation that unlocks the recipe (8.2). stage is
// the build stage that introduces the recipe (schema STAGES; availableIn).
// xp: total XP a full craft gives at work speed 1.0 is work x 10 ticks (one per work tick, 4.2);
// the field is informational (the toil runner awards XP per work tick).
// Stage 1a: the Carpenter's bench and Mason's bench recipes of the slice (14.6), 11 in all with the
// spec recipe and the 1b campfire meals.
export const DATA = {
  recipe: [
    // ---- Carpenter's bench (Woodcraft) ----
    { id: 'make_bed', name: 'Bed', bench: ['carpenter'], in: [{ k: 'wood', n: 35 }], out: [{ k: 'bed', n: 1, matFrom: 0 }],
      skill: 'woodcraft', work: 120, minSkill: 0, quality: true, tech: 'carpentry', xp: 1200, stage: '1a', text: 'A wooden bed: rest at full speed.' },
    { id: 'make_table', name: 'Table', bench: ['carpenter'], in: [{ k: 'wood', n: 30 }], out: [{ k: 'table', n: 1, matFrom: 0 }],
      skill: 'woodcraft', work: 90, minSkill: 0, quality: true, tech: 'carpentry', xp: 900, stage: '1a' },
    { id: 'make_chair', name: 'Chair', bench: ['carpenter'], in: [{ k: 'wood', n: 15 }], out: [{ k: 'chair', n: 1, matFrom: 0 }],
      skill: 'woodcraft', work: 45, minSkill: 0, quality: true, tech: 'carpentry', xp: 450, stage: '1a' },
    { id: 'make_prop', name: 'Wooden prop', bench: ['carpenter'], in: [{ k: 'wood', n: 20 }], out: [{ k: 'prop', n: 1, matFrom: 0 }],
      skill: 'woodcraft', work: 40, minSkill: 0, quality: false, tech: 'carpentry', xp: 400, stage: '1a', text: 'A timber roof support for halls and tunnels.' },
    // ---- Mason's bench (Masonry) ----
    { id: 'cut_blocks', name: 'Cut blocks', bench: ['mason'], in: [{ k: 'stone', n: 1 }], out: [{ k: 'block', n: 10, matFrom: 0 }],
      skill: 'masonry', work: 30, minSkill: 0, quality: false, tech: 'masonry', xp: 300, stage: '1a', text: 'One rough stone becomes ten blocks of the same stone.' },
    { id: 'stone_bed', name: 'Stone bed', bench: ['mason'], in: [{ cat: 'blocks', n: 35 }], out: [{ k: 'bed', n: 1, matFrom: 0 }],
      skill: 'masonry', work: 120, minSkill: 0, quality: true, tech: 'masonry', xp: 1200, stage: '1a', text: 'A bed frame of cut stone; it does not burn.' },
    { id: 'stone_table', name: 'Stone table', bench: ['mason'], in: [{ cat: 'blocks', n: 40 }], out: [{ k: 'table', n: 1, matFrom: 0 }],
      skill: 'masonry', work: 120, minSkill: 0, quality: true, tech: 'masonry', xp: 1200, stage: '1a' },
    { id: 'stone_chair', name: 'Stone chair', bench: ['mason'], in: [{ cat: 'blocks', n: 20 }], out: [{ k: 'chair', n: 1, matFrom: 0 }],
      skill: 'masonry', work: 60, minSkill: 0, quality: true, tech: 'masonry', xp: 600, stage: '1a' },
    { id: 'make_pillar', name: 'Stone pillar', bench: ['mason'], in: [{ cat: 'blocks', n: 30 }], out: [{ k: 'pillar', n: 1, matFrom: 0 }],
      skill: 'masonry', work: 90, minSkill: 0, quality: false, tech: 'masonry', xp: 900, stage: '1a', text: 'A cut stone roof support: it never burns.' },
    { id: 'ashlar_blocks', name: 'Ashlar blocks', bench: ['mason'], in: [{ k: 'stone', n: 2 }], out: [{ k: 'block', n: 24, matFrom: 0 }],
      skill: 'masonry', work: 50, minSkill: 4, quality: false, tech: 'masonry', spec: 'stonecutter', xp: 500, stage: '2',
      text: 'Two stones dressed together; ashlar walls and floors are cut from these.' },
    // ---- Campfire (Cooking; Stage 1b) ----
    { id: 'simple_meal', name: 'Simple meal', bench: ['campfire'], in: [{ cat: 'rawfood', n: 5 }], out: [{ k: 'meal', n: 1 }],
      skill: 'cooking', work: 30, minSkill: 0, quality: false, xp: 300, stage: '1b' },
    { id: 'roast', name: 'Roast', bench: ['campfire'], in: [{ k: 'meat', n: 4 }], out: [{ k: 'meal', n: 1 }],
      skill: 'cooking', work: 20, minSkill: 0, quality: false, xp: 200, stage: '1b', text: 'Meat over the fire: a poor meal, but quick.' },
  ],
};
