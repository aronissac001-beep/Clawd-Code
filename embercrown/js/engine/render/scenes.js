// Debug scenes for the renderer (owner C; doc 14.5 row C and the device spike S1, S2).
//   ?debug=1&scene=flat        the roguelite drawing on a flat colony test map (grass, meadow, dirt,
//                              sand, a pond, surface crags, trees, the old building and villager art)
//                              &time=night shows the night grade with the hearth and brazier pools
//   ?debug=1&scene=spike-map   S1: a 128 map (B's stub 'bench': massif, tunnels, halls, river);
//                              &auto=1 runs the scripted pan through all three bands for &secs=300
//   ?debug=1&scene=tunnels     S2: a carved tunnel map with sconces; &ppt=2|4 &smooth=1|0 &zoom=0.75
//                              &check=1 measures light through a 1-tile rock wall
//   ?debug=1&scene=raid        Stage 1b (14.7 row C): a night raid in tunnels, 3 drafted colonists and 8
//                              Hollow (husks and gloom hounds) at a carved hall with braziers, the next
//                              threat's edge marker and route preview; &check=1 measures the frame rate
//                              with combat on screen, frame times, held chunks, blank rects and the
//                              strategic raid blob (hook.result)
//   ?debug=1&scene=hold        Stage 2 (14.8 row C): the budget scene: 30 colonists, 40 hostiles, 10 animals,
//                              24 burning tiles with smoke, the 8 crops in 4 stages, rooms outlined by role,
//                              &wx=clear|rain|snow|coldsnap|drought (default rain) &season=0-3 (default 2)
//                              &time=day|night; &check=1 measures frame times with everything on screen
// Common: &zoom=<z> &x=<tile> &y=<tile> &chunks=1 (chunk borders) &zones=1.
// bootScene() is exported for js/main.js (owner A), which calls it when ?debug=1&scene= is set:
//   if (app.debug && params.get('scene')) import('./engine/render/scenes.js').then((m) => m.bootScene(params.get('scene'), params));
// window.__ecRender = { renderer, camera, loop, state, stats(), result } is the Playwright hook.
//
// A scene builds its own throwaway state (like a test fixture) and stands in for the sim: it writes
// s.L, s.rt.light (only when B's light rebuild is not registered yet) and moves colonists. Nothing
// here is imported by js/game/, and no game state built here is ever saved.

import { TILE, TER, ROOF, DESIG, W, H, N, setBit, getBit, TER_OPAQUE } from '../../game/core/grid.js';
import { createColony, initRuntime } from '../../game/core/state.js';
import { newBuilding, newColonist, newStack, newFoe, newRaid, FIX } from '../../game/core/schema.js';
import { rebuilderOf } from '../../game/core/rtcontract.js';
import { buildStubMap } from '../../game/world/stubmap.js';
import { Camera } from '../camera.js';
import { Loop, fpsTarget } from '../loop.js';
import { GestureInput } from '../input.js';
import { Renderer, PLANT } from './index.js';
import { hash2 } from '../rng.js';
import { PLANT_CODE } from '../../data/plants.js';
import { roomsBuild } from '../../game/world/rooms.js';
import { setWorldStage, newWorldRec } from '../../game/world/worldrec.js';
import { TICKS_PER_DAY, DAYS_PER_SEASON } from '../../game/core/time.js';

const T = TILE;
const isWallDef = (d) => /^(wall|door)/.test(d) || d === 'gate';

// ---- Stand-in light (until B's js/game/world/light.js registers the C13 'light' rebuild) ---------
/** BFS from each source {i, r}: level 3 within r/3, 2 within 2r/3, 1 within r; blocked by rock, walls and closed doors. */
export function stubLight(s, sources) {
  const reg = rebuilderOf('light');
  if (reg) { s.rt.light = reg(s); return 'B'; }
  const light = s.rt.light; light.fill(0);
  const dist = new Int16Array(N), q = new Int32Array(N);
  const occ = s.rt.occ;
  const blocked = (j) => TER_OPAQUE[s.L.terrain[j]] === 1 || (occ[j] >= 0 && s.bld[occ[j]] && isWallDef(s.bld[occ[j]].def) && !s.bld[occ[j]].open);
  for (const { i, r } of sources) {
    dist.fill(-1);
    let h = 0, t = 0; q[t++] = i; dist[i] = 0;
    while (h < t) {
      const j = q[h++], d = dist[j];
      const lv = d <= r / 3 ? 3 : d <= (2 * r) / 3 ? 2 : 1;
      if (lv > light[j]) light[j] = lv;
      if (d >= r) continue;
      const x = j % W, y = (j / W) | 0;
      const nb = [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, y > 0 ? j - W : -1, y < H - 1 ? j + W : -1];
      for (const k of nb) { if (k < 0 || dist[k] >= 0 || blocked(k)) continue; dist[k] = d + 1; q[t++] = k; }
    }
  }
  return 'stub';
}
/** Mark every open tile explored and every rock tile next to open ground known (the DF-style reveal). */
function revealAll(s, knownAll = false) {
  const L = s.L;
  for (let i = 0; i < N; i++) {
    const t = L.terrain[i];
    if (t !== TER.ROCK) { setBit(L.fog, i, 1); continue; }
    const x = i % W, y = (i / W) | 0;
    let near = knownAll;
    for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H && L.terrain[ny * W + nx] !== TER.ROCK) { near = true; break; }
    }
    if (near) setBit(L.known, i, 1);
    setBit(L.fog, i, 1);
  }
}

