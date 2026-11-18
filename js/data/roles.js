// Roles: priority presets (doc 5.1, 10.4). OWNER F.
// prio: work type -> 1 (highest) .. 4; `all` sets every work type first. The colonist's priority
// array is computed from the primary and secondary role (js/game/people/roles.js computePrio).
// Stage 1a ships the five slice roles (14.6): Miner, Builder, Crafter, Hauler, Generalist. Stage 1b
// adds the roles of its work (Cook, Grower, Smith, Doctor, Soldier); stage marks them so the 1a
// menus and role suggestions skip them. Herder, Scholar and Artisan arrive in Stage 2.
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
  ],
};
