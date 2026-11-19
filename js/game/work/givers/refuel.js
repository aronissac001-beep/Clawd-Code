// The Refuel work giver (doc 5.1 Haul, 7.7, 8.4; owner E; Stage 1b). Targets: finished fuelled
// lights below the refuel line (B's fuel.refuelTargets: the Hearth, braziers, campfires, sconces),
// nearest first by region-graph distance to their standing spot. The hauler fetches the fuel kind
// (wood) from the nearest free stack, carries it next to the building and puts in what fits
// (B's addFuel; never past the cap); anything left over is dropped by endJob as usual.
// Claims: the units of the source stack and the building's fuel slot (keyFuel: one refueller at a
// time, while the bench itself stays free for a cook). With the fuel rules off (Stage 1a) there are
// no targets.

import { idx } from '../../core/grid.js';
import { bldById } from '../../core/state.js';
import { NEXT, T, makeJob, registerToil, keyItem, keyFuel, WORK } from '../jobs.js';
import { candidates as itemCandidates, freeCount, carried } from '../items.js';
import { colTile } from '../reserve.js';
import { openTarget, standSpot, reachableFrom, distTo } from '../windex.js';
import { footprint, capUnits } from '../construct.js';
import { refuelTargets, fuelWanted, addFuel, usesFuel, hearthFuelDays } from '../../world/fuel.js';

const target = (s, col, b) => {
  if (!b || !usesFuel(s, b) || !fuelWanted(s, b) || !openTarget(s, col, keyFuel(b.id))) return null;
  const st = standSpot(s, col, footprint(s, b));
  return st.i < 0 ? null : { key: keyFuel(b.id), id: b.id, stand: st.i, d: st.d, plan: null };
};

/** The refuel job for building b (stand tile `stand`), or null when no fuel can be fetched. */
export function refuelJob(s, col, b, stand) {
  const w = fuelWanted(s, b);
  if (!w) return null;
  const from = colTile(col);
  const src = itemCandidates(s, { k: w.k, holder: col.id, minN: 1 }, from, (i) => reachableFrom(s, col, i), WORK.candidatesK);
  let it = null, bd = Infinity;
  for (const c of src) { const d = distTo(s, col, idx(c.x, c.y)); if (d < bd) { bd = d; it = c; } }
  if (!it) return null;
  const n = Math.min(w.n, capUnits(col, it.k), freeCount(s, it.id, col.id));
  if (n <= 0) return null;
  const toils = [T.goto(idx(it.x, it.y)), T.pickup(it.id, n), T.carry(stand), { t: 'refuel', b: b.id }];
  return { job: makeJob('refuel', keyFuel(b.id), toils), claims: [[keyItem(it.id), n], [keyFuel(b.id), 0]] };
}

export const REFUEL_GIVER = Object.freeze({
  id: 'refuel', work: 'haul', order: 5,
  candidates(s, col, k) {
    const out = [];
    for (const id of refuelTargets(s)) { const t = target(s, col, bldById(s, id)); if (t && t.d !== Infinity) out.push(t); }
    out.sort((p, q) => p.d - q.d || p.key - q.key);
    return out.slice(0, k);
  },
  valid(s, col, t) {
    const b = bldById(s, t.id);
    if (!target(s, col, b)) return false;
    t.plan = refuelJob(s, col, b, t.stand);
    return !!t.plan;
  },
  make(s, col, t) { return t.plan; },
  keyOf: (t) => t.key,
  fromTarget(s, col, tg) { if (!tg || tg.kind !== 'bld') return null; return target(s, col, bldById(s, tg.id)); },
});

/** The Hearth under URGENT_FUEL_DAYS of fuel (think.js asks it for anyone with Haul enabled, before
 * the work loop: X 2.7, a colony whose only hauler had other roles let the Hearth go cold with 700 wood
 * in store, and the cold Hearth's dark and -15 mood broke the whole hold). */
export const URGENT_FUEL_DAYS = 1;
export const URGENT_REFUEL_GIVER = Object.freeze({
  ...REFUEL_GIVER, id: 'urgentRefuel',
  candidates(s, col, k) {
    const h = s.colony && s.colony.hearth;
    if (!h || h.id === null || h.id === undefined || hearthFuelDays(s) >= URGENT_FUEL_DAYS) return [];
    const t = target(s, col, bldById(s, h.id));
    return t && t.d !== Infinity ? [t] : [];
  },
});

registerToil('refuel', (s, col, job, toil) => {
  const b = bldById(s, toil.b), c = carried(col);
  if (!b || !c) return NEXT;
  const used = addFuel(s, b, c.k, c.n);
  c.n -= used;
  if (c.n <= 0) job.carry = null;
  return NEXT;
});

export const GIVER = REFUEL_GIVER;
