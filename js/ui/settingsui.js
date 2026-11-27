// Settings and Storage (owner I; W1.4, EMBERCROWN-WORLD.md 8.7, 11 item 12; A request W1.4a: the Storage UI moves
// out of js/main.js). Every setting of A's save/settings.js, grouped Display, Play, Sound, Storage, Accessibility,
// with a jump strip that scrolls to each group. Yes/no settings are pixel-art switches (a 44 x 28 pt switch inside a
// 44 pt row; the whole row is the target, one tap toggles). Values live in A's settings (readSettings /
// writeSettings, applied to <html> as data-ec-*). Backup reminders can be turned off only in the Home Screen app.
//   openSettings(ctx, api)        the in-game sheet (a push from the Menu at the large detent)
//   settingsList(el, o)           the groups (in-game and on the title): o { read(), write(patch), toast(text),
//                                 standalone, storage?(el) (fills the Storage group), jump? (false: no strip) }
//   SETTING_GROUPS                [[group id, [setting keys]]]
//   mountRecoverPanel(el, opts)   Storage > Recover from a device problem (moved from js/main.js; A keeps the data:
//                                 recoveryList, recoverCopy, RECOVER_TEXT); opts.onLoaded(state), opts.toast(text)
// t-keys: settings.group.*
import { h, clear, onTap, icon } from './kit.js';
import { t } from './strings.js';
import { SETTINGS } from '../game/save/settings.js';
import { openMoveToApp } from './cards.js';
import { recoveryList, recoverCopy, RECOVER_TEXT } from '../main.js';
import { isFallen } from '../game/colony/fall.js';

export const SETTING_GROUPS = Object.freeze([
  ['display', ['textSize', 'reduceMotion', 'batterySaver', 'colourSafe']],
  ['play', ['autoPauseImminent', 'autoPauseLetter', 'autoPauseDowned', 'advancedGrid']],
  ['sound', ['sound', 'music', 'volume']],
  ['storage', ['backupPrompt']],
  ['access', ['leftHanded', 'twoFingerPause']],
]);

/** The in-game Settings sheet: the groups, then Storage's facts and actions inside its group. */
export function openSettings(ctx, api) {
  const standalone = !!(api.isStandalone && api.isStandalone());
  ctx.openSheet(t('settings.title'), (el) => {
    settingsList(el, { read: () => (api.readSettings ? api.readSettings() : {}), write: (patch) => { if (api.writeSettings) api.writeSettings(patch); },
      toast: ctx.toast, standalone, storage: (box) => storageGroup(box, ctx, api, standalone) });
  }, { push: true, detent: 'large', help: 'Settings' });
}

/** A pixel-art switch row: label and help on the left, the 44 x 28 switch on the right; one tap toggles. */
function switchRow(key, d, v, enabled, o) {
  const b = h('button.ec-row.ec-toggle.ec-swrow', { type: 'button', role: 'switch', 'aria-checked': v ? 'true' : 'false', 'data-act': 'set-' + key, 'aria-disabled': enabled ? null : 'true' },
    h('span.ec-row-n', null, d.label, h('span.ec-row-help', { text: enabled ? d.help : t('settings.appOnly') })),
    h('span.ec-switch', { 'aria-hidden': 'true' }, h('i')));
  let on = !!v;
  onTap(b, () => {
    if (!enabled) { o.toast(t('settings.appOnlyToast')); return; }
    on = !on;
    o.write({ [key]: on });
    b.setAttribute('aria-checked', on ? 'true' : 'false');
  });
  return b;
}

