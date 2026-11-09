// Plug-in points for Phase 2+ systems. Core simulation files call these when
// set; js/game/content.js fills them in at boot. Keeping the core free of
// direct imports lets content modules evolve without circular imports.
export const HOOKS = {
  initObjective: null,     // (s) after a region's Hearth is placed
  updateObjective: null,   // (s) every 10 ticks
  extraWaveGroups: null,   // (s, n) -> extra telegraphed wave groups for night n
  initBoss: null,          // (s) when a boss region is created
  updateBoss: null,        // (s, dt) every tick
  bossWaveNote: null,      // (s, n) -> banner text when the boss comes tonight
  updateStructures: null,  // (s, dt) every tick
  onArcaneHit: null,       // (s, projectile, target) chain-lightning jumps
  relicHook: null,         // (s, name, ...args) -> result of relic hooks
  farmBonus: null,         // (s, farm) -> extra yield fraction (Granary)
  upkeepCut: null,         // (s) -> food upkeep reduction fraction (Granary)
  // UI/read-only helpers
  objectiveText: null,     // (s) -> short HUD string
  objectiveDetail: null,   // (s) -> { title, lines }
  bossBar: null,           // (s) -> null | { name, hp, maxHp, phase }
};

// Drawing plug-ins used by the renderer (all optional).
export const ART_HOOKS = {
  drawBoss: null,          // (g, e, x, y, time, scale)
  drawBossWarnings: null,  // (g, s, time)
  bossLights: null,        // (s, push)
  drawRift: null,          // (g, e, x, y, time, scale)
  riftLights: null,        // (e, push)
  drawProjectileExt: null, // (g, p, x, y) -> true if drawn
};

// ---- Phase 3: multi-subscriber plug-in bus -----------------------------------------
// Modules push handlers onto these lists (or set map entries); the core calls them
// through each()/product()/first(). All simulation handlers must be deterministic.
export const BUS = {
  // Simulation
  regionInit: [],  // (s, ctx) once, after the Hearth/objective exist and before night 1 is planned. ctx = { run|null, node|null }
  tick: [],        // (s, dt) every tick, after enemies/boss, before projectiles
  phase: [],       // (s, phase) after the cycle enters 'day' | 'dusk' | 'night' | 'dawn'
  built: [],       // (s, b, upgraded) construction or upgrade finished
  removed: [],     // (s, b, destroyed) building gone
  kill: [],        // (s, victim, killer|null) any mover died (enemy, villager, soldier, hero, sovereign)
  canPlace: [],    // (s, type, tx, ty) -> null | { ok:false, reason }
  dmgMult: [],     // (s, attacker|null, target, dmgType) -> number (multiplied together)
  workMult: [],    // (s) -> number   cached per tick in s.rt.workMult (build, gather, farm speed)
  farmMult: [],    // (s, farm) -> number
  upkeepMult: [],  // (s) -> number   cached per tick in s.rt.upkeepMult
  goldMult: [],    // (s) -> number   cached per tick in s.rt.goldMult (taxes, markets)
  sightMult: [],   // (s) -> number   cached per tick in s.rt.sightMult
  costMult: [],    // (s, type, resKey) -> number  building cost multiplier per resource
  gatherMult: [],  // (s, building, resKey) -> number  multiplies what a woodcutter/mason brings home
  wavePlan: [],    // (s, wave) mutate tonight's plan right after it is rolled (telegraphed)
  commands: {},    // type -> (s, cmd) -> { ok, msg? }
  choose: {},      // pending.kind -> (s, index) -> { ok, msg? }
  // Run layer
  runNew: [],      // (run, opts) a new run was created (opts from the setup screen)
  runRegion: [],   // (run, node, params) before a region is created; may edit params.mods/start/extra
  runRegionEnd: [],// (run, s, summary) a region was folded back into the run
  runMap: [],      // (run, map) an act's Realm Map was just generated (dress nodes, add modifiers)
  // UI (never mutate simulation state directly: use ctl.cmd)
  hud: [],         // (hud, ctl) -> widget { update(s, dt) } ; hud.slots: resbar, cyclebar, squads, rail, corner
  card: [],        // (box, s, building, ctl) append extra sections to a building's info card
  pendingUI: {},   // pending.kind -> (ctl, s) show the dialog; answer with ctl.cmd({ t:'choose', i })
  tools: {},       // name -> { tap(ctl, p, w) -> true when finished, cancel(ctl), hint }
  tapTile: [],     // (ctl, tx, ty, w) -> true if handled (tap on empty ground)
  tapEntity: {},   // kind -> (ctl, e) tap on an entity of a custom kind (e.g. 'hero')
  mapNode: [],     // (node) -> array of extra lines for the Realm Map node panel
  // Rendering
  draw: {
    ground: [],    // (g, s, view, time) world space, after terrain and decals
    world: [],     // (g, s, view, time) world space, after sprites, before fog/lighting
    overlay: [],   // (g, s, view, time) world space, after lighting (always readable)
    screen: [],    // (g, s, w, h, time) screen space, last
    lights: [],    // (s, push) push(x, y, radius, alpha) extra light sources
    entity: {},    // kind or type -> (g, e, x, y, time, scale) draw a mover; return nothing
  },
};
export function each(list, ...a) { for (let i = 0; i < list.length; i++) list[i](...a); }
export function product(list, ...a) { let m = 1; for (let i = 0; i < list.length; i++) { const v = list[i](...a); if (typeof v === 'number' && isFinite(v)) m *= v; } return m; }
export function first(list, ...a) { for (let i = 0; i < list.length; i++) { const v = list[i](...a); if (v) return v; } return null; }

// Cross-module queries with safe defaults; the owning module replaces them in register().
BUS.query = {
  inTerritory: (s, x, y) => true,   // territory.js: is this world point inside the realm's land?
  season: (s) => 'summer',          // seasons.js: 'spring' | 'summer' | 'autumn' | 'winter'
  weather: (s) => 'clear',          // weather.js: 'clear' | 'rain' | 'fog' | 'storm' | 'heat' | 'snow'
  claimRule: (s, zone) => null,     // factions.js: null, or a reason string why this zone cannot be claimed yet
};
