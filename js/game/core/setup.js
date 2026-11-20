// Sim setup and the new-colony flow (owner A; doc 12.3, 13.1, 14.6).
//
//   installSim(opts)   wires every workstream's systems into the bus in one fixed order: content,
//                      A's command appliers, then B (world, pathing), E (work), F (people),
//                      H (threat, defence), K (colony, animals). Each install is idempotent; owners'
//                      appliers registered later replace A's defaults. The tick order itself is
//                      fixed by bus.TICK_ORDER, so the install order only decides who wins a hook.
//   foundColony(opts)  a new colony: map, the Hearth, the starting band and their stock, ready to tick.
//
// Both are deterministic: the colony depends only on (seed, opts), never on wall-clock time.

import { createColony, initRuntime } from './state.js';
import { resetBus } from './bus.js';
import { resetAppliers } from './commands.js';
import { TER, TER_BUILDABLE, TER_PASSABLE, TER_WATER, W, H, N, PLANE, zS, idx, inB, getBit } from './grid.js';
import { nextU32 } from './rand.js';
import { START_TICK } from './time.js';
import { DIFFICULTIES } from './schema.js';
import { installContent, def, all, structDef, sizeOf } from './content.js';
import { installCommands, addBuilding } from './apply.js';
import { installWorld, setExplored } from '../world/terrain.js';
import { hearthStartFuel } from '../world/fuel.js';
import { plantCode } from '../world/defs.js';
import { buildStubMap } from '../world/stubmap.js';
import { generateWorld } from '../world/mapgen.js';
import { generateWorld3 } from '../world/mapgen3.js';
import { installMovement } from '../systems/pathing.js';
import { installWork } from '../work/index.js';
import { setMover } from '../work/jobs.js';
import { spawn as spawnItem } from '../work/items.js';
import { installPeople } from '../people/index.js';
import { startingBand, spawnColonist } from '../people/colonists.js';
import { installThreat } from '../threat/index.js';
import { installDefence } from '../defence/index.js';
import { installColony } from '../colony/index.js';
import { installFall } from '../colony/fall.js';
import { installAnimals } from '../animals/index.js';

const STAGES = ['1a', '1b', '2', '3'];
let installed = null;

/**
 * Register every system for a stage. Idempotent for the same options.
 * @param {{ stage?: string, reset?: boolean, checks?: boolean }} [opts]
 *   reset: empty the bus and the applier table first (tests); checks: E's debug tick checks
 *   (reservations equal rebuildFromJobs, item caches consistent) that throw on the first leak.
 * @returns {{ stage: string, removeChecks: () => void }}
 */
export function installSim({ stage = '1a', reset = false, checks = false } = {}) {
  if (!STAGES.includes(stage)) throw new Error(`installSim: unknown stage ${stage}`);
  if (reset) { resetBus(); resetAppliers(); installed = null; }
  if (installed && installed.stage === stage && installed.checks === checks) return installed;
  const at = (st) => STAGES.indexOf(stage) >= STAGES.indexOf(st);
  installContent();
  installCommands();
  installWorld({ fuel: at('1b') });   // Stage 1b: the Hearth and lights burn fuel (world/fuel.js)
  // Movement along paths is B's (A* through the saved queue, then walking); E's straight-line
  // stub mover is off.
  const removeChecks = installWork({ think: true, stubMove: false, checks });
  installMovement(setMover);
  installPeople({ needs: at('1b'), mood: at('1b'), breaks: at('1b'), health: at('1b'), social: at('2'), ember: at('2') });
  installThreat({ storyteller: at('1b'), raids: at('1b'), commands: true });
  if (at('1b')) installDefence({});
  installColony({ tiers: at('1b'), ledger: at('1b'), research: at('2'), charters: at('3'), deeds: at('2') });
  installAnimals({ ai: at('2'), giver: at('2') });
  // Stage 2.9 (EMBERCROWN-FORTRESS.md 1.3): the hourly fall check, from 1b (when colonists can be downed and die)
  if (at('1b')) installFall();
  installed = { stage, checks, removeChecks };
  return installed;
}

