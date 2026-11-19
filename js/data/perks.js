// Skill perks (doc 4.2, 8.1; EMBERCROWN-FORTRESS.md 3.1): the six key skills have 2 perks at levels 10 and 20
// (24 perks); each of the other nine has one signature perk at 15 (9 perks): 33 in all. OWNER F.
// Growth by doing (F10): no perk is picked. A colonist EARNS a perk when its skill level is reached and its
// deed is done; how each one is earned (the 3.1 table) lives in js/data/deeds-col.js PERK_EARN, keyed by these
// ids, until the C11 perk schema (G) takes an `earn` field on the row. Both perks of a level can be earned.
// Every perk adds an action or changes a rule; `grants` names ONE hook: a rule from schema RULE_IDS,
// or a toil / action id for the hooks that list does not hold yet (code reads either through
// people/perks.js hasGrant). A grant shows a toast and writes the Chronicle lines below.
// Hooks live with the system that owns the verb: people/perks.js registers every id (validate-data
// lists them) and implements F's own (Unbroken, Ember Hands, Fever Watch, Seam Follower, Banner-maker,
// Hearth Cook's feast thought, Silver Tongue's talk-down bonus); E, H, K and B read hasGrant for theirs.
export const DATA = {
  perk: [
    // Mining (key)
    { id: 'cave_sense', skill: 'mining', lvl: 10, name: 'Cave Sense', text: 'Sees crack overlays 2 hours before a cave-in; unknown cavern tiles within 4 show a hollow mark.', grants: { rule: 'caveSense' }, mods: [] },
    { id: 'seam_follower', skill: 'mining', lvl: 10, name: 'Seam Follower', text: 'Mining one vein tile makes the whole connected vein known.', grants: { rule: 'seamFollower' }, mods: [] },
    { id: 'stonefriend', skill: 'mining', lvl: 20, name: 'Stonefriend', text: 'May leave a natural pillar while mining, and leaves mined faces smoothed.', grants: { toil: 'stonefriend' }, mods: [] },
    { id: 'heartdelver', skill: 'mining', lvl: 20, name: 'Heartdelver', text: 'Gem and Heartstone pockets show through 4 tiles of rock.', grants: { toil: 'heartdelver' }, mods: [] },
    // Construction (key)
    { id: 'quick_shoring', skill: 'construction', lvl: 10, name: 'Quick Shoring', text: 'Sets a wooden prop on the spot from 10 carried wood, no bench needed.', grants: { rule: 'quickShoring' }, mods: [] },
    { id: 'salvager', skill: 'construction', lvl: 10, name: 'Salvager', text: 'Deconstruction returns all materials and digs buried items out of rubble at once.', grants: { toil: 'salvager' }, mods: [] },
    { id: 'master_builder', skill: 'construction', lvl: 20, name: 'Master Builder', text: 'Walls they build count as reinforced: sappers dig them four times slower.', grants: { toil: 'master_builder' }, mods: [] },
    { id: 'siege_engineer', skill: 'construction', lvl: 20, name: 'Siege Engineer', text: 'Repairs under attack twice as fast and raises a barricade from a stone pile in an hour.', grants: { toil: 'siege_engineer' }, mods: [] },
    // Smithing (key)
    { id: 'reforger', skill: 'smithing', lvl: 10, name: 'Reforger', text: 'Melts captured weapons and armour into 60% of their metal at any forge.', grants: { toil: 'reforger' }, mods: [] },
    { id: 'temperer', skill: 'smithing', lvl: 10, name: 'Temperer', text: "Re-rolls a weapon's quality once for 30% of its metal.", grants: { rule: 'temper' }, mods: [] },
    { id: 'crownsmith', skill: 'smithing', lvl: 20, name: 'Crownsmith', text: 'Forges Legendary on purpose: twice the cost and three days.', grants: { toil: 'crownsmith' }, mods: [] },
    { id: 'ashquencher', skill: 'smithing', lvl: 20, name: 'Ashquencher', text: 'Quenches a blade in greyash: it gains Hollowbane against the Hollow.', grants: { toil: 'ashquencher' }, mods: [] },
    // Medicine (key)
    { id: 'field_surgeon', skill: 'medicine', lvl: 10, name: 'Field Surgeon', text: 'Tends downed colonists where they lie, at full quality.', grants: { rule: 'fieldSurgeon' }, mods: [] },
    { id: 'fever_watch', skill: 'medicine', lvl: 10, name: 'Fever Watch', text: 'Sees infections 12 hours before they show and stops them with a re-tend.', grants: { toil: 'fever_watch' }, mods: [] },
    { id: 'taintbreaker', skill: 'medicine', lvl: 20, name: 'Taintbreaker', text: 'Cuts out a Grey Taint below 60 by surgery, no Temple needed.', grants: { toil: 'taintbreaker' }, mods: [] },
    { id: 'ember_hands', skill: 'medicine', lvl: 20, name: 'Ember Hands', text: "Once a day, stops a dying colonist's blood loss with a touch.", grants: { toil: 'ember_hands' }, mods: [] },
    // Melee (key)
    { id: 'shieldwall', skill: 'melee', lvl: 10, name: 'Shieldwall', text: 'While holding a 1-tile choke, enemies cannot push past.', grants: { toil: 'shieldwall' }, mods: [] },
    { id: 'duelist', skill: 'melee', lvl: 10, name: 'Duelist', text: 'Challenges an elite or a captain: the two duel for 10 s and no one else may join.', grants: { toil: 'duel' }, mods: [] },
    { id: 'unbroken', skill: 'melee', lvl: 20, name: 'Unbroken', text: 'Survives the first lethal hit of each raid at 1 HP.', grants: { toil: 'unbroken' }, mods: [] },
    { id: 'warcry', skill: 'melee', lvl: 20, name: 'Warcry', text: 'Once a fight, Husks and beasts within 6 tiles flee for 5 s.', grants: { toil: 'warcry' }, mods: [] },
    // Archery (key)
    { id: 'fire_arrows', skill: 'archery', lvl: 10, name: 'Fire Arrows', text: 'Lights arrows at a brazier in range: hits set targets and wood alight and pin Shades.', grants: { toil: 'fire_arrows' }, mods: [] },
    { id: 'overwatch', skill: 'archery', lvl: 10, name: 'Overwatch', text: 'On Hold, shoots the first enemy to enter a marked arc before it acts.', grants: { toil: 'overwatch' }, mods: [] },
    { id: 'deadeye', skill: 'archery', lvl: 20, name: 'Deadeye', text: "An aimed shot at a weak spot deals three times the damage.", grants: { toil: 'deadeye' }, mods: [] },
    { id: 'volley_captain', skill: 'archery', lvl: 20, name: 'Volley Captain', text: "The squad's archers loose together; a volley staggers the target for 2 s.", grants: { toil: 'volley' }, mods: [] },
    // Signature perks at 15
    { id: 'trapwright', skill: 'woodcraft', lvl: 15, name: 'Trapwright', text: 'Builds and rearms traps without a hauler; builds deadfalls from wood.', grants: { toil: 'trapwright' }, mods: [] },
    { id: 'stone_carver', skill: 'masonry', lvl: 15, name: 'Stone Carver', text: 'Carves beds, tables, thrones and statues in place from the rock of a carved room.', grants: { rule: 'stoneCarver' }, mods: [] },
    { id: 'banner_maker', skill: 'tailoring', lvl: 15, name: 'Banner-maker', text: 'Sews a squad banner: a squad near its banner never breaks or flees.', grants: { toil: 'banner_maker' }, mods: [] },
    { id: 'hearth_cook', skill: 'cooking', lvl: 15, name: 'Hearth Cook', text: 'May call a feast in a dining hall: everyone gathers for 2 hours, mood +8 and three times the chats.', grants: { rule: 'hearthCook' }, mods: [] },
    { id: 'graft_hand', skill: 'growing', lvl: 15, name: 'Graft-hand', text: 'Turns a wild berry bush, herb patch or old tree into a sapling to replant anywhere.', grants: { toil: 'graft' }, mods: [] },
    { id: 'beast_friend', skill: 'animals', lvl: 15, name: 'Beast-friend', text: 'Calms a manhunter or a cave beast: it stops attacking and can be tamed.', grants: { toil: 'calm_beast' }, mods: [] },
    { id: 'deep_reader', skill: 'lore', lvl: 15, name: 'Deep Reader', text: "Reads a lore tablet for a second tech; studying a great beast's remains shows its telegraphs 1 s earlier.", grants: { toil: 'deep_reader' }, mods: [] },
    { id: 'chronicler', skill: 'art', lvl: 15, name: 'Chronicler', text: 'Engraves a deed on a wall: everyone who sees it is glad of "Our history".', grants: { toil: 'chronicle' }, mods: [] },
    { id: 'silver_tongue', skill: 'social', lvl: 15, name: 'Silver Tongue', text: 'At the Sighted stage, parleys with a reaver warband: pay tribute to turn it back, or win over deserters.', grants: { toil: 'parley' }, mods: [] },
  ],
  // The Chronicle lines of a grant (people/perks.js) and of a Stage 2 pair choice the v2 to v3 migration settled.
  text: [
    { id: 'chron_perk', text: '{name} has learned {perk}: {why}.', vars: ['name', 'perk', 'why'] },
    { id: 'chron_perk_settled', text: '{name} settled into the ways of a {perk}.', vars: ['name', 'perk'] },
  ],
};
