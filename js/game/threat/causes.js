// Every threat has a cause (EMBERCROWN-FORTRESS.md 2.10, F26; step Z2.10). Owner H; data js/data/causes.js (G).
//
// A cause is a fact of the world state. The live list s.st.causes = [[kind, subject, weight]] is recomputed
// once per game day (st.causesDay; the storyteller's first hourly run of the day, or the first schedule of
// the day) from:
//   grievance  the pre-history (the Ashfang, driven out by the Old Crown; more for every Crown vault the hold
//              has opened), the Gutterkin while their goodwill is Wary or worse, and every living nemesis
//              (subject 'm<id>': it allows the major that nemesis leads)
//   rumour     traders who visited this year, weighted by the gems, coins and art they saw in the hold
//              (noted hourly while a visit is live: s.st.rumour = [[day, traderId, worth]], st.rumourVid)
//   hunger     the Hollow's hunger: always present, heavier as the Hearth grows
//   winter     Deepcold, the end of Ashfall, the start of Thaw, and a cold snap
//   carrion    (Z2b) raw meat, fish, carcasses and corpses in the hold (beasts any time of year)
//   seep       D = 1: the deep breach's own condition (raids2 BREACH_LOGIC.requires); D > 1 (Z3.1): a woken seep, a
//              found voxel within seepR tiles planar and nearDz levels of a seep row, or the Hold rank
//   opened_cavern  (Z3.1, D > 1) a cavern a colonist has stood in (its level legend): subject hollows | mere | reach
//   near_lair  (Z3.1, D > 1) a found voxel within lairR tiles planar and nearDz levels of a lair row: 'lair:<voxel>'
//   (W3.4) in a hold whose realm record with history is loaded (nemesis.js realmRecord), the two pre-history
//              grievance rows become rows of hostile civs: a civ at war with the liege, or whose relation to the
//              hold is below REALM_RAID.hostileRel (-40). Subject 'c<civ>' allows what the Ashfang row allowed
//              (reavers, siege), 'c<civ>t' what the Gutterkin row allowed (thieves, sappers). The legacy row's
//              weight is split among up to REALM_RAID.rows civs (heaviest first) so its sum, and the pacing,
//              stay as they were; a raid incident needs one civ row, and causeFor always names a civ for it.
// Renown leans every weight (colony/renown.js causeLean: Trade x1.5 rumour, Arms x1.25 grievance).
// Both lists are saved story state (plain JSON in s.st), so a load continues them exactly (F25, C13). The
// list is sorted by kind order (data order), then subject.
//
// The storyteller (storyteller.js) asks causeWeight(s, inc) when it weighs a hostile incident (0: not
// eligible) and causeFor(s, inc, nem) when it schedules one: the heaviest allowing row, saved on the queue
// entry as entry.cause = [kind, subject] and entry.why (the letter's cause line, filled now so it never
// changes after the omen). A non-hostile incident needs no cause.

import { DAYS_PER_SEASON, dayOf, seasonOf, yearOf, DAYS_PER_YEAR } from '../core/time.js';
import { DATA } from '../../data/causes.js';
import { DATA as FACTIONS } from '../../data/factions.js';
import { def } from './defs.js';
import { logicOf, isHostile } from './incidents.js';
import { fillText } from './letters.js';
import { fullName, incidentFor, realmRecord, figureName, civLabel } from './nemesis.js';
import { CIVKINDS } from '../../data/realm/civkinds.js';
import { REL } from '../../data/realm/ethics.js';
import { ethicDistance } from '../realm/civs.js';
import { weatherKind } from '../world/weather.js';
import { causeLean } from '../colony/renown.js';
import { prehistoryOf, foundVoxel, legendOf } from '../colony/legends.js';
import { W, H, D, zS, PLANE } from '../core/grid.js';
import { GEN3 } from '../../data/worldgen.js';
import { pristineOf } from '../save/pristine.js';

export const CAUSE_KINDS = Object.freeze(DATA.cause.map((c) => c.id));
const ROW = Object.freeze(Object.fromEntries(DATA.cause.map((c) => [c.id, c])));
const K = Object.freeze({ ...DATA.tuning[0] });
const TEXT = Object.freeze(Object.fromEntries(DATA.text.map((t) => [t.id, t.text])));
const PRECIOUS = new Set(['gems', 'coins', 'art']);
const factionName = (id) => { const f = (FACTIONS.faction || []).find((x) => x.id === id); return f ? f.name : id; };
const kindOrder = (k) => CAUSE_KINDS.indexOf(k);

