// Great beast generation (EMBERCROWN-FORTRESS.md 3.12, step Z3.3). Owner H; tables in js/data/beasts.js (G).
// Pure: a beast is a function of its dormant row [kind, voxel, seed] only (gen3:beasts rows from mapgen3), so the
// same seed gives the same beasts in any order of calls and on any device (C13). The name, body plan and material
// come from legends.js beastIdentity, which the pre-history already uses, so the Annals and the beast agree.
//   genBeast(row)        -> Beast for a 'lair' row (generated) or a legend row (lair_gloomwyrm, lair_colossus, sleep)
//   holdBeasts(s)        -> [Beast] of this hold, in row order (derived from the pristine meta; never saved)
//   beastByKey(s, key)   -> Beast | null
//   beastHistory(s, b)   -> { wkey, name, lair, born, kills, wounds, razed, alive, lines } | null: what the realm's history
//                           knows of beast b (W3.5, EMBERCROWN-WORLD.md 2.7 Beasts), for its peek card; a pure read
//                           of the realm record s.rt.realm, never of the sim (render and UI only)
// Beast: { key, row, legend, name, plan, mat, size, hp, armour, attacks: [id], beh, base, moves, zones, soft,
//          drop, n, lair, z, knights?, wkey? }   key = 'b' + lair voxel (base 36), the legend record key (kind b).
// W3.5: a 'world_lair' row [kind, voxel, identitySeed, worldKey] (mapgen3 regionRows: a world beast of the realm's
// history whose lair is in or next to the hold's region) is a generated beast whose identity seed is the realm beast's
// own, so its name is the history's; `wkey` ('wb<id>') links it to its record. Holds without such rows are unchanged.

import { hashString } from '../../core/rand.js';
import { PLANE } from '../../core/grid.js';
import { beastIdentity } from '../../colony/legends.js';
import { DATA } from '../../../data/beasts.js';
import { dormantRows } from '../causes.js';
import { recordOf, recordName, eventsOf, eventText } from '../../../data/text/realm.js';

const byId = (rows) => Object.freeze(Object.fromEntries(rows.map((r) => [r.id, r])));
export const BODY = byId(DATA.body), MAT = byId(DATA.material), ATTACK = byId(DATA.attack), BEH = byId(DATA.behaviour);
export const LEGEND_ROWS = Object.freeze(Object.fromEntries(DATA.legend.map((l) => [l.row, l])));
export const ROW_KINDS = Object.freeze(['lair', ...DATA.legend.map((l) => l.row), 'world_lair']);
export const TUNE = Object.freeze({ ...DATA.tuning[0] });
export const keyOf = (voxel) => 'b' + (voxel >>> 0).toString(36);

// attacks a plan can roll (weights): every plan bites or crushes; the rest by body
const PLAN_ATTACKS = Object.freeze({
  serpent: ['bite', 'sting', 'cry'], manylegged: ['bite', 'sting', 'web'], winged: ['bite', 'breath', 'cry'], toad: ['bite', 'web', 'cry'],
  blob: ['crush', 'sting', 'darkness'], giant: ['crush', 'cry', 'darkness'], crab: ['crush', 'bite', 'cry'], eel: ['bite', 'darkness', 'sting'],
});
const PLAN_BEH = Object.freeze({
  serpent: ['ambusher', 'territorial', 'wanderer'], manylegged: ['ambusher', 'burrower', 'territorial'], winged: ['hoarder', 'wanderer', 'territorial'],
  toad: ['territorial', 'wanderer', 'ambusher'], blob: ['wanderer', 'ambusher', 'burrower'], giant: ['wanderer', 'hoarder', 'territorial'],
  crab: ['territorial', 'hoarder', 'burrower'], eel: ['ambusher', 'burrower', 'territorial'],
});

