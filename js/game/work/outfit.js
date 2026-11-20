// Outfits and gear (doc 6.6, 7.4 armoury rack; owner E; Stage 2).
//
// col.gear = { slots: { body, outer, head, feet, hands, trinket, weapon: Bundle }, outfit, chk } (C2
// json). An outfit (js/data/items.js `outfit`: Worker, Soldier, Any) names the item categories a
// colonist may wear (allow; none = everything wearable). Unset: soldiers wear Soldier, others Worker.
// The 'outfit' command (C3) sets it.
// Dressing is a self-care step of the think (think.js, after urgent needs and the fire emergency,
// before work): at most every DRESS_EVERY ticks per colonist (gear.chk), the best allowed item for
// each slot that beats what is worn by DRESS_GAIN is fetched (an armoury rack first when one holds
// it: racks are where colonists swap), put on (the old piece is put down there, for the haulers), and
// the next slot waits for the next check. Scores: armour x 2 + insulation for wear, damage x speed /
// 100 for weapons (the Soldier outfit only: workers do not carry weapons), value for trinkets;
// quality scales them (5.8). Wealth counts worn gear nowhere (it is off the map's stacks).

import { idx, tx, ty, tz } from '../core/grid.js';
import { colById } from '../core/state.js';
import { def, all } from '../core/content.js';
import { registerApplier } from '../core/commands.js';
import { NEXT, T, makeJob, registerToil, keyItem } from './jobs.js';
import { candidates as itemCandidates, carried, put, makeBundle } from './items.js';
import { colTile } from './reserve.js';
import { reachableFrom, distTo } from './windex.js';
import { storeBldAt } from './items.js';

export const DRESS_EVERY = 2400, DRESS_GAIN = 2;
const WEAR_CATS = ['apparel', 'armour', 'weapons', 'art'];
const QPCT = [80, 100, 110, 120, 135, 150];

/** The outfit id a colonist follows. */
export const outfitOf = (col) => (col.gear && col.gear.outfit) || (col.soldier ? 'soldier' : 'worker');
/** Categories the outfit allows (null: every wearable category). */
function allowOf(col) { const o = def('outfit', outfitOf(col)); return o && o.allow ? o.allow : null; }
/** The slot an item kind goes in (weapons: 'weapon'), or null. */
export function slotOf(k) { const d = def('item', k); if (!d) return null; if (d.cat === 'weapons') return 'weapon'; return d.slot || null; }
/** How good a worn piece is (higher is better; 0 for nothing). */
export function gearScore(b) {
  if (!b) return 0;
  const d = def('item', b.k);
  if (!d) return 0;
  const qp = QPCT[b.q | 0] || 100;
  let v = 0;
  if (d.weapon) v = Math.floor(((d.weapon.dmg | 0) * (d.weapon.speed | 0)) / 100);
  else if (d.wear) v = (d.wear.armour | 0) * 2 + (d.wear.insul | 0);
  else if (d.slot === 'trinket') v = Math.max(1, Math.floor((d.value | 0) / 300));
  return Math.max(1, Math.floor((v * qp) / 100));
}
const allowed = (col, k) => {
  const d = def('item', k), a = allowOf(col);
  if (!d || !WEAR_CATS.includes(d.cat) || !slotOf(k)) return false;
  if (d.cat === 'art' && d.slot !== 'trinket') return false;
  if (a) return a.includes(d.cat) || (d.cat === 'art' && a.includes('apparel'));
  return true;
};

/** The dressing job for col now: the best upgrade over all slots, or null. */
export function dressJob(s, col) {
  const g = col.gear || (col.gear = { slots: {}, outfit: null });
  if (!g.slots) g.slots = {};
  if ((g.chk | 0) > s.tick) return null;
  g.chk = s.tick + DRESS_EVERY;
  const from = colTile(col);
  let best = null, gain = DRESS_GAIN - 1, bd = Infinity;
  for (const cat of WEAR_CATS) {
    for (const it of itemCandidates(s, { cat, holder: col.id, minN: 1 }, from, (i) => reachableFrom(s, col, i) || !!storeBldAt(s, i), 16)) {
      if (!allowed(col, it.k)) continue;
      const slot = slotOf(it.k);
      const dg = gearScore(it) - gearScore(g.slots[slot] || null);
      if (dg < gain) continue;
      const d = distTo(s, col, idx(it.x, it.y, it.z | 0)) - (storeBldAt(s, idx(it.x, it.y, it.z | 0)) ? 64 : 0);   // racks first
      if (dg > gain || d < bd) { gain = dg; bd = d; best = it; }
    }
  }
  // a piece the outfit no longer allows comes off (dropped where the colonist stands, then hauled)
  if (!best) {
    for (const slot of Object.keys(g.slots).sort()) {
      const w = g.slots[slot];
      if (w && !allowed(col, w.k)) return makeJob('undress', -1, [{ t: 'undress', slot }]);
    }
    return null;
  }
  return { job: makeJob('dress', keyItem(best.id), [T.goto(idx(best.x, best.y, best.z | 0)), T.pickup(best.id, 1), { t: 'wear' }]), claims: [[keyItem(best.id), 1]] };
}
registerToil('wear', (s, col, job) => {
  const c = carried(col);
  if (!c) return NEXT;
  const slot = slotOf(c.k);
  if (!slot) return NEXT;   // endJob drops it
  const g = col.gear;
  const old = g.slots[slot] || null;
  g.slots[slot] = { ...c, n: 1 };
  job.carry = null;
  const ci = colTile(col);
  if (old) put(s, makeBundle(old.k, old.m, old.q | 0, 1, { hp: old.hp ?? 100, age: old.age | 0, name: old.name || null, maker: old.maker ?? null }), tx(ci), ty(ci), { z: tz(ci) });
  return NEXT;
});
registerToil('undress', (s, col, job, toil) => {
  const g = col.gear, w = g && g.slots ? g.slots[toil.slot] : null;
  if (!w) return NEXT;
  delete g.slots[toil.slot];
  const ci = colTile(col);
  put(s, makeBundle(w.k, w.m, w.q | 0, 1, { hp: w.hp ?? 100, age: w.age | 0, name: w.name || null, maker: w.maker ?? null }), tx(ci), ty(ci), { z: tz(ci) });
  return NEXT;
});

/** The 'outfit' command applier: { colId, outfit }. */
function outfitCmd(s, c) {
  const col = colById(s, c.colId);
  if (!col.gear) col.gear = { slots: {}, outfit: null };
  col.gear.outfit = c.outfit;
  col.gear.chk = 0;
  return { ok: true };
}
export function installOutfits() { registerApplier('outfit', outfitCmd); }
export const OUTFIT_IDS = () => all('outfit').map((o) => o.id);
