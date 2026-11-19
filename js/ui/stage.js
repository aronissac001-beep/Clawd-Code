// The build stage the UI offers (owner I; doc 14.7, 14.8). Menus, role pickers and bills show what
// availableIn(def, STAGE) allows (js/data/schema.js); app.js founds and continues colonies with the
// sim installed for the same stage.
// Stage 2: the hold grows (every Stage 2 system: seasons and weather, fire, rooms with roles, the
// full Architect, research, trade, letters with choices, nemeses, the Ember-touched, animals).
// A colony saved by the 1b build continues under the Stage 2 rules (B's world record and K's trade
// record are created on its first Stage 2 tick, the same tick in a loaded and an uninterrupted run).
// `?stage=1b` (debug and comparison) plays the earlier rules on this build.
const KNOWN = ['1a', '1b', '2'];
function fromUrl() {
  try {
    if (typeof location === 'undefined') return null;
    const v = new URLSearchParams(location.search).get('stage');
    return KNOWN.includes(v) ? v : null;
  } catch (_) { return null; }
}
export const STAGE = fromUrl() || '2';
/** Is the UI at least at stage `st`? */
export const atStage = (st) => KNOWN.indexOf(STAGE) >= KNOWN.indexOf(st);
