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
import { W, H, tileOfW, clamp } from '../core/grid.js';
import { ROOF } from '../core/grid.js';
import { BUS } from '../core/bus.js';
import { addThought } from '../people/mood.js';
import { undraftAll } from '../people/draft.js';
import { bump } from '../colony/ledger.js';
import { registerIncidentLogic } from './incidents.js';
import { spawnRaid, setStage, burnFoe, foeById, activeRaids, liveRecord } from './raiders.js';
import { isHollow } from '../defence/braziers.js';
import { COMBAT } from './stats.js';

export const HORDE_ID = 'hollow_horde';
export const sunUp = (tick) => { const p = phaseOf(tick); return p === 'dawn' || p === 'day'; };
const unroofed = (s, f) => s.L.roof[clamp(tileOfW(f.y), 0, H - 1) * W + clamp(tileOfW(f.x), 0, W - 1)] === ROOF.OPEN;

/** Sunlight on the Hollow (9.3): every TPS ticks while the sun is up, on open-sky tiles. */
export function sunBurn(s, raid) {
  if (s.tick % TPS !== 0 || !sunUp(s.tick)) return;
  for (const id of raid.members.slice()) {
    const f = foeById(s, id);
    if (!f || !isHollow(f) || !unroofed(s, f)) continue;
    burnFoe(s, f, Math.max(1, Math.floor((f.hp.max * COMBAT.sunPctPerSec) / 100)), 'sun');
  }
}

export const HORDE_LOGIC = Object.freeze({
  start(s, entry) {
    const r = spawnRaid(s, entry);
    const prey = entry.cast && entry.cast.prey !== undefined ? entry.cast.prey : null;
    for (const id of r.members) { const f = foeById(s, id); if (f) f.st = { prey, bt: null }; }
    return r.id;
  },
  tick(s, raid) {
    if (raid.stage === 'active' && sunUp(s.tick)) setStage(s, raid, 'retreat');
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

/** Register the horde's logic and the death counter (idempotent). */
export function installHorde() {
  registerIncidentLogic(HORDE_ID, HORDE_LOGIC);
  if (!BUS.kill.includes(onKill)) BUS.kill.push(onKill);
}
