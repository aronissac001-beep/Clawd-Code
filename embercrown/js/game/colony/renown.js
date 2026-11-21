// Renown (EMBERCROWN-FORTRESS.md 3.10, F11; step Z2.4). Owner K. Data: js/data/renown.js (G).
//
// A hold becomes "known for" a domain (smithing, growing, lore and light, trade, arms, delving) by what it
// actually does; it is never chosen. Each domain gathers points this season from measured activity (the
// events tap and the Dawn Ledger's lifetime counters); at each season's turn the points decay by 25% and the
// season's gain is added. A domain whose points exceed its threshold and 1.5x the median of the other five
// makes the hold known for it: at most two domains (the highest), with one season of hysteresis (a known
// domain that stops qualifying stays known for one more season).
//
// RENOWN NEVER GATES ANYTHING: no structure, recipe, mechanic or prestige building reads it (renown.test checks
// the data and the code). It only steers:
//   - who visits: visitorWeights(s) / visitorFor(s, u32) (visitors.js, Z2.8: guild envoys, petitioners, traders);
//   - the lean of the threat causes: causeLean(s, causeKind) -> percent (causes.js, Z2.10);
//   - flavour: epithetOf(s) ("the Forge under the Mountain") for letters, visitors' lines and engravings.
//
// Saved state (plain JSON on the colony record, created lazily by ensureRenown on the first tap or hourly tick,
// the same tick in an uninterrupted run and a loaded one, so old saves load with none and continue):
//   s.colony.renown = { v: 1, season, pts: [6], acc: [6], known: [ids], grace: [ids], minZ, led: { kills, traded,
//                       raids }, mand: [6], hist: [[day, id, 1 | 0]] (last 12) }
// Determinism: integer arithmetic only, domains in data order; no rng, no rt key.
//
// Hooks into other owners' code (requests in the Z2.4 report; until they land this module is dark):
//   colony/index.js (K)  reg('colony', 'renown', renownSystem, 145) and installRenown() under `verbs`
//   schema.js (A)        newColonyRecord(): renown: null (lazily created meanwhile, which is the same for old saves)
//   text/legends.js (I)  append 'renown' to eventTypes (legendEvent returns false until then)

import { TICKS_PER_HOUR, DAYS_PER_SEASON, dayOf } from '../core/time.js';
import { tz, zS } from '../core/grid.js';
import { hashString } from '../core/rand.js';
import { onTap, offTap, lifetime } from './ledger.js';
import { mandateRenown } from './offices.js';
import { legendEvent } from './legends.js';
import { itemDef, getItem } from '../work/items.js';
import { structDef } from '../world/defs.js';
import { def } from './defs.js';
import { DATA } from '../../data/renown.js';

export const DOMAINS = Object.freeze(DATA.renown.map((d) => d.id));
const ROW = Object.freeze(Object.fromEntries(DATA.renown.map((d) => [d.id, d])));
const D = Object.freeze(Object.fromEntries(DOMAINS.map((id, k) => [id, k])));
export const MAX_KNOWN = 2;
export const DECAY_PCT = 75;               // points kept at a season's turn
export const MEDIAN_X = 150;               // percent of the others' median a known domain must reach
export const HIST_CAP = 12;

/** Points per measured deed (3.10 measures; tuned against the bot: a hold that works one trade hard is known by day 150). */
export const PTS = Object.freeze({
  smithItem: 2, smithQ: 1, masterwork: 12, artifact: 40,      // forge output value, masterworks, artifacts
  harvest: 1, tamed: 10, meal: 1,                             // crops, herds, food value
  researched: 30, light: 6, lumenite: 2,                      // research, lights built, lumenite
  trade: 6,                                                   // trade value (ledger 'traded'), caravans
  raid: 40, kill: 3, beast: 60,                               // raids repelled, foes slain, great beasts
  level: 12, cavern: 50, gem: 8,                              // levels opened, caverns opened, gems
  mandate: 5,                                                 // per renown point a met mandate earns (offices)
});
const SMITH_CATS = new Set(['weapons', 'armour', 'tools', 'ingots']);
const FOOD_CATS = new Set(['meals', 'preserved', 'drink']);

