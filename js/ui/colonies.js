// Title screen and colony list (owner I; doc 10.8): Continue | Colonies | New colony | Settings |
// Import. New colony founds at once with the defaults; "Choose the start" opens the options (storyteller, difficulty, name, seed).
// Colonies lists every saved colony (up to 8, A's colonyRoom) with Continue for each.
// Stage 2.9 (EMBERCROWN-FORTRESS.md 1.3, F8): a fallen colony is a Ruin. Continue never opens one; its
// Fallen card (ruin.js) offers Annals, View the ruin, Export and Delete, and no backup. Settings >
// Storage holds Recover from a device problem (settingsui.js mountRecoverPanel) and, for one release, the
// "Old roguelite saves" row (export, then remove the embercrown.* keys; 1.1).
//
// Contract with js/main.js (owner A):  mountTitle(root, api)
//   api.listColonies() -> [card]            C14 index (cards from slots.cardOf)
//   api.newColony(opts?) -> state           opts: { seed, name, storyteller, difficulty } (Stage 2 options)
//   api.colonyRoom()   -> null | reason      optional: can one more colony be founded (8 at most)
//   api.readSettings(), api.writeSettings(patch)   optional: the title's Settings
//   api.continueColony(id) -> Promise<state | null>   null when the blob is missing (eviction, 11.1)
//   api.enter(s)       -> void              start the in-game shell on that state
//   api.importBlob(bytes | text) -> Promise<card>   optional: Import a backup (C14)
//   api.isStandalone(), api.pasteColonyFromSafari()   optional: the Home Screen app's "Paste a colony
//                                           from Safari" (11.5, A's main.js)
// mountTitle is idempotent: a second call moves the one title into the new root.
import { h, clear, onTap } from './kit.js';
import { SEASON_NAMES } from '../game/core/time.js';
import { mountTitleArt } from '../engine/art/title.js';
import { all } from '../game/core/content.js';
import { DIFFICULTIES } from '../game/core/schema.js';
import { settingsList } from './sheet.js';
import { randomSeedText } from '../engine/rng.js';
import { deleteColony, classicSaves } from '../game/save/slots.js';
import { installSim } from '../game/core/setup.js';
import { exportClassicSaves, clearClassicSaves } from '../main.js';
import { mountRecoverPanel } from './settingsui.js';
import { fallenCard, annalsView, loadRuinState, prepareRuinExport, shareRuinExport, exportedText, RUIN_TEXT } from './ruin.js';
import { STAGE } from './stage.js';

const DIFF_TEXT = { hearthkeeper: 'Gentle raids, kind weather: for building.', warden: 'Lighter threats than the default.', steadfast: 'The hold as designed. The default.', hard: 'Heavier raids than the default. A hold that falls stays fallen.' };
const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
const CARVING = 'Carving the world...';
/** Run fn once the status line has been painted (two frames; a timer where there is no rAF). */
const afterPaint = (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => requestAnimationFrame(fn)) : setTimeout(fn, 0));

let mounted = null;   // { root, node }

const PITCH = 'Lead a handful of named survivors into a vale under a mountain. Dig a hold down through soil and stone, keep the Hearth lit, and hold back the Hollow, year after year.';

/** The backdrop: a mountain with a lit hold in its flank (D's pixel art, js/engine/art/title.js). */
function backdrop() {
  const bg = h('div.ec-title-bg');
  try { mountTitleArt(bg); } catch (_) { /* no canvas: the CSS gradient alone */ }
  return bg;
}

const safeAll = (k) => { try { return all(k); } catch (_) { return []; } };
function cardLine(c) {
  const season = SEASON_NAMES[Math.floor((c.day || 0) / 10) % 4] || '';
  const when = `Year ${(c.year || 0) + 1}, ${season} day ${(c.dayOfSeason || 0) + 1}`;
  const pop = c.pop === 1 ? '1 colonist' : `${c.pop || 0} colonists`;
  // Stage Z1 (EMBERCROWN-FORTRESS.md 4.6): a hold with depth says how deep it has dug
  const deep = (c.d || 1) > 1 && (c.deepest | 0) < 0 ? ` · Deepest: ${c.deepest | 0}` : '';
  return `${when} · ${pop}${deep}`;
}

