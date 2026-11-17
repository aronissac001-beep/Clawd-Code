// Building behaviours: towers and the Hearth shoot, Braziers burn, Barracks
// train soldiers into their squad.
import { BAL } from '../../data/balance.js';
import { BUILDINGS, levelStats } from '../../data/buildings.js';
import { UNITS } from '../../data/units.js';
import { SQUAD_NAMES, SQUAD_COLORS } from '../../data/heraldry.js';
import { T, N, idx, inB, tileOf, TER_BUILDABLE } from '../grid.js';
import { solidForFriend } from './pathing.js';
import { hurt, emit, newId, spawnSoldier, accessTile } from './common.js';
import { spawnProjectile } from './combat.js';

export function updateBuildings(s, dt) {
  for (const b of s.buildings) {
    b.hitT = Math.max(0, b.hitT - dt);
    if (!b.built) continue;
    const st = levelStats(b.type, b.level);
    const cx = (b.tx + b.size / 2) * T, cy = (b.ty + b.size / 2) * T;
    if (st.attack && !BUILDINGS[b.type].selfFire) {
      b.cd -= dt;
      if (b.cd <= 0) {
        const a = st.attack;
        const range = (a.range + (b.type === 'tower' ? s.mods.towerRange : 0) + (b.bonusRange || 0)) * T;
        const t = s.rt.enemyHash.nearest(cx, cy, range);
        if (t) {
          b.cd = a.rate;
          const top = b.type === 'hearth' ? cy - 40 : cy - 34;
          const kind = a.type === 'fire' ? 'bolt' : 'arrow';
          const dmg = (b.type === 'hearth' ? a.dmg + (s.mods.hearthDmg || 0) : a.dmg * (1 + (s.mods.towerDmg || 0) + (s.mods.rangedDmg || 0))) * (1 + (b.bonusDmg || 0));
          spawnProjectile(s, kind, cx, top, t, dmg, a.type, null, kind === 'bolt' ? 9 : 14, kind === 'bolt' ? 0.3 : 0.8);
          if ((a.shots || 1) > 1) {
            let second = null;
            s.rt.enemyHash.each(cx, cy, range, (e) => { if (e !== t) { second = e; return true; } return false; });
            spawnProjectile(s, kind, cx + 4, top, second || t, dmg, a.type, null, 14, 0.8);
          }
          emit(s, { t: 'sfx', k: kind === 'bolt' ? 'bolt' : 'bow', x: cx, y: cy });
        } else b.cd = 0.25;
      }
    }
    if (st.burn) {
      b.cd -= dt;
      if (b.cd <= 0) {
        b.cd = 0.5;
        s.rt.enemyHash.each(cx, cy, st.burn.radius * T, (e) => { hurt(s, e, st.burn.dps * 0.5, 'fire', null); return false; });
      }
    }
    if (b.train && b.train.length) {
      const job = b.train[0];
      job.t -= dt * (st.trainSpeed || 1);
      if (job.t <= 0) {
        b.train.shift();
        const sq = squadFor(s, b);
        const at = accessTile(s, b, cx, cy + T * 3) || { tx: b.tx, ty: b.ty + b.size };
        spawnSoldier(s, job.u, sq, (at.tx + 0.5) * T, (at.ty + 0.5) * T);
        emit(s, { t: 'trained', x: cx, y: cy, unit: job.u, squad: sq.id });
      }
    }
  }
}

export function squadFor(s, b) {
  let sq = s.squads.find((q) => q.id === b.squad);
  if (!sq) {
    const n = s.squads.length + (s.squadSerial || 0);
    s.squadSerial = (s.squadSerial || 0) + 1;
    const h = s.rt.hearth;
    const cx = (b.tx + b.size / 2) * T, cy = (b.ty + b.size / 2) * T;
    // Default rally: between the barracks and the Hearth.
    const hx = h ? (h.tx + 1.5) * T : cx, hy = h ? (h.ty + 1.5) * T : cy;
    const at = accessTile(s, b, hx, hy) || { tx: b.tx, ty: b.ty + b.size };
    sq = { id: newId(s), bId: b.id, name: SQUAD_NAMES[n % SQUAD_NAMES.length], color: SQUAD_COLORS[n % SQUAD_COLORS.length], rx: (at.tx + 0.5) * T, ry: (at.ty + 0.5) * T, targetId: 0 };
    s.squads.push(sq);
    b.squad = sq.id;
  }
  return sq;
}

