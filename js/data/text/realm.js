// The world's history in words (EMBERCROWN-WORLD.md 2.6, 2.7 first row; step W3.2; owner G, the Annals' World
// section by I). Text is never stored: an event row of the realm log (js/data/realm/events.js, 12 bytes) is
// rendered here from grammar rows on demand, with the variant picked by a hash of the event index, so the same
// world always reads the same. All wording is original. No emoji.
//
//   eventText(realm, k)        { k, year, type, imp, text, links } of event row k (cached: 200 strings a realm)
//   eventMeta(realm, k)        { year, type, key, group, imp } of row k, unrendered
//   eventsOf(realm, key)       the event indices that name record `key` (a world key), in log order
//   recordName(realm, key)     the name of a world record ('wc2' civ, 'ws3' site, 'wf12' figure, 'wa7' artifact,
//                              'wb1' beast, 'ww4' war), or null
//   worldKey(kind, id) / parseWorldKey(key)
//   figureName(f) / artifactName(a) / artifactDesc(a) / civText(c) / warName(realm, w) / fallName(i) / yearText(y)
//   WORLD_TEXT                 the words of the Annals' World section and the World sheet's map tab
//
// A grammar row is { v: [tier, tier, ...] } or, for fig.died, { byArg: { <DEATH code>: tiers } }. A tier is a list
// of variants; the first tier with a variant whose every {slot} resolves is used (so a NONE slot falls through to
// a plainer tier), and the variant is hash(k) among those that resolve. Slots: {a} {b} {site} name the row's
// slots by the kinds events.js gives them; {kind} {n} {oath} {fall} {places} come from arg; {pa} {sa} are the
// a-figure's possessive and subject pronoun; {cause} is ", <clause>" for a deed row (2.5) or empty; {artdesc}
// the b-artifact's "a jade blade"; {by} a dead figure's slayer. A line is at most MAX_LINE characters: a longer
// one drops the cause clause, then the variant tier falls back, then it is cut at a word.
//
// Data only: imports data modules, never game code, so tools and tests read it in Node.
import { EVENT_TYPES, EVENT_BYTES, NONE, DEATH, WAR_OUTCOME } from '../realm/events.js';
import { HISTORY_GEN, SITE_KINDS, CIVKINDS } from '../realm/civkinds.js';
import { OATH_PARTS } from '../realm/ethics.js';
import { DATA as NAMES } from '../names.js';

export const MAX_LINE = 160;
const CACHE = 200;
const ART = HISTORY_GEN.artifacts;
const NAME_ROWS = Object.fromEntries(NAMES.names.map((r) => [r.id, r]));

// ---- words ---------------------------------------------------------------------------------------------------
/** Peoples as the Annals name them (G14: the id sylvari reads Thornwake). */
export const PEOPLE_WORDS = Object.freeze({
  human: { one: 'Human', many: 'Humans' }, sylvari: { one: 'Thornwake', many: 'Thornwake' }, deepforge: { one: 'Deepforge', many: 'Deepforge' },
  emberkin: { one: 'Emberkin', many: 'Emberkin' }, murrow: { one: 'Murrow', many: 'Murrow' }, tarnfolk: { one: 'Tarnfolk', many: 'Tarnfolk' },
  wendrel: { one: 'Wendrel', many: 'Wendrel' }, lamplost: { one: 'Lamplost', many: 'Lamplost' }, kilnfolk: { one: 'Kilnfolk', many: 'Kilnfolk' },
  greyborn: { one: 'Greyborn', many: 'Greyborn' },
});
export const peopleWord = (p, many = false) => { const w = PEOPLE_WORDS[p]; return w ? (many ? w.many : w.one) : cap(String(p || '')); };
/** Site kinds (SITE_KINDS order). */
export const SITE_WORDS = Object.freeze({ camp: 'camp', hamlet: 'hamlet', village: 'village', town: 'town', city: 'city', hold: 'hold', grove: 'grove', stilt: 'stilt-town',
  nomad: 'nomad camp', tower: 'tower', shrine: 'shrine', lair: 'lair', ruin: 'ruin', battlefield: 'battlefield', vault: 'vault' });
