// Threat points and raid composition (doc 9.2, 9.3, 9.10). Owner H. Provisional API.
//
// threatPoints(s) follows 9.2 with integer maths (balance.js THREAT; rates per mille):
//   wealthPts = wealth <= knee ? wealth x lo / 1000 : kneePts + (wealth - knee) x hi / 1000
//   popPts    = popPer x max(0, able - popFree);  floorPts = min(floorMax[difficulty], floorPerDay x day + yearEndPts x years) x floorPct
//   points    = clamp((base + wealth + pop + floor) x difficulty% x storyteller% x defenceAdj%, min, max)
// Wealth is K's threat wealth (walls, floors and defences at wallWealthPct, colony/wealth.js); the
// storyteller's floorPct makes the floor rise faster (The Long Night: x2).
// composeRaid() fills a budget greedily from the raiders whose tags match the incident (weighted
// by the 'story' stream), at most THREAT.maxPerRaid members and the map's hostile room; when the
// cheapest would overflow the cap, it draws from the heavier half first (9.2: elites before numbers).
// Stage 2: the pool is limited to raiders of the colony's tier (stats.js `tier`); a horde or breach
// of 100+ points gets an elite leader (warden affix; it may become a nemesis); a warband always has
// a captain; a nemesis-led raid is led by the nemesis (its kind, its affixes).
// W3.4 (EMBERCROWN-WORLD.md 2.7 raids row): a raid whose cause is a civ (causes.js civ rows, only while the realm
// record is loaded) has its budget scaled by the civ's living sites (causes.js civSizePct), draws the raider rows of
// the civ's people when G has them (PEOPLE_RAIDERS), enters from the side where the civ lives (causes.js civSide) and
// is led by a named living figure (plan.civ, plan.fig; the leader foe carries st.fig, raiders.js). A nemesis that came
// from a figure keeps leading as that figure. Realm-less holds and holds without the record plan exactly as before.

import { dayOf, DAYS_PER_YEAR } from '../core/time.js';
import { W, H, D, idx, TER } from '../core/grid.js';
import { skyZAt } from '../world/vertical.js';
import { nextU32 } from '../core/rand.js';
import { computeWealth } from '../colony/wealth.js';
import { able } from '../people/health.js';
import { stage2 } from '../people/defs.js';
import { bal, def, all } from './defs.js';
import { EDGES, incidentDef } from './incidents.js';
import { foeStats } from './stats.js';
import { nemesisById, realmRecord, nemFigOf } from './nemesis.js';
import { breachSeeps, passagesOf, openedCaverns, dormantRows, civOfCause, civSides, civSizePct, raidLeader } from './causes.js';

/** The raider rows each people sends (4.5 new raider rows; the composer uses only those js/data/raiders.js defines). */
export const PEOPLE_RAIDERS = Object.freeze({
  human: ['crown_levy', 'crown_knight'], wendrel: ['wendrel_outrider'], sylvari: ['rootwarden_archer', 'rootwarden_warden'],
  kilnfolk: ['slagguard'], tarnfolk: ['netcaster'], greyborn: ['ash_zealot'],
});
/** The civ a raid entry comes from ({ R, id, civ }) when its cause is a civ and the realm record is loaded, else null. */
export function raidCivOf(s, entry) {
  const id = civOfCause(entry && entry.cause), R = id !== null ? realmRecord(s) : null;
  return R && R.tables.civs[id] ? { R, id, civ: R.tables.civs[id] } : null;
}

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
 * difficultyPct, storytellerPct, adjPct, floorPct, floorMax }.
 */
