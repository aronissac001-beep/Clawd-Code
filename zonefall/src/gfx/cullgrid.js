// ============================================================================
// ZONEFALL 4 — distance culling for the thousands of small world objects
// (crates, barrels, ore nodes, drops, deployables, wrecks). Objects live in
// 32 m cell groups per size class; whole cells are switched on/off by their
// distance to the camera, so far-away clutter never reaches the GPU (or the
// shadow pass). Objects keep their own .visible for gameplay (looted, gone).
// ============================================================================
import { THREE } from './materials.js';

const CELL = 32;
// view distance per class (metres from the camera to the cell centre)
const RANGE = { small: 70, mid: 120, big: 220 };

export class CullGrid {
  constructor(scene) {
    this.scene = scene; this.cells = new Map(); this.list = []; this.t = 0; this.k = 1;
  }
  /** add obj (already positioned in world space) to the grid */
  add(obj, x, z, cls = 'small') {
    const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL), key = cls + ci + ',' + cj;
    let g = this.cells.get(key);
    if (!g) {
      g = new THREE.Group(); g.name = 'cull:' + cls;
      g.userData.cx = (ci + 0.5) * CELL; g.userData.cz = (cj + 0.5) * CELL; g.userData.R = (RANGE[cls] || 70) + CELL * 0.71;
      this.cells.set(key, g); this.list.push(g); this.scene.add(g);
    }
    g.add(obj); return obj;
  }
  /** k scales view distances (gfx level); call every few frames */
  update(x, z, k = this.k) {
    this.k = k;
    for (const g of this.list) {
      const u = g.userData, R = u.R * k, dx = u.cx - x, dz = u.cz - z;
      g.visible = dx * dx + dz * dz < R * R;
    }
  }
  clear() { for (const g of this.list) g.removeFromParent(); this.cells.clear(); this.list.length = 0; }
}
