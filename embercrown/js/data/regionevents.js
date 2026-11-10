// In-region random events (Phase 3), raised by the storyteller director at daybreak.
// Each event: { id, title, icon, tone, weight, text, need?(s), choices: [choice] }.
//   tone   'good' | 'bad' | 'mixed'  (the director weighs tones by tension)
//   need   optional read-only predicate: may this event come up in region s right now?
// A choice is { label, cost?, eff? } or a gamble { label, cost?, chance, win, lose }.
//   cost   resources paid up front ({ gold: 20 }); a gold cost the realm cannot pay
//          disables the choice. Other costs are paid as far as stores allow.
//
// REGION effect language (applied by js/game/systems/director.js applyRegionEffect):
//   res: { food, wood, stone, gold }       add (negative = lose, never below 0)
//   morale: n, dread: n                    via moodAdd (common.js)
//   villagers: n                           n > 0 newcomers arrive, n < 0 villagers die
//   repair: f                              heal every building by f of its max health
//   damage: { building: 'random'|'house', amount: f }   one building loses f of its max
//                                          health (never destroyed by an event)
//   spawnTonight: { type, count, perNight? } (or an array) an extra telegraphed group at
//                                          one spawn point tonight; count + perNight*nights
//   buff: { key, value, days } (or an array)  temporary multiplier; key one of
//                                          work | farm | gold | dmg (your damage) | sight
//   reveal: r                              lift the fog in an r-tile circle somewhere out there
//   text: '...'                            flavour line shown with the result

const has = (s, type, n = 1) => { let k = 0; for (const b of s.buildings) if (b.built && b.alive && b.type === type) k++; return k >= n; };
const soldiers = (s) => { let k = 0; for (const u of s.soldiers) if (u.alive) k++; return k; };
const nonHearth = (s) => s.buildings.some((b) => b.built && b.alive && b.type !== 'hearth');

