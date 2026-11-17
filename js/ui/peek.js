// Peek cards and long-press menus (owner I; doc 10.1 "Peek card", 10.2 long-press, 10.5).
// The peek card (120 pt) is the default for any selection: a head line and three actions.
//   Colonist: portrait, name, role chip, current job, mood bar; Draft, Role, Prioritise.
//   Building: name, status or current bill; Bills (or Details), Upgrade, Copy (the room).
//   Item: Forbid, Haul now, Locate.   Zone: Preset, Expand, Delete.   Tile: what can be done there.
// peekContent(ctx, sel) -> { head, acts: [[label, fn, act, disabled?]] } | null (subject gone).
// contextItems(ctx, sel, target) -> [[label, fn, act]] for the long-press menu (with a colonist
// selected and a target under the finger: "Prioritise: Mine here").
import { h, icon } from './kit.js';
import { W, TER, TER_NAMES, TER_MINEABLE, DESIG, idx } from '../game/core/grid.js';
import { def, structDef, hasFlag } from '../game/core/content.js';
import { FIX, WORK_IDS } from '../game/core/schema.js';
import { isTreeCode } from '../game/world/defs.js';
import { roomAt, roomSize } from '../game/tools/copy.js';
import { floorDefOf } from '../game/core/apply.js';
import { jobText } from './colonistui.js';
import { roleName, openRolePicker } from './rolesui.js';
import { zoneLabel, presetOf } from './zonesui.js';
import { defIcon } from './architect.js';
import { billText } from './billsui.js';
import { openSubjectSheet } from './sheet.js';

const MAT = (m) => (m ? (def('material', m) || { name: m }).name : '');
const ITEM = (k) => (def('item', k) || { name: k }).name;
const QUALITY = ['Awful', 'Plain', 'Fine', 'Superior', 'Masterwork', 'Legendary', 'Legendary'];

/** Building status line: blueprint needs, frame, deconstruct mark, or the current bill. */
export function buildingStatus(s, b) {
  if (b.st === 'bp' || b.st === 'frame') {
    const need = b.need || {}, got = b.got || {};
    const left = Object.keys(need).sort().map((k) => { const n = (need[k] | 0) - (got[k] | 0); return n > 0 ? `${ITEM(k.split(':')[0])} ${n}` : null; }).filter(Boolean);
    return left.length ? `Blueprint: needs ${left.join(', ')}` : b.st === 'frame' ? 'Being built' : 'Blueprint: ready to build';
  }
  if (b.dcon) return 'Marked to take down';
  const d = structDef(b.def);
  if (d && d.workbench) {
    const bl = b.bills.find((x) => !x.paused);
    return bl ? `${(def('recipe', bl.recipe) || { name: bl.recipe }).name}: ${billText(s, bl)}` : 'No bills';
  }
  if (b.owner !== null && b.owner !== undefined) { const c = s.col.find((x) => x.id === b.owner); if (c) return `Owner: ${c.name}`; }
  return b.mat ? MAT(b.mat) : 'Built';
}

/** A colonist who could take a prioritised job: the selected one, else the nearest able. */
function nearestCol(s, x, y) {
  let best = null, bd = Infinity;
  for (const c of s.col) { if (c.drafted || c.hp.dead || c.hp.down) continue; const d = (c.x - x) ** 2 + (c.y - y) ** 2; if (d < bd) { bd = d; best = c; } }
  return best;
}

