// Skill perks: key skills at 10 and 20, signature perks at 15 (doc 8.1). OWNER F.
// Stage 0 placeholder written by workstream G so every 13.4 file exists and validate-data checks
// the C11 schema end to end. The owner replaces these sample entries freely (keep export DATA).
export const DATA = {
  perk: [
    { id: 'cave_sense', skill: 'mining', lvl: 10, name: 'Cave Sense', text: 'Sees crack overlays 2 hours before a cave-in.', grants: { rule: 'caveSense' }, mods: [] },
    { id: 'seam_follower', skill: 'mining', lvl: 10, name: 'Seam Follower', text: 'Mining one vein tile makes the whole connected vein known.', grants: { rule: 'seamFollower' }, mods: [] },
    { id: 'stone_carver', skill: 'masonry', lvl: 15, name: 'Stone Carver', text: 'Carves furniture in place from the rock of a carved room.', grants: { rule: 'stoneCarver' }, mods: [] },
  ],
};
