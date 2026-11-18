// Threat points and raid composition (doc 9.2, 9.3). Owner H. Provisional API.
//
// threatPoints(s) follows 9.2 with integer maths (balance.js THREAT; rates per mille):
//   wealthPts = wealth <= knee ? wealth x lo / 1000 : kneePts + (wealth - knee) x hi / 1000
//   popPts    = popPer x max(0, able - popFree);  floorPts = floorPerDay x day + yearEndPts x years
//   points    = clamp((base + wealth + pop + floor) x difficulty% x storyteller% x defenceAdj%, min, max)
// Wealth is K's threat wealth (walls, floors and defences at wallWealthPct, colony/wealth.js).
// composeRaid() fills a budget greedily from the raiders whose tags match the incident (weighted
// by the 'story' stream), at most THREAT.maxPerRaid members and the map's hostile room.

import { dayOf, DAYS_PER_YEAR } from '../core/time.js';
import { W, H, idx } from '../core/grid.js';
import { nextU32 } from '../core/rand.js';
import { computeWealth } from '../colony/wealth.js';
import { able } from '../people/health.js';
import { bal, def, all } from './defs.js';
import { EDGES, incidentDef } from './incidents.js';

/** Defence adjustment percent from the last majors in s.st.history (9.2). */
export function defenceAdjPct(s) {
  const T = bal('threat');
  const majors = s.st.history.filter((h) => h.cat === 'major');
  const last = majors.slice(-3);
  if (last.slice(-2).some((h) => h.deaths > 0)) return T.lossAdjPct;
  if (last.length === 3 && last.every((h) => h.result === 'repelled' && !h.downed)) return Math.min(T.winAdjPct, T.winAdjMaxPct);
  return 100;
}
export const ableCount = (s) => s.col.reduce((n, c) => n + (able(c) ? 1 : 0), 0);

/**
 * The threat budget now. `over` replaces any input (tests, the bot report): { wealth, able, day,
 * difficultyPct, storytellerPct, adjPct }.
 */
export function threatPoints(s, over = {}) {
  const T = bal('threat');
  const wealth = over.wealth !== undefined ? over.wealth : computeWealth(s).threat;
  const ableN = over.able !== undefined ? over.able : ableCount(s);
  const day = over.day !== undefined ? over.day : dayOf(s.tick);
  const wPts = wealth <= T.wealthKnee ? Math.floor((wealth * T.wealthLoPermille) / 1000) : T.wealthKneePts + Math.floor(((wealth - T.wealthKnee) * T.wealthHiPermille) / 1000);
  const pPts = T.popPer * Math.max(0, ableN - T.popFree);
  const fPts = T.floorPerDay * day + T.yearEndPts * Math.floor(day / DAYS_PER_YEAR);
  const diff = over.difficultyPct !== undefined ? over.difficultyPct : (T.difficultyPct[s.colony.difficulty] || 100);
  const stDef = def('storyteller', s.colony.storyteller);
  const stPct = over.storytellerPct !== undefined ? over.storytellerPct : stDef ? stDef.ptsPct : 100;
  const adj = over.adjPct !== undefined ? over.adjPct : defenceAdjPct(s);
  const raw = Math.floor(((T.base + wPts + pPts + fPts) * diff * stPct * adj) / 1000000);
  return Math.max(T.min, Math.min(T.max, raw));
}

/** Raider defs an incident may bring (tags shared with the incident; all when it has none). */
export function raiderPool(inc) {
  const tags = inc && inc.tags ? inc.tags : [];
  return all('raider').filter((r) => !tags.length || (r.tags || []).some((t) => tags.includes(t)));
}

/** Fill `pts` from `pool` (raider ids, cheapest last resort). Deterministic on stream 'story'. */
export function composeRaid(s, pool, pts, room = bal('threat').maxPerRaid) {
  const members = [];
  let left = pts;
  const cap = Math.min(room, bal('threat').maxPerRaid);
  while (members.length < cap) {
    const fit = pool.filter((r) => r.pts <= left);
    if (!fit.length) break;
    const r = fit[nextU32(s, 'story') % fit.length];
    members.push(r.id);
    left -= r.pts;
  }
  return { members, spent: pts - left };
}

/** A passable map-edge tile on a side, scanning from a seeded offset (null when the side is closed). */
export function edgeTile(s, side) {
  const len = side === 'n' || side === 's' ? W : H;
  const off = nextU32(s, 'story') % len;
  for (let k = 0; k < len; k++) {
    const t = (off + k) % len;
    const i = side === 'n' ? idx(t, 0) : side === 's' ? idx(t, H - 1) : side === 'w' ? idx(0, t) : idx(W - 1, t);
    if (s.rt.walkCost[i] !== 0) return i;
  }
  return null;
}

/** Hostiles currently on the map (the 80 cap counts foes and hostile animals). */
export const hostilesOnMap = (s) => s.foes.length;

/** Plan a raid for a queue entry: budget, composition, edge, goal (RaidPlan, C12). `only`: raider
 *  ids to compose from instead of the incident's pool (the scripted first horde is Husks only, 9.1). */
export function planRaid(s, entry, pts = threatPoints(s), only = null) {
  const inc = incidentDef(entry.inc);
  const budget = Math.max(inc && inc.pts ? inc.pts.min : 0, Math.floor((pts * (inc && inc.pts ? inc.pts.mult : 100)) / 100));
  const room = Math.max(0, bal('threat').maxHostiles - hostilesOnMap(s));
  const pool = only ? all('raider').filter((r) => only.includes(r.id)) : raiderPool(inc);
  const { members, spent } = composeRaid(s, pool, budget, room);
  let side = EDGES[nextU32(s, 'story') % 4], i = edgeTile(s, side);
  for (let k = 0; i === null && k < 4; k++) { side = EDGES[k]; i = edgeTile(s, side); }
  const goal = inc && inc.tags && inc.tags.includes('thief') ? 'loot' : inc && inc.tags && inc.tags.includes('sapper') ? 'dig' : inc && inc.tags && inc.tags.includes('beast') ? 'people' : 'core';
  return { pts: spent, edge: { side, i: i === null ? 0 : i }, goal, members, nem: null };
}
