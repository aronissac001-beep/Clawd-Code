// Zones menu and the zone sheets (owner I; doc 5.6, 10.3). Preset first: a new stockpile is made
// from a preset ("All", "Raw", "Workshop goods", "Food store", "Armoury", "Dump", "Medicine",
// "Valuables"); Customise opens the category tree (E's full filters, Stage 2) and the quality range.
// Zone types (10.3): Stockpile, Grow (with the crop to sow), Pen (K's animals: tamed animals live
// in it), Dump, Home area (where colonists fight fires), Burial and Allowed area (their systems are
// not in the sim yet: locked with the reason). Zone tools: New, Expand, Shrink, Delete.
// Commands: zone (new / expand / shrink / delete), zoneCfg (filter, priority, crop, name) (C3).
import { h, onTap } from './kit.js';
import { def, all } from '../game/core/content.js';
import { availableIn } from '../data/schema.js';
import { penRoom } from '../game/animals/pens.js';
import { card } from './architect.js';
import { presets } from './toolbar.js';
import { STAGE } from './stage.js';

export const PRIORITIES = Object.freeze([['Low', 0], ['Normal', 1], ['Preferred', 2], ['Critical', 3]]);
const S2 = STAGE !== '1a' && STAGE !== '1b';
const ZONE_TYPES = [
  { id: 'stockpile', label: 'Stockpile', icon: 'crate', sub: 'Pick a preset, drag an area' },
  { id: 'grow', label: 'Grow', icon: 'farm', sub: 'Drag over soil: pick the crop', tool: { kind: 'zone', op: 'new', type: 'grow' } },
  { id: 'pen', label: 'Pen', icon: 'gate', sub: 'Tamed animals live here', tool: { kind: 'zone', op: 'new', type: 'pen' }, stage2: true },
  { id: 'dump', label: 'Dump', icon: 'trash', sub: 'Chunks and corpses go here', tool: { kind: 'zone', op: 'new', type: 'dump', preset: 'dump' }, stage2: true },
  { id: 'home', label: 'Home area', icon: 'flame', sub: 'Colonists fight fires here', tool: { kind: 'zone', op: 'new', type: 'home' }, stage2: true },
  { id: 'burial', label: 'Burial', icon: 'skull', locked: 'Build graves (Build > Utility)' },
  { id: 'area', label: 'Allowed area', icon: 'map', locked: 'Comes in a later update' },
];
const ZONE_WORD = { stockpile: 'Stockpile', grow: 'Grow zone', pen: 'Pen', dump: 'Dump', home: 'Home area', burial: 'Burial', area: 'Allowed area' };

/** Crops a grow zone can sow (plants with `sow`), data order. */
export const crops = () => all('plant').filter((p) => p.sow);
export const cropName = (id) => (def('plant', id) || { name: 'Hearthroot' }).name;

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
    for (const p of presets()) grid.append(card(p.name, presetIcon(p.id), { sub: p.text || '', act: 'preset-' + p.id, onPick: () => { state.pick = false; ctx.startTool({ kind: 'zone', op: 'new', preset: p.id }); } }));
    const back = h('button.ec-act.ec-wide', { type: 'button', 'data-act': 'zones-back', text: 'Back' });
    onTap(back, () => { state.pick = false; ctx.reopenPanel(); });
    el.append(grid, back);
    return;
  }
  const grid = h('div.ec-grid');
  grid.append(h('p.ec-note.ec-span.ec-help-line', { text: 'Zones tell colonists where things go: stockpiles, fields, pens. Tap a zone on the map for its settings.' }));
  for (const z of ZONE_TYPES) {
    const locked = z.locked || (z.stage2 && !S2 ? 'Comes in a later update' : null);
    grid.append(card(z.label, z.icon, { sub: z.sub || null, locked, act: 'zone-' + z.id, toast: ctx.toast,
      onPick: () => { if (z.tool) { ctx.startTool(z.tool); return; } state.pick = true; ctx.reopenPanel(); } }));
  }
  const hasZones = ctx.s.zones.length > 0;
  const why = hasZones ? null : 'Make a zone first';
  grid.append(
    card('Expand', 'plus', { sub: 'Drag from a zone', locked: why, act: 'zone-expand', toast: ctx.toast, onPick: () => ctx.startTool({ kind: 'zone', op: 'expand' }) }),
    card('Shrink', 'minus', { sub: 'Drag over a zone', locked: why, act: 'zone-shrink', toast: ctx.toast, onPick: () => ctx.startTool({ kind: 'zone', op: 'shrink' }) }),
    card('Delete', 'trash', { sub: 'Tap a zone', locked: why, act: 'zone-delete', toast: ctx.toast, onPick: () => ctx.startTool({ kind: 'zone', op: 'delete' }) }),
  );
  el.append(grid);
}
const presetIcon = (id) => (id === 'store' ? 'food' : id === 'armoury' ? 'sword' : id === 'dump' ? 'trash' : id === 'raw' ? 'stone' : id === 'goods' ? 'hammer' : id === 'medicine' ? 'heart' : id === 'valuables' ? 'gold' : 'crate');

