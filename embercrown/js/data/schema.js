// Contract C11 (owner G; reviewers E, F, H, K; provisional until the 1a fun review): the content
// data schemas (doc 13.4, 14.3) and the content registry that indexes every js/data file.
//
// File convention (every data file in DATA_FILES)
// - Exports `DATA`: an object { <kind>: [def, def, ...], ... }. A kind may appear in several files
//   (all nine structures/*.js files hold kind 'structure'); ids are unique per kind across files.
// - Defs are plain literals: ids, numbers, strings, arrays, objects. Functions only where a schema
//   field is typed fn (advice rules, incident requires/plan); they must be pure functions of their
//   arguments (no Math.random, Date or globals: determinism rules 14.1).
// - Numbers are integers. Multipliers are integer PERCENTS (100 = x1.0, 150 = x1.5); work is game
//   minutes at speed 1.0 (4.2); durations say their unit in the field name (D days, H hours).
// - Player-facing strings: no emoji, plain sentences; ids match DATA_ID_RE.
// - Positional kinds follow the fixed core orders (skill = SKILL_IDS, worktype = WORK_IDS,
//   need = NEED_IDS, quality = 6 levels) and validate-data checks the order.
// - Stock maps ({ wood: 30, 'ingot:iron': 20 }) name an item id, optionally ':' + a material id.
//
// This module is pure (no I/O, no side effects): js/data/index.js builds the registry from it,
// core/content.js (A) installs the lookups, tools/validate-data.mjs runs validate() plus the checks
// that need other workstreams' code registries.

import { SKILL_IDS, WORK_IDS, NEED_IDS, ATTR_IDS, PART_IDS } from '../game/core/schema.js';

export const SCHEMA_VERSION = 1;
export const DATA_ID_RE = /^[a-z][a-z0-9_]{0,31}$/;

// ---- Data files (the content registry manifest; doc 13.4) ---------------------------------
// owner: the workstream that owns the file (14.2). reuse: kept from the roguelite, import only.
export const DATA_FILES = Object.freeze([
  { path: 'balance.js', owner: 'G' },
  { path: 'worldgen.js', owner: 'B' },
  { path: 'biomes.js', owner: 'G', reuse: true },
  { path: 'biomes-ext.js', owner: 'G', reuse: true },
  { path: 'materials.js', owner: 'G' },
  { path: 'items.js', owner: 'G' },
  { path: 'quality.js', owner: 'G' },
  { path: 'plants.js', owner: 'B' },
  { path: 'animals.js', owner: 'G' },
  { path: 'recipes.js', owner: 'G' },
  { path: 'structures/housing.js', owner: 'G', group: 'housing' },
  { path: 'structures/walls.js', owner: 'G', group: 'walls' },
  { path: 'structures/storage.js', owner: 'G', group: 'storage' },
  { path: 'structures/farming.js', owner: 'G', group: 'farming' },
  { path: 'structures/workshops.js', owner: 'G', group: 'workshops' },
  { path: 'structures/defence.js', owner: 'G', group: 'defence' },
  { path: 'structures/utility.js', owner: 'G', group: 'utility' },
  { path: 'structures/civic.js', owner: 'G', group: 'civic' },
  { path: 'structures/prestige.js', owner: 'G', group: 'prestige' },
  { path: 'rooms.js', owner: 'G' },
  { path: 'research.js', owner: 'G' },
  { path: 'tiers.js', owner: 'G' },
  { path: 'renown.js', owner: 'G' },
  { path: 'addons.js', owner: 'G' },
  { path: 'professions.js', owner: 'F' },
  { path: 'perks.js', owner: 'F' },
  { path: 'roles.js', owner: 'F' },
  { path: 'advice.js', owner: 'G' },
  { path: 'embertouch.js', owner: 'F' },
  { path: 'skills.js', owner: 'F' },
  { path: 'traits.js', owner: 'F' },
  { path: 'needs.js', owner: 'F' },
  { path: 'thoughts.js', owner: 'F' },
  { path: 'breaks.js', owner: 'F' },
  { path: 'worktypes.js', owner: 'G' },
  { path: 'ancestries.js', owner: 'F' },
  { path: 'names.js', owner: 'F' },
  { path: 'backstories.js', owner: 'F' },
  { path: 'starts.js', owner: 'G' },
  { path: 'storytellers.js', owner: 'H' },
  { path: 'incidents.js', owner: 'H' },
  { path: 'raiders.js', owner: 'H' },
  { path: 'factions.js', owner: 'G' },
  { path: 'traders.js', owner: 'G' },
  { path: 'deeds.js', owner: 'G' },
  { path: 'heraldry.js', owner: 'G', reuse: true },
  { path: 'text/letters.js', owner: 'G' },
  { path: 'text/thoughts.js', owner: 'G' },
  { path: 'text/chronicle.js', owner: 'G' },
  { path: 'text/nemesis.js', owner: 'G' },
  { path: 'text/artifacts.js', owner: 'G' },
  { path: 'text/help.js', owner: 'G' },
  { path: 'text/incidents.js', owner: 'G' },
]);
/** Roguelite data files still imported by legacy modules; deleted with them by A (13.5). */
export const LEGACY_DATA_FILES = Object.freeze(['achievements.js', 'buildings.js', 'buildings-civic.js', 'buildings-ext.js',
  'enemies.js', 'enemies-p4.js', 'events.js', 'faction-content.js', 'heroes.js', 'heroes-p4.js', 'military.js', 'units.js']);

// ---- Enums (data-side vocabularies) ----------------------------------------------------------
export const MAT_GROUPS = Object.freeze(['wood', 'stone', 'metal', 'cloth', 'hide', 'gem', 'mineral']);
export const MAT_TAGS = Object.freeze(['flammable', 'glows', 'warm', 'hollowbane', 'shadeproof', 'slow', 'fuel', 'soft']);
export const STRUCT_GROUPS = Object.freeze(['housing', 'walls', 'storage', 'farming', 'workshops', 'defence', 'utility', 'civic', 'prestige']);
export const STRUCT_KINDS = Object.freeze(['construct', 'furniture', 'zone', 'designation']);
export const PLACE_NEEDS = Object.freeze(['shore', 'underground', 'roofed', 'rockFace', 'spring', 'openSky', 'wallAdjacent', 'riverEdge', 'onWall', 'onWater', 'tunnelMouth', 'nearWater',
  'nearForge']);
// Stage 2 flags (appended): fence and window (wall-like), road and bridge (walk), lever, plate, lockable and
// linkable (B's mechanisms, 7.8: a lever or plate drives linked lockable gates and linkable traps), storage
// (holds stacks: see `store`), workplace (no bills: a work spot), pen (an animal enclosure), burial.
export const STRUCT_FLAGS = Object.freeze(['wall', 'door', 'floor', 'roof', 'support', 'shell', 'start', 'unique', 'flammable', 'bed', 'seat', 'table', 'trap', 'tower', 'prestige', 'trophy', 'grave', 'light',
  'fence', 'window', 'road', 'bridge', 'lever', 'plate', 'lockable', 'linkable', 'storage', 'pen', 'burial', 'arrival']);
