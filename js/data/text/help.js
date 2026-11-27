// Help and coach text (10.9) (owner G).
// Player-facing templates, kept out of logic for tone editing and translation (doc 13.4).
// {name} placeholders must be listed in vars; no emoji.
export const DATA = {
  text: [
    { id: 'help_mine', text: 'Drag over rock to mark it for mining. Miners dig it out and leave stone behind.' },
    { id: 'help_stockpile', text: 'Paint a stockpile so haulers know where to bring things.' },
    { id: 'help_hearth', text: 'Keep the Hearth fed. A cold Hearth means no light, no claim and an angry Hollow.' },
  ],
};

// The coach, the hints by need and the "What is new" deck (EMBERCROWN-WORLD.md 8.8, G23; read by js/ui/guide.js and
// js/ui/intros.js; step W1.7). Our own wording; {name} placeholders are filled by the UI. No emoji.
export const COACH_TEXT = Object.freeze({
  label: 'Getting started',
  count: '{n}/{total}',
  chipLabel: 'Getting started: {done} of {total} done. Open the steps',
  fold: 'Fold the steps',
  close: 'Close',
  showMe: 'Show me',
  done: 'Done: {what}.',
  steps: Object.freeze({
    chop: { title: 'Chop some trees', how: 'Wood builds walls, doors and beds, and feeds the fire.' },
    stockpile: { title: 'Make a stockpile', how: 'Haulers bring what you gather to it. Put it by the Hearth.' },
    bed: { title: 'Give everyone a bed', how: "Build a carpenter's bench for the beds, then stamp a bedroom." },
    food: { title: 'Feed the hold', how: 'Cooks make meals at a campfire; grow zones sow hearthroot.' },
    dig: { title: 'Dig down', how: 'Stairs join the levels. Coal and iron lie below.' },
    carve: { title: 'Carve into the mountain', how: 'Drag over rock: the pillars are planned for you.' },
    defend: { title: 'Light the Hearth', how: 'Two braziers by the Hearth: the Hollow fear the light.' },
  }),
  end: { title: 'Your hold has begun', how: 'Keep the Hearth fed, dig for coal and iron, and watch the chip at the top for omens.' },
});

/** One-line hints, each shown once per hold the first time its moment comes (8.8), listed under Help / Hints. */
export const HINT_TEXT = Object.freeze({
  title: 'Hints',
  none: 'Hints show here once they have appeared in this hold.',
  label: 'Hint',
  rows: Object.freeze({
    night: 'Keep the Hearth fed: the Hollow come at night',
    cavern: 'Wall off or watch the cavern: things live down there',
    flood: 'Close a door or a floodgate to stop the water',
    visitor: 'Visitors carry news of the world: see World / Letters',
    front: 'A front is coming: bring the harvest in, stock the fires',
    air: 'Build a chimney or a vent shaft',
    clash: 'Peoples keep different customs: see People / their values',
    envoy: 'A demand has a deadline: see World / Peoples',
  }),
});

/** The "What is new" deck for holds that were played before the new shell (8.8; 9.4 part 2 queues it again). */
export const WHATSNEW_TEXT = Object.freeze({
  head: 'What is new {n}/{total}',
  next: 'Next',
  ok: 'Got it',
  cards: Object.freeze({
    world: { title: 'The world around your hold', how: 'Your hold now stands in a wider world of peoples, towns and old feuds. World shows its map, its years and the news that reaches you.' },
    menus: { title: 'The new menus', how: 'The bar is sorted by what you do: Build, Mark for orders and zones, People, Hold and World. Menu, at the top left, keeps saves and settings.' },
    air: { title: 'Weather fronts and air', how: 'The sky chip shows a front a day ahead: bring the harvest in before a storm. Smoke and foul air gather in closed halls; chimneys and vent shafts clear them.' },
  }),
});
