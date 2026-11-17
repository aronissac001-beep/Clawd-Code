// The colony bot core (owner J; doc 14.4, 14.6): the scripted 1a player, its meters and the 1a
// targets. Pure ESM with relative imports and no Node built-ins, so it runs in Node (the CLI is
// tools/colonybot.mjs) and unchanged in a browser page (determinism and bench pages).
//
// v0 is a scripted sandbox. For every seed: the real new-colony flow (installSim('1a') + foundColony), then a player script
// sent only as C3 commands through applyCommand (the bot never writes state): roles, a stockpile,
// chop, a tunnel into the massif and a carved hall, a Workshop stamp with a Carpenter's bench, a
// row of three Bedroom stamps, then furniture placed in the hall once it is open, more chopping when
// wood runs low, more digging when the miners run dry. The script reads the state to decide (where
// the rock face is, when the hall is open), so it is a pure function of the state: the same seed
// gives the same command log and the same final hash (--twice checks that).
//
// 1a targets (doc 14.6), all on every seed:
//   mined     >= 80 tiles mined by colonists
//   hall      a carved hall of >= 40 open tiles whose pillar plan is valid: every open tile of the hall
//             supported (B's terrain.supported), the plan's natural pillars still standing, no tile of
//             the rect reported by support.planUnsupported, and no cave-in within 4 tiles of it
//             (a cave-in anywhere else is reported as a warning: collapse is Stage 2 scope)
//   bedrooms  3 stamped bedrooms whose blueprints are all finished, each with a bed installed (done)
//   idle      idle share < 30% of colonist work hours (schedule cells Work or Any; in 1a nobody
//             sleeps, so every hour also counts in the all-hours figure that is reported next to it)
//   haul      median haul latency (a stack appears needing a haul > it is stored) < 2 game hours;
//             stacks still waiting at the end count with their age so far (a lower bound)
// runBot also returns the accepted command log: replaying it on botFound(seed) repeats the run
// exactly (the determinism suite's 'bot' scene does that, in Node and in WebKit).
import { installSim, foundColony } from '../../js/game/core/setup.js';
import { tick } from '../../js/game/core/sim.js';
import { applyCommand } from '../../js/game/core/commands.js';
import { stateHash, checkState } from '../../js/game/core/state.js';
import { drain } from '../../js/game/core/events.js';
import { W, H, idx, inB, TER, TER_MINEABLE, TER_BUILDABLE, TER_WATER, TER_PASSABLE, DESIG } from '../../js/game/core/grid.js';
import { TICKS_PER_DAY, TICKS_PER_HOUR, TICKS_PER_MIN, hourOf } from '../../js/game/core/time.js';
import { all, def, structDef, sizeOf } from '../../js/game/core/content.js';
import { supported } from '../../js/game/world/terrain.js';
import { planUnsupported, mineAllowed } from '../../js/game/world/support.js';
import { getItem, categoryOf, inStockpile } from '../../js/game/work/items.js';
import { needsHaul } from '../../js/game/work/stockpiles.js';
import { stoneMode } from '../../js/game/work/haul.js';
import { SKILL_IDS, WORK_IDS } from '../../js/game/core/schema.js';
import { disabledWork } from '../../js/game/people/roles.js';
const WORK_IDX = Object.fromEntries(WORK_IDS.map((w, i) => [w, i]));

export const TARGETS_1A = Object.freeze({ mined: 80, hall: 40, bedrooms: 3, idleMax: 0.30, haulMedianMaxH: 2 });
const SCAN = TICKS_PER_MIN;          // haul bookkeeping cadence (1 game minute)
// The player picks wooden walls: a stamp without wallMat plans block walls (needOf takes the first
// costByMat entry), and no blocks exist before a Mason's bench (reported to A and G).
const WALL_MAT = 'wood';
const THINK = 60;                    // the script looks at the colony every 60 ticks (3 s at 1x)

// ---- layout helpers (read only) --------------------------------------------------------------------
const clampR = (x0, y0, x1, y1) => ({ x0: Math.max(0, Math.min(W - 1, Math.min(x0, x1))), y0: Math.max(0, Math.min(H - 1, Math.min(y0, y1))), x1: Math.max(0, Math.min(W - 1, Math.max(x0, x1))), y1: Math.max(0, Math.min(H - 1, Math.max(y0, y1))) });
const rectTiles = (r) => { const out = []; for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) out.push(idx(x, y)); return out; };
const rectsOverlap = (a, b, m = 0) => !(a.x1 + m < b.x0 || b.x1 + m < a.x0 || a.y1 + m < b.y0 || b.y1 + m < a.y0);
const hearthOf = (s) => { const h = s.colony.hearth; const b = h && h.id !== null ? s.bld[h.id] : null; return b ? { x: b.x + 1, y: b.y + 1, b } : { x: W >> 1, y: H >> 1, b: null }; };

