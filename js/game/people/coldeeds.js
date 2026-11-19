// A colonist's deeds (EMBERCROWN-FORTRESS.md 3.1, F10): the counters perks are earned by. Owner F.
// js/game/colony/deeds.js stays the colony's deeds (K); this module counts what ONE colonist has done.
//
// col.done (C2, owner A) = DONE_LEN unsigned 16-bit counters by position (js/data/deeds-col.js COL_DEEDS).
// Everything here writes saved state only through didDeed, from deterministic sim-side hooks, so the
// counts are part of the state hash and survive a save and reload. Until the schema carries col.done the
// counting is a no-op (didDeed finds no array) and no perk is earned.
//
// Sources (installColDeeds, idempotent; code registries, never state):
//   - B's terrain onMined (mined, ore_mined, gems_mined, halls_carved) and B's support onCaveIn (caveins_near);
//   - BUS.kill (kills, elites_felled, post_kills, volley_kills, forged_kills) and BUS.removed (deconstructed:
//     the colonist whose deconstruct job targets the building);
//   - K's events tap (ledger.onTap: this tick's C8 events, read-only and same-tick): built (walls, props
//     and pillars, traps), crafted (smelting, smithing, garments, fine meals), harvested, tamed, downed;
//   - a choke scan every DEED_RULES.chokeEveryTicks while a raid is live (choke_raids);
//   - everything else: its owner calls didDeed(s, col, id, n) at the source (the S9.3 requests).

import { BUS } from '../core/bus.js';
import { W, H, tileOfW, cheb, TER_MINEABLE } from '../core/grid.js';
import { raidLive } from '../core/state.js';
import { KEY } from '../work/jobs.js';
import { onMined, passable } from '../world/terrain.js';
import { onCaveIn } from '../world/support.js';
import { depositName, structDef, hasFlag } from '../world/defs.js';
import { onTap } from '../colony/ledger.js';
import { towerOf } from '../defence/towers.js';
import { COL_DEEDS, DONE_LEN, DONE_MAX, DEED_RULES as R } from '../../data/deeds-col.js';
import { def, stage2 } from './defs.js';

export { COL_DEEDS, DONE_LEN, DONE_MAX };
const SLOT = Object.freeze(Object.fromEntries(COL_DEEDS.map((d) => [d.id, d.slot])));
const BY_ID = Object.freeze(Object.fromEntries(COL_DEEDS.map((d) => [d.id, d])));
export const deedDef = (id) => BY_ID[id] || null;
export const deedSlot = (id) => (id in SLOT ? SLOT[id] : -1);

/** A fresh col.done (the schema default A uses). */
export const newDone = () => new Uint16Array(DONE_LEN);
const hasDone = (col) => !!col && !!col.done && typeof col.done.length === 'number' && col.done.length >= DONE_LEN;

/** How many times the colonist has done deed `id` (0 without col.done). */
export function deedCount(col, id) {
  const k = SLOT[id];
  if (k === undefined) throw new Error(`coldeeds: unknown deed ${id}`);
  return hasDone(col) ? col.done[k] | 0 : 0;
}
/**
 * Count n of deed `id` for the colonist (the single entry point: 3.1 didDeed). Saturates at 65,535.
 * A dead colonist counts nothing more. Returns the new count.
 */
export function didDeed(s, col, id, n = 1) {
  const k = SLOT[id];
  if (k === undefined) throw new Error(`coldeeds: unknown deed ${id}`);
  if (!hasDone(col) || !(n > 0) || (col.hp && col.hp.dead)) return hasDone(col) ? col.done[k] : 0;
  const v = Math.min(DONE_MAX, (col.done[k] | 0) + (n | 0));
  col.done[k] = v;
  void s;
  return v;
}
/** Set an internal slot (downed_open, choke_mark). */
function setSlot(col, id, v) { if (hasDone(col)) col.done[SLOT[id]] = Math.max(0, Math.min(DONE_MAX, v | 0)); }

const colOf = (s, id) => { if (id === null || id === undefined) return null; for (const c of s.col) if (c.id === id) return c; return null; };
const isCol = (x) => !!x && Array.isArray(x.sk);
const standing = (c) => !!c && !c.hp.dead && !c.hp.down;

