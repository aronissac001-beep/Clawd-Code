// Raids on the map: spawning, foe movement, foe damage, death, capture and escape, raid stages and
// the end of a raid (doc 9.3, 9.5, 9.10). Owner H. Provisional API.
//
// Foe (schema C2) = { id, kind (raider id), raid, x, y (world units), hp: { hp, max }, target, nem,
// job, path, st }. foe.target: the colonist id it is after (or null); foe.st (json) =
//   { prey: colId | null (the incident's cast, e.g. the wounded a horde smells, or the colonist a
//     vengeance warband hunts), bt: building id it is breaking | null,
//     aff?: [affix] (warden, armoured, swift, rallying, burning), lead?: true (the raid's leader),
//     flee?: true (it breaks off alone: a thief with loot, a wounded elite), carry?: Bundle (stolen goods),
//     dig?: [tile, ticks] (a delver digging rock), down?: true (a downed reaver: capturable, it does
//     not move or fight), by?: [[colId, dmg]] and wk?: [[woundKind, dmg]] (who hurt it and how: the
//     nemesis grudge and scar), born?: tick (beasts wander off a day after) }.
// Movement (foeMoveSystem, slot 'movement' after B's movers), in s.foes order:
//   - a downed foe and the Rift (stats `still`) do not move;
//   - a retreating raid, or a fleeing foe, walks the 'edge' field and leaves the map on an edge tile
//     (a thief takes its loot with it; an elite or nemesis that gets away is named or comes back);
//   - a foe with a living, standing colonist within its aggro radius and in line of sight (closed
//     doors block it) closes in on them directly, and stops within reach (ranged foes stop at range);
//     Gloom Hounds, and a warband sent to hunt someone, prefer the cast prey within 12 tiles;
//   - otherwise it steps down its goal's flow field (flow.js; the core field when its own is not live);
//     when the next tile is a wall or a door it stops and breaks it (fight.js strikes it), a delver
//     digs rock (4x a miner's work, sappers.js), at the Hearth it claws the Hearth, and a thief at a
//     goal stack takes it and flees.
// Raid bookkeeping that must survive a save lives in s.st.live[raidId] = { deaths, downed, n0, lost,
// slayer, fell: [tile], loot: [tile], stolen: [Bundle] } (the story record keeps unknown keys);
// endRaid folds it into s.st.history. damageFoe() is the single way a foe loses hp (sunlight uses
// burnFoe, which skips BUS.dmgMult).

import { ctrW, tileOfW, W, H, clamp, TER, DX8, DY8 } from '../core/grid.js';
import { newRaid, newFoe } from '../core/schema.js';
import { nextId, colById } from '../core/state.js';
import { dayOf } from '../core/time.js';
import { nextU32 } from '../core/rand.js';
import { BUS, each, product } from '../core/bus.js';
import { emit } from '../core/events.js';
import { stepCost, SIDE } from '../world/pass.js';
import { losClear } from '../systems/pathing.js';
import { spawn as spawnItem, stackAt, take, put } from '../work/items.js';
import { stage2 } from '../people/defs.js';
import { def, bal } from './defs.js';
import { incidentDef, logicOf } from './incidents.js';
import { planRaid } from './raidplan.js';
import { fieldFor, flowStep, fieldGoalOf, onEdge, smashable, FLOW_UNREACHED } from './flow.js';
import { rollAftermath } from './aftermath.js';
import { foeStats, foeSpeed, affixPct, COMBAT } from './stats.js';
import { makeNemesis, nemesisById, markReturn, escaped, slay, fullName } from './nemesis.js';
import { digStep } from './sappers.js';

/**
 * Raid tuning from balance.js THREAT (9.1, 9.3), with the doc numbers when a key is missing.
 * foeSpeed: world units per tick at speed 100 (raider defs will carry a speed percent).
 */
export function raidTuning() { const t = bal('threat'); return { foeSpeed: t.foeSpeed ?? 2, tensionPerMajor: t.tensionPerMajor ?? 40, tensionPerDeath: t.tensionPerDeath ?? 20 }; }