export const APPAREL_SLOTS = Object.freeze(['body', 'outer', 'head', 'feet', 'hands', 'trinket']);
export const ITEM_TAGS = Object.freeze(['seed', 'fuel', 'medicine', 'tool', 'weapon', 'ranged', 'unique', 'installable', 'art', 'trade', 'corpse', 'deep', 'component', 'feed']);
export const FOOD_KINDS = Object.freeze(['raw', 'meal', 'drink', 'preserved']);
export const BILL_MODES = Object.freeze(['count', 'until', 'forever']);
export const INCIDENT_CATS = Object.freeze(['major', 'minor', 'disaster', 'visitor', 'boon', 'discovery']);
export const THREAT_TAGS = Object.freeze(['hollow', 'reaver', 'beast', 'thief', 'sapper', 'siege', 'rift', 'shade', 'knight', 'blight', 'vermin', 'breach', 'pilgrim', 'wyvern', 'fire', 'cold']);
export const ARRIVE = Object.freeze(['day', 'dusk', 'night', 'any']);
export const FACTION_KINDS = Object.freeze(['traders', 'knights', 'raiders', 'thieves', 'pilgrims']);
export const DEED_CATS = Object.freeze(['founding', 'craft', 'war', 'depth', 'people', 'crown']);
export const ANIMAL_KINDS = Object.freeze(['farm', 'wild', 'beast', 'cave']);
export const PLANT_KINDS = Object.freeze(['crop', 'tree', 'bush', 'wild']);
export const BREAK_SEV = Object.freeze(['minor', 'major', 'extreme']);
export const RAIDER_KINDS = Object.freeze(['hollow', 'reaver', 'gutterkin', 'beast']);
// Great beasts (EMBERCROWN-FORTRESS.md 3.12): where a beast's lair is and the world causes (2.10) that can
// wake it. A beast is never summoned: it comes only while one of its causes holds.
export const BEAST_LAIRS = Object.freeze(['eyrie', 'cavern', 'deep', 'sleep']);
export const CAUSE_KINDS = Object.freeze(['grievance', 'rumour', 'opened_cavern', 'near_lair', 'woken_seep', 'hunger', 'hard_winter', 'seal']);
// Add-on forms (3.7): a structure beside the bench, or a master set.
export const ADDON_FORMS = Object.freeze(['structure', 'master']);
/** Build stages (14.5-14.10). A structure or recipe names the stage that introduces it; menus and
 *  the bot show only what `availableIn(def, stage)` allows (the Stage 1a slice is '1a'). */
export const STAGES = Object.freeze(['1a', '1b', '2', '3', '4']);
/** True when def `d` (a structure or recipe; untagged defs count as Stage 2) is available at `stage`. */
export const availableIn = (d, stage) => STAGES.indexOf(d && d.stage ? d.stage : '2') <= STAGES.indexOf(stage);
/** Material groups an item kind comes in (item.mat is one group or a list; [] when it has none). */
export const matGroupsOf = (it) => (!it || !it.mat ? [] : Array.isArray(it.mat) ? it.mat : [it.mat]);
/** Rule hooks content may name in addon.adds.rules and perk.grants.rule (code owners implement them). */
export const RULE_IDS = Object.freeze([
  'cutInPlace', 'matchedSet', 'temper', 'refit', 'meltDown', 'feastDay', 'tavernService', 'calmingTea', 'drillHour',
  'shootingMatch', 'cellarAgeing', 'quickShoring', 'seamFollower', 'caveSense', 'fieldSurgeon', 'stoneCarver', 'hearthCook',
]);
/** Modifier engine (13.3, A's core/mods.js): { key, op, value, when? }. Keys are dotted, from these roots. */
export const MOD_ROOTS = Object.freeze(['work', 'learn', 'quality', 'need', 'mood', 'thought', 'break', 'dmg', 'armour', 'move',
  'carry', 'light', 'heat', 'beauty', 'comfort', 'yield', 'price', 'research', 'threat', 'hp', 'rot', 'tend', 'warn', 'claim', 'fire', 'cold']);
export const MOD_OPS = Object.freeze(['add', 'pct', 'set', 'flag']);
const MOD_KEY_RE = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9_]+){0,3}$/;
const WHEN_RE = /^[a-z][a-zA-Z0-9]*(:[a-z0-9_]+)?$/;
const SEASONS_RE = /^[TBAD]{1,4}$/;            // Thaw, Bright (Highsun), Ashfall, Deepcold
const PLACEHOLDER_RE = /\{([a-zA-Z0-9_]+)\}/g;
// Emoji, pictographs, dingbats, variation selector 16 and zero-width joiner (no emoji, 14.1 brief).
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/u;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000B-\u001F\u007F]/;

/** Kinds whose ids are fixed by core contracts (C2) rather than by data files. */
export const STATIC_KINDS = Object.freeze({ skill: SKILL_IDS, work: WORK_IDS, need: NEED_IDS, attr: ATTR_IDS, part: PART_IDS });
/** Content kinds named by command validators (core/commands.js setContentLookup) -> registry kind. */
export const COMMAND_KINDS = Object.freeze({ structure: 'structure', material: 'material', role: 'role', recipe: 'recipe',
  tech: 'tech', perk: 'perk', stamp: 'stamp', outfit: 'outfit', item: 'item',
  zonePreset: 'zonePreset', crop: 'plant', town: 'town' });

// ---- Field descriptors ---------------------------------------------------------------------
const D = (t, o = {}) => Object.freeze({ t, ...o });
export const T = Object.freeze({
  id: () => D('id'),
  str: (max = 48) => D('str', { max }),
  text: (max = 400) => D('text', { max }),
  int: (min = 0, max = 1e9) => D('int', { min, max }),
  pct: (min = 0, max = 10000) => D('int', { min, max }),
  bool: () => D('bool'),
  oneOf: (vals) => D('enum', { vals }),
  ref: (kind) => D('ref', { kind }),
  refs: (kind, min = 0, max = 64) => D('refs', { kind, min, max }),
  list: (item, min = 0, max = 256) => D('list', { item, min, max }),
  obj: (fields) => D('obj', { fields }),
  map: (key, val) => D('map', { key, val }),
  stock: (min = 1) => D('stock', { min }),
  range: (min = 0, max = 1e9) => D('range', { min, max }),
  mods: () => D('mods'),
  fn: () => D('fn'),
  json: () => D('json'),
});
const opt = (d) => Object.freeze({ ...d, opt: true });
const { id, str, text, int, pct, bool, oneOf, ref, refs, list, obj, map, stock, range, mods, fn, json } = T;
const size = () => list(int(1, 8), 2, 2);
/** One material group, or a list of 2-4 (furniture that comes in wood or stone). */
const matGroups = () => D('matGroups');
const light = () => obj({ lvl: int(1, 3), r: int(1, 24), fuel: opt(obj({ k: ref('item'), perDay: int(1, 100) })) });