// ---- Mining (onMined) -----------------------------------------------------------------------------------
const GEMS = new Set(R.gemDeposits), NOT_ORE = new Set(R.notOre);
function onMinedTile(s, i, colId, ore) {
  if (!stage2()) return;
  const col = colOf(s, colId);
  if (!col) return;
  didDeed(s, col, 'mined');
  if (ore) {
    const name = depositName(ore);
    if (name && GEMS.has(name)) didDeed(s, col, 'gems_mined');
    else if (name && !NOT_ORE.has(name)) didDeed(s, col, 'ore_mined');
  }
  hallCheck(s, col, i);
}
/** The tile that finishes a carve plan of hallMinTiles+ tiles carves a hall (its miner is credited). */
function hallCheck(s, col, i) {
  const plans = s.colony.plans;
  if (!plans || !plans.length) return;
  const x = i % W, y = (i / W) | 0;
  for (const p of plans) {
    if (p.kind !== 'carve' || !p.rect) continue;
    const q = p.rect;
    if (x < q.x0 || x > q.x1 || y < q.y0 || y > q.y1) continue;
    const keep = new Set(p.natural || []);
    const tiles = (q.x1 - q.x0 + 1) * (q.y1 - q.y0 + 1) - keep.size;
    if (tiles < R.hallMinTiles) continue;
    let open = true;
    for (let yy = q.y0; yy <= q.y1 && open; yy++) for (let xx = q.x0; xx <= q.x1; xx++) {
      const j = yy * W + xx;
      if (!keep.has(j) && TER_MINEABLE[s.L.terrain[j]] === 1) { open = false; break; }
    }
    if (open) didDeed(s, col, 'halls_carved');
  }
}

// ---- Cave-ins (onCaveIn) ---------------------------------------------------------------------------------
function onCave(s, tiles) {
  if (!stage2() || !tiles || !tiles.length) return;
  for (const c of s.col) {
    if (!standing(c)) continue;
    const cx = tileOfW(c.x), cy = tileOfW(c.y);
    for (const t of tiles) if (cheb(cx, cy, t % W, (t / W) | 0) <= R.caveInR) { didDeed(s, c, 'caveins_near'); break; }
  }
}

// ---- Kills (BUS.kill) --------------------------------------------------------------------------------------
const ITEM_RANGED = (k) => { const d = k ? def('item', k) : null; return !!(d && d.weapon && (d.weapon.reach || 10) >= R.rangedReach); };
const weaponStack = (c) => { const w = c.gear && c.gear.slots ? c.gear.slots.weapon : null; return w && typeof w === 'object' ? w : null; };
const isArcher = (c) => { const w = c.gear && c.gear.slots ? c.gear.slots.weapon : null; return ITEM_RANGED(w && typeof w === 'object' ? w.k : w); };
function isElite(foe) {
  if (foe.nem !== null && foe.nem !== undefined) return true;
  const d = def('raider', foe.kind);
  return !!d && (d.pts | 0) >= R.elitePts;
}
const isHollow = (foe) => { const d = def('raider', foe.kind); return !!d && d.kind === 'hollow'; };
/** Count a felled foe (also H's downFoe through feltFoe, when it lands). */
export function feltFoe(s, foe, killer, { killed = true } = {}) {
  if (!stage2() || !foe || isCol(foe) || !isCol(killer) || killer.hp.dead) return;
  if (isElite(foe)) didDeed(s, killer, 'elites_felled');
  if (!killed) return;
  didDeed(s, killer, 'kills');
  if (towerOf(s, killer) || (killer.job && killer.job.type === 'order' && killer.job.order === 'hold')) didDeed(s, killer, 'post_kills');
  if (killer.squad !== null && killer.squad !== undefined && isArcher(killer)) {
    let n = 0;
    for (const c of s.col) if (c.squad === killer.squad && !c.hp.dead && isArcher(c)) n++;
    if (n >= R.volleyArchers) didDeed(s, killer, 'volley_kills');
  }
  const w = weaponStack(killer);
  if (w && w.maker !== null && w.maker !== undefined && isHollow(foe)) { const smith = colOf(s, w.maker); if (smith) didDeed(s, smith, 'forged_kills'); }
}
const onKill = (s, victim, killer) => { if (victim && !isCol(victim)) feltFoe(s, victim, killer); };

// ---- Deconstruction (BUS.removed) -----------------------------------------------------------------------------
function onRemoved(s, b, destroyed) {
  if (!stage2() || destroyed || !b || !b.dcon) return;
  const key = KEY.BLD + b.id;
  for (const c of s.col) if (c.job && c.job.type === 'deconstruct' && c.job.target === key && !c.hp.dead) { didDeed(s, c, 'deconstructed'); return; }
}

