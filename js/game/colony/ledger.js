// The Dawn Ledger counters (doc 10.10). Owner K. Provisional API; on from Stage 1b.
//
// s.colony.ledger (C2 json) = { day: {key: n}, total: {key: n}, since: tick }. `day` holds what
// happened since the last 06:00 (the Dawn Ledger card), `total` the colony's lifetime counts
// (deeds read them). Keys are LEDGER_KEYS (code iterates this list, never the objects' keys).
// Counters reset at 06:00 (tick % DAY == 6 x HOUR); they are saved with the colony record.
// Sources: bump() from the system that does the thing; installLedger() adds the sim-side hooks K
// can own itself (BUS.built, BUS.kill, B's terrain onTileWrite for mined rock).

import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../core/time.js';
import { TER, TER_MINEABLE } from '../core/grid.js';
import { BUS } from '../core/bus.js';
import { onTileWrite } from '../world/terrain.js';

export const LEDGER_KEYS = Object.freeze(['mined', 'built', 'crafted', 'hauled', 'meals', 'raidsRepelled', 'deaths', 'kills',
  'arrivals', 'oreFound', 'masterworks', 'researched']);
export const RESET_TICK = 6 * TICKS_PER_HOUR;

const zeros = () => Object.fromEntries(LEDGER_KEYS.map((k) => [k, 0]));
/** The ledger record, created on first use (an empty colony record has ledger = {}). */
export function ledgerOf(s) {
  const l = s.colony.ledger;
  if (!l.day) { l.day = zeros(); l.total = zeros(); l.since = s.tick; }
  return l;
}
export function bump(s, key, n = 1) {
  if (!LEDGER_KEYS.includes(key)) throw new Error(`ledger: unknown key ${key}`);
  const l = ledgerOf(s);
  l.day[key] = (l.day[key] || 0) + n;
  l.total[key] = (l.total[key] || 0) + n;
}
export const today = (s, key) => ledgerOf(s).day[key] || 0;
export const lifetime = (s, key) => ledgerOf(s).total[key] || 0;

/** Tick system (slot 'colony'): reset the day counters at 06:00. */
export function ledgerSystem(s) {
  if (s.tick % TICKS_PER_DAY !== RESET_TICK) return;
  const l = ledgerOf(s);
  l.day = zeros();
  l.since = s.tick;
}

// ---- Sim-side sources K owns ----------------------------------------------------------------
const onBuilt = (s) => bump(s, 'built');
const onKill = (s, victim) => { if (victim && 'sk' in victim) bump(s, 'deaths'); else bump(s, 'kills'); };
let offTile = null;
/** Install the hooks (idempotent). Hooks are code registries; every count lands in the state they are given. */
export function installLedger() {
  if (!BUS.built.includes(onBuilt)) BUS.built.push(onBuilt);
  if (!BUS.kill.includes(onKill)) BUS.kill.push(onKill);
  if (!offTile) offTile = onTileWrite((s, i, layer, before, after) => { if (layer === 'terrain' && TER_MINEABLE[before] === 1 && after === TER.ROUGH) bump(s, 'mined'); });
}
/** Remove the terrain hook (tests). BUS hooks go with resetBus(). */
export function uninstallLedger() { if (offTile) { offTile(); offTile = null; } }
