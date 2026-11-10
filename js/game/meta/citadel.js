// The Ember Citadel (Phase 4 meta progression): permanent upgrades bought with
// banked Embers, starting perks and the Omens of Ruin.
// Meta (between runs): meta.citadel = { owned: [ids], lastPerks: [ids], lastOmens: [ids], banner: id|null, bestRuin }
//   and meta.embers (the currency).
// Run:    run.ext.citadel = { owned, perks, omens, ruin, scholarUsed, veteranDone } (snapshot at run start),
//         run.ext.shopMult (merchant price multiplier), run.locked (content not yet unlocked).
// Region: s.ext.citadel = { owned, perks, omens, draftUndo } copied at BUS.regionInit; derived numbers
//         are cached in s.rt.cit (rebuilt lazily after a load).
// Every effect is applied through BUS (js/game/hooks.js); the simulation stays deterministic.
import { BUS } from '../hooks.js';
import { BUILDINGS } from '../../data/buildings.js';
import { RELICS } from '../../data/relics.js';
import { HERO_CLASSES, XP_TABLE, MAX_LEVEL } from '../../data/heroes.js';
import { UNITS } from '../../data/units.js';
import { RUN } from '../../data/balance.js';
import { SQUAD_COLORS } from '../../data/heraldry.js';
import { CITADEL_UPGRADES, TIER_GATE, BASE_PERK_SLOTS } from '../../data/citadel.js';
import { PERKS, PERK_LIST } from '../../data/perks.js';
import { OMENS, OMEN_LIST, RUIN_EMBER_STEP } from '../../data/omens.js';
import { withRng, grantRelic, draftPool, makeShop, BASE_BLUEPRINTS } from '../run.js';
import { T } from '../grid.js';
import { newId, spawnSoldier, accessTile } from '../systems/common.js';
import { openCitadel, citadelSetup } from '../../ui/citadelui.js';

/** Factions playable before any Citadel unlock. */
export const BASE_FACTIONS = ['dawnhold', 'sylvari', 'deepforge', 'emberkin'];

// ---- Meta helpers (pure; UI and tests use them) -------------------------------------
/** The Citadel's meta record, created on first use. */
export function citadelMeta(meta) {
  const c = meta.citadel || (meta.citadel = {});
  if (!Array.isArray(c.owned)) c.owned = [];
  if (!Array.isArray(c.lastPerks)) c.lastPerks = [];
  if (!Array.isArray(c.lastOmens)) c.lastOmens = [];
  if (c.banner === undefined) c.banner = null;
  return c;
}
function ownedOf(meta) { return (meta && meta.citadel && Array.isArray(meta.citadel.owned)) ? meta.citadel.owned : []; }
export function hasUpgrade(meta, id) { return ownedOf(meta).includes(id); }

/** Perk slots for a list of owned upgrade ids (1, 2 or 3). */
export function perkSlots(owned) {
  let n = BASE_PERK_SLOTS;
  for (const id of owned || []) { const u = CITADEL_UPGRADES[id]; if (u && u.perkSlots) n = Math.max(n, u.perkSlots); }
  return n;
}

/** Can this upgrade be bought now? { owned, ok, reason } */
export function upgradeStatus(meta, id) {
  const u = CITADEL_UPGRADES[id];
  if (!u) return { owned: false, ok: false, reason: 'Unknown upgrade.' };
  const owned = ownedOf(meta);
  if (owned.includes(id)) return { owned: true, ok: false, reason: 'Built.' };
  const gate = TIER_GATE[u.tier] || 0;
  if (owned.length < gate) return { owned: false, ok: false, reason: `Build ${gate} upgrades first (${owned.length}/${gate}).` };
  const miss = (u.requires || []).filter((r) => !owned.includes(r));
  if (miss.length) return { owned: false, ok: false, reason: 'Needs ' + miss.map((r) => (CITADEL_UPGRADES[r] ? CITADEL_UPGRADES[r].name : r)).join(' and ') + '.' };
  const embers = (meta && meta.embers) || 0;
  if (embers < u.cost) return { owned: false, ok: false, reason: `Needs ${u.cost - embers} more Embers.` };
  return { owned: false, ok: true, reason: '' };
}

