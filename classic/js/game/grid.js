// Square-grid helpers shared by the simulation and renderer.
import { BAL } from '../data/balance.js';

export const T = BAL.tile;
export const N = BAL.mapSize;
export const WORLD = T * N;

export const TER = { GRASS: 0, MEADOW: 1, DIRT: 2, SAND: 3, WATER: 4, CRAG: 5 };
export const TER_PASSABLE = [1, 1, 1, 1, 0, 0];
export const TER_BUILDABLE = [1, 1, 1, 1, 0, 0];
export const TER_NAMES = ['Grassland', 'Meadow', 'Packed earth', 'Sandy bank', 'River', 'Crag'];

export const idx = (x, y) => y * N + x;
export const inB = (x, y) => x >= 0 && y >= 0 && x < N && y < N;
export const tileOf = (w) => Math.floor(w / T);
export const ctr = (t) => t * T + T / 2;
export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Distance from a point to a building's footprint rectangle (world units).
export function distToRect(x, y, b) {
  const x0 = b.tx * T, y0 = b.ty * T, x1 = x0 + b.size * T, y1 = y0 + b.size * T;
  const dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
  const dy = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
  return Math.hypot(dx, dy);
}
export function bCenter(b) { return { x: (b.tx + b.size / 2) * T, y: (b.ty + b.size / 2) * T }; }