/** Rings around (x, y): fn(x, y, r) -> truthy stops; returns that value. */
function rings(x, y, maxR, fn) {
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const v = fn(x + dx, y + dy, r);
      if (v) return v;
    }
  }
  return null;
}
/** Every tile of rect open, buildable, dry, explored, free of buildings, zones, trees and `taken` rects. */
function siteOk(s, r, taken) {
  if (r.x0 < 1 || r.y0 < 1 || r.x1 > W - 2 || r.y1 > H - 2) return false;
  for (const t of taken) if (rectsOverlap(r, t, 1)) return false;
  for (const i of rectTiles(r)) {
    const t = s.L.terrain[i];
    if (!TER_BUILDABLE[t] || TER_WATER[t] || t === TER.ROUGH) return false;
    if (s.rt.occ[i] >= 0 || s.L.zone[i] || s.L.plant[i]) return false;
    if (!(s.L.fog[i >> 3] & (1 << (i & 7)))) return false;
  }
  return true;
}
function findOpenSite(s, cx, cy, w, h, taken) {
  return rings(cx, cy, 40, (x, y) => { const r = { x0: x, y0: y, x1: x + w - 1, y1: y + h - 1 }; return siteOk(s, r, taken) ? r : null; });
}
const isRock = (s, x, y) => inB(x, y) && s.L.terrain[idx(x, y)] === TER.ROCK;
/** The best hall: a w x h rect of rock reached by a tunnel from the face, most rock inside, nearest the Hearth. */
function planDig(s) {
  const hx = hearthOf(s).x, hy = hearthOf(s).y;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const cands = [];
  // rock tiles on the face (rock next to open, explored ground) within 30 tiles of the Hearth
  for (let y = Math.max(1, hy - 30); y <= Math.min(H - 2, hy + 30); y++) {
    for (let x = Math.max(1, hx - 30); x <= Math.min(W - 2, hx + 30); x++) {
      if (!isRock(s, x, y)) continue;
      for (const [dx, dy] of dirs) {
        const ox = x - dx, oy = y - dy, oi = idx(ox, oy);
        if (!inB(ox, oy) || !TER_PASSABLE[s.L.terrain[oi]] || TER_WATER[s.L.terrain[oi]]) continue;
        if (!(s.L.fog[oi >> 3] & (1 << (oi & 7)))) continue;
        // tunnel 2 wide, 6 long, then a hall 9 deep x 7 wide (63 tiles), centred on the tunnel
        const T = 6, HD = 9, HW = 7;
        const at = (k, side) => [x + dx * k - dy * side, y + dy * k + dx * side];
        let rock = 0, bad = 0;
        for (let k = 0; k < T; k++) for (const sd of [0, 1]) { const [a, b] = at(k, sd); if (isRock(s, a, b)) rock++; else bad++; }
        const hallTiles = [];
        for (let k = T; k < T + HD; k++) for (let sd = -3; sd < HW - 3; sd++) { const [a, b] = at(k, sd); if (!inB(a, b)) { bad += 5; continue; } hallTiles.push([a, b]); if (isRock(s, a, b)) rock++; else bad++; }
        // the ring around the hall should stay rock (it holds the roof)
        let ring = 0;
        for (let k = T - 1; k <= T + HD; k++) for (let sd = -4; sd <= HW - 3; sd++) {
          if (k > T - 1 && k < T + HD && sd > -4 && sd < HW - 3) continue;
          const [a, b] = at(k, sd); if (isRock(s, a, b)) ring++;
        }
        const d = Math.abs(x - hx) + Math.abs(y - hy);
        cands.push({ x, y, dx, dy, score: rock * 10 - bad * 40 + ring * 2 - d, at, T, HD, HW, d });
      }
    }
  }
  if (!cands.length) return null;
  cands.sort((a, b) => b.score - a.score || a.d - b.d || a.y - b.y || a.x - b.x);
  const c = cands[0];
  const [t0x, t0y] = c.at(0, 0), [t1x, t1y] = c.at(c.T - 1, 1);
  const [h0x, h0y] = c.at(c.T, -3), [h1x, h1y] = c.at(c.T + c.HD - 1, c.HW - 4);
  // a side gallery off the hall for more digging later (2 wide, 10 long), on the far side
  const [g0x, g0y] = c.at(c.T + c.HD, 0), [g1x, g1y] = c.at(c.T + c.HD + 9, 1);
  return { face: [c.x, c.y], dir: [c.dx, c.dy], tunnel: clampR(t0x, t0y, t1x, t1y), hall: clampR(h0x, h0y, h1x, h1y), gallery: clampR(g0x, g0y, g1x, g1y), at: c.at, T: c.T, HD: c.HD };
}