export const ROLE_WORDS = Object.freeze({ ruler: 'Ruler', hero: 'Hero', smith: 'Smith', scholar: 'Scholar', bard: 'Bard', outlaw: 'Outlaw', priest: 'Priest', envoy: 'Envoy' });
export const CIVKIND_WORDS = Object.freeze(Object.fromEntries(CIVKINDS.map((k) => [k.id, k.noun])));
const FALL_ORD = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];
const NUM = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const PRON = [{ sa: 'she', pa: 'her' }, { sa: 'he', pa: 'his' }];
const KIN = { parent: ['mother', 'father'], spouse: ['wife', 'husband'], child: ['daughter', 'son'], sibling: ['sister', 'brother'] };

// ---- grammar (original wording; 2-6 variants a row) ----------------------------------------------------------
export const GRAMMAR = Object.freeze({
  'civ.founded': { v: [['{a} was founded at {site} by {b}.', '{b} raised the first hall of {a} at {site}.', 'At {site}, {b} gathered the founders of {a}.'],
    ['{a} was founded at {site}.', 'The first hearths of {a} were lit at {site}.'], ['{a} was founded.']] },
  'civ.split': { v: [['{a} broke away from {b}, ruling from {site}.', 'The outer holdings of {b} rose as {a}, with {site} for a seat.', '{b} was sundered, and {a} was born at {site}.'],
    ['{a} broke away from {b}.']] },
  'civ.fell': { v: [['{a} fell to {b}; {site} was its last seat.', '{b} brought {a} to its end.', 'With the loss of {site}, {a} fell before {b}.'],
    ['{a} faded from the world; {site} was its last seat.', '{a} came to an end.'], ['{a} came to an end.']] },
  'civ.crowned': { v: [['{b} took the throne of {a}.', '{b} was crowned at {site}, ruler of {a}.', '{a} hailed {b} as its ruler.'], ['{b} took the throne of {a}.']] },
  'civ.crisis': { v: [['{b} died with no heir, and {a} fell into strife.', 'No heir stood for {b}; the lords of {a} quarrelled over the seat.'], ['{a} fell into strife over its empty seat.']] },
  'civ.pact': { v: [['{a} and {b} swore {oath}.', '{a} and {b} sealed a pact of trade, {oath}.', 'Envoys of {a} and {b} shared bread and swore {oath}.']] },
  'civ.tribute': { v: [['{a} paid tribute to {b} to keep {site}.', 'To spare {site}, {a} sent tribute to {b}.'], ['{a} paid tribute to {b}.']] },
  'civ.oathSworn': { v: [['{a} swore to keep {oath} with {b}.', '{a} gave its word to {b}: {oath}.']] },
  'civ.oathBroken': { v: [['{a} broke {oath} with {b}.', '{a} cast aside {oath} and turned on {b}.']] },
  'site.founded': { v: [['Settlers from {b} founded the {kind} of {site} for {a}.', '{a} raised the {kind} of {site}, a daughter of {b}.'],
    ['{a} founded the {kind} of {site}.', 'The {kind} of {site} was settled by {a}.']] },
  'site.grew': { v: [['{site} grew.', '{site} of {a} prospered and grew.', 'More hearths were lit in {site}.', 'Folk of {a} crowded into {site}.'], ['{site} grew.']] },
  'site.taken': { v: [['{a} took {site} from {b}.', '{site} fell to {a}, and the banners of {b} came down.', 'The host of {a} seized {site} from {b}.'], ['{a} took {site}.']] },
  'site.razed': { v: [['{a} razed {site} of {b}.', '{site} of {b} was burned to the ground by {a}.', 'Nothing of {site} was left standing when {a} had done.'], ['{site} was razed.']] },
  'site.hollowed': { v: [['{site} fell to the Hollow, lost to {a}.', 'The Hollow rose under {site}, and {a} abandoned it.'], ['{site} fell to the Hollow.']] },
  'site.rebuilt': { v: [['{a} rebuilt {site}.', 'New walls rose over the ruin of {site}, raised by {a}.'], ['{site} was rebuilt.']] },
  'site.abandoned': { v: [['{a} abandoned {site}.', 'The last folk of {a} left {site}.'], ['{site} was abandoned.']] },
  'site.moved': { v: [['The camp of {site} moved on with the herds of {a}.', '{a} struck camp at {site} and moved on.'], ['The camp of {site} moved on.']] },
  'war.declared': { v: [['{a} declared war on {b}.', 'War broke out between {a} and {b}.', '{a} marched against {b}.']] },
  'war.battle': { v: [['{a} defeated {b} at {site}.', 'At {site}, {a} won the field against {b}.', '{b} was routed by {a} near {site}.'], ['{a} defeated {b} in battle.']] },
  'war.siege': { v: [['{a} laid siege to {site}, held by {b}.', 'The host of {a} ringed {site} and starved {b} within.'], ['{a} laid siege to {b}.']] },
  'war.treaty': { v: [['{a} and {b} made peace.', 'A treaty ended the war of {a} and {b}.', '{a} and {b} laid down their spears.']] },
  'fig.born': { v: [['{a} was born under the banner of {b}.', '{b} welcomed the birth of {a}.', '{a} was born, a child of {b}.'], ['{a} was born.']] },
  'fig.cameOfAge': { v: [['{a} of {b} came of age.', '{a} came of age and took up a place in {b}.'], ['{a} came of age.']] },
  'fig.slew': { v: [['{a} slew {b}{cause}.', '{a} cut down {b}{cause}.', '{a} struck down {b}{cause}.']] },
  'fig.forged': { v: [['{a} made {b}, {artdesc}, at {site}{cause}.', '{a} finished {b}, {artdesc}{cause}.', 'At {site}, {a} crafted {b}, {artdesc}{cause}.'], ['{a} made {b}, {artdesc}{cause}.']] },
  'fig.lost': { v: [['{a} lost {b} at {site}.', '{b} slipped from the keeping of {a} at {site}.'], ['{b} was lost at {site}.', '{b} was lost in the ruin of {site}.'], ['{a} lost {b}.'], ['{b} was lost.']] },
  'fig.found': { v: [['{a} found {b} at {site}{cause}.', '{a} recovered {b} from {site}{cause}.'], ['{a} found {b}{cause}.']] },
  'fig.wed': { v: [['{a} wed {b}{cause}.', '{a} and {b} were married{cause}.']] },
  'fig.exiled': { v: [['{a} was cast out of {b} for {pa} ambition.', '{b} exiled {a}, who had grasped too far.'], ['{a} went into exile.']] },
  'fig.died': { byArg: {
    [DEATH.age]: [['{a} died of old age at {site}.', '{a} of {b} passed away in old age.'], ['{a} of {b} died in old age.'], ['{a} died in old age.']],
    [DEATH.battle]: [['{a} fell in battle at {site}.', '{a} of {b} died on the field at {site}.'], ['{a} of {b} fell in battle.'], ['{a} fell in battle.']],
    [DEATH.beast]: [['{a} was killed by {by} near {site}.', '{by} slew {a}.'], ['{a} was killed by a beast at {site}.'], ['{a} was killed by a beast.']],
    [DEATH.plague]: [['{a} died of the plague at {site}.', 'The plague took {a} of {b}.'], ['The plague took {a}.']],
    [DEATH.hollow]: [['{a} was lost to the Hollow at {site}.', 'The Hollow swallowed {a} at {site}.'], ['{a} was lost to the Hollow.']],
    [DEATH.slain]: [['{a} was slain by {by}.', '{by} slew {a} at {site}.'], ['{a} was slain at {site}.'], ['{a} was slain.']],
  }, v: [['{a} died at {site}.'], ['{a} died.']] },
  'fig.wrote': { v: [['{a} wrote a chronicle of {b} at {site}{cause}.', 'At {site}, {a} set down the laws of {b} in ink{cause}.', '{a} wrote a book of star lore at {site}{cause}.'], ['{a} wrote a chronicle of {b}{cause}.']] },
  'fig.sang': { v: [['{a} sang the deeds of {b} in the halls of {site}{cause}.', '{a} made a song that all of {b} came to know{cause}.'], ['{a} made a song of {b}{cause}.']] },
  'fig.healed': { v: [['{a} healed the sick of {site} in the plague years{cause}.', '{a} tended the plague-stricken of {b}{cause}.'], ['{a} tended the sick of {b}{cause}.']] },
  'beast.woke': { v: [['{a} woke in its lair at {site}.', '{a} stirred beneath {site} and came forth.'], ['{a} woke.']] },
  'beast.razed': { v: [['{a} came out of the wild and razed {site} of {b}.', '{site} of {b} was laid waste by {a}.'], ['{a} razed {site}.']] },
  'beast.wounded': { v: [['{b} wounded {a} and drove it back to its lair{cause}.', '{b} hunted {a} and left it bleeding{cause}.']] },
  'beast.slain': { v: [['{b} slew {a} at {site}{cause}.', 'At {site}, {b} brought down {a}{cause}.', '{b} put an end to {a}{cause}.'], ['{b} slew {a}{cause}.']] },
  'world.hollowAdvanced': { v: [['The Hollow spread around {fall}.', 'The taint of {fall} crept a league further.']] },
  'world.hollowReceded': { v: [['The Hollow drew back from {fall}.', 'Around {fall} the taint thinned, and grass returned.']] },
  'world.plague': { v: [['Plague swept {a} from {site}.', 'A wasting sickness spread from {site} through {a}.', 'Plague came to {site}, and {a} mourned.'], ['Plague swept {a}.']] },
  'world.famine': { v: [['Famine gripped {a} around {site}.', 'The harvests of {a} failed, and {site} went hungry.'], ['Famine gripped {a}.']] },
  'world.aurora': { v: [['Green fire burned in the northern sky all winter.', 'An aurora year: the sky shimmered for a season.']] },
  'world.comet': { v: [['A comet with a pale tail crossed the sky.', 'A long-tailed star hung over the world for forty nights.']] },
  'world.flood': { v: [['A great flood drowned the fields around {site}.', 'The rivers rose and swept away the fields of {site}.'], ['A great flood swept the lowlands.']] },
  'world.hollowing': { v: [['The Old Crown fell in the Hollowing, and the Hollow broke through in {places}.', 'The Hollowing: the Old Crown was broken, and the deep opened in {places}.']] },
});

