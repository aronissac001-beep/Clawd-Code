// Great beast (legend): Bone Colossus (EMBERCROWN-FORTRESS.md 3.12; step Z3.3). Owner H.
// Lair: the deep stone below Cavern II. Cause: Near lair, or Cavern II (the Mere) opened.
// Body: a giant of bone; walks through built walls (its base row smashes them); crush attack; bone shatters
// under blunt blows (beasts/index.js dmgMult). No weak-spot script: where to hit it is a fact of its body.

export const BEAST = Object.freeze({
  id: 'colossus',
  legend: true,
  /** The waking cause now ([kind, subject, weight]) or null (pure in s). */
  cause(s, b, cs, { hasCause }) { return hasCause(cs, 'near_lair', 'lair:' + b.lair) || hasCause(cs, 'opened_cavern', 'mere'); },
});