// ---- Scene builders --------------------------------------------------------------------------------
function flatScene(q) {
  const s = createColony('flat-scene', { w: 64, name: 'Flat test map' });
  buildStubMap(s, 'flat');
  const L = s.L, at = (x, y) => y * W + x;
  // meadow patches, a dirt road, a sandy pond, surface crags
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = at(x, y);
    if (hash2(x >> 2, y >> 2, 3) < 0.25 && hash2(x, y, 4) < 0.8) L.terrain[i] = TER.MEADOW;
    if (Math.abs(y - (30 + Math.round(3 * Math.sin(x * 0.15)))) <= 0 || (x === 32 && y > 18 && y < 30)) L.terrain[i] = TER.DIRT;
    const e = ((x - 46) / 6) ** 2 + ((y - 42) / 4) ** 2;
    if (e < 0.55) L.terrain[i] = TER.DEEP; else if (e < 1) L.terrain[i] = TER.SHALLOW; else if (e < 1.6) L.terrain[i] = TER.SAND;
    const c = ((x - 14) / 3.2) ** 2 + ((y - 40) / 2.4) ** 2;
    if (c < 1 && hash2(x, y, 5) < 0.85) { L.terrain[i] = TER.ROCK; L.roof[i] = ROOF.OPEN; L.mat[i] = 3; }
    if (x > 18 && x < 26 && y > 32 && y < 38) L.terrain[i] = TER.TILLED;
  }
  // woods in the north and west, scattered trees
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = at(x, y);
    if (L.terrain[i] !== TER.GRASS && L.terrain[i] !== TER.MEADOW) continue;
    const wood = y < 12 || x < 8;
    if (hash2(x, y, 11) < (wood ? 0.42 : 0.035)) { L.plant[i] = hash2(x, y, 12) < 0.3 ? PLANT.PINE : PLANT.TREE; L.growth[i] = 255; }
  }
  for (let y = 33; y < 38; y++) for (let x = 19; x < 26; x++) { L.plant[at(x, y)] = PLANT.CROP; L.growth[at(x, y)] = (x * 37) % 255; }
  // clear the hold
  for (let y = 20; y < 30; y++) for (let x = 24; x < 42; x++) L.plant[at(x, y)] = 0;
  // the old buildings
  const B = (def, x, y, init = {}) => { s.bld.push(newBuilding(s.bld.length, def, x, y, 0, null, { st: 'done', ...init })); };
  B('hearth', 31, 22, { lvl: 2 });
  B('house', 27, 21); B('house', 27, 24, { lvl: 2 }); B('house', 36, 21); B('house', 36, 24, { lvl: 3 });
  B('farm', 22, 30); B('tower', 40, 20, { lvl: 2 }); B('brazier', 29, 27); B('brazier', 35, 27, { lvl: 2 });
  B('barracks', 38, 26);
  for (let x = 25; x <= 41; x++) if (x !== 32 && x !== 33) B(x === 30 ? 'gate' : 'wall', x, 18);
  B('house', 33, 33, { st: 'frame', work: 100, got: { work: 45 } });
  B('house', 35, 33, { st: 'bp' });
  // items, a chop designation, a stockpile zone
  s.items.push(newStack(0, 'stone_granite', null, 0, 10, 27, 28), newStack(1, 'wood', null, 0, 25, 28, 28), newStack(2, 'stone_granite', null, 0, 4, 26, 28));
  for (let y = 4; y < 8; y++) for (let x = 20; x < 26; x++) if (L.plant[at(x, y)]) L.desig[at(x, y)] |= DESIG.CHOP;
  for (let y = 27; y < 29; y++) for (let x = 26; x < 29; x++) L.zone[at(x, y)] = 1;
  // villagers
  for (let k = 0; k < 6; k++) s.col.push(newColonist(k, { name: 'C' + k, x: (30 + k) * T, y: 29 * T, look: { skin: 0, hair: 0, hairC: 0, beard: 0, cloth: k } }));
  s.col[0].job = { type: 'build' }; s.col[1].job = { type: 'chop' };
  initRuntime(s);
  revealAll(s);
  s.tick = 12 * 600; // noon
  const night = q.get('time') === 'night';
  stubLight(s, s.bld.filter((b) => /hearth|brazier|tower/.test(b.def)).map((b) => ({ i: (b.y + (b.def === 'hearth' ? 1 : 0)) * W + b.x + (b.def === 'hearth' ? 1 : 0), r: b.def === 'hearth' ? 9 : b.def === 'brazier' ? 5 : 3 })));
  const cols = s.col;
  return {
    s, cam: { x: 33, y: 26, zoom: 1.1 }, ambient: night ? 0.85 : 3,
    tick() {
      s.tick++;
      for (let k = 2; k < cols.length; k++) { // the rest stroll around the hearth
        const c = cols[k], a = (s.tick / 20) * 0.25 + k * 1.3;
        c.x = (32.5 + Math.cos(a) * (4 + k * 0.4)) * T; c.y = (25.5 + Math.sin(a) * 3) * T;
      }
    },
  };
}

function spikeMapScene(q) {
  const seed = +(q.get('seed') || 1);
  const s = createColony('spike-' + seed, { w: 128, name: 'Spike map' });
  buildStubMap(s, 'bench', seed);
  const L = s.L;
  // plants on open ground and some constructed floors so bakes carry a realistic load
  for (let i = 0; i < N; i++) {
    const x = i % W, y = (i / W) | 0, t = L.terrain[i];
    if ((t === TER.GRASS || t === TER.MEADOW) && hash2(x, y, 21) < 0.08) { L.plant[i] = hash2(x, y, 22) < 0.3 ? PLANT.PINE : PLANT.TREE; L.growth[i] = 255; }
    if (t === TER.GRASS && hash2(x >> 3, y >> 3, 23) < 0.2 && hash2(x, y, 24) < 0.9) L.terrain[i] = TER.MEADOW;
  }
  initRuntime(s);
  revealAll(s);
  s.tick = 12 * 600;
  // sconces along the tunnels: every rough floor tile on a 7-tile lattice
  const sources = [];
  for (let i = 0; i < N; i++) { const x = i % W, y = (i / W) | 0; if (L.terrain[i] === TER.ROUGH && x % 7 === 0 && y % 3 === 0) { sources.push({ i, r: 6 }); s.bld.push(newBuilding(s.bld.length, 'sconce', x, y, 0, null, { st: 'done' })); } }
  initRuntime(s);
  stubLight(s, sources);
  return { s, cam: { x: 64, y: 64, zoom: 1 }, ambient: 3, tick() { s.tick++; } };
}