/** The cause clauses of a deed row (2.5 step 3), by CAUSE code (js/game/realm/figures.js; append-only). */
export const CAUSE_TEXT = Object.freeze([
  [],                                                                                            // none
  ['to avenge {pa} {kin} {k}, killed in {ky}', 'in vengeance for {pa} {kin} {k}'],                 // avenge (arg: the kin figure)
  ['to avenge the razing of {p}, where {sa} was born', 'for the burning of {p}, {pa} birthplace'],  // place (arg: the birthplace site)
  ['in the war against {e}', 'for {pa} people in the war with {e}'],                               // duty (arg: the war)
  ['keeping the pact with {o}', 'true to {pa} oath to {o}'],                                       // oath (arg: the pact partner civ)
  ['to keep {pa} people safe', 'to shield {pa} kin from the beast'],                               // protect (arg: the beast)
  ['seeking renown', 'for the glory of it', 'hungry for a name'],                                  // ambition
]);
/** Deed types whose ambition clause is left out (it reads oddly there). */
const NO_AMBITION = new Set(['fig.wed', 'fig.healed']);

/** The words of the Annals' World section and the World sheet's map tab (I uses them through annals.js and worldui.js). */
export const WORLD_TEXT = Object.freeze({
  tabWars: 'Wars', tabWorld: 'World', tabMap: 'Map',
  loading: 'Reading the world record...',
  missing: 'This hold\'s world record is missing. Import a backup file to restore it.',
  noWorld: 'This hold stands outside any world. Holds founded in a world read its history here.',
  noHistory: 'This world has no recorded history yet. Worlds made from now on keep their years here.',
  noWars: 'No wars were fought in this world\'s history.',
  sections: { eras: 'Eras', civs: 'Civilizations', peoples: 'Peoples', sites: 'Sites', figures: 'Figures', artifacts: 'Artifacts', beasts: 'Beasts' },
  sectionSub: {
    eras: 'The world\'s years, age by age', civs: 'Realms, leagues, clans and courts', peoples: 'The folk of the world and their civilizations',
    sites: 'Towns, holds, ruins, lairs and battlefields', figures: 'Rulers, heroes, smiths, bards and outlaws', artifacts: 'Named works and where they lie',
    beasts: 'The great beasts of the wild',
  },
  worldOf: (name, years) => `The world of ${name}: ${years} years after the Fall.`,
  worldRows: 'Of the world',
  worldFigures: (n) => `World figures (${n})`, worldPlaces: (n) => `World sites (${n})`, worldArtifacts: (n) => `World artifacts (${n})`,
  era: (a, b) => `Years ${a} to ${b}`,
  eraNames: { fall: 'The Breaking', war: 'Years of War', hunger: 'Years of Hunger', build: 'Years of Building', quiet: 'Quiet Years' },
  more: (n) => `Show ${n} more`,
  living: 'Living', dead: 'Dead', standing: 'Standing', ruined: 'Ruined', alive: 'At large', slain: 'Slain', held: 'Held', lost: 'Lost',
  ongoing: 'Still at war', ended: 'Ended', fallen: 'Fallen', wild: 'Wild places and battlefields',
  eraNote: 'The great events of these years. Tap a line for the record it names.',
  eventsNote: 'Tap a line for the other record it names.',
  openRecord: (n) => `Open ${n}`,
  figRow: (role, people, b, d) => `${role}, ${people}. ${d === null || d === undefined ? `Born ${yearText(b)}` : `${yearText(b)} to ${yearText(d)}`}`,
  showOnMap: 'Show on map', related: 'Related', events: 'What happened', deeds: 'Deeds', rulers: 'Rulers', sitesOf: 'Sites', warsOf: 'Wars',
  civSub: (people, kind) => `${people} ${kind}`,
  founded: (y) => `Founded in ${yearText(y)}.`, fell: (y) => `Fell in ${yearText(y)}.`, endures: 'Endures to this day.',
  capital: (n) => `Seat: ${n}.`, oath: (o) => `Its oath: ${o}.`, parent: (n) => `Broke away from ${n}.`,
  siteSub: (kind, owner) => (owner ? `A ${kind} of ${owner}` : `A ${kind}, held by no one`),
  razed: (y) => `Razed in ${yearText(y)}.`, region: (x, y) => `Region ${x}, ${y}.`,
  figSub: (role, people, civ) => `${role}, ${people}, of ${civ}`,
  life: (b, d) => (d === null || d === undefined ? `Born ${yearText(b)}; living.` : `Born ${yearText(b)}; died ${yearText(d)}.`),
  kinOf: (w, n) => `${w}: ${n}`,
  kinWords: { parent: 'Parent', spouse: 'Spouse', child: 'Child' },
  artSub: (desc) => cap(desc),
  madeBy: (n, y) => `Made by ${n} in ${yearText(y)}.`, madeOld: (y) => `Made in ${yearText(y)}.`,
  heldBy: (n) => `Held by ${n}.`, lostAt: (n, y) => `Lost at ${n} in ${yearText(y)}.`, lostAway: (y) => `Lost in ${yearText(y)}; where, no one knows.`,
  beastSub: 'A great beast of the wild', lair: (n) => `Its lair: ${n}.`, beastSlain: (n, y) => `Slain by ${n} in ${yearText(y)}.`, beastAlive: 'It still lives.',
  kills: (k, w) => `${k} ${k === 1 ? 'kill' : 'kills'}, ${w} ${w === 1 ? 'wound' : 'wounds'} taken.`,
  warSub: (a, b) => `${a} against ${b}`,
  warYears: (a, b) => (b === null || b === undefined ? `From ${yearText(a)}; still at war.` : `${yearText(a)} to ${yearText(b)}.`),
  outcome: { [WAR_OUTCOME.ongoing]: 'Neither side has yielded.', [WAR_OUTCOME.treaty]: 'It ended in a treaty.', [WAR_OUTCOME.aWon]: (a) => `${a} won.`, [WAR_OUTCOME.bWon]: (b) => `${b} won.` },
  warCause: 'How it began',
  peopleSub: (n) => `${n} ${n === 1 ? 'civilization' : 'civilizations'}`,
  gone: 'This record is not in the world.',
  mapNote: 'Tap a region for what stands there. Your hold is framed.',
  mapPeek: (x, y, what) => `Region ${x}, ${y}: ${what}`,
  mapEmpty: 'open country',
  hold: 'Your hold',
});