/** The incidents a cause row allows for a subject (nemesis subjects: the major that nemesis leads). */
export function allowsOf(kind, subject) {
  const r = ROW[kind];
  if (!r) return [];
  if (kind === 'grievance' && typeof subject === 'string' && subject[0] === 'm') return [];
  // W3.4: a civ row allows what the pre-history row of its kind allowed ('c<n>': the Ashfang's, 'c<n>t': the Gutterkin's)
  if (kind === 'grievance' && typeof subject === 'string' && subject[0] === 'c') return [...(r.allows[subject.endsWith('t') ? 'gutterkin' : 'ashfang'] || []), ...(r.allows['*'] || [])];
  return [...(r.allows[subject] || []), ...(r.allows['*'] || [])];
}
/** Every incident id some cause row can allow (data), for the validation test. */
export function causedIncidents() {
  const out = new Set();
  for (const r of DATA.cause) for (const k of Object.keys(r.allows)) for (const id of r.allows[k]) out.add(id);
  return out;
}

// ---- the sources ------------------------------------------------------------------------------------------
/** The worth (tenths of a coin) of the gems, coins and art in the hold now (what a trader sees). */
export function preciousWorth(s) {
  let n = 0;
  for (const it of s.items) {
    if (!it) continue;
    const d = def('item', it.k);
    if (!d || !PRECIOUS.has(d.cat)) continue;
    const m = it.m ? def('material', it.m) : null;
    n += Math.floor((d.value * (it.n | 0) * (m && m.value !== undefined ? m.value : 100)) / 100);
  }
  return n;
}
/** Hourly: note each live trader visit once (its worth seen), and drop notes from earlier years. */
export function noteRumours(s) {
  const st = s.st, tr = s.colony && s.colony.trade;
  if (!Array.isArray(st.rumour)) st.rumour = [];
  const y = yearOf(s.tick);
  if (st.rumour.length && Math.floor(st.rumour[0][0] / DAYS_PER_YEAR) !== y) st.rumour = st.rumour.filter((r) => Math.floor(r[0] / DAYS_PER_YEAR) === y);
  if (!tr || !tr.visits || !tr.visits.length) return;
  let vid = st.rumourVid | 0;
  for (const v of tr.visits) {
    if (v.id <= (st.rumourVid | 0)) continue;
    st.rumour.push([dayOf(s.tick), v.trader, preciousWorth(s)]);
    if (v.id > vid) vid = v.id;
  }
  st.rumourVid = vid;
  if (st.rumour.length > 24) st.rumour.splice(0, st.rumour.length - 24);
}
/** (Z2b) The hold's carrion: raw meat and fish (units) plus carcasses and corpses (carrionBodyN each). */
const CARRION_ITEMS = new Set(['meat', 'fish']), CARRION_BODIES = new Set(['carcass', 'corpse']);
export function carrionOf(s) {
  let n = 0;
  for (const it of s.items) {
    if (!it) continue;
    if (CARRION_ITEMS.has(it.k)) n += it.n | 0;
    else if (CARRION_BODIES.has(it.k)) n += K.carrionBodyN * Math.max(1, it.n | 0);
  }
  return n;
}
/** The Crown vaults (pre-history places) the hold has opened: [{ key, name, voxel }]. */
export function openedVaults(s) {
  if (!s.L || !s.L.fog) return [];
  const out = [];
  for (const p of prehistoryOf(s).places) if (p.kind === 'vault' && foundVoxel(s, p.voxel)) out.push(p);
  return out;
}
/** The pre-history founder of a faction (a figure name), or null. */
function founderOf(s, factionId) {
  const name = factionName(factionId);
  const f = prehistoryOf(s).figures.find((x) => x.kind === 'founder' && x.title === `Founder of the ${name}`);
  return f ? f.name : null;
}
function winterWeight(s) {
  const se = seasonOf(s.tick), ds = dayOf(s.tick) % DAYS_PER_SEASON, half = DAYS_PER_SEASON / 2;
  let w = 0;
  if (se === 3) w = K.winterDeep;
  else if ((se === 2 && ds >= half) || (se === 0 && ds < half)) w = K.winterEdge;
  if (weatherKind(s) === 'coldsnap') w += K.winterSnap;
  return w;
}
const leaned = (s, kind, w) => (w > 0 ? Math.max(1, Math.floor((w * causeLean(s, kind)) / 100)) : 0);