export function threatPoints(s, over = {}) {
  const T = bal('threat');
  const wealth = over.wealth !== undefined ? over.wealth : computeWealth(s).threat;
  const ableN = over.able !== undefined ? over.able : ableCount(s);
  const day = over.day !== undefined ? over.day : dayOf(s.tick);
  const stDef = def('storyteller', s.colony.storyteller);
  const floorPct = over.floorPct !== undefined ? over.floorPct : stDef && stDef.floorPct ? stDef.floorPct : 100;
  const wPts = wealth <= T.wealthKnee ? Math.floor((wealth * T.wealthLoPermille) / 1000) : T.wealthKneePts + Math.floor(((wealth - T.wealthKnee) * T.wealthHiPermille) / 1000);
  const pPts = T.popPer * Math.max(0, ableN - T.popFree);
  // the floor rises with the days up to its difficulty's cap (2.9b: uncapped, the calendar alone took a
  // Steadfast hold from 400 points at day 100 to 1,500 at day 300, whatever it had to defend; past the
  // cap the raids grow with the hold's wealth and people, the 9.2 terms a player can see and answer)
  const fMax = over.floorMax !== undefined ? over.floorMax : T.floorMax && T.floorMax[s.colony.difficulty] !== undefined ? T.floorMax[s.colony.difficulty] : Infinity;
  const fPts = Math.floor((Math.min(fMax, T.floorPerDay * day + T.yearEndPts * Math.floor(day / DAYS_PER_YEAR)) * floorPct) / 100);
  const diff = over.difficultyPct !== undefined ? over.difficultyPct : (T.difficultyPct[s.colony.difficulty] || 100);
  const stPct = over.storytellerPct !== undefined ? over.storytellerPct : stDef ? stDef.ptsPct : 100;
  const adj = over.adjPct !== undefined ? over.adjPct : defenceAdjPct(s);
  const raw = Math.floor(((T.base + wPts + pPts + fPts) * diff * stPct * adj) / 1000000);
  return Math.max(T.min, Math.min(T.max, raw));
}

/** Raider defs an incident may bring (tags shared with the incident; all when it has none). With the
 *  colony given: only raiders of its tier that the composer may draw (no Rift, no captains). */
export function raiderPool(inc, s = null) {
  const tags = inc && inc.tags ? inc.tags : [];
  const tier = s ? s.colony.tier | 0 : 99;
  return all('raider').filter((r) => (!tags.length || (r.tags || []).some((t) => tags.includes(t)))
    && (!s || (foeStats(r.id).compose !== false && foeStats(r.id).tier <= tier)));
}

/** Fill `pts` from `pool` (raider ids, cheapest last resort). Deterministic on stream 'story'. */
export function composeRaid(s, pool, pts, room = bal('threat').maxPerRaid) {
  const members = [];
  let left = pts;
  const cap = Math.min(room, bal('threat').maxPerRaid);
  if (!pool.length) return { members, spent: 0 };
  const cheapest = Math.min(...pool.map((r) => r.pts));
  // too many points for the cap at the cheapest price: draw from the heavier half first (9.2)
  const sorted = pool.slice().sort((a, b) => a.pts - b.pts || (a.id < b.id ? -1 : 1));
  const heavy = sorted.slice(Math.floor(sorted.length / 2));
  while (members.length < cap) {
    const over = left / cheapest > cap - members.length;
    let fit = (over ? heavy : pool).filter((r) => r.pts <= left);
    if (!fit.length) fit = pool.filter((r) => r.pts <= left);
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
    let i = side === 'n' ? idx(t, 0) : side === 's' ? idx(t, H - 1) : side === 'w' ? idx(0, t) : idx(W - 1, t);
    if (D > 1) i = surfaceVoxel(s, i);   // 2.10: entries at the surface z of each edge column
    if (i >= 0 && s.rt.walkCost[i] !== 0) return i;
  }
  return null;
}
/** D > 1: the voxel a walker stands on at the top of column c (its skyZ level), or -1 when that is closed. */
export function surfaceVoxel(s, c) {
  const z = Math.min(D - 1, skyZAt(s, c)), i = z * W * H + c;
  return s.rt.walkCost[i] !== 0 ? i : -1;
}
/** The deepest open tile of the hold's tunnels (breach from the deep): max rt.depth among open,
 *  non-rock tiles under a rock roof; ties by lower index. -1 when there is none. */
export function deepestTile(s) {
  if (D > 1) return -1;   // Z1: breaches from the seeps come with Z3; a breach enters at a surface edge
  let best = -1, bd = 0;
  const d = s.rt.depth, t = s.L.terrain, wc = s.rt.walkCost;
  for (let i = 0; i < d.length; i++) if (d[i] > bd && t[i] !== TER.ROCK && wc[i] !== 0 && s.L.roof[i] >= 2) { bd = d[i]; best = i; }
  return best;
}