export function squadSize(s, b) {
  let n = 0;
  for (const u of s.soldiers) if (u.alive && u.squad === b.squad) n++;
  return n;
}

export function trainTime(type) { return UNITS[type].train; }

// ---- Placement: never wall the town in (stream E) --------------------------------------------
// A building packed into the last gap could shut villagers into a pocket (they then stood there
// for the rest of the region) or cut a farm or camp off from every road. BUS.canPlace veto:
// placing it must leave every villager, soldier and building that the Hearth's people can reach
// still reachable, and the new building itself must be reachable. Walls and Gates are exempt
// (a wall ring is deliberate; its Gate is the way through).
const REACH_A = new Uint8Array(N * N), REACH_B = new Uint8Array(N * N);
const LABEL = new Int32Array(N * N);
const STACK = new Int32Array(N * N);
let labelGen = 0;
/** out[i] = 1 for the tiles of "the town": the largest open area that touches the Hearth (the
 *  footprint fx0..fx1 x fy0..fy1 counted as solid). A small pocket that also touches the Hearth
 *  (between it and a tower) is not the town. */
export function flood(s, out, fx0 = 0, fy0 = 0, fx1 = 0, fy1 = 0) {
  out.fill(0);
  const h = s.rt.hearth;
  if (!h) return false;
  const blocked = (i) => {
    const x = i % N, y = (i / N) | 0;
    if (x >= fx0 && x < fx1 && y >= fy0 && y < fy1) return true;
    return solidForFriend(s, i);
  };
  const base = labelGen;
  let bestL = 0, bestN = 0;
  for (let y = h.ty - 1; y <= h.ty + h.size; y++) for (let x = h.tx - 1; x <= h.tx + h.size; x++) {
    if (!inB(x, y)) continue;
    const i0 = idx(x, y);
    if (LABEL[i0] > base || blocked(i0)) continue;
    const L = ++labelGen;
    let n = 0, cnt = 0;
    LABEL[i0] = L; STACK[n++] = i0;
    while (n > 0) {
      const i = STACK[--n], cx = i % N, cy = (i / N) | 0;
      cnt++;
      if (cx > 0 && LABEL[i - 1] <= base && !blocked(i - 1)) { LABEL[i - 1] = L; STACK[n++] = i - 1; }
      if (cx < N - 1 && LABEL[i + 1] <= base && !blocked(i + 1)) { LABEL[i + 1] = L; STACK[n++] = i + 1; }
      if (cy > 0 && LABEL[i - N] <= base && !blocked(i - N)) { LABEL[i - N] = L; STACK[n++] = i - N; }
      if (cy < N - 1 && LABEL[i + N] <= base && !blocked(i + N)) { LABEL[i + N] = L; STACK[n++] = i + N; }
    }
    if (cnt > bestN) { bestN = cnt; bestL = L; }
  }
  if (labelGen > 1e9) { LABEL.fill(0); labelGen = 0; }
  if (!bestL) return true;
  for (let i = 0; i < N * N; i++) if (LABEL[i] === bestL) out[i] = 1;
  return true;
}
/** The town's tiles (see flood), cached on s.rt until a building or tree comes or goes. */
export function townTiles(s) {
  const key = `${s.tick}|${s.buildings.length}|${s.nodes.length}|${s.rt.hearth ? s.rt.hearth.id : 0}`;
  if (s.rt.townKey !== key) {
    if (!s.rt.town) s.rt.town = new Uint8Array(N * N);
    if (!flood(s, s.rt.town)) return null;
    s.rt.townKey = key;
  }
  return s.rt.town;
}
/** Is a friendly at (x, y) shut out of the town (a pocket the buildings closed)? */
export function shutOut(s, x, y) {
  const REACH_T = townTiles(s);
  if (!REACH_T) return false;
  const tx = tileOf(x), ty = tileOf(y);
  if (!inB(tx, ty)) return false;
  // Standing on a solid tile (a footprint): judge by the tiles around it.
  if (solidForFriend(s, idx(tx, ty))) { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (inB(tx + dx, ty + dy) && REACH_T[idx(tx + dx, ty + dy)]) return false; return true; }
  return !REACH_T[idx(tx, ty)];
}
function touches(reach, tx, ty, size) {
  for (let y = ty - 1; y <= ty + size; y++) for (let x = tx - 1; x <= tx + size; x++) {
    if (!inB(x, y) || (x >= tx && x < tx + size && y >= ty && y < ty + size)) continue;
    if (reach[idx(x, y)]) return true;
  }
  return false;
}
export function sealVeto(s, type, tx, ty) {
  const def = BUILDINGS[type];
  if (!def || def.line || def.isGate || def.walkable) return null;
  const size = def.size;
  // Only judge a footprint that is otherwise free: canPlace gives its own reason first.
  for (let y = ty; y < ty + size; y++) for (let x = tx; x < tx + size; x++) {
    if (!inB(x, y)) return null;
    const i = idx(x, y);
    if (s.occ[i] || s.nodeGrid[i] || !s.fog[i] || !TER_BUILDABLE[s.terrain[i]]) return null;
  }
  if (!flood(s, REACH_A)) return null;
  flood(s, REACH_B, tx, ty, tx + size, ty + size);
  // (Someone standing on the footprint just steps out: the footprint's own access is checked below.)
  const lost = (x, y) => {
    const X = tileOf(x), Y = tileOf(y);
    if (X >= tx && X < tx + size && Y >= ty && Y < ty + size) return false;
    const i = idx(X, Y);
    return REACH_A[i] && !REACH_B[i];
  };
  for (const v of s.villagers) if (v.alive && v.st !== 'sheltered' && lost(v.x, v.y)) return { ok: false, reason: 'That would shut villagers in' };
  for (const u of s.soldiers) if (u.alive && lost(u.x, u.y)) return { ok: false, reason: 'That would shut soldiers in' };
  if (s.sovereign && s.sovereign.alive && lost(s.sovereign.x, s.sovereign.y)) return { ok: false, reason: 'That would shut the Sovereign in' };
  for (const b of s.buildings) {
    if (!b.alive || BUILDINGS[b.type]?.line || b === s.rt.hearth) continue;
    if (touches(REACH_A, b.tx, b.ty, b.size) && !touches(REACH_B, b.tx, b.ty, b.size)) return { ok: false, reason: `That would cut the ${BUILDINGS[b.type].name} off from the road` };
  }
  if (!touches(REACH_B, tx, ty, size)) return { ok: false, reason: 'No way in for the builders' };
  // A camp must keep a way to its woods or rock.
  for (const b of s.buildings) {
    const need = b.alive && BUILDINGS[b.type]?.needs;
    if (need && woodsReach(s, REACH_A, b, need) && !woodsReach(s, REACH_B, b, need)) return { ok: false, reason: `That would cut the ${BUILDINGS[b.type].name} off from its ${need === 'tree' ? 'trees' : 'rock'}` };
  }
  return null;
}
/** Can the camp's workers stand beside at least one of its trees (or rocks)? */
function woodsReach(s, reach, b, kind) {
  const cx = b.tx + b.size / 2, cy = b.ty + b.size / 2;
  const R = levelStats(b.type, b.level).radius + BAL.economy.campReach;
  for (const n of s.nodes) {
    if (n.kind !== kind || n.amount <= 0) continue;
    const dx = n.tx + 0.5 - cx, dy = n.ty + 0.5 - cy;
    if (dx * dx + dy * dy > R * R) continue;
    if (touches(reach, n.tx, n.ty, 1)) return true;
  }
  return false;
}
