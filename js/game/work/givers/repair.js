// The Repair work giver (doc 5.1 "Build: construct, repair, deconstruct"; EMBERCROWN-FORTRESS.md 3.1 Siege
// Engineer; owner E; Stage 2). Targets: finished structures with hit points (walls, doors, gates, the Hearth,
// defences) below REPAIR.belowPct of their full strength (the def's hit points: maxHp).
// A builder stands beside the structure and works: every tick of work at speed 1.0 restores
// full / (build work x REPAIR.workPct%) hit points, so a wall knocked to nothing takes half its build time to
// make whole again. No materials are spent (the rubble and the stock of the wall are reused).
//
// In a raid a wall is patched from the inside: a structure whose stand spot shares a passable component with a
// foe within REPAIR.foeR tiles is left alone until that foe is gone, so a builder never walks out to the horde.
// A repair finished while a raid is live (or begun in one) counts the builder's `raid_repairs` deed; a Siege
// Engineer (hasGrant 'siege_engineer') repairs twice as fast while a raid is live.

import { tileOfW, cheb } from '../../core/grid.js';
import { bldById, raidLive } from '../../core/state.js';
import { structDef } from '../../core/content.js';
import { compOf } from '../../world/terrain.js';
import { footprint } from '../../world/pass.js';
import { T, RUN, NEXT, END, makeJob, keyBld, registerToil, workHooks, myClaim } from '../jobs.js';
import { release, colTile } from '../reserve.js';
import { openTarget, standSpot } from '../windex.js';
import { buildWork } from '../construct.js';
import { hasGrant } from '../../people/perkrules.js';
import { didDeed } from '../../people/coldeeds.js';

export const REPAIR = Object.freeze({
  belowPct: 90,     // repaired once below this share of full strength (a scratch is left alone)
  workPct: 50,      // a full repair is this share of the build work
  foeR: 4,          // a foe this close to the stand spot, on the builder's side, keeps the builder away
  siegePct: 200,    // Siege Engineer speed while a raid is live
  scan: 64,         // damaged structures considered per think (nearest by straight distance)
});

/**
 * Full strength of a finished structure for repairs: the def's hit points (the 100% of the building card's
 * Condition and of the threat code's hp bands). A stone wall built stronger than that by its material keeps
 * the extra until it is damaged; a repair restores the def's strength, never more.
 */
export function maxHp(b) {
  const d = structDef(b.def);
  return d && d.hp ? d.hp | 0 : 0;
}
/**
 * Does b need repair? A finished structure of the hold with hit points, not being taken down, below belowPct.
 * Not the Hearth (blows only scar it: threat stats hearthMinHp) and not the old world's named structures
 * (the ruins' and the vault's walls, mapgen), which are left as they were found.
 */
export function needsRepair(b, s = null) {
  if (!b || b.st !== 'done' || b.dcon || b.name || b.def === 'hearth') return false;
  if (s && s.colony.hearth && s.colony.hearth.id === b.id) return false;
  const m = maxHp(b);
  return m > 0 && (b.hp | 0) > 0 && (b.hp | 0) * 100 < m * REPAIR.belowPct;
}

// The damaged structures of this tick (derived, never saved: a pure function of s.bld at s.tick).
let memo = { s: null, tick: -1, ids: [] };
function damaged(s) {
  if (memo.s === s && memo.tick === s.tick) return memo.ids;
  const ids = [];
  for (const b of s.bld) if (b && needsRepair(b, s)) ids.push(b.id);
  memo = { s, tick: s.tick, ids };
  return ids;
}
/** A foe on the builder's side of the wall, close to the stand spot (the builder waits for it to go). */
function foeNear(s, i) {
  if (!s.foes.length) return false;
  const x = i % s.w, y = (i / s.w) | 0, comp = compOf(s, i, 0);
  for (const f of s.foes) {
    if (f.st && f.st.down) continue;
    const fx = tileOfW(f.x), fy = tileOfW(f.y);
    if (cheb(x, y, fx, fy) > REPAIR.foeR) continue;
    if (compOf(s, fy * s.w + fx, 0) === comp) return true;
  }
  return false;
}
function target(s, col, b) {
  if (!needsRepair(b, s) || !openTarget(s, col, keyBld(b.id))) return null;
  const st = standSpot(s, col, footprint(s, b));
  if (st.i < 0 || st.d === Infinity || foeNear(s, st.i)) return null;
  return { key: keyBld(b.id), id: b.id, i: st.i, d: st.d };
}

export const REPAIR_GIVER = Object.freeze({
  id: 'repair', work: 'build', order: -1,   // before new building: a breached wall comes first
  candidates(s, col, k) {
    const ids = damaged(s);
    if (!ids.length) return [];
    const ci = colTile(col), x = ci % s.w, y = (ci / s.w) | 0;
    const near = ids.map((id) => { const b = s.bld[id]; return [cheb(x, y, b.x, b.y), id]; }).sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, REPAIR.scan);
    const out = [];
    for (const [, id] of near) { const t = target(s, col, bldById(s, id)); if (t) out.push(t); }
    out.sort((a, b) => a.d - b.d || a.key - b.key);
    return out.slice(0, k);
  },
  valid(s, col, t) { const r = target(s, col, bldById(s, t.id)); if (r) t.i = r.i; return !!r; },
  make(s, col, t) {
    const key = keyBld(t.id);
    return { job: makeJob('repair', key, [T.goto(t.i), { t: 'repair', b: t.id, sk: 'construction', raid: raidLive(s) ? 1 : 0 }]), claims: [[key, 0]] };
  },
  keyOf: (t) => t.key,
  fromTarget(s, col, tg) { return tg && tg.kind === 'bld' ? target(s, col, bldById(s, tg.id)) : null; },
});

const nextTo = (s, col, b) => {
  const ci = colTile(col), x = ci % s.w, y = (ci / s.w) | 0;
  for (const i of footprint(s, b)) if (cheb(x, y, i % s.w, (i / s.w) | 0) <= 1) return true;
  return false;
};
registerToil('repair', (s, col, job, toil) => {
  const b = bldById(s, toil.b);
  if (!b || b.st !== 'done' || b.dcon) return END.TARGET_GONE;
  if (myClaim(s, keyBld(b.id), col.id) < 0) return 'lostClaim';
  if (!nextTo(s, col, b)) return 'notThere';
  const live = raidLive(s);
  if (live) toil.raid = 1;
  const h = workHooks();
  let sp = h.speed(s, col, toil) | 0;
  if (live && hasGrant(col, 'siege_engineer')) sp = Math.floor((sp * REPAIR.siegePct) / 100);
  if (h.xp) h.xp(s, col, toil.sk, 1);
  const full = maxHp(b);
  const work = Math.max(1, Math.floor((buildWork(b) * REPAIR.workPct) / 100));
  // hit points restored this tick, in whole points with the remainder carried in job.work (x work units)
  job.work = (job.work | 0) + Math.max(0, sp) * full;
  const gain = Math.floor(job.work / work);
  job.work -= gain * work;
  b.hp = Math.max(b.hp | 0, Math.min(full, (b.hp | 0) + gain));
  if (b.hp < full) return RUN;
  release(s, col, keyBld(b.id));
  if (toil.raid) didDeed(s, col, 'raid_repairs');
  return NEXT;
});

export const GIVER = REPAIR_GIVER;
