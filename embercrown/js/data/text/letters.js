// Letter texts: arrivals, perks, charters, tier-ups (owner G).
// Player-facing templates, kept out of logic for tone editing and translation (doc 13.4).
// {name} placeholders must be listed in vars; no emoji.
export const DATA = {
  text: [
    { id: 'letter_wanderer', text: '{name}, a {ancestry} {title}, asks to join the hold. Accept?', vars: ['name', 'ancestry', 'title'] },
    { id: 'letter_tierup', text: 'The hold has grown into a {tier}. New work and new dangers open to us.', vars: ['tier'] },
    { id: 'letter_charter', text: 'The hold is ready for a charter. Choose the path we will walk.' },
  ],
};