// ---- the script ------------------------------------------------------------------------------------
/**
 * The bot's player. step(s) is called every THINK ticks and returns the commands to send now.
 * It keeps its own notes (the plan), never state.
 */
export function makePlayer(s) {
  const P = { phase: 0, plan: null, taken: [], bedrooms: [], workshop: null, hallFurnished: false, chopR: 12, chopAt: -1, chopping: true, digs: 0, zones: 1, lastDig: null, notes: [], rock0: null };
  P.rock0 = new Uint8Array(s.L.terrain.length);
  for (let i = 0; i < P.rock0.length; i++) P.rock0[i] = TER_MINEABLE[s.L.terrain[i]];
  const rockShare = (r) => { let k = 0, n = 0; for (const i of rectTiles(r)) { n++; if (s.L.terrain[i] === TER.ROCK) k++; } return n ? k / n : 0; };
  const hx = hearthOf(s).x, hy = hearthOf(s).y;
  const structIds = new Set(all('structure').map((d) => d.id));
  const bench = structIds.has('carpenter') ? 'carpenter' : (all('structure').find((d) => d.workbench) || {}).id;
  const note = (t) => P.notes.push(`${s.tick}: ${t}`);

  function opening() {
    const cmds = [];
    // roles: the best miner mines, the best builder builds, the rest haul (generalists if they cannot); backstories that
    // rule out work (F's disabledWork) are respected, and when only the miner can haul, the miner is
    // made a hauler who mines second (otherwise nothing is ever stored)
    const lvl = (c, sk) => { const k = SKILL_IDS.indexOf(sk); return k >= 0 ? c.sk[k][0] : 0; };
    const can = (c, w) => !disabledWork(c).includes(WORK_IDX[w]);
    const cols = s.col.slice().sort((a, b) => a.id - b.id);
    const used = new Set();
    const pick = (sk, w) => { let best = null; for (const c of cols) if (!used.has(c.id) && can(c, w) && (!best || lvl(c, sk) > lvl(best, sk))) best = c; if (best) used.add(best.id); return best; };
    const m = pick('mining', 'mine'), b = pick('construction', 'build');
    const otherHaulers = cols.filter((c) => c !== m && can(c, 'haul')).length;
    if (m) cmds.push(otherHaulers ? { t: 'role', colId: m.id, primary: 'miner', secondary: 'hauler' } : { t: 'role', colId: m.id, primary: 'hauler', secondary: 'miner' });
    if (b) cmds.push({ t: 'role', colId: b.id, primary: 'builder', secondary: 'crafter' });
    for (const c of cols) if (!used.has(c.id)) cmds.push({ t: 'role', colId: c.id, primary: can(c, 'haul') ? 'hauler' : 'generalist' });
    if (m && !otherHaulers) note(`only ${m.name} can haul: hauler first, miner second`);
    // the dig plan first, so no stamp lands on the tunnel mouth
    P.plan = planDig(s);
    if (P.plan) { P.taken.push(clampR(P.plan.tunnel.x0 - 2, P.plan.tunnel.y0 - 2, P.plan.tunnel.x1 + 2, P.plan.tunnel.y1 + 2)); note(`dig plan: face ${P.plan.face} dir ${P.plan.dir} hall ${JSON.stringify(P.plan.hall)}`); }
    // 1. a stockpile (preset All) by the Hearth
    const hb = hearthOf(s).b;
    if (hb) P.taken.push({ x0: hb.x - 1, y0: hb.y - 1, x1: hb.x + 3, y1: hb.y + 3 });
    const sp = findOpenSite(s, hx - 3, hy + 4, 6, 5, P.taken);
    if (sp) { cmds.push({ t: 'zone', op: 'new', type: 'stockpile', rect: sp, preset: 'all' }); P.taken.push(sp); P.stock = sp; }
    // 2. chop around the Hearth
    cmds.push({ t: 'designate', kind: 'chop', rect: clampR(hx - P.chopR, hy - P.chopR, hx + P.chopR, hy + P.chopR), add: true });
    // 3. the tunnel and the carved hall (natural pillars: the plan leaves rock standing)
    if (P.plan) {
      cmds.push({ t: 'designate', kind: 'mine', rect: P.plan.tunnel, add: true });
      cmds.push({ t: 'carve', rect: P.plan.hall, pattern: 'natural', smooth: false });
    }
    // 4. a workshop (7 x 5) with a Carpenter's bench
    const ws = findOpenSite(s, hx + 6, hy - 6, 7, 5, P.taken);
    if (ws) { cmds.push({ t: 'stamp', kind: 'workshop', rect: ws, furnish: true, wallMat: WALL_MAT, ...(bench ? { bench } : {}) }); P.taken.push(ws); P.workshop = ws; }
    // 5. three bedrooms in a row sharing walls (4 x 5 each: a 2 x 3 inside), doors facing the Hearth
    const row = findOpenSite(s, hx - 12, hy - 8, 10, 5, P.taken);
    if (row) {
      P.taken.push(row);
      const doorY = Math.abs(row.y0 - hy) < Math.abs(row.y1 - hy) ? row.y0 : row.y1;
      for (let k = 0; k < 3; k++) {
        const r = { x0: row.x0 + k * 3, y0: row.y0, x1: row.x0 + k * 3 + 3, y1: row.y1 };
        P.bedrooms.push(r);
        cmds.push({ t: 'stamp', kind: 'bedroom', rect: r, furnish: true, wallMat: WALL_MAT, door: { x: r.x0 + 1 + (k % 2), y: doorY } });
      }
    }
    return cmds;
  }

  function hallOpenShare() {
    if (!P.plan) return 0;
    let open = 0, n = 0;
    for (const i of rectTiles(P.plan.hall)) { n++; if (s.L.terrain[i] !== TER.ROCK && s.L.terrain[i] !== TER.RUBBLE) open++; }
    return n ? open / n : 0;
  }
  const looseWood = () => { let n = 0; for (const it of s.items) if (it && it.k === 'wood' && !it.f && !inStockpile(s, idx(it.x, it.y))) n += it.n; return n; };
  const woodStock = () => { let n = 0; for (const it of s.items) if (it && it.k === 'wood' && !it.f) n += it.n; return n; };
  /** Mine designations a miner may take now (B's support rule refuses the rest). */
  const minesLeft = () => { let n = 0; for (let i = 0; i < s.L.desig.length; i++) if ((s.L.desig[i] & DESIG.MINE) && TER_MINEABLE[s.L.terrain[i]] && mineAllowed(s, i)) n++; return n; };
  const chopsLeft = () => { let n = 0; for (let i = 0; i < s.L.desig.length; i++) if ((s.L.desig[i] & DESIG.CHOP) && s.L.plant[i]) n++; return n; };
  /** Free cells in storage zones (no stack, no building). */
  const freeStorage = () => { let n = 0; for (let i = 0; i < s.L.zone.length; i++) if (s.L.zone[i] && s.rt.itemAt[i] < 0 && s.rt.occ[i] < 0) n++; return n; };
  /**
   * The next room to dig: a 5 x 5 block of rock behind a 1-tile doorway from a tile the colony has
   * opened, at least 2 tiles from the hall (its walls hold its roof) and 3 from the map edge, with a
   * ring of rock all round it (so rooms never merge into one wide unsupported cave); nearest the last
   * dig first. Returns { door: rect, room: rect } or null.
   */
  function nextRoom(A = 5, B = 5, strictRing = true) {
    const hall = P.plan ? P.plan.hall : null;
    const last = P.lastDig || (P.plan ? P.plan.tunnel : { x0: hx, y0: hy, x1: hx, y1: hy });
    const lx = (last.x0 + last.x1) >> 1, ly = (last.y0 + last.y1) >> 1;
    let best = null, bd = Infinity;
    for (let i = 0; i < s.L.terrain.length; i++) {
      if (!(P.rock0[i] && s.L.terrain[i] === TER.ROUGH)) continue;
      const ox = i % W, oy = (i / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ex = ox + dx, ey = oy + dy;                     // the doorway
        if (!isRock(s, ex, ey) || (s.L.desig[idx(ex, ey)] & DESIG.MINE)) continue;
        for (let off = -4; off <= 0; off++) {
          const ax = ex + dx, ay = ey + dy;
          if (off < -(A - 1)) continue;
          // A tiles across the doorway direction, B tiles deep along it
          const r = dx ? clampR(ax, oy + off, ax + dx * (B - 1), oy + off + A - 1) : clampR(ox + off, ay, ox + off + A - 1, ay + dy * (B - 1));
          if ((dx ? r.y1 - r.y0 : r.x1 - r.x0) !== A - 1 || (dx ? r.x1 - r.x0 : r.y1 - r.y0) !== B - 1) continue;
          if (r.x0 < 3 || r.y0 < 3 || r.x1 > W - 4 || r.y1 > H - 4) continue;
          if (hall && rectsOverlap(r, hall, 2)) continue;
          let ok = true;
          for (let y = r.y0 - 1; y <= r.y1 + 1 && ok; y++) for (let x = r.x0 - 1; x <= r.x1 + 1 && ok; x++) {
            const j = idx(x, y), inside = x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
            if (inside || strictRing) { if (s.L.terrain[j] !== TER.ROCK || (s.L.desig[j] & DESIG.MINE)) ok = false; }
            else if (s.L.terrain[j] !== TER.ROCK && !(P.rock0[j] && s.L.terrain[j] === TER.ROUGH) && !(x === ex && y === ey)) ok = false;
          }
          if (!ok) continue;
          const d = Math.abs(((r.x0 + r.x1) >> 1) - lx) + Math.abs(((r.y0 + r.y1) >> 1) - ly);
          if (d < bd) { bd = d; best = { door: { x0: ex, y0: ey, x1: ex, y1: ey }, room: r }; }
        }
      }
    }
    return best;
  }

  function later() {
    const cmds = [];
    // furniture for the hall once most of it is open: a table and two chairs in the middle
    if (!P.hallFurnished && P.plan && hallOpenShare() >= 0.75) {
      const hr = P.plan.hall;
      const cx = (hr.x0 + hr.x1) >> 1, cy = (hr.y0 + hr.y1) >> 1;
      const spot = rings(cx, cy, 4, (x, y) => {
        const ok = (a, b) => inB(a, b) && s.L.terrain[idx(a, b)] === TER.ROUGH && s.rt.occ[idx(a, b)] < 0;
        const tw = sizeOf(structDef('table') || { size: [1, 1] }, 0)[0];
        for (let k = -1; k <= tw; k++) if (!ok(x + k, y)) return null;
        return [x, y];
      });
      if (spot && structIds.has('table')) {
        const [x, y] = spot;
        const tw = sizeOf(structDef('table'), 0)[0];
        cmds.push({ t: 'place', def: 'table', x, y, rot: 0 });
        if (structIds.has('chair')) { cmds.push({ t: 'place', def: 'chair', x: x - 1, y, rot: 0 }); cmds.push({ t: 'place', def: 'chair', x: x + tw, y, rot: 0 }); }
        note(`hall furniture at ${x},${y}`);
      }
      P.hallFurnished = true;
    }
    // more wood: widen the chop square when the trees inside it are gone and stock is low
    if (s.tick >= P.chopAt && woodStock() < 150 && chopsLeft() === 0 && looseWood() < 50 && P.chopR < 40) {
      P.chopR += 6; P.chopAt = s.tick + TICKS_PER_HOUR;
      cmds.push({ t: 'designate', kind: 'chop', rect: clampR(hx - P.chopR, hy - P.chopR, hx + P.chopR, hy + P.chopR), add: true });
      note(`chop radius ${P.chopR}`);
    }
    // enough wood: stop chopping (the player cancels the rest, so the stockpile does not fill with logs)
    if (P.chopping && woodStock() > 700) {
      P.chopping = false;
      cmds.push({ t: 'designate', kind: 'chop', rect: { x0: 0, y0: 0, x1: W - 1, y1: H - 1 }, add: false });
      note('enough wood: chop orders cancelled');
    } else if (!P.chopping && woodStock() < 250 && s.tick >= P.chopAt) {
      P.chopping = true; P.chopAt = s.tick + TICKS_PER_HOUR;
      cmds.push({ t: 'designate', kind: 'chop', rect: clampR(hx - P.chopR, hy - P.chopR, hx + P.chopR, hy + P.chopR), add: true });
    }
    // a full stockpile: paint another one by the Hearth (up to 5)
    if (P.zones < 5 && freeStorage() < 8) {
      const sp = findOpenSite(s, hx - 3, hy + 4, 6, 5, P.taken);
      if (sp) { cmds.push({ t: 'zone', op: 'new', type: 'stockpile', rect: sp, preset: 'all' }); P.taken.push(sp); note(`stockpile ${P.zones + 1} at ${JSON.stringify(sp)}`); }
      P.zones++;
    }
    // keep the miner busy: when fewer than 8 mine orders can be worked, dig the next room off the hold
    if (P.plan && hallOpenShare() >= 0.8 && minesLeft() < 8 && P.digs < 12) {
      const g = P.digs === 0 && rockShare(P.plan.gallery) > 0.9 ? { room: P.plan.gallery } : nextRoom(5, 5) || nextRoom(3, 5) || nextRoom(3, 3) || nextRoom(2, 4, false);
      if (g || !P.noRoom) P.digs++;
      if (g) {
        if (g.door) cmds.push({ t: 'designate', kind: 'mine', rect: g.door, add: true });
        cmds.push({ t: 'designate', kind: 'mine', rect: g.room, add: true });
        P.lastDig = g.room; note(`dig ${P.digs}: ${JSON.stringify(g.room)}`);
      }
      else if (!P.noRoom) { P.noRoom = true; note('no room left to dig near the hold'); }
    }
    return cmds;
  }

  return {
    notes: P,
    step() {
      if (P.phase === 0) { P.phase = 1; return opening(); }
      return later();
    },
  };
}