function tunnelsScene(q) {
  const s = createColony('tunnels', { w: 40, h: 30, name: 'Tunnels' });
  const L = s.L;
  L.terrain.fill(TER.ROCK); L.roof.fill(ROOF.MOUNTAIN); L.mat.fill(3);
  const at = (x, y) => y * W + x;
  const open = (x0, y0, x1, y1, ter = TER.ROUGH, roof = ROOF.MOUNTAIN) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { L.terrain[at(x, y)] = ter; L.roof[at(x, y)] = roof; } };
  open(0, 0, W - 1, 3, TER.GRASS, ROOF.OPEN);   // the surface
  for (let x = 0; x < W; x++) L.roof[at(x, 4)] = ROOF.THIN; // the face
  open(4, 4, 4, 8);                              // entrance from the surface
  open(4, 8, 36, 8);                             // lit tunnel (1 tile)
  open(12, 10, 36, 10);                          // dark tunnel under a 1-tile rock wall (row 9)
  open(36, 8, 36, 10);                           // far link (beyond every sconce's reach)
  open(6, 9, 6, 13);                             // passage to the room
  open(6, 14, 14, 20);                           // a carved room
  open(15, 17, 24, 17); open(24, 17, 24, 24); open(24, 24, 34, 24); // a winding 1-tile tunnel
  for (let i = 0; i < N; i++) if (L.terrain[i] === TER.ROCK && hash2(i % W, (i / W) | 0, 31) < 0.03) L.ore[i] = 1 + ((i * 7) % 6);
  const sconces = [[10, 8], [20, 8], [30, 8], [10, 17], [24, 21]];
  for (const [x, y] of sconces) s.bld.push(newBuilding(s.bld.length, 'sconce', x, y, 0, null, { st: 'done' }));
  s.col.push(newColonist(0, { name: 'Miner', x: 16.5 * T, y: 8.5 * T, look: { skin: 0, hair: 0, hairC: 0, beard: 0, cloth: 1 } }));
  s.col.push(newColonist(1, { name: 'Hauler', x: 34.5 * T, y: 10.5 * T, look: { skin: 0, hair: 0, hairC: 0, beard: 0, cloth: 2 } }));
  s.items.push(newStack(0, 'stone_granite', null, 0, 10, 8, 16));
  initRuntime(s);
  revealAll(s);
  s.tick = 12 * 600;
  const who = stubLight(s, sconces.map(([x, y]) => ({ i: at(x, y), r: 6 })));
  return { s, cam: { x: 20, y: 13, zoom: +(q.get('zoom') || 0.75) }, ambient: 3, lightFrom: who, sconces, tick() { s.tick++; } };
}

