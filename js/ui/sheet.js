// Full sheets (owner I; doc 10.1 "Full sheet", 10.3, 10.5, 10.8). A second tap on the same
// subject, or dragging its peek card up, opens its sheet at 75% height (the world above stays live);
// drag to 92% or down to close. Subjects: colonist (colonistui.js), building (bills, billsui.js),
// zone (stockpile presets, zonesui.js), item and tile (details). The Colony sheet (People, Work,
// Stock; the rest arrive later) and the Menu (Save now, Back up, Help, Quit) live here too.
import { h, onTap, icon } from './kit.js';
import { def, structDef } from '../game/core/content.js';
import { TER_NAMES } from '../game/core/grid.js';
import { colonistHeader, colonistTab, COLONIST_TABS } from './colonistui.js';
import { billsTab, benchRecipes } from './billsui.js';
import { zoneSheet } from './zonesui.js';
import { peopleList } from './rolesui.js';
import { buildingStatus } from './peek.js';
import { openMoveToApp } from './cards.js';

/** Open the sheet of a selection. tab: the tab to show first (colonists, workbenches). */
export function openSubjectSheet(ctx, sel, tab = null) {
  const s = ctx.s;
  if (!sel) return;
  if (sel.kind === 'colonist') {
    const c = s.col.find((x) => x.id === sel.id);
    if (!c) return;
    const nav = (dir) => {
      const k = s.col.indexOf(c), n = s.col[(k + dir + s.col.length) % s.col.length];
      ctx.select({ kind: 'colonist', id: n.id }, false, true);
      openSubjectSheet(ctx, { kind: 'colonist', id: n.id }, ctx.sheetTab());
    };
    ctx.openSheet(c.name, (el, t) => colonistTab(el, ctx, c, t), { tabs: COLONIST_TABS, tab: tab || 'Needs', head: () => colonistHeader(ctx, c, nav), subject: sel });
    return;
  }
  if (sel.kind === 'building') {
    const b = s.bld[sel.id];
    if (!b) return;
    const d = structDef(b.def) || { name: b.def };
    const ui = { more: new Set() };
    const bench = !!(d.workbench && benchRecipes(b).length);
    ctx.openSheet(d.name, (el, t) => (t === 'Bills' ? billsTab(el, ctx, b, ui) : buildingInfo(el, ctx, b, d)), { tabs: bench ? ['Bills', 'Info'] : null, tab: tab || (bench ? 'Bills' : null), subject: sel });
    return;
  }
  if (sel.kind === 'zone') {
    const z = s.zones.find((x) => x.id === sel.id);
    if (!z) return;
    ctx.openSheet(z.name, (el) => zoneSheet(el, ctx, z), { subject: sel });
    return;
  }
  if (sel.kind === 'item') {
    const it = s.items[sel.id];
    if (!it) return;
    const d = def('item', it.k) || { name: it.k };
    ctx.openSheet(d.name, (el) => { el.append(h('p.ec-note', { text: `${it.n} in this stack${it.m ? ', ' + (def('material', it.m) || { name: it.m }).name : ''}. ${d.text || ''}` })); }, { subject: sel });
    return;
  }
  const t = s.L.terrain[sel.tile];
  ctx.openSheet(TER_NAMES[t], (el) => { el.append(h('p.ec-note', { text: `Tile ${sel.x}, ${sel.y}.` })); }, { subject: sel });
}

function buildingInfo(el, ctx, b, d) {
  const rows = [['Status', buildingStatus(ctx.s, b)]];
  if (b.mat) rows.push(['Material', (def('material', b.mat) || { name: b.mat }).name]);
  if (d.size) rows.push(['Size', `${d.size[0]} x ${d.size[1]}`]);
  if (b.hp !== undefined && d.hp) rows.push(['Condition', `${Math.round((b.hp / d.hp) * 100)}%`]);
  const dl = h('div.ec-facts');
  for (const [k, v] of rows) dl.append(h('div.ec-fact', null, h('span', { text: k }), h('b', { text: v })));
  el.append(dl);
  if (d.text) el.append(h('p.ec-note', { text: d.text }));
}

export const COLONY_TABS = Object.freeze(['People', 'Work', 'Stock', 'Schedule', 'Research', 'Chronicle', 'Hold']);
const COLONY_LATER = { Schedule: 'The schedule editor comes in a later update: colonists sleep from 22:00 to 06:00.', Research: 'Research comes with the first techs.', Chronicle: 'The Chronicle comes in a later update.', Hold: 'Tiers, charters and the Hearth levels come in a later update.' };

