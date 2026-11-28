// World factions and goodwill (doc 9.8; EMBERCROWN-WORLD.md G7, 2.7 factions row, 9.4 step 4). Owner K.
// s.colony.factions = { league, hearthwatch, gutterkin } goodwill -100..100 (C2). Goodwill changes
// prices (trade.js), envoy frequency and whether a captured raider can be ransomed.
//
// W3.3a (G7): the five saved faction ids are ROLE keys. In a hold whose realm record with history is loaded
// (s.rt.realm, wid-checked: realmRec), bindRoles fills s.realm.bind = { role: civ id | null } once, by the rules of
// 9.4 step 4, and the bound roles keep their goodwill in s.colony.factions exactly as the legacy rows did (same
// deltas for the same acts). A civ that fills no role is the faction 'c<n>': its goodwill lives in s.realm.stand
// ([[civ, goodwill, flags]], sorted by civ id, a row only once it has moved) and starts from its rel to the liege
// (relStart: 2.3 step 2's static terms). A hold with no realm record (realm-less, or the record lost: 9.2) runs the
// legacy rows untouched.

import { def } from './defs.js';
import { CIVKINDS } from '../../data/realm/civkinds.js';
import { REL, ETHIC_AXES } from '../../data/realm/ethics.js';
import { ethicDistance, sharedHome } from '../realm/civs.js';

export const GOODWILL_IDS = Object.freeze(['league', 'hearthwatch', 'gutterkin']);
/** The five role keys of G7, in binding order (the liege first: the ashfang rule reads it). */
export const ROLE_IDS = Object.freeze(['hearthwatch', 'league', 'gutterkin', 'ashfang', 'pilgrims']);
/** The civ kind each role binds to (data/realm/civkinds.js `role`). */
export const ROLE_KIND = Object.freeze(Object.fromEntries(CIVKINDS.filter((k) => k.role).map((k) => [k.role, k.id])));
const CIV_KEY = /^c(\d+)$/;

/** Stage 2: the standings start at the data's `start` values (trade.js calls it once, with its record). */
export function seedGoodwill(s) {
  const f = s.colony.factions;
  for (const id of GOODWILL_IDS) { const d = def('faction', id); if (d && Number.isInteger(d.start) && !(f[id] | 0)) f[id] = d.start; }
}

// ---- the realm (W3.3a) ---------------------------------------------------------------------------------------
/** The hold's decoded realm record with history (s.rt.realm, wid-checked), or null: the legacy rows run. */
export function realmRec(s) {
  const R = s && s.realm && s.rt ? s.rt.realm : null;
  if (!R || (R.wid >>> 0) !== (s.realm.wid >>> 0) || !R.tables || !Array.isArray(R.tables.civs) || !R.tables.civs.length) return null;
  return R;
}
const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
/** The sites now: the record's rows with the hold's s.realm.sites deltas ([site, owner, size, year]; owner < 0 or null: razed). */
export function sitesNow(s, R) {
  const out = R.tables.sites.map((x) => ({ id: x.id, x: x.x, y: x.y, kind: x.kind, civ: x.razed === null ? x.civ : null, size: x.size | 0 }));
  for (const d of (s.realm && s.realm.sites) || []) {
    if (!Array.isArray(d) || !out[d[0]]) continue;
    const o = out[d[0]];
    o.civ = Number.isInteger(d[1]) && d[1] >= 0 ? d[1] : null;
    if (Number.isInteger(d[2])) o.size = d[2];
  }
  return out;
}
/** Civ id -> Chebyshev distance from the hold to its nearest living site (living civs only). */
function civReach(s, R, sites) {
  const m = new Map();
  for (const x of sites) {
    if (x.civ === null || !R.tables.civs[x.civ] || R.tables.civs[x.civ].fell !== null) continue;
    const d = cheb(x.x, x.y, s.realm.rx, s.realm.ry), o = m.get(x.civ);
    if (o === undefined || d < o) m.set(x.civ, d);
  }
  return m;
}
/** The nearest living civ passing `ok` (ties by the lower id), or null. */
function nearest(R, reach, ok) {
  let best = null, bd = 0;
  for (const c of R.tables.civs) {
    const d = reach.get(c.id);
    if (d === undefined || !ok(c)) continue;
    if (best === null || d < bd) { best = c.id; bd = d; }
  }
  return best;
}
/** rel of civ a to civ b from the static terms of 2.3 step 2 (base, ethic distance, shared home, pact), -100..100. */
export function relStatic(R, a, b) {
  const A = R.tables.civs[a], B = R.tables.civs[b];
  if (!A || !B || !A.eth || !B.eth) return 0;
  const v = REL.base - REL.perDist * ethicDistance(A.eth, B.eth) + (sharedHome(A.people, B.people) ? REL.sharedHome : 0) + ((A.pacts || []).includes(b) ? REL.pact : 0);
  return v < -100 ? -100 : v > 100 ? 100 : v;
}
/**
 * When no living civ of a role's kind is left, the role goes to the nearest unbound living civ that fits it best
 * (G7: every role names a civ while enough civs live): `axis` the ethic axis (4.4) the role leans on and `dir` its
 * sign (+1 the most of it first); ashfang has no axis: the most hostile to the liege (lowest rel) first.
 */