const zeros = () => DOMAINS.map(() => 0);
const seasonOfTick = (tick) => Math.floor(dayOf(tick) / DAYS_PER_SEASON);
/** The renown record, created on first use. */
export function ensureRenown(s) {
  let r = s.colony.renown;
  if (!r) {
    r = s.colony.renown = { v: 1, season: seasonOfTick(s.tick), pts: zeros(), acc: zeros(), known: [], grace: [], minZ: zS,
      led: { kills: lifetime(s, 'kills'), traded: lifetime(s, 'traded'), raids: lifetime(s, 'raidsRepelled') }, mand: mandSnapshot(s), hist: [] };
  }
  return r;
}
function mandSnapshot(s) { try { const m = mandateRenown(s); return DOMAINS.map((_, k) => m[k] | 0); } catch { return zeros(); } }
/** Add points to a domain this season. */
export function addRenown(s, domain, n) {
  const k = D[domain];
  if (k === undefined || !(n > 0)) return;
  ensureRenown(s).acc[k] += n | 0;
}

/** The events tap (ledger onTap): fn(s, e, kind). */
export function renownTap(s, e) {
  const d = e.data || {};
  switch (e.name) {
    case 'crafted': {
      const it = getItem(s, d.itemId), cat = itemDef(d.k).cat;
      if (SMITH_CATS.has(cat)) addRenown(s, 'smithing', PTS.smithItem + PTS.smithQ * ((it && it.q) | (d.q | 0)));
      else if (FOOD_CATS.has(cat)) addRenown(s, 'growing', PTS.meal);
      break;
    }
    case 'masterwork': addRenown(s, 'smithing', PTS.masterwork); break;
    case 'artifact': addRenown(s, 'smithing', PTS.artifact); break;
    case 'harvested': addRenown(s, 'growing', PTS.harvest); break;
    case 'tamed': addRenown(s, 'growing', PTS.tamed); break;
    case 'researched': { const t = def('tech', d.tech); if (t && t.cost > 0) addRenown(s, 'lore', PTS.researched); break; }   // free techs are not learning
    case 'built': { const sd = structDef(d.def); if (sd && sd.light) addRenown(s, 'lore', PTS.light); break; }
    case 'mined': {
      if (d.mat === 'lumenite' || d.ore === 'lumenite') addRenown(s, 'lore', PTS.lumenite);
      if (Number.isInteger(d.i)) {
        const z = tz(d.i), r = ensureRenown(s);
        if (z < r.minZ) { addRenown(s, 'delving', PTS.level * (r.minZ - z)); r.minZ = z; }
      }
      break;
    }
    case 'discovery': if (d.kind === 'cavern') addRenown(s, 'delving', PTS.cavern); break;
    case 'gemFound': addRenown(s, 'delving', PTS.gem); break;
    case 'nemesis': if (d.what === 'slain') addRenown(s, 'arms', PTS.beast); break;
    default: break;
  }
}

