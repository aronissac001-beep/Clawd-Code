// Fighting (doc 6.6, 9.5): blows and shots between colonists and foes, and what drafted colonists do
// with their orders. Owner H. Provisional API; on from Stage 1b. The roguelite's systems/engage.js and
// systems/combat.js stay untouched for the old sim; this module is the colony's engage step.
// Numbers: stats.js (to data with the C11 raider fields).
//
// Tick system fightSystem (slot 'engage', after movement), in a fixed order:
//   1. foes strike, in s.foes order: a foe of an active raid swings (or shoots, `ranged`) on ticks
//      where (tick + 7 x id) % every == 0 (a stateless cadence): at its target colonist within reach
//      and in line of sight (F's health.damage on a part drawn by weight on the 'combat' stream; +25%
//      while the Hearth is cold; affixes add damage), else at the building it is breaking (foe.st.bt:
//      wall or door hp; at 0 the building goes through A's removeBuilding; the Hearth only scars).
//      Stage 2: a shot at a colonist in cover (beside a barricade, wall or embrasure) lands x0.6, at a
//      colonist manning a tower x0.5; on Hearthkeeper a blow never takes the head or torso to 0 (the
//      colonists are downed instead of killed, 9.1). Downed foes and the Rift never strike.
//   2. drafted colonists, in s.col order:
//      - every drafted colonist holds an order job (type 'order', toils from orders.js); one with no
//        job (just drafted, or its goto failed) gets a Hold job where it stands;
//      - Attack: its foe (job.foe) is struck when in reach; within COMBAT.chaseTiles and in sight it
//        closes in directly, else the order re-paths every COMBAT.chaseEvery ticks; when the foe is
//        gone the order turns into Hold where the colonist stands. An Attack on a Hollow Rift by a
//        colonist with Lore 6+ channels instead of striking: a game hour beside it with no other foe
//        within 2 tiles closes it (raids2.closeRift);
//      - Move: walks (B's mover); on arrival it holds there (job.hx, job.hy);
//      - Hold (and Move after arrival): strikes the nearest foe in reach; with none, steps out to the
//        nearest foe within COMBAT.holdAggro tiles of its spot (in sight), never past holdLeash, and
//        walks back to its spot when the fight moves away. Guard: the same with COMBAT.guardTiles.
//        Retreat: walks to its shelter spot and only strikes what is in reach;
//      - a blow lands with Melee (a shot with Archery) hit chance (stream 'combat') through
//        raiders.damageFoe, so the BUS.dmgMult light bonus applies; spears deal x1.5 to beasts;
//        every swing gives Melee XP, every shot Archery XP.
//      - Stage 2 weapons come from the item data (items.js `weapon`: dmg, speed %, reach in tenths of
//        a tile; reach 30+ is a bow or crossbow: it shoots from range). A colonist beside a finished
//        tower mans it: +3 tiles of range (the def's dmg.range), ranged hits on them halved, and a
//        bowless colonist shoots the tower's own bow.

import { W, tileOfW, cheb } from '../core/grid.js';
import { colById } from '../core/state.js';
import { nextU32 } from '../core/rand.js';
import { removeBuilding } from '../core/apply.js';
import { SIDE, footprint } from '../world/pass.js';
import { losClear } from '../systems/pathing.js';
import { damage as damageCol } from '../people/health.js';
import { awardXp, level } from '../people/skills.js';
import { stage2 } from '../people/defs.js';
import { raidById, foeById, damageFoe, steer, liveRecord } from './raiders.js';
import { foeStats, affixPct, WEAPONS, COMBAT } from './stats.js';
import { startOrder, holdHere } from './orders.js';
import { def, all } from './defs.js';
import { coverAt, towerOf } from '../defence/towers.js';
import { RIFT } from './rift.js';
import { didDeed } from '../people/coldeeds.js';
import { closeRift } from './raids2.js';

const TW = 32;
const d2 = (a, b) => (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);
const inReach = (s, a, b, reach) => d2(a, b) <= reach * reach && losClear(s, a.x, a.y, b.x, b.y, SIDE.HOS);
const roll100 = (s) => nextU32(s, 'combat') % 100;

