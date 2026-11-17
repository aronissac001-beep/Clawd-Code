// The clean work giver (owner E): not in the Stage 1a slice. The contract shape with no candidates,
// so js/data/worktypes.js names an existing module; its stage fills it in.

export const GIVER = Object.freeze({
  id: 'clean', work: 'haul', order: 10,
  candidates: () => [],
  valid: () => false,
  make: () => null,
  keyOf: (t) => (t && t.key !== undefined ? t.key : -1),
});
