// Stage 2 raids (doc 9.3): thieves, beasts, the reaver warband, sappers, the Hollow Rift and the
// breach from the deep. Owner H. The code halves of their incidents (C12 IncidentLogic), registered
// by installRaids2(). Every one arrives through its queue entry (storyteller.js) with its warnings.
//
//   thieves, lone_thief   Gutterkin walk the loot field (the most valuable reachable stacks first),
//                         grab a stack and run for the edge (raiders.js steal); they avoid a fight
//                         (aggro 2). A day raid: at dusk whoever is left slips away. Ends when all
//                         fled or dead; goods that left the map feed the stolen-heirloom aftermath.
//   manhunters, wolf_pair a pack of one kind (wolves, boars or cave spiders; a great spider may lead
//                         spiders) hunts colonists down the people field; a day after arriving the
//                         survivors wander off (retreat).
//   reaver_raid           a warband with a captain: colonists first (the people field), then the
//                         stores; ranged reavers keep their distance; morale (raid.morale) falls with
//                         every reaver lost; at COMBAT.moraleBreak (50% losses) or with the captain
//                         down they flee. A vengeance warband (cast `hunted`: the colonist who downed
//                         the last captain) hunts that colonist first. Downed reavers are captives.
//   sapper_raid           delvers walk the dig field and dig rock (sappers.js), break walls by hp,
//                         and steal like thieves at the stores.
//   hollow_rift           a Rift (raider 'rift', a still foe of 400 hp) tears open on blighted land
//                         far from the Hearth; every night at 21:00 it spawns a horde of half the
//                         threat budget; the Hollow it spawned burn and flee at dawn like a horde.
//                         It is closed by a drafted colonist with Lore 6+ channelling beside it for a
//                         game hour (fight.js, an Attack order on the Rift), or broken by blows.
//                         The raid lasts until the Rift is gone and its Hollow with it.
//   deep_breach           the Hollow come up the deepest tunnel (raidplan.deepestTile) instead of an
//                         edge, for the colonists in the tunnels first (people field), then the Hearth;
//                         under rock there is no dawn: after two nights the survivors go back down.
//                         Requires the Hold tier, or a tunnel BREACH_DEPTH deep (the seep, Stage 3).

import { TICKS_PER_DAY, TICKS_PER_HOUR, hourOf } from '../core/time.js';
import { W, H, N, TER, ROOF } from '../core/grid.js';
import { nextU32 } from '../core/rand.js';
import { addThought } from '../people/mood.js';
import { undraftAll } from '../people/draft.js';
import { bump } from '../colony/ledger.js';
import { registerIncidentLogic } from './incidents.js';
import { spawnRaid, setStage, foeById, activeRaids, liveRecord, addMember, removeFoe } from './raiders.js';
import { threatPoints, composeRaid, raiderPool, deepestTile } from './raidplan.js';
import { incidentDef } from './incidents.js';
import { HORDE_LOGIC, sunBurn, sunUp, hollowMorale } from './horde.js';
import { COMBAT } from './stats.js';
import { def } from './defs.js';

const T_DAY = TICKS_PER_DAY;
export const BREACH_DEPTH = 18;
const arrivedAt = (s, raid) => { const l = liveRecord(s, raid.id); if (l.at === undefined) l.at = s.tick; return l.at; };
/** Common end of a Stage 2 raid: ledger, thoughts when repelled with no deaths, undraft when the map is clear. */
function endCommon(s, raid, result) {
  const live = liveRecord(s, raid.id);
  if (result === 'repelled') {
    bump(s, 'raidsRepelled');
    if (!live.deaths) for (const c of s.col) if (!c.hp.dead) addThought(s, c, 'raid_repelled');
  }
  if (!activeRaids(s).some((r) => r.id !== raid.id)) undraftAll(s);
}
const start = (s, entry) => { const r = spawnRaid(s, entry); arrivedAt(s, r); return r.id; };

// ---- Thieves --------------------------------------------------------------------------------------
export const THIEF_LOGIC = Object.freeze({
  start,
  tick(s, raid) { if (raid.stage === 'active' && hourOf(s.tick) >= 19 && s.tick - arrivedAt(s, raid) > TICKS_PER_HOUR) setStage(s, raid, 'retreat'); },
  end: endCommon,
});
// ---- Beasts ---------------------------------------------------------------------------------------
export const BEAST_LOGIC = Object.freeze({
  start,
  tick(s, raid) { if (raid.stage === 'active' && s.tick - arrivedAt(s, raid) >= T_DAY) setStage(s, raid, 'retreat'); },
  end: endCommon,
});
// ---- Reavers --------------------------------------------------------------------------------------
export const REAVER_LOGIC = Object.freeze({
  start(s, entry) {
    const r = spawnRaid(s, entry);
    arrivedAt(s, r);
    const hunted = entry.cast && entry.cast.hunted !== undefined ? entry.cast.hunted : null;
    if (hunted !== null) for (const id of r.members) { const f = foeById(s, id); if (f) { f.st.prey = hunted; f.st.hunt = true; } }
    return r.id;
  },
  tick(s, raid) {
    if (raid.stage !== 'active') return;
    const live = liveRecord(s, raid.id), n0 = Math.max(1, live.n0 | 0);
    raid.morale = live.captainDown ? 0 : Math.max(0, 100 - Math.floor(((live.lost | 0) * 100) / n0));
    if (raid.morale <= COMBAT.moraleBreak || s.tick - arrivedAt(s, raid) >= T_DAY) setStage(s, raid, 'retreat');
  },
  end: endCommon,
});
// ---- Sappers --------------------------------------------------------------------------------------
export const SAPPER_LOGIC = Object.freeze({
  start,
  tick(s, raid) { if (raid.stage === 'active' && s.tick - arrivedAt(s, raid) >= 2 * T_DAY) setStage(s, raid, 'retreat'); },
  end: endCommon,
});

