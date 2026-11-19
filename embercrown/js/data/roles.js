// Roles: priority presets (doc 5.1, 10.4). OWNER F.
// prio: work type -> 1 (highest) .. 4; `all` sets every work type first. The colonist's priority
// array is computed from the primary and secondary role (js/game/people/roles.js computePrio).
// Stage 1a ships the five slice roles (14.6): Miner, Builder, Crafter, Hauler, Generalist. Stage 1b
// adds the roles of its work (Cook, Grower, Smith, Doctor, Soldier); Stage 2 the last three (Herder,
// Scholar, Artisan): all 13 of 5.1. stage marks them so earlier menus and role suggestions skip them.
export const DATA = {
  role: [
    { id: 'miner', name: 'Miner', icon: 'role.miner', prio: { mine: 1, haul: 3, build: 3 }, soldier: false },
    { id: 'builder', name: 'Builder', icon: 'role.builder', prio: { build: 1, haul: 2, chop: 3 }, soldier: false },
    { id: 'crafter', name: 'Crafter', icon: 'role.crafter', prio: { craft: 1, tailor: 1, haul: 3 }, soldier: false },
    { id: 'hauler', name: 'Hauler', icon: 'role.hauler', prio: { haul: 1, build: 3, chop: 3 }, soldier: false },
    { id: 'generalist', name: 'Generalist', icon: 'role.generalist', prio: {}, all: 3, soldier: false },
    // icons: UI glyphs standing in until D / I add role.cook, role.grower, role.smith, role.doctor and role.soldier.
    { id: 'cook', name: 'Cook', icon: 'food', prio: { cook: 1, grow: 3, haul: 3 }, soldier: false, stage: '1b' },
    { id: 'grower', name: 'Grower', icon: 'farm', prio: { grow: 1, chop: 1, cook: 3 }, soldier: false, stage: '1b' },
    { id: 'smith', name: 'Smith', icon: 'hammer', prio: { smith: 1, mine: 3, haul: 3 }, soldier: false, stage: '1b' },
    { id: 'doctor', name: 'Doctor', icon: 'heart', prio: { care: 1, lore: 3, cook: 3 }, soldier: false, stage: '1b' },
    { id: 'soldier', name: 'Soldier', icon: 'sword', prio: { haul: 3, build: 3 }, soldier: true, stage: '1b' },
    // Stage 2 (icons stand in until D adds role.herder, role.scholar, role.artisan)
    { id: 'herder', name: 'Herder', icon: 'farm', prio: { animals: 1, grow: 3 }, soldier: false, stage: '2' },
    { id: 'scholar', name: 'Scholar', icon: 'eye', prio: { lore: 1, art: 3 }, soldier: false, stage: '2' },
    { id: 'artisan', name: 'Artisan', icon: 'crate', prio: { art: 1, craft: 2 }, soldier: false, stage: '2' },
  ],
};

/**
 * Schedule presets (5.2): the 24 hourly cells, SCHED codes 0 Sleep, 1 Work, 2 Joy, 3 Any. Night Owl
 * colonists default to Night watch. The schedule editor (I) offers these and the per-hour cells.
 */
export const SCHEDULES = Object.freeze([
  { id: 'day', name: 'Day', text: 'Sleep 22-06, joy 18-21.', sleep: [22, 6], joy: [18, 22] },
  { id: 'early', name: 'Early', text: 'Sleep 20-04, joy 16-19.', sleep: [20, 4], joy: [16, 20] },
  { id: 'night', name: 'Night watch', text: 'Sleep 10-18, joy 06-09.', sleep: [10, 18], joy: [6, 10] },
]);
