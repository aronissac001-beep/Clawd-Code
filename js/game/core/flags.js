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

// SHELL2: the new shell (EMBERCROWN-WORLD.md 8.1, Stage W1): the 5-slot bar, the People, Hold and World sheets.
// UI only, never read by the sim. On since W1.10 (the w1 gate); before it the debug URL ?shell=2 turned it on (js/ui/peopleui.js SHELL2_ON).
export const SHELL2 = true;

// REALM: the world map and embark (EMBERCROWN-WORLD.md G1, G8, 3, Stage W2). Entry points only: on the title, New hold
// opens the World step and Worlds lists the saved worlds (js/ui/front.js realmOn); a new hold is founded in a region
// (setup.js foundColony({ realm, rx, ry })). Never read by the sim: a hold that carries s.realm is read from its save,
// whatever this says (G31). On since W2.9 (the w2 gate); before it the debug URL ?realm=1 turned it on.
export const REALM = true;

// HISTORY: the years of world history (EMBERCROWN-WORLD.md 2.3, Stage W3): js/game/realm/gen.js createRealm runs
// js/game/realm/history.js after the land. Off until W3's last step; tools pass createRealm(p, { history: true }).
export const HISTORY = false;
