// The Dawn Ledger counters (doc 10.10). Owner K. Provisional API; on from Stage 1b.
//
// s.colony.ledger (C2 json) = { day: {key: n}, total: {key: n}, since: tick, prev: {key: n} | null,
// prevSince: tick }. `day` holds what happened since the last 06:00, `prev` the full day before it
// (what the Dawn Ledger card shows at dawn: dawnLedger()), `total` the colony's lifetime counts
// (deeds read them). Keys are LEDGER_KEYS (code iterates this list, never the objects' keys).
// Counters roll at 06:00 (tick % DAY == 6 x HOUR): prev = day, day = zeros; all of it is saved with
// the colony record.
// Sources:
//   - bump(s, key) from the system that does the thing (H: raidsRepelled at a raid's end);
//   - the sim-side hooks K owns (installLedger): BUS.built, BUS.kill (deaths, kills), B's terrain
//     onTileWrite (mined rock);
//   - the events tap (ledgerSystem, last in the 'colony' slot): the C8 events emitted by this
//     tick's systems before it (e.tick === s.tick, scanned back from the end of the queue):
//     crafted (meals: crafted with k 'meal'), hauled, oreFound, masterwork. The queue is drained only
//     between ticks, and the tap never looks at an earlier tick, so the count does not depend on when
//     the controller drains (1x, 5x, headless, a reload). Events from command appliers (between ticks)
//     and from endOfTick are never counted. A reviewer note for A (C8 says the sim never reads the
//     queue): the tap is read-only and same-tick; the alternative is E and B calling bump() at the
//     source, which this module supports unchanged.

import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../core/time.js';
import { TER, TER_MINEABLE } from '../core/grid.js';
import { BUS } from '../core/bus.js';
import { onTileWrite } from '../world/terrain.js';

export const LEDGER_KEYS = Object.freeze(['mined', 'built', 'crafted', 'hauled', 'meals', 'raidsRepelled', 'deaths', 'kills',
  'arrivals', 'oreFound', 'masterworks', 'researched']);
export const RESET_TICK = 6 * TICKS_PER_HOUR;

export const LEDGER_LABELS = Object.freeze({ mined: 'Tiles mined', built: 'Built', crafted: 'Crafted', hauled: 'Hauled', meals: 'Meals cooked',
  raidsRepelled: 'Raids repelled', deaths: 'Deaths', kills: 'Foes slain', arrivals: 'Arrivals', oreFound: 'Ore found',
  masterworks: 'Masterworks', researched: 'Researched' });

const zeros = () => Object.fromEntries(LEDGER_KEYS.map((k) => [k, 0]));
/** The ledger record, created on first use (an empty colony record has ledger = {}). */
export function ledgerOf(s) {
  const l = s.colony.ledger;
  if (!l.day) { l.day = zeros(); l.total = zeros(); l.since = s.tick; }
  if (l.prev === undefined) { l.prev = null; l.prevSince = -1; }
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

/** Event name -> ledger key (and an optional test on the payload), for the events tap. */
const TAP = Object.freeze([['crafted', 'crafted', null], ['crafted', 'meals', (d) => !!d && d.k === 'meal'], ['hauled', 'hauled', null],
  ['oreFound', 'oreFound', null], ['masterwork', 'masterworks', null]]);
/** Count this tick's events (see the header). */
export function tapEvents(s) {
  const q = s.rt && s.rt.events;
  if (!q || !q.length) return;
  let k = q.length - 1;
  while (k >= 0 && q[k].tick === s.tick) k--;
  for (let j = k + 1; j < q.length; j++) {
    const e = q[j];
    for (const [name, key, test] of TAP) if (e.name === name && (!test || test(e.data))) bump(s, key);
  }
}

/** Tick system (slot 'colony', after every other colony system): the events tap, then the 06:00 roll. */
export function ledgerSystem(s) {
  tapEvents(s);
  if (s.tick % TICKS_PER_DAY !== RESET_TICK) return;
  const l = ledgerOf(s);
  l.prev = l.day; l.prevSince = l.since;
  l.day = zeros();
  l.since = s.tick;
}

/**
 * The Dawn Ledger card (10.10): the day that ended at the last 06:00, as rows [key, label, n] in
 * LEDGER_KEYS order (zeros left out), or null before the first dawn roll.
 */
export function dawnLedger(s) {
  const l = ledgerOf(s);
  if (!l.prev) return null;
  const rows = [];
  for (const k of LEDGER_KEYS) if (l.prev[k]) rows.push([k, LEDGER_LABELS[k], l.prev[k]]);
  return { since: l.prevSince, until: l.since, rows };
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