function raidScene(q) {
  const s = createColony('raid', { w: 48, h: 36, name: 'Night raid' });
  const L = s.L;
  L.terrain.fill(TER.ROCK); L.roof.fill(ROOF.MOUNTAIN); L.mat.fill(3);
  const at = (x, y) => y * W + x;
  const open = (x0, y0, x1, y1, ter = TER.ROUGH, roof = ROOF.MOUNTAIN) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { L.terrain[at(x, y)] = ter; L.roof[at(x, y)] = roof; } };
  open(0, 0, W - 1, 3, TER.GRASS, ROOF.OPEN);   // the surface (night)
  for (let x = 0; x < W; x++) L.roof[at(x, 4)] = ROOF.THIN;
  open(30, 4, 31, 12);                           // the tunnel mouth from the surface (2 wide)
  open(14, 12, 31, 13);                          // the long tunnel west
  open(8, 14, 24, 24);                           // the carved hall
  open(25, 18, 40, 18); open(40, 18, 40, 30); open(26, 30, 40, 30); // a winding 1-tile tunnel
  open(4, 20, 7, 21);                            // a side cut
  for (let i = 0; i < N; i++) if (L.terrain[i] === TER.ROCK && hash2(i % W, (i / W) | 0, 37) < 0.03) L.ore[i] = 1 + ((i * 7) % 6);
  const B = (def, x, y, init = {}) => { const b = newBuilding(s.bld.length, def, x, y, 0, init.mat || null, { st: 'done', fuel: 1000, ...init }); s.bld.push(b); return b; };
  B('brazier', 12, 16); B('brazier', 20, 16);
  B('campfire', 10, 22);
  B('bloomery', 21, 21);
  B('forge', 17, 21);
  B('sconce', 22, 13); B('sconce', 32, 18); B('sconce', 40, 25);
  for (let x = 8; x <= 24; x += 4) if (x !== 16) B('wall', x, 24 + 0, { mat: 'granite' });
  s.items.push(newStack(0, 'berries', null, 0, 30, 9, 15), newStack(1, 'ingot', 'iron', 0, 12, 23, 23), newStack(2, 'coal', null, 0, 40, 24, 22), newStack(3, 'spear', 'iron', 0, 1, 11, 19));
  // three drafted colonists holding the hall's mouth with spears; one already downed
  const looks = [{ skin: 1, hair: 0, hairC: 2, beard: 3, cloth: 0 }, { skin: 3, hair: 1, hairC: 4, beard: 0, cloth: 2 }, { skin: 0, hair: 2, hairC: 1, beard: 1, cloth: 4 }];
  const spots = [[15.5, 15.5], [17.5, 14.6], [13.2, 18.5]];
  for (let k = 0; k < 3; k++) {
    const c = newColonist(k, { name: ['Ashe', 'Bryn', 'Corr'][k], x: spots[k][0] * T, y: spots[k][1] * T, look: looks[k], role: [['miner', 'builder', 'hauler'][k], null] });
    c.drafted = k < 2; c.gear = { slots: { weapon: 'spear' }, outfit: null };
    if (k === 2) { c.hp.down = true; c.hp.blood = 34 * FIX; }
    if (k === 1) c.hp.blood = 71 * FIX;
    s.col.push(c);
  }
  // the raid: 5 husks and 3 gloom hounds coming down the tunnel into the hall
  const raid = newRaid(0, 'hollow_horde', { pts: 190, edge: { side: 'n', i: at(30, 0) }, goal: 'core', stage: 'active', members: [] });
  s.raids.push(raid);
  const kinds = ['husk', 'husk', 'gloom_hound', 'husk', 'gloom_hound', 'husk', 'husk', 'gloom_hound'];
  const foes = [];
  for (let k = 0; k < kinds.length; k++) {
    const hp = kinds[k] === 'husk' ? 40 : 45;
    const f = newFoe(k, kinds[k], { raid: 0, x: 0, y: 0, hp: { hp: k % 3 === 0 ? hp : Math.round(hp * (0.3 + 0.2 * (k % 3))), max: hp }, target: k % 2, st: { prey: null, bt: null } });
    s.foes.push(f); raid.members.push(f.id); foes.push(f);
  }
  initRuntime(s);
  revealAll(s);
  s.tick = 22 * 600; // 22:00
  const lights = s.bld.filter((b) => /brazier|campfire|sconce|forge|bloomery/.test(b.def)).map((b) => ({ i: at(b.x, b.y), r: b.def === 'brazier' ? 6 : b.def === 'sconce' ? 5 : 3 }));
  const who = stubLight(s, lights);
  // the next threat (stand-in views for the renderer's threat layer): sighted from the east, its route
  const route = [];
  for (let x = W - 1; x >= 41; x--) route.push(at(x, 2));
  for (let x = 40; x >= 31; x--) route.push(at(x, 3));
  for (let y = 4; y <= 12; y++) route.push(at(31, y));
  for (let x = 30; x >= 18; x--) route.push(at(x, 12));
  const views = [{ id: 9, inc: 'hollow_horde', name: 'Hollow horde', stage: 'sighted', arriveTick: s.tick + 3 * 600, hours: 3, chip: 'Hollow horde: 3 h', edge: { side: 'e', word: 'east', i: at(W - 1, 2), x: W - 1, y: 2 }, route, size: { n: 12, text: 'about 12' } },
    { id: 0, inc: 'hollow_horde', name: 'Hollow horde', stage: 'active', arriveTick: s.tick, hours: 0, chip: 'Hollow horde: on the map', edge: { side: 'n', word: 'north', i: at(30, 0), x: 30, y: 0 }, route: null }];
  // scripted fight: foes walk the tunnel into the hall, then circle the defenders; colonists sway on their spots
  const paths = foes.map((f, k) => { const p = [[30.5, 1.5], [30.5 + (k & 1), 8], [30.5, 12.5], [22, 12.5 + (k & 1)], [16 + (k % 4), 13.5 + (k % 3) * 0.6]]; return p; });
  const tickFn = () => {
    s.tick++;
    const t = s.tick - 22 * 600;
    for (let k = 0; k < foes.length; k++) {
      const f = foes[k], p = paths[k], sp = kinds[k] === 'husk' ? 0.05 : 0.08, u = Math.max(0, t * sp - k * 0.9);
      const seg = Math.min(p.length - 1, Math.floor(u)), a = p[seg], b = p[Math.min(p.length - 1, seg + 1)], fr = Math.min(1, u - seg);
      let x = a[0] + (b[0] - a[0]) * fr, y = a[1] + (b[1] - a[1]) * fr;
      if (u >= p.length - 1) { const an = t * 0.02 + k * 0.8; x = p[p.length - 1][0] + Math.cos(an) * 0.6; y = p[p.length - 1][1] + Math.sin(an) * 0.4; }
      f.x = x * T; f.y = y * T;
    }
    for (let k = 0; k < 2; k++) { const c = s.col[k]; c.x = (spots[k][0] + Math.sin(t * 0.03 + k) * 0.15) * T; c.y = spots[k][1] * T; }
  };
  // fast-forward so the horde is already at the hall when the scene opens (&t=<ticks>, default 260)
  const ff = +(q.get('t') || 260);
  for (let k = 0; k < ff; k++) tickFn();
  return { s, cam: { x: 18, y: 16, zoom: +(q.get('zoom') || 1) }, ambient: 0.6, lightFrom: who, views, tick: tickFn };
}


