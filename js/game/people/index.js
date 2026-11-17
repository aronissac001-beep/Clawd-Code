// People (owner F): one entry point that plugs the people systems into the sim.
// Importing has no side effects; installPeople() registers tick systems, command appliers and the
// work hooks (speed, XP) that E's toil runner calls. A (sim setup) and J (determinism, bot) call
// it after resetBus(), like installWork().
//
// Stage 1a: skills, XP, traits and roles only (colonists do not eat, sleep or mope).
// Stage 1b: installPeople({ needs: true, mood: true, breaks: true, health: true }).

import { registerSystem, tickSystems } from '../core/bus.js';
import { setWorkHooks } from '../work/jobs.js';
import { workSpeed, awardXp, skillsDaySystem } from './skills.js';
import { needsSystem } from './needs.js';
import { moodSystem } from './mood.js';
import { breaksSystem } from './breaks.js';
import { healthSystem } from './health.js';
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
export { setPeopleContent } from './defs.js';

const has = (slot, name) => tickSystems().some((x) => x.slot === slot && x.name === name);
const reg = (slot, name, fn, order = 0) => { if (!has(slot, name)) registerSystem(slot, name, fn, order); };

/**
 * Register F's systems (idempotent).
 * @param {{ needs?: boolean, mood?: boolean, breaks?: boolean, health?: boolean, social?: boolean,
 *           ember?: boolean, commands?: boolean, workHooks?: boolean }} [opts]
 */
export function installPeople({ needs = false, mood = false, breaks = false, health = false, social = false, ember = false, commands = true, workHooks = true } = {}) {
  if (workHooks) setWorkHooks({ speed: workSpeed, xp: awardXp });
  reg('needs', 'skills-day', skillsDaySystem, -10);
  if (needs) reg('needs', 'needs', needsSystem);
  if (mood) reg('mood', 'mood', moodSystem);
  if (breaks) reg('mood', 'breaks', breaksSystem, 10);
  if (ember) reg('mood', 'embertouch', emberSystem, 20);
  if (health) reg('health', 'health', healthSystem);
  if (social) reg('social', 'social', socialSystem);
  if (commands) { installRoleCommands(); installDraftCommands(); installPerkCommands(); }
}
