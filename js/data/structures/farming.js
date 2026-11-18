// Structure defs (doc 7.1 schema; owner G). size [w, h] in tiles; cost is per tile for walls and
// floors, otherwise per structure; work is game minutes at speed 1.0 x the material work percent.
// art is a key in the art registry (D, js/engine/art/keys.js). stage: the build stage that
// introduces the def (schema STAGES; menus show availableIn(def, stage)).
// Stage 2 (7.5, Camp to Village; the greenhouse and silk frame are Hold tier, Stage 3). Animal
// buildings name their capacity in cap (K's pens and herds read it). Fences are walls to animals
// only: colonists pass the fence gate, animals do not.
export const DATA = {
  structure: [
    { id: 'growzone', name: 'Growing zone', cat: 'farming', kind: 'zone', size: [1, 1], tier: 'camp', art: 'overlay.growzone', stage: '1b',
      text: 'Pick a crop; growers sow and harvest it.' },
    { id: 'farm', name: 'Tilled field', cat: 'farming', kind: 'construct', size: [4, 4], cost: { wood: 10 }, work: 60, tier: 'camp',
      mods: [{ key: 'yield.crop', op: 'pct', value: 20 }], art: 'struct.farm', stage: '2', text: 'A growing zone on better soil (+20% fertility), with a scarecrow post.' },
    // ---- Stage 2 ----
    { id: 'scarecrow', name: 'Scarecrow', cat: 'farming', kind: 'construct', size: [1, 1], cost: { wood: 10, cloth: 4 }, work: 20, hp: 50, tier: 'camp',
      flags: ['flammable'], mods: [{ key: 'yield.loss', op: 'pct', value: -50, when: 'near' }], art: 'farm', stage: '2', text: 'Crops within 6 tiles lose half as much to blight and birds.' },
    { id: 'fisher', name: 'Fisher\'s hut', cat: 'farming', kind: 'construct', size: [2, 2], cost: { wood: 50 }, work: 120, hp: 250, tier: 'camp', tech: 'hunting', needs: ['shore'],
      workbench: { workType: 'cook', workplace: true }, flags: ['flammable'], art: 'farm', stage: '2',
      text: 'A Cook catches a fish every 30 minutes here. Two huts within 8 tiles share the catch.' },
    { id: 'planter', name: 'Planter box', cat: 'farming', kind: 'construct', size: [1, 1], cost: { wood: 15 }, work: 20, hp: 60, tier: 'hamlet', beauty: 4,
      flags: ['flammable'], art: 'farm', stage: '2', text: 'Flowers (beauty) or herbs, indoors or out.' },
    { id: 'mushbed', name: 'Mushroom bed', cat: 'farming', kind: 'construct', size: [2, 2], cost: { wood: 20, block: 10 }, work: 60, tier: 'hamlet', needs: ['underground'],
      mods: [{ key: 'yield.glowcap', op: 'pct', value: 30 }], art: 'farm', stage: '2', text: 'Glowcap in the dark underground, a third more each harvest.' },
    { id: 'compost', name: 'Compost heap', cat: 'farming', kind: 'construct', size: [1, 1], cost: { wood: 10 }, work: 20, tier: 'hamlet', beauty: -1,
      mods: [{ key: 'yield.crop', op: 'pct', value: 20, when: 'near' }], art: 'farm', stage: '2', text: 'Spoilt food becomes compost: +20% fertility on a 5 x 5 patch.' },
    { id: 'pen', name: 'Animal pen', cat: 'farming', kind: 'zone', size: [1, 1], tier: 'hamlet', tech: 'husbandry', flags: ['pen'], art: 'overlay.growzone', stage: '2',
      text: 'Penned animals graze and stay inside. Fence it in.' },
    { id: 'fence', name: 'Fence', cat: 'farming', kind: 'construct', size: [1, 1], cost: { wood: 2 }, work: 6, hp: 60, tier: 'hamlet', tech: 'husbandry',
      flags: ['fence', 'flammable'], art: 'wall', stage: '2', text: 'Keeps animals in. Colonists climb it slowly.' },
    { id: 'fencegate', name: 'Fence gate', cat: 'farming', kind: 'construct', size: [1, 1], cost: { wood: 6 }, work: 10, hp: 60, tier: 'hamlet', tech: 'husbandry',
      flags: ['door', 'fence', 'flammable'], art: 'gate', stage: '2', text: 'Colonists pass; animals do not.' },
    { id: 'coop', name: 'Hen coop', cat: 'farming', kind: 'construct', size: [2, 2], cost: { wood: 40 }, work: 90, hp: 150, tier: 'hamlet', tech: 'husbandry', cap: 6,
      flags: ['flammable'], art: 'house', stage: '2', text: 'Six hens roost and lay here.' },
    { id: 'trough', name: 'Feed trough', cat: 'farming', kind: 'construct', size: [2, 1], cost: { wood: 20 }, work: 30, hp: 80, tier: 'hamlet', tech: 'husbandry',
      flags: ['storage', 'flammable'], store: { stacks: 2, cats: ['animal', 'rawfood'] }, art: 'crate', stage: '2', text: 'Haulers fill it with hay; penned animals eat from it in winter.' },
    { id: 'huntstand', name: 'Hunter\'s lodge', cat: 'farming', kind: 'construct', size: [2, 2], cost: { wood: 60 }, work: 150, hp: 250, tier: 'hamlet', tech: 'hunting',
      workbench: { workType: 'animals', workplace: true }, flags: ['flammable'], mods: [{ key: 'work.hunt', op: 'pct', value: 20, when: 'near' }], art: 'house', stage: '2',
      text: 'Hunters rest and store pelts here, and range further from it.' },
    { id: 'barn', name: 'Barn', cat: 'farming', kind: 'construct', size: [4, 3], cost: { wood: 140, block: 20 }, work: 480, hp: 800, tier: 'village', tech: 'husbandry', cap: 8,
      flags: ['shell', 'flammable', 'storage'], store: { stacks: 6, cats: ['animal'] }, art: 'house', stage: '2', text: 'Winter housing for 8 animals, with hay storage.' },
    { id: 'beehive', name: 'Beehive', cat: 'farming', kind: 'construct', size: [1, 1], cost: { wood: 20 }, work: 40, hp: 40, tier: 'village', tech: 'husbandry',
      flags: ['flammable'], art: 'farm', stage: '2', text: 'Honey and beeswax, if flowers grow within 8 tiles.' },
  ],
};