/** Buy an upgrade: spends meta.embers and records it. The caller saves meta. */
export function buyUpgrade(meta, id) {
  const st = upgradeStatus(meta, id);
  if (!st.ok) return { ok: false, msg: st.reason };
  const u = CITADEL_UPGRADES[id];
  const c = citadelMeta(meta);
  meta.embers -= u.cost;
  c.owned.push(id);
  return { ok: true, msg: `${u.name} is built.` };
}

/** Is the merchant-price integration in run.js makeShop live? (Perks and Omens that need it stay hidden until it is.) */
let shopOk = null;
export function shopHooked() {
  if (shopOk !== null) return shopOk;
  try {
    const fake = { rng: 0x1234567, relics: [], blueprints: BASE_BLUEPRINTS.slice(), faction: 'dawnhold', locked: { buildings: [], relics: [], heroes: [] }, ext: { shopMult: 0.5 }, flags: {}, next: {} };
    const heal = makeShop(fake).items.find((it) => it.kind === 'heal');
    shopOk = !!heal && heal.price <= Math.ceil(RUN.shopPrice.heal * 0.5);
  } catch (_) { shopOk = false; }
  return shopOk;
}
/** Test hook: force the answer of shopHooked(). */
export function _setShopHooked(v) { shopOk = v; }

function fits(def) { return !(def.shopMult && !shopHooked()); }
export function perkUnlocked(owned, p) { return fits(p) && (!p.requires || (owned || []).includes(p.requires)); }
/** Perks shown in the picker (those needing a missing integration are left out). */
export function listPerks() { return PERK_LIST.filter(fits); }
export function listOmens() { return OMEN_LIST.filter(fits); }
export function omensOpen(meta) { return ((meta && meta.wins) || 0) >= 1; }

/** Keep only known, unlocked, distinct perks that fit the slots. */
export function sanitizePerks(owned, list) {
  const out = [];
  for (const id of list || []) {
    const p = PERKS[id];
    if (p && !out.includes(id) && perkUnlocked(owned, p)) out.push(id);
  }
  return out.slice(0, perkSlots(owned));
}
export function sanitizeOmens(list) {
  const out = [];
  for (const id of list || []) if (OMENS[id] && fits(OMENS[id]) && !out.includes(id)) out.push(id);
  return out;
}
export function ruinOf(omens) { let r = 0; for (const id of omens || []) r += (OMENS[id] && OMENS[id].ruin) || 0; return r; }
/** Ember multiplier from Ruin alone. */
export function ruinEmberMult(ruin) { return 1 + RUIN_EMBER_STEP * (ruin || 0); }

/**
 * Content still locked for a list of owned upgrades: every BUILDINGS / RELICS /
 * HERO_CLASSES entry with an `unlock` tag that is not owned.
 */
export function computeLocked(owned, defs = { buildings: BUILDINGS, relics: RELICS, heroes: HERO_CLASSES }) {
  const have = new Set(owned || []);
  const out = { buildings: [], relics: [], heroes: [] };
  for (const kind of ['buildings', 'relics', 'heroes']) {
    const table = defs[kind] || {};
    for (const id of Object.keys(table)) {
      const d = table[id];
      if (d && d.unlock && !have.has(d.unlock)) out[kind].push(id);
    }
  }
  return out;
}

/** Embers multiplier for a run: Ember Tithe and Ruin. */
export function citadelEmberMult(run) {
  const C = run && run.ext && run.ext.citadel;
  if (!C) return 1;
  let tithe = 0;
  for (const id of C.owned || []) { const u = CITADEL_UPGRADES[id]; if (u && u.emberMult) tithe += u.emberMult; }
  return (1 + tithe) * ruinEmberMult(C.ruin || 0);
}

// ---- Run start -------------------------------------------------------------------------
function defsOf(C) {
  const out = [];
  for (const id of C.owned) { const u = CITADEL_UPGRADES[id]; if (u && u.kind === 'passive') out.push(u); }
  for (const id of C.perks) if (PERKS[id]) out.push(PERKS[id]);
  for (const id of C.omens) if (OMENS[id]) out.push(OMENS[id]);
  return out;
}