function tileCount(s, z) { let n = 0; for (let i = 0; i < s.L.zone.length; i++) if (s.L.zone[i] === z.id) n++; return n; }

/** The sheet of a zone: by type. ui: { custom } (kept between refreshes). */
export function zoneSheet(el, ctx, z, ui = {}) {
  const s = ctx.s, tiles = tileCount(s, z);
  if (z.type === 'grow') return growSheet(el, ctx, z, tiles);
  if (z.type === 'pen') return penSheet(el, ctx, z, tiles);
  if (z.type === 'home') { el.append(h('p.ec-note', { text: `${tiles} tiles. Colonists put out fires inside the home area first. Without one, the claimed land counts.` })); return; }
  const cur = presetOf(z);
  el.append(h('p.ec-note', { text: `${tiles} tiles. Haulers bring what it takes; higher priority fills first.` }));
  el.append(h('h3.ec-sub', { text: 'Preset' }));
  const grid = h('div.ec-grid');
  for (const p of presets()) {
    const b = card(p.name, p.id === cur ? 'check' : presetIcon(p.id), { sub: p.text || '', act: 'set-preset-' + p.id, onPick: () => {
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
  if (!S2) { el.append(card('Customise', 'gear', { locked: 'The full filter comes in a later update', toast: ctx.toast, act: 'zone-customise' })); return; }
  el.append(h('h3.ec-sub', { text: cur ? 'Customise' : 'Customise (custom filter)' }));
  filterTree(el, ctx, z);
}

/**
 * The category tree (E's full filter, 5.6): top categories with their children; a tap toggles the
 * category (a parent toggles all its children). Then the quality range.
 */
function filterTree(el, ctx, z) {
  const cats = all('itemCat');
  const tops = cats.filter((c) => !c.parent);
  const on = new Set(z.filter.cats);
  const has = (c) => on.has(c.id) || (c.parent && on.has(c.parent));
  const send = (next) => { ctx.send({ t: 'zoneCfg', zoneId: z.id, patch: { filter: { cats: [...next].sort(), mats: (z.filter.mats || []).slice(), q: z.filter.q.slice() } } }); ctx.refreshSheet(); };
  const tree = h('div.ec-tree', { role: 'list' });
  for (const t of tops) {
    const kids = cats.filter((c) => c.parent === t.id);
    const all1 = on.has(t.id) || (kids.length && kids.every((k) => on.has(k.id)));
    const some = !all1 && kids.some((k) => on.has(k.id));
    const row = h('button.ec-row.ec-toggle.ec-tree-top', { type: 'button', role: 'switch', 'aria-checked': all1 ? 'true' : 'false', 'data-act': 'cat-' + t.id },
      h('span.ec-row-n', { text: t.name }), h('span.ec-row-s', { text: all1 ? 'All' : some ? 'Some' : 'None' }));
    onTap(row, () => {
      const next = new Set(on);
      if (all1) { next.delete(t.id); for (const k of kids) next.delete(k.id); } else { next.add(t.id); for (const k of kids) next.delete(k.id); }
      send(next);
    });
    tree.append(row);
    if (kids.length && (some || all1 || on.has(t.id) === false)) {
      const chips = h('div.ec-chipset');
      for (const k of kids) {
        const kon = has(k);
        const c = h('button.ec-tchip' + (kon ? '.on' : ''), { type: 'button', 'aria-pressed': kon ? 'true' : 'false', 'data-act': 'cat-' + k.id, text: k.name });
        onTap(c, () => {
          const next = new Set(on);
          if (on.has(t.id)) { next.delete(t.id); for (const o of kids) if (o.id !== k.id) next.add(o.id); }
          else if (kon) next.delete(k.id); else next.add(k.id);
          send(next);
        });
        chips.append(c);
      }
      tree.append(chips);
    }
  }
  el.append(tree);
  const Q = ['Awful', 'Poor', 'Normal', 'Good', 'Excellent', 'Masterwork', 'Legendary'];
  const [q0, q1] = z.filter.q;
  const qrow = (label, act, v, fn, lo, hi) => {
    const minus = h('button.ec-ibtn.ec-mini', { type: 'button', 'data-act': act + '-minus', 'aria-label': label + ' lower', text: '-', disabled: v <= lo });
    const plus = h('button.ec-ibtn.ec-mini', { type: 'button', 'data-act': act + '-plus', 'aria-label': label + ' higher', text: '+', disabled: v >= hi });
    onTap(minus, () => fn(v - 1)); onTap(plus, () => fn(v + 1));
    return h('div.ec-bill-line', null, h('span', { text: `${label}: ${Q[v] || v}` }), minus, plus);
  };
  const setQ = (a, b) => { ctx.send({ t: 'zoneCfg', zoneId: z.id, patch: { filter: { cats: z.filter.cats.slice(), mats: (z.filter.mats || []).slice(), q: [a, b] } } }); ctx.refreshSheet(); };
  el.append(h('h3.ec-sub', { text: 'Quality' }), qrow('From', 'q0', q0, (v) => setQ(v, q1), 0, q1), qrow('To', 'q1', q1, (v) => setQ(q0, v), q0, 6));
}

function growSheet(el, ctx, z, tiles) {
  const cur = z.crop || 'hearthroot';
  el.append(h('p.ec-note', { text: `${tiles} tiles. Growers sow, tend and harvest the crop. Growth stops below its least warmth and in the dark (glowcaps grow under the mountain).` }));
  el.append(h('h3.ec-sub', { text: 'Crop' }));
  const grid = h('div.ec-grid');
  for (const p of crops()) {
    const b = card(p.name, p.id === cur ? 'check' : 'farm', { sub: `${p.days} days${p.minTemp ? `, ${p.minTemp} C+` : ''}${p.underground ? ', underground' : ''}`, act: 'crop-' + p.id, onPick: () => {
      ctx.send({ t: 'zoneCfg', zoneId: z.id, patch: { crop: p.id } }, `${z.name}: ${p.name}.`);
      ctx.refreshSheet();
    } });
    if (p.id === cur) b.classList.add('on');
    grid.append(b);
  }
  el.append(grid);
}

function penSheet(el, ctx, z, tiles) {
  const s = ctx.s;
  let room = null;
  try { room = penRoom(s, z.id); } catch (_) { room = null; }
  const inPen = s.anim.filter((a) => a.pen === z.id);
  el.append(h('p.ec-note', { text: `${tiles} tiles${room ? `, room for ${room.cap} (${room.used} used)` : ''}. Handlers tame farm animals near the Hearth while a pen has room; fence it so they stay in.` }));
  el.append(h('h3.ec-sub', { text: inPen.length ? 'Animals' : 'No animals yet' }));
  for (const a of inPen) {
    const d = def('animal', a.kind) || { name: a.kind };
    const row = h('button.ec-row', { type: 'button', 'data-act': 'pen-animal' }, h('span.ec-row-n', { text: a.name || d.name }), h('span.ec-row-s', { text: d.name }));
    onTap(row, () => { ctx.closeSheet(); ctx.centerOn(a.x, a.y); ctx.select({ kind: 'animal', id: a.id }); });
    el.append(row);
  }
}

export const zoneLabel = (z) => {
  if (z.type === 'grow') return `Grow zone · ${cropName(z.crop || 'hearthroot')}`;
  if (z.type === 'pen' || z.type === 'home') return ZONE_WORD[z.type];
  const p = presetOf(z);
  return `${p ? def('zonePreset', p).name : 'Custom'} · ${(PRIORITIES.find((x) => x[1] === z.pri) || ['Normal'])[0]}`;
};
export const zoneWord = (type) => ZONE_WORD[type] || 'Zone';
void availableIn;