// ---- Stage 2 budget scene: a busy hold in the rain, a fire in the timber quarter, a raid at the gate ----
function holdScene(q) {
  setWorldStage('2');   // the Stage 2 world rules (weatherKind reads 'clear' without them); a scene is never saved
  const s = createColony('hold', { w: 64, h: 48, name: 'The hold grows' });
  const L = s.L;
  const at = (x, y) => y * W + x;
  L.terrain.fill(TER.GRASS); L.roof.fill(ROOF.OPEN); L.mat.fill(3);
  const fill = (x0, y0, x1, y1, ter, roof) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { L.terrain[at(x, y)] = ter; if (roof !== undefined) L.roof[at(x, y)] = roof; } };
  fill(0, 34, 63, 47, TER.ROCK, ROOF.MOUNTAIN);          // the massif to the south
  fill(20, 34, 23, 42, TER.ROUGH, ROOF.MOUNTAIN);        // a tunnel into it
  fill(14, 42, 34, 46, TER.ROUGH, ROOF.MOUNTAIN);        // the deep hall
  fill(0, 0, 63, 2, TER.MEADOW); fill(44, 8, 52, 14, TER.DIRT); fill(56, 20, 63, 33, TER.MARSH);
  fill(2, 22, 9, 26, TER.SHALLOW); fill(4, 23, 7, 25, TER.DEEP);
  for (let i = 0; i < N; i++) if (L.terrain[i] === TER.ROCK && hash2(i % W, (i / W) | 0, 41) < 0.03) L.ore[i] = 1 + ((i * 7) % 6);
  // trees along the north and west
  for (let y = 0; y < 34; y++) for (let x = 0; x < 64; x++) { const i = at(x, y); if (L.terrain[i] !== TER.GRASS) continue; const h = hash2(x, y, 9); if ((y < 6 || x < 10) && h < 0.22) { L.plant[i] = h < 0.08 ? PLANT.PINE : PLANT.TREE; L.growth[i] = 255; } }
  // the field: 8 crops in 4 stages (rows of 2 tiles per stage)
  const crops = ['hearthroot', 'grain', 'greens', 'flax', 'herb', 'glowcap', 'berry', 'hearthroot'];
  const GR = [40, 140, 220, 255];
  for (let k = 0; k < crops.length; k++) for (let st = 0; st < 4; st++) for (let d = 0; d < 2; d++) {
    const x = 26 + k, y = 6 + st * 2 + d, i = at(x, y); L.terrain[i] = TER.TILLED; L.plant[i] = PLANT_CODE[crops[k]] || PLANT.CROP; L.growth[i] = GR[st];
  }
  const B = (def, x, y, init = {}) => { const b = newBuilding(s.bld.length, def, x, y, init.rot || 0, init.mat || null, { st: 'done', fuel: 1000, ...init }); s.bld.push(b); return b; };
  const walls = (x0, y0, x1, y1, mat, door) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { if (x !== x0 && x !== x1 && y !== y0 && y !== y1) continue; B(door && door[0] === x && door[1] === y ? 'door' : 'wall', x, y, { mat }); } };
  // stone rooms: a bedroom, a workshop, a dining hall and a store
  walls(12, 14, 17, 18, 'granite', [14, 18]); B('bed', 13, 15); B('bed', 15, 15); B('sconce', 16, 15);
  walls(18, 14, 24, 18, 'granite', [21, 18]); B('carpenter', 19, 15); B('mason', 22, 15);
  walls(12, 19, 18, 24, 'limestone', [15, 19]); B('table', 14, 21); B('chair', 13, 21); B('chair', 16, 21); B('campfire', 16, 23);
  walls(19, 19, 24, 24, 'wood', [21, 19]); B('shelf', 20, 21); B('shelf', 22, 21);
  // the timber quarter on fire: wooden huts and a palisade
  walls(40, 18, 45, 22, 'wood', [42, 22]); walls(47, 18, 52, 22, 'wood', [49, 22]);
  for (let x = 38; x <= 54; x++) B('palisade', x, 25);
  B('brazier', 30, 27); B('brazier', 34, 27); B('hearth', 28, 20);
  s.items.push(newStack(0, 'wood', null, 0, 40, 25, 12), newStack(1, 'stone', 'granite', 0, 20, 26, 13), newStack(2, 'berries', null, 0, 30, 27, 13), newStack(3, 'grain', null, 0, 12, 28, 13));
  // 30 colonists about the hold
  const roles = ['miner', 'builder', 'crafter', 'hauler', 'generalist'];
  for (let k = 0; k < 30; k++) {
    const x = 24 + (k % 10) * 2.3 + 0.5, y = 12 + Math.floor(k / 10) * 4.1 + 0.5;
    const c = newColonist(k, { name: 'C' + k, x: x * T, y: y * T, look: { skin: k % 6, hair: k % 4, hairC: k % 6, beard: k % 5, cloth: k % 8 }, role: [roles[k % 5], null] });
    if (k < 8) { c.drafted = true; c.gear = { slots: { weapon: 'spear' }, outfit: null }; c.x = (30 + (k % 4) * 1.2) * T; c.y = (28 + (k >> 2)) * T; }
    c.job = k % 3 ? { type: ['mine', 'chop', 'build', 'haul', 'craft'][k % 5] } : null;
    s.col.push(c);
  }
  // 10 animals: a pen of sheep and goats, a hen, deer at the wood's edge, a manhunting boar
  const an = [['sheep', 46, 10], ['sheep', 47, 11], ['goat', 49, 10], ['goat', 50, 12], ['hen', 45, 12], ['ox', 51, 9], ['deer', 4, 10], ['deer', 6, 12], ['hare', 8, 4], ['boar', 58, 6]];
  an.forEach(([kind, x, y], k) => s.anim.push({ id: k, kind, name: null, x: (x + 0.5) * T, y: (y + 0.5) * T, hp: null, tame: k < 6, owner: null, pen: null, age: 0, job: null, path: null, st: kind === 'boar' ? { mode: 'manhunt' } : null }));
  // 40 hostiles: reavers and Hollow at the palisade
  const raid = newRaid(0, 'reaver_warband', { pts: 600, edge: { side: 'e', i: at(63, 28) }, goal: 'loot', stage: 'active', members: [] });
  s.raids.push(raid);
  const fk = ['reaver_club', 'reaver_spear', 'reaver_bow', 'husk', 'gloom_hound'];
  const foes = [];
  for (let k = 0; k < 40; k++) {
    const f = newFoe(k, fk[k % fk.length], { raid: 0, x: (36 + (k % 10) * 2.2) * T, y: (27 + Math.floor(k / 10) * 1.4) * T, hp: { hp: 30 + (k % 3) * 10, max: 50 }, target: k % 8, st: { prey: null, bt: null } });
    s.foes.push(f); raid.members.push(f.id); foes.push(f);
  }
  initRuntime(s);
  revealAll(s, true);
  try { const r = roomsBuild(s); s.rt.room = r.room; s.rt.rooms = r.rooms; } catch (e) { console.warn('rooms:', e && e.message); }
  const season = Math.max(0, Math.min(3, +(q.get('season') ?? 2)));
  const night = q.get('time') === 'night';
  s.tick = season * DAYS_PER_SEASON * TICKS_PER_DAY + (night ? 22 : 14) * 600;
  // the world record (B's Stage 2 saved fields the renderer reads): weather and 24 burning tiles
  const fire = [];
  for (let y = 18; y <= 22; y++) for (let x = 40; x <= 52; x++) if (q.get('fire') !== '0' && hash2(x, y, 5) < 0.42 && fire.length < 24) fire.push([at(x, y), 30 + ((x * 13 + y * 7) % 70), 600]);
  s.colony.world = { ...newWorldRec(), weather: { kind: q.get('wx') || 'rain', since: s.tick, until: s.tick + 6000, day: 0 }, fire };
  const lights = [...s.bld.filter((b) => /brazier|campfire|sconce|hearth/.test(b.def)).map((b) => ({ i: at(b.x, b.y), r: 6 })), ...fire.map((e) => ({ i: e[0], r: 4 }))];
  const who = stubLight(s, lights);
  const tick0 = s.tick;
  const tickFn = () => {
    s.tick++;
    const t = s.tick - tick0;
    for (let k = 0; k < s.col.length; k++) { const c = s.col[k]; if (c.drafted) continue; c.x += Math.cos(t * 0.02 + k) * 0.9; c.y += Math.sin(t * 0.017 + k * 1.3) * 0.6; }
    for (let k = 0; k < foes.length; k++) { const f = foes[k]; f.x += Math.cos(t * 0.03 + k) * 0.7 - 0.1 * Math.sin(t * 0.001); f.y += Math.sin(t * 0.025 + k) * 0.5; }
    for (let k = 0; k < s.anim.length; k++) { const a = s.anim[k]; a.x += Math.cos(t * 0.01 + k * 2) * 0.4; }
  };
  return { s, cam: { x: 38, y: 21, zoom: +(q.get('zoom') || 0.5) }, ambient: night ? 0.6 : 3, lightFrom: who, views: [], tick: tickFn };
}

