// Raids on the map: spawning, foe movement, foe damage and death, raid stages and the end of a
// raid (doc 9.3). Owner H. Provisional API.
//
// Foe (schema C2) = { id, kind (raider id), raid, x, y (world units), hp: { hp, max }, target, nem,
// job, path, st }. foe.target: the colonist id it is after (or null); foe.st (json) =
// { prey: colId | null (the incident's cast, e.g. the wounded a horde smells), bt: building id it
// is breaking (a wall or door in its way, or the Hearth) | null }.
// Movement (foeMoveSystem, slot 'movement' after B's movers), in s.foes order:
//   - a retreating raid walks the 'edge' field and leaves the map on an edge tile;
//   - a foe with a living, standing colonist within its aggro radius and in line of sight (the
//     hostile side: closed doors block it) closes in on them directly, and stops within reach;
//     Gloom Hounds prefer the cast prey within 12 tiles;
//   - otherwise it steps down its goal's flow field (flow.js); when the next tile is a wall or a
//     door it stops and breaks it (fight.js strikes it), and at the Hearth it claws the Hearth.
// Raid bookkeeping that must survive a save lives in s.st.live[raidId] = { deaths, downed } (the
// story record keeps unknown keys, schema.storyFromPlain); endRaid folds it into s.st.history.
// damageFoe() is the single way a foe loses hp (sunlight uses burnFoe, which skips BUS.dmgMult).

import { ctrW, tileOfW, W, H, clamp } from '../core/grid.js';
import { newRaid, newFoe } from '../core/schema.js';
import { nextId, colById } from '../core/state.js';
import { dayOf } from '../core/time.js';
import { BUS, each, product } from '../core/bus.js';
import { emit } from '../core/events.js';
import { stepCost, SIDE } from '../world/pass.js';
import { losClear } from '../systems/pathing.js';
import { def, bal } from './defs.js';
import { incidentDef, logicOf } from './incidents.js';
import { planRaid } from './raidplan.js';
import { fieldFor, flowStep, fieldGoalOf, onEdge, smashable } from './flow.js';
import { rollAftermath } from './aftermath.js';
import { foeStats } from './stats.js';

/**
 * Raid tuning from balance.js THREAT (9.1, 9.3), with the doc numbers when a key is missing.
 * foeSpeed: world units per tick at speed 100 (raider defs will carry a speed percent).
 */
export function raidTuning() { const t = bal('threat'); return { foeSpeed: t.foeSpeed ?? 2, tensionPerMajor: t.tensionPerMajor ?? 40, tensionPerDeath: t.tensionPerDeath ?? 20 }; }

export const raidById = (s, id) => { for (const r of s.raids) if (r.id === id) return r; return null; };
export const foeById = (s, id) => { for (const f of s.foes) if (f.id === id) return f; return null; };
export const foeTile = (f) => clamp(tileOfW(f.y), 0, H - 1) * W + clamp(tileOfW(f.x), 0, W - 1);

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

/** Put a raid's members on the map at its edge tile (spread along the edge). Returns the raid. */
export function spawnRaid(s, entry) {
  const r = ensureRaid(s, entry);
  const plan = entry.plan;
  const ex = plan.edge.i % W, ey = (plan.edge.i / W) | 0;
  const along = plan.edge.side === 'n' || plan.edge.side === 's';
  plan.members.forEach((rid, k) => {
    const d = def('raider', rid);
    const off = (k & 1 ? -1 : 1) * ((k + 1) >> 1);
    let x = along ? clamp(ex + off, 0, W - 1) : ex, y = along ? ey : clamp(ey + off, 0, H - 1);
    if (s.rt.walkCost[y * W + x] === 0) { x = ex; y = ey; }
    const hp = d ? d.hp : 40;
    const f = newFoe(nextId(s, 'foe'), rid, { raid: r.id, x: ctrW(x), y: ctrW(y), hp: { hp, max: hp }, nem: plan.nem, st: { prey: null, bt: null } });
    s.foes.push(f);
    r.members.push(f.id);
  });
  liveRecord(s, r.id);
  setStage(s, r, 'active');
  return r;
}

/** The saved per-raid counters (deaths, downed) while a raid is on the map. */
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

/**
 * Damage a foe. BUS.dmgMult handlers multiply (lit-tile bonus, charter and trait effects).
 * @returns {number} damage dealt
 */
export function damageFoe(s, foe, dmg, kind = 'blunt', src = null) {
  const m = product(BUS.dmgMult, s, src, foe, kind);
  const d = Math.max(1, Math.floor(dmg * m));
  foe.hp.hp -= d;
  if (foe.hp.hp <= 0) killFoe(s, foe, src, kind);
  return d;
}
/** Remove a dead foe: BUS.kill, `died` (kind 'foe'), and its raid membership. */
export function killFoe(s, foe, killer = null, cause = 'wounds') {
  each(BUS.kill, s, foe, killer);
  emit(s, 'died', { id: foe.id, cause, killer: killer && killer.id !== undefined ? killer.id : killer, kind: 'foe' });
  removeFoe(s, foe);
}
/** Sunlight and other damage that ignores BUS.dmgMult (no light bonus on the sun itself). */
export function burnFoe(s, foe, dmg, cause = 'sun') {
  foe.hp.hp -= Math.max(1, dmg | 0);
  if (foe.hp.hp <= 0) killFoe(s, foe, null, cause);
}
/** Take a foe off the map without a death (it fled over the edge). */
export function removeFoe(s, foe) {
  const i = s.foes.indexOf(foe);
  if (i >= 0) s.foes.splice(i, 1);
  const r = raidById(s, foe.raid);
  if (r) { const k = r.members.indexOf(foe.id); if (k >= 0) r.members.splice(k, 1); }
}

