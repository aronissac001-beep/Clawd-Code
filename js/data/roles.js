// Roles: priority presets (doc 5.1). OWNER F.
// Stage 0 placeholder written by workstream G so every 13.4 file exists and validate-data checks
// the C11 schema end to end. The owner replaces these sample entries freely (keep export DATA).
export const DATA = {
  role: [
    { id: 'miner', name: 'Miner', icon: 'role.miner', prio: { mine: 1, haul: 3, build: 3 }, soldier: false },
    { id: 'builder', name: 'Builder', icon: 'role.builder', prio: { build: 1, haul: 2, chop: 3 }, soldier: false },
    { id: 'generalist', name: 'Generalist', icon: 'role.generalist', prio: {}, all: 3, soldier: false },
  ],
};