const SCENES = { flat: flatScene, 'spike-map': spikeMapScene, tunnels: tunnelsScene, raid: raidScene, hold: holdScene };
export const SCENE_NAMES = [...Object.keys(SCENES), 'art'];

// ---- Driver ---------------------------------------------------------------------------------------
export function bootScene(name, params = new URLSearchParams(location.search)) {
  if (name === 'art') { // D's contact sheet (js/engine/art/sheet.js)
    import('../art/sheet.js').then((m) => m.bootArtSheet(params)).catch((e) => console.error('art sheet failed:', e && e.message));
    return null;
  }
  const make = SCENES[name];
  if (!make) { console.warn(`scene: unknown '${name}' (${SCENE_NAMES.join(', ')})`); return null; }
  for (const id of ['screens', 'hud', 'toasts']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
  let canvas = document.getElementById('view');
  if (!canvas) { canvas = document.createElement('canvas'); canvas.id = 'view'; document.body.appendChild(canvas); }
  canvas.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;touch-action:none;display:block;';
  const sc = make(params);
  const ppt = +(params.get('ppt') || 0) || undefined;
  const cfg = {};
  if (params.has('smooth')) cfg.lightSmoothing = params.get('smooth') !== '0';
  const r = new Renderer(canvas, { cfg });
  if (params.has('smooth')) r.settings.lightSmoothing = cfg.lightSmoothing;
  r.setState(sc.s, { lightPxPerTile: ppt, sounds: false });
  if (sc.views) r.threat.source = () => sc.views;
  r.light.setAmbient(sc.ambient);
  if (params.get('chunks') === '1') r.setOverlay('chunks', true);
  if (params.get('zones') === '1') r.setOverlay('zones', true);
  const cam = new Camera();
  const z = +(params.get('zoom') || 0) || sc.cam.zoom;
  const resize = () => {
    const w = window.innerWidth, h = window.innerHeight, dpr = Math.min(r.cfg.dprCap || 2, window.devicePixelRatio || 1);
    r.resize(w, h, dpr); cam.resize(w, h, dpr);
  };
  resize();
  window.addEventListener('resize', resize);
  cam.zoom = z;
  cam.centerOn(((+params.get('x')) || sc.cam.x) * T, ((+params.get('y')) || sc.cam.y) * T, false);
  const flags = { covered: false, saver: false, paused: false, combat: false, moving: true };
  const loop = new Loop({
    step: 1 / 20,
    update: () => sc.tick(),
    render: (alpha, dt) => { cam.update(dt); r.draw(sc.s, cam, alpha, dt, {}); },
    fpsFor: () => { flags.moving = cam.takeMoving(); flags.combat = r.wantsFast(sc.s); return fpsTarget(flags, r.cfg.fps); },
  });
  new GestureInput(canvas, {
    dragmove: (p, dx, dy) => { cam.panBy(dx, dy); loop.poke(); },
    dragend: (p, c, vx, vy) => { if (!c) { cam.vx = -(vx || 0) / cam.zoom; cam.vy = -(vy || 0) / cam.zoom; } },
    pinch: (f, cx, cy, dcx, dcy) => { cam.zoomAt(f, cx, cy); cam.panBy(dcx, dcy); loop.poke(); },
    wheel: (dy, p) => { cam.zoomAt(Math.exp(-dy * 0.0015), p.x, p.y); loop.poke(); },
  });
  loop.start();
  const hook = {
    name, renderer: r, camera: cam, loop, state: sc.s, scene: sc, flags, result: null,
    stats: () => ({ ...r.stats(), dps: +loop.dps.toFixed(1), target: loop.target, zoom: +cam.zoom.toFixed(3) }),
  };
  window.__ecRender = hook;
  if (name === 'spike-map' && params.get('auto') === '1') runS1(hook, +(params.get('secs') || 300)).then((res) => { hook.result = res; });
  if (name === 'tunnels' && params.get('check') === '1') setTimeout(() => { hook.result = checkS2(hook); }, 600);
  if ((name === 'raid' || name === 'hold') && params.get('check') === '1') checkRaid(hook, +(params.get('secs') || 4)).then((res) => { hook.result = res; });
  if (name === 'hold' && params.get('rooms') !== '0') r.setOverlay('rooms', true);
  return hook;
}

// ---- S1: scripted pans through all three bands -----------------------------------------------------
async function runS1(hook, secs) {
  const { renderer: r, camera: cam, loop } = hook;
  const frame = () => new Promise(requestAnimationFrame);
  const WW = W * T, WH = H * T;
  const bandZoom = [1.25, 0.6, 0.33];
  const speed = [1600, 2600, 3600]; // world units per second
  const plan = [0, 1, 2, 1, 0, 2, 0];
  const frameMs = [], bakeMs = { near: [], mid: [], far: [] };
  r.terrain.onBake = (ms, b) => bakeMs[r.cfg.bands[b].name].push(ms);
  let maxMB = 0, blankPx = 0, samples = 0, switches = 0, lastBand = null, maxSprite = 0, maxHeld = { near: 0, mid: 0, far: 0 }, worstPair = 0;
  const t0 = performance.now(), end = t0 + secs * 1000;
  const g = r.g, cv = r.canvas;
  let fno = 0;
  const sample = () => {
    // blank check: read the whole canvas and look for the void colour inside the map rect
    // (screen -> world through the view of the picture on the canvas, not the camera moved since)
    const img = g.getImageData(0, 0, cv.width, cv.height).data, dpr = r.dpr, v = r.view;
    for (let sy = 8; sy < r.h; sy += 24) for (let sx = 8; sx < r.w; sx += 24) {
      const wx = v.x0 + sx / v.z, wy = v.y0 + sy / v.z;
      if (wx < 4 || wy < 4 || wx > WW - 4 || wy > WH - 4) continue;
      const o = ((Math.round(sy * dpr)) * cv.width + Math.round(sx * dpr)) * 4;
      samples++;
      if (img[o] === 23 && img[o + 1] === 21 && img[o + 2] === 31) blankPx++;
    }
  };
  const tick = () => {
    const st = r.stats();
    if (st.heldMB > maxMB) maxMB = st.heldMB;
    for (const k of Object.keys(maxHeld)) if (st.held[k] > maxHeld[k]) maxHeld[k] = st.held[k];
    const pair = Math.max(st.held.near + st.held.mid, st.held.mid + st.held.far, st.held.near + st.held.far);
    if (pair > worstPair) worstPair = pair;
    if (st.sprites.MB > maxSprite) maxSprite = st.sprites.MB;
    if (st.band !== lastBand) { if (lastBand) switches++; lastBand = st.band; }
    if (r.lastMs) frameMs.push(r.lastMs);
    if (++fno % 30 === 0) sample();
  };
  let p = 0;
  while (performance.now() < end) {
    const b = plan[p++ % plan.length];
    // zoom ramp into the band (passes the hysteresis edges like a pinch)
    const z0 = cam.zoom, z1 = bandZoom[b];
    for (let k = 1; k <= 30; k++) { cam.setZoom(z0 + (z1 - z0) * (k / 30)); loop.poke(); await frame(); tick(); }
    // serpentine sweep of the whole map at this zoom
    const hh = r.h / cam.zoom, hw = r.w / cam.zoom;
    const rows = Math.max(1, Math.ceil(WH / hh));
    for (let row = 0; row < rows && performance.now() < end; row++) {
      const y = Math.min(WH - hh / 2, hh / 2 + row * hh);
      const ltr = row % 2 === 0;
      let x = ltr ? hw / 2 : WW - hw / 2;
      cam.centerOn(x, y, false);
      let last = performance.now();
      while (performance.now() < end) {
        await frame();
        const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
        x += (ltr ? 1 : -1) * speed[b] * dt;
        cam.centerOn(x, y, false); cam.moving = true;
        tick();
        if (ltr ? x > WW - hw / 2 : x < hw / 2) break;
      }
    }
  }
  r.terrain.onBake = null;
  const q = (a, f) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(s.length * f))].toFixed(2); };
  const st = r.stats();
  return {
    secs, frames: frameMs.length, bandSwitches: switches,
    frameMedMs: q(frameMs, 0.5), frameP95Ms: q(frameMs, 0.95), frameMaxMs: q(frameMs, 1),
    bakes: st.bakes, bakeMs: Object.fromEntries(Object.entries(bakeMs).map(([k, a]) => [k, { n: a.length, med: q(a, 0.5), p95: q(a, 0.95), max: q(a, 1) }])),
    evictions: st.evictions, released: st.released, failedBakes: st.failedBakes, blankRects: st.blankRects,
    blankPixelSamples: blankPx, pixelSamples: samples, placeholderRects: st.placeholderRects,
    maxHeldMB: maxMB, maxHeld, worstTwoBandHeld: worstPair, heldAtEnd: st.held, spriteMBMax: maxSprite,
    lightFullRebuildMs: st.light.lastMs,
  };
}

