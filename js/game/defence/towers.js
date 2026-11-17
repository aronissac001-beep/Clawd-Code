// Watchtowers, archer platforms and stone towers (doc 7.7, 9.4, 9.5). Owner H. Stage 2 feature;
// Stage 0 skeleton. A tower is manned by a soldier on the Night watch schedule or a drafted archer
// (a 'garrison' job at the building): +3 range, sight 12, and +2 h warning for raids from its edge.

export const TOWER_DEFS = Object.freeze(['tower', 'platform', 'stonetower']);
export const isTower = (b) => !!b && b.st === 'done' && TOWER_DEFS.includes(b.def);
/** Done towers, by id. */
export function towers(s) { const out = []; for (const b of s.bld) if (isTower(b)) out.push(b); return out; }
/** Extra warning hours for a raid from `edge` (storyteller, 9.4). Stage 2: manned towers facing the edge. */
export function warningBonusH() { return 0; }
/** Tick system (slot 'defence'). Stage 2: manned towers shoot through engage. */
export function towersSystem() {}
