// Biome palettes and generation weights. Phase 1 ships Greenvale.
export const BIOMES = {
  greenvale: {
    id: 'greenvale', name: 'Greenvale',
    desc: 'Rolling meadows, a slow river and old oak woods.',
    grass: ['#5f8f3e', '#679a43', '#57853a', '#6fa149'],
    meadow: '#7aa852', dirt: '#8a6a43', sand: '#c7b07a', water: '#3c6f8f', waterDeep: '#2f5a78', crag: '#6c6a66', cragTop: '#8a8781',
    treeLeaf: ['#3f6f2c', '#4b7d33', '#366327'], treeDark: '#2a4f20', pine: ['#2f5a36', '#386a3e'],
    flowers: ['#f2d36b', '#e88aa0', '#f4f1e6', '#b8a2e8'],
    forestDensity: 0.62, rockClusters: 5, cragAmount: 0.78, river: true,
  },
  // Land the Hollowing has already touched: drained colour, broken stone, sparse trees.
  ruins: {
    id: 'ruins', name: 'Hollowed Ruins',
    desc: 'Grey fields where the old empire fell. Colour returns only where your fire burns.',
    grass: ['#6f7a5c', '#76805f', '#687155', '#7d8664'],
    meadow: '#858d6c', dirt: '#7a6a58', sand: '#a9a088', water: '#4b5f72', waterDeep: '#3d4f61', crag: '#5f5b62', cragTop: '#7a7580',
    treeLeaf: ['#4f5e3e', '#5a6845', '#465338'], treeDark: '#36412c', pine: ['#3e4f40', '#465a47'],
    flowers: ['#b8a2e8', '#cfc6b8', '#9a8fb8', '#d8cfa8'],
    forestDensity: 0.45, rockClusters: 7, cragAmount: 0.7, river: false,
  },
};
