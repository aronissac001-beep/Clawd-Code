// Legends and the Annals (EMBERCROWN-FORTRESS.md 3.5; step Z2.3). Owner K. The words live in
// js/data/text/legends.js; the screen is js/ui/annals.js (I).
//
// Two halves:
//
// 1. The vale's pre-history: prehistory(seed, genVersion, rows, dims) is a PURE function of the seed, the
//    generator version and the dormant rows of the pristine meta (2.2 step 8, themselves a function of the
//    seed, or of the seed and the stored base mask for a migrated world). It is never saved: 0 save bytes.
//    40-120 events over the 300 years before the founding: the Old Crown, its kings and smiths; the making
//    and loss of every vault on the map; the watchtowers and their crypts; the world factions' foundings;
//    every generated great beast's earlier deeds (one entry per lair row at least); the Gloomwyrm, the Bone
//    Colossus and the sealing of the Hollow King. It draws on a private mulberry32 stream seeded from
//    hashString('legends:<seed>:<genVersion>'): it never touches s.rng. prehistoryOf(s) is the same through a
//    pure memo (F25: a hit returns exactly what a rebuild would). Owner decision 4: no input names an earlier
//    hold, so the pre-history cannot mention one.
//
// 2. The hold's legend records, s.legend: ONE string of space-separated records (cap LEGEND_CAP, never
//    folded). The compact array of the doc, [kind, id, nameId/args, firstTick, links...], written as text so
//    1,500 records stay under 15 KB raw:
//      named thing   <kind><id36>.<day36>[.<name36>][.<link>...][~<text>]
//                    kind: c colonist, v visitor, m nemesis, b great beast (id: lair voxel), a artifact (id:
//                    item id), r named room (id: its first voxel; name36: the room-name triple), t tomb
//                    (id: first voxel), l level opened (id: z)
//      event         <T><day36>[.<link>...][~<text>]   T = 'A' + the index in TABLES.eventTypes
//    A link is another record's key (<kind><id36>) or a pre-history figure key (p<n>). day36 is the game day
//    (dayOf(tick)) in base 36. Text is the rest of the record with spaces written as '+'.
//    Until A adds 'legend' to the state root (request in the Z2.3 report), s.legend is created lazily.
//
// The hooks (the wiring into installColony is a request to the colony/index.js owner):
//   legendTap(s, e)           ledger.onTap listener: artifacts, tier ups, raids thrown back
//   legendKill(s, victim, k)  BUS.kill listener: colonists' deaths, nemeses slain
//   legendSystem(s)           'colony' slot: hourly figures (colonists, nemeses) and levels opened; daily
//                             rooms named at Grand and tombs
//
// Reading (the Annals screen and the export): figuresOf, artifactsOf, placesOf, holdYears, recordName,
// legendLine, parseLegend, legendRecords.
//
// W3.3b (EMBERCROWN-WORLD.md 2.1, 2.7 vale pre-history row): in a hold whose world has history (valeWorld: s.realm
// with embarkYear > 0) the vale's pre-history is the local chapter of the world's history. prehistoryOf(s) then
// returns it re-dated in world years (vale year k = y - start maps to embarkYear - (VALE_SPAN - k), so every event
// falls before embarkYear): events (y; the Crown year kept in cy), figures (from, to, the Crown years in their text),
// artifacts (y), with era 'world'. With the record loaded and a liege bound, a vault may have been raised by a world
// figure of the liege civ alive and grown at the vault's world year (VALE_BUILDER): place.by = 'wf<id>', the key
// joins the making event's figs. Names, kinds, keys and voxels never change, so the sim (causes.js, visitors.js)
// reads the same chapter with or without the record. recordName resolves world keys ('wf12') through the record.
// valeYearText(s, y) is the year label the Annals use ("Crown year 812", or "Year 41" / "9 years before the Fall").

import { hashString } from '../core/rand.js';
import { dayOf, TICKS_PER_DAY, TICKS_PER_HOUR } from '../core/time.js';
import { zS as gridZS, getBit } from '../core/grid.js';
import { BUS } from '../core/bus.js';
import { DATA as TEXT, TABLES } from '../../data/text/legends.js';
import { DATA as FACTIONS } from '../../data/factions.js';
import { bandOfRel } from '../../data/levels.js';
import { pristineOf } from '../save/pristine.js';
import { roomInfo } from '../world/rooms.js';
import { realmRec, liegeCiv } from './factions.js';
import { HISTORY_PEOPLES } from '../../data/realm/civkinds.js';
import { yearText, figureName, civText, recordName as worldRecordName } from '../../data/text/realm.js';

export const LEGEND_CAP = 1500;
export const PREHISTORY_YEARS = 300;
export const EVENTS_MIN = 40, EVENTS_MAX = 120;
/** Kinds of named record, and those that are figures and places. */
export const FIGURE_KINDS = 'cvmb', PLACE_KINDS = 'rtl';
const NAMED = 'r';   // kinds whose third field is a name index

