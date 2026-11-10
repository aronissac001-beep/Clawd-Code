// Uniform-grid spatial hash rebuilt every tick. Linked lists in typed arrays
// mean zero allocations per tick regardless of entity count.
import { WORLD } from './grid.js';

export class SpatialHash {
  constructor(cell = 64, cap = 2048) {
    this.cell = cell;
    this.cols = Math.ceil(WORLD / cell);
    this.head = new Int32Array(this.cols * this.cols);
    this.next = new Int32Array(cap);
    this.items = [];
    this.clear(); // safe to query before the first tick (e.g. right after loading)
  }
  clear() { this.head.fill(-1); this.items.length = 0; }
  insert(e) {
    const i = this.items.length;
    if (i >= this.next.length) { const n = new Int32Array(this.next.length * 2); n.set(this.next); this.next = n; }
    this.items.push(e);
    const c = this.cellOf(e.x, e.y);
    this.next[i] = this.head[c]; this.head[c] = i;
  }
  cellOf(x, y) {
    let cx = (x / this.cell) | 0, cy = (y / this.cell) | 0;
    if (cx < 0) cx = 0; else if (cx >= this.cols) cx = this.cols - 1;
    if (cy < 0) cy = 0; else if (cy >= this.cols) cy = this.cols - 1;
    return cy * this.cols + cx;
  }
  // Nearest live entity within r passing `filter` (optional).
  nearest(x, y, r, filter) {
    const c = this.cell, cols = this.cols;
    const x0 = Math.max(0, ((x - r) / c) | 0), x1 = Math.min(cols - 1, ((x + r) / c) | 0);
    const y0 = Math.max(0, ((y - r) / c) | 0), y1 = Math.min(cols - 1, ((y + r) / c) | 0);
    let best = null, bd = r * r;
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      for (let i = this.head[cy * cols + cx]; i !== -1; i = this.next[i]) {
        const e = this.items[i];
        if (!e.alive) continue;
        const dx = e.x - x, dy = e.y - y, d = dx * dx + dy * dy;
        if (d < bd && (!filter || filter(e))) { bd = d; best = e; }
      }
    }
    return best;
  }
  // Calls fn(e) for every live entity within r. Return true from fn to stop.
  each(x, y, r, fn) {
    const c = this.cell, cols = this.cols, r2 = r * r;
    const x0 = Math.max(0, ((x - r) / c) | 0), x1 = Math.min(cols - 1, ((x + r) / c) | 0);
    const y0 = Math.max(0, ((y - r) / c) | 0), y1 = Math.min(cols - 1, ((y + r) / c) | 0);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      for (let i = this.head[cy * cols + cx]; i !== -1; i = this.next[i]) {
        const e = this.items[i];
        if (!e.alive) continue;
        const dx = e.x - x, dy = e.y - y;
        if (dx * dx + dy * dy <= r2 && fn(e)) return;
      }
    }
  }
}
