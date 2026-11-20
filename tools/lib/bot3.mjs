// The colony bot v3 (Stage Z1, EMBERCROWN-FORTRESS.md 8.3 step E12; owner J). Pure ESM with relative imports
// and no Node built-ins (runs in Node and in a browser page, like bot v2).
//
// v3 plays a FORTRESS (a 128 x 128 x 20 world from mapgen3, the `?fortress=1` new colony) with v2's whole
// policy on the surface level and a deep plan below it, every order a C3 v3 command with its level (the
// Levels chip of the UI: rect.z, place z):
//   surface   v2 (tools/lib/bot2.mjs makePolicy) unchanged, on level zS (bot.mjs setBotLevel): its plans read
//             and order on that level; every command it sends without a level gets zS (levelCommand)
//   shaft     from day SHAFT_DAY, a 3 x 1 stair stack from the surface near the Hearth down to -6 (one
//             designate { kind: 'stairs', levels: 7, dir: 'down' })
//   levels    as the stairs reach them: bedrooms on -2 (soil: 5 x 5 rooms off a corridor, a door each), a
//             workshop hall on -3 (stone: 9 x 5), a store on -6 at the shaft foot (7 x 5, a stockpile)
//   benches   once the hall on -3 is open, every bench v2 places goes there while it has room (v2's own
//             place command, moved to the deep level); the first two benches v3 places itself (mason, carpenter)
//   beds      every bed v2 places goes to the bedrooms on -2 while they have room
// The same seed gives the same command log and the same final hash.
//
// Meters (read only), the Z1 gate (8.3): the shaft's depth, roofed rooms by level, benches below -2, raids
// and whether any was fought below the surface (a foe and a colonist within 1.5 tiles on one level under zS).
import { installSim } from '../../js/game/core/setup.js';
import { createColony } from '../../js/game/core/state.js';
import { W, H, idx, inB, tz, TER, TER_MINEABLE, TER_PASSABLE, TER_BUILDABLE, TER_UP, TER_DOWN, PLANE } from '../../js/game/core/grid.js';
import { START_TICK, TICKS_PER_DAY, TICKS_PER_HOUR, hourOf } from '../../js/game/core/time.js';
import { all, def, structDef, sizeOf } from '../../js/game/core/content.js';
import { DIFFICULTIES, SKILL_IDS, WORK_IDS } from '../../js/game/core/schema.js';
import { disabledWork } from '../../js/game/people/roles.js';
import { generateWorld3 } from '../../js/game/world/mapgen3.js';
import { coverRebuild, skyZRebuild } from '../../js/game/world/vertical.js';
import { planUnsupported, mineAllowed } from '../../js/game/world/support.js';
import { hearthStartFuel } from '../../js/game/world/fuel.js';
import { startingBand, spawnColonist } from '../../js/game/people/colonists.js';
import { spawn as spawnItem } from '../../js/game/work/items.js';
import { setBotLevel, levelCommand, hearthOf } from './bot.mjs';
import { runBot2 } from './bot2.mjs';
import { staleHauls } from '../../js/game/work/haul.js';
import { foodDays } from '../../js/game/work/givers/animals.js';
import { GROW_GIVER } from '../../js/game/work/givers/grow.js';
import { incidentDef } from '../../js/game/threat/incidents.js';
import { goalOf } from '../../js/game/threat/raidplan.js';

export const FORT = Object.freeze({ w: 128, d: 20, zS: 14 });
export const SHAFT_DAY = 3;          // the shaft is ordered from day 3 (the first night's work first)
export const SHAFT_LATE = 12;        // ... or three from day 12
export const SHAFT_HANDS = 4;        // and once the hold has four colonists (seed 3: three hands digging six levels in
                                     // the first days lost the grower to taint and two more to hunger; without the shaft all lived)
export const SHAFT_LEVELS = 7;       // the surface and six below: -6
export const TARGETS_Z1 = Object.freeze({ days: 30, shaft: 6, roofLevels: 3, deepBenchBelow: -2, raids: 2, starvation: 0, idleMax: 0.30, haulMedianMaxH: 2, saveKB: 85 });

