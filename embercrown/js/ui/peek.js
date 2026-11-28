// Peek cards and long-press menus (owner I; doc 10.1 "Peek card", 10.2 long-press, 10.5).
// The peek card (120 pt) is the default for any selection: a head line and three actions.
//   Colonist: portrait, name, role chip, current job, mood bar; Draft, Role, Prioritise.
//   Building: name, status or current bill; Bills (or Details), Upgrade, Copy (the room).
//   Item: Forbid, Haul now, Locate.   Zone: Preset (or Crop, Animals), Expand, Delete.   Tile: what can be done there.
//   Animal (Stage 2): Hunt, Tame, Details.   A burning tile: the fire and the Home area.   A room tile: its role and tier.
//   Drafted colonist: Undraft, Hold, Draft all.   Raid / drafted group: threatui.js (Draft all, Jump to edge).
// peekContent(ctx, sel) -> { head, acts: [[label, fn, act, disabled?]] } | null (subject gone).
// contextItems(ctx, sel, target) -> [[label, fn, act]] for the long-press menu (with a colonist
// selected and a target under the finger: "Prioritise: Mine here").
// Stage Z1 (EMBERCROWN-FORTRESS.md 4.2, 4.3): with levels the colonist line names the level ("Mining granite ·
// -5 Middle", the HUD's level words) and a stair or ramp tile offers Go up / Go down (the view follows).
import { h, icon, onTap } from './kit.js';
import { t } from './strings.js';
import { W, PLANE, TER, TER_NAMES, TER_MINEABLE, DESIG, idx } from '../game/core/grid.js';
import { def, all, structDef, hasFlag } from '../game/core/content.js';
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
import { threatPeek, draftAll } from './threatui.js';
import { roomInfo } from '../game/world/rooms.js';
import { gateMode, mechState, linksOf } from '../game/world/mechanisms.js';
import { WORK_IDS as WIDS } from '../game/core/schema.js';
import { stairDirs } from '../game/tools/levels.js';
import { levelName } from './levels.js';

/** "Bedroom, Fine" for the room at tile i (B's roomInfo), or null. */
export function roomWord(s, i) {
  const rid = s.rt.room ? s.rt.room[i] : 0;
  if (!rid) return null;
  let inf = null; try { inf = roomInfo(s, rid); } catch (_) { inf = null; }
  if (!inf) return null;
  const r = def('room', inf.role), t = def('roomTier', inf.tier);
  return `${r ? r.name : inf.role}, ${t ? t.name : inf.tier}`;
}
const burning = (s, i) => { const f = s.colony.world && s.colony.world.fire; return !!f && f.some((e) => e[0] === i); };
const GATE_WORD = ['Closed', 'Held open', 'Locked'];

const MAT = (m) => (m ? (def('material', m) || { name: m }).name : '');
const ITEM = (k) => (def('item', k) || { name: k }).name;
const QUALITY = ['Awful', 'Plain', 'Fine', 'Superior', 'Masterwork', 'Legendary', 'Legendary'];

/** "Granite wall", "Wooden door", "Mason's bench": the material leads only for walls, doors and floors. */
export function bldName(b, d) {
  if (!b.mat || d.cat !== 'walls' || d.kind === 'furniture') return d.name;
  const m = b.mat === 'wood' ? 'Wooden' : MAT(b.mat);
  return `${m} ${d.name.charAt(0).toLowerCase()}${d.name.slice(1)}`;
}

/** Building status line: blueprint needs, frame, deconstruct mark, or the current bill. */
export function buildingStatus(s, b) {
  if (b.st === 'bp' || b.st === 'frame') {
    const need = b.need || {}, got = b.got || {};
    const left = Object.keys(need).sort().map((k) => { const n = (need[k] | 0) - (got[k] | 0); return n > 0 ? `${ITEM(k.split(':')[0])} ${n}` : null; }).filter(Boolean);
    if (!left.length) return b.st === 'frame' ? 'Being built' : 'Blueprint: ready to build';
    return `Blueprint: needs ${left.join(', ')}${madeWhere(s, Object.keys(need).filter((k) => (need[k] | 0) > (got[k] | 0)).map((k) => k.split(':')[0]))}`;
  }
  if (b.dcon) return 'Marked to take down';
  const d = structDef(b.def);
  if (d && d.workbench) {
    const bl = b.bills.find((x) => !x.paused);
    return bl ? `${(def('recipe', bl.recipe) || { name: bl.recipe }).name}: ${billText(s, bl)}` : 'No bills';
  }
  if (b.owner !== null && b.owner !== undefined) { const c = s.col.find((x) => x.id === b.owner); if (c) return `Owner: ${c.name}`; }
  // walls, doors and floors already name their material ("Wooden wall")
  return b.mat && !(d && d.cat === 'walls' && d.kind !== 'furniture') ? MAT(b.mat) : 'Built';
}

