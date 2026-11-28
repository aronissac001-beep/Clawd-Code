// The front end (owner I; EMBERCROWN-WORLD.md 8.3, 3.1, step W1.6; was colonies.js): the title screen and
// Holds and ruins.
//   Title          [Fallen card of the hold that fell last]  Continue: <newest standing hold>  (hidden on the first
//                  run; greyed while only Ruins are saved)  |  New hold [Options]  |  Worlds (only while the REALM
//                  flag is on; W2 fills it)  |  Holds and ruins (once anything is saved)  |  Import a file  |
//                  Paste a hold from Safari (the Home Screen app only)  |  Settings  Help
//   New hold       founds at once with the defaults while REALM is off: a cold start reaches the map in one tap
//                  (the oracle is 2). Options holds the start choices (storyteller, difficulty, name, map).
//   Holds and ruins every saved hold (Continue it, Delete it) and every Ruin (its Fallen card: Annals, View the
//                  ruin, Export, Delete; never Continue, EMBERCROWN-FORTRESS.md 1.3), and Import a file.
//   Settings       the device settings (settingsui.js) and Storage: Recover from a device problem and, for one
//                  release, the "Old roguelite saves" row (export, then remove the embercrown.* keys).
//   Help           the Help cards (help.js).
// Every string goes through t() (strings.js, G25); the rows are the "front.*" group of strings-en.js.
//
// Contract with js/ui/app.js (owner I) and js/main.js (owner A):  mountTitle(root, api, opts?)
//   api.listColonies() -> [card]            C14 index (cards from slots.cardOf)
//   api.newColony(opts?) -> state | Promise opts: { seed, name, storyteller, difficulty }
//   api.colonyRoom()   -> null | reason      optional: can one more hold be founded (8 at most)
//   api.readSettings(), api.writeSettings(patch)   optional: the title's Settings
//   api.continueColony(id) -> Promise<state | null>   null when the blob is missing (eviction, 11.1)
//   api.enter(s, o)    -> void              start the in-game shell on that state
//   api.importBlob(bytes | text) -> Promise<card>   optional: Import a file (C14)
//   api.isStandalone(), api.pasteColonyFromSafari()   optional: the Home Screen app's paste (11.5)
//   api.openWorlds()   -> void              optional: replaces the Worlds screen of embark.js (W2.7a)
// With REALM on (or ?realm=1), New hold opens the World step (embark.js worldsView 'new': Quick start first, the saved
// worlds, Create a world); Worlds opens the same list to manage ('manage'). Founding goes through api.newColony with
// { seed, name, start, difficulty, storyteller, realm, wid, rx, ry } (W2.8 founds in the region).
//   opts.view          'main' (default) | 'holds' | 'settings' | 'help': the view to open on (Menu > Holds and
//                      ruins quits to the title on 'holds')
// mountTitle is idempotent: a second call moves the one title into the new root.
import { h, clear, onTap } from './kit.js';
import { t } from './strings.js';
import { SEASON_NAMES } from '../game/core/time.js';
import { mountTitleArt } from '../engine/art/title.js';
import { all } from '../game/core/content.js';
import { DIFFICULTIES } from '../game/core/schema.js';
import * as FLAGS from '../game/core/flags.js';
import { settingsList } from './sheet.js';
import { randomSeedText } from '../engine/rng.js';
import { deleteColony, classicSaves } from '../game/save/slots.js';
import { installSim } from '../game/core/setup.js';
import { exportClassicSaves, clearClassicSaves } from '../main.js';
import { mountRecoverPanel } from './settingsui.js';
import { HELP_CARDS } from './help.js';
import { fallenCard, annalsView, loadRuinState, prepareRuinExport, shareRuinExport, exportedText, RUIN_TEXT } from './ruin.js';
import { STAGE } from './stage.js';
import { worldsView as embarkWorlds, closeOverlay as closeEmbark } from './embark.js';

// t-keys: front.diff.*
const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
/** Run fn once the status line has been painted (two frames; a timer where there is no rAF). */
const afterPaint = (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => requestAnimationFrame(fn)) : setTimeout(fn, 0));
const msg = (e) => (e && e.message ? e.message : String(e));

