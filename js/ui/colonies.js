// Title screen and colony list (owner I; doc 10.8). Stage 0: Continue and New colony, plus a small
// link to the classic game at classic/. Colonies, Settings and Import arrive with C14 (Stage 1a).
//
// Contract with js/main.js (owner A):  mountTitle(root, api)
//   api.listColonies() -> [card]            C14 index (cards from slots.cardOf)
//   api.newColony()    -> state             Stage 0: an empty colony (the New colony flow is Stage 1a)
//   api.continueColony(id) -> Promise<state | null>   null when the blob is missing (eviction, 11.1)
//   api.enter(s)       -> void              start the in-game shell on that state
//   api.importBlob(bytes | text) -> Promise<card>   optional: Import a backup (C14)
//   api.isStandalone(), api.pasteColonyFromSafari()   optional: the Home Screen app's "Paste a colony
//                                           from Safari" (11.5, A's main.js)
// mountTitle is idempotent: a second call moves the one title into the new root.
import { h, clear, onTap } from './kit.js';
import { SEASON_NAMES } from '../game/core/time.js';
import { mountTitleArt } from '../engine/art/title.js';

let mounted = null;   // { root, node }

const PITCH = 'Lead a handful of named survivors into a vale under a mountain. Dig a hold, keep the Hearth lit, and hold back the Hollow, year after year.';

/** The backdrop: a mountain with a lit hold in its flank (D's pixel art, js/engine/art/title.js). */
function backdrop() {
  const bg = h('div.ec-title-bg');
  try { mountTitleArt(bg); } catch (_) { /* no canvas: the CSS gradient alone */ }
  return bg;
}

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
      h('a.ec-classic', { href: './classic/', 'data-act': 'classic' }, 'Play the classic Embercrown'),
    ));
  const busy = (on) => { for (const b of list.querySelectorAll('button')) b.disabled = on || b.dataset.off === '1'; };

  const refresh = () => {
    clear(list);
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
    if (cards.length > 1) list.append(h('p.ec-title-more', { text: `${cards.length} colonies saved. Continue opens the one played last.` }));
  };
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
