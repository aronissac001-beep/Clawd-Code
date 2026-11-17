// ============================================================================
// ZONEFALL 4 — multi-storey monuments, built on the kit's height-aware floors
// (K.floor / K.stairs) and per-level walls (boxes raised above head height only
// block people up there). Stair flights never share a footprint at overlapping
// heights, so going up and coming down are never ambiguous.
// ============================================================================
const PI = Math.PI, Q = PI / 2;

/** invisible collider (the trick: a box whose mesh is dropped) */
function block(K, x, z, w, d, h, o = {}) { const m = K.box(x, z, w, d, h, 'concrete', o); if (m) m.removeFromParent(); return m; }
/** a wall run along x or z with gaps [[a0, a1], ...] measured along the run; y = the storey's floor height */
function wallRun(K, axis, fixed, from, to, y, h, surf, gaps = [], t = 0.3) {
  const cuts = [[from, from]].concat(gaps.slice().sort((a, b) => a[0] - b[0])).concat([[to, to]]);
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i][1], b = cuts[i + 1][0]; if (b - a < 0.05) continue;
    const mid = (a + b) / 2, len = b - a;
    if (axis === 'x') K.box(mid, fixed, len, t, h, surf, { y }); else K.box(fixed, mid, t, len, h, surf, { y });
  }
  // lintels over door gaps on this storey (visual only)
  for (const [a, b] of gaps) if (b - a < 3.2 && h > 2.6) { const mid = (a + b) / 2; if (axis === 'x') K.box(mid, fixed, b - a, t, 0.5, surf, { y: y + h - 0.5, collide: false }); else K.box(fixed, mid, t, b - a, 0.5, surf, { y: y + h - 0.5, collide: false }); }
}
const F1 = 3.4, F2 = 6.8, ROOF = 10.2, STOREY = 3.2;

