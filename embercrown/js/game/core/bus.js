// Contract C4 (owner A; provisional until the 1a fun review): BUS hook names, tick order and
// endOfTick order (doc 12.3, 13.3). Systems plug in here instead of being imported by the core.
// Every simulation handler must be deterministic (14.1). Registration order never matters for
// the tick: systems run in TICK_ORDER slot order, and within one slot by their `order` number,
// then by name.

/** Hook lists (13.3). Deleted from the roguelite: runNew, runRegion, runMap, emberMult, draftVeto,
 *  setup, mapNode, dawnCard, beaconReward. */
export const BUS = {
  // simulation
  workGivers: [],   // work-giver objects { id, work, candidates, valid, make } (5.3, C7)
  needs: [],        // (s, col, dt) need modifiers
  thoughts: [],     // (s, col) -> extra thought ids
  recipes: [],      // (s, bench) -> extra recipe ids (specs)
  incidents: [],    // incident defs added by systems (C12)
  canPlace: [],     // (s, def, x, y, rot) -> null | { ok: false, reason }
  built: [],        // (s, b) construction finished
  removed: [],      // (s, b, destroyed) building gone
  kill: [],         // (s, victim, killer | null)
  dmgMult: [],      // (s, attacker | null, target, dmgType) -> number (multiplied together)
  // Stage 1a additions (A): the command appliers (core/apply.js) announce saved-state changes here so
  // the owners of incremental indexes (E's work indexes, K's wealth) stay exact in the same call (C13).
  placed: [],       // (s, b) a blueprint (or an instantly done structure) was added to s.bld
  designated: [],   // (s, i, before, after) the desig layer of tile i changed
  zoned: [],        // (s, zone, tiles) zone tiles were added or removed (tiles: changed indexes); zone null when deleted
  zoneCfg: [],      // (s, zone) a zone's settings changed (filter, priority, name)
  billsChanged: [], // (s, b) the bills of workbench b changed
  forbidden: [],    // (s, kind 'item' | 'bld', id, on) forbid / allow
  prioritise: [],   // (s, col, target, work) -> true when a giver took the forced job (E's think)
  // render and UI (never read by the sim)
  draw: { world: [], overlay: [] },
  hud: [], card: [], alerts: [],
};

/** Per-tick system slots in their fixed order (12.3). A slot may hold several systems. */
export const TICK_ORDER = Object.freeze([
  'spatial',     // spatial hashes rebuilt in id order (per tick, C13)
  'storyteller', // every 600 ticks: incidents, warnings, arrivals
  'raids',       // raid stages, spawning
  'think',       // saved FIFO, <= 6 colonists per tick
  'path',        // saved FIFO, shared A* budget
  'jobs',        // toil runner
  'movement',
  'engage', 'combat',
  'needs', 'mood', 'health', 'social',
  'plants', 'rot', 'fire', 'weather', 'blight',
  'animals', 'mechanisms', 'defence',
  'colony',      // wealth, tiers, research, charters, ledger counters
]);

/** endOfTick passes in their fixed order; each runs only if its dirty flag is set (12.3, C13). */
export const END_OF_TICK = Object.freeze(['regions', 'rooms', 'temperature', 'light', 'zoneFields', 'flowFields']);

const systems = new Map(TICK_ORDER.map((k) => [k, []]));
const endPasses = new Map(END_OF_TICK.map((k) => [k, null]));
let sorted = null;

/** Register a per-tick system: fn(s). Throws on an unknown slot (typos would silently not run). */
export function registerSystem(slot, name, fn, order = 0) {
  const list = systems.get(slot);
  if (!list) throw new Error(`bus: unknown tick slot ${slot}`);
  if (list.some((x) => x.name === name)) throw new Error(`bus: system ${slot}/${name} already registered`);
  list.push({ name, fn, order });
  list.sort((a, b) => a.order - b.order || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  sorted = null;
}
/** Register the single handler of an endOfTick pass: fn(s). */
export function registerEndOfTick(pass, fn) {
  if (!endPasses.has(pass)) throw new Error(`bus: unknown endOfTick pass ${pass}`);
  endPasses.set(pass, fn);
}
/** Systems in run order: [{ slot, name, fn }]. */
export function tickSystems() {
  if (!sorted) { sorted = []; for (const slot of TICK_ORDER) for (const x of systems.get(slot)) sorted.push({ slot, name: x.name, fn: x.fn }); }
  return sorted;
}
export const endOfTickPass = (pass) => endPasses.get(pass);

/** Test helper: remove every registered system and pass, and empty the hook lists. */
export function resetBus() {
  for (const list of systems.values()) list.length = 0;
  for (const k of endPasses.keys()) endPasses.set(k, null);
  sorted = null;
  for (const [k, v] of Object.entries(BUS)) {
    if (Array.isArray(v)) v.length = 0;
    else for (const kk of Object.keys(v)) v[kk].length = 0;
    void k;
  }
}

// ---- Folding helpers ----------------------------------------------------------------------
export function each(list, ...args) { for (let i = 0; i < list.length; i++) list[i](...args); }
export function product(list, ...args) { let m = 1; for (let i = 0; i < list.length; i++) m *= list[i](...args); return m; }
export function first(list, ...args) { for (let i = 0; i < list.length; i++) { const r = list[i](...args); if (r != null) return r; } return null; }