/**
 * A new fortress (the `?fortress=1` new colony): createColony at 128 x 128 x 20 with the surface on 14, mapgen3's
 * world (generateWorld3: the Hearth, the pristine world, the opening reveal), then the start's band and stock on the
 * surface as foundColony places them on a D = 1 map.
 */
export function foundFortress(seed, { storyteller = null, difficulty = null, name = null } = {}) {
  installSim({ stage: '2' });
  const s = createColony(seed, { w: FORT.w, d: FORT.d, zS: FORT.zS, name: name || `Bot Fort ${seed}` });
  s.tick = START_TICK;
  if (difficulty !== null && difficulty !== undefined) { if (!DIFFICULTIES.includes(difficulty)) throw new Error(`foundFortress: unknown difficulty ${difficulty}`); s.colony.difficulty = difficulty; }
  if (storyteller) { if (!def('storyteller', storyteller)) throw new Error(`foundFortress: unknown storyteller ${storyteller}`); s.colony.storyteller = storyteller; }
  const st = all('start').find((x) => x.default) || null;
  if (st) s.colony.starts = st.id;
  const info = generateWorld3(s);
  // (E12 finding, request to A: rtcontract has no `cover` / `skyZ` rows, so every temperature pass rebuilt cover
  // for all N voxels, 8 ms a tick. The bot keeps them as the INC rows the contract names; refreshColumn patches
  // them on every terrain change, so the run is the same, only faster.)
  if (!s.rt.cover) s.rt.cover = coverRebuild(s);
  if (!s.rt.skyZ) s.rt.skyZ = skyZRebuild(s);
  hearthStartFuel(s);
  const zs = FORT.zS, h = info.hearth;
  const band = st ? startingBand(s, st.id) : [];
  const spots = (info.spawn || []).map((i) => [i % W, ((i % PLANE) / W) | 0]);
  for (let r = 2; spots.length < band.length + 12 && r < 12; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const x = h.cx + dx, y = h.cy + dy; if (!inB(x, y)) continue;
    const i = idx(x, y, zs); if (s.rt.walkCost[i] && s.rt.walkCost[i] < 15 && !s.L.plant[i] && s.rt.occ[i] < 0 && !spots.some((p) => p[0] === x && p[1] === y)) spots.push([x, y]);
  }
  band.forEach((c, k) => { const p = spots[k] || [h.cx, h.cy + 2]; spawnColonist(s, c, p[0], p[1]); c.z = zs; });
  if (st && st.items) {
    let k = band.length + 2;
    for (const key of Object.keys(st.items).sort()) {
      const [kind, mat] = key.split(':');
      if (!def('item', kind)) continue;
      const p = spots[k++] || [h.cx - 3, h.cy];
      spawnItem(s, kind, mat || null, 1, st.items[key], p[0], p[1], { z: zs });
    }
  }
  setBotLevel(zs);
  return s;
}

// ---- the deep plan -----------------------------------------------------------------------------------
const isStair = (t) => TER_UP[t] === 1 || TER_DOWN[t] === 1;
const rectIn = (r, x, y) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
const rect = (x0, y0, x1, y1, z) => ({ x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1), z });

