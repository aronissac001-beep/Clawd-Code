// The Annals' grammar (owner K; EMBERCROWN-FORTRESS.md 3.5). Player-facing text for the vale's pre-history
// and the hold's legend records, kept out of logic for tone editing and translation (R2 13.4). No emoji;
// every name here is original.
//
// DATA.text holds the line templates ({name} placeholders listed in vars). TABLES holds the word tables the
// grammar draws from. The tables are APPEND-ONLY: the pre-history picks words by index from the seed, and a
// legend record stores a name as an index (room names, event types), so reordering a table renames history.
//
// Owner decision 4: the pre-history never mentions the owner's earlier holds. Nothing here may name a hold,
// a Hearth or a colony: the pre-history is the Old Crown's, the beasts' and the factions'.

export const DATA = {
  text: [
    // ---- the pre-history (3.5) ----
    { id: 'leg_crown_rise', text: '{king} raised the Old Crown over the vale and set the first stone of {seat}.', vars: ['king', 'seat'] },
    { id: 'leg_king_crowned', text: '{king} took the Old Crown.', vars: ['king'] },
    { id: 'leg_king_died', text: '{king} died {how}.', vars: ['king', 'how'] },
    { id: 'leg_smith_forged', text: '{smith} forged {thing} for {king}.', vars: ['smith', 'thing', 'king'] },
    { id: 'leg_smith_died', text: '{smith}, master of the Crown forges, was laid under {seat}.', vars: ['smith', 'seat'] },
    { id: 'leg_vault_made', text: '{king} had {vault} cut into {band} and sealed with marble. {keeper} kept its tablets.', vars: ['king', 'vault', 'band', 'keeper'] },
    { id: 'leg_vault_lost', text: '{vault} was lost {how}. {keeper} was the last to see it open.', vars: ['vault', 'how', 'keeper'] },
    { id: 'leg_tower_built', text: '{builder} raised a watchtower on the valley floor to watch the river road.', vars: ['builder'] },
    { id: 'leg_crypt_laid', text: '{dead} was laid in the crypt beneath the watchtower of {builder}.', vars: ['dead', 'builder'] },
    { id: 'leg_tower_fell', text: 'The watchtower of {builder} fell {how}.', vars: ['builder', 'how'] },
    { id: 'leg_faction_rise', text: '{founder} founded the {faction}.', vars: ['founder', 'faction'] },
    { id: 'leg_beast_deed', text: '{beast} {deed} in {band}.', vars: ['beast', 'deed', 'band'] },
    { id: 'leg_beast_sleep', text: '{beast} went down into {band} and was not seen again.', vars: ['beast', 'band'] },
    { id: 'leg_wyrm_burn', text: 'The Gloomwyrm burned the river town of {town}.', vars: ['town'] },
    { id: 'leg_wyrm_eyrie', text: 'The Gloomwyrm made its eyrie on the highest crag of the vale.', vars: [] },
    { id: 'leg_colossus_rise', text: 'The Bone Colossus rose from the deep stone and broke the halls of {seat}.', vars: ['seat'] },
    { id: 'leg_colossus_sleep', text: 'The Bone Colossus sank back below the Sunless Mere.', vars: [] },
    { id: 'leg_hollow_wake', text: 'The Hollow King woke under the vale, and the dark spread through the lower halls.', vars: [] },
    { id: 'leg_hollow_seal', text: '{king} and {smith} sealed the Hollow King under the vale with the Seal-stone.', vars: ['king', 'smith'] },
    { id: 'leg_crown_fall', text: 'The Old Crown fell. {king} was the last to wear it, and {seat} was left to the dark.', vars: ['king', 'seat'] },
    { id: 'leg_omen', text: '{omen}', vars: ['omen'] },
    // ---- the hold's legend records (3.5) ----
    { id: 'leg_ev_founded', text: 'The hold was founded.', vars: [] },
    { id: 'leg_ev_raid', text: 'A raid was thrown back.', vars: [] },
    { id: 'leg_ev_siege', text: 'A siege was broken.', vars: [] },
    { id: 'leg_ev_collapse', text: 'A ceiling came down.', vars: [] },
    { id: 'leg_ev_flood', text: 'Water broke into the halls.', vars: [] },
    { id: 'leg_ev_death', text: '{a} died.', vars: ['a'] },
    { id: 'leg_ev_office', text: '{a} took an office.', vars: ['a'] },
    { id: 'leg_ev_prestige', text: 'A great work was finished.', vars: [] },
    { id: 'leg_ev_birth', text: '{a} was born.', vars: ['a'] },
    { id: 'leg_ev_petition', text: '{a} asked to stay, and stayed.', vars: ['a'] },
    { id: 'leg_ev_tier', text: 'The hold grew in rank.', vars: [] },
    { id: 'leg_ev_artifact', text: '{a} made {b}.', vars: ['a', 'b'] },
    { id: 'leg_ev_slain', text: '{a} was slain.', vars: ['a'] },
    { id: 'leg_ev_level', text: 'A new level was opened: {b}.', vars: ['b'] },
    { id: 'leg_ev_beast', text: '{a} came out of the deep.', vars: ['a'] },
    { id: 'leg_ev_crime', text: 'A crime was done in the hold.', vars: [] },
    { id: 'leg_ev_sentence', text: 'The Warden of Law gave a sentence.', vars: [] },
    { id: 'leg_ev_arrived', text: '{a} came to the hold.', vars: ['a'] },
    { id: 'leg_ev_renown', text: '{b}', vars: ['b'] },
  ],
};

