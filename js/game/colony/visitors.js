// Taverns, temples and libraries, and the visitors they draw (EMBERCROWN-FORTRESS.md 3.13; step Z2.8). Owner K.
// Data: js/data/rooms.js HALLS (what makes a hall), js/data/visitors.js (VISITOR_KINDS, VISITS, POWERS, words).
//
// Saved state (plain JSON on the colony record; created lazily by ensureVisits on the first daily step, the same
// tick in an uninterrupted run and in a loaded one, so old saves load with none and continue):
//   s.colony.visitors   [Visitor] by id (C2 v3 `visitors`). Visitor = { id, kind, hall, at, name, plain, day, leave,
//                       entry: 'edge'|'passage', asked: letterId | -1 | -2 (refused), book, paid }
//                       id is a colonist id reserved at arrival (generateColonist), so a petitioner keeps it and
//                       the Annals' visitor record 'v<id>' never names another colonist; plain is the colonist in
//                       toPlain form; at is the hall room's first voxel.
//   s.colony.visitRec   { v: 1, halls: [[hallId, firstVoxel]] (the day's halls, room order), came, accepted, left,
//                       books }
//   (A: please add `visitors: []`, `visitRec: null` to schema.newColonyRecord().)
//
// Rules (3.13):
//   - halls (hallsOf, daily): see rooms.js HALLS. A temple's altar is raised to one of the vale's POWERS
//     (altarPower, from the seed and the altar's id).
//   - arrivals (daily at VISITS.hour): each hall draws a visitor with arrivePermille (hash3 of the seed, the day
//     and the hall's place in the list) while fewer than maxVisitors stay and fewer than maxPerHall at that hall.
//     The kind is weighted by VISITOR_KINDS weight, x knownWeight when the hold is known for its domain (renown);
//     the deep-trader comes only once Cavern II is open. They come by the vale road, or (passagePct, once Cavern
//     II is open) up the Lamplost passage. They stay stayDays, pay coins each day at the hall, and leave a
//     Chronicle line coming and going. A tavern visitor drinks drinkPerDay from the hold's stock (none left: they
//     go). A scholar writes a book (an item named for a legend record) on scholarBookDay and teaches the first
//     "discovered when a visiting scholar teaches it" tech the hold lacks (Z2.4 discovery).
//   - colonists in a hall take its joy each hour: "Revelry in the tavern", "Prayed at the altar", "Read in the
//     library".
//   - petitions: a visitor on day petitionDays of their stay (with petitionPct, hash3 of the seed and their id) whose
//     skills match the hold's renown (their kind's or
//     their best skill's domain is one the hold is known for; before the hold is known for anything, its leading
//     domain) asks to stay: a choice letter (k 'petition', default "Not now" after petitionHours). Yes (the letter
//     or the `petition { visitorId, accept }` command): they become a colonist at the hall with their history, an
//     Annals colonist record linked to their visitor record, and a 'petition' event. Never past the hard cap
//     (family.headCount, children at one half).
//
// Determinism: rolls are hash3 of the seed, the day and ids; generateColonist (streams 'main', 'names') draws only
// when a visitor arrives. No rt key is added.
//
// W3.3b (EMBERCROWN-WORLD.md 2.7 visitors row): in a hold with its realm record (factions.js realmRec) a visitor of a
// kind with REALM_VISIT.roles is a living world figure when one fits (worldVisitors: that role, grown and alive in the
// realm, of a living civ not at war with the liege, whose home lies within REALM_VISIT.reach travel days, not already
// in the hold; picked by hash3 of the seed, the day and the count of comers). The colonist reserved for them takes the
// figure's name and people; the visitor carries fig and civ, its legend record links 'wf<id>'. Their errands:
//   - a bard sings a world tale (taleOf: a war, a fall or a slaying of the bard's civ, else of the world) on day
//     REALM_VISIT.taleDay of the stay: a letter, and the 'world_tale' thought for those in the hall that day;
//   - a hero (a mercenary) who comes while a world beast with a history entry is alive within reach is a monster
//     hunter on its trail (v.hunt, a letter);
//   - a scholar charts a lost artifact (the nearest not yet charted) on the World map on the day they write
//     (visitRec.marks, created on the first chart; worldMarks(s) for the map);
//   - one who stays links their colonist record to the figure (visitRec.joined, created on the first).
// The envoys of the liege ride with its Lord and tribute (offices.js envoyOf); a neighbour's demands are W4.5. With no
// record the legacy visitor comes, draw for draw.
//
// Hooks into other owners' code (requests in the Z2.8 report):
//   colony/index.js (K)  reg('colony', 'visitors', visitorsSystem, 137) and installVisitors() under `verbs`
//   commands.js (A)      `petition { visitorId: int, accept: bool }`; installVisitors registers the applier
//   render (C/D)         visitorsOf(s): draw each at tile `at` with the colonist sprite from `plain.look`
//   ui (I)               the hall list (hallsView) on the Colony > Hold screen; petition letters render as any
//                        choice letter

