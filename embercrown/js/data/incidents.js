// Incidents (doc 9.1, 9.3, 9.7, 9.8, 9.10). OWNER H. Schema C12 is in js/game/threat/incidents.js;
// data fields per C11 (js/data/schema.js). The code half of each incident (plan, start, tick, end)
// registers by id in js/game/threat/* (horde.js, thieves.js, beasts.js, reavers.js, sappers.js,
// rift.js, breach.js, minors.js, disasters.js, visitors.js).
//   cat      major | minor | disaster | visitor | boon (discovery: never scheduled)
//   pts      { min, mult }: a hostile incident's share of the threat budget (percent); no pts: nothing
//            hostile comes (a disaster, a visitor, a boon)
//   warnH    the incident's own warning lead in hours (majors use their storyteller's lead; 0: none)
//   arrive   day | dusk | night | any (the arrival hour, balance.js THREAT.arriveH)
//   cast     { role: selector } (9.10, js/game/threat/cast.js), chosen at the Omen and saved
//   after    aftermath ids a major may leave (9.10, js/game/threat/aftermath.js)
// Stage 1b runs only hollow_horde; the rest run from Stage 2 (the people stage, F's stage2()).
// The letter texts sit below as `text` rows (kind 'text', ids inc_*); G may move them to
// js/data/text/incidents.js unchanged.
export const DATA = {
  incident: [
    // ---- Majors (9.3) ----
    { id: 'hollow_horde', cat: 'major', minTier: 'camp', seasons: 'TBAD', weight: 10, cooldownD: 3, pts: { min: 40, mult: 100 }, warnH: [12, 24],
      arrive: 'night', tags: ['hollow'], cast: { prey: 'wounded' }, after: ['blight_scar'], letter: 'inc_hollow_horde' },
    { id: 'thieves', cat: 'major', minTier: 'camp', seasons: 'TBAD', weight: 6, cooldownD: 8, pts: { min: 50, mult: 70 }, warnH: [8, 16],
      arrive: 'day', tags: ['thief'], cast: { mark: 'bestCrafter:smithing' }, after: ['stolen_heirloom'], letter: 'inc_thieves' },
    { id: 'manhunters', cat: 'major', minTier: 'camp', seasons: 'TBA', weight: 5, cooldownD: 10, pts: { min: 50, mult: 80 }, warnH: [8, 16],
      arrive: 'any', tags: ['beast'], letter: 'inc_manhunters' },
    { id: 'reaver_raid', cat: 'major', minTier: 'hamlet', seasons: 'TBAD', weight: 9, cooldownD: 6, pts: { min: 150, mult: 100 }, warnH: [12, 24],
      arrive: 'day', tags: ['reaver'], cast: { hunted: 'captainSlayer', kin: 'newest' }, after: ['captive', 'wreckage'], letter: 'inc_reaver_raid' },
    { id: 'sapper_raid', cat: 'major', minTier: 'village', seasons: 'TBAD', weight: 6, cooldownD: 8, pts: { min: 150, mult: 100 }, warnH: [12, 24],
      arrive: 'night', tags: ['sapper'], after: ['captive'], letter: 'inc_sapper_raid' },
    { id: 'hollow_rift', cat: 'major', minTier: 'village', seasons: 'TBAD', weight: 5, cooldownD: 15, pts: { min: 200, mult: 90 }, warnH: [12, 24],
      arrive: 'night', tags: ['rift'], after: ['blight_scar'], letter: 'inc_hollow_rift' },
    { id: 'deep_breach', cat: 'major', minTier: 'camp', seasons: 'TBAD', weight: 5, cooldownD: 12, pts: { min: 150, mult: 100 }, warnH: [12, 24],
      arrive: 'night', tags: ['breach'], cast: { prey: 'wounded' }, after: ['blight_scar'], letter: 'inc_deep_breach' },
    { id: 'siege', cat: 'major', minTier: 'hold', seasons: 'TBA', weight: 0, cooldownD: 20, pts: { min: 600, mult: 120 }, warnH: [24, 36],
      arrive: 'day', tags: ['siege', 'reaver'], after: ['siege_camp'], letter: 'inc_siege' },
    // ---- Minor threats ----
    { id: 'lone_husks', cat: 'minor', minTier: 'camp', seasons: 'TBAD', weight: 6, cooldownD: 3, pts: { min: 20, mult: 25 }, warnH: [3, 6],
      arrive: 'night', tags: ['hollow'], letter: 'inc_lone_husks' },
    { id: 'lone_thief', cat: 'minor', minTier: 'camp', seasons: 'TBAD', weight: 5, cooldownD: 4, pts: { min: 25, mult: 15 }, warnH: [2, 4],
      arrive: 'day', tags: ['thief'], letter: 'inc_lone_thief' },
    { id: 'wolf_pair', cat: 'minor', minTier: 'camp', seasons: 'TBAD', weight: 4, cooldownD: 5, pts: { min: 50, mult: 25 }, warnH: [3, 6],
      arrive: 'any', tags: ['beast'], letter: 'inc_wolf_pair' },
    { id: 'brawl', cat: 'minor', minTier: 'camp', seasons: 'TBAD', weight: 3, cooldownD: 6, warnH: [0, 0], arrive: 'any', cast: { pair: 'rivalPair' }, letter: 'inc_brawl' },
    { id: 'hollow_whisper', cat: 'minor', minTier: 'camp', seasons: 'TBAD', weight: 3, cooldownD: 8, warnH: [0, 0], arrive: 'night', cast: { dreamer: 'lowestMood' }, letter: 'inc_hollow_whisper' },
    // ---- Disasters (9.7) ----
    { id: 'fire', cat: 'disaster', minTier: 'camp', seasons: 'BA', weight: 3, cooldownD: 8, warnH: [0, 0], arrive: 'any', tags: ['fire'], letter: 'inc_fire' },
    { id: 'blight_surge', cat: 'disaster', minTier: 'camp', seasons: 'A', weight: 4, cooldownD: 10, warnH: [24, 24], arrive: 'dusk', tags: ['blight'], letter: 'inc_blight_surge' },
    { id: 'crop_blight', cat: 'disaster', minTier: 'camp', seasons: 'TB', weight: 3, cooldownD: 10, warnH: [0, 0], arrive: 'day', tags: ['blight'], letter: 'inc_crop_blight' },
    { id: 'grey_cough', cat: 'disaster', minTier: 'camp', seasons: 'TBAD', weight: 2, cooldownD: 20, warnH: [0, 0], arrive: 'any', letter: 'inc_grey_cough' },
    { id: 'deep_tremor', cat: 'disaster', minTier: 'village', seasons: 'TBAD', weight: 2, cooldownD: 12, warnH: [6, 6], arrive: 'any', letter: 'inc_deep_tremor' },
    { id: 'cold_snap', cat: 'disaster', minTier: 'camp', seasons: 'AD', weight: 3, cooldownD: 12, warnH: [24, 24], arrive: 'night', tags: ['cold'], letter: 'inc_cold_snap' },
    { id: 'drought', cat: 'disaster', minTier: 'camp', seasons: 'B', weight: 3, cooldownD: 15, warnH: [24, 24], arrive: 'day', letter: 'inc_drought' },
    { id: 'flood', cat: 'disaster', minTier: 'camp', seasons: 'T', weight: 3, cooldownD: 15, warnH: [12, 12], arrive: 'any', letter: 'inc_flood' },
    { id: 'vermin', cat: 'disaster', minTier: 'camp', seasons: 'TBAD', weight: 3, cooldownD: 10, warnH: [0, 0], arrive: 'night', tags: ['vermin'], letter: 'inc_vermin' },
    { id: 'ember_gutter', cat: 'disaster', minTier: 'camp', seasons: 'TBAD', weight: 1, cooldownD: 20, warnH: [0, 0], arrive: 'night', letter: 'inc_ember_gutter' },
    // ---- Visitors (9.8; traders and envoys are K's colony/trade.js) ----
    { id: 'wanderer', cat: 'visitor', minTier: 'camp', seasons: 'TBAD', weight: 5, cooldownD: 8, warnH: [0, 0], arrive: 'day', letter: 'inc_wanderer' },
    { id: 'migrants', cat: 'visitor', minTier: 'hamlet', seasons: 'TB', weight: 3, cooldownD: 12, warnH: [0, 0], arrive: 'day', letter: 'inc_migrants' },
    { id: 'refugees', cat: 'visitor', minTier: 'hamlet', seasons: 'TBAD', weight: 2, cooldownD: 20, warnH: [0, 0], arrive: 'day', letter: 'inc_refugees' },
    // ---- Boons ----
    { id: 'herd_passing', cat: 'boon', minTier: 'camp', seasons: 'TBA', weight: 3, cooldownD: 20, warnH: [0, 0], arrive: 'day', letter: 'inc_herd_passing' },
    { id: 'lost_cache', cat: 'boon', minTier: 'camp', seasons: 'TBAD', weight: 3, cooldownD: 10, warnH: [0, 0], arrive: 'day', letter: 'inc_lost_cache' },
    { id: 'starfall', cat: 'boon', minTier: 'village', seasons: 'TBAD', weight: 1, cooldownD: 30, warnH: [0, 0], arrive: 'night', letter: 'inc_starfall' },
  ],
  text: [
    { id: 'inc_thieves', text: 'Small figures watch the stores from the {edge} woods. Gutterkin thieves will come for our goods in {hours} hours.', vars: ['edge', 'hours'] },
    { id: 'inc_manhunters', text: 'Something has maddened the beasts to the {edge}. A pack will hunt us in {hours} hours.', vars: ['edge', 'hours'] },
    { id: 'inc_reaver_raid', text: 'Ashfang banners on the {edge} road. A reaver warband reaches the hold in {hours} hours.', vars: ['edge', 'hours'] },
    { id: 'inc_hollow_rift', text: 'The grey land to the {edge} is tearing open. A Hollow Rift will wake in {hours} hours.', vars: ['edge', 'hours'] },
    { id: 'inc_deep_breach', text: 'Cold air breathes up from the deepest tunnel. The Hollow will come from below in {hours} hours.', vars: ['hours'] },
    { id: 'inc_lone_husks', text: 'A few Husks drift in from the {edge} in {hours} hours.', vars: ['edge', 'hours'] },
    { id: 'inc_lone_thief', text: 'A Gutterkin sneak was seen to the {edge}. Watch the stores.', vars: ['edge'] },
    { id: 'inc_wolf_pair', text: 'Hungry wolves are circling to the {edge}.', vars: ['edge'] },
    { id: 'inc_brawl', text: '{a} and {b} came to blows. Neither will say who threw the first punch.', vars: ['a', 'b'] },
    { id: 'inc_hollow_whisper', text: '{name} woke screaming. A voice in the dark knew their name.', vars: ['name'] },
    { id: 'inc_fire', text: 'Fire! Flames have caught in the hold.' },
    { id: 'inc_blight_surge', text: 'The grey stirs at the {edge} edge. By dusk tomorrow the blight will surge toward us.', vars: ['edge'] },
    { id: 'inc_crop_blight', text: 'A grey rot is in the fields. Harvest what you can before it spreads.' },
    { id: 'inc_grey_cough', text: '{name} has a dry, grey cough. It may spread through shared rooms.', vars: ['name'] },
    { id: 'inc_deep_tremor', text: 'The ground shudders. Weak rock in the tunnels may fall within {hours} hours.', vars: ['hours'] },
    { id: 'inc_cold_snap', text: 'The wind turns bitter. A cold snap is coming, and it will last for days.' },
    { id: 'inc_drought', text: 'No rain is coming. A drought will slow the crops and dry the timber.' },
    { id: 'inc_flood', text: 'The river swells. Low ground by the water will flood in {hours} hours.', vars: ['hours'] },
    { id: 'inc_vermin', text: 'Rats got into the stores in the night. Some of the food is spoiled.' },
    { id: 'inc_ember_gutter', text: 'The Hearth guttered in the night and drank deep of its fuel.' },
    { id: 'inc_wanderer', text: '{name} has come out of the wilds and asks to join the hold.', vars: ['name'] },
    { id: 'inc_migrants', text: 'A group of {n} travellers ask for a place at the Hearth.', vars: ['n'] },
    { id: 'inc_refugees', text: '{n} wounded refugees beg for shelter. Their pursuers may follow.', vars: ['n'] },
    { id: 'inc_herd_passing', text: 'A herd of deer is crossing the land. Good hunting.' },
    { id: 'inc_lost_cache', text: 'A lost caravan crate was found by the {edge} road.', vars: ['edge'] },
    { id: 'inc_starfall', text: 'A star fell in the night and struck the earth near the hold.' },
    { id: 'inc_captive', text: '{name}, a {story}, was taken alive. What will we do with them?', vars: ['name', 'story'] },
    { id: 'inc_heirloom', text: 'The thieves carried off {item}. Word says their camp lies past the {edge} hills.', vars: ['item', 'edge'] },
    { id: 'inc_heros_memory', text: '{name} was a master of their craft. Raise a statue within 10 days, or they will be forgotten.', vars: ['name'] },
    { id: 'nem_made', text: '{nemesis} escaped. It will remember {target}.', vars: ['nemesis', 'target'] },
    { id: 'nem_slain', text: '{nemesis} is dead at last, felled by {killer}.', vars: ['nemesis', 'killer'] },
    { id: 'nem_epithet_scar', variants: ['the Scarred', 'Burnt-Hide', 'the Cut-Eye', 'Old Wound'] },
    { id: 'nem_epithet_ear', variants: ['with the Split Ear', 'the Torn', 'Half-Ear'] },
    { id: 'nem_epithet_ash', variants: ['the Ash-Marked', 'Cinder-Back', 'the Smoking'] },
    { id: 'nem_title', variants: ['Bane of the Hold', 'the Widowmaker', 'Hearth-Breaker'] },
    { id: 'nem_hound_name', variants: ['The Grey Alpha', 'Old Grin', 'The Long Hound'] },
    { id: 'nem_hollow_name', variants: ['The Pale Warden', 'The Unsleeping', 'The Hollow Reeve'] },
  ],
};