// ---- names ---------------------------------------------------------------------------------------------------
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
/** "Year 231"; before the Fall, "41 years before the Fall". */
export const yearText = (y) => (y < 0 ? `${-y} ${y === -1 ? 'year' : 'years'} before the Fall` : `Year ${y}`);
/** A civ as text runs it: "the Szarmaw Clans", "the Kingdom of Merwick". */
export const civText = (c) => (c ? (/^the /.test(c.name) ? c.name : 'the ' + c.name) : null);
export function figureName(f) {
  if (!f || !f.nm) return null;
  const r = NAME_ROWS[f.people] || NAME_ROWS.human;
  return `${r.first[f.nm[0] % r.first.length]} ${r.family[f.nm[1] % r.family.length]}`;
}
export const artifactName = (a) => (a && a.nm ? ART.a[a.nm[0] % ART.a.length] + ART.b[a.nm[1] % ART.b.length] : null);
const article = (w) => (/^[aeiou]/i.test(w) ? 'an ' : 'a ');
export const artifactDesc = (a) => (a ? article(a.mat || a.kind) + (a.mat ? a.mat + ' ' : '') + a.kind : null);
export const fallName = (i) => `the ${FALL_ORD[i] || 'Last'} Breach`;
export const oathText = (id) => {
  const form = Math.floor(id / 10000), x = Math.floor(id / 100) % 100, y = id % 100, P = OATH_PARTS;
  if (form === 1 && P.a[x] && P.b[y]) return `the ${P.a[x]}-and-${P.b[y]} pact`;
  if (form === 2 && P.c[x] && P.d[y]) return `the ${P.c[x]} ${P.d[y]}`;
  return 'an old oath';
};
const T = (realm) => realm.tables || {};
export function warName(realm, w) {
  const C = T(realm).civs || [];
  return w ? `${civName(C[w.a])} against ${civName(C[w.b])}` : null;
}
/** A civ's name as a title: "The Szarmaw Clans", "Kingdom of Merwick". */
export const civName = (c) => (c ? cap(c.name) : null);