// ---- This tick's events (ledger.onTap) ------------------------------------------------------------------------
const catOf = (k) => { const d = k ? def('item', k) : null; return d ? d.cat : null; };
function onEvent(s, e) {
  if (!stage2()) return;
  const d = e.data || {};
  switch (e.name) {
    case 'built': {
      const col = colOf(s, d.colId), sd = col ? structDef(d.def) : null;
      if (!sd) return;
      if (hasFlag(sd, 'wall')) didDeed(s, col, 'walls_built');
      else if (hasFlag(sd, 'support')) didDeed(s, col, 'supports_built');
      if (hasFlag(sd, 'trap')) didDeed(s, col, 'traps_set');
      return;
    }
    case 'crafted': {
      const col = colOf(s, d.colId);
      if (!col) return;
      const cat = catOf(d.k);
      if (R.smeltCats.includes(cat)) didDeed(s, col, 'ore_smelted');
      else if (R.smithCats.includes(cat)) {
        if ((d.q | 0) >= R.forgedFineQ) didDeed(s, col, 'forged_fine');
        if ((d.q | 0) >= R.masterQ) didDeed(s, col, 'forged_master');
      } else if (R.garmentCats.includes(cat)) didDeed(s, col, 'garments');
      if (R.fineMeals.includes(d.k)) didDeed(s, col, 'fine_meals');
      return;
    }
    case 'harvested': { const col = colOf(s, d.colId); if (col) didDeed(s, col, 'harvested'); return; }
    case 'tamed': { const col = colOf(s, d.colId); if (col) didDeed(s, col, 'tamed'); return; }
    case 'downed': { const col = colOf(s, d.id); if (col && isCol(col)) setSlot(col, 'downed_open', 1); return; }
    default: return;
  }
}

// ---- Recovery and the choke scan (tick system) -------------------------------------------------------------
/** A 1-tile choke: open to exactly two opposite sides (a corridor one tile wide). */
function isChoke(s, i) {
  const x = i % W, y = (i / W) | 0;
  const o = (xx, yy) => xx >= 0 && yy >= 0 && xx < W && yy < H && passable(s, yy * W + xx, 0);
  const n = o(x, y - 1), e = o(x + 1, y), so = o(x, y + 1), w = o(x - 1, y);
  return (n && so && !e && !w) || (e && w && !n && !so);
}
function chokeScan(s) {
  if (!s.foes.length || !raidLive(s)) return;
  for (const c of s.col) {
    if (!standing(c) || !hasDone(c)) continue;
    const cx = tileOfW(c.x), cy = tileOfW(c.y);
    let raid = null;
    for (const f of s.foes) {
      if (f.raid === null || f.raid === undefined || (f.st && f.st.down)) continue;
      if (cheb(cx, cy, tileOfW(f.x), tileOfW(f.y)) <= 1) { raid = f.raid; break; }
    }
    if (raid === null) continue;
    const mark = (raid % DONE_MAX) + 1;
    if (c.done[SLOT.choke_mark] === mark || !isChoke(s, cy * W + cx)) continue;
    setSlot(c, 'choke_mark', mark);
    didDeed(s, c, 'choke_raids');
  }
}
/** Tick system (slot 'social'): the choke scan in raids, and a downed colonist standing again has recovered. */
export function colDeedsSystem(s) {
  if (!stage2()) return;
  if (s.tick % R.chokeEveryTicks === 0) chokeScan(s);
  if (s.tick % R.checkEveryTicks !== 0) return;
  for (const c of s.col) if (hasDone(c) && c.done[SLOT.downed_open] && standing(c)) { setSlot(c, 'downed_open', 0); didDeed(s, c, 'recovered'); }
}

let offMined = null, offCave = null, tapped = false;
/** Install the hooks (idempotent; BUS hooks go with resetBus, the registries stay installed). */
export function installColDeeds() {
  if (!offMined) offMined = onMined(onMinedTile);
  if (!offCave) offCave = onCaveIn(onCave);
  if (!tapped) { onTap(onEvent); tapped = true; }
  if (!BUS.kill.includes(onKill)) BUS.kill.push(onKill);
  if (!BUS.removed.includes(onRemoved)) BUS.removed.push(onRemoved);
}