// ---- the deep (Z3.1; D > 1) ------------------------------------------------------------------------------------
const CAVE_NAME = Object.freeze(Object.fromEntries((DATA.cavern || []).map((c) => [c.id, c.name])));
export const DEEP_CAVERNS = Object.freeze(['hollows', 'mere', 'reach']);
/** The levels of each cavern: { hollows: [floor, ledge], mere: [floor, ledge], reach: [floor] } ({} at D = 1). */
export function cavernZs() {
  if (D === 1) return {};
  const out = {};
  for (const id of DEEP_CAVERNS) {
    const C = GEN3.caverns[id];
    const zs = [C.floor, C.ledge].filter((r) => r !== undefined).map((r) => zS + r).filter((z) => z >= 0 && z < D);
    if (zs.length) out[id] = zs;
  }
  return out;
}
/** The cavern whose levels hold z, or null. */
export function cavernAtZ(z) { const c = cavernZs(); for (const id of DEEP_CAVERNS) if (c[id] && c[id].includes(z)) return id; return null; }
const b36 = (n) => (n >>> 0).toString(36);
/** Has the hold opened cavern id (a colonist has stood on one of its levels: the level legend)? */
export function cavernOpened(s, id) { const zs = cavernZs()[id]; return !!zs && zs.some((z) => !!legendOf(s, 'l' + b36(z))); }
/** The opened caverns, in DEEP_CAVERNS order. */
export const openedCaverns = (s) => DEEP_CAVERNS.filter((id) => cavernOpened(s, id));
/** The pristine meta's dormant rows of a kind (or kinds): [[kind, voxel, seed]] in row order. */
export function dormantRows(s, kinds) {
  const p = pristineOf(s), rows = (p && p.meta && p.meta.dormant) || [], ks = Array.isArray(kinds) ? kinds : [kinds];
  return rows.filter((r) => Array.isArray(r) && ks.includes(r[0]));
}
/** Is a found (fog-revealed) voxel within r tiles planar and dz levels of voxel v? */
export function nearFound(s, v, r, dz) {
  const fog = s.L && s.L.fog;
  if (!fog) return false;
  const z0 = (v / PLANE) | 0, p = v - z0 * PLANE, x0 = p % W, y0 = (p / W) | 0;
  for (let z = Math.max(0, z0 - dz); z <= Math.min(D - 1, z0 + dz); z++) {
    for (let y = Math.max(0, y0 - r); y <= Math.min(H - 1, y0 + r); y++) {
      const row = z * PLANE + y * W;
      for (let x = Math.max(0, x0 - r); x <= Math.min(W - 1, x0 + r); x++) { const i = row + x; if ((fog[i >> 3] >> (i & 7)) & 1) return true; }
    }
  }
  return false;
}
/** The woken seeps (seep rows near a found voxel), in row order: [voxel]. */
export const wokenSeeps = (s) => (D === 1 ? [] : dormantRows(s, 'seep').filter((r) => nearFound(s, r[1], K.seepR, K.nearDz)).map((r) => r[1]));
/** The seeps a breach may use: the woken ones, else (the Hold rank) every seep row. */
export function breachSeeps(s) {
  const w = wokenSeeps(s);
  return w.length ? w : (s.colony.tier | 0) >= 3 ? dormantRows(s, 'seep').map((r) => r[1]) : [];
}
/** The lairs the hold has dug near (lair and lair_colossus rows): [voxel]. */
export const nearLairs = (s) => (D === 1 ? [] : dormantRows(s, ['lair', 'lair_colossus']).filter((r) => nearFound(s, r[1], K.lairR, K.nearDz)).map((r) => r[1]));
/** A cavern's deep passages (passage rows on its levels): [voxel]. */
export function passagesOf(s, cav) { const zs = cavernZs()[cav] || []; return dormantRows(s, 'passage').map((r) => r[1]).filter((v) => zs.includes((v / PLANE) | 0)); }
export const cavernName = (id) => CAVE_NAME[id] || 'the deep';

