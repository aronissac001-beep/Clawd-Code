// UI boot (owner I). Joins the shell API of js/main.js (owner A: state, saves, lifecycle, debug hook)
// to the screens of js/ui: the title (front.js) and the in-game shell (shell.js).
//
// Until main.js calls mountTitle itself (its header names that contract), index.html loads this
// module after main.js. The title then lives in #title and A's Stage 0 placeholder in #screens is
// hidden by the CSS (body.ec-ui). mountTitle is idempotent, so when A starts calling
// mountTitle(#screens, api) the one title simply moves there.
// `?debug=1&scene=...` belongs to the renderer's debug scenes: the UI stays out of the way.
// `?debug=1&demo=1` fills a new colony with the demo fixture (js/ui/demo.js).
// `?debug=1&safe=t,r,b,l` emulates safe-area insets (layout.js).
import { app, continueColony, saveNow, backupColony, skipBackup, moveToApp, pasteColonyFromSafari, importColonyFile, isStandalone, storageInfo, readSettings, writeSettings, colonyRoom } from '../main.js';
import { listColonies, exportBlob, importBlob } from '../game/save/slots.js';
import { installSim, foundColony, FORTRESS_D } from '../game/core/setup.js';
import { fortressRequested } from '../game/core/flags.js';
import { randomSeedText } from '../engine/rng.js';
import { STAGE } from './stage.js';
import { applyCommand } from '../game/core/commands.js';
import { mountTitle, unmountTitle } from './front.js';
import { mountShell } from './shell.js';
import { emulateInsets } from './layout.js';
import { installFrame } from './frame.js';

const IN_BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';

export const ui = { shell: null, title: null, demo: null, params: null };

/**
 * The sim for the stage the UI offers (stage.js). main.js's ensureSim still installs Stage 1a (owner
 * A); until it installs STAGE itself, the UI founds Stage 1b colonies here (the Hearth needs its
 * start fuel at founding) and re-installs STAGE after main.js loads one. installSim is idempotent.
 */
export function useStage() { return installSim({ stage: STAGE }); }
/** Title > New colony at the UI's stage: deterministic in the seed, saved at once. */
export function foundNew(seed = randomSeedText(), opts = {}) {
  useStage();
  const room = colonyRoom ? colonyRoom() : null;
  if (room) throw new Error(room);
  const d = fortressRequested(typeof location !== 'undefined' ? location.search : '') ? FORTRESS_D : 1;   // Stage Z1: ?fortress=1 (flags.js)
  const s = foundColony({ seed, name: opts.name || 'The Hold', start: opts.start || null, difficulty: opts.difficulty || null, storyteller: opts.storyteller || null, d, realm: opts.realm || null, rx: opts.rx, ry: opts.ry, prep: opts.prep || null });
  app.s = s; app.log = [];
  saveNow('new').catch(() => null);
  return s;
}

/** The API handed to mountTitle (contract in front.js). */
export function titleApi() {
  return {
    listColonies,
    newColony: (o = {}) => {
      const s = foundNew(o.seed || randomSeedText(), o);
      ui.demo = null;
      if (ui.params && ui.params.has('debug') && ui.params.get('demo') === '1') {
        // debug fixture only (never without ?debug=1)
        return import('./demo.js').then((m) => { ui.demo = m.seedDemo(s); return s; });
      }
      return s;
    },
    continueColony: (id) => continueColony(id).then((s) => { useStage(); return s; }),
    colonyRoom: () => (colonyRoom ? colonyRoom() : null),
    readSettings: () => readSettings(),
    writeSettings: (p) => writeSettings(p),
    pasteColonyFromSafari: (text) => pasteColonyFromSafari(text),
    importColonyFile: (f) => importColonyFile(f),
    isStandalone: () => isStandalone(),
    importBlob: (x) => importBlob(x),
    enter: (s, o) => enter(s, o),
  };
}

export async function enter(sOrPromise, opts = {}) {
  const s = await sOrPromise;
  if (!s) return;
  app.s = s;
  unmountTitle();
  const titleRoot = document.getElementById('title');
  if (titleRoot) titleRoot.hidden = true;
  ui.shell = mountShell(document.getElementById('hud'), {
    state: s,
    demo: ui.demo,
    send: (cmd) => applyCommand(s, cmd, app.log),
    resumed: !!opts.resumed,
    saveNow: () => saveNow(),
    exportBlob: (id) => exportBlob(id),
    backupColony: (id) => backupColony(id),
    skipBackup: () => skipBackup(),
    moveToApp: (id) => moveToApp(id),
    isStandalone: () => isStandalone(),
    storageInfo: () => storageInfo(),
    readSettings: () => readSettings(),
    writeSettings: (patch) => writeSettings(patch),
    quit: (o) => { saveNow().catch(() => null).finally(() => showTitle(o && o.view)); },
  });
  if (window.__ec) window.__ec.ui = ui;
}

export function showTitle(view) {
  if (ui.shell) { ui.shell.destroy(); ui.shell = null; }
  app.s = null;
  const root = document.getElementById('title') || document.getElementById('screens');
  root.hidden = false;
  ui.title = mountTitle(root, titleApi(), { view });
  return ui.title;
}

function boot() {
  ui.params = new URLSearchParams(location.search);
  if (ui.params.has('debug') && ui.params.get('scene')) return;
  if (ui.params.has('debug')) emulateInsets(ui.params);
  installFrame();
  showTitle();
  // main.js promotes a pagehide quick-save asynchronously at boot; show its colony once it lands
  const again = () => { if (ui.title && !ui.shell) ui.title.refresh(); };
  setTimeout(again, 400); setTimeout(again, 1500);
  window.__ecUI = ui;
}

if (IN_BROWSER) boot();