// ---- Schemas per kind ----------------------------------------------------------------------
// fields: descriptor per field (unknown fields are errors). check(def, c): custom rules.
export const SCHEMAS = {
  balance: { fields: { id: id(), values: json() } },
  // materials.js (6.1)
  material: { fields: { id: id(), name: str(), group: oneOf(MAT_GROUPS), hp: pct(1, 1000), work: pct(1, 1000),
    beauty: int(-10, 50), value: pct(1, 100000), tags: opt(list(oneOf(MAT_TAGS))), insul: opt(pct(0, 1000)),
    vsHollow: opt(pct(0, 1000)), armour: opt(pct(0, 1000)), fuelD: opt(int(1, 100)), tint: opt(str(9)) } },
  // items.js (5.5, 5.6, 6.2, 6.6)
  itemCat: { fields: { id: id(), name: str(), parent: opt(ref('itemCat')) } },
  item: {
    fields: { id: id(), name: str(), cat: ref('itemCat'), stack: int(1, 1000), mass: int(0, 1000), value: int(0, 1000000),
      mat: opt(matGroups()), shelfD: opt(int(1, 1000)), food: opt(obj({ kind: oneOf(FOOD_KINDS), nutr: int(1, 100), joy: opt(int(0, 20)) })),
      slot: opt(oneOf(APPAREL_SLOTS)), tags: opt(list(oneOf(ITEM_TAGS))), art: opt(str()), text: opt(text()),
      // Stage 2 (6.6): weapon stats (dmg per hit, speed percent, reach in tenths of a tile: 10 melee,
      // 15 a spear's reach, 80 a shortbow), worn protection (armour percent of damage stopped, insul
      // degrees C of cold kept off), modifiers while carried or worn (a pick: work.mine +25%),
      // medicine potency (tend quality percent) and fuel value (percent of one wood).
      weapon: opt(obj({ dmg: int(1, 100), speed: pct(10, 300), reach: int(10, 200), mods: opt(mods()) })),
      wear: opt(obj({ armour: pct(0, 90), insul: int(0, 40) })), mods: opt(mods()), med: opt(pct(1, 300)), fuel: opt(pct(1, 10000)) },
    check(d, c) {
      if (d.slot && d.stack !== 1) c.err('slot', 'apparel and gear must have stack 1');
      if (d.weapon && d.stack !== 1) c.err('weapon', 'a weapon must have stack 1');
      if (d.wear && !d.slot) c.err('wear', 'worn protection needs an apparel slot');
    },
  },
  zonePreset: { fields: { id: id(), name: str(), cats: refs('itemCat', 1), pri: int(0, 3), text: opt(text()) } },
  outfit: { fields: { id: id(), name: str(), allow: opt(refs('itemCat')), text: opt(text()) } },
  // quality.js (5.8)
  quality: { fields: { id: id(), name: str(), min: int(-99, 99), value: pct(), beauty: pct(), comfort: pct(), armour: pct(), dmg: pct() } },
  // plants.js (6.5; owner B)
  plant: { fields: { id: id(), name: str(), kind: oneOf(PLANT_KINDS), days: int(1, 400), yield: stock(), minTemp: int(-30, 45),
    sow: bool(), underground: opt(bool()), dark: opt(bool()), perennial: opt(bool()), tech: opt(ref('tech')), art: opt(str()) } },
  // animals.js (6.5, 9.2)
  animal: { fields: { id: id(), name: str(), kind: oneOf(ANIMAL_KINDS), hp: int(1, 2000), speed: pct(10, 400), size: int(1, 4),
    tame: opt(int(0, 20)), hostile: opt(bool()), pts: opt(int(1, 5000)), products: opt(list(obj({ k: ref('item'), n: int(1, 100), everyD: int(1, 40) }))),
    butcher: opt(stock()), art: opt(str()) } },
  // recipes.js (6.4)
  recipe: {
    fields: { id: id(), name: str(), bench: refs('structure', 1), in: list(obj({ k: opt(ref('item')), cat: opt(ref('itemCat')), n: int(1, 1000), mat: opt(ref('material')) }), 1, 8),
      // out.mat: a fixed material for the product (bronze from copper and tin; E's bills.js reads it)
      out: list(obj({ k: ref('item'), n: int(1, 1000), matFrom: opt(int(0, 7)), mat: opt(ref('material')) }), 1, 8), skill: ref('skill'), work: int(1, 10000),
      minSkill: int(0, 20), quality: bool(), tech: opt(ref('tech')), addon: opt(ref('addon')), xp: opt(int(0, 100000)), stage: oneOf(STAGES), text: opt(text()),
      // waitH: game hours the loaded batch then sits unattended before it can be taken out (cask, smokehouse, tannery, charcoal kiln)
      waitH: opt(int(1, 240)) },
    check(d, c) {
      (d.in || []).forEach((x, i) => { if (!x || (x.k ? 1 : 0) + (x.cat ? 1 : 0) !== 1) c.err(`in[${i}]`, 'needs exactly one of k or cat'); });
      (d.out || []).forEach((x, i) => {
        if (x && x.matFrom !== undefined && x.matFrom >= (d.in || []).length) c.err(`out[${i}].matFrom`, 'points past the ingredient list');
        if (x && x.matFrom !== undefined && x.mat) c.err(`out[${i}]`, 'needs at most one of matFrom or mat');
      });
    },
  },
  // structures/*.js (7.1)
  structure: {
    fields: { id: id(), name: str(), cat: oneOf(STRUCT_GROUPS), kind: oneOf(STRUCT_KINDS), size: size(), cost: opt(stock()),
      costByMat: opt(list(obj({ cat: ref('itemCat'), n: int(1, 1000) }), 1, 4)), item: opt(ref('item')), work: opt(int(0, 100000)),
      hp: opt(int(1, 100000)), tech: opt(ref('tech')), tier: opt(ref('tier')), band: opt(ref('tier')), claim: opt(bool()), claimR: opt(int(1, 40)),
      needs: opt(list(oneOf(PLACE_NEEDS))), beauty: opt(int(-20, 50)), comfort: opt(pct(0, 300)), light: opt(light()), heat: opt(int(0, 1000)),
      roomRole: opt(ref('room')), cap: opt(int(1, 16)),
      workbench: opt(obj({ workType: ref('work'), addons: opt(refs('addon')), workplace: opt(bool()),
        autoBills: opt(list(obj({ recipe: ref('recipe'), mode: oneOf(BILL_MODES), n: int(1, 1000), perCol: opt(bool()) }), 0, 10)) })),
      levels: opt(list(obj({ name: str(), tech: opt(ref('tech')), tier: opt(ref('tier')), cost: stock(), work: int(1, 100000) }), 1, 4)),
      stages: opt(list(obj({ name: str(), cost: stock(), work: int(1, 1000000) }), 1, 3)),
      flags: opt(list(oneOf(STRUCT_FLAGS))), art: str(), ancestry: opt(ref('ancestry')), mods: opt(mods()), stage: oneOf(STAGES), text: opt(text()),
      // Stage 2: storage furniture and buildings (5.5, 7.4): stacks held per tile (or in all), the categories
      // they take (default any), the rot percent while stored (100 = normal; 0 = frozen) and whether thieves
      // take longer (theftPct). E's stockpiles read it.
      store: opt(obj({ stacks: int(1, 64), cats: opt(refs('itemCat', 1)), rotPct: opt(pct(0, 100)), theftPct: opt(pct(100, 1000)), vermin: opt(bool()) })) },
    check(d, c) {
      if (c.group && d.cat !== c.group) c.err('cat', `must be '${c.group}' in this file`);
      if ((d.flags || []).includes('prestige') && d.cat !== 'prestige') c.err('flags', 'prestige buildings live in structures/prestige.js');
      if (d.cat === 'prestige' && d.mods && d.mods.length) c.err('mods', 'a prestige building has no percentage effects (3.11)');
      const shell = (d.flags || []).includes('start');
      if (d.kind === 'construct' && !d.cost && !d.costByMat && !d.stages && !shell) c.err('cost', 'a construct needs cost, costByMat or stages');
      if (d.kind !== 'construct' && (d.cost || d.costByMat)) c.err('cost', `a ${d.kind} has no build cost (furniture is crafted, zones are painted)`);
      if (d.kind !== 'furniture' && d.item) c.err('item', 'only furniture installs an item');
    },
  },
  // rooms.js (7.11, 10.11)
  room: { fields: { id: id(), name: str(), order: int(0, 100), match: obj({ any: opt(refs('structure')), count: opt(int(1, 20)),
    workbench: opt(bool()), underground: opt(bool()), fallback: opt(bool()) }), thoughts: opt(list(int(-20, 20), 6, 6)), text: opt(text()) } },
  roomTier: { fields: { id: id(), name: str(), min: int(0, 100000) } },
  stamp: { fields: { id: id(), name: str(), room: ref('room'), minSize: int(3, 20), bench: opt(bool()), preset: opt(ref('zonePreset')),
    furnish: list(obj({ def: ref('structure'), per: opt(int(1, 100)) }), 0, 8), stage: opt(oneOf(STAGES)) } },
  // research.js (7.12)
  era: { fields: { id: id(), name: str(), tier: ref('tier') } },
  // discover.k narrows the event to one kind, as deed goals do (oreFound k 'clay'; K's discover() matches it)
  tech: { fields: { id: id(), name: str(), era: ref('era'), cost: int(0, 5000), discover: opt(obj({ event: str(), k: opt(str()), effect: oneOf(['free', 'half']) })), text: opt(text()) } },
  // tiers.js (8.4)
  tier: { fields: { id: id(), name: str(), abbr: str(3), i: int(0, 5), wealth: int(0, 10000000), colonists: int(0, 40), hearth: int(1, 4),
    waystones: int(-1, 100), text: text() } },
  hearthLevel: { fields: { id: id(), name: str(), lvl: int(1, 4), cost: opt(stock()), light: light(), claim: int(1, 40),
    shot: obj({ dmg: int(0, 1000), every: int(1, 1000), targets: int(1, 10) }), text: text() } },
  // renown.js (EMBERCROWN-FORTRESS.md 3.10): never gates anything; lean is cause kind -> weight percent
  renown: { fields: { id: id(), name: str(), epithet: str(64), threshold: int(1, 100000), measures: list(id(), 1, 6), visitor: str(80),
    lean: opt(map(oneOf(CAUSE_KINDS), pct(1, 1000))), text: text() } },
  // addons.js (3.7)
  addon: { fields: { id: id(), name: str(), bench: refs('structure', 1, 3), form: oneOf(ADDON_FORMS),
    adds: obj({ recipes: opt(refs('recipe')), toils: opt(list(id())), structures: opt(refs('structure')), rules: opt(list(oneOf(RULE_IDS))) }),
    text: text(), also: opt(text(80)) },
    check(d, c) { const a = d.adds || {}; if (!(a.recipes || []).length && !(a.toils || []).length && !(a.structures || []).length && !(a.rules || []).length) c.err('adds', 'an add-on must add a verb (3.7: recipes, toils, structures or rules)'); } },
  // starts.js (8.5)
  start: { fields: { id: id(), name: str(), default: opt(bool()), hard: opt(bool()),
    band: list(obj({ anc: opt(ref('ancestry')), any: opt(bool()), req: opt(obj({ skill: ref('skill'), min: int(0, 20) })) }), 1, 3),
    items: stock(), animals: opt(map(ref('animal'), int(1, 20))),
    map: obj({ biome: str(), mountainD: opt(int(0, 64)), cavernD: opt(int(0, 64)), edge: opt(str()) }),
    story: opt(obj({ firstMajorD: opt(int(0, 40)), wandererD: opt(int(0, 40)) })), text: text() },
    check(d, c) { (d.band || []).forEach((b, i) => { if (b && !b.anc === !b.any) c.err(`band[${i}]`, 'needs exactly one of anc or any'); }); } },
  // factions.js, traders.js (9.8)
  faction: { fields: { id: id(), name: str(), kind: oneOf(FACTION_KINDS), goodwill: bool(), start: int(-100, 100), text: text() } },
  town: { fields: { id: id(), name: str(), faction: ref('faction'), days: range(1, 20), text: opt(text()) } },
  trader: { fields: { id: id(), name: str(), tier: ref('tier'), faction: opt(ref('faction')), sells: refs('itemCat', 1), buys: refs('itemCat', 1),
    buyPct: pct(1, 1000), sellPct: pct(1, 1000), river: opt(bool()), text: text() } },
  // deeds.js
  deed: { fields: { id: id(), name: str(), cat: oneOf(DEED_CATS), goal: obj({ event: str(), n: int(1, 100000), k: opt(str()) }), hidden: opt(bool()), text: text() } },
  // advice.js (10.10)
  // go.def: the structure a 'place' tool starts with (I's card: { kind: 'place', def })
  advice: { fields: { id: id(), text: text(120), when: fn(), score: fn(), go: obj({ panel: opt(id()), tool: opt(id()), def: opt(ref('structure')) }), cooldownD: opt(int(0, 40)),
    stage: opt(oneOf(STAGES)) },
    check(d, c) { if (d.go && !d.go.panel === !d.go.tool) c.err('go', 'needs exactly one of panel or tool'); } },
  // worktypes.js (5.1)
  worktype: { order: 'work', fields: { id: id(), name: str(), skills: refs('skill', 0, 2), givers: list(id(), 1, 8), text: text() } },
  // text/*.js
  text: { fields: { id: id(), text: opt(text(600)), variants: opt(list(text(600), 1, 32)), vars: opt(list(id())) },
    check(d, c) {
      if (!d.text === !d.variants) { c.err('text', 'needs exactly one of text or variants'); return; }
      const vars = new Set(d.vars || []);
      for (const t of d.text ? [d.text] : d.variants) for (const m of String(t).matchAll(PLACEHOLDER_RE)) if (!vars.has(m[1])) c.err('vars', `placeholder {${m[1]}} is not listed in vars`);
    } },
  // ---- F's files (people, 4.x, 5.1, 8.1) --------------------------------------------------
  skill: { order: 'skill', fields: { id: id(), name: str(), attr: ref('attr'), key: bool(), work: refs('work', 0, 4), text: opt(text()) } },
  trait: { fields: { id: id(), name: str(), excl: opt(ref('trait')), weight: int(0, 100), mods: mods(), text: text() } },
  // need.stage: the build stage whose sim runs this need (Stage 1b: food, rest, light; joy and
  // warmth from Stage 2). thoughts: condition thoughts by threshold; the lowest `below` that holds wins.
  need: { order: 'need', fields: { id: id(), name: str(), fallPerDay: int(0, 1000), thoughts: list(obj({ below: int(0, 100), thought: ref('thought') }), 0, 4),
    stage: opt(oneOf(STAGES)), text: opt(text()) } },
  // thought.durationH 0 = a condition thought (lasts while its cause holds); text is the card line.
  thought: { fields: { id: id(), label: str(64), value: int(-50, 50), durationH: int(0, 2400), stack: opt(obj({ max: int(1, 20), decay: pct(0, 100) })), tags: opt(list(id())),
    text: opt(text()) } },
  // break.stage: the stage whose sim has this break's behaviour (job); later ones are skipped.
  break: { fields: { id: id(), name: str(), sev: oneOf(BREAK_SEV), hours: range(1, 48), trait: opt(ref('trait')), job: opt(id()), stage: opt(oneOf(STAGES)), text: text() } },
  ancestry: { fields: { id: id(), name: str(), learn: opt(map(ref('skill'), pct(10, 400))), mods: mods(), art: opt(str()),
    passions: opt(int(0, 3)), look: opt(obj({ skin: int(1, 16), hair: int(1, 16), hairC: int(1, 16), beard: int(1, 16), cloth: int(1, 16) })), text: text() } },
  names: { fields: { id: id(), first: list(str(12), 2), family: list(str(12), 2) } },
  backstory: { fields: { id: id(), name: str(), slot: oneOf(['child', 'adult']), title: str(), skills: map(ref('skill'), int(-6, 8)),
    disables: opt(refs('work', 0, 2)), trait: opt(ref('trait')), text: opt(text()) } },
  perk: { fields: { id: id(), skill: ref('skill'), lvl: oneOf([10, 15, 20]), name: str(), text: text(),
    grants: obj({ toil: opt(id()), recipe: opt(ref('recipe')), rule: opt(oneOf(RULE_IDS)) }), mods: mods() },
    check(d, c) { const g = d.grants || {}; if (((g.toil ? 1 : 0) + (g.recipe ? 1 : 0) + (g.rule ? 1 : 0)) > 1) c.err('grants', 'a perk grants at most one hook (8.1)'); } },
  profession: { fields: { id: id(), name: str(), skill: ref('skill'), look: opt(str()) } },
  role: { fields: { id: id(), name: str(), icon: str(24), prio: map(ref('work'), int(1, 4)), soldier: bool(), all: opt(int(1, 4)), stage: opt(oneOf(STAGES)) },
    check(d, c) { if (!d.all && !Object.keys(d.prio || {}).length) c.err('prio', 'a role needs key work or all'); } },
  emberDemand: { fields: { id: id(), skill: ref('skill'), tier: ref('tier'), mats: stock(), deep: stock() } },
  // ---- H's files (threats, 9.x) ---------------------------------------------------------------
  storyteller: { fields: { id: id(), name: str(), majorD: range(1, 40), warnH: range(0, 36), minors: range(0, 20), boons: range(0, 20),
    ptsPct: pct(1, 1000), floorPct: pct(1, 1000), default: opt(bool()), text: text() } },
  incident: { fields: { id: id(), cat: oneOf(INCIDENT_CATS), minTier: ref('tier'), seasons: str(4), weight: int(0, 1000), cooldownD: int(0, 400),
    pts: opt(obj({ min: int(0, 5000), mult: pct(1, 1000) })), warnH: opt(range(0, 36)), arrive: oneOf(ARRIVE), requires: opt(fn()), plan: opt(fn()),
    cast: opt(json()), after: opt(list(id())), tags: opt(list(oneOf(THREAT_TAGS))), letter: ref('text') },
    check(d, c) { if (typeof d.seasons === 'string' && !SEASONS_RE.test(d.seasons)) c.err('seasons', 'letters from TBAD'); } },
  raider: { fields: { id: id(), name: str(), kind: oneOf(RAIDER_KINDS), pts: int(1, 5000), hp: int(1, 100000), tags: opt(list(oneOf(THREAT_TAGS))), art: opt(str()) } },
  beast: { fields: { id: id(), name: str(), legend: opt(bool()), lair: oneOf(BEAST_LAIRS), causes: list(oneOf(CAUSE_KINDS), 1, 4), art: opt(str()), text: text() } },
  // ---- B's files (world, 3.2) -----------------------------------------------------------------
  rockLayer: { fields: { id: id(), name: str(), depth: range(1, 255), stones: refs('material', 1, 4), work: int(1, 1000) } },
  deposit: { fields: { id: id(), item: ref('item'), mat: opt(ref('material')), depth: range(1, 255), veins: range(0, 40), yield: int(1, 20), glow: opt(bool()) } },
};