const KIND_OF = Object.freeze({ club: 'blunt', maul: 'blunt', spear: 'stab', dagger: 'stab', shortbow: 'stab', longbow: 'stab', crossbow: 'stab', halberd: 'cut', axe: 'cut', sword: 'cut' });
const CACHE = new Map();
/** A weapon from item data: { dmg, kind, every, reach, ranged, beast }. */
function dataWeapon(k) {
  if (CACHE.has(k)) return CACHE.get(k);
  const d = def('item', k), w = d && d.weapon;
  const out = w ? Object.freeze({ dmg: w.dmg, kind: KIND_OF[k] || 'blunt', every: Math.max(8, Math.round(2300 / Math.max(10, w.speed || 100))), reach: Math.max(38, Math.round((w.reach || 10) * 3.2)),
    ranged: (w.reach || 10) >= 30, beast: (w.mods || []).some((m) => m.key === 'dmg.beast') }) : null;
  CACHE.set(k, out);
  return out;
}
/** The bow a tower lends a bowless defender (Archery). */
export const TOWER_BOW = Object.freeze({ dmg: 7, kind: 'stab', every: 26, reach: 8 * 32, ranged: true, beast: false });
/** The weapon a colonist fights with (col.gear.slots.weapon: an item kind, or a stack-like { k }). */
export function weaponOf(col) {
  const w = col.gear && col.gear.slots ? col.gear.slots.weapon : null;
  const k = w && typeof w === 'object' ? w.k : w;
  if (k && stage2()) { const dw = dataWeapon(k); if (dw) return dw; }
  return (k && WEAPONS[k]) || WEAPONS.fists;
}
/** The weapon now, with a manned tower's range (Stage 2). */
function armed(s, col) {
  const w = weaponOf(col);
  if (!stage2()) return w;
  const t = towerOf(s, col);
  if (!t) return w;
  const base = w.ranged ? w : TOWER_BOW;
  return { ...base, reach: base.reach + t.range * TW };
}
/** A colonist's hit chance in percent (Melee; Archery for a shot). */
export const hitPct = (col, ranged = false) => Math.min(COMBAT.hitMaxPct, (ranged ? COMBAT.rangedHitPct : COMBAT.hitBasePct) + COMBAT.hitPerLvlPct * level(col, ranged ? 'archery' : 'melee'));

function pickPart(s) {
  const w = COMBAT.partWeights;
  let total = 0; for (const x of w) total += x;
  let r = nextU32(s, 'combat') % total;
  for (let k = 0; k < w.length; k++) { r -= w[k]; if (r < 0) return k; }
  return 1;
}
const foeActive = (s, f) => { if (f.st && f.st.down) return false; const r = raidById(s, f.raid); return !!r && r.stage === 'active'; };
const isBeast = (f) => { const d = def('raider', f.kind); return !!d && d.kind === 'beast'; };

// ---- Armour (6.6) ---------------------------------------------------------------------------------
/**
 * Worn armour (Stage 2.9b). Every worn piece (col.gear.slots) covers parts by its slot: head the head;
 * body the torso and arms; outer the torso, arms and legs; feet the legs; a shield in the hands guards
 * every part at ARMOUR.shieldPct of its value. A piece counts its wear.armour x its quality's armour
 * percent (5.8). A blow to part `pi` loses the sum in percent, capped at ARMOUR.maxPct; blows only
 * (cut, stab, blunt, bite): the taint, fire and frost pass through. (Before 2.9b worn gear changed
 * nothing in a fight: a hold in helms and mail bled like one in tunics.)
 */
export const ARMOUR = Object.freeze({ maxPct: 60, shieldPct: 50, kinds: Object.freeze(['cut', 'stab', 'blunt', 'bite']) });
const ARMOUR_COVER = Object.freeze({ head: [0], body: [1, 2, 3], outer: [1, 2, 3, 4, 5], feet: [4, 5] });
const ARMOUR_SLOTS = Object.freeze(['head', 'body', 'outer', 'feet']);
function pieceArmour(b) {
  const k = b && typeof b === 'object' ? b.k : b;
  const d = k ? def('item', k) : null;
  if (!d || !d.wear || !d.wear.armour) return 0;
  const q = all('quality')[(b && b.q) | 0];
  return Math.floor(((d.wear.armour | 0) * (q && q.armour ? q.armour : 100)) / 100);
}
/** The percent a blow of `kind` to part `pi` of col loses to worn armour (0 when none). */
export function armourPct(col, pi, kind = 'cut') {
  const sl = col.gear && col.gear.slots;
  if (!sl || !ARMOUR.kinds.includes(kind)) return 0;
  let a = 0;
  for (const slot of ARMOUR_SLOTS) if (sl[slot] && ARMOUR_COVER[slot].includes(pi)) a += pieceArmour(sl[slot]);
  if (sl.hands) a += Math.floor((pieceArmour(sl.hands) * ARMOUR.shieldPct) / 100);
  return Math.min(ARMOUR.maxPct, a);
}

