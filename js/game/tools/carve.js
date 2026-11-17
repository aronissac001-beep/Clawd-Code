// Carve hall (owner I; doc 3.4, 10.11, 13.1 `js/game/tools/carve.js`). The planner behind the
// Carve hall preview: which tiles `carve {rect, pattern, smooth}` (C3; A's core/apply.js) will mark
// for mining, which rock it leaves standing as natural pillars and where built pillars or props go.
// The pillar points come from the applier's own pillarPlan, so preview and command agree.
// Read-only; no DOM.
import { idx, inB, TER, TER_MINEABLE, DESIG } from '../core/grid.js';
import { pillarPlan, rectN, borderOf } from '../core/apply.js';

/** Pillar patterns in chip order, with the player-facing names (10.11). */
export const CARVE_PATTERNS = Object.freeze([
  { id: 'natural', name: 'Natural pillars', short: 'Natural', text: 'Leave rock columns standing. Free.' },
  { id: 'pillar', name: 'Built pillars', short: 'Pillars', text: 'Mine everything; masons set stone pillars.' },
  { id: 'prop', name: 'Timber props', short: 'Props', text: 'Mine everything; carpenters set wooden props.' },
]);

/**
 * The plan of a hall.
 * @returns {{ ok, why, q, mine: number[], keep: number[], built: number[], smooth: number[], rock: number,
 *   already: number }} mine: tiles that get (or keep) a Mine mark; keep: natural pillars (rock left
 *   standing); built: pillar or prop spots; smooth: faces to smooth (with smooth on).
 */
export function carvePlan(s, o) {
  const q = rectN(o.rect);
  const pillars = pillarPlan(s, q);
  const pset = new Set(pillars);
  const natural = o.pattern === 'natural';
  const plan = { ok: false, why: null, q, mine: [], keep: [], built: [], smooth: [], rock: 0, already: 0 };
  for (let y = q.y0; y <= q.y1; y++) for (let x = q.x0; x <= q.x1; x++) {
    const i = idx(x, y), t = s.L.terrain[i];
    if (TER_MINEABLE[t]) plan.rock++;
    if (pset.has(i) && natural && t === TER.ROCK) { plan.keep.push(i); continue; }
    if (TER_MINEABLE[t]) { plan.mine.push(i); if (s.L.desig[i] & DESIG.MINE) plan.already++; }
  }
  for (const i of pillars) if (!plan.keep.includes(i)) plan.built.push(i);
  if (o.smooth) {
    const ring = { x0: q.x0 - 1, y0: q.y0 - 1, x1: q.x1 + 1, y1: q.y1 + 1 };
    for (const [x, y] of borderOf(ring)) if (inB(x, y) && s.L.terrain[idx(x, y)] === TER.ROCK) plan.smooth.push(idx(x, y));
    for (const i of plan.keep) plan.smooth.push(i);
  }
  if (!plan.rock) plan.why = 'carve a hall into rock';
  else plan.ok = true;
  return plan;
}

/** The command for a plan (C3 `carve`). */
export function carveCommand(o) {
  const q = rectN(o.rect);
  return { t: 'carve', rect: { x0: q.x0, y0: q.y0, x1: q.x1, y1: q.y1 }, pattern: o.pattern, smooth: !!o.smooth };
}

/** "Hall 9 x 9: 80 to mine, 1 natural pillar" for the hint and the loupe. */
export function carveLabel(o, plan) {
  const w = plan.q.x1 - plan.q.x0 + 1, h = plan.q.y1 - plan.q.y0 + 1;
  if (!plan.ok) return `Hall ${w} x ${h}: ${plan.why}`;
  const p = [`${plan.mine.length} to mine`];
  if (plan.keep.length) p.push(`${plan.keep.length} natural pillar${plan.keep.length === 1 ? '' : 's'}`);
  if (plan.built.length) p.push(`${plan.built.length} ${o.pattern === 'prop' ? 'prop' : 'pillar'}${plan.built.length === 1 ? '' : 's'} to set`);
  if (!plan.keep.length && !plan.built.length) p.push('the walls hold the roof');
  return `Hall ${w} x ${h}: ${p.join(', ')}`;
}
