// Claimed land (owner B; doc 3.1). You can construct only on claimed tiles; designations (mine, chop,
// haul) work anywhere explored.
//   Sources: every finished building whose def has `claim: true` claims a disc of radius `claimR`
//   around its centre (the Hearth 14; Waystones 9 from Stage 2). Stage 1a has the Hearth only.
//   The hold grows as you dig: open tiles under a rock roof (mined floor, caverns) that a tunnel
//   connects (4-way, through such tiles) to a claimed tile are claimed too.
//
//   isClaimed(s, i)   the read API (A's place validator, I's previews, C's border overlay).
//   claimMap(s)       the whole Uint8Array (1 = claimed), for overlays.
//   claimBorder(s)    claimed tiles with an unclaimed 4-neighbour (the drawn border), sorted.
//
// Determinism: the map is a pure function of saved state (terrain, roof, buildings). It is cached per
// runtime object (a WeakMap on s.rt, so a load or initRuntime starts fresh) and marked stale by the
// terrain write hook (terrain and roof changes) and by setOcc via markClaimsDirty; it is rebuilt on
// the next read. So every read equals a from-scratch rebuild (C13 "derived exact"), with no rt key.
//
// Levels (Stage Z1 E4; EMBERCROWN-FORTRESS.md 2.9). At D > 1 claims cover COLUMNS: a disc claims its x, y
// on every level. An underground voxel (cover >= 1, not rock) outside every disc is claimed when a tunnel
// (planar 4-neighbours) or a stair or ramp link (vertical.linksOf) connects it to a claimed open voxel. The
// map is a u8 of N; claimColumns(s) gives the per-column disc map (u8 of PLANE) for overlays.

import { W, H, N, D, PLANE, TER, ROOF } from '../core/grid.js';
import { upOK, downOK, coverRebuild } from './vertical.js';
import { structDef, allOf } from './defs.js';
import { WORLD } from '../../data/worldgen.js';

const cache = new WeakMap(); // s.rt -> { map: Uint8Array, stale: boolean }

/** Claim sources: [cx, cy, r] for every finished claiming building, in id order. */
export function claimSources(s) {
  const out = [];
  for (const b of s.bld) {
    if (!b || b.st !== 'done') continue;
    const d = structDef(b.def);
    if (!d || !d.claim) continue;
    const sz = d.size || [1, 1], w = (b.rot | 0) & 1 ? sz[1] : sz[0], h = (b.rot | 0) & 1 ? sz[0] : sz[1];
    out.push([b.x + (w >> 1), b.y + (h >> 1), d.claimR | 0]);
  }
  return out;
}

const underground = (s, i) => {
  const t = s.L.terrain[i], r = s.L.roof[i];
  return (r === ROOF.THIN || r === ROOF.MOUNTAIN) && t !== TER.ROCK && t !== TER.RUBBLE;
};

/** The per-column disc map (u8 of PLANE, 1 = inside a claim disc). */
export function claimColumns(s) {
  const a = new Uint8Array(PLANE);
  for (const [cx, cy, r] of claimSources(s)) {
    const r2 = r * r;
    for (let y = Math.max(0, cy - r); y <= Math.min(H - 1, cy + r); y++) for (let x = Math.max(0, cx - r); x <= Math.min(W - 1, cx + r); x++) {
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r2) a[y * W + x] = 1;
    }
  }
  return a;
}
function claimRebuild3(s) {
  const a = new Uint8Array(N), col = claimColumns(s), ter = s.L.terrain, cover = s.rt && s.rt.cover && s.rt.cover.length === N ? s.rt.cover : coverRebuild(s);
  const open = (j) => ter[j] !== TER.ROCK && ter[j] !== TER.RUBBLE && ter[j] !== TER.VOID;
  const q = [];
  for (let z = 0; z < D; z++) for (let c = 0; c < PLANE; c++) if (col[c]) { const i = z * PLANE + c; a[i] = 1; if (open(i)) q.push(i); }
  for (let h = 0; h < q.length; h++) {
    const c = q[h], p = c % PLANE, x = p % W, y = (p / W) | 0;
    const nb = [y > 0 ? c - W : -1, x < W - 1 ? c + 1 : -1, y < H - 1 ? c + W : -1, x > 0 ? c - 1 : -1,
      upOK(ter, c) ? c + PLANE : -1, downOK(ter, c) ? c - PLANE : -1];
    for (const j of nb) {
      if (j < 0 || a[j] || !open(j) || cover[j] < 1) continue;
      a[j] = 1; q.push(j);
    }
  }
  return a;
}

