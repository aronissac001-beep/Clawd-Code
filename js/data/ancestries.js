// Ancestries (doc 4.1). OWNER F.
// Stage 0 placeholder written by workstream G so every 13.4 file exists and validate-data checks
// the C11 schema end to end. The owner replaces these sample entries freely (keep export DATA).
export const DATA = {
  ancestry: [
    { id: 'human', name: 'Human', mods: [], art: 'colonist.human', text: 'One extra passion. Underground and open-sky thoughts are halved.' },
    { id: 'deepforge', name: 'Deepforge', learn: { mining: 125, smithing: 125 }, mods: [{ key: 'move.speed', op: 'pct', value: -8 }], art: 'colonist.deepforge',
      text: 'Mining and Smithing learn faster; at home under rock.' },
    { id: 'sylvari', name: 'Sylvari', learn: { growing: 125, animals: 125 }, mods: [], art: 'colonist.sylvari', text: 'Growing and Animals learn faster; happier among trees.' },
  ],
};
