// The season tick: the world lives on after embark (EMBERCROWN-WORLD.md 2.8, G5, G6; owner L, step W3.8).
//
// At the first tick of each season (s.tick a multiple of DAYS_PER_SEASON days, never tick 0) realmTickSystem
// advances s.realm.year (embarkYear + the hold's game years) and, in a hold whose record is loaded (realmRec:
// s.rt.realm, wid-checked), runs one step of the world:
//   - war and peace for every pair of living civs in contact that has a civ within TICK.near regions of the hold;
//     the other pairs take one coarse (yearly) step at the first season of each year;
//   - at most one battle per war per season; a lost site is taken or razed (s.realm.sites delta rows
//     [site, owner (-1 razed), size, year], one row per site, updated in place); a civ left with no living site
//     falls and its wars end (s.realm.wars delta rows [a, b, began, ended], ended null while it runs);
//   - deaths of figures by age (s.realm.dead: a bitset of u32 words, bit id & 31 of word id >> 5);
//   - news: a change within TICK.news travel days of the hold becomes a rumour row in s.realm.ev, which a caravan
//     or a visitor delivers (colony/news.js);
//   - the hold's own deeds (named artifacts, raids repelled, great beasts slain: the Dawn Ledger's lifetime counters)
//     become world rows in s.realm.ev and move the standing of civs within reach by their ethics; the hold's renown
//     (s.colony.renown.known) raises its standing with them a little each season.
//
// s.realm.ev rows: [day, type, a, b, site, arg, flags]: `type` >= 0 is an EVENT_TYPES row (data/realm/events.js,
// the same slots as the record's events); type < 0 is one of HOLD_EV. `day` is the hold's game day of the season
// tick (the world year is embarkYear + yearOf(day)). flags: EV_FLAG. The rows are capped at TICK.evCap, and the
// four delta arrays at REALM_DELTA_CAP bytes: the oldest rows fold into one 'years pass' summary row.
//
// Determinism (G5): every draw is hash32(worldSeed, year, season, k, ...) (core/rand.js), never s.rng; civs, pairs,
// sites and figures run in id order; integer arithmetic only (tools/check-mapgen.mjs lints this file). The tick is
// a pure function of the record, s.realm, the ledger counters and the renown record, so a hold saved at any tick
// continues identically after a reload. It never creates a threat (G6, 2.9): it writes only s.realm and goodwill;
// the causes (threat/causes.js) read the wars and the storyteller still paces every raid.
// A realm-less hold returns at once, so its state and hash never move (the legacy-hash rule of 12.1).
import { hash32 } from '../core/rand.js';
import { TICKS_PER_DAY, DAYS_PER_SEASON, SEASONS, dayOf, yearOf } from '../core/time.js';
import { registerSystem, tickSystems } from '../core/bus.js';
import { REALM_DELTA_CAP } from '../core/schema.js';
import { HISTORY_GEN, HISTORY_PEOPLES, CIVKINDS } from '../../data/realm/civkinds.js';
import { ETHIC_AXES } from '../../data/realm/ethics.js';
import { EVENT_INDEX as E, NONE, DEATH } from '../../data/realm/events.js';
import { realmRec, sitesNow, relStatic, factionOfCiv, addGoodwill, goodwill } from '../colony/factions.js';
import { travelField } from '../colony/caravans.js';
import { bandOf } from './biomes.js';

export const SEASON_TICKS = DAYS_PER_SEASON * TICKS_PER_DAY;
const G = HISTORY_GEN;

/** The tick's numbers (G may move them to js/data/realm/). Chances are permille per step. */
export const TICK = Object.freeze({
  near: 16,          // Chebyshev regions: a pair with a civ this close to the hold steps every season
  news: 12,          // travel days: a change this close to the hold is a rumour
  amity: 20,         // rel terms the static rel lacks (years of contact): added before the war test
  battle: 350,       // a war's battle chance a season (a coarse yearly step: `battleYear`)
  battleYear: 800,
  end: 75,           // a war's end chance a season once it is `G.war.lenMin` years old (yearly step: `endYear`)
  endYear: 300,
  evCap: 400,        // s.realm.ev rows before the oldest fold into the summary row
  byteHead: 512,     // bytes kept free under REALM_DELTA_CAP
  warKeep: 10,       // an ended delta war is kept this many years before it may be pruned for room
  renown: { perKnown: 1, max: 3, ceiling: 50 },
  deedMax: 3,        // deed rows of one kind a season
  deedPer: 2, deedCap: 4,   // goodwill per ethic point a deed moves, capped per deed
});

