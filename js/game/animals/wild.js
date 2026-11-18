// Animal AI (doc 6.5, 9.3): wandering, grazing, fleeing, pens and following. Owner K.
// Every decision is a function of the state and the 'main' stream, at a per-animal cadence
// (tick % THINK_EVERY == id % THINK_EVERY), like colonists' needs. Movers use B's requestPath (kind
// 'a') and movement (paths walk on the colonists' side: animals pass doors and fence gates, so pens
// are kept by goals and the path check below, not by fences alone).
//   held     a tamer, hunter or handler is at work on it: it stands still until `until`
//   flee     hurt by someone it cannot fight: runs FLEE_TILES away until `until`
//   manhunt  manhunter.js drives it
//   graze    stands and eats until `until`, then picks a new goal
//   wander   walking to its goal
// Goals: a penned animal picks a tile of its pen (and walks back in when it finds itself outside);
// a tame animal without a pen stays within TAME_R of the Hearth; a wild one roams WANDER_R around
// itself. penGuard (slot 'path', right after A*) drops a fresh path that would take a penned animal
// out of its pen before movement takes a step on it.

import { W, H, idx, TER_WATER } from '../core/grid.js';
import { nextU32 } from '../core/rand.js';
import { bldById } from '../core/state.js';
import { compOf } from '../world/terrain.js';
import { requestPath, cancelPath, pathPending, GOAL } from '../systems/pathing.js';
import { animTile } from './spawn.js';
import { penOf, penTiles, penPathOk } from './pens.js';

export const THINK_EVERY = 20;
export const AI = Object.freeze({ wanderR: 10, tameR: 7, grazeMin: 150, grazeMax: 600, fleeTiles: 10 });

const roll = (s, n) => nextU32(s, 'main') % Math.max(1, n);
const open = (s, i) => s.rt.walkCost[i] > 0 && !TER_WATER[s.L.terrain[i]];
/** A random open tile within r of (x, y) in the same walk component as `from`, or -1 (a few tries). */
function nearTile(s, x, y, r, from) {
  const comp = compOf(s, from, 0);
  for (let k = 0; k < 6; k++) {
    const nx = x + roll(s, 2 * r + 1) - r, ny = y + roll(s, 2 * r + 1) - r;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    const i = idx(nx, ny);
    if (open(s, i) && compOf(s, i, 0) === comp) return i;
  }
  return -1;
}
const hearthTile = (s) => { const h = s.colony.hearth; const b = h && h.id !== null ? bldById(s, h.id) : null; return b ? idx(b.x + 1, b.y + 1) : -1; };

/** Where an animal wants to go next, or -1 (stay). */
function goalFor(s, a) {
  const at = animTile(a), ax = at % W, ay = (at / W) | 0;
  const pen = a.tame ? penOf(s, a) : null;
  if (pen) {
    const t = penTiles(s, pen.id);
    if (!t.length) return -1;
    for (let k = 0; k < 4; k++) { const i = t[roll(s, t.length)]; if (open(s, i)) return i; }
    return -1;
  }
  if (a.tame) {
    const h = hearthTile(s);
    if (h >= 0) return nearTile(s, h % W, (h / W) | 0, AI.tameR, at);
  }
  return nearTile(s, ax, ay, AI.wanderR, at);
}
/** Run from tile `from` (an attacker): a tile about FLEE_TILES away on the far side. */
export function fleeFrom(s, a, from) {
  const at = animTile(a), ax = at % W, ay = (at / W) | 0, fx = from % W, fy = (from / W) | 0;
  const dx = Math.sign(ax - fx) || 1, dy = Math.sign(ay - fy) || 1;
  const tx = Math.max(0, Math.min(W - 1, ax + dx * AI.fleeTiles)), ty = Math.max(0, Math.min(H - 1, ay + dy * AI.fleeTiles));
  const g = nearTile(s, tx, ty, 3, at);
  a.st = { ...a.st, mode: 'flee', until: s.tick + 300, target: null };
  if (g >= 0) requestPath(s, 'a', a.id, g, GOAL.TILE);
}

/** One animal's think. */
export function animalThink(s, a) {
  const st = a.st || (a.st = { mode: 'wander', until: 0, target: null });
  if (st.mode === 'manhunt') return;
  if (st.mode === 'held') {
    if (s.tick < st.until) { if (a.path) a.path = null; cancelPath(s, 'a', a.id); return; }
    st.mode = 'graze'; st.until = s.tick + AI.grazeMin;
  }
  if (a.path && a.path.i === -1) { a.path = null; st.mode = 'graze'; st.until = s.tick + 60; return; }
  if (a.path || pathPending(s, 'a', a.id)) return;
  if (st.mode === 'flee' && s.tick < st.until) return;
  const pen = a.tame ? penOf(s, a) : null;
  const outside = pen && s.L.zone[animTile(a)] !== pen.id;
  if (!outside && st.mode !== 'wander' && s.tick < st.until) return;
  if (st.mode === 'wander' && !outside) { st.mode = 'graze'; st.until = s.tick + AI.grazeMin + roll(s, AI.grazeMax - AI.grazeMin); return; }
  const g = goalFor(s, a);
  if (g < 0) { st.mode = 'graze'; st.until = s.tick + AI.grazeMin; return; }
  st.mode = 'wander';
  requestPath(s, 'a', a.id, g, GOAL.TILE);
}
/** Tick system (slot 'animals'): animals think at their cadence (a copy of the list: deaths remove). */
export function wildSystem(s) {
  const r = s.tick % THINK_EVERY;
  for (const a of s.anim.slice()) {
    if (a.id % THINK_EVERY !== r) continue;
    a.age += THINK_EVERY;
    animalThink(s, a);
  }
}
/** Slot 'path', after A*: a penned animal inside its pen never starts a path that leaves it. */
export function penGuard(s) {
  for (const a of s.anim) {
    if (!a.tame || a.pen === null || !a.path || a.path.i !== 0) continue;
    if (s.L.zone[animTile(a)] !== a.pen) continue;   // walking back in: any path
    if (!penPathOk(s, a, a.path)) { a.path = null; if (a.st) { a.st.mode = 'graze'; a.st.until = s.tick + 40; } }
  }
}
