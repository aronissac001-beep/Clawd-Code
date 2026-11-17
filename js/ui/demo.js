// Demo fixture for the shell (owner I; debug only: ?debug=1&demo=1). Fills the chrome so the gate
// and the spike can measure a busy screen: a band of eight colonists near the map centre (built with
// the schema factory, like a test fixture), a threat chip, stock numbers and five alerts. Nothing
// here runs without the debug flag; the demo colony is named so it cannot be mistaken for a real one.
import { newColonist, FIX } from '../game/core/schema.js';
import { TILE, W, H, N, TER, setBit, idx } from '../game/core/grid.js';
import { initRuntime } from '../game/core/state.js';
import { buildStubMap } from '../game/world/stubmap.js';

export const DEMO_NAMES = ['Bryn', 'Odo', 'Maelis', 'Tarn', 'Wenna', 'Corwin', 'Ysolde', 'Hale'];

/** Add the demo band to a fresh colony state (debug fixture). Returns the demo chrome data. */
export function seedDemo(s) {
  s.name = 'Demo hold';
  s.tick = 8 * 600;   // 08:00 on day 1, so the screenshots are in daylight (a fresh colony starts at 00:00 in Stage 0)
  // B's 'bench' stub map (a massif in the east), its surface revealed, like the renderer's scenes
  buildStubMap(s, 'bench');
  const L = s.L;
  for (let i = 0; i < N; i++) {
    if (L.terrain[i] !== TER.ROCK) { setBit(L.fog, i, 1); continue; }
    const x = i % W, y = (i / W) | 0;
    for (let k = 0; k < 4; k++) {
      const nx = x + [1, -1, 0, 0][k], ny = y + [0, 0, 1, -1][k];
      if (nx >= 0 && ny >= 0 && nx < W && ny < H && L.terrain[idx(nx, ny)] !== TER.ROCK) { setBit(L.known, i, 1); setBit(L.fog, i, 1); break; }
    }
  }
  const cy = (H / 2) | 0;
  let face = (W / 2) | 0;
  while (face < W - 1 && L.terrain[idx(face, cy)] !== TER.ROCK) face++;
  const cx = face - 5;
  const roles = ['miner', 'builder', 'cook', 'hauler', 'grower', 'smith', 'healer', 'warden'];
  DEMO_NAMES.forEach((name, k) => {
    const id = s.next && s.next.col ? s.next.col++ : k + 1;
    s.col.push(newColonist(id, {
      name, x: (cx - 4 + (k % 4) * 3 + 0.5) * TILE, y: (cy - 2 + ((k / 4) | 0) * 3 + 0.5) * TILE,
      look: { skin: k % 3, hair: k % 4, hairC: k % 5, beard: k % 2, cloth: k },
      mood: [72, 55, 38, 64, 20, 80, 47, 60][k] * FIX, role: [roles[k], null],
    }));
  });
  initRuntime(s);
  return {
    threat: { name: 'Horde', hours: 14 },
    stock: [['food', 'Food', '6d'], ['wood', 'Wood', '240'], ['stone', 'Stone', '410'], ['sword', 'Steel', '12'], ['food', 'Meals', '18']],
    alerts: [
      { icon: 'hunger', text: 'Food lasts 2 days', why: 'Add a grow zone or hunt.', tone: 'warn' },
      { icon: 'bed', text: 'Wenna has no bed', why: 'Build a bed or a dorm.' },
      { icon: 'alert', text: 'Wenna may break', why: 'Mood is under the minor break line.', tone: 'bad' },
      { icon: 'flame', text: 'Hearth fuel under 1 day', why: 'Haul wood to the Hearth.', tone: 'warn' },
      { icon: 'skull', text: 'An unburied corpse', why: 'Make a burial zone.' },
    ],
  };
}
