// Backup timing, the dawn slot schedule and Move to app (owner A; doc 11.1, 11.5, D11; Stage 1b).
// Pure rules on real-time stamps and the colony tick: the shell (js/main.js) runs them, I's cards
// (js/ui/backup.js, a2hs.js, colonies.js) show the result. Real time is fine here: none of this
// changes sim state (11.4), so it never touches determinism.
//
//   dawnIndex(tick)                    the game day whose 06:00 the tick is at or after (day 1 06:00 -> 0)
//   seasonKey(tick)                    year * 4 + season: the "once per game season" key
//   backupDue({ card, now, tick, atDawn, standalone, settings })
//                                      -> null | { reason: 'season' | 'stale', ageDays }
//     'season' once per game season, at dawn, in a Safari tab or the app;
//     'stale'  whenever the last backup (or, never backed up, the colony's first save) is older than
//              BACKUP.staleDays real days while the game runs in a Safari tab;
//     either way at most once every BACKUP.minGapDays real days (since the last prompt and since the
//     last backup, or the first save of a colony never backed up). Settings can turn the prompt off (settings.backupPrompt === false), but only while the
//     game runs as a Home Screen app: in a Safari tab the prompt always stays on (11.1, 7-day eviction).
//   PERSIST_TEXT                       the Settings > Storage line for each persistState() answer
//   MOVE_STEPS                         the 3 steps of "Move colony to the app" (11.5)

import { TICKS_PER_DAY, TICKS_PER_HOUR, START_HOUR, yearOf, seasonOf } from '../core/time.js';

export const DAY_MS = 86400000;
/** Tuning (moves to balance.js SAVE with G). */
export const BACKUP = Object.freeze({ minGapDays: 3, staleDays: 6, dawnHour: START_HOUR });

export const dawnIndex = (tick) => Math.floor((tick - BACKUP.dawnHour * TICKS_PER_HOUR) / TICKS_PER_DAY);
export const seasonKey = (tick) => yearOf(tick) * 4 + seasonOf(tick);

/** May the player turn the prompt off? Only as a Home Screen app (11.5). */
export const canTurnOffPrompt = (standalone) => !!standalone;
export const promptOn = (settings, standalone) => !(standalone && settings && settings.backupPrompt === false);

export function backupDue({ card, now, tick, atDawn = false, standalone = false, settings = {} } = {}) {
  if (!card || card.missing || !Number.isFinite(now)) return null;
  if (!promptOn(settings, standalone)) return null;
  // the last backup, or for a colony never backed up its first save (no prompt in its first 3 days)
  const lastPrompt = card.backupPromptAt || 0, since = card.lastBackupAt || card.createdAt || 0;
  if (now - lastPrompt < BACKUP.minGapDays * DAY_MS || now - since < BACKUP.minGapDays * DAY_MS) return null;
  const ageDays = since ? (now - since) / DAY_MS : Infinity;
  if (!standalone && since && ageDays >= BACKUP.staleDays) return { reason: 'stale', ageDays };
  if (atDawn && card.backupPromptSeason !== seasonKey(tick)) return { reason: 'season', ageDays };
  return null;
}

/** Settings > Storage: the persist() answer (11.1). */
export const PERSIST_TEXT = Object.freeze({
  protected: 'Protected: this browser keeps your saves.',
  'may be cleared': 'May be cleared: Safari can delete saves after 7 days away. Back up your hold, or add it to your Home Screen.',
  unknown: 'Unknown: this browser does not say whether it keeps saves. Back up your hold.',
});

export const MOVE_STEPS = Object.freeze([
  'Tap Share, then Add to Home Screen, then Add.',
  'Open Embercrown from your Home Screen.',
  'Tap "Paste a colony from Safari".',
]);
export const MOVED_TEXT = 'Moved. You can delete the Safari copy.';