/** Hostiles currently on the map (the 80 cap counts foes and hostile animals). */
export const hostilesOnMap = (s) => s.foes.length;

/** The raid goal for an incident's tags (9.3). */
export function goalOf(inc) {
  const t = (inc && inc.tags) || [];
  if (t.includes('thief')) return 'loot';
  if (t.includes('sapper')) return 'dig';
  if (t.includes('beast') || t.includes('reaver') || t.includes('breach')) return 'people';
  return 'core';
}

// ---- the deep (Z3.1; D > 1) -----------------------------------------------------------------------------------
/** The pack each cavern sends (raider ids; the first is the pack's kind). */
export const CAVE_PACKS = Object.freeze({ hollows: ['cave_spider'], mere: ['cave_spider'], reach: ['gloom_hound'] });
/** The deep incidents: they enter through a deep passage of an opened cavern. */
export const DEEP_INCIDENTS = Object.freeze(['cavern_pack', 'lamplost_thieves']);
/** The cavern a deep entry comes from: its cause's subject when that is an opened cavern, else a seeded opened one. */
export function deepCavern(s, entry) {
  if (entry.inc === 'lamplost_thieves') return 'mere';
  const op = openedCaverns(s).filter((id) => passagesOf(s, id).some((v) => s.rt.walkCost[v] !== 0)), c = entry.cause;
  if (c && c[0] === 'opened_cavern' && op.includes(c[1])) return c[1];
  if (entry.cav && op.includes(entry.cav)) return entry.cav;
  return op.length ? op[nextU32(s, 'story') % op.length] : null;
}
/** The voxel a deep entry comes in at: a passage of its cavern (the Lamplost: the one nearest their camp), or -1
 *  when that cavern is not open (nothing comes through a passage before its cavern is opened, 2.10). */
export function deepEntry(s, entry, cav = deepCavern(s, entry)) {
  if (!cav || !openedCaverns(s).includes(cav)) return -1;
  const ps = passagesOf(s, cav).filter((v) => s.rt.walkCost[v] !== 0);
  if (!ps.length) return -1;
  if (entry.inc === 'lamplost_thieves') {
    const camp = dormantRows(s, 'lamplost')[0];
    if (camp) {
      const cx = camp[1] % W, cy = ((camp[1] % (W * H)) / W) | 0, d = (v) => Math.abs((v % W) - cx) + Math.abs((((v % (W * H)) / W) | 0) - cy);
      return ps.slice().sort((a, b) => d(a) - d(b) || a - b)[0];
    }
  }
  return ps[nextU32(s, 'story') % ps.length];
}
/** The seep a breach comes up through (D > 1): a woken seep (seeded pick), else -1. */
export function breachEntry(s) {
  const ss = breachSeeps(s).filter((v) => s.rt.walkCost[v] !== 0);
  return ss.length ? ss[nextU32(s, 'story') % ss.length] : -1;
}

/** Plan a raid for a queue entry: budget, composition, edge, goal (RaidPlan, C12). `only`: raider
 *  ids to compose from instead of the incident's pool (the scripted first horde is Husks only, 9.1). */
