// Herds and herd drives (doc 8.3, Greenhold): herds graze outside the walls Thaw to Ashfall; in
// Deepcold a herd drive takes them off-map and brings them back 50% larger. Owner K. Stage 3 feature;
// Stage 0 skeleton.

export const DRIVE = Object.freeze({ herders: 2, growPct: 150 });
/** Animals of a kind that are tame, by id. */
export const herdOf = (s, kind) => s.anim.filter((a) => a.tame && a.kind === kind).sort((x, y) => x.id - y.id);
