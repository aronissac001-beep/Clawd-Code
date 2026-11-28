// World history (EMBERCROWN-WORLD.md 1.2 step 9, 2.1-2.4; owner L). The yearly loop of 2.3 over a realm whose
// fields are built (gen.js steps 1-8): growth, contact and grievance, war and peace, rulers and succession, the
// Hollowing, plagues and famines, pacts; then the roads of step 10 (roads.js). W3.1b: figures' births, deeds and
// deaths, beasts and artifacts (2.3 steps 5, 6, 10; 2.5) run in figures.js and beasts.js from the hooks here,
// on their own streams ('figures', 'beasts'), and reach this module's helpers through H.fx.
//
//   for (const p of historyGen(realm)) ...   // yields { phase: 'history', year, of } every 25 years
//   runHistory(realm, reroll)                 // the same, run to the end; writes realm.tables, events, years and
//                                             // the site, owner and road layers (wild is W3.1b's)
//   settleHistory(realm)                      // runHistory with the re-rolls of 1.4, warnings on the realm
//   checkHistory(realm)                       // the history guarantees of 1.4: [{ rule, detail }]
//
// Determinism: every draw comes from the private 'history' stream (fields.js stream, re-roll index r), never s.rng;
// civs run in id order, sites in id order, ties break by id or region index; only + - * / and integer ops
// (tools/check-mapgen.mjs lints this file). The sim never reads the event log, so the log cap cannot change outcomes.
import { HISTORY_GEN, HISTORY_PEOPLES, CIVKINDS, START_PEOPLE } from '../../data/realm/civkinds.js';
import { REL } from '../../data/realm/ethics.js';
import { EVENT_TYPES, EVENT_INDEX as E, EVENT_BYTES, NONE, DEATH, WAR_OUTCOME } from '../../data/realm/events.js';
import { CIV_COUNT, GEN } from '../../data/realm/params.js';
import { DATA as NAMES } from '../../data/names.js';
import { stream, gen, ri, rf, isqrt } from './fields.js';
import { PEOPLES, fitField, ethicOf, ethicDistance, sharedHome, civName, siteName, oathOf, siteKind, rosterOf, placeCapital, SITE_KIND_INDEX } from './civs.js';
import { roadsStep } from './roads.js';
import { initFigures, founders, yearFigures, kill, heroWeight, battleDeaths, plagueDeaths, siteRuined } from './figures.js';
import { initBeasts, yearBeasts } from './beasts.js';
import { startFits } from './query.js';
import { bandOf } from './biomes.js';

export const HISTORY_V = 1;
const G = HISTORY_GEN;
const NAME_ROWS = Object.fromEntries(NAMES.names.map((r) => [r.id, r]));
const cheb = (a, b) => { const dx = a.x > b.x ? a.x - b.x : b.x - a.x, dy = a.y > b.y ? a.y - b.y : b.y - a.y; return dx > dy ? dx : dy; };
const live = (s) => s.razed === null && s.civ !== null;
const AGGR = Object.fromEntries(CIVKINDS.map((k) => [k.id, k.aggr]));

// ---- the context ---------------------------------------------------------------------------------------------
function context(realm, reroll) {
  const n = realm.n, N = n * n, sc = n / 64, P = realm.params, C = Math.min(G.caps.civsMax, CIV_COUNT[P.peoples] + G.caps.civsExtra);
  const fit = {};
  for (const p of PEOPLES) fit[p] = fitField(realm, p);
  const evCap = G.caps.events;
  return {
    realm, n, N, sc, R: gen(stream('history', realm.seed, reroll)), reroll, year: 0, Y: P.history, C,
    civs: [], sites: [], figures: [], wars: [], names: new Set(), fit,
    siteAt: new Uint16Array(N), claim: new Uint8Array(N), claimD: new Uint8Array(N), claimDirty: true,
    gap: new Int16Array(C * C), gapDirty: true, dist: new Int16Array(C * C), share: new Uint8Array(C * C),
    grief: new Int16Array(C * C), amity: new Uint8Array(C * C), war: new Int16Array(C * C), peace: new Int16Array(C * C).fill(-999),
    liveN: new Int16Array(C), dieAt: [], aggr: [], warEnd: [], cause: new Int32Array(C * C).fill(-1),
    siteCap: Math.round(G.caps.sites * sc * sc), rings: new Int8Array(realm.falls.length), fallR: realm.falls.map((f) => isqrt(f.r2)),
    ev: new DataView(new ArrayBuffer(evCap * EVENT_BYTES)), evN: 0, evCap, lastEv: -1,
  };
}
const pair = (H, a, b) => (a < b ? a * H.C + b : b * H.C + a);
const rad = (H, s) => Math.max(1, Math.round(G.claim[s.size] * H.sc));