import { TICKS_PER_HOUR, TICKS_PER_DAY, dayOf } from '../core/time.js';
import { W, PLANE, idx } from '../core/grid.js';
import { toPlain, fromPlain } from '../core/schema.js';
import { COMMANDS, registerApplier } from '../core/commands.js';
import { def } from './defs.js';
import { roomInfo, roomById } from '../world/rooms.js';
import { cavernLevels } from '../world/plants.js';
import { spawn, consume, forEachItem } from '../work/items.js';
import { addChron } from './chronicle.js';
import { addLegend, legendEvent, legendOf, prehistoryOf } from './legends.js';
import { knownFor, renownLines } from './renown.js';
import { discoveredByScholar } from './verbs/discovery.js';
import { generateColonist, spawnColonist } from '../people/colonists.js';
import { addThought } from '../people/mood.js';
import { hash3 } from '../people/peoplerec.js';
import { bestSkill } from '../people/skills.js';
import { headCount } from '../people/family.js';
import { sendLetter, onChoice, answer, fillText } from '../threat/letters.js';
import { CAPS } from '../../data/balance.js';
import { HALLS } from '../../data/rooms.js';
import { VISITOR_KINDS, VISITS, POWERS, SKILL_DOMAIN, WORDS } from '../../data/visitors.js';
import { realmRec } from './factions.js';
import { travelField, atWarWithLiege } from './caravans.js';
import { figGrown, figsInHold } from './offices.js';
import { figureName, civText, artifactName, artifactDesc, yearText } from '../../data/text/realm.js';

export { HALLS, VISITOR_KINDS };
const V = VISITS;
const TIER_ORDER = ['squalid', 'plain', 'decent', 'fine', 'grand', 'majestic'];
const kindDef = (id) => VISITOR_KINDS.find((k) => k.id === id) || null;
const hallDef = (id) => HALLS.find((h) => h.id === id) || null;
const b36 = (n) => (n >>> 0).toString(36);
const seedOf = (s) => (s.seed >>> 0) || 1;
const JOY = Object.freeze({ tavern: 'revelry', temple: 'prayed', library: 'read_quietly' });

// ---- the record ------------------------------------------------------------------------------------------------
const newRec = () => ({ v: 1, halls: [], came: 0, accepted: 0, left: 0, books: 0 });
const EMPTY = Object.freeze(newRec());
export const visitRec = (s) => (s && s.colony && s.colony.visitRec) || EMPTY;
export const visitorsOf = (s) => (s && s.colony && Array.isArray(s.colony.visitors) ? s.colony.visitors : []);
export const visitorById = (s, id) => visitorsOf(s).find((v) => v.id === id) || null;
export function ensureVisits(s) {
  const c = s.colony;
  if (!Array.isArray(c.visitors)) c.visitors = [];
  if (!c.visitRec || typeof c.visitRec !== 'object') c.visitRec = newRec();
  const r = c.visitRec, e = newRec();
  for (const k of Object.keys(e)) if (!(k in r)) r[k] = e[k];
  return r;
}