// ---- the realm (W3.4; EMBERCROWN-WORLD.md 2.7 raids row, G6) ------------------------------------------------
// Pure reads of the realm record (s.rt.realm, immutable) and the hold's s.realm deltas; integers only, no stream.
export const REALM_RAID = Object.freeze({ hostileRel: -40, rows: 3, warScore: 1000, sizeBase: 86, sizePer: 2, sizeMin: 90, sizeMax: 110, leaders: 3 });
const ROLE_OF_KIND = Object.freeze(Object.fromEntries(CIVKINDS.map((k, i) => [i, k.role])));
const KIND_ID = Object.freeze(CIVKINDS.map((k) => k.id));
const AGGR_OF = Object.freeze(CIVKINDS.map((k) => k.aggr | 0));
const FACTION_ROW = Object.freeze(Object.fromEntries((FACTIONS.faction || []).map((f) => [f.id, f])));
const GRIEF = (DATA.cause.find((c) => c.id === 'grievance') || { allows: {} }).allows;
/** The incidents raiders of a people bring (the pre-history grievance rows' lists): every one needs a civ in a realm hold. */
export const RAID_INCIDENTS = Object.freeze([...new Set([...(GRIEF.ashfang || []), ...(GRIEF.gutterkin || [])])]);
const isRaidInc = (d) => !!d && RAID_INCIDENTS.includes(d.id);
const kindIdx = (c) => (typeof c.kind === 'number' ? c.kind : KIND_ID.indexOf(c.kind));
/** Is this cause row a civ's ('grievance', 'c<civ>' or 'c<civ>t')? */
export const isCivCause = (c) => !!c && c[0] === 'grievance' && typeof c[1] === 'string' && c[1][0] === 'c';
/** The civ id of a civ cause subject, or null. */
export const civOfCause = (c) => (isCivCause(c) ? parseInt(c[1].slice(1), 10) : null);
const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

/** The sites now: the record's rows with the hold's s.realm.sites deltas ([site, owner, size, year]; owner < 0 or null: razed). */
export function realmSites(s, R) {
  const out = R.tables.sites.map((x) => ({ id: x.id, x: x.x, y: x.y, civ: x.razed === null ? x.civ : null, size: x.size | 0 }));
  for (const d of (s.realm && s.realm.sites) || []) {
    if (!Array.isArray(d) || !out[d[0]]) continue;
    const o = out[d[0]];
    o.civ = Number.isInteger(d[1]) && d[1] >= 0 ? d[1] : null;
    if (Number.isInteger(d[2])) o.size = d[2];
  }
  return out;
}
/** The wars going on now: the record's open wars with the s.realm.wars deltas ([a, b, began, ended] or { a, b, began, ended }). */
export function realmWars(s, R) {
  const m = new Map();
  const put = (a, b, began, ended) => { if (Number.isInteger(a) && Number.isInteger(b)) m.set(`${Math.min(a, b)}:${Math.max(a, b)}:${began | 0}`, { a, b, ended: ended === undefined ? null : ended }); };
  for (const w of R.tables.wars || []) put(w.a, w.b, w.began, w.ended);
  for (const d of (s.realm && s.realm.wars) || []) { if (Array.isArray(d)) put(d[0], d[1], d[2], d[3]); else if (d && typeof d === 'object') put(d.a, d.b, d.began, d.ended); }
  return [...m.values()].filter((w) => w.ended === null);
}
const liveCiv = (R, sites, id) => { const c = R.tables.civs[id]; return !!c && c.fell === null && sites.some((x) => x.civ === id); };
/** Squared-free distance (Chebyshev) from the hold to civ id's nearest living site, and that site: { d, site } or null. */
export function nearestSite(s, R, id, sites = realmSites(s, R)) {
  let best = null;
  for (const x of sites) {
    if (x.civ !== id) continue;
    const d = cheb(x.x, x.y, s.realm.rx, s.realm.ry);
    if (!best || d < best.d || (d === best.d && x.id < best.site.id)) best = { d, site: x };
  }
  return best;
}
/** The civ that fills a faction role: s.realm.bind[role], else the nearest living civ of a kind with that role (ties by id). */
export function roleCiv(s, R, role, sites = realmSites(s, R)) {
  const b = s.realm.bind && s.realm.bind[role];
  if (Number.isInteger(b) && R.tables.civs[b]) return b;
  let best = null, bd = 0;
  for (const c of R.tables.civs) {
    if (ROLE_OF_KIND[kindIdx(c)] !== role || !liveCiv(R, sites, c.id)) continue;
    const n = nearestSite(s, R, c.id, sites);
    if (n && (best === null || n.d < bd)) { best = c.id; bd = n.d; }
  }
  // a hostile-born role (the raiders') with no civ of its kind left: the most warlike living civ but the liege (the
  // widest ethics from it, then the nearest, then the lowest id); W3.3a's binding (s.realm.bind) replaces this
  const f = FACTION_ROW[role];
  if (best === null && f && !f.goodwill && (f.start | 0) < REALM_RAID.hostileRel) {
    const L = liegeOf(s, R, sites), lc = L !== null ? R.tables.civs[L] : null;
    let key = null;
    for (const c of R.tables.civs) {
      if (c.id === L || !liveCiv(R, sites, c.id)) continue;
      const n = nearestSite(s, R, c.id, sites), k = [AGGR_OF[kindIdx(c)] | 0, lc && lc.eth && c.eth ? ethicDistance(c.eth, lc.eth) : 0, -n.d];
      if (key === null || k[0] > key[0] || (k[0] === key[0] && (k[1] > key[1] || (k[1] === key[1] && k[2] > key[2])))) { key = k; best = c.id; }
    }
  }
  return best;
}
/** The hold's liege: s.realm.civ, else the civ filling the Hearthwatch role. */
export const liegeOf = (s, R, sites = realmSites(s, R)) => (Number.isInteger(s.realm.civ) ? s.realm.civ : roleCiv(s, R, 'hearthwatch', sites));
/** Every faction role's civ now: { role: civ id | null }. */
export function roleMap(s, R, sites = realmSites(s, R)) { const m = {}; for (const f of FACTIONS.faction || []) m[f.id] = roleCiv(s, R, f.id, sites); return m; }
/** The hold's relation to civ id: a bound role's goodwill (a role without goodwill: its start), a `c<n>` standing, else the
 *  2.3 relation of that civ to the liege (base - perDist x ethic distance). */