/** One beast from its dormant row (pure). */
export function genBeast(row) {
  const [kind, v, seed, wkey] = row;
  const z = (v / PLANE) | 0;
  const L = LEGEND_ROWS[kind];
  if (L) {
    const b = BODY[L.plan];
    const out = { key: keyOf(v), row: kind, legend: L.id, name: L.name, plan: L.plan, mat: L.mat, size: L.size, hp: L.hp, armour: L.armour,
      attacks: L.attacks.slice(), beh: L.beh, base: L.base, moves: L.moves.slice(), zones: b.zones.map((x) => x.slice()), soft: (MAT[L.mat] || {}).soft || 'head',
      drop: L.drop.slice(), n: L.n, lair: v, z };
    if (L.knights) out.knights = L.knights.slice();
    return Object.freeze(out);
  }
  const id = beastIdentity(seed);
  const b = BODY[id.body], m = MAT[id.material];
  const h = hashString('beastgen:' + (seed >>> 0));
  const pa = PLAN_ATTACKS[id.body];
  const a1 = pa[0], two = ((h >>> 3) & 3) !== 0;   // three in four have a second attack
  const attacks = two ? [a1, pa[1 + ((h >>> 5) % (pa.length - 1))]] : [a1];
  const beh = PLAN_BEH[id.body][(h >>> 9) % 3];
  const hp = Math.floor((b.hp * m.hpPct) / 100) + ((h >>> 12) % 9) * 10;
  const out = { key: keyOf(v), row: kind, legend: null, name: id.full, plan: id.body, mat: id.material, size: b.size, hp, armour: m.armour,
    attacks, beh, base: b.base, moves: b.moves.slice(), zones: b.zones.map((x) => x.slice()), soft: m.soft, drop: m.drop.slice(), n: m.n, lair: v, z };
  if (kind === 'world_lair' && typeof wkey === 'string' && /^wb\d+$/.test(wkey)) out.wkey = wkey;
  return Object.freeze(out);
}

/** The hold's realm record with history (s.rt.realm, wid-checked), or null. */
function realmOf(s) {
  const R = s && s.realm && s.rt ? s.rt.realm : null;
  return R && (R.wid >>> 0) === (s.realm.wid >>> 0) && R.tables && Array.isArray(R.tables.beasts) ? R : null;
}
/** What the realm's history knows of beast b: its record (born, kills, wounds, razings) and its last 3 deeds as text. */
export function beastHistory(s, b, max = 3) {
  const R = b && b.wkey ? realmOf(s) : null, r = R ? recordOf(R, b.wkey) : null;
  if (!r) return null;
  const lines = [];
  const ev = eventsOf(R, b.wkey);
  for (let k = ev.length - 1; k >= 0 && lines.length < max; k--) { const t = eventText(R, ev[k]); if (t && t.text) lines.unshift(t.text); }
  return { wkey: b.wkey, name: r.name || b.name, lair: Number.isInteger(r.site) ? recordName(R, 'ws' + r.site) : null, born: r.born, kills: r.kills | 0, wounds: r.wounds | 0, razed: r.razed | 0, alive: r.alive !== false, lines };
}

/** The hold's beasts (generated and legends), in dormant row order. Derived; cached on the pristine rows. */
const CACHE = new WeakMap();
export function holdBeasts(s) {
  const rows = dormantRows(s, ROW_KINDS);
  const k = rows.length ? rows[0] : null;
  if (k && CACHE.has(k)) return CACHE.get(k);
  const out = rows.map(genBeast);
  if (k) CACHE.set(k, out);
  return out;
}
export const beastByKey = (s, key) => holdBeasts(s).find((b) => b.key === key) || null;
/** The wound zone a blow lands on (weights; pure in r, a u32). Returns [name, hpPct]. */
export function zoneFor(beast, r) {
  let t = 0; for (const z of beast.zones) t += z[1];
  let x = r % t;
  for (const z of beast.zones) { x -= z[1]; if (x < 0) return [z[0], z[2]]; }
  return [beast.zones[0][0], beast.zones[0][2]];
}