export const raidById = (s, id) => { for (const r of s.raids) if (r.id === id) return r; return null; };
export const foeById = (s, id) => { for (const f of s.foes) if (f.id === id) return f; return null; };
export const foeTile = (f) => clamp(tileOfW(f.y), 0, H - 1) * W + clamp(tileOfW(f.x), 0, W - 1);
const isReaver = (f) => { const d = def('raider', f.kind); return !!d && d.kind === 'reaver'; };

/** The raid entity for a queue entry (created at the omen with stage 'warned'; C12). */
export function ensureRaid(s, entry) {
  let r = raidById(s, entry.id);
  if (r) return r;
  const plan = entry.plan || (entry.plan = planRaid(s, entry));
  r = newRaid(entry.id, entry.inc, { pts: plan.pts, edge: plan.edge, goal: plan.goal, stage: 'warned' });
  s.raids.push(r);
  s.raids.sort((a, b) => a.id - b.id);
  entry.raid = r.id;
  return r;
}

/** Spawn tiles for k members: along the edge (n, s: x varies; e, w: y varies), or around a tile ('deep'). */
function spawnSpot(s, plan, k) {
  const ex = plan.edge.i % W, ey = (plan.edge.i / W) | 0;
  const open = (x, y) => x >= 0 && y >= 0 && x < W && y < H && s.rt.walkCost[y * W + x] !== 0;
  if (plan.edge.side === 'deep') {
    for (let r = 0; r < 6; r++) {
      for (let d = 0; d < 8; d++) { const x = ex + DX8[(d + k) & 7] * r, y = ey + DY8[(d + k) & 7] * r; if (open(x, y) && (r > 0 || k === 0)) return [x, y]; }
    }
    return [ex, ey];
  }
  const along = plan.edge.side === 'n' || plan.edge.side === 's';
  const off = (k & 1 ? -1 : 1) * ((k + 1) >> 1);
  let x = along ? clamp(ex + off, 0, W - 1) : ex, y = along ? ey : clamp(ey + off, 0, H - 1);
  if (!open(x, y)) { x = ex; y = ey; }
  return [x, y];
}

/** Put a raid's members on the map at its edge tile (spread along the edge). Returns the raid. */
export function spawnRaid(s, entry) {
  const r = ensureRaid(s, entry);
  const plan = entry.plan;
  const nem = plan.nem !== null && plan.nem !== undefined ? nemesisById(s, plan.nem) : null;
  plan.members.forEach((rid, k) => addMember(s, r, plan, rid, k, k === plan.lead ? nem : null));
  if (nem) markReturn(s, nem);
  const live = liveRecord(s, r.id);
  live.n0 = r.members.length;
  setStage(s, r, 'active');
  return r;
}
/** One more member of raid r at its spawn spot k (Rift spawns use it too). Returns the foe. */
export function addMember(s, r, plan, rid, k = 0, nem = null, at = null) {
  const d = def('raider', rid);
  const [x, y] = at || spawnSpot(s, plan, k);
  const st = { prey: null, bt: null };
  const lead = plan.lead === k && !at;
  if (lead) { st.lead = true; if (plan.aff && plan.aff.length) st.aff = plan.aff.slice(); }
  if (nem && nem.affixes.length) st.aff = nem.affixes.slice();
  if (stage2()) st.born = s.tick;
  const f = newFoe(nextId(s, 'foe'), rid, { raid: r.id, x: ctrW(x), y: ctrW(y), hp: { hp: 1, max: 1 }, nem: nem ? nem.id : null, st });
  const hp = Math.max(1, Math.floor(((d ? d.hp : 40) * affixPct(f, 'hpPct')) / 100));
  f.hp = { hp, max: hp };
  s.foes.push(f);
  r.members.push(f.id);
  return f;
}

/** The saved per-raid counters while a raid is on the map. */
export function liveRecord(s, raidId) {
  if (!s.st.live) s.st.live = {};
  const k = String(raidId);
  return s.st.live[k] || (s.st.live[k] = { deaths: 0, downed: 0 });
}
/** Raids whose members are on the map (stage active or retreat), by id. */
export const activeRaids = (s) => s.raids.filter((r) => r.stage === 'active' || r.stage === 'retreat');