export function holdRel(s, R, id, sites = realmSites(s, R), roles_ = roleMap(s, R, sites)) {
  const roles = Object.keys(roles_).filter((k) => roles_[k] === id);
  if (roles.length) {
    let r = Infinity;
    for (const k of roles) { const f = FACTION_ROW[k]; const g = f && f.goodwill ? (s.colony.factions && s.colony.factions[k]) | 0 : f ? f.start | 0 : 0; if (g < r) r = g; }
    return r;
  }
  const row = Array.isArray(s.realm.stand) ? s.realm.stand.find((x) => Array.isArray(x) && x[0] === id) : null;
  if (row) return row[1] | 0;
  const cf = s.colony.factions && s.colony.factions['c' + id];
  if (typeof cf === 'number') return cf | 0;
  const L = liegeOf(s, R, sites), lc = L !== null ? R.tables.civs[L] : null, c = R.tables.civs[id];
  return lc && c && lc.eth && c.eth ? REL.base - REL.perDist * ethicDistance(c.eth, lc.eth) : 0;
}
/** The civs that may raid the hold now, heaviest first: [{ id, war, rel, kind }] (at war with the liege, or rel < -40). */
export function hostileCivs(s, R = realmRecord(s)) {
  if (!R) return [];
  const sites = realmSites(s, R), L = liegeOf(s, R, sites), wars = realmWars(s, R), roles = roleMap(s, R, sites), out = [];
  for (const c of R.tables.civs) {
    if (c.id === L || !liveCiv(R, sites, c.id)) continue;
    const war = L !== null && wars.some((w) => (w.a === c.id && w.b === L) || (w.b === c.id && w.a === L));
    const rel = holdRel(s, R, c.id, sites, roles);
    if (war || rel < REALM_RAID.hostileRel) out.push({ id: c.id, war, rel, kind: KIND_ID[kindIdx(c)] });
  }
  const score = (h) => (h.war ? REALM_RAID.warScore : 0) - h.rel;
  out.sort((a, b) => score(b) - score(a) || a.id - b.id);
  return out;
}
/** The card side of the hold the civ lives on (toward its nearest living site; the embark raid edges break ties and veto
 *  a closed side), or null when it lives in the hold's own region. */
export function civSide(s, R, id) { const c = civSides(s, R, id); return c.length ? c[0] : null; }
/** The sides a civ's raiders may enter by, best first: the side toward it (an open embark edge), then the other
 *  component of a diagonal ([] when it lives in the hold's own region). */