// ---- world keys ----------------------------------------------------------------------------------------------
const KEY_KIND = Object.freeze({ c: 'civ', s: 'site', f: 'fig', a: 'art', b: 'beast', w: 'war' });
const KIND_KEY = Object.freeze({ civ: 'c', site: 's', fig: 'f', art: 'a', beast: 'b', war: 'w' });
const TABLE_OF = Object.freeze({ civ: 'civs', site: 'sites', fig: 'figures', art: 'artifacts', beast: 'beasts', war: 'wars' });
export const worldKey = (kind, id) => 'w' + KIND_KEY[kind] + id;
export const isWorldKey = (key) => typeof key === 'string' && /^w[csfabw]\d+$/.test(key);
export function parseWorldKey(key) {
  if (!isWorldKey(key)) return null;
  return { kind: KEY_KIND[key[1]], id: +key.slice(2) };
}
/** The table row of a world key, or null. */
export function recordOf(realm, key) {
  const p = parseWorldKey(key);
  const rows = p ? T(realm)[TABLE_OF[p.kind]] : null;
  return (rows && rows[p.id]) || null;
}
export function recordName(realm, key) {
  const p = parseWorldKey(key), r = recordOf(realm, key);
  if (!r) return null;
  switch (p.kind) {
    case 'civ': return civName(r);
    case 'site': case 'beast': return r.name;
    case 'fig': return figureName(r);
    case 'art': return artifactName(r);
    case 'war': return warName(realm, r);
    default: return null;
  }
}