export function setStage(s, raid, stage) {
  if (raid.stage === stage) return;
  raid.stage = stage;
  emit(s, 'raidStage', { raidId: raid.id, stage });
}

const addBy = (list, key, d) => { for (const e of list) if (e[0] === key) { e[1] += d; return; } list.push([key, d]); };
/**
 * Damage a foe. BUS.dmgMult handlers multiply (lit-tile bonus, charter and trait effects); the
 * armoured affix takes 30% off. Records who hurt it (Stage 2). A reaver brought down may be downed
 * instead of killed (capture, 9.5).
 * @returns {number} damage dealt
 */
export function damageFoe(s, foe, dmg, kind = 'blunt', src = null) {
  const m = product(BUS.dmgMult, s, src, foe, kind);
  const arm = foe.st && foe.st.aff && foe.st.aff.includes('armoured') ? 70 : 100;
  const d = Math.max(1, Math.floor((dmg * m * arm) / 100));
  foe.hp.hp -= d;
  if (stage2() && foe.st) {
    if (src && Array.isArray(src.sk)) { if (!foe.st.by) foe.st.by = []; addBy(foe.st.by, src.id, d); }
    if (!foe.st.wk) foe.st.wk = [];
    addBy(foe.st.wk, kind, d);
    // an elite or a nemesis badly hurt breaks off (and may come back)
    if (foe.hp.hp > 0 && (foe.st.lead || foe.nem !== null) && foe.hp.hp * 100 < foe.hp.max * COMBAT.fleeHpPct && !isReaver(foe)) foe.st.flee = true;
  }
  if (foe.hp.hp <= 0) {
    if (stage2() && isReaver(foe) && !foe.st.down && (nextU32(s, 'combat') % 100) < COMBAT.captureDownPct) downFoe(s, foe, src);
    else killFoe(s, foe, src, kind);
  }
  return d;
}

/** Drop what a foe carries (stolen goods) and its gear (loot: forbidden until the raid ends). */
function dropGoods(s, foe) {
  const i = foeTile(foe), x = i % W, y = (i / W) | 0;
  const live = foe.raid !== null ? liveRecord(s, foe.raid) : null;
  if (foe.st && foe.st.carry) { put(s, foe.st.carry, x, y, {}); foe.st.carry = null; }
  const g = foeStats(foe.kind).gear;
  if (stage2() && g && def('item', g) && foe.nem === null) {
    if (spawnItem(s, g, g === 'club' || g === 'shortbow' ? 'wood' : 'iron', 0, 1, x, y, { f: true }) >= 0 && live) {
      if (!live.loot) live.loot = [];
      if (!live.loot.includes(i) && live.loot.length < 60) live.loot.push(i);
    }
  }
}
/** The raid's captain or leader fell to colonist `by`: remember who (cast selector captainSlayer). */
function noteLeader(s, foe, by) {
  if (!foe.st || !(foe.st.lead || foeStats(foe.kind).elite) || foe.raid === null) return;
  const live = liveRecord(s, foe.raid);
  if (by && Array.isArray(by.sk)) live.slayer = by.id;
  if (foe.kind === 'reaver_captain') live.captainDown = true;
}