// ============================================================================
// APARTMENT BLOCK — three storeys and a roof. Outside stair to a first-floor
// landing, an inside flight up the west side to the second floor, another up
// the east side to the roof (sandbagged sniper nest). Scavs below, bandits above.
// Footprint: x -8..8, z -6..6 (+ the outside stair to x 9.7).
// ============================================================================
function apartments(K) {
  K.label('Apartment Block');
  K.ground(0, 0, 30, 26, 'asphalt', { y: 0.02 });
  K.ground(0, 0, 17, 13, 'concrete_dark', { y: 0.035 });
  const wall = 'concrete', wall2 = 'brick', trim = 'concrete_dark';
  // ---- ground floor: north door, windows; a partition with a doorway
  wallRun(K, 'x', -6, -8, 8, 0, F1, wall, [[-3.2, -1.2], [3, 4.6]]);
  wallRun(K, 'x', 6, -8, 8, 0, F1, wall, [[-5, -3.4], [1.5, 3.1]]);
  wallRun(K, 'z', -8, -6, 6, 0, F1, wall, [[-1.5, 0.3]]);
  wallRun(K, 'z', 8, -6, 6, 0, F1, wall, []);
  wallRun(K, 'z', 1, -6, 6, 0, F1 - 0.1, wall2, [[-1.8, 0], [3.5, 6]], 0.2);
  K.prop('shelf', -6.8, 4.9, 0); K.prop('desk', 4.5, -4.8, 0); K.prop('pallets', -5.5, -4.6, 0);
  K.container('crate', -6.6, -4.6, 0); K.container('locker', 6.9, 4.8, Q); K.container('food', 4.2, 4.9, 0);
  K.npc('scav', -3.5, 2.5, { patrol: [[-6, 2.5], [-0.5, 2.5]] });
  K.light(-3.5, 0, 3.0, '#ffd8a0', 0.9, 9);
  // ---- outside stair (east), 0 -> F1, rising +z, onto a landing
  K.stairs(8.95, -1.75, 1.4, 6.5, 0, F1, '+z', 'concrete_dark', { side: 'metal_dark' });
  block(K, 9.75, -1.75, 0.15, 6.5, F1 + 1.1);                     // outer handrail, full height of the flight
  K.box(9.75, -1.75, 0.1, 6.5, 0.08, 'metal_dark', { y: F1 * 0.5 + 0.9, collide: false });
  K.floor(8.85, 3.25, 1.9, 3.5, F1, 'metal_dark');                // landing x 7.9..9.8, z 1.5..5
  K.box(9.8, 3.25, 0.12, 3.5, 1.05, 'metal_dark', { y: F1 });       // landing rails
  K.box(8.85, 5.05, 1.9, 0.12, 1.05, 'metal_dark', { y: F1 });
  // ---- first floor (F1): full slab; the east wall opens onto the landing
  K.floor(0, 0, 16.6, 12.6, F1, trim, { t: 0.3 });
  wallRun(K, 'x', -6, -8, 8, F1, STOREY, wall, [[-6, -4.4], [0, 1.6], [4.8, 6.4]]);
  wallRun(K, 'x', 6, -8, 8, F1, STOREY, wall, [[-3.6, -2]]);
  wallRun(K, 'z', -8, -6, 6, F1, STOREY, wall, [[-4.8, -3.2]]);
  wallRun(K, 'z', 8, -6, 6, F1, STOREY, wall, [[1.6, 4.9], [-4.8, -3.4]]);
  wallRun(K, 'x', 0, -5.9, 2, F1, STOREY - 0.1, wall2, [[-1.4, 0.2]], 0.2);   // flats: a partition with a doorway
  K.prop('table', 3.2, -3, 0); K.prop('bench', 3.2, -3.9, 0);
  K.container('crate', 6.9, -5, Q, { y: F1 }); K.container('medbox', -4.5, -5.1, 0, { y: F1 }); K.container('toolbox', 2.2, 5.0, 0, { y: F1 });
  K.npc('bandit', 3.5, 2.5, { y: F1, patrol: [[1.5, 2.5], [6, 2.5]] });
  K.light(2, 0, F1 + 2.8, '#ffd8a0', 0.8, 9);
  // ---- inside flight up the west side: F1 -> F2, rising -z (enter at the north end)
  K.stairs(-7.2, 0.75, 1.4, 6.5, F1, F2, '-z', 'concrete_dark', { side: 'metal_dark' });
  K.box(-6.4, 0.25, 0.15, 5.5, STOREY + 0.2, 'concrete_dark', { y: F1 });   // stairwell wall on floor 1 (open at z 3..4)
  // ---- second floor (F2): slab with the stairwell hole on the west, collapsed north-east corner
  K.floor(0.8, 0, 14.4, 12.6, F2, trim, { t: 0.3 });                // x -6.4..8
  K.floor(-7.2, -4.3, 1.6, 3.6, F2, trim, { t: 0.3 });              // landing at the top of the flight (x -8..-6.4, z -6..-2.5)
  K.box(-6.4, 1.75, 0.12, 8.5, 1.05, 'metal_dark', { y: F2 });       // rail round the stairwell hole
  wallRun(K, 'x', -6, -8, 8, F2, STOREY, wall, [[-2, -0.4], [3.4, 5]]);
  wallRun(K, 'x', 6, -8, 3, F2, STOREY, wall, [[-5.2, -3.6]]);       // north-east corner has fallen away (x 3..8)
  wallRun(K, 'z', -8, -6, 6, F2, STOREY, wall, [[0.6, 2.2]]);
  wallRun(K, 'z', 8, -6, 3, F2, STOREY, wall, [[-1.2, 0.4]]);
  K.box(5.5, 6, 5, 0.3, 1.0, wall, { y: F2 });                         // broken low wall along the collapse
  K.box(8, 4.5, 0.3, 3, 1.0, wall, { y: F2 });
  K.prop('pallets', -2.5, 4.4, 0); K.prop('shelf', 1, -5.2, 0);
  K.container('military', -4.5, -4.9, 0, { y: F2 }); K.container('ammobox', 1.8, 4.9, 0, { y: F2 }); K.container('crate', -2, 0.5, Q, { y: F2 });
  K.npc('bandit', -1, -2, { y: F2, patrol: [[-4, -2], [4, -2]] });
  K.light(0, 0, F2 + 2.8, '#ffd8a0', 0.7, 9);
  // ---- inside flight up the east side: F2 -> roof, rising +z (enter at the south end)
  K.stairs(7.2, -0.75, 1.4, 6.5, F2, ROOF, '+z', 'concrete_dark', { side: 'metal_dark' });
  K.box(6.4, -0.25, 0.15, 5.5, STOREY + 0.2, 'concrete_dark', { y: F2 });  // stairwell wall on floor 2 (open at z -4..-3)
  // ---- roof: parapet, stairwell hole on the east, water tanks, an antenna and a sniper nest
  K.floor(-0.8, 0, 14.4, 12.6, ROOF, 'concrete', { t: 0.3 });       // x -8..6.4
  K.floor(7.2, 4.3, 1.6, 3.6, ROOF, 'concrete', { t: 0.3 });         // x 6.4..8, z 2.5..6 (top landing)
  K.box(6.4, -1.75, 0.12, 8.5, 1.05, 'metal_dark', { y: ROOF });     // rail round the hole
  for (const [x, z, w, d] of [[0, -6.2, 16.6, 0.3], [0, 6.2, 16.6, 0.3], [-8.2, 0, 0.3, 12.6], [8.2, 0, 0.3, 12.6]]) K.box(x, z, w, d, 1.0, trim, { y: ROOF });
  K.cyl(-5, -3.5, 1.1, 2.4, 'metal', { y: ROOF }); K.cyl(-5, 3.5, 1.1, 2.4, 'metal', { y: ROOF });
  K.box(-1, 3.8, 1.2, 1.2, 0.9, 'metal_dark', { y: ROOF });          // air vent
  for (const [x, z, w, d] of [[2.6, -3.2, 2.6, 0.5], [3.7, -2.1, 0.5, 2.6], [1.3, -2.1, 0.5, 2.6]]) K.box(x, z, w, d, 0.85, 'plank_dark', { y: ROOF }); // sandbag nest (planks + bags)
  K.container('elite', 2.6, -2.2, 0, { y: ROOF }); K.container('ammobox', 0.4, 0.8, 0, { y: ROOF });
  K.npc('bandit', 2.6, -0.8, { y: ROOF, guard: false });
  K.light(2.6, -2.2, ROOF + 2.2, '#ffcf8a', 0.8, 8);
  // ---- surroundings: wrecks, rubble, fences
  K.prop('car', -12, 7.5, 0.3); K.prop('car', 12.5, -8, PI + 0.2); K.prop('barrier', -12, -8, Q); K.prop('tires', 11.5, 8.5, 0);
  for (const [x, z] of [[-10, 2], [10.5, 6.5], [-6, 9.5], [4, 9.5]]) K.box(x, z, 1.6, 1.2, 0.6, 'concrete_dark');
  K.container('barrel', 11, 2.5); K.container('barrel', -11, -3); K.container('barrel', 6, 9.2);
  K.prop('lamp', -10.5, -10, 0); K.prop('lamp', 10.5, 10, PI);
}

export const TALL_LAYOUTS = { apartments };
export const TALL_MONUMENTS = {
  apartments: { name: 'Apartment Block', tier: 1, count: 3, size: 22, late: true, desc: 'A ruined three-storey block. Stairs to every floor and a sniper nest on the roof.' },
};
