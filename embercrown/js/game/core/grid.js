// Contract C1 v3 (owner A, reviewer B; EMBERCROWN-FORTRESS.md 7.1, frozen at the end of Stage Z1 step E1,
// additions only after). Map size, tile layer ids and enums, terrain tables and voxel index helpers.
//
// The world is W x H x D voxels; one level is one contiguous slice of PLANE = W * H voxels:
//   i = (z * H + y) * W + x,  z = 0 the bottom of the world, z grows upward, zS the surface level.
// Every voxel index is a u32 / Int32 (paths, queues, keys, regions, the saved runtime, commands).
// Until the fortress switch (flags.js FORTRESS, step E13) every colony is D = 1, zS = 0, so i = y * W + x
// exactly as before and every D = 1 hash is unchanged.
//
// W, H, D, PLANE, N, CW, CH, CLUSTERS and zS are LIVE bindings: `import { W, N } from './grid.js'` always
// sees the current map size. Nothing here (or anywhere) allocates map-sized buffers at import time (D1);
// they live in `s.L` and `s.rt` and are made by createColony / initRuntime after setMapSize().
//
// Rule (7.1): 2D code that runs on one level takes a `base = z * PLANE` offset. Planar neighbours stay
// i +- 1 and i +- W plus a bounds check on x and y; vertical neighbours are up(i) / down(i) plus a check on z.

export const TILE = 32;                 // world units per tile (zoom 1 = 1 pt per unit)
export const CLUSTER = 16;              // region / index cluster size in tiles (12.3): 16 x 16 x 1
export const DEFAULT_MAP = 128;         // D1
export const MAP_SIZES = [96, 128, 160]; // Small Vale (Stage 3), default, a later option
export const MAP_MIN = 16, MAP_MAX = 256; // u8 coordinates in tests stay safe
export const D_MAX = 32;                // levels (F1: 20 at founding; D and zS are save-header fields)
/** Every voxel index is below this (the work-target key span, jobs.js KEY.SPAN = 1e6): holds to D = 61 at 128. */
export const INDEX_SPAN = 1e6;

export let W = DEFAULT_MAP;
export let H = DEFAULT_MAP;
export let D = 1;
export let zS = 0;                      // the surface (valley floor) level; 0 on a D = 1 map
export let PLANE = DEFAULT_MAP * DEFAULT_MAP;
export let N = PLANE;
export let CW = DEFAULT_MAP / CLUSTER;  // clusters across
export let CH = DEFAULT_MAP / CLUSTER;  // clusters down
export let CLUSTERS = CW * CH;          // clusters in the world (CW * CH * D)

/**
 * Set the live map size. Called by createColony / loadColony from the save header before initRuntime.
 * setMapSize(w) and setMapSize(w, h) are the D = 1 forms of Stage 2 (d = 1, zs = 0).
 */
export function setMapSize(w, h = w, d = 1, zs = 0) {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < MAP_MIN || h < MAP_MIN || w > MAP_MAX || h > MAP_MAX) {
    throw new RangeError(`setMapSize: bad size ${w} x ${h}`);
  }
  if (!Number.isInteger(d) || d < 1 || d > D_MAX) throw new RangeError(`setMapSize: bad depth ${d}`);
  if (!Number.isInteger(zs) || zs < 0 || zs >= d) throw new RangeError(`setMapSize: bad surface level ${zs} of ${d}`);
  if (w * h * d >= INDEX_SPAN) throw new RangeError(`setMapSize: ${w} x ${h} x ${d} is over ${INDEX_SPAN} voxels`);
  W = w; H = h; D = d; zS = zs; PLANE = w * h; N = PLANE * d;
  CW = Math.ceil(w / CLUSTER); CH = Math.ceil(h / CLUSTER); CLUSTERS = CW * CH * d;
  return N;
}

