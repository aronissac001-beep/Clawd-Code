// Raids on the map: spawning, foe damage and death, raid stages and the end of a raid (doc 9.3).
// Owner H. Provisional API; Stage 0 skeleton (the 1b horde AI fills raidsSystem and foeMove).
//
// Foe (schema C2) = { id, kind (raider id), raid, x, y (world units), hp: { hp, max }, target, nem,
// job, path, st }. Foes of a raid follow its goal's flow field (flow.js); the 'people' goal uses
// a pack leader's A* path (B's requestPath, kind 'f'). Combat (systems/engage.js, combat.js) is
// adapted in 1b; until then damageFoe() is the single way a foe loses hp.

import { ctrW, tileOfW, W, H, clamp } from '../core/grid.js';
import { newRaid, newFoe } from '../core/schema.js';
import { nextId } from '../core/state.js';
import { dayOf } from '../core/time.js';
import { BUS, each, product } from '../core/bus.js';
import { emit } from '../core/events.js';
import { def, bal } from './defs.js';
import { incidentDef, logicOf } from './incidents.js';
import { planRaid } from './raidplan.js';
import { fieldFor, flowStep } from './flow.js';
import { rollAftermath } from './aftermath.js';

/**
 * Raid tuning from balance.js THREAT (9.1, 9.3), with the doc numbers when a key is missing.
 * foeSpeed: world units per tick at speed 100 (raider defs will carry a speed percent).
 */
export function raidTuning() { const t = bal('threat'); return { foeSpeed: t.foeSpeed ?? 2, tensionPerMajor: t.tensionPerMajor ?? 40, tensionPerDeath: t.tensionPerDeath ?? 20 }; }

export const raidById = (s, id) => { for (const r of s.raids) if (r.id === id) return r; return null; };
export const foeById = (s, id) => { for (const f of s.foes) if (f.id === id) return f; return null; };
const foeTile = (f) => clamp(tileOfW(f.y), 0, H - 1) * W + clamp(tileOfW(f.x), 0, W - 1);

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
    const f = newFoe(nextId(s, 'foe'), rid, { raid: r.id, x: ctrW(x), y: ctrW(y), hp: { hp, max: hp }, nem: plan.nem });
    s.foes.push(f);
    r.members.push(f.id);
  });
  setStage(s, r, 'active');
  return r;
}

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
function removeFoe(s, foe) {
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
  s.st.history.push({ inc: raid.inc, cat: inc ? inc.cat : 'major', day: dayOf(s.tick), result, deaths: 0, downed: false, after });
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

/** Tick system (slot 'movement', after B's movers): foes step down their goal's flow field. */
export function foeMoveSystem(s) {
  for (const f of s.foes) {
    const r = raidById(s, f.raid);
    if (!r || r.stage !== 'active') continue;
    const fl = fieldFor(s, r.goal);
    if (!fl) continue;
    const i = foeTile(f), j = flowStep(fl.f, i);
    if (j < 0) continue;
    const tx = ctrW(j % W), ty = ctrW((j / W) | 0), dx = tx - f.x, dy = ty - f.y;
    const dist = Math.sqrt(dx * dx + dy * dy), sp = raidTuning().foeSpeed;
    if (dist <= sp) { f.x = tx; f.y = ty; } else { f.x += (dx / dist) * sp; f.y += (dy / dist) * sp; }
  }
}
