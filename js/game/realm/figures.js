// Figures, deeds and artifacts of the realm's history (EMBERCROWN-WORLD.md 2.2, 2.3 steps 5 and 10, 2.5; owner L).
// Called by history.js at its hooks, over the history context H; beasts' lairs and roaming are beasts.js.
//
//   initFigures(H)          the figures stream and tables (history.js context)
//   founders(H, c)          the founding figures of a new civ (2 adults at its capital)
//   yearFigures(H)          2.3 step 5: coming of age, deaths of age, births by role need, deeds (2.5)
//   kill(H, f, cause, ...)  a figure dies: the death row, its artifacts pass or are lost, a ruler's succession
//   heroWeight(H, civ)      a civ's heroes' weight in a battle (2.3 step 3); battleDeaths(H, ...) after it
//   plagueDeaths(H, c)      a plague kills 1-3 figures (2.3 step 8)
//   siteRuined(H, s)        2.3 step 10: artifacts kept at a razed site become lost there
//   checkFigures(realm)     the W3.1b oracle by replay of the tables and the log: [{ rule, detail }]
//
// Event first, cause after (2.5): a deed type is picked by the figure's role and the year's state, its slots are
// bound from the state, then a cause is picked from facts true at that moment, in the order avenge, place, duty,
// oath, protect, ambition. The cause goes in the deed row: flags bits 0-2 the CAUSE code, arg its reference (a kin
// figure, the birthplace site, a war, a pact partner civ, a beast; 0 for ambition). The text (W3.2) reads them.
//
// Determinism: draws come from the private 'figures' stream (H.FR), never s.rng or the 'history' stream; figures
// run in id order, candidates are taken in id order and ties break by distance then id. The sim reads f.ren (renown,
// kept in the table), never the log, so the log cap cannot change outcomes. Lint: tools/check-mapgen.mjs.
import { HISTORY_GEN, HISTORY_PEOPLES } from '../../data/realm/civkinds.js';
import { REL } from '../../data/realm/ethics.js';
import { EVENT_TYPES, EVENT_INDEX as E, EVENT_BYTES, NONE, DEATH } from '../../data/realm/events.js';
import { DATA as NAMES } from '../../data/names.js';
import { stream, gen, ri, rf } from './fields.js';

/**
 * The numbers of steps 5 and 10 (G data: HISTORY_GEN.figures in js/data/realm/civkinds.js).
 * deedPct: a living adult's yearly deed chance. target: living figures a civ wants = base + sites / perSites, at most
 * max. reserve: figure rows kept for rulers (per civ slot). pace: births stop past (cap - reserve) * (y + pace) /
 * (years + pace), so the cap spreads over the whole history. far: a death farther than this from home (Chebyshev,
 * scaled) loses the artifacts carried. hunt: a hero hunts a beast whose lair is within reach of home; slay chance
 * = slay + perRen * min(ren, renMax), wound chance `wound`, else the hero dies. art: the forged artifacts' cap at
 * the Standard size (scales by area, at least artMin).
 */
export const FIG = HISTORY_GEN.figures;

/** Cause codes of a deed row (flags bits 0-2; append-only). */
export const CAUSE = Object.freeze({ none: 0, avenge: 1, place: 2, duty: 3, oath: 4, protect: 5, ambition: 6 });
export const CAUSE_KEYS = Object.freeze(Object.keys(CAUSE));
/** The event types that are deeds, and the slot holding the deed's figure. */
export const DEED_SLOT = Object.freeze({
  'fig.slew': 'a', 'fig.forged': 'a', 'fig.found': 'a', 'fig.wed': 'a', 'fig.exiled': 'a', 'fig.wrote': 'a', 'fig.sang': 'a', 'fig.healed': 'a',
  'beast.slain': 'b', 'beast.wounded': 'b',
});

/** Artifacts (G data: HISTORY_GEN.artifacts): kinds, materials, name parts. Stored as ids. */
export const ART = HISTORY_GEN.artifacts;