// ---- Validation ----------------------------------------------------------------------------
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

function badString(v, max) {
  if (typeof v !== 'string') return 'must be a string';
  if (!v.length) return 'must not be empty';
  if (v.length > max) return `longer than ${max} characters`;
  if (v.trim() !== v) return 'has leading or trailing spaces';
  if (EMOJI_RE.test(v)) return 'contains an emoji or pictograph (not allowed)';
  if (CONTROL_RE.test(v)) return 'contains a control character';
  return null;
}
function badJson(v, depth = 0) {
  if (depth > 12) return 'nested too deeply';
  if (v === null || typeof v === 'boolean') return null;
  if (typeof v === 'string') return EMOJI_RE.test(v) || CONTROL_RE.test(v) ? 'contains an emoji or control character' : null;
  if (typeof v === 'number') return Number.isFinite(v) ? null : 'must be a finite number';
  if (Array.isArray(v)) { for (const x of v) { const e = badJson(x, depth + 1); if (e) return e; } return null; }
  if (isObj(v)) { for (const k of Object.keys(v)) { const e = badJson(v[k], depth + 1); if (e) return `${k}: ${e}`; } return null; }
  return `type ${typeof v} is not plain data`;
}

/** Check one value against a descriptor. c = { err(path, msg), ref(kind, id, path) }. */
export function checkValue(d, v, path, c) {
  if (v === undefined || v === null) { if (!d.opt) c.err(path, 'is required'); return; }
  const e = (m) => c.err(path, m);
  switch (d.t) {
    case 'id': if (typeof v !== 'string' || !DATA_ID_RE.test(v)) e(`must be an id (${DATA_ID_RE})`); return;
    case 'str': case 'text': { const b = badString(v, d.max); if (b) e(b); return; }
    case 'int': if (!Number.isInteger(v)) e('must be an integer (multipliers are integer percents)'); else if (v < d.min || v > d.max) e(`must be ${d.min}..${d.max}`); return;
    case 'bool': if (typeof v !== 'boolean') e('must be true or false'); return;
    case 'enum': if (!d.vals.includes(v)) e(`must be one of ${d.vals.join(', ')}`); return;
    case 'ref': if (typeof v !== 'string' || !DATA_ID_RE.test(v)) e(`must be a ${d.kind} id`); else c.ref(d.kind, v, path); return;
    case 'refs': {
      if (!Array.isArray(v)) { e(`must be a list of ${d.kind} ids`); return; }
      if (v.length < d.min || v.length > d.max) e(`must list ${d.min}..${d.max} ids`);
      if (new Set(v).size !== v.length) e('lists an id twice');
      v.forEach((x, i) => checkValue({ t: 'ref', kind: d.kind }, x, `${path}[${i}]`, c));
      return;
    }
    case 'list':
      if (!Array.isArray(v)) { e('must be a list'); return; }
      if (v.length < d.min || v.length > d.max) e(`must have ${d.min}..${d.max} entries`);
      v.forEach((x, i) => checkValue(d.item, x, `${path}[${i}]`, c));
      return;
    case 'obj': {
      if (!isObj(v)) { e('must be an object'); return; }
      for (const k of Object.keys(v)) if (!(k in d.fields)) c.err(`${path}.${k}`, 'unknown field');
      for (const k of Object.keys(d.fields)) checkValue(d.fields[k], v[k], `${path}.${k}`, c);
      return;
    }
    case 'map': {
      if (!isObj(v)) { e('must be an object'); return; }
      for (const k of Object.keys(v)) {
        checkValue(d.key, d.key.t === 'enum' && /^-?\d+$/.test(k) ? Number(k) : k, `${path} key '${k}'`, c);
        checkValue(d.val, v[k], `${path}.${k}`, c);
      }
      return;
    }
    case 'stock': {
      if (!isObj(v)) { e("must be a stock map { item: n, 'item:material': n }"); return; }
      const keys = Object.keys(v);
      if (keys.length < d.min) e(`must name at least ${d.min} item`);
      for (const k of keys) {
        const [k1, m1, extra] = k.split(':');
        if (extra !== undefined || !DATA_ID_RE.test(k1 || '') || (m1 !== undefined && !DATA_ID_RE.test(m1))) { c.err(`${path} key '${k}'`, "must be 'item' or 'item:material'"); continue; }
        c.ref('item', k1, `${path} key '${k}'`);
        if (m1 !== undefined) c.ref('itemMat', `${k1}:${m1}`, `${path} key '${k}'`);
        if (!Number.isInteger(v[k]) || v[k] < 1) c.err(`${path}.${k}`, 'must be a positive integer');
      }
      return;
    }
    case 'range':
      if (!Array.isArray(v) || v.length !== 2 || !v.every(Number.isInteger)) { e('must be [lo, hi] integers'); return; }
      if (v[0] > v[1]) e('lo is above hi');
      if (v[0] < d.min || v[1] > d.max) e(`must lie in ${d.min}..${d.max}`);
      return;
    case 'mods':
      if (!Array.isArray(v)) { e('must be a list of modifiers'); return; }
      v.forEach((m, i) => {
        const p = `${path}[${i}]`;
        if (!isObj(m)) { c.err(p, 'must be { key, op, value, when? }'); return; }
        for (const k of Object.keys(m)) if (!['key', 'op', 'value', 'when'].includes(k)) c.err(`${p}.${k}`, 'unknown field');
        if (typeof m.key !== 'string' || !MOD_KEY_RE.test(m.key)) c.err(`${p}.key`, 'must be a dotted modifier key');
        else if (!MOD_ROOTS.includes(m.key.split('.')[0])) c.err(`${p}.key`, `root must be one of ${MOD_ROOTS.join(', ')}`);
        if (!MOD_OPS.includes(m.op)) c.err(`${p}.op`, `must be one of ${MOD_OPS.join(', ')}`);
        else if (m.op === 'flag' ? typeof m.value !== 'boolean' : !Number.isInteger(m.value)) c.err(`${p}.value`, m.op === 'flag' ? 'must be true or false' : 'must be an integer');
        if (m.when !== undefined && (typeof m.when !== 'string' || !WHEN_RE.test(m.when))) c.err(`${p}.when`, "must be a condition id such as 'night' or 'room:bedroom'");
      });
      return;
    case 'matGroups': {
      const list = Array.isArray(v) ? v : [v];
      if (Array.isArray(v) && (v.length < 2 || v.length > 4 || new Set(v).size !== v.length)) e('a list of material groups needs 2..4 distinct groups');
      for (const g of list) if (!MAT_GROUPS.includes(g)) e(`must be a material group (${MAT_GROUPS.join(', ')}) or a list of them`);
      return;
    }
    case 'fn': if (typeof v !== 'function') e('must be a function'); return;
    case 'json': { const b = badJson(v); if (b) e(b); return; }
    default: e(`schema error: unknown descriptor ${d.t}`);
  }
}