const TPL = Object.fromEntries(TEXT.text.map((t) => [t.id, t.text]));
const fill = (id, args) => (TPL[id] || id).replace(/\{(\w+)\}/g, (m, k) => (args[k] !== undefined && args[k] !== null ? String(args[k]) : ''));

// ---- a private stream (mulberry32, as js/game/core/rand.js) ------------------------------------------
function stream(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const ri = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = (arr) => arr[Math.floor(next() * arr.length)];
  return { next, ri, pick };
}

// ---- great beasts' names (3.12; H's generator in Z3 should name its beasts with this) -------------------
/** The identity of a generated great beast from its lair row's seed: { name, epithet, full, body, material }. */
export function beastIdentity(rowSeed) {
  const h = hashString('beast:' + (rowSeed >>> 0)), T = TABLES;
  const name = T.beastA[h % T.beastA.length] + T.beastB[(h >>> 5) % T.beastB.length];
  const b = (h >>> 10) % T.beastBody.length, m = (h >>> 14) % T.beastMat.length;
  const epithet = `the ${T.beastMat[m]} ${T.beastBody[b]}`;
  return { name, epithet, full: `${name} ${epithet}`, body: T.beastBodyId[b], material: T.beastMatId[m] };
}
const LEGEND_BEASTS = Object.freeze({ lair_gloomwyrm: 'the Gloomwyrm', lair_colossus: 'the Bone Colossus', sleep: 'the Hollow King' });

// ---- the pre-history ----------------------------------------------------------------------------------------
/**
 * The vale's pre-history (pure). rows: the pristine meta's dormant rows [kind, voxel, seed]; dims: { w, h, zS }.
 * Returns { crownYear, start, events: [{ y, id, text, figs, place, kind }], figures: [{ key, name, kind, title,
 * from, to, text, place }], places: [{ key, name, kind, voxel, text }], artifacts: [{ key, name, maker, y }] }.
 * Figures, places and artifacts have keys p<n> (figures), q<n> (places) and o<n> (artifacts of old).
 */
