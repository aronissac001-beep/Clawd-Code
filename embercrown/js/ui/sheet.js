// Full sheets (owner I; doc 10.1 "Full sheet", 10.3, 10.5, 10.8). A second tap on the same
// subject, or dragging its peek card up, opens its sheet at 75% height (the world above stays live);
// drag to 92% or down to close. Subjects: colonist (colonistui.js), building (bills, billsui.js;
// info; the room it stands in), zone (zonesui.js), animal, item and tile (details, the room).
// The Colony sheet lives in colonyui.js; the Menu (Save now, Back up, Letters, Move to app, Help,
// Colonies, Settings, Quit) and Settings (every setting of A's save/settings.js) live here.
import { h, onTap, icon } from './kit.js';
import { def, structDef } from '../game/core/content.js';
import { TER_NAMES } from '../game/core/grid.js';
import { colonistHeader, colonistTab, COLONIST_TABS } from './colonistui.js';
import { billsTab, benchRecipes } from './billsui.js';
import { zoneSheet } from './zonesui.js';
import { buildingStatus } from './peek.js';
import { openMoveToApp } from './cards.js';
import { openColony as colonySheet, COLONY_TABS as TABS } from './colonyui.js';
import { openHelp } from './help.js';
import { openLetters } from './letters.js';
import { roomInfo } from '../game/world/rooms.js';
import { SETTINGS } from '../game/save/settings.js';
import { FIX } from '../game/core/schema.js';

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
    const rid = s.rt.room ? s.rt.room[b.y * s.w + b.x] : 0;
    const tabs = [bench ? 'Bills' : null, 'Info', rid ? 'Room' : null].filter(Boolean);
    ctx.openSheet(d.name, (el, t) => (t === 'Bills' ? billsTab(el, ctx, b, ui) : t === 'Room' ? roomTab(el, ctx, rid) : buildingInfo(el, ctx, b, d)), { tabs: tabs.length > 1 ? tabs : null, tab: tab || tabs[0], subject: sel });
    return;
  }
  if (sel.kind === 'zone') {
    const z = s.zones.find((x) => x.id === sel.id);
    if (!z) return;
    const ui = {};
    ctx.openSheet(z.name, (el) => zoneSheet(el, ctx, z, ui), { subject: sel });
    return;
  }
  if (sel.kind === 'animal') {
    const a = s.anim.find((x) => x.id === sel.id);
    if (!a) return;
    const d = def('animal', a.kind) || { name: a.kind };
    ctx.openSheet(a.name || d.name, (el) => animalInfo(el, ctx, a, d), { subject: sel });
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
  const rid = s.rt.room ? s.rt.room[sel.tile] : 0;
  if (rid) { ctx.openSheet(TER_NAMES[t], (el) => { el.append(h('p.ec-note', { text: `Tile ${sel.x}, ${sel.y}.` })); roomTab(el, ctx, rid); }, { subject: sel }); return; }
  ctx.openSheet(TER_NAMES[t], (el) => { el.append(h('p.ec-note', { text: `Tile ${sel.x}, ${sel.y}.` })); }, { subject: sel });
}

/** A room's role, tier and stats (B's roomInfo, 7.11). */
export function roomTab(el, ctx, rid) {
  let inf = null;
  try { inf = roomInfo(ctx.s, rid); } catch (_) { inf = null; }
  if (!inf) { el.append(h('p.ec-note', { text: 'Not a room: it needs walls or rock all round and a door.' })); return; }
  const role = def('room', inf.role) || { name: inf.role.charAt(0).toUpperCase() + inf.role.slice(1), text: '' };
  const tier = def('roomTier', inf.tier) || { name: inf.tier };
  const rec = ctx.s.rt.rooms && ctx.s.rt.rooms[rid];
  el.append(h('h3.ec-sub', { text: `${role.name}, ${tier.name}` }));
  const facts = h('div.ec-facts');
  const row = (k, v) => facts.append(h('div.ec-fact', null, h('span', { text: k }), h('b', { text: v })));
  row('Impressiveness', String(inf.imp));
  row('Size', `${rec ? rec.n : '?'} tiles (${inf.stats.space} free)`);
  row('Wealth', String(inf.stats.wealth));
  row('Beauty', inf.beautyAvg.toFixed(1));
  row('Clean', inf.stats.clean + '%');
  row('Light', inf.stats.light + '%');
  if (rec) row('Roof', rec.roofed ? 'Roofed' : rec.under ? 'Under the mountain' : 'Partly open');
  el.append(facts, h('p.ec-note', { text: `${role.text ? role.text + ' ' : ''}Wealth, beauty, space and cleanliness raise the tier: Squalid, Plain, Decent, Fine, Grand, Majestic. A finer room lifts the mood of those who use it.` }));
}

