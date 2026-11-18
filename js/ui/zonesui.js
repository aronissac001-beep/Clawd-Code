// Zones menu and the stockpile sheet (owner I; doc 5.6, 10.3). Preset first: a new stockpile is
// made from a preset ("All", "Raw", "Workshop goods", "Food store", "Armoury", "Dump"); the category
// tree (Customise) arrives with the full filters in Stage 2. Zone tools: New, Expand, Shrink, Delete.
// Commands: zone (new / expand / shrink / delete), zoneCfg (filter, priority) (C3).
import { h, onTap } from './kit.js';
import { def, all } from '../game/core/content.js';
import { card } from './architect.js';
import { presets } from './toolbar.js';

export const PRIORITIES = Object.freeze([['Low', 0], ['Normal', 1], ['Preferred', 2], ['Critical', 3]]);
const ZONE_TYPES = [
  { id: 'stockpile', label: 'Stockpile', icon: 'crate' },
  { id: 'grow', label: 'Grow', icon: 'farm', sub: 'Drag over grass: hearthroot', tool: { kind: 'zone', op: 'new', type: 'grow' } },
  { id: 'pen', label: 'Pen', icon: 'gate', locked: 'Comes with animals' },
  { id: 'burial', label: 'Burial', icon: 'skull', locked: 'Comes later' },
  { id: 'dump', label: 'Dump', icon: 'trash', locked: 'Comes later' },
  { id: 'home', label: 'Home area', icon: 'flame', locked: 'Comes with fire' },
  { id: 'area', label: 'Allowed area', icon: 'map', locked: 'Comes later' },
];

/** The preset a zone's filter matches (same category set), or null for a custom filter. */
export function presetOf(z) {
  if (!z || !z.filter) return null;
  const cats = [...z.filter.cats].sort().join(',');
  const p = presets().find((x) => [...x.cats].sort().join(',') === cats);
  return p ? p.id : null;
}

/** Zones panel: the zone types, then New / Expand / Shrink / Delete. state.pick: show the presets. */
export function zonesPanel(el, ctx, state) {
  if (state.pick) {
    el.append(h('p.ec-note', { text: 'Pick what the stockpile takes. You can change it later from its card.' }));
    const grid = h('div.ec-grid');
    for (const p of presets()) grid.append(card(p.name, p.id === 'store' ? 'food' : p.id === 'armoury' ? 'sword' : p.id === 'dump' ? 'trash' : p.id === 'raw' ? 'stone' : p.id === 'goods' ? 'hammer' : 'crate',
      { sub: p.text || '', act: 'preset-' + p.id, onPick: () => { state.pick = false; ctx.startTool({ kind: 'zone', op: 'new', preset: p.id }); } }));
    const back = h('button.ec-act.ec-wide', { type: 'button', 'data-act': 'zones-back', text: 'Back' });
    onTap(back, () => { state.pick = false; ctx.reopenPanel(); });
    el.append(grid, back);
    return;
  }
  const grid = h('div.ec-grid');
  for (const z of ZONE_TYPES) grid.append(card(z.label, z.icon, { sub: z.id === 'stockpile' ? 'Pick a preset, drag an area' : z.sub || null, locked: z.locked || null, act: 'zone-' + z.id, toast: ctx.toast,
    onPick: () => { if (z.tool) { ctx.startTool(z.tool); return; } state.pick = true; ctx.reopenPanel(); } }));
  const hasZones = ctx.s.zones.length > 0;
  const why = hasZones ? null : 'Make a zone first';
  grid.append(
    card('Expand', 'plus', { sub: 'Drag from a zone', locked: why, act: 'zone-expand', toast: ctx.toast, onPick: () => ctx.startTool({ kind: 'zone', op: 'expand' }) }),
    card('Shrink', 'minus', { sub: 'Drag over a zone', locked: why, act: 'zone-shrink', toast: ctx.toast, onPick: () => ctx.startTool({ kind: 'zone', op: 'shrink' }) }),
    card('Delete', 'trash', { sub: 'Tap a zone', locked: why, act: 'zone-delete', toast: ctx.toast, onPick: () => ctx.startTool({ kind: 'zone', op: 'delete' }) }),
  );
  el.append(grid);
}

/** The stockpile sheet: presets (preset first), priority, Customise (Stage 2), tiles. */
export function zoneSheet(el, ctx, z) {
  const cur = presetOf(z);
  let tiles = 0;
  for (let i = 0; i < ctx.s.L.zone.length; i++) if (ctx.s.L.zone[i] === z.id) tiles++;
  el.append(h('p.ec-note', { text: `${tiles} tiles. Haulers bring what the preset takes; higher priority fills first.` }));
  el.append(h('h3.ec-sub', { text: 'Preset' }));
  const grid = h('div.ec-grid');
  for (const p of presets()) {
    const b = card(p.name, p.id === cur ? 'check' : 'crate', { sub: p.text || '', act: 'set-preset-' + p.id, onPick: () => {
      ctx.send({ t: 'zoneCfg', zoneId: z.id, patch: { filter: { cats: p.cats.slice(), mats: [], q: [0, 6] }, pri: p.pri } }, `${z.name}: ${p.name}.`);
      ctx.refreshSheet();
    } });
    if (p.id === cur) b.classList.add('on');
    grid.append(b);
  }
  el.append(grid);
  el.append(h('h3.ec-sub', { text: 'Priority' }));
  const seg = h('div.ec-seg', { role: 'radiogroup', 'aria-label': 'Priority' });
  for (const [name, v] of PRIORITIES) {
    const b = h('button.ec-seg-b' + (z.pri === v ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': z.pri === v ? 'true' : 'false', 'data-act': 'pri-' + v, text: name });
    onTap(b, () => { ctx.send({ t: 'zoneCfg', zoneId: z.id, patch: { pri: v } }); ctx.refreshSheet(); });
    seg.append(b);
  }
  el.append(seg);
  el.append(card('Customise', 'gear', { locked: 'The full filter comes in a later update', toast: ctx.toast, act: 'zone-customise' }));
}

export const zoneLabel = (z) => {
  const p = presetOf(z);
  return `${p ? def('zonePreset', p).name : 'Custom'} · ${(PRIORITIES.find((x) => x[1] === z.pri) || ['Normal'])[0]}`;
};

