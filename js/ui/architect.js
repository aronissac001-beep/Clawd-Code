// Build menu, the Architect (owner I; doc 10.3, 10.11). A horizontally scrolling strip of
// icon-and-label tabs, each a 2-column grid of cards (3 in landscape): icon, name, cost line, tier badge.
// Tabs (10.3 order): Rooms (the stamps and the saved rooms), Structure, Housing, Storage, Farm,
// Workshops, Furniture, Defence, Light, Utility, Civic (Monuments and Charter arrive in Stage 3).
// Menus show what this build of the game offers (availableIn(def, STAGE), stage.js and schema.js); a
// card the colony cannot place yet stays visible, greyed, with its reason in one line ("Needs
// Smelting (research)", "Needs the Hamlet tier", K's research.lockedWhy). Tapping a card starts its
// tool (toolbar.js). Zones (stockpile, grow, pen, burial, dump) live in the Zones menu, not here.
import { h, onTap, icon } from './kit.js';
import { all, structDef, hasFlag, def } from '../game/core/content.js';
import { availableIn } from '../data/schema.js';
import { costText } from '../game/tools/place.js';
import { stampDefs } from '../game/tools/stamp.js';
import { lockedWhy as researchLocked } from '../game/colony/research.js';
import { defThumb } from './thumbs.js';

import { STAGE } from './stage.js';
export { STAGE };
const notZone = (d) => d.kind !== 'zone' && d.kind !== 'designation';
/** Build tabs (doc 10.3 order); each picks its defs. */
export const BUILD_TABS = Object.freeze([
  { id: 'rooms', label: 'Rooms', icon: 'rooms', help: 'A whole room in one drag: walls, a door, floor and its furniture. Copied rooms paste from here too.' },
  { id: 'structure', label: 'Structure', icon: 'wall', pick: (d) => d.cat === 'walls', help: 'Walls, doors, floors, roads and supports. Drag walls and floors; a roof needs support within 4 tiles.' },
  { id: 'housing', label: 'Housing', icon: 'bed', pick: (d) => d.cat === 'housing' && !hasFlag(d, 'light'), help: 'Beds and huts. A colonist with a bed in a good bedroom sleeps better.' },
  { id: 'storage', label: 'Storage', icon: 'crate', pick: (d) => d.cat === 'storage' && notZone(d), help: 'Shelves and racks hold several stacks per tile. A granary or an ice house keeps food longer.' },
  { id: 'farm', label: 'Farm', icon: 'farm', pick: (d) => d.cat === 'farming' && notZone(d), help: 'Fields, fences, coops and hunting stands. Paint grow zones and pens from Zones.' },
  { id: 'workshops', label: 'Workshops', icon: 'hammer', pick: (d) => d.cat === 'workshops', help: 'Benches make what their bills ask for. Each adds its default bills when built.' },
  { id: 'furniture', label: 'Furniture', icon: 'chair', pick: (d) => d.cat === 'civic' && d.kind === 'furniture', help: 'Tables, chairs, statues and banners: comfort and beauty for a room.' },
  { id: 'defence', label: 'Defence', icon: 'shield', pick: (d) => d.cat === 'defence' && !hasFlag(d, 'light'), help: 'Traps, towers, barricades and the ballista. Hostiles break walls; towers warn earlier.' },
  { id: 'light', label: 'Light', icon: 'flame', pick: (d) => hasFlag(d, 'light') && d.cat !== 'workshops' && !hasFlag(d, 'start'), help: 'The Hollow hate light. Sconces, braziers and lanterns keep dread away and cleanse blight.' },
  { id: 'utility', label: 'Utility', icon: 'gear', pick: (d) => d.cat === 'utility' && notZone(d) && !hasFlag(d, 'start') && !hasFlag(d, 'light'), help: 'Wells, graves, levers, plates and the Waystone. A lever locks the gates and deadfalls linked to it.' },
  { id: 'civic', label: 'Civic', icon: 'house', pick: (d) => d.cat === 'civic' && d.kind !== 'furniture' && notZone(d), help: 'Shrines, taverns, the trade post and the temple: joy, faith and trade.' },
]);
/** Card icons by def id or flag (icons.js and kit.js glyphs). */
const DEF_ICON = { wall: 'wall', door: 'door', f_planks: 'floor', f_flag: 'floor', f_brick: 'floor', f_carpet: 'floor', road: 'floor', bridge: 'floor', prop: 'prop', pillar: 'pillar', bed: 'bed', table: 'table', chair: 'chair',
  carpenter: 'saw', mason: 'hammer', sconce: 'flame', campfire: 'flame', brazier: 'brazier', lantern: 'flame', beacon: 'beacon', tower: 'tower', stonetower: 'tower', platform: 'tower',
  gate: 'gate', fencegate: 'gate', fence: 'gate', palisade: 'wall', rwall: 'wall', embrasure: 'wall', stonedoor: 'door', shelf: 'crate', granary: 'crate', barrelrack: 'crate', strongbox: 'lock',
  weaponrack: 'sword', icehouse: 'crate', farm: 'farm', planter: 'farm', mushbed: 'farm', scarecrow: 'farm', coop: 'farm', barn: 'house', trough: 'farm', beehive: 'farm', huntstand: 'eye', fisher: 'farm',
  grave: 'skull', crypt: 'skull', sarcophagus: 'skull', well: 'gear', lever: 'gear', plate: 'gear', waystone: 'relic', shrine: 'shrine', temple: 'shrine', tradepost: 'merchant', tavern: 'house', dicetable: 'dice',
  stage: 'banner', banner: 'banner', statue: 'relic', bigstatue: 'relic', tapestry: 'banner', infirmary: 'heart', surgery: 'heart', memorial: 'relic', observatory: 'eye', arena: 'sword',
  hut: 'house', longhouse: 'house', stonehouse: 'house', barracks: 'barracks', spiketrap: 'trap', deadfall: 'trap', emberpit: 'flame', ballista: 'tower', barricade: 'wall', alarmbell: 'alert', wardstone: 'relic',
  study: 'book', scriptorium: 'book', trainingyard: 'sword', quarry: 'quarry', woodyard: 'lumber', bellows: 'flame', headframe: 'pick', waterwheel: 'gear', hearthfire: 'flame' };