/** Append an event row (2.4); returns its index, or -1 when the cap rules drop it. */
function log(H, type, a = NONE, b = NONE, site = NONE, arg = 0, flags = 0) {
  const imp = EVENT_TYPES[type].imp, k = H.evN;
  if (k >= H.evCap || (imp === 0 && k >= G.logFloor[0]) || (imp === 1 && k >= G.logFloor[1])) { H.lastEv = -1; return -1; }
  const dv = H.ev, o = k * EVENT_BYTES;
  dv.setInt16(o, H.year, true); dv.setUint8(o + 2, type); dv.setUint8(o + 3, flags);
  dv.setUint16(o + 4, a, true); dv.setUint16(o + 6, b, true); dv.setUint16(o + 8, site, true); dv.setInt16(o + 10, arg, true);
  H.evN = k + 1; H.lastEv = k;
  return k;
}

// ---- sites ---------------------------------------------------------------------------------------------------
function addSite(H, kind, i, civ, size) {
  const s = { id: H.sites.length, kind, x: i % H.n, y: (i - (i % H.n)) / H.n, civ, size, founded: H.year, razed: null, name: siteName(H) };
  H.sites.push(s);
  H.siteAt[i] = s.id + 1;
  if (civ !== null) { H.liveN[civ]++; H.claimDirty = true; H.gapDirty = true; }
  return s;
}
/** A living site leaves its civ: razed (a ruin) or taken by `to`. Checks the loser's fall. */
function loseSite(H, s, to, how, byCiv, warId) {
  const from = s.civ;
  H.liveN[from]--; H.claimDirty = true; H.gapDirty = true;
  if (how === 'taken') {
    s.civ = to; s.size = s.size > 0 ? s.size - 1 : 0; s.kind = siteKind(H.civs[to].people, s.size); H.liveN[to]++;
    log(H, E['site.taken'], to, from, s.id, warId);
    addGrief(H, to, from, REL.grief.taken);
  } else {
    s.was = s.kind; s.kind = 'ruin'; s.civ = null; s.razed = H.year; s.by = byCiv;
    if (how === 'razed') { log(H, E['site.razed'], byCiv, from, s.id, warId); addGrief(H, byCiv, from, REL.grief.razed); }
    siteRuined(H, s);   // 2.3 step 10: artifacts kept there are lost there
  }
  const c = H.civs[from];
  if (!H.liveN[from]) civFalls(H, c, byCiv === null ? NONE : byCiv);
  else if (c.cap === s.id) recapital(H, c);
}
function recapital(H, c) {
  let best = null;
  for (const s of H.sites) if (live(s) && s.civ === c.id && (!best || s.size > best.size)) best = s;
  if (best) c.cap = best.id;
}
function rebuildClaims(H) {
  if (!H.claimDirty) return;
  const { n, claim, claimD } = H;
  claim.fill(0); claimD.fill(255);
  for (const s of H.sites) {
    if (!live(s)) continue;
    const r = rad(H, s);
    for (let y = s.y - r; y <= s.y + r; y++) {
      if (y < 0 || y >= n) continue;
      for (let x = s.x - r; x <= s.x + r; x++) {
        if (x < 0 || x >= n) continue;
        const j = y * n + x, dx = x > s.x ? x - s.x : s.x - x, dy = y > s.y ? y - s.y : s.y - y, d = dx > dy ? dx : dy;
        if (d < claimD[j]) { claimD[j] = d; claim[j] = s.civ + 1; }
      }
    }
  }
  H.claimDirty = false;
}
/**
 * The civ-pair gap matrix (2.3 step 2): the least of Chebyshev distance minus both claim radii over their living
 * sites. Only gaps up to the contact range matter (contact, and overlap for `compete`), so sites are bucketed in
 * cells of that reach and only neighbouring buckets are compared; a pair farther apart keeps 999.
 */