// ---- halls -----------------------------------------------------------------------------------------------------
const known = (ids) => ids.filter((id) => def('structure', id));
function drinkStock(s) {
  let n = 0;
  const st = (s.rt && s.rt.stock) || {};
  for (const k of Object.keys(st)) { const d = def('item', k); if (d && d.food && d.food.kind === 'drink') n += st[k]; }
  return n;
}
/** Books on shelf tiles in room `id` (rooms.js HALLS library rule). */
export function shelvedBooks(s, id, h = hallDef('library')) {
  const rec = roomById(s, id);
  if (!rec) return 0;
  const shelves = new Set(known(h.shelves || [])), kinds = new Set(h.bookKinds || []);
  let n = 0;
  forEachItem(s, (it) => {
    if (!kinds.has(it.k)) return;
    const i = idx(it.x, it.y, it.z | 0);
    if (s.rt.room[i] !== id) return;
    const o = s.rt.occ[i], b = o >= 0 ? s.bld[o] : null;
    if (b && b.st === 'done' && shelves.has(b.def)) n += it.n;
  });
  return n;
}
/** Does room info `info` make hall `h`? Returns null when it does, else the first unmet need (a word). */
export function hallNeed(s, h, info, drink = drinkStock(s)) {
  if (h.roles && !h.roles.includes(info.role)) return 'role';
  if (h.notRoles && h.notRoles.includes(info.role)) return 'role';
  if (info.tierIdx < TIER_ORDER.indexOf(h.minTier || 'squalid')) return 'tier';
  const defs = new Set(info.contents.map((bid) => { const b = s.bld[bid]; return b ? b.def : null; }));
  for (const g of h.has || []) if (!known(g).some((d) => defs.has(d))) return g[0];
  if (h.drink && drink < h.drink) return 'drink';
  if (h.books && shelvedBooks(s, info.id, h) < h.books) return 'books';
  return null;
}
/** The hold's halls today: [{ id, name, room, first, tier }] in room order (one hall per room, HALLS order). */
export function hallsOf(s) {
  const out = [];
  if (!s.rt || !s.rt.rooms) return out;
  const drink = drinkStock(s);
  for (const rec of s.rt.rooms) {
    if (!rec) continue;
    const info = roomInfo(s, rec.id);
    if (!info) continue;
    for (const h of HALLS) if (!hallNeed(s, h, info, drink)) { out.push({ id: h.id, name: h.name, room: rec.id, first: rec.first, tier: info.tier }); break; }
  }
  return out;
}
/** The power an altar (shrine, temple or altar building) is raised to: from the seed and its id. */
export const altarPower = (s, bldId) => POWERS[hash3(seedOf(s), bldId | 0, 0xa17a) % POWERS.length];
/** What the Hold screen shows (pure): every hall kind, whether the hold has one, and the visitors there. */
export function hallsView(s) {
  const halls = hallsOf(s), vs = visitorsOf(s);
  return HALLS.map((h) => {
    const mine = halls.filter((x) => x.id === h.id);
    return { id: h.id, name: h.name, count: mine.length, visitors: vs.filter((v) => v.hall === h.id).map((v) => ({ id: v.id, name: v.name, kind: (kindDef(v.kind) || {}).name || v.kind, days: dayOf(s.tick) - v.day })) };
  });
}

// ---- renown and the deep --------------------------------------------------------------------------------------
/** Domains a petitioner must match: the known ones, else the leading domain with points. */
export function petitionDomains(s) {
  const k = knownFor(s);
  if (k.length) return k;
  let best = null;
  for (const [id, , pts] of renownLines(s)) if (pts > 0 && (!best || pts > best[1])) best = [id, pts];
  return best ? [best[0]] : [];
}
export function cavern2Open(s) {
  const zs = cavernLevels().mere || [];
  return zs.some((z) => !!legendOf(s, 'l' + b36(z)));
}
function pickKind(s, hall, u32) {
  const known = knownFor(s), deep = cavern2Open(s);
  const list = VISITOR_KINDS.filter((k) => k.hall === hall && (!k.passage || deep));
  if (!list.length) return null;
  const w = list.map((k) => k.weight * (known.includes(k.domain) ? V.knownWeight : 1));
  let x = u32 % w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < list.length; i++) { if (x < w[i]) return list[i]; x -= w[i]; }
  return list[0];
}
const tileOf = (v) => [v % W, ((v % PLANE) / W) | 0, (v / PLANE) | 0];

// ---- world figures (W3.3b) -------------------------------------------------------------------------------------
/** Realm visitors: reach (travel days); roles: the figure roles a visitor kind is drawn from; taleDay: the day of the
 *  stay a bard sings; thought: the hearers' thought (a data row; none: no thought). */