export function prehistory(seed, genVersion = 0, rows = [], dims = {}) {
  const R = stream(hashString(`legends:${seed >>> 0}:${genVersion | 0}`)), T = TABLES;
  const plane = (dims.w || 128) * (dims.h || 128), zs = dims.zS === undefined ? 14 : dims.zS;
  const bandAt = (v) => { const n = bandOfRel(Math.floor(v / plane) - zs).name; return n.startsWith('The ') ? 'the ' + n.slice(4) : 'the ' + n; };
  const F = 700 + R.ri(0, 299), start = F - PREHISTORY_YEARS;
  const events = [], figures = [], places = [], artifacts = [], used = new Set();
  const uniq = (mk) => { for (let k = 0; k < 40; k++) { const n = mk(); if (!used.has(n)) { used.add(n); return n; } } const n = mk() + ' the Younger'; used.add(n); return n; };
  const person = () => uniq(() => R.pick(T.crownA) + R.pick(T.crownB));
  const fig = (kind, name, title, from, to, place = null) => { const f = { key: 'p' + figures.length, name, kind, title, from, to, text: '', place }; figures.push(f); return f; };
  const place = (kind, name, voxel, text = '') => { const p = { key: 'q' + places.length, name, kind, voxel, text }; places.push(p); return p; };
  const ev = (y, id, args, figs = [], at = null, kind = 'old') => {
    events.push({ y, id, text: fill(id, args), figs: figs.map((f) => f.key), place: at, kind, n: events.length });
  };
  const seat = R.pick(T.seatA) + R.pick(T.seatB);
  // the Old Crown: 5-8 rulers from the rise to the fall
  const nK = R.ri(5, 8), y0 = start + R.ri(0, 10), fall = F - R.ri(60, 120);
  const cuts = [y0];
  for (let k = 1; k < nK; k++) cuts.push(0);
  { // reign lengths: weighted shares of [y0, fall]
    const wts = []; let sum = 0;
    for (let k = 0; k < nK; k++) { const w = 2 + R.ri(0, 6); wts.push(w); sum += w; }
    let acc = 0;
    for (let k = 1; k < nK; k++) { acc += wts[k - 1]; cuts[k] = y0 + Math.floor(((fall - y0) * acc) / sum); }
  }
  const kings = [];
  for (let k = 0; k < nK; k++) {
    const a = cuts[k], b = k + 1 < nK ? cuts[k + 1] : fall;
    const nm = `${R.pick(T.kingTitle)} ${person()} ${R.pick(T.kingEpithet)}`;
    const f = fig('king', nm, 'Ruler of the Old Crown', a, b);
    f.text = `Ruled the Old Crown from Crown year ${a} to ${b}.`;
    kings.push(f);
    if (k === 0) ev(a, 'leg_crown_rise', { king: nm, seat }, [f]);
    else ev(a, 'leg_king_crowned', { king: nm }, [f]);
    if (k + 1 < nK) ev(b, 'leg_king_died', { king: nm, how: R.pick(T.kingDied) }, [f]);
  }
  const kingAt = (y) => { for (let k = nK - 1; k >= 0; k--) if (y >= kings[k].from) return kings[k]; return kings[0]; };
  const yIn = (a, b) => R.ri(Math.min(a, b), Math.max(a, b));
  // the smiths of the Crown and their works
  const smiths = [];
  for (let k = 0, n = R.ri(2, 4); k < n; k++) {
    const y = yIn(y0 + 5, fall - 5), kg = kingAt(y);
    const nm = `${R.pick(T.smithTitle)} ${person()}`;
    const f = fig('smith', nm, 'Smith of the Old Crown', y - R.ri(10, 30), null);
    const a = R.pick(T.thingA), thing = uniq(() => (a.endsWith(' of') ? `${a} ${R.pick(T.thingB)}` : a));
    const o = { key: 'o' + artifacts.length, name: thing, maker: f.key, y };
    artifacts.push(o);
    ev(y, 'leg_smith_forged', { smith: nm, thing, king: kg.name }, [f, kg]);
    const d = Math.min(F - 1, y + R.ri(5, 30));
    f.to = d; f.text = `Forged ${thing} in Crown year ${y}.`;
    ev(d, 'leg_smith_died', { smith: nm, seat }, [f]);
    smiths.push(f);
  }
  const ofKind = (k) => rows.filter((r) => r && r[0] === k).sort((a, b) => a[1] - b[1]);
  // the Hollow King: woken, then sealed under the vale by a ruler and a smith
  const sleepRow = ofKind('sleep')[0] || null;
  const hk = fig('legend', 'The Hollow King', 'A great beast of legend, sealed under the vale', start - 1, null);
  hk.text = 'It sleeps under the Seal-stone. To mine the Seal is to wake it.';
  const ws = yIn(cuts[Math.min(1, nK - 1)], fall - 20);
  ev(ws, 'leg_hollow_wake', {}, [hk], null);
  const sy = Math.min(fall - 1, ws + R.ri(2, 15)), sk = kingAt(sy), ss = smiths[0];
  if (sleepRow) hk.place = place('sleep', 'The Sleep', sleepRow[1], 'The sealed vault of the Hollow King, under the Seal-stone.').key;
  ev(sy, 'leg_hollow_seal', { king: sk.name, smith: ss.name }, [sk, ss, hk], sleepRow ? sleepRow[1] : null);
  // every vault on the map: made under a ruler, lost later
  for (const [, v] of ofKind('vault')) {
    const y = yIn(y0 + 10, fall - 10), kg = kingAt(y);
    const vname = uniq(() => `the ${R.pick(T.vaultAdj)} ${R.pick(T.vaultNoun)}`);
    const keeper = fig('keeper', `${R.pick(T.folkTitle)} ${person()}`, 'Keeper of a Crown vault', y, null);
    const pl = place('vault', vname.replace(/^t/, 'T'), v, `A sealed vault of the Old Crown in ${bandAt(v)}.`);
    keeper.place = pl.key;
    ev(y, 'leg_vault_made', { king: kg.name, vault: vname, band: bandAt(v), keeper: keeper.name }, [kg, keeper], v);
    const ly = R.next() < 0.6 ? fall : yIn(y + 5, F - 5);
    keeper.to = ly;
    ev(ly, 'leg_vault_lost', { vault: vname.replace(/^t/, 'T'), how: R.pick(T.vaultLost), keeper: keeper.name }, [keeper], v);
  }
  // the ruins on the valley floor: a watchtower and its crypt
  for (const [, v] of ofKind('crypt')) {
    const yb = yIn(y0 + 20, fall), builder = fig('builder', `${R.pick(T.folkTitle)} ${person()}`, 'Builder of a watchtower', yb, null);
    ev(yb, 'leg_tower_built', { builder: builder.name }, [builder], v);
    const yd = Math.min(F - 2, yb + R.ri(1, 40)), dead = fig('dead', `${R.pick(T.folkTitle)} ${person()}`, 'Laid in a crypt', yd - R.ri(20, 60), yd);
    const pl = place('crypt', `The crypt of ${builder.name}`, v, 'A crypt under a fallen watchtower.');
    dead.place = pl.key; builder.place = pl.key;
    ev(yd, 'leg_crypt_laid', { dead: dead.name, builder: builder.name }, [dead, builder], v);
    const yf = yIn(Math.max(yd, fall), F - 1);
    builder.to = yf;
    ev(yf, 'leg_tower_fell', { builder: builder.name, how: R.pick(T.towerFell) }, [builder], v);
  }
  // the world factions' foundings
  const FT = { traders: 0, knights: 1, thieves: 2, raiders: 3, pilgrims: 4 };
  for (const fc of (FACTIONS.faction || [])) {
    const y = fc.kind === 'knights' ? yIn(fall + 1, Math.min(F - 5, fall + 30)) : yIn(y0 + 40, F - 10);
    const t = T.founderTitle[FT[fc.kind] | 0] || '';
    const nm = t.startsWith('the ') ? `${person()} ${t}` : `${t} ${person()}`;
    const f = fig('founder', nm, `Founder of the ${fc.name}`, y - R.ri(15, 40), y + R.ri(5, 40));
    if (f.to >= F) f.to = null;
    f.text = `Founded the ${fc.name} in Crown year ${y}.`;
    ev(y, 'leg_faction_rise', { founder: nm, faction: fc.name }, [f]);
  }
  // the generated great beasts: their earlier deeds, then the long sleep in their lairs
  for (const [, v, rs] of ofKind('lair')) {
    const id = beastIdentity(rs), band = bandAt(v);
    const f = fig('beast', id.full, 'A great beast of the deep', null, null);
    const pl = place('lair', `The lair of ${id.name}`, v, `${id.full} sleeps here, in ${band}.`);
    f.place = pl.key; f.text = `A great beast of ${id.material} with the body of a ${id.body.replace('manylegged', 'many-legged thing')}.`;
    const nd = R.ri(1, 2);
    let y = yIn(start, F - 40);
    for (let k = 0; k < nd; k++) { ev(y, 'leg_beast_deed', { beast: id.full, deed: R.pick(T.beastDeeds), band }, [f], v); y = Math.min(F - 2, y + R.ri(5, 60)); }
    ev(y, 'leg_beast_sleep', { beast: id.full, band }, [f], v);
  }
  // the three legends
  const wy = fig('legend', 'The Gloomwyrm', 'A great beast of legend, of the heights', null, null);
  wy.text = 'A winged hoarder that breathes fire and darkness. Rumour of wealth draws it.';
  const wr = ofKind('lair_gloomwyrm')[0];
  if (wr) wy.place = place('eyrie', 'The Gloomwyrm\'s eyrie', wr[1], 'A cliff eyrie on the highest crag of the vale.').key;
  const wy1 = yIn(start, fall);
  ev(wy1, 'leg_wyrm_burn', { town: R.pick(T.towns) }, [wy], null);
  ev(yIn(wy1, F - 1), 'leg_wyrm_eyrie', {}, [wy], wr ? wr[1] : null);
  const bc = fig('legend', 'The Bone Colossus', 'A great beast of legend, of the deep stone', null, null);
  bc.text = 'A giant of bone that walks through built walls.';
  const cr = ofKind('lair_colossus')[0];
  if (cr) bc.place = place('lair', 'The Colossus\'s lair', cr[1], 'A hollow in the deep stone below the Sunless Mere.').key;
  const cy = yIn(fall - 30, fall);
  ev(cy, 'leg_colossus_rise', { seat }, [bc], null);
  ev(Math.min(F - 1, cy + R.ri(1, 20)), 'leg_colossus_sleep', {}, [bc], cr ? cr[1] : null);
  // the fall of the Crown
  const last = kings[nK - 1];
  ev(fall, 'leg_crown_fall', { king: last.name, seat }, [last]);
  // omens and the years between, until the count is in 40-120
  const want = Math.max(EVENTS_MIN, Math.min(EVENTS_MAX, events.length + R.ri(8, 24)));
  const om = T.omens.map((_, k) => k);
  for (let k = om.length - 1; k > 0; k--) { const j = R.ri(0, k); [om[k], om[j]] = [om[j], om[k]]; }
  for (let k = 0; events.length < want && k < om.length; k++) { const y = yIn(start, F - 1); ev(y, 'leg_omen', { omen: T.omens[om[k]] }, [kingAt(y)].filter((f) => y <= fall)); }
  while (events.length < want) { const y = yIn(y0, fall - 1), kg = kingAt(y); ev(y, 'leg_king_crowned', { king: kg.name }, [kg]); events[events.length - 1].text = `${kg.name} held court in ${seat}.`; }
  events.sort((a, b) => a.y - b.y || a.n - b.n);
  for (const e of events) delete e.n;
  return { crownYear: F, start, seat, events, figures, places, artifacts };
}