// ---- Registry ------------------------------------------------------------------------------
/**
 * Build the content registry from loaded modules.
 * @param {Array<{path:string, owner?:string, group?:string, reuse?:boolean, mod:object|null}>} entries in DATA_FILES order
 * @returns registry: has(kind, id), get(kind, id), all(kind) (file order), srcOf(kind, id), kinds(), errors[]
 */
export function buildRegistry(entries) {
  const by = new Map(), lists = new Map(), src = new Map(), errors = [];
  for (const en of entries) {
    if (en.reuse) continue;
    const mod = en.mod;
    if (!mod) { errors.push(`${en.path}: missing (owner ${en.owner || '?'})`); continue; }
    const data = mod.DATA;
    if (!isObj(data)) { errors.push(`${en.path}: must export DATA = { kind: [defs] }`); continue; }
    for (const kind of Object.keys(data)) {
      if (!SCHEMAS[kind]) { errors.push(`${en.path}: unknown kind '${kind}'`); continue; }
      const arr = data[kind];
      if (!Array.isArray(arr)) { errors.push(`${en.path}: DATA.${kind} must be an array`); continue; }
      if (!by.has(kind)) { by.set(kind, new Map()); lists.set(kind, []); }
      const m = by.get(kind);
      arr.forEach((def, i) => {
        const did = def && def.id;
        if (typeof did !== 'string') { errors.push(`${en.path}: ${kind}[${i}] has no string id`); return; }
        if (m.has(did)) { errors.push(`${en.path}: duplicate ${kind} id '${did}' (first in ${src.get(`${kind}:${did}`)})`); return; }
        m.set(did, def); lists.get(kind).push(def); src.set(`${kind}:${did}`, en.path);
      });
    }
  }
  const has = (kind, x) => (STATIC_KINDS[kind] ? STATIC_KINDS[kind].includes(x) : !!(by.get(kind) && by.get(kind).has(x)));
  return {
    has, errors,
    get: (kind, x) => (by.get(kind) && by.get(kind).get(x)) || null,
    all: (kind) => lists.get(kind) || [],
    srcOf: (kind, x) => src.get(`${kind}:${x}`) || null,
    kinds: () => [...by.keys()],
  };
}

