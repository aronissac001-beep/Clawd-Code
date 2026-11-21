// Workshop add-ons (EMBERCROWN-FORTRESS.md 3.7, F12; step Z2.4; owner G, logic E in js/game/work/addons.js).
// Replaces the workshop specialisations (Stage 2.9): a bench is never asked to pick one. An add-on
// either is a structure built on a tile next to its bench (`form: 'structure'`; while it stands, the
// bench gains its verbs) or is a master set (`form: 'master'`; open while the hold has a Master of the
// bench's skill). A bench may have any number of add-ons; there is no exclusivity and no re-tooling.
// Every add-on adds a verb (recipes, toils, structures or rules); `also` is the one-line number.
// Recipes it adds carry addon: <this id>.
//
// AUDIT (the first deliverable of Z2.4): every one of the 36 R2 8.2 specialisations against one test,
// "does it add a verb" (a recipe chain, a job kind, a room role, a mechanism)? Each row: { spec, bench (R2
// workshop), verdict: 'addon' | 'dropped', addon (the add-on id that carries it, for 'addon'), verb (the verb it
// adds, for 'addon'), why (for 'dropped': what it only changed, and where its content went) }.
// 14 of 36 survive (as 15 add-ons: the Weaponsmith is a structure and a master set); 22 are dropped. The ember
// forge is a 16th add-on with no old specialisation.
//
// VERB_OF: add-on id -> the verb it adds (one per DATA row, so every add-on row names its verb; the
// schema field `verb` is a G request: once schema.js has it, these move onto the rows).
// EMBER_FORGE: the ember forge (3.7) is an add-on structure of the forge, bloomery and blast furnace that must
// stand beside an ember pool (on the ember layer). It needs no fuel and rolls quality once more.
// STRUCTURES: the add-on structure rows (and the winch, 2.3) staged for js/data/structures/*.js (Z2.9's
// files): G adds them there verbatim; tests build a registry with them meanwhile. An add-on structure's id is
// the add-on's id.
export const DATA = {
  addon: [
    // ---- Mason ----
    { id: 'cutting_yard', name: 'Cutting yard', bench: ['mason'], form: 'structure', adds: { recipes: ['ashlar_blocks'], rules: ['cutInPlace'] },
      text: 'Cut in place: stone piles within 6 tiles of the bench are cut where they lie.', also: '12 blocks per rough stone' },
    // ---- Carpenter ----
    { id: 'matched_sets', name: 'Matched sets', bench: ['carpenter'], form: 'master', adds: { rules: ['matchedSet'] },
      text: 'One bill makes a whole bedroom or dining set, and a full set is well appointed.' },
    { id: 'cask_cellar', name: 'Cask cellar', bench: ['carpenter', 'cask'], form: 'structure', adds: { rules: ['cellarAgeing'] },
      text: 'A cellar of racked casks: the Cellar room role, where ale ages into aged ale and meat into salted meat.' },
    // ---- Forge ----
    { id: 'quench_trough', name: 'Quench trough', bench: ['forge'], form: 'structure', adds: { rules: ['temper'] },
      text: 'Temper: a smith may re-roll a weapon\'s quality once.', also: 'weapons +1 quality a quarter of the time' },
    // ---- Bloomery and blast furnace ----
    { id: 'slag_pit', name: 'Slag pit', bench: ['bloomery', 'blastfurnace'], form: 'structure', adds: { recipes: ['melt_weapons', 'melt_armour'], rules: ['meltDown'] },
      text: 'Melt down: scrap weapons, armour and raider gear go back to ingots of their metal.' },
    { id: 'alloy_crucible', name: 'Alloy crucible', bench: ['bloomery', 'blastfurnace'], form: 'structure', adds: { recipes: ['make_electrum'] },
      text: 'New alloys: electrum of silver and gold (lumensteel when lumenite is found).' },
    { id: 'ember_forge', name: 'Ember forge', bench: ['forge', 'bloomery', 'blastfurnace'], form: 'structure', adds: { recipes: ['make_embersteel'] },
      text: 'Built beside an ember pool: the bench needs no fuel, rolls quality once more, and is the only place to make embersteel.' },
    // ---- Stove, brewery ----
    { id: 'feast_hall', name: 'Feast hall kitchen', bench: ['stove'], form: 'master', adds: { rules: ['feastDay'] },
      text: 'While the hold has a Master cook: schedule a feast day in a dining hall (everyone attends and talks).' },
    { id: 'tap_stand', name: 'Tap stand', bench: ['brewery'], form: 'structure', adds: { rules: ['tavernService'] },
      text: 'Tavern service: a barkeep serves drinks in the tavern.' },
    // ---- Tannery, loom, apothecary ----
    { id: 'herbalist', name: 'Herbalist\'s set', bench: ['apothecary'], form: 'master', adds: { recipes: ['brew_calming_tea'], rules: ['calmingTea'] },
      text: 'While the hold has a Master healer: calming tea, handed to a sulking or binging colonist, ends a minor break.' },
    // ---- Potter and kiln ----
    { id: 'glazing_kiln', name: 'Glazing kiln', bench: ['potter', 'kiln'], form: 'structure', adds: { recipes: ['make_burial_urn'] },
      text: 'Glazed ware: burial urns, a crypt slot without a sarcophagus.' },
    { id: 'vault_kiln', name: 'Vault kiln', bench: ['kiln'], form: 'structure', adds: { recipes: ['fire_keystones'] },
      text: 'Keystone bricks: a brick vault, a built vaulted roof that holds up a wider room.' },
  ],
};

