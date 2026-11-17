// Persistence: run saves, meta progress/settings, and portable export codes.
// Safari can evict storage for sites not on the Home Screen, so players can
// export a compact text code (or .json file) and import it anywhere.

const RUN_KEY = 'embercrown.run';
const META_KEY = 'embercrown.meta';
const BACKUP_KEY = 'embercrown.run.broken';
export const SAVE_FORMAT = 1;

export const DEFAULT_SETTINGS = {
  music: 0.55, sfx: 0.8, muted: false, shake: true, damageNumbers: true,
  textSize: 1, colorblind: false, leftHanded: false, reduceMotion: false,
};

function defaultMeta() {
  return {
    format: SAVE_FORMAT, settings: { ...DEFAULT_SETTINGS }, embers: 0, runs: 0, wins: 0,
    best: { nights: 0 }, tutorialDone: false, homeTipShown: false, lastDifficulty: 'standard',
  };
}

function safeGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (_) { return false; } }
function safeDel(k) { try { localStorage.removeItem(k); } catch (_) { /* ignore */ } }

export function loadMeta() {
  const raw = safeGet(META_KEY);
  const base = defaultMeta();
  if (!raw) return base;
  try {
    const m = JSON.parse(raw);
    return { ...base, ...m, settings: { ...base.settings, ...(m.settings || {}) }, best: { ...base.best, ...(m.best || {}) } };
  } catch (_) { return base; }
}
export function saveMeta(meta) { return safeSet(META_KEY, JSON.stringify(meta)); }

export function saveRun(data) {
  const payload = JSON.stringify({ format: SAVE_FORMAT, savedAt: Date.now(), state: data });
  return safeSet(RUN_KEY, payload);
}
export function hasRun() { return !!safeGet(RUN_KEY); }
export function clearRun() { safeDel(RUN_KEY); }

/** Returns { ok, state, savedAt } or { ok:false, error } and quarantines broken saves. */
export function loadRun() {
  const raw = safeGet(RUN_KEY);
  if (!raw) return { ok: false, error: 'No saved realm.' };
  try {
    const p = JSON.parse(raw);
    if (!p || typeof p !== 'object' || !p.state) throw new Error('Save is empty.');
    return { ok: true, state: p.state, savedAt: p.savedAt };
  } catch (e) {
    safeSet(BACKUP_KEY, raw);
    safeDel(RUN_KEY);
    return { ok: false, error: 'Your saved realm could not be read and was set aside. (' + e.message + ')' };
  }
}

export function requestPersist() {
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (_) { /* ignore */ }
}

// ---- Export / import ----------------------------------------------------------------
function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
async function pipe(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

export function bundle() {
  const run = safeGet(RUN_KEY);
  return { kind: 'embercrown-save', format: SAVE_FORMAT, exportedAt: Date.now(), meta: loadMeta(), run: run ? JSON.parse(run) : null };
}

export async function exportCode() {
  const json = JSON.stringify(bundle());
  const bytes = new TextEncoder().encode(json);
  if (typeof CompressionStream !== 'undefined') {
    try { return 'EC1.' + toB64(await pipe(bytes, new CompressionStream('deflate-raw'))); } catch (_) { /* fall through */ }
  }
  return 'EC0.' + toB64(bytes);
}

export async function importCode(text) {
  const t = (text || '').trim();
  let obj;
  if (t.startsWith('{')) obj = JSON.parse(t);
  else if (t.startsWith('EC1.')) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot read compressed codes. Export again as a file.');
    obj = JSON.parse(new TextDecoder().decode(await pipe(fromB64(t.slice(4).replace(/\s+/g, '')), new DecompressionStream('deflate-raw'))));
  } else if (t.startsWith('EC0.')) obj = JSON.parse(new TextDecoder().decode(fromB64(t.slice(4).replace(/\s+/g, ''))));
  else throw new Error('That does not look like an Embercrown save code.');
  if (!obj || obj.kind !== 'embercrown-save') throw new Error('That code is not an Embercrown save.');
  if (obj.format > SAVE_FORMAT) throw new Error('That save comes from a newer version of the game.');
  if (obj.meta) saveMeta({ ...defaultMeta(), ...obj.meta });
  if (obj.run) safeSet(RUN_KEY, JSON.stringify(obj.run)); else clearRun();
  return obj;
}

export function downloadJson() {
  const blob = new Blob([JSON.stringify(bundle())], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'embercrown-save.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