function applyVeteran(run) {
  const C = run.ext.citadel;
  if (!C || C.veteranDone) return;
  let lv = 1;
  for (const id of C.owned) { const u = CITADEL_UPGRADES[id]; if (u && u.heroLevel) lv = Math.max(lv, u.heroLevel); }
  if (lv <= 1) { C.veteranDone = true; return; }
  const h = run.ext.heroes && run.ext.heroes[0];
  if (!h) return; // the heroes module has not made the roster yet: try again at the first region
  lv = Math.min(lv, MAX_LEVEL);
  if ((h.level || 1) < lv) { h.level = lv; h.xp = Math.max(h.xp || 0, XP_TABLE[lv - 1] || 0); }
  C.veteranDone = true;
}

export function onRunNew(run, opts = {}) {
  if (!run.ext) run.ext = {};
  const meta = opts.meta || {};
  const owned = ownedOf(meta).filter((id) => CITADEL_UPGRADES[id]);
  // Cosmetic banner (any mode): colours only.
  const bannerId = meta.citadel && meta.citadel.banner;
  const banner = bannerId && owned.includes(bannerId) ? CITADEL_UPGRADES[bannerId] : null;
  if (banner && banner.heraldry && run.heraldry) run.heraldry = { ...run.heraldry, ...banner.heraldry };
  const mode = run.mode || opts.mode || 'campaign';
  if (mode !== 'sandbox') run.locked = computeLocked(owned);
  const choose = mode === 'campaign' || mode === 'endless';
  const perks = choose ? sanitizePerks(owned, opts.perks) : [];
  const omens = choose && omensOpen(meta) ? sanitizeOmens(opts.omens) : [];
  const C = run.ext.citadel = { owned: owned.slice(), perks, omens, ruin: ruinOf(omens), scholarUsed: false, veteranDone: false };
  const defs = defsOf(C);
  // Gold.
  for (const d of defs) if (d.gold) run.gold += d.gold;
  for (const d of defs) if (d.startGold != null) run.gold = d.startGold;
  // Sovereign health.
  let hpk = 1;
  for (const d of defs) if (d.sovMaxHp) hpk += d.sovMaxHp;
  if (hpk !== 1) { run.sov.maxHp = Math.max(60, Math.round(run.sov.maxHp * hpk)); run.sov.hp = run.sov.maxHp; }
  // Merchant prices (read by run.js makeShop).
  let shop = 1;
  for (const d of defs) if (d.shopMult) shop *= d.shopMult;
  if (shop !== 1) run.ext.shopMult = shop;
  // Relics and blueprints from the run RNG.
  const relicSpecs = defs.filter((d) => d.relic).map((d) => d.relic);
  let extraBp = 0;
  for (const d of defs) extraBp += d.blueprints || 0;
  if (relicSpecs.length || extraBp) {
    withRng(run, (r) => {
      for (const spec of relicSpecs) grantRelic(run, spec, r);
      for (let i = 0; i < extraBp; i++) {
        const pool = draftPool(run.blueprints, run.faction, run).filter((t) => !BUILDINGS[t].wonder);
        if (pool.length) run.blueprints.push(r.pick(pool));
      }
    });
  }
  applyVeteran(run);
}

// ---- Region start ------------------------------------------------------------------------
const START_KEYS = ['food', 'wood', 'stone', 'gold', 'villagers', 'caches'];
export function onRunRegion(run, node, params) {
  const C = run.ext && run.ext.citadel;
  if (!C) return;
  applyVeteran(run);
  for (const d of defsOf(C)) {
    if (d.start) for (const k of START_KEYS) if (d.start[k]) params.start[k] = (params.start[k] || 0) + d.start[k];
    if (d.mods) for (const k in d.mods) {
      if (k === 'lightMult') params.mods[k] = (params.mods[k] || 1) * d.mods[k];
      else params.mods[k] = (params.mods[k] || 0) + d.mods[k];
    }
    // Second Wind: the core rests the Sovereign 30% between regions; add the rest here.
    if (d.sovRest && run.sov) run.sov.hp = Math.min(run.sov.maxHp, run.sov.hp + Math.round(run.sov.maxHp * d.sovRest));
  }
}