const NAME_ROWS = Object.fromEntries(NAMES.names.map((r) => [r.id, r]));
const life = (p) => (HISTORY_PEOPLES[p] || HISTORY_PEOPLES.human).lifespan;
const cheb = (a, b) => { const dx = a.x > b.x ? a.x - b.x : b.x - a.x, dy = a.y > b.y ? a.y - b.y : b.y - a.y; return dx > dy ? dx : dy; };
const liveSite = (s) => s && s.razed === null && s.civ !== null;
const alive = (f) => f.died === null;
const adult = (H, f) => f.died === null && H.year >= f.born + life(f.people)[0];
const reach = (H, r) => Math.max(2, Math.round(r * H.sc));
const holderOf = (a) => (a.lost || !a.holders.length ? -1 : a.holders[a.holders.length - 1][0]);

// ---- the context -----------------------------------------------------------------------------------------------
export function initFigures(H) {
  H.FR = gen(stream('figures', H.realm.seed, H.reroll));
  H.artifacts = [];
  H.plagueAt = new Int16Array(H.C).fill(-999);
  H.artCap = Math.max(FIG.artMin, Math.round(FIG.art * H.sc * H.sc));
  H.forged = 0;
}

/** A new figure row (rulers come from history.js crown, which uses the same shape). */
function addFigure(H, c, role, born, home, parent) {
  const R = H.FR, nr = NAME_ROWS[c.people] || NAME_ROWS.human, [, old, max] = life(c.people), id = H.figures.length;
  const f = { id, people: c.people, sex: ri(R, 0, 1), born, died: null, civ: c.id, role, nm: [ri(R, 0, nr.first.length - 1), ri(R, 0, nr.family.length - 1)],
    deeds: [], kin: [parent, -1], home, ren: 0 };
  H.figures.push(f);
  H.dieAt[id] = born + old + ri(R, 0, max - old);
  H.aggr[id] = 0;
  return f;
}
const ruling = (H, f) => f.role === 'ruler' && H.civs[f.civ].fell === null && H.fx.rulerOf(H.civs[f.civ]) === f.id;
const birthCap = (H) => {
  const cap = HISTORY_GEN.caps.figures - FIG.reserve * H.C;
  return (cap * (H.year + FIG.pace)) / (H.Y + FIG.pace);
};

/** The founding figures of civ c: adults at its capital, a hero first. */
export function founders(H, c) {
  const [ad] = life(c.people);
  for (let k = 0; k < FIG.founders; k++) {
    if (H.figures.length >= HISTORY_GEN.caps.figures - FIG.reserve * H.C) return;
    addFigure(H, c, k ? pickRole(H, c, []) : 'hero', H.year - ad - ri(H.FR, 0, 20), c.cap, -1);
  }
}

function pickRole(H, c, mine) {
  const W = FIG.roles, keys = Object.keys(W), w = [];
  let sum = 0;
  const war = civAtWar(H, c.id) >= 0, pact = c.pacts.length > 0, plague = H.year - H.plagueAt[c.id] <= FIG.plagueYears;
  for (const k of keys) {
    let v = W[k];
    if (k === 'hero' && war) v *= 2;
    if (k === 'envoy' && pact) v *= 2;
    if (k === 'priest' && plague) v *= 2;
    let have = 0;
    for (const f of mine) if (f.role === k) have++;
    v = v / (1 + have);
    w.push(v); sum += v;
  }
  let u = rf(H.FR) * sum;
  for (let k = 0; k < keys.length; k++) { u -= w[k]; if (u < 0) return keys[k]; }
  return keys[keys.length - 1];
}
/** The open war of civ a (with civ b, or with anyone when b < 0), lowest id; -1 when none. */
function civAtWar(H, a, b = -1) {
  for (const w of H.wars) if (w.ended === null && (w.a === a || w.b === a) && (b < 0 || w.a === b || w.b === b)) return w.id;
  return -1;
}

