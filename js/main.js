// Embercrown: The Hold - shell (owner A; doc 13.1). Stage 0: a placeholder title with New colony
// and Continue, the lifecycle (save on hide), the service worker and the debug hook.
// Workstream I replaces the placeholder with the real title and colony list (js/ui/*): it should
// export mountTitle(root, api) from js/ui/colonies.js, and this file will call it.
// Everything that touches the DOM runs only in a browser, so the module imports headless in Node.

import { createColony, stateHash, checkState } from './game/core/state.js';
import { applyCommand } from './game/core/commands.js';
import { step } from './game/core/sim.js';
import { dispatch } from './game/core/events.js';
import { saveBlob } from './game/save/colonysave.js';
import { listColonies, readSlot, writeSlot, quickSave, promoteQuick, cardOf } from './game/save/slots.js';
import { loadBlob } from './game/save/colonysave.js';
import { dateText } from './game/core/time.js';
import { randomSeedText } from './engine/rng.js';

const IN_BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';

export const app = { s: null, log: [], debug: false };

/** Start a new colony (placeholder: an empty flat map; mapgen and the band come in Stage 1a). */
export function newColony(seed = randomSeedText()) {
  app.s = createColony(seed, { name: 'The Hold' });
  app.log = [];
  return app.s;
}
export async function saveNow() {
  if (!app.s) return null;
  const bytes = await saveBlob(app.s);
  return writeSlot(app.s.id, bytes, cardOf(app.s));
}
export async function continueColony(id) {
  const slot = await readSlot(id);
  if (!slot) return null;
  app.s = await loadBlob(slot.bytes);
  return app.s;
}

function installDebugHook() {
  // window.__ec (dev builds and ?debug=1, 14.1): Playwright reads state instead of pixels.
  window.__ec = {
    get state() { return app.s; },
    send: (cmd) => (app.s ? applyCommand(app.s, cmd, app.log) : { ok: false, reason: 'no colony' }),
    step: (n = 1) => { if (app.s) { step(app.s, n); dispatch(app.s); } return app.s ? app.s.tick : 0; },
    stats: () => (app.s ? { tick: app.s.tick, hash: stateHash(app.s), col: app.s.col.length, errors: checkState(app.s).length } : null),
    newColony, saveNow, continueColony,
  };
}

function el(tag, css, text) { const e = document.createElement(tag); if (css) e.style.cssText = css; if (text) e.textContent = text; return e; }
const BTN = 'display:block;width:100%;min-height:48px;margin:8px 0;padding:12px 16px;border-radius:10px;font-size:17px;font-weight:600;'
  + 'background:#3a2a20;color:#f6ead2;border:1px solid #c9973e;text-align:center;text-decoration:none;box-sizing:border-box;';

function showTitle(root) {
  root.textContent = '';
  const wrap = el('div', 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;'
    + 'background:radial-gradient(ellipse at 50% 70%,#3a2418 0%,#17151f 70%);pointer-events:auto;overflow:auto;');
  const col = el('div', 'width:min(340px,100%);text-align:center;font-family:inherit;');
  col.appendChild(el('h1', 'margin:0 0 4px;font-size:30px;color:#f0c86a;letter-spacing:0.04em;', 'Embercrown'));
  col.appendChild(el('p', 'margin:0 0 20px;font-size:17px;color:#cdbb98;', 'The Hold'));
  const cards = listColonies();
  const status = el('p', 'min-height:20px;font-size:15px;color:#cdbb98;margin:4px 0 8px;', '');
  const btnNew = el('button', BTN, 'New colony');
  btnNew.dataset.act = 'new';
  btnNew.addEventListener('click', () => { const s = newColony(); status.textContent = `${s.name} founded. ${dateText(s.tick)}. (Stage 0 placeholder)`; });
  col.appendChild(btnNew);
  const btnCont = el('button', BTN + (cards.length ? '' : 'opacity:0.55;'), cards.length ? `Continue: ${cards[0].name}` : 'Continue');
  btnCont.dataset.act = 'continue';
  btnCont.disabled = !cards.length;
  btnCont.addEventListener('click', async () => {
    try { const s = await continueColony(cards[0].id); status.textContent = s ? `${s.name}: ${dateText(s.tick)}` : 'This colony is missing. Import a backup.'; }
    catch (e) { status.textContent = e.message; }
  });
  col.appendChild(btnCont);
  col.appendChild(status);
  const classic = el('a', BTN + 'background:transparent;border-color:#6b5a48;font-weight:500;margin-top:24px;', 'Play the classic Embercrown');
  classic.href = './classic/';
  col.appendChild(classic);
  wrap.appendChild(col);
  root.appendChild(wrap);
}

function boot() {
  const params = new URLSearchParams(location.search);
  app.debug = params.has('debug');
  if (app.debug) installDebugHook();
  const screens = document.getElementById('screens') || document.body;
  promoteQuick().catch(() => null).finally(() => showTitle(screens));
  // Lifecycle (2.2, 11.4): no simulation while hidden; save at once on hide.
  document.addEventListener('visibilitychange', () => { if (document.hidden && app.s) { quickSave(app.s); saveNow().catch(() => null); } });
  window.addEventListener('pagehide', () => { if (app.s) quickSave(app.s); });
  const framed = (() => { try { return window.self !== window.top; } catch (_) { return true; } })();
  if (!framed && !app.debug && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => {}); });
  }
}

if (IN_BROWSER) boot();
