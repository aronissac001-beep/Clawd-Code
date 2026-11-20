// Build flags (owner A; EMBERCROWN-FORTRESS.md 8.1). Module constants, never sim state: nothing here is
// saved or hashed, and a colony records what it is (its `d`) in its own save.
//
// FORTRESS: the z-level fortress (Stage Z1). On since the switch (step E13, EMBERCROWN-FORTRESS.md 8.3): every
// new colony is a 128 x 128 x 20 hold from mapgen3, saves are EC3 (state v4), and an EC2 colony (one plane)
// migrates on load (5.3, 5.4; js/main.js upgradeWorld). D = 1 worlds remain only in tools and tests (the bots,
// the Stage 2 determinism scenes), which found them through setup.js foundColony({ d: 1 }) directly.

export const FORTRESS = true;

/** True when the page's query string (the caller passes `location.search`) asks for `fortress=1`, or the flag is on. Never read by the sim. */
export function fortressRequested(search = '') {
  if (FORTRESS) return true;
  try { return new URLSearchParams(search || '').get('fortress') === '1'; } catch { return false; }
}