function rebuildGaps(H) {
  if (!H.gapDirty) return;
  H.gap.fill(999);
  const B = Math.round(G.contact * H.sc) + 2 * Math.max(1, Math.round(G.claim[5] * H.sc)) + 1, nb = Math.floor((H.n + B - 1) / B);
  const cells = new Array(nb * nb);
  for (const s of H.sites) if (live(s)) { const c = Math.floor(s.y / B) * nb + Math.floor(s.x / B); (cells[c] || (cells[c] = [])).push(s); }
  for (let c = 0; c < cells.length; c++) {
    const A = cells[c];
    if (!A) continue;
    const cx = c % nb, cy = (c - cx) / nb;
    for (let dy = 0; dy <= 1; dy++) for (let dx = dy ? -1 : 0; dx <= 1; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || x >= nb || y >= nb) continue;
      const Bc = cells[y * nb + x];
      if (!Bc) continue;
      const same = Bc === A;
      for (let p = 0; p < A.length; p++) {
        const a = A[p], ra = rad(H, a);
        for (let q = same ? p + 1 : 0; q < Bc.length; q++) {
          const b = Bc[q];
          if (a.civ === b.civ) continue;
          const g = cheb(a, b) - ra - rad(H, b), k = pair(H, a.civ, b.civ);
          if (g < H.gap[k]) H.gap[k] = g;
        }
      }
    }
  }
  H.gapDirty = false;
}
/** The taint of region i with the Hollowing's rings applied (2.3 step 7). */
function taintAt(H, i) {
  const { n, realm } = H, x = i % n, y = (i - x) / n;
  let t = realm.fields.taint[i], add = 0;
  realm.falls.forEach((f, k) => {
    const ring = H.rings[k], dx = x - f.x, dy = y - f.y, d2 = dx * dx + dy * dy;
    if (ring > 0) { const R = H.fallR[k] + Math.round(ring * H.sc); if (d2 < R * R && G.hollow.perRing * ring > add) add = G.hollow.perRing * ring; }
    else if (ring < 0 && d2 < f.r2 && G.hollow.perRing * ring < add) add = G.hollow.perRing * ring;
  });
  t += add;
  return t < 0 ? 0 : t;
}
/** A daughter site of s in the best free region within grow.reach (2.3 step 1), or null. */
function daughter(H, s) {
  if (H.sites.length >= H.siteCap) return null;
  rebuildClaims(H);
  const { n, siteAt, claim } = H, c = H.civs[s.civ], fit = H.fit[c.people], R = Math.max(2, Math.round(G.grow.reach * H.sc)), gp = G.grow.gap;
  let best = -1, bs = -1e9;
  for (let y = s.y - R; y <= s.y + R; y++) {
    if (y < 0 || y >= n) continue;
    for (let x = s.x - R; x <= s.x + R; x++) {
      if (x < 0 || x >= n) continue;
      const j = y * n + x;
      if (!fit[j] || (claim[j] && claim[j] !== c.id + 1)) continue;
      let crowded = false;
      for (let yy = y - gp; yy <= y + gp && !crowded; yy++) for (let xx = x - gp; xx <= x + gp; xx++) if (xx >= 0 && yy >= 0 && xx < n && yy < n && siteAt[yy * n + xx]) { crowded = true; break; }
      if (crowded || taintAt(H, j) > G.grow.taintMax) continue;
      const dx = x > s.x ? x - s.x : s.x - x, dy = y > s.y ? y - s.y : s.y - y;
      const sc = fit[j] * 10 - (dx > dy ? dx : dy) + rf(H.R) * 3;
      if (sc > bs) { bs = sc; best = j; }
    }
  }
  if (best < 0) return null;
  const d = addSite(H, siteKind(c.people, 0), best, c.id, 0);
  log(H, E['site.founded'], c.id, s.id, d.id, SITE_KIND_INDEX[d.kind]);
  return d;
}