// ---- S2: light through a 1-tile rock wall ------------------------------------------------------------
function checkS2(hook) {
  const { renderer: r, camera: cam, scene } = hook;
  cam.centerOn(20.5 * T, 13 * T, false);
  r.draw(hook.state, cam, 1, 0, {});
  const g = r.g, dpr = r.dpr, img = g.getImageData(0, 0, r.canvas.width, r.canvas.height).data, cw = r.canvas.width;
  const tileStats = (tx, ty, y0f = 0.2, y1f = 0.8) => { // mean RGB sum over the tile's inner area (screen px)
    const p0 = cam.worldToScreen(tx * T, ty * T), p1 = cam.worldToScreen((tx + 1) * T, (ty + 1) * T);
    let sum = 0, n = 0, max = 0;
    const ys = p0.y + (p1.y - p0.y) * y0f, ye = p0.y + (p1.y - p0.y) * y1f;
    for (let y = Math.ceil(ys * dpr); y < Math.floor(ye * dpr); y++) for (let x = Math.ceil((p0.x + 3) * dpr); x < Math.floor((p1.x - 3) * dpr); x++) {
      if (x < 0 || y < 0 || x >= cw || y >= r.canvas.height) continue;
      const o = (y * cw + x) * 4, v = img[o] + img[o + 1] + img[o + 2]; sum += v; n++; if (v > max) max = v;
    }
    return { mean: n ? sum / n : 0, max };
  };
  const dark = [], lit = [];
  // the tiles of the 1-tile wall (row 9) between the lit tunnel (row 8) and the dark one (row 10) that are on screen
  const xs = [];
  for (let x = 13; x <= 33; x++) { const a = cam.worldToScreen(x * T, 0).x, b = cam.worldToScreen((x + 1) * T, 0).x; if (a >= 0 && b <= r.w) xs.push(x); }
  for (const x of xs) { dark.push(tileStats(x, 10).mean); lit.push(tileStats(x, 8).mean); }
  const wallTop = [], wallBot = [];
  for (const x of xs) { wallTop.push(tileStats(x, 9, 0.05, 0.3).mean); wallBot.push(tileStats(x, 9, 0.7, 0.95).mean); }
  const mean = (a) => a.reduce((p, c) => p + c, 0) / a.length;
  const darkMax = Math.max(...dark), darkMin = Math.min(...dark);
  const res = {
    ppt: r.light.ppt, smooth: r.settings.lightSmoothing, zoom: cam.zoom, lightFrom: scene.lightFrom, tilesChecked: xs.length,
    tilePx: +(T * cam.zoom).toFixed(1),
    litTunnelMeanRGB: Math.round(mean(lit)), darkTunnelMeanRGB: Math.round(mean(dark)), darkTunnelMaxRGB: Math.round(darkMax), darkTunnelMinRGB: Math.round(darkMin),
    wallFaceLitRGB: Math.round(mean(wallTop)), wallFaceDarkRGB: Math.round(mean(wallBot)),
    leakThroughWall: darkMax - darkMin > 8,
    contrast: +(mean(lit) / Math.max(1, mean(dark))).toFixed(1),
  };
  return res;
}