/** v2's policy with v3's deep plan layered on it (see the header). */
export function makeDeep(s, base) {
  setBotLevel(s.zS);
  const zS = s.zS;
  const D3 = { shaft: null, rooms: [], placedDeep: 0, benchesOwn: 0, notes: [] };
  const note = (t) => { D3.notes.push(`d${Math.floor(s.tick / TICKS_PER_DAY)} ${t}`); base.notes.notes.push(`[v3] ${t}`); };
  const T = s.L.terrain;
  // open: no rock left that may be mined (a tile the support rule keeps, F20, stays as a natural pillar)
  const open = (r) => { for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) { const i = idx(x, y, r.z); if (TER_MINEABLE[T[i]] && mineAllowed(s, i)) return false; } return true; };
  const allRock = (r, m = 1) => { for (let y = r.y0 - m; y <= r.y1 + m; y++) for (let x = r.x0 - m; x <= r.x1 + m; x++) { if (!inB(x, y)) return false; if (!TER_MINEABLE[T[idx(x, y, r.z)]]) return false; } return true; };
  const reached = (z) => D3.shaft && isStair(T[idx(D3.shaft.x0 + 1, D3.shaft.y0, z)]) && TER_UP[T[idx(D3.shaft.x0 + 1, D3.shaft.y0, z)]] === 1;

  // the shaft: a 3 x 1 strip of open buildable ground near the Hearth whose columns are rock for 7 levels below and
  // that has room south of it on every level for the rooms (rock), nearest the Hearth
  function planShaft() {
    const h = hearthOf(s);
    for (let r = 4; r < 30; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x0 = h.x + dx, y0 = h.y + dy;
      if (x0 < 8 || y0 < 3 || x0 + 10 > W || y0 + 12 > H) continue;
      let ok = true;
      for (let x = x0; x <= x0 + 2 && ok; x++) {
        const i = idx(x, y0, zS), t = T[i];
        if (!TER_BUILDABLE[t] || !TER_PASSABLE[t] || s.rt.occ[i] >= 0 || s.L.zone[i] || s.L.plant[i] || s.L.desig[i]) ok = false;
        for (let z = zS - SHAFT_LEVELS + 1; z < zS && ok; z++) if (!TER_MINEABLE[T[idx(x, y0, z)]]) ok = false;
      }
      if (!ok) continue;
      // the rooms below: rock with a margin
      if (!allRock(rect(x0 - 3, y0 + 2, x0 + 5, y0 + 9, zS - 2), 1) || !allRock(rect(x0 - 3, y0 + 2, x0 + 5, y0 + 6, zS - 3), 1) || !allRock(rect(x0 - 2, y0 + 1, x0 + 4, y0 + 5, zS - 6), 1)) continue;
      // keep it off v2's base (its taken rects are not visible here: stay clear of buildings and zones on the surface)
      let busy = false;
      for (let y = y0 - 2; y <= y0 + 2 && !busy; y++) for (let x = x0 - 2; x <= x0 + 4 && !busy; x++) { const i = idx(x, y, zS); if (s.rt.occ[i] >= 0 || s.L.zone[i]) busy = true; }
      if (busy) continue;
      return { x0, y0, x1: x0 + 2, y1: y0, z: zS };
    }
    return null;
  }

  // the rooms: [level, use, rect, door or null]
  function planRooms(sh) {
    const x0 = sh.x0, y0 = sh.y0, out = [];
    // -2: a corridor south from the shaft's middle, three 3 x 3 bedrooms off it (soil: small spans), doors in their necks
    const z2 = zS - 2;
    out.push({ z: z2, use: 'corridor', rect: rect(x0 + 1, y0 + 1, x0 + 1, y0 + 8, z2) });
    out.push({ z: z2, use: 'bedroom', rect: rect(x0 - 3, y0 + 2, x0 - 1, y0 + 4, z2), neck: { x: x0, y: y0 + 3 } });
    out.push({ z: z2, use: 'bedroom', rect: rect(x0 + 3, y0 + 2, x0 + 5, y0 + 4, z2), neck: { x: x0 + 2, y: y0 + 3 } });
    out.push({ z: z2, use: 'bedroom', rect: rect(x0 - 3, y0 + 6, x0 - 1, y0 + 8, z2), neck: { x: x0, y: y0 + 7 } });
    out.push({ z: z2, use: 'bedroom', rect: rect(x0 + 3, y0 + 6, x0 + 5, y0 + 8, z2), neck: { x: x0 + 2, y: y0 + 7 } });
    // -3: the workshop hall, 9 x 5, one tile south of the shaft (a neck from the shaft's middle)
    const z3 = zS - 3;
    out.push({ z: z3, use: 'workshop', rect: rect(x0 - 3, y0 + 2, x0 + 5, y0 + 6, z3), neck: { x: x0 + 1, y: y0 + 1 } });
    // -6: the store at the shaft foot, 7 x 5, opening straight onto the stairs
    const z6 = zS - 6;
    out.push({ z: z6, use: 'store', rect: rect(x0 - 2, y0 + 1, x0 + 4, y0 + 5, z6) });
    return out;
  }

  // a free spot of w x h on the floor of a deep room: open floor, no building, a free tile all round (the aisle)
  function deepSite(q, w, h) {
    const r = q.rect;
    for (let y = r.y0 + 1; y + h - 1 <= r.y1 - 1; y += 1) for (let x = r.x0 + 1; x + w - 1 <= r.x1 - 1; x += 1) {
      let ok = true;
      for (let yy = y - 1; yy <= y + h && ok; yy++) for (let xx = x - 1; xx <= x + w && ok; xx++) {
        const i = idx(xx, yy, r.z), inside = yy >= y && yy < y + h && xx >= x && xx < x + w;
        if (s.rt.occ[i] >= 0) ok = false;
        else if (inside && (!TER_BUILDABLE[T[i]] || isStair(T[i]) || s.L.zone[i] || s.L.desig[i])) ok = false;
        else if (!inside && rectIn(r, xx, yy) && !TER_PASSABLE[T[i]]) ok = false;
      }
      if (ok) return { x, y };
    }
    return null;
  }
  const roomOf = (use) => D3.rooms.filter((q) => q.use === use && q.dug);
  // the digger: like a player tapping "dig this now", one fit colonist (the best miner who can mine and is not
  // already digging) is set on the next voxel of the plan every game hour while the plan has digging left: the
  // top undug stair of the shaft, else a designated rock tile of an ordered room next to open floor. v2's own
  // digging keeps the miners busy on the surface, so the deep plan waited for days without this.
  const MINE_W = WORK_IDS.indexOf('mine'), MINING = SKILL_IDS.indexOf('mining');
  function nextDig() {
    const sh = D3.shaft;
    for (let z = zS; z > zS - SHAFT_LEVELS; z--) for (let x = sh.x0; x <= sh.x1; x++) { const i = idx(x, sh.y0, z); if (!isStair(T[i])) return { x, y: sh.y0, z }; }
    for (const q of D3.rooms) {
      if (!q.ordered || q.dug) continue;
      const parts = (q.neck ? [rect(q.neck.x, q.neck.y, q.neck.x, q.neck.y, q.z)] : []).concat([q.rect]);
      for (const r of parts) for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
        const i = idx(x, y, q.z);
        if (!TER_MINEABLE[T[i]] || !(s.L.desig[i] & 1) || !mineAllowed(s, i)) continue;
        if ([i - 1, i + 1, i - W, i + W].some((j) => TER_PASSABLE[T[j]])) return { x, y, z: q.z };
      }
    }
    return null;
  }
  function digger() {
    if (!D3.shaft || D3.done) return [];
    const tg = nextDig();
    if (!tg) { if (D3.rooms.every((q) => q.dug)) { D3.done = s.tick; note('deep plan dug'); } return []; }
    const busy = (c) => c.job && (c.job.type === 'vdig' || c.job.type === 'mine');
    if (s.col.some((c) => !c.hp.dead && busy(c))) return [];
    // fed and rested (a prioritised job runs to its end: a hungry digger starved on seed 1)
    const fit = s.col.filter((c) => !c.hp.dead && !c.hp.down && !c.drafted && !c.breakState && c.need[0] > 5000 && c.need[1] > 4000 && !disabledWork(c).includes(MINE_W) && !(c.role && ['cook', 'grower', 'doctor'].includes(c.role[0]))).sort((a, b) => b.sk[MINING][0] - a.sk[MINING][0] || a.id - b.id);
    if (!fit.length) return [];
    return [{ t: 'prioritise', colId: fit[0].id, target: tg, work: 'mine' }];
  }
  const OWN_BENCHES = ['mason', 'carpenter'];

  // four hands, or three once the hold has had SHAFT_LATE days to grow (gate E12, seed 4: a band cut to three by
  // taint never reached four until day 27 and the deep plan had no time left)
  const handsFor = (day) => { const n = s.col.filter((c) => !c.hp.dead).length; return n >= SHAFT_HANDS || (n >= SHAFT_HANDS - 1 && day >= SHAFT_LATE); };
  function deepStep() {
    const cmds = [];
    const day = Math.floor((s.tick - START_TICK) / TICKS_PER_DAY) + 1;
    if (!D3.shaft && day >= SHAFT_DAY && s.tick % TICKS_PER_HOUR === 0 && !D3.noShaft && handsFor(day) && foodDays(s) >= 3) {
      const sh = planShaft();
      if (!sh) { D3.noShaft = true; note('no site for the stair shaft'); return cmds; }
      D3.shaft = sh;
      cmds.push({ t: 'designate', kind: 'stairs', rect: { ...sh }, levels: SHAFT_LEVELS, dir: 'down', add: true });
      D3.rooms = planRooms(sh);
      note(`stair shaft ${sh.x0},${sh.y0} on ${zS} down ${SHAFT_LEVELS - 1} levels`);
      return cmds;
    }
    if (!D3.shaft || s.tick % TICKS_PER_HOUR !== 0) return cmds;
    // the digger waits while a raid is on and while food is short (seed 3: three colonists digging six levels
    // in the first days while the larder ran dry starved two of them)
    if (!s.raids.some((r) => r.stage === 'active') && foodDays(s) >= 3) cmds.push(...digger());
    for (const q of D3.rooms) {
      // dig a level's rooms once the stairs reach it
      if (!q.ordered && reached(q.z)) {
        const parts = [q.rect].concat(q.neck ? [rect(q.neck.x, q.neck.y, q.neck.x, q.neck.y, q.z)] : []);
        const un = planUnsupported(s, q.rect, null).length;
        if (un) note(`room ${q.use} on ${q.z - zS}: ${un} tiles would be unsupported (dug anyway)`);
        for (const r of parts) cmds.push({ t: 'designate', kind: 'mine', rect: { ...r }, add: true });
        q.ordered = s.tick;
        note(`dig ${q.use} on ${q.z - zS} ${JSON.stringify(q.rect)}`);
      }
      if (q.ordered && !q.dug && open(q.rect) && (!q.neck || !TER_MINEABLE[T[idx(q.neck.x, q.neck.y, q.z)]])) {
        q.dug = s.tick;
        note(`${q.use} on ${q.z - zS} open`);
        if (q.neck && q.use !== 'corridor') cmds.push({ t: 'place', def: 'door', x: q.neck.x, y: q.neck.y, z: q.z, rot: 0 });
        if (q.use === 'store') { cmds.push({ t: 'zone', op: 'new', type: 'stockpile', rect: rect(q.rect.x0, q.rect.y0 + 1, q.rect.x1, q.rect.y1, q.z), preset: 'all' }); }
        // a bedroom: a bed (one each) and a torch sconce by the door (v2's housing counts the beds)
        if (q.use === 'bedroom') {
          cmds.push({ t: 'place', def: 'bed', x: q.rect.x0 + 1, y: q.rect.y0, z: q.z, rot: 0 });
          if (structDef('sconce')) cmds.push({ t: 'place', def: 'sconce', x: q.neck.x < q.rect.x0 ? q.rect.x0 : q.rect.x1, y: q.rect.y1, z: q.z, rot: 0 });
        }
      }
    }
    // v3's own first benches in the hall
    const hall = roomOf('workshop')[0];
    if (hall && D3.benchesOwn < OWN_BENCHES.length) {
      const d = OWN_BENCHES[D3.benchesOwn], sd = structDef(d);
      if (sd) {
        const [w, h] = sizeOf(sd, 0), at = deepSite(hall, w, h);
        if (at) { cmds.push({ t: 'place', def: d, x: at.x, y: at.y, z: hall.z, rot: 0 }); note(`bench ${d} on ${hall.z - zS} at ${at.x},${at.y}`); }
      }
      D3.benchesOwn++;
    }
    return cmds;
  }

  // v2's benches and beds, moved below while the deep rooms have room
  const BASE_KEEP = new Set(['campfire', 'study', 'shrine', 'dicetable', 'windmill', 'granary', 'trainingyard', 'smokehouse', 'brazier', 'sconce', 'door', 'grave', 'bloomery', 'forge', 'charkiln']);
  function redirect(c) {
    if (c.t !== 'place' || c.z !== undefined) return c;
    const sd = structDef(c.def);
    if (!sd) return c;
    if (c.def === 'bed') {
      for (const q of roomOf('bedroom')) {
        if (s.bld.some((b) => b && b.def === 'bed' && b.z === q.z && rectIn(q.rect, b.x, b.y))) continue;   // one bed a bedroom
        const at = deepSite(q, ...sizeOf(sd, c.rot | 0));
        if (at) { D3.placedDeep++; return { ...c, x: at.x, y: at.y, z: q.z }; }
      }
      return c;
    }
    if (sd.cat === 'workshops' && !BASE_KEEP.has(c.def)) {
      const hall = roomOf('workshop')[0];
      if (!hall) return c;
      const at = deepSite(hall, ...sizeOf(sd, c.rot | 0));
      if (at) { D3.placedDeep++; note(`bench ${c.def} moved to ${hall.z - zS}`); return { ...c, x: at.x, y: at.y, z: hall.z }; }
    }
    return c;
  }

  // the deep hold: against a raid that hunts people (beasts, reavers, a breach: goal 'people'), the line waits
  // in the corridor on -2 instead of on the surface, so the raid comes down the stairs to it, one at a time
  function deepHold(c) {
    if (c.t !== 'order' || (c.kind !== 'move' && c.kind !== 'attack') || !c.target) return c;
    const corr = D3.rooms.find((q) => q.use === 'corridor' && q.dug);
    if (!corr) return c;
    const hunt = s.raids.some((r) => r.stage !== 'ended' && r.stage !== 'warned' && goalOf(incidentDef(r.inc)) === 'people');
    if (!hunt) return c;
    if (!D3.heldDeep) { D3.heldDeep = s.tick; note('the line holds on -2 against a hunting raid'); }
    // a foe that has come down to the hold's levels is fought where it stands
    if (c.kind === 'attack' && c.target.id !== undefined) { const f = s.foes.find((x) => x.id === c.target.id); if (f && (f.z | 0) < zS) return c; }
    return { ...c, kind: 'move', target: { x: corr.rect.x0, y: corr.rect.y0 + 3, z: corr.z } };
  }

  // the famine hand (gate E12, seed 4): with the larder empty and ripe crops waiting, a player taps "harvest this
  // now": every game hour, while no grower can work, each fit colonist not already harvesting is set on the
  // nearest ripe crop. v2's role
  // slots add a second grower only from four colonists; a band of three with its grower in a break starved
  // beside 102 ripe hearthroots.
  const GROW_W = WORK_IDS.indexOf('grow');
  function famine() {
    if (s.tick % TICKS_PER_HOUR !== 0 || foodDays(s) >= 1 || s.raids.some((r) => r.stage === 'active')) return [];
    // only while no grower can work (dead, down or in a break): a working grower harvests on its own
    if (s.col.some((c) => !c.hp.dead && !c.hp.down && !c.drafted && !c.breakState && c.role && c.role[0] === 'grower')) return [];
    const cmds = [], taken = new Set();
    for (const c of s.col) {
      if (c.hp.dead || c.hp.down || c.drafted || c.breakState || disabledWork(c).includes(GROW_W) || c.sched[hourOf(s.tick)] !== 1) continue;
      if (c.job && (c.job.type === 'harvest' || c.job.type === 'eat')) continue;
      const t = GROW_GIVER.candidates(s, c, 4).find((q) => q.what === 'harvest' && !taken.has(q.i));
      if (!t) continue;
      taken.add(t.i);
      cmds.push({ t: 'prioritise', colId: c.id, target: { x: t.i % W, y: ((t.i % (W * s.h)) / W) | 0, z: (t.i / (W * s.h)) | 0 }, work: 'grow' });
    }
    return cmds;
  }

  return {
    notes: base.notes,
    D3,
    step() {
      // the haul hand (E13 gate, seed 4): a small hold whose hands all have work of their own hauls a stack only once
      // it is URGENT_H (16 h) stale, so wood lay 17 h; a player names a hauler early while 6 or more stacks are stale (8 h)
      // from day 12 (the shaft has its hands first), and lets the role go once the backlog is under 2 (v2's roleSlots reads Q.haulEarly; v2 never sets it)
      const stale = staleHauls(s).length;
      if (!base.Q.haulEarly && stale >= 6 && s.tick >= START_TICK + SHAFT_LATE * TICKS_PER_DAY) { base.Q.haulEarly = true; note(`haul hand: ${stale} stale stacks, a hauler early`); }
      else if (base.Q.haulEarly && stale < 2) base.Q.haulEarly = false;
      const cmds = base.step().map((c) => levelCommand(deepHold(redirect(c)), zS));
      cmds.push(...famine());
      cmds.push(...deepStep());
      return cmds;
    },
  };
}