/** The setting groups with a jump strip on top (o.jump === false: none). */
export function settingsList(el, o) {
  const st = o.read() || {}, app = !!o.standalone;
  const heads = {};
  if (o.jump !== false) {
    const strip = h('div.ec-strip.ec-setjump', { role: 'navigation', 'aria-label': t('settings.jump') });
    for (const [g] of SETTING_GROUPS) {
      const b = h('button.ec-strip-tab', { type: 'button', 'data-act': 'set-jump-' + g, text: t('settings.group.' + g) });
      onTap(b, () => { const x = heads[g]; if (x && x.scrollIntoView) x.scrollIntoView({ block: 'start', behavior: 'auto' }); });
      strip.append(b);
    }
    el.append(strip);
  }
  for (const [g, keys] of SETTING_GROUPS) {
    const head = h('h3.ec-sub.ec-setgroup', { id: 'set-' + g, 'data-group': g, text: t('settings.group.' + g) });
    heads[g] = head;
    el.append(head);
    for (const key of keys) {
      const d = SETTINGS[key];
      if (!d) continue;
      const v = st[key] === undefined ? d.def : st[key];
      if (d.type === 'bool') el.append(switchRow(key, d, v, key !== 'backupPrompt' || app, o));
      else if (d.type === 'enum') el.append(enumRow(key, d, v, o));
      else if (d.type === 'int') el.append(intRow(key, d, v, o));
    }
    if (g === 'storage' && o.storage) { const box = h('div.ec-setstore'); el.append(box); o.storage(box); }
  }
}
/** A segmented choice (Text size: 100 %, 115 %, 130 %): one tap picks. */
function enumRow(key, d, v, o) {
  const seg = h('div.ec-seg', { role: 'radiogroup', 'aria-label': d.label });
  const pick = (x) => { for (const b of seg.children) { const on = b.dataset.v === String(x); b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); } };
  for (const x of d.vals) {
    const b = h('button.ec-seg-b' + (v === x ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': v === x ? 'true' : 'false', 'data-act': `set-${key}-${x}`, 'data-v': String(x), text: key === 'textSize' ? `${x}%` : String(x) });
    onTap(b, () => { o.write({ [key]: x }); pick(x); });
    seg.append(b);
  }
  return h('div.ec-setenum', null, h('span.ec-row-n', null, d.label, h('span.ec-row-help', { text: d.help })), seg);
}
/** A number with - and + (Volume, steps of 10). */
function intRow(key, d, v0, o) {
  let v = v0;
  const step = 10;
  const n = h('b.ec-bill-n', { text: String(v) });
  const minus = h('button.ec-ibtn.ec-mini', { type: 'button', 'data-act': `set-${key}-minus`, 'aria-label': t('settings.down', { name: d.label }), html: icon('minus') });
  const plus = h('button.ec-ibtn.ec-mini', { type: 'button', 'data-act': `set-${key}-plus`, 'aria-label': t('settings.up', { name: d.label }), html: icon('plus') });
  const set = (x) => { v = Math.max(d.min, Math.min(d.max, x)); o.write({ [key]: v }); n.textContent = String(v); minus.disabled = v <= d.min; plus.disabled = v >= d.max; };
  minus.disabled = v <= d.min; plus.disabled = v >= d.max;
  onTap(minus, () => set(v - step));
  onTap(plus, () => set(v + step));
  return h('div.ec-row.ec-setint', null, h('span.ec-row-n', { text: d.label }), minus, n, plus);
}

/** Settings / Storage in the game: whether the browser keeps the saves, the use, Back up and Move to the app. */
function storageGroup(box, ctx, api, standalone) {
  const info = h('p.ec-bio-d', { role: 'status', text: t('settings.checking') });
  box.append(info);
  if (!standalone) {
    const mv = h('button.ec-row', { type: 'button', 'data-act': 'menu-move' }, h('span.ec-menu-ic', { html: icon('share') }), h('span.ec-row-n', null, t('settings.move'), h('span.ec-row-help', { text: t('settings.moveHelp') })));
    onTap(mv, () => openMoveToApp(ctx, api));
    box.append(mv);
  }
  if (!api.storageInfo) { info.textContent = t('settings.noInfo'); return; }
  api.storageInfo().then((x) => {
    const kb = (n) => (n === null || n === undefined ? null : `${Math.max(1, Math.round(n / 1024))} KB`);
    const used = kb(x.usage), mine = (x.colonies || []).find((c) => c.id === ctx.s.id);
    info.textContent = [x.persistText, x.mode === 'idb' ? t('settings.modeIdb') : x.mode === 'local' ? t('settings.modeLocal') : x.mode === 'none' ? t('settings.modeNone') : '',
      mine && mine.size ? t('settings.thisHold', { size: kb(mine.size) }) : '', used ? t('settings.siteUses', { size: used }) : '',
      x.max ? t('settings.holdCount', { n: x.count || (x.colonies || []).length, max: x.max }) : ''].filter(Boolean).join(' ');
  }).catch(() => { info.textContent = t('settings.infoFailed'); });
}

/**
 * Storage > Recover from a device problem (DOM, browser only; moved from js/main.js for A request W1.4a): one
 * section per colony, one row per stored copy; a tap asks once (RECOVER_TEXT.confirm), then loads through A's
 * recoverCopy. opts.onLoaded(state) enters the game, opts.toast(text).
 */
export function mountRecoverPanel(el, opts = {}) {
  const root = h('section.ec-recover', { 'data-panel': 'recover' }, h('h3.ec-sub', { text: RECOVER_TEXT.title }), h('p.ec-bio-d', { text: RECOVER_TEXT.help }));
  const list = h('div.ec-recover-list', { role: 'list' });
  const status = h('p.ec-bio-d', { role: 'status', text: t('settings.reading') });
  root.append(list, status);
  el.append(root);
  const ask = (row, c, k) => {
    for (const x of list.querySelectorAll('.ec-recover-ask')) x.remove();
    const yes = h('button.ec-btn.primary', { type: 'button', 'data-act': 'recover-load' }, h('span.ec-btn-label', { text: RECOVER_TEXT.load }), h('span.ec-btn-sub', { text: `${c.name}, ${k.date}` }));
    const no = h('button.ec-btn', { type: 'button', 'data-act': 'recover-cancel' }, h('span.ec-btn-label', { text: RECOVER_TEXT.cancel }));
    const box = h('div.ec-recover-ask', { role: 'group', 'aria-label': `${c.name}: ${k.label}`, style: { display: 'grid', gap: '10px', margin: '4px 0 12px' } }, h('p.ec-bio-d', { text: RECOVER_TEXT.confirm }), yes, no);
    row.after(box);
    no.addEventListener('click', () => box.remove());
    yes.addEventListener('click', async () => {
      yes.disabled = true; status.textContent = t('settings.loading');
      try {
        const s = await recoverCopy(c.id, k.which);
        status.textContent = isFallen(s) ? t('settings.ruinCopy') : RECOVER_TEXT.done;
        if (opts.toast) opts.toast(status.textContent);
        if (opts.onLoaded) opts.onLoaded(s);
      } catch (e) { yes.disabled = false; status.textContent = t('settings.loadFailed', { why: e && e.message ? e.message : String(e) }); }
    });
  };
  recoveryList().then((cols) => {
    clear(list);
    if (!cols.length) { status.textContent = RECOVER_TEXT.none; return; }
    status.textContent = '';
    for (const c of cols) {
      list.append(h('h4.ec-row-help', { role: 'heading', 'aria-level': '4', text: c.fallen ? (c.fellText ? t('settings.fell', { name: c.name, date: c.fellText }) : t('settings.fellNoDate', { name: c.name })) : c.name }));
      if (!c.copies.length) { list.append(h('p.ec-row-help', { text: t('settings.noCopy') })); continue; }
      for (const k of c.copies) {
        const row = h('button.ec-row', { type: 'button', role: 'listitem', 'data-act': 'recover-copy', 'data-colony': c.id, 'data-which': k.which },
          h('span.ec-row-n', { text: k.date }), h('span.ec-row-s', { text: k.fallen ? t('settings.copyFallen', { label: k.label }) : k.label }));
        row.addEventListener('click', () => ask(row, c, k));
        list.append(row);
      }
    }
  }).catch(() => { status.textContent = t('settings.readFailed'); });
  return root;
}