const PRE = new WeakMap();
/** The state's pre-history through its pristine meta (pure memo; a D = 1 state uses no rows). A hold whose world has
 *  history gets it re-dated in world years (valeChapter). */
export function prehistoryOf(s) {
  const p = pristineOf(s), rows = (p && p.meta && p.meta.dormant) || [], gv = p ? p.genVersion | 0 : 0;
  const world = valeWorld(s), ey = world ? s.realm.embarkYear : 0, R = world ? realmRec(s) : null, L = R ? liegeCiv(s) : null;
  const hit = PRE.get(s);
  if (hit && hit.p === p && hit.seed === s.seed && hit.ey === ey && hit.R === R && hit.L === L) return hit.v;
  const base = hit && hit.p === p && hit.seed === s.seed ? hit.base : prehistory(s.seed, gv, rows, { w: s.w, h: s.h, zS: s.zS === undefined ? gridZS : s.zS });
  const v = world ? valeChapter(base, ey, R, L, s.seed) : base;
  PRE.set(s, { p, seed: s.seed, ey, R, L, base, v });
  return v;
}

// ---- the vale's chapter in world years (W3.3b) -------------------------------------------------------------
/** The span of the vale's pre-history in years (2.1 valeSpan). */
export const VALE_SPAN = PREHISTORY_YEARS;
/** A vault's builder is a world figure with this chance (percent, from the seed and the vault), when one fits. */
export const VALE_BUILDER = Object.freeze({ pct: 60, rank: Object.freeze({ smith: 0, ruler: 1 }) });
/** Does this hold date its vale in world years (a world with history: s.realm with embarkYear > 0)? */
export const valeWorld = (s) => !!(s && s.realm && Number.isInteger(s.realm.embarkYear) && s.realm.embarkYear > 0);
/** The world year of vale year y of a pre-history whose founding Crown year is crownYear (2.1). */
export const valeToWorld = (embarkYear, crownYear, y) => embarkYear - (VALE_SPAN - (y - (crownYear - VALE_SPAN)));
/** The year label of a pre-history year as prehistoryOf(s) gives it: world years in a world hold, else Crown years. */
export const valeYearText = (s, y) => (valeWorld(s) ? yearText(y) : `Crown year ${y}`);
const inYear = (y) => (y < 0 ? `${-y} ${y === -1 ? 'year' : 'years'} before the Fall` : `in Year ${y}`);
/**
 * The pre-history `pre` re-dated in world years (pure): a copy with events' y (cy: the Crown year), figures' from/to
 * and the Crown years in their text, artifacts' y, start; era 'world'. R and L (the record and the liege civ, or
 * null) add the vault builders.
 */
