// Fighting (doc 9.5): blows between colonists and foes, and what drafted colonists do with their
// orders. Owner H. Provisional API; on from Stage 1b. The roguelite's systems/engage.js and
// systems/combat.js stay untouched for the old sim (js/game/sim.js still imports them); this module
// is the colony's engage step. Numbers: stats.js (to data with the C11 raider fields).
//
// Tick system fightSystem (slot 'engage', after movement), in a fixed order:
//   1. foes strike, in s.foes order: a foe of an active raid swings on ticks where
//      (tick + 7 x id) % every == 0 (a stateless cadence, so nothing extra is saved): at its target
//      colonist within reach and in line of sight (F's health.damage on a part drawn by weight on
//      the 'combat' stream; +25% while the Hearth is cold), else at the building it is breaking
//      (foe.st.bt: wall or door hp; at 0 the building goes through A's removeBuilding; the Hearth
//      only scars down to COMBAT.hearthMinHp in 1b);
//   2. drafted colonists, in s.col order:
//      - every drafted colonist holds an order job (type 'order', toils from orders.js); one with no
//        job (just drafted, or its goto failed) gets a Hold job where it stands;
//      - Attack: its foe (job.foe) is struck when in reach; within COMBAT.chaseTiles and in sight it
//        closes in directly, else the order re-paths every COMBAT.chaseEvery ticks; when the foe is
//        gone the order turns into Hold where the colonist stands;
//      - Move: walks (B's mover); on arrival it holds there (job.hx, job.hy);
//      - Hold (and Move after arrival): strikes the nearest foe in reach; with none, steps out to the
//        nearest foe within COMBAT.holdAggro tiles of its spot (in sight), never past holdLeash, and
//        walks back to its spot when the fight moves away;
//      - a blow lands with Melee hit chance (stream 'combat') through raiders.damageFoe, so the
//        BUS.dmgMult light bonus applies (+25% on lit tiles for the Hollow, defence/braziers.js);
//        every swing gives Melee XP (F's awardXp).
// Undrafted colonists do not fight in 1b (the Shelter zone and flight are Stage 2).

import { W, tileOfW, cheb } from '../core/grid.js';
import { colById } from '../core/state.js';
import { nextU32 } from '../core/rand.js';
import { removeBuilding } from '../core/apply.js';
import { SIDE, footprint } from '../world/pass.js';
import { losClear } from '../systems/pathing.js';
import { damage as damageCol } from '../people/health.js';
import { awardXp, level } from '../people/skills.js';
import { raidById, foeById, damageFoe, steer, liveRecord } from './raiders.js';
import { foeStats, WEAPONS, COMBAT } from './stats.js';
import { startOrder, holdHere } from './orders.js';

const TW = 32;
const d2 = (a, b) => (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);
const inReach = (s, a, b, reach) => d2(a, b) <= reach * reach && losClear(s, a.x, a.y, b.x, b.y, SIDE.HOS);
const roll100 = (s) => nextU32(s, 'combat') % 100;

/** The weapon a colonist fights with (col.gear.slots.weapon: an item kind, or a stack-like { k }). */
export function weaponOf(col) {
  const w = col.gear && col.gear.slots ? col.gear.slots.weapon : null;
  const k = w && typeof w === 'object' ? w.k : w;
  return (k && WEAPONS[k]) || WEAPONS.fists;
}
/** A colonist's hit chance in percent (Melee). */
export const hitPct = (col) => Math.min(COMBAT.hitMaxPct, COMBAT.hitBasePct + COMBAT.hitPerLvlPct * level(col, 'melee'));

function pickPart(s) {
  const w = COMBAT.partWeights;
  let total = 0; for (const x of w) total += x;
  let r = nextU32(s, 'combat') % total;
  for (let k = 0; k < w.length; k++) { r -= w[k]; if (r < 0) return k; }
  return 1;
}
const foeActive = (s, f) => { const r = raidById(s, f.raid); return !!r && r.stage === 'active'; };