// ---- figures (rulers here; the rest in figures.js) ---------------------------------------------------------------
function lifespan(people) { return (HISTORY_PEOPLES[people] || HISTORY_PEOPLES.human).lifespan; }
/** A new ruler of civ c (2.3 step 4): a bare figure row. `parent` is the kin heir's parent figure, or -1. Returns its id or -1. */
function crown(H, c, parent) {
  if (H.figures.length >= G.caps.figures) return -1;
  const [adult, old, max] = lifespan(c.people), y = H.year, nr = NAME_ROWS[c.people] || NAME_ROWS.human;
  let born = y - adult - ri(H.R, 0, 25);
  if (parent >= 0) { const lo = H.figures[parent].born + adult; if (born < lo) born = lo; }
  const id = H.figures.length;
  H.figures.push({ id, people: c.people, sex: ri(H.R, 0, 1), born, died: null, civ: c.id, role: 'ruler',
    nm: [ri(H.R, 0, nr.first.length - 1), ri(H.R, 0, nr.family.length - 1)], deeds: [], kin: [parent, -1], home: c.cap, ren: 0 });
  let die = born + old + ri(H.R, 0, max - old);
  if (die <= y) die = y + 1 + ri(H.R, 0, 4);
  H.dieAt[id] = die; H.aggr[id] = ri(H.R, 0, 99) < G.ruler.aggrPct ? 1 : 0;
  c.rulers.push(id);
  return id;
}
const rulerOf = (H, c) => { const r = c.rulers.length ? c.rulers[c.rulers.length - 1] : -1; return r >= 0 && H.figures[r].died === null ? r : -1; };
/** A ruler dies at home (the caller runs the succession). */
function dies(H, f, cause) { kill(H, f, cause, f.home, null, false); }
/** Succession after ruler r of c died (2.3 step 4): a kin heir, else a crisis that may split the civ. */
function succeed(H, c, r) {
  const [adult] = lifespan(c.people), canHeir = H.figures[r].born + 2 * adult <= H.year;
  if (canHeir && ri(H.R, 0, 99) < G.ruler.heirPct) {
    const h = crown(H, c, r);
    if (h >= 0) log(H, E['civ.crowned'], c.id, h, c.cap);
    return;
  }
  log(H, E['civ.crisis'], c.id, r);
  if (ri(H.R, 0, 99) < G.ruler.splitPct && H.liveN[c.id] >= G.ruler.splitMin && H.civs.length < H.C) split(H, c);
  const h = crown(H, c, -1);
  if (h >= 0) log(H, E['civ.crowned'], c.id, h, c.cap);
}
/** A succession crisis splits c: a new civ of the same people takes the outer half of its sites. */
function split(H, c) {
  const cap = H.sites[c.cap], mine = H.sites.filter((s) => live(s) && s.civ === c.id && s.id !== c.cap);
  mine.sort((p, q) => cheb(q, cap) - cheb(p, cap) || p.id - q.id);
  const take = mine.slice(0, mine.length >> 1);
  if (!take.length) return;
  const d = newCiv(H, c.people, c.kind, null, c.id);
  for (const s of take) { s.civ = d.id; H.liveN[c.id]--; H.liveN[d.id]++; }
  let best = take[0];
  for (const s of take) if (s.size > best.size) best = s;
  d.cap = best.id;
  H.claimDirty = true; H.gapDirty = true;
  log(H, E['civ.split'], d.id, c.id, d.cap);
  addGrief(H, d.id, c.id, REL.grief.split);
  const h = crown(H, d, -1);
  if (h >= 0) log(H, E['civ.crowned'], d.id, h, d.cap);
  founders(H, d);
}

// ---- civs ----------------------------------------------------------------------------------------------------
function newCiv(H, people, kind, capIdx, parent = null) {
  const id = H.civs.length, ki = typeof kind === 'number' ? kind : CIVKINDS.findIndex((k) => k.id === kind);
  const c = { id, people, kind: CIVKINDS[ki].id, name: civName(H, people, ki), eth: ethicOf(H, people), cap: -1, founded: H.year, fell: null,
    rulers: [], pacts: [], oath: oathOf(H), parent, herald: ri(H.R, 0, 0xffff) };
  H.civs.push(c);
  for (const o of H.civs) {
    if (o === c) continue;
    const k = pair(H, o.id, id);
    H.dist[k] = ethicDistance(o.eth, c.eth); H.share[k] = sharedHome(o.people, people) ? 1 : 0;
  }
  if (capIdx !== null) c.cap = addSite(H, siteKind(people, 2), capIdx, id, 2).id;
  return c;
}
function civFalls(H, c, enemy) {
  c.fell = H.year;
  log(H, E['civ.fell'], c.id, enemy, c.cap);
  for (const w of H.wars) if (w.ended === null && (w.a === c.id || w.b === c.id)) endWar(H, w, w.a === c.id ? WAR_OUTCOME.bWon : WAR_OUTCOME.aWon);
  for (const o of c.pacts) { const oc = H.civs[o]; oc.pacts = oc.pacts.filter((x) => x !== c.id); }
  c.pacts = [];
}
function addGrief(H, a, b, v) {
  if (a === null || b === null || a === NONE || b === NONE || a === b) return;
  const k = pair(H, a, b), g = H.grief[k] + v;
  H.grief[k] = g > REL.griefMax ? REL.griefMax : g;
  if (H.lastEv >= 0) H.cause[k] = H.lastEv;
}
/** rel of 2.3 step 2 between living civs a and b. */
export function relOf(H, a, b) {
  const k = pair(H, a, b), pact = H.civs[a].pacts.includes(b) ? REL.pact : 0;
  return REL.base - REL.perDist * H.dist[k] + (H.share[k] ? REL.sharedHome : 0) + pact + H.amity[k] - (H.gap[k] <= 0 ? REL.compete : 0) - H.grief[k];
}