/** An animal: kind, tame or wild, its pen, health. */
function animalInfo(el, ctx, a, d) {
  const s = ctx.s;
  const facts = h('div.ec-facts');
  const row = (k, v) => facts.append(h('div.ec-fact', null, h('span', { text: k }), h('b', { text: v })));
  row('Kind', d.name);
  row('State', a.st && a.st.mode === 'manhunt' ? 'Hunting people' : a.tame ? 'Tame' : 'Wild');
  if (a.tame) { const z = a.pen !== null ? s.zones.find((x) => x.id === a.pen) : null; row('Pen', z ? z.name : 'None: make a pen'); }
  if (a.hp && a.hp.max) row('Health', `${Math.round((a.hp.hp / a.hp.max) * 100)}%`);
  el.append(facts);
  if (d.text) el.append(h('p.ec-note', { text: d.text }));
  el.append(h('p.ec-note', { text: a.tame ? 'Handlers milk, shear and feed tame animals; an overfull pen is culled.' : 'Orders > Tame (a farm kind, a pen with room) or Orders > Hunt.' }));
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

export const COLONY_TABS = TABS;
/** The Colony sheet (10.3; colonyui.js). */
export function openColony(ctx, tab = 'People') { colonySheet(ctx, tab); }

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
      ctx.letters ? item('Letters', () => openLetters(ctx, ctx.letters), null, 'menu-letters') : null,
      item('Help', () => openHelp(ctx)),
      item('Colonies', () => { ctx.toast('Saved. The colony list is on the title screen.'); ctx.quit(); }, null, 'menu-colonies'),
      item('Settings', () => openSettings(ctx, api)),
      item('Quit to title', () => { ctx.quit(); }),
    ].filter(Boolean));
  });
}
/**
 * Settings (10.9, 14.8 row A): every setting of A's save/settings.js, grouped (Display, Play,
 * Controls, Sound, Saves), then Storage (11.1: whether the browser keeps the saves, the storage mode
 * and use). Values live in A's settings (readSettings / writeSettings, applied to <html> as data-ec-*).
 * Backup reminders can be turned off only in the Home Screen app (11.5).
 */
const SET_GROUPS = [
  ['Display', ['textSize', 'reduceMotion', 'colourSafe', 'batterySaver']],
  ['Play', ['autoPauseImminent', 'autoPauseLetter', 'autoPauseDowned', 'advancedGrid']],
  ['Controls', ['leftHanded', 'twoFingerPause']],
  ['Sound', ['sound', 'music', 'volume']],
  ['Saves', ['backupPrompt']],
];
export function openSettings(ctx, api) {
  ctx.openSheet('Settings', (el) => {
    settingsList(el, { read: () => (api.readSettings ? api.readSettings() : {}), write: (patch) => { if (api.writeSettings) api.writeSettings(patch); ctx.refreshSheet(); },
      toast: ctx.toast, standalone: !!(api.isStandalone && api.isStandalone()) });
    const info = h('p.ec-bio-d', { role: 'status', text: 'Checking storage...' });
    el.append(h('h3.ec-sub', { text: 'Storage' }), info);
    if (api.storageInfo) {
      api.storageInfo().then((x) => {
        const kb = (n) => (n === null || n === undefined ? null : `${Math.max(1, Math.round(n / 1024))} KB`);
        const used = kb(x.usage), mine = x.colonies.find((c) => c.id === ctx.s.id);
        info.textContent = [x.persistText, x.mode === 'idb' ? 'Saves are in the browser database.' : x.mode === 'local' ? 'Saves are in the small fallback store: back up often.' : x.mode === 'none' ? 'This browser keeps no saves: back up before you leave.' : '',
          mine && mine.size ? `This colony: ${kb(mine.size)}.` : '', used ? `This site uses ${used}.` : '', x.max ? `Colonies: ${x.count || x.colonies.length} of ${x.max}.` : ''].filter(Boolean).join(' ');
      }).catch(() => { info.textContent = 'The browser did not say how it keeps the saves. Back up your hold now and then.'; });
    } else info.textContent = 'Storage details are not offered here.';
  }, { back: true });
}
/**
 * The settings rows (shared by the in-game sheet and the title). o: { read() -> settings,
 * write(patch) (stores and redraws), toast(text), standalone }.
 */
export function settingsList(el, o) {
  const st = o.read() || {}, app = !!o.standalone;
  for (const [group, keys] of SET_GROUPS) {
    el.append(h('h3.ec-sub', { text: group }));
    for (const key of keys) {
      const d = SETTINGS[key];
      if (!d) continue;
      const v = st[key] === undefined ? d.def : st[key];
      if (d.type === 'bool') {
        const enabled = key !== 'backupPrompt' || app;
        const b = h('button.ec-row.ec-toggle', { type: 'button', role: 'switch', 'aria-checked': v ? 'true' : 'false', 'data-act': 'set-' + key, 'aria-disabled': enabled ? null : 'true' },
          h('span.ec-row-n', null, d.label, h('span.ec-row-help', { text: d.help })), h('span.ec-row-s', { text: enabled ? (v ? 'On' : 'Off') : 'App only' }));
        onTap(b, () => { if (!enabled) { o.toast('Backup reminders can be turned off once Embercrown runs from your Home Screen.'); return; } o.write({ [key]: !v }); });
        el.append(b);
      } else if (d.type === 'enum') {
        el.append(h('div.ec-row-help.ec-set-l', { text: `${d.label}: ${d.help}` }));
        const seg = h('div.ec-seg', { role: 'radiogroup', 'aria-label': d.label });
        for (const x of d.vals) {
          const b = h('button.ec-seg-b' + (v === x ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': v === x ? 'true' : 'false', 'data-act': `set-${key}-${x}`, text: key === 'textSize' ? `${x}%` : String(x) });
          onTap(b, () => o.write({ [key]: x }));
          seg.append(b);
        }
        el.append(seg);
      } else if (d.type === 'int') {
        const step = 10;
        const minus = h('button.ec-ibtn.ec-mini', { type: 'button', 'data-act': `set-${key}-minus`, 'aria-label': `${d.label} down`, html: icon('minus'), disabled: v <= d.min });
        const plus = h('button.ec-ibtn.ec-mini', { type: 'button', 'data-act': `set-${key}-plus`, 'aria-label': `${d.label} up`, html: icon('plus'), disabled: v >= d.max });
        onTap(minus, () => o.write({ [key]: Math.max(d.min, v - step) }));
        onTap(plus, () => o.write({ [key]: Math.min(d.max, v + step) }));
        el.append(h('div.ec-row', null, h('span.ec-row-n', { text: d.label }), minus, h('b.ec-bill-n', { text: String(v) }), plus));
      }
    }
  }
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

