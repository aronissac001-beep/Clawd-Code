// Next-steps advice rules (doc 10.10; owner G, card I). when(s) and score(s) read state only and
// must be pure (no randomness, no clock). text placeholders are filled by the card.
// Stage 0 samples; about 30 rules ship in Stage 2.
const hearthCold = (s) => !!(s.colony && s.colony.hearth && s.colony.hearth.fuel === 0);
const idleCount = (s) => (s.col || []).filter((c) => c && !c.job && !c.drafted).length;

export const DATA = {
  advice: [
    { id: 'hearth_fuel', text: 'The Hearth is cold: haul wood to it.', when: hearthCold, score: () => 90, go: { panel: 'hold' } },
    { id: 'idle_hands', text: 'Some colonists are idle: give them a role.', when: (s) => idleCount(s) > 0, score: (s) => 40 + 10 * idleCount(s), go: { panel: 'work' } },
    { id: 'first_stockpile', text: 'Mark a stockpile so haulers have somewhere to go.', when: (s) => !(s.zones || []).some((z) => z && z.type === 'stockpile'),
      score: () => 60, go: { tool: 'zone' }, cooldownD: 2 },
  ],
};
