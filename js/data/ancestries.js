// Ancestries (doc 4.1). OWNER F. learn: skill -> learning percent; mods: modifier list (13.3);
// passions: extra passions at generation; look: how many variants of each look part the art has
// (colonist generation rolls 0..n-1; D's colonist kit draws them). Stage 1a: the Hearthwatch
// Remnant band is three Humans, drawn with 4 hair styles x 6 palettes (14.6).
export const DATA = {
  ancestry: [
    { id: 'human', name: 'Human', mods: [], passions: 1, art: 'colonist.human', look: { skin: 6, hair: 4, hairC: 6, beard: 5, cloth: 6 },
      text: 'One extra passion. Underground and open-sky thoughts are halved.' },
    { id: 'sylvari', name: 'Thornwake', learn: { growing: 125, animals: 125 }, mods: [], art: 'colonist.sylvari', look: { skin: 4, hair: 4, hairC: 6, beard: 1, cloth: 6 },
      text: 'Growing and Animals learn faster; happier among trees, pressed under stone.' },
    { id: 'deepforge', name: 'Deepforge', learn: { mining: 125, smithing: 125 }, mods: [{ key: 'move.speed', op: 'pct', value: -8 }], art: 'colonist.deepforge',
      look: { skin: 5, hair: 4, hairC: 6, beard: 5, cloth: 6 }, text: 'Mining and Smithing learn faster; at home under rock, a little slow on foot.' },
    { id: 'emberkin', name: 'Emberkin', learn: { melee: 125 }, mods: [{ key: 'dmg.fire', op: 'pct', value: -50 }, { key: 'cold.rate', op: 'pct', value: 50 }, { key: 'break.minor', op: 'add', value: 4 }],
      art: 'colonist.emberkin', look: { skin: 4, hair: 4, hairC: 4, beard: 3, cloth: 6 }, text: 'Melee learns faster; fire hurts them half as much, cold half again as much. Quick tempered.' },
  ],
};