export function valeChapter(pre, embarkYear, R = null, L = null, seed = 0) {
  const d = valeToWorld(embarkYear, pre.crownYear, 0);
  const wy = (y) => (y === null || y === undefined ? y : y + d);
  const fix = (t) => String(t || '')
    .replace(/from Crown year (\d+) to (\d+)/g, (m, a, b) => `from ${yearText(+a + d)} to ${yearText(+b + d)}`)
    .replace(/in Crown year (\d+)/g, (m, a) => inYear(+a + d))
    .replace(/Crown year (\d+)/g, (m, a) => yearText(+a + d));
  const events = pre.events.map((e) => ({ ...e, y: e.y + d, cy: e.y, figs: e.figs.slice() }));
  const figures = pre.figures.map((f) => ({ ...f, from: wy(f.from), to: wy(f.to), text: fix(f.text) }));
  const places = pre.places.map((p) => ({ ...p }));
  const artifacts = pre.artifacts.map((a) => ({ ...a, y: wy(a.y) }));
  const civ = R && Number.isInteger(L) ? R.tables.civs[L] : null;
  if (civ) {
    for (const p of places) {
      if (p.kind !== 'vault') continue;
      const e = events.find((x) => x.id === 'leg_vault_made' && x.place === p.voxel);
      const h = hashString(`valebuilder:${seed >>> 0}:${p.voxel}`);
      if (!e || h % 100 >= VALE_BUILDER.pct) continue;
      const f = valeBuilder(R, L, e.y, h >>> 8);
      if (!f) continue;
      p.by = 'wf' + f.id;
      p.text = `${p.text} Raised by ${figureName(f)} of ${civText(civ)}.`;
      e.figs.push(p.by);
    }
  }
  return { ...pre, start: pre.start + d, events, figures, places, artifacts, era: 'world', embarkYear };
}
/** A world figure of civ L grown and alive at world year y, the smiths first, then rulers (h picks in the group). */
export function valeBuilder(R, L, y, h) {
  let best = [], rank = 9;
  for (const f of R.tables.figures || []) {
    if (!f || f.civ !== L) continue;
    const ad = ((HISTORY_PEOPLES[f.people] || HISTORY_PEOPLES.human).lifespan || [16])[0];
    if (f.born + ad > y || (f.died !== null && f.died < y)) continue;
    const r = VALE_BUILDER.rank[f.role] !== undefined ? VALE_BUILDER.rank[f.role] : 2;
    if (r < rank) { rank = r; best = [f]; } else if (r === rank) best.push(f);
  }
  return best.length ? best[(h >>> 0) % best.length] : null;
}