const RAW_HINT = { stone: 'mine some rock', wood: 'chop some trees' };
/**
 * Where a missing item comes from: raw stone or wood with no stack on the map ("mine some rock"), or
 * furniture no finished bench makes yet (D8 auto-bills: " · build a Carpenter's bench"), so a stamped
 * bed or a bench frame never waits silently.
 */
function madeWhere(s, kinds) {
  for (const k of kinds) {
    // a raw material with no stack anywhere on the map: say where it comes from
    if (RAW_HINT[k]) { if (!s.items.some((it) => it && it.k === k && !it.f)) return ` · ${RAW_HINT[k]}`; continue; }
    if (!def('item', k) || k === 'block') continue;
    const benches = [];
    for (const r of all('recipe')) if (r.out && r.out.some((o) => o.k === k)) for (const bn of r.bench || []) if (!benches.includes(bn)) benches.push(bn);
    if (!benches.length) continue;
    if (s.bld.some((x) => x && x.st === 'done' && benches.includes(x.def))) continue;
    return ` · build a ${(structDef(benches[0]) || { name: benches[0] }).name}`;
  }
  return '';
}

/** A colonist who could take a prioritised job: the selected one, else the nearest able. */
function nearestCol(s, x, y) {
  let best = null, bd = Infinity;
  for (const c of s.col) { if (c.drafted || c.hp.dead || c.hp.down) continue; const d = (c.x - x) ** 2 + (c.y - y) ** 2; if (d < bd) { bd = d; best = c; } }
  return best;
}

/** The colonist's job line; an idle colonist names the role that has no work ("Idle: no Builder work", 11 item 4). */
export function peekJob(c) {
  const t = jobText(c);
  if (t !== 'Idle: no role work' || !c.role || !c.role[0] || c.custom) return t;
  const r = roleName(c.role[0]);
  return r === 'None' ? t : `Idle: no ${r} work`;
}
/**
 * The peek card for a selection (W1.4, EMBERCROWN-WORLD.md 8.4 and 8.6): the head carries a chevron button
 * ("Open >") that opens the full sheet, so the way in is visible (a tap on the name plate still opens it, a
 * swipe up too). A raid or a drafted group has no full sheet: no chevron.
 */
