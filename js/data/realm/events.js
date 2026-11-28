// History event types (EMBERCROWN-WORLD.md 2.4; OWNER G). Read by js/game/realm/history.js (writes the rows)
// and the Annals text (W3.2, js/data/text/realm.js).
//
// A row is 12 bytes: Int16 year | u8 type | u8 flags | u16 a | u16 b | u16 site | i16 arg (little-endian).
// The row's `type` is the index in EVENT_TYPES, which is saved in the realm record: the list is APPEND-ONLY.
// `slots` names what each of a, b, site and arg holds: civ, site, fig (figure), war, beast, art (artifact),
// fall (a fall site of the Old Crown, index into realm.falls), kind (a site kind index), n (a number), or '-'
// (unused, written as 0xffff / 0). `imp` is the importance 0-3: at the log cap, 0 stops first, then 1 (2.4).

export const EVENT_BYTES = 12;
export const NONE = 0xffff;

const T = (key, group, imp, a = '-', b = '-', site = '-', arg = '-') => Object.freeze({ key, group, imp, slots: Object.freeze({ a, b, site, arg }) });

export const EVENT_TYPES = Object.freeze([
  // civ
  T('civ.founded', 'civ', 3, 'civ', 'fig', 'site'),
  T('civ.split', 'civ', 3, 'civ', 'civ', 'site'),            // a: the new civ, b: the old one
  T('civ.fell', 'civ', 3, 'civ', 'civ', 'site'),             // b: the last enemy, or NONE
  T('civ.crowned', 'civ', 1, 'civ', 'fig', 'site'),
  T('civ.crisis', 'civ', 2, 'civ', 'fig'),                   // b: the ruler who died without an heir
  T('civ.pact', 'civ', 2, 'civ', 'civ', '-', 'n'),           // arg: the oath name id
  T('civ.tribute', 'civ', 1, 'civ', 'civ', 'site', 'war'),   // a pays b
  T('civ.oathSworn', 'civ', 1, 'civ', 'civ', '-', 'n'),
  T('civ.oathBroken', 'civ', 2, 'civ', 'civ', '-', 'n'),
  // site
  T('site.founded', 'site', 1, 'civ', 'site', 'site', 'kind'), // b: the mother site, or NONE for a capital
  T('site.grew', 'site', 0, 'civ', '-', 'site', 'n'),          // arg: the new size
  T('site.taken', 'site', 3, 'civ', 'civ', 'site', 'war'),     // a takes it from b
  T('site.razed', 'site', 3, 'civ', 'civ', 'site', 'war'),     // a razes b's site
  T('site.hollowed', 'site', 3, 'civ', '-', 'site', 'fall'),   // a: the civ that lost it
  T('site.rebuilt', 'site', 2, 'civ', '-', 'site'),
  T('site.abandoned', 'site', 1, 'civ', '-', 'site'),
  T('site.moved', 'site', 0, 'civ', '-', 'site'),
  // war
  T('war.declared', 'war', 3, 'civ', 'civ', '-', 'war'),
  T('war.battle', 'war', 2, 'civ', 'civ', 'site', 'war'),      // a: the winner
  T('war.siege', 'war', 2, 'civ', 'civ', 'site', 'war'),
  T('war.treaty', 'war', 3, 'civ', 'civ', '-', 'war'),
  // figure (W3.1b fills the deeds; W3.1a writes rulers' births and deaths)
  // A deed row (fig.slew/forged/found/wed/exiled/wrote/sang/healed, beast.slain/wounded) carries its cause (2.5):
  // flags & 7 is the CAUSE code of js/game/realm/figures.js (none 0, avenge 1, place 2, duty 3, oath 4, protect 5,
  // ambition 6; append-only) and `arg` its reference: a kin figure, the birthplace site, a war, the pact civ, a beast, or 0.
  T('fig.born', 'figure', 0, 'fig', 'civ'),
  T('fig.cameOfAge', 'figure', 0, 'fig', 'civ'),
  T('fig.slew', 'figure', 2, 'fig', 'fig'),
  T('fig.forged', 'figure', 2, 'fig', 'art', 'site'),
  T('fig.lost', 'figure', 2, 'fig', 'art', 'site'),
  T('fig.found', 'figure', 2, 'fig', 'art', 'site'),
  T('fig.wed', 'figure', 1, 'fig', 'fig'),
  T('fig.exiled', 'figure', 2, 'fig', 'civ'),
  T('fig.died', 'figure', 1, 'fig', 'civ', 'site', 'n'),       // arg: DEATH cause
  T('fig.wrote', 'figure', 2, 'fig', 'civ', 'site'),
  T('fig.sang', 'figure', 2, 'fig', 'civ', 'site'),
  T('fig.healed', 'figure', 2, 'fig', 'civ', 'site'),
  // beast (W3.1b)
  T('beast.woke', 'beast', 2, 'beast', '-', 'site'),
  T('beast.razed', 'beast', 3, 'beast', 'civ', 'site'),
  T('beast.wounded', 'beast', 2, 'beast', 'fig'),
  T('beast.slain', 'beast', 3, 'beast', 'fig', 'site'),
  // world
  T('world.hollowAdvanced', 'world', 1, '-', '-', '-', 'fall'),
  T('world.hollowReceded', 'world', 1, '-', '-', '-', 'fall'),
  T('world.plague', 'world', 2, 'civ', '-', 'site', 'n'),      // arg: figures killed
  T('world.famine', 'world', 2, 'civ', '-', 'site'),
  T('world.aurora', 'world', 1),
  T('world.comet', 'world', 1),
  T('world.flood', 'world', 2, '-', '-', 'site'),
  T('world.hollowing', 'world', 3, '-', '-', '-', 'n'),        // year 0: the Old Crown falls; arg: fall count
]);
export const EVENT_INDEX = Object.freeze(Object.fromEntries(EVENT_TYPES.map((t, i) => [t.key, i])));

/** Death causes of 'fig.died' (arg; append-only). */
export const DEATH = Object.freeze({ age: 0, battle: 1, beast: 2, plague: 3, hollow: 4, slain: 5 });
/** War outcomes (wars table; append-only): 0 still at war at the end of history. */
export const WAR_OUTCOME = Object.freeze({ ongoing: 0, treaty: 1, aWon: 2, bWon: 3 });
