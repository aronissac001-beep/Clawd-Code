// Animals on the map: spawning, lookup, harm and the cap (doc 6.5, 9.3, 12.1). Owner K.
//
// Animal (schema C2) = { id, kind (js/data/animals.js id), name, x, y (world units), hp: { hp, max },
// tame, owner (colonist id who tamed it, or null), pen (zone id or null), age (ticks), job, path,
// st (AI state: { mode: 'wander'|'graze'|'flee'|'held'|'manhunt'|'follow', until, target, ... }) }.
// Ids come from s.next.anim. At most CAPS.animals (60) tame + wild: wild spawns and breeding stop.
//
// Stage 2:
//   - Wild animals come in from the map edge (wildSpawnSystem, daily at ANIMALS.spawnHour, and a
//     first herd on the first Stage 2 day): a group of one kind, picked by the Greenvale weights
//     below, up to ANIMALS.wildMax wild animals at once. Feral farm kinds (hens, goats, sheep) can be
//     tamed; game (deer, hares, boar) is hunted; wolves are trouble.
//   - Harm: hurtAnimal(s, a, dmg, byColId) lowers hp; at 0 the animal dies (killAnimal): its jobs and
//     path end, it leaves the list and a carcass (item 'carcass', E's item API) drops where it fell.
//     Boar and wolves (pts) that are hurt turn on whoever hurt them (manhunter.enrage).
//   - K's saved record s.colony.herd = { seeded, born } (created on the first Stage 2 animal tick); Z2.7 adds
//     herd.cav = { seeded, flora } for cavern life (caverns.js). The surface wildMax counts herd animals only.
// Tuning lives here until G moves it into js/data/balance.js (an open issue for G).

import { newAnimal } from '../core/schema.js';
import { nextId } from '../core/state.js';
import { ctrW, idx, W, H, TER_PASSABLE, TER_WATER, TILE, ROOF, D, PLANE } from '../core/grid.js';
import { nextU32 } from '../core/rand.js';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../core/time.js';
import { def, bal } from '../colony/defs.js';
import { spawn as spawnItem } from '../work/items.js';
import { endJobsOn } from '../work/reserve.js';
import { keyAnim } from '../work/jobs.js';
import { cancelPath } from '../systems/pathing.js';
import { isCaveDweller } from './caverns.js';

export const ANIMALS = Object.freeze({
  wildMax: 16, spawnHour: 8, spawnEveryD: 2,
  weights: [['deer', 26], ['hare', 18], ['goat', 18], ['hen', 12], ['sheep', 12], ['boar', 8], ['wolf', 6]],
  group: { deer: [2, 4], hare: [1, 2], goat: [2, 3], hen: [2, 4], sheep: [2, 3], boar: [1, 1], wolf: [2, 2] },
});

export const animalById = (s, id) => { for (const a of s.anim) if (a.id === id) return a; return null; };
export const animalCap = () => bal('caps').animals || 60;
export const atCap = (s) => s.anim.length >= animalCap();
export const tameAnimals = (s) => s.anim.filter((a) => a.tame);
export const wildAnimals = (s) => s.anim.filter((a) => !a.tame);
/** Wild animals of the surface herds: wildMax counts these; cavern creatures (caverns.js, Z2.7) keep their own count. */
export const herdAnimals = (s) => s.anim.filter((a) => !a.tame && !isCaveDweller(a));
/** The tile an animal stands on: its plane index (x, y only; callers that need the level use animVoxel). */
export const animTile = (a) => idx(Math.min(W - 1, Math.max(0, Math.floor(a.x / TILE))), Math.min(H - 1, Math.max(0, Math.floor(a.y / TILE))));
/** The voxel an animal stands on (its level included; equals animTile at D = 1). */
export const animVoxel = (a) => animTile(a) + (D > 1 ? (a.z | 0) * PLANE : 0);
/** K's saved herd record (created on first use by a sim system). */
export function herdRec(s) {
  if (!s.colony.herd) s.colony.herd = { seeded: 0, born: 0 };
  return s.colony.herd;
}
const rint = (s, a, b) => a + (nextU32(s, 'main') % (b - a + 1));