// ---- The Hollow Rift ------------------------------------------------------------------------------
/** A blighted open tile far from the Hearth (most distant of a seeded sample), or -1. */
export function riftSite(s) {
  const hb = s.colony.hearth.id !== null ? s.bld[s.colony.hearth.id] : null;
  const hx = hb ? hb.x : W >> 1, hy = hb ? hb.y : H >> 1;
  let best = -1, bd = -1;
  const off = nextU32(s, 'story') % N;
  for (let k = 0; k < N; k += 7) {
    const i = (off + k) % N;
    if (!s.L.blight[i] || s.rt.walkCost[i] === 0 || s.rt.occ[i] >= 0 || s.L.roof[i] >= ROOF.THIN) continue;
    const d = Math.max(Math.abs((i % W) - hx), Math.abs(((i / W) | 0) - hy));
    if (d < 20) continue;
    if (d > bd) { bd = d; best = i; }
  }
  return best;
}
const riftOf = (s, raid) => { for (const id of raid.members) { const f = foeById(s, id); if (f && f.kind === 'rift') return f; } return null; };
export const RIFT_LOGIC = Object.freeze({
  requires: (s) => { let n = 0; for (let i = 0; i < N && n < 30; i += 3) if (s.L.blight[i]) n++; return n >= 10; },
  start(s, entry) {
    const site = riftSite(s);
    const plan = entry.plan;
    if (site >= 0) { plan.edge = { side: plan.edge.side, i: site }; }
    // the Rift itself first (at the site), then the first night's horde
    plan.members = ['rift'].concat(plan.members.filter((m) => m !== 'rift'));
    plan.lead = undefined;
    const r = spawnRaid(s, entry);
    const rf = riftOf(s, r);
    if (rf && site >= 0) { rf.x = (site % W) * 32 + 16; rf.y = ((site / W) | 0) * 32 + 16; for (const id of r.members) { const f = foeById(s, id); if (f && f !== rf) { f.x = rf.x + ((f.id % 3) - 1) * 32; f.y = rf.y + 32; } } }
    if (r.edge && site >= 0) r.edge = { side: r.edge.side, i: site };
    liveRecord(s, r.id).spawned = s.tick;
    return r.id;
  },
  tick(s, raid) {
    const rf = riftOf(s, raid);
    sunBurn(s, raid);
    // at first light the Rift's Hollow break off and flee; the Rift stays
    if (sunUp(s.tick) && s.tick % 20 === 0) for (const id of raid.members) { const f = foeById(s, id); if (f && f !== rf && f.st) f.st.flee = true; }
    if (!rf) return;
    // every night at 21:00 a fresh horde comes through
    const live = liveRecord(s, raid.id);
    if (hourOf(s.tick) === 21 && s.tick % TICKS_PER_HOUR === 0 && s.tick - (live.spawned | 0) > TICKS_PER_HOUR) {
      live.spawned = s.tick;
      const inc = incidentDef('hollow_horde');
      const pts = Math.floor(threatPoints(s) / 2);
      const { members } = composeRaid(s, raiderPool(inc, s), pts, Math.max(0, 80 - s.foes.length));
      const ti = Math.floor(rf.y / 32) * W + Math.floor(rf.x / 32);
      members.forEach((rid, k) => addMember(s, raid, { edge: { side: 'deep', i: ti }, members }, rid, k, null, [ti % W + ((k % 3) - 1), ((ti / W) | 0) + 1]));
      live.n0 = (live.n0 | 0) + members.length;
    }
  },
  holds: (s, raid) => !!riftOf(s, raid),
  end: endCommon,
});
/** Close a Rift (a channel finished): it is gone; its Hollow stay until they die or dawn. */
export function closeRift(s, rf, by = null) {
  const r = activeRaids(s).find((x) => x.id === rf.raid);
  if (by && Array.isArray(by.sk)) addThought(s, by, 'catharsis');
  removeFoe(s, rf);
  if (r) liveRecord(s, r.id).closed = by ? by.id : -1;
}

// ---- The breach from the deep ---------------------------------------------------------------------
export const BREACH_LOGIC = Object.freeze({
  requires: (s) => {
    if ((s.colony.tier | 0) >= 3) return true;
    const i = deepestTile(s);
    return i >= 0 && s.rt.depth[i] >= BREACH_DEPTH;
  },
  start(s, entry) { const id = HORDE_LOGIC.start(s, entry); arrivedAt(s, { id }); return id; },
  tick(s, raid) {
    // under rock the sun does not reach them; only those caught in the open burn, and after two
    // nights the rest go back down
    sunBurn(s, raid);
    hollowMorale(s, raid);
    if (raid.stage === 'active' && s.tick - arrivedAt(s, raid) >= 2 * T_DAY) {
      for (const id of raid.members.slice()) { const f = foeById(s, id); if (f) removeFoe(s, f); }
      setStage(s, raid, 'retreat');
    }
  },
  end: HORDE_LOGIC.end,
});

/** Register every Stage 2 raid's logic (idempotent). */
export function installRaids2() {
  registerIncidentLogic('thieves', THIEF_LOGIC);
  registerIncidentLogic('lone_thief', THIEF_LOGIC);
  registerIncidentLogic('manhunters', BEAST_LOGIC);
  registerIncidentLogic('wolf_pair', BEAST_LOGIC);
  registerIncidentLogic('reaver_raid', REAVER_LOGIC);
  registerIncidentLogic('sapper_raid', SAPPER_LOGIC);
  registerIncidentLogic('hollow_rift', RIFT_LOGIC);
  registerIncidentLogic('deep_breach', BREACH_LOGIC);
}
export { def, TER };
