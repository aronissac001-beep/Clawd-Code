// ============================================================================
// ZONEFALL 3 — static collision world: axis-aligned boxes + circles in a
// spatial hash. Movement (circle sliding), ray casts (bullets, line of sight).
// Everything lives on the XZ plane; `h` is only used for "can shoot over".
// ============================================================================
let NEXT_ID = 1;

export class Physics {
  constructor(size, cell = 4) {
    this.size = size; this.cs = cell; this.n = Math.ceil(size / cell);
    this.grid = new Array(this.n * this.n);
    this.stamp = 0;
    this.walkable = null; // (x,z) => bool, set by the world (deep water / map edge)
  }
  _cells(c, fn) {
    const cs = this.cs, n = this.n;
    const i0 = Math.max(0, Math.floor(c.minx / cs)), i1 = Math.min(n - 1, Math.floor(c.maxx / cs));
    const j0 = Math.max(0, Math.floor(c.minz / cs)), j1 = Math.min(n - 1, Math.floor(c.maxz / cs));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(j * n + i);
  }
  _insert(c) { this._cells(c, k => { (this.grid[k] || (this.grid[k] = [])).push(c); }); }
  _bounds(c) {
    if (c.t === 'b') { c.minx = c.x0; c.maxx = c.x1; c.minz = c.z0; c.maxz = c.z1; }
    else { c.minx = c.x - c.r; c.maxx = c.x + c.r; c.minz = c.z - c.r; c.maxz = c.z + c.r; }
  }
  /** opts: { h=3, solid=true, opaque=true, ref=null, kind } */
  addBox(x0, z0, x1, z1, o = {}) {
    const c = { id: NEXT_ID++, t: 'b', x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), h: o.h ?? 3, solid: o.solid !== false, opaque: o.opaque !== false, ref: o.ref || null, kind: o.kind || '', off: false, ray: 0, y0: o.y0 };
    this._bounds(c); this._insert(c); return c;
  }
  addCircle(x, z, r, o = {}) {
    const c = { id: NEXT_ID++, t: 'c', x, z, r, h: o.h ?? 3, solid: o.solid !== false, opaque: o.opaque !== false, ref: o.ref || null, kind: o.kind || '', off: false, ray: 0, y0: o.y0 };
    this._bounds(c); this._insert(c); return c;
  }
  remove(c) {
    if (!c || c.dead) return; c.dead = true;
    this._cells(c, k => { const a = this.grid[k]; if (!a) return; const i = a.indexOf(c); if (i >= 0) { a[i] = a[a.length - 1]; a.pop(); } });
  }
  /** iterate unique colliders overlapping an AABB */
  query(x0, z0, x1, z1, fn) {
    const cs = this.cs, n = this.n; const s = ++this.stamp;
    const i0 = Math.max(0, Math.floor(x0 / cs)), i1 = Math.min(n - 1, Math.floor(x1 / cs));
    const j0 = Math.max(0, Math.floor(z0 / cs)), j1 = Math.min(n - 1, Math.floor(z1 / cs));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const a = this.grid[j * n + i]; if (!a) continue;
      for (let k = 0; k < a.length; k++) {
        const c = a[k]; if (c.ray === s) continue; c.ray = s;
        if (c.maxx < x0 || c.minx > x1 || c.maxz < z0 || c.minz > z1) continue;
        if (fn(c) === false) return;
      }
    }
  }
  /** true if a circle at (x,z,r) overlaps any collider passing filter */
  overlaps(x, z, r, filter = SOLID) {
    let hit = null;
    this.query(x - r, z - r, x + r, z + r, c => {
      if (!filter(c)) return;
      if (c.t === 'b') { const px = Math.max(c.x0, Math.min(x, c.x1)), pz = Math.max(c.z0, Math.min(z, c.z1)); if ((px - x) ** 2 + (pz - z) ** 2 < r * r) { hit = c; return false; } }
      else if ((c.x - x) ** 2 + (c.z - z) ** 2 < (c.r + r) ** 2) { hit = c; return false; }
    });
    return hit;
  }
  /** push a circle out of colliders. Returns last collider touched (or null). */
  resolve(p, r, filter = SOLID) {
    let touched = null;
    for (let it = 0; it < 3; it++) {
      let moved = false;
      this.query(p.x - r, p.z - r, p.x + r, p.z + r, c => {
        if (!filter(c)) return;
        if (c.t === 'b') {
          const px = Math.max(c.x0, Math.min(p.x, c.x1)), pz = Math.max(c.z0, Math.min(p.z, c.z1));
          let dx = p.x - px, dz = p.z - pz; const d2 = dx * dx + dz * dz;
          if (d2 >= r * r) return;
          if (d2 > 1e-8) { const d = Math.sqrt(d2), k = (r - d) / d; p.x += dx * k; p.z += dz * k; }
          else { // centre inside the box: push out along the shallowest axis
            const l = p.x - c.x0, rr = c.x1 - p.x, t = p.z - c.z0, b = c.z1 - p.z; const m = Math.min(l, rr, t, b);
            if (m === l) p.x = c.x0 - r; else if (m === rr) p.x = c.x1 + r; else if (m === t) p.z = c.z0 - r; else p.z = c.z1 + r;
          }
          touched = c; moved = true;
        } else {
          let dx = p.x - c.x, dz = p.z - c.z; const d2 = dx * dx + dz * dz, R = c.r + r;
          if (d2 >= R * R) return;
          const d = Math.sqrt(d2) || 1e-4; if (d2 < 1e-8) { dx = 1; dz = 0; }
          const k = (R - d) / d; p.x += dx * k; p.z += dz * k; touched = c; moved = true;
        }
      });
      if (!moved) break;
    }
    return touched;
  }
  /** move a circle-bodied entity by (dx, dz) with sliding; returns collider bumped */
  move(p, dx, dz, r, filter = SOLID) {
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (r * 0.8)));
    let bumped = null; const sx = dx / steps, sz = dz / steps;
    for (let i = 0; i < steps; i++) {
      const ox = p.x, oz = p.z;
      p.x += sx; p.z += sz;
      const t = this.resolve(p, r, filter); if (t) bumped = t;
      if (this.walkable && !this.walkable(p.x, p.z)) {
        // try sliding along each axis before giving up
        if (this.walkable(p.x, oz)) p.z = oz; else if (this.walkable(ox, p.z)) p.x = ox; else { p.x = ox; p.z = oz; }
      }
    }
    return bumped;
  }
  /**
   * Ray cast from (x0,z0) to (x1,z1). filter(c) decides what blocks.
   * Returns { t (0..1), x, z, c, nx, nz } or null.
   */
  raycast(x0, z0, x1, z1, filter = OPAQUE) {
    const dx = x1 - x0, dz = z1 - z0; const len = Math.hypot(dx, dz); if (len < 1e-6) return null;
    const cs = this.cs, n = this.n; const s = ++this.stamp;
    let best = null, bt = 1;
    // DDA over grid cells
    let i = Math.floor(x0 / cs), j = Math.floor(z0 / cs);
    const iEnd = Math.floor(x1 / cs), jEnd = Math.floor(z1 / cs);
    const stepI = dx > 0 ? 1 : -1, stepJ = dz > 0 ? 1 : -1;
    const tDx = dx !== 0 ? Math.abs(cs / dx) : Infinity, tDz = dz !== 0 ? Math.abs(cs / dz) : Infinity;
    let tMx = dx !== 0 ? (((dx > 0 ? (i + 1) * cs : i * cs) - x0) / dx) : Infinity;
    let tMz = dz !== 0 ? (((dz > 0 ? (j + 1) * cs : j * cs) - z0) / dz) : Infinity;
    for (let guard = 0; guard < 400; guard++) {
      if (i >= 0 && j >= 0 && i < n && j < n) {
        const a = this.grid[j * n + i];
        if (a) for (let k = 0; k < a.length; k++) {
          const c = a[k]; if (c.ray === s) continue; c.ray = s; if (!filter(c)) continue;
          const h = c.t === 'b' ? rayBox(x0, z0, dx, dz, c) : rayCircle(x0, z0, dx, dz, c);
          if (h && h.t < bt) { bt = h.t; best = h; best.c = c; }
        }
      }
      const tNext = Math.min(tMx, tMz);
      if (best && bt <= tNext) break;
      if (i === iEnd && j === jEnd) break;
      if (tNext > 1) break;
      if (tMx < tMz) { tMx += tDx; i += stepI; } else { tMz += tDz; j += stepJ; }
    }
    if (best) { best.x = x0 + dx * best.t; best.z = z0 + dz * best.t; }
    return best;
  }
  los(x0, z0, x1, z1, filter = OPAQUE) { return !this.raycast(x0, z0, x1, z1, filter); }
}

