// Colony charters (doc 8.3; owner G, mechanics K in js/game/colony/charters/<id>.js).
// story bends the storyteller: prefer x3, rare x0.3, and the first major after chartering.
export const DATA = {
  charter: [
    { id: 'forgehold', name: 'Forgehold', theme: 'Smithing and depth',
      mechanic: 'Commissions and artifacts: each season an envoy brings a commission that pays in rare goods, a tech tablet or a colonist.',
      passive: [{ key: 'yield.ore', op: 'add', value: 1 }], structures: ['greatanvil'], wonder: 'worldforge',
      story: { prefer: ['breach', 'sapper'], rare: ['beast'], first: 'sapper_raid' } },
    { id: 'bulwark', name: 'Bulwark', theme: 'Fortress',
      mechanic: 'Garrisons and counter-sallies: soldiers hold a Keep or Gatehouse, and a Sally order strikes the siege engine.',
      passive: [{ key: 'hp.wall', op: 'pct', value: 25 }], structures: ['keep'], wonder: 'bastion',
      story: { prefer: ['siege', 'knight'], rare: ['beast'], first: 'siege' } },
  ],
};
