// Title screen and colony list (owner I; doc 10.8): Continue | Colonies | New colony | Settings |
// Import. New colony founds at once with the defaults; "Choose the start" opens the options (storyteller, difficulty with Ironhold, name, seed).
// Colonies lists every saved colony (up to 8, A's colonyRoom) with Continue for each.
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

const DIFF_TEXT = { hearthkeeper: 'Gentle raids, kind weather: for building.', warden: 'Lighter threats than the default.', steadfast: 'The hold as designed. The default.', ironhold: 'Hard, one save slot and no backups: every loss is final.' };
const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);

let mounted = null;   // { root, node }

const PITCH = 'Lead a handful of named survivors into a vale under a mountain. Dig a hold, keep the Hearth lit, and hold back the Hollow, year after year.';

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
  return `${when} · ${pop}`;
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
    let cards = [];
    try { cards = api.listColonies() || []; } catch (e) { status.textContent = 'Saved colonies could not be read.'; }
    const last = cards.slice().sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0))[0] || null;
    const cont = h('button.ec-btn.primary.ec-continue', { 'data-act': 'continue', type: 'button' },
      h('span.ec-btn-label', { text: 'Continue' }),
      last ? h('span.ec-btn-sub', { text: last.missing ? `${last.name}: missing from this browser` : `${last.name}: ${cardLine(last)}` }) : h('span.ec-btn-sub', { text: 'No colony yet' }));
    if (!last) { cont.disabled = true; cont.dataset.off = '1'; cont.classList.remove('primary'); }
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
      h('span.ec-btn-sub', { text: 'Found a hold under the mountain' }));
    onTap(fresh, () => {
      busy(true);
      try { const s = api.newColony(); status.textContent = ''; api.enter(s); }
      catch (e) { status.textContent = `A colony could not be founded: ${e.message}`; busy(false); }
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
    if (cards.length > 1) {
      const cl = h('button.ec-btn.ec-colonies', { 'data-act': 'colonies', type: 'button' }, h('span.ec-btn-label', { text: `Colonies (${cards.length})` }), h('span.ec-btn-sub', { text: 'Continue any saved hold' }));
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
      try { const s0 = api.newColony({ seed: pick.seed, name: pick.name, storyteller: pick.storyteller, difficulty: pick.difficulty }); status.textContent = ''; view = 'main'; api.enter(s0); }
      catch (e) { status.textContent = `A colony could not be founded: ${e.message}`; busy(false); }
    });
    list.append(h('p.ec-title-more', { text: 'Name of the hold' }), name, seed, go, back());
  }
  function coloniesView() {
    let cards = [];
    try { cards = api.listColonies() || []; } catch (_) { cards = []; }
    for (const c of cards.slice().sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0))) {
      const b = h('button.ec-btn', { type: 'button', 'data-act': 'colony-open' }, h('span.ec-btn-label', { text: `${c.name}${c.iron ? ' (Ironhold)' : ''}` }), h('span.ec-btn-sub', { text: c.missing ? 'Missing from this browser' : cardLine(c) }));
      onTap(b, async () => {
        busy(true); status.textContent = `Opening ${c.name}...`;
        try { const s0 = await api.continueColony(c.id); if (!s0) { status.textContent = `${c.name} is missing from this browser's storage.`; busy(false); return; } status.textContent = ''; view = 'main'; api.enter(s0, { resumed: true }); }
        catch (e) { status.textContent = `${c.name} could not be opened: ${e.message}`; busy(false); }
      });
      list.append(b);
    }
    list.append(back());
  }
  function settingsView() {
    const box = h('div.ec-title-settings');
    settingsList(box, { read: () => api.readSettings(), write: (p) => { api.writeSettings(p); refresh(); }, toast: (t) => { status.textContent = t; }, standalone: !!(api.isStandalone && api.isStandalone()) });
    list.append(box, back());
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
