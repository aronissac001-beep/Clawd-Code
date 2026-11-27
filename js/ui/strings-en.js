// The English strings table (W1.1, EMBERCROWN-WORLD.md 8.10 and G25; owner I). Read through t(key, vars)
// in strings.js, never directly.
//   key    a dotted id: lowercase segments, the first starting with a letter ("hud.clock.day").
//   value  a string with {name} placeholders, or a plural row: an object holding a form for every English
//          plural category ("one", "other"; with type: 'ordinal' also "two" and "few"), plus optional exact
//          forms ("=0"). The count is always the var n.
// Every key must be used by a literal t('...') call (or a declared t-keys pattern) somewhere under js/, and
// every literal key must be here: node tools/check-strings.mjs. Rows are grouped by the area that uses them;
// a step that converts a module adds its rows under that module's group.

export const EN = Object.freeze({
  // ---- strings.js list(): "Ada", "Ada and Bo", "Ada, Bo and Cy", "Ada, Bo, Cy and 2 others" ----
  'list.pair': '{a} and {b}',
  'list.sep': '{a}, {b}',
  'list.more': { one: '{n} other', other: '{n} others' },
});
