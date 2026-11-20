// Chronicle lines (owner G).
// Player-facing templates, kept out of logic for tone editing and translation (doc 13.4).
// {name} placeholders must be listed in vars; no emoji.
export const DATA = {
  text: [
    { id: 'chron_founded', text: 'The Hearth of {hold} was kindled in {season}, year {year}.', vars: ['hold', 'season', 'year'] },
    { id: 'chron_death', text: '{name} died of {cause}.', vars: ['name', 'cause'] },
    { id: 'chron_masterwork', text: '{maker} made {item}, a masterwork.', vars: ['maker', 'item'] },
    { id: 'chron_fell', text: 'The Hearth of {hold} went cold. No one was left to tend it. {date}.', vars: ['hold', 'date'] },
    { id: 'chron_recovered', text: 'Recovered from a copy of {date}. The hold had fallen on {fell}.', vars: ['date', 'fell'] },
    { id: 'chron_depth', text: 'The hold learned the depth of the world: the old mountain is real rock above, and there is a world below.', vars: [] },
  ],
};
