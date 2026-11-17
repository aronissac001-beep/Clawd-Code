// Colonist generation and arrival (doc 4.1, 4.9, 8.5). Owner F. Provisional API.
//
// generateColonist(s, opts) rolls a full Colonist (schema C2) from F's data files on the RNG
// streams 'names' (name and look) and 'main' (everything else); it does not add it to the colony.
// spawnColonist(s, col, tx, ty) adds it at a tile and queues its first think.
// Rolls: ancestry (or opts.anc), name (first + family from names.js), age 18-70, look, attributes
// 1-5 summing 8-10, a childhood and an adult backstory (skill offsets, disabled work), skill levels
// 0-3 plus the backstory offsets, 2-4 passions (+1 for Humans, one in four burning), 1-3 traits
// (weighted, exclusive pairs respected), a suggested role from the best passion skill, and the
// computed priorities. opts.req { skill, min } raises that skill to at least min (a start's slot).

import { newColonist, SKILL_IDS, PASSION } from '../core/schema.js';
import { nextId } from '../core/state.js';
import { ctrW } from '../core/grid.js';
import { nextU32 } from '../core/rand.js';
import { requestThink } from '../work/jobs.js';
import { all, def } from './defs.js';
import { applyRoles, suggestRole } from './roles.js';

export const AGE = Object.freeze([18, 70]);
export const ATTR_SUM = Object.freeze([8, 10]);
export const LOOK_RANGES = Object.freeze({ skin: 6, hair: 8, hairC: 6, beard: 5, cloth: 6 });

const int = (s, k, a, b) => a + (nextU32(s, k) % (b - a + 1));
const pick = (s, k, arr) => arr[nextU32(s, k) % arr.length];
function weighted(s, k, list, w = (x) => x.weight | 0) {
  let total = 0;
  for (const x of list) total += Math.max(0, w(x));
  if (total <= 0) return null;
  let r = nextU32(s, k) % total;
  for (const x of list) { r -= Math.max(0, w(x)); if (r < 0) return x; }
  return list[list.length - 1];
}

/** Roll the three attributes to a sum within ATTR_SUM (bounded retries, then [3, 3, 3]). */
export function rollAttributes(s) {
  for (let tries = 0; tries < 64; tries++) {
    const a = [int(s, 'main', 1, 5), int(s, 'main', 1, 5), int(s, 'main', 1, 5)];
    const sum = a[0] + a[1] + a[2];
    if (sum >= ATTR_SUM[0] && sum <= ATTR_SUM[1]) return a;
  }
  return [3, 3, 3];
}

/** Pick 1-3 traits, weighted, never two of an exclusive pair. */
export function rollTraits(s, n = int(s, 'main', 1, 3)) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const pool = all('trait').filter((t) => !out.includes(t.id) && !out.some((o) => { const d = def('trait', o); return d && d.excl === t.id; }) && !(t.excl && out.includes(t.excl)));
    const t = weighted(s, 'main', pool);
    if (!t) break;
    out.push(t.id);
  }
  return out;
}

/**
 * A new colonist (not yet in the colony).
 * @param {object} s
 * @param {{ anc?: string, req?: { skill: string, min: number }, name?: string, id?: number }} [opts]
 */
export function generateColonist(s, opts = {}) {
  const ancs = all('ancestry');
  const anc = opts.anc || (ancs.length ? pick(s, 'main', ancs).id : 'human');
  const nt = def('names', anc) || def('names', 'human');
  const name = opts.name || (nt ? `${pick(s, 'names', nt.first)} ${pick(s, 'names', nt.family)}` : 'Wanderer');
  const look = {};
  for (const k of Object.keys(LOOK_RANGES)) look[k] = nextU32(s, 'names') % LOOK_RANGES[k];
  const bsChild = all('backstory').filter((b) => b.slot === 'child'), bsAdult = all('backstory').filter((b) => b.slot === 'adult');
  const bs = [bsChild.length ? pick(s, 'main', bsChild).id : null, bsAdult.length ? pick(s, 'main', bsAdult).id : null];

  const sk = SKILL_IDS.map(() => [int(s, 'main', 0, 3), 0, PASSION.NONE, 0]);
  for (const b of bs) { const d = def('backstory', b); if (d && d.skills) for (const k of SKILL_IDS) if (d.skills[k]) sk[SKILL_IDS.indexOf(k)][0] += d.skills[k]; }
  if (opts.req) { const i = SKILL_IDS.indexOf(opts.req.skill); if (i >= 0 && sk[i][0] < opts.req.min) sk[i][0] = opts.req.min; }
  for (const x of sk) x[0] = Math.max(0, Math.min(20, x[0]));

  // Passions on the best skills first (a seeded shuffle breaks ties).
  const nPass = int(s, 'main', 2, 4) + (anc === 'human' ? 1 : 0);
  const order = SKILL_IDS.map((_, i) => [i, sk[i][0] * 1000 + (nextU32(s, 'main') % 1000)]).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  for (let k = 0; k < nPass && k < order.length; k++) sk[order[k][0]][2] = nextU32(s, 'main') % 4 === 0 ? PASSION.BURNING : PASSION.KEEN;

  const col = newColonist(opts.id !== undefined ? opts.id : nextId(s, 'col'), {
    name, anc, age: int(s, 'main', AGE[0], AGE[1]), look, bs, at: rollAttributes(s), sk, traits: rollTraits(s),
  });
  let best = 0;
  for (let i = 1; i < sk.length; i++) if (sk[i][2] > sk[best][2] || (sk[i][2] === sk[best][2] && sk[i][0] > sk[best][0])) best = i;
  col.role = [suggestRole(col, all('role'), SKILL_IDS[best]), null];
  applyRoles(s, col);
  return col;
}

/** Add a colonist to the colony at tile (tx, ty) and queue its first think. */
export function spawnColonist(s, col, tx, ty) {
  col.x = ctrW(tx); col.y = ctrW(ty);
  s.col.push(col);
  s.col.sort((a, b) => a.id - b.id);
  requestThink(s, col.id);
  return col;
}

/** The starting band of a start (js/data/starts.js), generated but not spawned. */
export function startingBand(s, startId) {
  const st = def('start', startId) || all('start').find((x) => x.default);
  if (!st) return [];
  return st.band.map((slot) => generateColonist(s, { anc: slot.any ? undefined : slot.anc, req: slot.req }));
}
