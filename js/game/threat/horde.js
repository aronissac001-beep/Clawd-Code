// The Hollow horde (doc 9.3, 9.1; incident `hollow_horde`, data js/data/incidents.js). Owner H.
// Stage 1b. The code half of the incident (C12 IncidentLogic), registered by installHorde():
//   start(s, entry)  the horde arrives at its edge (raiders.spawnRaid); each member remembers the
//                    incident's cast `prey` (cast selector 'wounded': the Hollow smell the taint
//                    and the wounded; Gloom Hounds hunt them first, raiders.foeTarget)
//   tick(s, raid)    dawn retreat: from the first dawn or day tick the raid turns to 'retreat' (its
//                    members walk the 'edge' field and leave), and while the sun is up every Hollow
//                    on an unroofed tile loses COMBAT.sunPctPerSec of its max hp each second (TPS ticks)
//   end(s, raid, r)  'repelled' (all dead) or 'fled' (the rest left at dawn): every living
//                    colonist gets "Repelled the Hollow" unless a colonist died, the ledger counts the
//                    raid, and when no other raid is on the map the drafted go back to work
// Hostiles never appear without a queue entry (storyteller.js), and the horde never comes without
// its three warnings (Omen, Sighted, Imminent: warnings.js).

import { TPS, phaseOf } from '../core/time.js';
import { W, H, D, PLANE, tileOfW, clamp } from '../core/grid.js';
import { ROOF } from '../core/grid.js';
import { BUS } from '../core/bus.js';
import { addThought } from '../people/mood.js';
import { undraftAll } from '../people/draft.js';
import { bump } from '../colony/ledger.js';
import { registerIncidentLogic } from './incidents.js';
import { spawnRaid, setStage, burnFoe, foeById, activeRaids, liveRecord, escapeFoe } from './raiders.js';
import { stage2 } from '../people/defs.js';
import { isHollow } from '../defence/braziers.js';
import { COMBAT, foeStats } from './stats.js';
import { bal } from './defs.js';
import { skyZAt } from '../world/vertical.js';

export const HORDE_ID = 'hollow_horde';
export const sunUp = (tick) => { const p = phaseOf(tick); return p === 'dawn' || p === 'day'; };
const voxelOf = (f) => (f.z | 0) * PLANE + clamp(tileOfW(f.y), 0, H - 1) * W + clamp(tileOfW(f.x), 0, W - 1);
/** Under the open sky: D = 1, an unroofed tile; D > 1 (2.10), a sky-exposed voxel (z >= skyZ of its column). */
export const unroofed = (s, f) => {
  const i = voxelOf(f);
  if (D > 1) return (f.z | 0) >= skyZAt(s, i) && s.L.roof[i] === ROOF.OPEN;
  return s.L.roof[i] === ROOF.OPEN;
};

/** Sunlight on the Hollow (9.3): every TPS ticks while the sun is up, on open-sky tiles. */
export function sunBurn(s, raid) {
  if (s.tick % TPS !== 0 || !sunUp(s.tick)) return;
  for (const id of raid.members.slice()) {
    const f = foeById(s, id);
    if (!f || !isHollow(f) || !unroofed(s, f) || foeStats(f.kind).still) continue;
    burnFoe(s, f, Math.max(1, Math.floor((f.hp.max * COMBAT.sunPctPerSec) / 100)), 'sun');
  }
}

/**
 * Hollow morale and the rout (EMBERCROWN-FORTRESS.md 2.10, Stage 2.9b). Every TPS ticks while the raid
 * is active: raid.morale = 100 - losses - leader - light, where
 *   losses  every member lost (slain, or downed) costs max(lossPer, lossHalf / n0): a horde that loses
 *           about half its number breaks, whatever its size (as a reaver warband does at 50%)
 *   leader  the elite leader slain or fled costs leadPct
 *   light   every lightSecs member-seconds a Hollow stands in light of lightLvl or more costs 1 (the
 *           counter is saved in the raid's live record as `lit`)
 * At or below routAt the raid routs: it turns to 'retreat' and walks back to its edge (the leader, like
 * at dawn, slinks away first). The Rift's spawn (hollow_rift) has its own logic and does not rout.
 */