// ---- war -----------------------------------------------------------------------------------------------------
function declare(H, a, b) {
  const k = pair(H, a, b), A = H.civs[a], B = H.civs[b], cause = H.cause[k];
  if (A.pacts.includes(b)) {
    A.pacts = A.pacts.filter((x) => x !== b); B.pacts = B.pacts.filter((x) => x !== a);
    log(H, E['civ.oathBroken'], a, b, NONE, A.oath % 32768);
    addGrief(H, a, b, REL.grief.oath);
  }
  const w = { id: H.wars.length, a, b, began: H.year, ended: null, cause, outcome: WAR_OUTCOME.ongoing };
  H.wars.push(w);
  H.warEnd[w.id] = H.year + G.war.lenMin + ri(H.R, 0, G.war.lenRnd - 1);
  H.war[k] = w.id + 1; H.amity[k] = 0;
  log(H, E['war.declared'], a, b, NONE, w.id);
}
function endWar(H, w, outcome) {
  const k = pair(H, w.a, w.b);
  w.ended = H.year; w.outcome = outcome; H.war[k] = 0; H.peace[k] = H.year;
  if (outcome === WAR_OUTCOME.treaty) log(H, E['war.treaty'], w.a, w.b, NONE, w.id);
}
function strength(H, c, t) {
  const R = Math.max(2, Math.round(G.war.front * H.sc));
  let v = 0;
  for (const s of H.sites) if (live(s) && s.civ === c && cheb(s, t) <= R) v += s.size + 1;
  return v;
}
/** A defender's ground and capital bonus at site t. */
function hold(H, t) {
  const R = H.realm;
  const c = H.civs[t.civ];
  return G.war.ground[bandOf(R.fields.elev[t.y * H.n + t.x], R.bands)] + (c.cap === t.id ? G.war.capital : 0) + (HISTORY_PEOPLES[c.people].guard || 0);
}
/** The living site of civ c nearest any living site of civ o: [site, nearest of o] or null. */
function front(H, c, o) {
  let best = null, bd = 1e9;
  const A = [], B = [];
  for (const s of H.sites) if (live(s)) { if (s.civ === c) A.push(s); else if (s.civ === o) B.push(s); }
  for (const s of A) for (const t of B) { const d = cheb(s, t); if (d < bd) { bd = d; best = [s, t]; } }
  return best;
}
/** A battlefield site in a free region next to t, unless one lies within 2 already (or the cap is near). */
function battlefield(H, t) {
  if (H.sites.length >= H.siteCap - 4) return;
  for (const s of H.sites) if (s.kind === 'battlefield' && cheb(s, t) <= 2) return;
  const { n } = H;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = t.x + dx, y = t.y + dy;
    if ((!dx && !dy) || x < 0 || y < 0 || x >= n || y >= n) continue;
    const j = y * n + x;
    if (H.siteAt[j] || H.realm.fields.elev[j] < H.realm.seaLevel) continue;
    addSite(H, 'battlefield', j, null, 0);
    return;
  }
}
function battle(H, w) {
  const att = ri(H.R, 0, 1) ? w.a : w.b, def = att === w.a ? w.b : w.a, fr = front(H, def, att);
  if (!fr) return;
  const [target, src] = fr;
  const sa = strength(H, att, target) + heroWeight(H, att) + rf(H.R) * G.war.rnd, sd = strength(H, def, target) + heroWeight(H, def) + 1 + hold(H, target) + rf(H.R) * G.war.rnd;
  const win = sa > sd ? att : def, lose = win === att ? def : att, lost = win === att ? target : src;
  log(H, E['war.battle'], win, lose, target.id, w.id);
  battlefield(H, target);
  const O = G.war.outcome, roll = ri(H.R, 0, O.taken + O.razed + O.tribute - 1);
  if (roll < O.taken) loseSite(H, lost, win, 'taken', win, w.id);
  else if (roll < O.taken + O.razed) loseSite(H, lost, null, 'razed', win, w.id);
  else { log(H, E['civ.tribute'], lose, win, lost.id, w.id); addGrief(H, win, lose, REL.grief.tribute); }
  battleDeaths(H, win, lose, target);   // 2.3 step 5: heroes die in battle
}

