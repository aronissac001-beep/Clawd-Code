// Great beast (legend): Bone Colossus (EMBERCROWN-FORTRESS.md 3.12). Owner H. Stage Z3 feature; Stage 2.9 stub.
// Lair: the deep stone below Cavern II. Cause: Near lair, or Cavern II opened.
// Body: a giant of bone; walks through built walls (smashes them at 4x a sapper); crush attack; bone
// shatters under blunt hits on its legs. No weak-spot script: where to hit it is a fact of its body.

export const BEAST = Object.freeze({
  id: 'colossus',
  legend: true,
  /** Spawn the beast for an incident whose cause holds (Z3). */
  spawn: () => null,
  /** Per-tick behaviour while on the map (Z3). */
  tick: () => {},
});
