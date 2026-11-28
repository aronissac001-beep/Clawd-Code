// Threat causes (EMBERCROWN-FORTRESS.md 2.10, F26; step Z2.10). Owner G (data), H (logic in
// js/game/threat/causes.js). A cause is a fact of the world state; the storyteller may schedule a hostile
// incident only while a live cause allows it, and its letters and the Annals name that cause.
//   cause rows   id, name, allows: { subject: [incident ids] } ('*' = any subject of that kind),
//                line: the text id of the letter line, deep: true for the Z3 kinds (no source yet)
//   Subjects: grievance -> a world faction id (ashfang, gutterkin) or a nemesis 'm<id>' (code: the major
//   that nemesis leads); rumour -> a trader id; hunger -> 'hollow'; winter -> a season id; seep -> 'seep'.
// Every hostile incident (one with pts) must be allowed by at least one row (causes.test.mjs checks it).
// Owner decision 4: no cause may name an earlier hold.
export const DATA = {
  cause: [
    { id: 'grievance', name: 'Grievance', line: 'cause_grievance',
      allows: { ashfang: ['reaver_raid', 'siege'], gutterkin: ['thieves', 'lone_thief', 'sapper_raid'] } },
    // (Z2b) rumour allows reavers too, as the 2.10 table says ("thieves, reavers, the Gloomwyrm")
    { id: 'rumour', name: 'Rumour of wealth', line: 'cause_rumour', allows: { '*': ['thieves', 'lone_thief', 'sapper_raid', 'reaver_raid'] } },
    { id: 'hunger', name: "The Hollow's hunger", line: 'cause_hunger', allows: { hollow: ['hollow_horde', 'lone_husks', 'hollow_rift'] } },
    { id: 'winter', name: 'Hard winter', line: 'cause_winter', allows: { '*': ['manhunters', 'wolf_pair'] } },
    // (Z2b) carrion: raw meat, fish, carcasses and the unburied dead the hold keeps draw the beasts (R2 9.3 "Beasts:
    // Camp, any"); with hard winter as their only cause, manhunters had vanished for most of the year (2.10 amended)
    { id: 'carrion', name: 'Scent of carrion', line: 'cause_carrion', allows: { '*': ['manhunters', 'wolf_pair'] } },
    { id: 'seep', name: 'Woken seep', line: 'cause_seep', allows: { seep: ['deep_breach'] } },
    // Z3.1: a cavern a colonist has stood in (subject: hollows | mere | reach) lets its packs, and from the Mere
    // the Lamplost thieves, out through its deep passages
    { id: 'opened_cavern', name: 'Opened cavern', line: 'cause_cavern',
      allows: { hollows: ['cavern_pack'], mere: ['cavern_pack', 'lamplost_thieves'], reach: ['cavern_pack'] } },
    // Z3.1: digging near a lair row (subject 'lair:<voxel>'); the beast that wakes is Z3.3's (allows filled there)
    { id: 'near_lair', name: 'Near lair', line: 'cause_lair', allows: {} },
  ],
  // the caverns' names in cause lines
  cavern: [{ id: 'hollows', name: 'the Hollows' }, { id: 'mere', name: 'the Mere' }, { id: 'reach', name: 'the Hollow Reach' }],
  // Weights (the numbers a row carries; renown leans multiply them, js/data/renown.js `lean`).
  tuning: [
    { id: 'causes', hungerBase: 3, ashfangBase: 3, vaultW: 2, nemesisW: 4, gutterkinFrom: -15, gutterkinBase: 2, gutterkinStep: 10,
      rumourBase: 1, rumourMax: 6, rumourWorth: 5000,
      carrionFromDay: 15, carrionMin: 30, carrionStep: 60, carrionMax: 4, carrionBodyN: 10, winterDeep: 4, winterEdge: 2, winterSnap: 2, weightRef: 4, weightMax: 12,
      // Z3.1: opened caverns, lairs and seeps (the near rule: a found voxel within r tiles planar and dz levels)
      cavernW: 3, lairW: 4, lairR: 12, seepW: 4, seepR: 15, nearDz: 2 },
  ],
  text: [
    { id: 'cause_grievance_ashfang', text: 'The {faction} have not forgiven the Old Crown, which drove {founder} and their people to the Grey Edge.', vars: ['faction', 'founder'] },
    { id: 'cause_grievance_vault', text: 'The {faction} come for {vault}, the vault of their fathers, which you opened.', vars: ['faction', 'vault'] },
    { id: 'cause_grievance_gutterkin', text: 'The Gutterkin bear the hold a grudge, and they mean to collect it.' },
    { id: 'cause_grievance_war', text: '{leader} leads {civ} against the hold, for they are at war with {liege}, whom the hold serves.', vars: ['leader', 'civ', 'liege'] },
    { id: 'cause_grievance_civ', text: '{leader} of {civ} has sworn to humble the hold, and their people answer the call.', vars: ['leader', 'civ'] },
    { id: 'cause_grievance_civ_thieves', text: '{leader} comes for the hold\'s stores with the cutpurses of {civ}.', vars: ['leader', 'civ'] },
    { id: 'cause_grievance_civ_lost', text: 'Raiders come from the wider world, but word of who sent them is lost.' },
    { id: 'cause_grievance_nemesis', text: '{nemesis} has not forgotten the wound {target} gave it.', vars: ['nemesis', 'target'] },
    { id: 'cause_rumour', text: 'Word of your silver has spread since the {trader} left.', vars: ['trader'] },
    { id: 'cause_hunger', text: 'The Hollow hunger for the light of the Hearth.' },
    { id: 'cause_hunger_bright', text: 'The Hearth burns bright, and the Hollow can see it from the grey land.' },
    { id: 'cause_winter', text: 'Hard winter: the beasts at the edges are starving.' },
    { id: 'cause_winter_snap', text: 'The cold snap has driven starving beasts out of the hills.' },
    { id: 'cause_carrion', text: 'The smell of meat and carrion carries from the hold, and the beasts have caught it.' },
    { id: 'cause_seep', text: 'A seep in the deep has woken, and the cold breathes up through it.' },
    { id: 'cause_cavern', text: 'Something has found the way out of {cavern}, which you opened.', vars: ['cavern'] },
    { id: 'cause_lair', text: 'Your picks have woken what sleeps in its lair.' },
  ],
};
