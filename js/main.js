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
//   loadBackup(id)           -> Promise<state | null>   the dawn slot (Stage 2.9: only through recoverCopy, below)
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
// Stage 2 (14.8 row A):
//   newColony(seed, { difficulty, storyteller, start, name })   difficulty: hearthkeeper | warden | steadfast | hard
//   colonyRoom()             -> null | reason   can one more colony be founded or imported (8 at most)?
//   writeSettings(patch)     stores valid keys (save/settings.js) and applies them to <html> (applySettings)
//   applySettings(settings?) the data-ec-* attributes on <html> (text size, motion, colours, hand, battery)
//                            and the 'ec2:settings' window event ({ settings })
//   exportClassicSaves()     -> Promise<{ ok, via, filename, token, keys }>  Settings > Storage: the /classic/
//                            saves as a JSON file (share sheet or download); keep `token` for the clear
//   clearClassicSaves(token) -> { removed }   only after an export of the same contents (11.2)
//   storageInfo() also returns classic { keys, chars }, max, count and each colony's fallen flag
// Stage 2.9 (EMBERCROWN-FORTRESS.md 1.3, 5.5): no Ironhold (every colony has a, b and dawn), the fall and the Ruin.
//   app.ruin                 true while the open colony is a fallen hold: read-only (send refuses, nothing ticks)
//   isRuin(s?)               has this (the open) colony fallen?
//   checkFall()              -> summary | null   on the frame the open colony falls: saves it once and fires
//                                          'ec2:fallen' ({ id, summary }: the final screen, the defeat stinger)
//   ruinSummary(s?)          colony/fall.js fallSummary: what "The Hearth goes cold" and the Ruin card show
//   openRuin(id)             -> Promise<state | null>   View the ruin: the colony at its final state, read-only
//   Settings > Storage > Recover from a device problem:
//   RECOVER_TEXT             { title, help, confirm, load, cancel, none, done }   the panel's words
//   recoveryList()           -> Promise<[{ id, name, fallen, fellText, copies: [{ which, label, tick, date, savedAt, fallen }] }]>
//   recoverCopy(id, which)   -> Promise<state>   load slot a, b or dawn; a copy that is not fallen becomes the
//                                          colony (written into both a and b), with the Chronicle line "Recovered
//                                          from a copy of <date>" when it predates a fall; the caller confirms
//                                          first (RECOVER_TEXT.confirm)
//   mountRecoverPanel(el, { onLoaded?, toast? })   the panel itself (DOM; existing .ec-row / .ec-btn styles),
//                                          for I to place in Settings > Storage (in-game sheet and title)
// Window events: 'ec2:ready' (launch done: quick-save promoted, index reconciled), 'ec2:storage'
// ({ kind, text } storage alerts), 'ec2:resume' (the page is visible again: the shell pauses, 2.2),
// 'ec2:backup' ({ id, reason, name, filename }: show the "Back up your hold" card), 'ec2:dawn'
// ({ id, tick, ok }: the dawn backup was written).
// Saves never change sim state, so their real-time timing does not touch determinism (11.4).

import { stateHash, checkState } from './game/core/state.js';
import { applyCommand } from './game/core/commands.js';
import { step } from './game/core/sim.js';
import { dispatch, on } from './game/core/events.js';
import { yearOf, dateText } from './game/core/time.js';
import { installSim, foundColony } from './game/core/setup.js';
import { saveBlob, loadBlob, snapshot } from './game/save/colonysave.js';
import {
  listColonies, refreshColonies, readSlots, writeSlot, quickSave, promoteQuick, cardOf, persistState,
  onStorageAlert, storageMode, exportBlob, importBlob, deleteColony, writeDawn, readDawn, readSlot, updateCard,
  readSettings, writeSettings as storeSettings, storageBytes, peekBlob, colonyRoom, classicSaves, exportClassic, clearClassic, MAX_COLONIES,
  readCopies, restoreCopy, isFallenCard,
} from './game/save/slots.js';
import { isFallen, fallSummary } from './game/colony/fall.js';
import { addChron } from './game/colony/chronicle.js';
import { settingsAttrs, SETTINGS } from './game/save/settings.js';
import { textToBlob } from './game/save/codec.js';
import { backupDue, dawnIndex, seasonKey, PERSIST_TEXT, MOVE_STEPS, MOVED_TEXT, promptOn, canTurnOffPrompt } from './game/save/backups.js';
import { randomSeedText } from './engine/rng.js';

