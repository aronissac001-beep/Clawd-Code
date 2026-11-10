// Records: the Codex (everything the player has met) and Feats (achievements).
//
// Three layers, as the bus asks:
//   sim     BUS.kill / built / phase tally into s.ext.records (deterministic; nothing in the
//           simulation ever reads it back, so it cannot change a run)
//   run     BUS.runRegionEnd turns the finished region into a plain record queued on
//           run.ext.records.pending (the region s is still complete there)
//   meta    BUS.regionDone / BUS.runEnd (UI level) fold the queued records into
//           meta.codex, meta.life and meta.ach, pay Feat rewards into meta.embers, toast them
//           and call app.saveMeta(). Folded records leave the queue (run.ext.records.folded
//           counts them), so a region is never counted twice when both hooks fire.
//   live    BUS.fx catches a few events mid-region (Blood Moon dawn, hero level, land claim,
//           decree, combo, Wonder) so those Feats unlock the moment they are earned.
// Sandbox runs record nothing and earn no Feats.
//
// Region state  s.ext.records = { v, partial, kills: {type: n}, built: {type: n}, towers,
//                                 bloodMoons, bloodWinter, ns, nb }
// Run state     run.ext.records = { v, partial, towers, regions, pending: [regionRecord], folded, ended }
// Meta          meta.codex = { enemies: {type: kills}, relics, events, regionEvents, buildings, heroes, bosses,
//                              combos }  (combos found outside Sandbox: the combo Feats count these;
//                              meta.combos, written by the controller, also holds Sandbox finds and
//                              is what the Codex shows)
//               meta.life = { kills, nights, regions, runs, wins, bosses, built, bloodMoons }
//               meta.ach = { id: unlock timestamp }       (combos stay in meta.combos)
import { BUS } from '../hooks.js';
import { ACHIEVEMENTS, ACHIEVEMENT_BY_ID, activeAchievements, isTowerType } from '../../data/achievements.js';
import { BUILDINGS } from '../../data/buildings.js';
import { openCodex, openFeats } from '../../ui/codexui.js';

const REC_V = 1;

// ---- Region tallies (simulation side) ----------------------------------------------------------
function newRegionRec(partial) {
  return { v: REC_V, partial: !!partial, kills: {}, built: {}, towers: 0, bloodMoons: 0, bloodWinter: 0, ns: null, nb: false };
}
/** The region's tallies; a region saved before records existed gets a partial set. */
export function regionRec(s) {
  const ext = s.ext || (s.ext = {});
  return ext.records || (ext.records = newRegionRec(true));
}

function onRegionInit(s) { if (!s.ext.records) s.ext.records = newRegionRec(false); }

function onKill(s, v) {
  if (v.kind !== 'enemy') return;
  const k = regionRec(s).kills;
  k[v.type] = (k[v.type] || 0) + 1;
}

function onBuilt(s, b, upgraded) {
  if (upgraded) return;
  const r = regionRec(s);
  r.built[b.type] = (r.built[b.type] || 0) + 1;
  if (isTowerType(b.type)) r.towers++;
}

function onPhase(s, phase) {
  if (phase === 'night') {
    const r = regionRec(s);
    r.ns = BUS.query.season(s); // the season the night is fought in (the dawn may turn it)
    r.nb = !!(s.wave && s.wave.blood);
  } else if (phase === 'dawn') {
    const r = regionRec(s);
    if (r.nb) { r.bloodMoons++; if (r.ns === 'winter') r.bloodWinter++; }
    r.nb = false;
  }
}

