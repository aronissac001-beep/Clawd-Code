// Incident letters (9.x; incidents.js names these ids) (owner G).
// Player-facing templates, kept out of logic for tone editing and translation (doc 13.4).
// {name} placeholders must be listed in vars; no emoji.
export const DATA = {
  text: [
    { id: 'inc_hollow_horde', text: 'Grey shapes gather to the {edge}. A Hollow horde will reach the hold in {hours} hours.', vars: ['edge', 'hours'] },
    { id: 'inc_sapper_raid', text: 'Picks ring under the {edge} hills. Gutterkin delvers are tunnelling toward our stores.', vars: ['edge'] },
    { id: 'inc_siege', text: 'A siege camp rises {dist} tiles from the Hearth. They mean to stay.', vars: ['dist'] },
  ],
};
