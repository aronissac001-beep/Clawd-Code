// The Pump work giver (owner E; Stage Z4 water engineering, world/pumps.js). Targets: finished hand pumps
// that can stroke now (water under them, room at the outlet, not held LOCKED by a lever) and are not driven
// by a water wheel. A hauler walks beside the pump and works it for up to PUMP.shift ticks, one stroke per
// PUMP.stroke ticks, until the intake runs dry or the outlet fills. Claim: the pump (one worker at a time).
// Quiet in any game without a pump, so old saves replay as before (C13).

import { tz, cheb, tx, ty } from '../../core/grid.js';
import { bldById } from '../../core/state.js';
import { RUN, NEXT, T, makeJob, registerToil, keyBld, myClaim } from '../jobs.js';
import { colTile } from '../reserve.js';
import { openTarget, standSpot } from '../windex.js';
import { footprint } from '../construct.js';
import { PUMP, isPump, pumpState, pumpStroke, pumpDriven } from '../../world/pumps.js';

const target = (s, col, b) => {
  if (!isPump(b) || pumpState(s, b) !== 'ok' || pumpDriven(s, b) || !openTarget(s, col, keyBld(b.id))) return null;
  const st = standSpot(s, col, footprint(s, b));
  return st.i < 0 || st.d === Infinity ? null : { key: keyBld(b.id), id: b.id, stand: st.i, d: st.d };
};

export const PUMP_GIVER = Object.freeze({
  id: 'pump', work: 'haul', order: 12,
  candidates(s, col, k) {
    const out = [];
    for (const b of s.bld) { if (!isPump(b)) continue; const t = target(s, col, b); if (t) out.push(t); }
    out.sort((p, q) => p.d - q.d || p.key - q.key);
    return out.slice(0, k);
  },
  valid(s, col, t) { return !!target(s, col, bldById(s, t.id)); },
  make(s, col, t) { return { job: makeJob('pump', t.key, [T.goto(t.stand), { t: 'pump', b: t.id }]), claims: [[t.key, 0]] }; },
  keyOf: (t) => t.key,
  fromTarget(s, col, tg) { if (!tg || tg.kind !== 'bld') return null; return target(s, col, bldById(s, tg.id)); },
});

registerToil('pump', (s, col, job, toil) => {
  const b = bldById(s, toil.b);
  if (!b || pumpState(s, b) !== 'ok') return NEXT;
  if (myClaim(s, keyBld(b.id), col.id) < 0) return 'lostClaim';
  const ci = colTile(col);
  if (tz(ci) !== (b.z | 0) || cheb(tx(ci), ty(ci), b.x, b.y) > 1) return 'notThere';
  job.work++;
  if (job.work % PUMP.stroke === 0) pumpStroke(s, b);
  return job.work >= PUMP.shift ? NEXT : RUN;
});

export const GIVER = PUMP_GIVER;