/** End a raid: logic.end, aftermath, history, tension, `raidEnd`; despawns what is left of it. */
export function endRaid(s, raid, result) {
  const inc = incidentDef(raid.inc);
  const lg = logicOf(raid.inc);
  if (lg && lg.end) lg.end(s, raid, result);
  const after = rollAftermath(s, raid, inc);
  for (const id of raid.members.slice()) { const f = foeById(s, id); if (f) removeFoe(s, f); }
  setStage(s, raid, 'ended');
  const k = String(raid.id), live = (s.st.live && s.st.live[k]) || { deaths: 0, downed: 0 };
  if (s.st.live) delete s.st.live[k];
  s.st.history.push({ inc: raid.inc, cat: inc ? inc.cat : 'major', day: dayOf(s.tick), result, deaths: live.deaths, downed: live.downed > 0, after });
  if (s.st.history.length > 40) s.st.history.splice(0, s.st.history.length - 40);
  if (inc && inc.cat === 'major') { s.st.tension = Math.min(100, s.st.tension + raidTuning().tensionPerMajor); s.st.lastMajorDay = dayOf(s.tick); }
  emit(s, 'raidEnd', { raidId: raid.id, result });
  const i = s.raids.indexOf(raid);
  if (i >= 0) s.raids.splice(i, 1);
}

/** Tick system (slot 'raids'): per-raid logic and the end check. Stage 1b: morale and dawn retreat. */
export function raidsSystem(s) {
  for (const r of s.raids.slice()) {
    if (r.stage !== 'active' && r.stage !== 'retreat') continue;
    const lg = logicOf(r.inc);
    if (lg && lg.tick) lg.tick(s, r);
    if (!r.members.length) endRaid(s, r, r.stage === 'retreat' ? 'fled' : 'repelled');
  }
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
/** The colonist foe f goes for now (keeps its target while it stays within aggro + leash). */
export function foeTarget(s, f) {
  const st = foeStats(f.kind);
  if (f.target !== null && f.target !== undefined) {
    const c = colById(s, f.target);
    if (canHunt(s, f, c, st.aggro + st.leash + (f.st && f.st.prey === f.target ? PREY_TILES : 0))) return c;
    f.target = null;
  }
  if ((s.tick + f.id) % 5 !== 0) return null;   // searches are staggered (COMBAT.retarget)
  if (f.st && f.st.prey !== null && f.st.prey !== undefined && f.kind === 'gloom_hound') {
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

/** Tick system (slot 'movement', after B's movers): every foe of an active or retreating raid moves. */
export function foeMoveSystem(s) {
  let gone = null;
  for (const f of s.foes) {
    const r = raidById(s, f.raid);
    if (!r || (r.stage !== 'active' && r.stage !== 'retreat')) continue;
    if (!f.st) f.st = { prey: null, bt: null };
    const st = foeStats(f.kind);
    const i = foeTile(f);
    if (r.stage === 'retreat') {
      f.target = null; f.st.bt = null;
      if (onEdge(i)) { (gone || (gone = [])).push(f); continue; }
      const fl = fieldFor(s, fieldGoalOf(r));
      const j = fl ? flowStep(fl.f, i, s) : -1;
      if (j >= 0 && openFor(s, j)) steer(s, f, ctrW(j % W), ctrW((j / W) | 0), st.speed);
      continue;
    }
    const c = foeTarget(s, f);
    if (c) {
      f.st.bt = null;
      if (d2(f, c) > st.reach * st.reach) steer(s, f, c.x, c.y, st.speed);
      continue;
    }
    const fl = fieldFor(s, r.goal);
    if (!fl) continue;
    const j = flowStep(fl.f, i, s);
    if (j < 0) { f.st.bt = null; continue; }
    if (!openFor(s, j)) {
      // the next tile is closed: a wall or door to break, or the Hearth (the goal) to claw
      const b = s.rt.occ[j] >= 0 ? s.bld[s.rt.occ[j]] : null;
      const hearth = b && s.colony.hearth.id === b.id;
      f.st.bt = b && (hearth || (smashable(b) && st.smash)) ? b.id : null;
      continue;
    }
    f.st.bt = null;
    steer(s, f, ctrW(j % W), ctrW((j / W) | 0), st.speed);
  }
  if (gone) for (const f of gone) removeFoe(s, f);   // fled over the edge: no death, no kill
}