// ---- measuring (read only) ----------------------------------------------------------------------------
/** The Z1 meter: per tick, foes and colonists side by side below the surface while a raid is live. */
export function makeMeter3(s) {
  const X = { deepFights: new Map(), deepTicks: 0, maxDepth: 0, colDeep: 0, foeDepth: new Map(), gen: new Set(s.bld.filter(Boolean)) };
  return {
    X,
    onTick(st) {
      if (st.tick % 20) return;
      for (const c of st.col) if (!c.hp.dead && (c.z | 0) < st.zS) { const d = st.zS - (c.z | 0); if (d > X.maxDepth) X.maxDepth = d; }
      // hostile animals hunting the hold (manhunters) count as foes here
      const hunters = st.anim.filter((a) => a && !(a.hp && a.hp.dead) && a.st && a.st.mode === 'manhunt');
      for (const a of hunters) if ((a.z | 0) < st.zS) for (const c of st.col) if (!c.hp.dead && (c.z | 0) === (a.z | 0) && Math.max(Math.abs(c.x - a.x), Math.abs(c.y - a.y)) <= 48) { X.deepTicks++; X.deepFights.set('anim', (X.deepFights.get('anim') || 0) + 1); break; }
      if (!st.foes.length) return;
      for (const f of st.foes) if (f && f.raid !== undefined) { const d = st.zS - (f.z | 0); if (d > (X.foeDepth.get(f.raid) || 0)) X.foeDepth.set(f.raid, d); }
      for (const f of st.foes) {
        if (!f || f.dead || (f.hp && f.hp.dead) || (f.z | 0) >= st.zS) continue;
        for (const c of st.col) {
          if (c.hp.dead || (c.z | 0) !== (f.z | 0)) continue;
          if (Math.max(Math.abs(c.x - f.x), Math.abs(c.y - f.y)) <= 48) { X.deepTicks++; const k = f.raid === undefined ? -1 : f.raid; X.deepFights.set(k, (X.deepFights.get(k) || 0) + 1); break; }
        }
      }
    },
  };
}