// ---- the hold's legend records ----------------------------------------------------------------------------
const b36 = (n) => (n >>> 0).toString(36);
const cleanText = (t) => String(t).replace(/[~]/g, '').trim().replace(/\s+/g, '+');
const PARSE = new Map();
/** One record string to { kind, id, day, name, links, text, key, event }. */
export function parseLegend(str) {
  let r = PARSE.get(str);
  if (r) return r;
  const t = str.indexOf('~'), head = t >= 0 ? str.slice(0, t) : str, text = t >= 0 ? str.slice(t + 1).replace(/\+/g, ' ') : null;
  const parts = head.split('.'), k0 = parts[0][0];
  if (k0 >= 'A' && k0 <= 'Z') {
    const type = TABLES.eventTypes[k0.charCodeAt(0) - 65] || 'event';
    r = { kind: 'e', event: type, id: -1, day: parseInt(parts[0].slice(1) || '0', 36), name: 0, links: parts.slice(1), text, key: null };
  } else {
    const named = NAMED.includes(k0);
    r = { kind: k0, event: null, id: parseInt(parts[0].slice(1), 36), day: parseInt(parts[1] || '0', 36), name: named ? parseInt(parts[2] || '0', 36) : 0, links: parts.slice(named ? 3 : 2), text, key: parts[0] };
  }
  if (PARSE.size > 6000) PARSE.clear();
  PARSE.set(str, r);
  return r;
}
const IDX = new WeakMap();
/** The record strings of s (oldest first). */
export function legendRecords(s) {
  const L = typeof s.legend === 'string' ? s.legend : '';
  const hit = IDX.get(s);
  if (hit && hit.src === L) return hit.recs;
  const recs = L ? L.split(' ') : [];
  const keys = new Map();
  for (let k = 0; k < recs.length; k++) { const c = recs[k].charCodeAt(0); if (c >= 97) keys.set(recs[k].split(/[.~]/)[0], k); }
  IDX.set(s, { src: L, recs, keys });
  return recs;
}
export const legendCount = (s) => legendRecords(s).length;
/** The record of a key ('c1a'), or null. */
export function legendOf(s, key) {
  const recs = legendRecords(s), k = IDX.get(s).keys.get(key);
  return k === undefined ? null : parseLegend(recs[k]);
}
function push(s, str) {
  const recs = legendRecords(s);
  if (recs.length >= LEGEND_CAP) return false;
  s.legend = (typeof s.legend === 'string' && s.legend ? s.legend + ' ' : '') + str;
  return true;
}
/**
 * Add a named record (idempotent per key). kind: one of c v m b a r t l. opts: { name, links, text, tick }.
 * Returns its key, or null when the records are full.
 */
export function addLegend(s, kind, id, opts = {}) {
  const key = kind + b36(id);
  if (legendOf(s, key)) return key;
  const day = dayOf(opts.tick === undefined ? s.tick : opts.tick);
  let str = `${key}.${b36(day)}`;
  if (NAMED.includes(kind)) str += '.' + b36(opts.name | 0);
  for (const l of opts.links || []) if (l) str += '.' + l;
  if (opts.text) str += '~' + cleanText(opts.text);
  return push(s, str) ? key : null;
}
/** Add an event record: type from TABLES.eventTypes, links (record keys), optional text. True when written. */
export function legendEvent(s, type, links = [], text = null) {
  const k = TABLES.eventTypes.indexOf(type);
  if (k < 0 || k > 25) return false;
  let str = String.fromCharCode(65 + k) + b36(dayOf(s.tick));
  for (const l of links) if (l) str += '.' + l;
  if (text) str += '~' + cleanText(text);
  return push(s, str);
}
/** The room-name index triple for a room's first voxel (stable: from the seed and the voxel). */
export function roomNameIndex(seed, first) {
  const h = hashString(`room:${seed >>> 0}:${first >>> 0}`), T = TABLES;
  return ((h % T.roomHall.length) << 8) | (((h >>> 8) % T.roomAdj.length) << 4) | ((h >>> 16) % T.roomNoun.length);
}
export function roomName(n) {
  const T = TABLES;
  return `the ${T.roomHall[(n >> 8) % T.roomHall.length]} of ${T.roomAdj[(n >> 4) & 15]} ${T.roomNoun[n & 15]}`;
}
const levelName = (s, z) => { const zs = s.zS === undefined ? gridZS : s.zS, rel = z - zs; return `${bandOfRel(rel).name} (${rel > 0 ? '+' + rel : rel})`; };

// ---- the hooks ----------------------------------------------------------------------------------------------
/** ledger.onTap listener (fn(s, e)): artifacts, tier ups, raids thrown back. */
export function legendTap(s, e) {
  const d = e.data || {};
  if (e.name === 'artifact') {
    const maker = d.colId !== undefined && d.colId !== null ? 'c' + b36(d.colId) : null;
    const a = d.itemId >= 0 ? addLegend(s, 'a', d.itemId, { links: [maker], text: d.name || 'an artifact' }) : null;
    legendEvent(s, 'artifact', [maker, a]);
  } else if (e.name === 'tierUp') legendEvent(s, 'tier', [], d.tier ? String(d.tier) : null);
  else if (e.name === 'raidEnd' && d.result === 'repelled') legendEvent(s, 'raid');
}
/** BUS.kill listener: a colonist's death, a nemesis slain. */
export function legendKill(s, victim, killer) {
  if (!victim) return;
  if ('sk' in victim) { const key = addLegend(s, 'c', victim.id); legendEvent(s, 'death', [key, killer && killer.nem !== null && killer.nem !== undefined ? 'm' + b36(killer.nem) : null]); }
  else if (victim.nem !== null && victim.nem !== undefined) { const key = addLegend(s, 'm', victim.nem); legendEvent(s, 'slain', [key]); }
}
export function installLegends() { if (!BUS.kill.includes(legendKill)) BUS.kill.push(legendKill); }
/** The 'colony' slot system: hourly figures and levels, daily named rooms and tombs. */
export function legendSystem(s) {
  if (s.tick % TICKS_PER_HOUR !== 0) return;
  if (typeof s.legend !== 'string') s.legend = '';
  const deep = (s.d | 0) > 1, zs = s.zS | 0;
  for (const c of s.col) {
    if (!c) continue;
    addLegend(s, 'c', c.id);
    if (deep && !(c.hp && c.hp.dead) && (c.z | 0) !== zs) addLegend(s, 'l', c.z | 0);
  }
  for (const n of (s.st && s.st.nemeses) || []) addLegend(s, 'm', n.id);
  if (s.tick % TICKS_PER_DAY !== 0 || !s.rt || !s.rt.rooms) return;
  for (const rec of s.rt.rooms) {
    if (!rec) continue;
    const info = roomInfo(s, rec.id);
    if (!info) continue;
    if (info.role === 'tomb') addLegend(s, 't', rec.first);
    else if (info.tierIdx >= GRAND) addLegend(s, 'r', rec.first, { name: roomNameIndex(s.seed, rec.first) });
  }
}
const GRAND = 4;   // js/data/rooms.js tiers: squalid, plain, decent, fine, grand, majestic