/** Worlds shows while the REALM flag is on (W2; G31), or with the debug URL ?realm=1. */
export function realmOn(search = typeof location !== 'undefined' ? location.search : '') {
  if (FLAGS.REALM === true) return true;
  try { return new URLSearchParams(search || '').get('realm') === '1'; } catch (_) { return false; }
}

let mounted = null;   // { root, node, art }

const safeAll = (k) => { try { return all(k); } catch (_) { return []; } };
/** The season index (0 Thaw .. 3 Deepcold) of a card's day, or null without a card. */
export const seasonOfCard = (c) => (c ? Math.floor((c.day || 0) / 10) % 4 : null);
/** "Year 3, Thaw day 4 · 7 colonists · Deepest: -6" */
export function cardLine(c) {
  const when = t('front.when', { year: (c.year || 0) + 1, season: SEASON_NAMES[seasonOfCard(c)] || '', day: (c.dayOfSeason || 0) + 1 });
  const parts = [when, t('front.pop', { n: c.pop || 0 })];
  // Stage Z1 (EMBERCROWN-FORTRESS.md 4.6): a hold with depth says how deep it has dug
  if ((c.d || 1) > 1 && (c.deepest | 0) < 0) parts.push(t('front.deepest', { n: c.deepest | 0 }));
  return parts.join(' · ');
}
/** Cards newest first, the newest standing hold (Continue) and the Ruin to lead the title (fell last). */
export function frontPlan(cards) {
  const byPlayed = (cards || []).slice().sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
  const last = byPlayed.find((c) => !c.fallen) || null;
  const lead = byPlayed[0] && byPlayed[0].fallen ? byPlayed[0] : null;
  return { byPlayed, last, lead, fallen: byPlayed.filter((c) => c.fallen).length };
}

/**
 * Mount the title into `root`. Returns { node, refresh(), status, show(view) }.
 */