/** A plain summary of region s (final = the region is over). Read-only. */
export function regionRecord(s, final = false) {
  const r = regionRec(s);
  const result = final ? (s.outcome ? s.outcome.result : 'defeat') : null;
  const won = result === 'victory';
  const X = s.ext.territory, M = s.ext.mood, H = s.ext.heroes, D = s.ext.director;
  let villagers = 0;
  for (const v of s.villagers) if (v.alive) villagers++;
  let heroesAlive = 0, heroMax = 0;
  const heroes = [];
  const meet = (cls, lv) => { if (cls && !heroes.includes(cls)) heroes.push(cls); heroMax = Math.max(heroMax, lv || 1); };
  for (const e of s.heroes) if (e.kind === 'hero') { if (e.alive) heroesAlive++; meet(e.cls || e.type, e.level); }
  for (const f of (H && H.fallen) || []) meet(f.cls, f.level);
  let towers = r.towers > 0;
  if (!towers) for (const b of s.buildings) if (b.built && b.alive !== false && isTowerType(b.type)) { towers = true; break; }
  return {
    won, result, nodeType: s.nodeType || null, act: s.act || 1, mode: s.mode || 'campaign',
    nights: s.cycle.night, kills: s.stats.kills || 0, killsBy: { ...r.kills }, built: { ...r.built },
    builtN: s.stats.built || 0, towers, villagersLost: s.stats.villagersLost || 0, villagers,
    bonusNights: s.bonusNights || 0, gold: Math.floor(s.res.gold || 0),
    claims: X ? X.claims || 0 : 0, zones: X && X.zones ? X.zones.filter((z) => z.owned).length : 0,
    decrees: M && Array.isArray(M.signed) ? M.signed.length : 0,
    bloodMoons: r.bloodMoons, bloodWinter: r.bloodWinter,
    boss: won && s.nodeType === 'boss' ? s.bossType || 'gloomwyrm' : null,
    heroesAlive, heroMax, heroes, revents: D && Array.isArray(D.eventsSeen) ? D.eventsSeen.slice() : [],
    partial: !!r.partial,
  };
}

// ---- Run layer -----------------------------------------------------------------------------------
function newRunRec(partial) { return { v: REC_V, partial: !!partial, towers: 0, regions: 0, pending: [], folded: 0, ended: false }; }
/** The run's record queue (a run begun before records existed is marked partial). */
export function runRec(run) {
  const ext = run.ext || (run.ext = {});
  if (!ext.records) ext.records = newRunRec((run.visited && run.visited.length > 1) || (run.regionsCleared || 0) > 0);
  return ext.records;
}

function onRunNew(run) { (run.ext || (run.ext = {})).records = newRunRec(false); }

function onRunRegionEnd(run, s) {
  if (run.mode === 'sandbox') return;
  const R = runRec(run);
  const e = regionRecord(s, true);
  e.gold = Math.floor(run.gold || 0); // what the run carries away
  R.pending.push(e);
  R.regions++;
  if (e.towers) R.towers++;
  if (e.partial) R.partial = true;
}

// ---- Meta ----------------------------------------------------------------------------------------
const LIFE_KEYS = ['kills', 'nights', 'regions', 'runs', 'wins', 'bosses', 'built', 'bloodMoons'];
/** Make sure meta has the records keys (older saves). Returns meta. */
export function ensureMeta(meta) {
  if (!meta.life || typeof meta.life !== 'object') {
    // Runs and wins played before Feats existed still count toward them.
    meta.life = { runs: meta.runs || 0, wins: meta.wins || 0 };
  }
  for (const k of LIFE_KEYS) if (typeof meta.life[k] !== 'number') meta.life[k] = 0;
  const c = meta.codex && typeof meta.codex === 'object' ? meta.codex : (meta.codex = {});
  if (!c.enemies || typeof c.enemies !== 'object') c.enemies = {};
  for (const k of ['relics', 'events', 'regionEvents', 'buildings', 'heroes', 'bosses']) if (!Array.isArray(c[k])) c[k] = [];
  if (!meta.ach || typeof meta.ach !== 'object') meta.ach = {};
  if (!Array.isArray(meta.combos)) meta.combos = [];
  // Combos found before records existed count toward the combo Feats; from now on only
  // non-Sandbox finds are added (BUS.fx 'combo').
  if (!Array.isArray(c.combos)) c.combos = meta.combos.slice();
  return meta;
}
export function lifeOf(meta) { return ensureMeta(meta).life; }

function addAll(list, items) { for (const x of items || []) if (x && !list.includes(x)) list.push(x); }