// ---- reading -------------------------------------------------------------------------------------------------
const colById = (s, id) => { for (const c of s.col) if (c && c.id === id) return c; return null; };
const nemById = (s, id) => { for (const n of (s.st && s.st.nemeses) || []) if (n.id === id) return n; return null; };
/** The display name of a record key or a pre-history key. */
export function recordName(s, key) {
  if (!key) return '';
  const k = key[0], id = parseInt(key.slice(1), 36);
  if (k === 'p' || k === 'q' || k === 'o') {
    const pre = prehistoryOf(s), list = k === 'p' ? pre.figures : k === 'q' ? pre.places : pre.artifacts;
    const n = parseInt(key.slice(1), 10), x = list[n];
    return x ? x.name : '';
  }
  if (k === 'w') { const R = realmRec(s); return (R && worldRecordName(R, key)) || ''; }
  const r = legendOf(s, key);
  if (k === 'c' || k === 'v') { const c = colById(s, id); return c ? c.name : (r && r.text) || 'someone'; }
  if (k === 'm') { const n = nemById(s, id); return n ? `${n.name}${n.epithet ? ' ' + n.epithet : ''}` : (r && r.text) || 'a nemesis'; }
  if (k === 'a') return (r && r.text) || 'an artifact';
  if (k === 'r') return r ? roomName(r.name).replace(/^t/, 'T') : 'a named room';
  if (k === 't') return 'A tomb';
  if (k === 'l') return levelName(s, id);
  if (k === 'b') { const pl = prehistoryOf(s).places.find((p) => p.voxel === id); return pl ? pl.name.replace(/^The lair of /, '') : 'a great beast'; }
  return '';
}
/** One record as a line of text. */
export function legendLine(s, rec) {
  if (rec.kind === 'e') {
    // a crime or a sentence carries its own line (justice.js: who, what and the sentence)
    if (rec.text && (rec.event === 'crime' || rec.event === 'sentence')) return rec.text;
    const a = recordName(s, rec.links[0]), b = rec.links[1] ? recordName(s, rec.links[1]) : rec.text || '';
    return fill('leg_ev_' + rec.event, { a: a || 'Someone', b });
  }
  const n = recordName(s, rec.key);
  if (rec.kind === 'c') return `${n} came to the hold.`;
  if (rec.kind === 'r') return `${n} was named.`;
  if (rec.kind === 't') return 'A tomb was made ready.';
  if (rec.kind === 'l') return `A new level was opened: ${n}.`;
  if (rec.kind === 'a') return `${n} was made.`;
  return n;
}

/**
 * Every figure the Annals list: the hold's colonists (living and dead, with or without a record), nemeses,
 * the visitors and beasts with records, then the figures of old. [{ key, name, sub, group, tick?, y?, links }]
 */