/** Fold the Dawn Ledger's lifetime counters and the offices' mandate points into this season's gain. */
function foldCounters(s, r) {
  const k = lifetime(s, 'kills'), t = lifetime(s, 'traded'), rr = lifetime(s, 'raidsRepelled');
  r.acc[D.arms] += PTS.kill * Math.max(0, k - r.led.kills) + PTS.raid * Math.max(0, rr - r.led.raids);
  r.acc[D.trade] += PTS.trade * Math.max(0, t - r.led.traded);
  r.led.kills = k; r.led.traded = t; r.led.raids = rr;
  const m = mandSnapshot(s);
  for (let j = 0; j < DOMAINS.length; j++) { r.acc[j] += PTS.mandate * Math.max(0, m[j] - (r.mand[j] | 0)); r.mand[j] = m[j]; }
}
const median = (a) => { const b = a.slice().sort((x, y) => x - y); const n = b.length; return n ? (n & 1 ? b[n >> 1] : Math.floor((b[n / 2 - 1] + b[n / 2]) / 2)) : 0; };
/** True when domain k's points qualify it as known (threshold and 1.5x the median of the others). */
export function qualifies(pts, k) {
  const row = ROW[DOMAINS[k]];
  const others = pts.filter((_, j) => j !== k);
  return pts[k] >= row.threshold && pts[k] * 100 >= MEDIAN_X * median(others);
}
/** The season's turn: decay, add the season's gain, and choose the known domains. Returns the changes. */
export function rollSeason(s) {
  const r = ensureRenown(s);
  foldCounters(s, r);
  for (let j = 0; j < DOMAINS.length; j++) { r.pts[j] = Math.floor(r.pts[j] * DECAY_PCT / 100) + r.acc[j]; r.acc[j] = 0; }
  const cand = [], grace = [];
  for (let j = 0; j < DOMAINS.length; j++) {
    const id = DOMAINS[j];
    if (qualifies(r.pts, j)) cand.push(j);
    else if (r.known.includes(id) && !r.grace.includes(id)) { cand.push(j); grace.push(id); }   // one season of hysteresis
  }
  cand.sort((a, b) => r.pts[b] - r.pts[a] || a - b);
  const known = cand.slice(0, MAX_KNOWN).sort((a, b) => a - b).map((j) => DOMAINS[j]);
  const changes = [];
  for (const id of known) if (!r.known.includes(id)) changes.push([id, 1]);
  for (const id of r.known) if (!known.includes(id)) changes.push([id, 0]);
  r.known = known;
  r.grace = grace.filter((id) => known.includes(id));
  const day = dayOf(s.tick);
  for (const [id, on] of changes) {
    r.hist.push([day, id, on]);
    legendEvent(s, 'renown', [], on ? `The hold became known for ${ROW[id].name.toLowerCase()}: ${ROW[id].epithet}.` : `The hold was no longer known for ${ROW[id].name.toLowerCase()}.`);
  }
  while (r.hist.length > HIST_CAP) r.hist.shift();
  return changes;
}

/** Tick system (slot 'colony'): hourly, roll every season's turn that has passed. */
export function renownSystem(s) {
  if (s.tick % TICKS_PER_HOUR !== 0) return;
  const r = ensureRenown(s);
  const now = seasonOfTick(s.tick);
  while (r.season < now) { r.season++; rollSeason(s); }
}

let installed = false;
/** Install the events tap (idempotent). */
export function installRenown() { onTap(renownTap); installed = true; }
export function uninstallRenown() { offTap(renownTap); installed = false; }
export const renownInstalled = () => installed;

// ---- Steering (the only things renown does) -----------------------------------------------------------
/** The domains the hold is known for (data order; at most two). */
export const knownFor = (s) => (s.colony.renown ? s.colony.renown.known.slice() : []);
export const isKnownFor = (s, id) => !!s.colony.renown && s.colony.renown.known.includes(id);
/** The hold's epithet in letters: the highest known domain's, or null. */
export function epithetOf(s) {
  const r = s.colony.renown;
  if (!r || !r.known.length) return null;
  let best = r.known[0];
  for (const id of r.known) if (r.pts[D[id]] > r.pts[D[best]]) best = id;
  return ROW[best].epithet;
}
/** The lean of a threat cause (2.10): percent weight, 100 when no known domain leans it (product of leans). */
export function causeLean(s, causeKind) {
  let pct = 100;
  for (const id of knownFor(s)) { const l = ROW[id].lean; if (l && l[causeKind]) pct = Math.floor(pct * l[causeKind] / 100); }
  return pct;
}
/** Visitor weights by domain (Z2.8): 1 each, 3 for a known domain. */
export function visitorWeights(s) {
  const k = knownFor(s);
  return Object.fromEntries(DOMAINS.map((id) => [id, k.includes(id) ? 3 : 1]));
}
/** The visitor a roll picks (u32, e.g. hashString of the seed and the day): { domain, visitor }. */
export function visitorFor(s, u32 = hashString(`${s.seed}|visit|${dayOf(s.tick)}`)) {
  const w = visitorWeights(s);
  const tot = DOMAINS.reduce((a, id) => a + w[id], 0);
  let x = (u32 >>> 0) % tot;
  for (const id of DOMAINS) { if (x < w[id]) return { domain: id, visitor: ROW[id].visitor }; x -= w[id]; }
  return { domain: DOMAINS[0], visitor: ROW[DOMAINS[0]].visitor };
}
/** Screen lines (I): [[id, name, pts, threshold, known]], data order. Read only. */
export function renownLines(s) {
  const r = s.colony.renown;
  return DATA.renown.map((d, j) => [d.id, d.name, r ? r.pts[j] + r.acc[j] : 0, d.threshold, !!r && r.known.includes(d.id)]);
}