// Add-on rows STAGED with their recipes (js/data/recipes.js STAGED; their gear is in traded categories): G moves
// them into DATA.addon at the Z2 switch. They count as add-ons everywhere else (VERB_OF, the audit, the logic).
export const STAGED = {
  addon: [
    { id: 'war_smith', name: 'Weaponsmith\'s set', bench: ['forge'], form: 'master', adds: { recipes: ['forge_warpick', 'forge_glaive'] },
      text: 'While the hold has a Master smith: the war pick and the glaive.' },
    { id: 'armourer_stand', name: 'Armourer\'s stand', bench: ['forge'], form: 'structure', adds: { recipes: ['forge_brigandine', 'forge_emberward', 'forge_emberhood'], rules: ['refit'] },
      text: 'Refit: captured raider armour is repaired and resized, so raids feed the armoury. Brigandine, and ember-proof gear of shell and ember salts.' },
    { id: 'hardening_vat', name: 'Hardening vat', bench: ['tannery'], form: 'structure', adds: { recipes: ['harden_lamellar', 'shell_lamellar'] },
      text: 'Hardened leather: lamellar of leather, or of shellback shell from the deep.' },
    { id: 'silk_frame', name: 'Silk frame', bench: ['loom'], form: 'structure', adds: { recipes: ['weave_silk'] },
      text: 'Tamed cave spiders spin silk on the frame; the loom weaves it into spidersilk.' },
  ],
};
/** Every add-on row, live and staged (the logic and the audit read this). */
export const ALL_ADDONS = Object.freeze([...DATA.addon, ...STAGED.addon]);

/** The verb each add-on adds (3.7: every add-on row names its verb). */
export const VERB_OF = Object.freeze({
  cutting_yard: 'cut in place', matched_sets: 'matched sets', cask_cellar: 'the Cellar room role', quench_trough: 'temper',
  war_smith: 'the war pick and glaive', armourer_stand: 'refit', slag_pit: 'melt down', alloy_crucible: 'alloying',
  ember_forge: 'embersteel', feast_hall: 'feast day', tap_stand: 'tavern service', hardening_vat: 'hardened lamellar',
  silk_frame: 'silk spinning', herbalist: 'calming tea', glazing_kiln: 'burial urns', vault_kiln: 'the brick vault',
});