/** Spawn an animal of a kind at a tile. Returns it, or null at the cap or for an unknown kind. */
export function spawnAnimal(s, kind, tx, ty, init = {}) {
  const d = def('animal', kind);
  if (!d || atCap(s)) return null;
  const a = newAnimal(nextId(s, 'anim'), kind, { x: ctrW(tx), y: ctrW(ty), hp: { hp: d.hp, max: d.hp }, st: { mode: 'wander', until: 0, target: null }, ...init });
  s.anim.push(a);
  return a;
}
/** Remove an animal (death, slaughter, left the map). */
export function removeAnimal(s, a) {
  const i = s.anim.indexOf(a);
  if (i < 0) return false;
  s.anim.splice(i, 1);
  if (s.rt && s.rt.res) endJobsOn(s, keyAnim(a.id));
  if (s.rt && s.rt.pathQ) cancelPath(s, 'a', a.id);
  return true;
}
let onHurt = null;
/** manhunter.js plugs in the revenge rule: fn(s, a, byColId). */
export function setHurtHook(fn) { onHurt = fn; }
/** An animal dies where it stands: a carcass drops (meat for the butcher), and it is gone. */
export function killAnimal(s, a) {
  const i = animTile(a), z = a.z | 0;
  removeAnimal(s, a);
  if (def('item', 'carcass')) spawnItem(s, 'carcass', null, 0, 1, i % W, (i / W) | 0, D > 1 ? { z } : {});
  return true;
}
/** Damage an animal. Returns true when it died. */
export function hurtAnimal(s, a, dmg, byColId = null) {
  if (!a || !a.hp) return false;
  a.hp.hp = Math.max(0, (a.hp.hp | 0) - Math.max(1, dmg | 0));
  if (a.hp.hp <= 0) { killAnimal(s, a); return true; }
  if (onHurt) onHurt(s, a, byColId);
  return false;
}

// ---- Wild arrivals --------------------------------------------------------------------------------------
/** A passable, dry, open-sky tile on the map edge near a random point (the next side when one is all rock or water), or -1. */
export function edgeTile(s) {
  const side0 = nextU32(s, 'main') % 4, along = nextU32(s, 'main') % Math.max(W, H);
  for (let k = 0; k < 4; k++) {
    const side = (side0 + k) % 4, len = side < 2 ? W : H, a0 = along % len;
    for (let d = 0; d < len; d++) {
      for (const sgn of [1, -1]) {
        const t = a0 + sgn * d;
        if (t < 0 || t >= len) continue;
        for (let inset = 0; inset < 3; inset++) {
          const x = side < 2 ? t : side === 2 ? inset : W - 1 - inset;
          const y = side === 0 ? inset : side === 1 ? H - 1 - inset : t;
          const i = idx(x, y, D > 1 && s.rt.skyZ ? Math.min(D - 1, s.rt.skyZ[y * W + x]) : 0), tr = s.L.terrain[i];   // Z1: the open ground of the column
          if (TER_PASSABLE[tr] && !TER_WATER[tr] && s.L.roof[i] === ROOF.OPEN && s.rt.occ[i] < 0) return i;
        }
      }
    }
  }
  return -1;
}
function pickKind(s) {
  const ws = ANIMALS.weights.filter(([k]) => def('animal', k));
  let tot = 0; for (const [, w] of ws) tot += w;
  if (!tot) return null;
  let r = nextU32(s, 'main') % tot;
  for (const [k, w] of ws) { r -= w; if (r < 0) return k; }
  return ws[0][0];
}
/** One wild group comes in from the edge. Returns the animals spawned. */
export function wildGroup(s, kind = null) {
  const k = kind || pickKind(s);
  if (!k) return [];
  const at = edgeTile(s);
  if (at < 0) return [];
  const [lo, hi] = ANIMALS.group[k] || [1, 2];
  const n = rint(s, lo, hi), out = [];
  for (let j = 0; j < n && !atCap(s) && herdAnimals(s).length < ANIMALS.wildMax; j++) {
    const a = spawnAnimal(s, k, at % W, ((at % PLANE) / W) | 0, { age: 2 * TICKS_PER_DAY, ...(D > 1 ? { z: (at / PLANE) | 0 } : {}) });
    if (a) { a.x += (j % 3) * 6 - 6; a.y += ((j / 3) | 0) * 6; out.push(a); }
  }
  return out;
}
/** Tick system (slot 'animals'): the first herds, then a group every ANIMALS.spawnEveryD days. */
export function wildSpawnSystem(s) {
  const h = herdRec(s);
  if (!h.seeded) { h.seeded = 1; wildGroup(s, 'goat'); wildGroup(s, 'deer'); wildGroup(s); return; }
  if (s.tick % TICKS_PER_DAY !== ANIMALS.spawnHour * TICKS_PER_HOUR) return;
  if (Math.floor(s.tick / TICKS_PER_DAY) % ANIMALS.spawnEveryD !== 0) return;
  if (herdAnimals(s).length >= ANIMALS.wildMax || atCap(s)) return;
  wildGroup(s);
}
