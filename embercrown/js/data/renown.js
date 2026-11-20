// Renown (EMBERCROWN-FORTRESS.md 3.10, F11; owner G, logic K in js/game/colony/renown.js from Z2).
// Replaces the colony charters (Stage 2.9): a hold is never asked to choose a path. It becomes "known
// for" a domain by what it actually does: each domain gathers points each season from the activity in
// `measures` (decaying 25% a season); a domain above its `threshold` and above 1.5x the median of the
// others makes the hold known for it (at most two, one season of hysteresis).
// Renown NEVER gates a structure, recipe, mechanic or prestige building. It only steers who visits
// (`visitor`), the lean of the threat causes (`lean`: cause kind -> weight percent, 2.10) and flavour
// (`epithet`, the hold's name in letters). The former charter mechanics are verbs every hold has
// (js/game/colony/verbs/*.js).
export const DATA = {
  renown: [
    { id: 'smithing', name: 'Smithing', epithet: 'the Forge under the Mountain', threshold: 400,
      measures: ['forge_value', 'masterwork', 'artifact'], visitor: 'a smith guild envoy with commissions',
      text: 'Known for its forges: metal goods, masterworks and named artifacts.' },
    { id: 'growing', name: 'Growing', epithet: 'the Green Hold', threshold: 400,
      measures: ['harvest', 'herd', 'food_value'], visitor: 'a seed merchant',
      text: 'Known for its fields and herds.' },
    { id: 'lore', name: 'Lore and light', epithet: 'the Lantern of the Vale', threshold: 300,
      measures: ['research', 'light_built', 'lumenite'], visitor: 'a travelling scholar',
      text: 'Known for its learning and its lights.' },
    { id: 'trade', name: 'Trade', epithet: 'the Market Hold', threshold: 400,
      measures: ['trade_value', 'caravan'], visitor: 'a trading house factor', lean: { rumour: 150 },
      text: 'Known for its trade: word of its silver spreads.' },
    { id: 'arms', name: 'Arms', epithet: 'the Unbroken Gate', threshold: 300,
      measures: ['raid_repelled', 'foe_slain', 'beast_slain'], visitor: 'a sellsword captain', lean: { grievance: 125 },
      text: 'Known for its fighters: old enemies answer sooner.' },
    { id: 'delving', name: 'Delving', epithet: 'the Deep Hold', threshold: 300,
      measures: ['level_opened', 'cavern_opened', 'gem'], visitor: 'a deep-trader of the Lamplost', lean: { opened_cavern: 125 },
      text: 'Known for how deep it has dug.' },
  ],
};
