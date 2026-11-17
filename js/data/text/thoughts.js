// Thought labels shown in the colonist card (ids match thoughts.js) (owner G).
// Player-facing templates, kept out of logic for tone editing and translation (doc 13.4).
// {name} placeholders must be listed in vars; no emoji.
export const DATA = {
  text: [
    { id: 'thought_ate_fine', text: 'Ate a fine meal' },
    { id: 'thought_hearth_cold', text: 'The Hearth is cold' },
    { id: 'thought_friend_died', text: 'My friend {name} died', vars: ['name'] },
  ],
};