// ---- World generation -------------------------------------------------------------------------
/**
 * The world generator: fn(s) on a fresh createColony state. Either
 *   - writes s.L only (before initRuntime) and returns { hearth: [x, y] } or null (foundColony then
 *     builds the runtime, finds a Hearth site and reveals the ground around it), or
 *   - builds the whole world itself and returns { done: true, spawn?: [tileIndex] }: the Hearth is
 *     placed, s.colony.hearth set, initRuntime run and the opening reveal done (B's generateWorld).
 * The default is B's mapgen (3.2, slice steps); 'stub' selects the provisional stub map.
 */
export const WORLDS = Object.freeze({
  mapgen: (s) => { const info = generateWorld(s); return { done: true, spawn: info.spawn || null, info }; },
  stub: (s) => provisionalWorld(s),
  // Stage Z1: the fortress (128 x 128 x 20, mapgen3); foundColony picks it for d > 1
  fortress: (s) => { const info = generateWorld3(s); return { done: true, spawn: info.spawn || null, info }; },
});
let worldGen = WORLDS.mapgen;
export function setWorldGenerator(fn) { worldGen = (typeof fn === 'string' ? WORLDS[fn] : fn) || WORLDS.mapgen; }

/**
 * Provisional Stage 1a world until B's mapgen (3.2) lands: B's 'bench' stub map (an east massif
 * roofed by depth, tunnels, a river with fords, a lake) without its test rooms, plus seeded trees.
 */
export function provisionalWorld(s) {
  buildStubMap(s, 'bench', s.seed);
  s.bld = [];
  const oak = plantCode('oak'), pine = plantCode('pine');
  const L = s.L;
  for (let i = 0; i < N; i++) {
    const t = L.terrain[i];
    if (t !== TER.GRASS && t !== TER.MEADOW) continue;
    const r = nextU32(s, 'gen') % 1000;
    if (r < 60 && (oak || pine)) { L.plant[i] = r < 20 && pine ? pine : oak || pine; L.growth[i] = 255; }
  }
  return null;
}

/** A start site: the top-left of a free w x h area (with a 2-tile margin) nearest to (x, y), ring by ring. */
export function findSite(s, x, y, w, h, margin = 2) {
  const ok = (x0, y0) => {
    for (let yy = y0 - margin; yy < y0 + h + margin; yy++) {
      for (let xx = x0 - margin; xx < x0 + w + margin; xx++) {
        if (!inB(xx, yy)) return false;
        const i = idx(xx, yy), t = s.L.terrain[i];
        if (!TER_BUILDABLE[t] || TER_WATER[t] || s.rt.occ[i] >= 0) return false;
      }
    }
    return true;
  };
  const R = Math.max(W, H);
  for (let r = 0; r < R; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      if (ok(x + dx, y + dy)) return [x + dx, y + dy];
    }
  }
  return null;
}
/** Where the provisional map wants its Hearth: on open ground about 12 tiles west of the rock face, mid-map. */
function defaultHearthSpot(s) {
  const y = H >> 1;
  let face = W - 1;
  for (let x = 0; x < W; x++) if (s.L.terrain[idx(x, y)] === TER.ROCK) { face = x; break; }
  return [Math.max(2, face - 12), y];
}

/** Free tiles around (cx, cy) for spawning, nearest first (ring order). */
function freeTilesAround(s, cx, cy, n, z = 0) {
  const out = [];
  for (let r = 1; r < 12 && out.length < n; r++) {
    for (let dy = -r; dy <= r && out.length < n; dy++) for (let dx = -r; dx <= r && out.length < n; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = cx + dx, y = cy + dy;
      if (!inB(x, y)) continue;
      const i = idx(x, y, z);
      if (TER_PASSABLE[s.L.terrain[i]] && !TER_WATER[s.L.terrain[i]] && s.rt.occ[i] < 0) out.push([x, y]);
    }
  }
  return out;
}

/**
 * Found a colony (title > New colony). Deterministic in (seed, opts).
 * @param {{ seed: number|string, name?: string, start?: string, w?: number, id?: string, reveal?: number,
 *           difficulty?: string, storyteller?: string }} opts
 *   difficulty: one of schema DIFFICULTIES (default steadfast; 'hard' is threat x1.4 with the normal save
 *   slots and backups: there is no Ironhold, EMBERCROWN-FORTRESS.md F9). storyteller: a storytellers.js id
 *   (default: the data's default).
 * @returns the state, runtime built, with the Hearth (done), the band and the start stock
 */