const STAMP_ICON = { bedroom: 'bed', workshop: 'hammer', store: 'crate', plain: 'rooms', dorm: 'bed', dining: 'table', infirmary: 'heart', barracks: 'shield', kitchen: 'flame',
  storeroom: 'crate', foodstore: 'food', cellar: 'crate', shrine: 'shrine' };
export const defIcon = (d) => { const ic = DEF_ICON[d.id] || (hasFlag(d, 'wall') ? 'wall' : hasFlag(d, 'trap') ? 'skull' : d.kind === 'furniture' ? 'chair' : 'hammer'); return ic === 'trap' ? 'skull' : ic; };
const STAMP_TEXT = {
  bedroom: 'Walls, a door, floor and a bed.', workshop: 'Walls, a door, floor and a bench.', store: 'Walls, a door, floor and a stockpile.', plain: 'Walls, a door and floor.',
  dining: 'Tables and chairs for its size.', kitchen: 'A campfire to cook on.', barracks: 'A bunk per 8 tiles.', storeroom: 'A stockpile and shelves.', foodstore: 'A food stockpile.',
  infirmary: 'Infirmary beds for the hurt.', cellar: 'Casks; best underground.', shrine: 'A shrine for faith.',
};

/** Defs on a Build tab, in data order (available in this build, never zones, designations or the Hearth). */
export function tabDefs(tab) {
  const t = BUILD_TABS.find((x) => x.id === tab);
  if (!t || !t.pick) return [];
  return all('structure').filter((d) => availableIn(d, STAGE) && d.kind !== 'zone' && d.kind !== 'designation' && !hasFlag(d, 'start') && t.pick(d));
}

/**
 * Why a def is locked for this colony, or null: the tier first, then the research (K's gates; the
 * place command refuses the same defs). Short and capitalised for the card line.
 */
export function lockedWhy(s, d) {
  const tiers = all('tier');
  if (d.tier && tiers.length) {
    const need = tiers.findIndex((x) => x.id === d.tier);
    if (need > (s.colony.tier | 0)) return `Needs ${tiers[need].name}`;
  }
  if (STAGE !== '1a' && STAGE !== '1b' && d.tech) {
    const why = researchLocked(s, d);
    if (why) { const t = def('tech', d.tech); return `Needs ${t ? t.name : d.tech} (research)`; }
  }
  return null;
}
/** The tier badge of a def ("Hamlet") when it is above Camp. */
const tierBadge = (d) => { if (!d.tier || d.tier === 'camp') return null; const t = def('tier', d.tier); return t ? t.name : null; };

/**
 * Fill the Build panel. ctx: { s, isLand(), startTool(spec), toast(text) }; state: { tab } (kept by
 * the shell between openings, so the last tab stays chosen).
 */