/** The audit of the 36 R2 8.2 specialisations (3.7). */
export const AUDIT = Object.freeze([
  { spec: 'Weaponsmith', bench: 'forge', verdict: 'addon', addon: 'quench_trough', also: 'war_smith', verb: 'temper; the war pick and glaive (master set)' },
  { spec: 'Armourer', bench: 'forge', verdict: 'addon', addon: 'armourer_stand', verb: 'refit; brigandine; ember-proof gear' },
  { spec: 'Toolsmith', bench: 'forge', verdict: 'dropped', why: 'tool quality is a number; the ability tools\' verbs are perks now (Cave Sense, Field Surgeon), and the surgeon\'s kit is a base forge recipe' },
  { spec: 'Smeltery', bench: 'bloomery', verdict: 'addon', addon: 'slag_pit', verb: 'melt down' },
  { spec: 'Alloyer', bench: 'bloomery', verdict: 'addon', addon: 'alloy_crucible', verb: 'electrum, later lumensteel' },
  { spec: 'Joiner', bench: 'carpenter', verdict: 'addon', addon: 'matched_sets', verb: 'matched sets' },
  { spec: 'Cooper', bench: 'carpenter', verdict: 'addon', addon: 'cask_cellar', verb: 'the Cellar room role' },
  { spec: 'Wheelwright', bench: 'carpenter', verdict: 'dropped', why: 'carts only raise carry; vertical hauling is the winch (2.3), and mine carts are the Z4 track' },
  { spec: 'Bowyer', bench: 'fletcher', verdict: 'dropped', why: 'the composite bow only adds range and quality (numbers)' },
  { spec: 'Bolt-maker', bench: 'fletcher', verdict: 'dropped', why: 'the hold has no ammunition stock to draw from; bolts come with Z3 siege work' },
  { spec: 'Stonecutter', bench: 'mason', verdict: 'addon', addon: 'cutting_yard', verb: 'cut in place' },
  { spec: 'Monument mason', bench: 'mason', verdict: 'dropped', why: 'memorials and slabs are burial (3.6); great works are prestige buildings (3.11); statues stay at the sculptor' },
  { spec: 'Feast hall kitchen', bench: 'stove', verdict: 'addon', addon: 'feast_hall', verb: 'feast day' },
  { spec: 'Field kitchen', bench: 'stove', verdict: 'dropped', why: 'rations are a base recipe; eating on site is a speed number' },
  { spec: 'Alehouse', bench: 'brewery', verdict: 'addon', addon: 'tap_stand', verb: 'tavern service' },
  { spec: 'Meadery', bench: 'brewery', verdict: 'dropped', why: 'trade and Dread numbers; the deep drink is glowcap spirit at the base brewery' },
  { spec: 'Leatherworks', bench: 'tannery', verdict: 'addon', addon: 'hardening_vat', verb: 'hardened lamellar' },
  { spec: 'Furrier', bench: 'tannery', verdict: 'dropped', why: 'winter kit is a cold number; the fur mantle is a base recipe' },
  { spec: 'Weaver', bench: 'loom', verdict: 'dropped', why: 'cloth yield and beauty numbers; banners are a base tailor recipe' },
  { spec: 'Silkhouse', bench: 'loom', verdict: 'addon', addon: 'silk_frame', verb: 'silk spinning' },
  { spec: 'Outfitter', bench: 'tailor', verdict: 'dropped', why: 'outfits already dress a colonist for a role (E\'s outfits)' },
  { spec: 'Arming tailor', bench: 'tailor', verdict: 'dropped', why: 'padded armour duplicates the base gambeson' },
  { spec: 'Herbalist', bench: 'apothecary', verdict: 'addon', addon: 'herbalist', verb: 'calming tea' },
  { spec: 'Ember-alchemist', bench: 'apothecary', verdict: 'dropped', why: 'fire oil is only a fuel; the apothecary\'s new chain is lye and soap' },
  { spec: 'Gemcutter', bench: 'jeweller', verdict: 'dropped', why: 'every inlay effect is a percentage (burn, chill, heal)' },
  { spec: 'Goldsmith', bench: 'jeweller', verdict: 'dropped', why: 'titles are offices now (3.4); the rest is a trade number' },
  { spec: 'Lampmaker', bench: 'glassworks', verdict: 'dropped', why: 'lanterns are a base glassworks recipe; the light mirror waits for light through walls (Z4)' },
  { spec: 'Lens-grinder', bench: 'glassworks', verdict: 'dropped', why: 'lenses are a base glassworks recipe; the survey radius is a number' },
  { spec: 'Fine ware', bench: 'potter', verdict: 'addon', addon: 'glazing_kiln', verb: 'burial urns (storage urns are a base potter recipe)' },
  { spec: 'Brickworks', bench: 'kiln', verdict: 'addon', addon: 'vault_kiln', verb: 'the brick vault' },
  { spec: 'Archive', bench: 'scriptorium', verdict: 'dropped', why: 'the Annals are the hold\'s chronicle (3.5); research +20% is a number' },
  { spec: 'Copy-house', bench: 'scriptorium', verdict: 'dropped', why: 'teaching by a Master (3.1) is how skills pass on; primers would bypass growth by doing' },
  { spec: 'Shield drill', bench: 'trainingyard', verdict: 'dropped', why: 'the training yard is a work spot, not a bench: drilling is the Military tab\'s training schedule and the Drilled squad (3.8, Z2.5)' },
  { spec: 'Archery butts', bench: 'trainingyard', verdict: 'dropped', why: 'archery training is the Military schedule (3.8); the XP number goes' },
  { spec: 'Curing house', bench: 'smokehouse', verdict: 'dropped', why: 'shelf life numbers; trail rations are a base recipe' },
  { spec: 'Smoke kitchen', bench: 'smokehouse', verdict: 'dropped', why: 'counting smoked food as fine meals is a category change, not a verb' },
]);

