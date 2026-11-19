// The Mine work giver (doc 3.4, 5.1; owner E). Targets: tiles with the Mine designation that are
// rock or rubble, have a standing spot the miner can reach (a 4-neighbour of open floor), and whose
// mining leaves no roofed tile unsupported unless the tile is flagged risky-ok (B's mineAllowed).
// Unknown interior tiles of a designated rectangle are simply not reachable yet; they are mined in
// order as they become adjacent to open floor.
//
// Effect: B's mineTile (terrain, roof, reveal, events), the designation cleared through E's index,
// a carve-hall pillar blueprint when the plan wants one there, then the yield: the deposit on ore
// tiles, else rough stone on WORK.stoneYieldPct of plain tiles, dropped on the nearest same-stone
// pile with room within WORK.stonePileR of the miner (3.4 stone piles). A new pile starts on the
// tile just mined (the face), not on the miner's tile: it then stays within reach while the miner
// works forward, so piles fill up (tested: 2,300 hall tiles make about 135 stacks per 1,500 tiles,
// 2-wide tunnels about 175), and the miner's own tunnel stays clear. The miner's tile is the fallback.

import { W, N, idx, tx, ty, inB, TER_MINEABLE, TER, DESIG } from '../../core/grid.js';
import { nextU32 } from '../../core/rand.js';
import { TICKS_PER_MIN } from '../../core/time.js';
import { mineTile } from '../../world/terrain.js';
import { mineAllowed } from '../../world/support.js';
import { layerOfStone, layerOfDepth, depositDef, stoneName } from '../../world/defs.js';
import { WORK, T, makeJob, registerEffect, keyTile, keyId } from '../jobs.js';
import { spawn, stackAt, stackLimit, canHold } from '../items.js';
import { colTile } from '../reserve.js';
import { collect, standSpot, openTarget, clearDesig } from '../windex.js';
import { placePlannedSupport } from '../construct.js';
import { workplaceGiver } from './craft.js';

/** Mining work of tile i in ticks at speed 1.0 (3.2 rock layer x ore multiplier; rubble is quick). */
export function mineTicks(s, i) {
  const t = s.L.terrain[i];
  if (t === TER.RUBBLE) return WORK.rubbleMin * TICKS_PER_MIN;
  const layer = layerOfStone(s.L.mat[i]) || layerOfDepth(s.rt.depth[i]);
  let min = layer ? layer.work : 20;
  if (s.L.ore[i]) min = Math.floor((min * WORK.oreWorkPct) / 100);
  return Math.max(1, min) * TICKS_PER_MIN;
}

/** Cheap test first: a mineable tile with at least one walkable 4-neighbour (on the open face). */
function onFace(s, i) {
  const w = s.rt.walkCost, x = i % W;
  return (i >= W && w[i - W] !== 0) || (i + W < N && w[i + W] !== 0) || (x > 0 && w[i - 1] !== 0) || (x < W - 1 && w[i + 1] !== 0);
}
const target = (s, col, i) => {
  if (!onFace(s, i) || !TER_MINEABLE[s.L.terrain[i]] || !(s.L.desig[i] & DESIG.MINE) || (s.L.desig[i] & DESIG.FORBID)) return null;
  if (!openTarget(s, col, keyTile(i))) return null;
  const st = standSpot(s, col, [i]);
  return st.i < 0 ? null : { key: keyTile(i), i, stand: st.i, d: st.d };
};

export const MINE_GIVER = Object.freeze({
  id: 'mine', work: 'mine', order: 0,
  candidates(s, col, k) { const d = s.rt.idx.desig.mine; return collect(s, col, (c) => d[c], (i) => target(s, col, i), k); },
  valid(s, col, t) { return !!target(s, col, t.i) && mineAllowed(s, t.i); },
  make(s, col, t) {
    const key = keyTile(t.i);
    return { job: makeJob('mine', key, [T.goto(t.stand), T.work(mineTicks(s, t.i), { sk: 'mining', fx: 'mine', key })]), claims: [[key, 0]] };
  },
  keyOf: (t) => t.key,
  fromTarget(s, col, tg) { if (!tg || tg.x === undefined || !inB(tg.x, tg.y)) return null; return target(s, col, idx(tg.x, tg.y)); },
});

/** Drop one rough stone of material m near the miner, who just mined tile `mined` (3.4). */
export function dropStone(s, col, m, mined = -1) {
  const ci = colTile(col), cx = tx(ci), cy = ty(ci), lim = stackLimit('stone'), R = WORK.stonePileR;
  for (let r = 0; r <= R; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = cx + dx, y = cy + dy;
      if (!inB(x, y)) continue;
      const o = stackAt(s, idx(x, y));
      if (o && o.k === 'stone' && o.m === m && !o.f && o.q === 0 && o.n < lim) return spawn(s, 'stone', m, 0, 1, x, y);
    }
  }
  if (mined >= 0 && canHold(s, mined) && !stackAt(s, mined)) return spawn(s, 'stone', m, 0, 1, tx(mined), ty(mined));
  return spawn(s, 'stone', m, 0, 1, cx, cy);
}

registerEffect('mine', (s, col, job) => {
  const i = keyId(job.target);
  if (!TER_MINEABLE[s.L.terrain[i]]) { clearDesig(s, i, DESIG.MINE | DESIG.RISKY); return undefined; }
  const r = mineTile(s, i, col.id);
  clearDesig(s, i, DESIG.MINE | DESIG.RISKY);
  if (!r) return undefined;
  placePlannedSupport(s, i);
  if (r.rubble) return undefined;
  if (r.ore) {
    const dep = depositDef(r.ore);
    if (dep && dep.yield > 0) { const ci = colTile(col); spawn(s, dep.item, dep.mat || null, 0, dep.yield, tx(ci), ty(ci)); }
    return undefined;
  }
  if (nextU32(s, 'main') % 100 < WORK.stoneYieldPct) { const m = stoneName(r.mat); if (m) dropStone(s, col, m, i); }
  return undefined;
});

// ---- The surface quarry (Stage 2, 7.6): a workplace against a rock face --------------------------
// A miner cuts one rough stone per QUARRY_MIN game minutes of work, of the stone of the nearest rock
// tile within 3 tiles of the quarry (no stone in reach: nothing is cut), dropped like mined stone.
export const QUARRY_MIN = 40;
function faceStone(s, b) {
  let best = null, bd = Infinity;
  for (let y = b.y - 3; y <= b.y + 5; y++) for (let x = b.x - 3; x <= b.x + 5; x++) {
    if (!inB(x, y)) continue;
    const i = idx(x, y);
    if (s.L.terrain[i] !== TER.ROCK) continue;
    const d = (x - b.x - 1) * (x - b.x - 1) + (y - b.y - 1) * (y - b.y - 1);
    if (d < bd) { const m = stoneName(s.L.mat[i]); if (m) { bd = d; best = m; } }
  }
  return best;
}
export const QUARRY_GIVER = workplaceGiver({
  id: 'quarry', work: 'mine', defs: ['quarry'], sk: 'mining', shiftMin: 120, perMin: QUARRY_MIN, order: 5,
  ok: (s, col, b) => !!faceStone(s, b),
  yieldFn: (s, col, b, n) => { const m = faceStone(s, b); if (m) for (let k = 0; k < n; k++) dropStone(s, col, m); },
});