export { onStorageAlert, readSettings, PERSIST_TEXT, MOVE_STEPS, MOVED_TEXT, promptOn, canTurnOffPrompt, colonyRoom, SETTINGS };

/** Store a settings patch (invalid keys ignored) and apply the result. Returns the settings now. */
export function writeSettings(patch) { const next = storeSettings(patch); applySettings(next); return next; }
/** Settings to the page: data-ec-* attributes on <html> (CSS hooks) and the 'ec2:settings' event. */
export function applySettings(settings = readSettings()) {
  if (!IN_BROWSER) return settings;
  try {
    const el = document.documentElement, at = settingsAttrs(settings);
    for (const k of Object.keys(at)) el.setAttribute(k, at[k]);
    window.dispatchEvent(new CustomEvent('ec2:settings', { detail: { settings } }));
  } catch (_) { /* old browsers */ }
  return settings;
}

const IN_BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';

export const app = { s: null, log: [], debug: false, persist: 'unknown', alerts: [], ready: null, lastSave: null, saving: 0, backupDue: null, backupFile: null, ruin: false };

/** Register every system once (content, appliers, world, work, people, threat, colony). */
export function ensureSim() { return installSim({ stage: '1a' }); }

/** Found a new colony (title > New colony). Deterministic in (seed, opts); saved at once. */
export function newColony(seed = randomSeedText(), opts = {}) {
  const full = colonyRoom(); if (full) throw new Error(full);
  ensureSim();
  app.s = foundColony({ seed, name: opts.name || 'The Hold', start: opts.start || null, difficulty: opts.difficulty || null, storyteller: opts.storyteller || null });
  app.log = []; app.ruin = false; fallSeen = null;
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
      setOpen(s);
      return s;
    } catch (e) { err = e; }
  }
  // both a/b slots gone or damaged: the dawn backup is the last resort
  const s = await loadBackup(id).catch((e) => { err = err || e; return null; });
  if (s) return s;
  if (err) throw err;
  return null;
}

/** The dawn slot as the colony (the last resort of continueColony; otherwise only through recoverCopy). */
export async function loadBackup(id) {
  if (!(await readDawn(id))) return null;
  return recoverCopy(id, 'dawn');
}
/** The open colony is now `s` (a ruin when it has fallen). */
function setOpen(s) {
  app.s = s; app.log = []; app.ruin = isFallen(s); lastYear = yearOf(s.tick); lastDawn = dawnIndex(s.tick);
  fallSeen = app.ruin ? s.id : null;
}

// ---- The fall and the Ruin (EMBERCROWN-FORTRESS.md 1.3, F8) -------------------------------------------
/** Has this colony (default: the open one) fallen? */
export const isRuin = (s = app.s) => isFallen(s);
/** What the final screen and the Ruin card show (colony/fall.js). */
export const ruinSummary = (s = app.s) => (s ? fallSummary(s) : null);
let fallSeen = null;
/**
 * Call once per frame (the shell) or after stepping: on the first check that finds the open colony
 * fallen, it is saved once (its final state) and 'ec2:fallen' fires with the summary. Returns the summary
 * that time, else null.
 */