// ---- 1. Foes strike ------------------------------------------------------------------------------
function strikeBuilding(s, f, st) {
  const b = f.st && f.st.bt !== null && f.st.bt !== undefined ? s.bld[f.st.bt] : null;
  if (!b) { if (f.st) f.st.bt = null; return; }
  const fx = tileOfW(f.x), fy = tileOfW(f.y);
  let near = false;
  for (const i of footprint(s, b)) if (cheb(fx, fy, i % W, (i / W) | 0) <= 1) { near = true; break; }
  if (!near) return;
  const dmg = Math.max(1, Math.floor((st.dmg * (s.colony.hearth.fuel > 0 ? 100 : COMBAT.coldHearthPct)) / 100));
  if (s.colony.hearth.id === b.id) { b.hp = Math.max(COMBAT.hearthMinHp, b.hp - dmg); return; }
  b.hp -= dmg;
  if (b.hp <= 0) { f.st.bt = null; removeBuilding(s, b, true); }
}
function foesStrike(s) {
  for (const f of s.foes.slice()) {
    if (!foeActive(s, f)) continue;
    const st = foeStats(f.kind);
    if ((s.tick + 7 * f.id) % st.every !== 0) continue;
    const c = f.target !== null && f.target !== undefined ? colById(s, f.target) : null;
    if (c && !c.hp.dead && !c.hp.down) {
      if (!inReach(s, f, c, st.reach)) continue;
      if (roll100(s) >= st.hit) continue;
      const part = pickPart(s);
      const dmg = Math.max(1, Math.floor((st.dmg * (s.colony.hearth.fuel > 0 ? 100 : COMBAT.coldHearthPct)) / 100));
      const res = damageCol(s, c, part, st.kind, dmg, f);
      if (res.down) liveRecord(s, f.raid).downed++;
      continue;
    }
    strikeBuilding(s, f, st);
  }
}

// ---- 2. Drafted colonists ------------------------------------------------------------------------
function nearestFoe(s, col, from, tiles, reach = 0) {
  let best = null, bd = Infinity;
  const r = reach || tiles * TW;
  for (const f of s.foes) {
    if (!foeActive(s, f)) continue;
    const dd = d2(from, f);
    if (dd > r * r || dd >= bd) continue;
    if (!losClear(s, col.x, col.y, f.x, f.y, SIDE.HOS)) continue;
    bd = dd; best = f;
  }
  return best;
}
function swing(s, col, f, w) {
  awardXp(s, col, 'melee', COMBAT.xpPerSwing);
  if (roll100(s) >= hitPct(col)) return;
  damageFoe(s, f, w.dmg + Math.floor(level(col, 'melee') / COMBAT.dmgPerLvl), w.kind, col);
}
const standing = (col) => { const j = col.job; const t = j && j.toils[j.i]; return !!t && t.t === 'stand'; };

function colonistFights(s, col) {
  let job = col.job;
  if (!job || job.type !== 'order') { holdHere(s, col); job = col.job; if (!job) return; }
  const w = weaponOf(col);
  const swingNow = (s.tick + 7 * col.id) % w.every === 0;
  if (job.order === 'attack') {
    const f = foeById(s, job.foe);
    if (!f || !foeActive(s, f)) { holdHere(s, col); return; }
    if (inReach(s, col, f, w.reach)) { if (swingNow) swing(s, col, f, w); return; }
    const near = d2(col, f) <= (COMBAT.chaseTiles * TW) ** 2 && losClear(s, col.x, col.y, f.x, f.y, SIDE.HOS);
    if (near) {
      if (!standing(col)) startOrder(s, col, 'attack', { id: f.id, kind: 'foe' }, true);
      steer(s, col, f.x, f.y, COMBAT.colSpeed, SIDE.COL);
    } else if ((s.tick + col.id) % COMBAT.chaseEvery === 0 || standing(col)) startOrder(s, col, 'attack', { id: f.id, kind: 'foe' });
    return;
  }
  if (!standing(col)) {   // walking a Move order: strike what comes into reach, keep walking
    const f = nearestFoe(s, col, col, 0, w.reach);
    if (f && swingNow) swing(s, col, f, w);
    return;
  }
  // Hold (or a Move that has arrived): job.hx, job.hy is the spot
  const spot = { x: job.hx, y: job.hy };
  const f = nearestFoe(s, col, col, 0, w.reach);
  if (f) { if (swingNow) swing(s, col, f, w); return; }
  const g = nearestFoe(s, col, spot, COMBAT.holdAggro);
  if (g) {
    const leash = COMBAT.holdLeash * TW;
    const before = { x: col.x, y: col.y };
    steer(s, col, g.x, g.y, COMBAT.colSpeed, SIDE.COL);
    if (d2(col, spot) > leash * leash) { col.x = before.x; col.y = before.y; }
    return;
  }
  if (d2(col, spot) > 4 && losClear(s, col.x, col.y, spot.x, spot.y, SIDE.COL)) steer(s, col, spot.x, spot.y, COMBAT.colSpeed, SIDE.COL);
}

/** Tick system (slot 'engage'). */
export function fightSystem(s) {
  if (s.foes.length) foesStrike(s);
  for (const col of s.col) {
    if (!col.drafted || col.hp.dead || col.hp.down) continue;
    colonistFights(s, col);
  }
}