export const REALM_VISIT = Object.freeze({
  reach: 12, taleDay: 1, thought: 'world_tale',
  roles: Object.freeze({ traveller: ['envoy', 'hero', 'bard', 'smith', 'scholar', 'priest'], bard: ['bard'], mercenary: ['hero'], pilgrim: ['priest'], priest: ['priest'], scholar: ['scholar'], smith: ['smith'] }),
});
/** The realm words of the visitors (original wording; a request moves them into js/data/visitors.js WORDS). */
export const REALM_WORDS = Object.freeze({
  of: '{kind} of {civ}',
  taleTitle: 'A song of the world',
  taleText: '{name} sang the song of {tale} in the {hall}.',
  huntTitle: 'A monster hunter',
  huntText: '{name}, a hero of {civ}, has come to the {hall} on the trail of {beast}, whose lair lies {days} days from the hold.',
  markTitle: 'A lost thing charted',
  markText: '{name}, a scholar of {civ}, has marked on your World map where {art}, {desc}, was last known, in {year}.',
});
const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
/** Where a figure lives: its home site, else its civ's capital (a site row), or null. */
function homeOf(R, f) {
  const S = R.tables.sites || [], c = R.tables.civs[f.civ];
  return S[f.home] || (c ? S[c.cap] : null) || null;
}
/**
 * The world figures who may come as a visitor of `kindId` now (pure, id order): REALM_VISIT.roles[kind], grown and
 * alive in the realm, of a living civ not at war with the liege, home within REALM_VISIT.reach travel days, not in
 * the hold. [] with no record or for a kind with no roles.
 */
export function worldVisitors(s, kindId, R = realmRec(s)) {
  const roles = REALM_VISIT.roles[kindId];
  if (!R || !roles || !s.realm) return [];
  const tf = travelField(R, s.realm.rx, s.realm.ry, REALM_VISIT.reach), busy = figsInHold(s), war = new Map(), out = [];
  for (const f of R.tables.figures || []) {
    if (!f || !roles.includes(f.role) || busy.has(f.id) || !figGrown(s, f)) continue;
    const c = R.tables.civs[f.civ];
    if (!c || c.fell !== null) continue;
    if (!war.has(f.civ)) war.set(f.civ, atWarWithLiege(s, R, f.civ));
    if (war.get(f.civ)) continue;
    const h = homeOf(R, f);
    if (!h || !(tf[h.y * R.n + h.x] <= REALM_VISIT.reach)) continue;
    out.push(f);
  }
  return out;
}
/** The world figure of a visitor (or a visitor id), or null. */
export function visitorFigure(s, v, R = realmRec(s)) {
  const x = typeof v === 'number' ? visitorById(s, v) : v;
  return R && x && Number.isInteger(x.fig) ? R.tables.figures[x.fig] || null : null;
}
/** The tale a bard of civ `civ` sings (pure): a war, a fall or a slaying of that civ, else of the world; { title, year } or null. */
export function taleOf(s, R, civ, h) {
  const C = R.tables.civs, tales = [], all = [];
  const put = (mine, t) => { all.push(t); if (mine) tales.push(t); };
  for (const w of R.tables.wars || []) if (C[w.a] && C[w.b]) put(w.a === civ || w.b === civ, { title: `the war between ${civText(C[w.a])} and ${civText(C[w.b])}`, year: w.began });
  for (const x of R.tables.sites || []) if (x && x.razed !== null && x.razed !== undefined && x.name) put(x.by === civ, { title: `the fall of ${x.name}`, year: x.razed });
  for (const b of R.tables.beasts || []) if (b && b.slain !== null && b.slain !== undefined && b.name) { const k = R.tables.figures[b.by]; put(!!k && k.civ === civ, { title: `the slaying of ${b.name}`, year: b.slain }); }
  const list = tales.length ? tales : all;
  return list.length ? list[(h >>> 0) % list.length] : null;
}
/** The nearest living world beast within reach of the hold (travel days, then id): { beast, days } or null. */
export function huntedBeast(s, R = realmRec(s)) {
  if (!R || !s.realm) return null;
  const tf = travelField(R, s.realm.rx, s.realm.ry, REALM_VISIT.reach);
  let best = null;
  for (const b of R.tables.beasts || []) {
    if (!b || !b.alive) continue;
    const d = tf[b.y * R.n + b.x];
    if (!(d <= REALM_VISIT.reach)) continue;
    if (!best || d < best.days || (d === best.days && b.id < best.beast.id)) best = { beast: b, days: d };
  }
  return best;
}
/** The lost artifacts charted on the World map (2.7 cartographer): [{ art, key, x, y, name, year }] in chart order. */
export function worldMarks(s, R = realmRec(s)) {
  const ids = (s.colony && s.colony.visitRec && s.colony.visitRec.marks) || [];
  if (!R) return [];
  return ids.map((id) => R.tables.artifacts[id]).filter(Boolean).map((a) => ({ art: a.id, key: 'wa' + a.id, x: a.x, y: a.y, name: artifactName(a), year: a.lost ? a.lost[0] : null }));
}
const civOfV = (R, v) => civText(R.tables.civs[v.civ]) || 'the far roads';
function vLetter(s, title, text, vars, v) {
  if (!s.st) return;
  sendLetter(s, 'minor', { title: fillText(title, vars), text: fillText(text, vars), data: { k: 'visitor', visitorId: v.id, fig: v.fig } });
}
/** A scholar charts the nearest lost artifact not yet charted (sim). True when one was. */
function chartLost(s, R, v) {
  const rec = s.colony.visitRec, have = new Set(rec.marks || []);
  let best = null, bd = 0;
  for (const a of R.tables.artifacts || []) {
    if (!a || !a.lost || have.has(a.id) || !Number.isInteger(a.x)) continue;
    const d = cheb(a.x, a.y, s.realm.rx, s.realm.ry);
    if (!best || d < bd || (d === bd && a.id < best.id)) { best = a; bd = d; }
  }
  if (!best) return false;
  rec.marks = [...have, best.id];
  vLetter(s, REALM_WORDS.markTitle, REALM_WORDS.markText, { name: v.name, civ: civOfV(R, v), art: artifactName(best), desc: artifactDesc(best), year: yearText(best.lost[0]) }, v);
  return true;
}
/** A bard sings the tale (sim: the daily step on taleDay; tests call it): the letter; the hearers take the thought in hallJoy. */
export function singTale(s, R, v) {
  const t = taleOf(s, R, v.civ, hash3(seedOf(s), v.id, 0x7a1e));
  v.tale = dayOf(s.tick);
  if (t) vLetter(s, REALM_WORDS.taleTitle, REALM_WORDS.taleText, { name: v.name, tale: `${t.title}, in ${yearText(t.year)}`, hall: WORDS.halls[v.hall] || v.hall }, v);
}

