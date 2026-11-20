// Content registry (owner G; contract C11). Imports every colony data file statically (no build
// step; the service worker caches them) and builds the registry once. core/content.js (A) installs
// it: setContentLookup(commandLookup(CONTENT)), setItemDefs(itemDefLookup(CONTENT)),
// setWorkBalance(balanceOf(CONTENT, 'work')). Pure: building the registry has no side effects.
// The import list must match DATA_FILES in schema.js (validate-data checks it).

import { DATA_FILES, buildRegistry, validate } from './schema.js';
import * as m_balance from './balance.js';
import * as m_worldgen from './worldgen.js';
import * as m_materials from './materials.js';
import * as m_items from './items.js';
import * as m_quality from './quality.js';
import * as m_plants from './plants.js';
import * as m_animals from './animals.js';
import * as m_recipes from './recipes.js';
import * as m_structures_housing from './structures/housing.js';
import * as m_structures_walls from './structures/walls.js';
import * as m_structures_storage from './structures/storage.js';
import * as m_structures_farming from './structures/farming.js';
import * as m_structures_workshops from './structures/workshops.js';
import * as m_structures_defence from './structures/defence.js';
import * as m_structures_utility from './structures/utility.js';
import * as m_structures_civic from './structures/civic.js';
import * as m_structures_prestige from './structures/prestige.js';
import * as m_rooms from './rooms.js';
import * as m_research from './research.js';
import * as m_tiers from './tiers.js';
import * as m_renown from './renown.js';
import * as m_addons from './addons.js';
import * as m_professions from './professions.js';
import * as m_perks from './perks.js';
import * as m_roles from './roles.js';
import * as m_advice from './advice.js';
import * as m_embertouch from './embertouch.js';
import * as m_skills from './skills.js';
import * as m_traits from './traits.js';
import * as m_needs from './needs.js';
import * as m_thoughts from './thoughts.js';
import * as m_breaks from './breaks.js';
import * as m_worktypes from './worktypes.js';
import * as m_ancestries from './ancestries.js';
import * as m_names from './names.js';
import * as m_backstories from './backstories.js';
import * as m_starts from './starts.js';
import * as m_storytellers from './storytellers.js';
import * as m_incidents from './incidents.js';
import * as m_raiders from './raiders.js';
import * as m_factions from './factions.js';
import * as m_traders from './traders.js';
import * as m_deeds from './deeds.js';
import * as m_text_letters from './text/letters.js';
import * as m_text_thoughts from './text/thoughts.js';
import * as m_text_chronicle from './text/chronicle.js';
import * as m_text_nemesis from './text/nemesis.js';
import * as m_text_artifacts from './text/artifacts.js';
import * as m_text_help from './text/help.js';
import * as m_text_incidents from './text/incidents.js';

/** path -> module namespace, for every non-reuse DATA_FILES entry. */
export const MODULES = Object.freeze({
  'balance.js': m_balance,
  'worldgen.js': m_worldgen,
  'materials.js': m_materials,
  'items.js': m_items,
  'quality.js': m_quality,
  'plants.js': m_plants,
  'animals.js': m_animals,
  'recipes.js': m_recipes,
  'structures/housing.js': m_structures_housing,
  'structures/walls.js': m_structures_walls,
  'structures/storage.js': m_structures_storage,
  'structures/farming.js': m_structures_farming,
  'structures/workshops.js': m_structures_workshops,
  'structures/defence.js': m_structures_defence,
  'structures/utility.js': m_structures_utility,
  'structures/civic.js': m_structures_civic,
  'structures/prestige.js': m_structures_prestige,
  'rooms.js': m_rooms,
  'research.js': m_research,
  'tiers.js': m_tiers,
  'renown.js': m_renown,
  'addons.js': m_addons,
  'professions.js': m_professions,
  'perks.js': m_perks,
  'roles.js': m_roles,
  'advice.js': m_advice,
  'embertouch.js': m_embertouch,
  'skills.js': m_skills,
  'traits.js': m_traits,
  'needs.js': m_needs,
  'thoughts.js': m_thoughts,
  'breaks.js': m_breaks,
  'worktypes.js': m_worktypes,
  'ancestries.js': m_ancestries,
  'names.js': m_names,
  'backstories.js': m_backstories,
  'starts.js': m_starts,
  'storytellers.js': m_storytellers,
  'incidents.js': m_incidents,
  'raiders.js': m_raiders,
  'factions.js': m_factions,
  'traders.js': m_traders,
  'deeds.js': m_deeds,
  'text/letters.js': m_text_letters,
  'text/thoughts.js': m_text_thoughts,
  'text/chronicle.js': m_text_chronicle,
  'text/nemesis.js': m_text_nemesis,
  'text/artifacts.js': m_text_artifacts,
  'text/help.js': m_text_help,
  'text/incidents.js': m_text_incidents,
});

/** Manifest entries with their modules, in DATA_FILES order. */
export const ENTRIES = Object.freeze(DATA_FILES.map((e) => ({ ...e, mod: e.reuse ? null : MODULES[e.path] || null })));
/** The content registry: has(kind, id), get(kind, id), all(kind), srcOf, kinds, errors. */
export const CONTENT = buildRegistry(ENTRIES);
/** Full schema and reference validation (debug builds and tools; not run at import). */
export const validateContent = () => validate(CONTENT, ENTRIES);