// ---- measuring (read only) -------------------------------------------------------------------------
function makeMeter(s) {
  const M = {
    workTicks: 0, idleWork: 0, allTicks: 0, idleAll: 0,
    minedBy: 0, minedAny: 0, caveIns: 0, caveTiles: [], built: 0, hauled: 0, events: 0,
    waiting: new Map(),    // item id -> { t0, ref }
    jobs: new Map(),       // colId -> { t0, srcs }
    lat: [], latRec: [], usedInPlace: 0, errors: [],
  };
  const rock0 = new Uint8Array(s.L.terrain.length);
  for (let i = 0; i < rock0.length; i++) rock0[i] = TER_MINEABLE[s.L.terrain[i]];
  M.rock0 = rock0;
  const stoneExempt = (it) => categoryOf(it.k) === 'stone' && stoneMode(s) !== 'always';
  M.beforeTick = () => {
    // haul jobs as they are now (the store toil ends the job inside the tick that emits 'hauled')
    for (const c of s.col) {
      const j = c.job;
      if (j && j.type === 'haul') {
        const cur = M.jobs.get(c.id);
        const srcs = j.toils.filter((t) => t.t === 'pickup').map((t) => t.id);
        if (!cur || cur.job !== j) {
          let t0 = s.tick;
          for (const id of srcs) { const w = M.waiting.get(id); if (w && w.t0 < t0) t0 = w.t0; }
          M.jobs.set(c.id, { job: j, t0, srcs });
        }
      } else if (M.jobs.has(c.id) && !(j && j.type === 'haul')) M.jobs.delete(c.id);
    }
  };
  M.afterTick = () => {
    const h = hourOf(s.tick);
    for (const c of s.col) {
      const idle = !c.job || c.job.type === 'idle';
      const cell = c.sched ? c.sched[h] : 1;
      M.allTicks++; if (idle) M.idleAll++;
      if (cell === 1 || cell === 3) { M.workTicks++; if (idle) M.idleWork++; }
    }
    for (const e of drain(s)) {
      M.events++;
      if (e.name === 'mined') { M.minedAny++; if (e.data && e.data.colId !== null && e.data.colId !== undefined) M.minedBy++; }
      else if (e.name === 'caveIn') { M.caveIns++; M.caveTiles.push(...((e.data && e.data.tiles) || [])); }
      else if (e.name === 'built') M.built++;
      else if (e.name === 'hauled') {
        M.hauled++;
        const jr = e.data ? M.jobs.get(e.data.colId) : null;
        if (jr) { M.lat.push(s.tick - jr.t0); const st = getItem(s, e.data.itemId); M.latRec.push([jr.t0, s.tick, st ? st.k : '?', e.data.colId]); for (const id of jr.srcs) M.waiting.delete(id); M.jobs.delete(e.data.colId); }
      }
    }
    if (s.tick % SCAN === 0) {
      // stacks that need a haul now; stale records (the stack is gone, or the slot holds another stack)
      for (const [id, w] of M.waiting) {
        const it = getItem(s, id);
        if (it === w.ref && !it.f && needsHaul(s, it)) continue;
        const carriedByHauler = [...M.jobs.values()].some((jr) => jr.srcs.includes(id));
        if (carriedByHauler) continue;
        if (it !== w.ref) M.usedInPlace++;          // taken by a builder or crafter, never stored
        M.waiting.delete(id);
      }
      for (const it of s.items) {
        if (!it || it.f || stoneExempt(it) || M.waiting.has(it.id)) continue;
        if (inStockpile(s, idx(it.x, it.y)) && !needsHaul(s, it)) continue;
        if (!needsHaul(s, it)) continue;
        M.waiting.set(it.id, { t0: s.tick, ref: it });
      }
    }
  };
  return M;
}
const median = (a) => { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };

