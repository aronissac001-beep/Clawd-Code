// Prompt cards (owner I; doc 10.9, 11.5): Add to Home Screen, Back up your hold, Move colony to the
// app. The storage work is A's (js/main.js: backupColony, skipBackup, moveToApp, isStandalone); these
// are its cards. One prompt card at a time, at the bottom of the world view above the bar.
//   a2hsDue(s, standalone)   the A2HS rule: after the first room is built, in a Safari tab only, at
//                            most twice per colony (count in localStorage 'ec2.a2hs.<id>'), once a session
//   mountPrompts(root, ctx, api) -> { showA2HS(), showBackup(detail), check(), hide(), el }
//   openMoveToApp(ctx, api)  the Move colony to the app sheet (Safari side): copies the colony and
//                            shows the 3 steps; a manual-copy box when the clipboard refused
import { h, onTap, icon, clear } from './kit.js';

const AKEY = (s) => 'ec2.a2hs.' + (s.id || 'colony');
const shownCount = (s) => { try { return +(localStorage.getItem(AKEY(s)) || 0) || 0; } catch (_) { return 0; } };
const bumpShown = (s) => { try { localStorage.setItem(AKEY(s), String(shownCount(s) + 1)); } catch (_) { /* private mode */ } };
let shownThisSession = false;

/** A finished room: a room record with built walls or doors in it (rooms.js auto-roofs it). */
export function firstRoomBuilt(s) {
  const rooms = s.rt.rooms || [];
  for (const r of rooms) if (r && r.roofed && r.built > 0) return true;
  return false;
}
export function a2hsDue(s, standalone) {
  if (standalone || shownThisSession) return false;
  if (shownCount(s) >= 2) return false;
  return firstRoomBuilt(s);
}

export const A2HS_STEPS = Object.freeze(['Tap the Share button in the Safari toolbar.', 'Choose Add to Home Screen.', 'Tap Add, then open Embercrown from your Home Screen.']);

export function mountPrompts(root, ctx, api) {
  const s = ctx.s;
  const el = h('aside.ec-prompt', { hidden: true, role: 'dialog', 'aria-label': 'Prompt' });
  root.append(el);
  let cur = null;
  const btn = (label, act, fn, primary = false) => { const b = h('button.ec-act' + (primary ? '.primary' : ''), { type: 'button', 'data-act': act, text: label }); onTap(b, fn); return b; };
  const head = (title, ic) => {
    const x = h('button.ec-ibtn.ec-prompt-x', { type: 'button', 'data-act': 'prompt-close', 'aria-label': 'Close', html: icon('x') });
    onTap(x, () => { if (cur === 'backup' && api.skipBackup) api.skipBackup(); out.hide(); });
    return h('div.ec-prompt-head', null, h('span.ec-prompt-ic', { html: icon(ic) }), h('h2.ec-prompt-t', { text: title }), x);
  };
  const out = {
    el,
    get open() { return cur; },
    hide() { cur = null; el.hidden = true; clear(el); document.body.classList.remove('has-prompt'); },
    showA2HS() {
      shownThisSession = true; bumpShown(s);
      cur = 'a2hs'; clear(el); el.hidden = false; document.body.classList.add('has-prompt');
      const ol = h('ol.ec-steps');
      for (const t of A2HS_STEPS) ol.append(h('li', { text: t }));
      el.append(head('Keep your hold safe', 'share'),
        h('p.ec-prompt-d', { text: 'Add Embercrown to your Home Screen: Safari can clear the saves of a site you have not opened for a while, and the app gets the full screen height.' }),
        ol,
        h('p.ec-prompt-d', { text: 'The app keeps its own saves. Move this colony there with Move colony to the app.' }),
        h('div.ec-peek-acts', null,
          btn('Move colony', 'a2hs-move', () => { out.hide(); openMoveToApp(ctx, api); }, true),
          btn('Not now', 'a2hs-later', () => out.hide())));
    },
    showBackup(detail = {}) {
      cur = 'backup'; clear(el); el.hidden = false; document.body.classList.add('has-prompt');
      const why = detail.reason === 'season' ? 'A new season: a good moment for a copy outside the browser.' : detail.reason === 'stale' ? 'Your last backup is more than 3 days old.' : 'A copy outside the browser keeps the colony safe if Safari clears its storage.';
      el.append(head('Back up your hold', 'export'),
        h('p.ec-prompt-d', { text: `${why} One tap saves a file to Files or sends it where you like.` }),
        h('div.ec-peek-acts', null,
          // the share sheet must open inside the tap (iOS): backupColony is called straight from it
          btn('Back up', 'backup-now', () => {
            const p = api.backupColony ? api.backupColony(s.id) : Promise.resolve({ ok: false, reason: 'not offered' });
            p.then((r) => { if (r && r.ok) ctx.toast(r.via === 'share' ? 'Backup shared.' : `Backup saved: ${r.filename}.`); else if (r && r.reason !== 'cancelled') ctx.toast(`Backup failed: ${r ? r.reason : 'unknown'}.`, 'bad'); })
              .catch((e) => ctx.toast(`Backup failed: ${e && e.message ? e.message : e}.`, 'bad'));
            out.hide();
          }, true),
          btn('Not now', 'backup-later', () => { if (api.skipBackup) api.skipBackup(); out.hide(); })));
    },
    /** Once a second: the A2HS rule (the backup prompt comes from A's 'ec2:backup' event). */
    check() { if (!cur && a2hsDue(s, api.isStandalone ? api.isStandalone() : false)) out.showA2HS(); },
  };
  return out;
}

/** Menu > Move colony to the app (Safari side). Copies first, inside the tap. */
export function openMoveToApp(ctx, api) {
  const s = ctx.s;
  if (api.isStandalone && api.isStandalone()) {
    ctx.toast('This is already the Home Screen app. Paste a colony from Safari on the title screen.');
    return;
  }
  // the clipboard write starts before any await (iOS allows it only inside the gesture)
  const p = api.moveToApp ? api.moveToApp(s.id) : Promise.reject(new Error('Move to app is not offered here'));
  ctx.openSheet('Move colony to the app', (el) => {
    const status = h('p.ec-note', { role: 'status', text: 'Copying the colony...' });
    const ol = h('ol.ec-steps');
    el.append(status, ol);
    p.then((r) => {
      clear(ol);
      for (const t of r.steps || []) ol.append(h('li', { text: t }));
      if (r.copied) status.textContent = `${s.name} is copied. Do these steps, then the app holds its own copy.`;
      else {
        status.textContent = 'The clipboard said no. Copy the text below by hand (tap it, Select All, Copy), then do the steps.';
        const box = h('textarea.ec-copybox', { readonly: true, rows: '4', 'aria-label': 'The colony as text' });
        box.value = r.text || '';
        el.append(box);
      }
    }).catch((e) => { status.textContent = `The colony could not be copied: ${e && e.message ? e.message : e}`; });
  }, { back: true });
}