export function hollowMorale(s, raid) {
  if (raid.stage !== 'active' || s.tick % TPS !== 0) return;
  const M = moraleTuning();
  const live = liveRecord(s, raid.id), n0 = Math.max(1, live.n0 | 0);
  let lit = 0;
  for (const id of raid.members) {
    const f = foeById(s, id);
    if (!f || !isHollow(f) || (f.st && f.st.down)) continue;
    if (s.rt.light[voxelOf(f)] >= M.lightLvl) lit++;
  }
  if (lit) live.lit = (live.lit | 0) + lit;
  const per = Math.max(M.lossPer, Math.floor(M.lossHalf / n0));
  const m = 100 - (live.lost | 0) * per - (live.leadDown ? M.leadPct : 0) - Math.floor((live.lit | 0) / M.lightSecs);
  raid.morale = Math.max(0, Math.min(100, m));
  if (raid.morale > M.routAt) return;
  live.routed = 1;
  // a breach from the deep goes back down the way it came; a horde walks back to its edge
  const deep = raid.edge && raid.edge.side === 'deep';
  for (const id of raid.members.slice()) { const f = foeById(s, id); if (f && (deep || (f.st && (f.st.lead || f.nem !== null)))) escapeFoe(s, f, true); }
  setStage(s, raid, 'retreat');
}
/** Morale tuning (balance.js THREAT.hollowMorale), with the 2.10 numbers when a key is missing. */
export function moraleTuning() {
  const t = bal('threat').hollowMorale || {};
  return { lossPer: t.lossPer ?? 3, lossHalf: t.lossHalf ?? 150, leadPct: t.leadPct ?? 30, lightLvl: t.lightLvl ?? 3, lightSecs: t.lightSecs ?? 10, routAt: t.routAt ?? 25 };
}

/**
 * D > 1 (2.10): underground there is no dawn. By day only the members on sky-exposed voxels break off and walk
 * to the edge (an elite or nemesis slinks away at once); the raid stays active below and ends by morale.
 */
export function skyFlee(s, raid) {
  for (const id of raid.members.slice()) {
    const f = foeById(s, id);
    if (!f || !isHollow(f) || !unroofed(s, f) || foeStats(f.kind).still || (f.st && (f.st.flee || f.st.down))) continue;
    if (stage2() && f.st && (f.st.lead || f.nem !== null)) { escapeFoe(s, f, true); continue; }
    if (!f.st) f.st = { prey: null, bt: null };
    f.st.flee = true; f.target = null;
  }
}

export const HORDE_LOGIC = Object.freeze({
  start(s, entry) {
    const r = spawnRaid(s, entry);
    const prey = entry.cast && entry.cast.prey !== undefined ? entry.cast.prey : null;
    for (const id of r.members) { const f = foeById(s, id); if (f) { if (!f.st) f.st = { prey: null, bt: null }; f.st.prey = prey; f.st.bt = null; } }
    return r.id;
  },
  tick(s, raid) {
    if (stage2()) hollowMorale(s, raid);
    if (D > 1) { if (raid.stage === 'active' && sunUp(s.tick)) skyFlee(s, raid); sunBurn(s, raid); return; }
    if (raid.stage === 'active' && sunUp(s.tick)) {
      setStage(s, raid, 'retreat');
      // Stage 2: an elite (or a nemesis) alive at first light slinks away before the sun takes it (9.10)
      if (stage2()) for (const id of raid.members.slice()) { const f = foeById(s, id); if (f && f.st && (f.st.lead || f.nem !== null)) escapeFoe(s, f, true); }
    }
    sunBurn(s, raid);
  },
  end(s, raid, result) {
    const live = liveRecord(s, raid.id);
    if (result === 'repelled' || result === 'fled') {
      bump(s, 'raidsRepelled');
      if (!live.deaths) for (const c of s.col) if (!c.hp.dead) addThought(s, c, 'raid_repelled');
    }
    if (!activeRaids(s).some((r) => r.id !== raid.id)) undraftAll(s);
  },
});

/** Colonist deaths while a raid is on the map count against that raid (history.deaths, 9.2 defenceAdj). */
const onKill = (s, victim) => {
  if (!victim || !Array.isArray(victim.sk)) return;
  for (const r of activeRaids(s)) liveRecord(s, r.id).deaths++;
};

/** Register the horde's logic (also a few lone Husks, a minor) and the death counter (idempotent). */
export function installHorde() {
  registerIncidentLogic(HORDE_ID, HORDE_LOGIC);
  registerIncidentLogic('lone_husks', HORDE_LOGIC);
  if (!BUS.kill.includes(onKill)) BUS.kill.push(onKill);
}