/** Evaluate the 1a targets on the final state. */
function evaluate(s, M, P) {
  const r = {};
  // mined
  let minedTiles = 0;
  for (let i = 0; i < M.rock0.length; i++) if (M.rock0[i] && !TER_MINEABLE[s.L.terrain[i]]) minedTiles++;
  r.mined = { byColonists: M.minedBy, tilesOpened: minedTiles };
  // hall
  const plan = s.colony.plans.find((p) => p.kind === 'carve') || null;
  if (plan) {
    const q = plan.rect;
    let open = 0, unsup = 0, rockLeft = 0;
    for (const i of rectTiles(q)) {
      const t = s.L.terrain[i];
      if (t === TER.ROCK || t === TER.RUBBLE) { rockLeft++; continue; }
      open++;
      if (!supported(s, i)) unsup++;
    }
    const naturalStanding = plan.natural.filter((i) => s.L.terrain[i] === TER.ROCK).length;
    const pu = planUnsupported(s, q).length;
    const near = (i) => { const x = i % W, y = (i / W) | 0; return x >= q.x0 - 4 && x <= q.x1 + 4 && y >= q.y0 - 4 && y <= q.y1 + 4; };
    const hallCave = M.caveTiles.filter(near).length;
    r.hall = { rect: q, tiles: rectTiles(q).length, open, rockLeft, pillars: plan.pillars.length, natural: plan.natural.length, naturalStanding, unsupported: unsup, planUnsupported: pu, caveIns: hallCave,
      valid: unsup === 0 && pu === 0 && naturalStanding === plan.natural.length && hallCave === 0 };
  } else r.hall = { open: 0, valid: false, note: 'no carve plan' };
  // bedrooms: every structure of the stamp finished, and a finished bed inside
  r.bedrooms = P.bedrooms.map((q) => {
    let beds = 0, pending = 0;
    for (const b of s.bld) {
      if (!b) continue;
      const inside = b.x >= q.x0 && b.x <= q.x1 && b.y >= q.y0 && b.y <= q.y1;
      if (!inside) continue;
      if (b.st !== 'done') pending++;
      else if (b.def === 'bed') beds++;
    }
    const room = s.rt.room ? s.rt.room[idx(q.x0 + 1, q.y0 + 1)] : 0;
    return { rect: q, beds, pending, room };
  });
  r.bedroomsDone = r.bedrooms.filter((b) => b.beds >= 1 && b.pending === 0).length;
  r.bedsInstalled = r.bedrooms.filter((b) => b.beds >= 1).length;
  // idle
  r.idle = { work: M.workTicks ? +(M.idleWork / M.workTicks).toFixed(4) : 1, all: M.allTicks ? +(M.idleAll / M.allTicks).toFixed(4) : 1 };
  // haul latency (waiting stacks count with their age so far)
  const censored = [...M.waiting.values()].map((w) => s.tick - w.t0);
  const lat = M.lat.concat(censored);
  r.haul = { stored: M.lat.length, stillWaiting: censored.length, usedInPlace: M.usedInPlace, medianH: lat.length ? +(median(lat) / TICKS_PER_HOUR).toFixed(2) : null, medianStoredH: M.lat.length ? +(median(M.lat) / TICKS_PER_HOUR).toFixed(2) : null, p90H: lat.length ? +(lat.slice().sort((a, b) => a - b)[Math.floor(lat.length * 0.9)] / TICKS_PER_HOUR).toFixed(2) : null };
  // misc
  let bp = 0, frames = 0, done = 0;
  for (const b of s.bld) if (b) { if (b.st === 'bp') bp++; else if (b.st === 'frame') frames++; else done++; }
  r.buildings = { done, frames, blueprints: bp, builtEvents: M.built };
  const stock = {}; for (const it of s.items) if (it) stock[it.k] = (stock[it.k] || 0) + it.n;
  r.stock = stock;
  const T = TARGETS_1A;
  r.checks = [
    ['mined', M.minedBy >= T.mined, `${M.minedBy} tiles mined (>= ${T.mined})`],
    ['hall', r.hall.open >= T.hall && r.hall.valid, `hall ${r.hall.open} open tiles (>= ${T.hall}), pillar plan ${r.hall.valid ? 'valid' : 'INVALID'}${plan ? ` (${r.hall.natural} natural pillars, ${r.hall.unsupported} unsupported, ${r.hall.planUnsupported} plan-unsupported, ${r.hall.caveIns} cave-in tiles at the hall)` : ''}`],
    ['no cave-in (info)', M.caveIns === 0, `${M.caveIns} cave-ins in the run${M.caveTiles.length ? ' at ' + M.caveTiles.slice(0, 6).map((i) => `${i % W},${(i / W) | 0}`).join(' ') : ''} (support rule: mining never leaves a roof unsupported)`],
    ['bedrooms', r.bedroomsDone >= T.bedrooms, `${r.bedroomsDone} of ${P.bedrooms.length} stamped bedrooms finished, ${r.bedsInstalled} with a bed installed (>= ${T.bedrooms})`],
    ['idle', r.idle.work < T.idleMax, `idle ${(r.idle.work * 100).toFixed(1)}% of work hours (all hours ${(r.idle.all * 100).toFixed(1)}%) (< ${T.idleMax * 100}%)`],
    ['haul', r.haul.medianH !== null && r.haul.medianH < T.haulMedianMaxH, `median haul latency ${r.haul.medianH} h (stored only ${r.haul.medianStoredH} h; ${r.haul.stored} stored, ${r.haul.stillWaiting} waiting) (< ${T.haulMedianMaxH} h)`],
  ].map(([name, ok, detail]) => ({ name, ok: !!ok, detail }));
  for (const c of r.checks) if (/\(info\)/.test(c.name)) c.info = true;
  r.ok = r.checks.every((c) => c.ok || c.info);
  return r;
}