// ---- the log -------------------------------------------------------------------------------------------------
export const eventCount = (realm) => (realm && realm.events && realm.events.length ? Math.floor(realm.events.length / EVENT_BYTES) : 0);
function rowAt(realm, k) {
  const ev = realm.events, dv = new DataView(ev.buffer, ev.byteOffset, ev.byteLength), o = k * EVENT_BYTES;
  return { year: dv.getInt16(o, true), type: dv.getUint8(o + 2), flags: dv.getUint8(o + 3), a: dv.getUint16(o + 4, true), b: dv.getUint16(o + 6, true), site: dv.getUint16(o + 8, true), arg: dv.getInt16(o + 10, true) };
}
/** Year, type and importance of event row k without rendering it (lists filter on these). */
export function eventMeta(realm, k) {
  const ev = realm.events, o = k * EVENT_BYTES, ty = EVENT_TYPES[ev[o + 2]];
  return { year: (ev[o] | (ev[o + 1] << 8)) << 16 >> 16, type: ev[o + 2], key: ty ? ty.key : null, group: ty ? ty.group : null, imp: ty ? ty.imp : 0 };
}
const mix = (k) => { let x = (k + 0x9e3779b9) >>> 0; x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0; x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0; return (x ^ (x >>> 16)) >>> 0; };
const caches = new WeakMap();
const byKey = new WeakMap();