/** Is feat a earned? Has a progress bar? */
export function achStatus(meta, a) {
  const at = meta.ach && meta.ach[a.id];
  const out = { done: !!at, at: at || 0, progress: null, target: null };
  if (a.progress) { out.target = a.target; out.progress = Math.min(a.target, safe(() => a.progress(meta), 0)); }
  return out;
}
/** Embers earned from Feats so far. */
export function achEmbers(meta) {
  let n = 0;
  for (const id in meta.ach || {}) if (ACHIEVEMENT_BY_ID[id]) n += ACHIEVEMENT_BY_ID[id].reward;
  return n;
}
function safe(fn, dflt) { try { return fn(); } catch (e) { if (typeof console !== 'undefined') console.error(e); return dflt; } }

/** Test every unearned Feat against ctx; earn those that pass. Returns the defs earned now. */
export function evaluate(meta, ctx) {
  ensureMeta(meta);
  const c = { meta, run: null, entry: null, final: false, runEnd: false, ...ctx };
  const got = [];
  for (const a of activeAchievements()) {
    if (meta.ach[a.id]) continue;
    const ok = (a.progress && safe(() => a.progress(meta), 0) >= a.target) || (a.check && safe(() => a.check(c), false));
    if (ok) { unlock(meta, a); got.push(a); }
  }
  return got;
}

/** Earn a Feat (idempotent): stamp it, pay its Embers. Returns true if it is new. */
export function unlock(meta, a) {
  if (typeof a === 'string') a = ACHIEVEMENT_BY_ID[a];
  if (!a || meta.ach[a.id]) return false;
  meta.ach[a.id] = Date.now();
  meta.embers = (meta.embers || 0) + a.reward;
  return true;
}

/** Fold one region record into meta.life and meta.codex. */
function foldRegion(meta, e) {
  const L = meta.life, C = meta.codex;
  L.kills += e.kills || 0; L.nights += e.nights || 0; L.built += e.builtN || 0; L.bloodMoons += e.bloodMoons || 0;
  if (e.won) L.regions++;
  if (e.boss) { L.bosses++; addAll(C.bosses, [e.boss]); }
  for (const t in e.killsBy || {}) C.enemies[t] = (C.enemies[t] || 0) + e.killsBy[t];
  addAll(C.buildings, Object.keys(e.built || {}));
  addAll(C.heroes, e.heroes);
  addAll(C.regionEvents, e.revents);
}

/**
 * Fold a run's queued regions (and, at the end, the run itself) into meta. Pure on meta and
 * run (no UI). Returns the Feats earned. Safe to call any number of times.
 */
export function foldRun(meta, run, { runEnd = false } = {}) {
  // A meta without records is seeded from meta.runs / meta.wins, which finalizeRun has already
  // bumped for this very run: do not count it a second time.
  const seeded = !meta.life || typeof meta.life !== 'object';
  ensureMeta(meta);
  if (!run || run.mode === 'sandbox') return [];
  const R = runRec(run);
  const got = [];
  const C = meta.codex;
  // Run-wide discoveries first, so region Feats see them.
  addAll(C.relics, (run.relics || []).map((x) => x.id));
  addAll(C.events, run.flags && run.flags.seenEvents);
  addAll(C.heroes, ((run.ext && run.ext.heroes) || []).map((h) => h.cls));
  addAll(C.heroes, ((run.ext && run.ext.fallen) || []).map((h) => h.cls));
  const queue = R.pending.splice(0, R.pending.length);
  for (const e of queue) {
    foldRegion(meta, e);
    R.folded++;
    got.push(...evaluate(meta, { run, entry: e, final: true }));
  }
  if (runEnd && !R.ended) {
    R.ended = true;
    if (!seeded) {
      meta.life.runs++;
      if (run.outcome && run.outcome.result === 'victory') meta.life.wins++;
    }
    got.push(...evaluate(meta, { run, runEnd: true }));
  }
  got.push(...evaluate(meta, { run }));
  return got;
}

/** Live check during a region (from BUS.fx). Returns the Feats earned. */
export function liveCheck(meta, run, s) {
  if (!s || s.mode === 'sandbox' || s.standalone || (run && run.mode === 'sandbox')) return [];
  return evaluate(meta, { run, entry: regionRecord(s, false), final: false });
}