/** Remove a dead foe: loot, BUS.kill, `died` (kind 'foe'), nemesis, and its raid membership. */
export function killFoe(s, foe, killer = null, cause = 'wounds') {
  const i = foeTile(foe);
  if (foe.raid !== null && stage2()) {
    const live = liveRecord(s, foe.raid);
    live.lost = (live.lost | 0) + 1;
    if (!live.fell) live.fell = [];
    if (live.fell.length < 16) live.fell.push(i);
  }
  noteLeader(s, foe, killer);
  dropGoods(s, foe);
  each(BUS.kill, s, foe, killer);
  emit(s, 'died', { id: foe.id, cause, killer: killer && killer.id !== undefined ? killer.id : killer, kind: 'foe' });
  if (foe.nem !== null && foe.nem !== undefined) slay(s, foe.nem, killer, [i % W, (i / W) | 0], spawnItem, foeStats(foe.kind).gear);
  removeFoe(s, foe);
}
/** A reaver at 0 hp is downed: it lies where it fell, out of its raid (a captive when the raid ends). */
export function downFoe(s, foe, by = null) {
  foe.hp.hp = 1;
  foe.st.down = true;
  foe.target = null; foe.st.bt = null;
  noteLeader(s, foe, by);
  const r = raidById(s, foe.raid);
  if (r) {
    const k = r.members.indexOf(foe.id); if (k >= 0) r.members.splice(k, 1);
    const live = liveRecord(s, r.id);
    live.lost = (live.lost | 0) + 1;
    if (!live.captives) live.captives = [];
    live.captives.push(foe.id);
  }
}
/** Sunlight and other damage that ignores BUS.dmgMult (no light bonus on the sun itself). */
export function burnFoe(s, foe, dmg, cause = 'sun') {
  foe.hp.hp -= Math.max(1, dmg | 0);
  if (foe.hp.hp <= 0) killFoe(s, foe, null, cause);
}
/** Take a foe off the map without a death (it fled over the edge, or a captive was led away). */
export function removeFoe(s, foe) {
  const i = s.foes.indexOf(foe);
  if (i >= 0) s.foes.splice(i, 1);
  const r = raidById(s, foe.raid);
  if (r) { const k = r.members.indexOf(foe.id); if (k >= 0) r.members.splice(k, 1); }
}
/** A foe gets away over the edge: stolen goods are lost (noted for the heirloom aftermath), and an
 *  elite, a captain or a nemesis that escapes is named (or comes back). */
export function escapeFoe(s, foe, name = false) {
  if (foe.raid !== null && stage2()) {
    const live = liveRecord(s, foe.raid);
    if (foe.st && foe.st.carry) { if (!live.stolen) live.stolen = []; live.stolen.push(foe.st.carry); foe.st.carry = null; }
    if (foe.nem !== null && foe.nem !== undefined) { const n = nemesisById(s, foe.nem); if (n) escaped(s, n); }
    else if (foe.st && (foe.st.lead || foeStats(foe.kind).elite) && (name || foe.hp.hp < foe.hp.max)) makeNemesis(s, foe);
  }
  removeFoe(s, foe);
}

/** End a raid: logic.end, captives, aftermath, history, tension, `raidEnd`; despawns what is left of it. */
export function endRaid(s, raid, result) {
  const inc = incidentDef(raid.inc);
  const lg = logicOf(raid.inc);
  if (lg && lg.end) lg.end(s, raid, result);
  const k = String(raid.id), live = (s.st.live && s.st.live[k]) || { deaths: 0, downed: 0 };
  const after = rollAftermath(s, raid, inc, live);
  for (const id of raid.members.slice()) { const f = foeById(s, id); if (f) removeFoe(s, f); }
  // loot is free to haul once the fight is over
  if (live.loot) for (const i of live.loot) { const it = stackAt(s, i); if (it && it.f) it.f = false; }
  setStage(s, raid, 'ended');
  if (s.st.live) delete s.st.live[k];
  const h = { inc: raid.inc, cat: inc ? inc.cat : 'major', day: dayOf(s.tick), result, deaths: live.deaths, downed: live.downed > 0, after };
  if (live.slayer !== undefined && live.slayer !== null) h.slayer = live.slayer;
  s.st.history.push(h);
  if (s.st.history.length > 40) s.st.history.splice(0, s.st.history.length - 40);
  if (inc && inc.cat === 'major') { s.st.tension = Math.min(100, s.st.tension + raidTuning().tensionPerMajor); s.st.lastMajorDay = dayOf(s.tick); }
  emit(s, 'raidEnd', { raidId: raid.id, result });
  const i = s.raids.indexOf(raid);
  if (i >= 0) s.raids.splice(i, 1);
}

