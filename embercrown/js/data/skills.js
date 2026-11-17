// Skills, in the fixed core order SKILL_IDS (doc 4.2). OWNER F.
// Stage 0 placeholder written by workstream G so every 13.4 file exists and validate-data checks
// the C11 schema end to end. The owner replaces these sample entries freely (keep export DATA).
export const DATA = {
  skill: [
    { id: 'mining', name: 'Mining', attr: 'might', key: true, work: ['mine'] },
    { id: 'construction', name: 'Construction', attr: 'might', key: true, work: ['build'] },
    { id: 'woodcraft', name: 'Woodcraft', attr: 'grace', key: false, work: ['craft'] },
    { id: 'masonry', name: 'Masonry', attr: 'might', key: false, work: ['craft'] },
    { id: 'smithing', name: 'Smithing', attr: 'might', key: true, work: ['smith'] },
    { id: 'tailoring', name: 'Tailoring', attr: 'grace', key: false, work: ['tailor'] },
    { id: 'cooking', name: 'Cooking', attr: 'wits', key: false, work: ['cook'] },
    { id: 'growing', name: 'Growing', attr: 'wits', key: false, work: ['grow', 'chop'] },
    { id: 'animals', name: 'Animals', attr: 'wits', key: false, work: ['animals'] },
    { id: 'medicine', name: 'Medicine', attr: 'wits', key: true, work: ['care'] },
    { id: 'melee', name: 'Melee', attr: 'might', key: true, work: [] },
    { id: 'archery', name: 'Archery', attr: 'grace', key: true, work: [] },
    { id: 'social', name: 'Social', attr: 'wits', key: false, work: ['care'] },
    { id: 'lore', name: 'Lore', attr: 'wits', key: false, work: ['lore'] },
    { id: 'art', name: 'Art', attr: 'grace', key: false, work: ['art'] },
  ],
};