export function planRaid(s, entry, pts = threatPoints(s), only = null) {
  const inc = incidentDef(entry.inc);
  const rc = only ? null : raidCivOf(s, entry);
  if (rc) pts = Math.floor((pts * civSizePct(s, rc.R, rc.id)) / 100);   // W3.4: the civ's size
  const budget = Math.max(inc && inc.pts ? inc.pts.min : 0, Math.floor((pts * (inc && inc.pts ? inc.pts.mult : 100)) / 100));
  const room = Math.max(0, bal('threat').maxHostiles - hostilesOnMap(s));
  const S2 = stage2() && !only;
  const tags = (inc && inc.tags) || [];
  let pool = only ? all('raider').filter((r) => only.includes(r.id)) : raiderPool(inc, s);
  if (rc) { const own = (PEOPLE_RAIDERS[rc.civ.people] || []).filter((id) => def('raider', id) && !pool.some((r) => r.id === id) && foeStats(id).compose !== false && foeStats(id).tier <= (s.colony.tier | 0)); if (own.length) pool = pool.concat(own.map((id) => def('raider', id))); }
  // (Z3.1) the deep: an opened cavern's pack, or the Lamplost (their own scavengers once G adds them; Gutterkin
  // thieves' stats until then)
  const deep = D > 1 && S2 && DEEP_INCIDENTS.includes(entry.inc);
  let cav = null;
  if (deep) {
    cav = deepCavern(s, entry);
    const ids = entry.inc === 'lamplost_thieves' ? (def('raider', 'lamplost_scav') ? ['lamplost_scav'] : ['gutter_thief']) : CAVE_PACKS[cav] || CAVE_PACKS.hollows;
    pool = all('raider').filter((r) => ids.includes(r.id));
  }
  // beasts come as one kind of pack (wolves, boars or spiders); the Hollow hound is not a beast pack
  if (S2 && tags.includes('beast') && !deep) {
    const packs = [['wolf'], ['boar'], ['cave_spider']].filter((p) => pool.some((r) => r.id === p[0]));
    if (packs.length) { const p = packs[nextU32(s, 'story') % packs.length]; pool = pool.filter((r) => p.includes(r.id)); }
  }
  const lead = [];
  let aff = null;
  const nem = entry.nem !== undefined && entry.nem !== null ? nemesisById(s, entry.nem) : null;
  let left = budget;
  if (nem) { lead.push(nem.kind); left -= Math.max(0, (def('raider', nem.kind) || { pts: 60 }).pts * 2); aff = nem.affixes.slice(); }
  else if (S2 && tags.includes('reaver') && def('raider', 'reaver_captain')) { lead.push('reaver_captain'); left -= def('raider', 'reaver_captain').pts; }
  else if (S2 && (tags.includes('hollow') || tags.includes('breach')) && budget >= 100 && pool.length) {
    // the elite: the priciest of the pool at x1.6 (the warden affix)
    const top = pool.slice().sort((a, b) => b.pts - a.pts || (a.id < b.id ? -1 : 1))[0];
    lead.push(top.id); left -= Math.floor((top.pts * 16) / 10); aff = ['warden'];
  } else if (S2 && tags.includes('beast') && (!deep || cav === 'hollows') && budget >= 220 && def('raider', 'great_spider') && pool.some((r) => r.id === 'cave_spider')) {
    lead.push('great_spider'); left -= def('raider', 'great_spider').pts;
  }
  const { members, spent } = composeRaid(s, pool, Math.max(0, left), Math.max(0, room - lead.length));
  const all_ = lead.concat(members);
  let side = entry.side || EDGES[nextU32(s, 'story') % 4], i = null;
  const civSd = rc ? civSides(s, rc.R, rc.id) : [];
  if (civSd.length) side = civSd[0];   // W3.4: from where the civ lives
  if (S2 && tags.includes('breach')) { const d = D > 1 ? breachEntry(s) : deepestTile(s); if (d >= 0) { side = 'deep'; i = d; } }
  if (deep) { const d = deepEntry(s, entry, cav); if (d >= 0) { side = 'deep'; i = d; } }
  if (i === null) {
    if (side === 'deep') side = 'n';
    i = edgeTile(s, side);
    for (let k = 1; i === null && k < civSd.length; k++) { side = civSd[k]; i = edgeTile(s, side); }   // W3.4: the diagonal's other side
    for (let k = 0; i === null && k < 4; k++) { side = EDGES[k]; i = edgeTile(s, side); }
  }
  const plan = { pts: spent + (budget - Math.max(0, left)), edge: { side, i: i === null ? 0 : i }, goal: goalOf(inc), members: all_, nem: nem ? nem.id : null };
  if (deep && cav) plan.cav = cav;
  if (rc) {
    // W3.4: the civ and its named leader (a nemesis from a figure stays that figure)
    plan.civ = rc.id;
    const nf = nem ? nemFigOf(s, nem.id) : null, lf = nf ? rc.R.tables.figures[nf[1]] : raidLeader(s, rc.R, rc.id);
    if (lf) plan.fig = lf.id;
  }
  if (lead.length) { plan.lead = 0; if (aff && aff.length) plan.aff = aff; }
  return plan;
}
