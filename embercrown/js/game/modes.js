// Game modes beyond the Campaign: Endless (one region, how long can you last),
// Daily Realm (one fixed seed per calendar day, local best table) and Sandbox
// (everything unlocked, no rewards). run.mode / s.mode carry the choice.
import { BUILDINGS } from '../data/buildings.js';
import { STORYTELLER_LIST } from '../data/storytellers.js';
import { hashString } from '../engine/rng.js';
import { BUS } from './hooks.js';
import { emit } from './systems/common.js';

export const MODES = {
  campaign: { id: 'campaign', name: 'Campaign', desc: 'The full road: three acts, three bosses. Earns Embers.' },
  endless: { id: 'endless', name: 'Endless', desc: 'One region and no Beacon. How many nights can you hold? The Hollow grow every few nights.' },
  daily: { id: 'daily', name: 'Daily', desc: 'Everyone gets the same realm today. No perks or Omens. Beat your best score.' },
  sandbox: { id: 'sandbox', name: 'Sandbox', desc: 'Every faction and blueprint unlocked, extra supplies. No Embers or achievements.' },
};
export const MODE_LIST = ['campaign', 'endless', 'daily', 'sandbox'];
/** The four peoples a Daily Realm may assign (never an unlockable one). */
const DAILY_FACTIONS = ['dawnhold', 'sylvari', 'deepforge', 'emberkin'];
export const ENDLESS_TIER_NIGHTS = 6;

/** Local calendar day as YYYYMMDD. */
export function dailyKey(d = new Date()) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

/** Today's fixed setup, derived only from the date. */
export function dailyConfig(key = dailyKey()) {
  const h = hashString('DAILY' + key);
  return {
    seedText: `DAILY-${key}`, difficulty: 'standard',
    faction: DAILY_FACTIONS[h % DAILY_FACTIONS.length],
    storyteller: STORYTELLER_LIST[(h >>> 8) % STORYTELLER_LIST.length].id,
    mode: 'daily', dailyKey: key,
  };
}

/** Score for a finished run (Daily table; also shown for Endless). */
export function runScore(run) {
  const st = run.stats || {};
  const won = run.outcome && run.outcome.result === 'victory';
  return Math.round((run.regionsCleared || 0) * 100 + (st.nights || 0) * 10 + (st.kills || 0) + ((run.act || 1) - 1) * 300 + (won ? 2000 : 0));
}

/** Record a finished run in meta (Daily best table, Endless best nights). Returns lines for the summary. */
export function recordModeResult(meta, run) {
  const out = [];
  if (run.mode === 'daily') {
    const key = run.dailyKey || run.seedText.replace(/^DAILY-/, '');
    meta.daily = meta.daily || {};
    const d = meta.daily[key] || { best: 0, tries: 0, faction: run.faction };
    const score = runScore(run);
    d.tries++;
    const isBest = score > d.best;
    if (isBest) { d.best = score; d.faction = run.faction; }
    meta.daily[key] = d;
    // Keep the table small: the 30 most recent days.
    const keys = Object.keys(meta.daily).sort();
    while (keys.length > 30) delete meta.daily[keys.shift()];
    out.push(['Daily score', isBest ? `${score} (new best)` : `${score} (best ${d.best})`]);
  }
  if (run.mode === 'endless') {
    meta.best.endless = Math.max(meta.best.endless || 0, run.stats.nights || 0);
    out.push(['Best endless', `${meta.best.endless} nights`]);
  }
  return out;
}

/** Daily best table rows, newest first: [{ key, label, best, tries, faction }]. */
export function dailyTable(meta, n = 7) {
  const d = meta.daily || {};
  return Object.keys(d).sort().reverse().slice(0, n).map((k) => ({
    key: k, label: `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6)}`, ...d[k],
  }));
}

let registered = false;
export function register() {
  if (registered) return;
  registered = true;

  BUS.runNew.push((run, opts) => {
    if (run.mode === 'daily') run.dailyKey = opts.dailyKey || run.seedText.replace(/^DAILY-/, '');
    if (run.mode === 'sandbox') {
      // Every blueprint the faction may use, from the very start.
      run.locked = { buildings: [], relics: [], heroes: [] };
      run.blueprints = Object.keys(BUILDINGS).filter((t) => BUILDINGS[t].cat && (!BUILDINGS[t].faction || BUILDINGS[t].faction === run.faction));
      run.gold += 150;
    }
  });

  BUS.runRegion.push((run, node, params) => {
    if (run.mode === 'sandbox') for (const k of ['food', 'wood', 'stone']) params.start[k] = (params.start[k] || 0) + 150;
  });

  // Endless: every few nights the Hollow grow as if a new act had begun.
  BUS.phase.push((s, phase) => {
    if (phase !== 'dawn' || !s.objective || s.objective.type !== 'endless') return;
    const tier = Math.min(6, 1 + Math.floor(s.cycle.night / ENDLESS_TIER_NIGHTS));
    if (tier > (s.act || 1)) {
      s.act = tier;
      emit(s, { t: 'toast', text: `The Long Night deepens. The Hollow grow stronger (tier ${tier}).`, tone: 'bad', icon: 'skull' });
    }
  });
}
