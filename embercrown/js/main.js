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
// Stage 1b (11.1, 11.5, D11):
//   saveDawn()               -> Promise<{ which: 'dawn', tick } | null>  the daily dawn backup (run by the shell
//                                          at each game dawn; null in the localStorage fallback)
//   loadBackup(id)           -> Promise<state | null>   Colonies > Load backup: the dawn slot
//   checkBackup(atDawn?)     -> { reason } | null   the backup prompt rule (backups.backupDue); when due it marks
//                                          the prompt shown, prepares the file and fires 'ec2:backup'
//   backupColony(id?)        -> Promise<{ ok, via: 'share' | 'download', filename }>  one tap: the share sheet
//                                          with the .ecsave file (download where Web Share has no files);
//                                          ok sets lastBackupAt. Call it straight from the tap handler.
//   skipBackup(id?)          the prompt was dismissed (the 3-day gap still applies)
//   moveToApp(id)            -> Promise<{ ok, copied, text, steps }>  Safari side: the colony as text on the
//                                          clipboard (copied false: show `text` for a manual copy) and the 3 steps
//   pasteColonyFromSafari(text?) -> Promise<{ id, name, verified, text }>  app side: reads the clipboard on the
//                                          tap (or takes pasted text), imports, reads the slot back and decodes it
//   importColonyFile(file)   -> Promise<{ id, name, verified }>   the file-picker fallback (.ecsave or text)
//   storageInfo()            -> Promise<{ persist, persistText, mode, standalone, usage, quota, local, colonies }>
//                                          for Settings > Storage
//   isStandalone()           running as a Home Screen app?
// Window events: 'ec2:ready' (launch done: quick-save promoted, index reconciled), 'ec2:storage'
// ({ kind, text } storage alerts), 'ec2:resume' (the page is visible again: the shell pauses, 2.2),
// 'ec2:backup' ({ id, reason, name, filename }: show the "Back up your hold" card), 'ec2:dawn'
// ({ id, tick, ok }: the dawn backup was written).
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
  onStorageAlert, storageMode, exportBlob, importBlob, deleteColony, writeDawn, readDawn, readSlot, updateCard,
  readSettings, writeSettings, storageBytes, peekBlob,
} from './game/save/slots.js';
import { textToBlob } from './game/save/codec.js';
import { backupDue, dawnIndex, seasonKey, PERSIST_TEXT, MOVE_STEPS, MOVED_TEXT, promptOn, canTurnOffPrompt } from './game/save/backups.js';
import { randomSeedText } from './engine/rng.js';

export { onStorageAlert, readSettings, writeSettings, PERSIST_TEXT, MOVE_STEPS, MOVED_TEXT, promptOn, canTurnOffPrompt };

const IN_BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';

export const app = { s: null, log: [], debug: false, persist: 'unknown', alerts: [], ready: null, lastSave: null, saving: 0, backupDue: null, backupFile: null };

/** Register every system once (content, appliers, world, work, people, threat, colony). */
export function ensureSim() { return installSim({ stage: '1a' }); }

/** Found a new colony (title > New colony). Deterministic in (seed, opts); saved at once. */
export function newColony(seed = randomSeedText(), opts = {}) {
  ensureSim();
  app.s = foundColony({ seed, name: opts.name || 'The Hold', start: opts.start || null });
  app.log = [];
  lastYear = yearOf(app.s.tick); lastDawn = dawnIndex(app.s.tick); lastDawnId = app.s.id;
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
      app.s = s; app.log = []; lastYear = yearOf(s.tick); lastDawn = dawnIndex(s.tick);
      return s;
    } catch (e) { err = e; }
  }
  // both a/b slots gone or damaged: the dawn backup is the last resort
  const s = await loadBackup(id).catch((e) => { err = err || e; return null; });
  if (s) return s;
  if (err) throw err;
  return null;
}

/** Colonies > Load backup: continue from the dawn slot (the colony goes on from that morning). */
export async function loadBackup(id) {
  ensureSim();
  const slot = await readDawn(id);
  if (!slot) return null;
  const s = await loadBlob(slot.bytes);
  s.id = id;
  app.s = s; app.log = []; lastYear = yearOf(s.tick); lastDawn = dawnIndex(s.tick);
  return s;
}

