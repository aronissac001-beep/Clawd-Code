// Settings (owner A; doc 10.9, 11.2 `ec2.settings`, 14.8 row A). Not part of any colony: one small
// JSON object in localStorage, read and written through save/slots.js readSettings / writeSettings.
// This module is pure: the schema, the defaults, normalisation (unknown keys dropped, bad values
// reset to the default) and the migration of older settings objects. Settings never touch sim state.
//
//   SETTINGS               key -> { def, type, vals?, min?, max?, label, help }   (the Settings screen lists them)
//   SETTINGS_VERSION       the `v` written with the object
//   defaultSettings()      a fresh object with every default
//   normalizeSettings(o)   -> a complete, valid settings object (migrates an older `v`)
//   checkSettingsPatch(p)  -> { ok: {key: value}, rejected: [[key, reason]] }   what writeSettings keeps
//   settingsAttrs(o)       -> { 'data-ec-text': '115', ... }   the <html> attributes main.js sets (CSS hooks for I)

export const SETTINGS_VERSION = 1;

const B = (def, label, help) => Object.freeze({ type: 'bool', def, label, help });
export const SETTINGS = Object.freeze({
  textSize: Object.freeze({ type: 'enum', def: 100, vals: [100, 115, 130], label: 'Text size', help: 'All text at 100%, 115% or 130%.' }),
  reduceMotion: B(false, 'Reduce motion', 'Fewer screen shakes, fades and particles.'),
  colourSafe: B(false, 'Colour-blind safe overlays', 'Designations and zones use patterns as well as colour.'),
  autoPauseImminent: B(false, 'Pause when a raid is near', 'The game pauses when a raid becomes Imminent.'),
  autoPauseLetter: B(false, 'Pause on letters', 'The game pauses while a letter waits for an answer.'),
  autoPauseDowned: B(false, 'Pause when someone is down', 'The game pauses when a colonist is downed.'),
  advancedGrid: B(false, 'Advanced work grid', 'Edit each colonist\'s work priorities one by one instead of roles.'),
  twoFingerPause: B(false, 'Two-finger tap pauses', 'Off by default: it can fire when a pinch starts.'),
  batterySaver: B(false, 'Battery saver', 'Draw at 30 frames a second, even in combat.'),
  leftHanded: B(false, 'Left-handed layout', 'The speed button and the alert stack move to the left.'),
  backupPrompt: B(true, 'Back up your hold prompt', 'The seasonal reminder to save a backup file. Only a Home Screen app can turn it off.'),
  sound: B(true, 'Sound', 'Sound effects.'),
  music: B(true, 'Music', 'Music and ambience.'),
  volume: Object.freeze({ type: 'int', def: 80, min: 0, max: 100, label: 'Volume', help: 'Master volume, 0 to 100.' }),
});
export const SETTING_KEYS = Object.freeze(Object.keys(SETTINGS));

/** null when `v` is a valid value of setting `k`, else the reason. */
export function badSetting(k, v) {
  const d = SETTINGS[k];
  if (!d) return 'no such setting';
  if (d.type === 'bool') return typeof v === 'boolean' ? null : 'must be true or false';
  if (d.type === 'enum') return d.vals.includes(v) ? null : `must be one of ${d.vals.join(', ')}`;
  if (d.type === 'int') return Number.isInteger(v) && v >= d.min && v <= d.max ? null : `must be ${d.min}-${d.max}`;
  return 'unknown type';
}

export function defaultSettings() {
  const o = { v: SETTINGS_VERSION };
  for (const k of SETTING_KEYS) o[k] = SETTINGS[k].def;
  return o;
}

/** Older settings objects: v0 (Stage 1b, no `v`) kept the same keys; text size may have been a string. */
function migrateSettings(o) {
  const x = { ...o };
  if (!Number.isInteger(x.v)) {
    if (typeof x.textSize === 'string' && /^\d+$/.test(x.textSize)) x.textSize = +x.textSize;
    x.v = 1;
  }
  return x;
}

/** A complete, valid settings object from anything (unknown keys are dropped). */
export function normalizeSettings(o) {
  const src = o && typeof o === 'object' && !Array.isArray(o) ? migrateSettings(o) : {};
  const out = defaultSettings();
  for (const k of SETTING_KEYS) if (k in src && !badSetting(k, src[k])) out[k] = src[k];
  return out;
}

/** Split a patch into the keys writeSettings keeps and the rejected ones (with reasons). */
export function checkSettingsPatch(patch) {
  const ok = {}, rejected = [];
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { ok, rejected: [['*', 'not an object']] };
  for (const k of Object.keys(patch)) {
    if (k === 'v') continue;
    const r = badSetting(k, patch[k]);
    if (r) rejected.push([k, r]); else ok[k] = patch[k];
  }
  return { ok, rejected };
}

/** The <html> attributes main.js sets from the settings: hooks for the CSS (I) and the loop (C). */
export function settingsAttrs(o) {
  const s = normalizeSettings(o);
  return {
    'data-ec-text': String(s.textSize),
    'data-ec-motion': s.reduceMotion ? 'reduce' : 'full',
    'data-ec-colours': s.colourSafe ? 'safe' : 'normal',
    'data-ec-hand': s.leftHanded ? 'left' : 'right',
    'data-ec-battery': s.batterySaver ? 'saver' : 'normal',
  };
}
