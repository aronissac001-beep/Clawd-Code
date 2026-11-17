// Embercrown: The Hold - shell (owner A; doc 13.1, 11.4, 14.6). The plumbing of the flow
// title > New colony > game > Continue, the lifecycle saves and the debug hook. The screens
// themselves are workstream I's (js/ui/app.js mounts the title and the in-game shell and calls
// the functions exported here). Everything that touches the DOM runs only in a browser, so the
// module imports headless in Node.
//
// API for the UI (js/ui/app.js):
//   app                      { s, log, debug, persist, alerts, ready }
//   newColony(seed?, opts?)  -> state      founds a colony (B's map, the Hearth, the band) and saves it at once
//   continueColony(id)       -> Promise<state | null>   null when both slots are gone (eviction, 11.1);
//                                          a damaged newest slot falls back to the older one
//   saveNow(why?)            -> Promise<{ which, tick, size } | null>   async EC2 save into the older slot
//   send(cmd)                -> result     applyCommand with the determinism log (and the letter save rule)
//   closeColony()            saves and forgets the current colony (back to the title)
//   onStorageAlert(fn)       re-exported from slots.js: fn(kind, text) for 'limited' | 'quota' | 'missing'
// Window events: 'ec2:ready' (launch done: quick-save promoted, index reconciled), 'ec2:storage'
// ({ kind, text } storage alerts), 'ec2:resume' (the page is visible again: the shell pauses, 2.2).
// Saves never change sim state, so their real-time timing does not touch determinism (11.4).

import { stateHash, checkState } from './game/core/state.js';
import { applyCommand } from './game/core/commands.js';
import { step } from './game/core/sim.js';
import { dispatch, on } from './game/core/events.js';
import { yearOf } from './game/core/time.js';
import { installSim, foundColony } from './game/core/setup.js';
import { saveBlob, loadBlob, snapshot } from './game/save/colonysave.js';
import {
  listColonies, refreshColonies, readSlots, writeSlot, quickSave, promoteQuick, cardOf, persistState,
  onStorageAlert, storageMode, exportBlob, importBlob, deleteColony,
} from './game/save/slots.js';
import { randomSeedText } from './engine/rng.js';

export { onStorageAlert };

const IN_BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';

export const app = { s: null, log: [], debug: false, persist: 'unknown', alerts: [], ready: null, lastSave: null, saving: 0 };

/** Register every system once (content, appliers, world, work, people, threat, colony). */
export function ensureSim() { return installSim({ stage: '1a' }); }

/** Found a new colony (title > New colony). Deterministic in (seed, opts); saved at once. */
export function newColony(seed = randomSeedText(), opts = {}) {
  ensureSim();
  app.s = foundColony({ seed, name: opts.name || 'The Hold', start: opts.start || null });
  app.log = [];
  lastYear = yearOf(app.s.tick);
  if (IN_BROWSER) saveNow('new').catch(() => null);
  return app.s;
}

/** Load a colony from its newest slot (the older one if the newest is damaged). */
export async function continueColony(id) {
  ensureSim();
  const slots = await readSlots(id);
  let err = null;
  for (const slot of slots) {
    try {
      const s = await loadBlob(slot.bytes);
      s.id = id;  // the slot names the colony (an import under a new id keeps the blob's bytes)
      app.s = s; app.log = []; lastYear = yearOf(s.tick);
      return s;
    } catch (e) { err = e; }
  }
  if (err) throw err;
  return null;
}

/** Save the current colony into its older slot (async deflate; serialised by slots.writeSlot). */
export async function saveNow(why = 'manual') {
  const s = app.s;
  if (!s) return null;
  app.saving++;
  try {
    const bytes = await saveBlob(s);
    const r = await writeSlot(s.id, bytes, cardOf(s));
    app.lastSave = { ...r, why };
    if (app.persist === 'unknown') persistState().then((v) => { app.persist = v; }).catch(() => null);
    return r;
  } finally { app.saving--; }
}

/** Apply a command from the UI (between ticks), recording it in the determinism log. */
export function send(cmd) {
  if (!app.s) return { ok: false, reason: 'no colony' };
  const r = applyCommand(app.s, cmd, app.log);
  if (r.ok && cmd.t === 'letter') saveSoon('letter');   // 11.4: after each letter is answered
  return r;
}

/** Save and forget the current colony (Quit to title). */
export async function closeColony() {
  if (!app.s) return;
  try { await saveNow('quit'); } finally { app.s = null; app.log = []; }
}