export function checkFall() {
  const s = app.s;
  if (!s || !isFallen(s) || fallSeen === s.id) return null;
  fallSeen = s.id; app.ruin = true;
  const summary = fallSummary(s);
  saveNow('fallen').catch(() => null);
  try { window.dispatchEvent(new CustomEvent('ec2:fallen', { detail: { id: s.id, summary } })); } catch (_) { /* Node */ }
  return summary;
}
/** View the ruin: the colony's newest copy at its final state, read-only (no commands, nothing ticks). */
export async function openRuin(id) {
  const s = await continueColony(id);
  if (s && !isFallen(s)) throw new Error('This hold has not fallen.');
  return s;
}

// ---- Settings > Storage > Recover from a device problem (1.3, 5.5) -----------------------------------
export const RECOVER_TEXT = Object.freeze({
  title: 'Recover from a device problem',
  help: 'Every hold keeps its last two saves and a backup from the last dawn. If the game or the phone lost your progress, load one of them here.',
  confirm: 'Use this only if the game or the phone lost your progress. A fallen hold stays fallen in its Annals.',
  load: 'Load this copy', cancel: 'Cancel',
  none: 'No colonies are stored on this device.',
  done: 'The hold goes on from this copy.',
});
const COPY_LABEL = Object.freeze({ a: 'Save slot A', b: 'Save slot B', dawn: 'Dawn backup' });
/** Each colony's stored copies (a, b, dawn) with their game dates, newest first (cards order). */
export async function recoveryList() {
  const out = [];
  for (const c of listColonies()) {
    const copies = [];
    for (const k of await readCopies(c.id).catch(() => [])) {
      let fallen = false;
      try { fallen = !!(await peekBlob(k.bytes)).fallen; } catch (_) { continue; }   // a damaged copy is not offered
      copies.push({ which: k.which, label: COPY_LABEL[k.which] || k.which, tick: k.tick, date: k.date, savedAt: k.savedAt, fallen });
    }
    out.push({ id: c.id, name: c.name, fallen: !!c.fallen, fellText: c.fallen && Number.isInteger(c.fallenAt) ? dateText(c.fallenAt) : null, copies });
  }
  return out;
}
/**
 * Load copy `which` (a | b | dawn) of colony `id` as the colony. A copy that has not fallen is saved and
 * becomes both a and b; when it predates the colony's fall it first gets the Chronicle line "Recovered
 * from a copy of <date>" (so the record stays honest about the rollback). A fallen copy opens as the
 * Ruin and changes nothing.
 */
export async function recoverCopy(id, which) {
  ensureSim();
  const copy = (await readCopies(id)).find((k) => k.which === which);
  if (!copy) throw new Error('That copy is no longer stored on this device.');
  const s = await loadBlob(copy.bytes);
  s.id = id;
  if (!isFallen(s)) {
    const card = listColonies().find((c) => c.id === id) || {};
    // a copy from before the hold fell: the Chronicle says so, so the record stays honest (1.3)
    if (card.fallen) addChron(s, 'recovered', 'chron_recovered', { date: dateText(s.tick), from: which, fell: Number.isInteger(card.fallenAt) ? dateText(card.fallenAt) : null });
    const bytes = await saveBlob(s);
    await restoreCopy(id, bytes, cardOf(s, { recoveredFrom: which }));
  }
  setOpen(s);
  return s;
}
/**
 * The Recover from a device problem panel (DOM, browser only): one section per colony, one row per
 * stored copy; a tap asks once (RECOVER_TEXT.confirm), then loads. opts.onLoaded(state) enters the game.
 */
