// People (owner F): one entry point that plugs the people systems into the sim.
// Importing has no side effects; installPeople() registers tick systems, command appliers and the
// work hooks (speed, XP) that E's toil runner calls. A (sim setup) and J (determinism, bot) call
// it after resetBus(), like installWork().
//
// Stage 1a: skills, XP, traits and roles only (colonists do not eat, sleep or mope).
// Stage 1b: installPeople({ needs: true, mood: true, breaks: true, health: true }): Food, Rest and
// Light, the need / break / rest jobs through E's think hooks (needjobs.js), condition thoughts,
// the two minor breaks, simple health (clotting, bed rest, healing, starvation) and "A colonist died".
// Stage 2 (social: true) adds Joy, the major breaks and the rest of the stage-tagged content.
// The people stage (defs.inStage) is opts.stage, else '2' with social, '1b' with needs, else '1a'.

import { BUS, registerSystem, tickSystems } from '../core/bus.js';
import { setWorkHooks } from '../work/jobs.js';
import { workSpeed, awardXp, skillsDaySystem } from './skills.js';
import { needsSystem } from './needs.js';
import { moodSystem, setConditionThoughts, addThoughtAll } from './mood.js';
import { breaksSystem } from './breaks.js';
import { healthSystem, loadHealthBalance, setSimpleHealth } from './health.js';
import { installNeedJobs } from './needjobs.js';
import { setPeopleStage } from './defs.js';
import { socialSystem } from './social.js';
import { emberSystem } from './embertouch.js';
import { installRoleCommands } from './roles.js';
import { installDraftCommands } from './draft.js';
import { installPerkCommands } from './perks.js';

export * as colonists from './colonists.js';
export * as skills from './skills.js';
export * as roles from './roles.js';
export * as needs from './needs.js';
export * as mood from './mood.js';
export * as breaks from './breaks.js';
export * as health from './health.js';
export * as social from './social.js';
export * as draft from './draft.js';
export * as perks from './perks.js';
export * as embertouch from './embertouch.js';
export * as needjobs from './needjobs.js';
export { setPeopleContent, peopleStage } from './defs.js';

/** BUS.kill: everyone else takes "A colonist died" (a colonist victim only). */
function onKill(s, victim) { if (victim && Array.isArray(victim.sk)) addThoughtAll(s, 'colonist_died', victim.id); }

const has = (slot, name) => tickSystems().some((x) => x.slot === slot && x.name === name);
const reg = (slot, name, fn, order = 0) => { if (!has(slot, name)) registerSystem(slot, name, fn, order); };

/**
 * Register F's systems (idempotent).
 * @param {{ needs?: boolean, mood?: boolean, breaks?: boolean, health?: boolean, social?: boolean,
 *           ember?: boolean, commands?: boolean, workHooks?: boolean }} [opts]
 */
export function installPeople({ needs = false, mood = false, breaks = false, health = false, social = false, ember = false, commands = true, workHooks = true, stage = null } = {}) {
  setPeopleStage(stage || (social ? '2' : needs || mood || breaks || health ? '1b' : '1a'));
  if (workHooks) setWorkHooks({ speed: workSpeed, xp: awardXp });
  installNeedJobs(needs);
  setConditionThoughts(needs && mood);
  setSimpleHealth(health);
  if (health) loadHealthBalance();
  if (mood && !BUS.kill.includes(onKill)) BUS.kill.push(onKill);
  reg('needs', 'skills-day', skillsDaySystem, -10);
  if (needs) reg('needs', 'needs', needsSystem);
  if (mood) reg('mood', 'mood', moodSystem);
  if (breaks) reg('mood', 'breaks', breaksSystem, 10);
  if (ember) reg('mood', 'embertouch', emberSystem, 20);
  if (health) reg('health', 'health', healthSystem);
  if (social) reg('social', 'social', socialSystem);
  if (commands) { installRoleCommands(); installDraftCommands(); installPerkCommands(); }
}