export function figuresOf(s) {
  const out = [], seen = new Set();
  for (const c of s.col) {
    if (!c) continue;
    const key = 'c' + b36(c.id), r = legendOf(s, key), dead = !!(c.hp && c.hp.dead);
    seen.add(key);
    out.push({ key, name: c.name, sub: dead ? 'Of the hold, dead' : 'Of the hold', group: dead ? 'dead' : 'living', day: r ? r.day : null, colId: c.id });
  }
  for (const n of (s.st && s.st.nemeses) || []) { const key = 'm' + b36(n.id); seen.add(key); out.push({ key, name: recordName(s, key), sub: 'A nemesis of the hold', group: 'living' }); }
  for (const str of legendRecords(s)) {
    const r = parseLegend(str);
    if (!r.key || !FIGURE_KINDS.includes(r.kind) || seen.has(r.key)) continue;
    seen.add(r.key);
    out.push({ key: r.key, name: recordName(s, r.key), sub: r.kind === 'v' ? 'A visitor' : r.kind === 'b' ? 'A great beast' : 'Of the hold', group: 'living', day: r.day });
  }
  for (const f of prehistoryOf(s).figures) out.push({ key: f.key, name: f.name, sub: f.title, group: 'old', text: f.text, from: f.from, to: f.to, place: f.place });
  return out;
}
/** Named artifacts: the records, the Chronicle's artifact lines (before the records existed) and those of old. */
export function artifactsOf(s) {
  const out = [], names = new Set();
  for (const str of legendRecords(s)) {
    const r = parseLegend(str);
    if (r.kind !== 'a') continue;
    names.add(r.text);
    out.push({ key: r.key, name: r.text || 'an artifact', sub: r.links[0] ? `Made by ${recordName(s, r.links[0])}` : '', group: 'hold', day: r.day, maker: r.links[0] || null });
  }
  for (const e of s.chron || []) {
    if (e[2] !== 'chron_artifact' || !e[3] || names.has(e[3].item)) continue;
    names.add(e[3].item);
    out.push({ key: null, name: e[3].item || 'an artifact', sub: e[3].maker ? `Made by ${e[3].maker}` : '', group: 'hold', day: dayOf(e[0]) });
  }
  const pre = prehistoryOf(s);
  for (const a of pre.artifacts) out.push({ key: a.key, name: a.name, sub: `Forged by ${pre.figures[+a.maker.slice(1)].name}, ${valeYearText(s, a.y)}`, group: 'old', maker: a.maker });
  return out;
}
/** True when the hold has found voxel v (the fog bit). */
export const foundVoxel = (s, v) => !!(s.L && s.L.fog && v >= 0 && getBit(s.L.fog, v));
/** Named places: the hold's (rooms, tombs, levels) and those of old (vaults, lairs, crypts, the Sleep). */
export function placesOf(s) {
  const out = [];
  for (const str of legendRecords(s)) {
    const r = parseLegend(str);
    if (!PLACE_KINDS.includes(r.kind)) continue;
    const voxel = r.kind === 'l' ? null : r.id;
    out.push({ key: r.key, name: recordName(s, r.key), sub: r.kind === 'r' ? 'A Grand room' : r.kind === 't' ? 'A tomb' : 'A level opened', group: 'hold', day: r.day, voxel, z: r.kind === 'l' ? r.id : Math.floor(voxel / (s.w * s.h)) });
  }
  for (const p of prehistoryOf(s).places) out.push({ key: p.key, name: p.name, sub: p.text, group: 'old', voxel: p.voxel, z: Math.floor(p.voxel / (s.w * s.h)), found: foundVoxel(s, p.voxel) });
  return out;
}
/** The hold's own timeline lines from the records that the Chronicle does not already carry (places, levels). */
export function holdYears(s) {
  const out = [];
  for (const str of legendRecords(s)) {
    const r = parseLegend(str);
    if (r.kind === 'r' || r.kind === 'l' || r.kind === 't' || (r.kind === 'e' && !['death', 'artifact', 'tier', 'raid'].includes(r.event))) out.push({ day: r.day, text: legendLine(s, r), key: r.key });
  }
  return out;
}
/** Related keys of a key: the records and pre-history events that link to it, and its own links. */
export function relatedOf(s, key) {
  const out = new Set();
  if (key[0] === 'p' || key[0] === 'q' || key[0] === 'o') {
    const pre = prehistoryOf(s);
    if (key[0] === 'p') {
      const f = pre.figures[+key.slice(1)];
      if (f && f.place) out.add(f.place);
      for (const e of pre.events) if (e.figs.includes(key)) for (const g of e.figs) out.add(g);
      for (const a of pre.artifacts) if (a.maker === key) out.add(a.key);
    } else if (key[0] === 'q') { for (const f of pre.figures) if (f.place === key) out.add(f.key); }
    else { const a = pre.artifacts[+key.slice(1)]; if (a) out.add(a.maker); }
  } else {
    const own = legendOf(s, key);
    if (own) for (const l of own.links) out.add(l);
    for (const str of legendRecords(s)) { const r = parseLegend(str); if (r.links.includes(key)) { if (r.key) out.add(r.key); for (const l of r.links) out.add(l); } }
  }
  out.delete(key); out.delete('');
  return [...out];
}
/** The pre-history events of a pre-history key (figure or place), oldest first. */
export function prehistoryEventsOf(s, key) {
  const pre = prehistoryOf(s);
  if (key[0] === 'p') return pre.events.filter((e) => e.figs.includes(key));
  if (key[0] === 'q') { const p = pre.places[+key.slice(1)]; return p ? pre.events.filter((e) => e.place === p.voxel) : []; }
  return [];
}
/** The hold's record lines that link a key, oldest first. */
export function recordLinesOf(s, key) {
  const out = [];
  for (const str of legendRecords(s)) { const r = parseLegend(str); if (r.kind === 'e' && r.links.includes(key)) out.push({ day: r.day, text: legendLine(s, r) }); }
  return out;
}
/** The voxel a "Show on map" button goes to for a figure or place entry, or -1 (not found, or no place). */
export function entryVoxel(s, entry) {
  if (entry.voxel === undefined || entry.voxel === null || entry.voxel < 0) return -1;
  return entry.group === 'old' && !entry.found ? -1 : entry.voxel;
}