/** The Colony sheet (10.3). */
export function openColony(ctx, tab = 'People') {
  ctx.openSheet('Colony', (el, t) => {
    if (t === 'People') peopleList(el, ctx);
    else if (t === 'Work') { el.append(h('p.ec-note', { text: 'Roles set each colonist\'s work priorities. Tap a chip to change it.' })); peopleList(el, ctx, { work: true }); }
    else if (t === 'Stock') stockTab(el, ctx);
    else el.append(h('p.ec-note', { text: COLONY_LATER[t] || 'Comes in a later update.' }));
  }, { tabs: COLONY_TABS, tab });
}
function stockTab(el, ctx) {
  const s = ctx.s;
  const tot = new Map();
  for (const it of s.items) if (it && !it.f) tot.set(it.k, (tot.get(it.k) || 0) + it.n);
  const keys = [...tot.keys()].sort();
  if (!keys.length) { el.append(h('p.ec-note', { text: 'Nothing in stock.' })); return; }
  el.append(h('p.ec-note', { text: 'Everything the colony owns, stored or not. Tap to find it.' }));
  for (const k of keys) {
    const d = def('item', k) || { name: k };
    const row = h('button.ec-row', { type: 'button', 'data-act': 'stock-' + k }, h('span.ec-row-n', { text: d.name }), h('b.ec-row-v', { text: String(tot.get(k)) }));
    onTap(row, () => { const it = s.items.find((x) => x && x.k === k); if (it) { ctx.closeSheet(); ctx.centerOn((it.x + 0.5) * 32, (it.y + 0.5) * 32); ctx.select({ kind: 'item', id: it.id, tile: it.y * s.w + it.x, x: it.x, y: it.y }); } });
    el.append(row);
  }
}

const HELP = [
  ['Roles', 'Each colonist has a role (Miner, Builder, Crafter, Hauler, Generalist) that sets what they do first. Tap a role chip to change it.'],
  ['Digging and support', 'Drag Mine over rock. A roof needs support within 4 tiles: rock, a wall, a pillar or a prop. Carve hall plans the pillars for you.'],
  ['Rooms and stamps', 'Build > Rooms: drag a rectangle and a whole room is planned (walls, a door, floor, furniture). Drag the door to move it, then Done.'],
  ['Stockpiles', 'Zones > Stockpile: pick a preset and drag an area. Haulers bring what it takes.'],
  ['Bills', 'Workbenches make what their bills ask for. A mason cuts blocks until 100 by default. Open a bench to change its bills.'],
  ['Food and rest', 'Colonists eat meals from a campfire (or raw food) and sleep at night, best in a bed. Paint a grow zone for hearthroot.'],
  ['Light and the Hollow', 'An omen warns of each horde a day ahead: the chip at the top counts down. The Hollow hate light: braziers and the Hearth burn them. Draft everyone at dusk and Hold by the fire.'],
  ['Speed', 'Tap the speed button to pause. Hold it for 1x, 2x, 3x and 5x. 5x waits while hostiles are on the map or anyone is drafted.'],
];
/** The Menu (10.3): Save now, Back up, Colonies, Settings, Help, Quit to title. */
export function openMenu(ctx, api) {
  ctx.openSheet('Menu', (el) => {
    const item = (label, fn, locked, act) => {
      const b = h('button.ec-row' + (locked ? '.locked' : ''), { type: 'button', 'data-act': act || 'menu-' + label.toLowerCase().replace(/\s+/g, '-'), 'aria-disabled': locked ? 'true' : null },
        h('span.ec-row-n', { text: label }), locked ? h('span.ec-row-s', { text: locked }) : null);
      onTap(b, () => (locked ? ctx.toast(`${label}: ${locked}`) : fn()));
      return b;
    };
    el.append(...[
      item('Save now', async () => { try { const r = await api.saveNow(); ctx.toast(r ? 'Saved.' : 'Nothing to save.'); } catch (e) { ctx.toast('Save failed: ' + e.message, 'bad'); } }),
      item('Back up', () => (api.backupColony ? backUpNow(ctx, api) : backUp(ctx, api))),
      api.isStandalone && api.isStandalone() ? null : item('Move colony to the app', () => openMoveToApp(ctx, api), null, 'menu-move'),
      item('Help', () => ctx.openSheet('Help', (h2) => { for (const [t, x] of HELP) h2.append(h('section.ec-bio', null, h('h3.ec-sub', { text: t }), h('p.ec-bio-d', { text: x }))); }, { back: true })),
      item('Colonies', null, 'One colony in this test build'),
      item('Settings', null, 'Comes in a later update'),
      item('Quit to title', () => { ctx.quit(); }),
    ].filter(Boolean));
  });
}
/** Back up through A's backupColony (share sheet with the .ecsave file, else a download); called inside the tap. */
function backUpNow(ctx, api) {
  api.backupColony(ctx.s.id).then((r) => {
    if (r && r.ok) ctx.toast(r.via === 'share' ? 'Backup shared.' : `Backup saved: ${r.filename}.`);
    else if (r && r.reason !== 'cancelled') ctx.toast(`Backup failed: ${r ? r.reason : 'unknown'}.`, 'bad');
  }).catch((e) => ctx.toast('Backup failed: ' + (e && e.message ? e.message : e), 'bad'));
}
/** Back up: save, then hand the EC2 blob to the share sheet (or download it). */
async function backUp(ctx, api) {
  try {
    await api.saveNow();
    const x = await api.exportBlob(ctx.s.id);
    const file = typeof File === 'function' ? new File([x.bytes], x.filename, { type: 'application/octet-stream' }) : null;
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Embercrown backup' }); ctx.toast('Backup shared.'); return; }
    const url = URL.createObjectURL(new Blob([x.bytes], { type: 'application/octet-stream' }));
    const a = document.createElement('a'); a.href = url; a.download = x.filename; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    ctx.toast('Backup saved to your downloads.');
  } catch (e) { if (e && e.name === 'AbortError') return; ctx.toast('Backup failed: ' + (e && e.message ? e.message : e), 'bad'); }
}

