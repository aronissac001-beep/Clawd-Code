// Work types (doc 5.1; owner G). Fixed order = core WORK_IDS (the tie-break inside one priority).
// givers name the work-giver modules in js/game/work/givers/ (E; animals.js is K's).
export const DATA = {
  worktype: [
    { id: 'care', name: 'Care', skills: ['medicine', 'social'], givers: ['care'], text: 'Tend, rescue, feed patients, prisoners, talk down breaks.' },
    { id: 'animals', name: 'Animals', skills: ['animals'], givers: ['animals'], text: 'Hunt, tame, train, milk, shear, slaughter.' },
    { id: 'cook', name: 'Cook', skills: ['cooking'], givers: ['cook'], text: 'Kitchens, butcher, smokehouse, brewing and milling.' },
    { id: 'build', name: 'Build', skills: ['construction'], givers: ['build'], text: 'Construct, repair, deconstruct, roof, install furniture.' },
    { id: 'grow', name: 'Grow', skills: ['growing'], givers: ['grow'], text: 'Sow, harvest crops, tend beehives.' },
    { id: 'mine', name: 'Mine', skills: ['mining'], givers: ['mine'], text: 'Mine and prospect.' },
    { id: 'chop', name: 'Chop', skills: ['growing'], givers: ['chop'], text: 'Chop trees, gather wild plants.' },
    { id: 'smith', name: 'Smith', skills: ['smithing'], givers: ['smith'], text: 'Bloomery, furnace, forge, mint.' },
    { id: 'craft', name: 'Craft', skills: ['woodcraft', 'masonry'], givers: ['craft'], text: 'Carpenter, mason, potter, glass, fletcher, smoothing.' },
    { id: 'tailor', name: 'Tailor', skills: ['tailoring'], givers: ['tailor'], text: 'Tannery, loom, tailor.' },
    { id: 'art', name: 'Art', skills: ['art'], givers: ['art'], text: 'Sculpt, engrave, jeweller.' },
    { id: 'lore', name: 'Lore', skills: ['lore'], givers: ['lore'], text: 'Research, survey table, runes.' },
    { id: 'haul', name: 'Haul', skills: [], givers: ['haul', 'clean', 'refuel'], text: 'Haul to stockpiles, refuel lights and the Hearth, load workshops, clean.' },
  ],
};