export function mountTitle(root, api, opts = {}) {
  closeEmbark();
  if (mounted && mounted.root !== root) { mounted.node.remove(); mounted.root.classList.remove('ec-title-root'); }
  if (mounted && mounted.art) { try { mounted.art.destroy(); } catch (_) { /* gone */ } }
  if (typeof document !== 'undefined') document.body.classList.add('ec-ui');
  clear(root);
  root.classList.add('ec-title-root');
  const status = h('p.ec-title-status', { role: 'status', 'aria-live': 'polite' });
  // min-width 0: in the landscape grid a wide Settings list must not widen the column (it scrolls instead)
  const list = h('div.ec-title-actions', { style: { minWidth: '0' } });
  // the backdrop: D's pixel mountain with the hold in its flank, in the last save's season (js/engine/art/title.js)
  const bg = h('div.ec-title-bg');
  const node = h('section.ec-title', { 'aria-label': t('front.aria') },
    bg,
    h('div.ec-title-col', null,
      h('header.ec-title-head', null,
        h('h1.ec-title-name', { text: t('front.name') }),
        h('p.ec-title-sub', { text: t('front.sub') })),
      h('p.ec-title-pitch', { text: t('front.pitch') }),
      list,
      status,
    ));
  let art = null;
  const readCards = () => { try { return api.listColonies() || []; } catch (_) { status.textContent = t('front.unreadable'); return []; } };
  const busy = (on) => { for (const b of list.querySelectorAll('button')) b.disabled = on || b.dataset.off === '1'; };
  const button = (spec, act, label, sub, fn, attrs = {}) => {
    const b = h('button.ec-btn' + spec, { type: 'button', 'data-act': act, ...attrs }, h('span.ec-btn-label', { text: label }), sub ? h('span.ec-btn-sub', { text: sub }) : null);
    if (fn) onTap(b, fn);
    return b;
  };
  // a row of buttons: equal shares, or a fixed side button (data-side) beside a wide one. Inline until the CSS
  // has .ec-title-pair (requested of css/style.css's owner)
  const pair = (...kids) => h('div.ec-title-pair', { style: { display: 'flex', gap: '8px', alignItems: 'stretch' } }, ...kids.map((k) => {
    const side = !!k.dataset.side;
    Object.assign(k.style, { flex: side ? '0 0 auto' : '1 1 0', width: side ? 'auto' : '0', minWidth: side ? '104px' : '0' });
    return k;
  }));

  let view = ['holds', 'settings', 'help'].includes(opts.view) ? opts.view : 'main';
  const show = (v) => { view = v; refresh(); };
  const back = () => button('.ec-back', 'title-back', t('front.back'), null, () => show('main'));
  const heading = (text) => h('h2.ec-title-h', { text });
  const refresh = () => {
    clear(list);
    const cards = readCards();
    const plan = frontPlan(cards);
    const season = seasonOfCard(plan.byPlayed[0] || null);
    if (!art) { try { art = mountTitleArt(bg, { season }); } catch (_) { art = null; /* no canvas: the CSS gradient alone */ } }
    else if (art.setSeason) art.setSeason(season);
    if (mounted && mounted.node === node) mounted.art = art;
    if (view === 'options') return optionsView();
    if (view === 'holds') return holdsView();
    if (view === 'settings') return settingsView();
    if (view === 'help') return helpView();
    if (view === 'annals') return annalsTitleView();
    if (view === 'worlds' || view === 'world') return worldsView(view);
    mainView(cards, plan);
  };

  // ---- the title ------------------------------------------------------------------------------------
  function mainView(cards, { last, lead, fallen }) {
    // the hold that fell last (played after any standing one): its Fallen card leads the title
    if (lead) list.append(ruinCard(lead));
    // Continue opens the newest hold that still stands; a Ruin is never continued (1.3). Hidden when none stands.
    // On the first run (nothing saved) it is hidden; with only Ruins saved it stays, greyed, and says why.
    if (last) {
      // eviction (11.1): refreshColonies marks a card whose blob is gone; say so before any tap
      if (last.missing) status.textContent = t('front.missingImport', { name: last.name });
      list.append(button('.primary.ec-continue', 'continue', t('front.continue', { name: last.name }), last.missing ? t('front.missingShort') : cardLine(last), () => openHold(last)));
    } else if (cards.length) {
      const off = button('.ec-continue', 'continue', t('front.continueNone'), t('front.noneStands'), null);
      off.disabled = true; off.dataset.off = '1';
      list.append(off);
    }
    const fresh = button('.ec-new' + (last ? '' : '.primary'), 'new', t('front.new'), t('front.newSub'), () => (realmOn() ? show('world') : found(null)));
    const more = button('.ec-new-opts', 'new-options', t('front.options'), null, () => show('options'), { 'aria-label': t('front.optionsAria'), dataset: { side: '1' } });
    list.append(pair(fresh, more));
    if (realmOn()) list.append(button('.ec-worlds', 'worlds', t('front.worlds'), t('front.worldsSub'), () => (api.openWorlds ? api.openWorlds() : show('worlds'))));
    if (cards.length) list.append(button('.ec-holds', 'holds', t('front.holds', { n: cards.length }), fallen ? t('front.holdsSubFallen', { n: fallen }) : t('front.holdsSub'), () => show('holds')));
    importButtons();
    const row = [];
    if (api.readSettings) row.push(button('.ec-settings', 'title-settings', t('front.settings'), null, () => show('settings')));
    row.push(button('.ec-help-b', 'title-help', t('front.help'), null, () => show('help')));
    list.append(pair(...row));
  }
  /** Import a file (11.5: picked from Files or the share sheet's save) and, in the Home Screen app, the paste. */
  function importButtons() {
    if (api.importBlob) {
      const file = h('input', { type: 'file', accept: '.ec2,.ecsave,.txt,application/octet-stream,text/plain', hidden: true, 'aria-hidden': 'true' });
      const imp = button('.ec-import', 'import', t('front.import'), null, () => file.click());
      file.addEventListener('change', async () => {
        const f = file.files && file.files[0];
        if (!f) return;
        busy(true); status.textContent = t('front.importReading');
        try {
          const buf = new Uint8Array(await f.arrayBuffer());
          const isText = buf.length > 4 && buf[3] === 0x3a;   // 'EC2:' text form, else the binary blob
          const card = await api.importBlob(isText ? new TextDecoder().decode(buf) : buf);
          status.textContent = t('front.imported', { name: card && card.name ? card.name : t('front.theHold') });
          refresh();
        } catch (e) { status.textContent = t('front.importFailed', { why: msg(e) }); busy(false); }
      });
      list.append(imp, file);
    }
    // the Home Screen app (11.5): bring a hold over from Safari (Move colony to the app copied it)
    if (api.pasteColonyFromSafari && api.isStandalone && api.isStandalone()) {
      list.append(button('.ec-paste', 'paste', t('front.paste'), t('front.pasteSub'), async () => {
        busy(true); status.textContent = t('front.pasteReading');
        try {
          const r = await api.pasteColonyFromSafari();
          status.textContent = r.verified ? t('front.pasted', { name: r.name || t('front.theHold'), text: r.text }) : r.text;
          refresh();
        } catch (e) { status.textContent = msg(e); busy(false); }
      }));
    }
  }
  /** Found a hold (null: the defaults) and enter it; "Carving the hold" is painted before mapgen3 runs. */
  function found(o) {
    const room = api.colonyRoom ? api.colonyRoom() : null;
    if (room) { status.textContent = room; return; }
    busy(true);
    status.textContent = t('front.carving');
    afterPaint(() => {
      try { const s0 = o ? api.newColony(o) : api.newColony(); status.textContent = ''; view = 'main'; api.enter(s0); }
      catch (e) { status.textContent = t('front.foundFailed', { why: msg(e) }); busy(false); }
    });
  }
  async function openHold(c) {
    busy(true); status.textContent = t('front.opening', { name: c.name });
    try {
      const s0 = await api.continueColony(c.id);
      if (!s0) { status.textContent = t('front.missingImport', { name: c.name }); busy(false); return; }
      status.textContent = ''; view = 'main'; api.enter(s0, { resumed: true });
    } catch (e) { status.textContent = t('front.openFailed', { name: c.name, why: msg(e) }); busy(false); }
  }

  // ---- New hold > Options: the start choices --------------------------------------------------------
  const pick = { storyteller: null, difficulty: 'steadfast', name: t('front.defaultName'), seed: null };
  function optionsView() {
    const tellers = safeAll('storyteller');
    if (!pick.storyteller) pick.storyteller = (tellers.find((x) => x.default) || tellers[0] || { id: null }).id;
    if (!pick.seed) pick.seed = randomSeedText();
    const seg = (label, items, cur, set) => {
      const box = h('div.ec-title-opt', null, h('p.ec-title-more', { text: label }));
      const row = h('div.ec-seg.ec-seg-wrap', { role: 'radiogroup', 'aria-label': label });
      for (const [id, name] of items) {
        const b = h('button.ec-seg-b' + (cur === id ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': cur === id ? 'true' : 'false', 'data-act': 'opt-' + id, text: name });
        onTap(b, () => { set(id); refresh(); });
        row.append(b);
      }
      box.append(row);
      return box;
    };
    const teller = tellers.find((x) => x.id === pick.storyteller);
    list.append(heading(t('front.optionsTitle')),
      seg(t('front.storyteller'), tellers.map((x) => [x.id, x.name.replace(/^The /, '')]), pick.storyteller, (v) => { pick.storyteller = v; }),
      h('p.ec-title-more', { text: teller ? teller.text || '' : '' }),
      seg(t('front.difficulty'), DIFFICULTIES.map((d) => [d, cap(d)]), pick.difficulty, (v) => { pick.difficulty = v; }),
      h('p.ec-title-more', { text: t('front.diff.' + pick.difficulty) }));
    const name = h('input.ec-copybox.ec-title-input', { type: 'text', maxlength: '40', value: pick.name, 'aria-label': t('front.nameLabel'), 'data-act': 'opt-name' });
    name.addEventListener('input', () => { pick.name = name.value.slice(0, 40) || t('front.defaultName'); });
    const seed = button('.ec-seed', 'opt-seed', t('front.map', { seed: pick.seed }), t('front.mapSub'), () => { pick.seed = randomSeedText(); refresh(); });
    // with REALM on the picks carry into the World step (the hold seed then comes from the region, G2)
    const go = button('.primary', 'opt-found', t('front.foundIt'), null, () => (realmOn() ? show('world') : found({ seed: pick.seed, name: pick.name, storyteller: pick.storyteller, difficulty: pick.difficulty })));
    list.append(h('p.ec-title-more', { text: t('front.nameLabel') }), name, seed, go, back());
  }

  // ---- Holds and ruins -------------------------------------------------------------------------------
  function holdsView() {
    const { byPlayed } = frontPlan(readCards());
    list.append(heading(t('front.holdsTitle')));
    if (!byPlayed.length) list.append(h('p.ec-title-more', { text: t('front.holdsNone') }));
    for (const c of byPlayed) {
      if (c.fallen) { list.append(ruinCard(c)); continue; }
      const b = button('', 'colony-open', c.name, c.missing ? t('front.missingShort') : cardLine(c), () => openHold(c));
      // Delete (owner request): tap once to arm, tap again to delete for good; arming lapses after 4 s
      const del = button('.ec-colony-del', 'colony-delete', t('front.del'), null, null, { 'aria-label': t('front.delAria', { name: c.name }) });
      let disarm = null;
      onTap(del, async () => {
        if (del.dataset.sure !== '1') {
          del.dataset.sure = '1'; del.classList.add('bad'); del.querySelector('.ec-btn-label').textContent = t('front.delSure');
          status.textContent = t('front.delWarn', { name: c.name });
          disarm = setTimeout(() => { delete del.dataset.sure; del.classList.remove('bad'); del.querySelector('.ec-btn-label').textContent = t('front.del'); }, 4000);
          return;
        }
        clearTimeout(disarm);
        try { await deleteColony(c.id); status.textContent = t('front.deleted', { name: c.name }); refresh(); }
        catch (e) { status.textContent = t('front.delFailed', { name: c.name, why: msg(e) }); }
      });
      list.append(h('div.ec-colony-row', null, b, del));
    }
    importButtons();
    list.append(back());
  }

  // ---- Settings and Help -----------------------------------------------------------------------------
  function settingsView() {
    const box = h('div.ec-title-settings');
    if (api.readSettings) settingsList(box, { read: () => api.readSettings(), write: (p) => { api.writeSettings(p); refresh(); }, toast: (x) => { status.textContent = x; }, standalone: !!(api.isStandalone && api.isStandalone()) });
    storageBlock(box);
    list.append(heading(t('front.settings')), box, back());
  }
  function helpView() {
    const box = h('div.ec-title-settings.ec-title-help');
    for (const [title, text] of HELP_CARDS) box.append(h('section.ec-bio.ec-helpcard', null, h('h3.ec-sub', { text: title }), h('p.ec-bio-d', { text })));
    list.append(heading(t('front.help')), box, back());
  }
  // ---- Settings > Storage: the old roguelite saves (one release) and Recover from a device problem ----------
  function storageBlock(box) {
    box.append(h('h3.ec-sub', { text: t('front.storage') }));
    let old = { keys: [], chars: 0 };
    try { old = classicSaves(); } catch (_) { /* no localStorage */ }
    if (old.keys.length) {
      const kb = Math.max(1, Math.round((old.chars * 2) / 1024));
      const row = h('button.ec-row', { type: 'button', 'data-act': 'old-saves' },
        h('span.ec-row-n', null, t('front.oldSaves', { kb }), h('span.ec-row-help', { text: t('front.oldSavesHelp') })),
        h('span.ec-row-s', { text: t('front.oldSavesAct') }));
      onTap(row, async () => {
        status.textContent = t('front.oldSavesExporting');
        try {
          const r = await exportClassicSaves();
          if (!r.ok) { status.textContent = r.reason && r.reason !== 'cancelled' ? r.reason : t('front.oldSavesKept'); return; }
          clearClassicSaves(r.token);
          status.textContent = t('front.oldSavesDone', { file: r.filename });
          refresh();
        } catch (e) { status.textContent = t('front.oldSavesFailed', { why: msg(e) }); }
      });
      box.append(row);
    }
    try {
      mountRecoverPanel(box, {
        toast: (x) => { status.textContent = x; },
        onLoaded: (s0) => { installSim({ stage: STAGE }); view = 'main'; api.enter(s0, { resumed: true }); },
      });
    } catch (_) { box.append(h('p.ec-bio-d', { text: t('front.noCopies') })); }
  }

  // ---- Worlds (W2.7a, embark.js): the World step of New hold ('world') and the Worlds screen ('worlds') ----------
  function worldsView(v) {
    if (!realmOn()) { list.append(heading(t('front.worlds')), h('p.ec-title-more', { text: t('front.worldsNone') }), back()); return; }
    embarkWorlds({ api, root, list, status, busy, show, refresh, pick: { name: pick.name !== t('front.defaultName') ? pick.name : undefined, difficulty: pick.difficulty, storyteller: pick.storyteller }, entered: () => { view = 'main'; } }, v === 'world' ? 'new' : 'manage');
  }

  // ---- the Fallen card (1.3): Annals, View the ruin, Export, Delete. No Continue, no backup -----------------
  const exports = new Map();   // colony id -> Promise of the prepared export files (ready before the tap)
  const prepExport = (c) => { if (!exports.has(c.id)) exports.set(c.id, prepareRuinExport(c.id).catch((e) => { exports.delete(c.id); throw e; })); return exports.get(c.id); };
  let annalsOf = null, annalsFrom = 'main';
  function ruinCard(c) {
    if (!c.missing) prepExport(c).catch(() => null);
    return fallenCard(c, {
      annals: () => { annalsOf = c; annalsFrom = view; show('annals'); },
      view: async () => {
        busy(true); status.textContent = t('front.ruinOpening', { name: c.name });
        try {
          const s0 = await api.continueColony(c.id);
          if (!s0) { status.textContent = t('front.missing', { name: c.name }); busy(false); return; }
          status.textContent = ''; view = 'main'; api.enter(s0, { resumed: false, ruin: true });
        } catch (e) { status.textContent = t('front.ruinFailed', { why: msg(e) }); busy(false); }
      },
      export: async () => {
        status.textContent = t('front.exporting');
        try { const r = await shareRuinExport(await prepExport(c)); status.textContent = exportedText(r); }
        catch (e) { status.textContent = t('front.exportFailed', { why: msg(e) }); }
      },
      del: async () => {
        try { await deleteColony(c.id); exports.delete(c.id); status.textContent = t('front.deleted', { name: c.name }); refresh(); }
        catch (e) { status.textContent = t('front.delFailed', { name: c.name, why: msg(e) }); }
      },
    });
  }
  function annalsTitleView() {
    const c = annalsOf;
    const box = h('div.ec-title-settings.ec-title-annals', { 'aria-label': c ? t('front.annalsOf', { name: c.name, annals: RUIN_TEXT.annals }) : RUIN_TEXT.annals });
    box.append(h('h2.ec-title-h', { text: c ? t('front.annalsOf', { name: c.name, annals: RUIN_TEXT.annals }) : RUIN_TEXT.annals }));
    const wait = h('p.ec-bio-d', { text: t('front.annalsReading') });
    box.append(wait);
    const from = annalsFrom === 'holds' ? 'holds' : 'main';
    list.append(box, button('.ec-back', 'title-back', t('front.back'), null, () => show(from)));
    if (!c) { wait.textContent = t('front.annalsNone'); return; }
    loadRuinState(c.id).then((s0) => { wait.remove(); if (s0) annalsView(box, s0); else box.append(h('p.ec-bio-d', { text: t('front.missing', { name: c.name }) })); })
      .catch((e) => { wait.textContent = t('front.annalsFailed', { why: msg(e) }); });
  }
  root.append(node);
  mounted = { root, node, art: null };
  refresh();
  return { node, refresh, status, show };
}

/** Remove the title (entering the game). */
export function unmountTitle() {
  closeEmbark();
  if (!mounted) return;
  if (mounted.art) { try { mounted.art.destroy(); } catch (_) { /* gone */ } }
  mounted.node.remove();
  mounted.root.classList.remove('ec-title-root');
  mounted = null;
}