// ---- Toasts (queued so several Feats never pile up unreadably) ---------------------------------------
const toastQ = [];
let toastBusy = false;
export const TOAST_GAP = 2200;
export function announce(app, list) {
  if (!app || !app.toasts) return;
  for (const a of list) toastQ.push(`Feat earned: ${a.name} (+${a.reward} Embers)`);
  if (!toastBusy) nextToast(app);
}
function nextToast(app) {
  const text = toastQ.shift();
  if (!text) { toastBusy = false; return; }
  toastBusy = true;
  try { app.toasts.show(text, 'good', 'trophy', TOAST_GAP + 1200); } catch (e) { console.error(e); }
  const t = setTimeout(() => nextToast(app), TOAST_GAP);
  if (t && typeof t.unref === 'function') t.unref();
}

function commit(app, got) {
  if (got.length) announce(app, got);
  if (app.saveMeta) app.saveMeta(app.meta);
}

// ---- UI hooks ----------------------------------------------------------------------------------------
function onRegionDone(app, run) {
  if (!run || run.mode === 'sandbox') return;
  try { commit(app, foldRun(app.meta, run)); } catch (e) { console.error(e); }
}
function onRunEnd(app, run) {
  if (!run || run.mode === 'sandbox') return;
  try { commit(app, foldRun(app.meta, run, { runEnd: true })); } catch (e) { console.error(e); }
}
const LIVE_EVENTS = { dawn: 1, heroLevel: 1, zoneClaimed: 1, decree: 1, combo: 1, built: 1, riftFallen: 1 };
/** A finished Wonder (the only 'built' event a live Feat cares about; walls come by the dozen). */
function wonderBuilt(s, ev) {
  if (ev.upgrade || !s.rt || !s.rt.bById) return false;
  const b = s.rt.bById.get(ev.id);
  return !!(b && BUILDINGS[b.type] && BUILDINGS[b.type].wonder);
}
function onFx(ctl, ev, s) {
  if (!LIVE_EVENTS[ev.t] || !ctl || !ctl.app || !s) return;
  if (ev.t === 'built' && !wonderBuilt(s, ev)) return;
  const app = ctl.app;
  const run = app.flow ? app.flow.run : null;
  if (s.mode === 'sandbox' || (run && run.mode === 'sandbox')) {
    // Sandbox earns nothing. The controller has just put a Sandbox combo into meta.combos; if
    // records were never set up on this meta, set them up now without that find.
    if (ev.t === 'combo' && ev.id && !(app.meta.codex && Array.isArray(app.meta.codex.combos))) {
      const C = ensureMeta(app.meta).codex;
      C.combos = C.combos.filter((id) => id !== ev.id);
    }
    return;
  }
  try {
    let dirty = false;
    if (ev.t === 'combo' && ev.id) {
      const C = ensureMeta(app.meta).codex;
      if (!C.combos.includes(ev.id)) { C.combos.push(ev.id); dirty = true; }
    }
    const got = s.standalone ? evaluate(app.meta, {}) : liveCheck(app.meta, run, s);
    if (got.length || dirty) commit(app, got);
  } catch (e) { console.error(e); }
}

/**
 * Earn any counter Feat whose target is already met (e.g. runs and wins carried over from a save
 * made before Feats existed). Called when the Codex or Feats screen opens (UI level).
 */
export function catchUp(app) {
  if (!app || !app.meta) return [];
  const got = evaluate(app.meta, {});
  if (got.length) commit(app, got);
  return got;
}

let registered = false;
export function register() {
  if (registered) return;
  registered = true;
  BUS.regionInit.push(onRegionInit);
  BUS.kill.push(onKill);
  BUS.built.push(onBuilt);
  BUS.phase.push(onPhase);
  BUS.runNew.push(onRunNew);
  BUS.runRegionEnd.push(onRunRegionEnd);
  BUS.regionDone.push(onRegionDone);
  BUS.runEnd.push(onRunEnd);
  BUS.fx.push(onFx);
  BUS.menu.push({ id: 'codex', label: 'Codex', icon: 'book', order: 2, open: (app) => openCodex(app) });
  BUS.menu.push({ id: 'achievements', label: 'Feats', icon: 'trophy', order: 3, open: (app) => openFeats(app) });
}

export { ACHIEVEMENTS };