export function peekContent(ctx, sel) {
  const s = ctx.s;
  if (sel.kind === 'colonist') {
    const c = s.col.find((x) => x.id === sel.id);
    if (!c) return null;
    const mood = Math.round(c.mood / FIX);
    const chip = h('span.ec-rolechip', { text: roleName(c.role[0]) });
    const head = h('div.ec-peek-head', null, ctx.portrait(c),
      h('div.ec-peek-txt', null,
        h('div.ec-peek-name', null, h('b', { text: c.name }), chip),
        h('div.ec-peek-sub', { text: jobText(c) }),
        h('div.ec-moodbar', { role: 'meter', 'aria-label': 'Mood', 'aria-valuenow': String(mood), 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('i', { style: { width: mood + '%' } }))));
    return { head, acts: [
      [c.drafted ? 'Undraft' : 'Draft', () => ctx.send({ t: 'draft', colIds: [c.id], on: !c.drafted }, c.drafted ? 'Back to work.' : 'Drafted.'), 'draft'],
      ['Role', () => openRolePicker(ctx, c, 'primary'), 'role'],
      ['Prioritise', () => ctx.toast(`Long-press a job (rock, tree, blueprint, bench) to give it to ${c.name.split(' ')[0]} first.`), 'prioritise'],
    ] };
  }
  if (sel.kind === 'building') {
    const b = s.bld[sel.id];
    if (!b) return null;
    const d = structDef(b.def) || { name: b.def };
    const rid = roomAt(s, idx(b.x, b.y));
    const head = h('div.ec-peek-head', null, h('span.ec-peek-ic', { html: icon(defIcon(d)) }),
      h('div.ec-peek-txt', null, h('div.ec-peek-name', null, h('b', { text: `${b.mat && d.kind !== 'furniture' ? MAT(b.mat) + ' ' : ''}${d.name}`.replace(/^Wood Wall$/, 'Wooden wall') })), h('div.ec-peek-sub', { text: buildingStatus(s, b) })));
    const acts = [];
    if (b.st !== 'done') acts.push(['Cancel', () => { ctx.send({ t: 'deconstruct', ids: [b.id] }, 'Blueprint removed.'); ctx.closePeek(); }, 'cancel-bp']);
    if (d.workbench) acts.push(['Bills', () => openSubjectSheet(ctx, sel, 'Bills'), 'bills']);
    else acts.push(['Details', () => openSubjectSheet(ctx, sel), 'details']);
    if (b.st === 'done') {
      const lv = d.levels && d.levels[0];
      acts.push(['Upgrade', () => ctx.toast(lv ? `${lv.name} needs ${(def('tier', lv.tier) || { name: lv.tier }).name}.` : `${d.name} has no upgrade.`), 'upgrade', !lv]);
    }
    acts.push(['Copy', () => copyRoom(ctx, rid), 'copy', !rid]);
    return { head, acts: acts.slice(0, 3) };
  }
  if (sel.kind === 'item') {
    const it = s.items[sel.id];
    if (!it) return null;
    const head = h('div.ec-peek-head', null, h('span.ec-peek-ic', { html: icon(it.k === 'wood' ? 'wood' : it.k === 'stone' || it.k === 'block' ? 'stone' : 'crate') }),
      h('div.ec-peek-txt', null, h('div.ec-peek-name', null, h('b', { text: `${it.m && def('material', it.m) ? MAT(it.m) + ' ' : ''}${ITEM(it.k).toLowerCase()} x${it.n}`.replace(/^./, (x) => x.toUpperCase()) })),
        h('div.ec-peek-sub', { text: `${it.f ? 'Forbidden' : s.L.zone[idx(it.x, it.y)] ? 'In a stockpile' : 'On the ground'}${it.q !== 1 && def('item', it.k) && (def('item', it.k).tags || []).includes('unique') ? ' · ' + QUALITY[it.q] : ''}` })));
    return { head, acts: [
      [it.f ? 'Allow' : 'Forbid', () => ctx.send({ t: 'forbid', ids: [it.id], on: !it.f }, it.f ? 'Allowed.' : 'Forbidden: nobody touches it.'), 'forbid'],
      ['Haul now', () => haulNow(ctx, it), 'haul', it.f],
      ['Locate', () => ctx.centerOn((it.x + 0.5) * 32, (it.y + 0.5) * 32), 'locate'],
    ] };
  }
  if (sel.kind === 'zone') {
    const z = s.zones.find((x) => x.id === sel.id);
    if (!z) return null;
    const head = h('div.ec-peek-head', null, h('span.ec-peek-ic', { html: icon('crate') }),
      h('div.ec-peek-txt', null, h('div.ec-peek-name', null, h('b', { text: z.name })), h('div.ec-peek-sub', { text: zoneLabel(z) })));
    return { head, acts: [
      ['Preset', () => openSubjectSheet(ctx, sel), 'preset'],
      ['Expand', () => ctx.startTool({ kind: 'zone', op: 'expand', zoneId: z.id }), 'expand'],
      ['Delete', () => { ctx.send({ t: 'zone', op: 'delete', zoneId: z.id }, `${z.name} deleted.`); ctx.closePeek(); }, 'delete-zone'],
    ] };
  }
  // tile
  const i = sel.tile, t = s.L.terrain[i];
  const mat = s.L.mat[i];
  const rock = TER_MINEABLE[t] === 1;
  const tree = isTreeCode(s.L.plant[i]);
  const rid = roomAt(s, i);
  const sub = [];
  if (s.L.desig[i] & DESIG.MINE) sub.push('marked for mining');
  if (s.L.desig[i] & DESIG.CHOP) sub.push('marked to chop');
  if (rid) sub.push(`room of ${roomSize(s, rid)} tiles`);
  const fd = s.L.floor[i] ? floorDefOf(s.L.floor[i]) : null;
  const name = tree ? 'Tree' : fd ? fd.name : TER_NAMES[t];
  const head = h('div.ec-peek-head', null, h('span.ec-peek-ic', { html: icon(rock ? 'stone' : tree ? 'axe' : 'region') }),
    h('div.ec-peek-txt', null, h('div.ec-peek-name', null, h('b', { text: name })), h('div.ec-peek-sub', { text: sub.length ? sub.join(' · ') : `Tile ${sel.x}, ${sel.y}` })));
  const one = { x0: sel.x, y0: sel.y, x1: sel.x, y1: sel.y };
  const acts = [];
  if (rock) {
    const marked = (s.L.desig[i] & DESIG.MINE) !== 0;
    acts.push([marked ? 'Unmark' : 'Mine', () => ctx.send({ t: 'designate', kind: 'mine', rect: one, add: !marked }, marked ? 'Mining mark removed.' : 'Marked for mining.'), 'mine']);
    acts.push(['Carve hall', () => ctx.startTool({ kind: 'carve' }), 'carve']);
  } else if (tree) {
    const marked = (s.L.desig[i] & DESIG.CHOP) !== 0;
    acts.push([marked ? 'Unmark' : 'Chop', () => ctx.send({ t: 'designate', kind: 'chop', rect: one, add: !marked }, marked ? 'Chop mark removed.' : 'Marked to chop.'), 'chop']);
    acts.push(['Build', () => ctx.openPanel('build'), 'build']);
  } else {
    acts.push(['Build', () => ctx.openPanel('build'), 'build']);
    acts.push(['Stockpile', () => ctx.startTool({ kind: 'zone', op: 'new', preset: 'all' }), 'stockpile']);
  }
  if (rid) acts.push(['Copy room', () => copyRoom(ctx, rid), 'copy']);
  else acts.push(['Close', () => ctx.closePeek(), 'close-peek']);
  return { head, acts: acts.slice(0, 3) };
}

/** Copy a room as a template (10.11) and say where to paste it. */
export function copyRoom(ctx, rid) {
  if (!rid) { ctx.toast('Select a wall, door or floor of a finished room to copy it.'); return null; }
  const r = ctx.send({ t: 'copyRoom', roomId: rid });
  if (r && r.ok) ctx.toast('Room copied. Paste it from Build > Rooms.');
  return r;
}

/** Haul now: the nearest able colonist hauls this stack first (prioritise haul). */
function haulNow(ctx, it) {
  const s = ctx.s;
  const sel = ctx.ui.sel;
  const pick = (ctx.prevColonist && s.col.find((c) => c.id === ctx.prevColonist)) || nearestCol(s, (it.x + 0.5) * 32, (it.y + 0.5) * 32);
  if (!pick) { ctx.toast('Nobody can haul right now.'); return; }
  void sel;
  ctx.send({ t: 'prioritise', colId: pick.id, target: { id: it.id, kind: 'item' }, work: 'haul' }, `${pick.name.split(' ')[0]} will haul it next.`);
}

/**
 * Long-press menu items (10.2). With a colonist selected and a job under the finger: "Prioritise:
 * Mine here" and friends. Otherwise the subject's own menu.
 */
export function contextItems(ctx, target, colSel) {
  const s = ctx.s, out = [];
  const col = colSel ? s.col.find((c) => c.id === colSel) : null;
  if (target.kind === 'colonist') {
    const c = s.col.find((x) => x.id === target.id);
    if (!c) return out;
    out.push([c.drafted ? 'Undraft' : 'Draft', () => ctx.send({ t: 'draft', colIds: [c.id], on: !c.drafted }), 'ctx-draft']);
    out.push(['Prioritise...', () => { ctx.select({ kind: 'colonist', id: c.id }); ctx.toast(`Now long-press a job to give it to ${c.name.split(' ')[0]} first.`); }, 'ctx-prioritise']);
    out.push([ctx.following() === c.id ? 'Stop following' : 'Follow', () => ctx.follow(ctx.following() === c.id ? null : c.id), 'ctx-follow']);
    return out;
  }
  const first = col ? col.name.split(' ')[0] : null;
  const prio = (label, work, tgt) => {
    if (!col) return;
    const k = WORK_IDS.indexOf(work);
    if (col.prio[k] === 0) { out.push([`${first} does not ${label.toLowerCase()}`, () => ctx.toast(`${first} has that work off. Change the role first.`), 'ctx-off']); return; }
    out.push([`Prioritise: ${label} here`, () => ctx.send({ t: 'prioritise', colId: col.id, target: tgt, work }, `${first}: ${label.toLowerCase()} first.`), 'ctx-prio-' + work]);
  };
  if (target.kind === 'building') {
    const b = s.bld[target.id];
    if (!b) return out;
    const d = structDef(b.def);
    if (b.st !== 'done') prio('Build', 'build', { id: b.id, kind: 'bld' });
    else if (d && d.workbench) prio('Craft', 'craft', { id: b.id, kind: 'bld' });
    const rid = roomAt(s, idx(b.x, b.y));
    out.push(['Copy room', () => copyRoom(ctx, rid), 'ctx-copy']);
    if (d && d.workbench && b.st === 'done') out.push(['Bills', () => openSubjectSheet(ctx, { kind: 'building', id: b.id }, 'Bills'), 'ctx-bills']);
    if (d && d.levels) out.push(['Upgrade', () => ctx.toast(`${d.levels[0].name} needs ${(def('tier', d.levels[0].tier) || { name: d.levels[0].tier }).name}.`), 'ctx-upgrade']);
    return out;
  }
  if (target.kind === 'item') {
    const it = s.items[target.id];
    if (!it) return out;
    if (col) prio('Haul', 'haul', { id: it.id, kind: 'item' });
    out.push([it.f ? 'Allow' : 'Forbid', () => ctx.send({ t: 'forbid', ids: [it.id], on: !it.f }), 'ctx-forbid']);
    if (!col) out.push(['Haul now', () => haulNow(ctx, it), 'ctx-haul']);
    return out;
  }
  // a tile
  const i = target.tile;
  if (col && TER_MINEABLE[s.L.terrain[i]]) prio('Mine', 'mine', { x: target.x, y: target.y });
  if (col && isTreeCode(s.L.plant[i])) prio('Chop', 'chop', { x: target.x, y: target.y });
  if (!col && TER_MINEABLE[s.L.terrain[i]]) out.push(['Mine', () => ctx.send({ t: 'designate', kind: 'mine', rect: { x0: target.x, y0: target.y, x1: target.x, y1: target.y }, add: true }, 'Marked for mining.'), 'ctx-mine']);
  const rid = roomAt(s, i);
  if (rid) out.push(['Copy room', () => copyRoom(ctx, rid), 'ctx-copy']);
  return out;
}


