// Build menu, the Architect (owner I; doc 10.3, 10.11). A horizontally scrolling strip of
// icon-and-label tabs, each a 2-column grid of cards (3 in landscape): icon, name, cost line.
// Stage 1a tabs: Rooms (the stamps and the saved rooms), Structure, Furniture, Workshops, Light.
// Menus show what this build of the game offers (availableIn(def, '1a'), schema.js); a locked card
// stays visible, greyed, with its reason in one line. Tapping a card starts its tool (toolbar.js).
import { h, onTap, icon } from './kit.js';
import { all, structDef, hasFlag } from '../game/core/content.js';
import { availableIn } from '../data/schema.js';
import { costText } from '../game/tools/place.js';
import { stampDefs } from '../game/tools/stamp.js';

export const STAGE = '1a';
/** Build tabs (doc 10.3 order); each picks its defs. */
export const BUILD_TABS = Object.freeze([
  { id: 'rooms', label: 'Rooms', icon: 'rooms' },
  { id: 'structure', label: 'Structure', icon: 'wall', pick: (d) => d.cat === 'walls' },
  { id: 'furniture', label: 'Furniture', icon: 'bed', pick: (d) => d.kind === 'furniture' && ['housing', 'civic', 'storage'].includes(d.cat) },
  { id: 'workshops', label: 'Workshops', icon: 'hammer', pick: (d) => d.cat === 'workshops' },
  { id: 'light', label: 'Light', icon: 'flame', pick: (d) => hasFlag(d, 'light') && d.cat !== 'workshops' && !hasFlag(d, 'start') },
]);
/** Card icons by def id or flag (icons.js and kit.js glyphs). */
const DEF_ICON = { wall: 'wall', door: 'door', f_planks: 'floor', f_flag: 'floor', prop: 'prop', pillar: 'pillar', bed: 'bed', table: 'table', chair: 'chair',
  carpenter: 'saw', mason: 'hammer', sconce: 'flame', campfire: 'flame', brazier: 'brazier' };
const STAMP_ICON = { bedroom: 'bed', workshop: 'hammer', store: 'crate', plain: 'rooms', dorm: 'bed', dining: 'table', infirmary: 'heart', barracks: 'shield' };
export const defIcon = (d) => DEF_ICON[d.id] || (hasFlag(d, 'wall') ? 'wall' : d.kind === 'furniture' ? 'chair' : 'hammer');
const STAMP_TEXT = {
  bedroom: 'Walls, a door, floor and a bed.', workshop: 'Walls, a door, floor and a bench.', store: 'Walls, a door, floor and a stockpile.', plain: 'Walls, a door and floor.',
};

/** Defs on a Build tab, in data order (available in this build, never zones, designations or the Hearth). */
export function tabDefs(tab) {
  const t = BUILD_TABS.find((x) => x.id === tab);
  if (!t || !t.pick) return [];
  return all('structure').filter((d) => availableIn(d, STAGE) && d.kind !== 'zone' && d.kind !== 'designation' && !hasFlag(d, 'start') && t.pick(d));
}

/** Why a def is locked for this colony (tier), or null. Techs are not gated in Stage 1a. */
export function lockedWhy(s, d) {
  const tiers = all('tier');
  if (d.tier && tiers.length) {
    const need = tiers.findIndex((x) => x.id === d.tier);
    if (need > (s.colony.tier | 0)) return `Needs ${tiers[need].name}`;
  }
  return null;
}

/**
 * Fill the Build panel. ctx: { s, isLand(), startTool(spec), toast(text) }; state: { tab } (kept by
 * the shell between openings, so the last tab stays chosen).
 */
export function buildPanel(el, ctx, state) {
  const strip = h('div.ec-strip', { role: 'tablist', 'aria-label': 'Build categories' });
  const grid = h('div.ec-grid', { role: 'tabpanel' });
  const show = (id) => {
    state.tab = id;
    for (const b of strip.children) { const on = b.dataset.tab === id; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); }
    while (grid.firstChild) grid.removeChild(grid.firstChild);
    if (id === 'rooms') roomCards(grid, ctx);
    else for (const d of tabDefs(id)) grid.append(defCard(ctx, d));
    if (!grid.children.length) grid.append(h('p.ec-note', { text: 'Nothing here yet.' }));
  };
  for (const t of BUILD_TABS) {
    if (t.pick && !tabDefs(t.id).length) continue;
    const b = h('button.ec-strip-tab', { type: 'button', role: 'tab', 'data-tab': t.id, 'data-act': 'build-tab-' + t.id }, h('span', { html: icon(t.icon) }), h('span', { text: t.label }));
    onTap(b, () => show(t.id));
    strip.append(b);
  }
  el.append(strip, grid);
  show(state.tab || 'rooms');
}

