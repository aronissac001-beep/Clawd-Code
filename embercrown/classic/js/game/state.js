// Run and region state: creation, runtime caches and (de)serialisation.
// Everything the simulation needs lives in one plain object so it can be
// saved as JSON at any moment. Derived caches live under `s.rt`, which is
// never saved and is rebuilt by initRuntime().
import { RNG, hashString } from '../engine/rng.js';
import { BAL, DEFAULT_MODS } from '../data/balance.js';
import { HOOKS, BUS, each } from './hooks.js';
import { makeDraft } from './systems/cycle.js';
import { generateMap } from './mapgen.js';
import { N, T, idx, ctr } from './grid.js';
import { createField } from './systems/pathing.js';
import { SpatialHash } from './spatial.js';
import { TINCTURES, METALS, DIVISIONS, SIGILS, REALM_PREFIX, REALM_SUFFIX } from '../data/heraldry.js';
import { createBuilding, spawnVillager, spawnSovereign } from './systems/common.js';
import { planNight } from './systems/waves.js';
import { revealAround } from './systems/fog.js';

export const STATE_VERSION = 4;

export function makeHeraldry(rng) {
  const field = rng.pick(TINCTURES).hex;
  const charge = rng.pick(METALS).hex;
  let second = rng.pick(TINCTURES).hex;
  if (second === field) second = TINCTURES[(TINCTURES.findIndex((t) => t.hex === field) + 2) % TINCTURES.length].hex;
  return {
    field, charge, second,
    division: rng.pick(DIVISIONS),
    sigil: rng.pick(SIGILS),
    name: rng.pick(REALM_PREFIX) + rng.pick(REALM_SUFFIX),
  };
}

// Standalone region (tools, tests): a lone survive-the-nights region.
export function createRun({ seedText, difficulty = 'standard' }) {
  const diff = BAL.difficulty[difficulty] || BAL.difficulty.standard;
  const seed = hashString(seedText.trim().toUpperCase());
  return createRegion({
    seedText, difficulty, heraldry: makeHeraldry(new RNG(seed ^ 0x5bd1e995)),
    objective: { type: 'survive', nights: diff.nights, done: false },
    blueprints: [], // empty = every building is available
    standalone: true,
  });
}

/**
 * Build a region from run parameters.
 * opts: { seedText, difficulty, heraldry, biome, nodeType, step, act, mods, start, gold, sov,
 *         relics, blueprints, objective, raiders, firstDraft, standalone }
 */