/** Negative ev row types (the tick's own; >= 0 is EVENT_TYPES). Append-only: saved in s.realm.ev. */
export const HOLD_EV = Object.freeze({ summary: -1, base: -2, artifact: -3, siege: -4, beast: -5 });
/** ev row flags. */
export const EV_FLAG = Object.freeze({ rumour: 1, delivered: 2, hold: 4 });
/** The hold's deeds: the ledger key counted, the ev type, the ethic axes [axis, sign] that like the deed. */
export const HOLD_DEEDS = Object.freeze([
  { key: 'artifacts', type: HOLD_EV.artifact, axes: [['deep', 1], ['coin', 1]] },
  { key: 'raidsRepelled', type: HOLD_EV.siege, axes: [['law', 1]] },
  { key: 'beastsSlain', type: HOLD_EV.beast, axes: [['beasts', -1]] },   // the ledger key lands with H (W3.8 request)
]);
const AGGR = Object.fromEntries(CIVKINDS.map((k) => [k.id, k.aggr | 0]));
const life = (p) => (HISTORY_PEOPLES[p] || HISTORY_PEOPLES.human).lifespan;
const cheb = (a, b) => { const dx = a.x > b.x ? a.x - b.x : b.x - a.x, dy = a.y > b.y ? a.y - b.y : b.y - a.y; return dx > dy ? dx : dy; };

/** The world year of a hold tick (embarkYear + the hold's game years). */
export const yearAt = (sRealm, tick) => (sRealm.embarkYear | 0) + yearOf(tick);
/** The world year of an ev row. */
export const rowYear = (sRealm, row) => (sRealm.embarkYear | 0) + yearOf(row[0] * TICKS_PER_DAY);
/** Is figure id dead since embark (s.realm.dead)? */
export const deadSince = (sRealm, id) => ((((sRealm && sRealm.dead) || [])[id >> 5] | 0) >>> (id & 31)) & 1;
/** The ledger lifetime count of `key` without creating the ledger record (0 when absent). */
const counted = (s, key) => { const l = s.colony && s.colony.ledger; return (l && l.total && l.total[key]) | 0; };
/** Bytes of the four delta arrays (schema.js checkRealmField's measure). */
export const deltaBytes = (r) => JSON.stringify([r.sites, r.wars, r.dead, r.ev]).length;

// ---- the world now ------------------------------------------------------------------------------------------
/** Open wars and the last peace per pair: { open: Map 'a:b' -> war, last: Map 'a:b' -> year }. */
function warsNow(s, R) {
  const all = new Map();
  const put = (a, b, began, ended, row) => {
    if (!Number.isInteger(a) || !Number.isInteger(b)) return;
    const lo = a < b ? a : b, hi = a < b ? b : a;
    all.set(`${lo}:${hi}:${began | 0}`, { a: lo, b: hi, began: began | 0, ended: ended === undefined ? null : ended, row });
  };
  for (const w of R.tables.wars || []) put(w.a, w.b, w.began, w.ended, null);
  (s.realm.wars || []).forEach((d, k) => { if (Array.isArray(d)) put(d[0], d[1], d[2], d[3], k); });
  const open = new Map(), last = new Map();
  for (const w of all.values()) {
    const key = `${w.a}:${w.b}`;
    if (w.ended === null) open.set(key, w);
    else if (!last.has(key) || last.get(key) < w.ended) last.set(key, w.ended);
  }
  return { open, last };
}

/** A tick context: the draws, the sites now, the civs alive, the hold's reach. */
function context(s, R) {
  const sr = s.realm, n = R.n, sc = n / 64, Y = sr.year | 0, q = Math.floor(dayOf(s.tick) / DAYS_PER_SEASON) % SEASONS.length;
  const sites = sitesNow(s, R), civs = R.tables.civs, C = civs.length;
  const tf = travelField(R, sr.rx, sr.ry, TICK.news), hold = { x: sr.rx, y: sr.ry };
  const liveN = new Int32Array(C), near = new Uint8Array(C), reach = new Uint8Array(C);
  for (const x of sites) {
    if (x.civ === null || !civs[x.civ]) continue;
    liveN[x.civ]++;
    if (cheb(x, hold) <= TICK.near) near[x.civ] = 1;
    if (tf[x.y * n + x.x] <= TICK.news) reach[x.civ] = 1;
  }
  const alive = (c) => civs[c] && civs[c].fell === null && liveN[c] > 0;
  return { s, R, sr, n, sc, Y, q, day: dayOf(s.tick), seed: sr.seed >>> 0, sites, civs, C, tf, liveN, near, reach, alive, ...warsNow(s, R), out: { rumours: 0, deeds: 0 } };
}
const roll = (X, ...k) => hash32(X.seed, X.Y, X.q, ...k) >>> 0;
const pm = (X, ...k) => roll(X, ...k) % 1000;
const siteNear = (X, t) => X.tf[t.y * X.n + t.x] <= TICK.news;
const rad = (X, size) => { const r = Math.round(G.claim[size > 5 ? 5 : size < 0 ? 0 : size] * X.sc); return r > 1 ? r : 1; };

