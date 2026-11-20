// Help (owner I; doc 10.9 "Every panel has a '?'", Menu > Help). Short cards for the core mechanics
// and the Stage 2 systems, and the 2-3 line explanation behind each panel's "?" button.
import { h, onTap } from './kit.js';

/** Menu > Help: the cards, in reading order (the hooks of section 1 first). */
export const HELP_CARDS = Object.freeze([
  ['The hold', 'Dig into the mountain, build rooms, keep the Hearth burning. Every night something may come for the light. Grow the hold from Camp to Village.'],
  ['Roles', 'Each colonist has a role (Miner, Builder, Crafter, Hauler, Cook, Grower, Smith, Doctor, Soldier, Herder, Scholar, Artisan, Generalist) that sets what they do first. Tap a role chip to change it; Colony > Work has the grid.'],
  ['Digging and support', 'Drag Mine over rock. A roof needs support within 4 tiles: rock, a wall, a pillar or a prop. An unsupported roof rumbles, then falls. Carve hall plans the pillars for you.'],
  ['Rooms and stamps', 'Build > Rooms: drag a rectangle and a whole room is planned. A room\'s role (bedroom, dining hall, workshop...) comes from what is inside; its tier (Squalid to Majestic) from wealth, beauty, space and light. Fine rooms lift mood.'],
  ['Stockpiles and filters', 'Zones > Stockpile: pick a preset and drag an area. Customise on its card sets which categories and qualities it takes. Shelves hold several stacks per tile.'],
  ['Bills', 'Workbenches make what their bills ask for: count, until N in stock, or forever. Open a bench to add, pause or reorder bills.'],
  ['Food and farming', 'Grow zones sow the crop you pick; growers harvest when ripe. Cook raw food into meals, brew ale, smoke and pickle for winter. Food lasts longer cold.'],
  ['Seasons and weather', 'Thaw, Highsun, Ashfall and Deepcold, 10 days each. Crops stop in the cold; water freezes in Deepcold. Rain puts fires out; drought spreads them; a cold snap freezes the unprepared.'],
  ['Fire', 'Wood, plants and wooden floors burn; stone does not. Colonists fight fires in the home area (Zones > Home area). Keep fires and braziers away from timber.'],
  ['Health', 'Doctors (Care) tend wounds; an untended cut infects after 12 hours. Beds and an infirmary heal faster. The Grey Taint from Hollow blows is drawn out by bed rest near the Hearth.'],
  ['Needs and mood', 'Food, rest, joy, warmth and light. Thoughts add up to mood; low mood means breaks. Joy hours (Colony > Schedule), good meals and fine rooms keep it up.'],
  ['Research', 'Scholars at a study earn lore. Colony > Research: pick a tech; finding things (ore, a tamed animal) can make a tech cheaper. New eras open with the hold\'s tier.'],
  ['Animals', 'Orders > Tame on a wild animal: it goes to a pen (Zones > Pen) with room. Pens breed; hens lay, goats milk, sheep give wool. Orders > Hunt for meat. Boars and wolves fight back.'],
  ['Trade and factions', 'Traders visit every few days and stay one. The trade sheet buys and sells for coins. Every trade raises goodwill with their faction, which lowers prices.'],
  ['Light and the Hollow', 'An omen warns of each raid: the chip at the top counts down. The Hollow hate light: braziers and the Hearth burn them. Draft everyone at dusk and hold by the fire.'],
  ['Raids and nemeses', 'Reavers, thieves, beasts and the Hollow come for wealth, food or the light. A raid leader who escapes becomes a nemesis: it remembers who wounded it, and comes back stronger.'],
  ['The Ember-touched', 'Sometimes a crafter is seized by the Ember and demands rare materials. Bring them all to the stores in time and they make a named masterwork; fail and they break.'],
  ['Letters', 'Visitors, refugees and captives arrive as letters with choices. Unanswered, a letter takes its default. Menu > Letters keeps them.'],
  ['Speed', 'Tap the speed button to pause. Hold it for 1x, 2x, 3x and 5x. 5x waits while hostiles are on the map or anyone is drafted.'],
]);

/** The "?" text of each panel and sheet. */
export const PANEL_HELP = Object.freeze({
  Build: 'Pick a card and place it: drag walls and floors, tap furniture. Greyed cards need a tier or a tech first: the line says which. Builders bring the materials.',
  Orders: 'Orders mark work for colonists whose roles cover it. Long-press, then drag, removes marks. Haul, Hunt and Tame take a tap on the target.',
  Zones: 'Zones tell colonists where things go. Stockpiles take what their filter allows; grow zones sow one crop; pens hold tamed animals.',
  Colony: 'The whole hold: people and roles, the work grid, schedules, research, stock, the Chronicle and how far the hold has come.',
  Menu: 'Save, back up to a file, letters, settings and help. Saves happen by themselves every minute and when you leave.',
  Letters: 'Letters with choices wait here until answered; news of the session stays below them.',
  Settings: 'Text size, motion, colours, auto-pause and layout. Settings are for this device, not the colony.',
});

/** A "?" button that shows the panel's help as a toast (2-3 lines). */
export function helpButton(ctx, key) {
  const text = PANEL_HELP[key];
  if (!text) return null;
  const b = h('button.ec-ibtn.ec-help', { type: 'button', 'data-act': 'help-' + key.toLowerCase(), 'aria-label': `About ${key}`, text: '?' });
  onTap(b, () => ctx.toast(text));
  return b;
}

/** Menu > Help: the cards. */
export function openHelp(ctx) {
  ctx.openSheet('Help', (el) => {
    for (const [t, x] of HELP_CARDS) el.append(h('section.ec-bio.ec-helpcard', null, h('h3.ec-sub', { text: t }), h('p.ec-bio-d', { text: x })));
    el.append(h('p.ec-note', { text: 'Every panel has a ? button with a short note.' }));
  }, { back: true });
}