export function onRegionInit(s, ctx) {
  const run = ctx && ctx.run;
  const C = run && run.ext && run.ext.citadel;
  if (!C) return;
  const X = s.ext.citadel = { owned: C.owned.slice(), perks: C.perks.slice(), omens: C.omens.slice(), draftUndo: 0 };
  s.rt.cit = null;
  // Scholar's Desk: the run's very first blueprint draft (rolled right after regionInit) gets extra options.
  if (!C.scholarUsed) {
    C.scholarUsed = true;
    let n = 0;
    for (const id of C.owned) { const u = CITADEL_UPGRADES[id]; if (u && u.draftFirst) n += u.draftFirst; }
    if (n) { s.mods.draftExtra = (s.mods.draftExtra || 0) + n; X.draftUndo = n; }
  }
  // Militia Levy: a free squad at the Hearth.
  for (const id of C.perks) {
    const p = PERKS[id];
    if (p && p.militia && UNITS[p.militia]) spawnLevy(s, p.militia, p.militiaCount || 3);
  }
}

function spawnLevy(s, type, n) {
  const h = s.rt.hearth;
  if (!h) return;
  const at = accessTile(s, h, (h.tx - 3) * T, (h.ty + h.size / 2) * T) || { tx: h.tx - 1, ty: h.ty + 1 };
  const serial = s.squads.length + (s.squadSerial || 0);
  s.squadSerial = (s.squadSerial || 0) + 1;
  const sq = { id: newId(s), bId: 0, name: 'Hearth Levy', color: SQUAD_COLORS[serial % SQUAD_COLORS.length], rx: (at.tx + 0.5) * T, ry: (at.ty + 0.5) * T, targetId: 0 };
  s.squads.push(sq);
  for (let i = 0; i < n; i++) spawnSoldier(s, type, sq, sq.rx + (i - (n - 1) / 2) * 10, sq.ry + 4);
  s.stats.trained = Math.max(0, (s.stats.trained || 0) - n); // a gift, not training
}

// ---- Simulation hooks ------------------------------------------------------------------------
const NEUTRAL = Object.freeze({ on: false, enemyMul: 1, soldierMul: 1, sight: 1, farm: 1, night: 1, winter: 1, stone: 1, herbal: 0, bloodEvery: 0, band: 0 });
/** Derived per-region numbers (cached in s.rt.cit). */
export function cit(s) {
  const rt = s.rt;
  if (rt && rt.cit) return rt.cit;
  const X = s.ext && s.ext.citadel;
  if (!X) { if (rt) rt.cit = NEUTRAL; return NEUTRAL; }
  const c = { on: true, enemyMul: 1, soldierMul: 1, sight: 1, farm: 1, night: 1, winter: 1, stone: 1, herbal: 0, bloodEvery: 0, band: 0 };
  const defs = defsOf({ owned: X.owned || [], perks: X.perks || [], omens: X.omens || [] });
  for (const d of defs) {
    if (d.enemyGuard) c.enemyMul *= 1 - d.enemyGuard;
    if (d.soldierGuard) c.soldierMul *= 1 - d.soldierGuard;
    if (d.sightMult) c.sight *= d.sightMult;
    if (d.farmMult) c.farm *= d.farmMult;
    if (d.nightMult) c.night *= d.nightMult;
    if (d.winterUpkeep) c.winter *= d.winterUpkeep;
    if (d.stoneGather) c.stone *= d.stoneGather;
    if (d.herbal) c.herbal += d.herbal;
    if (d.bloodEvery) c.bloodEvery = c.bloodEvery ? Math.min(c.bloodEvery, d.bloodEvery) : d.bloodEvery;
    if (d.extraBand) c.band = Math.max(c.band, d.extraBand);
  }
  if (rt) rt.cit = c;
  return c;
}

export function dmgMult(s, attacker, target) {
  const c = s.rt.cit || cit(s);
  if (!c.on) return 1;
  if (target.kind === 'enemy') return c.enemyMul;
  if (target.kind === 'soldier') return c.soldierMul;
  return 1;
}
export function nightMult(s) { return (s.rt.cit || cit(s)).night; }
export function sightMult(s) { return (s.rt.cit || cit(s)).sight; }
export function farmMult(s) { return (s.rt.cit || cit(s)).farm; }
export function upkeepMult(s) {
  const c = s.rt.cit || cit(s);
  return c.winter !== 1 && BUS.query.season(s) === 'winter' ? c.winter : 1;
}
export function gatherMult(s, b, k) { return k === 'stone' ? (s.rt.cit || cit(s)).stone : 1; }
export function restlessMoon(s, n) {
  const c = cit(s);
  return c.bloodEvery > 0 && n > 0 && n % c.bloodEvery === 0 && !(s.objective && s.objective.type === 'boss');
}

