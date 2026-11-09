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
    initBoss: BOSS.initBoss,
    updateBoss: BOSS.updateBoss,
    bossWaveNote: BOSS.bossWaveNote,
    bossBar: BOSS.bossBar,
    updateStructures: STRUCT.updateStructures,
    onArcaneHit: STRUCT.onArcaneHit,
    farmBonus: STRUCT.farmBonus,
    upkeepCut: STRUCT.upkeepCut,
    relicHook,
  });
  Object.assign(ART_HOOKS, {
    drawBoss: BOSSART.drawBoss,
    drawBossWarnings: BOSSART.drawBossWarnings,
    bossLights: BOSSART.bossLights,
    drawRift: RIFTART.drawRift,
    riftLights: RIFTART.riftLights,
    drawProjectileExt,
  });
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
