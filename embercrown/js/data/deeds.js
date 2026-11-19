// Deeds: the hold's lasting goals and Chronicle highlights (owner G, logic K in colony/deeds.js;
// replaces the roguelite achievements). goal counts an event (C8 names, core/events.js); k narrows
// it to one kind (an ore, a tier).
// Stage 2 (14.8 row G): the first 20. K's deeds.js counts them from the ledger's lifetime totals:
// raidEnd, mined, oreFound, built, crafted and masterwork are counted today; tierUp (k = the tier),
// artifact, rankUp and inspired, and any goal with k, need K's counters (open issue for K).
export const DATA = {
  deed: [
    // the first three (Stage 1b ids; keep them)
    { id: 'first_night', name: 'Through the first night', cat: 'war', goal: { event: 'raidEnd', n: 1 }, text: 'Repel the first Hollow horde.' },
    { id: 'deep_seam', name: 'A seam of iron', cat: 'depth', goal: { event: 'oreFound', n: 1, k: 'iron' }, text: 'Find the first iron vein.' },
    { id: 'masterwork', name: 'A masterwork', cat: 'craft', goal: { event: 'masterwork', n: 1 }, text: 'Craft the first Masterwork.' },
    // ---- Stage 2 ----
    { id: 'five_nights', name: 'Five nights held', cat: 'war', goal: { event: 'raidEnd', n: 5 }, text: 'Repel five raids.' },
    { id: 'twenty_nights', name: 'The long watch', cat: 'war', goal: { event: 'raidEnd', n: 20 }, text: 'Repel twenty raids.' },
    { id: 'first_dig', name: 'Into the mountain', cat: 'depth', goal: { event: 'mined', n: 100 }, text: 'Mine 100 tiles of rock.' },
    { id: 'deep_delver', name: 'Deep delvers', cat: 'depth', goal: { event: 'mined', n: 1000 }, text: 'Mine 1,000 tiles of rock.' },
    { id: 'under_mountain', name: 'The hold under the mountain', cat: 'depth', goal: { event: 'mined', n: 5000 }, text: 'Mine 5,000 tiles of rock.' },
    { id: 'prospector', name: 'Veins of plenty', cat: 'depth', goal: { event: 'oreFound', n: 10 }, text: 'Uncover ten ore veins.' },
    { id: 'first_walls', name: 'Walls and a roof', cat: 'founding', goal: { event: 'built', n: 10 }, text: 'Finish ten structures.' },
    { id: 'builders', name: 'A hold of builders', cat: 'founding', goal: { event: 'built', n: 100 }, text: 'Finish 100 structures.' },
    { id: 'stonewrights', name: 'Stonewrights', cat: 'founding', goal: { event: 'built', n: 500 }, text: 'Finish 500 structures.' },
    { id: 'hamlet', name: 'A hamlet stands', cat: 'founding', goal: { event: 'tierUp', n: 1, k: 'hamlet' }, text: 'Grow the camp into a Hamlet.' },
    { id: 'village', name: 'A village under the mountain', cat: 'founding', goal: { event: 'tierUp', n: 1, k: 'village' }, text: 'Grow the hamlet into a Village.' },
    { id: 'hands_at_work', name: 'Hands at work', cat: 'craft', goal: { event: 'crafted', n: 50 }, text: 'Craft 50 things at the benches.' },
    { id: 'workshop_hold', name: 'A hold of workshops', cat: 'craft', goal: { event: 'crafted', n: 500 }, text: 'Craft 500 things at the benches.' },
    { id: 'five_masterworks', name: 'Masters of the craft', cat: 'craft', goal: { event: 'masterwork', n: 5 }, text: 'Craft five Masterworks.' },
    { id: 'named_artifact', name: 'A thing with a name', cat: 'craft', goal: { event: 'artifact', n: 1 }, text: 'An Ember-touched crafter makes a named artifact.' },
    { id: 'skilled_hands', name: 'Skilled hands', cat: 'people', goal: { event: 'rankUp', n: 10 }, text: 'Colonists rise ten ranks in their skills.' },
    { id: 'inspired', name: 'A spark of genius', cat: 'people', goal: { event: 'inspired', n: 1 }, text: 'A colonist is inspired.' },
  ],
};