const HEAL_EVERY = 10; // ticks (0.5 s)
export function tick(s) {
  const X = s.ext.citadel;
  if (!X) return;
  if (X.draftUndo) { s.mods.draftExtra -= X.draftUndo; X.draftUndo = 0; }
  const c = s.rt.cit || cit(s);
  if (c.herbal && s.tick % HEAL_EVERY === 0) {
    const amt = c.herbal * HEAL_EVERY / 20, R = 4 * T;
    for (const u of s.soldiers) {
      if (u.alive && u.hp < u.maxHp && !s.rt.enemyHash.nearest(u.x, u.y, R)) u.hp = Math.min(u.maxHp, u.hp + amt);
    }
  }
}

/** Hollow Tide: one more band from an unused spawn, half the smallest band (telegraphed). */
export function wavePlan(s, wave) {
  const c = s.rt.cit || cit(s);
  if (!c.band || !wave.groups.length) return;
  const used = new Set(wave.groups.map((g) => g.sp));
  const sides = new Set(wave.groups.map((g) => g.sp && g.sp.side));
  const free = s.spawns.filter((sp) => !used.has(sp));
  if (!free.length) return;
  const sp = free.find((x) => !sides.has(x.side)) || free[0];
  let small = null;
  for (const g of wave.groups) if (g.units.length && (!small || g.units.length < small.units.length)) small = g;
  if (!small) return;
  const pool = small.units.filter((u) => u[1] !== 'warden');
  const n = Math.max(2, Math.round(pool.length * c.band));
  const units = [];
  for (let i = 0; i < n && pool.length; i++) { const u = pool[i % pool.length]; units.push([u[0], u[1] || null]); }
  wave.groups.push({ sp, units, counts: {} });
  if (!Array.isArray(wave.mods)) wave.mods = [];
  wave.mods.push({ id: 'hollow_tide', name: 'Omen: Hollow Tide', text: `An extra band of ${units.length} Hollow attacks from another side tonight.` });
}

// ---- Meta (UI layer) --------------------------------------------------------------------------
function onRunEnd(app, run) {
  const C = run.ext && run.ext.citadel;
  if (!C || !C.ruin || !run.outcome || run.outcome.result !== 'victory') return;
  const c = citadelMeta(app.meta);
  c.bestRuin = Math.max(c.bestRuin || 0, C.ruin);
}

export function factionUnlocked(meta, id) {
  return BASE_FACTIONS.includes(id) || ownedOf(meta).includes('u_' + id);
}

let registered = false;
export function register() {
  if (registered) return;
  registered = true;
  BUS.factionUnlocked = factionUnlocked;
  BUS.runNew.push(onRunNew);
  BUS.runRegion.push(onRunRegion);
  BUS.regionInit.push(onRegionInit);
  BUS.emberMult.push(citadelEmberMult);
  BUS.dmgMult.push(dmgMult);
  BUS.nightMult.push(nightMult);
  BUS.sightMult.push(sightMult);
  BUS.farmMult.push(farmMult);
  BUS.upkeepMult.push(upkeepMult);
  BUS.gatherMult.push(gatherMult);
  BUS.tick.push(tick);
  BUS.wavePlan.push(wavePlan);
  // Chain onto any earlier extra-Blood-Moon rule (the director's Twin Moons).
  const prev = BUS.query.extraBloodMoon;
  BUS.query.extraBloodMoon = (s, n) => !!(prev && prev(s, n)) || restlessMoon(s, n);
  BUS.runEnd.push(onRunEnd);
  BUS.menu.push({ id: 'citadel', label: 'Citadel', icon: 'castle', order: 1, open: (app) => openCitadel(app) });
  BUS.setup.push((container, opts, app) => citadelSetup(container, opts, app));
}