/** Lookup for core/commands.js setContentLookup: fn(kind, id) -> boolean. */
export function commandLookup(reg) {
  return (kind, x) => reg.has(COMMAND_KINDS[kind] || kind, x);
}
/** Lookup for work/items.js setItemDefs: fn(kind) -> { stack, cat, mass } | null. */
export function itemDefLookup(reg) {
  return (k) => { const d = reg.get('item', k); return d ? { stack: d.stack, cat: d.cat, mass: d.mass } : null; };
}

/** Values of a balance section (DATA.balance entry), or null. */
export const balanceOf = (reg, sectionId) => { const b = reg.get('balance', sectionId); return b ? b.values : null; };

// ---- Whole-registry validation (pure; no I/O) --------------------------------------------------
/**
 * Validate every def and every cross reference.
 * @returns {{ errors: string[], warnings: string[], defs: number }}
 */
export function validate(reg, entries) {
  const errors = [...reg.errors], warnings = [];
  const refs = [];
  let defs = 0;
  const groupOf = new Map(entries.map((e) => [e.path, e.group || null]));
  for (const kind of reg.kinds()) {
    const sch = SCHEMAS[kind];
    for (const def of reg.all(kind)) {
      defs++;
      const where = `${reg.srcOf(kind, def.id)}: ${kind} '${def.id}'`;
      const c = { group: groupOf.get(reg.srcOf(kind, def.id)), err: (p, m) => errors.push(`${where}${p ? ` .${p.replace(/^\./, '')}` : ''}: ${m}`), ref: (k, x, p) => refs.push([k, x, where, p]) };
      checkValue({ t: 'obj', fields: sch.fields }, def, '', c);
      if (sch.check) sch.check(def, c);
    }
  }
  for (const [k, x, where, p] of refs) {
    const at = `${where} ${p.replace(/^\./, '')}`;
    if (k === 'itemMat') {
      const [ik, mk] = x.split(':'), it = reg.get('item', ik), m = reg.get('material', mk);
      if (!m) errors.push(`${at}: unknown material '${mk}'`);
      else if (it && !matGroupsOf(it).includes(m.group)) errors.push(`${at}: item '${ik}' does not come in ${m.group} material '${mk}'`);
    } else if (!reg.has(k, x)) errors.push(`${at}: unknown ${k} '${x}'`);
  }
  crossCheck(reg, errors, warnings);
  return { errors, warnings, defs };
}