export function mountRecoverPanel(el, opts = {}) {
  const doc = el.ownerDocument || document;
  const mk = (tag, cls, text, attrs = {}) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; for (const k of Object.keys(attrs)) e.setAttribute(k, attrs[k]); return e; };
  const root = mk('section', 'ec-recover', undefined, { 'data-panel': 'recover' });
  root.append(mk('h3', 'ec-sub', RECOVER_TEXT.title), mk('p', 'ec-bio-d', RECOVER_TEXT.help));
  const list = mk('div', 'ec-recover-list', undefined, { role: 'list' });
  const status = mk('p', 'ec-bio-d', 'Reading the stored copies...', { role: 'status' });
  root.append(list, status);
  el.append(root);
  const ask = (row, c, k) => {
    for (const x of list.querySelectorAll('.ec-recover-ask')) x.remove();
    const box = mk('div', 'ec-recover-ask', undefined, { role: 'group', 'aria-label': `${c.name}: ${k.label}`, style: 'display:grid;gap:10px;margin:4px 0 12px' });
    const yes = mk('button', 'ec-btn primary', undefined, { type: 'button', 'data-act': 'recover-load' });
    yes.append(mk('span', 'ec-btn-label', RECOVER_TEXT.load), mk('span', 'ec-btn-sub', `${c.name}, ${k.date}`));
    const no = mk('button', 'ec-btn', undefined, { type: 'button', 'data-act': 'recover-cancel' });
    no.append(mk('span', 'ec-btn-label', RECOVER_TEXT.cancel));
    box.append(mk('p', 'ec-bio-d', RECOVER_TEXT.confirm), yes, no);
    row.after(box);
    no.addEventListener('click', () => box.remove());
    yes.addEventListener('click', async () => {
      yes.disabled = true; status.textContent = 'Loading...';
      try {
        const s = await recoverCopy(c.id, k.which);
        status.textContent = isFallen(s) ? 'This copy is the ruin.' : RECOVER_TEXT.done;
        if (opts.toast) opts.toast(status.textContent);
        if (opts.onLoaded) opts.onLoaded(s);
      } catch (e) { yes.disabled = false; status.textContent = `The copy could not be loaded: ${e && e.message ? e.message : e}`; }
    });
  };
  recoveryList().then((cols) => {
    list.textContent = '';
    if (!cols.length) { status.textContent = RECOVER_TEXT.none; return; }
    status.textContent = '';
    for (const c of cols) {
      list.append(mk('h4', 'ec-row-help', c.fallen ? `${c.name} (fell ${c.fellText || ''})`.replace(' ()', '') : c.name, { role: 'heading', 'aria-level': '4' }));
      if (!c.copies.length) { list.append(mk('p', 'ec-row-help', 'No readable copy is stored.')); continue; }
      for (const k of c.copies) {
        const row = mk('button', 'ec-row', undefined, { type: 'button', role: 'listitem', 'data-act': 'recover-copy', 'data-colony': c.id, 'data-which': k.which });
        row.append(mk('span', 'ec-row-n', k.date), mk('span', 'ec-row-s', k.fallen ? `${k.label}, fallen` : k.label));
        row.addEventListener('click', () => ask(row, c, k));
        list.append(row);
      }
    }
  }).catch(() => { status.textContent = 'The stored copies could not be read.'; });
  return root;
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
    colonies: cards.map((c) => ({ id: c.id, name: c.name, size: c.size || 0, lastBackupAt: c.lastBackupAt || 0, dawnDay: c.dawnDay ?? null, missing: !!c.missing, fallen: !!c.fallen })),
    count: cards.length, max: MAX_COLONIES, room: colonyRoom(), classic: classicSaves(),
  };
}

/** Settings > Storage: the /classic/ saves as a file (share sheet, else a download). Call it from the tap. */
export async function exportClassicSaves() {
  const ex = exportClassic();
  if (!ex.keys.length) return { ok: false, reason: 'There are no classic saves in this browser.', keys: [] };
  const bytes = new TextEncoder().encode(ex.text);
  let via = 'download';
  try {
    const file = typeof File === 'function' ? new File([bytes], ex.filename, { type: 'application/json' }) : null;
    if (file && navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) { await navigator.share({ files: [file], title: ex.filename }); via = 'share'; }
    else downloadBytes(bytes, ex.filename);
  } catch (e) {
    if (e && e.name === 'AbortError') return { ok: false, reason: 'cancelled', keys: ex.keys };
    downloadBytes(bytes, ex.filename);
  }
  return { ok: true, via, filename: ex.filename, token: ex.token, keys: ex.keys };
}
/** Remove the classic saves after exportClassicSaves (its token): throws if they changed since. */
export function clearClassicSaves(token) { return clearClassic(token); }