export function createRegion(opts) {
  const { seedText, difficulty = 'standard' } = opts;
  const seed = hashString(seedText.trim().toUpperCase());
  const st0 = opts.start || {};
  const map = generateMap(seed, opts.biome || 'greenvale', { caches: 4 + (st0.caches || 0) });
  const diff = BAL.difficulty[difficulty] || BAL.difficulty.standard;
  const rng = new RNG(seed ^ 0x5bd1e995);
  const st = BAL.start;
  const m = diff.startMult;
  const s = {
    v: STATE_VERSION,
    seedText: seedText.trim().toUpperCase(), seed, difficulty, faction: opts.faction || 'dawnhold', biome: map.biome,
    bossType: opts.bossType || 'gloomwyrm',
    nodeType: opts.nodeType || 'region', step: opts.step || 0, act: opts.act || 1, standalone: !!opts.standalone,
    mode: opts.mode || 'campaign', locked: opts.locked ? JSON.parse(JSON.stringify(opts.locked)) : null,
    rng: rng.getState(),
    tick: 0, time: 0,
    terrain: map.terrain, nodeGrid: map.nodeGrid,
    occ: new Int32Array(N * N), fog: new Uint8Array(N * N), lit: new Uint8Array(N * N),
    nodes: map.nodes, spawns: map.spawns, caches: map.caches,
    buildings: [], villagers: [], soldiers: [], enemies: [], projectiles: [], squads: [], heroes: [],
    sovereign: null, decals: [], banners: [],
    ext: {}, // plug-in systems keep their saved region state here (ext.heroes, ext.director, ...)
    res: {
      food: Math.round(st.food * m) + (st0.food || 0), wood: Math.round(st.wood * m) + (st0.wood || 0),
      stone: Math.round(st.stone * m) + (st0.stone || 0),
      gold: (opts.gold != null ? opts.gold : Math.round(st.gold * m)) + (st0.gold || 0),
    },
    mods: { ...DEFAULT_MODS, ...(opts.mods || {}) },
    cycle: { phase: 'day', t: 0, night: 0 },
    wave: null, spawnQueue: [],
    objective: opts.objective || { type: 'survive', nights: diff.nights, done: false },
    beaconReady: false, bonusNights: 0, readyNight: 0,
    raiders: !!opts.raiders,
    relics: opts.relics || [], blueprints: opts.blueprints || [],
    boss: null,
    pending: null, outcome: null,
    stats: { kills: 0, built: 0, villagersLost: 0, soldiersLost: 0, trained: 0, cachesFound: 0, peakPop: 0, produced: { food: 0, wood: 0, stone: 0, gold: 0 } },
    heraldry: opts.heraldry,
    usedBoons: [],
    timers: { growth: 0, starve: 0, fog: 0 },
    flow: { food: 0, wood: 0, stone: 0, gold: 0 },
    rateHist: [], rateT: 0,
    tutorial: {},
    nextId: 1,
  };
  s.rng = rng.getState();
  initRuntime(s);

  // Founding: the Hearth, one cottage, villagers and the Sovereign.
  const h = createBuilding(s, 'hearth', map.hearth.tx, map.hearth.ty, true);
  s.rt.hearth = h;
  placeStarter(s, 'house', h.tx + 4, h.ty - 1);
  const nv = st.villagers + (st0.villagers || 0);
  for (let i = 0; i < nv; i++) spawnVillager(s, ctr(h.tx + 1) + ((i % 7) - 3) * 9, (h.ty + 3) * T + 8 + Math.floor(i / 7) * 8);
  const sv = spawnSovereign(s, ctr(h.tx + 1), (h.ty + 3) * T + 22);
  if (opts.sov) { sv.maxHp = opts.sov.maxHp; sv.hp = Math.max(1, Math.min(opts.sov.maxHp, opts.sov.hp)); }
  revealAround(s, ctr(h.tx + 1), ctr(h.ty + 1), BAL.fog.hearthSight);
  if (HOOKS.initObjective) HOOKS.initObjective(s);
  if (s.objective.type === 'boss' && HOOKS.initBoss) HOOKS.initBoss(s);
  each(BUS.regionInit, s, { run: opts.run || null, node: opts.node || null, extra: opts.extra || {} });
  planNight(s);
  // Regions open with a blueprint draft when there is anything left to learn.
  if (!opts.standalone) {
    // The opening draft goes first; anything a plug-in queued at regionInit waits behind it.
    const d = makeDraft(s, true, !!opts.firstDraft);
    if (d) { if (s.pending) (s.pendingQueue || (s.pendingQueue = [])).unshift(s.pending); s.pending = d; }
  }
  return s;
}

function placeStarter(s, type, tx, ty) {
  for (let y = ty; y < ty + 1; y++) for (let x = tx; x < tx + 1; x++) {
    const i = idx(x, y);
    if (s.nodeGrid[i]) { const n = s.nodes.find((q) => q.id === s.nodeGrid[i]); if (n) n.amount = 0; s.nodeGrid[i] = 0; }
  }
  s.nodes = s.nodes.filter((n) => n.amount > 0);
  createBuilding(s, type, tx, ty, true);
}

