// Build flags (owner A; EMBERCROWN-FORTRESS.md 8.1). Module constants, never sim state: nothing here is
// saved or hashed, and a colony records what it is (its `d`) in its own save.
//
// FORTRESS: the z-level fortress (Stage Z1). It stays false until step E13: new colonies are D = 1 with
// today's mapgen and saves stay EC2. The D > 1 code runs in tests, in the bench and behind the debug URL
// `?fortress=1`, which only picks the createColony path (fortressRequested).

export const FORTRESS = false;

/** True when the page's query string (the caller passes `location.search`) asks for `fortress=1`, or the flag is on. Never read by the sim. */
export function fortressRequested(search = '') {
  if (FORTRESS) return true;
  try { return new URLSearchParams(search || '').get('fortress') === '1'; } catch { return false; }
}