function crossCheck(reg, errors, warnings) {
  // Positional kinds follow the core orders exactly.
  for (const [kind, ord] of [['skill', SKILL_IDS], ['worktype', WORK_IDS], ['need', NEED_IDS]]) {
    const got = reg.all(kind).map((d) => d.id);
    if (got.length && got.join() !== ord.join()) errors.push(`${kind}: ids must be exactly [${ord.join(', ')}] in this order (got [${got.join(', ')}])`);
  }
  const q = reg.all('quality');
  if (q.length && q.length !== 6) errors.push(`quality: must define the 6 levels (got ${q.length})`);
  for (let i = 1; i < q.length; i++) if (q[i].min <= q[i - 1].min) errors.push(`quality '${q[i].id}': min must rise level by level`);
  const tiers = reg.all('tier');
  tiers.forEach((t, i) => { if (t.i !== i) errors.push(`tier '${t.id}': i must be ${i} (file order is tier order)`); });
  // Item categories: items sit on leaves.
  const parents = new Set(reg.all('itemCat').map((cdef) => cdef.parent).filter(Boolean));
  for (const it of reg.all('item')) if (parents.has(it.cat)) errors.push(`item '${it.id}': cat '${it.cat}' is a group; use a leaf category`);
  // Recipes: benches are workbenches; add-on recipes are listed by their add-on.
  for (const r of reg.all('recipe')) {
    for (const b of r.bench || []) { const s = reg.get('structure', b); if (s && !s.workbench) errors.push(`recipe '${r.id}': bench '${b}' has no workbench block`); }
    if (r.addon) { const ad = reg.get('addon', r.addon); if (ad && !((ad.adds && ad.adds.recipes) || []).includes(r.id)) errors.push(`recipe '${r.id}': add-on '${r.addon}' does not list it in adds.recipes`); }
    for (const x of r.in || []) if (x && x.mat && x.k) { const it = reg.get('item', x.k), m = reg.get('material', x.mat); if (it && m && !matGroupsOf(it).includes(m.group)) errors.push(`recipe '${r.id}': material '${x.mat}' does not fit item '${x.k}'`); }
  }
  // Structures: furniture has an item and is made somewhere; autoBills run on this bench.
  const made = new Set(reg.all('recipe').flatMap((r) => (r.out || []).map((o) => o.k)));
  for (const s of reg.all('structure')) {
    if (s.kind === 'furniture') {
      const k = s.item || s.id;
      if (!reg.has('item', k)) errors.push(`structure '${s.id}': furniture needs item '${k}' in items.js`);
      else if (!made.has(k)) warnings.push(`structure '${s.id}': no recipe makes item '${k}' yet`);
    }
    for (const b of (s.workbench && s.workbench.autoBills) || []) { const r = reg.get('recipe', b.recipe); if (r && !(r.bench || []).includes(s.id)) errors.push(`structure '${s.id}': autoBill recipe '${b.recipe}' is not made at this bench`); }
    for (const ad of (s.workbench && s.workbench.addons) || []) { const d = reg.get('addon', ad); if (d && !(d.bench || []).includes(s.id)) errors.push(`structure '${s.id}': add-on '${ad}' does not name this bench`); }
  }
  // Stages: a recipe needs a bench of its stage or earlier; furniture needs a recipe by its stage;
  // a bench's default bills run recipes of its stage.
  const stg = (d) => STAGES.indexOf(d.stage || '2');
  for (const r of reg.all('recipe')) {
    const benches = (r.bench || []).map((b) => reg.get('structure', b)).filter(Boolean);
    if (benches.length && !benches.some((b) => stg(b) <= stg(r))) errors.push(`recipe '${r.id}': stage ${r.stage} but no bench is available by then`);
  }
  for (const s of reg.all('structure')) {
    if (s.kind === 'furniture') {
      const k = s.item || s.id;
      const by = reg.all('recipe').filter((r) => (r.out || []).some((o) => o.k === k));
      if (by.length && !by.some((r) => stg(r) <= stg(s) && (r.bench || []).some((b) => { const bd = reg.get('structure', b); return bd && stg(bd) <= stg(s); }))) errors.push(`structure '${s.id}': stage ${s.stage} but nothing can make item '${k}' by then`);
    }
    for (const ab of (s.workbench && s.workbench.autoBills) || []) { const r = reg.get('recipe', ab.recipe); if (r && stg(r) > stg(s)) errors.push(`structure '${s.id}': autoBill recipe '${ab.recipe}' arrives at stage ${r.stage}, after the bench`); }
  }
  for (const sp of reg.all('stamp')) for (const f of sp.furnish || []) { const d = reg.get('structure', f.def); if (d && stg(d) > STAGES.indexOf(sp.stage || '1a')) errors.push(`stamp '${sp.id}': furnishes '${f.def}' (stage ${d.stage}) before the stamp's stage ${sp.stage || '1a'}`); }
  stage2Checks(reg, errors, warnings, stg);
  // Add-ons: benches are workbenches; recipes they add point back at them.
  for (const ad of reg.all('addon')) {
    for (const b of ad.bench || []) { const s = reg.get('structure', b); if (s && !s.workbench) errors.push(`add-on '${ad.id}': bench '${b}' has no workbench block`); }
    for (const rid of (ad.adds && ad.adds.recipes) || []) { const r = reg.get('recipe', rid); if (r && r.addon !== ad.id) errors.push(`add-on '${ad.id}': recipe '${rid}' must have addon '${ad.id}'`); }
  }
  // Traits: exclusive pairs are mutual.
  for (const t of reg.all('trait')) if (t.excl) { const o = reg.get('trait', t.excl); if (o && o.excl !== t.id) errors.push(`trait '${t.id}': excl '${t.excl}' must point back`); }
  // Names tables exist per ancestry.
  for (const n of reg.all('names')) if (!reg.has('ancestry', n.id)) errors.push(`names '${n.id}': no ancestry with this id`);
  for (const a of reg.all('ancestry')) if (reg.all('names').length && !reg.has('names', a.id)) warnings.push(`ancestry '${a.id}': no names table`);
  // Perks sit on their skill's levels (key skills 10 and 20, the others 15).
  const keySkills = new Set(reg.all('skill').filter((sk) => sk.key).map((sk) => sk.id));
  for (const p of reg.all('perk')) if (keySkills.size && (keySkills.has(p.skill) ? p.lvl === 15 : p.lvl !== 15)) errors.push(`perk '${p.id}': ${keySkills.has(p.skill) ? 'key skills give perks at 10 and 20' : 'signature perks come at level 15'}`);
  // Starts: exactly one default.
  const st = reg.all('start');
  if (st.length && st.filter((x) => x.default).length !== 1) errors.push(`start: exactly one start must be default (got ${st.filter((x) => x.default).length})`);
  const tl = reg.all('storyteller');
  if (tl.length && tl.filter((x) => x.default).length !== 1) errors.push('storyteller: exactly one storyteller must be default');
  // Hearth levels in order.
  reg.all('hearthLevel').forEach((h, i) => { if (h.lvl !== i + 1) errors.push(`hearthLevel '${h.id}': lvl must be ${i + 1}`); });
  // Roles: every work type is key work (priority 1) of some role, unless a role covers all work.
  const roles = reg.all('role');
  if (roles.length && !roles.some((r) => r.all)) for (const w of WORK_IDS) if (!roles.some((r) => r.prio && r.prio[w] === 1)) warnings.push(`role: no role has work type '${w}' at priority 1`);
  // Every kind a command validator names has content.
  for (const [ck, rk] of Object.entries(COMMAND_KINDS)) if (!reg.all(rk).length) warnings.push(`command kind '${ck}' (${rk}) has no content yet`);
}