// ---- the yearly loop -----------------------------------------------------------------------------------------
function yearStep(H, roster) {
  const y = H.year;
  // founding (the roster's later civs arrive over the first decades)
  for (const r of roster) if (r.year === y) {
    const i = placeCapital(H, r.people);
    if (i < 0) continue;
    const c = newCiv(H, r.people, r.kind, i);
    const f = crown(H, c, -1);
    log(H, E['civ.founded'], c.id, f < 0 ? NONE : f, c.cap);
    founders(H, c);
  }
  // 1. growth
  const S = H.sites.length;
  for (let k = 0; k < S; k++) {
    const s = H.sites[k];
    if (!live(s)) continue;
    const c = H.civs[s.civ], fit = H.fit[c.people][s.y * H.n + s.x], cap = G.grow.capByFit[fit >= 3 ? 3 : fit | 0];
    if (s.size < cap) {
      if (rf(H.R) < G.grow.base + G.grow.perFit * fit) {
        s.size++; s.kind = siteKind(c.people, s.size);
        if (G.claim[s.size] !== G.claim[s.size - 1]) { H.claimDirty = true; H.gapDirty = true; }
        log(H, E['site.grew'], c.id, NONE, s.id, s.size);
      }
    } else if (rf(H.R) < G.grow.daughter) daughter(H, s);
  }
  // 2-3. contact, grievance, war and pacts
  rebuildGaps(H);
  const civs = H.civs, cr = Math.round(G.contact * H.sc);
  for (let a = 0; a < civs.length; a++) {
    if (civs[a].fell !== null) continue;
    for (let b = a + 1; b < civs.length; b++) {
      if (civs[b].fell !== null) continue;
      const k = pair(H, a, b);
      if (H.grief[k] > 0) H.grief[k] -= REL.griefFade;
      if (H.gap[k] > cr || H.war[k]) continue;
      if (H.amity[k] < REL.amityMax) H.amity[k] += REL.amityRate;
      const rel = relOf(H, a, b);
      if (rel < 0 && H.wars.length < G.caps.wars && y - H.peace[k] >= G.war.cooldown) {
        const ka = AGGR[civs[a].kind] + AGGR[civs[b].kind];
        const ra = rulerOf(H, civs[a]), rb = rulerOf(H, civs[b]), agg = (ra >= 0 && H.aggr[ra]) || (rb >= 0 && H.aggr[rb]) ? 2 : 1;
        if (rf(H.R) < (-rel / G.war.perRel) * (1 + ka / 2) * agg) declare(H, a, b);
      } else if (rel > G.pact.rel && !civs[a].pacts.includes(b) && rf(H.R) < G.pact.chance) {
        civs[a].pacts.push(b); civs[b].pacts.push(a);
        log(H, E['civ.pact'], a, b, NONE, civs[a].oath % 32768);
        log(H, E['civ.oathSworn'], b, a, NONE, civs[a].oath % 32768);
      }
    }
  }
  for (const w of H.wars) {
    if (w.ended !== null) continue;
    if (y >= H.warEnd[w.id]) { endWar(H, w, WAR_OUTCOME.treaty); continue; }
    const nb = ri(H.R, 0, G.war.battlesMax);
    for (let k = 0; k < nb && w.ended === null; k++) battle(H, w);
  }
  // 4. rulers
  for (const c of civs) {
    if (c.fell !== null) continue;
    const r = rulerOf(H, c);
    if (r < 0) { const h = crown(H, c, -1); if (h >= 0) log(H, E['civ.crowned'], c.id, h, c.cap); continue; }
    if (y >= H.dieAt[r]) { dies(H, H.figures[r], DEATH.age); succeed(H, c, r); }
  }
  // 5. figures: coming of age, births, deeds (2.5) and deaths (figures.js)
  yearFigures(H);
  // 6. beasts (beasts.js)
  yearBeasts(H);
  // 7. the Hollowing
  for (let k = 0; k < H.rings.length; k++) {
    const u = rf(H.R), Ho = G.hollow;
    if (u < Ho.advance && H.rings[k] < Ho.ringMax) {
      H.rings[k]++;
      log(H, E['world.hollowAdvanced'], NONE, NONE, NONE, k);
      for (const s of H.sites) if (live(s) && taintAt(H, s.y * H.n + s.x) > Ho.falls) { const c = s.civ; log(H, E['site.hollowed'], c, NONE, s.id, k); loseSite(H, s, null, 'hollow', null, NONE); }
    } else if (u >= Ho.advance && u < Ho.advance + Ho.recede && H.rings[k] > Ho.ringMin) {
      H.rings[k]--;
      log(H, E['world.hollowReceded'], NONE, NONE, NONE, k);
    }
  }
  // 8. plagues and famines
  for (const c of civs) {
    if (c.fell !== null) continue;
    if (rf(H.R) < G.plague) {
      let killed = 0;
      for (const s of H.sites) if (live(s) && s.civ === c.id && s.size > 0) { s.size--; s.kind = siteKind(c.people, s.size); H.claimDirty = true; H.gapDirty = true; }
      const r = rulerOf(H, c);
      if (r >= 0 && ri(H.R, 0, 3) === 0) { killed = 1; dies(H, H.figures[r], DEATH.plague); succeed(H, c, r); }
      killed += plagueDeaths(H, c);
      log(H, E['world.plague'], c.id, NONE, c.cap, killed);
    }
    if (rf(H.R) < G.famine) {
      let best = null;
      for (const s of H.sites) if (live(s) && s.civ === c.id && (!best || s.size > best.size)) best = s;
      if (best && best.size > 0) { best.size--; best.kind = siteKind(c.people, best.size); H.claimDirty = true; H.gapDirty = true; }
      log(H, E['world.famine'], c.id, NONE, best ? best.id : NONE);
    }
  }
  // 9. pacts were signed above; their roads are laid at the end (step 10).
}