export function civSides(s, R, id) {
  const n = nearestSite(s, R, id);
  if (!n) return [];
  const dx = n.site.x - s.realm.rx, dy = n.site.y - s.realm.ry;
  if (!dx && !dy) return [];
  const ew = dx > 0 ? 'e' : 'w', ns = dy > 0 ? 's' : 'n';
  const open = (k) => { const e = s.realm.embark && s.realm.embark.edges && s.realm.embark.edges.raid; return !e || e[k] === undefined || e[k] > 0; };
  const first = Math.abs(dx) >= Math.abs(dy) ? [ew, ns] : [ns, ew];
  const cand = first.filter((k, i) => (i === 0 || (dx && dy)));
  return [...cand.filter(open), ...cand.filter((k) => !open(k))];
}
const ROLE_RANK = Object.freeze({ hero: 0, outlaw: 1, envoy: 3, ruler: 9 });
/** The living world figures who may lead the civ's raiders, best first (hero, outlaw, then the rest; the ruler last; more
 *  deeds, more renown, lower id). A figure dead after embark (s.realm.dead, a 32-bit bitset) is skipped. */
export function raidLeaders(s, R, id) {
  const year = s.realm.year | 0, dead = s.realm.dead || [];
  const gone = (f) => f.died !== null || ((dead[f.id >> 5] | 0) >>> (f.id & 31)) & 1;
  const fs = (R.tables.figures || []).filter((f) => f && f.civ === id && !gone(f) && year - f.born >= 16);
  const rank = (f) => (ROLE_RANK[f.role] !== undefined ? ROLE_RANK[f.role] : 2);
  fs.sort((a, b) => rank(a) - rank(b) || (b.deeds || []).length - (a.deeds || []).length || (b.ren | 0) - (a.ren | 0) || a.id - b.id);
  return fs.slice(0, REALM_RAID.leaders);
}
/** The leader of a civ's raid now (k: the entry id, rotating among the best few), or null. */
export function raidLeader(s, R, id, k = 0) { const fs = raidLeaders(s, R, id); return fs.length ? fs[(k >>> 0) % fs.length] : null; }
/** The raid size percent for a civ: sizeBase + sizePer x its living sites, clamped to [sizeMin, sizeMax]. */
export function civSizePct(s, R, id) {
  const n = realmSites(s, R).filter((x) => x.civ === id).length;
  return Math.max(REALM_RAID.sizeMin, Math.min(REALM_RAID.sizeMax, REALM_RAID.sizeBase + REALM_RAID.sizePer * n));
}
/** Split a leaned weight w among the hostile civs (up to REALM_RAID.rows, the first strictly heaviest): the sum stays w. */
function civRows(out, civs, w, tag) {
  if (w <= 0 || !civs.length) return;
  const k = Math.min(civs.length, w > 1 ? w - 1 : 1, REALM_RAID.rows), each = Math.floor(w / k);   // the first civ is always the heaviest
  for (let i = 0; i < k; i++) out.push(['grievance', `c${civs[i].id}${tag}`, each + (i === 0 ? w - each * k : 0)]);
}