// ---- step 5 ----------------------------------------------------------------------------------------------------
export function yearFigures(H) {
  const y = H.year, F = H.figures, civs = H.civs, byCiv = civs.map(() => []);
  for (let i = 0; i < F.length; i++) {
    const f = F[i];
    if (f.died !== null) continue;
    const ad = life(f.people)[0];
    if (y === f.born + ad && f.role !== 'ruler') H.fx.log(E['fig.cameOfAge'], f.id, f.civ);
    if (y >= H.dieAt[f.id] && !ruling(H, f)) { kill(H, f, DEATH.age, f.home, null, false); continue; }
    byCiv[f.civ].push(f);
  }
  // births by role need, paced over the whole history
  for (const c of civs) {
    if (c.fell !== null) continue;
    const T = FIG.target, mine = byCiv[c.id], want = Math.min(T.max, T.base + Math.floor(H.liveN[c.id] / T.perSites));
    let need = want - mine.length;
    if (need <= 0) continue;
    const nb = Math.min(need, ri(H.FR, 0, FIG.birthsMax));
    for (let k = 0; k < nb; k++) {
      if (F.length >= birthCap(H)) break;
      const home = homeSite(H, c), par = mine.length ? mine[ri(H.FR, 0, mine.length - 1)] : null;
      const f = addFigure(H, c, pickRole(H, c, mine), y, home, par && adult(H, par) ? par.id : -1);
      mine.push(f);
      H.fx.log(E['fig.born'], f.id, c.id);
    }
  }
  // deeds (2.5)
  const n = F.length;
  for (let i = 0; i < n; i++) {
    const f = F[i];
    if (!adult(H, f) || civs[f.civ].fell !== null) continue;
    if (rf(H.FR) < FIG.deedPct) deed(H, f);
  }
}
/** A living site of c for a newborn, weighted by size + 1 (sites in id order). */
function homeSite(H, c) {
  let sum = 0;
  for (const s of H.sites) if (liveSite(s) && s.civ === c.id) sum += s.size + 1;
  let u = ri(H.FR, 0, sum - 1);
  for (const s of H.sites) if (liveSite(s) && s.civ === c.id) { u -= s.size + 1; if (u < 0) return s.id; }
  return c.cap;
}

