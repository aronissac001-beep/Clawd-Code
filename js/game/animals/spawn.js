// Animals on the map: spawning, lookup and the cap (doc 6.5, 12.1). Owner K. Provisional API.
//
// Animal (schema C2) = { id, kind (js/data/animals.js id), name, x, y (world units), hp: { hp, max },
// tame, owner (colonist id who tamed it, or null), pen (zone id or null), age (ticks), job, path,
// st (AI state: { mode: 'wander'|'graze'|'flee'|'hunt'|'manhunt'|'follow', until, target }) }.
// Ids come from s.next.anim. At most CAPS.animals (60) tame + wild: wild spawns and breeding stop.

import { newAnimal } from '../core/schema.js';
import { nextId } from '../core/state.js';
import { ctrW } from '../core/grid.js';
import { def, bal } from '../colony/defs.js';

export const animalById = (s, id) => { for (const a of s.anim) if (a.id === id) return a; return null; };
export const animalCap = () => bal('caps').animals || 60;
export const atCap = (s) => s.anim.length >= animalCap();
export const tameAnimals = (s) => s.anim.filter((a) => a.tame);

/** Spawn an animal of a kind at a tile. Returns it, or null at the cap or for an unknown kind. */
export function spawnAnimal(s, kind, tx, ty, init = {}) {
  const d = def('animal', kind);
  if (!d || atCap(s)) return null;
  const a = newAnimal(nextId(s, 'anim'), kind, { x: ctrW(tx), y: ctrW(ty), hp: { hp: d.hp, max: d.hp }, st: { mode: 'wander', until: 0, target: null }, ...init });
  s.anim.push(a);
  return a;
}
/** Remove an animal (death, slaughter, left the map). */
export function removeAnimal(s, a) { const i = s.anim.indexOf(a); if (i >= 0) s.anim.splice(i, 1); return i >= 0; }