// ---- arrivals and stays ----------------------------------------------------------------------------------------
/** A visitor of `kindId` comes to the hall (sim; tests call it). Returns the visitor. */
export function arrive(s, hallId, first, kindId) {
  ensureVisits(s);
  const kd = kindDef(kindId), day = dayOf(s.tick);
  const R = realmRec(s), pool = R ? worldVisitors(s, kd.id, R) : [];
  const fig = pool.length ? pool[hash3(seedOf(s), day, 0x5f1 + (s.colony.visitRec.came | 0)) % pool.length] : null;
  const gopt = { req: { skill: kd.skill, min: V.minSkill } };
  if (fig) { gopt.name = figureName(fig); if (def('ancestry', fig.people)) gopt.anc = fig.people; }
  const c = generateColonist(s, gopt);
  const h = hash3(seedOf(s), c.id, 0x71517);
  const deep = cavern2Open(s);
  const entry = kd.passage || (deep && h % 100 < V.passagePct) ? 'passage' : 'edge';
  const stay = V.stayDays[0] + ((h >>> 8) % (V.stayDays[1] - V.stayDays[0] + 1));
  const v = { id: c.id, kind: kd.id, hall: hallId, at: first, name: c.name, plain: toPlain('col', c), day, leave: day + stay, entry, asked: -1, book: false, paid: 0 };
  if (fig) { v.fig = fig.id; v.civ = fig.civ; }
  s.colony.visitors.push(v);
  s.colony.visitors.sort((a, b) => a.id - b.id);
  s.colony.visitRec.came++;
  const key = addLegend(s, 'v', c.id, fig ? { text: c.name, links: ['wf' + fig.id] } : { text: c.name });
  legendEvent(s, 'arrived', [key]);
  const kindName = fig ? fillText(REALM_WORDS.of, { kind: kd.name, civ: civOfV(R, v) }) : kd.name;
  addChron(s, 'visitor', 'chron_visitor', { kind: kindName, name: c.name, entry: WORDS.entry[entry], hall: WORDS.halls[hallId] || hallId });
  if (fig && kd.id === 'mercenary') {
    const hb = huntedBeast(s, R);
    if (hb) { v.hunt = hb.beast.id; vLetter(s, REALM_WORDS.huntTitle, REALM_WORDS.huntText, { name: c.name, civ: civOfV(R, v), hall: WORDS.halls[hallId] || hallId, beast: hb.beast.name, days: hb.days }, v); }
  }
  return v;
}
function leave(s, v) {
  const list = s.colony.visitors, k = list.indexOf(v);
  if (k >= 0) list.splice(k, 1);
  s.colony.visitRec.left++;
  addChron(s, 'visitor', 'chron_visitor_left', { name: v.name, kind: (kindDef(v.kind) || {}).name || v.kind });
}
function drinkOne(s, n) {
  let left = n;
  const ids = [];
  forEachItem(s, (it) => { const d = def('item', it.k); if (!it.f && d && d.food && d.food.kind === 'drink') ids.push(it.id); });
  ids.sort((a, b) => a - b);
  for (const id of ids) { if (left <= 0) break; left -= consume(s, id, left); }
  return left <= 0;
}
function bookTitle(s, v) {
  let figs = [];
  try { figs = prehistoryOf(s).figures || []; } catch { figs = []; }
  const h = hash3(seedOf(s), v.id, 0xb00c);
  const who = figs.length ? figs[h % figs.length].name : v.name;
  return { name: fillText(WORDS.bookName, { who }), fig: figs.length ? figs[h % figs.length].key : null };
}
/** A scholar writes their book (sim; the daily step on scholarBookDay; tests call it): a world scholar charts a lost thing. */
export function writeBook(s, v) {
  const [x, y, z] = tileOf(v.at), t = bookTitle(s, v);
  if (def('item', 'book')) spawn(s, 'book', null, 2, 1, x, y, { z, name: t.name });
  s.colony.visitRec.books++;
  addChron(s, 'visitor', 'chron_book', { name: v.name, book: t.name });
  discoveredByScholar(s);
  v.book = true;
  const R = Number.isInteger(v.fig) ? realmRec(s) : null;
  if (R) chartLost(s, R, v);
}
function historyOf(s, v) {
  let places = [];
  try { places = prehistoryOf(s).places || []; } catch { places = []; }
  const h = hash3(seedOf(s), v.id, 0x415);
  const place = places.length ? places[h % places.length].name : WORDS.noPlace;
  const tpl = WORDS.history[(h >>> 4) % WORDS.history.length];
  return fillText(tpl, { place, name: v.name, years: 2 + ((h >>> 8) % 30) });
}
/** Will this visitor ask, once their day comes (petitionPct, from the seed and their id)? */
export const petitionRoll = (s, v) => hash3(seedOf(s), v.id, 0x9e7) % 100 < V.petitionPct;
/** May this visitor petition now? */
export function canPetition(s, v) {
  if (v.asked !== -1 || dayOf(s.tick) - v.day !== V.petitionDays) return false;
  if (!petitionRoll(s, v)) return false;
  if (headCount(s) + 1 > CAPS.colonistsHard) return false;
  const doms = petitionDomains(s), kd = kindDef(v.kind);
  const best = bestSkill(fromPlain('col', v.plain));
  return doms.includes(kd.domain) || (best && doms.includes(SKILL_DOMAIN[best]));
}
function askToStay(s, v) {
  const kd = kindDef(v.kind);
  const text = fillText(WORDS.petitionText, { name: v.name, kind: kd.name, days: dayOf(s.tick) - v.day, hall: WORDS.halls[v.hall] || v.hall, history: historyOf(s, v) });
  const l = sendLetter(s, 'choice', { title: WORDS.petitionTitle, text, choices: WORDS.petitionChoices.slice(), deflt: 1, hours: V.petitionHours, data: { k: 'petition', visitorId: v.id } });
  v.asked = l.id;
  return l;
}
/** The answer to a petition (the letter's choice handler and the command). True when they stayed. */
export function answerPetition(s, visitorId, yes) {
  const v = visitorById(s, visitorId);
  if (!v) return false;
  if (!yes || headCount(s) + 1 > CAPS.colonistsHard) { v.asked = -2; return false; }
  const c = fromPlain('col', v.plain);
  const [x, y, z] = tileOf(v.at);
  spawnColonist(s, c, x, y, z);
  addThought(s, c, 'new_arrival');
  const key = addLegend(s, 'c', c.id, { links: Number.isInteger(v.fig) ? ['v' + b36(v.id), 'wf' + v.fig] : ['v' + b36(v.id)], text: historyOf(s, v) });
  if (Number.isInteger(v.fig)) { const r = s.colony.visitRec; r.joined = [...(Array.isArray(r.joined) ? r.joined : []), v.fig]; }
  legendEvent(s, 'petition', [key]);
  addChron(s, 'people', 'chron_petition', { name: v.name, kind: (kindDef(v.kind) || {}).name || v.kind, colId: c.id });
  const list = s.colony.visitors;
  list.splice(list.indexOf(v), 1);
  s.colony.visitRec.accepted++;
  return true;
}
onChoice('petition', (s, l, choice) => { answerPetition(s, l.data.visitorId, choice === 0); });

