// Animals: farm stock, wild game, beasts and cave creatures (doc 6.5, 9.2; owner G, logic K).
// speed is an integer percent of colonist speed; tame is the Animals level needed to tame;
// pts is the threat cost when the animal comes as a hostile.
export const DATA = {
  animal: [
    { id: 'hen', name: 'Hen', kind: 'farm', hp: 15, speed: 90, size: 1, tame: 0, products: [{ k: 'egg', n: 1, everyD: 1 }], butcher: { meat: 4 }, art: 'animal.hen' },
    { id: 'goat', name: 'Goat', kind: 'farm', hp: 45, speed: 100, size: 2, tame: 2, butcher: { meat: 30 }, art: 'animal.goat' },
    { id: 'wolf', name: 'Wolf', kind: 'beast', hp: 60, speed: 130, size: 2, tame: 8, hostile: true, pts: 25, butcher: { meat: 25 }, art: 'animal.wolf' },
  ],
};
