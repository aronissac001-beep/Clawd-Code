// Breeding and animal products (doc 6.5): tame animals of a kind breed up to their pen's room when
// fed and housed; hens lay, goats give milk and sheep wool. Owner K.
//
// Daily, at midnight (breedingSystem):
//   - births: per pen and kind with at least two grown animals (age >= BREED.adultD days) that are fed
//     (outside Deepcold the pen's ground feeds them; in Deepcold a feed trough or barn stack of animal
//     goods or raw food in the pen does, one unit per animal) and the pen has room for one more: a
//     BREED.permille chance (the 'main' stream) of one newborn, tame, in the same pen. Stops at the
//     animal cap. A birth is counted in the ledger (born) and the Chronicle.
//   - products: each grown tame animal's product counters (a.st.prod, days since the last) rise by one;
//     hens lay on their own (eggs drop where they stand); milk and wool wait for a handler (the Animals
//     giver: productReady / takeProduct).
// Tuning lives here until G moves it into balance.js.

import { TICKS_PER_DAY, seasonOf } from '../core/time.js';
import { nextU32 } from '../core/rand.js';
import { W } from '../core/grid.js';
import { def } from '../colony/defs.js';
import { bump } from '../colony/ledger.js';
import { addChron } from '../colony/chronicle.js';
import { spawn as spawnItem, stacksOn, consume } from '../work/items.js';
import { atCap, spawnAnimal, animTile, herdRec } from './spawn.js';
import { penZones, penRoom, penTiles } from './pens.js';

export const BREED = Object.freeze({ adultD: 3, permille: 350, deepcold: 3 });
export const grown = (a) => a.age >= BREED.adultD * TICKS_PER_DAY;
const LAY = new Set(['egg']);

/** Can the animals of a pen eat today? Outside Deepcold yes; in Deepcold if a feed stack lies in it. */
function fed(s, penId, n) {
  if (seasonOf(s.tick) !== BREED.deepcold) return true;
  let left = n;
  for (const i of penTiles(s, penId)) {
    for (const id of stacksOn(s, i).slice()) {
      const it = s.items[id];
      const d = def('item', it.k);
      if (!d || it.f || (d.cat !== 'animal' && d.cat !== 'rawfood')) continue;
      left -= consume(s, id, left);
      if (left <= 0) return true;
    }
  }
  return left <= 0;
}
/** Products of a grown tame animal that are due: [{ k, n }]. */
export function productsDue(a) {
  const d = def('animal', a.kind);
  if (!d || !d.products || !a.tame || !grown(a)) return [];
  const p = (a.st && a.st.prod) || {};
  return d.products.filter((x) => (p[x.k] | 0) >= x.everyD).map((x) => ({ k: x.k, n: x.n }));
}
/** A handler's product (milk, wool) is ready on this animal? */
export const productReady = (a) => productsDue(a).some((x) => !LAY.has(x.k));
/** Take the handler's products off the animal (milking, shearing): spawns them at its tile. */
export function takeProduct(s, a) {
  const due = productsDue(a).filter((x) => !LAY.has(x.k));
  const i = animTile(a);
  for (const x of due) { if (def('item', x.k)) spawnItem(s, x.k, null, 0, x.n, i % W, (i / W) | 0); a.st.prod[x.k] = 0; }
  return due.length;
}

/** Tick system (slot 'animals'), daily. */
export function breedingSystem(s) {
  if (s.tick % TICKS_PER_DAY !== 0) return;
  // products: counters, and hens lay
  for (const a of s.anim) {
    const d = def('animal', a.kind);
    if (!a.tame || !d || !d.products || !grown(a)) continue;
    if (!a.st) a.st = { mode: 'graze', until: 0, target: null };
    const p = a.st.prod || (a.st.prod = {});
    for (const x of d.products) {
      p[x.k] = (p[x.k] | 0) + 1;
      if (LAY.has(x.k) && p[x.k] >= x.everyD && def('item', x.k)) { const i = animTile(a); spawnItem(s, x.k, null, 0, x.n, i % W, (i / W) | 0); p[x.k] = 0; }
    }
  }
  // births, pen by pen and kind by kind (pens by id, kinds in data order)
  for (const z of penZones(s).sort((p, q) => p.id - q.id)) {
    const here = s.anim.filter((a) => a.tame && a.pen === z.id);
    if (!here.length || !fed(s, z.id, here.length)) continue;
    const kinds = [];
    for (const a of here) if (!kinds.includes(a.kind)) kinds.push(a.kind);
    kinds.sort();
    for (const k of kinds) {
      if (atCap(s)) return;
      const adults = here.filter((a) => a.kind === k && grown(a));
      if (adults.length < 2) continue;
      const room = penRoom(s, z.id), size = (def('animal', k) || {}).size | 0 || 1;
      if (room.used + size > room.cap) continue;
      if (nextU32(s, 'main') % 1000 >= BREED.permille) continue;
      const mom = adults[0], i = animTile(mom);
      const baby = spawnAnimal(s, k, i % W, (i / W) | 0, { tame: true, pen: z.id, age: 0, st: { mode: 'graze', until: s.tick + 200, target: null } });
      if (!baby) continue;
      herdRec(s).born++;
      bump(s, 'born');
      addChron(s, 'animal', 'chron_born', { kind: (def('animal', k) || {}).name || k, animId: baby.id });
    }
  }
}
