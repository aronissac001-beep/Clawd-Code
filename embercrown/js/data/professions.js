// Professions: titles derived from skills (doc 8.1). OWNER F. A colonist's profession is the highest
// skill at level 6+ among the work types they have at priority 1 (ties: more XP); `work` limits a
// profession to colonists doing that work (Hunter: Archery with Animals work), `soldier` to soldiers.
// look: the Master look (D's art keys); professions without one draw the plain colonist until D adds
// look.builder, look.mason, look.carpenter, look.tailor, look.cook, look.grower, look.herder, look.hunter,
// look.scholar, look.artisan, look.envoy and look.soldier.
export const DATA = {
  profession: [
    { id: 'miner', name: 'Miner', skill: 'mining', look: 'look.miner' },
    { id: 'builder', name: 'Builder', skill: 'construction' },
    { id: 'mason', name: 'Mason', skill: 'masonry' },
    { id: 'smith', name: 'Smith', skill: 'smithing', look: 'look.runesmith' },
    { id: 'carpenter', name: 'Carpenter', skill: 'woodcraft' },
    { id: 'tailor', name: 'Tailor', skill: 'tailoring' },
    { id: 'cook', name: 'Cook', skill: 'cooking' },
    { id: 'grower', name: 'Grower', skill: 'growing' },
    { id: 'herder', name: 'Herder', skill: 'animals' },
    { id: 'hunter', name: 'Hunter', skill: 'archery' },
    { id: 'doctor', name: 'Doctor', skill: 'medicine', look: 'look.cleric' },
    { id: 'scholar', name: 'Scholar', skill: 'lore' },
    { id: 'artisan', name: 'Artisan', skill: 'art' },
    { id: 'envoy', name: 'Envoy', skill: 'social' },
    { id: 'soldier', name: 'Soldier', skill: 'melee' },
  ],
};
/** Profession rules beyond the schema fields (8.1): which work or duty a title needs. */
export const PROFESSION_RULES = Object.freeze({
  hunter: { work: 'animals' }, soldier: { soldier: true, skills: ['melee', 'archery'] }, envoy: { work: 'care' },
});