// ---- Event-driven saves (11.4): tier-up, raid end, colonist death, the year turn, letters -----------
let lastYear = 0;
let soonTimer = 0;
/** Save at the next idle moment (never inside a frame that is already over budget). */
export function saveSoon(why) {
  if (!IN_BROWSER || !app.s || soonTimer) return;
  const run = () => { soonTimer = 0; saveNow(why).catch(() => null); };
  soonTimer = typeof requestIdleCallback === 'function' ? requestIdleCallback(run, { timeout: 2000 }) : setTimeout(run, 50);
}
function watchSaveEvents() {
  for (const name of ['tierUp', 'raidEnd', 'died']) on(name, () => saveSoon(name));
  // the year turn: checked at most every 5 s of real time (the sim never reads this)
  setInterval(() => { if (app.s && !document.hidden) { const y = yearOf(app.s.tick); if (y !== lastYear) { lastYear = y; saveSoon('year'); } } }, 5000);
}

// ---- Lifecycle (2.2, 11.4) ------------------------------------------------------------------
/** Hidden or leaving: the synchronous quick-save first (the async save may not finish), then the slot. */
export function lifecycleSave(kind) {
  if (!app.s) return false;
  let ok = false;
  try { ok = quickSave(app.s); } catch (_) { ok = false; }
  if (kind === 'hidden') saveNow('hidden').catch(() => null);
  return ok;
}

function installDebugHook() {
  // window.__ec (dev builds and ?debug=1, 14.1): Playwright reads state instead of pixels.
  window.__ec = {
    get state() { return app.s; },
    get app() { return app; },
    send,
    step: (n = 1) => { if (app.s) { step(app.s, n); dispatch(app.s); } return app.s ? app.s.tick : 0; },
    stats: () => (app.s ? { tick: app.s.tick, hash: stateHash(app.s), col: app.s.col.length, bld: app.s.bld.filter(Boolean).length, items: app.s.items.filter(Boolean).length, errors: checkState(app.s).length } : null),
    hash: () => (app.s ? stateHash(app.s) : null),
    newColony, saveNow, continueColony, closeColony, lifecycleSave,
    snapshotMs: () => { if (!app.s) return null; const t0 = performance.now(); const { payload } = snapshot(app.s); return { ms: performance.now() - t0, rawBytes: payload.length }; },
    reload: async () => { if (!app.s) return null; const h = stateHash(app.s); const t = await loadBlob(await saveBlob(app.s)); t.id = app.s.id; app.s = t; return { same: stateHash(t) === h, hash: h }; },
    storage: { listColonies, refreshColonies, readSlots, quickSave: () => app.s && quickSave(app.s), promoteQuick, storageMode, exportBlob, importBlob, deleteColony, persistState },
  };
}

function boot() {
  const params = new URLSearchParams(location.search);
  app.debug = params.has('debug');
  if (app.debug) installDebugHook();
  onStorageAlert((kind, text) => {
    app.alerts.push({ kind, text });
    try { window.dispatchEvent(new CustomEvent('ec2:storage', { detail: { kind, text } })); } catch (_) { /* old browsers */ }
  });
  // On launch: a newer quick-save is promoted into its colony's older slot, then the index is
  // reconciled with IndexedDB (cards restored after a localStorage clear, missing blobs marked).
  app.ready = promoteQuick().catch(() => null)
    .then((promoted) => refreshColonies().catch(() => listColonies()).then((cards) => ({ promoted, cards })))
    .then((r) => { try { window.dispatchEvent(new CustomEvent('ec2:ready', { detail: r })); } catch (_) { /* old browsers */ } return r; });
  // Lifecycle: no simulation while hidden (the loop pauses); save at once on hide and on leave.
  // On return the game is always paused (2.2): the in-game shell listens for 'ec2:resume'.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) lifecycleSave('hidden');
    else if (app.s) { try { window.dispatchEvent(new CustomEvent('ec2:resume', { detail: { tick: app.s.tick } })); } catch (_) { /* old browsers */ } }
  });
  window.addEventListener('pagehide', () => { lifecycleSave('pagehide'); });
  watchSaveEvents();
  const framed = (() => { try { return window.self !== window.top; } catch (_) { return true; } })();
  if (!framed && !app.debug && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => {}); });
  }
}

if (IN_BROWSER) boot();
