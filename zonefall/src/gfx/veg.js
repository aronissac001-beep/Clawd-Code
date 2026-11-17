// ============================================================================
// ZONEFALL 3 — chunked instanced vegetation. One InstancedMesh per
// (chunk, kind, part). Individual plants can be hidden / shrunk / shaken.
// ============================================================================
import { THREE, M } from './materials.js';
import { NCH } from '../world/gen.js';

let Models = null;
export function setVegModels(m) { Models = m; }

const geoCache = {};
function geoms(kind) {
  if (geoCache[kind]) return geoCache[kind];
  let g = null;
  try { g = Models && Models.vegGeometry ? Models.vegGeometry(kind) : null; } catch (e) { console.warn('vegGeometry failed', kind, e); g = null; }
  if (!g || (!g.solid && !g.cut)) g = fallback(kind);
  return (geoCache[kind] = g);
}
function colored(geo, hex) { const g = geo.toNonIndexed ? (geo.index ? geo.toNonIndexed() : geo.clone()) : geo; const c = new THREE.Color(hex); const n = g.attributes.position.count; const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); if (g.attributes.uv) g.deleteAttribute('uv'); return g; }
function fallback(kind) {
  const trunk = h => colored(new THREE.CylinderGeometry(0.18, 0.28, h, 6).translate(0, h / 2, 0), '#5a4030');
  switch (kind) {
    case 'pine': case 'pine_snow': return { solid: trunk(2.5), cut: colored(new THREE.ConeGeometry(1.8, 6.5, 7).translate(0, 5, 0), kind === 'pine' ? '#2f5a3a' : '#cfd8dc') };
    case 'oak': case 'birch': case 'palm': return { solid: trunk(3), cut: colored(new THREE.IcosahedronGeometry(2.4, 0).translate(0, 4.6, 0), '#4f7a34') };
    case 'dead': return { solid: trunk(4), cut: null };
    case 'cactus': return { solid: colored(new THREE.CylinderGeometry(0.3, 0.35, 2.4, 6).translate(0, 1.2, 0), '#5a7a3a'), cut: null };
    case 'boulder': return { solid: colored(new THREE.IcosahedronGeometry(1.6, 0).scale(1, 0.7, 1).translate(0, 0.6, 0), '#8a877f'), cut: null };
    case 'rock_small': return { solid: colored(new THREE.IcosahedronGeometry(0.4, 0).translate(0, 0.15, 0), '#8a877f'), cut: null };
    case 'grass': return { solid: colored(new THREE.ConeGeometry(0.25, 0.5, 4).translate(0, 0.25, 0), '#6b8a3e'), cut: null };
    case 'hemp': return { solid: colored(new THREE.ConeGeometry(0.35, 1.1, 5).translate(0, 0.55, 0), '#7a9a3a'), cut: null };
    case 'berry_bush': return { solid: colored(new THREE.IcosahedronGeometry(0.6, 0).translate(0, 0.5, 0), '#4a6a2a'), cut: null };
    case 'mushroom': return { solid: colored(new THREE.ConeGeometry(0.18, 0.25, 6).translate(0, 0.2, 0), '#c8a070'), cut: null };
    case 'stump': return { solid: trunk(0.5), cut: null };
    case 'log_fallen': return { solid: colored(new THREE.CylinderGeometry(0.3, 0.3, 3.5, 6).rotateZ(Math.PI / 2).translate(0, 0.3, 0), '#6a4a30'), cut: null };
    default: return { solid: colored(new THREE.IcosahedronGeometry(0.7, 0).translate(0, 0.5, 0), '#4f6a2e'), cut: null };
  }
}
export const VEG_R = { pine: 0.35, pine_snow: 0.35, oak: 0.42, birch: 0.3, dead: 0.3, palm: 0.3, cactus: 0.35, boulder: 1.5, log_fallen: 0, stump: 0.3 };
export function vegRadius(kind) { const info = Models && Models.VEG_INFO && Models.VEG_INFO[kind]; return info ? info.r : (VEG_R[kind] || 0); }
export const TREE_KINDS = new Set(['pine', 'pine_snow', 'oak', 'birch', 'dead', 'palm', 'cactus']);

const dummy = new THREE.Object3D();

export class VegLayer {
  constructor(W) {
    this.W = W; this.group = new THREE.Group(); this.group.name = 'veg';
    this.slots = new Map(); // veg id -> {mesh(es), index}
    this.lod = [];
    this.matS = M.mat('#ffffff', { vc: true });
    this.matC = M.mat('#ffffff', { vc: true, cut: true });
    for (let c = 0; c < NCH * NCH; c++) this.buildChunk(c);
  }
  buildChunk(c) {
    const list = this.W.vegChunks[c]; if (!list.length) return;
    const byKind = {};
    for (const v of list) (byKind[v.kind] || (byKind[v.kind] = [])).push(v);
    for (const kind in byKind) {
      const arr = byKind[kind]; const g = geoms(kind);
      const parts = [];
      if (g.solid) parts.push(new THREE.InstancedMesh(g.solid, this.matS, arr.length));
      if (g.cut) parts.push(new THREE.InstancedMesh(g.cut, kind === 'grass' ? this.matS : this.matC, arr.length));
      arr.forEach((v, i) => {
        this.setMatrix(v, 1);
        for (const p of parts) p.setMatrixAt(i, dummy.matrix);
        this.slots.set(v.id, { parts, i, v });
      });
      const small = kind === 'grass' || kind === 'mushroom' || kind === 'rock_small' || kind === 'fern';
      const big = kind === 'pine' || kind === 'pine_snow' || kind === 'oak' || kind === 'birch' || kind === 'dead' || kind === 'palm' || kind === 'boulder' || kind === 'cactus';
      const lodR = big ? 230 : small ? 45 : 95;
      for (const p of parts) { p.castShadow = !small; p.receiveShadow = true; p.instanceMatrix.needsUpdate = true; p.computeBoundingSphere(); this.group.add(p); this.lod.push({ m: p, cx: (c % NCH + 0.5) * 64, cz: (Math.floor(c / NCH) + 0.5) * 64, r: lodR + 46 }); }
    }
  }
  setMatrix(v, s) {
    dummy.position.set(v.x, v.y - 0.05, v.z); dummy.rotation.set(v.tilt || 0, v.ry, 0);
    const sc = v.s * s; dummy.scale.set(sc, sc, sc); dummy.updateMatrix();
  }
  /** show only chunks near the camera: trees far, bushes mid, grass tufts close */
  updateLOD(x, z) { for (const L of this.lod) L.m.visible = (L.cx - x) ** 2 + (L.cz - z) ** 2 < L.r * L.r; }
  /** scale 0 = hidden. shake = small lean */
  set(id, s = 1, lean = 0) {
    const slot = this.slots.get(id); if (!slot) return;
    slot.v.tilt = lean; this.setMatrix(slot.v, s);
    for (const p of slot.parts) { p.setMatrixAt(slot.i, dummy.matrix); p.instanceMatrix.needsUpdate = true; }
  }
}