function push(X, type, a = NONE, b = NONE, site = NONE, arg = 0, flags = EV_FLAG.rumour) {
  X.sr.ev.push([X.day, type, a, b, site, arg, flags]);
  if (flags & EV_FLAG.rumour) X.out.rumours++;
}
/** Write site t's delta row (one per site, kept sorted by site id). */
function setSite(X, t, owner, size) {
  t.civ = owner; t.size = size;
  const rows = X.sr.sites, row = [t.id, owner === null ? -1 : owner, size, X.Y];
  const k = rows.findIndex((d) => Array.isArray(d) && d[0] === t.id);
  if (k >= 0) rows[k] = row;
  else { rows.push(row); rows.sort((p, r) => p[0] - r[0]); }
}
function declare(X, a, b) {
  X.sr.wars.push([a, b, X.Y, null]);
  X.open.set(`${a}:${b}`, { a, b, began: X.Y, ended: null, row: X.sr.wars.length - 1 });
  if (X.reach[a] || X.reach[b]) push(X, E['war.declared'], a, b, NONE, -1);
}
function endWar(X, w, rumour = true) {
  if (w.row !== null) X.sr.wars[w.row][3] = X.Y;
  else { X.sr.wars.push([w.a, w.b, w.began, X.Y]); w.row = X.sr.wars.length - 1; }
  w.ended = X.Y;
  X.open.delete(`${w.a}:${w.b}`); X.last.set(`${w.a}:${w.b}`, X.Y);
  if (rumour && (X.reach[w.a] || X.reach[w.b])) push(X, E['war.treaty'], w.a, w.b, NONE, -1);
}
/** The living site of `c` nearest a living site of `o`: [site of c, site of o] (ties by ids), or null. */
function front(X, c, o) {
  let best = null, bd = 0;
  for (const p of X.sites) {
    if (p.civ !== c) continue;
    for (const t of X.sites) {
      if (t.civ !== o) continue;
      const d = cheb(p, t);
      if (best === null || d < bd) { best = [p, t]; bd = d; }
    }
  }
  return best;
}
function strength(X, c, t) {
  const r = Math.max(2, Math.round(G.war.front * X.sc));
  let v = 0;
  for (const p of X.sites) if (p.civ === c && cheb(p, t) <= r) v += p.size + 1;
  return v;
}
function guard(X, t) {
  const c = X.civs[t.civ], R = X.R;
  return G.war.ground[bandOf(R.fields.elev[t.y * X.n + t.x], R.bands)] + (c.cap === t.id ? G.war.capital : 0) + (HISTORY_PEOPLES[c.people] ? HISTORY_PEOPLES[c.people].guard | 0 : 0);
}
/** One battle of war w (2.3 step 3's rules, integer rolls): the loser's front site may be taken or razed. */
function battle(X, w) {
  const att = roll(X, 'att', w.a, w.b) & 1 ? w.a : w.b, def = att === w.a ? w.b : w.a, fr = front(X, def, att);
  if (!fr) return;
  const [target, src] = fr;
  const sa = strength(X, att, target) + (roll(X, 'sa', w.a, w.b) % (G.war.rnd + 1));
  const sd = strength(X, def, target) + 1 + guard(X, target) + (roll(X, 'sd', w.a, w.b) % (G.war.rnd + 1));
  const win = sa > sd ? att : def, lose = win === att ? def : att, lost = win === att ? target : src;
  const close = siteNear(X, target) || siteNear(X, src);
  if (close) push(X, E['war.battle'], win, lose, target.id, -1);
  const O = G.war.outcome, r = roll(X, 'out', w.a, w.b) % (O.taken + O.razed + O.tribute);
  if (r >= O.taken + O.razed) { if (close) push(X, E['civ.tribute'], lose, win, lost.id, -1); return; }
  X.liveN[lose]--;
  if (r < O.taken) { setSite(X, lost, win, lost.size > 0 ? lost.size - 1 : 0); X.liveN[win]++; if (siteNear(X, lost)) push(X, E['site.taken'], win, lose, lost.id, -1); }
  else { setSite(X, lost, null, lost.size); if (siteNear(X, lost)) push(X, E['site.razed'], win, lose, lost.id, -1); }
  if (X.liveN[lose] <= 0) {
    if (X.reach[lose] || siteNear(X, lost)) push(X, E['civ.fell'], lose, win, lost.id, 0);
    for (const o of [...X.open.values()]) if (o.a === lose || o.b === lose) endWar(X, o, false);
  }
}