/** The claim map from scratch. */
export function claimRebuild(s) {
  if (D > 1) return claimRebuild3(s);
  const a = new Uint8Array(N);
  const q = [];
  for (const [cx, cy, r] of claimSources(s)) {
    const r2 = r * r;
    for (let y = Math.max(0, cy - r); y <= Math.min(H - 1, cy + r); y++) {
      for (let x = Math.max(0, cx - r); x <= Math.min(W - 1, cx + r); x++) {
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > r2) continue;
        const i = y * W + x;
        if (!a[i]) { a[i] = 1; q.push(i); }
      }
    }
  }
  // tunnels: flood from claimed tiles into connected open tiles under a rock roof
  q.sort((x, y) => x - y);
  for (let h = 0; h < q.length; h++) {
    const c = q[h], x = c % W, y = (c / W) | 0;
    const nb = [y > 0 ? c - W : -1, x < W - 1 ? c + 1 : -1, y < H - 1 ? c + W : -1, x > 0 ? c - 1 : -1];
    for (const j of nb) {
      if (j < 0 || a[j] || !underground(s, j)) continue;
      // only flood out of a claimed tile that is itself walkable ground (not rock inside the disc)
      const t = s.L.terrain[c];
      if (t === TER.ROCK || t === TER.RUBBLE) continue;
      a[j] = 1; q.push(j);
    }
  }
  return a;
}

/** The current claim map (cached, exact). */
export function claimMap(s) {
  let e = cache.get(s.rt);
  if (!e) { e = { map: null, stale: true }; cache.set(s.rt, e); }
  if (e.stale || !e.map || e.map.length !== N) { e.map = claimRebuild(s); e.stale = false; }
  return e.map;
}
export const isClaimed = (s, i) => claimMap(s)[i] === 1;
/** Mark the claim map stale (terrain, roof or a claiming building changed). */
export function markClaimsDirty(s) { const e = cache.get(s.rt); if (e) e.stale = true; }

/** Claimed tiles with an unclaimed (or off-map) 4-neighbour, sorted by index. */
export function claimBorder(s) {
  const a = claimMap(s), out = [];
  for (let i = 0; i < N; i++) {
    if (!a[i]) continue;
    const x = i % W, y = ((i % PLANE) / W) | 0;
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1 || !a[i - 1] || !a[i + 1] || !a[i - W] || !a[i + W]) out.push(i);
  }
  return out;
}

// ---- Waystones (Stage 2; doc 3.1) -------------------------------------------------------------------------
// A Waystone claims radius 9; it must stand on claimed land or touch its border, and a colony may raise
// WORLD.waystones[tier] of them (Camp 1, Hamlet 3, Village 6, Hold 10, Stronghold 16). waystoneVeto is
// the BUS.canPlace handler (A's checkPlace): null when fine, else { ok: false, reason }.
export const WAYSTONE = 'waystone';
/** How many Waystones the colony's prosperity tier allows. */
export function waystoneCap(s) {
  const tiers = allOf('tier');
  const t = tiers[s.colony.tier | 0];
  const cap = t ? WORLD.waystones[t.id] : undefined;
  return cap === undefined ? 1 : cap;
}
export const waystoneCount = (s) => s.bld.filter((b) => b && b.def === WAYSTONE).length;
/** Can a Waystone stand at tile (x, y)? null or a reason. */
export function waystoneWhy(s, x, y) {
  if (waystoneCount(s) >= waystoneCap(s)) return `the hold can keep ${waystoneCap(s)} Waystone${waystoneCap(s) === 1 ? '' : 's'} at this prosperity`;
  const a = claimMap(s);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const xx = x + dx, yy = y + dy;
    if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
    for (let z = 0; z < D; z++) if (a[z * PLANE + yy * W + xx]) return null;   // D > 1: claimed on any level of the column (the veto has no z)
  }
  return 'a Waystone must stand on claimed land or touch its border';
}
export function waystoneVeto(s, d, x, y) {
  if (!d || d.id !== WAYSTONE) return null;
  const why = waystoneWhy(s, x, y);
  return why ? { ok: false, reason: why } : null;
}