/** The record keys an event row names (its slots, plus a war in arg), for the per-record index. */
function rowKeys(realm, ty, e) {
  const out = [], S = ty.slots;
  for (const sl of ['a', 'b', 'site']) {
    const kind = S[sl], v = e[sl];
    if (v === NONE || !KIND_KEY[kind]) continue;
    out.push(worldKey(kind, v));
  }
  if (S.arg === 'war' && e.arg >= 0) out.push(worldKey('war', e.arg));
  return out;
}
/** The event indices naming world record `key`, in log order (index built once a realm). Deeds list a figure's own rows too. */
export function eventsOf(realm, key) {
  let m = byKey.get(realm);
  if (!m) {
    m = new Map();
    const n = eventCount(realm);
    for (let k = 0; k < n; k++) {
      const e = rowAt(realm, k), ty = EVENT_TYPES[e.type];
      if (!ty) continue;
      for (const key2 of new Set(rowKeys(realm, ty, e))) { let l = m.get(key2); if (!l) m.set(key2, (l = [])); l.push(k); }
    }
    byKey.set(realm, m);
  }
  return m.get(key) || [];
}

/** The kin word ("brother") of figure g to figure f. */
function kinWord(F, f, g) {
  const rel = f.kin[0] === g.id ? 'parent' : f.kin[1] === g.id ? 'spouse' : g.kin[0] === f.id ? 'child' : 'sibling';
  return KIN[rel][g.sex ? 1 : 0];
}

/** The vars of row e (type ty) and the links they name. */
function varsOf(realm, ty, e) {
  const t = T(realm), C = t.civs || [], Si = t.sites || [], F = t.figures || [], A = t.artifacts || [], B = t.beasts || [], W = t.wars || [];
  const v = {}, links = [];
  const name = (kind, id) => {
    if (id === NONE || id < 0) return null;
    let r = null, s = null;
    if (kind === 'civ') { r = C[id]; s = civText(r); } else if (kind === 'site') { r = Si[id]; s = r && r.name; } else if (kind === 'fig') { r = F[id]; s = figureName(r); }
    else if (kind === 'beast') { r = B[id]; s = r && r.name; } else if (kind === 'art') { r = A[id]; s = artifactName(r); }
    if (!r || !s) return null;
    links.push(worldKey(kind, id));
    return s;
  };
  for (const sl of ['a', 'b', 'site']) {
    const kind = ty.slots[sl];
    if (kind === '-') continue;
    const s = name(kind, e[sl]);
    if (s !== null) v[sl] = s;
  }
  const fa = ty.slots.a === 'fig' && e.a !== NONE ? F[e.a] : ty.slots.b === 'fig' && e.b !== NONE && ty.group === 'beast' ? F[e.b] : null;
  if (fa) { const p = PRON[fa.sex ? 1 : 0]; v.pa = p.pa; v.sa = p.sa; }
  const ak = ty.slots.arg;
  if (ak === 'kind') { const k = SITE_KINDS[e.arg]; if (k) v.kind = SITE_WORDS[k] || k; }
  else if (ak === 'fall') v.fall = fallName(e.arg);
  else if (ak === 'war') { const w = W[e.arg]; if (w) links.push(worldKey('war', w.id)); }
  else if (ak === 'n') { v.n = String(e.arg); v.places = e.arg === 1 ? 'one place' : `${NUM[e.arg] || e.arg} places`; if (/^civ\.(pact|oath)/.test(ty.key)) v.oath = oathText(e.arg); }
  if (ty.slots.b === 'art' && e.b !== NONE && A[e.b]) v.artdesc = artifactDesc(A[e.b]);
  if (ty.key === 'fig.died') {
    const f = F[e.a];
    if (f && e.arg === DEATH.slain && f.by !== undefined) { const s = name('fig', f.by); if (s) v.by = s; }
    if (f && e.arg === DEATH.beast && f.byb !== undefined) { const s = name('beast', f.byb); if (s) v.by = s; }
  }
  return { v, links };
}