export const SOLID = c => c.solid && !c.off;
export const OPAQUE = c => c.opaque && !c.off;

function rayBox(x0, z0, dx, dz, c) {
  let tmin = 0, tmax = 1, nx = 0, nz = 0;
  if (Math.abs(dx) < 1e-9) { if (x0 < c.x0 || x0 > c.x1) return null; }
  else {
    let t1 = (c.x0 - x0) / dx, t2 = (c.x1 - x0) / dx, n1 = -1; if (t1 > t2) { [t1, t2] = [t2, t1]; n1 = 1; }
    if (t1 > tmin) { tmin = t1; nx = n1; nz = 0; } tmax = Math.min(tmax, t2); if (tmin > tmax) return null;
  }
  if (Math.abs(dz) < 1e-9) { if (z0 < c.z0 || z0 > c.z1) return null; }
  else {
    let t1 = (c.z0 - z0) / dz, t2 = (c.z1 - z0) / dz, n1 = -1; if (t1 > t2) { [t1, t2] = [t2, t1]; n1 = 1; }
    if (t1 > tmin) { tmin = t1; nx = 0; nz = n1; } tmax = Math.min(tmax, t2); if (tmin > tmax) return null;
  }
  if (tmin <= 0) { // starting inside: ignore (lets shots leave a doorway / window you stand in)
    return null;
  }
  return { t: tmin, nx, nz };
}
function rayCircle(x0, z0, dx, dz, c) {
  const fx = x0 - c.x, fz = z0 - c.z; const a = dx * dx + dz * dz, b = 2 * (fx * dx + fz * dz), cc = fx * fx + fz * fz - c.r * c.r;
  if (cc <= 0) return null; // inside
  const disc = b * b - 4 * a * cc; if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a); if (t < 0 || t > 1) return null;
  const hx = x0 + dx * t - c.x, hz = z0 + dz * t - c.z, hl = Math.hypot(hx, hz) || 1;
  return { t, nx: hx / hl, nz: hz / hl };
}