/** The live causes now (pure in s): [[kind, subject, weight]], sorted by kind order then subject. */
export function computeCauses(s) {
  const out = [];
  const add = (kind, subject, w) => { const v = leaned(s, kind, w); if (v > 0) out.push([kind, subject, v]); };
  // grievance: the pre-history, opened vaults, the Gutterkin's goodwill, nemeses
  const g = (s.colony && s.colony.factions && s.colony.factions.gutterkin) | 0;
  const R = realmRecord(s);
  if (R) {
    // W3.4: the same weights, carried by the civs that hate the hold or war on its liege (the raiders' own kinds first)
    const hc = hostileCivs(s, R), band = hc.filter((h) => h.kind === 'band'), arms = hc.filter((h) => h.kind !== 'band');
    civRows(out, arms.length ? arms : hc, leaned(s, 'grievance', K.ashfangBase + K.vaultW * openedVaults(s).length), '');
    if (g <= K.gutterkinFrom) civRows(out, band.length ? band : hc, leaned(s, 'grievance', K.gutterkinBase + Math.floor((K.gutterkinFrom - g) / K.gutterkinStep)), 't');
  } else {
    add('grievance', 'ashfang', K.ashfangBase + K.vaultW * openedVaults(s).length);
    if (g <= K.gutterkinFrom) add('grievance', 'gutterkin', K.gutterkinBase + Math.floor((K.gutterkinFrom - g) / K.gutterkinStep));
  }
  for (const n of (s.st && s.st.nemeses) || []) add('grievance', 'm' + n.id, K.nemesisW);
  // rumour: this year's trader visits, per trader
  const per = new Map();
  for (const [, t, worth] of (s.st && s.st.rumour) || []) per.set(t, (per.get(t) | 0) + K.rumourBase + Math.min(K.rumourMax, Math.floor(worth / K.rumourWorth)));
  for (const [t, w] of per) add('rumour', t, w);
  // the Hollow's hunger: always, from the first night
  add('hunger', 'hollow', K.hungerBase + ((s.colony && s.colony.hearth && s.colony.hearth.lvl) | 0));
  // hard winter
  add('winter', ['thaw', 'highsun', 'ashfall', 'deepcold'][seasonOf(s.tick)], winterWeight(s));
  // the scent of carrion (Z2b): beasts at the edges any time of year, once the camp has had its first season and a
  // half (carrionFromDay: a three-colonist camp butchering its first deer is not yet a lure)
  const cn = carrionOf(s);
  if (dayOf(s.tick) >= K.carrionFromDay && cn >= K.carrionMin) add('carrion', 'carrion', Math.min(K.carrionMax, 1 + Math.floor((cn - K.carrionMin) / K.carrionStep)));
  // a woken seep (Z3.1 at D > 1: near a seep row, or the Hold rank)
  if (D > 1) { if (breachSeeps(s).length) add('seep', 'seep', K.seepW); }
  else { const br = logicOf('deep_breach'); if (br && br.requires && br.requires(s)) add('seep', 'seep', K.seepW); }
  // (Z3.1) opened caverns and lairs dug near
  if (D > 1) {
    for (const id of openedCaverns(s)) add('opened_cavern', id, K.cavernW);
    for (const v of nearLairs(s)) add('near_lair', 'lair:' + v, K.lairW);
  }
  out.sort((a, b) => kindOrder(a[0]) - kindOrder(b[0]) || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  return out;
}
/** The day's cause list (recomputed once per game day; saved in s.st). */
export function liveCauses(s) {
  const st = s.st, day = dayOf(s.tick);
  if (st.causesDay !== day || !Array.isArray(st.causes)) { st.causes = computeCauses(s); st.causesDay = day; }
  return st.causes;
}
/** Hourly (storyteller): note trader visits; refresh the list on a new day. */
export function causesHour(s) { noteRumours(s); liveCauses(s); }

// ---- what the storyteller asks ------------------------------------------------------------------------------
const nemOf = (s, key) => { const id = +key.slice(1); return ((s.st && s.st.nemeses) || []).find((n) => n.id === id) || null; };
/** The rows that allow incident d now (nemesis rows allow only the major that nemesis leads, when nem is it). */
export function allowingCauses(s, d, nem = null) {
  const out = [];
  for (const c of liveCauses(s)) {
    if (c[0] === 'grievance' && c[1][0] === 'm') { if (nem && c[1] === 'm' + nem.id && incidentFor(nem) === d.id) out.push(c); continue; }
    if (allowsOf(c[0], c[1]).includes(d.id)) out.push(c);
  }
  return out;
}
/** Does this incident need a live cause? Every hostile one does (F26). */
export const needsCause = (d) => isHostile(d);
/** Summed weight of the causes allowing d (0: none). A non-hostile incident: 1. */
export function causeWeight(s, d, nem = null) {
  if (!needsCause(d)) return 1;
  if (isRaidInc(d) && realmRecord(s) && !liveCauses(s).some(isCivCause)) return 0;   // W3.4: no civ, no raid
  let w = 0;
  for (const c of allowingCauses(s, d, nem)) w += c[2];
  return w;
}
/** The incident's pick weight with its causes: weight x clamp(sum, 1, max) / ref (at least 1 when caused). */
export function causedWeight(s, d) {
  const base = d.weight | 0;
  if (!needsCause(d) || base <= 0) return base;
  const w = causeWeight(s, d);
  if (w <= 0) return 0;
  return Math.max(1, Math.floor((base * Math.min(K.weightMax, w)) / K.weightRef));
}
/** The cause a scheduled incident names: the heaviest allowing row (ties: list order), or null. */
export function causeFor(s, d, nem = null) {
  let best = null;
  if (isRaidInc(d) && realmRecord(s)) {
    // W3.4: a raid always names its civ: the heaviest civ row allowing it, else the heaviest civ row (rumour-drawn raiders)
    const live = liveCauses(s).filter(isCivCause);
    for (const c of allowingCauses(s, d, nem)) if (isCivCause(c) && (!best || c[2] > best[2])) best = c;
    if (!best) for (const c of live) if (!best || c[2] > best[2]) best = c;
    return best ? [best[0], best[1]] : null;
  }
  for (const c of allowingCauses(s, d, nem)) if (!best || c[2] > best[2]) best = c;
  return best ? [best[0], best[1]] : null;
}

/** The letter line for a cause [kind, subject] now. */
export function causeLine(s, cause) {
  if (!cause) return '';
  const [kind, subject] = cause;
  const t = (id, vars = {}) => fillText(TEXT[id] || '', vars);
  if (kind === 'grievance') {
    if (subject[0] === 'm') {
      const n = nemOf(s, subject);
      const c = n && n.grudge !== null && n.grudge !== undefined ? s.col.find((x) => x && x.id === n.grudge) : null;
      return t('cause_grievance_nemesis', { nemesis: n ? fullName(n) : 'An old enemy', target: c ? c.name : 'the hold' });
    }
    if (subject[0] === 'c') return civLine(s, subject);
    if (subject === 'gutterkin') return t('cause_grievance_gutterkin');
    const v = openedVaults(s);
    if (v.length) return t('cause_grievance_vault', { faction: factionName(subject), vault: v[v.length - 1].name });
    return t('cause_grievance_ashfang', { faction: factionName(subject), founder: founderOf(s, subject) || 'their founders' });
  }
  if (kind === 'rumour') { const d = def('trader', subject); return t('cause_rumour', { trader: d && d.name ? d.name.toLowerCase() : 'traders' }); }
  if (kind === 'hunger') return t((s.colony && s.colony.hearth && s.colony.hearth.lvl | 0) >= 3 ? 'cause_hunger_bright' : 'cause_hunger');
  if (kind === 'winter') return t(weatherKind(s) === 'coldsnap' ? 'cause_winter_snap' : 'cause_winter');
  if (kind === 'seep') return t('cause_seep');
  if (kind === 'carrion') return t('cause_carrion');
  if (kind === 'opened_cavern') return t('cause_cavern', { cavern: cavernName(subject) });
  if (kind === 'near_lair') return t('cause_lair');
  const r = ROW[kind];
  return r ? t(r.line) : '';
}
/** (W3.4) The letter line of a civ cause: the civ, its leader and why (a war on the liege, or its hatred of the hold). */
const CIV_TEXT = Object.freeze({
  cause_grievance_war: '{leader} leads {civ} against the hold, for they are at war with {liege}, whom the hold serves.',
  cause_grievance_civ: '{leader} of {civ} has sworn to humble the hold, and their people answer the call.',
  cause_grievance_civ_thieves: '{leader} comes for the hold\'s stores with the cutpurses of {civ}.',
  cause_grievance_civ_lost: 'Raiders come from the wider world, but word of who sent them is lost.',
});
function civLine(s, subject) {
  const t = (id, vars = {}) => fillText(TEXT[id] || CIV_TEXT[id], vars);
  const R = realmRecord(s), id = parseInt(subject.slice(1), 10), c = R ? R.tables.civs[id] : null;
  if (!c) return t('cause_grievance_civ_lost');
  const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
  const lf = raidLeader(s, R, id), leader = lf ? figureName(lf) : 'A war chief';
  const sites = realmSites(s, R), L = liegeOf(s, R, sites), war = L !== null && realmWars(s, R).some((w) => (w.a === id && w.b === L) || (w.b === id && w.a === L));
  if (subject.endsWith('t')) return cap(t('cause_grievance_civ_thieves', { civ: civLabel(c), leader }));   // (cap: a missing leader's fallback)
  if (war) return t('cause_grievance_war', { civ: civLabel(c), leader, liege: civLabel(R.tables.civs[L]) });
  return t('cause_grievance_civ', { civ: civLabel(c), leader });
}
/** Append a cause line to a letter text (one space between; no line when there is no cause). */
export const withCause = (text, why) => (why ? `${text} ${why}` : text);
/** For tests: the weights' tuning row. */
export const CAUSE_TUNING = K;