export function card(label, ic, { sub = null, locked = null, act, onPick, toast } = {}) {
  const b = h('button.ec-card' + (locked ? '.locked' : ''), { type: 'button', 'data-act': act || 'card', 'aria-disabled': locked ? 'true' : null },
    h('span.ec-card-ic', { html: icon(ic) }), h('span.ec-card-n', { text: label }),
    locked ? h('span.ec-card-why', { text: locked }) : sub ? h('span.ec-card-sub', { text: sub }) : null);
  onTap(b, () => (locked ? toast && toast(`${label}: ${locked}`) : onPick && onPick()));
  return b;
}

function defCard(ctx, d) {
  const why = lockedWhy(ctx.s, d);
  return card(d.name, defIcon(d), { sub: costText(d), locked: why, act: 'build-' + d.id, toast: ctx.toast, onPick: () => ctx.startTool({ kind: 'place', def: d.id }) });
}

function roomCards(grid, ctx) {
  for (const sd of stampDefs()) {
    grid.append(card(sd.name, STAMP_ICON[sd.id] || 'rooms', { sub: STAMP_TEXT[sd.id] || 'A room stamp.', act: 'stamp-' + sd.id, toast: ctx.toast, onPick: () => ctx.startTool({ kind: 'stamp', stamp: sd.id }) }));
  }
  const tms = ctx.s.colony.templates;
  for (const tm of tms) {
    grid.append(card(tm.name, 'copy', { sub: `Copied room, ${tm.w} x ${tm.h}`, act: 'paste-' + tm.id, toast: ctx.toast, onPick: () => ctx.startTool({ kind: 'paste', templateId: tm.id }) }));
  }
  if (!tms.length) grid.append(h('p.ec-note.ec-span', { text: 'Copy a room from its card to paste it here.' }));
}

/** Orders menu (10.3): each is a tool. Stage 1a has Mine, Carve hall, Chop, Cancel, Deconstruct, Forbid. */
export const ORDERS = Object.freeze([
  { id: 'mine', label: 'Mine', icon: 'pick', tool: { kind: 'rect', id: 'mine' } },
  { id: 'carve', label: 'Carve hall', icon: 'carve', tool: { kind: 'carve' } },
  { id: 'chop', label: 'Chop', icon: 'axe', tool: { kind: 'rect', id: 'chop' } },
  { id: 'cancel', label: 'Cancel', icon: 'x', tool: { kind: 'rect', id: 'cancel' } },
  { id: 'deconstruct', label: 'Deconstruct', icon: 'trash', tool: { kind: 'rect', id: 'deconstruct' } },
  { id: 'forbid', label: 'Forbid / Allow', icon: 'lock', tool: { kind: 'rect', id: 'forbid' } },
  { id: 'harvest', label: 'Harvest', icon: 'farm', locked: 'Comes with farming' },
  { id: 'haul', label: 'Haul', icon: 'wood', locked: 'Haulers carry to stockpiles by themselves' },
  { id: 'hunt', label: 'Hunt', icon: 'sword', locked: 'Comes with animals' },
  { id: 'tame', label: 'Tame', icon: 'heart', locked: 'Comes with animals' },
  { id: 'smooth', label: 'Smooth', icon: 'stone', locked: 'Comes with stoneworking' },
  { id: 'engrave', label: 'Engrave', icon: 'hammer', locked: 'Comes with art' },
  { id: 'prospect', label: 'Prospect', icon: 'eye', locked: 'Comes with the survey table' },
]);
const ORDER_SUB = { mine: 'Drag over rock', carve: 'A hall with its pillars', chop: 'Drag over trees', cancel: 'Clear marks and plans', deconstruct: 'Take structures down', forbid: 'Keep items untouched' };
export function ordersPanel(el, ctx) {
  const grid = h('div.ec-grid');
  for (const o of ORDERS) grid.append(card(o.label, o.icon, { sub: ORDER_SUB[o.id], locked: o.locked || null, act: 'order-' + o.id, toast: ctx.toast, onPick: () => ctx.startTool(o.tool) }));
  el.append(grid);
}