// ---- deeds -----------------------------------------------------------------------------------------------------
function deed(H, f) {
  const c = H.civs[f.civ], W = FIG.deeds[f.role] || FIG.deeds.hero, keys = Object.keys(W), w = [];
  const war = civAtWar(H, f.civ) >= 0, pact = c.pacts.length > 0, plague = H.year - H.plagueAt[f.civ] <= FIG.plagueYears;
  let sum = 0;
  for (const k of keys) {
    let v = W[k];
    if (k === 'slew' && war) v *= FIG.warSlew;
    if (k === 'forged' && pact) v *= FIG.pactForge;
    if (k === 'wed') v = f.kin[1] >= 0 ? 0 : pact && f.role === 'envoy' ? v * FIG.pactWed : v;
    if (k === 'healed') v = plague ? v * FIG.plagueHeal : 0;
    if (k === 'exiled' && f.ex !== undefined) v = 0;
    w.push(v); sum += v;
  }
  if (sum <= 0) return;
  let u = rf(H.FR) * sum, pick = keys[keys.length - 1];
  for (let k = 0; k < keys.length; k++) { u -= w[k]; if (u < 0) { pick = keys[k]; break; } }
  DO[pick](H, f);
}
/** The first true cause of a deed (2.5 step 3): [code, arg]. t: { civ } for a deed against a civ, { beast } for a hunt. */
export function causeOf(H, f, t, kind) {
  const F = H.figures, y = H.year;
  if (kind === 'exiled') return [CAUSE.ambition, 0];
  if (t) {
    for (const k of kinOf(F, f)) {
      const g = F[k];
      if (g.died !== null && g.died <= y && ((t.civ !== undefined && g.byc === t.civ) || (t.beast !== undefined && g.byb === t.beast))) return [CAUSE.avenge, k];
    }
    const h = f.home >= 0 ? H.sites[f.home] : null;
    if (h && h.razed !== null && ((t.civ !== undefined && h.by === t.civ) || (t.beast !== undefined && h.beast === t.beast))) return [CAUSE.place, h.id];
  }
  if (!t || t.civ !== undefined) {
    const w = civAtWar(H, f.civ, t && t.civ !== undefined ? t.civ : -1);
    if (w >= 0 && (!t || t.civ !== f.civ)) return [CAUSE.duty, w];
  }
  if (!t) {
    const c = H.civs[f.civ];
    if (c.pacts.length) { let m = c.pacts[0]; for (const p of c.pacts) if (p < m) m = p; return [CAUSE.oath, m]; }
  }
  if (t && t.beast !== undefined) return [CAUSE.protect, t.beast];
  return [CAUSE.ambition, 0];
}
/** Kin of f, in a fixed order: parent, spouse, children, siblings (ids). */
function kinOf(F, f) {
  const out = [];
  if (f.kin[0] >= 0) out.push(f.kin[0]);
  if (f.kin[1] >= 0) out.push(f.kin[1]);
  for (const g of F) if (g.id !== f.id && (g.kin[0] === f.id || (f.kin[0] >= 0 && g.kin[0] === f.kin[0]))) out.push(g.id);
  return out;
}
function deedRow(H, f, type, a, b, site, cause) {
  const k = H.fx.log(E[type], a, b, site, cause[1], cause[0]);
  if (k >= 0) f.deeds.push(k);
  return k;
}
const DO = {
  slew(H, f) {
    const F = H.figures, enemy = [];
    for (const w of H.wars) if (w.ended === null && (w.a === f.civ || w.b === f.civ)) enemy.push(w.a === f.civ ? w.b : w.a);
    const cand = [];
    for (const g of F) {
      if (g.id === f.id || !adult(H, g) || H.civs[g.civ].fell !== null) continue;
      if (enemy.includes(g.civ) || (f.role === 'outlaw' && (g.civ === f.civ || H.fx.near(f.civ, g.civ)))) cand.push(g);
    }
    if (!cand.length) return;
    const v = cand[ri(H.FR, 0, cand.length - 1)], cause = causeOf(H, f, { civ: v.civ }, 'slew');
    deedRow(H, f, 'fig.slew', f.id, v.id, NONE, cause);
    if (v.civ !== f.civ) H.fx.addGrief(f.civ, v.civ, REL.grief.kin !== undefined ? REL.grief.kin : FIG.kinGrief);
    f.ren += FIG.ren.slew;
    kill(H, v, DEATH.slain, f.home, { fig: f.id, civ: f.civ });
  },
  hunt(H, f) {
    const home = H.sites[f.home];
    if (!home) return;
    let b = null, bd = 1e9;
    for (const x of H.beasts) if (x.alive && x.born <= H.year) { const d = cheb(x, home); if (d <= reach(H, FIG.hunt.reach) && d < bd) { bd = d; b = x; } }
    if (!b) return;
    const Hu = FIG.hunt, cause = causeOf(H, f, { beast: b.id }, 'hunt'), u = rf(H.FR);
    const slay = Hu.slay + Hu.perRen * (f.ren < Hu.renMax ? f.ren : Hu.renMax);
    if (u < slay) {
      deedRow(H, f, 'beast.slain', b.id, f.id, b.site, cause);
      b.alive = false; b.slain = H.year; b.by = f.id;
      f.ren += FIG.ren.hunt;
      const a = newArtifact(H, 'trophy', ART.mats.indexOf('horn'), -1, b.site);
      a.beast = b.id;
      loseArt(H, a, b.site, -1, false);
    } else if (u < slay + Hu.wound) {
      deedRow(H, f, 'beast.wounded', b.id, f.id, NONE, cause);
      b.wounds++; f.ren += FIG.ren.wound;
    } else {
      b.kills++;
      kill(H, f, DEATH.beast, b.site, { beast: b.id });
    }
  },
  found(H, f) {
    const home = H.sites[f.home];
    if (!home) return;
    let a = null, bd = 1e9;
    for (const x of H.artifacts) if (x.lost) { const d = cheb(x, home); if (d <= reach(H, FIG.found) && d < bd) { bd = d; a = x; } }
    if (!a) return;
    const where = a.lost[1], cause = causeOf(H, f, null, 'found');
    a.lost = null; a.x = null; a.y = null; a.at = f.home; a.holders.push([f.id, H.year]);
    deedRow(H, f, 'fig.found', f.id, a.id, where, cause);
    f.ren += FIG.ren.found;
  },
  forged(H, f) {
    if (H.forged >= (H.artCap * (H.year + FIG.pace)) / (H.Y + FIG.pace)) return;
    const ks = ART.byRole[f.role] || ART.byRole.smith, a = newArtifact(H, ART.kinds[ks[ri(H.FR, 0, ks.length - 1)]], ri(H.FR, 0, ART.mats.length - 2), f.id, f.home);
    H.forged++;
    a.holders.push([f.id, H.year]);
    deedRow(H, f, 'fig.forged', f.id, a.id, f.home, causeOf(H, f, null, 'forged'));
    f.ren += FIG.ren.forged;
  },
  wed(H, f) {
    if (f.kin[1] >= 0) return;
    const c = H.civs[f.civ], kin = kinOf(H.figures, f), cand = [];
    for (const g of H.figures) {
      if (g.id === f.id || g.kin[1] >= 0 || !adult(H, g) || kin.includes(g.id) || g.kin[0] === f.id) continue;
      if (g.civ === f.civ || c.pacts.includes(g.civ)) cand.push(g);
    }
    if (!cand.length) return;
    const g = cand[ri(H.FR, 0, cand.length - 1)];
    f.kin[1] = g.id; g.kin[1] = f.id;
    deedRow(H, f, 'fig.wed', f.id, g.id, NONE, causeOf(H, f, null, 'wed'));
    f.ren += FIG.ren.other;
  },
  exiled(H, f) {
    f.ex = H.year;
    deedRow(H, f, 'fig.exiled', f.id, f.civ, NONE, causeOf(H, f, null, 'exiled'));
    f.ren += FIG.ren.other;
  },
  wrote(H, f) { plain(H, f, 'fig.wrote'); },
  sang(H, f) { plain(H, f, 'fig.sang'); },
  healed(H, f) { plain(H, f, 'fig.healed'); },
};
function plain(H, f, type) {
  deedRow(H, f, type, f.id, f.civ, f.home >= 0 ? f.home : NONE, causeOf(H, f, null, type.slice(4)));
  f.ren += FIG.ren.other;
}