/** The opening roster with founding years: the first 4 civs at year 0, the rest over the first 30 years. */
function rosterYears(H) {
  const count = CIV_COUNT[H.realm.params.peoples];
  return rosterOf(H, count).map((r, k) => ({ ...r, year: k < 4 ? 0 : ri(H.R, 0, 30) }));
}

/**
 * The history of a realm (step 9, then the roads of step 10): a generator yielding { phase: 'history', year, of }
 * every 25 years. Writes realm.tables (civs, sites, figures, beasts, artifacts, wars, roads, hollow), realm.events
 * (a packed Uint8Array of 12-byte rows), realm.years and the site, owner and road layers.
 */
export function* historyGen(realm, reroll = 0) {
  const H = context(realm, reroll), Y = H.Y;
  H.fx = {
    log: (...a) => log(H, ...a), addSite: (...a) => addSite(H, ...a), loseSite: (...a) => loseSite(H, ...a), succeed: (c, r) => succeed(H, c, r),
    addGrief: (a, b, v) => addGrief(H, a, b, v), rulerOf: (c) => rulerOf(H, c), kill: (...a) => kill(H, ...a),
    near: (a, b) => H.gap[pair(H, a, b)] <= Math.round(G.contact * H.sc),
  };
  initFigures(H); initBeasts(H);
  const roster = rosterYears(H);
  log(H, E['world.hollowing'], NONE, NONE, NONE, realm.falls.length);
  for (H.year = 0; H.year <= Y; H.year++) {
    yearStep(H, roster);
    if (H.year % 25 === 0 && H.year < Y) yield { phase: 'history', year: H.year, of: Y };
  }
  H.year = Y;
  finish(H);
  yield { phase: 'history', year: Y, of: Y };
  return realm;
}
function finish(H) {
  const { realm } = H, f = realm.fields;
  H.claimDirty = true; rebuildClaims(H);
  f.owner.set(H.claim);
  f.site.fill(0);
  for (const s of H.sites) f.site[s.y * H.n + s.x] = s.id + 1;
  const friendly = (a, b) => a === b || (H.civs[a].pacts.includes(b) && !H.war[pair(H, a, b)]);
  const roads = roadsStep(realm, H.sites, H.civs, friendly);
  for (const b of H.beasts) delete b.next;
  realm.tables = { civs: H.civs, sites: H.sites, figures: H.figures, beasts: H.beasts, artifacts: H.artifacts, wars: H.wars, roads, hollow: Array.from(H.rings) };
  realm.events = new Uint8Array(H.ev.buffer.slice(0, H.evN * EVENT_BYTES));
  realm.years = H.Y;
}