/** Tick system (slot 'raids'): per-raid logic and the end check. */
export function raidsSystem(s) {
  for (const r of s.raids.slice()) {
    if (r.stage !== 'active' && r.stage !== 'retreat') continue;
    const lg = logicOf(r.inc);
    if (lg && lg.tick) lg.tick(s, r);
    if (stage2()) straggle(s, r, lg);
    if (!r.members.length && !(lg && lg.holds && lg.holds(s, r))) endRaid(s, r, r.stage === 'retreat' ? 'fled' : 'repelled');
  }
}

/** Stage 2 time limits: a raid on the map STRAGGLE.activeD days turns back (unless its logic holds it,
 *  the Rift); one retreating STRAGGLE.retreatH hours loses its last stragglers (they slip away), so a
 *  foe stuck behind walls never keeps the storyteller's major open. Saved in the live record (at, rt). */
export const STRAGGLE = Object.freeze({ activeD: 3, retreatH: 6 });
function straggle(s, r, lg) {
  const live = liveRecord(s, r.id);
  if (live.at === undefined) live.at = s.tick;
  if (r.stage === 'retreat') {
    if (live.rt === undefined) live.rt = s.tick;
    else if (s.tick - live.rt >= STRAGGLE.retreatH * 600) for (const id of r.members.slice()) { const f = foeById(s, id); if (f) escapeFoe(s, f); }
  } else if (s.tick - live.at >= STRAGGLE.activeD * 14400 && !(lg && lg.holds && lg.holds(s, r))) setStage(s, r, 'retreat');
}

// ---- Movement ----------------------------------------------------------------------------------
const PREY_TILES = 12;
const openFor = (s, i) => stepCost(s.rt.walkCost[i], SIDE.HOS) !== 0;
/** Step mover e up to `sp` units toward (tx, ty) without entering a tile closed to hostiles
 *  (slides along one axis when the straight step is blocked). Returns true when it moved. */
export function steer(s, e, tx, ty, sp, side = SIDE.HOS) {
  const dx = tx - e.x, dy = ty - e.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1e-6) return false;
  const k = dist <= sp ? 1 : sp / dist;
  const open = (x, y) => { const cx = tileOfW(x), cy = tileOfW(y); return cx >= 0 && cy >= 0 && cx < W && cy < H && stepCost(s.rt.walkCost[cy * W + cx], side) !== 0; };
  const nx = e.x + dx * k, ny = e.y + dy * k;
  if (open(nx, ny) && open(nx, e.y) && open(e.x, ny)) { e.x = nx; e.y = ny; return true; }
  if (Math.abs(dx) >= Math.abs(dy)) { if (open(nx, e.y)) { e.x = nx; return true; } if (open(e.x, ny)) { e.y = ny; return true; } }
  else { if (open(e.x, ny)) { e.y = ny; return true; } if (open(nx, e.y)) { e.x = nx; return true; } }
  return false;
}
const ableCol = (c) => !!c && !c.hp.dead && !c.hp.down;
const d2 = (a, b) => (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);
const TILE_W = 32;
/** Can foe f keep (or take) colonist c as its target? Within `tiles` and in line of sight. */
function canHunt(s, f, c, tiles) {
  if (!ableCol(c)) return false;
  const r = tiles * TILE_W;
  return d2(f, c) <= r * r && losClear(s, f.x, f.y, c.x, c.y, SIDE.HOS);
}
const huntsPrey = (f) => f.kind === 'gloom_hound' || !!(f.st && f.st.hunt);
/** The colonist foe f goes for now (keeps its target while it stays within aggro + leash). */
export function foeTarget(s, f) {
  const st = foeStats(f.kind);
  if (st.still || (f.st && f.st.carry)) return null;
  if (f.target !== null && f.target !== undefined) {
    const c = colById(s, f.target);
    if (canHunt(s, f, c, st.aggro + st.leash + (f.st && f.st.prey === f.target ? PREY_TILES : 0))) return c;
    f.target = null;
  }
  if ((s.tick + f.id) % 5 !== 0) return null;   // searches are staggered (COMBAT.retarget)
  if (f.st && f.st.prey !== null && f.st.prey !== undefined && huntsPrey(f)) {
    const p = colById(s, f.st.prey);
    if (canHunt(s, f, p, PREY_TILES)) { f.target = p.id; return p; }
  }
  let best = null, bd = Infinity;
  const r = st.aggro * TILE_W;
  for (const c of s.col) {
    if (!ableCol(c)) continue;
    const d = d2(f, c);
    if (d > r * r || d >= bd) continue;
    if (!losClear(s, f.x, f.y, c.x, c.y, SIDE.HOS)) continue;
    bd = d; best = c;
  }
  f.target = best ? best.id : null;
  return best;
}

