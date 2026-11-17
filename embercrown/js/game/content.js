// Registers Phase 2 content with the core: extra buildings and their art,
// the Gloomwyrm and the Hollow Rift, objective/boss/structure systems and
// relic hooks. Import this once at boot (main.js and the Node tools do).
import { HOOKS, ART_HOOKS } from './hooks.js';
import { BUILDINGS, BUILD_ORDER } from '../data/buildings.js';
import { ENEMIES } from '../data/enemies.js';
import { RELICS } from '../data/relics.js';
import { BUILDING_ART } from '../engine/sprites.js';
import { EXTRA_BUILDINGS } from '../data/buildings-ext.js';
import { EXTRA_BUILDING_ART, drawProjectileExt } from '../engine/sprites-ext.js';
import * as STRUCT from './systems/structures.js';
import * as OBJ from './systems/objectives.js';
import * as BOSS from './systems/boss.js';
import * as BOSSART from '../engine/bossart.js';
import * as RIFTART from '../engine/riftart.js';
import { emit } from './systems/common.js';
import { migrateRunV4 } from './state.js';
import { BUS } from './hooks.js';
// Phase 3 modules. Each register() is idempotent and wires itself onto BUS.
import { register as registerFactions } from './systems/factions.js';
import { register as registerHeroes } from '../ui/heroui.js';
import { register as registerDawnCards } from '../ui/dawncardui.js'; // stream H2: Dawn Cards and the Beacon reward
import { register as registerDirector } from './systems/director.js';
import * as COL from './systems/colossus.js';
import * as KING from './systems/hollowking.js';
import * as COLART from '../engine/colossusart.js';
import * as KINGART from '../engine/kingart.js';
import { registerBiomes } from '../data/biomes-ext.js';
import { register as registerModes } from './modes.js';
import { register as registerCitadel } from './meta/citadel.js';
import { register as registerRecords } from './meta/records.js';
import { register as registerRelicsP4 } from './systems/relics-p4.js';
import { register as registerMilitary } from './systems/military.js';
import { register as registerFoes } from './systems/foes.js';
import { register as registerCivic } from './systems/civic.js';

/** Building is allowed on explored land within this many tiles of the Hearth (it replaces the
 * land-claim zones of v3). Measured centre to centre. */
export const BUILD_RADIUS = 12;
function vetoFar(s, type, tx, ty) {
  const h = s.rt && s.rt.hearth;
  const def = BUILDINGS[type];
  if (!h || !def || type === 'hearth') return null;
  const dx = tx + def.size / 2 - (h.tx + h.size / 2), dy = ty + def.size / 2 - (h.ty + h.size / 2);
  return dx * dx + dy * dy > BUILD_RADIUS * BUILD_RADIUS ? { ok: false, reason: `Too far from the Hearth (build within ${BUILD_RADIUS} tiles)` } : null;
}

let done = false;
export function registerContent() {
  if (done) return;
  done = true;
  // Buildings: data, art and build-bar placement. Brazier and Barracks become draftable too.
  Object.assign(BUILDINGS, EXTRA_BUILDINGS);
  Object.assign(BUILDING_ART, EXTRA_BUILDING_ART);
  BUILDINGS.brazier.draftable = true;
  BUILDINGS.barracks.draftable = true;
  for (const [type, def] of Object.entries(EXTRA_BUILDINGS)) {
    if (STRUCT.isWalkable && STRUCT.isWalkable(type)) def.walkable = true;
    const list = BUILD_ORDER[def.cat] || (BUILD_ORDER[def.cat] = []);
    if (!list.includes(type)) list.push(type);
  }
  // Placement range and the v4 run-save migration (it runs before any other runLoad handler).
  BUS.canPlace.push(vetoFar);
  BUS.runLoad.unshift(migrateRunV4);
  // Foes.
  ENEMIES.gloomwyrm = { ...BOSS.GLOOMWYRM_DEF, boss: true };
  ENEMIES.rift = { ...OBJ.RIFT_DEF, stationary: true };
  // Systems.
  Object.assign(HOOKS, {
    initObjective: OBJ.initObjective,
    updateObjective: OBJ.updateObjective,
    extraWaveGroups: OBJ.extraWaveGroups,
    objectiveText: OBJ.objectiveText,
    objectiveDetail: OBJ.objectiveDetail,
    updateStructures: STRUCT.updateStructures,
    onArcaneHit: STRUCT.onArcaneHit,
    farmBonus: STRUCT.farmBonus,
    upkeepCut: STRUCT.upkeepCut,
    relicHook,
  });
  // Phase 3: factions, heroes, the wave director and region modifiers, Acts II and III
  // with their bosses and lands.
  registerBiomes();
  registerFactions(); registerHeroes(); registerDirector(); registerDawnCards();
  // Phase 4: modes, meta progression and the new content.
  registerModes(); registerCitadel(); registerRecords(); registerRelicsP4(); registerMilitary();
  COL.register(); KING.register(); if (COLART.register) COLART.register(); if (KINGART.register) KINGART.register();
  // One boss per act, dispatched by the region's boss type.
  const SIM = { gloomwyrm: BOSS, colossus: COL, hollowking: KING };
  const ART = { gloomwyrm: BOSSART, colossus: COLART, hollowking: KINGART };
  const sim = (s) => SIM[s.bossType] || BOSS;
  const art = (s) => ART[s.bossType] || BOSSART;
  Object.assign(HOOKS, {
    initBoss: (s) => sim(s).initBoss(s),
    updateBoss: (s, dt) => sim(s).updateBoss(s, dt),
    bossWaveNote: (s, n) => sim(s).bossWaveNote(s, n),
    bossBar: (s) => sim(s).bossBar(s),
  });
  Object.assign(ART_HOOKS, {
    drawBoss: (g, e, x, y, t, sc) => (ART[e.type] || BOSSART).drawBoss(g, e, x, y, t, sc),
    drawBossWarnings: (g, s, t) => art(s).drawBossWarnings(g, s, t),
    bossLights: (s, p) => art(s).bossLights(s, p),
    drawRift: RIFTART.drawRift,
    riftLights: RIFTART.riftLights,
    drawProjectileExt,
  });
  // Last: the new foes, then civic (its Moonwell trims the final Blood Moon plan after every
  // other wavePlan hook).
  registerFoes(); registerCivic();
}

// Runs a named hook on every relic the region carries; first truthy result wins.
function relicHook(s, name) {
  for (const r of s.relics || []) {
    const def = RELICS[r.id];
    const fn = def && def.hooks && def.hooks[name];
    if (!fn) continue;
    const res = fn(s, { relic: r, emit: (text) => emit(s, { t: 'toast', text, tone: 'good', icon: def.icon }) });
    // Only a prevention hook stops at the first success; every dawn hook runs.
    if (res && name === 'onHearthFall') return res;
  }
  return false;
}

registerContent();