export const FORTRESS_D = 20, FORTRESS_ZS = 14;   // EMBERCROWN-FORTRESS.md 2.1
export function foundColony({ seed, name = 'The Hold', start = null, w = 128, id, reveal = 24, world = null, difficulty = null, storyteller = null, d = 1 } = {}) {
  // d > 1: a fortress (Stage Z1): the world is mapgen3's and the band and stock stand on the surface level
  const deep = d > 1;
  const s = createColony(seed, deep ? { w, name, id, d, zS: FORTRESS_ZS } : { w, name, id });
  s.tick = START_TICK;   // day 1, 06:00 (10.9)
  if (difficulty !== null && difficulty !== undefined) {
    if (!DIFFICULTIES.includes(difficulty)) throw new Error(`foundColony: unknown difficulty ${difficulty}`);
    s.colony.difficulty = difficulty;
  }
  if (storyteller) {
    if (!def('storyteller', storyteller)) throw new Error(`foundColony: unknown storyteller ${storyteller}`);
    s.colony.storyteller = storyteller;
  }
  const st = (start && def('start', start)) || all('start').find((x) => x.default) || null;
  if (st) s.colony.starts = st.id;
  const gen = deep ? WORLDS.fortress : (world ? (typeof world === 'string' ? WORLDS[world] : world) : worldGen) || worldGen;
  const site = gen(s) || {};
  const hd = structDef('hearth');
  const [hw, hh] = sizeOf(hd, 0);
  let at;
  if (site.done) {
    const hb = s.colony.hearth && s.colony.hearth.id !== null ? s.bld[s.colony.hearth.id] : null;
    at = hb ? [hb.x, hb.y] : defaultHearthSpot(s);
  } else {
    initRuntime(s);
    // the Hearth
    const want = site.hearth || defaultHearthSpot(s);
    at = site.hearthPlaced ? want : findSite(s, want[0], want[1], hw, hh) || want;
    if (hd) {
      const hearth = addBuilding(s, 'hearth', at[0], at[1], 0, null, { st: 'done' });
      s.colony.hearth = { id: hearth.id, lvl: 1, fuel: 0 };
    }
  }
  hearthStartFuel(s);   // Stage 1b: the Hearth starts with FUEL.startDays of fuel (no-op in 1a)
  const cx = at[0] + (hw >> 1), cy = at[1] + (hh >> 1);
  // explored ground around the Hearth when the generator left no fog data (B's fog reveals the rest)
  let anyFog = false;
  for (let k = 0; k < s.L.fog.length && !anyFog; k++) if (s.L.fog[k]) anyFog = true;
  if (!anyFog) {
    for (let y = cy - reveal; y <= cy + reveal; y++) for (let x = cx - reveal; x <= cx + reveal; x++) {
      if (inB(x, y) && (x - cx) * (x - cx) + (y - cy) * (y - cy) <= reveal * reveal) setExplored(s, idx(x, y), true);
    }
  }
  // the band: the generator's start spots first, then free tiles below the Hearth
  const band = st ? startingBand(s, st.id) : [];
  const lz = deep ? zS : 0;
  const spots = (site.spawn || []).map((i) => [i % W, ((i % PLANE) / W) | 0]).concat(freeTilesAround(s, cx, cy + (hh >> 1) + 1, band.length + 40, lz));
  band.forEach((c, k) => { const p = spots[k] || [cx, cy]; spawnColonist(s, c, p[0], p[1]); if (deep) c.z = lz; });
  // the start stock, west of the Hearth (unknown kinds are skipped until G's items exist)
  if (st && st.items) {
    let k = band.length + 2;
    for (const key of Object.keys(st.items).sort()) {
      const [kind, mat] = key.split(':');
      if (!def('item', kind)) continue;
      const p = spots[k++] || [cx - 3, cy];
      spawnItem(s, kind, mat || null, 1, st.items[key], p[0], p[1], deep ? { z: lz } : {});
    }
  }
  return s;
}

/** Is tile i explored? (helper for UI previews and tests) */
export const exploredAt = (s, i) => getBit(s.L.fog, i) === 1;