export function peekContent(ctx, sel) {
  const c = peekBody(ctx, sel);
  if (!c || !c.head || sel.kind === 'raid' || sel.kind === 'drafted') return c;
  const open = h('button.ec-peek-open', { type: 'button', 'data-act': 'peek-open', 'aria-label': t('peek.openFull') }, h('span.ec-peek-open-t', { text: t('peek.open') }), h('span', { html: icon('chev') }));
  onTap(open, () => openSubjectSheet(ctx, sel));
  c.head.append(open);
  return c;
}
function peekBody(ctx, sel) {
  const s = ctx.s;
  if (sel.kind === 'raid' || sel.kind === 'drafted') return threatPeek(ctx, sel);
  if (sel.kind === 'colonist') {
    const c = s.col.find((x) => x.id === sel.id);
    if (!c) return null;
    const mood = Math.round(c.mood / FIX);
    const chip = h('span.ec-rolechip', { text: roleName(c.role[0]) });
    const head = h('div.ec-peek-head', null, ctx.portrait(c),
      h('div.ec-peek-txt', null,
        h('div.ec-peek-name', null, h('b', { text: c.name }), chip),
        h('div.ec-peek-sub', { text: ctx.deep ? `${peekJob(c)} · ${levelName(c.z | 0)}` : peekJob(c) }),
        h('div.ec-moodbar', { role: 'meter', 'aria-label': 'Mood', 'aria-valuenow': String(mood), 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('i', { style: { width: mood + '%' } }))));
    if (c.drafted) {
      // drafted (9.5, 10.2): tap the ground to move, a hostile to attack; Hold strikes what comes
      return { head, acts: [
        ['Undraft', () => ctx.send({ t: 'draft', colIds: [c.id], on: false }, 'Back to work.'), 'draft'],
        ['Hold', () => ctx.send({ t: 'order', colIds: [c.id], kind: 'hold' }, 'Holding: strikes what comes.'), 'hold'],
        ['Draft all', () => draftAll(ctx), 'draft-all'],
      ] };
    }
    return { head, acts: [
      [c.hp.down ? 'Downed' : 'Draft', () => (c.hp.down ? ctx.toast(`${c.name.split(' ')[0]} is down: someone with Care carries them to a bed.`) : ctx.send({ t: 'draft', colIds: [c.id], on: true }, 'Drafted. Tap the ground to move, a hostile to attack.')), 'draft', !!c.hp.down],
      ['Role', () => openRolePicker(ctx, c, 'primary'), 'role'],
      ['Prioritise', () => ctx.toast(`Long-press a job (rock, tree, blueprint, bench) to give it to ${c.name.split(' ')[0]} first.`), 'prioritise'],
    ] };
  }
  if (sel.kind === 'building') {
    const b = s.bld[sel.id];
    if (!b) return null;
    const d = structDef(b.def) || { name: b.def };
    const rid = roomAt(s, idx(b.x, b.y, b.z | 0));
    let sub = buildingStatus(s, b);
    if (b.st === 'done' && hasFlag(d, 'door') && (hasFlag(d, 'lockable') || b.link !== null)) { try { sub = `${GATE_WORD[gateMode(s, b)] || 'Closed'}${b.link !== null && b.link !== undefined ? ' · linked to a lever' : ''}`; } catch (_) { /* before Stage 2 */ } }
    // W0.3: the raising bridge (raised while its lever holds it locked) and the floodgate (shut unless held open)
    if (b.st === 'done' && (hasFlag(d, 'liftbridge') || hasFlag(d, 'floodgate'))) {
      try {
        const m = gateMode(s, b), lk = b.link !== null && b.link !== undefined ? ' · on a lever' : ' · no lever';
        sub = (hasFlag(d, 'liftbridge') ? (m === 2 ? 'Raised · channel sealed' : 'Lowered · water passes') : (m === 1 ? 'Open · water flows' : 'Shut · holds water')) + lk;
      } catch (_) { /* before Stage 2 */ }
    }
    if (b.st === 'done' && (hasFlag(d, 'lever') || hasFlag(d, 'plate'))) { try { const n = linksOf(s, b.id).length; const m = mechState(s, b.id); sub = `${n} linked${hasFlag(d, 'lever') ? ` · holds them ${(GATE_WORD[m] || 'closed').toLowerCase()}` : ''}`; } catch (_) { /* before Stage 2 */ } }
    if (burning(s, idx(b.x, b.y, b.z | 0))) sub = 'On fire! · ' + sub;
    const rw = b.st === 'done' && !hasFlag(d, 'wall') && !hasFlag(d, 'door') ? roomWord(s, idx(b.x, b.y, b.z | 0)) : null;
    if (rw) sub = `${sub} · ${rw}`;
    const head = h('div.ec-peek-head', null, h('span.ec-peek-ic', { html: icon(defIcon(d)) }),
      h('div.ec-peek-txt', null, h('div.ec-peek-name', null, h('b', { text: bldName(b, d) })), h('div.ec-peek-sub', { text: sub })));
    const acts = [];
    if (b.st !== 'done') acts.push(['Cancel', () => { ctx.send({ t: 'deconstruct', ids: [b.id] }, 'Blueprint removed.'); ctx.closePeek(); }, 'cancel-bp']);
    if (d.workbench) acts.push(['Bills', () => openSubjectSheet(ctx, sel, 'Bills'), 'bills']);
    else acts.push(['Details', () => openSubjectSheet(ctx, sel), 'details']);
    if (b.st === 'done') {
      const lv = d.levels && d.levels[(b.lvl | 0) - 1];
      acts.push(['Upgrade', () => (lv ? ctx.send({ t: 'upgrade', bId: b.id }, `${lv.name || d.name + ' upgrade'} planned: builders bring what it needs.`) : ctx.toast(`${d.name} has no upgrade.`)), 'upgrade', !lv]);
    }
    acts.push(['Copy', () => copyRoom(ctx, rid), 'copy', !rid]);
    return { head, acts: acts.slice(0, 3) };
  }
  if (sel.kind === 'animal') {
    const a = s.anim.find((x) => x.id === sel.id);
    if (!a) return null;
    const d = def('animal', a.kind) || { name: a.kind };
    const hunting = a.st && a.st.mode === 'manhunt';
    const head = h('div.ec-peek-head', null, h('span.ec-peek-ic' + (hunting ? '.bad' : ''), { html: icon(hunting ? 'sword' : 'pop') }),
      h('div.ec-peek-txt', null, h('div.ec-peek-name', null, h('b', { text: a.name || d.name })), h('div.ec-peek-sub', { text: hunting ? 'Hunting people: draft and fight' : a.tame ? `Tame${a.pen !== null ? ' · in a pen' : ' · no pen'}` : 'Wild' })));
    const order = (work, verb) => {
      const k = WIDS.indexOf('animals');
      const pick = s.col.filter((c) => !c.drafted && !c.hp.dead && !c.hp.down && c.prio[k] > 0).sort((p, q) => ((p.x - a.x) ** 2 + (p.y - a.y) ** 2) - ((q.x - a.x) ** 2 + (q.y - a.y) ** 2))[0];
      if (!pick) { ctx.toast('Nobody does animal work: give someone the Herder role.'); return; }
      ctx.send({ t: 'prioritise', colId: pick.id, target: { id: a.id, kind: 'anim' }, work }, `${pick.name.split(' ')[0]} will ${verb} it.`);
    };
    if (a.tame) return { head, acts: [['Details', () => openSubjectSheet(ctx, sel), 'details'], ['Locate', () => ctx.centerOn(a.x, a.y), 'locate'], ['Close', () => ctx.closePeek(), 'close-peek']] };
    return { head, acts: [
      ['Hunt', () => order('animals', 'hunt'), 'hunt'],
      ['Tame', () => order('animals', 'tame'), 'tame', hunting],
      ['Details', () => openSubjectSheet(ctx, sel), 'details'],
    ] };
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
    const head = h('div.ec-peek-head', null, h('span.ec-peek-ic', { html: icon(z.type === 'grow' ? 'farm' : z.type === 'pen' ? 'gate' : z.type === 'home' ? 'flame' : 'crate') }),
      h('div.ec-peek-txt', null, h('div.ec-peek-name', null, h('b', { text: z.name })), h('div.ec-peek-sub', { text: zoneLabel(z) })));
    return { head, acts: [
      [z.type === 'grow' ? 'Crop' : z.type === 'pen' ? 'Animals' : z.type === 'home' ? 'Details' : 'Preset', () => openSubjectSheet(ctx, sel), 'preset'],
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
  if (burning(s, i)) sub.unshift('on fire');
  if (rid) { const rw = roomWord(s, i); sub.push(rw ? `${rw}, ${roomSize(s, rid)} tiles` : `room of ${roomSize(s, rid)} tiles`); }
  const fd = s.L.floor[i] ? floorDefOf(s.L.floor[i]) : null;
  const name = tree ? 'Tree' : fd ? fd.name : TER_NAMES[t];
  const head = h('div.ec-peek-head', null, h('span.ec-peek-ic', { html: icon(rock ? 'stone' : tree ? 'axe' : 'region') }),
    h('div.ec-peek-txt', null, h('div.ec-peek-name', null, h('b', { text: name })), h('div.ec-peek-sub', { text: sub.length ? sub.join(' · ') : `Tile ${sel.x}, ${sel.y}` })));
  const one = { x0: sel.x, y0: sel.y, x1: sel.x, y1: sel.y };
  if (ctx.deep) one.z = ctx.z();
  const acts = [];
  if (ctx.deep) {   // a stair or ramp: Go up / Go down, and the view follows (4.2)
    const dirs = stairDirs(s, i), z0 = ctx.z();
    if (dirs.up) acts.push(['Go up', () => ctx.setLevel(z0 + 1), 'go-up']);
    if (dirs.down) acts.push(['Go down', () => ctx.setLevel(z0 - 1), 'go-down']);
  }
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
  if (r && r.ok) {
    // straight into pasting (10.11: paste at the finger); later pastes come from Build > Rooms
    if (ctx.startTool && r.templateId !== undefined) { ctx.startTool({ kind: 'paste', templateId: r.templateId }); ctx.toast('Room copied. Tap where the copy goes.'); }
    else ctx.toast('Room copied. Paste it from Build > Rooms.');
  }
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
    const rid = roomAt(s, idx(b.x, b.y, b.z | 0));
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
  if (!col && TER_MINEABLE[s.L.terrain[i]]) out.push(['Mine', () => ctx.send({ t: 'designate', kind: 'mine', rect: { x0: target.x, y0: target.y, x1: target.x, y1: target.y, z: (i / PLANE) | 0 }, add: true }, 'Marked for mining.'), 'ctx-mine']);
  const rid = roomAt(s, i);
  if (rid) out.push(['Copy room', () => copyRoom(ctx, rid), 'ctx-copy']);
  return out;
}