// ---- The dawn backup and the backup prompt (11.5, D11) --------------------------------------------------
let lastDawn = null;
/** Write the current colony into its dawn slot (async deflate; IndexedDB only). */
export async function saveDawn() {
  const s = app.s;
  if (!s) return null;
  const bytes = await saveBlob(s);
  const r = await writeDawn(s.id, bytes);
  try { window.dispatchEvent(new CustomEvent('ec2:dawn', { detail: { id: s.id, tick: s.tick, ok: !!r } })); } catch (_) { /* Node, old browsers */ }
  return r;
}

/** Running as a Home Screen app (its own storage container, 11.1)? */
export function isStandalone() {
  if (!IN_BROWSER) return false;
  try { if (navigator.standalone === true) return true; } catch (_) { /* not Safari */ }
  try { return !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches); } catch (_) { return false; }
}

const cardFor = (id) => listColonies().find((c) => c.id === id) || null;
/** The prompt rule for the current colony; when due: mark it shown, prepare the file, fire 'ec2:backup'. */
export function checkBackup(atDawn = false, now = Date.now()) {
  const s = app.s;
  if (!s) return null;
  const card = cardFor(s.id);
  const due = backupDue({ card, now, tick: s.tick, atDawn, standalone: isStandalone(), settings: readSettings() });
  if (!due) return null;
  app.backupDue = { id: s.id, reason: due.reason, at: now };
  updateCard(s.id, { backupPromptAt: now, backupPromptSeason: seasonKey(s.tick) }).catch(() => null);
  prepareBackup(s.id).catch(() => null);
  const filename = app.backupFile && app.backupFile.id === s.id ? app.backupFile.filename : null;
  try { window.dispatchEvent(new CustomEvent('ec2:backup', { detail: { id: s.id, reason: due.reason, name: s.name, filename } })); } catch (_) { /* Node */ }
  return due;
}

/** Build the backup file ahead of the tap, so the share sheet opens inside the tap (iOS needs that). */
export async function prepareBackup(id) {
  if (app.s && app.s.id === id) { await saveNow('backup'); }
  const ex = await exportBlob(id);
  const file = typeof File === 'function' ? new File([ex.bytes], ex.filename, { type: 'application/octet-stream' }) : null;
  app.backupFile = { id, filename: ex.filename, bytes: ex.bytes, file, at: Date.now() };
  return app.backupFile;
}

/** One tap: share sheet with the .ecsave file, else a download. Sets lastBackupAt on success. */
export async function backupColony(id = app.s && app.s.id) {
  if (!id) return { ok: false, reason: 'no colony' };
  let prep = app.backupFile && app.backupFile.id === id && Date.now() - app.backupFile.at < 10 * 60000 ? app.backupFile : null;
  // share first while the tap's activation is fresh (the prepared file); prepare now only if none is ready
  if (!prep) prep = await prepareBackup(id);
  let via = 'download';
  try {
    if (prep.file && navigator.canShare && navigator.canShare({ files: [prep.file] }) && navigator.share) {
      await navigator.share({ files: [prep.file], title: prep.filename });
      via = 'share';
    } else downloadBytes(prep.bytes, prep.filename);
  } catch (e) {
    if (e && e.name === 'AbortError') return { ok: false, reason: 'cancelled', filename: prep.filename };
    try { downloadBytes(prep.bytes, prep.filename); } catch (_) { return { ok: false, reason: String(e && e.message || e), filename: prep.filename }; }
  }
  await updateCard(id, { lastBackupAt: Date.now() });
  app.backupDue = null;
  return { ok: true, via, filename: prep.filename };
}
/** The prompt was dismissed: nothing to record beyond the prompt time (checkBackup already set it). */
export function skipBackup() { app.backupDue = null; }

function downloadBytes(bytes, filename) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---- Move colony to the app (11.5) ----------------------------------------------------------------------
/**
 * Safari side: the colony as text on the clipboard, plus the 3 steps. Call it straight from the tap:
 * the clipboard write starts before the first await (a ClipboardItem with a pending blob, which iOS
 * Safari allows inside the gesture), so the save and export can finish afterwards.
 */
export function moveToApp(id) {
  const exP = (async () => { if (app.s && app.s.id === id) await saveNow('move'); return exportBlob(id); })();
  let copyP;
  try {
    if (typeof ClipboardItem === 'function' && navigator.clipboard && navigator.clipboard.write) {
      copyP = navigator.clipboard.write([new ClipboardItem({ 'text/plain': exP.then((ex) => new Blob([ex.text], { type: 'text/plain' })) })])
        .catch(() => exP.then((ex) => navigator.clipboard.writeText(ex.text)));
    } else if (navigator.clipboard && navigator.clipboard.writeText) copyP = exP.then((ex) => navigator.clipboard.writeText(ex.text));
    else copyP = Promise.reject(new Error('no clipboard'));
  } catch (e) { copyP = Promise.reject(e); }
  return Promise.all([exP, copyP.then(() => true, () => false)])
    .then(([ex, copied]) => ({ ok: true, copied, text: ex.text, filename: ex.filename, steps: MOVE_STEPS.slice() }));
}

