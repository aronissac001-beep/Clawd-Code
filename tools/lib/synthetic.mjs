// A synthetic late-game colony for the save bench and spike S3 (doc 14.5): day 200, 30 colonists,
// 4,000 stacks, 1,500 buildings, a mined massif, a live raid with 3 flow fields. Deterministic.
// Pure ESM with relative imports, so it runs in Node and in a browser page.
import { createColony } from '../../js/game/core/state.js';
import { idx, TER, ROOF, N, W, H } from '../../js/game/core/grid.js';
import { newColonist, newStack, newBuilding, newZone, newFoe, newAnimal, newRaid, newJob, newPath, newBill, newNemesis, SKILL_IDS } from '../../js/game/core/schema.js';
import { rint, rnd } from '../../js/game/core/rand.js';

export function syntheticColony({ seed = 'SYN-200', colonists = 30, stacks = 4000, buildings = 1500, flowFields = 3, foes = 40 } = {}) {
  const s = createColony(seed, { name: 'Synthetic Hold' });
  const R = { rng: { main: 0x51e7 } };
  const r = (a, b) => rint(R, 'main', a, b);
  s.tick = 200 * 14400 + 3 * 600;
  // Terrain: a massif on the east 35%, tunnels and halls mined into it; river; forest; fields.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(x, y);
    const edge = W * 0.65 + Math.sin(y * 0.11) * 6;
    if (x > edge) { s.L.terrain[i] = TER.ROCK; s.L.mat[i] = 1 + Math.min(6, ((x - edge) / 6) | 0); s.L.roof[i] = x - edge > 4 ? ROOF.MOUNTAIN : ROOF.THIN; if (rnd(R, 'main') < 0.03) s.L.ore[i] = r(1, 12); }
    else if (Math.abs(x - 30 - Math.sin(y * 0.07) * 8) < 2) s.L.terrain[i] = TER.SHALLOW;
    else { s.L.terrain[i] = rnd(R, 'main') < 0.15 ? TER.MEADOW : TER.GRASS; if (rnd(R, 'main') < 0.2) { s.L.plant[i] = r(1, 6); s.L.growth[i] = r(0, 255); } }
    if (x < edge - 40 && rnd(R, 'main') < 0.04) s.L.blight[i] = r(10, 200);
  }
  let mined = 0;
  for (let k = 0; k < 60; k++) { // tunnels and halls
    let x = (W * 0.65) | 0, y = r(10, H - 10); const len = r(10, 40), hall = k % 6 === 0;
    for (let t = 0; t < len; t++) {
      const rr = hall ? 3 : 0;
      for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const i = idx(xx, yy); if (s.L.terrain[i] === TER.ROCK) { s.L.terrain[i] = TER.ROUGH; s.L.ore[i] = 0; mined++; if (hall && rnd(R, 'main') < 0.5) s.L.floor[i] = 1; }
      }
      x = Math.min(W - 2, x + (r(0, 3) ? 1 : 0)); y = Math.max(1, Math.min(H - 2, y + r(-1, 1)));
    }
  }
  for (let i = 0; i < N; i++) { if (i % 3) s.L.fog[i >> 3] |= 1 << (i & 7); if (i % 5 === 0) s.L.known[i >> 3] |= 1 << (i & 7); }
  for (let i = 0; i < 400; i++) s.L.desig[r(0, N - 1)] = 1;
  // People
  for (let c = 0; c < colonists; c++) {
    const col = newColonist(s.next.col++, {
      name: 'Colonist ' + c, anc: ['human', 'sylvari', 'deepforge', 'emberkin'][c % 4], age: r(18, 70),
      look: { skin: r(0, 5), hair: r(0, 3), hairC: r(0, 5), beard: r(0, 2), cloth: r(0, 7) }, bs: ['urchin', 'smith'],
      at: [r(1, 5), r(1, 5), r(1, 5)], sk: SKILL_IDS.map(() => [r(0, 16), r(0, 40000), r(0, 2), r(0, 2400)]),
      perks: ['cave_sense'], traits: ['hardworking', 'brave'], need: [r(0, 10000), r(0, 10000), r(0, 10000), r(0, 10000), r(0, 10000)],
      mood: r(2000, 9000), thoughts: Array.from({ length: 10 }, (_, k) => ['th_' + k, r(0, 9000), 1]),
      hp: { parts: [25, 40, 20, 18, 25, 25], blood: 9800, wounds: [{ part: 3, kind: 'cut', dmg: 4, bleed: 0, tended: 0.8, infected: 0, age: 2000 }], taint: 0, illness: null },
      x: r(0, W * 32 - 1) + 0.5, y: r(0, H * 32 - 1) + 0.25, role: ['miner', 'hauler'],
      job: newJob('mine', r(0, N - 1), [['goto', 5], ['work', 120], ['drop', 0]], { i: 1, work: 40 }),
      path: newPath(Array.from({ length: 40 }, () => r(0, N - 1)), 3), unreach: [[r(0, N), s.tick + 300]],
      log: Array.from({ length: 12 }, (_, k) => [s.tick - k * 600, 'mined', k]),
    });
    s.col.push(col);
  }
  const kinds = ['wood', 'stone', 'blocks', 'ore_iron', 'coal', 'meal', 'ingot_iron', 'cloth', 'leather', 'herb', 'berries', 'bandage'];
  for (let k = 0; k < stacks; k++) s.items.push(newStack(k, kinds[k % kinds.length], k % 3 ? 'granite' : 'pine', r(0, 6), r(1, 75), r(0, W - 1), r(0, H - 1), { hp: r(50, 100), age: r(0, 100000) }));
  for (let k = 0; k < buildings; k++) {
    const b = newBuilding(k, k % 5 ? 'wall' : 'bed', r(0, W - 1), r(0, H - 1), r(0, 3), 'granite', { st: 'done', q: r(0, 6), hp: r(40, 300) });
    if (k % 75 === 0) { b.def = 'carpenter_bench'; b.bills = [newBill('chair'), newBill('table', { mode: 'count', n: 3 })]; }
    s.bld.push(b);
  }
  for (let z = 1; z <= 12; z++) s.zones.push(newZone(z, z % 3 ? 'stockpile' : 'grow', { name: 'Zone ' + z }));
  for (let a = 0; a < 20; a++) s.anim.push(newAnimal(s.next.anim++, 'goat', { x: r(0, 4000), y: r(0, 4000), hp: { v: 30 } }));
  const raid = newRaid(s.next.raid++, 'raid_reavers', { pts: 2400, stage: 'assault', members: [] });
  for (let f = 0; f < foes; f++) { const id = s.next.foe++; raid.members.push(id); s.foes.push(newFoe(id, 'reaver', { raid: raid.id, x: r(0, 4000), y: r(0, 4000), hp: { v: 60 }, path: newPath([1, 2, 3, 4]) })); }
  s.raids.push(raid);
  s.st.nemeses.push(newNemesis(s.next.nem++, { name: 'Varr', epithet: 'the Scarred', kind: 'reaver_captain', grudge: 1 }));
  for (let k = 0; k < 600; k++) s.chron.push([k * 4800, 'deed', 'tmpl_' + (k % 40), [k, 'Colonist ' + (k % 30)]]);
  for (let a = 1; a <= 30; a++) for (let b = a + 1; b <= Math.min(30, a + 4); b++) s.rel[a * 1024 + b] = [r(-60, 80), 'friend'];
  for (let f = 0; f < flowFields; f++) {
    const field = new Uint16Array(N); for (let i = 0; i < N; i++) field[i] = (i % W + ((i / W) | 0) + f * 7) & 0xffff;
    s.rt.flow.push({ goal: f, built: s.tick - 30, stamp: 1234 + f, field });
  }
  s.rt.thinkQ.push(1, 2, 3); s.rt.pathQ.push([4, 100, 200]);
  return { s, mined };
}