export const ROLE_FALLBACK = Object.freeze({ hearthwatch: null, league: { axis: 'coin', dir: 1 }, gutterkin: { axis: 'law', dir: -1 }, ashfang: { rel: true }, pilgrims: { axis: 'dead', dir: 1 } });
/**
 * Bind the five roles to civs (G7; the rules of 9.4 step 4) into s.realm.bind and return it. hearthwatch: s.realm.civ
 * when it is a living civ, else the nearest human kingdom, else the nearest kingdom; league, gutterkin, pilgrims: the
 * nearest civ of their kind; ashfang: the nearest clans with rel < 0 to the liege, else the nearest clans. With none of
 * its kind alive a role takes ROLE_FALLBACK's pick; with no civ left at all it is bound to null (the legacy row). A civ
 * fills one role at most. Saved goodwill is not touched. null with no record.
 */
export function bindRoles(s, R = realmRec(s)) {
  if (!R || !s.realm) return null;
  const reach = civReach(s, R, sitesNow(s, R)), bind = {}, used = new Set();
  const kindOf = (c) => (typeof c.kind === 'number' ? (CIVKINDS[c.kind] || {}).id : c.kind);
  const free = (ok) => (c) => !used.has(c.id) && ok(c);
  for (const role of ROLE_IDS) {
    const kind = ROLE_KIND[role];
    let id = null;
    if (role === 'hearthwatch') {
      if (Number.isInteger(s.realm.civ) && reach.has(s.realm.civ)) id = s.realm.civ;
      if (id === null) id = nearest(R, reach, free((c) => kindOf(c) === kind && c.people === 'human'));
    } else if (role === 'ashfang' && Number.isInteger(bind.hearthwatch)) {
      id = nearest(R, reach, free((c) => kindOf(c) === kind && relStatic(R, c.id, bind.hearthwatch) < 0));
    }
    if (id === null) id = nearest(R, reach, free((c) => kindOf(c) === kind));
    bind[role] = id;
    if (id !== null) used.add(id);
  }
  // then the roles with none of their kind left, in the same order, from the civs still unbound
  for (const role of ROLE_IDS) {
    if (bind[role] !== null) continue;
    bind[role] = fallbackCiv(R, reach, role, used, bind.hearthwatch);
    if (bind[role] !== null) used.add(bind[role]);
  }
  s.realm.bind = { hearthwatch: bind.hearthwatch, league: bind.league, gutterkin: bind.gutterkin, ashfang: bind.ashfang, pilgrims: bind.pilgrims };
  return s.realm.bind;
}
/** ROLE_FALLBACK's pick among the unbound living civs: the best fit, then the nearest, then the lowest id. */
function fallbackCiv(R, reach, role, used, liege) {
  const fb = ROLE_FALLBACK[role], ax = fb && fb.axis ? ETHIC_AXES.indexOf(fb.axis) : -1;
  let best = null, key = null;
  for (const c of R.tables.civs) {
    const d = reach.get(c.id);
    if (d === undefined || used.has(c.id)) continue;
    const fit = !fb ? 0 : fb.rel ? (Number.isInteger(liege) ? -relStatic(R, c.id, liege) : 0) : ax >= 0 && c.eth ? fb.dir * c.eth[ax] : 0;
    if (key === null || fit > key[0] || (fit === key[0] && d < key[1])) { best = c.id; key = [fit, d]; }
  }
  return best;
}
/** Bind the roles once (the colony tick, hourly): a no-op for a realm-less hold, a lost record, or a hold already bound. */
export function ensureBound(s) {
  if (!s.realm || (s.realm.bind && Object.keys(s.realm.bind).length)) return;
  const R = realmRec(s);
  if (R) bindRoles(s, R);
}
/** The civ a role or a 'c<n>' faction stands for, or null. */
export function civOfFaction(s, f) {
  if (!s.realm || typeof f !== 'string') return null;
  const m = CIV_KEY.exec(f);
  if (m) return +m[1];
  const b = s.realm.bind && s.realm.bind[f];
  return Number.isInteger(b) ? b : null;
}
/** The faction key of civ `id`: the first role bound to it, else 'c<id>'. */
export function factionOfCiv(s, id) {
  const b = (s.realm && s.realm.bind) || {};
  for (const r of ROLE_IDS) if (b[r] === id) return r;
  return 'c' + id;
}
/** The liege civ: the Hearthwatch role's civ, else s.realm.civ, else null. */
export function liegeCiv(s) {
  const b = s.realm && s.realm.bind && s.realm.bind.hearthwatch;
  return Number.isInteger(b) ? b : s.realm && Number.isInteger(s.realm.civ) ? s.realm.civ : null;
}
/** A 'c<n>' civ's starting goodwill (2.7): its static rel to the liege (0 with no record or no liege). */
export function civStart(s, id, R = realmRec(s)) {
  const L = liegeCiv(s);
  return R && L !== null && R.tables.civs[id] ? relStatic(R, id, L) : 0;
}
const standRow = (s, id) => (s.realm && Array.isArray(s.realm.stand) ? s.realm.stand.find((r) => Array.isArray(r) && r[0] === id) : null) || null;
/** A 'c<n>' civ's goodwill: its stand row, else civStart. */
export function civGoodwill(s, id) { const r = standRow(s, id); return r ? r[1] | 0 : civStart(s, id); }

