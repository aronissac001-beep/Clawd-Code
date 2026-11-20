// Level views (owner C; EMBERCROWN-FORTRESS.md 6.3, Stage Z1 E6). The renderer draws ONE level at a time,
// and every layer under js/engine/render/ was written for one plane (index y * W + x). A level view is a
// read-only stand-in for the colony whose layers are that level's slice, so the plane code runs unchanged:
//   view.L.<layer>     u8/u16/... layers of N: subarray [z * PLANE, (z + 1) * PLANE) (no copy)
//                      bitsets of N bits (known, fog, ...): the byte subarray of the level (PLANE % 8 === 0)
//   view.L.roof        DERIVED: the saved roof where it is BUILT, else 3 (covered) where the voxel has rock or
//                      a floor above it (cover >= 1, 2.4), else OPEN. Every render rule that reads "roofed"
//                      (light ambient, known rock, rain, the season palette) then means "has a ceiling".
//   view.rt.<array>    N-sized runtime arrays sliced the same way (light, occ, room, walkCost, ...); the rest
//                      of rt (rooms, dirty, ...) is inherited
//   view.__lvl, __base the level and its first voxel; everything else (col, bld, items, tick ...) is inherited
// Entities are NOT filtered here (bld is indexed by id): the entity layer filters by e.z === __lvl.
// A view is rebuilt when an array it slices was replaced (load, initRuntime) and its derived roof is
// recomputed when the renderer's write version moved (a terrain or roof write anywhere; 16k bytes, about
// 20 us). Render only: never written, never read by js/game/.

import { N, PLANE, ROOF } from '../../game/core/grid.js';
import { coverRebuild, columnScan } from '../../game/world/vertical.js';

const COVERED = 3;

export class LevelViews {
  constructor() { this.s = null; this.views = new Map(); this.cover = null; this.ver = 0; this.builds = 0; }
  setState(s) { this.s = s; this.views.clear(); this.cover = null; this.ver++; }
  /** A terrain or roof write at voxel i (the renderer's onRenderDirty sink): derived roofs go stale. */
  touch(i) {
    this.ver++;
    if (this.cover && !(this.s.rt && this.s.rt.cover) && i >= 0 && i < N) columnScan(this.s, i % PLANE, this.cover, null);
  }
  coverOf() {
    const rt = this.s.rt;
    if (rt && rt.cover && rt.cover.length === N) return rt.cover;
    if (!this.cover || this.cover.length !== N) this.cover = coverRebuild(this.s);
    return this.cover;
  }
  /** The view of level z (cached; checked against the colony's arrays on every call). */
  get(z) {
    const s = this.s;
    let v = this.views.get(z);
    if (!v || !this.fresh(v)) { v = this.build(z, v); this.views.set(z, v); }
    if (v.__ver !== this.ver) this.derive(v);
    return v;
  }
  fresh(v) {
    const s = this.s;
    if (v.__L !== s.L || v.__rt !== s.rt || v.__nk !== Object.keys(s.rt).length) return false;
    const src = v.__src;
    for (let k = 0; k < src.length; k += 3) if (src[k][src[k + 1]] !== src[k + 2]) return false;
    return true;
  }
  build(z, old) {
    const s = this.s, base = z * PLANE, bits = (N + 7) >> 3, src = [];
    const slice = (o, k, out) => {
      const a = o[k];
      if (!ArrayBuffer.isView(a)) return;
      if (a.length === N) { out[k] = a.subarray(base, base + PLANE); src.push(o, k, a); }
      else if (a.length === bits && N !== bits) { out[k] = a.subarray(base >> 3, (base + PLANE) >> 3); src.push(o, k, a); }
    };
    const L = {};
    for (const k of Object.keys(s.L)) { L[k] = s.L[k]; slice(s.L, k, L); }
    L.roof = old && old.L.roof && old.L.roof.length === PLANE ? old.L.roof : new Uint8Array(PLANE);
    const rt = Object.create(s.rt || null);
    if (s.rt) for (const k of Object.keys(s.rt)) slice(s.rt, k, rt);
    const v = Object.create(s);
    v.L = L; v.rt = rt; v.__lvl = z; v.__base = base; v.__src = src; v.__L = s.L; v.__rt = s.rt; v.__nk = s.rt ? Object.keys(s.rt).length : 0; v.__ver = -1;
    this.builds++;
    return v;
  }
  derive(v) {
    const roof = this.s.L.roof, cov = this.coverOf(), out = v.L.roof, base = v.__base;
    for (let p = 0; p < PLANE; p++) {
      const r = roof[base + p];
      out[p] = r !== ROOF.OPEN ? r : cov[base + p] ? COVERED : ROOF.OPEN;
    }
    v.__ver = this.ver;
  }
}