/** The Z1 gate rows for one finished run. */
export function evaluate3(s, r, X3, deep, days) {
  const T = TARGETS_Z1, zS = s.zS, m = r.metrics, out = {};
  let shaft = 0;
  if (deep.D3.shaft) {
    const sx = deep.D3.shaft.x0 + 1, sy = deep.D3.shaft.y0;
    for (let z = zS - 1; z >= 0; z--) { const t = s.L.terrain[idx(sx, sy, z)]; if (TER_UP[t] === 1 && TER_DOWN[s.L.terrain[idx(sx, sy, z + 1)]] === 1) shaft = zS - z; else break; }
  }
  out.shaft = shaft;
  // the hold's roofed rooms: a roofed room holding a finished building of the hold or a stockpile tile (the
  // generated caverns and ruins are rooms too, and do not count)
  const lv = new Set(); const roofedBy = {}; const seen = new Set();
  const rooms = s.rt.rooms || [], room = s.rt.room;
  const take = (i) => { const rid = room ? room[i] : 0, q = rid ? rooms[rid] : null; if (!q || !q.roofed || q.n < 4 || seen.has(rid)) return; seen.add(rid); const z = tz(i) - zS; lv.add(z); roofedBy[z] = (roofedBy[z] || 0) + 1; };
  for (const b of s.bld) if (b && b.st === 'done' && !X3.gen.has(b) && structDef(b.def) && structDef(b.def).cat !== 'walls') take(idx(b.x, b.y, b.z | 0));
  for (let i = 0; i < s.L.zone.length; i++) if (s.L.zone[i]) { const z = s.zones.find((q) => q.id === s.L.zone[i]); if (z && z.type === 'stockpile') take(i); }
  out.roofLevels = [...lv].sort((a, b) => b - a); out.roofedBy = roofedBy;
  const benches = s.bld.filter((b) => b && b.st === 'done' && structDef(b.def) && structDef(b.def).cat === 'workshops' && (b.z | 0) - zS < T.deepBenchBelow);
  out.deepBenches = benches.map((b) => `${b.def}@${(b.z | 0) - zS}`);
  const repelled = m.majors.filter((x) => x.result === 'repelled' || x.result === 'fled' || x.result === 'routed');
  out.raids = m.majors.map((x) => `${x.inc} d${x.day} ${x.result} warn ${x.warnH} h`);
  out.deepFightTicks = X3.deepTicks; out.colMaxDepth = X3.maxDepth; out.foeDepth = Object.fromEntries(X3.foeDepth);
  const starved = (m.deaths || []).filter((d) => d.cause === 'starvation').length;
  out.checks = [
    ['colony alive', m.colonists.alive > 0 && s.colony.fallen !== true, `${m.colonists.alive} of ${m.colonists.total} alive (peak ${m.colonists.peak}); deaths ${JSON.stringify(m.deathCauses)}`],
    [`stair shaft to -${T.shaft} or deeper`, shaft >= T.shaft, `shaft reaches -${shaft}${deep.D3.shaft ? ` at ${deep.D3.shaft.x0},${deep.D3.shaft.y0}` : ' (no shaft)'}`],
    [`roofed rooms on >= ${T.roofLevels} levels`, lv.size >= T.roofLevels, `roofed rooms by level ${JSON.stringify(roofedBy)}`],
    ['a workshop below -2', benches.length >= 1, `${benches.length} finished benches below -2: ${out.deepBenches.join(', ') || 'none'}`],
    [`>= ${T.raids} raids warned and repelled, one fought below the surface`, repelled.length >= T.raids && X3.deepTicks > 0, `${repelled.length} repelled of ${m.majors.length}: ${JSON.stringify(out.raids)}; ${X3.deepTicks} foe-colonist samples side by side below the surface; deepest foe by raid ${JSON.stringify(out.foeDepth)}`],
    ['zero starvation deaths', starved === T.starvation, `${starved} starvation deaths`],
    [`idle < ${T.idleMax * 100}%`, m.idle && m.idle.work < T.idleMax, `idle ${m.idle ? (m.idle.work * 100).toFixed(1) : '?'}% of work hours`],
    [`median haul latency < ${T.haulMedianMaxH} h`, m.haul && m.haul.medianH !== null && m.haul.medianH < T.haulMedianMaxH, `median ${m.haul ? m.haul.medianH : '?'} h (${m.haul ? m.haul.stored : 0} stored, ${m.haul ? m.haul.stillWaiting : 0} waiting)`],
  ].map(([name, ok, detail]) => ({ name, ok: !!ok, detail }));
  out.ok = out.checks.every((c) => c.ok);
  out.days = days;
  return out;
}

/**
 * Run bot v3 on one seed. Returns runBot2's result plus `z1` (the gate rows, evaluate3) and `deepNotes`.
 * opts as runBot2 (days default 30).
 */
export async function runBot3({ seed = 1, days = TARGETS_Z1.days, ticks = null, storyteller = null, difficulty = null, blobFn = null, blobEvery = 0, onDay = null, onTick = null } = {}) {
  let deep = null, X3 = null;
  const r = await runBot2({
    seed, days, ticks, storyteller, difficulty, blobFn, blobEvery, onDay,
    found: (sd, o) => foundFortress(sd, o),
    wrap: (s, base) => { deep = makeDeep(s, base); X3 = makeMeter3(s); return deep; },
    onTick: (s, p) => { X3.onTick(s); if (onTick) onTick(s, p); },
  });
  r.z1 = evaluate3(r.s, r, X3.X, deep, ticks !== null ? Math.floor(ticks / TICKS_PER_DAY) : days);
  r.deepNotes = deep.D3.notes;
  r.bot = 'v3';
  setBotLevel(0);
  return r;
}