// Rebuild all derived, unsaved caches from the plain state.
export function initRuntime(s) {
  s.rt = {
    bById: new Map(), eById: new Map(), nById: new Map(),
    hearth: null,
    flowDirty: true, lightDirty: true,
    fieldN: createField(), fieldP: createField(),
    friendHash: new SpatialHash(64, 512), enemyHash: new SpatialHash(64, 1024),
    fx: [], pathBudget: 0, terrainDirty: true, rng: new RNG(s.rng),
  };
  for (const b of s.buildings) { s.rt.bById.set(b.id, b); if (b.type === 'hearth') s.rt.hearth = b; }
  for (const n of s.nodes) s.rt.nById.set(n.id, n);
  for (const list of [s.villagers, s.soldiers, s.enemies, s.heroes || []]) for (const e of list) s.rt.eById.set(e.id, e);
  if (s.sovereign) s.rt.eById.set(s.sovereign.id, s.sovereign);
  s.rt.workMult = s.rt.upkeepMult = s.rt.goldMult = s.rt.sightMult = 1;
}

// ---- Serialisation --------------------------------------------------------
const TYPED = ['terrain', 'nodeGrid', 'occ', 'fog', 'lit'];

export function serializeState(s) {
  s.rng = s.rt.rng.getState();
  const out = {};
  for (const k of Object.keys(s)) {
    if (k === 'rt') continue;
    out[k] = TYPED.includes(k) ? Array.from(s[k]) : s[k];
  }
  return JSON.parse(JSON.stringify(out));
}

export function deserializeState(data) {
  const s = migrateState(data);
  s.terrain = Uint8Array.from(s.terrain);
  s.nodeGrid = Int32Array.from(s.nodeGrid);
  s.occ = Int32Array.from(s.occ);
  s.fog = Uint8Array.from(s.fog);
  s.lit = Uint8Array.from(s.lit);
  for (const list of [s.villagers, s.soldiers, s.enemies, s.heroes]) for (const e of list) { e.px = e.x; e.py = e.y; }
  if (s.sovereign) { s.sovereign.px = s.sovereign.x; s.sovereign.py = s.sovereign.y; }
  initRuntime(s);
  return s;
}

// Schema migrations: each step upgrades version n to n+1.
const MIGRATIONS = {
  // 0 -> 1: early prototype saves had no tutorial map or mods.
  0: (s) => { s.tutorial = s.tutorial || {}; s.mods = Object.assign({ buildSpeed: 0, farmYield: 0, towerRange: 0, lightRadius: 0, soldierDmg: 0 }, s.mods || {}); s.v = 1; return s; },
  // 1 -> 2: Phase 2 regions carry objectives, full modifiers, blueprints and relics.
  1: (s) => {
    s.mods = { ...DEFAULT_MODS, ...(s.mods || {}) };
    s.nodeType = s.nodeType || 'region'; s.step = s.step || 0; s.act = s.act || 1;
    s.objective = { type: 'survive', nights: (s.objective && s.objective.nights) || 7, done: false };
    // Phase 1 regions could build all nine buildings; keep every one of them.
    s.blueprints = s.blueprints || ['house', 'farm', 'lumber', 'quarry', 'wall', 'gate', 'tower', 'brazier', 'barracks'];
    s.relics = s.relics || []; s.boss = s.boss || null;
    // A Phase 1 region already past its goal counts bonus nights from the goal, not from night 0.
    if (s.beaconReady) { s.objective.done = true; s.readyNight = s.cycle.night - (s.bonusNights || 0); }
    else s.readyNight = s.readyNight || 0;
    s.stats.produced = s.stats.produced || { food: 0, wood: 0, stone: 0, gold: 0 };
    s.v = 2; return s;
  },
  // 2 -> 3: Phase 3 adds heroes, plug-in system state, faction and storyteller.
  2: (s) => {
    s.heroes = s.heroes || []; s.ext = s.ext || {};
    s.faction = s.faction || 'dawnhold'; s.bossType = s.bossType || 'gloomwyrm';
    s.v = 3; return s;
  },
  // 3 -> 4: the rework cuts (EMBERCROWN-REWORK.md H1). See migrateV4 below.
  3: (s) => migrateV4(s),
};

