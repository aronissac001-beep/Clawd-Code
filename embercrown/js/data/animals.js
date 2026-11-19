// Animals: farm stock, wild game, beasts and cave creatures (doc 6.5, 9.2; owner G, logic K).
// speed is an integer percent of colonist speed; tame is the Animals level needed to tame;
// pts is the threat cost when the animal comes as a hostile.
// Stage 2 (14.8 rows G and K): the farm four (hen, goat, sheep, ox), game (deer, hare, boar), the
// wolf, and the cave beetle and spider. Art: animal.<id> keys from D; until D registers one, a
// registered look stands in (sheep and ox the goat, boar the wolf...).
export const DATA = {
  animal: [
    { id: 'hen', name: 'Hen', kind: 'farm', hp: 15, speed: 90, size: 1, tame: 0, products: [{ k: 'egg', n: 1, everyD: 1 }], butcher: { meat: 4, bone: 1 }, art: 'animal.hen' },
    { id: 'goat', name: 'Goat', kind: 'farm', hp: 45, speed: 100, size: 2, tame: 2, products: [{ k: 'milk', n: 8, everyD: 1 }], butcher: { meat: 30, hide: 1, bone: 4, tallow: 2 }, art: 'animal.goat' },
    { id: 'wolf', name: 'Wolf', kind: 'beast', hp: 60, speed: 130, size: 2, tame: 8, hostile: true, pts: 25, butcher: { meat: 25, pelt: 1, bone: 4 }, art: 'animal.wolf' },
    // ---- Stage 2 ----
    { id: 'sheep', name: 'Sheep', kind: 'farm', hp: 40, speed: 90, size: 2, tame: 2, products: [{ k: 'wool', n: 20, everyD: 10 }], butcher: { meat: 30, hide: 1, bone: 4, tallow: 3 }, art: 'animal.goat' },
    { id: 'ox', name: 'Ox', kind: 'farm', hp: 120, speed: 80, size: 3, tame: 5, butcher: { meat: 80, hide: 2, bone: 10, tallow: 6 }, art: 'animal.goat' },
    { id: 'deer', name: 'Deer', kind: 'wild', hp: 50, speed: 140, size: 2, butcher: { meat: 40, pelt: 1, bone: 5, tallow: 2 }, art: 'animal.goat' },
    { id: 'hare', name: 'Hare', kind: 'wild', hp: 10, speed: 150, size: 1, butcher: { meat: 5, pelt: 1 }, art: 'animal.hen' },
    { id: 'boar', name: 'Boar', kind: 'wild', hp: 80, speed: 110, size: 2, tame: 10, pts: 20, butcher: { meat: 45, pelt: 1, bone: 5, tallow: 4 }, art: 'animal.wolf' },
    { id: 'beetle', name: 'Cave beetle', kind: 'cave', hp: 25, speed: 80, size: 1, butcher: { meat: 8, bone: 2 }, art: 'animal.hen' },
    { id: 'spider', name: 'Cave spider', kind: 'cave', hp: 55, speed: 120, size: 2, tame: 12, hostile: true, pts: 30, butcher: { meat: 10 }, art: 'animal.wolf' },
  ],
};