// ---- Index helpers -----------------------------------------------------------------------
export const idx = (x, y, z = 0) => (z * H + y) * W + x;
export const tx = (i) => i % W;
export const ty = (i) => ((i % PLANE) / W) | 0;
export const tz = (i) => (i / PLANE) | 0;
/** The voxel directly above / below (no bounds check: test tz first or use inB). */
export const up = (i) => i + PLANE;
export const down = (i) => i - PLANE;
export const inB = (x, y, z = 0) => x >= 0 && y >= 0 && z >= 0 && x < W && y < H && z < D;
export const inBi = (i) => i >= 0 && i < N;
/** Level number relative to the surface (0 = the surface, -3 = three below). UI only. */
export const relLevel = (z) => z - zS;
export const tileOfW = (w) => Math.floor(w / TILE);       // world unit -> tile coordinate
export const ctrW = (t) => t * TILE + TILE / 2;           // tile coordinate -> world centre
export const tileAtW = (wx, wy, z = 0) => idx(tileOfW(wx), tileOfW(wy), z);
/** Cluster of voxel i (16 x 16 x 1): (z * CH + cy) * CW + cx. */
export const clusterOf = (i) => (tz(i) * CH + ((ty(i) / CLUSTER) | 0)) * CW + ((tx(i) / CLUSTER) | 0);
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
export const manh = (ax, ay, bx, by) => Math.abs(ax - bx) + Math.abs(ay - by);

/** 4- and 8-neighbour offsets in a fixed order (N, E, S, W, then diagonals NE, SE, SW, NW). */
export const DX4 = [0, 1, 0, -1], DY4 = [-1, 0, 1, 0];
export const DX8 = [0, 1, 0, -1, 1, 1, -1, -1], DY8 = [-1, 0, 1, 0, -1, 1, 1, -1];

/** Normalised inclusive rectangle {x0, y0, x1, y1} clipped to the map, or null when fully outside. A z is kept. */
export function clipRect(r) {
  const x0 = Math.max(0, Math.min(r.x0, r.x1)), x1 = Math.min(W - 1, Math.max(r.x0, r.x1));
  const y0 = Math.max(0, Math.min(r.y0, r.y1)), y1 = Math.min(H - 1, Math.max(r.y0, r.y1));
  if (x0 > x1 || y0 > y1) return null;
  return r.z === undefined ? { x0, y0, x1, y1 } : { x0, y0, x1, y1, z: r.z };
}
export const rectArea = (r) => (Math.abs(r.x1 - r.x0) + 1) * (Math.abs(r.y1 - r.y0) + 1);

// ---- Bitset layers (fog, known) -------------------------------------------------------------
export const bitBytes = (n = N) => (n + 7) >> 3;
export const getBit = (a, i) => (a[i >> 3] >> (i & 7)) & 1;
export function setBit(a, i, v) { if (v) a[i >> 3] |= 1 << (i & 7); else a[i >> 3] &= ~(1 << (i & 7)); }

// ---- Terrain (layer `terrain`, Uint8) -------------------------------------------------------
// Ids 0-15 are the Stage 2 terrain, unchanged; 16-21 are the vertical voxels of 2.3 (C1 v3). Nothing
// writes 16-21 on a D = 1 map (E2's terrain API is the first writer).
export const TER = Object.freeze({
  VOID: 0, GRASS: 1, MEADOW: 2, DIRT: 3, SAND: 4, RICH: 5, MARSH: 6, SHALLOW: 7, DEEP: 8,
  ROCK: 9, ROUGH: 10, RUBBLE: 11, MOSS: 12, TILLED: 13, ICE: 14, LAVA: 15,
  AIR: 16, STAIR_U: 17, STAIR_D: 18, STAIR_UD: 19, RAMP: 20, RAMP_TOP: 21,
});
export const TER_COUNT = 22;
export const TER_IDS = ['void', 'grass', 'meadow', 'dirt', 'sand', 'rich', 'marsh', 'shallow', 'deep',
  'rock', 'rough', 'rubble', 'moss', 'tilled', 'ice', 'lava', 'air', 'stair_u', 'stair_d', 'stair_ud', 'ramp', 'ramp_top'];
export const TER_NAMES = ['Void', 'Grass', 'Meadow', 'Dirt', 'Sand', 'Rich soil', 'Marsh', 'Shallow water',
  'Deep water', 'Rock', 'Rough floor', 'Rubble', 'Cave moss', 'Tilled soil', 'Ice', 'Lava',
  'Open air', 'Up stair', 'Down stair', 'Up and down stair', 'Ramp', 'Ramp top'];