// ---- v4: the rework cuts ------------------------------------------------------------------
// Removed systems: bounty flags (escrow refunded), Morale/Dread and decrees, territory zones and
// beast lairs, seasons, weather, building combos, the storyteller and in-region events, the
// Mirefolk and the Pale Court.
// v4 contract for other modules: a 'survive' region holds `objective.nights` nights and its
// last one is the Long Night (it replaces the every-6th-night Blood Moon); `s.wave.long` marks a
// planned Long Night (an old planned Blood Moon converts to one). Hero movers no longer carry
// bountyId / skipB / skipT / purse. Pending choices of kind 'decree' and 'regionEvent' no
// longer exist. Every step below is idempotent and tolerates missing fields.
/** Region ext keys of cut systems (dropped). */
export const CUT_EXT_KEYS = ['mood', 'decrees', 'territory', 'season', 'weather', 'combos'];
/** Pending choice kinds of cut systems (dropped). */
export const CUT_PENDING = ['decree', 'regionEvent'];
/** Mover types of cut systems: beast lairs and their wild guards, Dread's wailers. */
export const CUT_FOES = ['lair', 'direwolf', 'spider', 'troll', 'wailer'];
const CUT_FACTIONS = { mirefolk: 1, palecourt: 1 };
const CUT_BUILDINGS = { bogshrine: 1, ossuary: 1 };
const CUT_UNITS = { hexcaster: 1, bonelegion: 1 };

/** Gold escrowed on the region's bounty flags (refunded by the v4 migration). */
export function bountyEscrow(s) {
  const B = s && s.ext && s.ext.heroes && s.ext.heroes.bounties;
  let gold = 0;
  if (Array.isArray(B)) for (const b of B) if (b && typeof b.gold === 'number' && b.gold > 0) gold += b.gold;
  return gold;
}