/**
 * Run the bot on one seed for `days` game days. Returns { seed, ok, hash, log, metrics, s }.
 * The command log ([tick, cmd] of every accepted command) replays the run exactly.
 */
export async function runBot({ seed = 1, days = 5, ticks = null, onDay = null } = {}) {
  installSim({ stage: '1a' });
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const s = botFound(seed);
  const start = s.tick, end = start + (ticks !== null ? ticks : days * TICKS_PER_DAY);
  const player = makePlayer(s);
  const M = makeMeter(s);
  const log = [];
  const refused = [];
  let error = null;
  try {
    while (s.tick < end) {
      if ((s.tick - start) % THINK === 0) {
        for (const cmd of player.step()) {
          const res = applyCommand(s, cmd, log);
          if (!res.ok) refused.push([s.tick, cmd.t, res.reason]);
        }
      }
      M.beforeTick();
      tick(s);
      M.afterTick();
      if (onDay && (s.tick - start) % TICKS_PER_DAY === 0) onDay(s, (s.tick - start) / TICKS_PER_DAY);
    }
  } catch (e) { error = `tick ${s.tick}: ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}`; }
  const metrics = evaluate(s, M, player.notes);
  const errs = checkState(s);
  if (errs.length) metrics.checks.push({ name: 'state valid', ok: false, detail: errs.slice(0, 3).join('; ') });
  if (error) metrics.checks.push({ name: 'no exception', ok: false, detail: error });
  metrics.ok = metrics.checks.every((c) => c.ok || c.info);
  metrics.latRec = M.latRec;
  return { seed, days, ok: metrics.ok, hash: stateHash(s), ticks: s.tick - start, ms: Math.round((typeof performance !== 'undefined' ? performance.now() : 0) - t0), log, refused, notes: player.notes.notes, metrics, s };
}

/** The bot's new colony for a seed (the real title > New colony flow). */
export function botFound(seed) { installSim({ stage: '1a' }); return foundColony({ seed, name: `Bot Hold ${seed}` }); }

/** A bot colony at `days` (bench and save-size checks use it: blob < 40 KB at bot day 5). */
export async function botColony(seed = 1, days = 5) { return (await runBot({ seed, days })).s; }