/** historyGen run to the end. */
export function runHistory(realm, reroll = 0) {
  const it = historyGen(realm, reroll);
  for (;;) { const s = it.next(); if (s.done) return s.value; }
}

/** The history guarantees of 1.4: civs alive, a human civ, every start near a civ of its people. [{ rule, detail }] */
export function checkHistory(realm) {
  const T = realm.tables, fails = [], size = realm.params.size, n = realm.n, N = n * n;
  const alive = T.civs.filter((c) => c.fell === null);
  const need = G.guard.alive[size];
  if (alive.length < need) fails.push({ rule: 'civs', detail: `${alive.length} civs alive, need ${need}` });
  if (!alive.some((c) => c.people === 'human')) fails.push({ rule: 'human', detail: 'no human civ alive' });
  const reach = Math.max(3, Math.round(G.guard.startReach * n / 64));
  for (const st of Object.keys(START_PEOPLE)) {
    const want = START_PEOPLE[st];
    if (want && want.people && !HISTORY_PEOPLES[want.people]) continue;   // the people arrives in W4
    const ok = (c) => c.fell === null && (!want || (want.people ? c.people === want.people : c.kind === want.kind));
    const src = T.sites.filter((s) => s.razed === null && s.civ !== null && ok(T.civs[s.civ]));
    let found = false;
    for (let i = 0; i < N && !found; i++) {
      if (realm.fields.site[i] || !startFits(realm, i, st)) continue;
      const x = i % n, y = (i - x) / n;
      for (const s of src) { const dx = s.x > x ? s.x - x : x - s.x, dy = s.y > y ? s.y - y : y - s.y; if ((dx > dy ? dx : dy) <= reach) { found = true; break; } }
    }
    if (!found) fails.push({ rule: 'start', detail: `no region fits the start ${st} within ${reach} regions of its civ` });
  }
  return fails;
}

/** runHistory with the re-rolls of 1.4 (the history stream with re-roll index r, at most GEN.guarantee.rerolls), then warnings. Returns the re-roll count. */
export function settleHistory(realm) {
  let r = 0, fails;
  for (;;) {
    runHistory(realm, r);
    fails = checkHistory(realm);
    if (!fails.length || r >= GEN.guarantee.rerolls) break;
    r++;
  }
  for (const fl of fails) realm.warnings.push({ rule: 'history.' + fl.rule, detail: fl.detail });
  return r;
}

/** Event row k of a realm's log as an object (for tools, tests and the Annals). */
export function eventAt(realm, k) {
  const ev = realm.events, dv = new DataView(ev.buffer, ev.byteOffset, ev.byteLength), o = k * EVENT_BYTES;
  return { year: dv.getInt16(o, true), type: dv.getUint8(o + 2), key: EVENT_TYPES[dv.getUint8(o + 2)].key, flags: dv.getUint8(o + 3),
    a: dv.getUint16(o + 4, true), b: dv.getUint16(o + 6, true), site: dv.getUint16(o + 8, true), arg: dv.getInt16(o + 10, true) };
}
export const eventCount = (realm) => (realm.events && realm.events.length ? realm.events.length / EVENT_BYTES : 0);

/** The history hash (tests, tools/check-realm.mjs): the tables' JSON, the event rows and the site, owner and road layers, as 8 hex digits. */
export function historyHash(realm) {
  let h = 0x811c9dc5;
  const eat = (bytes) => { for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); } };
  eat(new TextEncoder().encode(JSON.stringify(realm.tables)));
  eat(realm.events);
  for (const k of ['site', 'owner', 'road']) { const a = realm.fields[k]; eat(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