function migrateV4(s) {
  const ext = s.ext && typeof s.ext === 'object' ? s.ext : (s.ext = {});
  s.res = s.res || { food: 0, wood: 0, stone: 0, gold: 0 };
  // Bounties: the escrowed gold comes home now; flags and hero bookkeeping go.
  const back = bountyEscrow(s);
  if (back) s.res.gold = (s.res.gold || 0) + back;
  // The flags are emptied rather than deleted so the hero code of this build (stream C removes
  // the bounty system and these two keys with it) still finds the list it iterates.
  const H = ext.heroes;
  if (H && typeof H === 'object' && 'bounties' in H) H.bounties = [];
  for (const e of s.heroes || []) {
    delete e.bountyId; delete e.skipB; delete e.skipT; delete e.purse;
    if (e.gk === 'bounty') { e.gk = 'idle'; e.path = null; e.targetId = 0; }
  }
  // Plug-in state of cut systems.
  for (const k of CUT_EXT_KEYS) delete ext[k];
  const D = ext.director;
  if (D && typeof D === 'object') { delete D.eventsSeen; delete D.lastEventDay; delete D.last; D.buffs = []; D.bv = (D.bv || 0) + 1; }
  if (ext.civic && typeof ext.civic === 'object') delete ext.civic.morale;
  if (ext.factions && typeof ext.factions === 'object') {
    for (const k of ['morale', 'souls', 'grow', 'fade', 'low']) delete ext.factions[k];
  }
  if (ext.records && typeof ext.records === 'object') { delete ext.records.bloodWinter; delete ext.records.ns; }
  delete s.storyteller;
  if (CUT_FACTIONS[s.faction]) s.faction = 'dawnhold';
  // Movers of cut systems (lairs, wild beasts, wailers), cut faction units and buildings.
  const cutFoe = (e) => e && (CUT_FOES.includes(e.type) || e.wild);
  s.enemies = (s.enemies || []).filter((e) => !cutFoe(e));
  s.soldiers = (s.soldiers || []).filter((u) => !(u && CUT_UNITS[u.type]));
  for (const u of s.soldiers) if (u.poison) delete u.poison;
  for (const e of s.enemies) { delete e.poison; delete e.curse; }
  if (Array.isArray(s.buildings) && Array.isArray(s.occ)) {
    for (const b of s.buildings) {
      if (!CUT_BUILDINGS[b.type]) continue;
      for (let y = b.ty; y < b.ty + b.size; y++) for (let x = b.tx; x < b.tx + b.size; x++) {
        const i = idx(x, y);
        if (s.occ[i] === b.id) s.occ[i] = 0;
      }
    }
    s.buildings = s.buildings.filter((b) => !CUT_BUILDINGS[b.type]);
  }
  if (Array.isArray(s.blueprints)) s.blueprints = s.blueprints.filter((t) => !CUT_BUILDINGS[t]);
  if (Array.isArray(s.spawnQueue)) s.spawnQueue = s.spawnQueue.filter((q) => q && !CUT_FOES.includes(q.type));
  if (s.wave && Array.isArray(s.wave.groups)) {
    for (const g of s.wave.groups) if (Array.isArray(g.units)) g.units = g.units.filter((u) => !(Array.isArray(u) && CUT_FOES.includes(u[0])));
    s.wave.total = s.wave.groups.reduce((a, g) => a + ((g.units && g.units.length) || 0), 0);
  }
  // Pending choices of cut kinds are dropped (the next queued one, if any, moves up).
  const keep = (p) => p && !CUT_PENDING.includes(p.kind);
  const q = Array.isArray(s.pendingQueue) ? s.pendingQueue.filter(keep) : [];
  if (s.pending && !keep(s.pending)) s.pending = q.length ? q.shift() : null;
  if (Array.isArray(s.pendingQueue) || q.length) s.pendingQueue = q;
  // Blood Moon countdown -> Long Night indexing: a survive region now ends on its Long Night,
  // at most 3 nights in, but never before the night that is coming next.
  const ob = s.objective;
  if (ob && ob.type === 'survive' && !ob.done && typeof ob.nights === 'number') {
    const night = (s.cycle && s.cycle.night) || 0;
    ob.nights = Math.min(ob.nights, Math.max(3, night + 1));
  }
  if (s.wave && s.wave.blood) s.wave.long = true;
  s.v = 4;
  return s;
}

/** Run-layer side of v4 (BUS.runLoad, registered in content.js): drops cut run state. */
export function migrateRunV4(run) {
  if (!run || typeof run !== 'object') return run;
  delete run.storyteller;
  const X = run.ext;
  if (X && typeof X === 'object') {
    for (const k of ['mood', 'decrees', 'calendar', 'wxCarry']) delete X[k];
    for (const h of Array.isArray(X.heroes) ? X.heroes : []) if (h) delete h.purse;
    for (const h of Array.isArray(X.fallen) ? X.fallen : []) if (h) delete h.purse;
  }
  if (CUT_FACTIONS[run.faction]) run.faction = 'dawnhold';
  if (Array.isArray(run.blueprints)) run.blueprints = run.blueprints.filter((t) => !CUT_BUILDINGS[t]);
  return run;
}
export function migrateState(data) {
  let s = data;
  if (typeof s !== 'object' || !s || !Array.isArray(s.terrain)) throw new Error('Save data is not a realm.');
  let guard = 0;
  while ((s.v || 0) < STATE_VERSION && guard++ < 20) {
    const m = MIGRATIONS[s.v || 0];
    if (!m) throw new Error('No migration from save version ' + s.v);
    s = m(s);
  }
  if (s.v > STATE_VERSION) throw new Error('This save comes from a newer version of Embercrown.');
  return s;
}