/**
 * Stage 2 content checks (14.8 row G): tiers and techs line up, the Hearth's upgrade costs are the
 * Hearth levels', every cost and ingredient can be had by the stage that asks for it, benches make
 * something, installable items have a place to go.
 */
function stage2Checks(reg, errors, warnings, stg) {
  const tierIx = (id) => { const t = reg.get('tier', id); return t ? t.i : -1; };
  const eraTier = (techId) => { const t = reg.get('tech', techId); const e = t && reg.get('era', t.era); return e ? tierIx(e.tier) : -1; };
  for (const s of reg.all('structure')) {
    // Z2.9 (F27): a structure's rank is a `band` label; a `tier` gate is kept only on a row flagged `arrival`.
    if (s.tier && !(s.flags || []).includes('arrival')) errors.push(`structure '${s.id}': a tier gate needs the 'arrival' flag (F27); use band`);
    const band = s.band || s.tier;
    if (!band) errors.push(`structure '${s.id}': needs a band`);
    else if (s.tech && eraTier(s.tech) > tierIx(band)) errors.push(`structure '${s.id}': band ${band} but its tech '${s.tech}' opens at a later tier`);
    for (const [i, l] of (s.levels || []).entries()) if (l.tech && l.tier && eraTier(l.tech) > tierIx(l.tier)) errors.push(`structure '${s.id}' levels[${i}]: tech '${l.tech}' opens after tier ${l.tier}`);
    const wb = s.workbench;
    if (wb && !wb.workplace && !reg.all('recipe').some((r) => (r.bench || []).includes(s.id))) warnings.push(`structure '${s.id}': a workbench with no recipe (mark it workplace if it has none)`);
  }
  // The Hearth's levels (the structure def's upgrade path, E) are the hearthLevel table (K): same costs.
  const hearth = reg.all('structure').find((s) => (s.flags || []).includes('start'));
  const hl = reg.all('hearthLevel');
  if (hearth && hl.length) {
    const lv = hearth.levels || [];
    if (lv.length !== hl.length - 1) errors.push(`structure '${hearth.id}': levels must list Hearth levels 2..${hl.length} (got ${lv.length})`);
    lv.forEach((l, i) => { const h = hl[i + 1]; if (h && JSON.stringify(l.cost) !== JSON.stringify(h.cost || {})) errors.push(`structure '${hearth.id}' levels[${i}]: cost differs from hearthLevel '${h.id}'`); });
  }
  // Obtainable items: raw goods (the Raw tree, raw food, gems, corpses, coins) or the product of a recipe
  // of that stage or earlier at a bench of that stage or earlier.
  const parentOf = new Map(reg.all('itemCat').map((c) => [c.id, c.parent || null]));
  const under = (cat, root) => { for (let c = cat; c; c = parentOf.get(c)) if (c === root) return true; return false; };
  const raw = (it) => under(it.cat, 'raw') || (it.food && it.food.kind === 'raw') || it.cat === 'gems' || it.cat === 'corpses' || it.cat === 'coins';
  const madeBy = new Map();
  for (const r of reg.all('recipe')) {
    const bs = (r.bench || []).map((b) => reg.get('structure', b)).filter(Boolean);
    const at = Math.max(stg(r), bs.length ? Math.min(...bs.map(stg)) : 0);
    for (const o of r.out || []) if (!madeBy.has(o.k) || madeBy.get(o.k) > at) madeBy.set(o.k, at);
  }
  const by = (k) => { const it = reg.get('item', k); if (!it) return 99; return raw(it) ? 0 : madeBy.has(k) ? madeBy.get(k) : 99; };
  const need = (k, at, who) => { if (by(k) > at) warnings.push(`${who}: needs '${k}', which nothing makes by stage ${STAGES[at] || at}`); };
  for (const s of reg.all('structure')) {
    for (const k of Object.keys(s.cost || {})) need(k.split(':')[0], stg(s), `structure '${s.id}'`);
    for (const [i, l] of (s.levels || []).entries()) for (const k of Object.keys(l.cost || {})) need(k.split(':')[0], Math.max(stg(s), 2), `structure '${s.id}' levels[${i}]`);
  }
  for (const r of reg.all('recipe')) for (const x of r.in || []) {
    if (x.k) need(x.k, stg(r), `recipe '${r.id}'`);
    else if (x.cat && !reg.all('item').some((it) => it.cat === x.cat && by(it.id) <= stg(r))) warnings.push(`recipe '${r.id}': no '${x.cat}' item can be had by stage ${r.stage}`);
  }
  // Installable items go somewhere: a furniture structure installs them.
  const installs = new Set(reg.all('structure').filter((s) => s.kind === 'furniture').map((s) => s.item || s.id));
  for (const it of reg.all('item')) if ((it.tags || []).includes('installable') && !installs.has(it.id)) warnings.push(`item '${it.id}': installable, but no furniture structure installs it`);
  // Deeds that name a tier name a real one.
  for (const d of reg.all('deed')) if (d.goal && d.goal.event === 'tierUp' && d.goal.k && !reg.has('tier', d.goal.k)) errors.push(`deed '${d.id}': goal.k '${d.goal.k}' is not a tier`);
}

/** Placeholder names used by a text template (for UI fill-in). */
export function placeholders(t) { return [...String(t).matchAll(PLACEHOLDER_RE)].map((m) => m[1]); }