/**
 * Mount the title into `root`. Returns { node, refresh() }.
 */
export function mountTitle(root, api) {
  if (mounted && mounted.root !== root) { mounted.node.remove(); mounted.root.classList.remove('ec-title-root'); }
  if (typeof document !== 'undefined') document.body.classList.add('ec-ui');
  clear(root);
  root.classList.add('ec-title-root');
  const status = h('p.ec-title-status', { role: 'status', 'aria-live': 'polite' });
  const list = h('div.ec-title-actions');
  const node = h('section.ec-title', { 'aria-label': 'Embercrown: The Hold' },
    backdrop(),
    h('div.ec-title-col', null,
      h('header.ec-title-head', null,
        h('h1.ec-title-name', { text: 'Embercrown' }),
        h('p.ec-title-sub', { text: 'The Hold' })),
      h('p.ec-title-pitch', { text: PITCH }),
      list,
      status,
    ));
  const busy = (on) => { for (const b of list.querySelectorAll('button')) b.disabled = on || b.dataset.off === '1'; };

  let view = 'main';
  const back = () => { const b = h('button.ec-btn.ec-back', { 'data-act': 'title-back', type: 'button' }, h('span.ec-btn-label', { text: 'Back' })); onTap(b, () => { view = 'main'; refresh(); }); return b; };
  const refresh = () => {
    clear(list);
    if (view === 'options') return optionsView();
    if (view === 'colonies') return coloniesView();
    if (view === 'settings') return settingsView();
    if (view === 'annals') return annalsTitleView();
    let cards = [];
    try { cards = api.listColonies() || []; } catch (e) { status.textContent = 'Saved colonies could not be read.'; }
    const byPlayed = cards.slice().sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
    // Continue opens the newest hold that still stands; a Ruin is never continued (1.3)
    const last = byPlayed.find((c) => !c.fallen) || null;
    const newestFallen = byPlayed[0] && byPlayed[0].fallen ? byPlayed[0] : null;
    const cont = h('button.ec-btn.primary.ec-continue', { 'data-act': 'continue', type: 'button' },
      h('span.ec-btn-label', { text: 'Continue' }),
      last ? h('span.ec-btn-sub', { text: last.missing ? `${last.name}: missing from this browser` : `${last.name}: ${cardLine(last)}` }) : h('span.ec-btn-sub', { text: cards.length ? 'No hold still stands' : 'No colony yet' }));
    if (!last) { cont.disabled = true; cont.dataset.off = '1'; cont.classList.remove('primary'); }
    // the hold that fell last (played after any standing one): its Fallen card leads the title
    if (newestFallen) list.append(ruinCard(newestFallen));
    // eviction (11.1): refreshColonies marks a card whose blob is gone; say so before any tap
    if (last && last.missing) status.textContent = `${last.name} is missing from this browser's storage. Import a backup to bring it back.`;
    onTap(cont, async () => {
      if (!last) return;
      busy(true); status.textContent = `Opening ${last.name}...`;
      try {
        const s = await api.continueColony(last.id);
        if (!s) { status.textContent = `${last.name} is missing from this browser's storage. Import a backup to bring it back.`; busy(false); return; }
        status.textContent = '';
        api.enter(s, { resumed: true });
      } catch (e) { status.textContent = `${last.name} could not be opened: ${e.message}`; busy(false); }
    });
    const fresh = h('button.ec-btn.ec-new' + (last ? '' : '.primary'), { 'data-act': 'new', type: 'button' },
      h('span.ec-btn-label', { text: 'New colony' }),
      h('span.ec-btn-sub', { text: 'Found a hold, then dig down' }));
    onTap(fresh, () => {
      busy(true);
      // "Carving the world" while the 3D generator runs (EMBERCROWN-FORTRESS.md 4.6): paint the line first
      status.textContent = CARVING;
      afterPaint(() => {
        try { const s = api.newColony(); status.textContent = ''; api.enter(s); }
        catch (e) { status.textContent = `A colony could not be founded: ${e.message}`; busy(false); }
      });
    });
    list.append(cont, fresh);
    if (api.importBlob) {
      // Import a backup (11.5): a file picked from Files or the share sheet's save
      const file = h('input', { type: 'file', accept: '.ec2,.txt,application/octet-stream,text/plain', hidden: true, 'aria-hidden': 'true' });
      const imp = h('button.ec-btn.ec-import', { 'data-act': 'import', type: 'button' }, h('span.ec-btn-label', { text: 'Import a backup' }));
      onTap(imp, () => file.click());
      file.addEventListener('change', async () => {
        const f = file.files && file.files[0];
        if (!f) return;
        busy(true); status.textContent = 'Reading the backup...';
        try {
          const buf = new Uint8Array(await f.arrayBuffer());
          const isText = buf.length > 4 && buf[3] === 0x3a;   // 'EC2:' text form, else the binary 'EC2\0' blob
          const card = await api.importBlob(isText ? new TextDecoder().decode(buf) : buf);
          status.textContent = `${card && card.name ? card.name : 'The colony'} is back. Tap Continue.`;
          refresh();
        } catch (e) { status.textContent = `That backup could not be read: ${e.message}`; busy(false); }
      });
      list.append(imp, file);
    }
    // the Home Screen app (11.5): bring a colony over from Safari (Move colony to the app copied it)
    if (api.pasteColonyFromSafari && api.isStandalone && api.isStandalone()) {
      const paste = h('button.ec-btn.ec-paste', { 'data-act': 'paste', type: 'button' }, h('span.ec-btn-label', { text: 'Paste a colony from Safari' }),
        h('span.ec-btn-sub', { text: 'After Move colony to the app in Safari' }));
      onTap(paste, async () => {
        busy(true); status.textContent = 'Reading the clipboard...';
        try {
          const r = await api.pasteColonyFromSafari();
          status.textContent = r.verified ? `${r.name || 'The colony'} is here. ${r.text}` : r.text;
          refresh();
        } catch (e) { status.textContent = e.message; busy(false); }
      });
      list.append(paste);
    }
    // Stage 2 (10.8): the start options, every colony, settings
    const opts = h('button.ec-btn.ec-new-opts', { 'data-act': 'new-options', type: 'button' }, h('span.ec-btn-label', { text: 'Choose the start' }), h('span.ec-btn-sub', { text: 'Storyteller, difficulty, name' }));
    onTap(opts, () => { view = 'options'; refresh(); });
    list.append(opts);
    // every colony (the main view shows at most the newest standing hold and the newest Ruin)
    if (cards.length > 1) {
      const fallenN = cards.filter((c) => c.fallen).length;
      const cl = h('button.ec-btn.ec-colonies', { 'data-act': 'colonies', type: 'button' }, h('span.ec-btn-label', { text: `Colonies (${cards.length})` }), h('span.ec-btn-sub', { text: fallenN ? `Continue a hold, or read a ruin (${fallenN} fallen)` : 'Continue any saved hold' }));
      onTap(cl, () => { view = 'colonies'; refresh(); });
      list.append(cl);
    }
    if (api.readSettings) {
      const st = h('button.ec-btn.ec-settings', { 'data-act': 'title-settings', type: 'button' }, h('span.ec-btn-label', { text: 'Settings' }));
      onTap(st, () => { view = 'settings'; refresh(); });
      list.append(st);
    }
  };
  // ---- New colony: the start options --------------------------------------------------------------
  const pick = { storyteller: null, difficulty: 'steadfast', name: 'The Hold', seed: null };
  function optionsView() {
    const tellers = safeAll('storyteller');
    if (!pick.storyteller) pick.storyteller = (tellers.find((t) => t.default) || tellers[0] || { id: null }).id;
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
    const t = tellers.find((x) => x.id === pick.storyteller);
    list.append(seg('Storyteller', tellers.map((x) => [x.id, x.name.replace(/^The /, '')]), pick.storyteller, (v) => { pick.storyteller = v; }),
      h('p.ec-title-more', { text: t ? t.text || '' : '' }),
      seg('Difficulty', DIFFICULTIES.map((d) => [d, cap(d)]), pick.difficulty, (v) => { pick.difficulty = v; }),
      h('p.ec-title-more', { text: DIFF_TEXT[pick.difficulty] || '' }));
    const name = h('input.ec-copybox.ec-title-input', { type: 'text', maxlength: '40', value: pick.name, 'aria-label': 'Name of the hold', 'data-act': 'opt-name' });
    name.addEventListener('input', () => { pick.name = name.value.slice(0, 40) || 'The Hold'; });
    const seed = h('button.ec-btn.ec-seed', { type: 'button', 'data-act': 'opt-seed' }, h('span.ec-btn-label', { text: `Map: ${pick.seed}` }), h('span.ec-btn-sub', { text: 'Tap for another map' }));
    onTap(seed, () => { pick.seed = randomSeedText(); refresh(); });
    const go = h('button.ec-btn.primary', { type: 'button', 'data-act': 'opt-found' }, h('span.ec-btn-label', { text: 'Found the hold' }));
    onTap(go, () => {
      const room = api.colonyRoom ? api.colonyRoom() : null;
      if (room) { status.textContent = room; return; }
      busy(true);
      status.textContent = CARVING;
      afterPaint(() => {
        try { const s0 = api.newColony({ seed: pick.seed, name: pick.name, storyteller: pick.storyteller, difficulty: pick.difficulty }); status.textContent = ''; view = 'main'; api.enter(s0); }
        catch (e) { status.textContent = `A colony could not be founded: ${e.message}`; busy(false); }
      });
    });
    list.append(h('p.ec-title-more', { text: 'Name of the hold' }), name, seed, go, back());
  }
  function coloniesView() {
    let cards = [];
    try { cards = api.listColonies() || []; } catch (_) { cards = []; }
    for (const c of cards.slice().sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0))) {
      if (c.fallen) { list.append(ruinCard(c)); continue; }
      const b = h('button.ec-btn', { type: 'button', 'data-act': 'colony-open' }, h('span.ec-btn-label', { text: c.name }), h('span.ec-btn-sub', { text: c.missing ? 'Missing from this browser' : cardLine(c) }));
      onTap(b, async () => {
        busy(true); status.textContent = `Opening ${c.name}...`;
        try { const s0 = await api.continueColony(c.id); if (!s0) { status.textContent = `${c.name} is missing from this browser's storage.`; busy(false); return; } status.textContent = ''; view = 'main'; api.enter(s0, { resumed: true }); }
        catch (e) { status.textContent = `${c.name} could not be opened: ${e.message}`; busy(false); }
      });
      // Delete (owner request): tap once to arm, tap again to delete for good; arming lapses after 4 s
      const del = h('button.ec-btn.ec-colony-del', { type: 'button', 'data-act': 'colony-delete', 'aria-label': `Delete ${c.name}` }, h('span.ec-btn-label', { text: 'Delete' }));
      let disarm = null;
      onTap(del, async () => {
        if (del.dataset.sure !== '1') {
          del.dataset.sure = '1'; del.classList.add('bad'); del.querySelector('.ec-btn-label').textContent = 'Delete for good';
          status.textContent = `Tap "Delete for good" to delete ${c.name}. This cannot be undone; export it first if you want a backup.`;
          disarm = setTimeout(() => { delete del.dataset.sure; del.classList.remove('bad'); del.querySelector('.ec-btn-label').textContent = 'Delete'; }, 4000);
          return;
        }
        clearTimeout(disarm);
        try { await deleteColony(c.id); status.textContent = `${c.name} is deleted.`; refresh(); }
        catch (e) { status.textContent = `${c.name} could not be deleted: ${e.message}`; }
      });
      list.append(h('div.ec-colony-row', null, b, del));
    }
    list.append(back());
  }
  function settingsView() {
    const box = h('div.ec-title-settings');
    settingsList(box, { read: () => api.readSettings(), write: (p) => { api.writeSettings(p); refresh(); }, toast: (t) => { status.textContent = t; }, standalone: !!(api.isStandalone && api.isStandalone()) });
    storageBlock(box);
    list.append(box, back());
  }
  // ---- Settings > Storage: the old roguelite saves (one release) and Recover from a device problem ----------
  function storageBlock(box) {
    box.append(h('h3.ec-sub', { text: 'Storage' }));
    let old = { keys: [], chars: 0 };
    try { old = classicSaves(); } catch (_) { /* no localStorage */ }
    if (old.keys.length) {
      const kb = Math.max(1, Math.round((old.chars * 2) / 1024));
      const row = h('button.ec-row', { type: 'button', 'data-act': 'old-saves' },
        h('span.ec-row-n', null, `Old roguelite saves: ${kb} KB`, h('span.ec-row-help', { text: 'From the old game this hold replaced. Saves them to a file, then removes them.' })),
        h('span.ec-row-s', { text: 'Export and remove' }));
      onTap(row, async () => {
        status.textContent = 'Exporting the old saves...';
        try {
          const r = await exportClassicSaves();
          if (!r.ok) { status.textContent = r.reason === 'cancelled' ? 'Nothing was removed.' : (r.reason || 'Nothing was removed.'); return; }
          clearClassicSaves(r.token);
          status.textContent = `The old saves are in ${r.filename} and are removed from this browser.`;
          refresh();
        } catch (e) { status.textContent = `The old saves were not removed: ${e && e.message ? e.message : e}`; }
      });
      box.append(row);
    }
    try {
      mountRecoverPanel(box, {
        toast: (t) => { status.textContent = t; },
        onLoaded: (s0) => { installSim({ stage: STAGE }); view = 'main'; api.enter(s0, { resumed: true }); },
      });
    } catch (_) { box.append(h('p.ec-bio-d', { text: 'The stored copies cannot be listed here.' })); }
  }
  // ---- the Fallen card (1.3): Annals, View the ruin, Export, Delete. No Continue, no backup -----------------
  const exports = new Map();   // colony id -> Promise of the prepared export files (ready before the tap)
  const prepExport = (c) => { if (!exports.has(c.id)) exports.set(c.id, prepareRuinExport(c.id).catch((e) => { exports.delete(c.id); throw e; })); return exports.get(c.id); };
  let annalsOf = null;
  function ruinCard(c) {
    if (!c.missing) prepExport(c).catch(() => null);
    return fallenCard(c, {
      annals: () => { annalsOf = c; view = 'annals'; refresh(); },
      view: async () => {
        busy(true); status.textContent = `Opening the ruin of ${c.name}...`;
        try {
          const s0 = await api.continueColony(c.id);
          if (!s0) { status.textContent = `${c.name} is missing from this browser's storage.`; busy(false); return; }
          status.textContent = ''; view = 'main'; api.enter(s0, { resumed: false, ruin: true });
        } catch (e) { status.textContent = `The ruin could not be opened: ${e.message}`; busy(false); }
      },
      export: async () => {
        status.textContent = 'Preparing the export...';
        try { const r = await shareRuinExport(await prepExport(c)); status.textContent = exportedText(r); }
        catch (e) { status.textContent = `The export failed: ${e && e.message ? e.message : e}`; }
      },
      del: async () => {
        try { await deleteColony(c.id); exports.delete(c.id); status.textContent = `${c.name} is deleted.`; refresh(); }
        catch (e) { status.textContent = `${c.name} could not be deleted: ${e.message}`; }
      },
    });
  }
  function annalsTitleView() {
    const c = annalsOf;
    const box = h('div.ec-title-settings.ec-title-annals', { 'aria-label': c ? `${c.name}: Annals` : 'Annals' });
    box.append(h('h2.ec-title-h', { text: c ? `${c.name}: ${RUIN_TEXT.annals}` : RUIN_TEXT.annals }));
    const wait = h('p.ec-bio-d', { text: 'Reading the Annals...' });
    box.append(wait);
    list.append(box, back());
    if (!c) { wait.textContent = 'No hold chosen.'; return; }
    loadRuinState(c.id).then((s0) => { wait.remove(); if (s0) annalsView(box, s0); else box.append(h('p.ec-bio-d', { text: `${c.name} is missing from this browser's storage.` })); })
      .catch((e) => { wait.textContent = `The Annals could not be read: ${e.message}`; });
  }
  refresh();
  root.append(node);
  mounted = { root, node };
  return { node, refresh, status };
}

/** Remove the title (entering the game). */
export function unmountTitle() {
  if (!mounted) return;
  mounted.node.remove();
  mounted.root.classList.remove('ec-title-root');
  mounted = null;
}