// ---- deaths ----------------------------------------------------------------------------------------------------
/**
 * Figure f dies now of `cause` (a DEATH code) at site `place` (or NONE). `by`: { fig, civ } of a slayer or the
 * winning side, { beast } of a beast. Its artifacts pass to an heir, or are lost where it died when that is far
 * from home (or no heir lives). With `succession`, a ruling figure's civ crowns an heir (history.js succeed).
 */
export function kill(H, f, cause, place = NONE, by = null, succession = true) {
  if (f.died !== null) return;
  const rule = succession && ruling(H, f);
  f.died = H.year;
  if (by) { if (by.fig !== undefined) f.by = by.fig; if (by.civ !== undefined) f.byc = by.civ; if (by.beast !== undefined) f.byb = by.beast; }
  H.fx.log(E['fig.died'], f.id, f.civ, place === undefined || place < 0 ? NONE : place, cause);
  passArtifacts(H, f, place);
  if (rule) H.fx.succeed(H.civs[f.civ], f.id);
}
function passArtifacts(H, f, place) {
  const home = f.home >= 0 ? H.sites[f.home] : null, at = place !== NONE && place >= 0 ? H.sites[place] : home;
  for (const a of H.artifacts) {
    if (holderOf(a) !== f.id) continue;
    const far = !home || !at || cheb(home, at) > reach(H, FIG.far);
    const heir = far ? -1 : heirOf(H, f);
    if (heir >= 0) { a.holders.push([heir, H.year]); a.at = H.figures[heir].home; }
    else loseArt(H, a, at ? at.id : home ? home.id : NONE, f.id, true);
  }
}
/** The heir of f's artifacts: a living spouse, then a living child, the civ's ruler, any living figure of the civ (lowest id); -1 when none. */
function heirOf(H, f) {
  const F = H.figures, sp = f.kin[1];
  if (sp >= 0 && alive(F[sp])) return sp;
  for (const g of F) if (g.kin[0] === f.id && alive(g)) return g.id;
  const c = H.civs[f.civ];
  if (c.fell === null) {
    const r = H.fx.rulerOf(c);
    if (r >= 0 && r !== f.id) return r;
    for (const g of F) if (g.civ === f.civ && alive(g) && g.id !== f.id) return g.id;
  }
  return -1;
}