/** Is this fallen state already the colony's stored state (its card records the same fall)? */
function storedRuin(s) {
  const c = isFallenCard(s.id) ? listColonies().find((x) => x.id === s.id) : null;
  return !!c && c.fallenAt === s.colony.fallenAt;
}
let ruinWrite = null;   // { id, p }: the fallen state's one save while it is in flight
/** Save the current colony into its older slot (async deflate; serialised by slots.writeSlot). */
export async function saveNow(why = 'manual') {
  const s = app.s;
  if (!s) return null;
  // a Ruin never changes: once its fallen state is stored, saving again would only rotate the slots and
  // overwrite the older (pre-fall) copy that Recover from a device problem may still need
  if (isFallen(s) && storedRuin(s)) return { which: null, tick: s.tick, size: 0, why, skipped: 'ruin' };
  // the fallen state's save is in flight (Leave right after the fall): wait for it rather than write again
  if (isFallen(s) && ruinWrite && ruinWrite.id === s.id) { await ruinWrite.p.catch(() => null); return { which: null, tick: s.tick, size: 0, why, skipped: 'ruin' }; }
  const p = writeNow(s, why);
  if (isFallen(s)) { const w = { id: s.id, p }; ruinWrite = w; p.catch(() => null).then(() => { if (ruinWrite === w) ruinWrite = null; }); }
  return p;
}
async function writeNow(s, why) {
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
  if (isFallen(app.s)) return { ok: false, reason: 'This hold has fallen: the ruin can be read, not changed.' };
  const r = applyCommand(app.s, cmd, app.log);
  if (r.ok && cmd.t === 'letter') saveSoon('letter');   // 11.4: after each letter is answered
  return r;
}

/** Save and forget the current colony (Quit to title). */
export async function closeColony() {
  if (!app.s) return;
  try { await saveNow('quit'); } finally { app.s = null; app.log = []; app.ruin = false; }
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
    checkFall();
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
    step: (n = 1) => { if (app.s) { step(app.s, n); dispatch(app.s); checkFall(); } return app.s ? app.s.tick : 0; },
    stats: () => (app.s ? { tick: app.s.tick, hash: stateHash(app.s), col: app.s.col.length, bld: app.s.bld.filter(Boolean).length, items: app.s.items.filter(Boolean).length, errors: checkState(app.s).length } : null),
    hash: () => (app.s ? stateHash(app.s) : null),
    newColony, saveNow, continueColony, closeColony, lifecycleSave,
    saveDawn, loadBackup, checkBackup, backupColony, prepareBackup, moveToApp, pasteColonyFromSafari, importColonyFile, storageInfo, isStandalone,
    applySettings, writeSettings, exportClassicSaves, clearClassicSaves, colonyRoom,
    checkFall, isRuin, ruinSummary, openRuin, recoveryList, recoverCopy, mountRecoverPanel, RECOVER_TEXT,
    snapshotMs: () => { if (!app.s) return null; const t0 = performance.now(); const { payload } = snapshot(app.s); return { ms: performance.now() - t0, rawBytes: payload.length }; },
    reload: async () => { if (!app.s) return null; const h = stateHash(app.s); const t = await loadBlob(await saveBlob(app.s)); t.id = app.s.id; app.s = t; return { same: stateHash(t) === h, hash: h }; },
    storage: { listColonies, refreshColonies, readSlots, quickSave: () => app.s && quickSave(app.s), promoteQuick, storageMode, exportBlob, importBlob, deleteColony, persistState, readDawn, writeDawn, updateCard, readSettings, writeSettings, storageBytes, writeSlot, classicSaves, exportClassic, clearClassic, colonyRoom, readCopies, restoreCopy, isFallenCard },
  };
}

function boot() {
  const params = new URLSearchParams(location.search);
  app.debug = params.has('debug');
  if (app.debug) installDebugHook();
  applySettings();
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
