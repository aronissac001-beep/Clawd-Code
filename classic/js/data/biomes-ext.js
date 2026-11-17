// Phase 3 biomes: the lands of Act II and Act III. Same fields as
// BIOMES.greenvale (mapgen.js reads forestDensity, rockClusters, cragAmount
// and river; the renderer reads the palette). register() merges them into BIOMES.
import { BIOMES } from './biomes.js';

export const EXTRA_BIOMES = {
  // Act II: an ancient, half-drowned forest where the Bone Colossus walks.
  elderwood: {
    id: 'elderwood', name: 'The Elderwood',
    desc: 'Ancient moss-hung forest, older than the crown. Fog lies on its black pools, and the trees are close.',
    grass: ['#3f6337', '#466b3b', '#395a31', '#4d7441'],
    meadow: '#4b7040', dirt: '#6a5338', sand: '#8f8a66', water: '#4d6f80', waterDeep: '#3a5869', crag: '#545a52', cragTop: '#6f776b',
    treeLeaf: ['#2a4d27', '#335a2c', '#244222'], treeDark: '#172e17', pine: ['#1f3f2a', '#28503a'],
    flowers: ['#a8c27a', '#7fae9e', '#c8c4a8', '#8fa0c8'],
    forestDensity: 0.8, rockClusters: 9, cragAmount: 0.82, river: true,
  },
  // Act III: the Ashen Throne. Grey ash over cooling stone, ember cracks and a river of fire.
  ashlands: {
    id: 'ashlands', name: 'The Ashlands',
    desc: 'Ash drifts over black crag and cooling cinders. A slow river of fire crawls through the waste; nothing crosses it but the fords.',
    grass: ['#6b625a', '#726861', '#635a53', '#7a7067'],
    meadow: '#5e5249', dirt: '#4f4038', sand: '#8a7a6a', water: '#a2401c', waterDeep: '#e0742a', crag: '#2f2b2c', cragTop: '#4a4446',
    treeLeaf: ['#4a3f38', '#55483f', '#3d3530'], treeDark: '#2a2420', pine: ['#3b3430', '#463d38'],
    flowers: ['#ff8a3a', '#ffb347', '#e05a2a', '#ffd27a'],
    forestDensity: 0.5, rockClusters: 7, cragAmount: 0.73, river: true,
  },
};

let done = false;
export function registerBiomes() {
  if (done) return;
  done = true;
  Object.assign(BIOMES, EXTRA_BIOMES);
}
export { registerBiomes as register };