// ---- artifacts (2.3 step 10) -----------------------------------------------------------------------------------
function newArtifact(H, kind, mat, maker, site) {
  const a = { id: H.artifacts.length, kind, mat: ART.mats[mat < 0 ? 0 : mat], nm: [ri(H.FR, 0, ART.a.length - 1), ri(H.FR, 0, ART.b.length - 1)],
    maker, made: H.year, at: site, holders: [], lost: null, x: null, y: null };
  H.artifacts.push(a);
  return a;
}
/** Artifact a is lost at site `site` now; `fig` the holder who lost it (or -1); `row` logs fig.lost. */
function loseArt(H, a, site, fig, row) {
  const s = site !== NONE && site >= 0 ? H.sites[site] : null;
  a.lost = [H.year, s ? s.id : -1]; a.at = s ? s.id : -1;
  a.x = s ? s.x : null; a.y = s ? s.y : null;
  if (row) {
    const k = H.fx.log(E['fig.lost'], fig >= 0 ? fig : NONE, a.id, s ? s.id : NONE);
    if (k >= 0 && fig >= 0) H.figures[fig].deeds.push(k);
  }
}
/** Site s became a ruin: the artifacts kept there are lost there (2.3 step 3). */
export function siteRuined(H, s) {
  for (const a of H.artifacts) if (!a.lost && a.at === s.id) loseArt(H, a, s.id, holderOf(a), true);
}

// ---- war and plague ----------------------------------------------------------------------------------------------
/** The heroes' weight of civ c in a battle: per living adult hero perHero + perRen * min(ren, renMax), at most max. */
export function heroWeight(H, c) {
  const B = FIG.battle;
  let v = 0;
  for (const f of H.figures) if (f.civ === c && f.role === 'hero' && adult(H, f)) v += B.perHero + B.perRen * (f.ren < B.renMax ? f.ren : B.renMax);
  return v > B.max ? B.max : v;
}
/** After a battle at site t: each living adult hero of the loser dies with dieLose, of the winner with dieWin. */
export function battleDeaths(H, win, lose, t) {
  const B = FIG.battle, F = H.figures, n = F.length;
  for (let i = 0; i < n; i++) {
    const f = F[i];
    if (f.role !== 'hero' || (f.civ !== win && f.civ !== lose) || !adult(H, f)) continue;
    if (rf(H.FR) < (f.civ === lose ? B.dieLose : B.dieWin)) kill(H, f, DEATH.battle, t.id, { civ: f.civ === lose ? win : lose });
  }
}
/** A plague in civ c kills 1-3 of its living adults who do not rule (step 8). Returns the count. */
export function plagueDeaths(H, c) {
  H.plagueAt[c.id] = H.year;
  const cand = [];
  for (const f of H.figures) if (f.civ === c.id && adult(H, f) && !ruling(H, f)) cand.push(f);
  let k = ri(H.FR, FIG.plague[0], FIG.plague[1]), killed = 0;
  while (k-- > 0 && cand.length) { const j = ri(H.FR, 0, cand.length - 1), f = cand[j]; cand.splice(j, 1); kill(H, f, DEATH.plague, f.home, null, false); killed++; }
  return killed;
}