// ---- 1. Foes strike ------------------------------------------------------------------------------
function strikeBuilding(s, f, st) {
  const b = f.st && f.st.bt !== null && f.st.bt !== undefined ? s.bld[f.st.bt] : null;
  if (!b) { if (f.st) f.st.bt = null; return; }
  const fx = tileOfW(f.x), fy = tileOfW(f.y);
  let near = false;
  for (const i of footprint(s, b)) if (cheb(fx, fy, i % W, (i / W) | 0) <= 1) { near = true; break; }
  if (!near) return;
  const dmg = Math.max(1, Math.floor((st.dmg * (s.colony.hearth.fuel > 0 ? 100 : COMBAT.coldHearthPct) * affixPct(f, 'dmgPct')) / 10000));
  if (s.colony.hearth.id === b.id) { b.hp = Math.max(COMBAT.hearthMinHp, b.hp - dmg); return; }
  b.hp -= dmg;
  if (b.hp <= 0) { f.st.bt = null; removeBuilding(s, b, true); }
}
function foesStrike(s) {
  const S2 = stage2(), keeper = S2 && s.colony.difficulty === 'hearthkeeper';
  for (const f of s.foes.slice()) {
    if (!foeActive(s, f)) continue;
    const st = foeStats(f.kind);
    if (st.still || (f.st && f.st.flee)) continue;
    if ((s.tick + 7 * f.id) % st.every !== 0) continue;
    const c = f.target !== null && f.target !== undefined ? colById(s, f.target) : null;
    if (c && !c.hp.dead && !c.hp.down) {
      if (!inReach(s, f, c, st.reach)) continue;
      let hit = st.hit;
      if (S2 && st.ranged) hit = Math.floor((hit * coverAt(s, c)) / 100);
      if (roll100(s) >= hit) continue;
      const part = pickPart(s);
      let dmg = Math.max(1, Math.floor((st.dmg * (s.colony.hearth.fuel > 0 ? 100 : COMBAT.coldHearthPct) * (S2 ? affixPct(f, 'dmgPct') : 100)) / 10000));
      // worn armour takes its share off the blow (Stage 2.9b: helms, mail and shields counted for nothing)
      if (S2) dmg = Math.max(1, Math.floor((dmg * (100 - armourPct(c, part, st.kind))) / 100));
      if (keeper && part <= 1) dmg = Math.max(1, Math.min(dmg, c.hp.parts[part] - 1));
      if (keeper && part <= 1 && c.hp.parts[part] <= 1) continue;
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
  const ranged = !!w.ranged;
  awardXp(s, col, ranged ? 'archery' : 'melee', COMBAT.xpPerSwing);
  if (roll100(s) >= hitPct(col, ranged && stage2())) return;
  if (ranged) didDeed(s, col, 'shots_hit');   // Fire Arrows (EMBERCROWN-FORTRESS.md 3.1)
  let dmg = w.dmg + Math.floor(level(col, ranged ? 'archery' : 'melee') / COMBAT.dmgPerLvl);
  if (w.beast && isBeast(f)) dmg = Math.floor((dmg * COMBAT.beastPct) / 100);
  damageFoe(s, f, dmg, w.kind, col);
}
const standing = (col) => { const j = col.job; const t = j && j.toils[j.i]; return !!t && t.t === 'stand'; };
/** Channel at a Rift (Lore 6+, beside it, no other foe within 2 tiles). Returns true when channelling. */
function channel(s, col, rf) {
  if (level(col, 'lore') < RIFT.closeLore || d2(col, rf) > (1.6 * TW) ** 2) return false;
  for (const f of s.foes) if (f !== rf && foeActive(s, f) && d2(col, f) <= (2 * TW) ** 2) return true;   // guarded? not yet: wait
  rf.st.chan = (rf.st.chan | 0) + 1;
  if (s.tick % 20 === 0) awardXp(s, col, 'lore', 20);
  if (rf.st.chan >= RIFT.closeTicks) closeRift(s, rf, col);
  return true;
}

function colonistFights(s, col) {
  let job = col.job;
  if (!job || job.type !== 'order') { holdHere(s, col); job = col.job; if (!job) return; }
  const w = armed(s, col);
  const swingNow = (s.tick + 7 * col.id) % w.every === 0;
  if (job.order === 'attack') {
    const f = foeById(s, job.foe);
    if (!f || !foeActive(s, f)) { holdHere(s, col); return; }
    if (f.kind === 'rift' && stage2() && channel(s, col, f)) return;
    if (inReach(s, col, f, w.reach)) { if (swingNow) swing(s, col, f, w); return; }
    const near = d2(col, f) <= (COMBAT.chaseTiles * TW) ** 2 && losClear(s, col.x, col.y, f.x, f.y, SIDE.HOS);
    if (near) {
      if (!standing(col)) startOrder(s, col, 'attack', { id: f.id, kind: 'foe' }, true);
      steer(s, col, f.x, f.y, COMBAT.colSpeed, SIDE.COL);
    } else if ((s.tick + col.id) % COMBAT.chaseEvery === 0 || standing(col)) startOrder(s, col, 'attack', { id: f.id, kind: 'foe' });
    return;
  }
  if (!standing(col)) {   // walking a Move (or Retreat) order: strike what comes into reach, keep walking
    const f = nearestFoe(s, col, col, 0, w.reach);
    if (f && swingNow) swing(s, col, f, w);
    return;
  }
  // Hold, Guard, Retreat (or a Move that has arrived): job.hx, job.hy is the spot
  const spot = { x: job.hx, y: job.hy };
  const f = nearestFoe(s, col, col, 0, w.reach);
  if (f) { if (swingNow) swing(s, col, f, w); return; }
  if (job.order === 'retreat' || w.ranged) return;   // sheltering, or an archer: no stepping out
  const guard = job.order === 'guard';
  const g = nearestFoe(s, col, spot, guard ? COMBAT.guardTiles : COMBAT.holdAggro);
  if (g) {
    const leash = (guard ? COMBAT.guardTiles + 2 : COMBAT.holdLeash) * TW;
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
