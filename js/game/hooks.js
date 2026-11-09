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