/** The cause clause of a deed row ('' when it has none), and its links. */
function causeOf(realm, ty, e, v, k) {
  const code = e.flags & 7, rows = CAUSE_TEXT[code];
  if (!rows || !rows.length || (code === 6 && NO_AMBITION.has(ty.key))) return { text: '', links: [] };
  const t = T(realm), F = t.figures || [], C = t.civs || [], Si = t.sites || [], W = t.wars || [];
  const doer = ty.group === 'beast' ? F[e.b] : F[e.a];
  const cv = { pa: v.pa || 'their', sa: v.sa || 'they' }, links = [];
  if (code === 1) { const g = F[e.arg]; if (!g || !doer) return { text: '', links }; cv.k = figureName(g); cv.kin = kinWord(F, doer, g); cv.ky = yearText(g.died === null ? e.year : g.died); links.push(worldKey('fig', g.id)); }
  else if (code === 2) { const s = Si[e.arg]; if (!s) return { text: '', links }; cv.p = s.name; links.push(worldKey('site', s.id)); }
  else if (code === 3) { const w = W[e.arg]; if (!w || !doer) return { text: '', links }; const o = w.a === doer.civ ? w.b : w.a; cv.e = civText(C[o]); links.push(worldKey('war', w.id), worldKey('civ', o)); }
  else if (code === 4) { const c = C[e.arg]; if (!c) return { text: '', links }; cv.o = civText(c); links.push(worldKey('civ', c.id)); }
  const pick = rows[mix(k * 7 + 3) % rows.length];
  return { text: ', ' + fill(pick, cv), links };
}

const SLOT = /\{([a-z]+)\}/g;
const fill = (tpl, v) => tpl.replace(SLOT, (m, k) => (v[k] !== undefined && v[k] !== null ? v[k] : m));
const resolves = (tpl, v) => { for (const m of tpl.matchAll(SLOT)) if (v[m[1]] === undefined || v[m[1]] === null) return false; return true; };
const sentence = (s) => cap(s.replace(/\s+/g, ' ').trim());
/** Cut a line at a word to MAX_LINE (the last resort; the grammar keeps lines well under it). */
function clip(s) {
  if (s.length <= MAX_LINE) return s;
  const cut = s.slice(0, MAX_LINE - 3), sp = cut.lastIndexOf(' ');
  return (sp > 80 ? cut.slice(0, sp) : cut).replace(/[,;:]$/, '') + '...';
}

/** Render event row k of a realm: { k, year, type, key, imp, text, links } (links: world keys in the order named). */
export function eventText(realm, k) {
  let c = caches.get(realm);
  if (!c) caches.set(realm, (c = new Map()));
  const hit = c.get(k);
  if (hit) { c.delete(k); c.set(k, hit); return hit; }
  const e = rowAt(realm, k), ty = EVENT_TYPES[e.type];
  let out;
  if (!ty) out = { k, year: e.year, type: e.type, key: null, imp: 0, text: 'Something happened that no one remembers.', links: [] };
  else {
    const g = GRAMMAR[ty.key] || { v: [['Something happened.']] };
    const { v, links } = varsOf(realm, ty, e);
    const deed = /\{cause\}/.test(JSON.stringify(g.v));
    const cz = deed ? causeOf(realm, ty, e, v, k) : { text: '', links: [] };
    const tiers = (g.byArg && g.byArg[e.arg]) || g.v;
    let text = null, used = cz.links;
    for (const withCause of cz.text ? [true, false] : [false]) {
      v.cause = withCause ? cz.text : '';
      for (const tier of tiers) {
        const ok = tier.filter((tpl) => resolves(tpl, v));
        if (!ok.length) continue;
        const s = sentence(fill(ok[mix(k) % ok.length], v));
        if (s.length <= MAX_LINE || !withCause) { text = s; used = withCause ? cz.links : []; break; }
      }
      if (text !== null) break;
    }
    if (text === null) text = ty.group === 'world' ? 'The world turned.' : 'Something happened that no one remembers.';
    // keep only the links whose names made it into the line (a fallen-through tier may drop a slot)
    const low = text.toLowerCase(), all = [...links, ...used], seen = new Set(), keep = [];
    for (const key of all) {
      if (seen.has(key)) continue;
      seen.add(key);
      const p = parseWorldKey(key);
      if (p.kind === 'war') { const w = (T(realm).wars || [])[p.id], C = T(realm).civs || []; if (w && [w.a, w.b].some((x) => C[x] && low.includes(C[x].name.toLowerCase()))) keep.push(key); continue; }
      const nm = recordName(realm, key);
      if (nm && low.includes(nm.toLowerCase())) keep.push(key);
    }
    out = { k, year: e.year, type: e.type, key: ty.key, imp: ty.imp, text: clip(text), links: keep };
  }
  c.set(k, out);
  if (c.size > CACHE) c.delete(c.keys().next().value);
  return out;
}
/** The number of cached strings of a realm (tests: the cache stays at CACHE). */
export const cachedLines = (realm) => (caches.get(realm) ? caches.get(realm).size : 0);
export const CACHE_SIZE = CACHE;