export function buildPanel(el, ctx, state) {
  const strip = h('div.ec-strip.ec-bstrip', { role: 'tablist', 'aria-label': 'Build categories' });
  const grid = h('div.ec-grid.ec-bgrid', { role: 'tabpanel' });
  const show = (id) => {
    state.tab = id;
    for (const b of strip.children) { const on = b.dataset.tab === id; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); }
    while (grid.firstChild) grid.removeChild(grid.firstChild);
    const t = BUILD_TABS.find((x) => x.id === id);
    if (t && t.help) grid.append(h('p.ec-note.ec-span.ec-help-line', { text: t.help }));
    if (id === 'rooms') roomCards(grid, ctx);
    else {
      // cards the colony can place first, then the locked ones (greyed, with their reason)
      const defs = tabDefs(id), open = [], shut = [];
      for (const d of defs) (lockedWhy(ctx.s, d) ? shut : open).push(d);
      for (const d of open.concat(shut)) grid.append(defCard(ctx, d));
    }
    if (!grid.children.length) grid.append(h('p.ec-note', { text: 'Nothing here yet.' }));
  };
  for (const t of BUILD_TABS) {
    if (t.pick && !tabDefs(t.id).length) continue;
    const b = h('button.ec-strip-tab', { type: 'button', role: 'tab', 'data-tab': t.id, 'data-act': 'build-tab-' + t.id }, h('span', { html: icon(t.icon) }), h('span', { text: t.label }));
    onTap(b, () => { show(t.id); if (b.scrollIntoView) b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
    strip.append(b);
  }
  el.append(strip, grid);
  show(state.tab || 'rooms');
}

export function card(label, ic, { sub = null, locked = null, act, onPick, toast, badge = null, thumb = undefined } = {}) {
  // build cards (thumb given, even null) show the item's pixel art in a well, its cost and a lock badge
  const art = thumb !== undefined;
  const pic = art ? h('span.ec-card-ic.ec-bcard-art', thumb ? null : { html: icon(ic) }, thumb || null) : h('span.ec-card-ic', { html: icon(ic) });
  if (art && locked) pic.append(h('span.ec-bcard-lock', { html: icon('lock') }));
  const b = h('button.ec-card' + (art ? '.ec-bcard' : '') + (locked ? '.locked' : ''), { type: 'button', 'data-act': act || 'card', 'aria-disabled': locked ? 'true' : null },
    pic, h('span.ec-card-n', null, label, badge ? h('span.ec-tier', { text: badge }) : null),
    locked ? h('span.ec-card-why', { text: locked }) : sub ? h('span.ec-card-sub', { text: sub }) : null);
  onTap(b, () => (locked ? toast && toast(`${label}: ${locked}`) : onPick && onPick()));
  return b;
}

function defCard(ctx, d) {
  const why = lockedWhy(ctx.s, d);
  return card(d.name, defIcon(d), { thumb: defThumb(d), sub: costText(d), locked: why, badge: tierBadge(d), act: 'build-' + d.id, toast: ctx.toast, onPick: () => ctx.startTool({ kind: 'place', def: d.id }) });
}

function roomCards(grid, ctx) {
  for (const sd of stampDefs()) {
    if (sd.stage && !availableIn(sd, STAGE)) continue;
    // a stamp whose own furniture is still locked (the Infirmary's beds need Hamlet) is locked with
    // its reason (X 2.7 play-test: it built an empty "Hall" with no word why)
    let locked = null;
    for (const f of sd.furnish || []) { const fd = def('structure', f.def); if (fd && fd.kind !== 'zone' && (locked = lockedWhy(ctx.s, fd))) break; }
    const main = (sd.furnish || []).map((f) => def('structure', f.def)).find((fd) => fd && fd.kind !== 'zone');
    grid.append(card(sd.name, STAMP_ICON[sd.id] || 'rooms', { thumb: main ? defThumb(main) : null, sub: STAMP_TEXT[sd.id] || 'A room stamp.', locked, act: 'stamp-' + sd.id, toast: ctx.toast, onPick: () => ctx.startTool({ kind: 'stamp', stamp: sd.id }) }));
  }
  const tms = ctx.s.colony.templates;
  for (const tm of tms) {
    grid.append(card(tm.name, 'copy', { thumb: null, sub: `Copied room, ${tm.w} x ${tm.h}`, act: 'paste-' + tm.id, toast: ctx.toast, onPick: () => ctx.startTool({ kind: 'paste', templateId: tm.id }) }));
  }
  if (!tms.length) grid.append(h('p.ec-note.ec-span', { text: 'Copy a room from its card to paste it here.' }));
}

/** Orders menu (10.3): each is a tool. */
export const ORDERS = Object.freeze([
  { id: 'mine', label: 'Mine', icon: 'pick', tool: { kind: 'rect', id: 'mine' } },
  { id: 'carve', label: 'Carve hall', icon: 'carve', tool: { kind: 'carve' } },
  { id: 'chop', label: 'Chop', icon: 'axe', tool: { kind: 'rect', id: 'chop' } },
  { id: 'harvest', label: 'Harvest', icon: 'farm', tool: { kind: 'rect', id: 'harvest' }, stage: '2' },
  { id: 'haul', label: 'Haul', icon: 'wood', tool: { kind: 'pick', id: 'haul' } },
  { id: 'hunt', label: 'Hunt', icon: 'sword', tool: { kind: 'pick', id: 'hunt' }, stage: '2' },
  { id: 'tame', label: 'Tame', icon: 'heart', tool: { kind: 'pick', id: 'tame' }, stage: '2' },
  { id: 'smooth', label: 'Smooth', icon: 'stone', tool: { kind: 'rect', id: 'smooth' }, stage: '2' },
  { id: 'engrave', label: 'Engrave', icon: 'hammer', locked: 'Comes with the sculptor (Stage 3)' },
  { id: 'prospect', label: 'Prospect', icon: 'eye', locked: 'Comes with the survey table (Stage 3)' },
  { id: 'deconstruct', label: 'Deconstruct', icon: 'trash', tool: { kind: 'rect', id: 'deconstruct' } },
  { id: 'forbid', label: 'Forbid / Allow', icon: 'lock', tool: { kind: 'rect', id: 'forbid' } },
  { id: 'cancel', label: 'Cancel', icon: 'x', tool: { kind: 'rect', id: 'cancel' } },
]);
/** Stage Z1 (EMBERCROWN-FORTRESS.md 4.4): the level orders, next to Mine and Carve hall on a map with levels. */
export const LEVEL_ORDERS = Object.freeze([
  { id: 'stairs', label: 'Stairs', icon: 'up', tool: { kind: 'vert', id: 'stairs' } },
  { id: 'ramp', label: 'Ramp', icon: 'region', tool: { kind: 'vert', id: 'ramp' } },
  { id: 'channel', label: 'Channel', icon: 'pick', tool: { kind: 'vert', id: 'channel' } },
]);
/** The Orders list for this colony: with levels, Stairs beside Mine (first row, both orientations), then Carve hall, Channel, Ramp. */
export const ordersFor = (deep) => (deep ? [ORDERS[0], LEVEL_ORDERS[0], ORDERS[1], LEVEL_ORDERS[2], LEVEL_ORDERS[1], ...ORDERS.slice(2)] : ORDERS);
const ORDER_SUB = { stairs: 'Tap: a stair down or up', ramp: 'Joins a level to the one above', channel: 'Opens a floor to below', mine: 'Drag over rock', carve: 'A hall with its pillars', chop: 'Drag over trees', harvest: 'Ripe crops and wild plants', haul: 'Tap a stack: carried next',
  hunt: 'Tap an animal: meat and hide', tame: 'Tap an animal: into a pen', smooth: 'Smooth stone walls and floors', cancel: 'Clear marks and plans',
  deconstruct: 'Take structures down', forbid: 'Keep items untouched' };
const ORDER_LATER = { harvest: 'Comes with farming', hunt: 'Comes with animals', tame: 'Comes with animals', smooth: 'Comes with stoneworking' };
export function ordersPanel(el, ctx) {
  const grid = h('div.ec-grid');
  grid.append(h('p.ec-note.ec-span.ec-help-line', { text: 'Orders mark work: colonists whose roles cover it do it. Long-press then drag removes marks.' }));
  // Recent (4.4 tap budgets): the last Orders tool, with its settings (long-press Orders opens it too)
  const rec = ctx.ui && ctx.ui.recentOrder ? ordersFor(!!ctx.deep).find((o) => o.tool && o.tool.kind === ctx.ui.recentOrder.kind && o.tool.id === ctx.ui.recentOrder.id) : null;
  if (rec) grid.append(card(`Again: ${rec.label}`, rec.icon, { sub: 'The last order', act: 'order-recent', toast: ctx.toast, onPick: () => ctx.startTool(ctx.ui.recentOrder) }));
  for (const o of ordersFor(!!ctx.deep)) {
    const later = o.stage && !availableIn(o, STAGE) ? ORDER_LATER[o.id] || 'Comes later' : null;
    grid.append(card(o.label, o.icon, { sub: ORDER_SUB[o.id], locked: o.locked || later, act: 'order-' + o.id, toast: ctx.toast, onPick: () => ctx.startTool(o.tool) }));
  }
  el.append(grid);
}