/** The daily step (sim): halls, stays, petitions, arrivals. */
export function visitorsDay(s) {
  const rec = ensureVisits(s), day = dayOf(s.tick);
  const halls = hallsOf(s);
  rec.halls = halls.map((h) => [h.id, h.first]);
  const open = new Set(halls.map((h) => h.first));
  for (const v of s.colony.visitors.slice()) {
    if (!open.has(v.at) && v.asked < 0) { leave(s, v); continue; }
    if (v.hall === 'tavern' && !drinkOne(s, V.drinkPerDay) && v.asked < 0) { leave(s, v); continue; }
    const kd = kindDef(v.kind), [x, y, z] = tileOf(v.at);
    const n = kd.pay[0] + (hash3(seedOf(s), v.id, day) % (kd.pay[1] - kd.pay[0] + 1));
    if (n > 0 && def('item', 'coins')) { spawn(s, 'coins', null, 0, n, x, y, { z }); v.paid += n; }
    if (v.kind === 'scholar' && !v.book && day - v.day >= V.scholarBookDay) writeBook(s, v);
    if (v.kind === 'bard' && Number.isInteger(v.fig) && v.tale === undefined && day - v.day >= REALM_VISIT.taleDay) { const R = realmRec(s); if (R) singTale(s, R, v); }
    if (canPetition(s, v)) { askToStay(s, v); continue; }
    if (day >= v.leave && v.asked < 0) leave(s, v);
  }
  const at = new Map();
  for (const v of s.colony.visitors) at.set(v.at, (at.get(v.at) || 0) + 1);
  for (let k = 0; k < halls.length; k++) {
    if (s.colony.visitors.length >= V.maxVisitors) break;
    const h = halls[k];
    if ((at.get(h.first) || 0) >= V.maxPerHall) continue;
    const u = hash3(seedOf(s), day, 0x7150 + k);
    if (u % 1000 >= V.arrivePermille) continue;
    const kd = pickKind(s, h.id, u >>> 10);
    if (!kd) continue;
    arrive(s, h.id, h.first, kd.id);
    at.set(h.first, (at.get(h.first) || 0) + 1);
  }
}
/** Hourly: colonists in a hall take its joy. */
export function hallJoy(s) {
  const hs = visitRec(s).halls;
  if (!hs.length) return;
  const byRoom = new Map(), tales = new Set(), day = dayOf(s.tick);
  for (const [id, first] of hs) { const r = s.rt.room[first]; if (r) byRoom.set(r, id); }
  for (const v of visitorsOf(s)) if (v.tale === day) { const r = s.rt.room[v.at]; if (r) tales.add(r); }
  for (const c of s.col) {
    if (!c || c.hp.dead) continue;
    const i = idx(Math.min(W - 1, Math.max(0, Math.floor(c.x / 32))), Math.floor(c.y / 32), c.z | 0);
    const room = s.rt.room[i], h = byRoom.get(room);
    if (h && JOY[h]) addThought(s, c, JOY[h]);
    if (tales.size && room && tales.has(room)) addThought(s, c, REALM_VISIT.thought);
  }
}
/** The 'colony' slot system. */
export function visitorsSystem(s) {
  if (s.tick % TICKS_PER_HOUR !== 0) return;
  if (s.tick % TICKS_PER_DAY === V.hour * TICKS_PER_HOUR) visitorsDay(s);
  hallJoy(s);
}
function petitionCmd(s, c) {
  const v = visitorById(s, c.visitorId);
  if (!v || v.asked < 0) return { ok: false, reason: 'no such petition' };
  const l = (s.st.letters || []).find((x) => x.id === v.asked);
  if (!l) return { ok: false, reason: 'no such petition' };
  const r = answer(s, l, c.accept ? 0 : 1);
  return r ? { ok: false, reason: r } : { ok: true };
}
export function installVisitors() {
  if ('petition' in COMMANDS) registerApplier('petition', petitionCmd);
}