/** The field a foe walks: its raid's goal field, else the core field, else any live field. */
function walkField(s, goal) {
  return fieldFor(s, goal) || fieldFor(s, 'core') || (s.rt.flow.length ? s.rt.flow[0] : null);
}
/** Walk toward the map edge (the 'edge' field, else straight at the raid's edge tile). */
function walkOut(s, f, r, sp, i) {
  const fl = fieldFor(s, 'edge');
  if (fl && fl.f[i] !== FLOW_UNREACHED) {
    const j = flowStep(fl.f, i, s);
    if (j >= 0 && openFor(s, j)) steer(s, f, ctrW(j % W), ctrW((j / W) | 0), sp);
    return;
  }
  if (r && r.edge) steer(s, f, ctrW(r.edge.i % W), ctrW((r.edge.i / W) | 0), sp);
}
/** A thief at a goal stack takes it (up to a carry load) and runs. */
function steal(s, f, i) {
  for (const j of [i, i - W, i + W, i - 1, i + 1]) {
    if (j < 0 || j >= W * H) continue;
    const it = stackAt(s, j);
    if (!it || it.k === 'corpse') continue;
    const b = take(s, it.id, Math.min(it.n, 60));
    if (!b) continue;
    f.st.carry = b; f.st.flee = true; f.target = null;
    return true;
  }
  return false;
}

/** Tick system (slot 'movement', after B's movers): every foe of an active or retreating raid moves. */
export function foeMoveSystem(s) {
  let gone = null;
  for (const f of s.foes) {
    const r = raidById(s, f.raid);
    if (!f.st) f.st = { prey: null, bt: null };
    if (f.st.down) continue;
    if (!r || (r.stage !== 'active' && r.stage !== 'retreat')) continue;
    const st = foeStats(f.kind);
    if (st.still) continue;
    const sp = foeSpeed(f);
    const i = foeTile(f);
    if (r.stage === 'retreat' || f.st.flee) {
      f.target = null; f.st.bt = null; f.st.dig = null;
      if (onEdge(i)) { (gone || (gone = [])).push(f); continue; }
      walkOut(s, f, r, sp, i);
      continue;
    }
    const c = foeTarget(s, f);
    if (c) {
      f.st.bt = null;
      const reach = st.reach;
      if (d2(f, c) > reach * reach || (st.ranged && !losClear(s, f.x, f.y, c.x, c.y, SIDE.HOS))) steer(s, f, c.x, c.y, sp);
      continue;
    }
    const fl = walkField(s, f.st.goal || r.goal);
    if (!fl) continue;
    const j = flowStep(fl.f, i, s);
    // a thief grabs what it reaches: the goal stack, or any stack it walks onto
    if (st.steal && (j < 0 || stackAt(s, i)) && steal(s, f, i)) continue;
    if (j < 0) { f.st.bt = null; continue; }
    if (!openFor(s, j)) {
      // the next tile is closed: rock to dig (a delver on the dig field), a wall or door to break, or the Hearth to claw
      if (st.dig && s.L.terrain[j] === TER.ROCK) { f.st.bt = null; digStep(s, f, j); continue; }
      const b = s.rt.occ[j] >= 0 ? s.bld[s.rt.occ[j]] : null;
      const hearth = b && s.colony.hearth.id === b.id;
      f.st.bt = b && (hearth || (smashable(b) && st.smash)) ? b.id : null;
      continue;
    }
    f.st.bt = null; f.st.dig = null;
    steer(s, f, ctrW(j % W), ctrW((j / W) | 0), sp);
  }
  if (gone) for (const f of gone) escapeFoe(s, f);   // fled over the edge: no death, no kill
}

export { fullName };
