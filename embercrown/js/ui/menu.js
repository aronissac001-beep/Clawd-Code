// The Menu (owner I; W1.4, EMBERCROWN-WORLD.md 8.1 "top-left", 8.7, 11 item 12). Storage and app actions only,
// grouped, each row with its icon: Save now (with the time of the last save), Back up to a file, Holds and ruins,
// Settings, Help, Quit to title. Play moved out: Letters go to World (W1.3b; the row stays here only while the
// bar has no World slot), "Move to the app" and the storage facts to Settings / Storage (settingsui.js).
//   openMenu(ctx, api)   the Menu sheet (medium detent); ctx is the shell's, api the shell's A functions
//   backUpNow(ctx, api)  Back up through A's backupColony (share sheet, else a download); call it inside the tap
import { h, onTap, icon } from './kit.js';
import { t } from './strings.js';
import { openHelp } from './help.js';
import { openLetters } from './letters.js';
import { openSettings } from './settingsui.js';

let savedAt = 0;   // the wall-clock time of the last save made from this Menu (UI memory, never sim state)
const clock = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/** One Menu row: icon, label, an optional right-hand note; a locked row says why in a toast. */
function row(ctx, { ic, label, note = null, act, fn, locked = null }) {
  const b = h('button.ec-row.ec-menu-row' + (locked ? '.locked' : ''), { type: 'button', 'data-act': act, 'aria-disabled': locked ? 'true' : null },
    h('span.ec-menu-ic', { html: icon(ic) }), h('span.ec-row-n', { text: label }), note || locked ? h('span.ec-row-s', { text: locked || note }) : null);
  onTap(b, () => (locked ? ctx.toast(`${label}: ${locked}`) : fn()));
  return b;
}

/** The Menu sheet: Save now, Back up to a file, Holds and ruins, Settings, Help, Quit to title. */
export function openMenu(ctx, api) {
  ctx.openSheet(t('menu.title'), (el) => {
    const last = savedAt || (api.app && api.app.lastSave && api.app.lastSave.savedAt) || 0;
    const worldSlot = typeof document !== 'undefined' && document.querySelector('[data-act=tab][data-tab=world]');
    const store = h('div.ec-menu-group', { role: 'group', 'aria-label': t('menu.storage') },
      row(ctx, { ic: 'check', label: t('menu.save'), note: last ? t('menu.savedAt', { time: clock(last) }) : null, act: 'menu-save-now', fn: async () => {
        try { const r = await api.saveNow(); if (r) savedAt = Date.now(); ctx.toast(r ? t('menu.saved') : t('menu.nothing')); if (r) ctx.refreshSheet(); } catch (e) { ctx.toast(t('menu.saveFailed', { why: e && e.message ? e.message : String(e) }), 'bad'); }
      } }),
      row(ctx, { ic: 'export', label: t('menu.backup'), act: 'menu-back-up', fn: () => backUpNow(ctx, api) }),
      row(ctx, { ic: 'castle', label: t('menu.holds'), act: 'menu-holds', fn: () => { ctx.toast(t('menu.holdsToast')); ctx.quit({ view: 'holds' }); } }));
    const app = h('div.ec-menu-group', { role: 'group', 'aria-label': t('menu.app') },
      row(ctx, { ic: 'gear', label: t('menu.settings'), act: 'menu-settings', fn: () => openSettings(ctx, api) }),
      row(ctx, { ic: 'info', label: t('menu.help'), act: 'menu-help', fn: () => openHelp(ctx) }),
      // until W1.3b's World sheet carries the Letters (8.1 slot 5), they stay reachable from here
      !worldSlot && ctx.letters ? row(ctx, { ic: 'book', label: t('menu.letters'), act: 'menu-letters', fn: () => openLetters(ctx, ctx.letters) }) : null,
      row(ctx, { ic: 'back', label: t('menu.quit'), act: 'menu-quit-to-title', fn: () => ctx.quit() }));
    el.append(store, app);
  }, { help: 'Menu' });
}

/** Back up through A's backupColony (share sheet with the .ecsave file, else a download); called inside the tap. */
export function backUpNow(ctx, api) {
  if (!api.backupColony) return backUp(ctx, api);
  return api.backupColony(ctx.s.id).then((r) => {
    if (r && r.ok) ctx.toast(r.via === 'share' ? t('menu.backupShared') : t('menu.backupSaved', { file: r.filename }));
    else if (r && r.reason !== 'cancelled') ctx.toast(t('menu.backupFailed', { why: r ? r.reason : 'unknown' }), 'bad');
  }).catch((e) => ctx.toast(t('menu.backupFailed', { why: e && e.message ? e.message : String(e) }), 'bad'));
}
/** Back up without backupColony: save, then hand the blob to the share sheet (or download it). */
async function backUp(ctx, api) {
  try {
    await api.saveNow();
    const x = await api.exportBlob(ctx.s.id);
    const file = typeof File === 'function' ? new File([x.bytes], x.filename, { type: 'application/octet-stream' }) : null;
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: t('menu.backupTitle') }); ctx.toast(t('menu.backupShared')); return; }
    const url = URL.createObjectURL(new Blob([x.bytes], { type: 'application/octet-stream' }));
    const a = document.createElement('a'); a.href = url; a.download = x.filename; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    ctx.toast(t('menu.backupSaved', { file: x.filename }));
  } catch (e) { if (e && e.name === 'AbortError') return; ctx.toast(t('menu.backupFailed', { why: e && e.message ? e.message : String(e) }), 'bad'); }
}
