// Ember-touched demand tables (doc 4.5). OWNER F. One row per skill and tier: `mats` are the
// ordinary materials (2-3 are rolled from them), `deep` the "from the deep" options (one is rolled,
// preferring what the map holds deeper than anything mined so far). Keys are item kinds or
// 'kind:material' (C11 stock). Counts are the full demand.
export const DATA = {
  emberDemand: [
    { id: 'smithing_camp', skill: 'smithing', tier: 'camp', mats: { 'ingot:iron': 20, coal: 10, 'ingot:copper': 10 }, deep: { 'ingot:silver': 5, cutgem: 1 } },
    { id: 'smithing_hamlet', skill: 'smithing', tier: 'hamlet', mats: { 'ingot:iron': 30, charcoal: 20, ironbands: 4 }, deep: { 'ingot:silver': 8, 'block:duskstone': 10, cutgem: 2 } },
    { id: 'smithing_village', skill: 'smithing', tier: 'village', mats: { 'ingot:steel': 15, 'ingot:iron': 20, leather: 6 }, deep: { 'ingot:gold': 5, 'gem:heartstone': 1, cutgem: 3 } },
    { id: 'masonry_camp', skill: 'masonry', tier: 'camp', mats: { 'block:granite': 40, 'block:marble': 20, wood: 20 }, deep: { 'ingot:iron': 5, cutgem: 1 } },
    { id: 'masonry_hamlet', skill: 'masonry', tier: 'hamlet', mats: { 'block:marble': 40, 'block:slate': 30, ironbands: 2 }, deep: { 'block:duskstone': 20, cutgem: 2 } },
    { id: 'masonry_village', skill: 'masonry', tier: 'village', mats: { 'block:marble': 60, 'block:basalt': 40, 'ingot:iron': 10 }, deep: { 'block:duskstone': 30, 'gem:heartstone': 1 } },
    { id: 'woodcraft_camp', skill: 'woodcraft', tier: 'camp', mats: { wood: 60, leather: 4, 'ingot:copper': 4 }, deep: { 'ingot:iron': 6, cutgem: 1 } },
    { id: 'woodcraft_hamlet', skill: 'woodcraft', tier: 'hamlet', mats: { 'wood:elderwood': 30, wood: 40, beeswax: 4 }, deep: { 'ingot:silver': 4, cutgem: 1 } },
    { id: 'woodcraft_village', skill: 'woodcraft', tier: 'village', mats: { 'wood:elderwood': 50, ironbands: 4, cloth: 10 }, deep: { 'ingot:gold': 3, 'block:duskstone': 10 } },
    { id: 'tailoring_camp', skill: 'tailoring', tier: 'camp', mats: { cloth: 20, leather: 10, hide: 4 }, deep: { 'ingot:silver': 2, cutgem: 1 } },
    { id: 'tailoring_hamlet', skill: 'tailoring', tier: 'hamlet', mats: { 'cloth:wool': 30, 'leather:fur': 10, flax: 20 }, deep: { 'ingot:silver': 4, cutgem: 2 } },
    { id: 'tailoring_village', skill: 'tailoring', tier: 'village', mats: { 'cloth:wool': 40, 'leather:fur': 20, beeswax: 6 }, deep: { 'ingot:gold': 3, 'gem:heartstone': 1 } },
    { id: 'art_camp', skill: 'art', tier: 'camp', mats: { 'block:marble': 20, wood: 20, clay: 20 }, deep: { cutgem: 1, 'ingot:silver': 3 } },
    { id: 'art_hamlet', skill: 'art', tier: 'hamlet', mats: { 'block:marble': 40, glass: 10, 'ingot:copper': 10 }, deep: { cutgem: 2, 'block:duskstone': 10 } },
    { id: 'art_village', skill: 'art', tier: 'village', mats: { 'block:marble': 60, glass: 20, 'ingot:gold': 4 }, deep: { 'gem:heartstone': 1, cutgem: 3 } },
    { id: 'cooking_camp', skill: 'cooking', tier: 'camp', mats: { meat: 20, berries: 20, hearthroot: 20 }, deep: { glowcap: 10, honey: 5 } },
    { id: 'cooking_hamlet', skill: 'cooking', tier: 'hamlet', mats: { meat: 30, flour: 20, honey: 10 }, deep: { glowcap: 20, cheese: 10 } },
    { id: 'cooking_village', skill: 'cooking', tier: 'village', mats: { meat: 40, bread: 20, wine: 10 }, deep: { glowcap: 30, 'gem:amber': 1 } },
  ],
};