/** Import, then read the slot back and decode it: "verified" means the app holds a loadable copy. */
async function importVerified(input) {
  const want = typeof input === 'string' ? textToBlob(input) : input;
  const peek = await peekBlob(want);
  const id = await importBlob(want);
  const slot = await readSlot(id);
  let verified = !!slot && slot.bytes.length === want.length && slot.bytes.every((v, k) => v === want[k]);
  if (verified) { try { await loadBlob(slot.bytes); } catch (_) { verified = false; } }
  return { id, name: peek.name, day: peek.day, pop: peek.pop, verified, text: verified ? MOVED_TEXT : 'The colony could not be checked after the import. Keep the Safari copy.' };
}

/** App side: "Paste a colony from Safari" (reads the clipboard on the tap, or takes pasted text). */
export async function pasteColonyFromSafari(text = null) {
  let t = text;
  if (t === null) {
    if (!navigator.clipboard || !navigator.clipboard.readText) throw new Error('This browser cannot read the clipboard. Choose the backup file instead.');
    t = await navigator.clipboard.readText();
  }
  t = String(t || '').trim();
  if (!t.startsWith('EC2:')) throw new Error('The clipboard does not hold a colony. In Safari, tap Move to app again, then come back.');
  return importVerified(t);
}
/** The file-picker fallback: an .ecsave file (bytes) or a text file holding "EC2:...". */
export async function importColonyFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const head = String.fromCharCode(...bytes.subarray(0, 4));
  return importVerified(head === 'EC2:' ? new TextDecoder().decode(bytes).trim() : bytes);
}

// ---- Settings > Storage (11.1, 11.2) ---------------------------------------------------------------------
export async function storageInfo() {
  const persist = app.persist !== 'unknown' ? app.persist : await persistState().catch(() => 'unknown');
  let usage = null, quota = null;
  try { if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); usage = e.usage ?? null; quota = e.quota ?? null; } } catch (_) { /* not offered */ }
  const cards = listColonies();
  return {
    persist, persistText: PERSIST_TEXT[persist] || PERSIST_TEXT.unknown, mode: await storageMode(), standalone: isStandalone(),
    usage, quota, local: storageBytes(),
    colonies: cards.map((c) => ({ id: c.id, name: c.name, size: c.size || 0, lastBackupAt: c.lastBackupAt || 0, dawnDay: c.dawnDay ?? null, missing: !!c.missing })),
  };
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
  // dawn (06:00): the dawn backup and the seasonal backup prompt; checked every 2 s of real time
  // (a game day is 144 s at 5x). The stale-backup rule is checked once a minute.
  setInterval(() => {
    if (!app.s || document.hidden) return;
    const d = dawnIndex(app.s.tick);
    if (lastDawn === null || app.s.id !== lastDawnId) { lastDawn = d; lastDawnId = app.s.id; return; }
    if (d > lastDawn) { lastDawn = d; saveDawn().catch(() => null); checkBackup(true); }
  }, 2000);
  setInterval(() => { if (app.s && !document.hidden) checkBackup(false); }, 60000);
}
let lastDawnId = null;

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
    saveDawn, loadBackup, checkBackup, backupColony, prepareBackup, moveToApp, pasteColonyFromSafari, importColonyFile, storageInfo, isStandalone,
    snapshotMs: () => { if (!app.s) return null; const t0 = performance.now(); const { payload } = snapshot(app.s); return { ms: performance.now() - t0, rawBytes: payload.length }; },
    reload: async () => { if (!app.s) return null; const h = stateHash(app.s); const t = await loadBlob(await saveBlob(app.s)); t.id = app.s.id; app.s = t; return { same: stateHash(t) === h, hash: h }; },
    storage: { listColonies, refreshColonies, readSlots, quickSave: () => app.s && quickSave(app.s), promoteQuick, storageMode, exportBlob, importBlob, deleteColony, persistState, readDawn, writeDawn, updateCard, readSettings, writeSettings, storageBytes },
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