/** Add-ons that must stand beside an ember pool (an ember voxel on its level, 4-adjacent to the add-on). */
export const EMBER_FORGE = Object.freeze({ id: 'ember_forge', needs: 'emberPool', noFuel: true, qualityRolls: 1 });
/** Worn items that make their wearer ignore Sweltering and ember splash (F's heat, H's ember splash). */
export const EMBERPROOF = Object.freeze(['emberward', 'emberhood']);
/** The soap rule (3.7 lye and soap): an infirmary holding soap gets cleanliness x1.5 (F's health reads it). */
export const SOAP = Object.freeze({ k: 'soap', cleanPct: 150 });

// ---- Staged structure rows (G: add to js/data/structures/workshops.js, utility.js; Z2.9 owns those files) ----
const ADDON_ART = 'hammer';
const addonRow = (id, name, cost, work, tech, extra = {}) => ({ id, name, cat: 'workshops', kind: 'construct', size: [1, 1], cost, work, hp: 200,
  tech, tier: 'camp', art: ADDON_ART, stage: '3', text: 'An add-on: build it on a tile beside its bench.', ...extra });
export const STRUCTURES = Object.freeze([
  addonRow('cutting_yard', 'Cutting yard', { wood: 30, block: 10 }, 80, 'masonry'),
  addonRow('cask_cellar', 'Cask cellar', { wood: 60, ironbands: 2 }, 120, 'brewing'),
  addonRow('quench_trough', 'Quench trough', { block: 20 }, 80, 'smithing'),
  addonRow('armourer_stand', 'Armourer\'s stand', { wood: 20, ingot: 10 }, 100, 'smithing'),
  addonRow('slag_pit', 'Slag pit', { block: 30 }, 90, 'bloomery'),
  addonRow('alloy_crucible', 'Alloy crucible', { block: 20, ingot: 6 }, 100, 'smelting'),
  addonRow('ember_forge', 'Ember forge', { block: 40, ingot: 20 }, 300, 'steel', { size: [2, 1], needs: ['underground'], hp: 400,
    text: 'Built beside an ember pool on the ember layer: the bench beside it needs no fuel, rolls quality once more and makes embersteel.' }),
  addonRow('tap_stand', 'Tap stand', { wood: 30 }, 60, 'brewing'),
  addonRow('hardening_vat', 'Hardening vat', { wood: 30, block: 10 }, 80, 'tanning'),
  addonRow('silk_frame', 'Silk frame', { wood: 40 }, 80, 'weaving', { needs: ['underground'] }),
  addonRow('glazing_kiln', 'Glazing kiln', { brick: 30 }, 100, 'pottery'),
  addonRow('vault_kiln', 'Vault kiln', { brick: 40 }, 120, 'pottery'),
  // The winch and shaft (2.3; js/game/colony/verbs/winch.js): a hatch over an open-air column; stacks put on it
  // ride to the shaft's foot (and stacks put at the foot ride up), 2 s a level, up to 3 stacks a trip.
  { id: 'winch', name: 'Winch and shaft', cat: 'utility', kind: 'construct', size: [1, 1], cost: { wood: 40, ironbands: 2 }, work: 120, hp: 250,
    tech: 'supports', tier: 'camp', art: 'wheel', stage: '3', text: 'Build it over a shaft: stacks left on it ride to the foot, and stacks left at the foot ride up.' },
]);
