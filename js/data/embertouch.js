// Ember-touched demand tables (doc 4.5). OWNER F. One row per skill and tier: `mats` are the
// ordinary materials (2-3 are rolled from them), `deep` the "from the deep" options (one is rolled,
// preferring what the map holds deeper than anything mined so far). Keys are item kinds or
// 'kind:material' (C11 stock). Counts are the full demand.
export const DATA = {
  emberDemand: [
    // Z2 (3.3): every row is something a hold of that rank can supply in the deadline. The ordinary materials are
    // generic (any metal's ingots, any stone's blocks: a map need not hold granite, marble or copper), cloth only
    // from the Hearth era (weaving), and the "from the deep" options at Camp and Hamlet are raw ore and rough gems
    // dug from the rock above the deep levels (deepHeld prefers the ones the map still holds), not cut gems or silver ingots, whose techs
    // (Jewellery, Prospecting) open only with the Hold era; a Village (the Hold era) may be asked for silver ore from the
    // deep bands, or duskstone among rough gems. A cook asks
    // for meals in store, not raw meat the kitchen eats as fast as the hunters bring it.
    { id: 'smithing_camp', skill: 'smithing', tier: 'camp', mats: { ingot: 12, wood: 20, block: 12 }, deep: { 'ore:iron': 10, 'ore:copper': 10, 'gem:amber': 2, 'gem:garnet': 1 } },
    { id: 'smithing_hamlet', skill: 'smithing', tier: 'hamlet', mats: { ingot: 20, charcoal: 10, ironbands: 2 }, deep: { 'ore:tin': 6, 'gem:amber': 3, 'gem:garnet': 2, 'ore:iron': 15 } },
    { id: 'smithing_village', skill: 'smithing', tier: 'village', mats: { ingot: 30, charcoal: 20, leather: 6 }, deep: { 'ore:silver': 8, 'gem:garnet': 3, 'gem:amber': 4 } },
    { id: 'masonry_camp', skill: 'masonry', tier: 'camp', mats: { block: 30, wood: 20, ingot: 4 }, deep: { 'ore:iron': 6, 'gem:amber': 2, 'gem:garnet': 1, 'ore:copper': 6 } },
    { id: 'masonry_hamlet', skill: 'masonry', tier: 'hamlet', mats: { block: 50, wood: 30, ironbands: 2 }, deep: { 'gem:amber': 3, 'gem:garnet': 2, 'ore:tin': 6, 'ore:iron': 10 } },
    { id: 'masonry_village', skill: 'masonry', tier: 'village', mats: { block: 80, ingot: 10, ironbands: 4 }, deep: { 'block:duskstone': 20, 'gem:garnet': 3, 'ore:silver': 8 } },
    { id: 'woodcraft_camp', skill: 'woodcraft', tier: 'camp', mats: { wood: 50, leather: 4, block: 10 }, deep: { 'ore:iron': 6, 'gem:amber': 1, 'ore:copper': 6 } },
    { id: 'woodcraft_hamlet', skill: 'woodcraft', tier: 'hamlet', mats: { wood: 70, leather: 6, ingot: 6 }, deep: { 'ore:tin': 4, 'gem:garnet': 1, 'ore:iron': 10 } },
    { id: 'woodcraft_village', skill: 'woodcraft', tier: 'village', mats: { wood: 100, ironbands: 4, leather: 10 }, deep: { 'ore:silver': 6, 'gem:garnet': 2, 'gem:amber': 4 } },
    { id: 'tailoring_camp', skill: 'tailoring', tier: 'camp', mats: { leather: 10, hide: 4, wood: 10 }, deep: { 'ore:copper': 4, 'gem:amber': 1, 'ore:iron': 4 } },
    { id: 'tailoring_hamlet', skill: 'tailoring', tier: 'hamlet', mats: { cloth: 20, leather: 12, hide: 4 }, deep: { 'ore:tin': 4, 'gem:garnet': 2, 'ore:iron': 6 } },
    { id: 'tailoring_village', skill: 'tailoring', tier: 'village', mats: { cloth: 30, leather: 20, wood: 30 }, deep: { 'ore:silver': 6, 'gem:garnet': 2, 'gem:amber': 4 } },
    { id: 'art_camp', skill: 'art', tier: 'camp', mats: { block: 20, wood: 20, bone: 6 }, deep: { 'gem:amber': 1, 'ore:copper': 6, 'ore:iron': 6 } },
    { id: 'art_hamlet', skill: 'art', tier: 'hamlet', mats: { block: 40, wood: 30, ingot: 10 }, deep: { 'gem:garnet': 2, 'gem:amber': 3, 'ore:tin': 4 } },
    { id: 'art_village', skill: 'art', tier: 'village', mats: { block: 60, wood: 40, ingot: 10 }, deep: { 'gem:garnet': 3, 'ore:silver': 6, 'gem:amber': 4 } },
    { id: 'cooking_camp', skill: 'cooking', tier: 'camp', mats: { meal: 12, wood: 20, block: 10 }, deep: { glowcap: 10, 'gem:amber': 1 } },
    { id: 'cooking_hamlet', skill: 'cooking', tier: 'hamlet', mats: { meal: 20, wood: 30, block: 20 }, deep: { glowcap: 20, 'gem:garnet': 1 } },
    { id: 'cooking_village', skill: 'cooking', tier: 'village', mats: { meal: 30, wood: 40, block: 30 }, deep: { glowcap: 30, 'gem:amber': 2, 'gem:garnet': 1 } },
  ],
};