export const TABLES = Object.freeze({
  // personal names of the Old Crown (first syllable + ending)
  crownA: ['Ar', 'Bel', 'Cor', 'Dun', 'Eld', 'Fen', 'Gar', 'Hal', 'Ith', 'Kor', 'Lor', 'Mor', 'Nar', 'Os', 'Per', 'Rath', 'Sev', 'Tor', 'Ul', 'Var', 'Wen', 'Yr', 'Bram', 'Cael'],
  crownB: ['ac', 'ain', 'aric', 'en', 'eth', 'ic', 'id', 'or', 'orn', 'um', 'ust', 'wyn', 'ard', 'ald', 'ion', 'os', 'red', 'ith'],
  kingTitle: ['King', 'Queen'],
  kingEpithet: ['the Bold', 'the Lamplit', 'Ironhand', 'the Mason', 'the Unbent', 'Greycloak', 'the Quiet', 'Stonebrow', 'the Young', 'the Far-seeing', 'Coldhearth', 'the Builder', 'the Patient', 'Ashbeard'],
  smithTitle: ['Master Smith', 'Forge-mistress', 'Forge-master', 'Runesmith'],
  // the dead of the crypts and the keepers of the vaults
  folkTitle: ['Captain', 'Warden', 'Keeper', 'Lamplighter', 'Archivist', 'Sergeant', 'Tollmaster', 'Reeve'],
  // faction founders
  founderTitle: ['Bargemaster', 'Knight-captain', 'the cutpurse', 'Warlord', 'the wanderer'],
  // Crown seats and places of old
  seatA: ['Ember', 'Ash', 'High', 'Grey', 'Lamp', 'Stone', 'Deep', 'Iron', 'Dusk', 'Silver'],
  seatB: ['crown', 'hall', 'keep', 'gate', 'spire', 'forge', 'deep', 'wold'],
  towns: ['Hallow Ford', 'Reedwick', 'Cinder Mill', 'Tallow Bridge', 'Ashby Weir', 'Low Lantern', 'Gorse End', 'Marrowbank'],
  vaultAdj: ['Marble', 'Silent', 'Kingly', 'Ninth', 'Lantern', 'Sealed', 'Golden', 'Hollow', 'Last', 'Weeping', 'Crowned', 'Deep'],
  vaultNoun: ['Vault', 'Treasury', 'Archive', 'Strongroom', 'Reliquary', 'Undercroft'],
  // artifacts of the Old Crown
  thingA: ['the Ember Circlet', 'the Lamp of', 'the Hammer of', 'the Shield of', 'the Torc of', 'the Horn of', 'the Key of', 'the Blade of'],
  thingB: ['the Vale', 'the Deep Road', 'Seven Gates', 'the First Fire', 'the Long Watch', 'the Sunless Mere', 'Grey Mornings', 'the Crown'],
  kingDied: ['asleep in the high hall', 'of a winter fever', 'in a fall in the deep halls', 'at the head of the watch', 'of great age', 'under a cave-in', 'of grief', 'on the river road'],
  vaultLost: ['when the Crown fell', 'in a great collapse', 'to the Hollow\'s dark', 'when its keepers fled', 'to the water', 'and its doors forgotten'],
  towerFell: ['in a storm', 'to the Ashfang reavers', 'when the river took its footings', 'in a long winter, unmanned'],
  omens: [
    'A red star hung over the vale for a season.',
    'The river froze to the stone and the mills stood still.',
    'A hard winter killed half the herds of the valley.',
    'The mines of the Crown struck a vein of silver that ran for a mile.',
    'A great flood carried off the lower bridges.',
    'The bells of the Crown rang by themselves on a still night.',
    'A plague of grey moths ate the harvest.',
    'Traders from beyond the passes brought glass and pepper for the first time.',
    'The deep halls shook for three days and then were still.',
    'The lamps of the lower roads would not stay lit.',
    'A comet split in two over the heights.',
    'The Crown\'s masons laid the great river road.',
    'Wolves came down from the heights in a hard spring.',
    'A dry summer laid bare the old stones of the river bed.',
    'The Crown\'s scholars wrote the Book of Seams.',
    'A fire in the granaries brought a lean year.',
  ],
  // great beasts (3.12): a name from two syllables, an epithet from the material and the body plan.
  // body and material ORDER matches js/data/beasts.js (G, Z3): serpent, many-legged, winged, great toad,
  // blob, giant, crab, eel / stone, ash, glass, bone, ember, fungus, salt, tar.
  beastA: ['Oz', 'Ghr', 'Vul', 'Skar', 'Mor', 'Xa', 'Thul', 'Kra', 'Nyx', 'Gor', 'Zhe', 'Ur', 'Bal', 'Dro'],
  beastB: ['rak', 'gath', 'mok', 'ul', 'eth', 'ash', 'oth', 'yx', 'im', 'dra', 'gul', 'esh'],
  beastBody: ['Serpent', 'Crawler', 'Wing', 'Toad', 'Ooze', 'Giant', 'Crab', 'Eel'],
  beastBodyId: ['serpent', 'manylegged', 'winged', 'toad', 'blob', 'giant', 'crab', 'eel'],
  beastMat: ['Stone', 'Ash', 'Glass', 'Bone', 'Ember', 'Mould', 'Salt', 'Tar'],
  beastMatId: ['stone', 'ash', 'glass', 'bone', 'ember', 'fungus', 'salt', 'tar'],
  beastDeeds: [
    'drowned the Crown\'s lake-diggers',
    'devoured a company of the watch',
    'broke the deep road of the Crown',
    'carried off the silver of a mine',
    'burned the lamp-halls',
    'poisoned the springs',
    'slew the miners of a lower seam',
    'drove the Crown\'s masons from their work',
  ],
  // room names (3.5): "the Hall of Ashen Light" = hall + adjective + noun (an index triple in the record)
  roomHall: ['Hall', 'Chamber', 'Gallery', 'Court', 'Vault', 'Room', 'Halls', 'Bower'],
  roomAdj: ['Ashen', 'Golden', 'Quiet', 'Deep', 'Ember', 'Silver', 'Bright', 'Long', 'Iron', 'Glowing', 'Grey', 'High', 'Warm', 'Starlit', 'Marble', 'Patient'],
  roomNoun: ['Light', 'Stone', 'Fires', 'Song', 'Lamps', 'Hours', 'Kings', 'Echoes', 'Rest', 'Embers', 'Mornings', 'Waters', 'Hammers', 'Roots', 'Banners', 'Memory'],
  // the hold's legend event types: a record stores 1 + the index (APPEND-ONLY)
  eventTypes: ['founded', 'raid', 'siege', 'collapse', 'flood', 'death', 'office', 'prestige', 'birth', 'petition', 'tier', 'artifact', 'slain', 'level', 'beast', 'crime', 'sentence', 'arrived', 'renown'],
});

/** Screen and export words for the Annals (I's screen, js/ui/annals.js). */
export const ANNALS_TEXT = Object.freeze({
  title: 'Annals',
  tabs: ['Years', 'Figures', 'Artifacts', 'Places'],
  prehistory: 'Before the Hearth',
  prehistoryNote: 'The vale\'s story before the hold, as the old tablets and the river folk tell it.',
  crownYear: (y) => `Crown year ${y}`,
  noFigures: 'No one of note yet.',
  noArtifacts: 'No named artifacts yet. A crafter seized by a fever of craft makes one.',
  noPlaces: 'No named places yet. A room that reaches Grand gets a name; tombs and new levels go here too.',
  showOnMap: 'Show on map',
  unseen: 'Not yet found by the hold.',
  related: 'Related',
  living: 'Living', dead: 'Dead', ofOld: 'Of old',
});
