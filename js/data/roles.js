// Roles: priority presets (doc 5.1, 10.4). OWNER F.
// prio: work type -> 1 (highest) .. 4; `all` sets every work type first. The colonist's priority
// array is computed from the primary and secondary role (js/game/people/roles.js computePrio).
// Stage 1a ships the five slice roles (14.6): Miner, Builder, Crafter, Hauler, Generalist. The other
// eight of the 5.1 table (Smith, Grower, Cook, Herder, Doctor, Scholar, Artisan, Soldier) arrive with
// their work in Stage 1b and 2.
export const DATA = {
  role: [
    { id: 'miner', name: 'Miner', icon: 'role.miner', prio: { mine: 1, haul: 3, build: 3 }, soldier: false },
    { id: 'builder', name: 'Builder', icon: 'role.builder', prio: { build: 1, haul: 2, chop: 3 }, soldier: false },
    { id: 'crafter', name: 'Crafter', icon: 'role.crafter', prio: { craft: 1, tailor: 1, haul: 3 }, soldier: false },
    { id: 'hauler', name: 'Hauler', icon: 'role.hauler', prio: { haul: 1, build: 3, chop: 3 }, soldier: false },
    { id: 'generalist', name: 'Generalist', icon: 'role.generalist', prio: {}, all: 3, soldier: false },
  ],
};