// ---- Stage 1b: a night raid in tunnels (14.7 row C acceptance) ---------------------------------------
async function checkRaid(hook, secs) {
  const { renderer: r, camera: cam, loop } = hook;
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  await wait(800); // the kit loads, chunks bake
  const t0 = performance.now(), d0 = r.frames, ms = [];
  const blank0 = r.terrain.st.blankRects;
  let maxHeld = { near: 0, mid: 0, far: 0 }, badPair = 0, combat = 0, samples = 0;
  while (performance.now() - t0 < secs * 1000) {
    await new Promise(requestAnimationFrame);
    if (r.lastMs) ms.push(r.lastMs);
    const st = r.stats();
    for (const k in maxHeld) if (st.held[k] > maxHeld[k]) maxHeld[k] = st.held[k];
    if (!((st.held.far === 0 && st.held.near <= 36 && st.held.mid <= 27) || (st.held.near === 0 && st.held.mid <= 27 && st.held.far <= 48))) badPair++;
    samples++; if (hook.flags.combat) combat++;
  }
  const secsRun = (performance.now() - t0) / 1000;
  const q = (a, f) => { if (!a.length) return 0; const s2 = a.slice().sort((x, y) => x - y); return +s2[Math.min(s2.length - 1, Math.floor(s2.length * f))].toFixed(2); };
  const fullDps = +((r.frames - d0) / secsRun).toFixed(1);
  // the same scene with the foes moved off screen: the throttle drops back to 30
  const saved = hook.state.foes.map((f) => [f.x, f.y]);
  const tick0 = hook.scene.tick; hook.scene.tick = () => { hook.state.tick++; };
  for (const f of hook.state.foes) { f.x = 2 * 32; f.y = 1.5 * 32; }
  cam.vx = cam.vy = 0;
  await wait(700);
  const f1 = r.frames, t1 = performance.now();
  await wait(2000);
  const calmDps = +((r.frames - f1) / ((performance.now() - t1) / 1000)).toFixed(1);
  hook.state.foes.forEach((f, k) => { f.x = saved[k][0]; f.y = saved[k][1]; });
  hook.scene.tick = tick0;
  // strategic view: the raid merges into a blob
  const z0 = cam.zoom;
  cam.setZoom(0.4); loop.poke();
  for (let k = 0; k < 20; k++) await new Promise(requestAnimationFrame);
  const strategic = { blobs: r.entities.blobN, pips: r.entities.pipN, edges: r.threat.edges.length };
  cam.setZoom(z0); loop.poke();
  for (let k = 0; k < 10; k++) await new Promise(requestAnimationFrame);
  const st = r.stats();
  return {
    colonists: hook.state.col.length, hostiles: hook.state.foes.length, lightFrom: hook.scene.lightFrom,
    secs: +secsRun.toFixed(1), drawsPerSec: fullDps, combatShare: +(combat / Math.max(1, samples)).toFixed(2), target: loop.target,
    frameMedMs: q(ms, 0.5), frameP95Ms: q(ms, 0.95), frameMaxMs: q(ms, 1), calmDrawsPerSec: calmDps,
    maxHeld, badHeldFrames: badPair, blankRects: r.terrain.st.blankRects - blank0, strategic,
    threat: st.threat, spritesMB: st.sprites.MB, drawn: st.drawn, weather: st.weather, animals: hook.state.anim.length,
  };
}