//                                     v  g  m  d  s  r  ma sh de ro rf ru mo ti ic la | ai su sd ud rp rt
const t22 = (a) => Uint8Array.from(a); // typed arrays cannot be frozen; treat as read-only
/** walkable by colonists without a structure (marsh and shallow water are slow, not blocked; never AIR) */
export const TER_PASSABLE = t22([0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 0, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1]);
/** a Mine designation applies (rock, and rubble which yields nothing) */
export const TER_MINEABLE = t22([0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
/** structures and floors can be placed (not on stairs, ramps or air: a built floor over air is its own job) */
export const TER_BUILDABLE = t22([0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
/** a built roof can be added (open ground and mined floor; stairs and ramps take one too) */
export const TER_ROOFABLE = t22([0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 1, 1, 0]);
/** blocks sight and light like a wall */
export const TER_OPAQUE = t22([0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
/** water tiles (ice counts: frozen shallow water) */
export const TER_WATER = t22([0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]);
/** can be sown or grow wild plants */
export const TER_FERTILE = t22([0, 1, 1, 1, 0, 1, 1, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
/** walk cost multiplier x10 for a bare tile (10 = normal); 0 = impassable. Structures add their own. */
export const TER_WALK10 = t22([0, 10, 10, 10, 11, 10, 18, 22, 0, 0, 10, 0, 10, 12, 14, 0, 0, 10, 10, 10, 10, 10]);
/** a mover can go UP from this voxel (to a TER_DOWN voxel directly above): up stair, up-down stair, ramp */
export const TER_UP = t22([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0]);
/** a mover can go DOWN from this voxel (to a TER_UP voxel directly below): down stair, up-down stair, ramp top */
export const TER_DOWN = t22([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1]);
/** the voxel has a surface to stand on at its own level (not solid rock, lava, void or open air) */
export const TER_FLOOR = t22([0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1]);

// ---- Roof (layer `roof`) ----------------------------------------------------------------------
// C1 v3 retires THIN and MOUNTAIN (2.4: real rock above replaces them). They stay readable until the
// v3 -> v4 world migration (E9) and the 3D generator (E10) stop writing them; D = 1 worlds still use them.
export const ROOF = Object.freeze({ OPEN: 0, BUILT: 1, THIN: 2, MOUNTAIN: 3 });

// ---- Designations (layer `desig`, bit flags) --------------------------------------------------
export const DESIG = Object.freeze({
  MINE: 1, CHOP: 2, HARVEST: 4, SMOOTH: 8, ENGRAVE: 16, PROSPECT: 32, RISKY: 64, FORBID: 128,
});
/** designation kind name (as used by the `designate` command) -> bit */
export const DESIG_KINDS = Object.freeze({
  mine: 1, chop: 2, harvest: 4, smooth: 8, engrave: 16, prospect: 32, risky: 64, forbid: 128,
});

// ---- Layers (s.L) and their save order (11.3) --------------------------------------------------
/**
 * Fixed order of the saved voxel layers; the id is the u8 written in the EC2 blob. Each layer is N bytes
 * (all levels, level by level). C1 v3 adds `fluid` (id 13, u8) with save format 3 (EC3, step E8): EC2 and
 * the D = 1 hash keep exactly these twelve.
 */
export const LAYERS = Object.freeze([
  { id: 1, name: 'terrain', enc: 0 }, { id: 2, name: 'mat', enc: 0 }, { id: 3, name: 'ore', enc: 0 },
  { id: 4, name: 'floor', enc: 0 }, { id: 5, name: 'roof', enc: 0 }, { id: 6, name: 'plant', enc: 0 },
  { id: 7, name: 'growth', enc: 0 }, { id: 8, name: 'blight', enc: 0 }, { id: 9, name: 'zone', enc: 0 },
  { id: 10, name: 'desig', enc: 0 }, { id: 11, name: 'fog', enc: 1 }, { id: 12, name: 'known', enc: 1 },
]);
export const LAYER_NAMES = LAYERS.map((l) => l.name);
/** byte length of a layer at the current map size (enc 1 = bitset) */
export const layerBytes = (l) => (l.enc === 1 ? bitBytes(N) : N);
/** Allocate every layer for the current map size (zeroed). */
export function allocLayers() {
  const L = {};
  for (const l of LAYERS) L[l.name] = new Uint8Array(layerBytes(l));
  return L;
}

/** Zone ids in the `zone` layer: 0 none, 1..254 (255 reserved). */
export const ZONE_MAX = 254;