export const REGION_EVENTS = [
  {
    id: 'bard', title: 'The Wandering Bard', icon: 'book', tone: 'good', weight: 3,
    text: 'A bard in a patched cloak strums by the Hearth. "A song for your weary folk? Only a little gold."',
    choices: [
      { label: 'Pay for a ballad', cost: { gold: 20 }, eff: { morale: 12, buff: { key: 'work', value: 1.1, days: 1 }, text: 'The whole village hums at work.' } },
      { label: 'Ask for a war song', cost: { gold: 10 }, chance: 0.6, win: { buff: { key: 'dmg', value: 1.15, days: 1 }, text: 'Blood stirs. Your fighters strike harder tonight.' }, lose: { morale: -5, text: 'Off-key and off-putting.' } },
      { label: 'Send the bard away', eff: { morale: -2, text: 'The bard leaves humming something rude.' } },
    ],
  },
  {
    id: 'meteor', title: 'A Falling Star', icon: 'flame', tone: 'mixed', weight: 2, need: nonHearth,
    text: 'A star tears the dawn sky and slams into the hills. Silver-veined stone glows in the crater, and burning shards rain on a rooftop.',
    choices: [
      { label: 'Haul the star-stone now', eff: { res: { stone: 45, gold: 30 }, damage: { building: 'random', amount: 0.35 }, text: 'Rich stone, but the fire spreads before anyone fights it.' } },
      { label: 'Fight the fire first', eff: { res: { wood: -15, stone: 20, gold: 10 }, text: 'Buckets first, digging after. Half the glow has cooled to plain rock.' } },
    ],
  },
  {
    id: 'rats', title: 'Plague Rats', icon: 'skull', tone: 'bad', weight: 2,
    text: 'Grey rats with milky eyes pour out of the hedgerows and into the food stores.',
    choices: [
      { label: 'Quarantine the stores', eff: { res: { food: -20 }, buff: { key: 'work', value: 0.85, days: 1 }, text: 'Burned grain and a slow, careful day.' } },
      { label: 'Risk it', chance: 0.55, win: { text: 'The rats move on by noon.' }, lose: { res: { food: -45 }, villagers: -1, dread: 8, text: 'Sickness follows the rats.' } },
      { label: 'Hire a ratcatcher', cost: { gold: 25 }, eff: { morale: 2, text: 'A grim woman with a sack and three terriers. Problem solved.' } },
    ],
  },
  {
    id: 'fey', title: 'The Trapped Fey', icon: 'mystery', tone: 'mixed', weight: 2,
    text: 'A woodcutter found a fey creature tangled in iron wire, shimmering and furious.',
    choices: [
      { label: 'Free it', eff: { morale: 5, buff: { key: 'farm', value: 1.25, days: 3 }, text: 'It kisses the soil as it goes. The fields swell with green.' } },
      { label: 'Bind it for gold', eff: { res: { gold: 60 }, dread: 10, spawnTonight: { type: 'shade', count: 2, perNight: 0.5 }, text: 'Its cries anger the forest. Something walks out of the trees tonight.' } },
    ],
  },
  {
    id: 'deserters', title: 'Deserters', icon: 'sword', tone: 'mixed', weight: 2,
    text: 'Three ragged soldiers from a fallen realm beg for shelter. They threw down their banner, not their skills.',
    choices: [
      { label: 'Take them in', eff: { villagers: 2, res: { food: -15 }, text: 'Two stay to work. One slips away at night.' } },
      { label: 'Strip their gear and send them off', eff: { res: { gold: 25, stone: 10 }, dread: 4, morale: -3, text: 'Coin and iron, and a bitter taste.' } },
      { label: 'Turn them away', eff: { morale: -2, text: 'They trudge on toward the grey.' } },
    ],
  },
  {
    id: 'flood', title: 'The River Rises', icon: 'map', tone: 'mixed', weight: 2, need: nonHearth,
    text: 'Rain in the hills. The river swells brown and fast toward the low fields.',
    choices: [
      { label: 'Sandbag the banks', eff: { res: { wood: -20 }, buff: { key: 'work', value: 0.9, days: 1 }, text: 'Muddy, tired, and dry.' } },
      { label: 'Let it flood', eff: { damage: { building: 'random', amount: 0.3 }, buff: { key: 'farm', value: 1.3, days: 3 }, text: 'The water takes a wall of something, and leaves rich silt behind.' } },
    ],
  },
  {
    id: 'feymarket', title: 'Market at Midnight', icon: 'merchant', tone: 'good', weight: 2,
    text: 'Lanterns that burn without oil. Stalls that were not there yesterday. The fey market opens for one night only.',
    choices: [
      { label: 'Buy a lucky charm', cost: { gold: 30 }, eff: { buff: { key: 'gold', value: 1.3, days: 3 }, text: 'Coins seem to find their way into your coffers.' } },
      { label: 'Trade food for stone', eff: { res: { food: -30, stone: 35 }, text: 'Fey stone, cool and smooth.' } },
      { label: 'Gamble a purse', cost: { gold: 20 }, chance: 0.5, win: { res: { gold: 60 }, text: 'The goblin dealer curses in three languages.' }, lose: { morale: -3, text: 'Fey dice have seven sides.' } },
    ],
  },
  {
    id: 'eclipse', title: 'Sudden Eclipse', icon: 'moon', tone: 'bad', weight: 2,
    text: 'At noon the sun goes black. Something in the dark is counting your gates. Tonight, more will come.',
    choices: [
      { label: 'Man the walls', eff: { spawnTonight: { type: 'shade', count: 2, perNight: 0.5 }, buff: { key: 'dmg', value: 1.2, days: 1 }, text: 'Every blade is sharpened before dusk.' } },
      { label: 'Kindle every fire', eff: { res: { wood: -25 }, spawnTonight: { type: 'husk', count: 3, perNight: 0.5 }, text: 'The fire keeps the Shades back. Only Husks come.' } },
      { label: 'Hide and wait', eff: { spawnTonight: { type: 'shade', count: 3, perNight: 0.6 }, dread: 6, text: 'Shutters closed. Breath held.' } },
    ],
  },
  {
    id: 'festival', title: 'Harvest Festival', icon: 'farm', tone: 'good', weight: 2, need: (s) => s.res.food >= 30,
    text: 'The villagers want a feast: ribbons, a bonfire, and far too much bread.',
    choices: [
      { label: 'Hold the feast', eff: { res: { food: -30 }, morale: 15, buff: { key: 'work', value: 1.15, days: 2 }, text: 'Full bellies, light hearts, quick hands.' } },
      { label: 'Sell the surplus', eff: { res: { food: -30, gold: 40 }, morale: -4, text: 'Sensible. Joyless.' } },
      { label: 'Not this year', eff: { morale: -6, text: 'The ribbons go back in the chest.' } },
    ],
  },
  {
    id: 'hollowchild', title: 'A Stray Hollow Child', icon: 'pop', tone: 'mixed', weight: 2,
    text: 'A small grey child stands at the edge of the light, silent. Its eyes are still almost brown.',
    choices: [
      { label: 'Take it in', chance: 0.65, win: { villagers: 1, morale: 8, text: 'Warmth works slowly. By evening it laughs.' }, lose: { dread: 12, spawnTonight: { type: 'hound', count: 2, perNight: 0.4 }, text: 'It was a lure. Hounds follow its trail tonight.' } },
      { label: 'Drive it off', eff: { dread: 4, text: 'It does not cry. That is worse.' } },
      { label: 'Give it to the flame', eff: { dread: -6, morale: -8, text: 'The Hearth flares white. Nobody speaks at supper.' } },
    ],
  },
  {
    id: 'well', title: 'The Old Well', icon: 'mystery', tone: 'mixed', weight: 2,
    text: 'Clearing brush, your folk uncover a well older than the realm. Coins glint far below.',
    choices: [
      { label: 'Send someone down', chance: 0.6, win: { res: { gold: 50 }, text: 'A rope, a lamp and a bucket of old crowns.' }, lose: { villagers: -1, morale: -6, text: 'The rope came back up empty.' } },
      { label: 'Toss in a coin and wish', cost: { gold: 5 }, eff: { buff: { key: 'farm', value: 1.2, days: 2 }, morale: 3, text: 'The water tastes sweeter. So does the bread.' } },
      { label: 'Seal it', eff: { res: { stone: -10 }, dread: -5, text: 'Some things should stay down there.' } },
    ],
  },
  {
    id: 'caravan', title: 'A Lost Caravan', icon: 'merchant', tone: 'mixed', weight: 2,
    text: 'A merchant wagon, axle-deep in mud, its drivers half mad with fear of the dark.',
    choices: [
      { label: 'Escort it in', chance: 0.65, win: { res: { gold: 50, food: 20 }, text: 'Grateful merchants pay well.' }, lose: { dread: 6, spawnTonight: { type: 'hound', count: 3, perNight: 0.4 }, text: 'Hounds were already on its trail. They will be on yours tonight.' } },
      { label: 'Plunder it', eff: { res: { gold: 70, wood: 15 }, morale: -10, dread: 5, text: 'Rich spoils. Poor sleep.' } },
      { label: 'Point the way', eff: { morale: 4, text: 'They wave as they go.' } },
    ],
  },
  {
    id: 'duel', title: 'A Duel of Honour', icon: 'sword', tone: 'mixed', weight: 2, need: (s) => soldiers(s) >= 2,
    text: 'Two of your soldiers have drawn steel over a game of dice. A crowd is gathering.',
    choices: [
      { label: 'Let them fight', chance: 0.5, win: { buff: { key: 'dmg', value: 1.15, days: 2 }, morale: 4, text: 'A clean win and a handshake. The whole army is fired up.' }, lose: { morale: -8, text: 'A cut, a grudge, a sulking barracks.' } },
      { label: 'Make it a tourney', cost: { gold: 20 }, eff: { morale: 10, buff: { key: 'dmg', value: 1.1, days: 1 }, text: 'Pennants, cheering, and nobody badly hurt.' } },
      { label: 'Forbid it', eff: { morale: -4, text: 'Steel is sheathed. Tempers are not.' } },
    ],
  },
  {
    id: 'stormtree', title: 'The Storm-Struck Tree', icon: 'axe', tone: 'mixed', weight: 2, need: (s) => has(s, 'house'),
    text: 'Lightning split the great oak by the houses. Its heart still smoulders red.',
    choices: [
      { label: 'Fell it for timber', eff: { res: { wood: 35 }, damage: { building: 'house', amount: 0.15 }, text: 'Sparks scorch a roof on the way down. Good timber, though.' } },
      { label: 'Let it burn out', chance: 0.6, win: { morale: 4, text: 'A tall, slow, beautiful fire.' }, lose: { damage: { building: 'house', amount: 0.45 }, text: 'The wind turns. A house catches.' } },
    ],
  },
  {
    id: 'stranger', title: 'The Mysterious Stranger', icon: 'eye', tone: 'mixed', weight: 2,
    text: 'A cloaked figure with very clean boots asks for a bed and a meal. "I can pay," he says. "Eventually."',
    choices: [
      { label: 'Give him a bed', chance: 0.5, win: { res: { gold: 80 }, text: 'At dawn: a purse on the pillow and a royal seal.' }, lose: { res: { food: -20, gold: -20 }, text: 'At dawn: an empty bed and an emptier storeroom.' } },
      { label: 'Buy his news', cost: { gold: 15 }, eff: { reveal: 9, text: 'He draws you a map of the land beyond the fog.' } },
      { label: 'Turn him away', eff: { text: 'He tips his hat and is gone.' } },
    ],
  },
  {
    id: 'spring', title: 'The Ember Spring', icon: 'flame', tone: 'good', weight: 2,
    text: 'A warm spring bubbles up beside the Hearth, smelling faintly of cinnamon and smoke.',
    choices: [
      { label: 'Pipe it to the walls', eff: { res: { stone: -15 }, repair: 0.5, text: 'Warm water seals every crack.' } },
      { label: 'Open a bathhouse', eff: { res: { wood: -15 }, morale: 10, dread: -4, text: 'Steam and song every evening.' } },
    ],
  },
  {
    id: 'refugees', title: 'Refugees at the Gate', icon: 'house', tone: 'mixed', weight: 2,
    text: 'A column of grey-faced families, fleeing a realm the Hollow swallowed.',
    choices: [
      { label: 'Take them all', eff: { villagers: 3, res: { food: -30 }, dread: 3, text: 'Crowded, hungry, alive.' } },
      { label: 'Take the strong', eff: { villagers: 1, morale: -3, text: 'A hard choice, quickly made.' } },
      { label: 'Close the gate', eff: { morale: -6, dread: 2, text: 'Their voices carry long into the night.' } },
    ],
  },
  {
    id: 'masons', title: 'Travelling Masons', icon: 'hammer', tone: 'good', weight: 2,
    text: 'A guild of masons, dusty and cheerful, looking for a day of work.',
    choices: [
      { label: 'Hire them to repair', cost: { gold: 30 }, eff: { repair: 0.6, buff: { key: 'work', value: 1.2, days: 1 }, text: 'Every wall straightened by sundown.' } },
      { label: 'Buy their stone', cost: { gold: 25 }, eff: { res: { stone: 40 }, text: 'Cut, squared and stacked.' } },
      { label: 'Wish them well', eff: { text: 'They tip their caps and move on.' } },
    ],
  },
  {
    id: 'scout', title: 'A Hollow Scout', icon: 'eye', tone: 'bad', weight: 2,
    text: 'Something grey watches from the treeline, then slips away to tell the others.',
    choices: [
      { label: 'Hunt it down', chance: 0.6, win: { reveal: 8, dread: -4, text: 'Caught and burned, and its trail mapped.' }, lose: { spawnTonight: { type: 'hound', count: 2, perNight: 0.4 }, dread: 4, text: 'It got away. Its pack knows the way now.' } },
      { label: 'Let it go', eff: { spawnTonight: { type: 'husk', count: 3, perNight: 0.5 }, text: 'More will come tonight.' } },
    ],
  },
  {
    id: 'crows', title: 'Circling Crows', icon: 'mystery', tone: 'mixed', weight: 2,
    text: 'Crows circle a hill to the south, three times, then settle. The old women say it means something.',
    choices: [
      { label: 'Read the omen', eff: { reveal: 8, dread: 3, text: 'The crows point the way to something out there.' } },
      { label: 'Scatter them', eff: { morale: 2, text: 'Rocks and shouting. Very satisfying.' } },
    ],
  },
  {
    id: 'hunters', title: "The Hunters' Haul", icon: 'food', tone: 'good', weight: 2,
    text: 'Your hunters come back whistling, a great stag slung between them.',
    choices: [
      { label: 'Roast it tonight', eff: { res: { food: 30 }, morale: 6, text: 'Grease on every chin.' } },
      { label: 'Sell the pelt and antlers', eff: { res: { food: 15, gold: 25 }, text: 'Good leather fetches good coin.' } },
    ],
  },
];

export const REGION_EVENT_BY_ID = Object.fromEntries(REGION_EVENTS.map((e) => [e.id, e]));