// ---- the steps ------------------------------------------------------------------------------------------------
/** Contact gaps between living civs (2.3 step 2: claim edges within G.contact regions, scaled). */
function gaps(X) {
  const C = X.C, gap = new Int32Array(C * C).fill(1 << 20);
  const S = X.sites.filter((p) => p.civ !== null && X.alive(p.civ));
  for (let i = 0; i < S.length; i++) {
    const p = S[i], rp = rad(X, p.size);
    for (let j = i + 1; j < S.length; j++) {
      const t = S[j];
      if (t.civ === p.civ) continue;
      const g = cheb(p, t) - rp - rad(X, t.size), k = p.civ < t.civ ? p.civ * C + t.civ : t.civ * C + p.civ;
      if (g < gap[k]) gap[k] = g;
    }
  }
  return gap;
}
function warsStep(X) {
  const { C, civs } = X, gap = gaps(X), cr = Math.round(G.contact * X.sc);
  for (let a = 0; a < C; a++) {
    if (!X.alive(a)) continue;
    for (let b = a + 1; b < C; b++) {
      if (!X.alive(a)) break;
      if (!X.alive(b)) continue;
      const full = X.near[a] || X.near[b];
      if (!full && X.q !== 0) continue;
      const key = `${a}:${b}`, w = X.open.get(key);
      if (w) {
        if (X.Y - w.began >= G.war.lenMin && pm(X, 'end', a, b) < (full ? TICK.end : TICK.endYear)) { endWar(X, w); continue; }
        if (pm(X, 'battle', a, b) < (full ? TICK.battle : TICK.battleYear)) battle(X, w);
        continue;
      }
      if (gap[a * C + b] > cr || X.open.size >= G.caps.wars) continue;
      if (X.last.has(key) && X.Y - X.last.get(key) < G.war.cooldown) continue;
      const rel = relStatic(X.R, a, b) + TICK.amity;
      if (rel >= 0) continue;
      const ka = (AGGR[civs[a].kind] | 0) + (AGGR[civs[b].kind] | 0);
      // history's yearly chance (-rel / perRel) * (1 + ka / 2), in permille; a quarter of it a season
      const yearly = Math.floor((-rel * 1000 * (2 + ka)) / (2 * G.war.perRel));
      if (pm(X, 'war', a, b) < (full ? Math.floor(yearly / 4) : yearly)) declare(X, a, b);
    }
  }
}
function deathsStep(X) {
  const F = X.R.tables.figures || [], d = X.sr.dead;
  for (const f of F) {
    if (!f || f.died !== null || f.born > X.Y || deadSince(X.sr, f.id)) continue;
    const [, old, max] = life(f.people), age = X.Y - f.born;
    if (age < old) continue;
    // history's death age is uniform on [old, max]: the hazard at `age` is 1 / (max - age + 1) a year
    if (age < max && pm(X, 'die', f.id) >= Math.floor(1000 / ((max - age + 1) * SEASONS.length))) continue;
    while (d.length <= f.id >> 5) d.push(0);
    d[f.id >> 5] = (d[f.id >> 5] | (1 << (f.id & 31))) >>> 0;
    const home = Number.isInteger(f.home) && X.sites[f.home] ? X.sites[f.home] : null;
    const notable = f.role === 'ruler' || f.role === 'hero' || (f.ren | 0) > 0;
    if (notable && ((home && siteNear(X, home)) || (Number.isInteger(f.civ) && X.reach[f.civ] && f.role === 'ruler')))
      push(X, E['fig.died'], f.id, Number.isInteger(f.civ) ? f.civ : NONE, home ? home.id : NONE, DEATH.age);
  }
}
/** The civs the hold can reach (living, a site within TICK.news travel days), by id. */
const reachable = (X) => { const out = []; for (let c = 0; c < X.C; c++) if (X.reach[c] && X.alive(c)) out.push(c); return out; };
function deedsStep(X) {
  const s = X.s, ev = X.sr.ev;
  let base = ev.find((r) => Array.isArray(r) && r[1] === HOLD_EV.base);
  if (!base) {
    // a hold in its first season counts its deeds from 0; one that gained a world later (9.4) from now on
    const first = X.day <= DAYS_PER_SEASON;
    base = [0, HOLD_EV.base, ...HOLD_DEEDS.map((h) => (first ? 0 : counted(s, h.key))), 0];
    while (base.length < 7) base.push(0);
    ev.unshift(base);
  }
  const civs = reachable(X);
  HOLD_DEEDS.forEach((h, k) => {
    const now = counted(s, h.key), was = base[2 + k] | 0, n = now - was;
    base[2 + k] = now;
    if (n <= 0) return;
    const rows = n > TICK.deedMax ? TICK.deedMax : n;
    for (let i = 0; i < rows; i++) push(X, h.type, NONE, NONE, NONE, n, EV_FLAG.hold);
    X.out.deeds += rows;
    for (const c of civs) {
      const eth = X.civs[c].eth || [];
      let v = 0;
      for (const [axis, sign] of h.axes) v += sign * (eth[ETHIC_AXES.indexOf(axis)] | 0) * TICK.deedPer;
      if (v > TICK.deedCap) v = TICK.deedCap; else if (v < -TICK.deedCap) v = -TICK.deedCap;
      if (v) addGoodwill(s, factionOfCiv(s, c), v * rows);
    }
  });
}
function renownStep(X) {
  const s = X.s, known = s.colony && s.colony.renown && Array.isArray(s.colony.renown.known) ? s.colony.renown.known.length : 0;
  const K = TICK.renown, gain = known * K.perKnown > K.max ? K.max : known * K.perKnown;
  if (!gain) return;
  for (const c of reachable(X)) {
    const f = factionOfCiv(s, c), g = goodwill(s, f);
    if (g < K.ceiling) addGoodwill(s, f, g + gain > K.ceiling ? K.ceiling - g : gain);
  }
}
/** Keep s.realm.ev at TICK.evCap rows and the deltas under REALM_DELTA_CAP: fold the oldest rows into the summary. */
export function capDeltas(sr) {
  const ev = sr.ev, meta = (r) => r[1] === HOLD_EV.base || r[1] === HOLD_EV.summary;
  const over = () => ev.filter((r) => !meta(r)).length > TICK.evCap || deltaBytes(sr) > REALM_DELTA_CAP - TICK.byteHead;
  if (!over()) return 0;
  let sum = ev.find((r) => r[1] === HOLD_EV.summary);
  if (!sum) { sum = [0, HOLD_EV.summary, 0, NONE, NONE, 0, 0]; ev.splice(ev[0] && ev[0][1] === HOLD_EV.base ? 1 : 0, 0, sum); }
  let folded = 0;
  while (over()) {
    const k = ev.findIndex((r) => !meta(r));
    if (k < 0) {
      // nothing left to fold: prune the oldest delta wars that ended long ago
      const w = sr.wars.findIndex((d) => d[3] !== null && sr.year - d[3] >= TICK.warKeep);
      if (w < 0) break;
      sr.wars.splice(w, 1);
      continue;
    }
    const r = ev[k];
    if (!sum[2]) sum[0] = r[0];
    sum[2]++; sum[5] = r[0];
    ev.splice(k, 1);
    folded++;
  }
  return folded;
}

/** One season step of the world for hold s with record R (exported for the tests and the bench). */
export function seasonStep(s, R) {
  const X = context(s, R);
  warsStep(X);
  deathsStep(X);
  deedsStep(X);
  renownStep(X);
  capDeltas(X.sr);
  return X.out;
}

/**
 * The tick system (slot 'colony'): at each season's first tick, the year, then the world step when the record is
 * loaded. Returns the step's counts, or null when nothing ran. A realm-less hold returns at once.
 */
export function realmTickSystem(s) {
  if (!s.realm || s.tick <= 0 || s.tick % SEASON_TICKS !== 0) return null;
  const sr = s.realm;
  for (const k of ['sites', 'wars', 'dead', 'ev']) if (!Array.isArray(sr[k])) sr[k] = [];
  const y = yearAt(sr, s.tick);
  if (y > (sr.year | 0)) sr.year = y;
  const R = realmRec(s);
  return R ? seasonStep(s, R) : null;
}

/** Register the season tick (idempotent). colony/index.js calls it (W3.8 request to K) with the Z2 systems. */
export function installRealmTick() {
  if (!tickSystems().some((x) => x.slot === 'colony' && x.name === 'realmtick')) registerSystem('colony', 'realmtick', realmTickSystem, 104);
}