/** The standing as a word for the Colony panel line. */
export function standingOf(s, f) { const g = goodwill(s, f); return g >= 50 ? 'Allied' : g >= 15 ? 'Friendly' : g > -15 ? 'Neutral' : g > -50 ? 'Wary' : 'Hostile'; }
/** Goodwill of a role key (the legacy row) or of a 'c<n>' civ faction (s.realm.stand); 0 for anything else. */
export function goodwill(s, f) {
  if (GOODWILL_IDS.includes(f)) return s.colony.factions[f] | 0;
  const m = typeof f === 'string' && s.realm ? CIV_KEY.exec(f) : null;
  return m ? civGoodwill(s, +m[1]) : 0;
}
export function addGoodwill(s, f, d) {
  if (GOODWILL_IDS.includes(f)) {
    const v = Math.max(-100, Math.min(100, (s.colony.factions[f] | 0) + d));
    s.colony.factions[f] = v;
    return v;
  }
  const m = typeof f === 'string' && s.realm ? CIV_KEY.exec(f) : null;
  if (!m) return 0;
  const id = +m[1], v = Math.max(-100, Math.min(100, civGoodwill(s, id) + d));
  if (!Array.isArray(s.realm.stand)) s.realm.stand = [];
  const row = standRow(s, id);
  if (row) row[1] = v;
  else { s.realm.stand.push([id, v, 0]); s.realm.stand.sort((a, b) => a[0] - b[0]); }
  return v;
}
/** Price percent adjustment from goodwill: +-10% at +-100 (Stage 2 tuning moves to balance.js). */
export const goodwillPricePct = (s, f) => 100 - Math.trunc(goodwill(s, f) / 10);
/** A faction's name for the player: a bound role or 'c<n>' shows its civ's name (with a record), else the data row's. */
export function factionName(s, f) {
  const R = realmRec(s), id = R ? civOfFaction(s, f) : null, c = id !== null ? R.tables.civs[id] : null;
  if (c) return c.name.startsWith('the ') ? c.name.slice(4) : c.name;
  const d = def('faction', f);
  return d ? d.name : String(f);
}