// ---- the oracle by replay ------------------------------------------------------------------------------------------
function rows(realm) {
  const ev = realm.events, dv = new DataView(ev.buffer, ev.byteOffset, ev.byteLength), n = ev.length / EVENT_BYTES, out = new Array(n);
  for (let k = 0; k < n; k++) {
    const o = k * EVENT_BYTES;
    out[k] = { k, year: dv.getInt16(o, true), key: EVENT_TYPES[dv.getUint8(o + 2)].key, flags: dv.getUint8(o + 3),
      a: dv.getUint16(o + 4, true), b: dv.getUint16(o + 6, true), site: dv.getUint16(o + 8, true), arg: dv.getInt16(o + 10, true) };
  }
  return out;
}
/**
 * The W3.1b oracle over a settled realm: every figure dies after birth and every deed falls inside its life; every
 * deed's cause is true at its year (re-checked from the tables and the log, in log order); every artifact has one
 * living holder or one lost place; beasts' rows agree with their deeds. Returns [{ rule, detail }].
 */
export function checkFigures(realm) {
  const T = realm.tables, F = T.figures, ev = rows(realm), fails = [], Y = realm.years;
  const fail = (rule, detail) => { if (fails.length < 40) fails.push({ rule, detail }); };
  const deathRow = new Map(), razeRow = new Map(), warEnd = new Map();
  for (const e of ev) {
    if (e.key === 'fig.died') deathRow.set(e.a, e.k);
    if ((e.key === 'site.razed' || e.key === 'beast.razed' || e.key === 'site.hollowed') && !razeRow.has(e.site)) razeRow.set(e.site, e.k);
    if (e.key === 'war.treaty') warEnd.set(e.arg, e.k);
  }
  const before = (k, row, year, dy) => (row !== undefined ? row < k : year < dy);
  const kinIs = (f, g) => g.id === f.kin[0] || g.id === f.kin[1] || g.kin[0] === f.id || g.kin[1] === f.id || (f.kin[0] >= 0 && g.kin[0] === f.kin[0]);
  // pact toggles per civ pair, and each civ's fall row, for "a pact stood at row k"
  const pacts = new Map(), fellRow = new Map(), pk = (a, b) => (a < b ? a + ':' + b : b + ':' + a);
  for (const e of ev) {
    if (e.key === 'civ.pact' || e.key === 'civ.oathBroken') { const key = pk(e.a, e.b); if (!pacts.has(key)) pacts.set(key, []); pacts.get(key).push([e.k, e.key === 'civ.pact']); }
    if (e.key === 'civ.fell' && !fellRow.has(e.a)) fellRow.set(e.a, e.k);
  }
  const pactAt = (a, b, k) => {
    let on = false;
    for (const [j, v] of pacts.get(pk(a, b)) || []) { if (j >= k) break; on = v; }
    const fa = fellRow.get(a), fb = fellRow.get(b);
    return on && (fa === undefined || fa > k) && (fb === undefined || fb > k);
  };
  for (const f of F) {
    const at = `figure ${f.id}`;
    if (f.died !== null && !(f.died > f.born)) fail('life', `${at} born ${f.born} died ${f.died}`);
    for (const k of f.deeds) {
      const e = ev[k];
      if (!e) { fail('deed', `${at} deed row ${k} missing`); continue; }
      const top = f.died === null ? Y : f.died;
      if (e.year < f.born || e.year > top) fail('deed.life', `${at} (${f.born}-${top}) deed ${e.key} in year ${e.year}`);
      if (e.key === 'fig.lost') { if (e.a !== f.id) fail('deed.slot', `${at} lost row ${k}`); continue; }
      const slot = DEED_SLOT[e.key];
      if (!slot || e[slot] !== f.id) { fail('deed.slot', `${at} row ${k} ${e.key}`); continue; }
      // the cause, true at that point of the log
      const code = e.flags & 7, ref = e.arg, y = e.year;
      const tciv = e.key === 'fig.slew' ? F[e.b].civ : undefined, tb = e.key.startsWith('beast.') ? e.a : undefined;
      let ok = false;
      if (code === CAUSE.avenge) {
        const g = F[ref];
        ok = !!g && kinIs(f, g) && g.died !== null && before(k, deathRow.get(g.id), g.died, y) && ((tciv !== undefined && g.byc === tciv) || (tb !== undefined && g.byb === tb));
      } else if (code === CAUSE.place) {
        const s = T.sites[ref];
        ok = !!s && ref === f.home && s.razed !== null && before(k, razeRow.get(ref), s.razed, y) && ((tciv !== undefined && s.by === tciv) || (tb !== undefined && s.beast === tb));
      } else if (code === CAUSE.duty) {
        const w = T.wars[ref];
        const endK = warEnd.has(ref) ? warEnd.get(ref) : w && w.ended !== null ? ev.findIndex((x) => x.key === 'civ.fell' && x.year === w.ended && (x.a === w.a || x.a === w.b)) : -1;
        ok = !!w && (w.a === f.civ || w.b === f.civ) && w.began <= y && (w.ended === null || w.ended > y || (w.ended === y && endK > k))
          && (tciv === undefined || w.a === tciv || w.b === tciv) && tb === undefined;
      } else if (code === CAUSE.oath) ok = tciv === undefined && tb === undefined && pactAt(f.civ, ref, k);
      else if (code === CAUSE.protect) { const b = T.beasts[ref]; ok = tb === ref && !!b && b.born <= y && (b.slain === null || b.slain >= y); }
      else if (code === CAUSE.ambition) ok = true;
      if (!ok) fail('cause', `${at} row ${k} ${e.key} year ${y}: cause ${CAUSE_KEYS[code]} ${ref} is not true`);
    }
  }
  for (const a of T.artifacts) {
    const at = `artifact ${a.id}`;
    if (a.lost) {
      if (typeof a.x !== 'number' || typeof a.y !== 'number') fail('art.place', `${at} lost with no place`);
    } else {
      const h = a.holders.length ? F[a.holders[a.holders.length - 1][0]] : null;
      if (!h || h.died !== null) fail('art.holder', `${at} has no living holder`);
      if (a.x !== null) fail('art.place', `${at} held but has a lost place`);
    }
    for (const [fid, y] of a.holders) { const g = F[fid]; if (!g || y < g.born || (g.died !== null && y > g.died)) fail('art.holders', `${at} holder ${fid} in ${y}`); }
    if (a.maker >= 0) { const m = F[a.maker]; if (!m || a.made < m.born || (m.died !== null && a.made > m.died)) fail('art.maker', `${at} maker ${a.maker} in ${a.made}`); }
  }
  for (const b of T.beasts) {
    const s = T.sites[b.site];
    if (!s || s.kind !== 'lair' || s.x !== b.x || s.y !== b.y) fail('beast.lair', `beast ${b.id} lair ${b.site}`);
    if (b.alive !== (b.slain === null)) fail('beast.slain', `beast ${b.id}`);
    if (b.slain !== null) { const g = F[b.by]; if (!g || b.slain < g.born || (g.died !== null && g.died < b.slain)) fail('beast.by', `beast ${b.id} slain by ${b.by}`); }
  }
  return fails;
}
